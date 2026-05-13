/**
 * GET /api/earnings — earnings aggregator route (Story 47.2).
 *
 * Returns the canonical `{ status, apex, peers }` earnings shape from
 * `aggregateEarnings()`. Reads `nodes.yaml` per request and constructs a
 * fresh `PeerTypeResolver` — matching the pattern in `nodes-lifecycle.ts`.
 *
 * The `?since=` parameter from Story D4 is gone — TODAY/MONTH/YEAR deltas
 * are anchored on UTC boundaries by the snapshot writer (Story 47.3).
 *
 * Failure modes:
 *   - connector outage → aggregator returns 200 with
 *     `status: 'connector_unavailable'`; the SPA surfaces a banner.
 *   - malformed `nodes.yaml` (ZodError on shape violation) → 500 with
 *     `{ error: 'nodes_yaml_invalid' }`; logged via `request.log.error`.
 */

import { dirname, join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import type { ApiDeps } from '../types.js';
import { aggregateEarnings } from '../../earnings/aggregator.js';
import { readNodesYaml } from '../../state/nodes-yaml.js';
import { PeerTypeResolver } from '../../registry/peer-type-resolver.js';

/**
 * Convention shared with `nodes-lifecycle.ts`: `nodes.yaml` lives next to
 * `config.yaml` in the operator's `~/.townhouse` dir. Centralised here so
 * any future reader stays coupled to one resolution rule.
 */
function resolveNodesYamlPath(deps: ApiDeps): string {
  return join(dirname(deps.configPath), 'nodes.yaml');
}

export function registerEarningsRoutes(
  app: FastifyInstance,
  deps: ApiDeps
): void {
  app.get('/api/earnings', async (request, reply) => {
    let yaml;
    try {
      yaml = await readNodesYaml(resolveNodesYamlPath(deps));
    } catch (err) {
      request.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'earnings: nodes.yaml read/validate failed'
      );
      return reply.status(500).send({ error: 'nodes_yaml_invalid' });
    }
    const peerTypeResolver = new PeerTypeResolver(yaml);
    return aggregateEarnings({
      connectorAdmin: deps.connectorAdmin,
      peerTypeResolver,
      logger: request.log,
    });
  });
}
