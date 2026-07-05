import { Liquid } from "liquidjs";
import { isPlainObject } from "../../type/object.js";

export interface RenderContext {
  contributions: Record<string, unknown>;
  contents: Record<string, string>;
  repo: string;
  account: string;
}

let sharedEngine: Liquid | undefined;

/**
 * strict 必須: 未定義変数の黙殺は「`* @{{codeowner}}` のまま配布」(kukv PR#63)の
 * 再発経路になる(spec v3 §5)。
 */
function engine(): Liquid {
  if (!sharedEngine) {
    sharedEngine = new Liquid({ strictVariables: true, strictFilters: true });
    sharedEngine.registerFilter("cross_dedupe", crossDedupe);
  }
  return sharedEngine;
}

/**
 * セクション横断 dedupe(初出優先)+ 空になったセクションの削除。
 * v2 renderGitignore の意味論のフィルタ化(spec v3 §5)。
 */
export function crossDedupe(sections: unknown, listKey: string): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const s of sections) {
    if (!isPlainObject(s)) continue;
    const items = s[listKey];
    if (!Array.isArray(items)) continue;
    const fresh = items.filter((i): i is string => typeof i === "string" && !seen.has(i));
    for (const f of fresh) seen.add(f);
    if (fresh.length === 0) continue;
    out.push({ ...s, [listKey]: fresh });
  }
  return out;
}

/** 本文テンプレート。raw = Liquid 描画をスキップして逐語コピー(spec v3 C11) */
export class Template {
  private constructor(
    private readonly body: string,
    private readonly raw: boolean,
  ) {}

  static of(body: string, opts: { raw?: boolean } = {}): Template {
    return new Template(body, opts.raw ?? false);
  }

  async render(ctx: RenderContext): Promise<string> {
    if (this.raw) return this.body;
    return await engine().parseAndRender(this.body, ctx);
  }
}
