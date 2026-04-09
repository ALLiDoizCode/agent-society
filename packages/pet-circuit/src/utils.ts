/* eslint-disable @typescript-eslint/no-non-null-assertion -- bounds-checked constant table lookups */
/**
 * PetLifecycle ZkProgram -- Utility Functions
 *
 * Circuit-compatible utility functions for stat clamping, decay computation,
 * action effect application, cooldown checking, and BLAKE3-to-Field conversion.
 *
 * All arithmetic uses o1js provable types (UInt32, UInt64, Field) for in-circuit use.
 *
 * @module utils
 */

import type { Bool } from 'o1js';
import { Field, UInt32, Provable } from 'o1js';
import {
  DECAY_RATES,
  EGG_HAPPINESS_RATES,
  EGG_HEALTH_PENALTIES,
  BABY_HEALTH_PENALTIES,
  ADULT_HEALTH_PENALTIES,
  COOLDOWN_DURATIONS,
  STAGE_ALLOWED_ACTIONS,
  BASE_ACTION_EFFECTS,
  SHOP_ITEMS,
  Stage,
} from './constants';
import type { PetStats } from './structs';

// ============================================================
// BLAKE3-to-Field Conversion (AC-15)
// ============================================================

/**
 * Convert a 256-bit BLAKE3 hex hash to a Mina Field element.
 * Truncates to 253 bits by clearing the top 3 bits of the first byte,
 * guaranteeing the result is less than the Pasta field modulus.
 *
 * Security: 126.5 bits collision resistance (exceeds Mina's ~128-bit security).
 * The mapping is injective (no collisions from modular reduction).
 *
 * @param hexHash - 64-character hex string (256 bits)
 * @returns Field element (253 bits)
 */
export function blake3ToField(hexHash: string): Field {
  if (hexHash.length !== 64) {
    throw new Error(
      `blake3ToField: expected 64-char hex, got ${hexHash.length}`
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(hexHash)) {
    throw new Error('blake3ToField: input contains non-hex characters');
  }
  const digest = Buffer.from(hexHash, 'hex');
  // Clear top 3 bits -> 253 bits, guarantees value < p (Pasta field modulus)
  digest[0]! &= 0x1f;
  const bigint = BigInt('0x' + digest.toString('hex'));
  return Field(bigint);
}

// ============================================================
// Stat Clamping (AC-8)
// ============================================================

/**
 * Clamp a UInt32 value to the range [1, 100] inside a circuit.
 * Uses Provable.if for branch-free conditional selection.
 */
export function clampStat(value: UInt32): UInt32 {
  const tooLow = value.lessThan(UInt32.from(1));
  const tooHigh = value.greaterThan(UInt32.from(100));
  return Provable.if(
    tooLow,
    UInt32,
    UInt32.from(1),
    Provable.if(tooHigh, UInt32, UInt32.from(100), value)
  );
}

// ============================================================
// Decay Computation (AC-8)
// ============================================================

/**
 * Compute the decay delta for a stat given the scaled rate and elapsed seconds.
 * Formula: actualDelta = floor(scaledRate * elapsedSeconds / 360000)
 *
 * This is a plain-number computation used to derive expected values.
 * The circuit verifies the provided post-decay stats match.
 *
 * @param scaledRate - Rate scaled by 100 (e.g., -700 for -7.0/hr)
 * @param elapsedSeconds - Time elapsed in seconds
 * @returns Integer delta to apply to stat
 */
export function computeDecayDelta(
  scaledRate: number,
  elapsedSeconds: number
): number {
  // scaledDelta = scaledRate * elapsedSeconds
  // actualDelta = floor(scaledDelta / 360000)
  const scaledDelta = scaledRate * elapsedSeconds;
  return Math.floor(scaledDelta / 360000);
}

/**
 * Compute post-decay stats for a given stage and elapsed time.
 * Follows the canonical decay application order (Section 2.4):
 * 1. Apply hunger, happiness, hygiene, energy decay (independent)
 * 2. Compute health decay using POST-DECAY stat values
 * 3. Apply health decay
 *
 * @param stats - Current stat values (plain numbers)
 * @param stage - Pet stage (0=egg, 1=baby, 2=adult)
 * @param elapsedSeconds - Time elapsed since last interaction
 * @param isSleeping - Whether pet is sleeping (affects energy decay direction)
 * @returns Post-decay stat values (plain numbers, clamped to [1, 100])
 */
export function computeDecay(
  stats: {
    hunger: number;
    happiness: number;
    health: number;
    hygiene: number;
    energy: number;
  },
  stage: number,
  elapsedSeconds: number,
  isSleeping = false
): {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
} {
  const rates = DECAY_RATES[stage]!;
  const clamp = (v: number) => Math.max(1, Math.min(100, v));

  let hunger: number;
  let happiness: number;
  let hygiene: number;
  let energy: number;
  let health: number;

  if (stage === Stage.EGG) {
    // Egg: hunger and energy are fixed at 100
    hunger = 100;
    energy = 100;

    // Hygiene decays
    hygiene = clamp(
      stats.hygiene + computeDecayDelta(rates[2]!, elapsedSeconds)
    );

    // Egg happiness is conditional on health and hygiene (use pre-decay for happiness calc)
    // But we need post-decay hygiene for health penalty calc
    // Per Section 2.1: happiness conditions reference current values
    let happinessRate: number;
    if (stats.health >= 70 && stats.hygiene >= 70) {
      happinessRate = EGG_HAPPINESS_RATES.GOOD;
    } else if (stats.health >= 40 && stats.hygiene >= 40) {
      happinessRate = EGG_HAPPINESS_RATES.MODERATE;
    } else {
      happinessRate = EGG_HAPPINESS_RATES.POOR;
    }
    happiness = clamp(
      stats.happiness + computeDecayDelta(happinessRate, elapsedSeconds)
    );

    // Health: base + penalties based on POST-DECAY hygiene
    let healthRate = rates[5]!; // base: -100
    if (hygiene < 70) healthRate += EGG_HEALTH_PENALTIES.HYGIENE_BELOW_70;
    if (hygiene < 40) healthRate += EGG_HEALTH_PENALTIES.HYGIENE_BELOW_40;
    health = clamp(
      stats.health + computeDecayDelta(healthRate, elapsedSeconds)
    );
  } else {
    // Baby or Adult: standard decay
    // Step 1: non-health stats
    hunger = clamp(stats.hunger + computeDecayDelta(rates[0]!, elapsedSeconds));
    happiness = clamp(
      stats.happiness + computeDecayDelta(rates[1]!, elapsedSeconds)
    );
    hygiene = clamp(
      stats.hygiene + computeDecayDelta(rates[2]!, elapsedSeconds)
    );

    const energyRate = isSleeping ? rates[4]! : rates[3]!;
    energy = clamp(
      stats.energy + computeDecayDelta(energyRate, elapsedSeconds)
    );

    // Step 2: health with penalties based on POST-DECAY values
    let healthRate = rates[5]!; // base

    if (stage === Stage.BABY) {
      if (hunger < 70) healthRate += BABY_HEALTH_PENALTIES.HUNGER_BELOW_70;
      if (hunger < 40) healthRate += BABY_HEALTH_PENALTIES.HUNGER_BELOW_40;
      if (hygiene < 70) healthRate += BABY_HEALTH_PENALTIES.HYGIENE_BELOW_70;
      if (hygiene < 40) healthRate += BABY_HEALTH_PENALTIES.HYGIENE_BELOW_40;
      if (energy < 50) healthRate += BABY_HEALTH_PENALTIES.ENERGY_BELOW_50;
      if (energy < 25) healthRate += BABY_HEALTH_PENALTIES.ENERGY_BELOW_25;
      if (happiness < 50)
        healthRate += BABY_HEALTH_PENALTIES.HAPPINESS_BELOW_50;
      if (happiness < 25)
        healthRate += BABY_HEALTH_PENALTIES.HAPPINESS_BELOW_25;
      if (hunger >= 80 && happiness >= 80 && hygiene >= 80 && energy >= 80) {
        healthRate += BABY_HEALTH_PENALTIES.REGEN_ALL_ABOVE_80;
      }
    } else {
      // Adult
      if (hunger < 60) healthRate += ADULT_HEALTH_PENALTIES.HUNGER_BELOW_60;
      if (hunger < 30) healthRate += ADULT_HEALTH_PENALTIES.HUNGER_BELOW_30;
      if (hygiene < 60) healthRate += ADULT_HEALTH_PENALTIES.HYGIENE_BELOW_60;
      if (hygiene < 30) healthRate += ADULT_HEALTH_PENALTIES.HYGIENE_BELOW_30;
      if (energy < 40) healthRate += ADULT_HEALTH_PENALTIES.ENERGY_BELOW_40;
      if (energy < 20) healthRate += ADULT_HEALTH_PENALTIES.ENERGY_BELOW_20;
      if (happiness < 40)
        healthRate += ADULT_HEALTH_PENALTIES.HAPPINESS_BELOW_40;
      if (happiness < 20)
        healthRate += ADULT_HEALTH_PENALTIES.HAPPINESS_BELOW_20;
      if (hunger >= 80 && happiness >= 80 && hygiene >= 80 && energy >= 80) {
        healthRate += ADULT_HEALTH_PENALTIES.REGEN_ALL_ABOVE_80;
      }
    }

    health = clamp(
      stats.health + computeDecayDelta(healthRate, elapsedSeconds)
    );
  }

  return { hunger, happiness, health, hygiene, energy };
}

// ============================================================
// Action Effect Application (AC-10)
// ============================================================

/**
 * Apply action effects to stats (plain number computation).
 * Handles both base actions (itemId=0) and shop items.
 * Egg special rules: hunger and energy forced to 100 after application.
 *
 * @returns Post-action stats clamped to [1, 100]
 */
export function applyAction(
  stats: {
    hunger: number;
    happiness: number;
    health: number;
    hygiene: number;
    energy: number;
  },
  actionType: number,
  itemId: number,
  stage: number
): {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
} {
  const clamp = (v: number) => Math.max(1, Math.min(100, v));

  let effects: readonly number[];
  if (itemId === 0) {
    // Base action
    effects = BASE_ACTION_EFFECTS[actionType]!;
  } else {
    // Shop item
    const item = SHOP_ITEMS.find(
      (si) => si.actionType === actionType && si.itemId === itemId
    );
    if (!item) {
      throw new Error(
        `Unknown shop item: actionType=${actionType}, itemId=${itemId}`
      );
    }
    effects = item.effects;
  }

  let hunger = clamp(stats.hunger + effects[0]!);
  const happiness = clamp(stats.happiness + effects[1]!);
  const health = clamp(stats.health + effects[2]!);
  const hygiene = clamp(stats.hygiene + effects[3]!);
  let energy = clamp(stats.energy + effects[4]!);

  // Egg special rules (Section 3.4): hunger and energy forced to 100
  if (stage === Stage.EGG) {
    hunger = 100;
    energy = 100;
  }

  return { hunger, happiness, health, hygiene, energy };
}

// ============================================================
// Cooldown Checking (AC-9)
// ============================================================

/**
 * Check if enough time has elapsed since the last use of an action type.
 * Throws if the action is unavailable (cooldown = 0 = infinite) or cooldown not elapsed.
 *
 * @param actionType - Action type index (0-10)
 * @param stage - Pet stage (0-2)
 * @param currentTs - Current interaction timestamp (seconds)
 * @param lastTs - Timestamp of last use of this action type (0 = never used)
 */
export function checkCooldown(
  actionType: number,
  stage: number,
  currentTs: number,
  lastTs: number
): void {
  const cooldown = COOLDOWN_DURATIONS[stage]?.[actionType];
  if (cooldown === undefined || cooldown === 0) {
    throw new Error(
      `Action ${actionType} is unavailable for stage ${stage} (infinite cooldown)`
    );
  }
  if (lastTs > 0 && currentTs - lastTs < cooldown) {
    throw new Error(
      `Cooldown not elapsed for action ${actionType}: need ${cooldown}s, only ${currentTs - lastTs}s elapsed`
    );
  }
}

/**
 * Check if an action is allowed for a given stage.
 */
export function isActionAllowed(actionType: number, stage: number): boolean {
  return STAGE_ALLOWED_ACTIONS[stage]?.[actionType] === true;
}

// ============================================================
// In-Circuit Stat Verification Helpers
// ============================================================

/**
 * Verify that a UInt32 value is within [1, 100] range inside a circuit.
 * Asserts both lower and upper bounds.
 */
export function assertStatInRange(value: UInt32): void {
  value.assertGreaterThanOrEqual(UInt32.from(1));
  value.assertLessThanOrEqual(UInt32.from(100));
}

/**
 * Assert all stats in a PetStats struct are within [1, 100].
 */
export function assertAllStatsInRange(stats: PetStats): void {
  assertStatInRange(stats.hunger);
  assertStatInRange(stats.happiness);
  assertStatInRange(stats.health);
  assertStatInRange(stats.hygiene);
  assertStatInRange(stats.energy);
}

// ============================================================
// Circuit-Level Helpers for Conditional Arithmetic
// ============================================================

/**
 * In-circuit: conditionally add a value to a Field.
 * Returns base + (condition ? delta : 0)
 */
export function conditionalAdd(
  base: Field,
  condition: Bool,
  delta: Field
): Field {
  return base.add(Provable.if(condition, Field, delta, Field(0)));
}

/**
 * Create a UInt32 comparison check: value < threshold (in-circuit).
 */
export function isBelow(value: UInt32, threshold: number): Bool {
  return value.lessThan(UInt32.from(threshold));
}

/**
 * Create a UInt32 comparison check: value >= threshold (in-circuit).
 */
export function isAtLeast(value: UInt32, threshold: number): Bool {
  return value.greaterThanOrEqual(UInt32.from(threshold));
}
