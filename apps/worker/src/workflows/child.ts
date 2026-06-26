import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  GitHubClient, createAppJwt, createInstallationToken,
  resolveDesiredFiles, computeChanges, decideBranchAction,
  type PrState,
} from "@repository-fanout/core";
import { GitHubTemplateSource } from "../github/templateSource.js";
import { RepoIO } from "../github/repoIO.js";
import { recordRepoResult } from "../kv/runStore.js";
import type { Env } from "../index.js";

const BRANCH = "chore/distribute-common-files";
const PR_TITLE = "chore: distribute common files";
const PR_BODY = "🤖 distributed by repository-fanout";
const PR_LABELS = ["Kind: Dependencies"];

export interface ChildParams {
  runId: string;
  account: string;
  installationId: number;
  repo: string;            // "owner/name"
  profiles: string[];
  vars: Record<string, string>;
  exclude: string[];
}

export class ChildWorkflow extends WorkflowEntrypoint<Env, ChildParams> {
  async run(event: WorkflowEvent<ChildParams>, step: WorkflowStep): Promise<void> {
    const p = event.payload;
    try {
      const token = await step.do("mint token", async () => {
        const jwt = await createAppJwt({ appId: this.env.APP_ID, privateKeyPem: this.env.APP_PRIVATE_KEY });
        return (await createInstallationToken({ appJwt: jwt, installationId: p.installationId })).token;
      });

      const client = new GitHubClient({ token });
      const io = new RepoIO({ client, repo: p.repo });
      const templates = new GitHubTemplateSource({ client, repo: this.env.TEMPLATES_REPO });

      const desired = await step.do("resolve desired", async () =>
        resolveDesiredFiles({ source: templates, profiles: p.profiles, vars: p.vars, exclude: p.exclude }),
      );

      const base = await step.do("default branch", () => io.getDefaultBranch());
      const actual = await step.do("read actual", () => io.readActualFiles(desired.map((d) => d.path), base.branch));
      const changes = computeChanges(desired, actual);

      const pr = await step.do("find pr", () => io.findPr(BRANCH));
      const branchExists = await step.do("branch exists", () => io.branchExists(BRANCH));
      const prState: PrState = pr ? (pr.merged ? "merged" : pr.state) : "none";
      const decision = decideBranchAction({ hasDiff: changes.length > 0, branchExists, pr: prState });

      // --- no-write actions ------------------------------------------------
      if (decision.action === "noop") {
        await recordRepoResult(this.env.RUNS, p.runId, { account: p.account, repo: p.repo, status: "noop" });
        return;
      }
      if (decision.action === "delete-branch") {
        await step.do("delete branch", () => io.deleteBranch(BRANCH));
        await recordRepoResult(this.env.RUNS, p.runId, { account: p.account, repo: p.repo, status: "noop" });
        return;
      }

      // --- write actions ---------------------------------------------------
      // create-branch-and-pr        : ブランチ無し → 新規 ref + 新規 PR
      // update-branch-and-create-pr : ブランチ有り/PR無し → 既存 ref 更新 + 新規 PR
      // update-branch (reopen?)     : ブランチ有り/PR有り → 既存 ref 更新 (必要なら reopen, PR新規作成しない)
      // recreate-branch-new-pr      : PR merged → 古い ref を消して新規 ref + 新規 PR
      const createRef =
        decision.action === "create-branch-and-pr" ||
        decision.action === "recreate-branch-new-pr";
      const createPr =
        decision.action === "create-branch-and-pr" ||
        decision.action === "update-branch-and-create-pr" ||
        decision.action === "recreate-branch-new-pr";

      if (decision.action === "recreate-branch-new-pr" && branchExists) {
        await step.do("delete stale branch", () => io.deleteBranch(BRANCH));
      }

      await step.do("commit", async () => {
        const treeSha = await io.getTreeSha(base.sha);
        await io.commitChanges({
          branch: BRANCH, baseSha: base.sha, baseTreeSha: treeSha,
          message: PR_TITLE, changes, create: createRef,
        });
      });

      let prNumber = pr?.number;
      if (decision.action === "update-branch" && decision.reopen && prNumber !== undefined) {
        const reopenNumber = prNumber;
        await step.do("reopen pr", () => io.reopenPr(reopenNumber));
      }
      if (createPr) {
        const created = await step.do("create pr", () => io.createPr({
          branch: BRANCH, base: base.branch, title: PR_TITLE, body: PR_BODY,
        }));
        prNumber = created;
        await step.do("label", () => io.addLabels(created, PR_LABELS));
      }

      await recordRepoResult(this.env.RUNS, p.runId, { account: p.account, repo: p.repo, status: "success", prNumber });
    } catch (err) {
      await recordRepoResult(this.env.RUNS, p.runId, {
        account: p.account, repo: p.repo, status: "failed", error: String(err),
      });
      throw err; // Workflows のリトライに委ねる
    }
  }
}
