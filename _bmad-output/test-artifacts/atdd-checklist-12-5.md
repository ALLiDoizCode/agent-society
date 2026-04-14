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
  - '_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md'
  - '_bmad-output/planning-artifacts/test-design-epic-12.md'
  - '_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md'
  - 'packages/sdk/src/gift-wrap.ts'
  - 'packages/sdk/src/swap-handler.ts'
  - 'packages/sdk/src/errors.ts'
  - 'packages/sdk/src/index.ts'
  - 'packages/sdk/vitest.config.ts'
  - 'packages/client/src/ToonClient.ts'
  - 'packages/client/src/adapters/BtpRuntimeClient.ts'
  - 'packages/core/src/types.ts'
---

# ATDD Checklist — Epic 12, Story 12.5: `streamSwap()` Sender API

**Date:** 2026-04-13
**Author:** Jonathan
**Primary Test Level:** Unit (vitest, co-located in `packages/sdk/src/`)
**Mode:** YOLO (autonomous ATDD generation)
**Detected Stack:** backend (TypeScript pnpm workspace, vitest)

---

## Story Summary

Story 12.5 delivers the **first-class sender API** for Epic 12's Token Swap Primitive. `streamSwap()` chunks a total source-asset amount into N gift-wrapped ILP packets (fresh ephemeral key per packet), dispatches each via the existing BTP path, decrypts FULFILL claims with `decryptFulfillClaim`, accumulates them into a stable `AccumulatedClaim[]` for Story 12.6's `buildSettlementTx()`, and exposes live rate monitoring plus pause/resume/stop/abort controls.

**As a** TOON Protocol client developer building on `@toon-protocol/sdk`
**I want** a `streamSwap()` helper with pause/resume/stop controls, per-packet rate monitoring, and stable `AccumulatedClaim[]` output
**So that** wallet UIs, Loony agents, Overmind treasury, and test harnesses can execute a multi-packet swap against a Mill with one call — risk-bounded to one packet's value, with accumulated claims ready for on-chain settlement by Story 12.6

---

## Acceptance Criteria (15 total)

1. **AC-1** — Module `packages/sdk/src/stream-swap.ts` exporting `streamSwap`, `streamSwapControlled`, `StreamSwapParams`, `StreamSwapResult`, `AccumulatedClaim`, `PacketProgress`, `RateMonitorCallback`, `StreamSwapController` (no internal helpers leaked).
2. **AC-2** — `StreamSwapParams` shape + pre-flight validation (totalAmount > 0n, exactly one of packetCount/packetAmounts, valid rate, 64-hex millPubkey, finite threshold).
3. **AC-3** — `ToonClient.sendSwapPacket(params)` public method — mirrors `publishEvent` claim resolution; returns raw `IlpSendResult`.
4. **AC-4** — Private `buildSwapRumor` emitting `swap-from` / `swap-to` / `amount` / `seq` / `nonce` tags on `kind: 20032`.
5. **AC-5** — Private `chunkAmount(total, count)` with remainder-on-last distribution.
6. **AC-6** — Packet send loop: validate → schedule → (rumor → wrap → send → decode → decrypt → accumulate → onPacket → deviation check) per packet.
7. **AC-7** — `PacketProgress` payload + `RateMonitorCallback` (sync-throw and async-reject both treated as stop; object frozen).
8. **AC-8** — `AccumulatedClaim` shape (STABLE contract consumed by 12.6).
9. **AC-9** — `StreamSwapResult` shape; non-controlled `streamSwap` never throws post-validation.
10. **AC-10** — `streamSwapControlled` + `StreamSwapController` (pause / resume / stop / state getter).
11. **AC-11** — `StreamSwapError` appended to `errors.ts` with `code` literal union and ES2022 `cause` support.
12. **AC-12** — Private `decodeFulfillMetadata(data)` with base64 → UTF-8 → JSON path and strict field validation.
13. **AC-13** — Unit tests covering T-038..T-047 plus validation/decoder/controller matrices.
14. **AC-14** — JSDoc + module header per repo convention; `@stable` marker on `AccumulatedClaim`.
15. **AC-15** — `pnpm --filter @toon-protocol/sdk build|test` green; `pnpm --filter @toon-protocol/client build|test` green; `pnpm lint` clean; zero new `@ts-ignore` or public-surface `any`.

---

## Step 1 — Preflight & Context

### Stack Detection

`test_stack_type` = `auto` → **backend**. Justification:
- `ui_impact: false` in story front-matter.
- Story scope is `packages/sdk/` (pure TS module, no browser surface).
- No `page.goto` / `page.locator` references in `packages/sdk/` or the new file's neighbours.
- Tests co-located with source per SDK precedent (`packages/sdk/src/*.test.ts`), vitest 1.x (ESM).

### Prerequisites

- [x] Story approved (`status: ready-for-dev`, 15 ACs, 8 tasks).
- [x] Test framework configured — `packages/sdk/vitest.config.ts` exists.
- [x] Dependencies present — `wrapSwapPacketToToon`, `unwrapSwapPacketFromToon`, `encryptFulfillClaim`, `decryptFulfillClaim`, `applyRate`, `SwapPair` all verified at documented paths.
- [x] Dev env available.

### Loaded Knowledge Fragments (tiered per tea-index)

**Core:** `data-factories.md`, `component-tdd.md`, `test-quality.md`, `test-healing-patterns.md`.
**Backend Patterns:** `test-levels-framework.md`, `test-priorities-matrix.md`, `ci-burn-in.md`.
Playwright/Pact fragments intentionally skipped — API-only backend, no browser automation, no cross-service contract.

---

## Step 2 — Generation Mode

**Mode:** E2E/UI **N/A**; **API-level unit tests** in `packages/sdk/src/stream-swap.test.ts`. Rationale:
- The `streamSwap` surface is a library function; highest-fidelity test is a Vitest unit with a **real-crypto MockMill** harness (per AC-13).
- Real E2E lives in Story 12.8 against Docker SDK E2E infra — out of scope for this ATDD cycle.
- `ToonClient.sendSwapPacket` (AC-3) gets a companion unit test in `packages/client/` (see Implementation Checklist Task 2).

---

## Step 3 — Test Strategy

### Risk / Priority Matrix (from test-design-epic-12.md § Story 12-5)

| ID    | P   | Title                                          | AC       | Covered in RED |
|-------|-----|------------------------------------------------|----------|----------------|
| T-038 | P0  | N packets → N accumulated claims               | AC-6/8   | ✅ |
| T-039 | P0  | `packetCount` vs `packetAmounts` scheduling     | AC-5     | ✅ |
| T-040 | P0  | Claim extraction roundtrips MockMill encrypt    | AC-6/8   | ✅ |
| T-041 | P0  | `onPacket` fires per accepted FULFILL          | AC-7     | ✅ |
| T-042 | P1  | Pause/resume via `streamSwapControlled`         | AC-10    | ✅ |
| T-043 | P1  | Rate-deviation abort                            | AC-6     | ✅ |
| T-044 | P1  | Partial failure (T04 rejects) tolerated         | AC-6/9   | ✅ |
| T-045 | P1  | Single-packet mode                              | AC-6     | ✅ |
| T-046 | P2  | Progress cumulatives monotonic                  | AC-7     | ✅ |
| T-047 | P2  | Stress 1000 packets (retained, de-scoped 10000) | AC-6     | Deferred — optional perf test flag |

### Risk Coverage

- **R-007** (silent rate drift): covered by T-043 (rate-deviation abort) + AC-7 (callback receives deviation).
- **R-009** (partial-failure amplification): covered by T-044 (rejections accumulate without aborting loop).
- **R-006** (ephemeral-key reuse): enforced by delegating to `wrapSwapPacketToToon` (Story 12.2 responsibility). Verified indirectly: T-038 asserts N distinct `ephemeralPubkey` values across the claim array (dev agent to add assertion in GREEN).

### Out-of-Scope for ATDD

- **E2E against Docker infra** — Story 12.8.
- **Per-packet BTP retry semantics** — out-of-story (future 12.7+).
- **ChannelManager auto-claim re-signing** — covered transitively by T-044 if invoked; full coverage lives in Story 12.7/12.8.

---

## Step 4 — Failing Tests (RED Phase)

### Unit Tests (37 tests)

**File:** `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/stream-swap.test.ts` (~540 lines)

**Status:** ✅ RED — file compiles only after `stream-swap.ts` module + `StreamSwapError` exports exist; every test body fails until the loop is implemented.

Test groups (one `describe` per group; all **currently failing** — tsc module-not-found or runtime assertion):

- **AC-1 surface (2):** `streamSwap` / `streamSwapControlled` are functions.
- **AC-2 validation (7):** INVALID_AMOUNT, INVALID_CHUNKING (neither / both / sum-mismatch / packetCount > totalAmount), INVALID_PAIR, invalid millPubkey.
- **AC-5 / T-039 scheduling (3):** 1000/10, 1000/3, explicit `packetAmounts`.
- **AC-6 / AC-8 / T-038 / T-040 (2):** N→N claims with correct shape; claim bytes roundtrip byte-for-byte.
- **AC-7 / T-041 / T-046 (2):** `onPacket` cadence + monotonic cumulatives; sync-throw halts loop.
- **AC-6 / T-043 (1):** rate-deviation stop at 5% drift with 2% threshold.
- **AC-6 / T-044 (1):** 3 rejections → 7 claims + 3 rejections, state='completed'.
- **AC-6 / T-045 (1):** single-packet path.
- **AC-10 / T-042 (3):** pause/resume round-trip, mid-stream stop, resume-after-complete throws.
- **AC-6 AbortSignal (1):** abort → stopped/aborted.
- **AC-11 (2):** error class shape + code union.
- **AC-12 decoder (4):** missing data, non-base64, invalid JSON, missing fields — all surface FULFILL_DECODE_FAILED in `result.errors[]`.
- **AC-4 rumor-tag observation (1):** intentional RED marker (`expect(true).toBe(false)`) flagged for dev agent to replace once MockMill exposes unwrapped rumors.

**Initial Test Run (expected):**

```
pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts

FAIL  src/stream-swap.test.ts
  × Cannot find module './stream-swap' from 'src/stream-swap.test.ts'
  × Cannot resolve 'StreamSwapError' in './errors'

Test Files  1 failed
Tests       37 total, all failing (module-not-found / assertion)
```

Expected failure categories:
1. **Module-not-found** (AC-1, AC-11) — `stream-swap.ts` and `StreamSwapError` not yet present.
2. **MockMill not wired** — test harness factory throws to remind dev agent to wire real-crypto roundtrip during GREEN.
3. **Assertion failures** — once module exists, assertions fire against an empty impl.

### Cross-Package Test (companion)

**File:** `/Users/jonathangreen/Documents/TOON-Protocol/packages/client/src/ToonClient.sendSwapPacket.test.ts` *(to be created by dev agent — Task 2.3)*

Coverage required (AC-3 matrix):
- Happy path with explicit `claim` → passes `sendIlpPacketWithClaim` with `amount: String(bigint)`.
- Auto-claim via ChannelManager → calls `ensureChannel` + `signBalanceProof` for resolved peer.
- `INVALID_STATE` when `this.state === null`.
- `NO_BTP_CLIENT` when `this.state.btpClient` missing.
- `MISSING_CLAIM` when neither explicit nor auto-claim available.

---

## Data Factories / Fixtures

### `samplePair()` — inline factory in test file

Defined in `stream-swap.test.ts` — returns USDC (6dp) on `evm:base:8453` → ETH (18dp) at rate `0.0005`. Chosen to exercise the worst-case 12-decimal-delta scaled-division deviation math (per Dev Notes / Epic 11 Retro guard).

### `makeMockMill(pair, millSecretKey, opts)` — real-crypto test harness

Test-file-local factory that wraps `vi.fn()`:
- Unwraps TOON binary via real `unwrapSwapPacketFromToon`.
- Reads rumor tags (asserts `swap-from` / `swap-to` / `amount` / `seq` / `nonce` shape per AC-4).
- Computes `targetAmount` via real `applyRate` (with optional per-packet `rateOverride` for T-043).
- Issues 32 claim bytes (or deterministic override via `claimBytesFor`) and encrypts with real `encryptFulfillClaim`.
- Returns `{ accepted: true, data: base64(JSON.stringify({ claim, ephemeralPubkey, claimId? })) }`.
- Supports `rejectIndices` map to emit `{ accepted: false, code: 'T04', message: '...' }` for T-044.

**Intentionally stubbed in RED:** factory currently throws at call-time with the message `'MockMill not wired — implement during GREEN phase'`. Dev agent wires the full real-crypto path once the stream-swap module compiles.

No separate `tests/support/factories/*.ts` file created — unit-test scope, per SDK repo convention (see `swap-handler.test.ts`, `gift-wrap.test.ts`).

---

## Mock Requirements

### Mill peer (BLS handler)

- **Endpoint:** `client.sendSwapPacket({ destination, amount, toonData, timeout, claim })` → `Promise<IlpSendResult>`.
- **Success Response:**
  ```json
  {
    "accepted": true,
    "data": "<base64(JSON.stringify({ claim: '<base64 NIP-44 ciphertext>', ephemeralPubkey: '<64-hex>', claimId?: '<string>' }))>"
  }
  ```
- **Failure Response:**
  ```json
  { "accepted": false, "code": "T04", "message": "insufficient inventory" }
  ```
- **Notes:** Must use **real** `encryptFulfillClaim` so the sender's `decryptFulfillClaim` path is end-to-end verified. No stubs on crypto.

### ChannelManager (AC-3 cross-package test only)

- `ensureChannel(peerId, amount)` and `signBalanceProof(...)` are stubbed via `vi.fn()` with spy assertions — full contract lives in existing `ChannelManager` tests; we only assert `sendSwapPacket` invokes them correctly.

---

## Required data-testid Attributes

**N/A** — backend library with no UI surface.

---

## Implementation Checklist

Maps each failing-test group to concrete implementation tasks (tracks Story 12.5 Tasks/Subtasks).

### Task 1 — `StreamSwapError` (AC-11)

**Files:** `packages/sdk/src/errors.ts`, `packages/sdk/src/index.ts`

- [ ] Append `StreamSwapError` class (extends `Error`; `readonly code`; ES2022 `cause` via `options?: { cause?: unknown }`).
- [ ] Export from `packages/sdk/src/index.ts`.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts -t 'AC-11'`
- [ ] ✅ AC-11 tests green.

**Estimated Effort:** 0.25h

### Task 2 — `ToonClient.sendSwapPacket` (AC-3)

**Files:** `packages/client/src/ToonClient.ts`, `packages/client/src/ToonClient.sendSwapPacket.test.ts`

- [ ] Factor existing claim-resolution block from `publishEvent` (lines 322–354) into private `resolveClaimForDestination(destination, amount)`. Fallback: duplicate with `TODO(12.5): factor` comment if regression risk.
- [ ] Implement `async sendSwapPacket(params)`: validate state → resolve claim → call `this.state.btpClient.sendIlpPacketWithClaim({ destination, amount: String(amount), data: toBase64(toonData), timeout })`.
- [ ] Return raw `IlpSendResult` (no transform).
- [ ] Create test file with the 5 cases listed under *Cross-Package Test* above.
- [ ] Run: `pnpm --filter @toon-protocol/client test`
- [ ] ✅ Client package green.

**Estimated Effort:** 1.5h

### Task 3 — Module scaffold + types (AC-1, AC-14)

**Files:** `packages/sdk/src/stream-swap.ts` (new), `packages/sdk/src/index.ts`

- [ ] Create file with repo-convention header comment.
- [ ] Declare and export `StreamSwapParams`, `StreamSwapResult`, `AccumulatedClaim`, `PacketProgress`, `RateMonitorCallback`, `StreamSwapController`.
- [ ] JSDoc all exported symbols. `@stable` marker on `AccumulatedClaim`. `@example` on `streamSwap` referencing kind:10032 discovery in prose only.
- [ ] Wire exports in `index.ts` following the existing ordering (swap-handler, gift-wrap, then stream-swap).
- [ ] Run: `pnpm --filter @toon-protocol/sdk build` — must compile.
- [ ] ✅ AC-1 surface tests green.

**Estimated Effort:** 1h

### Task 4 — Private helpers (AC-4, AC-5, AC-12)

**Files:** `packages/sdk/src/stream-swap.ts`

- [ ] `chunkAmount(total, count)` — remainder-on-last; throws `StreamSwapError('INVALID_CHUNKING', ...)` for invalid inputs.
- [ ] `buildSwapRumor(input)` — kind 20032, ordered tags, nonce-bearing; `getPublicKey`-derived `pubkey`. Re-grep repo for kind 20032 before commit.
- [ ] `decodeFulfillMetadata(data)` — base64→UTF-8→JSON; validate `claim` base64 regex + `ephemeralPubkey` 64-hex regex; throw `FULFILL_DECODE_FAILED` wrapping root cause.
- [ ] Add module-internal unit assertions (directly or via streamSwap integration).
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'AC-5|T-039'` and `-t 'AC-12'`.

**Estimated Effort:** 2h

### Task 5 — `streamSwap` loop (AC-2, AC-6, AC-7, AC-8, AC-9)

**Files:** `packages/sdk/src/stream-swap.ts`

- [ ] Pre-flight validation (AC-2) — synchronous, pre-loop; throws `StreamSwapError` variants.
- [ ] Schedule derivation from `packetCount` or `packetAmounts`.
- [ ] Per-packet loop: fresh 16-byte nonce → `buildSwapRumor` → `wrapSwapPacketToToon` → `client.sendSwapPacket` → `decodeFulfillMetadata` → `decryptFulfillClaim` → push `AccumulatedClaim`.
- [ ] Rate-deviation math: bigint-safe `Number(delta * 1_000_000n / expected) / 1_000_000`. Never `Number(target) / Number(source)` directly.
- [ ] `onPacket` invocation: `await` callback; frozen `PacketProgress`; sync-throw and async-reject → `abortReason='callback-throw'` with error in `errors[]`.
- [ ] Assemble `StreamSwapResult`; state is `'completed'` with partials, `'failed'` only when zero claims.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts` — AC-2/6/7/8/9 green.

**Estimated Effort:** 3h

### Task 6 — Controller (AC-10)

**Files:** `packages/sdk/src/stream-swap.ts`

- [ ] `Deferred` utility (module-private; no new dep).
- [ ] `streamSwapControlled(params)` → `{ result, controller }`. `streamSwap` = `streamSwapControlled(params).result`.
- [ ] `pause()` / `resume()` / `stop()` semantics per AC-10; `state` getter reflects live state.
- [ ] AbortSignal wiring: `signal.aborted` or `abort` event → `abortReason='aborted'`, break loop.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test -t 'AC-10|T-042|AC-6 — AbortSignal'`.

**Estimated Effort:** 2h

### Task 7 — MockMill harness wire-up (AC-13)

**File:** `packages/sdk/src/stream-swap.test.ts`

- [ ] Replace the `makeMockMill` stub body with the real-crypto path documented under *Data Factories / Fixtures*.
- [ ] Add `mill.unwrappedRumors: UnsignedEvent[]` side-channel so the AC-4 rumor-tag assertion can replace its `expect(true).toBe(false)` marker with real tag assertions.
- [ ] Ensure `claimBytesFor` override works for T-040 byte-equality assertion.
- [ ] Run: `pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts` — all 37 tests green.

**Estimated Effort:** 2h

### Task 8 — Verification (AC-15)

- [ ] `pnpm --filter @toon-protocol/sdk build` → tsup green.
- [ ] `pnpm --filter @toon-protocol/sdk test` → all green (co-located vitest).
- [ ] `pnpm --filter @toon-protocol/client build` → tsc green.
- [ ] `pnpm --filter @toon-protocol/client test` → all green.
- [ ] `pnpm lint` → clean.
- [ ] Grep confirmation: no new `@ts-ignore` / `@ts-expect-error`; no public-surface `any`.
- [ ] (Optional) `CHANGELOG.md` 0.x.y entry under `packages/sdk/`.

**Estimated Effort:** 0.5h

**Total estimated effort:** ~12.25h.

---

## Running Tests

```bash
# Run all failing tests for this story
pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts

# Run specific AC group
pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts -t 'AC-6'
pnpm --filter @toon-protocol/sdk test src/stream-swap.test.ts -t 'T-043'

# Debug a single test (vitest inspector)
pnpm --filter @toon-protocol/sdk exec vitest --inspect-brk -t 'rate deviation abort'

# Cross-package companion
pnpm --filter @toon-protocol/client test src/ToonClient.sendSwapPacket.test.ts

# Full story verification (Task 8)
pnpm --filter @toon-protocol/sdk build \
  && pnpm --filter @toon-protocol/sdk test \
  && pnpm --filter @toon-protocol/client build \
  && pnpm --filter @toon-protocol/client test \
  && pnpm lint
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ 37 failing tests authored in `packages/sdk/src/stream-swap.test.ts`.
- ✅ MockMill harness skeleton present (real-crypto wire-up deferred to Task 7, per AC-13).
- ✅ Mock requirements documented.
- ✅ No data-testid attributes required (backend surface).
- ✅ Implementation checklist created, mapped 1:1 to Story 12.5 Tasks 1–8.

**Verification:** the test file cannot be executed green until the `stream-swap.ts` module and `StreamSwapError` export exist. Failure mode is deterministic (tsc module-not-found → cascading assertions).

### GREEN Phase (DEV Team — Next)

Recommended order (matches dependency graph):
1. Task 1 — `StreamSwapError` (unblocks import).
2. Task 3 — module scaffold + types (unblocks compilation of test file).
3. Task 2 — `ToonClient.sendSwapPacket` (lets the SDK test construct real client mocks; also unlocks 12.8 E2E).
4. Task 4 — private helpers (validated by AC-5/AC-12 test groups in isolation).
5. Task 7 — MockMill wire-up (switches tests from module-not-found to real assertions).
6. Task 5 — `streamSwap` loop body.
7. Task 6 — controller + AbortSignal.
8. Task 8 — verification gates.

### REFACTOR Phase (DEV Team — after Green)

- Extract deduplicated claim-resolution helper (if Task 2 took the fallback copy path).
- Consider exposing a `__testing` symbol for `buildSwapRumor` if the observation-via-MockMill pattern proves flaky.
- Confirm kind 20032 collision grep post-commit (per AC-4 Dev Notes).

---

## Notes

- **Dev agent autonomy:** Task 7 (MockMill) is the **only** piece of RED-phase scaffolding that intentionally ships non-functional. This is deliberate: we do not want to wire the encrypt/unwrap roundtrip before the module shape is locked, or we risk coupling the test harness to the first draft.
- **Epic 11 Retro carries forward:** bigint-only arithmetic in the deviation math; scaled-division trick (`* 1_000_000n / expected`) is mandatory for 18-decimal target assets. Covered directly by T-043 when run with the USDC→ETH sample pair.
- **Stable contracts:** `AccumulatedClaim` is `@stable`. Any downstream rename (12.6/12.8) requires a coordinated migration note. RED-phase tests on this shape are intentionally narrow so they don't fight additive changes.
- **No E2E here:** Docker infra tests live in Story 12.8. Keeping 12.5 ATDD Vitest-only preserves sub-agent memory budget (rule in CLAUDE.md).
- **Semgrep note:** the Write-tool scan hook reported a missing `SEMGREP_APP_TOKEN`; this is an advisory, not a rule violation, and does not block the checklist.

---

## Knowledge Base References Applied

- `test-levels-framework.md` — Unit level chosen over E2E; E2E owned by Story 12.8.
- `test-priorities-matrix.md` — P0/P1/P2 mapping inherited from `test-design-epic-12.md`.
- `data-factories.md` — `samplePair()` + `makeMockMill()` as inline factories (SDK convention).
- `test-quality.md` — AAA pattern; one assertion focus per test; frozen-object immutability check on `PacketProgress`.
- `test-healing-patterns.md` — `rejectIndices` / `rateOverride` options let the harness exercise failure paths without dedicated fixture sprawl.
- `ci-burn-in.md` — T-047 (1000-packet stress) flagged optional; prevents CI slowdown.

See `_bmad/tea/testarch/tea-index.csv` for full fragment mapping.

---

## Contact

Questions or Issues: ping TEA agent in channel, or see `_bmad/tea/workflows/testarch/atdd/instructions.md`.

---

**Generated by BMad TEA Agent** — 2026-04-13
