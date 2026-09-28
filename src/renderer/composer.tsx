/** Where a message is written: the draft, `/` completion, the model it goes to, send and stop. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, CaretDown, Check, Stop, X } from "@phosphor-icons/react";
import { complete, completionQuery, matches } from "./commands.ts";
import { Button } from "./ui.tsx";
import type { Store, View } from "./store.ts";
import { home, location } from "./paths.ts";

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
  // The list is the open agent's, so switching agents with the picker open reads it again.
  useEffect(() => {
    if (picking) void store.loadModels();
  }, [picking, agentId, store]);

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
