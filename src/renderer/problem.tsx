/**
 * How duang says something went wrong (docs/ui.md §9b): what it means for the person, what to do, the
 * way on as a button, and the original words kept verbatim but out of the way. One shape at three sizes:
 *
 * - `card`: in the transcript, where the run or the send it is about happened.
 * - `strip`: floating under the header, about the conversation's view or an action outside it; it never
 *   pushes the transcript down.
 * - `page`: in place of the conversation, when there is nothing else to show (an agent that cannot load,
 *   an agent list that cannot be read, a view that could not be drawn).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretRight, Check, Copy, Info, Prohibit, WarningCircle, X } from "@phosphor-icons/react";
import { Button } from "./ui.tsx";

export type ProblemTone = "error" | "warning" | "info";

const ICON = {
  error: <WarningCircle size={16} />,
  warning: <Prohibit size={16} />,
  info: <Info size={16} />,
};
const COLOUR = { error: "text-danger", warning: "text-warning", info: "text-muted" };

/** A reason short enough to read in place; anything longer folds behind "Details". */
const SHORT = 140;

/**
 * The original words, verbatim. Where nothing else explains the problem, a short one-line reason is the
 * explanation and reads in place. Otherwise it folds to its first line, quietly, and opens into a
 * selectable well with a way to copy it for a report.
 */
function Reason({ text, as = "inline" }: { text: string; as?: "inline" | "folded" | "well" }) {
  const long = as !== "inline" || text.length > SHORT || text.includes("\n");
  const [open, setOpen] = useState(as === "well");
  const [copied, setCopied] = useState<"yes" | string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!long) return <p className="select-text break-words text-[13px] text-muted">{text}</p>;
  return (
    <div className="space-y-1.5">
      {/* A page has room for the words themselves: no toggle, just the well. */}
      {as !== "well" && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex max-w-full items-center gap-1 text-left text-[12px] text-muted hover:text-text"
        >
          <CaretRight size={11} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="min-w-0 truncate">{open ? "Details" : text.split("\n")[0]}</span>
        </button>
      )}
      {open && (
        <div className="relative rounded-card bg-surface-2">
          <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words p-3 pr-10 font-mono text-[12.5px] text-muted">
            {text}
          </pre>
          <Button
            kind="ghost"
            size={28}
            aria-label={copied === "yes" ? "Copied" : "Copy the details"}
            title={copied && copied !== "yes" ? `Could not copy: ${copied}` : "Copy the details"}
            icon={copied === "yes" ? <Check size={13} /> : <Copy size={13} />}
            className="absolute top-1.5 right-1.5"
            onClick={() =>
              // A refused clipboard says so on the button rather than looking broken.
              navigator.clipboard.writeText(text).then(
                () => setCopied("yes"),
                (error: unknown) => setCopied(error instanceof Error ? error.message : String(error)),
              ).finally(() => {
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setCopied(undefined), 2000);
              })
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * What fills the pane when there is no conversation to show: a mark, a title, a sentence on what it means,
 * whatever it needs to show, and the ways on. Setup pages wear it too, so a problem and a first step look
 * like the same app.
 */
export function Page({
  tone,
  icon,
  title,
  advice,
  actions,
  children,
}: {
  tone: ProblemTone | "accent";
  icon: ReactNode;
  title: string;
  advice?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // In the transcript's box, clear of the floating header, so the composer never moves.
    <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-16 pb-5">
      <div role={tone === "error" || tone === "warning" ? "alert" : undefined} className="mx-auto mt-16 max-w-md space-y-4 text-center">
        <span className={`mx-auto grid size-10 place-items-center rounded-card bg-surface-2 ${tone === "accent" ? "text-accent" : COLOUR[tone]}`}>
          {icon}
        </span>
        <div className="space-y-1.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {advice && <p className="text-[13px] leading-relaxed text-muted">{advice}</p>}
        </div>
        {children}
        {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Problem({
  tone,
  title,
  advice,
  reason,
  actions,
  onDismiss,
  layout = "card",
}: {
  tone: ProblemTone;
  /** What it means for the person, in their words: "The provider did not accept the sign-in". */
  title: string;
  /** What to do about it, when there is something besides the buttons. */
  advice?: ReactNode;
  /** The original words, verbatim. */
  reason?: string;
  /** The ways on, as buttons; the first is the one most likely to fix it. */
  actions?: ReactNode;
  onDismiss?: () => void;
  layout?: "card" | "strip" | "page";
}) {
  const icon = <span className={`shrink-0 ${COLOUR[tone]}`}>{ICON[tone]}</span>;
  if (layout === "page")
    return (
      <Page tone={tone} icon={ICON[tone]} title={title} advice={advice} actions={actions}>
        {reason && (
          <div className="text-left">
            <Reason text={reason} as="well" />
          </div>
        )}
      </Page>
    );
  const body = (
    <div role={tone === "info" ? "status" : "alert"} className="flex gap-2.5 px-3 py-2.5 text-left">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[13px] font-semibold">{title}</p>
        {advice && <p className="text-[13px] leading-relaxed text-muted">{advice}</p>}
        {reason && <Reason text={reason} as={advice ? "folded" : "inline"} />}
        {actions && <div className="flex flex-wrap gap-2 pt-1.5">{actions}</div>}
      </div>
      {onDismiss && (
        <Button kind="ghost" size={28} aria-label="Dismiss" title="Dismiss" icon={<X size={13} />} onClick={onDismiss} className="-mt-1 -mr-1" />
      )}
    </div>
  );
  // A strip floats over the transcript, so it wears the popover's surface; a card is part of the record.
  return layout === "strip" ? (
    <div className="popover pointer-events-auto !p-0">{body}</div>
  ) : (
    <div className="rounded-float bg-surface ring-1 ring-stroke">{body}</div>
  );
}
