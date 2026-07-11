import { DistFileRecord, DistRecord, Sha256 } from "@repository-fanout/core";

/**
 * KV 保存スキーマ(spec v2 §5.3)。保存形式の所有者はこの datasource — core は関知しない。
 * version は保存形式のバージョン。hashes は生 hex 履歴。step 間の運搬もこの形で行う。
 */
export interface StoredDistFileRecord {
  strategy: "replace" | "create-only";
  hashes: string[];
}
export interface StoredDistRecord {
  version: 1;
  files: Record<string, StoredDistFileRecord>;
}

// MANIFESTS namespace に同居(prefix が異なるため manifest:/run: と衝突しない)。
// TTL なし=無期限(spec v2 §5.3: 削除追従の記録は失効させない)。
const key = (account: string, repo: string) => `dist:${account}:${repo}`;

/** KV 生値 → 保存形。null(未記録)は空。未知 version は fail fast(spec §5.3)。 */
function parseStored(raw: string | null): StoredDistRecord {
  if (raw === null) return { version: 1, files: {} };
  const o = JSON.parse(raw) as Partial<StoredDistRecord>;
  if (o.version !== 1 || typeof o.files !== "object" || o.files === null) {
    throw new Error(`dist record: unsupported shape (version=${String(o.version)})`);
  }
  return { version: 1, files: o.files };
}

/** 保存形 → 集約(読出・step 受取時の載せ替え)。 */
export function toDistRecord(stored: StoredDistRecord): DistRecord {
  const files = new Map<string, DistFileRecord>();
  for (const [path, rec] of Object.entries(stored.files)) {
    files.set(
      path,
      new DistFileRecord(
        rec.strategy,
        rec.hashes.map((h) => Sha256.fromHex(h)),
      ),
    );
  }
  return new DistRecord(files);
}

/** 集約 → 保存形(書込・step 運搬用)。 */
export function toStored(record: DistRecord): StoredDistRecord {
  const files: Record<string, StoredDistFileRecord> = {};
  for (const [path, rec] of record.files()) {
    files[path] = { strategy: rec.strategy, hashes: rec.hashes.map((h) => h.toString()) };
  }
  return { version: 1, files };
}

export async function getDistRecord(
  kv: KVNamespace,
  account: string,
  repo: string,
): Promise<StoredDistRecord> {
  return parseStored(await kv.get(key(account, repo)));
}

export async function putDistRecord(
  kv: KVNamespace,
  account: string,
  repo: string,
  record: StoredDistRecord,
): Promise<void> {
  await kv.put(key(account, repo), JSON.stringify(record));
}
