import { resolveDesiredEntries, type TemplateSource } from "@repository-fanout/core";

// fragment.json で許可されるキー。未知キーは silent-ignore されるため(タイポ非検出が
// 既知の制限だった)、validate で明示的に検出する。
const FRAGMENT_KEYS = new Set(["renovate", "gitignore", "_comment"]);

/**
 * 正本ツリーの検証(spec v2 §6.5)。
 * (1) 全 fragment.json の JSON 妥当性と未知キー検出
 * (2) 描画スモークテスト: base のみ / 各 language 単独 / 各 bundle 単独 / 全部盛り
 * 戻り値はエラーメッセージの配列(空 = 合格)。
 */
export async function validateSource(source: TemplateSource): Promise<string[]> {
  const errors: string[] = [];
  const languages = await source.listNames("languages");
  const bundles = await source.listNames("bundles");

  const fragmentDirs = [
    "base",
    ...languages.map((l) => `languages/${l}`),
    ...bundles.map((b) => `bundles/${b}`),
  ];
  for (const dir of fragmentDirs) {
    let fragment: unknown;
    try {
      fragment = await source.readFragmentManifest(dir);
    } catch (e) {
      errors.push(`${dir}/fragment.json: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (fragment === null || fragment === undefined) continue;
    for (const key of Object.keys(fragment as Record<string, unknown>)) {
      if (!FRAGMENT_KEYS.has(key)) errors.push(`${dir}/fragment.json: unknown key "${key}" (typo?)`);
    }
  }

  const combos: Array<{ label: string; languages: string[]; bundles: string[] }> = [
    { label: "base-only", languages: [], bundles: [] },
    ...languages.map((l) => ({ label: `language:${l}`, languages: [l], bundles: [] as string[] })),
    ...bundles.map((b) => ({ label: `bundle:${b}`, languages: [] as string[], bundles: [b] })),
    { label: "all", languages, bundles },
  ];
  for (const c of combos) {
    try {
      await resolveDesiredEntries({
        source,
        languages: c.languages,
        bundles: c.bundles,
        vars: { codeowner: "validate/dummy" },
        exclude: [],
      });
    } catch (e) {
      errors.push(`render failed [${c.label}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}
