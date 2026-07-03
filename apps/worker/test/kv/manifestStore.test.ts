import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { getManifest, listManifests, putManifestCas } from "../../src/kv/manifestStore.js";

const m = (rev: number) => ({
  account: "bright-room",
  revision: rev,
  sourceCommit: "c",
  repositories: { r: { languages: [], vars: {}, exclude: [] } },
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
