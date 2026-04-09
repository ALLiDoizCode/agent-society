/**
 * Pet DVM Handler Type Definitions
 *
 * Types for the Pet DVM handler, proof queue, and request parsing.
 * Handler response types are duplicated locally from @toon-protocol/sdk
 * to avoid circular dependency (pet-dvm -> sdk -> pet-dvm risk).
 *
 * @module handler/types
 */

import type {
  PetEngineState,
  GameAction,
  InteractionResult,
} from '../engine/types';
import type { PetPricingConfig } from '../pricing/types';

// ============================================================
// Nostr Event (minimal local type to avoid nostr-tools resolution issues)
// ============================================================

/** Minimal Nostr event interface matching nostr-tools/pure NostrEvent */
export interface NostrEvent {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
  sig: string;
}

// ============================================================
// Handler Context & Response (local duplicates from SDK)
// ============================================================

/**
 * Minimal HandlerContext interface (mirrors @toon-protocol/sdk/handler-context.ts).
 * Duplicated locally to avoid circular dependency.
 */
export interface HandlerContext {
  readonly toon: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly amount: bigint;
  readonly destination: string;
  decode(): NostrEvent;
  accept(metadata?: Record<string, unknown>): HandlePacketAcceptResponse;
  reject(code: string, message: string): HandlePacketRejectResponse;
}

/** Mirrors @toon-protocol/core/compose.ts */
export interface HandlePacketAcceptResponse {
  accept: true;
  data?: string;
  metadata?: Record<string, unknown>;
}

/** Mirrors @toon-protocol/core/compose.ts */
export interface HandlePacketRejectResponse {
  accept: false;
  code: string;
  message: string;
}

export type HandlerResponse =
  | HandlePacketAcceptResponse
  | HandlePacketRejectResponse;

// ============================================================
// Unsigned Event (for publishing optimistic events)
// ============================================================

/** Minimal unsigned Nostr event shape for publishing */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

// ============================================================
// Pet DVM Config
// ============================================================

/** Configuration for createPetDvmHandler factory */
export interface PetDvmConfig {
  /** Directory path for .mv2 brain files */
  brainStoragePath: string;
  /** Number of interactions before emitting batch-ready (default: 10) */
  proofBatchSize?: number;
  /** Callback to publish optimistic Nostr events to relay */
  publishEvent: (event: UnsignedEvent) => Promise<void>;
  /**
   * Optional cross-chain pricing configuration.
   * When set, the handler validates that ctx.amount covers the required
   * ILP price for the interaction (calculated from request.tokenCost).
   * When omitted, payment validation is skipped (backward-compatible default).
   */
  pricingConfig?: PetPricingConfig;
}

// Re-export for consumers who import from handler/types
export type { PetPricingConfig };

// ============================================================
// Pet Interaction Request
// ============================================================

/** Parsed pet interaction request from a Kind 5900 event */
export interface PetInteractionRequest {
  blobbiId: string;
  actionType: number;
  itemId: number;
  timestamp: number;
  tokenCost: number;
  isSleeping: boolean;
  ownerPubkey: string;
}

// ============================================================
// Proof Queue Entry
// ============================================================

/** Entry in the proof queue awaiting ZK proof generation */
export interface ProofQueueEntry {
  blobbiId: string;
  priorState: PetEngineState;
  newState: PetEngineState;
  action: GameAction;
  interactionResult: InteractionResult;
  eventId: string;
}
