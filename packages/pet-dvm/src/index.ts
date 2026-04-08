/**
 * @toon-protocol/pet-dvm
 *
 * Pet DVM handler package — game engine + memvid + prover + Mina TX for TOON pets.
 * This story (11-4) implements the PetGameEngine; future stories add DVM handler,
 * proof queue, and Mina TX broadcaster.
 *
 * @module @toon-protocol/pet-dvm
 */

// Engine
export {
  PetGameEngine,
  createPetGameEngine,
  createGenesisState,
} from './engine/PetGameEngine';

// Types
export type {
  PetEngineState,
  StatValues,
  GameAction,
  InteractionResult,
  EvolutionResult,
  DecayResult,
  GameEngineErrorCode,
} from './engine/types';
export { GameEngineError } from './engine/types';
