import { GitHubClient } from "@repository-fanout/core";
import { expect, test, vi } from "vitest";
import { GitHubTemplateSource } from "../../src/github/templateSource.js";

function clientReturning(map: Record<string, unknown>): GitHubClient {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    for (const [frag, val] of Object.entries(map)) {
      if (u.includes(frag)) return new Response(JSON.stringify(val), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return new GitHubClient({ token: "t", fetchImpl });
}

test("listFiles filters tree by prefix", async () => {
  const client = clientReturning({
    "/git/trees/HEAD?recursive=1": {
      tree: [
        { path: "base/files/renovate.json", type: "blob" },
        { path: "base/files/.github/CODEOWNERS", type: "blob" },
        { path: "languages/terraform/fragment.json", type: "blob" },
      ],
    },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  expect((await src.listFiles("base/files/")).sort()).toEqual([
    "base/files/.github/CODEOWNERS",
    "base/files/renovate.json",
  ]);
});

test("readFragmentManifest parses fragment.json content", async () => {
  const content = btoa('{"renovate":["github>o/renovate-config:terraform"]}');
  const client = clientReturning({
    "/contents/languages/terraform/fragment.json": { content, encoding: "base64" },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  const fm = await src.readFragmentManifest("languages/terraform");
  expect(fm?.renovate).toEqual(["github>o/renovate-config:terraform"]);
});

test("listNames returns unique dir names per axis; nameExists checks the axis", async () => {
  const client = clientReturning({
    "/git/trees/HEAD?recursive=1": {
      tree: [
        { path: "languages/terraform/fragment.json", type: "blob" },
        { path: "languages/typescript/fragment.json", type: "blob" },
        { path: "languages/typescript/files/.editorconfig", type: "blob" },
        { path: "bundles/oss/files/CONTRIBUTING.md", type: "blob" },
        { path: "base/fragment.json", type: "blob" },
      ],
    },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  expect((await src.listNames("languages")).sort()).toEqual(["terraform", "typescript"]);
  expect(await src.listNames("bundles")).toEqual(["oss"]);
  expect(await src.nameExists("languages", "terraform")).toBe(true);
  expect(await src.nameExists("languages", "oss")).toBe(false);
  expect(await src.nameExists("bundles", "oss")).toBe(true);
});

test("readFile decodes multibyte UTF-8 content losslessly", async () => {
  const utf8b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const text = "# 見出し 🚀\n";
  const client = clientReturning({
    "/contents/base/files/README.md": { content: utf8b64(text), encoding: "base64" },
  });
  const src = new GitHubTemplateSource({ client, repo: "o/c" });
  expect(await src.readFile("base/files/README.md")).toBe(text);
});
