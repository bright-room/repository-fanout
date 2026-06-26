import { expect, test, vi } from "vitest";
import { listInstallations, createInstallationToken } from "../../src/auth/installation.js";

test("listInstallations maps account login + id", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify([
      { id: 1, account: { login: "bright-room", type: "Organization" } },
      { id: 2, account: { login: "kukv", type: "User" } },
    ]), { status: 200 }),
  ) as unknown as typeof fetch;

  const got = await listInstallations({ appJwt: "jwt", fetchImpl });
  expect(got).toEqual([
    { id: 1, account: "bright-room", accountType: "Organization" },
    { id: 2, account: "kukv", accountType: "User" },
  ]);
});

test("listInstallations paginates across all pages", async () => {
  const mk = (id: number) => ({ id, account: { login: `acct${id}`, type: "User" } });
  const page1 = Array.from({ length: 100 }, (_, i) => mk(i + 1));
  const page2 = [mk(101)];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    const body = u.includes("page=2") ? page2 : page1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  const got = await listInstallations({ appJwt: "jwt", fetchImpl });
  expect(got).toHaveLength(101);
  expect(got.at(-1)).toEqual({ id: 101, account: "acct101", accountType: "User" });
  // page 1 (full) + page 2 (partial) => stops; no third request
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test("createInstallationToken returns token string", async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    expect(String(url)).toContain("/app/installations/2/access_tokens");
    return new Response(JSON.stringify({ token: "ghs_xxx", expires_at: "2026-01-01T00:00:00Z" }), { status: 201 });
  }) as unknown as typeof fetch;

  const tok = await createInstallationToken({ appJwt: "jwt", installationId: 2, fetchImpl });
  expect(tok.token).toBe("ghs_xxx");
});
