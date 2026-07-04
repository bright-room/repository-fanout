import { expect, test } from "vitest";
import {
  PathContributions,
  ProfileContributes,
} from "../../../../src/domain/model/canonical/contribution.js";

test("ProfileContributes.parse: 検証つき(不正 JSON / 非 object / template 型)", () => {
  expect(ProfileContributes.parse("base", null).paths).toEqual([]);
  expect(() => ProfileContributes.parse("base", "{oops")).toThrow(/invalid JSON/);
  expect(() => ProfileContributes.parse("base", "[]")).toThrow(/must be an object/);
  expect(() =>
    ProfileContributes.parse("base", JSON.stringify({ ".gitignore": { template: 1 } })),
  ).toThrow(/template must be a string/);
  const pc = ProfileContributes.parse(
    "base",
    JSON.stringify({ _comment: "note", ".gitignore": { template: "g.liquid" } }),
  );
  expect(pc.paths).toEqual([".gitignore"]); // "_" 始まりは運用コメント
});

test("PathContributions: template はちょうど 0 or 1。2 つは衝突エラー", () => {
  const one = new PathContributions(".gitignore", [
    { profile: "base", contribution: { template: "g.liquid" } },
    { profile: "ts", contribution: { sections: [] } },
  ]);
  expect(one.templateName()).toBe("g.liquid");
  const zero = new PathContributions(".gitignore", [{ profile: "ts", contribution: {} }]);
  expect(zero.templateName()).toBeUndefined();
  const two = new PathContributions(".gitignore", [
    { profile: "base", contribution: { template: "a.liquid" } },
    { profile: "oss", contribution: { template: "b.liquid" } },
  ]);
  expect(() => two.templateName()).toThrow(/template collision: \.gitignore/);
});

test("mergedData: 配列は宣言順 concat、オブジェクトは deep merge 後勝ち、template 除外、入力非破壊", () => {
  const a = {
    template: "g.liquid",
    sections: [{ ignores: ["x"] }],
    tools: { node: "20", pnpm: "9" },
  };
  const b = { sections: [{ ignores: ["y"] }], tools: { node: "22" } };
  const merged = new PathContributions("f", [
    { profile: "base", contribution: a },
    { profile: "ts", contribution: b },
  ]).mergedData();
  expect(merged).toEqual({
    sections: [{ ignores: ["x"] }, { ignores: ["y"] }],
    tools: { node: "22", pnpm: "9" },
  });
  expect(a.sections).toHaveLength(1); // 非破壊
});
