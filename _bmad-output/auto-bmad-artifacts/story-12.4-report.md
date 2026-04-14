# Story 12.4 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md`
- **Git start**: `5f424f0bc3c67d9c179ebf6cc1c45cd03ace1d40`
- **Duration**: ~2.5 hours (pipeline wall-clock)
- **Pipeline result**: success
- **Migrations**: None

## What Was Built
Story 12.4 ships the `@toon-protocol/mill` package — the wallet, inventory, channel-state, and `MultiChainClaimIssuer` that the swap handler from Story 12.3 needs in order to issue real payment-channel claims. It includes BIP-44 account-index-2 key derivation for EVM/Mina/Solana, in-memory `MillInventory` with microtask-atomic debit/credit, `MillChannelState` (nonce + cumulativeAmount), and three `PaymentChannelSigner` implementations, all wired through a connector-compatible `ClaimIssuer` interface.

## Acceptance Criteria Coverage
- [x] AC-1: `@toon-protocol/mill` package scaffold (tsup, tsconfig, vitest, peer deps) — covered by build pipeline + index.test.ts
- [x] AC-2: `MillWalletError` / `MillInventoryError` typed errors with literal codes — covered by errors.test.ts
- [x] AC-3: `deriveMillKeys` BIP-44 account-index-2 (EVM/Mina/Solana) — covered by wallet.test.ts (T-029…T-032)
- [x] AC-4: `MillInventory` (synchronous debit/credit, microtask-atomic) — covered by inventory.test.ts (T-033, T-034, T-037, T-inv-1)
- [x] AC-5: Three `PaymentChannelSigner` impls (EVM 65-byte r||s||v, Solana 64-byte Ed25519, Mina optional peer) — covered by payment-channel-signer.test.ts (T-035)
- [x] AC-6: `MultiChainClaimIssuer implements ClaimIssuer` (debit-first + rollback) — covered by claim-issuer.test.ts (T-026)
- [x] AC-7: `MillChannelState` (reserve/release, warn-on-underflow) — covered by channel-state.test.ts (T-cs-1)
- [x] AC-8: Connector compatibility — `MultiChainClaimIssuer` matches connector `ClaimIssuer` shape — covered by claim-issuer.test.ts
- [x] AC-9: Public API exports — covered by index.test.ts
- [x] AC-10: Story 12.3 `createSwapHandler` integration — covered by claim-issuer.test.ts (T-int-1)
- [x] AC-11: ≥26 vitest tests in `packages/mill/src/*.test.ts` — 76 tests delivered (75 passing, 1 design-skipped)
- [x] AC-12: SDK + core regression-clean — verified (SDK 527, core 2418 unchanged)

## Files Changed
**`packages/mill/`** (new package)
- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` — created
- `src/errors.ts`, `src/wallet.ts`, `src/inventory.ts`, `src/channel-state.ts`, `src/payment-channel-signer.ts`, `src/claim-issuer.ts`, `src/index.ts` — created
- `src/errors.test.ts`, `src/wallet.test.ts`, `src/inventory.test.ts`, `src/channel-state.test.ts`, `src/payment-channel-signer.test.ts`, `src/claim-issuer.test.ts`, `src/index.test.ts` — created
- `dist/` — removed (stale Story 12.7 scaffold)

**`_bmad-output/`**
- `implementation-artifacts/12-4-mill-inventory-and-wallet-management.md` — created
- `implementation-artifacts/sprint-status.yaml` — added `12-4` entry, advanced to `done`
- `test-artifacts/atdd-checklist-12-4.md` — created
- `test-artifacts/automation-summary-12-4.md` — created
- `test-artifacts/nfr-assessment-12-4.md` — created
- `test-artifacts/traceability/story-12-4-trace.md` — created
- `auto-bmad-artifacts/story-12.4-report.md` — this file

## Pipeline Steps

### Step 1: Create — success (~6 min)
- Created story file with 12 ACs, 9 tasks, 30+ tests enumerated, dev notes, scope fence to defer `startMill`/persistence/KMS to Story 12.7+.
- Decisions: BIP-44 account-index-2 isolation; local `PaymentChannelSigner` interface (10% of connector surface); microtask-atomicity carried over from Story 12.3 review.
- Issue fixed: sprint-status.yaml missing 12-4 entry — added.

### Step 2: Validate — success (~4 min)
- 10 issues fixed: dep version alignment with SDK (`@noble/* ^2.0.0`), `tsup` build (not `tsc`), removed unnecessary `@solana/web3.js`, added `ed25519-hd-key`, expanded AC-12, etc.

### Step 3: ATDD — success (~15 min)
- 44 failing tests written across 6 test files, all `it.skip`-gated with `@ts-expect-error` pins. Package scaffold + ATDD checklist created.

### Step 4: Develop — success (~35 min)
- 7 source files implemented: `errors.ts`, `wallet.ts`, `inventory.ts`, `channel-state.ts`, `payment-channel-signer.ts`, `claim-issuer.ts`, `index.ts`. All 43 tests pass (1 Mina-peer skipped). 0 lint errors.
- Decisions: dynamic `import('mina-signer')` for optional peer; noble-curves v2 API; sha256 fallback for Mina without peer.

### Step 5: Post-Dev Artifact Verify — success (~2 min)
- Reverted prematurely-set `done` → `review` in story + sprint-status; flipped 62 task checkboxes to `[x]`.

### Step 6: Frontend Polish — SKIPPED (backend-only, ui_impact: false)

### Step 7: Post-Dev Lint — success (~1 min)
- Removed 14 stale `eslint-disable` directives; prettier reformatted 9 files. 0 errors / 96 warnings (acceptable test-file non-null assertions).

### Step 8: Post-Dev Test — success (~1 min)
- 44 tests (43 passed, 1 skipped). TEST_COUNT: 44.

### Step 9: NFR — PASS (~1 iter)
- Custom NFRs: BIP-44 key isolation + Story 12.3 structural compat. 5 PASS / 2 CONCERNS (Mina peer fallback, no persistence — both explicit scope fences) / 0 FAIL.

### Step 10: Test Automate — success (~15 min)
- Added 28 gap-fill tests (errors, inventory credit edge cases, channel-state get/release, wallet addressIndex, signer cryptographic verify, claim-issuer rollback). Test count grew 44→71.

### Step 11: Test Review — success (~12 min)
- Found and fixed a critical EVM signature bug: noble-curves v2 `recovered` byte layout was misparsed → signatures unrecoverable. Reworked via `Signature.fromBytes(..., 'recovered').toBytes('compact')` + `v = 27 + recovery`. Strengthened Solana round-trip from `typeof === 'boolean'` to real `verify === true`.

### Step 12: Code Review #1 — success (~10 min)
- 0C/1H/4M/4L = 9 issues, all fixed. High: removed silent sha256 fallback when `mina-signer` peer IS installed (real failures now propagate as `SIGNING_FAILED`). Medium: 32-byte privateKey length guards in EVM/Solana signers, error-doc consistency, `INVALID_CONFIG` codes.

### Step 13: Verify #1 — success
- Reverted prematurely-set `done` → `review`; created `## Code Review Record` section + Pass #1 entry.

### Step 14: Code Review #2 — success (~8 min)
- 0C/0H/3M/3L = 6 issues, all fixed. New `INVALID_CONFIG` error code, optional logger interface methods, Mina scalar length guard, hex-decoder cleanup, docstring corrections.

### Step 15: Verify #2 — success (no changes needed; entry already correct).

### Step 16: Code Review #3 (final, security) — success (~15 min)
- 0C/0H/1M/2L = 3 issues, all fixed. Medium: `MillInventory.credit()` non-positive guard now throws `UNKNOWN_PAIR` (was `INSUFFICIENT_INVENTORY`, which collided with Story 12.3 handler's T04 mapping). Low: AC-7 `release` warn logs added, wallet scalar lint cleanup.
- Semgrep OWASP scan: **0 findings** across 14 files (1059 rules, 210 applicable).
- Status → `done`.

### Step 17: Verify #3 — success (no changes needed).

### Step 18: Security Scan (semgrep) — success
- `semgrep --config=auto packages/mill/src/` → **0 findings**, 0 blocking.

### Step 19: Regression Lint — pass (build clean; mill has no separate lint script — tsup DTS gates typecheck).

### Step 20: Regression Test — pass
- 76 tests (75 passed, 1 design-skipped). TEST_COUNT: 76 (no regression from 44 baseline; +32).

### Step 21: E2E — SKIPPED (backend-only).

### Step 22: Trace — PASS
- All 12 ACs FULL coverage. P0/P1/P2 = 100%. No uncovered gaps. Trace report saved to `_bmad-output/test-artifacts/traceability/story-12-4-trace.md`.

## Test Coverage
- **Test files (7)**: `errors.test.ts`, `wallet.test.ts`, `inventory.test.ts`, `channel-state.test.ts`, `payment-channel-signer.test.ts`, `claim-issuer.test.ts`, `index.test.ts`
- **Test count growth**: ATDD 44 → automate 71 → review 73 → CR3 75 → final 76 (75 passed + 1 design-skipped)
- **Coverage gaps**: None. Single skipped test gated on optional `mina-signer` peer per AC-11/AC-5 (Story 12.8 Docker E2E will install peer and validate real-chain round-trip).
- **Test count**: post-dev 44 → regression 76 (delta: **+32**)

## Code Review Findings

| Pass | Critical | High | Medium | Low | Total Found | Fixed | Remaining |
|------|----------|------|--------|-----|-------------|-------|-----------|
| #1   | 0        | 1    | 4      | 4   | 9           | 9     | 0         |
| #2   | 0        | 0    | 3      | 3   | 6           | 6     | 0         |
| #3   | 0        | 0    | 1      | 2   | 3           | 3     | 0         |

## Quality Gates
- **Frontend Polish**: skipped (backend-only).
- **NFR**: PASS — 5 PASS / 2 CONCERNS (both explicit scope fences) / 0 FAIL.
- **Security Scan (semgrep)**: PASS — 0 findings, no OWASP/injection/auth issues.
- **E2E**: skipped (backend-only — full gift-wrap + handler E2E deferred to Story 12.8).
- **Traceability**: PASS — `_bmad-output/test-artifacts/traceability/story-12-4-trace.md`. All 12 ACs covered.

## Known Risks & Gaps
- **Mina signer**: When the optional `mina-signer` peer is absent, signer falls back to a deterministic sha256 stand-in. Real-chain Mina verification is gated behind Story 12.8 Docker E2E, where the peer will be installed. Documented in source + Dev Notes.
- **EVM verify path**: Test asserts pubkey equivalence via `recoverPublicKey`, not full ecrecover-to-address round-trip. Connector `verifyBalanceProof` round-trip is a Story 12.8 E2E gate.
- **Persistence**: Inventory + channel-state are in-memory only. Cold-restart recovery design is a Story 12.7+/12.8 concern per scope fence.
- **Golden-vector address pinning**: Account-index-2 addresses are asserted only as inequality vs account-index-1 (not pinned to constants). Recommended hardening in Story 12.8.

---

## TL;DR
Story 12.4 ships the `@toon-protocol/mill` package — wallet derivation, inventory, channel state, and a connector-compatible `MultiChainClaimIssuer` that gives Story 12.3's swap handler real payment-channel claims. Pipeline ran clean: 76 tests (+32 over ATDD baseline), 3 review passes resolving 0C/1H/8M/9L = 18 findings (zero remaining), semgrep clean, NFR PASS, trace PASS with all 12 ACs covered. One latent EVM signature bug surfaced and was fixed during test review (noble-curves v2 byte-layout misparse). Ready for Story 12.8 Docker E2E to validate real-chain Mina round-trip and connector `verifyBalanceProof` compat.
