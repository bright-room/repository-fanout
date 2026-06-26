import { expect, test } from "vitest";
import { resolveDesiredFiles } from "../../src/templates/resolve.js";
import type { TemplateSource, ProfileManifest } from "../../src/templates/types.js";

function memorySource(opts: {
  files: Record<string, string>;        // フルパス -> 内容（base/files/**, profiles/<t>/files/**, seeds/**）
  profileManifests: Record<string, ProfileManifest>; // "base" | "profiles/<tag>" -> manifest
  profiles: string[];                   // 存在する profile タグ
}): TemplateSource {
  return {
    async readFile(path) { return opts.files[path] ?? null; },
    async listFiles(prefix) { return Object.keys(opts.files).filter((p) => p.startsWith(prefix)); },
    async readProfileManifest(dir) { return opts.profileManifests[dir] ?? null; },
    async profileExists(tag) { return opts.profiles.includes(tag); },
  };
}

const baseSource = () => memorySource({
  files: {
    "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
    "base/files/.gitignore": "{{gitignore}}\n",
    "base/files/.github/CODEOWNERS": "* @{{codeowner}}\n",
    "seeds/STARTER.md": "starter\n",
    "profiles/typescript/files/.editorconfig": "root = true\n",
  },
  profileManifests: {
    base: { renovate: ["github>o/c//presets/default"], gitignore: ["# base", ".DS_Store"] },
    "profiles/terraform": { renovate: ["github>o/c//presets/terraform"], gitignore: ["# tf", "*.tfstate"] },
    "profiles/typescript": { renovate: ["github>o/c//presets/typescript"], gitignore: ["# node", "node_modules/"] },
  },
  profiles: ["terraform", "typescript", "java"],
});

test("base-only repo gets base files with composed + vars rendered", async () => {
  const files = await resolveDesiredFiles({
    source: baseSource(), profiles: [], vars: { codeowner: "kukv" }, exclude: [],
  });
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  expect(byPath["renovate.json"]!.content).toBe('{\n  "extends": ["github>o/c//presets/default"]\n}\n');
  expect(byPath[".gitignore"]!.content).toBe("# base\n.DS_Store\n");
  expect(byPath[".github/CODEOWNERS"]!.content).toBe("* @kukv\n");
  expect(byPath["STARTER.md"]!.mode).toBe("create-only");
  expect(byPath["renovate.json"]!.mode).toBe("sync");
});

test("terraform profile adds preset + gitignore lines and its files", async () => {
  const files = await resolveDesiredFiles({
    source: baseSource(), profiles: ["terraform"], vars: { codeowner: "o/t" }, exclude: [],
  });
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  expect(byPath["renovate.json"]!.content).toContain('"github>o/c//presets/terraform"');
  expect(byPath[".gitignore"]!.content).toBe("# base\n.DS_Store\n# tf\n*.tfstate\n");
});

test("unknown profile throws", async () => {
  await expect(resolveDesiredFiles({
    source: baseSource(), profiles: ["typoscript"], vars: {}, exclude: [],
  })).rejects.toThrow(/unknown profile/i);
});

test("path collision between profiles throws", async () => {
  const src = memorySource({
    files: {
      "profiles/a/files/x.txt": "a",
      "profiles/b/files/x.txt": "b",
    },
    profileManifests: {},
    profiles: ["a", "b"],
  });
  await expect(resolveDesiredFiles({ source: src, profiles: ["a", "b"], vars: {}, exclude: [] }))
    .rejects.toThrow(/collision/i);
});

test("exclude removes a path from desired set", async () => {
  const files = await resolveDesiredFiles({
    source: baseSource(), profiles: [], vars: { codeowner: "kukv" }, exclude: [".github/CODEOWNERS"],
  });
  expect(files.find((f) => f.path === ".github/CODEOWNERS")).toBeUndefined();
});
