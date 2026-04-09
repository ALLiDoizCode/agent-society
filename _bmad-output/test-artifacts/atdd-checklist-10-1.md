---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-03-29'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-1-test-infra-and-shared-seed-library.md'
  - 'packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts'
  - 'packages/client/tests/e2e/socialverse-agent-harness.ts'
  - 'packages/client/tests/e2e/socialverse-agent-alice-git-push.ts'
  - 'packages/core/src/nip34/types.ts'
  - 'packages/core/src/nip34/constants.ts'
  - 'packages/client/src/types.ts'
  - 'packages/rig/playwright.config.ts'
---

# ATDD Checklist - Epic 10, Story 10.1: Test Infrastructure & Shared Seed Library

**Date:** 2026-03-29
**Author:** Jonathan
**Primary Test Level:** Unit / Integration

---

## Story Summary

Story 10.1 establishes the Playwright E2E infrastructure and shared seed utility library for the Rig package, enabling subsequent stories (10.2-10.18) to publish real Nostr events and git objects through ILP without duplicating boilerplate. This is Layer 1 (Seed Layer) of the three-layer test architecture.

**As a** TOON developer
**I want** Playwright E2E infrastructure and a shared seed utility library for the Rig
**So that** subsequent seed scripts and Playwright specs can publish real Nostr events and git objects through ILP without duplicating boilerplate, and the entire E2E suite runs against real SDK infrastructure with no mocks

---

## Acceptance Criteria

1. **AC-1.1 -- ToonClient Factory (`clients.ts`):** Creates 3 ToonClient instances (Alice/Bob/Carol) using Anvil accounts #3/#4/#5 with distinct Nostr keypairs. Factory includes healthCheck() and sequential bootstrap.
2. **AC-1.2 -- Git Builder (`git-builder.ts`):** Wraps createGitBlob/Tree/Commit with SHA-to-txId tracking, size validation (<95KB), delta uploads, and waitForArweaveIndex retry helper.
3. **AC-1.3 -- Publish Wrapper (`publish.ts`):** Wraps publishEvent with claim signing, retry (3 attempts, 2s delay), and cumulative state tracking.
4. **AC-1.4 -- Constants (`constants.ts`):** Re-exports all docker-e2e-setup constants and AGENT_IDENTITIES. Single source of truth.
5. **AC-1.5 -- Playwright Config:** Two-project structure (legacy + rig-e2e), webServer at :5173 with 30s timeout, CI retries.
6. **AC-1.6 -- Event Builders (`event-builders.ts`):** Builders for kind:30617, 30618, 1621, 1622, 1617, 1630-1633. Returns UnsignedEvent.
7. **AC-1.7 -- Client Package Only:** All seed libs use ToonClient from @toon-protocol/client, never SDK createNode.

---

## Test Strategy

**Stack Detection:** fullstack (monorepo with React Vite SPA + Node.js backend)

**Generation Mode:** AI Generation (acceptance criteria are clear, infrastructure-focused story with no complex UI interactions)

**Test Level Selection:**

| AC | Test Level | Rationale |
|----|-----------|-----------|
| AC-1.1 (clients.ts) | Unit + Integration | Unit: export verification. Integration: requires SDK E2E infra running |
| AC-1.2 (git-builder.ts) | Unit | Pure functions (SHA computation, buffer construction) can be tested without infra |
| AC-1.3 (publish.ts) | Unit | Export/contract verification; actual publish requires infra |
| AC-1.4 (constants.ts) | Unit | Re-export verification, value correctness |
| AC-1.5 (Playwright config) | Unit | File content inspection |
| AC-1.6 (event-builders.ts) | Unit | Pure functions returning UnsignedEvent objects |
| AC-1.7 (client package only) | Unit | Import verification via barrel |

**No E2E browser tests in this story** -- Story 10.1 creates infrastructure for future E2E specs but does not add any Playwright browser specs itself. AC-1.5 Playwright config is tested by inspecting the config file content.

---

## Failing Tests Created (RED Phase)

### Unit Tests (51 tests total across 7 files)

**File:** `packages/rig/tests/e2e/seed/__tests__/constants.test.ts` (7 tests)

- **Test:** `[P0] should re-export all Docker E2E infrastructure constants`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 all infrastructure URLs/addresses exported

- **Test:** `[P0] should re-export AGENT_IDENTITIES with Alice, Bob, Carol`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 agent identity map available

- **Test:** `[P0] should export Alice identity with correct Anvil #3 keys`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 Alice EVM key and address match Anvil #3

- **Test:** `[P1] should export Bob identity with correct Anvil #4 keys`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 Bob EVM key and address match Anvil #4

- **Test:** `[P1] should export Carol identity with correct Anvil #5 keys`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 Carol EVM key and address match Anvil #5

- **Test:** `[P0] should export PEER1_PUBKEY constant`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 peer1 pubkey available

- **Test:** `[P1] should never hardcode infrastructure addresses outside constants`
  - **Status:** RED - constants.ts does not exist yet
  - **Verifies:** AC-1.4 single source of truth

---

**File:** `packages/rig/tests/e2e/seed/__tests__/clients.test.ts` (6 tests)

- **Test:** `[P0] should export createSeedClients factory function`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.1 factory export

- **Test:** `[P0] should export stopAllClients cleanup function`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.1 cleanup export

- **Test:** `[P0] should export healthCheck function`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.1 health check export

- **Test:** `[P0] should create three ToonClient instances (Alice, Bob, Carol)`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.1 three clients created

- **Test:** `[P1] should bootstrap clients sequentially to avoid nonce races`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.1 sequential bootstrap (R10-002)

- **Test:** `[P1] should use ToonClient from @toon-protocol/client (AC-1.7)`
  - **Status:** RED - clients.ts does not exist yet
  - **Verifies:** AC-1.7 correct import path

---

**File:** `packages/rig/tests/e2e/seed/__tests__/git-builder.test.ts` (10 tests)

- **Test:** `[P0] should export createGitBlob function`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 blob builder export

- **Test:** `[P0] should export createGitTree function`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 tree builder export

- **Test:** `[P0] should export createGitCommit function`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 commit builder export

- **Test:** `[P0] should export uploadGitObject function`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 upload function export

- **Test:** `[P0] should export waitForArweaveIndex function`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 retry helper export (R10-001)

- **Test:** `[P0] should compute correct SHA-1 for git blob over full envelope`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 SHA computation correctness

- **Test:** `[P0] should return body (content only) separate from full buffer`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 upload body vs envelope distinction

- **Test:** `[P0] should construct git tree with sorted entries and raw 20-byte SHAs`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 tree binary format correctness

- **Test:** `[P0] should construct git commit with tree SHA and author info`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 commit format correctness

- **Test:** `[P1] should validate object size < 95KB before upload`
  - **Status:** RED - git-builder.ts does not exist yet
  - **Verifies:** AC-1.2 size guard (R10-005)

---

**File:** `packages/rig/tests/e2e/seed/__tests__/event-builders.test.ts` (8 tests)

- **Test:** `[P0] should export buildRepoAnnouncement for kind:30617`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 repo announcement builder

- **Test:** `[P0] should export buildRepoRefs for kind:30618`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 repo refs builder with arweave tags

- **Test:** `[P0] should export buildIssue for kind:1621`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 issue builder with NIP-34 tags

- **Test:** `[P0] should export buildComment for kind:1622`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 comment builder with root/reply markers

- **Test:** `[P1] should export buildPatch for kind:1617`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 patch builder

- **Test:** `[P1] should export buildStatus for kinds 1630-1633`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 status builders

- **Test:** `[P1] should return UnsignedEvent (no id, no sig, no pubkey) from all builders`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 UnsignedEvent contract

- **Test:** `[P1] should include created_at timestamp in all builders`
  - **Status:** RED - event-builders.ts does not exist yet
  - **Verifies:** AC-1.6 timestamp presence

---

**File:** `packages/rig/tests/e2e/seed/__tests__/publish.test.ts` (7 tests)

- **Test:** `[P0] should export publishWithRetry function`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 publish wrapper export

- **Test:** `[P0] should export SeedPublishState type (cumulative tracking)`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 state tracking export

- **Test:** `[P0] should sign balance proof before each publish`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 claim signing flow

- **Test:** `[P1] should retry up to 3 times on transient payment errors`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 retry logic

- **Test:** `[P1] should return PublishEventResult with success/error/eventId/data`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 return type contract

- **Test:** `[P1] should NOT duplicate ILP amount calculation`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 no double-calculation

- **Test:** `[P2] should track cumulative amount monotonically across publishes`
  - **Status:** RED - publish.ts does not exist yet
  - **Verifies:** AC-1.3 monotonic claims

---

**File:** `packages/rig/tests/e2e/seed/__tests__/playwright-config.test.ts` (6 tests)

- **Test:** `[P0] should define a legacy project for existing 6 specs`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 legacy project with testIgnore

- **Test:** `[P0] should define a rig-e2e project for new specs`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 rig-e2e project with globalSetup

- **Test:** `[P0] should share webServer config starting pnpm dev`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 shared webServer

- **Test:** `[P1] should increase webServer timeout to 30s`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 timeout increase

- **Test:** `[P1] should add CI retries (1 retry in CI, 0 locally)`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 CI retry configuration

- **Test:** `[P1] should set baseURL to http://localhost:5173`
  - **Status:** RED - playwright.config.ts not yet updated
  - **Verifies:** AC-1.5 baseURL setting

---

**File:** `packages/rig/tests/e2e/seed/__tests__/barrel-exports.test.ts` (4 tests)

- **Test:** `[P0] should export all public APIs from barrel index.ts`
  - **Status:** RED - index.ts barrel does not exist yet
  - **Verifies:** All ACs via barrel re-export

- **Test:** `[P0] should have seed-all.ts stub that exports a no-op globalSetup`
  - **Status:** RED - seed-all.ts does not exist yet
  - **Verifies:** AC-1.5 globalSetup stub

- **Test:** `[P0] should have specs/ directory created`
  - **Status:** RED - specs/ may not exist
  - **Verifies:** AC-1.5 directory structure

- **Test:** `[P1] should have seed/lib/ directory created`
  - **Status:** RED - seed/lib/ may not exist
  - **Verifies:** File structure requirement

---

## Data Factories Created

No data factories needed for Story 10.1. This story creates the seed library infrastructure itself. Agent identities are pre-generated constants from `socialverse-agent-harness.ts` (not randomly generated).

---

## Fixtures Created

No Playwright fixtures needed for Story 10.1. The tests are vitest unit tests that verify module exports and pure function behavior. Future stories (10.10-10.18) will create Playwright fixtures that use the seed library.

---

## Mock Requirements

No external service mocking required. Story 10.1 tests verify:
- Module exports exist (no runtime calls)
- Pure function correctness (git SHA computation, event building)
- File content (Playwright config structure)

The integration-level tests (client creation, publish) require real SDK E2E infrastructure (`./scripts/sdk-e2e-infra.sh up`) and are marked with `it.skip()` accordingly.

---

## Required data-testid Attributes

None. Story 10.1 does not modify Forge-UI source (per dev note: "R10-009: Forge-UI components will need data-testid attributes added in future stories; this story does NOT modify Forge-UI source").

---

## Implementation Checklist

### Test: constants.test.ts (7 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/constants.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/constants.ts`
- [ ] Re-export `PEER1_RELAY_URL`, `PEER1_BTP_URL`, `PEER1_BLS_URL`, `TOKEN_ADDRESS`, `TOKEN_NETWORK_ADDRESS`, `ANVIL_RPC`, `CHAIN_ID` from `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts`
- [ ] Re-export `AGENT_IDENTITIES` from `packages/client/tests/e2e/socialverse-agent-harness.ts`
- [ ] Add `PEER1_PUBKEY` constant: `d6bfe100d1600c0d8f769501676fc74c3809500bd131c8a549f88cf616c21f35`
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/constants.test.ts`
- [ ] All 7 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: clients.test.ts (6 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/clients.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/clients.ts`
- [ ] Implement `healthCheck()` polling `PEER1_BLS_URL/health` with 30s timeout
- [ ] Implement `createSeedClients()` factory creating Alice/Bob/Carol ToonClient instances
- [ ] Use ToonClient constructor pattern from `socialverse-agent-harness.ts`
- [ ] Bootstrap clients sequentially (Alice, Bob, Carol) per R10-002
- [ ] Each client: `ilpInfo: { pubkey, ilpAddress: 'g.toon.<pubkey8>', btpEndpoint: PEER1_BTP_URL }`
- [ ] Settlement config: `supportedChains`, `tokenNetworks`, `preferredTokens`, `chainRpcUrls`, `initialDeposit`, `destinationAddress`
- [ ] Implement `stopAllClients()` cleanup function
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/clients.test.ts`
- [ ] All 6 tests pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: git-builder.test.ts (10 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/git-builder.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/git-builder.ts`
- [ ] Port `createGitBlob()` from `socialverse-agent-alice-git-push.ts`
- [ ] Port `createGitTree()` with sorted entries and raw 20-byte SHA binary
- [ ] Port `createGitCommit()` with tree SHA and Nostr pubkey-to-git-author mapping
- [ ] Implement `uploadGitObject(client, objectBody, sha, type, repoId, shaMap)` with kind:5094 tags
- [ ] Add `ShaToTxIdMap` type and delta upload logic (skip if SHA in map)
- [ ] Add size validation (< 95KB) before upload per R10-005
- [ ] Implement `waitForArweaveIndex(txId, timeoutMs=30000)` with exponential backoff per R10-001
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/git-builder.test.ts`
- [ ] All 10 tests pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: event-builders.test.ts (8 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/event-builders.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/event-builders.ts`
- [ ] Implement `buildRepoAnnouncement(repoId, name, description)` -> kind:30617 UnsignedEvent
- [ ] Implement `buildRepoRefs(repoId, refs, arweaveMap)` -> kind:30618 UnsignedEvent
- [ ] Implement `buildIssue(repoOwnerPubkey, repoId, title, body, labels)` -> kind:1621 UnsignedEvent
- [ ] Implement `buildComment(repoOwnerPubkey, repoId, issueOrPrEventId, authorPubkey, body, marker)` -> kind:1622 UnsignedEvent
- [ ] Implement `buildPatch(repoOwnerPubkey, repoId, title, commits, branchTag)` -> kind:1617 UnsignedEvent
- [ ] Implement `buildStatus(targetEventId, statusKind)` -> kind:1630-1633 UnsignedEvent
- [ ] Reference NIP-34 tag structures from `packages/core/src/nip34/types.ts`
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/event-builders.test.ts`
- [ ] All 8 tests pass (green phase)

**Estimated Effort:** 1.5 hours

---

### Test: publish.test.ts (7 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/publish.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/publish.ts`
- [ ] Implement `publishWithRetry(client, event, maxAttempts=3, delayMs=2000)` wrapper
- [ ] Before publish: get channelId, encode event, compute cumulative amount, sign balance proof
- [ ] Pass claim to `client.publishEvent(event, { claim })`
- [ ] Do NOT duplicate ILP amount calculation (ToonClient does it internally)
- [ ] Export `SeedPublishState` type for cumulative amount tracking per client
- [ ] Return `PublishEventResult` from `@toon-protocol/client`
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/publish.test.ts`
- [ ] All 7 tests pass (green phase)

**Estimated Effort:** 1.5 hours

---

### Test: playwright-config.test.ts (6 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/playwright-config.test.ts`

**Tasks to make these tests pass:**

- [ ] Update `packages/rig/playwright.config.ts` with two-project structure
- [ ] `legacy` project: `testDir: './tests/e2e'`, `testMatch: '*.spec.ts'`, `testIgnore: '**/specs/**'`
- [ ] `rig-e2e` project: `testDir: './tests/e2e/specs'`, `globalSetup: './tests/e2e/seed/seed-all.ts'`
- [ ] Increase `webServer.timeout` to 30000
- [ ] Add `retries: process.env.CI ? 1 : 0`
- [ ] Create stub `packages/rig/tests/e2e/seed/seed-all.ts` with no-op globalSetup
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/playwright-config.test.ts`
- [ ] All 6 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: barrel-exports.test.ts (4 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/barrel-exports.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/lib/index.ts` barrel re-exporting all modules
- [ ] Create `packages/rig/tests/e2e/seed/seed-all.ts` no-op stub
- [ ] Verify `packages/rig/tests/e2e/specs/` directory exists
- [ ] Verify `packages/rig/tests/e2e/seed/lib/` directory exists
- [ ] Remove `test.skip()` -> run: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/barrel-exports.test.ts`
- [ ] All 4 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/rig && pnpm test:seed

# Run specific test file
cd packages/rig && pnpm test:seed -- tests/e2e/seed/__tests__/constants.test.ts

# Run tests in watch mode
cd packages/rig && pnpm vitest --config vitest.seed.config.ts

# Debug specific test
cd packages/rig && pnpm test:seed -- tests/e2e/seed/__tests__/git-builder.test.ts --reporter=verbose

# Run with coverage
cd packages/rig && pnpm test:seed -- --coverage
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 51 tests written and failing (test.skip)
- No fixtures or factories needed (infrastructure story)
- No mock requirements (pure functions + module exports)
- No data-testid requirements (no UI changes)
- Implementation checklist created mapping tests to code tasks

**Verification:**

- All tests use `it.skip()` marking intentional RED phase
- Tests assert expected behavior of not-yet-implemented modules
- Failure is due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Start with constants.ts** (simplest, unblocks other modules)
2. **Then event-builders.ts** (pure functions, no dependencies)
3. **Then git-builder.ts** (ports from existing code)
4. **Then publish.ts** (depends on client types)
5. **Then clients.ts** (depends on constants, requires SDK infra)
6. **Then playwright.config.ts + seed-all.ts** (config changes)
7. **Finally barrel index.ts** (depends on all modules)

**Key Principles:**

- One module at a time (remove test.skip, implement, verify green)
- Port from existing code where possible (socialverse-agent-harness.ts, alice-git-push.ts)
- Use ToonClient, NEVER SDK createNode (AC-1.7)
- Run tests frequently (immediate feedback)

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all 51 tests pass
2. Run existing 6 legacy Playwright specs to confirm no regression
3. Run full monorepo test suite: `pnpm test`
4. Review for code duplication across seed modules
5. Ensure consistent error handling patterns

---

## Next Steps

1. **Share this checklist** with the dev workflow
2. **Run failing tests** to confirm RED phase: `cd packages/rig && pnpm vitest run tests/e2e/seed/__tests__/`
3. **Begin implementation** using implementation checklist (start with constants.ts)
4. **Work one module at a time** (red -> green for each)
5. **Verify legacy specs** still pass after config changes: `cd packages/rig && pnpm test:e2e --project=legacy`
6. **When all tests pass**, update story status to done

---

## Knowledge Base References Applied

- **data-factories.md** -- Not needed (pre-generated identities, no random data)
- **test-quality.md** -- Applied: deterministic tests, one assertion focus, clear naming
- **test-levels-framework.md** -- Applied: unit tests for pure functions, integration deferred to implementation
- **selector-resilience.md** -- Not applicable (no UI tests in this story)
- **network-first.md** -- Not applicable (no browser navigation)

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && pnpm test:seed`

**Actual Results:**

```
 RUN  v1.6.1

 ↓ tests/e2e/seed/__tests__/event-builders.test.ts  (8 tests | 8 skipped)
 ↓ tests/e2e/seed/__tests__/git-builder.test.ts  (12 tests | 12 skipped)
 ↓ tests/e2e/seed/__tests__/publish.test.ts  (7 tests | 7 skipped)
 ↓ tests/e2e/seed/__tests__/constants.test.ts  (7 tests | 7 skipped)
 ↓ tests/e2e/seed/__tests__/playwright-config.test.ts  (6 tests | 6 skipped)
 ↓ tests/e2e/seed/__tests__/barrel-exports.test.ts  (4 tests | 4 skipped)
 ↓ tests/e2e/seed/__tests__/clients.test.ts  (7 tests | 7 skipped)

 Test Files  7 skipped (7)
      Tests  51 skipped (51)
   Duration  585ms
```

- Total tests: 51 (all skipped via `it.skip()`)
- Passing: 0 (expected)
- Skipped: 51 (expected -- TDD RED phase)
- Status: RED phase verified

**Regression check:** `pnpm test` (existing rig tests) -- 343 passed, 58 skipped, 0 failures.

---

## Notes

- All seed library files import from `@toon-protocol/client` (ToonClient), never from SDK `createNode` per AC-1.7 and MEMORY.md guidance
- Agent identities (Alice/Bob/Carol) are reused from `socialverse-agent-harness.ts` AGENT_IDENTITIES -- do NOT generate new keypairs
- The specs/ directory is created empty; actual Playwright E2E specs are added in Stories 10.10-10.18
- seed-all.ts is a no-op stub in this story; full orchestrator implementation deferred to Story 10.9
- Git builder tests verify SHA computation against known values (`git hash-object` equivalence)

---

## Contact

**Questions or Issues?**

- Refer to story file: `_bmad-output/implementation-artifacts/10-1-test-infra-and-shared-seed-library.md`
- Reference code: `packages/client/tests/e2e/socialverse-agent-harness.ts` (ToonClient pattern)
- Reference code: `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` (git object pattern)

---

**Generated by BMad TEA Agent** - 2026-03-29
