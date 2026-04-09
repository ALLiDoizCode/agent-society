---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-generation
  - step-04-data-infrastructure
  - step-05-implementation-checklist
  - step-06-deliverables
lastStep: step-06-deliverables
lastSaved: '2026-03-30'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/10-9-seed-orchestrator.md
  - packages/rig/playwright.config.ts
  - packages/rig/vitest.seed.config.ts
  - packages/rig/tests/e2e/seed/seed-all.ts
  - packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts
  - packages/rig/tests/e2e/seed/lib/constants.ts
  - packages/rig/tests/e2e/seed/lib/index.ts
  - packages/rig/tests/e2e/seed/lib/clients.ts
  - packages/rig/tests/e2e/seed/push-08-close.ts
---

# ATDD Checklist - Epic 10, Story 10.9: Seed Orchestrator

**Date:** 2026-03-30
**Author:** Jonathan
**Primary Test Level:** Unit (source introspection + pure function testing)

---

## Story Summary

Seed orchestrator (`seed-all.ts`) that runs all 8 push scripts in sequence, checks infrastructure health, manages freshness, and exports typed state for Playwright specs.

**As a** TOON developer
**I want** a seed orchestrator that runs all 8 push scripts in sequence with health checks, freshness management, and typed state export
**So that** Playwright `globalSetup` can seed all test data in a single deterministic pass and specs can consume a validated `state.json`

---

## Acceptance Criteria

1. **AC-9.1:** `seed/seed-all.ts` checks services ready via `checkAllServicesReady()` -- polls Peer1 BLS, Peer2 BLS, and Anvil with 30s timeout before starting seeds.
2. **AC-9.2:** Runs push-01 through push-08 in sequence, each receiving the accumulated state from the prior push.
3. **AC-9.3:** Exports final state to `seed/state.json` containing all Push08State fields plus `generatedAt` ISO timestamp.
4. **AC-9.4:** Configured as Playwright `globalSetup` -- exports a default async function matching Playwright's contract signature.
5. **AC-9.5:** Skips seeding if `state.json` exists and is fresh (< 10 min since `generatedAt`). Deletes stale file and re-seeds.
6. **AC-9.6:** Total seed time < 60 seconds (excluding Arweave indexing wait).

---

## Failing Tests Created (RED Phase)

### Unit Tests (22 tests failing, 1 passing, 6 todo)

**File:** `packages/rig/tests/e2e/seed/__tests__/seed-all.test.ts` (435 lines)

- FAIL **Test:** `[P0] AC-9.4: should export globalSetup as default export`
  - **Status:** GREEN (passes against existing stub -- expected, must be preserved)
  - **Verifies:** Playwright globalSetup contract preserved

- FAIL **Test:** `[P0] AC-9.1: should export checkAllServicesReady function`
  - **Status:** RED - module does not export checkAllServicesReady
  - **Verifies:** AC-9.1 named export

- FAIL **Test:** `[P0] AC-9.3: source contains interface SeedState`
  - **Status:** RED - stub does not define SeedState
  - **Verifies:** AC-9.3 type definition

- FAIL **Test:** `[P0] AC-9.3: SeedState interface declares generatedAt: string`
  - **Status:** RED - no SeedState interface in source
  - **Verifies:** AC-9.3 generatedAt field

- FAIL **Test:** `[P0] AC-9.3: SeedState interface contains all Push08State fields`
  - **Status:** RED - no SeedState interface with required fields
  - **Verifies:** AC-9.3 complete state shape

- FAIL **Test:** `[P0] AC-9.3: should export loadSeedState function`
  - **Status:** RED - no loadSeedState export
  - **Verifies:** AC-9.3 state loading

- FAIL **Test:** `[P0] AC-9.3: should export saveSeedState function`
  - **Status:** RED - no saveSeedState export
  - **Verifies:** AC-9.3 state persistence

- FAIL **Test:** `[P0] AC-9.5: should export isFresh function`
  - **Status:** RED - no isFresh export
  - **Verifies:** AC-9.5 freshness check

- FAIL **Test:** `[P0] AC-9.5: isFresh returns true for timestamp < 10 min ago`
  - **Status:** RED - isFresh not exported
  - **Verifies:** AC-9.5 fresh timestamp

- FAIL **Test:** `[P0] AC-9.5: isFresh returns false for timestamp > 10 min ago`
  - **Status:** RED - isFresh not exported
  - **Verifies:** AC-9.5 stale timestamp

- FAIL **Test:** `[P1] AC-9.5: isFresh uses default TTL of 10 minutes when not provided`
  - **Status:** RED - isFresh not exported
  - **Verifies:** AC-9.5 default TTL

- FAIL **Test:** `[P0] AC-9.2: source imports from all 8 push scripts`
  - **Status:** RED - stub has no push imports
  - **Verifies:** AC-9.2 all push scripts imported

- FAIL **Test:** `[P0] AC-9.2: source imports runPush01 through runPush08 functions`
  - **Status:** RED - stub has no runPushXX imports
  - **Verifies:** AC-9.2 function imports

- FAIL **Test:** `[P0] AC-9.1: source imports createSeedClients and stopAllClients from lib`
  - **Status:** RED - stub has no lib imports
  - **Verifies:** AC-9.1 client lifecycle imports

- FAIL **Test:** `[P0] AC-9.1: source imports AGENT_IDENTITIES from lib`
  - **Status:** RED - stub has no AGENT_IDENTITIES import
  - **Verifies:** AC-9.1 identity access

- FAIL **Test:** `[P0] AC-9.1: source imports PEER1_BLS_URL, PEER2_BLS_URL, and ANVIL_RPC from lib`
  - **Status:** RED - stub has no URL constant imports
  - **Verifies:** AC-9.1 service URL imports

- FAIL **Test:** `[P0] AC-9.1: checkAllServicesReady polls Peer1 BLS, Peer2 BLS, and Anvil`
  - **Status:** RED - no health check implementation
  - **Verifies:** AC-9.1 three-service polling with Promise.all

- FAIL **Test:** `[P1] AC-9.5: source contains freshness check with 10-minute TTL`
  - **Status:** RED - no freshness logic
  - **Verifies:** AC-9.5 TTL constant and isFresh usage

- FAIL **Test:** `[P1] AC-9.3: saveSeedState writes state.json with generatedAt timestamp`
  - **Status:** RED - no state persistence
  - **Verifies:** AC-9.3 state file writing

- FAIL **Test:** `[P1] AC-9.2: source imports ShaToTxIdMap type from lib`
  - **Status:** RED - no type import
  - **Verifies:** AC-9.2 type dependency

- FAIL **Test:** `[P1] AC-9.2: source derives secret keys for alice, bob, and carol`
  - **Status:** RED - no key derivation
  - **Verifies:** AC-9.2 secret key pattern

- FAIL **Test:** `[P1] AC-9.4: source uses finally block to call stopAllClients`
  - **Status:** RED - no finally block
  - **Verifies:** AC-9.4 cleanup

- FAIL **Test:** `[P1] AC-9.2: source contains sequential push progress logging`
  - **Status:** RED - no logging
  - **Verifies:** AC-9.2 progress output

---

## Data Factories Created

N/A -- This story has no UI components, API endpoints, or randomized test data. Tests use source introspection and pure function testing with inline mock timestamps.

---

## Fixtures Created

N/A -- Tests are stateless source introspection and pure function tests. No setup/teardown needed.

---

## Mock Requirements

N/A -- Unit tests use source introspection (fs.readFileSync) and pure function testing (isFresh with mock timestamps). Integration tests (.todo) require live SDK E2E infrastructure (`./scripts/sdk-e2e-infra.sh up`).

---

## Required data-testid Attributes

N/A -- No UI components in this story.

---

## Implementation Checklist

### Task 0: Add PEER2_BLS_URL to seed lib barrel (AC-9.1)

**Files:** `packages/rig/tests/e2e/seed/lib/constants.ts`, `packages/rig/tests/e2e/seed/lib/index.ts`

**Tasks to make affected tests pass:**

- [ ] Add `PEER2_BLS_URL` to the re-export list in `constants.ts` (from `docker-e2e-setup.ts`)
- [ ] Add `PEER2_BLS_URL` to the barrel re-export in `index.ts`
- [ ] Run test: `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts`

**Estimated Effort:** 0.1 hours

---

### Task 1: Implement checkAllServicesReady() (AC-9.1)

**File:** `packages/rig/tests/e2e/seed/seed-all.ts`

**Tasks to make these tests pass:**
- `[P0] AC-9.1: should export checkAllServicesReady function`
- `[P0] AC-9.1: checkAllServicesReady polls Peer1 BLS, Peer2 BLS, and Anvil`
- `[P0] AC-9.1: source imports PEER1_BLS_URL, PEER2_BLS_URL, and ANVIL_RPC from lib`

- [ ] Import PEER1_BLS_URL, PEER2_BLS_URL, ANVIL_RPC from `./lib/index.js`
- [ ] Implement `checkAllServicesReady()` with three concurrent polls via `Promise.all`
- [ ] Poll Peer1/Peer2 BLS: GET `${URL}/health`, expect 200
- [ ] Poll Anvil: POST `eth_blockNumber` JSON-RPC, expect response
- [ ] 30s timeout, 1s retry interval, `AbortSignal.timeout(2000)` per request
- [ ] Throw descriptive error naming failed service(s)
- [ ] Export the function
- [ ] Run tests

**Estimated Effort:** 0.5 hours

---

### Task 2: Implement SeedState interface and helpers (AC-9.3, AC-9.5)

**File:** `packages/rig/tests/e2e/seed/seed-all.ts`

**Tasks to make these tests pass:**
- `[P0] AC-9.3: source contains interface SeedState`
- `[P0] AC-9.3: SeedState interface declares generatedAt: string`
- `[P0] AC-9.3: SeedState interface contains all Push08State fields`
- `[P0] AC-9.3: should export loadSeedState function`
- `[P0] AC-9.3: should export saveSeedState function`
- `[P0] AC-9.5: should export isFresh function`
- `[P0] AC-9.5: isFresh returns true/false for fresh/stale timestamps`
- `[P1] AC-9.5: isFresh uses default TTL of 10 minutes`

- [ ] Define `export interface SeedState` with all Push08State fields + `generatedAt: string`
- [ ] Implement `saveSeedState(state: Push08State)` that writes `state.json` with `generatedAt = new Date().toISOString()`
- [ ] Implement `loadSeedState()` that reads/parses `state.json`, returns `SeedState | null`
- [ ] Implement `isFresh(state: SeedState, ttlMs = 10 * 60 * 1000)` pure function
- [ ] Derive STATE_FILE path using `import.meta.dirname`
- [ ] Export all functions
- [ ] Run tests

**Estimated Effort:** 0.5 hours

---

### Task 3: Implement sequential push orchestration (AC-9.2, AC-9.6)

**File:** `packages/rig/tests/e2e/seed/seed-all.ts`

**Tasks to make these tests pass:**
- `[P0] AC-9.2: source imports from all 8 push scripts`
- `[P0] AC-9.2: source imports runPush01 through runPush08 functions`
- `[P0] AC-9.1: source imports createSeedClients and stopAllClients from lib`
- `[P0] AC-9.1: source imports AGENT_IDENTITIES from lib`
- `[P1] AC-9.2: source imports ShaToTxIdMap type from lib`
- `[P1] AC-9.2: source derives secret keys for alice, bob, and carol`
- `[P1] AC-9.2: source contains sequential push progress logging`

- [ ] Import all 8 `runPushXX` functions from push script files (`.js` extension)
- [ ] Import `createSeedClients`, `stopAllClients`, `AGENT_IDENTITIES`, `ShaToTxIdMap` from `./lib/index.js`
- [ ] Derive aliceKey, bobKey, carolKey from `AGENT_IDENTITIES.{name}.secretKeyHex`
- [ ] Call pushes sequentially with correct parameter signatures (see story Dev Notes)
- [ ] Log `[seed] Push N/8 complete` after each push
- [ ] Log total seed time after push 8
- [ ] Fail-fast on push failure (log which push failed, re-throw)
- [ ] Run tests

**Estimated Effort:** 0.5 hours

---

### Task 4: Implement globalSetup default export (AC-9.4, AC-9.5)

**File:** `packages/rig/tests/e2e/seed/seed-all.ts`

**Tasks to make these tests pass:**
- `[P0] AC-9.4: should export globalSetup as default export`
- `[P1] AC-9.4: source uses finally block to call stopAllClients`
- `[P1] AC-9.5: source contains freshness check with 10-minute TTL`
- `[P1] AC-9.3: saveSeedState writes state.json with generatedAt timestamp`

- [ ] Replace no-op stub with full `globalSetup` implementation
- [ ] Check freshness first -- if state.json exists and is fresh, log and return early
- [ ] If stale/missing: delete stale file, run `checkAllServicesReady()`, run orchestration, save state
- [ ] Use `finally` block to call `stopAllClients()`
- [ ] Run all tests: `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts`
- [ ] Verify all 22 non-todo tests pass (GREEN phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts

# Run with verbose output
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts --reporter=verbose

# Run all seed tests (all stories)
cd packages/rig && npx vitest run --config vitest.seed.config.ts

# Debug specific test
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts -t "checkAllServicesReady"
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 22 unit tests written and failing (1 passes against existing stub -- expected)
- 6 integration test stubs (.todo) for live infrastructure testing
- No factories or fixtures needed (source introspection + pure function tests)
- Implementation checklist created mapping tests to code tasks

**Verification:**

- 22 tests fail as expected (source introspection finds stub, not implementation)
- 1 test passes (globalSetup default export -- preserved from stub)
- Failures are due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. Task 0: Add `PEER2_BLS_URL` to constants and barrel
2. Task 1: Implement `checkAllServicesReady()`
3. Task 2: Implement `SeedState` interface, `loadSeedState`, `saveSeedState`, `isFresh`
4. Task 3: Implement sequential push orchestration with imports and key derivation
5. Task 4: Implement full `globalSetup` replacing the no-op stub

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

1. Verify all 22 tests pass
2. Review for DRY (polling pattern reuse)
3. Verify `state.json` path derivation is correct
4. Ensure fail-fast error messages are descriptive
5. Run full seed test suite: `cd packages/rig && npx vitest run --config vitest.seed.config.ts`

---

## Next Steps

1. Run failing tests to confirm RED phase: `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts`
2. Begin implementation with Task 0 (PEER2_BLS_URL barrel addition)
3. Work through Tasks 1-4 sequentially
4. Run tests after each task to verify progress
5. When all tests pass, run full seed test suite

---

## Knowledge Base References Applied

- **test-quality.md** - Test design principles (Given-When-Then, determinism, isolation)
- **test-levels-framework.md** - Test level selection (unit source introspection for type-erased interfaces)
- **data-factories.md** - Determined N/A for this story (no randomized test data)
- **fixture-architecture.md** - Determined N/A (stateless tests)
- **component-tdd.md** - Determined N/A (no UI components)

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/seed-all.test.ts`

**Results:**

```
 Test Files  1 failed (1)
      Tests  22 failed | 1 passed | 6 todo (29)
   Duration  262ms
```

**Summary:**

- Total tests: 29 (22 unit + 1 passing + 6 todo)
- Passing: 1 (globalSetup default export -- expected, stub preserves contract)
- Failing: 22 (expected)
- Todo: 6 (integration stubs)
- Status: RED phase verified

---

## Notes

- The 1 passing test (`globalSetup default export`) is expected -- the existing stub already exports the correct signature. All other tests verify implementation that does not yet exist.
- Task 0 (PEER2_BLS_URL barrel addition) is a prerequisite for the orchestrator to compile. Must be done first.
- Push script parameter naming: carol client/key map to `charlieClient`/`charlieSecretKey` params in push-06 and push-07. Use `carol`/`carolKey` naming in orchestrator.
- `state.json` is already gitignored in `packages/rig/.gitignore`.

---

**Generated by BMad TEA Agent** - 2026-03-30
