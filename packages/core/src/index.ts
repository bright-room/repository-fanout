export type { Installation } from "./auth/installation.js";
export { createInstallationToken, listInstallations } from "./auth/installation.js";
export { createAppJwt } from "./auth/jwt.js";
export { GitHubClient } from "./github/client.js";
export type { ClassifyOptions, StatusClass } from "./github/errors.js";
export {
  classifyStatus,
  GitHubError,
  parseRateLimitRemaining,
  parseRetryAfter,
} from "./github/errors.js";
export { isNewerRevision, parseManifest } from "./manifest/parse.js";
export type { Manifest, RepoEntry } from "./manifest/types.js";
export { applyManagedBlock, BLOCK_END, BLOCK_START } from "./reconcile/block.js";
export type { BranchAction, BranchInput, PrState } from "./reconcile/branch.js";
export { decideBranchAction } from "./reconcile/branch.js";
export type { FileChange } from "./reconcile/diff.js";
export { computeChanges } from "./reconcile/diff.js";
export { applyExtendsField, mergeExtends, RenovateParseError } from "./reconcile/extendsField.js";
export { renderGitignore, substituteVars } from "./templates/render.js";
export { resolveDesiredEntries } from "./templates/resolve.js";
export type {
  DesiredEntry,
  FragmentAxis,
  FragmentManifest,
  GitignoreSection,
  TemplateSource,
} from "./templates/types.js";
