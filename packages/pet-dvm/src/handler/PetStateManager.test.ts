/**
 * PetStateManager — Unit Tests (TDD RED PHASE)
 *
 * Story 11-5: Pet DVM Handler
 *
 * AC coverage:
 *   AC-3: Pet state management — in-memory Map with getOrCreate/save/get
 *   AC-10: PetStateManager tests
 *
 * All tests use it() — TDD red phase. Remove .skip after implementation.
 */

import { PetStateManager } from './PetStateManager';
import type { PetEngineState } from '../engine/types';
import { ACTION_COUNT, Stage } from '@toon-protocol/pet-circuit';

// ============================================================
// Tests
// ============================================================

describe('PetStateManager', () => {
  let manager: PetStateManager;

  beforeEach(() => {
    manager = new PetStateManager();
  });

  it('should return genesis state for unknown blobbiId via getOrCreate', () => {
    // Given a PetStateManager with no stored state
    // When getOrCreate is called with a new blobbiId
    const state = manager.getOrCreate('blobbi-new');

    // Then returns genesis state: all stats 100, stage EGG, cycle 0, brainHash all zeros
    expect(state.stats.hunger).toBe(100);
    expect(state.stats.happiness).toBe(100);
    expect(state.stats.health).toBe(100);
    expect(state.stats.hygiene).toBe(100);
    expect(state.stats.energy).toBe(100);
    expect(state.stage).toBe(Stage.EGG);
    expect(state.cycle).toBe(0);
    expect(state.lastInteraction).toBe(0);
    expect(state.brainHash).toBe('0'.repeat(64));
    expect(state.cooldownTimestamps).toHaveLength(ACTION_COUNT);
  });

  it('should round-trip state correctly via save + get', () => {
    // Given a modified pet state
    const modifiedState: PetEngineState = {
      stats: { hunger: 75, happiness: 60, health: 90, hygiene: 50, energy: 80 },
      stage: Stage.BABY,
      cycle: 5,
      lastInteraction: 1712345678,
      cooldownTimestamps: new Array(ACTION_COUNT).fill(1000) as number[],
      brainHash: 'a'.repeat(64),
    };

    // When saved and retrieved
    manager.save('blobbi-modified', modifiedState);
    const retrieved = manager.get('blobbi-modified');

    // Then retrieved state matches saved state
    expect(retrieved).toBeDefined();
    expect(retrieved!.stats.hunger).toBe(75);
    expect(retrieved!.stats.happiness).toBe(60);
    expect(retrieved!.stage).toBe(Stage.BABY);
    expect(retrieved!.cycle).toBe(5);
    expect(retrieved!.brainHash).toBe('a'.repeat(64));
  });

  it('should store multiple pets independently', () => {
    // Given two different pets with different states
    const state1: PetEngineState = {
      stats: { hunger: 50, happiness: 50, health: 50, hygiene: 50, energy: 50 },
      stage: Stage.EGG,
      cycle: 1,
      lastInteraction: 1000,
      cooldownTimestamps: new Array(ACTION_COUNT).fill(0) as number[],
      brainHash: '1'.repeat(64),
    };
    const state2: PetEngineState = {
      stats: { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 90 },
      stage: Stage.ADULT,
      cycle: 100,
      lastInteraction: 2000,
      cooldownTimestamps: new Array(ACTION_COUNT).fill(500) as number[],
      brainHash: '2'.repeat(64),
    };

    // When both are saved
    manager.save('pet-alpha', state1);
    manager.save('pet-beta', state2);

    // Then each retrieves its own state independently
    const alpha = manager.get('pet-alpha');
    const beta = manager.get('pet-beta');

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha!.cycle).toBe(1);
    expect(beta!.cycle).toBe(100);
    expect(alpha!.stage).toBe(Stage.EGG);
    expect(beta!.stage).toBe(Stage.ADULT);
  });
});
