export type StatusClass = "ok" | "retryable" | "fatal";

export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 403 || status === 409) return "retryable";
  if (status >= 500) return "retryable";
  return "fatal"; // 401/404/422 など
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const v = headers.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
    readonly retryAfter?: number,
  ) {
    super(`GitHub ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = "GitHubError";
  }
  get class(): StatusClass {
    return classifyStatus(this.status);
  }
}
