# P1: application ポート層の新設 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レイヤードアーキテクチャ・リファクタリングの P1 として、`packages/core` に application 層の Repository ポート群・StepRunner ポート・ドメイン例外を**純追加**し、境界を越える plain DTO 型（RepoResult / Installation）を core domain へ集約する。既存の挙動・テストは一切変えない。

**Architecture:** `docs/specification/refactoring-draft.md`（確定版）の P1。Repository の**インタフェース（ポート）だけ**を core/application/service に置く（実装は P2 で infrastructure パッケージへ移設）。ポートは DIP の要（core は実装を知らない）。契約は「その形に適合する型付きフェイクが代入できるか」で型検査（`pnpm typecheck` が include に `test` を含むため強制される）。`CanonicalRepository`（元 `TemplateSource`）は derive.ts=domain が使うため P1 では触らず P3 に回す（単独移設は domain→application の層違反になる）。

**Tech Stack:** TypeScript（ESM・`verbatimModuleSyntax`）/ pnpm workspace / vitest / biome。ビルドなし（`main` が `.ts` を直接指す）。相対 import は `.js` 拡張子（例: `../../../domain/model/manifest/types.js`）。

**回帰の基準（不変条件）:** `docs/specification/current-system-specification.md` の全項目。各タスクの完了条件は「新規テスト green ＋ `pnpm -r typecheck` green ＋ 既存 `pnpm -r test` 全 green」。

**共通コマンド:**
- 型検査（core のみ）: `pnpm --filter @repository-fanout/core typecheck`
- テスト（core のみ）: `pnpm --filter @repository-fanout/core test`
- 全体: `pnpm -r typecheck && pnpm -r test`

---

## File Structure（このプランで作る/触るファイル）

新規（core）:
- `packages/core/src/domain/exception/resourceNotFoundException.ts` — 不在を表すドメイン例外
- `packages/core/src/domain/model/run/repoResult.ts` — run 記録の plain DTO（worker から移動）
- `packages/core/src/domain/model/installation/installation.ts` — App インストールの plain DTO（infrastructure から移動）
- `packages/core/src/application/stepRunner.ts` — ステップ実行ポート
- `packages/core/src/application/service/manifest/manifestRepository.ts`
- `packages/core/src/application/service/distribution/distRecordRepository.ts`
- `packages/core/src/application/service/run/runRepository.ts`
- `packages/core/src/application/service/installation/installationRepository.ts`
- `packages/core/src/application/service/notification/notification.ts`（＋ FailureInfo / KeptFilesInfo DTO）
- `packages/core/src/application/service/target/targetRepository.ts`（＋ PrInfo）
- `packages/core/src/application/service/target/targetPullRequestRepository.ts`（＋ CommitChangesArgs / CreatePrArgs）

変更:
- `packages/core/src/index.ts` — バレルに新規 export を追加、Installation / PrInfo の export 元を差し替え
- `packages/core/src/infrastructure/github/auth/installation.ts` — 型定義を移動先から import
- `packages/core/src/infrastructure/github/repoIO.ts` — `PrInfo` を target ポートから import
- `apps/worker/src/kv/runStore.ts` — `RepoResult` を core から import
- `apps/worker/src/notify.ts` — `FailureInfo` / `KeptFilesInfo` を core から import

新規テスト（core）:
- `packages/core/test/domain/exception/resourceNotFoundException.test.ts`
- `packages/core/test/application/stepRunner.test.ts`
- `packages/core/test/application/service/manifest/manifestRepository.test.ts`
- `packages/core/test/application/service/distribution/distRecordRepository.test.ts`
- `packages/core/test/application/service/run/runRepository.test.ts`
- `packages/core/test/application/service/installation/installationRepository.test.ts`
- `packages/core/test/application/service/notification/notification.test.ts`
- `packages/core/test/application/service/target/targetRepository.test.ts`

---

### Task 1: ResourceNotFoundException（ドメイン例外）

採用する DDD 規範：単一リソースの不在は `ResourceNotFoundException(reason)` で表現。message に「何が」を書く。

**Files:**
- Create: `packages/core/src/domain/exception/resourceNotFoundException.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/domain/exception/resourceNotFoundException.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/domain/exception/resourceNotFoundException.test.ts
import { expect, test } from "vitest";
import { ResourceNotFoundException } from "../../../src/domain/exception/resourceNotFoundException.js";

test("reason を message に持ち name は ResourceNotFoundException", () => {
  const e = new ResourceNotFoundException("manifest not found: acme");
  expect(e).toBeInstanceOf(Error);
  expect(e.message).toBe("manifest not found: acme");
  expect(e.name).toBe("ResourceNotFoundException");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../resourceNotFoundException.js`）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/domain/exception/resourceNotFoundException.ts
/** 単一リソースの不在を表すドメイン例外。message に「何が見つからなかったか」を書く。 */
export class ResourceNotFoundException extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ResourceNotFoundException";
  }
}
```

- [ ] **Step 4: Add barrel export**

`packages/core/src/index.ts` の末尾に追加:

```ts
export { ResourceNotFoundException } from "./domain/exception/resourceNotFoundException.js";
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/exception/resourceNotFoundException.ts packages/core/test/domain/exception/resourceNotFoundException.test.ts packages/core/src/index.ts
git commit -m "feat(core): add ResourceNotFoundException domain exception"
```

---

### Task 2: StepRunner ポート

現行 `apps/worker/src/workflows/child.ts` の `StepLike` を core/application の正式ポートに昇格（Q2=B の核心）。`do()` の戻り値は境界（Workflows 永続化）を越えるため plain データに限る、という契約をコメントで固定。

**Files:**
- Create: `packages/core/src/application/stepRunner.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/stepRunner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/stepRunner.test.ts
import { expect, test } from "vitest";
import type { StepRunner } from "../../src/application/stepRunner.js";

// 契約に適合する即時実行ランナー（cli 実装の雛形・P2 で infrastructure-node に置く）
const immediate: StepRunner = {
  do: (_name, fn) => fn(),
  sleep: async () => {},
};

test("StepRunner は do で fn の戻り値を返し sleep は解決する", async () => {
  const v = await immediate.do("step", async () => 42);
  expect(v).toBe(42);
  await expect(immediate.sleep("wait", 5)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../stepRunner.js`）

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/application/stepRunner.ts
/**
 * ユースケース進行のステップ実行ポート（現 child.ts の StepLike を正式化）。
 * do() の戻り値は境界（Cloudflare Workflows の永続化・再開）を越えるため
 * plain データ（JSON 化可能な値）に限る。ドメインオブジェクトを返さない。
 * 実装: worker=Workflows step 委譲 / cli=即時実行。
 */
export interface StepRunner {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}
```

- [ ] **Step 4: Add barrel export**

`packages/core/src/index.ts` に追加:

```ts
export type { StepRunner } from "./application/stepRunner.js";
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/stepRunner.ts packages/core/test/application/stepRunner.test.ts packages/core/src/index.ts
git commit -m "feat(core): add StepRunner application port"
```

---

### Task 3: Installation 型を core domain へ移動

`Installation`（App インストールの plain 値）を infrastructure から domain へ集約。application ポート（Task 8）が infrastructure を import しないために必要。型のみの移動＝挙動不変。

**Files:**
- Create: `packages/core/src/domain/model/installation/installation.ts`
- Modify: `packages/core/src/infrastructure/github/auth/installation.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the domain type**

```ts
// packages/core/src/domain/model/installation/installation.ts
/** GitHub App のインストール（認可の実体・境界を越える plain データ）。 */
export interface Installation {
  id: number;
  account: string;
  accountType: "Organization" | "User";
}
```

- [ ] **Step 2: Update infrastructure to import the moved type**

`packages/core/src/infrastructure/github/auth/installation.ts` の先頭 `import` の直後（`import { GitHubClient } ...` の次行）に追加し、ローカルの `export interface Installation { ... }`（`id` / `account` / `accountType` の 5 行ブロック）を削除する:

```ts
import type { Installation } from "../../../domain/model/installation/installation.js";
```

（`listInstallations` / `createInstallationToken` 関数はそのまま。戻り値の `Installation` はこの import を参照する。）

- [ ] **Step 3: Repoint the barrel export**

`packages/core/src/index.ts` の

```ts
export type { Installation } from "./infrastructure/github/auth/installation.js";
```

を次に差し替える（`createInstallationToken` / `listInstallations` の値 export はそのまま infrastructure から）:

```ts
export type { Installation } from "./domain/model/installation/installation.js";
```

- [ ] **Step 4: Verify typecheck + tests green（挙動不変）**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS（型のみ移動のため全 green。worker の parent が `Installation` を barrel から import しているが export 名は不変）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/model/installation/installation.ts packages/core/src/infrastructure/github/auth/installation.ts packages/core/src/index.ts
git commit -m "refactor(core): move Installation type to domain/model"
```

---

### Task 4: RepoResult 型を core domain へ移動

`RepoResult`（run 記録の plain DTO）を worker から core domain へ。RunRepository ポート（Task 7）が参照するため。型のみの移動＝挙動不変。

**Files:**
- Create: `packages/core/src/domain/model/run/repoResult.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/worker/src/kv/runStore.ts`

- [ ] **Step 1: Create the domain type**

```ts
// packages/core/src/domain/model/run/repoResult.ts
/** リポ単位の reconcile 結果（run 記録・KV/step 境界を越える plain データ）。 */
export interface RepoResult {
  account: string;
  repo: string;
  status: "success" | "noop" | "failed";
  prNumber?: number;
  error?: string;
}
```

- [ ] **Step 2: Add barrel export**

`packages/core/src/index.ts` に追加:

```ts
export type { RepoResult } from "./domain/model/run/repoResult.js";
```

- [ ] **Step 3: Update worker runStore to import from core**

`apps/worker/src/kv/runStore.ts` の先頭のローカル定義

```ts
export interface RepoResult {
  account: string;
  repo: string;
  status: "success" | "noop" | "failed";
  prNumber?: number;
  error?: string;
}
```

を次の 2 行に差し替える（他ファイルが `runStore` 経由で型を import しても壊れないよう re-export を残す）:

```ts
import type { RepoResult } from "@repository-fanout/core";
export type { RepoResult };
```

- [ ] **Step 4: Verify typecheck + tests green（挙動不変）**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS（worker の `runStore.test.ts` 等は挙動不変）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/model/run/repoResult.ts packages/core/src/index.ts apps/worker/src/kv/runStore.ts
git commit -m "refactor(core): move RepoResult type to domain/model/run"
```

---

### Task 5: ManifestRepository ポート

manifest の永続化ポート。Q3（不在は例外）を反映し `get` は不在で例外、self-heal 読取は `findUsable`（nullable）。現行 `apps/worker/src/kv/manifestStore.ts` の `getManifest` / `getManifestSafe` / `listManifests` / `putManifestCas` に対応。

**Files:**
- Create: `packages/core/src/application/service/manifest/manifestRepository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/service/manifest/manifestRepository.test.ts`

- [ ] **Step 1: Write the failing test（型適合＋説明）**

```ts
// packages/core/test/application/service/manifest/manifestRepository.test.ts
import { expect, test } from "vitest";
import type { ManifestRepository } from "../../../../src/application/service/manifest/manifestRepository.js";
import type { Manifest } from "../../../../src/domain/model/manifest/types.js";

const sample: Manifest = {
  account: "acme",
  revision: 1,
  sourceCommit: "abc",
  repositories: { r1: { languages: [], bundles: [], contents: {}, exclude: [] } },
};

// 契約固定: 適合するフェイクが代入できる＝メソッド名・引数・戻り値が仕様どおり（typecheck が強制）
const fake: ManifestRepository = {
  get: async () => sample,
  findUsable: async () => sample,
  list: async () => [sample],
  saveIfNotStale: async () => ({ stored: true, stale: false }),
};

test("ManifestRepository の契約に適合するフェイクが実装できる", async () => {
  expect((await fake.saveIfNotStale(sample)).stored).toBe(true);
  expect(await fake.findUsable("acme")).toEqual(sample);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../manifestRepository.js`）

- [ ] **Step 3: Write the interface**

```ts
// packages/core/src/application/service/manifest/manifestRepository.ts
import type { Manifest } from "../../../domain/model/manifest/types.js";

/** manifest の永続化ポート（実装は infrastructure-cloudflare の KV）。 */
export interface ManifestRepository {
  /** 保存済み manifest（厳密パース）。不在は ResourceNotFoundException、壊れは Error。 */
  get(account: string): Promise<Manifest>;
  /** self-heal 読取: 不在・パース不能はいずれも null。 */
  findUsable(account: string): Promise<Manifest | null>;
  /** 全 manifest（壊れた 1 件は skip して self-heal を待つ）。 */
  list(): Promise<Manifest[]>;
  /** 厳密に古い revision は拒否(stale=true)、新しければ保存。同一 revision は保存せず stale=false。 */
  saveIfNotStale(manifest: Manifest): Promise<{ stored: boolean; stale: boolean }>;
}
```

- [ ] **Step 4: Add barrel export**

`packages/core/src/index.ts` に追加:

```ts
export type { ManifestRepository } from "./application/service/manifest/manifestRepository.js";
```

- [ ] **Step 5: Verify pass（HR-2 確認込み）**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS
確認: `manifestRepository.ts` は 50 行以内（HR-2）。超えていたら意味単位に割る。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/service/manifest/manifestRepository.ts packages/core/test/application/service/manifest/manifestRepository.test.ts packages/core/src/index.ts
git commit -m "feat(core): add ManifestRepository port"
```

---

### Task 6: DistRecordRepository ポート

配布記録の永続化ポート。未記録は空 record（正常系・例外にしない）。現行 `distStore.ts` の `getDistRecord` / `putDistRecord` に対応。

**Files:**
- Create: `packages/core/src/application/service/distribution/distRecordRepository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/service/distribution/distRecordRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/service/distribution/distRecordRepository.test.ts
import { expect, test } from "vitest";
import type { DistRecordRepository } from "../../../../src/application/service/distribution/distRecordRepository.js";
import { emptyDistRecord } from "../../../../src/domain/model/retraction/distRecord.js";

const fake: DistRecordRepository = {
  get: async () => emptyDistRecord(),
  save: async () => {},
};

test("DistRecordRepository の契約に適合するフェイクが実装できる", async () => {
  expect(await fake.get("acme", "acme/r1")).toEqual({ version: 1, files: {} });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../distRecordRepository.js`）

- [ ] **Step 3: Write the interface**

```ts
// packages/core/src/application/service/distribution/distRecordRepository.ts
import type { DistRecord } from "../../../domain/model/retraction/distRecord.js";

/** 配布記録（削除追従のハッシュ履歴）の永続化ポート。 */
export interface DistRecordRepository {
  /** 配布記録。未記録は空 record（正常系）。 */
  get(account: string, repo: string): Promise<DistRecord>;
  save(account: string, repo: string, record: DistRecord): Promise<void>;
}
```

- [ ] **Step 4: Add barrel export**

```ts
export type { DistRecordRepository } from "./application/service/distribution/distRecordRepository.js";
```

- [ ] **Step 5: Verify pass**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/service/distribution/distRecordRepository.ts packages/core/test/application/service/distribution/distRecordRepository.test.ts packages/core/src/index.ts
git commit -m "feat(core): add DistRecordRepository port"
```

---

### Task 7: RunRepository ポート

run 記録の永続化ポート。現行 `runStore.ts` の `recordRepoResult` / `getRun` に対応（`RepoResult` は Task 4 で core へ移動済み）。

**Files:**
- Create: `packages/core/src/application/service/run/runRepository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/service/run/runRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/service/run/runRepository.test.ts
import { expect, test } from "vitest";
import type { RunRepository } from "../../../../src/application/service/run/runRepository.js";
import type { RepoResult } from "../../../../src/domain/model/run/repoResult.js";

const r: RepoResult = { account: "acme", repo: "acme/r1", status: "noop" };
const fake: RunRepository = {
  record: async () => {},
  getRun: async () => [r],
};

test("RunRepository の契約に適合するフェイクが実装できる", async () => {
  expect(await fake.getRun("run-1")).toEqual([r]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../runRepository.js`）

- [ ] **Step 3: Write the interface**

```ts
// packages/core/src/application/service/run/runRepository.ts
import type { RepoResult } from "../../../domain/model/run/repoResult.js";

/** run（1 回の kick）のリポ単位結果の永続化ポート。 */
export interface RunRepository {
  record(runId: string, result: RepoResult): Promise<void>;
  getRun(runId: string): Promise<RepoResult[]>;
}
```

- [ ] **Step 4: Add barrel export**

```ts
export type { RunRepository } from "./application/service/run/runRepository.js";
```

- [ ] **Step 5: Verify pass**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/service/run/runRepository.ts packages/core/test/application/service/run/runRepository.test.ts packages/core/src/index.ts
git commit -m "feat(core): add RunRepository port"
```

---

### Task 8: InstallationRepository ポート

App インストール列挙とトークン発行のポート。現行 `auth/installation.ts` の `listInstallations` / `createInstallationToken` に対応（App JWT 生成は実装内に隠す）。`Installation` は Task 3 で domain へ移動済み。

**Files:**
- Create: `packages/core/src/application/service/installation/installationRepository.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/service/installation/installationRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/service/installation/installationRepository.test.ts
import { expect, test } from "vitest";
import type { InstallationRepository } from "../../../../src/application/service/installation/installationRepository.js";
import type { Installation } from "../../../../src/domain/model/installation/installation.js";

const inst: Installation = { id: 1, account: "acme", accountType: "Organization" };
const fake: InstallationRepository = {
  list: async () => [inst],
  mintToken: async () => ({ token: "t", expiresAt: "2026-01-01T00:00:00Z" }),
};

test("InstallationRepository の契約に適合するフェイクが実装できる", async () => {
  expect((await fake.list())[0]?.account).toBe("acme");
  expect((await fake.mintToken(1)).token).toBe("t");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../installationRepository.js`）

- [ ] **Step 3: Write the interface**

```ts
// packages/core/src/application/service/installation/installationRepository.ts
import type { Installation } from "../../../domain/model/installation/installation.js";

/** GitHub App のインストール列挙とインストールトークン発行のポート。 */
export interface InstallationRepository {
  list(): Promise<Installation[]>;
  mintToken(installationId: number): Promise<{ token: string; expiresAt: string }>;
}
```

- [ ] **Step 4: Add barrel export**

```ts
export type { InstallationRepository } from "./application/service/installation/installationRepository.js";
```

- [ ] **Step 5: Verify pass**

Run: `pnpm --filter @repository-fanout/core test && pnpm --filter @repository-fanout/core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/service/installation/installationRepository.ts packages/core/test/application/service/installation/installationRepository.test.ts packages/core/src/index.ts
git commit -m "feat(core): add InstallationRepository port"
```

---

### Task 9: Notification ポート（＋ 通知 DTO を core へ集約）

失敗・残置ファイルの通知ポート。webhookUrl は実装（P2 の Discord Transfer）に隠す。`FailureInfo` / `KeptFilesInfo` を worker から core へ移動。

**Files:**
- Create: `packages/core/src/application/service/notification/notification.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/worker/src/notify.ts`
- Test: `packages/core/test/application/service/notification/notification.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/service/notification/notification.test.ts
import { expect, test } from "vitest";
import type {
  FailureInfo,
  KeptFilesInfo,
  Notification,
} from "../../../../src/application/service/notification/notification.js";

const fail: FailureInfo = { runId: "r", account: "acme", repo: "acme/r1", error: "boom" };
const kept: KeptFilesInfo = {
  runId: "r",
  account: "acme",
  repo: "acme/r1",
  kept: [{ path: "X", reason: "modified" }],
};
const fake: Notification = {
  notifyFailure: async () => {},
  notifyKeptFiles: async () => {},
};

test("Notification の契約に適合するフェイクが実装できる", async () => {
  await expect(fake.notifyFailure(fail)).resolves.toBeUndefined();
  await expect(fake.notifyKeptFiles(kept)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../notification.js`）

- [ ] **Step 3: Write the port + DTOs**

```ts
// packages/core/src/application/service/notification/notification.ts
export interface FailureInfo {
  runId: string;
  account: string;
  repo: string;
  error: string;
}

export interface KeptFilesInfo {
  runId: string;
  account: string;
  repo: string;
  kept: Array<{ path: string; reason: string }>;
}

/** 失敗・残置ファイルの通知ポート（実装は infrastructure-discord）。送信失敗は実装側で握りつぶす。 */
export interface Notification {
  notifyFailure(info: FailureInfo): Promise<void>;
  notifyKeptFiles(info: KeptFilesInfo): Promise<void>;
}
```

- [ ] **Step 4: Add barrel export**

```ts
export type {
  FailureInfo,
  KeptFilesInfo,
  Notification,
} from "./application/service/notification/notification.js";
```

- [ ] **Step 5: Update worker notify.ts to import the moved DTOs**

`apps/worker/src/notify.ts` の先頭のローカル定義

```ts
export interface FailureInfo {
  runId: string;
  account: string;
  repo: string;
  error: string;
}

export interface KeptFilesInfo {
  runId: string;
  account: string;
  repo: string;
  kept: Array<{ path: string; reason: string }>;
}
```

を次に差し替える（`notifyFailure` / `notifyKeptFiles` 関数は不変）:

```ts
import type { FailureInfo, KeptFilesInfo } from "@repository-fanout/core";
export type { FailureInfo, KeptFilesInfo };
```

- [ ] **Step 6: Verify pass（core + worker）**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS（worker の `notify.test.ts` は挙動不変）

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/application/service/notification/notification.ts packages/core/test/application/service/notification/notification.test.ts packages/core/src/index.ts apps/worker/src/notify.ts
git commit -m "feat(core): add Notification port and centralize notify DTOs"
```

---

### Task 10: TargetRepository / TargetPullRequestRepository ポート（HR-2 で責務2分割）

配布先リポへのポート。現行 `RepoIO`（1 クラス・167 行）のメソッド集合。IF 1 つにまとめると 50 行（HR-2）を超えるため、**責務で 2 分割**（状態観測 / コミット＋PR 運用）。`PrInfo` は現在 `repoIO.ts` にあるが target ポートへ移し、`repoIO.ts` はそこから import する（infrastructure→application は正方向依存）。

**Files:**
- Create: `packages/core/src/application/service/target/targetRepository.ts`（＋ PrInfo）
- Create: `packages/core/src/application/service/target/targetPullRequestRepository.ts`（＋ CommitChangesArgs / CreatePrArgs）
- Modify: `packages/core/src/infrastructure/github/repoIO.ts`（PrInfo を移動先から import）
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/application/service/target/targetRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/application/service/target/targetRepository.test.ts
import { expect, test } from "vitest";
import type {
  PrInfo,
  TargetRepository,
} from "../../../../src/application/service/target/targetRepository.js";
import type { TargetPullRequestRepository } from "../../../../src/application/service/target/targetPullRequestRepository.js";

const pr: PrInfo = { number: 1, state: "open", merged: false };
const reader: TargetRepository = {
  getDefaultBranch: async () => ({ branch: "main", sha: "s" }),
  readActualFiles: async () => ({}),
  findPr: async () => pr,
  branchExists: async () => true,
};
const writer: TargetPullRequestRepository = {
  getTreeSha: async () => "t",
  commitChanges: async () => {},
  createPr: async () => 1,
  reopenPr: async () => {},
  updatePrBody: async () => {},
  addLabels: async () => {},
  deleteBranch: async () => {},
};

test("Target 系ポートの契約に適合するフェイクが実装できる", async () => {
  expect((await reader.getDefaultBranch()).branch).toBe("main");
  expect(await writer.createPr({ branch: "b", base: "main", title: "t", body: "x" })).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repository-fanout/core test`
Expected: FAIL（`Cannot find module .../targetRepository.js`）

- [ ] **Step 3: Write the reader port（＋ PrInfo）**

```ts
// packages/core/src/application/service/target/targetRepository.ts
/** 配布先リポの PR 情報（plain）。 */
export interface PrInfo {
  number: number;
  state: "open" | "closed";
  merged: boolean;
}

/** 配布先リポの現在状態を観測するポート（変更はしない）。 */
export interface TargetRepository {
  getDefaultBranch(): Promise<{ branch: string; sha: string }>;
  /** 指定パス群の実内容（不在パスはキーを含めない）。 */
  readActualFiles(paths: string[], ref: string): Promise<Record<string, string>>;
  findPr(branch: string): Promise<PrInfo | null>;
  branchExists(branch: string): Promise<boolean>;
}
```

- [ ] **Step 4: Write the pull-request port（＋ arg 型）**

```ts
// packages/core/src/application/service/target/targetPullRequestRepository.ts
import type { FileChange } from "../../../domain/model/reconcile/fileChange.js";

export interface CommitChangesArgs {
  branch: string;
  baseSha: string;
  baseTreeSha: string;
  message: string;
  changes: FileChange[];
  deletions?: string[];
  create: boolean;
}

export interface CreatePrArgs {
  branch: string;
  base: string;
  title: string;
  body: string;
}

/** 配布先リポへコミットし、配布 PR を運用するポート。 */
export interface TargetPullRequestRepository {
  getTreeSha(commitSha: string): Promise<string>;
  commitChanges(args: CommitChangesArgs): Promise<void>;
  createPr(args: CreatePrArgs): Promise<number>;
  reopenPr(prNumber: number): Promise<void>;
  updatePrBody(prNumber: number, body: string): Promise<void>;
  addLabels(prNumber: number, labels: string[]): Promise<void>;
  deleteBranch(branch: string): Promise<void>;
}
```

- [ ] **Step 5: Repoint repoIO の PrInfo を target ポートへ**

`packages/core/src/infrastructure/github/repoIO.ts` の先頭 `import` 群の直後に追加し、ローカルの `export interface PrInfo { ... }`（`number` / `state` / `merged` の 5 行ブロック）を削除する:

```ts
import type { PrInfo } from "../../application/service/target/targetRepository.js";
```

（`RepoIO` クラス・`RepoIOOpts` は不変。`findPr` の戻り `PrInfo | null` はこの import を参照。）

- [ ] **Step 6: Update the barrel**

`packages/core/src/index.ts` の

```ts
export type { PrInfo, RepoIOOpts } from "./infrastructure/github/repoIO.js";
```

を次に差し替える:

```ts
export type { RepoIOOpts } from "./infrastructure/github/repoIO.js";
export type { PrInfo, TargetRepository } from "./application/service/target/targetRepository.js";
export type {
  CommitChangesArgs,
  CreatePrArgs,
  TargetPullRequestRepository,
} from "./application/service/target/targetPullRequestRepository.js";
```

- [ ] **Step 7: Verify pass（HR-2 確認込み）**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS
確認: `targetRepository.ts` / `targetPullRequestRepository.ts` はいずれも 50 行以内（HR-2）。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/application/service/target/ packages/core/test/application/service/target/ packages/core/src/infrastructure/github/repoIO.ts packages/core/src/index.ts
git commit -m "feat(core): add Target reader/pull-request ports (split per HR-2)"
```

---

### Task 11: 全体検証（回帰の最終確認）

**Files:** なし（検証のみ）

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r typecheck`
Expected: PASS（全パッケージ）

- [ ] **Step 2: Full test**

Run: `pnpm -r test`
Expected: PASS（core の新規 8 テスト＋既存全テスト green。挙動不変）

- [ ] **Step 3: Lint（biome）**

Run: `pnpm exec biome ci`
Expected: PASS（import 整列・format 含む）。FAIL したら `pnpm exec biome check --write` で整形して再確認・追加コミット。

- [ ] **Step 4: HR-1 / HR-2 セルフチェック**

Run: `find packages/core/src/application packages/core/src/domain/exception packages/core/src/domain/model/run packages/core/src/domain/model/installation -name '*.ts' | xargs wc -l`
Expected: 追加した各ファイルが HR-1（100 行）・Repository IF は HR-2（50 行）以内。超過があれば意味単位に分割して再コミット。

---

## Self-Review（このプランの点検結果）

**1. Spec coverage（P1 の要求 → タスク対応）:**
- Repository IF 群（manifest/distribution/run/target/installation/notification）→ Task 5/6/7/10/8/9 ✅
- StepRunner ポート → Task 2 ✅
- `ResourceNotFoundException` → Task 1 ✅
- RepoResult / Installation を core domain へ → Task 4 / Task 3 ✅
- `CanonicalRepository` は P3 に回す（本プラン対象外・スペック §11 と一致）✅
- HR-1（100 行）/ HR-2（50 行）→ Task 10 で Target を責務2分割、Task 11 でセルフチェック ✅
- 挙動不変 → 全タスクで `pnpm -r test` green を完了条件に、型移動は既存テストで担保 ✅

**2. Placeholder scan:** TODO/TBD/「適宜」なし。各ステップに実コードと実コマンドを記載 ✅

**3. Type consistency:**
- `RepoResult`（Task 4 定義）を Task 7 が import。フィールド名一致 ✅
- `Installation`（Task 3 定義）を Task 8 が import ✅
- `PrInfo`（Task 10 で target ポートへ移動）を repoIO と barrel が参照。名前一致 ✅
- `FileChange`（既存 domain）を Task 10 の `CommitChangesArgs.changes` が参照 ✅
- `Manifest` / `DistRecord`（既存 domain）を Task 5 / 6 が import ✅

**4. Ambiguity:** ポートのメソッド名・引数・戻り値は現行 `manifestStore.ts` / `distStore.ts` / `runStore.ts` / `repoIO.ts` / `auth/installation.ts` / `notify.ts` の実シグネチャに 1:1 対応。差分は Q3（`get` の不在→例外）と `findUsable`（self-heal 読取の命名）のみで、いずれも実装は P2、本プランは IF 定義のみ ✅
