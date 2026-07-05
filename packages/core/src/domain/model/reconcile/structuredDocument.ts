import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { type Document, parseDocument, stringify as stringifyYaml } from "yaml";
import { dedupePreserveOrder } from "../../type/dedupe.js";
import { deepEqual, isPlainObject } from "../../type/object.js";

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

/** RenovateParseError の一般化。パース不能な実ファイルは fail fast(spec v3 §6.2) */
export class StructuredParseError extends Error {
  constructor(
    readonly path: string,
    readonly cause: unknown,
  ) {
    super(`${path} is not parseable: ${String(cause)}`);
    this.name = "StructuredParseError";
  }
}

/** 構造化文書。パース不能な文書のインスタンスは存在しえない(完全コンストラクタ) */
export class StructuredDocument {
  private constructor(
    private readonly fileType: StructuredFileType,
    /** yaml: Document(コメント保持編集用)/ json・toml: パース済み plain object */
    private readonly parsed: Document | Record<string, unknown>,
  ) {}

  static parse(fileType: StructuredFileType, path: string, content: string): StructuredDocument {
    switch (fileType) {
      case "json": {
        let v: unknown;
        try {
          v = JSON.parse(content);
        } catch (e) {
          throw new StructuredParseError(path, e);
        }
        if (!isPlainObject(v)) {
          throw new StructuredParseError(path, new Error("top-level must be a JSON object"));
        }
        return new StructuredDocument(fileType, v);
      }
      case "toml": {
        try {
          // smol-toml の戻り型は TomlPrimitive のため unknown へ広げる(構造は plain object)
          return new StructuredDocument(fileType, parseToml(content) as Record<string, unknown>);
        } catch (e) {
          throw new StructuredParseError(path, e);
        }
      }
      case "yaml": {
        const doc = parseDocument(content);
        if (doc.errors.length > 0) throw new StructuredParseError(path, doc.errors[0]);
        const js: unknown = doc.toJS() ?? {};
        if (!isPlainObject(js)) {
          throw new StructuredParseError(path, new Error("top-level must be a YAML mapping"));
        }
        return new StructuredDocument(fileType, doc);
      }
    }
  }

  /**
   * managed_paths 配下だけマージした全文。意味的に同一なら null
   * (no-op。spec v3 C7: 正規化だけの書き換えをしない)。
   */
  mergedContent(spec: ManagedPathsSpec): string | null {
    // yaml: 空 / コメントのみの文書は toJS() が null を返す(parse は許容済み)。
    // ここで {} に倒さないと生 TypeError になり、per-repo failure でなく
    // Workflow リトライへ化ける(StructuredParseError 経路の invariant 破り)。
    const values =
      this.fileType === "yaml"
        ? (((this.parsed as Document).toJS() as Record<string, unknown> | null) ?? {})
        : (this.parsed as Record<string, unknown>);
    const nextValues = new Map<string, unknown>();
    for (const key of Object.keys(spec.managedPaths)) {
      const next = mergedFor(spec, key, values[key]);
      if (!deepEqual(normalizedCurrent(spec, key, values[key]), next)) nextValues.set(key, next);
    }
    if (nextValues.size === 0) return null;
    switch (this.fileType) {
      case "json": {
        const obj = { ...(this.parsed as Record<string, unknown>) };
        for (const [k, v] of nextValues) obj[k] = v; // JSON.parse は挿入順保持。既存キー位置は維持
        return `${JSON.stringify(obj, null, 2)}\n`;
      }
      case "toml": {
        const obj = { ...(this.parsed as Record<string, unknown>) };
        for (const [k, v] of nextValues) obj[k] = v;
        // 変更があった回だけ全文を正準再描画(コメント・フォーマットは正規化。spec v3 C7)
        return stringifyToml(obj); // smol-toml は末尾改行込みで返す
      }
      case "yaml": {
        const doc = this.parsed as Document;
        for (const [k, v] of nextValues) doc.set(k, v); // 対象パス外のコメントは保持される
        return doc.toString();
      }
    }
  }

  /**
   * ファイル不在時の新規作成内容(spec v3 §6.2)。
   * skeleton(template 宣言時の描画結果)があればそこへマージ、無ければ管理データのみで正準生成。
   */
  static createContent(
    fileType: StructuredFileType,
    path: string,
    spec: ManagedPathsSpec,
    skeleton?: string,
  ): string {
    if (skeleton !== undefined) {
      return StructuredDocument.parse(fileType, path, skeleton).mergedContent(spec) ?? skeleton;
    }
    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(spec.managedPaths)) obj[key] = mergedFor(spec, key, undefined);
    switch (fileType) {
      case "json":
        return `${JSON.stringify(obj, null, 2)}\n`;
      case "toml":
        return stringifyToml(obj); // smol-toml は末尾改行込みで返す
      case "yaml":
        return stringifyYaml(obj);
    }
  }
}

function mergedFor(spec: ManagedPathsSpec, key: string, actualValue: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  const universe = spec.universe[key] ?? [];
  return s.merge === "array"
    ? mergeManagedArray(actualValue, spec.data[key], universe)
    : mergeManagedTable(actualValue, spec.data[key], universe);
}

/** no-op 判定用: 実ファイル側の現在値をマージ結果と同じ形へ正準化して比較 */
function normalizedCurrent(spec: ManagedPathsSpec, key: string, value: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  if (s.merge === "array") return normalizeToArray(value);
  return isPlainObject(value) ? value : {};
}
