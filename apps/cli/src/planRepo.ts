import {
  resolveDesiredEntries,
  computeChanges,
  type TemplateSource,
  type FileChange,
} from "@repository-fanout/core";

export interface PlanArgs {
  source: TemplateSource;
  languages: string[];
  vars: Record<string, string>;
  exclude: string[];
  readActual: (paths: string[]) => Promise<Record<string, string>>;
}

export async function planRepo(args: PlanArgs): Promise<{ changes: FileChange[] }> {
  const desired = await resolveDesiredEntries({
    source: args.source,
    languages: args.languages,
    vars: args.vars,
    exclude: args.exclude,
  });
  const actual = await args.readActual(desired.map((d) => d.path));
  return { changes: computeChanges(desired, actual) };
}
