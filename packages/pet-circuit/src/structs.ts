/**
 * PetLifecycle ZkProgram -- Core Struct Definitions
 *
 * Defines the provable data structures used throughout the PetLifecycle circuit:
 * - PetStats: five UInt32 stat fields [1, 100]
 * - PetAction: interaction descriptor with type, item, timestamp, cost
 * - PetState: full pet state including stats, stage, lifecycle hash chain
 *
 * @module structs
 */

import { Struct, UInt32, UInt64, Field } from 'o1js';

/**
 * Pet stat values. All fields are UInt32, clamped to [1, 100] by circuit logic.
 */
export class PetStats extends Struct({
  hunger: UInt32,
  happiness: UInt32,
  health: UInt32,
  hygiene: UInt32,
  energy: UInt32,
}) {}

/**
 * Describes a single pet interaction.
 *
 * actionType: 0-10 enum (see ActionType in constants.ts)
 * itemId: 0 = no item, or shop item index (1-based)
 * timestamp: unix seconds
 * tokenCost: PET tokens required for this interaction
 */
export class PetAction extends Struct({
  actionType: UInt32,
  itemId: UInt32,
  timestamp: UInt64,
  tokenCost: UInt64,
}) {}

/**
 * Full pet state, output of every PetLifecycle proof step.
 *
 * stats: current stat values
 * stage: 0=egg, 1=baby, 2=adult
 * cycle: monotonically increasing interaction count (starts at 1)
 * lastInteraction: timestamp of last interaction (unix seconds)
 * brainHash: BLAKE3 hash of pet brain (.mv2), truncated to 253 bits
 * totalSpent: cumulative PET tokens spent
 * lifecycleHash: Poseidon chain hash of all interactions (verifiable biography)
 * cooldownHash: Poseidon hash of 11-element lastTimestamp array (per action type)
 */
export class PetState extends Struct({
  stats: PetStats,
  stage: UInt32,
  cycle: UInt64,
  lastInteraction: UInt64,
  brainHash: Field,
  totalSpent: UInt64,
  lifecycleHash: Field,
  cooldownHash: Field,
}) {}
