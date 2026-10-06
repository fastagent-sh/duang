/** A conversation as it reads: messages, thinking, tool calls and system lines, in order. */
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Plug,
  Swap,
  ArrowClockwise,
  ArrowDown,
  ArrowSquareOut,
  ArrowsOut,
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
  X,
} from "@phosphor-icons/react";
import { Streamdown } from "streamdown";
import { MarkdownCode } from "./code.tsx";
import {
  dayLabel,
  duration,
  firstArg,
  foldHead,
  group,
  lines,
  liveEnd,
  phase,
  stringify,
  summarize,
  thinkingLine,
  toolText,
  type Item,
  type Line,
  type Work,
} from "./transcript.ts";
import type { SessionState } from "@fastagent-sh/fastagent/session";
import { clock } from "./sessions.ts";
import { Badge, Button, type Tone } from "./ui.tsx";
import { Problem } from "./problem.tsx";
import type { Fix } from "./problems.ts";

/**
 * The live end of a run: what it is doing now, in words, and how long the run has taken. It stays for
 * the whole run rather than filling silences, so the bottom of a working transcript always answers
 * "is it alive, and what is it on". The dot bounces (duang is the sound of one) and the word sweeps;
 * the clock is the run's, counted from when this window saw it start, so a run reopened halfway shows
 * none rather than a wrong one. Where the newest line is the step itself, this is drawn in it (`WorkBlock`'s
 * `live`), so what the run is on is said once.
 */
export function RunStatus({
  items,
  status,
  started,
  heard,
  quietOnly,
  className = "",
}: {
  items: Item[];
  status: SessionState["status"] | undefined;
  started?: number;
  /** When this window last heard from the run: a model quiet for long is said, so it does not look stuck. */
  heard?: number;
  /** An answer being written is its own sign of life: the status is drawn only once the answer stops coming. */
  quietOnly?: boolean;
  /** The space above it, which depends on the line it follows. */
  className?: string;
}) {
  const { word, detail, activity } = phase(items, status);
  const elapsed = useElapsed(started, undefined);
  // A running tool may rightly be quiet for minutes, and has its own clock; only the model's silence is said.
  const quiet = useElapsed(activity === "tool" ? undefined : heard, undefined, QUIET_MS);
  if (quietOnly && !quiet) return null;
  return (
    <div className={className}>
    <div className="enter flex h-7 items-center gap-2 text-[12px]">
      <span className="bounce size-[7px] shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="shimmer shrink-0">{word}</span>
      {detail && <span className={`min-w-0 truncate text-muted ${word === "thinking" ? "" : "font-mono"}`}>{detail}</span>}
      {elapsed && <span className="shrink-0 text-muted tabular-nums">· {elapsed}</span>}
      {quiet && <span className="shrink-0 text-muted tabular-nums">· no output for {quiet}</span>}
    </div>
    </div>
  );
}

/**
 * How long without a word from the model before the status says so. A thinking model can be quiet this long
 * and be fine, so it is said plainly, not as a failure; a provider that hangs is not cut off here either.
 */
const QUIET_MS = 30_000;

/**
 * How long a live tool has run, ticking each second while it runs; nothing for one read back from history.
 * `after`: nothing until that much has passed.
 */
function useElapsed(started: number | undefined, ended: number | undefined, after = 0): string | undefined {
  const [now, setNow] = useState(Date.now());
  const live = started !== undefined && ended === undefined;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  if (started === undefined) return undefined;
  const ms = Math.max(0, (ended ?? now) - started);
  return ms < after ? undefined : duration(ms, live);
}

/**
 * The space above a line, decided by the pair rather than by one constant (§8).
 *
 * A single gap for everything is what made a run of tool calls read as a sparse list: `bash`,
 * `thinking`, `bash` are single lines of one activity, and 24 between them is the space a paragraph
 * gets. They close up to 8. The agent's own words and its work are one flow, so a step between them
 * is 12 — at 24 each tool line floated in a blank band of its own. Only a change of speaker earns
 * the full step: 32 above what someone sent, 24 below it.
 */
const ASIDE = new Set(["tool", "thinking", "note", "work", "status"]);

function gap(previous: string | undefined, kind: string): string {
  if (!previous) return "";
  if (kind === "user") return "pt-8";
  if (previous === "user") return "pt-6";
  return ASIDE.has(kind) && ASIDE.has(previous) ? "pt-2" : "pt-3";
}

/** An answer ends its turn unless the run goes on to work after it; only then does it get a footer. */
const ends = (next: Line | Work | undefined, busy: boolean) => (next ? next.kind !== "work" : !busy);

/** How much of a long conversation is drawn when it opens, and then per idle moment until it is all there. */
const FIRST_LINES = 40;
const LINES_PER_BATCH = 15;

/** Where the conversation's lines end, in the scroll area's own coordinates (the space under them excluded). */
const linesEnd = (el: HTMLElement) => el.firstElementChild!.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
/** How far the view's top is from the end of the lines: a place that lines drawn above it do not move. */
const fromEnd = (el: HTMLElement) => linesEnd(el) - el.scrollTop;

/** Within a line or two of the end: where a conversation opens, and what "following" means. */
const atLatest = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

export function Transcript({
  items,
  waiting,
  busy,
  status,
  started,
  heard,
  bottomGap,
  resume,
  onRest,
  onRetry,
  onUsage,
  onSettings,
  onPickModel,
  provider,
}: {
  items: Item[];
  /**
   * Messages that have not entered the conversation yet, below the output until the runtime places
   * them. `listed`: the runtime reports it as queued; otherwise it is still on its way there.
   * `opens`: it opens the run on screen, so it reads above that run's working mark; a steer waits
   * below the output it did not shape.
   */
  waiting: { item: Item; listed: boolean; opens: boolean }[];
  busy: boolean;
  /** What the runtime says the conversation is doing, and when this window saw its run start. */
  status: SessionState["status"] | undefined;
  started?: number;
  /** When this window last heard from the run, for the status line's silence. */
  heard?: number;
  /** How far the floating composer reaches up: the transcript scrolls under it, so it ends above it. */
  bottomGap: number;
  /**
   * Where this conversation was left, read once when the view mounts; absent means the latest line. Measured from
   * the end of the conversation's lines (`fromEnd`), because a long conversation draws its older lines above what is
   * on screen after it opens (`from`): a place measured from the top while they were still missing would point
   * elsewhere once they are drawn. Not from the end of the scroll area, whose space under the lines follows the
   * composer's height and changes as the view mounts.
   */
  resume?: number;
  /** Where the view rests now (from the end, as `resume`), or undefined while it follows the latest line. */
  onRest: (fromEnd: number | undefined) => void;
  /** The conversation ends on a failed turn that can be sent again: the action sits under its failure. */
  onRetry?: () => void;
  /** Opens a provider's usage page: offered under a failure that is that plan's usage limit. */
  onUsage: (provider: string) => void;
  /** Opens Settings where a problem's way on is: this conversation's provider's sign-in, or the network. */
  onSettings: (where: "providers" | "network") => void;
  /** Opens the model picker, for a problem another model gets round. */
  onPickModel: () => void;
  /** The provider this conversation runs on, by the name the person knows it by. */
  provider?: string;
}) {
  // The ways on belong to the latest problem only, and only while nothing runs: an earlier one is history.
  const last = items.at(-1);
  const problem = !busy && last?.kind === "note" && last.title ? last : undefined;
  const actions = problem && (
    <>
      {problem.fix === "providers" && (
        <Button kind="secondary" size={28} onClick={() => onSettings("providers")} icon={<Plug size={12} />}>
          {provider ? `Sign in to ${provider} again` : "Model providers"}
        </Button>
      )}
      {problem.fix === "network" && (
        <Button kind="secondary" size={28} onClick={() => onSettings("network")} icon={<Globe size={12} />}>
          Network settings
        </Button>
      )}
      {problem.limit && (
        <Button kind="secondary" size={28} onClick={() => onUsage(problem.limit!)} title="Open the plan's usage page in the browser" icon={<ArrowSquareOut size={12} />}>
          View usage
        </Button>
      )}
      {problem.fix === "model" && (
        <Button kind="secondary" size={28} onClick={onPickModel} title="Choose another model, then retry" icon={<Swap size={12} />}>
          Use another model
        </Button>
      )}
      {onRetry && (
        <Button kind="secondary" size={28} onClick={onRetry} title="Send this message again as a new turn" icon={<ArrowClockwise size={12} />}>
          Retry
        </Button>
      )}
    </>
  );
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(resume === undefined);
  /**
   * A view that returns to where it was left holds that place while its layout settles (a remounted
   * conversation grows for a moment as its fonts and code blocks arrive, and reading "near the bottom"
   * from the short first layout would forget the place), until the person scrolls.
   */
  const restoring = useRef(resume !== undefined);
  const scrolled = () => {
    restoring.current = false;
  };
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
    if (restoring.current) {
      const place = linesEnd(el) - resume!;
      if (el.scrollTop !== place) el.scrollTop = place;
      follow.current = false;
      setAway(true);
      return;
    }
    follow.current = atLatest(el);
    setAway(!follow.current);
    onRest(follow.current ? undefined : fromEnd(el));
  };
  // Before the first paint, so the conversation is never seen at the bottom first.
  useLayoutEffect(() => {
    if (resume !== undefined) box.current!.scrollTop = linesEnd(box.current!) - resume;
    // A scroll event that has not fired yet cannot tell the place a view is leaving from, so it is read
    // here, while the element is still attached. A view still holding a place keeps what it was given.
    return () => {
      const el = box.current;
      if (el && !restoring.current) onRest(atLatest(el) ? undefined : fromEnd(el));
    };
  }, []);

  const queue = (opening: boolean) =>
    waiting.map(({ item, listed, opens }, index) =>
      opens === opening ? (
        <div key={index} className="enter pt-8">
          <Message item={item} waiting={listed ? "queued" : "sending"} />
        </div>
      ) : null,
    );

  const shown = group(lines(items));
  const end = liveEnd(shown, busy, waiting.some(({ opens }) => opens));
  const live = (
    <RunStatus items={items} status={status} started={started} heard={heard} quietOnly={end.quietOnly} className={gap(end.above, "status")} />
  );
  /**
   * `enter` is for what arrives, and history has not arrived — it was already there. This component
   * remounts for every conversation it shows (keyed by subscription), and it mounts with the history
   * already loaded, so the rows on screen at mount are the old ones and everything past them is new.
   * Without this, opening a conversation floated its whole backlog in at once.
   */
  const history = useRef(shown.length);
  /**
   * A long conversation opened at its latest line draws that end first and the rest above it in small batches while
   * the window is idle, so opening it is not one long freeze (150 turns took about a second). Each batch lands
   * above what is on screen, where Chromium's scroll anchoring keeps the view still. A view returning to a place
   * it was left at draws everything at once: drawn from the end, it would first sit wherever the drawn part
   * reaches and then move as the batches reach the place.
   */
  const [from, setFrom] = useState(() => (resume === undefined ? Math.max(0, shown.length - FIRST_LINES) : 0));
  useEffect(() => {
    if (from === 0) return;
    const id = requestIdleCallback(() => setFrom((at) => Math.max(0, at - LINES_PER_BATCH)), { timeout: 100 });
    return () => cancelIdleCallback(id);
  }, [from]);
  /**
   * The growth a batch causes is above the view, where scroll anchoring already keeps the view still: the growth
   * observer below must not read it as content added under a view at its end. Set before that observer runs (a
   * layout effect runs as the batch is committed, the observer after the frame's layout).
   */
  const drewAbove = useRef(false);
  const drawnFrom = useRef(from);
  useLayoutEffect(() => {
    if (from < drawnFrom.current) drewAbove.current = true;
    drawnFrom.current = from;
  }, [from]);

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
    check();
  }, [items, waiting, busy]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    // Content also grows after it is laid out (fonts, code blocks), with no scroll event and no new item:
    // a view that was at the latest line stays on it, and one holding a place keeps the place. "Was" is
    // judged against the height before this growth, because the growth itself puts the end out of reach.
    // Growth from a batch drawn above is not judged at all: anchoring has moved scrollTop by its height, so
    // against the old height a view the person scrolled up from would read as at the end and be pulled down.
    let height = 0;
    const grown = new ResizeObserver(() => {
      const wasAtEnd = height - el.scrollTop - el.clientHeight < 40;
      height = el.scrollHeight;
      const above = drewAbove.current;
      drewAbove.current = false;
      if (restoring.current) check();
      else if (wasAtEnd && !above) {
        el.scrollTop = el.scrollHeight;
        check();
      }
    });
    if (el.firstElementChild) grown.observe(el.firstElementChild);
    return () => {
      observer.disconnect();
      grown.disconnect();
    };
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
            scrolled();
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
      // What the person does to move it, as opposed to the scroll events that layout and restoring cause.
      onWheel={scrolled}
      onKeyDown={scrolled}
      onPointerDown={scrolled}
      onTouchStart={scrolled}
      // pt clears the floating header; the first message starts below it, not behind it. The
      // scrollbar's track is reserved on both sides, so the column centres where the composer does.
      className="flex-1 min-h-0 overflow-y-auto px-6 pt-16 [scrollbar-gutter:stable_both-edges]"
      style={{ paddingBottom: bottomGap }}
    >
      <div className="column">
        {shown.map((line, index, all) =>
          index < from || line === end.hidden ? null : line.kind === "day" ? (
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
            <div key={index} className={`${index >= history.current ? "enter" : ""} ${gap(all[index - 1]?.kind, line.kind)}`}>
              {line.kind === "work" ? (
                <SettledWork work={line} live={line === end.block ? live : undefined} />
              ) : (
                <SettledMessage item={line} ends={ends(all[index + 1], busy)} actions={line === problem ? actions : undefined} />
              )}
            </div>
          ),
        )}
        {queue(true)}
        {end.status && live}
        {queue(false)}
      </div>
    </div>
    </div>
  );
}

/**
 * A line that did not change is not drawn again. A streamed word replaces only the newest item (`apply` keeps every
 * other item the same object), and without this every word redrew the whole conversation, every answer's
 * markdown parsed again: a 150-turn conversation streamed at about 8 frames a second. A work block is rebuilt by
 * `group` on each render, so it is the same when it holds the same items.
 */
const SettledMessage = memo(Message);
const SettledWork = memo(
  WorkBlock,
  (before, after) =>
    before.live === after.live &&
    before.work.items.length === after.work.items.length &&
    before.work.items.every((item, index) => item === after.work.items[index]),
);

/**
 * Only `code` is overridden. Streamdown's own `pre` is what marks a child as a fenced block, so
 * replacing it turns every code block into an inline span.
 */
const markdownComponents = { code: MarkdownCode };

/** Copy is an action worth offering; downloading a table to a file is not, in a chat transcript. */
const markdownControls = { table: { download: false } };

/** Streamdown draws its table controls in Lucide; the code block's copy button is Phosphor, and the two sat side by side in different hands. */
const markdownIcons = { CopyIcon: Copy, CheckIcon: Check, Maximize2Icon: ArrowsOut, XIcon: X };

/**
 * Streamdown caps a table at 300px and scrolls the rest inside it: a scroll region in a scrolling
 * transcript steals the wheel and hides how much is there (the same reason tool output folds). */
const TABLE_FULL_HEIGHT = 0;

export function Message({
  item,
  waiting,
  ends = true,
  actions,
}: {
  item: Item;
  /** The ways on, for the latest problem in the conversation. */
  actions?: ReactNode;
  waiting?: "queued" | "sending";
  /** False for words the run goes on to work after: a time and a copy button between steps are noise. */
  ends?: boolean;
}) {
  switch (item.kind) {
    case "user":
      // Short, sparse, and the thing you look for when scrolling back — so it gets the one shape in
      // the transcript that is small and instantly recognisable.
      return (
        <div className="flex flex-col items-end gap-1">
          <div
            className={`bubble max-w-[80%] rounded-float rounded-br-[4px] bg-accent-weak px-3.5 py-2 whitespace-pre-wrap ${
              item.steered ? "border-r-2 border-accent" : ""
            } ${waiting ? "opacity-60" : ""}`}
          >
            {item.text}
          </div>
          {/* After the fact nothing else distinguishes a message that joined a run from one that
              started it (§8). */}
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {waiting ? (
              <span>{waiting}</span>
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
            <Streamdown components={markdownComponents} controls={markdownControls} icons={markdownIcons} tableMaxHeight={TABLE_FULL_HEIGHT}>
              {item.open ? `${item.text}▍` : item.text}
            </Streamdown>
          </div>
          {!item.open && ends && <Footer text={item.text} at={item.at} />}
        </div>
      );
    case "thinking": {
      // Collapsed, a bare "thinking" says nothing about what happened. How long it took and the
      // line it is on are the two facts worth reading without expanding (docs/ui.md §8).
      const seconds = Math.round((item.at - item.started) / 1000);
      const trail = thinkingLine(item.text, item.open);
      return (
        <details className="group text-muted text-[12px]">
          <summary className="cursor-default select-none flex h-7 items-center gap-2">
            <CaretRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
            {/* Still streaming means the seconds are not final yet, so the label sweeps instead of
                counting: the movement is the answer to "is it stuck". */}
            <span className={`shrink-0 ${item.open ? "shimmer" : ""}`}>
              {seconds > 0 ? `thinking · ${seconds}s` : "thinking"}
            </span>
            <span className="truncate opacity-60 group-open:hidden">{trail}</span>
          </summary>
          <div className="mb-1 ml-[5px] whitespace-pre-wrap border-l border-stroke pl-3 leading-relaxed">
            {item.text}
          </div>
        </details>
      );
    }
    case "note":
      // A problem the person may act on is a card where it happened (§9b); a fact about the session (a
      // stop, a retry, a command that ran) is one centred quiet line, in the app's own face.
      if (item.title)
        return <Problem tone={item.tone} title={item.title} advice={item.advice} reason={item.reason} actions={actions} />;
      return (
        // A retry's line keeps the provider's words in full on hover; what it says is their meaning.
        <div title={item.reason} className="flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <Info size={12} className="shrink-0" />
          <span className="min-w-0 break-words">{item.text}</span>
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
    // h-5, not the button's 28: the row is a line of metadata, and the hover target may overhang it.
    <div className="mt-1.5 flex h-5 items-center gap-1 text-[11px] text-muted">
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

const isLone = (line: Line | Work | undefined) => line?.kind === "work" && line.items.length === 1;

/**
 * A stretch of tool calls and thinking as one line that says what kind of work it was, opening into
 * the calls themselves, where a call that failed still says so. It stays closed while it grows: the
 * live status says what the run is on. When its calls are what the run is on now, it is the live status
 * (`live`), rather than a line above another saying the same thing.
 *
 * A lone call is a one-item block drawn as the call alone (open, summary hidden), so that when the
 * next call folds it into a block it is still the same element. A card opened while it stood alone
 * keeps the block open once it folds, rather than vanishing from under the person reading it.
 */
export function WorkBlock({ work, live }: { work: Work; live?: ReactNode }) {
  // A lone call or thought is drawn as itself; while it is the step the run is on, as the live line.
  const lone = isLone(work) && !live;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = box.current!;
    // `toggle` does not bubble, so an inner card opening is heard in the capture phase.
    const heard = (event: Event) => {
      if (event.target !== el && (event.target as HTMLDetailsElement).open) setOpen(true);
    };
    el.addEventListener("toggle", heard, true);
    return () => el.removeEventListener("toggle", heard, true);
  }, []);
  return (
    <details
      ref={box}
      open={lone || open}
      onToggle={(event) => !lone && setOpen(event.currentTarget.open)}
      className="group/work"
    >
      <summary
        hidden={lone}
        className="cursor-default select-none flex h-7 items-center gap-2 text-[12px] text-muted transition-colors hover:text-text"
      >
        <CaretRight size={11} className="shrink-0 transition-transform group-open/work:rotate-90" />
        {live ?? <span className="truncate">{summarize(work.items)}</span>}
      </summary>
      <div className={lone ? "" : "mt-1 ml-[5px] space-y-0.5 border-l border-stroke pl-3.5"}>
        {work.items.map((item, index) => (
          <Message key={index} item={item} />
        ))}
      </div>
    </details>
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

export function Tool({ item }: { item: Extract<Item, { kind: "tool" }> }) {
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
      <summary className="cursor-default select-none flex items-center gap-2 rounded-card px-2.5 h-7 text-[12px] hover:bg-hover group-open:rounded-b-none">
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
