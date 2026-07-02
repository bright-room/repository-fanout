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
    const r = repos[name];
    if (typeof r !== "object" || r === null) throw new Error(`manifest: ${name} must be an object`);
    const entry = r as Record<string, unknown>;

    if (!Array.isArray(entry.languages) || !entry.languages.every((l) => typeof l === "string")) {
      throw new Error(`manifest: ${name}.languages must be an array of strings`);
    }

    let exclude: string[] = [];
    if (entry.exclude !== undefined) {
      if (!Array.isArray(entry.exclude) || !entry.exclude.every((e) => typeof e === "string")) {
        throw new Error(`manifest: ${name}.exclude must be an array of strings`);
      }
      exclude = entry.exclude as string[];
    }

    let vars: Record<string, string> = {};
    if (entry.vars !== undefined) {
      if (typeof entry.vars !== "object" || entry.vars === null || Array.isArray(entry.vars)) {
        throw new Error(`manifest: ${name}.vars must be an object of string values`);
      }
      for (const [k, v] of Object.entries(entry.vars)) {
        if (typeof v !== "string") throw new Error(`manifest: ${name}.vars.${k} must be a string`);
      }
      vars = entry.vars as Record<string, string>;
    }

    repositories[name] = { languages: entry.languages as string[], vars, exclude };
  }
  return { account: o.account, revision: o.revision, sourceCommit: o.sourceCommit, repositories };
}

/** 受信 revision が現行 KV revision より新しいか（CAS）。current 未定義＝初回で常に true。 */
export function isNewerRevision(incoming: number, current: number | undefined): boolean {
  return current === undefined ? true : incoming > current;
}
