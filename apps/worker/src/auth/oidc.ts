/**
 * GitHub Actions OIDC トークンの検証(spec v2 §6.2)。
 * 事前のシークレット共有なしで「どのリポの・どの持ち主のワークフローが送ったか」を
 * GitHub の公開鍵(JWKS)で確認する。失敗は 401(トークン不正)/ 503(JWKS 取得不能)。
 */
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 10 * 60 * 1000;

export class OidcError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

export interface OidcClaims {
  repository: string;
  repository_owner: string;
  ref: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

/** テスト用: モジュールレベルの JWKS キャッシュを破棄する */
export function resetJwksCache(): void {
  jwksCache = null;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

async function fetchJwks(fetchImpl: typeof fetch, nowMs: number): Promise<Jwk[]> {
  if (jwksCache && nowMs - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  let res: Response;
  try {
    res = await fetchImpl(JWKS_URL);
  } catch (e) {
    throw new OidcError(`jwks fetch failed: ${String(e)}`, 503);
  }
  if (!res.ok) throw new OidcError(`jwks fetch failed: HTTP ${res.status}`, 503);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new OidcError("jwks malformed", 503);
  jwksCache = { keys: body.keys, fetchedAt: nowMs };
  return body.keys;
}

export interface VerifyOidcArgs {
  token: string;
  /** 期待する aud(= fanout の URL。env.OIDC_AUDIENCE) */
  audience: string;
  /** epoch ms。省略時は現在時刻 */
  nowMs?: number;
  fetchImpl?: typeof fetch;
}

export async function verifyGitHubOidc(args: VerifyOidcArgs): Promise<OidcClaims> {
  const nowMs = args.nowMs ?? Date.now();
  const fetchImpl = args.fetchImpl ?? fetch.bind(globalThis);

  const parts = args.token.split(".");
  const [headerB64, payloadB64, sigB64] = parts;
  if (
    parts.length !== 3 ||
    headerB64 === undefined ||
    payloadB64 === undefined ||
    sigB64 === undefined
  )
    throw new OidcError("malformed token", 401);
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodePart(headerB64);
    payload = decodePart(payloadB64);
  } catch {
    throw new OidcError("malformed token", 401);
  }
  if (header.alg !== "RS256") throw new OidcError("unsupported alg", 401);

  const keys = await fetchJwks(fetchImpl, nowMs);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new OidcError("unknown kid", 401);

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) throw new OidcError("bad signature", 401);

  if (payload.iss !== ISSUER) throw new OidcError("bad issuer", 401);
  const aud = payload.aud;
  const audOk =
    typeof aud === "string"
      ? aud === args.audience
      : Array.isArray(aud) && aud.includes(args.audience);
  if (!audOk) throw new OidcError("bad audience", 401);
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs)
    throw new OidcError("expired", 401);
  if (
    typeof payload.repository !== "string" ||
    typeof payload.repository_owner !== "string" ||
    typeof payload.ref !== "string"
  )
    throw new OidcError("missing claims", 401);

  return {
    repository: payload.repository,
    repository_owner: payload.repository_owner,
    ref: payload.ref,
  };
}
