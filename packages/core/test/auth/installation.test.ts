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

test("createInstallationToken returns token string", async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    expect(String(url)).toContain("/app/installations/2/access_tokens");
    return new Response(JSON.stringify({ token: "ghs_xxx", expires_at: "2026-01-01T00:00:00Z" }), { status: 201 });
  }) as unknown as typeof fetch;

  const tok = await createInstallationToken({ appJwt: "jwt", installationId: 2, fetchImpl });
  expect(tok.token).toBe("ghs_xxx");
});
