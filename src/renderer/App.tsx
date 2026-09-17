import { useCallback, useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import type { SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import { apply, echoUser, fromEntries, type Item } from "./transcript.ts";
import { rows } from "./sessions.ts";
import {
  BrokenAgent,
  Composer,
  ConversationList,
  ModelPicker,
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
  const [picking, setPicking] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<string>();
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<SessionState>();
  const [draft, setDraft] = useState("");

  const agent = agents.find((a) => a.id === agentId);
  const agentState = agentId ? states[agentId] : undefined;
  const running = state?.status === "running";

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

  const open = useCallback(async (id: string, sessionId: string) => {
    setSession(sessionId);
    setItems([]);
    setState(undefined);
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
        setStates((s) => ({ ...s, [id]: result.code === "missing_model" ? "missing_model" : "broken" }));
        if (result.code !== "missing_model") setBroken(result.message);
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
        if (frame.event.type === "run_settled") {
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
    await duang.send(agentId, session, text);
  }, [draft, agentId, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && agentId && agentState === "ready") {
        e.preventDefault();
        startConversation(agentId);
      }
      if (e.key === "Escape" && agentId && session && running) void duang.abort(agentId, session);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentId, agentState, session, running, startConversation]);

  async function removeAgent(id: string) {
    if (!confirm("Remove this agent from duang? The directory is not touched.")) return;
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
      : agentState === "missing_model" || picking
        ? "pick a model first"
        : !session
          ? "no conversation"
          : undefined;

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
        onPickModel={() => setPicking(true)}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-10 shrink-0 border-b border-stroke flex items-center px-4 gap-3 drag">
          <span className="truncate text-muted">
            {agentState === "ready" && session ? (rows(sessions, session)[0]?.label ?? "") : ""}
          </span>
          {state?.usage?.contextTokens !== undefined && state.usage.contextWindow !== undefined && (
            <span className="text-muted text-[11px]">
              {Math.round((state.usage.contextTokens / state.usage.contextWindow) * 100)}% context
            </span>
          )}
          {running && (
            <button
              onClick={() => agentId && session && void duang.abort(agentId, session)}
              className="no-drag ml-auto flex items-center gap-1 text-danger"
              title="Stop (Esc)"
            >
              <Square size={12} /> stop
            </button>
          )}
        </header>

        {agents.length === 0 ? (
          <NoAgents onAdd={() => void addAgent()} />
        ) : !agentId ? (
          <NoAgents onAdd={() => void addAgent()} />
        ) : broken ? (
          <BrokenAgent agentId={agentId} message={broken} onRemove={() => void removeAgent(agentId)} />
        ) : picking || agentState === "missing_model" ? (
          <ModelPicker
            agentId={agentId}
            onPicked={() => {
              setPicking(false);
              void selectAgent(agentId);
            }}
          />
        ) : !session ? (
          <NoConversation onNew={() => startConversation(agentId)} />
        ) : (
          <Transcript items={items} />
        )}

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          disabled={!!composerBlocked}
          placeholder={composerBlocked ?? (running ? "steer the run…" : "message")}
        />
      </main>
    </div>
  );
}
