/**
 * Earnings aggregator (Story 47.2).
 *
 * Aggregates connector-reported earnings into the canonical
 * `{ status, apex, peers }` shape consumed by the host-API
 * `/api/earnings` endpoint.
 *
 * Source of truth: `connectorAdmin.getEarnings()` (Story 47.1).
 * Peer-type attribution via `PeerTypeResolver` (Story 46.1); the resolver
 * buckets unmatched peerIds as `'external'` (enforcement lives in the
 * resolver, not here — we trust its contract).
 *
 * Failure mode: if `getEarnings()` throws (network, 503-when-disabled,
 * shape drift), returns the empty payload with
 * `status: 'connector_unavailable'`. The route returns 200 either way;
 * operators see zeros plus a UI banner rather than a 5xx. An injected
 * `logger.warn` (Fastify / pino-compatible) is called on failure so ops
 * can distinguish "connector outage" from "no earnings yet."
 *
 * @module
 * @since 47.2
 */

import type { ConnectorAdminClient } from '../connector/index.js';
import type { PeerTypeResolver } from '../registry/peer-type-resolver.js';
import type { NodeType } from '../docker/types.js';

export type { NodeType };

/**
 * Per-asset cumulative + delta breakdown. `lifetime` is the connector's
 * cumulative `claimsReceivedTotal` (decimal-string bigint at `assetScale`
 * decimals). `today` / `month` / `year` are deltas computed by Story 47.3's
 * snapshot-reader; until the `deltaComputer` dep is provided, they stub
 * to '0'. Asset-scale interpretation (USD: 6, ETH: 18, sats: 0) is the
 * dashboard's job — the aggregator never collapses to a unit.
 */
export interface PerAsset {
  lifetime: string;
  today: string;
  month: string;
  year: string;
}

/** Per-peer earnings entry in the aggregator output. */
export interface NodeEarnings {
  id: string;                         // == connector peerId
  type: NodeType | 'external';        // PeerTypeResolver attribution
  byAsset: Record<string, PerAsset>;  // keyed by assetCode
}

/**
 * Wire-level status for the aggregator response.
 *
 * `'ok'` — `getEarnings()` succeeded; payload reflects connector state.
 * `'connector_unavailable'` — `getEarnings()` threw (network, 503, shape
 * drift); apex + peers are empty. The dashboard renders a banner.
 */
export type AggregatedEarningsStatus = 'ok' | 'connector_unavailable';

/** Top-level aggregator output. */
export interface AggregatedEarnings {
  status: AggregatedEarningsStatus;
  apex: {
    routingFees: Record<string, PerAsset>;  // keyed by assetCode
  };
  peers: NodeEarnings[];
}

/** Resolves TODAY / MONTH / YEAR deltas for a (scope, assetCode) tuple. */
export type DeltaComputer = (params: {
  /** Either a connector peerId or the literal `'__apex__'` for routing-fee rows. */
  scope: string;
  assetCode: string;
  /** Current cumulative (matches the lifetime value in the response). */
  currentLifetime: string;
}) => Promise<{ today: string; month: string; year: string }>;

/**
 * Minimal logger contract; Fastify `request.log` and pino satisfy it.
 * Kept narrow so tests can pass a `{ warn: vi.fn() }` stub.
 */
export interface AggregatorLogger {
  warn(obj: object, msg?: string): void;
}

export interface AggregateEarningsInput {
  connectorAdmin: ConnectorAdminClient;
  peerTypeResolver: PeerTypeResolver;
  /**
   * Optional delta computer (Story 47.3). When omitted, all PerAsset
   * `today` / `month` / `year` fields stub to '0'. The route layer (47.4)
   * wires the snapshot-backed implementation. A rejection on a single
   * asset stubs that asset's deltas to '0' and emits `logger.warn`; one
   * bad asset never breaks the aggregate.
   */
  deltaComputer?: DeltaComputer;
  /**
   * Optional logger. When provided, `getEarnings()` failures and
   * `deltaComputer` rejections are surfaced via `logger.warn` so ops can
   * distinguish a connector outage from "no earnings yet."
   */
  logger?: AggregatorLogger;
}

const STUB_DELTAS = { today: '0', month: '0', year: '0' } as const;

async function maybeDeltas(
  deltaComputer: DeltaComputer | undefined,
  scope: string,
  assetCode: string,
  currentLifetime: string,
  logger: AggregatorLogger | undefined
): Promise<{ today: string; month: string; year: string }> {
  if (!deltaComputer) return { ...STUB_DELTAS };
  try {
    return await deltaComputer({ scope, assetCode, currentLifetime });
  } catch (err) {
    logger?.warn(
      { err, scope, assetCode },
      'aggregator: deltaComputer rejected — stubbing deltas to 0 for this asset'
    );
    return { ...STUB_DELTAS };
  }
}

/**
 * Aggregate connector-reported earnings into the canonical
 * `{ status, apex, peers }` shape.
 *
 * Failure mode: any throw from `getEarnings()` returns the empty payload
 * with `status: 'connector_unavailable'` — operators see zeros + a banner,
 * not a 5xx. `deltaComputer` opt-in: when provided, today/month/year are
 * computed per-asset via concurrent `Promise.all` fan-out within each peer;
 * when omitted (or when an individual asset's delta rejects), the fields
 * stub to '0'. Story 47.3 ships the computer; Story 47.4 wires it.
 */
export async function aggregateEarnings(
  input: AggregateEarningsInput
): Promise<AggregatedEarnings> {
  let earnings: Awaited<ReturnType<typeof input.connectorAdmin.getEarnings>>;
  try {
    earnings = await input.connectorAdmin.getEarnings();
  } catch (err) {
    input.logger?.warn(
      { err },
      'aggregator: connectorAdmin.getEarnings failed — returning status=connector_unavailable'
    );
    return {
      status: 'connector_unavailable',
      apex: { routingFees: {} },
      peers: [],
    };
  }

  // Apex routing fees: connector-level fees keyed by assetCode.
  const buildRoutingFees = async (): Promise<Record<string, PerAsset>> => {
    const out: Record<string, PerAsset> = {};
    await Promise.all(
      earnings.connectorFees.map(async (fee) => {
        const deltas = await maybeDeltas(
          input.deltaComputer,
          '__apex__',
          fee.assetCode,
          fee.total,
          input.logger
        );
        out[fee.assetCode] = { lifetime: fee.total, ...deltas };
      })
    );
    return out;
  };

  // Per-peer earnings: type attributed via PeerTypeResolver; the resolver
  // returns `'external'` for any peerId not in nodes.yaml, so we never
  // drop peers here.
  const buildPeers = async (): Promise<NodeEarnings[]> =>
    Promise.all(
      earnings.peers.map(async (peer) => {
        const type = input.peerTypeResolver.resolvePeerType(peer.peerId);

        // Shape conversion: connector ships `byAsset` as an array
        // (`AssetEarnings[]`); the aggregator output is a
        // `Record<assetCode, PerAsset>`. Delta calls fan out concurrently
        // across this peer's assets.
        const byAsset: Record<string, PerAsset> = {};
        await Promise.all(
          peer.byAsset.map(async (a) => {
            const deltas = await maybeDeltas(
              input.deltaComputer,
              peer.peerId,
              a.assetCode,
              a.claimsReceivedTotal,
              input.logger
            );
            byAsset[a.assetCode] = { lifetime: a.claimsReceivedTotal, ...deltas };
          })
        );

        return { id: peer.peerId, type, byAsset };
      })
    );

  // Apex and peer blocks have no ordering dependency — run them in parallel
  // so a single getEarnings() response fans out into one wave of delta calls.
  const [routingFees, peers] = await Promise.all([buildRoutingFees(), buildPeers()]);

  return { status: 'ok', apex: { routingFees }, peers };
}
