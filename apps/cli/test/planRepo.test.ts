import { expect, test } from "vitest";
import { planRepo } from "../src/planRepo.js";
import type { TemplateSource } from "@repository-fanout/core";

const source: TemplateSource = {
  async readFile(p) {
    return p === "base/files/renovate.json" ? '{"extends":[{{renovate_extends}}]}' : null;
  },
  async listFiles(prefix) {
    return prefix === "base/files/" ? ["base/files/renovate.json"] : [];
  },
  async readProfileManifest(dir) {
    return dir === "base" ? { renovate: ["github>o/c//presets/default"] } : null;
  },
  async profileExists() {
    return true;
  },
};

test("planRepo reports changes vs actual", async () => {
  const plan = await planRepo({
    source,
    profiles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({}), // 何も無い → 追加
  });
  expect(plan.changes.map((c) => c.path)).toEqual(["renovate.json"]);
  expect(plan.changes[0]?.content).toBe('{"extends":["github>o/c//presets/default"]}');
});

test("planRepo no-op when actual matches", async () => {
  const plan = await planRepo({
    source,
    profiles: [],
    vars: {},
    exclude: [],
    readActual: async () => ({ "renovate.json": '{"extends":["github>o/c//presets/default"]}' }),
  });
  expect(plan.changes).toEqual([]);
});
