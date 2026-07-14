# セキュリティ配布 + template profile 分離 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** security-workflow.md レポートを汎用化した層1/層2セキュリティ対策を fanout で全管理リポへ配布し、PR/Issue テンプレートを opt-in の `template` profile へ分離する。

**Architecture:** 5リポにまたがる変更。(1) repository-fanout エンジンに「キー付き array merge」を追加 → (2) repo-policies 新設(conftest ポリシー一元管理) → (3) renovate-config に ignorePaths → (4) canonical-files に配布物を追加。ロールアウトは spec §6 の順序厳守(canonical-files の CI はエンジン main を checkout するため、エンジン merge が先)。

**Tech Stack:** TypeScript (vitest, biome) / Liquid テンプレート / OPA Rego (conftest) / Terraform / GitHub Actions

**Spec:** `docs/superpowers/specs/2026-07-14-security-fanout-design.md`

---

## 前提・作業場所

| リポ | ローカルパス | ブランチ |
|---|---|---|
| repository-fanout | `~/dev/ghq/github.com/bright-room/repository-fanout` | `feat/keyed-array-merge`(worktree 推奨: main 作業ツリーに未コミット変更あり) |
| organization-structure | `~/dev/ghq/github.com/bright-room/organization-structure` | `feat/repo-policies` |
| repo-policies | tf apply 後に clone | `main` 直 push(初期セットアップ後に protection) |
| renovate-config | `~/dev/ghq/github.com/bright-room/renovate-config` | `chore/ignore-fanout-workflows` |
| canonical-files | `~/dev/ghq/github.com/bright-room/canonical-files` | `feat/security-distribution` |

各リポとも作業前に `git fetch origin && git status` で状態確認。repository-fanout は main 作業ツリーが dirty(`apps/worker/src/kv/distStore.ts`)のため**必ず worktree を使う**:

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout
git worktree add .claude/worktrees/keyed-array-merge -b feat/keyed-array-merge origin/main
cd .claude/worktrees/keyed-array-merge && pnpm install
```

---

# Phase A: repository-fanout エンジン — キー付き array merge

## Task A1: catalog パーサに `key` フィールドを追加

**Files:**
- Modify: `packages/core/src/domain/model/reconcile/structuredDocument.ts`(`ManagedPathSpec` 型のみ)
- Modify: `packages/core/src/domain/model/canonical/catalogEntry.ts:69-81`(`parseManagedPaths`)
- Test: `packages/core/test/domain/model/canonical/catalog.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`catalog.test.ts` に追加(既存テストのスタイルに合わせ、`Catalog.parse` 経由で検証):

```ts
test("managed_paths: merge array は key を持てる。table との併用・非文字列は fail fast", () => {
  const ok = Catalog.parse(
    JSON.stringify({
      files: {
        ".pre-commit-config.yaml": {
          file_type: "yaml",
          mode: "managed",
          managed_paths: { repos: { merge: "array", key: "repo" } },
        },
      },
    }),
  );
  const entry = ok.entryFor(".pre-commit-config.yaml");
  if (!(entry instanceof ManagedStructuredFile)) throw new Error("unexpected entry type");
  expect(entry.managedPaths.repos).toEqual({ merge: "array", key: "repo" });

  expect(() =>
    Catalog.parse(
      JSON.stringify({
        files: {
          "x.yml": {
            file_type: "yaml",
            mode: "managed",
            managed_paths: { t: { merge: "table", key: "repo" } },
          },
        },
      }),
    ),
  ).toThrow(/key is only for merge "array"/);

  expect(() =>
    Catalog.parse(
      JSON.stringify({
        files: {
          "x.yml": {
            file_type: "yaml",
            mode: "managed",
            managed_paths: { r: { merge: "array", key: "" } },
          },
        },
      }),
    ),
  ).toThrow(/key must be a non-empty string/);
});
```

`ManagedStructuredFile` の import が無ければ追加: `import { ManagedStructuredFile } from "../../../../src/domain/model/canonical/catalogEntry.js";`(既存 import 行を確認して合わせる)

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/canonical/catalog.test.ts`
Expected: FAIL(key が素通りして throw されない)

※ core の test script 名は `packages/core/package.json` を見て合わせる(`pnpm --filter @repository-fanout/core test` で vitest が走るならそれで良い)

- [ ] **Step 3: 実装**

`structuredDocument.ts` の型:

```ts
export interface ManagedPathSpec {
  merge: MergeKind;
  /** merge "array" のオブジェクト配列用: エントリ同一性を判定するフィールド名(spec 2026-07-14 §4.2) */
  key?: string;
}
```

`catalogEntry.ts` の `parseManagedPaths` のループ内、既存の merge 検証の直後に追加:

```ts
    if (spec.key !== undefined) {
      if (spec.merge !== "array") {
        throw new Error(
          `catalog.json: ${path}: managed_paths.${key}: key is only for merge "array"`,
        );
      }
      if (typeof spec.key !== "string" || spec.key.length === 0) {
        throw new Error(
          `catalog.json: ${path}: managed_paths.${key}: key must be a non-empty string`,
        );
      }
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/canonical/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/model/reconcile/structuredDocument.ts packages/core/src/domain/model/canonical/catalogEntry.ts packages/core/test/domain/model/canonical/catalog.test.ts
git commit -m "feat(core): managed_paths の merge array に識別キー key を追加(パーサ)"
```

## Task A2: キー付きマージの実装(structuredDocument)

**Files:**
- Modify: `packages/core/src/domain/model/reconcile/structuredDocument.ts`
- Test: `packages/core/test/domain/model/reconcile/structuredDocument.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`structuredDocument.test.ts` に追加:

```ts
import { mergeManagedKeyedArray } from "../../../../src/domain/model/reconcile/structuredDocument.js"; // 既存 import に追記

const GITLEAKS = {
  repo: "https://github.com/gitleaks/gitleaks",
  rev: "v8.30.0",
  hooks: [{ id: "gitleaks" }],
};
const TEXTHOOKS = {
  repo: "https://github.com/sirosen/texthooks",
  rev: "0.7.1",
  hooks: [{ id: "forbid-bidi-controls" }],
};
const PRECOMMIT: ManagedPathsSpec = {
  managedPaths: { repos: { merge: "array", key: "repo" } },
  data: { repos: [GITLEAKS, TEXTHOOKS] },
  universe: {
    repos: [
      "https://github.com/gitleaks/gitleaks",
      "https://github.com/sirosen/texthooks",
      "https://github.com/retired/hook",
    ],
  },
};

test("keyed array: 管理エントリは正準順で収束(rev 更新)、universe 外・key 判定不能は温存、寄与が消えた universe キーは削除", () => {
  const actual = [
    { repo: "local", hooks: [{ id: "golangci-lint" }] }, // universe 外 → リポ独自として温存
    { repo: "https://github.com/gitleaks/gitleaks", rev: "v8.0.0", hooks: [{ id: "gitleaks" }] }, // 旧 rev → 管理側が勝つ
    { repo: "https://github.com/retired/hook", rev: "v1" }, // universe 内・寄与消滅 → 削除
    { note: "no key field" }, // key 判定不能 → 温存
  ];
  expect(mergeManagedKeyedArray(actual, PRECOMMIT.data.repos, PRECOMMIT.universe.repos, "repo")).toEqual([
    GITLEAKS,
    TEXTHOOKS,
    { repo: "local", hooks: [{ id: "golangci-lint" }] },
    { note: "no key field" },
  ]);
  // 管理側の key 重複は先勝ち
  expect(
    mergeManagedKeyedArray([], [GITLEAKS, { ...GITLEAKS, rev: "v0" }], PRECOMMIT.universe.repos, "repo"),
  ).toEqual([GITLEAKS]);
  // 管理エントリに key が無いのは fail fast
  expect(() =>
    mergeManagedKeyedArray([], [{ rev: "v1" }], PRECOMMIT.universe.repos, "repo"),
  ).toThrow(/without key "repo"/);
});

test("yaml keyed: .pre-commit-config.yaml の repos だけ収束し、リポ独自 local hook・コメントを温存", () => {
  const doc = StructuredDocument.parse(
    "yaml",
    ".pre-commit-config.yaml",
    `# repo のコメント
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.0.0
    hooks:
      - id: gitleaks
  - repo: local
    hooks:
      - id: my-check
        name: mine
        entry: ./check.sh
        language: system
`,
  );
  const next = doc.mergedContent(PRECOMMIT)!;
  expect(next).toContain("# repo のコメント");
  expect(next).toContain("rev: v8.30.0");
  expect(next).toContain("forbid-bidi-controls");
  expect(next).toContain("id: my-check");
});

test("yaml keyed: 意味的同一なら null(no-op)。createContent は管理データのみで正準生成", () => {
  const same = StructuredDocument.parse(
    "yaml",
    ".pre-commit-config.yaml",
    StructuredDocument.createContent("yaml", ".pre-commit-config.yaml", PRECOMMIT),
  );
  expect(same.mergedContent(PRECOMMIT)).toBeNull();
  const created = StructuredDocument.createContent("yaml", ".pre-commit-config.yaml", PRECOMMIT);
  expect(created).toContain("repo: https://github.com/gitleaks/gitleaks");
  expect(created).toContain("rev: v8.30.0");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/reconcile/structuredDocument.test.ts`
Expected: FAIL(`mergeManagedKeyedArray` が存在しない)

- [ ] **Step 3: 実装**

`structuredDocument.ts` に追加(`mergeManagedArray` の直後):

```ts
/** keyed array のエントリから識別キー値を取り出す。判定不能(非オブジェクト / key が文字列でない)は undefined */
function keyOf(entry: unknown, key: string): string | undefined {
  if (!isPlainObject(entry)) return undefined;
  const v = entry[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * merge: "array" + key(spec 2026-07-14 §4.2)。mergeManagedArray のオブジェクト配列への一般化:
 * 望ましい値 = 管理エントリ(正準順・key 重複は先勝ち) ++ key が universe 外 or 判定不能なリポ独自エントリ(相対順保持)。
 * 判定不能エントリを温存するのは「fanout が配ったと証明できないものは触らない」原則(spec v2 §5.4)と同じ倒し方。
 */
export function mergeManagedKeyedArray(
  actual: unknown,
  managed: unknown,
  universe: string[],
  key: string,
): unknown[] {
  const universeSet = new Set(universe);
  const seen = new Set<string>();
  const canonical: unknown[] = [];
  for (const e of Array.isArray(managed) ? managed : []) {
    const k = keyOf(e, key);
    if (k === undefined) {
      throw new Error(`managed array entry without key "${key}": ${JSON.stringify(e)}`);
    }
    if (seen.has(k)) continue;
    seen.add(k);
    canonical.push(e);
  }
  const repoOwn = (Array.isArray(actual) ? actual : []).filter((e) => {
    const k = keyOf(e, key);
    return k === undefined || !universeSet.has(k);
  });
  return [...canonical, ...repoOwn];
}
```

`mergedFor` と `normalizedCurrent` を差し替え:

```ts
function mergedFor(spec: ManagedPathsSpec, key: string, actualValue: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  const universe = spec.universe[key] ?? [];
  if (s.merge === "table") return mergeManagedTable(actualValue, spec.data[key], universe);
  if (s.key !== undefined) return mergeManagedKeyedArray(actualValue, spec.data[key], universe, s.key);
  return mergeManagedArray(actualValue, spec.data[key], universe);
}

/** no-op 判定用: 実ファイル側の現在値をマージ結果と同じ形へ正準化して比較 */
function normalizedCurrent(spec: ManagedPathsSpec, key: string, value: unknown): unknown {
  const s = spec.managedPaths[key];
  if (!s) throw new Error(`unreachable: no managed path spec for ${key}`);
  if (s.merge === "array") {
    if (s.key !== undefined) return Array.isArray(value) ? value : [];
    return normalizeToArray(value);
  }
  return isPlainObject(value) ? value : {};
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/reconcile/structuredDocument.test.ts`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/model/reconcile/structuredDocument.ts packages/core/test/domain/model/reconcile/structuredDocument.test.ts
git commit -m "feat(core): キー付き array merge(mergeManagedKeyedArray)を実装"
```

## Task A3: universe のキー値収集(profiles)+ derive 統合テスト

**Files:**
- Modify: `packages/core/src/domain/model/canonical/profiles.ts:59-80`(`universeFor`)
- Test: `packages/core/test/domain/model/desired/derive.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`derive.test.ts` に追加(既存の `memorySourceV3` を利用):

```ts
const PRECOMMIT_FILES: Record<string, string> = {
  "catalog.json": JSON.stringify({
    files: {
      ".pre-commit-config.yaml": {
        file_type: "yaml",
        mode: "managed",
        managed_paths: { repos: { merge: "array", key: "repo" } },
      },
    },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    ".pre-commit-config.yaml": {
      repos: [
        { repo: "https://github.com/gitleaks/gitleaks", rev: "v8.30.0", hooks: [{ id: "gitleaks" }] },
      ],
    },
  }),
  "profiles/go/contributes.json": JSON.stringify({
    ".pre-commit-config.yaml": {
      repos: [{ repo: "https://github.com/example/go-hook", rev: "v1.0.0", hooks: [{ id: "go-hook" }] }],
    },
  }),
};

test("keyed array: universe は全 profile の key 値、data は宣言 profile のみ、createContent は正準 YAML", async () => {
  const entries = await deriveDesiredFiles({
    source: memorySourceV3(PRECOMMIT_FILES),
    languages: [],
    bundles: [],
    contents: {},
    exclude: [],
  });
  const pc = entries.find((e) => e.path === ".pre-commit-config.yaml");
  if (pc?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  // universe は未宣言の go profile の key 値も含む(寄与が消えた時の削除追従に必要)
  expect(pc.universe.repos).toEqual(
    expect.arrayContaining([
      "https://github.com/gitleaks/gitleaks",
      "https://github.com/example/go-hook",
    ]),
  );
  // data は base のみ(go は未宣言)
  expect((pc.data.repos as unknown[]).length).toBe(1);
  expect(pc.createContent).toContain("repo: https://github.com/gitleaks/gitleaks");
});

test("keyed array: 寄与エントリに識別キーが無ければ fail fast", async () => {
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...PRECOMMIT_FILES,
        "profiles/go/contributes.json": JSON.stringify({
          ".pre-commit-config.yaml": { repos: [{ rev: "v1.0.0" }] },
        }),
      }),
      languages: [],
      bundles: [],
      contents: {},
      exclude: [],
    }),
  ).rejects.toThrow(/識別キー "repo" がない/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/desired/derive.test.ts`
Expected: 1本目 FAIL(universe が `["[object Object]"]` に化ける)、2本目 FAIL(throw されない)

- [ ] **Step 3: 実装**

`profiles.ts` の `universeFor` を差し替え(ループを entries 化して profile 名をエラーに使う):

```ts
  /** universe = 全 profile(選択有無を問わない)の寄与の和集合(spec v3 §6.2) */
  universeFor(
    path: string,
    managedPaths: Record<string, ManagedPathSpec>,
  ): Record<string, string[]> {
    const universe: Record<string, string[]> = {};
    for (const [key, spec] of Object.entries(managedPaths)) {
      const values: string[] = [];
      for (const [profile, pc] of this.byProfile) {
        const v = pc.contributionFor(path)?.[key];
        if (v === undefined) continue;
        if (spec.merge === "array") {
          if (spec.key !== undefined) {
            if (!Array.isArray(v)) continue;
            for (const e of v) {
              const k =
                isPlainObject(e) && typeof e[spec.key] === "string"
                  ? (e[spec.key] as string)
                  : undefined;
              if (k === undefined) {
                throw new Error(
                  `${path}: profiles/${profile} の ${key} 寄与エントリに識別キー "${spec.key}" がない`,
                );
              }
              values.push(k);
            }
          } else if (Array.isArray(v)) {
            values.push(...v.map(String));
          } else if (typeof v === "string") {
            values.push(v);
          }
        } else if (isPlainObject(v)) {
          values.push(...Object.keys(v));
        }
      }
      universe[key] = dedupePreserveOrder(values);
    }
    return universe;
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @repository-fanout/core exec vitest run test/domain/model/desired/derive.test.ts`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/model/canonical/profiles.ts packages/core/test/domain/model/desired/derive.test.ts
git commit -m "feat(core): universe 計算をキー付き array に対応、寄与エントリの key 欠落を fail fast に"
```

## Task A4: 全体テスト・lint・PR・デプロイ

- [ ] **Step 1: 全 workspace のテストと lint**

Run(worktree ルートで): `pnpm -r test && pnpm exec biome check .`
Expected: 全 PASS。biome エラーが出たら `pnpm exec biome check --write .` で修正して再実行

- [ ] **Step 2: PR 作成**

```bash
git push -u origin feat/keyed-array-merge
gh pr create -R bright-room/repository-fanout \
  -t "feat(core): managed array merge にオブジェクト配列用の識別キーを追加" \
  -b "spec: docs/superpowers/specs/2026-07-14-security-fanout-design.md §4

- managed_paths の merge \"array\" に任意フィールド key を追加(後方互換: key 無しは従来の文字列 array)
- 同一性は String(entry[key]) で判定。管理エントリは正準順で収束、universe 外・判定不能エントリは温存
- 寄与側エントリの key 欠落は fail fast(canonical-files CI の validate で検出される)

.pre-commit-config.yaml の repos 配列を managed 配布するための土台。

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: CI green を確認して merge**

Run: `gh pr checks --watch` → `gh pr merge --squash`(リポの慣行に合わせる。既存 PR が squash か merge commit かは `gh pr list -R bright-room/repository-fanout --state merged -L 3 --json mergeCommit,title` で確認)

- [ ] **Step 4: worker デプロイ**

canonical-files の CI はエンジン main を checkout するので merge 時点で validate は新機能を認識する。実配布(worker)は手動デプロイ:

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout
git checkout main 2>/dev/null || true   # main 作業ツリーが dirty なら別途 git -C で pull のみ
git pull origin main
cd apps/worker && mise exec -- wrangler deploy
```

※ main 作業ツリーの dirty(`distStore.ts`)が pull を阻む場合はユーザーに確認(勝手に stash しない)。

Expected: deploy 成功。`mise exec -- wrangler tail` でエラーが無いこと。

---

# Phase B: repo-policies 新設

## Task B1: organization-structure に repo-policies の tf を追加

**Files:**
- Create: `terraform/repository_repo-policies.tf`
- Modify: `terraform/_fanout_manifest.tf:5-10`(fanout_modules に追加)

- [ ] **Step 1: ブランチ作成**

```bash
cd ~/dev/ghq/github.com/bright-room/organization-structure
git fetch origin && git switch -c feat/repo-policies origin/main
```

- [ ] **Step 2: tf ファイル作成**

`terraform/repository_repo-policies.tf`(canonical-files の tf と同型。protection は canonical-files 同様 status check のみ — spec の「必須レビュー」はソロメンテと `required_approving_review_count` の相性が悪いため、既存リポの慣行に合わせる):

```hcl
module "repository_repo_policies" {
  source = "./modules/repository"

  name        = "repo-policies"
  description = "Conftest (OPA/Rego) policies enforcing security prerequisites across repositories"
  visibility  = "public"
  topics      = ["conftest", "opa", "rego", "policy-as-code", "security"]

  fanout = {}
}
```

**branch protection はこの時点では設定しない**(required check `verify` を最初から要求すると、空リポへの初回 push が弾かれて詰む)。B2 で中身を入れて CI が生えた後、B3 で protection を追加する。

あわせて spec §5 の `vulnerability_alerts` 確認: `grep -rn "vulnerability_alerts" terraform/modules/repository/` を実行し、`github_repository` リソースに設定が**無ければ** `main.tf` の `github_repository` リソースに `vulnerability_alerts = true` を追加する(あればスキップ。この属性は Dependabot alerts の有効化で、security-jvm.yml の dependency-submission が送るグラフに対する検知に必要)。

`terraform/_fanout_manifest.tf` の `fanout_modules` に 1 行追加:

```hcl
    "repo-policies"     = module.repository_repo_policies
```

- [ ] **Step 3: fmt / validate**

Run: `cd terraform && terraform fmt && terraform validate`(init 済みでなければ `terraform init -backend=false` で validate のみ)
Expected: valid

- [ ] **Step 4: PR → merge**

```bash
git add terraform/repository_repo-policies.tf terraform/_fanout_manifest.tf
git commit -m "feat: repo-policies リポジトリを新設(conftest ポリシー一元管理、fanout 対象)"
git push -u origin feat/repo-policies
gh pr create -R bright-room/organization-structure -t "feat: repo-policies リポジトリを新設" \
  -b "spec: repository-fanout docs/superpowers/specs/2026-07-14-security-fanout-design.md §3

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

merge 後、CI の terraform apply が repo を作成する(apply の仕組みは organization-structure の CI に従う。apply が手動なら Makefile / README の手順で実行)。

Expected: `gh repo view bright-room/repo-policies` が成功する

※ branch protection の required check `verify` は B2 で CI が生えるまで満たせないが、repo-policies への push は B2 の初期セットアップ(空リポへの直 push)が先なので問題ない。もし protection が直 push を弾く場合は、B2 を PR ベース(protection の required check が未実行の場合は merge 可)で行う。

## Task B2: repo-policies の中身(Rego + collect-facts + CI)

**Files(bright-room/repo-policies、新規 clone):**
- Create: `policy/repo.rego`
- Create: `policy/repo_test.rego`
- Create: `scripts/collect-facts.sh`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: clone と足場**

```bash
cd ~/dev/ghq/github.com/bright-room
gh repo clone bright-room/repo-policies
cd repo-policies
```

- [ ] **Step 2: 事実収集スクリプト**

`scripts/collect-facts.sh`(検査対象リポのルートで実行し、facts JSON を stdout へ出す。jq はランナー標準搭載):

```bash
#!/usr/bin/env bash
# 検査対象リポの「事実」を JSON で出力する。ポリシー判定は一切しない(判定は Rego 側)。
# 使い方: collect-facts.sh <target-repo-root>
set -euo pipefail
cd "${1:?usage: collect-facts.sh <target-repo-root>}"

exists() { [ -e "$1" ] && echo true || echo false; }
tracked() { git ls-files --error-unmatch "$1" >/dev/null 2>&1 && echo true || echo false; }

# *.tf の存在(.terraform/ 配下のキャッシュは除外)
tf_files=$(git ls-files '*.tf' | grep -v '/\.terraform/' | head -1 || true)
# .terraform.lock.hcl がどこかに 1 つでも git 管理下にあるか
tf_lock=$(git ls-files '*.terraform.lock.hcl' '.terraform.lock.hcl' | head -1 || true)
# settings.gradle(.kts) の存在
gradle_settings=$(git ls-files 'settings.gradle' 'settings.gradle.kts' '**/settings.gradle' '**/settings.gradle.kts' | head -1 || true)
# gradle.lockfile がどこかにあるか
gradle_lock=$(git ls-files '*gradle.lockfile' | head -1 || true)

package_json="null"
if [ -f package.json ]; then
  package_json=$(jq '{packageManager: (.packageManager // null)}' package.json)
fi

jq -n \
  --argjson package_json "$package_json" \
  --argjson yarn_lock "$(exists yarn.lock)" \
  --argjson package_lock "$(exists package-lock.json)" \
  --argjson shrinkwrap "$(exists npm-shrinkwrap.json)" \
  --argjson pyproject "$(exists pyproject.toml)" \
  --argjson uv_lock "$(exists uv.lock)" \
  --argjson poetry_lock "$(exists poetry.lock)" \
  --argjson kjs_dir "$(exists kotlin-js-store)" \
  --argjson kjs_lock_tracked "$(tracked kotlin-js-store/yarn.lock)" \
  --argjson has_tf "$([ -n "$tf_files" ] && echo true || echo false)" \
  --argjson has_tf_lock "$([ -n "$tf_lock" ] && echo true || echo false)" \
  --argjson has_gradle "$([ -n "$gradle_settings" ] && echo true || echo false)" \
  --argjson has_gradle_lock "$([ -n "$gradle_lock" ] && echo true || echo false)" \
  '{
    package_json: $package_json,
    exists: {
      "yarn.lock": $yarn_lock,
      "package-lock.json": $package_lock,
      "npm-shrinkwrap.json": $shrinkwrap,
      "pyproject.toml": $pyproject,
      "uv.lock": $uv_lock,
      "poetry.lock": $poetry_lock,
      "kotlin-js-store": $kjs_dir
    },
    kotlin_js_store_yarn_lock_tracked: $kjs_lock_tracked,
    terraform: { has_tf: $has_tf, has_lock: $has_tf_lock },
    gradle: { has_settings: $has_gradle, has_lockfile: $has_gradle_lock }
  }'
```

`chmod +x scripts/collect-facts.sh`

- [ ] **Step 3: Rego ポリシー**

`policy/repo.rego`:

```rego
package main

import rego.v1

# --- typescript: pnpm 以外を禁止(層1 OSV の前提 = pnpm-lock.yaml を守る) ---

deny contains msg if {
	input.package_json != null
	pm := object.get(input.package_json, "packageManager", "")
	not pnpm_pinned(pm)
	msg := "package.json: packageManager は pnpm@<version> 固定(corepack で pnpm を強制する)"
}

# object.get の default は「キー不在」時のみ効き、値が null だと null が返る。
# collect-facts は packageManager 不在を null で出力するため、is_string ガードが無いと
# startswith が eval_type_error で crash する(検証ゲートでなく本番 policy ジョブも落ちる)。
pnpm_pinned(pm) if {
	is_string(pm)
	startswith(pm, "pnpm@")
}

deny contains msg if {
	input.package_json != null
	some f in ["yarn.lock", "package-lock.json", "npm-shrinkwrap.json"]
	input.exists[f]
	msg := sprintf("%s を置かない(pnpm 専用リポ。kotlin-js-store/yarn.lock は対象外)", [f])
}

# --- kotlin (KMP): kotlin-js-store/yarn.lock は必ずコミット(OSV の検査対象にする) ---

deny contains msg if {
	input.exists["kotlin-js-store"]
	not input.kotlin_js_store_yarn_lock_tracked
	msg := "kotlin-js-store/yarn.lock を git 管理下に置く(.gitignore から外す)"
}

# --- python: lockfile 必須(OSV の検査対象にする) ---

deny contains msg if {
	input.exists["pyproject.toml"]
	not input.exists["uv.lock"]
	not input.exists["poetry.lock"]
	msg := "python プロジェクトは uv.lock か poetry.lock をコミットする"
}

# --- terraform: .terraform.lock.hcl 必須 ---

deny contains msg if {
	input.terraform.has_tf
	not input.terraform.has_lock
	msg := ".terraform.lock.hcl をコミットする(provider のピン留め)"
}

# --- jvm (gradle): lockfile 必須 — endpoint-gate / mindstock への lockfile 導入完了後に有効化する
#     (spec 2026-07-14 §7。有効化 = 下のコメントを外すだけ)
# deny contains msg if {
# 	input.gradle.has_settings
# 	not input.gradle.has_lockfile
# 	msg := "Gradle dependency locking を有効にして gradle.lockfile をコミットする"
# }
```

`policy/repo_test.rego`(ルールごとに正例・反例):

```rego
package main

import rego.v1

clean_facts := {
	"package_json": null,
	"exists": {
		"yarn.lock": false, "package-lock.json": false, "npm-shrinkwrap.json": false,
		"pyproject.toml": false, "uv.lock": false, "poetry.lock": false,
		"kotlin-js-store": false
	},
	"kotlin_js_store_yarn_lock_tracked": false,
	"terraform": {"has_tf": false, "has_lock": false},
	"gradle": {"has_settings": false, "has_lockfile": false}
}

test_clean_repo_has_no_denies if {
	count(deny) == 0 with input as clean_facts
}

test_pnpm_ok if {
	count(deny) == 0 with input as object.union(clean_facts, {"package_json": {"packageManager": "pnpm@10.12.0"}})
}

test_non_pnpm_denied if {
	msgs := deny with input as object.union(clean_facts, {"package_json": {"packageManager": "npm@11.0.0"}})
	some msg in msgs
	contains(msg, "packageManager")
}

test_missing_package_manager_denied if {
	count(deny) > 0 with input as object.union(clean_facts, {"package_json": {"packageManager": null}})
}

test_foreign_lockfile_denied if {
	count(deny) > 0 with input as object.union(clean_facts, {
		"package_json": {"packageManager": "pnpm@10.12.0"},
		"exists": object.union(clean_facts.exists, {"yarn.lock": true}),
	})
}

test_kmp_yarn_lock_ignored_denied if {
	count(deny) > 0 with input as object.union(clean_facts, {"exists": object.union(clean_facts.exists, {"kotlin-js-store": true})})
}

test_kmp_yarn_lock_tracked_ok if {
	count(deny) == 0 with input as object.union(clean_facts, {
		"exists": object.union(clean_facts.exists, {"kotlin-js-store": true}),
		"kotlin_js_store_yarn_lock_tracked": true,
	})
}

test_python_without_lock_denied if {
	count(deny) > 0 with input as object.union(clean_facts, {"exists": object.union(clean_facts.exists, {"pyproject.toml": true})})
}

test_python_with_uv_lock_ok if {
	count(deny) == 0 with input as object.union(clean_facts, {"exists": object.union(clean_facts.exists, {"pyproject.toml": true, "uv.lock": true})})
}

test_terraform_without_lock_denied if {
	count(deny) > 0 with input as object.union(clean_facts, {"terraform": {"has_tf": true, "has_lock": false}})
}

test_terraform_with_lock_ok if {
	count(deny) == 0 with input as object.union(clean_facts, {"terraform": {"has_tf": true, "has_lock": true}})
}
```

- [ ] **Step 4: ローカルで conftest verify**

Run: `docker run --rm -v "$PWD:/project" -w /project openpolicyagent/conftest:v0.68.2 verify --policy policy/`
(ローカルに conftest があれば `conftest verify --policy policy/` でも可)
Expected: 全テスト PASS

- [ ] **Step 5: 自リポ CI**

`.github/workflows/ci.yml`(job 名は tf の required check `verify` と一致させる):

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: conftest verify
        run: |
          docker run --rm -v "$PWD:/project" -w /project \
            openpolicyagent/conftest:v0.68.2 verify --policy policy/
      - name: collect-facts smoke (self)
        run: |
          ./scripts/collect-facts.sh . | tee /tmp/facts.json
          docker run --rm -v "$PWD/policy:/policy:ro" -v /tmp/facts.json:/facts.json:ro \
            openpolicyagent/conftest:v0.68.2 test --policy /policy /facts.json
```

- [ ] **Step 6: README**

`README.md`:

```markdown
# repo-policies

bright-room / kukv の管理リポジトリが満たすべきセキュリティ前提を conftest (OPA/Rego) で検査するポリシー集。
各リポに fanout が配布する `.github/workflows/security.yml` の `policy` ジョブから **main 参照**で実行される
(ルール変更はこのリポの merge だけで全リポに反映される。だからこそ main への変更は CI green が必須)。

## 構成

- `policy/repo.rego` — deny ルール(facts に応じて言語別ルールが条件発火)
- `policy/repo_test.rego` — conftest verify で回るユニットテスト
- `scripts/collect-facts.sh` — 検査対象リポから事実(ファイル存在・git 管理状態・package.json 抜粋)を JSON 化

## ルール追加の手順

1. `scripts/collect-facts.sh` に必要な事実を足す(判定は入れない)
2. `policy/repo.rego` に deny ルールを足す
3. `policy/repo_test.rego` に正例・反例を足す
4. PR → CI(conftest verify)green → merge。fanout 側の変更は不要
```

- [ ] **Step 7: push**

```bash
git add -A
git commit -m "feat: リポジトリ横断のセキュリティ前提ポリシー(conftest)と事実収集スクリプト"
git push origin main   # B3 まで protection は無いので直 push できる
```

Expected: push 後の main で CI(verify)green

## Task B3: repo-policies に branch protection を追加(organization-structure)

CI が生えたので required check を掛ける。`terraform/repository_repo-policies.tf` の module に追記:

```hcl
  default_branch_protection = {
    required_status_checks = [
      { context = "verify" },
    ]
  }
```

- [ ] `terraform fmt && terraform validate` → PR → merge(B1 と同じ手順、ブランチ名 `feat/repo-policies-protection`)

コミットメッセージ: `feat: repo-policies に branch protection(required check: verify)を追加`

policy は main 参照で全リポの CI に即時反映されるため、この protection が「侵害・事故が全 CI に波及する」リスクの防波堤になる(spec §3)。

---

# Phase C: renovate-config — 配布 workflow を renovate の対象外に

## Task C1: default.json に ignorePaths

**Files:**
- Modify: `~/dev/ghq/github.com/bright-room/renovate-config/default.json`

- [ ] **Step 1: 編集**

`ignorePaths` は**デフォルト値を上書きする**ので、既定の node_modules 等も明記する:

```json
  "ignorePaths": [
    "**/node_modules/**",
    "**/bower_components/**",
    ".github/workflows/security.yml",
    ".github/workflows/security-jvm.yml",
    ".github/workflows/security-rust.yml"
  ],
```

`default.json` の `"extends"` の直後に挿入。理由コメントは JSON に書けないので commit message と README(あれば)に残す。

- [ ] **Step 2: PR → merge**

```bash
cd ~/dev/ghq/github.com/bright-room/renovate-config
git fetch origin && git switch -c chore/ignore-fanout-workflows origin/main
git add default.json
git commit -m "chore: fanout 管理のセキュリティ workflow を renovate 対象外に

digest ピンの更新は canonical-files 側の customManager が中央で行い、
配布先での digest ピン更新(helpers:pinGitHubActionDigests)と fanout の
replaced 収束が update 合戦になるのを防ぐ。ignorePaths はデフォルト値を
上書きするため node_modules 等の既定も明記している。"
git push -u origin chore/ignore-fanout-workflows
gh pr create -R bright-room/renovate-config -t "chore: fanout 管理のセキュリティ workflow を renovate 対象外に" -b "spec: repository-fanout docs/superpowers/specs/2026-07-14-security-fanout-design.md §5

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# Phase D: canonical-files — 配布物の追加と template profile 分離

**前提: Phase A が merge 済み**(canonical-files の CI は repository-fanout の main を checkout して validate するため)。

## バージョン pin 表(2026-07-14 に gh api / 公式 docs で解決済み)

| 対象 | 値 |
|---|---|
| actions/checkout | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` # v7.0.0 |
| google/osv-scanner-action(composite: `/osv-scanner-action`) | `9a498708959aeaef5ef730655706c5a1df1edbc2` # v2.3.8 |
| gradle/actions(wrapper-validation / dependency-submission 共通) | `3f131e8634966bd73d06cc69884922b02e6faf92` # v6.2.0 |
| actions/setup-java | `0f481fcb613427c0f801b606911222b5b6f3083a` # v5.5.0 |
| EmbarkStudios/cargo-deny-action | `3c6349835b2b7b196a839186cb8b78e02f7b5f25` # v2.1.1 |
| gitleaks(docker) | `ghcr.io/gitleaks/gitleaks:v8.30.1`(findings で exit 1) |
| zizmor | `pipx run zizmor==1.26.1 --offline .`(findings で exit 11-14) |
| anti-trojan-source | `npx --yes anti-trojan-source@1.12.0`(検出 exit 1 / 未検出・**glob 不一致は exit 0**) |
| conftest(docker) | `openpolicyagent/conftest:v0.68.2`(deny で非ゼロ) |
| pre-commit rev | gitleaks `v8.30.1`(hook id `gitleaks`)/ texthooks `0.7.1`(**v プレフィックス無し**、hook id `forbid-bidi-controls`) |

実装時が後日になる場合は各 pin を再解決してよい(方法: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`。annotated tag は `git/tags/<sha>` で commit へ dereference)。

## Task D1: ブランチ作成 + template profile 分離

**Files:**
- Create: `profiles/template/contributes.json`
- Modify: `profiles/base/contributes.json`(4エントリ削除)

- [ ] **Step 1: ブランチ作成**

```bash
cd ~/dev/ghq/github.com/bright-room/canonical-files
git fetch origin && git switch -c feat/security-distribution origin/main
```

- [ ] **Step 2: template profile を新設**

`profiles/template/contributes.json`:

```json
{
  "_comment": "PR/Issue テンプレートの opt-in 配布(spec 2026-07-14 §2.1)。fanout.bundles に \"template\" を宣言したリポにのみ配る。base からの移動(2026-07-14)であり、未宣言リポでは既配布分が retraction される。",
  ".github/pull_request_template.md": {
    "template": "pull-request-template.liquid"
  },
  ".github/ISSUE_TEMPLATE/bug_report.yaml": {
    "template": "issue-bug-report.liquid"
  },
  ".github/ISSUE_TEMPLATE/feature_request.yaml": {
    "template": "issue-feature-request.liquid"
  },
  ".github/ISSUE_TEMPLATE/config.yml": {
    "template": "issue-config.liquid"
  }
}
```

- [ ] **Step 3: base から同4エントリを削除**

`profiles/base/contributes.json` から以下の4キーを丸ごと削除(`.github/release.yaml` は残す):

- `".github/pull_request_template.md"`
- `".github/ISSUE_TEMPLATE/bug_report.yaml"`
- `".github/ISSUE_TEMPLATE/feature_request.yaml"`
- `".github/ISSUE_TEMPLATE/config.yml"`

- [ ] **Step 4: validate(エンジン main で)**

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout/.claude/worktrees/keyed-array-merge
git fetch origin && git merge --ff-only origin/main   # Phase A merge 済みの main に追従
pnpm install && pnpm --filter cli run validate -- --dir ~/dev/ghq/github.com/bright-room/canonical-files
```

Expected: エラーなし(profile 追加はディレクトリを置くだけで validate が自動発見する)

- [ ] **Step 5: Commit**

```bash
cd ~/dev/ghq/github.com/bright-room/canonical-files
git add profiles/template/contributes.json profiles/base/contributes.json
git commit -m "feat: PR/Issue テンプレートを opt-in の template profile へ分離

base から移動。fanout.bundles に template を宣言したリポにのみ配布される。
未宣言リポでは次回同期で既配布分の削除 PR が出る(意図した挙動)。"
```

## Task D2: 層1 security.yml + pre-commit の配布(base)

**Files:**
- Create: `templates/security-workflow.liquid`
- Modify: `catalog.json`
- Modify: `profiles/base/contributes.json`

- [ ] **Step 1: catalog.json にエントリ追加**

`files` オブジェクトの末尾に追加:

```json
    ".github/workflows/security.yml": {
      "file_type": "yaml",
      "mode": "replaced",
      "raw": true
    },
    ".pre-commit-config.yaml": {
      "file_type": "yaml",
      "mode": "managed",
      "managed_paths": {
        "repos": {
          "merge": "array",
          "key": "repo"
        }
      }
    }
```

- [ ] **Step 2: security-workflow.liquid を作成**

`templates/security-workflow.liquid`(raw: true なので Liquid 描画されず逐語コピーされる。`${{ }}` はそのまま書いてよい):

```yaml
name: security

# fanout(bright-room/canonical-files)が配布する共通セキュリティ検査(層1・言語非依存)。
# このファイルは fanout 管理(replaced)。直接編集しても次回同期で差し戻される。
# 変更は canonical-files の templates/security-workflow.liquid へ。
# policy ジョブのルール本体は bright-room/repo-policies(main 参照)で一元管理。
# 設計: repository-fanout docs/superpowers/specs/2026-07-14-security-fanout-design.md

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 0 * * 1" # 週次。脆弱性 DB は後から更新されるため定期実行する

permissions: {}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  # 不可視 Unicode / Trojan Source(全テキストファイル・言語非依存)
  hidden-unicode:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: scan source files
        run: |
          npx --yes anti-trojan-source@1.12.0 --verbose \
            --files='**/*.{go,java,kt,kts,rs,ts,tsx,js,jsx,mjs,cjs,py,rb,php,c,h,cpp,sh,tf,toml,yml,yaml,json,md}'
      - name: scan AI rules files
        run: |
          npx --yes anti-trojan-source@1.12.0 --verbose \
            --files='**/{CLAUDE.md,AGENTS.md,.cursorrules,.clinerules,.windsurfrules,*.mdc,copilot-instructions.md}'

  # シークレット検知(全履歴)
  secrets:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: gitleaks
        run: |
          docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 \
            git /repo --redact --verbose --exit-code 1

  # 多エコシステム SCA(lockfile を再帰自動検出。リポ直下の osv-scanner.toml は自動適用)
  sca:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: google/osv-scanner-action/osv-scanner-action@9a498708959aeaef5ef730655706c5a1df1edbc2 # v2.3.8
        with:
          scan-args: |-
            --recursive
            ./

  # workflow YAML 自体の静的解析(オフライン。findings で exit 非ゼロ)
  workflow-audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: zizmor
        run: pipx run zizmor==1.26.1 --offline .

  # プロジェクト設定のセキュリティ前提検査(ルールは bright-room/repo-policies で一元管理)
  policy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          repository: bright-room/repo-policies
          ref: main
          path: .repo-policies
          persist-credentials: false
      - name: collect facts
        run: .repo-policies/scripts/collect-facts.sh . | tee /tmp/facts.json
      - name: conftest
        run: |
          docker run --rm \
            -v "$PWD/.repo-policies/policy:/policy:ro" \
            -v /tmp/facts.json:/facts.json:ro \
            openpolicyagent/conftest:v0.68.2 test --policy /policy /facts.json
```

- [ ] **Step 3: base の寄与を追加**

`profiles/base/contributes.json` に2キー追加:

```json
  ".github/workflows/security.yml": {
    "template": "security-workflow.liquid"
  },
  ".pre-commit-config.yaml": {
    "repos": [
      {
        "repo": "https://github.com/gitleaks/gitleaks",
        "rev": "v8.30.1",
        "hooks": [{ "id": "gitleaks" }]
      },
      {
        "repo": "https://github.com/sirosen/texthooks",
        "rev": "0.7.1",
        "hooks": [{ "id": "forbid-bidi-controls" }]
      }
    ]
  }
```

あわせて base の `_comment` に設計ガードレールを追記(文末に追加):
`「.pre-commit-config.yaml の repos に repo: \"local\" を入れない(識別キーが repo のため、配布先リポ自身の local hook を潰す)。lint/fmt 系 hook も入れない(セキュリティ専用)。」`

- [ ] **Step 4: validate**

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout/.claude/worktrees/keyed-array-merge
pnpm --filter cli run validate -- --dir ~/dev/ghq/github.com/bright-room/canonical-files
```

Expected: エラーなし(security.yml は raw なので `${{ }}` が素通りし、YAML としてパース可能なことも validate が確認する)

- [ ] **Step 5: Commit**

```bash
cd ~/dev/ghq/github.com/bright-room/canonical-files
git add catalog.json templates/security-workflow.liquid profiles/base/contributes.json
git commit -m "feat: 層1セキュリティ(security.yml + pre-commit)を base で全リポに配布

- security.yml: hidden-unicode / gitleaks / OSV-Scanner / zizmor / conftest policy の5ジョブ。
  action は digest ピン(更新は本リポの customManager が担う)
- .pre-commit-config.yaml: managed(repos を key=repo でマージ)。中央は gitleaks +
  texthooks forbid-bidi-controls のみ。リポ独自 hook は温存される"
```

## Task D3: 層2 — security-jvm(java/kotlin)+ security-rust + deny.toml

**Files:**
- Create: `templates/security-jvm-workflow.liquid`
- Create: `templates/security-rust-workflow.liquid`
- Create: `templates/deny.toml.liquid`
- Modify: `catalog.json`
- Modify: `profiles/java/contributes.json` / `profiles/kotlin/contributes.json` / `profiles/rust/contributes.json`

- [ ] **Step 1: catalog.json にエントリ追加**

```json
    ".github/workflows/security-jvm.yml": {
      "file_type": "yaml",
      "mode": "replaced",
      "raw": true
    },
    ".github/workflows/security-rust.yml": {
      "file_type": "yaml",
      "mode": "replaced",
      "raw": true
    },
    "deny.toml": {
      "file_type": "toml",
      "mode": "create-only"
    }
```

- [ ] **Step 2: security-jvm-workflow.liquid**

```yaml
name: security-jvm

# fanout 配布(java / kotlin profile)。層2: Gradle 固有のサプライチェーン対策。
# - wrapper-validation: gradle-wrapper.jar のチェックサム検証(改ざん検知)
# - dependency-submission: 解決済み依存グラフを GitHub へ送信 → Dependabot alerts が
#   既知脆弱性を検知(lockfile 未コミットでも依存が見えるようになる)
# このファイルは fanout 管理(replaced)。変更は canonical-files の templates/ へ。

on:
  pull_request:
  push:
    branches: [main]

permissions: {}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  wrapper-validation:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: gradle/actions/wrapper-validation@3f131e8634966bd73d06cc69884922b02e6faf92 # v6.2.0

  dependency-submission:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write # 依存グラフ送信(Dependency submission API)に必要
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: actions/setup-java@0f481fcb613427c0f801b606911222b5b6f3083a # v5.5.0
        with:
          distribution: temurin
          java-version: 21
      - uses: gradle/actions/dependency-submission@3f131e8634966bd73d06cc69884922b02e6faf92 # v6.2.0
```

- [ ] **Step 3: security-rust-workflow.liquid**

```yaml
name: security-rust

# fanout 配布(rust profile)。層2: cargo-deny(advisories / bans / sources)。
# OSV との差分は sources(取得元レジストリ許可制)・bans・yanked 検知。
# 設定はリポ直下の deny.toml(fanout が create-only で初期配置、以後リポ所有)。

on:
  pull_request:
  push:
    branches: [main]

permissions: {}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  cargo-deny:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: EmbarkStudios/cargo-deny-action@3c6349835b2b7b196a839186cb8b78e02f7b5f25 # v2.1.1
        with:
          command: check advisories bans sources
```

- [ ] **Step 4: deny.toml.liquid**

```toml
# cargo-deny 設定。fanout(canonical-files)が create-only で初期配置したもので、以後はリポ所有。
# 参考: https://embarkstudios.github.io/cargo-deny/

[advisories]
yanked = "deny"

[bans]
multiple-versions = "warn"

[sources]
unknown-registry = "deny"
unknown-git = "deny"
```

- [ ] **Step 5: profile 寄与を追加**

`profiles/java/contributes.json` と `profiles/kotlin/contributes.json` の両方にトップレベルキーを追加(同名 template の複数宣言は合法。mise.toml と同パターン):

```json
  ".github/workflows/security-jvm.yml": {
    "template": "security-jvm-workflow.liquid"
  }
```

`profiles/rust/contributes.json` に追加:

```json
  ".github/workflows/security-rust.yml": {
    "template": "security-rust-workflow.liquid"
  },
  "deny.toml": {
    "template": "deny.toml.liquid"
  }
```

- [ ] **Step 6: validate → Commit**

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout/.claude/worktrees/keyed-array-merge
pnpm --filter cli run validate -- --dir ~/dev/ghq/github.com/bright-room/canonical-files
cd ~/dev/ghq/github.com/bright-room/canonical-files
git add catalog.json templates/security-jvm-workflow.liquid templates/security-rust-workflow.liquid templates/deny.toml.liquid profiles/java/contributes.json profiles/kotlin/contributes.json profiles/rust/contributes.json
git commit -m "feat: 層2セキュリティを言語 profile で配布(jvm: wrapper検証+依存グラフ送信 / rust: cargo-deny)"
```

## Task D4: renovate customManagers + README 更新

**Files:**
- Modify: `renovate.json`
- Modify: `README.md`

- [ ] **Step 1: renovate.json の customManagers に2本追加**

既存の customManagers 配列(mise の node / terraform 追従)の末尾に追加:

```json
    {
      "customType": "regex",
      "description": "templates/*.liquid 内の GitHub Actions digest ピン(uses: owner/repo@sha # vX.Y.Z)を追従",
      "managerFilePatterns": [
        "/^templates/.*\\.liquid$/"
      ],
      "matchStrings": [
        "uses:\\s+(?<depName>[\\w.-]+/[\\w.-]+)(?:/[\\w./-]+)?@(?<currentDigest>[a-f0-9]{40})\\s+#\\s*(?<currentValue>v?[\\d.]+)"
      ],
      "datasourceTemplate": "github-tags",
      "versioningTemplate": "semver"
    },
    {
      "customType": "regex",
      "description": "profiles/base/contributes.json の pre-commit rev を追従",
      "managerFilePatterns": [
        "/^profiles/base/contributes\\.json$/"
      ],
      "matchStrings": [
        "\"repo\":\\s*\"https://github.com/(?<depName>[^\"]+)\"[^}]*?\"rev\":\\s*\"(?<currentValue>[^\"]+)\""
      ],
      "datasourceTemplate": "github-tags",
      "versioningTemplate": "semver"
    }
```

注意点(調査済み):
- 1本目の matchStrings は `gradle/actions/wrapper-validation@sha` のようなサブパス付き uses にも депName=`gradle/actions` でマッチするよう `(?:/[\w./-]+)?` を挟んでいる
- docker イメージタグ(gitleaks / conftest / zizmor / anti-trojan-source のバージョン)は今回 customManager を作らない(頻度が低く、テンプレ更新時に手動で上げる。必要になったら同じ仕組みで追加)
- この regex 構成は Renovate 公式プリセットには無いため、**merge 後最初の Renovate 実行で Dependency Dashboard を見て発火を確認する**(D6 の検証項目)

- [ ] **Step 2: README.md 更新**

以下を反映:

1. 「profiles/\<name\>/contributes.json」節の profile 列挙を更新: `base` / 各言語 / `oss` に加えて `template`(PR/Issue テンプレの opt-in)を追記
2. 「注意」節に追記:

```markdown
- `.github/workflows/security*.yml` は `raw: true` で Liquid 描画をスキップして配布している。action は digest ピンで書き、更新は本リポの renovate customManager が行う(配布先の renovate は renovate-config の ignorePaths で本ファイルを対象外にしている)。
- `.pre-commit-config.yaml` の repos に `repo: "local"` を入れない(managed の識別キーが repo のため、配布先リポ自身の local hook を潰す)。lint/fmt 系 hook も入れない(セキュリティ専用。言語・時期でツールが変わりメンテ負荷になる)。
- policy 検査のルール本体は [bright-room/repo-policies](https://github.com/bright-room/repo-policies) にある。ルール追加・変更はあちらだけで完結する(fanout の再配布不要)。
```

- [ ] **Step 3: validate → Commit → PR**

```bash
cd ~/dev/ghq/github.com/bright-room/repository-fanout/.claude/worktrees/keyed-array-merge
pnpm --filter cli run validate -- --dir ~/dev/ghq/github.com/bright-room/canonical-files
cd ~/dev/ghq/github.com/bright-room/canonical-files
git add renovate.json README.md
git commit -m "chore: 配布テンプレートの digest / pre-commit rev を renovate customManager で追従"
git push -u origin feat/security-distribution
gh pr create -R bright-room/canonical-files \
  -t "feat: セキュリティ配布(層1/層2)+ PR/Issue テンプレの template profile 分離" \
  -b "spec: repository-fanout docs/superpowers/specs/2026-07-14-security-fanout-design.md

**merge 前の必須条件(Phase E1): GitHub App の workflows: write 権限が両インストールで承認済みであること。**
merge すると fanout-sync が発火し、全7リポへ配布 PR(テンプレ削除含む)が出る。

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: CI(validate)green。**ただしこの PR は Phase E1(App 権限)完了まで merge しない。**

---

# 実装時の判明事項・計画からの修正(2026-07-14 実行ログ)

- **Phase D 品質レビューによる修正(コミット c6a2e6b)**: ① sca に `--include-git-root` 追加(lockfile ゼロのリポで osv-scanner が exit 128 で恒久 fail するため。dotfiles / structure が該当)② hidden-unicode の glob を複数行に分割し `.github/**` / `.github/copilot-instructions.md` / `.cursor/rules/*.mdc` / `.claude/**/*.md` を明示(globby の dot:false により leading `**` は dot ディレクトリへ降りない)③ jvm dependency-submission の checkout にも `persist-credentials: false` ④ renovate customManagers に gitleaks(docker)/ conftest(docker)/ zizmor(pypi)/ anti-trojan-source(npm)の4本を追加(run ブロック内 pin は uses 用 manager に不可視のため)
- **B2 の Rego バグ修正**: `object.get` の default はキー不在時のみ有効で、`packageManager: null` で `startswith` が crash する → `pnpm_pinned`(is_string ガード)ヘルパ化(§B2 のコードは修正済み)
- **B1/B3 の前提修正**: terraform module はリポ作成時に組織共通 ruleset(PR 必須 + code owner review + 全ブランチ署名コミット必須 + bypass: fanout App=always / br-maintainers Team=pull_request)を自動適用する。よって「B3 まで直 push 可能」は誤りで、B2 の内容は署名コミット + PR 経路で投入(repo-policies #2)。B3 の残作業は required status check `verify` の追加のみ

# Phase E: ロールアウト

## Task E1: GitHub App に workflows 権限を追加(ユーザー作業)

fanout の GitHub App が `.github/workflows/*.yml` を push するには **Workflows: Read and write** 権限が必要。これはユーザーにしかできない操作なので依頼する:

1. https://github.com/settings/apps (App がユーザー所有の場合)または bright-room の Organization settings → Developer settings → GitHub Apps → 該当 App → Permissions & events
2. Repository permissions → **Workflows: Read and write** に変更して保存
3. 権限変更は各インストールで再承認が必要: bright-room / kukv 両方の Settings → GitHub Apps → 該当 App → 承認

Expected: 両インストールの App 設定画面で Workflows: Read and write が Active

## Task E2: canonical-files merge → 配布確認

- [ ] **Step 1: canonical-files の PR を merge**(fanout-sync が発火し全リポへ配布)

- [ ] **Step 2: 配布 PR の内容確認(代表2リポ)**

```bash
gh pr list -R bright-room/idem        # fanout App が作った配布 PR を確認
gh pr list -R bright-room/mindstock
gh pr diff -R bright-room/idem <配布PR番号>
```

確認観点:
- `.github/workflows/security.yml` と `.pre-commit-config.yaml` が追加されている
- `.github/pull_request_template.md` / `ISSUE_TEMPLATE/*` が**削除**されている(retraction。改変済みならスキップされ PR 本文に注記される)
- mindstock / endpoint-gate には `security-jvm.yml` も追加されている
- repository-fanout では既存 security.yml が汎用版に置き換わっている

- [ ] **Step 3: 代表リポで配布 PR を merge し、security.yml の全ジョブが走ることを確認**

想定される初回 fail と対処(fail は設計どおりのゲート動作。握り潰さない):
- `workflow-audit`: 配布先リポの**既存** workflow の指摘(未ピン action 等)→ そのリポで修正
- `policy`: mindstock の `kotlin-js-store/yarn.lock` が未コミットなら deny → リポ側で .gitignore を直す
- `secrets`: 過去履歴のシークレット検出 → 真正なら鍵ローテーション、誤検知なら対象リポに `.gitleaks.toml` で allowlist
- `hidden-unicode`: 検出時は「削除でなく人手確認」(spec の運用方針)

- [ ] **Step 4: 残りのリポの配布 PR を順次 merge**

- [ ] **Step 5: JVM リポの Dependabot alerts 確認**

`push: main` で dependency-submission が走った後、GitHub UI で確認:
endpoint-gate / mindstock → Insights → Dependency graph に Gradle 依存が出ていること。Security → Dependabot alerts が有効なこと(無効なら B1 の `vulnerability_alerts` 対応を確認)。

- [ ] **Step 6: canonical-files の Renovate 発火確認**

merge 後最初の Renovate 実行(土曜 9am 前スケジュール、または Dependency Dashboard から手動)で、customManager が `templates/*.liquid` の digest と pre-commit rev を検出していることを Dependency Dashboard の Detected dependencies で確認。

## Task E3: 後片付け・引き継ぎ事項の記録

- [ ] repository-fanout の spec/plan ブランチ(`docs/security-fanout-spec`)を PR して docs を main に取り込む
- [ ] 後続タスク(spec §7)を issue 化:
  - `bright-room/endpoint-gate` / `bright-room/mindstock`: Gradle dependency locking 導入 → 完了後 repo-policies の gradle.lockfile ルール有効化
  - `kukv/herdr-plugin-github-dash`: `languages = ["go"]` 宣言の要否判断
- [ ] worktree の掃除: `git worktree remove .claude/worktrees/keyed-array-merge`(security-fanout worktree は docs PR merge 後に)

---

# 補足: 想定質問

**Q. 配布先で pre-commit は自動で動く?** — 動かない。`.pre-commit-config.yaml` は設定の配布のみで、各開発者が `pre-commit install` する必要がある(mise 等での導入は本計画のスコープ外)。CI 側の security.yml が同等の検査を必ず実行するので、pre-commit は「手元で早く気づく」ための追加防衛。

**Q. dotfiles / structure にも security.yml が入るが?** — 意図どおり(base = 全 fanout 対象)。dotfiles は lockfile が無いので sca は即 pass、policy も facts が全 false で pass する。structure(private)は Actions 無料枠 2,000分/月 の範囲内。

**Q. zizmor が配布した security.yml 自体を指摘しないか?** — checkout に `persist-credentials: false` を付けて既知の指摘(artipacked)を潰してある。それでも新しい zizmor バージョンが新ルールで指摘する可能性はあり、その場合は canonical-files のテンプレートを直す(全リポに一括反映される)。
