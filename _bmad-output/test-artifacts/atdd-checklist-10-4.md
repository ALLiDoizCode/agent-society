---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
lastStep: step-04-generate-tests
lastSaved: '2026-03-29'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/10-4-seed-feature-branch.md
  - packages/rig/tests/e2e/seed/__tests__/push-02-nested.test.ts
  - packages/rig/tests/e2e/seed/push-02-nested.ts
  - packages/rig/tests/e2e/seed/push-01-init.ts
  - packages/rig/tests/e2e/seed/lib/git-builder.ts
  - packages/rig/tests/e2e/seed/lib/event-builders.ts
---

# ATDD Checklist - Epic 10, Story 4: Seed Script — Feature Branch (Pushes 3-4)

**Date:** 2026-03-29
**Author:** Jonathan
**Primary Test Level:** Unit (vitest)

---

## Story Summary

Seed scripts that create a feature branch with two commits (branch creation + additional work), so that Playwright specs can verify branch switching, branch-specific file visibility, and commit history across branches.

**As a** TOON developer
**I want** seed scripts that create a feature branch with two commits
**So that** Playwright specs can verify branch switching, branch-specific file visibility, and commit history across branches

---

## Acceptance Criteria

1. **AC-4.1:** `seed/push-03-branch.ts` creates branch `feature/add-retry` from main HEAD (Push 2's commit), adds `src/lib/retry.ts` with a new commit on that branch
2. **AC-4.2:** `seed/push-04-branch-work.ts` adds a second commit on `feature/add-retry` modifying `src/index.ts` (import retry) and adding `src/lib/retry.test.ts`
3. **AC-4.3:** kind:30618 refs includes both `refs/heads/main` and `refs/heads/feature/add-retry` with correct SHAs
4. **AC-4.4:** Commit graph: Push 4 commit -> Push 3 commit -> Push 2 commit (parent chain intact across both pushes)
5. **AC-4.5:** kind:30618 `refs/heads/main` still points to Push 2's commit SHA after both Push 3 and Push 4 -- main is never advanced by feature branch work

---

## Generation Mode

**AI Generation** -- acceptance criteria are clear and well-specified, all scenarios are deterministic git object construction with known patterns from Stories 10.2/10.3.

---

## Test Strategy

| AC | Test Level | Priority | Scenario |
|----|-----------|----------|----------|
| AC-4.1 | Unit | P0 | Module exports runPush03, Push03State, RETRY_TS_CONTENT |
| AC-4.1 | Unit | P0 | Deterministic blob SHA for retry.ts |
| AC-4.1 | Unit | P0 | lib/ tree contains core.ts, retry.ts, utils/ (sorted) |
| AC-4.1 | Unit | P0 | Delta logic: exactly 5 new objects (1 blob + 3 trees + 1 commit) |
| AC-4.1 | Unit | P0 | File content under 95KB (R10-005) |
| AC-4.2 | Unit | P0 | Module exports runPush04, MODIFIED_INDEX_TS_CONTENT, RETRY_TEST_TS_CONTENT |
| AC-4.2 | Unit | P0 | Modified index.ts blob SHA differs from Push 1 original |
| AC-4.2 | Unit | P0 | lib/ tree contains core.ts, retry.test.ts, retry.ts, utils/ (sorted) |
| AC-4.2 | Unit | P0 | Delta logic: exactly 6 new objects (2 blobs + 3 trees + 1 commit) |
| AC-4.3 | Unit | P0 | buildRepoRefs includes both main and feature/add-retry r tags |
| AC-4.3 | Unit | P0 | HEAD points to refs/heads/main (first key) |
| AC-4.4 | Unit | P0 | Push 3 commit parent = Push 2 commit SHA |
| AC-4.4 | Unit | P0 | Push 4 commit parent = Push 3 commit SHA |
| AC-4.5 | Unit | P0 | main ref still points to Push 2 commit after Push 3 |
| AC-4.5 | Unit | P0 | main ref still points to Push 2 commit after Push 4 |
| AC-4.1-4.5 | Integration | -- | .todo stubs for live Arweave DVM uploads |

---

## Failing Tests Created (RED Phase)

### Unit Tests — Push 03 (14 tests + 11 integration todos)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-03-branch.test.ts` (~440 lines)

- **Test:** should export runPush03 function
  - **Status:** RED - module push-03-branch.ts does not exist
  - **Verifies:** AC-4.1 module exports

- **Test:** should accept (aliceClient, aliceSecretKey, push02State) parameters
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 function signature

- **Test:** should export Push03State type (verified by compilation)
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 type exports

- **Test:** should export RETRY_TS_CONTENT as a non-empty string
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 content constant

- **Test:** should export RETRY_TS_CONTENT containing retry function signature
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 content correctness

- **Test:** should produce deterministic blob SHA for retry.ts content
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 determinism

- **Test:** should create lib/ tree containing core.ts, retry.ts, and utils/ (sorted)
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 tree structure

- **Test:** should produce a lib/ tree SHA different from Push 2 lib/ tree
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 tree differentiation

- **Test:** AC-4.4: commit body contains parent push02CommitSha
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.4 commit parent chain

- **Test:** should produce consistent SHAs across multiple runs (deterministic)
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 full determinism

- **Test:** AC-4.1: exactly 5 new objects in upload list
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 delta upload logic

- **Test:** AC-4.3: buildRepoRefs includes both main and feature/add-retry
  - **Status:** RED - passes (uses buildRepoRefs directly, not the module)
  - **Verifies:** AC-4.3 multi-branch refs

- **Test:** AC-4.5: main ref should still point to Push 2 commit SHA
  - **Status:** RED - passes (uses buildRepoRefs directly)
  - **Verifies:** AC-4.5 main not advanced

- **Test:** AC-4.3: HEAD should point to refs/heads/main
  - **Status:** RED - passes (uses buildRepoRefs directly)
  - **Verifies:** AC-4.3 HEAD pointer

- **Test:** AC-4.1: retry.ts content is under 95KB size limit
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.1 R10-005

- **Test:** Push03State branches, commits, files, shaMap validations (4 tests)
  - **Status:** GREEN - structural expectation tests (no module import needed)
  - **Verifies:** AC-4.1 state shape

- 11 integration test stubs (`.todo`)

### Unit Tests — Push 04 (15 tests + 11 integration todos)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-04-branch-work.test.ts` (~450 lines)

- **Test:** should export runPush04 function
  - **Status:** RED - module push-04-branch-work.ts does not exist
  - **Verifies:** AC-4.2 module exports

- **Test:** should accept (aliceClient, aliceSecretKey, push03State) parameters
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 function signature

- **Test:** should export Push04State type (verified by compilation)
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 type exports

- **Test:** should export MODIFIED_INDEX_TS_CONTENT containing retry import
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 content constant

- **Test:** should export RETRY_TEST_TS_CONTENT as a non-empty string
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 content constant

- **Test:** AC-4.2: modified index.ts blob has DIFFERENT SHA from Push 1 original
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 content modification

- **Test:** AC-4.2: lib/ tree contains core.ts, retry.ts, retry.test.ts, and utils/
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 tree structure

- **Test:** should produce a lib/ tree SHA different from Push 3 lib/ tree
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 tree differentiation

- **Test:** AC-4.4: commit body contains parent push03CommitSha
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.4 commit parent chain

- **Test:** AC-4.5: main branch STILL points to Push 2 commit after Push 4
  - **Status:** GREEN - structural test (uses buildRepoRefs directly)
  - **Verifies:** AC-4.5 main not advanced

- **Test:** AC-4.2: feature/add-retry ref advances to Push 4 commit
  - **Status:** GREEN - structural test
  - **Verifies:** AC-4.2 branch advancement

- **Test:** AC-4.2: state should have 4 commits total in correct order
  - **Status:** GREEN - structural expectation
  - **Verifies:** AC-4.2 accumulated state

- **Test:** AC-4.2: exactly 6 new objects for Push 4
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 delta logic

- **Test:** AC-4.2: all file contents are under 95KB size limit
  - **Status:** RED - module does not exist
  - **Verifies:** AC-4.2 R10-005

- **Test:** Push04State files, shaMap, branches validations (3 tests)
  - **Status:** GREEN - structural expectations
  - **Verifies:** AC-4.2 state shape

- 11 integration test stubs (`.todo`)

---

## Running Tests

```bash
# Run all seed tests (including push-03 and push-04)
cd packages/rig && pnpm test:seed

# Run only push-03 tests
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-03-branch.test.ts

# Run only push-04 tests
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-04-branch-work.test.ts

# Run with verbose output
cd packages/rig && npx vitest run --config vitest.seed.config.ts --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 23 failing tests written (module-dependent tests fail due to missing implementation)
- 22 integration test stubs (.todo) for future live infrastructure testing
- Tests follow push-02-nested.test.ts pattern exactly
- No fixtures or factories needed (pure function unit tests)

**Verification:**

- All module-import-dependent tests fail with "Does the file exist?" (expected)
- Structural tests pass (they don't import from unimplemented modules)
- Existing 123 tests from prior stories unaffected

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. Create `packages/rig/tests/e2e/seed/push-03-branch.ts` per story spec
2. Create `packages/rig/tests/e2e/seed/push-04-branch-work.ts` per story spec
3. Run `pnpm test:seed` after each implementation step
4. All 23 tests should pass when implementation is complete

---

## Implementation Checklist

### Test: push-03-branch module exports and git objects

**File:** `packages/rig/tests/e2e/seed/__tests__/push-03-branch.test.ts`

**Tasks to make tests pass:**

- [ ] Create `push-03-branch.ts` with `RETRY_TS_CONTENT` constant
- [ ] Export `Push03State` interface (same flat shape as Push02State, with branches array)
- [ ] Export `runPush03(aliceClient, aliceSecretKey, push02State)` function
- [ ] Build 1 new blob (retry.ts), 3 new trees (lib/, src/, root), 1 new commit
- [ ] Upload only delta objects (5 new objects)
- [ ] Publish kind:30618 refs with both main and feature/add-retry branches
- [ ] Return Push03State with appended commits, expanded shaMap
- [ ] Run test: `cd packages/rig && pnpm test:seed`
- [ ] All push-03 tests pass (green phase)

### Test: push-04-branch-work module exports and git objects

**File:** `packages/rig/tests/e2e/seed/__tests__/push-04-branch-work.test.ts`

**Tasks to make tests pass:**

- [ ] Create `push-04-branch-work.ts` with `MODIFIED_INDEX_TS_CONTENT` and `RETRY_TEST_TS_CONTENT` constants
- [ ] Export `Push04State` interface
- [ ] Export `runPush04(aliceClient, aliceSecretKey, push03State)` function
- [ ] Build 2 new blobs, 3 new trees, 1 new commit (parent = Push 3 commit)
- [ ] Upload only delta objects (6 new objects)
- [ ] Publish kind:30618 refs with main at Push 2 and feature/add-retry at Push 4
- [ ] Return Push04State with 4 accumulated commits
- [ ] Run test: `cd packages/rig && pnpm test:seed`
- [ ] All push-04 tests pass (green phase)

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && npx vitest run --config vitest.seed.config.ts --reporter=verbose`

**Results:**

```
Test Files  2 failed | 9 passed (11)
     Tests  23 failed | 123 passed | 3 skipped | 50 todo (199)
```

**Summary:**

- Total new tests: 29 (23 executable + 6 structural that pass)
- Failing: 23 (expected -- module does not exist)
- Passing structural: 6 (expected -- no module import needed)
- Integration todos: 22
- Existing tests: 123 passed (unaffected)
- Status: RED phase verified

---

## Notes

- Tests follow the exact same pattern as `push-02-nested.test.ts` per story requirements
- All tests use `await import('../push-0N-xxx.js')` dynamic import pattern
- Tree entry sort order is tested by checking `bodyBin.indexOf()` ordering
- The `retry.ts` sort order in lib/ tree: `core.ts < retry.test.ts < retry.ts < utils` (byte-wise sort)
- Push 4 tests import from push-03-branch.js which also does not exist yet, causing cascading failures (expected)
- No data factories, fixtures, or mocks needed -- all tests are pure function unit tests

---

**Generated by BMad TEA Agent** - 2026-03-29
