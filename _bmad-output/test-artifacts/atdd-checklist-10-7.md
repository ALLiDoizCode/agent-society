---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-generation-mode',
    'step-03-test-strategy',
    'step-04c-aggregate',
    'step-05-validate-and-complete',
  ]
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-03-30'
workflowType: 'testarch-atdd'
inputDocuments:
  [
    '_bmad-output/implementation-artifacts/10-7-seed-issues-labels-conversations.md',
    'packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts',
    'packages/rig/tests/e2e/seed/lib/event-builders.ts',
    'packages/rig/vitest.seed.config.ts',
    '_bmad/tea/testarch/knowledge/test-quality.md',
    '_bmad/tea/testarch/knowledge/test-levels-framework.md',
    '_bmad/tea/testarch/knowledge/test-priorities-matrix.md',
  ]
---

# ATDD Checklist - Epic 10, Story 10.7: Seed Script -- Issues, Labels, Conversations (Push 7)

**Date:** 2026-03-30
**Author:** Jonathan
**Primary Test Level:** Unit (Vitest)

---

## Story Summary

Seed script that publishes 2 issues (kind:1621) with labels and multi-client comment threads (kind:1622) so that Playwright specs can verify issue listing, label filtering, comment threads, and multi-author attribution.

**As a** TOON developer
**I want** a seed script that publishes 2 issues with labels and 5 comments across two threads
**So that** Playwright specs can verify issue listing, label filtering, comment threads, and multi-author attribution

---

## Acceptance Criteria

1. **AC-7.1:** `seed/push-07-issues.ts` publishes 2 kind:1621 issues: Issue #1 "Add WebSocket reconnection logic" by Alice (t tags: enhancement, networking); Issue #2 "Fix deep path navigation bug" by Bob (t tags: bug, forge-ui). Both with `a` tag referencing repo.
2. **AC-7.2:** Comment thread on Issue #1 (kind:1622): Bob: "Should we use exponential backoff?", Alice: "Yes, with jitter. See RFC 6298.", Charlie: "What about connection pooling?" -- comments array preserves publication order.
3. **AC-7.3:** Comment thread on Issue #2: Alice: "Reproduced at depth 3+", Bob: "Root cause is in tree SHA resolution" -- comments array preserves publication order.
4. **AC-7.4:** All comments have correct `e` tag pointing to parent issue event ID, `p` tag for author threading, and `a` tag referencing the repository.

---

## Generation Mode

**Mode:** AI Generation (backend/unit tests -- no browser recording needed)
**Stack detected:** fullstack (but story scope is backend unit tests only)
**Framework:** Vitest via `vitest.seed.config.ts`
**Test command:** `cd packages/rig && pnpm test:seed`

---

## Test Strategy

| AC | Test Level | Priority | Scenario |
| --- | --- | --- | --- |
| AC-7.1 | Unit | P0 | `buildIssue` produces kind:1621 with correct tags for Issue #1 |
| AC-7.1 | Unit | P0 | `buildIssue` produces kind:1621 with correct tags for Issue #2 |
| AC-7.1 | Unit | P0 | Push07State.issues has 2 entries with correct structure |
| AC-7.1 | Unit | P0 | Exactly 7 `publishWithRetry` calls in source |
| AC-7.1 | Unit | P1 | Alice signs Issue #1, Bob signs Issue #2 |
| AC-7.2 | Unit | P0 | Issue #1 comments signed by Bob, Alice, Charlie (in order) |
| AC-7.3 | Unit | P0 | Issue #2 comments signed by Alice, Bob (in order) |
| AC-7.2/7.3 | Unit | P0 | Comments preserve publication order (5 entries) |
| AC-7.4 | Unit | P0 | `buildComment` produces kind:1622 with correct e, a, p tags |
| AC-7.4 | Unit | P0 | Comments published via correct clients |
| AC-7.1 | Unit | P0 | State passthrough -- all Push06State fields unchanged |
| AC-7.1 | Unit | P0 | No new git objects (commits, shaMap, files, prs passthrough) |
| -- | Unit | P0 | Module exports `runPush07` function |
| -- | Unit | P0 | Accepts 7 parameters (3 clients, 3 secret keys, push06State) |
| -- | Unit | P1 | Source does NOT import git builder functions |
| -- | Unit | P1 | Push07State interface has correct shape (issues + comments) |
| -- | Unit | P1 | Source imports Push06State from push-06-prs.js |
| -- | Unit | P1 | Event ID derivation uses fallback pattern |
| -- | Unit | P1 | Module does NOT import AGENT_IDENTITIES |
| -- | Unit | P1 | Module does NOT export git object creation functions |

---

## Failing Tests Created (RED Phase)

### Unit Tests (20 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts` (650 lines)

- **Test:** `[P0] should export runPush07 function`
  - **Status:** RED - Module not found (push-07-issues.ts does not exist)
  - **Verifies:** Module structure (AC-7.1)

- **Test:** `[P0] should accept 7 parameters`
  - **Status:** RED - Module not found
  - **Verifies:** Function signature (AC-7.1)

- **Test:** `[P0] should export Push07State type`
  - **Status:** RED - Module not found
  - **Verifies:** Type export (AC-7.1)

- **Test:** `[P0] AC-7.1: buildIssue for Issue #1 produces kind:1621 with correct tags`
  - **Status:** RED - Will pass once event-builders already exist, validates tag structure
  - **Verifies:** Issue #1 event structure (AC-7.1)

- **Test:** `[P0] AC-7.1: buildIssue for Issue #2 produces kind:1621 with correct tags`
  - **Status:** RED - Will pass once event-builders already exist, validates tag structure
  - **Verifies:** Issue #2 event structure (AC-7.1)

- **Test:** `[P0] AC-7.4: buildComment produces kind:1622 with correct tags`
  - **Status:** RED - Will pass once event-builders already exist, validates tag structure
  - **Verifies:** Comment event structure (AC-7.4)

- **Test:** `[P0] AC-7.1: Push07State.issues has 2 entries with correct structure`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Issues array shape in state (AC-7.1)

- **Test:** `[P0] AC-7.2, AC-7.3: Push07State.comments has 5 entries`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Comments array shape in state (AC-7.2, AC-7.3)

- **Test:** `[P0] AC-7.2, AC-7.3: comments preserve publication order`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Comment ordering (AC-7.2, AC-7.3)

- **Test:** `[P0] AC-7.1: Push07State passes through all Push06State fields unchanged`
  - **Status:** RED - Source file does not exist
  - **Verifies:** State passthrough (AC-7.1)

- **Test:** `[P0] AC-7.1: no new git objects created`
  - **Status:** RED - Source file does not exist
  - **Verifies:** No git object creation (AC-7.1)

- **Test:** `[P0] AC-7.1: exactly 7 publishWithRetry calls in source`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Correct number of publish calls (AC-7.1)

- **Test:** `[P0] AC-7.2, AC-7.4: Issue #1 comments signed by Bob, Alice, Charlie`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Comment author signing order for Issue #1 (AC-7.2, AC-7.4)

- **Test:** `[P0] AC-7.3, AC-7.4: Issue #2 comments signed by Alice, Bob`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Comment author signing order for Issue #2 (AC-7.3, AC-7.4)

- **Test:** `[P0] AC-7.4: comments published via correct clients`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Client-to-author mapping for all 7 publish calls (AC-7.4)

- **Test:** `[P1] push-07-issues.ts source does NOT import git builder functions`
  - **Status:** RED - Source file does not exist
  - **Verifies:** No git builder imports

- **Test:** `[P1] Push07State interface includes issues and comments fields`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Interface shape

- **Test:** `[P1] AC-7.1: source uses three clients and three secret keys`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Three-client pattern (AC-7.1)

- **Test:** `[P1] AC-7.1: Alice signs Issue #1 and Bob signs Issue #2`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Issue author assignment (AC-7.1)

- **Test:** `[P1] source imports Push06State from push-06-prs.js`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Correct import chain

- **Test:** `[P1] event ID derivation uses result.eventId ?? signed.id fallback pattern`
  - **Status:** RED - Source file does not exist
  - **Verifies:** Fallback pattern consistency

- **Test:** `[P1] module does NOT export git object creation functions`
  - **Status:** RED - Module not found
  - **Verifies:** Clean export surface

- **Test:** `[P1] module does NOT import AGENT_IDENTITIES`
  - **Status:** RED - Source file does not exist
  - **Verifies:** No unused imports

### Integration Test Stubs (5 todo)

- `[integration] should publish 2 kind:1621 issue events to live relay`
- `[integration] should publish 5 kind:1622 comment events to live relay`
- `[integration] should return valid event IDs from relay for all 7 events`
- `[integration] should be queryable by relay after publish`
- `[integration] should filter issues by label (t tag) via relay query`

---

## Data Factories Created

N/A -- This story uses inline test data matching the established push-06 pattern. No external factory files needed. Test data uses deterministic hex strings (e.g., `'a'.repeat(64)` for pubkeys) consistent with the existing seed test suite.

---

## Fixtures Created

N/A -- Unit tests use dynamic `import()` and `fs.readFileSync` for source introspection, matching the established push-06 pattern. No Playwright fixtures or Vitest setup fixtures needed.

---

## Mock Requirements

N/A -- Unit tests do not require mocking. Source introspection tests read the TypeScript source directly. The 3 event builder tests (`buildIssue`, `buildComment`) call the real implementations from `event-builders.ts`.

---

## Required data-testid Attributes

N/A -- This story produces a seed script (backend), not UI components. No data-testid attributes needed.

---

## Implementation Checklist

### Test: `[P0] should export runPush07 function`

**File:** `packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts`

**Tasks to make this test pass:**

- [ ] Create `packages/rig/tests/e2e/seed/push-07-issues.ts`
- [ ] Export `runPush07` function with correct signature (7 params)
- [ ] Export `Push07State` interface
- [ ] Run test: `cd packages/rig && pnpm test:seed`

### Test: All source introspection tests (15 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts`

**Tasks to make these tests pass:**

- [ ] Import `finalizeEvent` from `nostr-tools/pure`
- [ ] Import `buildIssue`, `buildComment`, `publishWithRetry` from `./lib/index.js`
- [ ] Import `REPO_ID` from `./push-01-init.js`
- [ ] Import `Push06State` from `./push-06-prs.js`
- [ ] Do NOT import `AGENT_IDENTITIES`, `createGitBlob`, `createGitTree`, `createGitCommit`, `uploadGitObject`, `signBalanceProof`
- [ ] Build Issue #1 with `buildIssue(ownerPubkey, REPO_ID, 'Add WebSocket reconnection logic', body, ['enhancement', 'networking'])` signed by Alice
- [ ] Build Issue #2 with `buildIssue(ownerPubkey, REPO_ID, 'Fix deep path navigation bug', body, ['bug', 'forge-ui'])` signed by Bob
- [ ] Publish both issues via `publishWithRetry` (Alice->aliceClient, Bob->bobClient)
- [ ] Derive event IDs using `result.eventId ?? signed.id` fallback
- [ ] Build and publish 3 comments on Issue #1 (Bob, Alice, Charlie) via respective clients
- [ ] Build and publish 2 comments on Issue #2 (Alice, Bob) via respective clients
- [ ] Return Push07State passing through all Push06State fields + new `issues` and `comments` arrays
- [ ] Ensure exactly 7 `publishWithRetry` calls total
- [ ] Run test: `cd packages/rig && pnpm test:seed`

**Estimated Effort:** 1-2 hours

---

## Running Tests

```bash
# Run all seed tests (includes push-01 through push-07)
cd packages/rig && pnpm test:seed

# Run only push-07 tests
cd packages/rig && npx vitest run --config vitest.seed.config.ts push-07

# Run tests in watch mode
cd packages/rig && npx vitest --config vitest.seed.config.ts push-07

# Run with verbose output
cd packages/rig && npx vitest run --config vitest.seed.config.ts --reporter=verbose push-07
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 20 unit tests written and failing (ENOENT: push-07-issues.ts does not exist)
- 3 event builder tests validate tag structure using real `buildIssue`/`buildComment` implementations
- 17 source introspection tests verify implementation patterns via `fs.readFileSync`
- 5 integration test stubs (`.todo`) for future live relay verification
- Implementation checklist created mapping tests to code tasks

**Verification:**

```
Test Files  1 failed | 13 passed (14)
     Tests  20 failed | 192 passed | 3 skipped | 63 todo (278)
```

- All 20 tests fail due to missing `push-07-issues.ts` (ENOENT), not test bugs
- Failure messages are clear: "no such file or directory, open '.../push-07-issues.ts'"
- Existing push-01 through push-06 tests remain green (192 passed)

---

### GREEN Phase (DEV Team -- Next Steps)

**DEV Agent Responsibilities:**

1. Create `packages/rig/tests/e2e/seed/push-07-issues.ts`
2. Implement `runPush07` following the story spec and code examples
3. Run `pnpm test:seed` after each implementation step
4. Verify all 20 tests pass (green phase)

**Key Principles:**

- Follow the three-client pattern from story dev notes
- Match variable naming from story: `issue1Unsigned`, `issue1Signed`, `c1Unsigned`, `c1Signed`, etc.
- Use `publishWithRetry(clientName, signedEvent)` pattern matching test expectations
- Pass through all Push06State fields unchanged

---

### REFACTOR Phase (DEV Team -- After All Tests Pass)

1. Verify all 20 tests still pass
2. Check for code duplication in comment building (consider loop if 5 calls are repetitive)
3. Ensure error messages are descriptive per the story spec
4. Run full seed suite: `pnpm test:seed` (all 14 files should pass)

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && pnpm test:seed`

**Results:**

```
Test Files  1 failed | 13 passed (14)
     Tests  20 failed | 192 passed | 3 skipped | 63 todo (278)
  Duration  1.63s
```

**Summary:**

- Total tests: 20 (push-07 only)
- Passing: 0 (expected)
- Failing: 20 (expected)
- Status: RED phase verified

**Expected Failure Messages:**
- Dynamic import tests: `Failed to load url ../push-07-issues.js` (module not found)
- Source introspection tests: `ENOENT: no such file or directory, open '.../push-07-issues.ts'`

---

## Notes

- This is the FIRST push script using THREE ToonClient instances (Alice, Bob, Charlie). Push 06 used two (Alice + Charlie).
- The `buildComment` `authorPubkey` parameter is the ISSUE author's pubkey (for NIP-34 `p` tag threading), NOT the comment author's pubkey. Tests verify this by checking `issue1Signed.pubkey` / `issue2Signed.pubkey` are passed.
- The constant is `AGENT_IDENTITIES.carol` (not `charlie`), but function params use `charlieClient`/`charlieSecretKey` for readability.
- No new git objects are created -- Push 07 only publishes Nostr events (issues + comments).

---

## Knowledge Base References Applied

- **test-quality.md** -- Deterministic tests, explicit assertions in test bodies, isolation
- **test-levels-framework.md** -- Unit test level selection for pure function/module verification
- **test-priorities-matrix.md** -- P0 for core AC coverage, P1 for structural/convention checks

---

**Generated by BMad TEA Agent** - 2026-03-30
