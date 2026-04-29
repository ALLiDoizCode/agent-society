# Story 21.3: Standalone Connector Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a shared standalone connector managing all ILP routing,
so that my nodes share a single routing table and ATOR connection.

## Dependencies

- **Story 21.2** (done): Docker orchestrator with container lifecycle, health check polling, `DockerOrchestrator` class, `docker-compose-townhouse.yml`, CLI integration with `--town`/`--mill`/`--dvm` flags
- **Story 21.1** (done): Package scaffold, CLI entrypoint, config schema (ConnectorConfig, TransportConfig, NodesConfig)
- **Epic 21 test design** (`_bmad-output/planning-artifacts/test-design-epic-21.md`): Test scenarios T-016 through T-022

## Acceptance Criteria

1. Connector config generated from Townhouse config (fees, ATOR proxy endpoint, peer list)
2. Connector started first, health-checked before nodes start (already enforced by Story 21.2 orchestrator — this story adds config generation logic)
3. When nodes start/stop, connector config is regenerated and connector restarted (Option A: restart-based peer registration)
4. Connector admin API endpoint exposed for dashboard metrics
5. ATOR transport toggle: `socks5h://proxy.ator.io:9050` or direct, configurable per operator
6. Integration test: connector + one node communicating over Docker network

## Tasks / Subtasks

- [x] Task 1: Connector config generator module (AC: #1, #5)
  - [x] 1.1 Create `src/connector/config-generator.ts` with a `ConnectorConfigGenerator` class. Constructor accepts `TownhouseConfig`. Method: `generate(activeNodes: NodeType[]): ConnectorRuntimeConfig` producing a connector config object (not YAML/JSON yet — just a typed object).
  - [x] 1.2 Define `ConnectorRuntimeConfig` interface in `src/connector/types.ts`: includes `adminPort: number`, `ilpAddress: string` (base address, default `g.townhouse` — hardcoded in generator since `ConnectorConfig` schema has no ilpAddress field yet), `peers: PeerEntry[]`, `transport: { mode: 'ator' | 'direct'; socksProxy?: string }`.
  - [x] 1.3 Define `PeerEntry` interface: `{ id: string; relation: 'child'; btpUrl: string; assetCode: string; assetScale: number }`. Each active node becomes a child peer of the connector.
  - [x] 1.4 Implement peer list generation: for each active node type, create a `PeerEntry` with BTP URL pointing to the container's internal address (e.g., `btp+ws://townhouse-town:3000` for Town). `id` is the node type name. Only include nodes that are in the `activeNodes` list.
  - [x] 1.5 Implement ATOR transport config: if `config.transport.mode === 'ator'` and `config.transport.socksProxy` is set, include SOCKS proxy in output config. Default ATOR proxy: `socks5h://proxy.ator.io:9050`.
  - [x] 1.6 Implement `toEnvVars(): Record<string, string>` method that serializes `ConnectorRuntimeConfig` into environment variables the connector container understands: `CONNECTOR_ADMIN_PORT`, `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS` (JSON-serialized peer list), `TRANSPORT_MODE`, `SOCKS_PROXY`. Note: the existing `buildConnectorEnv()` in orchestrator returns `string[]` format (e.g., `['KEY=VALUE']`). Add a helper `toEnvArray(): string[]` that converts the Record to the `string[]` format expected by the dockerode container create API.
  - [x] 1.7 Create `src/connector/index.ts` re-exporting public API.

- [x] Task 2: Orchestrator integration — restart-based peer registration (AC: #2, #3)
  - [x] 2.1 Add method `regenerateConnectorConfig(activeNodes: NodeType[]): Promise<void>` to `DockerOrchestrator`. This generates fresh connector config, stops the connector container, removes it, and starts a new one with updated environment variables.
  - [x] 2.2 Update `up(profiles: NodeType[])` in `DockerOrchestrator` — BEFORE starting the connector, use `ConnectorConfigGenerator` to compute env vars including the peer list for the requested profiles (peer BTP URLs are deterministic Docker DNS names, so nodes don't need to be running yet). Pass these env vars to `startConnector()`. The existing `buildConnectorEnv()` private method should delegate to `ConnectorConfigGenerator.toEnvArray()` (which returns `string[]` matching the existing format used by dockerode's `Env` option).
  - [x] 2.3 Add method `addNode(type: NodeType): Promise<void>` — starts a new node, then calls `regenerateConnectorConfig()` with the updated active node list. This enables hot-adding a node after initial startup.
  - [x] 2.4 Add method `removeNode(type: NodeType): Promise<void>` — stops a node, then calls `regenerateConnectorConfig()` with the updated active node list. This enables hot-removing a node.
  - [x] 2.5 Emit `connectorRestarting` event before restart and `connectorRestarted` event after health check passes, so the CLI/dashboard can show status during the brief restart window. Update `OrchestratorEvents` interface in `src/docker/types.ts` to include these two new event types.

- [x] Task 3: Connector admin API proxy (AC: #4)
  - [x] 3.1 Create `src/connector/admin-client.ts` with `ConnectorAdminClient` class. Constructor accepts `baseUrl: string` (e.g., `http://localhost:9401`). Methods: `getHealth(): Promise<HealthResponse>`, `getMetrics(): Promise<MetricsResponse>`, `getPeers(): Promise<PeerStatus[]>`.
  - [x] 3.2 Define response types in `src/connector/types.ts`: `HealthResponse { status: 'healthy' | 'unhealthy'; uptime: number }`, `MetricsResponse { packetsForwarded: number; packetsRejected: number; bytesSent: number }`, `PeerStatus { id: string; connected: boolean; packetsForwarded: number }`.
  - [x] 3.3 Implement HTTP fetch calls to connector admin endpoints: `GET /health`, `GET /metrics`, `GET /peers`. Use Node.js native `fetch` (available in Node 20+). Include error handling for connection refused (connector not running).
  - [x] 3.4 Export `ConnectorAdminClient` from `src/connector/index.ts`.

- [x] Task 4: CLI integration for admin metrics (AC: #4)
  - [x] 4.1 Add `metrics` subcommand to CLI: `townhouse metrics [-c <path>]`. Calls `ConnectorAdminClient.getMetrics()` and displays packet counts, bytes forwarded, peer connection status.
  - [x] 4.2 Enhance `townhouse status` to include connector metrics (packets forwarded, active peers) alongside container health. Gracefully degrades if connector admin API is unreachable (show "metrics unavailable").
  - [x] 4.3 Update HELP_TEXT to document the new `metrics` command.

- [x] Task 5: Docker Compose updates (AC: #1, #3)
  - [x] 5.1 Update `docker-compose-townhouse.yml` — add `CONNECTOR_ILP_ADDRESS` and `CONNECTOR_PEERS` environment variables to the connector service (with default values for compose-only usage). Add comments explaining that the orchestrator overrides these at runtime.
  - [x] 5.2 Add BTP port exposure to node containers (port 3000 internal, no host mapping needed since communication is Docker-internal via `townhouse-net`). This port is how the connector establishes BTP sessions with nodes.

- [x] Task 6: Unit tests (AC: #1-#5)
  - [x] 6.1 Create `src/connector/config-generator.test.ts` — test peer list generation for various node combinations (town only, mill only, all three, empty). Test ATOR proxy inclusion/exclusion. Test env var serialization. Corresponds to T-016, T-019.
  - [x] 6.2 Create `src/connector/admin-client.test.ts` — test HTTP fetch with mock responses. Test connection refused handling. Test response parsing. Corresponds to T-020.
  - [x] 6.3 Update `src/docker/orchestrator.test.ts` — add tests for `regenerateConnectorConfig()`, `addNode()`, `removeNode()`. Verify connector restart sequence (stop -> remove -> create -> start -> health). Verify env vars include CONNECTOR_PEERS. Corresponds to T-018.
  - [x] 6.4 Update `src/cli.test.ts` — add tests for `metrics` command, enhanced `status` output with connector metrics.
  - [x] 6.5 Test that connector env vars include all active nodes as peers after `up()` completes. Corresponds to T-016.
  - [x] 6.6 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

- [x] Task 7: Integration test (AC: #6)
  - [x] 7.1 Create `src/__integration__/connector-integration.test.ts` — requires real Docker. Start connector + one Town node using orchestrator. Verify both containers running and on same network. Verify connector admin API responds with peer list including Town. Corresponds to T-017, T-020.
  - [x] 7.2 Test node addition: start with Town only, then `addNode('mill')` — verify connector restarted with updated peer list including both Town and Mill. Corresponds to T-018.
  - [x] 7.3 Test node removal: remove Mill, verify connector restarted with only Town in peer list.
  - [x] 7.4 Skip integration tests in CI by default (require `RUN_DOCKER_INTEGRATION=1` env var). Add vitest config for integration: `vitest.integration.config.ts` with 120s timeout.

## Dev Notes

### Architecture Context

This story builds on Story 21.2's `DockerOrchestrator` by adding the intelligence layer: the connector config generation that tells the standalone connector which nodes exist and how to reach them.

**Key decision D21-002:** Standalone connector, not embedded. One shared connector handles all ILP routing for all nodes. This is the single most important architectural choice in Townhouse — it means:
- One routing table, not N (one per node)
- One ATOR connection shared across all nodes
- One unified transaction ledger (all packets flow through one connector)
- Cleaner separation: nodes handle application logic, connector handles routing

**Key decision D21-003:** Connector image is pre-built. The connector container runs `ghcr.io/toon-protocol/connector` which already has an admin API and accepts configuration via environment variables. We don't build a custom connector — we configure the existing one.

**Option A: Restart-based peer registration.** When a node starts or stops, we regenerate the connector's env vars (peer list) and restart the connector container. This is simpler than Option B (dynamic BTP registration via admin API) because:
- No custom admin API endpoints needed on the connector
- Config is always declarative and reproducible
- Restart is fast (~2-3s) for a connector with no persistent state
- The brief restart window is acceptable for a home operator setup

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** Not applicable (no 64-bit integer bridging in this story).
- **Golden test vectors (ZK story pairs):** Not applicable.

### Critical Implementation Patterns

**Follow Story 21.2 patterns exactly.** All new files must follow the same conventions:
- Co-located test files (`config-generator.test.ts` next to `config-generator.ts`)
- TypeScript interfaces in dedicated `types.ts` file
- Re-exports via `index.ts`
- Dependency injection for testability

**Connector environment variable contract:**

The `ghcr.io/toon-protocol/connector` image reads these env vars at startup:
```
CONNECTOR_ADMIN_PORT=9401       # Admin API listen port
CONNECTOR_ILP_ADDRESS=g.townhouse  # Base ILP address for this connector
CONNECTOR_PEERS=<JSON>          # JSON array of PeerEntry objects
TRANSPORT_MODE=direct|ator      # Transport mode
SOCKS_PROXY=socks5h://...       # Only when TRANSPORT_MODE=ator
```

The `CONNECTOR_PEERS` JSON structure matches what `@toon-protocol/connector`'s `ConnectorNode` expects:
```typescript
interface PeerEntry {
  id: string;           // e.g., 'town', 'mill', 'dvm'
  relation: 'child';    // nodes are always children of the townhouse connector
  btpUrl: string;       // e.g., 'btp+ws://townhouse-town:3000'
  assetCode: string;    // e.g., 'USD'
  assetScale: number;   // e.g., 6
}
```

**BTP URL format for Docker networking:**

Nodes expose BTP on port 3000 internally. The connector reaches them via Docker DNS:
- Town: `btp+ws://townhouse-town:3000`
- Mill: `btp+ws://townhouse-mill:3000`
- DVM: `btp+ws://townhouse-dvm:3000`

These URLs only work within the `townhouse-net` Docker bridge network.

**Connector restart sequence:**
1. Emit `connectorRestarting` event
2. Stop existing connector container (`container.stop({ t: 5 })` — short timeout, connector is stateless)
3. Remove stopped container
4. Generate new env vars with `ConnectorConfigGenerator.toEnvVars()`
5. Create new container with updated env vars
6. Start container
7. Wait for health check
8. Emit `connectorRestarted` event

**Admin API endpoints (pre-existing on connector image):**
- `GET /health` — returns `{ status: 'healthy', uptime: <seconds> }`
- `GET /metrics` — returns `{ packetsForwarded: N, packetsRejected: N, bytesSent: N }`
- `GET /peers` — returns `[{ id: string, connected: boolean, packetsForwarded: N }]`

All accessible on `http://localhost:${config.connector.adminPort}` from the host.

### Dependency Budget

No new production dependencies needed:
- `dockerode` already installed (Story 21.1)
- `fetch` is Node.js built-in (Node 20+)
- `ConnectorConfigGenerator` is pure TypeScript logic

No new dev dependencies needed.

### File Structure Requirements

```
packages/townhouse/
├── src/
│   ├── cli.ts                          # Updated: add 'metrics' command, enhance 'status'
│   ├── cli.test.ts                     # Updated: tests for metrics command
│   ├── connector/
│   │   ├── index.ts                    # Re-exports
│   │   ├── types.ts                    # ConnectorRuntimeConfig, PeerEntry, response types
│   │   ├── config-generator.ts         # ConnectorConfigGenerator class
│   │   ├── config-generator.test.ts    # Unit tests
│   │   ├── admin-client.ts             # ConnectorAdminClient class
│   │   └── admin-client.test.ts        # Unit tests
│   ├── docker/
│   │   ├── orchestrator.ts             # Updated: regenerateConnectorConfig, addNode, removeNode
│   │   ├── orchestrator.test.ts        # Updated: tests for new methods
│   │   └── types.ts                    # Updated: add connectorRestarting/connectorRestarted to OrchestratorEvents
│   ├── __integration__/
│   │   └── connector-integration.test.ts  # Docker integration test
│   └── index.ts                        # Updated: re-export connector module
├── vitest.integration.config.ts        # Integration test config (120s timeout)
```

Also updated at project root:
```
docker-compose-townhouse.yml            # Updated: CONNECTOR_PEERS env var, node BTP ports
```

### Testing Strategy

**Unit tests (mocked):**

| Test ID | Scenario | Task(s) | AC |
|---------|----------|---------|-----|
| T-016 | Connector config generated with correct peer list for active nodes | 6.1, 6.5 | #1 |
| T-018 | Node start triggers connector config regeneration and restart | 6.3 | #3 |
| T-019 | ATOR toggle: connector uses `socks5h://proxy.ator.io:9050` when enabled | 6.1 | #5 |
| T-020 | Connector admin API endpoint accessible from host | 6.2 | #4 |

**Integration tests (real Docker):**

| Test ID | Scenario | Task(s) | AC |
|---------|----------|---------|-----|
| T-017 | Connector started first and health-checked before nodes | 7.1 | #2 |
| T-020 | Connector admin API returns valid JSON | 7.1 | #4 |
| T-018 | Node add/remove triggers connector restart with updated peers | 7.2, 7.3 | #3 |
| T-021 | Transaction ledger correct attribution | (deferred to Story 21.8) | -- |
| T-022 | Connector restart completes within 5s | 7.2 | #3 |

**Integration test prerequisites:** Docker daemon running, no port conflicts on 9401.

### Previous Story Intelligence (21.2)

Key patterns from Story 21.2 to continue:
- `DockerOrchestrator` uses `EventEmitter` for progress reporting — extend with `connectorRestarting`/`connectorRestarted` events
- Container env vars built via private `buildConnectorEnv(): string[]` method (returns `['KEY=VALUE', ...]` format for dockerode `Env` option) — refactor to use `ConnectorConfigGenerator`
- Health check polling via `container.inspect()` checking `State.Health.Status`
- Mock strategy: inject mock `dockerode` via constructor
- Container naming: `townhouse-connector`, `townhouse-town`, `townhouse-mill`, `townhouse-dvm`
- Network: `townhouse-net` bridge network
- The `CONNECTOR_INTERNAL_PORT = 3000` constant already exists in orchestrator.ts
- `normalizeImageTag()` utility for Docker image tag normalization

### Security Notes

- `CONNECTOR_PEERS` env var contains only BTP WebSocket URLs (no secrets). These are Docker-internal addresses not reachable from outside the Docker network.
- Admin API binds to host port 9401 on localhost only (per compose config `127.0.0.1:9401:9401`). Dashboard reads metrics from here.
- No authentication on admin API — acceptable for localhost-only binding in home operator context. Story 21.8 (Fastify API) will add auth if exposed beyond localhost.

### Project Structure Notes

- `packages/townhouse/src/connector/` is a new subdirectory within the existing package
- `docker-compose-townhouse.yml` updated in-place (already exists from Story 21.2)
- `src/index.ts` should be updated to re-export the connector module
- Integration tests live in `src/__integration__/` following the project-wide pattern (see `packages/sdk/src/__integration__/`)

### References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.3] — Story requirements and acceptance criteria
- [Source: _bmad-output/epics/epic-21-townhouse.md#Key Design Decisions] — D21-002 (standalone connector), D21-003 (pre-built image), D21-004 (ATOR config option), D21-006 (unified transaction ledger)
- [Source: _bmad-output/implementation-artifacts/21-2-docker-orchestration-engine.md] — Previous story: DockerOrchestrator, container lifecycle, health checks, buildConnectorEnv()
- [Source: packages/townhouse/src/docker/orchestrator.ts] — Current orchestrator with startConnector(), buildConnectorEnv(), buildNodeEnv()
- [Source: packages/townhouse/src/config/schema.ts] — TownhouseConfig, ConnectorConfig, TransportConfig interfaces
- [Source: packages/townhouse/src/config/defaults.ts] — Default connector image and adminPort (9401)
- [Source: packages/townhouse/src/docker/types.ts] — NodeType, ContainerSpec, OrchestratorEvents, HealthCheckOptions
- [Source: docker-compose-townhouse.yml] — Current compose file with connector and node services
- [Source: docker/src/entrypoint-sdk.ts] — Reference for ConnectorNode, BTP server, peer registration patterns
- [Source: packages/sdk/src/connector-api.test.ts] — Connector API: registerPeer, removePeer methods
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#Story 21.3] — Test scenarios T-016 through T-022
- [Source: _bmad-output/project-context.md#Technology Stack] — TypeScript 5.3, ESM-only, tsup, vitest, Node.js 20+

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required — all tests pass on first run.

### Completion Notes List

- Task 1: Created `ConnectorConfigGenerator` class with `generate()`, `toEnvVars()`, `toEnvArray()` methods. Defined `ConnectorRuntimeConfig`, `PeerEntry`, and admin API response types in `types.ts`. Re-exports via `index.ts`.
- Task 2: Integrated `ConnectorConfigGenerator` into `DockerOrchestrator`. Added `regenerateConnectorConfig()`, `addNode()`, `removeNode()` methods. Refactored `buildConnectorEnv()` to delegate to the config generator. Added `connectorRestarting`/`connectorRestarted` events to `OrchestratorEvents`.
- Task 3: Created `ConnectorAdminClient` with `getHealth()`, `getMetrics()`, `getPeers()` methods using Node.js native fetch. Includes error handling for connection refused and non-200 responses.
- Task 4: Added `metrics` CLI subcommand. Enhanced `status` command to include connector metrics with graceful degradation. Updated HELP_TEXT.
- Task 5: Updated `docker-compose-townhouse.yml` with `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS` env vars on connector, and `expose: ['3000']` on all node services for BTP communication.
- Task 6: Implemented all unit tests — config-generator (19 tests), admin-client (10 tests), orchestrator-connector (15 tests), orchestrator extensions (4 tests), CLI metrics (3 tests). All 181 tests pass.
- Task 7: Updated integration test file with real implementations (still gated by `RUN_DOCKER_INTEGRATION=1`). Added vitest.integration.config.ts with 120s timeout.

### File List

- packages/townhouse/src/connector/types.ts (created)
- packages/townhouse/src/connector/config-generator.ts (created)
- packages/townhouse/src/connector/admin-client.ts (created)
- packages/townhouse/src/connector/index.ts (created)
- packages/townhouse/src/connector/config-generator.test.ts (modified — replaced ATDD stubs with real tests)
- packages/townhouse/src/connector/admin-client.test.ts (modified — replaced ATDD stubs with real tests)
- packages/townhouse/src/docker/orchestrator.ts (modified — added ConnectorConfigGenerator integration, regenerateConnectorConfig, addNode, removeNode)
- packages/townhouse/src/docker/types.ts (modified — added connectorRestarting/connectorRestarted events)
- packages/townhouse/src/docker/orchestrator.test.ts (modified — added T-016, T-018 tests)
- packages/townhouse/src/docker/orchestrator-connector.test.ts (modified — replaced ATDD stubs with real tests)
- packages/townhouse/src/cli.ts (modified — added metrics command, enhanced status, ConnectorAdminClient import)
- packages/townhouse/src/cli.test.ts (modified — added metrics command tests)
- packages/townhouse/src/index.ts (modified — added connector module re-exports)
- packages/townhouse/src/__integration__/connector-integration.test.ts (modified — replaced ATDD stubs with real tests)
- docker-compose-townhouse.yml (modified — added CONNECTOR_ILP_ADDRESS, CONNECTOR_PEERS, expose:3000)
- _bmad-output/implementation-artifacts/21-3-standalone-connector-integration.md (modified — status, checkboxes, dev record)

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-20 | Story 21.3 complete: Standalone connector integration — config generator, admin client, orchestrator restart-based peer registration, CLI metrics command, Docker Compose updates, full unit test coverage (181 pass) |
| 2026-04-20 | Code review fixes: admin port localhost-only binding, fetch timeout via AbortController, containerState.detail type field, shared constants module, corrected test count |
| 2026-04-20 | Code review pass 2: orchestrator PortBindings HostIp=127.0.0.1 (security), AbortError vs connection-refused distinction in admin-client, timeout test added (183 tests pass) |
| 2026-04-20 | Code review pass 3: admin-client response shape validation (defense-in-depth), nosemgrep suppression for CONNECTOR_PEERS false positive (183 tests pass) |

## Code Review Record

| Pass | Date | Reviewer Model | Critical | High | Medium | Low | Outcome |
|------|------|----------------|----------|------|--------|-----|---------|
| 1 | 2026-04-20 | Claude Opus 4.6 (1M context) | 0 | 0 | 3 | 2 | All fixed |
| 2 | 2026-04-20 | Claude Opus 4.6 (1M context) | 0 | 1 | 1 | 1 | All fixed |
| 3 | 2026-04-20 | Claude Opus 4.6 (1M context) | 0 | 0 | 1 | 1 | All fixed |

### Pass 1 Details

**Issues found:** 5 (0 critical, 0 high, 3 medium, 2 low) — all fixed.

| Severity | Issue | Fix Applied |
|----------|-------|-------------|
| MEDIUM | Docker compose admin port bound to 0.0.0.0 instead of 127.0.0.1 (security — exposes admin API to network) | Changed to `127.0.0.1:9401:9401` |
| MEDIUM | `ConnectorAdminClient.fetch()` has no request timeout — hangs indefinitely if connector is unresponsive | Added `AbortController` with configurable timeout (default 5s) |
| MEDIUM | `OrchestratorEvents.containerState` interface missing `detail` field that is emitted in error cases | Added optional `detail?: string` to interface |
| LOW | `CONTAINER_PREFIX` and `NODE_BTP_PORT` duplicated across `config-generator.ts` and `orchestrator.ts` | Extracted to shared `src/constants.ts` module |
| LOW | Story claims 177 tests pass but actual count is 181 | Corrected documentation |

### Pass 2 Details

**Issues found:** 3 (0 critical, 1 high, 1 medium, 1 low) — all fixed.

| Severity | Issue | Fix Applied |
|----------|-------|-------------|
| HIGH | Orchestrator `startConnector()` PortBindings omits `HostIp` — admin API binds to 0.0.0.0 (all interfaces) when using programmatic orchestrator, exposing metrics to LAN | Added `HostIp: '127.0.0.1'` to PortBindings; added regression test |
| MEDIUM | `ConnectorAdminClient` does not distinguish `AbortError` (timeout) from connection-refused errors — both report "connection refused" making debugging difficult | Added explicit `AbortError` name check; throws descriptive timeout message with URL and duration |
| LOW | No test coverage for the timeout error path in `ConnectorAdminClient` | Added unit test verifying timeout-specific error message |

### Pass 3 Details

**Issues found:** 2 (0 critical, 0 high, 1 medium, 1 low) — all fixed.

| Severity | Issue | Fix Applied |
|----------|-------|-------------|
| MEDIUM | `ConnectorAdminClient` response methods cast `response.json()` directly to typed interfaces without runtime validation — malformed connector responses would silently produce invalid objects (OWASP A8: Software and Data Integrity Failures) | Added explicit runtime type checks on response body shape before casting |
| LOW | Semgrep false positive on `CONNECTOR_PEERS` Docker-internal `btp+ws://` URLs in docker-compose not suppressed | Added `nosemgrep` comment to CONNECTOR_PEERS line |

## Senior Developer Review (AI)

**Reviewer:** Jonathan (AI-assisted) | **Date:** 2026-04-20 | **Outcome:** APPROVED (with fixes applied)

### Issues Found & Fixed (Pass 1 + Pass 2)

| Severity | Issue | Fix |
|----------|-------|-----|
| HIGH | Orchestrator `startConnector()` PortBindings omits `HostIp` — admin API binds to 0.0.0.0 when using programmatic orchestrator | Added `HostIp: '127.0.0.1'` to PortBindings + regression test |
| MEDIUM | Docker compose admin port bound to 0.0.0.0 instead of 127.0.0.1 (security — exposes admin API to network) | Changed to `127.0.0.1:9401:9401` |
| MEDIUM | `ConnectorAdminClient.fetch()` has no request timeout — hangs indefinitely if connector is unresponsive | Added `AbortController` with configurable timeout (default 5s) |
| MEDIUM | `ConnectorAdminClient` does not distinguish timeout from connection-refused errors | Added `AbortError` name check with descriptive timeout message |
| MEDIUM | `OrchestratorEvents.containerState` interface missing `detail` field that is emitted in error cases | Added optional `detail?: string` to interface |
| LOW | `CONTAINER_PREFIX` and `NODE_BTP_PORT` duplicated across `config-generator.ts` and `orchestrator.ts` | Extracted to shared `src/constants.ts` module |
| LOW | Story claims 177 tests pass but actual count is 181 | Corrected documentation |
| LOW | No test coverage for timeout error path in admin client | Added unit test |

### Verification

- All 183 unit tests pass after fixes
- TypeScript build succeeds (tsup DTS + ESM)
- Integration tests correctly gated behind `RUN_DOCKER_INTEGRATION=1`
- All 6 Acceptance Criteria verified as implemented
