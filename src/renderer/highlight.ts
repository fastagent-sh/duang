/**
 * Syntax highlighting for the agent's code blocks.
 *
 * `@streamdown/code` does this already, but it pulls Shiki's whole bundle: 12 MB of assets across
 * 300 chunks for languages an agent directory will never contain. This is the same plugin contract
 * against a fixed set — the languages a coding agent actually writes and the shell it runs — so the
 * build stays a few hundred KB.
 *
 * Themes are Catppuccin: Mocha leans violet like the accent, Latte is its real light counterpart,
 * so both colour modes come from one family. Streamdown emits both and picks with `dark:`, which is
 * the same `prefers-color-scheme` the rest of the window follows.
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const LANGUAGES = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  sql: () => import("@shikijs/langs/sql"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const;

/** What people actually write in a fence, mapped to the grammar that renders it. */
const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  js: "typescript",
  javascript: "typescript",
  jsx: "tsx",
  ts: "typescript",
  mjs: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  md: "markdown",
  yml: "yaml",
  patch: "diff",
  rs: "rust",
  scss: "css",
};

const THEMES = ["catppuccin-latte", "catppuccin-mocha"] as [string, string];

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();
const results = new Map<string, unknown>();
const waiting = new Map<string, Set<(result: never) => void>>();

const resolve = (language: string): keyof typeof LANGUAGES | undefined => {
  const name = language.trim().toLowerCase();
  return name in LANGUAGES ? (name as keyof typeof LANGUAGES) : ALIASES[name];
};

function start(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import("@shikijs/themes/catppuccin-latte"), import("@shikijs/themes/catppuccin-mocha")],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

/**
 * Streamdown's contract: return a cached result, or null and call back once the grammar has loaded.
 * A language we do not carry returns null forever, which renders as plain mono text — correct, and
 * the reason the fixed set is safe.
 */
export const highlightPlugin = {
  name: "shiki" as const,
  type: "code-highlighter" as const,
  supportsLanguage: (language: string) => resolve(language) !== undefined,
  getSupportedLanguages: () => Object.keys(LANGUAGES),
  getThemes: () => THEMES,
  highlight(
    { code, language }: { code: string; language: string },
    callback?: (result: never) => void,
  ): never | null {
    const lang = resolve(language);
    if (!lang) return null;
    const key = `${lang}:${code.length}:${code.slice(0, 120)}:${code.slice(-120)}`;
    if (results.has(key)) return results.get(key) as never;
    if (callback) {
      if (!waiting.has(key)) waiting.set(key, new Set());
      waiting.get(key)!.add(callback);
    }
    void start()
      .then(async (shiki) => {
        if (!loaded.has(lang)) {
          await shiki.loadLanguage((await LANGUAGES[lang]()).default);
          loaded.add(lang);
        }
        const result = shiki.codeToTokens(code, { lang, themes: { light: THEMES[0], dark: THEMES[1] } });
        results.set(key, result);
        for (const listener of waiting.get(key) ?? []) listener(result as never);
        waiting.delete(key);
      })
      .catch((error: unknown) => {
        console.error("highlight:", error);
        waiting.delete(key);
      });
    return null;
  },
};
