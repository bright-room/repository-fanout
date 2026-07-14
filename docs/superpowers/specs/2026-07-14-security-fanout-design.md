# セキュリティ配布 + template profile 分離 設計

**日付:** 2026-07-14
**対象リポ:** repository-fanout(エンジン)/ canonical-files(正本)/ repo-policies(新規)/ renovate-config / organization-structure
**背景:** `docs/security-workflow.md`(サプライチェーン・セキュリティ ワークフロー設計レポート)を汎用化し、fanout の配布物として全管理リポへ展開する。あわせて PR/Issue テンプレートを opt-in 配布へ変更する。

---

## 1. 目的と決定事項サマリ

| 論点 | 決定 |
|---|---|
| PR/Issue テンプレの配布 | base から新設の **`template` profile** へ移動(opt-in 化)。既存配布先への bundle 付与は**しない**(次回同期で削除 PR が出るのは意図どおり) |
| セキュリティ対策の配布先 | **base**(全 fanout 対象)。層1 workflow + pre-commit |
| pre-commit の管理方式 | **managed(キー付き array merge)**。中央必須 hook は常に収束、リポ独自 hook は温存。エンジン拡張が必要(§4) |
| 層2(言語別) | java/kotlin = `security-jvm.yml`、rust = `security-rust.yml` + `deny.toml`。**go/typescript/python/terraform は追加ファイル無し**(ルールは repo-policies の Rego に集約) |
| policy 検査 | **conftest(OPA/Rego)+ 事実収集スクリプト**。ポリシーは独立リポ `bright-room/repo-policies` で一元管理し、workflow は実行時に main を参照 |
| action 参照 | digest ピン + `# vX.Y.Z` コメントで配布。canonical-files の renovate customManager で中央更新。renovate-config に ignorePaths を追加し配布先での更新合戦を防止 |
| 不採用 | CodeQL Default Setup(terraform 管理不可)/ harden-runner(private 有償)/ SARIF upload(private は GHAS 必須)/ OWASP dependency-check(NVD API key 運用が重い)/ govulncheck(OSV で十分、ノイズ増なら `--call-analysis=go` を検討)/ dependency-verification(Central immutable 前提で費用対効果が悪い) |

### 配布対象と言語(2026-07-14 時点)

| リポ | 言語宣言 | 可視性 |
|---|---|---|
| bright-room/repository-fanout | typescript | public |
| bright-room/endpoint-gate | java | public |
| bright-room/idem | go | public |
| bright-room/mindstock | kotlin | public |
| kukv/structure | terraform | **private** |
| kukv/dotfiles | (なし) | public |
| kukv/herdr-plugin-github-dash | (なし) | public |

Free プラン検証済み: Dependabot alerts / dependency graph / dependency-submission API は全リポ無料。Actions は private(structure)のみ 2,000分/月 の枠内。SARIF / CodeQL / harden-runner を落としたことでプラン依存は消えた。

> 注記: herdr-plugin-github-dash は Go リポだが `languages` 未宣言のため層2 go 対策(現状なし)や go の gitignore 寄与が届かない。languages 宣言の追加は本設計のスコープ外(別途判断)。

---

## 2. canonical-files の変更

### 2.1 `template` profile 新設

`profiles/template/contributes.json` を新設し、base から以下4エントリを**移動**する(catalog.json は変更なし):

- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/bug_report.yaml`
- `.github/ISSUE_TEMPLATE/feature_request.yaml`
- `.github/ISSUE_TEMPLATE/config.yml`

配布先は `fanout.bundles = ["template"]` で opt-in する。既存7リポには付与しないため、次回同期で(fanout 配布時のまま未改変なら)削除 PR が出る。`.github/release.yaml` は base に残す。

### 2.2 catalog.json 追加エントリ

```json
".github/workflows/security.yml":      { "file_type": "yaml", "mode": "replaced", "raw": true },
".github/workflows/security-jvm.yml":  { "file_type": "yaml", "mode": "replaced", "raw": true },
".github/workflows/security-rust.yml": { "file_type": "yaml", "mode": "replaced", "raw": true },
"deny.toml":                           { "file_type": "toml", "mode": "create-only" },
".pre-commit-config.yaml": {
  "file_type": "yaml",
  "mode": "managed",
  "managed_paths": { "repos": { "merge": "array", "key": "repo" } }
}
```

workflow は GH Actions の `${{ }}` を含み得るため全て `raw: true`(Liquid 描画スキップ、spec v3 C11)。

### 2.3 profile 寄与

- **base**: `security.yml`(template トリガー)+ `.pre-commit-config.yaml` の `repos` 寄与(template 無し。ファイル不在時は正準生成)
- **java / kotlin**: 両 profile が同名 template `security-jvm-workflow.liquid` を宣言(同名複数宣言は合法。mise.toml と同パターン)
- **rust**: `security-rust-workflow.liquid` + `deny.toml`(create-only、テンプレート `deny.toml.liquid`)

pre-commit の base 寄与(rev は実装時に最新へ):

```json
".pre-commit-config.yaml": {
  "repos": [
    { "repo": "https://github.com/gitleaks/gitleaks", "rev": "v8.x", "hooks": [{ "id": "gitleaks" }] },
    { "repo": "https://github.com/sirosen/texthooks", "rev": "0.x", "hooks": [{ "id": "forbid-bidi-controls" }] }
  ]
}
```

**制約(設計ガードレール):** 中央配布する `repos` エントリに `repo: "local"` を**入れてはならない**。識別キーが `repo` のため、配布先が自前で持つ local hook(golangci-lint 等)を管理対象と誤認して潰す。lint/fmt 系 hook も配布しない(言語・時期でツールが変わりメンテ負荷になるため。セキュリティ専用)。

### 2.4 security.yml(層1・全リポ共通)の構成

トリガー: `pull_request` / `push: main` / 週次 `schedule`。トップレベル `permissions: {}`、各 job に最小権限。concurrency で同一 ref の旧実行をキャンセル。

| job | 内容 | 権限 |
|---|---|---|
| `hidden-unicode` | anti-trojan-source(npx)でコード + AI 設定ファイル(CLAUDE.md, .cursorrules 等)の不可視 Unicode / Trojan Source を検査 | contents: read |
| `secrets` | **gitleaks バイナリ直接実行**(fetch-depth: 0)。gitleaks-action は Org 利用にライセンスキーが必要なため使わない | contents: read |
| `sca` | osv-scanner-action で `-r ./`。`--config` は付けない(リポ直下の osv-scanner.toml は自動検出されるため、repository-fanout 既存の ignore ポリシーも生きる) | contents: read |
| `workflow-audit` | zizmor をオフラインモードで実行し **exit code で fail**(SARIF upload なし) | contents: read |
| `policy` | 自リポ + `bright-room/repo-policies`(main)の2重 checkout → collect-facts で facts.json 生成 → conftest test | contents: read |

repository-fanout 自身の既存 `security.yml`(OSV のみ)はこの汎用版に置き換わる。

### 2.5 security-jvm.yml(java / kotlin)

| job | 内容 | トリガー | 権限 |
|---|---|---|---|
| `wrapper-validation` | gradle/actions/wrapper-validation で wrapper jar のチェックサム検証 | pull_request + push main | contents: read |
| `dependency-submission` | gradle/actions/dependency-submission で解決済み依存グラフを送信 → Dependabot alerts が検知(NVD key 不要・Free で全機能) | push main | contents: write(このジョブのみ) |

背景: endpoint-gate / mindstock は Gradle lockfile 未コミットで OSV から依存が見えない。dependency-submission が即日カバレッジを作る(merge 後の警報)。PR 時点ブロックが欲しくなったら lockfile 導入(§7 後続タスク)。

### 2.6 security-rust.yml + deny.toml(rust)

cargo-deny(EmbarkStudios/cargo-deny-action)で `advisories` / `bans` / `sources` を検査。OSV との差分は sources(取得元レジストリ許可制)・bans・yanked 検知。`deny.toml` は create-only で最小構成を配布(リポ側で自由に育てる)。現時点で rust 宣言リポは無いが、宣言した時点で自動配布される。

### 2.7 renovate customManager(canonical-files)

配布 workflow 内の `uses: owner/repo@<40桁SHA> # vX.Y.Z` を更新するため、canonical-files の renovate.json に regex customManager を追加(`templates/*.liquid` 対象、datasource=github-tags + digest)。pre-commit の `rev` (contributes.json 内)も同様に customManager で追従させる。

---

## 3. repo-policies(新規リポ、bright-room、public)

「プロジェクト設定がセキュリティ前提を満たしているか」の静的検査を一元管理する。**ルール追加・変更はこのリポだけで完結し、fanout の再配布は不要**(workflow は main を参照)。

```
repo-policies/
├── policy/*.rego          # conftest ポリシー(言語別ルールは facts に応じて条件発火)
├── scripts/collect-facts  # 事実収集(ファイル存在、git check-ignore、package.json 抜粋 → facts.json)
└── .github/workflows/ci.yml  # conftest verify(Rego ユニットテスト)
```

初期ルールセット:

| 条件(facts) | ルール |
|---|---|
| package.json が存在 | `packageManager` が `pnpm@` 始まりでないと violation。`yarn.lock` / `package-lock.json` / `npm-shrinkwrap.json` が存在したら violation(`kotlin-js-store/yarn.lock` は除外) |
| kotlin-js-store/ が存在(KMP) | `kotlin-js-store/yarn.lock` が git 管理外(check-ignore に該当)なら violation |
| pyproject.toml 等が存在 | `uv.lock` / `poetry.lock` のいずれも無ければ violation |
| *.tf が存在 | `.terraform.lock.hcl` が git 管理下に無ければ violation |
| settings.gradle(.kts) が存在 | `gradle.lockfile` が無ければ violation — **初期は無効(コメントアウト)**。lockfile 導入(§7)完了後に有効化 |

main 参照のトレードオフ: ポリシー更新が即全リポへ効く反面、侵害時の波及も即時。canonical-files と同一信頼域として **branch protection(必須レビュー)を掛ける**ことで受容する。

リポ作成は organization-structure の tf(`repository_repo-policies.tf`)で行う。

---

## 4. repository-fanout エンジン拡張: キー付き array merge

### 4.1 動機

`merge: "array"` は文字列専用(文字列自身が識別キー)。pre-commit の `repos` はオブジェクト配列のため、実ファイルとの突き合わせ(中央エントリの更新・リポ独自エントリの温存)に**識別キーの宣言が必要**。寄与データの profile 横断マージ(`mergedData()` の配列 concat)は既存のまま動く。

### 4.2 仕様

- `managed_paths.<key>` に任意フィールド `key: string` を追加。`merge: "array"` でのみ有効(`table` との併用はエラー)
- `key` 指定時、エントリの同一性は `entry[key]`(**文字列のみ**。非文字列・非オブジェクトは「判定不能」としてリポ独自扱い)で判定する
  - **universe** = 全 profile の寄与エントリの key 値集合(`universeFor` を拡張)
  - **マージ結果** = 管理エントリ(寄与の正準順)++ key 値が universe 外のリポ独自エントリ(相対順保持)。同一 key は管理側が勝つ(rev 更新が収束)
  - 実ファイル側で key フィールドを持たないエントリは**リポ独自として温存**(「曖昧は残す」原則、spec v2 §5.4 と同じ倒し方)
  - 寄与側エントリが key フィールドを欠く場合は**エラー**(fail fast)
- `key` 未指定時の挙動は現行と完全一致(文字列 array。後方互換)
- no-op 判定(`normalizedCurrent`)はオブジェクト配列の deepEqual 比較に拡張

### 4.3 変更ファイル

- `packages/core/src/domain/model/canonical/catalogEntry.ts` — `key` の受理・検証
- `packages/core/src/domain/model/reconcile/structuredDocument.ts` — キー付きマージ、正準化、no-op 判定
- `packages/core/src/domain/model/canonical/profiles.ts` — `universeFor` の key 値収集
- 各対応テスト + `apps/cli` の validate は catalog パーサ経由で自動追従

worker への影響: `ManagedPathSpec` は plain data として KV / Workflow を素通りするため、core 差し替え + worker デプロイのみ。

---

## 5. renovate-config / organization-structure の変更

- **renovate-config** `default.json`: `ignorePaths` に `.github/workflows/security*.yml` を追加。配布先 renovate が fanout 管理 workflow を digest ピンし直して update 合戦になるのを防ぐ(digest 更新は canonical-files 側 customManager が担う)
- **organization-structure**: `repository_repo-policies.tf` 新設。JVM リポ(endpoint-gate / mindstock)の `vulnerability_alerts`(Dependabot alerts)が有効か module 実装を確認し、無ければ追加

---

## 6. ロールアウト順序

依存関係があるため順序厳守:

1. **repository-fanout**: エンジン拡張(§4)を merge → worker デプロイ(canonical-files の CI は engine main を checkout して validate するため先行必須)
2. **organization-structure**: repo-policies 作成 → ポリシー・collect-facts を実装、branch protection 設定
3. **renovate-config**: ignorePaths 追加
4. **GitHub App**: 両インストール(bright-room / kukv)に **workflows: write 権限**を追加・承認(無いと workflow ファイルの push で child run が失敗する)
5. **canonical-files**: §2 の変更を merge → fanout-sync 発火 → 全リポへ配布 PR

## 7. 後続タスク(本設計のスコープ外)

- endpoint-gate / mindstock への Gradle dependency locking 導入(リポ個別作業。renovate の gradle lockfile 更新対応済み)→ 完了後 repo-policies の gradle.lockfile ルールを有効化 → OSV が PR 時点で JVM 依存を検査可能になる
- herdr-plugin-github-dash の `languages = ["go"]` 宣言追加の判断
- テンプレ配布を継続したいリポへの `bundles = ["template"]` 付与(必要になった時点で)

## 8. 実装時の検証項目

- [ ] anti-trojan-source: glob 不一致時の exit code(AI 設定ファイル走査を fail にできるか)
- [ ] zizmor: オフラインモードの実行方法と exit code 挙動
- [ ] osv-scanner: リポ直下 osv-scanner.toml の自動検出(repository-fanout の既存 ignore が生きること)
- [ ] texthooks `forbid-bidi-controls` / gitleaks の pre-commit hook id・最新 rev
- [ ] conftest バイナリの取得方法とピン(release バイナリ or docker)
- [ ] gradle/actions(wrapper-validation, dependency-submission)の最新版と digest
- [ ] renovate regex customManager: github-tags datasource での digest 更新動作

## 9. テスト方針

- エンジン: キー付き merge のユニットテスト(管理エントリ更新 / リポ独自温存 / key 無しエントリ温存 / 寄与側 key 欠落エラー / no-op / 後方互換)を core に追加。cli validate 用 fixture にキー付き managed ファイルを追加
- canonical-files: 既存 CI(cli validate)が catalog 検証 + 全 profile 描画スモークを実行。raw template の描画スキップも検証対象
- repo-policies: conftest verify で Rego ルールごとの正例・反例テスト
- 配布 E2E: canonical-files merge 後、dry-run(runbook の rekick 手順)で 1 リポ分の差分を目視確認してから全体へ
