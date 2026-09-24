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
  Globe,
  Info,
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
import type { AgentRow, ProviderUsage, UsageWindow } from "../preload/index.ts";
import { contextLabel, errorLine, pace, paceLabel, resetLabel } from "./usage.ts";
import { dayLabel, firstArg, foldHead, lines, stringify, toolText, type Item, type Line } from "./transcript.ts";
import { ago, type Row } from "./sessions.ts";
import { complete, completionQuery, matches } from "./commands.ts";
import { Avatar, Badge, Button, Pill, type Tone } from "./ui.tsx";
import type { AgentState, Store, View } from "./store.ts";

/** Clock time, for the end of a message: the day is the separator's job, not every line's. */
// `numeric` hours, not `2-digit`: a 12-hour locale renders "01:08 AM" for the second one, and no
// clock on the machine this runs on writes it that way.
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
 * A conversation's row while it is being named. FastAgent owns the label (`update({ name })`); until
 * something sets it, a row falls back to the first message, which is why a conversation whose
 * subject moved on keeps the sentence it started with.
 */
function RenameRow({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(label);
  return (
    <input
      autoFocus
      aria-label="Conversation name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        // The roster's arrows and Delete belong to rows, not to a text field.
        event.stopPropagation();
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      className="my-0.5 ml-16 block w-[calc(100%-72px)] rounded-card bg-bg px-2 py-1 text-[12.5px] outline-none ring-1 ring-accent/60"
    />
  );
}

/**
 * One column: who you work with, and what each of them has been talking about.
 *
 * Agents are rows rather than a strip of tiles, because a name and its state need words. Any number
 * of agents can list their conversations at once; expanding one that is not open asks the store for
 * its list, which boots that agent's runtime exactly as opening it would.
 */
export function Sidebar({
  agents,
  agentId,
  states,
  running,
  unseen,
  rowsFor,
  session,
  expanded,
  errors,
  disabled,
  onSelect,
  onToggle,
  onAdd,
  onOpen,
  onNew,
  onDelete,
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
  rowsFor: (agentId: string) => Row[];
  session?: string;
  expanded: string[];
  /** Why an expanded agent has no list. An empty list and a failed one must not look alike. */
  errors: Record<string, string>;
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: () => void;
  onOpen: (agentId: string, session: string) => void;
  onNew: () => void;
  onDelete: (agentId: string, session: string) => void;
  onRename: (agentId: string, session: string, name: string) => void;
  /** Raises the row's own menu — Rename lives there, which is where macOS keeps it. */
  onMenu: (canRename: boolean) => Promise<"rename" | "delete" | undefined>;
}) {
  /**
   * One tab stop for the whole column (§11, WAI-ARIA APG): Tab reaches the list, arrows move inside
   * it. The row controls leave the tab order with it — a caret and a delete on every row would make
   * Tab walk the roster three times — so the keys they stand for live on the row: Right and Left
   * expand and collapse an agent, Delete removes a conversation.
   */
  const showNew = (id: string, rows: Row[]) =>
    id === agentId && !disabled && !rows.some((row) => row.session === session && row.fresh && !row.draft && !row.running);
  const rowsOnScreen: { key: string; agent: string; session?: string; fresh?: boolean }[] = [];
  for (const agent of agents) {
    rowsOnScreen.push({ key: `agent:${agent.id}`, agent: agent.id });
    if (expanded.includes(agent.id)) {
      const rows = rowsFor(agent.id);
      for (const row of rows)
        rowsOnScreen.push({
          key: `conv:${agent.id}/${row.session}`,
          agent: agent.id,
          session: row.session,
          fresh: row.fresh,
        });
      // "New conversation" is a row in the list, so the arrows reach it too; anything left tabbable
      // inside the list would make Tab walk the roster a second time.
      if (showNew(agent.id, rows)) rowsOnScreen.push({ key: `new:${agent.id}`, agent: agent.id });
    }
  }
  /**
   * A disabled button ignores `tabIndex` and refuses `focus()`, so the open agent's conversations
   * drop out while it is loading. Moving over them would leave the real focus somewhere the ring is
   * not, and Enter would then open a row nobody can see is active.
   */
  const focusable = rowsOnScreen.filter((row) => !(disabled && row.agent === agentId && row.session));
  const current = session && agentId ? `conv:${agentId}/${session}` : `agent:${agentId ?? ""}`;
  const [reached, setReached] = useState<string>();
  /**
   * The keyboard starts where the eye is: whatever is open, until the arrows move somewhere else.
   * Never nowhere — folding the open agent takes `current` off screen, and a list with no
   * `tabIndex={0}` in it is a list Tab cannot enter at all.
   */
  const active = (
    focusable.find((row) => row.key === reached) ??
    focusable.find((row) => row.key === current) ??
    // The open conversation is not listed unless its agent is unfolded; the agent itself is the
    // next truest answer to "where am I", and only then the top of the list.
    focusable.find((row) => row.key === `agent:${agentId ?? ""}`) ??
    focusable[0]
  )?.key;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const go = (key: string) => {
    setReached(key);
    buttons.current.get(key)?.focus();
  };
  /**
   * A row deleted from the keyboard takes the focus with it: the browser hands it back to the body,
   * and the list stops being reachable without a fresh Tab. The neighbour it left behind is focused
   * once it exists (APG's rule for deleting inside a list).
   */
  /** The conversation being renamed in place, if any. FastAgent owns the name; this is the edit. */
  const [renaming, setRenaming] = useState<{ agent: string; session: string; label: string }>();
  const restore = useRef<string>(undefined);
  useEffect(() => {
    const key = restore.current;
    if (!key) return;
    const el = buttons.current.get(key);
    if (!el) return;
    restore.current = undefined;
    el.focus();
  });
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = focusable.findIndex((row) => row.key === active);
    const row = focusable[index];
    const step = (to: number) => {
      const target = focusable[Math.max(0, Math.min(focusable.length - 1, to))];
      if (target) {
        event.preventDefault();
        go(target.key);
      }
    };
    if (event.key === "ArrowDown") return step(index + 1);
    if (event.key === "ArrowUp") return step(index - 1);
    if (event.key === "Home") return step(0);
    if (event.key === "End") return step(focusable.length - 1);
    if (!row) return;
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !row.session) {
      const open = expanded.includes(row.agent);
      if (open === (event.key === "ArrowRight")) return;
      event.preventDefault();
      return onToggle(row.agent);
    }
    // Same condition as the button: a conversation the runtime has never heard of has no delete
    // control, and asking main to delete it earns a confirmation followed by an error.
    if ((event.key === "Delete" || event.key === "Backspace") && row.session && !row.fresh) {
      event.preventDefault();
      const neighbour = focusable[index + 1] ?? focusable[index - 1];
      if (neighbour) {
        restore.current = neighbour.key;
        setReached(neighbour.key);
      }
      return onDelete(row.agent, row.session);
    }
  };
  return (
    <aside className="w-[clamp(15rem,27vw,20rem)] shrink-0 flex flex-col min-h-0 rounded-float bg-sidebar ring-1 ring-stroke overflow-hidden">
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

      {/* One flat list, the way every chat client draws a roster: a hairline that starts where the
          text does, and no card around anything. Cards per agent made an open one look heavy and
          made the list read as a stack of panels.

          The 6px gutter is what makes selection look drawn rather than stamped: a filled row that
          runs into both walls of the column reads as a slab with two square corners cut by the
          panel, which is the difference between this list and Telegram's. Inset, the fill is a
          rounded shape sitting *in* the column. */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5" onKeyDown={onKeyDown}>
        {agents.map((agent) => {
          const selected = agent.id === agentId;
          const open = expanded.includes(agent.id);
          const state = states[agent.id] ?? "ready";
          const busy = running[agent.id]?.length ?? 0;
          const waiting = Object.values(unseen[agent.id] ?? {});
          const failures = waiting.filter((outcome) => outcome === "failed").length;
          const conversations = open ? rowsFor(agent.id) : [];
          // One selection mark at a time: once the conversation being read is listed, it carries
          // the tint and its agent row steps back to plain.
          const marked = selected && !conversations.some((row) => row.session === session);
          return (
            <div key={agent.id}>
              <div className="relative">
                <button
                  ref={(el) => {
                    if (el) buttons.current.set(`agent:${agent.id}`, el);
                    else buttons.current.delete(`agent:${agent.id}`);
                  }}
                  tabIndex={active === `agent:${agent.id}` ? 0 : -1}
                  aria-label={agent.name}
                  aria-expanded={open}
                  aria-current={selected ? "true" : undefined}
                  onFocus={() => setReached(`agent:${agent.id}`)}
                  onClick={() => onSelect(agent.id)}
                  title={`${agent.name}\n${agent.dir}\n${busy ? "Working" : says[state]}`}
                  className={`flex w-full items-center gap-3 rounded-card py-2.5 pr-10 pl-3 text-left transition-colors ${
                    marked ? "bg-accent-weak text-text" : "hover:bg-hover"
                  }`}
                >
                  <Avatar name={agent.name} working={busy > 0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{agent.name}</span>
                    <span className="block truncate text-[11px] text-muted">{location(agent.dir)}</span>
                  </span>
                  {/* Idle and ready is the state worth saying nothing about (§9). Everything else
                      is said in words: a coloured dot alone leaves colour doing the work, and the
                      count is what the agent row can say that a conversation row cannot. */}
                  {busy > 0 ? (
                    <Badge tone="accent" pulse className="min-w-0">
                      <span className="truncate">{busy > 1 ? `${busy} working` : "working"}</span>
                    </Badge>
                  ) : waiting.length > 0 ? (
                    // What landed while you were away, summed on the agent row and spent when the
                    // conversation is opened. Failures are what the count is for, so they win.
                    <Pill tone={failures ? "danger" : "accent"}>
                      {failures ? `${failures} failed` : `${waiting.length} done`}
                    </Pill>
                  ) : (
                    state !== "ready" && (
                      <Badge tone={tones[state]} className="min-w-0">
                        <span className="truncate">{says[state].toLowerCase()}</span>
                      </Badge>
                    )
                  )}
                </button>
                {/* Opening an agent and looking at its conversations are two different questions, so
                    they are two different controls. Any number of agents can be open at once. */}
                <Button
                  kind="ghost"
                  size={28}
                  tabIndex={-1}
                  onClick={() => onToggle(agent.id)}
                  aria-label={`${open ? "Hide" : "Show"} conversations of ${agent.name}`}
                  title={open ? "Hide conversations" : "Show conversations"}
                  icon={<CaretDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                />
              </div>

              {open && (
                <div className="pb-1">
                  {errors[agent.id] && (
                    <p role="alert" className="pb-1 pr-3 pl-16 text-[11px] text-danger">
                      {errors[agent.id]}
                    </p>
                  )}
                  {conversations.map((row) => {
                    // A conversation the runtime has never heard of can be neither renamed nor
                    // deleted — `update()` and `delete()` both answer `no_such_session` — so it has
                    // no menu at all, which is what the keyboard's Delete already assumed.
                    const current = selected && row.session === session;
                    const menu = row.fresh
                      ? undefined
                      : () =>
                          void onMenu(true).then((chosen) => {
                            if (chosen === "rename")
                              setRenaming({ agent: agent.id, session: row.session, label: row.label });
                            if (chosen === "delete") onDelete(agent.id, row.session);
                          });
                    return renaming?.agent === agent.id && renaming.session === row.session ? (
                      <RenameRow
                        key={row.session}
                        label={renaming.label}
                        onCancel={() => {
                          // The row's button is unmounted while this input stands in for it, so the
                          // focus is asked for and taken once it is back — the same path a deleted
                          // row uses. Focusing here would be a no-op and leave the body focused.
                          restore.current = `conv:${agent.id}/${row.session}`;
                          setRenaming(undefined);
                        }}
                        onCommit={(name) => {
                          restore.current = `conv:${agent.id}/${row.session}`;
                          setRenaming(undefined);
                          if (name.trim() && name.trim() !== renaming.label) onRename(agent.id, row.session, name);
                        }}
                      />
                    ) : (
                    <div key={row.session} className="group relative">
                      <button
                        ref={(el) => {
                          if (el) buttons.current.set(`conv:${agent.id}/${row.session}`, el);
                          else buttons.current.delete(`conv:${agent.id}/${row.session}`);
                        }}
                        tabIndex={active === `conv:${agent.id}/${row.session}` ? 0 : -1}
                        onFocus={() => setReached(`conv:${agent.id}/${row.session}`)}
                        onClick={() => onOpen(agent.id, row.session)}
                        // Single click already opens, so double click is free for renaming the way
                        // Notes and Safari's bookmarks do it.
                        onDoubleClick={() => !row.fresh && setRenaming({ agent: agent.id, session: row.session, label: row.label })}
                        onContextMenu={(event) => {
                          if (!menu) return;
                          event.preventDefault();
                          menu();
                        }}
                        disabled={disabled && selected}
                        aria-current={current ? "page" : undefined}
                        className={`flex w-full items-baseline gap-2 rounded-card py-1.5 pr-3 pl-16 text-left transition-colors ${
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
                        {/* Which conversation is alive is the question this row answers; the agent
                            row above only says that one of them is. */}
                        {row.running ? (
                          <Badge tone="accent" pulse>
                            working
                          </Badge>
                        ) : row.unseen ? (
                          <Pill tone={row.unseen === "failed" ? "danger" : "accent"}>
                            {row.unseen}
                          </Pill>
                        ) : row.draft ? (
                          <span className="shrink-0 text-[11px] italic text-muted">
                            unsent
                          </span>
                        ) : (
                          row.updatedAt !== undefined && (
                            <span
                              className="shrink-0 text-[11px] text-muted group-hover:invisible"
                            >
                              {ago(row.updatedAt)}
                            </span>
                          )
                        )}
                      </button>
                      {/* One way to act on a row, not a shortcut to its most destructive action:
                          the same menu the right click raises. */}
                      {menu && (
                        <Button
                          kind="ghost"
                          size={28}
                          tabIndex={-1}
                          onClick={menu}
                          title="Conversation actions"
                          aria-label={`Actions for ${row.label}`}
                          icon={<DotsThree size={16} weight="bold" />}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        />
                      )}
                    </div>
                    );
                  })}
                  {showNew(agent.id, conversations) && (
                    <Button
                      kind="ghost"
                      size={28}
                      ref={(el) => {
                        if (el) buttons.current.set(`new:${agent.id}`, el);
                        else buttons.current.delete(`new:${agent.id}`);
                      }}
                      tabIndex={active === `new:${agent.id}` ? 0 : -1}
                      onFocus={() => setReached(`new:${agent.id}`)}
                      onClick={onNew}
                      title="New conversation (⌘N)"
                      icon={<Plus size={14} />}
                      className="w-full justify-start! rounded-card pl-16!"
                    >
                      New conversation
                    </Button>
                  )}
                </div>
              )}
              {/* The separator starts where the text does, as it does in Telegram and WeChat. It
                  divides agents, so the last row has none — `last:hidden` hid every one of them,
                  because each is the last child of its own agent. */}
              {agent.id !== agents.at(-1)?.id && <div className="my-0.5 ml-16 h-px bg-stroke" />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * What you are looking at: the conversation, workspace and running context. The pill keeps the
 * floating visual language but occupies its own row, so scrolled text never ghosts through it.
 */
/**
 * What is left of the plan paying for this conversation: each window's share used, when it resets,
 * and for the week whether it is burning faster than the clock (▲) or slower (▼). Nothing for an API
 * key; a failed read says so instead of leaving old numbers up.
 */
export function PlanUsage({ plan, now = Date.now() }: { plan?: { data?: ProviderUsage; error?: string }; now?: number }) {
  if (plan?.error)
    return (
      <span className="shrink-0 text-[11px] text-muted" title={errorLine(plan.error)}>
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
    <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted tabular-nums" title={detail}>
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

export function ConversationHeader({
  agent,
  title,
  dir,
  working,
  context,
  plan,
  queued,
  onReveal,
}: {
  agent: string;
  title: string;
  dir?: string;
  working: boolean;
  context?: { used: number; window: number };
  plan?: { data?: ProviderUsage; error?: string };
  queued?: number;
  onReveal: () => void;
}) {
  return (
    // Keep the pill's floating shape, but give it its own row: scrolled text cannot show through it.
    <header className="@container relative z-10 mx-4 mt-2 mb-3 shrink-0 flex items-center gap-2.5 rounded-float bg-surface py-1.5 pr-3 pl-2 ring-1 ring-stroke">
      {/* The same tile as in the sidebar: whose work this is should not need reading. */}
      <Avatar name={agent} size={30} working={working} />
      <div className="min-w-0 flex-1">
        {/* The title doubles as the window's drag handle, which the frameless title bar needs. */}
        <div className="truncate drag">{title}</div>
        {dir && (
          <button
            onClick={onReveal}
            title={dir}
            className="block max-w-full truncate text-left text-[11px] text-muted hover:text-text"
          >
            {location(dir)}
          </button>
        )}
      </div>
      {working && <Badge tone="accent" pulse>working</Badge>}
      <PlanUsage plan={plan} />
      {context && (
        <span className="shrink-0 text-[11px] text-muted tabular-nums" title="Context used, out of the model's window">
          {contextLabel(context.used, context.window)}
        </span>
      )}
      {!!queued && <span className="shrink-0 text-[11px] text-muted">{queued} queued</span>}
    </header>
  );
}

/** Whatever replaces the transcript sits in the transcript's box, so the composer never moves. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-5">{children}</div>;
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
      <div className="flex items-start gap-1 pl-2 pt-1">
        {models && (
          <details className="min-w-0 flex-1 text-muted text-[11px]" title={models.authPath}>
            <summary className="cursor-pointer truncate">Credentials · {location(models.authPath)}</summary>
            <code className="block break-all p-1 select-text">{models.authPath}</code>
          </details>
        )}
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
                aria-current={model === current ? "true" : undefined}
                className={`flex w-full items-center gap-2 text-left px-2 py-1.5 font-mono text-[11px] rounded-card hover:bg-hover ${
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
      // The scroll area begins below the header, so old text never bleeds around its edges.
      className="transcript-scroll flex-1 min-h-0 overflow-y-auto px-6 pt-4"
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
