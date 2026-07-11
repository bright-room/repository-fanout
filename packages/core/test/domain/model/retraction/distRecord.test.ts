import { describe, expect, it } from "vitest";
import { DistFileRecord, DistRecord } from "../../../../src/domain/model/retraction/distRecord.js";
import { Sha256 } from "../../../../src/domain/type/sha256.js";

const hexes = (record: DistRecord, path: string): string[] =>
  [...(record.files().get(path)?.hashes ?? [])].map((h) => h.toString());

describe("DistFileRecord", () => {
  it("matches は記録ハッシュのいずれかと一致で true(配った証明)", () => {
    const rec = new DistFileRecord("replace", [Sha256.fromHex("h1"), Sha256.fromHex("h2")]);
    expect(rec.matches(Sha256.fromHex("h2"))).toBe(true);
    expect(rec.matches(Sha256.fromHex("h9"))).toBe(false);
  });
  it("withDistributed は新ハッシュを追記し、記録済みは重複させない", () => {
    const rec = new DistFileRecord("replace", [Sha256.fromHex("h1")]);
    const appended = rec.withDistributed("replace", Sha256.fromHex("h2"));
    expect(appended.hashes.map((h) => h.toString())).toEqual(["h1", "h2"]);
    const same = rec.withDistributed("replace", Sha256.fromHex("h1"));
    expect(same.hashes.map((h) => h.toString())).toEqual(["h1"]);
  });
  it("withDistributed は記録済みハッシュでも strategy を今回値に更新する", () => {
    const rec = new DistFileRecord("replace", [Sha256.fromHex("h1")]);
    const next = rec.withDistributed("create-only", Sha256.fromHex("h1"));
    expect(next.strategy).toBe("create-only");
    expect(next.hashes.map((h) => h.toString())).toEqual(["h1"]);
  });
});

describe("DistRecord.recordDistribution", () => {
  it("新しいハッシュを履歴として追記する(spec §5.3)", () => {
    const rec = DistRecord.of(
      new Map([["a.txt", new DistFileRecord("replace", [Sha256.fromHex("h1")])]]),
    );
    const next = rec.recordDistribution([
      { path: "a.txt", strategy: "replace", hash: Sha256.fromHex("h2") },
    ]);
    expect(hexes(next, "a.txt")).toEqual(["h1", "h2"]);
  });
  it("既に記録済みのハッシュは重複させない", () => {
    const rec = DistRecord.of(
      new Map([["a.txt", new DistFileRecord("replace", [Sha256.fromHex("h1")])]]),
    );
    const next = rec.recordDistribution([
      { path: "a.txt", strategy: "replace", hash: Sha256.fromHex("h1") },
    ]);
    expect(hexes(next, "a.txt")).toEqual(["h1"]);
  });
  it("新規パスを追加する", () => {
    const next = DistRecord.empty().recordDistribution([
      { path: "b.txt", strategy: "create-only", hash: Sha256.fromHex("h9") },
    ]);
    expect(next.files().get("b.txt")?.strategy).toBe("create-only");
    expect(hexes(next, "b.txt")).toEqual(["h9"]);
  });
  it("入力の集約を変更しない(非破壊)", () => {
    const rec = DistRecord.empty();
    rec.recordDistribution([{ path: "x", strategy: "replace", hash: Sha256.fromHex("h") }]);
    expect(rec.files().size).toBe(0);
  });
});

const recordOf = async (path: string, content: string): Promise<DistRecord> =>
  DistRecord.of(new Map([[path, new DistFileRecord("replace", [await Sha256.of(content)])]]));

describe("DistRecord.planRetraction (spec §5.4/§5.5)", () => {
  it("ハッシュ一致 → 削除提案・記録は merge 確認まで維持", async () => {
    const r = await (await recordOf("old.yml", "OLD")).planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "OLD" },
    });
    expect(r.deletions).toEqual(["old.yml"]);
    expect(r.record.files().has("old.yml")).toBe(true);
    expect(r.kept).toEqual([]);
  });
  it("履歴のいずれかと一致(時間差 merge)", async () => {
    const rec = DistRecord.of(
      new Map([
        ["old.yml", new DistFileRecord("replace", [await Sha256.of("V1"), await Sha256.of("V2")])],
      ]),
    );
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
    expect(r.record.files().has("old.yml")).toBe(false);
  });
  it("改変済み → 消さず記録から外し注記(残しすぎに倒す)", async () => {
    const r = await (await recordOf("old.yml", "OLD")).planRetraction({
      desiredPaths: [],
      excluded: [],
      actual: { "old.yml": "REPO-EDITED" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files().has("old.yml")).toBe(false);
    expect(r.kept).toEqual([{ path: "old.yml", reason: "modified" }]);
  });
  it("まだ望ましいパスは候補にならない", async () => {
    const r = await (await recordOf("keep.yml", "X")).planRetraction({
      desiredPaths: ["keep.yml"],
      excluded: [],
      actual: { "keep.yml": "X" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files().has("keep.yml")).toBe(true);
  });
  it("exclude → 引き渡し: 消さず記録から外し注記(spec §5.5)", async () => {
    const r = await (await recordOf("release.yml", "X")).planRetraction({
      desiredPaths: [],
      excluded: ["release.yml"],
      actual: { "release.yml": "X" },
    });
    expect(r.deletions).toEqual([]);
    expect(r.record.files().has("release.yml")).toBe(false);
    expect(r.kept).toEqual([{ path: "release.yml", reason: "excluded" }]);
  });
});
