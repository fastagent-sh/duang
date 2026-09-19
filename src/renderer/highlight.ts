/**
 * Syntax highlighting for the agent's code.
 *
 * Shiki's own bundle carries every grammar it knows — 12 MB across 300 chunks in this app's build,
 * for languages an agent directory will never hold. This loads the core plus the thirteen a coding
 * agent actually writes, each grammar fetched the first time it appears.
 *
 * Themes are Catppuccin: Mocha leans violet like the accent, Latte is its real light counterpart, so
 * both colour modes come from one family. Shiki emits the dark colour as `--shiki-dark` on each
 * token, and one CSS rule under `prefers-color-scheme: dark` swaps to it.
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export interface Token {
  content: string;
  htmlStyle?: Record<string, string>;
}

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

type Language = keyof typeof LANGUAGES;

/** What people write in a fence, mapped to the grammar that renders it. */
const ALIASES: Record<string, Language> = {
  console: "bash",
  javascript: "tsx",
  js: "tsx",
  jsx: "tsx",
  md: "markdown",
  mjs: "typescript",
  patch: "diff",
  py: "python",
  rs: "rust",
  scss: "css",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

let core: Promise<HighlighterCore> | undefined;
const loaded = new Set<Language>();

function resolve(language: string): Language | undefined {
  const name = language.trim().toLowerCase();
  return name in LANGUAGES ? (name as Language) : ALIASES[name];
}

/**
 * Tokens for this code, or undefined for a language we do not carry — which renders as plain mono
 * text, and is why the fixed set is safe rather than a gap.
 */
export async function highlight(code: string, language: string): Promise<Token[][] | undefined> {
  const lang = resolve(language);
  if (!lang) return undefined;
  core ??= createHighlighterCore({
    themes: [import("@shikijs/themes/catppuccin-latte"), import("@shikijs/themes/catppuccin-mocha")],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const shiki = await core;
  if (!loaded.has(lang)) {
    await shiki.loadLanguage((await LANGUAGES[lang]()).default);
    loaded.add(lang);
  }
  return shiki.codeToTokens(code, {
    lang,
    themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  }).tokens as Token[][];
}
