import type { FileChange } from "../reconcile/fileChange.js";
import { applyManagedBlock, removeManagedBlock } from "../reconcile/managedBlock.js";
import {
  type ManagedPathsSpec,
  StructuredDocument,
  type StructuredFileType,
} from "../reconcile/structuredDocument.js";
import type { DesiredFileData } from "./desiredFileData.js";

/**
 * 望ましいファイル(strategy 別)。データと突合操作を一緒に持つドメインオブジェクト。
 * 境界(step.do / KV)は plain な DesiredFileData で越え、内側で from() で載せ替える
 * (core 構造設計 §4)。
 */
export abstract class DesiredFile {
  abstract readonly path: string;
  /** 実ファイルとの突合。変更不要なら null(no-op) */
  abstract applyTo(actual: string | undefined): FileChange | null;
  /** exclude 時の姿(spec v2 §5.5)。null = 配布対象から外す(replace / create-only) */
  abstract retracted(): DesiredFileData | null;

  static from(data: DesiredFileData): DesiredFile {
    switch (data.strategy) {
      case "replace":
        return new ReplaceFile(data.path, data.content);
      case "create-only":
        return new CreateOnlyFile(data.path, data.content);
      case "managed-block":
        return new ManagedBlockFile(data.path, data.blockContent);
      case "managed-block-retract":
        return new ManagedBlockRetractFile(data.path);
      case "structured-managed":
        return new StructuredManagedFile(data.path, data.fileType, data, data.createContent);
      case "structured-managed-retract":
        return new StructuredManagedRetractFile(
          data.path,
          data.fileType,
          data.managedPaths,
          data.universe,
        );
      default: {
        // 戦略を追加したらここがコンパイルエラーになる(silent no-op を防ぐ。旧 diff.ts と同じ)
        const _exhaustive: never = data;
        throw new Error(`unknown desired file strategy: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

class ReplaceFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly content: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    return actual !== this.content ? { path: this.path, content: this.content } : null;
  }
  retracted(): DesiredFileData | null {
    return null; // ファイルには触らず記録の引き渡しのみ(worker の retraction 側)
  }
}

class CreateOnlyFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly content: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    return actual === undefined ? { path: this.path, content: this.content } : null;
  }
  retracted(): DesiredFileData | null {
    return null;
  }
}

class ManagedBlockFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly blockContent: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    const next = applyManagedBlock(actual, this.blockContent);
    return next !== actual ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "managed-block-retract", path: this.path };
  }
}

class ManagedBlockRetractFile extends DesiredFile {
  constructor(readonly path: string) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return null; // ファイルが無ければ寄与ゼロ達成済み
    const next = removeManagedBlock(actual);
    return next !== undefined && next !== actual ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return { strategy: "managed-block-retract", path: this.path };
  }
}

class StructuredManagedFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly fileType: StructuredFileType,
    private readonly spec: ManagedPathsSpec,
    private readonly createContent: string,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return { path: this.path, content: this.createContent };
    const next = StructuredDocument.parse(this.fileType, this.path, actual).mergedContent(
      this.spec,
    );
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return {
      strategy: "structured-managed-retract",
      path: this.path,
      fileType: this.fileType,
      managedPaths: this.spec.managedPaths,
      universe: this.spec.universe,
    };
  }
}

class StructuredManagedRetractFile extends DesiredFile {
  constructor(
    readonly path: string,
    private readonly fileType: StructuredFileType,
    private readonly managedPaths: ManagedPathsSpec["managedPaths"],
    private readonly universe: Record<string, string[]>,
  ) {
    super();
  }
  applyTo(actual: string | undefined): FileChange | null {
    if (actual === undefined) return null;
    const empty: Record<string, unknown> = {};
    for (const [key, s] of Object.entries(this.managedPaths)) {
      empty[key] = s.merge === "array" ? [] : {};
    }
    const next = StructuredDocument.parse(this.fileType, this.path, actual).mergedContent({
      managedPaths: this.managedPaths,
      data: empty,
      universe: this.universe,
    });
    return next !== null ? { path: this.path, content: next } : null;
  }
  retracted(): DesiredFileData {
    return {
      strategy: "structured-managed-retract",
      path: this.path,
      fileType: this.fileType,
      managedPaths: this.managedPaths,
      universe: this.universe,
    };
  }
}
