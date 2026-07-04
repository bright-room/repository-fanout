import { expect, test } from "vitest";
import { computeChanges } from "../../../../src/domain/model/desired/computeChanges.js";
import { DesiredFile } from "../../../../src/domain/model/desired/desiredFile.js";
import type { DesiredFileData } from "../../../../src/domain/model/desired/desiredFileData.js";
import { BLOCK_END, BLOCK_START } from "../../../../src/domain/model/reconcile/managedBlock.js";
import { RenovateParseError } from "../../../../src/reconcile/extendsField.js";
import type { DesiredEntry } from "../../../../src/templates/types.js";

const managed = ["github>o/rc", "github>o/rc:ts"];
const universe = ["github>o/rc", "github>o/rc:ts", "github>o/rc:java"];

const entries: DesiredEntry[] = [
  { strategy: "replace", path: ".github/release.yml", content: "changelog: {}\n" },
  { strategy: "create-only", path: "STARTER.md", content: "starter\n" },
  { strategy: "managed-block", path: ".gitignore", blockContent: "a\nb" },
  {
    strategy: "extends-field",
    path: "renovate.json",
    managedExtends: managed,
    universe,
    createContent: "CREATE\n",
  },
];

test("replace: differs -> change; same -> noop", () => {
  expect(computeChanges([entries[0]!], { ".github/release.yml": "old\n" })).toHaveLength(1);
  expect(computeChanges([entries[0]!], { ".github/release.yml": "changelog: {}\n" })).toHaveLength(
    0,
  );
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

  const actual = JSON.stringify(
    { extends: ["github>o/rc", "github>o/rc:java", ":pre"], automerge: false },
    null,
    2,
  );
  const [c] = computeChanges([entries[3]!], { "renovate.json": actual });
  const parsed = JSON.parse(c!.content);
  expect(parsed.extends).toEqual(["github>o/rc", "github>o/rc:ts", ":pre"]);
  expect(parsed.automerge).toBe(false);

  expect(computeChanges([entries[3]!], { "renovate.json": c!.content })).toHaveLength(0);
});

test("extends-field: invalid json propagates RenovateParseError", () => {
  expect(() => computeChanges([entries[3]!], { "renovate.json": "{ json5: true, }" })).toThrow(
    RenovateParseError,
  );
});

test("extends-field: non-object top-level json propagates RenovateParseError", () => {
  for (const bad of ["null", "123", '"str"', "[1,2]"]) {
    expect(() => computeChanges([entries[3]!], { "renovate.json": bad })).toThrow(
      RenovateParseError,
    );
  }
});

test("throws (rather than silently no-op) on an unknown strategy", () => {
  const bogus = { strategy: "bogus", path: "x", content: "y" } as unknown as DesiredEntry;
  expect(() => computeChanges([bogus], {})).toThrow(/strategy/i);
});

test("managed-block-retract strips the block, keeps repo content", () => {
  const actual = `${BLOCK_START}\nmanaged\n${BLOCK_END}\nrepo-own\n`;
  const changes = computeChanges([{ strategy: "managed-block-retract", path: ".gitignore" }], {
    ".gitignore": actual,
  });
  expect(changes).toEqual([{ path: ".gitignore", content: "repo-own\n" }]);
});

test("managed-block-retract is a no-op when no block (収束済み)", () => {
  const changes = computeChanges([{ strategy: "managed-block-retract", path: ".gitignore" }], {
    ".gitignore": "repo-own\n",
  });
  expect(changes).toEqual([]);
});

test("managed-block-retract is a no-op when file absent", () => {
  expect(computeChanges([{ strategy: "managed-block-retract", path: ".gitignore" }], {})).toEqual(
    [],
  );
});

test("extends-field-retract removes universe entries, keeps repo-own ones", () => {
  const actual = JSON.stringify({
    extends: ["github>bright-room/renovate-config", "local>own"],
  });
  const changes = computeChanges(
    [
      {
        strategy: "extends-field-retract",
        path: "renovate.json",
        universe: ["github>bright-room/renovate-config"],
      },
    ],
    { "renovate.json": actual },
  );
  expect(JSON.parse(changes[0]!.content).extends).toEqual(["local>own"]);
});

test("extends-field-retract is a no-op when file absent (新規作成しない)", () => {
  expect(
    computeChanges(
      [{ strategy: "extends-field-retract", path: "renovate.json", universe: ["x"] }],
      {},
    ),
  ).toEqual([]);
});

const STRUCTURED: DesiredFileData = {
  strategy: "structured-managed",
  path: "mise.toml",
  fileType: "toml",
  managedPaths: { tools: { merge: "table" } },
  data: { tools: { node: "22" } },
  universe: { tools: ["node", "pnpm"] },
  createContent: `[tools]\nnode = "22"\n`,
};

test("structured-managed: 不在なら createContent、存在ならマージ、同一なら no-op", () => {
  expect(computeChanges([STRUCTURED], {})).toEqual([
    { path: "mise.toml", content: `[tools]\nnode = "22"\n` },
  ]);
  const [change] = computeChanges([STRUCTURED], {
    "mise.toml": `[tools]\nnode = "20"\nterraform = "1.9"\n`,
  });
  expect(change?.content).toContain(`node = "22"`);
  expect(change?.content).toContain(`terraform = "1.9"`);
  expect(computeChanges([STRUCTURED], { "mise.toml": `[tools]\nnode = "22"\n` })).toEqual([]);
});

test("structured-managed-retract: universe 由来だけ除去。ファイル不在は no-op", () => {
  const retract: DesiredFileData = {
    strategy: "structured-managed-retract",
    path: "mise.toml",
    fileType: "toml",
    managedPaths: { tools: { merge: "table" } },
    universe: { tools: ["node", "pnpm"] },
  };
  expect(computeChanges([retract], {})).toEqual([]);
  const [change] = computeChanges([retract], {
    "mise.toml": `[tools]\nnode = "22"\nterraform = "1.9"\n`,
  });
  expect(change?.content).not.toContain("node");
  expect(change?.content).toContain(`terraform = "1.9"`);
});

test("retracted(): exclude 変換の知識は DesiredFile が持つ(spec v2 §5.5)", () => {
  expect(DesiredFile.from(STRUCTURED).retracted()).toEqual({
    strategy: "structured-managed-retract",
    path: "mise.toml",
    fileType: "toml",
    managedPaths: { tools: { merge: "table" } },
    universe: { tools: ["node", "pnpm"] },
  });
  expect(DesiredFile.from({ strategy: "replace", path: "a", content: "x" }).retracted()).toBeNull();
  expect(
    DesiredFile.from({ strategy: "managed-block", path: "b", blockContent: "x" }).retracted(),
  ).toEqual({ strategy: "managed-block-retract", path: "b" });
});
