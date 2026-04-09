# ATDD Checklist — Story 11-13: Breeding Circuit

**Story:** 11-13 Breeding Circuit
**Date:** 2026-04-09
**Status:** ready-for-dev

---

## Acceptance Test Matrix

### AC-1: BreedingState struct

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-01 | `BreedingState` is exported from `@toon-protocol/pet-circuit` | Unit | Import succeeds, `BreedingState` is defined |
| T-02 | `BreedingState` is a valid o1js `Struct` with all required fields | Unit | Instance can be constructed with stats, stage, parentAHash, parentBHash, offspringBrainHash, lifecycleHash, cooldownHash |

### AC-2: PetBreeding ZkProgram scaffold

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-03 | `PetBreeding` is exported from `@toon-protocol/pet-circuit` | Unit | Import succeeds |
| T-04 | `PetBreedingProof` is exported from `@toon-protocol/pet-circuit` | Unit | Import succeeds |
| T-05 | `PetBreeding` compiles without error (feasibility gate) | Feasibility | `await PetBreeding.compile()` resolves, no throw |

### AC-3 & AC-4: Both parents must be adults (stage == 2)

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-06 | Parent A at stage 0 (egg) is rejected | Unit | Circuit throws / constraint fails |
| T-07 | Parent A at stage 1 (baby) is rejected | Unit | Circuit throws / constraint fails |
| T-08 | Parent B at stage 0 (egg) is rejected | Unit | Circuit throws / constraint fails |
| T-09 | Two valid adults succeed | Unit | `breed()` resolves without error |

### AC-5 & AC-6: Parent stat thresholds (each stat >= 60)

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-10 | Parent A with one stat at 59 is rejected | Unit | Circuit throws / constraint fails |
| T-11 | Parent B with one stat at 59 is rejected | Unit | Circuit throws / constraint fails |
| T-12 | Both parents with all stats exactly 60 succeed | Unit | `breed()` resolves without error |
| T-13 | Both parents with all stats at 100 succeed | Unit | `breed()` resolves without error |

### AC-7: Parents must be distinct

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-14 | Same parent proof used for both A and B is rejected | Unit | Circuit throws / constraint fails |

### AC-8: Offspring brainHash derivation

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-15 | Offspring brainHash equals Poseidon(parentA.brainHash, parentB.brainHash) | Unit | `result.offspringBrainHash` matches expected Poseidon hash |
| T-16 | Same inputs always produce same offspringBrainHash (determinism) | Unit | Two calls with identical inputs produce identical outputs |

### AC-9: Offspring stats in range

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-17 | Offspring stats at 0 (below minimum) rejected | Unit | Circuit throws / constraint fails |
| T-18 | Offspring stats at 1 (minimum) succeed | Unit | `breed()` resolves without error |
| T-19 | Offspring stats at 100 (maximum) succeed | Unit | `breed()` resolves without error |
| T-20 | Offspring stats at 101 (above maximum) rejected | Unit | Circuit throws / constraint fails |

### AC-10 & AC-11: Offspring lifecycleHash and cooldownHash

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-21 | Offspring lifecycleHash equals Poseidon(parentA.lifecycleHash, parentB.lifecycleHash, offspringBrainHash, Field(0)) | Unit | `result.lifecycleHash` matches expected value |
| T-22 | Offspring cooldownHash equals Poseidon of 11 zeros (same as genesis) | Unit | `result.cooldownHash` matches expected value |

### AC-12 & AC-13: Offspring stage and full public output

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-23 | Offspring stage is always 0 (egg) | Unit | `result.stage` equals `UInt32.from(0)` |
| T-24 | Offspring parentAHash and parentBHash match parent lifecycle hashes | Unit | `result.parentAHash` = parentA.lifecycleHash, `result.parentBHash` = parentB.lifecycleHash |

### AC-14: Test coverage gate

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-25 | Test file has >= 9 test cases in PetBreeding.test.ts | Structural | `jest --listTests` shows PetBreeding.test.ts with >= 9 `it` blocks |

### AC-15: Build verification

| # | Test Description | Type | Pass Criteria |
|---|-----------------|------|---------------|
| T-26 | `pnpm build` succeeds with no TypeScript errors | Build | Exit code 0 |
| T-27 | `pnpm lint` passes | Lint | Exit code 0, no errors |
| T-28 | `pnpm --filter @toon-protocol/pet-circuit test` passes all existing + new tests | Test | All tests green |

---

## Risk Checkpoints

| Risk | ID | Mitigation |
|------|----|-----------|
| Constraint budget exceeds 40K rows | R-022 | Compile feasibility test (T-05) gates all other tests; no owner sig in this circuit reduces budget significantly |
| Cross-program proof verification (PetLifecycleProof not SelfProof) | - | Use `ZkProgram.Proof(PetLifecycle)` as private input type, not `SelfProof` |
| Parent proof generation in tests | - | Use `proofsEnabled: false` — mock proof objects work for constraint checking |

---

## Quality Gate

All of the following must pass before story is considered done:

- [ ] T-05 (compile feasibility) passes
- [ ] T-09 (happy path adult breeding) passes
- [ ] T-06, T-07, T-08 (non-adult rejection) pass
- [ ] T-10, T-11 (stat threshold rejection) pass
- [ ] T-14 (same-parent rejection) passes
- [ ] T-15, T-16 (deterministic brainHash) pass
- [ ] T-26, T-27, T-28 (build + lint + test) pass
