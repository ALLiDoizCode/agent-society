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
