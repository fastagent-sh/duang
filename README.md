# duang

**A native workbench for agents you make, use and share.**

Create an agent, give it the folders it works on and the ones it should know, use it every day in
duang, and keep working in the same client when it also runs online. An online instance can execute
routines while your laptop is off, be added as a contact by other people, or answer in Slack, Feishu
and other FastAgent channels. Giving someone the Agent instead gives them their own copy, with their
own credentials and conversations. Conversations stay with the instance they happened in.

The words are FastAgent's ([agent model](https://github.com/fastagent-sh/fastagent/issues/684)). They
describe the model FastAgent is moving to, which duang follows with its next release
([#133](https://github.com/fastagent-sh/duang/issues/133)); today an agent is a `fastagent/` directory
inside a project and works on the project around it, with no declared contexts:

| Word | Means |
|---|---|
| **Agent** | The definition: its model, its harness (`SYSTEM.md`, skills, tools, routines, `fastagent.config.ts`) and its contexts, in a directory of its own, which is also where it works |
| **Context** | A directory the agent **works on** or **knows** (read-only): a project, a folder of notes, a repository |
| **Instance** | One Agent running in one place, on this Mac or on a host, with its own conversations and credentials |
| **Conversation** | A FastAgent session of one instance |

## The bet

Vibing an agent in a terminal is easy; living with it and letting someone else use it should be as
natural as adding a contact. duang is the primary place to give an agent work, follow a long run,
read the result and continue. Existing chat channels are convenient additional entrances, not the
main workbench. FastAgent supplies the agent runtime and channel adapters; duang makes local work,
remote use and distribution one understandable experience without inventing a second transcript.

Two kinds of sharing must stay distinct: **give someone the Agent** (they get their own copy and run
their own instance, with their credentials and conversations) and **invite someone to an online
instance** (the owner keeps it running; the visitor gets access to their own conversation). An owner can also keep an
online agent entirely private just to run routines and work while their computer sleeps.

## Who it's for, first

People who create agents and want to use them themselves, keep them working online, or share them
with friends and teammates. Recipients use those agents mainly in duang;
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
or exposing filesystem and credentials to the renderer. An Agent can run as several instances; its
local and online conversations remain separate. Available actions depend on the endpoint's
`capabilities()`.

When local file and diff inspection is added, main will read the agent's directory and contexts; the
renderer will not gain filesystem access or tunnel a remote context into a file browser. The local runtime currently shares Electron main; see
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
closed. Inviting someone to that running instance and giving someone the Agent are separate, optional paths.
Cloud conversations live with the online runtime; local conversations never migrate on deploy.

A remote model needs server-side credentials: a local Claude/ChatGPT subscription login is not a
cloud credential. Deployment must explicitly exclude local secrets, private sessions and
machine-specific state, then set the required cloud secrets at the host. A published version is a
snapshot of the Agent; edits on the laptop do not silently change the online instance. A context the
online instance needs reaches it as FastAgent's context types allow (a copy, or a repository it clones).

Routine execution is not guaranteed by a suspended machine: a cron instant does not wake it. Start
with a resident machine and show its cost. Consider an external clock only once it reliably wakes
scheduled work and reports failure or skipped runs; a manual `POST /run` alone is not an external
scheduler. FastAgent's routine API and deployment residency are the locked version's; check that
contract before implementing hosting. See
[architecture](docs/architecture.md#online-execution-and-routines).

The desktop client and giving someone an Agent are free. duang cloud is an optional paid host, not a
prerequisite for using or sharing an agent. A flat `$9/account` including several agents is an
unverified pricing hypothesis, not a promise; hosting cost, usage limits and payment terms need
real measurements. No token resale is planned.

## Delivery stages

Week 1 local setup, streaming, history and navigation have been accepted. Stages 1–5 below
are **not yet accepted**. A stage number is an outcome gate, not a calendar week.

1. **Daily local workbench.** Create an agent with the contexts it works on and knows, start work,
   switch away, return to the real outcome and continue without a terminal. Creating agents with
   contexts waits for FastAgent's agent-directory release
   ([#133](https://github.com/fastagent-sh/duang/issues/133)); today an agent is still added from a
   directory. Connect a model provider (subscription, API key or custom endpoint)
   in the app rather than through `fastagent login`. The network already follows the system proxy
   per request, with a setting to override it (Settings → Network, `⌘,`).
   Inspect the loaded definition and relevant local changes as needed.
   Reuse Week 1 chat; prioritize demonstrated gaps over a full IDE, file tree or every session
   control. Local routine inspection must not promise execution after the laptop closes.
2. **Give someone the Agent.** Another person gets their own copy of an Agent on a different machine
   and runs their own instance with new credentials and independent history. Its contexts travel as
   their types allow (a repository by reference; a local folder only as a reviewed copy). No secrets,
   runtime state or machine-only paths travel with it.
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

Measure time from creating an agent to daily use, then to the first successful routine
while the owner's laptop is off, and to the first non-owner successfully using a shared agent.
Measure whether owners and recipients return to complete work, and whether hosting revenue covers
its actual cost. Uptime alone does not prove an agent helped anyone; there is no fixed install or
price threshold yet. Do not claim an online or shared flow has shipped based on local mock tests.

## Run it

```bash
npm ci          # FastAgent is an exact version from npm
npm run dev     # Electron + Vite; main/preload edits restart the app
npm test        # registry, routing, selection, drafts, transcript and command regressions
npm run test:smoke  # real Electron + IPC + FastAgent with a fake model: the workflow, then the live transcript
DUANG_LIVE=1 npm run test:live  # opt-in: real provider calls using this machine's credential file
npm run shots       # screenshots of the real window in both colour modes, into out/shots/
npm run package     # the macOS app and its dmg, into dist/
npm run test:package  # package, then run the installed app outside the checkout
```

**Installing the app.** Open `dist/duang-<version>-arm64.dmg` (or the `duang-macos-arm64` artifact of a CI run)
and drag duang to Applications. It is not signed with an Apple Developer ID yet, so the first open is refused:
right-click duang → Open, or System Settings → Privacy & Security → Open Anyway. Apple silicon only for now. The
installed app and `npm run dev` share one data directory (`~/Library/Application Support/duang/`: agents,
credentials, settings), so only one of them runs at a time; starting the other brings the running one forward.

`test:live` is the only check that proves authentication end to end: it makes unfaked OpenAI (Sign in
with ChatGPT) and Anthropic requests through the real IPC path, so it spends model credits and needs working logins.
It skips itself without `DUANG_LIVE=1`, isolates the registry and agent directory, and prints no
credential values.

FastAgent is pinned to an exact published version. Setup, review and merge workflow:
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

Today, point *Add agent* at a FastAgent directory or a plain project. A plain project offers to create
`fastagent/fastagent.config.ts` and `.gitignore` after confirmation; an existing `fastagent/`
directory is never overwritten. A scaffolded agent has no model, so duang asks for one and stores
the choice in its registry rather than editing the agent's config. This layout goes with FastAgent's
agent-directory release: agents will be created in duang, as `~/Agents/<name>/`, with their contexts
([#133](https://github.com/fastagent-sh/duang/issues/133)).

The registry uses atomic writes, serialized within one running instance — there is no cross-process
lock yet, so two instances writing at once can drop each other's rows. Invalid or unreadable data is
reported rather than replaced with an empty list. Adding the same resolved directory reuses its
existing row, and removing an agent today deletes only that row, never the directory or conversation
history (with #133, duang's own agents go to the Trash, after asking).

The picker, every conversation and plan usage use duang's own credential file, `auth.json` in its
user data (`~/Library/Application Support/duang/` on macOS, `%APPDATA%\duang\` on Windows,
`~/.config/duang/` on Linux). duang reads no other store: not the
`fastagent` CLI's (`~/.fastagent/.secrets/auth.json`), not a project's `.secrets/auth.json`, not
pi's, and `FASTAGENT_AUTH_PATH` does not redirect it. Copying a login between files would put one
OAuth grant in two places, and whichever refreshes first invalidates the other. SDK-supported
environment credentials still apply when a provider is absent from the file.

Providers are connected in duang: Settings → Model providers, or **Connect a provider** in an empty
model picker. Choose the provider, then a subscription sign-in (in the system browser) or an API key
(checked once with the provider before it is saved). Disconnecting removes the provider from
duang's file only.

The picker lists what the open agent can run, including endpoints from its own
`fastagent/models.json` and the machine's `~/.fastagent/models.json`: every provider with a
configured credential, whether in that file, an environment variable or a key written in a
`models.json`. It checks credential configuration without refreshing OAuth or testing the provider.
Reopening it or pressing Retry rereads the file, so external login changes need no app restart.
A model released after the installed pi appears once the picker's refresh button has fetched the catalog
from pi.dev for that agent (saved as `models-store.json` in its folder); nothing refreshes on its own.
Execution resolves the actual conversation's provider, including history that differs from the
agent default; OAuth refresh and provider errors remain visible. OAuth refresh writes back to the
same file through the SDK. Behind a proxy, every request follows the system's proxy settings as
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

The picker and every conversation resolve credentials from one file. `test:live` passed against a
real Sign in with ChatGPT (made through duang's own sign-in) and a real Anthropic login, reading duang's
own file through a symlink: `openai/gpt-5.5` answered as the agent default, and a conversation moved to
Anthropic kept its own model and answered. An earlier run, on pi's retired Codex route, also saw a real
OAuth refresh rotate both tokens back into the same file; the ChatGPT run did not need a refresh. The smoke check
covers the same paths deterministically with isolated credentials and replaced provider HTTP.

The fragmented Week 1 status display was subsequently redesigned
([#42](https://github.com/fastagent-sh/duang/issues/42)); it is no longer an open limitation.

Accepted limitations, each recorded in its issue:

- **A mistyped command goes through as text.** Completion inserts the spelling the engine runs
  (`/skill:<name>` for a skill, `/<name>` for an extension command or prompt template), and pi
  expands it ([fastagent#572](https://github.com/fastagent-sh/fastagent/issues/572)). A name the
  engine does not know, typed by hand, reaches the model as plain text without a warning. duang does
  not expand commands itself, because that breaks for remote agents whose files are not on this
  machine.
- **History replay leaves out timing and partial output.** Durable entries carry each call's
  arguments and result, an answer's recorded thinking and how it ended, but not how long thinking or a
  call took, and output streamed before a reload that never became an entry is not replayed. Nothing
  presents partial history as a complete trace.
- **Token counts and cost are not shown.** The header shows how full the context is, from the
  session's `state().usage` ([fastagent#608](https://github.com/fastagent-sh/fastagent/issues/608)),
  which also carries the latest answer's tokens and cost; duang does not display those. A Claude
  subscription's plan windows are shown, read from an endpoint Anthropic does not document, so they
  can stop working without notice. Sign in with ChatGPT has no usage route duang can read, so it
  links to ChatGPT's usage page instead.
- **One unexplained incident**: a run whose output was produced and stored never rendered live,
  once, and has not reproduced. Recorded with its evidence in
  [#10](https://github.com/fastagent-sh/duang/issues/10) rather than patched blind.

Currently out of scope: duang does not start local channels or routines; online connections,
giving someone an Agent, duang cloud, files/diffs and advanced session controls are not implemented. Their
planned scope and order are described in [Delivery stages](#delivery-stages).

## Relationship to duang-v1 / duang-v2

Those repositories designed a collaboration platform (two planes, invite primitives, named hosts,
build pipeline) before a single user existed. The domain thinking is preserved in git history and
can be reintroduced one entity at a time, each paid for by an actual blocked user.
