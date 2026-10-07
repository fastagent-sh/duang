import type { Models } from "../preload/index.ts";

const SNAPSHOT = /^(.+)-(\d{4})(\d{2})(\d{2})$/;
const LATEST = " (latest)";

export const providerOf = (spec: string) => spec.slice(0, spec.indexOf("/"));
export const modelIdOf = (spec: string) => spec.slice(spec.indexOf("/") + 1);

// pi lists some models twice: the "(latest)" alias and its dated snapshot, which side by side read as if the
// older were newest. Presentation only: every model stays runnable.
export function pickerModels(models: Models, current?: string): Models {
  const specs = new Set(models.map((model) => model.spec));
  const listed = models.flatMap((model) => {
    const snapshot = SNAPSHOT.exec(model.spec);
    if (!snapshot || !specs.has(snapshot[1]!)) return [model];
    if (model.spec !== current) return [];
    const [, , year, month, day] = snapshot;
    return [{ ...model, name: `${model.name ?? modelIdOf(model.spec)} (${year}-${month}-${day})` }];
  });
  const names = new Map<string, number>();
  for (const { spec, name } of listed) {
    const key = `${providerOf(spec)}\n${name?.endsWith(LATEST) ? name.slice(0, -LATEST.length) : name}`;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return listed.map((model) => {
    if (!model.name?.endsWith(LATEST)) return model;
    const name = model.name.slice(0, -LATEST.length);
    return names.get(`${providerOf(model.spec)}\n${name}`) === 1 ? { ...model, name } : model;
  });
}
