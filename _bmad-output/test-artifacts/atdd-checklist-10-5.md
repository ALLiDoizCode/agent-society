---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-03-29'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-5-seed-tag.md'
  - 'packages/rig/tests/e2e/seed/__tests__/push-04-branch-work.test.ts'
  - 'packages/rig/tests/e2e/seed/push-04-branch-work.ts'
  - 'packages/rig/tests/e2e/seed/lib/event-builders.ts'
  - 'packages/rig/tests/e2e/seed/lib/index.ts'
---

# ATDD Checklist - Epic 10, Story 10.5: Seed Script — Tag (Push 5)

**Date:** 2026-03-29
**Author:** Jonathan
**Primary Test Level:** Unit

---

## Story Summary

Push 5 adds a `refs/tags/v1.0.0` tag pointing to main's HEAD commit (Push 2) via a kind:30618 refs event update. No new git objects are created -- this is the simplest push script, only publishing a single refs event with the tag added alongside existing branch refs.

**As a** TOON developer
**I want** a seed script that tags `v1.0.0` on main's HEAD commit
**So that** Playwright specs can verify tag listing, tag selection, and content at a tagged commit

---

## Acceptance Criteria

1. **AC-5.1:** `seed/push-05-tag.ts` adds `refs/tags/v1.0.0` pointing to main's HEAD commit SHA (Push 2's commit)
2. **AC-5.2:** kind:30618 refs includes the tag alongside both branches (`refs/heads/main`, `refs/heads/feature/add-retry`, `refs/tags/v1.0.0`) with HEAD still pointing to `ref: refs/heads/main`
3. **AC-5.3:** No new git objects needed -- tag points to existing commit, no new blobs/trees/commits uploaded
4. **AC-5.4:** Push05State passes through all Push04State fields unchanged (commits, shaMap, branches, files, repoAnnouncementId, ownerPubkey, repoId) except `refsEventId` (updated) and `tags` (new field: `['v1.0.0']`)

---

## Test Strategy

**Detected Stack:** fullstack (monorepo with frontend + backend)
**Generation Mode:** AI Generation (clear acceptance criteria, deterministic git object patterns)
**Primary Level:** Unit tests (pure function testing, no browser interaction needed)

### Test Level Rationale

- **Unit tests** for all ACs: Push 5 is a pure-function seed script. All behavior can be verified through deterministic git object construction and event builder output inspection.
- **No E2E/API tests needed**: This story produces a seed script, not a user-facing feature. The seed data is consumed by later Playwright E2E specs (Stories 10.6+).
- **Integration stubs (.todo)**: Placeholder tests for live relay publishing, to be activated when SDK E2E infrastructure is used.

### AC-to-Test Mapping

| AC | Test Level | Tests | Priority |
|----|-----------|-------|----------|
| AC-5.1 | Unit | Module exports, tag points to Push 2 SHA, tag+main same SHA | P0 |
| AC-5.2 | Unit | 3 refs present, HEAD points to main, correct kind/d-tag | P0-P1 |
| AC-5.3 | Unit | shaMap key count unchanged, commits array length 4, no git builder exports | P0 |
| AC-5.4 | Unit | tags field exists, branches unchanged, files unchanged, shaMap identical | P0 |

---

## Failing Tests Created (RED Phase)

### Unit Tests (14 tests + 3 todo)

**File:** `packages/rig/tests/e2e/seed/__tests__/push-05-tag.test.ts` (290 lines)

- **Test:** `[P0] should export runPush05 function`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.1 module exports

- **Test:** `[P0] should accept (aliceClient, aliceSecretKey, push04State) parameters`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.1 function signature

- **Test:** `[P0] should export Push05State type (verified by compilation)`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.1 type export

- **Test:** `[P0] AC-5.2: kind:30618 refs contain refs/tags/v1.0.0 alongside both branch refs`
  - **Status:** PASS (tests buildRepoRefs which already exists)
  - **Verifies:** AC-5.2 refs event structure

- **Test:** `[P0] AC-5.1: tag ref points to Push 2 commit SHA (main HEAD), NOT Push 3 or Push 4`
  - **Status:** PASS (tests buildRepoRefs)
  - **Verifies:** AC-5.1 tag target

- **Test:** `[P0] AC-5.2: HEAD still points to ref: refs/heads/main (not the tag)`
  - **Status:** PASS (tests buildRepoRefs)
  - **Verifies:** AC-5.2 HEAD reference

- **Test:** `[P0] AC-5.3: no new git objects created -- shaMap has same key count as input`
  - **Status:** PASS (constructs all 28 SHAs from Push 1-4)
  - **Verifies:** AC-5.3 no-upload constraint

- **Test:** `[P0] AC-5.3: commits array should have exactly 4 entries (same as Push04State)`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.3 no new commits, AC-5.4 passthrough

- **Test:** `[P0] AC-5.4: Push05State should have tags field (verified by module interface)`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.4 new tags field

- **Test:** `[P0] AC-5.4: branches should remain unchanged at [main, feature/add-retry]`
  - **Status:** PASS (pure value assertion)
  - **Verifies:** AC-5.4 branches passthrough

- **Test:** `[P0] AC-5.4: files should remain unchanged at 9 unique paths`
  - **Status:** PASS (pure value assertion)
  - **Verifies:** AC-5.4 files passthrough

- **Test:** `[P0] AC-5.4: shaMap should be identical to Push04State.shaMap (no new entries)`
  - **Status:** RED - push-05-tag.ts does not exist yet
  - **Verifies:** AC-5.4 shaMap passthrough

- **Test:** `[P1] AC-5.2: kind:30618 event has correct kind and d tag`
  - **Status:** PASS (tests buildRepoRefs)
  - **Verifies:** AC-5.2 event metadata

- **Test:** `[P1] AC-5.1: tag and main both point to the same commit SHA`
  - **Status:** PASS (tests buildRepoRefs)
  - **Verifies:** AC-5.1 tag=main constraint

- **Test:** `[integration] should publish kind:30618 refs with tag to live relay` (.todo)
- **Test:** `[integration] should return valid refsEventId from relay` (.todo)
- **Test:** `[integration] should be queryable by relay after publish` (.todo)

---

## Data Factories Created

N/A -- This story uses deterministic git object construction via the existing seed library (`createGitBlob`, `createGitTree`, `createGitCommit` from `lib/git-builder.ts`). No faker-based data factories are needed.

---

## Fixtures Created

N/A -- Tests are pure unit tests using vitest with dynamic imports. No Playwright fixtures or test.extend() patterns needed for this story.

---

## Mock Requirements

N/A -- Unit tests verify deterministic output of pure functions. The `buildRepoRefs` event builder is tested directly. Integration tests (`.todo`) will use real relay infrastructure when activated.

---

## Required data-testid Attributes

N/A -- This story produces a seed script (backend data generation), not a UI component. No data-testid attributes needed.

---

## Implementation Checklist

### Test: `[P0] should export runPush05 function`

**File:** `packages/rig/tests/e2e/seed/__tests__/push-05-tag.test.ts`

**Tasks to make this test pass:**

- [ ] Create `packages/rig/tests/e2e/seed/push-05-tag.ts`
- [ ] Export `Push05State` interface with all Push04State fields + `tags: string[]`
- [ ] Export `runPush05(aliceClient, aliceSecretKey, push04State): Promise<Push05State>`
- [ ] Import from barrel: `buildRepoRefs`, `publishWithRetry`, `type ShaToTxIdMap`
- [ ] Import `finalizeEvent` from `nostr-tools/pure`
- [ ] Import `REPO_ID` from `push-01-init.js`
- [ ] Import `type Push04State` from `push-04-branch-work.js`
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-05-tag`
- [ ] All 6 failing tests pass (green phase)

**Estimated Effort:** 0.5 hours

### Test: `[P0] AC-5.3: commits array should have exactly 4 entries`

**Tasks to make this test pass:**

- [ ] Ensure `runPush05` does NOT import `createGitBlob`, `createGitTree`, `createGitCommit`, `uploadGitObject`
- [ ] Pass through `push04State.commits` unchanged in return value
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-05-tag`
- [ ] Test passes (green phase)

**Estimated Effort:** included above

### Test: `[P0] AC-5.4: shaMap should be identical`

**Tasks to make this test pass:**

- [ ] Pass through `push04State.shaMap` unchanged in return value
- [ ] Do NOT call `uploadGitObject` or modify shaMap
- [ ] Run test: `cd packages/rig && pnpm test:seed -- push-05-tag`
- [ ] Test passes (green phase)

**Estimated Effort:** included above

### Implementation Summary

**Total tasks:** 1 file to create with ~50 lines of code
**Core implementation:**

1. Build kind:30618 refs event with 3 refs (main, feature/add-retry, v1.0.0 tag)
2. Ensure `refs/heads/main` is first key for HEAD
3. Sign and publish via `publishWithRetry`
4. Return Push05State with all Push04State fields passed through, new `tags: ['v1.0.0']`, updated `refsEventId`

---

## Running Tests

```bash
# Run all seed tests
cd packages/rig && pnpm test:seed

# Run only push-05-tag tests
cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-05-tag.test.ts

# Run tests in watch mode
cd packages/rig && npx vitest --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-05-tag.test.ts

# Debug specific test
cd packages/rig && npx vitest run --config vitest.seed.config.ts --reporter=verbose tests/e2e/seed/__tests__/push-05-tag.test.ts
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 14 unit tests written (6 failing, 8 passing against existing infrastructure)
- 3 integration test stubs (.todo)
- No fixtures or factories needed (deterministic pure-function tests)
- No mock requirements (pure function testing)
- No data-testid requirements (seed script, not UI)
- Implementation checklist created

**Verification:**

- 6 tests fail due to missing `push-05-tag.ts` module
- 8 tests pass (verify existing `buildRepoRefs` behavior and expected values)
- 3 tests are `.todo` (integration stubs)
- All failures are "Failed to load url ../push-05-tag.js" -- missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. Create `packages/rig/tests/e2e/seed/push-05-tag.ts` following the exact pattern from Push 4
2. Export `Push05State` interface and `runPush05` function
3. Build kind:30618 refs with 3 refs including `refs/tags/v1.0.0`
4. Sign and publish with `publishWithRetry`
5. Return state with all passthrough fields + new `tags` field
6. Run tests to verify all 14 pass

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

1. Verify all tests pass
2. Ensure no unnecessary imports (no git builder functions)
3. Ensure consistent code style with Push 3/4 patterns
4. Run full seed test suite to verify no regressions

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/rig && npx vitest run --config vitest.seed.config.ts tests/e2e/seed/__tests__/push-05-tag.test.ts`

**Results:**

```
 Tests  6 failed | 8 passed | 3 todo (17)
```

**Summary:**

- Total tests: 17
- Passing: 8 (existing infrastructure tests)
- Failing: 6 (missing push-05-tag.ts module)
- Todo: 3 (integration stubs)
- Status: RED phase verified

**Expected Failure Messages:**
- All 6 failures: `Failed to load url ../push-05-tag.js (resolved id: ../push-05-tag.js)` -- module does not exist yet

---

## Notes

- This is the simplest push script in the seed suite -- zero git object creation, only a kind:30618 refs publish
- Tests follow the established push-04-branch-work.test.ts pattern: dynamic imports, [P0]/[P1] priority tags, .todo for integration
- Output-based verification approach for "no uploads" constraint (no mocks/spies needed)
- The `buildRepoRefs` event builder already supports arbitrary ref paths including tags -- no new seed lib exports needed
- Object key ordering in JavaScript is insertion order for string keys, so `refs/heads/main` being first ensures HEAD points to main

---

## Knowledge Base References Applied

- **test-quality.md** - Given-When-Then structure, one assertion per test, determinism, isolation
- **data-factories.md** - Confirmed not needed (deterministic git objects, no random data)
- **component-tdd.md** - Confirmed not applicable (no UI components)
- **test-levels-framework.md** - Selected unit level as primary (pure function testing)

---

## Contact

**Questions or Issues?**

- Tag @tea-agent in standup
- Refer to `_bmad/tea/workflows/testarch/atdd/` for workflow documentation
- Consult `_bmad/tea/testarch/knowledge/` for testing best practices

---

**Generated by BMad TEA Agent** - 2026-03-29
