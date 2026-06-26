import { expect, test } from "vitest";
import { createAppJwt } from "../../src/auth/jwt.js";

async function genKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

function toPem(der: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
}

async function pkcs8Pem(kp: CryptoKeyPair): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return toPem(der, "PRIVATE KEY");
}

// PKCS#8 wraps PKCS#1 with a fixed 26-byte header for RSA-2048 keys.
// Strip it to obtain a PKCS#1 ("RSA PRIVATE KEY") PEM.
async function pkcs1Pem(kp: CryptoKeyPair): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return toPem(der.slice(26), "RSA PRIVATE KEY");
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function expectValidJwt(jwt: string, publicKey: CryptoKey, iss: string, now: number): Promise<void> {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
  const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  expect(payload.iss).toBe(iss);
  expect(payload.iat).toBe(now - 60);
  expect(payload.exp).toBe(now + 540);

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  expect(ok).toBe(true);
}

test("createAppJwt signs a verifiable RS256 JWT from a PKCS#8 key", async () => {
  const kp = await genKeyPair();
  const jwt = await createAppJwt({ appId: "12345", privateKeyPem: await pkcs8Pem(kp), now: 1_000_000 });
  await expectValidJwt(jwt, kp.publicKey, "12345", 1_000_000);
});

test("createAppJwt accepts a PKCS#1 (RSA PRIVATE KEY) key and signs verifiably", async () => {
  const kp = await genKeyPair();
  const jwt = await createAppJwt({ appId: "999", privateKeyPem: await pkcs1Pem(kp), now: 2_000_000 });
  await expectValidJwt(jwt, kp.publicKey, "999", 2_000_000);
});
