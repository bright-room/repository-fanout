import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import {
  getManifest,
  getManifestSafe,
  listManifests,
  putManifestCas,
} from "../../src/kv/manifestStore.js";

const m = (rev: number) => ({
  account: "bright-room",
  revision: rev,
  sourceCommit: "c",
  repositories: { r: { languages: [], bundles: [], contents: {}, exclude: [] } },
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

describe("壊れた保存 manifest への耐性(self-heal。vars デッドロック再発防止)", () => {
  // 現行 parseManifest が拒否する旧スキーマ(vars)を直接 KV に書く
  const corrupt = (account: string) =>
    JSON.stringify({
      account,
      revision: 100,
      sourceCommit: "c",
      repositories: { r: { languages: [], vars: { codeowner: "x" } } },
    });

  test("getManifestSafe は壊れた保存 manifest を null 扱い(getManifest は throw)", async () => {
    await env.MANIFESTS.put("manifest:heal-safe", corrupt("heal-safe"));
    await expect(getManifest(env.MANIFESTS, "heal-safe")).rejects.toThrow(/vars/);
    expect(await getManifestSafe(env.MANIFESTS, "heal-safe")).toBeNull();
  });

  test("putManifestCas は壊れた current を上書きできる(書き込みがデッドロックしない)", async () => {
    await env.MANIFESTS.put("manifest:heal-write", corrupt("heal-write"));
    // 壊れた current は「無し」扱いなので、revision に関係なく上書きできる
    expect(await putManifestCas(env.MANIFESTS, { ...m(1), account: "heal-write" })).toEqual({
      stored: true,
      stale: false,
    });
    expect((await getManifest(env.MANIFESTS, "heal-write"))?.revision).toBe(1);
  });

  test("listManifests は壊れた 1 件を巻き添えにせず健全分を返す", async () => {
    await env.MANIFESTS.put("manifest:heal-list-bad", corrupt("heal-list-bad"));
    await putManifestCas(env.MANIFESTS, { ...m(1), account: "heal-list-good" });
    const names = (await listManifests(env.MANIFESTS)).map((x) => x.account);
    expect(names).toContain("heal-list-good");
    expect(names).not.toContain("heal-list-bad");
  });
});
