import type { TemplateSource } from "@repository-fanout/core";
import { describe, expect, it } from "vitest";
import type { RepoPortForApply } from "../src/applyRepo.js";
import { applyRepo } from "../src/applyRepo.js";

// planRepo.test.ts と同じ v3 レイアウトのインメモリ source ヘルパ。
function v3Source(tree: Record<string, string>): TemplateSource {
  return {
    async readFile(p) {
      return tree[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(tree)
        .filter((p) => p.startsWith(prefix))
        .sort();
    },
  };
}

const source = v3Source({
  "catalog.json": JSON.stringify({
    files: { ".github/release.yml": { file_type: "yaml", mode: "replaced" } },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    ".github/release.yml": { template: "release.yml.liquid" },
  }),
  "templates/release.yml.liquid": "R\n",
});

function fakeIo(state: {
  files: Record<string, string>;
  commits: unknown[];
  prs: unknown[];
}): RepoPortForApply {
  return {
    getDefaultBranch: async () => ({ branch: "main", sha: "s" }),
    readActualFiles: async (paths) => {
      const out: Record<string, string> = {};
      for (const p of paths) if (state.files[p] !== undefined) out[p] = state.files[p];
      return out;
    },
    findPr: async () => null,
    branchExists: async () => false,
    getTreeSha: async () => "t",
    commitChanges: async (a) => void state.commits.push(a),
    createPr: async () => {
      state.prs.push({});
      return 11;
    },
    reopenPr: async () => {},
    deleteBranch: async () => {},
  };
}

describe("applyRepo", () => {
  it("creates branch + PR when there is a diff", async () => {
    const state = { files: {}, commits: [] as unknown[], prs: [] as unknown[] };
    const r = await applyRepo({
      source,
      io: fakeIo(state),
      languages: [],
      bundles: [],
      vars: {},
      exclude: [],
    });
    expect(r).toEqual({ changed: 1, prNumber: 11 });
    expect(state.commits).toHaveLength(1);
  });
  it("no diff → noop without writes", async () => {
    const state = {
      files: { ".github/release.yml": "R\n" },
      commits: [] as unknown[],
      prs: [] as unknown[],
    };
    const r = await applyRepo({
      source,
      io: fakeIo(state),
      languages: [],
      bundles: [],
      vars: {},
      exclude: [],
    });
    expect(r).toEqual({ changed: 0 });
    expect(state.commits).toHaveLength(0);
  });
});
