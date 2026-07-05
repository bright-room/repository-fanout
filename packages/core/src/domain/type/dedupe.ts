/** 出現順を保ったまま重複を除去する */
export function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}
