# Story 11-11 Report: Cross-Chain DVM Pricing

**Date:** 2026-04-09
**Epic:** 11 — TOON Pets — ZK-Proven Virtual Pet Economy
**Story:** 11-11 — Cross-Chain DVM Pricing
**Status:** done
**Branch:** epic-11

---

## Summary

Implemented a cross-chain pricing engine for the Pet DVM (`@toon-protocol/pet-dvm`). DVM operators are market makers who accept ILP payments (USDC on any chain) and pay PET tokens on Mina. This story provides the tooling for operators to: (1) calculate the ILP price for any interaction, (2) validate incoming payments, and (3) advertise their price in Kind 10035 service discovery events so clients know what to send.

---

## What Was Built

### New: `packages/pet-dvm/src/pricing/` module

| File | Purpose |
|------|---------|
| `types.ts` | `PetPricingConfig` interface + `PricingError` class (code-typed) |
| `calculatePetInteractionPrice.ts` | Bigint arithmetic: `floor(petTokenCost × rate × (1 + marginBps/10000))` |
| `petActionPrices.ts` | `PET_ACTION_PRICES` table (11 actions), `getActionPetCost()`, `DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n`, `DEFAULT_MARGIN_BPS = 200` |
| `buildPetDvmSkillDescriptor.ts` | Pure function returning `SkillDescriptor` with `pricing['5900']` computed from median action cost |
| `index.ts` | Barrel export |

### Modified: `packages/pet-dvm/src/handler/`

- `types.ts`: Added optional `pricingConfig?: PetPricingConfig` to `PetDvmConfig` (backward-compatible)
- `createPetDvmHandler.ts`: Added payment validation guard (step b2) — rejects with `F01` when `ctx.amount < requiredAmount`

### Modified: `packages/pet-dvm/src/index.ts`

All new pricing symbols exported from the package entry point.

---

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `calculatePetInteractionPrice.test.ts` | 10 | PASS |
| `petActionPrices.test.ts` | 14 | PASS |
| `buildPetDvmSkillDescriptor.test.ts` | 10 | PASS |
| Existing pet-dvm suites (6 files) | 166 | PASS |
| **Total** | **200** | **PASS** |

Build: clean. Lint: clean (0 errors). TypeScript: strict mode, all checks passing.

---

## Key Design Decisions

1. **Static exchange rate** — `DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n` USDC micro-units per PET token (0.001 USDC/PET). Oracle deferred per R-015. The `PetPricingConfig` injection point is the future oracle seam.

2. **Bigint throughout** — All monetary arithmetic uses `bigint` to eliminate floating-point errors. `petTokenCost` validated as non-negative integer (PET tokens are whole units).

3. **No `@toon-protocol/core` dependency** — `SkillDescriptor` interface defined locally in `buildPetDvmSkillDescriptor.ts` to avoid adding a new workspace dependency to `pet-dvm`.

4. **Backward-compatible handler** — `pricingConfig` is optional on `PetDvmConfig`. Existing callers with no pricing config see zero change in behavior.

5. **Median price for advertisement** — Kind 10035 `pricing['5900']` uses 10 PET (median action cost) as the representative price. Actual per-interaction costs vary by action type and are validated server-side.

---

## Artifacts

| Artifact | Path |
|----------|------|
| Story file | `_bmad-output/implementation-artifacts/11-11-cross-chain-dvm-pricing.md` |
| ATDD checklist | `_bmad-output/test-artifacts/atdd-checklist-11-11.md` |
| NFR assessment | `_bmad-output/test-artifacts/nfr-assessment-11-11.md` |
| Traceability | `_bmad-output/test-artifacts/traceability/story-11-11-trace.md` |
| Sprint status | `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-11: done) |
