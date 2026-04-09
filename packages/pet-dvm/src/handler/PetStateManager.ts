/**
 * PetStateManager -- In-memory pet state cache.
 *
 * Stores PetEngineState per blobbiId in a Map. Persisted state from on-chain
 * is deferred to future stories -- this is a simple in-memory cache.
 *
 * @module handler/PetStateManager
 */

import type { PetEngineState } from '../engine/types';
import { createGenesisState } from '../engine/PetGameEngine';

/**
 * Maximum number of pet states held in memory.
 * Prevents unbounded memory growth from unique blobbiId submissions.
 * Oldest entries are evicted (Map iteration order = insertion order).
 */
const DEFAULT_MAX_PETS = 10_000;

export class PetStateManager {
  private readonly states = new Map<string, PetEngineState>();
  private readonly maxPets: number;

  constructor(maxPets: number = DEFAULT_MAX_PETS) {
    this.maxPets = maxPets;
  }

  /**
   * Get existing state or create genesis state for a new pet.
   * Genesis state: all stats 100, stage EGG, cycle 0, brainHash all zeros.
   * Evicts the oldest entry if the cache is at capacity.
   */
  getOrCreate(blobbiId: string): PetEngineState {
    const existing = this.states.get(blobbiId);
    if (existing) return existing;

    // Evict oldest entry if at capacity (Map preserves insertion order)
    if (this.states.size >= this.maxPets) {
      const oldestKey = this.states.keys().next().value;
      if (oldestKey !== undefined) {
        this.states.delete(oldestKey);
      }
    }

    const genesis = createGenesisState();
    this.states.set(blobbiId, genesis);
    return genesis;
  }

  /** Update in-memory state for a pet. */
  save(blobbiId: string, state: PetEngineState): void {
    this.states.set(blobbiId, state);
  }

  /** Read-only lookup. Returns undefined if pet is unknown. */
  get(blobbiId: string): PetEngineState | undefined {
    return this.states.get(blobbiId);
  }
}
