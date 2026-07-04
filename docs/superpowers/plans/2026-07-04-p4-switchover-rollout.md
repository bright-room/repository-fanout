# P4: 切替・v0 撤去・全リポ展開・E2E 証拠 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. ただし Phase A(切替ウィンドウ)は**ユーザーの merge 操作を挟む共同作業**であり、オーケストレーターが直接進行する。

**Goal:** 新 worker(OIDC・削除追従)への切替を無停止で完了し、v0 を撤去し、全リポへ段階展開し、spec §2 の完了条件を**証拠付き**で満たす。

**前提(P1〜P3 の到達点):**
- repository-fanout main = P1(エンジン v2)+P2(validate)込み。デプロイは未実施(本番 worker は旧 HMAC 版のまま稼働中)
- HOLD PR 3本: canonical-files **#5** / organization-structure **#92** / kukv/structure **#62**
- canonical-files は validate 必須チェック稼働中

---

## Phase A: 切替ウィンドウ(オーケストレーター+ユーザー。連続実行・所要 ~30分)

- [ ] **A1. 事前確認**: repository-fanout main を pull・`pnpm -r test` green・`apps/worker` で `mise exec -- wrangler deploy --dry-run` により bindings(MANIFESTS/RUNS/PARENT/CHILD)と vars(TEMPLATES_REPO/OIDC_AUDIENCE)を確認
- [ ] **A2. デプロイ**: `mise exec -- wrangler deploy`。この瞬間から旧 HMAC kick は 401 になる(→ 次の A3〜A4 を速やかに)
- [ ] **A3. 外形疎通**: `curl -X POST .../sync/bright-room`(無トークン)→ 401 / `GET /` → 404
- [ ] **A4. HOLD PR を順に merge(ユーザー)**: ① org-structure #92(merge → on-merge で最初の OIDC kick)→ ② canonical-files #5 → ③ kukv/structure #62(merge → kukv の初 kick+パイロット配布)
- [ ] **A5. 各 merge 後の検証(オーケストレーター)**: on-merge run green(fanout-sync step が 202)・`wrangler workflows instances list --name fanout-parent` で起動確認・kukv/structure に配布 PR が作成される(パイロット実証)・Free プランの CPU 超過エラーが無いこと(run のエラーログ確認)
- [ ] **A6. HMAC 掃除**: `wrangler secret delete SYNC_HMAC_SECRET__bright-room` / `SYNC_HMAC_SECRET___global`。organization-structure-administrator に FANOUT_URL / FANOUT_HMAC_SECRET org secret の撤去 PR(terraform から secret_fanout-*.tf と repository_organization_structure.tf の参照 2 行を削除)
- [ ] **A7. 旧配布 PR の処分**: repository-fanout の旧 PR #17 を close し固定ブランチ `chore/distribute-common-files` を削除(次回 reconcile がまっさらな PR を作り直す)

**ロールバック**: A5 で致命的問題(認可通らない・reconcile が壊れる)が出た場合は `wrangler rollback`(直前バージョンへ)し、HOLD PR の revert は不要(旧 worker は旧 HMAC 送信側とだけ噛み合うため、#92 merge 済みなら #92 を revert)。判断はオーケストレーターが提示・ユーザーが決定。

## Phase B: v0 撤去

- [ ] **B1. organization-structure**: `distribute-initial-files.yml`・`.github/scripts/distribute-initial-files.sh`・`trigger-distribute-for-new-repos.sh`・`.github/templates/`・`.github/config/exclude-repos.json`・on-merge の呼び出しステップを削除する PR
- [ ] **B2. kukv/structure**: 同様の削除 PR(kukv 版は renovate.json 1 ファイル配布)
- [ ] **B3. v0 生成の放置 PR を close**: canonical-files #1・renovate-config #1(コメントで理由明記: v0 生成物であり現行構成と競合)

## Phase C: 段階展開(languages 宣言)

- [ ] **C1. org 第1陣(2〜3リポ)**: languages 宣言を追加する PR → merge → 配布 PR の中身を**全ファイル目視**(ポストモーテム教訓: 代表1つで OK にしない)→ 問題なければ配布 PR を merge
- [ ] **C2. org 残り**: 全12リポ(repository-fanout 除く)へ展開。言語割当は canonical-files P3 時の全39リポ実態調査(memory 記載)を参照
- [ ] **C3. kukv 残り14リポ**: 同様
- [ ] **C4. 各配布 PR のレビュー・merge はユーザー**(fanout は提案するだけ、が原則)

## Phase D: E2E 証拠(spec §2 完了条件の実証。URL を本ファイル末尾に記録)

- [ ] **D1. UC1 初期配布**: C1 のいずれかの配布 PR URL
- [ ] **D2. UC2 正本更新→全リポ**: canonical-files で無害な変更(release.yml のカテゴリ文言等)を merge → global kick → 全対象リポの配布 PR 更新を確認
- [ ] **D3. UC3 宣言変更**: パイロットリポで languages を追加→配布物が増えることを確認
- [ ] **D4. 削除追従(v2 の目玉)**: canonical-files にテスト用ファイル(例: `base/files/.github/FANOUT_TEST.md`)を追加→配布→merge 後、正本から削除→**配布先に削除 PR が出る**ことを実証。改変ケース(配布先で編集してから正本削除→残置+PR 注記+Discord 通知)も 1 リポで実証
- [ ] **D5. 冪等性**: rekick(workflow_dispatch)連打で配布 PR が増えない・変わらないこと
- [ ] **D6. 運用限界の確認**: 上記を通して worker 側に CPU 超過・KV write 超過のエラーが出ていないこと(`wrangler tail` or run 記録)

## Phase E: runbook・ドキュメント整備

- [ ] **E1. `docs/runbook.md`**(repository-fanout): 手動再実行(`gh workflow run fanout-rekick.yml -R <structure repo> -f repos=...` / global は canonical-files の fanout-sync workflow_dispatch)・障害調査(実行から3日以内は `wrangler workflows instances describe`、以降は KV run 記録 90日)・Free プラン予算(全リポ一斉 ~17回/日)・CLI apply(最後の砦)・削除追従の挙動早見(消える条件/残る条件)
- [ ] **E2. docs PR**: P3/P4 プラン+runbook+E2E 証拠を repository-fanout へ(ブランチ docs/p3-plan に積んで PR)
- [ ] **E3. メモリ更新**: repository-fanout-status に完了状態を記録。SESSION_POSTMORTEM のバックログ(A/B 項目)の消化状況を明記
