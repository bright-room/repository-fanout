/// <reference types="@cloudflare/vitest-pool-workers" />

import type { Env } from "../src/index.js";

declare module "cloudflare:test" {
  // Make `env` from cloudflare:test typed as the worker Env (plus dynamic secrets).
  interface ProvidedEnv extends Env {}
}
