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
lastSaved: '2026-04-13'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md'
  - '_bmad-output/planning-artifacts/test-design-epic-12.md'
  - '_bmad-output/implementation-artifacts/12-3-mill-swap-handler.md'
  - 'packages/sdk/src/swap-handler.ts'
  - 'packages/sdk/src/errors.ts'
  - 'packages/sdk/src/index.test.ts'
  - 'packages/sdk/package.json'
  - 'packages/sdk/tsup.config.ts'
  - 'packages/sdk/tsconfig.json'
  - 'packages/sdk/vitest.config.ts'
  - 'packages/core/src/types.ts'
---

# ATDD Checklist — Epic 12, Story 12.4: Mill Inventory + Wallet Management (`MultiChainClaimIssuer`)

**Date:** 2026-04-13
**Author:** Jonathan
**Primary Test Level:** Unit (vitest, co-located in `packages/mill/src/`)
**Mode:** YOLO (autonomous ATDD generation)
**Detected Stack:** backend (TypeScript pnpm workspace, vitest)

---

## Story Summary

A new `@toon-protocol/mill` workspace package that implements Epic 12's outbound-asset side: BIP-44 key derivation (account index 2) for EVM / Mina / Solana from the node's mnemonic, in-memory per-pair inventory accounting, per-channel nonce + cumulativeAmount tracking, and a `MultiChainClaimIssuer` that implements Story 12.3's `ClaimIssuer` interface — atomic debit-then-sign under concurrent load, with `INSUFFICIENT_INVENTORY` surfacing as the handler's T04 reject and any other wallet error as T00.

**As a** TOON Protocol developer building the Token Swap Primitive (Epic 12)
**I want** a concrete `MultiChainClaimIssuer` in `@toon-protocol/mill` wired to per-chain `PaymentChannelSigner` wallets and a `MillInventory` tracker
**So that** a Mill operator can `createSwapHandler({ claimIssuer: new MultiChainClaimIssuer(...) })` and close the outbound-asset loop of the swap protocol with deterministic key derivation, transactional reserves, and microtask-atomic concurrent issuance

---

## Acceptance Criteria (12 total, mapped to tests below)

1. **AC-1** — `packages/mill/` scaffold (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`) mirroring `packages/sdk`.
2. **AC-2** — `MillInventoryError` + `MillWalletError` with `readonly code` literal unions.
3. **AC-3** — `deriveMillKeys(mnemonic, chains, { accountIndex=2, addressIndex=0, passphrase='' })` pure helper.
4. **AC-4** — `MillInventory` in-memory tracker with synchronous `debit` / `credit` / `snapshot`.
5. **AC-5** — `PaymentChannelSigner` interface + three concrete impls (`EvmPaymentChannelSigner`, `MinaPaymentChannelSigner`, `SolanaPaymentChannelSigner`).
6. **AC-6** — `MultiChainClaimIssuer.issueClaim` — debit-FIRST, then reserve-nonce, then sign; signing failure → credit/release reversal + `SIGNING_FAILED`.
7. **AC-7** — `MillChannelState` with synchronous `reserve` / `release` / `get`; missing channel → `UNSUPPORTED_CHAIN`.
8. **AC-8** — Concurrent `Promise.all` `issueClaim` calls are serialized by Node microtask atomicity.
9. **AC-9** — Exports from `packages/mill/src/index.ts` per documented layered block.
10. **AC-10** — Structural compatibility: `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` type-checks; runtime integration test (T-int-1) wires `createSwapHandler`.
11. **AC-11** — ≥ 26 unit tests across the six `.test.ts` files.
12. **AC-12** — `pnpm --filter @toon-protocol/mill build|test` green; SDK/core regressions = 0.

---

## Step 1 — Preflight & Context

### Stack Detection

`test_stack_type` = `auto` → **backend**. Justification:

- Story scope is `packages/mill/` (pure TypeScript module; no browser surface).
- `ui_impact: false` in the story front-matter.
- No `page.goto` / `page.locator` references anywhere under `packages/mill/`.
- Tests co-located with source per the SDK precedent (`packages/sdk/src/*.test.ts`), vitest 1.x (ESM).
- No Playwright/Cypress config needed.

### Prerequisites

- [x] Story approved — status `ready-for-dev`, 12 ACs, 9 tasks.
- [x] Test framework configured — `packages/mill/vitest.config.ts` created as part of this workflow (mirrors `packages/sdk/vitest.config.ts`).
- [x] Dev environment available — pnpm 8.15.0, Node ≥ 20.
- [x] Upstream dependencies landed: Story 12.1 (SwapPair), 12.2 (gift-wrap), 12.3 (`ClaimIssuer` interface) — all DONE.

### TEA Config Flags

- `tea_use_playwright_utils: true` — not applicable (backend, no browser).
- `tea_use_pactjs_utils: true` — not applicable (pure unit tests; no consumer-driven contract surface in this story).
- `tea_pact_mcp: mcp` — not applicable.
- `tea_browser_automation: auto` — not applicable.
- `test_stack_type: auto` — resolved to `backend`.

### Knowledge Base Fragments Consulted

- **Core tier (always loaded):** `data-factories.md`, `test-quality.md`, `test-healing-patterns.md`.
- **Backend tier:** `test-levels-framework.md`, `test-priorities-matrix.md`.
- **Not loaded (out of scope):** `selector-resilience.md`, `timing-debugging.md`, `fixture-architecture.md`, `network-first.md`, Playwright Utils profiles, Pact.js utils (no contract boundaries here — `ClaimIssuer` is an intra-workspace type interface, validated via structural type-assignment rather than Pact).

### Inputs Loaded

- Story markdown: `_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md` (548 lines, 12 ACs + 9 tasks).
- Test design: `_bmad-output/planning-artifacts/test-design-epic-12.md` — T-026, T-029, T-030, T-031, T-032, T-033, T-034, T-035, T-037 map here.
- Upstream story: `_bmad-output/implementation-artifacts/12-3-mill-swap-handler.md` (AC-9 reject-code detection).
- SDK type surface: `packages/sdk/src/swap-handler.ts` (`ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`).
- SDK scaffolding mirrors: `packages/sdk/{package.json,tsup.config.ts,tsconfig.json,vitest.config.ts,src/index.test.ts,src/errors.ts}`.
- Core types: `packages/core/src/types.ts` (`SwapPair`).

---

## Step 2 — Generation Mode

**Chosen mode: AI Generation (single-package backend unit ATDD).**

Rationale:

- Acceptance criteria are extremely precise (12 ACs, explicit error-code literals, load-bearing `INSUFFICIENT_INVENTORY` integration contract, golden-vector mnemonic).
- No UI, no browser recording, no Playwright/Cypress infrastructure needed.
- The step-04 "parallel API + E2E subprocess split" does not apply to a pure-unit backend story — same exception as Story 12.3. The aggregation step (04C) is still performed (test file write + TDD-phase validation), just with a single synchronous generator rather than two subprocesses.
- Browser-automation path (step-02 section 2) is explicitly skipped: backend stack → always AI generation.

---

## Step 3 — Test Strategy

### Test Level Selection (AC → level)

| AC | Level | Rationale |
| --- | --- | --- |
| AC-1 scaffold | (implicit) | Validated by `pnpm --filter @toon-protocol/mill build` green in AC-12, not by an assertion. |
| AC-2 errors | **Unit** | Error class code/name assertions in `wallet.test.ts` + `inventory.test.ts`. |
| AC-3 `deriveMillKeys` | **Unit** | Pure function, deterministic, golden-vector pinning. |
| AC-4 `MillInventory` | **Unit** | Synchronous state machine; concurrent race via `Promise.all`. |
| AC-5 three signers | **Unit** | Round-trip derive→sign→verify using `@noble/curves` / `mina-signer`. |
| AC-6 `issueClaim` orchestration | **Unit** + **Integration-within-workspace** | Mock signer for pure orchestration tests; one test (T-int-1) wires the real `@toon-protocol/sdk` `createSwapHandler` to validate structural + runtime compatibility. |
| AC-7 `MillChannelState` | **Unit** | Synchronous nonce bookkeeping; concurrent race. |
| AC-8 concurrent safety | **Unit** | Covered by T-inv-1 (inventory), T-cs-1 (channel state), T-026 (claim-issuer end-to-end). |
| AC-9 exports | **Unit** | `index.test.ts` mirrors `packages/sdk/src/index.test.ts`. |
| AC-10 `ClaimIssuer` compatibility | **Unit** (type-assignment) + **Integration** (T-int-1) | `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` + runtime wire-up. |
| AC-11 test count | — | Enumerated below (≥ 26). |
| AC-12 CI green | — | Not a test — a build/lint verification gate. |

### Priority Distribution (P0–P3)

**P0 (blocking correctness):**

- T-029 / T-030 / T-031 — BIP-44 account-index-2 isolation for EVM/Mina/Solana (D12-010 protocol invariant).
- T-032 — derivation determinism.
- T-033 — debit decreases `available`.
- T-034 — insufficient inventory throws with transactional rollback.
- T-037 — credit increases both counters.
- T-035 — EVM signer round-trip.
- T-inv-1 — concurrent debit race (microtask atomicity).
- T-cs-1 — concurrent reserve race.
- T-026 — 10-concurrent `issueClaim` integration property.
- AC-10 structural compatibility.
- T-int-1 — end-to-end with `createSwapHandler`.
- Debit-before-sign ordering (AC-6 step 2).
- Insufficient-inventory does NOT call signer.
- Unsupported-chain does NOT debit.

**P1 (important edges):**

- Invalid mnemonic → `INVALID_MNEMONIC`.
- Passphrase changes keys.
- Uninitialized pair debit → `INVENTORY_NOT_INITIALIZED`.
- Non-positive debit amount rejected.
- Reserve on missing channel → `UNSUPPORTED_CHAIN`.
- `release` reverses reservation.
- Signer throw → issuer reverses debit, wraps as `SIGNING_FAILED`.
- Malformed EVM recipient → `SIGNING_FAILED`.
- Mina/Solana round-trips.

**P2 (defensive / exports):**

- Empty chains array no-op.
- `snapshot()` deep-copy isolation.
- `MillWalletError.code` + `cause` ES2022 passthrough.
- All 10 `index.test.ts` runtime-symbol assertions (including negative: no `startMill` export).

### Red Phase Confirmation

Every test uses `test.skip(...)` (actually `it.skip(...)` — vitest / Playwright both honor). None use `expect(true).toBe(true)` placeholders — each assertion targets expected post-implementation behavior. Imports intentionally reference modules that do not yet exist on disk (`@ts-expect-error` comments pin this so a stray implementation landing early surfaces as a TS failure).

---

## Step 4 — Generate Failing Tests (TDD RED)

### Execution mode

Single-generator (non-parallel) per Story 12.3 precedent — parallel API/E2E subprocess split does not apply to a backend pure-unit package. Step-04a / step-04b subprocess invocations are intentionally not launched. Step-04c aggregation is still performed (below).

### Files Created (7 files — 4 scaffold + 6 test; `errors`/`wallet`/etc. implementation source files are NOT created in RED phase)

**Package scaffold (AC-1):**

- `packages/mill/package.json` — `@toon-protocol/mill@0.1.0`, ESM, tsup, deps pinned per story AC-1 (noble-curves/hashes/scure-bip32/scure-bip39/ed25519-hd-key/`@toon-protocol/core`), peer dep `mina-signer >=3.0.0` (optional), dev dep `@toon-protocol/sdk: workspace:*`.
- `packages/mill/tsconfig.json` — extends `../../tsconfig.json`; outDir/rootDir mirror SDK.
- `packages/mill/tsup.config.ts` — ESM, dts, sourcemap, clean — verbatim mirror of `packages/sdk/tsup.config.ts`.
- `packages/mill/vitest.config.ts` — `src/**/*.test.ts`, node env, excludes `node_modules`/`dist`.
- Stale `packages/mill/dist/` removed (was a prior `startMill` pre-scaffold that predated this story).

**Test files (AC-11 — all tests `it.skip(...)`-gated):**

| File | Tests | Priority split | Key T-IDs |
| --- | ---:| --- | --- |
| `packages/mill/src/wallet.test.ts` | 11 | P0×4, P1×3, P2×4 | T-029, T-030, T-031, T-032 |
| `packages/mill/src/inventory.test.ts` | 7 | P0×4, P1×2, P2×1 | T-033, T-034, T-037, T-inv-1 |
| `packages/mill/src/channel-state.test.ts` | 4 | P0×3, P1×1 | T-cs-1 |
| `packages/mill/src/payment-channel-signer.test.ts` | 4 | P0×2, P1×2 | T-035 (+Mina `describe.skipIf(!hasMinaSigner)`) |
| `packages/mill/src/claim-issuer.test.ts` | 8 | P0×7, P1×1 | T-026, T-int-1, AC-10 structural |
| `packages/mill/src/index.test.ts` | 10 | P2×10 | AC-9 exports |
| **Total** | **44** | P0×20, P1×9, P2×15 | — |

44 ≥ 26 required by AC-11. Additional tests cover negative cases and export checks documented in the story but not pinned to a numeric T-ID (defensive boundaries).

### TDD Red Phase Validation (Step 04C inline, since no subprocess temp files)

- [x] Every test in every file uses `it.skip(...)`.
- [x] Zero `expect(true).toBe(true)` placeholders anywhere. The single synthetic-failure guard (`expect(true).toBe(false)` in the T-int-1 placeholder) is intentional: when `.skip` is removed post-implementation, it forces the dev agent to fill in the real assertions or fail loudly — documented inline with "Left as a structural placeholder in RED phase".
- [x] All tests reference source modules that do not yet exist → `@ts-expect-error` on every import ensures the compiler points out every RED entry the dev needs to unblock.
- [x] All assertions express expected post-implementation behavior (error codes, bigint reserves, 65/64-byte signature lengths, concurrent monotonicity, deep-copy isolation).
- [x] No runtime dependency on source modules not yet written — tests fail fast at import time (expected for RED).

---

## Data Factories

Minimal, inlined in test files. No shared factory layer needed at this stage — each test constructs a narrowly-scoped `MillInventory` / `MillChannelState` with 1–2 pre-populated keys. The universal BIP-39 zero-entropy vector

```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
```

is pinned as a `const` in every test file that needs it. **Dev guidance:** when implementing, pin the expected `keys.evm.address` / `keys.mina.publicKey` / `keys.solana.publicKey` at account-index 1 and account-index 2 as string constants inside `wallet.test.ts` (currently they're compared for inequality only — acceptable for RED; tighten to equality against known golden constants once derived locally per Dev Notes in the story).

---

## Fixtures Created

None shared at package scope. Inline per-test fixture helpers only:

- `packages/mill/src/claim-issuer.test.ts::makeMockSigner(chainKind)` — `vi.fn`-backed signer returning fixed bytes.
- `packages/mill/src/claim-issuer.test.ts::makeRumor()` — minimal `UnsignedEvent`-shaped object (handler ignores it).
- `packages/mill/src/channel-state.test.ts::makeProvisioned()` — pre-populated `MillChannelState` for the happy-path cases.

---

## Mock Requirements

- **Signer mock** in `claim-issuer.test.ts`: `vi.fn(async () => Uint8Array)` — returns fixed bytes; supports `mockRejectedValueOnce` for the reversal test.
- **`@toon-protocol/sdk` `createSwapHandler`** in T-int-1: real module, not mocked. The test intentionally exercises the workspace boundary to catch structural drift (this is the whole point of AC-10).
- **`mina-signer`** in `payment-channel-signer.test.ts`: dynamically imported inside a top-level `try/catch`; `describe.skipIf(!hasMinaSigner)` gates the Mina block when the optional peer dep is absent.

---

## Required data-testid Attributes

None — backend package with no UI surface.

---

## Implementation Checklist (TDD GREEN — dev agent next)

Work the list top-to-bottom. Each section maps to the story's Task N.

### Task 2 — Error classes (AC-2)

**File:** `packages/mill/src/errors.ts`

- [ ] Create `MillInventoryError extends Error` with `readonly code: 'INSUFFICIENT_INVENTORY' | 'UNKNOWN_PAIR' | 'INVENTORY_NOT_INITIALIZED'`; constructor sets `this.name`, preserves `cause` (ES2022).
- [ ] Create `MillWalletError extends Error` with `readonly code: 'INVALID_MNEMONIC' | 'UNSUPPORTED_CHAIN' | 'DERIVATION_FAILED' | 'SIGNING_FAILED'`.
- [ ] Run: `pnpm --filter @toon-protocol/mill test -- errors` — expect no standalone errors.test.ts; instead remove `.skip` from wallet/inventory/claim-issuer assertions that touch error classes.

### Task 3 — `deriveMillKeys` (AC-3)

**File:** `packages/mill/src/wallet.ts`

- [ ] Validate mnemonic → `MillWalletError('INVALID_MNEMONIC')`.
- [ ] EVM branch: `@scure/bip32` at `m/44'/60'/N'/0/0` → `@noble/curves/secp256k1` → keccak-256 → last 20 bytes → EIP-55 checksum.
- [ ] Mina branch: try `mina-signer` `Client.deriveKeyFromMnemonic`; fallback to `@scure/bip32` @ `m/44'/12586'/N'/0/0` → handoff to `mina-signer`. Wrap in try/catch → `DERIVATION_FAILED`.
- [ ] Solana branch: `ed25519-hd-key.derivePath("m/44'/501'/N'/0'/0'", seedHex)` → `@noble/curves/ed25519.getPublicKey`.
- [ ] Zero intermediate seed buffers. Remove `.skip` from all 11 tests in `wallet.test.ts`; pin golden addresses as string constants.
- [ ] Run: `pnpm --filter @toon-protocol/mill test -- wallet`.

### Task 4 — `MillInventory` (AC-4)

**File:** `packages/mill/src/inventory.ts`

- [ ] `Map<string, { available, total, updatedAt }>` keyed by `${assetCode}:${chain}`.
- [ ] `debit` synchronous: validate amount > 0n → entry exists → sufficient → decrement.
- [ ] `credit` synchronous: amount > 0n → increment both counters.
- [ ] `snapshot()` returns deep-copied array.
- [ ] Remove `.skip` from 7 tests in `inventory.test.ts`.
- [ ] Run: `pnpm --filter @toon-protocol/mill test -- inventory`.

### Task 6 — `MillChannelState` (AC-7)

**File:** `packages/mill/src/channel-state.ts`

- [ ] `Map<string, ChannelEntry>` keyed by `${assetCode}:${chain}:${senderPubkey}`.
- [ ] `reserve` synchronous: missing → `MillWalletError('UNSUPPORTED_CHAIN')`; existing → nonce++, cumulativeAmount += delta.
- [ ] `release` best-effort reverse (no-op + warn if nonce would go negative).
- [ ] Remove `.skip` from 4 tests in `channel-state.test.ts`.

### Task 5 — Three signers (AC-5)

**File:** `packages/mill/src/payment-channel-signer.ts`

- [ ] `EvmPaymentChannelSigner`: EIP-191/EIP-712 (match connector; AC-5 references `/Users/jonathangreen/Documents/connector/packages/connector/src/settlement/provider/payment-channel-provider.ts` lines 120–150). Return 65 bytes.
- [ ] `MinaPaymentChannelSigner`: `mina-signer.signFields` over Poseidon-hashed field packing; guard with try/catch → `SIGNING_FAILED`.
- [ ] `SolanaPaymentChannelSigner`: `sha256(channelId || cumulativeAmount || nonce || recipient)` → `@noble/curves/ed25519.sign`. Return 64 bytes.
- [ ] Remove `.skip` from 4 tests in `payment-channel-signer.test.ts`. Mina `describe.skipIf(!hasMinaSigner)` remains correct even post-implementation.

### Task 7 — `MultiChainClaimIssuer` (AC-6, AC-8, AC-10)

**File:** `packages/mill/src/claim-issuer.ts`

- [ ] Constructor validates inventory / signers / channelState shapes.
- [ ] `issueClaim`: (1) look up signer → `UNSUPPORTED_CHAIN` else debit SYNCHRONOUSLY, (2) `channelState.reserve` SYNCHRONOUSLY, (3) await sign, (4) on throw: credit + release + re-throw as `SIGNING_FAILED`, (5) return `{ claim, claimId = crypto.randomUUID() }`.
- [ ] Remove `.skip` from 8 tests in `claim-issuer.test.ts`. Fill in the T-int-1 body with a real `createSwapHandler` wire-up (see test comment block).
- [ ] Validate `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` compiles (AC-10).

### Task 9 — Package index (AC-9)

**File:** `packages/mill/src/index.ts`

- [ ] Export layered per AC-9:
  ```ts
  // Wallet + key derivation
  export { deriveMillKeys } from './wallet.js';
  export type { MillKeys, MillChainKind, DeriveMillKeysInput } from './wallet.js';
  // Inventory
  export { MillInventory } from './inventory.js';
  export type { MillInventoryBalance, MillInventoryInit } from './inventory.js';
  // Payment-channel signing
  export type { PaymentChannelSigner, PaymentChannelSignParams } from './payment-channel-signer.js';
  export { EvmPaymentChannelSigner, MinaPaymentChannelSigner, SolanaPaymentChannelSigner } from './payment-channel-signer.js';
  // Channel state
  export { MillChannelState } from './channel-state.js';
  export type { ChannelEntry, MillChannelStateInit, ReserveParams, Reservation } from './channel-state.js';
  // Claim issuer
  export { MultiChainClaimIssuer } from './claim-issuer.js';
  export type { MultiChainClaimIssuerConfig } from './claim-issuer.js';
  // Errors
  export { MillInventoryError, MillWalletError } from './errors.js';
  ```
- [ ] Remove `.skip` from 10 tests in `index.test.ts`.

### Task 9 — Build + CI gate (AC-12)

- [ ] `pnpm install` at repo root (wire workspace link).
- [ ] `pnpm --filter @toon-protocol/mill build` → exit 0; `dist/index.js` + `dist/index.d.ts` present.
- [ ] `pnpm --filter @toon-protocol/mill test` → all 44 tests pass (Mina may skip if peer dep unresolved — acceptable).
- [ ] `pnpm --filter @toon-protocol/sdk test` → no regressions (record baseline count in Dev Agent Record).
- [ ] `pnpm --filter @toon-protocol/core test` → no regressions.
- [ ] `pnpm lint` → 0 errors in `packages/mill` scope.
- [ ] No edits under `packages/sdk`, `packages/core`, `packages/client`, or `../connector`.

---

## Running Tests

```bash
# Full mill package test suite (recommended)
pnpm --filter @toon-protocol/mill test

# Watch mode for TDD green phase
pnpm --filter @toon-protocol/mill test:watch

# Single file
pnpm --filter @toon-protocol/mill test -- inventory

# Coverage (if added later)
pnpm --filter @toon-protocol/mill test -- --coverage
```

**Do NOT run `pnpm test` at the workspace root** — per `CLAUDE.md` it spawns 17 parallel vitest processes and exhausts RAM.

---

## Red-Green-Refactor Workflow

### RED Phase ✅ (this workflow)

- 6 test files written with `it.skip` gating.
- 44 tests covering all 12 ACs.
- Package scaffold (`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`) in place.
- Stale `dist/` from prior `startMill` scaffold removed.

### GREEN Phase (dev agent)

Work the implementation checklist above top-to-bottom. Remove `it.skip` file-by-file as each module lands. Do NOT implement `startMill()` here — that's Story 12.7.

### REFACTOR Phase

After all 44 tests pass:

- Consider extracting `keyPath(chain, accountIndex, addressIndex)` helper if the path strings start sprawling.
- Consider a single `MillError extends ToonError` base that both `MillInventoryError` and `MillWalletError` extend — Story 12.4 doesn't require it, but it would align with the SDK's `ToonError` hierarchy. Do NOT change error `code` strings under any circumstance (`INSUFFICIENT_INVENTORY` is load-bearing).

---

## Key Risks & Assumptions

### R-005 (from test-design-epic-12) — Key derivation drift

Golden-vector mnemonic and pinned EVM/Mina/Solana addresses at account-index 2 are load-bearing. Currently the tests assert **account-index-1 ≠ account-index-2**; during GREEN implementation, the dev should tighten to **equality against known-correct addresses** generated locally with ethers / `@solana/web3.js` / `mina-signer` CLI and pasted as constants. Any CI drift on those constants is a P0 breaking change to the key derivation layer.

### R-012 — Microtask atomicity regression

T-inv-1, T-cs-1, T-026 all depend on `inventory.debit` and `channelState.reserve` being **synchronous** (no `await`, no `async`). Any refactor that accidentally awaits a logger or an async audit-log inside those methods breaks the atomicity guarantee and the concurrent-safety tests. Code review rule: grep `inventory.ts` / `channel-state.ts` for `async` or `await` and reject any hit on `debit` / `credit` / `reserve` / `release` / `snapshot`.

### R-017 — Connector signature format drift

AC-5 commits each signer to a byte layout that round-trips through the connector's `verifyBalanceProof`. The RED tests assert signature **length** (65 bytes EVM, 64 bytes Solana) and structural round-trip via `@noble/curves` inline (no connector dep). Full connector verify is a Story 12.8 E2E concern. If Story 12.8 catches a format mismatch, the fix is strictly inside `payment-channel-signer.ts` — do not loosen test-level contracts.

### Mina peer-dep gating

`mina-signer` is an optional peer dep. `payment-channel-signer.test.ts` uses `describe.skipIf(!hasMinaSigner)`. If CI resolves the optional dep, the Mina block runs; if not, it's skipped cleanly. The workspace installs it (`packages/sdk` uses it), so this should run in practice.

### Concurrency test determinism

T-inv-1 / T-cs-1 / T-026 rely on Node's single-threaded microtask scheduler — this is guaranteed by the V8 event loop for synchronous code inside a `.then()` callback. The tests avoid `setTimeout` / `setImmediate` and therefore do not depend on real-time scheduling. No flaky-test risk.

---

## Next Steps

1. Hand this checklist + 6 `.test.ts` files to the dev agent (`bmad-bmm-dev-story` or `auto-bmad:story`).
2. Dev agent works the **Implementation Checklist** above top-to-bottom (Tasks 2 → 3 → 4 → 6 → 5 → 7 → 9).
3. After each module lands, remove `it.skip` in the corresponding test file and run `pnpm --filter @toon-protocol/mill test -- <module>` — one file at a time.
4. Once all 44 tests pass, run the full AC-12 verification gate (mill build + SDK/core regression check + lint).
5. If T-int-1's structural wire-up to `createSwapHandler` uncovers any drift in the `IssueClaimParams` / `IssueClaimResult` shape, **back out** — do NOT modify `@toon-protocol/sdk`; the issue is in the Mill implementation (story non-goal: "Do NOT modify @toon-protocol/sdk").
6. Update sprint-status.yaml to `done` when all gates pass.
7. Follow-ups deferred to Story 12.8 E2E:
   - Connector `verifyBalanceProof` round-trip on real chains.
   - Cold-restart persistence (explicitly deferred in story Dev Notes).
   - Mina signer version-drift verification against the installed `mina-signer@>=3.0.0`.

---

## Step 5 — Validation

### Checklist

- [x] Prerequisites satisfied (stack detected, story approved, upstreams done).
- [x] Test files created correctly (6 files, 44 tests, all `it.skip`).
- [x] Checklist matches acceptance criteria (every AC has at least one mapped test or verification gate).
- [x] Tests are designed to fail before implementation (RED phase — imports target non-existent modules).
- [x] CLI sessions cleaned up — N/A (no browser automation).
- [x] Temp artifacts stored in `_bmad-output/test-artifacts/` (this file) and `packages/mill/src/*.test.ts` — no random temp locations.

### Polish

- No duplication — each section serves a distinct purpose (strategy / checklist / risks / next steps).
- Terminology consistent — `RED` / `GREEN` phase labels, T-IDs traced to test-design-epic-12, error codes pinned verbatim.
- All template sections populated or explicitly marked N/A.

### Completion Summary

**Test files created:**

- `packages/mill/src/wallet.test.ts` (11 tests — AC-3)
- `packages/mill/src/inventory.test.ts` (7 tests — AC-4)
- `packages/mill/src/channel-state.test.ts` (4 tests — AC-7)
- `packages/mill/src/payment-channel-signer.test.ts` (4 tests — AC-5)
- `packages/mill/src/claim-issuer.test.ts` (8 tests — AC-6, AC-8, AC-10)
- `packages/mill/src/index.test.ts` (10 tests — AC-9)

**Package scaffold created:**

- `packages/mill/package.json`
- `packages/mill/tsconfig.json`
- `packages/mill/tsup.config.ts`
- `packages/mill/vitest.config.ts`

**Stale scaffold removed:**

- `packages/mill/dist/` (prior `startMill` pre-build — belongs to Story 12.7, not 12.4).

**Checklist output path:** `_bmad-output/test-artifacts/atdd-checklist-12-4.md` (this file).

**Recommended next workflow:** `bmad-bmm-dev-story` with the story file — the dev agent has a clear 7-task sequence and 44 failing tests to flip green.

---

## Notes

- `mina-signer` is treated as an **optional** peer dependency. The Mina test block is guarded by `describe.skipIf(!hasMinaSigner)` so CI stays green when the peer isn't installed. The workspace *does* install it transitively via `@toon-protocol/sdk`, so in practice it will run.
- The T-int-1 end-to-end test currently has an `expect(true).toBe(false)` placeholder body — **intentional**. It forces the dev agent, when unskipping, to fill in the real `createSwapHandler` wire-up rather than shipping an empty shell. The comment above the assertion documents what the final test should do.
- Golden-vector address constants in `wallet.test.ts` are currently pinned **only via inequality** (`accountIndex=1 !== accountIndex=2`). During GREEN implementation, tighten these to equality against known-good addresses generated once locally with ethers / `@solana/web3.js` / `mina-signer` and checked in as string constants. Any future drift on those pins is a P0 signal of broken derivation.
- No changes to `packages/sdk`, `packages/core`, `packages/client`, or `../connector`. Story scope fence respected.

---

**Generated by BMad TEA Agent** — 2026-04-13
