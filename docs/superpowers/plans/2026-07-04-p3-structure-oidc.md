# P3: structure 連携の OIDC 化+kukv 展開 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) organization-structure の fanout kick を HMAC から OIDC へ書き換え、手動再実行(rekick)ワークフローを追加する。(2) kukv/structure に fanout 連携一式(宣言変数・manifest 出力・kick・rekick)を新設する(spec v2 §6.6 / §7 / D7)。

**Architecture:** どちらも GitHub Actions の OIDC トークン(シークレット不要)で fanout の `POST /sync/{account}` を叩く。**エンドポイントの body 契約は P1 で `{manifest?, repos?}` エンベロープに変わっている**(旧: manifest がボディ直下)ので、送信側もそれに合わせる。revision/sourceCommit は **manifest オブジェクトの中**に入れる(worker の parseManifest は manifest 直下に account/revision/sourceCommit/repositories を要求)。

**Tech Stack:** GitHub Actions YAML + bash + jq + Terraform(kukv 側)

**⚠️ 両タスクとも HOLD PR(P4 の切替ウィンドウまで merge しない)**: 現行デプロイ済み worker は HMAC のみ受け付けるため、新 worker デプロイ前に merge すると on-merge の kick が 401 で fail する。PR 本文に HOLD を明記すること。

**参照(実在確認済みの現行実装)**:
- organization-structure: `.github/scripts/fanout-sync.sh`(HMAC 版)/ `.github/workflows/on-merge.yml`(fanout-sync 呼び出しは 54-60 行目)/ `terraform/modules/repository/variables.tf:193-209`(languages/bundles/fanout_vars)/ `terraform/modules/repository/outputs.tf:16-23`(fanout_entry)/ `terraform/_fanout_manifest.tf`
- kukv/structure: fanout 関連は一切なし(コミット履歴でも0件)。on-merge.yml は 54 行構成で trigger-distribute(v0)呼び出しで終わる
- worker の受信側: `apps/worker/src/index.ts`(OIDC Bearer・エンベロープ・installation 照合)。audience は `https://repository-fanout.bright-room.workers.dev`(wrangler.toml の OIDC_AUDIENCE と完全一致必須)

---

## Task 1: organization-structure — kick の OIDC 化+rekick(ブランチ `feat/fanout-oidc`・HOLD PR)

**Files:**
- Modify: `.github/scripts/fanout-sync.sh`(全面書き換え)
- Modify: `.github/workflows/on-merge.yml`(fanout-sync ステップの env 変更+`id-token: write`)
- Create: `.github/workflows/fanout-rekick.yml`

- [ ] **Step 1: fanout-sync.sh を書き換え**

```bash
#!/usr/bin/env bash
# fanout へ manifest を送る(OIDC 認証・シークレット不要)。apply 成功後に on-merge から呼ぶ。
# body は {manifest: {...}} エンベロープ(repository-fanout spec v2 §6.4)。
set -euo pipefail

: "${FANOUT_URL:?}" "${ACCOUNT:?}" "${GITHUB_SHA:?}"
: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?}" "${ACTIONS_ID_TOKEN_REQUEST_URL:?}"

manifest=$(terraform -chdir=terraform output -json fanout_manifest)
revision=$(date +%s)
body=$(jq -cn --argjson m "${manifest}" --arg rev "${revision}" --arg sha "${GITHUB_SHA}" \
  '{manifest: ($m + {revision: ($rev | tonumber), sourceCommit: $sha})}')

token=$(curl -sS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${FANOUT_URL}" | jq -r .value)

for i in 1 2 3; do
  code=$(curl -sS -o /tmp/fanout-resp -w '%{http_code}' -X POST "${FANOUT_URL}/sync/${ACCOUNT}" \
    -H "Authorization: Bearer ${token}" -H "content-type: application/json" -d "${body}")
  if [ "${code}" = "202" ]; then cat /tmp/fanout-resp; exit 0; fi
  echo "attempt ${i}: HTTP ${code} $(cat /tmp/fanout-resp)"
  sleep $((i * 5))
done
echo "fanout sync failed after 3 attempts" >&2
exit 1
```

**注意**: 現行スクリプトの `terraform output` の呼び出し形(作業ディレクトリ・-chdir の有無)は現行実装に合わせること(on-merge.yml がどのディレクトリで呼んでいるかを確認して同じ形を維持)。revision の付与位置が「body 直下」から「manifest の中」へ変わるのが本質的変更点。

- [ ] **Step 2: on-merge.yml の変更**

- fanout-sync ステップの `env` から `FANOUT_HMAC_SECRET` を削除
- `FANOUT_URL` は org secret 参照(`${{ secrets.FANOUT_URL }}`)をやめ、**平文で** `https://repository-fanout.bright-room.workers.dev` を指定(URL は秘密ではない。org secret への依存を断ち、P4 で secret 自体を撤去できるようにする)
- ジョブ(または workflow)の `permissions` に `id-token: write` を追加(既存の permissions 構成を確認し、最小の位置に。既存キーは維持)

- [ ] **Step 3: fanout-rekick.yml を新規作成**

```yaml
name: fanout-rekick
on:
  workflow_dispatch:
    inputs:
      repos:
        description: "再実行するリポ名(カンマ区切り。空 = アカウント全リポ)"
        required: false
        default: ""
permissions:
  id-token: write
  contents: read
jobs:
  rekick:
    runs-on: ubuntu-latest
    steps:
      - name: rekick (OIDC, stored manifest)
        env:
          FANOUT_URL: https://repository-fanout.bright-room.workers.dev
          ACCOUNT: bright-room
          REPOS: ${{ inputs.repos }}
        run: |
          set -eu
          if [ -n "${REPOS}" ]; then
            body=$(jq -cn --arg r "${REPOS}" '{repos: ($r | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != "")))}')
          else
            body='{}'
          fi
          TOKEN=$(curl -sS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
            "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${FANOUT_URL}" | jq -r .value)
          for i in 1 2 3; do
            code=$(curl -sS -o /tmp/resp -w '%{http_code}' -X POST "${FANOUT_URL}/sync/${ACCOUNT}" \
              -H "Authorization: Bearer ${TOKEN}" -H "content-type: application/json" -d "${body}")
            if [ "$code" = "202" ]; then cat /tmp/resp; exit 0; fi
            echo "attempt ${i}: HTTP ${code} $(cat /tmp/resp)"
            sleep $((i * 5))
          done
          exit 1
```

(manifest なし送信 = KV の保存済み manifest を使用。repos 空 = アカウント全リポ再実行。worker 側 index.ts の仕様と一致)

- [ ] **Step 4: 検証**

- `bash -n` で両スクリプトの構文チェック
- jq のエンベロープ生成をローカルで単体確認:
  `echo '{"account":"bright-room","repositories":{"r":{"languages":[]}}}' | jq -cn --argjson m "$(cat)" --arg rev 123 --arg sha abc '{manifest: ($m + {revision: ($rev|tonumber), sourceCommit: $sha})}'`
  → `{"manifest":{"account":"bright-room","repositories":...,"revision":123,"sourceCommit":"abc"}}` であること(revision/sourceCommit が **manifest の中**)
- actionlint があれば workflow を lint(無ければ省略可)

- [ ] **Step 5: HOLD PR 作成**

タイトル: `ci: fanout kick を OIDC 化+rekick 追加 — ⚠️ HOLD: P4 切替まで merge しない`
本文に必ず: HOLD の理由(新 worker デプロイ前に merge すると on-merge の kick が 401 で fail)・エンベロープ契約の変更・FANOUT_URL/FANOUT_HMAC_SECRET org secret への依存がなくなる旨(secret 撤去は P4)。

---

## Task 2: kukv/structure — fanout 連携一式の新設(ブランチ `feat/fanout-integration`・HOLD PR)

**Files:**
- Modify: `terraform/modules/repository/variables.tf`(languages/bundles/fanout_vars を追加)
- Modify: `terraform/modules/repository/outputs.tf`(fanout_entry を追加)
- Create: `terraform/_fanout_manifest.tf`
- Modify: パイロットリポの定義 1 ファイル(languages 宣言)
- Create: `.github/scripts/fanout-sync.sh`(Task 1 と同一内容。ACCOUNT だけ環境変数で変わる)
- Modify: `.github/workflows/on-merge.yml`(apply 後に fanout-sync ステップ追加+`id-token: write`)
- Create: `.github/workflows/fanout-rekick.yml`(Task 1 と同一。ACCOUNT=kukv)

- [ ] **Step 1: module 変数と output の追加**

organization-structure の実装(`terraform/modules/repository/variables.tf:193-209`・`outputs.tf:16-23`)を kukv の module 構成に合わせて移植する。宣言・説明文はできる限り同一に(2 リポの模倣関係を保つ)。

- [ ] **Step 2: _fanout_manifest.tf の新設**

organization-structure の `terraform/_fanout_manifest.tf` を移植し、`account = "kukv"` に変更。`fanout_modules` には**パイロット 1 リポのみ**を列挙(全リポ展開は P4 の段階展開で行う):
- パイロット = `structure` リポ自身(`languages = ["terraform"]`)。kukv 側のリポ定義ファイル名・module 名は実際の `terraform/repository_*.tf` を確認して合わせる
- fanout_vars.codeowner は個人アカウントの既定(spec: 個人 → アカウント名)なので指定不要(空 map)

- [ ] **Step 3: パイロットリポの宣言**

structure リポの module ブロックに `languages = ["terraform"]` を追加。

- [ ] **Step 4: fanout-sync.sh / on-merge / rekick の配線**

- `fanout-sync.sh` は Task 1 の最終形と**同一ファイル内容**(差分ゼロを保つ。ACCOUNT は workflow の env で渡す)
- `on-merge.yml`: 既存の apply 成功後(v0 の trigger-distribute ステップの後)に fanout-sync ステップを追加。env: `FANOUT_URL=https://repository-fanout.bright-room.workers.dev` / `ACCOUNT=kukv`。permissions に `id-token: write` を追加(既存キー維持)
- `fanout-rekick.yml`: Task 1 と同一で `ACCOUNT: kukv`

**注意**: v0(distribute-initial-files)には触らない(撤去は P4)。terraform の変更は `mise exec -- terraform fmt -check` を通すこと。plan 差分は「output 追加のみ・リソース変更 0」になるはず(org-structure PR#89 の前例と同じ)。

- [ ] **Step 5: 検証+HOLD PR 作成**

- `terraform -chdir=terraform init -backend=false && terraform -chdir=terraform validate`(backend なし検証)
- `terraform fmt -check -recursive`
- HOLD PR 作成(本文: HOLD 理由+「manifest 送信先の worker がデプロイされるまで kick は 401」+パイロットは structure 1 リポで全リポ展開は P4)

---

## 完了条件(P3 の DoD)

1. organization-structure に OIDC 版 kick+rekick の HOLD PR が open(スクリプトのエンベロープ形式が worker の新契約と一致していることをレビューで確認)
2. kukv/structure に連携一式の HOLD PR が open(terraform validate/fmt 合格・パイロット 1 リポ宣言済み)
3. 2 つの fanout-sync.sh が同一内容(乖離ゼロ)
4. どちらも merge されていない(P4 の切替ウィンドウで merge)
