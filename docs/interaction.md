# Interaction

This is the behavior and failure contract. [Product design](design.md) owns the surfaces;
[architecture](architecture.md) owns state and trust boundaries. The local behavior below shipped
with Week 1 and subsequent UI work; later stages are **planned**, not implemented. See
[acceptance status](../README.md#week-1-acceptance-status) for known runtime limitations.

## Shipped local workbench

The window has a 240–320px sidebar of agent rows, and a transcript with its own floating header
and composer. There is no separate agent rail. Each agent row shows its name, two lines quoting the
newest output of the conversation a click on it would show, that output's time, and a count of
outcomes nobody has looked at yet. The quote streams while duang holds that conversation (on
screen, or running in the background); otherwise it is read once from the conversation's history
and again when the session list says it moved on, so a run driven from outside duang appears when
the list is next read. While one of its conversations runs the row says `working` in place of the
time; a setup problem or an unreadable list or history replaces the quote. Reading every row's list
at launch boots each agent's runtime. A failed list read is shown on
that agent's row, not as an empty list. An agent's name can be changed from its row's context menu
or by double-clicking it; this renames duang's registry entry, never the directory.

Clicking an agent row restores its last open conversation if still available, otherwise an active
run, then the most recent conversation (or a new one). The open agent's conversations are in a list
the header's list button shows and hides; it floats under the button, closes on a click outside or
Escape (without stopping a run), and closes when a conversation is chosen or started. Running and
drafted work stays attached to its originating agent and conversation when navigating.

Adding an agent chooses a directory; a plain project can be scaffolded after confirmation. A
broken agent shows its original failure with a way to retry, reveal or remove it. Removal deletes
only the local registry row, not the directory or history. Changing the model or removing an agent
is refused while one of its conversations is running, including a turn still opening the runtime.
The picker lists the models the open agent can run: pi's built-ins, the agent's own
`fastagent/models.json` and the machine's `~/.fastagent/models.json`, each kept to providers with a
configured credential: in the credential file, in an environment variable, or as a key written in
that `models.json`. Switching agents with the picker open reads the new agent's list. It
leads with the selected model and a short credential-file label; expanding the label reveals the
complete FastAgent path. Configuration is not a provider probe.
The model on a historical conversation can differ from the agent's default.

Settings open from the App menu's **Settings…** (`⌘,`) or the Settings row at the foot of the
sidebar, in place of the conversation; the sidebar stays, and choosing a conversation, `⌘N`, the
close control or Escape returns to it. Opening it again while it shows keeps it open. **Network** has three choices, saved to
`userData/settings.json` and applied at once to new requests (a running turn keeps its
connection). *Automatic* resolves the route for each request from the system, so switching a VPN
client on or off needs no action in duang, when duang was launched without proxy variables. If it
was launched from a terminal with `HTTPS_PROXY` or `ALL_PROXY` set, *Automatic* uses that, names
it as the source and does not follow system changes until duang is relaunched from the Dock or
Finder; *Manual* and *Off* still override it. *Manual* is a type (HTTP, HTTPS or SOCKS5), a
server and a port; choosing it with nothing saved applies nothing until **Use this proxy**, and each
field that cannot work says so (`Server is required`, `Port is a number from 1 to 65535`) and
nothing is saved. The chosen row shows the route model requests take now and checks it with one
request on opening and after every change: `connected · 320 ms` for any HTTP answer, or
`unreachable (ECONNREFUSED)` with the full error, naming the route, on hover; a refresh control
checks again. A route duang cannot take (a PAC answer such as SOCKS4) shows as `unsupported proxy
route` and fails model requests with that reason; if only the route for agent commands is
unusable, they get no proxy variables and the page says so in red. Neither stops duang from
starting or sending. Choices are applied one at a time in the order made. A launch proxy variable
with a user name or password (`http://user:pass@proxy:8080`) cannot be used, because duang cannot
authenticate to a proxy yet: *Automatic* then shows `unsupported proxy route` and every request
fails with that reason rather than the proxy's bare 407; relaunch without them, or choose *Manual*
or *Off*. Each choice group is one tab stop on its checked row; the arrow keys move the choice.
A model request through an unreachable proxy fails with whatever its provider SDK reports, often only a
connection error; duang never falls back to a direct connection, which may be blocked or may
bypass a route the person chose. A settings file that cannot be read is reported at launch and on
the page, with Reveal and Retry, and is never shown as or overwritten with the defaults; the
network follows the system proxy until it is fixed.

The conversation header shows what is left of the plan paying for it: for a Claude or ChatGPT
subscription login of the conversation's own provider, each window's share used, its reset time, and
for windows of a day or more the pace against the clock (`▼` under, `▲` over). An API key shows
nothing, because it has no plan windows. Opening a conversation, changing its provider and a run
starting or ending ask again; main answers from a three-minute cache, since Anthropic's route answers 429 when
polled. A failed read replaces the numbers with `usage unavailable` and the first line of the
provider's error on hover (without any call stack the message carries), never a stale percentage. Context appears as `45.1%/1.0M` once FastAgent reports it
([fastagent#608](https://github.com/fastagent-sh/fastagent/issues/608)).

A conversation is created immediately and becomes a runtime-owned row. Selection reads FastAgent
history; the client does not save a second transcript. A conversation can be renamed and deleted,
with destructive deletion confirmed. The current local view keeps unsent text with its conversation
across navigation and application restart. A send rejected before admission remains a draft; a
failed run may already have performed tool work. Stop does not roll back completed work or promise
to cancel a non-cancellable tool.

The composer sends with Enter, inserts a newline with Shift+Enter and leaves IME composition to
the input method. `⌘N` or the sidebar's New conversation action starts a conversation in the open
agent and focuses its composer when ready; Escape dismisses an active overlay before it can stop a
run. While a run is live the composer steers it; the runtime decides the actual admission. A sent message waits below the output until the runtime reports it entering the conversation, and is placed there; one the run ends with still queued returns to the draft. A refused send is not shown as delivered. The roster is one tab stop with arrow
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

## Planned: providers and reasoning effort (stage 1)

**Model picker.** The list is already the open agent's, custom endpoints included (#59). With
nothing configured it offers **Connect a provider**; otherwise it ends with **Manage providers…**.
Both open Settings.
Returning from a successful connection reopens the picker without choosing a model for the person.

**Connecting.** The flow is driven by FastAgent's login
([fastagent#602](https://github.com/fastagent-sh/fastagent/issues/602)) and rendered by the kind
of step it asks for, never by per-provider screens: a browser sign-in opens the system browser and
offers *Open again* and *Copy link*, with a folded field for pasting a code or redirect URL when
the browser is on another device (the field disappears if the browser callback wins); a device code
is shown large with *Copy* and a link to the verification page, counting down if it expires; a key
is a masked field that is cleared once submitted and never stored in drafts; a choice is a list.
A key is verified once: a rejected key (HTTP 401) is asked for again with the provider's reason; a
key that could not be verified is saved with that warning. Cancel, Escape or closing the window
ends the flow and writes nothing, with no error shown. Any other failure (port in use, token
exchange, network) shows the original message with *Try again* and *Back*. A provider holds one
stored credential, so connecting either kind over the other (a key over a subscription login, or
the reverse) says first that it will replace it.

**Disconnecting** removes the stored credential and is confirmed with its reach: the credential
file is shared with the CLI and every agent on this machine. If an environment variable also
supplies the provider, the confirmation says requests will continue with that variable (named);
otherwise it says conversations using the provider fail on their next request with the provider's
own error. A variable is shown on the row beside any stored credential and cannot be removed here.

**Custom endpoints** require a name, API type, base URL and at least one model; a key is optional
for a local server. The name becomes a new provider id: an id that is already a built-in provider is
refused, so a relay cannot silently take over a built-in provider's credentials. A machine models
file that cannot be read or parsed is shown as that error at the providers list, never as "no custom endpoints", and is never overwritten.

**Reasoning effort** sits beside the model on the conversation, lists the levels the conversation's
current model supports (`availableThinkingLevels`) and is hidden when there are none. A choice
applies to that conversation only; unchanged conversations follow the agent's `thinkingLevel`.
While the conversation has a turn running the control is disabled with the reason "Stop the turn
to change reasoning effort": FastAgent refuses a session update while its lease is held
(`SessionBusy`) rather than queueing it, the same as a model change.

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
