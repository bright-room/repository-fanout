import { GitHubClient } from "@repository-fanout/core";
import { expect, test } from "vitest";
import { actualReader, templateSource } from "../src/github.js";

/** GitHub Contents API 風のレスポンスを返す fake fetch を作る */
function fakeContentsFetch(files: Record<string, string>): typeof fetch {
  return (async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    const m = u.match(/\/contents\/([^?]+)/);
    const path = m ? decodeURIComponent(m[1] ?? "") : "";
    const content = files[path];
    if (content === undefined) {
      return new Response("not found", { status: 404 });
    }
    const b64 = Buffer.from(content, "utf8").toString("base64");
    return new Response(JSON.stringify({ content: b64, encoding: "base64" }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("templateSource.readFile decodes multibyte UTF-8 content (no atob corruption)", async () => {
  const client = new GitHubClient({
    token: "x",
    fetchImpl: fakeContentsFetch({ "base/files/README.md": "# 日本語 émojis 🚀" }),
  });
  const src = templateSource(client, "o/c");
  expect(await src.readFile("base/files/README.md")).toBe("# 日本語 émojis 🚀");
  expect(await src.readFile("base/files/missing.md")).toBeNull();
});

test("templateSource.readFragmentManifest reads languages/<lang>/fragment.json", async () => {
  const client = new GitHubClient({
    token: "x",
    fetchImpl: fakeContentsFetch({
      "languages/terraform/fragment.json": '{"renovate":["github>o/renovate-config:terraform"]}',
    }),
  });
  const src = templateSource(client, "o/c");
  const fm = await src.readFragmentManifest("languages/terraform");
  expect(fm?.renovate).toEqual(["github>o/renovate-config:terraform"]);
  expect(await src.readFragmentManifest("languages/missing")).toBeNull();
});

test("actualReader decodes UTF-8 and omits missing paths", async () => {
  const client = new GitHubClient({
    token: "x",
    fetchImpl: fakeContentsFetch({ "renovate.json": '{"key":"値"}' }),
  });
  const read = actualReader(client, "o/repo");
  const out = await read(["renovate.json", "absent.txt"]);
  expect(out).toEqual({ "renovate.json": '{"key":"値"}' });
});
