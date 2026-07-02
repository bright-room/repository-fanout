import { dedupePreserveOrder } from "../util/dedupe.js";

/** .gitignore の {{gitignore}} に入れる改行区切りテキストを作る */
export function renderGitignore(contributions: string[][]): string {
  return dedupePreserveOrder(contributions.flat()).join("\n");
}

/** {{key}} を vars で置換。未知プレースホルダはそのまま残す */
export function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key]! : whole,
  );
}
