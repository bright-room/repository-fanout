import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSource } from "../src/localSource.js";
import { checkRenderedGithubYaml, validateSource } from "../src/validateDir.js";

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

  it("描画後の issue form が不正(body 欠落)なら validate が捕まえる", async () => {
    const errors = await validateSource(fixture("catalog-bad-issue-form"));
    expect(errors.some((e) => e.includes("bug_report.yaml") && /body/.test(e))).toBe(true);
  });
});

describe("checkRenderedGithubYaml", () => {
  const FORM = ".github/ISSUE_TEMPLATE/bug_report.yaml";
  const CONFIG = ".github/ISSUE_TEMPLATE/config.yml";

  it("妥当な issue form は null", () => {
    expect(
      checkRenderedGithubYaml(FORM, "name: Bug\nbody:\n  - type: textarea\n    id: x\n"),
    ).toBeNull();
  });

  it("name 欠落 / body 欠落 / body 空 を検出", () => {
    expect(checkRenderedGithubYaml(FORM, "body:\n  - type: textarea\n")).toMatch(/name/);
    expect(checkRenderedGithubYaml(FORM, "name: Bug\n")).toMatch(/body/);
    expect(checkRenderedGithubYaml(FORM, "name: Bug\nbody: []\n")).toMatch(/body/);
  });

  it("不正な YAML を検出", () => {
    expect(checkRenderedGithubYaml(FORM, "name: [unterminated\n")).toMatch(/invalid YAML/);
  });

  it("妥当な config は null、contact_link のキー欠落は検出", () => {
    expect(
      checkRenderedGithubYaml(
        CONFIG,
        "blank_issues_enabled: true\ncontact_links:\n  - name: D\n    url: https://x/d\n    about: ask\n",
      ),
    ).toBeNull();
    expect(
      checkRenderedGithubYaml(CONFIG, "contact_links:\n  - name: D\n    url: https://x/d\n"),
    ).toMatch(/about/);
  });

  it("ISSUE_TEMPLATE 外の yaml はパース可能性のみ、非 yaml は対象外", () => {
    expect(
      checkRenderedGithubYaml(".github/release.yaml", "changelog:\n  categories: []\n"),
    ).toBeNull();
    expect(checkRenderedGithubYaml(".github/release.yaml", "a: [bad\n")).toMatch(/invalid YAML/);
    expect(
      checkRenderedGithubYaml(".github/pull_request_template.md", "## X {{ not yaml"),
    ).toBeNull();
  });
});
