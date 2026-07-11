import { describe, expect, it } from "vitest";
import { DistRecord } from "../../../../src/domain/model/retraction/distRecord.js";
import { Sha256 } from "../../../../src/domain/type/sha256.js";

describe("DistRecord.parse / empty / from / toData", () => {
  it("null(初回)は空レコード", () => {
    expect(DistRecord.parse(null).toData()).toEqual({ version: 1, files: {} });
  });
  it("保存済みレコードをパースし toData で往復できる", () => {
    const raw = JSON.stringify({
      version: 1,
      files: { "a.txt": { strategy: "replace", hashes: ["h1"] } },
    });
    expect(DistRecord.parse(raw).toData()).toEqual({
      version: 1,
      files: { "a.txt": { strategy: "replace", hashes: ["h1"] } },
    });
  });
  it("未知 version は fail fast(spec §5.3)", () => {
    expect(() => DistRecord.parse(JSON.stringify({ version: 2, files: {} }))).toThrow(
      /unsupported/,
    );
  });
  it("from(data) → toData() は等価(境界の載せ替え)", () => {
    const data = {
      version: 1 as const,
      files: { "b.txt": { strategy: "create-only" as const, hashes: ["h9"] } },
    };
    expect(DistRecord.from(data).toData()).toEqual(data);
  });
});

describe("DistRecord.recordDistribution", () => {
  it("新しいハッシュを履歴として追記する(spec §5.3)", async () => {
    const rec = DistRecord.from({
      version: 1,
      files: { "a.txt": { strategy: "replace", hashes: ["h1"] } },
    });
    const next = rec.recordDistribution([
      { path: "a.txt", strategy: "replace", hash: Sha256.fromHex("h2") },
    ]);
    expect(next.toData().files["a.txt"]!.hashes).toEqual(["h1", "h2"]);
  });
  it("既に記録済みのハッシュは重複させない", async () => {
    const rec = DistRecord.from({
      version: 1,
      files: { "a.txt": { strategy: "replace", hashes: ["h1"] } },
    });
    const next = rec.recordDistribution([
      { path: "a.txt", strategy: "replace", hash: Sha256.fromHex("h1") },
    ]);
    expect(next.toData().files["a.txt"]!.hashes).toEqual(["h1"]);
  });
  it("新規パスを追加する", async () => {
    const next = DistRecord.empty().recordDistribution([
      { path: "b.txt", strategy: "create-only", hash: Sha256.fromHex("h9") },
    ]);
    expect(next.toData().files["b.txt"]).toEqual({ strategy: "create-only", hashes: ["h9"] });
  });
  it("入力の集約を変更しない(非破壊)", async () => {
    const rec = DistRecord.empty();
    rec.recordDistribution([{ path: "x", strategy: "replace", hash: Sha256.fromHex("h") }]);
    expect(rec.toData().files).toEqual({});
  });
});

const recordOf = async (path: string, content: string): Promise<DistRecord> =>
  DistRecord.from({
    version: 1,
    files: { [path]: { strategy: "replace", hashes: [(await Sha256.of(content)).toString()] } },
  });

describe("DistRecord.planRetraction (spec §5.4/§5.5)", () => {
  it("ハッシュ一致 → 削除提案・記録は merge 確認まで維持", async () => {
    const r = await (await recordOf("old.yml", "OLD")).planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "OLD" },
    });
    expect(r.deletions).toEqual(["old.yml"]);
    expect(r.record.toData().files["old.yml"]).toBeDefined();
    expect(r.kept).toEqual([]);
  });
  it("履歴のいずれかと一致(時間差 merge)", async () => {
    const rec = DistRecord.from({
      version: 1,
      files: {
        "old.yml": {
          strategy: "replace",
          hashes: [(await Sha256.of("V1")).toString(), (await Sha256.of("V2")).toString()],
        },
      },
    });
    const r = await rec.planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "V1" },
    });
    expect(r.deletions).toEqual(["old.yml"]);
  });
  it("実ファイル不在 → 記録から掃除", async () => {
    const r = await (await recordOf("old.yml", "OLD")).planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: {},
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.toData().files["old.yml"]).toBeUndefined();
  });
  it("改変済み → 消さず記録から外し注記(残しすぎに倒す)", async () => {
    const r = await (await recordOf("old.yml", "OLD")).planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "REPO-EDITED" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.toData().files["old.yml"]).toBeUndefined();
    expect(r.kept).toEqual([{ path: "old.yml", reason: "modified" }]);
  });
  it("まだ望ましいパスは候補にならない", async () => {
    const r = await (await recordOf("keep.yml", "X")).planRetraction({
      desiredPaths: ["keep.yml"],
      excluded: [],
      actual: { "keep.yml": "X" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.toData().files["keep.yml"]).toBeDefined();
  });
  it("exclude → 引き渡し: 消さず記録から外し注記(spec §5.5)", async () => {
    const r = await (await recordOf("release.yml", "X")).planRetraction({
      desiredPaths: [],
      excluded: ["release.yml"],
      actual: { "release.yml": "X" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.toData().files["release.yml"]).toBeUndefined();
    expect(r.kept).toEqual([{ path: "release.yml", reason: "excluded" }]);
  });
});
