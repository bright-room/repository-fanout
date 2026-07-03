import { sha256Hex } from "../util/hash.js";
import type { DistRecord } from "./distRecord.js";

export interface RetractionArgs {
  record: DistRecord;
  /** 今回の望ましい状態に含まれる配布先パス(全戦略) */
  desiredPaths: string[];
  /** manifest の exclude(管理の引き渡し対象) */
  excluded: string[];
  /** 実ファイル内容(desired ∪ record のパス分。不在パスはキー無し) */
  actual: Record<string, string>;
}

export interface KeptFile {
  path: string;
  reason: "modified" | "excluded";
}

export interface RetractionPlan {
  /** 配布 PR に含める削除パス */
  deletions: string[];
  /** 更新後レコード(不在=掃除 / 改変・exclude=引き渡し を反映。削除提案分は維持) */
  record: DistRecord;
  /** 削除候補だったが残置したファイル(PR 本文への注記用) */
  kept: KeptFile[];
}

/**
 * 削除判定(spec v2 §5.4 / §5.5)。不変条件: 「fanout が配ったと証明できる
 * (=記録ハッシュのいずれかと完全一致する)ファイル」しか deletions に入れない。
 * 全ての曖昧ケースは「残す」に倒す。
 */
export async function planRetraction(args: RetractionArgs): Promise<RetractionPlan> {
  const desired = new Set(args.desiredPaths);
  const excluded = new Set(args.excluded);
  const deletions: string[] = [];
  const kept: KeptFile[] = [];
  const files = { ...args.record.files };

  for (const [path, rec] of Object.entries(args.record.files)) {
    if (desired.has(path)) continue; // まだ配布対象 → 候補ではない

    if (excluded.has(path)) {
      // exclude = リポが自分で管理する意思表示。消さずに記録から外す(引き渡し)。
      delete files[path];
      kept.push({ path, reason: "excluded" });
      continue;
    }

    const current = args.actual[path];
    if (current === undefined) {
      delete files[path]; // 既に無い(削除 merge 済み等)→ 掃除完了
      continue;
    }

    const hash = await sha256Hex(current);
    if (rec.hashes.includes(hash)) {
      // 配ったままの内容 → 削除を提案。記録は merge 確認(次回 run の「不在」)まで維持。
      deletions.push(path);
    } else {
      delete files[path]; // 改変されている → リポの資産。触らない。
      kept.push({ path, reason: "modified" });
    }
  }

  deletions.sort();
  kept.sort((a, b) => a.path.localeCompare(b.path));
  return { deletions, record: { version: 1, files }, kept };
}
