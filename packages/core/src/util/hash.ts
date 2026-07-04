/** 配布記録(dist record)のハッシュ照合ガード用。Workers / Node 20+ 両対応(crypto.subtle)。 */
export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
