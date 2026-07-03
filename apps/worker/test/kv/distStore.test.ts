import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDistRecord, putDistRecord } from "../../src/kv/distStore.js";

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
});
