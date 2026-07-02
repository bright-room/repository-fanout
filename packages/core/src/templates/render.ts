import type { GitignoreSection } from "./types.js";

/**
 * .gitignore の {{gitignore}} に入れるテキストを作る。
 * 各セクションは見出しコメント（`section_comment` に "# " を自動付与）+ 無視パターンで描画し、
 * セクション間は空行1つで区切る。無視パターンは全セクション横断で重複除去（初出優先）。
 * 除去後に空になったセクションは見出しごと省く。
 */
export function renderGitignore(contributions: GitignoreSection[][]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const section of contributions.flat()) {
    const fresh: string[] = [];
    for (const ig of section.ignores) {
      if (seen.has(ig)) continue;
      seen.add(ig);
      fresh.push(ig);
    }
    if (fresh.length === 0) continue;
    const lines = section.section_comment ? [`# ${section.section_comment}`, ...fresh] : fresh;
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/** {{key}} を vars で置換。未知プレースホルダはそのまま残す */
export function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key]! : whole,
  );
}
