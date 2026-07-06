# repository-fanout レイヤードアーキテクチャ・リファクタリング — ドラフト spec

> ステータス: **確定（2026-07-06 ユーザー回答で全項目決定・Q2=B）**。対象コミット `724bc40`。
> 目的: 現行実装（`current-system-specification.md` が正本）を、**採用するレイヤードアーキテクチャと DDD 規範**に**忠実に**沿う構造へリファクタリングする。
> **本書は確定。** 次はユーザーのスペックレビュー → writing-plans（実装計画）→ 実装。

---

## 0. 不可侵の制約（依頼から）

1. **削らない。** 参照構造が規定する層（application/service・Repository 等）は**全て作る**。前回「service/repository を勝手に作らない」と削った失敗の是正。
2. **YAGNI / MVP で逃げない。** 「将来必要になるまで」「過剰」を判断停止の口実にしない。依頼された全てが対象。
3. **挙動は変えない。** 構造リファクタリング。エンドポイント契約・KV スキーマ・戦略の意味論・削除追従・PR ライフサイクルは**1つも変えない**（`current-system-specification.md` 全項目が回帰基準）。
4. **参照構造に忠実。** 採用するレイヤードアーキテクチャ（4層）+ DDD 規範。逸脱時は隠さず §12 で提示。
5. **設計を疑う。** 「worker が使う / cli が依存する」を、やらない口実に使わない。

---

## 0.1 確定した決定（2026-07-06 ユーザー回答）

| # | 決定 |
|---|---|
| **Q1** | **Option C：infrastructure を独立パッケージ化**（実行環境が変わっても継続使用できる、が本プロジェクトの掲げる思想）。→ §3 |
| **Q2** | **Option B**：ユースケースを表す Scenario クラスの中では可能な限りオブジェクトで組み立て、ディスク保存が起きる境目だけを注入する **StepRunner ポート**1箇所に閉じ込める。→ §10 |
| **Q3** | **適用**：Repository の nullable 戻りを排除、不在は例外、presentation で HTTP へ翻訳。→ §7 |
| **Q4** | **Reader/Writer は分けない。** ただし**意味のある単位**で Repository を作る。**Repository インタフェースが 50 行を超えたら絶対に見直し**（＝意味のある単位に割り直す）。→ §4 |
| **Q5** | **domain/type を全部やる。** 純関数 util のまま放置せず、ドメイン値は値オブジェクト（VO）化する。「過剰」判断は撤回。→ §6.2 |
| **Q6** | (a) `branch/rule/` 隔離＝**採用** / (b) ファーストクラスコレクション化＝**採用** / (c) `TemplateSource`→application 移動＝**採用**。→ §6 |
| **Q7** | **OK**：KV の last-writer-wins 意味論は維持。`putManifestCas` は誤解を招くので `saveIfNotStale` 等へ改名（挙動不変）。→ §8 |
| **Q8** | **リネームする**：内部フィールド名 `vars` → `contents`。→ §9 |
| **Q9** | **段階**：フェーズごと PR・各 PR で全テスト green。→ §11 |
| **Q10** | **現状維持**：英語識別子・日本語コメント・コンテキスト prefix。→ §4 |

### 0.2 全体に効く 2 つのハード・ルール（今回追加要望）

- **HR-1（100 行）**: 実装（production）1 ファイルが **100 行を超えたら全て見直し対象**。原則として意味のある単位に分割する。
- **HR-2（50 行）**: Repository インタフェース 1 つが **50 行を超えたら絶対に見直し**（Q4）。

**現行の HR-1 違反（＝今回の分割対象・実測）**:

| 行 | ファイル | 分割方針（案） |
|---|---|---|
| 308 | `apps/worker/src/workflows/child.ts` | presentation（Workflow ホスト）/ application（reconcile scenario）/ 記録更新ロジックへ分解 |
| 190 | `core/.../reconcile/structuredDocument.ts` | 形式別（json/yaml/toml）マージ + merge 関数（array/table）+ ドキュメント本体に分割 |
| 168 | `core/.../desired/desiredFile.ts` | 戦略別（sealed variant）を意味単位でファイル分割（HR-1 は sealed 例外より優先＝§6.1） |
| 167 | `core/.../infrastructure/github/repoIO.ts` | Target の read 系 / write 系で分割（Q4 は IF を分けないが実装ファイルは HR-1 で分割可） |
| 142 | `core/.../canonical/catalogEntry.ts` | mode 別 entry を意味単位で分割 |
| 142 | `apps/worker/src/index.ts` | SyncController / ルーティング / 認可へ分解 |
| 136 | `apps/worker/src/auth/oidc.ts` | JWKS 取得 / トークン検証 / claim 抽出へ分割 |
| 132 | `apps/worker/src/workflows/parent.ts` | Workflow ホスト / fanout scenario / spawn ロジックへ分解 |
| 102 | `core/.../canonical/contribution.ts` | `ProfileContributes` / `PathContributions` を別ファイルへ |

> HR-1 と DDD 規範の「1 ファイル 1 型（sealed 階層は同一ファイル例外）」が競合する箇所（`catalogEntry` / `desiredFile` 等の sealed 風階層）は、**HR-1 を優先し variant を意味単位でファイル分割**する（§6.1）。

---

## 1. 参照アーキテクチャの要約

### 1.1 参照レイヤードアーキテクチャ（4層）
presentation / application / domain / infrastructure。**application を scenario（ユースケース束ね）と service（Query/Record + **Repository インタフェース**）に二分**。Repository IF は application、実装は infrastructure（DIP）。domain は最内・全層被依存。

### 1.2 採用する DDD 規範（一次規範）
1. 依存方向は一方向（presentation → application → infrastructure、domain 横断）。application/infrastructure は presentation を import 禁止。
2. **ロジックは Domain 一択**。Service/Scenario/Controller は薄い orchestration。
3. 層間はドメイン型（VO/集約/first-class collection）で渡す。primitive・raw List・nullable を公開境界に出さない。
4. **不在は例外・値域違反は IAE・素通しで上層へ**。翻訳は presentation 境界に一元化。
5. **外部境界の interface は application（Repository）、実装は infrastructure**。infrastructure に IF を置くと層違反（明記）。DB=datasource / 外部送信=transfer / 外部受信=receive。
6. 命名対称（同一コンテキスト prefix）。（Reader/Writer 分離は参照規範の推奨だが、今回 Q4 で**不採用**＝分けない。）
7. domain 規範: リッチモデル / object graph / 不変更新はコンストラクタ明示 / 1 ファイル 1 型（domain・sealed 例外）/ VO は値域を require で検証 / first-class collection / 区分は述語メソッド。
8. テストは「壊れて困るか」で取捨。

---

## 2. 現行と参照構造のギャップ（何を作り、何を動かすか）

| 参照 | 現行の所在 | 作業 |
|---|---|---|
| domain/model（集約・VO・rule/・collection） | `core/domain/model/*` | ほぼ整合。**VO 化（Q5）・collection 化（Q6b）・rule/ 隔離（Q6a）・不変更新規範**の適用（§6） |
| domain/type（横断基盤型・VO） | `core/domain/type/*`（純関数 util） | **VO 化・型化を全部やる**（Q5・§6.2） |
| application/scenario | `core/application/scenario/reconcileRepository.ts`（ステップ関数） | **Scenario クラス化 + StepRunner ポート**（Q2=B・§10） |
| application/service（Query/Record + **Repository IF**） | **無い** | **新規作成**（§4）。前回削った層 |
| infrastructure（Repository 実装） | KV=app 内 / GitHub=core / notify=app 内 / cli 複製 | **独立パッケージへ整理**（Q1=C・§3, §5） |
| presentation（薄い controller） | worker index.ts/workflows、cli index.ts | 薄型化 + configuration 明示（§10） |

---

## 3. ターゲット構造（Q1 = Option C：infrastructure 独立パッケージ）

**思想**: 「実行環境が変わっても継続使用できる」。ゆえに core（domain + application）は実行環境非依存、infrastructure は**外部システム / 実行環境ごとに独立パッケージ**へ分離し、apps は配線（presentation + configuration）だけを持つ。

```
packages/
  core/                        domain + application(Repository IF + service + scenario)。実行環境非依存
  infrastructure-github/       GitHub 実装（canonical 読取 / target 読取・書込 / installation）。fetch ベース＝両ランタイム可
  infrastructure-discord/      Discord Webhook 実装（notification）。fetch ベース
  infrastructure-cloudflare/   KV 実装（manifest/dist/run）＋ StepRunner ポートの Cloudflare 実装（Workflow step）。Cloudflare 固有
  infrastructure-node/         ローカル FS 実装（cli の canonical 読取）。Node 固有
  tsconfig/
apps/
  worker/                      presentation（SyncController / Workflow ホスト）＋ configuration（Env・DI 配線）
  cli/                         presentation（コマンド）＋ configuration（DI 配線）
```

依存方向（一方向）:
```
apps ─► infrastructure-* ─► core(application: Repository IF) ─► core(domain)
apps ─► core(application: scenario/service) ─► core(domain)
```
- **core は infrastructure-* を知らない**（IF だけ持つ）。apps が「どの実装を注入するか」を configuration で決める（DIP）。
- infrastructure パッケージの粒度は「外部システム/実行環境」単位（github / discord / cloudflare / node）。**StepRunner ポート**（§10）の実装は infrastructure-cloudflare（Workflows）と cli 側（即時実行）にそれぞれ置く。

### 3.1 core の内部

```
packages/core/src/
  domain/
    model/
      canonical/     Catalog / CatalogEntry(mode 別・HR-1 で分割) / Profiles / Contribution / Template
      desired/       DesiredFile(戦略別・HR-1 で分割) / DesiredFileData(plain) / computeChanges / (derive は §6c で application へ)
      reconcile/     ManagedBlock / StructuredDocument(HR-1 で分割) / FileChange(plain)
      retraction/    DistRecord(plain+純関数) / RetractionPlan(plain) / planRetraction
      manifest/      Manifest / RepoEntry / RepoEntries(first-class collection・Q6b)
      branch/        branchAction ─► branch/rule/（Q6a）
    type/            VO 群（Q5・§6.2）: ContentHash / Account / RepositoryName / Revision / CommitSha / FilePath / RunId / InstallationId … ＋ 基盤コーデック/ヘルパ
    exception/       ResourceNotFoundException 他（§7）
  application/
    scenario/        ReconcileRepositoryScenario / FanoutScenario（class・StepRunner 注入・§10）
    service/
      manifest/      ManifestRepository(IF)
      canonical/     CanonicalRepository(IF・元 TemplateSource) ＋ resolve 系 service（§6c）
      target/        TargetRepository(IF・元 RepoIO)
      distribution/  DistRecordRepository(IF)
      run/           RunRepository(IF)
      installation/  InstallationRepository(IF)
      notification/  Notification(IF)
  index.ts
```

---

## 4. Repository ポート・カタログ（新規・core/application/service）

Q4 に従い **Reader/Writer を分けず、コンテキストごとに 1 つの意味ある Repository**。各 IF は **HR-2（50 行以内）**。超えたら意味単位で割り直す。

| コンテキスト | Repository（IF・1 つ） | 主メソッド（現行の対応） | 実装パッケージ |
|---|---|---|---|
| manifest | `ManifestRepository` | `get`(不在→例外・厳密) / `findUsable`(self-heal・nullable) / `list`(self-heal skip) / `saveIfNotStale`(旧 putManifestCas) | infrastructure-cloudflare |
| distribution | `DistRecordRepository` | `get`(未記録→空 record＝正常) / `save` | infrastructure-cloudflare |
| run | `RunRepository` | `record` / `getRun` | infrastructure-cloudflare |
| canonical | `CanonicalRepository` | `readFile` / `listFiles`（元 TemplateSource） | infrastructure-github / infrastructure-node |
| target | `TargetRepository` | `getDefaultBranch` / `readActualFiles` / `findPr` / `branchExists` / `getTreeSha` / `commitChanges` / `createPr` / `reopenPr` / `updatePrBody` / `addLabels` / `deleteBranch` | infrastructure-github |
| installation | `InstallationRepository` | `list` / `mintToken` | infrastructure-github |
| notification | `Notification` | `notifyFailure` / `notifyKeptFiles` | infrastructure-discord |

- **`TargetRepository` は 50 行に収まるか要注意**（メソッドが多い）。HR-2 超なら「参照系（branch/pr/actual 読取）」と「変更系（commit/pr 作成・削除）」等、**意味のある単位で 2 つ以上の Repository に割る**（Reader/Writer という機械的分割ではなく、責務での分割）。実装（infrastructure-github の RepoIO 相当）は HR-1 で別途分割。
- **`CanonicalRepository`（読取専用 IF）** は worker=GitHub / cli=FS の 2 実装（Q1=C で別パッケージ）。
- nullable 排除（Q3）: `get` 系は不在を `ResourceNotFoundException` で表現。`DistRecordRepository.get` の「未記録＝空」は正常系なので例外にせず空 record を返す。

---

## 5. infrastructure 実装の配置（Q1=C）

| 実装クラス（案） | 満たす IF | パッケージ | 種別 | 現行 |
|---|---|---|---|---|
| `ManifestKvDataSource` | ManifestRepository | infrastructure-cloudflare | KV | kv/manifestStore.ts |
| `DistRecordKvDataSource` | DistRecordRepository | infrastructure-cloudflare | KV | kv/distStore.ts |
| `RunKvDataSource` | RunRepository | infrastructure-cloudflare | KV | kv/runStore.ts |
| `CanonicalGitHubReceive` | CanonicalRepository | infrastructure-github | receive | GitHubTemplateSource |
| `CanonicalFileReceive` | CanonicalRepository | infrastructure-node | receive | cli localSource |
| `TargetGitHubDataSource` | TargetRepository（分割時は複数） | infrastructure-github | receive+transfer | RepoIO |
| `InstallationGitHubReceive` | InstallationRepository | infrastructure-github | receive | auth/installation.ts |
| `NotificationDiscordTransfer` | Notification | infrastructure-discord | transfer | notify.ts |
| `WorkflowStepRunner` | StepRunner(IF) | infrastructure-cloudflare | 実行制御 | child/parent の step.do |
| `ImmediateStepRunner` | StepRunner(IF) | infrastructure-node（cli） | 実行制御 | 現 FakeStep 相当（即時実行） |

- **GitHubClient / errors / jwt** は GitHub プロトコル基盤 → infrastructure-github の内部部品。
- **retry.ts（withRetry）** は実行制御 → infrastructure-cloudflare か worker configuration（core には入れない）。
- **cli の GitHub 複製（base64/templateSource/actualReader）は infrastructure-github へ一本化**（挙動不変・複製解消）。

---

## 6. domain への規範適用（Q5 / Q6 全採用・全部やる）

### 6.1 1 ファイル 1 型 と HR-1（sealed 階層も分割）
`catalogEntry`（基底+4）・`desiredFile`（基底+6）・`structuredDocument` は参照規範なら「sealed 階層は同一ファイル」だが、**HR-1（100 行）を優先し variant を意味単位でファイル分割**する。基底 + 各 variant を別ファイルにし、バレルで束ねる。

### 6.2 domain/type を全部 VO / 型にする（Q5）
純関数 util のまま放置しない。ドメイン値は VO 化する。

| 現行 | 扱い |
|---|---|
| `hash.ts`（sha256Hex） | **`ContentHash` VO**（配布記録のハッシュ値）に昇格。DistRecord の hashes は `ContentHash[]`（境界越えは plain string、内側で VO） |
| 各所の `account: string` | **`Account` VO**（非空検証） |
| 各所の `repo: "owner/name"` | **`RepositoryName` VO**（owner/name 分解・検証） |
| `revision: number` | **`Revision` VO**（整数検証・比較 `isNewerThan`） |
| `sourceCommit: string` | **`CommitSha` VO** |
| desired の `path: string` | **`FilePath` VO** |
| `runId` / `installationId` | **`RunId` / `InstallationId` VO** |
| `base64.ts` / `yaml.ts` | 基盤コーデック（VO でなく型付き関数として domain/type に残す。これは「値」でなく「変換」ゆえ VO 化しない＝これは逃げでなく VO の定義に照らした判断。§12 Q5-補足） |
| `dedupe.ts` / `object.ts` | 汎用ヘルパ（同上・型付き関数） |

> 補足: base64/yaml/dedupe/object を VO 化しないのは「値オブジェクト＝ドメインの値に不変条件を持たせる」定義に照らして**変換関数はその対象でない**から。もしこの線引き自体に異議があれば §12 Q5 で指摘ください（勝手な YAGNI ではなく VO の定義に基づく判断として提示）。

### 6.3 first-class collection（Q6b）
- `Manifest.repositories`（生 Record）→ **`RepoEntries`**（`.list` public・件数 `size()`・`entryFor(name)` 等）。
- `DistRecord.files`（生 Record）→ **`DistFiles`** collection。
- これらは step/KV 境界を越える plain データなので、**境界（StepRunner.do の戻り・KV）では plain・step の内側では collection にハイドレート**（Q2=B）。scenario は step の内側でリッチなオブジェクトを組み立てる。

### 6.4 rule/ 隔離（Q6a）
- `branch/branchAction.ts` の PR ライフサイクル判定 → `branch/rule/` へ。

### 6.5 canonical の resolve を application へ（Q6c）
- `TemplateSource` → `CanonicalRepository`（application/service）。「外部境界 IF は application」に忠実化。
- これに伴い `derive.ts`（canonical を**読んで** desired を導出する orchestration）は domain→application 依存を作らないため **application/service/canonical（または scenario）へ移す**。純粋なモデル（Catalog / CatalogEntry / DesiredFile 等）は domain に残す。分割は §10 / Q2 と一体。

### 6.6 その他（既に適合・維持）
不変更新（Catalog 等は不変）・区分のポリモーフィズム（strategy/mode 別メソッド）・ロジックは domain（deriveDesiredFiles/computeChanges/planRetraction/StructuredDocument）は移動しない。

---

## 7. エラー処理・nullable（Q3=適用）

- 公開境界（Repository IF・Service・Scenario）の nullable 戻りを排除。不在は `ResourceNotFoundException`（domain/exception）。値域違反は既存 fail fast 例外。
- 翻訳は presentation 境界（`SyncController`）に一元化。現行の HTTP ステータス分岐（`current-system-specification.md §10.1.3`）を1つも変えない。
- Service/Scenario は素通し。**例外**: `StructuredParseError` の per-repo failure 化は「不在を別戦略のトリガーにする catch」に相当し参照規範が許容 → 維持。
- 既存例外の層: `GitHubError`(infrastructure) / `StructuredParseError`・`ResourceNotFoundException`(domain) / `OidcError`(presentation/configuration)。

---

## 8. 挙動不変の担保 + 命名是正

- 不変条件: `current-system-specification.md` 全項目（契約・KV・戦略・削除追従・PR・リトライ・通知）を変えない。
- 証明: 既存テスト全 green（import パス以外は挙動不変）＋ Workflow 配線テスト（FakeStep 全ステップ実走）維持＋ `/sync` 契約テスト維持＋ 新 Service/Scenario に orchestration テスト追加。
- **KV に CAS 無し（Q7）**: last-writer-wins・revision 意味論は仕様として維持。`putManifestCas` → `saveIfNotStale` へ改名（挙動不変）。tx 規範は「KV は該当なし」と明示。

---

## 9. `vars` → `contents` リネーム（Q8=実施）

- `ChildParams.vars` / `ReconcileDeclaration.vars` / `ResolveAutoArgs.vars` の内部名を `contents` に統一（manifest スキーマ・テンプレ変数は既に contents）。wire/KV スキーマは変えない＝挙動不変。
- `ChildParams` は Workflow 永続化ペイロード。**両受けは付けず `contents` のみで単純リネーム**（ユーザー決定 2026-07-06）。in-flight run の互換は取らない。

---

## 10. presentation / application scenario / configuration（Q2 = B の具体化）

- **StepRunner ポート（B の核心）**: core/application が持つ IF。現行 `child.ts` の `StepLike`（`do(name, fn)` / `sleep(name, ms)`）を formalize したもの。**scenario は StepRunner 越しに進行**し、`do` の戻り値だけが plain データ（＝ディスク保存境界）。step の内側は VO/collection でリッチに組む。
  - 実装（Q1=C）: worker=`WorkflowStepRunner`（Cloudflare の `WorkflowStep` に委譲）/ cli=`ImmediateStepRunner`（即時実行・現 FakeStep 相当）。
  - 効果: **同一 Scenario が両ランタイムで動く**（実行環境非依存＝Q1=C の思想と一致）。現行の三重実装（`planRepo` / `applyRepo` / `child.ts`）が **1 つの Scenario に収束**する。
- **ReconcileRepositoryScenario（class）**: StepRunner と Repository 群（Canonical/Target/DistRecord/Run/Notification）を注入され、1 リポの reconcile 進行を表現。判定・計算は domain のまま（`deriveDesiredFiles` / `computeChanges` / `planRetraction` / `decideBranchAction` を移動しない）。step の内側で VO/collection を使い、`do` の戻りは plain。
- **FanoutScenario（class）**: parent の進行（manifest 読取・installation 列挙・ウェーブ spawn）を StepRunner 越しに表現。
- **SyncController**（worker presentation）: 受付・OIDC 検証結果の取り出し・例外→HTTP 翻訳のみ。CAS/起動は application へ委譲。
- **ParentWorkflow / ChildWorkflow**（worker presentation）: 薄い実行ホスト。Scenario を生成・起動するだけ。
- **configuration**: Env・OIDC audience・**DI 配線（どの infrastructure-* 実装・どの StepRunner を注入するか）**。片方向 glue。
- **B の残リスク（P3 で必ず検証）**: 挙動不変（§0-3）が最優先。StepRunner 化で **step 名・粒度が現行と 1:1 で一致**することを配線テスト（FakeStep/WorkflowStep）で確認する。ここがずれると Workflows の再開・再試行の挙動が変わる。壊れると判明した場合のみ A（現行のステップ関数方式）へフォールバックする。

---

## 11. フェーズ分割（Q9=段階・各 PR で全テスト green）

- **P0**: Q2 確定 → 本ドラフト確定。
- **P1（core: application IF）**: Repository IF 群（manifest/distribution/run/target/installation/notification）＋ StepRunner ポート＋ `ResourceNotFoundException` を core に**新規追加**（既存コードは原則不変・実装移設は P2）。RepoResult / Installation 型を core domain へ移動。**`CanonicalRepository` の rename/移設は P3 に回す**（derive.ts=domain が使うため単独移設は domain→application の層違反。derive と一緒に P3）。全 green。
- **P2（infrastructure パッケージ化）**: infrastructure-github / -discord / -cloudflare / -node を作り、KV/notify/GitHub/FS を実装として移設。DI 配線（configuration）新設。cli 複製解消。全 green。
- **P3（application scenario）**: reconcile/fanout を `ReconcileRepositoryScenario` / `FanoutScenario`（class）+ StepRunner ポートへ再構成。**`CanonicalRepository`（元 TemplateSource）と derive の application 移設もここで行う**（§6.5）。**step 名・粒度を現行と厳密に一致**させる（再開・再試行の挙動を変えないため。FakeStep/WorkflowStep 両実装で配線テスト green）。cli も同 Scenario を ImmediateStepRunner で駆動（三重実装の収束）。全 green。
- **P4（presentation + HR-1 分割）**: SyncController/Workflow ホスト分離、cli 再構成、**HR-1 違反 9 ファイルの分割**。全 green。
- **P5（domain 規範）**: VO 化（Q5）・collection 化（Q6b）・rule/ 隔離（Q6a）・sealed 分割（§6.1）・`vars`→`contents`（Q8）。全 green。
- **P6（掃除）**: 旧配置・stale サンプルの整理（削除は勝手にしない・都度確認）。

---

## 12. 決定記録と補足（全項目確定）

> 全 Q は §0.1 で確定。以下は Q2=B の背景説明（用語が難しかったため平易に残す）と、派生確認の扱い。

### Q2 = B の背景（平易版）: 非同期実行と「層のあいだの受け渡し方」の衝突

**まず、これが何の話かを平易に説明します。**

- 普通のアプリ（参照にしたレイヤードアーキテクチャ設計が想定するもの）は、処理が**1つのプログラムの中で最初から最後まで一気に**走ります。だから「オブジェクト（＝データと操作メソッドを一緒に持った塊）」を、層から層へ**そのまま手渡し**できます。参照規範の「層のあいだは常にオブジェクトで渡せ（裸のデータで渡すな）」はこれが前提です。
- ところが repository-fanout は **Cloudflare Workflows** という仕組みの上で動きます。これは長い処理を**「ステップ」に区切り、各ステップの結果を一旦ディスクに保存**します（途中でサーバが落ちても続きから再開できるように・失敗したステップだけ再試行できるように、のため）。
- 保存するとき、値は**「ただのデータ（JSON）」に変換**されます。このとき**操作メソッドは保存できず消えます**。つまりステップの境目を越えた瞬間、オブジェクトは「操作を失った裸のデータ」になってしまう。
- だから現行 core は「**ステップの境目を越える値は最初から裸のデータにしておき、境目の内側に入ったところで改めてオブジェクトに組み立て直す**（コードでは `DesiredFile.from(data)`）」というルールにしています。
- これが参照規範の「層のあいだは常にオブジェクトで渡せ」と**正面からぶつかります**（ステップの境目では裸データにせざるを得ないから）。**Q2 は「どちらをどこまで優先するか」の判断です。**

**現行仕様書のどこを読むと分かるか（この順で）:**
1. **§4.3「core が意図している境界ルール」** ← ここが一番直接的（「境界を越える値は plain データ・ドメインオブジェクトは境界を越えない」）。
2. **§7.1 のアクティビティ図** ← `step: ...` が縦に並んでいるのが「ステップ分割」。各 step の間でディスク保存が起きます。
3. **§7.2「ステップと core 関数の対応」** ← 各ステップの境目を**裸データ（`DesiredFileData` 等）**が渡っている様子。
4. **付録 A** の `DesiredFileData`（裸データ）と、`DesiredFile`（操作を持つオブジェクト）が**別々に存在する理由**＝まさにこの境界ルール。
5. **§17 最後の箇条書き** ← 同じ境界ルールの要約。

**選択肢（平易版）:**

- **A（今のやり方を維持・現実優先）**: ステップの境目は裸データ、境目の内側でオブジェクト化。参照規範の「常にオブジェクト」には**字義的には従わない**が、Workflows の現実に合い、実績を壊さない。
- **B（規範に寄せて挑戦）**: ユースケースを表す「進行役オブジェクト（Scenario クラス）」を作り、その中では**できる限りオブジェクトで組み立てる**。ディスク保存が起きる境目だけを**注入する部品（step runner）1 箇所に閉じ込める**。規範に近づくが、部品が増え、「再開の切れ目が今と同じか」の検証が要る。
- **C（ステップの切り方自体を見直す）**: そもそもステップを粗くして境目越えを減らす。ただし再開・再試行の**挙動が変わる**ので §0-3（挙動を変えない）と要調整。

> **補足（判断材料）**: 今回 Q5（VO を全部やる）・Q6b（collection 化）を採用した以上、「境目の内側ではリッチなオブジェクトを組み立てる」方向＝**B が自然**です。A だとオブジェクトが 1 ステップ内でしか生きられず VO/collection の適用範囲が狭まります。私の推奨は **B（Workers の再開特性を壊すと判明したら A にフォールバック）**。ただし挙動不変（§0-3）が最優先なので、B の step 切れ目が現行と一致することを P3 で必ずテスト検証します。

**→ 決定：B（2026-07-06）。** step の内側はリッチなオブジェクト、境目（StepRunner.do の戻り）だけ plain。具体化は §10。挙動不変は P3 の配線テストで担保。

### 派生確認（§9 vars→contents）: 単純リネーム（決定 2026-07-06）

両受け（`p.contents ?? p.vars`）は**付けない**。`contents` のみで単純リネームする（ユーザー決定）。in-flight run の互換は取らない。

---

## 付録: 参照
- 現行仕様（正本）: `docs/specification/current-system-specification.md`
- 採用するレイヤードアーキテクチャ + DDD 規範（§1）
- 既存 core 構造設計: `docs/superpowers/specs/2026-07-05-core-structure-design.md`（境界ルール §4 が Q2 の核心）
- 前回の失敗記録: `SESSION_POSTMORTEM.md`
