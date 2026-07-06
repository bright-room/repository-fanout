import { expect, test } from "vitest";
import type { InstallationRepository } from "../../../../src/application/service/installation/installationRepository.js";
import type { Installation } from "../../../../src/domain/model/installation/installation.js";

const inst: Installation = { id: 1, account: "acme", accountType: "Organization" };
const fake: InstallationRepository = {
  list: async () => [inst],
  mintToken: async () => ({ token: "t", expiresAt: "2026-01-01T00:00:00Z" }),
};

test("InstallationRepository の契約に適合するフェイクが実装できる", async () => {
  expect((await fake.list())[0]?.account).toBe("acme");
  expect((await fake.mintToken(1)).token).toBe("t");
});
