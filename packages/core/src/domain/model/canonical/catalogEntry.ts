import { isPlainObject } from "../../type/object.js";
import type { DesiredFileData } from "../desired/desiredFileData.js";
import {
  type ManagedPathSpec,
  StructuredDocument,
  type StructuredFileType,
} from "../reconcile/structuredDocument.js";
import type { PathContributions } from "./contribution.js";
import type { RenderContext, Template } from "./template.js";

const FILE_TYPES = new Set(["text", "markdown", "json", "yaml", "toml"]);
const MERGE_KINDS = new Set(["array", "table"]);
const STRUCTURED = new Set(["json", "yaml", "toml"]);

export interface DeriveArgs {
  contributions: PathContributions;
  /** contributes の template 宣言から解決済みの本文(未宣言なら undefined) */
  template: Template | undefined;
  ctx: RenderContext;
  /** managed path → 全 profile 寄与の和集合(構造化 managed のみ使用) */
  universe: Record<string, string[]>;
}

/**
 * catalog.json の 1 エントリ(spec v3 §4.1)。mode 別の導出をポリモーフィズムで持ち、
 * 検証を通らないエントリのインスタンスは存在しえない(完全コンストラクタ)。
 */
export abstract class CatalogEntry {
  protected constructor(
    readonly path: string,
    readonly raw: boolean,
  ) {}

  static parse(path: string, v: unknown): CatalogEntry {
    if (!isPlainObject(v)) throw new Error(`catalog.json: ${path}: must be an object`);
    const { file_type, mode, managed_paths, raw } = v;
    if (typeof file_type !== "string" || !FILE_TYPES.has(file_type)) {
      throw new Error(`catalog.json: ${path}: unknown file_type: ${JSON.stringify(file_type)}`);
    }
    if (raw !== undefined && typeof raw !== "boolean") {
      throw new Error(`catalog.json: ${path}: raw must be boolean`);
    }
    const isRaw = raw ?? false;
    if (mode === "managed" && STRUCTURED.has(file_type)) {
      return new ManagedStructuredFile(
        path,
        isRaw,
        file_type as StructuredFileType,
        parseManagedPaths(path, managed_paths),
      );
    }
    if (managed_paths !== undefined) {
      throw new Error(`catalog.json: ${path}: managed_paths is only for managed structured files`);
    }
    if (mode === "replaced") return new ReplacedFile(path, isRaw);
    if (mode === "create-only") return new CreateOnlyFile(path, isRaw);
    if (mode === "managed") return new ManagedTextFile(path, isRaw);
    throw new Error(`catalog.json: ${path}: unknown mode: ${JSON.stringify(mode)}`);
  }

  abstract deriveDesired(args: DeriveArgs): Promise<DesiredFileData>;

  protected async renderRequired(args: DeriveArgs): Promise<string> {
    if (args.template === undefined) throw new Error(`no template declared for ${this.path}`);
    return await args.template.render(args.ctx);
  }
}

function parseManagedPaths(path: string, v: unknown): Record<string, ManagedPathSpec> {
  if (!isPlainObject(v) || Object.keys(v).length === 0) {
    throw new Error(`catalog.json: ${path}: managed structured file requires managed_paths`);
  }
  for (const [key, spec] of Object.entries(v)) {
    if (!isPlainObject(spec) || typeof spec.merge !== "string" || !MERGE_KINDS.has(spec.merge)) {
      throw new Error(
        `catalog.json: ${path}: managed_paths.${key}: merge must be "array" | "table"`,
      );
    }
    if (spec.key !== undefined) {
      if (spec.merge !== "array") {
        throw new Error(
          `catalog.json: ${path}: managed_paths.${key}: key is only for merge "array"`,
        );
      }
      if (typeof spec.key !== "string" || spec.key.length === 0) {
        throw new Error(
          `catalog.json: ${path}: managed_paths.${key}: key must be a non-empty string`,
        );
      }
    }
  }
  return v as unknown as Record<string, ManagedPathSpec>;
}

export class ReplacedFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    return { strategy: "replace", path: this.path, content: await this.renderRequired(args) };
  }
}

export class CreateOnlyFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    return { strategy: "create-only", path: this.path, content: await this.renderRequired(args) };
  }
}

export class ManagedTextFile extends CatalogEntry {
  constructor(path: string, raw: boolean) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    const content = await this.renderRequired(args);
    return { strategy: "managed-block", path: this.path, blockContent: content.replace(/\n$/, "") };
  }
}

export class ManagedStructuredFile extends CatalogEntry {
  constructor(
    path: string,
    raw: boolean,
    readonly structuredType: StructuredFileType,
    readonly managedPaths: Record<string, ManagedPathSpec>,
  ) {
    super(path, raw);
  }
  async deriveDesired(args: DeriveArgs): Promise<DesiredFileData> {
    const data = args.contributions.mergedData();
    for (const key of Object.keys(data)) {
      if (!(key in this.managedPaths)) {
        throw new Error(`${this.path}: contribution key is not a managed path (typo?): ${key}`);
      }
    }
    const spec = { managedPaths: this.managedPaths, data, universe: args.universe };
    const skeleton = args.template === undefined ? undefined : await args.template.render(args.ctx);
    return {
      strategy: "structured-managed",
      path: this.path,
      fileType: this.structuredType,
      ...spec,
      createContent: StructuredDocument.createContent(
        this.structuredType,
        this.path,
        spec,
        skeleton,
      ),
    };
  }
}
