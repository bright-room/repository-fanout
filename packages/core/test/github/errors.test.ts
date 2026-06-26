import { expect, test } from "vitest";
import { classifyStatus, parseRetryAfter } from "../../src/github/errors.js";

test("classifyStatus marks transient statuses retryable", () => {
  expect(classifyStatus(429)).toBe("retryable");
  expect(classifyStatus(403)).toBe("retryable"); // secondary rate limit
  expect(classifyStatus(500)).toBe("retryable");
  expect(classifyStatus(409)).toBe("retryable"); // ref conflict
});

test("classifyStatus marks client errors fatal", () => {
  expect(classifyStatus(401)).toBe("fatal");
  expect(classifyStatus(404)).toBe("fatal");
  expect(classifyStatus(422)).toBe("fatal");
});

test("classifyStatus treats 2xx as ok", () => {
  expect(classifyStatus(200)).toBe("ok");
  expect(classifyStatus(201)).toBe("ok");
});

test("parseRetryAfter reads seconds header", () => {
  const h = new Headers({ "retry-after": "30" });
  expect(parseRetryAfter(h)).toBe(30);
  expect(parseRetryAfter(new Headers())).toBeUndefined();
});
