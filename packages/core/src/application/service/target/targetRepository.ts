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
