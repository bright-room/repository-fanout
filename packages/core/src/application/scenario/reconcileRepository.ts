import type { TemplateSource } from "../../domain/model/canonical/templateSource.js";
import { computeChanges } from "../../domain/model/desired/computeChanges.js";
import { resolveDesired } from "../../domain/model/desired/derive.js";
import type { DesiredFileData } from "../../domain/model/desired/desiredFileData.js";

/**
 * 1 リポの reconcile の進行役(spec v2 §5.4 / core 構造設計 §6)。
 * 各関数が Workflows の 1 step に対応: 進行の知識はここに一本化し、
 * 実行制御(retry / step.do / 並行)は apps に残す。step 間は plain データで受け渡す。
 * 削除追従計画(step 4)は DistRecord.planRetraction(集約側)が担う。
 */
export interface ReconcileDeclaration {
  languages: string[];
  bundles: string[];
  vars: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/** step 1: 望ましい状態の導出(v3 catalog/profiles から) */
export function resolveDesiredStep(
  source: TemplateSource,
  decl: ReconcileDeclaration,
): Promise<DesiredFileData[]> {
  return resolveDesired({ source, ...decl });
}

/** step 2: 実ファイルを読むべきパス = 望ましい状態 ∪ 配布記録だけにあるパス(削除候補) */
export function pathsToRead(desired: DesiredFileData[], recordedPaths: string[]): string[] {
  const desiredPaths = desired.map((d) => d.path);
  const recordOnly = recordedPaths.filter((p) => !desiredPaths.includes(p));
  return [...desiredPaths, ...recordOnly];
}

/** step 3: 差分計算(既存関数をそのまま進行に位置づける) */
export { computeChanges as computeChangesStep };
