# P3: テンプレ専用リポ (common-files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正本となるテンプレ専用リポ `bright-room/common-files` を作成し、`base/seeds/profiles/presets` 構成で v0 テンプレ＋renovate preset を配置、ガバナンス（ブランチ保護・必須レビュー）を効かせる。

**Architecture:** 構成は `docs/superpowers/specs/sample/` をそのまま本番化する。リポ自体は `organization-structure` の Terraform で宣言的に作成（spec §3 ガバナンス要件）。

**Tech Stack:** GitHub（public repo）, Terraform（既存 `repository` モジュール）, renovate preset（JSON）。

**前提:** sample（`docs/superpowers/specs/sample/`）が確定済み。

---

## Task 1: Terraform で common-files リポを作成

**Files:**
- Create: `<organization-structure>/terraform/repository_common-files.tf`

- [ ] **Step 1: モジュール宣言を追加**

`organization-structure/terraform/repository_common-files.tf`:
```hcl
module "repository_common_files" {
  source = "./modules/repository"

  name        = "common-files"
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
Expected: `module.repository_common_files.github_repository.this` などが新規作成として表示

- [ ] **Step 3: PR → レビュー → マージ（apply は on-merge CI / minerva-sama）**

Expected: `bright-room/common-files` リポが作成される（auto_init で main あり）

- [ ] **Step 4: Commit（organization-structure 側）**

```bash
git add terraform/repository_common-files.tf
git commit -m "feat: add common-files templates repository"
```

---

## Task 2: base/ を配置（renovate.json / CODEOWNERS / release.yml / .gitignore / profile.json）

**Files（common-files リポ内）:**
- Create: `base/profile.json`, `base/files/renovate.json`, `base/files/.gitignore`, `base/files/.github/CODEOWNERS`, `base/files/.github/release.yml`

- [ ] **Step 1: sample の base/ をそのままコピー**

`docs/superpowers/specs/sample/base/` の中身を common-files リポのルート `base/` にコピーする。内容（確定済み）：

`base/profile.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config"],
  "gitignore": ["# OS / editor", ".DS_Store", "Thumbs.db", ".idea/", ".vscode/", "", "# env", ".env", ".env.local"]
}
```
（preset 本体は `bright-room/renovate-config`（構築済み・public）。common-files には extends 参照文字列だけを置く）

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
git commit -m "feat: add base profile (renovate/codeowners/release/gitignore templates)"
```

---

## Task 3: ~~presets/ を配置~~（不要になった）

**2026-07-02 仕様変更により削除**：renovate preset 本体は `bright-room/renovate-config`（構築済み・public、`default.json` + `java/go/terraform/rust/typescript/kotlin.json`）に集約済み。common-files に `presets/` は置かない。preset の妥当性検証・ガバナンスは renovate-config リポ側で行う。

---

## Task 4: profiles/ を配置

**Files:**
- Create: `profiles/terraform/profile.json`, `profiles/springboot/profile.json`, `profiles/typescript/profile.json`, `profiles/typescript/files/.editorconfig`

- [ ] **Step 1: sample の profiles/ をコピー**（内容は sample と同一）

`profiles/terraform/profile.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config:terraform"],
  "gitignore": ["# terraform", ".terraform/", "*.tfstate", "*.tfstate.*", "crash.log", "*.tfvars"]
}
```

`profiles/springboot/profile.json`（java+Spring 用。kotlin preset は renovate-config 側で springBoot を内包済み）:
```json
{ "renovate": ["group:springBoot"] }
```

`profiles/typescript/profile.json`:
```json
{
  "renovate": ["github>bright-room/renovate-config:typescript"],
  "gitignore": ["# node", "node_modules/", "dist/", "*.tsbuildinfo", "npm-debug.log*", "pnpm-debug.log*"]
}
```

（言語 profile を増やす場合：renovate-config に同名 preset があれば `github>bright-room/renovate-config:<name>` を参照。`java`/`go`/`rust`/`kotlin` は preset 構築済みなので profile ディレクトリを足すだけ）

`profiles/typescript/files/.editorconfig`: sample と同一。

- [ ] **Step 2: Commit**

```bash
git add profiles
git commit -m "feat: add profiles (terraform/springboot/typescript)"
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

`README.md`: 「repository-fanout の正本。`base`=常時 sync、`seeds`=create-only、`profiles/<tag>`=stack 別、`presets`=renovate extends 先。詳細は repository-fanout の spec/sample 参照。」を記載。

- [ ] **Step 3: Commit & PR**

```bash
git add .github/CODEOWNERS README.md
git commit -m "docs: codeowners and readme for common-files"
```

PR を出してレビュー → マージ（ブランチ保護が効いていることを確認）。

---

## Self-Review

- **Spec カバレッジ**：§3 テンプレ構成（base/seeds/profiles・fragment+戦略・ガバナンス）= Task1-5（Task3 は仕様変更で削除）。seeds/ は当面空（spec §9）なので未作成でよい（必要時に追加）。
- **整合**：renovate preset 参照は `github>bright-room/renovate-config(:name)`（別リポ・構築済み・public 必須）。common-files 自体のリポ名は worker の `TEMPLATES_REPO` 変数でのみ参照される（profile.json 内に自己参照なし）。
- **Placeholder**：`{{renovate_extends}}`/`{{gitignore}}`/`{{codeowner}}` は**意図的なテンプレ変数**（fanout が描画。renovate.json は新規作成時のみ、gitignore/CODEOWNERS は managed-block の中身）。それ以外の TODO は無し。
