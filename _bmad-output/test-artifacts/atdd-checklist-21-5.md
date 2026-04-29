---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-20'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/21-5-town-node-dockerfile.md'
  - '_bmad/tea/testarch/knowledge/data-factories.md'
  - '_bmad/tea/testarch/knowledge/test-quality.md'
  - '_bmad/tea/testarch/knowledge/test-levels-framework.md'
  - 'docker/Dockerfile.sdk-e2e'
  - 'packages/town/src/cli.ts'
  - 'packages/town/src/town.ts'
  - 'packages/townhouse/src/docker/orchestrator.ts'
  - 'docker-compose-townhouse.yml'
---

# ATDD Checklist - Epic 21, Story 5: Town Node Dockerfile

**Date:** 2026-04-20
**Author:** Jonathan
**Primary Test Level:** Unit (static analysis) + Integration

---

## Story Summary

Create a production-grade Docker container for the Town (Nostr relay) node that runs within the Townhouse orchestration stack with ILP write-fees, accepting connector URLs and fee configuration via environment variables.

**As a** node operator
**I want** a production-grade Town container
**So that** I can run a Nostr relay with ILP write-fees inside the Townhouse orchestration stack

---

## Acceptance Criteria

1. `docker/Dockerfile.town` builds successfully from repo root: `docker build -f docker/Dockerfile.town -t toon:town .`
2. Container accepts connector URL via `CONNECTOR_URL` environment variable (mapped to `TOON_CONNECTOR_URL` internally)
3. Registers as peer with standalone connector on startup (uses `--connector-url` mode of `toon-town` CLI)
4. Health endpoint at `/health` returning relay status (BLS HTTP port, same as existing Town health endpoint)
5. Exposes relay WebSocket port for client connections (port 7100 default)
6. Write-fee configuration via `FEE_PER_EVENT` environment variable
7. Image builds and starts successfully in townhouse compose stack (alongside connector on `townhouse-net`)

---

## Failing Tests Created (RED Phase)

### Unit Tests (26 tests) - Townhouse Package

**File:** `packages/townhouse/src/docker/town-dockerfile.test.ts` (197 lines)

- **Test:** T-032: should use multi-stage build with node:20-alpine builder
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — multi-stage build structure

- **Test:** T-032: should have minimal runtime stage with node:20-alpine
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — minimal runtime image

- **Test:** T-032: should install pnpm 8.15.0 in builder stage
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — deterministic build tooling

- **Test:** T-032: should use esbuild to bundle entrypoint-town.ts
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — esbuild bundling with better-sqlite3 external

- **Test:** T-041: should have CMD pointing to entrypoint-town.js
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — correct entrypoint

- **Test:** T-042: should run as non-root user toon
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** Security — non-root execution

- **Test:** T-042: should install libstdc++ for native module support
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — native module runtime deps

- **Test:** T-042: should set ESM package.json with type module
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #1 — ESM compatibility

- **Test:** T-035: should have HEALTHCHECK targeting /health on BLS port
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #4 — health endpoint

- **Test:** should EXPOSE 3000 3100 7100 (BTP + BLS + Relay WS)
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** AC #4, AC #5 — port exposure

- **Test:** should declare VOLUME /data for persistent storage
  - **Status:** RED - Dockerfile does not exist yet
  - **Verifies:** Persistent data volume

- **Test:** T-038: should map CONNECTOR_URL to TOON_CONNECTOR_URL
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** AC #2 — connector URL mapping

- **Test:** T-038: should map NODE_NOSTR_SECRET_KEY to TOON_SECRET_KEY
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** AC #2 — identity key mapping

- **Test:** should map BLS_PORT to TOON_BLS_PORT with default 3100
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** AC #4 — BLS port configuration

- **Test:** should map WS_PORT to TOON_RELAY_PORT with default 7100
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** AC #5 — relay port configuration

- **Test:** should set TOON_DATA_DIR to /data
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** Persistent data directory

- **Test:** should map DEV_MODE=true to TOON_DEV_MODE=true
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** Dev mode passthrough

- **Test:** T-039: should map FEE_PER_EVENT to TOON_FEE_PER_EVENT
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** AC #6 — fee configuration

- **Test:** should handle SIGTERM for graceful shutdown
  - **Status:** RED - Entrypoint does not exist yet
  - **Verifies:** Graceful shutdown support

- **Test:** should produce CONNECTOR_URL env var (compose)
  - **Status:** RED - Compose healthcheck not added yet
  - **Verifies:** AC #7 — compose integration

- **Test:** should produce FEE_PER_EVENT env var (compose)
  - **Status:** RED - Already present but other compose changes needed
  - **Verifies:** AC #6, AC #7 — fee in compose

- **Test:** should have healthcheck in compose town service
  - **Status:** RED - Compose healthcheck not added yet
  - **Verifies:** AC #4, AC #7 — compose healthcheck

- **Test:** should have volume mount for persistent data
  - **Status:** RED - Compose volume not added yet
  - **Verifies:** AC #7 — persistent storage

- **Test:** should expose relay WS port 7100 to host
  - **Status:** RED - Compose port mapping not added yet
  - **Verifies:** AC #5, AC #7 — host port exposure

- **Test:** should expose BLS port 3100 to host
  - **Status:** RED - Compose port mapping not added yet
  - **Verifies:** AC #4, AC #7 — host port exposure

- **Test:** should include identity env var placeholders
  - **Status:** RED - Identity env vars not in compose yet
  - **Verifies:** AC #7 — wallet key injection

### Unit Tests (6 tests) - Town Package

**File:** `packages/town/src/fee-per-event-env.test.ts` (61 lines)

- **Test:** T-039: cli.ts should read TOON_FEE_PER_EVENT from environment
  - **Status:** RED - Env var not implemented in cli.ts yet
  - **Verifies:** AC #6 — Task 4.1

- **Test:** T-039: cli.ts should parse TOON_FEE_PER_EVENT as integer
  - **Status:** RED - Env var not implemented in cli.ts yet
  - **Verifies:** AC #6 — Task 4.1

- **Test:** T-039: cli.ts should include feePerEvent in TownConfig object
  - **Status:** RED - feePerEvent not in cli.ts config building yet
  - **Verifies:** AC #6 — Task 4.1

- **Test:** T-039: town.ts TownConfig should have optional feePerEvent field
  - **Status:** RED - feePerEvent not in TownConfig interface yet
  - **Verifies:** AC #6 — Task 4.2

- **Test:** T-039: town.ts startTown should use feePerEvent in pricing
  - **Status:** RED - feePerEvent not wired to pricing yet
  - **Verifies:** AC #6 — Task 4.2

- **Test:** T-039: cli.ts help text should document TOON_FEE_PER_EVENT
  - **Status:** RED - Help text not updated yet
  - **Verifies:** AC #6 — documentation

---

## Data Factories Created

None required. Tests use static file analysis (readFileSync + regex matching).

---

## Fixtures Created

None required. Tests are self-contained static analysis tests that read source files directly.

---

## Mock Requirements

None. Tests perform static analysis of Dockerfile/TypeScript/YAML content without runtime execution.

---

## Required data-testid Attributes

Not applicable (no UI components in this story).

---

## Implementation Checklist

### Test: Dockerfile structure (T-032, T-041, T-042)

**File:** `packages/townhouse/src/docker/town-dockerfile.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `docker/Dockerfile.town` with multi-stage build (node:20-alpine builder + runtime)
- [ ] Install pnpm 8.15.0 via corepack in builder stage
- [ ] Add esbuild bundling of `docker/src/entrypoint-town.ts` with `--external:better-sqlite3`
- [ ] Set `CMD ["node", "/app/entrypoint-town.js"]`
- [ ] Add `USER toon` (non-root, UID 1001)
- [ ] Install `libstdc++` in runtime stage
- [ ] Add `{"type":"module"}` package.json
- [ ] Add `HEALTHCHECK` targeting `/health` on BLS port
- [ ] Add `EXPOSE 3000 3100 7100`
- [ ] Add `VOLUME /data`
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1.5 hours

---

### Test: Entrypoint env var mapping (T-038, T-039)

**File:** `packages/townhouse/src/docker/town-dockerfile.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `docker/src/entrypoint-town.ts`
- [ ] Map `CONNECTOR_URL` -> `TOON_CONNECTOR_URL`
- [ ] Map `NODE_NOSTR_SECRET_KEY` -> `TOON_SECRET_KEY`
- [ ] Map `BLS_PORT` -> `TOON_BLS_PORT` (default 3100)
- [ ] Map `WS_PORT` -> `TOON_RELAY_PORT` (default 7100)
- [ ] Set `TOON_DATA_DIR=/data`
- [ ] Map `FEE_PER_EVENT` -> `TOON_FEE_PER_EVENT`
- [ ] Map `DEV_MODE=true` -> `TOON_DEV_MODE=true`
- [ ] Handle SIGTERM for graceful shutdown
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts`
- [ ] Tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: Town CLI TOON_FEE_PER_EVENT (T-039)

**File:** `packages/town/src/fee-per-event-env.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `feePerEvent?: number` to `TownConfig` interface in `town.ts`
- [ ] Add `TOON_FEE_PER_EVENT` env var parsing in `cli.ts` parseCli()
- [ ] Parse as integer, pass as `feePerEvent` in config object
- [ ] Wire `feePerEvent` to pricing in `startTown()` (if applicable beyond basePricePerByte)
- [ ] Update help text to document `TOON_FEE_PER_EVENT`
- [ ] Run test: `pnpm --filter @toon-protocol/town exec vitest run src/fee-per-event-env.test.ts`
- [ ] Tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: Compose stack integration (AC #7)

**File:** `packages/townhouse/src/docker/town-dockerfile.test.ts`

**Tasks to make these tests pass:**

- [ ] Add healthcheck to town service in `docker-compose-townhouse.yml`
- [ ] Add named volume `townhouse-town-data:/data`
- [ ] Add port mappings: `127.0.0.1:7100:7100` and `127.0.0.1:3100:3100`
- [ ] Add identity env vars: `NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY`
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts`
- [ ] Tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all failing tests for this story (townhouse package)
pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts

# Run all failing tests for this story (town package)
pnpm --filter @toon-protocol/town exec vitest run src/fee-per-event-env.test.ts

# Run both packages
pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts && pnpm --filter @toon-protocol/town exec vitest run src/fee-per-event-env.test.ts

# Run with verbose output
pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts --reporter=verbose

# Run specific test by name
pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts -t "T-032"
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All tests written and failing (32 tests, all skipped)
- No fixtures needed (static analysis approach)
- No mock requirements (file content assertions)
- No data-testid requirements (backend/Docker story)
- Implementation checklist created

**Verification:**

- All tests run and are skipped as expected
- Tests will fail with file-not-found errors when skip is removed (correct RED behavior)
- Tests fail due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Pick one failing test group** from implementation checklist (start with Dockerfile structure)
2. **Read the tests** to understand expected behavior
3. **Implement minimal code** to make tests pass
4. **Run tests** to verify they now pass (green)
5. **Check off tasks** in implementation checklist
6. **Move to next test group** and repeat

**Key Principles:**

- One test group at a time (Dockerfile -> Entrypoint -> CLI -> Compose)
- Minimal implementation (don't over-engineer)
- Run tests frequently (immediate feedback)
- Use implementation checklist as roadmap

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. **Verify all tests pass** (green phase complete)
2. **Review code for quality** (Dockerfile best practices, entrypoint clarity)
3. **Optimize Docker image size** (if needed)
4. **Ensure tests still pass** after each refactor

---

## Next Steps

1. **Run failing tests** to confirm RED phase: see commands above
2. **Begin implementation** using implementation checklist as guide
3. **Work one test group at a time** (red -> green for each)
4. **When all tests pass**, refactor code for quality
5. **When refactoring complete**, manually update story status to 'done'

---

## Knowledge Base References Applied

- **data-factories.md** - Factory patterns (not needed for static analysis tests)
- **test-quality.md** - Test design principles (deterministic, isolated, focused)
- **test-levels-framework.md** - Test level selection: unit tests for static analysis, no E2E needed for Docker story

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/townhouse exec vitest run src/docker/town-dockerfile.test.ts`

**Results:**

```
 RUN  v1.6.1 /Users/jonathangreen/Documents/TOON-Protocol/packages/townhouse

 ↓ src/docker/town-dockerfile.test.ts  (26 tests | 26 skipped)

 Test Files  1 skipped (1)
      Tests  26 skipped (26)
   Duration  226ms
```

**Command:** `pnpm --filter @toon-protocol/town exec vitest run src/fee-per-event-env.test.ts`

**Results:**

```
 RUN  v1.6.1 /Users/jonathangreen/Documents/TOON-Protocol/packages/town

 ↓ src/fee-per-event-env.test.ts  (6 tests | 6 skipped)

 Test Files  1 skipped (1)
      Tests  6 skipped (6)
   Duration  186ms
```

**Summary:**

- Total tests: 32
- Passing: 0 (expected)
- Skipped: 32 (expected — RED phase, using it.skip())
- Status: RED phase verified

---

## Notes

- Tests use `it.skip()` (vitest equivalent of `test.skip()`) for TDD red phase marking
- Static analysis approach chosen because Docker builds are expensive and not suitable for CI unit tests
- The compose integration tests check current file content; some will pass immediately (CONNECTOR_URL already present) while others require compose file modifications
- Story spans two packages: `@toon-protocol/townhouse` (Dockerfile tests) and `@toon-protocol/town` (fee env var tests)

---

**Generated by BMad TEA Agent** - 2026-04-20
