import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { getRun, recordRepoResult } from "../../src/kv/runStore.js";

test("records per-repo results retrievable by runId", async () => {
  await recordRepoResult(env.RUNS, "run1", {
    account: "bright-room",
    repo: "r1",
    status: "success",
  });
  await recordRepoResult(env.RUNS, "run1", {
    account: "bright-room",
    repo: "r2",
    status: "failed",
    error: "429",
  });
  const run = await getRun(env.RUNS, "run1");
  expect(run).toHaveLength(2);
  expect(run.find((x) => x.repo === "r2")).toMatchObject({ status: "failed", error: "429" });
});
