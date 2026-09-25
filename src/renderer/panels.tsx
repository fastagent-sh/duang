/** Everything the app draws that is not state: panels, rows, and the composer. */
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  DotsThree,
  CaretDown,
  Check,
  Copy,
  CaretRight,
  FilePlus,
  FileText,
  FolderOpen,
  GearSix,
  Globe,
  Info,
  ListBullets,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Stop,
  Terminal,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import { MarkdownCode } from "./code.tsx";
import type { AgentRow, DuangApi, ProviderUsage, UsageWindow } from "../preload/index.ts";
import { contextLabel, errorLine, pace, paceLabel, resetLabel } from "./usage.ts";
import { dayLabel, firstArg, foldHead, lines, stringify, toolText, type Item, type Line } from "./transcript.ts";
import { ago, clock, stamp, type Row } from "./sessions.ts";
import { complete, completionQuery, matches } from "./commands.ts";
import { Avatar, Badge, Button, Pill, type Tone } from "./ui.tsx";
import type { AgentState, Preview, Store, View } from "./store.ts";

/** A path as a person writes it. */
export const home = (dir: string): string => dir.replace(/^\/Users\/[^/]+/, "~");

/** Lead with the directory name so truncation keeps it visible; the full path is in the title. */
const location = (dir: string): string => {
  const parts = home(dir).split("/").filter(Boolean);
  return parts.length > 1 ? `${parts.at(-1)} · ${parts.at(-2)}` : parts[0] ?? "/";
};

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
 * A name being edited in place: an agent's in the roster, a conversation's in the list. Enter or
 * leaving the field keeps it, Escape drops it.
 */
function RenameField({
  label,
  value: initial,
  className,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  className: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        // The list's arrows and Delete belong to rows, not to a text field.
        event.stopPropagation();
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      className={`rounded-card bg-bg px-2 py-1 outline-none ring-1 ring-accent/60 ${className}`}
    />
  );
}

/** Focus asked for by a row that is about to re-render, taken once it exists again. */
function useRestoreFocus(find: (key: string) => HTMLElement | null | undefined) {
  const restore = useRef<string>(undefined);
  useEffect(() => {
    const key = restore.current;
    const el = key ? find(key) : undefined;
    if (!el) return;
    restore.current = undefined;
    el.focus();
  });
  return restore;
}

/**
 * The roster: who you work with, one row per agent, the way a chat client lists its contacts. A row
 * says what the agent last worked on and when, whether it is working now, and how many outcomes
 * landed while you were away. Conversations are one level down, in the header's list: listed here
 * they turned contacts into folders.
 */
export function Sidebar({
  agents,
  agentId,
  states,
  running,
  unseen,
  previews,
  latest,
  errors,
  settingsOpen,
  onSelect,
  onAdd,
  onSettings,
  onRename,
  onMenu,
}: {
  agents: AgentRow[];
  agentId?: string;
  states: Record<string, AgentState>;
  /** Running conversations per agent: the count is what makes `2 working` possible. */
  running: Record<string, string[]>;
  /** Outcomes nobody has looked at yet, per agent. The reason to come back to this window. */
  unseen: Record<string, Record<string, "done" | "failed">>;
  /** What each row quotes: the newest output of the conversation it speaks for (`Preview`). */
  previews: Record<string, Preview>;
  /** The agent's most recent conversation the runtime knows about: its label stands in until a preview is read. */
  latest: (agentId: string) => Row | undefined;
  /** Why an agent's list could not be read. An empty list and a failed one must not look alike. */
  errors: Record<string, string>;
  /** Settings is showing in the content area: it takes the one selection mark. */
  settingsOpen: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onRename: (id: string, name: string) => void;
  /** Raises the row's own menu — Rename lives there, which is where macOS keeps it. */
  onMenu: DuangApi["menu"];
}) {
  /**
   * One tab stop for the whole roster (§11, WAI-ARIA APG): Tab reaches it, arrows move inside it.
   * The keyboard starts on the open agent and stays where it was last moved.
   */
  const [reached, setReached] = useState<string>();
  const active = (agents.find((row) => row.id === reached) ?? agents.find((row) => row.id === agentId) ?? agents[0])?.id;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [renaming, setRenaming] = useState<string>();
  const restore = useRestoreFocus((id) => buttons.current.get(id));
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = agents.findIndex((row) => row.id === active);
    const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: agents.length - 1 }[event.key];
    const target = to === undefined ? undefined : agents[Math.max(0, Math.min(agents.length - 1, to))];
    if (!target) return;
    event.preventDefault();
    setReached(target.id);
    buttons.current.get(target.id)?.focus();
  };
  const endRename = (id: string) => {
    // The row's button is unmounted while the field stands in for it, so focus is taken back once
    // it exists again.
    restore.current = id;
    setRenaming(undefined);
  };
  return (
    <aside className="sidebar-panel w-[clamp(15rem,27vw,20rem)] shrink-0 flex flex-col min-h-0 rounded-float bg-sidebar ring-1 ring-stroke overflow-hidden">
      {/* The window controls overhang this card's top-left. The row is tall enough to hold them
          with air around it, and the wordmark is centred in the column rather than pushed along by
          them — Telegram's header, which has the same problem. */}
      <div className="relative h-12 shrink-0 flex items-center px-2 drag">
        <span className="sidebar-wordmark absolute left-1/2 -translate-x-1/2 font-medium tracking-[-0.01em]">
          duang<span className="text-accent">·</span>
        </span>
        <span className="flex-1" />
        <Button
          kind="ghost"
          size={28}
          onClick={onAdd}
          className="no-drag sidebar-add"
          title="Add agent directory"
          aria-label="Add agent directory"
          icon={<Plus size={16} />}
        />
      </div>

      {/* One flat list with a hairline that starts where the text does, and rows inset by 6px so a
          selected one is a rounded shape sitting in the column rather than a slab cut by its walls. */}
      <div role="navigation" aria-label="Agents" className="flex-1 overflow-y-auto min-h-0 px-1.5" onKeyDown={onKeyDown}>
        {agents.map((agent) => {
          const selected = agent.id === agentId;
          const state = states[agent.id] ?? "ready";
          const busy = running[agent.id]?.length ?? 0;
          const waiting = Object.values(unseen[agent.id] ?? {});
          const failures = waiting.filter((outcome) => outcome === "failed").length;
          const preview = previews[agent.id];
          const last = latest(agent.id);
          // The time of what is quoted; an empty new conversation has none to borrow from another.
          const at = preview ? preview.at : last?.updatedAt;
          const error = errors[agent.id] ?? preview?.error;
          const filled = selected && !settingsOpen;
          const status = `status-${agent.id}`;
          const rename = () => setRenaming(agent.id);
          return (
            // `roster-row` draws the hairline above each row but the first, and drops it beside a
            // filled row (index.css): a line running into a rounded fill reads as a cut.
            <div key={agent.id} className="roster-row" data-filled={filled || undefined}>
              {renaming === agent.id ? (
                <div className="flex items-center gap-3 px-2 py-2">
                  <Avatar name={agent.name} size={48} />
                  <RenameField
                    label="Agent name"
                    value={agent.name}
                    className="min-w-0 flex-1 text-[13.5px]"
                    onCancel={() => endRename(agent.id)}
                    onCommit={(name) => {
                      endRename(agent.id);
                      if (name.trim() && name.trim() !== agent.name) onRename(agent.id, name.trim());
                    }}
                  />
                </div>
              ) : (
                <button
                  ref={(el) => {
                    if (el) buttons.current.set(agent.id, el);
                    else buttons.current.delete(agent.id);
                  }}
                  tabIndex={active === agent.id ? 0 : -1}
                  aria-label={agent.name}
                  aria-describedby={status}
                  aria-current={filled ? "true" : undefined}
                  onFocus={() => setReached(agent.id)}
                  onClick={() => onSelect(agent.id)}
                  // Single click already opens, so double click is free for renaming, the way the
                  // conversation list does it.
                  onDoubleClick={rename}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void onMenu([{ id: "rename", label: "Rename…" }]).then((chosen) => chosen === "rename" && rename());
                  }}
                  title={`${agent.name}\n${agent.dir}\n${busy ? "Working" : says[state]}`}
                  className={`flex w-full items-center gap-3 rounded-card px-2 py-2 text-left transition-colors ${
                    filled ? "bg-accent-weak text-text" : "hover:bg-hover"
                  }`}
                >
                  <Avatar name={agent.name} size={48} working={busy > 0} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{agent.name}</span>
                      {/* Busy is said in words where the time goes: the preview below is the work
                          itself, streaming, and must not be replaced by a word about it. */}
                      {busy > 0 ? (
                        <Badge tone="accent" pulse className="shrink-0">
                          {busy > 1 ? `${busy} working` : "working"}
                        </Badge>
                      ) : (
                        at !== undefined && <span className="shrink-0 text-[11px] text-muted tabular-nums">{stamp(at)}</span>
                      )}
                    </span>
                    <span id={status} className="mt-0.5 flex h-[34px] items-start gap-2 text-[12.5px] leading-[17px]">
                      {/* A setup problem beats the preview, since there is no output to quote, and
                          is said in words, never a coloured dot alone (§9). */}
                      {state !== "ready" ? (
                        <Badge tone={tones[state]} className="min-w-0 flex-1">
                          <span className="truncate">{says[state].toLowerCase()}</span>
                        </Badge>
                      ) : error ? (
                        <span className="min-w-0 flex-1 line-clamp-2 break-words text-danger" title={error}>
                          {error}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 line-clamp-2 break-words text-muted">
                          {preview?.text ?? (preview ? "New conversation" : last?.label ?? "No conversations yet")}
                        </span>
                      )}
                      {/* What landed while you were away, spent as each conversation is opened.
                          Failures are what the count is for, so they colour it. */}
                      {waiting.length > 0 && (
                        <span
                          className="shrink-0 self-end"
                          title={`${waiting.length - failures} finished, ${failures} failed while you were away`}
                        >
                          <Pill tone={failures ? "danger" : "accent"}>{waiting.length}</Pill>
                          <span className="sr-only">
                            {failures ? `${failures} failed` : "done"} while you were away
                          </span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* App-level and rarely used, so it sits apart from the roster rather than beside its "+".
          It is a place, not an action: while Settings shows, this row is the one selection mark. */}
      <div className="shrink-0 border-t border-stroke px-1.5 py-1.5">
        <button
          onClick={onSettings}
          aria-current={settingsOpen ? "page" : undefined}
          title="Settings (⌘,)"
          className={`flex w-full items-center gap-2.5 rounded-card h-8 px-3 text-left text-[12.5px] transition-colors ${
            settingsOpen ? "bg-accent-weak text-accent" : "text-muted hover:bg-hover hover:text-text"
          }`}
        >
          <GearSix size={16} aria-hidden />
          Settings
        </button>
      </div>
    </aside>
  );
}

/**
 * The open agent's conversations, hanging from the header's list button the way ChatGPT's panels
 * do. A native popover: the top layer, light dismiss and Escape are the platform's, and the button
 * shows and hides it without any state of ours.
 */
export function ConversationList({
  rows,
  session,
  error,
  disabled,
  onToggle,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onMenu,
}: {
  rows: Row[];
  session?: string;
  /** Why the list could not be re-read; the rows shown are the last ones that could. */
  error?: string;
  /** The agent is opening: a row clicked now would land wherever the selection moves to. */
  disabled: boolean;
  onToggle: (open: boolean) => void;
  onOpen: (session: string) => void;
  onNew: () => void;
  onRename: (session: string, name: string) => void;
  onDelete: (session: string) => void;
  onMenu: DuangApi["menu"];
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<Row>();
  const restore = useRestoreFocus((key) =>
    panel.current?.querySelector<HTMLElement>(`button[data-session="${CSS.escape(key)}"]`),
  );
  const endRename = (row: Row) => {
    restore.current = row.session;
    setRenaming(undefined);
  };
  // An open popover that unmounts fires no toggle event, so whoever mirrors its state is told here.
  useEffect(() => () => onToggle(false), [onToggle]);
  /** Choosing is what the list was opened for, so it gets out of the way of what was chosen. */
  const close = () => panel.current?.hidePopover();
  /**
   * The rows are one list for the arrows, and Delete acts on the one the keyboard is on. A deleted
   * row hands the focus to its neighbour first, so the list stays reachable after it is gone.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const all = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-session]")];
    const index = all.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      all[index + step]?.focus();
      return;
    }
    const row = rows.find((candidate) => candidate.session === all[index]!.dataset.session);
    // A conversation the runtime has never heard of has nothing to delete: `delete()` answers
    // `no_such_session`, so it has no menu either.
    if ((event.key === "Delete" || event.key === "Backspace") && row && !row.fresh) {
      event.preventDefault();
      (all[index + 1] ?? all[index - 1])?.focus();
      onDelete(row.session);
    }
  };
  return (
    <div
      ref={panel}
      id="conversations"
      popover="auto"
      aria-label="Conversations"
      onToggle={(event) => onToggle(event.newState === "open")}
      className="popover w-80"
    >
      <div className="flex h-8 items-center justify-between pr-0.5 pl-2.5">
        <span className="text-[12px] font-medium text-muted">Conversations</span>
        <Button
          kind="ghost"
          size={28}
          onClick={() => {
            close();
            onNew();
          }}
          disabled={disabled && "The agent is still opening"}
          title="New conversation (⌘N)"
          aria-label="New conversation"
          icon={<Plus size={16} />}
        />
      </div>
      {error && (
        <p role="alert" className="px-2.5 pb-1 text-[11px] text-danger">
          {error}
        </p>
      )}
      <div className="max-h-[min(28rem,65vh)] overflow-y-auto" onKeyDown={onKeyDown}>
        {rows.map((row) => {
          const current = row.session === session;
          const menu = row.fresh
            ? undefined
            : () =>
                void onMenu([
                  { id: "rename", label: "Rename…" },
                  { id: "delete", label: "Delete Conversation" },
                ]).then((chosen) => {
                  if (chosen === "rename") setRenaming(row);
                  if (chosen === "delete") onDelete(row.session);
                });
          return renaming?.session === row.session ? (
            <RenameField
              key={row.session}
              label="Conversation name"
              value={renaming.label}
              className="my-0.5 block w-full text-[12.5px]"
              onCancel={() => endRename(row)}
              onCommit={(name) => {
                endRename(row);
                if (name.trim() && name.trim() !== renaming.label) onRename(row.session, name);
              }}
            />
          ) : (
            <div key={row.session} className="group relative">
              <button
                data-session={row.session}
                onClick={() => {
                  close();
                  onOpen(row.session);
                }}
                onDoubleClick={() => !row.fresh && setRenaming(row)}
                onContextMenu={(event) => {
                  if (!menu) return;
                  event.preventDefault();
                  menu();
                }}
                disabled={disabled}
                aria-current={current ? "page" : undefined}
                className={`flex w-full items-baseline gap-2 rounded-card py-1.5 pr-3 pl-2.5 text-left transition-colors ${
                  current ? "bg-accent-weak text-accent" : "hover:bg-hover"
                }`}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-[12.5px] ${row.fresh ? `${current ? "" : "text-muted"} italic` : ""} ${
                    row.unseen ? "font-semibold" : ""
                  }`}
                >
                  {row.label}
                </span>
                {/* Which conversation is alive is the question this row answers; the agent's
                    roster row only says that one of them is. */}
                {row.running ? (
                  <Badge tone="accent" pulse>
                    working
                  </Badge>
                ) : row.unseen ? (
                  <Pill tone={row.unseen === "failed" ? "danger" : "accent"}>{row.unseen}</Pill>
                ) : row.draft ? (
                  <span className="shrink-0 text-[11px] italic text-muted">unsent</span>
                ) : (
                  row.updatedAt !== undefined && (
                    <span className="shrink-0 text-[11px] text-muted tabular-nums group-hover:invisible">
                      {stamp(row.updatedAt)}
                    </span>
                  )
                )}
              </button>
              {/* One way to act on a row, not a shortcut to its most destructive action: the same
                  menu the right click raises. */}
              {menu && (
                <Button
                  kind="ghost"
                  size={28}
                  tabIndex={-1}
                  onClick={menu}
                  title="Conversation actions"
                  aria-label={`Actions for ${row.label}`}
                  icon={<DotsThree size={16} weight="bold" />}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What is left of the plan paying for this conversation: each window's share used, when it resets,
 * and for the week whether it is burning faster than the clock (▲) or slower (▼). Nothing for an API
 * key; a failed read says so instead of leaving old numbers up.
 */
export function PlanUsage({ plan, now = Date.now() }: { plan?: { data?: ProviderUsage; error?: string }; now?: number }) {
  if (plan?.error)
    return (
      <span className="pointer-events-auto shrink-0 text-[11px] text-muted" title={errorLine(plan.error)}>
        usage unavailable
      </span>
    );
  const windows = plan?.data?.windows;
  if (!windows?.length) return null;
  const detail = [
    ...windows.map((w) => {
      const reset = w.resetsAt === undefined ? "" : `, resets ${new Date(w.resetsAt).toLocaleString()}`;
      return `${w.label}: ${w.percent.toFixed(1)}% used${reset}`;
    }),
    `${plan!.data!.provider} · updated ${ago(plan!.data!.fetchedAt)}`,
  ].join("\n");
  return (
    <span className="pointer-events-auto flex shrink-0 items-center gap-3 text-[11px] text-muted tabular-nums" title={detail}>
      {windows.map((w) => (
        <PlanWindow key={w.label} window={w} now={now} />
      ))}
    </span>
  );
}

function PlanWindow({ window: w, now }: { window: UsageWindow; now: number }) {
  const reset = resetLabel(w);
  const diff = pace(w, now);
  return (
    <span className="flex items-center gap-1.5">
      {w.label}
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-stroke">
        <span className="block h-full rounded-full bg-muted" style={{ width: `${Math.min(100, w.percent)}%` }} />
      </span>
      {w.percent.toFixed(0)}%
      {/* A narrow header keeps the percentages; when and how fast move to the tooltip. Measured on
          the header, not the window, because the sidebar's width is the person's to drag. */}
      {reset && <span className="@max-[44rem]:hidden">~ {reset}</span>}
      {diff !== undefined && (
        <span className={`@max-[44rem]:hidden ${diff > 0 ? "text-danger" : "text-success"}`}>{paceLabel(diff)}</span>
      )}
    </span>
  );
}

/**
 * What you are looking at, floating over it: the conversation, the workspace it runs in, and what is
 * left of the plan and the context. It hovers rather than sits in a bar because the transcript is the
 * page, and a full-width bar would cut it in two. Translucent, so text passing underneath reads as
 * scrolled away rather than deleted.
 */
export function ConversationHeader({
  agent,
  title,
  dir,
  working,
  context,
  plan,
  queued,
  list,
  onReveal,
}: {
  agent: string;
  title: string;
  dir?: string;
  working: boolean;
  context?: { used: number; window: number };
  plan?: { data?: ProviderUsage; error?: string };
  queued?: number;
  /** The button that shows and hides this agent's conversations; absent while it has none to list. */
  list?: { open: boolean; unseen: number };
  onReveal: () => void;
}) {
  return (
    // The bar floats over the scroll area rather than inside it, so it must let the wheel through;
    // only what you can actually grab, click or hover for a tooltip takes the pointer back.
    <header className="conversation-header @container pointer-events-none absolute inset-x-4 top-2 z-10 flex items-center gap-2.5 rounded-float bg-surface/75 py-1.5 pr-3 pl-2 ring-1 ring-stroke backdrop-blur-xl">
      {/* The same avatar as in the roster: whose work this is should not need reading. */}
      <Avatar name={agent} size={30} working={working} />
      <div className="min-w-0 flex-1">
        {/* The title doubles as the window's drag handle, which the frameless title bar needs. */}
        <div className="pointer-events-auto flex min-w-0 items-baseline gap-1.5 drag">
          <span className={`${title === agent ? "max-w-full" : "max-w-[35%]"} shrink-0 truncate font-semibold`} title={agent}>{agent}</span>
          {title !== agent && <span className="min-w-0 truncate text-muted" title={title}>· {title}</span>}
        </div>
        {dir && (
          <button
            onClick={onReveal}
            title={dir}
            className="pointer-events-auto block max-w-full truncate text-left text-[11px] text-muted hover:text-text"
          >
            {location(dir)}
          </button>
        )}
      </div>
      {working && <Badge tone="accent" pulse>working</Badge>}
      <PlanUsage plan={plan} />
      {context && (
        <span className="pointer-events-auto shrink-0 text-[11px] text-muted tabular-nums" title="Context used, out of the model's window">
          {contextLabel(context.used, context.window)}
        </span>
      )}
      {!!queued && <span className="shrink-0 text-[11px] text-muted">{queued} queued</span>}
      {list && (
        // Opens the `ConversationList` popover by id and anchors it (index.css). A dot says one of
        // them finished while you were elsewhere, which is the reason to open it.
        <Button
          kind="ghost"
          size={28}
          popoverTarget="conversations"
          aria-label={list.unseen ? `Conversations, ${list.unseen} unseen` : "Conversations"}
          title="Conversations"
          icon={
            <span className="relative">
              <ListBullets size={16} />
              {list.unseen > 0 && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-accent" />}
            </span>
          }
          className={`conversations-anchor pointer-events-auto -mr-1.5 ${list.open ? "bg-hover" : ""}`}
        />
      )}
    </header>
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
  const matches = (models?.specs ?? [])
    .filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(b === current) - Number(a === current))
    .slice(0, 60);

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
      <div className="flex items-center justify-between pl-2 pt-1 pb-1">
        <span className="text-[12px] font-semibold">Choose a model</span>
        <Button kind="ghost" size={28} onClick={close} aria-label="Close model picker" icon={<X size={14} />} />
      </div>
      {models && (
        <details className="mb-2 px-2 text-muted text-[11px]" title={models.authPath}>
          <summary className="cursor-pointer truncate">Credentials · {location(models.authPath)}</summary>
          <code className="block break-all p-1 select-text">{models.authPath}</code>
        </details>
      )}
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
                aria-current={model === current ? "true" : undefined}
                className={`flex w-full items-center gap-2 text-left px-2 py-2 font-mono text-[12px] rounded-card hover:bg-hover ${
                  model === current ? "bg-accent-weak text-accent" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {model === current && <Check size={13} aria-hidden />}
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
export function NewConversation({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto grid place-items-center px-6">
      <div className="composer-column -mt-16">
        <h1 className="text-[22px] font-medium mb-5">What should we work on?</h1>
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
    <Badge tone="accent" pulse className="enter">
      {/* The sweep is on the words, not on their opacity: this sits on screen for minutes at a time,
          and a blinking label is the first thing that makes an interface look cheap. */}
      <span className="shimmer">working… {Math.max(0, Math.round((now - since) / 1000))}s</span>
    </Badge>
  );
}

/**
 * The space above a line, decided by the pair rather than by one constant (§8).
 *
 * A single gap for everything is what made a run of tool calls read as a sparse list: `bash`,
 * `thinking`, `bash` are single lines of one activity, and 24 between them is the space a paragraph
 * gets. They close up to 8; the register changing — to or from what someone wrote or the agent
 * answered — is what earns the full step.
 */
const ASIDE = new Set(["tool", "thinking", "note"]);

function gap(previous: Line | undefined, line: Line): string {
  if (!previous) return "";
  if (line.kind === "user") return "pt-8";
  return ASIDE.has(line.kind) && ASIDE.has(previous.kind) ? "pt-2" : "pt-6";
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
  // Scrolling up during a long run stops the tail following, and the only way back was to scroll:
  // the control appears exactly while that is true.
  const [away, setAway] = useState(false);
  /**
   * One place that decides it, because scrolling is not the only way the answer changes: resizing
   * the window, or output growing past the viewport, makes a transcript scrollable without any
   * scroll event to notice it.
   */
  const check = () => {
    const el = box.current;
    if (!el) return;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAway(!follow.current);
  };

  // Nothing is streaming when the last thing said is closed — that is when the indicator earns its place.
  const last = items.at(-1);
  const streaming = last?.kind === "assistant" || last?.kind === "thinking" ? last.open : false;

  const shown = lines(items);
  /**
   * `enter` is for what arrives, and history has not arrived — it was already there. This component
   * remounts for every conversation it shows (keyed by subscription), and it mounts with the history
   * already loaded, so the rows on screen at mount are the old ones and everything past them is new.
   * Without this, opening a conversation floated its whole backlog in at once.
   */
  const history = useRef(shown.length);

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
    check();
  }, [items, busySince, streaming]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {away && (
        <Button
          kind="secondary"
          size={32}
          onClick={() => {
            const el = box.current;
            if (!el) return;
            // Not smooth: every frame of an animated scroll fires `scroll`, and until the last one
            // the transcript is not at the bottom, so the button it came from flickers back.
            el.scrollTop = el.scrollHeight;
            check();
          }}
          aria-label="Back to the latest"
          title="Back to the latest"
          icon={<ArrowDown size={16} />}
          className="pop absolute right-6 z-10 bg-surface shadow-lg"
          style={{ bottom: bottomGap - 8 }}
        />
      )}
    <div
      ref={box}
      // A focusable region, so the transcript can be read and scrolled from the keyboard (§11).
      // Chromium gives a scroll container the arrow keys once it has focus; naming it is ours.
      tabIndex={0}
      role="region"
      aria-label="Transcript"
      onScroll={check}
      // pt clears the floating header; the first message starts below it, not behind it.
      className="flex-1 min-h-0 overflow-y-auto px-6 pt-16"
      style={{ paddingBottom: bottomGap }}
    >
      <div className="column">
        {shown.map((line, index, all) =>
          line.kind === "day" ? (
            // Reading yesterday's run is the normal case here; without this the whole conversation
            // reads as one sitting.
            <div key={index} className="flex items-center gap-3 py-4 text-[11px] text-muted">
              <span className="h-px flex-1 bg-stroke" />
              {dayLabel(line.at)}
              <span className="h-px flex-1 bg-stroke" />
            </div>
          ) : (
            // `enter` runs once, when the element is created — a streaming answer re-renders into
            // the same node, so the rise does not restart on every token.
            <div key={index} className={`${index >= history.current ? "enter" : ""} ${gap(all[index - 1], line)}`}>
              <Message item={line} />
            </div>
          ),
        )}
        {busySince !== undefined && !streaming && (
          <div className="pt-6">
            <Working since={busySince} />
          </div>
        )}
      </div>
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
        <div className="flex flex-col items-end gap-1">
          <div
            className={`bubble max-w-[80%] rounded-card rounded-br-[4px] bg-accent-weak px-3.5 py-2 whitespace-pre-wrap ${
              item.steered ? "border-r-2 border-accent" : ""
            }`}
          >
            {item.text}
          </div>
          {/* After the fact nothing else distinguishes a message that joined a run from one that
              started it (§8). */}
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {item.steered && <span className="text-accent">joined the run</span>}
            <span>{clock(item.at)}</span>
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="group/msg">
          <div className="md">
            {/* The cursor is appended to the text rather than to the container: Streamdown emits
                block elements, so a sibling span would start its own line instead of trailing the
                last word. Token arrival is the animation (§8, §10). */}
            <Streamdown components={markdownComponents} controls={markdownControls}>
              {item.open ? `${item.text}▍` : item.text}
            </Streamdown>
          </div>
          {!item.open && <Footer text={item.text} at={item.at} />}
        </div>
      );
    case "thinking": {
      // Collapsed, a bare "thinking" says nothing about what happened. How long it took and the
      // line it is on are the two facts worth reading without expanding (docs/ui.md §8).
      const seconds = Math.round((item.at - item.started) / 1000);
      const trail = item.text.trim().split("\n").at(-1) ?? "";
      return (
        <details className="group text-muted text-[12px]">
          <summary className="cursor-default select-none flex items-center gap-1.5">
            <CaretRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
            {/* Still streaming means the seconds are not final yet, so the label sweeps instead of
                counting: the movement is the answer to "is it stuck". */}
            <span className={`shrink-0 ${item.open ? "shimmer" : ""}`}>
              {seconds > 0 ? `thinking · ${seconds}s` : "thinking"}
            </span>
            <span className="truncate opacity-60 group-open:hidden">{trail}</span>
          </summary>
          <div className="mt-1.5 ml-[5px] whitespace-pre-wrap border-l border-stroke pl-3 leading-relaxed">
            {item.text}
          </div>
        </details>
      );
    }
    case "note":
      // A fact about the session, not something anyone said: centred, quiet, and only red when it
      // is genuinely a failure. A refusal names itself, because "refused" and "failed" are not the
      // same answer — nothing ran, so the text is still the person's to edit (§9).
      return (
        <div className="flex items-center justify-center gap-1.5 text-[11px]">
          {item.tone === "warning" ? (
            <Badge tone="warning" icon={<WarningCircle size={12} />}>
              refused
            </Badge>
          ) : (
            <span className={item.tone === "error" ? "text-danger" : "text-muted"}>
              {item.tone === "error" ? <WarningCircle size={12} /> : <Info size={12} />}
            </span>
          )}
          <span className={`font-mono ${item.tone === "error" ? "text-danger" : "text-muted"}`}>{item.text}</span>
        </div>
      );
    case "tool":
      return <Tool item={item} />;
  }
}

/**
 * What an agent's answer ends with: when it landed, and a way to take it somewhere else. Nothing
 * else — a rating has nowhere to go, and branching and editing are not features here.
 */
function Footer({ text, at }: { text: string; at: number }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="mt-2 flex items-center gap-1 text-[11px] text-muted">
      <span className="tabular-nums">{clock(at)}</span>
      {failed && <span className="text-danger">could not copy: {failed}</span>}
      <Button
        kind="ghost"
        size={28}
        aria-label={copied ? "Copied" : "Copy message"}
        title={failed ?? "Copy this answer"}
        icon={copied ? <Check size={13} /> : <Copy size={13} />}
        className={`transition-opacity ${failed ? "" : "opacity-0"} group-hover/msg:opacity-100 focus-visible:opacity-100`}
        onClick={() => {
          // Refused clipboards happen — an unfocused window, another process holding it. Saying
          // nothing leaves a button that looks broken, so the failure takes the button's own label.
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              timer.current = window.setTimeout(() => setCopied(false), 1500);
            },
            (error: unknown) => {
              setFailed(String(error instanceof Error ? error.message : error));
              timer.current = window.setTimeout(() => setFailed(undefined), 4000);
            },
          );
        }}
      />
    </div>
  );
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

/**
 * One vocabulary, and a stop is never reported as a failure — see docs/ui.md §9.
 *
 * A tool that simply worked says nothing: the third tier of §9 is "nothing to do, show nothing",
 * and a trace where nine cards in ten wear a green `done` is exactly how the one that failed gets
 * lost. Absence is unambiguous here because every other outcome, including still running, is named.
 */
function toolState(item: Extract<Item, { kind: "tool" }>): { word: string; tone: Tone } | undefined {
  if (item.status === "interrupted") return { word: "stopped", tone: "muted" };
  if (item.isError) return { word: "failed", tone: "danger" };
  if (item.status === "running") return { word: "running", tone: "accent" };
  return undefined;
}

function Tool({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const summary = firstArg(item.args);
  const state = toolState(item);
  const Icon = toolIcons[item.name] ?? Terminal;
  // The icon carries the state too: a failed call is red before the badge beside it is read.
  const mark = item.isError ? "text-danger" : item.status === "running" ? "text-accent" : "text-muted";
  return (
    // Closed, a tool call is a line of the document, not an object on top of it: no fill, no border,
    // nothing but the row it occupies. Boxing it either way was the mistake — full width it was a grey
    // slab, shrunk to its text it looked like a button sitting in the middle of prose. The surface
    // arrives only when there is output to hold, which is the one moment a card is doing work.
    //
    // The negative margin lets the hover highlight breathe past the text without moving the text:
    // the command stays on the document's left edge, aligned with the paragraphs above it.
    <details className="group -mx-2.5 rounded-card open:bg-surface open:ring-1 open:ring-stroke">
      <summary className="cursor-default select-none flex items-center gap-2 rounded-card px-2.5 h-8 text-[12px] hover:bg-hover group-open:rounded-b-none">
        <CaretRight size={11} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
        <Icon size={14} className={`shrink-0 ${mark}`} />
        {/* The tool's own name in front of its argument: `bash` and `read` are different work, and
            a bare path does not say which one ran. */}
        <span className="shrink-0 text-muted">{item.name}</span>
        <span className="font-mono truncate">{summary}</span>
        {/* The state belongs next to the command it describes, not at the far edge of the row. */}
        {state && (
          <Badge tone={state.tone} pulse={item.status === "running"} className="shrink-0">
            {state.word}
          </Badge>
        )}
      </summary>
      <div className="border-t border-stroke px-2.5 py-2.5 space-y-2.5 text-[12px]">
        <Args args={item.args} summary={summary} />
        {item.result !== undefined && <Output text={toolText(item.result)} isError={item.isError} />}
      </div>
    </details>
  );
}

/**
 * Arguments as a label and a value, not the JSON the wire carried. `{"pattern":"foo","glob":"*.ts"}`
 * asks the reader to parse punctuation to find two facts; the braces and quotes are ours to drop.
 * The one argument already spelled out in the header is not repeated.
 */
function Args({ args, summary }: { args: unknown; summary: string }) {
  if (args === undefined || args === null) return null;
  if (typeof args !== "object") return <pre className="font-mono whitespace-pre-wrap break-all">{stringify(args)}</pre>;
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0 || (entries.length === 1 && entries[0]![1] === summary)) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="text-muted">{key}</dt>
          <Value text={stringify(value)} />
        </Fragment>
      ))}
    </dl>
  );
}

/** One argument's value, folded like output is: a `write` carries the whole file it writes. */
function Value({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const head = foldHead(text);
  return (
    <dd className="font-mono whitespace-pre-wrap break-all">
      {head !== undefined && !open ? `${head}…` : text}
      {head !== undefined && (
        <button
          type="button"
          className="ml-1.5 font-sans text-[11px] text-muted transition-colors hover:text-text"
          onClick={() => setOpen(!open)}
        >
          {open ? "show less" : "show all"}
        </button>
      )}
    </dd>
  );
}

/**
 * What the tool printed. Long output folds rather than growing its own scrollbar: a scroll region
 * inside a scrolling transcript steals the wheel from the page it sits in, and hides how much is
 * there. The fold is `foldHead`'s: twelve lines or about as many characters (§8) — enough to see
 * whether it is the output you wanted.
 */
function Output({ text, isError }: { text: string; isError?: boolean }) {
  const [open, setOpen] = useState(false);
  const head = foldHead(text);
  // Cut mid-line, the fold hides characters rather than lines, and "0 more lines" would be a lie.
  const hidden = head === undefined ? 0 : text.split("\n").length - head.split("\n").length;
  return (
    <div>
      {/* The error rule is on the text, not on this wrapper: the footer below has to reach both
          edges of the card, and a padded, bordered parent would stop it at the red line. */}
      <pre
        className={`font-mono whitespace-pre-wrap break-all leading-relaxed ${
          isError ? "border-l-2 border-danger pl-2.5 text-danger" : ""
        }`}
      >
        {head !== undefined && !open ? head : text}
      </pre>
      {head !== undefined && (
        // The card's own footer, not a link floating under the text: it spans the card, sits on a
        // hairline, and lands on the card's bottom corners. The negative margins reach out of the
        // padded body it is nested in, so its width is the body's plus both of them: `w-full` alone
        // pins it to the body and the margins only shift it left, and a button's automatic width
        // shrinks to its label rather than filling the line the way a div's would.
        <button
          type="button"
          className="focus-inset -mx-2.5 -mb-2.5 mt-2 flex h-7 w-[calc(100%+1.25rem)] items-center justify-center gap-1.5 rounded-b-card border-t border-stroke text-[11px] text-muted transition-colors hover:bg-hover hover:text-text"
          onClick={() => setOpen(!open)}
        >
          <CaretDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "show less" : hidden > 0 ? `${hidden} more lines` : "show the rest"}
        </button>
      )}
    </div>
  );
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
    <div className="composer-card relative rounded-card bg-surface ring-1 ring-stroke focus-within:ring-accent/50 px-3 py-2.5">
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
              <span className="ml-auto text-[11px] text-muted">{command.source}</span>
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
        rows={1}
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
        // The field matches the leading of the bubble it turns into: a composer that types tighter
        // than it sends makes a long message reflow the moment it is sent.
        className="bubble w-full min-h-7 resize-none bg-transparent outline-none placeholder:text-muted disabled:opacity-40"
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
