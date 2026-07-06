/** リポ単位の reconcile 結果（run 記録・KV/step 境界を越える plain データ）。 */
export interface RepoResult {
  account: string;
  repo: string;
  status: "success" | "noop" | "failed";
  prNumber?: number;
  error?: string;
}
