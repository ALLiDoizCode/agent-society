/**
 * Pet DVM Pricing Module
 *
 * Exports for cross-chain DVM pricing: exchange rate calculation,
 * action cost table, skill descriptor builder, and error types.
 *
 * @module pricing
 */

export { calculatePetInteractionPrice } from './calculatePetInteractionPrice';
export {
  PET_ACTION_PRICES,
  DEFAULT_EXCHANGE_RATE_USDC_PER_PET,
  DEFAULT_MARGIN_BPS,
  getActionPetCost,
} from './petActionPrices';
export {
  buildPetDvmSkillDescriptor,
  type PetDvmServiceDiscoveryConfig,
} from './buildPetDvmSkillDescriptor';
export { PricingError, type PetPricingConfig, type PricingErrorCode } from './types';
