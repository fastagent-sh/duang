# duang

**Telegram for your agents, with a deploy button.**

An agent you vibed in a terminal is stuck there. duang gives it a contact card, a chat window,
and one switch: run it on this machine, or run it in the cloud where it answers your team in
Telegram while your laptop sleeps. Same agent, same directory, same conversation.

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
(`@fastagent-sh/fastagent/pi`) and over HTTP+SSE by `session-remote.ts`. The client codes against
the interface; the wire protocol is an implementation detail of the remote one.

```
Client (Electron + React)
  agents[]: { name, dir, endpoint? }
        │  one interface: SessionControl
        ├── no endpoint → createPiSessionControl({ dir })   in Electron main, no transport
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
  session tab. Tool traces, diffs and approvals are the expanded view of that conversation.

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
| 1–2 | Agent list, chat, local run via `fastagent dev`, tool traces, file tree and diffs off disk |
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
price at zero). Revenue is duang cloud, per always-on agent per month. No token resale; users
bring their own model key or subscription.

## Relationship to duang-v1 / duang-v2

Those repositories designed a collaboration platform (two planes, invite primitives, named hosts,
build pipeline) before a single user existed. The domain thinking is preserved in git history and
can be reintroduced one entity at a time, each paid for by an actual blocked user.
