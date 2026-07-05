import { Catalog, parseYaml, resolveDesired, type TemplateSource } from "@repository-fanout/core";

/**
 * 描画後の GitHub 用 YAML(Issue フォーム / chooser 設定)の構造検証。
 * これらは GitHub が読むファイルなので、描画結果がパースでき最低限の必須キーを持つことを
 * validate で担保する(実 canonical をデプロイせず守る)。問題があればメッセージ、無ければ null。
 */
export function checkRenderedGithubYaml(path: string, content: string): string | null {
  if (!path.endsWith(".yaml") && !path.endsWith(".yml")) return null;
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (e) {
    return `invalid YAML: ${e instanceof Error ? e.message : String(e)}`;
  }
  // ISSUE_TEMPLATE 以外の yaml(release.yaml 等)は「パースできる」ことだけ担保
  if (!path.startsWith(".github/ISSUE_TEMPLATE/")) return null;

  const isMapping = typeof doc === "object" && doc !== null && !Array.isArray(doc);
  if (/\/config\.(yml|yaml)$/.test(path)) {
    if (!isMapping) return "issue chooser config must be a YAML mapping";
    const cfg = doc as Record<string, unknown>;
    if (cfg.blank_issues_enabled !== undefined && typeof cfg.blank_issues_enabled !== "boolean") {
      return "config.blank_issues_enabled must be a boolean";
    }
    if (cfg.contact_links !== undefined) {
      if (!Array.isArray(cfg.contact_links)) return "config.contact_links must be a list";
      for (const link of cfg.contact_links) {
        if (typeof link !== "object" || link === null) return "each contact_link must be a mapping";
        for (const k of ["name", "url", "about"]) {
          if (typeof (link as Record<string, unknown>)[k] !== "string") {
            return `contact_link.${k} must be a string`;
          }
        }
      }
    }
    return null;
  }
  // issue form: name(非空 string) + body(非空 list)
  if (!isMapping) return "issue form must be a YAML mapping";
  const form = doc as Record<string, unknown>;
  if (typeof form.name !== "string" || form.name.length === 0) {
    return "issue form must have a non-empty 'name'";
  }
  if (!Array.isArray(form.body) || form.body.length === 0) {
    return "issue form 'body' must be a non-empty list";
  }
  return null;
}

/**
 * 正本ツリー(v3 レイアウト)の検証(spec v3 §10)。catalog / contributes / template の
 * 整合は resolver 自体が fail fast するので、全 profile 組合せの描画スモークを回し、
 * さらに描画後の GitHub 用 YAML(Issue フォーム / config)を構造検証する。
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
    let files: Awaited<ReturnType<typeof resolveDesired>>;
    try {
      files = await resolveDesired({
        source,
        languages: c.languages,
        bundles: [],
        vars: { codeowner: "validate/dummy", license_holder: "validate/dummy" },
        exclude: [],
      });
    } catch (e) {
      errors.push(`render failed [${c.label}]: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const f of files) {
      if ("content" in f) {
        const problem = checkRenderedGithubYaml(f.path, f.content);
        if (problem) errors.push(`invalid rendered file [${c.label}] ${f.path}: ${problem}`);
      }
    }
  }
  return errors;
}
