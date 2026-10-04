/**
 * What the content area shows when there is no conversation to read: setup states, problems that stop an
 * agent from opening, and a fresh start. Each says what it means for the person and offers the way on
 * (docs/ui.md §9b).
 */
import { ArrowClockwise, FolderOpen, FolderSimplePlus, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { Button } from "./ui.tsx";
import { Page, Problem } from "./problem.tsx";
import { home } from "./paths.ts";

export function NoAgents({ onAdd }: { onAdd: () => void }) {
  return (
    <Page
      tone="accent"
      icon={<Plus size={18} />}
      title="Add your first agent"
      advice="duang runs the agents you already have. Choose an agent's folder, or a project to make one in."
      actions={
        <Button kind="primary" size={32} onClick={onAdd}>
          Add an agent directory
        </Button>
      }
    />
  );
}

/**
 * duang cannot read its agent list. It must not repair the file: the broken one may be the only record of
 * which directories are agents. So the recovery is the person's (open it, fix or move it, retry), and the
 * app's job is to make both actions reachable, with the reason it could not read it.
 */
export function UnreadableRegistry({ reason, onReveal, onRetry }: { reason?: string; onReveal: () => void; onRetry: () => void }) {
  return (
    <Problem
      layout="page"
      tone="error"
      title="duang cannot read its list of agents"
      advice="Your agents and their conversations are untouched, and the file is left exactly as it is. Fix or move it, then retry."
      reason={reason}
      actions={
        <>
          <Button kind="primary" size={32} icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal agents.json
          </Button>
          <Button size={32} icon={<ArrowClockwise size={14} />} onClick={onRetry}>
            Retry
          </Button>
        </>
      }
    />
  );
}

/** The agent's definition does not load: its own error says where, and the folder is where to fix it. */
export function BrokenAgent({
  message,
  file,
  onOpenFile,
  onRemove,
  onReveal,
  onRetry,
}: {
  message: string;
  /** The file in its folder the error names, when it names one: opening it is the way to fix it. */
  file?: string;
  onOpenFile: (file: string) => void;
  onRemove: () => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  return (
    <Problem
      layout="page"
      tone="error"
      title="This agent could not be loaded"
      advice={
        file
          ? "Something in its definition stops it from starting. Fix it in the file below, then retry; duang has changed nothing."
          : "Something in its definition stops it from starting. Fix it in the agent's folder, then retry; duang has changed nothing."
      }
      reason={message}
      actions={
        <>
          {file && (
            <Button kind="primary" size={32} icon={<PencilSimple size={14} />} onClick={() => onOpenFile(file)}>
              Open {file.split("/").at(-1)}
            </Button>
          )}
          <Button kind={file ? "secondary" : "primary"} size={32} icon={<ArrowClockwise size={14} />} onClick={onRetry}>
            Retry
          </Button>
          <Button size={32} icon={<FolderOpen size={14} />} onClick={onReveal}>
            Reveal in Finder
          </Button>
          <Button kind="danger" size={32} icon={<X size={14} />} onClick={onRemove}>
            Remove from duang
          </Button>
        </>
      }
    />
  );
}

/**
 * The folder the agent was added from is not there: moved, deleted, or on a drive that is not mounted.
 * Locating it points the same agent at where it is now; Retry covers a drive coming back.
 */
export function MissingFolder({
  dir,
  onLocate,
  onRemove,
  onRetry,
}: {
  dir: string;
  onLocate: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <Problem
      layout="page"
      tone="error"
      title="This agent's folder is not there"
      advice={
        <>
          duang last found it at <span className="font-mono text-[12.5px]">{home(dir)}</span>. If it was moved,
          show duang where it is now: the agent keeps its name and conversations. If it is on a drive, connect it
          and retry.
        </>
      }
      actions={
        <>
          <Button kind="primary" size={32} icon={<FolderOpen size={14} />} onClick={onLocate}>
            Locate folder…
          </Button>
          <Button size={32} icon={<ArrowClockwise size={14} />} onClick={onRetry}>
            Retry
          </Button>
          <Button kind="danger" size={32} icon={<X size={14} />} onClick={onRemove}>
            Remove from duang
          </Button>
        </>
      }
    />
  );
}

/** A plain project: it can hold an agent, it just does not yet. Say exactly what gets written. */
export function NeedsAgent({ dir, onCreate, onRemove }: { dir: string; onCreate: () => void; onRemove: () => void }) {
  return (
    <Page
      tone="accent"
      icon={<FolderSimplePlus size={18} />}
      title="This folder has no agent yet"
      advice={
        <>
          duang can create one here. The project stays the agent&apos;s workspace, so it works on these files and reads
          their <span className="font-mono text-[12.5px]">AGENTS.md</span>.
        </>
      }
      actions={
        <>
          <Button kind="primary" size={32} onClick={onCreate}>
            Create agent here
          </Button>
          <Button kind="danger" size={32} icon={<X size={14} />} onClick={onRemove}>
            Remove
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-left">
        <pre className="rounded-card bg-surface-2 p-3 font-mono text-[12.5px] text-muted">
          {`${home(dir)}/fastagent/\n  fastagent.config.ts\n  .gitignore`}
        </pre>
        <p className="text-[12px] text-muted">
          Two files, nothing else. For the full scaffold (persona, skills, an example tool) run{" "}
          <span className="font-mono text-[12.5px]">fastagent init</span> instead.
        </p>
      </div>
    </Page>
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
