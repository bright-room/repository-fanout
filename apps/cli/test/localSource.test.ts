import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";

const root = fileURLToPath(new URL("./fixtures/canonical-v3", import.meta.url));
const src = localSource(root);

describe("localSource", () => {
  it("readFile returns content / null for missing", async () => {
    expect(await src.readFile("catalog.json")).toContain("file_type");
    expect(await src.readFile("nope.json")).toBeNull();
  });
  it("listFiles walks recursively with full paths", async () => {
    const files = await src.listFiles("profiles/");
    expect(files).toContain("profiles/base/contributes.json");
    expect(files).toContain("profiles/typescript/contributes.json");
  });
});
