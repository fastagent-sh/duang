/** The bar over a conversation: who it is with, where it runs, and what it costs. */
import { Fragment } from "react";
import { ListBullets } from "@phosphor-icons/react";
import type { ProviderUsage } from "../preload/index.ts";
import { pace, paceLabel, resetLabel, tokens } from "./usage.ts";
import { ago } from "./sessions.ts";
import { Avatar, Badge, Button } from "./ui.tsx";

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
 * The header's right edge: how full this conversation's context is, and only that. It is the one number
 * that is about this conversation and moves as it goes; the plan's windows belong to the account and
 * change slowly, so they wait in the table a hover or a focus away, with the context's own size. Mixing
 * them in one slot (whichever is fuller) would change what the slot means from one glance to the next.
 *
 * The edge is always there, so the table always has somewhere to hang: a new conversation has no context
 * to report until its first answer (`–`), and the plan is still one hover away. The table shows what
 * exists; a plan read that failed or an API key adds no windows, never a stale percentage, and with
 * nothing to list there is no table.
 */
export function UsageMeter({ plan, context, now }: Usage) {
  const percent = context ? (context.used / context.window) * 100 : undefined;
  const hasTable = context !== undefined || (plan?.data?.windows ?? []).length > 0;
  return (
    // Focusable when there is a table, so it is reachable without a pointer; it is information, not a control.
    <div
      tabIndex={hasTable ? 0 : undefined}
      aria-label="Usage"
      className="group pointer-events-auto relative shrink-0 text-[11px] text-muted tabular-nums"
    >
      <span className="flex items-center gap-1.5">
        context
        <Bar percent={percent ?? 0} />
        {percent === undefined ? "–" : `${percent.toFixed(0)}%`}
      </span>
      {hasTable && (
        <div className="popover absolute top-full right-0 mt-3 hidden group-hover:block group-focus-visible:block">
          <UsageDetail plan={plan} context={context} now={now} />
        </div>
      )}
    </div>
  );
}

/**
 * What you are looking at, floating over it: the conversation, the workspace it runs in, and what is
 * left of the plan and the context, beside the one action on it. It hovers rather than sits in a bar
 * because the transcript is the page, and a full-width bar would cut it in two. Translucent, so text
 * passing underneath reads as scrolled away rather than deleted.
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
}) {
  return (
    // The bar floats over the scroll area rather than inside it, so it must let the wheel through;
    // only what you can actually grab, click or hover for a tooltip takes the pointer back.
    <header className="pointer-events-none absolute inset-x-4 top-2 z-10">
      {/* Two parts, as Telegram splits a chat's info from what you can do to it: what you are looking
          at, and the one thing to do about it. It runs the pane's width, as chrome does; the composer
          below is the one that takes the reading column, to sit under the text. */}
      <div className="flex items-stretch gap-2">
        <div className="conversation-header flex min-w-0 flex-1 items-center gap-2.5 rounded-composer bg-surface/75 py-1.5 pr-4 pl-2 ring-1 ring-stroke backdrop-blur-xl">
          {/* The same avatar as in the roster: whose work this is should not need reading. */}
          <Avatar name={agent} size={30} working={working} />
          <div className="min-w-0 flex-1">
            {/* The two lines double as the window's drag handle, which the frameless title bar needs. The name says
                where the agent lives on hover: the folder is the agent's identity, and the roster's menu opens it. */}
            <div className="pointer-events-auto min-w-0 drag">
              <div className="truncate font-prose font-semibold" title={dir ? `${agent}\n${dir}` : agent}>
                {agent}
              </div>
              {title !== agent && (
                <div className="truncate font-prose text-[12px] text-muted" title={title}>
                  {title}
                </div>
              )}
            </div>
          </div>
          {working && <Badge tone="accent" pulse>working</Badge>}
          <UsageMeter plan={plan} context={context} />
          {!!queued && <span className="shrink-0 text-[11px] text-muted">{queued} queued</span>}
        </div>
        {list && (
          <div className="conversation-header grid aspect-square shrink-0 place-items-center rounded-full bg-surface/75 ring-1 ring-stroke backdrop-blur-xl">
            {/* Opens the `ConversationList` popover by id and anchors it (index.css). A dot says one of
                them finished while you were elsewhere, which is the reason to open it. */}
            <Button
              kind="ghost"
              size={40}
              popoverTarget="conversations"
              aria-label={list.unseen ? `Conversations, ${list.unseen} unseen` : "Conversations"}
              title="Conversations"
              icon={
                <span className="relative">
                  <ListBullets size={18} />
                  {list.unseen > 0 && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-accent" />}
                </span>
              }
              className={`conversations-anchor pointer-events-auto ${list.open ? "bg-hover" : ""}`}
            />
          </div>
        )}
      </div>
    </header>
  );
}
