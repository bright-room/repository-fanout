import type { FailureInfo, KeptFilesInfo } from "@repository-fanout/core";

export type { FailureInfo, KeptFilesInfo };

/**
 * リポ単位の失敗を Discord Webhook にプレーンテキストで通知する（spec 2026-07-03 §4）。
 * webhookUrl 未設定はスキップ。送信失敗・非 2xx は握りつぶす（ログのみ）—
 * 通知が reconcile を壊してはならない。
 */
export async function notifyFailure(
  webhookUrl: string | undefined,
  info: FailureInfo,
): Promise<void> {
  if (!webhookUrl) return;
  const content =
    `❌ fanout failed: ${info.repo} (account: ${info.account}) — ${info.error} (run: ${info.runId})`.slice(
      0,
      1900,
    );
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`discord notify failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`discord notify failed: ${String(err)}`);
  }
}

/**
 * 残置ファイル(残しすぎ防止のため消さずに管理を引き渡したファイル)を
 * Discord Webhook に通知する（spec §5.7）。notifyFailure と同じ規律
 * (webhookUrl 未設定はスキップ・送信失敗や非 2xx は握りつぶす・5秒timeout・1900字truncate)。
 */
export async function notifyKeptFiles(
  webhookUrl: string | undefined,
  info: KeptFilesInfo,
): Promise<void> {
  if (!webhookUrl) return;
  const list = info.kept.map((k) => `${k.path} (${k.reason})`).join(", ");
  const content =
    `⚠️ fanout kept files: ${info.repo} (account: ${info.account}) — ${list} (run: ${info.runId})`.slice(
      0,
      1900,
    );
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`discord notify failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`discord notify failed: ${String(err)}`);
  }
}
