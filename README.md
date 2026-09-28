# duang

**A native workbench for agents you make, use and share.**

Build an agent in a local directory, use it every day in duang, and keep working in the same client
when you run a copy online. An online agent can execute routines while your laptop is off, be added
as a contact by other people, or answer in Slack, Feishu and other FastAgent channels. Sharing a
preset instead gives someone their own independent agent. Conversations do not automatically follow
the definition between locations or people.

## The bet

Vibing an agent in a terminal is easy; living with it and letting someone else use it should be as
natural as adding a contact. duang is the primary place to give an agent work, follow a long run,
read the result and continue. Existing chat channels are convenient additional entrances, not the
main workbench. FastAgent supplies the agent runtime and channel adapters; duang makes local work,
remote use and distribution one understandable experience without inventing a second transcript.

Two kinds of sharing must stay distinct: **copy a preset** (the recipient owns a new instance,
credentials and conversations) and **invite someone to an online agent** (the owner keeps the
running instance; the visitor gets access to their own conversation). An owner can also keep an
online agent entirely private just to run routines and work while their computer sleeps.

## Who it's for, first

People who create agents in local directories and want to use them themselves, keep them working
online, or share them with friends and teammates. Recipients use those agents mainly in duang;
they need not install the development tools. The owner may additionally put an agent in an existing
chat group. This is not an enterprise administration suite or a replacement code editor.

## Design

Objects, screens and flows are in [docs/design.md](docs/design.md); current visual decisions are
in [docs/ui.md](docs/ui.md); process boundaries and proposed remote hosting are in
[docs/architecture.md](docs/architecture.md). Week 1 local chat is implemented and accepted;
subsequent stages below are plans, not shipped capabilities.

The local client runs `createPiAgentFromDir` in Electron main without opening a local port. For
remote work, FastAgent exposes `connectAgent` and `connectSessionControl` over HTTP/SSE. duang will
use those public contracts behind a protected endpoint, without copying the runtime's session store
or exposing filesystem and credentials to the renderer. A definition can run in multiple places;
its local and online conversations remain separate. Available actions depend on the endpoint's
`capabilities()`.

When local file and diff inspection is added, main will read the agent directory; the renderer
will not gain filesystem access or tunnel a remote workspace into a file browser. The local runtime currently shares Electron main; see
[architecture](docs/architecture.md) for the failure boundary. An agent may be hosted by its owner
or, later, by duang cloud. Neither option makes a public, unauthenticated FastAgent endpoint safe
for invitations. Existing group channels remain separate from duang's private conversations.

There is no enterprise role hierarchy, approval workflow or central message store in this plan.
A shared online agent still needs a minimal protected access boundary, revocable invitations and
conversation isolation. FastAgent's current general execution is not fully sandboxed; owners must
not offer arbitrary high-privilege tools to untrusted visitors.

## Planned hosting and distribution

An owner may run an online agent on their own host or choose duang cloud. The first online path is
private: the owner connects to it in duang and its routines work after the desktop and laptop have
closed. Inviting someone to that running agent and exporting a preset are separate, optional paths.
Cloud conversations live with the online runtime; local conversations never migrate on deploy.

A remote model needs server-side credentials: a local Claude/Codex subscription login is not a
cloud credential. Deployment must explicitly exclude local secrets, private sessions and
machine-specific state, then set the required cloud secrets at the host. A published version is a
snapshot of the agent definition; edits on the laptop do not silently change the live agent.

Routine execution is not guaranteed by a suspended machine: a cron instant does not wake it. Start
with a resident machine and show its cost. Consider an external clock only once it reliably wakes
scheduled work and reports failure or skipped runs; a manual `POST /run` alone is not an external
scheduler. FastAgent's routine API and deployment residency differ between the currently pinned
revision and newer upstream; reconcile that contract before implementing hosting. See
[architecture](docs/architecture.md#online-execution-and-routines).

The desktop client and preset sharing are free. duang cloud is an optional paid host, not a
prerequisite for using or sharing an agent. A flat `$9/account` including several agents is an
unverified pricing hypothesis, not a promise; hosting cost, usage limits and payment terms need
real measurements. No token resale is planned.

## Delivery stages

Week 1 local setup, streaming, history and navigation have been accepted. Stages 1–5 below
are **not yet accepted**. A stage number is an outcome gate, not a calendar week.

1. **Daily local workbench.** Find an agent, start work, switch away, return to the real outcome and
   continue without a terminal. Connect a model provider (subscription, API key or custom endpoint)
   in the app rather than through `fastagent login`. The network already follows the system proxy
   per request, with a setting to override it (Settings → Network, `⌘,`).
   Inspect the loaded definition and relevant local changes as needed.
   Reuse Week 1 chat; prioritize demonstrated gaps over a full IDE, file tree or every session
   control. Local routine inspection must not promise execution after the laptop closes.
2. **Share a preset.** Another person imports a portable definition on a different machine and
   runs their own instance with new credentials and independent history. No secrets, private
   sessions or machine-only paths travel with it.
3. **Add an online contact.** First connect the owner's protected, already-running remote agent and
   observe its routine work in duang; then invite someone else. With the owner's desktop closed,
   the visitor can work, cannot read someone else's private conversations and can lose access when
   their invite is revoked. No duang hosting required.
4. **Optional duang cloud.** Publish, update and stop an owned agent without operating a server.
   With the laptop off, a scheduled routine actually executes and its result, failure or skip is
   observable in duang. Integrate a real FastAgent group channel without making a channel or
   invitation mandatory for private routines.
5. **Groups and discovery, if needed.** Use existing chat groups first. Build duang-native shared
   conversations or a public directory only if direct invitations and channel groups prove
   insufficient; neither is required to complete stages 1–4.

## How we know it worked

Measure time from a working local definition to daily use, then to the first successful routine
while the owner's laptop is off, and to the first non-owner successfully using a shared agent.
Measure whether owners and recipients return to complete work, and whether hosting revenue covers
its actual cost. Uptime alone does not prove an agent helped anyone; there is no fixed install or
price threshold yet. Do not claim an online or shared flow has shipped based on local mock tests.

## Run it

```bash
npm ci          # needs a sibling ../fastagent already built at the pinned revision
npm run dev     # Electron + Vite; main/preload edits restart the app
npm test        # registry, routing, selection, drafts, transcript and command regressions
npm run test:smoke  # real Electron + IPC + FastAgent, with a fake model HTTP response
DUANG_LIVE=1 npm run test:live  # opt-in: real provider calls using this machine's credential file
npm run shots       # screenshots of the real window in both colour modes, into out/shots/
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

The picker lists what the open agent can run through that file, including endpoints from its own
`fastagent/models.json` and the machine's `~/.fastagent/models.json`. It checks credential
configuration without refreshing OAuth or testing the provider.
Reopening it or pressing Retry rereads the file, so external login changes need no app restart.
Execution resolves the actual conversation's provider, including history that differs from the
agent default; OAuth refresh and provider errors remain visible. OAuth refresh writes back to the
selected file through the SDK. Behind a proxy, every request follows the system's proxy settings as
they are at that moment (a VPN switched on later included), because Node's `fetch` would otherwise
ignore them; Settings → Network can fix a proxy or turn it off, and tests the route.

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

The fragmented Week 1 status display was subsequently redesigned
([#42](https://github.com/fastagent-sh/duang/issues/42)); it is no longer an open limitation.

Accepted limitations, each recorded in its issue:

- **`/name` does not invoke anything.** Completion spells the name; the agent reads the line as
  text and usually acts on it, which is the model's judgement rather than a promise. Making it
  deterministic is a FastAgent contract question
  ([fastagent#572](https://github.com/fastagent-sh/fastagent/issues/572)); duang will not expand
  commands itself, because that breaks for remote agents whose files are not on this machine.
- **History replay is partial.** Durable entries expose tool names and results but not tool
  arguments, thinking or settled run outcomes, and partial output emitted before a reload is not
  replayed. Nothing presents partial history as a complete trace.
- **Token usage, cost and context are not shown.** The runtime records them per turn, but the live
  session state duang reads does not carry them
  ([fastagent#608](https://github.com/fastagent-sh/fastagent/issues/608)); nothing is invented in
  their place. A Claude or ChatGPT subscription's plan windows are shown, read from endpoints those
  providers do not document, so they can stop working without notice.
- **Skills load only from the agent's own `fastagent/skills/`**, so global skills are invisible
  ([fastagent#570](https://github.com/fastagent-sh/fastagent/issues/570)), and an unreadable agent
  directory is reported upstream as "no agent here"
  ([fastagent#571](https://github.com/fastagent-sh/fastagent/issues/571)).
- **One unexplained incident**: a run whose output was produced and stored never rendered live,
  once, and has not reproduced. Recorded with its evidence in
  [#10](https://github.com/fastagent-sh/duang/issues/10) rather than patched blind.

Currently out of scope: duang does not start local channels or routines; online connections,
preset sharing, duang cloud, files/diffs and advanced session controls are not implemented. Their
planned scope and order are described in [Delivery stages](#delivery-stages).

## Relationship to duang-v1 / duang-v2

Those repositories designed a collaboration platform (two planes, invite primitives, named hosts,
build pipeline) before a single user existed. The domain thinking is preserved in git history and
can be reintroduced one entity at a time, each paid for by an actual blocked user.
