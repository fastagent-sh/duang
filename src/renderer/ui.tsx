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
 * Four kinds, two heights, and no third option.
 *
 * `primary` at most once per screen — the one thing to do here. `secondary` outlines an alternative,
 * `ghost` is an action inside a row or a header, `danger` deletes or removes and is quiet until the
 * pointer is on it, because these sit on screen all day. `loud` fills a kind instead of tinting it,
 * and exists for the one control that must be found instantly: Stop.
 *
 * Size decides the text size too (28 → 11px, 32 → 12px): a call site that passes its own would be
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
  size?: 28 | 32;
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
  const box = children ? `${size === 28 ? "h-7 px-2.5" : "h-8 px-3"} gap-1.5` : size === 28 ? "size-7" : "size-8";
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-disabled={disabled ? true : undefined}
      onClick={disabled ? undefined : onClick}
      title={disabled || title}
      className={`inline-flex shrink-0 items-center justify-center rounded-card transition-colors ${
        size === 28 ? "text-[11px]" : "text-[12px]"
      } ${box} ${rest_} ${disabled ? "opacity-40 cursor-default" : hover} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * An agent's tile: a rounded square, because circles are people and squares are programs (§12).
 * The colour is the name's, so the same agent is the same tile everywhere — hues are walked in a
 * shuffled order, Telegram's trick for keeping neighbours in a list distinguishable.
 *
 * Presence is the ring around it, never a change to the tile: an agent looks like the same agent
 * whether it is busy or idle.
 */
const HUES = [285, 150, 25, 235, 95, 330, 55] as const;
const ORDER = [0, 4, 1, 6, 3, 5, 2] as const;

export function Avatar({ name, size = 40, working }: { name: string; size?: number; working?: boolean }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) % 9973;
  const hue = HUES[ORDER[hash % ORDER.length]!]!;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-semibold uppercase text-white ${
        working ? "ring-2 ring-accent ring-offset-2 ring-offset-surface animate-pulse" : ""
      }`}
      style={{
        width: size,
        height: size,
        // A rounded square, not a circle: squares are programs. The gradient is Telegram's, and it
        // is most of why their avatars look alive rather than printed.
        borderRadius: Math.round(size * 0.32),
        fontSize: Math.round(size * 0.34),
        backgroundImage: `linear-gradient(145deg, oklch(0.64 0.12 ${hue}), oklch(0.46 0.11 ${hue + 12}))`,
      }}
    >
      {name.slice(0, 2)}
    </span>
  );
}

/**
 * A filled count, Telegram's unread pill: the one thing in the sidebar that has to be seen from
 * across the room. A tinted word was missed in testing, repeatedly — this is louder on purpose and
 * exists only for outcomes nobody has looked at yet (§9).
 */
export function Pill({ tone, children }: { tone: "accent" | "danger"; children: ReactNode }) {
  const fills = { accent: "bg-accent-fill text-fill-fg", danger: "bg-danger-fill text-fill-fg" };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${fills[tone]}`}>{children}</span>
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
