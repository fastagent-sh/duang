# Product design

What the app is made of, what it shows, and what happens when. `README.md` carries the positioning
and the infrastructure decisions; this file is the product.

This document includes the roadmap, not only shipped behavior. Week 1 is local-only and accepted;
see [acceptance status](../README.md#week-1-acceptance-status) for the scope it covers and the
limitations it was accepted with.

## Objects

Five, and no more.

| Object | Is | Lives |
|---|---|---|
| **Agent** | a directory, given a name and an avatar | client, one row per agent |
| **Conversation** | a FastAgent session | inside the agent's runtime, not in our store |
| **Run** | one turn of a conversation | transient, projected from the event stream |
| **Deployment** | this agent's cloud copy: URL, token, channels | control service |
| **Account** | who pays; exists only because the cloud does | control service |

The roadmap gives an agent **two places**: the local directory, and its cloud copy. They do not
share conversations, because a cloud agent has neither your files nor your history. A future
`Local | Cloud` switch will keep those lists separate; the current client is local-only.

Notably absent: message, thread, group, membership, invite. Conversations are read from the runtime
(`sessions.list()`, `entries()`); the client stores no transcript of its own.

## Screens

The shipped layout has two columns: a single 320px sidebar combining agents and their
conversations, and the open conversation. Geometry and interaction details live in
[the design system](ui.md#3-structure).

```
┌ sidebar · 320px ──────────┐  ┌ conversation ──────────────────────┐
│ duang                 +   │  │ floating header: agent · title     │
│                           │  │                                    │
│ ▾ Agent A                 │  │ user / assistant / thinking        │
│     yesterday's fix       │  │ tool calls                         │
│     another conversation  │  │                                    │
│     + New conversation    │  │                                    │
│ ▸ Agent B                 │  │ floating composer · model · send   │
└───────────────────────────┘  └────────────────────────────────────┘
```

**Sidebar** — one row per agent, with presence and setup failures shown on that row. Conversations
appear beneath an agent when explicitly expanded; opening an agent does not automatically expand
its list. There is no separate agent rail or conversation-list column.

**Planned additions** — `Local | Cloud` in the sidebar header (Week 3), a pinned **Activity** row
above the agents (Week 4), and a right-hand panel for files, diffs and discovered settings (Week 2).
None of these surfaces is present in the current client.

**Activity (planned)** is every cloud agent's conversations merged and sorted by `updatedAt` — the inbox for
work that happened without you. Unread is a local comparison of `updatedAt`/`messageCount` against
what this machine last displayed. No server, no push, no new data source.

**Activity does not poll.** A cloud agent is a suspended microVM, and any HTTP request resumes it —
polling every agent on a timer would undo scale-to-zero and cost more than keeping them up. So the
list refreshes when you open an agent, and shows *last synced* instead of pretending to be live.
When live matters, the fix is the already-awake control service: agents post "session X updated"
at the end of a turn and clients subscribe to that. Not built — it needs a reporting hook in every
deployment.

Notifications are OS notifications from the main process, and only for the three things Telegram
cannot already show you: a schedule failed, a deploy finished or failed, an agent crashed. The
agent's actual work arrives in a Telegram group, which already pushes to your phone; duplicating
that is how you end up building a push service for no gain.

**Conversation rows** — nested under their agent in the sidebar, using `SessionSummary` names
or previews and relative `updatedAt`. Badges for channel or schedule origin are planned with
cloud conversations.

**Conversation** — the transcript, and the only screen with real density:

- entries rendered by kind: user, assistant text, thinking (collapsed), tool call (collapsed to one
  line, expandable to args and result);
- header: conversation name, model picker, thinking level, context meter and cost from
  `SessionState.usage`, compact;
- while a run is live: the composer steers instead of prompting, an Abort button appears, and
  queued items show `state.pending`. **The place decides this, not the surface.** Steering is right
  where one person can see the run and owns its intent — a local conversation. A channel-born
  conversation has neither: the live run belongs to someone else's message in a group, so a message
  typed here queues (`followUp`) instead of folding into their turn. This is why FastAgent's own
  chat channels queue and pi's interactive mode steers; both are correct for their place;
- fork lives on the message it forks from; a message with siblings shows `1/2` and switches with
  `update({ leafEntryId })`.

**Agent settings** — the directory path, the model, and read-only lists of what FastAgent
discovered there (skills, tools, schedules). Nothing here is editable in the app: the directory is
the source of truth, and an editor for it is a code editor's job. Below that, the cloud block:
deploy, or the deployment's URL, channels, redeploy, pause, delete.

**Files** (local agents only) — the agent's directory as a tree, with git status and diffs, read
straight off disk. Absent for cloud agents, because there is nothing of yours to show.

## Visual direction and stack

The design system is [docs/ui.md](ui.md): a messaging register on the outside and a developer tool
where the content demands it, violet accent, light and dark, Inter paired with PingFang SC, Phosphor
icons. This section covers only the stack those choices are built on.

Two rendering dependencies, no component library:

- **Tailwind v4**, CSS-first (`@theme`), which is where the ecosystem settled;
- **streamdown** for markdown, because the hard case is rendering *incomplete* markdown mid-stream
  without flicker.

The model picker uses Chromium's native `<dialog>` for focus trapping, Escape and focus restoration,
positioned above the composer chip. Add Base UI only when a required overlay exceeds those native
behaviors. Plus `@phosphor-icons/react` for icons. No shadcn: it generates files you then maintain, in a generic SaaS
register we would spend the whole project overriding. (MonoCode reached the same conclusion — its
dependency list has no component library at all.)

macOS gets `titleBarStyle: "hiddenInset"` and `vibrancy: "sidebar"` — native texture for free,
rather than simulating glass. Skipped: CodeMirror and syntax highlighting; a diff is coloured lines
until that visibly hurts.

## Flows

**First run.** No agents. One button: *Add agent* → pick a directory (or scaffold one via
`fastagent init`) → the app reads the definition and shows the name it found → first message.

**Local conversation.** Type, stream, watch tools. Turns use `agent.invoke`; observation and run controls use the `SessionControl` returned by
in-process `createPiAgentFromDir`. `/` completes names from `commands()`, which is a listing and not
an invocation surface: nothing expands `/name`, so the line is sent as written and the agent decides
what to do with it. Naming one of its own skills is a strong hint, not a command.

**Going live.** *Deploy* on an agent, four steps, each one able to fail out loud:

1. sign in to duang cloud (GitHub device flow);
2. paste a model API key — with the reason stated: a server cannot use your Claude/Codex
   subscription OAuth;
3. paste a Telegram bot token, or skip and get an HTTP endpoint only;
4. deploy, streaming the real log; on success, the URL and one instruction: add the bot to a group
   and @ it.

**After it's live.** Work arrives in Activity. Opening a channel conversation shows the full
transcript and tool trace. You can prompt into it — and the app states plainly that your message
continues the context **but is not sent to the Telegram group**: replies to a group are the
channel's job, and `/control` does not go through the channel. Taking over means reading and asking
privately, not speaking as the bot.

**Changing an agent.** Edit the directory in your editor, chat locally to test, press *Redeploy*.
One button, same upload path.

**Stopping.** Pause suspends the deployment and unregisters the webhook; delete removes the Fly app
and the deployment row. Both say what they will destroy before doing it.

## Failure, visibly

Every one of these shows the original error text and a retry, never a generic "something went
wrong":

- Telegram `setWebhook` cannot reach the new URL (FastAgent already distinguishes "still warming
  up" from "misconfigured");
- the Fly deploy fails mid-way;
- the model key is rejected on the first turn;
- a cloud agent is unreachable — the conversation goes read-only with the reason, and a composer
  keeps its text rather than swallowing it;
- a run fails or is aborted: rendered as a settled outcome in the transcript, not a toast that
  disappears.

## Not built

No approvals or permission prompts: agents run pre-authorized by their directory (also why there is
no suspended-run state). No remote file browsing. No agent editor. No multi-person groups, invites,
or memberships — group chat happens in Telegram. No web or mobile client. No notification server.

## MVP order

Week 1 aims to close the local conversation loop: setup, model choice, streaming text and tool traces,
steering, stop, history, safe navigation and visible failures. Week 2 adds files/diffs, discovered
settings and remaining conversation controls. Week 3 adds manually configured remote endpoints;
weeks 4–5 add hosted Deploy and Activity. The cloud switch stays absent until a real remote exists.
