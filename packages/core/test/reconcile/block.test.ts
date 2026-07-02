import { expect, test } from "vitest";
import { applyManagedBlock, BLOCK_START, BLOCK_END } from "../../src/reconcile/block.js";

const block = (inner: string) => `${BLOCK_START}\n${inner}\n${BLOCK_END}`;

test("creates block-only file when actual is absent", () => {
  expect(applyManagedBlock(undefined, "a\nb")).toBe(block("a\nb") + "\n");
});

test("prepends block when actual has no markers, preserving existing content", () => {
  expect(applyManagedBlock("repo1\nrepo2\n", "a")).toBe(block("a") + "\nrepo1\nrepo2\n");
});

test("replaces only the marked region, preserving before/after", () => {
  const actual = `${block("old")}\nrepo-own\n`;
  expect(applyManagedBlock(actual, "new")).toBe(`${block("new")}\nrepo-own\n`);
});

test("idempotent: applying same content returns identical string", () => {
  const once = applyManagedBlock("repo\n", "x\ny");
  expect(applyManagedBlock(once, "x\ny")).toBe(once);
});

test("markers embedded mid-line are not treated as a block (line-anchored)", () => {
  const actual = `x ${BLOCK_START} y\nz ${BLOCK_END} w\nrepo\n`;
  // 行内にマーカー文字列を含むだけの既存行はブロックではない → 先頭に新規挿入し、既存行は温存。
  expect(applyManagedBlock(actual, "new")).toBe(`${block("new")}\n${actual}`);
});

test("throws when block content itself contains a whole-line marker", () => {
  expect(() => applyManagedBlock(undefined, `a\n${BLOCK_END}\nb`)).toThrow(/marker/i);
  expect(() => applyManagedBlock("repo\n", `${BLOCK_START}\nx`)).toThrow(/marker/i);
});
