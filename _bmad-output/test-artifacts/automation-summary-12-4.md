---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03-author-tests', 'step-04-verify']
lastStep: 'step-04-verify'
lastSaved: '2026-04-13'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md
  - packages/mill/src/errors.ts
  - packages/mill/src/wallet.ts
  - packages/mill/src/inventory.ts
  - packages/mill/src/channel-state.ts
  - packages/mill/src/payment-channel-signer.ts
  - packages/mill/src/claim-issuer.ts
  - packages/mill/src/*.test.ts (pre-existing suites)
story: 12-4-mill-inventory-and-wallet-management
mode: standalone (BMad-integrated story artifact available)
coverage_target: critical-paths (gap-fill against AC contracts)
test_runner: 'pnpm --filter @toon-protocol/mill test'
---

# Test Automation Expansion — Story 12.4 (Mill Inventory + Wallet Management)

## Summary

Gap-fill pass against the 12 acceptance criteria in Story 12.4. Existing
suites already covered the headline test-design-epic-12 items
(T-029…T-037, T-inv-1, T-cs-1, T-026, T-int-1, AC-10 structural
assignability). Coverage analysis found six additional AC contract
clauses (AC-2 `MillInventoryError` shape / `UNKNOWN_PAIR` code; AC-3
`addressIndex` override + Mina key shape; AC-4 `credit` creates-if-missing
+ non-positive guard + custom clock + chain-with-colons parsing; AC-5
Solana verify round-trip + Mina signer construction; AC-6 `newClaimId`
override + channel-state rollback on signer failure + default UUID shape;
AC-7 `get` / `release` no-op paths + custom clock) that were not
exercised. 28 new tests added, all passing.

## Mode & Stack

- Mode: BMad-integrated (story file + implementation artifact loaded).
- Detected stack: backend (Node/TS library — no Playwright/Cypress
  config). Vitest is the test framework. No browser tests required.
- Coverage target: critical-paths (gap-fill against AC contracts, not
  exhaustive).

## Coverage Delta

| Metric                          | Before | After | Δ    |
| ------------------------------- | ------ | ----- | ---- |
| Test files                      | 6      | 7     | +1   |
| Tests passing                   | 43     | 71    | +28  |
| Tests skipped (Mina peer dep)   | 1      | 1     | 0    |
| Test duration (all mill)        | 0.66s  | 1.23s | +0.6s |

Command: `pnpm --filter @toon-protocol/mill test`

## AC Coverage Matrix

| AC    | Before | Gaps Filled                                                                                              | After |
| ----- | ------ | -------------------------------------------------------------------------------------------------------- | ----- |
| AC-1  | OK     | (scaffold; covered by build)                                                                             | OK    |
| AC-2  | Partial| Full `MillInventoryError` / `MillWalletError` class-shape tests; all code literals exercised             | Full  |
| AC-3  | Most   | `addressIndex` override (EVM + Mina); Mina privateKey/publicKey string shape + path pin                  | Full  |
| AC-4  | Most   | `credit` creates-if-missing; non-positive credit guard; custom clock on init/debit/credit; colon-chain parse | Full  |
| AC-5  | Most   | Solana signature cryptographic verify round-trip; Solana/Mina signer `chain`+`chainKind` getters        | Full  |
| AC-6  | Most   | `newClaimId` override honored; signing-failure channel-state rollback; default UUID shape                | Full  |
| AC-7  | Most   | `get` returns null for missing; `get` returns copy not live ref; `release` no-op paths; custom clock    | Full  |
| AC-8  | OK     | (concurrent-safety T-026 already present)                                                                | OK    |
| AC-9  | OK     | (export matrix already present)                                                                          | OK    |
| AC-10 | OK     | (structural `ClaimIssuer` assignability already present)                                                 | OK    |
| AC-11 | N/A    | (this automate run ADDS to AC-11's enumerated suite)                                                     | —     |
| AC-12 | OK     | (build + lint gates; not this workflow's scope)                                                          | OK    |

## Files Changed

- `packages/mill/src/errors.test.ts` (**NEW** — 8 tests; AC-2 class-shape + code literals)
- `packages/mill/src/inventory.test.ts` (appended 5 tests — AC-4 gaps)
- `packages/mill/src/channel-state.test.ts` (appended 6 tests — AC-7 gaps)
- `packages/mill/src/wallet.test.ts` (appended 3 tests — AC-3 addressIndex + Mina shape)
- `packages/mill/src/payment-channel-signer.test.ts` (appended 3 tests — Solana verify + Mina/Solana getter checks)
- `packages/mill/src/claim-issuer.test.ts` (appended 3 tests — AC-6 newClaimId + rollback + UUID shape)

No source (non-test) files were modified. No changes to `packages/sdk`,
`packages/core`, `packages/client`, or connector repo.

## New Tests (28)

### errors.test.ts (AC-2) — 8 tests

- `MillInventoryError` is Error subclass with correct `name`
- exposes readonly `INSUFFICIENT_INVENTORY` code (load-bearing for Story 12.3 handler)
- accepts `UNKNOWN_PAIR` code literal
- accepts `INVENTORY_NOT_INITIALIZED` code literal
- preserves ES2022 `cause`
- `MillWalletError` is Error subclass with correct `name`
- accepts all four code literals (`INVALID_MNEMONIC`/`UNSUPPORTED_CHAIN`/`DERIVATION_FAILED`/`SIGNING_FAILED`)
- preserves ES2022 `cause`

### inventory.test.ts (AC-4) — +5 tests

- `credit` on missing pair creates the entry
- `credit` with non-positive amount throws `INSUFFICIENT_INVENTORY`
- `get` returns null for uninitialized pair
- custom `clock` used on init/debit/credit
- snapshot round-trips asset+chain parsing for chains that contain colons (e.g. `evm:base:8453`)

### channel-state.test.ts (AC-7) — +6 tests

- `get` returns null for an unprovisioned channel
- `get` returns a copy (external mutation does not affect internal state)
- `release` on unprovisioned channel is a no-op
- `release` no-op when it would drive nonce negative
- `release` no-op when cumulativeDelta exceeds accumulated cumulativeAmount
- custom `clock` used on reserve + release

### wallet.test.ts (AC-3) — +3 tests

- different `addressIndex` values produce distinct EVM keys at the same accountIndex
- different `addressIndex` values produce distinct Mina keys at the same accountIndex
- Mina entry includes string privateKey+publicKey plus BIP-44 coin-type-12586 path

### payment-channel-signer.test.ts (AC-5) — +3 tests

- Solana signature cryptographically verifies against derived public key; tampered hash fails verify
- Solana signer `chain` + `chainKind` getters exposed
- Mina signer `chain` + `chainKind` getters exposed (no peer dep required)

### claim-issuer.test.ts (AC-6) — +3 tests

- custom `newClaimId` generator honored + called per-issuance
- signer failure rolls back channel-state reservation (nonce + cumulativeAmount restored)
- returned result includes non-empty string `claimId` (default UUID path)

## Issues Found & Fixed

1. Initial Solana `addressIndex` override test failed because `deriveSolana`
   intentionally hardens the entire path per SLIP-0010 (`m/44'/501'/N'/0'/0'`)
   and does not use `addressIndex`. Replaced with an equivalent Mina
   `addressIndex` isolation test — Mina derivation does honor
   `addressIndex` per its `m/44'/12586'/N'/0/M` path.
2. `@noble/hashes/sha2` dynamic import needed the `.js` suffix under
   this repo's ESM resolution — matched the package's `import` pattern
   (same style used by `payment-channel-signer.ts`).

## Known Concerns / Follow-ups

- The Solana verify test asserts the signature is well-formed and that
  tampering fails — the "matching-hash" assertion is non-strict (accepts
  either formula-match or signer's documented alternate scheme) because
  AC-5 explicitly defers exact chain-formula round-trip to Story 12.8
  Docker E2E. This is intentional per the story's "Document any
  deviation from the connector's exact hashing formula as a KNOWN
  FOLLOW-UP for Story 12.8 E2E" guidance.
- One test remains skipped (`describe.skipIf(!hasMinaSigner)` for
  real-chain Mina `signFields` round-trip). Gated on the optional
  `mina-signer` peer dep, as specified by AC-11.

## Verification

```
pnpm --filter @toon-protocol/mill test
> Test Files  7 passed (7)
>      Tests  71 passed | 1 skipped (72)
>   Duration  1.23s
```

No SDK / core / client regressions (no source files in those packages
touched). Root-level `pnpm test` and `pnpm build` were not run per
repo CLAUDE.md OOM guidance.

## Status

**Complete.** 28 gap-fill tests added. All 71 mill tests green. AC-2,
AC-3, AC-4, AC-5, AC-6, AC-7 contract coverage now at Full (from
Partial/Most).
