# Interaction

Every state of the core chain — add an agent, pick a model, open a conversation, say something,
watch it run — and what the app shows in each. `docs/design.md` says what the surfaces are; this
says how they behave.

## Layout

```
┌ rail 56 ┬ list 240 ─────────┬ conversation ──────────────┐
│ agents  │ agent name    [+] │ title        model    stop │
│         │ model · state     ├────────────────────────────┤
│  [+]    ├───────────────────┤ transcript (scrolls)       │
│         │ conversations     ├────────────────────────────┤
│         │                   │ composer                   │
└─────────┴───────────────────┴────────────────────────────┘
```

Three columns, each full height. The transcript is the only region that scrolls; the composer is
pinned to the bottom and never moves. Every panel that replaces the transcript (an error, the model
picker, an empty state) occupies exactly the transcript's box, so the composer stays put.

## Agents

The rail shows initials; the list column's header shows the real name, the model, and a menu.

An agent is in one of three states, and the rail dot says which:

| State | Rail | The conversation area shows |
|---|---|---|
| ready | accent when selected | conversations |
| needs a model | amber dot | the model picker |
| broken (not an agent directory, unreadable) | red dot | the reason, verbatim, with *Remove* and *Reveal in Finder* |

**A broken agent must always be removable.** Adding the wrong directory is the most likely first
mistake, and an app that cannot undo it is stuck.

The header menu offers: change model, reveal in Finder, remove agent. Removing asks once, and
removes only duang's row — the directory is never touched.

## Conversations

`+` mints a new conversation; it appears immediately as *New conversation* in italics and becomes a
real row with a preview once the first turn settles. Selecting one loads its history.

Each row: name or preview, relative time. Hovering reveals delete; deleting asks once.

Empty states, in the conversation area:

- no agents at all: what duang is, and one button — *Add an agent directory*, plus the
  `fastagent init` line for someone who has none;
- agent ready, nothing selected: *New conversation*;
- conversation open, no messages: the composer's placeholder carries it, nothing else.

## Composer

A textarea that grows to six lines, then scrolls. **Enter sends, Shift+Enter breaks the line.** It
is never disabled silently: when it cannot send, the placeholder says why (*pick a model first*,
*this agent is broken*).

While a run is live the placeholder becomes *steer the run…*, the header shows Stop, and queued
input shows as a count. Sending still works — that is the point of steering.

## Keyboard

| Key | Does |
|---|---|
| Enter | send |
| Shift+Enter | newline |
| ⌘N | new conversation |
| Esc | stop the running turn |

## Scrolling

The transcript follows the bottom while new content streams, unless the person scrolled up — then
it stays where they left it until they return to the bottom. No scroll-to-bottom button until that
proves annoying.

## Failure

Errors appear where the thing that failed was, never as a toast that vanishes:

- opening an agent: in the conversation area, with the actions that fix it;
- a send, an abort, a delete: as a line in the transcript, in the failure colour;
- a failed or aborted run: a settled line in the transcript, not a banner.

The original message is always shown as the runtime wrote it. duang never paraphrases another
program's error.
