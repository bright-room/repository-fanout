import { env } from "cloudflare:test";
import {
  BLOCK_END,
  BLOCK_START,
  type DistRecord,
  sha256Hex,
  type TemplateSource,
} from "@repository-fanout/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/index.js";
import { getDistRecord, putDistRecord } from "../../src/kv/distStore.js";
import {
  type ChildParams,
  type RepoPort,
  runChild,
  type StepLike,
} from "../../src/workflows/child.js";

// --- フェイク群(全ステップを実際に実行する。スタブ迂回禁止: spec §9-2) ----
const fakeStep: StepLike = {
  do: (_name, fn) => fn(),
  sleep: async () => {},
};

/**
 * インメモリ TemplateSource(v3 catalog レイアウト)。
 * `base/files/<path>` キーの有無で「その path を base profile が寄与するか」を表す。
 */
function memTemplates(files: Record<string, string>): TemplateSource {
  const contributes: Record<string, unknown> = {};
  if ("base/files/.github/release.yml" in files) {
    contributes[".github/release.yml"] = { template: "release.yml.liquid" };
  }
  if ("base/files/.gitignore" in files) {
    contributes[".gitignore"] = { template: "gitignore.liquid" };
  }
  const tree: Record<string, string> = {
    "catalog.json": JSON.stringify({
      files: {
        ".github/release.yml": { file_type: "yaml", mode: "replaced" },
        ".gitignore": { file_type: "text", mode: "managed" },
      },
    }),
    "profiles/base/contributes.json": JSON.stringify(contributes),
    "templates/release.yml.liquid": files["base/files/.github/release.yml"] ?? "",
    "templates/gitignore.liquid": "managed",
  };
  return {
    readFile: async (p) => tree[p] ?? null,
    listFiles: async (prefix) =>
      Object.keys(tree)
        .filter((p) => p.startsWith(prefix))
        .sort(),
  };
}

interface FakeRepoState {
  files: Record<string, string>;
  commits: Array<{ changes: Array<{ path: string; content: string }>; deletions: string[] }>;
  prs: Array<{ number: number; body: string }>;
  bodies: Record<number, string>;
}

function fakeRepo(state: FakeRepoState): RepoPort {
  return {
    getDefaultBranch: async () => ({ branch: "main", sha: "base-sha" }),
    readActualFiles: async (paths) => {
      const out: Record<string, string> = {};
      for (const p of paths) if (state.files[p] !== undefined) out[p] = state.files[p];
      return out;
    },
    findPr: async () => null,
    branchExists: async () => false,
    getTreeSha: async () => "tree-sha",
    commitChanges: async (args) => {
      state.commits.push({ changes: args.changes, deletions: args.deletions ?? [] });
    },
    createPr: async (args) => {
      state.prs.push({ number: 1, body: args.body });
      return 1;
    },
    reopenPr: async () => {},
    addLabels: async () => {},
    deleteBranch: async () => {},
    updatePrBody: async (n, body) => {
      state.bodies[n] = body;
    },
  };
}

const params: ChildParams = {
  runId: "run-1",
  account: "bright-room",
  installationId: 1,
  repo: "bright-room/target",
  languages: [],
  bundles: [],
  vars: {},
  exclude: [],
};

const RELEASE = "changelog: {}\n";

// MANIFESTS/RUNS KV は各テストで独立(vitest-pool-workers の isolated storage)

afterEach(() => vi.unstubAllGlobals());

describe("runChild wiring", () => {
  it("distributes a new file, creates PR, records hash in dist record", async () => {
    const state: FakeRepoState = { files: {}, commits: [], prs: [], bodies: {} };
    await runChild(env, params, fakeStep, {
      templates: memTemplates({ "base/files/.github/release.yml": RELEASE }),
      io: fakeRepo(state),
    });
    expect(state.commits[0]!.changes).toEqual([{ path: ".github/release.yml", content: RELEASE }]);
    expect(state.prs).toHaveLength(1);
    const rec = await getDistRecord(env.MANIFESTS, "bright-room", "bright-room/target");
    expect(rec.files[".github/release.yml"]!.hashes).toEqual([await sha256Hex(RELEASE)]);
  });

  it("canonical file removed + hash matches → deletion in PR, record kept (spec §5.4)", async () => {
    const rec: DistRecord = {
      version: 1,
      files: { "old.yml": { strategy: "replace", hashes: [await sha256Hex("OLD")] } },
    };
    await putDistRecord(env.MANIFESTS, "bright-room", "bright-room/target", rec);
    const state: FakeRepoState = { files: { "old.yml": "OLD" }, commits: [], prs: [], bodies: {} };
    await runChild(env, params, fakeStep, {
      templates: memTemplates({}), // 正本から消えた
      io: fakeRepo(state),
    });
    expect(state.commits[0]!.deletions).toEqual(["old.yml"]);
    const after = await getDistRecord(env.MANIFESTS, "bright-room", "bright-room/target");
    expect(after.files["old.yml"]).toBeDefined(); // merge 確認まで維持
  });

  it("modified file → kept, dropped from record, noted in PR body", async () => {
    const rec: DistRecord = {
      version: 1,
      files: { "old.yml": { strategy: "replace", hashes: [await sha256Hex("OLD")] } },
    };
    await putDistRecord(env.MANIFESTS, "bright-room", "bright-room/target", rec);
    const state: FakeRepoState = {
      files: { "old.yml": "REPO-EDITED" },
      commits: [],
      prs: [],
      bodies: {},
    };
    await runChild(env, params, fakeStep, {
      templates: memTemplates({ "base/files/.github/release.yml": RELEASE }), // 別の差分で PR は出る
      io: fakeRepo(state),
    });
    expect(state.commits[0]!.deletions).toEqual([]);
    expect(state.prs[0]!.body).toContain("old.yml");
    expect(state.prs[0]!.body).toContain("残置");
    const after = await getDistRecord(env.MANIFESTS, "bright-room", "bright-room/target");
    expect(after.files["old.yml"]).toBeUndefined();
  });

  it("no diff → noop, but record cleanup still persisted", async () => {
    const rec: DistRecord = {
      version: 1,
      files: { "gone.yml": { strategy: "replace", hashes: ["h"] } }, // 実ファイル無し → 掃除
    };
    await putDistRecord(env.MANIFESTS, "bright-room", "bright-room/target", rec);
    const state: FakeRepoState = { files: {}, commits: [], prs: [], bodies: {} };
    await runChild(env, params, fakeStep, {
      templates: memTemplates({}),
      io: fakeRepo(state),
    });
    expect(state.commits).toHaveLength(0);
    const after = await getDistRecord(env.MANIFESTS, "bright-room", "bright-room/target");
    expect(after.files["gone.yml"]).toBeUndefined();
  });

  it("skips the dist record KV write when the record is unchanged (Free プラン write 予算節約)", async () => {
    const state: FakeRepoState = { files: {}, commits: [], prs: [], bodies: {} };
    const putSpy = vi.spyOn(env.MANIFESTS, "put");
    await runChild(env, params, fakeStep, {
      templates: memTemplates({}), // managed-block/extends-field 相当: 配布記録に残るものが無い
      io: fakeRepo(state),
    });
    expect(state.commits).toHaveLength(0);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("already-converged replace file is adopted into the record (v0 取り込み)", async () => {
    const state: FakeRepoState = {
      files: { ".github/release.yml": RELEASE }, // v0 が配った同一内容
      commits: [],
      prs: [],
      bodies: {},
    };
    await runChild(env, params, fakeStep, {
      templates: memTemplates({ "base/files/.github/release.yml": RELEASE }),
      io: fakeRepo(state),
    });
    expect(state.commits).toHaveLength(0); // 差分なし
    const rec = await getDistRecord(env.MANIFESTS, "bright-room", "bright-room/target");
    expect(rec.files[".github/release.yml"]!.hashes).toEqual([await sha256Hex(RELEASE)]);
  });

  it("managed-block exclude strips block via PR (spec §5.5)", async () => {
    const gitignore = `${BLOCK_START}\nmanaged\n${BLOCK_END}\nrepo-own\n`;
    const state: FakeRepoState = {
      files: { ".gitignore": gitignore },
      commits: [],
      prs: [],
      bodies: {},
    };
    await runChild(env, { ...params, exclude: [".gitignore"] }, fakeStep, {
      templates: memTemplates({ "base/files/.gitignore": "{{gitignore}}" }),
      io: fakeRepo(state),
    });
    expect(state.commits[0]!.changes).toEqual([{ path: ".gitignore", content: "repo-own\n" }]);
  });

  it("kept files trigger a Discord notification (spec §5.7)", async () => {
    const rec: DistRecord = {
      version: 1,
      files: { "old.yml": { strategy: "replace", hashes: [await sha256Hex("OLD")] } },
    };
    await putDistRecord(env.MANIFESTS, "bright-room", "bright-room/target", rec);
    const state: FakeRepoState = {
      files: { "old.yml": "REPO-EDITED" },
      commits: [],
      prs: [],
      bodies: {},
    };
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("", { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const testEnv: Env = { ...env, DISCORD_WEBHOOK_URL: "https://discord.example/webhook" };
    await runChild(testEnv, params, fakeStep, {
      templates: memTemplates({ "base/files/.github/release.yml": RELEASE }),
      io: fakeRepo(state),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.example/webhook");
    const body = JSON.parse(init.body as string) as { content: string };
    expect(body.content).toContain("bright-room/target");
    expect(body.content).toContain("old.yml (modified)");
  });

  it("failure is recorded and rethrown (Workflows リトライに委ねる)", async () => {
    const failingRepo: RepoPort = {
      ...fakeRepo({ files: {}, commits: [], prs: [], bodies: {} }),
      getDefaultBranch: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      runChild(env, params, fakeStep, {
        templates: memTemplates({}),
        io: failingRepo,
      }),
    ).rejects.toThrow("boom");
    const raw = await env.RUNS.get("run:run-1:bright-room:bright-room/target");
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ status: "failed" });
  });
});
