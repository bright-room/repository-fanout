import { afterEach, expect, test, vi } from "vitest";
import { notifyFailure, notifyKeptFiles } from "../src/notify.js";

const info = { runId: "r1", account: "bright-room", repo: "bright-room/x", error: "boom" };

afterEach(() => vi.unstubAllGlobals());

test("posts a plain content message to the webhook", async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response("", { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await notifyFailure("https://discord.example/webhook", info);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://discord.example/webhook");
  const body = JSON.parse(init.body as string) as { content: string };
  expect(body.content).toContain("bright-room/x");
  expect(body.content).toContain("boom");
  expect(body.content).toContain("r1");
});

test("truncates content to stay under Discord's 2000-char limit", async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response("", { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await notifyFailure("https://discord.example/webhook", { ...info, error: "x".repeat(3000) });
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(init.body as string) as { content: string };
  expect(body.content.length).toBeLessThanOrEqual(2000);
});

test("skips when webhook url is not configured", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await notifyFailure(undefined, info);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("swallows network errors and non-2xx responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("net down");
    }),
  );
  await expect(notifyFailure("https://discord.example/webhook", info)).resolves.toBeUndefined();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("err", { status: 500 })),
  );
  await expect(notifyFailure("https://discord.example/webhook", info)).resolves.toBeUndefined();
});

test("notifyKeptFiles posts a message listing kept paths and reasons (spec §5.7)", async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response("", { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await notifyKeptFiles("https://discord.example/webhook", {
    runId: "r1",
    account: "bright-room",
    repo: "bright-room/x",
    kept: [
      { path: "old.yml", reason: "modified" },
      { path: "x.md", reason: "excluded" },
    ],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://discord.example/webhook");
  const body = JSON.parse(init.body as string) as { content: string };
  expect(body.content).toContain("bright-room/x");
  expect(body.content).toContain("bright-room");
  expect(body.content).toContain("old.yml (modified)");
  expect(body.content).toContain("x.md (excluded)");
  expect(body.content).toContain("r1");
});

test("notifyKeptFiles skips when webhook url is not configured", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await notifyKeptFiles(undefined, {
    runId: "r1",
    account: "bright-room",
    repo: "bright-room/x",
    kept: [{ path: "old.yml", reason: "modified" }],
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
