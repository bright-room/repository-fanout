#!/usr/bin/env -S npx tsx
import { GitHubClient } from "@repository-fanout/core";
import { actualReader, templateSource } from "./github.js";
import { planRepo } from "./planRepo.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  const repo = arg("repo");
  const templatesRepo = arg("templates") ?? "bright-room/common-files";
  const languages = (arg("languages") ?? "").split(",").filter(Boolean);
  const codeowner = arg("codeowner") ?? repo?.split("/")[0] ?? "";
  const token = process.env.GITHUB_TOKEN;
  if (cmd !== "dry-run" || !repo || !token) {
    console.error(
      "usage: GITHUB_TOKEN=... fanout dry-run --repo owner/name [--languages a,b] [--templates owner/repo] [--codeowner x]",
    );
    process.exit(2);
  }
  const client = new GitHubClient({ token });
  const plan = await planRepo({
    source: templateSource(client, templatesRepo),
    languages,
    vars: { codeowner },
    exclude: [],
    readActual: actualReader(client, repo),
  });
  if (plan.changes.length === 0) {
    console.log(`${repo}: no changes (in sync)`);
    return;
  }
  console.log(`${repo}: ${plan.changes.length} file(s) would change:`);
  for (const c of plan.changes) console.log(`  ~ ${c.path}`);
}

main().catch((e) => {
  // 想定内の運用エラー（unknown language / GitHubError 等）はスタックでなくメッセージのみ表示。
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
