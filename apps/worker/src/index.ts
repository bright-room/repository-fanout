import { type Manifest, parseManifest } from "@repository-fanout/core";
import { verifyHmac } from "./auth/hmac.js";
import { putManifestCas } from "./kv/manifestStore.js";

export interface Env {
  MANIFESTS: KVNamespace;
  RUNS: KVNamespace;
  PARENT: Workflow;
  CHILD: Workflow;
  APP_ID: string;
  APP_PRIVATE_KEY: string;
  TEMPLATES_REPO: string;
  // SYNC_HMAC_SECRET__<account> は動的に参照（下記 secretFor）
  [key: string]: unknown;
}

export { ChildWorkflow } from "./workflows/child.js";
export { ParentWorkflow } from "./workflows/parent.js";

function secretFor(env: Env, account: string): string | undefined {
  const v = env[`SYNC_HMAC_SECRET__${account}`];
  return typeof v === "string" ? v : undefined;
}

const HMAC_WINDOW_SEC = 300;

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["sync", "{account}"]

    if (req.method !== "POST" || parts[0] !== "sync")
      return new Response("not found", { status: 404 });

    const account = parts[1];
    const body = await req.text();
    const now = Math.floor(Date.now() / 1000);
    const runId = crypto.randomUUID();

    if (account) {
      // structure kick: 署名検証 + manifest 保存 + 当該アカウント reconcile
      const secret = secretFor(env, account);
      if (!secret) return new Response("unknown account", { status: 401 });

      const ts = Number(req.headers.get("X-Fanout-Timestamp"));
      const sig = req.headers.get("X-Fanout-Signature") ?? "";
      const v = await verifyHmac({
        secret,
        timestamp: ts,
        body,
        signature: sig,
        now,
        windowSec: HMAC_WINDOW_SEC,
      });
      if (!v.ok) return new Response(`unauthorized: ${v.reason ?? ""}`, { status: 401 });

      let manifest: Manifest;
      try {
        manifest = parseManifest(JSON.parse(body));
      } catch (e) {
        return new Response(`bad manifest: ${e}`, { status: 422 });
      }
      if (manifest.account !== account) return new Response("account mismatch", { status: 422 });

      const { stored } = await putManifestCas(env.MANIFESTS, manifest);
      if (!stored) return new Response("stale revision (ignored)", { status: 202 });

      await env.PARENT.create({ params: { runId, account } });
      return new Response(JSON.stringify({ accepted: true, runId }), { status: 202 });
    }

    // template kick: manifest なし。全アカウント reconcile。共通 secret で検証。
    // フェイルクローズ: 共通 secret 未設定なら誰でも全 fan-out を起動できてしまうため拒否する。
    const secret = secretFor(env, "_global");
    if (!secret) return new Response("global sync not configured", { status: 401 });

    const ts = Number(req.headers.get("X-Fanout-Timestamp"));
    const sig = req.headers.get("X-Fanout-Signature") ?? "";
    const v = await verifyHmac({
      secret,
      timestamp: ts,
      body,
      signature: sig,
      now,
      windowSec: HMAC_WINDOW_SEC,
    });
    if (!v.ok) return new Response(`unauthorized: ${v.reason ?? ""}`, { status: 401 });

    await env.PARENT.create({ params: { runId } });
    return new Response(JSON.stringify({ accepted: true, runId }), { status: 202 });
  },
};
