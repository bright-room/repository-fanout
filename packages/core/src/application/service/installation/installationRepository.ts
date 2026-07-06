import type { Installation } from "../../../domain/model/installation/installation.js";

/** GitHub App のインストール列挙とインストールトークン発行のポート。 */
export interface InstallationRepository {
  list(): Promise<Installation[]>;
  mintToken(installationId: number): Promise<{ token: string; expiresAt: string }>;
}
