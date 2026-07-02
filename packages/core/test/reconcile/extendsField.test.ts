import { expect, test } from "vitest";
import {
  applyExtendsField,
  mergeExtends,
  RenovateParseError,
} from "../../src/reconcile/extendsField.js";

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
  const actual = JSON.stringify(
    {
      $schema: "s",
      extends: ["github>o/renovate-config"],
      packageRules: [{ matchPackageNames: ["x"], enabled: false }],
    },
    null,
    2,
  );
  const out = applyExtendsField(actual, managed, universe)!;
  const parsed = JSON.parse(out);
  expect(parsed.extends).toEqual(managed);
  expect(parsed.packageRules).toEqual([{ matchPackageNames: ["x"], enabled: false }]);
  expect(parsed.$schema).toBe("s");
});

test("applyExtendsField throws RenovateParseError on invalid json", () => {
  expect(() => applyExtendsField("// json5 comment\n{}", managed, universe)).toThrow(
    RenovateParseError,
  );
});

test("applyExtendsField preserves a bare-string repo-own extends (appended after managed)", () => {
  const actual = JSON.stringify({ extends: "github>myorg/custom", automerge: true });
  const out = applyExtendsField(actual, managed, universe)!;
  const parsed = JSON.parse(out);
  expect(parsed.extends).toEqual([...managed, "github>myorg/custom"]);
  expect(parsed.automerge).toBe(true);
});

test("applyExtendsField treats a bare-string extends equal to managed as a no-op", () => {
  // 文字列形 "x" は正準化で ["x"] 相当。単一 managed と意味的に同一なら書き換えない（フォーマット不可侵）。
  const actual = JSON.stringify({ extends: "github>o/renovate-config" });
  expect(applyExtendsField(actual, ["github>o/renovate-config"], universe)).toBeNull();
});

test("applyExtendsField throws RenovateParseError on non-object top-level json", () => {
  for (const bad of ["null", "123", '"str"', "[1,2]"]) {
    expect(() => applyExtendsField(bad, managed, universe)).toThrow(RenovateParseError);
  }
});
