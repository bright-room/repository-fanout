import { dedupePreserveOrder } from "../../type/dedupe.js";
import { isPlainObject } from "../../type/object.js";

export type StructuredFileType = "json" | "yaml" | "toml";
export type MergeKind = "array" | "table";

export interface ManagedPathSpec {
  merge: MergeKind;
}

/** managed_paths 適用に必要な一式(DesiredFileData に載る plain 部分) */
export interface ManagedPathsSpec {
  managedPaths: Record<string, ManagedPathSpec>;
  /** managed path → 選択 profile の寄与マージ結果 */
  data: Record<string, unknown>;
  /** managed path → universe(array: エントリ集合 / table: キー集合)。全 profile 由来 */
  universe: Record<string, string[]>;
}

/** renovate の extends 文字列形と同様、文字列単体も配列へ正準化 */
export function normalizeToArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

/**
 * merge: "array"(spec v3 §6.2)。mergeExtends の一般化:
 * 望ましい値 = 管理エントリ(正準順) ++ universe 外のリポ独自エントリ(相対順保持)
 */
export function mergeManagedArray(actual: unknown, managed: unknown, universe: string[]): string[] {
  const universeSet = new Set(universe);
  const repoOwn = normalizeToArray(actual).filter((e) => !universeSet.has(e));
  return dedupePreserveOrder([...normalizeToArray(managed), ...repoOwn]);
}

/**
 * merge: "table"(spec v3 §6.2)。管理キーは寄与値、universe 外のリポ独自キーは温存。
 * 寄与が消えた universe キーは削除(retraction)。
 */
export function mergeManagedTable(
  actual: unknown,
  managed: unknown,
  universe: string[],
): Record<string, unknown> {
  const universeSet = new Set(universe);
  const out: Record<string, unknown> = isPlainObject(managed) ? { ...managed } : {};
  if (isPlainObject(actual)) {
    for (const [key, value] of Object.entries(actual)) {
      if (!universeSet.has(key) && !(key in out)) out[key] = value;
    }
  }
  return out;
}
