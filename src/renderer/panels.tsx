/** Everything the app draws that is not state: panels, rows, and the composer. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { Streamdown } from "streamdown";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import type { Item } from "./transcript.ts";
import { ago, type Row } from "./sessions.ts";

const duang = (window as unknown as { duang: DuangApi }).duang;

export type AgentState = "ready" | "missing_model" | "no_agent" | "broken";

const dot: Record<AgentState, string> = {
  ready: "bg-accent",
  missing_model: "bg-amber-400",
  no_agent: "bg-amber-400",
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
    <nav className="w-14 shrink-0 flex flex-col items-center gap-1.5 pt-10 pb-3 bg-black/20 drag">
      {agents.map((agent) => {
        const selected = agent.id === agentId;
        const state = states[agent.id];
        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            title={`${agent.name}\n${agent.dir}`}
            className={`no-drag relative size-9 rounded-card text-[11px] font-medium uppercase transition-colors ${
              selected ? "bg-accent/15 text-accent ring-1 ring-accent/60" : "text-muted hover:bg-white/5 hover:text-text"
            }`}
          >
            {agent.name.slice(0, 2)}
            {state && state !== "ready" && (
              <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-bg ${dot[state]}`} />
            )}
          </button>
        );
      })}
      <button
        onClick={onAdd}
        className="no-drag size-9 rounded-card text-muted grid place-items-center hover:bg-white/5 hover:text-text"
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
    <aside className="w-64 shrink-0 border-r border-stroke flex flex-col min-h-0 bg-black/10">
      {/* pl-6 clears the window controls, which overhang the rail into this column. */}
      <div className="h-10 shrink-0 flex items-center gap-2 pl-6 pr-2 drag">
        <span className="truncate flex-1 font-medium">{agent?.name ?? ""}</span>
        {agent && !disabled && (
          <button
            onClick={onNew}
            className="no-drag size-6 grid place-items-center rounded-card text-muted hover:bg-white/5 hover:text-text"
            title="New conversation (⌘N)"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {agent && (
        <div className="px-3 pb-2 flex items-center gap-1 text-[11px]">
          <button
            onClick={onPickModel}
            className="truncate rounded-card px-1.5 py-0.5 font-mono text-muted hover:bg-white/5 hover:text-text"
            title="Change model"
          >
            {agent.model ?? "no model"}
          </button>
          <button
            onClick={() => void duang.revealAgent(agent.id)}
            title={agent.dir}
            className="ml-auto size-6 grid place-items-center rounded-card text-muted hover:bg-white/5 hover:text-text"
          >
            <FolderOpen size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 pb-2 space-y-0.5">
        {rows.map((row) => {
          const selected = row.session === session;
          return (
            <div key={row.session} className="group relative">
              <button
                onClick={() => onOpen(row.session)}
                className={`block w-full text-left rounded-card px-2 py-1.5 transition-colors ${
                  selected ? "bg-surface" : "hover:bg-white/5"
                }`}
              >
                <div className={`truncate pr-5 ${row.fresh ? "text-muted italic" : ""}`}>{row.label}</div>
                {row.updatedAt !== undefined && <div className="text-muted text-[11px]">{ago(row.updatedAt)}</div>}
              </button>
              {!row.fresh && (
                <button
                  onClick={() => onDelete(row.session)}
                  title="Delete conversation"
                  className="absolute right-1.5 top-1.5 hidden group-hover:grid size-5 place-items-center rounded text-muted hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** Whatever replaces the transcript sits in the transcript's box, so the composer never moves. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>;
}

export function NoAgents({ onAdd }: { onAdd: () => void }) {
  return (
    <Panel>
      <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
        <p className="text-muted leading-relaxed">
          duang runs the agents you already have — and later puts them online.
        </p>
        <button
          onClick={onAdd}
          className="rounded-card bg-accent/15 text-accent ring-1 ring-accent/50 px-3 py-1.5 hover:bg-accent/25"
        >
          Add an agent directory
        </button>
        <p className="text-muted text-[11px]">
          No agent yet? Run <span className="font-mono">fastagent init</span> in a project.
        </p>
      </div>
    </Panel>
  );
}

export function BrokenAgent({ agentId, message, onRemove }: { agentId: string; message: string; onRemove: () => void }) {
  return (
    <Panel>
      <div className="max-w-2xl space-y-3">
        <div className="rounded-card border border-danger/40 bg-danger/5 p-3 text-danger whitespace-pre-wrap leading-relaxed">
          {message}
        </div>
        <div className="flex gap-2">
          <Action icon={<X size={13} />} label="Remove agent" onClick={onRemove} />
          <Action icon={<FolderOpen size={13} />} label="Reveal in Finder" onClick={() => void duang.revealAgent(agentId)} />
        </div>
      </div>
    </Panel>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-card border border-stroke px-3 py-1.5 flex items-center gap-1.5 hover:bg-white/5"
    >
      {icon} {label}
    </button>
  );
}

/** A plain project: it can hold an agent, it just does not yet. Say exactly what gets written. */
export function NeedsAgent({
  dir,
  onCreate,
  onRemove,
}: {
  dir: string;
  onCreate: () => void;
  onRemove: () => void;
}) {
  return (
    <Panel>
      <div className="max-w-xl space-y-4">
        <p className="text-muted leading-relaxed">
          This folder has no agent yet. duang can create one here — the project stays the agent&apos;s workspace, so it
          works on these files and reads their <span className="font-mono">AGENTS.md</span>.
        </p>
        <pre className="rounded-card bg-surface ring-1 ring-stroke p-3 text-[11px] font-mono text-muted">
          {`${dir}/fastagent/\n  fastagent.config.ts\n  .gitignore`}
        </pre>
        <p className="text-muted text-[11px]">
          Two files, nothing else. For the full scaffold (persona, skills, example tool) run{" "}
          <span className="font-mono">fastagent init</span> instead.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCreate}
            className="rounded-card bg-accent/15 text-accent ring-1 ring-accent/50 px-3 py-1.5 hover:bg-accent/25"
          >
            Create agent here
          </button>
          <Action icon={<X size={13} />} label="Remove" onClick={onRemove} />
        </div>
      </div>
    </Panel>
  );
}

export function NoConversation({ onNew }: { onNew: () => void }) {
  return (
    <Panel>
      <div className="mt-20 text-center">
        <button
          onClick={onNew}
          className="rounded-card bg-accent/15 text-accent ring-1 ring-accent/50 px-3 py-1.5 hover:bg-accent/25"
        >
          New conversation
        </button>
      </div>
    </Panel>
  );
}

/** The one thing a scaffolded agent is missing, and the one setting duang keeps for itself. */
export function ModelPicker({
  agentId,
  current,
  onPicked,
}: {
  agentId: string;
  current?: string;
  onPicked: () => void;
}) {
  const [models, setModels] = useState<string[]>();
  const [filter, setFilter] = useState("");

  useEffect(() => void duang.listModels().then(setModels), []);
  const matches = (models ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  return (
    <Panel>
      <div className="max-w-xl mx-auto">
        {models?.length === 0 ? (
          <p className="text-muted leading-relaxed">
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
              className="w-full bg-surface rounded-card px-3 py-2 mb-2 outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted"
            />
            <div className="space-y-0.5">
              {matches.map((model) => (
                <button
                  key={model}
                  onClick={() => void duang.setModel(agentId, model).then(onPicked)}
                  className={`block w-full text-left px-2 py-1.5 font-mono text-[11px] rounded-card hover:bg-white/5 ${
                    model === current ? "text-accent" : ""
                  }`}
                >
                  {model}
                </button>
              ))}
              {models && matches.length === 0 && <p className="text-muted text-[11px] px-2">Nothing matches.</p>}
            </div>
          </>
        )}
      </div>
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
      className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {items.map((item, index) => (
          <Message key={index} item={item} />
        ))}
      </div>
    </div>
  );
}

function Message({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-card bg-accent/12 ring-1 ring-accent/25 px-3 py-2 whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="md leading-relaxed">
          <Streamdown>{item.text}</Streamdown>
        </div>
      );
    case "thinking":
      return (
        <details className="text-muted text-[12px]">
          <summary className="cursor-default select-none italic">thinking</summary>
          <div className="mt-1 whitespace-pre-wrap border-l border-stroke pl-3">{item.text}</div>
        </details>
      );
    case "note":
      return <div className="text-danger text-[11px] font-mono">{item.text}</div>;
    case "tool":
      return <Tool item={item} />;
  }
}

function Tool({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const running = item.result === undefined;
  const summary = firstArg(item.args);
  return (
    <details className="group rounded-card bg-surface/60 ring-1 ring-stroke/60">
      <summary className="cursor-default select-none flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono">
        <ChevronRight size={12} className="text-muted transition-transform group-open:rotate-90" />
        <span className={item.isError ? "text-danger" : "text-text"}>{item.name}</span>
        {summary && <span className="text-muted truncate">{summary}</span>}
        <span className="ml-auto text-muted">{item.isError ? "failed" : running ? "running…" : "done"}</span>
      </summary>
      <pre className="px-2.5 pb-2.5 text-[11px] font-mono text-muted whitespace-pre-wrap break-all">
        {JSON.stringify({ args: item.args, result: item.result }, null, 2)}
      </pre>
    </details>
  );
}

/** A tool call's most telling argument — the path, command or query, not the whole object. */
function firstArg(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const values = Object.values(args as Record<string, unknown>).filter((v) => typeof v === "string") as string[];
  const text = values[0] ?? "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
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
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="max-w-3xl mx-auto relative">
        <textarea
          value={value}
          rows={lines}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // While an IME is composing, Enter picks a candidate — sending there would cut a word in half.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (!disabled) onSend();
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full resize-none bg-surface rounded-card pl-3 pr-11 py-2.5 outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={disabled || value.trim() === ""}
          title="Send (⏎) · newline (⇧⏎)"
          className="absolute right-2 bottom-2.5 size-7 grid place-items-center rounded-card bg-accent/15 text-accent disabled:opacity-30 disabled:text-muted"
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}
