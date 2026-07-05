import { expect, test } from "vitest";
import { crossDedupe, Template } from "../../../../src/domain/model/canonical/template.js";

const CTX = { contributions: {}, contents: {}, repo: "", account: "" };

test("変数展開と contents 参照", async () => {
  const out = await Template.of("* {{ contents.codeowner }}").render({
    ...CTX,
    contents: { codeowner: "@org/team" },
  });
  expect(out).toBe("* @org/team");
});

test("未定義変数はエラー(strict。unresolved placeholder 検出の後継)", async () => {
  await expect(Template.of("* {{ contents.codeowner }}").render(CTX)).rejects.toThrow();
});

test("raw は Liquid を通さず逐語(GitHub Actions の ${{ }} 対策)", async () => {
  const body = "run: echo ${{ secrets.TOKEN }}\n";
  expect(await Template.of(body, { raw: true }).render(CTX)).toBe(body);
});

test("cross_dedupe: セクション横断 dedupe(初出優先)+ 空セクション削除", () => {
  const out = crossDedupe(
    [
      { comment: "a", ignores: ["x", "y"] },
      { comment: "b", ignores: ["y"] },
      { comment: "c", ignores: ["y", "z"] },
    ],
    "ignores",
  );
  expect(out).toEqual([
    { comment: "a", ignores: ["x", "y"] },
    { comment: "c", ignores: ["z"] },
  ]);
});

// gitignore.liquid の正準形。P-b(canonical-files 変換)でこのテンプレートを使うと
// v2 renderGitignore とバイト一致することを固定する(マーカーブロック差分による
// 全リポ一斉 PR を防ぐため、このテストが等価性の根拠になる)。
const GITIGNORE_LIQUID = `{% capture nl %}
{% endcapture %}{% capture sep %}{{ nl }}{{ nl }}{% endcapture %}{% assign sections = contributions.sections | cross_dedupe: "ignores" %}{% capture out %}{% for s in sections %}### {{ s.comment }} ###{{ nl }}{{ s.ignores | join: nl }}{% unless forloop.last %}{{ sep }}{% endunless %}{% endfor %}{% endcapture %}{{ out }}`;

test("gitignore.liquid の描画結果が正準形(マーカー無し本文)", async () => {
  const sections = [
    { comment: "base", ignores: [".DS_Store", "*.log"] },
    { comment: "node", ignores: ["node_modules/", "*.log"] }, // *.log は横断 dedupe
    { comment: "empty", ignores: ["*.log"] }, // 空になり見出しごと消える
  ];
  const v3 = await Template.of(GITIGNORE_LIQUID).render({
    ...CTX,
    contributions: { sections },
  });
  expect(v3).toBe("### base ###\n.DS_Store\n*.log\n\n### node ###\nnode_modules/");
});
