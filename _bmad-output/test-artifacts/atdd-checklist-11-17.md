---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-09'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-17-dungeon-dvm-handler.md'
  - 'packages/pet-dvm/src/dungeon/DungeonGameEngine.ts'
  - 'packages/pet-dvm/src/dungeon/types.ts'
  - 'packages/pet-dvm/src/dungeon/statBridge.ts'
  - 'packages/pet-dvm/src/handler/types.ts'
  - 'packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts'
  - 'packages/pet-dvm/src/index.ts'
  - 'packages/pet-dvm/jest.config.js'
---

# ATDD Checklist - Epic 11, Story 17: Dungeon DVM Handler

**Date:** 2026-04-09
**Author:** Jonathan
**Primary Test Level:** Unit + Integration (Backend — Jest/ts-jest)

---

## Story Summary

A `createDungeonDvmHandler` factory wraps `DungeonGameEngine` and `statBridge` as a kind:5250 compute DVM handler, with a `buildDungeonDvmSkillDescriptor` function for kind:10035 marketplace advertisement. Dungeon runs are ILP-payable compute jobs returning deterministic kind:6250 results, feeding stat deltas back through `applyDungeonDeltaToStats` for downstream ZK-proven pet updates.

**As a** TOON Protocol developer
**I want** a DungeonDvmHandler factory that wraps DungeonGameEngine and statBridge
**So that** dungeon runs are ILP-payable compute jobs that return deterministic kind:6250 results and feed stat deltas back for downstream ZK-proven pet updates

---

## Acceptance Criteria

1. **AC-1** — `DungeonDvmConfig` interface exported from `dungeonDvmHandler.ts`
2. **AC-2** — `createDungeonDvmHandler(config)` factory exported from `dungeonDvmHandler.ts`
3. **AC-3** — Kind:5250 request parsing (tags: p-state, dungeon, seed, pet-stats or resolvePetStats)
4. **AC-4** — ILP payment validation (`ctx.amount < config.pricePerRun` → F01)
5. **AC-5** — Dungeon run pipeline: `petStatsToDungeonStats` → `engine.run` → `applyDungeonDeltaToStats`
6. **AC-6** — Kind:6250 result event construction and fire-and-forget `publishEvent`
7. **AC-7** — `buildDungeonDvmSkillDescriptor` function exported
8. **AC-8** — 5 handler lifecycle unit tests
9. **AC-9** — 4 error path unit tests (including resolvePetStats rejection → T00)
10. **AC-10** — 2 SkillDescriptor unit tests
11. **AC-11** — 2 integration tests (stat delta composition, G18/G19 quality gates)
12. **AC-12** — 1 full-flow integration test (kind:5250 → kind:6250)
13. **AC-13** — Package exports in `src/index.ts`
14. **AC-14** — Build verification: zero TypeScript errors
15. **AC-15** — Test verification: baseline 271 + 14 new = 285 tests all passing

---

## Stack Detection

- **Detected stack:** `backend`
- **Test framework:** Jest + ts-jest (`packages/pet-dvm/jest.config.js`)
- **Generation mode:** AI generation (no browser — pure backend Node.js package)
- **No E2E tests** (backend project — no Playwright)

---

## Failing Tests Created (RED Phase → GREEN Phase Complete)

### Unit Tests — 14 tests total

**File:** `packages/pet-dvm/src/dungeon/dungeonDvmHandler.test.ts`

#### AC-8 — Handler lifecycle (5 tests)

- **Test:** `[P0] valid kind:5250 request with all required tags returns accept:true with base64 result`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Happy path end-to-end; base64 decode produces correct content shape

- **Test:** `[P0] resolvePetStats configured: stats resolved from hash, pet-stats tag ignored`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** When resolvePetStats is configured, the pet-stats tag is ignored and resolver is called with petStateHash

- **Test:** `[P1] pet-stats JSON with one field at exactly 1 (boundary min) runs successfully`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Lower boundary of StatValues (hunger=1) is valid and runs without error

- **Test:** `[P1] pet-stats JSON with all fields at 100 (boundary max) runs successfully`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Upper boundary of StatValues (all=100) is valid and runs without error

- **Test:** `[P0] same (seed, pet-stats) input processed twice produces identical statDeltas (determinism)`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Determinism guarantee — rot.js RNG seeded per-run via RNG.setSeed()

#### AC-9 — Error paths (4 tests)

- **Test:** `[P0] missing seed tag returns accept:false with code F00`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Required tag validation; message contains 'seed'

- **Test:** `[P0] insufficient payment (ctx.amount < pricePerRun) returns accept:false with code F01`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** ILP payment gate; message contains both required and received amounts

- **Test:** `[P0] pet-stats JSON with field value 200 (out of range) returns accept:false with code F00`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Out-of-range pet stat validation; message contains 'pet-stats'

- **Test:** `[P0] resolvePetStats throws → returns accept:false, code T00, message contains "resolvePetStats" or "Failed to resolve pet stats"`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Resolver failure handled as T00 (transient server error), not F00 (client error)

#### AC-10 — SkillDescriptor (2 tests)

- **Test:** `[P0] returns kinds:[5250] and pricing["5250"] equals String(pricePerRun)`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** SkillDescriptor shape; kinds=[5250]; pricing key is string form of bigint

- **Test:** `[P1] default features applied when features omitted`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Default features: ['dungeon-crawl', 'idle-mode', 'loot-system', 'pet-compatible']

#### AC-11 — Stat delta integration (2 tests)

- **Test:** `[P0] G18/G19: updatedStats in result are all within [1, 100] after full handler run`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Quality gate G18 (StatValues clamping) and G19 (handler end-to-end)

- **Test:** `[P1] two different seeds produce different statDeltas (non-trivial dungeon variation)`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** Seeds 'seed-alpha-111' and 'seed-beta-222' produce different stat deltas

#### AC-12 — Full kind:5250 → kind:6250 flow (1 test)

- **Test:** `[P0] publishEvent called once with kind:6250 event; response has required content fields`
  - **Status:** GREEN — passes after implementation
  - **Verifies:** publishEvent called with kind:6250 event including correct tags (request, status:ok, dungeon); response has roomsVisited, loot, statDeltas, narrativeLog

---

## Data Factories

### HandlerContext factory: `makeCtx(overrides)`

**File:** `packages/pet-dvm/src/dungeon/dungeonDvmHandler.test.ts` (inline)

**Exports:**
- `makeCtx({ kind5250Tags?, amount? })` — Creates a mock HandlerContext for kind:5250 requests; `decode()` returns a fixed NostrEvent

### DungeonDvmConfig factory: `makeConfig(overrides)`

**File:** `packages/pet-dvm/src/dungeon/dungeonDvmHandler.test.ts` (inline)

**Exports:**
- `makeConfig(overrides?)` — Creates config with default `width:40, height:30, maxRooms:8, dungeonType:'digger'`, `pricePerRun:10000n`, and `publishEvent: jest.fn()`

---

## Fixtures Created

N/A — All test infrastructure is inline in the test file. No external fixture files needed (backend unit/integration tests with mocks only).

---

## Mock Requirements

### `publishEvent` Mock

**Interface:** `(event: UnsignedEvent) => Promise<void>`

**Usage:** `jest.fn().mockResolvedValue(undefined)` — fire-and-forget; checked for call count and event shape in AC-12

**Failure case:** `jest.fn().mockRejectedValue(new Error('Relay down'))` — must NOT cause handler to return accept:false

### `resolvePetStats` Mock

**Interface:** `(petStateHash: string) => Promise<StatValues> | StatValues`

**Usage:**
- Success: `jest.fn().mockResolvedValue(resolvedStats)` — returns valid StatValues
- Failure: `jest.fn().mockRejectedValue(new Error('DB unavailable'))` — must trigger T00 rejection

---

## Required data-testid Attributes

N/A — Backend package, no UI components.

---

## Implementation Checklist

### Task 1: Create dungeonDvmHandler.ts

- [x] 1.1 Create `packages/pet-dvm/src/dungeon/dungeonDvmHandler.ts`
- [x] 1.2 Implement `DungeonDvmConfig` interface
- [x] 1.3 Implement `createDungeonDvmHandler` factory (construct engine once, return async handler closure)
- [x] 1.4 Implement kind:5250 request parsing (extract tags via `ctx.decode().tags`; call `decode()` once, cache as `event`)
- [x] 1.5 Implement ILP payment validation (`ctx.amount < config.pricePerRun`)
- [x] 1.6 Implement pet stats resolution: mode 1 (resolvePetStats) with T00 on rejection, mode 2 (tag parse) with F00 on invalid JSON/range
- [x] 1.7 Implement dungeon run pipeline: `petStatsToDungeonStats` → `engine.run` → `applyDungeonDeltaToStats`
- [x] 1.8 Implement kind:6250 result event construction and fire-and-forget `publishEvent`
- [x] 1.9 Implement `DungeonSkillDescriptorConfig` interface and local `SkillDescriptor` interface
- [x] 1.10 Implement `buildDungeonDvmSkillDescriptor` function

### Task 2: Write tests

- [x] 2.1 Create `packages/pet-dvm/src/dungeon/dungeonDvmHandler.test.ts`
- [x] 2.2 Implement 5 handler lifecycle unit tests (AC-8)
- [x] 2.3 Implement 4 error path unit tests (AC-9)
- [x] 2.4 Implement 2 SkillDescriptor unit tests (AC-10)
- [x] 2.5 Implement 2 stat delta integration tests (AC-11)
- [x] 2.6 Implement 1 full-flow integration test (AC-12)

### Task 3: Update package exports

- [x] 3.1 Add dungeon handler exports to `packages/pet-dvm/src/index.ts`

### Task 4: Build and test verification

- [x] 4.1 `pnpm --filter @toon-protocol/pet-dvm build` — PASS (zero TypeScript errors)
- [x] 4.2 `pnpm --filter @toon-protocol/pet-dvm test` — PASS (285 total: 271 baseline + 14 new)

---

## Running Tests

```bash
# Run all pet-dvm tests (NEVER run pnpm test at workspace root)
pnpm --filter @toon-protocol/pet-dvm test

# Run only the dungeon handler tests
pnpm --filter @toon-protocol/pet-dvm test -- --testPathPattern="dungeonDvmHandler"

# Build verification
pnpm --filter @toon-protocol/pet-dvm build
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ Test file written with `it.skip()` (red phase)
- ✅ Implementation module not yet present → test suite failed with TS2307
- ✅ All 14 tests verified to fail before implementation

### GREEN Phase (Complete) ✅

- ✅ `dungeonDvmHandler.ts` implemented
- ✅ `it.skip()` removed from all 14 tests
- ✅ All 285 tests pass (271 pre-existing + 14 new)
- ✅ Build passes with zero TypeScript errors

### REFACTOR Phase

No refactoring required. Implementation follows established patterns exactly:
- Factory pattern matches `createPetDvmHandler`
- SkillDescriptor local interface matches `buildPetDvmSkillDescriptor`
- Fire-and-forget `publishEvent` matches existing pattern

---

## Test Execution Evidence

### Final Test Run (GREEN Phase Verification)

**Command:** `pnpm --filter @toon-protocol/pet-dvm test`

**Results:**
```
Test Suites: 14 passed, 14 total
Tests:       285 passed, 285 total
Snapshots:   0 total
Time:        4.081 s
```

**Summary:**
- Total tests: 285
- Passing: 285
- Failing: 0
- Baseline: 271 (pre-story)
- New tests added: 14 (exactly as specified in AC-15)
- Status: ✅ GREEN phase verified

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `packages/pet-dvm/src/dungeon/dungeonDvmHandler.ts` | **Created** | Handler factory + SkillDescriptor builder (AC-1 through AC-7, AC-13) |
| `packages/pet-dvm/src/dungeon/dungeonDvmHandler.test.ts` | **Created** | 14 tests covering AC-8 through AC-12 |
| `packages/pet-dvm/src/index.ts` | **Modified** | Added `createDungeonDvmHandler`, `buildDungeonDvmSkillDescriptor`, `DungeonDvmConfig`, `DungeonSkillDescriptorConfig` exports (AC-13) |

---

## Key Design Decisions Applied

- **D11-PM-003:** `DungeonDvmHandler` is a separate handler — does NOT modify `createPetDvmHandler`
- **D11-PM-004:** Stat feedback uses `applyDungeonDeltaToStats` directly (not `PetGameEngine.processInteraction()`)
- **R-025 mitigation:** Dungeon returns result in one ILP round-trip; stat feedback is async fire-and-forget from caller side
- **decode() called once:** `const event = ctx.decode()` cached at top of handler; reused for tag parsing AND kind:6250 `['request', event.id]` tag
- **Engine constructed once:** `DungeonGameEngine` instantiated at factory time, not per-request
- **Local SkillDescriptor interface:** Not imported from `@toon-protocol/core` (avoids dependency)
- **G18/G19 quality gates:** Validated in AC-11 integration tests

---

## Quality Gates Satisfied

| Gate | Test | Status |
|------|------|--------|
| G18 — StatValues always in [1,100] | AC-11 integration test 1 | ✅ |
| G19 — Dungeon DVM handler processes request end-to-end | AC-12 full-flow test | ✅ |
| Determinism — same (seed, stats) → same deltas | AC-8 determinism test | ✅ |

---

## Knowledge Base References Applied

- **data-factories.md** — Factory pattern (`makeCtx`, `makeConfig`) for test data construction with overrides support
- **test-quality.md** — Determinism (fixed seeds), isolation (jest.fn() mocks, beforeEach clear), one assertion focus per test
- **test-levels-framework.md** — Unit tests for handler logic; integration tests for full pipeline (AC-11, AC-12)
- **ci-burn-in.md** — Sequential test execution (rot.js global RNG singleton; Jest runs in band by default for pet-dvm)

---

**Generated by BMad TEA Agent** — 2026-04-09
