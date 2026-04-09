/**
 * Pet Game Engine Type Definitions
 *
 * Type-only file — no implementation logic. These types define the contracts
 * for the PetGameEngine class and its methods.
 *
 * @module types
 */

// ============================================================
// Stat Values
// ============================================================

/** Plain-number stat values (all clamped to [1, 100]) */
export interface StatValues {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
}

// ============================================================
// Pet Engine State
// ============================================================

/** Full mutable state of a pet managed by the game engine */
export interface PetEngineState {
  stats: StatValues;
  stage: number;
  cycle: number;
  lastInteraction: number;
  cooldownTimestamps: number[];
  brainHash: string;
}

// ============================================================
// Game Action
// ============================================================

/** An interaction action submitted to the game engine */
export interface GameAction {
  actionType: number;
  itemId: number;
  timestamp: number;
  tokenCost: number;
  isSleeping?: boolean;
}

// ============================================================
// Result Types
// ============================================================

/** Result of processing an interaction */
export interface InteractionResult {
  priorStats: StatValues;
  decayedStats: StatValues;
  finalStats: StatValues;
  cycle: number;
  stage: number;
  tokenCost: number;
}

/** Result of checking evolution eligibility */
export interface EvolutionResult {
  canEvolve: boolean;
  fromStage: number;
  toStage: number;
  resetStats: StatValues;
}

/** Result of a decay-only preview */
export interface DecayResult {
  decayedStats: StatValues;
  elapsedSeconds: number;
}

// ============================================================
// Error Type
// ============================================================

/** Error codes for game engine failures */
export type GameEngineErrorCode =
  | 'INVALID_ACTION'
  | 'COOLDOWN_ACTIVE'
  | 'TIMESTAMP_REGRESSION'
  | 'EVOLUTION_NOT_READY'
  | 'INVALID_STAGE'
  | 'TOKEN_COST_MISMATCH';

/** Typed error thrown by the game engine */
export class GameEngineError extends Error {
  constructor(
    message: string,
    public readonly code: GameEngineErrorCode
  ) {
    super(message);
    this.name = 'GameEngineError';
    // Fix prototype chain for instanceof checks when extending built-in Error
    Object.setPrototypeOf(this, GameEngineError.prototype);
  }
}
