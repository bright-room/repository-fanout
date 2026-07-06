import type { DistRecord } from "../../../domain/model/retraction/distRecord.js";

/** 配布記録（削除追従のハッシュ履歴）の永続化ポート。 */
export interface DistRecordRepository {
  /** 配布記録。未記録は空 record（正常系）。 */
  get(account: string, repo: string): Promise<DistRecord>;
  save(account: string, repo: string, record: DistRecord): Promise<void>;
}
