/** Everything the app draws that is not state: panels, rows, and the composer. */
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CaretDown,
  CaretRight,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Stop,
  Terminal,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import { MarkdownCode } from "./code.tsx";
import type { AgentRow } from "../preload/index.ts";
import type { Item } from "./transcript.ts";
import { ago, type Row } from "./sessions.ts";
import { complete, completionQuery, matches } from "./commands.ts";
import { Badge, Button, dot, type Tone } from "./ui.tsx";
import type { AgentState, Store, View } from "./store.ts";

/** A path as a person writes it. */
export const home = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, "~");

const tones: Record<AgentState, Tone> = {
  ready: "accent",
  missing_model: "warning",
  no_agent: "warning",
  broken: "danger",
};

/** The dot's colour in words: hover and assistive technology must not have to read the palette. */
const says: Record<AgentState, string> = {
  ready: "Ready",
  missing_model: "Needs a model",
  no_agent: "No agent in this directory yet",
  broken: "Broken",
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
    <nav className="w-14 shrink-0 flex flex-col items-center gap-1.5 pt-10 pb-3 bg-sidebar drag">
      {agents.map((agent) => {
        const selected = agent.id === agentId;
        const state = states[agent.id];
        return (
          <button
            key={agent.id}
            aria-label={agent.name}
            aria-pressed={selected}
            onClick={() => onSelect(agent.id)}
            title={`${agent.name}\n${agent.dir}\n${running.includes(agent.id) ? "Working" : says[state ?? "ready"]}`}
            className={`no-drag relative size-9 rounded-card text-[11px] font-medium uppercase transition-colors ${
              selected
                ? "bg-accent/15 text-accent ring-1 ring-accent/60"
                : "text-muted hover:bg-hover hover:text-text"
            }`}
          >
            {agent.name.slice(0, 2)}
            {(running.includes(agent.id) || (state && state !== "ready")) && (
              <span
                aria-label={running.includes(agent.id) ? "Working" : says[state!]}
                className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-bg ${running.includes(agent.id) ? "bg-accent animate-pulse" : dot[tones[state!]]}`}
              />
            )}
          </button>
        );
      })}
      <Button kind="ghost" onClick={onAdd} className="no-drag" title="Add agent directory" aria-label="Add agent directory" icon={<Plus size={16} />} />
    </nav>
  );
}

export function ConversationList({
  agent,
  rows,
  session,
  state,
  working,
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
  state?: AgentState;
  working: boolean;
  disabled: boolean;
  onOpen: (session: string) => void;
  onNew: () => void;
  onDelete: (session: string) => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  return (
    <aside className="w-64 shrink-0 border-r border-stroke flex flex-col min-h-0 bg-sidebar">
      {/* pl-6 clears the window controls, which overhang the rail into this column. */}
      <div className="h-10 shrink-0 flex items-center gap-2 pl-6 pr-2 drag">
        <span className="truncate font-medium">{agent?.name ?? ""}</span>
        {/* The rail's dot is a colour; this is the same fact in words, where it is always readable. */}
        {agent && (working || (state && state !== "ready")) && (
          <Badge tone={working ? "accent" : tones[state!]} pulse={working}>
            <span className="truncate">{working ? "working" : says[state!].toLowerCase()}</span>
          </Badge>
        )}
        <span className="flex-1" />
        {agent && !disabled && (
          <Button
            kind="ghost"
            size={28}
            onClick={onNew}
            className="no-drag"
            title="New conversation (⌘N)"
            aria-label="New conversation"
            icon={<Plus size={15} />}
          />
        )}
      </div>

      {agent && (
        <Button
          kind="ghost"
          size={28}
          onClick={onReveal}
          title={agent.dir}
          icon={<FolderOpen size={12} />}
          className="mx-3 mb-2 !justify-start font-mono text-[11px]"
        >
          <span className="truncate">{home(agent.dir)}</span>
        </Button>
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
                  selected ? "bg-surface" : "hover:bg-hover"
                }`}
              >
                <div className={`truncate pr-5 ${row.fresh ? "text-muted italic" : ""}`}>{row.label}</div>
                {row.updatedAt !== undefined && <div className="text-muted text-[11px]">{ago(row.updatedAt)}</div>}
              </button>
              {!row.fresh && (
                <Button
                  kind="danger"
                  size={28}
                  onClick={() => onDelete(row.session)}
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  icon={<Trash size={13} />}
                  className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Sitting in the sidebar all day, this one asks before it looks dangerous: quiet until the
          pointer is on it. */}
      {agent && (
        <Button kind="ghost" size={28} onClick={onRemove} className="m-3 self-start text-[11px] hover:text-danger">
          Remove agent…
        </Button>
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
        <Button kind="primary" onClick={onAdd}>
          Add an agent directory
        </Button>
        <p className="text-muted text-[11px]">
          No agent yet? Run <span className="font-mono">fastagent init</span> in a project.
        </p>
      </div>
    </Panel>
  );
}

/**
 * duang cannot read its own agent list. It must not repair the file: the broken one may be the only
 * record of which directories are agents. So the recovery is the person's — open it, fix or move it,
 * retry — and the app's job is to make both actions reachable.
 */
export function UnreadableRegistry({ onReveal, onRetry }: { onReveal: () => void; onRetry: () => void }) {
  return (
    <Panel>
      <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
        <p className="text-muted leading-relaxed">
          duang could not read its agent list, so it is not showing one. Your agent directories and their
          conversations are untouched, and the file is left exactly as it is.
        </p>
        <div className="flex gap-2 justify-center">
          <Button icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal agents.json
          </Button>
          <Button kind="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
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
          <Button kind="danger" icon={<X size={14} />} onClick={onRemove}>
            Remove agent
          </Button>
          <Button icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal in Finder
          </Button>
          <Button kind="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </Panel>
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
          <Button kind="primary" onClick={onCreate}>
            Create agent here
          </Button>
          <Button kind="danger" icon={<X size={14} />} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** The model list, floating above the composer chip that opened it. */
function ModelPopover({
  view,
  store,
  current,
  onClose,
}: {
  view: View;
  store: Store;
  current?: string;
  onClose: () => void;
}) {
  const { models, modelsError: error } = view;
  const onRetry = () => void store.loadModels();
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
      // The modal owns Escape while it is open: the window-level handler behind it stops runs.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
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
      className="popover fixed m-0 top-auto right-auto w-80 overflow-y-auto text-text backdrop:bg-transparent"
    >
      <Button
        kind="ghost"
        size={28}
        onClick={close}
        className="float-right"
        aria-label="Close model picker"
        icon={<X size={14} />}
      />
      {models && <p className="text-muted text-[11px] p-2 break-all">Credentials: {models.authPath}</p>}
      {error ? (
        <div role="alert" className="text-danger p-2 space-y-2">
          <p>{error}</p>
          <Button kind="ghost" size={28} onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : models?.specs.length === 0 ? (
        <div className="text-muted text-[12px] p-2 leading-relaxed space-y-2">
          <p>
            No provider is configured. Use <span className="font-mono">fastagent login</span> with
            <span className="font-mono"> FASTAGENT_AUTH_PATH</span> set to the file above, then retry.
          </p>
          <Button kind="ghost" size={28} onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter models"
            placeholder="filter models"
            className="w-full h-8 bg-bg rounded-card px-2.5 mb-1.5 text-[12px] outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted"
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
                  onClose();
                  void store.pickModel(model);
                }}
                className={`block w-full text-left px-2 py-1.5 font-mono text-[11px] rounded-card hover:bg-hover ${
                  model === current ? "bg-accent-weak text-accent" : ""
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
      <div className="composer-column -mt-16">
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
    <Badge tone="accent" pulse>
      working… {Math.max(0, Math.round((now - since) / 1000))}s
    </Badge>
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
      <div className="column space-y-6">
        {items.map((item, index) => (
          <Message key={index} item={item} />
        ))}
        {busySince !== undefined && !streaming && <Working since={busySince} />}
      </div>
    </div>
  );
}

/**
 * Only `code` is overridden. Streamdown's own `pre` is what marks a child as a fenced block, so
 * replacing it — as an earlier version did — turns every code block into an inline span.
 */
const markdownComponents = { code: MarkdownCode };
/** Copy is an action worth offering; downloading a table to a file is not, in a chat transcript. */
const markdownControls = { table: { download: false } };

function Message({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      // Short, sparse, and the thing you look for when scrolling back — so it gets the one shape in
      // the transcript that is small and instantly recognisable.
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-card rounded-br-[4px] bg-accent-weak px-3.5 py-2 leading-relaxed whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="md leading-relaxed">
          <Streamdown components={markdownComponents} controls={markdownControls}>
            {item.text}
          </Streamdown>
        </div>
      );
    case "thinking":
      return (
        <details className="group text-muted text-[12px]">
          <summary className="cursor-default select-none flex items-center gap-1.5">
            <CaretRight size={11} className="transition-transform group-open:rotate-90" />
            thinking
          </summary>
          <div className="mt-1.5 ml-[5px] whitespace-pre-wrap border-l border-stroke pl-3 leading-relaxed">
            {item.text}
          </div>
        </details>
      );
    case "note":
      // A fact about the session, not something anyone said: centred, quiet, and only red when it
      // is genuinely a failure.
      return (
        <div
          className={`flex items-center justify-center gap-1.5 text-[11px] ${
            item.tone === "error" ? "text-danger" : "text-muted"
          }`}
        >
          {item.tone === "error" ? <WarningCircle size={12} /> : <Info size={12} />}
          <span className="font-mono">{item.text}</span>
        </div>
      );
    case "tool":
      return <Tool item={item} />;
  }
}

/** The icon says what kind of work it is before the command is read. */
const toolIcons: Record<string, typeof Terminal> = {
  bash: Terminal,
  read: FileText,
  write: FilePlus,
  edit: PencilSimple,
  grep: MagnifyingGlass,
  find: MagnifyingGlass,
  ls: FolderOpen,
  fetch: Globe,
};

/** One vocabulary, and a stop is never reported as a failure — see docs/ui.md §9. */
function toolState(item: Extract<Item, { kind: "tool" }>): { word: string; tone: Tone } {
  if (item.status === "interrupted") return { word: "stopped", tone: "muted" };
  if (item.isError) return { word: "failed", tone: "danger" };
  if (item.status === "running") return { word: "running", tone: "accent" };
  return { word: "done", tone: "success" };
}

function Tool({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const summary = firstArg(item.args);
  const state = toolState(item);
  const Icon = toolIcons[item.name] ?? Terminal;
  return (
    <details className="group rounded-card bg-surface overflow-hidden">
      <summary className="cursor-default select-none flex items-center gap-2 px-3 h-7 text-[12px]">
        <CaretRight size={11} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="font-mono truncate">{summary || item.name}</span>
        {/* The state belongs next to the command it describes, not at the far edge of the row. */}
        <Badge tone={state.tone} pulse={item.status === "running"}>
          {state.word}
        </Badge>
      </summary>
      <div className="px-3 pb-2.5 pt-0.5 space-y-2 text-[11.5px] font-mono">
        {summary !== stringify(item.args) && (
          <pre className="whitespace-pre-wrap break-all text-muted">{stringify(item.args)}</pre>
        )}
        {item.result !== undefined && (
          <pre className="whitespace-pre-wrap break-all max-h-64 overflow-y-auto">{stringify(item.result)}</pre>
        )}
      </div>
    </details>
  );
}

/** Tool payloads are JSON, except when the runtime already handed us a string. */
function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** A tool call's most telling argument — the path, command or query, not the whole object. */
function firstArg(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const values = Object.values(args as Record<string, unknown>).filter((v) => typeof v === "string") as string[];
  const text = values[0] ?? "";
  // A path's meaning is at its end, a command's at its start: keep the tail when it looks like one.
  if (text.length <= 72) return text;
  return text.startsWith("/") ? `…${text.slice(-71)}` : `${text.slice(0, 71)}…`;
}

/**
 * The composer card: context, input, and the settings that belong to the next message rather than to
 * the app — which is why the model chip lives here and not in a settings screen.
 *
 * Enter sends, Shift+Enter breaks the line; when it cannot send, the placeholder says why.
 */
export function Composer({ view, store }: { view: View; store: Store }) {
  const { agentId, conversation: c, busy } = view;
  const agent = view.agents.find((row) => row.id === agentId);
  const state = agentId ? view.states[agentId] : undefined;
  // What the conversation will RUN with, else the agent's own default. Nothing else may answer
  // this: a chip that names a model the turn will not use is the failure worth avoiding.
  const model = c?.state?.model ?? view.model;
  /** The agent really has no model, as opposed to duang not knowing it yet. Only this warns. */
  const needsModel = state === "missing_model";
  const modelDisabled = view.loading || !!c?.loading || state === "broken" || state === "no_agent";
  /** Why the model cannot be changed right now, or false when it can. */
  const modelReason =
    (!agentId && "Select an agent first") ||
    (busy && "Stop the turn to change the model") ||
    (modelDisabled && "This agent is not ready");
  const value = c?.draft ?? "";
  const disabled = !!view.blocked;

  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, parseFloat(getComputedStyle(el).lineHeight) * 8)}px`;
  }, [value]);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [picking, setPicking] = useState(false);
  // An agent with no model cannot start: open the list rather than leave the person guessing.
  useEffect(() => setPicking(needsModel), [agentId, needsModel]);
  // Every opening rereads the credential file, so a `fastagent login` while duang runs shows up.
  useEffect(() => {
    if (picking) void store.loadModels();
  }, [picking, store]);

  const query = completionQuery(value);
  const suggestions = query === undefined || dismissed ? [] : matches(view.commands, query);
  const chosen = suggestions[Math.min(cursor, suggestions.length - 1)];

  // The first `/` is what asks for the names; the store decides they are fetched once per agent.
  useEffect(() => {
    if (query !== undefined && agentId && !disabled) void store.loadCommands();
  }, [query, agentId, disabled, store]);
  // Escape hides the list for the name as typed; typing on is a new request for it. Keeping it
  // dismissed until the line stops being a command leaves `/d` with no completion at all.
  useEffect(() => {
    setDismissed(false);
    setCursor(0);
  }, [query]);

  return (
    <div className="relative rounded-card bg-surface ring-1 ring-stroke focus-within:ring-accent/50 px-3 py-2.5">
      {suggestions.length > 0 && (
        <div className="popover absolute bottom-full left-0 mb-2 w-96 max-h-64 overflow-y-auto z-20">
          {suggestions.map((command, index) => (
            <button
              key={command.name}
              onMouseEnter={() => setCursor(index)}
              onClick={() => store.setDraft(complete(command.name))}
              className={`flex w-full items-baseline gap-2 rounded-card px-2 py-1.5 text-left ${
                command === chosen ? "bg-accent-weak text-accent" : ""
              }`}
            >
              <span className="font-mono text-[12px]">/{command.name}</span>
              <span className="truncate text-[11px] text-muted flex-1">{command.description}</span>
              <span className="ml-auto text-[10px] text-muted">{command.source}</span>
            </button>
          ))}
        </div>
      )}
      {agent && <div className="text-[11px] font-mono text-muted mb-2 truncate">{home(agent.dir)}</div>}
      {view.commandsError && query !== undefined && (
        <p role="alert" className="text-danger text-[11px]">
          {view.commandsError}
        </p>
      )}
      {/* Pressing `/` on an agent with no skills used to do nothing at all, which reads as broken. */}
      {query !== undefined && !view.commandsError && view.commands.length === 0 && agent && (
        <p className="text-muted text-[11px]">
          No commands — this agent has no skills in <span className="font-mono">{home(agent.dir)}/fastagent/skills</span>
        </p>
      )}
      <textarea
        ref={input}
        aria-label="Message"
        value={value}
        rows={2}
        onChange={(e) => store.setDraft(e.target.value)}
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
              return store.setDraft(complete(chosen.name));
            }
          }
          // While an IME is composing, Enter picks a candidate — sending there would cut a word in half.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (!disabled) void store.send();
        }}
        placeholder={view.blocked ?? (busy ? "steer the run…" : "Ask, build, / for commands…")}
        disabled={disabled}
        className="w-full min-h-10 resize-none bg-transparent leading-5 outline-none placeholder:text-muted disabled:opacity-40"
      />
      <div className="flex items-center gap-2 mt-2">
        <div className="relative">
          <Button
            kind="ghost"
            size={28}
            onClick={() => setPicking(!picking)}
            disabled={modelReason}
            title="Model for this agent"
            className={`font-mono text-[11px] ${!model && needsModel ? "text-warning" : ""}`}
          >
            {model ?? (needsModel ? "pick a model" : "reading model…")}
            <CaretDown size={12} />
          </Button>
          {picking && agentId && !busy && !modelDisabled && (
            <ModelPopover view={view} store={store} current={model} onClose={() => setPicking(false)} />
          )}
        </div>
        {/* While a turn runs, the button that sent it is the button that stops it — stopping is where
            the eye already is, not in a corner of the window. */}
        {busy ? (
          <button
            onClick={() => void store.abort()}
            aria-label="Stop the run"
            // Stopping ends the run, not its consequences; a tool that already wrote a file is done.
            title="Stop (Esc) — work its tools already finished is not undone"
            className="ml-auto size-7 grid place-items-center rounded-card bg-danger text-accent-fg hover:bg-danger/85"
          >
            <Stop size={13} weight="fill" />
          </button>
        ) : (
          <Button
            kind="primary"
            size={28}
            onClick={() => void store.send()}
            disabled={view.blocked || (value.trim() === "" && "Type a message first")}
            aria-label="Send"
            title="Send (⏎) · newline (⇧⏎)"
            className="ml-auto"
            icon={<ArrowUp size={15} />}
          />
        )}
      </div>
    </div>
  );
}
