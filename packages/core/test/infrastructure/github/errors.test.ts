import { expect, test } from "vitest";
import {
  classifyStatus,
  GitHubError,
  parseRateLimitRemaining,
  parseRetryAfter,
} from "../../../src/infrastructure/github/errors.js";

test("classifyStatus marks transient statuses retryable", () => {
  expect(classifyStatus(429)).toBe("retryable");
  expect(classifyStatus(500)).toBe("retryable");
  expect(classifyStatus(409)).toBe("retryable"); // ref conflict
});

test("classifyStatus marks client errors fatal", () => {
  expect(classifyStatus(401)).toBe("fatal");
  expect(classifyStatus(404)).toBe("fatal");
  expect(classifyStatus(422)).toBe("fatal");
});

test("classifyStatus treats a bare 403 (permission denied) as fatal", () => {
  expect(classifyStatus(403)).toBe("fatal");
});

test("classifyStatus treats 403 as retryable only for secondary rate limits", () => {
  expect(classifyStatus(403, { hasRetryAfter: true })).toBe("retryable");
  expect(classifyStatus(403, { rateLimitRemaining: 0 })).toBe("retryable");
  expect(classifyStatus(403, { rateLimitRemaining: 12 })).toBe("fatal");
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

test("parseRateLimitRemaining reads the rate limit header", () => {
  expect(parseRateLimitRemaining(new Headers({ "x-ratelimit-remaining": "0" }))).toBe(0);
  expect(parseRateLimitRemaining(new Headers({ "x-ratelimit-remaining": "57" }))).toBe(57);
  expect(parseRateLimitRemaining(new Headers())).toBeUndefined();
});

test("GitHubError.class reflects 403 context", () => {
  expect(new GitHubError(403, "/x", "permission denied").class).toBe("fatal");
  expect(new GitHubError(403, "/x", "secondary limit", 30).class).toBe("retryable");
  expect(new GitHubError(403, "/x", "rate limited", undefined, 0).class).toBe("retryable");
});
