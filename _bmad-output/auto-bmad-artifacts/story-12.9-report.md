# Story 12.9 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md`
- **Git start**: `584d06c802e948dc613656c962ba2eb61b08fa8e`
- **Duration**: ~1.5 hours wall-clock
- **Pipeline result**: **SUCCESS**
- **Migrations**: None. Wire-additive only (new `chain-recipient` NIP-59 rumor tag); TypeScript interface tightening is compile-time breaking for external callers but additive at the protocol level.

## What Was Built
Predecessor/remediation story unblocking Story 12.8. Extends the swap rumor schema and TypeScript interfaces so senders supply a chain-appropriate recipient address (20-byte EVM for EVM chains; base58 for Solana) that threads end-to-end through `streamSwap()` → kind:1059 rumor → swap handler → `MultiChainClaimIssuer.issueClaim()` → `EvmPaymentChannelSigner.signBalanceProof()`. Fixes the 32-byte Nostr pubkey → 20-byte EVM recipient defect at `packages/mill/src/claim-issuer.ts:139`/`:178`. Validation enforced at three tiers (sender, handler, claim-issuer) with `MILL_RECIPIENT_MISMATCH` equality check on FULFILL metadata.

## Acceptance Criteria Coverage
All 17 ACs covered FULL (per trace report). Highlights:
- [x] AC-1: `chainRecipient` required on `StreamSwapParams` — `stream-swap.test.ts:T-1`
- [x] AC-2: three-tier validation (sender/handler/claim-issuer) — `T-2*`, `T-6*`, `T-14`
- [x] AC-3: `chain-recipient` rumor tag emitted — `T-3`, `gift-wrap.test.ts` round-trip
- [x] AC-4: required on `IssueClaimParams` (compile-time + runtime) — `T-8`
- [x] AC-5: defect-site fix, signer receives `chainRecipient` — `claim-issuer.test.ts:T-10..T-13`
- [x] AC-6: handler T00 on missing/malformed — `T-5`, `T-6a..c`
- [x] AC-7: FULFILL recipient equality check (`MILL_RECIPIENT_MISMATCH`) — `T-4`
- [x] AC-8..12: chain family validation, error code, precedence — `T-2a..d`
- [x] AC-13..14: Mina + unknown-chain fall-through — `T-2c`, `T-2d`, `T-6c`
- [x] AC-15: encryption-opacity regression — `gift-wrap.test.ts`
- [x] AC-16: mill-side wire demo passes end-to-end at unit boundary
- [x] AC-17: Story 12.8 `it.skip` preserved (guardrail 8.1)

## Files Changed
**Source (modified):**
- `packages/sdk/src/stream-swap.ts` — `chainRecipient` required, `validateChainAddress` exported, `INVALID_CHAIN_RECIPIENT` code, rumor tag emission, FULFILL equality check.
- `packages/sdk/src/swap-handler.ts` — `IssueClaimParams.chainRecipient` required, local `validateChainRecipient`/`findChainRecipient`, T00 rejection.
- `packages/sdk/src/errors.ts` — new error code.
- `packages/mill/src/claim-issuer.ts` — `signBalanceProof` receives `chainRecipient` (defect fix); added `validateClaimIssuerChainRecipient` third-tier validator in pass #1.

**Tests (modified/added):**
- `packages/sdk/src/stream-swap.test.ts` — T-1..T-4, T-2a..T-2d added.
- `packages/sdk/src/swap-handler.test.ts` — T-5..T-8, T-6a..T-6c added.
- `packages/sdk/src/gift-wrap.test.ts` — AC-15 round-trip.
- `packages/mill/src/claim-issuer.test.ts` — T-10..T-14 (T-14 added in review #3).
- `packages/mill/src/mill.test.ts` — accommodation sweep.

**Accommodation sweep:** ~50 existing callsites in 12.4/12.5/12.6 test suites received `FIXTURE_EVM_RECIPIENT = '0x' + '11'.repeat(20)`.

**Docs / artifacts:**
- `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md` — story spec.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 12-9: done.
- `_bmad-output/test-artifacts/atdd-checklist-12-9.md`
- `_bmad-output/test-artifacts/nfr-assessment-12-9.md`
- `_bmad-output/test-artifacts/automation-summary-12-9.md`
- `_bmad-output/test-artifacts/test-reviews/test-review-12-9-20260414.md`
- `_bmad-output/test-artifacts/traceability/story-12-9-trace.md`

## Pipeline Steps
| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Create | ✓ | story drafted |
| 2 | Validate | ✓ | frontmatter, dependencies, epic context added |
| 3 | ATDD | ✓ | checklist-only; RED enforced structurally |
| 4 | Develop | ✓ | 13 tests + production fix + accommodation sweep |
| 5 | Post-Dev Verify | ✓ | Dev Agent Record clean |
| 6 | Frontend Polish | skipped | backend-only |
| 7 | Post-Dev Lint | ✓ | prettier reformatted 3 files |
| 8 | Post-Dev Test | ✓ | 831 passing |
| 9 | NFR | ✓ | 27/29, 2 concerns (both scoped to 12.8 resume) |
| 10 | Test Automate | ✓ | +3 Mina/unknown-chain tests |
| 11 | Test Review | ✓ | 95/100 |
| 12 | Code Review #1 | ✓ | 0C/0H/2M/2L |
| 13 | Review #1 Verify | ✓ | Code Review Record initialized |
| 14 | Code Review #2 | ✓ | 0/0/0/0 clean |
| 15 | Review #2 Verify | ✓ | |
| 16 | Code Review #3 | ✓ | 0/0/0/1 (added T-14) |
| 17 | Review #3 Verify | ✓ | status→done |
| 18 | Security Scan | ✓ | semgrep 0 findings (210 rules / 11 files) |
| 19 | Regression Lint | ✓ | clean |
| 20 | Regression Test | ✓ | 834 (+3) |
| 21 | E2E | skipped | backend-only |
| 22 | Trace | ✓ | 17/17 FULL |

## Test Coverage
- **Post-dev**: 831
- **Regression**: 834
- **Delta**: +3 (Mina/unknown-chain AC-13b, AC-14b gap fills)
- No regression.

## Code Review Findings
| Pass | Critical | High | Medium | Low | Total | Fixed |
|------|----------|------|--------|-----|-------|-------|
| #1   | 0 | 0 | 2 | 2 | 4 | 4 |
| #2   | 0 | 0 | 0 | 0 | 0 | 0 |
| #3   | 0 | 0 | 0 | 1 | 1 | 1 |

## Quality Gates
- **Frontend Polish**: skipped (backend-only)
- **NFR**: PASS (27/29, 2 CONCERNS intentionally scoped to 12.8 resume)
- **Security Scan (semgrep)**: PASS (0 findings, 210 rules / 11 source files; regexes confirmed ReDoS-safe)
- **E2E**: skipped (backend-only)
- **Traceability**: PASS — 17/17 FULL coverage

## Known Risks & Gaps
- `validateChainAddress` / `validateChainRecipient` / `validateClaimIssuerChainRecipient` duplicated at three tiers (guardrail 8.5 forbade a shared helper during 12.9). Future refactor: extract to `@toon-protocol/core`; follow-up noted in NFR report.
- Story 12.8's `it.skip(SCHEMA_BLOCKER, …)` blocks are now semantically unblocked by this story but remain skipped per guardrail 8.1. Resuming them is Story 12.8's job.
- Two pre-existing lint nits in `channel-state.test.ts:367` and `mill.ts:703` were not fixed (out of scope).
- Before Epic 12 public release: add Mill-operator alerts on `malformed_rumor` rate and `MILL_RECIPIENT_MISMATCH` count (NFR recommendation).

## TL;DR
Predecessor story delivered cleanly through all 22 pipeline steps. Fixed the 32-byte vs 20-byte defect at `claim-issuer.ts:139` by threading a sender-provided `chainRecipient` through the full swap pipeline, with three-tier validation and a FULFILL equality check. 13 new unit tests + 3 chain-family gap fills + 1 review-pass regression test; 834 tests pass (+3 net), 0 semgrep findings, 17/17 ACs FULL. Story 12.8 is now unblocked and ready to resume un-skipping its `SCHEMA_BLOCKER` integration tests.
