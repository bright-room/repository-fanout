import { beforeEach, describe, expect, it } from "vitest";
import { OidcError, resetJwksCache, verifyGitHubOidc } from "../../src/auth/oidc.js";

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o: unknown): string => b64url(enc.encode(JSON.stringify(o)));

const ISSUER = "https://token.actions.githubusercontent.com";
const AUD = "https://repository-fanout.bright-room.workers.dev";

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;

async function makeToken(payload: Record<string, unknown>, opts?: { kid?: string }): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: opts?.kid ?? "test-key" };
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, enc.encode(input)),
  );
  return `${input}.${b64url(sig)}`;
}

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUD,
    exp: Math.floor(Date.now() / 1000) + 300,
    repository: "bright-room/organization-structure",
    repository_owner: "bright-room",
    ref: "refs/heads/main",
    ...over,
  };
}

/** JWKS を返すスタブ fetch */
const jwksFetch: typeof fetch = async () =>
  Response.json({ keys: [{ ...jwk, kid: "test-key" }] });

beforeEach(async () => {
  resetJwksCache();
  keyPair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
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
    await expect(verifyGitHubOidc({ token: tampered, audience: AUD, fetchImpl: jwksFetch })).rejects.toMatchObject({ status: 401 });
  });
  it("rejects wrong audience (401)", async () => {
    const token = await makeToken(claims({ aud: "https://other" }));
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch })).rejects.toMatchObject({ status: 401 });
  });
  it("accepts audience inside an array aud", async () => {
    const token = await makeToken(claims({ aud: ["x", AUD] }));
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch })).resolves.toBeTruthy();
  });
  it("rejects an expired token (401)", async () => {
    const token = await makeToken(claims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch })).rejects.toMatchObject({ status: 401 });
  });
  it("rejects wrong issuer (401)", async () => {
    const token = await makeToken(claims({ iss: "https://evil.example" }));
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch })).rejects.toMatchObject({ status: 401 });
  });
  it("rejects unknown kid (401)", async () => {
    const token = await makeToken(claims(), { kid: "other-key" });
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: jwksFetch })).rejects.toMatchObject({ status: 401 });
  });
  it("maps JWKS fetch failure to 503 (フェイルクローズ+CI リトライ)", async () => {
    const failFetch: typeof fetch = async () => new Response("boom", { status: 500 });
    const token = await makeToken(claims());
    await expect(verifyGitHubOidc({ token, audience: AUD, fetchImpl: failFetch })).rejects.toMatchObject({ status: 503 });
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
