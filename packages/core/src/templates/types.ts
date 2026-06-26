/** profile ディレクトリの profile.json */
export interface ProfileManifest {
  /** renovate extends エントリ（相対 or 組み込み preset） */
  renovate?: string[];
  /** .gitignore に足す行 */
  gitignore?: string[];
}

/** テンプレ専用リポからの読み取りを抽象化（worker は GitHub 経由、test はメモリ） */
export interface TemplateSource {
  /** 例 "base/files/renovate.json" の生バイト列（無ければ null） */
  readFile(path: string): Promise<string | null>;
  /** 指定 prefix 配下のファイルパス一覧（例 "base/files/"） */
  listFiles(prefix: string): Promise<string[]>;
  /** profile.json を読む（base または profiles/<tag>）。存在しなければ null */
  readProfileManifest(profileDir: string): Promise<ProfileManifest | null>;
  /** profiles/<tag> ディレクトリが存在するか（未知 profile 検出用） */
  profileExists(tag: string): Promise<boolean>;
}

/** reconcile が出力する「望ましいファイル」 */
export interface DesiredFile {
  path: string;
  content: string;
  mode: "sync" | "create-only";
}
