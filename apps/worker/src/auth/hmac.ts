function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signHmac(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return toHex(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyArgs {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  now: number;
  windowSec: number;
}

export async function verifyHmac(
  a: VerifyArgs,
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  if (!Number.isFinite(a.timestamp)) return { ok: false, reason: "stale" };
  if (Math.abs(a.now - a.timestamp) > a.windowSec) return { ok: false, reason: "stale" };
  const expected = await signHmac(a.secret, a.timestamp, a.body);
  return timingSafeEqual(expected, a.signature)
    ? { ok: true }
    : { ok: false, reason: "bad-signature" };
}
