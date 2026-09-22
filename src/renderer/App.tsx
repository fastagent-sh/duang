import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DuangApi } from "../preload/index.ts";
import { createStore } from "./store.ts";
import { rows } from "./sessions.ts";
import {
  BrokenAgent,
  Composer,
  ConversationHeader,
  NeedsAgent,
  NewConversation,
  NoAgents,
  Sidebar,
  Transcript,
  UnreadableRegistry,
} from "./panels.tsx";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [store] = useState(() => createStore(duang));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { agents, agentId, states, sessions, conversation: c } = view;
  const agent = agents.find((row) => row.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  const busy = view.busy;
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "n" && agentState === "ready" && !view.loading) {
        event.preventDefault();
        void store.newConversation();
      }
      // The open model picker stops Escape itself, so reaching here means no dialog wanted it.
      if (event.key === "Escape" && busy) void store.abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, agentState, busy, view.loading]);

  // Which agents show their conversations. Selecting one opens it, because you have to see where
  // you are; the caret adds and removes any other.
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    if (agentId) setExpanded((ids) => (ids.includes(agentId) ? ids : [...ids, agentId]));
  }, [agentId]);

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
  const composer = <Composer view={view} store={store} />;
  // States whose own panel already explains the setup problem and offers the fix. Repeating the
  // runtime's prose above them contradicts it: a plain project is told to run `fastagent init`
  // while duang is offering to scaffold it.
  const owned = agentState === "broken" || agentState === "missing_model" || agentState === "no_agent";
  const error = c?.error ?? (owned ? undefined : view.error);

  const usage = c?.state?.usage;
  const pending = c?.state?.pending;

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
        rowsFor={rowsFor}
        session={c?.session}
        expanded={expanded}
        errors={view.sessionsError}
        disabled={agentState !== "ready" || view.loading}
        onSelect={(id) => {
          // Clicking the row opens the agent and shows what it has been doing; clicking the agent
          // you are already on puts that list away. The caret does the same for any other agent,
          // which is the part the row cannot express.
          if (id === agentId) setExpanded((ids) => (ids.includes(id) ? ids.filter((o) => o !== id) : [...ids, id]));
          else void store.selectAgent(id);
        }}
        onToggle={(id) => {
          const showing = !expanded.includes(id);
          setExpanded((ids) => (showing ? [...ids, id] : ids.filter((other) => other !== id)));
          // Reading a list is what needs the runtime; putting it away does not.
          if (showing) void store.listSessions(id);
        }}
        onAdd={() => void store.addAgent()}
        onOpen={(agent, id) => {
          // Going to another agent's conversation is one navigation, not a switch followed by an
          // open: the second one would land wherever the selection had moved to by then.
          if (agent !== agentId) void store.selectAgent(agent, id);
          else void store.open(id);
        }}
        onNew={() => void store.newConversation()}
        onRename={(agent, id, name) => void store.renameSession(agent, id, name)}
        onMenu={(canRename) => duang.conversationMenu(canRename)}
        onDelete={(agent, id) => {
          if (confirm("Delete this conversation? Its history is gone.")) void store.deleteSession(agent, id);
        }}
      />
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0">
        {agent && (
          <ConversationHeader
            agent={agent.name}
            title={sessionRows.find((row) => row.session === c?.session)?.label ?? agent.name}
            dir={agent.dir}
            working={!!view.running[agent.id]?.length}
            context={
              usage?.contextTokens !== undefined && usage.contextWindow
                ? Math.round((usage.contextTokens / usage.contextWindow) * 100)
                : undefined
            }
            queued={pending ? pending.steering + pending.followUp : undefined}
            onReveal={() => void store.reveal()}
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
        ) : !c || c.items.length === 0 ? (
          <NewConversation agentName={agent?.name ?? ""}>{composer}</NewConversation>
        ) : (
          <Transcript key={c.subscription} items={c.items} busySince={c.busySince} bottomGap={composerHeight + 32} />
        )}
        {agentId && agentState === "ready" && c && c.items.length > 0 && (
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
      </main>
    </div>
  );
}
