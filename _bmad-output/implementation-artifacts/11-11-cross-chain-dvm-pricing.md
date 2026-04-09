# Story 11.11: Cross-Chain DVM Pricing

Status: done
ui_impact: false

## Story

As a pet DVM operator,
I want a pricing engine that calculates a valid ILP-denominated price for Kind 5900 pet interaction requests (in USDC micro-units) from a static ILP-to-PET exchange rate, and advertises that price in Kind 10035 service discovery events,
so that DVM clients (ditto and others) can discover the correct ILP amount to send and the DVM can verify incoming payments cover the required PET token cost.

## Dependencies

- **Upstream:** Story 11-5 (Pet DVM Handler) — `createPetDvmHandler`, `PetInteractionRequest`, `tokenCost` field. DONE.
- **Upstream:** Story 11-8 (PET Token on Mina) — PET token unit definition, action-cost table. DONE.
- **Shared:** `@toon-protocol/pet-dvm` — handler config type (`PetDvmConfig`), `parsePetInteractionRequest`.
- **Shared:** `@toon-protocol/core` — `SkillDescriptor`, `buildServiceDiscoveryEvent`, `SERVICE_DISCOVERY_KIND`.
- **Shared:** `@toon-protocol/sdk` — `buildSkillDescriptor`, `BuildSkillDescriptorConfig`, `kindPricing` config field.
- **Downstream:** Story 11-9 (Ditto Pet DVM Integration) — `filterPetDvmProviders` reads `skill.pricing['5900']` from Kind 10035 events. DONE.

## Acceptance Criteria

1. **AC-1 — PET-to-ILP price calculator:** Create a `calculatePetInteractionPrice(petTokenCost: number, config: PetPricingConfig): bigint` function in `packages/pet-dvm/src/pricing/calculatePetInteractionPrice.ts` that:
   - Accepts `petTokenCost: number` (number of PET tokens for the interaction, e.g., `100`)
   - Accepts a `PetPricingConfig` with `exchangeRateUsdcPerPet: number` (USDC micro-units per PET token, e.g., `1000n` → stored as bigint; function accepts `bigint`) and `marginBps: number` (basis points for DVM margin, e.g., `200` = 2%)
   - Returns a `bigint` representing the total ILP price in USDC micro-units: `floor(petTokenCost * exchangeRateUsdcPerPet * (1 + marginBps / 10000))`
   - Throws `PricingError` (new error class) if `petTokenCost < 0`, `exchangeRateUsdcPerPet <= 0n`, or `marginBps < 0`
   - Returns `0n` for `petTokenCost === 0`

2. **AC-2 — Default PET action pricing table:** Create `packages/pet-dvm/src/pricing/petActionPrices.ts` with:
   - A `PET_ACTION_PRICES: Record<number, number>` constant mapping action types 0-10 to their PET token costs (integers >= 1)
   - Default costs: `{ 0: 10, 1: 10, 2: 10, 3: 5, 4: 5, 5: 1, 6: 5, 7: 5, 8: 20, 9: 50, 10: 10 }` (Feed=10, Play=10, Clean=10, Rest=5, Warm=5, Check=1, Sing=5, Talk=5, Medicine=20, Cruzar=50, PlayMusic=10)
   - A `getActionPetCost(actionType: number): number` function that returns the PET cost for the given action type, or throws `PricingError` for out-of-range values (< 0 or > 10)
   - Export `DEFAULT_EXCHANGE_RATE_USDC_PER_PET: bigint = 1000n` (1000 USDC micro-units = 0.001 USDC per PET token, static placeholder for testing)
   - Export `DEFAULT_MARGIN_BPS: number = 200` (2% DVM margin)

3. **AC-3 — PetPricingConfig type and PricingError class:** Create `packages/pet-dvm/src/pricing/types.ts` with:
   - `PetPricingConfig` interface: `{ exchangeRateUsdcPerPet: bigint, marginBps: number }`
   - `PricingError` class extending `Error` with `code: string` field; supported codes: `'INVALID_TOKEN_COST'`, `'INVALID_EXCHANGE_RATE'`, `'INVALID_MARGIN_BPS'`, `'INVALID_ACTION_TYPE'`
   - Export from `packages/pet-dvm/src/pricing/index.ts` barrel

4. **AC-4 — Kind 10035 price advertisement:** Create a `buildPetDvmServiceDiscovery(config: PetDvmServiceDiscoveryConfig): ServiceDiscoveryContent['skill']` function in `packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts` that:
   - Accepts `PetDvmServiceDiscoveryConfig`: `{ ilpAddress: string, pricingConfig: PetPricingConfig, features?: string[] }`
   - Computes per-Kind pricing: `pricing['5900'] = String(calculatePetInteractionPrice(MEDIAN_ACTION_COST, config.pricingConfig))` where `MEDIAN_ACTION_COST = 10` (used as the advertised representative per-interaction price)
   - Returns a `SkillDescriptor`-compatible object with `name: 'pet-dvm'`, `version: '1.0'`, `kinds: [5900]`, `features: config.features ?? ['zk-proven', 'memvid-brain']`, `inputSchema: { type: 'object', properties: { action: { type: 'integer', minimum: 0, maximum: 10 } } }`, `pricing` as computed above
   - Pure function (no side effects, no I/O)

5. **AC-5 — Payment validation integration:** Extend `PetDvmConfig` in `packages/pet-dvm/src/handler/types.ts` with optional `pricingConfig?: PetPricingConfig` field. Update `createPetDvmHandler` in `packages/pet-dvm/src/handler/createPetDvmHandler.ts` to:
   - When `config.pricingConfig` is set: before processing the interaction, validate that `ctx.amount >= calculatePetInteractionPrice(request.tokenCost, config.pricingConfig)`
   - Reject with code `'F01'` and message `'Insufficient ILP payment: required {expected}, received {received}'` if the payment is insufficient
   - When `config.pricingConfig` is NOT set: skip payment validation (backward-compatible default)

6. **AC-6 — Package exports:** Export from `packages/pet-dvm/src/index.ts`:
   - Functions: `calculatePetInteractionPrice`, `getActionPetCost`, `buildPetDvmSkillDescriptor`
   - Constants: `PET_ACTION_PRICES`, `DEFAULT_EXCHANGE_RATE_USDC_PER_PET`, `DEFAULT_MARGIN_BPS`
   - Types: `PetPricingConfig`, `PricingError`

7. **AC-7 — Unit tests:** >= 8 unit tests across 3 test files:
   - `calculatePetInteractionPrice.test.ts` (>= 3): valid calculation (margin applied), zero cost returns 0n, negative cost throws PricingError, invalid exchange rate throws, margin correctly applied (200 bps = 2%)
   - `petActionPrices.test.ts` (>= 2): all 11 action types return positive integers, out-of-range action throws PricingError, DEFAULT_EXCHANGE_RATE is positive bigint
   - `buildPetDvmSkillDescriptor.test.ts` (>= 3): skill name/version/kinds correct, pricing['5900'] is a valid string bigint, features default includes 'zk-proven'

8. **AC-8 — Build verification:** After all changes:
   - `pnpm build` compiles cleanly across all packages
   - `pnpm lint` passes
   - `pnpm --filter @toon-protocol/pet-dvm test` passes — all new + existing tests pass

## Tasks / Subtasks

- [x] Task 1: Create pricing types and error class (AC: 3)
  - [x] 1.1 Create `packages/pet-dvm/src/pricing/types.ts` with `PetPricingConfig`, `PricingError`
  - [x] 1.2 Create `packages/pet-dvm/src/pricing/index.ts` barrel export

- [x] Task 2: Create pricing functions (AC: 1, 2, 4)
  - [x] 2.1 Create `packages/pet-dvm/src/pricing/calculatePetInteractionPrice.ts`
  - [x] 2.2 Create `packages/pet-dvm/src/pricing/petActionPrices.ts`
  - [x] 2.3 Create `packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts`

- [x] Task 3: Integrate payment validation into handler (AC: 5)
  - [x] 3.1 Add optional `pricingConfig?: PetPricingConfig` to `PetDvmConfig` in `packages/pet-dvm/src/handler/types.ts`
  - [x] 3.2 Add payment validation guard in `packages/pet-dvm/src/handler/createPetDvmHandler.ts`

- [x] Task 4: Update package exports (AC: 6)
  - [x] 4.1 Add pricing exports to `packages/pet-dvm/src/index.ts`

- [x] Task 5: Write unit tests (AC: 7)
  - [x] 5.1 Create `packages/pet-dvm/src/pricing/calculatePetInteractionPrice.test.ts`
  - [x] 5.2 Create `packages/pet-dvm/src/pricing/petActionPrices.test.ts`
  - [x] 5.3 Create `packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.test.ts`

- [x] Task 6: Build and lint verification (AC: 8)
  - [x] 6.1 Run `pnpm build`
  - [x] 6.2 Run `pnpm lint`
  - [x] 6.3 Run `pnpm --filter @toon-protocol/pet-dvm test`

## Dev Notes

### Critical: Static Exchange Rate

This story uses a **static placeholder exchange rate** (`DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n` USDC micro-units per PET token). A dynamic oracle is explicitly deferred (Risk R-015). The static rate is sufficient for testing and initial DVM operation.

At `1000n` USDC micro-units per PET token:
- A "Check" action (1 PET) = 1,020 USDC micro-units (after 2% margin)
- A "Feed" action (10 PET) = 10,200 USDC micro-units (0.0102 USDC)
- A "Cruzar" action (50 PET) = 51,000 USDC micro-units (0.051 USDC)

### Price Calculation Formula

```
ilpPrice = floor(petTokenCost * exchangeRateUsdcPerPet * (10000 + marginBps) / 10000)
```

Use integer arithmetic throughout (bigint). Never use floating point for money calculations.

In TypeScript with bigints:
```typescript
const base = BigInt(petTokenCost) * exchangeRateUsdcPerPet;
const withMargin = (base * BigInt(10000 + marginBps)) / 10000n;
// Note: bigint division is floor division -- correct behavior
```

### ctx.amount Type

In `createPetDvmHandler`, `ctx.amount` is `bigint` (ILP amount in USDC micro-units). The comparison `ctx.amount >= calculatePetInteractionPrice(...)` is a standard bigint comparison.

### HandlerContext amount Field

The `HandlerContext` interface (defined in `packages/pet-dvm/src/handler/types.ts`) already has `readonly amount: bigint`. No change needed to the interface.

### Skill Descriptor Pricing Convention

The `SkillDescriptor.pricing` field (`Record<string, string>`) stores prices as string bigints (e.g., `{ '5900': '10200' }`). This matches the existing convention in `buildSkillDescriptor` in `packages/sdk/src/skill-descriptor.ts` and is what `filterPetDvmProviders` in `packages/client/src/pet/filterPetDvmProviders.ts` reads.

### Service Discovery Types

Import `SkillDescriptor` from `@toon-protocol/core`:
```typescript
import type { SkillDescriptor } from '@toon-protocol/core';
```

The `buildPetDvmSkillDescriptor` function returns a `SkillDescriptor` directly (not a full `ServiceDiscoveryContent`). The caller (DVM operator node setup) passes this into `buildServiceDiscoveryEvent` or the SDK's `createNode` config.

### Existing pet-dvm Package Pattern

- Source in `packages/pet-dvm/src/`
- Two existing subdirectories: `engine/`, `handler/`
- New subdirectory: `pricing/` (this story)
- Tests co-located (`.test.ts` suffix)
- TypeScript strict mode, ESM with `.js` extension in imports
- Vitest test framework

### Error Pattern

`PricingError` extends `Error` with a `code` field, following `GameEngineError` in `packages/pet-dvm/src/engine/types.ts`:
```typescript
export class PricingError extends Error {
  constructor(message: string, public readonly code: PricingErrorCode) {
    super(message);
    this.name = 'PricingError';
  }
}
export type PricingErrorCode = 'INVALID_TOKEN_COST' | 'INVALID_EXCHANGE_RATE' | 'INVALID_MARGIN_BPS' | 'INVALID_ACTION_TYPE';
```

### No UI Impact

This story adds a pricing module to the `pet-dvm` package (server-side). No UI components are created. Ditto already reads `skill.pricing['5900']` from Kind 10035 events (implemented in Story 11-9's `filterPetDvmProviders`).

### Regression Risk

- Existing `createPetDvmHandler` callers that do NOT pass `pricingConfig` must continue to work unchanged (backward-compatible optional field).
- Existing `PetDvmConfig` tests must still pass — the new field is optional.

### References

- [Source: packages/pet-dvm/src/handler/types.ts] — PetDvmConfig, HandlerContext (amount: bigint)
- [Source: packages/pet-dvm/src/handler/createPetDvmHandler.ts] — handler pattern, reject/accept flow
- [Source: packages/pet-dvm/src/engine/types.ts] — GameEngineError pattern (replicate for PricingError)
- [Source: packages/sdk/src/skill-descriptor.ts] — buildSkillDescriptor, kindPricing convention
- [Source: packages/core/src/events/service-discovery.ts] — SkillDescriptor type
- [Source: packages/client/src/pet/filterPetDvmProviders.ts] — reads skill.pricing['5900']
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md#token-economy] — DVM market maker model
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#11-11] — Story 11-11 test strategy

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None — all tests passed after two fix rounds: (1) `.js` extension removal for CommonJS module resolution, (2) `noUncheckedIndexedAccess` non-null assertion and `noPropertyAccessFromIndexSignature` bracket-notation fixes in tests.

### Completion Notes List

- Created `packages/pet-dvm/src/pricing/` subdirectory with 4 source files + barrel
- `types.ts`: `PetPricingConfig` interface + `PricingError` class (code-typed, prototype chain fixed)
- `calculatePetInteractionPrice.ts`: bigint arithmetic, floor division, validates all inputs
- `petActionPrices.ts`: `PET_ACTION_PRICES` (11 entries), `getActionPetCost` with range validation, `DEFAULT_EXCHANGE_RATE_USDC_PER_PET = 1000n`, `DEFAULT_MARGIN_BPS = 200`
- `buildPetDvmSkillDescriptor.ts`: pure function, local `SkillDescriptor` interface (avoids @toon-protocol/core dep), median cost = 10 PET for advertised price
- Added optional `pricingConfig?: PetPricingConfig` to `PetDvmConfig` in `handler/types.ts`; backward-compatible (omitting it skips payment validation)
- Payment validation guard added to `createPetDvmHandler` (step b2, after request parse): rejects with `F01` + message showing required vs received amounts
- All 6 new symbols exported from `packages/pet-dvm/src/index.ts`
- 33 new Jest tests across 3 files; 199 total tests pass (166 existing + 33 new)
- Two fix rounds during development: removed `.js` extensions (CommonJS project), switched Vitest imports to Jest globals

### File List

- packages/pet-dvm/src/pricing/types.ts (created)
- packages/pet-dvm/src/pricing/calculatePetInteractionPrice.ts (created)
- packages/pet-dvm/src/pricing/petActionPrices.ts (created)
- packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts (created)
- packages/pet-dvm/src/pricing/index.ts (created)
- packages/pet-dvm/src/pricing/calculatePetInteractionPrice.test.ts (created)
- packages/pet-dvm/src/pricing/petActionPrices.test.ts (created)
- packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.test.ts (created)
- packages/pet-dvm/src/handler/types.ts (modified — added pricingConfig field + PetPricingConfig import)
- packages/pet-dvm/src/handler/createPetDvmHandler.ts (modified — added payment validation guard + pricing import)
- packages/pet-dvm/src/index.ts (modified — added pricing exports)
- _bmad-output/implementation-artifacts/11-11-cross-chain-dvm-pricing.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-04-09: Story 11-11 development complete. Implemented cross-chain DVM pricing module in packages/pet-dvm/src/pricing/. 33 new tests, 199 total passing.
- 2026-04-09: Code Review Pass #1 — added integer validation to calculatePetInteractionPrice, removed Math.floor, added 1 test. 200 total tests.

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 1 low
- **Outcome:** Pass with fix applied

#### Issues Found

1. **[Low] `calculatePetInteractionPrice` accepted non-integer `petTokenCost` via `Math.floor` silently** — PET token costs are always whole-unit integers (game design invariant). A non-integer input like `10.7` would silently floor to `10`, undercharging the client. Fixed by adding `Number.isInteger` to the validation guard and removing `Math.floor`. Added 1 new test covering this case.

#### Tests

- All 200 tests pass after fix.

### Review Pass #2

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Notes

- `ilpAddress` field in `PetDvmServiceDiscoveryConfig` is accepted but unused in the returned descriptor — intentional (caller uses it for full `ServiceDiscoveryContent`), acceptable pattern
- `ctx.amount < requiredAmount` bigint comparison is correct — no coercion possible
- All error codes correct and consistent with ILP conventions (F01 for underpayment)
- All 200 tests pass — no files modified

### Review Pass #3 (FINAL — Security Focus)

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Security Checks Performed

- Integer overflow: bigint arithmetic — impossible in JS/TS
- Negative amount bypass: validated before BigInt() conversion — safe
- Zero/negative exchange rate: explicit guard `<= 0n` — safe
- Type coercion: `BigInt(petTokenCost)` after integer validation — safe; `BigInt(10000 + Math.floor(config.marginBps))` after non-negative finite validation — safe
- Payment comparison: `ctx.amount < requiredAmount` both bigints — no coercion
- No JSON.parse, no file I/O, no regex, no prototype pollution surface
- No injection vectors (error messages interpolate validated numeric values only)

#### Tests

- All 200 tests pass — no files modified
