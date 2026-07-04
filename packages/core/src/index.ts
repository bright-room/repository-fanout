export type {
  BranchAction,
  BranchInput,
  PrState,
} from "./domain/model/branch/branchAction.js";
export { decideBranchAction } from "./domain/model/branch/branchAction.js";
export type { TemplateSource } from "./domain/model/canonical/templateSource.js";
export type { FileChange } from "./domain/model/desired/computeChanges.js";
export { computeChanges } from "./domain/model/desired/computeChanges.js";
export type { DesiredEntry } from "./domain/model/desired/desiredFileData.js";
export { isNewerRevision, parseManifest } from "./domain/model/manifest/parse.js";
export type { Manifest, RepoEntry } from "./domain/model/manifest/types.js";
export {
  applyManagedBlock,
  BLOCK_END,
  BLOCK_START,
  removeManagedBlock,
} from "./domain/model/reconcile/managedBlock.js";
export type {
  DistFileRecord,
  DistRecord,
  Distributed,
} from "./domain/model/retraction/distRecord.js";
export {
  emptyDistRecord,
  parseDistRecord,
  recordDistribution,
} from "./domain/model/retraction/distRecord.js";
export type {
  KeptFile,
  RetractionArgs,
  RetractionPlan,
} from "./domain/model/retraction/retractionPlan.js";
export { planRetraction } from "./domain/model/retraction/retractionPlan.js";
export { decodeBase64Utf8 } from "./domain/type/base64.js";
export { sha256Hex } from "./domain/type/hash.js";
export type { Installation } from "./infrastructure/github/auth/installation.js";
export {
  createInstallationToken,
  listInstallations,
} from "./infrastructure/github/auth/installation.js";
export { createAppJwt } from "./infrastructure/github/auth/jwt.js";
export { GitHubClient } from "./infrastructure/github/client.js";
export type { ClassifyOptions, StatusClass } from "./infrastructure/github/errors.js";
export {
  classifyStatus,
  GitHubError,
  parseRateLimitRemaining,
  parseRetryAfter,
} from "./infrastructure/github/errors.js";
export type { PrInfo, RepoIOOpts } from "./infrastructure/github/repoIO.js";
export { RepoIO } from "./infrastructure/github/repoIO.js";
export { applyExtendsField, mergeExtends, RenovateParseError } from "./reconcile/extendsField.js";
export { renderGitignore, substituteVars } from "./templates/render.js";
export { resolveDesiredEntries } from "./templates/resolve.js";
export type { FragmentAxis, FragmentManifest, GitignoreSection } from "./templates/types.js";
