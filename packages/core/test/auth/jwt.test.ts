import { expect, test } from "vitest";
import { createAppJwt } from "../../src/auth/jwt.js";

// テスト用 RSA 鍵を生成して PKCS#8 PEM 化
async function generatePem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

test("createAppJwt produces a 3-part JWT with RS256 header and app id issuer", async () => {
  const pem = await generatePem();
  const jwt = await createAppJwt({ appId: "12345", privateKeyPem: pem, now: 1_000_000 });

  const [h, p] = jwt.split(".");
  expect(jwt.split(".")).toHaveLength(3);

  const header = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
  const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  expect(payload.iss).toBe("12345");
  expect(payload.iat).toBe(1_000_000 - 60); // クロックスキュー対策で60秒前倒し
  expect(payload.exp).toBe(1_000_000 + 540); // 9分後
});
