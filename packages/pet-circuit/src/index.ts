/**
 * @toon-protocol/pet-circuit
 *
 * PetLifecycle ZkProgram -- ZK-proven pet game rules as o1js circuit constraints.
 * Every pet interaction is cryptographically proven correct and the proof chain
 * forms a verifiable pet biography.
 *
 * @module @toon-protocol/pet-circuit
 */

// Core structs
export { PetStats, PetAction, PetState } from './structs';

// ZkProgram and proof class
export {
  PetLifecycle,
  PetLifecycleProof,
  CooldownTimestamps,
} from './PetLifecycle';

// Constant tables
export {
  ActionType,
  ACTION_COUNT,
  Stage,
  STAGE_COUNT,
  MAX_CLOCK_SKEW,
  MAX_BATCH_WINDOW,
  DECAY_RATES,
  EGG_HAPPINESS_RATES,
  EGG_HEALTH_PENALTIES,
  BABY_HEALTH_PENALTIES,
  ADULT_HEALTH_PENALTIES,
  COOLDOWN_DURATIONS,
  STAGE_ALLOWED_ACTIONS,
  BASE_ACTION_EFFECTS,
  SHOP_ITEMS,
  MAX_ITEM_ID,
  EVOLUTION_THRESHOLDS,
  getRequiredTokenCost,
} from './constants';

// Utility functions
export {
  blake3ToField,
  clampStat,
  computeDecayDelta,
  computeDecay,
  applyAction,
  checkCooldown,
  isActionAllowed,
  assertStatInRange,
  assertAllStatsInRange,
  conditionalAdd,
  isBelow,
  isAtLeast,
} from './utils';
