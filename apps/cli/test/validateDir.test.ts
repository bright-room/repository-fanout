import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";
import { validateSource } from "../src/validateDir.js";

const fixture = (name: string) =>
  localSource(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

describe("validateSource", () => {
  it("valid canonical tree → no errors", async () => {
    expect(await validateSource(fixture("canonical-mini"))).toEqual([]);
  });

  it("detects unknown fragment keys (typo guard)", async () => {
    // fixtures/typo-fragment: canonical-mini のコピー + languages/typescript/fragment.json の
    // キーを "renovte"(typo)にしたもの
    const errors = await validateSource(fixture("typo-fragment"));
    expect(errors.some((e) => e.includes('unknown key "renovte"'))).toBe(true);
  });

  it("reports render failure with combo label", async () => {
    // fixtures/broken-strategies: canonical-mini のコピー + strategies.json の値を
    // "extends-fieldd"(未知戦略)にしたもの → parseStrategyConfig が throw
    const errors = await validateSource(fixture("broken-strategies"));
    expect(errors.some((e) => e.startsWith("render failed [base-only]"))).toBe(true);
  });

  it("reports broken fragment JSON as an error (not a crash)", async () => {
    const errors = await validateSource(fixture("broken-fragment"));
    expect(errors.some((e) => e.includes("languages/bad/fragment.json"))).toBe(true);
  });
});
