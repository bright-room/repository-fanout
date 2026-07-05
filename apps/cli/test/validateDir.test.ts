import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";
import { validateSource } from "../src/validateDir.js";

const fixture = (name: string) =>
  localSource(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

describe("validateSource (v3 catalog)", () => {
  it("valid v3 tree → no errors", async () => {
    expect(await validateSource(fixture("canonical-v3"))).toEqual([]);
  });

  it("reports catalog.json parse error", async () => {
    const errors = await validateSource(fixture("catalog-bad-json"));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("reports render failure when a profile contributes an unregistered path", async () => {
    const errors = await validateSource(fixture("catalog-unknown-path"));
    expect(errors.some((e) => e.includes("renovate.json"))).toBe(true);
  });
});
