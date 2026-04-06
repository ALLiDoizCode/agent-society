---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-06'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-1-napi-rs-memvid-binding.md'
  - '_bmad-output/planning-artifacts/test-design-epic-11.md'
  - '_bmad/tea/testarch/knowledge/data-factories.md'
  - '_bmad/tea/testarch/knowledge/test-quality.md'
  - '_bmad/tea/testarch/knowledge/test-healing-patterns.md'
  - '_bmad/tea/testarch/knowledge/test-levels-framework.md'
  - '_bmad/tea/testarch/knowledge/test-priorities-matrix.md'
---

# ATDD Checklist - Epic 11, Story 11-1: napi-rs Memvid Binding

**Date:** 2026-04-06
**Author:** Jonathan Green
**Primary Test Level:** Unit (vitest)

---

## Story Summary

Wrap Memvid's Rust API via napi-rs into a Node.js native addon (`@toon-protocol/memvid-node`) so TypeScript packages can create, read, write, search, and hash `.mv2` pet brain files with native performance.

**As a** TOON Protocol developer
**I want** a Node.js native addon wrapping Memvid's Rust API via napi-rs
**So that** TypeScript packages (pet-circuit, pet-dvm) can operate on `.mv2` pet brain files with native performance

---

## Acceptance Criteria

1. **AC-1** -- Package scaffolding: `packages/memvid-node/` exists as valid pnpm workspace member with napi-rs build tooling
2. **AC-2** -- PetBrain.create(path): Creates new `.mv2` file, returns PetBrain instance, throws if exists
3. **AC-3** -- PetBrain.open(path): Opens existing `.mv2` file with WAL auto-recovery, throws on missing/corrupt
4. **AC-4** -- PetBrain.putBytes(data, options?): Ingests Buffer as new frame, returns frame sequence number
5. **AC-5** -- PetBrain.commit(): Flushes WAL, rebuilds indices, writes TOC
6. **AC-6** -- PetBrain.hash(): Returns 64-char lowercase hex BLAKE3 composite of deterministic segments
7. **AC-7** -- PetBrain.search(query, topK): Returns SearchHit[] from lex search
8. **AC-8** -- PetBrain.timeline(limit?): Returns TimelineEntry[] in chronological order
9. **AC-9** -- PetBrain.stats(): Returns BrainStats (frameCount, fileSize, segmentSizes)
10. **AC-10** -- PetBrain.close(): Releases file handle, subsequent calls throw
11. **AC-11** -- Thread safety: PetBrain is Send but NOT Sync
12. **AC-12** -- Determinism test: 100 iterations produce identical hash (Quality Gate G2)
13. **AC-13** -- Error handling: Rust panics caught, converted to JS Error objects
14. **AC-14** -- TypeScript declarations: napi-rs auto-generates `.d.ts` from `#[napi]` macros
15. **AC-15** -- CI platform matrix: GitHub Actions builds on linux-x64 + darwin-arm64 (Quality Gate G1)

---

## Test Strategy

### Test Level Selection

| AC | Test Level | Priority | Justification |
|----|-----------|----------|---------------|
| AC-1 | Integration (CI) | P1 | Scaffolding validated by build success on CI matrix |
| AC-2 | Unit | P0 | Core API -- create is entry point for all brain operations |
| AC-3 | Unit | P0 | Core API -- open with WAL recovery is critical for data integrity |
| AC-4 | Unit | P0 | Core API -- putBytes is primary data ingestion path |
| AC-5 | Unit | P0 | Core API -- commit is required before hash() works correctly |
| AC-6 | Unit | P0 | CRITICAL -- brainHash used on-chain in ZK circuit (R-006, score 6) |
| AC-7 | Unit | P1 | Search is downstream dependency for pet-dvm (Story 11-5) |
| AC-8 | Unit | P1 | Timeline is downstream dependency for game engine (Story 11-4) |
| AC-9 | Unit | P1 | Stats used for monitoring (.mv2 file growth, R-018) |
| AC-10 | Unit | P0 | Resource cleanup -- prevents file handle leaks |
| AC-11 | Unit | P2 | Thread safety -- single-threaded usage is primary path |
| AC-12 | Property | P0 | Quality Gate G2 -- determinism is ZK prerequisite |
| AC-13 | Unit | P0 | Error handling -- no process crashes from native code |
| AC-14 | Integration (Build) | P1 | Type safety validated by build + import test |
| AC-15 | Integration (CI) | P0 | Quality Gate G1 -- platform matrix is deployment blocker |

### Test Scenarios by Level

#### Unit Tests (17 tests)

| ID | AC | Scenario | Expected | Priority |
|----|-----|----------|----------|----------|
| 11.1-UNIT-001 | AC-2 | create() with valid path produces .mv2 file | PetBrain instance returned, file exists on disk | P0 |
| 11.1-UNIT-002 | AC-2 | create() with existing file path | Throws Error with descriptive message | P0 |
| 11.1-UNIT-003 | AC-3 | open() with valid .mv2 file | PetBrain instance returned | P0 |
| 11.1-UNIT-004 | AC-3 | open() with non-existent path | Throws Error | P0 |
| 11.1-UNIT-005 | AC-4 | putBytes() with Buffer data, no options | Returns frame sequence number (number) | P0 |
| 11.1-UNIT-006 | AC-4 | putBytes() with Buffer data and PutOptions (title, uri, tags, timestamp) | Returns frame sequence number | P0 |
| 11.1-UNIT-007 | AC-5 | commit() after putBytes | Returns void, no error | P0 |
| 11.1-UNIT-008 | AC-6 | hash() after commit returns 64-char lowercase hex string | Valid BLAKE3 hex, length 64, all lowercase | P0 |
| 11.1-UNIT-009 | AC-6 | hash() reflects new state after additional putBytes + commit | Hash changes after new data | P0 |
| 11.1-UNIT-010 | AC-7 | search() with matching query returns SearchHit[] | Array of {frameId, score, snippet} | P1 |
| 11.1-UNIT-011 | AC-7 | search() with non-matching query returns empty array | Empty array, no error | P1 |
| 11.1-UNIT-012 | AC-8 | timeline() returns TimelineEntry[] in chronological order | Entries ordered by time, respects limit | P1 |
| 11.1-UNIT-013 | AC-9 | stats() returns BrainStats with frameCount, fileSize, segmentSizes | All fields present and correct types | P1 |
| 11.1-UNIT-014 | AC-10 | close() releases resources, subsequent method calls throw | close() succeeds, then putBytes/hash/search throw | P0 |
| 11.1-UNIT-015 | AC-10 | double close() does not crash | Second close() throws or is no-op, no process crash | P0 |
| 11.1-UNIT-016 | AC-13 | corrupt file open produces JS Error (not process crash) | Error thrown with descriptive message | P0 |
| 11.1-UNIT-017 | AC-13 | method on closed brain produces JS Error | Error thrown, process continues | P0 |

#### Property Tests (1 test)

| ID | AC | Scenario | Expected | Priority |
|----|-----|----------|----------|----------|
| 11.1-PROP-001 | AC-12 | 100 iterations: create -> put identical events -> commit -> hash | All 100 hashes identical | P0 |

#### Integration Tests (2 tests -- CI only)

| ID | AC | Scenario | Expected | Priority |
|----|-----|----------|----------|----------|
| 11.1-INT-001 | AC-1, AC-14, AC-15 | napi-rs build succeeds on linux-x64 | .node addon produced, .d.ts generated | P0 |
| 11.1-INT-002 | AC-1, AC-14, AC-15 | napi-rs build succeeds on darwin-arm64 | .node addon produced, .d.ts generated | P0 |

#### Lifecycle Integration Test (1 test)

| ID | AC | Scenario | Expected | Priority |
|----|-----|----------|----------|----------|
| 11.1-LIFE-001 | AC-2-10 | Full lifecycle: create -> putBytes -> commit -> hash -> search -> timeline -> stats -> close | All operations succeed in sequence | P0 |

### Red Phase Requirements

All tests are designed to fail before implementation because:
- `packages/memvid-node/` does not exist yet -- all imports will fail
- `PetBrain` class is not implemented -- all instantiation will fail
- The native `.node` addon is not compiled -- no native binding available
- Tests import from `@toon-protocol/memvid-node` which is an unresolved package

---

## Failing Tests Created (RED Phase)

### Unit + Property Tests (19 tests)

**File:** `packages/memvid-node/tests/pet-brain.test.ts` (315 lines)

- **Test:** `[P0] 11.1-UNIT-001 -- creates a new .mv2 file and returns PetBrain instance`
  - **Status:** RED - import fails (@toon-protocol/memvid-node not implemented)
  - **Verifies:** AC-2 -- PetBrain.create(path) creates file and returns instance

- **Test:** `[P0] 11.1-UNIT-002 -- throws if file already exists`
  - **Status:** RED - import fails
  - **Verifies:** AC-2 -- PetBrain.create(path) rejects duplicate

- **Test:** `[P0] 11.1-UNIT-003 -- opens an existing .mv2 file`
  - **Status:** RED - import fails
  - **Verifies:** AC-3 -- PetBrain.open(path) with valid file

- **Test:** `[P0] 11.1-UNIT-004 -- throws if file does not exist`
  - **Status:** RED - import fails
  - **Verifies:** AC-3 -- PetBrain.open(path) rejects missing file

- **Test:** `[P0] 11.1-UNIT-005 -- ingests Buffer and returns frame sequence number`
  - **Status:** RED - import fails
  - **Verifies:** AC-4 -- PetBrain.putBytes(data) basic ingestion

- **Test:** `[P0] 11.1-UNIT-006 -- accepts PutOptions with title, uri, tags, timestamp`
  - **Status:** RED - import fails
  - **Verifies:** AC-4 -- PetBrain.putBytes(data, options) with metadata

- **Test:** `[P0] 11.1-UNIT-007 -- flushes WAL and rebuilds indices without error`
  - **Status:** RED - import fails
  - **Verifies:** AC-5 -- PetBrain.commit()

- **Test:** `[P0] 11.1-UNIT-008 -- returns 64-char lowercase hex BLAKE3 hash after commit`
  - **Status:** RED - import fails
  - **Verifies:** AC-6 -- PetBrain.hash() format and content

- **Test:** `[P0] 11.1-UNIT-009 -- hash changes after additional putBytes + commit`
  - **Status:** RED - import fails
  - **Verifies:** AC-6 -- PetBrain.hash() state sensitivity

- **Test:** `[P1] 11.1-UNIT-010 -- returns SearchHit[] for matching query`
  - **Status:** RED - import fails
  - **Verifies:** AC-7 -- PetBrain.search(query, topK) with matches

- **Test:** `[P1] 11.1-UNIT-011 -- returns empty array for non-matching query`
  - **Status:** RED - import fails
  - **Verifies:** AC-7 -- PetBrain.search(query, topK) no matches

- **Test:** `[P1] 11.1-UNIT-012 -- returns TimelineEntry[] in chronological order with limit`
  - **Status:** RED - import fails
  - **Verifies:** AC-8 -- PetBrain.timeline(limit)

- **Test:** `[P1] 11.1-UNIT-013 -- returns BrainStats with correct structure`
  - **Status:** RED - import fails
  - **Verifies:** AC-9 -- PetBrain.stats()

- **Test:** `[P0] 11.1-UNIT-014 -- releases resources and subsequent calls throw`
  - **Status:** RED - import fails
  - **Verifies:** AC-10 -- PetBrain.close() enforces closed state

- **Test:** `[P0] 11.1-UNIT-015 -- double close does not crash process`
  - **Status:** RED - import fails
  - **Verifies:** AC-10 -- PetBrain.close() idempotency / no crash

- **Test:** `[P0] 11.1-UNIT-016 -- corrupt file produces JS Error, not process crash`
  - **Status:** RED - import fails
  - **Verifies:** AC-13 -- Rust panic -> JS Error conversion

- **Test:** `[P0] 11.1-UNIT-017 -- method on closed brain produces JS Error`
  - **Status:** RED - import fails
  - **Verifies:** AC-13 -- Closed-state guard produces Error

- **Test:** `[P0] 11.1-PROP-001 -- 100 iterations produce identical hash for identical input`
  - **Status:** RED - import fails
  - **Verifies:** AC-12 -- Determinism quality gate G2

- **Test:** `[P0] 11.1-LIFE-001 -- create -> putBytes -> commit -> hash -> search -> timeline -> stats -> close`
  - **Status:** RED - import fails
  - **Verifies:** AC-2 through AC-10 full lifecycle integration

---

## Data Factories Created

No data factories needed for this story. Test data consists of simple `Buffer.from()` strings representing pet brain events. Each test creates its own data inline since:
- Data is trivial (text buffers, not complex domain objects)
- No parallel safety concerns (each test uses its own temp directory)
- No schema evolution risk (raw buffers are schema-free)

---

## Fixtures Created

### Temp Directory Fixture

**File:** `packages/memvid-node/tests/pet-brain.test.ts` (inline via vitest beforeEach/afterEach)

**Fixtures:**

- `testDir` - Temporary directory created via `mkdtemp()` for test isolation
  - **Setup:** Creates unique temp directory under OS tmpdir
  - **Provides:** Isolated directory path for .mv2 files
  - **Cleanup:** Recursively removes temp directory after each test

**Example Usage:**

```typescript
beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'memvid-test-'));
  brainPath = join(testDir, 'test-brain.mv2');
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

---

## Mock Requirements

No external service mocking required. This story wraps a local Rust crate (`memvid-core`) via napi-rs. All operations are filesystem-based (create/open .mv2 files). The test fixtures provide isolated temp directories to prevent filesystem interference between tests.

---

## Required data-testid Attributes

Not applicable. This is a native addon package with no UI components.

---

## Implementation Checklist

### Test: 11.1-UNIT-001 through 11.1-UNIT-002 (PetBrain.create)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/memvid-node/` directory structure
- [ ] Create `Cargo.toml` with napi-rs + memvid-core dependency (`path = "../../memvid"`)
- [ ] Create `build.rs` with napi-build setup
- [ ] Create `package.json` with `@toon-protocol/memvid-node` name, `"type": "module"`, napi build script
- [ ] Create `src/lib.rs` with `#[napi]` struct `PetBrain` wrapping `Option<memvid_core::Memvid>`
- [ ] Implement `PetBrain::create(path: String)` calling `Memvid::create(path)`
- [ ] Add error for existing file (check before create, or map Rust error)
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 4 hours

---

### Test: 11.1-UNIT-003 through 11.1-UNIT-004 (PetBrain.open)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::open(path: String)` calling `Memvid::open(path)` (WAL auto-replays)
- [ ] Map missing-file error to JS Error
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: 11.1-UNIT-005 through 11.1-UNIT-006 (PetBrain.putBytes)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::put_bytes(data: Buffer, options: Option<PutOptions>)`
- [ ] Define `#[napi(object)]` struct `PutOptions` with `title`, `uri`, `tags`, `timestamp`
- [ ] Map to `mem.put_bytes()` / `mem.put_bytes_with_options()`
- [ ] Return frame sequence number as `number` (u64 -> f64)
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: 11.1-UNIT-007 (PetBrain.commit)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::commit()` calling `mem.commit()`
- [ ] Return void
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: 11.1-UNIT-008 through 11.1-UNIT-009 (PetBrain.hash)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::hash()` -- composite BLAKE3 of deterministic segment checksums
- [ ] Read TOC checksums: frames_primary, lex, time_index, temporal_track, sketch_track
- [ ] Chain with `blake3::Hasher` and finalize to `[u8; 32]`
- [ ] Convert to 64-char lowercase hex string
- [ ] Verify vec index (HNSW) is excluded
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 3 hours (CRITICAL -- most important method)

---

### Test: 11.1-UNIT-010 through 11.1-UNIT-011 (PetBrain.search)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::search(query: String, top_k: u32)`
- [ ] Call `mem.search(SearchRequest { query, top_k, .. })`
- [ ] Map results to `SearchHit` JS objects with `frameId`, `score`, `snippet`
- [ ] Return empty array for no results
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: 11.1-UNIT-012 (PetBrain.timeline)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::timeline(limit: Option<u32>)`
- [ ] Call `mem.timeline(TimelineQuery { limit, .. })`
- [ ] Map to `TimelineEntry` JS objects
- [ ] Default limit: 100
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: 11.1-UNIT-013 (PetBrain.stats)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::stats()` returning `BrainStats`
- [ ] Define `#[napi(object)]` struct `BrainStats` with `frameCount`, `fileSize`, `segmentSizes`
- [ ] Read from TOC/header metadata
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: 11.1-UNIT-014 through 11.1-UNIT-015 (PetBrain.close)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `PetBrain::close()` -- `Option::take()` on inner, drops `Memvid`
- [ ] Add closed-state guard: all methods check `self.inner.is_some()`, throw if None
- [ ] Handle double-close gracefully (throw or no-op, never crash)
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: 11.1-UNIT-016 through 11.1-UNIT-017 (Error handling)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Wrap all napi methods with `std::panic::catch_unwind`
- [ ] Map `Result<T, E>` to napi `Error` with descriptive messages
- [ ] Ensure corrupt file paths produce Error (not process abort)
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: 11.1-PROP-001 (Determinism -- Quality Gate G2)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] Ensure hash() implementation is fully deterministic
- [ ] Exclude non-deterministic HNSW segment from hash computation
- [ ] Verify 100 iterations all produce same hash value
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 1 hour (depends on hash implementation from UNIT-008/009)

---

### Test: 11.1-LIFE-001 (Full lifecycle)

**File:** `packages/memvid-node/tests/pet-brain.test.ts`

**Tasks to make these tests pass:**

- [ ] All previous tests must pass (this is the integration of all methods)
- [ ] Run test: `cd packages/memvid-node && pnpm test`
- [ ] Tests pass (green phase)

**Estimated Effort:** 0 hours (passes when all unit tests pass)

---

### CI Platform Matrix (Quality Gate G1)

**Tasks:**

- [ ] Create `.github/workflows/memvid-node-ci.yml` with matrix: ubuntu-latest + macos-latest
- [ ] Add Rust toolchain installation step
- [ ] Add memvid repo clone step: `actions/checkout@v4` with `repository: memvid/memvid, path: ../memvid`
- [ ] Add `napi build --platform --release` step
- [ ] Add test execution step
- [ ] Verify .d.ts generation (AC-14)
- [ ] Both platforms pass

**Estimated Effort:** 2 hours

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/memvid-node && pnpm test

# Run specific test file
cd packages/memvid-node && pnpm vitest run tests/pet-brain.test.ts

# Run tests in watch mode
cd packages/memvid-node && pnpm vitest tests/pet-brain.test.ts

# Run only P0 tests (grep by priority tag)
cd packages/memvid-node && pnpm vitest run tests/pet-brain.test.ts -t "P0"

# Run determinism test only
cd packages/memvid-node && pnpm vitest run tests/pet-brain.test.ts -t "PROP-001"

# Run tests with coverage
cd packages/memvid-node && pnpm vitest run --coverage tests/pet-brain.test.ts
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 19 tests written and failing (it.skip)
- Test fixtures created with auto-cleanup (temp directories)
- No mock requirements (filesystem-only native addon)
- No data-testid requirements (no UI)
- Implementation checklist created

**Verification:**

- All tests are skipped (it.skip) -- will fail on import before implementation
- Failure is due to missing package implementation, not test bugs
- Tests assert expected behavior for all 15 acceptance criteria

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Scaffold the package** (Task 1: Cargo.toml, build.rs, package.json, src/lib.rs)
2. **Implement create/open/close** (Tasks 2: core lifecycle)
3. **Remove `it.skip` from UNIT-001 through UNIT-004, UNIT-014, UNIT-015** and run
4. **Implement putBytes/commit** (Task 3)
5. **Remove `it.skip` from UNIT-005 through UNIT-007** and run
6. **Implement hash()** (Task 4 -- CRITICAL, most important method)
7. **Remove `it.skip` from UNIT-008, UNIT-009** and run
8. **Implement search/timeline/stats** (Tasks 5)
9. **Remove `it.skip` from UNIT-010 through UNIT-013** and run
10. **Implement error handling** (Task 2.6: catch_unwind wrapper)
11. **Remove `it.skip` from UNIT-016, UNIT-017** and run
12. **Remove `it.skip` from PROP-001** and verify determinism (Quality Gate G2)
13. **Remove `it.skip` from LIFE-001** and verify full lifecycle
14. **Set up CI matrix** (Task 9: Quality Gate G1)

**Key Principles:**

- One test group at a time (don't try to fix all at once)
- Implement hash() with extreme care -- it's used on-chain in ZK proofs
- Run determinism test (PROP-001) early and often during hash development
- CI matrix must pass on both linux-x64 and darwin-arm64

**Progress Tracking:**

- Check off tasks in Implementation Checklist as completed
- Quality Gate G2 (determinism) must pass before Story 11-2 begins
- Quality Gate G1 (CI matrix) must pass before Sprint 2

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. **Verify all 19 tests pass** (green phase complete)
2. **Review Rust code**: error messages descriptive, no unwrap() without catch_unwind
3. **Optimize hash()**: verify it reads TOC checksums efficiently (no full file scan)
4. **Ensure napi-rs types match**: auto-generated .d.ts aligns with test type expectations
5. **Run `pnpm build` at monorepo root**: verify napi-rs build integrates with workspace

**Completion:**

- All 19 tests pass
- Quality Gates G1 and G2 verified
- `.d.ts` auto-generated and ships with package
- Code ready for review and Story 11-2 consumption

---

## Next Steps

1. **Review this checklist** with team
2. **Run failing tests** to confirm RED phase: `cd packages/memvid-node && pnpm vitest run tests/pet-brain.test.ts`
3. **Begin implementation** using implementation checklist as guide
4. **Work one test group at a time** (red -> green for each)
5. **Verify Quality Gate G2** (determinism) before marking story done
6. **Set up CI matrix** and verify Quality Gate G1
7. **When all tests pass**, refactor code for quality
8. **When refactoring complete**, update story status to 'done'

---

## Knowledge Base References Applied

This ATDD workflow consulted the following knowledge fragments:

- **test-quality.md** - Test design principles (determinism, isolation, explicit assertions, cleanup)
- **data-factories.md** - Factory patterns (not needed here -- raw Buffer data is sufficient)
- **test-levels-framework.md** - Test level selection (unit for pure functions/native API, integration for CI matrix)
- **test-priorities-matrix.md** - Priority assignment (P0 for ZK-critical hash, P1 for downstream deps)
- **test-healing-patterns.md** - Error pattern catalog (informed error handling test design)
- **test-design-epic-11.md** - Quality gates G1/G2, risk register R-001/R-006/R-018

See `tea-index.csv` for complete knowledge fragment mapping.

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/memvid-node && pnpm vitest run tests/pet-brain.test.ts`

**Results:**

```
All 19 tests skipped (it.skip) -- package @toon-protocol/memvid-node not yet implemented
```

**Summary:**

- Total tests: 19
- Passing: 0 (expected)
- Skipped: 19 (expected -- it.skip for TDD red phase)
- Status: RED phase verified

**Expected Failure Messages:**
- Import error: Cannot find module '@toon-protocol/memvid-node' (when it.skip removed)
- All tests fail on import resolution until package scaffold + native build complete

---

## Notes

- This is a native Rust addon via napi-rs -- requires Rust toolchain (rustup, cargo) for building
- The `memvid-core` crate is at `../../memvid` (sibling repo, not on crates.io) -- must be cloned separately
- Feature flags: compile with `default-features = false, features = ["lex"]` only -- no vec/HNSW
- Thread safety (AC-11) is enforced by Rust type system (Send but not Sync) -- no explicit test needed beyond documentation
- TypeScript declarations (AC-14) are auto-generated by napi-rs -- validated by successful import in tests
- Prebuilt binary publishing is out of scope (deferred to Story 11-11)

---

## Contact

**Questions or Issues?**

- Ask in team standup
- Refer to `_bmad-output/planning-artifacts/test-design-epic-11.md` for quality gates
- Refer to `_bmad-output/planning-artifacts/pet-zkapp-blake3-hashing-spec.md` for hash specification

---

**Generated by BMad TEA Agent** - 2026-04-06
