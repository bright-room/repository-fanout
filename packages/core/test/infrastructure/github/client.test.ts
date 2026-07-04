import { expect, test, vi } from "vitest";
import { GitHubClient } from "../../../src/infrastructure/github/client.js";

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

test("request sends auth header and returns parsed json", async () => {
  const fetchImpl = fakeFetch((url, init) => {
    expect(url).toBe("https://api.github.com/repos/o/r");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    return new Response(JSON.stringify({ full_name: "o/r" }), { status: 200 });
  });
  const gh = new GitHubClient({ token: "tok", fetchImpl });
  const res = await gh.request<{ full_name: string }>("GET", "/repos/o/r");
  expect(res.full_name).toBe("o/r");
});

test("request throws GitHubError with retryAfter on 429", async () => {
  const fetchImpl = fakeFetch(
    () => new Response("rate limited", { status: 429, headers: { "retry-after": "12" } }),
  );
  const gh = new GitHubClient({ token: "tok", fetchImpl });
  await expect(gh.request("GET", "/x")).rejects.toMatchObject({
    name: "GitHubError",
    status: 429,
    retryAfter: 12,
  });
});
