/**
 * Unit tests for buildPetDvmSkillDescriptor
 *
 * Tests: AC-4, AC-7 (buildPetDvmSkillDescriptor.test.ts)
 */

import { buildPetDvmSkillDescriptor } from './buildPetDvmSkillDescriptor';
import {
  DEFAULT_EXCHANGE_RATE_USDC_PER_PET,
  DEFAULT_MARGIN_BPS,
} from './petActionPrices';
import type { PetDvmServiceDiscoveryConfig } from './buildPetDvmSkillDescriptor';

const DEFAULT_CONFIG: PetDvmServiceDiscoveryConfig = {
  ilpAddress: 'g.toon.pet-dvm.test',
  pricingConfig: {
    exchangeRateUsdcPerPet: DEFAULT_EXCHANGE_RATE_USDC_PER_PET,
    marginBps: DEFAULT_MARGIN_BPS,
  },
};

describe('buildPetDvmSkillDescriptor', () => {
  it('returns descriptor with name "pet-dvm" and version "1.0"', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(descriptor.name).toBe('pet-dvm');
    expect(descriptor.version).toBe('1.0');
  });

  it('returns kinds array containing only 5900', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(descriptor.kinds).toEqual([5900]);
  });

  it('pricing["5900"] is a valid string representation of a positive bigint', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    const price = descriptor.pricing['5900'];
    expect(typeof price).toBe('string');
    // Must parse to a positive integer
    const parsed = BigInt(price as string);
    expect(parsed).toBeGreaterThan(0n);
  });

  it('pricing["5900"] equals expected value for 10 PET median at default rate (10200)', () => {
    // 10 PET * 1000n rate * (10000 + 200) / 10000 = 10200
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(descriptor.pricing['5900']).toBe('10200');
  });

  it('default features include "zk-proven" and "memvid-brain"', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(descriptor.features).toContain('zk-proven');
    expect(descriptor.features).toContain('memvid-brain');
  });

  it('custom features array is used when provided', () => {
    const config: PetDvmServiceDiscoveryConfig = {
      ...DEFAULT_CONFIG,
      features: ['custom-feature', 'another-feature'],
    };
    const descriptor = buildPetDvmSkillDescriptor(config);
    expect(descriptor.features).toEqual(['custom-feature', 'another-feature']);
  });

  it('inputSchema is a non-null object', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(descriptor.inputSchema).toBeDefined();
    expect(typeof descriptor.inputSchema).toBe('object');
    expect(descriptor.inputSchema).not.toBeNull();
  });

  it('inputSchema describes action as integer in [0, 10]', () => {
    const descriptor = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    const properties = descriptor.inputSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    const actionSchema = properties?.['action'];
    expect(actionSchema).toBeDefined();
    expect(actionSchema?.['type']).toBe('integer');
    expect(actionSchema?.['minimum']).toBe(0);
    expect(actionSchema?.['maximum']).toBe(10);
  });

  it('pricing scales with exchange rate (500n rate => 5100 for 10 PET with 2% margin)', () => {
    const config: PetDvmServiceDiscoveryConfig = {
      ...DEFAULT_CONFIG,
      pricingConfig: { exchangeRateUsdcPerPet: 500n, marginBps: 200 },
    };
    // 10 PET * 500n * 1.02 = 5100
    const descriptor = buildPetDvmSkillDescriptor(config);
    expect(descriptor.pricing['5900']).toBe('5100');
  });

  it('is a pure function — returns new object each call', () => {
    const d1 = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    const d2 = buildPetDvmSkillDescriptor(DEFAULT_CONFIG);
    expect(d1).not.toBe(d2);
    expect(d1).toEqual(d2);
  });
});
