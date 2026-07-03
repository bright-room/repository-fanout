# bundles 軸・strategies.json・Discord 失敗通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec `docs/superpowers/specs/2026-07-03-bundles-and-strategy-config-design.md` を実装する — (1) `bundles` 第2軸の追加、(2) `STRATEGY_REGISTRY` の `strategies.json` 外部化、(3) リポ単位失敗の Discord 通知。

**Architecture:** core の `TemplateSource` を軸パラメータ付きに一般化し（`listNames`/`nameExists`）、`resolveDesiredEntries` に bundles を通す。戦略はテンプレリポ直下 `strategies.json` から読み、不在は fail fast。worker は失敗記録（`recordRepoResult(failed)`）と Discord 通知を `reportRepoFailure` ヘルパに束ねる。互換対応なし（worker 未デプロイ・KV データなし）。

**Tech Stack:** TypeScript (pnpm monorepo), vitest（worker は @cloudflare/vitest-pool-workers）, Cloudflare Workers/Workflows。

**Branch:** `feat/bundles-and-strategy-config`（spec・sample コミット済みのブランチ）でそのまま作業する。タスク単位でコミットし、PR 分割（spec §7 の PR1-3 相当）は完了時に判断する。

**検証コマンド（全タスク共通）:**
- core のみ: `pnpm -C packages/core test`
- 全体: `pnpm test`（リポルート）
- 型: `pnpm typecheck`（リポルート）

---

## Task 1: 本体 spec・P3/P4 プラン文書の追随更新

**Files:**
- Modify: `docs/superpowers/specs/2026-06-26-repository-fanout-design.md`（§3・§16-4）
- Modify: `docs/superpowers/specs/2026-07-03-bundles-and-strategy-config-design.md`（型名・シグネチャの確定 2 箇所）
- Modify: `docs/superpowers/plans/2026-06-26-p3-templates-repo.md`
- Modify: `docs/superpowers/plans/2026-06-26-p4-terraform-integration.md`

- [ ] **Step 1: 本体 spec §3 を 2 軸 + strategies.json に更新**

以下をそれぞれ置換する（行番号は 2026-07-03 時点。前後の文脈で探すこと）:

1. 見出し（L51）: `## 3. データモデル（言語ベース・単一軸）` → `## 3. データモデル（languages + bundles の2軸）`
2. L53: `「何を配るか」をファイル名で列挙するのではなく、**リポの言語（languages）を宣言**し、配布物はシステムが導出する。` → `「何を配るか」をファイル名で列挙するのではなく、**リポの言語（languages）と opt-in 束（bundles）を宣言**し、配布物はシステムが導出する。マージ意味論は両軸とも同一（fragment + files を寄与）で、違いは分類だけ — languages には本物の言語のみを置き、oss のような opt-in 配布束は bundles に置く。`
3. manifest 例（L61-64）: `"languages": ["terraform"],` の次の行に `      "bundles": [],` を追加。
4. L69 の bullet の直後に新 bullet を追加: `- `bundles` = 言語と独立な opt-in 配布束（`oss` 等）の配列。**省略可（省略時 `[]`）**。languages と同じく tree から動的発見・未知名はエラー。`
5. L76: `**1 language = 1 自己完結ディレクトリ**。その言語の全貢献` → `**1 単位（language / bundle）= 1 自己完結ディレクトリ**。その単位の全貢献`
6. ツリー（L79-99）: `common-files/` の直下（`base/` の前）に次を追加:
   ```
     strategies.json             # 配布先パス→戦略の map（導出ルール参照）
   ```
   `languages/` ブロックの後（L98 `kotlin/` ブロックの後）に次を追加:
   ```
     bundles/                    # 宣言された bundle の時だけ適用（言語と独立な opt-in 束）
       oss/
         fragment.json           #   寄与キーは省略可（oss は配布ファイルのみ）
         files/                  #   CONTRIBUTING.md / SECURITY.md
   ```
7. L111: `対象リポ（宣言 languages = \`L\`）に対して：` → `対象リポ（宣言 languages = \`L\`、宣言 bundles = \`B\`）に対して：`
8. L113: `- **対象ファイル** = \`base/files/**\` ∪ \`seeds/**\` ∪ （各 \`l ∈ L\` の \`languages/l/files/**\`）。` → `- **対象ファイル** = \`base/files/**\` ∪ \`seeds/**\` ∪ （各 \`l ∈ L\` の \`languages/l/files/**\`）∪ （各 \`b ∈ B\` の \`bundles/b/files/**\`）。`
9. L114: `同一パスを複数 language が出したら` → `同一パスを複数の language / bundle が出したら`
10. L115: `- **未知 language はエラー**：\`languages/<lang>/\` が存在しない \`l\` を宣言したら` → `- **未知 language / bundle はエラー**：\`languages/<lang>/\`（\`bundles/<name>/\`）が存在しない名前を宣言したら`
11. L117: `- **sync 戦略はパスごとにレジストリで決まる**（型付き。core に登録。未登録の files/** は replace）：` → `- **sync 戦略はテンプレリポ直下の \`strategies.json\`（配布先パス→戦略名の map）で決まる**（許可値は \`extends-field\` / \`managed-block\` のみ。未登録の files/** は replace、\`seeds/**\` は常に create-only。**strategies.json 不在はエラー**＝黙って replace に降格させない。新しいマージ意味論の追加はコード変更）：`
12. 戦略表（L124）: `| **json-field** | \`renovate.json\` |` → `| **extends-field** | \`renovate.json\` |`
13. L130: `＋ language 貢献（例 gitignore:` → `＋ language / bundle 貢献（例 gitignore:`
14. L132: `**renovate.json（json-field: extends）の意味論**：` → `**renovate.json（extends-field）の意味論**：`
15. L135: `= base ∪ **全 language**（宣言の有無に関わらず）の renovate 貢献の和集合` → `= base ∪ **全 language ∪ 全 bundle**（宣言の有無に関わらず）の renovate 貢献の和集合`
16. L136: `「宣言 languages から導出した管理エントリ（base→宣言順、順序保持 dedup）」` → `「宣言 languages / bundles から導出した管理エントリ（base→languages 宣言順→bundles 宣言順、順序保持 dedup）」`
17. L141: `**レジストリ**：パス → 戦略＋fragment 合成規則（貢献の型・連結/dedup・シリアライズ・検証）を core に1エントリとして登録する。新しい managed-block / json-field ファイルの追加はレジストリ1エントリで対応（汎用文字列置換で済ませない＝誤レンダリング/インジェクション防止）。現状エントリ：\`renovate.json\`（json-field: extends）、\`.gitignore\`（managed-block）、\`.github/CODEOWNERS\`（managed-block）。` → `**strategies.json**：パス → 戦略の割り当てはテンプレ専用リポ直下の \`strategies.json\` で宣言する（データ駆動。既存戦略の割り当てはコード変更なし）。fragment 合成規則（貢献の型・連結/dedup・シリアライズ・検証）は従来どおり core のコードに置く。現状エントリ：\`renovate.json\`（extends-field）、\`.gitignore\`（managed-block）、\`.github/CODEOWNERS\`（managed-block）。`
18. Terraform 設定例（L167）: `languages = ["terraform"]         # ← このリポを構成する言語を宣言` の次の行に `  bundles   = []                    # ← opt-in 束（oss 等）。省略可` を追加。
19. `_fanout_manifest.tf` 例（L182-183）: `languages = module.repository_endpoint_gate.languages` の次の行に `        bundles  = module.repository_endpoint_gate.bundles` を追加。

- [ ] **Step 2: 本体 spec §16-4 に Discord 通知を追記**

L606 `- 失敗時アラート（ログ/通知）。HTTP 202 後の失敗が見えなくならないようにする。` を次で置換:

```markdown
- **失敗時 Discord 通知**：リポ単位の失敗（failed 記録時）を Discord Webhook（secret `DISCORD_WEBHOOK_URL`。未設定ならスキップ）へプレーンテキストで通知する。**通知の失敗は握りつぶす**（通知が reconcile を壊してはならない）。run 単位の集約はしない（子 Workflow が独立で待ち合わせ点がないため）。HTTP 202 後の失敗が見えなくならないようにする。
```

- [ ] **Step 3: 2026-07-03 spec の実装シグネチャ 2 箇所を確定**

`docs/superpowers/specs/2026-07-03-bundles-and-strategy-config-design.md`:

1. §2「TemplateSource の一般化」のコードブロック内 `type Axis = "languages" | "bundles";` → `type FragmentAxis = "languages" | "bundles";`（`Axis` は core の export として一般的すぎるため）
2. §3 実装 bullet `core に \`parseStrategyConfig(input: unknown)\` を新設（object 検証・値検証。JSON パース不能もエラー）。` → `core に \`parseStrategyConfig(raw: string | null)\` を新設（null=ファイル不在エラー・JSON パース・object 検証・値検証を1関数に内包）。`

- [ ] **Step 4: P3 プランに strategies.json / bundles を追記**

`docs/superpowers/plans/2026-06-26-p3-templates-repo.md`:

1. Goal（L5）: `\`base/seeds/languages\` 構成で` → `\`base/seeds/languages/bundles\` + \`strategies.json\` 構成で`
2. 「Task 4: languages/ を配置」の直後に新タスクを追加:

````markdown
## Task 4.5: strategies.json と bundles/oss を配置

**Files:**
- Create: `strategies.json`, `bundles/oss/fragment.json`, `bundles/oss/files/CONTRIBUTING.md`, `bundles/oss/files/SECURITY.md`

- [ ] **Step 1: repository-fanout の sample から同一内容を配置**

コピー元: `repository-fanout/docs/superpowers/specs/sample/strategies.json` と `sample/bundles/oss/**`。

`strategies.json`（リポルート。不在だと fanout の reconcile がエラーになる必須ファイル）:

```json
{
  "renovate.json": "extends-field",
  ".gitignore": "managed-block",
  ".github/CODEOWNERS": "managed-block"
}
```

- [ ] **Step 2: commit**

```bash
git add strategies.json bundles
git commit -m "feat: add strategies.json and bundles/oss"
```
````

- [ ] **Step 5: P4 プランに bundles を追記**

`docs/superpowers/plans/2026-06-26-p4-terraform-integration.md`:

1. Goal（L5）: `repository モジュールに \`languages\` / \`fanout_vars\` を追加し` → `repository モジュールに \`languages\` / \`bundles\` / \`fanout_vars\` を追加し`
2. Task 1 の variable 定義（L25 付近の `variable "languages"` ブロックの後）に追加:

```hcl
variable "bundles" {
  description = "言語と独立な opt-in 配布束（oss 等）"
  type        = list(string)
  default     = []
}
```

3. `fanout_entry` output（L49-50 付近）: `languages = var.languages` の次の行に `    bundles   = var.bundles` を追加。
4. `_fanout_manifest.tf`（L90 付近）: 集約フィルタ `if length(mod.fanout_entry.languages) > 0` → `if length(mod.fanout_entry.languages) > 0 || length(mod.fanout_entry.bundles) > 0`（bundles のみのリポも配布対象）。manifest エントリ生成に `bundles` フィールドを含める。
5. Expected 例（L116）: `{ "languages": ["terraform"], "vars": {...} }` → `{ "languages": ["terraform"], "bundles": [], "vars": {...} }`

- [ ] **Step 6: commit**

```bash
git add docs
git commit -m "docs(spec): follow up main design and P3/P4 plans for bundles + strategies.json + notify"
```

---

## Task 2: core — `RepoEntry.bundles`（manifest スキーマ）

**Files:**
- Modify: `packages/core/src/manifest/types.ts`
- Modify: `packages/core/src/manifest/parse.ts`
- Test: `packages/core/test/manifest/parse.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/manifest/parse.test.ts` に追加:

```ts
test("parseManifest defaults bundles to []", () => {
  const m = parseManifest({
    account: "kukv", revision: 1, sourceCommit: "x",
    repositories: { dotfiles: { languages: [] } },
  });
  expect(m.repositories.dotfiles!.bundles).toEqual([]);
});

test("parseManifest accepts bundles and rejects non-string entries", () => {
  const m = parseManifest({
    account: "kukv", revision: 1, sourceCommit: "x",
    repositories: { dotfiles: { languages: [], bundles: ["oss"] } },
  });
  expect(m.repositories.dotfiles!.bundles).toEqual(["oss"]);
  expect(() => parseManifest({
    account: "kukv", revision: 1, sourceCommit: "x",
    repositories: { dotfiles: { languages: [], bundles: [1] } },
  })).toThrow(/bundles/i);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -C packages/core test`
Expected: FAIL（`bundles` が `undefined`）

- [ ] **Step 3: 実装**

`packages/core/src/manifest/types.ts` の `RepoEntry`:

```ts
export interface RepoEntry {
  languages: string[];
  /** 言語と独立な opt-in 配布束（oss 等）。省略時 [] */
  bundles: string[];
  vars: Record<string, string>;
  /** fanout が触らないパス（CODEOWNERS opt-out 等。spec §3） */
  exclude: string[];
}
```

`packages/core/src/manifest/parse.ts` の languages 検証の直後に追加し、`repositories[name]` に `bundles` を含める:

```ts
let bundles: string[] = [];
if (entry.bundles !== undefined) {
  if (!Array.isArray(entry.bundles) || !entry.bundles.every((b) => typeof b === "string")) {
    throw new Error(`manifest: ${name}.bundles must be an array of strings`);
  }
  bundles = entry.bundles as string[];
}
```

```ts
repositories[name] = { languages: entry.languages as string[], bundles, vars, exclude };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -C packages/core test`
Expected: PASS（core 全テスト）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest packages/core/test/manifest
git commit -m "feat(core): add bundles to RepoEntry and manifest parsing"
```

---

## Task 3: core — `TemplateSource` の軸一般化 + resolve の bundles 対応

**Files:**
- Modify: `packages/core/src/templates/types.ts`
- Modify: `packages/core/src/templates/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/templates/resolve.test.ts`

- [ ] **Step 1: テストヘルパを新 interface に合わせ、失敗するテストを書く**

`packages/core/test/templates/resolve.test.ts` の `memorySource` を差し替え:

```ts
function memorySource(opts: {
  files: Record<string, string>;
  fragments: Record<string, FragmentManifest>; // "base" | "languages/<lang>" | "bundles/<name>"
  languages: string[];                          // 存在する language 一覧
  bundles?: string[];                           // 存在する bundle 一覧
}): TemplateSource {
  const names = { languages: opts.languages, bundles: opts.bundles ?? [] };
  return {
    async readFile(p) { return opts.files[p] ?? null; },
    async listFiles(prefix) { return Object.keys(opts.files).filter((p) => p.startsWith(prefix)); },
    async readFragmentManifest(dir) { return opts.fragments[dir] ?? null; },
    async listNames(axis) { return names[axis]; },
    async nameExists(axis, name) { return names[axis].includes(name); },
  };
}
```

既存の全 `resolveDesiredEntries({...})` 呼び出しに `bundles: [],` を追加（このファイル内の全テスト）。

新テストを追加:

```ts
test("bundle fragments merge after languages and contribute to universe; bundle files distribute", async () => {
  const src = memorySource({
    files: {
      "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
      "bundles/oss/files/CONTRIBUTING.md": "contributing\n",
    },
    fragments: {
      base: { renovate: ["github>o/renovate-config"] },
      "languages/java": { renovate: ["github>o/renovate-config:java"] },
      "bundles/oss": { renovate: ["github>o/renovate-config:oss"] },
    },
    languages: ["java"],
    bundles: ["oss"],
  });
  const entries = await resolveDesiredEntries({ source: src, languages: ["java"], bundles: ["oss"], vars: {}, exclude: [] });
  const r = entries.find((e) => e.path === "renovate.json")!;
  if (r.strategy !== "extends-field") throw new Error("wrong strategy");
  expect(r.managedExtends).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:java",
    "github>o/renovate-config:oss",
  ]);
  expect(r.universe).toContain("github>o/renovate-config:oss");
  expect(entries.find((e) => e.path === "CONTRIBUTING.md")?.strategy).toBe("replace");
});

test("unknown bundle throws; bundle/language file collision throws", async () => {
  await expect(resolveDesiredEntries({ source: source(), languages: [], bundles: ["nope"], vars: {}, exclude: [] }))
    .rejects.toThrow(/unknown bundle/i);

  const collide = memorySource({
    files: { "languages/a/files/x.txt": "a", "bundles/b/files/x.txt": "b" },
    fragments: {},
    languages: ["a"],
    bundles: ["b"],
  });
  await expect(resolveDesiredEntries({ source: collide, languages: ["a"], bundles: ["b"], vars: {}, exclude: [] }))
    .rejects.toThrow(/collision/i);
});
```

- [ ] **Step 2: テストが落ちる（コンパイルエラー含む）ことを確認**

Run: `pnpm -C packages/core test`
Expected: FAIL（`listNames` が TemplateSource に無い / `bundles` が ResolveArgs に無い）

- [ ] **Step 3: `templates/types.ts` を更新**

`TemplateSource` の `listLanguages`/`languageExists` を置き換え、`FragmentAxis` を追加:

```ts
/** fragment を提供する宣言軸のディレクトリ名 */
export type FragmentAxis = "languages" | "bundles";

/** テンプレ専用リポからの読み取りを抽象化（worker/cli は GitHub 経由、test はメモリ） */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
  /** `${dir}/fragment.json` を読む（"base" | "languages/<name>" | "bundles/<name>"）。無ければ null */
  readFragmentManifest(dir: string): Promise<FragmentManifest | null>;
  /** `<axis>/` 直下のディレクトリ名一覧（universe 計算用） */
  listNames(axis: FragmentAxis): Promise<string[]>;
  /** `<axis>/<name>/` が存在するか（未知名検出用） */
  nameExists(axis: FragmentAxis, name: string): Promise<boolean>;
}
```

- [ ] **Step 4: `templates/resolve.ts` を更新**

`ResolveArgs` に `bundles: string[];` を追加。`destPath` に bundles の strip を追加:

```ts
function destPath(fullPath: string): string {
  return fullPath
    .replace(/^base\/files\//, "")
    .replace(/^languages\/[^/]+\/files\//, "")
    .replace(/^bundles\/[^/]+\/files\//, "")
    .replace(/^seeds\//, "");
}
```

検証・fragment 収集・グループを bundles 対応に（`resolveDesiredEntries` 冒頭〜グループ定義を以下で置換）:

```ts
  // 1. 未知 language / bundle はエラー
  for (const lang of args.languages) {
    if (!(await source.nameExists("languages", lang))) throw new Error(`unknown language: ${lang}`);
  }
  for (const b of args.bundles) {
    if (!(await source.nameExists("bundles", b))) throw new Error(`unknown bundle: ${b}`);
  }

  // 2. fragment 収集：宣言分（base→languages 宣言順→bundles 宣言順）と全単位（universe 用）
  const baseFragment = (await source.readFragmentManifest("base")) ?? {};
  const declared: FragmentManifest[] = [baseFragment];
  for (const lang of args.languages) {
    declared.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }
  for (const b of args.bundles) {
    declared.push((await source.readFragmentManifest(`bundles/${b}`)) ?? {});
  }
  const all: FragmentManifest[] = [baseFragment];
  for (const lang of await source.listNames("languages")) {
    all.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }
  for (const b of await source.listNames("bundles")) {
    all.push((await source.readFragmentManifest(`bundles/${b}`)) ?? {});
  }
```

```ts
  const groups: Array<{ prefix: string; seeds: boolean }> = [
    { prefix: "base/files/", seeds: false },
    { prefix: "seeds/", seeds: true },
    ...args.languages.map((l) => ({ prefix: `languages/${l}/files/`, seeds: false })),
    ...args.bundles.map((b) => ({ prefix: `bundles/${b}/files/`, seeds: false })),
  ];
```

- [ ] **Step 5: `index.ts` の export を更新**

```ts
export type { TemplateSource, FragmentManifest, FragmentAxis, GitignoreSection, DesiredEntry } from "./templates/types.js";
```

- [ ] **Step 6: core テストが通ることを確認**

Run: `pnpm -C packages/core test`
Expected: PASS（この時点で worker/cli はまだ壊れている＝正常。core のみ確認）

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add bundles axis to TemplateSource and resolveDesiredEntries"
```

---

## Task 4: worker — bundles 追随

**Files:**
- Modify: `apps/worker/src/github/templateSource.ts`
- Modify: `apps/worker/src/workflows/parent.ts:51`
- Modify: `apps/worker/src/workflows/child.ts`
- Test: `apps/worker/test/github/templateSource.test.ts`

- [ ] **Step 1: templateSource テストを新 interface で書き換え（失敗を確認）**

`apps/worker/test/github/templateSource.test.ts` の `listLanguages` テスト（`test("listLanguages returns unique language dir names from tree", ...)`）を差し替え:

```ts
test("listNames returns unique dir names per axis; nameExists checks the axis", async () => {
  const client = clientReturning({
    "/git/trees/HEAD?recursive=1": { tree: [
      { path: "languages/terraform/fragment.json", type: "blob" },
      { path: "languages/typescript/fragment.json", type: "blob" },
      { path: "languages/typescript/files/.editorconfig", type: "blob" },
      { path: "bundles/oss/files/CONTRIBUTING.md", type: "blob" },
      { path: "base/fragment.json", type: "blob" },
    ] },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  expect((await src.listNames("languages")).sort()).toEqual(["terraform", "typescript"]);
  expect(await src.listNames("bundles")).toEqual(["oss"]);
  expect(await src.nameExists("languages", "terraform")).toBe(true);
  expect(await src.nameExists("languages", "oss")).toBe(false);
  expect(await src.nameExists("bundles", "oss")).toBe(true);
});
```

Run: `pnpm -C apps/worker test`
Expected: FAIL（`listNames` 未実装）

- [ ] **Step 2: `GitHubTemplateSource` を実装**

`listLanguages`/`languageExists` メソッドを以下で置き換え（import に `type FragmentAxis` を追加）:

```ts
import { GitHubClient, type FragmentAxis, type FragmentManifest, type TemplateSource } from "@repository-fanout/core";
```

```ts
  async listNames(axis: FragmentAxis): Promise<string[]> {
    const names = new Set<string>();
    const re = new RegExp(`^${axis}/([^/]+)/`);
    for (const p of await this.tree()) {
      const m = re.exec(p);
      if (m) names.add(m[1]!);
    }
    return [...names];
  }

  async nameExists(axis: FragmentAxis, name: string): Promise<boolean> {
    return (await this.tree()).some((p) => p.startsWith(`${axis}/${name}/`));
  }
```

- [ ] **Step 3: workflows に bundles を通す**

`apps/worker/src/workflows/child.ts` の `ChildParams` に `bundles: string[];` を追加（`languages` の次）。`resolveDesiredEntries` 呼び出しを:

```ts
retry(() => resolveDesiredEntries({ source: templates, languages: p.languages, bundles: p.bundles, vars: p.vars, exclude: p.exclude })),
```

`apps/worker/src/workflows/parent.ts:51` の spawn params を:

```ts
languages: entry.languages, bundles: entry.bundles, vars: entry.vars, exclude: entry.exclude,
```

- [ ] **Step 4: worker テスト + 型チェック**

Run: `pnpm -C apps/worker test && pnpm -C apps/worker typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): thread bundles through template source and workflows"
```

---

## Task 5: cli — bundles 追随

**Files:**
- Modify: `apps/cli/src/github.ts`
- Modify: `apps/cli/src/planRepo.ts`
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/test/planRepo.test.ts`（インライン source の追随）

- [ ] **Step 1: `github.ts` の templateSource を新 interface に**

`listLanguages`/`languageExists` を以下で置き換え:

```ts
    async listNames(axis) {
      const names = new Set<string>();
      const re = new RegExp(`^${axis}/([^/]+)/`);
      for (const p of await tree()) {
        const m = re.exec(p);
        if (m) names.add(m[1]!);
      }
      return [...names];
    },
    async nameExists(axis, name) {
      return (await tree()).some((p) => p.startsWith(`${axis}/${name}/`));
    },
```

- [ ] **Step 2: `planRepo.ts` に bundles を通す**

`PlanArgs` に `bundles: string[];` を追加し、`resolveDesiredEntries` 呼び出しに `bundles: args.bundles,` を追加。

- [ ] **Step 3: `index.ts` に `--bundles` フラグを追加**

`const languages = ...` の次の行に:

```ts
  const bundles = (arg("bundles") ?? "").split(",").filter(Boolean);
```

usage 文字列を:

```ts
      "usage: GITHUB_TOKEN=... fanout dry-run --repo owner/name [--languages a,b] [--bundles x,y] [--templates owner/repo] [--codeowner x]",
```

`planRepo({...})` 呼び出しに `bundles,` を追加。

- [ ] **Step 4: テストの追随**

`apps/cli/test/planRepo.test.ts` の 2 つのインライン `TemplateSource`（トップレベル `source` と `planRepo merges managed block...` 内の `src`）で、`listLanguages`/`languageExists` を以下に置き換え:

```ts
  async listNames() {
    return [];
  },
  async nameExists() {
    return true;
  },
```

全 `planRepo({...})` 呼び出しに `bundles: [],` を追加。

- [ ] **Step 5: cli テスト + 型チェック → 全体確認**

Run: `pnpm -C apps/cli test && pnpm -C apps/cli typecheck`
Expected: PASS
Run: `pnpm test && pnpm typecheck`（リポルート）
Expected: PASS（bundles 軸がモノレポ全体で整合）

- [ ] **Step 6: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): add --bundles flag and follow TemplateSource change"
```

---

## Task 6: core — `parseStrategyConfig`（TDD）

**Files:**
- Create: `packages/core/src/templates/strategyConfig.ts`
- Test: `packages/core/test/templates/strategyConfig.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/templates/strategyConfig.test.ts` を新規作成:

```ts
import { expect, test } from "vitest";
import { parseStrategyConfig } from "../../src/templates/strategyConfig.js";

test("accepts a valid path -> strategy map", () => {
  const c = parseStrategyConfig('{"renovate.json":"extends-field",".gitignore":"managed-block"}');
  expect(c).toEqual({ "renovate.json": "extends-field", ".gitignore": "managed-block" });
});

test("accepts {} as explicit 'no special strategies'", () => {
  expect(parseStrategyConfig("{}")).toEqual({});
});

test("rejects missing file (null) — no silent downgrade to replace", () => {
  expect(() => parseStrategyConfig(null)).toThrow(/strategies\.json not found/i);
});

test("rejects invalid JSON", () => {
  expect(() => parseStrategyConfig("{oops")).toThrow(/invalid JSON/i);
});

test("rejects non-object roots", () => {
  expect(() => parseStrategyConfig('["extends-field"]')).toThrow(/object/i);
  expect(() => parseStrategyConfig('"extends-field"')).toThrow(/object/i);
});

test("rejects unknown strategy values, naming the offending path", () => {
  // replace / create-only は「割り当て」できない（既定挙動なので書かない）
  expect(() => parseStrategyConfig('{"renovate.json":"replace"}')).toThrow(/renovate\.json/);
  expect(() => parseStrategyConfig('{"a.md":5}')).toThrow(/a\.md/);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -C packages/core test`
Expected: FAIL（モジュール不在）

- [ ] **Step 3: 実装**

`packages/core/src/templates/strategyConfig.ts` を新規作成:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -C packages/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/templates/strategyConfig.ts packages/core/test/templates/strategyConfig.test.ts
git commit -m "feat(core): add parseStrategyConfig for strategies.json"
```

---

## Task 7: core — resolve を strategies.json 駆動に（`STRATEGY_REGISTRY` 撤去）

**Files:**
- Modify: `packages/core/src/templates/resolve.ts`
- Test: `packages/core/test/templates/resolve.test.ts`
- Test(追随): `apps/cli/test/planRepo.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/templates/resolve.test.ts` — `memorySource` に strategies.json の既定を持たせる（差し替え）:

```ts
const DEFAULT_STRATEGIES =
  '{"renovate.json":"extends-field",".gitignore":"managed-block",".github/CODEOWNERS":"managed-block"}';

function memorySource(opts: {
  files: Record<string, string>;
  fragments: Record<string, FragmentManifest>; // "base" | "languages/<lang>" | "bundles/<name>"
  languages: string[];                          // 存在する language 一覧
  bundles?: string[];                           // 存在する bundle 一覧
  omitStrategies?: boolean;                     // strategies.json 不在ケースの再現用
}): TemplateSource {
  const files = opts.omitStrategies
    ? { ...opts.files }
    : { "strategies.json": DEFAULT_STRATEGIES, ...opts.files };
  const names = { languages: opts.languages, bundles: opts.bundles ?? [] };
  return {
    async readFile(p) { return files[p] ?? null; },
    async listFiles(prefix) { return Object.keys(files).filter((p) => p.startsWith(prefix)); },
    async readFragmentManifest(dir) { return opts.fragments[dir] ?? null; },
    async listNames(axis) { return names[axis]; },
    async nameExists(axis, name) { return names[axis].includes(name); },
  };
}
```

既存テスト名 `"strategies are assigned per path via registry"` を `"strategies are assigned per path via strategies.json"` に変更（本体は不変）。

新テストを追加:

```ts
test("missing strategies.json fails resolve (fail fast)", async () => {
  const src = memorySource({
    files: { "base/files/renovate.json": "{}\n" },
    fragments: {},
    languages: [],
    omitStrategies: true,
  });
  await expect(resolveDesiredEntries({ source: src, languages: [], bundles: [], vars: {}, exclude: [] }))
    .rejects.toThrow(/strategies\.json not found/i);
});

test("strategy mapping is data-driven: config assigns and unassigns without code change", async () => {
  const src = memorySource({
    files: {
      "strategies.json": '{"NOTICE.md":"managed-block"}',
      "base/files/NOTICE.md": "managed notice\n",
      "base/files/renovate.json": "{}\n",
    },
    fragments: {},
    languages: [],
  });
  const entries = await resolveDesiredEntries({ source: src, languages: [], bundles: [], vars: {}, exclude: [] });
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  expect(byPath["NOTICE.md"]!.strategy).toBe("managed-block");
  // map から外れたパスは既定の replace に戻る
  expect(byPath["renovate.json"]!.strategy).toBe("replace");
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -C packages/core test`
Expected: FAIL（`STRATEGY_REGISTRY` 固定のため NOTICE.md が replace になる / 不在でも throw しない）

- [ ] **Step 3: `resolve.ts` を実装**

`STRATEGY_REGISTRY` 定数（とそのコメント）を削除し、import を追加:

```ts
import { parseStrategyConfig } from "./strategyConfig.js";
```

`resolveDesiredEntries` の未知名検証の前に読み込みを追加:

```ts
  // 0. strategies.json（不在は fail fast。spec 2026-07-03 §3）
  const strategies = parseStrategyConfig(await source.readFile("strategies.json"));
```

ファイル収集ループ内の参照を置換:

```ts
      const special = seeds ? undefined : strategies[dest];
```

- [ ] **Step 4: core テストが通ることを確認**

Run: `pnpm -C packages/core test`
Expected: PASS

- [ ] **Step 5: cli テストの追随（resolve が strategies.json を要求するようになったため）**

`apps/cli/test/planRepo.test.ts` の 2 つのインライン source の `readFile` を strategies.json も返すように変更。

トップレベル `source`:

```ts
  async readFile(p) {
    if (p === "strategies.json") return '{"renovate.json":"extends-field"}';
    return p === "base/files/renovate.json" ? '{"extends":[{{renovate_extends}}]}' : null;
  },
```

`planRepo merges managed block...` 内の `src`:

```ts
    async readFile(p) {
      if (p === "strategies.json") return '{".gitignore":"managed-block"}';
      return p === "base/files/.gitignore" ? "{{gitignore}}\n" : null;
    },
```

- [ ] **Step 6: 全体確認**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core apps/cli/test
git commit -m "feat(core): drive path->strategy assignment from strategies.json"
```

---

## Task 8: worker — Discord 通知モジュール（TDD）

**Files:**
- Create: `apps/worker/src/notify.ts`
- Test: `apps/worker/test/notify.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/worker/test/notify.test.ts` を新規作成:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { notifyFailure } from "../src/notify.js";

const info = { runId: "r1", account: "bright-room", repo: "bright-room/x", error: "boom" };

afterEach(() => vi.unstubAllGlobals());

test("posts a plain content message to the webhook", async () => {
  const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await notifyFailure("https://discord.example/webhook", info);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("https://discord.example/webhook");
  const body = JSON.parse(init.body as string) as { content: string };
  expect(body.content).toContain("bright-room/x");
  expect(body.content).toContain("boom");
  expect(body.content).toContain("r1");
});

test("skips when webhook url is not configured", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await notifyFailure(undefined, info);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("swallows network errors and non-2xx responses", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net down"); }));
  await expect(notifyFailure("https://discord.example/webhook", info)).resolves.toBeUndefined();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
  await expect(notifyFailure("https://discord.example/webhook", info)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -C apps/worker test`
Expected: FAIL（モジュール不在）

- [ ] **Step 3: 実装**

`apps/worker/src/notify.ts` を新規作成:

```ts
export interface FailureInfo {
  runId: string;
  account: string;
  repo: string;
  error: string;
}

/**
 * リポ単位の失敗を Discord Webhook にプレーンテキストで通知する（spec 2026-07-03 §4）。
 * webhookUrl 未設定はスキップ。送信失敗・非 2xx は握りつぶす（ログのみ）—
 * 通知が reconcile を壊してはならない。
 */
export async function notifyFailure(webhookUrl: string | undefined, info: FailureInfo): Promise<void> {
  if (!webhookUrl) return;
  const content = `❌ fanout failed: ${info.repo} (account: ${info.account}) — ${info.error} (run: ${info.runId})`;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) console.error(`discord notify failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`discord notify failed: ${String(err)}`);
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -C apps/worker test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/notify.ts apps/worker/test/notify.test.ts
git commit -m "feat(worker): add Discord failure notification module"
```

---

## Task 9: worker — 失敗記録 + 通知の配線（`reportRepoFailure`）

**Files:**
- Create: `apps/worker/src/failure.ts`
- Modify: `apps/worker/src/index.ts`（Env に `DISCORD_WEBHOOK_URL`）
- Modify: `apps/worker/src/workflows/parent.ts`（failed 記録 2 箇所）
- Modify: `apps/worker/src/workflows/child.ts`（failed 記録 2 箇所）
- Modify: `apps/worker/wrangler.toml`（secrets コメント）
- Test: `apps/worker/test/failure.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/worker/test/failure.test.ts` を新規作成:

```ts
import { env } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import { reportRepoFailure } from "../src/failure.js";
import { getRun } from "../src/kv/runStore.js";
import type { Env } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

test("records a failed result to RUNS and notifies discord", async () => {
  const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  // env は test/env.d.ts で Env 型（ProvidedEnv extends Env）
  const testEnv: Env = { ...env, DISCORD_WEBHOOK_URL: "https://discord.example/webhook" };
  await reportRepoFailure(testEnv, "runX", { account: "bright-room", repo: "r1", error: "boom" });
  const run = await getRun(env.RUNS, "runX");
  expect(run).toMatchObject([{ account: "bright-room", repo: "r1", status: "failed", error: "boom" }]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

Run: `pnpm -C apps/worker test`
Expected: FAIL（モジュール不在）

- [ ] **Step 2: `Env` と `failure.ts` を実装**

`apps/worker/src/index.ts` の `Env` に追加（`TEMPLATES_REPO: string;` の次）:

```ts
  /** Discord Webhook（任意）。未設定なら失敗通知をスキップ */
  DISCORD_WEBHOOK_URL?: string;
```

`apps/worker/src/failure.ts` を新規作成:

```ts
import { recordRepoResult } from "./kv/runStore.js";
import { notifyFailure } from "./notify.js";
import type { Env } from "./index.js";

/** リポ単位の失敗を RUNS KV に記録し、Discord に通知する（通知失敗は notify 側で握りつぶし） */
export async function reportRepoFailure(
  env: Env,
  runId: string,
  f: { account: string; repo: string; error: string },
): Promise<void> {
  await recordRepoResult(env.RUNS, runId, { ...f, status: "failed" });
  await notifyFailure(env.DISCORD_WEBHOOK_URL, { runId, ...f });
}
```

Run: `pnpm -C apps/worker test`
Expected: PASS

- [ ] **Step 3: 4 つの failed 記録箇所を `reportRepoFailure` に置換**

`apps/worker/src/workflows/parent.ts` — import を追加し（`recordRepoResult` の import は残す — noop/success で使用しないので不要になれば削除）:

```ts
import { reportRepoFailure } from "../failure.js";
```

installation 欠如ループ（元 L36-38）:

```ts
        for (const repo of Object.keys(manifest.repositories)) {
          await reportRepoFailure(this.env, runId, {
            account: manifest.account, repo, error: "no installation for account",
          });
        }
```

spawn 失敗 catch（元 L56-59）:

```ts
        } catch (err) {
          await reportRepoFailure(this.env, runId, {
            account: manifest.account, repo: name, error: `spawn failed: ${String(err)}`,
          });
        }
```

parent.ts で `recordRepoResult` が未使用になったら import から削除する。

`apps/worker/src/workflows/child.ts` — import を追加（`recordRepoResult` は success/noop 記録で使い続けるので残す）:

```ts
import { reportRepoFailure } from "../failure.js";
```

RenovateParseError 箇所（元 L64-66）:

```ts
          await reportRepoFailure(this.env, p.runId, {
            account: p.account, repo: p.repo, error: err.message,
          });
```

catch-all（元 L142-144）:

```ts
    } catch (err) {
      await reportRepoFailure(this.env, p.runId, {
        account: p.account, repo: p.repo, error: String(err),
      });
      throw err; // Workflows のリトライに委ねる
    }
```

- [ ] **Step 4: wrangler.toml の secrets コメントに追記**

`apps/worker/wrangler.toml` 末尾の secrets コメントブロックに追加:

```toml
#   DISCORD_WEBHOOK_URL                … 失敗通知先 Discord Webhook（任意。未設定ならスキップ）
```

- [ ] **Step 5: worker テスト + 型チェック**

Run: `pnpm -C apps/worker test && pnpm -C apps/worker typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): report repo failures to Discord via reportRepoFailure"
```

---

## Task 10: 最終確認

- [ ] **Step 1: 全テスト・全型チェック**

Run: `pnpm test && pnpm typecheck`
Expected: 全パッケージ PASS

- [ ] **Step 2: spec との突き合わせ**

`docs/superpowers/specs/2026-07-03-bundles-and-strategy-config-design.md` の §5 エラー処理表・§6 テスト戦略の各項目に対応する実装/テストがあることを確認（unknown bundle / strategies.json 不在・不正 / 衝突 / 通知スキップ・握りつぶし）。

- [ ] **Step 3: 完了報告**

未コミットの差分が無いことを確認し（`git status`）、PR 分割（docs / bundles / strategies / notify を分けるか、まとめて 1 PR か）をユーザーに確認する。

---

## Self-Review

- **Spec カバレッジ**: spec §2 bundles = Task 2-5 / §3 strategies.json = Task 6-7 / §4 Discord = Task 8-9 / §7 フェーズ1 docs 追随 = Task 1（sample は spec 承認時に配置済み）/ §5・§6 = 各タスクのテストと Task 10。
- **型整合**: `FragmentAxis`・`listNames`/`nameExists`（core/worker/cli/test 全て同名）、`ResolveArgs.bundles`・`RepoEntry.bundles`・`ChildParams.bundles`・`PlanArgs.bundles`、`parseStrategyConfig(raw: string | null)`、`notifyFailure(webhookUrl, FailureInfo)`、`reportRepoFailure(env, runId, {account, repo, error})`。spec の `Axis`/`(input: unknown)` 表記は Task 1 Step 3 で本実装名に確定。
- **既知の割り切り**: parent/child の配線は既存同様テストなし（typecheck で担保）。cli の `listNames` は planRepo テストが resolve 経由で間接カバー。
