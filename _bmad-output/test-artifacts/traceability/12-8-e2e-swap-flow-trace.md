# Story 12.8 — Traceability Matrix

**Story:** 12-8-e2e-swap-flow-integration-tests
**Date:** 2026-04-14 (session 4 — resume after Story 12.9 fix)
**Status:** done (all functional ACs covered by automated tests; review pass complete)

## Coverage summary

- **Functional ACs (AC-1..AC-15):** 15/15 covered
- **P0 scenarios:** 3/3 (AC-4, AC-8, AC-11)
- **P1 scenarios:** 9/9 (AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-12, AC-13, AC-15)
- **P2 scenarios:** 1/1 (AC-9, opt-in — runtime-skipped when Anvil down)
- **P3 (unit hardening):** 2/2 (AC-10, AC-14)
- **Process ACs (AC-16, AC-17):** this document + sprint-status.yaml flip

## Matrix

| AC | Priority | Test file | `it()` block | Status |
|---|---|---|---|---|
| AC-1.0 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-1.0 — fixture mnemonic is 12 words | PASS |
| AC-1.1 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-1.1 — connector-side (account 1) EVM address ≠ Mill-side (account 2) | PASS |
| AC-1.2 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-1.2 — mill.identity.pubkey is a valid 32-byte Nostr x-only pubkey | PASS |
| AC-1.3 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-1.3 — /health responds status:"ok" within 2s | PASS |
| AC-1.4 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-1.4 — sender has distinct Nostr pubkey from Mill | PASS |
| AC-2.1-5 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-2.1/2/3/4/5 — mockPublisher captures kind:10032 | PASS |
| AC-2.6 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-2.6 — parseIlpPeerInfo round-trips event without swapPairs | PASS |
| AC-3 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-3 — malformed kind:1059 payload → F01 "Invalid gift wrap" | PASS |
| AC-4.1 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-4.1 — single-packet swap | PASS |
| AC-4.2 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-4.2 — 10-packet swap: monotonic nonces | PASS |
| AC-4.3 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-4.3 — rate drift: rateProvider cycles | PASS |
| AC-5 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-5 — re-sending a captured PREPARE yields F04 | PASS |
| AC-6.1 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-6.1/6.2 — `decodeEventFromToon()` on captured PREPARE yields `kind === 1059` | PASS |
| AC-6.2 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-6.1/6.2 — `unwrapSwapPacketFromToon()` with non-Mill key throws (opaque to intermediaries) | PASS |
| AC-6.3 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-6.3 — 10 distinct Mill-side ephemeral pubkeys | PASS |
| AC-6.4 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-6.4 — FULFILL ciphertext sender-only readable | PASS |
| AC-7 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-7 — two distinct senders both receive claims | PASS |
| AC-8 | P0 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-8 — claims feed directly into buildSettlementTx (no transformation) | PASS |
| AC-9 | P2 | packages/mill/tests/integration/swap-flow-anvil.integration.test.ts | AC-9 — Anvil-backed settlement tx well-formedness | OPT-IN (runtime-skip when Anvil down) |
| AC-10 | P3 | packages/sdk/src/swap-handler.test.ts | [Story 12.8] DEFAULT_SEEN_PACKET_IDS_CAP + LRU eviction suite | PASS (from session 1) |
| AC-11 | P0 | packages/mill/src/mill.test.ts | Story 12.8 AC-11 — auto-create connector + stop() teardown | PASS (from session 1) |
| AC-12 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts (AC-7 block) + packages/mill/src/channel-state.test.ts | AC-7 (sticky channel binding assertions) + channel-state AC-12 suite | PASS |
| AC-13.1-3 | P1 | packages/mill/src/mill.test.ts | Story 12.8 AC-13 — publisher capture | PASS (from session 1) |
| AC-13.4 | P1 | packages/mill/tests/integration/swap-flow.integration.test.ts | AC-13.4 — rejecting publisher does NOT fail startMill() | PASS |
| AC-14 | P3 | packages/sdk/src/swap-handler.test.ts | [Story 12.8] DEFAULT_SEEN_PACKET_IDS_CAP + LRU eviction suite | PASS (from session 1) |
| AC-15 | P1 | packages/mill/vitest.integration.config.ts, packages/mill/package.json | infra (no dedicated test — structural check) | PASS |
| AC-16 | process | this file | — | DONE |
| AC-17 | process | _bmad-output/implementation-artifacts/sprint-status.yaml | — | DONE (flipped to review) |

## Test run evidence (session 4, 2026-04-14)

```
pnpm --filter @toon-protocol/mill test:integration
 ✓ tests/integration/swap-flow-anvil.integration.test.ts  (1 test | 1 skipped)
 ✓ tests/integration/swap-flow.integration.test.ts  (18 tests)
 Test Files  2 passed (2)
      Tests  18 passed | 1 skipped (19)

pnpm --filter @toon-protocol/mill test
 Test Files  11 passed (11)
      Tests  155 passed | 1 skipped (156)
```

(Session-4 review pass: AC-sanity filler removed; session-4 raw counts were
20 including filler — post-review 19 excluding filler. See Issues Fixed
below.)

## Session-4 deltas (Story 12.9 unblocked)

Story 12.9 delivered sender→chain-recipient threading:
- `StreamSwapParams.chainRecipient` REQUIRED
- Rumor carries `chain-recipient` tag
- `IssueClaimParams.chainRecipient` REQUIRED
- `MultiChainClaimIssuer.issueClaim()` passes `chainRecipient` to `signBalanceProof({ recipient })`
- Three-tier validation (sender pre-send, handler post-unwrap, claim-issuer pre-sign)
- FULFILL `recipient` equality check yields `MILL_RECIPIENT_MISMATCH`

With the schema drift fixed, the 8 previously-skipped AC blocks (AC-3, AC-4.1/4.2/4.3, AC-5, AC-6, AC-7, AC-8, AC-12) now drive real end-to-end streamSwap → handler → signed EVM claim → FULFILL → decrypt → buildSettlementTx pipelines and pass their assertions.

AC-9 remains opt-in per spec. In environments where `./scripts/sdk-e2e-infra.sh up` is running, the test drives a 10-packet swap, calls `buildSettlementTx`, and probes Anvil via `eth_call` to verify the unsigned tx bytes are RLP-valid with the correct EIP-155 chain-id baked in. Without Anvil, the test runtime-skips (no FAIL).
