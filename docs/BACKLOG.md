# Backlog

設計上の負債・将来の改善候補を積む場所。着手時は `docs/superpowers/specs` / `plans` に昇格させる。

---

## fanout manifest の宣言を provider 化して `_fanout_manifest.tf` を廃止する

**種別**: 設計負債 / DX
**起票**: 2026-07-06(Phase C 展開中に露見)

### 問題

各アカウントの Terraform リポ（`organization-structure` と `kukv/structure`）に置いた
`terraform/_fanout_manifest.tf` が、配布対象を **手動リスト** `fanout_modules` で束ねている。

```hcl
locals {
  fanout_modules = {
    "repository-fanout" = module.repository_repository_fanout
    "endpoint-gate"     = module.repository_endpoint_gate
    "idem"              = module.repository_idem
    "mindstock"         = module.repository_mindstock
  }
  # ...
  fanout_repositories = {
    for name, mod in local.fanout_modules :
    name => merge(mod.fanout_entry, { ... })
    if mod.fanout_entry != null
  }
}
```

Terraform は `module.*` を動的に列挙できないため、配布対象を増やすには **二重編集** が要る:

1. `repository_<name>.tf` の module に `fanout = { ... }` を書く
2. `_fanout_manifest.tf` の `fanout_modules` に1行足す

**2 を忘れると、そのリポだけ黙って配布対象から漏れる**（`fanout_entry != null` の filter は
そもそも map に載っている module しか見ないので、エラーにもならない）。宣言を増やすたびに
踏む地雷で、レビューでも気付きにくい。`if mod.fanout_entry != null` があるのに手動リストが
必要、という時点で歪んでいる。

### 方針: provider 化

集約 `output "fanout_manifest"` + on-merge の `.github/scripts/fanout-sync.sh` という
「output を shell が読んで worker へ POST」構成をやめ、**各リポ module が自分の fanout
エントリを自己登録する** custom provider に置き換える。ラフスケッチ:

- `terraform-provider-fanout`(仮）が `fanout_repository` リソースを提供する。
- `repository` module は `fanout` が設定されたときだけ内部で `fanout_repository` を1つ作り、
  languages / bundles / contents / exclude を載せる。**中央リストは消える。**
- 集約と worker への送信は provider 側で完結（または provider が manifest を書き出し、CI が送る）。
  → `_fanout_manifest.tf`（両アカウント）と `fanout_modules` を丸ごと廃止。

### 着手時に詰める論点

- provider の実装・配布（Go）。社内 registry か mirror か。
- 集約をどこで行うか（provider apply 時 / data source）。1アカウント=1 manifest=1送信者の
  不変条件をどう保つか。
- アカウント既定（codeowner / license_holder）の注入をどこへ移すか
  （現状は `_fanout_manifest.tf` の `fanout_default_contents` + module 変数 default）。
- CI が付与している `revision` / `sourceCommit` の流れをどう引き継ぐか。
- YAGNI 判断: 現状 2 アカウント / ~26 リポ規模で provider を自作する価値があるか、
  それとも codegen（`fanout_modules` を module 一覧から自動生成する軽い手当て）で足りるか。
