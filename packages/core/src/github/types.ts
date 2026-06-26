export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface GitHubClientOptions {
  token: string;
  /** テスト用に fetch を注入。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
}
