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
import { Avatar, Badge, Button, dot, type Tone } from "./ui.tsx";
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

/**
 * One column: who you work with, and what you were talking about with the one you are on.
 *
 * Agents are rows rather than a strip of tiles, because a name and its state need words. Only the
 * selected agent shows its conversations; the rest stay folded, which is the honest shape of the
 * data anyway — duang loads sessions for the agent it has open.
 */
export function Sidebar({
  agents,
  agentId,
  states,
  running,
  rowsFor,
  session,
  expanded,
  disabled,
  onSelect,
  onToggle,
  onAdd,
  onOpen,
  onNew,
  onDelete,
}: {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  running: string[];
  rowsFor: (agentId: string) => Row[];
  session?: string;
  expanded: string[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: () => void;
  onOpen: (agentId: string, session: string) => void;
  onNew: () => void;
  onDelete: (session: string) => void;
}) {
  return (
    <aside className="w-80 shrink-0 flex flex-col min-h-0 rounded-float bg-sidebar ring-1 ring-stroke overflow-hidden">
      {/* The window controls overhang this card's top-left. The row is tall enough to hold them
          with air around it, and the wordmark is centred in the column rather than pushed along by
          them — Telegram's header, which has the same problem. */}
      <div className="relative h-12 shrink-0 flex items-center px-2 drag">
        <span className="absolute left-1/2 -translate-x-1/2 font-medium tracking-[-0.01em]">
          duang<span className="text-accent">·</span>
        </span>
        <span className="flex-1" />
        <Button
          kind="ghost"
          size={28}
          onClick={onAdd}
          className="no-drag"
          title="Add agent directory"
          aria-label="Add agent directory"
          icon={<Plus size={16} />}
        />
      </div>

      {/* One flat list, the way every chat client draws a roster: full-width rows, a hairline that
          starts where the text does, and no card around anything. Cards per agent made an open one
          look heavy and made the list read as a stack of panels. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {agents.map((agent) => {
          const selected = agent.id === agentId;
          const open = expanded.includes(agent.id);
          const state = states[agent.id] ?? "ready";
          const working = running.includes(agent.id);
          const conversations = open ? rowsFor(agent.id) : [];
          return (
            <div key={agent.id}>
              <div className="relative">
                <button
                  aria-label={agent.name}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(agent.id)}
                  title={`${agent.name}\n${agent.dir}\n${working ? "Working" : says[state]}`}
                  // Selection is the accent, not a grey: grey is what a row looks like under the
                  // pointer. The agent gets the tint and its open conversation the fill, so the two
                  // levels do not shout at each other.
                  className={`flex w-full items-center gap-3 py-2.5 pr-10 pl-3 text-left transition-colors ${
                    selected ? "bg-accent-weak" : "hover:bg-hover"
                  }`}
                >
                  <Avatar name={agent.name} working={working} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13.5px] font-semibold ${selected ? "text-accent" : ""}`}>
                      {agent.name}
                    </span>
                    <span className="block truncate text-[11px] font-mono text-muted">{home(agent.dir)}</span>
                  </span>
                  {/* Idle and ready is the state worth saying nothing about (§9). */}
                  {(working || state !== "ready") &&
                    (working ? (
                      <Badge tone="accent" pulse className="min-w-0">
                        <span className="truncate">working</span>
                      </Badge>
                    ) : (
                      <span aria-label={says[state]} className={`size-2 shrink-0 rounded-full ${dot[tones[state]]}`} />
                    ))}
                </button>
                {/* Opening an agent and looking at its conversations are two different questions, so
                    they are two different controls. Any number of agents can be open at once. */}
                <Button
                  kind="ghost"
                  size={28}
                  onClick={() => onToggle(agent.id)}
                  aria-label={`${open ? "Hide" : "Show"} conversations of ${agent.name}`}
                  aria-expanded={open}
                  title={open ? "Hide conversations" : "Show conversations"}
                  icon={<CaretDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                />
              </div>

              {open && (
                <div className="pb-1">
                  {conversations.map((row) => (
                    <div key={row.session} className="group relative">
                      <button
                        onClick={() => onOpen(agent.id, row.session)}
                        disabled={disabled && selected}
                        aria-current={selected && row.session === session ? "page" : undefined}
                        className={`flex w-full items-baseline gap-2 py-1.5 pr-3 pl-[54px] text-left transition-colors ${
                          selected && row.session === session ? "bg-accent text-accent-fg" : "hover:bg-hover"
                        }`}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-[12.5px] ${row.fresh ? "text-muted italic" : ""}`}
                        >
                          {row.label}
                        </span>
                        {row.updatedAt !== undefined && (
                          <span
                            className={`shrink-0 text-[10px] group-hover:invisible ${
                              selected && row.session === session ? "opacity-70" : "text-muted"
                            }`}
                          >
                            {ago(row.updatedAt)}
                          </span>
                        )}
                      </button>
                      {!row.fresh && (
                        <Button
                          kind="danger"
                          size={28}
                          onClick={() => onDelete(row.session)}
                          title="Delete conversation"
                          aria-label="Delete conversation"
                          icon={<Trash size={13} />}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        />
                      )}
                    </div>
                  ))}
                  {selected && !disabled && (
                    <Button
                      kind="ghost"
                      size={28}
                      onClick={onNew}
                      title="New conversation (⌘N)"
                      icon={<Plus size={14} />}
                      className="w-full justify-start! pl-[54px]!"
                    >
                      New conversation
                    </Button>
                  )}
                </div>
              )}
              {/* The separator starts where the text does, as it does in Telegram and WeChat. */}
              <div className="ml-[54px] h-px bg-stroke last:hidden" />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * What you are looking at, floating over it: the conversation, the workspace it runs in, and
 * whatever the turn costs. It hovers rather than sits in a bar because the transcript is the page,
 * and a full-width bar would cut it in two. Translucent, so text passing underneath reads as
 * scrolled away rather than deleted.
 */
export function ConversationHeader({
  agent,
  title,
  dir,
  working,
  context,
  queued,
  onReveal,
}: {
  agent: string;
  title: string;
  dir?: string;
  working: boolean;
  context?: number;
  queued?: number;
  onReveal: () => void;
}) {
  return (
    <div className="absolute inset-x-4 top-2 z-10 flex items-center gap-2.5 rounded-float bg-surface/75 py-1.5 pr-3 pl-2 ring-1 ring-stroke backdrop-blur-xl drag">
      {/* The same tile as in the sidebar: whose work this is should not need reading. */}
      <Avatar name={agent} size={30} working={working} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{title}</div>
        {dir && (
          <button
            onClick={onReveal}
            title={dir}
            className="no-drag block max-w-full truncate text-left font-mono text-[11px] text-muted hover:text-text"
          >
            {home(dir)}
          </button>
        )}
      </div>
      {working && <Badge tone="accent" pulse>working</Badge>}
      {context !== undefined && <span className="shrink-0 text-[11px] text-muted">{context}% context</span>}
      {!!queued && <span className="shrink-0 text-[11px] text-muted">{queued} queued</span>}
    </div>
  );
}

/** Whatever replaces the transcript sits in the transcript's box, so the composer never moves. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-16 pb-5">{children}</div>;
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
    // showModal() moves focus itself, after React has honoured autoFocus, so it lands on the close
    // button. Typing is what this list is for; the filter gets the caret.
    el.querySelector("input")?.focus();
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
      {/* The path is long and the close button is small: a row, not a float, or the two overlap. */}
      <div className="flex items-start gap-1 pl-2 pt-1">
        {models && <p className="flex-1 text-muted text-[11px] break-all">Credentials: {models.authPath}</p>}
        <Button kind="ghost" size={28} onClick={close} aria-label="Close model picker" icon={<X size={14} />} />
      </div>
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

export function Transcript({
  items,
  busySince,
  bottomGap,
}: {
  items: Item[];
  busySince?: number;
  /** How far the floating composer reaches up: the transcript scrolls under it, so it ends above it. */
  bottomGap: number;
}) {
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
      // pt clears the floating header; the first message starts below it, not behind it.
      className="flex-1 min-h-0 overflow-y-auto px-6 pt-16"
      style={{ paddingBottom: bottomGap }}
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
        <Badge tone={state.tone} pulse={item.status === "running"} className="shrink-0">
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
            className={`font-mono ${!model && needsModel ? "text-warning" : ""}`}
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
          <Button
            kind="danger"
            loud
            size={28}
            onClick={() => void store.abort()}
            aria-label="Stop the run"
            // Stopping ends the run, not its consequences; a tool that already wrote a file is done.
            title="Stop (Esc) — work its tools already finished is not undone"
            className="ml-auto"
            icon={<Stop size={13} weight="fill" />}
          />
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
