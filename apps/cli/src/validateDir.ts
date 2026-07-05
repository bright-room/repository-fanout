import { Catalog, resolveDesired, type TemplateSource } from "@repository-fanout/core";

/**
 * 正本ツリー(v3 レイアウト)の検証(spec v3 §10)。catalog / contributes / template の
 * 整合は resolver 自体が fail fast するので、全 profile 組合せの描画スモークを回す。
 * 戻り値はエラーメッセージの配列(空 = 合格)。
 */
export async function validateSource(source: TemplateSource): Promise<string[]> {
  const errors: string[] = [];
  try {
    Catalog.parse(await source.readFile("catalog.json"));
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  const profiles = new Set<string>();
  for (const p of await source.listFiles("profiles/")) {
    const m = /^profiles\/([^/]+)\//.exec(p);
    if (m?.[1] && m[1] !== "base") profiles.add(m[1]);
  }
  const names = [...profiles].sort();
  const combos: Array<{ label: string; languages: string[] }> = [
    { label: "base-only", languages: [] },
    ...names.map((n) => ({ label: `profile:${n}`, languages: [n] })),
    { label: "all", languages: names },
  ];
  for (const c of combos) {
    try {
      await resolveDesired({
        source,
        languages: c.languages,
        bundles: [],
        vars: { codeowner: "validate/dummy" },
        exclude: [],
      });
    } catch (e) {
      errors.push(`render failed [${c.label}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}
