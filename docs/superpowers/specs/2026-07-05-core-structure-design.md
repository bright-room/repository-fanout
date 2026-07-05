# packages/core の構造設計 — 業務概念パッケージ + ドメインオブジェクト(rev.2)

> 対象: repository-fanout の packages/core(+ worker/cli の位置づけ整理)
> status: 承認済み(2026-07-05)。P-a プラン(2026-07-05-v3-p1-core-engine.md)に反映済み
> rev.2: クラス中心のドメインオブジェクト化を採用(ユーザー決定)。境界ルール(§4)を新設

---

## 1. 設計原則

| 原則 | fanout への適用 |
|---|---|
| パッケージは技術レイヤでなく**業務概念**で切る | ○ spec の語彙(canonical / desired / reconcile / retraction / branch / manifest)でパッケージを切る |
| **ドメインオブジェクト中心**: データと操作を一緒に持ち、完全コンストラクタで不変条件を保証 | ○ 採用(rev.2)。parseCatalog のような「検証と裸データの分離」をやめ、検証済みであることを型(クラス)で保証する。ただし §4 の境界ルールに従う |
| domain に判断・加工・計算を寄せ、application は**進行役**に徹する | ○ planRepo / applyRepo / child.ts に三重実装されている進行手順を application/scenario に一本化 |
| infrastructure は差し替え可能なアダプタ | ○ (実質すでにこの思想: TemplateSource / KV はインターフェース越し) |
| 区分・分岐はポリモーフィズムで表現 | ○ 採用(rev.2)。mode 別の導出(resolve 内の if 分岐)と strategy 別の突合(diff.ts の switch)を、それぞれのドメインオブジェクトのメソッドに置き換える |

## 2. 現状の問題

- `reconcile/` に「突合・削除追従・PR ライフサイクル」の 3 概念が同居、`templates/` に「導出・描画・戦略設定」が混在 — 概念がディレクトリから読めない
- 検証(parseCatalog 等)と裸のデータ型(interface Catalog)が分離しており、「検証済み」を型で区別できない
- resolve → 実読 → diff → retraction の進行手順が worker(child.ts)と cli(planRepo / applyRepo)に重複
- mode / strategy の分岐が resolve と diff の 2 箇所の switch に散る

## 3. 提案する構造(P-a から適用)

```
packages/core/src/
├── domain/
│   ├── model/
│   │   ├── canonical/                 # 【正本】検証済み宣言のドメインオブジェクト
│   │   │   ├── catalog.ts             #   Catalog(完全コンストラクタ: Catalog.parse(raw))
│   │   │   ├── catalogEntry.ts        #   CatalogEntry 階層(mode 別。deriveDesired() を持つ)
│   │   │   ├── profiles.ts            #   Profiles(宣言順・存在検証・全 profile = universe 母集団)
│   │   │   ├── contribution.ts        #   Contributions(宣言順マージ・template 衝突検出)
│   │   │   └── template.ts            #   Template(Liquid strict 描画。cross_dedupe 内蔵)
│   │   ├── desired/                   # 【望ましい状態】
│   │   │   ├── desiredFile.ts         #   DesiredFile 階層(strategy 別。applyTo(actual) を持つ)
│   │   │   │                          #   + DesiredFileData(境界横断用 plain 型)と相互変換
│   │   │   └── derive.ts              #   導出の入口(Catalog × Profiles × Contributions → DesiredFile[])
│   │   ├── reconcile/                 # 【突合】の道具(DesiredFile.applyTo が使う)
│   │   │   ├── managedBlock.ts        #   ManagedBlock(マーカーの発見・差替・除去)
│   │   │   ├── structuredDocument.ts  #   StructuredDocument(json/yaml/toml のパース・managed_paths マージ・no-op 判定・正準描画)
│   │   │   └── fileChange.ts          #   FileChange(plain。PR コミット内容 = 境界横断)
│   │   ├── retraction/                # 【削除追従】
│   │   │   ├── distRecord.ts          #   DistRecord(KV 記録。plain データ + 純関数)
│   │   │   └── retractionPlan.ts      #   planRetraction
│   │   ├── branch/                    # 【PR ライフサイクル】
│   │   │   └── branchAction.ts        #   decideBranchAction
│   │   └── manifest/                  # 【配布先宣言】
│   │       └── manifest.ts            #   Manifest.parse(検証済み宣言。contents 受理)
│   └── type/                          # 業務非依存の基本型・関数(現 util/)
│       ├── dedupe.ts  hash.ts  base64.ts  object.ts
├── application/
│   ├── port/                          # domain が要求する I/O 境界
│   │   └── templateSource.ts          #   TemplateSource
│   └── scenario/
│       └── reconcileRepository.ts     #   進行役(ステップごとの純関数の束。§5)
├── infrastructure/
│   └── github/                        # GitHub API アダプタ(worker/cli 共有)
│       ├── client.ts  repoIO.ts  errors.ts
│       └── auth/                      #   jwt.ts  installation.ts
├── templates/                         # 【旧経路・凍結】v2 resolve 一式。P-e で丸ごと削除
└── index.ts
```

**依存方向**: `domain/type ← domain/model ← application ← infrastructure ← apps`。domain は core 内の他層に依存しない(liquidjs / yaml / smol-toml は domain の技術詳細として許容)。

## 4. 境界ルール(クラス化の唯一の制約)

**Cloudflare Workflows の `step.do` は戻り値をシリアライズして永続化する**(再開・リトライのため)。
KV も同様。つまり **step / KV / HTTP 境界を越えた瞬間、クラスインスタンスはメソッドを失う**。
ここを無視してクラスを配ると「メソッドが生えているはずの値が実は裸 JSON」という実行時事故になる。

そこで境界横断用の運搬データ(DTO)ルールを 1 本だけ敷く:

> **境界を越える値は plain スキーマ(TS 型)で運び、境界の内側に入った所で
> ドメインオブジェクトに載せ替える(`X.from(data)`)。ドメインオブジェクトは境界を越えない。**

| 値 | 境界 | 扱い |
|---|---|---|
| DesiredFile[] | step.do(resolve desired の戻り) | 運搬は `DesiredFileData`(現 DesiredEntry 相当の判別 union)。`computeChanges` の入口で `DesiredFile.from(data)` に載せ替え |
| DistRecord | KV | plain + 純関数のまま(現行どおり。v2 spec §5.3 の実績を崩さない) |
| FileChange[] / RetractionPlan | step.do → PR 作成 | plain のまま(操作を持たない運搬データ) |
| Manifest | HTTP → KV | 受信時に `Manifest.parse` で検証、KV には plain を保存、読み出し時に再 parse |
| Catalog / Profiles / Contributions / Template / StructuredDocument / ManagedBlock | **境界を越えない**(1 回の resolve / 突合の中で生きて死ぬ) | 完全コンストラクタのクラス。ここがクラス化の主戦場 |

この分類の根拠: 検証・判断・加工が要る概念(左列下段)はすべて境界の内側で完結しており、
境界を越えるのは「計算結果の運搬」だけ。つまり**クラス化したい場所と、plain であるべき場所が
綺麗に分かれる**構造になっている。

## 5. クラス設計のスケッチ(主要 3 箇所)

### 5.1 Catalog / CatalogEntry — 検証と分岐の一体化

```ts
// domain/model/canonical/catalog.ts
export class Catalog {
  private constructor(private readonly entries: Map<string, CatalogEntry>) {}

  /** 完全コンストラクタ: 不正な Catalog インスタンスは存在しえない(raw=null も fail fast) */
  static parse(raw: string | null): Catalog { /* 検証して entries を構築 */ }

  entryFor(path: string): CatalogEntry | undefined;
  /** contributes.json のパスが catalog に登録済みかの検証(タイポ検出) */
  assertKnownPaths(profile: string, paths: string[]): void;
}

// domain/model/canonical/catalogEntry.ts — mode 別ポリモーフィズム(resolve の if 分岐が消える)
export abstract class CatalogEntry {
  abstract deriveDesired(c: Contributions, t: Template | undefined, ctx: RenderContext): Promise<DesiredFile>;
}
export class ReplacedFile extends CatalogEntry { /* replace を導出 */ }
export class CreateOnlyFile extends CatalogEntry { /* create-only を導出 */ }
export class ManagedTextFile extends CatalogEntry { /* managed-block を導出 */ }
export class ManagedStructuredFile extends CatalogEntry {
  /* managed_paths 検証・universe 計算・structured-managed を導出 */
}
```

### 5.2 DesiredFile — strategy 別ポリモーフィズム(diff.ts の switch が消える)

```ts
// domain/model/desired/desiredFile.ts
export abstract class DesiredFile {
  abstract readonly path: string;
  /** 実ファイルとの突合。変更不要なら null(no-op) */
  abstract applyTo(actual: string | undefined): FileChange | null;
  /** exclude 時の姿(retract 変換)。replace/create-only は null = 配布対象から外す */
  abstract retracted(): DesiredFile | null;
  /** 境界横断用 plain 型との相互変換 */
  abstract toData(): DesiredFileData;
  static from(data: DesiredFileData): DesiredFile; // 判別 union → 各クラス
}
// Replace / CreateOnly / ManagedBlockFile / StructuredManagedFile / 各 Retract がこれを実装
// computeChanges は「DesiredFile.from して applyTo を呼ぶだけ」の 5 行になる
```

### 5.3 StructuredDocument — データと操作の一体化(検証つき)

```ts
// domain/model/reconcile/structuredDocument.ts
export class StructuredDocument {
  /** 完全コンストラクタ: パース不能は StructuredParseError(壊れた文書のインスタンスは作れない) */
  static parse(fileType: StructuredFileType, path: string, content: string): StructuredDocument;

  /** managed_paths 配下だけマージした新文書。意味的に同一なら null(no-op 判定を内蔵) */
  applyManaged(spec: ManagedPathsSpec): StructuredDocument | null;
  serialize(): string; // json=stringify / yaml=Document.toString(コメント保持) / toml=正準描画
}
```

## 6. apps の位置づけと scenario

| レイヤ | fanout での担い手 |
|---|---|
| presentation | apps/worker の index.ts + workflows/、apps/cli のコマンド |
| infrastructure(アダプタ) | worker の templateSource / kv、cli の localSource(port 実装) |
| application(進行役) | core の `application/scenario/reconcileRepository.ts` |

**Workers 制約への対応**: scenario は「ステップごとの純関数の束」(desired 導出 / 読むべきパス算出 /
差分計算 / retraction 計画)として提供する。worker は各関数を `step.do` で包み(再開粒度を維持)、
cli は順に呼ぶだけ。**進行の知識は core、実行制御(retry / step / 並行)は apps**。
step 間の受け渡しは §4 のとおり plain データ(`DesiredFileData` 等)で行う。

## 7. 現行 → 新配置の対応(rev.2)

| 現行 | 新配置 | 形態 |
|---|---|---|
| `templates/types.ts` DesiredEntry | `domain/model/desired/desiredFile.ts` | クラス階層 + `DesiredFileData`(plain) |
| `templates/resolve.ts` ほか v2 経路 | `templates/`(据え置き・凍結) | P-e で削除。新規参照禁止 |
| `reconcile/block.ts` | `domain/model/reconcile/managedBlock.ts` | クラス(ManagedBlock) |
| `reconcile/diff.ts` | `domain/model/desired/`(applyTo に吸収) | computeChanges は薄い入口として維持 |
| `reconcile/extendsField.ts` | (P-e まで現位置) | StructuredDocument が吸収後に削除 |
| `reconcile/retraction.ts` / `distRecord.ts` | `domain/model/retraction/*` | plain + 純関数(KV 境界のため現行形を維持) |
| `reconcile/branch.ts` | `domain/model/branch/branchAction.ts` | 純関数のまま |
| `manifest/*` | `domain/model/manifest/manifest.ts` | Manifest.parse(クラス) |
| `github/*` `auth/*` | `infrastructure/github/*` | 現行のまま |
| `util/*` | `domain/type/*` | 現行のまま |
| (v3 新規)catalog / contributes / liquid | `domain/model/canonical/*` | クラス(§5.1) |
| (v3 新規)構造マージ | `domain/model/reconcile/structuredDocument.ts` | クラス(§5.3) |
| (v3 新規)v3 resolve | `domain/model/desired/derive.ts` | Catalog 等を編成する導出関数 |
| (新規)進行役 | `application/scenario/reconcileRepository.ts` | ステップ関数の束 |

## 8. 移行の進め方(P-a プランの改訂方針)

1. **Task 0 新設**: 恒久資産の `git mv`(reconcile / manifest / github / auth / util → 新配置)+ import 修正。挙動不変・全テスト green
2. **Task 2〜9 を書き直し**: 実装スケルトンを §5 のクラス設計に合わせて全面改訂(テストもクラス API で書く)
3. **Task 7 の diff 拡張 → DesiredFile.applyTo 方式に変更**(switch 追加ではなくクラス追加)
4. **Task 11.5 新設**: scenario 追加、child.ts / planRepo / applyRepo の進行手順を寄せる
5. 旧経路(templates/)との自動切替(resolveDesired)は維持 — 旧経路は関数のまま触らない

## 9. やらないこと(YAGNI)

- 境界を越える値のクラス化(§4 のとおり。rehydrate の氾濫は事故のもと)
- DistRecord / RetractionPlan / FileChange / branchAction のクラス化(操作を持たない運搬データ、または KV 境界に密着した実績コード)
- DI コンテナ。port は TemplateSource / RepoPort / DistRecordStore の 3 つだけ
- 旧経路(templates/, extendsField)の移動・改名(P-e で消えるものに投資しない)
- getter/setter だけの貧血クラス(操作を持たない概念は plain 型のままにする)
