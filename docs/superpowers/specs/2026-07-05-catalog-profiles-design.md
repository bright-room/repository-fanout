# canonical-files カタログ / プロファイル再設計(v3)

- 日付: 2026-07-05
- status: ドラフト(ブレスト決着済み。実装プラン未着手)
- 前提: [v2 設計](2026-07-04-repository-fanout-v2-design.md)。本書は v2 の reconcile 基盤(削除追従・KV 配布記録・PR ライフサイクル・OIDC・Workflows)を**変更しない**。変更対象は「望ましい状態の導出」(canonical-files の構造と core の resolve 層)のみ。

## 1. 目的

現行 v2 では「何をどう管理しているか」の宣言が 4 箇所に分散している:

| 情報 | 現行の所在 |
|---|---|
| どのファイルを配るか | `files/` ディレクトリ一覧(暗黙) |
| どう管理するか | 特殊なものだけ `strategies.json`。それ以外は「書いてなければ replace」という暗黙デフォルト |
| マージの意味論 | core の TS コード(`renderGitignore` / `{{gitignore}}` / `{{renovate_extends}}` のハードコード配線) |
| 配布条件 | base / languages / bundles のディレクトリ構造 |

このため「合成されるファイル」(gitignore 型・renovate 型)を 1 つ増やすたびに core の型・描画関数・resolve の配線を修正し、Worker を再デプロイする必要がある。

v3 はこれを次の 2 宣言 + テンプレート集約に一本化する:

- **catalog.json**(中央カタログ): 全管理ファイルの「どう管理するか」の唯一の宣言
- **profiles/*/contributes.json**: 各 profile が「何を寄与するか」(純データ)
- **templates/**: 全ファイル本文(Liquid テンプレート)の集約置き場

到達目標: **新しい管理ファイルの追加が、テンプレートリポ内の宣言 + テンプレート + データ追加だけで完結する**(Worker の TS 修正・再デプロイ不要)。TS 修正が残るのは「新しい reconcile 意味論そのもの」の追加時のみ(意図的な残し。v2 D 系決定と同じくコードで守る領域)。

## 2. 完了条件(Definition of Done)

1. canonical-files が catalog.json / profiles / templates 構成に移行し、既存配布物(.gitignore / renovate.json / CODEOWNERS 等)の描画結果が v2 と意味的に同一
2. gitignore 型の新規合成ファイルを「catalog 1 エントリ + テンプレート 1 枚 + contributes データ」だけで追加できることを実証(Worker 変更なし)
3. mise.toml の `[tools]` 管理(TOML 構造マージ)が新規に配布され、リポ独自キー・`[tools]` 外セクションを破壊しない
4. 削除追従・exclude・KV 配布記録が v2 spec §5 の挙動のまま成立(既存テストの意味論を維持)
5. Terraform 側が `fanout = { languages, bundles, contents, exclude }` 形へ移行

## 3. 決定事項一覧(ブレスト 2026-07-04〜05)

| # | 決定 | 根拠 |
|---|---|---|
| C1 | 「どう管理するか」= 中央カタログ、「何を寄与するか」= profile、に分離 | mode を軸ごとに書けると同一パスで衝突する。管理方法は 1 箇所で見えるべき |
| C2 | base / languages / bundles をテンプレリポ側では **profile に統一** | 3 者の違いは「選ばれ方」だけで、寄与の仕組みは同一。bundles の「配る/配らない だけ」という中途半端さを解消 |
| C3 | replaced / create-only の本文も **全て template 化**。profiles 配下に files/ を置かない | profile を純データに保つ(ユーザー決定) |
| C4 | templates/ は**フラット**(配布先パスのミラー構造にしない)。使用テンプレートは contributes.json の `template` キーで指定し、**それが配布トリガーを兼ねる** | catalog のキーが既にパスなので二重にパス構造を持たない(ユーザー決定)。空寄与 `{}` の羅列問題も同時に解消 |
| C5 | テンプレートエンジンは **LiquidJS** | インタープリタ実装で Cloudflare Workers の eval 禁止と両立。Nunjucks は実行時コンパイルが `new Function` 依存のため除外 |
| C6 | 構造化フォーマット(json / yaml / toml)の managed は**マーカーではなく managed_paths + 構造マージ** | 「構造化できるものをマーカーで管理したくない」(ユーザー決定)。extends-field の一般化 |
| C7 | TOML は全文パース → 構造マージ → 正準再描画。**書き換え発生時のコメント・フォーマット正規化を許容**(no-op 判定は構造比較) | JS に format-preserving な TOML エディタが無い。行指向編集(flat 限定)は将来の `[settings]` 等への拡張性で劣る。ユーザー受け入れ済み |
| C8 | mise の `"npm:xxx"` キーは quoted key として正準描画 | smol-toml 系で標準対応。JSON 側は通常のキー文字列 |
| C9 | tf 側は `languages` / `bundles` / `contents`(vars 後継)を維持し、resolver 内部で `profiles = ["base"] + languages + bundles` に畳む | tf 側で「languages 必須 / bundles opt-in」のバリデーション UX を残す。内部は統一 |
| C10 | カタログ不在・catalog 未登録パスの配布・template 衝突は fail fast | strategies.json 不在 fail fast(v2)と同じ思想。暗黙デフォルトの廃止 |
| C11 | `${{ ... }}` を含むファイル(GitHub Actions 等)用に catalog `"raw": true`(Liquid 描画スキップ)を用意 | Liquid が `${{ secrets.X }}` 内の `{{ }}` を変数展開して空文字化する footgun の回避 |

## 4. canonical-files の新構造

```
canonical-files/
├── catalog.json                     # C1: 中央カタログ
├── templates/                       # C3/C4: フラット。名前は自由
│   ├── gitignore.liquid
│   ├── codeowners.liquid
│   ├── release.yml.liquid
│   ├── pull-request-template.liquid
│   ├── issue-bug-report.liquid
│   ├── issue-feature-request.liquid
│   ├── issue-config.liquid
│   ├── contributing.liquid
│   └── security.liquid
└── profiles/                        # C2: データのみ
    ├── base/contributes.json        # 常時適用
    ├── typescript/contributes.json
    ├── go/contributes.json
    ├── java/contributes.json
    ├── kotlin/contributes.json
    ├── python/contributes.json
    ├── rust/contributes.json
    ├── terraform/contributes.json
    └── oss/contributes.json
```

`strategies.json` / `base/fragment.json` / `languages/*/` / `bundles/*/` / `seeds/` は廃止(移行は §9)。

### 4.1 catalog.json

(例は抜粋。実際は ISSUE_TEMPLATE 3 種・pull_request_template 等、配布する全ファイルを列挙する)

```jsonc
{
  "files": {
    ".gitignore":         { "file_type": "text", "mode": "managed" },
    ".github/CODEOWNERS": { "file_type": "text", "mode": "managed" },
    "renovate.json": {
      "file_type": "json",
      "mode": "managed",
      "managed_paths": { "extends": { "merge": "array" } }
    },
    "mise.toml": {
      "file_type": "toml",
      "mode": "managed",
      "managed_paths": { "tools": { "merge": "table" } }
    },
    ".github/release.yml":              { "file_type": "yaml",     "mode": "replaced" },
    ".github/pull_request_template.md": { "file_type": "markdown", "mode": "replaced" },
    "CONTRIBUTING.md":                  { "file_type": "markdown", "mode": "create-only" },
    "SECURITY.md":                      { "file_type": "markdown", "mode": "replaced" }
  }
}
```

フィールド仕様:

| フィールド | 意味 |
|---|---|
| `file_type` | `text` \| `markdown` \| `json` \| `yaml` \| `toml`。managed 時のマージ実現方式を決める(§6)。text/markdown は等価(可読性のための区別) |
| `mode` | `replaced`(全文追従)\| `create-only`(初回のみ作成)\| `managed`(一部のみ管理) |
| `managed_paths` | mode=managed かつ構造化 file_type で必須。管理するトップレベルパスとマージ種別(`array` \| `table`)。text の managed はマーカーブロック方式のため不要 |
| `raw` | true でLiquid 描画をスキップし逐語コピー(C11)。省略時 false |

検証(fail fast、C10):

- catalog.json 不在 → エラー(strategies.json 不在 fail fast の後継)
- contributes.json が catalog 未登録のパスを宣言 → エラー
- mode=managed かつ file_type が構造化なのに managed_paths 不在 → エラー

### 4.2 profiles/*/contributes.json

配布先パスをキーとし、値は寄与オブジェクト。`template` は予約キー:

- **`template` の宣言 = そのパスの配布トリガー + 本文テンプレートの指定**
- テンプレート描画ファイル(text/markdown、および replaced/create-only 全般)は、選択された profile のうち**ちょうど 1 つ**が `template` を宣言すること。0 個=エラー、2 個以上=衝突エラー(現行 path collision 検出の後継)
- managed-json/toml/yaml はテンプレート不要(寄与データ → 構造マージで直接生成)。データ寄与があれば配布トリガーになる
- `template` 以外のキーは全てデータとして扱い、選択 profile 分を**宣言順(base → languages 宣言順 → bundles 宣言順)に連結**してテンプレート/マージへ渡す

例(base):

```jsonc
{
  ".gitignore": {
    "template": "gitignore.liquid",
    "sections": [
      { "comment": "JetBrains IDEs", "ignores": [".fleet/", ".idea/", "*.iws", "*.iml", "*.ipr"] },
      { "comment": "OS", "ignores": [".DS_Store", "**/.DS_Store", "Thumbs.db"] }
    ]
  },
  ".github/CODEOWNERS":   { "template": "codeowners.liquid" },
  "renovate.json":        { "extends": ["github>bright-room/renovate-config"] },
  ".github/release.yml":  { "template": "release.yml.liquid" }
}
```

例(typescript):

```jsonc
{
  ".gitignore": {
    "sections": [
      { "comment": "node / typescript", "ignores": ["node_modules/", "dist/", "coverage/", "*.tsbuildinfo", "*.log"] }
    ]
  },
  "renovate.json": { "extends": ["github>bright-room/renovate-config:typescript"] },
  "mise.toml":     { "tools": { "node": "22.12.0", "pnpm": "10", "npm:prettier": "3.3.2" } }
}
```

例(oss):

```jsonc
{
  ".gitignore":      { "sections": [{ "comment": "OSS artifacts", "ignores": ["*.sarif"] }] },
  "CONTRIBUTING.md": { "template": "contributing.liquid" },
  "SECURITY.md":     { "template": "security.liquid" }
}
```

## 5. 描画パイプライン(LiquidJS)

テンプレートに渡すコンテキスト:

| 変数 | 内容 |
|---|---|
| `contributions` | 選択 profile の寄与データを宣言順に連結したもの(配列キーは concat、`template` キーは除外) |
| `contents` | tf 側 `fanout.contents`(リポ個別値。現行 vars の後継) |
| `repo` / `account` | 配布先リポ名・アカウント名(参考情報) |

規約:

- **strict モード**: 未定義変数の参照はエラー(LiquidJS `strictVariables` / `strictFilters`)。現行 `assertNoUnresolvedPlaceholders`(kukv PR#63 再発防止)の後継。壊れた内容を黙って配らない
- カスタムフィルタは core に登録(現時点で `cross_dedupe` のみ: セクション横断 dedupe 初出優先 + 空セクション削除)。**フィルタ追加は TS 変更**だが、汎用部品なのでファイル追加のたびには増えない想定
- 静的ファイルはタグなしの Liquid(= 素のテキスト)。`raw: true` 指定時は描画そのものをスキップ(C11)

例(templates/gitignore.liquid):

```liquid
{%- assign sections = contributions.sections | cross_dedupe: "ignores" -%}
{%- for s in sections -%}
### {{ s.comment }} ###
{% for line in s.ignores %}{{ line }}
{% endfor %}
{% endfor -%}
```

## 6. mode=managed の実現(file_type 別)

### 6.1 text / markdown: マーカーブロック(現行踏襲)

テンプレートの描画結果全体を blockContent とし、現行 `applyManagedBlock`(`# >>> repository-fanout managed >>>` 〜)にそのまま渡す。v2 からの変更は「blockContent の作り方」だけ。削除追従・retract(ブロック除去)も現行のまま。

### 6.2 json / yaml / toml: managed_paths + 構造マージ

共通の流れ: 実ファイルをパース → `managed_paths` 配下だけ寄与データでマージ → 再シリアライズ。

| file_type | 実装 | コメント/フォーマット保全 |
|---|---|---|
| json | `JSON.parse` → 編集 → `JSON.stringify(_, null, 2)` | JSON にコメントは無く劣化なし。renovate の `applyExtendsField` で実証済み(整形差異の許容は v2 D14) |
| yaml | `yaml`(eemeli 版)の Document API で対象パスのみ編集 | **コメント保持可能**。pure JS で Workers 互換 |
| toml | `smol-toml` 等でパース → マージ → 正準再描画 | 書き換え発生時はコメント・空行・キー順が正準形に正規化(C7)。**no-op 判定は構造比較**で、意味的無変更ならファイルに触らない |

マージ種別:

- `array`(例: renovate `extends`): 現行 `mergeExtends` の一般化。望ましい値 = 管理エントリ(正準順)++ universe 外のリポ独自エントリ(相対順保持)
- `table`(例: mise `[tools]`): キー単位マージ。管理キーは寄与値で上書き、universe 外のリポ独自キーは温存

universe と retraction(v2 spec §5.2 の一般化):

- universe = **全 profile**(選択有無を問わない)の当該 (path, managed_path) への寄与の和集合。現行の「base∪全 language」の一般化
- 寄与が消えた管理エントリ/キーは削除、universe 外は不可侵 — `mergeExtends` の哲学そのまま
- exclude 時は「寄与ゼロへ収束」(v2 spec §5.5 のまま。managed-text はブロック除去、managed-structured は universe 由来エントリ除去)

制約(fail fast):

- 実ファイルがパース不能 → エラー(RenovateParseError の一般化)
- managed_paths はトップレベルパスのみ(v3 スコープ。ネスト指定は将来拡張)

## 7. core / worker の変更(resolve 層のみ)

- `DesiredEntry` の戦略集合は維持しつつ、`extends-field` を `structured-managed`(file_type + managed_paths を持つ)へ一般化。`managed-block` / `replace` / `create-only` / retract 系はそのまま
- 削除追従・KV 配布記録(v2 spec §5.3)は無変更。replaced / create-only は従来どおり `dist:{account}:{repo}` にハッシュ記録。managed 系は記録不要(宣言の再計算で増減が反映される)の原則も維持
- `TemplateSource` は catalog.json / profiles / templates を読む形にインターフェース刷新(GitHub 経由 / メモリ実装の二系統は維持)
- 依存追加: `liquidjs`, `yaml`, `smol-toml`(いずれも pure JS、Workers 互換を採用条件とする)
- manifest スキーマ: `vars` → `contents` にリネーム。移行期間中は worker が両キーを受理(§9)

## 8. Terraform 側

```hcl
fanout = {
  languages = ["typescript"]
  bundles   = ["oss"]

  contents = {
    codeowner = "@bright-room/platform-team"
  }

  exclude = []
}
```

- resolver 内部で `profiles = ["base"] + languages + bundles` に畳む(C9)。manifest JSON 上も languages / bundles を保持(スキーマ互換を優先し、profile への統合はテンプレリポ側の概念に留める)
- `contents` は現行 `vars` の後継(意味は同一: リポ個別のテンプレート変数)

## 9. 移行計画

配布先リポへの影響を最小化するため、**切替スイッチは canonical-files 側の catalog.json の有無**とする:

1. **P-a: core v3 resolver 実装**(旧 resolver と並存)。catalog.json が存在すれば v3 経路、無ければ現行 v2 経路。全単体テストは新旧両経路で維持
2. **P-b: canonical-files 再構成 PR**。fragment.json / strategies.json / files/ / seeds/ を catalog + profiles + templates へ機械的に変換。**変換の等価性検証**: 全既存リポ宣言(kukv 等)に対し新旧 resolver の DesiredEntry を突合し、意味的同一(描画結果・ハッシュ一致)を CI で確認してから merge。ハッシュが一致すれば KV 配布記録もそのまま連続する
3. **P-c: tf 側 `vars` → `contents` リネーム**(worker は両キー受理のため順序自由)。全アカウント移行後に `vars` 受理を削除
4. **P-d: mise.toml 等の新規 managed ファイル追加**(v3 の実証。DoD-2/3)
5. **P-e: 旧経路(fragment/strategies)コードの削除**

ロールバック: catalog.json を revert すれば v2 経路に即時復帰(P-e まで)。

## 10. テスト戦略

- **等価性テスト(移行時のみ)**: 現行 fragment 構成と変換後 catalog 構成で DesiredEntry が意味的同一(P-b)
- **catalog 検証**: 不在 / 未登録パス / template 0 個・2 個以上 / managed_paths 不備 / 不正 JSON → 全て fail fast
- **Liquid**: strict モードで未定義変数エラー、cross_dedupe の性質(横断 dedupe 初出優先・空セクション削除)、raw スキップ
- **構造マージ**: json / yaml / toml それぞれで「管理エントリ更新・リポ独自温存・universe 由来の削除・no-op(構造比較)・パース不能 fail fast」。toml は quoted key(`npm:xxx`)と正規化挙動を明示的に固定
- **既存 reconcile テストの維持**: managed-block / 削除追従 / exclude / retract は資産をそのまま流用(意味論不変の担保)

## 11. スコープ外(意図的)

- 新しい reconcile 意味論の宣言的追加(コード変更で行う。C 系決定の前提)
- managed_paths のネスト(トップレベルのみ。将来拡張)
- リポが manifest から外れた場合の掃除(v2 D4 のまま残置)
- languages / bundles の manifest スキーマ統合(`profiles: [...]` 化)。tf 側 UX を優先し将来判断
