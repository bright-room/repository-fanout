export type { ReconcileDeclaration } from "./application/scenario/reconcileRepository.js";
export {
  computeChangesStep,
  pathsToRead,
  resolveDesiredStep,
} from "./application/scenario/reconcileRepository.js";
export type {
  BranchAction,
  BranchInput,
  PrState,
} from "./domain/model/branch/branchAction.js";
export { decideBranchAction } from "./domain/model/branch/branchAction.js";
export { Catalog } from "./domain/model/canonical/catalog.js";
export {
  CatalogEntry,
  CreateOnlyFile,
  ManagedStructuredFile,
  ManagedTextFile,
  ReplacedFile,
} from "./domain/model/canonical/catalogEntry.js";
export { PathContributions, ProfileContributes } from "./domain/model/canonical/contribution.js";
export { Profiles } from "./domain/model/canonical/profiles.js";
export type { RenderContext } from "./domain/model/canonical/template.js";
export { crossDedupe, Template } from "./domain/model/canonical/template.js";
export type { TemplateSource } from "./domain/model/canonical/templateSource.js";
export type { FileChange } from "./domain/model/desired/computeChanges.js";
export { computeChanges } from "./domain/model/desired/computeChanges.js";
export type { DeriveDesiredArgs, ResolveAutoArgs } from "./domain/model/desired/derive.js";
export { deriveDesiredFiles, resolveDesired } from "./domain/model/desired/derive.js";
export { DesiredFile } from "./domain/model/desired/desiredFile.js";
export type { DesiredEntry, DesiredFileData } from "./domain/model/desired/desiredFileData.js";
export { isNewerRevision, parseManifest } from "./domain/model/manifest/parse.js";
export type { Manifest, RepoEntry } from "./domain/model/manifest/types.js";
export {
  applyManagedBlock,
  BLOCK_END,
  BLOCK_START,
  removeManagedBlock,
} from "./domain/model/reconcile/managedBlock.js";
export type {
  ManagedPathSpec,
  ManagedPathsSpec,
  MergeKind,
  StructuredFileType,
} from "./domain/model/reconcile/structuredDocument.js";
export {
  mergeManagedArray,
  mergeManagedTable,
  StructuredDocument,
  StructuredParseError,
} from "./domain/model/reconcile/structuredDocument.js";
// retraction（DistRecord 集約に一本化。保存形式は apps 側 datasource の所有）
export {
  DistFileRecord,
  DistRecord,
  type Distributed,
  type DistStrategy,
  type KeptFile,
  type RetractionArgs,
  type RetractionPlan,
} from "./domain/model/retraction/distRecord.js";
export { decodeBase64Utf8 } from "./domain/type/base64.js";
export { sha256Hex } from "./domain/type/hash.js";
export { deepEqual, isPlainObject } from "./domain/type/object.js";
export { Sha256 } from "./domain/type/sha256.js";
export { parseYaml } from "./domain/type/yaml.js";
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
