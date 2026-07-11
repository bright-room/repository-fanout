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
