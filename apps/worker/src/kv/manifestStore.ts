import { parseManifest, isNewerRevision, type Manifest } from "@repository-fanout/core";

const key = (account: string) => `manifest:${account}`;

export async function getManifest(kv: KVNamespace, account: string): Promise<Manifest | null> {
  const raw = await kv.get(key(account));
  return raw ? parseManifest(JSON.parse(raw)) : null;
}

export async function putManifestCas(
  kv: KVNamespace,
  manifest: Manifest,
): Promise<{ stored: boolean }> {
  const valid = parseManifest(manifest); // 再検証
  const current = await getManifest(kv, valid.account);
  if (!isNewerRevision(valid.revision, current?.revision)) return { stored: false };
  await kv.put(key(valid.account), JSON.stringify(valid));
  return { stored: true };
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
