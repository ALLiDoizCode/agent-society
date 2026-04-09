# ATDD Checklist — Story 11.11: Cross-Chain DVM Pricing

**Date:** 2026-04-09
**Story:** 11-11-cross-chain-dvm-pricing
**Package:** `@toon-protocol/pet-dvm`

---

## Acceptance Test Scenarios

### AC-1: PET-to-ILP Price Calculator

- [ ] **AT-1.1** Given `petTokenCost=100`, `exchangeRateUsdcPerPet=1000n`, `marginBps=200`, when `calculatePetInteractionPrice` is called, then it returns `102000n` (floor(100 * 1000 * 1.02))
- [ ] **AT-1.2** Given `petTokenCost=0`, then returns `0n`
- [ ] **AT-1.3** Given `petTokenCost=-1`, then throws `PricingError` with code `'INVALID_TOKEN_COST'`
- [ ] **AT-1.4** Given `exchangeRateUsdcPerPet=0n`, then throws `PricingError` with code `'INVALID_EXCHANGE_RATE'`
- [ ] **AT-1.5** Given `marginBps=-1`, then throws `PricingError` with code `'INVALID_MARGIN_BPS'`
- [ ] **AT-1.6** Given `marginBps=0`, then returns exact base price with no margin added

### AC-2: Default PET Action Pricing Table

- [ ] **AT-2.1** `PET_ACTION_PRICES` has exactly 11 entries (keys 0-10), all values are positive integers
- [ ] **AT-2.2** `getActionPetCost(0)` returns `10` (Feed)
- [ ] **AT-2.3** `getActionPetCost(9)` returns `50` (Cruzar — highest cost action)
- [ ] **AT-2.4** `getActionPetCost(5)` returns `1` (Check — lowest cost action)
- [ ] **AT-2.5** `getActionPetCost(-1)` throws `PricingError` with code `'INVALID_ACTION_TYPE'`
- [ ] **AT-2.6** `getActionPetCost(11)` throws `PricingError` with code `'INVALID_ACTION_TYPE'`
- [ ] **AT-2.7** `DEFAULT_EXCHANGE_RATE_USDC_PER_PET` is `1000n` (bigint)
- [ ] **AT-2.8** `DEFAULT_MARGIN_BPS` is `200`

### AC-3: PetPricingConfig and PricingError

- [ ] **AT-3.1** `PricingError` is an instance of `Error`
- [ ] **AT-3.2** `PricingError` has a `code` property of type string
- [ ] **AT-3.3** `PricingError.name` is `'PricingError'`

### AC-4: Kind 10035 Price Advertisement

- [ ] **AT-4.1** `buildPetDvmSkillDescriptor` returns an object with `name: 'pet-dvm'`, `version: '1.0'`, `kinds: [5900]`
- [ ] **AT-4.2** `pricing['5900']` is a valid string representation of a positive bigint
- [ ] **AT-4.3** Default features include `'zk-proven'` and `'memvid-brain'`
- [ ] **AT-4.4** Custom features array is passed through when provided
- [ ] **AT-4.5** `inputSchema` is a non-null object

### AC-5: Payment Validation Integration

- [ ] **AT-5.1** When `pricingConfig` is NOT set in `PetDvmConfig`, handler accepts requests regardless of `ctx.amount`
- [ ] **AT-5.2** When `pricingConfig` is set and `ctx.amount >= calculatePetInteractionPrice(request.tokenCost, config.pricingConfig)`, handler proceeds normally
- [ ] **AT-5.3** When `pricingConfig` is set and `ctx.amount < required`, handler returns `{ accept: false, code: 'F01', message: ... }`
- [ ] **AT-5.4** The rejection message includes both expected and received amounts

### AC-6: Package Exports

- [ ] **AT-6.1** `calculatePetInteractionPrice` is importable from `@toon-protocol/pet-dvm`
- [ ] **AT-6.2** `getActionPetCost` is importable from `@toon-protocol/pet-dvm`
- [ ] **AT-6.3** `buildPetDvmSkillDescriptor` is importable from `@toon-protocol/pet-dvm`
- [ ] **AT-6.4** `PricingError` is importable from `@toon-protocol/pet-dvm`
- [ ] **AT-6.5** `PetPricingConfig` type is importable from `@toon-protocol/pet-dvm`

### AC-7: Unit Tests Pass

- [ ] **AT-7.1** `pnpm --filter @toon-protocol/pet-dvm test` — all new tests pass
- [ ] **AT-7.2** All existing pet-dvm tests continue to pass (no regressions)

### AC-8: Build Verification

- [ ] **AT-8.1** `pnpm build` compiles cleanly with zero TypeScript errors
- [ ] **AT-8.2** `pnpm lint` passes with zero errors

---

## Risk Coverage

| Risk ID | Description | Covered By |
|---------|-------------|------------|
| R-013 | PET token pricing not resolved (fixed vs market) | AT-2.7, AT-2.8 — static defaults documented |
| R-015 | ILP-to-PET cross-chain pricing oracle unavailable | AT-1.1, AT-4.2 — static exchange rate sufficient |
