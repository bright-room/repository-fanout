# repository-fanout 運用 runbook

> 対象: repository-fanout v2(OIDC 認証・削除追従)。設計は `docs/superpowers/specs/2026-07-04-repository-fanout-v2-design.md` を参照。
> エンドポイント: `https://repository-fanout.bright-room.workers.dev`(workers.dev で恒久化。独自ドメインは使わない: 設計 D12)

## 1. 手動再実行(rekick)

OIDC トークンは GitHub Actions 内でしか発行できないため、手動再実行も全て Actions 経由(新しい公開エンドポイントは増やさない)。

| やりたいこと | コマンド |
|---|---|
| bright-room の全リポ再実行 | `gh workflow run fanout-rekick.yml -R bright-room/organization-structure` |
| bright-room の特定リポのみ | `gh workflow run fanout-rekick.yml -R bright-room/organization-structure -f repos=repo-a,repo-b` |
| kukv の全リポ / 特定リポ | `gh workflow run fanout-rekick.yml -R kukv/structure`(`-f repos=...` 同様) |
| global(全アカウント・正本変更の再配布) | `gh workflow run fanout-sync.yml -R bright-room/canonical-files` |

- rekick は KV 保存済み manifest を使う(manifest 送信なし)。manifest 自体を直したい場合は structure リポの PR → merge(on-merge が送信)
- kick が 202 でも配布は非同期。結果は §2 の run 記録か対象リポの PR で確認する

## 2. 障害調査

### 実行から 3 日以内(Workflow 実行状態が残っている間)

Free プランの Workflow 実行状態保持は **3 日間**。`apps/worker/` で:

```sh
mise exec -- wrangler workflows instances list --name fanout-parent
mise exec -- wrangler workflows instances describe fanout-parent <instance-id>   # ステップ毎の結果・エラー
mise exec -- wrangler workflows instances list --name fanout-child               # リポ単位の子
```

リアルタイムで見るなら `mise exec -- wrangler tail`。

### 3 日経過後(KV の run 記録。90 日 TTL)

リポ単位の結果は RUNS namespace に `run:{runId}:{account}:{repo}` で保存(status = success / noop / failed、prNumber、error)。

```sh
mise exec -- wrangler kv key list --binding RUNS --remote --prefix "run:"
mise exec -- wrangler kv key get --binding RUNS --remote "run:<runId>:<account>:<repo>"
```

runId は kick 時の 202 応答・Discord 失敗通知に含まれる。

### その他の KV(MANIFESTS namespace に同居)

```sh
mise exec -- wrangler kv key get --binding MANIFESTS --remote "manifest:<account>"        # 保存済み manifest
mise exec -- wrangler kv key get --binding MANIFESTS --remote "dist:<account>:<repo>"     # 配布記録(削除追従用ハッシュ履歴)
```

### 認証エラーの切り分け

- 401: OIDC トークン不正(aud が FANOUT_URL と不一致・期限切れ)か、旧 HMAC 送信側の残骸
- 403: `repository_owner` とアカウント不一致、または chloe-chan がそのアカウントに未インストール
- 503: GitHub JWKS 取得失敗(フェイルクローズ)。CI リトライに任せる

## 3. Free プラン予算(超えると何が起きるか)

| 項目 | Free の上限 | 現状の消費 | 目安 |
|---|---|---|---|
| KV write | 1,000/日 | 全リポ一斉配布 1 回 ≈ 57 write | **一斉配布 ~17 回/日**。連続 kick の乱発だけ注意 |
| Workflows CPU | 10ms/呼び出し | GitHub API 待ちが主体(待機中は非課金) | 実用上収まる(E2E 実証済み)。超過は run のエラーログに出る |
| 同時 Workflow | 100 インスタンス | 最大 28 リポ+親 | 余裕 |
| 実行状態の保持 | 3 日 | — | 障害調査は 3 日以内に。以降は KV run 記録(90 日) |

## 4. CLI(最後の砦: Cloudflare 全面障害時)

`apps/cli/` から。chloe-chan とは別の PAT(`GITHUB_TOKEN`)で動く。

```sh
GITHUB_TOKEN=... npx tsx src/index.ts dry-run --repo bright-room/repo-a --languages typescript
GITHUB_TOKEN=... npx tsx src/index.ts apply   --repo bright-room/repo-a --languages typescript [--bundles oss] [--codeowner x]
npx tsx src/index.ts validate --dir <canonical-files のローカル checkout>
```

**apply の制限(worker との差)**:
- **削除追従は動かない**(追加・更新のみ。KV の配布記録に触れないため)
- exclude 未対応・1 リポずつ・languages/bundles は manifest でなく引数で手渡し
- あくまで応急処置。復旧後に rekick して worker 側の記録と収束させること

## 5. 削除追従の挙動早見(消える条件 / 残る条件)

不変条件: **fanout は「自分が配った」とハッシュで証明できるファイルしか消さない**。迷ったら残す。

| 状況 | 挙動 |
|---|---|
| 正本から削除+配布先が配布時のまま(ハッシュ一致) | 配布 PR に削除が入る。merge されるまで毎回提案(冪等) |
| 正本から削除+配布先で**改変済み**(ハッシュ不一致) | **残置**。記録から外す(管理の引き渡し)。PR 本文に注記+Discord 通知 |
| exclude に追加(replace / create-only) | ファイルは触らず記録から外す(引き渡し)。消したければ手動 |
| exclude に追加(managed-block / extends-field) | fanout の寄与分(ブロック・管理エントリ)だけ除去 PR |
| リポが manifest から外れた | **残置**(掃除しない: 設計 D4)。必要なら手動で消す |
| 削除 PR を close しただけ | 差分が残る限り再提案されうる。止めたい場合は改変するか exclude へ |
| KV 配布記録の消失 | 削除されなくなるだけ(残しすぎ方向)。次回配布で記録再開 |

正本から language/bundle ディレクトリ自体を消す時は、**先に全リポの宣言から外す**(逆順だと extends にエントリが残置される。設計 §5.6)。

## 6. 新アカウント追加(ゼロコンフィグ)

fanout 側の作業は**ゼロ**。以下の 2 つだけ:

1. GitHub App **chloe-chan** をそのアカウントにインストール(これが認可の実体)
2. アカウントの structure リポに配線を移植: `_fanout_manifest.tf`(account 名と既定 codeowner を変更)+ `fanout-sync.sh` + on-merge のステップ + `fanout-rekick.yml`(kukv/structure の実装が参照例)

シークレット設定は双方とも不要(OIDC)。アカウントのリネームには追従しないため、リネーム時は structure 側の再配線と同時に行う。

## 7. 配布対象リポの追加(languages 宣言)

structure リポで:

1. リポの module に `languages = ["typescript", ...]`(必要なら `bundles = ["oss"]` / `fanout_vars`)を追加
2. `_fanout_manifest.tf` の `fanout_modules` にそのリポの 1 行を追加
3. PR → merge(on-merge が apply 後に manifest を送信し自動配布)
4. 配布先リポに立つ配布 PR を**全ファイル目視で**レビューして merge(fanout は提案するだけ)

administrator 管理のメタリポ(organization-structure 等)は、organization-structure の `_fanout_manifest.tf` に**静的宣言**で載せる(1 アカウント = 1 manifest = 1 送信者の不変条件)。
