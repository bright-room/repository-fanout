export const BLOCK_START = "# >>> repository-fanout managed >>>";
export const BLOCK_END = "# <<< repository-fanout managed <<<";

/**
 * managed-block 戦略：actual にブロックがあれば中身だけ差し替え、
 * 無ければ先頭に挿入、actual 不在ならブロックのみで新規作成。
 */
export function applyManagedBlock(actual: string | undefined, blockContent: string): string {
  const blockText = `${BLOCK_START}\n${blockContent}\n${BLOCK_END}`;
  if (actual === undefined) return `${blockText}\n`;
  const start = actual.indexOf(BLOCK_START);
  const end = actual.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    return actual.slice(0, start) + blockText + actual.slice(end + BLOCK_END.length);
  }
  return `${blockText}\n${actual}`;
}
