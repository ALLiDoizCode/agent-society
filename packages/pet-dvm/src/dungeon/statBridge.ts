/**
 * Pet-Dungeon Stat Bridge
 *
 * Pure mapping functions that translate `StatValues` from the Pet Game Engine
 * into `DungeonPetStats` modifiers and clamp `DungeonStatDelta` results back
 * into valid `StatValues` bounds.
 *
 * This module is the seam between the ZK-circuit domain (StatValues) and the
 * dungeon-local domain (DungeonPetStats). It provides no state, no classes,
 * and no side effects — only typed, validated transformations.
 *
 * @module dungeon/statBridge
 */

import type { StatValues, GameAction } from '../engine/types';
import type { DungeonPetStats, DungeonStatDelta, DungeonRunResult } from './types';
import { ActionType } from '@toon-protocol/pet-circuit';

// ============================================================
// Error Types
// ============================================================

/** Error codes for stat bridge failures */
export type StatBridgeErrorCode =
  | 'INVALID_STATS'
  | 'INVALID_DELTA'
  | 'INVALID_TIMESTAMP';

/** Typed error thrown by stat bridge functions */
export class StatBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: StatBridgeErrorCode
  ) {
    super(message);
    this.name = 'StatBridgeError';
    // Fix prototype chain for instanceof checks when extending built-in Error
    Object.setPrototypeOf(this, StatBridgeError.prototype);
  }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Clamp a single numeric value to [1, 100].
 * NaN → 1, -Infinity → 1, Infinity → 100.
 */
function clampToRange(value: number): number {
  // NaN comparisons always return false, so handle it first
  if (Number.isNaN(value)) return 1;
  return Math.max(1, Math.min(100, value));
}

/** Validate that a StatValues object has all fields in [1, 100] and finite */
function validateStatValues(stats: StatValues): void {
  const fields: (keyof StatValues)[] = [
    'hunger',
    'happiness',
    'health',
    'hygiene',
    'energy',
  ];
  for (const field of fields) {
    const value = stats[field];
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      throw new StatBridgeError(
        `Invalid StatValues: field "${field}" = ${value} is outside [1, 100] or not finite`,
        'INVALID_STATS'
      );
    }
  }
}

/** Validate that a DungeonStatDelta object has all fields as finite numbers */
function validateStatDelta(delta: DungeonStatDelta): void {
  const fields: (keyof DungeonStatDelta)[] = [
    'hunger',
    'happiness',
    'health',
    'hygiene',
    'energy',
  ];
  for (const field of fields) {
    const value = delta[field];
    if (!Number.isFinite(value)) {
      throw new StatBridgeError(
        `Invalid DungeonStatDelta: field "${field}" = ${value} is not a finite number`,
        'INVALID_DELTA'
      );
    }
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Map StatValues from the Pet Game Engine into DungeonPetStats for dungeon use.
 *
 * For MVP, both types share the same five fields in [1, 100], so this is a
 * validated 1:1 pass-through. The DungeonGameEngine already implements all
 * stat-to-modifier formulas internally (e.g. `energy / 20` for depth,
 * `hunger * 0.5 + energy * 0.3 + 1` for combat power).
 *
 * Throws `StatBridgeError('INVALID_STATS')` if any field is outside [1, 100]
 * or not a finite number.
 */
export function petStatsToDungeonStats(petStats: StatValues): DungeonPetStats {
  validateStatValues(petStats);
  return {
    hunger: petStats.hunger,
    happiness: petStats.happiness,
    health: petStats.health,
    hygiene: petStats.hygiene,
    energy: petStats.energy,
  };
}

/**
 * Apply a DungeonStatDelta to current StatValues, clamping all results to [1, 100].
 *
 * Returns a new StatValues object — does not mutate inputs.
 * No stat can go below 1 or above 100 — this is the ZK circuit's enforced boundary.
 *
 * Throws `StatBridgeError('INVALID_STATS')` if any `currentStats` field is not a finite number.
 * Throws `StatBridgeError('INVALID_DELTA')` if any delta field is not a finite number.
 */
export function applyDungeonDeltaToStats(
  currentStats: StatValues,
  delta: DungeonStatDelta
): StatValues {
  validateStatValues(currentStats);
  validateStatDelta(delta);
  return {
    hunger: clampToRange(currentStats.hunger + delta.hunger),
    happiness: clampToRange(currentStats.happiness + delta.happiness),
    health: clampToRange(currentStats.health + delta.health),
    hygiene: clampToRange(currentStats.hygiene + delta.hygiene),
    energy: clampToRange(currentStats.energy + delta.energy),
  };
}

/**
 * Clamp all five fields of a StatValues object to [1, 100].
 *
 * Useful for callers who construct StatValues from external data.
 * Returns a new StatValues — does not mutate input.
 *
 * Non-finite values (NaN, Infinity, -Infinity) are treated as follows:
 * - `NaN` → clamped to `1` (treated as minimum, since NaN comparisons always return false)
 * - `Infinity` → clamped to `100`
 * - `-Infinity` → clamped to `1`
 *
 * Callers who need strict validation (rejecting NaN/out-of-range) should use
 * `petStatsToDungeonStats` instead, which throws `StatBridgeError('INVALID_STATS')`.
 */
export function clampStatValues(stats: StatValues): StatValues {
  return {
    hunger: clampToRange(stats.hunger),
    happiness: clampToRange(stats.happiness),
    health: clampToRange(stats.health),
    hygiene: clampToRange(stats.hygiene),
    energy: clampToRange(stats.energy),
  };
}

/**
 * Assemble a GameAction that conveys the semantic intent of a dungeon run.
 *
 * ActionType is resolved in the following priority order:
 * 1. Won majority of fights → PLAY
 * 2. Net positive health change → MEDICINE
 * 3. Default (exploration, fled, no encounters, or mixed) → REST
 *
 * Sets `tokenCost: 0` — dungeon effects bypass PET token cost (dungeon already
 * paid via ILP). This function is a data-assembly helper only — see Dev Notes
 * for the recommended composition pattern in Story 11-17.
 *
 * Throws `StatBridgeError('INVALID_TIMESTAMP')` if timestamp is not a finite
 * positive number.
 *
 * @param result - The full DungeonRunResult (encounter data drives ActionType)
 * @param _currentStats - Current pet StatValues (reserved for downstream Story 11-17 use; unused in MVP)
 * @param timestamp - Unix timestamp in ms (positive finite integer)
 */
export function dungeonDeltaToGameAction(
  result: DungeonRunResult,
  _currentStats: StatValues,
  timestamp: number
): GameAction {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new StatBridgeError(
      `Invalid timestamp: ${timestamp} is not a finite positive number`,
      'INVALID_TIMESTAMP'
    );
  }

  // Resolve ActionType by priority
  let actionType: (typeof ActionType)[keyof typeof ActionType];

  const winsCount = result.encounters.filter((e) => e.petWon).length;
  const totalEncounters = result.encounters.length;

  if (totalEncounters > 0 && winsCount > totalEncounters / 2) {
    // Priority 1: won majority of fights → PLAY
    actionType = ActionType.PLAY;
  } else if (result.statDeltas.health > 0) {
    // Priority 2: net positive health change → MEDICINE
    actionType = ActionType.MEDICINE;
  } else {
    // Priority 3: default (exploration, fled, no encounters, or mixed) → REST
    actionType = ActionType.REST;
  }

  // Note: _currentStats is intentionally unused in MVP — it is part of the
  // public API signature for downstream Story 11-17 compatibility (the
  // handler may need current stats for additional context when building the
  // state transition).

  return {
    actionType,
    itemId: 0,
    timestamp,
    tokenCost: 0,
    isSleeping: false,
  };
}
