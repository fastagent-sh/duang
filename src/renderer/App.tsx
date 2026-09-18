import { useEffect, useState, useSyncExternalStore } from "react";
import type { DuangApi } from "../preload/index.ts";
import { createStore } from "./store.ts";
import { rows } from "./sessions.ts";
import {
  BrokenAgent,
  Composer,
  ConversationList,
  NeedsAgent,
  NewConversation,
  NoAgents,
  Rail,
  Transcript,
} from "./panels.tsx";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [store] = useState(() => createStore(duang));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { agents, agentId, states, sessions, conversation: c } = view;
  const agent = agents.find((row) => row.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  const busy = view.busy;
  const sessionRows = rows(sessions, c?.session, view.runningSessions);

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

  return (
    <div className="flex h-full">
      <Rail
        agents={agents}
        agentId={agentId}
        states={states}
        running={view.runningAgents}
        onSelect={(id) => void store.selectAgent(id)}
        onAdd={() => void store.addAgent()}
      />
      <ConversationList
        agent={agent}
        rows={sessionRows}
        session={c?.session}
        disabled={agentState !== "ready" || view.loading}
        onOpen={(id) => void store.open(id)}
        onNew={() => void store.newConversation()}
        onReveal={() => void store.reveal()}
        onRemove={remove}
        onDelete={(id) => {
          if (confirm("Delete this conversation? Its history is gone.")) void store.deleteSession(id);
        }}
      />
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-10 shrink-0 flex items-center px-5 gap-3 drag">
          <span className="truncate">{sessionRows.find((row) => row.session === c?.session)?.label ?? ""}</span>
          {c?.state?.usage?.contextTokens !== undefined && !!c.state.usage.contextWindow && (
            <span className="text-muted text-[11px]">
              {Math.round((c.state.usage.contextTokens / c.state.usage.contextWindow) * 100)}% context
            </span>
          )}
          {!!c?.state?.pending && c.state.pending.steering + c.state.pending.followUp > 0 && (
            <span className="text-muted text-[11px]">{c.state.pending.steering + c.state.pending.followUp} queued</span>
          )}
          {busy && (
            <button className="no-drag ml-auto text-danger" onClick={() => void store.abort()}>
              Stop
            </button>
          )}
        </header>
        {error ? (
          <div role="alert" className="px-6 py-2 text-danger whitespace-pre-wrap break-words">
            {error}{" "}
            <button className="underline" onClick={() => void store.retry()}>
              Retry
            </button>
          </div>
        ) : (
          // An ended subscription is not a failure: the conversation is intact, this view stopped
          // listening. Say it in the calm voice and offer the one action that fixes it.
          c?.ended && (
            <div role="status" className="px-6 py-2 text-muted whitespace-pre-wrap break-words">
              {c.ended}{" "}
              <button className="underline" onClick={() => void store.retry()}>
                Reconnect
              </button>
            </div>
          )
        )}
        {!agentId ? (
          // An unreadable registry is not an empty one. Offering "add your first agent" here would
          // both deny the failure and hand over an action that cannot succeed until the file is fixed;
          // the error row above already carries the path and Retry.
          !view.error && <NoAgents onAdd={() => void store.addAgent()} />
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
            <div className="max-w-3xl mx-auto">{composer}</div>
          </div>
        )}
      </main>
    </div>
  );
}
