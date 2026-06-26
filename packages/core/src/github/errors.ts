export type StatusClass = "ok" | "retryable" | "fatal";

export interface ClassifyOptions {
  /** Retry-After ヘッダがあるか（403 secondary rate limit のシグナル） */
  hasRetryAfter?: boolean;
  /** x-ratelimit-remaining の値（0 なら 403 はレート制限） */
  rateLimitRemaining?: number;
}

export function classifyStatus(status: number, opts?: ClassifyOptions): StatusClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 409) return "retryable";
  if (status === 403) {
    // 権限不足の 403 は fatal。secondary rate limit（Retry-After あり）または
    // 一次レート枯渇（remaining=0）のときのみ retryable。
    if (opts?.hasRetryAfter || opts?.rateLimitRemaining === 0) return "retryable";
    return "fatal";
  }
  if (status >= 500) return "retryable";
  return "fatal"; // 401/404/422 など
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const v = headers.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseRateLimitRemaining(headers: Headers): number | undefined {
  const v = headers.get("x-ratelimit-remaining");
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
    readonly retryAfter?: number,
    readonly rateLimitRemaining?: number,
  ) {
    super(`GitHub ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = "GitHubError";
  }
  get class(): StatusClass {
    return classifyStatus(this.status, {
      hasRetryAfter: this.retryAfter !== undefined,
      rateLimitRemaining: this.rateLimitRemaining,
    });
  }
}
