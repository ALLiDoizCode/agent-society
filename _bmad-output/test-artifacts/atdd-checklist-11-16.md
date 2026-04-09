---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-09'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-16-pet-dungeon-stat-bridge.md'
  - 'packages/pet-dvm/src/dungeon/types.ts'
  - 'packages/pet-dvm/src/engine/types.ts'
  - 'packages/pet-circuit/src/constants.ts'
  - 'packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts'
---

# ATDD Checklist — Epic 11, Story 11-16: Pet-Dungeon Stat Bridge

**Date:** 2026-04-09
**Author:** TEA Agent
**Primary Test Level:** Unit (pure functions, no HTTP/Nostr/IO)
**TDD Phase:** RED (failing tests generated — `statBridge.ts` does not exist yet)

---

## Story Summary

Pure mapping functions that translate `StatValues` from the Pet Game Engine into `DungeonPetStats` modifiers and clamp `DungeonStatDelta` results back into valid `StatValues` bounds. The bridge is a seam between the ZK-circuit domain (`StatValues`) and the dungeon domain (`DungeonPetStats`), enabling pet care decisions to create meaningful dungeon outcomes that can be fed back through the PetGameEngine for ZK-proven stat updates.

**As a** TOON Protocol developer
**I want** pure mapping functions between `StatValues` and `DungeonPetStats`
**So that** pet care decisions create meaningful dungeon outcomes that can be ZK-proven

---

## Stack Detection

- **Detected stack:** `backend` (TypeScript package, Jest/ts-jest, no UI/browser)
- **Generation mode:** AI generation (backend stack, no browser recording needed)
- **Test framework:** Jest + ts-jest (`packages/pet-dvm` pattern)
- **Test levels:** Unit only (pure functions + real engine integration)

---

## Acceptance Criteria

| AC | Description | Test Coverage |
|----|-------------|--------------|
| AC-1 | `petStatsToDungeonStats(petStats: StatValues): DungeonPetStats` exported from `statBridge.ts` (1:1 pass-through with validation) | AC-6 tests |
| AC-2 | `dungeonDeltaToGameAction(result, currentStats, timestamp): GameAction` exported from `statBridge.ts` | AC-9 tests |
| AC-3 | `applyDungeonDeltaToStats(currentStats, delta): StatValues` exported from `statBridge.ts` | AC-7 + AC-8 tests |
| AC-4 | `clampStatValues(stats: StatValues): StatValues` exported from `statBridge.ts` | (helper, tested via AC-7/AC-8 indirectly) |
| AC-5 | `StatBridgeError` + `StatBridgeErrorCode` with correct prototype chain | AC-6, AC-7, AC-9 error tests |
| AC-6 | 5 stat mapping unit tests | ✅ 5 tests written (RED) |
| AC-7 | 4 boundary case unit tests | ✅ 4 tests written (RED) |
| AC-8 | 3 integration tests with real `DungeonGameEngine` | ✅ 3 tests written (RED) |
| AC-9 | 4 cross-verify tests for `dungeonDeltaToGameAction` | ✅ 4 tests written (RED) |
| AC-10 | Public symbols exported from `packages/pet-dvm/src/index.ts` | Not tested here — verified by build |
| AC-11 | Build verification: zero TypeScript errors | Not tested here — build gate |
| AC-12 | Test verification: all tests pass (16 new + existing baseline) | Gate: run after implementation |

---

## Test Strategy

### Test Levels Decision

This story is **pure backend** — pure TypeScript functions with no HTTP, Nostr, or IO. All tests are **unit tests**. There is one integration touchpoint: AC-8 uses the real `DungeonGameEngine` to verify that the bridge produces valid `StatValues` output after a real run.

- **No E2E tests** needed (no UI, no API endpoints)
- **No API contract tests** needed (no service boundary)
- **Unit tests only**: 16 tests across 4 `describe` blocks

### Risk Assessment

| Risk | Priority | Mitigation |
|------|----------|------------|
| `StatBridgeError instanceof` failing across module boundaries | P0 | Constructor must set `this.name` and `Object.setPrototypeOf` — test verifies `instanceof` |
| NaN/Infinity inputs corrupting ZK-circuit state | P0 | Explicit finite-number validation in all input functions |
| Stats going below 1 after large negative dungeon deltas | P0 | `Math.max(1, Math.min(100, value))` clamp — boundary tests verify this |
| `dungeonDeltaToGameAction` returning wrong ActionType | P1 | Hand-crafted stubs test each branch deterministically |
| Circular dependency: `statBridge.ts` → `engine/types.ts` vs `@toon-protocol/pet-circuit` | P1 | Story explicitly uses `../engine/types` (not circuit) for `StatValues` |

---

## Failing Tests Created (RED Phase)

### Test File

**File:** `packages/pet-dvm/src/dungeon/statBridge.test.ts`

All 16 tests use `test.skip()` — they assert expected behavior but will fail until `statBridge.ts` is implemented.

---

### AC-6: Stat Mapping Tests (5 tests)

| # | Test Name | Priority | AC | Expected Behavior |
|---|-----------|----------|----|-------------------|
| 1 | maps maxed stats (all 100) to identical DungeonPetStats | P0 | AC-1 | All 5 fields = 100 (1:1 pass-through) |
| 2 | maps minimum stats (all 1) to identical DungeonPetStats | P0 | AC-1 | All 5 fields = 1 (1:1 pass-through) |
| 3 | maps mixed stats field-by-field (1:1 pass-through) | P0 | AC-1 | Each field echoed exactly |
| 4 | throws StatBridgeError INVALID_STATS when a field is 101 | P1 | AC-5 | `StatBridgeError` with `code = 'INVALID_STATS'`, `instanceof` correct |
| 5 | throws StatBridgeError INVALID_STATS when a field is NaN | P1 | AC-5 | `StatBridgeError` with `code = 'INVALID_STATS'`, `instanceof` correct |

---

### AC-7: Boundary Case Tests (4 tests)

| # | Test Name | Priority | AC | Expected Behavior |
|---|-----------|----------|----|-------------------|
| 6 | large negative deltas clamp all stats to minimum 1 | P0 | AC-3 | All fields = 1 after -200 delta |
| 7 | large positive deltas clamp all stats to maximum 100 | P0 | AC-3 | All fields = 100 after +200 delta |
| 8 | zero deltas leave stats unchanged | P0 | AC-3 | Output identical to input |
| 9 | throws StatBridgeError INVALID_DELTA when a delta field is NaN | P1 | AC-5 | `StatBridgeError` with `code = 'INVALID_DELTA'` |

---

### AC-8: Stat Delta Within-Bounds Tests (3 tests)

Uses real `DungeonGameEngine` with fixed seeds for determinism. No mocking.

| # | Test Name | Priority | AC | Expected Behavior |
|---|-----------|----------|----|-------------------|
| 10 | typical stats: real engine run produces all-finite stats in [1,100] | P0 | AC-3, G18 | All 5 fields finite AND in [1,100] after real run |
| 11 | minimum stats (all 1): result stays >= 1 after clamping | P0 | AC-3, G18 | All 5 fields >= 1 |
| 12 | maximum stats (all 100): result stays <= 100 after clamping | P0 | AC-3, G18 | All 5 fields <= 100 |

**Quality Gate G18 note:** These tests verify the precondition for G18 ("Pet stat deltas from dungeon accepted by PetGameEngine"). Full G18 gate validation is downstream in Story 11-17.

---

### AC-9: Cross-Verify Tests (4 tests)

Uses hand-crafted `DungeonRunResult` stubs — does NOT rely on live engine output.

| # | Test Name | Priority | AC | Expected Behavior |
|---|-----------|----------|----|-------------------|
| 13 | wins > losses → returns ActionType.PLAY | P0 | AC-2 | `actionType = ActionType.PLAY (1)`, `itemId = 0`, `tokenCost = 0` |
| 14 | wins <= losses AND positive health delta → returns ActionType.MEDICINE | P1 | AC-2 | `actionType = ActionType.MEDICINE (8)`, `itemId = 0`, `tokenCost = 0` |
| 15 | no encounters, zero health delta → returns ActionType.REST | P2 | AC-2 | `actionType = ActionType.REST (3)`, `itemId = 0`, `tokenCost = 0` |
| 16 | invalid timestamp → throws StatBridgeError INVALID_TIMESTAMP | P1 | AC-5 | `StatBridgeError` with `code = 'INVALID_TIMESTAMP'` |

---

## TDD Red Phase Summary

```
🔴 TDD RED PHASE: Failing Tests Generated

📊 Summary:
- Total Tests: 16 (all with test.skip())
  - Stat Mapping Tests (AC-6): 5
  - Boundary Case Tests (AC-7): 4
  - Within-Bounds Integration Tests (AC-8): 3
  - ActionType Cross-Verify Tests (AC-9): 4
- All tests will FAIL until statBridge.ts is implemented

✅ Acceptance Criteria Coverage:
- AC-1 (petStatsToDungeonStats): 5 tests
- AC-2 (dungeonDeltaToGameAction): 4 tests
- AC-3 (applyDungeonDeltaToStats): 7 tests
- AC-4 (clampStatValues): implicitly covered by AC-7/AC-8
- AC-5 (StatBridgeError): 4 error-path tests
- AC-6 through AC-9: fully covered

📂 Generated Files:
- packages/pet-dvm/src/dungeon/statBridge.test.ts (16 failing tests, TDD red phase)
- _bmad-output/test-artifacts/atdd-checklist-11-16.md (this file)
```

---

## Implementation Guidance

Files to create/modify for green phase:

1. **Create** `packages/pet-dvm/src/dungeon/statBridge.ts` — implement all 4 exported functions + `StatBridgeError` class
2. **Modify** `packages/pet-dvm/src/index.ts` — add bridge exports (AC-10)

Key implementation constraints:
- `StatBridgeError` must have `this.name = 'StatBridgeError'` AND `Object.setPrototypeOf(this, StatBridgeError.prototype)` — see `DungeonEngineError` pattern in `types.ts`
- `petStatsToDungeonStats` validates ALL 5 fields: `!Number.isFinite(v) || v < 1 || v > 100`
- `applyDungeonDeltaToStats` validates ALL 5 delta fields are finite: `!Number.isFinite(v)`
- `dungeonDeltaToGameAction` validates: `!Number.isFinite(timestamp) || timestamp <= 0`
- Import `StatValues`/`GameAction` from `../engine/types` — NOT from `@toon-protocol/pet-circuit`
- Import `ActionType` from `@toon-protocol/pet-circuit`

---

## Next Steps (TDD Green Phase)

After implementing `statBridge.ts`:

1. Remove `test.skip()` from all 16 tests in `statBridge.test.ts`
2. Run: `pnpm --filter @toon-protocol/pet-dvm test`
3. Verify all 16 new tests pass AND existing suite still passes
4. Run: `pnpm --filter @toon-protocol/pet-dvm build` — verify zero TypeScript errors
5. Proceed to Story 11-17 (Dungeon DVM Handler)

---

## Validation Checklist

- [x] All 16 tests use `test.skip()` (TDD red phase compliant)
- [x] All tests assert expected behavior (no placeholder `expect(true).toBe(true)`)
- [x] Error tests use `instanceof StatBridgeError` + `.code` checks
- [x] AC-8 tests use real `DungeonGameEngine` with fixed seeds (deterministic)
- [x] AC-9 tests use hand-crafted stubs (not live engine — deterministic)
- [x] Test file follows existing `DungeonGameEngine.test.ts` patterns (Jest, `describe`/`test`, no Vitest)
- [x] No orphaned browser sessions (backend-only tests)
- [x] Temp artifacts stored in `_bmad-output/test-artifacts/` (not random locations)
- [x] Story 11-17 downstream dependency noted (`dungeonDeltaToGameAction` warning documented in story)
