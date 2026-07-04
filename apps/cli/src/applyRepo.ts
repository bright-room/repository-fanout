import {
  computeChanges,
  decideBranchAction,
  type PrState,
  type RepoIO,
  resolveDesiredEntries,
  type TemplateSource,
} from "@repository-fanout/core";

const BRANCH = "chore/distribute-common-files";
const PR_TITLE = "chore: distribute common files";
const PR_BODY = "🤖 distributed by repository-fanout (manual apply)";

/** RepoIO のうち apply が使う面(テスト注入用) */
export type RepoPortForApply = Pick<
  RepoIO,
  | "getDefaultBranch"
  | "readActualFiles"
  | "findPr"
  | "branchExists"
  | "commitChanges"
  | "getTreeSha"
  | "createPr"
  | "reopenPr"
  | "deleteBranch"
>;

export interface ApplyArgs {
  source: TemplateSource;
  io: RepoPortForApply;
  languages: string[];
  bundles: string[];
  vars: Record<string, string>;
  exclude: string[];
}

/**
 * 手動リコンサイル(spec v2 §7)。worker と同じ core を使い、1リポにブランチ+PR を作る。
 * 制限: KV に触れないため配布記録の更新・削除追従は行わない(worker の reconcile のみ)。
 */
export async function applyRepo(args: ApplyArgs): Promise<{ changed: number; prNumber?: number }> {
  const desired = await resolveDesiredEntries({
    source: args.source,
    languages: args.languages,
    bundles: args.bundles,
    vars: args.vars,
    exclude: args.exclude,
  });
  const io = args.io;
  const base = await io.getDefaultBranch();
  const actual = await io.readActualFiles(
    desired.map((d) => d.path),
    base.branch,
  );
  const changes = computeChanges(desired, actual);

  const pr = await io.findPr(BRANCH);
  const branchExists = await io.branchExists(BRANCH);
  const prState: PrState = pr ? (pr.merged ? "merged" : pr.state) : "none";
  const decision = decideBranchAction({ hasDiff: changes.length > 0, branchExists, pr: prState });

  if (decision.action === "noop") return { changed: 0 };
  if (decision.action === "delete-branch") {
    await io.deleteBranch(BRANCH);
    return { changed: 0 };
  }

  const createRef =
    decision.action === "create-branch-and-pr" || decision.action === "recreate-branch-new-pr";
  const createPr =
    decision.action === "create-branch-and-pr" ||
    decision.action === "update-branch-and-create-pr" ||
    decision.action === "recreate-branch-new-pr";

  if (decision.action === "recreate-branch-new-pr" && branchExists) await io.deleteBranch(BRANCH);

  const treeSha = await io.getTreeSha(base.sha);
  await io.commitChanges({
    branch: BRANCH,
    baseSha: base.sha,
    baseTreeSha: treeSha,
    message: PR_TITLE,
    changes,
    create: createRef,
  });

  let prNumber = pr?.number;
  if (decision.action === "update-branch" && decision.reopen && prNumber !== undefined) {
    await io.reopenPr(prNumber);
  }
  if (createPr) {
    prNumber = await io.createPr({
      branch: BRANCH,
      base: base.branch,
      title: PR_TITLE,
      body: PR_BODY,
    });
  }
  return { changed: changes.length, prNumber };
}
