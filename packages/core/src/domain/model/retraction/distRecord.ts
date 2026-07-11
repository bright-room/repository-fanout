import { Sha256 } from "../../type/sha256.js";

export type DistStrategy = "replace" | "create-only";

/** KV 境界を越える plain 形(spec v2 §5.3)。hashes は生 hex 履歴。 */
export interface DistFileRecordData {
  strategy: DistStrategy;
  hashes: string[];
}
export interface DistRecordData {
  version: 1;
  files: Record<string, DistFileRecordData>;
}

/** 配布実績(recordDistribution の入力)。hash は Sha256。 */
export interface Distributed {
  path: string;
  strategy: DistStrategy;
  hash: Sha256;
}

/** 削除候補だったが残置したファイル(PR 本文注記用)。 */
export interface KeptFile {
  path: string;
  reason: "modified" | "excluded";
}

/** planRetraction の結果。record は更新後の集約。 */
export interface RetractionPlan {
  deletions: string[];
  record: DistRecord;
  kept: KeptFile[];
}

/** planRetraction の入力。 */
export interface RetractionArgs {
  /** 今回の望ましい状態に含まれる配布先パス(全戦略) */
  desiredPaths: string[];
  /** manifest の exclude(管理の引き渡し対象) */
  excluded: string[];
  /** 実ファイル内容(desired ∪ record のパス分。不在パスはキー無し) */
  actual: Record<string, string>;
}

interface DistFileRecord {
  strategy: DistStrategy;
  hashes: Sha256[];
}

/**
 * 配布記録(spec v2 §5.3)の集約。replace/create-only で「fanout が配ったファイル」を
 * リポ単位で記録し、記録照合型の削除の安全ガード(§5.4「配ったと証明できるものしか消さない」)を担う。
 * KV/step 境界は from(data)/toData() で越える(クラスは境界を越えない)。
 */
export class DistRecord {
  private constructor(private readonly files: Map<string, DistFileRecord>) {}

  static empty(): DistRecord {
    return new DistRecord(new Map());
  }

  /** KV 生値をパース。null(未記録)は空。未知 version は fail fast。 */
  static parse(raw: string | null): DistRecord {
    if (raw === null) return DistRecord.empty();
    const o = JSON.parse(raw) as Partial<DistRecordData>;
    if (o.version !== 1 || typeof o.files !== "object" || o.files === null) {
      throw new Error(`dist record: unsupported shape (version=${String(o.version)})`);
    }
    return DistRecord.from({ version: 1, files: o.files });
  }

  /** 検証済み plain から復元。 */
  static from(data: DistRecordData): DistRecord {
    const files = new Map<string, DistFileRecord>();
    for (const [path, rec] of Object.entries(data.files)) {
      files.set(path, { strategy: rec.strategy, hashes: rec.hashes.map((h) => Sha256.fromHex(h)) });
    }
    return new DistRecord(files);
  }

  /** KV 保存用 plain(生 hex)。 */
  toData(): DistRecordData {
    const files: Record<string, DistFileRecordData> = {};
    for (const [path, rec] of this.files) {
      files[path] = { strategy: rec.strategy, hashes: rec.hashes.map((h) => h.toString()) };
    }
    return { version: 1, files };
  }

  /** 配布(またはハッシュ一致採用)を追記した新レコードを返す(非破壊)。 */
  recordDistribution(distributed: Distributed[]): DistRecord {
    const files = new Map(this.files);
    for (const d of distributed) {
      const prev = files.get(d.path);
      const hashes = prev ? [...prev.hashes] : [];
      if (!hashes.some((h) => h.equals(d.hash))) hashes.push(d.hash);
      files.set(d.path, { strategy: d.strategy, hashes });
    }
    return new DistRecord(files);
  }

  /**
   * 削除判定(spec v2 §5.4/§5.5)。不変条件: 記録ハッシュのいずれかと完全一致するものしか
   * deletions に入れない。全曖昧ケースは「残す」に倒す。
   */
  async planRetraction(args: RetractionArgs): Promise<RetractionPlan> {
    const desired = new Set(args.desiredPaths);
    const excluded = new Set(args.excluded);
    const deletions: string[] = [];
    const kept: KeptFile[] = [];
    const files = new Map(this.files);

    for (const [path, rec] of this.files) {
      if (desired.has(path)) continue;
      if (excluded.has(path)) {
        files.delete(path);
        kept.push({ path, reason: "excluded" });
        continue;
      }
      const current = args.actual[path];
      if (current === undefined) {
        files.delete(path);
        continue;
      }
      const hash = await Sha256.of(current);
      if (rec.hashes.some((h) => h.equals(hash))) {
        deletions.push(path);
      } else {
        files.delete(path);
        kept.push({ path, reason: "modified" });
      }
    }
    deletions.sort();
    kept.sort((a, b) => a.path.localeCompare(b.path));
    return { deletions, record: new DistRecord(files), kept };
  }
}
