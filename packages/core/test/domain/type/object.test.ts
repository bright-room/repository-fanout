import { expect, test } from "vitest";
import { deepEqual, isPlainObject } from "../../../src/domain/type/object.js";

test("isPlainObject: object のみ true(null / 配列 / プリミティブは false)", () => {
  expect(isPlainObject({})).toBe(true);
  expect(isPlainObject(null)).toBe(false);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject("x")).toBe(false);
});

test("deepEqual: キー順に依存しない構造比較(配列は順序込み)", () => {
  expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual(1, "1")).toBe(false);
});
