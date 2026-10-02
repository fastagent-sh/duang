/**
 * The control vocabulary: docs/ui.md §6b, §7 and §9 as code, so a button's kind is chosen rather
 * than spelled out in class names at each call site.
 *
 * Nothing here takes a class that a call site then has to fight. Tailwind utilities all have the
 * same specificity and the later rule in the generated sheet wins, regardless of the order they are
 * written in `class`, so anything a call site might want to change — the text size, whether danger
 * is loud or quiet — is decided by a prop here instead.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * Four kinds, three sizes, and no fourth option: 28 and 32 are rectangles; 40 is the round icon
 * button of the composer and the header, and only an icon fits it.
 *
 * `primary` at most once per screen — the one thing to do here. `secondary` outlines an alternative,
 * `ghost` is an action inside a row or a header, `danger` deletes or removes and is quiet until the
 * pointer is on it, because these sit on screen all day. `loud` fills a kind instead of tinting it,
 * and exists for the one control that must be found instantly: Stop.
 *
 * Size decides the text size too (28 → 11px, otherwise 12px): a call site that passes its own would be
 * overridden by this one anyway.
 *
 * A disabled control is a question nobody answered, so `disabled` takes the answer: pass the reason
 * and the button dims and carries it. It stays focusable and says so with `aria-disabled` rather
 * than the native attribute, because a natively disabled button cannot be reached by keyboard, and
 * a reason nobody can reach is not a reason (WAI-ARIA APG). Activation is dropped here instead.
 */
export function Button({
  kind = "secondary",
  size = 32,
  loud,
  icon,
  disabled,
  title,
  onClick,
  children,
  className = "",
  ref,
  ...rest
}: {
  /** Forwarded so a roving tabindex can focus the control it has moved to (§11). */
  ref?: Ref<HTMLButtonElement>;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: 28 | 32 | 40;
  loud?: boolean;
  icon?: ReactNode;
  disabled?: string | false;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children">) {
  // Resting look and hover look are separate because a disabled button keeps its shape — it is the
  // same control, dimmed — but must not light up under the pointer.
  const kinds = {
    primary: ["bg-accent-fill text-fill-fg", "hover:bg-accent-fill/85"],
    secondary: ["border border-stroke", "hover:bg-hover"],
    ghost: ["text-muted", "hover:bg-hover hover:text-text"],
    danger: ["text-muted", "hover:bg-danger/12 hover:text-danger"],
  };
  const filled = { primary: "bg-accent-fill text-fill-fg", danger: "bg-danger-fill text-fill-fg" };
  const [rest_, hover] = loud && kind in filled ? [filled[kind as "primary" | "danger"], ""] : kinds[kind];
  const box =
    size === 40
      ? "size-10 rounded-full"
      : `rounded-card ${children ? `${size === 28 ? "h-7 px-2.5" : "h-8 px-3"} gap-1.5` : size === 28 ? "size-7" : "size-8"}`;
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-disabled={disabled ? true : undefined}
      onClick={disabled ? undefined : onClick}
      title={disabled || title}
      className={`inline-flex shrink-0 items-center justify-center transition-colors ${
        size === 28 ? "text-[11px]" : "text-[12px]"
      } ${box} ${rest_} ${disabled ? "opacity-40 cursor-default" : hover} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A filled pill, Telegram's unread mark: the one thing in the roster that has to be seen from
 * across the room. A tinted word is missed: this is louder on purpose and
 * exists only for outcomes nobody has looked at yet (§9). A lone count stays round, as Telegram's does.
 */
export function Pill({ tone, children }: { tone: "accent" | "danger"; children: ReactNode }) {
  const fills = { accent: "bg-accent-fill text-fill-fg", danger: "bg-danger-fill text-fill-fg" };
  return (
    <span
      className={`shrink-0 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] leading-4 font-semibold tabular-nums ${fills[tone]}`}
    >
      {children}
    </span>
  );
}

export type Tone = "accent" | "success" | "warning" | "danger" | "muted";

const dot: Record<Tone, string> = {
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
 *
 * A badge shrinks like any other text. Beside something that must stay readable — a long command in
 * a tool row — the call site pins it with `shrink-0`.
 */
export function Badge({
  tone,
  icon,
  pulse,
  className = "",
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${words[tone]} ${className}`}>
      {icon ?? <span className={`size-1.5 shrink-0 rounded-full ${dot[tone]} ${pulse ? "animate-pulse" : ""}`} />}
      {children}
    </span>
  );
}
