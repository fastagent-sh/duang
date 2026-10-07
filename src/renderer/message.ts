// Strips Electron's "Error invoking remote method 'x': Error:" wrapper from unexpected IPC failures.
export const message = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    "",
  );
