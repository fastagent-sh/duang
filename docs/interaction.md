# Interaction

Every state of the core chain — add an agent, pick a model, open a conversation, say something,
watch it run — and what the app shows in each. `docs/design.md` says what the surfaces are; this
says how they should behave. This is the requirement; see
[acceptance status](../README.md#week-1-acceptance-status) for what Week 1 actually shipped and the
limitations it was accepted with.

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

Three columns, each full height. The conversation list and transcript scroll independently. Once
messages exist the composer is pinned to the bottom; an empty conversation centers it as described
below. Setup errors replace the conversation area. The model picker floats above its composer chip.

## Agents

The rail shows initials; the list header shows the real name and a revealable directory path.
The model is shown on the composer chip. A pulsing rail dot identifies an agent with a running turn; every dot also names its state in words,
so the colour is a shortcut rather than the only telling.

Setup has four states, and the rail dot says which:

| State | Rail | The conversation area shows |
|---|---|---|
| ready | accent when selected | conversations |
| needs a model | amber dot | the new-conversation screen, with the chip's list already open |
| holds no agent yet | amber dot | what duang would write, and a button to write it |
| broken (not an agent directory, unreadable) | red dot | the reason, verbatim, with *Remove* and *Reveal in Finder* |

**A broken agent must always be removable.** Adding the wrong directory is the most likely first
mistake, and an app that cannot undo it is stuck.

Changing the model moves the open conversation onto it and makes it the default for conversations
started later. Other existing conversations keep the model they recorded.

The composer chip changes the model, the directory path reveals it in Finder, and *Remove agent*
is always available below the conversation list. Removing asks once and removes only duang's row;
the directory is never touched. Model changes and removal are refused while any conversation of
that agent is running, including a background one.

## Conversations

`+` mints a new conversation; it appears immediately as *New conversation* in italics and becomes a
real row with a preview once the first turn settles. Selecting one loads its history.

Each row: name or preview, relative time. Hovering or keyboard focus reveals delete; deleting asks
once. A first turn not yet listed by the runtime remains selectable as *Running conversation* when
you switch away. A refused deletion keeps its subscription and history intact.

Empty states, in the conversation area:

- no agents at all: what duang is, and one button — *Add an agent directory*, plus the
  `fastagent init` line for someone who has none;
- agent ready, nothing selected: *New conversation*;
- conversation open, no messages: the composer's placeholder carries it, nothing else.

## Composer

A card, not a strip: the workspace path on top, the input in the middle, and the model chip at the
foot. **The model belongs to the next message, so it lives where the message is written** — not in a
settings screen. Clicking the chip floats the list above it; that is the only model picker.
It shows the credential-file path and lists configured providers without refreshing OAuth. An empty
list explains how to log in to that file and offers Retry; configuration does not guarantee that a
provider will accept the next request. See the [credential policy](../README.md#run-it).

A conversation nobody has spoken in yet has no transcript to sit under, so the composer *is* the
screen: centred, under *What should we work on in ‹agent›?*. It drops to the foot of the window as
soon as the first message lands.

The textarea grows to eight lines, then scrolls. **Enter sends, Shift+Enter breaks the line**, and
Enter during IME composition picks a candidate instead. It is never disabled silently: when it
cannot send, the placeholder says why (*pick a model to start*, *this agent is broken*).

While a run is live the placeholder becomes *steer the run…*, the composer shows Stop where Send was,
and queued input shows as a count. Sending still works — that is the point of steering. Drafts
stay with their conversation while navigating; they are not persisted across app restarts.
A send refused before admission returns to the draft and does not appear as a delivered message.

## Window and quit

Closing a window does not stop a running turn — the runtime lives in the main process. Quitting with
active work warns that execution will be interrupted, and can be cancelled. Nothing resumes a run
automatically afterwards.

Stopping, and being interrupted by a quit, end the *run*. They do not undo what its tools already
did: a file written or a command executed stays that way, and a tool that cannot be cancelled runs
to its own end. The stop warning says so rather than implying a rollback.

## Keyboard

| Key | Does |
|---|---|
| Enter | send |
| Shift+Enter | newline |
| ⌘N | new conversation |
| Esc | dismiss the model picker or command completion first; otherwise stop the running turn |

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
