import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";

const root = fileURLToPath(new URL("./fixtures/canonical-mini", import.meta.url));
const src = localSource(root);

describe("localSource", () => {
  it("readFile returns content / null for missing", async () => {
    expect(await src.readFile("strategies.json")).toContain("extends-field");
    expect(await src.readFile("nope.json")).toBeNull();
  });
  it("listFiles walks recursively with full paths", async () => {
    const files = await src.listFiles("base/files/");
    expect(files).toContain("base/files/.github/CODEOWNERS");
    expect(files).toContain("base/files/renovate.json");
  });
  it("listNames / nameExists reflect directories", async () => {
    expect(await src.listNames("languages")).toEqual(["typescript"]);
    expect(await src.listNames("bundles")).toEqual(["oss"]);
    expect(await src.nameExists("languages", "typescript")).toBe(true);
    expect(await src.nameExists("languages", "go")).toBe(false);
  });
  it("readFragmentManifest parses fragment.json / null for missing", async () => {
    const f = await src.readFragmentManifest("languages/typescript");
    expect(f?.renovate).toEqual(["github>bright-room/renovate-config:typescript"]);
    expect(await src.readFragmentManifest("languages/nope")).toBeNull();
  });
  it("readFragmentManifest throws on invalid JSON (検証用途のため握りつぶさない)", async () => {
    // fixtures/broken-fragment/languages/bad/fragment.json = "{ not json"
    const brokenRoot = fileURLToPath(new URL("./fixtures/broken-fragment", import.meta.url));
    await expect(localSource(brokenRoot).readFragmentManifest("languages/bad")).rejects.toThrow();
  });
});
