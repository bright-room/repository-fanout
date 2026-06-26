import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";
import worker from "../src/index.js";
import { signHmac } from "../src/auth/hmac.js";
import { getManifest } from "../src/kv/manifestStore.js";

const manifest = {
  account: "bright-room", revision: 1, sourceCommit: "c",
  repositories: { r1: { profiles: [], vars: {}, exclude: [] } },
};

// vitest-pool-workers can't bind Workflows, so stub PARENT/CHILD on the env.
const created: Array<{ params?: unknown }> = [];
const workflowStub = { create: async (opts?: { params?: unknown }) => { created.push(opts ?? {}); return {}; } };
const testEnv = () => ({ ...env, PARENT: workflowStub, CHILD: workflowStub });

async function post(account: string, body: object, secret: string) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signHmac(secret, ts, raw);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://x/sync/${account}`, {
    method: "POST", body: raw,
    headers: { "X-Fanout-Timestamp": String(ts), "X-Fanout-Signature": sig, "Content-Type": "application/json" },
  }), testEnv() as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** POST /sync (no account = global/template kick). `signWith` undefined => omit signature headers. */
async function postGlobal(signWith: string | undefined, envObj: Record<string, unknown>) {
  const raw = JSON.stringify({});
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signWith !== undefined) {
    headers["X-Fanout-Timestamp"] = String(ts);
    headers["X-Fanout-Signature"] = await signHmac(signWith, ts, raw);
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://x/sync", { method: "POST", body: raw, headers }),
    envObj as never,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

test("valid signed sync stores manifest and accepts", async () => {
  created.length = 0;
  const res = await post("bright-room", manifest, env["SYNC_HMAC_SECRET__bright-room"] as string);
  expect(res.status).toBe(202);
  expect((await getManifest(env.MANIFESTS, "bright-room"))?.revision).toBe(1);
  expect(created).toHaveLength(1);
});

test("bad signature is rejected 401", async () => {
  const res = await post("bright-room", manifest, "wrongsecret");
  expect(res.status).toBe(401);
});

test("account without secret rejected 401", async () => {
  const res = await post("unknown-acct", manifest, "x");
  expect(res.status).toBe(401);
});

test("global sync with valid signature accepts 202", async () => {
  created.length = 0;
  const res = await postGlobal("globalsecret", testEnv());
  expect(res.status).toBe(202);
  expect(created).toHaveLength(1);
});

test("global sync without signature rejected 401", async () => {
  created.length = 0;
  const res = await postGlobal(undefined, testEnv());
  expect(res.status).toBe(401);
  expect(created).toHaveLength(0);
});

test("global sync with bad signature rejected 401", async () => {
  const res = await postGlobal("wrongsecret", testEnv());
  expect(res.status).toBe(401);
});

test("global sync fails closed when global secret not configured", async () => {
  created.length = 0;
  const noGlobal: Record<string, unknown> = { ...testEnv() };
  delete noGlobal["SYNC_HMAC_SECRET___global"];
  // even a 'valid' signature against some secret must be rejected when unconfigured
  const res = await postGlobal("globalsecret", noGlobal);
  expect(res.status).toBe(401);
  expect(created).toHaveLength(0);
});
