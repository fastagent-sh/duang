/** The two lists of rows: agents in the sidebar, and one agent's conversations under the header. */
import { useEffect, useRef, useState } from "react";
import { DotsThree, GearSix, Plus } from "@phosphor-icons/react";
import type { AgentRow, DuangApi } from "../preload/index.ts";
import { stamp, type Row } from "./sessions.ts";
import { Avatar, Badge, Button, Pill, type Tone } from "./ui.tsx";
import type { AgentState, Preview } from "./store.ts";

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
