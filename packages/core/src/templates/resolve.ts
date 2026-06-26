import { renderGitignore, renderRenovateExtends, substituteVars } from "./render.js";
import type { DesiredFile, ProfileManifest, TemplateSource } from "./types.js";

export interface ResolveArgs {
  source: TemplateSource;
  profiles: string[];
  vars: Record<string, string>;
  exclude: string[];
}

const COMPOSED: Record<string, "renovate_extends" | "gitignore"> = {
  "base/files/renovate.json": "renovate_extends",
  "base/files/.gitignore": "gitignore",
};

/** "base/files/foo" -> "foo", "profiles/x/files/foo" -> "foo", "seeds/foo" -> "foo" */
function destPath(fullPath: string): string {
  return fullPath
    .replace(/^base\/files\//, "")
    .replace(/^profiles\/[^/]+\/files\//, "")
    .replace(/^seeds\//, "");
}

export async function resolveDesiredFiles(args: ResolveArgs): Promise<DesiredFile[]> {
  const { source } = args;

  // 1. 未知 profile はエラー
  for (const tag of args.profiles) {
    if (!(await source.profileExists(tag))) throw new Error(`unknown profile: ${tag}`);
  }

  // 2. composed 貢献を集める（base が先頭、宣言順）
  const profileManifests: ProfileManifest[] = [];
  const baseManifest = await source.readProfileManifest("base");
  if (baseManifest) profileManifests.push(baseManifest);
  for (const tag of args.profiles) {
    const pm = await source.readProfileManifest(`profiles/${tag}`);
    if (pm) profileManifests.push(pm);
  }
  const renovateExtends = renderRenovateExtends(profileManifests.map((p) => p.renovate ?? []));
  const gitignore = renderGitignore(profileManifests.map((p) => p.gitignore ?? []));
  const composedValues: Record<"renovate_extends" | "gitignore", string> = {
    renovate_extends: renovateExtends,
    gitignore,
  };

  // 3. ファイルを集める（base/files, seeds, profiles/<tag>/files）。衝突検出。
  const sources: Array<{ prefix: string; mode: DesiredFile["mode"] }> = [
    { prefix: "base/files/", mode: "sync" },
    { prefix: "seeds/", mode: "create-only" },
    ...args.profiles.map((t) => ({ prefix: `profiles/${t}/files/`, mode: "sync" as const })),
  ];

  const byDest = new Map<string, DesiredFile>();
  const owner = new Map<string, string>(); // dest -> 提供元 prefix（衝突メッセージ用）

  for (const { prefix, mode } of sources) {
    for (const full of await source.listFiles(prefix)) {
      const dest = destPath(full);
      if (byDest.has(dest)) {
        throw new Error(`path collision: ${dest} provided by ${owner.get(dest)} and ${prefix}`);
      }
      const raw = await source.readFile(full);
      if (raw === null) continue;

      // composed 描画 → そうでなければ {{var}} 置換
      const composedKind = COMPOSED[full];
      const content = composedKind
        ? substituteVars(raw.replace(`{{${composedKind}}}`, composedValues[composedKind]), args.vars)
        : substituteVars(raw, args.vars);

      byDest.set(dest, { path: dest, content, mode });
      owner.set(dest, prefix);
    }
  }

  // 4. exclude 適用
  for (const ex of args.exclude) byDest.delete(ex);

  return [...byDest.values()];
}
