import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../src/domain/type/hash.js";

describe("sha256Hex", () => {
  it("computes sha256 hex of utf-8 content", async () => {
    // echo -n "hello" | shasum -a 256
    expect(await sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it("handles multibyte utf-8", async () => {
    expect(await sha256Hex("日本語")).toBe(
      "77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5",
    );
  });
});
