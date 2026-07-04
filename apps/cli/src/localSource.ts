import type { Dirent } from "node:fs";
import { readFile as fsReadFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FragmentAxis, FragmentManifest, TemplateSource } from "@repository-fanout/core";

/**
 * ローカルディレクトリ(canonical-files の checkout)を TemplateSource として扱う。
 * validate コマンド(CI での正本検証)用。GitHubTemplateSource と異なり
 * fragment.json の JSON 破損は null に握りつぶさず throw する(検証で検出するため)。
 */
export function localSource(root: string): TemplateSource {
  const read = async (p: string): Promise<string | null> => {
    try {
      return await fsReadFile(join(root, p), "utf8");
    } catch {
      return null;
    }
  };
  const walk = async (dir: string): Promise<string[]> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const rel = `${dir}${e.name}`;
      if (e.isDirectory()) out.push(...(await walk(`${rel}/`)));
      else out.push(rel);
    }
    return out.sort();
  };
  return {
    readFile: read,
    listFiles: (prefix) => walk(prefix),
    readFragmentManifest: async (dir): Promise<FragmentManifest | null> => {
      const raw = await read(`${dir}/fragment.json`);
      return raw === null ? null : (JSON.parse(raw) as FragmentManifest);
    },
    listNames: async (axis: FragmentAxis) => {
      try {
        const entries = await readdir(join(root, axis), { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    nameExists: async (axis, name) => {
      try {
        return (await stat(join(root, axis, name))).isDirectory();
      } catch {
        return false;
      }
    },
  };
}
