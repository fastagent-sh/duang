/** A conversation as it reads: messages, thinking, tool calls and system lines, in order. */
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
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
  Terminal,
  WarningCircle,
} from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import { MarkdownCode } from "./code.tsx";
import {
  dayLabel,
  duration,
  firstArg,
  foldHead,
  lines,
  stringify,
  toolText,
  type Item,
  type Line,
} from "./transcript.ts";
import { clock } from "./sessions.ts";
import { Badge, Button, type Tone } from "./ui.tsx";

/**
 * The gap this fills is real work with nothing to show: from pressing send until the first token,
 * the model is thinking and the transcript has nothing to say, and silence there reads as a hang.
 * It carries no clock: how long the whole turn has taken says little, and a running tool times
 * itself on its own row.
 */
function Working() {
  return (
    <Badge tone="accent" pulse className="enter">
      {/* The sweep is on the words, not on their opacity: this sits on screen for minutes at a time,
          and a blinking label is the first thing that makes an interface look cheap. */}
      <span className="shimmer">working…</span>
    </Badge>
  );
}

/** How long a live tool has run, ticking each second while it runs; nothing for one read back from history. */
function useElapsed(started: number | undefined, ended: number | undefined): string | undefined {
  const [now, setNow] = useState(Date.now());
  const live = started !== undefined && ended === undefined;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return started === undefined ? undefined : duration(Math.max(0, (ended ?? now) - started), live);
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
  queued,
  busy,
  bottomGap,
}: {
  items: Item[];
  /** Sent into the run but not read by the model yet: they sit below the output until it does. */
  queued: Item[];
  busy: boolean;
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
  // A running tool already says the run is alive, with its own clock, wherever it sits: a parallel
  // call can still run above one that finished.
  const silent = !streaming && !items.some((item) => item.kind === "tool" && item.status === "running");

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
  }, [items, queued, busy, streaming]);
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
        {busy && silent && (
          <div className="pt-6">
            <Working />
          </div>
        )}
        {queued.map((item, index) => (
          <div key={index} className="enter pt-6">
            <Message item={item} queued />
          </div>
        ))}
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

function Message({ item, queued }: { item: Item; queued?: boolean }) {
  switch (item.kind) {
    case "user":
      // Short, sparse, and the thing you look for when scrolling back — so it gets the one shape in
      // the transcript that is small and instantly recognisable.
      return (
        <div className="flex flex-col items-end gap-1">
          <div
            className={`bubble max-w-[80%] rounded-card rounded-br-[4px] bg-accent-weak px-3.5 py-2 whitespace-pre-wrap ${
              item.steered ? "border-r-2 border-accent" : ""
            } ${queued ? "opacity-60" : ""}`}
          >
            {item.text}
          </div>
          {/* After the fact nothing else distinguishes a message that joined a run from one that
              started it (§8). */}
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {queued ? (
              <span>queued</span>
            ) : (
              <>
                {item.steered && <span className="text-accent">joined the run</span>}
                <span>{clock(item.at)}</span>
              </>
            )}
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
  const elapsed = useElapsed(item.started, item.ended);
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
        {elapsed && <span className="shrink-0 text-muted tabular-nums">{elapsed}</span>}
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
