export interface FailureInfo {
  runId: string;
  account: string;
  repo: string;
  error: string;
}

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
  const content = `❌ fanout failed: ${info.repo} (account: ${info.account}) — ${info.error} (run: ${info.runId})`;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) console.error(`discord notify failed: HTTP ${res.status}`);
  } catch (err) {
    console.error(`discord notify failed: ${String(err)}`);
  }
}
