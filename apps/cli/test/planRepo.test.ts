import type { TemplateSource } from "@repository-fanout/core";
import { expect, test } from "vitest";
import { planRepo } from "../src/planRepo.js";

// v3 レイアウトのインメモリ source。
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

const renovateSource = v3Source({
  "catalog.json": JSON.stringify({
    files: {
      "renovate.json": {
        file_type: "json",
        mode: "managed",
        managed_paths: { extends: { merge: "array" } },
      },
    },
  }),
  "profiles/base/contributes.json": JSON.stringify({
    "renovate.json": { extends: ["github>o/renovate-config"] },
  }),
});

test("planRepo reports changes vs actual", async () => {
  const plan = await planRepo({
    source: renovateSource,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({}), // 何も無い → 新規作成
  });
  expect(plan.changes.map((c) => c.path)).toEqual(["renovate.json"]);
  // structured-managed の createContent(skeleton 無し)は正準 JSON(2-space + 末尾改行)
  expect(plan.changes[0]?.content).toBe(
    '{\n  "extends": [\n    "github>o/renovate-config"\n  ]\n}\n',
  );
});

test("planRepo no-op when actual matches", async () => {
  const plan = await planRepo({
    source: renovateSource,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    // extends が意味的に同一なら正規化差は no-op
    readActual: async () => ({ "renovate.json": '{"extends":["github>o/renovate-config"]}' }),
  });
  expect(plan.changes).toEqual([]);
});

test("planRepo merges managed block with existing repo content", async () => {
  const src = v3Source({
    "catalog.json": JSON.stringify({
      files: { ".gitignore": { file_type: "text", mode: "managed" } },
    }),
    "profiles/base/contributes.json": JSON.stringify({
      ".gitignore": { template: "gitignore.liquid", sections: [{ comment: "base", ignores: ["a"] }] },
    }),
    "templates/gitignore.liquid":
      '{% assign s = contributions.sections[0] %}{{ s.ignores | join: "\n" }}',
  });
  const plan = await planRepo({
    source: src,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({ ".gitignore": "repo-own\n" }),
  });
  expect(plan.changes[0]!.content).toContain("repo-own");
  expect(plan.changes[0]!.content).toContain("# >>> repository-fanout managed >>>");
});
