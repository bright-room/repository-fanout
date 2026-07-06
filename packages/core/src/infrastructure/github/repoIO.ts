import type { PrInfo } from "../../application/service/target/targetRepository.js";
import type { FileChange } from "../../domain/model/reconcile/fileChange.js";
import { decodeBase64Utf8 } from "../../domain/type/base64.js";
import type { GitHubClient } from "./client.js";
import { GitHubError } from "./errors.js";

export interface RepoIOOpts {
  client: GitHubClient;
  repo: string;
}

export class RepoIO {
  constructor(private readonly o: RepoIOOpts) {}
  private p(path: string) {
    return `/repos/${this.o.repo}${path}`;
  }

  async getDefaultBranch(): Promise<{ branch: string; sha: string }> {
    const repo = await this.o.client.request<{ default_branch: string }>("GET", this.p(""));
    const ref = await this.o.client.request<{ object: { sha: string } }>(
      "GET",
      this.p(`/git/ref/heads/${repo.default_branch}`),
    );
    return { branch: repo.default_branch, sha: ref.object.sha };
  }

  /** 指定パス群の実内容を取得（存在しないパスは結果に含めない） */
  async readActualFiles(paths: string[], ref: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const path of paths) {
      try {
        const r = await this.o.client.request<{ content: string; encoding: string }>(
          "GET",
          this.p(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`),
        );
        out[path] = decodeBase64Utf8(r.content);
      } catch (err) {
        // 404 のみ「未配置」とみなす。5xx やネットワーク断まで未配置扱いすると
        // 削除候補の実体確認が誤り、配布記録が静かに掃除されてしまう。
        if (err instanceof GitHubError && err.status === 404) continue;
        throw err;
      }
    }
    return out;
  }

  /** 固定ブランチに対応する PR を探す（state=all で最新1件） */
  async findPr(branch: string): Promise<PrInfo | null> {
    const owner = this.o.repo.split("/")[0];
    const prs = await this.o.client.request<
      Array<{ number: number; state: string; merged_at: string | null }>
    >("GET", this.p(`/pulls?head=${owner}:${branch}&state=all&per_page=1`));
    const pr = prs[0];
    return pr
      ? { number: pr.number, state: pr.state as "open" | "closed", merged: pr.merged_at !== null }
      : null;
  }

  async branchExists(branch: string): Promise<boolean> {
    try {
      await this.o.client.request("GET", this.p(`/git/ref/heads/${branch}`));
      return true;
    } catch {
      return false;
    }
  }

  /** changes をまとめて1コミットにし、branch を baseSha から作成/更新 */
  async commitChanges(args: {
    branch: string;
    baseSha: string;
    baseTreeSha: string;
    message: string;
    changes: FileChange[];
    deletions?: string[];
    create: boolean;
  }): Promise<void> {
    const blobs = await Promise.all(
      args.changes.map(async (c) => ({
        path: c.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: (
          await this.o.client.request<{ sha: string }>("POST", this.p("/git/blobs"), {
            content: c.content,
            encoding: "utf-8",
          })
        ).sha,
      })),
    );
    const removals = (args.deletions ?? []).map((path) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null, // Git Data API: sha=null でそのパスを tree から削除
    }));
    const tree = await this.o.client.request<{ sha: string }>("POST", this.p("/git/trees"), {
      base_tree: args.baseTreeSha,
      tree: [...blobs, ...removals],
    });
    const commit = await this.o.client.request<{ sha: string }>("POST", this.p("/git/commits"), {
      message: args.message,
      tree: tree.sha,
      parents: [args.baseSha],
    });
    if (args.create) {
      await this.o.client.request("POST", this.p("/git/refs"), {
        ref: `refs/heads/${args.branch}`,
        sha: commit.sha,
      });
    } else {
      await this.o.client.request("PATCH", this.p(`/git/refs/heads/${args.branch}`), {
        sha: commit.sha,
        force: true,
      });
    }
  }

  async getTreeSha(commitSha: string): Promise<string> {
    const c = await this.o.client.request<{ tree: { sha: string } }>(
      "GET",
      this.p(`/git/commits/${commitSha}`),
    );
    return c.tree.sha;
  }

  async createPr(args: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }): Promise<number> {
    const pr = await this.o.client.request<{ number: number }>("POST", this.p("/pulls"), {
      head: args.branch,
      base: args.base,
      title: args.title,
      body: args.body,
    });
    return pr.number;
  }

  async reopenPr(number: number): Promise<void> {
    await this.o.client.request("PATCH", this.p(`/pulls/${number}`), { state: "open" });
  }

  async updatePrBody(number: number, body: string): Promise<void> {
    await this.o.client.request("PATCH", this.p(`/pulls/${number}`), { body });
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    if (labels.length)
      await this.o.client.request("POST", this.p(`/issues/${number}/labels`), { labels });
  }

  async deleteBranch(branch: string): Promise<void> {
    try {
      await this.o.client.request("DELETE", this.p(`/git/refs/heads/${branch}`));
    } catch {
      /* already gone */
    }
  }
}
