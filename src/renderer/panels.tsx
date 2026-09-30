/** What the content area shows when there is no conversation to read: setup states and a fresh start. */
import { FolderOpen, X } from "@phosphor-icons/react";
import { Button } from "./ui.tsx";

/** Whatever replaces the transcript sits in the transcript's box, so the composer never moves. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-16 pb-5">{children}</div>;
}

export function NoAgents({ onAdd }: { onAdd: () => void }) {
  return (
    <Panel>
      <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
        <p className="text-muted leading-relaxed">
          duang runs the agents you already have — and later puts them online.
        </p>
        <Button kind="primary" onClick={onAdd}>
          Add an agent directory
        </Button>
        <p className="text-muted text-[11px]">
          No agent yet? Run <span className="font-mono">fastagent init</span> in a project.
        </p>
      </div>
    </Panel>
  );
}

/**
 * duang cannot read its own agent list. It must not repair the file: the broken one may be the only
 * record of which directories are agents. So the recovery is the person's — open it, fix or move it,
 * retry — and the app's job is to make both actions reachable.
 */
export function UnreadableRegistry({ onReveal, onRetry }: { onReveal: () => void; onRetry: () => void }) {
  return (
    <Panel>
      <div className="max-w-sm mx-auto mt-20 text-center space-y-4">
        <p className="text-muted leading-relaxed">
          duang could not read its agent list, so it is not showing one. Your agent directories and their
          conversations are untouched, and the file is left exactly as it is.
        </p>
        <div className="flex gap-2 justify-center">
          <Button icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal agents.json
          </Button>
          <Button kind="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function BrokenAgent({
  message,
  onRemove,
  onReveal,
  onRetry,
}: {
  message: string;
  onRemove: () => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  return (
    <Panel>
      <div className="max-w-2xl space-y-3">
        <div className="rounded-card border border-danger/40 bg-danger/5 p-3 text-danger whitespace-pre-wrap leading-relaxed">
          {message}
        </div>
        <div className="flex gap-2">
          <Button kind="danger" icon={<X size={14} />} onClick={onRemove}>
            Remove agent
          </Button>
          <Button icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal in Finder
          </Button>
          <Button kind="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** A plain project: it can hold an agent, it just does not yet. Say exactly what gets written. */
export function NeedsAgent({ dir, onCreate, onRemove }: { dir: string; onCreate: () => void; onRemove: () => void }) {
  return (
    <Panel>
      <div className="max-w-xl space-y-4">
        <p className="text-muted leading-relaxed">
          This folder has no agent yet. duang can create one here — the project stays the agent&apos;s workspace, so it
          works on these files and reads their <span className="font-mono">AGENTS.md</span>.
        </p>
        <pre className="rounded-card bg-surface ring-1 ring-stroke p-3 text-[11px] font-mono text-muted">
          {`${dir}/fastagent/\n  fastagent.config.ts\n  .gitignore`}
        </pre>
        <p className="text-muted text-[11px]">
          Two files, nothing else. For the full scaffold (persona, skills, example tool) run{" "}
          <span className="font-mono">fastagent init</span> instead.
        </p>
        <div className="flex gap-2">
          <Button kind="primary" onClick={onCreate}>
            Create agent here
          </Button>
          <Button kind="danger" icon={<X size={14} />} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** The opening screen of a conversation nobody has spoken in yet. */
export function NewConversation({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto grid place-items-center px-6">
      <div className="column -mt-16">
        <h1 className="mb-5 text-center text-[22px] font-medium">What should we work on?</h1>
        {children}
      </div>
    </div>
  );
}
