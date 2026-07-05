import { describe, expect, it } from "vitest";
import type { DistRecord } from "../../../../src/domain/model/retraction/distRecord.js";
import { planRetraction } from "../../../../src/domain/model/retraction/retractionPlan.js";
import { sha256Hex } from "../../../../src/domain/type/hash.js";

const record = async (path: string, content: string): Promise<DistRecord> => ({
  version: 1,
  files: { [path]: { strategy: "replace", hashes: [await sha256Hex(content)] } },
});

describe("planRetraction (spec §5.4)", () => {
  it("hash match → deletion proposed, record KEPT until merge confirmed", async () => {
    const r = await planRetraction({
      record: await record("old.yml", "OLD"),
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "OLD" },
    });
    expect(r.deletions).toEqual(["old.yml"]);
    expect(r.record.files["old.yml"]).toBeDefined(); // 提案時に記録を外すと PR 再構築で削除が消える
    expect(r.kept).toEqual([]);
  });

  it("hash matches ANY of the history (時間差 merge)", async () => {
    const rec: DistRecord = {
      version: 1,
      files: {
        "old.yml": { strategy: "replace", hashes: [await sha256Hex("V1"), await sha256Hex("V2")] },
      },
    };
    const r = await planRetraction({
      record: rec,
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "V1" },
    });
    expect(r.deletions).toEqual(["old.yml"]);
  });

  it("file absent → dropped from record (掃除完了)", async () => {
    const r = await planRetraction({
      record: await record("old.yml", "OLD"),
      desiredPaths: [],
      excluded: [],
      actual: {},
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files["old.yml"]).toBeUndefined();
  });

  it("modified file → NOT deleted, dropped from record, noted (残しすぎに倒す)", async () => {
    const r = await planRetraction({
      record: await record("old.yml", "OLD"),
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "REPO-EDITED" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files["old.yml"]).toBeUndefined();
    expect(r.kept).toEqual([{ path: "old.yml", reason: "modified" }]);
  });

  it("still-desired path is never a candidate", async () => {
    const r = await planRetraction({
      record: await record("keep.yml", "X"),
      desiredPaths: ["keep.yml"],
      excluded: [],
      actual: { "keep.yml": "X" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files["keep.yml"]).toBeDefined();
  });

  it("excluded path → handover: not deleted, dropped from record, noted (spec §5.5)", async () => {
    const r = await planRetraction({
      record: await record("release.yml", "X"),
      desiredPaths: [],
      excluded: ["release.yml"],
      actual: { "release.yml": "X" }, // ハッシュ一致でも消さない
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files["release.yml"]).toBeUndefined();
    expect(r.kept).toEqual([{ path: "release.yml", reason: "excluded" }]);
  });
});
