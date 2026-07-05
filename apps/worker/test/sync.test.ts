import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { resetJwksCache } from "../src/auth/oidc.js";
import worker from "../src/index.js";
import { getManifest, putManifestCas } from "../src/kv/manifestStore.js";
import { AUD, claims, jwksFetch, makeToken, regenerateOidcKeyPair } from "./helpers/oidc.js";

function manifest(over: Record<string, unknown> = {}) {
  return {
    account: "bright-room",
    revision: 1,
    sourceCommit: "c",
    repositories: { r1: { languages: [], bundles: [], contents: {}, exclude: [] } },
    ...over,
  };
}

/** GitHub App の秘密鍵 PEM を Uint8Array (PKCS#8 DER) から組み立てる(jwt.test.ts と同じ流儀)。 */
function pemFromDer(der: Uint8Array, label: string): string {
  const b64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN ${label}-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${label}-----\n`;
}

const INSTALLED = [{ id: 1, account: { login: "bright-room", type: "Organization" } }];

let appPrivateKeyPem: string;
let ctx: ExecutionContext;

beforeAll(async () => {
  // createAppJwt が RS256 で署名できるよう、本物の RSA 鍵ペアを一度だけ用意する
  // (installation 照合の対象は GitHub API モックが返す固定値なので、鍵の正当性自体はテストしない)。
  const kp = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  appPrivateKeyPem = pemFromDer(der, "PRIVATE KEY");
});

/**
 * index.ts は fetchImpl を注入できないため、JWKS 取得と GitHub App の installation 列挙は
 * globalThis.fetch 自体を差し替えてインターセプトする(apps/worker/test/notify.test.ts /
 * failure.test.ts と同じ既存の流儀)。
 */
function stubOutboundFetch(installations: unknown[]): void {
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://token.actions.githubusercontent.com/.well-known/jwks"))
      return jwksFetch(url as never);
    if (url.startsWith("https://api.github.com/app/installations"))
      return Response.json(installations);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch);
}

beforeEach(async () => {
  resetJwksCache();
  await regenerateOidcKeyPair();
  ctx = createExecutionContext();
  stubOutboundFetch(INSTALLED);
  // vitest-pool-workers はテスト間で KV ストレージを自動リセットしないため
  // (worker.fetch を直接呼ぶ限り同一インスタンスを共有する)、各テストを
  // manifest 未保存の状態から開始できるよう明示的にクリアする。
  await env.MANIFESTS.delete("manifest:bright-room");
});

afterEach(async () => {
  await waitOnExecutionContext(ctx);
  vi.unstubAllGlobals();
});

/** テスト共通の env。APP_ID/APP_PRIVATE_KEY/TEMPLATES_REPO/OIDC_AUDIENCE を実値で満たす。 */
function baseEnv(over: Record<string, unknown> = {}) {
  return {
    ...env,
    OIDC_AUDIENCE: AUD,
    APP_ID: "123",
    APP_PRIVATE_KEY: appPrivateKeyPem,
    TEMPLATES_REPO: "bright-room/canonical-files",
    ...over,
  };
}

// --- 1. Bearer 無し → 401 --------------------------------------------------
it("missing bearer token → 401", async () => {
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", { method: "POST", body: "{}" }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(401);
});

// --- 2. 署名不正トークン → 401 --------------------------------------------
it("invalid token signature → 401", async () => {
  const token = await makeToken(claims());
  const tampered = `${token.slice(0, -4)}AAAA`;
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${tampered}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(401);
});

// --- 3. aud 不一致 → 401 ----------------------------------------------------
it("audience mismatch → 401", async () => {
  const token = await makeToken(claims({ aud: "https://someone-else.example" }));
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(401);
});

// --- 4. global: TEMPLATES_REPO 以外の repository claim → 403 ---------------
it("global kick from a non-templates repo → 403", async () => {
  const token = await makeToken(claims({ repository: "someone/else" }));
  const res = await worker.fetch(
    new Request("https://fanout.test/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(403);
});

// --- 5. global: TEMPLATES_REPO 一致 → 202・account なしの params -----------
it("global kick from TEMPLATES_REPO → 202 with account-less params", async () => {
  const created: Array<{ params: Record<string, unknown> }> = [];
  const testEnv = {
    ...env,
    OIDC_AUDIENCE: AUD,
    TEMPLATES_REPO: "bright-room/canonical-files",
    PARENT: { create: async (a: never) => void created.push(a) },
  };
  const res = await worker.fetch(
    new Request("https://fanout.test/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await makeToken(claims({ repository: "bright-room/canonical-files" }))}`,
      },
      body: "{}",
    }),
    testEnv as never,
    ctx,
  );
  expect(res.status).toBe(202);
  expect(created).toHaveLength(1);
  expect(created[0]?.params).not.toHaveProperty("account");
});

// --- 6. account: repository_owner 不一致 → 403 ------------------------------
it("account kick: token owner mismatch → 403", async () => {
  const token = await makeToken(claims({ repository_owner: "someone-else" }));
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(403);
});

// --- 7. account: installation 無し → 403 ------------------------------------
it("account kick: app not installed for account → 403", async () => {
  stubOutboundFetch([]); // GitHub API が空配列を返す = installation 無し
  const token = await makeToken(claims());
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(403);
});

// --- 8. account: manifest 付き・新 revision → 202・KV 保存・PARENT.create ---
it("account kick: manifest with newer revision → 202, stored, PARENT.create({runId, account})", async () => {
  const created: Array<{ params: Record<string, unknown> }> = [];
  const testEnv = baseEnv({ PARENT: { create: async (a: never) => void created.push(a) } });
  const token = await makeToken(claims());
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ manifest: manifest({ revision: 3 }) }),
    }),
    testEnv as never,
    ctx,
  );
  expect(res.status).toBe(202);
  expect((await getManifest(env.MANIFESTS, "bright-room"))?.revision).toBe(3);
  expect(created).toHaveLength(1);
  expect(created[0]?.params).toMatchObject({ account: "bright-room" });
  expect(created[0]?.params).toHaveProperty("runId");
});

// --- 9. account: 同一 revision 再送 → 202・PARENT.create は必ず呼ばれる -----
// 永久停止穴の回帰テスト(spec v2 §6.1): 保存不要でも起動は許可しなければならない。
it("same revision re-send still kicks reconcile (202 + PARENT.create)", async () => {
  const created: unknown[] = [];
  const testEnv = baseEnv({ PARENT: { create: async (a: unknown) => void created.push(a) } });
  const m = manifest({ account: "bright-room", revision: 7 });
  const post = async () =>
    worker.fetch(
      new Request("https://fanout.test/sync/bright-room", {
        method: "POST",
        headers: { Authorization: `Bearer ${await makeToken(claims())}` },
        body: JSON.stringify({ manifest: m }),
      }),
      testEnv as never,
      ctx,
    );
  expect((await post()).status).toBe(202); // 初回: 保存+起動
  expect((await post()).status).toBe(202); // 同一 revision 再送: 保存なしでも必ず起動
  expect(created).toHaveLength(2);
});

// --- 10. account: 古い revision → 409・PARENT.create は呼ばれない -----------
it("account kick: older revision → 409, PARENT.create not called", async () => {
  const created: unknown[] = [];
  const testEnv = baseEnv({ PARENT: { create: async (a: unknown) => void created.push(a) } });
  const seed = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: JSON.stringify({ manifest: manifest({ revision: 5 }) }),
    }),
    testEnv as never,
    ctx,
  );
  expect(seed.status).toBe(202);
  created.length = 0;

  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: JSON.stringify({ manifest: manifest({ revision: 4 }) }),
    }),
    testEnv as never,
    ctx,
  );
  expect(res.status).toBe(409);
  expect(created).toHaveLength(0);
});

// --- 11. account: manifest 無し・KV に保存済み・repos フィルタ → 202 --------
it("account kick: no manifest body, stored manifest exists, repos filter → 202, PARENT.create({repos})", async () => {
  const created: Array<{ params: Record<string, unknown> }> = [];
  const testEnv = baseEnv({ PARENT: { create: async (a: never) => void created.push(a) } });
  await putManifestCas(env.MANIFESTS, manifest({ revision: 2 }));

  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: JSON.stringify({ repos: ["r1"] }),
    }),
    testEnv as never,
    ctx,
  );
  expect(res.status).toBe(202);
  expect(created).toHaveLength(1);
  expect(created[0]?.params).toMatchObject({ account: "bright-room", repos: ["r1"] });
});

// --- 12. account: manifest 無し・KV にも無し → 404 --------------------------
it("account kick: no manifest body and none stored → 404", async () => {
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: "{}",
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(404);
});

// --- 13. account: manifest.account と path account の不一致 → 422 ----------
it("account kick: manifest.account mismatches path account → 422", async () => {
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: JSON.stringify({ manifest: manifest({ account: "other-account" }) }),
    }),
    baseEnv() as never,
    ctx,
  );
  expect(res.status).toBe(422);
});

// --- 14. PARENT.create が throw → 500(CI リトライで再送される) -------------
it("PARENT.create throwing → 500 (CI retry will re-send)", async () => {
  const testEnv = baseEnv({
    PARENT: {
      create: async () => {
        throw new Error("workflow engine unavailable");
      },
    },
  });
  const res = await worker.fetch(
    new Request("https://fanout.test/sync/bright-room", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeToken(claims())}` },
      body: JSON.stringify({ manifest: manifest({ revision: 9 }) }),
    }),
    testEnv as never,
    ctx,
  );
  expect(res.status).toBe(500);
});
