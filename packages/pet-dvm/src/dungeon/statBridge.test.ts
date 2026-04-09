/**
 * StatBridge tests
 *
 * Covers AC-4 and AC-6 through AC-9 from Story 11-16 (Pet-Dungeon Stat Bridge):
 *   - AC-4: clampStatValues helper (3 tests)
 *   - AC-6: Unit tests — stat mapping (5 tests)
 *   - AC-7: Unit tests — boundary cases (4 tests)
 *   - AC-8: Unit tests — stat deltas within [1,100] bounds using real DungeonGameEngine (3 tests)
 *   - AC-9: Cross-verify tests — dungeonDeltaToGameAction ActionType resolution (7 tests)
 *   - Supplemental: immutability + StatBridgeError.name (2 tests)
 *   - Supplemental: clampStatValues NaN behavior (1 test)
 *   - Supplemental: applyDungeonDeltaToStats NaN currentStats (1 test)
 *
 * Total: 27 tests
 *
 * Uses Jest + ts-jest (not Vitest). All tests are self-contained.
 * Fixed seeds are used for deterministic engine-driven tests (AC-8).
 */

import {
  DungeonGameEngine,
  DEFAULT_MONSTER_TABLE,
  DEFAULT_LOOT_TABLE,
} from './DungeonGameEngine';
import type { DungeonRunResult, DungeonStatDelta } from './types';
import type { StatValues } from '../engine/types';

import {
  petStatsToDungeonStats,
  applyDungeonDeltaToStats,
  clampStatValues,
  dungeonDeltaToGameAction,
  StatBridgeError,
} from './statBridge';
import { ActionType } from '@toon-protocol/pet-circuit';

// ============================================================
// Test Helpers / Factories
// ============================================================

function makeStatValues(overrides: Partial<StatValues> = {}): StatValues {
  return {
    hunger: 60,
    happiness: 70,
    health: 80,
    hygiene: 50,
    energy: 90,
    ...overrides,
  };
}

function makeZeroDelta(
  overrides: Partial<DungeonStatDelta> = {}
): DungeonStatDelta {
  return {
    hunger: 0,
    happiness: 0,
    health: 0,
    hygiene: 0,
    energy: 0,
    ...overrides,
  };
}

/**
 * Build a minimal DungeonRunResult stub for AC-9 cross-verify tests.
 * Controls `encounters` and `statDeltas` precisely to drive ActionType branches.
 */
function makeDungeonRunResult(
  overrides: Partial<DungeonRunResult> = {}
): DungeonRunResult {
  return {
    seed: 'test-seed',
    dungeonType: 'digger',
    roomsGenerated: 5,
    roomsVisited: 3,
    floorsReached: 1,
    encounters: [],
    lootFound: [],
    statDeltas: makeZeroDelta(),
    narrativeSummary: 'Your pet explored the dungeon.',
    durationMs: 10,
    ...overrides,
  };
}

// ============================================================
// AC-6: Unit tests — stat mapping (5 tests)
// ============================================================

describe('petStatsToDungeonStats — stat mapping (AC-6)', () => {
  test('[P0] maps maxed stats (all 100) to identical DungeonPetStats', () => {
    const petStats = makeStatValues({
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    });
    const result = petStatsToDungeonStats(petStats);
    expect(result.hunger).toBe(100);
    expect(result.happiness).toBe(100);
    expect(result.health).toBe(100);
    expect(result.hygiene).toBe(100);
    expect(result.energy).toBe(100);
  });

  test('[P0] maps minimum stats (all 1) to identical DungeonPetStats', () => {
    const petStats = makeStatValues({
      hunger: 1,
      happiness: 1,
      health: 1,
      hygiene: 1,
      energy: 1,
    });
    const result = petStatsToDungeonStats(petStats);
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });

  test('[P0] maps mixed stats field-by-field (1:1 pass-through)', () => {
    const petStats = makeStatValues({
      hunger: 42,
      happiness: 77,
      health: 15,
      hygiene: 99,
      energy: 33,
    });
    const result = petStatsToDungeonStats(petStats);
    expect(result.hunger).toBe(42);
    expect(result.happiness).toBe(77);
    expect(result.health).toBe(15);
    expect(result.hygiene).toBe(99);
    expect(result.energy).toBe(33);
  });

  test('[P1] throws StatBridgeError INVALID_STATS when a field is 101 (out of range)', () => {
    expect.assertions(2);
    const petStats = makeStatValues({ hunger: 101 });
    try {
      petStatsToDungeonStats(petStats);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_STATS');
    }
  });

  test('[P1] throws StatBridgeError INVALID_STATS when a field is NaN', () => {
    expect.assertions(2);
    const petStats = makeStatValues({ happiness: NaN });
    try {
      petStatsToDungeonStats(petStats);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_STATS');
    }
  });
});

// ============================================================
// AC-7: Unit tests — boundary cases (4 tests)
// ============================================================

describe('applyDungeonDeltaToStats — boundary cases (AC-7)', () => {
  test('[P0] large negative deltas clamp all stats to minimum 1', () => {
    const currentStats = makeStatValues({
      hunger: 10,
      happiness: 5,
      health: 20,
      hygiene: 1,
      energy: 15,
    });
    const delta: DungeonStatDelta = {
      hunger: -200,
      happiness: -200,
      health: -200,
      hygiene: -200,
      energy: -200,
    };
    const result = applyDungeonDeltaToStats(currentStats, delta);
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });

  test('[P0] large positive deltas clamp all stats to maximum 100', () => {
    const currentStats = makeStatValues({
      hunger: 90,
      happiness: 95,
      health: 80,
      hygiene: 99,
      energy: 85,
    });
    const delta: DungeonStatDelta = {
      hunger: 200,
      happiness: 200,
      health: 200,
      hygiene: 200,
      energy: 200,
    };
    const result = applyDungeonDeltaToStats(currentStats, delta);
    expect(result.hunger).toBe(100);
    expect(result.happiness).toBe(100);
    expect(result.health).toBe(100);
    expect(result.hygiene).toBe(100);
    expect(result.energy).toBe(100);
  });

  test('[P0] zero deltas leave stats unchanged', () => {
    const currentStats = makeStatValues({
      hunger: 60,
      happiness: 70,
      health: 80,
      hygiene: 50,
      energy: 90,
    });
    const delta = makeZeroDelta();
    const result = applyDungeonDeltaToStats(currentStats, delta);
    expect(result.hunger).toBe(60);
    expect(result.happiness).toBe(70);
    expect(result.health).toBe(80);
    expect(result.hygiene).toBe(50);
    expect(result.energy).toBe(90);
  });

  test('[P1] throws StatBridgeError INVALID_DELTA when a delta field is NaN', () => {
    expect.assertions(2);
    const currentStats = makeStatValues();
    const delta = makeZeroDelta({ health: NaN });
    try {
      applyDungeonDeltaToStats(currentStats, delta);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_DELTA');
    }
  });

  test('[P1] throws StatBridgeError INVALID_DELTA when a delta field is Infinity', () => {
    expect.assertions(2);
    const currentStats = makeStatValues();
    const delta = makeZeroDelta({ energy: Infinity });
    try {
      applyDungeonDeltaToStats(currentStats, delta);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_DELTA');
    }
  });
});

// ============================================================
// AC-8: Unit tests — stat deltas within [1,100] bounds (3 tests)
// Uses real DungeonGameEngine with fixed seeds for determinism.
// ============================================================

describe('applyDungeonDeltaToStats — stat deltas within [1,100] bounds (AC-8)', () => {
  const engine = new DungeonGameEngine({
    width: 40,
    height: 30,
    maxRooms: 8,
    dungeonType: 'digger',
    monsterTable: DEFAULT_MONSTER_TABLE,
    lootTable: DEFAULT_LOOT_TABLE,
  });

  test('[P0] typical stats: real engine run produces all-finite stats in [1,100]', () => {
    const petStats: StatValues = {
      hunger: 60,
      happiness: 70,
      health: 80,
      hygiene: 50,
      energy: 90,
    };
    const dungeonStats = petStatsToDungeonStats(petStats);
    const result = engine.run('test-seed-bridge', dungeonStats);
    const afterStats = applyDungeonDeltaToStats(petStats, result.statDeltas);

    expect(Number.isFinite(afterStats.hunger)).toBe(true);
    expect(afterStats.hunger).toBeGreaterThanOrEqual(1);
    expect(afterStats.hunger).toBeLessThanOrEqual(100);

    expect(Number.isFinite(afterStats.happiness)).toBe(true);
    expect(afterStats.happiness).toBeGreaterThanOrEqual(1);
    expect(afterStats.happiness).toBeLessThanOrEqual(100);

    expect(Number.isFinite(afterStats.health)).toBe(true);
    expect(afterStats.health).toBeGreaterThanOrEqual(1);
    expect(afterStats.health).toBeLessThanOrEqual(100);

    expect(Number.isFinite(afterStats.hygiene)).toBe(true);
    expect(afterStats.hygiene).toBeGreaterThanOrEqual(1);
    expect(afterStats.hygiene).toBeLessThanOrEqual(100);

    expect(Number.isFinite(afterStats.energy)).toBe(true);
    expect(afterStats.energy).toBeGreaterThanOrEqual(1);
    expect(afterStats.energy).toBeLessThanOrEqual(100);
  });

  test('[P0] minimum stats (all 1): result stays >= 1 after clamping', () => {
    const petStats: StatValues = {
      hunger: 1,
      happiness: 1,
      health: 1,
      hygiene: 1,
      energy: 1,
    };
    const dungeonStats = petStatsToDungeonStats(petStats);
    const result = engine.run('test-seed-bridge-min', dungeonStats);
    const afterStats = applyDungeonDeltaToStats(petStats, result.statDeltas);

    expect(afterStats.hunger).toBeGreaterThanOrEqual(1);
    expect(afterStats.happiness).toBeGreaterThanOrEqual(1);
    expect(afterStats.health).toBeGreaterThanOrEqual(1);
    expect(afterStats.hygiene).toBeGreaterThanOrEqual(1);
    expect(afterStats.energy).toBeGreaterThanOrEqual(1);
  });

  test('[P0] maximum stats (all 100): result stays <= 100 after clamping', () => {
    const petStats: StatValues = {
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    };
    const dungeonStats = petStatsToDungeonStats(petStats);
    const result = engine.run('test-seed-bridge-max', dungeonStats);
    const afterStats = applyDungeonDeltaToStats(petStats, result.statDeltas);

    expect(afterStats.hunger).toBeLessThanOrEqual(100);
    expect(afterStats.happiness).toBeLessThanOrEqual(100);
    expect(afterStats.health).toBeLessThanOrEqual(100);
    expect(afterStats.hygiene).toBeLessThanOrEqual(100);
    expect(afterStats.energy).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// AC-9: Cross-verify tests — dungeonDeltaToGameAction (4 tests)
// Uses hand-crafted DungeonRunResult stubs for deterministic ActionType coverage.
// Does NOT rely on live engine output.
// ============================================================

describe('dungeonDeltaToGameAction — ActionType resolution (AC-9)', () => {
  const currentStats = makeStatValues();
  const timestamp = 1712700000000; // fixed timestamp: 2024-04-09T20:00:00.000Z

  test('[P0] wins > losses → returns ActionType.PLAY', () => {
    // 3 wins, 1 loss → majority won
    const result = makeDungeonRunResult({
      encounters: [
        {
          monsterId: 'm1',
          monsterName: 'Slime',
          petWon: true,
          damageDealt: 10,
          damageTaken: 5,
        },
        {
          monsterId: 'm2',
          monsterName: 'Goblin',
          petWon: true,
          damageDealt: 15,
          damageTaken: 8,
        },
        {
          monsterId: 'm3',
          monsterName: 'Rat',
          petWon: true,
          damageDealt: 8,
          damageTaken: 3,
        },
        {
          monsterId: 'm4',
          monsterName: 'Orc',
          petWon: false,
          damageDealt: 5,
          damageTaken: 20,
        },
      ],
      statDeltas: makeZeroDelta({ health: -5 }),
    });
    const action = dungeonDeltaToGameAction(result, currentStats, timestamp);
    expect(action.actionType).toBe(ActionType.PLAY);
    expect(action.itemId).toBe(0);
    expect(action.tokenCost).toBe(0);
    expect(action.timestamp).toBe(timestamp);
  });

  test('[P1] wins <= losses AND positive health delta → returns ActionType.MEDICINE', () => {
    // 1 win, 2 losses → not majority won; health delta > 0 → MEDICINE
    const result = makeDungeonRunResult({
      encounters: [
        {
          monsterId: 'm1',
          monsterName: 'Slime',
          petWon: true,
          damageDealt: 10,
          damageTaken: 5,
        },
        {
          monsterId: 'm2',
          monsterName: 'Goblin',
          petWon: false,
          damageDealt: 3,
          damageTaken: 15,
        },
        {
          monsterId: 'm3',
          monsterName: 'Orc',
          petWon: false,
          damageDealt: 2,
          damageTaken: 18,
        },
      ],
      statDeltas: makeZeroDelta({ health: 10 }), // positive health delta → MEDICINE
    });
    const action = dungeonDeltaToGameAction(result, currentStats, timestamp);
    expect(action.actionType).toBe(ActionType.MEDICINE);
    expect(action.itemId).toBe(0);
    expect(action.tokenCost).toBe(0);
  });

  test('[P2] no encounters, zero health delta → returns ActionType.REST', () => {
    // No encounters, no health change → default REST
    const result = makeDungeonRunResult({
      encounters: [],
      statDeltas: makeZeroDelta(), // health delta = 0 → REST
    });
    const action = dungeonDeltaToGameAction(result, currentStats, timestamp);
    expect(action.actionType).toBe(ActionType.REST);
    expect(action.itemId).toBe(0);
    expect(action.tokenCost).toBe(0);
  });

  test('[P1] invalid timestamp (NaN) → throws StatBridgeError INVALID_TIMESTAMP', () => {
    expect.assertions(2);
    const result = makeDungeonRunResult();
    try {
      dungeonDeltaToGameAction(result, currentStats, NaN);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_TIMESTAMP');
    }
  });

  test('[P1] invalid timestamp (negative) → throws StatBridgeError INVALID_TIMESTAMP', () => {
    expect.assertions(2);
    const result = makeDungeonRunResult();
    try {
      dungeonDeltaToGameAction(result, currentStats, -1);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_TIMESTAMP');
    }
  });

  test('[P1] invalid timestamp (zero) → throws StatBridgeError INVALID_TIMESTAMP', () => {
    expect.assertions(2);
    const result = makeDungeonRunResult();
    try {
      dungeonDeltaToGameAction(result, currentStats, 0);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_TIMESTAMP');
    }
  });

  test('[P1] tied encounter count (equal wins and losses) falls through to MEDICINE/REST branch', () => {
    // 2 wins, 2 losses → NOT majority won; health delta > 0 → MEDICINE (not PLAY)
    const result = makeDungeonRunResult({
      encounters: [
        {
          monsterId: 'm1',
          monsterName: 'Slime',
          petWon: true,
          damageDealt: 10,
          damageTaken: 5,
        },
        {
          monsterId: 'm2',
          monsterName: 'Goblin',
          petWon: true,
          damageDealt: 10,
          damageTaken: 5,
        },
        {
          monsterId: 'm3',
          monsterName: 'Orc',
          petWon: false,
          damageDealt: 3,
          damageTaken: 15,
        },
        {
          monsterId: 'm4',
          monsterName: 'Troll',
          petWon: false,
          damageDealt: 2,
          damageTaken: 18,
        },
      ],
      statDeltas: makeZeroDelta({ health: 5 }), // positive health delta → MEDICINE
    });
    const action = dungeonDeltaToGameAction(result, currentStats, timestamp);
    expect(action.actionType).toBe(ActionType.MEDICINE);
    expect(action.itemId).toBe(0);
    expect(action.tokenCost).toBe(0);
  });
});

// ============================================================
// AC-4: clampStatValues helper (3 tests)
// The story specifies clampStatValues is a public export used by callers who
// construct StatValues from external data. It has no validation — only clamping.
// ============================================================

describe('clampStatValues — clamping helper (AC-4)', () => {
  test('[P0] clamps values above 100 to 100', () => {
    const stats: StatValues = {
      hunger: 150,
      happiness: 200,
      health: 101,
      hygiene: 999,
      energy: 105,
    };
    const result = clampStatValues(stats);
    expect(result.hunger).toBe(100);
    expect(result.happiness).toBe(100);
    expect(result.health).toBe(100);
    expect(result.hygiene).toBe(100);
    expect(result.energy).toBe(100);
  });

  test('[P0] clamps values below 1 to 1', () => {
    const stats: StatValues = {
      hunger: 0,
      happiness: -50,
      health: -1,
      hygiene: -100,
      energy: 0,
    };
    const result = clampStatValues(stats);
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });

  test('[P0] passes through valid in-range values unchanged', () => {
    const stats: StatValues = {
      hunger: 42,
      happiness: 77,
      health: 1,
      hygiene: 100,
      energy: 55,
    };
    const result = clampStatValues(stats);
    expect(result.hunger).toBe(42);
    expect(result.happiness).toBe(77);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(100);
    expect(result.energy).toBe(55);
  });
});

// ============================================================
// AC-3 / AC-5 supplemental: immutability + StatBridgeError.name (2 tests)
// AC-3 specifies "does not mutate input"; AC-5 specifies name = 'StatBridgeError'.
// ============================================================

describe('immutability and StatBridgeError.name', () => {
  test('[P1] applyDungeonDeltaToStats does not mutate currentStats or delta inputs', () => {
    const original: StatValues = {
      hunger: 60,
      happiness: 70,
      health: 80,
      hygiene: 50,
      energy: 90,
    };
    const frozen = Object.freeze({ ...original });
    const delta = makeZeroDelta({ health: -10 });
    const frozenDelta = Object.freeze({ ...delta });

    const result = applyDungeonDeltaToStats(frozen, frozenDelta);

    // Input objects unchanged
    expect(frozen.hunger).toBe(60);
    expect(frozen.health).toBe(80);
    expect(frozenDelta.health).toBe(-10);

    // Result is a new object with correct values
    expect(result.health).toBe(70);
    expect(result).not.toBe(frozen);
  });

  test('[P1] StatBridgeError has name === "StatBridgeError" for correct error identity', () => {
    expect.assertions(3);
    try {
      petStatsToDungeonStats(makeStatValues({ hunger: 0 }));
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).name).toBe('StatBridgeError');
      expect((err as StatBridgeError).code).toBe('INVALID_STATS');
    }
  });
});

// ============================================================
// Supplemental: clampStatValues NaN behavior (1 test)
// Documents and guards the NaN-→-1 clamping behaviour.
// ============================================================

describe('clampStatValues — NaN handling (supplemental)', () => {
  test('[P1] NaN fields are clamped to 1 (minimum)', () => {
    const stats: StatValues = {
      hunger: NaN,
      happiness: NaN,
      health: NaN,
      hygiene: NaN,
      energy: NaN,
    };
    const result = clampStatValues(stats);
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });
});

// ============================================================
// Supplemental: applyDungeonDeltaToStats validates currentStats (1 test)
// Guards the H-1 fix: NaN currentStats must throw INVALID_STATS,
// not silently produce NaN output.
// ============================================================

describe('applyDungeonDeltaToStats — currentStats validation (supplemental)', () => {
  test('[P1] throws StatBridgeError INVALID_STATS when currentStats field is NaN', () => {
    expect.assertions(2);
    const currentStats = makeStatValues({ health: NaN });
    const delta = makeZeroDelta();
    try {
      applyDungeonDeltaToStats(currentStats, delta);
    } catch (err) {
      expect(err).toBeInstanceOf(StatBridgeError);
      expect((err as StatBridgeError).code).toBe('INVALID_STATS');
    }
  });
});
