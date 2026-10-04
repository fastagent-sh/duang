import type { Models } from "../preload/index.ts";

/** A dated snapshot's spec: the alias it pins, then its release date (`anthropic/claude-sonnet-4-5-20250929`). */
const SNAPSHOT = /^(.+)-(\d{4})(\d{2})(\d{2})$/;
const LATEST = " (latest)";

/**
 * The models the picker lists, from the catalog the agent can run. pi's catalog lists some models twice: the
 * alias that follows the newest snapshot, named "… (latest)", and that snapshot under its date. Side by side
 * they read as if 4.5 were the newest model. The snapshot of a listed alias is not listed, unless it is the
 * conversation's model, when it is named with its date so the two rows differ. "(latest)" is dropped from a
 * name wherever the name stays unique in its provider without it; where another row already has that name it
 * stays, since it is then what tells them apart. Presentation only: every model stays runnable, and `send`
 * checks against the full list.
 */
export function pickerModels(models: Models, current?: string): Models {
  const specs = new Set(models.map((model) => model.spec));
  const listed = models.flatMap((model) => {
    const snapshot = SNAPSHOT.exec(model.spec);
    if (!snapshot || !specs.has(snapshot[1]!)) return [model];
    if (model.spec !== current) return [];
    const [, , year, month, day] = snapshot;
    return [{ ...model, name: `${model.name ?? model.spec.slice(model.spec.indexOf("/") + 1)} (${year}-${month}-${day})` }];
  });
  const provider = (spec: string) => spec.slice(0, spec.indexOf("/"));
  const names = new Map<string, number>();
  for (const { spec, name } of listed) {
    const key = `${provider(spec)}\n${name?.endsWith(LATEST) ? name.slice(0, -LATEST.length) : name}`;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return listed.map((model) => {
    if (!model.name?.endsWith(LATEST)) return model;
    const name = model.name.slice(0, -LATEST.length);
    return names.get(`${provider(model.spec)}\n${name}`) === 1 ? { ...model, name } : model;
  });
}
