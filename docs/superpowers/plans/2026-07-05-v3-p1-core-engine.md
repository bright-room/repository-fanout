# v3-P1: core v3 エンジン(catalog/profiles/Liquid/構造マージ)実装プラン(rev.2: 業務概念パッケージ + ドメインオブジェクト)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [v3 spec](../specs/2026-07-05-catalog-profiles-design.md) の P-a を、[core 構造設計](../specs/2026-07-05-core-structure-design.md)(業務概念パッケージ + 完全コンストラクタのドメインオブジェクト)に従って実装する。catalog.json の有無で新旧 resolver を自動切替(旧経路は凍結・無傷)。

**Architecture:** `domain/model/` を業務概念(canonical / desired / reconcile / retraction / branch / manifest)で分割。検証を持つ概念は完全コンストラクタのクラス(Catalog, CatalogEntry 階層, ProfileContributes, Template, StructuredDocument, DesiredFile 階層)。**境界ルール**: step.do / KV / HTTP を越える値は plain 型(`DesiredFileData`, `FileChange`, `DistRecord`)で運び、境界の内側で `DesiredFile.from()` 等で載せ替える。mode / strategy の分岐はポリモーフィズム(`CatalogEntry.deriveDesired` / `DesiredFile.applyTo`)。進行手順は `application/scenario` に一本化。

**Tech Stack:** TypeScript / vitest / LiquidJS(strict)/ yaml(eemeli 版)/ smol-toml(すべて pure JS = Workers 互換)

**検証コマンド(共通):** core 単体 `pnpm --filter @repository-fanout/core exec vitest run <testfile>` / 全体 `pnpm test` `pnpm typecheck` `pnpm lint:fix`(リポルート)

**凍結ゾーン(P-e で削除。新機能追加・改名禁止、import パス修正のみ可):** `packages/core/src/templates/`(v2 resolve 一式)と `packages/core/src/reconcile/extendsField.ts`、および対応するテスト。

**設計上の補足(構造設計 doc からの精緻化 2 点):**
- `TemplateSource` ポートは `application/port/` でなく `domain/model/canonical/templateSource.ts` に置く(正本の読み取り口 = canonical が宣言するリポジトリインターフェース。domain → application の依存を作らないため)
- `Manifest` は境界ルール §4 により plain + parse 関数のまま(HTTP/KV を越える値。クラス化しない)

---

### Task 0: 既存資産の構造移設(挙動不変)

**Files:** git mv(下記コマンド列)+ 各ファイルの相対 import 修正 + `src/index.ts` のパス更新 + 分離 3 ファイル新規(desiredFileData.ts / templateSource.ts / fileChange.ts)

- [ ] **Step 1: src を新配置へ git mv**

```bash
cd packages/core
mkdir -p src/domain/model/{canonical,desired,reconcile,retraction,branch,manifest} \
         src/domain/type src/application/scenario src/infrastructure/github/auth

git mv src/reconcile/block.ts        src/domain/model/reconcile/managedBlock.ts
git mv src/reconcile/diff.ts         src/domain/model/desired/computeChanges.ts
git mv src/reconcile/retraction.ts   src/domain/model/retraction/retractionPlan.ts
git mv src/reconcile/distRecord.ts   src/domain/model/retraction/distRecord.ts
git mv src/reconcile/branch.ts       src/domain/model/branch/branchAction.ts
git mv src/manifest/parse.ts         src/domain/model/manifest/parse.ts
git mv src/manifest/types.ts         src/domain/model/manifest/types.ts
git mv src/github/client.ts          src/infrastructure/github/client.ts
git mv src/github/errors.ts          src/infrastructure/github/errors.ts
git mv src/github/repoIO.ts          src/infrastructure/github/repoIO.ts
git mv src/github/types.ts           src/infrastructure/github/types.ts
git mv src/auth/jwt.ts               src/infrastructure/github/auth/jwt.ts
git mv src/auth/installation.ts      src/infrastructure/github/auth/installation.ts
git mv src/util/dedupe.ts            src/domain/type/dedupe.ts
git mv src/util/hash.ts              src/domain/type/hash.ts
git mv src/util/base64.ts            src/domain/type/base64.ts
# src/reconcile/extendsField.ts と src/templates/ は凍結ゾーンとして現位置に残す
```

- [ ] **Step 2: DesiredEntry / TemplateSource / FileChange を分離**

`src/domain/model/desired/desiredFileData.ts` を新規作成し、`src/templates/types.ts` から **DesiredEntry union をそのまま移す**(6 変種、内容不変):

```ts
/**
 * 望ましいファイルの plain 表現(境界横断用)。step.do / KV を越える値は
 * クラスでなくこの型で運ぶ(core 構造設計 §4 の境界ルール)。
 */
export type DesiredFileData =
  // (現 templates/types.ts の DesiredEntry union 6 変種をそのまま貼り付け)
  ;

/** 旧名。凍結ゾーン(templates/)と既存テスト・apps の互換用 */
export type DesiredEntry = DesiredFileData;
```

`src/domain/model/canonical/templateSource.ts` を新規作成し、`TemplateSource` を移す(正本の読み取りポート。fragment 系 3 メソッドは v2 専用で P-e で削除):

```ts
import type { FragmentAxis, FragmentManifest } from "../../../templates/types.js";

/** 正本(canonical-files)の読み取りポート。実装: worker=GitHub API / cli=ローカル FS / test=メモリ */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
  /** 以下 3 つは v2 経路専用(P-e で削除) */
  readFragmentManifest(dir: string): Promise<FragmentManifest | null>;
  listNames(axis: FragmentAxis): Promise<string[]>;
  nameExists(axis: FragmentAxis, name: string): Promise<boolean>;
}
```

`src/domain/model/reconcile/fileChange.ts` を新規作成(computeChanges.ts から型だけ分離):

```ts
/** PR コミット内容(境界横断の運搬データ。操作を持たない) */
export interface FileChange {
  path: string;
  content: string;
}
```

`src/templates/types.ts` は自前定義を re-export に置き換える(凍結ゾーンの他ファイルを触らないため):

```ts
export type { DesiredEntry } from "../domain/model/desired/desiredFileData.js";
export type { TemplateSource } from "../domain/model/canonical/templateSource.js";
// FragmentManifest / GitignoreSection / FragmentAxis の定義はここに残す(v2 専用)
```

`src/domain/model/desired/computeChanges.ts` は FileChange を fileChange.js から import し re-export(`export type { FileChange }`)。

- [ ] **Step 3: test を src ミラーへ git mv**

```bash
cd packages/core
mkdir -p test/domain/model/{canonical,desired,reconcile,retraction,branch,manifest} \
         test/domain/type test/application/scenario test/infrastructure/github/auth

git mv test/reconcile/block.test.ts      test/domain/model/reconcile/managedBlock.test.ts
git mv test/reconcile/diff.test.ts       test/domain/model/desired/computeChanges.test.ts
git mv test/reconcile/retraction.test.ts test/domain/model/retraction/retractionPlan.test.ts
git mv test/reconcile/distRecord.test.ts test/domain/model/retraction/distRecord.test.ts
git mv test/reconcile/branch.test.ts     test/domain/model/branch/branchAction.test.ts
# manifest / github / auth / util 配下は実在するテストファイル全件を同名でミラー位置へ移す
# test/reconcile/extendsField.test.ts と test/templates/ は凍結ゾーンとして残す
```

- [ ] **Step 4: import パスを修正して green にする**

- 移動した各ファイルの相対 import(`../util/` → `../../type/` 等)を修正
- `src/index.ts` の export 元パスを新配置へ全面更新(**export される名前は 1 つも変えない**)
- `src/reconcile/extendsField.ts` の `../util/dedupe.js` → `../domain/type/dedupe.js` のみ凍結ゾーン内修正

Run: `pnpm --filter @repository-fanout/core test` → 全 PASS / `pnpm typecheck` → PASS / `pnpm test` → 全 PASS(apps は index.ts 経由なので無影響)

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "refactor(core): 業務概念パッケージへ構造移設(挙動不変。core 構造設計 §3)"
```

---

### Task 1: 依存追加 + domain/type/object.ts

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/domain/type/object.ts`
- Test: `packages/core/test/domain/type/object.test.ts`

- [ ] **Step 1: 依存を追加**

```bash
cd packages/core && pnpm add liquidjs yaml smol-toml
```

- [ ] **Step 2: 失敗するテストを書く**

`test/domain/type/object.test.ts`:

```ts
import { expect, test } from "vitest";
import { deepEqual, isPlainObject } from "../../../src/domain/type/object.js";

test("isPlainObject: object のみ true(null / 配列 / プリミティブは false)", () => {
  expect(isPlainObject({})).toBe(true);
  expect(isPlainObject(null)).toBe(false);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject("x")).toBe(false);
});

test("deepEqual: キー順に依存しない構造比較(配列は順序込み)", () => {
  expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual(1, "1")).toBe(false);
});
```

- [ ] **Step 3: FAIL 確認 → 実装 → PASS**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/type/object.test.ts` → FAIL

`src/domain/type/object.ts`:

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

Run: 同コマンド → PASS

- [ ] **Step 4: コミット**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/domain/type/object.ts packages/core/test/domain/type/object.test.ts
git commit -m "feat(core): v3 依存(liquidjs/yaml/smol-toml)と構造比較を追加"
```

---

### Task 2: Template(Liquid strict + cross_dedupe)

**Files:**
- Create: `packages/core/src/domain/model/canonical/template.ts`
- Test: `packages/core/test/domain/model/canonical/template.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/domain/model/canonical/template.test.ts`:

```ts
import { expect, test } from "vitest";
import { crossDedupe, Template } from "../../../../src/domain/model/canonical/template.js";
import { renderGitignore } from "../../../../src/templates/render.js";

const CTX = { contributions: {}, contents: {}, repo: "", account: "" };

test("変数展開と contents 参照", async () => {
  const out = await Template.of("* {{ contents.codeowner }}").render({
    ...CTX,
    contents: { codeowner: "@org/team" },
  });
  expect(out).toBe("* @org/team");
});

test("未定義変数はエラー(strict。unresolved placeholder 検出の後継)", async () => {
  await expect(Template.of("* {{ contents.codeowner }}").render(CTX)).rejects.toThrow();
});

test("raw は Liquid を通さず逐語(GitHub Actions の ${{ }} 対策)", async () => {
  const body = "run: echo ${{ secrets.TOKEN }}\n";
  expect(await Template.of(body, { raw: true }).render(CTX)).toBe(body);
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
    { comment: "node", ignores: ["node_modules/", "*.log"] }, // *.log は横断 dedupe
    { comment: "empty", ignores: ["*.log"] }, // 空になり見出しごと消える
  ];
  const legacy = renderGitignore([
    sections.map((s) => ({ section_comment: s.comment, ignores: s.ignores })),
  ]);
  const v3 = await Template.of(GITIGNORE_LIQUID).render({
    ...CTX,
    contributions: { sections },
  });
  expect(v3).toBe(legacy);
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`src/domain/model/canonical/template.ts`:

```ts
import { Liquid } from "liquidjs";
import { isPlainObject } from "../../type/object.js";

export interface RenderContext {
  contributions: Record<string, unknown>;
  contents: Record<string, string>;
  repo: string;
  account: string;
}

let sharedEngine: Liquid | undefined;

/**
 * strict 必須: 未定義変数の黙殺は「`* @{{codeowner}}` のまま配布」(kukv PR#63)の
 * 再発経路になる(spec v3 §5)。
 */
function engine(): Liquid {
  if (!sharedEngine) {
    sharedEngine = new Liquid({ strictVariables: true, strictFilters: true });
    sharedEngine.registerFilter("cross_dedupe", crossDedupe);
  }
  return sharedEngine;
}

/**
 * セクション横断 dedupe(初出優先)+ 空になったセクションの削除。
 * v2 renderGitignore の意味論のフィルタ化(spec v3 §5)。
 */
export function crossDedupe(sections: unknown, listKey: string): Array<Record<string, unknown>> {
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

/** 本文テンプレート。raw = Liquid 描画をスキップして逐語コピー(spec v3 C11) */
export class Template {
  private constructor(
    private readonly body: string,
    private readonly raw: boolean,
  ) {}

  static of(body: string, opts: { raw?: boolean } = {}): Template {
    return new Template(body, opts.raw ?? false);
  }

  async render(ctx: RenderContext): Promise<string> {
    if (this.raw) return this.body;
    return await engine().parseAndRender(this.body, ctx);
  }
}
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/canonical/template.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/canonical/template.ts packages/core/test/domain/model/canonical/template.test.ts
git commit -m "feat(core): Template(LiquidJS strict + cross_dedupe。spec v3 §5)"
```

---

### Task 3: ProfileContributes / PathContributions(寄与の検証とマージ)

**Files:**
- Create: `packages/core/src/domain/model/canonical/contribution.ts`
- Test: `packages/core/test/domain/model/canonical/contribution.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/domain/model/canonical/contribution.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  PathContributions,
  ProfileContributes,
} from "../../../../src/domain/model/canonical/contribution.js";

test("ProfileContributes.parse: 検証つき(不正 JSON / 非 object / template 型)", () => {
  expect(ProfileContributes.parse("base", null).paths).toEqual([]);
  expect(() => ProfileContributes.parse("base", "{oops")).toThrow(/invalid JSON/);
  expect(() => ProfileContributes.parse("base", "[]")).toThrow(/must be an object/);
  expect(() =>
    ProfileContributes.parse("base", JSON.stringify({ ".gitignore": { template: 1 } })),
  ).toThrow(/template must be a string/);
  const pc = ProfileContributes.parse(
    "base",
    JSON.stringify({ _comment: "note", ".gitignore": { template: "g.liquid" } }),
  );
  expect(pc.paths).toEqual([".gitignore"]); // "_" 始まりは運用コメント
});

test("PathContributions: template はちょうど 0 or 1。2 つは衝突エラー", () => {
  const one = new PathContributions(".gitignore", [
    { profile: "base", contribution: { template: "g.liquid" } },
    { profile: "ts", contribution: { sections: [] } },
  ]);
  expect(one.templateName()).toBe("g.liquid");
  const zero = new PathContributions(".gitignore", [{ profile: "ts", contribution: {} }]);
  expect(zero.templateName()).toBeUndefined();
  const two = new PathContributions(".gitignore", [
    { profile: "base", contribution: { template: "a.liquid" } },
    { profile: "oss", contribution: { template: "b.liquid" } },
  ]);
  expect(() => two.templateName()).toThrow(/template collision: \.gitignore/);
});

test("mergedData: 配列は宣言順 concat、オブジェクトは deep merge 後勝ち、template 除外、入力非破壊", () => {
  const a = {
    template: "g.liquid",
    sections: [{ ignores: ["x"] }],
    tools: { node: "20", pnpm: "9" },
  };
  const b = { sections: [{ ignores: ["y"] }], tools: { node: "22" } };
  const merged = new PathContributions("f", [
    { profile: "base", contribution: a },
    { profile: "ts", contribution: b },
  ]).mergedData();
  expect(merged).toEqual({
    sections: [{ ignores: ["x"] }, { ignores: ["y"] }],
    tools: { node: "22", pnpm: "9" },
  });
  expect(a.sections).toHaveLength(1); // 非破壊
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`src/domain/model/canonical/contribution.ts`:

```ts
import { isPlainObject } from "../../type/object.js";

/** profile 1 つ分の contributes.json(検証済み)。不正なインスタンスは存在しえない */
export class ProfileContributes {
  private constructor(
    readonly profile: string,
    private readonly entries: Map<string, Record<string, unknown>>,
  ) {}

  static parse(profile: string, raw: string | null): ProfileContributes {
    if (raw === null) return new ProfileContributes(profile, new Map());
    const label = `profiles/${profile}/contributes.json`;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${label}: invalid JSON: ${(e as Error).message}`);
    }
    if (!isPlainObject(json)) {
      throw new Error(`${label}: must be an object of path -> contribution`);
    }
    const entries = new Map<string, Record<string, unknown>>();
    for (const [path, c] of Object.entries(json)) {
      if (path.startsWith("_")) continue; // 運用コメント
      if (!isPlainObject(c)) throw new Error(`${label}: ${path}: must be an object`);
      if ("template" in c && typeof c.template !== "string") {
        throw new Error(`${label}: ${path}: template must be a string`);
      }
      entries.set(path, c);
    }
    return new ProfileContributes(profile, entries);
  }

  get paths(): string[] {
    return [...this.entries.keys()];
  }

  contributionFor(path: string): Record<string, unknown> | undefined {
    return this.entries.get(path);
  }
}

/** 1 配布先パスへの寄与列(profile 宣言順)。template 衝突検出とデータマージを持つ */
export class PathContributions {
  constructor(
    readonly path: string,
    private readonly items: Array<{ profile: string; contribution: Record<string, unknown> }>,
  ) {}

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** template 宣言 = 本文テンプレートの指定 + 配布トリガー(spec v3 §4.2)。2 つ以上は衝突 */
  templateName(): string | undefined {
    const decls = this.items.filter((i) => i.contribution.template !== undefined);
    if (decls.length > 1) {
      throw new Error(
        `template collision: ${this.path} declared by ${decls.map((d) => d.profile).join(", ")}`,
      );
    }
    return decls[0]?.contribution.template as string | undefined;
  }

  /** template キーを除いた寄与データの宣言順マージ(配列 concat / オブジェクト deep merge 後勝ち) */
  mergedData(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { contribution } of this.items) {
      const { template: _template, ...data } = contribution;
      mergeInto(out, data);
    }
    return out;
  }
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

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/canonical/contribution.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/canonical/contribution.ts packages/core/test/domain/model/canonical/contribution.test.ts
git commit -m "feat(core): ProfileContributes / PathContributions(spec v3 §4.2)"
```

---

### Task 4: 構造マージの純関数(mergeManagedArray / mergeManagedTable)

**Files:**
- Create: `packages/core/src/domain/model/reconcile/structuredDocument.ts`(この Task では型 + merge 関数のみ)
- Test: `packages/core/test/domain/model/reconcile/structuredDocument.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { expect, test } from "vitest";
import {
  mergeManagedArray,
  mergeManagedTable,
} from "../../../../src/domain/model/reconcile/structuredDocument.js";

test("array: 管理エントリ正準順 + universe 外のリポ独自(相対順)。mergeExtends の一般化", () => {
  const universe = ["a", "b", "c"];
  expect(mergeManagedArray(["c", "mine", "a"], ["a", "b"], universe)).toEqual(["a", "b", "mine"]);
  expect(mergeManagedArray("mine", ["a"], universe)).toEqual(["a", "mine"]); // 文字列単体形
  expect(mergeManagedArray(undefined, ["a"], universe)).toEqual(["a"]);
});

test("table: 管理キーは寄与値、universe 外は温存、寄与が消えた universe キーは削除", () => {
  const universe = ["node", "pnpm", "go"];
  const actual = { node: "20", go: "1.22", terraform: "1.9.0" };
  expect(mergeManagedTable(actual, { node: "22", pnpm: "10" }, universe)).toEqual({
    node: "22",
    pnpm: "10",
    terraform: "1.9.0",
  });
  expect(mergeManagedTable(undefined, { node: "22" }, universe)).toEqual({ node: "22" });
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`src/domain/model/reconcile/structuredDocument.ts`(第 1 弾):

```ts
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
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/reconcile/structuredDocument.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/reconcile/structuredDocument.ts packages/core/test/domain/model/reconcile/structuredDocument.test.ts
git commit -m "feat(core): 構造マージ純関数 array/table(spec v3 §6.2)"
```

---

### Task 5: StructuredDocument(json/toml/yaml のパース・マージ・no-op)

**Files:**
- Modify: `packages/core/src/domain/model/reconcile/structuredDocument.ts`(クラス追記)
- Test: 同テストファイルに追記

- [ ] **Step 1: 失敗するテストを追記**

```ts
import {
  type ManagedPathsSpec,
  StructuredDocument,
  StructuredParseError,
} from "../../../../src/domain/model/reconcile/structuredDocument.js";

const RENOVATE: ManagedPathsSpec = {
  managedPaths: { extends: { merge: "array" } },
  data: { extends: ["github>o/rc", "github>o/rc:ts"] },
  universe: { extends: ["github>o/rc", "github>o/rc:ts", "github>o/rc:go"] },
};

test("json: 管理フィールドだけ更新。他キー・リポ独自エントリは温存", () => {
  const doc = StructuredDocument.parse(
    "json",
    "renovate.json",
    `{\n  "$schema": "s",\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n`,
  );
  expect(JSON.parse(doc.mergedContent(RENOVATE)!)).toEqual({
    $schema: "s",
    extends: ["github>o/rc", "github>o/rc:ts", ":timezone(Asia/Tokyo)"],
  });
});

test("json: 意味的同一なら null。パース不能 / 非 object は完全コンストラクタで弾く", () => {
  const same = StructuredDocument.parse(
    "json",
    "renovate.json",
    `{"extends":["github>o/rc","github>o/rc:ts"]}`,
  );
  expect(same.mergedContent(RENOVATE)).toBeNull();
  expect(() => StructuredDocument.parse("json", "renovate.json", "{oops")).toThrow(
    StructuredParseError,
  );
  expect(() => StructuredDocument.parse("json", "renovate.json", "[]")).toThrow(
    StructuredParseError,
  );
});

const MISE: ManagedPathsSpec = {
  managedPaths: { tools: { merge: "table" } },
  data: { tools: { node: "22.12.0", "npm:prettier": "3.3.2" } },
  universe: { tools: ["node", "pnpm", "npm:prettier"] },
};

test("toml: [tools] だけマージ。quoted key・リポ独自キー温存・他セクション維持", () => {
  const doc = StructuredDocument.parse(
    "toml",
    "mise.toml",
    `[env]\nNODE_ENV = "development"\n\n[tools]\nnode = "20"\npnpm = "9"\nterraform = "1.9.0"\n`,
  );
  const next = doc.mergedContent(MISE);
  expect(next).toContain(`node = "22.12.0"`);
  expect(next).toContain(`"npm:prettier" = "3.3.2"`);
  expect(next).toContain(`terraform = "1.9.0"`);
  expect(next).not.toContain("pnpm");
  expect(next).toContain(`NODE_ENV = "development"`);
});

test("toml: 意味的同一なら null(キー順・空白差だけでは書き換えない。spec v3 C7)", () => {
  const doc = StructuredDocument.parse(
    "toml",
    "mise.toml",
    `[tools]\n\n"npm:prettier" = "3.3.2"\nnode    = "22.12.0"\n`,
  );
  expect(doc.mergedContent(MISE)).toBeNull();
});

const YAML_SPEC: ManagedPathsSpec = {
  managedPaths: { managed_list: { merge: "array" } },
  data: { managed_list: ["a", "b"] },
  universe: { managed_list: ["a", "b", "old"] },
};

test("yaml: 対象パスだけ更新し、対象外のコメントは保持", () => {
  const doc = StructuredDocument.parse(
    "yaml",
    "x.yml",
    `# repo のコメント\nother: keep\nmanaged_list:\n  - old\n  - mine\n`,
  );
  const next = doc.mergedContent(YAML_SPEC)!;
  expect(next).toContain("# repo のコメント");
  expect(next).toContain("other: keep");
  expect(next).toContain("- a");
  expect(next).toContain("- mine");
  expect(next).not.toContain("- old");
});

test("createContent: 骨格なし = 管理データのみ / 骨格あり = 骨格へマージ", () => {
  expect(StructuredDocument.createContent("toml", "mise.toml", MISE)).toBe(
    `[tools]\nnode = "22.12.0"\n"npm:prettier" = "3.3.2"\n`,
  );
  const skeleton = `{\n  "$schema": "s",\n  "extends": []\n}\n`;
  const created = StructuredDocument.createContent("json", "renovate.json", RENOVATE, skeleton);
  expect(JSON.parse(created)).toEqual({ $schema: "s", extends: ["github>o/rc", "github>o/rc:ts"] });
});
```

(toml の正準出力の細部は smol-toml の実出力に合わせて期待値を固定する。「`[tools]` 見出し + `key = value` 行 + quoted key」が保たれることが仕様)

- [ ] **Step 2: FAIL 確認 → 実装を追記**

`structuredDocument.ts` に追記:

```ts
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { type Document, parseDocument, stringify as stringifyYaml } from "yaml";
import { deepEqual } from "../../type/object.js";

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
    private readonly path: string,
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
        return new StructuredDocument(fileType, path, v);
      }
      case "toml": {
        try {
          // smol-toml の戻り型は TomlPrimitive のため unknown へ広げる(構造は plain object)
          return new StructuredDocument(
            fileType,
            path,
            parseToml(content) as Record<string, unknown>,
          );
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
        return new StructuredDocument(fileType, path, doc);
      }
    }
  }

  /**
   * managed_paths 配下だけマージした全文。意味的に同一なら null
   * (no-op。spec v3 C7: 正規化だけの書き換えをしない)。
   */
  mergedContent(spec: ManagedPathsSpec): string | null {
    const values =
      this.fileType === "yaml"
        ? ((this.parsed as Document).toJS() as Record<string, unknown>)
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
        return `${stringifyToml(obj)}\n`;
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
        return `${stringifyToml(obj)}\n`;
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
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/reconcile/structuredDocument.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/reconcile/structuredDocument.ts packages/core/test/domain/model/reconcile/structuredDocument.test.ts
git commit -m "feat(core): StructuredDocument(json/toml/yaml の構造マージ + no-op 判定)"
```

---

### Task 6: DesiredFile 階層 + computeChanges の書き換え

**Files:**
- Modify: `packages/core/src/domain/model/desired/desiredFileData.ts`(structured 2 変種を追加)
- Create: `packages/core/src/domain/model/desired/desiredFile.ts`
- Modify: `packages/core/src/domain/model/desired/computeChanges.ts`(switch → DesiredFile.from + applyTo)
- Test: `packages/core/test/domain/model/desired/computeChanges.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**(既存テストは触らない — そのまま通ることが書き換えの合格条件)

```ts
import { DesiredFile } from "../../../../src/domain/model/desired/desiredFile.js";
import type { DesiredFileData } from "../../../../src/domain/model/desired/desiredFileData.js";

const STRUCTURED: DesiredFileData = {
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
  const [change] = computeChanges([STRUCTURED], {
    "mise.toml": `[tools]\nnode = "20"\nterraform = "1.9"\n`,
  });
  expect(change?.content).toContain(`node = "22"`);
  expect(change?.content).toContain(`terraform = "1.9"`);
  expect(computeChanges([STRUCTURED], { "mise.toml": `[tools]\nnode = "22"\n` })).toEqual([]);
});

test("structured-managed-retract: universe 由来だけ除去。ファイル不在は no-op", () => {
  const retract: DesiredFileData = {
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

test("retracted(): exclude 変換の知識は DesiredFile が持つ(spec v2 §5.5)", () => {
  expect(DesiredFile.from(STRUCTURED).retracted()).toEqual({
    strategy: "structured-managed-retract",
    path: "mise.toml",
    fileType: "toml",
    managedPaths: { tools: { merge: "table" } },
    universe: { tools: ["node", "pnpm"] },
  });
  expect(DesiredFile.from({ strategy: "replace", path: "a", content: "x" }).retracted()).toBeNull();
  expect(
    DesiredFile.from({ strategy: "managed-block", path: "b", blockContent: "x" }).retracted(),
  ).toEqual({ strategy: "managed-block-retract", path: "b" });
});
```

- [ ] **Step 2: DesiredFileData を拡張**

`desiredFileData.ts` の union に 2 変種を追加:

```ts
import type { ManagedPathSpec, StructuredFileType } from "../reconcile/structuredDocument.js";

// union に追加(既存 6 変種は不変):
  /** v3: 構造化ファイルの managed_paths 管理(extends-field の一般化。spec v3 §6.2) */
  | {
      strategy: "structured-managed";
      path: string;
      fileType: StructuredFileType;
      managedPaths: Record<string, ManagedPathSpec>;
      data: Record<string, unknown>;
      universe: Record<string, string[]>;
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

- [ ] **Step 3: DesiredFile 階層を実装**

`src/domain/model/desired/desiredFile.ts`:

```ts
import { applyExtendsField } from "../../../reconcile/extendsField.js"; // 凍結 v2 資産(P-e で削除)
import type { FileChange } from "../reconcile/fileChange.js";
import { applyManagedBlock, removeManagedBlock } from "../reconcile/managedBlock.js";
import {
  type ManagedPathsSpec,
  StructuredDocument,
  type StructuredFileType,
} from "../reconcile/structuredDocument.js";
import type { DesiredFileData } from "./desiredFileData.js";

/**
 * 望ましいファイル(strategy 別)。データと突合操作を一緒に持つドメインオブジェクト。
 * 境界(step.do / KV)は plain な DesiredFileData で越え、内側で from() で載せ替える
 * (core 構造設計 §4)。
 */
export abstract class DesiredFile {
  abstract readonly path: string;
  /** 実ファイルとの突合。変更不要なら null(no-op) */
  abstract applyTo(actual: string | undefined): FileChange | null;
  /** exclude 時の姿(spec v2 §5.5)。null = 配布対象から外す(replace / create-only) */
  abstract retracted(): DesiredFileData | null;

  static from(data: DesiredFileData): DesiredFile {
    switch (data.strategy) {
      case "replace":
        return new ReplaceFile(data.path, data.content);
      case "create-only":
        return new CreateOnlyFile(data.path, data.content);
      case "managed-block":
        return new ManagedBlockFile(data.path, data.blockContent);
      case "managed-block-retract":
        return new ManagedBlockRetractFile(data.path);
      case "extends-field":
        return new ExtendsFieldFile(data.path, data.managedExtends, data.universe, data.createContent);
      case "extends-field-retract":
        return new ExtendsFieldRetractFile(data.path, data.universe);
      case "structured-managed":
        return new StructuredManagedFile(data.path, data.fileType, data, data.createContent);
      case "structured-managed-retract":
        return new StructuredManagedRetractFile(data.path, data.fileType, data.managedPaths, data.universe);
      default: {
        // 戦略を追加したらここがコンパイルエラーになる(silent no-op を防ぐ。旧 diff.ts と同じ)
        const _exhaustive: never = data;
        throw new Error(`unknown desired file strategy: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

class ReplaceFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly content: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    return actual !== this.content ? { path: this.path, content: this.content } : null;
  }
  retracted(): DesiredFileData | null {
    return null; // ファイルには触らず記録の引き渡しのみ(worker の retraction 側)
  }
}

class CreateOnlyFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly content: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    return actual === undefined ? { path: this.path, content: this.content } : null;
  }
  retracted(): DesiredFileData | null {
    return null;
  }
}

class ManagedBlockFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly blockContent: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    const next = applyManagedBlock(actual, this.blockContent);
    return next !== actual ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "managed-block-retract", path: this.path };
  }
}

class ManagedBlockRetractFile extends DesiredFile {
  constructor(readonly path: string) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return null; // ファイルが無ければ寄与ゼロ達成済み
    const next = removeManagedBlock(actual);
    return next !== undefined && next !== actual ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "managed-block-retract", path: this.path };
  }
}

/** v2 凍結資産のラッパ(P-e で StructuredManagedFile に吸収して削除) */
class ExtendsFieldFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly managedExtends: string[],
    private readonly universe: string[],
    private readonly createContent: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return { path: this.path, content: this.createContent };
    const next = applyExtendsField(actual, this.managedExtends, this.universe);
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "extends-field-retract", path: this.path, universe: this.universe };
  }
}

class ExtendsFieldRetractFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly universe: string[],
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return null; // 新規作成はしない
    const next = applyExtendsField(actual, [], this.universe);
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "extends-field-retract", path: this.path, universe: this.universe };
  }
}

class StructuredManagedFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly fileType: StructuredFileType,
    private readonly spec: ManagedPathsSpec,
    private readonly createContent: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return { path: this.path, content: this.createContent };
    const next = StructuredDocument.parse(this.fileType, this.path, actual).mergedContent(this.spec);
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return {
      strategy: "structured-managed-retract",
      path: this.path,
      fileType: this.fileType,
      managedPaths: this.spec.managedPaths,
      universe: this.spec.universe,
    };
  }
}

class StructuredManagedRetractFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly fileType: StructuredFileType,
    private readonly managedPaths: ManagedPathsSpec["managedPaths"],
    private readonly universe: Record<string, string[]>,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return null;
    const empty: Record<string, unknown> = {};
    for (const [key, s] of Object.entries(this.managedPaths)) {
      empty[key] = s.merge === "array" ? [] : {};
    }
    const next = StructuredDocument.parse(this.fileType, this.path, actual).mergedContent({
      managedPaths: this.managedPaths,
      data: empty,
      universe: this.universe,
    });
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return {
      strategy: "structured-managed-retract",
      path: this.path,
      fileType: this.fileType,
      managedPaths: this.managedPaths,
      universe: this.universe,
    };
  }
}
```

- [ ] **Step 4: computeChanges を書き換え**

`computeChanges.ts` の switch 全体を置換:

```ts
import type { FileChange } from "../reconcile/fileChange.js";
import { DesiredFile } from "./desiredFile.js";
import type { DesiredFileData } from "./desiredFileData.js";

export type { FileChange };

/**
 * desired(plain)と実ファイル内容を突き合わせ、書き込むべき変更を返す。
 * 戦略別の判断は DesiredFile 階層(applyTo)に委譲。ここは境界の載せ替えだけ
 * (core 構造設計 §4: step.do を越えてきた plain データをドメインオブジェクトに戻す)。
 */
export function computeChanges(
  desired: DesiredFileData[],
  actual: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const d of desired) {
    const change = DesiredFile.from(d).applyTo(actual[d.path]);
    if (change !== null) changes.push(change);
  }
  return changes;
}
```

- [ ] **Step 5: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/desired/computeChanges.test.ts` → **既存テスト含め全 PASS**(書き換えの合格条件)

```bash
git add packages/core/src/domain/model/desired packages/core/test/domain/model/desired
git commit -m "feat(core): DesiredFile 階層(strategy ポリモーフィズム)へ computeChanges を委譲"
```

---

### Task 7: Catalog / CatalogEntry(mode ポリモーフィズム)

**Files:**
- Create: `packages/core/src/domain/model/canonical/catalogEntry.ts`
- Create: `packages/core/src/domain/model/canonical/catalog.ts`
- Test: `packages/core/test/domain/model/canonical/catalog.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/domain/model/canonical/catalog.test.ts`:

```ts
import { expect, test } from "vitest";
import { Catalog } from "../../../../src/domain/model/canonical/catalog.js";
import {
  ManagedStructuredFile,
  ManagedTextFile,
  ReplacedFile,
} from "../../../../src/domain/model/canonical/catalogEntry.js";
import { PathContributions } from "../../../../src/domain/model/canonical/contribution.js";
import { Template } from "../../../../src/domain/model/canonical/template.js";

const VALID = JSON.stringify({
  files: {
    _comment: "note",
    ".gitignore": { file_type: "text", mode: "managed" },
    "renovate.json": {
      file_type: "json",
      mode: "managed",
      managed_paths: { extends: { merge: "array" } },
    },
    "SECURITY.md": { file_type: "markdown", mode: "replaced" },
  },
});

test("Catalog.parse: 完全コンストラクタ(検証を通らないインスタンスは作れない)", () => {
  const c = Catalog.parse(VALID);
  expect(c.paths).toEqual([".gitignore", "renovate.json", "SECURITY.md"]); // "_" は無視
  expect(c.entryFor(".gitignore")).toBeInstanceOf(ManagedTextFile);
  expect(c.entryFor("renovate.json")).toBeInstanceOf(ManagedStructuredFile);
  expect(c.entryFor("SECURITY.md")).toBeInstanceOf(ReplacedFile);

  expect(() => Catalog.parse(null)).toThrow(/catalog\.json not found/);
  expect(() => Catalog.parse("{oops")).toThrow(/invalid JSON/);
  expect(() => Catalog.parse('{"files":{}}')).toThrow(/must not be empty/);
  expect(() => Catalog.parse('{"files":{"a":{"file_type":"ini","mode":"replaced"}}}')).toThrow(
    /unknown file_type/,
  );
  expect(() => Catalog.parse('{"files":{"a":{"file_type":"text","mode":"sync"}}}')).toThrow(
    /unknown mode/,
  );
  expect(() => Catalog.parse('{"files":{"a.json":{"file_type":"json","mode":"managed"}}}')).toThrow(
    /requires managed_paths/,
  );
  expect(() =>
    Catalog.parse(
      '{"files":{"a.txt":{"file_type":"text","mode":"managed","managed_paths":{"x":{"merge":"array"}}}}}',
    ),
  ).toThrow(/only for managed structured/);
});

test("assertKnownPaths: catalog 未登録パスの寄与はタイポとして fail fast", () => {
  const c = Catalog.parse(VALID);
  expect(() => c.assertKnownPaths("ts", ["renovte.json"])).toThrow(
    /profiles\/ts\/contributes\.json: path not in catalog: renovte\.json/,
  );
  c.assertKnownPaths("ts", ["renovate.json"]); // OK
});

const CTX = { contributions: {}, contents: {}, repo: "", account: "" };

test("deriveDesired: mode 別ポリモーフィズム", async () => {
  const c = Catalog.parse(VALID);

  const sec = c.entryFor("SECURITY.md")!;
  await expect(
    sec.deriveDesired({
      contributions: new PathContributions("SECURITY.md", [{ profile: "oss", contribution: {} }]),
      template: undefined,
      ctx: CTX,
      universe: {},
    }),
  ).rejects.toThrow(/no template declared for SECURITY\.md/);
  expect(
    await sec.deriveDesired({
      contributions: new PathContributions("SECURITY.md", [{ profile: "oss", contribution: {} }]),
      template: Template.of("# Security\n"),
      ctx: CTX,
      universe: {},
    }),
  ).toEqual({ strategy: "replace", path: "SECURITY.md", content: "# Security\n" });

  // managed text: 描画結果の末尾改行 1 つを落として blockContent に
  const gi = c.entryFor(".gitignore")!;
  expect(
    await gi.deriveDesired({
      contributions: new PathContributions(".gitignore", [{ profile: "base", contribution: {} }]),
      template: Template.of("block\n"),
      ctx: CTX,
      universe: {},
    }),
  ).toEqual({ strategy: "managed-block", path: ".gitignore", blockContent: "block" });

  // managed structured: 寄与キー検証・universe 同梱・createContent 生成
  const rn = c.entryFor("renovate.json")!;
  const derived = await rn.deriveDesired({
    contributions: new PathContributions("renovate.json", [
      { profile: "base", contribution: { extends: ["github>o/rc"] } },
    ]),
    template: undefined,
    ctx: CTX,
    universe: { extends: ["github>o/rc", "github>o/rc:go"] },
  });
  if (derived.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(derived.data.extends).toEqual(["github>o/rc"]);
  expect(JSON.parse(derived.createContent)).toEqual({ extends: ["github>o/rc"] });

  await expect(
    rn.deriveDesired({
      contributions: new PathContributions("renovate.json", [
        { profile: "ts", contribution: { extend: ["typo"] } },
      ]),
      template: undefined,
      ctx: CTX,
      universe: {},
    }),
  ).rejects.toThrow(/not a managed path.*extend/);
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`src/domain/model/canonical/catalogEntry.ts`:

```ts
import { isPlainObject } from "../../type/object.js";
import type { DesiredFileData } from "../desired/desiredFileData.js";
import {
  type ManagedPathSpec,
  StructuredDocument,
  type StructuredFileType,
} from "../reconcile/structuredDocument.js";
import type { PathContributions } from "./contribution.js";
import type { RenderContext, Template } from "./template.js";

const FILE_TYPES = new Set(["text", "markdown", "json", "yaml", "toml"]);
const MERGE_KINDS = new Set(["array", "table"]);
const STRUCTURED = new Set(["json", "yaml", "toml"]);

export interface DeriveArgs {
  contributions: PathContributions;
  /** contributes の template 宣言から解決済みの本文(未宣言なら undefined) */
  template: Template | undefined;
  ctx: RenderContext;
  /** managed path → 全 profile 寄与の和集合(構造化 managed のみ使用) */
  universe: Record<string, string[]>;
}

/**
 * catalog.json の 1 エントリ(spec v3 §4.1)。mode 別の導出をポリモーフィズムで持ち、
 * 検証を通らないエントリのインスタンスは存在しえない(完全コンストラクタ)。
 */
export abstract class CatalogEntry {
  protected constructor(
    readonly path: string,
    readonly raw: boolean,
  ) {}

  static parse(path: string, v: unknown): CatalogEntry {
    if (!isPlainObject(v)) throw new Error(`catalog.json: ${path}: must be an object`);
    const { file_type, mode, managed_paths, raw } = v;
    if (typeof file_type !== "string" || !FILE_TYPES.has(file_type)) {
      throw new Error(`catalog.json: ${path}: unknown file_type: ${JSON.stringify(file_type)}`);
    }
    if (raw !== undefined && typeof raw !== "boolean") {
      throw new Error(`catalog.json: ${path}: raw must be boolean`);
    }
    const isRaw = raw ?? false;
    if (mode === "managed" && STRUCTURED.has(file_type)) {
      return new ManagedStructuredFile(
        path,
        isRaw,
        file_type as StructuredFileType,
        parseManagedPaths(path, managed_paths),
      );
    }
    if (managed_paths !== undefined) {
      throw new Error(`catalog.json: ${path}: managed_paths is only for managed structured files`);
    }
    if (mode === "replaced") return new ReplacedFile(path, isRaw);
    if (mode === "create-only") return new CreateOnlyFile(path, isRaw);
    if (mode === "managed") return new ManagedTextFile(path, isRaw);
    throw new Error(`catalog.json: ${path}: unknown mode: ${JSON.stringify(mode)}`);
  }

  abstract deriveDesired(args: DeriveArgs): Promise<DesiredFileData>;

  protected async renderRequired(args: DeriveArgs): Promise<string> {
    if (args.template === undefined) throw new Error(`no template declared for ${this.path}`);
    return await args.template.render(args.ctx);
  }
}

function parseManagedPaths(path: string, v: unknown): Record<string, ManagedPathSpec> {
  if (!isPlainObject(v) || Object.keys(v).length === 0) {
    throw new Error(`catalog.json: ${path}: managed structured file requires managed_paths`);
  }
  for (const [key, spec] of Object.entries(v)) {
    if (!isPlainObject(spec) || typeof spec.merge !== "string" || !MERGE_KINDS.has(spec.merge)) {
      throw new Error(`catalog.json: ${path}: managed_paths.${key}: merge must be "array" | "table"`);
    }
  }
  return v as unknown as Record<string, ManagedPathSpec>;
}

export class ReplacedFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    return { strategy: "replace", path: this.path, content: await this.renderRequired(args) };
  }
}

export class CreateOnlyFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    return { strategy: "create-only", path: this.path, content: await this.renderRequired(args) };
  }
}

export class ManagedTextFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    const content = await this.renderRequired(args);
    return { strategy: "managed-block", path: this.path, blockContent: content.replace(/\n$/, "") };
  }
}

export class ManagedStructuredFile extends CatalogEntry {
  constructor(
    path: string,
    raw: boolean,
    readonly structuredType: StructuredFileType,
    readonly managedPaths: Record<string, ManagedPathSpec>,
  ) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    const data = args.contributions.mergedData();
    for (const key of Object.keys(data)) {
      if (!(key in this.managedPaths)) {
        throw new Error(`${this.path}: contribution key is not a managed path (typo?): ${key}`);
      }
    }
    const spec = { managedPaths: this.managedPaths, data, universe: args.universe };
    const skeleton = args.template === undefined ? undefined : await args.template.render(args.ctx);
    return {
      strategy: "structured-managed",
      path: this.path,
      fileType: this.structuredType,
      ...spec,
      createContent: StructuredDocument.createContent(this.structuredType, this.path, spec, skeleton),
    };
  }
}
```

`src/domain/model/canonical/catalog.ts`:

```ts
import { isPlainObject } from "../../type/object.js";
import { CatalogEntry } from "./catalogEntry.js";

/**
 * catalog.json(spec v3 §4.1)。raw=null(不在)は fail fast:
 * strategies.json 不在 fail fast(v2)の後継。「書いてなければ replace」の暗黙を認めない。
 */
export class Catalog {
  private constructor(private readonly entries: Map<string, CatalogEntry>) {}

  static parse(raw: string | null): Catalog {
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
    const entries = new Map<string, CatalogEntry>();
    for (const [path, v] of Object.entries(json.files)) {
      if (path.startsWith("_")) continue; // 運用コメント
      entries.set(path, CatalogEntry.parse(path, v));
    }
    if (entries.size === 0) throw new Error("catalog.json: files must not be empty");
    return new Catalog(entries);
  }

  get paths(): string[] {
    return [...this.entries.keys()];
  }

  entryFor(path: string): CatalogEntry | undefined {
    return this.entries.get(path);
  }

  /** contributes.json のパスが catalog 登録済みかの検証(タイポ検出。spec v3 C10) */
  assertKnownPaths(profile: string, paths: string[]): void {
    for (const p of paths) {
      if (!this.entries.has(p)) {
        throw new Error(`profiles/${profile}/contributes.json: path not in catalog: ${p}`);
      }
    }
  }
}
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/canonical/catalog.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/canonical packages/core/test/domain/model/canonical
git commit -m "feat(core): Catalog / CatalogEntry(mode ポリモーフィズム。spec v3 §4.1)"
```

---

### Task 8: Profiles + deriveDesiredFiles + resolveDesired(自動切替)

**Files:**
- Create: `packages/core/src/domain/model/canonical/profiles.ts`
- Create: `packages/core/src/domain/model/desired/derive.ts`
- Modify: `packages/core/src/index.ts`(v3 export 追加)
- Test: `packages/core/test/domain/model/desired/derive.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/domain/model/desired/derive.test.ts`:

```ts
import { expect, test } from "vitest";
import type { TemplateSource } from "../../../../src/domain/model/canonical/templateSource.js";
import { deriveDesiredFiles, resolveDesired } from "../../../../src/domain/model/desired/derive.js";

/** v3 は readFile / listFiles しか使わない */
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

const FILES: Record<string, string> = {
  "catalog.json": JSON.stringify({
    files: {
      ".gitignore": { file_type: "text", mode: "managed" },
      ".github/CODEOWNERS": { file_type: "text", mode: "managed" },
      "renovate.json": {
        file_type: "json",
        mode: "managed",
        managed_paths: { extends: { merge: "array" } },
      },
      "SECURITY.md": { file_type: "markdown", mode: "replaced" },
    },
  }),
  "templates/gitignore.liquid": `{{ contributions.sections | cross_dedupe: "ignores" | json }}`,
  "templates/codeowners.liquid": "* {{ contents.codeowner }}\n",
  "templates/security.liquid": "# Security\n",
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
  }),
};

const baseArgs = {
  languages: ["typescript"],
  bundles: [] as string[],
  contents: { codeowner: "@org/team" },
  exclude: [] as string[],
};

test("配布トリガー: 宣言 profile が寄与したパスだけ。universe は全 profile 由来", async () => {
  const entries = await deriveDesiredFiles({ source: memorySourceV3(FILES), ...baseArgs });
  expect(entries.map((e) => e.path).sort()).toEqual([
    ".github/CODEOWNERS",
    ".gitignore",
    "renovate.json",
  ]);
  const co = entries.find((e) => e.path === ".github/CODEOWNERS");
  expect(co).toEqual({
    strategy: "managed-block",
    path: ".github/CODEOWNERS",
    blockContent: "* @org/team",
  });
  const rn = entries.find((e) => e.path === "renovate.json");
  if (rn?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(rn.data.extends).toEqual(["github>o/rc", "github>o/rc:ts"]);
  expect(rn.universe.extends).toEqual(
    expect.arrayContaining(["github>o/rc", "github>o/rc:ts", "github>o/rc:go"]),
  );
});

test("bundles 宣言で oss の SECURITY.md が加わる / exclude は retract 化", async () => {
  const entries = await deriveDesiredFiles({
    source: memorySourceV3(FILES),
    ...baseArgs,
    bundles: ["oss"],
    exclude: [".gitignore", "renovate.json", "SECURITY.md"],
  });
  const strategies = Object.fromEntries(entries.map((e) => [e.path, e.strategy]));
  expect(strategies[".gitignore"]).toBe("managed-block-retract");
  expect(strategies["renovate.json"]).toBe("structured-managed-retract");
  expect(strategies["SECURITY.md"]).toBeUndefined(); // replace は配布対象から外れる
});

test("fail fast: 未知 profile / 未登録パス / template 不在", async () => {
  await expect(
    deriveDesiredFiles({ source: memorySourceV3(FILES), ...baseArgs, languages: ["ruby"] }),
  ).rejects.toThrow(/unknown profile: ruby/);
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...FILES,
        "profiles/typescript/contributes.json": JSON.stringify({ "renovte.json": {} }),
      }),
      ...baseArgs,
    }),
  ).rejects.toThrow(/path not in catalog: renovte\.json/);
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...FILES,
        "profiles/base/contributes.json": JSON.stringify({
          ".github/CODEOWNERS": { template: "nope.liquid" },
        }),
      }),
      ...baseArgs,
    }),
  ).rejects.toThrow(/template not found/);
});

test("resolveDesired: catalog.json が無ければ v2 経路(strategies.json)へ委譲", async () => {
  const files: Record<string, string> = {
    "strategies.json": '{".gitignore":"managed-block"}',
    "base/files/.gitignore": "{{gitignore}}\n",
  };
  const legacy: TemplateSource = {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest(dir) {
      return dir === "base"
        ? { gitignore: [{ section_comment: "base", ignores: [".DS_Store"] }] }
        : null;
    },
    async listNames() {
      return [];
    },
    async nameExists() {
      return false;
    },
  };
  const entries = await resolveDesired({
    source: legacy,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
  });
  expect(entries).toEqual([
    { strategy: "managed-block", path: ".gitignore", blockContent: "### base ###\n.DS_Store" },
  ]);
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`src/domain/model/canonical/profiles.ts`:

```ts
import { dedupePreserveOrder } from "../../type/dedupe.js";
import { isPlainObject } from "../../type/object.js";
import type { ManagedPathSpec } from "../reconcile/structuredDocument.js";
import type { Catalog } from "./catalog.js";
import { PathContributions, ProfileContributes } from "./contribution.js";
import type { TemplateSource } from "./templateSource.js";

/**
 * profile の集合(spec v3 C2/C9)。宣言 = base + languages 宣言順 + bundles 宣言順。
 * universe 計算のため全 profile の contributes も保持する。
 */
export class Profiles {
  private constructor(
    private readonly declared: string[],
    private readonly byProfile: Map<string, ProfileContributes>,
  ) {}

  static async load(
    source: TemplateSource,
    languages: string[],
    bundles: string[],
  ): Promise<Profiles> {
    const declared = dedupePreserveOrder(["base", ...languages, ...bundles]);
    const names = new Set<string>();
    for (const p of await source.listFiles("profiles/")) {
      const m = /^profiles\/([^/]+)\//.exec(p);
      if (m?.[1]) names.add(m[1]);
    }
    for (const p of declared) {
      if (!names.has(p)) throw new Error(`unknown profile: ${p}`);
    }
    const byProfile = new Map<string, ProfileContributes>();
    for (const p of [...names].sort()) {
      byProfile.set(
        p,
        ProfileContributes.parse(p, await source.readFile(`profiles/${p}/contributes.json`)),
      );
    }
    return new Profiles(declared, byProfile);
  }

  /** 全 profile の全寄与パスが catalog 登録済みかの検証 */
  assertPathsKnown(catalog: Catalog): void {
    for (const [profile, pc] of this.byProfile) {
      catalog.assertKnownPaths(profile, pc.paths);
    }
  }

  /** 宣言 profile の寄与列(宣言順) */
  contributionsFor(path: string): PathContributions {
    const items: Array<{ profile: string; contribution: Record<string, unknown> }> = [];
    for (const p of this.declared) {
      const c = this.byProfile.get(p)?.contributionFor(path);
      if (c !== undefined) items.push({ profile: p, contribution: c });
    }
    return new PathContributions(path, items);
  }

  /** universe = 全 profile(選択有無を問わない)の寄与の和集合(spec v3 §6.2) */
  universeFor(
    path: string,
    managedPaths: Record<string, ManagedPathSpec>,
  ): Record<string, string[]> {
    const universe: Record<string, string[]> = {};
    for (const [key, spec] of Object.entries(managedPaths)) {
      const values: string[] = [];
      for (const pc of this.byProfile.values()) {
        const v = pc.contributionFor(path)?.[key];
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
}
```

`src/domain/model/desired/derive.ts`:

```ts
import { resolveDesiredEntries } from "../../../templates/resolve.js"; // 凍結 v2 経路(P-e で削除)
import { Catalog } from "../canonical/catalog.js";
import { ManagedStructuredFile } from "../canonical/catalogEntry.js";
import { Profiles } from "../canonical/profiles.js";
import { Template } from "../canonical/template.js";
import type { TemplateSource } from "../canonical/templateSource.js";
import { DesiredFile } from "./desiredFile.js";
import type { DesiredFileData } from "./desiredFileData.js";

export interface DeriveDesiredArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** リポ個別値(tf 側 fanout.contents。v2 vars の後継) */
  contents: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/** v3 resolve(spec v3 §4〜§6)。catalog を正とし、profile 寄与から望ましい状態を導出 */
export async function deriveDesiredFiles(args: DeriveDesiredArgs): Promise<DesiredFileData[]> {
  const catalog = Catalog.parse(await args.source.readFile("catalog.json"));
  const profiles = await Profiles.load(args.source, args.languages, args.bundles);
  profiles.assertPathsKnown(catalog);

  const byDest = new Map<string, DesiredFileData>();
  for (const path of catalog.paths) {
    const entry = catalog.entryFor(path);
    if (!entry) continue;
    const contributions = profiles.contributionsFor(path);
    if (contributions.isEmpty) continue; // どの宣言 profile も寄与しない → 配布しない

    const name = contributions.templateName();
    let template: Template | undefined;
    if (name !== undefined) {
      const body = await args.source.readFile(`templates/${name}`);
      if (body === null) throw new Error(`template not found: templates/${name} (for ${path})`);
      template = Template.of(body, { raw: entry.raw });
    }

    const universe =
      entry instanceof ManagedStructuredFile ? profiles.universeFor(path, entry.managedPaths) : {};
    byDest.set(
      path,
      await entry.deriveDesired({
        contributions,
        template,
        ctx: {
          contributions: contributions.mergedData(),
          contents: args.contents,
          repo: args.repo ?? "",
          account: args.account ?? "",
        },
        universe,
      }),
    );
  }

  // exclude = 寄与ゼロへ収束(spec v2 §5.5)。変換の知識は DesiredFile が持つ
  for (const ex of args.exclude) {
    const d = byDest.get(ex);
    if (!d) continue;
    const r = DesiredFile.from(d).retracted();
    if (r === null) byDest.delete(ex);
    else byDest.set(ex, r);
  }
  return [...byDest.values()];
}

export interface ResolveAutoArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** v2 呼び出し互換のため名前は vars(v3 では contents として渡る) */
  vars: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/**
 * 新旧 resolver の自動切替(spec v3 §9 P-a)。切替スイッチは catalog.json の有無:
 * canonical-files 側の merge / revert だけで v3 移行とロールバックが完結する。
 */
export async function resolveDesired(args: ResolveAutoArgs): Promise<DesiredFileData[]> {
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
  return deriveDesiredFiles({
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

`src/index.ts` に追記:

```ts
export { Catalog } from "./domain/model/canonical/catalog.js";
export {
  CatalogEntry,
  CreateOnlyFile,
  ManagedStructuredFile,
  ManagedTextFile,
  ReplacedFile,
} from "./domain/model/canonical/catalogEntry.js";
export { PathContributions, ProfileContributes } from "./domain/model/canonical/contribution.js";
export { Profiles } from "./domain/model/canonical/profiles.js";
export { crossDedupe, Template } from "./domain/model/canonical/template.js";
export type { RenderContext } from "./domain/model/canonical/template.js";
export { deriveDesiredFiles, resolveDesired } from "./domain/model/desired/derive.js";
export type { DeriveDesiredArgs, ResolveAutoArgs } from "./domain/model/desired/derive.js";
export { DesiredFile } from "./domain/model/desired/desiredFile.js";
export type { DesiredFileData } from "./domain/model/desired/desiredFileData.js";
export {
  mergeManagedArray,
  mergeManagedTable,
  StructuredDocument,
  StructuredParseError,
} from "./domain/model/reconcile/structuredDocument.js";
export type {
  ManagedPathSpec,
  ManagedPathsSpec,
  MergeKind,
  StructuredFileType,
} from "./domain/model/reconcile/structuredDocument.js";
export { deepEqual, isPlainObject } from "./domain/type/object.js";
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/desired/derive.test.ts` → PASS
Run: `pnpm --filter @repository-fanout/core test` → 全 PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): Profiles / deriveDesiredFiles / resolveDesired 自動切替(spec v3 §9)"
```

---

### Task 9: manifest の contents(vars 後継)受理

**Files:**
- Modify: `packages/core/src/domain/model/manifest/parse.ts`
- Test: `packages/core/test/domain/model/manifest/parse.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**

```ts
test("contents は vars の後継として受理(RepoEntry.vars に入る)", () => {
  const m = parseManifest({
    account: "o",
    revision: 1,
    sourceCommit: "c",
    repositories: { r: { languages: ["typescript"], contents: { codeowner: "@org/team" } } },
  });
  expect(m.repositories.r?.vars).toEqual({ codeowner: "@org/team" });
});

test("contents と vars の両方宣言はエラー(曖昧さの排除)", () => {
  expect(() =>
    parseManifest({
      account: "o",
      revision: 1,
      sourceCommit: "c",
      repositories: { r: { languages: [], contents: { a: "1" }, vars: { a: "2" } } },
    }),
  ).toThrow(/either contents or vars/);
});
```

- [ ] **Step 2: FAIL 確認 → 実装**

`parse.ts` — vars 検証ブロックの直前に挿入し、以降の検証・代入の参照元を `varsSource` に置換:

```ts
    // contents は vars の後継(spec v3 §8)。移行期間中は両キーを受理するが、
    // 両方の同時宣言はどちらが勝つか曖昧なのでエラー。Manifest は HTTP/KV 境界を
    // 越える値なので plain + parse 関数のまま(core 構造設計 §4)。
    let varsSource = entry.vars;
    if (entry.contents !== undefined) {
      if (entry.vars !== undefined) {
        throw new Error(`manifest: ${name}: declare either contents or vars, not both`);
      }
      varsSource = entry.contents;
    }
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/manifest/parse.test.ts` → PASS

- [ ] **Step 3: コミット**

```bash
git add packages/core/src/domain/model/manifest/parse.ts packages/core/test/domain/model/manifest/parse.test.ts
git commit -m "feat(core): manifest の contents キーを vars の後継として受理(spec v3 §8)"
```

---

### Task 10: application/scenario + worker / cli 配線

**Files:**
- Create: `packages/core/src/application/scenario/reconcileRepository.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/worker/src/workflows/child.ts`
- Modify: `apps/cli/src/planRepo.ts` / `apps/cli/src/applyRepo.ts` / `apps/cli/src/validateDir.ts`
- Test: `packages/core/test/application/scenario/reconcileRepository.test.ts`

- [ ] **Step 1: scenario のテストを書く**

```ts
import { expect, test } from "vitest";
import { pathsToRead } from "../../../src/application/scenario/reconcileRepository.js";

test("pathsToRead: 望ましい状態 ∪ 配布記録だけにあるパス(削除候補)", () => {
  const desired = [{ strategy: "replace", path: "a", content: "" } as const];
  const record = {
    version: 1 as const,
    files: {
      a: { strategy: "replace" as const, hashes: [] },
      gone: { strategy: "replace" as const, hashes: [] },
    },
  };
  expect(pathsToRead(desired, record)).toEqual(["a", "gone"]);
});
```

- [ ] **Step 2: scenario を実装**

`src/application/scenario/reconcileRepository.ts`:

```ts
import type { TemplateSource } from "../../domain/model/canonical/templateSource.js";
import { computeChanges } from "../../domain/model/desired/computeChanges.js";
import { resolveDesired } from "../../domain/model/desired/derive.js";
import type { DesiredFileData } from "../../domain/model/desired/desiredFileData.js";
import type { DistRecord } from "../../domain/model/retraction/distRecord.js";
import { planRetraction } from "../../domain/model/retraction/retractionPlan.js";

/**
 * 1 リポの reconcile の進行役(spec v2 §5.4 / core 構造設計 §6)。
 * 各関数が Workflows の 1 step に対応: 進行の知識はここに一本化し、
 * 実行制御(retry / step.do / 並行)は apps に残す。step 間は plain データで受け渡す。
 */
export interface ReconcileDeclaration {
  languages: string[];
  bundles: string[];
  vars: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/** step 1: 望ましい状態の導出(catalog.json の有無で新旧自動切替) */
export function resolveDesiredStep(
  source: TemplateSource,
  decl: ReconcileDeclaration,
): Promise<DesiredFileData[]> {
  return resolveDesired({ source, ...decl });
}

/** step 2: 実ファイルを読むべきパス = 望ましい状態 ∪ 配布記録だけにあるパス(削除候補) */
export function pathsToRead(desired: DesiredFileData[], record: DistRecord): string[] {
  const desiredPaths = desired.map((d) => d.path);
  const recordOnly = Object.keys(record.files).filter((p) => !desiredPaths.includes(p));
  return [...desiredPaths, ...recordOnly];
}

/** step 3: 差分計算 / step 4: 削除追従計画(既存関数をそのまま進行に位置づける) */
export { computeChanges as computeChangesStep, planRetraction as planRetractionStep };
```

`src/index.ts` に追記:

```ts
export {
  computeChangesStep,
  pathsToRead,
  planRetractionStep,
  resolveDesiredStep,
} from "./application/scenario/reconcileRepository.js";
export type { ReconcileDeclaration } from "./application/scenario/reconcileRepository.js";
```

Run: `pnpm --filter @repository-fanout/core exec vitest run test/application/scenario/reconcileRepository.test.ts` → PASS

- [ ] **Step 3: worker child.ts を配線**

1. import: `resolveDesiredEntries` → `resolveDesiredStep, pathsToRead`、`StructuredParseError` を追加
2. resolve 呼び出し(現 119-129 行)を置換:

```ts
    const desired = await step.do("resolve desired", async () =>
      retry(() =>
        resolveDesiredStep(templates, {
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

3. 実読パスの手組み(現 136-140 行)を置換(直後の `planRetraction` 用に `desiredPaths` はローカルに残す):

```ts
    const desiredPaths = desired.map((d) => d.path);
    const readPaths = pathsToRead(desired, record);
    const actual = await step.do("read actual", () =>
      retry(() => io.readActualFiles(readPaths, base.branch)),
    );
```

4. computeChanges の catch(現 146 行)を拡張(StructuredParseError = 配布先の実ファイルがパース不能。RenovateParseError と同じく「そのリポを failed 記録して他リポは続行」):

```ts
      if (err instanceof RenovateParseError || err instanceof StructuredParseError) {
```

- [ ] **Step 4: cli を配線**

- `planRepo.ts` / `applyRepo.ts`: `resolveDesiredEntries({ source, languages, bundles, vars, exclude })` → `resolveDesiredStep(args.source, { languages, bundles, vars, exclude })` に置換(import も変更)
- `validateDir.ts`: 既存 import に `Catalog` / `resolveDesired` を追加し、先頭に v3 分岐(既存 v2 検証は無変更):

```ts
export async function validateSource(source: TemplateSource): Promise<string[]> {
  if ((await source.readFile("catalog.json")) !== null) return validateCatalogSource(source);
  // ... 既存の v2 検証(そのまま) ...
}

/**
 * v3 レイアウトの検証(spec v3 §10)。catalog / contributes / template の整合は
 * resolver 自体が fail fast するので、全 profile 組合せの描画スモークを回す。
 */
async function validateCatalogSource(source: TemplateSource): Promise<string[]> {
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

- [ ] **Step 5: 全テスト + Workers バンドル検証 → コミット**

Run: `pnpm test` → 全 PASS(worker 既存テストは catalog.json 無しのメモリ source = 旧経路のまま通る)
Run: `pnpm typecheck` → PASS
Run: `pnpm --filter @repository-fanout/worker exec wrangler deploy --dry-run` → バンドル成功(liquidjs / yaml / smol-toml が Workers でバンドル可能なこと。eval 系エラーが出ないこと)

```bash
git add packages/core apps/worker/src/workflows/child.ts apps/cli/src
git commit -m "feat: reconcile 進行役を application/scenario に一本化し worker/cli を配線"
```

---

### Task 11: 新旧等価性テスト(P-b の受け入れ根拠)

**Files:**
- Test: `packages/core/test/domain/model/desired/equivalence.test.ts`

- [ ] **Step 1: テストを書く(実装変更なし)**

同一の論理データを v2 レイアウト(fragment/strategies)と v3 レイアウト(catalog/profiles/templates)で表現し、同じ実ファイル群への `computeChanges` 出力の一致を固定する。gitignore.liquid は Task 2 の `GITIGNORE_LIQUID` を import。

```ts
import { expect, test } from "vitest";
import type { TemplateSource } from "../../../../src/domain/model/canonical/templateSource.js";
import { computeChanges } from "../../../../src/domain/model/desired/computeChanges.js";
import { resolveDesired } from "../../../../src/domain/model/desired/derive.js";
import type { FragmentManifest } from "../../../../src/templates/types.js";
import { GITIGNORE_LIQUID } from "../canonical/template.test.js";

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

// 配布先の実状態: リポ独自行入り gitignore・リポ独自 extends 入り renovate・古い release.yml
const ACTUAL = {
  ".gitignore":
    "# >>> repository-fanout managed >>>\nold\n# <<< repository-fanout managed <<<\n\n/generated/\n",
  "renovate.json": '{\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n',
  ".github/release.yml": "changelog: {old: true}\n",
};

const ARGS = {
  languages: ["typescript"],
  bundles: [] as string[],
  vars: { codeowner: "org/team" },
  exclude: [] as string[],
};

test("同一データ・同一実ファイルへの FileChange が新旧レイアウトでバイト一致", async () => {
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  const cLegacy = computeChanges(await resolveDesired({ source: legacy, ...ARGS }), ACTUAL).sort(
    byPath,
  );
  const cV3 = computeChanges(await resolveDesired({ source: v3, ...ARGS }), ACTUAL).sort(byPath);
  expect(cV3).toEqual(cLegacy);
});

test("renovate.json 不在時の createContent は意味的同一(正準化差は許容)", async () => {
  const lc = computeChanges(await resolveDesired({ source: legacy, ...ARGS }), {}).find(
    (c) => c.path === "renovate.json",
  );
  const vc = computeChanges(await resolveDesired({ source: v3, ...ARGS }), {}).find(
    (c) => c.path === "renovate.json",
  );
  expect(JSON.parse(vc?.content ?? "")).toEqual(JSON.parse(lc?.content ?? ""));
});
```

注: 1 本目は gitignore / CODEOWNERS の blockContent と release.yml の content が**バイト一致**することを要求する。ここが通れば P-b の canonical-files 変換で全リポ一斉の見た目差分 PR は起きない。FAIL したら v3 側テンプレートの whitespace を疑う(旧実装は変更しない)。

- [ ] **Step 2: PASS 確認してコミット**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/desired/equivalence.test.ts` → PASS

```bash
git add packages/core/test/domain/model/desired/equivalence.test.ts
git commit -m "test(core): 新旧レイアウトの FileChange 等価性を固定(P-b の受け入れ根拠)"
```

---

### Task 12: spec 追記 + 全体検証

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-catalog-profiles-design.md`

- [ ] **Step 1: spec §6.2 の「制約(fail fast)」の前に追記**

```markdown
ファイル不在時の新規作成:

- profile が `template` を宣言していれば、その描画結果を骨格として managed_paths をマージした全文で作成する
  (renovate.json の `$schema` のような管理外の初期キーを骨格側に置ける)
- `template` 宣言が無ければ、管理データのみから正準生成する
```

- [ ] **Step 2: 全体検証**

```bash
pnpm lint:fix && pnpm typecheck && pnpm test
```

Expected: すべて成功。lint 自動修正の差分は確認してステージへ。

- [ ] **Step 3: コミット**

```bash
git add -A
git commit -m "docs: v3 spec に構造化 managed の新規作成挙動を補足"
```

---

## 完了チェック(このプランのスコープ)

- [ ] 既存資産が業務概念パッケージへ移設され、export 名・挙動とも不変(Task 0)
- [ ] catalog.json があるテンプレリポに対して v3 resolver(クラス群)が動く(単体テストで実証)
- [ ] catalog.json が無ければ従来どおり(worker/cli の既存テスト全通過)
- [ ] 新旧等価性テストが PASS(P-b 着手の前提)
- [ ] `wrangler deploy --dry-run` 成功(Workers 互換の実証)

## 後続プラン(別ファイル)

- **P-b**: canonical-files の catalog/profiles/templates への変換 + CI(canonical-files リポ)
- **P-c**: organization-structure の `vars` → `contents` リネーム(tf リポ)
- **P-d**: mise.toml 配布の実証(DoD-3)
- **P-e**: 旧経路削除(templates/ と extendsField.ts、TemplateSource の fragment 系メソッド、ExtendsFieldFile)+ RepoPort / DistRecordStore ポートの core 移設検討
