import type { Manifest, RepoEntry } from "./types.js";

export function parseManifest(input: unknown): Manifest {
  if (typeof input !== "object" || input === null) throw new Error("manifest: not an object");
  const o = input as Record<string, unknown>;

  if (typeof o.account !== "string" || o.account.length === 0) throw new Error("manifest: account required");
  if (typeof o.revision !== "number" || !Number.isInteger(o.revision)) throw new Error("manifest: integer revision required");
  if (typeof o.sourceCommit !== "string" || o.sourceCommit.length === 0) throw new Error("manifest: sourceCommit required");
  if (typeof o.repositories !== "object" || o.repositories === null) throw new Error("manifest: repositories required");

  const repos = o.repositories as Record<string, unknown>;
  const names = Object.keys(repos);
  if (names.length === 0) throw new Error("manifest: empty repositories not allowed");

  const repositories: Record<string, RepoEntry> = {};
  for (const name of names) {
    const r = repos[name] as Record<string, unknown>;
    if (!Array.isArray(r?.profiles)) throw new Error(`manifest: ${name}.profiles must be an array`);
    repositories[name] = {
      profiles: r.profiles.map(String),
      vars: (r.vars as Record<string, string>) ?? {},
      exclude: Array.isArray(r.exclude) ? r.exclude.map(String) : [],
    };
  }
  return { account: o.account, revision: o.revision, sourceCommit: o.sourceCommit, repositories };
}

/** 受信 revision が現行 KV revision より新しいか（CAS）。current 未定義＝初回で常に true。 */
export function isNewerRevision(incoming: number, current: number | undefined): boolean {
  return current === undefined ? true : incoming > current;
}
