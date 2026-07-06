import { expect, test } from "vitest";
import type {
  PrInfo,
  TargetRepository,
} from "../../../../src/application/service/target/targetRepository.js";
import type { TargetPullRequestRepository } from "../../../../src/application/service/target/targetPullRequestRepository.js";

const pr: PrInfo = { number: 1, state: "open", merged: false };
const reader: TargetRepository = {
  getDefaultBranch: async () => ({ branch: "main", sha: "s" }),
  readActualFiles: async () => ({}),
  findPr: async () => pr,
  branchExists: async () => true,
};
const writer: TargetPullRequestRepository = {
  getTreeSha: async () => "t",
  commitChanges: async () => {},
  createPr: async () => 1,
  reopenPr: async () => {},
  updatePrBody: async () => {},
  addLabels: async () => {},
  deleteBranch: async () => {},
};

test("Target 系ポートの契約に適合するフェイクが実装できる", async () => {
  expect((await reader.getDefaultBranch()).branch).toBe("main");
  expect(await writer.createPr({ branch: "b", base: "main", title: "t", body: "x" })).toBe(1);
});
