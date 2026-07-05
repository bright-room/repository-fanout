import { Catalog } from "../canonical/catalog.js";
import { ManagedStructuredFile } from "../canonical/catalogEntry.js";
import { Profiles } from "../canonical/profiles.js";
import { Template } from "../canonical/template.js";
import type { TemplateSource } from "../canonical/templateSource.js";
import { DesiredFile } from "./desiredFile.js";
import type { DesiredFileData } from "./desiredFileData.js";

export interface DeriveDesiredArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** リポ個別値(tf 側 fanout.contents。v2 vars の後継) */
  contents: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/** v3 resolve(spec v3 §4〜§6)。catalog を正とし、profile 寄与から望ましい状態を導出 */
export async function deriveDesiredFiles(args: DeriveDesiredArgs): Promise<DesiredFileData[]> {
  const catalog = Catalog.parse(await args.source.readFile("catalog.json"));
  const profiles = await Profiles.load(args.source, args.languages, args.bundles);
  profiles.assertPathsKnown(catalog);

  const byDest = new Map<string, DesiredFileData>();
  for (const path of [...catalog.paths].sort()) {
    const entry = catalog.entryFor(path);
    if (!entry) continue;
    const contributions = profiles.contributionsFor(path);
    if (contributions.isEmpty) continue; // どの宣言 profile も寄与しない → 配布しない

    const name = contributions.templateName();
    let template: Template | undefined;
    if (name !== undefined) {
      const body = await args.source.readFile(`templates/${name}`);
      if (body === null) throw new Error(`template not found: templates/${name} (for ${path})`);
      template = Template.of(body, { raw: entry.raw });
    }

    const universe =
      entry instanceof ManagedStructuredFile ? profiles.universeFor(path, entry.managedPaths) : {};
    byDest.set(
      path,
      await entry.deriveDesired({
        contributions,
        template,
        ctx: {
          contributions: contributions.mergedData(),
          contents: args.contents,
          repo: args.repo ?? "",
          account: args.account ?? "",
        },
        universe,
      }),
    );
  }

  // exclude = 寄与ゼロへ収束(spec v2 §5.5)。変換の知識は DesiredFile が持つ
  for (const ex of args.exclude) {
    const d = byDest.get(ex);
    if (!d) continue;
    const r = DesiredFile.from(d).retracted();
    if (r === null) byDest.delete(ex);
    else byDest.set(ex, r);
  }
  return [...byDest.values()];
}

export interface ResolveAutoArgs {
  source: TemplateSource;
  languages: string[];
  bundles: string[];
  /** v2 呼び出し互換のため名前は vars(v3 では contents として渡る) */
  vars: Record<string, string>;
  exclude: string[];
  repo?: string;
  account?: string;
}

/**
 * 望ましい状態の導出(spec v3)。呼び出し互換のため引数名は vars(v3 では contents として渡す)。
 */
export async function resolveDesired(args: ResolveAutoArgs): Promise<DesiredFileData[]> {
  return deriveDesiredFiles({
    source: args.source,
    languages: args.languages,
    bundles: args.bundles,
    contents: args.vars,
    exclude: args.exclude,
    repo: args.repo,
    account: args.account,
  });
}
