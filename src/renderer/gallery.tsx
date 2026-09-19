/**
 * Every control the app owns, on one page, so "what do we have and what does it look like" is
 * answered by looking rather than by reading docs/ui.md.
 *
 * Shown at `#gallery`; `npm run shots` captures it in both colour modes. Not part of the app, and
 * deliberately not a component framework: it renders the real components with fixed props.
 */
import { ArrowUp, FolderOpen, Plus, Stop, Trash, X } from "@phosphor-icons/react";
import { Badge, Button } from "./ui.tsx";
import { CodeBlock } from "./code.tsx";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">{title}</h2>
        {note && <p className="text-muted text-[11px]">{note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function Gallery() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="column space-y-8">
        <header>
          <h1 className="text-[20px] font-medium">
            duang<span className="text-accent">·</span> components
          </h1>
          <p className="text-muted text-[12px]">docs/ui.md §6b. Everything here is the component the app uses.</p>
        </header>

        <Section title="Buttons — kinds" note="primary at most once per screen; danger deletes or removes">
          <Button kind="primary">Create agent here</Button>
          <Button>Reveal in Finder</Button>
          <Button kind="ghost">Retry</Button>
          <Button kind="danger" icon={<X size={14} />}>
            Remove agent
          </Button>
        </Section>

        <Section title="Buttons — heights" note="28 inside rows and dense bars, 32 standing on its own">
          <Button size={32}>32 — on its own</Button>
          <Button size={28}>28 — in a row</Button>
          <Button size={32} icon={<Plus size={16} />} aria-label="Add" />
          <Button size={28} icon={<FolderOpen size={14} />} aria-label="Reveal" />
          <Button size={28} kind="danger" icon={<Trash size={13} />} aria-label="Delete" />
          <Button size={28} kind="primary" icon={<ArrowUp size={15} />} aria-label="Send" />
        </Section>

        <Section title="Buttons — disabled" note="the prop takes the reason, so nothing greys out silently">
          <Button kind="primary" size={28} icon={<ArrowUp size={15} />} disabled="Type a message first" />
          <Button kind="ghost" size={28} disabled="Stop the turn to change the model" className="font-mono text-[11px]">
            anthropic/claude-sonnet-5
          </Button>
          <Button disabled="This agent is not ready">Reveal in Finder</Button>
        </Section>

        <Section title="Badges" note="a mark and a word, never colour alone; pulse means still happening">
          <Badge tone="accent" pulse>
            working… 12s
          </Badge>
          <Badge tone="accent" pulse>
            running
          </Badge>
          <Badge tone="success">done</Badge>
          <Badge tone="danger">failed</Badge>
          <Badge tone="muted">stopped</Badge>
          <Badge tone="warning">needs a model</Badge>
        </Section>

        <Section title="Surfaces" note="value plus a hairline, not shadow — except the one popover shadow">
          <div className="rounded-card bg-surface px-3 h-8 grid place-items-center text-[12px]">surface (card)</div>
          <div className="rounded-card bg-surface-2 px-3 h-8 grid place-items-center text-[12px]">surface-2</div>
          <div className="rounded-card ring-1 ring-stroke px-3 h-8 grid place-items-center text-[12px]">hairline</div>
          <div className="rounded-card bg-accent-weak text-accent px-3 h-8 grid place-items-center text-[12px]">
            accent-weak
          </div>
          <div className="popover px-3 h-8 grid place-items-center text-[12px]">popover</div>
        </Section>

        <Section title="Conversation rows" note="selected is a surface, not a border">
          <div className="w-64 space-y-0.5">
            <div className="rounded-card bg-surface px-2 py-1.5">
              <div className="truncate">Explain the ListingResult component</div>
              <div className="text-muted text-[11px]">just now</div>
            </div>
            <div className="rounded-card px-2 py-1.5">
              <div className="truncate">Run the i18n check</div>
              <div className="text-muted text-[11px]">2h ago</div>
            </div>
            <div className="rounded-card px-2 py-1.5">
              <div className="truncate text-muted italic">New conversation</div>
            </div>
          </div>
        </Section>

        <Section title="Transcript pieces">
          <div className="w-full space-y-4">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-card rounded-br-[4px] bg-accent-weak px-3.5 py-2">
                Run the i18n check and explain what broke
              </div>
            </div>
            <div className="leading-relaxed">
              The check fails in one place, and the cause is a missing key rather than the component.
            </div>
            <details className="rounded-card bg-surface overflow-hidden">
              <summary className="cursor-default select-none flex items-center gap-2 px-3 h-7 text-[12px]">
                <span className="font-mono">bun run i18n:check</span>
                <Badge tone="danger">failed</Badge>
              </summary>
            </details>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <span className="font-mono">model changed to anthropic/claude-sonnet-5</span>
            </div>
            <CodeBlock language="typescript" code={'const t = useTranslations("AmazonListing");\nreturn t("heading");'} />
          </div>
        </Section>

        <Section title="Icon-only, where the symbol is universal">
          <Button size={28} kind="primary" icon={<ArrowUp size={15} />} aria-label="Send" />
          <button
            aria-label="Stop"
            className="size-7 grid place-items-center rounded-card bg-danger text-accent-fg"
          >
            <Stop size={13} weight="fill" />
          </button>
          <Button size={28} kind="ghost" icon={<X size={14} />} aria-label="Close" />
        </Section>
      </div>
    </div>
  );
}
