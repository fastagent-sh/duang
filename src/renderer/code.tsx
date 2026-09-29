/**
 * Code in the agent's output.
 *
 * Streamdown owns the markdown, including the hard part — a fence that has not closed yet while
 * tokens are still arriving. The only thing overridden is `code`, which is the seam it documents;
 * its own `pre` is left alone because that is what marks a child as a fenced block rather than an
 * inline span. Replacing `pre` too is how every code block silently became inline.
 *
 * Highlighting is `react-shiki` (the component assistant-ui recommends for this job) on Shiki's core
 * bundle, so only the grammars a coding agent writes are shipped. Both colour modes come from one
 * Catppuccin pair, switched by the CSS variable Shiki writes onto each token.
 *
 * The chrome is ours: one surface, no frame, the language and copy quiet above the code.
 */
import { Suspense, use, useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { ShikiHighlighter, createHighlighterCore, createJavaScriptRegexEngine } from "react-shiki/core";

/** Created once, awaited with `use` at the first code block — React suspends until the core lands. */
const highlighterReady = createHighlighterCore({
  themes: [import("@shikijs/themes/catppuccin-latte"), import("@shikijs/themes/catppuccin-mocha")],
  langs: [
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/css"),
    import("@shikijs/langs/diff"),
    import("@shikijs/langs/go"),
    import("@shikijs/langs/html"),
    import("@shikijs/langs/json"),
    import("@shikijs/langs/markdown"),
    import("@shikijs/langs/python"),
    import("@shikijs/langs/rust"),
    import("@shikijs/langs/sql"),
    import("@shikijs/langs/tsx"),
    import("@shikijs/langs/typescript"),
    import("@shikijs/langs/yaml"),
  ],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

const THEME = { light: "catppuccin-latte", dark: "catppuccin-mocha" };

/** What people write in a fence, mapped to a grammar we carry. Anything else renders as plain mono. */
const ALIASES: Record<string, string> = {
  console: "bash",
  javascript: "tsx",
  js: "tsx",
  jsx: "tsx",
  md: "markdown",
  mjs: "typescript",
  patch: "diff",
  py: "python",
  rs: "rust",
  scss: "css",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

export function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="code-block relative rounded-float bg-surface px-4 pt-3 pb-3.5">
      <div className="flex items-center h-5 text-[12px] text-muted">{language}</div>
      <CopyButton code={code} />
      {/* The same text in the same place until the grammar lands: no skeleton, no reflow. */}
      <Suspense fallback={<Plain code={code} />}>
        <Highlighted code={code} language={language} />
      </Suspense>
    </div>
  );
}

function Plain({ code }: { code: string }) {
  return <pre className="mt-1.5 overflow-x-auto font-mono text-[12.5px] leading-relaxed">{code}</pre>;
}

function Highlighted({ code, language }: { code: string; language: string }) {
  const lang = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const highlighter = use(highlighterReady);
  return (
    <ShikiHighlighter
        language={lang}
        theme={THEME}
        highlighter={highlighter}
        addDefaultStyles={false}
        showLanguage={false}
        // Both themes in one pass, resolved by the document's colour-scheme — no class to toggle,
        // and it follows the system at the same moment everything else does.
        defaultColor="light-dark()"
        // While tokens arrive the grammar is re-run; throttling keeps a long stream from re-highlighting
        // on every delta.
        delay={80}
        className="mt-1.5 block overflow-x-auto font-mono text-[12.5px] leading-relaxed [&_pre]:bg-transparent"
    >
      {code}
    </ShikiHighlighter>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      aria-label="Copy code"
      title="Copy code"
      className="absolute top-2.5 right-3 p-1 text-muted hover:text-text"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/**
 * Streamdown's `code`: the same element for a fence and for an inline span, told apart by the flag
 * its `pre` sets. Detection lives here and nowhere else.
 */
export function MarkdownCode({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: unknown;
  node?: unknown;
}) {
  const text = typeof children === "string" ? children : String(children ?? "");
  if (!("data-block" in props)) {
    return <code className="inline-code rounded-[4px] px-[0.3em] py-px font-mono">{text}</code>;
  }
  return <CodeBlock code={text.replace(/\n$/, "")} language={/language-(\S+)/.exec(className ?? "")?.[1] ?? "text"} />;
}
