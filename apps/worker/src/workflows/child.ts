import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  computeChanges,
  createAppJwt,
  createInstallationToken,
  type Distributed,
  decideBranchAction,
  type FileChange,
  GitHubClient,
  GitHubError,
  type KeptFile,
  type PrState,
  pathsToRead,
  RepoIO,
  resolveDesiredStep,
  Sha256,
  StructuredParseError,
  type TemplateSource,
} from "@repository-fanout/core";
import { reportRepoFailure } from "../failure.js";
import { GitHubTemplateSource } from "../github/templateSource.js";
import type { Env } from "../index.js";
import { getDistRecord, putDistRecord, toDistRecord, toStored } from "../kv/distStore.js";
import { recordRepoResult } from "../kv/runStore.js";
import { notifyKeptFiles } from "../notify.js";
import { withRetry } from "../retry.js";

const BRANCH = "chore/distribute-common-files";
const PR_TITLE = "chore: distribute common files";
const PR_LABELS = ["Kind: Dependencies"];
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retry = <T>(fn: () => Promise<T>): Promise<T> =>
  withRetry(fn, { maxAttempts: MAX_ATTEMPTS, sleep });

export interface ChildParams {
  runId: string;
  account: string;
  installationId: number;
  repo: string; // "owner/name"
  languages: string[];
  bundles: string[];
  vars: Record<string, string>;
  exclude: string[];
}

/** Workflows の step の最小面。テストでは即時実行のフェイクを渡す */
export interface StepLike {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

/** RepoIO のうち runChild が使う面(テストでフェイク注入するための構造的型) */
export type RepoPort = Pick<
  RepoIO,
  | "getDefaultBranch"
  | "readActualFiles"
  | "findPr"
  | "branchExists"
  | "commitChanges"
  | "getTreeSha"
  | "createPr"
  | "reopenPr"
  | "addLabels"
  | "deleteBranch"
  | "updatePrBody"
>;

export interface ChildDeps {
  templates?: TemplateSource;
  io?: RepoPort;
}

/** 削除候補だったが残置したファイルの注記付き PR 本文(spec §5.4/§5.5) */
export function buildPrBody(kept: KeptFile[]): string {
  const base = "🤖 distributed by repository-fanout";
  if (kept.length === 0) return base;
  const lines = kept.map(
    (k) =>
      `- \`${k.path}\` — ${
        k.reason === "modified"
          ? "改変されていたため削除せず残置(fanout の管理対象から外しました)"
          : "exclude 指定のため管理対象から外しました(ファイルは残置)"
      }`,
  );
  return `${base}\n\n### fanout が削除しなかったファイル\n${lines.join("\n")}`;
}

export async function runChild(
  env: Env,
  p: ChildParams,
  step: StepLike,
  deps: ChildDeps = {},
): Promise<void> {
  try {
    let io: RepoPort;
    let templates: TemplateSource;
    if (deps.io && deps.templates) {
      io = deps.io;
      templates = deps.templates;
    } else {
      const token = await step.do("mint token", async () =>
        retry(async () => {
          const jwt = await createAppJwt({
            appId: env.APP_ID,
            privateKeyPem: env.APP_PRIVATE_KEY,
          });
          return (await createInstallationToken({ appJwt: jwt, installationId: p.installationId }))
            .token;
        }),
      );
      const client = new GitHubClient({ token });
      io = deps.io ?? new RepoIO({ client, repo: p.repo });
      templates = deps.templates ?? new GitHubTemplateSource({ client, repo: env.TEMPLATES_REPO });
    }

    const desired = await step.do("resolve desired", async () =>
      retry(() =>
        resolveDesiredStep(templates, {
          languages: p.languages,
          bundles: p.bundles,
          vars: p.vars,
          exclude: p.exclude,
          repo: p.repo,
          account: p.account,
        }),
      ),
    );

    const record = await step.do("read dist record", () =>
      getDistRecord(env.MANIFESTS, p.account, p.repo),
    );

    const base = await step.do("default branch", () => retry(() => io.getDefaultBranch()));
    const desiredPaths = desired.map((d) => d.path);
    const readPaths = pathsToRead(desired, Object.keys(record.files));
    const actual = await step.do("read actual", () =>
      retry(() => io.readActualFiles(readPaths, base.branch)),
    );

    let changes: FileChange[];
    try {
      changes = computeChanges(desired, actual);
    } catch (err) {
      if (err instanceof StructuredParseError) {
        await reportRepoFailure(env, p.runId, {
          account: p.account,
          repo: p.repo,
          error: err.message,
        });
        return;
      }
      throw err;
    }

    const retraction = await step.do("plan retraction", async () => {
      const plan = await toDistRecord(record).planRetraction({
        desiredPaths,
        excluded: p.exclude,
        actual,
      });
      return { deletions: plan.deletions, record: toStored(plan.record), kept: plan.kept };
    });

    // 残置ファイルは「管理の引き渡し」イベントであり PR の有無(noop/write)と独立に
    // 人間へ通知する(spec §5.7)。kept になったパスは次回 nextRecord から外れる
    // ため候補にならず、この通知は同じパスについて一度きりで再発しない。
    if (retraction.kept.length > 0) {
      await step.do("notify kept", () =>
        notifyKeptFiles(env.DISCORD_WEBHOOK_URL, {
          runId: p.runId,
          account: p.account,
          repo: p.repo,
          kept: retraction.kept,
        }),
      );
    }

    // 記録の更新内容(spec §5.3 / §5.7 ブートストラップ):
    // replace   … 今回書く内容、または既に収束済みの内容を記録(v0 配布分の自然な取り込み)
    // create-only … 今回 fanout が新規作成した場合のみ記録(「fanout が書いた証拠」があるものだけ)
    const changedPaths = new Set(changes.map((c) => c.path));
    const distributed: Distributed[] = [];
    for (const d of desired) {
      if (d.strategy === "replace" && (changedPaths.has(d.path) || actual[d.path] === d.content)) {
        distributed.push({ path: d.path, strategy: "replace", hash: await Sha256.of(d.content) });
      } else if (d.strategy === "create-only" && changedPaths.has(d.path)) {
        distributed.push({
          path: d.path,
          strategy: "create-only",
          hash: await Sha256.of(d.content),
        });
      }
    }
    const nextRecord = toStored(toDistRecord(retraction.record).recordDistribution(distributed));
    // managed-block/extends-field のみのリポは記録が常に空のままになりやすく、
    // 無変化でも毎回 put すると Free プランの KV write 予算を浪費する。
    const recordChanged = JSON.stringify(nextRecord) !== JSON.stringify(record);

    const hasDiff = changes.length > 0 || retraction.deletions.length > 0;
    const pr = await step.do("find pr", () => retry(() => io.findPr(BRANCH)));
    const branchExists = await step.do("branch exists", () => retry(() => io.branchExists(BRANCH)));
    const prState: PrState = pr ? (pr.merged ? "merged" : pr.state) : "none";
    const decision = decideBranchAction({ hasDiff, branchExists, pr: prState });

    // --- no-write actions --------------------------------------------------
    if (decision.action === "noop" || decision.action === "delete-branch") {
      if (decision.action === "delete-branch") {
        await step.do("delete branch", () => retry(() => io.deleteBranch(BRANCH)));
      }
      // 記録の掃除・引き渡しは PR 無しでも永続化する(消しすぎ防止に影響しない)
      if (recordChanged) {
        await step.do("update dist record", () =>
          putDistRecord(env.MANIFESTS, p.account, p.repo, nextRecord),
        );
      }
      await recordRepoResult(env.RUNS, p.runId, {
        account: p.account,
        repo: p.repo,
        status: "noop",
      });
      return;
    }

    // --- write actions -----------------------------------------------------
    const createRef =
      decision.action === "create-branch-and-pr" || decision.action === "recreate-branch-new-pr";
    const createPr =
      decision.action === "create-branch-and-pr" ||
      decision.action === "update-branch-and-create-pr" ||
      decision.action === "recreate-branch-new-pr";

    if (decision.action === "recreate-branch-new-pr" && branchExists) {
      await step.do("delete stale branch", () => retry(() => io.deleteBranch(BRANCH)));
    }

    await step.do("commit", async () =>
      retry(async () => {
        const treeSha = await io.getTreeSha(base.sha);
        await io.commitChanges({
          branch: BRANCH,
          baseSha: base.sha,
          baseTreeSha: treeSha,
          message: PR_TITLE,
          changes,
          deletions: retraction.deletions,
          create: createRef,
        });
      }),
    );

    const body = buildPrBody(retraction.kept);
    let prNumber = pr?.number;
    if (decision.action === "update-branch" && decision.reopen && prNumber !== undefined) {
      const reopenNumber = prNumber;
      await step.do("reopen pr", () => retry(() => io.reopenPr(reopenNumber)));
    }
    if (createPr) {
      const created = await step.do("create pr", () =>
        retry(async () => {
          try {
            return await io.createPr({
              branch: BRANCH,
              base: base.branch,
              title: PR_TITLE,
              body,
            });
          } catch (err) {
            if (err instanceof GitHubError && err.status === 422) {
              const existing = await io.findPr(BRANCH);
              if (existing) return existing.number;
            }
            throw err;
          }
        }),
      );
      prNumber = created;
      await step.do("label", () => retry(() => io.addLabels(created, PR_LABELS)));
    } else if (prNumber !== undefined && retraction.kept.length > 0) {
      // 既存 PR 更新時も残置注記を本文へ反映
      const n = prNumber;
      await step.do("update pr body", () => retry(() => io.updatePrBody(n, body)));
    }

    if (recordChanged) {
      await step.do("update dist record", () =>
        putDistRecord(env.MANIFESTS, p.account, p.repo, nextRecord),
      );
    }
    await recordRepoResult(env.RUNS, p.runId, {
      account: p.account,
      repo: p.repo,
      status: "success",
      prNumber,
    });
  } catch (err) {
    await reportRepoFailure(env, p.runId, {
      account: p.account,
      repo: p.repo,
      error: String(err),
    });
    throw err; // Workflows のリトライに委ねる
  }
}

export class ChildWorkflow extends WorkflowEntrypoint<Env, ChildParams> {
  async run(event: WorkflowEvent<ChildParams>, step: WorkflowStep): Promise<void> {
    await runChild(this.env, event.payload, step);
  }
}
