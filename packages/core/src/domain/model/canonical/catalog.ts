import { isPlainObject } from "../../type/object.js";
import { CatalogEntry } from "./catalogEntry.js";

/**
 * catalog.json(spec v3 §4.1)。raw=null(不在)は fail fast:
 * strategies.json 不在 fail fast(v2)の後継。「書いてなければ replace」の暗黙を認めない。
 */
export class Catalog {
  private constructor(private readonly entries: Map<string, CatalogEntry>) {}

  static parse(raw: string | null): Catalog {
    if (raw === null) throw new Error("catalog.json not found in templates repo");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`catalog.json: invalid JSON: ${(e as Error).message}`);
    }
    if (!isPlainObject(json) || !isPlainObject(json.files)) {
      throw new Error('catalog.json: must be an object with a "files" object');
    }
    const entries = new Map<string, CatalogEntry>();
    for (const [path, v] of Object.entries(json.files)) {
      if (path.startsWith("_")) continue; // 運用コメント
      entries.set(path, CatalogEntry.parse(path, v));
    }
    if (entries.size === 0) throw new Error("catalog.json: files must not be empty");
    return new Catalog(entries);
  }

  get paths(): string[] {
    return [...this.entries.keys()];
  }

  entryFor(path: string): CatalogEntry | undefined {
    return this.entries.get(path);
  }

  /** contributes.json のパスが catalog 登録済みかの検証(タイポ検出。spec v3 C10) */
  assertKnownPaths(profile: string, paths: string[]): void {
    for (const p of paths) {
      if (!this.entries.has(p)) {
        throw new Error(`profiles/${profile}/contributes.json: path not in catalog: ${p}`);
      }
    }
  }
}
