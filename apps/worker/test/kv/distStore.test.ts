import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDistRecord, putDistRecord, toDistRecord, toStored } from "../../src/kv/distStore.js";

describe("distStore", () => {
  it("returns empty record when nothing stored", async () => {
    expect(await getDistRecord(env.MANIFESTS, "acc", "acc/repo")).toEqual({
      version: 1,
      files: {},
    });
  });
  it("round-trips a record without TTL", async () => {
    const rec = {
      version: 1 as const,
      files: { "a.txt": { strategy: "replace" as const, hashes: ["h"] } },
    };
    await putDistRecord(env.MANIFESTS, "acc", "acc/repo", rec);
    expect(await getDistRecord(env.MANIFESTS, "acc", "acc/repo")).toEqual(rec);
  });
  it("未知 version は fail fast(spec §5.3)", async () => {
    await env.MANIFESTS.put("dist:acc:acc/repo2", JSON.stringify({ version: 2, files: {} }));
    await expect(getDistRecord(env.MANIFESTS, "acc", "acc/repo2")).rejects.toThrow(/unsupported/);
  });
  it("保存形 ⇄ 集約の載せ替えは等価(toDistRecord → toStored)", () => {
    const stored = {
      version: 1 as const,
      files: { "b.txt": { strategy: "create-only" as const, hashes: ["h9"] } },
    };
    expect(JSON.stringify(toStored(toDistRecord(stored)))).toBe(JSON.stringify(stored));
  });
});
