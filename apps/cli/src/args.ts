/** CLI 引数のパース(純関数 = テスト可能)。index.ts はこれを呼ぶだけ。 */
export interface CliArgs {
  dir?: string;
  repo?: string;
  templatesRepo: string;
  languages: string[];
  bundles: string[];
  exclude: string[];
  codeowner: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (name: string): string[] => (arg(name) ?? "").split(",").filter(Boolean);
  const repo = arg("repo");
  return {
    dir: arg("dir"),
    repo,
    templatesRepo: arg("templates") ?? "bright-room/canonical-files",
    languages: list("languages"),
    bundles: list("bundles"),
    exclude: list("exclude"),
    codeowner: arg("codeowner") ?? repo?.split("/")[0] ?? "",
  };
}
