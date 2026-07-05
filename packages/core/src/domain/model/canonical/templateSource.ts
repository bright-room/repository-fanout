/** 正本(canonical-files)の読み取りポート。実装: worker=GitHub API / cli=ローカル FS / test=メモリ */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
}
