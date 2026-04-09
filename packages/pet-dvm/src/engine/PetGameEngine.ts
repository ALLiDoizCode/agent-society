/**
 * PetGameEngine — Stateful TypeScript game engine mirroring PetLifecycle ZkProgram rules.
 *
 * This engine wraps the utility functions from @toon-protocol/pet-circuit into a stateful
 * class that processes interactions, computes decay, enforces cooldowns, and checks evolution.
 * It produces outputs identical to the ZkProgram circuit for the same inputs.
 *
 * @module PetGameEngine
 */

import type {
  PetEngineState,
  GameAction,
  InteractionResult,
  EvolutionResult,
  DecayResult,
  StatValues,
} from './types';
import { GameEngineError } from './types';
import {
  computeDecay,
  applyAction,
  checkCooldown,
  isActionAllowed,
  getRequiredTokenCost,
  EVOLUTION_THRESHOLDS,
  ACTION_COUNT,
  Stage,
} from '@toon-protocol/pet-circuit';

export class PetGameEngine {
  private state: PetEngineState;

  constructor(initialState: PetEngineState) {
    this.state = {
      ...initialState,
      stats: { ...initialState.stats },
      cooldownTimestamps: [...initialState.cooldownTimestamps],
    };
  }

  processInteraction(action: GameAction): InteractionResult {
    // 0. Timestamp sanity check — must be a finite positive number
    if (!Number.isFinite(action.timestamp) || action.timestamp < 0) {
      throw new GameEngineError(
        `Invalid timestamp: ${action.timestamp}. Must be a finite non-negative number.`,
        'TIMESTAMP_REGRESSION'
      );
    }

    // 0b. Timestamp monotonicity check
    if (action.timestamp <= this.state.lastInteraction) {
      throw new GameEngineError(
        `Timestamp ${action.timestamp} is not strictly greater than lastInteraction ${this.state.lastInteraction}`,
        'TIMESTAMP_REGRESSION'
      );
    }

    // 0c. Validate actionType is in valid range
    if (
      !Number.isInteger(action.actionType) ||
      action.actionType < 0 ||
      action.actionType >= ACTION_COUNT
    ) {
      throw new GameEngineError(
        `Invalid actionType: ${action.actionType}. Must be integer in [0, ${ACTION_COUNT - 1}].`,
        'INVALID_ACTION'
      );
    }

    // 1. Check stage allowance FIRST (produces INVALID_ACTION code)
    if (!isActionAllowed(action.actionType, this.state.stage)) {
      throw new GameEngineError(
        `Action ${action.actionType} not allowed for stage ${this.state.stage}`,
        'INVALID_ACTION'
      );
    }

    // 2. Check cooldown SECOND (produces COOLDOWN_ACTIVE code)
    try {
      checkCooldown(
        action.actionType,
        this.state.stage,
        action.timestamp,
        this.state.cooldownTimestamps[action.actionType] ?? 0
      );
    } catch {
      throw new GameEngineError(
        `Cooldown not elapsed for action ${action.actionType}`,
        'COOLDOWN_ACTIVE'
      );
    }

    // 3. Validate itemId is a non-negative integer
    if (!Number.isInteger(action.itemId) || action.itemId < 0) {
      throw new GameEngineError(
        `Invalid itemId: ${action.itemId}. Must be a non-negative integer.`,
        'INVALID_ACTION'
      );
    }

    // 4. Validate token cost (must be finite non-negative, then match expected)
    if (!Number.isFinite(action.tokenCost) || action.tokenCost < 0) {
      throw new GameEngineError(
        `Invalid tokenCost: ${action.tokenCost}. Must be a finite non-negative number.`,
        'TOKEN_COST_MISMATCH'
      );
    }
    let expectedCost: number;
    try {
      expectedCost = getRequiredTokenCost(action.actionType, action.itemId);
    } catch (_e) {
      throw new GameEngineError(
        `Unknown shop item: actionType=${action.actionType}, itemId=${action.itemId}`,
        'INVALID_ACTION'
      );
    }
    if (action.tokenCost !== expectedCost) {
      throw new GameEngineError(
        `Token cost mismatch: expected ${expectedCost}, got ${action.tokenCost}`,
        'TOKEN_COST_MISMATCH'
      );
    }

    // 4. Capture pre-decay stats
    const priorStats: StatValues = { ...this.state.stats };

    // 5. Compute elapsed time and apply decay
    const elapsedSeconds = action.timestamp - this.state.lastInteraction;
    const decayedStats = computeDecay(
      this.state.stats,
      this.state.stage,
      elapsedSeconds,
      action.isSleeping ?? false
    );

    // 6. Apply action effects to decayed stats
    let finalStats: {
      hunger: number;
      happiness: number;
      health: number;
      hygiene: number;
      energy: number;
    };
    try {
      finalStats = applyAction(
        decayedStats,
        action.actionType,
        action.itemId,
        this.state.stage
      );
    } catch (_e) {
      throw new GameEngineError(
        `Failed to apply action: actionType=${action.actionType}, itemId=${action.itemId}`,
        'INVALID_ACTION'
      );
    }

    // 7. Update internal state
    this.state.stats = { ...finalStats };
    this.state.cycle += 1;
    this.state.lastInteraction = action.timestamp;
    this.state.cooldownTimestamps[action.actionType] = action.timestamp;

    return {
      priorStats,
      decayedStats,
      finalStats,
      cycle: this.state.cycle,
      stage: this.state.stage,
      tokenCost: action.tokenCost,
    };
  }

  checkEvolution(): EvolutionResult | null {
    const { stats, stage, cycle } = this.state;

    if (stage === Stage.EGG) {
      const t = EVOLUTION_THRESHOLDS.HATCH;
      if (
        cycle >= t.minCycle &&
        stats.health >= t.minHealth &&
        stats.hygiene >= t.minHygiene &&
        stats.happiness >= t.minHappiness
      ) {
        return {
          canEvolve: true,
          fromStage: Stage.EGG,
          toStage: Stage.BABY,
          resetStats: {
            hunger: 100,
            happiness: 100,
            health: stats.health,
            hygiene: 100,
            energy: 100,
          },
        };
      }
    } else if (stage === Stage.BABY) {
      const t = EVOLUTION_THRESHOLDS.EVOLVE;
      if (
        cycle >= t.minCycle &&
        stats.hunger >= t.minHunger &&
        stats.happiness >= t.minHappiness &&
        stats.health >= t.minHealth &&
        stats.hygiene >= t.minHygiene &&
        stats.energy >= t.minEnergy
      ) {
        return {
          canEvolve: true,
          fromStage: Stage.BABY,
          toStage: Stage.ADULT,
          resetStats: { ...stats },
        };
      }
    }
    // Adult cannot evolve further
    return null;
  }

  evolve(): PetEngineState {
    const result = this.checkEvolution();
    if (!result) {
      throw new GameEngineError(
        'Evolution conditions not met',
        'EVOLUTION_NOT_READY'
      );
    }

    // Apply stage transition
    this.state.stage = result.toStage;
    this.state.stats = { ...result.resetStats };

    // Return a copy of the new state
    return this.getState();
  }

  applyDecayOnly(currentTimestamp: number, isSleeping = false): DecayResult {
    // Ensure timestamp is valid and not before lastInteraction
    const elapsedSeconds = Math.max(
      0,
      Number.isFinite(currentTimestamp)
        ? currentTimestamp - this.state.lastInteraction
        : 0
    );
    const decayedStats = computeDecay(
      this.state.stats,
      this.state.stage,
      elapsedSeconds,
      isSleeping
    );
    return { decayedStats, elapsedSeconds };
  }

  getState(): PetEngineState {
    return {
      ...this.state,
      stats: { ...this.state.stats },
      cooldownTimestamps: [...this.state.cooldownTimestamps],
    };
  }
}

/**
 * Factory: create a validated PetGameEngine instance.
 * Throws GameEngineError with code INVALID_STAGE if stage > 2,
 * or if any stat is outside [1, 100].
 */
export function createPetGameEngine(
  initialState: PetEngineState
): PetGameEngine {
  // Validate stage
  if (
    initialState.stage < 0 ||
    initialState.stage > 2 ||
    !Number.isInteger(initialState.stage)
  ) {
    throw new GameEngineError(
      `Invalid stage: ${initialState.stage}. Must be 0, 1, or 2.`,
      'INVALID_STAGE'
    );
  }

  // Validate cycle
  if (!Number.isInteger(initialState.cycle) || initialState.cycle < 0) {
    throw new GameEngineError(
      `Invalid cycle: ${initialState.cycle}. Must be a non-negative integer.`,
      'INVALID_STAGE'
    );
  }

  // Validate lastInteraction
  if (
    !Number.isFinite(initialState.lastInteraction) ||
    initialState.lastInteraction < 0
  ) {
    throw new GameEngineError(
      `Invalid lastInteraction: ${initialState.lastInteraction}. Must be a finite non-negative number.`,
      'INVALID_STAGE'
    );
  }

  // Validate cooldownTimestamps length
  if (
    !Array.isArray(initialState.cooldownTimestamps) ||
    initialState.cooldownTimestamps.length !== ACTION_COUNT
  ) {
    throw new GameEngineError(
      `cooldownTimestamps must be an array of length ${ACTION_COUNT}, got ${Array.isArray(initialState.cooldownTimestamps) ? initialState.cooldownTimestamps.length : 'non-array'}.`,
      'INVALID_STAGE'
    );
  }

  // Validate all cooldown timestamps are finite non-negative numbers
  for (let i = 0; i < initialState.cooldownTimestamps.length; i++) {
    const ts = initialState.cooldownTimestamps[i];
    if (ts === undefined || !Number.isFinite(ts) || ts < 0) {
      throw new GameEngineError(
        `cooldownTimestamps[${i}] is invalid: ${ts}. Must be a finite non-negative number.`,
        'INVALID_STAGE'
      );
    }
  }

  // Validate brainHash is a 64-character hex string
  if (
    typeof initialState.brainHash !== 'string' ||
    initialState.brainHash.length !== 64 ||
    !/^[0-9a-f]{64}$/i.test(initialState.brainHash)
  ) {
    throw new GameEngineError(
      `Invalid brainHash: must be a 64-character hex string.`,
      'INVALID_STAGE'
    );
  }

  // Validate all stats in [1, 100] and finite
  const statKeys: (keyof StatValues)[] = [
    'hunger',
    'happiness',
    'health',
    'hygiene',
    'energy',
  ];
  for (const key of statKeys) {
    const val = initialState.stats[key];
    if (!Number.isFinite(val) || val < 1 || val > 100) {
      throw new GameEngineError(
        `Stat ${key} out of range: ${val}. Must be a finite number in [1, 100].`,
        'INVALID_STAGE'
      );
    }
  }

  return new PetGameEngine(initialState);
}

/**
 * Returns the default genesis state for a new pet.
 */
export function createGenesisState(): PetEngineState {
  return {
    stats: {
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    },
    stage: Stage.EGG,
    cycle: 0,
    lastInteraction: 0,
    cooldownTimestamps: new Array(ACTION_COUNT).fill(0) as number[],
    brainHash: '0'.repeat(64),
  };
}
