/**
 * 配布記録(spec v2 §5.3)。replace / create-only で「fanout が配ったファイル」を
 * リポ単位で記録する。hashes は配布した描画結果のハッシュ履歴(時間差 merge 対応)。
 * managed-block / extends-field はマーカー・universe から自明なので記録しない。
 */
export interface DistFileRecord {
  strategy: "replace" | "create-only";
  hashes: string[];
}

export interface DistRecord {
  version: 1;
  files: Record<string, DistFileRecord>;
}

export function emptyDistRecord(): DistRecord {
  return { version: 1, files: {} };
}

/** KV の生値をパース。null(未記録)は空レコード。未知 version は fail fast。 */
export function parseDistRecord(raw: string | null): DistRecord {
  if (raw === null) return emptyDistRecord();
  const o = JSON.parse(raw) as Partial<DistRecord>;
  if (o.version !== 1 || typeof o.files !== "object" || o.files === null) {
    throw new Error(`dist record: unsupported shape (version=${String(o.version)})`);
  }
  return { version: 1, files: o.files };
}

export interface Distributed {
  path: string;
  strategy: "replace" | "create-only";
  hash: string;
}

/** 配布(またはハッシュ一致による採用)をレコードへ追記した新レコードを返す(非破壊)。 */
export function recordDistribution(record: DistRecord, distributed: Distributed[]): DistRecord {
  const files = { ...record.files };
  for (const d of distributed) {
    const prev = files[d.path];
    const hashes = prev ? [...prev.hashes] : [];
    if (!hashes.includes(d.hash)) hashes.push(d.hash);
    files[d.path] = { strategy: d.strategy, hashes };
  }
  return { version: 1, files };
}
