import { expect, test } from "vitest";
import { computeChanges } from "../../src/reconcile/diff.js";
import { BLOCK_START, BLOCK_END } from "../../src/reconcile/block.js";
import { RenovateParseError } from "../../src/reconcile/extendsField.js";
import type { DesiredEntry } from "../../src/templates/types.js";

const managed = ["github>o/rc", "github>o/rc:ts"];
const universe = ["github>o/rc", "github>o/rc:ts", "github>o/rc:java"];

const entries: DesiredEntry[] = [
  { strategy: "replace", path: ".github/release.yml", content: "changelog: {}\n" },
  { strategy: "create-only", path: "STARTER.md", content: "starter\n" },
  { strategy: "managed-block", path: ".gitignore", blockContent: "a\nb" },
  { strategy: "extends-field", path: "renovate.json", managedExtends: managed, universe, createContent: "CREATE\n" },
];

test("replace: differs -> change; same -> noop", () => {
  expect(computeChanges([entries[0]!], { ".github/release.yml": "old\n" })).toHaveLength(1);
  expect(computeChanges([entries[0]!], { ".github/release.yml": "changelog: {}\n" })).toHaveLength(0);
});

test("create-only: absent -> create; present (even edited) -> noop", () => {
  expect(computeChanges([entries[1]!], {})).toHaveLength(1);
  expect(computeChanges([entries[1]!], { "STARTER.md": "edited\n" })).toHaveLength(0);
});

test("managed-block: creates block-only file when absent", () => {
  const [c] = computeChanges([entries[2]!], {});
  expect(c!.content).toBe(`${BLOCK_START}\na\nb\n${BLOCK_END}\n`);
});

test("managed-block: updates only block, repo lines preserved; noop when identical", () => {
  const actual = `${BLOCK_START}\nold\n${BLOCK_END}\nrepo-own\n`;
  const [c] = computeChanges([entries[2]!], { ".gitignore": actual });
  expect(c!.content).toBe(`${BLOCK_START}\na\nb\n${BLOCK_END}\nrepo-own\n`);
  expect(computeChanges([entries[2]!], { ".gitignore": c!.content })).toHaveLength(0);
});

test("extends-field: absent -> createContent; managed updated + repo-own preserved; noop when equal", () => {
  expect(computeChanges([entries[3]!], {})[0]!.content).toBe("CREATE\n");

  const actual = JSON.stringify({ extends: ["github>o/rc", "github>o/rc:java", ":pre"], automerge: false }, null, 2);
  const [c] = computeChanges([entries[3]!], { "renovate.json": actual });
  const parsed = JSON.parse(c!.content);
  expect(parsed.extends).toEqual(["github>o/rc", "github>o/rc:ts", ":pre"]);
  expect(parsed.automerge).toBe(false);

  expect(computeChanges([entries[3]!], { "renovate.json": c!.content })).toHaveLength(0);
});

test("extends-field: invalid json propagates RenovateParseError", () => {
  expect(() => computeChanges([entries[3]!], { "renovate.json": "{ json5: true, }" }))
    .toThrow(RenovateParseError);
});

test("extends-field: non-object top-level json propagates RenovateParseError", () => {
  for (const bad of ["null", "123", '"str"', "[1,2]"]) {
    expect(() => computeChanges([entries[3]!], { "renovate.json": bad }))
      .toThrow(RenovateParseError);
  }
});
