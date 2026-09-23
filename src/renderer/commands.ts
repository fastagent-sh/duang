/**
 * Slash-command completion: names only, and a name is all it is.
 *
 * FastAgent's `commands()` is a LISTING; the line is sent as written and any expansion is the
 * engine's (`/skill:<name>` for a skill, `/<name>` for a prompt template). The composer's only job
 * is to spell the name correctly; it inserts `/<name>` for both, so a completed skill is read as
 * text. Arguments are typed after it like any other text.
 */
import type { AgentCommand } from "@fastagent-sh/fastagent/session";

/**
 * The partial name being typed, or undefined when this line is not one. Completion stops at the
 * first space: past it the line is arguments, which are the agent's to read, not ours to guess.
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
