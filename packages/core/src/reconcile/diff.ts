import type { DesiredFile } from "../templates/types.js";

export interface FileChange {
  path: string;
  content: string;
}

/**
 * desired と「対象リポの実ファイル内容マップ(path->content。存在しないキーは未配置)」を比較し、
 * 書き込むべき変更だけ返す。差分ゼロなら空配列（= no-op）。
 */
export function computeChanges(
  desired: DesiredFile[],
  actual: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const d of desired) {
    const current = actual[d.path];
    if (d.mode === "create-only") {
      if (current === undefined) changes.push({ path: d.path, content: d.content });
      continue;
    }
    // sync
    if (current !== d.content) changes.push({ path: d.path, content: d.content });
  }
  return changes;
}
