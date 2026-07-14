import { expect, test } from "vitest";
import { Catalog } from "../../../../src/domain/model/canonical/catalog.js";
import {
  ManagedStructuredFile,
  ManagedTextFile,
  ReplacedFile,
} from "../../../../src/domain/model/canonical/catalogEntry.js";
import { PathContributions } from "../../../../src/domain/model/canonical/contribution.js";
import { Template } from "../../../../src/domain/model/canonical/template.js";

const VALID = JSON.stringify({
  files: {
    _comment: "note",
    ".gitignore": { file_type: "text", mode: "managed" },
    "renovate.json": {
      file_type: "json",
      mode: "managed",
      managed_paths: { extends: { merge: "array" } },
    },
    "SECURITY.md": { file_type: "markdown", mode: "replaced" },
  },
});

test("Catalog.parse: 完全コンストラクタ(検証を通らないインスタンスは作れない)", () => {
  const c = Catalog.parse(VALID);
  expect(c.paths).toEqual([".gitignore", "renovate.json", "SECURITY.md"]); // "_" は無視
  expect(c.entryFor(".gitignore")).toBeInstanceOf(ManagedTextFile);
  expect(c.entryFor("renovate.json")).toBeInstanceOf(ManagedStructuredFile);
  expect(c.entryFor("SECURITY.md")).toBeInstanceOf(ReplacedFile);

  expect(() => Catalog.parse(null)).toThrow(/catalog\.json not found/);
  expect(() => Catalog.parse("{oops")).toThrow(/invalid JSON/);
  expect(() => Catalog.parse('{"files":{}}')).toThrow(/must not be empty/);
  expect(() => Catalog.parse('{"files":{"a":{"file_type":"ini","mode":"replaced"}}}')).toThrow(
    /unknown file_type/,
  );
  expect(() => Catalog.parse('{"files":{"a":{"file_type":"text","mode":"sync"}}}')).toThrow(
    /unknown mode/,
  );
  expect(() => Catalog.parse('{"files":{"a.json":{"file_type":"json","mode":"managed"}}}')).toThrow(
    /requires managed_paths/,
  );
  expect(() =>
    Catalog.parse(
      '{"files":{"a.txt":{"file_type":"text","mode":"managed","managed_paths":{"x":{"merge":"array"}}}}}',
    ),
  ).toThrow(/only for managed structured/);
});

test("managed_paths: merge array は key を持てる。table との併用・非文字列は fail fast", () => {
  const ok = Catalog.parse(
    JSON.stringify({
      files: {
        ".pre-commit-config.yaml": {
          file_type: "yaml",
          mode: "managed",
          managed_paths: { repos: { merge: "array", key: "repo" } },
        },
      },
    }),
  );
  const entry = ok.entryFor(".pre-commit-config.yaml");
  if (!(entry instanceof ManagedStructuredFile)) throw new Error("unexpected entry type");
  expect(entry.managedPaths.repos).toEqual({ merge: "array", key: "repo" });

  expect(() =>
    Catalog.parse(
      JSON.stringify({
        files: {
          "x.yml": {
            file_type: "yaml",
            mode: "managed",
            managed_paths: { t: { merge: "table", key: "repo" } },
          },
        },
      }),
    ),
  ).toThrow(/key is only for merge "array"/);

  expect(() =>
    Catalog.parse(
      JSON.stringify({
        files: {
          "x.yml": {
            file_type: "yaml",
            mode: "managed",
            managed_paths: { r: { merge: "array", key: "" } },
          },
        },
      }),
    ),
  ).toThrow(/key must be a non-empty string/);
});

test("assertKnownPaths: catalog 未登録パスの寄与はタイポとして fail fast", () => {
  const c = Catalog.parse(VALID);
  expect(() => c.assertKnownPaths("ts", ["renovte.json"])).toThrow(
    /profiles\/ts\/contributes\.json: path not in catalog: renovte\.json/,
  );
  c.assertKnownPaths("ts", ["renovate.json"]); // OK
});

const CTX = { contributions: {}, contents: {}, repo: "", account: "" };

test("deriveDesired: mode 別ポリモーフィズム", async () => {
  const c = Catalog.parse(VALID);

  const sec = c.entryFor("SECURITY.md")!;
  await expect(
    sec.deriveDesired({
      contributions: new PathContributions("SECURITY.md", [{ profile: "oss", contribution: {} }]),
      template: undefined,
      ctx: CTX,
      universe: {},
    }),
  ).rejects.toThrow(/no template declared for SECURITY\.md/);
  expect(
    await sec.deriveDesired({
      contributions: new PathContributions("SECURITY.md", [{ profile: "oss", contribution: {} }]),
      template: Template.of("# Security\n"),
      ctx: CTX,
      universe: {},
    }),
  ).toEqual({ strategy: "replace", path: "SECURITY.md", content: "# Security\n" });

  // managed text: 描画結果の末尾改行 1 つを落として blockContent に
  const gi = c.entryFor(".gitignore")!;
  expect(
    await gi.deriveDesired({
      contributions: new PathContributions(".gitignore", [{ profile: "base", contribution: {} }]),
      template: Template.of("block\n"),
      ctx: CTX,
      universe: {},
    }),
  ).toEqual({ strategy: "managed-block", path: ".gitignore", blockContent: "block" });

  // managed structured: 寄与キー検証・universe 同梱・createContent 生成
  const rn = c.entryFor("renovate.json")!;
  const derived = await rn.deriveDesired({
    contributions: new PathContributions("renovate.json", [
      { profile: "base", contribution: { extends: ["github>o/rc"] } },
    ]),
    template: undefined,
    ctx: CTX,
    universe: { extends: ["github>o/rc", "github>o/rc:go"] },
  });
  if (derived.strategy !== "structured-managed") throw new Error("unexpected strategy");
  expect(derived.data.extends).toEqual(["github>o/rc"]);
  expect(JSON.parse(derived.createContent)).toEqual({ extends: ["github>o/rc"] });

  await expect(
    rn.deriveDesired({
      contributions: new PathContributions("renovate.json", [
        { profile: "ts", contribution: { extend: ["typo"] } },
      ]),
      template: undefined,
      ctx: CTX,
      universe: {},
    }),
  ).rejects.toThrow(/not a managed path.*extend/);
});
