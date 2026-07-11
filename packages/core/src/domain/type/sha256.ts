import { sha256Hex } from "./hash.js";

/**
 * 内容ハッシュの値オブジェクト。配布記録のハッシュ照合ガード(spec v2 §5.4)の
 * 「配った証明」を担う。値は生 hex(プレフィックス無し = 既存 KV レコード互換)。
 */
export class Sha256 {
  private constructor(private readonly hex: string) {}

  /** 内容から算出。 */
  static async of(content: string): Promise<Sha256> {
    return new Sha256(await sha256Hex(content));
  }

  /** 保存済み hex から復元。 */
  static fromHex(hex: string): Sha256 {
    return new Sha256(hex);
  }

  /** 直列化用の生 hex。 */
  get value(): string {
    return this.hex;
  }

  sameValue(other: Sha256): boolean {
    return this.hex === other.hex;
  }
}
