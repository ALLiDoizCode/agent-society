/**
 * Tests for GET /api/earnings (Story 47.2).
 *
 * Route coverage:
 *   1. Happy path — connector returns earnings, known peer, status 'ok'.
 *   2. Connector unreachable — 200 with status 'connector_unavailable'.
 *   3. Unknown peer appears as type 'external'.
 *   4. Malformed nodes.yaml — 500 with structured `{ error: 'nodes_yaml_invalid' }`.
 *
 * Comprehensive shape/recentClaims/eventsRelayed coverage lands in 47.4.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

import { registerEarningsRoutes } from './earnings.js';
import type { ApiDeps } from '../types.js';
import type { ConnectorAdminClient } from '../../connector/index.js';
import type { EarningsResponse, AssetEarnings } from '../../connector/types.js';
import type { AggregatedEarnings } from '../../earnings/aggregator.js';

// ── Test doubles ───────────────────────────────────────────────────────────

const ENABLED_AT = '2026-01-01T00:00:00Z';

interface MockOpts {
  earnings?: EarningsResponse;
  earningsThrow?: boolean;
}

function assetEntry(code: string, received: string): AssetEarnings {
  return {
    assetCode: code,
    assetScale: 6,
    claimsReceivedTotal: received,
    claimsSentTotal: '0',
    netBalance: received,
    lastClaimAt: null,
  };
}

function makeDeps(opts: MockOpts, tmpHome: string): ApiDeps {
  const connectorAdmin = {
    getEarnings: vi.fn(async () => {
      if (opts.earningsThrow) throw new Error('connector down');
      return (
        opts.earnings ?? {
          uptimeSeconds: 0,
          peers: [],
          connectorFees: [],
          recentClaims: [],
          timestamp: { iso: '' },
        }
      );
    }),
    getMetrics: vi.fn(),
    getHealth: vi.fn(),
    getPeers: vi.fn(async () => []),
    getPacketLog: vi.fn(async () => []),
  } as unknown as ConnectorAdminClient;

  return {
    configPath: join(tmpHome, 'config.yaml'),
    config: {} as ApiDeps['config'],
    connectorAdmin,
    orchestrator: {} as ApiDeps['orchestrator'],
    wallet: {} as ApiDeps['wallet'],
    transportProbe: {} as ApiDeps['transportProbe'],
  };
}

/** Write a minimal nodes.yaml (real YAML, not JSON-passing-as-YAML). */
function writeNodesYaml(
  tmpHome: string,
  entries: Array<{ peerId: string; type: 'town' | 'mill' | 'dvm' }>
): void {
  const doc = {
    entries: entries.map((e, i) => ({
      id: `node-${i}`,
      type: e.type,
      peerId: e.peerId,
      ilpAddress: `g.toon.test.${i}`,
      derivationIndex: i,
      enabledAt: ENABLED_AT,
      lastSeenAt: null,
    })),
  };
  writeFileSync(join(tmpHome, 'nodes.yaml'), yamlStringify(doc), { mode: 0o600 });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/earnings', () => {
  let app: FastifyInstance;
  const tmpDirs: string[] = [];

  afterEach(async () => {
    if (app) await app.close();
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it('happy path: returns AggregatedEarnings shape with status "ok"', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), '47-2-route-'));
    tmpDirs.push(tmpHome);

    writeNodesYaml(tmpHome, [{ peerId: 'peer-town-01', type: 'town' }]);

    const earnings: EarningsResponse = {
      uptimeSeconds: 5,
      connectorFees: [{ assetCode: 'USD', assetScale: 6, total: '1000' }],
      recentClaims: [],
      timestamp: { iso: '2026-05-12T00:00:00Z' },
      peers: [{ peerId: 'peer-town-01', byAsset: [assetEntry('USD', '500')] }],
    };
    const deps = makeDeps({ earnings }, tmpHome);

    app = Fastify();
    registerEarningsRoutes(app, deps);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/earnings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AggregatedEarnings;

    expect(body.status).toBe('ok');
    expect(body.apex.routingFees['USD'].lifetime).toBe('1000');
    expect(Array.isArray(body.peers)).toBe(true);
    expect(body.peers).toHaveLength(1);
    expect(body.peers[0].type).toBe('town');
    expect(body.peers[0].byAsset['USD'].lifetime).toBe('500');
  });

  it('connector unreachable: 200 with status "connector_unavailable"', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), '47-2-route-'));
    tmpDirs.push(tmpHome);

    const deps = makeDeps({ earningsThrow: true }, tmpHome);

    app = Fastify();
    registerEarningsRoutes(app, deps);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/earnings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AggregatedEarnings;
    expect(body).toEqual({
      status: 'connector_unavailable',
      apex: { routingFees: {} },
      peers: [],
    });
  });

  it('unknown peer appears as type "external"', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), '47-2-route-'));
    tmpDirs.push(tmpHome);

    // nodes.yaml has no entries — all connector peers are external.
    writeNodesYaml(tmpHome, []);

    const earnings: EarningsResponse = {
      uptimeSeconds: 0,
      connectorFees: [],
      recentClaims: [],
      timestamp: { iso: '' },
      peers: [{ peerId: 'peer-unknown-99', byAsset: [assetEntry('USD', '77')] }],
    };
    const deps = makeDeps({ earnings }, tmpHome);

    app = Fastify();
    registerEarningsRoutes(app, deps);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/earnings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AggregatedEarnings;
    expect(body.status).toBe('ok');
    expect(body.peers).toHaveLength(1);
    expect(body.peers[0].type).toBe('external');
    expect(body.peers[0].byAsset['USD'].lifetime).toBe('77');
  });

  it('malformed nodes.yaml → 500 with { error: "nodes_yaml_invalid" }', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), '47-2-route-'));
    tmpDirs.push(tmpHome);

    // `type: 'wrong'` is not in the NodeType enum — ZodError on parse.
    const badYaml = yamlStringify({
      entries: [
        {
          id: 'node-bad',
          type: 'wrong',
          peerId: 'peer-bad',
          ilpAddress: 'g.toon.test.bad',
          derivationIndex: 0,
          enabledAt: ENABLED_AT,
          lastSeenAt: null,
        },
      ],
    });
    writeFileSync(join(tmpHome, 'nodes.yaml'), badYaml, { mode: 0o600 });

    const deps = makeDeps({}, tmpHome);

    app = Fastify({ logger: false });
    registerEarningsRoutes(app, deps);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/earnings' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'nodes_yaml_invalid' });
  });
});
