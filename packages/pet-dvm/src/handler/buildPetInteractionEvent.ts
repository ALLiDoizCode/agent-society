/**
 * Build an optimistic Kind 14919 pet interaction event.
 *
 * No `proof` or `mina_tx` tags -- those are added by the proof settlement
 * pipeline (Story 11-7) after ZK proof generation.
 *
 * @module handler/buildPetInteractionEvent
 */

import type { UnsignedEvent } from './types';
import type { InteractionResult } from '../engine/types';

/**
 * Kind 14919: Optimistic pet interaction event.
 * Matches PET_INTERACTION_EVENT_KIND from @toon-protocol/core.
 * Defined locally to avoid ESM/CJS resolution issues in tests.
 */
const PET_INTERACTION_EVENT_KIND = 14919;

export interface BuildPetInteractionEventParams {
  blobbiId: string;
  actionType: number;
  itemId: number;
  tokenCost: number;
  cycle: number;
  stage: number;
  brainHash: string;
  interactionResult: InteractionResult;
  /** Optional Unix timestamp override (defaults to Date.now()/1000). Useful for deterministic tests. */
  timestamp?: number;
}

/**
 * Builds an unsigned Kind 14919 optimistic pet interaction event.
 *
 * Content is JSON-serialized InteractionResult (stats before/after).
 * Tags include pet identity, action details, and brain hash.
 */
export function buildPetInteractionEvent(
  params: BuildPetInteractionEventParams
): UnsignedEvent {
  return {
    kind: PET_INTERACTION_EVENT_KIND,
    created_at: params.timestamp ?? Math.floor(Date.now() / 1000),
    tags: [
      ['d', params.blobbiId],
      ['action', String(params.actionType)],
      ['item', String(params.itemId)],
      ['cost', String(params.tokenCost)],
      ['cycle', String(params.cycle)],
      ['stage', String(params.stage)],
      ['brain_hash', params.brainHash],
    ],
    content: JSON.stringify(params.interactionResult),
  };
}
