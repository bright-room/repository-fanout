# テンプレ専用リポ サンプル構成（自己完結 profile 方式）

「テンプレ専用リポ（仮称 `bright-room/common-files`）」が**こういう中身になる想定**を実ファイルで示したもの。設計ドキュメント §3 の具体化。本番ではテンプレ専用リポの**ルート**に置く。

## 設計方針：1 profile = 1 自己完結ディレクトリ

profile の全貢献（配布ファイル＋renovate 等の合成設定）を**そのディレクトリ1か所**に集約する。中央の renovate 専用マップは持たない。配布物やツールが増えても profile の定義は分散しない。

```
common-files/                          （= テンプレ専用リポのルート）
├── base/                              # 全リポに常時適用される暗黙の profile
│   ├── profile.json                   #   非ファイル貢献の宣言（renovate extends 等）
│   └── files/                         #   常時配布されるファイル（sync）
│       ├── renovate.json              #     {"extends": [{{renovate_extends}}]} ← fanout が描画
│       └── .github/
│           ├── CODEOWNERS             #     * @{{codeowner}}
│           └── release.yml
├── profiles/                          # 宣言された profile の時だけ適用
│   ├── terraform/
│   │   └── profile.json               #   renovate preset を1つ足す（配布ファイルなし）
│   ├── springboot/
│   │   └── profile.json               #   renovate 組み込み preset だけ（group:springBoot）
│   └── typescript/
│       ├── profile.json               #   renovate preset を足す
│       └── files/
│           └── .editorconfig          #   ★ typescript リポにだけ配るファイルの例
├── presets/                           # renovate preset 本体（renovate が extends で取得）
│   ├── default.json
│   ├── terraform.json
│   └── typescript.json
└── examples/                          # （サンプル）fanout が各対象リポに書く最終 renovate.json
    ├── no-profile-repo.renovate.json
    ├── terraform-repo.renovate.json
    ├── terraform-typescript-repo.renovate.json
    ├── java-springboot-repo.renovate.json
    └── typescript-java-springboot-repo.renovate.json
```

### profile.json の役割

`files/` に置けない「合成が必要な貢献」だけを宣言する。今は renovate と gitignore：

```json
// profiles/terraform/profile.json
{ "renovate": ["github>bright-room/common-files//presets/terraform"] }
```

将来 renovate 以外で profile ごとの合成が要るツールが出たら、**キーを足すだけ**：

```jsonc
{
  "renovate": ["github>bright-room/common-files//presets/typescript"],
  "editorconfig": { "...": "..." }   // 例：将来こういう拡張ができる
}
```

→ 「renovate 専用の中央マップ」も「profile 定義の分散」も無い。**配布ファイルを足すだけなら `files/` に置くだけで fanout 改修も不要。**

## fanout の描画ルール

ある対象リポ（宣言 profiles = `P`）に対して：

1. **配布ファイル** = `base/files/**` ∪ （各 `p ∈ P` の `profiles/p/files/**`）。
   - 同一パスを複数 profile が出したら**衝突＝設定エラー**（1パス=1提供元）。
2. **renovate.json** = `base/files/renovate.json` の `{{renovate_extends}}` を描画。
   - `extends = base.profile.json.renovate ++ (各 p の profile.json.renovate を宣言順に連結)`、重複は先勝ちで除去。
3. **`{{var}}` 置換**（`{{codeowner}}` 等）は manifest の `vars` 由来。

### renovate extends の合成例

| repo の profiles | 最終 extends | 追加で配られる files |
|---|---|---|
| `[]` | `[default]` | base のみ |
| `["terraform"]` | `[default, terraform]` | base のみ |
| `["typescript"]` | `[default, typescript]` | base + `.editorconfig` |
| `["java","springboot"]` | `[default, "group:springBoot"]` | base のみ |
| `["terraform","typescript"]` | `[default, terraform, typescript]` | base + `.editorconfig` |
| `["typescript","java","springboot"]` | `[default, typescript, "group:springBoot"]` | base + `.editorconfig` |
| `["kotlin","ktor"]` | `[default]` | base のみ（両 profile dir は profile.json で renovate 空 or 未配置） |

`examples/` が renovate.json の最終形。`java` は profile.json で renovate を足さない（素のテンプレでよい）、`springboot` だけが `group:springBoot` を足す。

### 順序・上書き

- **順序 = base → `profiles` 配列の宣言順**。renovate を足さない profile はスキップ。
- **重複エントリは先勝ち**で1つに。
- renovate は extends を上から順にマージし**後が前を上書き**。「共通 → 言語固有」の順なので、言語固有が `default` を上書きできる（意図通り）。profile 同士でキーが衝突したら宣言順で後ろが勝つ。

## 配布ファイルの2種類：static と composed

| 種類 | 仕組み | 例 |
|---|---|---|
| **static** | `files/` に置いたファイルをそのままコピー（sync） | `.github/release.yml`, `profiles/typescript/files/.editorconfig` |
| **composed** | `base/files/` にプレースホルダ入りテンプレを置き、各 `profile.json` の貢献を fanout が合成して描画 | `renovate.json`（`{{renovate_extends}}`）, `.gitignore`（`{{gitignore}}`） |

composed は「1ファイルに複数 profile が寄与したい」ケース用。renovate は `extends` というネイティブ合成があるが、**`.gitignore` にはネイティブ合成が無い**ので、この composed 機構が効く。

### .gitignore の例（composed）

- `base/files/.gitignore` = `{{gitignore}}`（プレースホルダのみ）。
- 各 `profile.json` に `gitignore`（行の配列）を宣言。
  - `base`：OS/エディタ/env など全リポ共通。
  - `terraform`：`.terraform/`, `*.tfstate` …
  - `typescript`：`node_modules/`, `dist/` …
- 描画：`{{gitignore}}` = `base.gitignore` ++ （各宣言 profile の `gitignore` を宣言順に連結）。重複行は先勝ちで除去。

| repo の profiles | 出力 .gitignore |
|---|---|
| `[]` | base のみ（`examples/no-profile-repo.gitignore`） |
| `["terraform"]` | base + terraform（`examples/terraform-repo.gitignore`） |
| `["terraform","typescript"]` | base + terraform + node（`examples/terraform-typescript-repo.gitignore`） |

→ 新しい合成ファイル（.gitignore）の追加は、fanout の **型付きレンダラレジストリに1エントリ足す**だけ（`base/files/` にプレースホルダ＋`profile.json` に貢献キー＋連結/dedup/シリアライズ規則）。汎用文字列置換では済ませない（誤レンダリング・インジェクション防止）が、renovate と同じ型に乗るので追加は最小。

> **単純な「全リポ共通の固定 .gitignore」でよいなら**、composed にせず `base/files/.gitignore` に**プレースホルダ無しの実ファイル**を置けば static として全リポへ配られる（profile 別パターンが要らない場合はこちらが簡単）。

### 注意：対象リポが既に .gitignore を持つ場合

`.gitignore` は各リポが独自に育てがち。composed/static いずれも **fanout が `.gitignore` 全体を所有（sync）= 既存の独自エントリを上書きする PR**が出る（破壊ではなく PR レビュー越し）。運用方針は2択：

- **全集中管理**：ignore ルールは全部テンプレ側で持ち、リポ独自エントリは置かない（MVP はこれ）。
- **managed ブロック方式（将来）**：`# >>> fanout >>>` 〜 `# <<< fanout <<<` の管理ブロックだけ fanout が更新し、ブロック外のリポ独自エントリは温存。リポが自由に追記できる。必要になったら composed の描画方式を差し替えるだけで導入可能。

## 補足

- profile は「言語/FW」に限らず任意の **capability タグ**でよい（例 `profiles/npm-published/`, `profiles/has-pages/`）。
- preset 本体は安全側で `.json`（renovate は `.json5` も解釈可だが、ホスト preset は `.json` が無難）。
- テンプレ専用リポは **public 必須**（各リポの renovate が extends で preset を取得するため）。
- `terraform.json` の `terraform.enabled` は、現状 `organization-structure/renovate.json` に直書きの `terraform` ブロックを profile 側へ分離した例。
