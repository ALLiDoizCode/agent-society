---
story: 12-9
title: Sender-provided chain recipient threading (defect remediation)
mode: standalone-autonomous (#yolo)
date: 2026-04-14
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-identify-targets
  - step-03-generate-tests
  - step-04-run-and-verify
lastStep: step-04-run-and-verify
lastSaved: '2026-04-14'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md
  - packages/sdk/src/stream-swap.ts
  - packages/sdk/src/stream-swap.test.ts
  - packages/sdk/src/swap-handler.ts
  - packages/sdk/src/swap-handler.test.ts
  - packages/sdk/src/gift-wrap.test.ts
  - packages/mill/src/claim-issuer.ts
  - packages/mill/src/claim-issuer.test.ts
---

# Story 12.9 — Test Automation Expansion Summary

## 1. Preflight & context

- **Stack**: backend/fullstack TypeScript monorepo (pnpm workspaces). Test
  framework: Vitest. No browser runtime for this story — pure unit-test
  expansion at the SDK + Mill boundary.
- **Mode**: BMad-integrated. The story spec lists 17 ACs with explicit
  unit-test obligations (AC-13, AC-14, AC-15, AC-16) and explicit
  out-of-scope guardrails (AC-17 / Task 8.1) keeping integration-test
  work in Story 12.8.
- **Implementation status on arrival**: `status: review`, Tasks 1–7
  complete. Dev already shipped 13 new unit tests (T-1..T-4, T-5..T-8,
  T-10..T-13) plus the AC-15 round-trip regression test. Suite baseline:
  SDK 676/676, Mill 154/155 (1 pre-existing skip).

## 2. AC → Test coverage mapping (pre-expansion)

| AC    | Subject                                           | Test(s) already in tree                      |
| ----- | ------------------------------------------------- | -------------------------------------------- |
| AC-1  | `chain-recipient` tag on rumor; REQUIRED          | T-3 (sender), T-5 (handler)                  |
| AC-2  | Per-chain format validation                       | T-2a (evm), T-2b (solana); **gap: mina, unknown** |
| AC-3  | Tag-ordering independence                         | T-7 (AC-3) (handler)                         |
| AC-4  | REQUIRED `chainRecipient` on `StreamSwapParams`   | T-1                                          |
| AC-5  | Sender pre-flight validation                      | T-2a, T-2b                                   |
| AC-6  | Tag emitted on every packet                       | T-3                                          |
| AC-7  | FULFILL recipient equality (`MILL_RECIPIENT_MISMATCH`) | T-4                                      |
| AC-8  | Handler reads + validates tag                     | T-5, T-6a, T-6b                              |
| AC-9  | Handler threads into `issueClaim()`               | T-7                                          |
| AC-10 | `IssueClaimParams` shape extension                | T-8 (compile-time `satisfies` guard)         |
| AC-11 | `signBalanceProof(recipient = chainRecipient)`    | T-10                                         |
| AC-12 | `IssueClaimResult.recipient` echoes chainRecipient| T-11                                         |
| AC-13 | SDK stream-swap unit tests                        | T-1..T-4 (incomplete per AC-13b chain list)  |
| AC-14 | SDK swap-handler unit tests                       | T-5..T-7 (incomplete per AC-14b chain list)  |
| AC-15 | NIP-59 round-trip                                 | gift-wrap.test.ts Story 12.9 AC-15 suite     |
| AC-16 | Mill `signBalanceProof` receives chainRecipient   | T-10, T-11, T-12, T-13                        |
| AC-17 | Integration tests stay skipped                    | (verified by inspection — `it.skip` blocks intact) |

## 3. Gaps identified

Two related gaps, both in AC-13b / AC-14b chain-family enumeration:

1. **AC-13b (sender)**: AC explicitly lists "evm, solana, mina, unknown" as
   chain families whose format validation must be covered. T-2a and T-2b
   covered EVM and Solana malformed cases; **Mina and unknown were absent**.
2. **AC-14b (handler)**: Parallel gap — handler-side covered EVM and Solana
   malformed cases but not Mina. Without handler-side Mina coverage,
   the local-duplicate `validateChainRecipient` in `swap-handler.ts`
   (chosen over re-export per guardrail 8.5) could silently drift from
   `validateChainAddress` in `stream-swap.ts` on the Mina branch without
   any test failing.

No other ACs were uncovered. AC-3 (tag-order independence) is exercised on
the handler side (T-7 AC-3) — the only place where parsing order matters.
AC-17 (integration tests stay skipped) is scope-protection, not a testable
behavior.

## 4. Tests generated

Three new unit tests added to close the gaps:

| ID    | File                                             | AC mapping  | Priority | Summary                                                                       |
| ----- | ------------------------------------------------ | ----------- | -------- | ----------------------------------------------------------------------------- |
| T-2c  | `packages/sdk/src/stream-swap.test.ts`           | AC-2, AC-5, AC-13b | P1 | Mina malformed `chainRecipient` (short base58) → `INVALID_CHAIN_RECIPIENT`; mill never invoked. |
| T-2d  | `packages/sdk/src/stream-swap.test.ts`           | AC-2, AC-13b       | P2 | Unknown chain family: empty string → `INVALID_STATE`; non-empty opaque string permitted (fall-through to settlement). |
| T-6c  | `packages/sdk/src/swap-handler.test.ts`          | AC-2, AC-8, AC-14b | P2 | Handler-side Mina malformed `chain-recipient` tag → `T00 Internal error`; `issueClaim` never called. |

### Design notes

- **T-2d** exposed a validation-order subtlety: the non-empty string guard
  (throws `INVALID_STATE`) runs before the chain-format branch (throws
  `INVALID_CHAIN_RECIPIENT`). The test pins both halves so a refactor that
  collapses the guards cannot silently change the thrown code. A leading
  implementation used `INVALID_CHAIN_RECIPIENT` for the empty case and
  failed fast — I corrected the assertion rather than the production code
  because `INVALID_STATE` matches the Story 12.5 entry-guard shape
  (e.g., missing `senderSecretKey`) and is the documented contract.
- **T-6c** deliberately parallels T-6b so a future divergence between
  handler-local `validateChainRecipient` and sender-side
  `validateChainAddress` on the Mina branch (the exact risk flagged by
  guardrail 8.5 and the dev completion notes) will surface as a test
  failure.
- No fixtures, factories, or helpers needed: existing `samplePair`,
  `makeMockMill`, `makeRumor`, `makeMockIssuer`, `makeGiftWrappedCtx` all
  extended trivially via existing parameterization hooks (`toTag`,
  `chainRecipient`).

## 5. Verification results

```
pnpm --filter @toon-protocol/sdk test -- --run stream-swap.test.ts swap-handler.test.ts
 ✓ src/swap-handler.test.ts  (56 tests) 1025ms
 ✓ src/stream-swap.test.ts  (75 tests) 24740ms
 Test Files  2 passed (2)
      Tests  131 passed (131)
```

- Delta vs. pre-expansion: +3 tests (stream-swap 73→75, swap-handler 55→56).
- All three new tests pass on first run after the T-2d correction.
- No production code changed.
- AC-17 preserved: integration-test `it.skip` blocks untouched.

## 6. Out-of-scope confirmations (guardrail sweep)

- **8.1** No integration tests re-enabled. `swap-flow.integration.test.ts`
  and `swap-flow-anvil.integration.test.ts` remain `it.skip`.
- **8.2** `payment-channel-signer.ts` not touched.
- **8.3** Sender→channel sticky binding key (`senderPubkey`) unchanged;
  T-13 continues to guard the invariant.
- **8.4** No mill integration-topology work.
- **8.5** No new shared helper file/package introduced; gap tests reuse
  existing helpers.

## 7. Migrations / follow-ups

- **None required.** Story 12.9 unit coverage is now complete per the
  spec's per-chain enumeration (AC-13b, AC-14b). Story 12.8 remains the
  owner of re-enabling the skipped integration blocks (guardrail 8.1 /
  AC-17).
- Recommended **future** follow-up (not in this story's scope): if
  Story 12.8 resumes and adds a Mina integration pair, the T-2c/T-6c
  unit tests will keep the format validators honest at the unit
  boundary so a Mina integration failure points at routing/settlement
  rather than format-checking drift.
