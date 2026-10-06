import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DuangApi } from "../preload/index.ts";
import { createStore } from "./store.ts";
import { rows } from "./sessions.ts";
import { queueView } from "./transcript.ts";
import { BrokenAgent, MissingFolder, NeedsAgent, NewConversation, NoAgents, UnreadableRegistry } from "./panels.tsx";
import { Problem } from "./problem.tsx";
import { ArrowClockwise } from "@phosphor-icons/react";
import { ConversationList, Sidebar } from "./rows.tsx";
import { ConversationHeader } from "./header.tsx";
import { Transcript } from "./transcript-view.tsx";
import { Composer } from "./composer.tsx";
import { Settings } from "./settings.tsx";
import { AvatarStyleContext } from "./avatar.tsx";
import { faceOf } from "./face.ts";
import { Boundary, Button } from "./ui.tsx";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [store] = useState(() => createStore(duang));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { agents, agentId, states, sessions, conversation: c } = view;
  const agent = agents.find((row) => row.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  const busy = view.busy;
  // Navigation waits while the agent opens or its model is being set up, as the picker does.
  const held = view.loading || (!!agentId && view.changingModel === agentId);
  // Where the content area is: the conversation, or duang's own settings. Presentation only, so it
  // is not remembered across launches. Settings reached from the model picker carries that with it:
  // its "Connect a provider" lands on the providers to add, and a connection made from there
  // returns to the picker. It is part of the same state so that every way out of Settings drops it.
  // `reconnect`: reached from a problem with a provider's sign-in, whose row opens; a connection made there
  // returns to the conversation, where Retry waits.
  // `network`: reached from a problem reaching a provider, with the proxy settings in view.
  const [settings, setSettings] = useState<false | { fromPicker?: true; reconnect?: string; network?: true }>(false);
  const openSettings = () => setSettings((open) => open || {});
  // Whether the conversation list is showing, for the header button's pressed look. The popover owns
  // the fact; this mirror arrives a task later, with the popover's `toggle` event.
  const [listOpen, setListOpen] = useState(false);
  // Only the open agent has running and drafted conversations worth marking; another agent's list
  // is just its history.
  const rowsFor = (id: string) =>
    rows(
      sessions[id] ?? [],
      id === agentId ? c?.session : undefined,
      view.running[id],
      view.unsent[id],
      view.unseen[id],
    );
  const sessionRows = rowsFor(agentId ?? "");

  useEffect(() => {
    // Main opens the page with `#fresh` after repeated crashes; read once, so ⌘R later reopens as usual.
    const fresh = window.location.hash === "#fresh";
    if (fresh) history.replaceState(null, "", window.location.pathname + window.location.search);
    void store.load({ fresh });
    return store.dispose;
  }, [store]);
  // The App menu's Settings… (⌘,) opens the page; asking again while it is open keeps it there.
  useEffect(() => duang.onOpenSettings(openSettings), []);
  const newConversation = useCallback(() => {
    const opened = store.newConversation();
    const target = store.getSnapshot().conversation;
    void opened.then(() => {
      const current = store.getSnapshot();
      // The fixture cannot delay session:open to test a late result. Match the originating
      // conversation so a completion after navigation cannot steal another conversation's focus.
      if (target && current.conversation === target && !current.blocked)
        document.querySelector<HTMLTextAreaElement>('main textarea[aria-label="Message"]')?.focus();
    });
  }, [store]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "n" && agentState === "ready" && !held) {
        event.preventDefault();
        setSettings(false);
        newConversation();
      }
      // Escape leaves Settings before it can reach a run: stopping work you cannot see is a surprise.
      if (event.key === "Escape" && settings) {
        setSettings(false);
        return;
      }
      // The open model picker stops Escape itself; the conversation list is a native popover, which
      // closes on this same Escape. Asked of the popover itself, not of `listOpen`: an Escape the
      // instant after the list opens arrives before that mirror does, and would stop the run.
      const listShowing = document.getElementById("conversations")?.matches(":popover-open");
      if (event.key === "Escape" && busy && !listShowing) void store.abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newConversation, store, agentState, busy, held, settings]);

  // The composer floats over the transcript, so the transcript has to know how tall it is: it grows
  // with the draft, and messages must end above it rather than behind it. The ref is stable, or
  // every streamed delta would tear down and rebuild the observer.
  const [composerHeight, setComposerHeight] = useState(96);
  const observer = useRef<ResizeObserver>(undefined);
  const composerBox = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setComposerHeight(entry!.contentRect.height));
    observer.current.observe(el);
  }, []);

  // The dock carries the same count the sidebar does, for the times duang is not the window in front.
  const unseenCount = Object.values(view.unseen).reduce((sum, byAgent) => sum + Object.keys(byAgent).length, 0);
  useEffect(() => {
    void duang.setUnseenCount(unseenCount);
  }, [unseenCount]);

  const remove = () => {
    if (confirm("Remove this agent from duang? The directory is not touched.")) void store.removeAgent();
  };
  const composer = (
    <Composer
      view={view}
      store={store}
      onProviders={() => setSettings({ fromPicker: true })}
    />
  );
  const usage = c?.state?.usage;
  const pending = c?.state?.pending;
  const waiting = c ? queueView(c.waiting, pending?.steering ?? []) : [];
  const { pane, alert } = view;
  // A transcript fills the pane, and the header and composer float over it. A new conversation's composer sits
  // where its transcript's will, so sending the first message does not move it.
  const reading = pane === "settling" || pane === "transcript" || pane === "start";
  // The plan that pays for this conversation: its own model's provider, which may differ from the
  // agent default.
  const provider = (c?.state?.model ?? view.model)?.split("/")[0];
  useEffect(() => {
    if (provider) void store.loadUsage(provider);
  }, [provider, busy, c?.session, store]);
  // A problem with this provider's sign-in names it on its button, by pi's name for it, once that is read.
  const last = c?.items.at(-1);
  const signInProblem = last?.kind === "note" && last.fix === "providers";
  useEffect(() => {
    if (signInProblem && !view.providers) void store.loadProviders();
  }, [signInProblem, store]);
  const providerName = provider && (view.providers?.find((row) => row.id === provider)?.name ?? provider);

  return (
    // Panels float on the window's canvas rather than filling it edge to edge: the gap is what makes
    // the sidebar read as a surface of its own.
    // Every avatar is drawn in the style Settings chose; a change there redraws them all at once.
    <AvatarStyleContext.Provider value={view.avatar}>
      <div className="flex h-full gap-2 p-2">
        <Sidebar
          agents={agents}
          agentId={agentId}
          states={states}
          running={view.running}
          doing={view.doing}
          unseen={view.unseen}
          previews={view.previews}
          latest={(id) => rowsFor(id).find((row) => !row.fresh)}
          errors={view.sessionsError}
          settingsOpen={Boolean(settings)}
          onSelect={(id) => {
            // Any way into a conversation leaves Settings; the agent you were on comes back as it was.
            setSettings(false);
            if (id !== agentId) void store.selectAgent(id);
          }}
          onAdd={() => {
            setSettings(false);
            void store.addAgent();
          }}
          onSettings={openSettings}
          onRename={(id, name) => void store.renameAgent(id, name)}
          onReveal={(id) => void store.reveal(id)}
          onMenu={duang.menu}
        />
        <main className="relative flex-1 flex flex-col min-w-0 min-h-0">
          {settings ? (
            <Settings
              view={view}
              store={store}
              connectOnOpen={settings.fromPicker}
              reconnect={settings.reconnect}
              network={settings.network}
              onConnected={() => {
                if (settings.reconnect) return setSettings(false);
                if (!settings.fromPicker) return;
                store.openPicker();
                setSettings(false);
              }}
              onMenu={duang.menu}
              onClose={() => setSettings(false)}
            />
          ) : (
            <>
              {agent && (
                <ConversationHeader
                  id={agent.id}
                  agent={agent.name}
                  colour={agent.colour}
                  face={faceOf({
                    state: agentState ?? "ready",
                    doing: view.doing[agent.id],
                    outcomes: Object.values(view.unseen[agent.id] ?? {}),
                    open: false,
                  })}
                  dir={agent.dir}
                  working={view.busy}
                  others={(() => {
                    const others = (view.running[agent.id] ?? []).filter((session) => session !== c?.session);
                    if (!others.length) return undefined;
                    return { count: others.length, open: others.length === 1 ? () => void store.open(others[0]!) : undefined };
                  })()}
                  context={
                    usage?.contextTokens !== undefined && usage.contextWindow
                      ? { used: usage.contextTokens, window: usage.contextWindow }
                      : undefined
                  }
                  plan={provider ? view.usage[provider] : undefined}
                  queued={pending ? pending.steering.length + pending.followUp.length : undefined}
                  list={
                    agentState === "ready"
                      ? { open: listOpen, unseen: Object.keys(view.unseen[agent.id] ?? {}).length }
                      : undefined
                  }
                  onReveal={() => void store.reveal()}
                  onUsagePage={(provider) => void store.openUsagePage(provider)}
                />
              )}
              {agent && agentState === "ready" && (
                <ConversationList
                  rows={sessionRows}
                  session={c?.session}
                  error={view.sessionsError[agent.id]}
                  disabled={held}
                  onToggle={setListOpen}
                  onOpen={(session) => void store.open(session)}
                  onNew={newConversation}
                  onRename={(session, name) => void store.renameSession(agent.id, session, name)}
                  onDelete={(session) => {
                    if (confirm("Delete this conversation? Its history is gone.")) void store.deleteSession(agent.id, session);
                  }}
                  onMenu={duang.menu}
                />
              )}
              {/* Problems about this view or about an action outside any conversation float under the header,
                  over the pane, so nothing below moves when one comes or goes (docs/ui.md §9b). */}
              {(view.failure || alert || c?.ended) && (
                <div className="pointer-events-none absolute inset-x-0 top-20 z-[7] px-6">
                  <div className="column space-y-2">
                    {view.failure && (
                      <Problem
                        layout="strip"
                        tone="error"
                        title={view.failure.title}
                        reason={view.failure.reason}
                        onDismiss={store.dismissFailure}
                      />
                    )}
                    {alert ? (
                      <Problem
                        layout="strip"
                        tone="error"
                        title={alert.title}
                        advice={alert.advice}
                        reason={alert.reason}
                        actions={
                          <Button kind="secondary" size={28} icon={<ArrowClockwise size={12} />} onClick={() => void store.retry()}>
                            Reconnect
                          </Button>
                        }
                      />
                    ) : (
                      // An ended subscription is not a failure: the conversation is intact, this view stopped
                      // listening. Said in the calm voice, with the one action that fixes it.
                      c?.ended && (
                        <Problem
                          layout="strip"
                          tone="info"
                          title="This conversation stopped updating"
                          advice="Nothing was lost. Reconnect to follow it again."
                          reason={c.ended}
                          actions={
                            <Button kind="secondary" size={28} icon={<ArrowClockwise size={12} />} onClick={() => void store.retry()}>
                              Reconnect
                            </Button>
                          }
                        />
                      )
                    )}
                  </div>
                </div>
              )}
              {pane === "unreadable-registry" ? (
                // An unreadable registry is not an empty one: offering "add your first agent" would deny the
                // failure and hand over an action that cannot succeed until the file is fixed.
                <UnreadableRegistry reason={view.registryError} onReveal={() => void store.reveal()} onRetry={() => void store.retry()} />
              ) : pane === "no-agents" ? (
                <NoAgents onAdd={() => void store.addAgent()} />
              ) : pane === "broken" ? (
                <BrokenAgent
                  message={view.error ?? ""}
                  inConfig={view.errorInConfig}
                  onFreshConfig={() => void store.resetConfig()}
                  onRemove={remove}
                  onReveal={() => void store.reveal()}
                  onRetry={() => void store.retry()}
                />
              ) : pane === "missing-dir" ? (
                <MissingFolder
                  dir={agent?.dir ?? ""}
                  onLocate={() => void store.relocateAgent()}
                  onRemove={remove}
                  onRetry={() => void store.retry()}
                />
              ) : pane === "no-agent" ? (
                <NeedsAgent dir={agent?.dir ?? ""} onCreate={() => void store.scaffold()} onRemove={remove} />
              ) : pane === "settling" ? (
                <div className="flex-1 min-h-0" aria-busy="true" />
              ) : pane === "start" || !c /* never both "transcript" and no conversation */ ? (
                <NewConversation />
              ) : (
                // 16 below the composer and 48 above it: the transcript is pinned to its bottom while a
                // run streams, so this gap *is* where the newest line lands. At 16 the line you are
                // reading sat on the composer's edge, half under the fade.
                <Boundary
                  reset={c.subscription}
                  fallback={(error) => (
                    // The sidebar and the composer stay: the person can go to another conversation, or try again,
                    // which reads it again from history, so a view that went wrong while streaming is rebuilt.
                    <Problem
                      layout="page"
                      tone="error"
                      title="This conversation could not be displayed"
                      advice="Something in it could not be drawn. Its history is safe: try again to read it afresh, or open another conversation."
                      reason={error.message}
                      actions={
                        <Button kind="primary" size={32} icon={<ArrowClockwise size={14} />} onClick={() => void store.retry()}>
                          Try again
                        </Button>
                      }
                    />
                  )}
                >
                  <Transcript
                    key={c.subscription}
                    items={c.items}
                    waiting={waiting}
                    busy={busy}
                    status={c.state?.status}
                    started={c.started}
                    heard={c.heard}
                    bottomGap={composerHeight + 64}
                    resume={store.scrollOf(c.agentId, c.session)}
                    onRest={(place) => store.rememberScroll(c.agentId, c.session, place)}
                    onUsage={(provider) => void store.openUsagePage(provider)}
                    onSettings={(where) =>
                      setSettings(where === "network" ? { network: true } : where === "providers" && provider ? { reconnect: provider } : {})
                    }
                    onPickModel={store.openPicker}
                    provider={providerName}
                    onRetry={
                      view.resend
                        ? () => {
                            // Sending it again may make the agent repeat what its tools already did.
                            if (
                              !view.resend?.toolsRan ||
                              confirm("That run already used tools. Send the message again? The agent may repeat that work.")
                            )
                              void store.resend();
                          }
                        : undefined
                    }
                  />
                </Boundary>
              )}
              {reading && (
                <>
                  {/* The edges past the floating bars are veiled, not painted over: text passing there
                      stays faintly visible, dimmed and softened the way the header itself shows it, so
                      it reads as moving on rather than cut off. The veil clears toward the page by the
                      bar's inner edge; a solid edge stopped the text at a line (#58, #62). */}
                  <div className="veil pointer-events-none absolute inset-x-0 top-0 z-[5] h-12 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
                  {/* Floating, not stacked: the transcript runs the full height of the pane and passes
                      beneath this, which is what keeps the bottom of the window from reading as a seam. */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-4">
                    <div className="veil absolute inset-x-0 bottom-0 h-28 [mask-image:linear-gradient(to_top,black_50%,transparent)]" />
                    <div ref={composerBox} className="column pointer-events-auto">
                      {composer}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </AvatarStyleContext.Provider>
  );
}
