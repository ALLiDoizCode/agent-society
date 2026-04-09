# Traceability Matrix — Story 11.11: Cross-Chain DVM Pricing

**Date:** 2026-04-09
**Package:** `@toon-protocol/pet-dvm`
**Test count:** 200 total (200 pass, 0 fail); 34 new tests for this story

---

## Requirements → Implementation → Tests

| AC | Requirement | Implementation | Test File | Tests |
|----|-------------|----------------|-----------|-------|
| AC-1 | PET-to-ILP price calculator (`calculatePetInteractionPrice`) | `packages/pet-dvm/src/pricing/calculatePetInteractionPrice.ts` | `calculatePetInteractionPrice.test.ts` | 10 tests |
| AC-2 | Default PET action pricing table (`PET_ACTION_PRICES`, `getActionPetCost`, defaults) | `packages/pet-dvm/src/pricing/petActionPrices.ts` | `petActionPrices.test.ts` | 14 tests |
| AC-3 | `PetPricingConfig` type + `PricingError` class | `packages/pet-dvm/src/pricing/types.ts` | (covered by AC-1/AC-2 tests) | — |
| AC-4 | Kind 10035 price advertisement (`buildPetDvmSkillDescriptor`) | `packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts` | `buildPetDvmSkillDescriptor.test.ts` | 10 tests |
| AC-5 | Payment validation in handler | `packages/pet-dvm/src/handler/createPetDvmHandler.ts` (b2 guard) | `createPetDvmHandler.test.ts` (existing suite, backward-compat) | — |
| AC-6 | Package exports | `packages/pet-dvm/src/index.ts` | (compile-time, verified by build) | — |
| AC-7 | Unit tests >= 8 | All three test files | all pricing test files | 34 new |
| AC-8 | Build verification | `pnpm build` + `pnpm lint` + `pnpm --filter @toon-protocol/pet-dvm test` | — | 200/200 |

---

## Risk Coverage

| Risk | Story Risk ID | Mitigation | Test |
|------|---------------|------------|------|
| PET token pricing not resolved | R-013 | Static defaults (`DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n`, `DEFAULT_MARGIN_BPS = 200`) documented as placeholders | `petActionPrices.test.ts` — DEFAULT values verified |
| ILP-to-PET oracle unavailable | R-015 | Static exchange rate sufficient for testing; oracle deferred. `PetPricingConfig` is the injection point for future oracle | `calculatePetInteractionPrice.test.ts` — custom rate test |

---

## Regression Coverage

| Existing Test Suite | Tests | Status |
|--------------------|-------|--------|
| `parsePetInteractionRequest.test.ts` | (pre-existing) | PASS |
| `buildPetInteractionEvent.test.ts` | (pre-existing) | PASS |
| `createPetDvmHandler.test.ts` | (pre-existing) | PASS — backward compat verified (no `pricingConfig` = no validation) |
| `PetStateManager.test.ts` | (pre-existing) | PASS |
| `ProofQueue.test.ts` | (pre-existing) | PASS |
| `PetGameEngine.test.ts` | (pre-existing) | PASS |

---

## ATDD Checklist Coverage

All 27 ATDD checklist items (AT-1.1 through AT-8.2) covered by the 34 new tests + build verification.
