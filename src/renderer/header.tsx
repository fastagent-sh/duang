/** The bar over a conversation: who it is with, where it runs, and what it costs. */
import { ListBullets } from "@phosphor-icons/react";
import type { ProviderUsage, UsageWindow } from "../preload/index.ts";
import { contextLabel, errorLine, pace, paceLabel, resetLabel } from "./usage.ts";
import { ago } from "./sessions.ts";
import { Avatar, Badge, Button } from "./ui.tsx";
import { location } from "./paths.ts";

/**
 * What is left of the plan paying for this conversation: each window's share used, when it resets,
 * and for the week whether it is burning faster than the clock (▲) or slower (▼). Nothing for an API
 * key; a failed read says so instead of leaving old numbers up.
 */
export function PlanUsage({
  plan,
  now = Date.now(),
  brief,
}: {
  plan?: { data?: ProviderUsage; error?: string };
  now?: number;
  /** Used and when it resets, beside a name that must stay readable; the pace stays in the tooltip. */
  brief?: boolean;
}) {
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
        <PlanWindow key={w.label} window={w} now={now} brief={brief} />
      ))}
    </span>
  );
}

function PlanWindow({ window: w, now, brief }: { window: UsageWindow; now: number; brief?: boolean }) {
  const reset = resetLabel(w);
  const diff = pace(w, now);
  return (
    <span className="flex items-center gap-1.5">
      {w.label}
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-stroke">
        <span className="block h-full rounded-full bg-muted" style={{ width: `${Math.min(100, w.percent)}%` }} />
      </span>
      {/* Settings stacks plans in rows: a fixed width lines them up whatever the digits. */}
      <span className={brief ? "min-w-[4ch] text-right" : undefined}>{w.percent.toFixed(0)}%</span>
      {/* A narrow header keeps the percentages; when and how fast move to the tooltip. Measured on
          the header, not the window, because the sidebar's width is the person's to drag. */}
      {reset && <span className="@max-[44rem]:hidden">~ {reset}</span>}
      {!brief && diff !== undefined && (
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
