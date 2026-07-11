import { describe, expect, it } from "vitest";
import { DistRecord } from "../../../../src/domain/model/retraction/distRecord.js";

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
    expect(() => DistRecord.parse(JSON.stringify({ version: 2, files: {} }))).toThrow(/unsupported/);
  });
  it("from(data) → toData() は等価(境界の載せ替え)", () => {
    const data = { version: 1 as const, files: { "b.txt": { strategy: "create-only" as const, hashes: ["h9"] } } };
    expect(DistRecord.from(data).toData()).toEqual(data);
  });
});
