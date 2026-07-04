import { isPlainObject } from "../../type/object.js";

/** profile 1 つ分の contributes.json(検証済み)。不正なインスタンスは存在しえない */
export class ProfileContributes {
  private constructor(
    readonly profile: string,
    private readonly entries: Map<string, Record<string, unknown>>,
  ) {}

  static parse(profile: string, raw: string | null): ProfileContributes {
    if (raw === null) return new ProfileContributes(profile, new Map());
    const label = `profiles/${profile}/contributes.json`;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${label}: invalid JSON: ${(e as Error).message}`);
    }
    if (!isPlainObject(json)) {
      throw new Error(`${label}: must be an object of path -> contribution`);
    }
    const entries = new Map<string, Record<string, unknown>>();
    for (const [path, c] of Object.entries(json)) {
      if (path.startsWith("_")) continue; // 運用コメント
      if (!isPlainObject(c)) throw new Error(`${label}: ${path}: must be an object`);
      if ("template" in c && typeof c.template !== "string") {
        throw new Error(`${label}: ${path}: template must be a string`);
      }
      entries.set(path, c);
    }
    return new ProfileContributes(profile, entries);
  }

  get paths(): string[] {
    return [...this.entries.keys()];
  }

  contributionFor(path: string): Record<string, unknown> | undefined {
    return this.entries.get(path);
  }
}

/** 1 配布先パスへの寄与列(profile 宣言順)。template 衝突検出とデータマージを持つ */
export class PathContributions {
  constructor(
    readonly path: string,
    private readonly items: Array<{ profile: string; contribution: Record<string, unknown> }>,
  ) {}

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** template 宣言 = 本文テンプレートの指定 + 配布トリガー(spec v3 §4.2)。2 つ以上は衝突 */
  templateName(): string | undefined {
    const decls = this.items.filter((i) => i.contribution.template !== undefined);
    if (decls.length > 1) {
      throw new Error(
        `template collision: ${this.path} declared by ${decls.map((d) => d.profile).join(", ")}`,
      );
    }
    return decls[0]?.contribution.template as string | undefined;
  }

  /** template キーを除いた寄与データの宣言順マージ(配列 concat / オブジェクト deep merge 後勝ち) */
  mergedData(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { contribution } of this.items) {
      const { template: _template, ...data } = contribution;
      mergeInto(out, data);
    }
    return out;
  }
}

function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(src)) {
    const prev = target[key];
    if (Array.isArray(prev) && Array.isArray(value)) {
      target[key] = [...prev, ...value];
    } else if (isPlainObject(prev) && isPlainObject(value)) {
      const copy = { ...prev };
      mergeInto(copy, value);
      target[key] = copy;
    } else if (Array.isArray(value)) {
      target[key] = [...value];
    } else if (isPlainObject(value)) {
      const copy: Record<string, unknown> = {};
      mergeInto(copy, value);
      target[key] = copy;
    } else {
      target[key] = value;
    }
  }
}
