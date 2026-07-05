import type { FileChange } from "../reconcile/fileChange.js";
import { DesiredFile } from "./desiredFile.js";
import type { DesiredFileData } from "./desiredFileData.js";

export type { FileChange };

/**
 * desired(plain)と実ファイル内容を突き合わせ、書き込むべき変更を返す。
 * 戦略別の判断は DesiredFile 階層(applyTo)に委譲。ここは境界の載せ替えだけ
 * (core 構造設計 §4: step.do を越えてきた plain データをドメインオブジェクトに戻す)。
 */
export function computeChanges(
  desired: DesiredFileData[],
  actual: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const d of desired) {
    const change = DesiredFile.from(d).applyTo(actual[d.path]);
    if (change !== null) changes.push(change);
  }
  return changes;
}
