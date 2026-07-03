import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  computeChanges,
  createAppJwt,
  createInstallationToken,
  decideBranchAction,
  type FileChange,
  GitHubClient,
  GitHubError,
  type PrState,
  RenovateParseError,
  resolveDesiredEntries,
} from "@repository-fanout/core";
import { RepoIO } from "../github/repoIO.js";
import { GitHubTemplateSource } from "../github/templateSource.js";
import type { Env } from "../index.js";
import { recordRepoResult } from "../kv/runStore.js";
import { withRetry } from "../retry.js";

const BRANCH = "chore/distribute-common-files";
const PR_TITLE = "chore: distribute common files";
const PR_BODY = "🤖 distributed by repository-fanout";
const PR_LABELS = ["Kind: Dependencies"];
const MAX_ATTEMPTS = 5;

// Workflows step は丸ごと再実行のリトライしか提供しない。GitHub の retryable エラー
// (429 / 403 secondary rate limit / 5xx) は Retry-After を尊重した細粒度バックオフで
// step 内リトライする (spec §16-2)。各 step は冪等なので安全。
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retry = <T>(fn: () => Promise<T>): Promise<T> =>
  withRetry(fn, { maxAttempts: MAX_ATTEMPTS, sleep });

export interface ChildParams {
  runId: string;
  account: string;
  installationId: number;
  repo: string; // "owner/name"
  languages: string[];
  vars: Record<string, string>;
  exclude: string[];
}

export class ChildWorkflow extends WorkflowEntrypoint<Env, ChildParams> {
  async run(event: WorkflowEvent<ChildParams>, step: WorkflowStep): Promise<void> {
    const p = event.payload;
    try {
      const token = await step.do("mint token", async () =>
        retry(async () => {
          const jwt = await createAppJwt({
            appId: this.env.APP_ID,
            privateKeyPem: this.env.APP_PRIVATE_KEY,
          });
          return (await createInstallationToken({ appJwt: jwt, installationId: p.installationId }))
            .token;
        }),
      );

      const client = new GitHubClient({ token });
      const io = new RepoIO({ client, repo: p.repo });
      const templates = new GitHubTemplateSource({ client, repo: this.env.TEMPLATES_REPO });

      const desired = await step.do("resolve desired", async () =>
        retry(() =>
          resolveDesiredEntries({
            source: templates,
            languages: p.languages,
            vars: p.vars,
            exclude: p.exclude,
          }),
        ),
      );

      const base = await step.do("default branch", () => retry(() => io.getDefaultBranch()));
      const actual = await step.do("read actual", () =>
        retry(() =>
          io.readActualFiles(
            desired.map((d) => d.path),
            base.branch,
          ),
        ),
      );

      let changes: FileChange[];
      try {
        changes = computeChanges(desired, actual);
      } catch (err) {
        if (err instanceof RenovateParseError) {
          // パース不能な renovate.json はリトライ無意味な恒久エラー。
          // failed を記録して静かに終える（exclude で自前管理に逃がす運用）。
          await recordRepoResult(this.env.RUNS, p.runId, {
            account: p.account,
            repo: p.repo,
            status: "failed",
            error: err.message,
          });
          return;
        }
        throw err;
      }

      const pr = await step.do("find pr", () => retry(() => io.findPr(BRANCH)));
      const branchExists = await step.do("branch exists", () =>
        retry(() => io.branchExists(BRANCH)),
      );
      const prState: PrState = pr ? (pr.merged ? "merged" : pr.state) : "none";
      const decision = decideBranchAction({
        hasDiff: changes.length > 0,
        branchExists,
        pr: prState,
      });

      // --- no-write actions ------------------------------------------------
      if (decision.action === "noop") {
        await recordRepoResult(this.env.RUNS, p.runId, {
          account: p.account,
          repo: p.repo,
          status: "noop",
        });
        return;
      }
      if (decision.action === "delete-branch") {
        await step.do("delete branch", () => retry(() => io.deleteBranch(BRANCH)));
        await recordRepoResult(this.env.RUNS, p.runId, {
          account: p.account,
          repo: p.repo,
          status: "noop",
        });
        return;
      }

      // --- write actions ---------------------------------------------------
      // create-branch-and-pr        : ブランチ無し → 新規 ref + 新規 PR
      // update-branch-and-create-pr : ブランチ有り/PR無し → 既存 ref 更新 + 新規 PR
      // update-branch (reopen?)     : ブランチ有り/PR有り → 既存 ref 更新 (必要なら reopen, PR新規作成しない)
      // recreate-branch-new-pr      : PR merged → 古い ref を消して新規 ref + 新規 PR
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
            create: createRef,
          });
        }),
      );

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
                body: PR_BODY,
              });
            } catch (err) {
              // crash-after-create のリトライで PR が既に存在する場合 (422)、
              // 失敗扱いにせず既存 PR を解決する。
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
      }

      await recordRepoResult(this.env.RUNS, p.runId, {
        account: p.account,
        repo: p.repo,
        status: "success",
        prNumber,
      });
    } catch (err) {
      await recordRepoResult(this.env.RUNS, p.runId, {
        account: p.account,
        repo: p.repo,
        status: "failed",
        error: String(err),
      });
      throw err; // Workflows のリトライに委ねる
    }
  }
}
