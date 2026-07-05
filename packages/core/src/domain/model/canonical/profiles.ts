import { dedupePreserveOrder } from "../../type/dedupe.js";
import { isPlainObject } from "../../type/object.js";
import type { ManagedPathSpec } from "../reconcile/structuredDocument.js";
import type { Catalog } from "./catalog.js";
import { PathContributions, ProfileContributes } from "./contribution.js";
import type { TemplateSource } from "./templateSource.js";

/**
 * profile の集合(spec v3 C2/C9)。宣言 = base + languages 宣言順 + bundles 宣言順。
 * universe 計算のため全 profile の contributes も保持する。
 */
export class Profiles {
  private constructor(
    private readonly declared: string[],
    private readonly byProfile: Map<string, ProfileContributes>,
  ) {}

  static async load(
    source: TemplateSource,
    languages: string[],
    bundles: string[],
  ): Promise<Profiles> {
    const declared = dedupePreserveOrder(["base", ...languages, ...bundles]);
    const names = new Set<string>();
    for (const p of await source.listFiles("profiles/")) {
      const m = /^profiles\/([^/]+)\//.exec(p);
      if (m?.[1]) names.add(m[1]);
    }
    for (const p of declared) {
      if (!names.has(p)) throw new Error(`unknown profile: ${p}`);
    }
    const byProfile = new Map<string, ProfileContributes>();
    for (const p of [...names].sort()) {
      byProfile.set(
        p,
        ProfileContributes.parse(p, await source.readFile(`profiles/${p}/contributes.json`)),
      );
    }
    return new Profiles(declared, byProfile);
  }

  /** 全 profile の全寄与パスが catalog 登録済みかの検証 */
  assertPathsKnown(catalog: Catalog): void {
    for (const [profile, pc] of this.byProfile) {
      catalog.assertKnownPaths(profile, pc.paths);
    }
  }

  /** 宣言 profile の寄与列(宣言順) */
  contributionsFor(path: string): PathContributions {
    const items: Array<{ profile: string; contribution: Record<string, unknown> }> = [];
    for (const p of this.declared) {
      const c = this.byProfile.get(p)?.contributionFor(path);
      if (c !== undefined) items.push({ profile: p, contribution: c });
    }
    return new PathContributions(path, items);
  }

  /** universe = 全 profile(選択有無を問わない)の寄与の和集合(spec v3 §6.2) */
  universeFor(
    path: string,
    managedPaths: Record<string, ManagedPathSpec>,
  ): Record<string, string[]> {
    const universe: Record<string, string[]> = {};
    for (const [key, spec] of Object.entries(managedPaths)) {
      const values: string[] = [];
      for (const pc of this.byProfile.values()) {
        const v = pc.contributionFor(path)?.[key];
        if (v === undefined) continue;
        if (spec.merge === "array") {
          if (Array.isArray(v)) values.push(...v.map(String));
          else if (typeof v === "string") values.push(v);
        } else if (isPlainObject(v)) {
          values.push(...Object.keys(v));
        }
      }
      universe[key] = dedupePreserveOrder(values);
    }
    return universe;
  }
}
