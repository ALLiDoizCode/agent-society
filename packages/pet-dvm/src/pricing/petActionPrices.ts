/**
 * PET Action Pricing Table
 *
 * Maps pet interaction action types (0-10) to their PET token costs.
 * These costs represent the on-chain token burn per interaction and are
 * used by the pricing engine to calculate the ILP-denominated price.
 *
 * Action types:
 *   0=Feed, 1=Play, 2=Clean, 3=Rest, 4=Warm, 5=Check,
 *   6=Sing, 7=Talk, 8=Medicine, 9=Cruzar, 10=PlayMusic
 *
 * @module pricing/petActionPrices
 */

import { PricingError } from './types';

// ============================================================
// Action cost table
// ============================================================

/**
 * PET token cost per action type.
 * All values are positive integers representing whole PET tokens.
 */
export const PET_ACTION_PRICES: Record<number, number> = {
  0: 10, // Feed
  1: 10, // Play
  2: 10, // Clean
  3: 5, //  Rest
  4: 5, //  Warm
  5: 1, //  Check
  6: 5, //  Sing
  7: 5, //  Talk
  8: 20, // Medicine
  9: 50, // Cruzar
  10: 10, // PlayMusic
} as const;

// ============================================================
// Exchange rate and margin defaults
// ============================================================

/**
 * Default static ILP exchange rate: 1000 USDC micro-units per PET token.
 * Equals 0.001 USDC per PET token. Static placeholder — oracle integration deferred (R-015).
 *
 * TODO(epic-12): Replace this static rate with a live exchange rate oracle.
 * Upgrade path:
 *   1. Define an `ExchangeRateOracle` interface with `getRate(base, quote): Promise<bigint>`.
 *   2. Implement a live feed adapter (e.g., CoinGecko, Chainlink, or Pyth).
 *   3. Inject the oracle into `calculatePetInteractionPrice()` via `PetPricingConfig`.
 *   4. Add circuit-breaker / staleness check: reject rates older than N seconds.
 *   5. Keep this constant as the fallback default when oracle is unreachable.
 * See: Epic 11 retro action item "Exchange rate oracle upgrade path documented"
 *      and NFR assessments flagging static rate as a CONCERN.
 */
export const DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n;

/**
 * Default DVM profit margin in basis points: 200 bps = 2%.
 */
export const DEFAULT_MARGIN_BPS = 200;

// ============================================================
// Accessor
// ============================================================

/**
 * Returns the PET token cost for a given action type.
 *
 * @param actionType - Action type integer (0-10).
 * @returns PET token cost as a positive integer.
 * @throws {PricingError} If actionType is outside the valid range [0, 10].
 */
export function getActionPetCost(actionType: number): number {
  if (!Number.isInteger(actionType) || actionType < 0 || actionType > 10) {
    throw new PricingError(
      `actionType must be an integer in [0, 10], got: ${actionType}`,
      'INVALID_ACTION_TYPE'
    );
  }
  // noUncheckedIndexedAccess: bounds are validated above, so the value is always defined.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return PET_ACTION_PRICES[actionType]!;
}
