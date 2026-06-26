# repository-fanout 設計レビュー（Codex 粗探し / 日本語訳）

> 対象: `2026-06-26-repository-fanout-design.md` および `sample/`
> レビュー実施: 2026-06-26（Codex）
> ステータス: **反映済み（A＋B を spec に反映、C は MVP 外として明記）— 2026-06-26**

各指摘は spec（`2026-06-26-repository-fanout-design.md`）へ反映済み：A（設計変更）と B（文言）は §3/§4/§5/§6/§7/§9/§11/§16 に、C（MVP 外）は §5/§6/§16-6 に明記。詳細は末尾トリアージ方針を参照。

---

## 1. 正しさ / ロジックの穴

### 1-1. installation と KV アカウントの突き合わせが未定義 — **HIGH**
- 箇所: §4 リコンサイル動作, §7 アカウントの突き合わせ
- 問題: 突き合わせが「`installation.account.login` と KV キーの照合」としか書かれていない。KV にあるアカウントに chloe-chan の installation が無い場合、または installation はあるが対象リポがそのインストールに含まれていない場合の挙動が未定義。
- リスク: リポが黙ってスキップされるのに CI は成功扱いになり、配布されたとユーザーが誤解する。
- 推奨: installation アクセスが無いアカウント/リポはアカウント単位の hard failure として扱い状態を表面化。可能なら installation 非カバーのアカウントの `/sync` は拒否。

### 1-2. KV の manifest が古いまま残りうる — **HIGH**
- 箇所: §3 manifest の生成・保存タイミング, §11 項目10
- 問題: KV を「最新の manifest」とみなすが、更新は apply 成功＋POST 後だけ。apply 失敗・スキップ、`terraform output` が古い/空だと KV は古いまま。
- リスク: 削除済みリポに PR が出続け、新規リポには出ず、profile 変更も後続 sync 成功まで反映されない。
- 推奨: manifest にバージョン/ソース SHA/apply 実行 ID を持たせ、空 manifest を拒否、apply/sync 失敗を可視的にブロックまたはアラート。

### 1-3. 並行 `/sync` が後勝ちで古いものが新しいものを上書き — **HIGH**
- 箇所: §6 トリガー, §3 manifest 保存先
- 問題: 並行 POST が暗黙に「後勝ち」。世代番号・コミット SHA・compare-and-set の契約が未定義。
- リスク: 古い CI 実行が新しい manifest を上書きしうる（リトライ・並行マージ時に特に）。
- 推奨: 単調増加するソースリビジョンのメタデータを含め、アカウントごとに古い書き込みを拒否。

### 1-4. PR/ブランチのライフサイクルが「オープン PR」しかカバーしていない — **MEDIUM**
- 箇所: §5 PR の振る舞い
- 問題: 固定ブランチが存在するが PR が closed/merged/force-push/削除、または古い base を指す場合の挙動が未定義。
- リスク: リコンサイル失敗、閉じた作業の予期せぬ復活、ブランチ状態の曖昧化。
- 推奨: ブランチのライフサイクルを定義（merged 後は削除/再作成、closed 後は PR 再作成、ref 競合を明示処理）。

### 1-5. 未知 profile の扱いが曖昧（タイポが黙って劣化） — **MEDIUM**
- 箇所: §3 配布物の導出ルール, sample README の `["kotlin","ktor"]` 例
- 問題: 未知/存在しない profile ディレクトリの扱いが曖昧。sample は「黙って何も寄与しない」を示唆するが、本編は profile を「リポの素性の宣言」と位置づけ。
- リスク: Terraform の profile 名タイポが黙って base のみ配布に劣化。
- 推奨: 未知 profile は（no-op として明示列挙されない限り）バリデーションエラーに。

### 1-6. 孤児ファイル掃除なしの運用帰結が書ききれていない — **LOW**
- 箇所: §5 削除（孤児ファイル掃除）は当面スコープ外
- 問題: クリーンアップがスコープ外と明記されているが運用帰結が不足。
- リスク: リポが manifest から外れたり profile 削除後も管理ファイルが永久に残る。
- 推奨: 「無視・掃除なし」を意図的ランタイム挙動として明記し、将来クリーンアップモードを別途追加。

---

## 2. セキュリティ

### 2-1. `/sync` にリプレイ防御が無い — **HIGH**
- 箇所: §6 トリガー, §7 認証・マルチアカウント
- 問題: 共有シークレットのみで、timestamp・nonce・本文署名・TTL が無い。
- リスク: キャプチャしたリクエストで古い manifest を再送し KV を巻き戻せる。
- 推奨: 本文＋timestamp の HMAC、短い時刻ズレ窓の強制、可能なら nonce 再利用拒否。

### 2-2. 認可がアカウントに紐づかない — **HIGH**
- 箇所: §6 トリガー, §7 App 秘密鍵・kick 共有シークレット
- 問題: 共有シークレットを持てば、どのアカウントキーにも manifest を POST できる。
- リスク: CI シークレット1つの漏洩で、chloe-chan がカバーする全アカウントのターゲティングを汚染。
- 推奨: アカウント別シークレット、または `account`・ソースリポ・コミット SHA を束ねた署名付きクレーム。

### 2-3. テンプレリポ（public・SoT）のガバナンス未定義 — **HIGH**
- 箇所: §3 テンプレ専用リポ構成, §11 項目11
- 問題: ブランチ保護/レビュー要件が未定義。
- リスク: `common-files` への悪意ある/誤マージが PR 経由で多数のリポに任意内容を伝播。
- 推奨: ブランチ保護・CODEOWNERS・必須レビュー・必須ステータスチェックを課す。

### 2-4. KV 汚染の影響範囲が限定されていない — **HIGH**
- 箇所: §4 状態は KV の manifest のみ
- 問題: KV 侵害時、攻撃者操作の account/repo/profile/vars がリコンサイルに供給される。
- リスク: 意図しないリポ/アカウントへの PR、CODEOWNERS 等への変数注入。
- 推奨: KV manifest を installation アクセス＋許可アカウントのアローリストで検証、保存前署名またはソース来歴保持。

### 2-5. App 権限が機能記述のみで最小スコープになっていない — **MEDIUM**
- 箇所: §7 GitHub App の役割
- 問題: chloe-chan の権限が正確な App スコープで書かれていない。
- リスク: 必要以上に広い write/admin 権限の付与。
- 推奨: 最小権限を明記（Metadata: read、Contents: read/write、Pull requests: read/write。Checks/Issue ラベル等は使う場合のみ）。

---

## 3. GitHub API 固有

### 3-1. ref 更新の競合処理が未定義 — **HIGH**
- 箇所: §4 `blob → tree → commit → ref → PR`, §5 固定ブランチ
- 問題: base SHA チェックと、処理中に対象/fanout ブランチが変わった場合の競合挙動が必要。
- リスク: 更新喪失、PR 作成失敗、古い default ブランチ基のコミット。
- 推奨: コミット直前に default ブランチ SHA を読み、条件付きで ref 更新、409 時は差分取り直してリトライ。

### 3-2. セカンダリレート制限の具体的な並行制御が無い — **HIGH**
- 箇所: §4 レート制限の注記, §4 親 Workflow の step.sleep
- 問題: 並行数バジェット・バックオフ上限・共有スロットルが無い。ステップ単位リトライだけでは子 Workflow 間でバースト増幅。
- リスク: セカンダリ制限で fanout 全体が停滞、または失敗の嵐。
- 推奨: グローバル/installation 単位の並行数制限と、`Retry-After` 尊重の指数バックオフ。

### 3-3. CODEOWNERS の opt-out 機構が無い（base 常時適用と矛盾） — **MEDIUM**
- 箇所: §3 CODEOWNERS の可変性
- 問題: 「複雑な CODEOWNERS は base を使わない」が、base が暗黙の常時適用 profile であることと矛盾。manifest に opt-out が無い。
- リスク: 独自 CODEOWNERS が必要なリポが base 全体を放棄せず opt-out できない。
- 推奨: ファイル単位 opt-out、profile 除外、または CODEOWNERS を必須 base から分離。

### 3-4. preset 参照がテンプレリポ名をハードコード（リポ名未決） — **LOW**
- 箇所: sample `profiles/*/profile.json`, §12 テンプレリポ名 未決
- 問題: sample の extends が `github>bright-room/common-files//presets/...` をハードコードだが、リポ名は未決。
- リスク: 後でリネームすると生成 `renovate.json` が全部壊れる。
- 推奨: 実装前にリポ名確定、または preset の owner/repo をレンダラ変数に。

---

## 4. Terraform / CI 固有

### 4-1. `terraform output` の空/失敗時挙動が未定義 — **HIGH**
- 箇所: §3 Terraform 設定例, §3 manifest の生成・保存タイミング
- 問題: 「No outputs found」・空出力・古い state の場合の挙動が未定義。
- リスク: CI が不正/空データを POST、または POST スキップで KV が古いまま無自覚に残る。
- 推奨: `fanout_manifest` 不在/空なら CI を hard fail、POST 前にスキーマ検証。

### 4-2. POST 失敗時のリトライが未定義（唯一のトリガーが落ちる） — **MEDIUM**
- 箇所: §6 fire-and-forget
- 問題: CI は 200/202 後に終了するが、POST 失敗時のリトライが未定義。
- リスク: 一時的エラーで MVP 唯一のトリガーが落ちる。
- 推奨: CI にバックオフ付きリトライ、`/sync` 未受理なら workflow 失敗。

### 4-3. Cron 不在による staleness 上限が曖昧 — **MEDIUM**
- 箇所: §6 MVP は on-demand のみ, §14 UC4 将来
- 問題: 取りこぼし kick・ドリフトが修復されない。認識済みだが上限が曖昧。
- リスク: CI 失敗や手動編集後、無期限に誤った状態のまま。
- 推奨: MVP の許容 staleness を定義、Cron 前に手動リプレイ/runbook を用意。

### 4-4. 手動モジュール集約の漏れ — **LOW**
- 箇所: §3 Terraform 設定例, 実装メモ
- 問題: 手動でのモジュール集約がボイラープレート。
- リスク: `_fanout_manifest.tf` への追加忘れで、作られたリポが fanout に管理されない。
- 推奨: `for_each` 化、または repository モジュールに対する manifest カバレッジ生成/検証。

---

## 5. 運用 / 可観測性のギャップ

### 5-1. ロギング/メトリクス/アラート/状態参照が無い — **HIGH**
- 箇所: §4 リコンサイル動作, §6 fire-and-forget
- 問題: 状態エンドポイント・PR/コメントサマリ契約も無い。
- リスク: HTTP 202 後の失敗が運用者から見えない。
- 推奨: run/アカウント/リポ単位の状態出力、run 参照手段、workflow 失敗アラート。

### 5-2. リトライ意味論が曖昧 — **HIGH**
- 箇所: §4「各ステップ独立リトライ + バックオフ」
- 問題: 最大試行回数・リトライ可能コード・冪等キー・poison message の扱いが未定義。
- リスク: 恒久エラーの無駄リトライ、非冪等ステップによるブランチ/PR 重複。
- 推奨: リトライ表を定義、リトライ前に全 write ステップを冪等に。

### 5-3. 部分 fan-out のリカバリ未定義 — **MEDIUM**
- 箇所: §4 親/子 Workflow 設計
- 問題: 50 個中 20 個失敗時の次アクションが不明。
- リスク: 「全部やり直し/失敗だけ/待つ」を判断できない。
- 推奨: run 結果を保存し、失敗リポだけの再試行をサポート。

### 5-4. Workflows 成熟度リスクのフォールバックが弱い — **MEDIUM**
- 箇所: §8 バージョン固定
- 問題: ピン留めと「定期確認」だけ。
- リスク: 製品/API 変更で壊れた時の運用フォールバックがほぼ無い。
- 推奨: 同じ core を使う手動リコンサイル経路、または dry-run CLI。

---

## 6. 仕様不足 / 矛盾 / YAGNI

### 6-1. `.gitignore` が MVP か例示か不明 — **MEDIUM**
- 箇所: §9 配布物（MVP）, sample `.gitignore` 一式
- 問題: MVP の表は renovate/CODEOWNERS/release のみだが、sample には composed `.gitignore` が含まれる。
- リスク: 実装者が必須か例示か判断できない。
- 推奨: `.gitignore` を MVP か将来/sample-only か明示。

### 6-2.「composed はコード分岐ゼロ」は楽観的 — **MEDIUM**
- 箇所: §3 composed files, sample README「コード分岐は増えない」
- 問題: プレースホルダごとにシリアライズ規則・エスケープ・順序・検証が必要。
- リスク: 将来の composed ファイルが汎用置換器で誤って/危険にレンダリング。
- 推奨: 小さくても「型付きの貢献/レンダリングのレジストリ」を定義。

### 6-3. README「今は renovate だけ」と sample（gitignore あり）の不一致 — **LOW**
- 箇所: sample README, sample profile.json 群
- 推奨: 文言を「renovate と gitignore」に更新。

### 6-4. エンドポイント/KV キー設計の後回しが認証に影響 — **LOW**
- 箇所: §12 未決事項
- 問題: パス・KV キー設計はセキュリティ・リプレイ防止・アカウント分離に影響。
- 推奨: 認証関連の規則は「実装詳細」から出し、コーディング前に定義。

---

## トリアージ方針（Claude 提案）

### A. 今 spec に反映すべき（設計判断が変わる）
- `/sync` 認証強化：HMAC＋timestamp＋アカウント紐づけ（2-1, 2-2, 6-4）
- manifest の世代管理／空拒否／後勝ち防止（1-2, 1-3, 4-1）
- PR ブランチのライフサイクル定義（1-4, 3-1）
- テンプレリポのブランチ保護・レビュー必須（2-3）
- App 最小権限の明記（2-5）
- 未知 profile はエラー化（1-5）
- ref 更新 409 リトライ＋並行数制限・`Retry-After`（3-1, 3-2）
- リトライ表と最低限の可観測性（5-1, 5-2, 5-3）
- KV 検証（installation/アローリスト）（2-4, 1-1）

### B. 文言修正だけ
- `.gitignore` を MVP か例示か明記（6-1）
- README「今は renovate だけ」→「renovate と gitignore」（6-3）
- composed「コード分岐ゼロ」→「型付きレジストリ」に表現緩和（6-2）
- preset の owner/repo をレンダラ変数化 or リポ名先行確定（3-4）

### C. MVP 外と明記すれば足りる
- 孤児ファイル掃除（1-6）
- Cron / staleness 上限（4-3）＋手動リプレイ runbook 1行（4-2 も runbook で補完）
- Workflows フォールバック CLI（5-4）
