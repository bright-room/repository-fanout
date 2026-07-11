import { Sha256 } from "../../type/sha256.js";

export type DistStrategy = "replace" | "create-only";

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

/** planRetraction の入力(P2 で隣接集約のモデル化とともに解体予定)。 */
export interface RetractionArgs {
  /** 今回の望ましい状態に含まれる配布先パス(全戦略) */
  desiredPaths: string[];
  /** manifest の exclude(管理の引き渡し対象) */
  excluded: string[];
  /** 実ファイル内容(desired ∪ record のパス分。不在パスはキー無し) */
  actual: Record<string, string>;
}

/** ファイル1件の配布記録。ハッシュ履歴が「配った証明」(spec §4.7 matchesRecorded)を担う。 */
export class DistFileRecord {
  constructor(
    readonly strategy: DistStrategy,
    readonly hashes: readonly Sha256[],
  ) {}

  /** 記録ハッシュのいずれかと完全一致するか =「配った証明」。 */
  matches(hash: Sha256): boolean {
    return this.hashes.some((h) => h.equals(hash));
  }

  /** 配布を追記した新記録を返す(非破壊)。記録済みハッシュは重複させない。 */
  withDistributed(strategy: DistStrategy, hash: Sha256): DistFileRecord {
    const hashes = this.matches(hash) ? this.hashes : [...this.hashes, hash];
    return new DistFileRecord(strategy, hashes);
  }
}

/**
 * 配布記録(spec v2 §5.3)の集約。replace/create-only で「fanout が配ったファイル」を
 * リポ単位で記録し、記録照合型の削除の安全ガード(§5.4「配ったと証明できるものしか消さない」)を担う。
 * 保存形式(KV スキーマ・JSON)は関知しない — 永続化の載せ替えは apps 側 datasource の責務。
 */
export class DistRecord {
  private constructor(private readonly fileRecords: Map<string, DistFileRecord>) {}

  static empty(): DistRecord {
    return new DistRecord(new Map());
  }

  /** 復元用ファクトリ(datasource が保存形から載せ替える)。 */
  static of(files: ReadonlyMap<string, DistFileRecord>): DistRecord {
    return new DistRecord(new Map(files));
  }

  /** 永続化マッピング用の読み出しアクセサ。 */
  files(): ReadonlyMap<string, DistFileRecord> {
    return this.fileRecords;
  }

  /** 配布(またはハッシュ一致採用)を追記した新レコードを返す(非破壊)。 */
  recordDistribution(distributed: Distributed[]): DistRecord {
    const files = new Map(this.fileRecords);
    for (const d of distributed) {
      const prev = files.get(d.path) ?? new DistFileRecord(d.strategy, []);
      files.set(d.path, prev.withDistributed(d.strategy, d.hash));
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
    const files = new Map(this.fileRecords);

    for (const [path, rec] of this.fileRecords) {
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
      if (rec.matches(await Sha256.of(current))) {
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
