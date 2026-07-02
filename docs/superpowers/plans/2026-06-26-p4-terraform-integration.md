# P4: Terraform 連携（manifest 生成 + on-merge kick）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** structure リポ（`organization-structure` / `kukv/structure`）の repository モジュールに `languages` / `bundles` / `fanout_vars` を追加し、`fanout_manifest` を出力、on-merge CI で manifest を生成して fanout `POST /sync/{account}`（HMAC 署名）する。

**Architecture:** spec §3・§6・§16-1。manifest は git に置かず、apply 後に CI が `terraform output` で生成し HMAC 署名して fanout へ送信。`terraform output` が空/不在なら CI を hard fail。

**Tech Stack:** Terraform（既存 `repository` モジュール）, GitHub Actions, bash + openssl/jq（HMAC 署名）。

**前提:** P2（worker デプロイ済み・`/sync` 稼働）、P3（common-files 存在）。

---

## Task 1: repository モジュールに languages / fanout_vars を追加

**Files:**
- Modify: `<structure>/terraform/modules/repository/variables.tf`
- Modify: `<structure>/terraform/modules/repository/outputs.tf`

- [ ] **Step 1: 変数を追加**

`modules/repository/variables.tf` に追記:
```hcl
variable "languages" {
  description = "repository-fanout が配布に使うリポの構成言語（renovate-config の preset 名と 1:1）"
  type        = list(string)
  default     = []
}

variable "bundles" {
  description = "言語と独立な opt-in 配布束（oss 等）"
  type        = list(string)
  default     = []
}

variable "fanout_vars" {
  description = "fanout テンプレ置換用の変数（codeowner 等）"
  type        = map(string)
  default     = {}
}
```

- [ ] **Step 2: output を追加（root 集約用）**

`modules/repository/outputs.tf` に追記:
```hcl
output "name" {
  value = github_repository.this.name
}

output "fanout_entry" {
  description = "fanout manifest の1リポ分エントリ"
  value = {
    languages = var.languages
    bundles   = var.bundles
    vars     = var.fanout_vars
  }
}
```

- [ ] **Step 3: validate**

Run: `cd organization-structure/terraform && terraform validate`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add modules/repository/variables.tf modules/repository/outputs.tf
git commit -m "feat: add languages/fanout_vars to repository module"
```

---

## Task 2: root で manifest を集約 output

**Files:**
- Create: `<structure>/terraform/_fanout_manifest.tf`

- [ ] **Step 1: 集約 local + output**

`organization-structure/terraform/_fanout_manifest.tf`:
```hcl
# fanout 配布対象（languages を持つ repo のみ）を集約。
# 注：repo を増やしたらここにも1行追加する（spec §3 実装メモ）。
locals {
  fanout_modules = {
    "endpoint-gate"        = module.repository_endpoint_gate
    "br-cluster"           = module.repository_br_cluster
    # ... 配布対象 repo をすべて列挙 ...
  }

  fanout_repositories = {
    for name, mod in local.fanout_modules :
    name => mod.fanout_entry
    if length(mod.fanout_entry.languages) > 0 || length(mod.fanout_entry.bundles) > 0
  }
}

output "fanout_manifest" {
  value = {
    account      = "bright-room"
    repositories = local.fanout_repositories
    # revision / sourceCommit は CI が付与（Task 4）
  }
}
```

> kukv/structure は `account = "kukv"` で同様に作る。

- [ ] **Step 2: 各 repo モジュールに languages を付与**

例 `repository_endpoint-gate.tf` に追記:
```hcl
  languages   = ["terraform"]
  fanout_vars = { codeowner = "bright-room/br-maintainers" }
```

- [ ] **Step 3: plan で manifest output を確認**

Run: `terraform plan` → `terraform output -json fanout_manifest`（apply 後）で内容確認。
Expected: `{ "account": "bright-room", "repositories": { "endpoint-gate": { "languages": ["terraform"], "bundles": [], "vars": {...} } } }`

- [ ] **Step 4: Commit**

```bash
git add _fanout_manifest.tf terraform/repository_*.tf
git commit -m "feat: aggregate fanout manifest output"
```

---

## Task 3: HMAC 署名 + POST スクリプト

**Files:**
- Create: `<structure>/.github/scripts/fanout-sync.sh`

- [ ] **Step 1: スクリプト**

`.github/scripts/fanout-sync.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
# 必須 env: FANOUT_URL, FANOUT_HMAC_SECRET, ACCOUNT, GITHUB_SHA

ts="$(date +%s)"
# manifest を取得し revision/sourceCommit を付与
manifest="$(terraform -chdir=terraform output -json fanout_manifest)"
if [ -z "$manifest" ] || [ "$manifest" = "null" ]; then
  echo "::error::fanout_manifest output is empty"; exit 1
fi
body="$(echo "$manifest" | jq -c --argjson rev "$ts" --arg sha "$GITHUB_SHA" \
  '. + {revision: $rev, sourceCommit: $sha}')"

# HMAC-SHA256(secret, "<ts>.<body>") を hex で
sig="$(printf '%s.%s' "$ts" "$body" \
  | openssl dgst -sha256 -hmac "$FANOUT_HMAC_SECRET" -hex | sed 's/^.*= //')"

# リトライ付き POST（spec §16-2 / §6）
for attempt in 1 2 3; do
  code="$(curl -s -o /tmp/resp -w '%{http_code}' -X POST "$FANOUT_URL/sync/$ACCOUNT" \
    -H "X-Fanout-Timestamp: $ts" -H "X-Fanout-Signature: $sig" \
    -H "Content-Type: application/json" --data "$body" || true)"
  if [ "$code" = "202" ]; then echo "accepted"; cat /tmp/resp; exit 0; fi
  echo "attempt $attempt: HTTP $code"; sleep $((attempt * 3))
done
echo "::error::fanout /sync not accepted"; cat /tmp/resp; exit 1
```

> `revision` は `ts`（単調増加する epoch 秒）を流用。同一秒の連続マージは稀だが、厳密化が要れば run number 等に変更（spec §16 CAS は `>` 比較なので同値は拒否される点に注意）。

- [ ] **Step 2: 実行権限 & commit**

```bash
chmod +x .github/scripts/fanout-sync.sh
git add .github/scripts/fanout-sync.sh
git commit -m "feat: fanout sync script (hmac sign + post with retry)"
```

---

## Task 4: on-merge CI に kick を組み込む

**Files:**
- Modify: `<structure>/.github/workflows/on-merge.yml`

- [ ] **Step 1: apply 後に fanout-sync を実行する step を追加**

`on-merge.yml` の apply ジョブ末尾に追記:
```yaml
      - name: Trigger fanout sync
        env:
          FANOUT_URL: ${{ vars.FANOUT_URL }}
          FANOUT_HMAC_SECRET: ${{ secrets.FANOUT_HMAC_SECRET }}
          ACCOUNT: bright-room
          GITHUB_SHA: ${{ github.sha }}
        run: bash .github/scripts/fanout-sync.sh
```

> `vars.FANOUT_URL`（例 `https://repository-fanout.<subdomain>.workers.dev`）と `secrets.FANOUT_HMAC_SECRET`（worker の `SYNC_HMAC_SECRET__bright-room` と一致）を repo/org に設定。これらの付与も Terraform（organization-structure-administrator）で管理。

- [ ] **Step 2: テンプレ専用リポ側にも push kick を追加**

`common-files` リポに `.github/workflows/on-merge-kick.yml`:
```yaml
name: fanout-kick
on:
  push:
    branches: [main]
jobs:
  kick:
    runs-on: ubuntu-latest
    steps:
      - name: Kick fanout (all accounts)
        env:
          FANOUT_URL: ${{ vars.FANOUT_URL }}
          FANOUT_HMAC_SECRET: ${{ secrets.FANOUT_GLOBAL_HMAC_SECRET }}
        run: |
          ts="$(date +%s)"; body=""
          sig="$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$FANOUT_HMAC_SECRET" -hex | sed 's/^.*= //')"
          for a in 1 2 3; do
            code="$(curl -s -o /tmp/r -w '%{http_code}' -X POST "$FANOUT_URL/sync" \
              -H "X-Fanout-Timestamp: $ts" -H "X-Fanout-Signature: $sig" --data "$body" || true)"
            [ "$code" = "202" ] && exit 0; sleep $((a*3))
          done
          echo "::error::kick failed"; exit 1
```
（worker 側で `SYNC_HMAC_SECRET___global` を設定。template kick の検証に使用。）

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/on-merge.yml
git commit -m "feat: trigger fanout sync from on-merge"
```

---

## Task 5: kukv/structure へ同様に適用

**Files:**
- Mirror: Task1-4 を `kukv/structure` に適用（`account = "kukv"`、`fanout_vars.codeowner` 既定はアカウント名 `kukv`）

- [ ] **Step 1:** モジュール変数/output 追加（Task1 と同一コード）
- [ ] **Step 2:** `_fanout_manifest.tf`（`account = "kukv"`）
- [ ] **Step 3:** `fanout-sync.sh`（`ACCOUNT=kukv`）+ on-merge step
- [ ] **Step 4:** secrets/vars（`SYNC_HMAC_SECRET__kukv`）を設定
- [ ] **Step 5: Commit**

```bash
git commit -am "feat: fanout integration for kukv/structure"
```

---

## Task 6: E2E 検証

- [ ] **Step 1:** organization-structure で1リポに `languages=["terraform"]` を付けて PR→merge
- [ ] **Step 2:** on-merge CI が `/sync/bright-room` を 202 で受理することを確認
- [ ] **Step 3:** 対象リポに PR（renovate.json/CODEOWNERS/release.yml/.gitignore）が作成されることを確認
- [ ] **Step 4:** 再 merge で **新規 PR が増えない**（CAS で stale 拒否 or no-op）ことを確認

---

## Self-Review

- **Spec カバレッジ**：§3 manifest 生成（terraform output, 空なら fail）=Task2,3 / §6 on-merge kick + CI リトライ=Task3,4 / §16-1 HMAC 署名（ts+body, account 別 secret）=Task3 / template kick=Task4-2 / 多アカウント=Task5。
- **既知の制約（spec §3 実装メモ）**：`_fanout_manifest.tf` の手動列挙は追加忘れリスク → 将来 `for_each` 化 or カバレッジ検証を検討（本 MVP は手動列挙）。
- **整合**：CI の HMAC（`printf '%s.%s' ts body` → SHA256）は worker `signHmac`（`${timestamp}.${body}`）と一致。`account` は manifest.account と URL の両方一致を worker が検証（P2 Task10）。
