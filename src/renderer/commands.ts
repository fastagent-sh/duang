/**
 * Slash-command completion: names only.
 *
 * pi draws the line between what it interprets and what we present. A `/` line goes to it verbatim —
 * it expands the command, its skills and its templates. So the composer completes the NAME and then
 * gets out of the way; arguments are typed after it like any other text.
 */
import type { AgentCommand } from "@fastagent-sh/fastagent/session";

/**
 * The partial name being typed, or undefined when this line is not one. Completion stops at the
 * first space: past it the line is arguments, which are pi's to read, not ours to guess.
 */
export function completionQuery(value: string): string | undefined {
  const match = /^\/(\S*)$/.exec(value);
  return match?.[1];
}

export function matches(commands: AgentCommand[], query: string, limit = 8): AgentCommand[] {
  const needle = query.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(needle)).slice(0, limit);
}

/** The line after accepting a completion: the name, plus the space its arguments start after. */
export function complete(name: string): string {
  return `/${name} `;
}
