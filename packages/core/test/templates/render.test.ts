import { expect, test } from "vitest";
import { renderGitignore, substituteVars } from "../../src/templates/render.js";

test("renderGitignore prepends '# ' to each section_comment, blank line between sections", () => {
  const out = renderGitignore([
    [{ section_comment: "OS / editor", ignores: [".DS_Store", ".idea/"] }],
    [{ section_comment: "node", ignores: ["node_modules/"] }],
  ]);
  expect(out).toBe("# OS / editor\n.DS_Store\n.idea/\n\n# node\nnode_modules/");
});

test("renderGitignore dedups ignore entries across sections and drops sections left empty", () => {
  const out = renderGitignore([
    [{ section_comment: "OS", ignores: [".DS_Store"] }],
    [{ section_comment: "node", ignores: ["node_modules/", ".DS_Store"] }], // .DS_Store 重複
    [{ section_comment: "dup-only", ignores: [".DS_Store"] }], // 全部重複 → 節ごと省く
  ]);
  expect(out).toBe("# OS\n.DS_Store\n\n# node\nnode_modules/");
});

test("renderGitignore dedups duplicate entries within a single section", () => {
  const out = renderGitignore([[{ section_comment: "OS", ignores: [".DS_Store", ".DS_Store"] }]]);
  expect(out).toBe("# OS\n.DS_Store");
});

test("renderGitignore renders a section without a comment as bare ignores", () => {
  const out = renderGitignore([[{ ignores: ["a", "b"] }]]);
  expect(out).toBe("a\nb");
});

test("substituteVars replaces {{key}} and leaves unknown placeholders intact", () => {
  expect(substituteVars("* @{{codeowner}}", { codeowner: "bright-room/br-maintainers" })).toBe(
    "* @bright-room/br-maintainers",
  );
  expect(substituteVars("a {{missing}} b", {})).toBe("a {{missing}} b");
});
