// apps/worker/test/workflows/parent.test.ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { StepLike } from "../../src/workflows/child.js";
import { runParent } from "../../src/workflows/parent.js";

const fakeStep = (sleeps: string[] = []): StepLike => ({
  do: (_name, fn) => fn(),
  sleep: async (name) => {
    sleeps.push(name);
  },
});

function manifest(account: string, repoNames: string[], revision = 1) {
  return {
    account,
    revision,
    sourceCommit: "c0ffee",
    repositories: Object.fromEntries(
      repoNames.map((n) => [n, { languages: ["typescript"], bundles: [], vars: {}, exclude: [] }]),
    ),
  };
}

const inst = (account: string, id: number) => ({ account, id, accountType: "Organization" as const });

describe("runParent wiring", () => {
  it("spawns a child per repo with full params", async () => {
    await env.MANIFESTS.put("manifest:acc", JSON.stringify(manifest("acc", ["r1", "r2"])));
    const created: unknown[] = [];
    const testEnv = { ...env, CHILD: { create: async (a: unknown) => void created.push(a) } };
    await runParent(testEnv as never, { runId: "run-1", account: "acc" }, fakeStep(), {
      listInstallations: async () => [inst("acc", 42)],
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      params: { runId: "run-1", account: "acc", repo: "acc/r1", installationId: 42 },
    });
  });

  it("repos filter narrows the spawn list (部分再試行。spec §6.4)", async () => {
    await env.MANIFESTS.put("manifest:acc", JSON.stringify(manifest("acc", ["r1", "r2", "r3"])));
    const created: Array<{ params: { repo: string } }> = [];
    const testEnv = { ...env, CHILD: { create: async (a: never) => void created.push(a) } };
    await runParent(testEnv as never, { runId: "run-1", account: "acc", repos: ["r2"] }, fakeStep(), {
      listInstallations: async () => [inst("acc", 42)],
    });
    expect(created.map((c) => c.params.repo)).toEqual(["acc/r2"]);
  });

  it("sleeps between waves of 5 (spec §6.3)", async () => {
    await env.MANIFESTS.put(
      "manifest:acc",
      JSON.stringify(manifest("acc", ["a", "b", "c", "d", "e", "f", "g"])),
    );
    const sleeps: string[] = [];
    const testEnv = { ...env, CHILD: { create: async () => {} } };
    await runParent(testEnv as never, { runId: "run-1", account: "acc" }, fakeStep(sleeps), {
      listInstallations: async () => [inst("acc", 42)],
    });
    expect(sleeps).toEqual(["wave-0"]); // 7 リポ → 5+2 の 2 ウェーブ → 間の sleep 1 回
  });

  it("no installation → per-repo hard failure recorded, no spawn (spec §6.2)", async () => {
    await env.MANIFESTS.put("manifest:ghost", JSON.stringify(manifest("ghost", ["r1"])));
    const created: unknown[] = [];
    const testEnv = { ...env, CHILD: { create: async (a: unknown) => void created.push(a) } };
    await runParent(testEnv as never, { runId: "run-9", account: "ghost" }, fakeStep(), {
      listInstallations: async () => [],
    });
    expect(created).toHaveLength(0);
    const raw = await env.RUNS.get("run:run-9:ghost:ghost/r1");
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ status: "failed" });
  });

  it("spawn failure does not stop the run", async () => {
    await env.MANIFESTS.put("manifest:acc", JSON.stringify(manifest("acc", ["bad", "good"])));
    const created: Array<{ params: { repo: string } }> = [];
    const testEnv = {
      ...env,
      CHILD: {
        create: async (a: { params: { repo: string } }) => {
          if (a.params.repo === "acc/bad") throw new Error("spawn boom");
          created.push(a);
        },
      },
    };
    await runParent(testEnv as never, { runId: "run-2", account: "acc" }, fakeStep(), {
      listInstallations: async () => [inst("acc", 42)],
    });
    expect(created.map((c) => c.params.repo)).toEqual(["acc/good"]);
    const raw = await env.RUNS.get("run:run-2:acc:acc/bad");
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ status: "failed" });
  });
});
