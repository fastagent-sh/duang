# Architecture

Which process owns what, and where the boundaries are. `docs/design.md` is the product;
`README.md` is the positioning.

## Processes

```
┌─ Desktop app ──────────────────────────────┐
│  renderer (React)     no node, no fs        │
│      │ preload: a typed mirror of           │
│      │ SessionControl + one event channel   │
│  main (Node 22.20 via Electron >= 38.3)     │
│      ├── createPiSessionControl({ dir })  ← local agents, in-process
│      ├── remote SessionControl (HTTP+SSE) ← cloud agents
│      ├── the filesystem: agent dirs, git, diffs
│      └── OS notifications
└─────────────────────────────────────────────┘
        │ HTTPS
┌─ Control service (Fly, one Node process) ──┐
│   accounts · agents · deployments (SQLite)  │
│   deploy pipeline (flyctl)                  │
│   cron: holds every agent's schedule        │
└─────────────────────────────────────────────┘
        │ flyctl / HTTPS
┌─ Agent machines (our Fly org) ─────────────┐
│   one suspended microVM per deployed agent  │
│   /control · /telegram · volume at /data    │
└─────────────────────────────────────────────┘
```

Trust: the renderer runs with `contextIsolation` on and no node integration. It never holds a
directory path it can act on, a Fly token, or a model key — it asks main, and main decides.

## The client

**Main owns every `SessionControl`.** Local agents get `createPiSessionControl` from
`@fastagent-sh/fastagent/pi`; cloud agents get the HTTP+SSE implementation. Both satisfy the same
interface, so the code above them is one path.

**The preload mirrors that interface method for method** — twelve functions, written once by hand,
no stringly-typed gateway. Event streams are different in kind: main subscribes to `events()` once
per open conversation and forwards frames on a single IPC channel keyed by `(agentId, sessionId)`;
the renderer folds them into its view.

**Renderer state is a plain TS store read through `useSyncExternalStore`.** No state library: the
authoritative state lives in the runtime and is re-read (`state()`, `entries()`) rather than
derived from our own writes.

**The client persists almost nothing** — `userData/agents.json`: for each agent a name, avatar,
directory, optional deployment endpoint, and the last-seen marker per conversation that makes
unread work. Conversations themselves are the runtime's files, not ours. Tokens go in Electron
`safeStorage`, not that file.

`ponytail:` one JSON file with atomic writes; move to SQLite when a list of agents stops fitting in
memory, which is not a real horizon for this product.

## The control service

One Node process, one SQLite file (`node:sqlite`, stdlib), no queue, no worker, no registry.

| Route | Does |
|---|---|
| `POST /auth/device` | GitHub device flow; issues the duang token the client stores |
| `POST /agents/:id/deploy` | accepts a tarball, runs the pipeline, streams the log |
| `POST /agents/:id/pause` `DELETE /agents/:id` | suspend + unregister webhook; destroy |
| `GET /agents` | the account's deployments — never proxies agent conversations |

`ponytail:` deploys run flyctl in-process, serialized. A table of pending jobs and two workers when
the queue is visibly slow, not before.

**Secrets never land in our database.** The model API key and channel tokens go from the wizard
straight to `fly secrets set` on that agent's app; what SQLite holds is the deployment's URL and
its generated `FASTAGENT_CONTROL_TOKEN`, because the client needs those to talk to the agent at
all.

## Deploy pipeline

1. The client tars the agent directory, excluding `.git`, `node_modules`, `.env` and the session
   state root. Excluding state is not an optimisation: local conversations are not the cloud
   agent's conversations, and the upload rule is what enforces that.
2. The control service unpacks it, calls FastAgent's `planFlyDeploy` to write `fly.toml` with
   `min_machines_running = 0` and `auto_stop_machines = "suspend"`, sets secrets, and runs
   `deployFlyRun` in our Fly org.
3. On success it records URL + control token, registers the Telegram webhook with FastAgent's own
   `register-webhook` (which already distinguishes "still warming up" from "misconfigured"), and
   reads the directory's schedules with FastAgent's schedule discovery into its own cron table.
4. Redeploy is the same path; Fly secrets survive it.

## The cron waker, and the one upstream change

A suspended microVM cannot wake itself for a cron instant — this is exactly why FastAgent's
`fly/plan.ts` pins `min_machines_running = 1` when schedules exist. The control service is awake
anyway, so it holds the cron and POSTs the due slot, which resumes the machine.

FastAgent already has both halves: `SchedulerOptions.externalClock` (external delivery owns the
timers, with slot claim/settle making a double fire impossible) and an HTTP envelope
`{ name, slot }` → `fireScheduleOnce`. The envelope only exists on the AgentCore path
(`src/channels/agentcore.ts`); the standard serving path has no such route. Generalising it is the
single change duang needs upstream, filed as
[fastagent#557](https://github.com/fastagent-sh/fastagent/issues/557). Until it lands, scheduled
agents deploy with a machine kept up and cost real money.

## Who owns what

| State | Owner | Notes |
|---|---|---|
| Agent definition | the directory on your disk | the only editable source of truth |
| Local conversations | FastAgent's state root, locally | client never copies them |
| Cloud conversations | the agent's Fly volume at `/data` | survives suspend and redeploy |
| Deployment URL + control token | control service SQLite, mirrored in `safeStorage` | |
| Model keys, channel tokens | Fly secrets only | never in our database |
| Schedules | the directory; mirrored as timers in the control service | |
| Unread marks | the client | per machine, deliberately |

## Not built

No message store, no sync engine, no CRDT, no websocket server, no push service, no job queue, no
build worker, no OCI registry, no multi-region, no autoscaler, no quota engine. Logs are Fly's,
proxied. Each of these returns when a specific limit is hit, and the limit is named where the
shortcut is taken.
