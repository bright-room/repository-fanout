export interface RepoResult {
  account: string;
  repo: string;
  status: "success" | "noop" | "failed";
  prNumber?: number;
  error?: string;
}

const k = (runId: string, account: string, repo: string) => `run:${runId}:${account}:${repo}`;

export async function recordRepoResult(kv: KVNamespace, runId: string, r: RepoResult): Promise<void> {
  // 90日 TTL
  await kv.put(k(runId, r.account, r.repo), JSON.stringify(r), { expirationTtl: 60 * 60 * 24 * 90 });
}

export async function getRun(kv: KVNamespace, runId: string): Promise<RepoResult[]> {
  const out: RepoResult[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: `run:${runId}:`, cursor });
    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      if (raw) out.push(JSON.parse(raw) as RepoResult);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
