# Interface design

What duang looks like and why. `docs/interaction.md` says how the app must behave; this says how it
should read. Where the two disagree, behaviour wins and this file is wrong.

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

- **Grok Bot** (desktop, and xAI's design write-up) — agents as the primary object rather than chat
  history; state carried by the agent's own presence instead of an extra indicator layer; a
  three-level view of the agent's workspace (status, preview, takeover); a heterogeneous transcript
  where conversation, system events and structured cards share one timeline. Not taken: one Bot to
  one conversation. duang's sessions are genuinely parallel.
- **Claude Code desktop** — sessions visible and filterable by state, because parallel work is the
  normal case for a coding agent.
- **Telegram** — the row rhythm of a contact list: avatar, name, one line of what happened, relative
  time. Not taken: the assumption that a contact has exactly one thread.
- **Carbon, HPE design systems, WCAG 1.4.1** — the status rules in §9.
- **macOS 26** — glass only in the navigation layer, sidebars to the window edge, native materials
  over simulated ones.

## 3. Structure

Two columns. A third appears in Week 2 and its space is reserved now so nothing has to move.

```
┌ sidebar 320 (glass) ───────────┬ conversation ──────────────┬ (week 2) ┐
│ duang·              ⌘K    ＋   │  title        model ⌄   ⏹  │  files   │
│ ┌────────────────────────────┐ │                            │  diffs   │
│ │ ◉ AM  amazonseo.ai     2m  │ │  turns                     │  settings│
│ │       reading messages/es… │ │                            │          │
│ │       ⌄ 3 more             │ │                            │          │
│ └────────────────────────────┘ │                            │          │
│   ● EX  existing-agent     1h  │                            │          │
│         你好，我是…            ├────────────────────────────┤          │
│                                │  composer                  │          │
└────────────────────────────────┴────────────────────────────┴──────────┘
```

**Sidebar rows are agents, not conversations** — one row each, with the current conversation's
preview on the second line. That row is the Telegram contact row, and an agent with one conversation
never shows anything else.

**Other conversations fold under their agent.** A `⌄ 3 more` control expands them in place: indented
rows with title, relative time and, when it applies, state. Two exceptions are never folded: a
conversation that is running, and one holding unsent text. Parallel work stays visible without being
promoted above the roster.

**Pin and hide** belong to the agent row. Hiding removes an agent from the list without stopping
anything it is doing; hidden agents live behind one entry at the bottom of the sidebar. Both are
registry fields, not new objects.

Reserved for Week 2: the right panel holds the agent's workspace — file tree, diffs, discovered
settings. It follows Grok Bot's middle level: a pinned preview you can glance at without being
drawn into operating it.

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

Grok Bot's desktop app uses bubbles on both sides, with consecutive assistant messages as separate
small bubbles; its structured results break out of the bubble as cards, and system events sit in the
middle of the timeline as one quiet line. duang takes that, with one difference: our agent writes
long technical answers, so the deciding question is not who is speaking but **whether the content can
be read at a glance**.

- **Short turns are bubbles**, both sides. The agent's running commentary ("reading the config",
  "done, here is what I found") is a series of small left bubbles, which is exactly the rhythm of an
  agent working out loud.
- **Content that needs width breaks out**: code blocks, diffs, tables, tool cards, file lists. These
  render full width in the reading column, outside any bubble.
- **A long written answer is a document**, left aligned, no bubble, capped at a 720 reading column.
- **Thinking** collapses to one muted line (`thinking · 3s`), expanding to a quoted block.
- **Tool calls are cards**: icon, command, and the state badge immediately after the command — not
  pushed to the far right where it loses its subject. Expanding shows arguments and result; results
  longer than twelve lines fold.
- **Steered messages** carry an accent rule down their leading edge and the line `joined the run`.
  Nothing else in the transcript records that today.
- **System events are centred, muted, one line**: model changed, run stopped, a send refused.
- **Streaming** ends with a block cursor `▍` trailing the text. It says "still writing" without a
  spinner, and it disappears on settle.

## 9. Status

Three tiers, decided by what the person has to do about it. This replaces the earlier rule that every
state needs a word, which would have added noise to exactly the states nobody acts on. Carbon's
guidance is explicit that an indicator with no required action should be plain text or nothing; HPE's
rule of thumb is that a status must carry at least three of colour, icon, shape and text.

| Tier | States | How it is shown |
|---|---|---|
| **Needs a decision** | broken, needs a model, no agent yet, failed, stopped, refused | Text always, plus icon or shape. Colour is the third signal, never the only one. |
| **Reassurance only** | working, thinking, tool running | Motion and shape on the agent's avatar and the conversation row; text on hover and to assistive technology. No sentence in the way. |
| **Nothing to do** | ready, completed | Show nothing. |

One vocabulary everywhere — the same condition may not be `working` in one place and `running` in
another:

`working` · `thinking` · `running` · `done` · `failed` · `stopped` · `needs a model` · `no agent yet`
· `broken`

`stopped` is new and required: a tool the person interrupted currently reports `failed`, which blames
the tool for the person's decision.

**Presence lives on the avatar.** A working agent's avatar animates; the avatar is also the identity,
so state and identity occupy one object instead of two. Hovering reveals what it is doing. This is
Grok Bot's approach and it survives our accessibility rule because the reassurance tier is precisely
the tier that does not need a sentence.

## 10. Motion

140ms, `cubic-bezier(0.2, 0, 0, 1)`. Four things move: rows expanding and collapsing (180ms),
popovers appearing (opacity plus 4px rise, 120ms), hover backgrounds (100ms), and the working
avatar (1.8s breathing loop). Streaming text is not animated — token arrival is the animation, and a
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
hues, and it is the surface that carries presence (§9).

## 13. Order of work

1. **Tokens.** Both colour modes, the font stacks, the radius and spacing scales; swap
   `lucide-react` for `@phosphor-icons/react`. No structural change, no behaviour change.
2. **Components.** Buttons (primary, secondary, ghost, danger; heights 28 and 32), badges, cards,
   popovers, composer.
3. **Status.** The single vocabulary, the three tiers, `stopped`, presence on the avatar.
4. **Sidebar.** Merge rail and list into one 320 glass column with folded conversations, pin and
   hide. This one changes navigation, so every smoke assertion that locates a control by label has to
   be re-checked.
5. **Transcript.** Bubbles, break-out cards, centred system events, the streaming cursor.
6. **Keyboard.** Roving tabindex, focusable transcript.

Steps 1–3 and 5–6 do not change behaviour and can land with the existing tests. Step 4 does.
