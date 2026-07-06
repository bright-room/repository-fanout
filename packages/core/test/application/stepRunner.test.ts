import { expect, test } from "vitest";
import type { StepRunner } from "../../src/application/stepRunner.js";

// 契約に適合する即時実行ランナー（cli 実装の雛形・P2 で infrastructure-node に置く）
const immediate: StepRunner = {
  do: (_name, fn) => fn(),
  sleep: async () => {},
};

test("StepRunner は do で fn の戻り値を返し sleep は解決する", async () => {
  const v = await immediate.do("step", async () => 42);
  expect(v).toBe(42);
  await expect(immediate.sleep("wait", 5)).resolves.toBeUndefined();
});
