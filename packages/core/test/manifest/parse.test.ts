import { expect, test } from "vitest";
import { isNewerRevision, parseManifest } from "../../src/manifest/parse.js";

const valid = {
  account: "bright-room",
  revision: 5,
  sourceCommit: "abc123",
  repositories: {
    "endpoint-gate": {
      languages: ["terraform"],
      vars: { codeowner: "bright-room/br-maintainers" },
    },
  },
};

test("parseManifest accepts a valid manifest", () => {
  const m = parseManifest(valid);
  expect(m.account).toBe("bright-room");
  expect(m.repositories["endpoint-gate"]!.languages).toEqual(["terraform"]);
});

test("parseManifest rejects empty repositories", () => {
  expect(() => parseManifest({ ...valid, repositories: {} })).toThrow(/empty/i);
});

test("parseManifest rejects missing account/revision", () => {
  expect(() => parseManifest({ ...valid, account: "" })).toThrow();
  expect(() => parseManifest({ ...valid, revision: undefined })).toThrow();
});

test("parseManifest defaults vars/exclude", () => {
  const m = parseManifest({
    account: "kukv",
    revision: 1,
    sourceCommit: "x",
    repositories: { dotfiles: { languages: [] } },
  });
  expect(m.repositories.dotfiles!.vars).toEqual({});
  expect(m.repositories.dotfiles!.exclude).toEqual([]);
});

test("parseManifest rejects non-string languages entries (no coercion)", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [1] } },
    }),
  ).toThrow(/languages/i);
});

test("parseManifest rejects non-string exclude entries", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [], exclude: [true] } },
    }),
  ).toThrow(/exclude/i);
});

test("parseManifest rejects vars that is not an object", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [], vars: "oops" } },
    }),
  ).toThrow(/vars/i);
});

test("parseManifest rejects vars with non-string values", () => {
  expect(() =>
    parseManifest({
      account: "kukv",
      revision: 1,
      sourceCommit: "x",
      repositories: { dotfiles: { languages: [], vars: { codeowner: 5 } } },
    }),
  ).toThrow(/vars/i);
});

test("isNewerRevision enforces monotonic CAS", () => {
  expect(isNewerRevision(6, 5)).toBe(true);
  expect(isNewerRevision(5, 5)).toBe(false);
  expect(isNewerRevision(4, 5)).toBe(false);
  expect(isNewerRevision(1, undefined)).toBe(true); // 初回
});
