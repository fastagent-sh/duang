/** The bar over a conversation: who it is with, where it runs, and what it costs. */
import { Fragment } from "react";
import { ListBullets } from "@phosphor-icons/react";
import type { ProviderUsage } from "../preload/index.ts";
import { pace, paceLabel, resetLabel, tightest, tokens } from "./usage.ts";
import { ago } from "./sessions.ts";
import { Avatar, Badge, Button } from "./ui.tsx";
import { location } from "./paths.ts";

/** How full a limit is, as a 40px bar beside its percentage. */
function Bar({ percent }: { percent: number }) {
  return (
    <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-stroke">
      <span className="block h-full rounded-full bg-muted" style={{ width: `${Math.min(100, percent)}%` }} />
    </span>
  );
}

/**
 * A plan login's windows beside its name in Settings: each one's share used and when it resets, the
 * rest in the tooltip. Nothing for an API key, and nothing for a failed read either: the numbers are
 * a glance, not a status to act on, and a failure never leaves old ones up (the store replaces them).
 */
export function PlanUsage({ plan }: { plan?: { data?: ProviderUsage; error?: string } }) {
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
      {windows.map((w) => {
        const reset = resetLabel(w);
        return (
          <span key={w.label} className="flex items-center gap-1.5">
            {w.label}
            <Bar percent={w.percent} />
            {/* Settings stacks plans in rows: a fixed width lines them up whatever the digits. */}
            <span className="min-w-[4ch] text-right">{w.percent.toFixed(0)}%</span>
            {reset && <span>~ {reset}</span>}
          </span>
        );
      })}
    </span>
  );
}

type Usage = {
  plan?: { data?: ProviderUsage; error?: string };
  context?: { used: number; window: number };
  now?: number;
};

/**
 * Every limit on this conversation in one table: each plan window's share, its reset and, for a day
 * or more, its pace against the clock (`▼` under, `▲` over), then the context and the plan's source.
 */
export function UsageDetail({ plan, context, now = Date.now() }: Usage) {
  const data = plan?.data;
  const windows = data?.windows ?? [];
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto] items-center gap-x-2 gap-y-1.5 px-2 py-1.5 text-[11px] whitespace-nowrap text-muted tabular-nums">
      {windows.map((w) => {
        const reset = resetLabel(w);
        const diff = pace(w, now);
        return (
          <Fragment key={w.label}>
            <span>{w.label}</span>
            <Bar percent={w.percent} />
            <span className="text-right text-text">{w.percent.toFixed(0)}%</span>
            <span>
              {reset && `resets ${reset}`}
              {diff !== undefined && (
                <span className={`ml-2 ${diff > 0 ? "text-danger" : "text-success"}`}>{paceLabel(diff)}</span>
              )}
            </span>
          </Fragment>
        );
      })}
      {context && (
        <>
          <span>context</span>
          <Bar percent={(context.used / context.window) * 100} />
          <span className="text-right text-text">{((context.used / context.window) * 100).toFixed(0)}%</span>
          <span>of {tokens(context.window)}</span>
        </>
      )}
      {data && windows.length > 0 && (
        <span className="col-span-4 mt-0.5 border-t border-stroke pt-1.5">
          {data.provider} · updated {ago(data.fetchedAt)}
        </span>
      )}
    </div>
  );
}

/**
 * The header's right edge: only the limit closest to running out, with the rest a hover or a focus
 * away. Every window with its reset and pace, then the context, made that edge the densest text on
 * screen for numbers read once in a while. A plan read that failed or an API key adds no windows,
 * never a stale percentage.
 */
export function UsageMeter({ plan, context, now }: Usage) {
  const windows = plan?.data?.windows ?? [];
  const shown = tightest([
    ...windows,
    ...(context ? [{ label: "context", percent: (context.used / context.window) * 100 }] : []),
  ]);
  if (!shown) return null;
  return (
    // Focusable so the table is reachable without a pointer; it is information, not a control.
    <div tabIndex={0} aria-label="Usage" className="group pointer-events-auto relative shrink-0 text-[11px] text-muted tabular-nums">
      <span className="flex items-center gap-1.5">
        {shown.label}
        <Bar percent={shown.percent} />
        {shown.percent.toFixed(0)}%
      </span>
      <div className="popover absolute top-full right-0 mt-3 hidden group-hover:block group-focus-visible:block">
        <UsageDetail plan={plan} context={context} now={now} />
      </div>
    </div>
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
    <header className="conversation-header pointer-events-none absolute inset-x-4 top-2 z-10 flex items-center gap-2.5 rounded-float bg-surface/75 py-1.5 pr-3 pl-2 ring-1 ring-stroke backdrop-blur-xl">
      {/* The same avatar as in the roster: whose work this is should not need reading. */}
      <Avatar name={agent} size={30} working={working} />
      <div className="min-w-0 flex-1">
        {/* The title doubles as the window's drag handle, which the frameless title bar needs. */}
        <div className="pointer-events-auto flex min-w-0 items-baseline gap-1.5 drag">
          <span className={`${title === agent ? "max-w-full" : "max-w-[35%]"} shrink-0 truncate font-prose font-semibold`} title={agent}>{agent}</span>
          {title !== agent && <span className="min-w-0 truncate font-prose text-muted" title={title}>· {title}</span>}
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
      <UsageMeter plan={plan} context={context} />
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
