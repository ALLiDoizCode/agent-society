/**
 * CheckpointManager — Periodic Arweave brain checkpointing.
 *
 * Tracks interaction counts per pet and fires Arweave uploads when the
 * configurable threshold is reached. Extends EventEmitter for non-fatal
 * error propagation without crashing the DVM handler hot path.
 *
 * @module checkpoint/CheckpointManager
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  CheckpointConfig,
  CheckpointResult,
  CheckpointEvent,
} from './types';
import { CheckpointError, CheckpointConfigError } from './types';

/**
 * Manages periodic .mv2 brain checkpoints to Arweave.
 *
 * Usage:
 * 1. Instantiate once at handler creation time (not per-request).
 * 2. Call recordInteraction(blobbiId) after each successful pet interaction.
 * 3. If recordInteraction returns true, fire-and-forget checkpoint(blobbiId, brainHash).
 * 4. Listen on 'checkpoint' for successful upload events.
 * 5. Listen on 'error' for non-fatal failures (DVM continues regardless).
 */
export class CheckpointManager extends EventEmitter {
  private readonly config: CheckpointConfig;
  /** Per-pet interaction counter. Map preserves insertion order for determinism. */
  private readonly counters = new Map<string, number>();

  constructor(config: CheckpointConfig) {
    super();
    if (config.checkpointThreshold < 1) {
      throw new CheckpointConfigError(
        `checkpointThreshold must be >= 1, got ${config.checkpointThreshold}`
      );
    }
    this.config = config;
    // Install a default no-op 'error' listener to prevent Node.js from throwing
    // unhandled error events when no operator has attached a listener.
    // Operators may replace this with a real listener via onCheckpointError().
    this.on('error', () => {
      // Default: silently swallow. Operator should attach a real listener.
    });
  }

  /**
   * Increments the interaction counter for the given pet.
   * Returns true if the threshold is reached (checkpoint should fire) and resets
   * the counter to 0. Returns false otherwise.
   */
  recordInteraction(blobbiId: string): boolean {
    const current = this.counters.get(blobbiId) ?? 0;
    const next = current + 1;
    if (next >= this.config.checkpointThreshold) {
      this.counters.set(blobbiId, 0);
      return true;
    }
    this.counters.set(blobbiId, next);
    return false;
  }

  /**
   * Returns the current interaction count for a pet (0 if unknown).
   */
  getInteractionCount(blobbiId: string): number {
    return this.counters.get(blobbiId) ?? 0;
  }

  /** Listen for successful checkpoint uploads. */
  onCheckpoint(listener: (evt: CheckpointEvent) => void): this {
    return this.on('checkpoint', listener);
  }

  /** Listen for non-fatal checkpoint errors. */
  onCheckpointError(listener: (err: CheckpointError) => void): this {
    return this.on('error', listener);
  }

  /**
   * Uploads the .mv2 brain file for the given pet to Arweave.
   * Emits 'checkpoint' on success, 'error' on failure (non-fatal).
   * Never throws — errors are always surfaced via the 'error' event.
   *
   * @param blobbiId - The pet identifier (used to locate <blobbiId>.mv2)
   * @param brainHash - BLAKE3 hash of the current committed brain state
   * @returns CheckpointResult on success, undefined on failure
   */
  async checkpoint(
    blobbiId: string,
    brainHash: string
  ): Promise<CheckpointResult | undefined> {
    const brainPath = path.join(
      this.config.brainStoragePath,
      `${blobbiId}.mv2`
    );

    let buffer: Buffer;
    try {
      buffer = await readFile(brainPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit(
          'error',
          new CheckpointError(
            `Brain file not found: ${brainPath}`,
            blobbiId,
            'FILE_NOT_FOUND'
          )
        );
      } else {
        this.emit(
          'error',
          new CheckpointError(
            `Failed to read brain file: ${brainPath}`,
            blobbiId,
            'UPLOAD_FAILED'
          )
        );
      }
      return undefined;
    }

    // Compose tags: caller-supplied tags first, mandatory tags override
    const tags: Record<string, string> = {
      ...this.config.arweaveTags,
      'Content-Type': 'application/octet-stream',
      'Pet-Brain-Id': blobbiId,
      'Brain-Hash': brainHash,
      'Checkpoint-Timestamp': String(Date.now()),
    };

    try {
      const { txId } = await this.config.arweaveAdapter.upload(buffer, tags);
      const timestamp = Date.now();
      const result: CheckpointResult = { blobbiId, txId, brainHash, timestamp };
      this.emit('checkpoint', result);
      return result;
    } catch {
      this.emit(
        'error',
        new CheckpointError(
          `Arweave upload failed for pet ${blobbiId}`,
          blobbiId,
          'UPLOAD_FAILED'
        )
      );
      return undefined;
    }
  }
}
