export interface RepoEntry {
  languages: string[];
  /** 言語と独立な opt-in 配布束（oss 等）。省略時 [] */
  bundles: string[];
  /** リポ個別値（tf 側 fanout.contents。旧 vars の後継）。省略時 {} */
  contents: Record<string, string>;
  /** fanout が触らないパス（CODEOWNERS opt-out 等。spec §3） */
  exclude: string[];
}

export interface Manifest {
  account: string;
  revision: number;
  sourceCommit: string;
  repositories: Record<string, RepoEntry>;
}
