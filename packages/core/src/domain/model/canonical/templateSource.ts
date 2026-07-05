import type { FragmentAxis, FragmentManifest } from "../../../templates/types.js";

/** 正本(canonical-files)の読み取りポート。実装: worker=GitHub API / cli=ローカル FS / test=メモリ */
export interface TemplateSource {
  readFile(path: string): Promise<string | null>;
  listFiles(prefix: string): Promise<string[]>;
  /** 以下 3 つは v2 経路専用(P-e で削除) */
  readFragmentManifest(dir: string): Promise<FragmentManifest | null>;
  listNames(axis: FragmentAxis): Promise<string[]>;
  nameExists(axis: FragmentAxis, name: string): Promise<boolean>;
}
