import { useEffect, useState, useSyncExternalStore } from "react";
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
  const sessionRows = rows(sessions, c?.session, view.runningSessions, view.draftSessions);

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
        running={view.runningAgents}
        rows={sessionRows}
        session={c?.session}
        disabled={agentState !== "ready" || view.loading}
        onSelect={(id) => void store.selectAgent(id)}
        onAdd={() => void store.addAgent()}
        onOpen={(id) => void store.open(id)}
        onNew={() => void store.newConversation()}
        onRemove={remove}
        onDelete={(id) => {
          if (confirm("Delete this conversation? Its history is gone.")) void store.deleteSession(id);
        }}
      />
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0">
        {agent && (
          <ConversationHeader
            title={sessionRows.find((row) => row.session === c?.session)?.label ?? agent.name}
            dir={agent.dir}
            working={view.runningAgents.includes(agent.id)}
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
          <Transcript key={c.subscription} items={c.items} busySince={c.busySince} />
        )}
        {agentId && agentState === "ready" && c && c.items.length > 0 && (
          <div className="shrink-0 px-6 pb-5 pt-2">
            <div className="composer-column">{composer}</div>
          </div>
        )}
      </main>
    </div>
  );
}
