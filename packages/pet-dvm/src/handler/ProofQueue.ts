/**
 * ProofQueue -- In-memory proof batch accumulator with EventEmitter.
 *
 * Accumulates ProofQueueEntry items and emits 'batch-ready' when the
 * configured batch size is reached. Proof generation itself is OUT OF SCOPE
 * for Story 11-5 (deferred to Story 11-7).
 *
 * Risk R-008: No WAL persistence in this story -- queue is lost on restart.
 *
 * @module handler/ProofQueue
 */

import { EventEmitter } from 'node:events';
import type { ProofQueueEntry } from './types';

/**
 * Maximum number of proof queue entries held in memory.
 * Prevents unbounded memory growth when no consumer is draining the queue.
 * Oldest entries are dropped when the limit is exceeded.
 */
const DEFAULT_MAX_QUEUE_SIZE = 10_000;

export class ProofQueue extends EventEmitter {
  private readonly entries: ProofQueueEntry[] = [];
  private readonly batchSize: number;
  private readonly maxSize: number;

  constructor(batchSize: number, maxSize: number = DEFAULT_MAX_QUEUE_SIZE) {
    super();
    this.batchSize = batchSize;
    this.maxSize = maxSize;
  }

  /** Add an entry to the queue. Emits 'batch-ready' when batchSize is reached. */
  push(entry: ProofQueueEntry): void {
    // Drop oldest entries if queue is at capacity to prevent unbounded growth
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();
    }
    this.entries.push(entry);
    if (this.entries.length >= this.batchSize) {
      this.emit('batch-ready');
    }
  }

  /**
   * Returns a batch of entries if the queue has at least the configured batchSize items.
   * Does NOT remove entries from the queue (use drain() for that).
   * Returns null if not enough entries.
   *
   * Uses the instance's configured batchSize for consistency with the
   * 'batch-ready' event threshold.
   */
  getBatch(): ProofQueueEntry[] | null {
    if (this.entries.length < this.batchSize) return null;
    return this.entries.slice(0, this.batchSize);
  }

  /** Returns the current queue depth. */
  size(): number {
    return this.entries.length;
  }

  /** Removes and returns all entries from the queue. */
  drain(): ProofQueueEntry[] {
    return this.entries.splice(0, this.entries.length);
  }
}
