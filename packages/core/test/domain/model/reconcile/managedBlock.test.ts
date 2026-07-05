import { describe, expect, test } from "vitest";
import {
  applyManagedBlock,
  BLOCK_END,
  BLOCK_START,
  removeManagedBlock,
} from "../../../../src/domain/model/reconcile/managedBlock.js";

const block = (inner: string) => `${BLOCK_START}\n${inner}\n${BLOCK_END}`;

test("creates block-only file when actual is absent", () => {
  expect(applyManagedBlock(undefined, "a\nb")).toBe(`${block("a\nb")}\n`);
});

test("prepends block when actual has no markers, preserving existing content", () => {
  expect(applyManagedBlock("repo1\nrepo2\n", "a")).toBe(`${block("a")}\nrepo1\nrepo2\n`);
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

test("drops an existing unmarked line that duplicates the managed block content", () => {
  // v0 等が残した「これから管理する行」と同一の既存行は managed ブロックに集約する（重複させない）
  expect(applyManagedBlock("* @team\n", "* @team")).toBe(`${block("* @team")}\n`);
});

test("keeps repo-own lines but drops ones duplicating the block content", () => {
  expect(applyManagedBlock("* @team\n/docs @docs\n", "* @team")).toBe(
    `${block("* @team")}\n/docs @docs\n`,
  );
});

test("drops duplicate lines left outside the block on re-apply", () => {
  const actual = `${block("* @team")}\n* @team\n`;
  expect(applyManagedBlock(actual, "* @team")).toBe(`${block("* @team")}\n`);
});

test("dedups multiple duplicated lines (.gitignore-style multi-line block)", () => {
  // .gitignore のような複数行ブロックでも、外に残った重複行をまとめて除去する
  const content = "node_modules/\ndist/\n*.log";
  expect(applyManagedBlock("node_modules/\ndist/\n*.log\n", content)).toBe(`${block(content)}\n`);
});

test("dedups only matching lines, keeping repo-specific ignores in order", () => {
  const content = "node_modules/\ndist/";
  // /secret.txt はリポ固有 → 保持、node_modules/・dist/ は重複 → 除去
  expect(applyManagedBlock("node_modules/\n/secret.txt\ndist/\n", content)).toBe(
    `${block(content)}\n/secret.txt\n`,
  );
});

describe("removeManagedBlock (spec §5.5 exclude)", () => {
  const managedBlock = `${BLOCK_START}\nmanaged-line\n${BLOCK_END}`;

  test("removes the block, preserving repo-own content below", () => {
    expect(removeManagedBlock(`${managedBlock}\nrepo-own\n`)).toBe("repo-own\n");
  });
  test("no block → returns input unchanged (収束済み no-op)", () => {
    expect(removeManagedBlock("repo-own\n")).toBe("repo-own\n");
  });
  test("block-only file → empty string (ファイル自体は消さない)", () => {
    expect(removeManagedBlock(`${managedBlock}\n`)).toBe("");
  });
  test("undefined (file absent) → undefined", () => {
    expect(removeManagedBlock(undefined)).toBeUndefined();
  });
});
