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

type ProblemTone = "error" | "warning" | "info";

const ICON = {
  error: <WarningCircle size={15} />,
  warning: <Prohibit size={15} />,
  info: <Info size={15} />,
};
const TINT = { error: "bg-danger/8", warning: "bg-warning/10", info: "bg-surface-2" };
const COLOUR = { error: "text-danger", warning: "text-warning", info: "text-muted" };

/** A reason short enough to read in place; anything longer folds behind "Details". */
const SHORT = 140;

/**
 * The original words, verbatim, out of the way: folded to their first line beside the buttons, opening into
 * a selectable well (on a line of its own) with a way to copy them for a report. On a page, the well itself.
 */
function Reason({ text, as }: { text: string; as: "folded" | "well" }) {
  const [open, setOpen] = useState(as === "well");
  const [copied, setCopied] = useState<"yes" | string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      {as === "folded" && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-40 items-center gap-1 text-left text-[12px] text-muted hover:text-text"
        >
          <CaretRight size={11} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="min-w-0 truncate">{open ? "Details" : text.split("\n")[0]}</span>
        </button>
      )}
      {open && (
        <div className="relative basis-full rounded-card bg-surface-2">
          <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words p-3 pr-10 text-left font-mono text-[12.5px] text-muted">
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
              navigator.clipboard
                .writeText(text)
                .then(
                  () => setCopied("yes"),
                  (error: unknown) => setCopied(error instanceof Error ? error.message : String(error)),
                )
                .finally(() => {
                  window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => setCopied(undefined), 2000);
                })
            }
          />
        </div>
      )}
    </>
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
      <div role={tone === "error" || tone === "warning" ? "alert" : undefined} className="mx-auto mt-10 max-w-md space-y-3 text-center">
        <span className={`mx-auto grid size-8 place-items-center rounded-card bg-surface-2 ${tone === "accent" ? "text-accent" : COLOUR[tone]}`}>
          {icon}
        </span>
        <div className="space-y-1">
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
  if (layout === "page")
    return (
      <Page tone={tone} icon={ICON[tone]} title={title} advice={advice} actions={actions}>
        {reason && <Reason text={reason} as="well" />}
      </Page>
    );
  // Short words that nothing else explains are the explanation, said beside the title; anything else folds.
  const said = advice ?? (reason && reason.length <= SHORT && !reason.includes("\n") ? reason : undefined);
  const folded = reason !== undefined && said !== reason;
  const body = (
    <div role={tone === "info" ? "status" : "alert"} className="flex items-start gap-2 text-left text-[13px] leading-snug">
      <span className={`mt-px shrink-0 ${COLOUR[tone]}`}>{ICON[tone]}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>
          <span className="font-semibold">{title}.</span>
          {said && <span className="text-muted"> {said}</span>}
        </p>
        {(actions || folded) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {actions}
            {folded && <Reason text={reason} as="folded" />}
          </div>
        )}
      </div>
      {onDismiss && (
        <Button kind="ghost" size={28} aria-label="Dismiss" title="Dismiss" icon={<X size={13} />} onClick={onDismiss} className="-my-1 -mr-1.5" />
      )}
    </div>
  );
  // A strip floats over the transcript, so it wears the popover's surface; a card is part of the record, a
  // tinted note the width of what it says.
  return layout === "strip" ? (
    <div className="popover pointer-events-auto !px-3 !py-2.5">{body}</div>
  ) : (
    <div className={`w-fit max-w-full rounded-card px-3 py-2 ${TINT[tone]}`}>{body}</div>
  );
}
