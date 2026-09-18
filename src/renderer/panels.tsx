/** Everything the app draws that is not state: panels, rows, and the composer. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, FolderOpen, Plus, Square, Trash2, X } from "lucide-react";
import { Streamdown } from "streamdown";
import type { AgentCommand } from "@fastagent-sh/fastagent/session";
import type { AgentRow, Models } from "../preload/index.ts";
import type { Item } from "./transcript.ts";
import { ago, type Row } from "./sessions.ts";
import { complete, completionQuery, matches } from "./commands.ts";
import type { AgentState } from "./store.ts";


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
  running,
  onSelect,
  onAdd,
}: {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  running: string[];
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
            aria-label={agent.name}
            aria-pressed={selected}
            onClick={() => onSelect(agent.id)}
            title={`${agent.name}\n${agent.dir}`}
            className={`no-drag relative size-9 rounded-card text-[11px] font-medium uppercase transition-colors ${
              selected
                ? "bg-accent/15 text-accent ring-1 ring-accent/60"
                : "text-muted hover:bg-white/5 hover:text-text"
            }`}
          >
            {agent.name.slice(0, 2)}
            {(running.includes(agent.id) || (state && state !== "ready")) && (
              <span
                aria-label={running.includes(agent.id) ? "Running" : state}
                className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-bg ${running.includes(agent.id) ? "bg-accent animate-pulse" : dot[state!]}`}
              />
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
  onReveal,
  onRemove,
}: {
  agent?: AgentRow;
  rows: Row[];
  session?: string;
  disabled: boolean;
  onOpen: (session: string) => void;
  onNew: () => void;
  onDelete: (session: string) => void;
  onReveal: () => void;
  onRemove: () => void;
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
          onClick={onReveal}
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
                disabled={disabled}
                aria-current={selected ? "page" : undefined}
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
                  className="absolute right-1.5 top-1.5 grid opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 size-5 place-items-center rounded text-muted hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {agent && (
        <button onClick={onRemove} className="m-3 text-left text-[11px] text-muted hover:text-danger">
          Remove agent…
        </button>
      )}
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

export function BrokenAgent({
  message,
  onRemove,
  onReveal,
  onRetry,
}: {
  message: string;
  onRemove: () => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  return (
    <Panel>
      <div className="max-w-2xl space-y-3">
        <div className="rounded-card border border-danger/40 bg-danger/5 p-3 text-danger whitespace-pre-wrap leading-relaxed">
          {message}
        </div>
        <div className="flex gap-2">
          <Action icon={<X size={13} />} label="Remove agent" onClick={onRemove} />
          <Action icon={<FolderOpen size={13} />} label="Reveal in Finder" onClick={onReveal} />
          <button onClick={onRetry} className="underline">
            Retry
          </button>
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
export function NeedsAgent({ dir, onCreate, onRemove }: { dir: string; onCreate: () => void; onRemove: () => void }) {
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

/** The model list, floating above the composer chip that opened it. */
function ModelPopover({
  current,
  models,
  error,
  onRetry,
  onPick,
  onClose,
}: {
  current?: string;
  models?: Models;
  error?: string;
  onRetry: () => void;
  onPick: (model: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    // Close while still connected so Chromium can restore focus before React removes the dialog.
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    const el = dialog.current!;
    const anchor = el.parentElement!.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 336))}px`;
    el.style.bottom = `${window.innerHeight - anchor.top + 8}px`;
    el.style.maxHeight = `${Math.max(100, anchor.top - 16)}px`;
    el.showModal();
    return () => el.close();
  }, []);
  const matches = (models?.specs ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  return (
    <dialog
      ref={dialog}
      aria-label="Choose a model"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
      className="fixed m-0 top-auto right-auto w-80 overflow-y-auto rounded-card bg-surface text-text ring-1 ring-stroke shadow-2xl p-2 backdrop:bg-transparent"
    >
      <button onClick={close} className="float-right p-1" aria-label="Close model picker">
        <X size={14} />
      </button>
      {models && <p className="text-muted text-[11px] p-2 break-all">Credentials: {models.authPath}</p>}
      {error ? (
        <p role="alert" className="text-danger p-2">
          {error}{" "}
          <button className="underline" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : models?.specs.length === 0 ? (
        <p className="text-muted text-[12px] p-2 leading-relaxed">
          No provider is configured. Use <span className="font-mono">fastagent login</span> with
          <span className="font-mono"> FASTAGENT_AUTH_PATH</span> set to the file above, then{" "}
          <button className="underline" onClick={onRetry}>
            Retry
          </button>.
        </p>
      ) : (
        <>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter models"
            placeholder="filter models"
            className="w-full bg-bg rounded-card px-2.5 py-1.5 mb-1.5 text-[12px] outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted"
          />
          <div className="max-h-64 overflow-y-auto">
            {!models && (
              <p role="status" className="text-muted p-2">
                Loading models…
              </p>
            )}
            {matches.map((model) => (
              <button
                key={model}
                onClick={() => {
                  dialog.current?.close();
                  onPick(model);
                }}
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
    </dialog>
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
  const running = item.status === "running";
  const summary = firstArg(item.args);
  return (
    <details className="group rounded-card bg-surface/60 ring-1 ring-stroke/60">
      <summary className="cursor-default select-none flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono">
        <ChevronRight size={12} className="text-muted transition-transform group-open:rotate-90" />
        <span className={item.isError ? "text-danger" : "text-text"}>{item.name}</span>
        {summary && <span className="text-muted truncate">{summary}</span>}
        <span className="ml-auto text-muted">{item.isError ? "failed" : running ? "running…" : item.status}</span>
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
  context,
  model,
  needsModel,
  models,
  modelsError,
  onLoadModels,
  commands,
  commandsError,
  onNeedCommands,
  picking,
  onPicking,
  onPickModel,
  busy,
  modelDisabled,
  onAbort,
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
}: {
  agentId?: string;
  context?: string;
  model?: string;
  /** The agent really has no model, as opposed to duang not knowing it yet. Only this warns. */
  needsModel: boolean;
  models?: Models;
  modelsError?: string;
  onLoadModels: () => void;
  commands: AgentCommand[];
  commandsError?: string;
  onNeedCommands: () => void;
  picking: boolean;
  onPicking: (open: boolean) => void;
  onPickModel: (model: string) => void;
  busy: boolean;
  modelDisabled: boolean;
  onAbort: () => void;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, parseFloat(getComputedStyle(el).lineHeight) * 8)}px`;
  }, [value]);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);

  const query = completionQuery(value);
  const suggestions = query === undefined || dismissed ? [] : matches(commands, query);
  const chosen = suggestions[Math.min(cursor, suggestions.length - 1)];

  // The first `/` is what asks for the names; the store decides they are fetched once per agent.
  useEffect(() => {
    if (query !== undefined && agentId && !disabled) onNeedCommands();
  }, [query, agentId, disabled, onNeedCommands]);
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
      {commandsError && query !== undefined && (
        <p role="alert" className="text-danger text-[11px]">
          {commandsError}
        </p>
      )}
      <textarea
        ref={input}
        aria-label="Message"
        value={value}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (suggestions.length > 0 && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : suggestions.length - 1;
              return setCursor((c) => (Math.min(c, suggestions.length - 1) + step) % suggestions.length);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              return setDismissed(true);
            }
            // Enter and Tab accept the name rather than send: a bare `/name` is never a message.
            if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && chosen) {
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
        className="w-full min-h-10 resize-none bg-transparent leading-5 outline-none placeholder:text-muted disabled:opacity-60"
      />
      <div className="flex items-center gap-2 mt-1">
        <div className="relative">
          <button
            onClick={() => onPicking(!picking)}
            disabled={!agentId || busy || modelDisabled}
            title={busy ? "Stop the turn to change the model" : "Model for this agent"}
            className={`flex items-center gap-1 rounded-card px-2 py-1 text-[11px] font-mono hover:bg-white/5 disabled:opacity-50 ${
              !model && needsModel ? "text-amber-400" : "text-muted"
            }`}
          >
            {model ?? (needsModel ? "pick a model" : "reading model…")}
            <ChevronDown size={12} />
          </button>
          {picking && agentId && !busy && !modelDisabled && (
            <ModelPopover
              current={model}
              models={models}
              error={modelsError}
              onRetry={onLoadModels}
              onPick={onPickModel}
              onClose={() => onPicking(false)}
            />
          )}
        </div>
        {/* While a turn runs, the button that sent it is the button that stops it — stopping is where
            the eye already is, not in a corner of the window. */}
        {busy ? (
          <button
            onClick={onAbort}
            title="Stop (Esc)"
            className="ml-auto size-7 grid place-items-center rounded-card bg-danger/15 text-danger"
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={disabled || value.trim() === ""}
            title="Send (⏎) · newline (⇧⏎)"
            className="ml-auto size-7 grid place-items-center rounded-card bg-accent/15 text-accent disabled:opacity-30 disabled:text-muted"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
