// apps/worker/src/workflows/parent.ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createAppJwt, type Installation, listInstallations } from "@repository-fanout/core";
import { reportRepoFailure } from "../failure.js";
import type { Env } from "../index.js";
import { getManifest, listManifests } from "../kv/manifestStore.js";
import type { StepLike } from "./child.js";

export interface ParentParams {
  runId: string;
  /** 指定時はそのアカウントのみ。未指定=全アカウント(テンプレ kick) */
  account?: string;
  /** 指定時はそのリポ名(owner なし)のみ reconcile(部分再試行。spec §6.4) */
  repos?: string[];
}

// ウェーブ方式の並行制御(spec §6.3)。同時に最大 WAVE_SIZE 個の子を起動し、
// ウェーブ間に sleep を挟む。具体値は運用でチューニング(spec §12 相当の扱い)。
const WAVE_SIZE = 5;
const WAVE_SLEEP_MS = 10_000;

export interface ParentDeps {
  listInstallations?: () => Promise<Installation[]>;
}

export async function runParent(
  env: Env,
  params: ParentParams,
  step: StepLike,
  deps: ParentDeps = {},
): Promise<void> {
  const { runId, account, repos } = params;

  const manifests = await step.do("load manifests", async () =>
    account
      ? [await getManifest(env.MANIFESTS, account)].filter(
          (m): m is NonNullable<typeof m> => m !== null,
        )
      : listManifests(env.MANIFESTS),
  );

  const installations = await step.do("list installations", async () => {
    if (deps.listInstallations) return deps.listInstallations();
    const jwt = await createAppJwt({ appId: env.APP_ID, privateKeyPem: env.APP_PRIVATE_KEY });
    return listInstallations({ appJwt: jwt });
  });
  // account 照合は大文字小文字を無視する(manifest の account と installation の
  // login で表記が食い違うことがあるため)。KV キーや spawn params には manifest
  // 側の表記をそのまま使う(影響を照合ロジックのみに限定)。
  const instByAccount = new Map(installations.map((i) => [i.account.toLowerCase(), i]));

  interface SpawnItem {
    account: string;
    name: string;
    installationId: number;
    entry: {
      languages: string[];
      bundles: string[];
      contents: Record<string, string>;
      exclude: string[];
    };
  }
  const items: SpawnItem[] = [];

  for (const manifest of manifests) {
    const inst = instByAccount.get(manifest.account.toLowerCase());
    const names = Object.keys(manifest.repositories).filter(
      (name) => !repos || repos.includes(name),
    );
    if (!inst) {
      // installation 無し = アカウント単位 hard failure(spec §4 / §16-4)
      for (const name of names) {
        await step.do(`notify-fail ${manifest.account}/${name}`, async () => {
          await reportRepoFailure(env, runId, {
            account: manifest.account,
            repo: `${manifest.account}/${name}`,
            error: "no installation for account",
          });
        });
      }
      continue;
    }
    for (const name of names) {
      items.push({
        account: manifest.account,
        name,
        installationId: inst.id,
        // name は Object.keys(manifest.repositories) 由来なので必ず存在する
        entry: manifest.repositories[name]!,
      });
    }
  }

  for (let i = 0; i < items.length; i += WAVE_SIZE) {
    for (const it of items.slice(i, i + WAVE_SIZE)) {
      // 1リポの spawn 失敗で run 全体を止めない
      try {
        await step.do(`spawn ${it.account}/${it.name}`, async () => {
          await env.CHILD.create({
            params: {
              runId,
              account: it.account,
              installationId: it.installationId,
              repo: `${it.account}/${it.name}`,
              languages: it.entry.languages,
              bundles: it.entry.bundles,
              vars: it.entry.contents,
              exclude: it.entry.exclude,
            },
          });
        });
      } catch (err) {
        await step.do(`notify-fail ${it.account}/${it.name}`, async () => {
          await reportRepoFailure(env, runId, {
            account: it.account,
            repo: `${it.account}/${it.name}`,
            error: `spawn failed: ${String(err)}`,
          });
        });
      }
    }
    if (i + WAVE_SIZE < items.length) {
      await step.sleep(`wave-${i / WAVE_SIZE}`, WAVE_SLEEP_MS);
    }
  }
}

export class ParentWorkflow extends WorkflowEntrypoint<Env, ParentParams> {
  async run(event: WorkflowEvent<ParentParams>, step: WorkflowStep): Promise<void> {
    await runParent(this.env, event.payload, step);
  }
}
