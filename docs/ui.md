# Interface design

What duang looks like and why. `docs/interaction.md` says how the app must behave; this says how it
should read. Where the two disagree, behaviour wins and this file is wrong.

A Chinese translation lives in [`ui.zh.md`](ui.zh.md) for reading convenience. This file is the
source of truth: change it first, then the translation.

## 0. What the product actually asks of the interface

Every decision below is derived from five facts about duang, not from what other products do.

1. **The person is a developer who already has an agent working for other people.** Not a consumer
   trying an assistant.
2. **The local half exists so you can take over.** README: when the deployed agent misbehaves you
   "open the same chat, read the full tool trace, and take over". The first job of this interface is
   reading what an agent did and intervening — oversight, not company.
3. **The two sides of a conversation are wildly asymmetric.** What you type is short and rare: a
   task, a correction, a stop. What the agent produces is long, structured and the thing you scan —
   commands, output, diffs, reports.
4. **Work runs in the background, in parallel, for a long time.** You come back to it as often as you
   watch it, and you need to see which of several conversations is alive.
5. **The transcript is the work record.** Later weeks add a read-only workspace panel and a cloud
   activity inbox, but nothing moves the agent's working detail out of the transcript.

Two consequences worth stating before the details. Anything that fragments the agent's output
(bubbles, cards per paragraph, decoration) fights fact 3 and fact 5. Anything that hides parallel
work to keep the list tidy fights fact 4.

Written after walking the Week 1 acceptance matrix, where every individual signal was truthful and
the whole still read badly. The fixes for that are here, not in another round of patches
([#41](https://github.com/fastagent-sh/duang/issues/41),
[#42](https://github.com/fastagent-sh/duang/issues/42)).

## 1. Three principles

**An agent is a contact; a conversation is a topic.** The default view is a roster of who you work
with and what they last said. Several conversations per agent are real and never hidden, but they
stay folded until you want them.

**Glass belongs to navigation, never to content.** The sidebar is a vibrancy material; the
transcript is opaque. This is macOS 26's own rule and it is also what keeps long text readable.

**Say status only when it costs the person something.** Not every state deserves an indicator.
Details in §9.

## 2. References and what was taken from each

Borrowing a solution means borrowing its premise. Each of these is listed with the premise that
made it work there, and whether that premise holds here.

- **Grok Bot** (desktop, and xAI's design write-up) — taken: agents as the primary object rather
  than a chat history; system events and structured results sharing one timeline with conversation;
  removing controls rather than adding them.
  **Refused, with reasons:** *bubbles on both sides* — their premise is that the heavy work lives on
  the Bot's own computer panel, so the transcript carries short reports; ours is fact 5, where the
  transcript is the work. *An avatar that performs a lifecycle* — their premise is one
  conversation per Bot plus an expressive character to animate; ours is a lettered tile and parallel
  conversations, so the avatar carries agent presence as a quiet ring while the conversation rows say
  which one is running. *Status / preview / takeover* — their premise is a machine you can only
  watch through a screen; our files are on this disk and already open in the person's editor. *Pin
  and hide* — their premise is a roster of up to 50 Bots; ours is the few agents you actually have.
- **Claude Code desktop** — parallel sessions stay visible and are filterable by state, because
  parallel work is the normal case for a coding agent. Same premise as our fact 4.
- **Telegram** — the row rhythm of a contact list: avatar, name, one line of what happened, relative
  time. Refused: the assumption that a contact has exactly one thread.
- **Carbon, HPE design systems, WCAG 1.4.1** — the status rules in §9.
- **macOS 26** — glass only in the navigation layer, sidebars to the window edge, native materials
  over simulated ones.

## 3. Structure

Two columns. Later weeks add a third and two sidebar elements; their space is reserved now so nothing
has to move when they arrive.

```
┌ sidebar 320 (glass) ───────────┬ conversation ──────────────┬ (week 2) ┐
│ duang·              ⌘K    ＋   │  title        model ⌄   ⏹  │  files   │
│ [ local | cloud ]   (week 3)   │                            │  diffs   │
│ ◎ Activity          (week 4)   │  turns                     │  settings│
│ ┌────────────────────────────┐ │                            │          │
│ │ AM  amazonseo.ai       2m  │ │                            │          │
│ │     reading messages/es…   │ │                            │          │
│ │   • fixing the i18n check  │ │                            │          │
│ │     working                │ │                            │          │
│ │   ⌄ 2 more                 │ │                            │          │
│ └────────────────────────────┘ ├────────────────────────────┤          │
│   EX  existing-agent     1h    │  composer                  │          │
│       你好，我是…              │                            │          │
└────────────────────────────────┴────────────────────────────┴──────────┘
```

**Sidebar rows are agents, not conversations** — one row each, with the current conversation's
preview on the second line. An agent with a single conversation shows nothing more than a contact row.

**Running conversations are always listed under their agent**, expanded or not, because fact 4 makes
"what is alive right now" the question the sidebar exists to answer. A conversation holding unsent
text is listed for the same reason. Everything else folds behind `⌄ 2 more`, which expands in place
into indented rows with title, relative time and state.

**Presence is told at two levels, because the sidebar has two questions to answer.** The avatar
carries the agent's own presence: while any of its conversations is working, a slow accent ring
breathes around it, visible whether or not the group is expanded. The agent row states it in words —
`working`, or `2 working` when several are. The conversation rows carry which one: a pulsing dot and
the state word on the specific conversation.

Folded, that is complete: ring plus summary. Expanded, it resolves to the individual conversation.
The ring is never the only signal, so colour is never doing the work alone (§9).

What the avatar does not do is act. Products where the avatar performs a lifecycle — thinking,
waiting, celebrating — have one conversation per agent, an expressive character to animate, and a
consumer's relationship with it. Ours is two letters on a tile representing a directory; a breathing
ring is presence, a performance would be costume.

Reserved, in arrival order: a `local | cloud` segmented control in the sidebar header (week 3), a
pinned **Activity** row above the roster (week 4), and the right panel (week 2) holding the file
tree, diffs and discovered settings. That panel is a **reader**: the files are on this machine and
already open in the person's editor, so duang shows them and stays out of the way instead of building
a workspace to operate.

Not included: pinning, hiding, archiving, folders. They belong to rosters of fifty agents; on a list
of five they are management work invented for its own sake. Add one when a real list stops being
readable.

## 4. Colour

oklch, two modes, following the system. The neutral ramp carries a trace of the accent hue (285) so
violet reads as part of the family rather than applied on top.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `oklch(0.16 0.01 285)` | `oklch(0.98 0.004 285)` | content layer background |
| `surface` | `oklch(0.20 0.012 285)` | `oklch(1 0 0)` | bubbles, cards, popovers |
| `surface-2` | `oklch(0.24 0.014 285)` | `oklch(0.96 0.005 285)` | hover, pressed, nested cards |
| `stroke` | `oklch(0.30 0.012 285)` | `oklch(0.90 0.006 285)` | hairlines, card borders |
| `text` | `oklch(0.95 0.005 285)` | `oklch(0.22 0.01 285)` | body |
| `muted` | `oklch(0.68 0.01 285)` | `oklch(0.50 0.01 285)` | metadata, timestamps |
| `accent` | `oklch(0.72 0.16 295)` | `oklch(0.55 0.19 295)` | selection, primary action, focus |
| `accent-weak` | `accent / 15%` | `accent / 12%` | selected row, user bubble |
| `success` | `oklch(0.72 0.14 150)` | `oklch(0.50 0.14 150)` | tool finished |
| `warning` | `oklch(0.78 0.13 75)` | `oklch(0.58 0.13 75)` | needs a model, no agent yet |
| `danger` | `oklch(0.68 0.17 25)` | `oklch(0.52 0.19 25)` | broken, failed, destructive |

The sidebar has no background colour of its own: it is `vibrancy: "sidebar"` over the window, with
rows drawn in `accent-weak` when selected. Light mode needs the darker, more saturated accent, or it
turns grey on white.

## 5. Typography

```css
--font-sans: Inter, "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", ui-monospace, "PingFang SC", monospace;
```

Chinese is a first-class case, not a fallback accident: Inter carries no CJK, so today every Chinese
string in the app is drawn by whatever the system picks. Pairing Inter with PingFang SC fixes the
mismatch. Chinese text keeps the same size but takes more leading — 1.75 against 1.6 — because CJK
glyphs fill their em box. Do not force CJK into the monospace family; let it fall back to PingFang SC
inside code contexts rather than deforming it.

Five steps, no more:

| Role | Size / line-height / weight |
|---|---|
| Conversation body | 14 / 1.7 / 400 |
| Agent name, section titles | 13.5 / 1.4 / 500 |
| Preview, timestamps, state | 12 / 1.4 / 400, `muted` |
| Code, paths, tool output | 12.5 / 1.6 / 400, mono |
| Badges, labels | 11 / 1 / 500, tracking +0.02em |

Emphasis uses weight, never hue. Body text is never coloured.

## 6. Icons

Phosphor, Regular weight, at 16 (inline), 18 (buttons), 20 (empty states). Bold is reserved for the
current selection and destructive actions, so weight rather than colour marks emphasis. Every icon
carries a label or `aria-label`; icon-only controls exist only where the symbol is universal (send,
stop, close).

## 7. Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32.
- Radius: 6 (badges, small controls), 10 (cards, bubbles, inputs), 14 (popovers, dialogs). A bubble's
  trailing corner drops to 4 — that asymmetry is what makes it read as speech.
- Elevation is value plus a hairline, not shadow. Only popovers get one soft shadow.
- No divider between sidebar and conversation: the material change is the separation.

## 8. Message rendering

The transcript is a work record with two very unequal sides (facts 3 and 5), so the two sides are
drawn differently on purpose.

**What you send is a bubble.** Right aligned, `accent-weak`, max width 560. Your turns are short and
sparse, and their job is to be findable when you scroll back: *what did I ask for, and when did I
change it?* A bubble is a good anchor precisely because it is small and visually distinct.

**What the agent produces is a document.** Left aligned, no bubble, one reading column of 720 (or the
full width minus 48 when the window is narrower than 1000), full markdown. It writes commands, output, plans, diffs and reports; wrapping that in speech balloons
fragments a record that needs to be scanned, and gives up the width its content needs. Products that
bubble both sides keep the heavy work somewhere else — a separate workspace panel — so what remains
in the transcript really is chat. Ours is the work.

Everything else follows from those two:

- **Tool calls are cards** in the document flow: icon, command, and the state immediately after the
  command rather than pushed to the far right where it loses its subject. Expanded, a card shows
  arguments and result; results over twelve lines fold.
- **Thinking** collapses to one muted line (`thinking · 3s`) and expands into a quoted block.
- **System events are one centred muted line**: model changed, run stopped, a send refused. They are
  facts about the session, not things anyone said.
- **A steered message** keeps its bubble and adds an accent rule down its leading edge with the
  label `joined the run`, because after the fact nothing else distinguishes it from a message that
  started one.
- **Streaming** trails a block cursor `▍`, which says "still writing" without a spinner and vanishes
  on settle.
- **Turn spacing** is 24 within a turn and 32 between turns. Long output needs the rhythm more than
  a dense list does.

## 9. Status

Three tiers, decided by what the person has to do about it. Carbon is explicit that an indicator with
no required action should be plain text or nothing; HPE's rule of thumb is that a status carries at
least three of colour, icon, shape and text. Fact 4 adds our own requirement: the person is often
away, so "is it still working" must be answerable from the sidebar without opening anything.

| Tier | States | How it is shown |
|---|---|---|
| **Needs a decision** | broken, needs a model, no agent yet, failed, stopped, refused | Text always, plus icon or shape. Colour is the third signal, never the only one. |
| **Reassurance only** | working, thinking, running | A breathing ring on the agent's avatar, a pulsing dot and the word on the conversation row, elapsed time in the transcript. No sentence in the reading flow. |
| **Nothing to do** | ready, completed | Show nothing. |

One vocabulary everywhere — the same condition must not be `working` in one place and `running` in
another:

`working` · `thinking` · `running` · `done` · `failed` · `stopped` · `refused` · `needs a model` ·
`no agent yet` · `broken`

`refused` and `failed` stay separate on purpose: a refused send never ran, so the text is still the
person's to edit; a failed run did run, and its effects may already exist.

`stopped` is new and required: a tool the person interrupted currently reports `failed`, which blames
the tool for the person's decision.

**Presence is layered, never duplicated.** The avatar answers *is this agent busy at all* with a
breathing ring, the agent row says it in words (`working`, `2 working`), and the conversation rows
answer *which one* with a dot and the state word. Each level adds information the one above cannot
give; none of them repeats the other, and none of them is colour alone.

## 10. Motion

140ms, `cubic-bezier(0.2, 0, 0, 1)`. Four things move: rows expanding and collapsing (180ms),
popovers appearing (opacity plus 4px rise, 120ms), hover backgrounds (100ms), and presence — the
avatar ring and the conversation dot breathing together at 1.8s. Streaming text is not animated — token arrival is the animation, and a
transition on top of it produces jitter. Everything collapses to instant under
`prefers-reduced-motion`.

## 11. Accessibility

Focus ring is `2px accent` at 2px offset, on `:focus-visible` only, and never on text fields, whose
caret and container already say it. Body contrast stays at or above 4.5:1 in both modes. Tab moves
between sidebar, conversation and composer; arrow keys move within each, with the sidebar as a
listbox and one tab stop (WAI-ARIA APG). The transcript is a focusable region so it can be read and
scrolled without a pointer. Status follows §9; no state is colour alone.

## 12. Brand

The product is `duang`, lowercase everywhere — repository, documentation, window, marketing. The
wordmark is the name at weight 600, tracking -0.01em, followed by a single accent dot: `duang·`. The
name is playful enough on its own; the typography does not add to it.

Agent avatars are rounded squares, not circles — circles are people, squares are programs, and the
distinction earns its keep in a product whose whole metaphor is "an agent is a contact". The avatar
shows the first two letters over a background chosen by hashing the name across eight low-saturation
hues. Identity is the tile; presence is the ring around it (§9), never a change to the tile itself,
so an agent looks like the same agent whether it is busy or idle.

## 13. Order of work

1. **Tokens.** Both colour modes, the font stacks, the radius and spacing scales; swap
   `lucide-react` for `@phosphor-icons/react`. No structural change, no behaviour change.
2. **Components.** Buttons (primary, secondary, ghost, danger; heights 28 and 32), badges, cards,
   popovers, composer.
3. **Status.** The single vocabulary, the three tiers, `stopped`, and presence at both levels — the
   avatar ring and the conversation dot.
4. **Sidebar.** Merge rail and list into one 320 glass column: agent rows, running and drafted
   conversations always listed, the rest folded. This one changes navigation, so every smoke
   assertion that locates a control by label has to be re-checked.
5. **Transcript.** User bubbles, the agent's document column, tool cards, centred system events, the
   steering rule, the streaming cursor.
6. **Keyboard.** Roving tabindex, focusable transcript.

Steps 1–3 and 5–6 do not change behaviour and can land with the existing tests. Step 4 does.
