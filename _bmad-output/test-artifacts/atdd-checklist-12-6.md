---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-generation-mode',
    'step-03-test-strategy',
    'step-04-generate-tests',
    'step-04c-aggregate',
    'step-05-validate-and-complete',
  ]
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-14'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-6-build-settlement-tx.md'
  - '_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md'
  - '_bmad-output/planning-artifacts/test-design-epic-12.md'
  - '_bmad-output/epics/epic-12-token-swap-primitive.md'
  - 'packages/sdk/src/stream-swap.ts'
  - 'packages/sdk/src/swap-handler.ts'
  - 'packages/sdk/src/errors.ts'
  - 'packages/sdk/src/index.ts'
  - 'packages/sdk/vitest.config.ts'
  - 'packages/sdk/package.json'
  - 'packages/mill/src/payment-channel-signer.ts'
  - 'packages/mill/src/claim-issuer.ts'
  - 'packages/core/src/types.ts'
---

# ATDD Checklist — Epic 12, Story 12.6: Client-Side `buildSettlementTx()`

**Date:** 2026-04-14
**Author:** Jonathan
**Primary Test Level:** Unit (vitest, co-located in `packages/sdk/src/settlement/`) + cross-package refactor regression (`packages/mill/`)
**Mode:** YOLO (autonomous ATDD generation)
**Detected Stack:** backend (TypeScript pnpm workspace, vitest; no browser surface; `ui_impact: false`)

---

## Story Summary

Story 12.6 closes the loop of Epic 12's **Token Swap Primitive**: it turns the `AccumulatedClaim[]` produced by Story 12.5's `streamSwap()` into a **chain-specific, unsigned, raw settlement transaction** — ready to be submitted directly by the sender OR handed off to an Epic 13 Chain Bridge DVM (kind:5260) for gas-sponsored broadcast.

**As a** TOON Protocol client developer who just finished a swap via `streamSwap()` and holds an `AccumulatedClaim[]`
**I want** a `buildSettlementTx()` helper in `@toon-protocol/sdk` that verifies every claim's signature against the Mill's expected signer address, picks the highest-nonce cumulative claim per `(chain, channelId)` group, and returns a `SettlementBundle` containing raw unsigned tx bytes
**So that** the swap recipient can settle accumulated off-chain NIP-44 balance-proof claims on-chain without the SDK binding to a live JSON-RPC provider, and without requiring native gas tokens on the target chain when composed with a Chain Bridge DVM

Story 12.6 also executes the **load-bearing FULFILL metadata extension** (AC-3): `channelId`, `nonce`, `cumulativeAmount`, `recipient`, and `millSignerAddress` are threaded from the Mill's inner claim issuer (`packages/mill/src/claim-issuer.ts`) through the SDK swap handler's metadata emit (`packages/sdk/src/swap-handler.ts` lines 491–498) and into `decodeFulfillMetadata` (`packages/sdk/src/stream-swap.ts`). Without this extension, the sender cannot reconstruct the hash the Mill signed.

---

## Acceptance Criteria (15 total, summarized)

1. **AC-1** — New module `packages/sdk/src/settlement/` with 7 source files + 7 co-located `.test.ts` files.
2. **AC-2** — `SettlementBundle` — `@stable` Epic 13 Chain Bridge handoff contract; invariants on `cumulativeAmount`, `selectedClaimIndex`, one bundle per `(chain, channelId)`.
3. **AC-3** — FULFILL metadata extended with `channelId`/`nonce`/`cumulativeAmount`/`recipient`/`millSignerAddress`; threaded through Mill inner issuer → swap-handler emit → `decodeFulfillMetadata` parse → `AccumulatedClaim`.
4. **AC-4** — `BuildSettlementTxParams`/`MillSignerConfig` public input shapes + synchronous fail-fast validation.
5. **AC-5** — `buildSettlementTx()` algorithm: validate → verify signatures → group by `(chain, channelId)` → assert recipient/signer/nonce/monotonicity invariants → pick highest-nonce winner → per-chain dispatch.
6. **AC-6** — Shared `balanceProofHashEvm`/`balanceProofHashSolana` helpers in sdk; Mill refactored to import them (eliminates two-sources-of-truth).
7. **AC-7** — EVM signature recovery via `secp256k1.Signature` + keccak256; RLP-encoded EIP-155 unsigned tx with placeholder gas; `fillEvmSettlementTxGas` public utility for Chain Bridge.
8. **AC-8** — Claim grouping / winner selection across single session, multi-session-same-channel, multi-channel, multi-chain; monotonicity + duplicate-nonce + recipient-mismatch throws.
9. **AC-9** — Solana Ed25519 verification + serialized `Message` bytes; Mina stub throws `UNSUPPORTED_CHAIN`.
10. **AC-10** — `verifyAccumulatedClaim()` standalone utility — pre-check a single claim without running the full pipeline.
11. **AC-11** — `SettlementTxError` class with narrow `code` literal union, ES2022 `cause` forwarding.
12. **AC-12** — Zero new runtime deps beyond (optionally) `@scure/base` for base58.
13. **AC-13** — Zero `@ts-ignore`/`@ts-expect-error`/`any` in public surface (grep gate).
14. **AC-14** — JSDoc with `@stable`, `@since 12.6`, `@see` cross-links on all public exports.
15. **AC-15** — `pnpm --filter @toon-protocol/sdk build|test|lint` green; `pnpm --filter @toon-protocol/mill build|test|lint` green post-refactor; `pnpm --filter @toon-protocol/client build` green.

---

## Step 1 — Preflight & Context

### Stack Detection

`test_stack_type` = `auto` → **backend**.
- Story front-matter: `ui_impact: false`.
- Target packages: `packages/sdk/` (pure TS lib) + `packages/mill/` (refactor regression).
- No `page.goto`/`page.locator` anywhere in `packages/sdk/src/` or `packages/mill/src/`.
- Vitest 1.x config present at `packages/sdk/vitest.config.ts` + `packages/mill/vitest.config.ts` (ESM).
- Tests co-located with source per SDK convention (`packages/sdk/src/*.test.ts`).

### Prerequisites

- [x] Story approved: `status: ready-for-dev`, 15 ACs, 10 tasks.
- [x] Vitest configured in both `packages/sdk` and `packages/mill`.
- [x] Upstream types present: `AccumulatedClaim`, `StreamSwapResult`, `SwapPair`, `StreamSwapError`, `applyRate`, `EvmPaymentChannelSigner`, `SolanaPaymentChannelSigner`, `MultiChainClaimIssuer`.
- [x] Crypto deps already in sdk `package.json`: `@noble/curves ^2.0.0`, `@noble/hashes ^2.0.0`. `@scure/bip32`/`@scure/bip39` present; **`@scure/base` NOT present — dev agent must either add it (preferred, per AC-12 rationale) or hand-roll a base58 codec in `settlement/solana.ts`.**
- [x] Dev env available.

### Loaded Knowledge Fragments (tiered per tea-index)

**Core (always):** `data-factories.md`, `component-tdd.md`, `test-quality.md`, `test-healing-patterns.md`.
**Backend patterns:** `test-levels-framework.md`, `test-priorities-matrix.md`, `ci-burn-in.md`.
**Skipped:** Playwright/Cypress/Pact fragments (no browser surface, no cross-service HTTP contract in this story). Contract-testing skipped — settlement bytes are end-to-end tested against the real EVM/Solana signer roundtrips.

---

## Step 2 — Generation Mode

**Primary level:** **API-level unit tests** co-located under `packages/sdk/src/settlement/`. Rationale:
- `buildSettlementTx()` is a synchronous pure function over bigints/bytes — the highest-fidelity test uses a real `EvmPaymentChannelSigner` / `SolanaPaymentChannelSigner` roundtrip (crypto is fast enough per 12.2 precedent).
- E2E broadcast against Anvil lives in **Story 12.8 (T-050)** — out of scope for this ATDD cycle (see CLAUDE.md memory rules and story Dependencies section).
- Cross-package regression: the AC-6 refactor moves two hash helpers from mill → sdk. Mill's existing test file (`packages/mill/src/payment-channel-signer.test.ts`) MUST stay green with zero test-count delta; a cross-package parity test lives in `packages/sdk/src/settlement/hashes.test.ts`.

**E2E / UI coverage:** N/A — backend library, no UI surface, no on-chain submission in this story.

---

## Step 3 — Test Strategy

### Risk / Priority Matrix (from test-design-epic-12.md § Story 12-6)

| ID    | P   | Title                                                        | AC          | Covered in RED |
|-------|-----|--------------------------------------------------------------|-------------|----------------|
| T-048 | P0  | `buildSettlementTx()` from accumulated EVM claims            | AC-5/7/8    | ✅ |
| T-049 | P0  | Claim signature verification round-trip (real signer)        | AC-6/7/10   | ✅ |
| T-050 | P0  | On-chain settlement succeeds (Anvil submit)                  | AC-7        | **Deferred to Story 12.8** (E2E infra) |
| T-051 | P1  | Multi-session accumulation — single `(chain, channelId)` bundle | AC-5/8   | ✅ |
| T-052 | P1  | Tampered claim rejected, not included in bundle              | AC-5/7/8    | ✅ |
| T-053 | P2  | Solana claim settlement bundle                               | AC-6/9/10   | ✅ |
| T-054 | P2  | Mina stub throws `UNSUPPORTED_CHAIN`                         | AC-9        | ✅ (one-liner) |

### Risk Coverage

- **R-004 (CRITICAL, CRYPTO, score 6) — Signed claims invalid/unsettleable on-chain:**
  - Primary mitigation in this ATDD: `hashes.test.ts` golden-vector + cross-package byte-identical parity (AC-6); `evm.test.ts` T-049 round-trip against real `EvmPaymentChannelSigner` from `packages/mill/src/payment-channel-signer.ts`; `solana.test.ts` T-053 round-trip against real `SolanaPaymentChannelSigner`.
  - Residual risk (E2E broadcast against real TokenNetwork contract on Anvil) → Story 12.8.
- **R-014 (DATA, score 4) — Settlement tx uses wrong nonce or channel ID:**
  - Mitigation: `build-settlement-tx.test.ts` T-048 expanded (5 claims → selectedClaimIndex=4, cumulativeAmount = winner's, NOT sum); duplicate-nonce throw; recipient-mismatch throw; non-monotonic-cumulative throw; multi-channel grouping (2 bundles).

### Out-of-Scope for ATDD

- **E2E against Anvil / Docker SDK E2E infra** — Story 12.8 (T-050).
- **Real TokenNetwork ABI selector lookup** — dev agent MUST grep `../connector/packages/contracts/` during GREEN (per Task 5 DEV NOTE in story); ATDD default is `updateBalance(bytes32,uint256,uint256,address,bytes)` — drift caught by Story 12.8.
- **Real Solana program discriminator lookup** — dev agent grep during GREEN; ATDD default is `sha256('global:update_balance').slice(0,8)` with `TODO(12.6 follow-up)` marker.
- **Mina settlement** — stubbed per AC-9. Single-line throw test only.
- **Perf / stress settlement of 1000+ claim groups** — out of story scope.

---

## Step 4 — Failing Tests (RED Phase)

Seven co-located test files created alongside seven source-file stubs. All files compile to a deterministic RED state: tsc module-not-found failures cascade until the dev agent creates the source stubs, then assertion failures surface until each AC is implemented.

### Test File Inventory (all NEW)

| # | Test file | Source-under-test | Test count | Key ACs |
|---|-----------|-------------------|------------|---------|
| 1 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/hashes.test.ts` | `settlement/hashes.ts` | 8 | AC-6 |
| 2 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/evm.test.ts` | `settlement/evm.ts` | 12 | AC-6, AC-7, AC-11 |
| 3 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/solana.test.ts` | `settlement/solana.ts` | 5 | AC-6, AC-9 |
| 4 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/mina.test.ts` | `settlement/mina.ts` | 1 | AC-9 |
| 5 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/build-settlement-tx.test.ts` | `settlement/build-settlement-tx.ts` | 18 | AC-4, AC-5, AC-8, AC-10, AC-11 |
| 6 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/types.test.ts` | `settlement/types.ts` + `settlement/index.ts` | 4 | AC-1, AC-2 (shape/export surface) |
| 7 | `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/verify.test.ts` (if split out) OR merged into `build-settlement-tx.test.ts` | `verifyAccumulatedClaim` | 3 | AC-10 |

### Existing-file Regression Tests (additions only — do NOT delete existing)

| File | New test cases | ACs |
|------|----------------|-----|
| `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/swap-handler.test.ts` | 5 — assert each new metadata field (`channelId`, `nonce`, `cumulativeAmount`, `recipient`, `millSignerAddress`) emitted with correct format per chain | AC-3 |
| `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/stream-swap.test.ts` | 7 — `decodeFulfillMetadata` accepts valid EVM + valid Solana; rejects missing `channelId`, malformed EVM channelId (3 variants), malformed Solana channelId (base58 fail / length fail); AccumulatedClaim carries all 5 fields through to `result.claims` | AC-3 |
| `/Users/jonathangreen/Documents/TOON-Protocol/packages/mill/src/claim-issuer.test.ts` | 2 — `IssueClaimResult` now includes `channelId`/`nonce`/`cumulativeAmount`/`recipient`/`millSignerAddress`; `signerAddresses` config round-trips to result | AC-3 |
| `/Users/jonathangreen/Documents/TOON-Protocol/packages/mill/src/payment-channel-signer.test.ts` | **0 new** — AC-6 refactor preserves behavior; existing test count unchanged | AC-6, AC-15 |
| `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/index.test.ts` | 4 — `buildSettlementTx`, `fillEvmSettlementTxGas`, `verifyAccumulatedClaim`, `SettlementTxError` re-exported from package root | AC-1, AC-15 |

**Total new / modified tests:** ~68 (51 new in `settlement/`, 14 in existing files, 3 in `verify.test.ts` if split).

---

### File 1 — `hashes.test.ts` (AC-6)

Covers the shared `balanceProofHashEvm` / `balanceProofHashSolana` helpers. The **cross-package parity assertion is load-bearing** — it's the safety net for the sdk↔mill refactor.

**Groups:**
- **AC-6 surface (1):** Both exports are `function` typeof; returning `Uint8Array` of length 32.
- **AC-6 golden vectors — EVM (3):**
  - Fixed seed: `channelId = bytes32(1)`, `cumulativeAmount = 1_000_000n`, `nonce = 1n`, `recipient = bytes20(2)` → expected hex recorded inline.
  - `cumulativeAmount = 0n`, `nonce = 0n`, zero-address recipient.
  - `cumulativeAmount = 2n ** 255n - 1n` (max 255-bit boundary), high-nonce.
- **AC-6 golden vectors — Solana (2):**
  - `channelId = '11111111111111111111111111111111'` (system program base58), fixed cumulative + nonce, fixed recipient.
  - UTF-8 roundtrip: ensure base58 chars (ASCII) encode identically.
- **AC-6 cross-package parity (2):** Import the **mill-side** `balanceProofHashEvm` + `balanceProofHashSolana` via `import('@toon-protocol/mill/src/payment-channel-signer')` (dev agent will verify the import path exists post-refactor — OR read them via the test by instantiating `EvmPaymentChannelSigner` + inspecting the signed bytes). Assert the sdk-side hashes and mill-side-reimported hashes are byte-identical across the 3 EVM golden vectors and 2 Solana golden vectors.

**RED marker:** imports fail until `settlement/hashes.ts` exists.

---

### File 2 — `evm.test.ts` (AC-6, AC-7, AC-11)

Covers signature recovery + RLP-encoded unsigned tx + `fillEvmSettlementTxGas`.

**Groups:**
- **AC-1 surface (2):** `recoverEvmSignerAddress`, `buildEvmSettlementTx`, `fillEvmSettlementTxGas` are functions (latter exported; former two module-private but reachable via test-only `__internals` if needed — prefer testing them indirectly through `buildSettlementTx`).
- **AC-7 / T-049 round-trip (1):** Construct a real `EvmPaymentChannelSigner` via the Mill package, sign a known balance-proof hash for `{channelId, cumulativeAmount=12345n, nonce=7n, recipient}`, pack the 65-byte signature into an `AccumulatedClaim`. Call `recoverEvmSignerAddress(claim)` → assert the returned lowercase-hex address equals the signer's derived public address (also via `EvmPaymentChannelSigner`). **This is the R-004 safety net.**
- **AC-7 / T-048 (1):** `buildEvmSettlementTx(winner, signer, recipient)` returns a `SettlementBundle` with:
  - `chain === 'evm:31337'` (Anvil-compatible), `chainKind === 'evm'`,
  - `channelId === winner.channelId`, `cumulativeAmount === '12345'`, `nonce === '7'`, `recipient === winner.recipient`,
  - `millSignerAddress === signer.address`,
  - `unsignedTxBytes` starts with the 4-byte function selector computed as `keccak_256('updateBalance(bytes32,uint256,uint256,address,bytes)').slice(0,4)`,
  - `expectedEventSignature` is a 66-char (`0x` + 64 hex) string,
  - `claimsMerged === 1`, `selectedClaimIndex === 0`,
  - `sourceChain`/`sourceAssetCode` copied from `pair.from`.
- **AC-7 tamper (1):** Flip `claim.claimBytes[0]` → `recoverEvmSignerAddress` returns a **different** lowercase-hex address; assert `!==` the Mill's expected address.
- **AC-7 zero-signature (1):** `claim.claimBytes = new Uint8Array(65)` → `recoverEvmSignerAddress` either throws `SettlementTxError('INVALID_SIGNATURE_V')` (v=0 not in {27,28}) OR returns zero-address. Test asserts one of those two outcomes (dev agent picks the fail-fast variant).
- **AC-7 wrong-length signature (2):** `new Uint8Array(64)` → `SettlementTxError('INVALID_SIGNATURE_LENGTH')`; `new Uint8Array(66)` → same.
- **AC-7 invalid-v (1):** `claim.claimBytes[64] = 26` → `SettlementTxError('INVALID_SIGNATURE_V')`.
- **AC-7 `fillEvmSettlementTxGas` roundtrip (2):** Call `fillEvmSettlementTxGas(bundle, { nonce: 42n, gasPrice: 1_000_000_000n, gasLimit: 120_000n })` → returns `Uint8Array` longer than `bundle.unsignedTxBytes`; ensure the tx-nonce byte `0x2a` (42) appears in the RLP payload; re-fill with different gas values → output changes.
- **AC-7 MAX_SAFE_INTEGER guard (1):** `cumulativeAmount = 2n**65n`, `nonce = 2n**54n` (both > MAX_SAFE_INTEGER) → `buildEvmSettlementTx` encodes them correctly (bigint round-trip); decode bytes20(winner.recipient) padded-left in the `address` ABI slot.
- **AC-11 error-class shape (1):** `new SettlementTxError('INVALID_SIGNATURE_V', 'bad v', { cause: new Error('inner') })` — `instanceof SettlementTxError`, `name === 'SettlementTxError'`, `code === 'INVALID_SIGNATURE_V'`, `cause.message === 'inner'`.

**RED marker:** imports fail until `settlement/evm.ts` exists.

---

### File 3 — `solana.test.ts` (AC-6, AC-9)

**Groups:**
- **AC-9 surface (1):** `verifyEd25519Signature`, `buildSolanaSettlementTx` typeof function.
- **AC-9 / T-053 round-trip (1):** Instantiate real `SolanaPaymentChannelSigner`; sign balance-proof; pack 64-byte signature into `AccumulatedClaim`; call `verifyEd25519Signature(claim, signerAddress)` → returns `true`. Call `buildSolanaSettlementTx(claim, signerConfig, recipient)` → `SettlementBundle` with `chainKind === 'solana'`, `channelId === claim.channelId`, `unsignedTxBytes` is a valid serialized Message (length > 0; first byte is message header).
- **AC-9 tamper (1):** Flip one byte in `claim.claimBytes` → `verifyEd25519Signature` returns `false`.
- **AC-9 wrong length (1):** `claim.claimBytes = new Uint8Array(63)` → `SettlementTxError('INVALID_SIGNATURE_LENGTH')` thrown from `verifyEd25519Signature` (OR `buildSolanaSettlementTx`).
- **AC-9 discriminator marker (1):** Assert `unsignedTxBytes` contains the discriminator bytes at the expected offset (instruction-data start). If dev agent used Anchor default `sha256('global:update_balance').slice(0,8)`, assert those exact 8 bytes are present.

**RED marker:** imports fail; `@scure/base` may not yet be installed.

---

### File 4 — `mina.test.ts` (AC-9)

**Groups:**
- **AC-9 Mina stub (1):** `buildMinaSettlementTx({} as any, {} as any, '')` throws `SettlementTxError('UNSUPPORTED_CHAIN')` with message containing `'mina-signer peer dep'`.

**RED marker:** import fails until `settlement/mina.ts` exists.

---

### File 5 — `build-settlement-tx.test.ts` (AC-4, AC-5, AC-8, AC-10, AC-11)

The central integration test for the algorithm.

**Groups:**
- **AC-1 / AC-5 surface (1):** `buildSettlementTx` typeof function; return-shape has `bundles`, `rejected`, `superseded`.
- **AC-4 validation (7 — all throw synchronously):**
  - Empty `claims: []` → `SettlementTxError('INVALID_INPUT')`.
  - Claim missing `channelId` → `'MISSING_SETTLEMENT_METADATA'`.
  - Claim missing `nonce` / `cumulativeAmount` / `recipient` / `millSignerAddress` (parameterized) → `'MISSING_SETTLEMENT_METADATA'`.
  - Chain present in claims but missing from `signers` map → `'UNSUPPORTED_CHAIN'`.
  - Chain present but missing from `recipients` → `'MISSING_RECIPIENT'`.
  - EVM signer config missing `contractAddress` → `'INVALID_INPUT'` (or similar; dev picks exact code).
  - EVM signer config missing `chainId` → `'INVALID_INPUT'`.
- **AC-5 / AC-8 / T-048 expanded (1):** 5 accumulated EVM claims from ONE session (monotonic nonces 1..5, monotonic cumulative amounts) → `result.bundles.length === 1`, `bundle.claimsMerged === 5`, `bundle.selectedClaimIndex === 4`, `bundle.cumulativeAmount === '<5th claim's cumulative>'` (NOT the sum — guards against double-count).
- **AC-8 / T-051 multi-session same-channel (1):** 3 claims from session A (nonces 1..3) + 2 claims from session B (nonces 4..5, continuing monotonic) → `result.bundles.length === 1`, winner is nonce=5 claim, `claimsMerged === 5`.
- **AC-8 multi-channel (1):** 3 claims on channel A + 3 claims on channel B (same chain, same Mill) → `result.bundles.length === 2`, each with its own winner.
- **AC-8 multi-chain (1):** 3 EVM claims + 3 Solana claims → `result.bundles.length === 2`, one per chain; `bundles[0].unsignedTxBytes` starts with EVM function selector, `bundles[1].unsignedTxBytes` is Solana Message format (different prefix).
- **AC-5 step 3 invariants (4 — all throw):**
  - Two claims same `(chain, channelId)` with same `nonce` → `'DUPLICATE_NONCE'`.
  - Two claims same channel, strict decrease in `cumulativeAmount` with increasing nonce → `'NON_MONOTONIC_CUMULATIVE'` (with offending nonce pair in `details`).
  - Two claims same channel, non-decreasing cumulative with equality (heartbeat) → **does NOT throw** (AC-5 rule).
  - Two claims same channel, differing `recipient` → `'RECIPIENT_MISMATCH'`.
  - Two claims same channel, differing `millSignerAddress` → `'MILL_SIGNER_MISMATCH'`.
- **AC-5 / T-052 tampered claim (1):** 3 claims; flip one byte in `claims[1].claimBytes` → `result.rejected.length === 1`, `rejected[0].reason === 'SIGNER_MISMATCH'` (or `'SIGNATURE_INVALID'`), `result.bundles[0].claimsMerged === 2`, winner is the higher-nonce survivor.
- **AC-5 all-fail group (1):** 3 claims ALL with tampered signatures → `result.rejected.length === 3`, `result.bundles.length === 0` (empty, not an error).
- **AC-5 `verifySignatures: false` bypass (1):** tampered signatures included without verification; `result.rejected.length === 0`, bundle built from all claims.
- **AC-5 `includeSuperseded: true` (1):** 5 claims in one group → winner is nonce=5; `result.superseded.length === 4` containing claims with nonces 1..4.
- **AC-5 `includeSuperseded: false` (default) (1):** same input → `result.superseded.length === 0`.
- **AC-10 `verifyAccumulatedClaim` happy path (1):** Real-signer claim → `{ valid: true }`.
- **AC-10 `verifyAccumulatedClaim` tampered (1):** Tampered claim → `{ valid: false, reason: /SIGNATURE|SIGNER/ }`.
- **AC-10 `verifyAccumulatedClaim` Solana (1):** Real Solana signer claim → `{ valid: true }`.

**RED marker:** imports fail; even after source exists, assertions fail until the algorithm is implemented in AC-5 order.

---

### File 6 — `types.test.ts` (AC-1, AC-2)

Thin file asserting the **public export surface** and the `SettlementBundle` shape invariants as type-level tests (using `vitest`'s `expectTypeOf` or structural runtime checks).

**Groups:**
- **AC-1 module index (2):** `import { buildSettlementTx, verifyAccumulatedClaim, fillEvmSettlementTxGas, SettlementTxError } from '@toon-protocol/sdk'` — all defined; no internal helpers leak (`recoverEvmSignerAddress`, `verifyEd25519Signature`, `balanceProofHashEvm` are NOT on the index export).
- **AC-2 `SettlementBundle` shape (2):** Cast a runtime object; assert keys `chain`, `chainKind`, `channelId`, `cumulativeAmount`, `nonce`, `recipient`, `millSignerAddress`, `unsignedTxBytes`, `expectedEventSignature?`, `claimsMerged`, `selectedClaimIndex`, `sourceChain`, `sourceAssetCode` present; `chainKind` narrow union `'evm' | 'solana' | 'mina'`.

---

### File 7 — `verify.test.ts` (AC-10) — OPTIONAL if split

If `verifyAccumulatedClaim` lives in its own file rather than `build-settlement-tx.ts`, move its 3 tests here. Otherwise merge into File 5.

---

### Regression additions to existing test files

**`packages/sdk/src/swap-handler.test.ts` — AC-3 (5 new cases):**
- Existing regression from 12.5 Pass #1 (`targetAmount` emit assertion) is PRESERVED.
- NEW: with a real `MultiChainClaimIssuer` config containing `signerAddresses: { 'evm:8453': '0xabc...' }` and a reservation with `channelId=0x01...`, `nonce=1n`, `cumulativeAmount=1000n`, `senderPubkey=0xdef...`, assert the emitted base64→JSON metadata contains:
  - `channelId === '0x01...'` (lowercase, 66 chars for EVM),
  - `nonce === '1'` (decimal string),
  - `cumulativeAmount === '1000'`,
  - `recipient === '0xdef...'` (lowercase, 42 chars for EVM),
  - `millSignerAddress === '0xabc...'`.
- NEW: Solana chain (`'solana:mainnet'`) → `channelId` is base58 32-byte, `recipient`/`millSignerAddress` base58.

**`packages/sdk/src/stream-swap.test.ts` — AC-3 (7 new cases):**
- `decodeFulfillMetadata` accepts valid EVM payload with all 9 fields → returns typed object with 5 new fields.
- `decodeFulfillMetadata` accepts valid Solana payload.
- Missing `channelId` → `StreamSwapError('FULFILL_DECODE_FAILED')` with `/channelId/i` in message.
- Malformed EVM `channelId` — 3 parameterized cases: uppercase hex; missing `0x` prefix; wrong length (63 chars).
- Malformed Solana `channelId` — base58 decode fails; base58 decodes but length ≠ 32.
- End-to-end: run `streamSwap()` against a MockMill that emits metadata with the 5 new fields → `result.claims[i].channelId` / `.nonce` / `.cumulativeAmount` / `.recipient` / `.millSignerAddress` all populated correctly.

**`packages/mill/src/claim-issuer.test.ts` — AC-3 (2 new cases):**
- `MultiChainClaimIssuer` constructed with `signerAddresses: Record<string, string>` → `issueClaim()` returns `{ ..., channelId, nonce, cumulativeAmount, recipient, millSignerAddress }` populated from the reservation and config.
- `signerAddresses` map missing entry for the requested chain → **throws or records** (dev picks semantics; ATDD test asserts one of: throws `UNSUPPORTED_CHAIN` OR result includes a sentinel error).

**`packages/sdk/src/index.test.ts` — AC-1, AC-15 (4 new cases):**
- Runtime re-export presence for `buildSettlementTx`, `fillEvmSettlementTxGas`, `verifyAccumulatedClaim`, `SettlementTxError`.

---

### Initial Test Run (expected)

```
pnpm --filter @toon-protocol/sdk test src/settlement/

FAIL  src/settlement/hashes.test.ts
  × Cannot find module './hashes' from 'src/settlement/hashes.test.ts'
FAIL  src/settlement/evm.test.ts
  × Cannot find module './evm'
FAIL  src/settlement/solana.test.ts
  × Cannot find module './solana'
FAIL  src/settlement/mina.test.ts
  × Cannot find module './mina'
FAIL  src/settlement/build-settlement-tx.test.ts
  × Cannot find module './build-settlement-tx'
FAIL  src/settlement/types.test.ts
  × Cannot find module '..' (SettlementTxError export missing)

Test Files  6 failed
Tests       ~51 total, all failing (module-not-found / assertion)

# Regression files compile (source still present) but fail new cases:
FAIL  src/swap-handler.test.ts — 5 new metadata-field assertions (not yet emitted)
FAIL  src/stream-swap.test.ts — 7 new decodeFulfillMetadata cases (strict validators absent)
```

**Expected failure categories:**
1. **Module-not-found** — all new test files until source stubs exist.
2. **Export-surface** — `SettlementTxError`, `buildSettlementTx`, etc. missing from `packages/sdk/src/index.ts`.
3. **Assertion failures** — once modules exist, algorithm not implemented → bundle-shape / algorithm assertions fire.
4. **Cross-package parity** — `hashes.test.ts` parity fails until mill-side refactor imports from sdk.

---

## Data Factories / Fixtures

### `makeEvmClaim(opts)` — inline factory in `evm.test.ts` and `build-settlement-tx.test.ts`

Real-crypto factory:
- Instantiates `EvmPaymentChannelSigner` from `@toon-protocol/mill/src/payment-channel-signer` (32-byte fixed private key for determinism).
- Derives EVM address = `'0x' + keccak_256(uncompressedPubkey.slice(1)).slice(-40)` (lowercase).
- Accepts `{ channelId?, cumulativeAmount, nonce, recipient?, pair?, tamperByte? }`.
- Calls `signer.signBalanceProof({ channelId, cumulativeAmount, nonce, recipient })` → 65-byte signature.
- Returns `AccumulatedClaim` with `claimBytes = signature`, `targetAmount = cumulativeAmount`, `pair = <samplePair>`, and the 5 new fields populated. Optional `tamperByte` flips one byte post-sign.

### `makeSolanaClaim(opts)` — parallel factory in `solana.test.ts`

Same pattern with `SolanaPaymentChannelSigner` + Ed25519. Base58 addresses. 64-byte signature.

### `samplePair(chain)` — inline

Returns `SwapPair` keyed by chain string (`evm:8453`, `solana:mainnet`, etc.). Re-uses the 12.5 `samplePair()` pattern.

### Golden vectors — `HASHES_GOLDEN_VECTORS` constant

Defined once in `hashes.test.ts`, exported as a `@fixture` for cross-package parity. 3 EVM + 2 Solana. Fixed inputs + expected 32-byte hex outputs computed once by the dev agent during GREEN and pasted back.

**Intentionally deferred to GREEN:** the exact golden output hex strings. During RED, the test asserts **parity between sdk and mill implementations** (both produce the same output), not against a specific hex constant. Dev agent fills in the constants during GREEN as a regression anchor.

No separate `tests/support/factories/*.ts` — unit-scope, per SDK convention.

---

## Mock Requirements

### Real `EvmPaymentChannelSigner` / `SolanaPaymentChannelSigner`

**Per 12.2 precedent, real crypto is used in unit tests — no stubs on signer paths.** The sdk test imports from `@toon-protocol/mill/src/payment-channel-signer`. Dep direction check: the **test** (not the runtime module) imports mill — this does NOT violate AC-6's dep-direction rule (which says `packages/sdk` runtime must not depend on `packages/mill`).

If the dev agent finds the test-time import triggers a workspace cycle, the fallback is:
- Copy the signer-init boilerplate inline into the test file (10–20 LOC).
- OR expose a `@toon-protocol/mill/testing` sub-path export for test harnesses only.

### MockMill reservation shape (for `claim-issuer.test.ts` additions)

Minimal — assert the existing `reservation` object already carries `channelId`, `cumulativeAmount`, `nonce`, and `senderPubkey`. If it doesn't, dev agent extends `MillChannelState.reserve()` return type as part of AC-3 Task 1.

### Anvil / Docker E2E

**Out of scope.** Story 12.8 provides Anvil-backed end-to-end (T-050).

---

## Required data-testid Attributes

**N/A** — backend library, no UI surface.

---

## Implementation Checklist

Maps RED-phase failing tests → GREEN-phase implementation tasks. Tracks Story 12.6 Tasks 1–10 verbatim.

### Task 1 — FULFILL metadata extension — Mill side (AC: 3)

**Files:** `packages/sdk/src/swap-handler.ts`, `packages/mill/src/claim-issuer.ts`, regression tests.

- [ ] Extend `IssueClaimResult` with `channelId`, `nonce: bigint`, `cumulativeAmount: bigint`, `recipient: string`, `millSignerAddress: string`.
- [ ] Thread through `MultiChainClaimIssuer.issueClaim` — draw from `reservation`; pull `millSignerAddress` from new `MultiChainClaimIssuerConfig.signerAddresses: Record<string, string>`.
- [ ] Update `packages/sdk/src/swap-handler.ts` metadata emit (lines 491–498) — add the 5 new decimal/hex-string fields. BigInt → `.toString()` (never `Number()`).
- [ ] Add `TODO(12.7)` comment at the new config point tagging Story 12.7's `startMill()` wiring.
- [ ] Run: `pnpm --filter @toon-protocol/mill test -t 'claim-issuer'` and `pnpm --filter @toon-protocol/sdk test -t 'swap-handler'`.
- [ ] ✅ AC-3 mill-side tests green.

**Estimated effort:** 1.5h.

### Task 2 — FULFILL metadata extension — SDK parse side (AC: 3)

**Files:** `packages/sdk/src/stream-swap.ts`, regression tests.

- [ ] Extend `AccumulatedClaim` with 5 new `?:` fields (preserves `@stable`).
- [ ] Extend `decodeFulfillMetadata` with strict per-chain validators:
  - EVM: `channelId /^0x[0-9a-f]{64}$/`, `recipient`/`millSignerAddress /^0x[0-9a-f]{40}$/`.
  - Solana: base58 decode + length 32 for `channelId` / `recipient` / `millSignerAddress`.
  - `nonce`/`cumulativeAmount` reuse `/^(0|[1-9]\d*)$/`.
- [ ] Thread the 5 new fields from parsed metadata into `AccumulatedClaim` construction inside `runLoop`.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'decodeFulfillMetadata'`.
- [ ] ✅ AC-3 sdk-side tests green.

**Estimated effort:** 1.5h.

### Task 3 — Shared balance-proof hashes + mill refactor (AC: 6)

**Files:** `packages/sdk/src/settlement/hashes.ts` (new), `packages/sdk/src/settlement/hashes.test.ts` (new), `packages/mill/src/payment-channel-signer.ts` (refactor).

- [ ] Create `hashes.ts` with `balanceProofHashEvm` + `balanceProofHashSolana` **copied verbatim** from `packages/mill/src/payment-channel-signer.ts` lines 80–110 (plus `concat`/`bigintToBytes32BE` helpers).
- [ ] Fill in the golden-vector hex constants once, paste into `HASHES_GOLDEN_VECTORS`.
- [ ] Delete the local copies from `packages/mill/src/payment-channel-signer.ts` and import from `@toon-protocol/sdk` (public export).
- [ ] Run: `pnpm --filter @toon-protocol/mill test` — must stay green with **zero test-count delta** (pre- vs post-refactor).
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'hashes'` — golden-vector + cross-package parity green.
- [ ] ✅ AC-6 tests green.

**Estimated effort:** 1.5h.

### Task 4 — Types, errors, public surface (AC: 1, 2, 4, 11)

**Files:** `packages/sdk/src/settlement/types.ts` (new), `packages/sdk/src/errors.ts` (append), `packages/sdk/src/settlement/index.ts` (new), `packages/sdk/src/index.ts` (append), `packages/sdk/src/index.test.ts` (append).

- [ ] Define `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig` in `types.ts` with `@stable` JSDoc.
- [ ] Append `SettlementTxError` to `errors.ts` — mirror `StreamSwapError` shape exactly.
- [ ] Create `settlement/index.ts` re-exporting public surface only (no internal helpers).
- [ ] Append sdk `index.ts` exports after the stream-swap block.
- [ ] Add runtime export assertions to `index.test.ts`.
- [ ] ✅ AC-1, AC-2, AC-4 (shape), AC-11 tests green.

**Estimated effort:** 1h.

### Task 5 — EVM tx encoding + verification (AC: 7)

**Files:** `packages/sdk/src/settlement/evm.ts` (new), `packages/sdk/src/settlement/evm.test.ts`.

- [ ] Grep `../connector/packages/contracts/src/` for the real `updateBalance` function selector + event signature. Record in module-init constants `EVM_SETTLEMENT_FUNCTION_SELECTOR` and `EVM_SETTLEMENT_EVENT_SIGNATURE` with source-path comments. Fallback: `'updateBalance(bytes32,uint256,uint256,address,bytes)'` + `TODO(12.6 follow-up)` marker.
- [ ] Implement `recoverEvmSignerAddress(claim)` using `@noble/curves/secp256k1.js`:
  - 65-byte length gate → `SettlementTxError('INVALID_SIGNATURE_LENGTH')`.
  - `v ∈ {27, 28}` gate → `'INVALID_SIGNATURE_V'`.
  - `secp256k1.Signature.fromBytes(rs, 'compact').addRecoveryBit(v-27).recoverPublicKey(msgHash).toRawBytes(false).slice(1)` → `keccak_256` → `.slice(-20)` → hex + `0x`.
- [ ] Implement minimal inline ABI encoder for `(bytes32, uint256, uint256, address, bytes)` — 32-byte slots + offset/length for dynamic `bytes`.
- [ ] Implement minimal RLP encoder for EIP-155 unsigned tx `[nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]`.
- [ ] Implement `buildEvmSettlementTx(winner, signer, recipient)` — assemble the `SettlementBundle` including `unsignedTxBytes` with placeholder gas.
- [ ] Export `fillEvmSettlementTxGas(bundle, { nonce, gasPrice, gasLimit })` as the caller-side gas-fill utility.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'evm'`.
- [ ] ✅ AC-7, T-048, T-049 tests green.

**Estimated effort:** 4h.

### Task 6 — Claim grouping + winner selection (AC: 5, 8)

**Files:** `packages/sdk/src/settlement/build-settlement-tx.ts` (new), `packages/sdk/src/settlement/build-settlement-tx.test.ts`.

- [ ] Implement `buildSettlementTx(params)`:
  1. Synchronous validation per AC-4.
  2. Verify each claim (dispatch by `pair.to.chain` kind); failed → `rejected[]`.
  3. Group by `(chain, channelId)`; assert recipient / millSigner / nonce-uniqueness / cumulative-monotonicity within each group (throw codes per AC-11).
  4. Pick highest-nonce winner per group.
  5. Dispatch to `buildEvmSettlementTx` / `buildSolanaSettlementTx` / Mina stub.
  6. Assemble `BuildSettlementTxResult` with `bundles`, `rejected`, optional `superseded`.
- [ ] Implement `verifyAccumulatedClaim(claim, signer)` — pre-check a single claim.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'build-settlement-tx|verifyAccumulatedClaim'`.
- [ ] ✅ AC-5, AC-8, AC-10, T-048 (expanded), T-051, T-052 tests green.

**Estimated effort:** 3h.

### Task 7 — Solana + Mina (AC: 9)

**Files:** `packages/sdk/src/settlement/solana.ts` (new), `packages/sdk/src/settlement/solana.test.ts`, `packages/sdk/src/settlement/mina.ts` (new), `packages/sdk/src/settlement/mina.test.ts`.

- [ ] Add `@scure/base` to sdk `package.json` (`pnpm --filter @toon-protocol/sdk add @scure/base`). Verify zero-transitive bloat.
- [ ] Implement `verifyEd25519Signature(claim, expectedSignerAddress)` via `@noble/curves/ed25519.js` `ed25519.verify`.
- [ ] Grep `../connector/packages/solana-program/` for real discriminator; fallback `sha256('global:update_balance').slice(0,8)` + TODO.
- [ ] Implement `buildSolanaSettlementTx` — serialize legacy `Message` with 4 accounts + instruction data.
- [ ] Implement Mina stub in `mina.ts` — single throw.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'solana|mina'`.
- [ ] ✅ AC-9, T-053, T-054 tests green.

**Estimated effort:** 2.5h.

### Task 8 — `verifyAccumulatedClaim` utility (AC: 10)

Covered by Task 6 if merged; otherwise split into its own file + test.

**Estimated effort:** 0.5h (if split).

### Task 9 — Documentation (AC: 14)

- [ ] Comprehensive JSDoc on every exported symbol — `@stable`, `@since 12.6`, `@see` cross-links, code examples. Minimum one end-to-end `streamSwap → buildSettlementTx → eth_sendRawTransaction` pseudocode block in `buildSettlementTx`'s JSDoc.

**Estimated effort:** 1h.

### Task 10 — Verification (AC: 12, 13, 15)

- [ ] `pnpm --filter @toon-protocol/sdk build` — tsup green.
- [ ] `pnpm --filter @toon-protocol/sdk test` — all green (~68 tests delta).
- [ ] `pnpm --filter @toon-protocol/sdk lint` — 0 errors.
- [ ] `pnpm --filter @toon-protocol/mill build` — green post-refactor.
- [ ] `pnpm --filter @toon-protocol/mill test` — green, zero test-count delta.
- [ ] `pnpm --filter @toon-protocol/mill lint` — 0 errors.
- [ ] `pnpm --filter @toon-protocol/client build` — green (unchanged surface).
- [ ] Dep-direction grep: `grep -rn "@toon-protocol/mill" packages/sdk/src/` → 0 matches **in runtime files** (matches in test files OK).
- [ ] No-`any` grep: `grep -rnE '(@ts-ignore|@ts-expect-error|: any|<any>)' packages/sdk/src/settlement/ packages/sdk/src/stream-swap.ts packages/sdk/src/swap-handler.ts packages/sdk/src/errors.ts` → 0 matches OR each has inline `eslint-disable-next-line` rationale.
- [ ] `pnpm --filter @toon-protocol/sdk list @scure/base` — present (optional runtime dep added in Task 7).
- [ ] Do NOT run `pnpm test` at workspace root (CLAUDE.md memory rule).
- [ ] ✅ AC-12, AC-13, AC-15 gates green.

**Estimated effort:** 0.5h.

**Total estimated effort:** ~16h.

---

## Running Tests

```bash
# Run all new settlement tests
pnpm --filter @toon-protocol/sdk test src/settlement/

# Run specific AC group
pnpm --filter @toon-protocol/sdk test -t 'AC-6'
pnpm --filter @toon-protocol/sdk test -t 'T-048'
pnpm --filter @toon-protocol/sdk test -t 'T-049'

# Debug a single test (vitest inspector)
pnpm --filter @toon-protocol/sdk exec vitest --inspect-brk -t 'round-trip'

# Regression files
pnpm --filter @toon-protocol/sdk test src/swap-handler.test.ts
pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts
pnpm --filter @toon-protocol/mill test src/claim-issuer.test.ts
pnpm --filter @toon-protocol/mill test src/payment-channel-signer.test.ts

# Full story verification (Task 10)
pnpm --filter @toon-protocol/sdk build \
  && pnpm --filter @toon-protocol/sdk test \
  && pnpm --filter @toon-protocol/sdk lint \
  && pnpm --filter @toon-protocol/mill build \
  && pnpm --filter @toon-protocol/mill test \
  && pnpm --filter @toon-protocol/mill lint \
  && pnpm --filter @toon-protocol/client build
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ 51 new failing tests specified across 6 new test files in `packages/sdk/src/settlement/`.
- ✅ 14 new failing tests specified across 4 existing test files (swap-handler, stream-swap, claim-issuer, sdk index).
- ✅ Real-crypto factories (`makeEvmClaim`, `makeSolanaClaim`) defined inline — no stubs on signer paths (per 12.2 precedent).
- ✅ Golden-vector cross-package parity fixture (`HASHES_GOLDEN_VECTORS`) defined as the R-004 safety net.
- ✅ All failing tests have deterministic failure modes: module-not-found cascades into assertion failures.
- ✅ Mock requirements documented (none required beyond real signers).
- ✅ No data-testid attributes required (backend-only).
- ✅ Implementation checklist maps 1:1 to Story 12.6 Tasks 1–10.

**Verification:** test files cannot run green until `settlement/*.ts` source files exist AND AC-3 metadata extension lands AND AC-6 hash-refactor completes.

### GREEN Phase (DEV Team — Next)

Recommended order (matches dependency graph):
1. **Task 4** — types + errors + public-surface stubs (unblocks compilation of all settlement test files).
2. **Task 1** — FULFILL mill-side metadata (unblocks `claim-issuer.test.ts` + `swap-handler.test.ts` regressions).
3. **Task 2** — FULFILL sdk-side parse (unblocks `stream-swap.test.ts` regressions; seeds `AccumulatedClaim` with settlement fields).
4. **Task 3** — shared hashes + mill refactor (unblocks `hashes.test.ts` + underpins `evm.ts` / `solana.ts`).
5. **Task 5** — EVM encoding + recovery (unblocks `evm.test.ts` + T-048, T-049).
6. **Task 7** — Solana + Mina stubs (unblocks `solana.test.ts`, `mina.test.ts`).
7. **Task 6** — algorithm + grouping (unblocks `build-settlement-tx.test.ts` + T-051, T-052).
8. **Task 8** — `verifyAccumulatedClaim` (if split).
9. **Task 9** — JSDoc.
10. **Task 10** — verification gates.

### REFACTOR Phase (DEV Team — after Green)

- Consider exposing `__internals` symbol for `recoverEvmSignerAddress` / `verifyEd25519Signature` if tests prove flaky via the `buildSettlementTx` top-level path. Preferred: keep helpers private and test indirectly.
- Post-commit grep: `grep -rn "balanceProofHashEvm\|balanceProofHashSolana" packages/mill/src/` should return zero hits in `payment-channel-signer.ts` (refactor confirmation).
- If `@scure/base` is rejected by workspace policy, replace with a 40-line hand-rolled base58 codec inline — covered by existing Solana tests.
- If the real `updateBalance` selector differs from the default, update `EVM_SETTLEMENT_FUNCTION_SELECTOR` and re-run `evm.test.ts` — T-048 selector assertion will catch drift immediately.

---

## Notes

- **Dev agent autonomy:** Golden-vector hex constants in `HASHES_GOLDEN_VECTORS` are intentionally left blank in RED. Dev agent computes them during GREEN by running the sdk-side helpers with fixed inputs and pasting the resulting hex. Cross-package parity test then anchors both sdk + mill against those constants.
- **Epic 11 + 12.5 retros carry forward:**
  - bigint-only arithmetic for `cumulativeAmount` / `nonce` / `chainId` through hashing + RLP + ABI encoding. No `Number()` coercion (except `signer.chainId` within MAX_SAFE_INTEGER per AC-7 dev note).
  - Real crypto in tests (no signer stubs) — inherited from 12.2.
  - Zero `@ts-ignore` / `any` discipline on public surface — grep-gated per AC-13.
  - Zero new runtime deps (`@scure/base` is the single permitted addition, already transitively present via `nostr-tools`).
- **Stable contracts:** `SettlementBundle`, `BuildSettlementTxResult`, `AccumulatedClaim` extensions, `buildSettlementTx`, `fillEvmSettlementTxGas`, `verifyAccumulatedClaim` carry `@stable` JSDoc — Epic 13 Chain Bridge DVM depends on these shapes.
- **Dep direction guardrail:** `packages/sdk` runtime files MUST NOT import from `packages/mill`. The AC-6 refactor preserves this (mill imports from sdk). Test-time imports from `@toon-protocol/mill/src/payment-channel-signer` are permitted to keep real crypto in unit tests.
- **Semgrep / Write-tool advisory:** expect the `SEMGREP_APP_TOKEN` advisory on tool invocations — not a rule violation, does not block the checklist.
- **T-050 (on-chain settlement on Anvil) is explicitly deferred to Story 12.8** per story Dependencies section. RED-phase does NOT attempt to spin up Anvil from unit tests.
- **AC-6 refactor risk:** if mill tests exhibit any delta (test count OR pass/fail), HALT GREEN and investigate before proceeding. Byte-identical parity is non-negotiable for R-004.

---

## Knowledge Base References Applied

- `test-levels-framework.md` — Unit level chosen; E2E at T-050 owned by Story 12.8.
- `test-priorities-matrix.md` — P0/P1/P2 inherited from `test-design-epic-12.md` § 2.6.
- `data-factories.md` — `makeEvmClaim` / `makeSolanaClaim` / `HASHES_GOLDEN_VECTORS` as inline factories + fixture constant (SDK convention).
- `test-quality.md` — AAA pattern; one invariant per test; frozen `SettlementBundle` (dev may `Object.freeze` per 12.5 precedent on `AccumulatedClaim`).
- `test-healing-patterns.md` — `tamperByte` option on claim factories lets every test exercise the rejection path without dedicated fixture sprawl.
- `component-tdd.md` — per-module `.test.ts` co-location for each of the 6 settlement source modules.
- `ci-burn-in.md` — no perf/stress suite added (1000+ claim group stress is out of scope).

See `_bmad/tea/testarch/tea-index.csv` for full fragment mapping.

---

## Contact

Questions or issues: ping the TEA agent in channel, or see `_bmad/tea/workflows/testarch/atdd/instructions.md`.

---

**Generated by BMad TEA Agent** — 2026-04-14
