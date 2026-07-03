import type { FragmentManifest, GitHubClient, TemplateSource } from "@repository-fanout/core";
import { decodeBase64Utf8 } from "./base64.js";

export interface TemplateSourceOpts {
  client: GitHubClient;
  repo: string; // "owner/repo"
  ref?: string; // 既定 HEAD
}

export class GitHubTemplateSource implements TemplateSource {
  private treeCache?: Promise<string[]>;
  constructor(private readonly opts: TemplateSourceOpts) {}

  private async tree(): Promise<string[]> {
    if (!this.treeCache) {
      const ref = this.opts.ref ?? "HEAD";
      this.treeCache = this.opts.client
        .request<{ tree: Array<{ path: string; type: string }> }>(
          "GET",
          `/repos/${this.opts.repo}/git/trees/${ref}?recursive=1`,
        )
        .then((r) => r.tree.filter((t) => t.type === "blob").map((t) => t.path));
    }
    return this.treeCache;
  }

  async listFiles(prefix: string): Promise<string[]> {
    return (await this.tree()).filter((p) => p.startsWith(prefix));
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const r = await this.opts.client.request<{ content: string; encoding: string }>(
        "GET",
        `/repos/${this.opts.repo}/contents/${encodeURI(path)}`,
      );
      return decodeBase64Utf8(r.content);
    } catch {
      return null;
    }
  }

  async readFragmentManifest(dir: string): Promise<FragmentManifest | null> {
    const raw = await this.readFile(`${dir}/fragment.json`);
    return raw ? (JSON.parse(raw) as FragmentManifest) : null;
  }

  async listLanguages(): Promise<string[]> {
    const langs = new Set<string>();
    for (const p of await this.tree()) {
      const m = /^languages\/([^/]+)\//.exec(p);
      if (m) langs.add(m[1]!);
    }
    return [...langs];
  }

  async languageExists(lang: string): Promise<boolean> {
    return (await this.tree()).some((p) => p.startsWith(`languages/${lang}/`));
  }
}
