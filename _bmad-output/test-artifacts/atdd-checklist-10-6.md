---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-03-30'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-6-seed-prs-with-status.md'
  - 'packages/rig/tests/e2e/seed/__tests__/push-05-tag.test.ts'
  - 'packages/rig/tests/e2e/seed/push-05-tag.ts'
  - 'packages/rig/tests/e2e/seed/lib/event-builders.ts'
  - 'packages/rig/tests/e2e/seed/lib/index.ts'
  - 'packages/rig/tests/e2e/seed/lib/constants.ts'
  - 'packages/rig/vitest.seed.config.ts'
---

# ATDD Checklist - Epic 10, Story 10.6: Seed Script -- PRs with Status (Push 6)

**Date:** 2026-03-30
**Author:** Jonathan
**Primary Test Level:** Unit (source introspection + event builder verification)

---

## Story Summary

Story 10.6 adds a seed script that publishes 2 PRs (kind:1617 patches) with status events (kind:1630/1631) so that Playwright specs can verify PR listing, status badges, author attribution, and conversation/files tabs.

**As a** TOON developer
**I want** a seed script that publishes 2 PRs with status events
**So that** Playwright specs can verify PR listing, status badges, author attribution, and conversation/files tabs

---

## Acceptance Criteria

1. **AC-6.1:** `seed/push-06-prs.ts` publishes 2 kind:1617 PR events: PR #1 "feat: add retry logic" by Alice (branch tag: `feature/add-retry`, commit tags for both feature commits, `a` tag referencing repo); PR #2 "fix: update docs" by Charlie (single commit SHA, `a` tag referencing repo)
2. **AC-6.2:** kind:1630 (Open) status event published for PR #2 (referencing PR event ID via `e` tag)
3. **AC-6.3:** kind:1631 (Merged/Applied) status event published for PR #1
4. **AC-6.4:** All events signed by correct author keypairs (Alice for PR #1 and its status, Charlie for PR #2 and its status)

---

## Failing Tests Created (RED Phase)

### Unit Tests (17 tests + 5 todo)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts` (440 lines)

- **Test:** `[P0] should export runPush06 function`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 module exports

- **Test:** `[P0] should accept 5 parameters`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 multi-client function signature

- **Test:** `[P0] should export Push06State type`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 type export

- **Test:** `[P0] AC-6.1: buildPatch for PR #1 produces kind:1617 with correct tags`
  - **Status:** PASS (event-builders.ts already exists)
  - **Verifies:** AC-6.1 PR #1 event structure (a, subject, commit, parent-commit, t tags)

- **Test:** `[P0] AC-6.1: buildPatch for PR #2 produces kind:1617 with correct tags, no branch tag`
  - **Status:** PASS (event-builders.ts already exists)
  - **Verifies:** AC-6.1 PR #2 event structure (single commit, no branch tag)

- **Test:** `[P0] AC-6.3: buildStatus for PR #1 produces kind:1631 with e tag and p tag`
  - **Status:** PASS (event-builders.ts already exists)
  - **Verifies:** AC-6.3 Applied/Merged status event structure

- **Test:** `[P0] AC-6.2: buildStatus for PR #2 produces kind:1630 with e tag and p tag`
  - **Status:** PASS (event-builders.ts already exists)
  - **Verifies:** AC-6.2 Open status event structure

- **Test:** `[P0] AC-6.1: Push06State.prs has 2 entries with correct structure`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 prs array structure (eventId, title, authorPubkey, statusKind)

- **Test:** `[P0] AC-6.1: Push06State passes through all Push05State fields unchanged`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 state passthrough (repoId, ownerPubkey, commits, shaMap, etc.)

- **Test:** `[P0] AC-6.1: no new git objects created`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 commits/shaMap/files passthrough

- **Test:** `[P1] source does NOT import git builder functions`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** No git object work (no createGitBlob, createGitTree, etc.)

- **Test:** `[P1] Push06State interface includes prs field alongside all Push05State fields`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 interface shape

- **Test:** `[P1] AC-6.4: source uses aliceSecretKey for PR #1 and charlieSecretKey for PR #2`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.4 correct author signing

- **Test:** `[P1] AC-6.1: source imports AGENT_IDENTITIES`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** AC-6.1 Charlie pubkey reference

- **Test:** `[P1] module does NOT export git object creation functions`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** No git object re-exports

- **Test:** `[P1] source imports Push05State from push-05-tag.js`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** Correct predecessor import

- **Test:** `[P1] event ID derivation uses fallback pattern`
  - **Status:** RED - ENOENT (push-06-prs.ts does not exist)
  - **Verifies:** eventId ?? signed.id pattern

### Integration Test Stubs (5 todo)

- `[integration] should publish 2 kind:1617 PR events to live relay`
- `[integration] should publish kind:1631 status for PR #1 to live relay`
- `[integration] should publish kind:1630 status for PR #2 to live relay`
- `[integration] should return valid event IDs from relay for all 4 events`
- `[integration] should be queryable by relay after publish`

---

## Data Factories Created

N/A -- This story uses existing seed library infrastructure (buildPatch, buildStatus, AGENT_IDENTITIES). No new factories needed.

---

## Fixtures Created

N/A -- Tests use direct imports and source introspection. No Playwright fixtures needed for unit-level seed script tests.

---

## Mock Requirements

N/A -- Unit tests verify event structure and source patterns. Integration tests (todo stubs) will use live relay infrastructure.

---

## Required data-testid Attributes

N/A -- This story produces seed data, not UI components.

---

## Implementation Checklist

### Test: `[P0] should export runPush06 function`

**File:** `packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts`

**Tasks to make this test pass:**

- [ ] Create `packages/rig/tests/e2e/seed/push-06-prs.ts`
- [ ] Export `runPush06` async function
- [ ] Export `Push06State` interface
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-06-prs`

### Test: `[P0] should accept 5 parameters`

**Tasks to make this test pass:**

- [ ] Define function signature: `runPush06(aliceClient, charlieClient, aliceSecretKey, charlieSecretKey, push05State)`
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-06-prs`

### Test: `[P0] AC-6.1: Push06State.prs has 2 entries with correct structure`

**Tasks to make this test pass:**

- [ ] Define `Push06State` interface with `prs: { eventId: string; title: string; authorPubkey: string; statusKind: number }[]`
- [ ] Build PR #1 with `buildPatch(ownerPubkey, REPO_ID, 'feat: add retry logic', [...], 'feature/add-retry')`
- [ ] Build PR #2 with `buildPatch(ownerPubkey, REPO_ID, 'fix: update docs', [...])`
- [ ] Return prs array with both entries

### Test: `[P0] AC-6.1: Push06State passes through all Push05State fields unchanged`

**Tasks to make this test pass:**

- [ ] Pass through `push05State.repoId`, `push05State.ownerPubkey`, `push05State.commits`, `push05State.shaMap`, `push05State.repoAnnouncementId`, `push05State.refsEventId`, `push05State.branches`, `push05State.tags`, `push05State.files`

### Test: `[P0] AC-6.1: no new git objects created`

**Tasks to make this test pass:**

- [ ] Use `commits: push05State.commits`, `shaMap: push05State.shaMap`, `files: push05State.files` in return

### Test: `[P1] AC-6.4: source uses aliceSecretKey for PR #1 and charlieSecretKey for PR #2`

**Tasks to make this test pass:**

- [ ] Sign PR #1 with `finalizeEvent(pr1Unsigned, aliceSecretKey)`, publish via `aliceClient`
- [ ] Sign PR #2 with `finalizeEvent(pr2Unsigned, charlieSecretKey)`, publish via `charlieClient`
- [ ] Sign status #1 with `aliceSecretKey`, publish via `aliceClient`
- [ ] Sign status #2 with `charlieSecretKey`, publish via `charlieClient`

### Test: `[P1] source does NOT import git builder functions`

**Tasks to make this test pass:**

- [ ] Do NOT import `createGitBlob`, `createGitTree`, `createGitCommit`, `uploadGitObject`, `signBalanceProof`, or `git-builder`

### Test: `[P1] AC-6.1: source imports AGENT_IDENTITIES`

**Tasks to make this test pass:**

- [ ] Import `AGENT_IDENTITIES` from `./lib/index.js`
- [ ] Use `AGENT_IDENTITIES.carol.pubkey` for Charlie's pubkey in status event p tags

### Test: `[P1] source imports Push05State from push-05-tag.js`

**Tasks to make this test pass:**

- [ ] Import `type Push05State` from `./push-05-tag.js`

### Test: `[P1] event ID derivation uses fallback pattern`

**Tasks to make this test pass:**

- [ ] Use `pr1Result.eventId ?? pr1Signed.id` pattern for PR event IDs

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/rig && pnpm test:seed -- push-06-prs

# Run specific test file
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-06-prs.test.ts

# Run all seed tests
cd packages/rig && pnpm test:seed

# Debug specific test
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-06-prs.test.ts --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 17 tests written (13 failing, 4 passing against existing builders)
- 5 integration test stubs (.todo)
- No fixtures or factories needed (uses existing seed lib)
- Implementation checklist created

**Verification:**

- 13 tests fail with ENOENT (push-06-prs.ts does not exist)
- 4 tests pass (buildPatch/buildStatus event structure tests against existing builders)
- Failures are due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. Create `packages/rig/tests/e2e/seed/push-06-prs.ts`
2. Implement `runPush06` function with 5-parameter signature
3. Define `Push06State` interface extending Push05State with `prs` array
4. Build and publish 2 PRs (kind:1617) and 2 status events (kind:1630/1631)
5. Run tests to verify all pass

**Key Principles:**

- Follow Push 05 patterns exactly (error handling, event ID derivation, state passthrough)
- Use `AGENT_IDENTITIES.carol` for Charlie (not `charlie`)
- Do NOT reconstruct secret keys from AGENT_IDENTITIES inside runPush06

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

1. Verify all tests pass
2. Review for consistency with Push 01-05 patterns
3. Ensure lint passes: `pnpm lint`
4. Run full seed test suite: `pnpm test:seed`

---

## Next Steps

1. **Run failing tests** to confirm RED phase: `cd packages/rig && pnpm test:seed -- push-06-prs`
2. **Begin implementation** using implementation checklist as guide
3. **Work one test at a time** (red to green for each)
4. **When all tests pass**, run full seed suite and lint

---

## Knowledge Base References Applied

- **test-quality.md** - Test design principles (Given-When-Then, determinism, isolation)
- **data-factories.md** - Factory patterns (not needed for this story -- uses existing seed lib)
- **test-healing-patterns.md** - Common failure patterns awareness

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-06-prs.test.ts`

**Results:**

```
 Test Files  1 failed (1)
      Tests  13 failed | 4 passed | 5 todo (22)
   Duration  919ms
```

**Summary:**

- Total tests: 22 (17 active + 5 todo)
- Passing: 4 (event builder structure tests against existing code)
- Failing: 13 (ENOENT -- push-06-prs.ts does not exist)
- Todo: 5 (integration stubs)
- Status: RED phase verified

**Expected Failure Messages:**
- All 13 failures: `ENOENT: no such file or directory, open '.../push-06-prs.ts'`

---

## Notes

- This is the FIRST push script using multiple ToonClient instances (Alice + Charlie)
- `AGENT_IDENTITIES.carol` is the constant name for Charlie's identity (project convention)
- No new git objects are created -- only 4 `publishWithRetry` calls (2 patches + 2 statuses)
- Tests follow the exact pattern established by push-05-tag.test.ts

---

**Generated by BMad TEA Agent** - 2026-03-30
