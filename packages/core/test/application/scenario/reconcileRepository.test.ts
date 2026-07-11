import { expect, test } from "vitest";
import { pathsToRead } from "../../../src/application/scenario/reconcileRepository.js";

test("pathsToRead: 望ましい状態 ∪ 配布記録だけにあるパス(削除候補)", () => {
  const desired = [{ strategy: "replace", path: "a", content: "" } as const];
  expect(pathsToRead(desired, ["a", "gone"])).toEqual(["a", "gone"]);
});
