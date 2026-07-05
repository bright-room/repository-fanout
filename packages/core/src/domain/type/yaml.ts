import { parse } from "yaml";

/**
 * YAML 文字列を plain 値へパースする(パース不能は例外)。
 * core は既に yaml に依存しているため、cli 等が YAML を扱う際はこれを再利用する
 * (アプリ側に yaml を直接依存させない)。
 */
export function parseYaml(content: string): unknown {
  return parse(content);
}
