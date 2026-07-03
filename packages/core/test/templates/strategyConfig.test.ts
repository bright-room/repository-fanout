import { expect, test } from "vitest";
import { parseStrategyConfig } from "../../src/templates/strategyConfig.js";

test("accepts a valid path -> strategy map", () => {
  const c = parseStrategyConfig('{"renovate.json":"extends-field",".gitignore":"managed-block"}');
  expect(c).toEqual({ "renovate.json": "extends-field", ".gitignore": "managed-block" });
});

test("accepts {} as explicit 'no special strategies'", () => {
  expect(parseStrategyConfig("{}")).toEqual({});
});

test("rejects missing file (null) — no silent downgrade to replace", () => {
  expect(() => parseStrategyConfig(null)).toThrow(/strategies\.json not found/i);
});

test("rejects invalid JSON", () => {
  expect(() => parseStrategyConfig("{oops")).toThrow(/invalid JSON/i);
});

test("rejects non-object roots", () => {
  expect(() => parseStrategyConfig('["extends-field"]')).toThrow(/object/i);
  expect(() => parseStrategyConfig('"extends-field"')).toThrow(/object/i);
});

test("rejects unknown strategy values, naming the offending path", () => {
  expect(() => parseStrategyConfig('{"renovate.json":"replace"}')).toThrow(/renovate\.json/);
  expect(() => parseStrategyConfig('{"a.md":5}')).toThrow(/a\.md/);
});
