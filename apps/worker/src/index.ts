import {
  createAppJwt,
  listInstallations,
  type Manifest,
  parseManifest,
} from "@repository-fanout/core";
import { OidcError, verifyGitHubOidc } from "./auth/oidc.js";
import { getManifest, putManifestCas } from "./kv/manifestStore.js";

export interface Env {
  MANIFESTS: KVNamespace;
  RUNS: KVNamespace;
  PARENT: Workflow;
  CHILD: Workflow;
  APP_ID: string;
  APP_PRIVATE_KEY: string;
  TEMPLATES_REPO: string;
  /** OIDC トークンの aud 検証値(= fanout の URL。spec v2 §6.2) */
  OIDC_AUDIENCE: string;
  /** Discord Webhook(任意)。未設定なら失敗通知をスキップ */
  DISCORD_WEBHOOK_URL?: string;
}

export { ChildWorkflow } from "./workflows/child.js";
export { ParentWorkflow } from "./workflows/parent.js";

/** POST /sync(/{account}) の body(spec v2 §6.4) */
interface SyncBody {
  manifest?: unknown;
  repos?: unknown;
}

function parseRepos(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.length > 0))
    throw new Error("repos must be an array of repo names");
  return v as string[];
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["sync", "{account}"]

    if (req.method !== "POST" || parts[0] !== "sync" || parts.length > 2)
      return new Response("not found", { status: 404 });

    // --- 認証: GitHub Actions OIDC(spec v2 §6.2。シークレット不要) ---------
    const auth = req.headers.get("Authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!bearer) return new Response("missing bearer token", { status: 401 });

    let claims: Awaited<ReturnType<typeof verifyGitHubOidc>>;
    try {
      claims = await verifyGitHubOidc({ token: bearer, audience: env.OIDC_AUDIENCE });
    } catch (e) {
      const status = e instanceof OidcError ? e.status : 401;
      return new Response(`unauthorized: ${e instanceof Error ? e.message : String(e)}`, {
        status,
      });
    }

    const account = parts[1];
    const runId = crypto.randomUUID();

    // --- global kick: 正本リポ(TEMPLATES_REPO)からのみ ---------------------
    if (!account) {
      if (claims.repository !== env.TEMPLATES_REPO)
        return new Response("forbidden: not the templates repo", { status: 403 });
      try {
        await env.PARENT.create({ params: { runId } });
      } catch (e) {
        // 起動失敗は 5xx で返し、CI 側リトライに再送させる(spec v2 §6.1)
        return new Response(`workflow create failed: ${String(e)}`, { status: 500 });
      }
      return new Response(JSON.stringify({ accepted: true, runId }), { status: 202 });
    }

    // --- account kick: 認可 = トークンの持ち主一致 + App インストール ------
    if (claims.repository_owner.toLowerCase() !== account.toLowerCase())
      return new Response("forbidden: token owner mismatch", { status: 403 });

    let installed: boolean;
    try {
      const jwt = await createAppJwt({ appId: env.APP_ID, privateKeyPem: env.APP_PRIVATE_KEY });
      const installations = await listInstallations({ appJwt: jwt });
      installed = installations.some((i) => i.account.toLowerCase() === account.toLowerCase());
    } catch (e) {
      return new Response(`installation check failed: ${String(e)}`, { status: 503 });
    }
    if (!installed)
      return new Response("forbidden: app not installed for account", { status: 403 });

    let body: SyncBody;
    try {
      body = JSON.parse(await req.text()) as SyncBody;
    } catch {
      return new Response("bad json", { status: 422 });
    }
    let repos: string[] | undefined;
    try {
      repos = parseRepos(body.repos);
    } catch (e) {
      return new Response(`bad repos: ${e instanceof Error ? e.message : String(e)}`, {
        status: 422,
      });
    }

    if (body.manifest !== undefined) {
      let manifest: Manifest;
      try {
        manifest = parseManifest(body.manifest);
      } catch (e) {
        return new Response(`bad manifest: ${String(e)}`, { status: 422 });
      }
      if (manifest.account !== account) return new Response("account mismatch", { status: 422 });
      const put = await putManifestCas(env.MANIFESTS, manifest);
      // 厳密に古い revision のみ拒否。同一 revision は再実行要求として受理(spec v2 §6.1)
      if (put.stale) return new Response("stale revision", { status: 409 });
    } else if ((await getManifest(env.MANIFESTS, account)) === null) {
      return new Response("no stored manifest for account", { status: 404 });
    }

    try {
      await env.PARENT.create({ params: { runId, account, repos } });
    } catch (e) {
      return new Response(`workflow create failed: ${String(e)}`, { status: 500 });
    }
    return new Response(JSON.stringify({ accepted: true, runId }), { status: 202 });
  },
};
