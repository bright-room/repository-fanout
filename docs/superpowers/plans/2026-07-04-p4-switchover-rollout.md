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

---

## 実施記録(2026-07-04 時点の引き継ぎ)

### 完了済み

- **Phase A 完了**: worker デプロイ(最終 Version cc762d32 = P1+P2+プレースホルダガード+gitignore 見出し `### xxx ###`)。3経路実証(org kick / global kick / kukv kick)。HMAC secrets 削除・org secrets 撤去(admin #51)。DISCORD_WEBHOOK_URL 設定済み(ユーザー)
- **Phase B 完了**: v0 撤去(org #94 / kukv #65)・放置 PR close(canonical #1 / renovate-config #1)
- **計画からの逸脱(良い方向)**: A7(PR#17 の close+作り直し)は不要になった — 新エンジンの再 kick で PR#17 が正しい内容に自動更新され、ユーザーがそのまま merge した
- **切替中に発見・修正した実バグ**: codeowner のアカウント既定が未実装 → `{{codeowner}}` が素通しで配布(kukv #63 初版)。修正: TF 既定注入(kukv #64 / org #93)+エンジンの未置換ガード(rf #22)。教訓: 存在しない既定を計画が思い込みで前提にした
- **混入事故と対処**: rf PR#23 に `.wrangler/`(miniflare ローカル状態・機密なしを確認)が git add -A で混入 → ブランチ履歴を書き直しクリーン化。教訓: **オーケストレーターも明示パスで git add する**
- **E2E 証拠(Phase D の大半)**:
  - UC1 初期配布: kukv/structure PR#63(merged・CODEOWNERS は修正後 `* @kukv`)/ org: repository-fanout PR#17(merged)
  - UC2 正本→全リポ: global kick 202(runId 622441ab-808b-4168-9b8e-8bb4d8dcc50a)。描画変更(gitignore 見出し)が rf#24 / kukv#66 の最小差分 PR として全対象リポへ伝播
  - D5 冪等性・手動再実行: 複数 kick で PR 増殖なし。workflow_dispatch の global rekick 実戦成功(run 28695149164)
  - 配布記録: dist:bright-room:bright-room/repository-fanout に release.yml のハッシュ採用を確認(--remote で実測)
  - D6: 全 Workflow instance が Completed・CPU 超過エラーなし(Free プラン)
  - 認可外形: 無トークン 401 / 偽トークン 401 / GET 404

### 未実施(次セッションへ)

- **Phase C(ユーザー主導・段階展開)**: 下の言語調査表を参照。administrator 管理のメタ4リポは organization-structure の _fanout_manifest.tf に**静的宣言**で載せる(1アカウント=1 manifest=1送信者の不変条件のため。本文 Phase C 参照)
- 既知の軽微課題: canonical-files base/fragment.json の section_comment に typo「JEtbrains」(→ JetBrains)。修正すると全対象リポの .gitignore 見出しに収束 PR が出る

### D4 削除追従のフルサイクル実証(2026-07-04 完了・証拠)

spec §2 完了条件 5 を実リポで実証。全経路が設計(spec v2 §5.4)どおりに動作:

1. **配布**: canonical-files [#8](https://github.com/bright-room/canonical-files/pull/8)(languages/typescript/files/ に FANOUT_TEST_A/B 追加・validate green)→ global kick → rf [#25](https://github.com/bright-room/repository-fanout/pull/25) にテストファイル 2 件が追加され merge。KV `dist:` 記録に両ファイルのハッシュを確認(--remote 実測)
2. **改変の仕込み**: rf [#26](https://github.com/bright-room/repository-fanout/pull/26) で B に 1 行追記(merge)
3. **正本から削除**: canonical-files [#9](https://github.com/bright-room/canonical-files/pull/9)(merge)→ global kick → rf [#27](https://github.com/bright-room/repository-fanout/pull/27):
   - **A(未改変・ハッシュ一致)= 削除が PR に入った**(diff は A の DELETED のみ)
   - **B(改変済み・ハッシュ不一致)= 残置**。PR 本文に「改変されていたため削除せず残置(管理対象から外しました)」注記。子 Workflow の `notify kept` ステップ成功(instance 93a2c49a-510c-47d3-ac07-9a79a1a7e127)
   - KV 記録: B は即時引き渡し(記録から除去)・A は merge 確認まで維持(冪等な再提案のための設計どおり)
4. **掃除の完結**: rf#27 merge 後に rekick(run [28708457730](https://github.com/bright-room/organization-structure/actions/runs/28708457730))→ KV 記録から A が消え `release.yml` のみに(実測)。再配布 PR は立たず固定ブランチも不在=no-op 冪等
5. **後片付け**: 残置された B の手動削除 = rf [#28](https://github.com/bright-room/repository-fanout/pull/28)

### Phase E の進捗(2026-07-04)

- **E1 完了**: `docs/runbook.md` を本ブランチに追加(コミット 6cea741)
- **E2**: 本ブランチ(docs/p3-plan)の PR 化 = この記録の直後に実施
- **E3**: メモリ更新 = docs PR 作成後に実施

### 過去の申し送りの解消状況

- rf #24 / kukv #66(gitignore 収束 PR)→ ユーザー merge 済み
- canonical #7 の global kick → 自動発火し rf #25 として伝播・merge 済み

### Phase C 用: 言語調査結果(scout-langs・2026-07-04・全26リポ・archived/fork なし)

**bright-room(organization-structure 管理)**: aktive-storage=kotlin+oss / aktive-storage-example=kotlin / endpoint-gate=java+oss / idem=go+oss / bright-room=kotlin / mindstock=kotlin / garage-admin-console=kotlin(TSはe2eのみ・LICENSE無くossは保守的に見送り) / br-cluster=python(HCLはPacker・terraform非該当) / skill-test-sandbox=go / br-claude-plugins=[]/ canonical-files=[](自己配布・様子見後) / renovate-config=[]

**bright-room(administrator 管理・静的宣言で)**: organization-structure / organization-structure-administrator / br-cloudflare-terraform / br-cluster-zitadel-terraform — 全て terraform

**kukv(structure 管理)**: treedoc=rust+oss / liberal-ecstasy=typescript,rust / cloud-system-observability-demo=java / spring-boot-sandbox=java / portfolio=kotlin / coap-cbor-demo=go / markitdown-docker=python / bright-room-hatena-blog=[] / dotfiles=[] / os-setup=[] / postgresql-learning=[] / prompt-templates=[] / **template-java-api=java(is_template のため最終陣で単独確認)** / **test-repo=宣言しない(対象外)**
