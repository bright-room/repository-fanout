function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemBodyToDer(pem: string, label: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(new RegExp(`-----(BEGIN|END) ${label}-----`, "g"), "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * PKCS#1 (`RSA PRIVATE KEY`) DER を PKCS#8 (`PRIVATE KEY`) DER に変換する。
 * rsaEncryption AlgorithmIdentifier を付けた PrivateKeyInfo で包む（固定 26 byte ヘッダ）。
 * 長さは 2-byte long-form（0x82）でエンコードするため RSA-2048/4096 鍵に対応。
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const len = pkcs1.length;
  const inner = 22 + len; // version(3) + algId(15) + octetString header(4) + key
  const prefix = new Uint8Array([
    0x30,
    0x82,
    (inner >> 8) & 0xff,
    inner & 0xff, // SEQUENCE (PrivateKeyInfo)
    0x02,
    0x01,
    0x00, // INTEGER version = 0
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00, // AlgId rsaEncryption + NULL
    0x04,
    0x82,
    (len >> 8) & 0xff,
    len & 0xff, // OCTET STRING (privateKey)
  ]);
  const out = new Uint8Array(prefix.length + len);
  out.set(prefix, 0);
  out.set(pkcs1, prefix.length);
  return out;
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    // PKCS#1（GitHub App の従来形式）
    return pkcs1ToPkcs8(pemBodyToDer(pem, "RSA PRIVATE KEY"));
  }
  // PKCS#8
  return pemBodyToDer(pem, "PRIVATE KEY");
}

export interface CreateAppJwtArgs {
  appId: string;
  privateKeyPem: string;
  /** epoch 秒。省略時は現在時刻 */
  now?: number;
}

export async function createAppJwt(args: CreateAppJwtArgs): Promise<string> {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: args.appId, iat: now - 60, exp: now + 540 };
  const encoder = new TextEncoder();
  const signingInput =
    `${base64url(encoder.encode(JSON.stringify(header)))}.` +
    `${base64url(encoder.encode(JSON.stringify(payload)))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(args.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput)),
  );
  return `${signingInput}.${base64url(sig)}`;
}
