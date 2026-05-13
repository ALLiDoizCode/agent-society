/**
 * Unit tests for the earnings aggregator (Story 47.2).
 *
 * Test gate matrix (AC-47.2-6 requires ≥7 cases; expanded to 10 post-review):
 *   1.  Empty earnings — apex/peers empty, status 'ok'.
 *   2.  Full earnings, all known peers — also asserts `getPacketLog` was NEVER
 *       called (AC #5 belt-and-suspenders).
 *   3.  Unknown peer → 'external'; peer is NOT dropped.
 *   4.  Connector throws — empty payload, status 'connector_unavailable'.
 *   5.  503 error — empty payload, status 'connector_unavailable'.
 *   6.  deltaComputer threads today/month/year through apex + peer.
 *   7.  deltaComputer concurrency — proves `Promise.all` fan-out covers
 *       apex AND peer assets in the same wave (4 concurrent calls).
 *   8.  Peer with empty `byAsset: []` — emits `byAsset: {}`, type resolved.
 *   9.  Mixed known + unknown peers — known resolves to its NodeType, unknown
 *       buckets 'external'; both appear in the result.
 *   10. deltaComputer rejects on one asset — that asset's deltas stub to '0',
 *       other assets proceed normally, status stays 'ok'.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ConnectorAdminClient } from '../connector/index.js';
import type { EarningsResponse, AssetEarnings } from '../connector/types.js';
import type { NodeType } from '../docker/types.js';

import { PeerTypeResolver } from '../registry/peer-type-resolver.js';
import {
  aggregateEarnings,
  type AggregatorLogger,
  type DeltaComputer,
} from './aggregator.js';

// ── Test doubles ───────────────────────────────────────────────────────────

const ENABLED_AT = '2026-01-01T00:00:00Z';

function makeConnector(
  earningsResponse?: EarningsResponse | 'throw' | '503'
): ConnectorAdminClient {
  return {
    getEarnings: vi.fn(async () => {
      if (earningsResponse === 'throw') throw new Error('connector down');
      if (earningsResponse === '503')
        throw new Error('Connector admin API error: 503 Service Unavailable');
      return (
        earningsResponse ?? {
          uptimeSeconds: 0,
          peers: [],
          connectorFees: [],
          recentClaims: [],
          timestamp: { iso: '' },
        }
      );
    }),
    getMetrics: vi.fn(async () => ({
      uptimeSeconds: 0,
      aggregate: { packetsForwarded: 0, packetsRejected: 0, bytesSent: 0 },
      peers: [],
      timestamp: '',
    })),
    getHealth: vi.fn(async () => ({
      status: 'healthy' as const,
      uptime: 0,
      peersConnected: 0,
      totalPeers: 0,
      timestamp: '',
    })),
    getPeers: vi.fn(async () => []),
    getPacketLog: vi.fn(async () => []),
  } as unknown as ConnectorAdminClient;
}

function makeResolver(
  entries: { peerId: string; type: NodeType }[]
): PeerTypeResolver {
  return new PeerTypeResolver({
    entries: entries.map((e, i) => ({
      id: `node-${i}`,
      type: e.type,
      peerId: e.peerId,
      ilpAddress: `g.toon.test.${i}`,
      derivationIndex: i,
      enabledAt: ENABLED_AT,
      lastSeenAt: null,
    })),
  });
}

function makeLogger(): AggregatorLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

function assetEntry(
  assetCode: string,
  claimsReceivedTotal: string
): AssetEarnings {
  return {
    assetCode,
    assetScale: 6,
    claimsReceivedTotal,
    claimsSentTotal: '0',
    netBalance: claimsReceivedTotal,
    lastClaimAt: null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('aggregateEarnings', () => {
  it('[case 1] empty earnings — apex and peers both empty, status ok', async () => {
    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(),
      peerTypeResolver: makeResolver([]),
    });

    expect(result.status).toBe('ok');
    expect(result.apex.routingFees).toEqual({});
    expect(result.peers).toEqual([]);
  });

  it('[case 2] full earnings, all known peers — never touches getPacketLog (AC #5)', async () => {
    const earnings: EarningsResponse = {
      uptimeSeconds: 10,
      connectorFees: [{ assetCode: 'USD', assetScale: 6, total: '1000' }],
      recentClaims: [],
      timestamp: { iso: '2026-05-12T00:00:00Z' },
      peers: [
        { peerId: 'peer-town', byAsset: [assetEntry('USD', '500'), assetEntry('ETH', '200')] },
        { peerId: 'peer-mill', byAsset: [assetEntry('USD', '300'), assetEntry('ETH', '100')] },
        { peerId: 'peer-dvm',  byAsset: [assetEntry('USD', '800'), assetEntry('ETH', '50')] },
      ],
    };
    const resolver = makeResolver([
      { peerId: 'peer-town', type: 'town' },
      { peerId: 'peer-mill', type: 'mill' },
      { peerId: 'peer-dvm', type: 'dvm' },
    ]);
    const connector = makeConnector(earnings);

    const result = await aggregateEarnings({
      connectorAdmin: connector,
      peerTypeResolver: resolver,
    });

    expect(result.status).toBe('ok');

    // Apex routing fees
    expect(result.apex.routingFees['USD'].lifetime).toBe('1000');
    expect(result.apex.routingFees['USD'].today).toBe('0');

    // Peers
    expect(result.peers).toHaveLength(3);
    const byId = Object.fromEntries(result.peers.map((p) => [p.id, p]));
    expect(byId['peer-town'].type).toBe('town');
    expect(byId['peer-mill'].type).toBe('mill');
    expect(byId['peer-dvm'].type).toBe('dvm');
    expect(byId['peer-town'].byAsset['USD'].lifetime).toBe('500');
    expect(byId['peer-town'].byAsset['ETH'].lifetime).toBe('200');
    expect(byId['peer-mill'].byAsset['USD'].lifetime).toBe('300');

    // All delta fields default to '0' when no deltaComputer.
    for (const peer of result.peers) {
      for (const asset of Object.values(peer.byAsset)) {
        expect(asset.today).toBe('0');
        expect(asset.month).toBe('0');
        expect(asset.year).toBe('0');
      }
    }

    // AC #5 belt-and-suspenders: aggregator must not pull packet log.
    expect(connector.getPacketLog).not.toHaveBeenCalled();
  });

  it('[case 3] unknown peer → type "external", peer NOT dropped, status ok', async () => {
    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [{ peerId: 'peer-external-x', byAsset: [assetEntry('USD', '99')] }],
    };

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: makeResolver([]), // no entries — all external
    });

    expect(result.status).toBe('ok');
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0].type).toBe('external');
    expect(result.peers[0].id).toBe('peer-external-x');
    expect(result.peers[0].byAsset['USD'].lifetime).toBe('99');
  });

  it('[case 4] connector throws — status connector_unavailable, logger warned', async () => {
    const logger = makeLogger();
    const result = await aggregateEarnings({
      connectorAdmin: makeConnector('throw'),
      peerTypeResolver: makeResolver([]),
      logger,
    });

    expect(result).toEqual({
      status: 'connector_unavailable',
      apex: { routingFees: {} },
      peers: [],
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [obj] = logger.warn.mock.calls[0];
    expect((obj as { err: unknown }).err).toBeInstanceOf(Error);
  });

  it('[case 5] 503 connector error — status connector_unavailable', async () => {
    const result = await aggregateEarnings({
      connectorAdmin: makeConnector('503'),
      peerTypeResolver: makeResolver([]),
    });

    expect(result).toEqual({
      status: 'connector_unavailable',
      apex: { routingFees: {} },
      peers: [],
    });
  });

  it('[case 6] deltaComputer is invoked and threads through apex + peer', async () => {
    const deltaComputer: DeltaComputer = vi.fn(async () => ({
      today: '1',
      month: '2',
      year: '3',
    }));

    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [{ assetCode: 'USD', assetScale: 6, total: '500' }],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [{ peerId: 'peer-a', byAsset: [assetEntry('USD', '200')] }],
    };
    const resolver = makeResolver([{ peerId: 'peer-a', type: 'town' }]);

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: resolver,
      deltaComputer,
    });

    expect(result.status).toBe('ok');
    expect(result.apex.routingFees['USD'].today).toBe('1');
    expect(result.peers[0].byAsset['USD'].today).toBe('1');
    expect(result.peers[0].byAsset['USD'].year).toBe('3');

    expect(deltaComputer).toHaveBeenCalledTimes(2);
    const calls = (deltaComputer as ReturnType<typeof vi.fn>).mock
      .calls as [Parameters<DeltaComputer>[0]][];
    const scopes = calls.map(([p]) => p.scope);
    expect(scopes).toContain('__apex__');
    expect(scopes).toContain('peer-a');
  });

  it('[case 7] deltaComputer fans out concurrently across apex + peer assets', async () => {
    // 1 apex fee + 1 peer with 3 assets = 4 concurrent delta calls. If any
    // step were serial, `await allStarted` would block before all 4 calls
    // entered the function — reaching the assertion proves concurrency.
    // Concurrency also lifts across the apex/peer boundary because the
    // aggregator launches both `Promise.all` blocks via the same outer
    // microtask (we await them in parallel below).
    let pendingCount = 0;
    let resolveAll!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });
    const observedAssets = new Set<string>();

    const deltaComputer: DeltaComputer = async ({ scope, assetCode }) => {
      pendingCount++;
      observedAssets.add(`${scope}:${assetCode}`);
      if (pendingCount === 4) resolveAll();
      await allStarted;
      return { today: assetCode, month: '0', year: '0' };
    };

    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [{ assetCode: 'APEX', assetScale: 6, total: '10' }],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [
        {
          peerId: 'peer-multi',
          byAsset: [assetEntry('A', '1'), assetEntry('B', '2'), assetEntry('C', '3')],
        },
      ],
    };
    const resolver = makeResolver([{ peerId: 'peer-multi', type: 'town' }]);

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: resolver,
      deltaComputer,
    });

    // Concurrency: all 4 calls (1 apex + 3 peer) entered before any resolved.
    expect(pendingCount).toBe(4);
    expect(observedAssets).toEqual(new Set(['__apex__:APEX', 'peer-multi:A', 'peer-multi:B', 'peer-multi:C']));

    // Resolved values reach the output (not just "calls were started").
    expect(result.apex.routingFees['APEX'].today).toBe('APEX');
    expect(result.peers[0].byAsset['A'].today).toBe('A');
    expect(result.peers[0].byAsset['B'].today).toBe('B');
    expect(result.peers[0].byAsset['C'].today).toBe('C');
  });

  it('[case 8] peer with empty byAsset — emits byAsset: {}, type resolved', async () => {
    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [{ peerId: 'peer-quiet', byAsset: [] }],
    };
    const resolver = makeResolver([{ peerId: 'peer-quiet', type: 'town' }]);

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: resolver,
    });

    expect(result.status).toBe('ok');
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]).toEqual({ id: 'peer-quiet', type: 'town', byAsset: {} });
  });

  it('[case 9] mixed known + unknown peers — both appear in the result', async () => {
    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [
        { peerId: 'peer-known',   byAsset: [assetEntry('USD', '111')] },
        { peerId: 'peer-stranger', byAsset: [assetEntry('USD', '222')] },
      ],
    };
    const resolver = makeResolver([{ peerId: 'peer-known', type: 'mill' }]);

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: resolver,
    });

    expect(result.status).toBe('ok');
    expect(result.peers).toHaveLength(2);
    const byId = Object.fromEntries(result.peers.map((p) => [p.id, p]));
    expect(byId['peer-known'].type).toBe('mill');
    expect(byId['peer-stranger'].type).toBe('external');
  });

  it('[case 10] deltaComputer rejects on one asset — that asset stubs, others proceed, status ok', async () => {
    const logger = makeLogger();
    const deltaComputer: DeltaComputer = vi.fn(async ({ assetCode }) => {
      if (assetCode === 'BAD') throw new Error('snapshot read failed');
      return { today: '7', month: '7', year: '7' };
    });

    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [
        {
          peerId: 'peer-mixed',
          byAsset: [assetEntry('USD', '100'), assetEntry('BAD', '999')],
        },
      ],
    };
    const resolver = makeResolver([{ peerId: 'peer-mixed', type: 'town' }]);

    const result = await aggregateEarnings({
      connectorAdmin: makeConnector(earnings),
      peerTypeResolver: resolver,
      deltaComputer,
      logger,
    });

    // Status still 'ok' — connector itself succeeded; only a single delta failed.
    expect(result.status).toBe('ok');

    // BAD asset stubs to '0'; USD asset gets the deltas.
    expect(result.peers[0].byAsset['BAD']).toEqual({
      lifetime: '999',
      today: '0',
      month: '0',
      year: '0',
    });
    expect(result.peers[0].byAsset['USD']).toEqual({
      lifetime: '100',
      today: '7',
      month: '7',
      year: '7',
    });

    // Logger was called for the BAD asset rejection.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [obj] = logger.warn.mock.calls[0];
    expect((obj as { assetCode: string }).assetCode).toBe('BAD');
  });
});
