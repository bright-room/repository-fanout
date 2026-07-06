import { expect, test } from "vitest";
import { ResourceNotFoundException } from "../../../src/domain/exception/resourceNotFoundException.js";

test("reason を message に持ち name は ResourceNotFoundException", () => {
  const e = new ResourceNotFoundException("manifest not found: acme");
  expect(e).toBeInstanceOf(Error);
  expect(e.message).toBe("manifest not found: acme");
  expect(e.name).toBe("ResourceNotFoundException");
});
