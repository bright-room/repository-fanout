# v3-P2: canonical-files の catalog/profiles/templates への変換プラン(P-b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [v3 spec](../specs/2026-07-05-catalog-profiles-design.md) §9 P-b — canonical-files を v2 レイアウト(fragment.json / strategies.json / files/)から v3 レイアウト(catalog.json / profiles / templates)へ変換する。**この PR の merge が v3 への切替スイッチ**(worker は catalog.json の有無で自動切替。rf PR#31 で実装済み)。

**Architecture:** 純粋なデータ変換。エンジン(TS)は一切変更しない。受け入れ根拠は 2 段: (1) merge 前 — 新旧レイアウトを localSource で読み比べ、全宣言組合せの FileChange がバイト一致(renovate 新規作成のみ意味的同一)であることをスクラッチテストで確認。(2) merge 後 — fanout-sync の自動 kick で全リポ **0 diff(no-op)** を観測。

**作業リポ:** canonical-files(/Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files)。ブランチ `feat/v3-catalog-conversion`。等価性検証だけ repository-fanout 側のスクラッチテスト(コミットしない)を使う。

**前提(確認済み):**
- rf PR#31 merge 済み(cli validate は catalog.json を検出すると v3 検証へ自動分岐)
- canonical-files の CI validate.yml は repository-fanout@main HEAD を checkout して cli validate を実行 → 変換 PR の CI がそのまま v3 検証になる
- 逐語テンプレート化する 3 ファイル(release.yml / CONTRIBUTING.md / SECURITY.md)に `{{` `{%` は含まれない(grep 確認済み。`raw: true` 不要)
- 変換は**挙動不変**が原則: CONTRIBUTING.md は現行どおり `replaced`(create-only 化などの意味論変更は P-b に含めない。将来の別判断)

---

### Task 1: ブランチ作成と新レイアウトの追加(旧レイアウトはまだ消さない)

**Files(canonical-files):**
- Create: `catalog.json`
- Create: `templates/gitignore.liquid`, `templates/codeowners.liquid`
- Create(git mv): `templates/release.yml.liquid`(← base/files/.github/release.yml)、`templates/contributing.liquid`(← bundles/oss/files/CONTRIBUTING.md)、`templates/security.liquid`(← bundles/oss/files/SECURITY.md)
- Create: `profiles/{base,typescript,go,java,kotlin,python,rust,terraform,oss}/contributes.json`

- [x] **Step 1: ブランチ作成**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
git checkout main && git pull --ff-only
git checkout -b feat/v3-catalog-conversion
```

- [x] **Step 2: catalog.json を作成**

```json
{
  "_comment": "全管理ファイルの唯一の宣言(spec v3 §4.1)。ここに無いパスへの寄与はエラー。本文テンプレートの指定は profiles/*/contributes.json の template キー(= 配布トリガー)。",
  "files": {
    ".gitignore":         { "file_type": "text", "mode": "managed" },
    ".github/CODEOWNERS": { "file_type": "text", "mode": "managed" },
    "renovate.json": {
      "file_type": "json",
      "mode": "managed",
      "managed_paths": { "extends": { "merge": "array" } }
    },
    ".github/release.yml":  { "file_type": "yaml",     "mode": "replaced" },
    "CONTRIBUTING.md":      { "file_type": "markdown", "mode": "replaced" },
    "SECURITY.md":          { "file_type": "markdown", "mode": "replaced" }
  }
}
```

- [x] **Step 3: templates/ を作成**

`templates/gitignore.liquid` — **正準形の唯一の出典は repository-fanout の
`packages/core/test/domain/model/canonical/template.test.ts` の `GITIGNORE_LIQUID`**。
その文字列をそのまま書き出す(このテンプレートが v2 renderGitignore とバイト一致することは
core のテストで固定済み。改変禁止):

```liquid
{% capture nl %}
{% endcapture %}{% capture sep %}{{ nl }}{{ nl }}{% endcapture %}{% assign sections = contributions.sections | cross_dedupe: "ignores" %}{% capture out %}{% for s in sections %}### {{ s.comment }} ###{{ nl }}{{ s.ignores | join: nl }}{% unless forloop.last %}{{ sep }}{% endunless %}{% endfor %}{% endcapture %}{{ out }}
```

(ファイル末尾の改行は有無どちらでも可 — managed-block 化で末尾改行 1 つは剥がされる)

`templates/codeowners.liquid`(v2 の `* @{{codeowner}}` と同出力。contents は tf 側 vars/contents):

```liquid
* @{{ contents.codeowner }}
```

逐語 3 ファイルは**内容を 1 バイトも変えずに** git mv:

```bash
mkdir -p templates
git mv base/files/.github/release.yml   templates/release.yml.liquid
git mv bundles/oss/files/CONTRIBUTING.md templates/contributing.liquid
git mv bundles/oss/files/SECURITY.md     templates/security.liquid
```

- [x] **Step 4: profiles/*/contributes.json を作成**

fragment.json の内容を機械的に写す。規則: `renovate` 配列 → `"renovate.json": { "extends": [...] }`、
`gitignore` セクション → `".gitignore": { "sections": [...] }` で **`section_comment` キーは `comment` にリネーム**
(gitignore.liquid が `s.comment` を参照するため)。`_comment` は各ファイルへ引き継ぐ。

`profiles/base/contributes.json`(base/fragment.json から。template 宣言 = 配布トリガーを兼ねる):

```json
{
  "_comment": "base = 全リポに常時適用される言語非依存の単位。renovate は管理する extends エントリ(preset 本体は bright-room/renovate-config)、gitignore は managed-block に入るセクション群。mise.toml / .tool-versions / .mise* / .envrc は意図的にコミットするリポがあるため ignore しない。.claude/ は settings.local.json 等の個人ローカル分のみ(rules/skills/settings.json をコミットするリポがある)。",
  ".gitignore": {
    "template": "gitignore.liquid",
    "sections": [
      { "comment": "JetBrains IDEs", "ignores": [".fleet/", ".idea/", "*.iws", "*.iml", "*.ipr"] },
      { "comment": "VSCode", "ignores": [".vscode/"] },
      { "comment": "OS", "ignores": [".DS_Store", "**/.DS_Store", "Thumbs.db"] },
      { "comment": "env", "ignores": [".env*", "!.env.example"] },
      { "comment": "AI agents", "ignores": [".claude/settings.local.json", ".claude/worktrees/", "CLAUDE.local.md"] },
      { "comment": "Logfiles", "ignores": ["log/*", "!log/.gitkeep"] },
      { "comment": "Tempfiles", "ignores": [".tmp/", "tmp/*", "!tmp/.gitkeep"] },
      { "comment": "Misc", "ignores": ["HELP.md"] }
    ]
  },
  ".github/CODEOWNERS": { "template": "codeowners.liquid" },
  "renovate.json": { "extends": ["github>bright-room/renovate-config"] },
  ".github/release.yml": { "template": "release.yml.liquid" }
}
```

**注意(renovate.json の骨格)**: v2 の base/files/renovate.json が持っていた `$schema` は、
v3 では「ファイル不在時の新規作成」でのみ意味を持つ(既存ファイルには extends マージのみ)。
全配布先リポは renovate.json を保有済みのため骨格テンプレートは**作らない**(YAGNI)。
`$schema` 付き新規作成が将来必要になったら、`templates/renovate.json.liquid` を作り
base の `"renovate.json"` に `"template"` を足すだけでよい(spec v3 §6.2 の骨格マージ)。

`profiles/typescript/contributes.json`:

```json
{
  "_comment": "coverage/ は Vitest 利用リポ(4リポ中3リポ)で必ず生成されるのに全リポで ignore 漏れだったため追加。*.log は全 TS リポで .log のコミット実績ゼロを確認済み。ロックファイル方針(pnpm 強制等)はリポ毎のポリシーなので入れない。",
  ".gitignore": {
    "sections": [
      { "comment": "node / typescript", "ignores": ["node_modules/", "dist/", "coverage/", "*.tsbuildinfo", "*.log"] }
    ]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:typescript"] }
}
```

`profiles/go/contributes.json`:

```json
{
  "_comment": "Go のビルド成果物名はリポ固有(bin/ や実行ファイル名)になりがちなので、言語共通はテストカバレッジと Windows クロスコンパイル成果物のみに絞る。",
  ".gitignore": {
    "sections": [{ "comment": "go", "ignores": ["coverage.out", "*.exe"] }]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:go"] }
}
```

`profiles/java/contributes.json`:

```json
{
  "_comment": "対象6リポ全てが Gradle(Kotlin DSL)+wrapper のため Maven パターンは持たない。gradle セクションは kotlin と同一文字列にしてあり、java+kotlin 両宣言時は dedup で1つに畳まれる。java preset は renovate-config 側で group:springBoot を内包(framework 軸は fanout に持たない)。",
  ".gitignore": {
    "sections": [{ "comment": "gradle", "ignores": [".gradle/", "build/", "local.properties"] }]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:java"] }
}
```

`profiles/kotlin/contributes.json`:

```json
{
  "_comment": ".editorconfig は各リポが ktlint ルールをリポ固有に設定しているため配布しない(replace で上書き事故になる)。gradle セクションは java と同一文字列(両宣言時に dedup)。kotlin preset は renovate-config 側で group:kotlinMonorepo / group:springBoot を内包。",
  ".gitignore": {
    "sections": [
      { "comment": "gradle", "ignores": [".gradle/", "build/", "local.properties"] },
      { "comment": "kotlin", "ignores": [".kotlin/"] }
    ]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:kotlin"] }
}
```

`profiles/python/contributes.json`(renovate キー無しは現状どおり):

```json
{
  "_comment": "renovate-config に python preset が未整備のため renovate.json への寄与は持たない(preset 追加時にこのファイルへ追記する)。パターンは br-cluster の実態(uv + pytest + ruff + hatchling)に基づく。",
  ".gitignore": {
    "sections": [
      { "comment": "python", "ignores": ["__pycache__/", ".venv/", ".pytest_cache/", ".ruff_cache/", ".coverage", "*.egg-info/"] }
    ]
  }
}
```

`profiles/rust/contributes.json`:

```json
{
  "_comment": "Cargo.lock は全リポでコミット運用(バイナリ配布のため必須)なので ignore してはいけない。target/ は非アンカーなので Tauri の src-tauri/target もカバーする。",
  ".gitignore": {
    "sections": [{ "comment": "rust", "ignores": ["target/"] }]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:rust"] }
}
```

`profiles/terraform/contributes.json`:

```json
{
  "_comment": ".terraform.lock.hcl は全リポでコミット必須(CI が terraform init -lockfile=readonly 前提)のため ignore してはいけない。*.tfvars と override.tf 系は全5リポでコミット実績ゼロを確認済み。",
  ".gitignore": {
    "sections": [
      { "comment": "terraform", "ignores": [".terraform/", "*.tfstate", "*.tfstate.*", "*.tfvars", "*.tfvars.json", "crash.log", "crash.*.log", "override.tf", "override.tf.json", "*_override.tf", "*_override.tf.json", ".terraformrc", "terraform.rc"] }
    ]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:terraform"] }
}
```

`profiles/oss/contributes.json`:

```json
{
  "_comment": "bundles 由来の opt-in profile。公開リポ向けの定型ドキュメントを配るだけで、renovate / gitignore への寄与は無し。",
  "CONTRIBUTING.md": { "template": "contributing.liquid" },
  "SECURITY.md": { "template": "security.liquid" }
}
```

- [x] **Step 5: コミット(新旧併存の中間状態)**

```bash
git add -A
git commit -m "feat: v3 レイアウト(catalog/profiles/templates)を追加(旧レイアウトと併存)"
```

(1Password 署名が "failed to fill whole buffer" で一度失敗したら同じコミットを再試行)

---

### Task 2: 等価性検証(merge 前の受け入れ根拠)

repository-fanout 側にスクラッチテストを置いて実行する(**コミットしない**)。

- [x] **Step 1: 旧レイアウトの worktree を用意**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
git worktree add "${TMPDIR:-/tmp}/canonical-old" main
```

- [x] **Step 2: スクラッチテストを書く**

`packages/core/test/tmp-canonical-equivalence.test.ts`(repository-fanout。実行後に削除):

```ts
import { readFile as fsReadFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { FragmentManifest, TemplateSource } from "../src/templates/types.js";
import { computeChanges } from "../src/domain/model/desired/computeChanges.js";
import { resolveDesired } from "../src/domain/model/desired/derive.js";

const OLD_DIR = `${process.env.TMPDIR ?? "/tmp"}/canonical-old`;
const NEW_DIR = "/Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files";

// apps/cli/src/localSource.ts と同等の最小実装(core のテストから cli へは依存できないため)
function localSource(root: string): TemplateSource {
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
    readFragmentManifest: async (dir) => {
      const raw = await read(`${dir}/fragment.json`);
      return raw === null ? null : (JSON.parse(raw) as FragmentManifest);
    },
    listNames: async (axis) => {
      try {
        const entries = await readdir(join(root, axis), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
      } catch {
        return [];
      }
    },
    nameExists: async (axis, name) => {
      const names = await (async () => {
        try {
          const entries = await readdir(join(root, axis), { withFileTypes: true });
          return entries.filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          return [];
        }
      })();
      return names.includes(name);
    },
  };
}

const LANGUAGES = ["go", "java", "kotlin", "python", "rust", "terraform", "typescript"];
const COMBOS: Array<{ label: string; languages: string[]; bundles: string[] }> = [
  { label: "base-only", languages: [], bundles: [] }, // メタリポ(言語宣言なし)相当
  ...LANGUAGES.map((l) => ({ label: l, languages: [l], bundles: [] as string[] })),
  ...LANGUAGES.map((l) => ({ label: `${l}+oss`, languages: [l], bundles: ["oss"] })),
  { label: "all+oss", languages: LANGUAGES, bundles: ["oss"] },
];

// 既存ファイルがある想定の突合(全実リポは renovate.json 保有済み → 全パスでバイト一致要求)
const ACTUAL: Record<string, string> = {
  "renovate.json": '{\n  "$schema": "https://docs.renovatebot.com/renovate-schema.json",\n  "extends": ["github>bright-room/renovate-config", ":timezone(Asia/Tokyo)"]\n}\n',
  ".gitignore": "# >>> repository-fanout managed >>>\nstale\n# <<< repository-fanout managed <<<\n\n/repo-own/\n",
  ".github/CODEOWNERS": "# >>> repository-fanout managed >>>\n* @old\n# <<< repository-fanout managed <<<\n",
  ".github/release.yml": "changelog: {old: true}\n",
  "CONTRIBUTING.md": "old\n",
  "SECURITY.md": "old\n",
};

for (const combo of COMBOS) {
  test(`FileChange 等価: ${combo.label}`, async () => {
    const args = {
      languages: combo.languages,
      bundles: combo.bundles,
      vars: { codeowner: "equiv/check" },
      exclude: [] as string[],
    };
    const dOld = await resolveDesired({ source: localSource(OLD_DIR), ...args });
    const dNew = await resolveDesired({ source: localSource(NEW_DIR), ...args });
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);

    // 既存ファイルあり: 全パスでバイト一致
    expect(computeChanges(dNew, ACTUAL).sort(byPath)).toEqual(
      computeChanges(dOld, ACTUAL).sort(byPath),
    );

    // ファイル全不在(新規作成): renovate.json のみ意味的同一を許容、他はバイト一致
    const cOld = computeChanges(dOld, {}).sort(byPath);
    const cNew = computeChanges(dNew, {}).sort(byPath);
    expect(cNew.map((c) => c.path)).toEqual(cOld.map((c) => c.path));
    for (let i = 0; i < cOld.length; i++) {
      const o = cOld[i];
      const n = cNew[i];
      if (!o || !n) throw new Error("length mismatch");
      if (o.path === "renovate.json") {
        // v2 はテンプレート由来($schema あり・1 行配列)、v3 は管理データのみの正準生成。
        // extends の中身が一致していれば OK($schema の骨格差は Task 1 Step 4 の注記どおり許容)
        expect(JSON.parse(n.content).extends).toEqual(JSON.parse(o.content).extends);
      } else {
        expect(n).toEqual(o);
      }
    }
  });
}
```

- [x] **Step 3: 実行 → 全 PASS 確認**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
pnpm --filter @repository-fanout/core exec vitest run test/tmp-canonical-equivalence.test.ts
```

Expected: 16 テスト(base-only + 7 言語 + 7 言語+oss + all+oss)全 PASS。
FAIL したら差分を精査(疑う順: contributes の写し間違い → セクション順 → テンプレート whitespace)。
**エンジン側は変更しない**(P-a で実証済み。差分原因はデータ側にある)。

- [x] **Step 4: 結果を記録して後始末**

- PASS のログ(テスト名一覧)を PR 本文用に控える
- `rm packages/core/test/tmp-canonical-equivalence.test.ts`
- `git worktree remove "${TMPDIR:-/tmp}/canonical-old"`
- repository-fanout の working tree が clean であることを確認(`git status`)

---

### Task 3: 旧レイアウトの削除と README 更新

**Files(canonical-files):**
- Delete: `strategies.json`, `base/`, `languages/`, `bundles/`(git mv 済みの files 以外)
- Modify: `README.md`

- [x] **Step 1: 旧レイアウトを削除**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
git rm strategies.json
git rm -r base languages bundles
```

- [x] **Step 2: README.md を v3 構成の説明に書き換え**

最低限、以下を含める(詳細は spec v3 §4 へのリンクで済ませてよい):
- catalog.json = 全管理ファイルの宣言(file_type / mode / managed_paths)
- profiles/<name>/contributes.json = 寄与データ。`template` キー = 本文テンプレート指定 + 配布トリガー
- templates/ = 全ファイル本文(Liquid。`contents.*` = tf 側のリポ個別値)
- ファイル追加の手順チートシート(catalog 1 行 + テンプレート 1 枚 + contributes 1 行。Worker 変更不要)
- 検証: PR ごとに CI(repository-fanout cli validate)が catalog 検証 + 全 profile 描画スモークを実行

- [x] **Step 3: ローカルで v3 validate を実行して 0 エラー確認**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/repository-fanout
pnpm --filter cli run validate -- --dir /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
```

Expected: エラー 0(v3 経路: catalog 検証 + base-only / 各 profile / all の描画スモーク)

- [x] **Step 4: コミット**

```bash
cd /Users/nonaka.koki/dev/workspace/repository-fanout-stacks/canonical-files
git add -A
git commit -m "feat!: v2 レイアウト(fragment/strategies)を撤去し v3 へ全面移行"
```

---

### Task 4: PR 作成 → CI green → merge(merge はユーザー判断)

- [x] **Step 1: push + PR 作成**

PR 本文に含める:
- これが v3 切替スイッチであること(merge = worker が v3 経路に切替 / revert = 即 v2 復帰)
- Task 2 の等価性検証結果(16 組合せ全 PASS)
- renovate.json の骨格($schema)の扱いの注記(既存リポには無影響。新規作成時のみ $schema 無しになる)
- merge 後の期待: fanout-sync 自動 kick → **全リポ 0 diff(no-op)**

- [x] **Step 2: CI validate green を確認**(v3 経路で走ることをログで確認)

- [x] **Step 3: ユーザー merge 後の観測**

1. fanout-sync の kick 成功(Actions ログ)
2. Workflows 実行完了後、**全リポで新規 PR が 1 件も作られていない**ことを確認(no-op 収束)
3. 万一 diff PR が出たら: merge せず内容を精査 → 原因がデータ写し間違いなら canonical-files を修正、
   意味論差ならエンジン調査。切り戻しは変換 PR の revert(catalog.json が消え v2 経路へ即復帰)

---

## 完了条件(P-b の DoD)

- [x] canonical-files が catalog/profiles/templates 構成のみになり、CI validate(v3 経路)green
- [x] merge 前: 16 組合せの FileChange 等価(renovate 新規作成のみ意味的同一)を実測
- [x] merge 後: 全リポ 0 diff(no-op 収束)を観測
- [x] spec v3 DoD-1(既存配布物の描画結果が v2 と意味的に同一)達成

## 後続(このプランに含まない)

- **P-c**: organization-structure の `vars` → `contents` リネーム
- **P-d**: mise.toml(toml managed)追加による「Worker 変更なしでのファイル追加」実証 + CONTRIBUTING.md の create-only 化の要否判断
- **P-e**: repository-fanout の旧経路削除

---

## 実施記録(2026-07-05)

- Task 1: canonical `384abfb`(v3 レイアウト追加。gitignore.liquid は core の GITIGNORE_LIQUID とバイト一致を機械検証、逐語 3 ファイルは R100 リネーム)
- Task 2: 等価性 16 組合せ **全 PASS(初回)**。データ修正ゼロ。許容差は renovate.json 新規作成時の $schema のみ(実影響なし)
- Task 3: canonical `5f71bc1`(旧レイアウト撤去 + README v3 化)。cli validate(v3 経路)`validation OK`
- **前提条件(プラン外で追加)**: 本番 Workers が v2 のままだったため、PR merge 前に repository-fanout main を `wrangler deploy`(Version `7814d139`、2026-07-05)。catalog.json 不在の間は v2 経路のため挙動不変。デプロイ後の手動 kick(04:49 UTC)で v2 経路の no-op を本番実証
- Task 4: canonical PR#11(CI validate green)→ merge(ユーザー、04:53 UTC)→ fanout-sync 自動 kick 成功
- **merge 後観測**: fanout-parent Completed(04:53)、fanout-child 2/2 Completed・errored 0、**kick 以降の新規配布 PR 0 件(V3_NOOP_OK)** → no-op 収束を確認。DoD 達成
- 補足: 現時点の manifest 宣言は 2 リポ(Phase C 未展開)。Phase C 展開後も v3 経路が使われる
