# v3-P-e: 旧経路(v2)撤去 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v3(catalog/profiles/templates)が本番稼働・全アカウント移行済みとなったため、repository-fanout から v2 の凍結資産(`src/templates/`・`src/reconcile/extendsField.ts`・`extends-field` 戦略・`TemplateSource` の fragment 系メソッド・manifest の `vars` 受理)を撤去し、コードベースを v3 単一経路にする。

**Architecture:** 純粋な削除リファクタ。挙動は変えない(v3 経路は既に本番で唯一使われている経路)。撤去の安全性は調査で確定済み:
- `extends-field`/`extends-field-retract` 戦略は v2 resolver(`resolveDesiredEntries`)だけが生成し、v3 catalog は `replace`/`create-only`/`managed-block`/`structured-managed` しか生成しない。retraction は path+hash ベースで戦略を KV に永続化しないため、KV 経由の復活も無い。
- `TemplateSource` の `readFragmentManifest`/`listNames`/`nameExists` は v2 専用。v3(`Catalog.parse`/`Profiles.load`)は `readFile`/`listFiles` しか使わない。
- manifest の `vars` キーは P-c で全アカウントが `contents` へ移行済み。

**緑を保つ戦略(重要):** 撤去スイッチ `resolveDesired`(catalog.json の有無で v2/v3 自動切替)を利用する。**先に v2 レイアウトのテストを v3 モックへ移行**すれば、それらは auto-switch で自動的に v3 経路を通り緑のまま。全消費者が v3 化した**後で**死んだ v2 分岐・ファイルを削除する。これで各コミットが常に `typecheck` + `test` 緑。

**Tech Stack:** TypeScript(ESM)/ pnpm workspace(packages/core, apps/cli, apps/worker)/ vitest / biome / LiquidJS / Cloudflare Workers。

**作業リポ:** repository-fanout(`/Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout`)。ブランチ `feat/v3-pe-legacy-removal`。

**スコープ外(意図的):** manifest の内部フィールド名 `vars`(`RepoEntry.vars` / `ReconcileDeclaration.vars` / `ResolveAutoArgs.vars` / `ChildParams.vars`)は**リネームしない**。外部契約(manifest の受理キー)は `contents` 一本化するが、内部フィールド名の `vars`→`contents` 全面改名は「最小限の変更」原則により本 P-e では行わない(必要になれば別 PR)。

**各タスク共通の検証コマンド:**
```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
pnpm -r typecheck && pnpm -r test
```

**ベースライン(着手前):** core 156 / cli 18 / worker 62 = 236 tests 緑、typecheck 緑。

---

### Task 0: ブランチ作成

- [ ] **Step 1: ブランチ作成**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
git checkout main && git pull --ff-only
git checkout -b feat/v3-pe-legacy-removal
```

---

### Task 1: manifest の `vars` 受理を撤去(`contents` 一本化)

独立タスク。外部から受理するキーを `contents` のみにし、残存 `vars` は silent-ignore せず fail loud にする。

**Files:**
- Modify: `packages/core/src/domain/model/manifest/parse.ts:46-66`
- Modify: `packages/core/test/domain/model/manifest/parse.test.ts`

- [ ] **Step 1: parse.ts の vars/contents 二重受理を `contents` 一本化へ**

`parse.ts` の現在の 46〜66 行(`// contents は vars の後継` コメント〜`vars = varsSource as ...` まで)を次で置き換える:

```ts
    // contents はリポ個別値(spec v3 §8)。旧 vars キーは P-e で受理終了。
    // 残存 vars を silent-ignore すると CODEOWNERS 等が無値で壊れるため fail loud。
    if (entry.vars !== undefined) {
      throw new Error(`manifest: ${name}: 'vars' は廃止。'contents' を使うこと(spec v3 §8)`);
    }
    let vars: Record<string, string> = {};
    if (entry.contents !== undefined) {
      const c = entry.contents;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        throw new Error(`manifest: ${name}.contents must be an object of string values`);
      }
      for (const [k, v] of Object.entries(c)) {
        if (typeof v !== "string")
          throw new Error(`manifest: ${name}.contents.${k} must be a string`);
      }
      vars = c as Record<string, string>;
    }
```

（68 行の `repositories[name] = { languages: ..., bundles, vars, exclude };` は**変更しない** — 内部フィールド名 `vars` は維持。）

- [ ] **Step 2: parse.test.ts を更新**

(a) `valid` フィクスチャ(4〜14 行)の `vars:` を `contents:` へ:

```ts
    "endpoint-gate": {
      languages: ["terraform"],
      contents: { codeowner: "bright-room/br-maintainers" },
    },
```

(b) 「rejects vars that is not an object」テスト(64〜73 行)を **contents 版**へ差し替え:

```ts
test("parseManifest rejects contents that is not an object", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [], contents: "oops" } },
    }),
  ).toThrow(/contents/i);
});
```

(c) 「rejects vars with non-string values」テスト(75〜84 行)を **contents 版**へ差し替え:

```ts
test("parseManifest rejects contents with non-string values", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [], contents: { codeowner: 5 } } },
    }),
  ).toThrow(/contents/i);
});
```

(d) 「contents と vars の両方宣言はエラー」テスト(124〜133 行)を **vars 廃止テスト**へ差し替え:

```ts
test("parseManifest は廃止された vars キーを fail loud で拒否する", () => {
  expect(() =>
    parseManifest({
      account: "o",
      revision: 1,
      sourceCommit: "c",
      repositories: { r: { languages: [], vars: { a: "1" } } },
    }),
  ).toThrow(/vars/);
});
```

(e) 「parseManifest defaults vars/exclude」(31〜40 行)と「contents は vars の後継として受理(RepoEntry.vars に入る)」(114〜122 行)は**そのまま維持**(内部フィールド `vars` は残る)。

- [ ] **Step 3: 検証**

```bash
pnpm --filter @repository-fanout/core test
pnpm -r typecheck
```
Expected: core tests 緑(manifest テストは 4 件更新)。

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "refactor(core): manifest の vars 受理を撤去し contents 一本化(P-e)"
```

---

### Task 2: CLI plan/apply テストを v3 モックへ移行

`planRepo`/`applyRepo` は `resolveDesiredStep`→`resolveDesired` 経由。テストの source を v3(catalog.json あり)にすれば auto-switch で v3 経路を通り緑。**この時点では `TemplateSource` interface はまだ fragment 3 メソッドを要求する**ため、モックにはスタブとして残す(Task 9 で除去)。

**Files:**
- Modify: `apps/cli/test/planRepo.test.ts`
- Modify: `apps/cli/test/applyRepo.test.ts`

- [ ] **Step 1: planRepo.test.ts を v3 へ書き換え**

ファイル全体を次で置き換える:

```ts
import type { TemplateSource } from "@repository-fanout/core";
import { expect, test } from "vitest";
import { planRepo } from "../src/planRepo.js";

// v3 レイアウトのインメモリ source。interface 互換のため fragment 系はスタブで残す(P-e Task 9 で除去)。
function v3Source(tree: Record<string, string>): TemplateSource {
  return {
    async readFile(p) {
      return tree[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(tree)
        .filter((p) => p.startsWith(prefix))
        .sort();
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
}

const renovateSource = v3Source({
  "catalog.json": JSON.stringify({
    files: {
      "renovate.json": {
        file_type: "json",
        mode: "managed",
        managed_paths: { extends: { merge: "array" } },
      },
    },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    "renovate.json": { extends: ["github>o/renovate-config"] },
  }),
});

test("planRepo reports changes vs actual", async () => {
  const plan = await planRepo({
    source: renovateSource,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({}), // 何も無い → 新規作成
  });
  expect(plan.changes.map((c) => c.path)).toEqual(["renovate.json"]);
  // structured-managed の createContent(skeleton 無し)は正準 JSON(2-space + 末尾改行)
  expect(plan.changes[0]?.content).toBe(
    '{\n  "extends": [\n    "github>o/renovate-config"\n  ]\n}\n',
  );
});

test("planRepo no-op when actual matches", async () => {
  const plan = await planRepo({
    source: renovateSource,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    // extends が意味的に同一なら正規化差は no-op
    readActual: async () => ({ "renovate.json": '{"extends":["github>o/renovate-config"]}' }),
  });
  expect(plan.changes).toEqual([]);
});

test("planRepo merges managed block with existing repo content", async () => {
  const src = v3Source({
    "catalog.json": JSON.stringify({
      files: { ".gitignore": { file_type: "text", mode: "managed" } },
    }),
    "profiles/base/contributes.json": JSON.stringify({
      ".gitignore": { template: "gitignore.liquid", sections: [{ comment: "base", ignores: ["a"] }] },
    }),
    "templates/gitignore.liquid":
      '{% assign s = contributions.sections[0] %}{{ s.ignores | join: "\n" }}',
  });
  const plan = await planRepo({
    source: src,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({ ".gitignore": "repo-own\n" }),
  });
  expect(plan.changes[0]!.content).toContain("repo-own");
  expect(plan.changes[0]!.content).toContain("# >>> repository-fanout managed >>>");
});
```

- [ ] **Step 2: 実行して managed-block テストの厳密値を確認(必要なら微調整)**

```bash
pnpm --filter @repository-fanout/cli exec vitest run test/planRepo.test.ts
```
`toContain` アサートなので gitignore.liquid の厳密描画に依存しない。FAIL したら managed マーカー(`# >>> repository-fanout managed >>>`)が含まれるか、テンプレートの `join` 出力を確認する。renovate.json の `toBe` が FAIL したら `StructuredDocument.createContent`(core、structuredDocument.ts:153)の JSON 整形を実測値に合わせる。

- [ ] **Step 3: applyRepo.test.ts の source を v3 へ書き換え**

`applyRepo.test.ts` の先頭のインメモリ source(6〜23 行付近、`strategies.json`/`base/files/.github/release.yml` を返すもの)を、planRepo.test.ts と同じ `v3Source` ヘルパ + release.yml を配る v3 tree に差し替える。`.github/release.yml` を `replaced` で配る最小 catalog:

```ts
function v3Source(tree: Record<string, string>): TemplateSource {
  return {
    async readFile(p) {
      return tree[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(tree)
        .filter((p) => p.startsWith(prefix))
        .sort();
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
}

const source = v3Source({
  "catalog.json": JSON.stringify({
    files: { ".github/release.yml": { file_type: "yaml", mode: "replaced" } },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    ".github/release.yml": { template: "release.yml.liquid" },
  }),
  "templates/release.yml.liquid": "R\n",
});
```

`applyRepo` の各テストが配布物として期待するパス/内容(`.github/release.yml` = `"R\n"`)は不変。テスト本体のアサートはそのままで、source 定義だけ差し替える。既存の `readFragmentManifest`/`listNames`/`nameExists` を含む旧 source 定義と `strategies.json` 参照は削除する。

- [ ] **Step 4: 実行 → 緑**

```bash
pnpm --filter @repository-fanout/cli test
pnpm -r typecheck
```

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "test(cli): plan/apply テストを v3 catalog レイアウトへ移行(P-e)"
```

---

### Task 3: worker child テストを v3 モックへ移行

`runChild`→`resolveDesiredStep` 経由。`memTemplates` を v3 レイアウトへ。呼び出し側 8 箇所の引数(`memTemplates({ "base/files/.github/release.yml": RELEASE })` 等)を**変えずに**済むよう、ヘルパ内で `base/files/<path>` キーの有無を「その path を base profile が寄与するか」として解釈する。

**Files:**
- Modify: `apps/worker/test/workflows/child.test.ts`

- [ ] **Step 1: import から `FragmentAxis`/`FragmentManifest` を除去**

6〜7 行の `type FragmentAxis,` と `type FragmentManifest,` を削除する(他の import はそのまま)。

- [ ] **Step 2: `memTemplates` を v3 レイアウトへ差し替え**

現在の `memTemplates`(27〜42 行)を次で置き換える:

```ts
/**
 * インメモリ TemplateSource(v3 catalog レイアウト)。
 * `base/files/<path>` キーの有無で「その path を base profile が寄与するか」を表す。
 * (interface 互換のため fragment 系はスタブ。P-e Task 9 で除去。)
 */
function memTemplates(files: Record<string, string>): TemplateSource {
  const contributes: Record<string, unknown> = {};
  if ("base/files/.github/release.yml" in files) {
    contributes[".github/release.yml"] = { template: "release.yml.liquid" };
  }
  if ("base/files/.gitignore" in files) {
    contributes[".gitignore"] = { template: "gitignore.liquid" };
  }
  const tree: Record<string, string> = {
    "catalog.json": JSON.stringify({
      files: {
        ".github/release.yml": { file_type: "yaml", mode: "replaced" },
        ".gitignore": { file_type: "text", mode: "managed" },
      },
    }),
    "profiles/base/contributes.json": JSON.stringify(contributes),
    "templates/release.yml.liquid": files["base/files/.github/release.yml"] ?? "",
    "templates/gitignore.liquid": "managed",
  };
  return {
    readFile: async (p) => tree[p] ?? null,
    listFiles: async (prefix) =>
      Object.keys(tree)
        .filter((p) => p.startsWith(prefix))
        .sort(),
    readFragmentManifest: async () => null,
    listNames: async () => [],
    nameExists: async () => false,
  };
}
```

呼び出し側 8 箇所(`memTemplates({ "base/files/.github/release.yml": RELEASE })` / `memTemplates({})` / `memTemplates({ "base/files/.gitignore": "{{gitignore}}" })`)は**そのまま**。挙動:
- `.github/release.yml`(replaced)= テンプレート `release.yml.liquid` の描画 = `RELEASE`(`"changelog: {}\n"` は Liquid タグ無しで逐語)。
- `.gitignore`(managed-block)= テンプレート `"managed"` → block 内容 `"managed"`。exclude テストでは block ごと除去され `"repo-own\n"` に収束。
- `memTemplates({})` = base 寄与ゼロ → 全 path skip → 配布なし。

- [ ] **Step 3: 実行 → 緑**

```bash
pnpm --filter @repository-fanout/worker test
pnpm -r typecheck
```
Expected: worker 62 tests 緑。FAIL したら該当テストのアサート(`.github/release.yml` 内容 = `"changelog: {}\n"`、`.gitignore` exclude = `"repo-own\n"`)と v3 描画を突合。

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "test(worker): child テストを v3 catalog レイアウトへ移行(P-e)"
```

---

### Task 4: CLI validate テストを v3 フィクスチャへ移行

`validateDir.ts` は catalog.json の有無で v2/v3 分岐。テストを v3 フィクスチャにすれば auto-switch で v3(`validateCatalogSource`)を通り緑。v2 フィクスチャは撤去する。

**Files:**
- Create: `apps/cli/test/fixtures/canonical-v3/catalog.json`
- Create: `apps/cli/test/fixtures/canonical-v3/templates/gitignore.liquid`
- Create: `apps/cli/test/fixtures/canonical-v3/templates/codeowners.liquid`
- Create: `apps/cli/test/fixtures/canonical-v3/profiles/base/contributes.json`
- Create: `apps/cli/test/fixtures/canonical-v3/profiles/typescript/contributes.json`
- Create: `apps/cli/test/fixtures/catalog-bad-json/catalog.json`
- Create: `apps/cli/test/fixtures/catalog-unknown-path/catalog.json`
- Create: `apps/cli/test/fixtures/catalog-unknown-path/profiles/base/contributes.json`
- Create: `apps/cli/test/fixtures/catalog-unknown-path/profiles/typescript/contributes.json`
- Modify: `apps/cli/test/validateDir.test.ts`
- Delete: `apps/cli/test/fixtures/canonical-mini/`, `typo-fragment/`, `broken-strategies/`, `broken-fragment/`(v2 フィクスチャ)

- [ ] **Step 1: v3 正常系フィクスチャを作成**

`canonical-v3/catalog.json`:
```json
{
  "files": {
    ".gitignore": { "file_type": "text", "mode": "managed" },
    ".github/CODEOWNERS": { "file_type": "text", "mode": "managed" },
    "renovate.json": {
      "file_type": "json",
      "mode": "managed",
      "managed_paths": { "extends": { "merge": "array" } }
    }
  }
}
```

`canonical-v3/templates/gitignore.liquid`:
```liquid
{% capture nl %}
{% endcapture %}{% assign sections = contributions.sections | cross_dedupe: "ignores" %}{% for s in sections %}### {{ s.comment }} ###{{ nl }}{{ s.ignores | join: nl }}{% endfor %}
```

`canonical-v3/templates/codeowners.liquid`:
```liquid
* {{ contents.codeowner }}
```

`canonical-v3/profiles/base/contributes.json`:
```json
{
  ".gitignore": {
    "template": "gitignore.liquid",
    "sections": [{ "comment": "base", "ignores": [".DS_Store"] }]
  },
  ".github/CODEOWNERS": { "template": "codeowners.liquid" },
  "renovate.json": { "extends": ["github>o/renovate-config"] }
}
```

`canonical-v3/profiles/typescript/contributes.json`:
```json
{
  ".gitignore": { "sections": [{ "comment": "node", "ignores": ["node_modules/"] }] },
  "renovate.json": { "extends": ["github>o/renovate-config:typescript"] }
}
```

- [ ] **Step 2: v3 異常系フィクスチャを作成**

`catalog-bad-json/catalog.json`(壊れた JSON):
```
{ "files": { ".gitignore":
```

`catalog-unknown-path/catalog.json`(`.gitignore` のみ登録):
```json
{ "files": { ".gitignore": { "file_type": "text", "mode": "managed" } } }
```

`catalog-unknown-path/profiles/base/contributes.json`:
```json
{ ".gitignore": { "template": "gitignore.liquid", "sections": [{ "comment": "base", "ignores": [".DS_Store"] }] } }
```
(base に `templates/gitignore.liquid` が要るので、`catalog-unknown-path/templates/gitignore.liquid` も canonical-v3 と同じ内容で作成する。)

`catalog-unknown-path/profiles/typescript/contributes.json`(catalog 未登録パスへ寄与 → fail fast):
```json
{ "renovate.json": { "extends": ["x"] } }
```

- [ ] **Step 3: validateDir.test.ts を v3 用に書き換え**

ファイル全体を次で置き換える:

```ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";
import { validateSource } from "../src/validateDir.js";

const fixture = (name: string) =>
  localSource(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

describe("validateSource (v3 catalog)", () => {
  it("valid v3 tree → no errors", async () => {
    expect(await validateSource(fixture("canonical-v3"))).toEqual([]);
  });

  it("reports catalog.json parse error", async () => {
    const errors = await validateSource(fixture("catalog-bad-json"));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("reports render failure when a profile contributes an unregistered path", async () => {
    const errors = await validateSource(fixture("catalog-unknown-path"));
    expect(errors.some((e) => e.includes("renovate.json"))).toBe(true);
  });
});
```

- [ ] **Step 4: v2 フィクスチャを削除**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
git rm -r apps/cli/test/fixtures/canonical-mini apps/cli/test/fixtures/typo-fragment \
  apps/cli/test/fixtures/broken-strategies apps/cli/test/fixtures/broken-fragment
```

- [ ] **Step 5: 実行 → 緑**

```bash
pnpm --filter @repository-fanout/cli test
```
Expected: validate 3 tests 緑。「unknown-path」で `path not in catalog: renovate.json` が render failure として拾われることを確認。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "test(cli): validate テストを v3 catalog フィクスチャへ移行(P-e)"
```

---

### Task 5: v2 専用の挙動テストを撤去

これで v2 経路(catalog.json 不在)を通る消費者・テストがゼロになる。

**Files:**
- Modify: `packages/core/test/domain/model/desired/derive.test.ts`(test 4 を削除)
- Delete: `packages/core/test/domain/model/desired/equivalence.test.ts`

- [ ] **Step 1: derive.test.ts の v2 委譲テストを削除**

`derive.test.ts` の 131〜165 行のテスト `"resolveDesired: catalog.json が無ければ v2 経路(strategies.json)へ委譲"` を丸ごと削除する(残り 3 テスト = v3 は維持)。`memorySourceV3` の fragment 3 メソッド(16〜24 行)は**この時点では残す**(interface がまだ要求。Task 9 で除去)。

- [ ] **Step 2: equivalence.test.ts を削除**

```bash
git rm packages/core/test/domain/model/desired/equivalence.test.ts
```
(v2/v3 等価性テスト。v2 撤去後は成立せず、等価性は canonical-files 変換 PR#11 の 16 組合せ実測 + Task 7 の golden テストで既に固定済み。)

- [ ] **Step 3: 実行 → 緑**

```bash
pnpm --filter @repository-fanout/core test
```

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "test(core): v2 専用の resolver 委譲/等価性テストを撤去(P-e)"
```

---

### Task 6: resolver / validator を v3 単一経路へ(死んだ v2 分岐の削除)

消費者が全て v3 化したので、auto-switch の v2 分岐を削除する。

**Files:**
- Modify: `packages/core/src/domain/model/desired/derive.ts`
- Modify: `apps/cli/src/validateDir.ts`

- [ ] **Step 1: derive.ts の v2 分岐を削除**

1 行目の `import { resolveDesiredEntries } from "../../../templates/resolve.js"; // 凍結 v2 経路(P-e で削除)` を削除。`resolveDesired`(86〜106 行)を次へ簡素化(catalog 不在分岐を除去し常に v3):

```ts
/**
 * 望ましい状態の導出(spec v3)。呼び出し互換のため引数名は vars(v3 では contents として渡す)。
 */
export async function resolveDesired(args: ResolveAutoArgs): Promise<DesiredFileData[]> {
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
(`ResolveAutoArgs` interface はそのまま。`vars` フィールド維持。)

- [ ] **Step 2: validateDir.ts を v3 単一経路へ**

ファイル全体を次で置き換える(v2 分岐・`FRAGMENT_KEYS`・`resolveDesiredEntries` import を撤去):

```ts
import { Catalog, resolveDesired, type TemplateSource } from "@repository-fanout/core";

/**
 * 正本ツリー(v3 レイアウト)の検証(spec v3 §10)。catalog / contributes / template の
 * 整合は resolver 自体が fail fast するので、全 profile 組合せの描画スモークを回す。
 * 戻り値はエラーメッセージの配列(空 = 合格)。
 */
export async function validateSource(source: TemplateSource): Promise<string[]> {
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

- [ ] **Step 3: 実行 → 緑**

```bash
pnpm -r typecheck && pnpm -r test
```
`resolveDesiredEntries`/`readFragmentManifest`/`listNames` を src の runtime 経路から呼ぶ箇所が消える(まだ import 可能=ファイルは存在)。

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "refactor: resolver/validator を v3 単一経路化し v2 分岐を削除(P-e)"
```

---

### Task 7: v2 resolver ファイル群を削除 + golden テスト化

`templates/{render,resolve,strategyConfig}.ts` とその単体テストを削除し、index の該当 export を外す。`template.test.ts` の「v2 renderGitignore とバイト一致」テストは golden リテラルへ書き換える。

**Files:**
- Delete: `packages/core/src/templates/render.ts`, `resolve.ts`, `strategyConfig.ts`
- Delete: `packages/core/test/templates/render.test.ts`, `resolve.test.ts`, `strategyConfig.test.ts`
- Modify: `packages/core/src/index.ts:89-90`
- Modify: `packages/core/test/domain/model/canonical/template.test.ts`

- [ ] **Step 1: template.test.ts を golden 化(renderGitignore 依存を除去)**

3 行目の `import { renderGitignore } from "../../../../src/templates/render.js";` を削除。`GITIGNORE_LIQUID`(43〜44 行)は `equivalence.test.ts` 削除により外部 import が無くなったので **`export` と直上の `biome-ignore` コメント(42 行)を除去**してローカル定数化:

```ts
const GITIGNORE_LIQUID = `{% capture nl %}
{% endcapture %}{% capture sep %}{{ nl }}{{ nl }}{% endcapture %}{% assign sections = contributions.sections | cross_dedupe: "ignores" %}{% capture out %}{% for s in sections %}### {{ s.comment }} ###{{ nl }}{{ s.ignores | join: nl }}{% unless forloop.last %}{{ sep }}{% endunless %}{% endfor %}{% endcapture %}{{ out }}`;
```

最後のテスト(46〜60 行)を golden リテラル比較へ置き換える:

```ts
test("gitignore.liquid の描画結果が正準形(マーカー無し本文)", async () => {
  const sections = [
    { comment: "base", ignores: [".DS_Store", "*.log"] },
    { comment: "node", ignores: ["node_modules/", "*.log"] }, // *.log は横断 dedupe
    { comment: "empty", ignores: ["*.log"] }, // 空になり見出しごと消える
  ];
  const v3 = await Template.of(GITIGNORE_LIQUID).render({
    ...CTX,
    contributions: { sections },
  });
  expect(v3).toBe("### base ###\n.DS_Store\n*.log\n\n### node ###\nnode_modules/");
});
```

- [ ] **Step 2: v2 resolver ファイルと単体テストを削除**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
git rm packages/core/src/templates/render.ts packages/core/src/templates/resolve.ts \
  packages/core/src/templates/strategyConfig.ts
git rm packages/core/test/templates/render.test.ts packages/core/test/templates/resolve.test.ts \
  packages/core/test/templates/strategyConfig.test.ts
```

- [ ] **Step 3: index.ts から render/resolve の export を削除**

`index.ts` の次の 2 行(89〜90 行)を削除:
```ts
export { renderGitignore, substituteVars } from "./templates/render.js";
export { resolveDesiredEntries } from "./templates/resolve.js";
```
(88 行の extendsField export と 91 行の types export は Task 8 で扱う。)

- [ ] **Step 4: 実行 → 緑**

```bash
pnpm -r typecheck && pnpm -r test
```
`templates/types.ts` はまだ存在(`extendsField` は未削除、interface の fragment メソッドも未削除)。緑。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "refactor(core): v2 resolver(render/resolve/strategyConfig)を削除し golden テスト化(P-e)"
```

---

### Task 8: `extends-field` 戦略と extendsField.ts を撤去

**Files:**
- Modify: `packages/core/src/domain/model/desired/desiredFileData.ts`
- Modify: `packages/core/src/domain/model/desired/desiredFile.ts`
- Delete: `packages/core/src/reconcile/extendsField.ts`
- Delete: `packages/core/test/reconcile/extendsField.test.ts`
- Modify: `packages/core/src/index.ts:88`
- Modify: `packages/core/test/domain/model/desired/computeChanges.test.ts`
- Modify: `apps/worker/src/workflows/child.ts:15,149`

- [ ] **Step 1: desiredFileData.ts から extends-field 系 union を削除**

`extends-field`(11〜20 行)と `extends-field-retract`(23 行)の 2 メンバを削除。`DesiredEntry` エイリアス(44 行)のコメントから「凍結ゾーン(templates/)」の語を落として維持:
```ts
/** 旧名。既存テスト・apps の互換用エイリアス */
export type DesiredEntry = DesiredFileData;
```

- [ ] **Step 2: desiredFile.ts から ExtendsField 系を削除**

1 行目の `import { applyExtendsField } from "../../../reconcile/extendsField.js"; // 凍結 v2 資産(P-e で削除)` を削除。`from()` の switch から `case "extends-field":`(33〜39 行)と `case "extends-field-retract":`(40〜41 行)を削除。クラス `ExtendsFieldFile`(120〜138 行)と `ExtendsFieldRetractFile`(140〜155 行)を削除。

- [ ] **Step 3: computeChanges.test.ts から extends-field を除去**

- 6 行目 `import { RenovateParseError } from ".../reconcile/extendsField.js";` を削除。
- 7 行目の import を `import type { DesiredEntry } from "../../../../src/domain/model/desired/desiredFileData.js";` へ変更。
- 9〜10 行の `managed`/`universe` 定数を削除。
- `entries` 配列(12〜23 行)から 4 要素目の `extends-field` エントリ(16〜22 行)を削除。
- extends-field 系テストを削除: 「extends-field: absent -> createContent ...」(49〜63 行)、「extends-field: invalid json ...」(65〜69 行)、「extends-field: non-object ...」(71〜77 行)、「extends-field-retract removes ...」(105〜120 行)、「extends-field-retract is a no-op ...」(122〜129 行)。
- 残り(replace/create-only/managed-block/managed-block-retract/structured-managed 系/unknown strategy/retracted())は維持。

- [ ] **Step 4: extendsField.ts と単体テストを削除、index export を除去**

```bash
git rm packages/core/src/reconcile/extendsField.ts packages/core/test/reconcile/extendsField.test.ts
```
`index.ts` 88 行 `export { applyExtendsField, mergeExtends, RenovateParseError } from "./reconcile/extendsField.js";` を削除。

- [ ] **Step 5: worker child.ts の RenovateParseError を除去**

- 15 行目 import から `RenovateParseError,` を削除。
- 149 行 `if (err instanceof RenovateParseError || err instanceof StructuredParseError) {` を `if (err instanceof StructuredParseError) {` へ変更(v3 の構造化パース失敗は StructuredParseError のみ)。

- [ ] **Step 6: 実行 → 緑**

```bash
pnpm -r typecheck && pnpm -r test
```

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "refactor: extends-field 戦略と extendsField.ts を撤去(P-e)"
```

---

### Task 9: `TemplateSource` の fragment メソッドと templates/types.ts を撤去

interface から 3 メソッドを外し、全実装・全モック・メソッド固有テストを同時に更新(1 コミット。TS の excess-property/未実装エラーを避けるため atomic)。

**Files:**
- Modify: `packages/core/src/domain/model/canonical/templateSource.ts`
- Delete: `packages/core/src/templates/types.ts`
- Modify: `packages/core/src/index.ts:91`
- Modify(実装): `apps/cli/src/localSource.ts`, `apps/cli/src/github.ts`, `apps/worker/src/github/templateSource.ts`
- Modify(モック): `packages/core/test/domain/model/desired/derive.test.ts`, `apps/worker/test/workflows/child.test.ts`, `apps/cli/test/planRepo.test.ts`, `apps/cli/test/applyRepo.test.ts`
- Modify(メソッド固有テスト): `apps/cli/test/github.test.ts`, `apps/cli/test/localSource.test.ts`, `apps/worker/test/github/templateSource.test.ts`

- [ ] **Step 1: interface から 3 メソッドを削除**

`templateSource.ts` を次へ置き換える(1 行目の Fragment import と 7〜10 行のメソッドを撤去):
```ts
/** 正本(canonical-files)の読み取りポート。実装: worker=GitHub API / cli=ローカル FS / test=メモリ */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
}
```

- [ ] **Step 2: 実装 3 ファイルから 3 メソッド + Fragment import を削除**

- `apps/cli/src/localSource.ts`: 4 行目 import から `FragmentAxis, FragmentManifest,` を削除(`TemplateSource` は残す)。返却オブジェクトから `readFragmentManifest`/`listNames`/`nameExists`(37〜58 行)を削除。未使用になる `stat`/`Dirent` import があれば typecheck/lint 指摘に従い除去。
- `apps/cli/src/github.ts`: 2 行目 `type FragmentManifest,` を削除。返却オブジェクトから `readFragmentManifest`/`listNames`/`nameExists`(47〜62 行)を削除。
- `apps/worker/src/github/templateSource.ts`: 3〜4 行目 `type FragmentAxis,`/`type FragmentManifest,` を削除。メソッド `readFragmentManifest`/`listNames`/`nameExists`(48〜65 行)を削除。

- [ ] **Step 3: モック 4 ファイルから 3 メソッド + Fragment import を削除**

- `packages/core/test/domain/model/desired/derive.test.ts`: `memorySourceV3` の `readFragmentManifest`/`listNames`/`nameExists`(16〜24 行)を削除。
- `apps/worker/test/workflows/child.test.ts`: `memTemplates` 返却の `readFragmentManifest`/`listNames`/`nameExists` を削除(Task 3 で残したスタブ)。
- `apps/cli/test/planRepo.test.ts` / `apps/cli/test/applyRepo.test.ts`: `v3Source` ヘルパの fragment スタブ 3 つを削除。

- [ ] **Step 4: メソッド固有テストを削除**

- `apps/cli/test/github.test.ts`: `readFragmentManifest` を検証するテスト(30〜40 行付近)を削除。
- `apps/cli/test/localSource.test.ts`: `readFragmentManifest` を検証するテスト(24〜32 行付近)を削除。
- `apps/worker/test/github/templateSource.test.ts`: `readFragmentManifest` を検証するテスト(33〜39 行付近)を削除。

- [ ] **Step 5: templates/types.ts を削除、index の types export を除去**

```bash
git rm packages/core/src/templates/types.ts
```
`index.ts` 91 行 `export type { FragmentAxis, FragmentManifest, GitignoreSection } from "./templates/types.js";` を削除。`packages/core/src/templates/` が空になったら残骸が無いことを確認(空ディレクトリは git 管理外)。

- [ ] **Step 6: 実行 → 緑**

```bash
pnpm -r typecheck && pnpm -r test
```

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "refactor: TemplateSource の fragment 系メソッドと templates/types を撤去(P-e 完了)"
```

---

### Task 10: 最終検証と PR

- [ ] **Step 1: v2 残骸が無いことを grep で確認**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
grep -rn --include="*.ts" -E "templates/(render|resolve|strategyConfig|types)|reconcile/extendsField|ExtendsField|readFragmentManifest|FragmentManifest|FragmentAxis|renderGitignore|substituteVars|resolveDesiredEntries|applyExtendsField|mergeExtends|RenovateParseError|extends-field|strategies\.json" packages apps | grep -v node_modules
```
Expected: **何も出力されない**(0 件)。`structuredDocument.ts` の doc コメントが `mergeExtends の一般化` 等の歴史的言及を含む場合はそのままで可(削除済み関数への実参照ではない)。

- [ ] **Step 2: 全体緑を確認**

```bash
pnpm -r typecheck
pnpm -r test
pnpm lint
```
Expected: typecheck 緑 / test 緑(v2 テスト削除・v3 移行で総数は減る)/ lint に**新規**エラーなし(ベースラインの警告数を超えないこと)。

- [ ] **Step 3: 実正本(canonical-files)で v3 validate が通ることを確認**

```bash
pnpm --filter cli run validate -- --dir /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
```
Expected: `validation OK`(v3 経路。撤去で正本検証が壊れていないことの実証)。

- [ ] **Step 4: worker がビルドできることを確認(wrangler dry-run)**

```bash
pnpm --filter @repository-fanout/worker exec wrangler deploy --dry-run --outdir /tmp/pe-dryrun
```
Expected: バンドル成功(型・import 解決が本番ビルドでも通る)。

- [ ] **Step 5: push + PR 作成**

PR 本文に含める:
- これは v2 撤去(挙動不変)。v3 は本番稼働・全アカウント移行済み(P-b/P-c/P-d 完了)が前提。
- 撤去対象: `src/templates/`、`reconcile/extendsField.ts`、`extends-field`/`extends-field-retract` 戦略、`TemplateSource` の fragment 系メソッド、manifest の `vars` 受理。
- 安全性根拠: extends-field は v2 resolver のみが生成(v3 catalog は非生成)、retraction は path+hash ベースで戦略を KV 永続化しない、fragment メソッドは v3 未使用、`vars` は全アカウント `contents` 移行済み。
- 検証: typecheck/test 緑、grep で v2 残骸 0、実正本 `validation OK`、wrangler dry-run 成功。
- **内部フィールド名 `vars` は意図的に残置**(外部契約のみ `contents` 一本化)。
- 切り戻し: この PR の revert(catalog.json は canonical 側にあるため worker 挙動は不変)。

```bash
git push -u origin feat/v3-pe-legacy-removal
gh pr create --title "refactor: v3 P-e — 旧経路(v2)撤去" --body "..."
```

- [ ] **Step 6: ユーザー merge 後の観測**

1. CI green(canonical-files の validate CI は repository-fanout@main を checkout するため、この PR merge 後は v3 検証がそのまま動く)。
2. Workers を手動デプロイ(deploy CI 無し運用)。デプロイ後の手動 kick で **全リポ 0 diff(no-op)** を確認(挙動不変の実証)。

---

## 完了条件(P-e の DoD)

- [ ] `src/templates/` と `src/reconcile/extendsField.ts` が存在しない
- [ ] `DesiredFileData` に `extends-field`/`extends-field-retract` が無い
- [ ] `TemplateSource` が `readFile`/`listFiles` のみ
- [ ] manifest は `contents` のみ受理(`vars` は fail loud で拒否)
- [ ] `pnpm -r typecheck` + `pnpm -r test` 緑、v2 残骸 grep 0 件
- [ ] 実正本 `validation OK`、wrangler dry-run 成功
- [ ] merge 後の手動 kick で全リポ no-op(挙動不変)

## 後続(このプランに含まない)

- CONTRIBUTING.md の create-only 化判断(canonical 側の catalog.json mode 変更。ユーザー決定待ち)
- Phase C: languages 宣言の全リポ段階展開(v2 由来の運用タスク)
