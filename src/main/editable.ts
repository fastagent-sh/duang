/**
 * Files an agent's author writes and a person opens in an editor: what a loading error that names a file
 * points at, and the only kind main will open for it (never something the system would run, such as a
 * `.command`). No imports, so the window can use the same rule to decide whether to offer it.
 */
export const EDITABLE = /\.(?:ts|mts|cts|js|mjs|cjs|json|md|ya?ml|toml)$/;
