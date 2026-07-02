import { expect, test } from "vitest";
import { resolveDesiredEntries } from "../../src/templates/resolve.js";
import type { FragmentManifest, TemplateSource } from "../../src/templates/types.js";

function memorySource(opts: {
  files: Record<string, string>;
  fragments: Record<string, FragmentManifest>; // "base" | "languages/<lang>"
  languages: string[]; // 存在する language 一覧
}): TemplateSource {
  return {
    async readFile(p) {
      return opts.files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(opts.files).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest(dir) {
      return opts.fragments[dir] ?? null;
    },
    async listLanguages() {
      return opts.languages;
    },
    async languageExists(lang) {
      return opts.languages.includes(lang);
    },
  };
}

const source = () =>
  memorySource({
    files: {
      "base/files/renovate.json": '{\n  "$schema": "s",\n  "extends": [{{renovate_extends}}]\n}\n',
      "base/files/.gitignore": "{{gitignore}}\n",
      "base/files/.github/CODEOWNERS": "* @{{codeowner}}\n",
      "base/files/.github/release.yml": "changelog: {}\n",
      "seeds/STARTER.md": "starter\n",
      "languages/typescript/files/.editorconfig": "root = true\n",
    },
    fragments: {
      base: {
        renovate: ["github>o/renovate-config"],
        gitignore: [{ section_comment: "base", ignores: [".DS_Store"] }],
      },
      "languages/terraform": {
        renovate: ["github>o/renovate-config:terraform"],
        gitignore: [{ section_comment: "tf", ignores: ["*.tfstate"] }],
      },
      "languages/typescript": {
        renovate: ["github>o/renovate-config:typescript"],
        gitignore: [{ section_comment: "node", ignores: ["node_modules/"] }],
      },
      "languages/java": { renovate: ["github>o/renovate-config:java"] },
    },
    languages: ["terraform", "typescript", "java"],
  });

test("strategies are assigned per path via registry", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    vars: { codeowner: "kukv" },
    exclude: [],
  });
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  expect(byPath["renovate.json"]!.strategy).toBe("extends-field");
  expect(byPath[".gitignore"]!.strategy).toBe("managed-block");
  expect(byPath[".github/CODEOWNERS"]!.strategy).toBe("managed-block");
  expect(byPath[".github/release.yml"]!.strategy).toBe("replace");
  expect(byPath["STARTER.md"]!.strategy).toBe("create-only");
});

test("extends-field entry carries managed (declared) and universe (all languages)", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: ["typescript"],
    vars: {},
    exclude: [],
  });
  const r = entries.find((e) => e.path === "renovate.json")!;
  if (r.strategy !== "extends-field") throw new Error("wrong strategy");
  expect(r.managedExtends).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:typescript",
  ]);
  expect(r.universe).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:terraform",
    "github>o/renovate-config:typescript",
    "github>o/renovate-config:java",
  ]);
  expect(r.createContent).toBe(
    '{\n  "$schema": "s",\n  "extends": ["github>o/renovate-config", "github>o/renovate-config:typescript"]\n}\n',
  );
});

test("managed-block entries compose block content (vars + language lines)", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: ["terraform"],
    vars: { codeowner: "o/team" },
    exclude: [],
  });
  const gi = entries.find((e) => e.path === ".gitignore")!;
  if (gi.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(gi.blockContent).toBe("# base\n.DS_Store\n\n# tf\n*.tfstate");
  const co = entries.find((e) => e.path === ".github/CODEOWNERS")!;
  if (co.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(co.blockContent).toBe("* @o/team");
});

test("composed replacements insert $ patterns literally (no $&/$$ expansion)", async () => {
  const src = memorySource({
    files: {
      "base/files/.gitignore": "{{gitignore}}\n",
      "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
    },
    fragments: {
      base: {
        renovate: ["github>o/rc$&x", "a$$b"],
        gitignore: [{ ignores: ["cache$&junk", "a$$b", "x$`y"] }],
      },
    },
    languages: [],
  });
  const entries = await resolveDesiredEntries({
    source: src,
    languages: [],
    vars: {},
    exclude: [],
  });
  const gi = entries.find((e) => e.path === ".gitignore")!;
  if (gi.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(gi.blockContent).toBe("cache$&junk\na$$b\nx$`y");
  const r = entries.find((e) => e.path === "renovate.json")!;
  if (r.strategy !== "extends-field") throw new Error("wrong strategy");
  expect(r.createContent).toBe('{\n  "extends": ["github>o/rc$&x", "a$$b"]\n}\n');
});

test("language files are included; unknown language throws; collision throws; exclude removes", async () => {
  const withTs = await resolveDesiredEntries({
    source: source(),
    languages: ["typescript"],
    vars: {},
    exclude: [],
  });
  expect(withTs.find((e) => e.path === ".editorconfig")?.strategy).toBe("replace");

  await expect(
    resolveDesiredEntries({ source: source(), languages: ["typoscript"], vars: {}, exclude: [] }),
  ).rejects.toThrow(/unknown language/i);

  const collide = memorySource({
    files: { "languages/a/files/x.txt": "a", "languages/b/files/x.txt": "b" },
    fragments: {},
    languages: ["a", "b"],
  });
  await expect(
    resolveDesiredEntries({ source: collide, languages: ["a", "b"], vars: {}, exclude: [] }),
  ).rejects.toThrow(/collision/i);

  const excluded = await resolveDesiredEntries({
    source: source(),
    languages: [],
    vars: { codeowner: "x" },
    exclude: [".github/CODEOWNERS"],
  });
  expect(excluded.find((e) => e.path === ".github/CODEOWNERS")).toBeUndefined();
});
