import { expect, test } from "vitest";
import {
  mergeManagedArray,
  mergeManagedTable,
} from "../../../../src/domain/model/reconcile/structuredDocument.js";

test("array: 管理エントリ正準順 + universe 外のリポ独自(相対順)。mergeExtends の一般化", () => {
  const universe = ["a", "b", "c"];
  expect(mergeManagedArray(["c", "mine", "a"], ["a", "b"], universe)).toEqual(["a", "b", "mine"]);
  expect(mergeManagedArray("mine", ["a"], universe)).toEqual(["a", "mine"]); // 文字列単体形
  expect(mergeManagedArray(undefined, ["a"], universe)).toEqual(["a"]);
});

test("table: 管理キーは寄与値、universe 外は温存、寄与が消えた universe キーは削除", () => {
  const universe = ["node", "pnpm", "go"];
  const actual = { node: "20", go: "1.22", terraform: "1.9.0" };
  expect(mergeManagedTable(actual, { node: "22", pnpm: "10" }, universe)).toEqual({
    node: "22",
    pnpm: "10",
    terraform: "1.9.0",
  });
  expect(mergeManagedTable(undefined, { node: "22" }, universe)).toEqual({ node: "22" });
});
