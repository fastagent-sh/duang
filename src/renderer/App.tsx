import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import { apply, echoUser, fromEntries, type Item } from "./transcript.ts";
import { rows } from "./sessions.ts";
import {
  BrokenAgent,
  Composer,
  ConversationList,
  Failure,
  home,
  NeedsAgent,
  NewConversation,
  NoAgents,
  NoConversation,
  Rail,
  Transcript,
  type AgentState,
} from "./panels.tsx";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [states, setStates] = useState<Record<string, AgentState>>({});
  const [broken, setBroken] = useState<string>();
  /** Storage failures reject in main and would otherwise die in an unhandled promise, leaving a
   *  corrupt registry looking exactly like an empty one. Show the message, keep the app usable. */
  const [failure, setFailure] = useState<string>();
  const report = useCallback((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)), []);
  // Any `duang.*` call can reject now that main reports storage failures instead of swallowing them.
  // One listener covers every call site, including the ones added later.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      report(event.reason);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [report]);
  const [picking, setPicking] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<string>();
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<SessionState>();
  const [draft, setDraft] = useState("");
  /** When the turn the person is waiting on began. Set on send, not on `run_started`: the wait starts
   *  at the keystroke, and the gap before the engine answers is exactly the one worth showing. */
  const [busySince, setBusySince] = useState<number>();

  const agent = agents.find((a) => a.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  /** One truth for "a turn is in flight": the local wait, which starts before the engine says anything. */
  const busy = busySince !== undefined || state?.status === "running";

  const abort = () => {
    if (agentId && session) void duang.abort(agentId, session);
  };

  async function pickModel(model: string) {
    setPicking(false);
    if (!agentId) return;
    const result = await duang.setModel(agentId, model, session);
    // A refusal is the runtime's sentence, shown where the person was looking.
    if (!result.ok) return note(result.message);
    // The row on screen still carries the old model: re-read it, or the chip lies. The conversation
    // is re-opened rather than re-selected, because the assembly was rebuilt underneath it and the
    // old event subscription died with it.
    void duang.listAgents().then(setAgents);
    if (session) void open(agentId, session, true);
  }

  // Opening straight into the last-known agent beats a landing screen whose only content is a button.
  const boot = useRef(false);
  useEffect(() => {
    void duang.listAgents().then((list) => {
      setAgents(list);
      if (!boot.current && list[0]) {
        boot.current = true;
        void selectAgent(list[0].id);
      }
    });
    // selectAgent is stable for the first run, which is the only run this effect has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const note = (text: string) => setItems((list) => [...list, { kind: "note", text }]);

  /**
   * `quiet` re-reads a conversation that is already on screen. Clearing first is right when the
   * person asked for a different conversation and wrong when nothing they can see is changing — that
   * blank frame is the flash.
   */
  const open = useCallback(async (id: string, sessionId: string, quiet = false) => {
    setSession(sessionId);
    if (!quiet) {
      setItems([]);
      setState(undefined);
      setBusySince(undefined);
    }
    try {
      const { state: opened, entries } = await duang.openSession(id, sessionId);
      setState(opened);
      setItems(fromEntries(entries.entries));
    } catch (error) {
      setItems([{ kind: "note", text: String(error) }]);
    }
  }, []);

  /** A new conversation is a minted id and nothing else: the runtime learns of it on the first turn. */
  const startConversation = useCallback((id: string) => void open(id, crypto.randomUUID()), [open]);

  const selectAgent = useCallback(
    async (id: string) => {
      setAgentId(id);
      setSessions([]);
      setSession(undefined);
      setItems([]);
      setBroken(undefined);
      setPicking(false);
      const result = await duang.openAgent(id);
      if (!result.ok) {
        const state: AgentState =
          result.code === "missing_model" ? "missing_model" : result.code === "no_agent" ? "no_agent" : "broken";
        setStates((s) => ({ ...s, [id]: state }));
        if (state === "broken") setBroken(result.message);
        return;
      }
      setStates((s) => ({ ...s, [id]: "ready" }));
      setSessions(result.sessions);
      const newest = [...result.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (newest) void open(id, newest.session);
      else startConversation(id);
    },
    [open, startConversation],
  );

  const addAgent = useCallback(async () => {
    setFailure(undefined);
    const row = await duang.addAgent();
    if (!row) return;
    setAgents((list) => (list.some((a) => a.id === row.id) ? list : [...list, row]));
    void selectAgent(row.id);
  }, [selectAgent]);

  // One subscription for the window; frames for a conversation that is no longer open are dropped.
  const current = useRef({ agentId, session });
  current.current = { agentId, session };
  useEffect(
    () =>
      duang.onSessionEvent((frame) => {
        if (frame.agentId !== current.current.agentId || frame.session !== current.current.session) return;
        if (frame.event.type === "state_changed") {
          setState((s) => ({ ...(s as SessionState), ...(frame.event.data as object) }));
        }
        // A settled run is when a fresh conversation becomes one the runtime can list, preview included.
        // Both endings of a wait: the run settled, or it never started.
        if (frame.event.type === "send_failed" || frame.event.type === "stream_failed") setBusySince(undefined);
        if (frame.event.type === "run_settled") {
          setBusySince(undefined);
          void duang.openAgent(frame.agentId).then((r) => r.ok && setSessions(r.sessions));
        }
        setItems((list) => apply(list, frame.event));
      }),
    [],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !agentId || !session) return;
    setDraft("");
    setItems((list) => echoUser(list, text));
    setBusySince(Date.now());
    try {
      await duang.send(agentId, session, text);
    } catch (error) {
      // No run started, so no `run_settled` is coming: end the wait here, or the composer stays
      // locked on "steer the run…" forever. Reporting stays with the global listener.
      setBusySince(undefined);
      throw error;
    }
  }, [draft, agentId, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && agentId && agentState === "ready") {
        e.preventDefault();
        startConversation(agentId);
      }
      if (e.key === "Escape" && busy) abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentId, agentState, session, busy, startConversation]);

  async function removeAgent(id: string) {
    if (!confirm("Remove this agent from duang? The directory is not touched.")) return;
    // Only forget the row once main says it is gone, or the sidebar would lie about the file.
    await duang.removeAgent(id);
    setAgents((list) => list.filter((a) => a.id !== id));
    setAgentId(undefined);
    setBroken(undefined);
    setSessions([]);
    setSession(undefined);
  }

  async function deleteSession(target: string) {
    if (!agentId || !confirm("Delete this conversation? Its history is gone.")) return;
    const result = await duang.deleteSession(agentId, target);
    if (!result.ok) return note(result.error.message);
    const remaining = await duang.openAgent(agentId);
    if (remaining.ok) setSessions(remaining.sessions);
    if (target === session) startConversation(agentId);
  }

  const composerBlocked =
    agentState === "broken"
      ? "this agent is broken"
      : agentState === "no_agent"
        ? "create an agent here first"
        : agentState === "missing_model"
          ? "pick a model to start"
          : !session
            ? "no conversation"
            : undefined;

  const composer = (
    <Composer
      agentId={agentId}
      context={agent ? home(agent.dir) : undefined}
      model={agent?.model}
      picking={picking}
      onPicking={setPicking}
      onPickModel={(model) => void pickModel(model)}
      busy={busy}
      onAbort={abort}
      value={draft}
      onChange={setDraft}
      onSend={() => void send()}
      disabled={!!composerBlocked}
      placeholder={composerBlocked ?? (busy ? "steer the run…" : "Ask, build, / for commands…")}
    />
  );

  return (
    <div className="flex h-full">
      <Rail agents={agents} agentId={agentId} states={states} onSelect={(id) => void selectAgent(id)} onAdd={() => void addAgent()} />

      <ConversationList
        agent={agent}
        rows={rows(sessions, session)}
        session={session}
        disabled={agentState !== "ready"}
        onOpen={(id) => agentId && void open(agentId, id)}
        onNew={() => agentId && startConversation(agentId)}
        onDelete={(id) => void deleteSession(id)}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-10 shrink-0 flex items-center px-5 gap-3 drag">
          <span className="truncate">
            {agentState === "ready" && session
              ? (rows(sessions, session).find((r) => r.session === session)?.label ?? "")
              : ""}
          </span>
          {state?.usage?.contextTokens !== undefined && state.usage.contextWindow !== undefined && (
            <span className="text-muted text-[11px]">
              {Math.round((state.usage.contextTokens / state.usage.contextWindow) * 100)}% context
            </span>
          )}
        </header>

        {failure && <Failure message={failure} onDismiss={() => setFailure(undefined)} />}

        {!agentId ? (
          <NoAgents onAdd={() => void addAgent()} />
        ) : broken ? (
          <BrokenAgent agentId={agentId} message={broken} onRemove={() => void removeAgent(agentId)} />
        ) : agentState === "no_agent" ? (
          <NeedsAgent
            dir={agent?.dir ?? ""}
            onCreate={() => void duang.scaffoldAgent(agentId).then(() => selectAgent(agentId))}
            onRemove={() => void removeAgent(agentId)}
          />
        ) : !session || items.length === 0 ? (
          // Nobody has spoken here yet: the composer IS the screen, not a strip at its foot.
          <NewConversation agentName={agent?.name ?? ""}>{composer}</NewConversation>
        ) : (
          <Transcript items={items} busySince={busySince} />
        )}

        {agentId && (broken || agentState === "no_agent") === false && session && items.length > 0 && (
          <div className="shrink-0 px-6 pb-5 pt-2">
            <div className="max-w-3xl mx-auto">{composer}</div>
          </div>
        )}
      </main>
    </div>
  );
}
