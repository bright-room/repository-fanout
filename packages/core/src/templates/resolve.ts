import { dedupePreserveOrder } from "../util/dedupe.js";
import { renderGitignore, substituteVars } from "./render.js";
import { parseStrategyConfig } from "./strategyConfig.js";
import type { DesiredEntry, FragmentManifest, TemplateSource } from "./types.js";

export interface ResolveArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  vars: Record<string, string>;
  exclude: string[];
}

function destPath(fullPath: string): string {
  return fullPath
    .replace(/^base\/files\//, "")
    .replace(/^languages\/[^/]+\/files\//, "")
    .replace(/^bundles\/[^/]+\/files\//, "")
    .replace(/^seeds\//, "");
}

export async function resolveDesiredEntries(args: ResolveArgs): Promise<DesiredEntry[]> {
  const { source } = args;

  // 0. strategies.json（不在は fail fast。spec 2026-07-03 §3）
  // 注: TemplateSource.readFile は取得失敗を一律 null にするため、一時的な API エラーも
  // 「不在」と同じエラーになる（リトライは Workflows の step リトライに委ねる）。
  const strategies = parseStrategyConfig(await source.readFile("strategies.json"));

  // 1. 未知 language / bundle はエラー
  for (const lang of args.languages) {
    if (!(await source.nameExists("languages", lang))) throw new Error(`unknown language: ${lang}`);
  }
  for (const bundle of args.bundles) {
    if (!(await source.nameExists("bundles", bundle))) throw new Error(`unknown bundle: ${bundle}`);
  }

  // 2. fragment 収集：宣言分（base→languages 宣言順→bundles 宣言順）と全 language/bundle（universe 用）
  const baseFragment = (await source.readFragmentManifest("base")) ?? {};
  const declared: FragmentManifest[] = [baseFragment];
  for (const lang of args.languages) {
    declared.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }
  for (const bundle of args.bundles) {
    declared.push((await source.readFragmentManifest(`bundles/${bundle}`)) ?? {});
  }
  const allLangs = await source.listNames("languages");
  const allBundles = await source.listNames("bundles");
  const all: FragmentManifest[] = [baseFragment];
  for (const lang of allLangs) {
    all.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }
  for (const bundle of allBundles) {
    all.push((await source.readFragmentManifest(`bundles/${bundle}`)) ?? {});
  }

  const managedExtends = dedupePreserveOrder(declared.flatMap((f) => f.renovate ?? []));
  const universe = dedupePreserveOrder(all.flatMap((f) => f.renovate ?? []));
  const gitignoreBlock = renderGitignore(declared.map((f) => f.gitignore ?? []));

  // 3. ファイル収集（衝突検出）
  const groups: Array<{ prefix: string; seeds: boolean }> = [
    { prefix: "base/files/", seeds: false },
    { prefix: "seeds/", seeds: true },
    ...args.languages.map((l) => ({ prefix: `languages/${l}/files/`, seeds: false })),
    ...args.bundles.map((b) => ({ prefix: `bundles/${b}/files/`, seeds: false })),
  ];

  const byDest = new Map<string, DesiredEntry>();
  const owner = new Map<string, string>();

  for (const { prefix, seeds } of groups) {
    for (const full of await source.listFiles(prefix)) {
      const dest = destPath(full);
      if (byDest.has(dest)) {
        throw new Error(`path collision: ${dest} provided by ${owner.get(dest)} and ${prefix}`);
      }
      const raw = await source.readFile(full);
      if (raw === null) continue;

      let entry: DesiredEntry;
      const special = seeds ? undefined : strategies[dest];
      if (special === "extends-field") {
        // 関数置換で $ パターン（$&, $$, $`, $n 等）の展開を避け、値を逐語挿入する。
        const createContent = substituteVars(
          raw.replace("{{renovate_extends}}", () =>
            managedExtends.map((e) => JSON.stringify(e)).join(", "),
          ),
          args.vars,
        );
        entry = { strategy: "extends-field", path: dest, managedExtends, universe, createContent };
      } else if (special === "managed-block") {
        const rendered = substituteVars(
          raw.replace("{{gitignore}}", () => gitignoreBlock),
          args.vars,
        );
        entry = {
          strategy: "managed-block",
          path: dest,
          blockContent: rendered.replace(/\n$/, ""),
        };
      } else {
        const content = substituteVars(raw, args.vars);
        entry = seeds
          ? { strategy: "create-only", path: dest, content }
          : { strategy: "replace", path: dest, content };
      }
      byDest.set(dest, entry);
      owner.set(dest, prefix);
    }
  }

  for (const ex of args.exclude) byDest.delete(ex);
  return [...byDest.values()];
}
