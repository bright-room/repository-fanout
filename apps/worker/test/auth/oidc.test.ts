import { beforeEach, describe, expect, it } from "vitest";
import { OidcError, resetJwksCache, verifyGitHubOidc } from "../../src/auth/oidc.js";
import { AUD, claims, jwk, jwksFetch, makeToken, regenerateOidcKeyPair } from "../helpers/oidc.js";

beforeEach(async () => {
  resetJwksCache();
  await regenerateOidcKeyPair();
});

describe("verifyGitHubOidc", () => {
  it("accepts a valid token and returns claims", async () => {
    const token = await makeToken(claims());
    const c = await verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch });
    expect(c).toEqual({
      repository: "bright-room/organization-structure",
      repository_owner: "bright-room",
      ref: "refs/heads/main",
    });
  });
  it("rejects a bad signature (401)", async () => {
    const token = await makeToken(claims());
    const tampered = `${token.slice(0, -4)}AAAA`;
    await expect(
      verifyGitHubOidc({ token: tampered, audience: AUD, fetchImpl: jwksFetch }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects wrong audience (401)", async () => {
    const token = await makeToken(claims({ aud: "https://other" }));
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("accepts audience inside an array aud", async () => {
    const token = await makeToken(claims({ aud: ["x", AUD] }));
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch }),
    ).resolves.toBeTruthy();
  });
  it("rejects an expired token (401)", async () => {
    const token = await makeToken(claims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects wrong issuer (401)", async () => {
    const token = await makeToken(claims({ iss: "https://evil.example" }));
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects unknown kid (401)", async () => {
    const token = await makeToken(claims(), { kid: "other-key" });
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("maps JWKS fetch failure to 503 (フェイルクローズ+CI リトライ)", async () => {
    const failFetch: typeof fetch = async () => new Response("boom", { status: 500 });
    const token = await makeToken(claims());
    await expect(
      verifyGitHubOidc({ token, audience: AUD, fetchImpl: failFetch }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("caches JWKS across calls", async () => {
    let calls = 0;
    const counting: typeof fetch = async () => {
      calls++;
      return Response.json({ keys: [{ ...jwk, kid: "test-key" }] });
    };
    const token = await makeToken(claims());
    await verifyGitHubOidc({ token, audience: AUD, fetchImpl: counting });
    await verifyGitHubOidc({ token, audience: AUD, fetchImpl: counting });
    expect(calls).toBe(1);
  });
});
