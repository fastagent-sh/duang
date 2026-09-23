/**
 * Every control the app owns, on one page, so "what do we have and what does it look like" is
 * answered by looking rather than by reading docs/ui.md.
 *
 * Shown at `#gallery`; `npm run shots` captures it in both colour modes. Not a component framework:
 * the sections marked `real` render the components from `ui.tsx` and `code.tsx` with fixed props,
 * and the ones marked `sketch` are copies of markup that still lives in `panels.tsx` — they show
 * the intended look and will not follow a change made there.
 */
import { ArrowUp, FolderOpen, Plus, Stop, Trash, X } from "@phosphor-icons/react";
import { Badge, Button } from "./ui.tsx";
import { CodeBlock } from "./code.tsx";

function Section({
  title,
  note,
  sketch,
  children,
}: {
  title: string;
  note?: string;
  sketch?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium flex items-center gap-2">
          {title}
          {sketch && <Badge tone="muted">sketch, not a component</Badge>}
        </h2>
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
          <p className="text-muted text-[12px]">
            docs/ui.md §6b. Unmarked sections are the real components; marked ones are copies of
            markup that still lives in panels.tsx.
          </p>
        </header>

        <Section
          title="Buttons — kinds"
          note="primary at most once per screen; danger is quiet until the pointer is on it"
        >
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
          <Button kind="ghost" size={28} disabled="Stop the turn to change the model" className="font-mono">
            anthropic/claude-sonnet-5
          </Button>
          <Button disabled="This agent is not ready">Reveal in Finder</Button>
        </Section>

        <Section title="Badges — the one status vocabulary" note="a mark and a word, never colour alone; pulse means still happening">
          <Badge tone="accent" pulse>
            working… 12s
          </Badge>
          <Badge tone="accent" pulse>
            2 working
          </Badge>
          <Badge tone="accent" pulse>
            running
          </Badge>
          <Badge tone="success">done</Badge>
          <Badge tone="danger">failed</Badge>
          <Badge tone="muted">stopped</Badge>
          <Badge tone="warning">refused</Badge>
          <Badge tone="warning">needs a model</Badge>
          <Badge tone="warning">no agent yet</Badge>
          <Badge tone="danger">broken</Badge>
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

        <Section title="Conversation rows" note="one line, time trailing; selected is a tint, not a fill" sketch>
          <div className="w-72 space-y-0.5">
            <div className="flex items-baseline gap-2 rounded-card bg-accent-weak py-1.5 pr-3 pl-4 text-accent">
              <span className="min-w-0 flex-1 truncate text-[12.5px]">Explain the ListingResult component</span>
              <span className="shrink-0 text-[11px] text-muted">just now</span>
            </div>
            <div className="flex items-baseline gap-2 rounded-card py-1.5 pr-3 pl-4">
              <span className="min-w-0 flex-1 truncate text-[12.5px]">Run the i18n check</span>
              <span className="shrink-0 text-[11px] text-muted">2h ago</span>
            </div>
            <div className="flex items-baseline gap-2 rounded-card py-1.5 pr-3 pl-4">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted italic">New conversation</span>
            </div>
          </div>
        </Section>

        <Section title="Transcript pieces" note="the code block is real; the rest is markup from panels.tsx" sketch>
          <div className="w-full space-y-4">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-card rounded-br-[4px] bg-accent-weak px-3.5 py-2">
                Run the i18n check and explain what broke
              </div>
            </div>
            <div className="leading-relaxed">
              The check fails in one place, and the cause is a missing key rather than the component.
            </div>
            <details className="group rounded-card open:bg-surface open:ring-1 open:ring-stroke">
              <summary className="cursor-default select-none flex items-center gap-2 rounded-card px-2.5 h-8 text-[12px] hover:bg-hover group-open:rounded-b-none">
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

        <Section title="Icon-only, where the symbol is universal" note="loud fills the kind — Stop has to be found instantly">
          <Button size={28} kind="primary" icon={<ArrowUp size={15} />} aria-label="Send" />
          <Button size={28} kind="danger" loud icon={<Stop size={13} weight="fill" />} aria-label="Stop" />
          <Button size={28} kind="ghost" icon={<X size={14} />} aria-label="Close" />
        </Section>
      </div>
    </div>
  );
}
