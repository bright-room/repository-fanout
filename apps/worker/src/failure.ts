import type { Env } from "./index.js";
import { recordRepoResult } from "./kv/runStore.js";
import { notifyFailure } from "./notify.js";

/** リポ単位の失敗を RUNS KV に記録し、Discord に通知する（通知失敗は notify 側で握りつぶし） */
export async function reportRepoFailure(
  env: Env,
  runId: string,
  f: { account: string; repo: string; error: string },
): Promise<void> {
  await recordRepoResult(env.RUNS, runId, { ...f, status: "failed" });
  await notifyFailure(env.DISCORD_WEBHOOK_URL, { runId, ...f });
}
