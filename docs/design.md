# Product design

The product and delivery gates are in [README.md](../README.md). This document defines the
surfaces and flows; [interaction.md](interaction.md) covers behavior and failures, [ui.md](ui.md)
records the shipped Week 1 visual system, and [architecture.md](architecture.md) owns process and
trust boundaries. **Only the local Week 1 client is implemented and accepted.** Everything marked
planned below needs its own implementation and acceptance evidence.

## One agent, several ways to use it

An agent is a contact: someone can give it work in duang and come back to the result. The creator
can work with a local definition, connect their own online instance, export a preset or invite
someone to use that instance. These are different outcomes, not four modes of one global switch.
Slack, Feishu, Telegram and other FastAgent channels are additional entrances to an online agent;
duang is the full native workbench for long work and follow-up.

| Object | Owner and meaning |
|---|---|
| Agent definition | The creator's directory; skills, tools and routines belong to it. A preset is a portable copy of selected definition content, not a live pointer. |
| Contact | A local agent, an owned online instance or an online agent someone invited you to use. One owned agent can have a local and an online location. |
| Conversation | A FastAgent session, owned by its runtime. Local, online, personal and group conversations do not merge automatically. |
| Run | One turn of work. Accepted, running, settled and unknown-after-disconnect are different conditions; stopping does not undo completed tool work. |
| Deployment | An owned, published snapshot at a protected endpoint, self-hosted or on optional duang cloud. Local edits do not silently change it. |
| Invitation | Access to an existing online agent, not a copy of its definition or a right to read everyone else's sessions. It can be revoked. |

There is no second durable transcript in duang. A shared definition is not shared conversation
memory. Shared knowledge, if declared by the agent, must be a deliberate input with its own
access boundary, not scraped from other people's chats.

## The workbench

The shipped view is a 320px agent roster and a reading column, with the open agent's conversations
in a list under the conversation header. The renderer currently
shows local agents only; the layout below is the intended extension, **not a screenshot of shipped
functionality**.

```text
┌ contacts and my work ─────┬ conversation / result ────────────────────┐
│ My agents                 │ agent · location · connection              │
│   local · online           │                                             │
│ Shared with me            │ task · live work · outcome                  │
│   online contact           │                                             │
│   my conversations         │ composer · continue / stop                 │
└───────────────────────────┴─────────────────────────────────────────────┘
                         details open only when needed
```

Conversations stay under their agent: the roster lists contacts, and each agent's conversations
open from its header. The roster distinguishes **mine** from
**shared with me**, and labels each agent's location; it never offers a global `Local | Cloud`
switch, which cannot represent an owner using both locations while also talking to a visitor's
agent. Current selection, drafts and late events remain attached to the originating agent,
location and conversation. A visitor sees only their own authorized conversations; a channel group
is neither their private chat nor the owner's private chat.

The central surface starts with what the agent can do, then becomes a readable record of the task:
what was asked, what is running, what finished, what failed and what to do next. "What failed" is
the run's outcome and anything the agent says went wrong, not each tool call: an agent reads its own
failed calls and carries on, so a failed step it recovered from asks nothing of the person and is not
called out when its work is folded; it still reads `failed` when opened. Tool details stay
expandable; a long trace must not obscure the result. On reconnect, read runtime-owned state and
history rather than replaying an accepted send. A lost connection is **unknown execution status**
until the runtime can answer, not an automatic failure or success.

An optional detail surface serves the question at hand. A local owner can inspect the **actually
loaded** model, skills, tools and routines where FastAgent exposes them, plus relevant read-only
files and diffs from their directory. If a field is unavailable, say so rather than infer runtime
state from a filename. The same surface on an owned online agent shows its published version,
connection, routine status and recorded outcomes. An invited contact does not expose the owner's
files, secrets or deployment controls. No in-app code editor or general remote filesystem browser.

Routines belong on an owner's online agent even if that agent has never been shared. Show declared
names and schedules, and a recent result/failure/skip **only where the runtime or host reports it**;
`GET /routines` in newer FastAgent lists names and schedules, not execution outcomes. A local
preview must not imply that a routine will fire after the laptop is turned off. Showing an exact
next run or a success badge requires an authoritative clock/outcome source, not a guessed timer.

## Settings: model providers and network (stage 1; network and the first providers version shipped)

The first run must not require a terminal, and a preset recipient must be able to add their own
credentials. Settings open in the content area (the App menu's Settings… `⌘,`, or the Settings
row at the foot of the sidebar, or the model picker's **Manage providers…** / empty-state **Connect a
provider**); the sidebar stays visible so running work remains in view. One page, two groups, no
empty categories: Model providers, then Network.

**Model providers.** The goal: on a new machine, from installing duang to the first answer
without opening a terminal. It serves the owner on a new machine and, above all, a preset
recipient, who brings their own credentials and need not install developer tools.

*Connect a provider* starts with the provider (Anthropic, OpenAI, GitHub Copilot, …), then asks how
to connect when there is more than one way: **Subscription** (OAuth: Claude Pro/Max, ChatGPT/Codex,
Copilot and the other flows FastAgent supports, signed in in the system browser) or **API key**
(verified once when saved, sent only to that provider's own endpoint). A provider with one way goes
straight into it. The list is FastAgent's `loginOptions()`, grouped by provider id and named as
pi names each provider; duang adds no names or groupings of its own, so a vendor that pi splits
shows as two rows (`OpenAI` for API keys, `OpenAI Codex` for a ChatGPT subscription). Common
providers come first and the list can be filtered, since pi offers about forty.

A *Connected* list shows each provider with every source that authenticates it, Reconnect and
Disconnect. A provider-supplied environment variable (such as `ANTHROPIC_API_KEY`) is shown as a
source too, and cannot be removed from duang.

**duang's own credential file (shipped).** Connections are written to one file that only duang reads:
`auth.json` in the app's data directory, beside `agents.json` and `settings.json` (Electron's
`userData`: `~/Library/Application Support/duang/` on macOS, `%APPDATA%\duang\` on Windows,
`~/.config/duang/` on Linux). duang does not read the `fastagent` CLI's or pi's stores, and
`FASTAGENT_AUTH_PATH` no longer points it elsewhere. Sharing a file, or copying a login between
files, puts one OAuth grant in two places: some providers (Anthropic, OpenAI Codex) rotate the
refresh token on every refresh, so one copy's refresh silently invalidates the other. So a login made in a terminal is made again in
duang, as its own grant, and nothing duang connects, replaces or disconnects reaches the CLI. The
file holds one credential per provider: an API key replaces a subscription login for the same
provider, and the reverse, and duang says so before it happens.

Known limitation: the file is plain JSON with mode `0600`, as FastAgent writes it. Desktop apps
usually keep secrets in the OS keychain (VS Code, GitHub Desktop, Docker Desktop, Zed). FastAgent's
runtime and login read and write a file today; storing them in the keychain needs a pluggable
credential store upstream ([fastagent#652](https://github.com/fastagent-sh/fastagent/issues/652)).

**Custom endpoints (after the first version).** Ollama, LM Studio or a gateway, in pi's
`models.json` schema: name, API type, base URL, optional key and the model ids. Ollama and LM Studio
are prefills, not separate integrations. A relay in front of Anthropic or OpenAI is a custom endpoint
under its own provider id: duang never redirects a built-in provider's `baseUrl`, so a subscription
token or official key cannot be sent to a third party by a setting left behind from another
credential. An agent's own `fastagent/models.json` already works (#59). Where duang writes the
endpoint definitions it adds is still open: the machine-level `~/.fastagent/models.json` is shared
with the CLI, which the credential decision above avoids for keys.

**Network (shipped).** *Automatic* is the default and needs no setup: model and sign-in requests
follow the system proxy per request, including its bypass list and PAC rules, and pick up a VPN
client being switched on or off; a TUN-mode VPN needs nothing at all. *Manual* takes a type (HTTP,
HTTPS or SOCKS5), a server and a port; *Off* connects directly. The page shows the route currently in effect
and its source, and checks it: connected with its latency, or unreachable with the original error.
Proxy variables present when duang was launched from a terminal are an explicit route: *Automatic*
then uses them and stops following the system until relaunch, and the page says so. When a proxy is
in effect, the agent's own commands (`git`, `npm`, `curl`) receive one proxy in the standard
variables, as a terminal user would export it; per-host PAC rules and the system bypass list do not
reach them.

Reasoning effort is not a setting: it sits beside the model on the conversation and applies to that
conversation. Per-agent material (tool secrets, inherited machine skills) belongs to the agent
detail view above. Appearance follows the system; shortcuts, notifications, a global default model
and accounts are not settings until a shipped feature needs them.

## Paths through the product

**Daily local use (current foundation).** Connect a model provider in duang (into its own
credential file), add an agent directory, choose a model, start work,
switch away, return to the real outcome, continue. Stage 1 strengthens the return-to-work flow,
loaded-definition visibility and relevant local change review, using real tasks before adding
compact, fork or a complete file tree. The current client already covers the basic chat, history,
steering, stop, drafts and background navigation.

**Copy a preset (planned stage 2).** Export only portable definition content; review exactly what
travels. No credentials, private sessions, machine-specific paths or ambient project contents.
The recipient imports into their own directory, configures their own provider and connected
services and has independent conversations and routines. A successful zip export without an
independent run on another machine is not acceptance.

**Use my own online agent (planned stage 3).** Connect an already running, protected endpoint; the
same owner can choose local for testing and online for ongoing work. Online history is separate.
With duang and the laptop closed, scheduled routines must be observed through the remote runtime
and a real clock. Stage 3 tests this on a self-hosted instance; stage 4 makes deploying it easy on
duang cloud. Moving the *definition* does not move a local session or OAuth subscription login.

**Invite to an online agent (planned stage 3).** An invitation adds a contact, not a preset. A
visitor can start and return to their own conversations while the owner's desktop is closed. The
owner can revoke the invitation. First scope is access by possession of an individual, revocable
invitation; a promise to restrict it to a named person would need identity verification. The
endpoint must not expose deployment-wide `sessions.list()` to visitors.

**Host on duang cloud (planned stage 4).** Show the definition snapshot, excluded files and
server-side credential requirements before publish. After publishing, return to the agent's
online conversation and routines, with a clear live version and an update/stop path. Routines
must actually fire with the laptop off; a sleeping VM without an external clock cannot keep that
promise. Add a channel used by real users without making a channel or invitation mandatory for
private routine work. Channel conversations keep their own identity and reply path; a private
message in duang does not automatically post back to the group.

**Group use (later).** Existing Slack/Feishu/Telegram groups already provide group conversation.
A duang-native group would need multiple human authors and shared-message semantics that the
current `SessionControl` entries do not provide. Build that contract only if external groups and
direct invitations fail a real need; do not silently treat one person's session as a group.

## Failure and safety rules

- Invalid local definitions, unreadable state, provider refusals and deployment failures keep the
  original diagnostic and an action the person can take. Never turn a failed list into an empty one.
- A remote timeout or disconnected stream never replays an accepted run or routine. On recovery,
  read state and history and report any outcome the runtime cannot prove as unknown.
- Hosting must not copy local credentials or conversations. The remote service has no built-in
  authentication in newer FastAgent; protect both control and invoke, isolate visitors' session
  access, and make invitations revocable before sharing an endpoint.
- Routine time requires a resident machine or a verified external scheduler. Failed, skipped and
  interrupted fires are not successes; stop does not roll back tool effects.
- FastAgent does not yet sandbox the entire general agent process or guarantee exactly-once work.
  Do not promise arbitrary high-privilege tools are safe for untrusted visitors. No enterprise
  roles, administration suite, approval prompt system or compliance audit UI is planned.

## Deliberately deferred

A built-in editor, general Git client, remote files, social discovery directory, native group chat,
web/mobile workbench and centralized transcript service are not prerequisites for local work,
presets, protected online contacts or optional hosting. Billing and usage limits for duang cloud
need measured running costs; `$9/account` is not a committed product price.
