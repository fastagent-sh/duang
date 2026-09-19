/**
 * Code in the agent's output, rendered by us.
 *
 * Streamdown ships its own code block — a bordered container inside a padded container with the copy
 * button floated out by a negative margin, in shadcn class names our palette does not define. Styling
 * over it meant fighting inline styles for a shape we did not want, so the markdown renderer hands
 * fenced code to this component instead and keeps everything else.
 *
 * The register is one surface and no frame: background a step above the page, generous padding, the
 * language and the copy control quiet at the top, nothing drawn between them and the code.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { highlight, type Token } from "./highlight.ts";

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [tokens, setTokens] = useState<Token[][] | undefined>();

  useEffect(() => {
    let current = true;
    void highlight(code, language).then((result) => {
      if (current) setTokens(result);
    });
    return () => {
      current = false;
    };
  }, [code, language]);

  return (
    <div className="relative my-3.5 rounded-float bg-surface px-4 pt-3 pb-3.5">
      <div className="flex items-center h-5 text-[12px] text-muted">{language}</div>
      <CopyButton code={code} />
      <pre className="mt-1.5 overflow-x-auto font-mono text-[12.5px] leading-[1.65]">
        <code>
          {/* Until the grammar loads, the same text in the same place — no skeleton, no reflow. */}
          {tokens
            ? tokens.map((line, y) => (
                <span key={y}>
                  {line.map((token, x) => (
                    <span key={x} style={token.htmlStyle}>
                      {token.content}
                    </span>
                  ))}
                  {"\n"}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
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

/** `code` in markdown is both a fence and an inline span; only the fence gets the block treatment. */
export function MarkdownCode({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: unknown;
  node?: unknown;
}) {
  const block = "data-block" in props;
  const text = typeof children === "string" ? children : String(children ?? "");
  if (!block) {
    return <code className="rounded-[5px] bg-surface px-1.5 py-[0.15em] font-mono text-[0.92em]">{text}</code>;
  }
  return <CodeBlock code={text.replace(/\n$/, "")} language={/language-(\S+)/.exec(className ?? "")?.[1] ?? "text"} />;
}
