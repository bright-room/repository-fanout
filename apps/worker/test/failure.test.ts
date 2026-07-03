import { env } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import { reportRepoFailure } from "../src/failure.js";
import type { Env } from "../src/index.js";
import { getRun } from "../src/kv/runStore.js";

afterEach(() => vi.unstubAllGlobals());

test("records a failed result to RUNS and notifies discord", async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response("", { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  // env は test/env.d.ts で Env 型（ProvidedEnv extends Env）
  const testEnv: Env = { ...env, DISCORD_WEBHOOK_URL: "https://discord.example/webhook" };
  await reportRepoFailure(testEnv, "runX", { account: "bright-room", repo: "r1", error: "boom" });
  const run = await getRun(env.RUNS, "runX");
  expect(run).toMatchObject([
    { account: "bright-room", repo: "r1", status: "failed", error: "boom" },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
