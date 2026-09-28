/**
 * Slash-command completion: the composer spells a listed command, and the line goes as typed.
 *
 * The engine, not duang, runs it (fastagent#572): pi expands `/skill:<name>` into the skill's text and
 * dispatches an extension's or prompt template's `/<name>`. So completion inserts the spelling the
 * engine answers to and interprets nothing itself, which is what keeps a remote agent, whose files are
 * not on this machine, working the same way. Arguments are typed after it like any other text.
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

/** How pi is asked to run it: a skill by `skill:<name>`, anything else by its name. */
const spelling = (command: AgentCommand) => (command.source === "skill" ? `skill:${command.name}` : command.name);

/** A skill is found by its name or by the spelling that runs it. */
export function matches(commands: AgentCommand[], query: string, limit = 8): AgentCommand[] {
  const needle = query.toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(needle) || spelling(c).toLowerCase().startsWith(needle))
    .slice(0, limit);
}

/** The line after accepting a completion: its spelling, plus the space its arguments start after. */
export function complete(command: AgentCommand): string {
  return `/${spelling(command)} `;
}
