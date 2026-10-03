/** Where a message is written: the draft, `/` completion, the model it goes to, send and stop. */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowUp, CaretDown, Check, MagnifyingGlass, Microphone, Paperclip, Stop } from "@phosphor-icons/react";
import { complete, completionQuery, matches, spelling } from "./commands.ts";
import { Button } from "./ui.tsx";
import type { Store, View } from "./store.ts";
import { home } from "./paths.ts";
import { tokens } from "./usage.ts";
import type { Models } from "../preload/index.ts";

/** What a thinking level is called; a level this list does not know is shown as the runtime spelled it. */
const LEVELS: Record<string, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };
const levelName = (level: string) => LEVELS[level] ?? level;

/**
 * How hard the conversation's model thinks: a row of stops on a track. The runtime lists what the model
 * supports, and the track shows the level the runtime reports, nothing ahead of it: a choice is written
 * and the runtime's `state_changed` moves the track a few milliseconds later.
 *
 * Choosing writes a durable entry into the conversation's record, so choosing is explicit. A native
 * radio group would choose at every stop the arrow keys cross; these are buttons, where the arrows move
 * the focus and Enter, Space or a click choose.
 */
function Effort({ levels, level, onPick }: { levels: string[]; level: string; onPick: (level: string) => void }) {
  const stops = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, levels.indexOf(level));
  const focusStop = (to: number) => stops.current[Math.min(levels.length - 1, Math.max(0, to))]?.focus();
  return (
    <div className="px-3 pt-3 pb-2">
      <div className="mb-2 flex items-baseline justify-between text-[13px]">
        <span className="text-muted">Effort</span>
        <span className="font-semibold">{levelName(level)}</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Effort"
        className="relative flex h-6 items-center justify-between"
        onKeyDown={(event) => {
          const at = stops.current.indexOf(document.activeElement as HTMLButtonElement);
          const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: levels.length - 1 }[event.key];
          if (to === undefined || at < 0) return;
          event.preventDefault();
          focusStop(to);
        }}
      >
        <span className="absolute inset-x-0 h-2 rounded-full bg-hover" />
        {/* Filled to the centre of the chosen stop (stops are 20px wide); the stops it covers turn light. */}
        <span
          className="absolute left-0 h-2 rounded-full bg-accent-fill"
          style={{ width: `calc((100% - 20px) * ${levels.length > 1 ? index / (levels.length - 1) : 0} + 10px)` }}
        />
        {levels.map((name, stop) => (
          <button
            key={name}
            ref={(el) => {
              stops.current[stop] = el;
            }}
            type="button"
            role="radio"
            aria-checked={name === level}
            aria-label={levelName(name)}
            title={levelName(name)}
            // One tab stop for the group, on the chosen level, as a radio group has.
            tabIndex={name === level ? 0 : -1}
            onClick={() => name !== level && onPick(name)}
            className={`relative size-5 shrink-0 cursor-pointer rounded-full before:absolute before:top-1/2 before:left-1/2 before:size-1.5 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full ${stop < index ? "before:bg-white/70" : "before:bg-muted/60"} aria-checked:bg-white aria-checked:shadow-[0_1px_4px_rgb(0_0_0/0.35)] aria-checked:before:hidden focus-visible:outline-2 focus-visible:outline-accent`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The model list and the conversation's effort, floating above the composer chip that opened them.
 * Models sit under their provider, the current one first, each by the name it declares (its id when it
 * declares none) with its context window; the search matches the name and the whole `provider/id`.
 */
function ModelPicker({
  view,
  store,
  current,
  thinking,
  needsModel,
  onClose,
  onProviders,
}: {
  view: View;
  store: Store;
  current?: string;
  /**
   * The levels the runtime lists for the model the conversation runs on. Absent when it has none to list:
   * the agent has no model yet (`needsModel`), or the runtime could not read the conversation's settings.
   */
  thinking?: { level: string; levels: string[] };
  needsModel: boolean;
  onClose: () => void;
  /** Opens Settings on the providers to add; a connection made there returns here. */
  onProviders: () => void;
}) {
  const { models, modelsError: error, modelsRefresh: refresh } = view;
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
    // Right edges aligned: the chip is at the composer's right end, and the list opens toward the text.
    el.style.left = `${Math.max(8, Math.min(anchor.right - 300, window.innerWidth - 308))}px`;
    el.style.bottom = `${window.innerHeight - anchor.top + 8}px`;
    // Tall enough for a dozen rows and the effort track; the list scrolls, the search and the track do not.
    el.style.maxHeight = `${Math.min(480, Math.max(160, anchor.top - 16))}px`;
    el.showModal();
    // showModal() moves focus itself, after React has honoured autoFocus. Typing is what this list is
    // for; the filter gets the caret.
    el.querySelector("input")?.focus();
    return () => el.close();
  }, []);
  const query = filter.toLowerCase();
  const matching = (models ?? [])
    .filter((m) => m.spec.toLowerCase().includes(query) || !!m.name?.toLowerCase().includes(query))
    .sort((a, b) => Number(b.spec === current) - Number(a.spec === current));
  const shown = matching.slice(0, 60);
  // Cut off after grouping, a provider past the limit would not even show its heading: say so.
  const hidden = matching.length - shown.length;
  // Providers in the order they first appear, which puts the current model's first.
  const groups = new Map<string, Models>();
  for (const model of shown) {
    const provider = model.spec.slice(0, model.spec.indexOf("/"));
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }

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
      className="popover fixed m-0 top-auto right-auto w-[300px] flex-col overflow-hidden p-0 text-text open:flex backdrop:bg-transparent"
    >
      {error ? (
        <div role="alert" className="space-y-2 p-4 text-danger">
          <p>{error}</p>
          <Button kind="ghost" size={28} onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : models?.length === 0 ? (
        <div className="space-y-3 p-4 text-[13px] leading-relaxed text-muted">
          <p>No provider is connected yet. Sign in with a subscription or paste an API key.</p>
          <Button kind="primary" size={28} onClick={onProviders}>
            Connect a provider
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <MagnifyingGlass size={15} className="shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter models"
              placeholder="Search models"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
            <Button
              kind="ghost"
              size={28}
              aria-label="Refresh models"
              title="Check for newly released models. They are saved in models-store.json in this agent's folder."
              disabled={!models ? "Loading models…" : refresh?.status === "running" && "Checking for new models…"}
              onClick={() => void store.refreshModels()}
              icon={<ArrowClockwise size={15} className={refresh?.status === "running" ? "animate-spin motion-reduce:animate-none" : ""} />}
            />
          </div>
          {refresh && (
            <p
              role={refresh.status === "failed" ? "alert" : "status"}
              className={`px-4 pb-2 text-[12px] leading-snug break-words ${refresh.status === "failed" ? "text-danger" : "text-muted"}`}
            >
              {refresh.status === "running"
                ? "Checking pi.dev for new models…"
                : refresh.status === "failed"
                  ? refresh.error
                  : refresh.added === 0
                    ? "No new models."
                    : `${refresh.added} new model${refresh.added === 1 ? "" : "s"}.`}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
            {!models && (
              <p role="status" className="p-2.5 text-[13px] text-muted">
                Loading models…
              </p>
            )}
            {[...groups].map(([provider, members]) => (
              <section key={provider} aria-label={provider}>
                <h3 className="px-2.5 pt-2 pb-1 text-[12px] font-normal text-muted">{provider}</h3>
                {members.map(({ spec, name, contextWindow }) => (
                  <button
                    key={spec}
                    data-model={spec}
                    // The id is what the chip and the agent's config say; the name is how the model calls itself.
                    title={spec}
                    onClick={() => {
                      dialog.current?.close();
                      onClose();
                      void store.pickModel(spec);
                    }}
                    aria-current={spec === current ? "true" : undefined}
                    className={`flex w-full items-center gap-2 rounded-card px-2.5 py-2 text-left text-[13px] hover:bg-hover ${
                      spec === current ? "bg-hover" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{name ?? spec.slice(spec.indexOf("/") + 1)}</span>
                    {contextWindow !== undefined && <span className="shrink-0 text-[12px] text-muted tabular-nums">{tokens(contextWindow)}</span>}
                    {spec === current && <Check size={15} aria-hidden />}
                  </button>
                ))}
              </section>
            ))}
            {models && shown.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted">Nothing matches.</p>}
            {hidden > 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">
                {hidden} more: search to narrow the list.
              </p>
            )}
          </div>
          <div className="border-t border-stroke">
            {!thinking ? (
              <p className="px-4 py-3 text-[12px] text-muted">
                {needsModel ? "Effort can be set once a model is chosen." : "The runtime reported no effort levels for this conversation."}
              </p>
            ) : thinking.levels.length > 1 ? (
              <Effort levels={thinking.levels} level={thinking.level} onPick={(level) => void store.setThinking(level)} />
            ) : (
              <p className="px-4 py-3 text-[12px] text-muted">This model has no effort setting.</p>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

/** For measuring a line of the draft in the field's own font, without laying it out. */
const ruler = document.createElement("canvas").getContext("2d")!;

/**
 * The floating disc behind a round composer button that is not the primary action. It is a wrapper
 * because a disabled button dims as a whole: with the surface on the button itself, the disc would
 * vanish on the canvas along with its icon.
 */
function Disc({ children }: { children: ReactNode }) {
  return (
    <span className="composer-card grid size-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-stroke">
      {children}
    </span>
  );
}

/**
 * The composer, in Telegram's one-row shape: attach on the left, the field in the middle, and one
 * round button on the right that is what the next action is — voice while the field is empty, Send
 * once it holds a message, Stop while a run is live. The settings that belong to the next message
 * rather than to the app sit inside the field, where Telegram keeps its emoji, which is why the
 * model chip lives here and not in a settings screen.
 *
 * Enter sends, Shift+Enter breaks the line; when it cannot send, the placeholder says why.
 */
export function Composer({
  view,
  store,
  onProviders,
}: {
  view: View;
  store: Store;
  onProviders: () => void;
}) {
  const { agentId, conversation: c, busy } = view;
  const agent = view.agents.find((row) => row.id === agentId);
  const state = agentId ? view.states[agentId] : undefined;
  // What the conversation will RUN with, else the agent's own default. Nothing else may answer
  // this: a chip that names a model the turn will not use is the failure worth avoiding.
  const model = c?.state?.model ?? view.model;
  // The levels are the runtime's, per conversation and per model, a conversation not begun yet included.
  const thinking =
    c?.state?.thinkingLevel !== undefined && c.state.availableThinkingLevels
      ? { level: c.state.thinkingLevel, levels: c.state.availableThinkingLevels }
      : undefined;
  /** The agent really has no model, as opposed to duang not knowing it yet. Only this warns. */
  const needsModel = state === "missing_model";
  const modelDisabled =
    view.loading || (!!agentId && view.changingModel === agentId) || !!c?.loading || state === "broken" || state === "no_agent";
  /** Why the model cannot be changed right now, or false when it can. */
  const modelReason =
    (!agentId && "Select an agent first") ||
    (busy && "Stop the turn to change the model") ||
    (modelDisabled && "This agent is not ready");
  const value = c?.draft ?? "";
  const disabled = !!view.blocked;
  /** Nothing to send: whitespace is not a message, so the right-hand button stays the voice one. */
  const empty = value.trim() === "";

  const input = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  // The model chip sits beside the text while the draft is one line, and under it once it is not:
  // beside a taller draft it would reserve a column down every line for something that fits on one.
  // Decided from the draft and the room, never from how the text happens to wrap, so it cannot flip
  // back and forth as the change of width changes the wrapping.
  const [stacked, setStacked] = useState(false);
  const [fieldWidth, setFieldWidth] = useState(0);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setFieldWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const text = input.current;
    const box = field.current;
    const side = chip.current;
    if (!text || !box || !side) return;
    const style = getComputedStyle(text);
    const padding = getComputedStyle(box);
    // What is left of the field's width for the text, once the chip and the gap after it are paid for; 12px
    // of margin so a line that only just fits is not left to wrap.
    const room = box.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - side.offsetWidth - 8 - 12;
    ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    setStacked(value.includes("\n") || ruler.measureText(value).width > room);
  }, [value, fieldWidth, model, thinking?.level]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, parseFloat(style.lineHeight) * 8 + padding)}px`;
  }, [value, stacked]);
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  /** The arrow keys moved the cursor, so its row has to be brought into view; the pointer only ever lands on rows already in it. */
  const stepped = useRef(false);
  useEffect(() => {
    if (stepped.current) list.current?.querySelector("[data-chosen]")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const [picking, setPicking] = useState(false);
  // An agent with no model cannot start: open the list rather than leave the person guessing.
  useEffect(() => setPicking(needsModel), [agentId, needsModel]);
  // Back from connecting a provider that was started here: the picker comes up again, with the new
  // provider's models in it, and nothing chosen for the person.
  useEffect(() => {
    if (store.takePickerRequest()) setPicking(true);
  }, [store]);
  // Every opening rereads the credential file, so a provider connected in Settings shows up.
  // The list is the open agent's, so switching agents with the picker open reads it again.
  useEffect(() => {
    if (picking) void store.loadModels();
  }, [picking, agentId, store]);

  const query = completionQuery(value);
  // Not while the model picker is open: two floating lists over one composer read as a mistake.
  const suggestions = query === undefined || dismissed || picking ? [] : matches(view.commands, query);
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
    list.current?.scrollTo(0, 0);
  }, [query]);

  return (
    // Positioned so it paints above the veil beneath it, which is absolutely placed and would
    // otherwise blur every button in the row.
    <div className="composer relative">
      {/* pl-12 is the attach disc (40) and the gap (8): these lines start where the field does. */}
      {view.commandsError && query !== undefined && (
        <p role="alert" className="text-danger text-[11px] mb-1.5 pl-12">
          {view.commandsError}
        </p>
      )}
      {/* Pressing `/` on an agent with no skills would do nothing at all, which reads as broken. */}
      {query !== undefined && !view.commandsError && view.commands.length === 0 && agent && (
        <p className="text-muted text-[11px] mb-1.5 pl-12">
          No commands — this agent has no skills in <span className="font-mono">{home(agent.dir)}/fastagent/skills</span>
        </p>
      )}
      <div className="flex items-end gap-2">
        <Disc>
          <Button kind="ghost" size={40} disabled="Attachments are not supported yet" aria-label="Attach" icon={<Paperclip size={20} />} />
        </Disc>
        <div ref={field} className="composer-card relative flex min-w-0 flex-1 flex-wrap items-end gap-x-2 gap-y-1 rounded-composer bg-surface py-1.5 pr-1.5 pl-4 ring-1 ring-stroke focus-within:ring-accent/50">
          {suggestions.length > 0 && (
            // The model picker's surface and rows: one list look, so the two floating lists read as the same kind of thing.
            <div ref={list} className="popover absolute bottom-full left-0 z-20 mb-2 max-h-72 w-[420px] max-w-full overflow-y-auto">
              {suggestions.map((command, index) => (
                <button
                  key={command.name}
                  // Moved, not entered: the list scrolls under a pointer that is resting on it when the keys
                  // step, the browser then reports the row now under it as entered, and the cursor would be
                  // taken from the keys by a mouse nobody moved.
                  onMouseMove={(event) => {
                    if (!event.movementX && !event.movementY) return;
                    stepped.current = false;
                    setCursor(index);
                  }}
                  onClick={() => store.setDraft(complete(command))}
                  data-chosen={command === chosen || undefined}
                  className={`flex w-full scroll-my-1.5 items-baseline gap-2.5 rounded-card px-2.5 py-2 text-left text-[13px] ${
                    command === chosen ? "bg-hover" : ""
                  }`}
                >
                  {/* What accepting it inserts: a bare `/weather` typed by hand would reach the model as text. */}
                  <span className="shrink-0">/{spelling(command)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{command.description}</span>
                  <span className="shrink-0 text-[12px] text-muted">{command.source}</span>
                </button>
              ))}
            </div>
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
                  stepped.current = true;
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
                  return store.setDraft(complete(chosen));
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
            // than it sends makes a long message reflow the moment it is sent. The 1px keeps one line
            // as tall as the model chip beside it (28).
            className={`bubble min-h-7 min-w-0 resize-none bg-transparent py-px outline-none ${stacked ? "basis-full" : "flex-1"}  placeholder:text-muted disabled:opacity-40`}
          />
          <div ref={chip} className="relative ml-auto min-w-0 max-w-[45%]">
            <Button
              kind="ghost"
              size={28}
              onClick={() => setPicking(!picking)}
              // The chip truncates a long spec, so the tooltip carries the whole name in both states.
              disabled={modelReason && model ? `${modelReason} (${model})` : modelReason}
              title={model ? `Model for this agent: ${model}` : "Model for this agent"}
              // Tinted, so it reads as the button it is beside the field's own text.
              className={`max-w-full bg-hover ${!model && needsModel ? "text-warning" : ""}`}
            >
              {model ? (
                // The provider is quieter than the id but never dropped: `openai/` and `azure-openai-responses/`
                // offer the same ids and are paid for differently.
                <span className="min-w-0 truncate text-[13px]">
                  <span className="text-muted">{model.slice(0, model.indexOf("/") + 1)}</span>
                  <span className="text-text">{model.slice(model.indexOf("/") + 1)}</span>
                </span>
              ) : (
                <span className="truncate">{needsModel ? "pick a model" : "reading model…"}</span>
              )}
              {thinking && thinking.levels.length > 1 && (
                <span className="shrink-0 text-[13px] text-muted">{levelName(thinking.level)}</span>
              )}
              <CaretDown size={12} className="shrink-0" />
            </Button>
            {picking && agentId && !busy && !modelDisabled && (
              <ModelPicker
                view={view}
                store={store}
                current={model}
                thinking={thinking}
                needsModel={needsModel}
                onClose={() => setPicking(false)}
                onProviders={() => {
                  setPicking(false);
                  onProviders();
                }}
              />
            )}
          </div>
        </div>
        {/* While a turn runs, the button that sent it is the button that stops it — stopping is where
            the eye already is, not in a corner of the window. */}
        {busy ? (
          <Button
            kind="danger"
            loud
            size={40}
            onClick={() => void store.abort()}
            aria-label="Stop the run"
            // Stopping ends the run, not its consequences; a tool that already wrote a file is done.
            title="Stop (Esc) — work its tools already finished is not undone"
            icon={<Stop size={16} weight="fill" />}
          />
        ) : empty ? (
          <Disc>
            <Button kind="ghost" size={40} disabled="Voice input is not available yet" aria-label="Voice input" icon={<Microphone size={20} />} />
          </Disc>
        ) : (
          <Button
            kind="primary"
            size={40}
            onClick={() => void store.send()}
            disabled={view.blocked ?? false}
            aria-label="Send"
            title="Send (⏎) · newline (⇧⏎)"
            icon={<ArrowUp size={18} />}
          />
        )}
      </div>
    </div>
  );
}
