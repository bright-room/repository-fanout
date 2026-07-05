import { isNewerRevision, type Manifest, parseManifest } from "@repository-fanout/core";

const key = (account: string) => `manifest:${account}`;

export async function getManifest(kv: KVNamespace, account: string): Promise<Manifest | null> {
  const raw = await kv.get(key(account));
  return raw ? parseManifest(JSON.parse(raw)) : null;
}

/**
 * getManifest の耐性版: 不在も「現行スキーマでパース不能(旧 vars 等の残骸)」も null を返す。
 * 保存済み manifest が壊れていても、読み取り(一覧)と書き込み(CAS)がデッドロックしないための土台。
 * — 過去に worker を厳格化(vars 拒否)しつつ KV を移行しなかった結果、
 *   「壊れた current を読まないと新しいのを書けないが、読むと throw する」自己修復不能状態に陥った。
 *   壊れた current は「無し」扱いにすることで、次の sync が自動で上書き(self-heal)できる。
 */
export async function getManifestSafe(kv: KVNamespace, account: string): Promise<Manifest | null> {
  const raw = await kv.get(key(account));
  if (!raw) return null;
  try {
    return parseManifest(JSON.parse(raw));
  } catch (e) {
    console.error(
      `stored manifest for ${account} is unparseable; treating as absent (self-heal): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
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
  // 壊れた current(旧スキーマ残骸等)は「無し」扱いで上書き = 書き込み経路をデッドロックさせない
  const current = await getManifestSafe(kv, valid.account);
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
      // 壊れた 1 件が全アカウントの reconcile を巻き添えにしないよう skip(self-heal を待つ)
      const m = await getManifestSafe(kv, k.name.slice("manifest:".length));
      if (m) out.push(m);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
