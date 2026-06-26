/**
 * GitHub Contents API は base64(UTF-8 bytes) を改行入りで返す。
 * `atob` は Latin-1 文字列を返すため、そのまま使うとマルチバイト文字が壊れる。
 * 一旦バイト列に戻してから UTF-8 としてデコードする。
 */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
