import { expect, test } from "vitest";
import { signHmac, verifyHmac } from "../../src/auth/hmac.js";

test("verifyHmac accepts a fresh, correctly signed request", async () => {
  const secret = "s3cret";
  const ts = 1_000_000;
  const body = '{"a":1}';
  const sig = await signHmac(secret, ts, body);
  const r = await verifyHmac({
    secret,
    timestamp: ts,
    body,
    signature: sig,
    now: ts + 10,
    windowSec: 300,
  });
  expect(r).toEqual({ ok: true });
});

test("verifyHmac rejects bad signature", async () => {
  const r = await verifyHmac({
    secret: "s",
    timestamp: 1,
    body: "b",
    signature: "deadbeef",
    now: 1,
    windowSec: 300,
  });
  expect(r.ok).toBe(false);
});

test("verifyHmac rejects stale timestamp outside window", async () => {
  const secret = "s";
  const ts = 1000;
  const body = "b";
  const sig = await signHmac(secret, ts, body);
  const r = await verifyHmac({
    secret,
    timestamp: ts,
    body,
    signature: sig,
    now: ts + 1000,
    windowSec: 300,
  });
  expect(r).toEqual({ ok: false, reason: "stale" });
});
