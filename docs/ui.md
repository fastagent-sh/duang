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
- **Telegram** (tdesktop, macOS and Web are all open source, so these are measured values rather than
  impressions) — the row rhythm of a contact list, and two techniques worth copying outright:
  - *Row geometry.* `dialogs.style`: row 62px, padding 10/8, avatar 46px, name at x=68 y=10, preview
    at x=68 y=34, unread badge 19px tall in 12px bold, date 13px. The relationship that matters is
    avatar ≈ ¾ of row height, and text inset = avatar inset + avatar + 12. §3 keeps the relationship
    at a tool's density rather than copying the numbers.
  - *Avatar colours.* `empty_userpic.cpp` picks from eight fixed colours by `order[id % 7]` with
    `order = [0, 7, 4, 1, 6, 3, 5]` — a deliberately shuffled table so that adjacent ids do not get
    adjacent hues. We take the shuffle, not the palette: Telegram's tiles are saturated pastels
    against a neutral UI, and ours sit beside a violet accent, so they stay low in chroma.
  - *Token naming.* `colors.palette` defines every role as a set — `windowBg`, `windowBgOver`,
    `windowBgRipple`, `windowFg`, `windowSubTextFg`, `windowBgActive`, `windowFgActive` — instead of
    letting components derive hover and active states themselves. §4 adopts that discipline.
  Refused: the assumption that a contact has exactly one thread; ripple on row press, which is a
  Material gesture that no macOS app makes; and ordering the list by unread first, since an agent's
  list is ordered by what is happening now.
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

Geometry, holding Telegram's proportions at a tool's density: agent row 56 tall, avatar 40 as a
rounded square with a two-stop gradient in its hue — flat tiles look printed, and the gradient is
most of why Telegram's list feels alive. The open conversation is a filled accent row rather than a
tint, which is the same list's other trick: a selection that answers rather than shades. The second line is the workspace directory, not a message preview:
the directory is what identifies an agent, and the conversations are listed directly below it
anyway. A conversation row is 32 tall, has no avatar, and indents under its agent.

**Opening an agent and listing its conversations are two questions, so they are two controls.**
The row opens the agent and shows what it has been doing; clicking the agent you are already on
puts that list away again. The caret at the row's trailing edge does the same for any agent, which
is the part the row cannot express — it is how a second agent's conversations appear without
leaving the one you are reading. Any number
of agents can be listed at once, and folding one never closes the conversation being read. Opening
an agent lists it too, because you have to see where you are. Which rows are open is a view
preference: it lives in the sidebar and is not remembered across launches.

Listing an agent that is not open loads its conversations, which boots that agent's runtime the same
way opening it would — FastAgent owns the session list and duang will not keep a second copy of
where sessions live.

Selection is the accent, never a grey — grey is what a row looks like under the pointer. The open
agent is the filled row and the conversation on screen is tinted underneath it: the column marks
the group you are working in first, and the topic inside it second. Weight follows the hierarchy of
the list, not the size of the thing selected.

**One flat list, no card per agent.** Full-width rows, a hairline that starts where the text does,
the open conversation filled edge to edge: Telegram, WeChat and Codex all draw a roster this way,
and the reason shows up as soon as two agents are listed — a card per agent turns the column into a
stack of panels and makes an open agent look heavy. A conversation row is one line indented to the
agent's text, with the relative time trailing and Delete in its place on hover, so a topic is
visibly lighter than the agent that owns it.

**An expanded agent lists its conversations**, including one that is running and one holding unsent
text, because fact 4 makes "what is alive right now" the question the sidebar exists to answer. Only
the open agent marks which of them is running or drafted; another agent's list is its history, and
its live work shows on its own row as a breathing ring and the word `working`.

A list that cannot be read says why on that agent's row, and only there: expanding never changes
what the main panel believes about an agent, so folding and expanding the one you are reading cannot
declare the window broken. An empty agent and an agent whose runtime
would not start are not the same answer, and the failure belongs to the agent that was expanded —
never to the transcript being read.

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

**Panels float on the window's canvas.** The sidebar is a rounded card inset from the window edges
rather than a column filling them, and the conversation's header floats over the transcript as a
translucent bar instead of a full-width strip cutting the page in two. This is Telegram's desktop
composition, and its premise holds here: chrome that hovers keeps the content beneath it continuous.
What does not carry over is putting the transcript itself on a decorative canvas — theirs is bubbles
over wallpaper, ours is a document that has to stay readable — so the transcript is opaque and only
the chrome floats, with the transcript padded so nothing important sits under the header.

Reserved, in arrival order: a `local | cloud` segmented control in the sidebar header (week 3), a
pinned **Activity** row above the roster (week 4), and the right panel (week 2) holding the file
tree, diffs and discovered settings. That panel is a **reader**: the files are on this machine and
already open in the person's editor, so duang shows them and stays out of the way instead of building
a workspace to operate.

Removing an agent is not offered by the sidebar at all. A control on the row sat next to the fold
caret, where one slip removes an agent, and a link at the bottom of the column belonged to nothing
in particular. Removal lives where the problem is explained — the panel for a broken agent or a
directory with no agent in it — until there is a menu to put it in.

Not included: pinning, hiding, archiving, folders. They belong to rosters of fifty agents; on a list
of five they are management work invented for its own sake. Add one when a real list stops being
readable.

The window opens at 1280 by 840 — the sidebar plus the reading column and its padding, so a fresh
install starts at the width the transcript was drawn for — and reopens wherever it was left. Size and
position are navigation memory like the selected agent: written best effort, and a window whose
display is gone comes back on an attached one.

## 4. Colour

oklch, two modes, following the system. The neutral ramp is measured from Telegram's macOS dark
theme — small steps, almost no chroma — with one change of relationship: the transcript's canvas is
the darkest layer and every panel sits above it, so a panel reads as lifted rather than as a hole.
Light mode is not that set mirrored. It follows macOS — content white, sidebar grey, as in Finder,
Mail and WeChat — because a white sidebar against grey content reads as a window turned inside out.
The ramp keeps a trace of the accent hue (285) so violet belongs to the family rather than sitting
on top of a grey app.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `oklch(0.225 0.004 285)` | `oklch(0.99 0.001 285)` | the transcript, and the canvas panels sit on |
| `surface` | `oklch(0.27 0.005 285)` | `oklch(0.965 0.003 285)` | bubbles, cards, popovers, composer |
| `sidebar` | `oklch(0.285 0.005 285)` | `oklch(0.955 0.003 285)` | the sidebar panel |
| `surface-2` | `oklch(0.315 0.006 285)` | `oklch(0.93 0.004 285)` | hover, pressed, nested cards |
| `stroke` | `oklch(0.36 0.006 285)` | `oklch(0.89 0.005 285)` | hairlines, card borders |
| `text` | `oklch(0.95 0.005 285)` | `oklch(0.22 0.01 285)` | body |
| `muted` | `oklch(0.68 0.01 285)` | `oklch(0.50 0.01 285)` | metadata, timestamps |
| `accent` | `oklch(0.72 0.16 295)` | `oklch(0.55 0.19 295)` | selection, primary action, focus |
| `accent-weak` | `accent / 15%` | `accent / 12%` | selected row, user bubble |
| `accent-fg` | `oklch(0.16 0.01 285)` | `oklch(1 0 0)` | text on a filled accent surface |
| `success` | `oklch(0.72 0.14 150)` | `oklch(0.50 0.14 150)` | tool finished |
| `warning` | `oklch(0.78 0.13 75)` | `oklch(0.58 0.13 75)` | needs a model, no agent yet |
| `danger` | `oklch(0.68 0.17 25)` | `oklch(0.52 0.19 25)` | broken, failed, destructive |
| `danger-fg` | `oklch(0.16 0.01 285)` | `oklch(1 0 0)` | text on a filled danger surface (Stop) |

Every interactive role is defined as a set, not derived at the call site — Telegram's palette does
this and it is why their themes stay coherent: `bg` / `bg-over` / `bg-active`, `text` / `muted` /
`accent-fg`. A component picks a role; it never computes a hover colour itself.

The sidebar has no background colour of its own: it is `vibrancy: "sidebar"` over the window, with
rows drawn in `accent-weak` when selected. Light mode needs the darker, more saturated accent, or it
turns grey on white.

Avatar tiles use eight fixed low-chroma hues, chosen by `order[hash % 7]` with
`order = [0, 7, 4, 1, 6, 3, 5]`. The shuffle is Telegram's and it exists so that agents registered
one after another do not come out looking alike.

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

## 6b. Controls

Four kinds of button and no fifth. `primary` is filled accent and appears at most once on a screen —
the one thing to do here. `secondary` is an outline for an alternative. `ghost` is an action inside a
row, a header or the composer. `danger` deletes or removes, and stays quiet until the pointer is on
it, because these sit on screen all day. `loud` fills a kind instead of tinting it, for the one
control that must be found instantly: Stop.

Two heights: 28 inside rows and dense bars, 32 standing on its own. Icon-only is square at the same
height, and only where the symbol is universal (§6). Height also decides text size (11px and 12px):
Tailwind utilities all have the same specificity, so a size a call site passes would be decided by
the generated sheet's order rather than by intent. Nothing a call site can pass may contradict the
component; what varies is a prop.

**A disabled control says why.** The `disabled` prop takes the reason rather than a boolean, so a
control cannot be greyed out silently: it dims to 40%, keeps its shape, and carries the reason.
"Type a message first", "Stop the turn to change the model". It is disabled with `aria-disabled`
rather than the native attribute and stays focusable, because a natively disabled button cannot be
reached by keyboard and a reason nobody can reach is not a reason (WAI-ARIA APG). Activation is
dropped by the component.

`npm run shots` writes the sheet of every control in both colour modes to
`out/shots/components-{dark,light}.png`, from the same build as the app; loading the window at
`#gallery` opens it. It is how "what do we have" gets answered by looking. Sections it marks as
sketches are copies of markup that still lives in `panels.tsx` and will not follow a change there —
only the unmarked ones are the components themselves. The hash is read once at load and is not a
live switch, so a `#gallery` link in an answer cannot unmount a running app.

A state is a badge: a dot or icon, then the word, in the state's colour — never colour alone (§11),
and it pulses only while the state is still happening.

Popovers share one surface — `surface`, radius 14, hairline, the only shadow in the app — even
though the model list is a modal dialog that takes focus and the slash completion list deliberately
does not. Both highlight the current item with `accent-weak`.

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

**What the agent produces is a document.** Left aligned, no bubble, full markdown, in one reading
column: the width of the pane up to 920, centred. The composer keeps its own narrower measure (768),
because a text field as wide as the transcript reads as a form rather than a place to type. It writes commands, output, plans, diffs and reports; wrapping that in speech balloons
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
  started one. *Only in the live view:* the fact is recorded when the message is sent, and FastAgent's
  session entries carry the text without saying a run was in flight, so a reopened conversation shows
  the bubble without the label. Deriving it would mean keeping a second record of the transcript,
  which this app does not do.
- **Streaming** trails a block cursor `▍`, which says "still writing" without a spinner and vanishes
  on settle.
- **A settled answer ends with when it landed and a way to copy it**, and nothing else. Runs are
  long and read later, so the time is part of the record; the copy control appears on hover. A
  rating has nowhere to go here, and branching and editing are not features, so the row that other
  clients fill with icons stays at two things.
- **Turn spacing** is 24 within a turn and 32 between turns. Long output needs the rhythm more than
  a dense list does.
- **A date separator** — one centred muted line — appears where a conversation crosses a day. Reading
  yesterday's run is the normal case here, and without it a background conversation reads as if it
  all happened at once. Telegram has had this since the beginning for the same reason.

## 9. Status

Three tiers, decided by what the person has to do about it. Carbon is explicit that an indicator with
no required action should be plain text or nothing; HPE's rule of thumb is that a status carries at
least three of colour, icon, shape and text. Fact 4 adds our own requirement: the person is often
away, so "is it still working" must be answerable from the sidebar without opening anything.

| Tier | States | How it is shown |
|---|---|---|
| **Needs a decision** | broken, needs a model, no agent yet, failed, stopped, refused | Text always, plus icon or shape. Colour is the third signal, never the only one. |
| **Reassurance only** | working, thinking, running | A breathing ring on the agent's avatar, a pulsing dot and the word on the conversation row, elapsed time in the transcript. No sentence in the reading flow. |
| **Nothing to do** | ready, done *(already seen)* | Show nothing. A tool that worked wears no badge; a trace where nine cards in ten say `done` is how the one that failed gets lost. |

One vocabulary everywhere — the same condition must not be `working` in one place and `running` in
another:

`working` · `thinking` · `running` · `done` · `failed` · `stopped` · `refused` · `unsent` ·
`needs a model` · `no agent yet` · `broken`

`unsent` earns its place in the list rather than being an exception to it: a conversation holding
text nobody sent is unfinished work, and no other word in the list says that. `done` stays in the
vocabulary for the word's own sake — it is what a finished tool is called when something has to name
it, such as a tooltip — while the third tier keeps it off the screen.

**An outcome you were not there for is a decision, not reassurance.** Runs are long and fact 4 says
you come back to them, so a run that settles while you are reading something else leaves a mark: the
conversation row says `done` or `failed` as a filled pill with its label in semibold, the agent row
sums them (`2 done`, `1 failed`, with failures winning the summary), and the dock carries the total
so it is answerable without duang being the window in front. Tested as a tinted word first, and
missed several times in a row — this is the one mark in the interface that has to be seen from
across the room, so it is Telegram's unread pill and nothing quieter. Opening the conversation
spends the mark, the way an unread count is spent by reading — its whole purpose is to disappear. A run you stopped yourself leaves nothing,
because you already know. The mark lives in memory: it is a fact about this window's attention, and
the transcript stays the only durable record of what happened.

This is also why `done` can be both tiers. Unseen, it is the reason to come back; once looked at, it
is the state with nothing left to do, and it goes quiet.

`refused` and `failed` stay separate on purpose: a refused send never ran, so the text is still the
person's to edit; a failed run did run, and its effects may already exist.

`stopped` is new and required: a tool the person interrupted currently reports `failed`, which blames
the tool for the person's decision.

**Presence is layered, never duplicated.** The avatar answers *is this agent busy at all* with a
breathing ring, the agent row says it in words (`working`, `2 working`), and the conversation rows
answer *which one* with a pulsing dot and the word. Each level adds information the one above cannot
give; none of them repeats the other, and none of them is colour alone. A conversation holding
unsent text says `unsent` in the same place, because that is also work that is not finished.

The tier-1 states reach the sidebar as words too: an agent that is `broken`, `needs a model` or has
`no agent yet` says so on its row. A coloured dot on its own was colour doing the work, readable
only through a tooltip.

In the transcript, a refusal is drawn with the word `refused` beside main's own sentence, which goes
in verbatim. The tone carries the distinction the words make: nothing ran, so the message is still
the person's to edit.

## 10. Motion

140ms, `cubic-bezier(0.2, 0, 0, 1)`. Four things move: rows expanding and collapsing (180ms),
popovers appearing (opacity plus 4px rise, 120ms), hover backgrounds (100ms), and presence — the
avatar ring and the conversation dot breathing together at 1.8s. Streaming text is not animated — token arrival is the animation, and a
transition on top of it produces jitter. Everything collapses to instant under
`prefers-reduced-motion`.

## 11. Accessibility

Focus ring is `2px accent` at 2px offset, on `:focus-visible` only, and never on text fields, whose
caret and container already say it. Body contrast stays at or above 4.5:1 in both modes. Status
follows §9; no state is colour alone.

**The roster is one tab stop** (WAI-ARIA APG): Tab reaches it, arrows move inside it. Up and Down
walk agents and their conversations as one list, Home and End jump to its ends, and Enter opens
whatever the keyboard is on. The keyboard starts on what is open and stays where it was last moved.

**A row's controls are keys, not tab stops.** A caret and a delete on every row would make Tab walk
the roster three times over, so the row answers for them: Right and Left expand and collapse an
agent, Delete removes the conversation the keyboard is on. `New conversation` is a row in the list
for the same reason. The controls stay clickable and keep their labels for assistive technology;
what they lose is a place in the tab order.

**The transcript is a focusable region**, named, so it can be read and scrolled without a pointer —
Chromium gives a scroll container the arrow keys once it has focus.

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
