/**
 * @toon-protocol/pet-dvm
 *
 * Pet DVM handler package — game engine + memvid + prover + Mina TX for TOON pets.
 *
 * @module @toon-protocol/pet-dvm
 */

// Engine
export {
  PetGameEngine,
  createPetGameEngine,
  createGenesisState,
} from './engine/PetGameEngine';

// Engine Types
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

// Handler
export { createPetDvmHandler } from './handler/createPetDvmHandler';
export { parsePetInteractionRequest } from './handler/parsePetInteractionRequest';
export { buildPetInteractionEvent } from './handler/buildPetInteractionEvent';
export { PetStateManager } from './handler/PetStateManager';
export { ProofQueue } from './handler/ProofQueue';

// Handler Types
export type {
  PetDvmConfig,
  PetInteractionRequest,
  ProofQueueEntry,
  UnsignedEvent,
  HandlerContext,
  HandlerResponse,
  HandlePacketAcceptResponse,
  HandlePacketRejectResponse,
  NostrEvent,
} from './handler/types';
export type { BuildPetInteractionEventParams } from './handler/buildPetInteractionEvent';

// Checkpoint
export { CheckpointManager } from './checkpoint/CheckpointManager';
export { CheckpointError, CheckpointConfigError } from './checkpoint/types';
export type {
  CheckpointConfig,
  CheckpointResult,
  CheckpointEvent,
  CheckpointErrorCode,
  ArweaveUploadAdapter,
} from './checkpoint/types';

// Dungeon
export {
  DungeonGameEngine,
  DEFAULT_MONSTER_TABLE,
  DEFAULT_LOOT_TABLE,
  hashSeed,
} from './dungeon/DungeonGameEngine';
export type {
  DungeonConfig,
  DungeonPetStats,
  DungeonRunResult,
  DungeonStatDelta,
  EncounterRecord,
  LootRecord,
  MonsterEntry,
  LootEntry,
  DungeonEngineErrorCode,
} from './dungeon/types';
export { DungeonEngineError } from './dungeon/types';

// Dungeon Stat Bridge
export {
  petStatsToDungeonStats,
  applyDungeonDeltaToStats,
  clampStatValues,
  dungeonDeltaToGameAction,
  StatBridgeError,
} from './dungeon/statBridge';
export type { StatBridgeErrorCode } from './dungeon/statBridge';

// Dungeon DVM Handler
export {
  createDungeonDvmHandler,
  buildDungeonDvmSkillDescriptor,
} from './dungeon/dungeonDvmHandler';
export type {
  DungeonDvmConfig,
  DungeonSkillDescriptorConfig,
} from './dungeon/dungeonDvmHandler';

// Pricing
export { calculatePetInteractionPrice } from './pricing/calculatePetInteractionPrice';
export {
  PET_ACTION_PRICES,
  DEFAULT_EXCHANGE_RATE_USDC_PER_PET,
  DEFAULT_MARGIN_BPS,
  getActionPetCost,
} from './pricing/petActionPrices';
export {
  buildPetDvmSkillDescriptor,
  type PetDvmServiceDiscoveryConfig,
} from './pricing/buildPetDvmSkillDescriptor';
export {
  PricingError,
  type PetPricingConfig,
  type PricingErrorCode,
} from './pricing/types';
