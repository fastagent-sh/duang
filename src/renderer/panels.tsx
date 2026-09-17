/** Everything the app draws that is not state: panels, rows, and the composer. */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2, X } from "lucide-react";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import type { Item } from "./transcript.ts";
import type { Row } from "./sessions.ts";

const duang = (window as unknown as { duang: DuangApi }).duang;

export type AgentState = "ready" | "missing_model" | "broken";

const dot: Record<AgentState, string> = {
  ready: "bg-accent",
  missing_model: "bg-amber-400",
  broken: "bg-danger",
};

export function Rail({
  agents,
  agentId,
  states,
  onSelect,
  onAdd,
}: {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="w-14 shrink-0 border-r border-stroke flex flex-col items-center gap-2 pt-10 drag">
      {agents.map((agent) => (
        <button
          key={agent.id}
          onClick={() => onSelect(agent.id)}
          title={`${agent.name}\n${agent.dir}`}
          className={`no-drag relative size-9 rounded-card border text-[11px] uppercase ${
            agent.id === agentId ? "border-accent text-accent" : "border-stroke text-muted"
          }`}
        >
          {agent.name.slice(0, 2)}
          {states[agent.id] && states[agent.id] !== "ready" && (
            <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ${dot[states[agent.id]!]}`} />
          )}
        </button>
      ))}
      <button
        onClick={onAdd}
        className="no-drag size-9 rounded-card border border-stroke text-muted grid place-items-center"
        title="Add agent directory"
      >
        <Plus size={16} />
      </button>
    </nav>
  );
}

export function ConversationList({
  agent,
  rows,
  session,
  disabled,
  onOpen,
  onNew,
  onDelete,
  onPickModel,
}: {
  agent?: AgentRow;
  rows: Row[];
  session?: string;
  disabled: boolean;
  onOpen: (session: string) => void;
  onNew: () => void;
  onDelete: (session: string) => void;
  onPickModel: () => void;
}) {
  return (
    <aside className="w-60 shrink-0 border-r border-stroke flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 drag">
        <span className="truncate flex-1">{agent?.name ?? ""}</span>
        {agent && !disabled && (
          <button onClick={onNew} className="no-drag text-muted" title="New conversation (⌘N)">
            <Plus size={15} />
          </button>
        )}
      </div>
      {agent && (
        <div className="px-3 pb-2 flex items-center gap-2 text-[11px] text-muted">
          <button onClick={onPickModel} className="truncate hover:text-text" title="Change model">
            {agent.model ?? "no model"}
          </button>
          <button onClick={() => void duang.revealAgent(agent.id)} title="Reveal in Finder" className="ml-auto">
            <FolderOpen size={13} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {rows.map((row) => (
          <div key={row.session} className="group relative">
            <button
              onClick={() => onOpen(row.session)}
              className={`block w-full text-left px-3 py-2 ${row.session === session ? "bg-surface" : ""}`}
            >
              <div className={`truncate pr-5 ${row.fresh ? "text-muted italic" : ""}`}>{row.label}</div>
              {row.updatedAt !== undefined && (
                <div className="text-muted text-[11px]">{new Date(row.updatedAt).toLocaleString()}</div>
              )}
            </button>
            {!row.fresh && (
              <button
                onClick={() => onDelete(row.session)}
                title="Delete conversation"
                className="absolute right-2 top-2 hidden group-hover:block text-muted hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Whatever replaces the transcript sits in the transcript's box, so the composer never moves. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto p-6">{children}</div>;
}

export function NoAgents({ onAdd }: { onAdd: () => void }) {
  return (
    <Panel>
      <div className="max-w-md mx-auto mt-16 text-center space-y-3">
        <p className="text-muted">duang runs the agents you already have, and later puts them online.</p>
        <button onClick={onAdd} className="rounded-card border border-accent text-accent px-3 py-1.5">
          Add an agent directory
        </button>
        <p className="text-muted text-[11px] font-mono">no agent yet? run: fastagent init</p>
      </div>
    </Panel>
  );
}

export function BrokenAgent({
  agentId,
  message,
  onRemove,
}: {
  agentId: string;
  message: string;
  onRemove: () => void;
}) {
  return (
    <Panel>
      <div className="rounded-card border border-danger/50 p-3 text-danger whitespace-pre-wrap">{message}</div>
      <div className="flex gap-2 mt-3">
        <button onClick={onRemove} className="rounded-card border border-stroke px-3 py-1.5 flex items-center gap-1">
          <X size={13} /> Remove agent
        </button>
        <button
          onClick={() => void duang.revealAgent(agentId)}
          className="rounded-card border border-stroke px-3 py-1.5 flex items-center gap-1"
        >
          <FolderOpen size={13} /> Reveal in Finder
        </button>
      </div>
    </Panel>
  );
}

export function NoConversation({ onNew }: { onNew: () => void }) {
  return (
    <Panel>
      <div className="mt-16 text-center">
        <button onClick={onNew} className="rounded-card border border-accent text-accent px-3 py-1.5">
          New conversation
        </button>
      </div>
    </Panel>
  );
}

/** The one thing a scaffolded agent is missing, and the one setting duang keeps for itself. */
export function ModelPicker({ agentId, onPicked }: { agentId: string; onPicked: () => void }) {
  const [models, setModels] = useState<string[]>();
  const [filter, setFilter] = useState("");

  useEffect(() => void duang.listModels().then(setModels), []);
  const matches = (models ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  return (
    <Panel>
      {models?.length === 0 ? (
        <p className="text-muted">
          No provider is logged in. Run <span className="font-mono">fastagent login</span> (or pi&apos;s login), then
          reopen duang.
        </p>
      ) : (
        <>
          <p className="text-muted mb-3">Pick a model. duang stores the choice; the agent directory is untouched.</p>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter models (try: sonnet, gpt)"
            className="w-full bg-surface rounded-card px-3 py-2 outline-none placeholder:text-muted mb-2"
          />
          {matches.map((model) => (
            <button
              key={model}
              onClick={() => void duang.setModel(agentId, model).then(onPicked)}
              className="block w-full text-left px-3 py-1.5 font-mono text-[11px] hover:bg-surface rounded-card"
            >
              {model}
            </button>
          ))}
        </>
      )}
    </Panel>
  );
}

export function Transcript({ items }: { items: Item[] }) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
    >
      {items.map((item, index) => (
        <Message key={index} item={item} />
      ))}
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

/** Enter sends, Shift+Enter breaks the line; when it cannot send, the placeholder says why. */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
}) {
  const lines = Math.min(6, value.split("\n").length);
  return (
    <div className="border-t border-stroke p-3 shrink-0">
      <textarea
        value={value}
        rows={lines}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          if (!disabled) onSend();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none bg-surface rounded-card px-3 py-2 outline-none placeholder:text-muted disabled:opacity-60"
      />
    </div>
  );
}
