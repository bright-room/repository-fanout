import {
  resolveDesiredFiles,
  computeChanges,
  type TemplateSource,
  type FileChange,
} from "@repository-fanout/core";

export interface PlanArgs {
  source: TemplateSource;
  profiles: string[];
  vars: Record<string, string>;
  exclude: string[];
  readActual: (paths: string[]) => Promise<Record<string, string>>;
}

export async function planRepo(args: PlanArgs): Promise<{ changes: FileChange[] }> {
  const desired = await resolveDesiredFiles({
    source: args.source,
    profiles: args.profiles,
    vars: args.vars,
    exclude: args.exclude,
  });
  const actual = await args.readActual(desired.map((d) => d.path));
  return { changes: computeChanges(desired, actual) };
}
