# P7: fragment + sync 戦略モデルへのコード追随 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マージ済みの core / worker / cli を、spec の仕様変更（2026-07-02）に追随させる：宣言軸 `profiles`→`languages`、テンプレリポ構成 `languages/<lang>/fragment.json`、sync 戦略（replace / create-only / managed-block / json-field(extends)）による「管理断片のみ反映・リポ独自部分不可侵」。

**Architecture:** resolve は actual 非依存のまま `DesiredEntry`（戦略付き）を返し、`computeChanges` が actual を受けて戦略別マージ＋差分を計算する（純関数維持）。spec `docs/superpowers/specs/2026-06-26-repository-fanout-design.md` §3/§4 と sample `docs/superpowers/specs/sample/` が正。

**Tech Stack:** 既存どおり（TypeScript / pnpm / vitest / Workers）。

**前提:** P1/P2/P5 マージ済み。worker 未デプロイ（KV に旧形式 manifest は存在しない＝マイグレーション不要）。

---

## File Structure（変更対象）

```
packages/core/src/
  manifest/types.ts        # RepoEntry.profiles → languages
  manifest/parse.ts        # languages 検証
  templates/types.ts       # FragmentManifest / TemplateSource 新IF / DesiredEntry
  templates/render.ts      # （既存関数は維持。renderRenovateExtends は create 用に残す）
  templates/resolve.ts     # resolveDesiredEntries へ書き換え（languages/・fragment.json・戦略レジストリ・universe）
  reconcile/block.ts       # NEW: managed-block マーカー＋apply
  reconcile/extendsField.ts# NEW: extends マージ＋RenovateParseError
  reconcile/diff.ts        # computeChanges を戦略対応に書き換え
  index.ts                 # exports 更新
packages/core/test/        # 上記対応テスト（既存の profiles 系を languages 系へ）
apps/worker/src/
  github/templateSource.ts # 新 TemplateSource IF 実装（fragment.json / listLanguages / languageExists）
  workflows/child.ts       # ChildParams.languages・RenovateParseError → failed（リトライしない）
  workflows/parent.ts      # entry.languages
apps/worker/test/          # templateSource / sync fixtures を languages へ
apps/cli/src/
  github.ts                # 新 TemplateSource IF 実装
  planRepo.ts              # DesiredEntry + computeChanges(actual)
  index.ts                 # --profiles → --languages
apps/cli/test/
```

方針：**リネームは全面置換**（後方互換レイヤは作らない。未デプロイ・利用者ゼロのため）。

---

## Task 1: core — manifest を languages へ

**Files:**
- Modify: `packages/core/src/manifest/types.ts`, `packages/core/src/manifest/parse.ts`
- Test: `packages/core/test/manifest/parse.test.ts`

- [ ] **Step 1: テストを languages へ書き換え（失敗させる）**

`parse.test.ts` の全 `profiles` を `languages` に置換し、バリデーションメッセージ期待も更新：

```ts
const valid = {
  account: "bright-room",
  revision: 5,
  sourceCommit: "abc123",
  repositories: {
    "endpoint-gate": { languages: ["terraform"], vars: { codeowner: "bright-room/br-maintainers" } },
  },
};

test("parseManifest accepts a valid manifest", () => {
  const m = parseManifest(valid);
  expect(m.repositories["endpoint-gate"]!.languages).toEqual(["terraform"]);
});

test("parseManifest rejects non-string languages entries", () => {
  expect(() => parseManifest({
    ...valid,
    repositories: { r: { languages: [1] } },
  })).toThrow(/languages/);
});
```
（既存の vars/exclude/revision 系テストは languages 表記に直して維持）

- [ ] **Step 2: 失敗確認**

Run: `pnpm --filter @repository-fanout/core test manifest/parse`
Expected: FAIL

- [ ] **Step 3: 実装**

`types.ts`:
```ts
export interface RepoEntry {
  languages: string[];
  vars: Record<string, string>;
  exclude: string[];
}
```

`parse.ts`: `r.profiles` 参照を `r.languages` に変更、エラーメッセージも `manifest: ${name}.languages must be an array of strings` 等へ。

- [ ] **Step 4: 通過確認 → Commit**

```bash
git add packages/core/src/manifest packages/core/test/manifest
git commit -m "feat(core)!: rename manifest profiles to languages"
```

---

## Task 2: core — templates 型と TemplateSource 新インターフェース

**Files:**
- Modify: `packages/core/src/templates/types.ts`

- [ ] **Step 1: 型を書き換え**

```ts
/** base/ または languages/<lang>/ の fragment.json */
export interface FragmentManifest {
  /** renovate extends エントリ（renovate-config 参照 or 組み込み preset） */
  renovate?: string[];
  /** .gitignore の managed-block に足す行 */
  gitignore?: string[];
}

/** テンプレ専用リポからの読み取りを抽象化（worker/cli は GitHub 経由、test はメモリ） */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
  /** `${dir}/fragment.json` を読む（"base" | "languages/<lang>"）。無ければ null */
  readFragmentManifest(dir: string): Promise<FragmentManifest | null>;
  /** languages/ 直下のディレクトリ名一覧（universe 計算用） */
  listLanguages(): Promise<string[]>;
  /** languages/<lang>/ が存在するか（未知 language 検出用） */
  languageExists(lang: string): Promise<boolean>;
}

/** resolve の出力。戦略ごとに必要な情報を持つ（actual とのマージは computeChanges が行う） */
export type DesiredEntry =
  | { strategy: "replace"; path: string; content: string }
  | { strategy: "create-only"; path: string; content: string }
  | { strategy: "managed-block"; path: string; blockContent: string }
  | {
      strategy: "extends-field";
      path: string;
      /** 宣言 languages から導出した管理 extends（正準順） */
      managedExtends: string[];
      /** base∪全 language の貢献（管理対象判定用） */
      universe: string[];
      /** ファイル不在時に新規作成する全文 */
      createContent: string;
    };
```

（旧 `ProfileManifest` / `DesiredFile` は削除。コンパイルエラーは後続タスクで解消していく——このタスク時点では typecheck が通らないことを許容し、コミットは Task 5 でまとめて行う）

- [ ] **Step 2:** 次タスクへ（コミットは Task 5 末尾）

---

## Task 3: core — managed-block ヘルパー（TDD）

**Files:**
- Create: `packages/core/src/reconcile/block.ts`
- Test: `packages/core/test/reconcile/block.test.ts`

- [ ] **Step 1: 失敗するテスト**

```ts
import { expect, test } from "vitest";
import { applyManagedBlock, BLOCK_START, BLOCK_END } from "../../src/reconcile/block.js";

const block = (inner: string) => `${BLOCK_START}\n${inner}\n${BLOCK_END}`;

test("creates block-only file when actual is absent", () => {
  expect(applyManagedBlock(undefined, "a\nb")).toBe(block("a\nb") + "\n");
});

test("prepends block when actual has no markers, preserving existing content", () => {
  expect(applyManagedBlock("repo1\nrepo2\n", "a")).toBe(block("a") + "\nrepo1\nrepo2\n");
});

test("replaces only the marked region, preserving before/after", () => {
  const actual = `${block("old")}\nrepo-own\n`;
  expect(applyManagedBlock(actual, "new")).toBe(`${block("new")}\nrepo-own\n`);
});

test("idempotent: applying same content returns identical string", () => {
  const once = applyManagedBlock("repo\n", "x\ny");
  expect(applyManagedBlock(once, "x\ny")).toBe(once);
});
```

- [ ] **Step 2: 失敗確認**

Run: `pnpm --filter @repository-fanout/core test reconcile/block`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
export const BLOCK_START = "# >>> repository-fanout managed >>>";
export const BLOCK_END = "# <<< repository-fanout managed <<<";

/**
 * managed-block 戦略：actual にブロックがあれば中身だけ差し替え、
 * 無ければ先頭に挿入、actual 不在ならブロックのみで新規作成。
 */
export function applyManagedBlock(actual: string | undefined, blockContent: string): string {
  const blockText = `${BLOCK_START}\n${blockContent}\n${BLOCK_END}`;
  if (actual === undefined) return `${blockText}\n`;
  const start = actual.indexOf(BLOCK_START);
  const end = actual.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    return actual.slice(0, start) + blockText + actual.slice(end + BLOCK_END.length);
  }
  return `${blockText}\n${actual}`;
}
```

- [ ] **Step 4: 通過確認 → Commit**

```bash
git add packages/core/src/reconcile/block.ts packages/core/test/reconcile/block.test.ts
git commit -m "feat(core): managed-block apply helper"
```

---

## Task 4: core — extends マージヘルパー（TDD）

**Files:**
- Create: `packages/core/src/reconcile/extendsField.ts`
- Test: `packages/core/test/reconcile/extendsField.test.ts`

- [ ] **Step 1: 失敗するテスト**

```ts
import { expect, test } from "vitest";
import { mergeExtends, applyExtendsField, RenovateParseError } from "../../src/reconcile/extendsField.js";

const managed = ["github>o/renovate-config", "github>o/renovate-config:typescript"];
const universe = [
  "github>o/renovate-config",
  "github>o/renovate-config:terraform",
  "github>o/renovate-config:typescript",
  "github>o/renovate-config:java",
  "group:springBoot",
];

test("mergeExtends replaces managed entries and preserves repo-own entries after", () => {
  const actual = ["github>o/renovate-config", "github>o/renovate-config:java", ":enablePreCommit"];
  expect(mergeExtends(actual, managed, universe)).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:typescript",
    ":enablePreCommit",
  ]);
});

test("mergeExtends with no actual returns managed", () => {
  expect(mergeExtends(undefined, managed, universe)).toEqual(managed);
});

test("applyExtendsField returns null when semantically equal (no-op, formatting untouched)", () => {
  const actual = `{\n  "extends": ["github>o/renovate-config","github>o/renovate-config:typescript"],\n  "automerge": false\n}\n`;
  expect(applyExtendsField(actual, managed, universe)).toBeNull();
});

test("applyExtendsField rewrites only extends, preserving other keys", () => {
  const actual = JSON.stringify({
    $schema: "s",
    extends: ["github>o/renovate-config"],
    packageRules: [{ matchPackageNames: ["x"], enabled: false }],
  }, null, 2);
  const out = applyExtendsField(actual, managed, universe)!;
  const parsed = JSON.parse(out);
  expect(parsed.extends).toEqual(managed);
  expect(parsed.packageRules).toEqual([{ matchPackageNames: ["x"], enabled: false }]);
  expect(parsed.$schema).toBe("s");
});

test("applyExtendsField throws RenovateParseError on invalid json", () => {
  expect(() => applyExtendsField("// json5 comment\n{}", managed, universe)).toThrow(RenovateParseError);
});
```

- [ ] **Step 2: 失敗確認**

Run: `pnpm --filter @repository-fanout/core test reconcile/extendsField`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(actualContent) as Record<string, unknown>;
  } catch (e) {
    throw new RenovateParseError(e);
  }
  const actualExtends = Array.isArray(parsed.extends) ? (parsed.extends as unknown[]).map(String) : [];
  const next = mergeExtends(actualExtends, managed, universe);
  if (next.length === actualExtends.length && next.every((v, i) => v === actualExtends[i])) return null;
  parsed.extends = next; // JSON.parse は挿入順を保持。既存キー位置は維持される
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
```

- [ ] **Step 4: 通過確認 → Commit**

```bash
git add packages/core/src/reconcile/extendsField.ts packages/core/test/reconcile/extendsField.test.ts
git commit -m "feat(core): extends-field merge helpers (managed entries only)"
```

---

## Task 5: core — resolve を languages + 戦略レジストリへ書き換え（TDD）

**Files:**
- Modify: `packages/core/src/templates/resolve.ts`
- Test: `packages/core/test/templates/resolve.test.ts`（全面書き換え）

- [ ] **Step 1: 失敗するテスト（メモリ TemplateSource を新 IF で）**

```ts
import { expect, test } from "vitest";
import { resolveDesiredEntries } from "../../src/templates/resolve.js";
import type { TemplateSource, FragmentManifest } from "../../src/templates/types.js";

function memorySource(opts: {
  files: Record<string, string>;
  fragments: Record<string, FragmentManifest>; // "base" | "languages/<lang>"
  languages: string[];                          // 存在する language 一覧
}): TemplateSource {
  return {
    async readFile(p) { return opts.files[p] ?? null; },
    async listFiles(prefix) { return Object.keys(opts.files).filter((p) => p.startsWith(prefix)); },
    async readFragmentManifest(dir) { return opts.fragments[dir] ?? null; },
    async listLanguages() { return opts.languages; },
    async languageExists(lang) { return opts.languages.includes(lang); },
  };
}

const source = () => memorySource({
  files: {
    "base/files/renovate.json": '{\n  "$schema": "s",\n  "extends": [{{renovate_extends}}]\n}\n',
    "base/files/.gitignore": "{{gitignore}}\n",
    "base/files/.github/CODEOWNERS": "* @{{codeowner}}\n",
    "base/files/.github/release.yml": "changelog: {}\n",
    "seeds/STARTER.md": "starter\n",
    "languages/typescript/files/.editorconfig": "root = true\n",
  },
  fragments: {
    base: { renovate: ["github>o/renovate-config"], gitignore: ["# base", ".DS_Store"] },
    "languages/terraform": { renovate: ["github>o/renovate-config:terraform"], gitignore: ["# tf", "*.tfstate"] },
    "languages/typescript": { renovate: ["github>o/renovate-config:typescript"], gitignore: ["# node", "node_modules/"] },
    "languages/java": { renovate: ["github>o/renovate-config:java"] },
  },
  languages: ["terraform", "typescript", "java"],
});

test("strategies are assigned per path via registry", async () => {
  const entries = await resolveDesiredEntries({ source: source(), languages: [], vars: { codeowner: "kukv" }, exclude: [] });
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  expect(byPath["renovate.json"]!.strategy).toBe("extends-field");
  expect(byPath[".gitignore"]!.strategy).toBe("managed-block");
  expect(byPath[".github/CODEOWNERS"]!.strategy).toBe("managed-block");
  expect(byPath[".github/release.yml"]!.strategy).toBe("replace");
  expect(byPath["STARTER.md"]!.strategy).toBe("create-only");
});

test("extends-field entry carries managed (declared) and universe (all languages)", async () => {
  const entries = await resolveDesiredEntries({ source: source(), languages: ["typescript"], vars: {}, exclude: [] });
  const r = entries.find((e) => e.path === "renovate.json")!;
  if (r.strategy !== "extends-field") throw new Error("wrong strategy");
  expect(r.managedExtends).toEqual(["github>o/renovate-config", "github>o/renovate-config:typescript"]);
  expect(r.universe).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:terraform",
    "github>o/renovate-config:typescript",
    "github>o/renovate-config:java",
  ]);
  expect(r.createContent).toBe('{\n  "$schema": "s",\n  "extends": ["github>o/renovate-config", "github>o/renovate-config:typescript"]\n}\n');
});

test("managed-block entries compose block content (vars + language lines)", async () => {
  const entries = await resolveDesiredEntries({ source: source(), languages: ["terraform"], vars: { codeowner: "o/team" }, exclude: [] });
  const gi = entries.find((e) => e.path === ".gitignore")!;
  if (gi.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(gi.blockContent).toBe("# base\n.DS_Store\n# tf\n*.tfstate");
  const co = entries.find((e) => e.path === ".github/CODEOWNERS")!;
  if (co.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(co.blockContent).toBe("* @o/team");
});

test("language files are included; unknown language throws; collision throws; exclude removes", async () => {
  const withTs = await resolveDesiredEntries({ source: source(), languages: ["typescript"], vars: {}, exclude: [] });
  expect(withTs.find((e) => e.path === ".editorconfig")?.strategy).toBe("replace");

  await expect(resolveDesiredEntries({ source: source(), languages: ["typoscript"], vars: {}, exclude: [] }))
    .rejects.toThrow(/unknown language/i);

  const collide = memorySource({
    files: { "languages/a/files/x.txt": "a", "languages/b/files/x.txt": "b" },
    fragments: {},
    languages: ["a", "b"],
  });
  await expect(resolveDesiredEntries({ source: collide, languages: ["a", "b"], vars: {}, exclude: [] }))
    .rejects.toThrow(/collision/i);

  const excluded = await resolveDesiredEntries({ source: source(), languages: [], vars: { codeowner: "x" }, exclude: [".github/CODEOWNERS"] });
  expect(excluded.find((e) => e.path === ".github/CODEOWNERS")).toBeUndefined();
});
```

- [ ] **Step 2: 失敗確認**

Run: `pnpm --filter @repository-fanout/core test templates/resolve`
Expected: FAIL

- [ ] **Step 3: 実装（resolve.ts 全面書き換え）**

```ts
import { renderGitignore, substituteVars } from "./render.js";
import type { DesiredEntry, FragmentManifest, TemplateSource } from "./types.js";

export interface ResolveArgs {
  source: TemplateSource;
  languages: string[];
  vars: Record<string, string>;
  exclude: string[];
}

/** パス → 特殊戦略。未登録の base/languages files は replace、seeds は create-only */
const STRATEGY_REGISTRY: Record<string, "extends-field" | "managed-block"> = {
  "renovate.json": "extends-field",
  ".gitignore": "managed-block",
  ".github/CODEOWNERS": "managed-block",
};

function destPath(fullPath: string): string {
  return fullPath
    .replace(/^base\/files\//, "")
    .replace(/^languages\/[^/]+\/files\//, "")
    .replace(/^seeds\//, "");
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}

export async function resolveDesiredEntries(args: ResolveArgs): Promise<DesiredEntry[]> {
  const { source } = args;

  // 1. 未知 language はエラー
  for (const lang of args.languages) {
    if (!(await source.languageExists(lang))) throw new Error(`unknown language: ${lang}`);
  }

  // 2. fragment 収集：宣言分（base→宣言順）と全 language（universe 用）
  const baseFragment = (await source.readFragmentManifest("base")) ?? {};
  const declared: FragmentManifest[] = [baseFragment];
  for (const lang of args.languages) {
    declared.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }
  const allLangs = await source.listLanguages();
  const all: FragmentManifest[] = [baseFragment];
  for (const lang of allLangs) {
    all.push((await source.readFragmentManifest(`languages/${lang}`)) ?? {});
  }

  const managedExtends = dedupePreserveOrder(declared.flatMap((f) => f.renovate ?? []));
  const universe = dedupePreserveOrder(all.flatMap((f) => f.renovate ?? []));
  const gitignoreBlock = renderGitignore(declared.map((f) => f.gitignore ?? []));

  // 3. ファイル収集（衝突検出）
  const groups: Array<{ prefix: string; seeds: boolean }> = [
    { prefix: "base/files/", seeds: false },
    { prefix: "seeds/", seeds: true },
    ...args.languages.map((l) => ({ prefix: `languages/${l}/files/`, seeds: false })),
  ];

  const byDest = new Map<string, DesiredEntry>();
  const owner = new Map<string, string>();

  for (const { prefix, seeds } of groups) {
    for (const full of await source.listFiles(prefix)) {
      const dest = destPath(full);
      if (byDest.has(dest)) {
        throw new Error(`path collision: ${dest} provided by ${owner.get(dest)} and ${prefix}`);
      }
      const raw = await source.readFile(full);
      if (raw === null) continue;

      let entry: DesiredEntry;
      const special = seeds ? undefined : STRATEGY_REGISTRY[dest];
      if (special === "extends-field") {
        const createContent = substituteVars(
          raw.replace("{{renovate_extends}}", managedExtends.map((e) => JSON.stringify(e)).join(", ")),
          args.vars,
        );
        entry = { strategy: "extends-field", path: dest, managedExtends, universe, createContent };
      } else if (special === "managed-block") {
        const rendered = substituteVars(raw.replace("{{gitignore}}", gitignoreBlock), args.vars);
        entry = { strategy: "managed-block", path: dest, blockContent: rendered.replace(/\n$/, "") };
      } else {
        const content = substituteVars(raw, args.vars);
        entry = seeds
          ? { strategy: "create-only", path: dest, content }
          : { strategy: "replace", path: dest, content };
      }
      byDest.set(dest, entry);
      owner.set(dest, prefix);
    }
  }

  for (const ex of args.exclude) byDest.delete(ex);
  return [...byDest.values()];
}
```

`render.ts` の `renderRenovateExtends` は resolve から使わなくなるが、export は維持（createContent 組み立てを直書きしたため。もし未参照になるなら削除し index.ts も更新——実装時に判断し、**dead export を残さない**こと）。

- [ ] **Step 4: 通過確認 → Commit（Task 2 の型変更も含む）**

```bash
git add packages/core/src/templates packages/core/test/templates
git commit -m "feat(core)!: resolve desired entries with languages + strategy registry"
```

---

## Task 6: core — computeChanges を戦略対応へ（TDD）

**Files:**
- Modify: `packages/core/src/reconcile/diff.ts`
- Test: `packages/core/test/reconcile/diff.test.ts`（全面書き換え）

- [ ] **Step 1: 失敗するテスト**

```ts
import { expect, test } from "vitest";
import { computeChanges } from "../../src/reconcile/diff.js";
import { BLOCK_START, BLOCK_END } from "../../src/reconcile/block.js";
import { RenovateParseError } from "../../src/reconcile/extendsField.js";
import type { DesiredEntry } from "../../src/templates/types.js";

const managed = ["github>o/rc", "github>o/rc:ts"];
const universe = ["github>o/rc", "github>o/rc:ts", "github>o/rc:java"];

const entries: DesiredEntry[] = [
  { strategy: "replace", path: ".github/release.yml", content: "changelog: {}\n" },
  { strategy: "create-only", path: "STARTER.md", content: "starter\n" },
  { strategy: "managed-block", path: ".gitignore", blockContent: "a\nb" },
  { strategy: "extends-field", path: "renovate.json", managedExtends: managed, universe, createContent: "CREATE\n" },
];

test("replace: differs -> change; same -> noop", () => {
  expect(computeChanges([entries[0]!], { ".github/release.yml": "old\n" })).toHaveLength(1);
  expect(computeChanges([entries[0]!], { ".github/release.yml": "changelog: {}\n" })).toHaveLength(0);
});

test("create-only: absent -> create; present (even edited) -> noop", () => {
  expect(computeChanges([entries[1]!], {})).toHaveLength(1);
  expect(computeChanges([entries[1]!], { "STARTER.md": "edited\n" })).toHaveLength(0);
});

test("managed-block: creates block-only file when absent", () => {
  const [c] = computeChanges([entries[2]!], {});
  expect(c!.content).toBe(`${BLOCK_START}\na\nb\n${BLOCK_END}\n`);
});

test("managed-block: updates only block, repo lines preserved; noop when identical", () => {
  const actual = `${BLOCK_START}\nold\n${BLOCK_END}\nrepo-own\n`;
  const [c] = computeChanges([entries[2]!], { ".gitignore": actual });
  expect(c!.content).toBe(`${BLOCK_START}\na\nb\n${BLOCK_END}\nrepo-own\n`);
  expect(computeChanges([entries[2]!], { ".gitignore": c!.content })).toHaveLength(0);
});

test("extends-field: absent -> createContent; managed updated + repo-own preserved; noop when equal", () => {
  expect(computeChanges([entries[3]!], {})[0]!.content).toBe("CREATE\n");

  const actual = JSON.stringify({ extends: ["github>o/rc", "github>o/rc:java", ":pre"], automerge: false }, null, 2);
  const [c] = computeChanges([entries[3]!], { "renovate.json": actual });
  const parsed = JSON.parse(c!.content);
  expect(parsed.extends).toEqual(["github>o/rc", "github>o/rc:ts", ":pre"]);
  expect(parsed.automerge).toBe(false);

  expect(computeChanges([entries[3]!], { "renovate.json": c!.content })).toHaveLength(0);
});

test("extends-field: invalid json propagates RenovateParseError", () => {
  expect(() => computeChanges([entries[3]!], { "renovate.json": "{ json5: true, }" }))
    .toThrow(RenovateParseError);
});
```

- [ ] **Step 2: 失敗確認**

Run: `pnpm --filter @repository-fanout/core test reconcile/diff`
Expected: FAIL

- [ ] **Step 3: 実装（diff.ts 書き換え）**

```ts
import { applyManagedBlock } from "./block.js";
import { applyExtendsField } from "./extendsField.js";
import type { DesiredEntry } from "../templates/types.js";

export interface FileChange {
  path: string;
  content: string;
}

/**
 * desired（戦略付き）と実ファイル内容を突き合わせ、書き込むべき変更を返す。
 * リポ独自部分（ブロック外・extends 外キー・universe 外エントリ）は不可侵。
 * renovate.json がパース不能な場合は RenovateParseError を投げる（呼び出し側で failed 記録）。
 */
export function computeChanges(
  desired: DesiredEntry[],
  actual: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const d of desired) {
    const current = actual[d.path];
    switch (d.strategy) {
      case "replace":
        if (current !== d.content) changes.push({ path: d.path, content: d.content });
        break;
      case "create-only":
        if (current === undefined) changes.push({ path: d.path, content: d.content });
        break;
      case "managed-block": {
        const next = applyManagedBlock(current, d.blockContent);
        if (next !== current) changes.push({ path: d.path, content: next });
        break;
      }
      case "extends-field": {
        if (current === undefined) {
          changes.push({ path: d.path, content: d.createContent });
          break;
        }
        const next = applyExtendsField(current, d.managedExtends, d.universe);
        if (next !== null) changes.push({ path: d.path, content: next });
        break;
      }
    }
  }
  return changes;
}
```

- [ ] **Step 4: 通過確認 → Commit**

```bash
git add packages/core/src/reconcile/diff.ts packages/core/test/reconcile/diff.test.ts
git commit -m "feat(core)!: strategy-aware computeChanges (block/extends merge)"
```

---

## Task 7: core — index.ts 更新 & 全テスト

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: exports 更新**

```ts
export { createAppJwt } from "./auth/jwt.js";
export { listInstallations, createInstallationToken } from "./auth/installation.js";
export type { Installation } from "./auth/installation.js";
export { GitHubClient } from "./github/client.js";
export { GitHubError, classifyStatus, parseRetryAfter, parseRateLimitRemaining } from "./github/errors.js";
export type { StatusClass, ClassifyOptions } from "./github/errors.js";
export { parseManifest, isNewerRevision } from "./manifest/parse.js";
export type { Manifest, RepoEntry } from "./manifest/types.js";
export { resolveDesiredEntries } from "./templates/resolve.js";
export { renderGitignore, substituteVars } from "./templates/render.js";
export type { TemplateSource, FragmentManifest, DesiredEntry } from "./templates/types.js";
export { computeChanges } from "./reconcile/diff.js";
export type { FileChange } from "./reconcile/diff.js";
export { applyManagedBlock, BLOCK_START, BLOCK_END } from "./reconcile/block.js";
export { mergeExtends, applyExtendsField, RenovateParseError } from "./reconcile/extendsField.js";
export { decideBranchAction } from "./reconcile/branch.js";
export type { BranchAction, BranchInput, PrState } from "./reconcile/branch.js";
```
（`renderRenovateExtends` が未参照になった場合は render.ts から削除し export しない）

- [ ] **Step 2: core 全テスト & typecheck**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: 全 PASS / 型エラーなし

- [ ] **Step 3: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): public api for strategy model"
```

---

## Task 8: worker — TemplateSource 実装を新 IF へ（TDD）

**Files:**
- Modify: `apps/worker/src/github/templateSource.ts`
- Test: `apps/worker/test/github/templateSource.test.ts`

- [ ] **Step 1: テストを新 IF へ書き換え（失敗させる）**

既存テストの `readProfileManifest` / `profileExists` を置き換え：

```ts
test("readFragmentManifest parses fragment.json content", async () => {
  const content = btoa('{"renovate":["github>o/renovate-config:terraform"]}');
  const client = clientReturning({
    "/contents/languages/terraform/fragment.json": { content, encoding: "base64" },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  const fm = await src.readFragmentManifest("languages/terraform");
  expect(fm?.renovate).toEqual(["github>o/renovate-config:terraform"]);
});

test("listLanguages returns unique language dir names from tree", async () => {
  const client = clientReturning({
    "/git/trees/HEAD?recursive=1": { tree: [
      { path: "languages/terraform/fragment.json", type: "blob" },
      { path: "languages/typescript/fragment.json", type: "blob" },
      { path: "languages/typescript/files/.editorconfig", type: "blob" },
      { path: "base/fragment.json", type: "blob" },
    ] },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  expect((await src.listLanguages()).sort()).toEqual(["terraform", "typescript"]);
  expect(await src.languageExists("terraform")).toBe(true);
  expect(await src.languageExists("nope")).toBe(false);
});
```
（listFiles / UTF-8 decode テストは既存のまま維持）

- [ ] **Step 2: 失敗確認 → Step 3: 実装**

`templateSource.ts` のメソッド差し替え：

```ts
  async readFragmentManifest(dir: string): Promise<FragmentManifest | null> {
    const raw = await this.readFile(`${dir}/fragment.json`);
    return raw ? (JSON.parse(raw) as FragmentManifest) : null;
  }

  async listLanguages(): Promise<string[]> {
    const langs = new Set<string>();
    for (const p of await this.tree()) {
      const m = /^languages\/([^/]+)\//.exec(p);
      if (m) langs.add(m[1]!);
    }
    return [...langs];
  }

  async languageExists(lang: string): Promise<boolean> {
    return (await this.tree()).some((p) => p.startsWith(`languages/${lang}/`));
  }
```
（import を `FragmentManifest` に変更）

- [ ] **Step 4: 通過確認 → Commit**

```bash
git add apps/worker/src/github/templateSource.ts apps/worker/test/github/templateSource.test.ts
git commit -m "feat(worker): template source for languages/fragment.json"
```

---

## Task 9: worker — child/parent/sync を languages + 新 API へ

**Files:**
- Modify: `apps/worker/src/workflows/child.ts`, `apps/worker/src/workflows/parent.ts`
- Modify: `apps/worker/test/sync.test.ts`（fixture の `profiles` → `languages`）

- [ ] **Step 1: sync.test の manifest fixture を languages に（失敗確認）**

```ts
const manifest = {
  account: "bright-room", revision: 1, sourceCommit: "c",
  repositories: { r1: { languages: [], vars: {}, exclude: [] } },
};
```

Run: `pnpm --filter @repository-fanout/worker test sync`
Expected: PASS（core の parse が languages を受けるため。旧 profiles だと 422 になることも確認して良い）

- [ ] **Step 2: child.ts 更新**

- `ChildParams.profiles: string[]` → `languages: string[]`
- `resolveDesiredFiles` → `resolveDesiredEntries`（`{ source, languages: p.languages, vars, exclude }`）
- `computeChanges(desired, actual)` はそのまま（新シグネチャ互換）。ただし desired の path 列挙は `desired.map((d) => d.path)` のまま動く
- **RenovateParseError はリトライ無意味な恒久エラー**：`computeChanges` 呼び出しを try/catch し、`RenovateParseError` なら `recordRepoResult(..., { status: "failed", error: e.message })` して **rethrow せず return**（Workflows リトライを起こさない）。他のエラーは従来どおり記録して rethrow

```ts
import { resolveDesiredEntries, computeChanges, RenovateParseError, /* 既存 imports */ } from "@repository-fanout/core";
// ...
const desired = await step.do("resolve desired", async () =>
  resolveDesiredEntries({ source: templates, languages: p.languages, vars: p.vars, exclude: p.exclude }),
);
const base = await step.do("default branch", () => retry(() => io.getDefaultBranch()));
const actual = await step.do("read actual", () => retry(() => io.readActualFiles(desired.map((d) => d.path), base.branch)));

let changes;
try {
  changes = computeChanges(desired, actual);
} catch (err) {
  if (err instanceof RenovateParseError) {
    await recordRepoResult(this.env.RUNS, p.runId, { account: p.account, repo: p.repo, status: "failed", error: err.message });
    return; // 恒久エラー：リトライしない（exclude で自前管理に逃がす運用）
  }
  throw err;
}
```

- [ ] **Step 3: parent.ts 更新**

```ts
            params: {
              runId, account: manifest.account, installationId: inst.id,
              repo: `${manifest.account}/${name}`,
              languages: entry.languages, vars: entry.vars, exclude: entry.exclude,
            },
```

- [ ] **Step 4: worker 全テスト & typecheck → Commit**

Run: `pnpm --filter @repository-fanout/worker test && pnpm --filter @repository-fanout/worker typecheck && (cd apps/worker && npx wrangler deploy --dry-run)`
Expected: 全 PASS / dry-run ビルド成功

```bash
git add apps/worker/src apps/worker/test
git commit -m "feat(worker)!: reconcile with languages + strategy-aware merge"
```

---

## Task 10: cli — planRepo / flags を新 API へ

**Files:**
- Modify: `apps/cli/src/planRepo.ts`, `apps/cli/src/github.ts`, `apps/cli/src/index.ts`
- Test: `apps/cli/test/planRepo.test.ts`, `apps/cli/test/github.test.ts`

- [ ] **Step 1: テスト書き換え（失敗させる）**

`planRepo.test.ts`：メモリ source を新 IF（fragments/languages/listLanguages）へ、`profiles` 引数 → `languages`。managed-block の挙動が通ることも1本足す：

```ts
test("planRepo merges managed block with existing repo content", async () => {
  const src: TemplateSource = {
    async readFile(p) { return p === "base/files/.gitignore" ? "{{gitignore}}\n" : null; },
    async listFiles(prefix) { return prefix === "base/files/" ? ["base/files/.gitignore"] : []; },
    async readFragmentManifest(dir) { return dir === "base" ? { gitignore: ["a"] } : null; },
    async listLanguages() { return []; },
    async languageExists() { return true; },
  };
  const plan = await planRepo({
    source: src, languages: [], vars: {}, exclude: [],
    readActual: async () => ({ ".gitignore": "repo-own\n" }),
  });
  expect(plan.changes[0]!.content).toContain("repo-own");
  expect(plan.changes[0]!.content).toContain("# >>> repository-fanout managed >>>");
});
```

`github.test.ts`：`readProfileManifest` → `readFragmentManifest`（パス `languages/terraform/fragment.json`）。

- [ ] **Step 2: 失敗確認 → Step 3: 実装**

- `planRepo.ts`: `profiles` → `languages`、`resolveDesiredEntries` 使用（`computeChanges(desired, actual)` は同形）。
- `github.ts`: `templateSource()` に `readFragmentManifest` / `listLanguages` / `languageExists` を実装（worker Task 8 と同じロジックの closure 版）。
- `index.ts`: `--profiles` → `--languages`（usage 文字列も更新）。

- [ ] **Step 4: 全テスト・typecheck・起動確認 → Commit**

Run: `pnpm -r test && pnpm -r typecheck && env -u GITHUB_TOKEN pnpm --filter @repository-fanout/cli start; echo "exit=$?"`
Expected: 全 PASS / usage 表示で exit=2

```bash
git add apps/cli
git commit -m "feat(cli)!: dry-run with languages + strategy-aware merge"
```

---

## Self-Review（プラン作成者チェック）

- **Spec カバレッジ**：§3 languages 軸・fragment.json・未知 language・衝突・exclude（Task 1,5）／戦略レジストリ＋managed-block 意味論（Task 3,5,6）／extends-field 意味論（universe・リポ独自温存・no-op・パース不能→failed・新規作成 $schema）（Task 4,5,6,9）／§4 子 Workflow の戦略別マージ（Task 9）。
- **不可侵原則**：block 外温存 = Task 3 テスト、extends 外キー・universe 外エントリ温存 = Task 4/6 テストで検証。
- **型整合**：`DesiredEntry`（Task 2）→ resolve（Task 5）→ computeChanges（Task 6）→ worker/cli（Task 9/10）。`RenovateParseError` は core から export（Task 7）し worker が捕捉（Task 9）。
- **削除**：旧 `ProfileManifest`/`DesiredFile`/`resolveDesiredFiles` は完全撤去（後方互換レイヤなし。未デプロイのため）。`renderRenovateExtends` が dead になれば削除。
