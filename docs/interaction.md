# Interaction

This is the behavior and failure contract. [Product design](design.md) owns the surfaces;
[architecture](architecture.md) owns state and trust boundaries. The local behavior below shipped
with Week 1 and subsequent UI work; later stages are **planned**, not implemented. See
[acceptance status](../README.md#week-1-acceptance-status) for known runtime limitations.

## Shipped local workbench

The window has a 320px sidebar combining agent rows with their explicitly expanded conversation
rows, and a transcript with a floating header and composer. There is no separate agent rail. An
agent row opens its most recent conversation; clicking it again or using its caret expands or
collapses its list. Expanding a different agent can load its conversations without navigating away.
A failed list read is shown on that agent's row, not as an empty list. Running and drafted work
stays attached to its originating agent and conversation when navigating.

Adding an agent chooses a directory; a plain project can be scaffolded after confirmation. A
broken agent shows its original failure with a way to retry, reveal or remove it. Removal deletes
only the local registry row, not the directory or history. Changing the model or removing an agent
is refused while one of its conversations is running, including a turn still opening the runtime.
The picker shows the selected FastAgent credential path; configuration is not a provider probe.
The model on a historical conversation can differ from the agent's default.

A conversation is created immediately and becomes a runtime-owned row. Selection reads FastAgent
history; the client does not save a second transcript. A conversation can be renamed and deleted,
with destructive deletion confirmed. The current local view keeps unsent text with its conversation
across navigation and application restart. A send rejected before admission remains a draft; a
failed run may already have performed tool work. Stop does not roll back completed work or promise
to cancel a non-cancellable tool.

The composer sends with Enter, inserts a newline with Shift+Enter and leaves IME composition to
the input method. `⌘N` starts a conversation in the open agent; Escape dismisses an active overlay
before it can stop a run. While a run is live the composer steers it; the runtime decides the
actual admission. A refused send is not shown as delivered. The roster is one tab stop with arrow
navigation, and the transcript is focusable. Scrolling up suspends tail-follow; a control returns
to the latest turn. A closed or failed subscription reports that it is no longer receiving updates
rather than silently leaving a run on screen forever.

Closing the window does not stop main-process work. Quitting with active local work warns that it
will interrupt the run; local work does not continue when the app and machine stop. Local channels
and routines are not started by duang. The current client has no online contacts or share UI.

## Planned: daily local use and definition inspection (stage 1)

Walk a real task through find → send → switch away → return to result → continue before adding
controls. A local owner may open a read-only detail view for the definition actually loaded by
FastAgent and relevant files/diffs; if runtime discovery is unavailable, say so. A local routine
shown in this view is **declared**, not guaranteed to run while the app is closed. Compact and
branching are conditional on demonstrated long-conversation needs, not a checklist of Pi commands.

## Planned: copy a preset (stage 2)

"Copy preset" previews exactly which portable definition files travel and explicitly excludes
secrets, private sessions, machine paths and unrelated project data. A recipient imports an
independent directory, configures their own credentials and can edit their own copy. A failed
import leaves the original untouched. Never present a preset as continued access to the author's
runtime, or imply that importing also copies their conversations.

## Planned: use an online agent (stage 3)

An owned agent may have a local test location and a separate online location; select the location
on that contact, not with a global app switch. The owner can also add a protected self-hosted agent
with no local directory. An invited agent appears under "shared with me" and exposes only the
visitor's authorized conversations. Do not expose the author's files, model credentials or owner
controls. The private online conversation is distinct from channel-group history.

An invitation is individually revocable. If access means possession of a link, say "anyone with
this link"; do not promise a named person until identity is actually verified. Losing connection
keeps unsent text, shows the endpoint's real error and marks the ongoing work as unknown until
state and entries can be read. Retry reconnects **observation**, never blindly resends accepted
tool work. Calls refused by `capabilities()` are disabled with their reason rather than failing
silently. On return, read runtime history; if partial history lacks tool args or outcomes, never
present it as a complete replay.

## Planned: hosted online work and routines (stage 4)

Before publishing, review the versioned definition snapshot, excluded files, server-side model
credentials, routine schedule and running-host cost. Publishing an agent with no channel or invite
is valid: the owner may need it only for private conversation or timed work. Keep local OAuth
credentials and local conversations on the laptop. A remote model choice is governed by the remote
runtime, not by the local credential picker.

After publish, the owner can see which definition is live, update or stop it, and see verified
routine results. A scheduled run must actually fire while the desktop and laptop are closed. Show
failed, skipped or interrupted runs as such; if the host cannot report the outcome, say it is
unknown. Do not invent a "next run" or "done" from a declaration alone. A channel is an optional
additional entrance: a private message in duang does not post into a Slack/Feishu/Telegram group.
An online agent belongs to its host when the client window closes.

## Failures everywhere

Keep the original diagnostic at the affected agent, conversation, routine or publish action, with
the action that can actually remedy it. An unreadable session list is not an empty one; a refused
send is not delivery; an accepted run is not a successful outcome. A failed update must not be
shown as a newly published version. Do not treat a lost network connection as grounds to replay a
run or routine. Preserve context across navigation without attributing a late event to a different
contact, location, session or subscription.
