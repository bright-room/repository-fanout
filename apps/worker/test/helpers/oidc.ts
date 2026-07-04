/**
 * GitHub Actions OIDC トークンをテストで自作するための共通ヘルパ。
 * apps/worker/test/auth/oidc.test.ts と apps/worker/test/sync.test.ts の双方から使う。
 */
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64urlJson = (o: unknown): string => b64url(enc.encode(JSON.stringify(o)));

export const ISSUER = "https://token.actions.githubusercontent.com";
export const AUD = "https://repository-fanout.bright-room.workers.dev";

export let keyPair: CryptoKeyPair;
export let jwk: JsonWebKey;

/** 新しい RSA 鍵ペアを生成し、モジュールの keyPair/jwk を更新する(各テストの beforeEach で呼ぶ)。 */
export async function regenerateOidcKeyPair(): Promise<void> {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
}

export async function makeToken(
  payload: Record<string, unknown>,
  opts?: { kid?: string },
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: opts?.kid ?? "test-key" };
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, enc.encode(input)),
  );
  return `${input}.${b64url(sig)}`;
}

export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
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
export const jwksFetch: typeof fetch = async () =>
  Response.json({ keys: [{ ...jwk, kid: "test-key" }] });
