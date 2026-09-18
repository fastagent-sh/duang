# duang

**Telegram for your agents, with a deploy button.**

An agent you vibed in a terminal is stuck there. duang gives it a contact card, a chat window,
and one switch: run it on this machine, or run it in the cloud where it answers your team in
Telegram while your laptop sleeps. Same agent and controls; local and cloud conversations stay separate.

## The bet

Every client in this space today remote-controls a session on your laptop (Happy, Omnara, Zedra,
SeaWork). That whole category patches one assumption: **the agent can't leave your machine.**
A session isn't portable, so a tunnel is the only answer they have.

A FastAgent agent is a directory, and a directory is portable. So the fix isn't a better remote
control — it's letting the agent move out. Local and remote are one switch, not a rewrite.

The other half no-code deploy platforms can't reach: when the deployed agent misbehaves, you open
the same chat, read the full tool trace, and take over. They have no local half to fall back to.

FastAgent's session control plane already carries everything that takes: the same HTTP+SSE contract
serves a process on `127.0.0.1` and a machine in the cloud, so duang ships without inventing a
protocol or extending one.

## Who it's for, first

Someone who has already vibed at least one agent in Claude Code / pi **and has people waiting on
it** — a support bot for their community, a PR reviewer for their team, a daily-digest agent for
themselves. Their pain: "it only lives in my terminal, and teammates keep asking me to run it."

Not: general developers, enterprises, teams needing collaboration features.

## Design

Objects, screens and flows are in [docs/design.md](docs/design.md); processes, boundaries and the
deploy pipeline are in [docs/architecture.md](docs/architecture.md). The rest of this section is
the one structural decision everything else follows from.

One decision makes the switch cheap: **local and remote are two implementations of one interface.**
FastAgent's `SessionControl` is implemented in-process by `createPiSessionControl`
(via `createPiAgentFromDir` in `@fastagent-sh/fastagent/pi`) and over HTTP+SSE by `session-remote.ts`. The client codes against
the interface; the wire protocol is an implementation detail of the remote one.

```
Client (Electron + React)
  agents[]: { name, dir, endpoint? }
        │  one interface: SessionControl
        ├── no endpoint → createPiAgentFromDir(dir)         in Electron main, no transport
        └── endpoint   → remote control over HTTP + SSE
                          └── channels: Telegram / Feishu
```

Nothing is spawned and no local port is opened: a local agent is an object in the main process.
Electron must be >= 38.3, where the bundled Node reaches 22.20 (FastAgent requires >= 22.19).

`ponytail:` the local agent shares the main process, so a crash in pi takes the window with it
(sessions are on disk, so a restart recovers). Swap the factory for `utilityProcess.fork()` plus a
MessagePort bridge if that ever actually happens — `SessionControl` is the seam, and no UI code
changes.

### What is symmetric, and what is not

Symmetric — the whole conversation, identical local and remote: `steer` (talk into a live run),
`followUp`, `abort`, `compact`, `fork`, `update({ model, thinkingLevel, name })`, `entries({
since })` for the full entry tree, `update({ leafEntryId })` for branch switching, and the event
stream (`message_delta`, `tool_started/progress/finished`, `queue_changed`, `retry_scheduled`).
`capabilities()` tells the client in advance which of these a given endpoint refuses.

Asymmetric on purpose — **files**. `/control` carries none, and shouldn't. Locally the client and
the agent share a machine, so the file tree, diffs and git status are read straight off
`agents[].dir`: no protocol, no tunnel. Remotely there is no workspace of yours to show, and a
client is a conversation plus an activity feed. Forcing these to look the same would mean
tunnelling a workspace — which is the remote-control category this product exists to avoid.

Absent and not wanted — **approvals**. The contract has no server-initiated question (no permission
prompt, no extension dialog); agents run pre-authorized by what their directory declares, local and
remote alike. This deletes the approval UI, the suspended-run state, and the hardest reconnect case
(a pending question outliving the connection).

Consequences, all deliberate:

- **No collaboration server.** Multi-person group chat happens in Telegram/Feishu/Slack, where
  people already are. duang's own chat is you and your agents only. Renting distribution beats
  building a social network — and every deployed agent advertises the product inside someone
  else's group.
- **No Host / Runner / Deployment abstraction.** An endpoint is a URL. Those three layers existed
  to route between two execution paths; there is only one path now.
- **The client never imports pi.** FastAgent hosts the engine; the client is a protocol consumer.
- **Electron, not Tauri.** FastAgent is an npm package, so the main process can call it directly.
  No Rust toolchain, no extra IPC bridge.
- **Contacts, not tabs.** An agent is a persistent contact with memory and presence, not a
  session tab. Tool traces and diffs are the expanded view of that conversation.

## duang cloud (the hosted runtime)

Deploy targets our infrastructure, not the user's cloud account. It is the only paid surface, so
it is the only server we run.

```
Client  ──upload agent dir──▶  Control service (one Node process + SQLite)
                                   │  calls FastAgent's existing deployFlyRun()
                                   │  holds every agent's cron, POSTs the due slot
                                   ▼
                              our Fly org: one suspended microVM per agent
                                   │  secrets: model API key, channel tokens,
                                   │           generated FASTAGENT_CONTROL_TOKEN
 Client ──/control HTTP+SSE──▶ https://<agent>.fly.dev
```

**Always-on is a promise, not a running machine.** Every cloud agent deploys with
`min_machines_running = 0` and `auto_stop_machines = "suspend"`: an idle agent costs volume
storage, and a Telegram webhook resumes it (FastAgent's Telegram channel is webhook-driven, so it
wakes from suspend).

The one case that cannot wake itself is the one this product is about — a cron instant. FastAgent's
`fly/plan.ts` pins `min_machines_running = 1` whenever schedules exist, because nothing external
wakes the machine. The control service is that external waker: it holds the cron for every agent
and POSTs the due slot, which resumes the microVM. FastAgent already supports this
(`SchedulerOptions.externalClock`), and slot claim/settle makes a double fire impossible.

The control service owns three tables — account, agent, deployment — plus the cron timers. Skipped
until a real limit is hit: build workers, an OCI registry, multi-region, autoscaling, a quota
engine, a log pipeline (Fly's own logs are proxied through). The GitHub channel stays out of the
MVP: its turns have no replay, so it is the one channel that really does need a machine kept up.

**The one seam in the "same agent, one switch" promise: credentials.** Locally an agent can use
your Claude/Codex subscription via pi's OAuth; that does not transfer to a server. A cloud deploy
asks for a model API key once and stores it as a Fly secret. The flow says this out loud rather
than failing after the button.

Cost shape: an idle agent is pennies of volume storage; the bill is active seconds. So the price is
**$9 per account per month, several agents included** — simplest to explain and to bill. Revisit
when one account's active minutes actually threaten the margin, not before.

## MVP

| Week | Only this |
|---|---|
| 1 | Agent registry, first-run setup, local in-process chat, streaming tool traces, history, steer/stop and visible failures |
| 2 | Local file tree and git diffs, discovered agent settings, remaining conversation controls |
| 3 | Remote endpoints — same UI, different base URL and token |
| 4–5 | Control service: GitHub OAuth, upload, deploy to our Fly org, external cron waker, Telegram toggle, activity inbox |

Billing is manual for the first cohort (an invoice, or free) until roughly 20 paying users make
Stripe worth wiring. Explicitly not in the MVP: groups, memberships, invites, access grants, web
app, mobile app. Each returns only when a paying user is blocked on it.

## How we know it worked

North star: **always-on agent days** (deployed agents × consecutive days online). Not DAU, not
session count — this is the only number that moves when an agent actually works for someone.

Kill criterion: of 100 installs, fewer than 15 move an agent to a remote endpoint and keep it
online for 7 days within two weeks. Then the wedge is wrong.

Money: the client is free and open source (that's distribution — monocode already anchored this
price at zero). Revenue is duang cloud, per account per month. No token resale; users
bring their own model key or subscription.

## Run it

```bash
npm ci          # needs a sibling ../fastagent already built at the pinned revision
npm run dev     # Electron + Vite
npm test        # registry, routing, selection, drafts, transcript and command regressions
npm run test:smoke  # real Electron + IPC + FastAgent, with a fake model HTTP response
DUANG_LIVE=1 npm run test:live  # opt-in: real provider calls using this machine's credential file
```

`test:live` is the only check that proves authentication end to end: it makes unfaked Codex and
Anthropic requests through the real IPC path, so it spends model credits and needs working logins.
It skips itself without `DUANG_LIVE=1`, isolates the registry and agent directory, and prints no
credential values.

The FastAgent dependency is `file:../fastagent` while both move together; it becomes a version
range when duang ships a build. Fresh-checkout setup, the pinned revision, review and merge
workflow: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

Point *Add agent* at a FastAgent directory or a plain project. A plain project offers to create
`fastagent/fastagent.config.ts` and `.gitignore` after confirmation; an existing `fastagent/`
directory is never overwritten. A scaffolded agent has no model, so duang asks for one and stores
the choice in its registry rather than editing the agent's config.

The registry uses atomic writes, serialized within one running instance — there is no cross-process
lock yet, so two instances writing at once can drop each other's rows. Invalid or unreadable data is
reported rather than replaced with an empty list. Adding the same resolved directory reuses its
existing row, and removing an agent never deletes the directory or conversation history.

The picker and every conversation use the same credential file: FastAgent's own global store
(`~/.fastagent/.secrets/auth.json`, what `fastagent login -g` writes) by default, or the path in
`FASTAGENT_AUTH_PATH` (a leading `~` is expanded). The picker displays its resolved path. duang
neither copies credentials nor silently falls back to a project's `.secrets/auth.json` or to pi's
store; point `FASTAGENT_AUTH_PATH` at either to use it. SDK-supported environment credentials still
apply when a provider is absent from the selected file. `FASTAGENT_SECRETS_DIR` does not redirect
this file.

The picker checks credential configuration without refreshing OAuth or testing the provider.
Reopening it or pressing Retry rereads the file, so external login changes need no app restart.
Execution resolves the actual conversation's provider, including history that differs from the
agent default; OAuth refresh and provider errors remain visible. OAuth refresh writes back to the
selected file through the SDK. Behind a proxy, the system setting is picked up automatically —
Node's `fetch` ignores `HTTPS_PROXY` on its own, so duang installs the dispatcher.

## Week 1 acceptance status

Week 1 is **accepted**, with the limitations below stated rather than hidden. The
[milestone](https://github.com/fastagent-sh/duang/milestone/1) and its
[release gate](https://github.com/fastagent-sh/duang/issues/16) record workflow evidence, not test
counts: all thirteen acceptance scenarios were walked on macOS with real agents and real providers,
and the defects that walk exposed are fixed on `main`.

What works: add an existing agent or scaffold one in a plain project, pick a model, send, stream
text and tool activity, steer a live run, stop it, switch between agents and conversations while
work continues in the background, and reopen runtime-owned history after a restart. The window
returns to the agent and conversation it was left on, and unsent text survives a restart with it.

`agents.json` writes are serialized and atomic. Invalid JSON or filesystem errors are reported with
the original diagnostic and a way to reach the file, never replaced with an empty list. Removing an
agent never deletes its directory or conversations. Changing an agent's model or removing it is
refused while any of its conversations is running.

The picker and every conversation resolve credentials from one file. `test:live` passes against
real Codex and Anthropic accounts, including a conversation whose provider differs from the agent
default and a real OAuth refresh that rotated both tokens back into the same file. The smoke check
covers the same paths deterministically with isolated credentials and replaced provider HTTP.

Accepted limitations, each recorded in its issue:

- **Status display** is truthful but fragmented — seven signals, four vocabularies, and no way to
  see from the list which conversation is running. Agents other than the selected one still show
  their state by colour alone. Redesign deferred to
  [#42](https://github.com/fastagent-sh/duang/issues/42) so it happens once, against the finished
  surface.
- **`/name` does not invoke anything.** Completion spells the name; the agent reads the line as
  text and usually acts on it, which is the model's judgement rather than a promise. Making it
  deterministic is a FastAgent contract question
  ([fastagent#572](https://github.com/fastagent-sh/fastagent/issues/572)); duang will not expand
  commands itself, because that breaks for remote agents whose files are not on this machine.
- **History replay is partial.** Durable entries expose tool names and results but not tool
  arguments, thinking or settled run outcomes, and partial output emitted before a reload is not
  replayed. Nothing presents partial history as a complete trace.
- **Usage and cost are not shown.** The runtime records them per turn, but the live session state
  duang reads does not carry them; nothing is invented in their place.
- **Skills load only from the agent's own `fastagent/skills/`**, so global skills are invisible
  ([fastagent#570](https://github.com/fastagent-sh/fastagent/issues/570)), and an unreadable agent
  directory is reported upstream as "no agent here"
  ([fastagent#571](https://github.com/fastagent-sh/fastagent/issues/571)).
- **One unexplained incident**: a run whose output was produced and stored never rendered live,
  once, and has not reproduced. Recorded with its evidence in
  [#10](https://github.com/fastagent-sh/duang/issues/10) rather than patched blind.

Out of scope by design: local channels and schedules are not started by duang; cloud deployment,
files and diffs, and advanced session controls are later-week work.

## Relationship to duang-v1 / duang-v2

Those repositories designed a collaboration platform (two planes, invite primitives, named hosts,
build pipeline) before a single user existed. The domain thinking is preserved in git history and
can be reintroduced one entity at a time, each paid for by an actual blocked user.
