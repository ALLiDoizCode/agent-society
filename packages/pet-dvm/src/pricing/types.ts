/**
 * Pet DVM Pricing Type Definitions
 *
 * Types and error class for the cross-chain DVM pricing engine.
 * The pricing engine translates PET token costs into ILP-denominated
 * prices (USDC micro-units) for advertisement in Kind 10035 service
 * discovery events and validation of incoming ILP payments.
 *
 * @module pricing/types
 */

// ============================================================
// Pricing Config
// ============================================================

/**
 * Configuration for the cross-chain pricing engine.
 *
 * All monetary values use bigint to avoid floating-point errors.
 */
export interface PetPricingConfig {
  /** ILP price in USDC micro-units per 1 PET token. Static placeholder: 1000n (0.001 USDC/PET). */
  exchangeRateUsdcPerPet: bigint;
  /** DVM profit margin in basis points (e.g., 200 = 2%). */
  marginBps: number;
}

// ============================================================
// Pricing Error
// ============================================================

export type PricingErrorCode =
  | 'INVALID_TOKEN_COST'
  | 'INVALID_EXCHANGE_RATE'
  | 'INVALID_MARGIN_BPS'
  | 'INVALID_ACTION_TYPE';

/** Typed error thrown by the pricing engine. */
export class PricingError extends Error {
  constructor(
    message: string,
    public readonly code: PricingErrorCode
  ) {
    super(message);
    this.name = 'PricingError';
    // Fix prototype chain for instanceof checks when extending built-in Error
    Object.setPrototypeOf(this, PricingError.prototype);
  }
}
