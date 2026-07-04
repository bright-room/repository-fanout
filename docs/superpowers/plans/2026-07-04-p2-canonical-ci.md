# P2: canonical-files CI 実装計画(検証+必須チェック+global kick 送信)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正本リポ canonical-files に「壊れた正本を merge できない」検証 CI(必須ステータスチェック)と「main push で全リポ配布を発火する」kick ワークフローを新設する(spec v2 §6.5 / D11)。

**Architecture:** 検証の実体は repository-fanout の CLI に新設する `validate` コマンド(ローカルディレクトリを TemplateSource として core の描画を実際に実行)。canonical-files 側の CI は「repository-fanout(public)を checkout して validate を叩く」だけの薄い YAML。kick は OIDC トークン付き POST(シークレット不要)。

**Tech Stack:** TypeScript(apps/cli)+ GitHub Actions YAML + Terraform 1 行(organization-structure)

**前提事実(2026-07-04 確認済み):**
- repository-fanout は **PUBLIC**(gh repo view で確認)→ CI から無認証で checkout 可能
- canonical-files の必須チェックは organization-structure の `terraform/repository_canonical-files.tf:10`(`required_status_checks = []`)で管理
- worker の `OIDC_AUDIENCE` = `https://repository-fanout.bright-room.workers.dev`(P1 の wrangler.toml)

**リポ間の順序制約(重要):**
1. Task 4(repository-fanout PR)が **merge されてから** Task 5(canonical-files の validate.yml)へ — CI は repository-fanout の main を checkout するため
2. Task 6(fanout-sync.yml)は **PR 作成のみで merge しない**。新 worker(OIDC)のデプロイ前に merge すると main push のたびに 401 で赤くなる。merge は P4 の切替ウィンドウで行う
3. Task 7(必須チェック化)は Task 5 merge 後(チェックが実在してから)

---

## Task 0: 事前確認

- [ ] worktree `~/.config/superpowers/worktrees/repository-fanout/feat-p2-validate`(ブランチ `feat/p2-validate`、ベース main=a17f364)が存在し、ベースライン green(core 114 / cli 9 / worker 62)であること(オーケストレーターが作成済み)

---

## Task 1: cli — ローカルディレクトリの TemplateSource

**Files:**
- Create: `apps/cli/src/localSource.ts`
- Create: `apps/cli/test/localSource.test.ts`
- Create: `apps/cli/test/fixtures/canonical-mini/` 配下(テスト用の最小正本)

- [ ] **Step 1: フィクスチャを作る**

```
apps/cli/test/fixtures/canonical-mini/
  strategies.json                 → {"renovate.json":"extends-field",".gitignore":"managed-block",".github/CODEOWNERS":"managed-block"}
  base/fragment.json              → {"renovate":["github>bright-room/renovate-config"],"gitignore":[{"section_comment":"OS","ignores":[".DS_Store"]}]}
  base/files/renovate.json        → {"$schema":"https://docs.renovatebot.com/renovate-schema.json","extends":[{{renovate_extends}}]}
  base/files/.gitignore           → {{gitignore}}
  base/files/.github/CODEOWNERS   → * @{{codeowner}}
  base/files/.github/release.yml  → changelog: {}
  languages/typescript/fragment.json → {"renovate":["github>bright-room/renovate-config:typescript"],"gitignore":[{"ignores":["node_modules/"]}]}
  bundles/oss/fragment.json       → {"_comment":"files only"}
  bundles/oss/files/SECURITY.md   → # Security
```

(各ファイルの中身は上記の通りに正確に。`{{...}}` はテンプレプレースホルダのため生テキストとして書く)

- [ ] **Step 2: 失敗するテストを書く**

```ts
// apps/cli/test/localSource.test.ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";

const root = fileURLToPath(new URL("./fixtures/canonical-mini", import.meta.url));
const src = localSource(root);

describe("localSource", () => {
  it("readFile returns content / null for missing", async () => {
    expect(await src.readFile("strategies.json")).toContain("extends-field");
    expect(await src.readFile("nope.json")).toBeNull();
  });
  it("listFiles walks recursively with full paths", async () => {
    const files = await src.listFiles("base/files/");
    expect(files).toContain("base/files/.github/CODEOWNERS");
    expect(files).toContain("base/files/renovate.json");
  });
  it("listNames / nameExists reflect directories", async () => {
    expect(await src.listNames("languages")).toEqual(["typescript"]);
    expect(await src.listNames("bundles")).toEqual(["oss"]);
    expect(await src.nameExists("languages", "typescript")).toBe(true);
    expect(await src.nameExists("languages", "go")).toBe(false);
  });
  it("readFragmentManifest parses fragment.json / null for missing", async () => {
    const f = await src.readFragmentManifest("languages/typescript");
    expect(f?.renovate).toEqual(["github>bright-room/renovate-config:typescript"]);
    expect(await src.readFragmentManifest("languages/nope")).toBeNull();
  });
  it("readFragmentManifest throws on invalid JSON (検証用途のため握りつぶさない)", async () => {
    // fixtures/broken-fragment/languages/bad/fragment.json = "{ not json"
    const brokenRoot = fileURLToPath(new URL("./fixtures/broken-fragment", import.meta.url));
    await expect(localSource(brokenRoot).readFragmentManifest("languages/bad")).rejects.toThrow();
  });
});
```

`apps/cli/test/fixtures/broken-fragment/languages/bad/fragment.json` に `{ not json` を置く。

- [ ] **Step 3: 失敗を確認**

Run: `cd apps/cli && npx vitest run test/localSource.test.ts`
Expected: FAIL(module not found)

- [ ] **Step 4: 実装**

```ts
// apps/cli/src/localSource.ts
import { readdir, readFile as fsReadFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FragmentAxis, FragmentManifest, TemplateSource } from "@repository-fanout/core";

/**
 * ローカルディレクトリ(canonical-files の checkout)を TemplateSource として扱う。
 * validate コマンド(CI での正本検証)用。GitHubTemplateSource と異なり
 * fragment.json の JSON 破損は null に握りつぶさず throw する(検証で検出するため)。
 */
export function localSource(root: string): TemplateSource {
  const read = async (p: string): Promise<string | null> => {
    try {
      return await fsReadFile(join(root, p), "utf8");
    } catch {
      return null;
    }
  };
  const walk = async (dir: string): Promise<string[]> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const rel = `${dir}${e.name}`;
      if (e.isDirectory()) out.push(...(await walk(`${rel}/`)));
      else out.push(rel);
    }
    return out.sort();
  };
  return {
    readFile: read,
    listFiles: (prefix) => walk(prefix),
    readFragmentManifest: async (dir): Promise<FragmentManifest | null> => {
      const raw = await read(`${dir}/fragment.json`);
      return raw === null ? null : (JSON.parse(raw) as FragmentManifest);
    },
    listNames: async (axis: FragmentAxis) => {
      try {
        const entries = await readdir(join(root, axis), { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    nameExists: async (axis, name) => {
      try {
        return (await stat(join(root, axis, name))).isDirectory();
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 5: パス確認・コミット**

Run: `cd apps/cli && npx vitest run test/localSource.test.ts`(5 pass)

```bash
git add apps/cli/src/localSource.ts apps/cli/test/localSource.test.ts apps/cli/test/fixtures/
git commit -m "feat(cli): local directory TemplateSource for canonical validation"
```

---

## Task 2: cli — validateSource(検証ロジック)

**Files:**
- Create: `apps/cli/src/validateDir.ts`
- Create: `apps/cli/test/validateDir.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// apps/cli/test/validateDir.test.ts
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";
import { validateSource } from "../src/validateDir.js";

const fixture = (name: string) =>
  localSource(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

describe("validateSource", () => {
  it("valid canonical tree → no errors", async () => {
    expect(await validateSource(fixture("canonical-mini"))).toEqual([]);
  });

  it("detects unknown fragment keys (typo guard)", async () => {
    // fixtures/typo-fragment: canonical-mini のコピー + languages/typescript/fragment.json の
    // キーを "renovte"(typo)にしたもの
    const errors = await validateSource(fixture("typo-fragment"));
    expect(errors.some((e) => e.includes('unknown key "renovte"'))).toBe(true);
  });

  it("reports render failure with combo label", async () => {
    // fixtures/broken-strategies: canonical-mini のコピー + strategies.json の値を
    // "extends-fieldd"(未知戦略)にしたもの → parseStrategyConfig が throw
    const errors = await validateSource(fixture("broken-strategies"));
    expect(errors.some((e) => e.startsWith("render failed [base-only]"))).toBe(true);
  });

  it("reports broken fragment JSON as an error (not a crash)", async () => {
    const errors = await validateSource(fixture("broken-fragment"));
    expect(errors.some((e) => e.includes("languages/bad/fragment.json"))).toBe(true);
  });
});
```

フィクスチャ追加: `typo-fragment/`・`broken-strategies/` は canonical-mini を丸コピーして該当 1 箇所だけ変える。`broken-fragment/` は Task 1 のものに `strategies.json`(canonical-mini と同内容)と `base/fragment.json`(`{}`)を足して validate が走る形に整える。

- [ ] **Step 2: 失敗を確認**

Run: `cd apps/cli && npx vitest run test/validateDir.test.ts`
Expected: FAIL(module not found)

- [ ] **Step 3: 実装**

```ts
// apps/cli/src/validateDir.ts
import { resolveDesiredEntries, type TemplateSource } from "@repository-fanout/core";

// fragment.json で許可されるキー。未知キーは silent-ignore されるため(タイポ非検出が
// 既知の制限だった)、validate で明示的に検出する。
const FRAGMENT_KEYS = new Set(["renovate", "gitignore", "_comment"]);

/**
 * 正本ツリーの検証(spec v2 §6.5)。
 * (1) 全 fragment.json の JSON 妥当性と未知キー検出
 * (2) 描画スモークテスト: base のみ / 各 language 単独 / 各 bundle 単独 / 全部盛り
 * 戻り値はエラーメッセージの配列(空 = 合格)。
 */
export async function validateSource(source: TemplateSource): Promise<string[]> {
  const errors: string[] = [];
  const languages = await source.listNames("languages");
  const bundles = await source.listNames("bundles");

  const fragmentDirs = [
    "base",
    ...languages.map((l) => `languages/${l}`),
    ...bundles.map((b) => `bundles/${b}`),
  ];
  for (const dir of fragmentDirs) {
    let fragment: unknown;
    try {
      fragment = await source.readFragmentManifest(dir);
    } catch (e) {
      errors.push(`${dir}/fragment.json: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (fragment === null || fragment === undefined) continue;
    for (const key of Object.keys(fragment as Record<string, unknown>)) {
      if (!FRAGMENT_KEYS.has(key)) errors.push(`${dir}/fragment.json: unknown key "${key}" (typo?)`);
    }
  }

  const combos: Array<{ label: string; languages: string[]; bundles: string[] }> = [
    { label: "base-only", languages: [], bundles: [] },
    ...languages.map((l) => ({ label: `language:${l}`, languages: [l], bundles: [] as string[] })),
    ...bundles.map((b) => ({ label: `bundle:${b}`, languages: [] as string[], bundles: [b] })),
    { label: "all", languages, bundles },
  ];
  for (const c of combos) {
    try {
      await resolveDesiredEntries({
        source,
        languages: c.languages,
        bundles: c.bundles,
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

- [ ] **Step 4: パス確認・コミット**

Run: `cd apps/cli && npx vitest run test/validateDir.test.ts`(4 pass)

```bash
git add apps/cli/src/validateDir.ts apps/cli/test/validateDir.test.ts apps/cli/test/fixtures/
git commit -m "feat(cli): validateSource (fragment typo guard + render smoke over all combos)"
```

---

## Task 3: cli — validate コマンドの配線

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: index.ts に validate コマンドを追加**

`main()` の冒頭のコマンド分岐を変更。validate は `--repo`/`GITHUB_TOKEN` 不要:

```ts
  const cmd = process.argv[2];
  if (cmd === "validate") {
    const dir = arg("dir");
    if (!dir) {
      console.error("usage: fanout validate --dir <canonical-files checkout path>");
      process.exit(2);
    }
    const { localSource } = await import("./localSource.js");
    const { validateSource } = await import("./validateDir.js");
    const errors = await validateSource(localSource(dir));
    if (errors.length > 0) {
      console.error(`validation failed (${errors.length} error(s)):`);
      for (const e of errors) console.error(`  ✗ ${e}`);
      process.exit(1);
    }
    console.log("validation OK");
    return;
  }
```

(既存の dry-run/apply 分岐・usage 文言は `<dry-run|apply|validate>` に更新。dry-run/apply の `GITHUB_TOKEN` 必須チェックはそのまま)

- [ ] **Step 2: package.json に script 追加**

```json
"validate": "tsx src/index.ts validate"
```

- [ ] **Step 3: 手動スモーク+3点セット**

Run: `cd apps/cli && npx tsx src/index.ts validate --dir test/fixtures/canonical-mini`
Expected: `validation OK` / exit 0

Run: `npx tsx src/index.ts validate --dir test/fixtures/broken-strategies; echo "exit=$?"`
Expected: エラー一覧表示・`exit=1`

Run: `pnpm -r test && pnpm -r typecheck && pnpm lint`
Expected: 全 green(lint はルート・エラー0)

- [ ] **Step 4: 実際の canonical-files で検証(重要)**

Run: `cd apps/cli && npx tsx src/index.ts validate --dir /Users/nonaka.koki/dev/ghq/github.com/bright-room/canonical-files`
Expected: `validation OK`(現行の本番正本が合格すること。**失敗した場合は正本のバグ発見なので、修正せず BLOCKED で報告**)

- [ ] **Step 5: コミット**

```bash
git add apps/cli/
git commit -m "feat(cli): validate command for canonical-files CI"
```

---

## Task 4: repository-fanout の PR 作成(ゲート: ユーザー merge)

- [ ] **Step 1: push + PR**

```bash
git push -u origin feat/p2-validate
gh pr create --title "feat(cli): validate command for canonical-files CI (P2)" --body "$(cat <<'EOF'
spec: docs/superpowers/specs/2026-07-04-repository-fanout-v2-design.md §6.5(D11)
plan: docs/superpowers/plans/2026-07-04-p2-canonical-ci.md(本 PR に同梱)

canonical-files の検証 CI の実体となる `fanout validate --dir <path>` を追加。
- ローカル checkout を TemplateSource 化(localSource)
- fragment.json の未知キー検出(タイポの silent-ignore という既知の制限を解消)
- 描画スモークテスト(base のみ/各 language/各 bundle/全部盛り)
- 現行の本番 canonical-files が合格することを確認済み

merge 後、canonical-files 側に validate.yml(必須チェック)を配線します(このリポは public のため CI からトークンなしで checkout されます)。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: ユーザーにレビュー・merge を依頼**(merge されるまで Task 5 以降へ進まない)

---

## Task 5: canonical-files — validate.yml(検証 CI)

**Files(canonical-files リポ。ブランチ `feat/validate-ci`):**
- Create: `.github/workflows/validate.yml`

**注意**: bright-room org は Actions の SHA ピン留めが規約(organization-structure の既存ワークフローの `uses:` を確認し、同じアクションは同じ SHA を使う。新規アクションは最新リリースの SHA を `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` 等で解決)。

- [ ] **Step 1: ワークフロー作成**

```yaml
name: validate
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA> # v4 相当。canonical-files 自身
        with:
          path: canonical
      - uses: actions/checkout@<SHA> # repository-fanout(public・main)
        with:
          repository: bright-room/repository-fanout
          path: engine
      - uses: actions/setup-node@<SHA> # v4 相当
        with:
          node-version: 24
      - name: enable pnpm
        run: corepack enable
      - name: install engine deps
        working-directory: engine
        run: pnpm install --frozen-lockfile
      - name: validate canonical tree
        working-directory: engine
        run: pnpm --filter cli run validate -- --dir "${GITHUB_WORKSPACE}/canonical"
```

(`corepack enable` で pnpm が使えない場合は `npm i -g pnpm@10` に置き換え。engine の `packageManager` フィールド有無を確認して判断)

- [ ] **Step 2: ブランチ push + PR 作成 → CI が green になることを確認**

```bash
cd /Users/nonaka.koki/dev/ghq/github.com/bright-room/canonical-files
git switch -c feat/validate-ci && git add .github/workflows/validate.yml
git commit -m "ci: validate canonical tree on PR and main (fanout validate)"
git push -u origin feat/validate-ci
gh pr create --title "ci: validate canonical tree (required check の実体)" --body "$(cat <<'EOF'
repository-fanout の \`fanout validate\` を PR / main push で実行する検証 CI。
壊れた JSON・fragment.json のキータイポ・描画エラー(衝突・未知戦略値など)を merge 前に検出する。

- repository-fanout(public)を main で checkout して実行(シークレット不要)
- merge 後、organization-structure 側で required_status_checks に "validate" を追加予定(P2 Task 7)

spec: repository-fanout/docs/superpowers/specs/2026-07-04-repository-fanout-v2-design.md §6.5
EOF
)"
```

PR 上で `validate` ジョブが実際に走って green になること(=実体検証)を確認してからユーザーに merge 依頼。

---

## Task 6: canonical-files — fanout-sync.yml(⚠️ PR 作成のみ・merge は P4)

**Files(canonical-files リポ。ブランチ `feat/fanout-kick`):**
- Create: `.github/workflows/fanout-sync.yml`

- [ ] **Step 1: ワークフロー作成**

```yaml
name: fanout-sync
on:
  push:
    branches: [main]
  workflow_dispatch: # 手動の global 再実行(runbook 用)
permissions:
  id-token: write
  contents: read
jobs:
  kick:
    runs-on: ubuntu-latest
    steps:
      - name: global kick (OIDC)
        env:
          FANOUT_URL: https://repository-fanout.bright-room.workers.dev
        run: |
          set -eu
          TOKEN=$(curl -sS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${FANOUT_URL}" | jq -r .value)
          for i in 1 2 3; do
            code=$(curl -sS -o /tmp/resp -w '%{http_code}' -X POST "${FANOUT_URL}/sync" \
              -H "Authorization: Bearer ${TOKEN}" -d '{}')
            if [ "$code" = "202" ]; then cat /tmp/resp; exit 0; fi
            echo "attempt ${i}: HTTP ${code} $(cat /tmp/resp)"
            sleep $((i * 5))
          done
          echo "kick failed after 3 attempts" >&2
          exit 1
```

(audience は worker の `OIDC_AUDIENCE` と完全一致必須。202 以外はリトライし、3 回失敗で workflow を fail = kick 取りこぼし防止。spec §6.1/§6.5)

- [ ] **Step 2: PR 作成(本文に HOLD を明記)**

PR 本文に必ず記載: 「**⚠️ P4 の切替ウィンドウまで merge しないこと。** 新 worker(OIDC 対応)のデプロイ前に merge すると main push のたびにこのワークフローが 401 で fail する。」

---

## Task 7: organization-structure — 必須ステータスチェック化(Task 5 merge 後)

**Files(organization-structure リポ。ブランチ `feat/canonical-required-check`):**
- Modify: `terraform/repository_canonical-files.tf:10`

- [ ] **Step 1: 変更**

`required_status_checks = []` → `required_status_checks = ["validate"]`

事前に module の変数定義(`terraform/modules/repository/variables.tf`)で要素の型(単純な文字列 = チェック名か、object か)を確認し、形式を合わせる。チェック名は Task 5 のジョブ名 `validate`。

- [ ] **Step 2: PR 作成(plan の差分が「ruleset 更新のみ」であることを CI コメントで確認)→ ユーザーに merge 依頼**

---

## 完了条件(P2 の DoD)

1. canonical-files の PR で `validate` チェックが自動実行され、壊れた JSON・fragment タイポ・描画エラーを検出して merge をブロックできる(必須チェック化まで)
2. fanout-sync.yml の PR が「HOLD・P4 で merge」の明記付きで open になっている
3. 全変更が spec §6.5 と対応している(逸脱があれば記録)

---

## Task 1〜3 レビュー記録(2026-07-04)

- 実装: impl-i(Sonnet・1回で成功)。コミット 86247e1 / 8d59ddd / c6d7aa7
- 仕様一致レビュー(オーケストレーター): ✅ 計画通り。逸脱2件(Dirent 型注釈・biome 整形)は正当
- 実測検証: core 114 / cli 18 / worker 62 = 194 tests 全パス、typecheck 0、lint exit 0
- **本番正本の合格をオーケストレーターも再実行で確認**(validation OK / exit 0)。負例(未知戦略値)は 4 エラー検出・exit 1 を確認
