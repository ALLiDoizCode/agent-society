/**
 * Checkpoint Type Definitions
 *
 * Types for the CheckpointManager: config, results, events, and errors.
 *
 * ArweaveUploadAdapter is defined locally (same structural contract as
 * @toon-protocol/sdk's ArweaveUploadAdapter) to avoid adding a dependency
 * on @toon-protocol/sdk from @toon-protocol/pet-dvm. The two interfaces
 * are structurally compatible — any TurboUploadAdapter instance satisfies both.
 *
 * @module checkpoint/types
 */

// ============================================================
// Local ArweaveUploadAdapter (mirrors packages/sdk/src/arweave/turbo-adapter.ts)
// ============================================================

/**
 * Minimal interface for uploading data to Arweave.
 * Structurally compatible with @toon-protocol/sdk ArweaveUploadAdapter.
 */
export interface ArweaveUploadAdapter {
  upload(
    data: Buffer,
    tags?: Record<string, string>
  ): Promise<{ txId: string }>;
}

// ============================================================
// Config
// ============================================================

/** Configuration for CheckpointManager */
export interface CheckpointConfig {
  /** Arweave upload adapter (injected; wraps @ardrive/turbo-sdk) */
  arweaveAdapter: ArweaveUploadAdapter;
  /** Directory containing .mv2 brain files */
  brainStoragePath: string;
  /**
   * Number of interactions between Arweave checkpoints.
   * Must be >= 1. Default: 10.
   */
  checkpointThreshold: number;
  /** Additional Arweave data item tags (lower priority than mandatory tags) */
  arweaveTags?: Record<string, string>;
}

// ============================================================
// Result & Event
// ============================================================

/** Result returned by a successful checkpoint upload */
export interface CheckpointResult {
  blobbiId: string;
  txId: string;
  brainHash: string;
  timestamp: number;
}

/** Event emitted on the 'checkpoint' event after successful upload */
export interface CheckpointEvent {
  blobbiId: string;
  txId: string;
  brainHash: string;
  timestamp: number;
}

// ============================================================
// Errors
// ============================================================

/** Error codes for checkpoint failures */
export type CheckpointErrorCode =
  | 'UPLOAD_FAILED'
  | 'FILE_NOT_FOUND'
  | 'CONFIG_ERROR';

/** Non-fatal error emitted on the 'error' event */
export class CheckpointError extends Error {
  constructor(
    message: string,
    public readonly blobbiId: string,
    public readonly code: CheckpointErrorCode
  ) {
    super(message);
    this.name = 'CheckpointError';
    Object.setPrototypeOf(this, CheckpointError.prototype);
  }
}

/** Thrown synchronously in CheckpointManager constructor for invalid config */
export class CheckpointConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointConfigError';
    Object.setPrototypeOf(this, CheckpointConfigError.prototype);
  }
}
