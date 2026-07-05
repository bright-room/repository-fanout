import { expect, test } from "vitest";
import { pathsToRead } from "../../../src/application/scenario/reconcileRepository.js";

test("pathsToRead: 望ましい状態 ∪ 配布記録だけにあるパス(削除候補)", () => {
  const desired = [{ strategy: "replace", path: "a", content: "" } as const];
  const record = {
    version: 1 as const,
    files: {
      a: { strategy: "replace" as const, hashes: [] },
      gone: { strategy: "replace" as const, hashes: [] },
    },
  };
  expect(pathsToRead(desired, record)).toEqual(["a", "gone"]);
});
