/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { Env as WorkerEnv } from "../src/index.js";

declare global {
  namespace Cloudflare {
    // Make `env` from cloudflare:test typed as the worker Env (plus dynamic secrets).
    interface Env extends WorkerEnv {}
  }
}
