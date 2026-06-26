export type PrState = "open" | "closed" | "merged" | "none";

export interface BranchInput {
  hasDiff: boolean;
  branchExists: boolean;
  pr: PrState;
}

export type BranchAction =
  | { action: "noop" }
  | { action: "update-branch"; reopen?: boolean }
  | { action: "recreate-branch-new-pr" }
  | { action: "create-branch-and-pr" }
  | { action: "update-branch-and-create-pr" }
  | { action: "delete-branch" };

/** spec §5 のブランチ/PR ライフサイクル表を実装 */
export function decideBranchAction(input: BranchInput): BranchAction {
  const { hasDiff, branchExists, pr } = input;

  if (hasDiff) {
    if (pr === "open") return { action: "update-branch" };
    if (pr === "closed") return { action: "update-branch", reopen: true };
    if (pr === "merged") return { action: "recreate-branch-new-pr" };
    // pr none: 既存ブランチがあれば再作成せず更新（再試行時の 422 回避）
    return branchExists
      ? { action: "update-branch-and-create-pr" }
      : { action: "create-branch-and-pr" };
  }

  // 差分なし
  if (pr === "merged" && branchExists) return { action: "delete-branch" };
  return { action: "noop" };
}
