import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// NOTE: we configure miniflare directly here instead of pointing at wrangler.toml.
// @cloudflare/vitest-pool-workers does not support Workflows bindings (its runner
// only re-exports Durable Object / WorkerEntrypoint classes), so loading the real
// wrangler.toml (which declares [[workflows]]) makes the runtime fail to start.
// Tests that need PARENT/CHILD stub those bindings on the env they pass in.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {
          compatibilityDate: "2024-12-30",
          compatibilityFlags: ["nodejs_compat"],
          kvNamespaces: ["MANIFESTS", "RUNS"],
          bindings: {
            "SYNC_HMAC_SECRET__bright-room": "testsecret",
            SYNC_HMAC_SECRET___global: "globalsecret",
            APP_ID: "1",
            APP_PRIVATE_KEY: "test",
            TEMPLATES_REPO: "o/c",
          },
        },
      },
    },
    include: ["test/**/*.test.ts"],
  },
});
