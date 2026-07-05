import type { ManagedPathSpec, StructuredFileType } from "../reconcile/structuredDocument.js";

/**
 * 望ましいファイルの plain 表現(境界横断用)。step.do / KV を越える値は
 * クラスでなくこの型で運ぶ(core 構造設計 §4 の境界ルール)。
 */
export type DesiredFileData =
  | { strategy: "replace"; path: string; content: string }
  | { strategy: "create-only"; path: string; content: string }
  | { strategy: "managed-block"; path: string; blockContent: string }
  /** exclude 指定時: fanout の寄与ゼロへ収束させる(spec v2 §5.5) */
  | { strategy: "managed-block-retract"; path: string }
  /** v3: 構造化ファイルの managed_paths 管理(extends-field の一般化。spec v3 §6.2) */
  | {
      strategy: "structured-managed";
      path: string;
      fileType: StructuredFileType;
      managedPaths: Record<string, ManagedPathSpec>;
      data: Record<string, unknown>;
      universe: Record<string, string[]>;
      createContent: string;
    }
  /** v3 exclude: 寄与ゼロへ収束(spec v2 §5.5 の一般化) */
  | {
      strategy: "structured-managed-retract";
      path: string;
      fileType: StructuredFileType;
      managedPaths: Record<string, ManagedPathSpec>;
      universe: Record<string, string[]>;
    };

/** 旧名。既存テスト・apps の互換用エイリアス */
export type DesiredEntry = DesiredFileData;
