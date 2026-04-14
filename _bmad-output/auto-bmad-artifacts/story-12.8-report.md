# Story 12.8 Report (PARTIAL)

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md`
- **Git start**: `a5c95a79a7efb4d898d48dfea0867a2b7545a965`
- **Recovery tag**: `pipeline-start-12.8`
- **Pipeline result**: **PARTIAL FAILURE at step 4 (Develop)** — retry also returned partial. Pipeline stopped per retry policy.
- **Migrations**: None.

## What Was Built
Story 12.8 aimed to add end-to-end swap-flow integration tests and fix four production wiring items carried over from Story 12.7 (bounded `seenPacketIds` LRU, auto-`ConnectorNode`, per-sender channel lookup, kind:10032 relay publication).

## Delivered
- **Production wiring (AC-10..AC-15): GREEN.**
  - `packages/sdk/src/swap-handler.ts` — bounded `BoundedSeenPacketIds` LRU (cap 10_000), always-on dedup, structural `SeenPacketIdsLike` type.
  - `packages/mill/src/mill.ts` — `Publisher` interface + injection, `SimplePool`-backed default, opt-in auto-`ConnectorNode` via `btpServerPort`, teardown on `stop()`.
  - `packages/mill/src/channel-state.ts` — sender→channel sticky binding, `resolveChannel()`, storage-key alignment, binding cleanup.
  - 150 mill tests + 49 swap-handler tests pass.
- **Integration tests (AC-1, AC-2, AC-13.4): GREEN (9 tests).**
  - `packages/mill/tests/integration/helpers/fixture-topology.ts` — in-process dispatch-bridge fixture (no Docker, no BTP socket).
  - `packages/mill/tests/integration/swap-flow.integration.test.ts` — AC-1 (1-packet swap), AC-2 (10-packet + publisher capture + coexistence regression), AC-13.4 (rejecting-publisher tolerance).

## Blocker (stops AC-3..AC-9, AC-12)
**Story 12.4 sender→EVM-recipient binding defect.** `MultiChainClaimIssuer.issueClaim()` at `packages/mill/src/claim-issuer.ts:135` passes the 32-byte Nostr `senderPubkey` as the `recipient` argument to `EvmPaymentChannelSigner.signBalanceProof()`. The signer correctly enforces a 20-byte EVM address at `packages/mill/src/payment-channel-signer.ts:79` and throws. Every kind:1059 swap packet therefore returns a `T00 Internal error` before settlement can proceed.

Root cause: the swap rumor schema has no field for a sender-provided chain-specific recipient address. Fix requires (a) extending the rumor schema, (b) teaching `MultiChainClaimIssuer` to pass the chain recipient through, (c) re-enabling the 8 skipped ACs.

Tests for AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-12 are left as explicit `it.skip(...)` with the blocker string referenced inline — no silent skips.

## Pipeline Steps Executed
| # | Step | Status |
|---|------|--------|
| 1 | Create | success |
| 2 | Validate | success |
| 3 | ATDD | success |
| 4 | Develop | **partial (retry also partial)** — stopped |

Not executed: Post-Dev Verify, Frontend Polish, Lint, Test, NFR, Test Automate, Test Review, Code Reviews ×3, Security Scan, Regression, E2E, Trace.

## Files Changed
**New:**
- `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md`
- `_bmad-output/test-artifacts/atdd-checklist-12-8.md`
- `packages/mill/README.md`
- `packages/mill/vitest.integration.config.ts`
- `packages/mill/tests/integration/helpers/fixture-topology.ts`
- `packages/mill/tests/integration/swap-flow.integration.test.ts`
- `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts`

**Modified:**
- `packages/sdk/src/swap-handler.ts`, `packages/sdk/src/swap-handler.test.ts`
- `packages/mill/src/mill.ts`, `packages/mill/src/mill.test.ts`
- `packages/mill/src/channel-state.ts`, `packages/mill/src/channel-state.test.ts`
- `packages/mill/src/index.ts`
- `packages/mill/package.json`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Recovery
To roll back all pipeline changes:
```
git reset --hard pipeline-start-12.8
```
To keep progress and resume later, leave as-is. Current HEAD contains two checkpoint commits on top of `a5c95a7`. The working tree still has uncommitted develop-step changes.

## Action Items
1. **New story needed**: swap rumor schema extension for sender-provided chain recipient address; threading through `MultiChainClaimIssuer`; un-skipping AC-3..AC-9, AC-12 in `swap-flow.integration.test.ts`.
2. Decide whether to salvage current work as a partial Story 12.8 (production wiring + AC-1/AC-2/AC-13 tests) and split the remainder into a new story, or block 12.8 entirely pending the schema fix.
3. Traceability matrix (AC-16) not generated; sprint-status.yaml still `ready-for-dev`.

## TL;DR
Production wiring carried over from 12.7 is done and green (9 new tests for AC-10..AC-15). Integration tests uncovered a real bug in Story 12.4 — the sender's Nostr pubkey is being passed where a 20-byte EVM address is required — which blocks 8 of 17 ACs. The dev-story agent correctly honored the story's Dev Note ("do not edit 12.1..12.6 source"), so those tests are left as `it.skip` with a precise blocker reference. Pipeline stopped at step 4 per retry policy; the remainder of Story 12.8 needs either a new predecessor story to fix the schema or a scope renegotiation.
