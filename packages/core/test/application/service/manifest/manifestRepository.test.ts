import { expect, test } from "vitest";
import type { ManifestRepository } from "../../../../src/application/service/manifest/manifestRepository.js";
import type { Manifest } from "../../../../src/domain/model/manifest/types.js";

const sample: Manifest = {
  account: "acme",
  revision: 1,
  sourceCommit: "abc",
  repositories: { r1: { languages: [], bundles: [], contents: {}, exclude: [] } },
};

// 契約固定: 適合するフェイクが代入できる＝メソッド名・引数・戻り値が仕様どおり（typecheck が強制）
const fake: ManifestRepository = {
  get: async () => sample,
  findUsable: async () => sample,
  list: async () => [sample],
  saveIfNotStale: async () => ({ stored: true, stale: false }),
};

test("ManifestRepository の契約に適合するフェイクが実装できる", async () => {
  expect((await fake.saveIfNotStale(sample)).stored).toBe(true);
  expect(await fake.findUsable("acme")).toEqual(sample);
});
