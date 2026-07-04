import {
  decodeBase64Utf8,
  type FragmentAxis,
  type FragmentManifest,
  type GitHubClient,
  type TemplateSource,
} from "@repository-fanout/core";

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

  async listNames(axis: FragmentAxis): Promise<string[]> {
    const names = new Set<string>();
    const re = new RegExp(`^${axis}/([^/]+)/`);
    for (const p of await this.tree()) {
      const m = re.exec(p);
      if (m) names.add(m[1]!);
    }
    return [...names];
  }

  async nameExists(axis: FragmentAxis, name: string): Promise<boolean> {
    return (await this.tree()).some((p) => p.startsWith(`${axis}/${name}/`));
  }
}
