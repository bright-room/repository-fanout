import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";
import worker from "../src/index.js";

test("non-sync route returns 404", async () => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://x/"), env as never, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});
