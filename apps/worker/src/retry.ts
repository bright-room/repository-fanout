import { GitHubError } from "@repository-fanout/core";

export interface RetryOpts {
  maxAttempts: number;
  sleep: (ms: number) => Promise<void>;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const base = opts.baseDelayMs ?? 1000;
  const cap = opts.maxDelayMs ?? 60_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof GitHubError && err.class === "retryable";
      if (!retryable || attempt === opts.maxAttempts) throw err;
      const retryAfterMs = err instanceof GitHubError && err.retryAfter ? err.retryAfter * 1000 : undefined;
      const backoff = Math.min(cap, base * 2 ** (attempt - 1));
      await opts.sleep(retryAfterMs ?? backoff);
    }
  }
  throw lastErr;
}
