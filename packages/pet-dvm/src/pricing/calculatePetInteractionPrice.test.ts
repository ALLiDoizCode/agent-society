/**
 * Unit tests for calculatePetInteractionPrice
 *
 * Tests: AC-1, AC-7 (calculatePetInteractionPrice.test.ts)
 */

import { calculatePetInteractionPrice } from './calculatePetInteractionPrice';
import { PricingError } from './types';
import type { PetPricingConfig } from './types';

const DEFAULT_CONFIG: PetPricingConfig = {
  exchangeRateUsdcPerPet: 1000n,
  marginBps: 200,
};

describe('calculatePetInteractionPrice', () => {
  it('returns correct price with margin applied (10 PET, 1000n rate, 200 bps margin)', () => {
    // 10 PET * 1000 USDC/PET * (10000 + 200) / 10000 = 10200
    const price = calculatePetInteractionPrice(10, DEFAULT_CONFIG);
    expect(price).toBe(10200n);
  });

  it('returns 0n for petTokenCost === 0', () => {
    const price = calculatePetInteractionPrice(0, DEFAULT_CONFIG);
    expect(price).toBe(0n);
  });

  it('throws PricingError with INVALID_TOKEN_COST for negative petTokenCost', () => {
    expect(() => calculatePetInteractionPrice(-1, DEFAULT_CONFIG)).toThrow(
      PricingError
    );
    try {
      calculatePetInteractionPrice(-1, DEFAULT_CONFIG);
    } catch (err) {
      expect(err).toBeInstanceOf(PricingError);
      expect((err as PricingError).code).toBe('INVALID_TOKEN_COST');
    }
  });

  it('throws PricingError with INVALID_TOKEN_COST for NaN petTokenCost', () => {
    expect(() => calculatePetInteractionPrice(NaN, DEFAULT_CONFIG)).toThrow(
      PricingError
    );
    try {
      calculatePetInteractionPrice(NaN, DEFAULT_CONFIG);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_TOKEN_COST');
    }
  });

  it('throws PricingError with INVALID_EXCHANGE_RATE for zero exchange rate', () => {
    const config: PetPricingConfig = { exchangeRateUsdcPerPet: 0n, marginBps: 200 };
    expect(() => calculatePetInteractionPrice(10, config)).toThrow(PricingError);
    try {
      calculatePetInteractionPrice(10, config);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_EXCHANGE_RATE');
    }
  });

  it('throws PricingError with INVALID_MARGIN_BPS for negative margin', () => {
    const config: PetPricingConfig = { exchangeRateUsdcPerPet: 1000n, marginBps: -1 };
    expect(() => calculatePetInteractionPrice(10, config)).toThrow(PricingError);
    try {
      calculatePetInteractionPrice(10, config);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_MARGIN_BPS');
    }
  });

  it('returns exact base price when marginBps is 0', () => {
    const config: PetPricingConfig = { exchangeRateUsdcPerPet: 1000n, marginBps: 0 };
    // 10 PET * 1000 USDC/PET * 1.0 = 10000
    const price = calculatePetInteractionPrice(10, config);
    expect(price).toBe(10000n);
  });

  it('applies floor division (no floating point rounding errors)', () => {
    // 1 PET * 1000n rate * (10000 + 200) / 10000 = 1020
    const price = calculatePetInteractionPrice(1, DEFAULT_CONFIG);
    expect(price).toBe(1020n);
  });

  it('handles large petTokenCost correctly', () => {
    // 50 PET (Cruzar) * 1000n rate * 1.02 = 51000n
    const price = calculatePetInteractionPrice(50, DEFAULT_CONFIG);
    expect(price).toBe(51000n);
  });

  it('throws PricingError with INVALID_TOKEN_COST for non-integer petTokenCost', () => {
    expect(() => calculatePetInteractionPrice(10.5, DEFAULT_CONFIG)).toThrow(PricingError);
    try {
      calculatePetInteractionPrice(10.5, DEFAULT_CONFIG);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_TOKEN_COST');
    }
  });

  it('handles custom exchange rate', () => {
    const config: PetPricingConfig = { exchangeRateUsdcPerPet: 500n, marginBps: 0 };
    // 10 PET * 500 USDC/PET = 5000
    const price = calculatePetInteractionPrice(10, config);
    expect(price).toBe(5000n);
  });
});
