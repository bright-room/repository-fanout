import { GitHubError } from "@repository-fanout/core";
import { expect, test, vi } from "vitest";
import { withRetry } from "../src/retry.js";

test("retries retryable errors then succeeds", async () => {
  let n = 0;
  const sleep = vi.fn(async () => {});
  const out = await withRetry(
    async () => {
      if (n++ < 2) throw new GitHubError(429, "u", "rl", 1);
      return "done";
    },
    { maxAttempts: 5, sleep },
  );
  expect(out).toBe("done");
  expect(n).toBe(3);
  expect(sleep).toHaveBeenCalledTimes(2);
});

test("does not retry fatal errors", async () => {
  let n = 0;
  await expect(
    withRetry(
      async () => {
        n++;
        throw new GitHubError(422, "u", "bad");
      },
      { maxAttempts: 5, sleep: async () => {} },
    ),
  ).rejects.toMatchObject({ status: 422 });
  expect(n).toBe(1);
});

test("gives up after maxAttempts", async () => {
  await expect(
    withRetry(
      async () => {
        throw new GitHubError(500, "u", "x");
      },
      { maxAttempts: 3, sleep: async () => {} },
    ),
  ).rejects.toMatchObject({ status: 500 });
});
