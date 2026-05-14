import { describe, it, expect, afterEach } from 'vitest';
import { formatUsdc } from './format.js';

describe('formatUsdc', () => {
  const origEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = origEnv;
    }
  });

  it('formats a standard USDC amount', () => {
    expect(formatUsdc('1234567', 6)).toBe('$1.23');
  });

  it('formats zero', () => {
    expect(formatUsdc('0', 6)).toBe('$0.00');
  });

  it('formats a negative amount', () => {
    expect(formatUsdc('-500000', 6)).toBe('-$0.50');
  });

  it('formats a large amount', () => {
    expect(formatUsdc('999999999999999999', 6)).toBe('$999999999999.99');
  });

  it('throws on non-decimal input in dev mode', () => {
    process.env['NODE_ENV'] = 'development';
    expect(() => formatUsdc('not-a-number', 6)).toThrow('invalid decimal string');
  });

  it('throws on non-decimal input in test mode', () => {
    process.env['NODE_ENV'] = 'test';
    expect(() => formatUsdc('not-a-number', 6)).toThrow('invalid decimal string');
  });

  it('returns $?.?? on non-decimal input in production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(formatUsdc('not-a-number', 6)).toBe('$?.??');
  });

  it('returns $?.?? when NODE_ENV is undefined (treated as production)', () => {
    delete process.env['NODE_ENV'];
    expect(formatUsdc('not-a-number', 6)).toBe('$?.??');
  });

  it('formats at scale 2', () => {
    expect(formatUsdc('1234', 2)).toBe('$12.34');
  });

  it('pads cents at scale 1 (one fractional digit → two)', () => {
    expect(formatUsdc('123', 1)).toBe('$12.30');
  });

  it('suppresses negative sign on negative zero', () => {
    expect(formatUsdc('-0', 6)).toBe('$0.00');
  });
});
