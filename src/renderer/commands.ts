// The engine runs the command (fastagent#572), not duang, so a remote agent works the same way.
import type { AgentCommand } from "@fastagent-sh/fastagent/session";

// Past the first space the line is arguments, the agent's to read.
export function completionQuery(value: string): string | undefined {
  const match = /^\/(\S*)$/.exec(value);
  return match?.[1];
}

export const spelling = (command: AgentCommand) => (command.source === "skill" ? `skill:${command.name}` : command.name);

export function matches(commands: AgentCommand[], query: string, limit = 8): AgentCommand[] {
  const needle = query.toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(needle) || spelling(c).toLowerCase().startsWith(needle))
    .slice(0, limit);
}

export function complete(command: AgentCommand): string {
  return `/${spelling(command)} `;
}
