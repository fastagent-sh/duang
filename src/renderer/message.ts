/**
 * The sentence the other program wrote, and nothing of ours around it. Only unexpected failures
 * throw across IPC, and Electron wraps those as "Error invoking remote method 'x': Error: <what main
 * said>"; expected refusals arrive as values and never come through here.
 */
export const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    "",
  );
