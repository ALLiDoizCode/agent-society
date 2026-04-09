/**
 * Pet DVM Skill Descriptor Builder
 *
 * Builds a SkillDescriptor for advertising Pet DVM capabilities in
 * Kind 10035 service discovery events. The pricing['5900'] field is
 * computed from the median action cost (10 PET tokens) at the configured
 * exchange rate, giving clients a representative per-interaction price.
 *
 * @module pricing/buildPetDvmSkillDescriptor
 */

import type { PetPricingConfig } from './types';
import { calculatePetInteractionPrice } from './calculatePetInteractionPrice';

/**
 * Local SkillDescriptor shape (mirrors @toon-protocol/core SkillDescriptor).
 * Defined locally to avoid adding @toon-protocol/core as a dependency of pet-dvm.
 */
interface SkillDescriptor {
  name: string;
  version: string;
  kinds: number[];
  features: string[];
  inputSchema: Record<string, unknown>;
  pricing: Record<string, string>;
  models?: string[];
  attestation?: Record<string, unknown>;
  reputation?: Record<string, unknown>;
}

/**
 * Representative PET token cost used for price advertisement.
 * Median of the action price table (Feed/Play/Clean/PlayMusic = 10 PET).
 */
const MEDIAN_ACTION_COST = 10;

// ============================================================
// Config type
// ============================================================

/** Configuration for building the Pet DVM skill descriptor. */
export interface PetDvmServiceDiscoveryConfig {
  /** ILP address of the Pet DVM node's connector. */
  ilpAddress: string;
  /** Pricing configuration for exchange rate and margin. */
  pricingConfig: PetPricingConfig;
  /** Optional capability feature list. Defaults to ['zk-proven', 'memvid-brain']. */
  features?: string[];
}

// ============================================================
// Builder
// ============================================================

/**
 * Builds a SkillDescriptor for the Pet DVM (Kind 5900).
 *
 * The advertised `pricing['5900']` represents the ILP cost for a median-cost
 * interaction (10 PET tokens). Clients use this as a baseline; actual costs
 * per interaction vary by action type and are validated server-side.
 *
 * Pure function — no side effects, no I/O.
 *
 * @param config - Service discovery configuration.
 * @returns A SkillDescriptor compatible with buildServiceDiscoveryEvent.
 */
export function buildPetDvmSkillDescriptor(
  config: PetDvmServiceDiscoveryConfig
): SkillDescriptor {
  const medianPrice = calculatePetInteractionPrice(
    MEDIAN_ACTION_COST,
    config.pricingConfig
  );

  return {
    name: 'pet-dvm',
    version: '1.0',
    kinds: [5900],
    features: config.features ?? ['zk-proven', 'memvid-brain'],
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'integer', minimum: 0, maximum: 10 },
      },
    },
    pricing: {
      '5900': String(medianPrice),
    },
  };
}
