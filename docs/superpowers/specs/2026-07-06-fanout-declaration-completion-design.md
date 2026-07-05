# fanout 宣言の完遂 — tf `fanout` グループ化 / exclude / base-only / PR・ISSUE テンプレ(v3 ドラフト未達分)

> status: 設計確定(2026-07-06 ブレストで G1/G2/G3/base-only を MUST として合意)。
> 正本: origin/main の実コード。設計の出所は v3 ドラフト 3 本
> (`catalog-redesign-draft.md` / `v3-overall-structure.md` / `specs/2026-07-05-catalog-profiles-design.md`)。

## 1. 目的・背景

v3(catalog/profiles 再設計)は P-a〜P-e + OSS docs まで本番稼働済み。だが **v3 ドラフトが指定していたのに実装されなかった項目**が残っていた。本 spec はそれを完遂する。

未達の経緯(2026-07-06 判明):

- **G1**: ドラフト §8 / DoD §2.5 は tf を **grouped `fanout = { languages, bundles, contents, exclude }`** と規定していたが、実装は v2 由来の **flat な別変数**(`languages` / `bundles` / `fanout_contents`)を引き継いだまま refactor せず、`exclude` を露出しなかった。DoD §2.5 が字義どおり未達だった。
- **G2**: 配布停止(`fanout.exclude`)は wire(`RepoEntry.exclude` / `parse.ts`)と engine(`derive.ts` の retract)には実装済みだが、**tf 側が output に出さないため設定不能**。
- **G3**: ドラフト catalog / base profile が規定していた **PR テンプレ + ISSUE テンプレ**(`.github/pull_request_template.md` ほか)が catalog / templates / base profile のいずれにも無い(P-b の等価移行は v2 実在ファイルのみを対象にしたため未着手のまま残った)。
- **base-only**: 「languages も bundles も無いリポに base だけ配る」は tf フィルタが弾いて不可能。ドラフトは languages を「必須軸」としていたが、その検証は未実装で、フィルタが黙って落としているだけの中途半端な状態だった。**base-only を可能にする**ことをユーザーが MUST と決定(ドラフトの「languages 必須」意図を上書き)。

## 2. スコープ

### IN(すべて MUST)

- **G1**: tf module(両アカウント)を grouped `fanout` オブジェクト変数へ移行。
- **G2**: `fanout.exclude` を tf output → manifest まで配線。CLI に `--exclude` を追加。
- **G3**: canonical-files に PR/ISSUE テンプレを **base profile** として追加(新規 house-style 本文)。
- **base-only**: `fanout` を設定した=配布対象、`fanout = {}`(profiles 空)= base のみ配布、へフィルタを変更。「languages 必須」を撤廃。

### 本 spec で変更しないもの(スコープ外ではなく、既に main へ取り込まれている方針/決定)

以下は「本 spec が除外した」のではなく、**すでに main で採用済みの方針・決定**であり、本 spec が触る必要がないもの:

- `.github/release.yaml`(.yaml 拡張子)= 意図的変更として main に merge 済み。
- `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` の `.github/` 配下配置 = 意図的に main へ merge 済み。
- `mise.toml` = create-only(2026-07-05 のユーザー決定)。main に反映済み。
- **wire は `languages` / `bundles` / `contents` / `exclude`**(= main が採用している形)。単一 `profiles` リストへの統合は現行の採用方針ではなく、本 spec でも行わない。postmortem E17 の「languages 命名の歪み」も同じ理由で据置。
- engine(core resolve/reconcile)・worker = 既に languages/bundles/contents/exclude 対応・base 常時適用。本 spec の変更(§4〜§7)で触る必要がない。

## 3. 現状(origin/main の実態)

**tf module(`modules/repository`・両アカウント同型)**

```hcl
variable "languages"       { type = list(string); default = [] }
variable "bundles"         { type = list(string); default = [] }
variable "fanout_contents" { type = map(string);  default = {} }
variable "license_holder"  { type = string;       default = "bright-room" }  # kukv は "kukv"

# outputs.tf
output "fanout_entry" {
  value = {
    languages = var.languages
    bundles   = var.bundles
    contents  = merge(contains(var.bundles, "oss") ? { license_holder = var.license_holder } : {}, var.fanout_contents)
    # exclude が無い
  }
}
```

**`_fanout_manifest.tf`(両アカウント)** — 対象判定フィルタ:

```hcl
if length(mod.fanout_entry.languages) > 0 || length(mod.fanout_entry.bundles) > 0
```

**宣言済み**: org `repository-fanout`(`languages=["typescript"]`)/ kukv `structure`(`languages=["terraform"]`)の 2 リポのみ。

**canonical-files origin/main**: catalog は 9 ファイル。base profile が配るのは `.gitignore` / `.github/CODEOWNERS` / `renovate.json` / `.github/release.yaml` の 4 つ。PR/ISSUE テンプレは catalog / templates / base のどこにも無し。

**CLI**: `apps/cli/src/index.ts` は `--languages` / `--bundles` を受けるが `exclude` は `[]` ハードコード(`--exclude` 無し)。

## 4. G1 — tf `fanout` グループ化(両アカウント)

module の flat 3 変数を単一オブジェクトに置換(`license_holder` は module 既定として別変数のまま):

```hcl
variable "fanout" {
  description = "fanout 配布宣言。設定した時点で配布対象(profiles 空 = base のみ配布)"
  type = object({
    languages = optional(list(string), [])
    bundles   = optional(list(string), [])
    contents  = optional(map(string), {})
    exclude   = optional(list(string), [])
  })
  default = null   # 未設定 = 非対象
}
```

output(`fanout == null` なら null。非 null なら 4 キーを出す):

```hcl
output "fanout_entry" {
  value = var.fanout == null ? null : {
    languages = var.fanout.languages
    bundles   = var.fanout.bundles
    contents  = merge(
      contains(var.fanout.bundles, "oss") ? { license_holder = var.license_holder } : {},
      var.fanout.contents,
    )
    exclude = var.fanout.exclude
  }
}
```

既存宣言の移行(意味不変):

```hcl
# repository-fanout.tf
fanout = { languages = ["typescript"] }
# structure.tf(kukv)
fanout = { languages = ["terraform"] }
```

呼び出しパターン:

```hcl
fanout = { languages = ["java"], bundles = ["oss"] }              # 通常
fanout = {}                                                      # base のみ(§6)
fanout = { languages = ["go"], exclude = [".github/CODEOWNERS"] } # 配布停止パス(§5)
```

## 5. G2 — exclude の配線

- §4 の output に `exclude = var.fanout.exclude` を追加(これで tf → manifest まで到達)。manifest `parse.ts` は `exclude`(省略時 [])を既に受理、`derive.ts` が retract 変換を既に実装済み → **engine 変更不要**。
- **CLI**: `apps/cli/src/index.ts` に `--exclude a,b` を追加し、`planRepo` / `applyRepo` の `exclude` へ渡す(現状ハードコード `[]` を置換)。手動経路の穴を塞ぐ。

## 6. base-only 配布

- `_fanout_manifest.tf` のフィルタを変更:

```hcl
# 変更前
if length(mod.fanout_entry.languages) > 0 || length(mod.fanout_entry.bundles) > 0
# 変更後
if mod.fanout_entry != null
```

- 意味: **`fanout_modules` に登録 かつ `fanout` を設定 = 配布対象**。`fanout = {}` は `fanout_entry` が非 null(languages=[]/bundles=[])になるので**対象に入り、base のみが配られる**。
- engine: `Profiles.load(source, [], [])` → `declared = ["base"]` で base 単体を描画(既存挙動)。base-only リポには `.gitignore` / `.github/CODEOWNERS`(default codeowner が入る)/ `renovate.json` / `.github/release.yaml` + §7 の PR/ISSUE テンプレが配られる。
- 「languages 必須」の意図は撤廃(base-only を可能にするため)。wire の `languages: []` は `parse.ts` が既に受理するため engine 変更不要。

## 7. G3 — PR/ISSUE テンプレ(base profile へ追加)

canonical-files に以下を追加。全 fanout 対象リポ(base-only 含む)へ配る:

**catalog.json**(全 `replaced`。命名は release に合わせ `.yaml`):

```jsonc
".github/pull_request_template.md":           { "file_type": "markdown", "mode": "replaced" },
".github/ISSUE_TEMPLATE/bug_report.yaml":      { "file_type": "yaml",     "mode": "replaced" },
".github/ISSUE_TEMPLATE/feature_request.yaml": { "file_type": "yaml",     "mode": "replaced" },
".github/ISSUE_TEMPLATE/config.yaml":          { "file_type": "yaml",     "mode": "replaced" }
```

**templates/**(新規 house-style 本文を書き下ろし): `pull-request-template.liquid` / `issue-bug-report.liquid` / `issue-feature-request.liquid` / `issue-config.liquid`。

**profiles/base/contributes.json**: 上記 4 パスに `template` キーを追加。

- `.github/ISSUE_TEMPLATE/config.yaml` は GitHub の Issue chooser 設定(`blank_issues_enabled` 等)。テンプレの本文は house style で新規作成する(内容は実装計画で確定)。
- **要検証(postmortem #1「何が読むか」)**: これらは GitHub が読む(Issue フォーム / chooser 設定 / PR テンプレ)。`.yaml` 拡張子と `pull_request_template.md`(小文字)を GitHub が確実に認識するかを実装計画で実物確認する。もし `config` だけ `.yml` 必須なら、その 1 ファイルは `.yml` に留める(命名一貫性より「GitHub が読むこと」を優先)。
- **replaced のため既存 PR/ISSUE テンプレを上書き**する。配布 PR は全ファイル目視でレビュー(postmortem #4)。

## 8. wire / engine 不変の確認

本 spec の変更で **manifest スキーマと core は変わらない**:

- `RepoEntry = { languages, bundles, contents, exclude }` は現状のまま。tf はこの 4 キーを `fanout` にまとめて宣言するだけ。
- G1/G2/base-only は tf 出力の形と対象判定の変更のみ → **wire 不変 → worker デプロイ不要**。
- G3 は canonical のデータ追加のみ → **Worker 変更なし(v3 の DoD どおり)**。

## 9. 移行・等価性

- **等価性**: 既存 2 宣言(typescript / terraform)は `fanout = { languages = [...] }` へ書き換え後も `fanout_entry` の値が現状と一致する。`terraform plan` で manifest output 差分ゼロ、`cli validate` の描画一致で担保。
- **順序**: canonical(G3)と tf(G1/G2/base-only)は独立。worker デプロイ不要のため配布無停止。
- **ロールバック**: 各 PR の revert で個別復帰。

## 10. テスト戦略

- **core**: 変更なし。既存テスト(manifest parse で exclude 受理・derive の exclude→retract・profiles の base 常時)がそのまま回帰保護。
- **cli**: `--exclude` の引数パースと `planRepo`/`applyRepo` への伝播をテスト。`validateDir` は G3 で追加した base のテンプレも base-only combo で描画検証。
- **tf(両アカウント)**: `terraform validate` + `fmt`。`terraform plan`/`console` で (a) 既存 2 宣言の `fanout_manifest` output が不変、(b) `fanout = {}` が base-only エントリを生む、(c) `fanout = null`(未設定)がフィルタ除外される、(d) `exclude` が manifest に出る、を確認。
- **canonical(G3)**: `cli validate`(catalog 未登録パス無し・template 衝突無し・全 profile 描画)green。

## 11. 決定事項ログ(2026-07-06)

| # | 論点 | 決定 |
|---|---|---|
| D1 | tf 宣言形 | grouped `fanout = { languages, bundles, contents, exclude }`(ドラフト §8)。flat 変数は廃止 |
| D2 | 対象判定 | `fanout_modules` 登録 + `fanout != null`。`length()` フィルタ廃止 |
| D3 | base-only | `fanout = {}` で base のみ配布。「languages 必須」撤廃 |
| D4 | exclude | tf output に露出 + CLI `--exclude` 追加。engine は既存実装を利用 |
| D5 | G3 本文 | 新規 house-style を書き下ろし(既存リポからの流用でなく) |
| D6 | G3 命名 | `.yaml`(release.yaml に合わせる)。ISSUE_TEMPLATE も `.yaml` |
| D7 | wire | `profiles` 統合はしない。`languages/bundles/contents/exclude` 維持 |

## 12. 後続作業(本 spec の対象外だが、この後にやる)

- **Phase C(fanout 宣言の全リポ展開)**: 本 spec 完了後に、新しい `fanout = {}` / `fanout = { languages = [...] }` 形で再開する。

(`.yaml` 拡張子・`.github/` 配置・mise create-only・wire の profiles 非統合は「スコープ外」ではなく §2「本 spec で変更しないもの」= main 採用済みの方針。ここでは重ねない。)
