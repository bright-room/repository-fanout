import type { Installation } from "../../../domain/model/installation/installation.js";
import { GitHubClient } from "../client.js";

interface ListArgs {
  appJwt: string;
  fetchImpl?: typeof fetch;
}

export async function listInstallations(args: ListArgs): Promise<Installation[]> {
  const gh = new GitHubClient({ token: args.appJwt, fetchImpl: args.fetchImpl });
  const perPage = 100;
  const out: Installation[] = [];
  // ページ番号でたどる。フルページが返る限り次ページを取得し、
  // per_page 未満が返ったら最終ページ。
  for (let page = 1; ; page++) {
    const raw = await gh.request<Array<{ id: number; account: { login: string; type: string } }>>(
      "GET",
      `/app/installations?per_page=${perPage}&page=${page}`,
    );
    for (const r of raw) {
      out.push({
        id: r.id,
        account: r.account.login,
        accountType: r.account.type === "Organization" ? "Organization" : "User",
      });
    }
    if (raw.length < perPage) break;
  }
  return out;
}

interface TokenArgs {
  appJwt: string;
  installationId: number;
  fetchImpl?: typeof fetch;
}

export async function createInstallationToken(
  args: TokenArgs,
): Promise<{ token: string; expiresAt: string }> {
  const gh = new GitHubClient({ token: args.appJwt, fetchImpl: args.fetchImpl });
  const r = await gh.request<{ token: string; expires_at: string }>(
    "POST",
    `/app/installations/${args.installationId}/access_tokens`,
  );
  return { token: r.token, expiresAt: r.expires_at };
}
