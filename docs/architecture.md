# Architecture

Which process owns what, and where the boundaries are. [Product design](design.md) defines the
experience and [README.md](../README.md) defines delivery stages. The local process below exists;
**all remote, sharing and hosting boundaries are plans, not implemented or verified behavior.**
See [Week 1 acceptance](../README.md#week-1-acceptance-status) for local limits.

## Processes

```text
Electron renderer ── typed preload ── Electron main ── local FastAgent (in-process)
                                         │
                                         └── planned HTTP/SSE ── protected endpoint
                                                                  │
                                         owned self-host or optional duang cloud FastAgent
                                         (its own sessions, routines and channel adapters)
```

The renderer has `contextIsolation` on and no Node integration. It never gets arbitrary filesystem,
IPC, shell or credential access. Main owns the local runtime, directory reads and future remote
connections. FastAgent owns sessions at each location. A visitor's protected remote endpoint must
not grant direct access to another visitor's sessions. Optional hosting will operate deployments;
it need not proxy every conversation or own a transcript.

## The client

**Main owns every `SessionControl`.** Local agents get an agent plus its control plane from
`createPiAgentFromDir` in `@fastagent-sh/fastagent/pi`; a future remote connection uses FastAgent's
public `connectAgent` and `connectSessionControl`, subject to the endpoint's `capabilities()`.
Local turns use `agent.invoke`; observing, steering, stopping and reading history use the bound
session control. Pin a tested FastAgent revision before consuming newer remote APIs: the current
pinned version and upstream differ in authentication, invoke paths and routines.

**The preload exposes typed, named operations**, not a stringly-typed gateway. Week 1 exposes only
the operations the local UI uses. Main forwards `events()` on one IPC channel with an agent,
session and subscription id. Stale subscriptions cannot replace the current view. Idle subscriptions
close on navigation; running conversations retain theirs until settlement, so switching away does
not lose streamed output. Reloading or destroying the window closes its subscriptions, not its runs.

**Plan usage is read in main.** For an OAuth login of `anthropic` or `openai-codex`, main takes the
token from FastAgent's public `createPiModels({ authPath }).getAuth(provider)` (which refreshes an
expired login under the credential file's lock, as a run would) and calls the provider's own usage
route. Neither route is documented; an unexpected shape is an error, not zero. The renderer
receives window percentages and reset times only.

**Credential-file selection is application-scoped.** The picker and all assemblies receive the
same explicit `authPath`; it is never chosen from an agent default or a cached provider probe.
FastAgent resolves credentials for the actual session model and owns OAuth refresh/writeback.
The renderer receives model specs and the selected path, never credential contents. See the
[credential policy](../README.md#run-it) for defaults and explicit overrides.

**Planned: duang's own credential file.** The picker, every assembly, plan usage and sign-in
will use `userData/auth.json` instead of FastAgent's global store, and `FASTAGENT_AUTH_PATH` will
no longer redirect it. Only one file is read: no fallback to the CLI's or pi's store, because one
OAuth grant in two files is invalidated by whichever refreshes first. Provider environment
variables still apply when the file has no credential for a provider. The file is plain JSON
(`0600`); OS-backed storage needs a pluggable credential store in FastAgent
([fastagent#652](https://github.com/fastagent-sh/fastagent/issues/652)).

**Planned: sign-in runs in main.** Main calls FastAgent's public login entry point
([fastagent#602](https://github.com/fastagent-sh/fastagent/issues/602)) with that same `authPath`
and relays each prompt and event to the renderer over typed IPC, one flow at a time; cancel and
window destruction abort it, which also closes the provider's local callback server. A secret
travels from renderer to main once, as an answer; no message from main to the renderer carries
credential contents. Browser and verification URLs open with `shell.openExternal` after an
`https:` (or loopback `http:`) check, never in an app window. Custom endpoints come after the first
version; where their definitions are written is open (see [design](design.md)). Whatever the file,
duang never writes an entry for a built-in provider id: a `baseUrl` override there would outlive the
credential it was entered with and send a later subscription token or official key to the relay.

**One network route, owned by Chromium.** Node's `fetch` ignores the system proxy, and a
proxy read once at startup misses a VPN client switched on later, PAC rules and the system bypass
list. Main therefore installs an undici dispatcher that asks `session.resolveProxy(url)` for each
new connection and maps the answer (`DIRECT`, `PROXY`, `HTTPS`, `SOCKS5`) to undici agents; the
Network setting only changes the session's proxy configuration (`system`, fixed rules, or
`direct`), and proxy variables present at launch are translated into the same configuration. A
spike on macOS with Clash Verge in system-proxy mode confirmed that `resolveProxy` returns the
proxy for provider hosts and `DIRECT` for loopback, private ranges and `.local`, and that a Node
`fetch` without it reached Anthropic directly and got HTTP 403. With the dispatcher installed, a
real Codex run streamed through Clash and its `bash` tool saw the proxy variables; a proxy that is
not listening fails the page's connection check with `ECONNREFUSED` and the proxy's address; the
same check reached Anthropic through Clash's SOCKS5 port. Picking up a
system proxy switched while duang runs is expected from Chromium's configuration watcher, and the
dispatcher asks per request, but switching one was not tested. Only the first entry of a PAC list
is used, and proxy authentication is unsupported until a real user needs it: Chromium's route answer
(`PROXY h:p`) carries no credentials. A launch variable with a user name or password therefore fails
every request with that explanation instead of the proxy's bare 407; before this route existed,
undici read such credentials from `HTTPS_PROXY` directly, so that launch is a regression.

Agent commands cannot use the dispatcher: pi's shell tool spawns with `getShellEnv()`, a copy of
`process.env` taken at each spawn, so the only lever is main's own `process.env`, shared by every
agent in the process (matching the one app-wide Network setting). When the route is not direct and
no proxy variables came from the launch environment, main sets `HTTPS_PROXY`, `HTTP_PROXY` and
`ALL_PROXY` to the proxy `resolveProxy` returns for `https://github.com`, the host agent commands
most often need, and `NO_PROXY` to `localhost,127.0.0.1,::1`; *Manual* sets the manual URL and
*Off* removes the variables duang set. This is re-applied before every send, so a run's commands
see the route as it is when the run starts; a running command
keeps its environment. `resolveProxy` answers one URL, not a bypass list, so per-host PAC rules and
the system bypass list beyond loopback do not reach child processes: a private-range or `.local`
host reached by a command goes through the proxy. Launch-environment variables are left untouched.

**Runtime replacement is agent-scoped.** Changing a default model prepares a new assembly and
updates the selected session before committing the registry choice. Admission is guarded across
all conversations, including turns still opening their runtime: no model replacement or removal
while a send is in flight. The exclusion is asymmetric — a send arriving during a change is
refused, because running it would use a model the person never saw, while a read waits for the
change and receives the runtime that replaced the old one. Failed assembly setup keeps the previous assembly and registry choice. Updating the session and
registry is not a cross-file transaction; a registry write failure after a session update can leave
the conversation model changed without changing the default. This still needs acceptance work.

**Renderer state is a plain TS store read through `useSyncExternalStore`.** No state library: the
authoritative state lives in the runtime and is re-read (`state()`, `entries()`) rather than
derived from our own writes.

**The client persists almost nothing** — `userData/agents.json`: currently each agent's id, name,
directory and optional model override. Reads validate the file; only a missing file means an empty
registry. Writes serialize read/modify/rename, so concurrent changes do not lose rows and a failed
write never publishes an in-memory success. Conversations remain the runtime's files. The renderer
persists drafts and selection in localStorage (a drafts value it cannot read is moved to
`duang.drafts.unreadable` and reported, never overwritten); live output and attention marks are presentation
state, not a second durable transcript. Remote contacts and credentials are future work: never
store access tokens alongside contact metadata; use OS-backed secure storage for secrets. Model
credentials are not duang's: they stay in FastAgent's credential file. Planned app preferences
(the network mode) live in `userData/settings.json`, validated on read; an unreadable file is an
error, not a first run.

`ponytail:` one JSON file with atomic writes; move to SQLite when a list of agents stops fitting in
memory, which is not a real horizon for this product.

## Portable definitions and online contacts (planned)

A preset carries only reviewed, portable agent definition content; importing creates a separate
owner and separate runtime state. Do not package local `.secrets`, `.env`, session state, `.git`,
`node_modules` or unrelated project files. The recipient supplies their own model and service
credentials. An online invitation instead points to the owner's existing runtime. An individual
revocable invite may initially mean "anyone holding this link"; it must not claim to identify a
named person. If named recipients are required, add authentication before making that promise.

A protected endpoint must enforce the invite boundary on **both** `POST /invoke` and `/control/*`.
Newer FastAgent has no built-in control token; the older pinned contract's
`FASTAGENT_CONTROL_TOKEN` is not a future access design. A raw deployment-wide
`SessionControl.sessions.list()` enumerates everyone's sessions, so a shared host must scope reads,
writes and events to the visitor's own sessions without storing a second transcript. Owner-only
routines, definition updates and deployment controls must not be exposed through a visitor invite.
The concrete host-side access boundary needs a tested design at stage 3, not a client-only filter.

Each location owns its own session store: local history stays local, online history stays with its
host, and channel group history does not become a private desktop conversation. The renderer owns
drafts and selection (currently keyed by local agent and session); online contacts must also key
them by location and reject late events from superseded subscriptions. Main owns runtimes and
subscriptions and forwards events with their origin identifiers. A disconnect leaves execution status unknown until the runtime is consulted; never
reissue accepted work merely to restore a stream.

## Online execution and routines

**Planned.** Stage 3 connects to an already-running, protected instance owned by the user. Stage 4 offers a
hosted alternative: publish a reviewed definition snapshot, set required model/channel secrets on
the host, provision durable runtime state, and provide update and stop controls. The desktop can
close without stopping online turns or routines. Owner-hosted agents do not depend on our hosting
service; duang cloud needs only deployment and access metadata, not a centralized chat store.
Do not claim a specific Fly topology, sign-in provider or price before verifying the hosting path.

A clock must remain available while the owner's laptop is off. On Fly, the safe first configuration
for a cron routine is a resident machine; the current upstream plan keeps one running when required.
A sleeping machine cannot wake itself for its own cron. Newer upstream provides `GET /routines`
(names, cron and timezone, not outcomes) and `POST /run` (run by name), but `POST /run` is **not** a
clock or a slot-claim protocol. A future external scheduler needs demonstrated delivery,
authorization, deduplication and honest failure/skip reporting before reducing residency. Some
routines may need residency for reasons other than cron. The older pinned FastAgent contract and
newer upstream use different route and routine names; bump and verify the pin with the feature that
consumes it, without modifying a developer's existing sibling checkout.

If a host cannot provide a recent routine outcome through the runtime's sessions, claim records or
host telemetry, show "outcome unavailable" rather than infer success from `GET /routines`. A
successful send or run admission is not a successful outcome. Never auto-replay a routine whose
work may already have happened. These are data-integrity constraints, not an enterprise audit UI.

## State ownership

| State | Owner | Boundary |
|---|---|---|
| Definition / preset | author's directory / recipient's independent imported directory | Only reviewed portable content travels. |
| Local conversations | FastAgent local state root | Already implemented; not uploaded on publish. |
| Online and channel conversations | FastAgent on the owner-controlled host | Access-scoped per visitor or channel, no second client transcript. |
| Invitation and endpoint access | host-side protection, with optional hosting metadata | Revocable; do not put secrets in a public URL without labeling its bearer semantics. |
| Model and channel credentials | each runtime's credential store or host secrets; planned for local agents: duang's own `userData/auth.json` | Never copy an OAuth login between stores or into a remote deployment. |
| Machine model endpoints (planned) | machine-level FastAgent models file | Local to this machine; not part of a preset or deployment. |
| App preferences (planned) | `userData/settings.json` | Network mode only; never credentials. |
| Routine definition and execution | agent definition + running host and clock | Display only verified schedule and outcomes. |
| Drafts and attention markers | the client | Drafts persist locally; markers are presentation state. |

No universal message database, enterprise membership/approval/audit system, web workbench, social
network or native group router is needed for the first four stages. A native group would require
sender attribution and shared-session semantics that today's `SessionControl` does not expose;
existing FastAgent channel groups remain the first group path. Full-process sandboxing and general
exactly-once execution are not shipped by FastAgent: untrusted use of powerful tools needs separate
isolation before being offered.
