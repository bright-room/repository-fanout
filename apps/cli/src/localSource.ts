import type { Dirent } from "node:fs";
import { readFile as fsReadFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TemplateSource } from "@repository-fanout/core";

/**
 * ローカルディレクトリ(canonical-files の checkout)を TemplateSource として扱う。
 * validate コマンド(CI での正本検証)用。読み取り失敗(不在含む)は null を返す。
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
  };
}
