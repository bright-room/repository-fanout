import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";

const argv = (...rest: string[]) => ["node", "cli", ...rest];

describe("parseCliArgs", () => {
  it("--exclude をカンマ区切りで配列化する", () => {
    const a = parseCliArgs(
      argv("apply", "--repo", "o/n", "--exclude", ".github/CODEOWNERS,LICENSE"),
    );
    expect(a.exclude).toEqual([".github/CODEOWNERS", "LICENSE"]);
  });

  it("--exclude 未指定は空配列", () => {
    expect(parseCliArgs(argv("apply", "--repo", "o/n")).exclude).toEqual([]);
  });

  it("空文字の --exclude は空要素を作らない", () => {
    expect(parseCliArgs(argv("apply", "--repo", "o/n", "--exclude", "")).exclude).toEqual([]);
  });

  it("languages / bundles も同様にパースする", () => {
    const a = parseCliArgs(
      argv("dry-run", "--repo", "o/n", "--languages", "go,rust", "--bundles", "oss"),
    );
    expect(a.languages).toEqual(["go", "rust"]);
    expect(a.bundles).toEqual(["oss"]);
  });

  it("codeowner 既定は repo の owner、templates 既定は canonical-files", () => {
    const a = parseCliArgs(argv("apply", "--repo", "kukv/structure"));
    expect(a.codeowner).toBe("kukv");
    expect(a.templatesRepo).toBe("bright-room/canonical-files");
  });

  it("validate 用の --dir を取り出す", () => {
    expect(parseCliArgs(argv("validate", "--dir", "/tmp/canonical")).dir).toBe("/tmp/canonical");
  });
});
