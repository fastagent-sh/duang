# Interface design

The visual system shipped with the local Week 1 client, not a specification for every future
surface. [design.md](design.md) owns the new product paths and [interaction.md](interaction.md)
owns behavior; when they differ from a future-screen sketch here, follow those documents. The
[Chinese translation](ui.zh.md) is an archived Week 1 snapshot, not a maintained roadmap.

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

Written after walking the Week 1 acceptance matrix, where every individual signal was truthful and
the whole still read badly. The fixes for that are here, not in another round of patches
([#41](https://github.com/fastagent-sh/duang/issues/41),
[#42](https://github.com/fastagent-sh/duang/issues/42)).

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
  transcript is the work. *An avatar that performs a lifecycle* — their premise is one
  conversation per Bot plus an expressive character to animate; ours is a lettered avatar and parallel
  conversations, so the avatar carries agent presence as a quiet ring while the conversation rows say
  which one is running. *Pin and hide* — their premise is a roster of up to 50 Bots; ours starts with the few agents
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
    adjacent hues. We take the shuffle, not the palette: Telegram's avatars are saturated pastels
    against a neutral UI, and ours sit beside a violet accent, so they stay low in chroma.
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
feels alive — beside three lines of text. The first is the agent's name, with the time of what the
row quotes trailing it: the clock today, the weekday within the week, a date before that. The other
two quote the newest output of the conversation the row speaks for, clamped to two lines, with the
unread count at their trailing edge. The height is fixed, so a one-line quote does not make a short
row. The directory is in the row's tooltip and below the agent name and conversation title in the
header. When those names match, the agent name uses the full header line and retains its tooltip.

The conversation a row speaks for is the one a click on it would show: the one on screen for the
open agent, otherwise the one the agent was left on, otherwise its newest. The quote is the last
thing in that conversation — the agent's answer, the tool it is running (`bash npm run build`),
a failure note, or your own message as `You: …` — as plain text, with markdown marks dropped and
thinking passed over. While this window holds the conversation (the one on screen, or one running
in the background after you walked away from it), the quote follows it as it streams. Otherwise it
is read once from the conversation's history, through FastAgent's public `entries()`, and read again
only when the session list says the conversation moved on. Nothing of it is stored: it is
presentation, and the transcript stays the runtime's. A run started outside duang therefore shows
when the list is next read, not token by token. A history that cannot be read says so in the quote's
place rather than showing something older, and a conversation deleted from under a row is no longer
quoted.

While any of the agent's conversations runs, `working` (or `2 working`) takes the time's place: the
quote below is the work itself and must not be replaced by a word about it. The agent's setup
problem (`needs a model`, `no agent yet`, `broken`) or the reason its list could not be read takes
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

**The open agent's conversations hang from the header.** A list button at the header's trailing
edge shows and hides them in a floating panel under it, the way ChatGPT's header panels do: a
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
conversations is working, a slow accent ring breathes around it, its row says `working` in words,
and its quote streams. The conversation list carries which one: a pulsing dot and the word on that row. The ring is
never the only signal, so colour is never doing the work alone (§9).

What the avatar does not do is act. Products where the avatar performs a lifecycle — thinking,
waiting, celebrating — have one conversation per agent, an expressive character to animate, and a
consumer's relationship with it. Ours is two letters standing for a directory; a breathing ring is
presence, a performance would be costume.

**Panels float on the window's canvas.** The sidebar is a rounded card inset from the window edges
rather than a column filling them, and the conversation's header floats over the transcript as a
translucent bar instead of a full-width strip cutting the page in two. This is Telegram's desktop
composition, and its premise holds here: chrome that hovers keeps the content beneath it continuous.
What does not carry over is putting the transcript itself on a decorative canvas — theirs is bubbles
over wallpaper, ours is a document that has to stay readable — so the transcript is opaque and only
the chrome floats. The transcript starts below the header, then slides underneath it when scrolled;
a soft lower shadow keeps the two readable without stopping the page.
Its right edge says how much is left, in muted 11px text: the plan's windows as `5h ▬ 4% ~ 14:29`
with a 40px bar, the week's pace as a green `▼` or red `▲` percentage, then context as
`45.1%/1.0M`. No threshold colours: the percentage is the signal. When the header is narrower than
44rem, reset times and pace move to the tooltip and the percentages stay.
The composer floats the same way at the bottom: the transcript passes beneath it, and a short fade
behind it keeps text from sliding past its sides. Tried and reverted: a header in its own row with a
masked top edge (#58), and a solid backdrop behind the composer with a 40px fade above it (#62).
Both stopped text at a line, which made the conversation read as a framed box rather than a
continuous page.

Isolated fixture snapshots: [reading, light](screenshots/reading-light.png),
[narrow, dark](screenshots/reading-narrow-dark.png),
[conversation list, light](screenshots/conversation-list-light.png), and
[model picker, light](screenshots/model-picker-light.png), and
[settings, light](screenshots/settings-light.png). Regenerate the full dark/light set with
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
composer remains white. Violet stays in selections and actions rather than tinting every surface.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `oklch(0.225 0.004 285)` | `oklch(0.992 0.004 80)` | the transcript and its canvas |
| `surface` | `oklch(0.27 0.005 285)` | `oklch(0.986 0.004 85)` | cards and popovers; the composer is white in light mode |
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
| `warning` | `oklch(0.79 0.15 65)` | `oklch(0.58 0.15 60)` | needs a model, no agent yet |
| `danger` | `oklch(0.68 0.17 25)` | `oklch(0.52 0.19 25)` | broken, failed, destructive |

Accent as text and accent as a surface cannot be one value. As text it sits against the page, so
dark mode needs it light; as a fill under white text it must stay dark enough for primary controls
to remain legible. The fills therefore do **not** change between themes. The agent row instead uses
a translucent tint so it does not compete with the reading column.

Every interactive role is defined as a set, not derived at the call site — Telegram's palette does
this and it is why their themes stay coherent: `bg` / `bg-over` / `bg-active`, `text` / `muted` /
`fill-fg`. A component picks a role; it never computes a hover colour itself.

Avatars walk seven fixed hues, chosen by `ORDER[hash % 7]` with `ORDER = [0, 4, 1, 6, 3, 5, 2]`.
The shuffle is Telegram's and it exists so that agents registered one after another do not come out
looking alike.

## 5. Typography

```css
--font-sans: -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
--font-mono: "Maple Mono NF CN", "JetBrains Mono", "SF Mono", ui-monospace, "PingFang SC", monospace;
```

The system face, paired with the system's own CJK face. This is a native window with a hidden title
bar, and a web font beside it reads as a page rather than an app. Do not force CJK into the monospace
family; let it fall back to PingFang SC inside code contexts rather than deforming it.

**Chinese is a first-class case, and CSS cannot see it.** CJK glyphs fill their em box and want more
leading than Latin at the same size. A `:lang(zh)` rule is the obvious way to say so, and it does not
work here: the document is `lang="en"` and nothing marks a Chinese message as Chinese, so the rule
never fires once. Only a per-message script detector could, and that is a second source of truth
about the transcript bought for a difference of 0.05. Prose therefore takes **one** leading, 1.7:
right for Chinese, slightly airy for English, and this is a document column rather than a dense list.
It lives in one place, `.md, .bubble`, which the composer wears too so that a long message does not
reflow the moment it is sent.

The scale stays compact in navigation and the tool trace. Prose and headings have more space so
results can be scanned without turning the trace into a second document:

| Role | Size / line-height / weight |
|---|---|
| New conversation heading | 22 / normal / 500 |
| Answer headings | 15–17.5 / prose leading / 600 |
| Conversation prose | 14 / 1.7 / 400 |
| Agent name | 13.5 / 1.4 / 600 |
| Composer, sidebar rows | 13 / 1.7 / 400 |
| Tool rows, thinking, model list, card bodies | 12 / 1.5 / 400 |
| Code, paths, tool output | 12.5 / 1.625 / 400, mono |
| Badges, timestamps, labels | 11 / 1 / 400–500 |

Mono sits half a step above the sans beside it on purpose: its x-height is smaller, so the same
nominal size reads smaller. Nothing is drawn at 10 or 11.5 — a half-pixel step is invisible, and all
it does is stop two things that should match from matching.

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

Two heights: 28 inside rows and dense bars, 32 standing on its own. Icon-only is square at the same
height, and only where the symbol is universal (§6). Height also decides text size (11px and 12px):
Tailwind utilities all have the same specificity, so a size a call site passes would be decided by
the generated sheet's order rather than by intent. Nothing a call site can pass may contradict the
component; what varies is a prop.

**A disabled control says why.** The `disabled` prop takes the reason rather than a boolean, so a
control cannot be greyed out silently: it dims to 40% and carries the reason. In light mode the
composer's inactive Send button also takes a neutral fill. "Type a message first", "Stop the turn to change the model". It is disabled with `aria-disabled`
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

Popovers share one surface — `surface`, a rounded hairline and a shadow — even
though the model list is a modal dialog that takes focus and the slash completion list deliberately
does not. The model picker labels its purpose, puts the selected model first, shows a short credential-file label,
and expands that label to reveal the full path. Both highlight the current item with `accent-weak`.

## 7. Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32.
- Radius: 6 (badges, small controls), 10/12 (dark/light cards, bubbles, inputs), 14/18
  (dark/light floating panels). A bubble's trailing corner drops to 4 — that asymmetry is what
  makes it read as speech.
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
920px wide, with paragraphs and lists capped at 720px; code and tables retain the full width. The
composer keeps its own narrower measure (768px), because a text field as wide as the transcript
reads as a form rather than a place to type. It writes commands, output, plans, diffs and reports;
wrapping that in speech balloons
fragments a record that needs to be scanned, and gives up the width its content needs. Products that
bubble both sides keep the heavy work somewhere else — a separate workspace panel — so what remains
in the transcript really is chat. Ours is the work.

Everything else follows from those two:

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
  unwrap keeps its JSON: a result nobody can see is worse than an ugly one.
- **Thinking** collapses to one muted line (`thinking · 3s`, trailed by the line it is on) and
  expands into a quoted block.
- **System events are one centred muted line**: model changed, run stopped, a send refused. They are
  facts about the session, not things anyone said.
- **A steered message** waits below the live output, dimmed and labelled `queued`, until it leaves
  the runtime's steering list (`pending.steering`), which FastAgent defines as entering the
  conversation; only then does it take its place in the transcript. The list is the runtime's, so a
  steer queued before a reload still shows. A steer still listed when the run ends was dropped: it
  returns to the draft instead of staying on screen as delivered. Once placed it keeps its bubble and adds an accent
  rule down its leading edge with the label `joined the run`, because after the fact nothing else distinguishes it from a message that
  started one. *Only in the live view:* the fact is recorded when the message is sent, and FastAgent's
  session entries carry the text without saying a run was in flight, so a reopened conversation shows
  the bubble without the label. Deriving it would mean keeping a second record of the transcript,
  which this app does not do; making it durable is asked for upstream in
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
  long and read later, so the time is part of the record; the copy control appears on hover. A
  rating has nowhere to go here. Branching and editing are not shipped Week 1 controls; if a
  later task needs branching, its affordance belongs beside the relevant entry rather than on
  every answer.
- **Spacing is decided by the pair, not by one constant.** 32 above what someone sent, 24 wherever
  the register changes, and **8** between two asides — a tool call, a thinking line, a system note.
  Those are single lines of one activity, and giving `bash` / `thinking` / `bash` the space a
  paragraph gets is what turns a work log into a sparse list. Below the last line there is 48 before
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
| **Needs a decision** | broken, needs a model, no agent yet, failed, stopped, refused | Text always, plus icon or shape. Colour is the third signal, never the only one. |
| **Reassurance only** | working, thinking, running | A breathing ring on the agent's avatar and the word on its row, a pulsing dot and the word on the conversation row, elapsed time in the transcript. No sentence in the reading flow. |
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
counts them in a round pill the way Telegram counts unread messages (red when any of them failed,
and said in words for assistive technology and in the tooltip), the header's list button carries a
dot, and the dock carries the total so it is answerable without duang being the window in front. Tested as a tinted word first, and
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
breathing ring, the agent row says it in words (`working`, `2 working`), and the rows of the
conversation list answer *which one* with a pulsing dot and the word. Each level adds information the one above cannot
give; none of them repeats the other, and none of them is colour alone. A conversation holding
unsent text says `unsent` in the same place, because that is also work that is not finished.

The tier-1 states reach the sidebar as words too: an agent that is `broken`, `needs a model` or has
`no agent yet` says so on its row. A coloured dot on its own was colour doing the work, readable
only through a tooltip.

In the transcript, a refusal is drawn with the word `refused` beside main's own sentence, which goes
in verbatim. The tone carries the distinction the words make: nothing ran, so the message is still
the person's to edit.

## 10. Motion

One easing, `cubic-bezier(0.2, 0, 0, 1)`, and three named shapes. The vocabulary is borrowed from
Beautiful UI, not its components: a small set of movements used consistently is what reads as
polish, and a large set used occasionally is what reads as a demo.

| Shape | What it is | Where |
|---|---|---|
| `enter` | opacity plus a 6px rise, 180ms | anything arriving in the transcript: a message, a tool call, the working indicator. Not history — opening a conversation shows its backlog still |
| `pop` | opacity plus scale from 0.96, 160ms | something appearing in place rather than arriving: `back to the latest` |
| `shimmer` | a highlight swept across the words, 2.4s, looping | work in progress with nothing to show yet: `working… 12s`, `thinking` while it streams |

`shimmer` replaces blinking a label's opacity, which is the cheapest-looking thing an interface can
do and which sits on screen for minutes at a time here.

Disclosures open by growing. `interpolate-size: allow-keywords` plus a transition on
`::details-content` animates to automatic height with no JavaScript measuring anything — this is
Electron on a known Chromium, so the feature is simply available. Both disclosures in the app, a
tool call and a thinking block, go from one line to a block of output, which was the jump that made
the transcript feel like it was redrawing itself.

Hover backgrounds are 100ms, popovers 120ms, and presence breathes at 1.8s — the avatar ring and
the conversation dot together. Streaming text is not animated: token arrival is the animation, and a
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
| `Enter` `Tab` | composer, list open | Accept the name rather than send — a bare `/name` is never a message |
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
tools. The avatar shows the first two letters over a background chosen by
hashing the name across seven low-saturation hues. Identity is the avatar; presence is the ring
around it (§9), never a change to the avatar itself, so an agent looks like the same agent whether
it is busy or idle.

## 12b. Settings (network shipped) and connecting a provider (planned)

Behaviour is in interaction.md: [Settings and Network](interaction.md#shipped-local-workbench)
(shipped) and [providers](interaction.md#planned-providers-and-reasoning-effort-stage-1) (planned);
this is how it should read. References: Zed's AI settings, which name subscriptions and API access
as different things; OpenCode's connect-provider dialog, one dialog walking method, prompt, waiting
and result; Codex's "Sign in with ChatGPT / API key" pair. Refused: Cherry Studio's dense
per-provider forms, where a `Check` beside the key field read as a key check but tested a model.

```
Settings                                                        ×

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

- Shipped, drawn the way Telegram draws its settings: a small-caps muted heading over an inset card
  (`surface`, hairline ring, radius 14) on the plain canvas, rows divided by hairlines that start
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
- Planned: provider rows use the conversation-row rhythm; the authentication kind is a neutral
  badge, and a failure is a `danger` badge with its reason, never colour alone (§9).
- *Add a provider* is a searchable list grouped Subscription / API key / Custom endpoint. Choosing
  a row opens the connect dialog: the modal dialog surface (§6b), 440 wide, one `primary` action
  per step. A device code is monospace at 22px with a Copy control; a browser step shows waiting
  status with `Open again` and `Copy link`, and folds the paste-a-code field under it.
- Reasoning effort is a `ghost` chip beside the model chip, with the same popover list.

## 13. Shipped Week 1 visual pass

This list records the completed visual redesign; it is not the roadmap for the next product stages.
See [README.md](../README.md#delivery-stages) for those acceptance gates.

1. **Tokens.** Both colour modes, the font stacks, the radius and spacing scales; swap
   `lucide-react` for `@phosphor-icons/react`. No structural change, no behaviour change.
2. **Components.** Buttons (primary, secondary, ghost, danger; heights 28 and 32), badges, cards,
   popovers, composer.
3. **Status.** The single vocabulary, the three tiers, `stopped`, and presence at both levels — the
   avatar ring and the conversation dot.
4. **Sidebar.** Merge rail and list into one 240–320px column: agent rows, running and drafted
   conversations always listed, the rest folded. This one changes navigation, so every smoke
   assertion that locates a control by label has to be re-checked.
5. **Transcript.** User bubbles, the agent's document column, tool cards, centred system events, the
   steering rule, the streaming cursor.
6. **Keyboard.** Roving tabindex, focusable transcript.

Steps 1–3 and 5–6 do not change behaviour and can land with the existing tests. Step 4 does.
