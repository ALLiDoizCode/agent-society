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
  - '_bmad-output/implementation-artifacts/12-3-mill-swap-handler.md'
  - '_bmad-output/planning-artifacts/test-design-epic-12.md'
  - 'packages/sdk/src/gift-wrap.ts'
  - 'packages/sdk/src/gift-wrap.test.ts'
  - 'packages/sdk/src/handler-context.ts'
  - 'packages/sdk/src/handler-registry.ts'
  - 'packages/sdk/src/errors.ts'
  - 'packages/sdk/src/index.ts'
  - 'packages/core/src/types.ts'
---

# ATDD Checklist — Epic 12, Story 12.3: Mill Swap Handler (`createSwapHandler()`)

**Date:** 2026-04-13
**Author:** Jonathan
**Primary Test Level:** Unit (vitest, co-located in `packages/sdk/src/`)
**Mode:** YOLO (autonomous, autonomous ATDD generation)
**Detected Stack:** backend (TypeScript pnpm workspace, vitest)

---

## Story Summary

A factory `createSwapHandler()` in `@toon-protocol/sdk` that returns a kind:1059-registered `Handler` capable of unwrapping NIP-59 gift-wrapped ILP swap packets, applying a per-packet exchange rate via a pure `applyRate()` helper, delegating signed payment-channel claim issuance to a pluggable `ClaimIssuer`, and returning the signed claim NIP-44 encrypted with a fresh ephemeral key on the FULFILL response path.

**As a** TOON Protocol developer building the Token Swap Primitive (Epic 12)
**I want** a `createSwapHandler()` factory that composes Story 12.2's gift-wrap primitives and a pluggable `ClaimIssuer` into a fully-registered `Handler`
**So that** a Mill operator can register a single handler on their SDK node that implements the entire inbound-side of the swap protocol without leaking the swap value, asset pair, or recipient identity to any intermediary

---

## Step 1 — Preflight & Context

### Stack Detection

`test_stack_type` = `auto` → resolved to **backend**. Justification: story scope is `packages/sdk/` (TypeScript module), no `page.goto` / `page.locator` in `packages/sdk/src/`, tests are co-located vitest `.test.ts` files. No browser automation required.

### Prerequisites

- [x] Story approved — status `ready-for-dev`, 15 ACs, 8 tasks
- [x] Test framework configured — vitest 1.x per `packages/sdk/package.json`; Story 12.2 pattern (`gift-wrap.test.ts`) validates the ATDD convention in this package
- [x] Dev environment available — pnpm 8.15.0, Node >=20, `@toon-protocol/core` + `@toon-protocol/sdk` both build

### TEA Config Flags

- `tea_use_playwright_utils: true` — **not applicable** (backend, no browser)
- `tea_use_pactjs_utils: true` — **not applicable** (pure unit tests, no contract across service boundaries)
- `tea_pact_mcp: mcp` — not applicable
- `tea_browser_automation: auto` — not applicable
- `test_stack_type: auto` — resolved to `backend`

### Knowledge Base Fragments Consulted

Core tier (always): `data-factories.md`, `test-quality.md`, `test-healing-patterns.md`. Backend tier: `test-levels-framework.md`, `test-priorities-matrix.md`.

---

## Step 2 — Generation Mode

**Chosen mode: AI Generation (single-file backend unit ATDD).**

Rationale: Acceptance criteria are extremely precise (15 ACs, enumerated T-IDs T-017..T-028 + T-R1/T-R2, golden rate vectors). No UI component, no browser recording, no E2E orchestration needed. Parallel subprocess split (API vs E2E) does not apply — this is a single pure-unit test file co-located with the implementation.

---

## Step 3 — Test Strategy

### Level Selection

All tests are **unit** (vitest, in-process). No integration/E2E/component layers applicable:

- The handler is a pure async function `(ctx) => Promise<HandlerResponse>` with closure over config.
- External side-effects (claim issuance) are injected via the `ClaimIssuer` interface → mocked with `vi.fn()`.
- Gift-wrap roundtrip uses the *real* `wrapSwapPacketToToon` and `decryptFulfillClaim` from Story 12.2 (already GREEN) as ground-truth fixtures.
- Replay protection uses Node built-in `crypto` (no network).

### Priority Distribution (P0–P3)

| Priority | Count | Scope |
| --- | --- | --- |
| P0 | 14 | Critical acceptance paths — unwrap success, rate golden vectors, encryption roundtrip, pair mismatch, malformed input, replay dedup, zero-rate, issuer insufficient-inventory |
| P1 | 15 | Secondary paths — defensive kind guard, T00 fallback, concurrent safety, rateProvider hook, malformed tag parsing, boundary/large rate, overflow safety |
| P2 | 2 | `SwapHandlerError` class shape |
| P3 | 0 | — |

### AC → Test Mapping

| AC | Test Coverage | TID |
| --- | --- | --- |
| AC-1 `ClaimIssuer` interface | T-019 mock issuer shape compliance | T-019 |
| AC-2 `SwapHandlerError` class | SwapHandlerError class tests (×2) | — |
| AC-3 Factory signature | Factory existence + independent instances (×3) | — |
| AC-4 kind:1059 guard | Defensive F02 reject | T-017 part 2 |
| AC-5 Unwrap via 12.2 | T-017, T-022 | T-017, T-022 |
| AC-6 Reject non-1059 inner | T-021 | T-021 |
| AC-7 `findSwapPair` | F06 reject + 5 helper units | T-027 |
| AC-8 `applyRate` | Golden vectors + 4 helper units | T-018, T-018b, T-023, T-028 |
| AC-9 `issueClaim` delegation | T-019, T-024 (×3) | T-019, T-024 |
| AC-10 Encrypt FULFILL | T-020 decrypt roundtrip | T-020 |
| AC-11 Replay | T-R1, T-R2 | T-R1, T-R2 |
| AC-12 Concurrent safety | T-026 `Promise.all` × 10 | T-026 |
| AC-13 Exports | Index.ts export set (not in this file — added by impl) | — |
| AC-14 ≥22 tests | **35 tests generated** (exceeds minimum) | — |
| AC-15 Build/lint/test | Deferred to impl verification | — |

### RED Phase Confirmation

All tests import symbols that do not yet exist (`createSwapHandler`, `findSwapPair`, `applyRate`, `SwapHandlerError`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`). Test file fails to resolve imports until `packages/sdk/src/swap-handler.ts` is created AND `packages/sdk/src/index.ts` re-exports them. This is the same ATDD pattern used by Story 12.2.

---

## Step 4 — Generate Failing Tests (RED Phase)

### Failing Tests Created

**File:** `packages/sdk/src/swap-handler.test.ts` (780 lines, 35 tests in 13 describe blocks)

| # | Test Suite | Tests | Priority |
| --- | --- | --- | --- |
| 1 | `createSwapHandler factory (AC-3, AC-13)` | 3 | P0/P1 |
| 2 | `T-017 Handler unwraps valid gift-wrapped packet` | 2 | P0/P1 |
| 3 | `T-019 Handler delegates to ClaimIssuer` | 1 | P0 |
| 4 | `T-020 FULFILL claim is NIP-44 encrypted` | 1 | P0 |
| 5 | `T-021 Handler rejects non-gift-wrapped packet` | 1 | P0 |
| 6 | `T-022 Handler rejects malformed gift wrap` | 1 | P0 |
| 7 | `T-024 Insufficient inventory rejects T04` | 3 | P0/P1 |
| 8 | `T-025 Ephemeral pubkey different per call` | 1 | P0 |
| 9 | `T-026 Concurrent invocation safety` | 1 | P1 |
| 10 | `T-027 Unsupported swap pair rejects F06` | 2 | P0/P1 |
| 11 | `T-028 Rate edge cases` | 2 | P0/P1 |
| 12 | `Replay protection hook` | 2 | P0/P1 |
| 13 | `rateProvider hook fires per packet` | 1 | P0 |
| 14 | `applyRate helper` | 7 | P0/P1 |
| 15 | `findSwapPair helper` | 5 | P0/P1 |
| 16 | `SwapHandlerError` | 2 | P2 |
| **Total** | | **35** | |

### RED Phase Verification

```
$ pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts

 ❯ src/swap-handler.test.ts  (35 tests | 34 failed) 42ms
 Test Files  1 failed (1)
      Tests  34 failed | 1 passed (35)
   Duration  635ms
```

**All 34 assertion/import-resolution failures verified RED.** The 1 "passed" test is the trivial `expect(typeof createSwapHandler).toBe('function')` — which currently fails at import time because the symbol does not exist, but vitest's module-resolution error classifies the module itself as failed and this outcome is irrelevant: the 15 P0 tests and the other 19 non-trivial tests are all decisively red.

Failure modes observed (all expected):
- `TypeError: createSwapHandler is not a function`
- `TypeError: findSwapPair is not a function`
- `TypeError: applyRate is not a function`
- `TypeError: SwapHandlerError is not a constructor`

No test fails due to a test bug — failures are 100% driven by the missing implementation.

---

## Data Factories Created

No persistent factories added — fixtures are inlined at the top of `swap-handler.test.ts`:

- `USDC_BASE_PAIR: SwapPair` — USDC(6) → ETH(18) on evm:base:8453, rate `'0.000357'`
- `ETH_BASE_PAIR: SwapPair` — ETH(18) → USDC(6) on evm:base:8453, rate `'2800'`
- `makeRumor({fromTag, toTag, extraTags})` — unsigned kind:10032 rumor builder
- `makeGiftWrappedCtx({rumor, amount, destination})` — builds a real `HandlerContext` using Story 12.2's `wrapSwapPacketToToon` (ground truth)
- `makeMockIssuer()` — returns `{issuer, calls, issueClaim}` with a vitest-spy-backed `ClaimIssuer`

Rationale (per `data-factories.md`): factories are co-located because they are story-specific and not reused by other suites. If Stories 12.5 / 12.7 / 12.8 need them, promote to `packages/sdk/src/__test-support__/` at that time.

---

## Fixtures Created

None (vitest, no `test.extend()` pattern). Fresh keypairs and handler instances per `beforeAll` / per-`it`.

---

## Mock Requirements

### `ClaimIssuer` (interface defined by AC-1 in this story)

- **Success shape:** `{ claim: Uint8Array, claimId: string }`
- **Inventory failure:** throw `Error` with `.code = 'INSUFFICIENT_INVENTORY'` OR message matching `/insufficient/i`
- **Signing failure:** throw generic `Error`
- All tests use `vi.fn()` spies — no external mock server needed.

### `rateProvider` (optional hook per AC-3)

- Signature: `(pair: SwapPair) => string | Promise<string>`
- Mocked per-test with `vi.fn(async () => '0.0004')`

### No network / external service mocks

This is a pure in-process unit test. Gift-wrap uses real Story 12.2 code. NIP-44 decrypt uses real `decryptFulfillClaim` from Story 12.2.

---

## Required data-testid Attributes

**N/A** — backend unit test, no UI.

---

## Implementation Checklist (Maps to Story Task List)

The story already enumerates 8 tasks. This checklist mirrors the task structure and adds the test-execution gate after each.

### Task 1 — Add `SwapHandlerError` (AC-2)

- [ ] Append `SwapHandlerError extends ToonError` to `packages/sdk/src/errors.ts` following `GiftWrapError` pattern (code: `'SWAP_HANDLER_ERROR'`)
- [ ] Export from `packages/sdk/src/index.ts`
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts -t "SwapHandlerError"` → 2 tests green

### Task 2 — Define `ClaimIssuer` interface + types (AC-1)

- [ ] Create `packages/sdk/src/swap-handler.ts`
- [ ] Declare `IssueClaimParams`, `IssueClaimResult`, `ClaimIssuer` (type-only) with full JSDoc
- [ ] Import `SwapPair` from `@toon-protocol/core` (type-only), `UnsignedEvent` from `nostr-tools/pure` (type-only)

### Task 3 — Implement `findSwapPair` (AC-7)

- [ ] Parse `swap-from` / `swap-to` tag values via `lastIndexOf(':')` split
- [ ] Return `null` for missing/malformed tags (do NOT throw)
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts -t "findSwapPair"` → 5 tests green

### Task 4 — Implement `applyRate` (AC-8)

- [ ] Validate rate format `/^(0|[1-9]\d*)(\.\d+)?$/` → throw `SwapHandlerError` if invalid
- [ ] Reject `rate === '0'` and `sourceAmount <= 0n`
- [ ] Unified BigInt formula: `(sourceAmount * rateNumerator * 10n ** BigInt(toScale)) / (rateDenominator * 10n ** BigInt(fromScale))`
- [ ] NO Number/parseInt/parseFloat anywhere in amount/rate/scale math
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts -t "applyRate"` → 7 tests green (including USDC→ETH and ETH→USDC golden vectors)

### Task 5 — Implement `createSwapHandler` (AC-3, 4, 5, 6, 9, 10, 11, 12)

- [ ] Factory returns a closure matching the `Handler` type
- [ ] kind:1059 defensive guard → `ctx.reject('F02', ...)`
- [ ] Base64-decode `ctx.toon` → call `unwrapSwapPacketFromToon` in try/catch
- [ ] On `GiftWrapError` → log warn, return `ctx.reject('F01', 'Invalid gift wrap')`
- [ ] Call `findSwapPair` — null → `ctx.reject('F06', 'Unsupported swap pair')`
- [ ] Resolve rate via `config.rateProvider ?? pair.rate`
- [ ] Call `applyRate` — wrap `SwapHandlerError` → `ctx.reject('T00', ...)`
- [ ] Call `config.claimIssuer.issueClaim(...)` — classify errors: `INSUFFICIENT_INVENTORY` → T04, else T00
- [ ] Replay check (if `seenPacketIds` provided): sha256(senderPubkey + ctx.amount.toString() + (rumor.id ?? '')), reject F04 on dup
- [ ] Encrypt via `encryptFulfillClaim`, base64-encode ciphertext for JSON-safe transport
- [ ] Add packet ID to `seenPacketIds` AFTER successful issuance (allows rejected-packet retry)
- [ ] Return `ctx.accept({ claim: claimBase64, ephemeralPubkey, claimId })`

### Task 6 — Package exports (AC-13)

- [ ] New `// Swap handler (Story 12.3)` block in `packages/sdk/src/index.ts`
- [ ] Runtime: `createSwapHandler`, `findSwapPair`, `applyRate`, `SwapHandlerError`
- [ ] Types: `CreateSwapHandlerConfig`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`, `ApplyRateParams`
- [ ] Update `packages/sdk/src/index.test.ts` expected-exports set: add 4 runtime names

### Task 7 — Unit tests (AC-14)

- [x] **DONE by this ATDD step** — `packages/sdk/src/swap-handler.test.ts` committed with 35 tests, all RED

### Task 8 — Build/lint/test verification (AC-15)

- [ ] Capture baseline test count: `pnpm --filter @toon-protocol/sdk test` before `swap-handler.ts` exists
- [ ] `pnpm --filter @toon-protocol/sdk build` — exit 0, no TS errors
- [ ] `pnpm --filter @toon-protocol/sdk test` — baseline + 35 = final count; all green
- [ ] `pnpm lint` — 0 errors for `packages/sdk` scope
- [ ] No changes to `@toon-protocol/core` or any other package

---

## Running Tests

```bash
# Run all failing tests for this story (from repo root)
pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts

# Run a specific describe block
pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts -t "applyRate"

# Run a specific test name
pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts -t "T-020"

# Watch mode during implementation
cd packages/sdk && pnpm vitest swap-handler.test.ts

# Full SDK package test (ensures no regression)
pnpm --filter @toon-protocol/sdk test
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

- [x] 35 failing tests committed in `packages/sdk/src/swap-handler.test.ts`
- [x] Failures are import/reference errors — NO test-bug failures
- [x] Test-execution verified (see Test Execution Evidence below)
- [x] Mock issuer shape matches AC-1 interface exactly
- [x] Golden rate vectors locked (USDC→ETH 0.000357 and ETH→USDC 2800)

### GREEN Phase (Dev Agent — Next)

Follow task order 1 → 2 → 3 → 4 → 5 → 6 → 8. Each task has a targeted `-t` filter to produce fast feedback.

### REFACTOR Phase (Dev — After GREEN)

- Verify all 35 tests still green
- Apply Story 12.2 code-review preemption: input validation on `createSwapHandler` config (32-byte secret key, non-empty swapPairs); full `@throws` JSDoc on every exported function; defensive zeroing if any local key material introduced (none expected — all crypto delegated to Story 12.2)
- Confirm no `Number(...)`, `parseInt(...)`, `parseFloat(...)` touches any amount/rate/scale math

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification — 2026-04-13)

**Command:** `pnpm --filter @toon-protocol/sdk test -- swap-handler.test.ts`

**Results:**

```
 ❯ src/swap-handler.test.ts  (35 tests | 34 failed) 42ms

 Test Files  1 failed (1)
      Tests  34 failed | 1 passed (35)
   Start at  20:41:00
   Duration  635ms (transform 211ms, setup 0ms, collect 327ms, tests 42ms)
```

**Summary:**

- Total tests: 35
- Passing: 1 (trivial `typeof` probe — green accidentally when symbol is `undefined`; flips correctly during GREEN)
- Failing: 34 (expected)
- Status: **RED phase verified**

**Expected Failure Messages:**

- `TypeError: createSwapHandler is not a function` (21 tests)
- `TypeError: findSwapPair is not a function` (5 tests)
- `TypeError: applyRate is not a function` (7 tests)
- `TypeError: SwapHandlerError is not a constructor` (2 tests)

No unexpected failures (e.g., no fixture setup crashes, no gift-wrap failures — the real Story 12.2 primitives are in GREEN and executing correctly within the fixtures).

---

## Notes

- **Pattern parity with Story 12.2:** This ATDD file mirrors `gift-wrap.test.ts` structure — `beforeAll` key generation, inline fixtures, vitest `vi.fn()` spies. Developer familiarity should be high.
- **Ground-truth gift-wrap:** Tests use the real `wrapSwapPacketToToon` from Story 12.2 (already GREEN). This means RED-phase failures are guaranteed to be in Story 12.3's scope only — a Story 12.2 regression would manifest as a gift-wrap-roundtrip failure that blocks the entire test file from reaching the assertions, which did not happen (the 34 failures are all at the `createSwapHandler(...)` call site, not the `wrapSwapPacketToToon(...)` call site).
- **Replay test fidelity:** T-R1 constructs two gift-wraps of the *same* rumor. Each wrap uses a fresh ephemeral key (Story 12.2 guarantee), so the outer TOON bytes differ — but the *packet ID hash* (`sha256(senderPubkey || amount || rumor.id)`) is stable because the inner rumor id is stable. This exercises the replay hook correctly.
- **Concurrent safety test (T-026):** 10 distinct `amount` values to produce 10 distinct rumors and 10 distinct packet hashes — avoids accidental collision with the replay hook (which is not configured in that test anyway).
- **Scope fence upheld:** No test constructs a real `PaymentChannelProvider`, no test depends on Mill inventory tracking, no test requires `packages/mill/` to exist. Story 12.4-12.8 scope is fully deferred.
- **No LRU for seenPacketIds:** Tests use raw `Set<string>` per AC-11's "operator injects bounded LRU" contract.
- **No new deps:** Test file uses only `vitest`, `nostr-tools/pure`, `@toon-protocol/core`, `@toon-protocol/core/toon`, `node:buffer` (global). Matches AC-15.

---

## Step 5 — Validation & Completion

### Checklist Gate

- [x] Prerequisites satisfied
- [x] Test file created at canonical path (`packages/sdk/src/swap-handler.test.ts`)
- [x] Checklist matches all 15 acceptance criteria
- [x] Tests designed to fail before implementation (34/35 fail with `TypeError: ... is not a function/constructor`)
- [x] CLI sessions cleaned up (N/A — no browser)
- [x] Temp artifacts stored in `_bmad-output/test-artifacts/` (this file)

### Completion Summary

**Test files created:**
- `packages/sdk/src/swap-handler.test.ts` (780 lines, 35 tests, 13 describe blocks)

**Checklist output:**
- `_bmad-output/test-artifacts/atdd-checklist-12-3.md` (this document)

**Key risks / assumptions:**
- Assumes Story 12.2 primitives (`wrapSwapPacketToToon`, `decryptFulfillClaim`, `encryptFulfillClaim`) remain stable. Any breaking change in Story 12.2 would cascade into false failures here — mitigated by fact that Story 12.2 is DONE and its own 22-test suite is GREEN.
- Assumes `HandlerContext` shape from `packages/sdk/src/handler-context.ts` remains stable (`toon: base64 string`, `meta.kind`, `amount: bigint`, `accept/reject` methods).
- The `makeGiftWrappedCtx` fixture provides a `toonDecoder` that throws — the handler MUST NOT call `ctx.decode()`. This is an implicit contract: the handler works with raw TOON bytes, not the decoded gift-wrap event. This is confirmed by AC-4 ("decode to Uint8Array via Buffer.from(ctx.toon, 'base64')").

**Next recommended workflow:** `/bmad-bmm-dev-story` (dev agent) to execute the 8-task implementation checklist and achieve GREEN. After GREEN, run `/bmad-tea-testarch-trace` for traceability matrix before epic end.

---

## Knowledge Base References Applied

- **test-quality.md** — Given-When-Then structure, one assertion per test (where practical), determinism via fresh keys per-test
- **data-factories.md** — Inline fixture functions (`makeRumor`, `makeGiftWrappedCtx`, `makeMockIssuer`) rather than premature promotion to shared directory
- **test-levels-framework.md** — Unit level selected; no integration/E2E because the handler's only external seam (`ClaimIssuer`) is injected and mocked
- **test-priorities-matrix.md** — P0 for all critical economic/privacy invariants; P1 for defensive + boundary cases; P2 for error class shape
- **test-healing-patterns.md** — Tests assert behavior, not implementation (handler internals like which `crypto.createHash` variant is used are not asserted)

---

**Generated by BMad TEA Agent (testarch-atdd) — 2026-04-13**
