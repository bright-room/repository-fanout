/** 単一リソースの不在を表すドメイン例外。message に「何が見つからなかったか」を書く。 */
export class ResourceNotFoundException extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ResourceNotFoundException";
  }
}
