import { expect, test } from "vitest";
import { resolveDesiredEntries } from "../../src/templates/resolve.js";
import type { FragmentManifest, TemplateSource } from "../../src/templates/types.js";

const DEFAULT_STRATEGIES =
  '{"renovate.json":"extends-field",".gitignore":"managed-block",".github/CODEOWNERS":"managed-block"}';

function memorySource(opts: {
  files: Record<string, string>;
  fragments: Record<string, FragmentManifest>; // "base" | "languages/<lang>" | "bundles/<name>"
  languages: string[]; // 存在する language 一覧
  bundles?: string[]; // 存在する bundle 一覧
  omitStrategies?: boolean; // strategies.json を配布しない（fail-fast 検証用）
}): TemplateSource {
  const names = { languages: opts.languages, bundles: opts.bundles ?? [] };
  const files: Record<string, string> = opts.omitStrategies
    ? { ...opts.files }
    : { "strategies.json": DEFAULT_STRATEGIES, ...opts.files };
  return {
    async readFile(p) {
      return files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest(dir) {
      return opts.fragments[dir] ?? null;
    },
    async listNames(axis) {
      return names[axis];
    },
    async nameExists(axis, name) {
      return names[axis].includes(name);
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

test("strategies are assigned per path via strategies.json", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
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
    bundles: [],
    vars: { codeowner: "dummy" }, // CODEOWNERS の {{codeowner}} 解決に必要(このテストの検証対象ではない)
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
    bundles: [],
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
    bundles: [],
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

test("language files are included; unknown language throws; collision throws; exclude retracts managed-block", async () => {
  const withTs = await resolveDesiredEntries({
    source: source(),
    languages: ["typescript"],
    bundles: [],
    vars: { codeowner: "dummy" }, // CODEOWNERS の {{codeowner}} 解決に必要(このテストの検証対象ではない)
    exclude: [],
  });
  expect(withTs.find((e) => e.path === ".editorconfig")?.strategy).toBe("replace");

  await expect(
    resolveDesiredEntries({
      source: source(),
      languages: ["typoscript"],
      bundles: [],
      vars: {},
      exclude: [],
    }),
  ).rejects.toThrow(/unknown language/i);

  const collide = memorySource({
    files: { "languages/a/files/x.txt": "a", "languages/b/files/x.txt": "b" },
    fragments: {},
    languages: ["a", "b"],
  });
  await expect(
    resolveDesiredEntries({
      source: collide,
      languages: ["a", "b"],
      bundles: [],
      vars: {},
      exclude: [],
    }),
  ).rejects.toThrow(/collision/i);

  // .github/CODEOWNERS は managed-block 戦略 → exclude は削除ではなく retract に収束する(spec v2 §5.5)
  const excluded = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
    vars: { codeowner: "x" },
    exclude: [".github/CODEOWNERS"],
  });
  expect(excluded.find((e) => e.path === ".github/CODEOWNERS")).toEqual({
    strategy: "managed-block-retract",
    path: ".github/CODEOWNERS",
  });
});

test("bundle fragments merge after languages and contribute to universe; bundle files are distributed", async () => {
  const src = memorySource({
    files: {
      "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
      "bundles/oss/files/CONTRIBUTING.md": "contributing\n",
    },
    fragments: {
      base: { renovate: ["github>o/renovate-config"] },
      "languages/java": { renovate: ["github>o/renovate-config:java"] },
      "bundles/oss": { renovate: ["github>o/renovate-config:oss"] },
    },
    languages: ["java"],
    bundles: ["oss"],
  });
  const entries = await resolveDesiredEntries({
    source: src,
    languages: ["java"],
    bundles: ["oss"],
    vars: {},
    exclude: [],
  });
  const r = entries.find((e) => e.path === "renovate.json");
  if (r?.strategy !== "extends-field") throw new Error("wrong strategy");
  expect(r.managedExtends).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:java",
    "github>o/renovate-config:oss",
  ]);
  expect(r.universe).toContain("github>o/renovate-config:oss");

  const contrib = entries.find((e) => e.path === "CONTRIBUTING.md");
  expect(contrib?.strategy).toBe("replace");
});

test("unknown bundle throws; language/bundle file collision throws", async () => {
  await expect(
    resolveDesiredEntries({
      source: source(),
      languages: [],
      bundles: ["nope"],
      vars: {},
      exclude: [],
    }),
  ).rejects.toThrow(/unknown bundle/i);

  const collide = memorySource({
    files: { "languages/a/files/x.txt": "a", "bundles/b/files/x.txt": "b" },
    fragments: {},
    languages: ["a"],
    bundles: ["b"],
  });
  await expect(
    resolveDesiredEntries({
      source: collide,
      languages: ["a"],
      bundles: ["b"],
      vars: {},
      exclude: [],
    }),
  ).rejects.toThrow(/collision/i);
});

test("missing strategies.json fails resolve (fail fast)", async () => {
  const src = memorySource({
    files: { "base/files/renovate.json": "{}\n" },
    fragments: {},
    languages: [],
    omitStrategies: true,
  });
  await expect(
    resolveDesiredEntries({ source: src, languages: [], bundles: [], vars: {}, exclude: [] }),
  ).rejects.toThrow(/strategies\.json not found/i);
});

test("exclude on managed-block path yields a retract entry (spec §5.5)", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
    vars: { codeowner: "dummy" }, // CODEOWNERS の {{codeowner}} 解決に必要(このテストの検証対象ではない)
    exclude: [".gitignore"],
  });
  expect(entries).toContainEqual({ strategy: "managed-block-retract", path: ".gitignore" });
});

test("exclude on extends-field path yields a retract entry carrying universe", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
    vars: { codeowner: "dummy" }, // CODEOWNERS の {{codeowner}} 解決に必要(このテストの検証対象ではない)
    exclude: ["renovate.json"],
  });
  const e = entries.find((x) => x.path === "renovate.json");
  expect(e?.strategy).toBe("extends-field-retract");
  if (e?.strategy === "extends-field-retract") expect(e.universe.length).toBeGreaterThan(0);
});

test("exclude on replace path simply drops the entry (ファイルは触らない)", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
    vars: { codeowner: "dummy" }, // CODEOWNERS の {{codeowner}} 解決に必要(このテストの検証対象ではない)
    exclude: [".github/release.yml"],
  });
  expect(entries.find((x) => x.path === ".github/release.yml")).toBeUndefined();
});

test("unresolved placeholder in managed-block content is rejected (kukv CODEOWNERS incident)", async () => {
  await expect(
    resolveDesiredEntries({
      source: source(),
      languages: [],
      bundles: [],
      vars: {}, // codeowner が無い
      exclude: [],
    }),
  ).rejects.toThrow(/unresolved placeholder/i);
  await expect(
    resolveDesiredEntries({
      source: source(),
      languages: [],
      bundles: [],
      vars: {},
      exclude: [],
    }),
  ).rejects.toThrow(/\{\{codeowner\}\}.*\.github\/CODEOWNERS/);
});

test("unresolved placeholder in a replace file is rejected", async () => {
  const src = memorySource({
    files: {
      "base/files/.github/release.yml": "changelog: {{custom}}\n",
    },
    fragments: {},
    languages: [],
  });
  await expect(
    resolveDesiredEntries({ source: src, languages: [], bundles: [], vars: {}, exclude: [] }),
  ).rejects.toThrow(/unresolved placeholder/i);
});

test("all placeholders resolved when vars are complete", async () => {
  const entries = await resolveDesiredEntries({
    source: source(),
    languages: [],
    bundles: [],
    vars: { codeowner: "kukv" },
    exclude: [],
  });
  const co = entries.find((e) => e.path === ".github/CODEOWNERS");
  if (co?.strategy !== "managed-block") throw new Error("wrong strategy");
  expect(co.blockContent).toBe("* @kukv");
});

test("strategy mapping is data-driven: config assigns and unassigns without code change", async () => {
  const src = memorySource({
    files: {
      "strategies.json": '{"NOTICE.md":"managed-block"}',
      "base/files/NOTICE.md": "managed notice\n",
      "base/files/renovate.json": "{}\n",
    },
    fragments: {},
    languages: [],
  });
  const entries = await resolveDesiredEntries({
    source: src,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
  });
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  expect(byPath["NOTICE.md"]?.strategy).toBe("managed-block");
  // map から外れたパスは既定の replace に戻る
  expect(byPath["renovate.json"]?.strategy).toBe("replace");
});
