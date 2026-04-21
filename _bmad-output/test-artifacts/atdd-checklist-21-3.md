---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-20'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/21-3-standalone-connector-integration.md'
  - '_bmad-output/planning-artifacts/test-design-epic-21.md'
  - 'packages/townhouse/vitest.config.ts'
  - 'packages/townhouse/src/docker/orchestrator.test.ts'
  - 'packages/townhouse/src/docker/types.ts'
  - 'packages/townhouse/src/config/schema.ts'
  - 'packages/townhouse/src/config/defaults.ts'
---

# ATDD Checklist - Epic 21, Story 3: Standalone Connector Integration

**Date:** 2026-04-20
**Author:** Jonathan
**Primary Test Level:** Unit + Integration

---

## Story Summary

Story 21.3 adds the intelligence layer to the Townhouse Docker orchestrator: a `ConnectorConfigGenerator` that builds the connector's environment variables (peer list, transport config) from the Townhouse config, and orchestrator methods to restart the connector when nodes are added or removed. It also adds a `ConnectorAdminClient` for querying connector metrics.

**As a** node operator
**I want** a shared standalone connector managing all ILP routing
**So that** my nodes share a single routing table and ATOR connection

---

## Acceptance Criteria

1. Connector config generated from Townhouse config (fees, ATOR proxy endpoint, peer list)
2. Connector started first, health-checked before nodes start (config generation logic)
3. When nodes start/stop, connector config is regenerated and connector restarted
4. Connector admin API endpoint exposed for dashboard metrics
5. ATOR transport toggle: `socks5h://proxy.ator.io:9050` or direct, configurable per operator
6. Integration test: connector + one node communicating over Docker network

---

## Failing Tests Created (RED Phase)

### Unit Tests: ConnectorConfigGenerator (20 tests)

**File:** `packages/townhouse/src/connector/config-generator.test.ts` (214 lines)

- **Test:** generates peer list with Town only when only Town is active
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — peer list generation for single node (T-016)

- **Test:** generates peer list with Mill only when only Mill is active
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — peer list generation for single node (T-016)

- **Test:** generates peer list with all three nodes when all are active
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — peer list for all node types (T-016)

- **Test:** generates empty peer list when no nodes are active
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — empty peer list edge case (T-016)

- **Test:** only includes nodes in the activeNodes list, ignoring enabled config
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — activeNodes filtering (T-016)

- **Test:** uses correct BTP URL format for Docker networking
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — BTP URL format (T-016)

- **Test:** sets adminPort from connector config
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — admin port config passthrough

- **Test:** sets ilpAddress to default g.townhouse
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #1 — ILP address default

- **Test:** includes SOCKS proxy when transport mode is ator
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #5 — ATOR toggle (T-019)

- **Test:** uses default ATOR proxy when mode is ator but socksProxy not set
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #5 — default ATOR proxy (T-019)

- **Test:** does not include socksProxy when transport mode is direct
  - **Status:** RED (skipped) - ConnectorConfigGenerator not implemented
  - **Verifies:** AC #5 — direct mode no proxy (T-019)

- **Test:** serializes config to CONNECTOR_ADMIN_PORT env var
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #1 — env var serialization (T-016)

- **Test:** serializes config to CONNECTOR_ILP_ADDRESS env var
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #1 — env var serialization (T-016)

- **Test:** serializes peer list to CONNECTOR_PEERS as JSON
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #1 — CONNECTOR_PEERS JSON (T-016)

- **Test:** serializes TRANSPORT_MODE env var
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #5 — transport mode env var (T-019)

- **Test:** includes SOCKS_PROXY env var when transport mode is ator
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #5 — SOCKS_PROXY env var (T-019)

- **Test:** does not include SOCKS_PROXY env var when transport mode is direct
  - **Status:** RED (skipped) - toEnvVars() not implemented
  - **Verifies:** AC #5 — no SOCKS_PROXY in direct mode (T-019)

- **Test:** converts env vars Record to KEY=VALUE string array
  - **Status:** RED (skipped) - toEnvArray() not implemented
  - **Verifies:** AC #1 — dockerode Env format compatibility

- **Test:** returns string[] compatible with dockerode Env option
  - **Status:** RED (skipped) - toEnvArray() not implemented
  - **Verifies:** AC #1 — KEY=VALUE format validation

### Unit Tests: ConnectorAdminClient (11 tests)

**File:** `packages/townhouse/src/connector/admin-client.test.ts` (135 lines)

- **Test:** returns health status from connector admin API
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — health endpoint (T-020)

- **Test:** throws when connector is not running (connection refused)
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — error handling (T-020)

- **Test:** handles non-200 response gracefully
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — non-200 handling (T-020)

- **Test:** returns metrics from connector admin API
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — metrics endpoint (T-020)

- **Test:** returns peer status list from connector admin API
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — peers endpoint (T-020)

- **Test:** returns empty array when no peers are connected
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — empty peers (T-020)

- **Test:** throws when connector is not running (getMetrics)
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — error handling (T-020)

- **Test:** throws when connector is not running (getPeers)
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — error handling (T-020)

- **Test:** accepts base URL without trailing slash
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — constructor robustness

- **Test:** strips trailing slash from base URL
  - **Status:** RED (skipped) - ConnectorAdminClient not implemented
  - **Verifies:** AC #4 — URL normalization

### Unit Tests: DockerOrchestrator Connector Integration (12 tests)

**File:** `packages/townhouse/src/docker/orchestrator-connector.test.ts` (234 lines)

- **Test:** passes CONNECTOR_PEERS env var with town peer when starting with town
  - **Status:** RED (skipped) - up() not yet using ConnectorConfigGenerator
  - **Verifies:** AC #1, #2 — peer env vars on startup (T-016)

- **Test:** passes CONNECTOR_PEERS with multiple peers when starting town+mill
  - **Status:** RED (skipped) - up() not yet using ConnectorConfigGenerator
  - **Verifies:** AC #1 — multi-peer env vars (T-016)

- **Test:** passes CONNECTOR_ILP_ADDRESS env var to connector
  - **Status:** RED (skipped) - up() not yet using ConnectorConfigGenerator
  - **Verifies:** AC #1 — ILP address env var (T-016)

- **Test:** stops existing connector container (regenerate)
  - **Status:** RED (skipped) - regenerateConnectorConfig() not implemented
  - **Verifies:** AC #3 — connector restart (T-018)

- **Test:** removes stopped connector container before creating new one
  - **Status:** RED (skipped) - regenerateConnectorConfig() not implemented
  - **Verifies:** AC #3 — stop->remove->create->start sequence (T-018)

- **Test:** creates new connector container with updated env vars
  - **Status:** RED (skipped) - regenerateConnectorConfig() not implemented
  - **Verifies:** AC #3 — updated peer list after regeneration (T-018)

- **Test:** waits for health check after restarting connector
  - **Status:** RED (skipped) - regenerateConnectorConfig() not implemented
  - **Verifies:** AC #3 — health check gating (T-018)

- **Test:** addNode starts new node and regenerates connector config
  - **Status:** RED (skipped) - addNode() not implemented
  - **Verifies:** AC #3 — hot-add node (T-018)

- **Test:** addNode includes new node in regenerated connector peer list
  - **Status:** RED (skipped) - addNode() not implemented
  - **Verifies:** AC #3 — peer list updated (T-018)

- **Test:** removeNode stops the specified node container
  - **Status:** RED (skipped) - removeNode() not implemented
  - **Verifies:** AC #3 — hot-remove node (T-018)

- **Test:** removeNode regenerates connector config without removed node
  - **Status:** RED (skipped) - removeNode() not implemented
  - **Verifies:** AC #3 — peer list pruned (T-018)

- **Test:** emits connectorRestarting event before restart
  - **Status:** RED (skipped) - events not implemented
  - **Verifies:** AC #3 — restart event emission

- **Test:** emits connectorRestarted event after health check passes
  - **Status:** RED (skipped) - events not implemented
  - **Verifies:** AC #3 — restart event emission

### Integration Tests (7 tests)

**File:** `packages/townhouse/src/__integration__/connector-integration.test.ts` (119 lines)

- **Test:** starts connector + Town node and both are running
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #2, #6 — connector + node startup (T-017)

- **Test:** connector and Town are on same Docker network
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #6 — Docker network communication (T-017)

- **Test:** connector admin API responds to health check
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #4 — admin API accessibility (T-020)

- **Test:** connector admin API returns peer list including Town
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #4 — peer list validation (T-020)

- **Test:** connector admin API returns metrics
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #4 — metrics endpoint (T-020)

- **Test:** addNode(mill) updates connector peer list to include both
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #3 — hot-add integration (T-018)

- **Test:** removeNode(mill) updates connector peer list to only Town
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #3 — hot-remove integration (T-018)

- **Test:** connector restart completes within 5 seconds
  - **Status:** RED (skipped) - requires Docker + implementation
  - **Verifies:** AC #3 — restart performance (T-022)

---

## Data Factories Created

N/A — This story tests infrastructure/orchestration logic using config factory functions (`configWithNodes()`) and mock Docker instances (`createMockDocker()`). No external data seeding or API factories are needed.

The `configWithNodes()` helper (already present in orchestrator tests from Story 21.2) serves as the factory pattern for this story.

---

## Fixtures Created

N/A — Tests use inline mock construction via `createMockDocker()` factory following the pattern established in Story 21.2's `orchestrator.test.ts`. No Playwright/Cypress fixtures needed (backend-only).

---

## Mock Requirements

### Docker API Mock (Unit Tests)

All unit tests mock the `dockerode` library. The mock pattern from Story 21.2 is reused:

- `createContainer()` - Returns mock container with start/stop/remove/inspect
- `getContainer()` - Returns mock container for health check polling
- `listContainers()` - Returns running container list for status queries
- `createNetwork()` / `listNetworks()` - Network management
- `pull()` / `modem.followProgress()` - Image pull simulation

### Node.js fetch Mock (AdminClient Tests)

- `vi.stubGlobal('fetch', fetchMock)` - Mock global fetch for HTTP calls
- Success responses: `{ ok: true, json: () => ... }`
- Error responses: `{ ok: false, status: 503 }`
- Connection refused: `fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))`

---

## Required data-testid Attributes

N/A — This is a backend/CLI story with no UI components.

---

## Implementation Checklist

### Test: ConnectorConfigGenerator peer list generation

**File:** `packages/townhouse/src/connector/config-generator.test.ts`

**Tasks to make this test pass:**

- [ ] Create `src/connector/types.ts` with `ConnectorRuntimeConfig`, `PeerEntry` interfaces
- [ ] Create `src/connector/config-generator.ts` with `ConnectorConfigGenerator` class
- [ ] Implement `generate(activeNodes: NodeType[]): ConnectorRuntimeConfig`
- [ ] Implement peer list generation: map active nodes to `PeerEntry` objects
- [ ] Implement BTP URL generation using Docker container names
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- config-generator`
- [ ] Test passes (green phase)

**Estimated Effort:** 2 hours

---

### Test: ConnectorConfigGenerator ATOR transport config

**File:** `packages/townhouse/src/connector/config-generator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement ATOR transport detection in `generate()`
- [ ] Set default SOCKS proxy (`socks5h://proxy.ator.io:9050`) when mode is ator and no proxy set
- [ ] Omit socksProxy field when mode is direct
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- config-generator`
- [ ] Test passes (green phase)

**Estimated Effort:** 1 hour

---

### Test: ConnectorConfigGenerator env var serialization

**File:** `packages/townhouse/src/connector/config-generator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `toEnvVars(config: ConnectorRuntimeConfig): Record<string, string>`
- [ ] Implement `toEnvArray(config: ConnectorRuntimeConfig): string[]`
- [ ] Serialize CONNECTOR_PEERS as JSON string
- [ ] Conditionally include SOCKS_PROXY only for ator mode
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- config-generator`
- [ ] Test passes (green phase)

**Estimated Effort:** 1 hour

---

### Test: ConnectorAdminClient HTTP methods

**File:** `packages/townhouse/src/connector/admin-client.test.ts`

**Tasks to make this test pass:**

- [ ] Create `src/connector/admin-client.ts` with `ConnectorAdminClient` class
- [ ] Add response types to `src/connector/types.ts`: `HealthResponse`, `MetricsResponse`, `PeerStatus`
- [ ] Implement `getHealth()`, `getMetrics()`, `getPeers()` using native `fetch`
- [ ] Handle connection refused errors with meaningful messages
- [ ] Handle non-200 responses
- [ ] Create `src/connector/index.ts` re-exporting public API
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- admin-client`
- [ ] Test passes (green phase)

**Estimated Effort:** 2 hours

---

### Test: DockerOrchestrator connector integration

**File:** `packages/townhouse/src/docker/orchestrator-connector.test.ts`

**Tasks to make this test pass:**

- [ ] Refactor `buildConnectorEnv()` in orchestrator to use `ConnectorConfigGenerator.toEnvArray()`
- [ ] Add `regenerateConnectorConfig(activeNodes: NodeType[]): Promise<void>` method
- [ ] Add `addNode(type: NodeType): Promise<void>` method
- [ ] Add `removeNode(type: NodeType): Promise<void>` method
- [ ] Add `connectorRestarting` and `connectorRestarted` events to `OrchestratorEvents`
- [ ] Emit events in correct sequence during restart
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- orchestrator-connector`
- [ ] Test passes (green phase)

**Estimated Effort:** 3 hours

---

### Test: Integration — connector + node communication

**File:** `packages/townhouse/src/__integration__/connector-integration.test.ts`

**Tasks to make this test pass:**

- [ ] Ensure all unit test tasks above are complete
- [ ] Update `docker-compose-townhouse.yml` with CONNECTOR_PEERS env var
- [ ] Add BTP port 3000 exposure to node containers
- [ ] Create `vitest.integration.config.ts` (done)
- [ ] Run integration test: `RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse vitest run --config vitest.integration.config.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 2 hours

---

## Running Tests

```bash
# Run all unit tests for this story (skipped tests show as skipped, not failed)
pnpm --filter @toon-protocol/townhouse test

# Run specific test file — config generator
pnpm --filter @toon-protocol/townhouse test -- config-generator

# Run specific test file — admin client
pnpm --filter @toon-protocol/townhouse test -- admin-client

# Run specific test file — orchestrator connector
pnpm --filter @toon-protocol/townhouse test -- orchestrator-connector

# Run integration tests (requires Docker)
RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse vitest run --config vitest.integration.config.ts

# Run all tests with coverage
pnpm --filter @toon-protocol/townhouse test -- --coverage
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All tests written and skipped (red phase)
- Test patterns follow Story 21.2 conventions
- Mock strategy documented
- Implementation checklist created

**Verification:**

- All tests are `.skip()` — they will be reported as skipped, not failed
- When `.skip()` is removed, tests will fail due to missing imports/implementation
- Failure messages are clear: module not found or method does not exist

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Start with Task 1** (ConnectorConfigGenerator) — pure logic, no dependencies
2. **Remove `it.skip()`** from config-generator tests one group at a time
3. **Implement minimal code** to make each test group pass
4. **Then Task 3** (ConnectorAdminClient) — also standalone
5. **Then Task 2** (Orchestrator integration) — depends on Task 1
6. **Finally Task 7** (Integration tests) — depends on all above

**Key Principles:**

- One test group at a time (peer list first, then ATOR, then env vars)
- Follow the existing patterns in `orchestrator.test.ts`
- Use dependency injection for testability
- Keep co-located test files

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all 50 tests pass
2. Extract shared helpers if duplication found
3. Verify TypeScript strict mode compliance
4. Ensure integration tests clean up Docker resources
5. Run full package test suite: `pnpm --filter @toon-protocol/townhouse test`

---

## Next Steps

1. **Implement Story 21.3** using the implementation checklist above
2. **Remove `it.skip()`** from tests as each module is implemented
3. **Run tests** after each implementation task to verify green phase
4. **Run integration tests** with Docker after all unit tests pass
5. **Update story status** to done when all tests pass

---

## Knowledge Base References Applied

- **data-factories.md** - Factory patterns for config generation (`configWithNodes()`, `createMockDocker()`)
- **test-quality.md** - Deterministic tests, isolation, explicit assertions, parallel-safe
- **test-levels-framework.md** - Unit for pure logic, integration for Docker + network interaction
- **test-healing-patterns.md** - Error handling patterns for connection refused scenarios

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/townhouse test`

**Expected Results:**

- config-generator.test.ts: 20 skipped
- admin-client.test.ts: 11 skipped
- orchestrator-connector.test.ts: 12 skipped
- connector-integration.test.ts: 8 skipped (also gated by RUN_DOCKER_INTEGRATION)

**Summary:**

- Total new tests: 51
- Passing: 0 (expected - all skipped)
- Skipped: 51 (expected - TDD red phase)
- Status: RED phase verified

---

## Notes

- Integration tests require `RUN_DOCKER_INTEGRATION=1` env var — skipped in CI by default
- All test patterns follow Story 21.2 conventions for consistency
- The `createMockDocker()` factory is duplicated across test files for isolation — consider extracting to shared helper during refactor phase
- Connector restart uses short timeout (`{ t: 5 }`) since connector is stateless — different from node containers (`{ t: 10 }`)

---

**Generated by BMad TEA Agent** - 2026-04-20
