# Interface design

The visual system shipped with the local Week 1 client, not a specification for every future
surface. [design.md](design.md) owns the new product paths and [interaction.md](interaction.md)
owns behavior; when they differ from a future-screen sketch here, follow those documents.

## 0. What the product actually asks of the interface

These facts explain the shipped local visual design; future shared contacts and routines use the
same reading principles but are not covered by its old future-screen sketches.

1. **The person works with an agent they created or were invited to use.** Creators also need to
   inspect the definition and its local changes; recipients mainly give work and read results.
2. **The client is where work happens and where people return to its outcome.** Local testing,
   online work and diagnosis should feel continuous without pretending their histories are one.
3. **The two sides of a conversation are asymmetric.** A task or correction is usually short; the
   agent's answer and tool work may be long and structured.
4. **Work runs in the background, in parallel, for a long time.** You come back to it as often as you
   watch it, and you need to see which of several conversations is alive.
5. **The transcript is the work record.** Later read-only details may show local files and an
   owner's routines, but do not duplicate the runtime's conversation history.

Two consequences worth stating before the details. Anything that fragments the agent's output
(bubbles, cards per paragraph, decoration) fights fact 3 and fact 5. Anything that hides parallel
work to keep the list tidy fights fact 4.

## 1. Three principles

**An agent is a contact; a conversation is a topic.** The default view is a roster of who you work
with and what they last worked on. Several conversations per agent are real and never hidden, but
they live one level down, in the open agent's conversation list, so the roster stays a list of
contacts.

**Floating layers belong to navigation, never to the work.** The sidebar and header lift off the
page; the transcript stays opaque so long results remain readable.

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
  transcript is the work. *A character that performs a lifecycle* — their premise is one
  conversation per Bot and a character to animate; ours keeps the drawing fixed (it is who the agent is)
  and lets only its face follow the agent's state, in small motions, while the conversation rows say
  which conversation is running. *Pin and hide* — their premise is a roster of up to 50 Bots; ours starts with the few agents
  you actually use. Online contacts may change the size of that list later.
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
    adjacent hues. We take the stepping, not the palette: Telegram's avatars are saturated pastels
    against a neutral UI, and ours sit beside a violet accent, so their chroma is capped and the set is our
    own (§4).
  - *Token naming.* `colors.palette` defines every role as a set — `windowBg`, `windowBgOver`,
    `windowBgRipple`, `windowFg`, `windowSubTextFg`, `windowBgActive`, `windowFgActive` — instead of
    letting components derive hover and active states themselves. §4 adopts that discipline.
  Refused: the assumption that a contact has exactly one thread; ripple on row press, which is a
  Material gesture that no macOS app makes; and ordering the list by unread first, since an agent's
  list is ordered by what is happening now.
- **Carbon, HPE design systems, WCAG 1.4.1** — the status rules in §9.
- **macOS 26** — keep translucency in navigation rather than simulate glass across reading surfaces.

## 3. Structure

The shipped local client has two columns. The future contact and optional detail surfaces are
specified in [design.md](design.md#the-workbench), not by reserving permanent chrome here.

```
┌ sidebar 240–320 ───────────────┬ conversation ───────────────────────┐
│ duang·                    ＋    │ floating header            [≡]      │
│ (AM) amazonseo.ai      3:11 PM │               ┌ Conversations  ＋ ┐ │
│      The i18n check fails in   │               │ fixing the i18n…  │ │
│      one place, and the ca… 2  │               │ Deploy       Tue  │ │
│ ───────────────────────────── │               └───────────────────┘ │
│ (EX) existing-agent  ● working │                                       │
│      bash npm run build        │ floating composer                     │
└────────────────────────────────┴───────────────────────────────────────┘
```

**Sidebar rows are agents, and only agents** — a contact list in Telegram's shape. Listing each
agent's conversations under it made the column a tree of folders, and an agent read as a directory
of chats rather than as someone you work with.

A row, holding Telegram's proportions at a tool's density: a round avatar 48 across with a two-stop
gradient in its hue — flat avatars look printed, and the gradient is most of why Telegram's list
feels alive — beside three lines of text. The first is the agent's name, at 15px so it reads above
what it quotes (the two used to share a size and told apart by weight and colour alone), with the time of what the
row quotes trailing it: the clock today, the weekday within the week, a date before that (`Jan 5`,
and the year only when it is not this one: a string of numbers reads in a different order to each
reader). The other two quote the newest output of the conversation the row speaks for, clamped to two
lines. The unread count sits at their trailing edge on the *first* of them, under the time: the
right-hand column is time over count whether the quote runs one line or two, and the count is never a
line away from the words it belongs to. The height is fixed, so a one-line quote does not make a short
row. The header's two lines are the agent's name and, under it, where the agent lives (a click opens
the folder, as does **Reveal in Finder** in the row's menu). The conversation's title is not in the header:
an agent is a contact, a person talking to one is not asked to think about sessions, and the path at
least says where the work is. The titles are in the conversation list.

The conversation a row speaks for is the one a click on it would show: the one on screen for the
open agent, otherwise the one the agent was left on, otherwise its newest. The quote is the last
thing in that conversation — the agent's answer, the tool it is running (`bash npm run build`),
a failure note, the line it is thinking while it thinks (`thinking: …`, by the rule in §8), or your own message as
`You: …` — as plain text, with markdown marks dropped and finished thinking passed over. While this window holds the conversation (the one on screen, or one running
in the background after you walked away from it), the quote follows it as it streams. Otherwise it
is read once from the conversation's history, through FastAgent's public `entries()`, and read again
only when the session list says the conversation moved on. Nothing of it is stored: it is
presentation, and the transcript stays the runtime's. A run started outside duang therefore shows
when the list is next read, not token by token. A history that cannot be read says so in the quote's
place rather than showing something older, and a conversation deleted from under a row is no longer
quoted.

While any of the agent's conversations runs, `working` (or `2 working`) takes the time's place: the
quote below is the work itself and must not be replaced by a word about it. The agent's setup
problem (`no agent yet`, `broken`, `folder not found`) or the reason its list could not be read takes
the quote's place, since there is nothing to quote. An empty list and a list that could not be read
are not the same answer, and the failure stays on that agent's row: a background read never changes
what the main panel believes about the agent being read.

Every row needs its agent's list, so at launch duang reads each agent's conversations, which boots
each runtime the same way opening it would — FastAgent owns the session list and duang will not keep
a second copy of where sessions live.

**The name is duang's label**, renamed the way macOS renames: `Rename…` in the row's native context
menu, or a double click on the row. It is stored in duang's registry; the directory and the agent's
definition are untouched, and an empty name is not a rename.

The open agent is a soft accent tint (a subtle gradient in light mode) with normal text, not a solid fill: a filled row was the loudest
thing on screen and competed with the transcript it points at. There is one selection mark at a
time; while Settings shows, the Settings row at the foot of the sidebar carries it instead. Rows are
slightly inset so the tint is a rounded shape in the column, and the hairline between them starts
where the text does, as in Telegram and WeChat. The hairlines on both sides of a filled row — the
open agent, or the one under the pointer — give way, as Telegram's do: a line running into a rounded
fill reads as a cut.

**The open agent's conversations hang from the header.** A list button, the header's disc,
shows and hides them in a floating panel under it, the way ChatGPT's header panels do: a
native popover, so the top layer, a click outside and Escape closing it are the platform's, and an
Escape that closes it does not also stop a run. The button carries a dot while one of the agent's
conversations has an outcome you have not seen. The panel is titled `Conversations` with a `＋` for
a new one (`⌘N` does the same), and choosing a conversation or starting one puts it away.

A conversation row is one line: the label, with its time trailing and a `…` in its place on hover,
so a topic is visibly lighter than the agent that owns it. The `…` opens the row's menu rather than
being a shortcut to its most destructive action: one way to act on a row, and it is the same menu
the right click and Shift+F10 raise. The list includes a conversation that is running and one
holding unsent text, because fact 4 makes "what is alive right now" a question the window must
answer; a new conversation shows as an italic `New conversation` until its first turn lands, and
creating one moves focus to its input once the new session is ready.

**Presence is told at two levels.** The avatar carries the agent's own presence: while any of its
conversations is working, a still accent ring stands around it, its face shows what kind of work it
is, its row says `working` in words, and its quote streams. The conversation list carries which one:
a pulsing dot and the word on that row. Neither the ring nor the face is ever the only signal, so
colour and motion never do the work alone (§9).

**An avatar has three layers, kept apart** (`avatar.tsx`, `face.ts`). The *drawing* (its shape and
colour, from the agent's id and the registry's colour number) is who the agent is: it never changes
with state. A rename keeps the colour, and the drawing too in every style but Initials and Initial face,
which draw the name. The *face* (eyes and motion) follows what the agent is
doing. The *ring* is presence. One face at a time, by how much it asks of the person:

| Face | When | Shown as |
|---|---|---|
| `unborn` | no agent yet | an outline, no face |
| `broken` | broken | grey, eyes closed, still |
| `thinking` | a run is thinking, starting or compacting | ring; eyes drift up and aside |
| `tool` | a run is using a tool | ring; eyes scan left and right |
| `answering` | a run is writing its answer | ring; a small bob, as if talking |
| `failed` | an outcome failed while you were away | small eyes looking down; one shake when it lands |
| `done` | an outcome finished while you were away | happy eyes; one hop when it lands |
| `open` | the agent on screen | looks toward its conversation |
| `idle` | otherwise | blinks now and then, each agent on its own clock |

The kind of work is the run status line's own word (`phase`), for the conversations this window holds.
Motion is small, continuous only while an agent works, and an outcome plays once, when it lands. With
reduced motion every face keeps its pose (closed, looking down, happy) and loses its movement, so the
states stay apart. Gaze's identity eyes come from six neutral pairs; the ones its faces use (happy,
small) are kept out of them, so an agent whose own eyes were happy could not look happy about anything
else. Only Gaze's eyes move: the other styles show the same rings, hops, shakes, breathing, grey and
outline, without blinking, looking or closing their eyes, and the words carry the rest.

**Panels float on the window's canvas.** The sidebar is a rounded card inset from the window edges
rather than a column filling them, and the conversation's header floats over the transcript as a
translucent bar instead of a full-width strip cutting the page in two. This is Telegram's desktop
composition, and its premise holds here: chrome that hovers keeps the content beneath it continuous.
What does not carry over is putting the transcript itself on a decorative canvas — theirs is bubbles
over wallpaper, ours is a document that has to stay readable — so the transcript is opaque and only
the chrome floats. The transcript starts below the header, then slides underneath it when scrolled;
a soft lower shadow keeps the two readable without stopping the page.

Its right edge is how full the conversation's context is, in muted 11px text: `context ▬ 12%` with a 40px
bar, and `–` while the runtime has none to report (a new conversation). It is the one number about
this conversation that moves as it goes, and it is always there, so the table below has somewhere to hang.
The plan's windows belong to the account and change slowly, so they are not in the edge: hovering or
focusing it opens a small table of each window's share and reset, the pace of a day-or-longer window
as a green `▼` or red `▲` percentage, the context as `45% of 1.0M`, and which plan and when it was
read. Letting whichever of the two is fuller take the one slot would change what the slot means from
one glance to the next. Every window in a row would make the
edge the densest text on screen for numbers read once in a while. No threshold colours: the
percentage is the signal.

**The model chip and its picker follow Codex's, on duang's terms.** The chip, 13px on a faint tint so it reads as the
button it is beside the field's own text, names the provider quietly
and the id plainly, with the effort after it (`openai/gpt-5 Minimal`); the provider stays because
`openai/` and `azure-openai-responses/` offer the same ids and are paid for differently. It opens one popover
anchored to the chip's right edge: a search row (with a quiet refresh button at its end, and under it, once
pressed, one line of what it found or why it failed), the models under their provider (each by its declared name,
its context window quiet at the right end, in the system face rather than mono, at 13px; the id on hover),
and the effort. Effort is a track with a stop per level; the runtime's list is the stops, and it is per
conversation, a new one included, so only a conversation with no model yet says it has none. The track shows the level the runtime reports and nothing ahead of it: a choice reaches the runtime
and comes back as `state_changed`. Choosing writes a durable entry into the conversation's record, so
choosing is explicit: the stops are buttons in a `radiogroup`, the arrow keys move the focus along them,
and Enter, Space or a click choose (a native radio group would choose at every stop the arrows cross).
The list stops at 60 rows and says how many more there are, since a
provider past the limit would not show even its heading. FastAgent gives a
model's friendly name to nobody, and guessing one from the id would name a model the runtime does not,
so the list shows ids. What the picker leaves out: the credential file's path (nothing the person can
act on) and a Manage providers link (Settings is in the sidebar; the empty picker keeps its one
**Connect a provider**).

**The header is two parts.** What you are looking at (avatar, agent name, folder,
`working`, the context meter, `queued`) is one pill, and the conversation list, the one thing to do about
it, is a round disc beside it, as Telegram splits a chat's info from its call, search and menu. `working`
is about the open conversation. While only other conversations of the agent run, it reads `1 other
working` instead, and a click on it opens that conversation (or, for several, the conversation list, which
marks each). The header runs the pane's width: it is chrome, and held to the reading column it would read as a
card in the middle of a page. The composer does not: it sits in the reading column, its round button on the text's right
edge, because the eye goes from the last line down to the field and
a field wider than the text made that a jump. The disc is alone because nothing else on a
conversation is an action yet: new conversation lives in the sidebar, and a menu with nothing in it
would be furniture.

The composer floats the same way at the bottom, and the transcript passes beneath both. It is one row
in Telegram's shape: the field, and one round button that is whatever the next action is (Send,
dimmed while the field is empty; while a run is live, Stop with the field empty and Steer once it holds
text, Esc stopping either way). What
belongs to the next message rather than to the app, the model chip, sits inside the field at its
right end, where Telegram keeps its emoji. The field is a 40px pill that grows into a rounded
rectangle as it takes lines (up to eight), and the buttons stay level with its last line. The chip
sits beside the text while the draft is one line and drops to a row of its own under the text once it
is not (a newline, or a line wider than the room beside the chip): beside a taller draft it reserved
a column down every line and left the first lines wrapping short of the field's edge. The choice is
made from the draft and the room, not from how the text wraps, so the change of width cannot flip it back. There
is no attach or voice button until either works: a control that can only say it is not there yet is
furniture.

The strips past the header and the composer, above one and below the other, are veiled rather than painted over: the canvas
at 65% over a 3px blur, strongest at the window's edge and clear by the bar's inner edge. A line
passing there stays faintly visible, the way the header shows it, and reads as moving on; left bare,
the gap above the header would show sharp cut lines, and painted solid, the text would stop at an edge.
A header in its own row with a masked top edge, or a solid backdrop behind the composer with a 40px fade
above it, both stop text at a line, which makes the conversation read as a framed box rather than a
continuous page.

Isolated fixture snapshots: [reading, light](screenshots/reading-light.png),
[narrow, dark](screenshots/reading-narrow-dark.png),
[conversation list, light](screenshots/conversation-list-light.png),
[model picker, light](screenshots/model-picker-light.png),
[settings, light](screenshots/settings-light.png) and [its avatar styles](screenshots/settings-avatars-light.png). Regenerate the full dark/light set with
`npm run shots`.

Future contacts can be local, owned online or invited online at the same time: no global
`Local | Cloud` switch. An optional detail reader can show relevant local files, diffs and
actually loaded settings to the owner; recipients never see someone else's local files. A private
online agent may run routines without a channel or invite. Do not add a global Activity row or a
permanently open third column until work cannot be found in the existing roster and transcript.

Removing an agent is not offered by the sidebar at all. A control on the row put one slip between
opening an agent and removing it, and a link at the bottom of the column belonged to nothing in
particular. Removal lives where the problem is explained — the panel for a broken agent or a
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
Light mode is not that set mirrored. A warm, nearly white reading canvas and a slightly deeper
sidebar separate work from navigation; the code block takes a cooler neutral, while the floating
composer remains white. Violet stays in selections and actions rather than tinting every surface: the
sidebar's `+` is text-coloured, since an "add an agent" button in violet competes with Send for the one
primary action.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `oklch(0.225 0.004 285)` | `oklch(0.992 0.004 80)` | the transcript and its canvas |
| `surface` | `oklch(0.27 0.005 285)` | `oklch(0.986 0.004 85)` | cards and popovers; the composer's field and discs are white in light mode |
| `sidebar` | `oklch(0.285 0.005 285)` | `oklch(0.958 0.009 80)` | the sidebar panel (light mode adds a gentle gradient) |
| `surface-2` | `oklch(0.315 0.006 285)` | `oklch(0.946 0.006 80)` | pressed and nested surfaces |
| `stroke` | `oklch(0.36 0.006 285)` | `oklch(0.886 0.007 80)` | hairlines and borders |
| `text` | `oklch(0.95 0.005 285)` | `oklch(0.22 0.014 285)` | body |
| `muted` | `oklch(0.68 0.01 285)` | `oklch(0.46 0.012 285)` | metadata and timestamps |
| `accent` | `oklch(0.72 0.16 295)` | `oklch(0.52 0.18 300)` | accent **as text**: links, badges, focus rings |
| `accent-weak` | `accent / 15%` | `oklch(0.72 0.09 300 / 16%)` | selected conversation, user bubble |
| `accent-fill` | `oklch(0.52 0.2 295)` | same | accent **as a surface**: primary button |
| `danger-fill` | `oklch(0.52 0.2 25)` | same | danger as a surface (Stop) |
| `fill-fg` | `oklch(1 0 0)` | same | text on either fill |
| `success` | `oklch(0.72 0.14 150)` | `oklch(0.50 0.14 150)` | tool finished |
| `warning` | `oklch(0.79 0.15 65)` | `oklch(0.58 0.15 60)` | no agent yet, refused |
| `danger` | `oklch(0.68 0.17 25)` | `oklch(0.52 0.19 25)` | broken, failed, destructive |

Accent as text and accent as a surface cannot be one value. As text it sits against the page, so
dark mode needs it light; as a fill under white text it must stay dark enough for primary controls
to remain legible. The fills therefore do **not** change between themes. The agent row instead uses
a translucent tint so it does not compete with the reading column.

Every interactive role is defined as a set, not derived at the call site — Telegram's palette does
this and it is why their themes stay coherent: `bg` / `bg-over` / `bg-active`, `text` / `muted` /
`fill-fg`. A component picks a role; it never computes a hover colour itself.

An avatar's colour is the agent's own number, given by the registry when the agent is added: the lowest
no other agent has, kept for the agent's life (a rename does not recolour it) and reused once its owner is
removed. `avatar-colours.ts` maps it onto a palette of sixteen bright colours (Gaze's body and the
Initials gradient wear it; the other drawn styles keep their own), `PALETTE[(n * 5) % 16]`:
five and sixteen share no factor, so agents numbered one after another land a third of the wheel apart
(Telegram's idea of a shuffle) and every colour is reached. Two agents therefore never share a colour
until there are more than sixteen. The sixteen are chosen to be told apart at a glance rather than to
look related: the closest pair is 0.093 apart in OKLab (about 0.02 is the least anyone notices, 0.1 is
"different colours"). They are bright because white initials and brightness do not go together: white
falls under 3:1 above a lightness of about 0.64, where near-black initials are above 5:1, so every
avatar wears the dark ones, and the lightness is free to run from 0.66 to 0.82. Each is a gradient from 0.09 lighter to 0.09 darker,
turning 12° round the hue, with chroma capped at 0.17 to stay calm beside the violet accent. The
middle must hold the initials at 4.5:1, the darkest stop at 3:1, and every stop must be a colour sRGB
has. `avatar-colours.test.ts` holds all of that, so a colour added later cannot repeat one already there.

## 5. Typography

```css
--font-sans: system-ui, "PingFang SC", sans-serif;
--font-mono: "Maple Mono NF CN", "JetBrains Mono", "SF Mono", ui-monospace, "PingFang SC", monospace;
--font-prose: "Prose", "PingFang SC", sans-serif;
--font-avatar: "Avatar", "Prose", "PingFang SC", sans-serif;
```

Controls, navigation and the trace use the system face, paired with the system's own CJK face. The stack leads with `system-ui`, the only name Chromium maps to SF: `-apple-system` is Safari's spelling and "SF Pro Text" is not handed out by name, so a stack that leads with them falls through to PingFang SC and draws the chrome's Latin in it, hyphens at 0.6em where SF's are 0.43. This is
a native window with a hidden title bar, and a web font in its chrome reads as a page rather than an
app. The conversation is the exception (below). Do not force CJK into the monospace
family; let it fall back to PingFang SC inside code contexts rather than deforming it. Maple Mono is
the one mono everywhere, trace and answers alike, so a command in the answer looks like the command
that ran. In a sentence it is set a step down, at regular weight, on the paper's deeper tint
without a border: a marked word, not a chip, and not a dark bar inside a bold lead.

**The conversation has its own voice, `Prose`**, two bundled rounded faces under one name: Nunito for
Latin and Resource Han Rounded for Chinese. A system sans there made the answer indistinguishable
from every other chat app. Resource Han Rounded is the design Maple Mono CN draws its CJK from, so the
answer and the code it quotes share their Chinese letterforms; it is used on its own because Maple's
CJK sits in 1.2em cells to align in a terminal, which spreads a paragraph apart. Maple Mono itself
is not used for Latin prose: a monospace line is a third wider and has no word shapes.
The CJK face is cut to GB2312 (1.1 MB a weight); a rarer character falls back to PingFang. Both
fonts are OFL; their licences sit beside them in `src/renderer/fonts/`. Nunito is set 10% up
(`size-adjust`): its x-height is 0.48em against Resource Han Rounded's 0.54, and at the same nominal
size its words read a step smaller than the Chinese beside them. Each Latin face and its Chinese
partner declare identical weight and style: Chromium picks one descriptor bucket before it reads
`unicode-range`, and a mismatch (Nunito declared `200 1000` beside `400` and `600`) is never loaded,
so Latin silently falls back to PingFang. The smoke test checks that the Latin face loads. Italic and bold italic are faces of their own (Latin 400 and 600, Chinese 400 and 700), so emphasis keeps its weight; Chinese has no italic and the browser does not slant a face declared italic, so it stays upright inside emphasis.

The rule is ownership, not place: **words a person wrote wear `Prose` wherever they are quoted**,
so a message does not change typeface between the bubble and the roster's quote of it. That is the roster row's
preview line, the agent's name (in the row, its rename field and the header), the rows of the conversation list with the field that renames one, at their own
sizes. A name is one of those words: the user chose it, and an agent is a contact. Everything the app
says itself stays in the system face: times, badges, errors, controls and the trace.

**An avatar's initials wear `Avatar`**: Fredoka 600 cut to Latin (16 KB, OFL, licence in
`src/renderer/fonts/`). It is round and bouncy, and still reads at the 30px header size, where a
blobby face like Sniglet already blurs `AM` and `WR`. Two letters do not need more, so
there is no reason to give an avatar the answer's face. A Chinese name is not in Fredoka and falls
through to Prose's Chinese face. The smoke test checks that the face loads.

**Chinese is a first-class case, and CSS cannot see it.** CJK glyphs fill their em box and want more
leading than Latin at the same size. A `:lang(zh)` rule is the obvious way to say so, and it does not
work here: the document is `lang="en"` and nothing marks a Chinese message as Chinese, so the rule
never fires once. Only a per-message script detector could, and that is a second source of truth
about the transcript bought for a difference of 0.05. Prose therefore takes **one** leading, 1.7:
right for Chinese, slightly airy for English, and this is a document column rather than a dense list.
It lives in one place, `.md, .bubble`, which the composer wears too so that a long message does not
reflow the moment it is sent.

Chinese and Latin mixed in one line get a sixth of a space between them from `text-autospace`, set on
`body`: model output is inconsistent about typing that space, and the browser adds it only where it
is missing. Code, paths and tool output opt out, since the gap would push a line with Chinese in it
off Maple's 2:1 grid and out of column. Fullwidth punctuation keeps Chromium's default trimming (`text-spacing-trim: normal`);
trimming every mark to half width is a Japanese convention, not a Chinese one. Prose wraps with
`text-wrap: pretty`, so a paragraph does not end on a lone character such as `单。`.

**What you write, what you sent and what the agent answered are one voice**: 15px at 1.7, one step
above the navigation and two above the trace. The transcript is a report read later (fact 5), not a
log glanced at, so it takes a reading size, while the work that produced it stays at 12 and reads
as an aside. Bold is 600, not 700, since answers that lead every item with a bold sentence
became a page of dark bars; the Chinese beside it takes Bold, because a CJK stroke needs more weight
than a Latin one to read as emphasis.

| Role | Size / line-height / weight |
|---|---|
| New conversation heading (centred in the empty page; the composer stays at the bottom) | 22 / normal / 500 |
| Answer headings | 22 / 19 / 17 (h1–h3), 15 below / 1.4 / 600 |
| Conversation prose, sent messages, composer | 15 / 1.7 / 400 |
| Answer tables | 14 / 1.6 / 400, header 600 muted on a tinted band |
| Agent name | 13 / 1.4 / 600 |
| Sidebar rows | 13 / 1.7 / 400 |
| Model and command lists, their search | 13 / 1.5 / 400, secondary text 12–13 |
| Tool rows, thinking, card bodies | 12 / 1.5 / 400 |
| Code, paths, tool output | 12.5 / 1.625 / 400, mono |
| Inline code | 0.875em of its line (11 at least) / 400, mono |
| Badges, timestamps, labels | 11 / 1 / 400–500 |

Mono sits half a step above the sans beside it on purpose: its x-height is smaller, so the same
nominal size reads smaller. Nothing else is drawn at a half step: it is invisible, and all it does is stop two things that should
match from matching. The chrome's scale is 11, 12, 13, 15 and 22 (the page title), with the mono's 12.5
as the one exception; a test reads the components and fails on any other size.

Emphasis uses weight, never hue. Body text is never coloured.

## 6. Icons

Phosphor at Bold, set once for the whole app through `IconContext`, at 11–16px. Bold rather than
Regular because Regular is a hairline at these sizes: next to 13px text at 600 it reads as a thinner,
greyer thing than the words beside it, which is most of what makes an interface look drawn by a
compiler. Bold sits at roughly SF Symbols' semibold, the weight macOS itself puts next to text of
this size. Emphasis is therefore colour, not weight — a running tool's icon takes the accent, a
failed one takes danger. Every icon carries a label or `aria-label`; icon-only controls exist only
where the symbol is universal (send, stop, close).

## 6b. Controls

Four kinds of button and no fifth. `primary` is filled accent and appears at most once on a screen —
the one thing to do here. `secondary` is an outline for an alternative. `ghost` is an action inside a
row, a header or the composer. `danger` deletes or removes, and stays quiet until the pointer is on
it, because these sit on screen all day. `loud` fills a kind instead of tinting it, for the one
control that must be found instantly: Stop.

Three sizes: 28 inside rows and dense bars, 32 standing on its own, and 40, a circle that exists only
for the composer's icon buttons. Icon-only is square at the same height (round at 40), and only where
the symbol is universal (§6). Height also decides text size (11px at 28, otherwise 12px):
Tailwind utilities all have the same specificity, so a size a call site passes would be decided by
the generated sheet's order rather than by intent. Nothing a call site can pass may contradict the
component; what varies is a prop.

**A disabled control says why.** The `disabled` prop takes the reason rather than a boolean, so a
control cannot be greyed out silently: it dims to 40% and carries the reason. In light mode a
disabled Send takes a neutral fill. "Stop the turn to change the model or effort", "Nothing to send yet". It is disabled with `aria-disabled`
rather than the native attribute and stays focusable, because a natively disabled button cannot be
reached by keyboard and a reason nobody can reach is not a reason (WAI-ARIA APG). Activation is
dropped by the component.

`npm run shots` writes the sheet of every control in both colour modes to
`out/shots/components-{dark,light}.png`, from the same build as the app; loading the window at
`#gallery` opens it. It is how "what do we have" gets answered by looking. Every section renders the
app's own components with fixed props, so a change to one shows there; surfaces that need live state
(the lists, the header, the composer) are covered by the shots of the running app. The hash is read
once at load and is not a live switch, so a `#gallery` link in an answer cannot unmount a running app.

A state is a badge: a dot or icon, then the word, in the state's colour — never colour alone (§11),
and it pulses only while the state is still happening.

Popovers share one surface — `surface`, a rounded hairline and a shadow — even
though the model list is a modal dialog that takes focus and the slash completion list deliberately
does not. The model picker is a search field over the models grouped under their provider, the selected one
first with a check on a neutral row, and the conversation's effort under a hairline. The slash list
is the same surface and the same rows (13px, neutral highlight on the current item, the command's
description and source quieter beside it), and it steps aside while the picker is open. The arrow keys scroll the list to keep the cursor's row fully
in view (it scrolls past eight names); the pointer never needs to.

## 7. Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32.
- Radius, the same in both modes: 8 (rows, buttons, inputs, table heads), 14 (bubbles, the sidebar,
  floating panels, code blocks), 20 (the composer and the header, which are pills at one line).
  Corners are concentric: a popover is 14 with 6 of padding, so what sits in it is 8. A bubble's
  trailing corner and an inline code span are 4 — that asymmetry is what makes a bubble read as speech.
  A test fails on any other radius written into a component.
- Dark panels use value and a hairline; the header has a quiet lower shadow. In light mode the
  sidebar, header and composer get restrained shadows, while reading content stays flat.
- No divider between sidebar and conversation: the material change is the separation.

## 8. Message rendering

The transcript is a work record with two very unequal sides (facts 3 and 5), so the two sides are
drawn differently on purpose.

**What you send is a bubble.** Right aligned, `accent-weak`, max width 560. Your turns are short and
sparse, and their job is to be findable when you scroll back: *what did I ask for, and when did I
change it?* A bubble is a good anchor precisely because it is small and visually distinct.

**What the agent produces is a document.** Left aligned, no bubble, full markdown in a column up to
840px wide, which paragraphs, lists, code, tables and the composer share, so every edge lines up
and the eye goes straight down from the text to the field. That is a line of about 56 Chinese
characters at 15px. At 920 a line runs to 61 and the eye loses its way back to the next line; 768
(51) reads as narrow. The header is the one piece that does not take the column. The transcript reserves its scrollbar track
on both sides so its column centres where the composer's does. Spacing groups rather than separates, on the §7 scale: two paragraphs sit 12 apart, but a
paragraph and the list it introduces only 4; a heading stands 24 below what came before and 8 above
what it introduces; code blocks, tables and quotes take 16, a rule 24. One gap for every pair, which
Streamdown's own `space-y-4` gives, left every block equally separate, so nothing read as belonging
together. A table is part of the document: full height rather than its own scroll region, no frame,
a header band in the code block's family of tints, and hairlines between rows. The agent
writes commands, output, plans, diffs and reports;
wrapping that in speech balloons
fragments a record that needs to be scanned, and gives up the width its content needs. Products that
bubble both sides keep the heavy work somewhere else — a separate workspace panel — so what remains
in the transcript really is chat. Ours is the work.

Everything else follows from those two:

- **A stretch of work is one line.** Consecutive tool calls and thinking fold into a work block that
  says what kind of work it was: `thought 6s, read 4 files, searched once, ran 1 command`. It counts
  only calls that finished, so it never says in the past tense what is still happening. While its calls
  are what the run is on, the block's line *is* the live status (below): `running 2 tools · 24s` with
  the bouncing dot, still opening into the calls, rather than a count above a status line saying the
  same; once they finish it reads `ran 2 commands` again. (A call still running in a block that is not
  the live end, with a message waiting between, is counted as `1 running`.) A reading
  session of twenty files was twenty lines, none of them something the person needed; what they
  need is the kind of work. A call that failed is not called out on the block: the agent reads its
  own failures and carries on, so a failed call asks nothing of the person, and whether the work as
  a whole failed is the run's outcome to say. Inside the block the call still reads `failed`, for
  whoever opens it to find out why. A call that never finished is different and is said:
  `ran 2 commands, 1 stopped`. The agent never read its result and the run did not go on, and in a
  reopened conversation, whose history carries no `run stopped` line, the summary is the only place
  that says the work was cut short. Files are counted once however often they were read; a call
  reopened from history carries no arguments, so there each call counts. The block opens into the
  calls themselves, indented on a hairline. It stays closed while it grows, because the run's live
  status (below) already says what the current step is, with one exception: a call someone opened
  while it stood alone keeps the block open when the next call folds it in, rather than closing
  under the person reading it. A lone call keeps its own line, which says more than a count of one
  would; when it is the current step, the live status below it gives the step's word without
  repeating what it is on.
- **The live end of a run says what it is doing, once.** For the whole run, not only its silences, the
  transcript ends in one plain line: a bouncing accent dot, the step as a word that sweeps
  (`thinking`, `reading`, `running`, `retrying 2/3`, `compacting`, and `starting` before the runtime
  reports the run), what it is on (`…/src/a.ts`, `npm test`, or the line the model is thinking, by the rule in §8), and
  how long the run has taken. No capsule, border or icon: they would make one line of status the
  loudest thing on screen. A bare `working…` answers neither "is it alive" nor "what is it on", and
  it comes and goes between steps. The clock counts
  from when this window saw the run start, so a run that was already going when the conversation
  opened shows none rather than a wrong one.
  When the newest line is that step, it is that line, never one above another saying the same: calls
  running or a thought being written carry the dot, word and clock on their own line (which still opens
  into the calls or the thought); a retry being waited out is said by this line alone (`retrying 2/3 the
  provider had a problem`), and becomes `retried 2 times: …` above whatever the run went on to; an
  answer being written is its own sign of life, with no line under it until it stops coming: after 30
  seconds without a word the line is back, saying `answering · 31s · no output for 31s`.
- **A tool call is a line, and becomes a card when it is opened.** Closed it carries an icon, the
  tool's name, the command, and the state immediately after the command rather than pushed to the
  far right where it loses its subject — on no fill and behind no border, the same weight as the
  `thinking` line beside it. Boxing a closed call is wrong in both directions: full width it is a
  grey slab, shrunk to its text it reads as a button dropped into the prose. A path argument shows
  its useful tail; a command keeps its beginning, even when it starts with `/`. The surface arrives
  with the output it has to hold. Open, the card shows arguments as labels and values rather than
  as the JSON the wire carried, and the output out of its MCP content envelope. Output folds at twelve
  lines or 1500 characters, whichever comes first — one minified line has no line ceiling — to a
  footer row that spans the card, rather than into its own scroll region. Argument values fold at
  the same limits, because a `write` carries the whole file it writes. A shape we cannot
  unwrap keeps its JSON: a result nobody can see is worse than an ugly one. After the state comes
  how long the tool ran: whole seconds while it runs, since the clock ticks once a second, then pi's
  format once it settles (`3.2s`, `2m 5s`). Only a call this
  window watched has a time: history records when a call was announced and answered, not how long
  it ran, so a reopened call shows none. The clock stops when this view stops hearing the run.
- **Thinking** collapses to one muted line (`thinking · 3s`, trailed by the line it is on) and
  expands into a quoted block. While it streams, the line it is on is its last *complete* line: the one
  still being written reads as a fragment (`- The tot`). Before it has one, it is the words written so far
  without the one being written, or, in a script written without spaces, the text so far; with nothing
  yet, it is just `thinking`. The live status, the roster's quote and this row read it the same way
  (`thinkingLine`). Read back from history a thought is there as it streamed, but how long it took is not
  recorded: its row is `thinking` with its last line, and a block counts it as `thought`.
- **System events are one centred muted line**: model changed, run stopped, a retry, a command that
  ran. They are facts about the session, not things anyone said. A problem the person may have to act
  on (a run that failed or was cut short, a send refused) is a card instead (§9b).
- **A message is placed where the runtime says it entered.** Sent, it waits below the live output,
  dimmed and labelled `sending`, or `queued` while the runtime lists it in `pending.steering`; one
  that opens a run (nothing running, or the running one has no message yet, judged when it is sent)
  waits above the run's live status instead of below it, since the work is what it asked for.
  One sent during a compaction waits below: the compaction is not its work, while a `/compact` sent
  from idle opens it. It
  takes its place in the transcript when FastAgent reports it entering the conversation
  (`user_message`): a steer is read at the run's next turn boundary, so placing it at send time put it
  above output written without it. The queue shown is the runtime's, so a steer queued before a reload
  or from another client still shows. One still queued when the run ends was dropped: it returns to
  the draft instead of staying on screen as delivered, including a steer typed before a reload, whose
  words exist nowhere else. An extension command that does its work
  without sending anything into the conversation leaves one line, `ran /go X`. A message is matched to
  the one sent from here by its text, a slash command by being the oldest one waiting, since the
  runtime reports it expanded; a message from elsewhere queued ahead of one of ours can take its
  place.
- **A steered message** keeps its bubble and adds an accent rule down its leading edge with the label
  `joined the run`: it entered a run that already had a user message. After the fact nothing else
  distinguishes it from a message that started one. *Only in the live view:* FastAgent's session
  entries carry the text without saying a run was in flight, so a reopened conversation shows the
  bubble without the label. Deriving it would mean keeping a second record of the transcript, which
  this app does not do; making it durable is asked for upstream in
  [fastagent#595](https://github.com/fastagent-sh/fastagent/issues/595).
- **A conversation is named, or it borrows its first message.** FastAgent owns the label
  (`update({ name })`), and until something sets it a row falls back to the opening sentence — which
  is why a conversation whose subject moved on keeps the sentence it started with. Renaming happens
  in place on the row, reached the way macOS reaches it: the row's context menu carries `Rename…`,
  and a double click on the row does it directly — single click already opens, so the double is
  free, which is how Notes' folders and Safari's bookmarks work. Enter keeps the name, Escape drops
  it, an empty name is not a rename. The menu is a native one, so it looks like the system's and not
  like one of our popovers, and Chromium raises it for Shift+F10 and the Menu key too, which is the
  keyboard path. No F2: that is the Windows convention. duang does not invent a name from the
  model's output either — that spends a request nobody asked for.
- **A way back to the live turn.** Scrolling up stops the tail from following, and that is exactly
  when a control appears above the composer to take you back to the bottom. It exists only while
  that is true, so a transcript at the bottom carries nothing extra.
- **Streaming** trails a block cursor `▍`, which says "still writing" without a spinner and vanishes
  on settle.
- **A settled answer ends with when it landed and a way to copy it**, and nothing else. Runs are
  long and read later, so the time is part of the record; the copy control appears on hover. Only
  the words that end a turn carry it: a message the run goes on to work after is narration between
  steps, and a time under each one wedged a line of metadata between every step. A
  rating has nowhere to go here. Branching and editing are not shipped Week 1 controls; if a
  later task needs branching, its affordance belongs beside the relevant entry rather than on
  every answer.
- **Spacing is decided by the pair, not by one constant.** 32 above what someone sent, 24 below it,
  12 between the agent's words and its work, and **8** between two asides — a tool call, a thinking
  line, a system note, the live status. Those are single lines of one activity, and giving `bash` /
  `thinking` / `bash` the space a paragraph gets is what turns a work log into a sparse list; at 24
  between words and work, each tool line floated in a blank band of its own. Every one-line row in
  the trace (work summary, tool call, thinking, live status) is 28 tall, so they share one rhythm. Below the last line there is 48 before
  the composer: the transcript is pinned to its bottom while a run streams, so that gap is where the
  newest line lands, and at 16 it sat on the composer's edge under the fade.
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
| **Needs a decision** | broken, folder not found, no agent yet, failed, stopped, refused | Text always, plus icon or shape. Colour is the third signal, never the only one. |
| **Reassurance only** | working, thinking, running | A still ring and a working face on the agent's avatar and the word on its row, a pulsing dot and the word on the conversation row, and at the end of the transcript one live status line: the current step and the run's clock. |
| **Nothing to do** | ready, done *(already seen)* | Show nothing. A tool that worked wears no badge; a trace where nine cards in ten say `done` is how the one that failed gets lost. |

One vocabulary everywhere — the same condition must not be `working` in one place and `running` in
another:

`working` · `thinking` · `running` · `reading` · `searching` · `editing` · `fetching` · `answering` · `compacting` · `starting` · `done` · `failed` · `stopped` · `refused` · `unsent` ·
`no agent yet` · `folder not found` · `broken`

`unsent` earns its place in the list rather than being an exception to it: a conversation holding
text nobody sent is unfinished work, and no other word in the list says that. `done` stays in the
vocabulary for the word's own sake — it is what a finished tool is called when something has to name
it, such as a tooltip — while the third tier keeps it off the screen.

Copy says what something means for the person, never how duang is built. FastAgent, pi, the
`fastagent` CLI, credential stores and file layering are not the person's vocabulary: "Saved on this
computer", not "kept in duang's own credential file, not shared with the fastagent CLI". The
exception is an agent's own files, which its author writes and names (`fastagent/skills`), and
original error text, which is kept verbatim (§9).

**An outcome you were not there for is a decision, not reassurance.** Runs are long and fact 4 says
you come back to them, so a run that settles while you are reading something else leaves a mark: the
conversation row says `done` or `failed` as a filled pill with its label in semibold, the agent row
counts them in a round pill the way Telegram counts unread messages (red when any of them failed,
and said in words for assistive technology and in the tooltip), the header's list button carries a
dot, and the dock carries the total so it is answerable without duang being the window in front. This is the one mark in the interface that has to be seen from
across the room, so it is Telegram's unread pill and nothing quieter: a tinted word is missed. Opening the conversation
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
ring and a working face, the agent row says it in words (`working`, `2 working`), and the rows of the
conversation list answer *which one* with a pulsing dot and the word. Each level adds information the one above cannot
give; none of them repeats the other, and none of them is colour alone. A conversation holding
unsent text says `unsent` in the same place, because that is also work that is not finished.

The tier-1 states reach the sidebar as words too: an agent that is `broken`, whose folder is not
found, or that has `no agent yet` says so on its row. A coloured dot on its own was colour doing the work, readable
only through a tooltip.

A send refused because the conversation's model cannot run is not a card: choosing a model is the way on,
so the model picker opens on it with one line at its top saying why, in the warning tone, and the chip
stays marked until a model is chosen. Any other refusal is a card in the warning tone, with a prohibition mark rather than the
failure's, and says the message is back in the composer: nothing ran, so it is still the person's to
edit. main's own sentence is kept verbatim behind it (§9b).

## 9b. Problems

Something went wrong is said for the person, not for the program that noticed it. Every problem has
the same parts, in this order:

1. **What it means**, as a title in the person's words: "The provider did not accept the sign-in", not
   `OpenAI API error (401)`. A run's failure gets its title from the reason's own markers (an HTTP
   status, a network error code), conservatively; a reason nothing recognises gets "The run stopped
   with an error", never a guess (`problems.ts`).
2. **What to do**, one sentence, when there is something besides the buttons.
3. **The way on**, as buttons that land where the fix is done, the likeliest first: *Sign in to OpenAI
   again* opens that provider's row ready to connect, *Use another model* opens the picker, *Locate
   folder…* asks where a moved agent is, *Start a fresh config* replaces a fastagent.config.ts that does not load;
   then Network settings, View usage, Retry, Reconnect. A problem with nothing to do has none. A way on
   that is the whole fix happens in place: a send whose model cannot run opens the picker by itself, and a
   subscription the runtime let go reconnects once by itself.
4. **The original words**, verbatim, because they are what a report needs (AGENTS.md). Where nothing
   else explains the problem, a short one-line reason is the explanation and reads in place, in the
   app's face. Otherwise it folds to its first line, quietly, and opens into a mono well with a copy
   button. On a page it is the well itself.

Colour follows §9 and is never the only signal: danger for something that failed, warning for
something refused, muted for a fact. Each has its own mark (a warning circle, a prohibition sign, an
info circle) beside the words.

Size follows scope, at three placements of one component (`problem.tsx`):

| Placement | For | Shape |
|---|---|---|
| **card** | a run or a send, in the transcript where it happened | two lines at most, the width of what it says: the mark, the title in semibold with its sentence after it in muted, then the buttons with the original words folded beside them. No border: a faint wash of its tone (danger 8%, warning 10%) on an 8 radius. Only the latest one carries buttons: an earlier one is history |
| **strip** | this view lost its conversation, or an action outside any conversation failed (renaming, adding or removing an agent) | the card's two lines on the popover surface, floating under the header over the transcript, which never moves for it; Dismiss when it is only news |
| **page** | there is nothing else to show: an agent that cannot load, a folder that is not there, an agent list that cannot be read, a view that could not be drawn | centred in the pane: a 32px tile with the mark, a 15px title, the sentence, the well, the buttons |

Setup pages (no agents yet, a folder with no agent yet) wear the page's shape with an accent mark, so a
first step and a problem look like the same app. A roster row says a problem in one short word and
keeps the original on hover; its quote of a conversation that ended in a problem is that problem's
title, not the provider's JSON.

## 10. Motion

One easing, `cubic-bezier(0.2, 0, 0, 1)`, and four named shapes. The vocabulary is borrowed from
Beautiful UI, not its components: a small set of movements used consistently is what reads as
polish, and a large set used occasionally is what reads as a demo.

| Shape | What it is | Where |
|---|---|---|
| `enter` | opacity plus a 6px rise, 180ms | anything arriving in the transcript: a message, a tool call, the live status. Not history — opening a conversation shows its backlog still |
| `pop` | opacity plus scale from 0.96, 160ms | something appearing in place rather than arriving: `back to the latest` |
| `shimmer` | a highlight swept across the words, 2.4s, looping | work in progress: the live status's step, `thinking` while it streams |
| `bounce` | a dot rising and falling, squashing where it lands, 900ms, looping | the live status's mark: duang is the sound of one, and a ball in motion reads as alive where a pulse reads as waiting |

`shimmer` replaces blinking a label's opacity, which is the cheapest-looking thing an interface can
do and which sits on screen for minutes at a time here.

Disclosures open by growing. `interpolate-size: allow-keywords` plus a transition on
`::details-content` animates to automatic height with no JavaScript measuring anything — this is
Electron on a known Chromium, so the feature is simply available. Both disclosures in the app, a
tool call and a thinking block, go from one line to a block of output, which was the jump that made
the transcript feel like it was redrawing itself.

Hover backgrounds are 100ms, popovers 120ms, and the conversation dot breathes at 1.8s. An avatar's
ring stands still: its face moves instead (a blink every 4.4s, a scan of 1.6s, a hop of 0.9s, §3). Streaming text is not animated: token arrival is the animation, and a
transition on top of it produces jitter. Everything collapses to instant under
`prefers-reduced-motion`.

## 11. Accessibility

Focus ring is `2px accent` at 2px offset, on `:focus-visible` only, and never on text fields, whose
caret and container already say it. Body contrast stays at or above 4.5:1 in both modes. Status
follows §9; no state is colour alone.

**The roster is one tab stop** (WAI-ARIA APG): Tab reaches it, arrows move inside it. Up and Down
walk the agents, Home and End jump to its ends, and Enter opens the one the keyboard is on. The
keyboard starts on the open agent and stays where it was last moved. A row's name is its label and
its second line its description, so the unread count and `working` are read out with it.

**The conversation list is reached from its button.** Tab from the header's list button enters the
open panel; Up and Down move between conversations, and Delete or Backspace removes the one the
keyboard is on — Backspace because on macOS that is the delete key on the main keyboard — handing
the focus to its neighbour. Neither touches a conversation the runtime has never heard of, which
has no delete control either. The `…` on each row is not a tab stop: the context menu (Shift+F10)
and Delete are its keys. A newly created conversation hands the focus to its composer.

**The transcript is a focusable region**, named, so it can be read and scrolled without a pointer —
Chromium gives a scroll container the arrow keys once it has focus.

## 11b. Keys

The whole list, so it lives in one place instead of being read out of the handlers.

| Key | Where | Does |
|---|---|---|
| `⌘N` | anywhere | New conversation in the open agent; focus its composer when ready |
| `Esc` | anywhere | Stop the running turn (a popover or the conversation list, then Settings, takes it first) |
| `⌘,` | anywhere | Open Settings (the App menu's Settings…); again keeps it open |
| `↑` `↓` `←` `→` | Settings, a choice group | Move the choice; the group is one tab stop, on the checked row |
| `Tab` | anywhere | Sidebar → transcript → composer |
| `↓` `↑` | roster | Move between agents |
| `Home` `End` | roster | First and last agent |
| `Enter` `Space` | roster | Open the agent |
| `Shift+F10`, `Menu` | roster | Its menu: `Rename…` |
| `Enter` `Space` | header's list button | Show or hide the conversation list |
| `↓` `↑` | conversation list | Move between conversations |
| `Shift+F10`, `Menu` | conversation list | Its menu: `Rename…`, `Delete Conversation` |
| `Delete` `Backspace` | conversation list | Delete it, after confirming |
| `Esc` | conversation list | Close it |
| `Enter` | renaming an agent or a conversation | Keep the name |
| `Esc` | renaming an agent or a conversation | Drop it |
| `Enter` | composer | Send |
| `⇧Enter` | composer | Newline |
| `/` | composer | Command completion |
| `↓` `↑` | composer, list open | Move through the completions |
| `Enter` `Tab` | composer, list open | Accept the name rather than send; a skill is inserted as `/skill:<name>`, the spelling pi runs |
| `Esc` | composer, list open | Dismiss the completions |
| `Esc` | model picker | Close it and return focus to the chip that opened it |
| arrows, `PageUp` `PageDown` | transcript, focused | Scroll, from Chromium |

An IME composing text keeps `Enter`: sending there would cut a word in half.

Deliberately absent: `F2` for rename, which is the Windows convention (see §8), and global search.
Add a shortcut only when there is an implemented search surface to focus.

## 12. Brand

The product is `duang`, lowercase everywhere — repository, documentation, window, marketing. The
wordmark is followed by a single accent dot: `duang·`. It is weight 500 with -0.01em tracking in
dark mode, and slightly bolder (600, -0.025em) in light mode. The name is playful enough on its own.

Agent avatars are circles, because the product's whole metaphor is "an agent is a contact" and the
roster should read as one; rounded squares ("squares are programs") kept it reading as a list of
tools. Settings offers seven styles, each previewed on the same four agents: **Gaze** (the default:
shapes with eyes, in the agent's own colour, the one style whose eyes can move), **Moods**, **Clay**, **Bottts**,
**Pixelbot**, **Initial face** and **Initials** (the first two letters or digits, punctuation skipped,
`a-very-long-name` is `AV`, in near-black over a gradient in the agent's colour, §4). The drawn ones
are DiceBear's (CC0, except Bottts, which Pablo Stanley gives free for personal and commercial use),
made in the page as inline SVG, nothing fetched; every style but Gaze, a shape on nothing, is cut to a
circle, and Gaze is drawn at 1.2 so its shape fills one. Every style wears the agent's colour (§4) on its
largest part (Moods' face, Clay's body, the Bottts and Initial face ground, Pixelbot's glow), so no two
of the first sixteen agents share one in any style; left to DiceBear, the colour is a hash of the id
into the style's own few, and a handful of agents often repeat one. The drawing is the agent's identity and never
changes; its face follows the state (§3), so an agent looks like the same agent whether it is busy or idle.

## 12b. Settings: model providers and network (shipped)

Behaviour is in interaction.md: [Settings and Network](interaction.md#shipped-local-workbench)
(shipped) and [providers](interaction.md#connecting-model-providers-stage-1-first-version-shipped) (first version shipped);
this is how it should read. References: Zed's AI settings, which name subscriptions and API access
as different things; Codex's "Sign in with ChatGPT / API key" pair; macOS System Settings' rows that
open in place. Refused: a connect dialog, which covered the list it was adding to; Cherry Studio's
dense per-provider forms, where a `Check` beside the key field read as a key check but tested a model.

```
Settings                                                        ×

MODEL PROVIDERS
╭─────────────────────────────────────────────────────────────────╮
│ [A\] Anthropic        5h ▬ 18% ~ 03:22  7d ▬ 62% ~ Thu 00:22  ⋯ │
│      Claude Pro/Max                                             │
│   ───────────────────────────────────────────────────────────── │
│ [G]  Google                                                   ⋯ │
│      from GEMINI_API_KEY                                        │
╰─────────────────────────────────────────────────────────────────╯

ADD A PROVIDER
╭─────────────────────────────────────────────────────────────────╮
│ ⌕    Search providers                                           │
│   ───────────────────────────────────────────────────────────── │
│ [◎]  GitHub Copilot                                           ⌄ │
│      Subscription · API key                                     │
│      ╭──────────────────────────╮ ╭──────────────────────────╮  │
│      │ ◍ Subscription           │ │ ⚿ API key                │  │
│      │   Sign in with your plan │ │   Pay as you go          │  │
│      ╰──────────────────────────╯ ╰──────────────────────────╯  │
│   ───────────────────────────────────────────────────────────── │
│ ⌄    More providers                                          33 │
╰─────────────────────────────────────────────────────────────────╯

NETWORK
╭─────────────────────────────────────────────────────────────────╮
│ Automatic                                                     ✓ │
│ http://127.0.0.1:7897 · connected · 320 ms ⟳                    │
│   ───────────────────────────────────────────────────────────── │
│ Manual                                                          │
│ Not set                                                         │
│   ───────────────────────────────────────────────────────────── │
│ Off                                                             │
│ Connect directly                                                │
╰─────────────────────────────────────────────────────────────────╯

MANUAL PROXY                               (only while Manual is chosen)
╭ HTTP / HTTPS / SOCKS5, one checked ╮  ╭ Server │ Port ╮  [Use this proxy]
```

- Shipped, drawn the way Telegram draws its settings: a muted heading over an inset card
  (`surface`, hairline ring, radius 14; the heading is sentence case at 12, like every other label,
  since small caps appear nowhere else in the app) on the plain canvas, rows divided by hairlines that start
  where the text does, the choice marked by a trailing accent ✓ rather than a leading radio, and
  fields as rows (a label, then the value) rather than one URL to spell. The chosen row carries the
  connection's state as its second line — `connected · 320 ms` in the accent, or `unreachable
  (ECONNREFUSED)` in danger with the whole error on hover — instead of a *Test connection* button.
  The route is the proxy or `Direct`, nothing more: the chosen row already says where it comes
  from. The one surprise — a terminal launch whose `HTTPS_PROXY` overrides the system — adds
  `from HTTPS_PROXY` to it, with how to get the system's route back on hover. No explanatory
  footnotes or third lines. Not taken from Telegram: the sidebar does not turn into a settings
  list, because running work must stay visible; a category list will head the page once there is
  a second group.
- The App menu's **Settings…** (`⌘,`, where macOS apps keep app-level settings) and a Settings row
  at the foot of the sidebar open Settings in place of the conversation, 600 wide. The row is a
  gear and the word, muted, set apart from the roster by a hairline and not beside its `+`: that
  header acts on the agent list, Settings is app-level and rarely used, and it is a place rather
  than an action, so it takes the selection mark while open. It is its own tab stop after the
  roster. Escape or the close control returns to the conversation.
- Providers are two inset cards in the Network group's style, each row led by the provider's logo
  on a neutral 32px tile (LobeHub's SVGs, vendored with their license; initials on the same tile
  when there is none), because names alone blur together (OpenAI, Azure OpenAI, OpenRouter).
  *Model providers* lists what serves each one now, in the person's words (`Claude Pro/Max`,
  `API key`, `from GEMINI_API_KEY`); a subscription adds its plan windows, used and when each
  resets, only once read (the pace stays in the tooltip; a failed read shows nothing, as in the header).
  Each row's actions are a `⋯` native menu (Reconnect…, Disconnect), and Disconnect is confirmed in
  the row itself, `ghost` Cancel beside `danger` Disconnect. An unreadable credential file replaces
  the rows with its error, Reveal and Retry, never an empty group (§9).
- *Add a provider* starts with its search field and ends with *More providers* and the count: the
  eight most people connect come first, the rest alphabetically behind it, all by pi's own names.
  One row is open at a time, on `bg-hover`, and opening one closes the other. An open row shows
  its ways as two equal cards, a Globe or Key tile with the plan or `API key` and one line of what
  it means, never the provider's name again; a connected row opens the same way from its menu,
  saying first that connecting replaces what is saved.
- The sign-in draws inside the row, indented to the text, and the row's second line says what is
  happening (`Signing in with Claude Pro/Max`, `Adding an API key`). States are one line with a
  16px mark column so the detail aligns with the words: a pulsing accent dot for waiting, a danger
  dot for a refusal or failure. The key field shows the key as typed, 28px high, placeholders in
  sans and values in mono. A device code is monospace at 20px with a Copy control; a browser step
  shows waiting status with `Open again` and `Copy link`, and folds the paste-a-code field under
  it. *Connecting to {provider}…* between steps appears only after half a second, so a step that
  follows within a frame does not flash it. There is no Cancel: the row's header closes it.
- Success closes the row and marks the provider in the list above with a `success` badge
  (`connected`, 4 s) or a `warning` one (`saved · key not checked`, 8 s), scrolled into view.
