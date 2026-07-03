/** strategies.json で割り当てられる特殊戦略。新しいマージ意味論の追加はコード変更（spec 2026-07-03 §3） */
export type SpecialStrategy = "extends-field" | "managed-block";
export type StrategyConfig = Record<string, SpecialStrategy>;

const SPECIAL_STRATEGIES: ReadonlySet<string> = new Set(["extends-field", "managed-block"]);

/**
 * テンプレリポ直下 strategies.json（配布先パス→戦略）を検証して返す。
 * raw=null（ファイル不在）はエラー：黙って空扱いにすると renovate.json が replace に
 * 降格し、全リポの extends を全文上書きする PR が量産されるため。
 */
export function parseStrategyConfig(raw: string | null): StrategyConfig {
  if (raw === null) throw new Error("strategies.json not found in templates repo");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("strategies.json: invalid JSON");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("strategies.json: must be an object of path -> strategy");
  }
  const out: StrategyConfig = {};
  for (const [path, strategy] of Object.entries(json)) {
    if (typeof strategy !== "string" || !SPECIAL_STRATEGIES.has(strategy)) {
      throw new Error(`strategies.json: unknown strategy for ${path}: ${JSON.stringify(strategy)}`);
    }
    out[path] = strategy as SpecialStrategy;
  }
  return out;
}
