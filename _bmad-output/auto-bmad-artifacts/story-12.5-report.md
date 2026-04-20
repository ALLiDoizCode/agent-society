# Story 12.5 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md`
- **Git start**: `1d84aede`
- **Duration**: ~60 minutes wall-clock (pipeline)
- **Pipeline result**: success (all 22 steps — 2 skipped for backend-only, 20 executed)
- **Migrations**: None — purely additive SDK + client surface. `AccumulatedClaim.targetAmount` extension and FULFILL `targetAmount` metadata field are backward-compatible.

## What Was Built
Story 12.5 delivers the `streamSwap()` sender API in `@toon-protocol/sdk` — the client-side entry point for cross-chain atomic-swap streaming via Mill swap DVMs. The API takes a swap pair (kind:10032), a schedule of packet amounts, and a sender keypair, then drives the NIP-59 gift-wrapped ILP packet round-trip end-to-end: builds SWAP rumors, delivers via BTP, decrypts FULFILL metadata, accumulates signed claims, and invokes a caller-supplied `onPacket` callback per hop. A companion `streamSwapControlled()` variant returns a controller for pause/resume/stop. `ToonClient.sendSwapPacket()` is the minimal public wire hook extracted from `publishEvent`'s claim-resolution path.

## Acceptance Criteria Coverage
All 15 ACs — FULL coverage per traceability matrix (`_bmad-output/test-artifacts/traceability/story-12-5-trace.md`):
- [x] AC-1: streamSwap(params) signature — covered by `stream-swap.test.ts`
- [x] AC-2: input validation (INVALID_PARAMS, INVALID_PAIR) — covered by `stream-swap.test.ts`
- [x] AC-3: ToonClient.sendSwapPacket public surface — covered by `ToonClient.sendSwapPacket.test.ts`
- [x] AC-4: kind 20032 rumor emission — covered by `stream-swap.test.ts` (MockMill side-channel)
- [x] AC-5: FULFILL decryption + metadata parsing — covered by `stream-swap.test.ts`
- [x] AC-6: AccumulatedClaim assembly — covered by `stream-swap.test.ts`
- [x] AC-7: onPacket callback contract (frozen, async-safe) — covered by `stream-swap.test.ts`
- [x] AC-8: claim-byte handling (unreachable 0-byte guard documented) — covered by `stream-swap.test.ts`
- [x] AC-9: terminal state / abortReason / bookkeeping — covered by `stream-swap.test.ts` (all 6 abortReasons + completed/failed/stopped states)
- [x] AC-10: controller state machine (pause/resume/stop idempotency) — covered by `stream-swap.test.ts`
- [x] AC-11: rate-deviation guard with scaled-division BigInt math — covered by `stream-swap.test.ts`
- [x] AC-12: FULFILL metadata wire compatibility with Story 12.3 — covered by `swap-handler.test.ts` regression + `stream-swap.test.ts` roundtrip
- [x] AC-13: performance — T-047 1000-packet stress passes in ~22s
- [x] AC-14: StreamSwapError codes — covered by `stream-swap.test.ts`
- [x] AC-15: exports / public surface — covered by `index.test.ts`

## Files Changed
**Added (new files):**
- `_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md`
- `_bmad-output/test-artifacts/atdd-checklist-12-5.md`
- `_bmad-output/test-artifacts/nfr-assessment-12-5.md`
- `_bmad-output/test-artifacts/traceability/story-12-5-trace.md`
- `packages/client/src/ToonClient.sendSwapPacket.test.ts`
- `packages/sdk/src/stream-swap.ts`
- `packages/sdk/src/stream-swap.test.ts`

**Modified:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (12-5 entry: ready-for-dev → done)
- `packages/client/src/ToonClient.ts` (sendSwapPacket + resolveClaimForDestination helper)
- `packages/sdk/src/errors.ts` (added StreamSwapError)
- `packages/sdk/src/index.ts` (exported streamSwap/streamSwapControlled/types/StreamSwapError)
- `packages/sdk/src/index.test.ts` (export-surface guard)
- `packages/sdk/src/swap-handler.ts` (emit targetAmount in FULFILL metadata; zero-rate regex guard for fractional forms)
- `packages/sdk/src/swap-handler.test.ts` (regression tests for metadata shape + zero-rate)

## Pipeline Steps

### Step 1: Story Create — success (~6 min)
- Created story file with 15 ACs, 8 tasks, full dependency analysis.
- Added 12-5 entry to sprint-status.yaml.
- Key decision: chose rumor kind 20032 (10032 + 10000) after grep verification for collisions.

### Step 2: Story Validate — success (~6 min)
- 3 issues found & fixed: incorrect GiftWrapError import path, unresolved kind 20032 grep TODO, missing BMAD template sections (Previous Story Intelligence, Story Completion Status, Change Log).

### Step 3: ATDD — success (~6 min)
- Wrote 37 failing acceptance tests covering AC-1..AC-12.
- Created MockMill harness using real crypto (no stubs on wire path).
- Sample pair: USDC(6dp) → ETH(18dp) to stress 12-decimal-delta scaled-division.

### Step 4: Develop — success (~15 min)
- Implemented streamSwap + streamSwapControlled + StreamSwapError + sendSwapPacket.
- Fixed 7 async validation tests (converted streamSwap to async), DTS build, 7 lint errors.
- Extended FULFILL metadata with optional targetAmount (additive, backward-compatible).

### Step 5: Post-Dev Artifact Verify — success (~3 min)
- Reverted premature Status: done → review; checkboxed 32 tasks; verified model, completion notes, file list, change log.

### Step 6: Frontend Polish — **skipped** (backend-only, ui_impact: false)

### Step 7: Post-Dev Lint & Typecheck — success (~35s)
- sdk + client builds green; 0 eslint errors; 4 pre-existing test-file warnings; 3 files auto-formatted.

### Step 8: Post-Dev Test Verification — success (~28s)
- **TEST_COUNT = 929** (sdk 558 + client 371).

### Step 9: NFR — success (25/29 = 86%, PASS)
- All 8 ADR checklist categories assessed; deferred live p95 to Story 12.8 E2E.

### Step 10: Test Automate — success (~5 min)
- Added 14 gap-fill tests in sdk + 1 in client (AC-2 edge cases, AC-3 auto-claim path, AC-7 async/immutability, AC-8 empty claim, AC-9 bookkeeping, AC-10 idempotency).

### Step 11: Test Review — success (~3 min)
- Added 2 more gap-fill tests (all-rejected terminal branch, FULFILL decode failed → failed state).

### Step 12: Code Review #1 — success (5 issues fixed)
- **C=1, H=2, M=2, L=0**.
- Critical: swap-handler missing targetAmount emit in FULFILL metadata (false-positive test bug).
- High: all-rejected terminal-state guard too narrow; missing metadata-shape regression test.
- Agent prematurely set Status: done — reverted in step 13.

### Step 13: Review #1 Artifact Verify — success (~3 min)
- Reverted Status to review, created Code Review Record section with Pass #1 entry.

### Step 14: Code Review #2 — success (3 issues fixed)
- **C=0, H=1, M=1, L=1**.
- High: unvalidated targetAmount from Mill metadata (settlement corruption risk).
- Medium: missing nested pair.from/to validation.
- Low: non-finite effectiveRate exposure to callback.

### Step 15: Review #2 Artifact Verify — success (~2 min)
- Consolidated duplicate Code Review Record headers into single section.

### Step 16: Code Review #3 (final) — success (5 issues fixed)
- **C=0, H=1, M=2, L=2**.
- Semgrep OWASP scan: 0 findings.
- High: applyRate zero-rate guard missed fractional forms ('0.0', '0.00').
- Medium: params.pair stored by reference (mutation risk); base64 regex too permissive.
- Low: schedule silent fallback; logger JSDoc missing.
- Promoted to Status: done.

### Step 17: Review #3 Artifact Verify — success (~1 min, no edits needed)

### Step 18: Security Scan — success (~7s)
- Semgrep auto + OWASP top-10 + TypeScript + JavaScript rulesets, 213 rules, **0 findings** on 9 files.

### Step 19: Regression Lint & Typecheck — success (~30s)
- All green; 1 prettier auto-format applied.

### Step 20: Regression Test — success (~29s)
- **TEST_COUNT = 955** (sdk 583 + client 372), delta **+26** from post-dev baseline.

### Step 21: E2E — **skipped** (backend-only story, E2E owned by Story 12.8)

### Step 22: Trace — PASS
- 100% AC coverage (15/15), 60/60 stream-swap + sendSwapPacket tests green.

## Test Coverage
- ATDD suite: `packages/sdk/src/stream-swap.test.ts` (45+ tests, real-crypto MockMill harness)
- Client unit: `packages/client/src/ToonClient.sendSwapPacket.test.ts` (5 tests)
- Wire-contract regression: `packages/sdk/src/swap-handler.test.ts` (+1 test for targetAmount metadata)
- Export-surface guard: `packages/sdk/src/index.test.ts`
- **Coverage summary**: 100% AC coverage per traceability matrix.
- **Test count**: post-dev 929 → regression 955 (delta **+26**)

## Code Review Findings

| Pass | Critical | High | Medium | Low | Total Found | Fixed | Remaining |
|------|----------|------|--------|-----|-------------|-------|-----------|
| #1   | 1        | 2    | 2      | 0   | 5           | 5     | 0         |
| #2   | 0        | 1    | 1      | 1   | 3           | 3     | 0         |
| #3   | 0        | 1    | 2      | 2   | 5           | 5     | 0         |
| **Totals** | **1** | **4** | **5** | **3** | **13** | **13** | **0** |

## Quality Gates
- **Frontend Polish**: skipped — backend-only story (ui_impact: false).
- **NFR**: PASS (25/29 = 86% across 8 ADR categories; live p95 deferred to Story 12.8 E2E).
- **Security Scan (semgrep)**: PASS — 0 findings across 213 rules (auto + OWASP top-10 + TS + JS).
- **E2E**: skipped — owned by Story 12.8.
- **Traceability**: PASS — 15/15 ACs covered. Matrix at `_bmad-output/test-artifacts/traceability/story-12-5-trace.md`.

## Known Risks & Gaps
1. `AccumulatedClaim.targetAmount` is either Mill-reported (via FULFILL metadata) or advertised-rate expected — Story 12.6 is responsible for parsing signed `claimBytes` per chain and reconciling. Tracked in story Dev Notes.
2. `publishEvent` claim-resolution logic is duplicated into `resolveClaimForDestination()` helper with a `TODO(12.5 followup)` comment; a future story should migrate the inline path.
3. Per-packet claim re-signing under ChannelManager auto-claim mode — implicitly exercised by T-044 but flagged as FOLLOW-UP for Story 12.7/12.8.
4. Mill handler FULFILL metadata wiring path (ctx.accept(metadata) → response.data) is not exercised by unit tests; Story 12.8 Docker E2E will validate it.
5. T-047 stress test at 1000 packets takes ~22s; consider reducing to 500 if CI budgets tighten, or run full 10k in Story 12.8.
6. AC-8 empty `claimBytes` branch is unreachable via tests (blocked by encryptFulfillClaim input validation) — documented inline.

## Manual Verification
Not applicable — backend-only story (ui_impact: false).

---

## TL;DR
Story 12.5 delivered the `streamSwap()` sender API cleanly: all 15 acceptance criteria fully covered, 13 code review findings (1 critical, 4 high, 5 medium, 3 low) found and fixed across 3 review passes, 0 semgrep security findings, regression test count grew +26 to 955, and traceability gate passed on first run. The story is `done`, fully backward-compatible with Story 12.3's wire contract, and hands off cleanly to Stories 12.6 (signed-claim reconciliation) and 12.8 (Docker E2E). No migrations, no breaking changes, no known blockers.
