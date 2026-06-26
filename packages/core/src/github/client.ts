import { GitHubError, parseRetryAfter } from "./errors.js";
import type { GitHubClientOptions, HttpMethod } from "./types.js";

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(opts: GitHubClientOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.github.com";
    this.userAgent = opts.userAgent ?? "repository-fanout";
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": this.userAgent,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubError(res.status, url, await res.text(), parseRetryAfter(res.headers));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
