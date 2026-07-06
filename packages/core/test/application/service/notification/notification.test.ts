import { expect, test } from "vitest";
import type {
  FailureInfo,
  KeptFilesInfo,
  Notification,
} from "../../../../src/application/service/notification/notification.js";

const fail: FailureInfo = { runId: "r", account: "acme", repo: "acme/r1", error: "boom" };
const kept: KeptFilesInfo = {
  runId: "r",
  account: "acme",
  repo: "acme/r1",
  kept: [{ path: "X", reason: "modified" }],
};
const fake: Notification = {
  notifyFailure: async () => {},
  notifyKeptFiles: async () => {},
};

test("Notification の契約に適合するフェイクが実装できる", async () => {
  await expect(fake.notifyFailure(fail)).resolves.toBeUndefined();
  await expect(fake.notifyKeptFiles(kept)).resolves.toBeUndefined();
});
