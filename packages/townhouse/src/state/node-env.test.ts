/**
 * node-env tests — assembleNodeEnv operator/negotiation injection + the
 * resolvePublicBtpUrl precedence used for the town's kind:10032.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  assembleNodeEnv,
  resolvePublicBtpUrl,
  type AssembleNodeEnvParams,
} from './node-env.js';
import { getDefaultConfig } from '../config/index.js';
import type { TownhouseConfig } from '../config/schema.js';

function baseParams(
  over: Partial<AssembleNodeEnvParams> = {}
): AssembleNodeEnvParams {
  return {
    type: 'town',
    nostrSecretKeyHex: '11'.repeat(32),
    nostrPubkey: 'a'.repeat(64),
    evmPrivateKeyHex: '22'.repeat(32),
    mnemonic: 'test mnemonic',
    apexEvmAddress: '0x' + 'a'.repeat(40),
    config: getDefaultConfig(),
    ...over,
  };
}

function withTown(
  over: Partial<TownhouseConfig['nodes']['town']>
): TownhouseConfig {
  const base = getDefaultConfig();
  return {
    ...base,
    nodes: { ...base.nodes, town: { ...base.nodes.town, ...over } },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('assembleNodeEnv — town negotiation values', () => {
  it('injects PUBLIC_BTP_URL, FEE_PER_EVENT, ASSET_CODE, ASSET_SCALE', () => {
    const config = withTown({
      feePerEvent: 1000,
      assetCode: 'USDC',
      assetScale: 6,
    });
    const env = assembleNodeEnv(
      baseParams({ type: 'town', config, publicBtpUrl: 'wss://abc.anyone/btp' })
    );
    expect(env['PUBLIC_BTP_URL']).toBe('wss://abc.anyone/btp');
    expect(env['FEE_PER_EVENT']).toBe('1000');
    expect(env['ASSET_CODE']).toBe('USDC');
    expect(env['ASSET_SCALE']).toBe('6');
    // identity still present
    expect(env['TOWN_SECRET_KEY']).toBe('11'.repeat(32));
  });

  it('omits PUBLIC_BTP_URL when not provided; omits fee/asset when unset', () => {
    const env = assembleNodeEnv(baseParams({ type: 'town' }));
    expect(env).not.toHaveProperty('PUBLIC_BTP_URL');
    expect(env).not.toHaveProperty('FEE_PER_EVENT');
    expect(env).not.toHaveProperty('ASSET_CODE');
  });

  it('does not inject town vars for non-town node types', () => {
    const config = withTown({ feePerEvent: 1000 });
    const env = assembleNodeEnv(
      baseParams({ type: 'dvm', config, publicBtpUrl: 'wss://x/btp' })
    );
    expect(env).not.toHaveProperty('PUBLIC_BTP_URL');
    expect(env).not.toHaveProperty('FEE_PER_EVENT');
  });
});

describe('resolvePublicBtpUrl', () => {
  it('uses transport.externalUrl override, normalised to /btp', () => {
    const base = getDefaultConfig();
    const config: TownhouseConfig = {
      ...base,
      transport: { ...base.transport, externalUrl: 'wss://op.example' },
    };
    expect(resolvePublicBtpUrl(config)).toBe('wss://op.example/btp');
  });

  it('keeps an externalUrl that already ends in /btp', () => {
    const base = getDefaultConfig();
    const config: TownhouseConfig = {
      ...base,
      transport: { ...base.transport, externalUrl: 'wss://op.example/btp' },
    };
    expect(resolvePublicBtpUrl(config)).toBe('wss://op.example/btp');
  });

  it('HS mode builds wss://<hostname>/btp from the resolved hostname', () => {
    const base = getDefaultConfig();
    const config: TownhouseConfig = {
      ...base,
      transport: { mode: 'hs', externalUrl: 'auto' },
    };
    expect(resolvePublicBtpUrl(config, 'abc.anyone')).toBe(
      'wss://abc.anyone/btp'
    );
  });

  it('HS mode returns undefined when the hostname is not yet resolved', () => {
    const base = getDefaultConfig();
    const config: TownhouseConfig = {
      ...base,
      transport: { mode: 'hs', externalUrl: 'auto' },
    };
    expect(resolvePublicBtpUrl(config, undefined)).toBeUndefined();
  });

  it('direct mode falls back to the loopback dial URL', () => {
    const config = getDefaultConfig(); // mode: 'direct'
    expect(resolvePublicBtpUrl(config)).toBe('ws://127.0.0.1:3000/btp');
  });
});
