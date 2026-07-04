# v3-P1: core v3 エンジン(catalog/profiles/Liquid/構造マージ)実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [v3 spec](../specs/2026-07-05-catalog-profiles-design.md) の P-a — catalog.json / profiles / templates を読む v3 resolver を core に実装し、catalog.json の有無で新旧 resolver を自動切替する(旧経路は無傷で並存)。

**Architecture:** 新モジュール `packages/core/src/catalog/`(catalog 解析・寄与マージ・Liquid 描画・v3 resolve)と `packages/core/src/reconcile/structuredManaged.ts`(json/yaml/toml の構造マージ = extends-field の一般化)を追加。`DesiredEntry` に `structured-managed` / `structured-managed-retract` を追加し `computeChanges` を拡張。worker/cli は `resolveDesired`(auto dispatch)を呼ぶだけに変更。canonical-files 側の変換は P-b(別プラン)。

**Tech Stack:** TypeScript / vitest / LiquidJS(strict モード)/ yaml(eemeli 版・コメント保持)/ smol-toml。すべて pure JS(Workers の eval 禁止と両立)。

**検証コマンド(全タスク共通):**
- core 単体: `pnpm --filter @repository-fanout/core exec vitest run <testfile>`
- 全テスト: `pnpm test` / 型: `pnpm typecheck` / lint: `pnpm lint:fix`(リポルートで)

**規約:** コミットは 1 タスク 1 コミット。コメントは既存コード同様「制約・理由」のみ日本語で。spec 参照は「spec v3 §N」形式。

---

### Task 1: 依存追加 + util/object.ts(isPlainObject / deepEqual)

**Files:**
- Modify: `packages/core/package.json`(dependencies 追加)
- Create: `packages/core/src/util/object.ts`
- Test: `packages/core/test/util/object.test.ts`

- [ ] **Step 1: 依存を追加**

```bash
cd packages/core
pnpm add liquidjs yaml smol-toml
```

3 つとも pure JS であること(採用条件。spec v3 §7)。`pnpm --filter @repository-fanout/core typecheck` が通ることを確認。

- [ ] **Step 2: 失敗するテストを書く**

`packages/core/test/util/object.test.ts`:

```ts
import { expect, test } from "vitest";
import { deepEqual, isPlainObject } from "../../src/util/object.js";

test("isPlainObject: object のみ true(null / 配列 / プリミティブは false)", () => {
  expect(isPlainObject({})).toBe(true);
  expect(isPlainObject({ a: 1 })).toBe(true);
  expect(isPlainObject(null)).toBe(false);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject("x")).toBe(false);
  expect(isPlainObject(undefined)).toBe(false);
});

test("deepEqual: キー順に依存しない構造比較", () => {
  expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
  expect(deepEqual({ a: { x: "1" } }, { a: { x: "1" } })).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(deepEqual([1, 2], [2, 1])).toBe(false); // 配列は順序込み
  expect(deepEqual("a", "a")).toBe(true);
  expect(deepEqual(1, "1")).toBe(false);
});
```

- [ ] **Step 3: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/util/object.test.ts`
Expected: FAIL(module not found)

- [ ] **Step 4: 実装**

`packages/core/src/util/object.ts`:

```ts
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * JSON 値の構造比較(オブジェクトのキー順に依存しない)。
 * 構造マージの no-op 判定(spec v3 C7: 意味的無変更ならファイルに触らない)用。
 * JSON.stringify 比較だとキー順差で false negative になり、無意味な再描画 PR を生むため。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}
```

- [ ] **Step 5: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/util/object.test.ts` → PASS

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/util/object.ts packages/core/test/util/object.test.ts
git commit -m "feat(core): v3 依存(liquidjs/yaml/smol-toml)と構造比較ユーティリティを追加"
```

---

### Task 2: catalog/types.ts + parseCatalog

**Files:**
- Create: `packages/core/src/catalog/types.ts`
- Create: `packages/core/src/catalog/parse.ts`
- Test: `packages/core/test/catalog/parse.test.ts`

- [ ] **Step 1: 型定義を書く**

`packages/core/src/catalog/types.ts`:

```ts
/** catalog.json(spec v3 §4.1)の語彙 */
export type FileType = "text" | "markdown" | "json" | "yaml" | "toml";
export type FileMode = "replaced" | "create-only" | "managed";
export type MergeKind = "array" | "table";
export type StructuredFileType = "json" | "yaml" | "toml";

export interface ManagedPathSpec {
  merge: MergeKind;
}

export interface CatalogEntry {
  file_type: FileType;
  mode: FileMode;
  /** mode=managed かつ構造化 file_type で必須。管理するトップレベルパス → マージ種別 */
  managed_paths?: Record<string, ManagedPathSpec>;
  /** true で Liquid 描画をスキップし逐語コピー(spec v3 C11: `${{ }}` 対策) */
  raw?: boolean;
}

export interface Catalog {
  files: Record<string, CatalogEntry>;
}

/** profile の 1 パスへの寄与。"template" は予約キー(spec v3 §4.2) */
export type Contribution = Record<string, unknown>;
export type ContributesManifest = Record<string, Contribution>;
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/core/test/catalog/parse.test.ts`:

```ts
import { expect, test } from "vitest";
import { parseCatalog } from "../../src/catalog/parse.js";

const VALID = JSON.stringify({
  files: {
    ".gitignore": { file_type: "text", mode: "managed" },
    "renovate.json": {
      file_type: "json",
      mode: "managed",
      managed_paths: { extends: { merge: "array" } },
    },
    "mise.toml": { file_type: "toml", mode: "managed", managed_paths: { tools: { merge: "table" } } },
    "SECURITY.md": { file_type: "markdown", mode: "replaced" },
    "CONTRIBUTING.md": { file_type: "markdown", mode: "create-only", raw: true },
  },
});

test("妥当な catalog を返す", () => {
  const c = parseCatalog(VALID);
  expect(Object.keys(c.files)).toHaveLength(5);
  expect(c.files["renovate.json"]?.managed_paths?.extends?.merge).toBe("array");
});

test("不在(null)は fail fast", () => {
  expect(() => parseCatalog(null)).toThrow(/catalog\.json not found/);
});

test("不正 JSON / files 不在 / 空 files はエラー", () => {
  expect(() => parseCatalog("{oops")).toThrow(/invalid JSON/);
  expect(() => parseCatalog("[]")).toThrow(/must be an object/);
  expect(() => parseCatalog('{"files":{}}')).toThrow(/must not be empty/);
});

test("未知の file_type / mode はエラー", () => {
  expect(() =>
    parseCatalog('{"files":{"a":{"file_type":"ini","mode":"replaced"}}}'),
  ).toThrow(/unknown file_type/);
  expect(() =>
    parseCatalog('{"files":{"a":{"file_type":"text","mode":"sync"}}}'),
  ).toThrow(/unknown mode/);
});

test("構造化 managed は managed_paths 必須、非対象への指定はエラー", () => {
  expect(() =>
    parseCatalog('{"files":{"a.json":{"file_type":"json","mode":"managed"}}}'),
  ).toThrow(/requires managed_paths/);
  expect(() =>
    parseCatalog(
      '{"files":{"a.txt":{"file_type":"text","mode":"managed","managed_paths":{"x":{"merge":"array"}}}}}',
    ),
  ).toThrow(/only for managed structured/);
  expect(() =>
    parseCatalog(
      '{"files":{"a.json":{"file_type":"json","mode":"managed","managed_paths":{"x":{"merge":"deep"}}}}}',
    ),
  ).toThrow(/merge must be/);
});

test('"_" 始まりのキーはコメントとして無視', () => {
  const c = parseCatalog(
    '{"files":{"_comment":"note",".gitignore":{"file_type":"text","mode":"managed"}}}',
  );
  expect(Object.keys(c.files)).toEqual([".gitignore"]);
});
```

- [ ] **Step 3: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/parse.test.ts` → FAIL

- [ ] **Step 4: 実装**

`packages/core/src/catalog/parse.ts`:

```ts
import { isPlainObject } from "../util/object.js";
import type { Catalog, CatalogEntry } from "./types.js";

const FILE_TYPES = new Set(["text", "markdown", "json", "yaml", "toml"]);
const MODES = new Set(["replaced", "create-only", "managed"]);
const MERGE_KINDS = new Set(["array", "table"]);
const STRUCTURED = new Set(["json", "yaml", "toml"]);

/**
 * catalog.json(spec v3 §4.1)を検証して返す。raw=null(不在)はエラー:
 * strategies.json 不在 fail fast(v2)の後継。「書いてなければ replace」の暗黙を認めない。
 */
export function parseCatalog(raw: string | null): Catalog {
  if (raw === null) throw new Error("catalog.json not found in templates repo");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`catalog.json: invalid JSON: ${(e as Error).message}`);
  }
  if (!isPlainObject(json) || !isPlainObject(json.files)) {
    throw new Error('catalog.json: must be an object with a "files" object');
  }
  const files: Record<string, CatalogEntry> = {};
  for (const [path, v] of Object.entries(json.files)) {
    if (path.startsWith("_")) continue; // _comment 等の運用コメント
    files[path] = parseEntry(path, v);
  }
  if (Object.keys(files).length === 0) throw new Error("catalog.json: files must not be empty");
  return { files };
}

function parseEntry(path: string, v: unknown): CatalogEntry {
  if (!isPlainObject(v)) throw new Error(`catalog.json: ${path}: must be an object`);
  const { file_type, mode, managed_paths, raw } = v;
  if (typeof file_type !== "string" || !FILE_TYPES.has(file_type)) {
    throw new Error(`catalog.json: ${path}: unknown file_type: ${JSON.stringify(file_type)}`);
  }
  if (typeof mode !== "string" || !MODES.has(mode)) {
    throw new Error(`catalog.json: ${path}: unknown mode: ${JSON.stringify(mode)}`);
  }
  if (mode === "managed" && STRUCTURED.has(file_type)) {
    if (!isPlainObject(managed_paths) || Object.keys(managed_paths).length === 0) {
      throw new Error(`catalog.json: ${path}: managed structured file requires managed_paths`);
    }
    for (const [key, spec] of Object.entries(managed_paths)) {
      if (!isPlainObject(spec) || typeof spec.merge !== "string" || !MERGE_KINDS.has(spec.merge)) {
        throw new Error(`catalog.json: ${path}: managed_paths.${key}: merge must be "array" | "table"`);
      }
    }
  } else if (managed_paths !== undefined) {
    throw new Error(`catalog.json: ${path}: managed_paths is only for managed structured files`);
  }
  if (raw !== undefined && typeof raw !== "boolean") {
    throw new Error(`catalog.json: ${path}: raw must be boolean`);
  }
  return v as unknown as CatalogEntry;
}
```

- [ ] **Step 5: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/parse.test.ts` → PASS

```bash
git add packages/core/src/catalog packages/core/test/catalog
git commit -m "feat(core): catalog.json のパースと検証(spec v3 §4.1)"
```

---

### Task 3: 寄与データのマージ(mergeContributionData)

**Files:**
- Create: `packages/core/src/catalog/merge.ts`
- Test: `packages/core/test/catalog/merge.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/catalog/merge.test.ts`:

```ts
import { expect, test } from "vitest";
import { mergeContributionData } from "../../src/catalog/merge.js";

test("配列は宣言順に concat(gitignore sections のユースケース)", () => {
  const merged = mergeContributionData([
    { sections: [{ comment: "base", ignores: [".DS_Store"] }] },
    { sections: [{ comment: "node", ignores: ["node_modules/"] }] },
  ]);
  expect(merged.sections).toEqual([
    { comment: "base", ignores: [".DS_Store"] },
    { comment: "node", ignores: ["node_modules/"] },
  ]);
});

test("オブジェクトは deep merge(後勝ち)、スカラは上書き", () => {
  const merged = mergeContributionData([
    { tools: { node: "20", pnpm: "9" }, label: "a" },
    { tools: { node: "22" }, label: "b" },
  ]);
  expect(merged.tools).toEqual({ node: "22", pnpm: "9" });
  expect(merged.label).toBe("b");
});

test("入力オブジェクトを破壊しない", () => {
  const a = { sections: [{ ignores: ["x"] }] };
  const b = { sections: [{ ignores: ["y"] }] };
  mergeContributionData([a, b]);
  expect(a.sections).toHaveLength(1);
  expect(b.sections).toHaveLength(1);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/merge.test.ts` → FAIL

- [ ] **Step 3: 実装**

`packages/core/src/catalog/merge.ts`:

```ts
import { isPlainObject } from "../util/object.js";

/**
 * 選択 profile の寄与を宣言順(base → languages 宣言順 → bundles 宣言順)にマージする
 * (spec v3 §4.2)。配列 = concat(順序が意味を持つ: gitignore セクション等)、
 * オブジェクト = deep merge(後勝ち: language が base の値を上書きできる)、スカラ = 上書き。
 */
export function mergeContributionData(
  items: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) mergeInto(out, item);
  return out;
}

function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(src)) {
    const prev = target[key];
    if (Array.isArray(prev) && Array.isArray(value)) {
      target[key] = [...prev, ...value];
    } else if (isPlainObject(prev) && isPlainObject(value)) {
      const copy = { ...prev };
      mergeInto(copy, value);
      target[key] = copy;
    } else if (Array.isArray(value)) {
      target[key] = [...value];
    } else if (isPlainObject(value)) {
      const copy: Record<string, unknown> = {};
      mergeInto(copy, value);
      target[key] = copy;
    } else {
      target[key] = value;
    }
  }
}
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/merge.test.ts` → PASS

```bash
git add packages/core/src/catalog/merge.ts packages/core/test/catalog/merge.test.ts
git commit -m "feat(core): profile 寄与データのマージ(spec v3 §4.2)"
```

---

### Task 4: Liquid エンジン(strict + cross_dedupe)

**Files:**
- Create: `packages/core/src/catalog/liquid.ts`
- Test: `packages/core/test/catalog/liquid.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/catalog/liquid.test.ts`:

```ts
import { expect, test } from "vitest";
import { createLiquid, crossDedupe, renderLiquid } from "../../src/catalog/liquid.js";
import { renderGitignore } from "../../src/templates/render.js";

const CTX = { contributions: {}, contents: {}, repo: "", account: "" };

test("変数展開と contents 参照", async () => {
  const out = await renderLiquid(createLiquid(), "* {{ contents.codeowner }}", {
    ...CTX,
    contents: { codeowner: "@org/team" },
  });
  expect(out).toBe("* @org/team");
});

test("未定義変数はエラー(strict。unresolved placeholder 検出の後継)", async () => {
  await expect(renderLiquid(createLiquid(), "* {{ contents.codeowner }}", CTX)).rejects.toThrow();
});

test("cross_dedupe: セクション横断 dedupe(初出優先)+ 空セクション削除", () => {
  const out = crossDedupe(
    [
      { comment: "a", ignores: ["x", "y"] },
      { comment: "b", ignores: ["y"] },
      { comment: "c", ignores: ["y", "z"] },
    ],
    "ignores",
  );
  expect(out).toEqual([
    { comment: "a", ignores: ["x", "y"] },
    { comment: "c", ignores: ["z"] },
  ]);
});

// gitignore.liquid の正準形。P-b(canonical-files 変換)でこのテンプレートを使うと
// v2 renderGitignore とバイト一致することを固定する(マーカーブロック差分による
// 全リポ一斉 PR を防ぐため、このテストが等価性の根拠になる)。
export const GITIGNORE_LIQUID = `{% capture nl %}
{% endcapture %}{% capture sep %}{{ nl }}{{ nl }}{% endcapture %}{% assign sections = contributions.sections | cross_dedupe: "ignores" %}{% capture out %}{% for s in sections %}### {{ s.comment }} ###{{ nl }}{{ s.ignores | join: nl }}{% unless forloop.last %}{{ sep }}{% endunless %}{% endfor %}{% endcapture %}{{ out }}`;

test("gitignore.liquid の描画結果が v2 renderGitignore とバイト一致", async () => {
  const sections = [
    { comment: "base", ignores: [".DS_Store", "*.log"] },
    { comment: "node", ignores: ["node_modules/", "*.log"] }, // *.log は横断 dedupe される
    { comment: "empty", ignores: ["*.log"] }, // 空になりセクションごと消える
  ];
  const legacy = renderGitignore([
    sections.map((s) => ({ section_comment: s.comment, ignores: s.ignores })),
  ]);
  const v3 = await renderLiquid(createLiquid(), GITIGNORE_LIQUID, {
    ...CTX,
    contributions: { sections },
  });
  expect(v3).toBe(legacy);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/liquid.test.ts` → FAIL

- [ ] **Step 3: 実装**

`packages/core/src/catalog/liquid.ts`:

```ts
import { Liquid } from "liquidjs";
import { isPlainObject } from "../util/object.js";

export interface RenderContext {
  contributions: Record<string, unknown>;
  contents: Record<string, string>;
  repo: string;
  account: string;
}

/**
 * v3 テンプレートエンジン(spec v3 §5)。strict 必須:
 * 未定義変数の黙殺は「`* @{{codeowner}}` のまま配布」(kukv PR#63)の再発経路になる。
 */
export function createLiquid(): Liquid {
  const engine = new Liquid({ strictVariables: true, strictFilters: true });
  engine.registerFilter("cross_dedupe", crossDedupe);
  return engine;
}

/**
 * セクション横断 dedupe(初出優先)+ 空になったセクションの削除。
 * v2 renderGitignore の意味論をフィルタ化したもの(spec v3 §5)。
 */
export function crossDedupe(
  sections: unknown,
  listKey: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const s of sections) {
    if (!isPlainObject(s)) continue;
    const items = s[listKey];
    if (!Array.isArray(items)) continue;
    const fresh = items.filter((i): i is string => typeof i === "string" && !seen.has(i));
    for (const f of fresh) seen.add(f);
    if (fresh.length === 0) continue;
    out.push({ ...s, [listKey]: fresh });
  }
  return out;
}

export async function renderLiquid(
  engine: Liquid,
  template: string,
  ctx: RenderContext,
): Promise<string> {
  return await engine.parseAndRender(template, ctx);
}
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/liquid.test.ts` → PASS

```bash
git add packages/core/src/catalog/liquid.ts packages/core/test/catalog/liquid.test.ts
git commit -m "feat(core): LiquidJS strict エンジンと cross_dedupe フィルタ(spec v3 §5)"
```

---

### Task 5: 構造マージの純関数(mergeManagedArray / mergeManagedTable)

**Files:**
- Create: `packages/core/src/reconcile/structuredManaged.ts`(この Task では merge 関数のみ)
- Test: `packages/core/test/reconcile/structuredManaged.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/reconcile/structuredManaged.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  mergeManagedArray,
  mergeManagedTable,
} from "../../src/reconcile/structuredManaged.js";

test("array: 管理エントリ正準順 + universe 外のリポ独自(相対順)。mergeExtends と同じ意味論", () => {
  const universe = ["a", "b", "c"];
  // actual に universe 由来の廃止分(c)とリポ独自(mine)が混在
  expect(mergeManagedArray(["c", "mine", "a"], ["a", "b"], universe)).toEqual(["a", "b", "mine"]);
  // actual が文字列単体でも正準化される(renovate の extends 文字列形)
  expect(mergeManagedArray("mine", ["a"], universe)).toEqual(["a", "mine"]);
  expect(mergeManagedArray(undefined, ["a"], universe)).toEqual(["a"]);
});

test("table: 管理キーは寄与値で上書き、universe 外のリポ独自キーは温存、寄与が消えた universe キーは削除", () => {
  const universe = ["node", "pnpm", "go"];
  const actual = { node: "20", go: "1.22", terraform: "1.9.0" };
  // go は今回の寄与に無い(universe には居る)→ 削除。terraform はリポ独自 → 温存
  expect(mergeManagedTable(actual, { node: "22", pnpm: "10" }, universe)).toEqual({
    node: "22",
    pnpm: "10",
    terraform: "1.9.0",
  });
  expect(mergeManagedTable(undefined, { node: "22" }, universe)).toEqual({ node: "22" });
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/structuredManaged.test.ts` → FAIL

- [ ] **Step 3: 実装**

`packages/core/src/reconcile/structuredManaged.ts`(まず merge 関数のみ):

```ts
import { dedupePreserveOrder } from "../util/dedupe.js";
import { isPlainObject } from "../util/object.js";

/** renovate の extends 文字列形と同様、文字列単体も配列へ正準化する */
export function normalizeToArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

/**
 * merge: "array"(spec v3 §6.2)。mergeExtends の一般化:
 * 望ましい値 = 管理エントリ(正準順) ++ universe 外のリポ独自エントリ(相対順保持)
 */
export function mergeManagedArray(
  actual: unknown,
  managed: unknown,
  universe: string[],
): string[] {
  const universeSet = new Set(universe);
  const repoOwn = normalizeToArray(actual).filter((e) => !universeSet.has(e));
  return dedupePreserveOrder([...normalizeToArray(managed), ...repoOwn]);
}

/**
 * merge: "table"(spec v3 §6.2)。管理キーは寄与値、universe 外のリポ独自キーは温存
 * (管理キーの後ろに元の相対順で並ぶ)。寄与が消えた universe キーは削除(retraction)。
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
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/structuredManaged.test.ts` → PASS

```bash
git add packages/core/src/reconcile/structuredManaged.ts packages/core/test/reconcile/structuredManaged.test.ts
git commit -m "feat(core): 構造マージの純関数 array/table(spec v3 §6.2)"
```

---

### Task 6: applyStructuredManaged(json / toml / yaml)+ renderStructuredCreate

**Files:**
- Modify: `packages/core/src/reconcile/structuredManaged.ts`(追記)
- Test: `packages/core/test/reconcile/structuredManaged.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**

`packages/core/test/reconcile/structuredManaged.test.ts` に追記:

```ts
import {
  applyStructuredManaged,
  renderStructuredCreate,
  StructuredParseError,
  type StructuredManagedSpec,
} from "../../src/reconcile/structuredManaged.js";

const RENOVATE_SPEC: StructuredManagedSpec = {
  fileType: "json",
  managedPaths: { extends: { merge: "array" } },
  data: { extends: ["github>o/rc", "github>o/rc:ts"] },
  universe: { extends: ["github>o/rc", "github>o/rc:ts", "github>o/rc:go"] },
};

test("json: 管理フィールドだけ更新し、他キー・リポ独自エントリは温存", () => {
  const actual = `{\n  "$schema": "s",\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n`;
  const next = applyStructuredManaged("renovate.json", actual, RENOVATE_SPEC);
  expect(JSON.parse(next!)).toEqual({
    $schema: "s",
    extends: ["github>o/rc", "github>o/rc:ts", ":timezone(Asia/Tokyo)"],
  });
});

test("json: 意味的に同一なら null(no-op)。パース不能は StructuredParseError", () => {
  const same = `{"extends":["github>o/rc","github>o/rc:ts"]}`;
  expect(applyStructuredManaged("renovate.json", same, RENOVATE_SPEC)).toBeNull();
  expect(() => applyStructuredManaged("renovate.json", "{oops", RENOVATE_SPEC)).toThrow(
    StructuredParseError,
  );
  expect(() => applyStructuredManaged("renovate.json", "[]", RENOVATE_SPEC)).toThrow(
    StructuredParseError,
  );
});

const MISE_SPEC: StructuredManagedSpec = {
  fileType: "toml",
  managedPaths: { tools: { merge: "table" } },
  data: { tools: { node: "22.12.0", "npm:prettier": "3.3.2" } },
  universe: { tools: ["node", "pnpm", "npm:prettier"] },
};

test("toml: [tools] だけマージ。リポ独自キー温存・quoted key 対応・他セクション不変", () => {
  const actual = `[env]\nNODE_ENV = "development"\n\n[tools]\nnode = "20"\npnpm = "9"\nterraform = "1.9.0"\n`;
  const next = applyStructuredManaged("mise.toml", actual, MISE_SPEC);
  // pnpm は寄与が消えた universe キー → 削除。terraform はリポ独自 → 温存
  expect(next).toContain(`node = "22.12.0"`);
  expect(next).toContain(`"npm:prettier" = "3.3.2"`);
  expect(next).toContain(`terraform = "1.9.0"`);
  expect(next).not.toContain(`pnpm`);
  expect(next).toContain(`NODE_ENV = "development"`);
});

test("toml: 意味的に同一なら null(正規化だけの書き換えをしない)", () => {
  // キー順・空行スタイルが正準形と違っても、構造が同じなら触らない(spec v3 C7)
  const actual = `[tools]\n\n"npm:prettier" = "3.3.2"\nnode    = "22.12.0"\n`;
  expect(applyStructuredManaged("mise.toml", actual, MISE_SPEC)).toBeNull();
});

const YAML_SPEC: StructuredManagedSpec = {
  fileType: "yaml",
  managedPaths: { managed_list: { merge: "array" } },
  data: { managed_list: ["a", "b"] },
  universe: { managed_list: ["a", "b", "old"] },
};

test("yaml: 対象パスだけ更新し、コメントは保持される", () => {
  const actual = `# repo のコメント\nother: keep\nmanaged_list:\n  - old\n  - mine\n`;
  const next = applyStructuredManaged("x.yml", actual, YAML_SPEC);
  expect(next).toContain("# repo のコメント");
  expect(next).toContain("other: keep");
  const parsed = next!;
  expect(parsed).toContain("- a");
  expect(parsed).toContain("- mine");
  expect(parsed).not.toContain("- old");
});

test("renderStructuredCreate: 骨格なし = 管理データのみで生成 / 骨格あり = 骨格へマージ", () => {
  expect(renderStructuredCreate("mise.toml", MISE_SPEC)).toBe(
    `[tools]\nnode = "22.12.0"\n"npm:prettier" = "3.3.2"\n`,
  );
  const skeleton = `{\n  "$schema": "s",\n  "extends": []\n}\n`;
  const created = renderStructuredCreate("renovate.json", RENOVATE_SPEC, skeleton);
  expect(JSON.parse(created)).toEqual({
    $schema: "s",
    extends: ["github>o/rc", "github>o/rc:ts"],
  });
});
```

注: toml の正準出力(smol-toml の stringify)のセクション見出し・キー順は実装確認時に期待値を合わせること(`[tools]` 見出しと各キー行が出ることは仕様として固定)。

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/structuredManaged.test.ts` → FAIL

- [ ] **Step 3: 実装を追記**

`packages/core/src/reconcile/structuredManaged.ts` に追記:

```ts
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import type { ManagedPathSpec, StructuredFileType } from "../catalog/types.js";
import { deepEqual } from "../util/object.js";

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

export interface StructuredManagedSpec {
  fileType: StructuredFileType;
  managedPaths: Record<string, ManagedPathSpec>;
  /** managed path → 選択 profile の寄与マージ結果 */
  data: Record<string, unknown>;
  /** managed path → universe(array: エントリ集合 / table: キー集合)。全 profile 由来 */
  universe: Record<string, string[]>;
}

function mergedFor(spec: StructuredManagedSpec, key: string, actualValue: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  const universe = spec.universe[key] ?? [];
  return s.merge === "array"
    ? mergeManagedArray(actualValue, spec.data[key], universe)
    : mergeManagedTable(actualValue, spec.data[key], universe);
}

/** no-op 判定用: 実ファイル側の現在値をマージ結果と同じ形へ正準化して比較する */
function normalizedCurrent(spec: StructuredManagedSpec, key: string, value: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  if (s.merge === "array") return normalizeToArray(value);
  return isPlainObject(value) ? value : {};
}

/**
 * 実ファイルの managed_paths 配下だけを管理ルールで更新した全文を返す。
 * 意味的に同一なら null(no-op。spec v3 C7: 正規化だけの書き換えをしない)。
 */
export function applyStructuredManaged(
  path: string,
  actualContent: string,
  spec: StructuredManagedSpec,
): string | null {
  switch (spec.fileType) {
    case "json":
      return applyJson(path, actualContent, spec);
    case "toml":
      return applyToml(path, actualContent, spec);
    case "yaml":
      return applyYaml(path, actualContent, spec);
  }
}

function applyJson(path: string, content: string, spec: StructuredManagedSpec): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new StructuredParseError(path, e);
  }
  if (!isPlainObject(parsed)) {
    throw new StructuredParseError(path, new Error("top-level must be a JSON object"));
  }
  let changed = false;
  for (const key of Object.keys(spec.managedPaths)) {
    const next = mergedFor(spec, key, parsed[key]);
    if (!deepEqual(normalizedCurrent(spec, key, parsed[key]), next)) {
      parsed[key] = next; // JSON.parse は挿入順を保持。既存キー位置は維持される
      changed = true;
    }
  }
  return changed ? `${JSON.stringify(parsed, null, 2)}\n` : null;
}

function applyToml(path: string, content: string, spec: StructuredManagedSpec): string | null {
  let parsed: Record<string, unknown>;
  try {
    // smol-toml の戻り型は TomlPrimitive のため unknown へ広げる(構造は plain object)
    parsed = parseToml(content) as Record<string, unknown>;
  } catch (e) {
    throw new StructuredParseError(path, e);
  }
  let changed = false;
  for (const key of Object.keys(spec.managedPaths)) {
    const next = mergedFor(spec, key, parsed[key]);
    if (!deepEqual(normalizedCurrent(spec, key, parsed[key]), next)) {
      parsed[key] = next;
      changed = true;
    }
  }
  // 変更があった回だけ全文を正準再描画(コメント・フォーマットは正規化される。spec v3 C7)
  return changed ? `${stringifyToml(parsed)}\n` : null;
}

function applyYaml(path: string, content: string, spec: StructuredManagedSpec): string | null {
  const doc = parseDocument(content);
  if (doc.errors.length > 0) throw new StructuredParseError(path, doc.errors[0]);
  const js: unknown = doc.toJS() ?? {};
  if (!isPlainObject(js)) {
    throw new StructuredParseError(path, new Error("top-level must be a YAML mapping"));
  }
  let changed = false;
  for (const key of Object.keys(spec.managedPaths)) {
    const next = mergedFor(spec, key, js[key]);
    if (!deepEqual(normalizedCurrent(spec, key, js[key]), next)) {
      doc.set(key, next); // Document API 編集。対象パス外のコメントは保持される
      changed = true;
    }
  }
  return changed ? doc.toString() : null;
}

/**
 * ファイル不在時の新規作成内容(spec v3 §6.2 の補足)。
 * skeleton(profile が template を宣言した場合の描画結果)があればそこへマージ、
 * 無ければ管理データのみから正準生成する。
 */
export function renderStructuredCreate(
  path: string,
  spec: StructuredManagedSpec,
  skeleton?: string,
): string {
  if (skeleton !== undefined) return applyStructuredManaged(path, skeleton, spec) ?? skeleton;
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(spec.managedPaths)) obj[key] = mergedFor(spec, key, undefined);
  switch (spec.fileType) {
    case "json":
      return `${JSON.stringify(obj, null, 2)}\n`;
    case "toml":
      return `${stringifyToml(obj)}\n`;
    case "yaml":
      return stringifyYaml(obj);
  }
}
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/structuredManaged.test.ts` → PASS
(smol-toml の stringify 出力形式が期待値と異なる場合は、期待値側を実出力に合わせて固定する — 「[tools] 見出し + key = value 行 + quoted key」が保たれていること)

```bash
git add packages/core/src/reconcile/structuredManaged.ts packages/core/test/reconcile/structuredManaged.test.ts
git commit -m "feat(core): json/toml/yaml の構造マージと no-op 判定(spec v3 §6.2)"
```

---

### Task 7: DesiredEntry 拡張 + computeChanges 対応

**Files:**
- Modify: `packages/core/src/templates/types.ts`(DesiredEntry に 2 戦略追加)
- Modify: `packages/core/src/reconcile/diff.ts`(case 追加)
- Test: `packages/core/test/reconcile/diff.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**

`packages/core/test/reconcile/diff.test.ts` に追記:

```ts
import type { DesiredEntry } from "../../src/templates/types.js";
import { computeChanges } from "../../src/reconcile/diff.js";

const STRUCTURED: DesiredEntry = {
  strategy: "structured-managed",
  path: "mise.toml",
  fileType: "toml",
  managedPaths: { tools: { merge: "table" } },
  data: { tools: { node: "22" } },
  universe: { tools: ["node", "pnpm"] },
  createContent: `[tools]\nnode = "22"\n`,
};

test("structured-managed: 不在なら createContent、存在ならマージ、同一なら no-op", () => {
  expect(computeChanges([STRUCTURED], {})).toEqual([
    { path: "mise.toml", content: `[tools]\nnode = "22"\n` },
  ]);
  const withRepoOwn = `[tools]\nnode = "20"\nterraform = "1.9"\n`;
  const [change] = computeChanges([STRUCTURED], { "mise.toml": withRepoOwn });
  expect(change?.content).toContain(`node = "22"`);
  expect(change?.content).toContain(`terraform = "1.9"`);
  expect(computeChanges([STRUCTURED], { "mise.toml": `[tools]\nnode = "22"\n` })).toEqual([]);
});

test("structured-managed-retract: universe 由来だけ除去。ファイル不在は no-op", () => {
  const retract: DesiredEntry = {
    strategy: "structured-managed-retract",
    path: "mise.toml",
    fileType: "toml",
    managedPaths: { tools: { merge: "table" } },
    universe: { tools: ["node", "pnpm"] },
  };
  expect(computeChanges([retract], {})).toEqual([]);
  const [change] = computeChanges([retract], {
    "mise.toml": `[tools]\nnode = "22"\nterraform = "1.9"\n`,
  });
  expect(change?.content).not.toContain("node");
  expect(change?.content).toContain(`terraform = "1.9"`);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/diff.test.ts` → FAIL(型エラー含む)

- [ ] **Step 3: DesiredEntry を拡張**

`packages/core/src/templates/types.ts` — import 追加と DesiredEntry union へ 2 変種追加:

```ts
import type { ManagedPathSpec, StructuredFileType } from "../catalog/types.js";
```

`DesiredEntry` の union に追加(既存 6 変種は不変):

```ts
  /** v3: 構造化ファイルの managed_paths 管理(extends-field の一般化。spec v3 §6.2) */
  | {
      strategy: "structured-managed";
      path: string;
      fileType: StructuredFileType;
      managedPaths: Record<string, ManagedPathSpec>;
      /** managed path → 選択 profile の寄与マージ結果 */
      data: Record<string, unknown>;
      /** managed path → universe(全 profile 由来。管理対象判定用) */
      universe: Record<string, string[]>;
      /** ファイル不在時に新規作成する全文 */
      createContent: string;
    }
  /** v3 exclude: 寄与ゼロへ収束(spec v2 §5.5 の一般化) */
  | {
      strategy: "structured-managed-retract";
      path: string;
      fileType: StructuredFileType;
      managedPaths: Record<string, ManagedPathSpec>;
      universe: Record<string, string[]>;
    };
```

- [ ] **Step 4: computeChanges に case を追加**

`packages/core/src/reconcile/diff.ts` — import 追加:

```ts
import { applyStructuredManaged } from "./structuredManaged.js";
```

switch に case 追加(`extends-field-retract` の後):

```ts
      case "structured-managed": {
        if (current === undefined) {
          changes.push({ path: d.path, content: d.createContent });
          break;
        }
        const next = applyStructuredManaged(d.path, current, d);
        if (next !== null) changes.push({ path: d.path, content: next });
        break;
      }
      case "structured-managed-retract": {
        if (current === undefined) break; // 新規作成はしない
        const empty: Record<string, unknown> = {};
        for (const [key, s] of Object.entries(d.managedPaths)) {
          empty[key] = s.merge === "array" ? [] : {};
        }
        const next = applyStructuredManaged(d.path, current, { ...d, data: empty });
        if (next !== null) changes.push({ path: d.path, content: next });
        break;
      }
```

- [ ] **Step 5: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/reconcile/diff.test.ts` → PASS(既存テストも全通過)

```bash
git add packages/core/src/templates/types.ts packages/core/src/reconcile/diff.ts packages/core/test/reconcile/diff.test.ts
git commit -m "feat(core): DesiredEntry に structured-managed / retract を追加"
```

---

### Task 8: resolveDesiredEntriesV3

**Files:**
- Create: `packages/core/src/catalog/resolve.ts`
- Test: `packages/core/test/catalog/resolve.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/catalog/resolve.test.ts`:

```ts
import { expect, test } from "vitest";
import { resolveDesiredEntriesV3 } from "../../src/catalog/resolve.js";
import type { TemplateSource } from "../../src/templates/types.js";

/** v3 は readFile / listFiles しか使わない(fragment 系メソッドは未使用) */
function memorySourceV3(files: Record<string, string>): TemplateSource {
  return {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files)
        .filter((p) => p.startsWith(prefix))
        .sort();
    },
    async readFragmentManifest() {
      throw new Error("not used in v3");
    },
    async listNames() {
      throw new Error("not used in v3");
    },
    async nameExists() {
      throw new Error("not used in v3");
    },
  };
}

const CATALOG = JSON.stringify({
  files: {
    ".gitignore": { file_type: "text", mode: "managed" },
    ".github/CODEOWNERS": { file_type: "text", mode: "managed" },
    "renovate.json": {
      file_type: "json",
      mode: "managed",
      managed_paths: { extends: { merge: "array" } },
    },
    "SECURITY.md": { file_type: "markdown", mode: "replaced" },
    "CONTRIBUTING.md": { file_type: "markdown", mode: "create-only" },
  },
});

const FILES: Record<string, string> = {
  "catalog.json": CATALOG,
  "templates/gitignore.liquid": `{{ contributions.sections | cross_dedupe: "ignores" | json }}`,
  "templates/codeowners.liquid": "* {{ contents.codeowner }}\n",
  "templates/security.liquid": "# Security\n",
  "templates/contributing.liquid": "# Contributing\n",
  "profiles/base/contributes.json": JSON.stringify({
    ".gitignore": {
      template: "gitignore.liquid",
      sections: [{ comment: "base", ignores: [".DS_Store"] }],
    },
    ".github/CODEOWNERS": { template: "codeowners.liquid" },
    "renovate.json": { extends: ["github>o/rc"] },
  }),
  "profiles/typescript/contributes.json": JSON.stringify({
    ".gitignore": { sections: [{ comment: "node", ignores: ["node_modules/"] }] },
    "renovate.json": { extends: ["github>o/rc:ts"] },
  }),
  "profiles/go/contributes.json": JSON.stringify({
    "renovate.json": { extends: ["github>o/rc:go"] },
  }),
  "profiles/oss/contributes.json": JSON.stringify({
    "SECURITY.md": { template: "security.liquid" },
    "CONTRIBUTING.md": { template: "contributing.liquid" },
  }),
};

const baseArgs = {
  languages: ["typescript"],
  bundles: [] as string[],
  contents: { codeowner: "@org/team" },
  exclude: [] as string[],
};

test("配布トリガー: 宣言 profile が寄与したパスだけ配布(oss 未宣言なら SECURITY.md は出ない)", async () => {
  const entries = await resolveDesiredEntriesV3({ source: memorySourceV3(FILES), ...baseArgs });
  const paths = entries.map((e) => e.path).sort();
  expect(paths).toEqual([".github/CODEOWNERS", ".gitignore", "renovate.json"]);
});

test("bundles 宣言で oss の replaced / create-only が加わる", async () => {
  const entries = await resolveDesiredEntriesV3({
    source: memorySourceV3(FILES),
    ...baseArgs,
    bundles: ["oss"],
  });
  const security = entries.find((e) => e.path === "SECURITY.md");
  const contributing = entries.find((e) => e.path === "CONTRIBUTING.md");
  expect(security).toEqual({ strategy: "replace", path: "SECURITY.md", content: "# Security\n" });
  expect(contributing?.strategy).toBe("create-only");
});

test("managed text: 描画結果が blockContent になり、contents が流れ込む", async () => {
  const entries = await resolveDesiredEntriesV3({ source: memorySourceV3(FILES), ...baseArgs });
  const co = entries.find((e) => e.path === ".github/CODEOWNERS");
  expect(co).toEqual({
    strategy: "managed-block",
    path: ".github/CODEOWNERS",
    blockContent: "* @org/team",
  });
  const gi = entries.find((e) => e.path === ".gitignore");
  expect(gi?.strategy).toBe("managed-block");
});

test("structured-managed: data は宣言 profile のみ、universe は全 profile(未宣言の go を含む)", async () => {
  const entries = await resolveDesiredEntriesV3({ source: memorySourceV3(FILES), ...baseArgs });
  const rn = entries.find((e) => e.path === "renovate.json");
  if (rn?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(rn.data.extends).toEqual(["github>o/rc", "github>o/rc:ts"]);
  expect(rn.universe.extends).toEqual(
    expect.arrayContaining(["github>o/rc", "github>o/rc:ts", "github>o/rc:go"]),
  );
  expect(JSON.parse(rn.createContent)).toEqual({ extends: ["github>o/rc", "github>o/rc:ts"] });
});

test("exclude: managed 系は retract 化、replace / create-only は消える(spec v2 §5.5)", async () => {
  const entries = await resolveDesiredEntriesV3({
    source: memorySourceV3(FILES),
    ...baseArgs,
    bundles: ["oss"],
    exclude: [".gitignore", "renovate.json", "SECURITY.md"],
  });
  const strategies = Object.fromEntries(entries.map((e) => [e.path, e.strategy]));
  expect(strategies[".gitignore"]).toBe("managed-block-retract");
  expect(strategies["renovate.json"]).toBe("structured-managed-retract");
  expect(strategies["SECURITY.md"]).toBeUndefined();
});

test("fail fast: 未知 profile / catalog 未登録パス / template 衝突・不在・未宣言", async () => {
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(FILES), ...baseArgs, languages: ["ruby"] }),
  ).rejects.toThrow(/unknown profile: ruby/);

  const typo = {
    ...FILES,
    "profiles/typescript/contributes.json": JSON.stringify({ "renovte.json": {} }),
  };
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(typo), ...baseArgs }),
  ).rejects.toThrow(/path not in catalog: renovte\.json/);

  const collision = {
    ...FILES,
    "profiles/typescript/contributes.json": JSON.stringify({
      ".github/CODEOWNERS": { template: "codeowners.liquid" },
    }),
  };
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(collision), ...baseArgs }),
  ).rejects.toThrow(/template collision/);

  const missingTpl = {
    ...FILES,
    "profiles/base/contributes.json": JSON.stringify({
      ".github/CODEOWNERS": { template: "nope.liquid" },
    }),
  };
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(missingTpl), ...baseArgs }),
  ).rejects.toThrow(/template not found/);

  const noTpl = {
    ...FILES,
    "profiles/base/contributes.json": JSON.stringify({ ".gitignore": { sections: [] } }),
  };
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(noTpl), ...baseArgs }),
  ).rejects.toThrow(/no template declared/);
});

test("fail fast: 構造化 managed への寄与キーが managed_paths 外(タイポ検出)", async () => {
  const typo = {
    ...FILES,
    "profiles/typescript/contributes.json": JSON.stringify({
      "renovate.json": { extend: ["github>o/rc:ts"] },
    }),
  };
  await expect(
    resolveDesiredEntriesV3({ source: memorySourceV3(typo), ...baseArgs }),
  ).rejects.toThrow(/not a managed path.*extend/);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/resolve.test.ts` → FAIL

- [ ] **Step 3: 実装**

`packages/core/src/catalog/resolve.ts`:

```ts
import {
  renderStructuredCreate,
  type StructuredManagedSpec,
} from "../reconcile/structuredManaged.js";
import type { DesiredEntry, TemplateSource } from "../templates/types.js";
import { dedupePreserveOrder } from "../util/dedupe.js";
import { isPlainObject } from "../util/object.js";
import { createLiquid, renderLiquid } from "./liquid.js";
import { mergeContributionData } from "./merge.js";
import { parseCatalog } from "./parse.js";
import type {
  CatalogEntry,
  ContributesManifest,
  Contribution,
  StructuredFileType,
} from "./types.js";

export interface ResolveV3Args {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** リポ個別値(tf 側 fanout.contents。v2 vars の後継) */
  contents: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

const STRUCTURED = new Set(["json", "yaml", "toml"]);

async function listProfileNames(source: TemplateSource): Promise<string[]> {
  const names = new Set<string>();
  for (const p of await source.listFiles("profiles/")) {
    const m = /^profiles\/([^/]+)\//.exec(p);
    if (m?.[1]) names.add(m[1]);
  }
  return [...names].sort();
}

async function readContributes(
  source: TemplateSource,
  profile: string,
): Promise<ContributesManifest> {
  const raw = await source.readFile(`profiles/${profile}/contributes.json`);
  if (raw === null) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`profiles/${profile}/contributes.json: invalid JSON: ${(e as Error).message}`);
  }
  if (!isPlainObject(json)) {
    throw new Error(`profiles/${profile}/contributes.json: must be an object of path -> contribution`);
  }
  for (const [path, c] of Object.entries(json)) {
    if (path.startsWith("_")) continue;
    if (!isPlainObject(c)) {
      throw new Error(`profiles/${profile}/contributes.json: ${path}: must be an object`);
    }
    if ("template" in c && typeof c.template !== "string") {
      throw new Error(`profiles/${profile}/contributes.json: ${path}: template must be a string`);
    }
  }
  return json as ContributesManifest;
}

function stripReserved(c: Contribution): Record<string, unknown> {
  const { template: _template, ...data } = c;
  return data;
}

/** universe = 全 profile(選択有無を問わない)の当該 (path, managed_path) への寄与の和集合 */
function computeUniverse(
  path: string,
  entry: CatalogEntry,
  all: Map<string, ContributesManifest>,
): Record<string, string[]> {
  const universe: Record<string, string[]> = {};
  for (const [key, spec] of Object.entries(entry.managed_paths ?? {})) {
    const values: string[] = [];
    for (const manifest of all.values()) {
      const v = manifest[path]?.[key];
      if (v === undefined) continue;
      if (spec.merge === "array") {
        if (Array.isArray(v)) values.push(...v.map(String));
        else if (typeof v === "string") values.push(v);
      } else if (isPlainObject(v)) {
        values.push(...Object.keys(v));
      }
    }
    universe[key] = dedupePreserveOrder(values);
  }
  return universe;
}

/** v3 resolve(spec v3 §4〜§6)。catalog.json を正とし、profile 寄与から DesiredEntry を導出 */
export async function resolveDesiredEntriesV3(args: ResolveV3Args): Promise<DesiredEntry[]> {
  const catalog = parseCatalog(await args.source.readFile("catalog.json"));

  // profiles = base + languages 宣言順 + bundles 宣言順(spec v3 C9)
  const declared = dedupePreserveOrder(["base", ...args.languages, ...args.bundles]);
  const allProfiles = await listProfileNames(args.source);
  for (const p of declared) {
    if (!allProfiles.includes(p)) throw new Error(`unknown profile: ${p}`);
  }

  const contributesByProfile = new Map<string, ContributesManifest>();
  for (const p of allProfiles) {
    contributesByProfile.set(p, await readContributes(args.source, p));
  }

  // catalog 未登録パスへの寄与はタイポとして fail fast(spec v3 C10)
  for (const [profile, manifest] of contributesByProfile) {
    for (const path of Object.keys(manifest)) {
      if (path.startsWith("_")) continue;
      if (!(path in catalog.files)) {
        throw new Error(`profiles/${profile}/contributes.json: path not in catalog: ${path}`);
      }
    }
  }

  const engine = createLiquid();
  const byDest = new Map<string, DesiredEntry>();

  for (const [path, entry] of Object.entries(catalog.files)) {
    const contribs: Array<{ profile: string; c: Contribution }> = [];
    for (const p of declared) {
      const c = contributesByProfile.get(p)?.[path];
      if (c !== undefined) contribs.push({ profile: p, c });
    }
    if (contribs.length === 0) continue; // どの宣言 profile も寄与しない → 配布しない

    const templateDecls = contribs.filter((x) => x.c.template !== undefined);
    if (templateDecls.length > 1) {
      throw new Error(
        `template collision: ${path} declared by ${templateDecls.map((t) => t.profile).join(", ")}`,
      );
    }
    let templateText: string | undefined;
    if (templateDecls.length === 1) {
      const name = templateDecls[0]?.c.template as string;
      const raw = await args.source.readFile(`templates/${name}`);
      if (raw === null) throw new Error(`template not found: templates/${name} (for ${path})`);
      templateText = raw;
    }

    const data = mergeContributionData(contribs.map((x) => stripReserved(x.c)));
    const ctx = {
      contributions: data,
      contents: args.contents,
      repo: args.repo ?? "",
      account: args.account ?? "",
    };
    const render = async (tpl: string): Promise<string> =>
      entry.raw ? tpl : await renderLiquid(engine, tpl, ctx);

    const structured = entry.mode === "managed" && STRUCTURED.has(entry.file_type);
    if (!structured) {
      if (templateText === undefined) throw new Error(`no template declared for ${path}`);
      const content = await render(templateText);
      if (entry.mode === "replaced") {
        byDest.set(path, { strategy: "replace", path, content });
      } else if (entry.mode === "create-only") {
        byDest.set(path, { strategy: "create-only", path, content });
      } else {
        byDest.set(path, {
          strategy: "managed-block",
          path,
          blockContent: content.replace(/\n$/, ""),
        });
      }
    } else {
      const managedPaths = entry.managed_paths ?? {};
      for (const key of Object.keys(data)) {
        if (!(key in managedPaths)) {
          throw new Error(`${path}: contribution key is not a managed path (typo?): ${key}`);
        }
      }
      const spec: StructuredManagedSpec = {
        fileType: entry.file_type as StructuredFileType,
        managedPaths,
        data,
        universe: computeUniverse(path, entry, contributesByProfile),
      };
      const skeleton = templateText === undefined ? undefined : await render(templateText);
      byDest.set(path, {
        strategy: "structured-managed",
        path,
        ...spec,
        createContent: renderStructuredCreate(path, spec, skeleton),
      });
    }
  }

  // exclude = 寄与ゼロへ収束(spec v2 §5.5 のまま)
  for (const ex of args.exclude) {
    const e = byDest.get(ex);
    if (!e) continue;
    if (e.strategy === "managed-block") {
      byDest.set(ex, { strategy: "managed-block-retract", path: ex });
    } else if (e.strategy === "structured-managed") {
      byDest.set(ex, {
        strategy: "structured-managed-retract",
        path: ex,
        fileType: e.fileType,
        managedPaths: e.managedPaths,
        universe: e.universe,
      });
    } else {
      byDest.delete(ex);
    }
  }
  return [...byDest.values()];
}
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/resolve.test.ts` → PASS

```bash
git add packages/core/src/catalog/resolve.ts packages/core/test/catalog/resolve.test.ts
git commit -m "feat(core): v3 resolver(catalog + profiles + templates。spec v3 §4-6)"
```

---

### Task 9: auto dispatch(resolveDesired)+ index.ts export

**Files:**
- Modify: `packages/core/src/catalog/resolve.ts`(resolveDesired 追加)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/catalog/dispatch.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/catalog/dispatch.test.ts`:

```ts
import { expect, test } from "vitest";
import { resolveDesired } from "../../src/catalog/resolve.js";
import type { FragmentManifest, TemplateSource } from "../../src/templates/types.js";

// catalog.json が無い = v2 レイアウト → 旧 resolver に委譲される
function legacySource(): TemplateSource {
  const files: Record<string, string> = {
    "strategies.json": '{".gitignore":"managed-block"}',
    "base/files/.gitignore": "{{gitignore}}\n",
  };
  const fragments: Record<string, FragmentManifest> = {
    base: { gitignore: [{ section_comment: "base", ignores: [".DS_Store"] }] },
  };
  return {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest(dir) {
      return fragments[dir] ?? null;
    },
    async listNames() {
      return [];
    },
    async nameExists() {
      return false;
    },
  };
}

test("catalog.json が無ければ v2 resolver(strategies.json 経路)", async () => {
  const entries = await resolveDesired({
    source: legacySource(),
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
  });
  expect(entries).toEqual([
    { strategy: "managed-block", path: ".gitignore", blockContent: "### base ###\n.DS_Store" },
  ]);
});

test("catalog.json があれば v3 resolver(vars は contents として渡る)", async () => {
  const files: Record<string, string> = {
    "catalog.json": JSON.stringify({
      files: { ".github/CODEOWNERS": { file_type: "text", mode: "managed" } },
    }),
    "templates/codeowners.liquid": "* {{ contents.codeowner }}\n",
    "profiles/base/contributes.json": JSON.stringify({
      ".github/CODEOWNERS": { template: "codeowners.liquid" },
    }),
  };
  const source: TemplateSource = {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest() {
      return null;
    },
    async listNames() {
      return [];
    },
    async nameExists() {
      return false;
    },
  };
  const entries = await resolveDesired({
    source,
    languages: [],
    bundles: [],
    vars: { codeowner: "@org/team" },
    exclude: [],
  });
  expect(entries).toEqual([
    { strategy: "managed-block", path: ".github/CODEOWNERS", blockContent: "* @org/team" },
  ]);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/dispatch.test.ts` → FAIL

- [ ] **Step 3: resolveDesired を実装し index.ts を更新**

`packages/core/src/catalog/resolve.ts` に追記:

```ts
import { resolveDesiredEntries } from "../templates/resolve.js";

export interface ResolveAutoArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** v2 の呼び出し互換のため名前は vars のまま(v3 では contents として渡る) */
  vars: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/**
 * 新旧 resolver の自動切替(spec v3 §9 P-a)。切替スイッチは catalog.json の有無:
 * canonical-files 側の merge / revert だけで v3 移行とロールバックが完結する。
 */
export async function resolveDesired(args: ResolveAutoArgs): Promise<DesiredEntry[]> {
  const catalogRaw = await args.source.readFile("catalog.json");
  if (catalogRaw === null) {
    return resolveDesiredEntries({
      source: args.source,
      languages: args.languages,
      bundles: args.bundles,
      vars: args.vars,
      exclude: args.exclude,
    });
  }
  return resolveDesiredEntriesV3({
    source: args.source,
    languages: args.languages,
    bundles: args.bundles,
    contents: args.vars,
    exclude: args.exclude,
    repo: args.repo,
    account: args.account,
  });
}
```

`packages/core/src/index.ts` に追記(既存 export の後):

```ts
export { createLiquid, crossDedupe, renderLiquid } from "./catalog/liquid.js";
export { mergeContributionData } from "./catalog/merge.js";
export { parseCatalog } from "./catalog/parse.js";
export type { ResolveAutoArgs, ResolveV3Args } from "./catalog/resolve.js";
export { resolveDesired, resolveDesiredEntriesV3 } from "./catalog/resolve.js";
export type {
  Catalog,
  CatalogEntry,
  ContributesManifest,
  Contribution,
  FileMode,
  FileType,
  ManagedPathSpec,
  MergeKind,
  StructuredFileType,
} from "./catalog/types.js";
export {
  applyStructuredManaged,
  mergeManagedArray,
  mergeManagedTable,
  renderStructuredCreate,
  StructuredParseError,
} from "./reconcile/structuredManaged.js";
export type { StructuredManagedSpec } from "./reconcile/structuredManaged.js";
export { deepEqual, isPlainObject } from "./util/object.js";
```

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/dispatch.test.ts` → PASS
Run: `pnpm --filter @repository-fanout/core test` → 全 PASS

```bash
git add packages/core/src/catalog/resolve.ts packages/core/src/index.ts packages/core/test/catalog/dispatch.test.ts
git commit -m "feat(core): catalog.json の有無で新旧 resolver を自動切替(spec v3 §9)"
```

---

### Task 10: manifest の contents(vars 後継)受理

**Files:**
- Modify: `packages/core/src/manifest/parse.ts`
- Test: `packages/core/test/manifest/parse.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**

`packages/core/test/manifest/parse.test.ts` に追記(既存のヘルパ/形式に合わせること):

```ts
test("contents は vars の後継として受理される(RepoEntry.vars に入る)", () => {
  const m = parseManifest({
    account: "o",
    revision: 1,
    sourceCommit: "c",
    repositories: {
      r: { languages: ["typescript"], contents: { codeowner: "@org/team" } },
    },
  });
  expect(m.repositories.r?.vars).toEqual({ codeowner: "@org/team" });
});

test("contents と vars の両方宣言はエラー(曖昧さの排除)", () => {
  expect(() =>
    parseManifest({
      account: "o",
      revision: 1,
      sourceCommit: "c",
      repositories: {
        r: { languages: [], contents: { a: "1" }, vars: { a: "2" } },
      },
    }),
  ).toThrow(/either contents or vars/);
});
```

- [ ] **Step 2: 実行して FAIL を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/manifest/parse.test.ts` → FAIL

- [ ] **Step 3: 実装**

`packages/core/src/manifest/parse.ts` — vars 検証ブロックの直前に挿入し、以降の検証対象を `varsSource` に置き換える:

```ts
    // contents は vars の後継(spec v3 §8)。移行期間中は両キーを受理するが、
    // 両方の同時宣言はどちらが勝つか曖昧なのでエラーにする。
    let varsSource = entry.vars;
    if (entry.contents !== undefined) {
      if (entry.vars !== undefined) {
        throw new Error(`manifest: ${name}: declare either contents or vars, not both`);
      }
      varsSource = entry.contents;
    }
```

既存の `entry.vars` 参照(検証と代入)をすべて `varsSource` に変更。`RepoEntry` 型は変更しない(内部表現は vars のまま。tf 全アカウント移行後の vars 受理削除は P-c)。

- [ ] **Step 4: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/manifest/parse.test.ts` → PASS

```bash
git add packages/core/src/manifest/parse.ts packages/core/test/manifest/parse.test.ts
git commit -m "feat(core): manifest の contents キーを vars の後継として受理(spec v3 §8)"
```

---

### Task 11: worker / cli の配線切替

**Files:**
- Modify: `apps/worker/src/workflows/child.ts`
- Modify: `apps/cli/src/planRepo.ts`
- Modify: `apps/cli/src/applyRepo.ts`
- Modify: `apps/cli/src/validateDir.ts`

- [ ] **Step 1: worker child.ts を resolveDesired へ切替**

`apps/worker/src/workflows/child.ts`:

1. import の `resolveDesiredEntries` を `resolveDesired` に変更し、`StructuredParseError` を追加
2. 呼び出し(現 121 行付近)を置換:

```ts
    const desired = await step.do("resolve desired", async () =>
      retry(() =>
        resolveDesired({
          source: templates,
          languages: p.languages,
          bundles: p.bundles,
          vars: p.vars,
          exclude: p.exclude,
          repo: p.repo,
          account: p.account,
        }),
      ),
    );
```

3. computeChanges の catch(現 146 行付近)を拡張:

```ts
      if (err instanceof RenovateParseError || err instanceof StructuredParseError) {
```

(StructuredParseError = 配布先の実ファイルがパース不能。RenovateParseError と同じく「そのリポを failed 記録して他リポは続行」が正しい)

- [ ] **Step 2: cli planRepo.ts / applyRepo.ts を切替**

両ファイルとも import と呼び出しの関数名を `resolveDesiredEntries` → `resolveDesired` に変更(引数 shape は同一。repo/account は CLI では未指定のまま省略可)。

- [ ] **Step 3: cli validateDir.ts に v3 検証経路を追加**

`apps/cli/src/validateDir.ts` — 既存 import に `parseCatalog` / `resolveDesired` を追加する
(既存 v2 経路が使う `resolveDesiredEntries` は残す):

```ts
import {
  parseCatalog,
  resolveDesired,
  resolveDesiredEntries,
  type TemplateSource,
} from "@repository-fanout/core";
```

`validateSource` の先頭に分岐を追加(既存の fragment 検証は else 側として無変更):

```ts
export async function validateSource(source: TemplateSource): Promise<string[]> {
  if ((await source.readFile("catalog.json")) !== null) return validateCatalogSource(source);
  // ... 既存の v2 検証(そのまま) ...
}

/**
 * v3 レイアウトの検証(spec v3 §10)。catalog / contributes / template の整合は
 * resolver 自体が fail fast するので、ここでは「全 profile 組合せの描画スモーク」を回す。
 */
async function validateCatalogSource(source: TemplateSource): Promise<string[]> {
  const errors: string[] = [];
  try {
    parseCatalog(await source.readFile("catalog.json"));
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
```

- [ ] **Step 4: 全テスト + Workers バンドル検証**

Run: `pnpm test` → 全 PASS(worker の既存テストは catalog.json 無しのメモリ source なので旧経路のまま通る)
Run: `pnpm typecheck` → PASS
Run: `pnpm --filter @repository-fanout/worker exec wrangler deploy --dry-run` → バンドル成功(liquidjs / yaml / smol-toml が Workers でバンドル可能なことの確認。eval 系エラーが出ないこと)

- [ ] **Step 5: コミット**

```bash
git add apps/worker/src/workflows/child.ts apps/cli/src/planRepo.ts apps/cli/src/applyRepo.ts apps/cli/src/validateDir.ts
git commit -m "feat: worker/cli を resolveDesired(新旧自動切替)へ配線(spec v3 §7)"
```

---

### Task 12: 新旧等価性テスト(P-b の受け入れ根拠)

**Files:**
- Test: `packages/core/test/catalog/equivalence.test.ts`

- [ ] **Step 1: テストを書く(このタスクはテストのみ。実装変更なし)**

同一の論理データを v2 レイアウト(fragment/strategies)と v3 レイアウト(catalog/profiles/templates)で表現し、同じ実ファイル群に対する `computeChanges` の出力が一致することを固定する。gitignore.liquid は Task 4 の `GITIGNORE_LIQUID` を使う。

`packages/core/test/catalog/equivalence.test.ts`:

```ts
import { expect, test } from "vitest";
import { computeChanges } from "../../src/reconcile/diff.js";
import { resolveDesired } from "../../src/catalog/resolve.js";
import type { FragmentManifest, TemplateSource } from "../../src/templates/types.js";
import { GITIGNORE_LIQUID } from "./liquid.test.js";

function memorySource(opts: {
  files: Record<string, string>;
  fragments?: Record<string, FragmentManifest>;
  languages?: string[];
}): TemplateSource {
  return {
    async readFile(p) {
      return opts.files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(opts.files)
        .filter((p) => p.startsWith(prefix))
        .sort();
    },
    async readFragmentManifest(dir) {
      return opts.fragments?.[dir] ?? null;
    },
    async listNames(axis) {
      return axis === "languages" ? (opts.languages ?? []) : [];
    },
    async nameExists(axis, name) {
      return axis === "languages" && (opts.languages ?? []).includes(name);
    },
  };
}

const legacy = memorySource({
  files: {
    "strategies.json": JSON.stringify({
      "renovate.json": "extends-field",
      ".gitignore": "managed-block",
      ".github/CODEOWNERS": "managed-block",
    }),
    "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
    "base/files/.gitignore": "{{gitignore}}\n",
    "base/files/.github/CODEOWNERS": "* @{{codeowner}}\n",
    "base/files/.github/release.yml": "changelog: {}\n",
  },
  fragments: {
    base: {
      renovate: ["github>o/rc"],
      gitignore: [{ section_comment: "base", ignores: [".DS_Store"] }],
    },
    "languages/typescript": {
      renovate: ["github>o/rc:ts"],
      gitignore: [{ section_comment: "node", ignores: ["node_modules/"] }],
    },
    "languages/go": { renovate: ["github>o/rc:go"] },
  },
  languages: ["typescript", "go"],
});

const v3 = memorySource({
  files: {
    "catalog.json": JSON.stringify({
      files: {
        ".gitignore": { file_type: "text", mode: "managed" },
        ".github/CODEOWNERS": { file_type: "text", mode: "managed" },
        "renovate.json": {
          file_type: "json",
          mode: "managed",
          managed_paths: { extends: { merge: "array" } },
        },
        ".github/release.yml": { file_type: "yaml", mode: "replaced" },
      },
    }),
    "templates/gitignore.liquid": GITIGNORE_LIQUID,
    "templates/codeowners.liquid": "* @{{ contents.codeowner }}\n",
    "templates/release.yml.liquid": "changelog: {}\n",
    "profiles/base/contributes.json": JSON.stringify({
      ".gitignore": {
        template: "gitignore.liquid",
        sections: [{ comment: "base", ignores: [".DS_Store"] }],
      },
      ".github/CODEOWNERS": { template: "codeowners.liquid" },
      "renovate.json": { extends: ["github>o/rc"] },
      ".github/release.yml": { template: "release.yml.liquid" },
    }),
    "profiles/typescript/contributes.json": JSON.stringify({
      ".gitignore": { sections: [{ comment: "node", ignores: ["node_modules/"] }] },
      "renovate.json": { extends: ["github>o/rc:ts"] },
    }),
    "profiles/go/contributes.json": JSON.stringify({
      "renovate.json": { extends: ["github>o/rc:go"] },
    }),
  },
});

// 配布先リポの実状態: リポ独自行入り gitignore、リポ独自 extends 入り renovate、古い release.yml
const ACTUAL = {
  ".gitignore": "# >>> repository-fanout managed >>>\nold\n# <<< repository-fanout managed <<<\n\n/generated/\n",
  "renovate.json": '{\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n',
  ".github/release.yml": "changelog: {old: true}\n",
};

test("同一データ・同一実ファイルに対する FileChange が新旧レイアウトで一致する", async () => {
  const argsBase = {
    languages: ["typescript"],
    bundles: [],
    vars: { codeowner: "org/team" },
    exclude: [],
  };
  const dLegacy = await resolveDesired({ source: legacy, ...argsBase });
  const dV3 = await resolveDesired({ source: v3, ...argsBase });

  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  const cLegacy = computeChanges(dLegacy, ACTUAL).sort(byPath);
  const cV3 = computeChanges(dV3, ACTUAL).sort(byPath);
  expect(cV3).toEqual(cLegacy);
});

test("renovate.json 不在時の createContent は意味的同一(テキストは正準化差を許容)", async () => {
  const argsBase = {
    languages: ["typescript"],
    bundles: [],
    vars: { codeowner: "org/team" },
    exclude: [],
  };
  const dLegacy = await resolveDesired({ source: legacy, ...argsBase });
  const dV3 = await resolveDesired({ source: v3, ...argsBase });
  const lc = computeChanges(dLegacy, {}).find((c) => c.path === "renovate.json");
  const vc = computeChanges(dV3, {}).find((c) => c.path === "renovate.json");
  expect(JSON.parse(vc?.content ?? "")).toEqual(JSON.parse(lc?.content ?? ""));
});
```

注: 1 本目のテストは CODEOWNERS の blockContent・gitignore の blockContent・release.yml の content が**バイト一致**することを要求する。ここが通れば P-b の canonical-files 変換で全リポ一斉の見た目差分 PR は起きない。

- [ ] **Step 2: 実行して PASS を確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/catalog/equivalence.test.ts` → PASS
(FAIL した場合は v3 側テンプレート/描画の whitespace を疑う。旧実装側は変更しないこと)

- [ ] **Step 3: コミット**

```bash
git add packages/core/test/catalog/equivalence.test.ts
git commit -m "test(core): 新旧レイアウトの FileChange 等価性を固定(P-b の受け入れ根拠)"
```

※ Task 4 のテストから `GITIGNORE_LIQUID` を import しているため、`liquid.test.ts` の export が必要(Task 4 で定義済み)。

---

### Task 13: spec 追記 + 全体検証

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-catalog-profiles-design.md`(§6.2 に補足追記)

- [ ] **Step 1: spec に「構造化 managed の新規作成」の補足を追記**

§6.2 の「制約(fail fast)」の前に追加:

```markdown
ファイル不在時の新規作成:

- profile が `template` を宣言していれば、その描画結果を骨格として managed_paths をマージした全文で作成する
  (renovate.json の `$schema` のような管理外の初期キーを骨格側に置ける)
- `template` 宣言が無ければ、管理データのみから正準生成する
```

- [ ] **Step 2: 全体検証**

Run(リポルート):

```bash
pnpm lint:fix
pnpm typecheck
pnpm test
```

Expected: すべて成功。lint の自動修正が入った場合は差分を確認してステージに含める。

- [ ] **Step 3: コミット**

```bash
git add -A
git commit -m "docs: v3 spec に構造化 managed の新規作成挙動を補足"
```

---

## 完了チェック(このプランのスコープ)

- [ ] catalog.json があるテンプレリポに対して v3 resolver が動く(単体テストで実証)
- [ ] catalog.json が無ければ従来どおり(worker/cli の既存テスト全通過)
- [ ] 新旧等価性テストが PASS(P-b 着手の前提)
- [ ] `wrangler deploy --dry-run` 成功(Workers 互換の実証)

## 後続プラン(別ファイル。このプランには含まない)

- **P-b**: canonical-files の catalog/profiles/templates への変換 + CI(canonical-files リポ)
- **P-c**: organization-structure の `vars` → `contents` リネーム(tf リポ)
- **P-d**: mise.toml 配布の実証(DoD-3)
- **P-e**: 旧経路(fragment/strategies)の削除
