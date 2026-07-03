import type { TemplateSource } from "@repository-fanout/core";
import { expect, test } from "vitest";
import { planRepo } from "../src/planRepo.js";

const source: TemplateSource = {
  async readFile(p) {
    return p === "base/files/renovate.json" ? '{"extends":[{{renovate_extends}}]}' : null;
  },
  async listFiles(prefix) {
    return prefix === "base/files/" ? ["base/files/renovate.json"] : [];
  },
  async readFragmentManifest(dir) {
    return dir === "base" ? { renovate: ["github>o/renovate-config"] } : null;
  },
  async listNames() {
    return [];
  },
  async nameExists() {
    return true;
  },
};

test("planRepo reports changes vs actual", async () => {
  const plan = await planRepo({
    source,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({}), // 何も無い → 追加
  });
  expect(plan.changes.map((c) => c.path)).toEqual(["renovate.json"]);
  expect(plan.changes[0]?.content).toBe('{"extends":["github>o/renovate-config"]}');
});

test("planRepo no-op when actual matches", async () => {
  const plan = await planRepo({
    source,
    languages: [],
    bundles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({ "renovate.json": '{"extends":["github>o/renovate-config"]}' }),
  });
  expect(plan.changes).toEqual([]);
});

test("planRepo merges managed block with existing repo content", async () => {
  const src: TemplateSource = {
    async readFile(p) {
      return p === "base/files/.gitignore" ? "{{gitignore}}\n" : null;
    },
    async listFiles(prefix) {
      return prefix === "base/files/" ? ["base/files/.gitignore"] : [];
    },
    async readFragmentManifest(dir) {
      return dir === "base" ? { gitignore: [{ ignores: ["a"] }] } : null;
    },
    async listNames() {
      return [];
    },
    async nameExists() {
      return true;
    },
  };
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
