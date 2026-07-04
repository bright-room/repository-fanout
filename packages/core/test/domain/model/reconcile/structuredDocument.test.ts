import { expect, test } from "vitest";
import {
  type ManagedPathsSpec,
  mergeManagedArray,
  mergeManagedTable,
  StructuredDocument,
  StructuredParseError,
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

const RENOVATE: ManagedPathsSpec = {
  managedPaths: { extends: { merge: "array" } },
  data: { extends: ["github>o/rc", "github>o/rc:ts"] },
  universe: { extends: ["github>o/rc", "github>o/rc:ts", "github>o/rc:go"] },
};

test("json: 管理フィールドだけ更新。他キー・リポ独自エントリは温存", () => {
  const doc = StructuredDocument.parse(
    "json",
    "renovate.json",
    `{\n  "$schema": "s",\n  "extends": ["github>o/rc:go", ":timezone(Asia/Tokyo)"]\n}\n`,
  );
  expect(JSON.parse(doc.mergedContent(RENOVATE)!)).toEqual({
    $schema: "s",
    extends: ["github>o/rc", "github>o/rc:ts", ":timezone(Asia/Tokyo)"],
  });
});

test("json: 意味的同一なら null。パース不能 / 非 object は完全コンストラクタで弾く", () => {
  const same = StructuredDocument.parse(
    "json",
    "renovate.json",
    `{"extends":["github>o/rc","github>o/rc:ts"]}`,
  );
  expect(same.mergedContent(RENOVATE)).toBeNull();
  expect(() => StructuredDocument.parse("json", "renovate.json", "{oops")).toThrow(
    StructuredParseError,
  );
  expect(() => StructuredDocument.parse("json", "renovate.json", "[]")).toThrow(
    StructuredParseError,
  );
});

const MISE: ManagedPathsSpec = {
  managedPaths: { tools: { merge: "table" } },
  data: { tools: { node: "22.12.0", "npm:prettier": "3.3.2" } },
  universe: { tools: ["node", "pnpm", "npm:prettier"] },
};

test("toml: [tools] だけマージ。quoted key 対応・リポ独自キー温存・他セクション維持", () => {
  const doc = StructuredDocument.parse(
    "toml",
    "mise.toml",
    `[env]\nNODE_ENV = "development"\n\n[tools]\nnode = "20"\npnpm = "9"\nterraform = "1.9.0"\n`,
  );
  const next = doc.mergedContent(MISE);
  expect(next).toContain(`node = "22.12.0"`);
  expect(next).toContain(`"npm:prettier" = "3.3.2"`);
  expect(next).toContain(`terraform = "1.9.0"`);
  expect(next).not.toContain("pnpm");
  expect(next).toContain(`NODE_ENV = "development"`);
});

test("toml: 意味的同一なら null(キー順・空白差だけでは書き換えない。spec v3 C7)", () => {
  const doc = StructuredDocument.parse(
    "toml",
    "mise.toml",
    `[tools]\n\n"npm:prettier" = "3.3.2"\nnode    = "22.12.0"\n`,
  );
  expect(doc.mergedContent(MISE)).toBeNull();
});

const YAML_SPEC: ManagedPathsSpec = {
  managedPaths: { managed_list: { merge: "array" } },
  data: { managed_list: ["a", "b"] },
  universe: { managed_list: ["a", "b", "old"] },
};

test("yaml: 対象パスだけ更新し、対象外のコメントは保持", () => {
  const doc = StructuredDocument.parse(
    "yaml",
    "x.yml",
    `# repo のコメント\nother: keep\nmanaged_list:\n  - old\n  - mine\n`,
  );
  const next = doc.mergedContent(YAML_SPEC)!;
  expect(next).toContain("# repo のコメント");
  expect(next).toContain("other: keep");
  expect(next).toContain("- a");
  expect(next).toContain("- mine");
  expect(next).not.toContain("- old");
});

test("createContent: 骨格なし = 管理データのみ / 骨格あり = 骨格へマージ", () => {
  expect(StructuredDocument.createContent("toml", "mise.toml", MISE)).toBe(
    `[tools]\nnode = "22.12.0"\n"npm:prettier" = "3.3.2"\n`,
  );
  const skeleton = `{\n  "$schema": "s",\n  "extends": []\n}\n`;
  const created = StructuredDocument.createContent("json", "renovate.json", RENOVATE, skeleton);
  expect(JSON.parse(created)).toEqual({ $schema: "s", extends: ["github>o/rc", "github>o/rc:ts"] });
});
