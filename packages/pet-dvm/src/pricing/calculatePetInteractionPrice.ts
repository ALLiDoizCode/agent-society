/**
 * PET-to-ILP Price Calculator
 *
 * Converts a PET token cost into an ILP-denominated price in USDC micro-units,
 * applying the DVM operator's margin. Uses bigint arithmetic throughout to
 * avoid floating-point errors in monetary calculations.
 *
 * Formula: floor(petTokenCost * exchangeRateUsdcPerPet * (10000 + marginBps) / 10000)
 * Bigint division is floor division — correct behavior for this formula.
 *
 * @module pricing/calculatePetInteractionPrice
 */

import type { PetPricingConfig } from './types';
import { PricingError } from './types';

/**
 * Calculate the ILP price in USDC micro-units for a given PET token cost.
 *
 * @param petTokenCost - Number of PET tokens required for the interaction (integer >= 0).
 * @param config - Pricing configuration with exchange rate and margin.
 * @returns ILP price in USDC micro-units as bigint.
 * @throws {PricingError} If inputs are invalid.
 */
export function calculatePetInteractionPrice(
  petTokenCost: number,
  config: PetPricingConfig
): bigint {
  // Validate petTokenCost: must be a non-negative integer (PET tokens are whole units)
  if (
    !Number.isFinite(petTokenCost) ||
    petTokenCost < 0 ||
    !Number.isInteger(petTokenCost)
  ) {
    throw new PricingError(
      `petTokenCost must be a non-negative integer, got: ${petTokenCost}`,
      'INVALID_TOKEN_COST'
    );
  }

  // Validate exchangeRateUsdcPerPet
  if (config.exchangeRateUsdcPerPet <= 0n) {
    throw new PricingError(
      `exchangeRateUsdcPerPet must be positive, got: ${config.exchangeRateUsdcPerPet}`,
      'INVALID_EXCHANGE_RATE'
    );
  }

  // Validate marginBps
  if (!Number.isFinite(config.marginBps) || config.marginBps < 0) {
    throw new PricingError(
      `marginBps must be a non-negative finite number, got: ${config.marginBps}`,
      'INVALID_MARGIN_BPS'
    );
  }

  // Zero cost short-circuit
  if (petTokenCost === 0) {
    return 0n;
  }

  // Integer arithmetic: floor(petTokenCost * rate * (10000 + marginBps) / 10000)
  // petTokenCost is validated as integer above; Math.floor not needed
  const base = BigInt(petTokenCost) * config.exchangeRateUsdcPerPet;
  const withMargin =
    (base * BigInt(10000 + Math.floor(config.marginBps))) / 10000n;

  return withMargin;
}
