export const BLOCK_START = "# >>> repository-fanout managed >>>";
export const BLOCK_END = "# <<< repository-fanout managed <<<";

/** marker が text 内に「行として」（行頭かつ行末で）現れる最初の位置。無ければ -1 */
function findMarkerLine(text: string, marker: string, from = 0): number {
  let idx = text.indexOf(marker, from);
  while (idx !== -1) {
    const atLineStart = idx === 0 || text[idx - 1] === "\n";
    const after = idx + marker.length;
    const atLineEnd = after === text.length || text[after] === "\n";
    if (atLineStart && atLineEnd) return idx;
    idx = text.indexOf(marker, idx + 1);
  }
  return -1;
}

/** text のいずれかの行が marker と完全一致するか */
function hasMarkerLine(text: string, marker: string): boolean {
  return findMarkerLine(text, marker) !== -1;
}

/**
 * managed-block 戦略：actual にブロックがあれば中身だけ差し替え、
 * 無ければ先頭に挿入、actual 不在ならブロックのみで新規作成。
 *
 * マーカーは「行全体」として照合する（行内の部分一致は無視）ため、
 * 行内にマーカー文字列を含むだけのリポ独自行を誤ってブロック扱いしない。
 * blockContent 自身がマーカー行を含むと START/END の対応が曖昧になり
 * （＝リポ独自部分を巻き込む恐れがある）ので、その場合は例外にする。
 */
export function applyManagedBlock(actual: string | undefined, blockContent: string): string {
  if (hasMarkerLine(blockContent, BLOCK_START) || hasMarkerLine(blockContent, BLOCK_END)) {
    throw new Error("managed block content must not contain a repository-fanout marker line");
  }
  const blockText = `${BLOCK_START}\n${blockContent}\n${BLOCK_END}`;
  if (actual === undefined) return `${blockText}\n`;
  const start = findMarkerLine(actual, BLOCK_START);
  const end = start === -1 ? -1 : findMarkerLine(actual, BLOCK_END, start + BLOCK_START.length);
  if (start !== -1 && end > start) {
    return actual.slice(0, start) + blockText + actual.slice(end + BLOCK_END.length);
  }
  return `${blockText}\n${actual}`;
}
