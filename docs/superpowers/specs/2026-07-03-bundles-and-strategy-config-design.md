# bundles 軸・strategies.json・Discord 失敗通知 設計

2026-07-03。バックログ「コード変更を減らす育成路線」の設計。メイン設計ドキュメント
`2026-06-26-repository-fanout-design.md`（以下「本体 spec」）に対する変更仕様であり、
実装時に本体 spec の該当セクション（§3 データモデル・§16-4 可観測性ほか）を本書の内容で追随更新する。

## 1. 目的・背景

- **(a) 戦略のデータ駆動化**: `resolve.ts` の `STRATEGY_REGISTRY`（パス→戦略のハードコード）を
  common-files 側の設定に外部化し、「どのパスにどの戦略を割り当てるか」をコード変更なしで変えられるようにする。
- **(b) 宣言軸の歪み解消**: 現状 `languages` 軸に `oss` のような非言語束を置けてしまう（動的発見・検証なしのため
  動くが命名が歪む）。opt-in 束を **`bundles` 第2軸**に分離し、`languages` には本物の言語だけが残るようにする。
  `languages` の改名はしない。
- **(c) 失敗の可視性**: (a) で fail fast を増やすため、失敗を Discord Webhook で通知する。

タイミング: worker 未デプロイ・KV データなし・P3/P4 未着手のため、スキーマ変更に互換対応は不要（今が最安）。

## 2. bundles 軸の追加

### common-files 構造（本体 spec §3「テンプレ専用リポ構成」への追加）

```
common-files/
├─ strategies.json          # §3 で新設
├─ base/                    # 全リポ共通（変更なし）
├─ languages/<lang>/        # 言語束（変更なし。本物の言語のみ）
├─ bundles/<name>/          # NEW: opt-in 束（oss 等）。languages と同一構造
│   ├─ fragment.json        #   renovate / gitignore 寄与（FragmentManifest そのまま）
│   └─ files/...            #   配布ファイル
└─ seeds/                   # 初期シード（変更なし）
```

### manifest スキーマ（本体 spec §3 manifest への追加）

```jsonc
"repositories": {
  "my-repo": {
    "languages": ["java"],          // 必須（現行どおり）
    "bundles": ["oss"],             // NEW: 省略可。省略時 []
    "vars": {},                     // 省略可（現行どおり）
    "exclude": []                   // 省略可（現行どおり）
  }
}
```

`RepoEntry` に `bundles: string[]` を追加。`parseManifest` は `exclude`/`vars` と同じ optional 扱い
（未指定→`[]`、型不正→エラー）。

### resolve の挙動

- **fragment マージ順序**: base → languages（宣言順）→ bundles（宣言順）。
  renovate extends の正準順・gitignore セクション順もこの順。
- **universe**: base ∪ 全 languages ∪ 全 bundles（管理対象判定の母集合に bundles の寄与も含める）。
- **検証**: 未知の bundle 名は `unknown bundle: <name>` でエラー（unknown language と同じ fail fast）。
- **ファイル収集**: `bundles/<b>/files/` を収集グループに追加。既存のパス衝突検出がそのまま適用される
  （同一配布先パスを languages と bundles が両方提供したらエラー）。
- **戦略**: bundles 由来のファイルも strategies.json（§3）の対象。seeds ではないので既定は replace。

### TemplateSource の一般化

`listLanguages()` / `languageExists()` を軸パラメータ付きに一般化する:

```ts
type FragmentAxis = "languages" | "bundles";
listNames(axis: FragmentAxis): Promise<string[]>;      // <axis>/ 直下のディレクトリ名一覧
nameExists(axis: FragmentAxis, name: string): Promise<boolean>;
```

worker / cli の実装は同じ tree 走査の prefix 違いなので共通化できる。
`readFragmentManifest` は既に dir 文字列を取るため変更不要（`"bundles/oss"` を渡す）。

### CLI / Terraform

- CLI: `--bundles oss,...` フラグを追加（`--languages` と同形式・省略可）。
- P4（別リポ）: repository モジュールに `bundles` var を追加し manifest 出力に含める。
  **P4 プラン文書**（`2026-06-26-p4-terraform-integration.md`）に追記する。

### sample

`docs/superpowers/specs/sample/` に `bundles/oss/` の最小例
（fragment.json + files/ の 1〜2 ファイル）を追加する。

## 3. strategies.json（戦略のデータ駆動化）

common-files ルートに置く、**配布先パス → 戦略名**のフラットな map。

```json
{
  "renovate.json": "extends-field",
  ".gitignore": "managed-block",
  ".github/CODEOWNERS": "managed-block"
}
```

- **許可値**: `extends-field` | `managed-block` の2つのみ。それ以外の値はパス名入りのエラー。
- **既定動作は不変**: map に無いパスは replace、`seeds/` 由来は常に create-only（strategies.json の適用外）。
- **キーは配布先パス**（`base/files/` 等の prefix を剥がした後のパス）。
- **fail fast**: strategies.json が common-files に存在しない場合、resolve はエラーで停止する。
  理由: 静かに空扱いにすると `renovate.json` が replace に降格し、全対象リポの extends を
  全文上書きする PR が量産されるため。空オブジェクト `{}` は「特殊戦略なし」の明示宣言として許容する。
- **新しいマージ意味論（4種目の戦略）の追加は今後もコード変更**。設定でできるのは既存戦略の割り当てのみ。

実装:

- core に `parseStrategyConfig(raw: string | null)` を新設（null=ファイル不在エラー・JSON パース・object 検証・値検証を1関数に内包）。
- 読み取りは既存 `TemplateSource.readFile("strategies.json")` を再利用（interface 変更なし）。
  `readFile` が `null` を返したら「存在しない」としてエラー。
- `resolve.ts` の `STRATEGY_REGISTRY` 定数を削除し、読み込んだ設定で置き換える。
- strategies.json 自体は配布物ではない（`base/files/` 等の収集 prefix の外にあるため自然に対象外）。

## 4. Discord 失敗通知

本体 spec §16-4（可観測性）の拡張。RUNS KV への記録だけでは失敗に気づけないため、
リポ単位の失敗を Discord Webhook に通知する。

- **フック位置**: `recordRepoResult(status: "failed")` を書く箇所（parent の installation 欠如／spawn 失敗、
  child の恒久エラー／catch-all）で、記録に続けて通知を送る。
  run 全体の完了を待ち合わせる場所が存在しない（子 Workflow は独立）ため、run 単位の集約はしない。
- **設定**: worker secret `DISCORD_WEBHOOK_URL`。**未設定なら通知をスキップ**（ローカル・テストで必須にしない）。
- **送信**: プレーンテキスト（`{"content": "..."}`）で runId・account/repo・error を含める。
  embed 化は非スコープ（後からペイロード組み立ての変更だけで移行可能）。
- **通知の失敗は握りつぶす**（ログのみ）。通知が reconcile を壊してはならない。
- **既知のトレードオフ**: strategies.json 欠如のような全体障害では対象リポ数ぶん通知が飛ぶ。
  対象は数十リポ規模なので許容し、うるさければ run 単位のデデュープを後付けする。

## 5. エラー処理まとめ

| 事象 | 挙動 |
|---|---|
| 未知の language / bundle 宣言 | resolve がエラー（従来どおり fail fast） |
| strategies.json 不在 | resolve がエラー（fail fast。§3） |
| strategies.json 不正（JSON 不能・未知の戦略値・型不正） | resolve がエラー（パス名入りメッセージ） |
| 配布先パス衝突（bundles 含む） | resolve がエラー（従来どおり） |
| リポ単位の失敗 | RUNS KV に記録 + Discord 通知（§4） |
| Discord 送信失敗 / secret 未設定 | 握りつぶし / スキップ。reconcile に影響しない |

## 6. テスト戦略

- `parseStrategyConfig` 単体テスト: 正常系・`{}`・非 object・非文字列値・未知戦略値。
- resolve: strategies.json 不在で throw／設定に従い戦略が割り当たる（新パスへの managed-block 割当が
  コード変更なしで効く）／bundles の fragment マージ順・universe 寄与・未知 bundle エラー・衝突検出。
- parseManifest: `bundles` 省略時 `[]`・型不正エラー。
- worker: 通知モジュール単体（secret 未設定スキップ・送信失敗握りつぶし）。fetch はモック。
- 既存テストは全て green を維持（bundles 未宣言なら挙動不変）。

## 7. 実装フェーズ

1. **spec 追随**: 本体 spec §3・§16-4 ほかの該当箇所を本書の内容で更新。sample への bundles/oss・
   strategies.json 追加、P3/P4 プラン文書への `bundles`・`strategies.json` 追記もここで行う。
2. **PR1: bundles 軸**（core → worker/cli、TDD）。
3. **PR2: strategies.json 外部化**（core、TDD）。
4. **PR3: Discord 失敗通知**（worker のみ）。

## 8. 非スコープ

- `languages` の改名（bundles 分離により歪みが解消されるため不要と判断）。
- 第3の宣言軸。通知の embed 化・run 単位集約。ManifestStore 抽象化（別バックログ・YAGNI 判断済み）。
