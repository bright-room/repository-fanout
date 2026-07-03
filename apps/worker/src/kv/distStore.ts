import { type DistRecord, parseDistRecord } from "@repository-fanout/core";

// MANIFESTS namespace に同居(prefix が異なるため manifest:/run: と衝突しない)。
// TTL なし=無期限(spec v2 §5.3: 削除追従の記録は失効させない)。
const key = (account: string, repo: string) => `dist:${account}:${repo}`;

export async function getDistRecord(
  kv: KVNamespace,
  account: string,
  repo: string,
): Promise<DistRecord> {
  return parseDistRecord(await kv.get(key(account, repo)));
}

export async function putDistRecord(
  kv: KVNamespace,
  account: string,
  repo: string,
  record: DistRecord,
): Promise<void> {
  await kv.put(key(account, repo), JSON.stringify(record));
}
