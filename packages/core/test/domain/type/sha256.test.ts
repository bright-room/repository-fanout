import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../src/domain/type/hash.js";
import { Sha256 } from "../../../src/domain/type/sha256.js";

describe("Sha256", () => {
  it("toString() は生 hex(プレフィックス無し)を返す = 既存 KV 互換", async () => {
    const s = await Sha256.of("hello");
    expect(s.toString()).toBe(await sha256Hex("hello"));
    expect(s.toString()).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
  it("fromHex() で保存済み hex から復元できる", () => {
    expect(Sha256.fromHex("abc").toString()).toBe("abc");
  });
  it("equals() は hex の一致で判定する", async () => {
    const a = await Sha256.of("x");
    const b = Sha256.fromHex(a.toString());
    expect(a.equals(b)).toBe(true);
    expect(a.equals(await Sha256.of("y"))).toBe(false);
  });
});
