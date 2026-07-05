import { describe, expect, it } from "vitest";
import {
  emptyDistRecord,
  parseDistRecord,
  recordDistribution,
} from "../../../../src/domain/model/retraction/distRecord.js";

describe("parseDistRecord", () => {
  it("returns empty record for null (first run)", () => {
    expect(parseDistRecord(null)).toEqual({ version: 1, files: {} });
  });
  it("parses a stored record", () => {
    const raw = JSON.stringify({
      version: 1,
      files: { "a.txt": { strategy: "replace", hashes: ["h1"] } },
    });
    expect(parseDistRecord(raw).files["a.txt"]!.hashes).toEqual(["h1"]);
  });
  it("rejects unknown version (fail fast, spec §5.3)", () => {
    expect(() => parseDistRecord(JSON.stringify({ version: 2, files: {} }))).toThrow(/unsupported/);
  });
});

describe("recordDistribution", () => {
  it("appends new hash preserving history (spec §5.3: hashes は履歴)", () => {
    const r = recordDistribution(
      { version: 1, files: { "a.txt": { strategy: "replace", hashes: ["h1"] } } },
      [{ path: "a.txt", strategy: "replace", hash: "h2" }],
    );
    expect(r.files["a.txt"]!.hashes).toEqual(["h1", "h2"]);
  });
  it("dedupes an already-recorded hash", () => {
    const r = recordDistribution(
      { version: 1, files: { "a.txt": { strategy: "replace", hashes: ["h1"] } } },
      [{ path: "a.txt", strategy: "replace", hash: "h1" }],
    );
    expect(r.files["a.txt"]!.hashes).toEqual(["h1"]);
  });
  it("adds a new path", () => {
    const r = recordDistribution(emptyDistRecord(), [
      { path: "b.txt", strategy: "create-only", hash: "h9" },
    ]);
    expect(r.files["b.txt"]).toEqual({ strategy: "create-only", hashes: ["h9"] });
  });
  it("does not mutate the input record", () => {
    const input = { version: 1 as const, files: {} };
    recordDistribution(input, [{ path: "x", strategy: "replace" as const, hash: "h" }]);
    expect(input.files).toEqual({});
  });
});
