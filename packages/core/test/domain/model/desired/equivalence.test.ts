import { expect, test } from "vitest";
import type { TemplateSource } from "../../../../src/domain/model/canonical/templateSource.js";
import { computeChanges } from "../../../../src/domain/model/desired/computeChanges.js";
import { resolveDesired } from "../../../../src/domain/model/desired/derive.js";
import type { FragmentManifest } from "../../../../src/templates/types.js";
import { GITIGNORE_LIQUID } from "../canonical/template.test.js";

function memorySource(opts: {
  files: Record<string, string>;
  fragments?: Record<string, FragmentManifest>;
  languages?: string[];
}): TemplateSource {
  return {
    async readFile(p) {
      return opts.files[p] ?? null;
    },
    async listFiles(prefix) {
      return Object.keys(opts.files)
        .filter((p) => p.startsWith(prefix))
        .sort();
    },
    async readFragmentManifest(dir) {
      return opts.fragments?.[dir] ?? null;
    },
    async listNames(axis) {
      return axis === "languages" ? (opts.languages ?? []) : [];
    },
    async nameExists(axis, name) {
      return axis === "languages" && (opts.languages ?? []).includes(name);
    },
  };
}

const legacy = memorySource({
  files: {
    "strategies.json": JSON.stringify({
      "renovate.json": "extends-field",
      ".gitignore": "managed-block",
      ".github/CODEOWNERS": "managed-block",
    }),
    "base/files/renovate.json": '{\n  "extends": [{{renovate_extends}}]\n}\n',
    "base/files/.gitignore": "{{gitignore}}\n",
    "base/files/.github/CODEOWNERS": "* @{{codeowner}}\n",
    "base/files/.github/release.yml": "changelog: {}\n",
  },
  fragments: {
    base: {
      renovate: ["github>o/rc"],
      gitignore: [{ section_comment: "base", ignores: [".DS_Store"] }],
    },
    "languages/typescript": {
      renovate: ["github>o/rc:ts"],
      gitignore: [{ section_comment: "node", ignores: ["node_modules/"] }],
    },
    "languages/go": { renovate: ["github>o/rc:go"] },
  },
  languages: ["typescript", "go"],
});

const v3 = memorySource({
  files: {
    "catalog.json": JSON.stringify({
      files: {
        ".gitignore": { file_type: "text", mode: "managed" },
        ".github/CODEOWNERS": { file_type: "text", mode: "managed" },
        "renovate.json": {
          file_type: "json",
          mode: "managed",
          managed_paths: { extends: { merge: "array" } },
        },
        ".github/release.yml": { file_type: "yaml", mode: "replaced" },
      },
    }),
    "templates/gitignore.liquid": GITIGNORE_LIQUID,
    "templates/codeowners.liquid": "* @{{ contents.codeowner }}\n",
    "templates/release.yml.liquid": "changelog: {}\n",
    "profiles/base/contributes.json": JSON.stringify({
      ".gitignore": {
        template: "gitignore.liquid",
        sections: [{ comment: "base", ignores: [".DS_Store"] }],
      },
      ".github/CODEOWNERS": { template: "codeowners.liquid" },
      "renovate.json": { extends: ["github>o/rc"] },
      ".github/release.yml": { template: "release.yml.liquid" },
    }),
    "profiles/typescript/contributes.json": JSON.stringify({
      ".gitignore": { sections: [{ comment: "node", ignores: ["node_modules/"] }] },
      "renovate.json": { extends: ["github>o/rc:ts"] },
    }),
    "profiles/go/contributes.json": JSON.stringify({
      "renovate.json": { extends: ["github>o/rc:go"] },
    }),
  },
});

// 配布先の実状態: リポ独自行入り gitignore・リポ独自 extends 入り renovate・古い release.yml
const ACTUAL = {
  ".gitignore":
    "# >>> repository-fanout managed >>>\nold\n# <<< repository-fanout managed <<<\n\n/generated/\n",
  "renovate.json": '{\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n',
  ".github/release.yml": "changelog: {old: true}\n",
};

const ARGS = {
  languages: ["typescript"],
  bundles: [] as string[],
  vars: { codeowner: "org/team" },
  exclude: [] as string[],
};

test("同一データ・同一実ファイルへの FileChange が新旧レイアウトでバイト一致", async () => {
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  const cLegacy = computeChanges(await resolveDesired({ source: legacy, ...ARGS }), ACTUAL).sort(
    byPath,
  );
  const cV3 = computeChanges(await resolveDesired({ source: v3, ...ARGS }), ACTUAL).sort(byPath);
  expect(cV3).toEqual(cLegacy);
});

test("renovate.json 不在時の createContent は意味的同一(正準化差は許容)", async () => {
  const lc = computeChanges(await resolveDesired({ source: legacy, ...ARGS }), {}).find(
    (c) => c.path === "renovate.json",
  );
  const vc = computeChanges(await resolveDesired({ source: v3, ...ARGS }), {}).find(
    (c) => c.path === "renovate.json",
  );
  expect(JSON.parse(vc?.content ?? "")).toEqual(JSON.parse(lc?.content ?? ""));
});
