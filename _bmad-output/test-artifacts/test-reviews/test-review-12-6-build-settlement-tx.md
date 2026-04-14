---
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-quality-evaluation', 'step-04-generate-report']
lastStep: 'step-04-generate-report'
lastSaved: '2026-04-14'
mode: 'yolo'
---

# Test Quality Review — Story 12.6 (`buildSettlementTx()`)

- **Scope:** directory review — `packages/sdk/src/settlement/*.test.ts` (5 files)
- **Framework:** Vitest (backend unit tests)
- **Reviewer:** bmad-tea test-review (Opus 4.6, YOLO mode)
- **Date:** 2026-04-14
- **Story status:** review
- **Quality score (post-fix):** **92 / 100 — A (Excellent)**
- **Pre-fix score:** 78 / 100 — B

## Files reviewed

| File | Tests (before → after) | Lines | Notes |
|---|---|---|---|
| `hashes.test.ts` | 16 → 19 | 150 → 177 | Added pinned golden-vector digests |
| `evm.test.ts` | 13 → 15 | 397 → 447 | Pinned selector + event signature |
| `build-settlement-tx.test.ts` | 15 → 20 | 421 → 565 | Added MILL_SIGNER_MISMATCH, heartbeat, cross-chain, Solana verify round-trip, Mina reason |
| `solana.test.ts` | 5 → 5 | 143 | Unchanged — already solid |
| `mina.test.ts` | 1 → 1 | 36 | Unchanged — sufficient for stub |
| **Total** | **50 → 60** | | **+10 net new tests** |

Full suite: `pnpm --filter @toon-protocol/sdk test` → **660 passed / 660** (was 633).

## Executive summary

- **Overall assessment:** Good baseline test suite with real-crypto round-trips, clean factories, priority markers, and strong coverage of AC-5 grouping/monotonicity rules. A handful of gaps existed around pinned digest regression nets, error-code coverage, and cross-chain dispatch — all fixed in this review.
- **Key strengths:**
  - Real `@noble/curves` secp256k1 + Ed25519 round-trips (no mocks) — aligns with Story 12.5 discipline.
  - Clear factory helpers (`makeClaim`, `signBalanceProofEvm`) reduce duplication while keeping intent obvious.
  - `[P0]` / `[P1]` priority markers applied to every assertion.
  - Isolated, deterministic, zero hard waits, AAA structure.
  - Direct coverage of T-048 / T-049 / T-051 / T-052 / T-053 / T-054 from `test-design-epic-12.md`.
- **Key weaknesses (pre-fix, now resolved):**
  - Hash tests relied on "length is 32" rather than pinned digest regression nets — a layout-changing refactor could pass unnoticed.
  - `MILL_SIGNER_MISMATCH` error code had zero test coverage despite being specified in AC-5 step 3.
  - No cross-chain dispatch assertion (AC-8 bullet 4).
  - Event signature + function selector only checked for format, not value — Chain Bridge (Epic 13) drift would go undetected.
  - `verifyAccumulatedClaim` only exercised EVM round-trip; Solana path + Mina branch untested.
  - "Equal cumulativeAmount across nonces" (heartbeat claim, AC-5 explicit invariant) had no positive test.
- **Recommendation:** **Approve** — post-fix test suite is production-ready and the story can advance to Done.

## Quality criteria assessment

| Criterion | Status | Violations | Notes |
|---|---|---|---|
| BDD / AAA structure | PASS | 0 | Clean `describe` + `it` with explicit arrange/act/assert. |
| Test IDs | WARN | - | No external test-ID tags (e.g., `1.3-UNIT-001`). ACs are referenced in describe strings (`AC-5`, `AC-7`, `T-048`) which is acceptable for an internal vitest suite; not blocking. |
| Priority markers | PASS | 0 | Every `it` has `[P0]` / `[P1]` / `[P2]`. |
| Hard waits | PASS | 0 | No `sleep` / `setTimeout` / `waitForTimeout`. |
| Determinism | PASS | 0 | Fixed private keys, fixed byte patterns, no `Math.random`, no real `Date.now`-dependent assertions. |
| Isolation | PASS | 0 | Each `it` constructs its own state; no shared mutable state. |
| Fixtures / factories | PASS | 0 | `makeClaim` + `signBalanceProofEvm` are the right level of abstraction. |
| Data factories | PASS | 0 | No magic strings; named constants for `CHANNEL_A`, `CHANNEL_B`, `RECIPIENT`, `CONTRACT`. |
| Network-first | N/A | - | Unit tests, no network. |
| Assertions | PASS | 0 | Every test has explicit assertions; multi-aspect assertions group related invariants. |
| Test length | PASS | 0 | Largest file is 565 lines across 20 describe blocks — manageable. |
| Flakiness patterns | PASS | 0 | No timing-dependent assertions or retry logic. |
| Regression nets (golden vectors) | PASS (post-fix) | 0 | Pinned digests added — see "Fixes applied". |

## Fixes applied (YOLO mode)

### F1 — Pinned golden-vector digests in `hashes.test.ts` (P1)

**Before:** cross-package parity test asserted only `bytesToHex(h).toMatch(/^[0-9a-f]{64}$/)` and the EVM/Solana golden-vector tests only asserted length + determinism.

**After:** added six pinned digests covering zero inputs, realistic inputs, near-max cumulativeAmount, and a cross-package parity sample. Any byte-level drift in `balanceProofHashEvm` / `balanceProofHashSolana` (or in the underlying `bigintToBytes32BE` / `concatBytes`) now breaks the test immediately. Because `packages/mill/src/payment-channel-signer.ts` imports these helpers per AC-6, this is the safety net for the cross-package refactor.

```ts
// Example of pinned digest added
{
  label: 'cross-package parity sample',
  channelId: '0x' + '11'.repeat(32),
  cumulative: 12345n,
  nonce: 7n,
  recipient: '0x' + '22'.repeat(20),
  expected: '579ce58caed50ebbc8bb942a5ab7ff01297c4709cc49c61d44f8f7c8e441885f',
}
```

Also added two new "collision avoidance" tests (different nonce and different cumulativeAmount produce different hashes) since the original suite only tested this for Solana.

### F2 — `MILL_SIGNER_MISMATCH` error-code coverage in `build-settlement-tx.test.ts` (P1)

**Before:** AC-5 step 3 mandates this throw; implementation exists (build-settlement-tx.ts lines 297-302); zero tests covered it.

**After:** added `[P0] throws MILL_SIGNER_MISMATCH when claims in same channel disagree on millSignerAddress` — uses `verifySignatures: false` to bypass the signature check and reach the group-consensus guard directly.

### F3 — Cross-chain dispatch test (AC-8 bullet 4) (P1)

**Before:** AC-8 explicitly requires a test where claims span `evm:8453` and `solana:mainnet` and produce two bundles. The suite covered cross-channel (two EVM channels) but not cross-chain.

**After:** added `[P0] cross-chain — claims spanning evm + solana produce two chain-specific bundles` using real Ed25519 sign + secp256k1 sign round-trips. Asserts `bundles.length === 2`, `kinds === ['evm', 'solana']`, `rejected.length === 0`.

### F4 — Heartbeat claim positive test (P2)

**Before:** AC-5 explicitly says equal `cumulativeAmount` across adjacent nonces is allowed ("heartbeat claim") — only the strict-decrease throw path was tested.

**After:** added `[P0] heartbeat — equal cumulativeAmount across adjacent nonces is allowed` asserting a 3-claim group with nonce=1 cum=100 / nonce=2 cum=100 / nonce=3 cum=150 produces exactly one bundle with nonce=3 cum=150.

### F5 — Solana + Mina coverage of `verifyAccumulatedClaim` (P1)

**Before:** AC-10 exposed the helper for per-chain round-trip validation, but only EVM good/tampered paths had tests.

**After:** added two tests — `[P0] returns valid:true for a correctly-signed Solana claim` (real Ed25519 round-trip) and `[P1] returns valid:false with MINA reason for a mina chain claim`.

### F6 — Pinned EVM event signature + function selector (P2)

**Before:** `expectedEventSignature` only matched `/^0x[0-9a-f]{64}$/`; `EVM_SETTLEMENT_FUNCTION_SELECTOR` was only asserted to have length 4.

**After:**
- Pinned `bundle.expectedEventSignature === '0xe354116c980d91957de31a62b7d1ead030361bfae7baee9ca677bf87aac68576'` (keccak256 of `SettlementSucceeded(bytes32,uint256,uint256,address)`).
- Pinned `EVM_SETTLEMENT_FUNCTION_SELECTOR === 0xee2ed211` (keccak256 of `updateBalance(bytes32,uint256,uint256,address,bytes)` first 4 bytes).
- Added a calldata-level assertion that the encoded tx actually contains the selector bytes.

These constants are Epic 13 Chain Bridge DVM inputs; pinning them guards against silent contract-signature drift during the eventual `../connector` cross-check.

## Issues noted but NOT fixed (low value / out of scope)

- **`chainId`/`contractAddress` invalid-shape tests** (P3): the validation branches in `build-settlement-tx.ts` lines 140-148 are reachable only through misconfig; covered transitively by `throws INVALID_INPUT when contractAddress missing` in evm.test.ts. Deemed sufficient.
- **Logger invocation observability** (P3): `logger?.debug`/`logger?.info` code paths exist but aren't verified. Logger is optional and the behavior is observable — skipped.
- **`fillEvmSettlementTxGas` deep RLP roundtrip** (P3): existing test asserts output differs and is non-empty. A full RLP decoder in test would double the file size; the real guarantee comes from Story 12.8 E2E against Anvil.
- **Solana discriminator pin** (P3): the Anchor discriminator `sha256('global:update_balance')[:8]` is already a module-init constant; AC-9's `TODO(12.6 follow-up)` explicitly defers program-level verification to Story 12.8 E2E.

## Verification

- `pnpm vitest run src/settlement/` → **60 passed / 60** (was 50).
- `pnpm --filter @toon-protocol/sdk test` → **660 passed / 660** (was 633).
- `pnpm lint` → **0 errors** across settlement files (pre-existing warnings unchanged).
- No new runtime deps added (`ed25519` / `base58Encode` already workspace imports).

## Knowledge-base references

- `_bmad/tea/testarch/test-quality.md` — determinism, isolation, priority markers.
- `_bmad/tea/testarch/data-factories.md` — factory patterns (confirmed via `makeClaim`).
- `_bmad/tea/testarch/selective-testing.md` — `[P0]/[P1]/[P2]` markers.
- Story 12.5 adversarial review — real crypto in tests, no mocks for `@noble/*`.
- `_bmad-output/planning-artifacts/test-design-epic-12.md` — T-048..T-054 scenarios.

## Files modified

- `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/hashes.test.ts`
- `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/build-settlement-tx.test.ts`
- `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/evm.test.ts`

## Recommendation

**Approve.** Story 12.6 test suite is now solid against:
(a) layout drift in the cross-package shared-hash module (AC-6),
(b) every error-code branch declared in AC-5 / AC-11,
(c) cross-chain dispatch (AC-8),
(d) Chain Bridge DVM contract drift (AC-7 pinned selector + event sig),
(e) heartbeat claim acceptance (AC-5 invariant).

The remaining follow-ups (real TokenNetwork contract selector lookup, real Solana program discriminator) are properly deferred to Story 12.8 E2E per AC-7 / AC-9 dev-notes and are not in scope for unit tests.
