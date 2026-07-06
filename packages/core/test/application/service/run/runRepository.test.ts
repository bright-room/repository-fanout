import { expect, test } from "vitest";
import type { RunRepository } from "../../../../src/application/service/run/runRepository.js";
import type { RepoResult } from "../../../../src/domain/model/run/repoResult.js";

const r: RepoResult = { account: "acme", repo: "acme/r1", status: "noop" };
const fake: RunRepository = {
  record: async () => {},
  getRun: async () => [r],
};

test("RunRepository の契約に適合するフェイクが実装できる", async () => {
  expect(await fake.getRun("run-1")).toEqual([r]);
});
