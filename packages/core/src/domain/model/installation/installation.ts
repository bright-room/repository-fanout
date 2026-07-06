/** GitHub App のインストール（認可の実体・境界を越える plain データ）。 */
export interface Installation {
  id: number;
  account: string;
  accountType: "Organization" | "User";
}
