#!/usr/bin/env -S npx tsx
import { GitHubClient } from "@repository-fanout/core";
import { templateSource, actualReader } from "./github.js";
import { planRepo } from "./planRepo.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  const repo = arg("repo");
  const templatesRepo = arg("templates") ?? "bright-room/common-files";
  const profiles = (arg("profiles") ?? "").split(",").filter(Boolean);
  const codeowner = arg("codeowner") ?? repo?.split("/")[0] ?? "";
  const token = process.env.GITHUB_TOKEN;
  if (cmd !== "dry-run" || !repo || !token) {
    console.error(
      "usage: GITHUB_TOKEN=... fanout dry-run --repo owner/name [--profiles a,b] [--templates owner/repo] [--codeowner x]",
    );
    process.exit(2);
  }
  const client = new GitHubClient({ token });
  const plan = await planRepo({
    source: templateSource(client, templatesRepo),
    profiles,
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
  console.error(e);
  process.exit(1);
});
