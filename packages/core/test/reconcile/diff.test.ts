import { expect, test } from "vitest";
import { computeChanges } from "../../src/reconcile/diff.js";
import type { DesiredFile } from "../../src/templates/types.js";

const desired: DesiredFile[] = [
  { path: "renovate.json", content: "A\n", mode: "sync" },
  { path: ".github/CODEOWNERS", content: "* @x\n", mode: "sync" },
  { path: "STARTER.md", content: "starter\n", mode: "create-only" },
];

test("sync file with different actual content -> change", () => {
  const changes = computeChanges(desired, { "renovate.json": "OLD\n", ".github/CODEOWNERS": "* @x\n", "STARTER.md": "starter\n" });
  expect(changes.map((c) => c.path)).toEqual(["renovate.json"]);
  expect(changes[0]!.content).toBe("A\n");
});

test("create-only file present -> no change; absent -> change", () => {
  const present = computeChanges([desired[2]!], { "STARTER.md": "edited\n" });
  expect(present).toEqual([]); // 既存なので触らない
  const absent = computeChanges([desired[2]!], {});
  expect(absent.map((c) => c.path)).toEqual(["STARTER.md"]);
});

test("identical content -> no-op (empty changes)", () => {
  const changes = computeChanges(desired, { "renovate.json": "A\n", ".github/CODEOWNERS": "* @x\n", "STARTER.md": "starter\n" });
  expect(changes).toEqual([]);
});
