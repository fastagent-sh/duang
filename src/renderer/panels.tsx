/** Everything the app draws that is not state: panels, rows, and the composer. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { Streamdown } from "streamdown";
import type { AgentCommand } from "@fastagent-sh/fastagent/session";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import type { Item } from "./transcript.ts";
import { ago, type Row } from "./sessions.ts";
import { complete, completionQuery, matches } from "./commands.ts";

const duang = (window as unknown as { duang: DuangApi }).duang;

export type AgentState = "ready" | "missing_model" | "no_agent" | "broken";

/** A path as a person writes it. */
export const home = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, "~");

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
}: {
  agent?: AgentRow;
  rows: Row[];
  session?: string;
  disabled: boolean;
  onOpen: (session: string) => void;
  onNew: () => void;
  onDelete: (session: string) => void;
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
        <button
          onClick={() => void duang.revealAgent(agent.id)}
          title={agent.dir}
          className="mx-3 mb-2 flex items-center gap-1.5 rounded-card px-1.5 py-0.5 text-[11px] font-mono text-muted hover:bg-white/5 hover:text-text"
        >
          <FolderOpen size={12} />
          <span className="truncate">{home(agent.dir)}</span>
        </button>
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

/** The model list, floating above the composer chip that opened it. */
function ModelPopover({
  agentId,
  session,
  current,
  onPicked,
  onClose,
}: {
  agentId: string;
  session?: string;
  current?: string;
  onPicked: () => void;
  onClose: () => void;
}) {
  const [models, setModels] = useState<string[]>();
  const [filter, setFilter] = useState("");

  useEffect(() => void duang.listModels().then(setModels), []);
  const matches = (models ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 z-20 w-80 rounded-card bg-surface ring-1 ring-stroke shadow-2xl p-2">
        {models?.length === 0 ? (
          <p className="text-muted text-[12px] p-2 leading-relaxed">
            No provider is logged in. Run <span className="font-mono">fastagent login</span> (or pi&apos;s login), then
            reopen duang.
          </p>
        ) : (
          <>
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
              placeholder="filter models"
              className="w-full bg-bg rounded-card px-2.5 py-1.5 mb-1.5 text-[12px] outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted"
            />
            <div className="max-h-64 overflow-y-auto">
              {matches.map((model) => (
                <button
                  key={model}
                  onClick={() => void duang.setModel(agentId, model, session).then(onPicked)}
                  className={`block w-full text-left px-2 py-1.5 font-mono text-[11px] rounded-card hover:bg-white/5 ${
                    model === current ? "text-accent" : ""
                  }`}
                >
                  {model}
                </button>
              ))}
              {models && matches.length === 0 && <p className="text-muted text-[11px] px-2 py-1.5">Nothing matches.</p>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** The opening screen of a conversation nobody has spoken in yet. */
export function NewConversation({ agentName, children }: { agentName: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto grid place-items-center px-6">
      <div className="w-full max-w-3xl -mt-16">
        <h1 className="text-[22px] font-medium mb-5">What should we work on in {agentName}?</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * The gap this fills is real work with nothing to show: from pressing send until the first token,
 * the model is thinking and the transcript has nothing to say. Silence there reads as a hang, so the
 * elapsed seconds are the message — they are also how someone tells slow from stuck.
 */
function Working({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 text-muted text-[12px]">
      <span className="size-1.5 rounded-full bg-accent animate-pulse" />
      working… {Math.max(0, Math.round((now - since) / 1000))}s
    </div>
  );
}

export function Transcript({ items, busySince }: { items: Item[]; busySince?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  // Nothing is streaming when the last thing said is closed — that is when the indicator earns its place.
  const last = items.at(-1);
  const streaming = last?.kind === "assistant" || last?.kind === "thinking" ? last.open : false;

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items, busySince, streaming]);

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
        {busySince !== undefined && !streaming && <Working since={busySince} />}
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

/**
 * The composer card: context, input, and the settings that belong to the next message rather than to
 * the app — which is why the model chip lives here and not in a settings screen.
 *
 * Enter sends, Shift+Enter breaks the line; when it cannot send, the placeholder says why.
 */
export function Composer({
  agentId,
  session,
  context,
  model,
  picking,
  onPicking,
  onPicked,
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
}: {
  agentId?: string;
  session?: string;
  context?: string;
  model?: string;
  picking: boolean;
  onPicking: (open: boolean) => void;
  onPicked: () => void;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
}) {
  const lines = Math.min(8, Math.max(2, value.split("\n").length));
  const [commands, setCommands] = useState<AgentCommand[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);

  const query = completionQuery(value);
  const suggestions = query === undefined || dismissed ? [] : matches(commands, query);
  const chosen = suggestions[Math.min(cursor, suggestions.length - 1)];

  // Loaded on the first `/`, per agent: the names are the definition's, and it is live.
  useEffect(() => {
    setCommands([]);
  }, [agentId]);
  useEffect(() => {
    if (query === undefined || !agentId || commands.length > 0) return;
    void duang.listCommands(agentId).then(setCommands);
  }, [query, agentId, commands.length]);
  useEffect(() => {
    if (query === undefined) setDismissed(false);
    setCursor(0);
  }, [query]);

  return (
    <div className="relative rounded-card bg-surface ring-1 ring-stroke focus-within:ring-accent/50 px-3 pt-2.5 pb-2">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-96 max-h-64 overflow-y-auto rounded-card bg-surface ring-1 ring-stroke shadow-2xl p-1 z-20">
          {suggestions.map((command, index) => (
            <button
              key={command.name}
              onMouseEnter={() => setCursor(index)}
              onClick={() => onChange(complete(command.name))}
              className={`flex w-full items-baseline gap-2 rounded-card px-2 py-1.5 text-left ${
                command === chosen ? "bg-white/5" : ""
              }`}
            >
              <span className="font-mono text-[12px]">/{command.name}</span>
              <span className="truncate text-[11px] text-muted">{command.description}</span>
              <span className="ml-auto text-[10px] text-muted">{command.source}</span>
            </button>
          ))}
        </div>
      )}
      {context && <div className="text-[11px] font-mono text-muted mb-1.5 truncate">{context}</div>}
      <textarea
        value={value}
        rows={lines}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (suggestions.length > 0 && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : suggestions.length - 1;
              return setCursor((c) => (Math.min(c, suggestions.length - 1) + step) % suggestions.length);
            }
            if (e.key === "Escape") return setDismissed(true);
            // Enter and Tab accept the name rather than send: a bare `/name` is never a message.
            if ((e.key === "Enter" || e.key === "Tab") && chosen) {
              e.preventDefault();
              return onChange(complete(chosen.name));
            }
          }
          // While an IME is composing, Enter picks a candidate — sending there would cut a word in half.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (!disabled) onSend();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-none bg-transparent outline-none placeholder:text-muted disabled:opacity-60"
      />
      <div className="flex items-center gap-2 mt-1">
        <div className="relative">
          <button
            onClick={() => onPicking(!picking)}
            disabled={!agentId}
            title="Model for this agent"
            className={`flex items-center gap-1 rounded-card px-2 py-1 text-[11px] font-mono hover:bg-white/5 ${
              model ? "text-muted" : "text-amber-400"
            }`}
          >
            {model ?? "pick a model"}
            <ChevronDown size={12} />
          </button>
          {picking && agentId && (
            <ModelPopover
              agentId={agentId}
              session={session}
              current={model}
              onPicked={onPicked}
              onClose={() => onPicking(false)}
            />
          )}
        </div>
        <button
          onClick={onSend}
          disabled={disabled || value.trim() === ""}
          title="Send (⏎) · newline (⇧⏎)"
          className="ml-auto size-7 grid place-items-center rounded-card bg-accent/15 text-accent disabled:opacity-30 disabled:text-muted"
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}
