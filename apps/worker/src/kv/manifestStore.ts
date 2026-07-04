import { isNewerRevision, type Manifest, parseManifest } from "@repository-fanout/core";

const key = (account: string) => `manifest:${account}`;

export async function getManifest(kv: KVNamespace, account: string): Promise<Manifest | null> {
  const raw = await kv.get(key(account));
  return raw ? parseManifest(JSON.parse(raw)) : null;
}

/**
 * NOTE: KV にはアトミックな compare-and-swap が無いため、これは read-then-write の
 * last-writer-wins。manifest push は低頻度なので競合はほぼ起きず、許容する。
 *
 * revision 意味論(spec v2 §6.1): 厳密に古い revision のみ stale=true で拒否。
 * 同一 revision は「保存不要・ただし再実行(reconcile 起動)は許可」— これにより
 * 「保存成功+起動失敗 → 同一 revision の再送が stale 扱いで永久に起動しない」穴を塞ぐ。
 */
export async function putManifestCas(
  kv: KVNamespace,
  manifest: Manifest,
): Promise<{ stored: boolean; stale: boolean }> {
  const valid = parseManifest(manifest); // 再検証
  const current = await getManifest(kv, valid.account);
  if (current && valid.revision < current.revision) return { stored: false, stale: true };
  if (!isNewerRevision(valid.revision, current?.revision)) return { stored: false, stale: false };
  await kv.put(key(valid.account), JSON.stringify(valid));
  return { stored: true, stale: false };
}

export async function listManifests(kv: KVNamespace): Promise<Manifest[]> {
  const out: Manifest[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "manifest:", cursor });
    for (const k of page.keys) {
      const m = await getManifest(kv, k.name.slice("manifest:".length));
      if (m) out.push(m);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
