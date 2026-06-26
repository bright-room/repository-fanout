import { expect, test, vi } from "vitest";
import { RepoIO } from "../../src/github/repoIO.js";
import { GitHubClient } from "@repository-fanout/core";

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
    client: client(
      { "/contents/renovate.json": { content: btoa("A\n"), encoding: "base64" } },
      ["/contents/.github/CODEOWNERS"],
    ),
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
