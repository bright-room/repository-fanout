export interface FailureInfo {
  runId: string;
  account: string;
  repo: string;
  error: string;
}

export interface KeptFilesInfo {
  runId: string;
  account: string;
  repo: string;
  kept: Array<{ path: string; reason: string }>;
}

/** 失敗・残置ファイルの通知ポート（実装は infrastructure-discord）。送信失敗は実装側で握りつぶす。 */
export interface Notification {
  notifyFailure(info: FailureInfo): Promise<void>;
  notifyKeptFiles(info: KeptFilesInfo): Promise<void>;
}
