/**
 * ユースケース進行のステップ実行ポート（現 child.ts の StepLike を正式化）。
 * do() の戻り値は境界（Cloudflare Workflows の永続化・再開）を越えるため
 * plain データ（JSON 化可能な値）に限る。ドメインオブジェクトを返さない。
 * 実装: worker=Workflows step 委譲 / cli=即時実行。
 */
export interface StepRunner {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}
