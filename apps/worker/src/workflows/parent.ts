import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createAppJwt, listInstallations } from "@repository-fanout/core";
import { reportRepoFailure } from "../failure.js";
import type { Env } from "../index.js";
import { getManifest, listManifests } from "../kv/manifestStore.js";

export interface ParentParams {
  runId: string;
  /** 指定時はそのアカウントのみ。未指定＝全アカウント（テンプレ kick） */
  account?: string;
}

const STAGGER_MS = 2000; // 子起動の間隔（セカンダリ制限緩和）

export class ParentWorkflow extends WorkflowEntrypoint<Env, ParentParams> {
  async run(event: WorkflowEvent<ParentParams>, step: WorkflowStep): Promise<void> {
    const { runId, account } = event.payload;

    const manifests = await step.do("load manifests", async () =>
      account
        ? [await getManifest(this.env.MANIFESTS, account)].filter(
            (m): m is NonNullable<typeof m> => m !== null,
          )
        : listManifests(this.env.MANIFESTS),
    );

    const installations = await step.do("list installations", async () => {
      const jwt = await createAppJwt({
        appId: this.env.APP_ID,
        privateKeyPem: this.env.APP_PRIVATE_KEY,
      });
      return listInstallations({ appJwt: jwt });
    });
    const instByAccount = new Map(installations.map((i) => [i.account, i]));

    for (const manifest of manifests) {
      const inst = instByAccount.get(manifest.account);
      if (!inst) {
        // installation 無し = アカウント単位 hard failure（spec §4 / §16-4）
        for (const repo of Object.keys(manifest.repositories)) {
          await step.do(`notify-fail ${manifest.account}/${repo}`, async () => {
            await reportRepoFailure(this.env, runId, {
              account: manifest.account,
              repo,
              error: "no installation for account",
            });
          });
        }
        continue;
      }
      for (const [name, entry] of Object.entries(manifest.repositories)) {
        // 1リポの spawn 失敗で run 全体を止めない。失敗を記録して次へ進む
        // (missing-installation と同じグレースフル方針)。
        try {
          await step.do(`spawn ${manifest.account}/${name}`, async () => {
            await this.env.CHILD.create({
              params: {
                runId,
                account: manifest.account,
                installationId: inst.id,
                repo: `${manifest.account}/${name}`,
                languages: entry.languages,
                bundles: entry.bundles,
                vars: entry.vars,
                exclude: entry.exclude,
              },
            });
          });
        } catch (err) {
          await step.do(`notify-fail ${manifest.account}/${name}`, async () => {
            await reportRepoFailure(this.env, runId, {
              account: manifest.account,
              repo: name,
              error: `spawn failed: ${String(err)}`,
            });
          });
        }
        await step.sleep(`stagger ${manifest.account}/${name}`, STAGGER_MS);
      }
    }
  }
}
