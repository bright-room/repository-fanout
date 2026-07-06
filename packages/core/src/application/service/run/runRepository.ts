import type { RepoResult } from "../../../domain/model/run/repoResult.js";

/** run（1 回の kick）のリポ単位結果の永続化ポート。 */
export interface RunRepository {
  record(runId: string, result: RepoResult): Promise<void>;
  getRun(runId: string): Promise<RepoResult[]>;
}
