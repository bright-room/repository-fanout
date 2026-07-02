function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) { seen.add(it); out.push(it); }
  }
  return out;
}

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
