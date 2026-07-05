import type { Manifest, RepoEntry } from "./types.js";

export function parseManifest(input: unknown): Manifest {
  if (typeof input !== "object" || input === null) throw new Error("manifest: not an object");
  const o = input as Record<string, unknown>;

  if (typeof o.account !== "string" || o.account.length === 0)
    throw new Error("manifest: account required");
  if (typeof o.revision !== "number" || !Number.isInteger(o.revision))
    throw new Error("manifest: integer revision required");
  if (typeof o.sourceCommit !== "string" || o.sourceCommit.length === 0)
    throw new Error("manifest: sourceCommit required");
  if (typeof o.repositories !== "object" || o.repositories === null)
    throw new Error("manifest: repositories required");

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

    let bundles: string[] = [];
    if (entry.bundles !== undefined) {
      if (!Array.isArray(entry.bundles) || !entry.bundles.every((b) => typeof b === "string")) {
        throw new Error(`manifest: ${name}.bundles must be an array of strings`);
      }
      bundles = entry.bundles as string[];
    }

    let exclude: string[] = [];
    if (entry.exclude !== undefined) {
      if (!Array.isArray(entry.exclude) || !entry.exclude.every((e) => typeof e === "string")) {
        throw new Error(`manifest: ${name}.exclude must be an array of strings`);
      }
      exclude = entry.exclude as string[];
    }

    // contents は vars の後継(spec v3 §8)。移行期間中は両キーを受理するが、
    // 両方の同時宣言はどちらが勝つか曖昧なのでエラー。Manifest は HTTP/KV 境界を
    // 越える値なので plain + parse 関数のまま(core 構造設計 §4)。
    let varsSource = entry.vars;
    if (entry.contents !== undefined) {
      if (entry.vars !== undefined) {
        throw new Error(`manifest: ${name}: declare either contents or vars, not both`);
      }
      varsSource = entry.contents;
    }

    let vars: Record<string, string> = {};
    if (varsSource !== undefined) {
      if (typeof varsSource !== "object" || varsSource === null || Array.isArray(varsSource)) {
        throw new Error(`manifest: ${name}.vars must be an object of string values`);
      }
      for (const [k, v] of Object.entries(varsSource)) {
        if (typeof v !== "string") throw new Error(`manifest: ${name}.vars.${k} must be a string`);
      }
      vars = varsSource as Record<string, string>;
    }

    repositories[name] = { languages: entry.languages as string[], bundles, vars, exclude };
  }
  return { account: o.account, revision: o.revision, sourceCommit: o.sourceCommit, repositories };
}

/** 受信 revision が現行 KV revision より新しいか（CAS）。current 未定義＝初回で常に true。 */
export function isNewerRevision(incoming: number, current: number | undefined): boolean {
  return current === undefined ? true : incoming > current;
}
