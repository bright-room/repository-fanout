import { expect, test } from "vitest";
import type { DistRecordRepository } from "../../../../src/application/service/distribution/distRecordRepository.js";
import { emptyDistRecord } from "../../../../src/domain/model/retraction/distRecord.js";

const fake: DistRecordRepository = {
  get: async () => emptyDistRecord(),
  save: async () => {},
};

test("DistRecordRepository の契約に適合するフェイクが実装できる", async () => {
  expect(await fake.get("acme", "acme/r1")).toEqual({ version: 1, files: {} });
});
