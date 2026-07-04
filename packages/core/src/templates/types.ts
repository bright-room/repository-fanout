/** .gitignore の1セクション（コメント見出し + その配下の無視パターン） */
export interface GitignoreSection {
  /** セクション見出しラベル（例: "OS / editor"）。描画時に "# " が自動付与される。省略時は見出しなし */
  section_comment?: string;
  /** このセクションが足す無視パターン行 */
  ignores: string[];
}

/** base/ または languages/<lang>/ または bundles/<name>/ の fragment.json */
export interface FragmentManifest {
  /** renovate extends エントリ（renovate-config 参照 or 組み込み preset） */
  renovate?: string[];
  /** .gitignore の managed-block に足すセクション群 */
  gitignore?: GitignoreSection[];
}

/** fragment を提供する宣言軸のディレクトリ名 */
export type FragmentAxis = "languages" | "bundles";

export type { TemplateSource } from "../domain/model/canonical/templateSource.js";
export type { DesiredEntry } from "../domain/model/desired/desiredFileData.js";
