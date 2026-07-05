export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * JSON 値の構造比較(オブジェクトのキー順に依存しない)。
 * 構造マージの no-op 判定(spec v3 C7: 意味的無変更ならファイルに触らない)用。
 * JSON.stringify 比較だとキー順差で false negative になり、無意味な再描画 PR を生むため。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}
