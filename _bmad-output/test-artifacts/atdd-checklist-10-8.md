---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-03-30'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/10-8-seed-merge-pr-close-issue.md
  - packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts
  - packages/rig/tests/e2e/seed/push-07-issues.ts
  - packages/rig/tests/e2e/seed/lib/event-builders.ts
  - packages/rig/vitest.seed.config.ts
---

# ATDD Checklist - Epic 10, Story 10.8: Seed Script -- Merge PR & Close Issue (Push 8)

**Date:** 2026-03-30
**Author:** Jonathan
**Primary Test Level:** Unit (source introspection + direct API calls)

---

## Story Summary

Seed script that publishes a kind:1632 (Closed) status event for Issue #2 and verifies PR #1 already has kind:1631 from Push 6. This is the simplest push script in the epic -- single client (Alice), single publish call, pure state assertion for PR verification.

**As a** TOON developer
**I want** a seed script that publishes a kind:1632 (Closed) status event for Issue #2
**So that** Playwright specs can verify issue open/closed filtering and status badge rendering

---

## Acceptance Criteria

1. **AC-8.1:** `seed/push-08-close.ts` publishes kind:1632 (Closed) for Issue #2 (via `e` tag referencing issue event ID from Push07State).
2. **AC-8.2:** Verifies PR #1 already has kind:1631 from Push 6 (no duplicate status event needed -- assertion only). Throws descriptive error if PR #1 status is not 1631.
3. **AC-8.3:** All events signed by appropriate authors (Alice signs the close event as repo owner).
4. **AC-8.4:** Push08State extends Push07State with `closedIssueEventIds: string[]` containing exactly 1 entry (the close event ID). All Push07State fields pass through unchanged.

---

## Failing Tests Created (RED Phase)

### Unit Tests (21 tests + 4 todo)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts` (480 lines)

- **Test:** `[P0] should export runPush08 function`
  - **Status:** RED - Module not found (push-08-close.ts does not exist)
  - **Verifies:** AC-8.4 -- module exports runPush08

- **Test:** `[P0] should accept 3 parameters (aliceClient, aliceSecretKey, push07State)`
  - **Status:** RED - Module not found
  - **Verifies:** AC-8.4 -- function signature

- **Test:** `[P0] should export Push08State type (verified by compilation)`
  - **Status:** RED - Module not found
  - **Verifies:** AC-8.4 -- type export

- **Test:** `[P0] AC-8.1: buildStatus for Issue #2 close produces kind:1632 with correct e tag and p tag`
  - **Status:** PASS (tests existing lib function buildStatus)
  - **Verifies:** AC-8.1 -- event structure

- **Test:** `[P0] AC-8.4: Push08State interface declares closedIssueEventIds field as string[]`
  - **Status:** RED - ENOENT (source file does not exist)
  - **Verifies:** AC-8.4 -- interface shape

- **Test:** `[P0] AC-8.4: return statement includes closedIssueEventIds with exactly 1 entry`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- single close event

- **Test:** `[P0] AC-8.4: Push08State passes through all Push07State fields unchanged`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- state passthrough

- **Test:** `[P0] AC-8.4: no new git objects created -- commits passthrough, shaMap passthrough, files passthrough`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- no git objects

- **Test:** `[P0] AC-8.4: Push08State.prs array unchanged from Push07State input`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- PR passthrough

- **Test:** `[P1] push-08-close.ts source does NOT import createGitBlob, createGitTree, createGitCommit, uploadGitObject, or signBalanceProof`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- no git builder imports

- **Test:** `[P0] AC-8.2: source verifies PR #1 has statusKind 1631 and throws descriptive error if not`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.2 -- PR verification assertion

- **Test:** `[P0] AC-8.3: close event is signed with aliceSecretKey and published via aliceClient`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.3 -- Alice signs

- **Test:** `[P0] AC-8.1: exactly 1 publishWithRetry call in source (1 close status event)`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.1 -- single publish

- **Test:** `[P1] Push08State interface includes closedIssueEventIds alongside all Push07State fields`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- full interface shape

- **Test:** `[P1] source imports Push07State from push-07-issues.js`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- import chain

- **Test:** `[P1] event ID derivation uses result.eventId ?? signed.id fallback pattern`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.1 -- fallback pattern

- **Test:** `[P1] source uses only aliceClient (single-client module, no bobClient or charlieClient)`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.3 -- single client

- **Test:** `[P1] module does NOT export git object creation functions`
  - **Status:** RED - Module not found
  - **Verifies:** AC-8.4 -- clean exports

- **Test:** `[P0] AC-8.1: source references push07State.issues[1] for close event (Issue #2)`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.1 -- Issue #2 targeting

- **Test:** `[P1] module does NOT import buildIssue, buildComment, buildPatch, REPO_ID, or AGENT_IDENTITIES`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.1 -- minimal imports

- **Test:** `[P0] AC-8.4: issues and comments arrays passed through unchanged from Push07State`
  - **Status:** RED - ENOENT
  - **Verifies:** AC-8.4 -- state passthrough

### Integration Test Stubs (4 todo)

- `[integration] should publish kind:1632 close event for Issue #2 to live relay`
- `[integration] should return valid event ID from relay for close event`
- `[integration] should be queryable by relay after publish (kind:1632 for Issue #2)`
- `[integration] should verify PR #1 kind:1631 exists on relay before closing Issue #2`

---

## Data Factories Created

N/A -- No data factories needed. Tests use source introspection (fs.readFileSync) and direct buildStatus API calls with inline test data.

---

## Fixtures Created

N/A -- No fixtures needed. Tests are stateless source-introspection tests and direct function calls.

---

## Mock Requirements

N/A -- No mocks needed. Unit tests inspect source code and call buildStatus directly. Integration tests are stubbed as `.todo`.

---

## Required data-testid Attributes

N/A -- No UI components in this story. This is a backend seed script.

---

## Implementation Checklist

### Test: Module exports and function signature (3 tests)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/rig/tests/e2e/seed/push-08-close.ts`
- [ ] Export `Push08State` interface extending Push07State with `closedIssueEventIds: string[]`
- [ ] Export `runPush08(aliceClient, aliceSecretKey, push07State): Promise<Push08State>`
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-08-close`
- [ ] Tests pass (green phase)

### Test: PR #1 verification (AC-8.2)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts`

**Tasks to make this test pass:**

- [ ] Add assertion checking `push07State.prs[0]?.statusKind !== 1631`
- [ ] Throw descriptive error referencing "kind:1631" and "Applied/Merged"
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-08-close`
- [ ] Test passes (green phase)

### Test: Close event build and publish (AC-8.1, AC-8.3)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts`

**Tasks to make these tests pass:**

- [ ] Call `buildStatus(push07State.issues[1]!.eventId, 1632, push07State.issues[1]!.authorPubkey)`
- [ ] Sign with `finalizeEvent(closeUnsigned, aliceSecretKey)`
- [ ] Publish via `publishWithRetry(aliceClient, closeSigned)`
- [ ] Use `result.eventId ?? signed.id` fallback pattern
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-08-close`
- [ ] Tests pass (green phase)

### Test: State passthrough (AC-8.4)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts`

**Tasks to make these tests pass:**

- [ ] Return Push08State with all Push07State fields passed through unchanged
- [ ] Add `closedIssueEventIds: [closeEventId]` to return value
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-08-close`
- [ ] Tests pass (green phase)

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/rig && pnpm test:seed -- push-08-close

# Run specific test file
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-08-close.test.ts

# Run all seed tests
cd packages/rig && pnpm test:seed

# Debug specific test
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-08-close.test.ts --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 21 tests written and failing (20 RED + 1 PASS for existing lib function)
- 4 integration stubs as `.todo`
- No fixtures or factories needed (source introspection approach)
- No mock requirements
- No data-testid requirements (backend story)
- Implementation checklist created

**Verification:**

- All tests run and fail as expected
- Failure messages are clear: ENOENT (source not found) or module import errors
- Tests fail due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. Create `packages/rig/tests/e2e/seed/push-08-close.ts`
2. Implement Push08State interface
3. Implement runPush08 function
4. Run tests to verify they pass
5. Check off tasks in implementation checklist

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all tests pass (green phase complete)
2. Review code quality against push-07-issues.ts patterns
3. Ensure consistent error message formatting
4. Verify TypeScript types are correct

---

## Next Steps

1. **Review this checklist** and the failing test file
2. **Run failing tests** to confirm RED phase: `cd packages/rig && pnpm test:seed -- push-08-close`
3. **Begin implementation** of `push-08-close.ts` using implementation checklist
4. **Work one test group at a time** (red -> green for each)
5. **When all tests pass**, refactor code for quality
6. **When refactoring complete**, update story status to 'done'

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-08-close.test.ts`

**Results:**

```
 Test Files  1 failed (1)
      Tests  20 failed | 1 passed | 4 todo (25)
   Duration  417ms
```

**Summary:**

- Total tests: 25 (21 executable + 4 todo)
- Passing: 1 (buildStatus lib function test -- expected, tests existing code)
- Failing: 20 (expected -- source file does not exist yet)
- Todo: 4 (integration stubs)
- Status: RED phase verified

**Expected Failure Messages:**
- Module import failures: `Cannot find module '../push-08-close.js'`
- Source introspection failures: `ENOENT: no such file or directory, open '.../push-08-close.ts'`

---

## Notes

- This is the simplest push script in Epic 10 -- single client (Alice), single publish call
- PR #1 verification (AC-8.2) is a pure state assertion, not a publish operation
- No git objects created -- only 1 kind:1632 status event published
- Test pattern follows push-07-issues.test.ts exactly (source introspection + direct API calls)
- The 1 passing test (buildStatus) is correct -- it tests an already-existing library function

---

**Generated by BMad TEA Agent** - 2026-03-30
