/**
 * Unit tests for petActionPrices
 *
 * Tests: AC-2, AC-7 (petActionPrices.test.ts)
 */

import {
  PET_ACTION_PRICES,
  DEFAULT_EXCHANGE_RATE_USDC_PER_PET,
  DEFAULT_MARGIN_BPS,
  getActionPetCost,
} from './petActionPrices';
import { PricingError } from './types';

describe('PET_ACTION_PRICES', () => {
  it('has exactly 11 entries (action types 0-10)', () => {
    expect(Object.keys(PET_ACTION_PRICES)).toHaveLength(11);
    for (let i = 0; i <= 10; i++) {
      expect(PET_ACTION_PRICES[i]).toBeDefined();
    }
  });

  it('all values are positive integers', () => {
    for (const [, cost] of Object.entries(PET_ACTION_PRICES)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('Feed (0) costs 10 PET', () => {
    expect(PET_ACTION_PRICES[0]).toBe(10);
  });

  it('Cruzar (9) costs 50 PET — highest cost action', () => {
    expect(PET_ACTION_PRICES[9]).toBe(50);
  });

  it('Check (5) costs 1 PET — lowest cost action', () => {
    expect(PET_ACTION_PRICES[5]).toBe(1);
  });

  it('Medicine (8) costs 20 PET', () => {
    expect(PET_ACTION_PRICES[8]).toBe(20);
  });
});

describe('getActionPetCost', () => {
  it('returns correct cost for each valid action type (0-10)', () => {
    for (let i = 0; i <= 10; i++) {
      expect(getActionPetCost(i)).toBe(PET_ACTION_PRICES[i]);
    }
  });

  it('throws PricingError with INVALID_ACTION_TYPE for actionType -1', () => {
    expect(() => getActionPetCost(-1)).toThrow(PricingError);
    try {
      getActionPetCost(-1);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_ACTION_TYPE');
    }
  });

  it('throws PricingError with INVALID_ACTION_TYPE for actionType 11', () => {
    expect(() => getActionPetCost(11)).toThrow(PricingError);
    try {
      getActionPetCost(11);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_ACTION_TYPE');
    }
  });

  it('throws PricingError with INVALID_ACTION_TYPE for non-integer actionType', () => {
    expect(() => getActionPetCost(1.5)).toThrow(PricingError);
    try {
      getActionPetCost(1.5);
    } catch (err) {
      expect((err as PricingError).code).toBe('INVALID_ACTION_TYPE');
    }
  });
});

describe('DEFAULT_EXCHANGE_RATE_USDC_PER_PET', () => {
  it('is a positive bigint', () => {
    expect(typeof DEFAULT_EXCHANGE_RATE_USDC_PER_PET).toBe('bigint');
    expect(DEFAULT_EXCHANGE_RATE_USDC_PER_PET).toBeGreaterThan(0n);
  });

  it('equals 1000n', () => {
    expect(DEFAULT_EXCHANGE_RATE_USDC_PER_PET).toBe(1000n);
  });
});

describe('DEFAULT_MARGIN_BPS', () => {
  it('is 200 (2% margin)', () => {
    expect(DEFAULT_MARGIN_BPS).toBe(200);
  });
});
