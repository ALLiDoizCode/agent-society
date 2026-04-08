---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-07'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-4-pet-game-engine.md'
  - 'packages/pet-circuit/src/constants.ts'
  - 'packages/pet-circuit/src/utils.ts'
  - 'packages/pet-circuit/src/index.ts'
  - 'packages/pet-circuit/test-vectors/golden-vectors.json'
---

# ATDD Checklist - Epic 11, Story 11-4: Pet Game Engine

**Date:** 2026-04-07
**Author:** Jonathan
**Primary Test Level:** Unit / Integration (backend — Jest)

---

## Story Summary

Create a TypeScript Pet Game Engine (`@toon-protocol/pet-dvm` package) that replicates the exact same game rules as the PetLifecycle ZkProgram -- applying decay, action effects, cooldown enforcement, evolution checks, and stat clamping using plain TypeScript arithmetic, so that the Pet DVM can process interactions instantly and produce state guaranteed to match what the circuit will later prove.

**As a** TOON Protocol developer
**I want** a PetGameEngine class that mirrors the ZkProgram game rules in plain TypeScript
**So that** the Pet DVM can process interactions without ZK proof generation while guaranteeing circuit-compatible output

---

## Acceptance Criteria

1. **AC-1** -- PetGameEngine class with constructor, processInteraction, checkEvolution, getState, applyDecayOnly
2. **AC-2** -- processInteraction validates, decays, applies action, updates cooldowns, returns InteractionResult
3. **AC-3** -- checkEvolution checks thresholds, returns EvolutionResult or null
4. **AC-4** -- evolve() applies stage transitions with correct stat resets, does NOT increment cycle
5. **AC-5** -- Type definitions: PetEngineState, StatValues, GameAction, InteractionResult, EvolutionResult, DecayResult, GameEngineError
6. **AC-6** -- Golden vector cross-verification: all 26 vectors produce identical output to circuit (P0 BLOCKER)
7. **AC-7** -- Unit tests: cooldowns (33 combos), evolution thresholds, error handling, sequential interactions, clamping, shop items, sleeping, token cost, factory validation
8. **AC-8** -- Package setup: package.json, tsconfig.json, jest.config.js, directory structure
9. **AC-9** -- Factory functions: createPetGameEngine (validates), createGenesisState (default state)

---

## Failing Tests Created (RED Phase)

### Unit Tests (90 tests)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts` (~720 lines)

#### AC-6: Golden Vector Cross-Verification (26 tests) -- P0 BLOCKER

- **Test:** `vector 1-26: [description]` (parameterized via `it.each`)
  - **Status:** RED -- processInteraction throws "Not implemented"
  - **Verifies:** Post-decay and post-action stats match golden vectors exactly

#### AC-7: Cooldown Enforcement (33 tests)

- **Test:** `stage=[egg|baby|adult] action [0-10] is [blocked|allowed]`
  - **Status:** RED -- processInteraction throws "Not implemented"
  - **Verifies:** INVALID_ACTION thrown for stage-blocked actions; allowed actions succeed

#### AC-7: Evolution Threshold (6 tests)

- **Test:** `returns EvolutionResult when egg meets hatch thresholds`
  - **Status:** RED -- checkEvolution throws "Not implemented"
  - **Verifies:** Egg->baby eligibility at cycle>=7, health/hygiene/happiness>=70
- **Test:** `returns null when egg does not meet hatch thresholds (cycle too low)`
  - **Status:** RED -- checkEvolution throws "Not implemented"
- **Test:** `returns null when egg does not meet hatch thresholds (stats too low)`
  - **Status:** RED -- checkEvolution throws "Not implemented"
- **Test:** `returns EvolutionResult when baby meets evolve thresholds`
  - **Status:** RED -- checkEvolution throws "Not implemented"
- **Test:** `returns null when baby does not meet evolve thresholds (cycle too low)`
  - **Status:** RED -- checkEvolution throws "Not implemented"
- **Test:** `returns null when baby does not meet evolve thresholds (one stat too low)`
  - **Status:** RED -- checkEvolution throws "Not implemented"

#### AC-7: evolve() Stat Resets (4 tests)

- **Test:** `egg->baby: resets stats to 100, inherits health`
  - **Status:** RED -- evolve throws "Not implemented"
- **Test:** `baby->adult: all stats inherited, stage=2`
  - **Status:** RED -- evolve throws "Not implemented"
- **Test:** `evolve() does NOT increment cycle`
  - **Status:** RED -- evolve throws "Not implemented"
- **Test:** `evolve() throws EVOLUTION_NOT_READY if not eligible`
  - **Status:** RED -- evolve throws generic Error (not GameEngineError)

#### AC-7: Error Handling (4 tests)

- **Test:** `throws TIMESTAMP_REGRESSION if action.timestamp <= lastInteraction`
  - **Status:** RED -- processInteraction throws generic Error
- **Test:** `throws INVALID_ACTION for stage-blocked action`
  - **Status:** RED -- processInteraction throws generic Error
- **Test:** `throws COOLDOWN_ACTIVE if cooldown not elapsed`
  - **Status:** RED -- processInteraction throws generic Error
- **Test:** `throws TOKEN_COST_MISMATCH if action.tokenCost != expected`
  - **Status:** RED -- processInteraction throws generic Error

#### AC-7: Sequential Interactions (1 test)

- **Test:** `5 sequential interactions update state correctly`
  - **Status:** RED -- processInteraction throws "Not implemented"

#### AC-7: Stat Clamping (2 tests)

- **Test:** `stat at 1 with negative effect stays at 1 (floor)`
  - **Status:** RED -- processInteraction throws "Not implemented"
- **Test:** `stat at 100 with positive effect stays at 100 (ceiling)`
  - **Status:** RED -- processInteraction throws "Not implemented"

#### AC-7: Shop Item Effects (2 tests)

- **Test:** `food_burger (itemId=2, cost=25)`
  - **Status:** RED -- processInteraction throws "Not implemented"
- **Test:** `med_elixir (itemId=12, cost=150)`
  - **Status:** RED -- processInteraction throws "Not implemented"

#### AC-7: Sleeping Energy Recovery (1 test)

- **Test:** `isSleeping=true uses positive energy rate during decay`
  - **Status:** RED -- processInteraction throws "Not implemented"

#### AC-9: Factory Function (4 tests)

- **Test:** `creates engine with valid initial state`
  - **Status:** RED -- createPetGameEngine throws "Not implemented"
- **Test:** `rejects invalid stage (stage > 2) with INVALID_STAGE`
  - **Status:** GREEN (stub throws GameEngineError) -- will need re-validation after implementation
- **Test:** `rejects stats out of [1, 100] range`
  - **Status:** GREEN (stub throws) -- will need re-validation after implementation
- **Test:** `rejects stats above 100`
  - **Status:** GREEN (stub throws) -- will need re-validation after implementation

#### AC-9: createGenesisState (1 test)

- **Test:** `returns default genesis state`
  - **Status:** RED -- createGenesisState throws "Not implemented"

#### AC-1: Class Interface (5 tests)

- **Test:** `exposes getState() returning readonly copy`
  - **Status:** GREEN (method exists on stub)
- **Test:** `exposes processInteraction/checkEvolution/evolve/applyDecayOnly methods`
  - **Status:** GREEN (methods exist on stub, 4 tests)

#### AC-2: applyDecayOnly (1 test)

- **Test:** `returns decayed stats and elapsed seconds without mutating state`
  - **Status:** RED -- applyDecayOnly throws "Not implemented"

---

## Data Factories Created

### PetEngineState Factory

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts` (inline helpers)

**Exports (test-local):**

- `makeState(overrides?)` -- Create PetEngineState with default baby-stage values + optional overrides
- `makeAction(overrides?)` -- Create GameAction with default feed action + optional overrides

---

## Fixtures Created

N/A -- Pure unit tests with no external dependencies. Test data constructed via inline factory helpers.

---

## Mock Requirements

N/A -- The PetGameEngine is a pure computation class with no external service dependencies. It imports only constants and utility functions from `@toon-protocol/pet-circuit`.

---

## Required data-testid Attributes

N/A -- Backend-only package, no UI components.

---

## Implementation Checklist

### Test: Golden Vector Cross-Verification (26 vectors)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `processInteraction()` in PetGameEngine.ts
- [ ] Call `isActionAllowed()` from pet-circuit for stage validation
- [ ] Call `checkCooldown()` from pet-circuit for cooldown validation
- [ ] Call `computeDecay()` from pet-circuit for decay computation
- [ ] Call `applyAction()` from pet-circuit for action effects
- [ ] Call `getRequiredTokenCost()` for token cost validation
- [ ] Update internal state (cycle, lastInteraction, cooldownTimestamps)
- [ ] Return InteractionResult with priorStats, decayedStats, finalStats
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="Golden Vector"`
- [ ] All 26 vectors pass (green phase)

**Estimated Effort:** 2 hours

---

### Test: Cooldown Enforcement (33 combinations)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Implement INVALID_ACTION error path (isActionAllowed check)
- [ ] Implement COOLDOWN_ACTIVE error path (checkCooldown check, wrap in GameEngineError)
- [ ] Implement TIMESTAMP_REGRESSION check (action.timestamp <= lastInteraction)
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="Cooldown enforcement"`
- [ ] All 33 combinations pass (green phase)

**Estimated Effort:** 1 hour (mostly covered by processInteraction implementation)

---

### Test: Evolution Thresholds (6 tests)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `checkEvolution()` using EVOLUTION_THRESHOLDS from pet-circuit
- [ ] Check egg->baby: cycle >= 7 AND health >= 70 AND hygiene >= 70 AND happiness >= 70
- [ ] Check baby->adult: cycle >= 21 AND all stats >= 80
- [ ] Return EvolutionResult or null
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="Evolution check"`
- [ ] All 6 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: evolve() Stat Resets (4 tests)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `evolve()` -- call checkEvolution(), throw EVOLUTION_NOT_READY if null
- [ ] Egg->baby: set hunger/happiness/hygiene/energy=100, inherit health, stage=1
- [ ] Baby->adult: inherit all stats, stage=2
- [ ] Do NOT increment cycle
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="evolve"`
- [ ] All 4 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: Error Handling (4 tests)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Throw GameEngineError('TIMESTAMP_REGRESSION') when timestamp <= lastInteraction
- [ ] Throw GameEngineError('INVALID_ACTION') when !isActionAllowed
- [ ] Catch pet-circuit checkCooldown Error, re-throw as GameEngineError('COOLDOWN_ACTIVE')
- [ ] Throw GameEngineError('TOKEN_COST_MISMATCH') when tokenCost != getRequiredTokenCost
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="Error handling"`
- [ ] All 4 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: Sequential Interactions (1 test)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Ensure processInteraction correctly updates cycle, lastInteraction, cooldownTimestamps
- [ ] Ensure subsequent calls use updated state
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="Sequential"`
- [ ] Test passes (green phase)

**Estimated Effort:** 0 hours (covered by processInteraction implementation)

---

### Test: Stat Clamping + Shop Items + Sleeping + Token Cost + Factory (10 tests)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Ensure processInteraction clamps stats to [1, 100] via Math.max(1, Math.min(100, v))
- [ ] Ensure shop items use SHOP_ITEMS effects (not BASE_ACTION_EFFECTS) when itemId > 0
- [ ] Ensure isSleeping flag passed through to computeDecay
- [ ] Validate token cost: assert action.tokenCost === getRequiredTokenCost(actionType, itemId)
- [ ] Implement createPetGameEngine factory with validation (stage 0-2, stats 1-100)
- [ ] Implement createGenesisState returning default state
- [ ] Run test: `cd packages/pet-dvm && npx jest`
- [ ] All tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: applyDecayOnly Preview (1 test)

**File:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `applyDecayOnly()` -- compute decay without mutating state
- [ ] Return DecayResult with decayedStats and elapsedSeconds
- [ ] Run test: `cd packages/pet-dvm && npx jest --testNamePattern="applyDecayOnly"`
- [ ] Test passes (green phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all tests for this story
cd packages/pet-dvm && npx jest

# Run specific test suite
cd packages/pet-dvm && npx jest --testNamePattern="Golden Vector"

# Run with verbose output
cd packages/pet-dvm && npx jest --verbose

# Run with coverage
cd packages/pet-dvm && npx jest --coverage

# Run a single test by name
cd packages/pet-dvm && npx jest --testNamePattern="evolve.*stat resets"
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 90 tests written and 82 failing as expected
- 8 pass (method existence + stub rejection) -- will need re-validation post-implementation
- Factory helpers created (makeState, makeAction)
- No mock requirements (pure computation)
- Implementation checklist created

**Verification:**

- All tests run and fail as expected
- Failure messages are clear: "Not implemented -- RED phase stub"
- Tests fail due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Pick one failing test group** from implementation checklist (start with processInteraction)
2. **Read the test** to understand expected behavior
3. **Implement minimal code** to make that specific test pass
4. **Run the test** to verify it now passes (green)
5. **Check off the task** in implementation checklist
6. **Move to next test** and repeat

**Recommended order:**
1. processInteraction (unlocks 26 golden vectors + 33 cooldown + error handling + sequential + clamping + shop + sleeping)
2. checkEvolution (unlocks 6 threshold tests)
3. evolve (unlocks 4 stat reset tests)
4. applyDecayOnly (unlocks 1 preview test)
5. createPetGameEngine factory (unlocks 4 factory tests)
6. createGenesisState (unlocks 1 genesis test)

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

1. Verify all 90 tests pass (green phase complete)
2. Review for DRY -- extract shared validation helpers if needed
3. Run `pnpm lint` -- no lint errors
4. Run `pnpm build` in pet-dvm -- TypeScript compiles cleanly
5. Ensure tests still pass after each refactor

---

## Next Steps

1. **Review this checklist** with the implementation plan
2. **Run failing tests** to confirm RED phase: `cd packages/pet-dvm && npx jest`
3. **Begin implementation** using implementation checklist as guide
4. **Work one test group at a time** (red -> green for each)
5. **When all tests pass**, refactor code for quality
6. **When refactoring complete**, update story status to 'done'

---

## Knowledge Base References Applied

- **data-factories.md** -- Factory patterns for test data (adapted to inline makeState/makeAction helpers since no faker needed for deterministic game state)
- **test-quality.md** -- Test design principles: Given-When-Then, deterministic inputs, isolation between tests
- **test-levels-framework.md** -- Test level selection: unit tests for pure computation, integration via golden vector cross-verification

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/pet-dvm && npx jest --no-cache`

**Results:**

```
FAIL pet-dvm src/engine/PetGameEngine.test.ts
  AC-6: Golden Vector Cross-Verification ........... 26 FAIL
  AC-7: Cooldown enforcement per stage ............. 33 FAIL
  AC-7: Evolution check — egg->baby ................ 3 FAIL
  AC-7: Evolution check — baby->adult .............. 3 FAIL
  AC-7: evolve() stat resets ....................... 4 FAIL (3 not-impl + 1 wrong error type)
  AC-7: Error handling ............................. 4 FAIL
  AC-7: Sequential interactions .................... 1 FAIL
  AC-7: Stat clamping boundaries ................... 2 FAIL
  AC-7: Shop item effects .......................... 2 FAIL
  AC-7: Sleeping energy recovery ................... 1 FAIL
  AC-9: Factory function — createPetGameEngine ..... 1 FAIL, 3 PASS (stub throws)
  AC-9: createGenesisState ......................... 1 FAIL
  AC-1: PetGameEngine class interface .............. 5 PASS (methods exist)
  AC-2: applyDecayOnly preview ..................... 1 FAIL

Test Suites: 1 failed, 1 total
Tests:       82 failed, 8 passed, 90 total
```

**Summary:**

- Total tests: 90
- Passing: 8 (method existence + stub rejection -- expected)
- Failing: 82 (expected -- all functional tests)
- Status: RED phase verified

**Expected Failure Messages:**
- All functional tests fail with: `Not implemented — RED phase stub`
- This is correct: stubs throw Error, implementation does not exist yet

---

## Notes

- **P0 BLOCKER:** Golden vector cross-verification (AC-6) is the critical consistency gate. All 26 vectors must produce exact output match.
- **Import pattern:** Game engine imports `computeDecay`, `applyAction`, `checkCooldown`, `isActionAllowed`, `getRequiredTokenCost` from `@toon-protocol/pet-circuit`. Do NOT duplicate these functions.
- **Stat clamping:** Use `Math.max(1, Math.min(100, v))` -- do NOT import `clampStat` from pet-circuit (it uses o1js UInt32 types).
- **Error wrapping:** pet-circuit throws plain `Error`; game engine must catch and re-throw as `GameEngineError` with typed code.
- **Evolution does NOT increment cycle** -- confirmed in Story 11-3 debug learnings.
- **8 passing tests** are expected in RED phase: 5 method-existence checks + 3 factory rejection tests (stub throws GameEngineError which happens to match). These must be re-verified after implementation to ensure they pass for the RIGHT reason.

---

**Generated by BMad TEA Agent** - 2026-04-07
