# Traceability Matrix: Story 11-4 (Pet Game Engine)

Generated: 2026-04-07
Test file: `packages/pet-dvm/src/engine/PetGameEngine.test.ts`

## AC-to-Test Mapping

| AC | Description | Test(s) | Status |
|----|-------------|---------|--------|
| **AC-1** | PetGameEngine class structure | `AC-1: PetGameEngine class interface` — `exposes getState() returning readonly copy`, `exposes processInteraction method`, `exposes checkEvolution method`, `exposes evolve method`, `exposes applyDecayOnly method` | Covered |
| **AC-2** | processInteraction method | `AC-7: Error handling` — `throws TIMESTAMP_REGRESSION`, `throws INVALID_ACTION`, `throws COOLDOWN_ACTIVE`, `throws TOKEN_COST_MISMATCH`; `AC-7: Sequential interactions` — `5 sequential interactions update state correctly`; `AC-2: applyDecayOnly` — `returns decayed stats without mutating state`, `handles NaN timestamp`, `handles timestamp before lastInteraction`, `isSleeping=true uses positive energy rate`; `AC-2: processInteraction returns correct priorStats` — `priorStats matches engine state before decay`, `priorStats differs from decayedStats when time has elapsed` | Covered |
| **AC-3** | checkEvolution method | `AC-7: Evolution check — egg->baby` — meets thresholds, cycle too low, stats too low; `AC-7: Evolution check — baby->adult` — meets thresholds, cycle too low, one stat too low; `AC-3: checkEvolution resetStats` — egg->baby resetStats, baby->adult resetStats | Covered |
| **AC-4** | evolve method | `AC-7: evolve() stat resets` — egg->baby stat resets, baby->adult stat preservation, evolve does NOT increment cycle, throws EVOLUTION_NOT_READY if not eligible; `AC-4: Adult evolution attempt` — adult evolve() throws EVOLUTION_NOT_READY | Covered |
| **AC-5** | Type definitions | Compile-time verification via imports at top of test file (`PetEngineState`, `GameAction`, `StatValues`, `GameEngineError` all imported and used throughout) | Covered (compile-time) |
| **AC-6** | Golden vector cross-verification | `AC-6: Golden Vector Cross-Verification` — parametric `it.each` over all 26 vectors; asserts exact match on `decayedStats` and `finalStats` | Covered |
| **AC-7** | Unit tests | See detailed sub-mapping below | Covered |
| **AC-8** | Package setup | Verified implicitly: test file compiles, imports resolve from `@toon-protocol/pet-circuit`, jest runs | Covered (implicit) |
| **AC-9** | Factory function | `AC-9: Factory function — createPetGameEngine` — valid state, invalid stage, stats out of range, stats above 100; `AC-9: createGenesisState` — returns default genesis state; `NFR: Input validation edge cases` — NaN stats, wrong-length cooldowns, NaN/negative cycle, negative stage, NaN/negative cooldown timestamps, NaN/negative lastInteraction, invalid brainHash length, non-hex brainHash | Covered |

## AC-7 Unit Test Sub-Mapping

AC-7 specifies 14 individual test categories. Coverage:

| AC-7 Requirement | Test(s) | Status |
|-------------------|---------|--------|
| 33 cooldown combinations (3 stages x 11 actions) | `AC-7: Cooldown enforcement per stage` — parametric loop over all stages and action types, verifying INVALID_ACTION for blocked or successful execution for allowed | Covered |
| Evolution check egg->baby (meets/doesn't meet) | `AC-7: Evolution check — egg->baby` — 3 tests (meets, cycle too low, stats too low) | Covered |
| Evolution check baby->adult (meets/doesn't meet) | `AC-7: Evolution check — baby->adult` — 3 tests (meets, cycle too low, stat too low) | Covered |
| evolve() stat resets egg->baby | `AC-7: evolve() stat resets` — `egg->baby: resets hunger, happiness, hygiene, energy to 100; inherits health` | Covered |
| evolve() preserves stats baby->adult | `AC-7: evolve() stat resets` — `baby->adult: all stats inherited, stage=2` | Covered |
| Timestamp regression rejected | `AC-7: Error handling` — `throws TIMESTAMP_REGRESSION if action.timestamp <= lastInteraction` (equal and earlier) | Covered |
| Invalid action for stage rejected | `AC-7: Error handling` — `throws INVALID_ACTION for stage-blocked action` | Covered |
| Cooldown not elapsed rejected | `AC-7: Error handling` — `throws COOLDOWN_ACTIVE if cooldown not elapsed` | Covered |
| 5 sequential interactions | `AC-7: Sequential interactions` — `5 sequential interactions update state correctly` | Covered |
| Stat clamping boundaries | `AC-7: Stat clamping boundaries` — floor (energy=1 stays 1) and ceiling (hunger=100 stays 100) | Covered |
| Shop item effects (2+ items) | `AC-7: Shop item effects` — food_burger (itemId=2, cost=25) and med_elixir (itemId=12, cost=150) | Covered |
| Sleeping energy recovery | `AC-7: Sleeping energy recovery` — `isSleeping=true uses positive energy rate during decay` | Covered |
| Token cost mismatch rejected | `AC-7: Error handling` — `throws TOKEN_COST_MISMATCH if action.tokenCost != expected` | Covered |
| Factory rejects invalid state | `AC-9: Factory function` and `NFR: Input validation edge cases` — stage > 2, stats out of [1,100], NaN stats, wrong-length cooldowns, negative cycle, invalid brainHash | Covered |

## Uncovered ACs

**None.** All 9 acceptance criteria (AC-1 through AC-9) have test coverage.

## Summary

- **Total ACs:** 9
- **Covered:** 9
- **Uncovered:** 0
- **Total test count:** ~90 (26 golden vectors + 33 cooldown combos + ~31 individual unit/integration tests)
- **Quality gate:** PASS
