import { expect, test } from "vitest";
import { mergeExtends, applyExtendsField, RenovateParseError } from "../../src/reconcile/extendsField.js";

const managed = ["github>o/renovate-config", "github>o/renovate-config:typescript"];
const universe = [
  "github>o/renovate-config",
  "github>o/renovate-config:terraform",
  "github>o/renovate-config:typescript",
  "github>o/renovate-config:java",
  "group:springBoot",
];

test("mergeExtends replaces managed entries and preserves repo-own entries after", () => {
  const actual = ["github>o/renovate-config", "github>o/renovate-config:java", ":enablePreCommit"];
  expect(mergeExtends(actual, managed, universe)).toEqual([
    "github>o/renovate-config",
    "github>o/renovate-config:typescript",
    ":enablePreCommit",
  ]);
});

test("mergeExtends with no actual returns managed", () => {
  expect(mergeExtends(undefined, managed, universe)).toEqual(managed);
});

test("applyExtendsField returns null when semantically equal (no-op, formatting untouched)", () => {
  const actual = `{\n  "extends": ["github>o/renovate-config","github>o/renovate-config:typescript"],\n  "automerge": false\n}\n`;
  expect(applyExtendsField(actual, managed, universe)).toBeNull();
});

test("applyExtendsField rewrites only extends, preserving other keys", () => {
  const actual = JSON.stringify({
    $schema: "s",
    extends: ["github>o/renovate-config"],
    packageRules: [{ matchPackageNames: ["x"], enabled: false }],
  }, null, 2);
  const out = applyExtendsField(actual, managed, universe)!;
  const parsed = JSON.parse(out);
  expect(parsed.extends).toEqual(managed);
  expect(parsed.packageRules).toEqual([{ matchPackageNames: ["x"], enabled: false }]);
  expect(parsed.$schema).toBe("s");
});

test("applyExtendsField throws RenovateParseError on invalid json", () => {
  expect(() => applyExtendsField("// json5 comment\n{}", managed, universe)).toThrow(RenovateParseError);
});

test("applyExtendsField throws RenovateParseError on non-object top-level json", () => {
  for (const bad of ["null", "123", '"str"', "[1,2]"]) {
    expect(() => applyExtendsField(bad, managed, universe)).toThrow(RenovateParseError);
  }
});
