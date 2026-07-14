import { expect, test } from "vitest";
import {
  type ManagedPathsSpec,
  mergeManagedArray,
  mergeManagedKeyedArray,
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

test("yaml: 空 / コメントのみの実ファイルでも例外にせずマージ結果を返す(回帰)", () => {
  // toJS() が null を返すケース。生 TypeError になると per-repo failure でなく
  // Workflow リトライへ化けるため、{} として扱いマージを続行する。
  const empty = StructuredDocument.parse("yaml", "x.yml", "");
  const merged = empty.mergedContent(YAML_SPEC)!;
  expect(merged).toContain("- a");
  expect(merged).toContain("- b");
  const commentOnly = StructuredDocument.parse("yaml", "x.yml", "# TODO\n");
  expect(commentOnly.mergedContent(YAML_SPEC)).not.toBeNull();
});

const GITLEAKS = {
  repo: "https://github.com/gitleaks/gitleaks",
  rev: "v8.30.0",
  hooks: [{ id: "gitleaks" }],
};
const TEXTHOOKS = {
  repo: "https://github.com/sirosen/texthooks",
  rev: "0.7.1",
  hooks: [{ id: "forbid-bidi-controls" }],
};
const PRECOMMIT: ManagedPathsSpec = {
  managedPaths: { repos: { merge: "array", key: "repo" } },
  data: { repos: [GITLEAKS, TEXTHOOKS] },
  universe: {
    repos: [
      "https://github.com/gitleaks/gitleaks",
      "https://github.com/sirosen/texthooks",
      "https://github.com/retired/hook",
    ],
  },
};

test("keyed array: 管理エントリは正準順で収束、universe 外・key 判定不能は温存、寄与が消えた universe キーは削除", () => {
  const universe = PRECOMMIT.universe.repos ?? [];
  const actual = [
    { repo: "local", hooks: [{ id: "golangci-lint" }] },
    { repo: "https://github.com/gitleaks/gitleaks", rev: "v8.0.0", hooks: [{ id: "gitleaks" }] },
    { repo: "https://github.com/retired/hook", rev: "v1" },
    { note: "no key field" },
  ];
  expect(mergeManagedKeyedArray(actual, PRECOMMIT.data.repos, universe, "repo")).toEqual([
    GITLEAKS,
    TEXTHOOKS,
    { repo: "local", hooks: [{ id: "golangci-lint" }] },
    { note: "no key field" },
  ]);
  expect(
    mergeManagedKeyedArray([], [GITLEAKS, { ...GITLEAKS, rev: "v0" }], universe, "repo"),
  ).toEqual([GITLEAKS]);
  expect(() => mergeManagedKeyedArray([], [{ rev: "v1" }], universe, "repo")).toThrow(
    /without key "repo"/,
  );
});

test("yaml keyed: .pre-commit-config.yaml の repos だけ収束し、リポ独自 local hook・コメントを温存", () => {
  const doc = StructuredDocument.parse(
    "yaml",
    ".pre-commit-config.yaml",
    `# repo のコメント
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.0.0
    hooks:
      - id: gitleaks
  - repo: local
    hooks:
      - id: my-check
        name: mine
        entry: ./check.sh
        language: system
`,
  );
  const next = doc.mergedContent(PRECOMMIT)!;
  expect(next).toContain("# repo のコメント");
  expect(next).toContain("rev: v8.30.0");
  expect(next).toContain("forbid-bidi-controls");
  expect(next).toContain("id: my-check");
});

test("yaml keyed: 意味的同一なら null(no-op)。createContent は管理データのみで正準生成", () => {
  const created = StructuredDocument.createContent("yaml", ".pre-commit-config.yaml", PRECOMMIT);
  expect(created).toContain("repo: https://github.com/gitleaks/gitleaks");
  expect(created).toContain("rev: v8.30.0");
  const same = StructuredDocument.parse("yaml", ".pre-commit-config.yaml", created);
  expect(same.mergedContent(PRECOMMIT)).toBeNull();
});

test("createContent: 骨格なし = 管理データのみ / 骨格あり = 骨格へマージ", () => {
  expect(StructuredDocument.createContent("toml", "mise.toml", MISE)).toBe(
    `[tools]\nnode = "22.12.0"\n"npm:prettier" = "3.3.2"\n`,
  );
  const skeleton = `{\n  "$schema": "s",\n  "extends": []\n}\n`;
  const created = StructuredDocument.createContent("json", "renovate.json", RENOVATE, skeleton);
  expect(JSON.parse(created)).toEqual({ $schema: "s", extends: ["github>o/rc", "github>o/rc:ts"] });
});
