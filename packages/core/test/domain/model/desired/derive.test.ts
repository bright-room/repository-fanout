import { expect, test } from "vitest";
import type { TemplateSource } from "../../../../src/domain/model/canonical/templateSource.js";
import { deriveDesiredFiles } from "../../../../src/domain/model/desired/derive.js";

/** v3 は readFile / listFiles しか使わない */
function memorySourceV3(files: Record<string, string>): TemplateSource {
  return {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files)
        .filter((p) => p.startsWith(prefix))
        .sort();
    },
  };
}

const FILES: Record<string, string> = {
  "catalog.json": JSON.stringify({
    files: {
      ".gitignore": { file_type: "text", mode: "managed" },
      ".github/CODEOWNERS": { file_type: "text", mode: "managed" },
      "renovate.json": {
        file_type: "json",
        mode: "managed",
        managed_paths: { extends: { merge: "array" } },
      },
      "SECURITY.md": { file_type: "markdown", mode: "replaced" },
    },
  }),
  "templates/gitignore.liquid": `{{ contributions.sections | cross_dedupe: "ignores" | json }}`,
  "templates/codeowners.liquid": "* {{ contents.codeowner }}\n",
  "templates/security.liquid": "# Security\n",
  "profiles/base/contributes.json": JSON.stringify({
    ".gitignore": {
      template: "gitignore.liquid",
      sections: [{ comment: "base", ignores: [".DS_Store"] }],
    },
    ".github/CODEOWNERS": { template: "codeowners.liquid" },
    "renovate.json": { extends: ["github>o/rc"] },
  }),
  "profiles/typescript/contributes.json": JSON.stringify({
    ".gitignore": { sections: [{ comment: "node", ignores: ["node_modules/"] }] },
    "renovate.json": { extends: ["github>o/rc:ts"] },
  }),
  "profiles/go/contributes.json": JSON.stringify({
    "renovate.json": { extends: ["github>o/rc:go"] },
  }),
  "profiles/oss/contributes.json": JSON.stringify({
    "SECURITY.md": { template: "security.liquid" },
  }),
};

const baseArgs = {
  languages: ["typescript"],
  bundles: [] as string[],
  contents: { codeowner: "@org/team" },
  exclude: [] as string[],
};

test("配布トリガー: 宣言 profile が寄与したパスだけ。universe は全 profile 由来", async () => {
  const entries = await deriveDesiredFiles({ source: memorySourceV3(FILES), ...baseArgs });
  expect(entries.map((e) => e.path).sort()).toEqual([
    ".github/CODEOWNERS",
    ".gitignore",
    "renovate.json",
  ]);
  const co = entries.find((e) => e.path === ".github/CODEOWNERS");
  expect(co).toEqual({
    strategy: "managed-block",
    path: ".github/CODEOWNERS",
    blockContent: "* @org/team",
  });
  const rn = entries.find((e) => e.path === "renovate.json");
  if (rn?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(rn.data.extends).toEqual(["github>o/rc", "github>o/rc:ts"]);
  expect(rn.universe.extends).toEqual(
    expect.arrayContaining(["github>o/rc", "github>o/rc:ts", "github>o/rc:go"]),
  );
});

test("bundles 宣言で oss の SECURITY.md が加わる / exclude は retract 化", async () => {
  const entries = await deriveDesiredFiles({
    source: memorySourceV3(FILES),
    ...baseArgs,
    bundles: ["oss"],
    exclude: [".gitignore", "renovate.json", "SECURITY.md"],
  });
  const strategies = Object.fromEntries(entries.map((e) => [e.path, e.strategy]));
  expect(strategies[".gitignore"]).toBe("managed-block-retract");
  expect(strategies["renovate.json"]).toBe("structured-managed-retract");
  expect(strategies["SECURITY.md"]).toBeUndefined(); // replace は配布対象から外れる
});

test("base-only(languages/bundles 空)は base 寄与パスだけを配布する", async () => {
  const entries = await deriveDesiredFiles({
    source: memorySourceV3(FILES),
    languages: [],
    bundles: [],
    contents: { codeowner: "@org/team" },
    exclude: [],
  });
  // base が寄与する 3 パスのみ。typescript / oss 由来のパスは入らない
  expect(entries.map((e) => e.path).sort()).toEqual([
    ".github/CODEOWNERS",
    ".gitignore",
    "renovate.json",
  ]);
  // renovate の extends は base の 1 件のみ(typescript の :ts が混ざらない)
  const rn = entries.find((e) => e.path === "renovate.json");
  if (rn?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(rn.data.extends).toEqual(["github>o/rc"]);
});

test("G3: base の PR/ISSUE テンプレが正しい中身で描画され config の {{repo}} が補間される", async () => {
  const src = memorySourceV3({
    "catalog.json": JSON.stringify({
      files: {
        ".github/pull_request_template.md": { file_type: "markdown", mode: "replaced" },
        ".github/ISSUE_TEMPLATE/bug_report.yaml": { file_type: "yaml", mode: "replaced" },
        ".github/ISSUE_TEMPLATE/config.yml": { file_type: "yaml", mode: "replaced" },
      },
    }),
    "templates/pr.liquid": "## Summary\n\n## Checklist\n\n- [ ] Tests pass\n",
    "templates/bug.liquid":
      'name: Bug Report\nlabels:\n  - "Type: Bug"\nbody:\n  - type: textarea\n',
    "templates/config.liquid":
      "blank_issues_enabled: true\ncontact_links:\n  - name: Discussions\n    url: https://github.com/{{ repo }}/discussions\n",
    "profiles/base/contributes.json": JSON.stringify({
      ".github/pull_request_template.md": { template: "pr.liquid" },
      ".github/ISSUE_TEMPLATE/bug_report.yaml": { template: "bug.liquid" },
      ".github/ISSUE_TEMPLATE/config.yml": { template: "config.liquid" },
    }),
  });
  const entries = await deriveDesiredFiles({
    source: src,
    languages: [],
    bundles: [],
    contents: {},
    exclude: [],
    repo: "bright-room/example",
    account: "bright-room",
  });
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  const pr = byPath[".github/pull_request_template.md"];
  if (pr?.strategy !== "replace") throw new Error("PR テンプレが replace でない");
  expect(pr.content).toContain("## Checklist");
  const bug = byPath[".github/ISSUE_TEMPLATE/bug_report.yaml"];
  if (bug?.strategy !== "replace") throw new Error("bug form が replace でない");
  expect(bug.content).toContain('"Type: Bug"');
  const cfg = byPath[".github/ISSUE_TEMPLATE/config.yml"];
  if (cfg?.strategy !== "replace") throw new Error("config が replace でない");
  // {{ repo }} が実 repo に補間され、未展開の Liquid タグが残らない
  expect(cfg.content).toContain("https://github.com/bright-room/example/discussions");
  expect(cfg.content).not.toContain("{{");
});

const PRECOMMIT_FILES: Record<string, string> = {
  "catalog.json": JSON.stringify({
    files: {
      ".pre-commit-config.yaml": {
        file_type: "yaml",
        mode: "managed",
        managed_paths: { repos: { merge: "array", key: "repo" } },
      },
    },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    ".pre-commit-config.yaml": {
      repos: [
        {
          repo: "https://github.com/gitleaks/gitleaks",
          rev: "v8.30.0",
          hooks: [{ id: "gitleaks" }],
        },
      ],
    },
  }),
  "profiles/go/contributes.json": JSON.stringify({
    ".pre-commit-config.yaml": {
      repos: [
        { repo: "https://github.com/example/go-hook", rev: "v1.0.0", hooks: [{ id: "go-hook" }] },
      ],
    },
  }),
};

test("keyed array: universe は全 profile の key 値、data は宣言 profile のみ、createContent は正準 YAML", async () => {
  const entries = await deriveDesiredFiles({
    source: memorySourceV3(PRECOMMIT_FILES),
    languages: [],
    bundles: [],
    contents: {},
    exclude: [],
  });
  const pc = entries.find((e) => e.path === ".pre-commit-config.yaml");
  if (pc?.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(pc.universe.repos).toEqual(
    expect.arrayContaining([
      "https://github.com/gitleaks/gitleaks",
      "https://github.com/example/go-hook",
    ]),
  );
  expect((pc.data.repos as unknown[]).length).toBe(1);
  expect(pc.createContent).toContain("repo: https://github.com/gitleaks/gitleaks");
});

test("keyed array: 寄与エントリに識別キーが無ければ fail fast", async () => {
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...PRECOMMIT_FILES,
        "profiles/go/contributes.json": JSON.stringify({
          ".pre-commit-config.yaml": { repos: [{ rev: "v1.0.0" }] },
        }),
      }),
      languages: [],
      bundles: [],
      contents: {},
      exclude: [],
    }),
  ).rejects.toThrow(/識別キー "repo" がない/);
});

test("fail fast: 未知 profile / 未登録パス / template 不在", async () => {
  await expect(
    deriveDesiredFiles({ source: memorySourceV3(FILES), ...baseArgs, languages: ["ruby"] }),
  ).rejects.toThrow(/unknown profile: ruby/);
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...FILES,
        "profiles/typescript/contributes.json": JSON.stringify({ "renovte.json": {} }),
      }),
      ...baseArgs,
    }),
  ).rejects.toThrow(/path not in catalog: renovte\.json/);
  await expect(
    deriveDesiredFiles({
      source: memorySourceV3({
        ...FILES,
        "profiles/base/contributes.json": JSON.stringify({
          ".github/CODEOWNERS": { template: "nope.liquid" },
        }),
      }),
      ...baseArgs,
    }),
  ).rejects.toThrow(/template not found/);
});
