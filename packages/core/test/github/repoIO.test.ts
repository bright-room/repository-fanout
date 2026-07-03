import { expect, it, test, vi } from "vitest";
import { GitHubClient } from "../../src/github/client.js";
import { RepoIO } from "../../src/github/repoIO.js";

function client(map: Record<string, unknown>, notFound: string[] = []): GitHubClient {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (notFound.some((f) => u.includes(f))) return new Response("nf", { status: 404 });
    // Pick the longest matching fragment so e.g. "/git/ref/heads/main"
    // wins over the less specific "/repos/o/r".
    const match = Object.entries(map)
      .filter(([frag]) => u.includes(frag))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (match) return new Response(JSON.stringify(match[1]), { status: 200 });
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return new GitHubClient({ token: "t", fetchImpl });
}

test("getDefaultBranch returns name and sha", async () => {
  const io = new RepoIO({
    client: client({
      "/repos/o/r": { default_branch: "main" },
      "/git/ref/heads/main": { object: { sha: "deadbeef" } },
    }),
    repo: "o/r",
  });
  expect(await io.getDefaultBranch()).toEqual({ branch: "main", sha: "deadbeef" });
});

test("readActualFiles returns map; missing paths omitted", async () => {
  const io = new RepoIO({
    client: client({ "/contents/renovate.json": { content: btoa("A\n"), encoding: "base64" } }, [
      "/contents/.github/CODEOWNERS",
    ]),
    repo: "o/r",
  });
  const got = await io.readActualFiles(["renovate.json", ".github/CODEOWNERS"], "main");
  expect(got).toEqual({ "renovate.json": "A\n" });
});

test("readActualFiles decodes multibyte UTF-8 content losslessly", async () => {
  const utf8b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const text = "日本語🚀\n";
  const io = new RepoIO({
    client: client({ "/contents/x.md": { content: utf8b64(text), encoding: "base64" } }),
    repo: "o/r",
  });
  const got = await io.readActualFiles(["x.md"], "main");
  expect(got["x.md"]).toBe(text);
});

it("commitChanges includes deletions as sha:null tree entries (spec §5.8)", async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "blob1" }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "tree1" }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "commit1" }, { status: 201 });
    return Response.json({}, { status: 200 });
  };
  const io = new RepoIO({ client: new GitHubClient({ token: "t", fetchImpl }), repo: "o/r" });
  await io.commitChanges({
    branch: "b",
    baseSha: "base",
    baseTreeSha: "btree",
    message: "m",
    changes: [{ path: "a.txt", content: "A" }],
    deletions: ["old.yml"],
    create: false,
  });
  const treeReq = requests.find((r) => r.url.endsWith("/git/trees"));
  expect((treeReq?.body as { tree: unknown[] }).tree).toContainEqual({
    path: "old.yml",
    mode: "100644",
    type: "blob",
    sha: null,
  });
});

it("updatePrBody PATCHes the pull request body", async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json({}, { status: 200 });
  };
  const io = new RepoIO({ client: new GitHubClient({ token: "t", fetchImpl }), repo: "o/r" });
  await io.updatePrBody(7, "new body");
  expect(requests[0]).toMatchObject({ method: "PATCH", body: { body: "new body" } });
  expect(requests[0]?.url).toContain("/pulls/7");
});
