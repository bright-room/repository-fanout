import { applyManagedBlock } from "./block.js";
import { applyExtendsField } from "./extendsField.js";
import type { DesiredEntry } from "../templates/types.js";

export interface FileChange {
  path: string;
  content: string;
}

/**
 * desired（戦略付き）と実ファイル内容を突き合わせ、書き込むべき変更を返す。
 * リポ独自部分（ブロック外・extends 外キー・universe 外エントリ）は不可侵。
 * renovate.json がパース不能な場合は RenovateParseError を投げる（呼び出し側で failed 記録）。
 */
export function computeChanges(
  desired: DesiredEntry[],
  actual: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const d of desired) {
    const current = actual[d.path];
    switch (d.strategy) {
      case "replace":
        if (current !== d.content) changes.push({ path: d.path, content: d.content });
        break;
      case "create-only":
        if (current === undefined) changes.push({ path: d.path, content: d.content });
        break;
      case "managed-block": {
        const next = applyManagedBlock(current, d.blockContent);
        if (next !== current) changes.push({ path: d.path, content: next });
        break;
      }
      case "extends-field": {
        if (current === undefined) {
          changes.push({ path: d.path, content: d.createContent });
          break;
        }
        const next = applyExtendsField(current, d.managedExtends, d.universe);
        if (next !== null) changes.push({ path: d.path, content: next });
        break;
      }
      default: {
        // 5 番目の戦略を追加したらここがコンパイルエラーになる（silent no-op を防ぐ）。
        const _exhaustive: never = d;
        throw new Error(`unknown desired entry strategy: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  return changes;
}
