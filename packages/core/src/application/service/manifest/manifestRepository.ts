import type { Manifest } from "../../../domain/model/manifest/types.js";

/** manifest の永続化ポート（実装は infrastructure-cloudflare の KV）。 */
export interface ManifestRepository {
  /** 保存済み manifest（厳密パース）。不在は ResourceNotFoundException、壊れは Error。 */
  get(account: string): Promise<Manifest>;
  /** self-heal 読取: 不在・パース不能はいずれも null。 */
  findUsable(account: string): Promise<Manifest | null>;
  /** 全 manifest（壊れた 1 件は skip して self-heal を待つ）。 */
  list(): Promise<Manifest[]>;
  /** 厳密に古い revision は拒否(stale=true)、新しければ保存。同一 revision は保存せず stale=false。 */
  saveIfNotStale(manifest: Manifest): Promise<{ stored: boolean; stale: boolean }>;
}
