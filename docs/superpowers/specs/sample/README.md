# テンプレ専用リポ サンプル構成（fragment + sync 戦略 / 言語ベース単一軸）

「テンプレ専用リポ（仮称 `bright-room/common-files`）」が**こういう中身になる想定**を実ファイルで示したもの。設計ドキュメント §3 の具体化。本番ではテンプレ専用リポの**ルート**に置く。

## 大原則

**fanout はファイル全体を無条件に所有しない。** ファイルごとに「fanout が管理する断片（fragment）」を描画し、**sync 戦略**に従って実ファイルへ反映する。リポ独自部分（ブロック外・extends 以外のキー・リポが足した extends エントリ）は**不可侵**。

| 戦略 | 対象 | 反映方法 |
|---|---|---|
| **replace** | 既定（`release.yml`、`.editorconfig` 等） | ファイル全体を fragment に収束 |
| **create-only** | `seeds/**` | 無ければ配置、あれば触らない |
| **managed-block** | `.gitignore`、`.github/CODEOWNERS` | `# >>> repository-fanout managed >>>` 〜 `# <<< ... <<<` 間だけ更新 |
| **json-field** | `renovate.json` | JSON パースして `extends` の管理エントリだけ更新 |

戦略はパス→戦略の**型付きレジストリ**（fanout の core）で決まる。テンプレリポ側にメタファイルは不要。

## 設計方針：言語ベース・単一軸（1 language = 1 自己完結ディレクトリ）

リポは **`languages`（構成言語の配列）だけを宣言**する。言語名は **renovate-config の preset 名と 1:1 対応**（java / go / terraform / rust / typescript / kotlin …）。**framework 軸は持たない** — framework 対応（springBoot・Tauri 等）は renovate-config の言語 preset に内包済み（java.json / kotlin.json が `group:springBoot` を extends している）。

言語の全貢献（配布ファイル＋renovate 等の合成貢献）は `languages/<lang>/` に集約し、中央マップを持たない。ディレクトリ内の宣言ファイルは **`fragment.json`**（その単位が寄与する断片の宣言）。

```
common-files/                          （= テンプレ専用リポのルート）
├── base/                              # 全リポに常時適用される言語非依存の単位
│   ├── fragment.json                  #   非ファイル貢献（renovate extends エントリ / gitignore 行）
│   └── files/
│       ├── renovate.json              #     新規作成時テンプレ {"$schema", "extends": [{{renovate_extends}}]}
│       ├── .gitignore                 #     managed-block の中身テンプレ {{gitignore}}
│       └── .github/
│           ├── CODEOWNERS             #     managed-block の中身 `* @{{codeowner}}`
│           └── release.yml            #     replace（ファイル全体を管理）
├── languages/                         # 宣言された language の時だけ適用
│   ├── terraform/
│   │   └── fragment.json              #   { "renovate": ["github>bright-room/renovate-config:terraform"], "gitignore": [...] }
│   ├── typescript/
│   │   ├── fragment.json
│   │   └── files/
│   │       └── .editorconfig          #   typescript リポにだけ配る static ファイル（replace）
│   ├── java/
│   │   └── fragment.json              #   { "renovate": ["github>bright-room/renovate-config:java"] }
│   └── kotlin/
│       └── fragment.json              #   { "renovate": ["github>bright-room/renovate-config:kotlin"] }
└── examples/                          # （サンプル）出力例
    ├── *.renovate.json / *.gitignore  #   ファイルが無いリポへの新規作成時の出力
    └── merge-behavior.md              #   ★ 既存ファイルがあるリポでのマージ before/after
```

> **renovate preset は common-files に置かない。** preset 本体は **`bright-room/renovate-config`**（public 必須・構築済み）。各リポの renovate が `github>bright-room/renovate-config`（=default）／`...:java` の形式で直接解決する。**preset の中身の変更は renovate-config 側で完結し、fanout の再配布は不要**（renovate が次回実行時に取得）。言語名 = preset 名の 1:1 対応だが、extends エントリは fragment.json に**明示宣言**する（規約導出の魔法は使わない）。

### fragment.json の役割

`files/` に静的に置けない「合成が必要な貢献」を宣言する。今は renovate（extends エントリ）と gitignore（セクション＝見出しラベル + 無視パターン。`section_comment` には `#` を書かない — 描画時に `# ` が自動付与される）：

```json
// languages/terraform/fragment.json
{
  "renovate": ["github>bright-room/renovate-config:terraform"],
  "gitignore": [
    { "section_comment": "terraform", "ignores": [".terraform/", "*.tfstate", "..."] }
  ]
}
```

将来 language ごとの合成が要るツールが出たら**キーを足すだけ**。配布ファイルを足すだけなら `files/` に置くだけ（fanout 改修不要）。**言語を増やす**のは `languages/<lang>/fragment.json` を1つ置くだけ（renovate-config に同名 preset を用意）。

## renovate.json（json-field: extends）の描画ルール

1. **管理エントリの導出**：`extends 管理分 = base.renovate ++ (宣言 languages の renovate を宣言順に連結)`、順序保持 dedup。
2. **universe** = base ∪ **全 language**（宣言の有無に関わらず）の renovate 貢献の和集合 = 「fanout が管理するエントリの全集合」。
3. **望ましい extends** = 管理分（正準順） ++ 実ファイルにあった **universe 外のエントリ（リポ独自。相対順保持で後ろに温存）**。renovate は後勝ちマージ＝リポ独自が常に優先。
4. 実ファイルが**ある**：JSON パース → `extends` だけ差し替え。**他キー（packageRules 等）は不可侵**。意味的に同一なら no-op。パース不能（JSON5 等）→ 該当リポ failed（`exclude` で自前管理へ逃がし可）。
5. 実ファイルが**ない**：`base/files/renovate.json` テンプレから新規作成（`$schema` は新規時のみ）。

| repo の languages | 管理分 extends |
|---|---|
| `[]` | `[renovate-config(default)]` |
| `["terraform"]` | `[default, :terraform]` |
| `["java"]` | `[default, :java]`（java preset が springBoot 等を内包） |
| `["kotlin"]` | `[default, :kotlin]`（kotlin preset が kotlinMonorepo/springBoot を内包） |
| `["terraform","typescript"]` | `[default, :terraform, :typescript]` |
| `["java","typescript"]` | `[default, :java, :typescript]`（java リポにフロントエンド追加） |

**技術スタック変更**：`["typescript"]`→`["kotlin"]` なら extends の `:typescript` が `:kotlin` に置き換わるだけの PR。`["java"]`→`["java","typescript"]` なら `:typescript` 追加だけ。リポの他キー・独自エントリは生き残る（→ `examples/merge-behavior.md`）。

## managed-block（.gitignore / CODEOWNERS）の描画ルール

- ブロックの中身 = base テンプレ（`{{var}}` 置換）＋ language 貢献の合成（gitignore はセクションを連結。各セクションは見出しコメント + 無視パターン、セクション間は空行1つで区切る。無視パターンは横断で順序保持 dedup し、除去で空になったセクションは見出しごと省く）。
- **ブロックはファイル先頭**。両形式とも**後勝ち**なので、ブロックより下のリポ独自ルールが常に優先＝fanout はリポの個別指定（CODEOWNERS のパス別ルール、gitignore の `!` 再包含等）を上書きできない。
- 実ファイルにブロックあり→中身だけ差し替え／なし→先頭に挿入（既存内容は下に温存）／ファイルなし→ブロックのみで新規作成。同一なら no-op。

## 順序・上書き（extends 管理分と gitignore 行の合成）

- **順序 = base → `languages` 配列の宣言順**。貢献しない language はスキップ。
- **重複エントリは先勝ち**で1つに。
- renovate の extends は上から順にマージし**後が前を上書き**（共通→言語固有→リポ独自の順）。
- language の**配布ファイル**（`languages/<lang>/files/`）は、複数 language が同じパスを出すと**衝突＝設定エラー**（1パス=1提供元）。
- **未知 language はエラー**（Terraform のタイポが黙って base のみ配布に劣化するのを防ぐ）。

## 補足

- **renovate-config は public 必須**（renovate の preset 解決のため）。common-files・renovate-config ともブランチ保護＋必須レビューを課す（設計 §3 ガバナンス）。
- 将来、言語以外の軸（capability 等）が必要になったら別フィールド/別ディレクトリとして追加する（現時点では持たない）。
