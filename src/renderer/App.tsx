import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DuangApi } from "../preload/index.ts";
import { createStore } from "./store.ts";
import { rows } from "./sessions.ts";
import { queueView } from "./transcript.ts";
import { BrokenAgent, NeedsAgent, NewConversation, NoAgents, UnreadableRegistry } from "./panels.tsx";
import { ConversationList, Sidebar } from "./rows.tsx";
import { ConversationHeader } from "./header.tsx";
import { Transcript } from "./transcript-view.tsx";
import { Composer } from "./composer.tsx";
import { Settings } from "./settings.tsx";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [store] = useState(() => createStore(duang));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { agents, agentId, states, sessions, conversation: c } = view;
  const agent = agents.find((row) => row.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  const busy = view.busy;
  // Where the content area is: the conversation, or duang's own settings. Presentation only, so it
  // is not remembered across launches. Settings reached from the model picker carries that with it:
  // its "Connect a provider" opens the connect dialog at once, and a connection made from there
  // returns to the picker. It is part of the same state so that every way out of Settings drops it.
  const [settings, setSettings] = useState<false | { fromPicker?: { connect: boolean } }>(false);
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
    void store.load();
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
      if ((event.metaKey || event.ctrlKey) && event.key === "n" && agentState === "ready" && !view.loading) {
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
  }, [newConversation, store, agentState, busy, view.loading, settings]);

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
      onProviders={(connect) => setSettings({ fromPicker: { connect } })}
    />
  );
  // States whose own panel already explains the setup problem and offers the fix. Repeating the
  // runtime's prose above them contradicts it: a plain project is told to run `fastagent init`
  // while duang is offering to scaffold it.
  const owned = agentState === "broken" || agentState === "missing_model" || agentState === "no_agent";
  const error = c?.error ?? (owned ? undefined : view.error);

  const usage = c?.state?.usage;
  const pending = c?.state?.pending;
  const waiting = c ? queueView(c.waiting, pending?.steering ?? []) : [];
  // The plan that pays for this conversation: its own model's provider, which may differ from the
  // agent default.
  const provider = (c?.state?.model ?? view.model)?.split("/")[0];
  useEffect(() => {
    if (provider) void store.loadUsage(provider);
  }, [provider, busy, c?.session, store]);

  return (
    // Panels float on the window's canvas rather than filling it edge to edge: the gap is what makes
    // the sidebar read as a surface of its own.
    <div className="flex h-full gap-2 p-2">
      <Sidebar
        agents={agents}
        agentId={agentId}
        states={states}
        running={view.running}
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
        onMenu={duang.menu}
      />
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0">
        {settings ? (
          <Settings
            view={view}
            store={store}
            connectOnOpen={settings.fromPicker?.connect}
            onConnected={() => {
              if (!settings.fromPicker) return;
              store.requestPicker();
              setSettings(false);
            }}
            onMenu={duang.menu}
            onClose={() => setSettings(false)}
          />
        ) : (
          <>
            {agent && (
              <ConversationHeader
                agent={agent.name}
                title={sessionRows.find((row) => row.session === c?.session)?.label ?? agent.name}
                dir={agent.dir}
                working={!!view.running[agent.id]?.length}
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
              />
            )}
            {agent && agentState === "ready" && (
              <ConversationList
                rows={sessionRows}
                session={c?.session}
                error={view.sessionsError[agent.id]}
                disabled={view.loading}
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
            {error ? (
              <div role="alert" className="mt-14 px-6 py-2 text-danger whitespace-pre-wrap break-words">
                {error}{" "}
                <button className="underline" onClick={() => void store.retry()}>
                  Retry
                </button>
              </div>
            ) : (
              // An ended subscription is not a failure: the conversation is intact, this view stopped
              // listening. Say it in the calm voice and offer the one action that fixes it.
              c?.ended && (
                <div role="status" className="mt-14 px-6 py-2 text-muted whitespace-pre-wrap break-words">
                  {c.ended}{" "}
                  <button className="underline" onClick={() => void store.retry()}>
                    Reconnect
                  </button>
                </div>
              )
            )}
            {!agentId ? (
              // An unreadable registry is not an empty one: offering "add your first agent" would deny the
              // failure and hand over an action that cannot succeed until the file is fixed.
              view.error ? (
                <UnreadableRegistry onReveal={() => void store.reveal()} onRetry={() => void store.retry()} />
              ) : (
                <NoAgents onAdd={() => void store.addAgent()} />
              )
            ) : agentState === "broken" ? (
              <BrokenAgent
                message={view.error ?? ""}
                onRemove={remove}
                onReveal={() => void store.reveal()}
                onRetry={() => void store.retry()}
              />
            ) : agentState === "no_agent" ? (
              <NeedsAgent dir={agent?.dir ?? ""} onCreate={() => void store.scaffold()} onRemove={remove} />
            ) : !c || (c.items.length === 0 && waiting.length === 0) ? (
              <NewConversation>{composer}</NewConversation>
            ) : (
              // 16 below the composer and 48 above it: the transcript is pinned to its bottom while a
              // run streams, so this gap *is* where the newest line lands. At 16 the line you are
              // reading sat on the composer's edge, half under the fade.
              <Transcript key={c.subscription} items={c.items} waiting={waiting} busy={busy} bottomGap={composerHeight + 64} />
            )}
            {agentId && agentState === "ready" && c && (c.items.length > 0 || waiting.length > 0) && (
              // Floating, not stacked: the transcript runs the full height of the pane and passes
              // beneath this, which is what keeps the bottom of the window from reading as a seam.
              <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-4">
                {/* The composer is narrower than the reading column, so text would slide past on both
                    sides of it. The canvas fades in underneath instead. */}
                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg via-bg to-transparent" />
                <div ref={composerBox} className="composer-column pointer-events-auto">
                  {composer}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
