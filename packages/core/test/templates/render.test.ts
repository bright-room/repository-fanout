import { expect, test } from "vitest";
import { renderRenovateExtends, renderGitignore, substituteVars } from "../../src/templates/render.js";

test("renderRenovateExtends concatenates base + profiles, dedups, preserves order", () => {
  const out = renderRenovateExtends([
    ["github>o/c//presets/default"],
    [],                          // java: 何も足さない
    ["group:springBoot"],
    ["github>o/c//presets/default"], // 重複
  ]);
  expect(out).toBe('"github>o/c//presets/default", "group:springBoot"');
});

test("renderGitignore joins lines with newline and dedups exact lines", () => {
  const out = renderGitignore([
    ["# OS", ".DS_Store"],
    ["# node", "node_modules/", ".DS_Store"], // .DS_Store 重複
  ]);
  expect(out).toBe("# OS\n.DS_Store\n# node\nnode_modules/");
});

test("substituteVars replaces {{key}} and leaves unknown placeholders intact", () => {
  expect(substituteVars("* @{{codeowner}}", { codeowner: "bright-room/br-maintainers" }))
    .toBe("* @bright-room/br-maintainers");
  expect(substituteVars("a {{missing}} b", {})).toBe("a {{missing}} b");
});
