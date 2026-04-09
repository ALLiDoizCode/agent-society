# Story 11.16: Pet-Dungeon Stat Bridge

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TOON Protocol developer,
I want pure mapping functions that translate `StatValues` from the Pet Game Engine into `DungeonPetStats` modifiers and clamp `DungeonStatDelta` results back into valid `StatValues` bounds,
so that pet care decisions create meaningful dungeon outcomes that can be fed back through the existing PetGameEngine for ZK-proven stat updates.

## Dependencies

- **Upstream:** Story 11-15 (Dungeon Engine Core) — `DungeonGameEngine`, `DungeonPetStats`, `DungeonRunResult`, `DungeonStatDelta`, `DEFAULT_MONSTER_TABLE`, `DEFAULT_LOOT_TABLE` all exist in `packages/pet-dvm/src/dungeon/`. DONE.
- **Upstream:** Story 11-4 (Pet Game Engine) — `StatValues`, `PetEngineState`, `PetGameEngine`, `GameAction` all exist in `packages/pet-dvm/src/engine/`. DONE.
- **External:** `@toon-protocol/pet-circuit` — `ActionType`, `ACTION_COUNT`, `applyAction()` available for cross-verify tests.
- **Downstream:** Story 11-17 (Dungeon DVM Handler) — imports `petStatsToDungeonStats`, `applyDungeonDeltaToStats`, `clampStatValues`, `dungeonDeltaToGameAction` from this story.

## Acceptance Criteria

1. **AC-1 — petStatsToDungeonStats function:** `packages/pet-dvm/src/dungeon/statBridge.ts` exports:
   ```typescript
   function petStatsToDungeonStats(petStats: StatValues): DungeonPetStats
   ```
   - Maps each `StatValues` field to the corresponding `DungeonPetStats` field (same field names, both 1–100)
   - Applies modifier scaling per D11-PM-002: pet stats that are above average (>50) give proportional advantage; below average give proportional penalty
   - `energy` maps to `energy` — controls exploration depth (`Math.floor(petStats.energy / 20)` rooms, clamped [1, maxRooms])
   - `happiness` maps to `happiness` — higher happiness = higher loot quality multiplier
   - `hunger` maps to `hunger` — contributes to combat power formula (`hunger * 0.5`) in DungeonGameEngine
   - `health` maps to `health` — directly feeds combat HP and survival threshold
   - `hygiene` maps to `hygiene` — passes through (dungeon crawling degrades hygiene)
   - **Output is a direct pass-through:** `DungeonPetStats` uses the same [1, 100] range as `StatValues`. No scaling needed in MVP — the mapping is 1:1. The DungeonGameEngine already uses `petStats.energy / 20` for depth and `petStats.hunger * 0.5 + petStats.energy * 0.3 + 1` for combat power.

2. **AC-2 — dungeonDeltaToGameAction function:** `packages/pet-dvm/src/dungeon/statBridge.ts` exports:
   ```typescript
   function dungeonDeltaToGameAction(
     result: DungeonRunResult,
     currentStats: StatValues,
     timestamp: number
   ): GameAction
   ```
   - Takes the full `DungeonRunResult` (not just `DungeonStatDelta`) so that encounter win/loss data is available for ActionType resolution
   - Resolves which `ActionType` best represents the dungeon outcome using the following priority order:
     1. Won majority of fights (`result.encounters.filter(e => e.petWon).length > result.encounters.length / 2`) → `ActionType.PLAY` (itemId: 0)
     2. Net positive health change (`result.statDeltas.health > 0`) → `ActionType.MEDICINE` (itemId: 0)
     3. Default (exploration, fled, no encounters, or mixed) → `ActionType.REST` (itemId: 0)
   - Sets `tokenCost: 0` — dungeon effects bypass PET token cost (dungeon already paid via ILP)
   - Returns a `GameAction` struct suitable for downstream consumption
   - **IMPORTANT: Do NOT pass the returned `GameAction` directly to `PetGameEngine.processInteraction()`** — the engine validates `tokenCost` against the ZK circuit's expected cost and will throw `TOKEN_COST_MISMATCH`. This function is a data-assembly helper only. Story 11-17 (DungeonDvmHandler) MUST use `applyDungeonDeltaToStats` directly to apply stat changes; see Dev Notes Option 1 for the recommended composition pattern.

3. **AC-3 — applyDungeonDeltaToStats function:** `packages/pet-dvm/src/dungeon/statBridge.ts` exports:
   ```typescript
   function applyDungeonDeltaToStats(
     currentStats: StatValues,
     delta: DungeonStatDelta
   ): StatValues
   ```
   - Applies `delta` to `currentStats` field by field: `newStat = currentStats[field] + delta[field]`
   - Clamps each result to `[1, 100]` using `Math.max(1, Math.min(100, value))`
   - Returns a new `StatValues` object (does not mutate input)
   - No stat can go below 1 or above 100 — this is the ZK circuit's enforced boundary

4. **AC-4 — clampStatValues helper:** `packages/pet-dvm/src/dungeon/statBridge.ts` exports:
   ```typescript
   function clampStatValues(stats: StatValues): StatValues
   ```
   - Clamps all five fields to `[1, 100]`
   - Used by callers who construct `StatValues` from external data

5. **AC-5 — StatBridgeError type:** `packages/pet-dvm/src/dungeon/statBridge.ts` exports:
   ```typescript
   class StatBridgeError extends Error {
     constructor(message: string, public readonly code: StatBridgeErrorCode)
   }
   type StatBridgeErrorCode = 'INVALID_STATS' | 'INVALID_DELTA' | 'INVALID_TIMESTAMP'
   ```
   - `petStatsToDungeonStats` throws `StatBridgeError('INVALID_STATS')` if any `StatValues` field is outside [1, 100] or not a finite number
   - `dungeonDeltaToGameAction` throws `StatBridgeError('INVALID_TIMESTAMP')` if `timestamp` is not a finite positive number
   - `applyDungeonDeltaToStats` throws `StatBridgeError('INVALID_DELTA')` if any `delta` field is not a finite number
   - `StatBridgeError` must include `this.name = 'StatBridgeError'` and `Object.setPrototypeOf(this, StatBridgeError.prototype)` in the constructor body, matching the project pattern from `DungeonEngineError` and `GameEngineError` to ensure correct `instanceof` checks across module boundaries.

6. **AC-6 — Unit tests — stat mapping (5 tests):**
   - `petStatsToDungeonStats` with maxed stats (all 100) → all dungeon stats = 100
   - `petStatsToDungeonStats` with min stats (all 1) → all dungeon stats = 1
   - `petStatsToDungeonStats` with mixed stats → correct field-by-field pass-through
   - `petStatsToDungeonStats` with invalid stat (101) → throws `StatBridgeError('INVALID_STATS')`
   - `petStatsToDungeonStats` with NaN → throws `StatBridgeError('INVALID_STATS')`

7. **AC-7 — Unit tests — boundary cases (4 tests):**
   - `applyDungeonDeltaToStats` with large negative deltas → all stats clamp to 1
   - `applyDungeonDeltaToStats` with large positive deltas → all stats clamp to 100
   - `applyDungeonDeltaToStats` with zero deltas → stats unchanged
   - `applyDungeonDeltaToStats` with NaN delta → throws `StatBridgeError('INVALID_DELTA')`

8. **AC-8 — Unit tests — stat deltas within [1,100] bounds (3 tests):**
   - Run `DungeonGameEngine.run(seed, petStatsToDungeonStats(statValues))` with typical stats → `applyDungeonDeltaToStats(original, result.statDeltas)` produces all-finite stats in [1,100]
   - Run with minimum stats (all 1) → result stays ≥ 1 (clamped)
   - Run with maximum stats (all 100) → result stays ≤ 100 (clamped)

9. **AC-9 — Cross-verify tests (7 tests):**
   - `dungeonDeltaToGameAction` with `DungeonRunResult` where wins > losses → returns `ActionType.PLAY`
   - `dungeonDeltaToGameAction` with `DungeonRunResult` where wins ≤ losses AND positive health delta → returns `ActionType.MEDICINE`
   - `dungeonDeltaToGameAction` with `DungeonRunResult` with no encounters and zero health delta → returns `ActionType.REST`
   - `dungeonDeltaToGameAction` with invalid timestamp (NaN) → throws `StatBridgeError('INVALID_TIMESTAMP')`
   - `dungeonDeltaToGameAction` with invalid timestamp (negative) → throws `StatBridgeError('INVALID_TIMESTAMP')`
   - `dungeonDeltaToGameAction` with invalid timestamp (zero) → throws `StatBridgeError('INVALID_TIMESTAMP')`
   - `dungeonDeltaToGameAction` with tied encounter count (equal wins and losses, positive health delta) → returns `ActionType.MEDICINE`

10. **AC-10 — Package exports:** The following public symbols from `statBridge.ts` must be exported from `packages/pet-dvm/src/index.ts`:
    - Functions: `petStatsToDungeonStats`, `applyDungeonDeltaToStats`, `clampStatValues`, `dungeonDeltaToGameAction`
    - Types/classes: `StatBridgeError`, `StatBridgeErrorCode`

11. **AC-11 — Build verification:** `pnpm --filter @toon-protocol/pet-dvm build` compiles with zero TypeScript errors.

12. **AC-12 — Test verification:** `pnpm --filter @toon-protocol/pet-dvm test` runs all tests (engine + dungeon + bridge) with all passing. New bridge tests (25 total: AC-4 through AC-9 + supplemental) supplement the existing passing tests from Stories 11-4 and 11-15. The exact pre-story baseline count may differ from 244 — verify by running the suite before starting implementation and recording the count in the Dev Agent Record.

## Tasks / Subtasks

- [x] Task 1: Create statBridge.ts (AC: 1, 2, 3, 4, 5)
  - [x] 1.1 Create `packages/pet-dvm/src/dungeon/statBridge.ts`
  - [x] 1.2 Implement `StatBridgeError` + `StatBridgeErrorCode`
  - [x] 1.3 Implement `petStatsToDungeonStats(petStats: StatValues): DungeonPetStats` with validation
  - [x] 1.4 Implement `applyDungeonDeltaToStats(currentStats: StatValues, delta: DungeonStatDelta): StatValues` with clamp
  - [x] 1.5 Implement `clampStatValues(stats: StatValues): StatValues`
  - [x] 1.6 Implement `dungeonDeltaToGameAction(result: DungeonRunResult, currentStats: StatValues, timestamp: number): GameAction`

- [x] Task 2: Write tests (AC: 6, 7, 8, 9)
  - [x] 2.1 Create `packages/pet-dvm/src/dungeon/statBridge.test.ts`
  - [x] 2.2 Implement 5 stat mapping tests (AC-6)
  - [x] 2.3 Implement 4 boundary case tests (AC-7)
  - [x] 2.4 Implement 3 stat delta within-bounds tests with real DungeonGameEngine (AC-8)
  - [x] 2.5 Implement 4 cross-verify tests for dungeonDeltaToGameAction (AC-9)

- [x] Task 3: Update package exports (AC: 10)
  - [x] 3.1 Add stat bridge exports to `packages/pet-dvm/src/index.ts`

- [x] Task 4: Build and test verification (AC: 11, 12)
  - [x] 4.1 `pnpm --filter @toon-protocol/pet-dvm build` — must pass
  - [x] 4.2 `pnpm --filter @toon-protocol/pet-dvm test` — must pass

## Dev Notes

### Architecture & Design Philosophy

Story 11-16 adds `packages/pet-dvm/src/dungeon/statBridge.ts` alongside the existing `DungeonGameEngine.ts` and `types.ts`. The bridge is a **pure function module** — no classes, no state, no imports except types and constants.

Per D11-PM-002 and Section 14.3 of `pet-zkapp-integration-architecture.md`, the conceptual dungeon roles map to `StatValues` fields as follows:
- `hunger` → combat power contribution AND survival threshold (D11-PM-002 uses "discipline" as a conceptual label for this stat; there is no `discipline` field — `hunger` is the ZK circuit field that fulfils this role: `hunger * 0.5` in the combat power formula)
- `energy` → exploration range (max rooms: `Math.floor(energy / 20)`)
- `happiness` → luck / loot quality multiplier
- `health` → combat HP directly
- `hygiene` → passes through (dungeon crawling degrades hygiene)

**The mapping is 1:1 for MVP.** Both `StatValues` and `DungeonPetStats` use the exact same five fields (`hunger`, `happiness`, `health`, `hygiene`, `energy`) all in [1, 100]. The `petStatsToDungeonStats` function is essentially a validated pass-through that:
1. Validates all input fields are finite numbers in [1, 100]
2. Returns a new `DungeonPetStats` object with identical field values

This simple design is intentional — it creates the clean interface that Story 11-17 depends on, and the DungeonGameEngine already implements the stat-to-modifier formulas internally.

### StatValues vs DungeonPetStats — Why Both Types Exist

`StatValues` is owned by `@toon-protocol/pet-circuit` (the ZK circuit). It represents the canonical, ZK-proven pet state.

`DungeonPetStats` is owned by `packages/pet-dvm/src/dungeon/types.ts`. It is a dungeon-local view of pet stats, decoupled from the circuit types to allow future divergence (e.g., dungeon might add `discipline` or `luck` fields later without touching the ZK circuit).

The bridge is the seam between these two domains.

### dungeonDeltaToGameAction — Composition Pattern

`dungeonDeltaToGameAction` assembles a `GameAction` struct that conveys the semantic intent of a dungeon run (PLAY/MEDICINE/REST). **It MUST NOT be passed directly to `PetGameEngine.processInteraction()`** without care. Note: `tokenCost: 0` with `itemId: 0` is valid for ALL base action types (REST, PLAY, MEDICINE) — `getRequiredTokenCost` returns 0 for any `itemId === 0` regardless of action type, so `TOKEN_COST_MISMATCH` will NOT be thrown. The real risks are: (1) **cooldown validation** — dungeon runs don't count as interactions, so the engine may reject due to active cooldown timers, and (2) **action-allowed-for-stage checks** — not all ActionTypes are valid at every stage. Story 11-17 must account for both. The recommended approach (Option 1 below) bypasses `processInteraction` entirely to avoid these checks.

**Recommended pattern for Story 11-17 (Option 1 — preferred for MVP):**

```typescript
// Bypass PetGameEngine entirely for stat mutation; use applyDungeonDeltaToStats directly
const updatedStats = applyDungeonDeltaToStats(currentState.stats, result.statDeltas);
const newState: PetEngineState = {
  ...currentState,
  stats: updatedStats,
  // Do NOT increment cycle here — cycle increments are managed by PetGameEngine.processInteraction().
  // For dungeon runs, leave cycle unchanged unless your ZK proof pattern requires it.
  // Consult PetGameEngine source (packages/pet-dvm/src/engine/PetGameEngine.ts) for the
  // authoritative cycle-increment logic before constructing newState manually.
  lastInteraction: timestamp,
};
// Then generate ZK proof of the state transition (same as PetDvmHandler pattern)
```

Option 1 is preferred for MVP because it cleanly separates dungeon stat application from the ZK proof generation pattern without fighting cooldown/stage validation.

This story DOES NOT solve Q9 from `pet-zkapp-integration-architecture.md` (dungeon-effect action type). Story 11-17 is responsible for choosing how to feed deltas back through PetGameEngine. This story only provides the mapping primitives.

### TypeScript Strict Mode Notes

`packages/pet-dvm` uses `strict: true` + `noUncheckedIndexedAccess: true` + `noPropertyAccessFromIndexSignature: true`. Key implications for statBridge.ts:

```typescript
// Importing StatValues from engine/types (NOT from @toon-protocol/pet-circuit)
import type { StatValues, GameAction } from '../engine/types';
// Importing dungeon types — DungeonRunResult needed for dungeonDeltaToGameAction signature
import type { DungeonPetStats, DungeonStatDelta, DungeonRunResult } from './types';
// Importing ActionType from @toon-protocol/pet-circuit
import { ActionType } from '@toon-protocol/pet-circuit';
```

The `StatValues` type is re-exported from `packages/pet-dvm/src/engine/types.ts` — use that import, not the one from `@toon-protocol/pet-circuit`, to avoid circular dependency confusion.

### File Structure

```
packages/pet-dvm/src/
├── engine/         ← existing (PetGameEngine, StatValues)
├── dungeon/        ← Story 11-15 (DungeonGameEngine, types)
│   ├── DungeonGameEngine.ts
│   ├── DungeonGameEngine.test.ts
│   ├── types.ts
│   ├── statBridge.ts       ← NEW (Story 11-16)
│   └── statBridge.test.ts  ← NEW (Story 11-16)
├── handler/        ← existing
├── checkpoint/     ← existing
├── pricing/        ← existing
└── index.ts        ← add bridge exports here
```

### Testing Pattern

`packages/pet-dvm` uses **Jest** (not Vitest) with `ts-jest`. Tests follow the `describe`/`it`/`expect` pattern.

For AC-8 cross-engine tests, import `DungeonGameEngine`, `DEFAULT_MONSTER_TABLE`, `DEFAULT_LOOT_TABLE` from `../DungeonGameEngine` and construct the engine directly in the test. Do NOT mock — these tests must use the real engine to verify the full integration. Use fixed seeds so assertions are deterministic:

```typescript
import { DungeonGameEngine, DEFAULT_MONSTER_TABLE, DEFAULT_LOOT_TABLE } from '../DungeonGameEngine';
import { petStatsToDungeonStats, applyDungeonDeltaToStats, dungeonDeltaToGameAction } from './statBridge';
import type { StatValues } from '../../engine/types';

const engine = new DungeonGameEngine({
  width: 40, height: 30, maxRooms: 8,
  dungeonType: 'digger',
  monsterTable: DEFAULT_MONSTER_TABLE,
  lootTable: DEFAULT_LOOT_TABLE,
});

// AC-8 test: typical stats — result stays in [1, 100]
const petStats: StatValues = { hunger: 60, happiness: 70, health: 80, hygiene: 50, energy: 90 };
const dungeonStats = petStatsToDungeonStats(petStats);
const result = engine.run('test-seed-bridge', dungeonStats);  // fixed seed = deterministic
const afterStats = applyDungeonDeltaToStats(petStats, result.statDeltas);
// Assert all afterStats fields are in [1, 100]
expect(afterStats.hunger).toBeGreaterThanOrEqual(1);
expect(afterStats.hunger).toBeLessThanOrEqual(100);
// ... repeat for all five fields

// AC-9 test: dungeonDeltaToGameAction takes full DungeonRunResult, not just delta
const action = dungeonDeltaToGameAction(result, petStats, Date.now());
// Assert action.actionType is one of ActionType.PLAY / MEDICINE / REST
```

Note on AC-9 cross-verify tests: construct `DungeonRunResult` stubs with controlled `encounters` and `statDeltas` to exercise each ActionType branch deterministically. Do not rely on the live engine output for AC-9 — use hand-crafted result fixtures.

### Quality Gate G18

Per `test-design-epic-11.md` quality gate G18: "Pet stat deltas from dungeon accepted by PetGameEngine". The `applyDungeonDeltaToStats` function is what ensures this gate passes — by clamping all deltas to [1, 100], the resulting `StatValues` is always valid input for the PetGameEngine or ZK circuit.

**G18 is a blocking gate.** AC-8 tests verify the bounds constraint (output stays in [1,100]) using the real `DungeonGameEngine`. Full G18 gate validation (stat deltas feed through PetGameEngine without error) is verified in Story 11-17 integration tests, not in this story. This story's responsibility is to guarantee that `applyDungeonDeltaToStats` always produces `StatValues` with all fields in [1, 100] — a precondition for G18 passing downstream.

### Project Structure Notes

- Alignment with unified project structure: `dungeon/` sub-module pattern established by Story 11-15
- No new npm packages needed — all imports are within `packages/pet-dvm` or already-present workspace dependencies
- `@toon-protocol/pet-circuit` is already a dependency of `packages/pet-dvm` (used by PetGameEngine)

### References

- [Source: _bmad-output/planning-artifacts/research/party-mode-dungeon-engine-decisions-2026-04-08.md#Decisions] — D11-PM-002: stat-to-dungeon-modifier mapping
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#14.3] — Data flow: "Pet-Dungeon Bridge: map pet stats → dungeon modifiers" + Step 4 stat feedback pattern
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#Story-11-16] — Test strategy: 5 mapping + 4 boundary + 3 delta-bounds + 4 cross-verify; Quality gate G18
- [Source: _bmad-output/project-context.md#351] — "Pet-Dungeon Stat Bridge (D11-PM-002): Pet stats map to dungeon modifiers"
- [Source: packages/pet-dvm/src/dungeon/types.ts] — `DungeonPetStats`, `DungeonStatDelta` definitions
- [Source: packages/pet-dvm/src/engine/types.ts] — `StatValues`, `GameAction` definitions
- [Source: packages/pet-circuit/src/constants.ts] — `ActionType` enum (FEED=0, PLAY=1, CLEAN=2, REST=3, MEDICINE=8)
- [Source: packages/pet-dvm/src/dungeon/DungeonGameEngine.ts] — combat formula: `petStats.hunger * 0.5 + petStats.energy * 0.3 + 1`; depth formula: `Math.floor(petStats.energy / 20)`
- [Source: packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts] — test pattern to follow (Jest, ts-jest, describe/it/expect)
- [Source: _bmad-output/implementation-artifacts/11-15-dungeon-engine-core.md#Completion-Notes] — rot-js ships own .d.ts; ROTMap.Rogue needs empty options `{}`; Cellular has no getRooms()

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation proceeded without blockers.

### Completion Notes List

- **Task 1 (statBridge.ts):** Created `packages/pet-dvm/src/dungeon/statBridge.ts` as a pure function module. Implemented `StatBridgeError` (with `StatBridgeErrorCode` union type) following the same `instanceof`-safe pattern as `DungeonEngineError` and `GameEngineError`. Implemented all four public functions: `petStatsToDungeonStats` (validated 1:1 pass-through, throws `INVALID_STATS`), `applyDungeonDeltaToStats` (validates currentStats + delta, field-by-field add + clamp to [1,100], throws `INVALID_STATS`/`INVALID_DELTA`), `clampStatValues` (clamp helper, NaN→1, no throw), `dungeonDeltaToGameAction` (ActionType resolution by priority: PLAY → MEDICINE → REST, throws `INVALID_TIMESTAMP`; returns `isSleeping: false`; `actionType` typed as `typeof ActionType[keyof typeof ActionType]`). `_currentStats` is part of the public API signature for Story 11-17 compatibility; unused in MVP resolution logic.
- **Task 2 (tests):** Activated all bridge tests in `statBridge.test.ts`. Tests cover AC-4 (3 clampStatValues), AC-6 (5 stat mapping), AC-7 (5 boundary cases including Infinity delta), AC-8 (3 real-engine bounds verification with fixed seeds), AC-9 (7 ActionType cross-verify including zero/negative timestamps and tie case), supplemental tests (2 immutability + StatBridgeError.name), and review-pass-3 additions (2: clampStatValues NaN behavior, applyDungeonDeltaToStats NaN currentStats). Total 27 new bridge tests. Baseline was 244 passing; final count is 271 passing.
- **Task 3 (exports):** Added `petStatsToDungeonStats`, `applyDungeonDeltaToStats`, `clampStatValues`, `dungeonDeltaToGameAction`, `StatBridgeError` (value), and `StatBridgeErrorCode` (type) to `packages/pet-dvm/src/index.ts` under a new `// Dungeon Stat Bridge` section.
- **Task 4 (build + test):** `pnpm --filter @toon-protocol/pet-dvm build` — zero TypeScript errors. `pnpm --filter @toon-protocol/pet-dvm test` — 271/271 passing, 13 suites, no regressions.

### File List

- `packages/pet-dvm/src/dungeon/statBridge.ts` — CREATED (review pass 3: NaN guard in `clampToRange`; `applyDungeonDeltaToStats` now validates `currentStats`; `actionType` typed as enum value type; `isSleeping: false` added to returned GameAction; updated `clampStatValues` JSDoc)
- `packages/pet-dvm/src/dungeon/statBridge.test.ts` — MODIFIED (27 bridge tests; review pass 3 adds 2 tests: clampStatValues NaN→1, applyDungeonDeltaToStats NaN currentStats throws INVALID_STATS; header comment counts corrected)
- `packages/pet-dvm/src/index.ts` — MODIFIED (added Dungeon Stat Bridge exports)
- `packages/pet-circuit/src/PetBreeding.test.ts` — MODIFIED (converted `PetLifecycleProof`/`PetState` to type-only imports; renamed unused `slotTime` → `_slotTime` to fix lint warnings)

### Change Log

- **2026-04-09** — Story 11-16 implementation complete. Created `statBridge.ts` pure function module with four exported functions and `StatBridgeError` type. Activated 22 bridge tests covering AC-4/6/7/8/9 plus immutability/error-name supplementals. Added all public symbols to package index. Also updated `packages/pet-circuit/src/PetBreeding.test.ts` to use type-only imports and fix unused variable lint warning. Build and full test suite pass (269 tests, 0 regressions).
- **2026-04-09** — Code review fixes applied. Corrected test count in Completion Notes (16→22 new tests, 260→266 total). Added `PetBreeding.test.ts` to File List (was missing). Fixed misleading Dev Notes warning about `TOKEN_COST_MISMATCH` (all base `itemId:0` actions cost 0 — real risk is cooldown/stage validation). Renamed `currentStats` → `_currentStats` in `dungeonDeltaToGameAction` signature (proper unused-param convention, eliminates `void` suppression). Updated stale TDD red-phase header comment in test file.
- **2026-04-09** — Review Pass #2 fixes applied. Removed residual stale TDD red-phase inline comment (line 26 of statBridge.test.ts). Added NaN-passthrough caveat to `clampStatValues` JSDoc. Added 3 missing edge-case tests: `timestamp === 0` for INVALID_TIMESTAMP, tied encounter count falls to MEDICINE branch, `Infinity` delta throws INVALID_DELTA. Updated AC-9 count (4→7 tests) and AC-12 bridge test count (16→25) to match implementation. Total test count: 269 passing.
- **2026-04-09** — Review Pass #3 fixes applied. Fixed `clampToRange` to treat NaN as 1 (was silently passing NaN through despite JSDoc claiming Infinity/-Infinity were handled). Added `validateStatValues(currentStats)` call to `applyDungeonDeltaToStats` (was only validating delta, not the base stats). Strengthened `actionType` type from `number` to `typeof ActionType[keyof typeof ActionType]`. Added explicit `isSleeping: false` to returned `GameAction` object. Added 2 new regression tests: clampStatValues NaN→1 and applyDungeonDeltaToStats NaN currentStats throws INVALID_STATS. Total test count: 271 passing.

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-09
- **Reviewer Model:** claude-sonnet-4-6
- **Issues Found:**
  - Critical: 0
  - High: 2
  - Medium: 3
  - Low: 3
  - **Total: 8**
- **Issues Fixed:** 8 / 8
- **Outcome:** All issues resolved.

### Review Pass #2

- **Date:** 2026-04-09
- **Reviewer Model:** claude-sonnet-4-6
- **Issues Found:**
  - Critical: 0
  - High: 1
  - Medium: 3
  - Low: 4
  - **Total: 8**
- **Issues Fixed:** 8 / 8
- **Outcome:** All issues resolved.

### Review Pass #3

- **Date:** 2026-04-09
- **Reviewer Model:** claude-sonnet-4-6
- **Security Tools:** Semgrep MCP (no AppSec token — OWASP/injection rules applied via manual adversarial analysis; pure function module, no I/O, no injection surfaces identified)
- **Issues Found:**
  - Critical: 0
  - High: 1
  - Medium: 3
  - Low: 4
  - **Total: 8**
- **Issues Fixed:** 8 / 8
- **Outcome:** All issues resolved. Story approved — no follow-up review required.
