import type { Models } from "../preload/index.ts";

/** A dated snapshot's spec: the alias it pins, then its release date (`anthropic/claude-sonnet-4-5-20250929`). */
const SNAPSHOT = /^(.+)-\d{8}$/;

/**
 * The models the picker lists, from the catalog the agent can run. pi's catalog lists a model twice: the alias
 * that follows its newest snapshot, named "… (latest)", and that snapshot under its date. Side by side they read
 * as if 4.5 were the latest model. One row is listed, the alias, by the model's own name; a snapshot stays listed
 * when it is the conversation's model, so the picker still shows what runs. Presentation only: every model stays
 * runnable, and `send` checks against the full list.
 */
export function pickerModels(models: Models, current?: string): Models {
  const specs = new Set(models.map((model) => model.spec));
  return models
    .filter((model) => {
      const alias = SNAPSHOT.exec(model.spec)?.[1];
      return model.spec === current || !alias || !specs.has(alias);
    })
    .map((model) => (model.name?.endsWith(" (latest)") ? { ...model, name: model.name.slice(0, -" (latest)".length) } : model));
}
