import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Plus, Square } from "lucide-react";
import type { SessionState, SessionSummary } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import { apply, echoUser, fromEntries, type Item } from "./transcript.ts";
import { rows } from "./sessions.ts";

const duang = (window as unknown as { duang: DuangApi }).duang;

export default function App() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<string>();
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<SessionState>();
  const [draft, setDraft] = useState("");

  useEffect(() => void duang.listAgents().then(setAgents), []);

  const open = useCallback(async (agent: string, id: string) => {
    setAgentId(agent);
    setSession(id);
    setItems([]);
    setState(undefined);
    const { state: opened, entries } = await duang.openSession(agent, id);
    setState(opened);
    setItems(fromEntries(entries.entries));
  }, []);

  /** A new conversation is a minted id and nothing else: the runtime learns of it on the first turn. */
  const startConversation = useCallback(
    (agent: string) => void open(agent, crypto.randomUUID()),
    [open],
  );

  const selectAgent = useCallback(
    async (agent: string) => {
      setAgentId(agent);
      setSessions([]);
      const list = await duang.listSessions(agent);
      setSessions(list);
      const newest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (newest) void open(agent, newest.session);
      else startConversation(agent);
    },
    [open, startConversation],
  );

  // One subscription for the window; frames for a conversation that is no longer open are dropped.
  const current = useRef({ agentId, session });
  current.current = { agentId, session };
  useEffect(
    () =>
      duang.onSessionEvent((frame) => {
        if (frame.agentId !== current.current.agentId || frame.session !== current.current.session) return;
        if (frame.event.type === "state_changed") setState((s) => ({ ...(s as SessionState), ...(frame.event.data as object) }));
        // A settled run is when a fresh conversation becomes one the runtime can list, preview included.
        if (frame.event.type === "run_settled" && frame.agentId) void duang.listSessions(frame.agentId).then(setSessions);
        setItems((list) => apply(list, frame.event));
      }),
    [],
  );

  const running = state?.status === "running";

  async function send() {
    const text = draft.trim();
    if (!text || !agentId || !session) return;
    setDraft("");
    setItems((list) => echoUser(list, text));
    await duang.send(agentId, session, text);
  }

  return (
    <div className="flex h-full">
      <nav className="w-14 shrink-0 border-r border-stroke flex flex-col items-center gap-2 pt-10 drag">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => void selectAgent(agent.id)}
            title={agent.name}
            className={`no-drag size-9 rounded-card border text-[11px] ${
              agent.id === agentId ? "border-accent text-accent" : "border-stroke text-muted"
            }`}
          >
            {agent.name.slice(0, 2)}
          </button>
        ))}
        <button
          onClick={() => void duang.addAgent().then((row) => row && setAgents((list) => [...list, row]))}
          className="no-drag size-9 rounded-card border border-stroke text-muted grid place-items-center"
          title="Add agent"
        >
          <Plus size={16} />
        </button>
      </nav>

      <aside className="w-56 shrink-0 border-r border-stroke flex flex-col">
        <div className="h-10 shrink-0 flex items-center justify-end px-2 drag">
          {agentId && (
            <button
              onClick={() => startConversation(agentId)}
              className="no-drag text-muted p-1"
              title="New conversation"
            >
              <MessageSquarePlus size={15} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows(sessions, session).map((row) => (
            <button
              key={row.session}
              onClick={() => agentId && void open(agentId, row.session)}
              className={`block w-full text-left px-3 py-2 ${row.session === session ? "bg-surface" : ""}`}
            >
              <div className={`truncate ${row.fresh ? "text-muted italic" : ""}`}>{row.label}</div>
              {row.updatedAt !== undefined && (
                <div className="text-muted text-[11px]">{new Date(row.updatedAt).toLocaleString()}</div>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-10 shrink-0 border-b border-stroke flex items-center px-4 gap-3 drag">
          <span className="truncate">{session ?? "no conversation"}</span>
          <span className="text-muted text-[11px]">{state?.model}</span>
          {running && (
            <button
              onClick={() => agentId && session && void duang.abort(agentId, session)}
              className="no-drag ml-auto flex items-center gap-1 text-danger"
            >
              <Square size={12} /> stop
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {items.map((item, index) => (
            <Message key={index} item={item} />
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="border-t border-stroke p-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={running ? "steer the run…" : "message"}
            disabled={!session}
            className="w-full bg-surface rounded-card px-3 py-2 outline-none placeholder:text-muted"
          />
        </form>
      </main>
    </div>
  );
}

function Message({ item }: { item: Item }) {
  if (item.kind !== "tool") {
    const tone =
      item.kind === "user"
        ? "text-accent"
        : item.kind === "thinking"
          ? "text-muted italic"
          : item.kind === "note"
            ? "text-danger text-[11px]"
            : "";
    return <div className={`whitespace-pre-wrap ${tone}`}>{item.text}</div>;
  }
  return (
    <details className="font-mono text-[11px] text-muted">
      <summary className="cursor-default">
        {item.name}
        {item.isError ? " · failed" : item.result === undefined ? " · running" : ""}
      </summary>
      <pre className="whitespace-pre-wrap">{JSON.stringify({ args: item.args, result: item.result }, null, 2)}</pre>
    </details>
  );
}
