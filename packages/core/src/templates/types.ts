/** .gitignore の1セクション（コメント見出し + その配下の無視パターン） */
export interface GitignoreSection {
  /** セクション見出しラベル（例: "OS / editor"）。描画時に "# " が自動付与される。省略時は見出しなし */
  section_comment?: string;
  /** このセクションが足す無視パターン行 */
  ignores: string[];
}

/** base/ または languages/<lang>/ の fragment.json */
export interface FragmentManifest {
  /** renovate extends エントリ（renovate-config 参照 or 組み込み preset） */
  renovate?: string[];
  /** .gitignore の managed-block に足すセクション群 */
  gitignore?: GitignoreSection[];
}

/** テンプレ専用リポからの読み取りを抽象化（worker/cli は GitHub 経由、test はメモリ） */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
  /** `${dir}/fragment.json` を読む（"base" | "languages/<lang>"）。無ければ null */
  readFragmentManifest(dir: string): Promise<FragmentManifest | null>;
  /** languages/ 直下のディレクトリ名一覧（universe 計算用） */
  listLanguages(): Promise<string[]>;
  /** languages/<lang>/ が存在するか（未知 language 検出用） */
  languageExists(lang: string): Promise<boolean>;
}

/** resolve の出力。戦略ごとに必要な情報を持つ（actual とのマージは computeChanges が行う） */
export type DesiredEntry =
  | { strategy: "replace"; path: string; content: string }
  | { strategy: "create-only"; path: string; content: string }
  | { strategy: "managed-block"; path: string; blockContent: string }
  | {
      strategy: "extends-field";
      path: string;
      /** 宣言 languages から導出した管理 extends（正準順） */
      managedExtends: string[];
      /** base∪全 language の貢献（管理対象判定用） */
      universe: string[];
      /** ファイル不在時に新規作成する全文 */
      createContent: string;
    };
