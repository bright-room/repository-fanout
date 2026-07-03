export interface RepoEntry {
  languages: string[];
  /** 言語と独立な opt-in 配布束（oss 等）。省略時 [] */
  bundles: string[];
  vars: Record<string, string>;
  /** fanout が触らないパス（CODEOWNERS opt-out 等。spec §3） */
  exclude: string[];
}

export interface Manifest {
  account: string;
  revision: number;
  sourceCommit: string;
  repositories: Record<string, RepoEntry>;
}
