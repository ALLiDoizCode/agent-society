/**
 * ProofQueue — Unit Tests (TDD RED PHASE)
 *
 * Story 11-5: Pet DVM Handler
 *
 * AC coverage:
 *   AC-5: Proof queue — in-memory with push/getBatch/drain and EventEmitter
 *   AC-11: ProofQueue tests
 *
 * All tests use it() — TDD red phase. Remove .skip after implementation.
 */

import { ProofQueue } from './ProofQueue';
import type { ProofQueueEntry } from './types';
import type {
  PetEngineState,
  GameAction,
  InteractionResult,
} from '../engine/types';
import { ACTION_COUNT, Stage } from '@toon-protocol/pet-circuit';

// ============================================================
// Test Helpers
// ============================================================

/** Create a minimal ProofQueueEntry for testing */
function makeProofEntry(
  overrides: Partial<ProofQueueEntry> = {}
): ProofQueueEntry {
  const defaultStats = {
    hunger: 80,
    happiness: 80,
    health: 80,
    hygiene: 80,
    energy: 80,
  };

  const defaultState: PetEngineState = {
    stats: { ...defaultStats },
    stage: Stage.BABY,
    cycle: 1,
    lastInteraction: 1000,
    cooldownTimestamps: new Array(ACTION_COUNT).fill(0) as number[],
    brainHash: '0'.repeat(64),
  };

  const defaultAction: GameAction = {
    actionType: 0,
    itemId: 5,
    timestamp: 2000,
    tokenCost: 45,
  };

  const defaultResult: InteractionResult = {
    priorStats: { ...defaultStats },
    decayedStats: { ...defaultStats },
    finalStats: { ...defaultStats },
    cycle: 1,
    stage: Stage.BABY,
    tokenCost: 45,
  };

  return {
    blobbiId: 'blobbi-test',
    priorState: defaultState,
    newState: { ...defaultState, cycle: 2 },
    action: defaultAction,
    interactionResult: defaultResult,
    eventId: 'event-001',
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('ProofQueue', () => {
  it('should increment size when entries are pushed', () => {
    // Given an empty ProofQueue
    const queue = new ProofQueue(10);

    // When an entry is pushed
    queue.push(makeProofEntry());

    // Then size increments to 1
    expect(queue.size()).toBe(1);

    // And pushing another increments to 2
    queue.push(makeProofEntry({ blobbiId: 'blobbi-2' }));
    expect(queue.size()).toBe(2);
  });

  it('should return null from getBatch when queue is below batchSize', () => {
    // Given a ProofQueue with batchSize 5 containing 3 entries
    const queue = new ProofQueue(5);
    queue.push(makeProofEntry({ eventId: 'e1' }));
    queue.push(makeProofEntry({ eventId: 'e2' }));
    queue.push(makeProofEntry({ eventId: 'e3' }));

    // When getBatch is called
    const batch = queue.getBatch();

    // Then returns null (not enough entries)
    expect(batch).toBeNull();
  });

  it('should return entries from getBatch when queue reaches batchSize', () => {
    // Given a ProofQueue with batchSize 3 containing exactly 3 entries
    const queue = new ProofQueue(3);
    queue.push(makeProofEntry({ eventId: 'e1' }));
    queue.push(makeProofEntry({ eventId: 'e2' }));
    queue.push(makeProofEntry({ eventId: 'e3' }));

    // When getBatch is called (uses configured batchSize of 3)
    const batch = queue.getBatch();

    // Then returns all 3 entries
    expect(batch).not.toBeNull();
    expect(batch).toHaveLength(3);
    expect(batch?.[0]?.eventId).toBe('e1');
    expect(batch?.[2]?.eventId).toBe('e3');
  });

  it('should emit batch-ready event when batchSize is reached', () => {
    // Given a ProofQueue with batchSize 2
    const queue = new ProofQueue(2);
    const listener = jest.fn();
    queue.on('batch-ready', listener);

    // When enough entries are pushed to reach batchSize
    queue.push(makeProofEntry({ eventId: 'e1' }));
    expect(listener).not.toHaveBeenCalled(); // Not yet

    queue.push(makeProofEntry({ eventId: 'e2' }));

    // Then batch-ready event is emitted
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should drain all entries and empty the queue', () => {
    // Given a ProofQueue with 3 entries
    const queue = new ProofQueue(10);
    queue.push(makeProofEntry({ eventId: 'e1' }));
    queue.push(makeProofEntry({ eventId: 'e2' }));
    queue.push(makeProofEntry({ eventId: 'e3' }));
    expect(queue.size()).toBe(3);

    // When drain is called
    const drained = queue.drain();

    // Then all entries are returned and queue is empty
    expect(drained).toHaveLength(3);
    expect(drained[0]?.eventId).toBe('e1');
    expect(queue.size()).toBe(0);
  });
});
