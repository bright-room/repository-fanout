import { GitHubClient } from "../github/client.js";

export interface Installation {
  id: number;
  account: string;
  accountType: "Organization" | "User";
}

interface ListArgs { appJwt: string; fetchImpl?: typeof fetch; }

export async function listInstallations(args: ListArgs): Promise<Installation[]> {
  const gh = new GitHubClient({ token: args.appJwt, fetchImpl: args.fetchImpl });
  const raw = await gh.request<Array<{ id: number; account: { login: string; type: string } }>>(
    "GET",
    "/app/installations?per_page=100",
  );
  return raw.map((r) => ({
    id: r.id,
    account: r.account.login,
    accountType: r.account.type === "Organization" ? "Organization" : "User",
  }));
}

interface TokenArgs { appJwt: string; installationId: number; fetchImpl?: typeof fetch; }

export async function createInstallationToken(args: TokenArgs): Promise<{ token: string; expiresAt: string }> {
  const gh = new GitHubClient({ token: args.appJwt, fetchImpl: args.fetchImpl });
  const r = await gh.request<{ token: string; expires_at: string }>(
    "POST",
    `/app/installations/${args.installationId}/access_tokens`,
  );
  return { token: r.token, expiresAt: r.expires_at };
}
