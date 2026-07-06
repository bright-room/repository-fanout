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
