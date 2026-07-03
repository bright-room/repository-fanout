import type { FragmentManifest, GitHubClient, TemplateSource } from "@repository-fanout/core";

/**
 * GitHub Contents API は base64(UTF-8 bytes) を改行入りで返す。
 * `atob` は Latin-1 文字列を返すため、そのまま使うとマルチバイト文字が壊れる。
 * 一旦バイト列に戻してから UTF-8 としてデコードする。
 * (apps/worker/src/github/base64.ts と同型。MVP につき複製。)
 */
function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function templateSource(client: GitHubClient, repo: string): TemplateSource {
  let treeCache: Promise<string[]> | undefined;
  const tree = () =>
    (treeCache ??= client
      .request<{ tree: Array<{ path: string; type: string }> }>(
        "GET",
        `/repos/${repo}/git/trees/HEAD?recursive=1`,
      )
      .then((r) => r.tree.filter((t) => t.type === "blob").map((t) => t.path)));
  const read = async (path: string): Promise<string | null> => {
    try {
      const r = await client.request<{ content: string }>(
        "GET",
        `/repos/${repo}/contents/${encodeURI(path)}`,
      );
      return decodeBase64Utf8(r.content);
    } catch {
      // 取得失敗（404 等）はすべて「未配置」とみなす。
      return null;
    }
  };
  return {
    async readFile(p) {
      return read(p);
    },
    async listFiles(prefix) {
      return (await tree()).filter((p) => p.startsWith(prefix));
    },
    async readFragmentManifest(dir) {
      const raw = await read(`${dir}/fragment.json`);
      return raw ? (JSON.parse(raw) as FragmentManifest) : null;
    },
    async listNames(axis) {
      const names = new Set<string>();
      const re = new RegExp(`^${axis}/([^/]+)/`);
      for (const p of await tree()) {
        const m = re.exec(p);
        if (m) names.add(m[1]!);
      }
      return [...names];
    },
    async nameExists(axis, name) {
      return (await tree()).some((p) => p.startsWith(`${axis}/${name}/`));
    },
  };
}

export function actualReader(client: GitHubClient, repo: string, ref = "HEAD") {
  return async (paths: string[]): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const path of paths) {
      try {
        const r = await client.request<{ content: string }>(
          "GET",
          `/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
        );
        out[path] = decodeBase64Utf8(r.content);
      } catch {
        // 取得失敗（404 等）はすべて「未配置」とみなし、結果に含めない。
      }
    }
    return out;
  };
}
