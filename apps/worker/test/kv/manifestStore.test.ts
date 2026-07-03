import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { getManifest, listManifests, putManifestCas } from "../../src/kv/manifestStore.js";

const m = (rev: number) => ({
  account: "bright-room",
  revision: rev,
  sourceCommit: "c",
  repositories: { r: { languages: [], bundles: [], vars: {}, exclude: [] } },
});

test("putManifestCas stores and getManifest reads back", async () => {
  const r = await putManifestCas(env.MANIFESTS, m(1));
  expect(r.stored).toBe(true);
  const got = await getManifest(env.MANIFESTS, "bright-room");
  expect(got?.revision).toBe(1);
});

test("putManifestCas rejects older/equal revision", async () => {
  await putManifestCas(env.MANIFESTS, m(5));
  expect((await putManifestCas(env.MANIFESTS, m(4))).stored).toBe(false);
  expect((await putManifestCas(env.MANIFESTS, m(5))).stored).toBe(false);
  expect((await putManifestCas(env.MANIFESTS, m(6))).stored).toBe(true);
});

test("listManifests returns all stored accounts", async () => {
  await putManifestCas(env.MANIFESTS, { ...m(1), account: "kukv" });
  const all = await listManifests(env.MANIFESTS);
  expect(all.map((x) => x.account).sort()).toContain("kukv");
});

describe("putManifestCas revision semantics (spec v2 §6.1)", () => {
  // KV 状態はこのファイル内のテストを跨いで持続するため、上の既存テストと衝突しない
  // account を使う(既存の "listManifests" テストが "kukv" を使うのと同じ理由)。
  const rev = (account: string, revision: number) => ({ ...m(revision), account });

  test("newer revision → stored", async () => {
    await putManifestCas(env.MANIFESTS, rev("rev-newer", 1));
    expect(await putManifestCas(env.MANIFESTS, rev("rev-newer", 2))).toEqual({
      stored: true,
      stale: false,
    });
  });
  test("equal revision → not stored but NOT stale (再実行要求として受理)", async () => {
    await putManifestCas(env.MANIFESTS, rev("rev-equal", 5));
    expect(await putManifestCas(env.MANIFESTS, rev("rev-equal", 5))).toEqual({
      stored: false,
      stale: false,
    });
  });
  test("strictly older revision → stale (これだけ拒否)", async () => {
    await putManifestCas(env.MANIFESTS, rev("rev-older", 5));
    expect(await putManifestCas(env.MANIFESTS, rev("rev-older", 4))).toEqual({
      stored: false,
      stale: true,
    });
  });
});
