# P3: テンプレ専用リポ (canonical-files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正本となるテンプレ専用リポ `bright-room/canonical-files` を作成し、`base/seeds/languages/bundles` + `strategies.json` 構成で v0 テンプレを配置、ガバナンス（ブランチ保護・必須レビュー）を効かせる（renovate preset は `renovate-config` に構築済み）。

**Architecture:** 構成は `docs/superpowers/specs/sample/` をそのまま本番化する。リポ自体は `organization-structure` の Terraform で宣言的に作成（spec §3 ガバナンス要件）。

**Tech Stack:** GitHub（public repo）, Terraform（既存 `repository` モジュール）, renovate preset（JSON）。

**前提:** sample（`docs/superpowers/specs/sample/`）が確定済み。

---

## Task 1: Terraform で canonical-files リポを作成

**Files:**
- Create: `<organization-structure>/terraform/repository_canonical-files.tf`

- [ ] **Step 1: モジュール宣言を追加**

`organization-structure/terraform/repository_canonical-files.tf`:
```hcl
module "repository_canonical_files" {
  source = "./modules/repository"

  name        = "canonical-files"
  description = "Canonical common files distributed to repositories by repository-fanout"
  visibility  = "public"
  topics      = ["repository-fanout", "templates", "renovate-config"]

  # ガバナンス：既定で default-branch ruleset（必須レビュー・CODEOWNERS レビュー）が
  # 強制される（module 既定）。誤/悪意マージの伝播を防ぐ（spec §3）。
  default_branch_protection = {
    required_status_checks = []
  }
}
```

- [ ] **Step 2: plan で差分確認**

Run: `cd organization-structure/terraform && terraform plan`
Expected: `module.repository_canonical_files.github_repository.this` などが新規作成として表示

- [ ] **Step 3: PR → レビュー → マージ（apply は on-merge CI / minerva-sama）**

Expected: `bright-room/canonical-files` リポが作成される（auto_init で main あり）

- [ ] **Step 4: Commit（organization-structure 側）**

```bash
git add terraform/repository_canonical-files.tf
git commit -m "feat: add canonical-files templates repository"
```

---

## Task 2: base/ を配置（renovate.json / CODEOWNERS / release.yml / .gitignore / fragment.json）

**Files（canonical-files リポ内）:**
- Create: `base/fragment.json`, `base/files/renovate.json`, `base/files/.gitignore`, `base/files/.github/CODEOWNERS`, `base/files/.github/release.yml`

- [ ] **Step 1: sample の base/ をそのままコピー**

`docs/superpowers/specs/sample/base/` の中身を canonical-files リポのルート `base/` にコピーする。内容（確定済み）：

`base/fragment.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config"],
  "gitignore": ["# OS / editor", ".DS_Store", "Thumbs.db", ".idea/", ".vscode/", "", "# env", ".env", ".env.local"]
}
```
（preset 本体は `bright-room/renovate-config`（構築済み・public）。canonical-files には extends 参照文字列だけを置く）

`base/files/renovate.json`:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [{{renovate_extends}}]
}
```

`base/files/.gitignore`:
```
{{gitignore}}
```

`base/files/.github/CODEOWNERS`:
```
* @{{codeowner}}
```

`base/files/.github/release.yml`: sample と同一（v0 の release.yml.template 相当）。

> 注：`base/files/renovate.json` と `.gitignore` はプレースホルダを含むため、このリポ自身の renovate/git では「テンプレ」として扱う（このリポ自体には配布しない）。

- [ ] **Step 2: Commit**

```bash
git add base
git commit -m "feat: add base fragment (renovate/codeowners/release/gitignore templates)"
```

---

## Task 3: ~~presets/ を配置~~（不要になった）

**2026-07-02 仕様変更により削除**：renovate preset 本体は `bright-room/renovate-config`（構築済み・public、`default.json` + `java/go/terraform/rust/typescript/kotlin.json`）に集約済み。canonical-files に `presets/` は置かない。preset の妥当性検証・ガバナンスは renovate-config リポ側で行う。

---

## Task 4: languages/ を配置

**Files:**
- Create: `languages/terraform/fragment.json`, `languages/typescript/fragment.json`, `languages/typescript/files/.editorconfig`, `languages/java/fragment.json`, `languages/kotlin/fragment.json`

- [ ] **Step 1: sample の languages/ をコピー**（内容は sample と同一）

`languages/terraform/fragment.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config:terraform"],
  "gitignore": ["# terraform", ".terraform/", "*.tfstate", "*.tfstate.*", "crash.log", "*.tfvars"]
}
```

`languages/typescript/fragment.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config:typescript"],
  "gitignore": ["# node", "node_modules/", "dist/", "*.tsbuildinfo", "npm-debug.log*", "pnpm-debug.log*"]
}
```

`languages/java/fragment.json`（java preset が group:springBoot を内包。framework タグは無い）:
```json
{ "renovate": ["github>bright-room/renovate-config:java"] }
```

`languages/kotlin/fragment.json`:
```json
{ "renovate": ["github>bright-room/renovate-config:kotlin"] }
```

（言語を増やす場合：renovate-config に同名 preset を用意し `languages/<lang>/fragment.json` を1つ置くだけ。`go`/`rust` は preset 構築済み）

`languages/typescript/files/.editorconfig`: sample と同一。

- [ ] **Step 2: Commit**

```bash
git add languages
git commit -m "feat: add languages (terraform/typescript/java/kotlin)"
```

---

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

- [ ] **Step 2: Commit**

```bash
git add strategies.json bundles
git commit -m "feat: add strategies.json and bundles/oss"
```

---

## Task 5: このリポ自身のガバナンス & README

**Files:**
- Create: `.github/CODEOWNERS`, `README.md`

- [ ] **Step 1: CODEOWNERS（このリポのレビュー必須化）**

`.github/CODEOWNERS`:
```
* @bright-room/br-maintainers
```
（default-branch ruleset の `require_code_owner_review` と組み合わせ、全変更にレビュー必須。spec §3 ガバナンス）

- [ ] **Step 2: README に役割を明記**

`README.md`: 「repository-fanout の正本。`base`=常時適用、`seeds`=create-only、`languages/<lang>`=言語別（renovate preset は renovate-config 参照）。詳細は repository-fanout の spec/sample 参照。」を記載。

- [ ] **Step 3: Commit & PR**

```bash
git add .github/CODEOWNERS README.md
git commit -m "docs: codeowners and readme for canonical-files"
```

PR を出してレビュー → マージ（ブランチ保護が効いていることを確認）。

---

## Self-Review

- **Spec カバレッジ**：§3 テンプレ構成（base/seeds/languages/bundles + strategies.json・fragment+戦略・ガバナンス）= Task1-5（Task4.5 含む。Task3 は仕様変更で削除）。seeds/ は当面空（spec §9）なので未作成でよい（必要時に追加）。
- **整合**：renovate preset 参照は `github>bright-room/renovate-config(:name)`（別リポ・構築済み・public 必須）。canonical-files 自体のリポ名は worker の `TEMPLATES_REPO` 変数でのみ参照される（fragment.json 内に自己参照なし）。
- **Placeholder**：`{{renovate_extends}}`/`{{gitignore}}`/`{{codeowner}}` は**意図的なテンプレ変数**（fanout が描画。renovate.json は新規作成時のみ、gitignore/CODEOWNERS は managed-block の中身）。それ以外の TODO は無し。
