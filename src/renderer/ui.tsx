/**
 * The control vocabulary: docs/ui.md §6, §7 and §9 as code, so a button's kind is chosen rather
 * than spelled out in class names at each call site.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Four kinds, two heights, and no third option.
 *
 * `primary` at most once per screen — the one thing to do here. `secondary` outlines an alternative,
 * `ghost` is an action inside a row or a header, `danger` deletes or removes.
 *
 * A disabled control is a question nobody answered, so `disabled` takes the answer: pass the reason
 * and the button goes dim and says it on hover. Nothing can be disabled silently.
 */
export function Button({
  kind = "secondary",
  size = 32,
  icon,
  disabled,
  title,
  children,
  className = "",
  ...rest
}: {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: 28 | 32;
  icon?: ReactNode;
  disabled?: string | false;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children">) {
  // Resting look and hover look are separate because a disabled button keeps its shape — it is the
  // same control, dimmed — but must not light up under the pointer.
  const kinds = {
    primary: ["bg-accent text-accent-fg", "hover:bg-accent/85"],
    secondary: ["border border-stroke", "hover:bg-hover"],
    ghost: ["text-muted", "hover:bg-hover hover:text-text"],
    danger: ["text-danger", "hover:bg-danger/12"],
  };
  const box = children
    ? `${size === 28 ? "h-7 px-2.5" : "h-8 px-3"} gap-1.5`
    : size === 28
      ? "size-7"
      : "size-8";
  return (
    <button
      {...rest}
      disabled={!!disabled}
      title={disabled || title}
      className={`inline-flex shrink-0 items-center justify-center rounded-card text-[12px] transition-colors ${box} ${
        kinds[kind][0]
      } ${disabled ? "opacity-40" : kinds[kind][1]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export type Tone = "accent" | "success" | "warning" | "danger" | "muted";

/** The dot alone, for the one place a badge does not fit: the rail's corner mark. */
export const dot: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted",
};

const words: Record<Tone, string> = {
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
};

/**
 * A state, said in a colour and in words at once — never colour alone (§11). The mark is a dot
 * unless an icon carries more, and `pulse` is for a state that is still happening.
 */
export function Badge({
  tone,
  icon,
  pulse,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] ${words[tone]}`}>
      {icon ?? <span className={`size-1.5 rounded-full ${dot[tone]} ${pulse ? "animate-pulse" : ""}`} />}
      {children}
    </span>
  );
}
