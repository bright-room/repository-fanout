export class RenovateParseError extends Error {
  constructor(readonly cause: unknown) {
    super(`renovate.json is not valid JSON (JSON5/comments unsupported): ${String(cause)}`);
    this.name = "RenovateParseError";
  }
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}

/** 望ましい extends = 管理分（正準順） ++ universe 外のリポ独自エントリ（相対順保持） */
export function mergeExtends(
  actual: string[] | undefined,
  managed: string[],
  universe: string[],
): string[] {
  const universeSet = new Set(universe);
  const repoOwn = (actual ?? []).filter((e) => !universeSet.has(e));
  return dedupePreserveOrder([...managed, ...repoOwn]);
}

/**
 * 実ファイル(JSON文字列)の extends だけを管理ルールで更新した全文を返す。
 * 意味的に同一なら null（no-op。フォーマットも触らない）。パース不能は RenovateParseError。
 */
export function applyExtendsField(
  actualContent: string,
  managed: string[],
  universe: string[],
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(actualContent);
  } catch (e) {
    throw new RenovateParseError(e);
  }
  // トップレベルが object でない（null / 配列 / プリミティブ）renovate.json は不正。
  // ここで弾かないと null→try 外の TypeError（RenovateParseError を逃す）、
  // 配列→managed を黙って握り潰す、等の破損を招く。
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RenovateParseError(new Error("renovate.json top-level must be a JSON object"));
  }
  const obj = parsed as Record<string, unknown>;
  const actualExtends = Array.isArray(obj.extends) ? (obj.extends as unknown[]).map(String) : [];
  const next = mergeExtends(actualExtends, managed, universe);
  if (next.length === actualExtends.length && next.every((v, i) => v === actualExtends[i])) return null;
  obj.extends = next; // JSON.parse は挿入順を保持。既存キー位置は維持される
  return `${JSON.stringify(obj, null, 2)}\n`;
}
