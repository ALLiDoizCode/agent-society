# Story 12.9: Sender-provided chain recipient threading (defect remediation)

Status: done
ui_impact: false
epic: 12
story_id: 12-9
story_type: fix

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Story type:** `fix` (defect-remediation / predecessor to resume Story 12.8)

## Story

As a **swap sender (streamSwap caller)**,
I want to **supply the chain-specific recipient address (e.g., my 20-byte EVM address) at swap-time and have it flow through the gift-wrapped rumor to the Mill's claim signer**,
so that **the Mill can sign balance proofs against a chain-valid recipient — unblocking kind:1059 settlement and resuming Story 12.8's skipped E2E ACs (AC-3/4/5/6/7/8/9/12)**.

## Defect Context (origin of this story)

Story 12.8 session 3 discovered that `MultiChainClaimIssuer.issueClaim()` at
`packages/mill/src/claim-issuer.ts:139` passes the 32-byte Nostr `senderPubkey`
as the `recipient` argument to `EvmPaymentChannelSigner.signBalanceProof()`.
The EVM signer correctly enforces a 20-byte EIP-55 recipient at
`packages/mill/src/payment-channel-signer.ts:79` and throws
`"EVM recipient must be 20 bytes, got 32"` → `MillWalletError(SIGNING_FAILED)`.
The swap handler catches this and returns `ctx.reject('T00', 'Internal error')`;
`streamSwap()` surfaces the result as `state: 'failed', abortReason: 'all-rejected'`
with zero claims. Every kind:1059 swap packet fails at signing time before any
settlement can proceed.

**Root cause (schema gap, not just a local wiring bug):** the swap rumor
schema (Story 12.2, kind:20032) carries `swap-from`, `swap-to`, `amount`,
`seq`, `nonce` — but no chain-specific recipient address. The sender knows
which chain it wants payout on and which address it owns, but there is no
wire-format slot to carry that through the `gift-wrap → swap-handler →
claim-issuer → chain-signer` pipeline. The Mill therefore cannot produce a
signable balance-proof.

**Source of truth for the blocker:** `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md`
§ "12.4 schema-drift blocker (root cause)" and the Dev Agent Record session 3
Completion Notes List. Story 12.9 is the standalone remediation story
explicitly requested there: *"The bug needs to be filed as a standalone 12.x
story against `packages/mill/src/claim-issuer.ts` and the swap-rumor schema."*

> **Note:** Story 12.8's in-line references to "Story 12.9 (operator
> documentation)" predate this remediation story. Operator-docs work has
> been deferred (no new story id reserved yet); this 12.9 is a
> defect-fix story that unblocks 12.8's skipped ACs. Do not confuse the
> two when reading 12.8.

## Dependencies

- **Upstream (code deps, MUST be imported or modified — all already shipped):**
  - `@toon-protocol/sdk` → `StreamSwapParams`, `streamSwap`, `streamSwapControlled`, `buildSwapRumor`, `decodeFulfillMetadata`, `validateChainAddress` — from `packages/sdk/src/stream-swap.ts` (Story 12.5). This story extends the sender API surface and the rumor builder; `validateChainAddress` is reused for sender-side and handler-side address validation.
  - `@toon-protocol/sdk` → `IssueClaimParams`, `ClaimIssuer`, `createSwapHandler`, `findSwapPair`, `findTagValue` — from `packages/sdk/src/swap-handler.ts` (Story 12.3). This story extends `IssueClaimParams` with a REQUIRED `chainRecipient` field and wires the rumor-tag reader at the handler boundary.
  - `@toon-protocol/mill` → `MultiChainClaimIssuer`, `MillWalletError` — from `packages/mill/src/claim-issuer.ts` (Story 12.4). The defect site; `issueClaim()` is updated to pass `params.chainRecipient` instead of `params.senderPubkey` to `signer.signBalanceProof()`.
  - `@toon-protocol/mill` → `EvmPaymentChannelSigner` (read-only) — from `packages/mill/src/payment-channel-signer.ts` (Story 12.4). NOT modified; the 20-byte enforcement at line 78 is correct and is what surfaces the defect.
  - `vitest` — unit test framework; no new config.

- **Upstream (runtime contract, MUST match existing shapes — READ CAREFULLY):**
  - **Two-layer addressing invariant (D12-010/011):** `senderPubkey` (Nostr identity, 32-byte secp256k1) is distinct from `chainRecipient` (chain-layer payout address: 20-byte EVM, 32-byte Solana Ed25519 pubkey, Mina public-key string). The Mill cannot derive one from the other. This story codifies the separation at the `IssueClaimParams` contract boundary.
  - **Sender→channel sticky binding stays keyed by `senderPubkey`** (Story 12.8 session 3). Do NOT rekey `channelState.reserve()` / `channelState.release()` on `chainRecipient`. See Task 8.3.
  - **Rumor schema is additive** (Story 12.2). Existing tags (`swap-from`, `swap-to`, `amount`, `seq`, `nonce`) remain unchanged. The new `chain-recipient` tag extends 12.2's kind:20032 wire format.
  - **`validateChainAddress()` at `stream-swap.ts:346`** is the canonical chain-format validator. Reuse via export — do NOT re-implement on the handler side.

- **Upstream (documentation anchors — MUST read once before coding):**
  - `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md` § "12.4 schema-drift blocker (root cause)" and § "Session 3 deltas" — origin of this story; exact blocker signature and reproduction.
  - `_bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md` — rumor schema origin; `chain-recipient` is an additive extension.
  - `_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md` — `MultiChainClaimIssuer` origin; defect site context.
  - `_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md` — sender API whose `StreamSwapParams` this story extends.
  - `_bmad-output/epics/epic-12-token-swap-primitive.md` — D12-010/011 recipient-addressing decisions.

- **Downstream:**
  - **Story 12.8** — once 12.9 merges, 12.8's `it.skip(SCHEMA_BLOCKER, …)` blocks in `swap-flow.integration.test.ts` (AC-3/4/5/6/7/8/12) and `swap-flow-anvil.integration.test.ts` (AC-9) become unblocked. Re-enabling those is **Story 12.8's job**, not 12.9's (AC-17, Task 8.1).
  - **Epic 13 (Chain Bridge)** — any cross-chain routing that reuses `IssueClaimParams` will inherit the `chainRecipient` field.

- **Transitive:** None. **In particular, do NOT add:**
  - No modifications to `EvmPaymentChannelSigner` / `payment-channel-signer.ts`. The 20-byte enforcement is correct; fix the caller, not the callee (Task 8.2).
  - No new shared helper packages. The two options for validation reuse are (a) re-export `validateChainAddress` from `stream-swap.ts`, or (b) a one-file local duplicate in `swap-handler.ts`. Pick whichever has lower surface-area churn; do NOT introduce a new `@toon-protocol/*` package or a new `packages/sdk/src/shared-*.ts` file for this alone.
  - No integration-test re-enablement in this story (Task 8.1).
  - No rekey of inventory / channel bookkeeping from `senderPubkey` to `chainRecipient` (Task 8.3).

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Stories 12.1–12.7 shipped the primitives; 12.8 proved composition in-process but exposed a schema gap in 12.2's rumor format and a local conflation bug in 12.4's claim issuer. Story 12.9 fixes both so 12.8's ACs can resume. Directly relevant decisions:

- **D12-003 (NIP-59 gift-wrapped swap packets):** The `chain-recipient` tag is inside the NIP-59 inner rumor (sealed, then gift-wrapped). Intermediaries never see it — the privacy property 12.2 established is preserved. The schema addition is opaque to the encryption layer (AC-15 regression-guard).
- **D12-010 (Gift-wrap recipient is the Mill's Nostr pubkey):** Unchanged. This story does NOT touch the gift-wrap addressing.
- **D12-011 (Chain-layer settlement addresses are independent of Nostr identity):** This is the decision the 12.4 defect violated. Story 12.9 codifies D12-011 at the `IssueClaimParams` type boundary so the separation cannot regress.
- **D12-004 (Sender controls packet granularity):** `chainRecipient` is a per-swap parameter, NOT per-packet. It is set once on `StreamSwapParams` and echoed on every packet (AC-6); senders MUST NOT vary it mid-stream within a single `streamSwap()` call.

## Acceptance Criteria

**Schema (rumor wire format)**

1. The kind:20032 swap rumor carries a new tag `chain-recipient` whose value
   is the sender's chain-specific payout address (e.g., a 20-byte lowercased
   `0x`-prefixed EVM address for `evm:*` target chains). The tag is REQUIRED
   when the rumor is built; a rumor without it MUST be rejected by the swap
   handler as a malformed-rumor T00.
2. The `chain-recipient` value is validated against `pair.to.chain` at every
   boundary: sender (pre-send), swap-handler (post-unwrap), and claim-issuer
   (pre-sign). `evm:*` targets require `^0x[0-9a-f]{40}$` (20 bytes hex,
   lowercase); `solana:*` targets require base58 that decodes to exactly 32
   bytes; `mina:*` targets require a base58 public key string per existing
   `validateChainAddress()` conventions.
3. Schema additions are additive: a receiver that reads the rumor MUST NOT
   rely on any ordering among existing tags; tag parsing is by name.

**Sender API (`streamSwap` in `packages/sdk/src/stream-swap.ts`)**

4. `StreamSwapParams` gains a REQUIRED (non-optional) field
   `chainRecipient: string` (the sender's payout address for
   `pair.to.chain`). The field is declared non-optional on the interface
   so TypeScript callers get a compile-time error if it is omitted. For
   plain-JS callers (and for defense-in-depth), `streamSwapControlled()`
   also throws a `StreamSwapError('INVALID_STATE', …)` at entry if the
   field is missing or not a string — matching the shape of Story 12.5's
   existing construction-time throws (see `stream-swap.ts:663` for the
   `senderSecretKey` precedent).
5. `streamSwap()` validates `chainRecipient` against `pair.to.chain` using
   the same chain-format rules as AC-2 and throws
   `INVALID_CHAIN_RECIPIENT` (or equivalent `MillWalletError`-family
   error) BEFORE sending any packet if validation fails.
6. `buildSwapRumor()` includes the `['chain-recipient', <address>]` tag on
   every packet in the stream. The value is exactly the sender-supplied
   address — no transformation, no case-folding beyond what AC-2
   validation requires.
7. The Story 12.6 settlement-context `recipient` field echoed back via
   FULFILL metadata (accumulated at `stream-swap.ts:~1147` where
   `metadata.recipient` is copied onto the collected claim) MUST equal
   the sender's `chainRecipient` — i.e., the Mill does NOT substitute
   its own address. A mismatch is surfaced by the sender as a per-packet
   rejection (see Task 4.1; reason code `MILL_RECIPIENT_MISMATCH`). This
   story only tightens the equality assertion; the underlying
   `decodeFulfillMetadata` machinery from 12.6 is unchanged.

**Receiver — swap handler (`packages/sdk/src/swap-handler.ts`)**

8. The swap handler reads the `chain-recipient` tag from the unwrapped rumor
   and validates format against `pair.to.chain` (AC-2). A missing or
   malformed value causes the handler to return `ctx.reject('T00',
   'Internal error')` — consistent with other malformed-rumor cases — and
   increments/logs a `malformed_rumor` debug event.
9. The handler threads the validated `chainRecipient` string into
   `ClaimIssuer.issueClaim()` via a new REQUIRED field on `IssueClaimParams`
   (see AC-10).

**Claim issuer contract (`packages/sdk/src/swap-handler.ts` + `packages/mill/src/claim-issuer.ts`)**

10. `IssueClaimParams` gains a REQUIRED field `chainRecipient: string` (the
    sender's chain-format payout address extracted from the rumor in AC-8).
    `senderPubkey` REMAINS on the params (still used for inventory ledger
    keying and the `channelState.reserve()` call — the sender→channel
    binding logic stays keyed by `senderPubkey`, not by `chainRecipient`).
11. `MultiChainClaimIssuer.issueClaim()` passes `params.chainRecipient`
    (NOT `params.senderPubkey`) as the `recipient` argument to
    `signer.signBalanceProof()`. The `senderPubkey` continues to key
    inventory and channel-state bookkeeping. The change is local to
    `claim-issuer.ts:~139`.
12. The `IssueClaimResult.recipient` field emitted back into FULFILL
    metadata (at `claim-issuer.ts:~178`) echoes `params.chainRecipient`,
    not `senderPubkey`, satisfying AC-7's equality assertion on the
    sender side.

**Unit tests — SDK**

13. `packages/sdk/src/stream-swap.test.ts` adds: (a) a required-field test
    proving missing `chainRecipient` throws at construction; (b) a
    format-validation test per chain family (evm, solana, mina, unknown);
    (c) a rumor-tag-emission test asserting the `chain-recipient` tag
    round-trips to the outbound wrapped packet.
14. `packages/sdk/src/swap-handler.test.ts` adds: (a) a missing-tag test
    proving the handler rejects with T00; (b) a malformed-tag-per-chain
    test; (c) a happy-path test asserting `ClaimIssuer.issueClaim()` is
    invoked with `params.chainRecipient` equal to the rumor tag value.
15. `packages/sdk/src/gift-wrap.test.ts` (or an adjacent test) asserts the
    `chain-recipient` tag round-trips through the NIP-59 wrap → TOON
    encode → TOON decode → unwrap cycle (the schema is opaque to the
    encryption layer; this is a regression-guard test, one assertion).

**Unit tests — Mill**

16. `packages/mill/src/claim-issuer.test.ts` adds a test that drives
    `issueClaim()` with an `evm:*` `SwapPair` and a concrete 20-byte
    `chainRecipient`, asserting: (a) the underlying signer sees a
    20-byte `recipient`, NOT the 32-byte `senderPubkey`; (b)
    `IssueClaimResult.recipient` equals the input `chainRecipient`; (c)
    the existing inventory-debit / channel-reserve / rollback semantics
    are unchanged (one regression-guard test per rollback path is
    sufficient — do not re-derive 12.4's full suite).

**Integration / cross-package posture**

17. Story 12.8's existing `it.skip(SCHEMA_BLOCKER, …)` blocks in
    `packages/mill/tests/integration/swap-flow.integration.test.ts` and
    `swap-flow-anvil.integration.test.ts` remain skipped at the end of
    this story. **Story 12.9 does NOT re-enable them** — resuming
    Story 12.8's ACs is Story 12.8's job. Story 12.9's done-ness is
    proven at the unit-test boundary (AC-13 through AC-16): the wire
    carries the field, both sides validate it, and the EVM signer
    receives a 20-byte recipient from a mill-side unit test. The Story
    12.8 blocker comment MAY be updated with a pointer to Story 12.9
    as the resolution.

## Tasks / Subtasks

- [x] **Task 1: Schema + sender-side threading (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6)**
  - [x] 1.1 Add `chainRecipient: string` to `StreamSwapParams` in
        `packages/sdk/src/stream-swap.ts`. Document as REQUIRED.
  - [x] 1.2 Reuse `validateChainAddress(value, chain, 'address')` for
        `chainRecipient` validation. Exported from `stream-swap.ts`
        (no new helper file). `validateParams()` throws
        `StreamSwapError('INVALID_CHAIN_RECIPIENT', …)` at
        `streamSwapControlled()` entry before the packet loop starts.
        `INVALID_CHAIN_RECIPIENT` added to the `StreamSwapError` code
        union in `packages/sdk/src/errors.ts`.
  - [x] 1.3 Extended `buildSwapRumor()` to accept `chainRecipient` and
        emit `['chain-recipient', <value>]` on every rumor. No
        transformation.
  - [x] 1.4 Wired the param through `streamSwap()` →
        `streamSwapControlled()` → `validateParams()` → packet loop →
        `buildSwapRumor()`. Per-packet cost stays O(1); validation runs
        once at entry.

- [x] **Task 2: Receiver-side tag extraction + validation (AC-8, AC-9)**
  - [x] 2.1 Added `findChainRecipient()` helper in
        `packages/sdk/src/swap-handler.ts`, reusing the `findTagValue`
        pattern to extract the `chain-recipient` tag.
  - [x] 2.2 Local `validateChainRecipient()` helper duplicated from
        `stream-swap.ts` (guardrail 8.5: local-duplicate chosen over
        re-export to avoid a circular module cycle — `stream-swap.ts`
        already imports `applyRate` from `swap-handler.ts`). Rules
        kept byte-for-byte identical; a doc-comment pins the invariant.
  - [x] 2.3 On missing/malformed, handler returns
        `ctx.reject('T00', 'Internal error')` and emits a
        `swap_handler.malformed_rumor` debug log.

- [x] **Task 3: `ClaimIssuer` contract extension (AC-10, AC-11, AC-12)**
  - [x] 3.1 Added REQUIRED `chainRecipient: string` to
        `IssueClaimParams` in `packages/sdk/src/swap-handler.ts`.
        `senderPubkey` retained and documented as the identity/inventory key.
  - [x] 3.2 Handler's `issueClaim()` call-site now populates
        `chainRecipient` from the validated rumor tag.
  - [x] 3.3 `packages/mill/src/claim-issuer.ts` now passes
        `params.chainRecipient` (NOT `senderPubkey`) as the
        `recipient` argument to `signer.signBalanceProof()`.
  - [x] 3.4 `result.recipient = chainRecipient` (NOT `senderPubkey`).
  - [x] 3.5 Verified: `senderPubkey` usages in
        `channelState.reserve()` / `channelState.release()` and
        inventory keying are unchanged. Task 8.3 guardrail upheld.

- [x] **Task 4: Sender-side FULFILL equality tightening (AC-7)**
  - [x] 4.1 In `packages/sdk/src/stream-swap.ts` `runLoop`, when
        `decodeFulfillMetadata()` returns a `recipient`, the sender
        asserts `recipient === params.chainRecipient`. On mismatch,
        the packet is pushed into `rejections` with
        `code: 'MILL_RECIPIENT_MISMATCH'` and the loop continues.

- [x] **Task 5: SDK unit tests (AC-13, AC-14, AC-15)**
  - [x] 5.1 `packages/sdk/src/stream-swap.test.ts` — added Story 12.9
        describe block with T-1 (missing field), T-2a/T-2b/T-2c
        (format validation per chain), T-3 (tag emission on every
        packet), T-4 (FULFILL recipient mismatch rejection).
  - [x] 5.2 `packages/sdk/src/swap-handler.test.ts` — added T-5
        (missing tag → T00), T-6a/T-6b (malformed EVM / Solana tag →
        T00), T-7 (happy-path threading through to `issueClaim`), T-7
        (AC-3 tag-ordering independence), T-8 (compile-time
        `IssueClaimParams` shape guard).
  - [x] 5.3 `packages/sdk/src/gift-wrap.test.ts` — added AC-15
        round-trip regression test proving the `chain-recipient` tag
        survives NIP-59 wrap → TOON encode → decode → unwrap.

- [x] **Task 6: Mill unit test (AC-16)**
  - [x] 6.1 `packages/mill/src/claim-issuer.test.ts` — added Story
        12.9 describe block with T-10 (signer receives 20-byte
        `chainRecipient`, not 32-byte `senderPubkey`), T-11
        (`IssueClaimResult.recipient` echoes `chainRecipient`), T-12
        (rollback regression: signer-throw still releases reserve +
        re-credits inventory, keyed on `senderPubkey`), T-13
        (inventory / channel-state still keyed by `senderPubkey`).

- [x] **Task 7: Existing-test accommodation (mandatory sweep)**
  - [x] 7.1 Updated every existing `streamSwap()` /
        `streamSwapControlled()` callsite in
        `packages/sdk/src/stream-swap.test.ts` to supply
        `chainRecipient: FIXTURE_EVM_RECIPIENT` (~40 call sites).
        Shared `FIXTURE_EVM_RECIPIENT = '0x' + '11'.repeat(20)`
        constant added. Story 12.6 AC-3 settlement-field tests
        updated to thread a per-chain `chainRecipient` so the AC-7
        equality check accepts the canned Mill `recipient` echo.
        `packages/sdk/src/swap-handler.test.ts` — `makeRumor()`
        helper emits a `chain-recipient` tag by default (with
        `chainRecipient: null` escape hatch for AC-1 missing-tag
        tests). `packages/mill/src/claim-issuer.test.ts` — every
        `issuer.issueClaim({…})` call now supplies
        `chainRecipient: FIXTURE_EVM_RECIPIENT`; pre-existing Story
        12.6 `result.recipient === SENDER_PUBKEY` assertion updated
        to the corrected `FIXTURE_EVM_RECIPIENT` expectation.
        `pnpm --filter @toon-protocol/sdk test` → 679/679 pass.
        `pnpm --filter @toon-protocol/mill test` → 154/155 (1
        pre-existing skip) pass.

## Out of Scope / Guardrails

The following are explicitly NOT tasks — they are scope-protection rules
for the implementing agent. Violating any of these regresses Story 12.8's
session-3 work or scope-creeps 12.9 into a different story.

- **8.1 DO NOT re-enable Story 12.8's `it.skip` blocks.** Resumption of
  AC-3/4/5/6/7/8/9/12 is Story 12.8's job, not 12.9's. The blocker-message
  text MAY be updated with a pointer to 12.9's resolution (single-line
  edit only).
- **8.2 DO NOT change `packages/mill/src/payment-channel-signer.ts`.** The
  20-byte EVM recipient enforcement at line 78 is correct. This story
  fixes the caller (`claim-issuer.ts`), not the callee.
- **8.3 DO NOT change the sender→channel sticky binding key
  (`senderPubkey`).** The sticky binding is keyed on Nostr identity by
  design (Story 12.8 AC-12); `chainRecipient` is chain-layer payload,
  not identity. `channelState.reserve()` / `channelState.release()`
  calls in `claim-issuer.ts:121–148` stay keyed on `senderPubkey`.
- **8.4 DO NOT attempt mill-integration-topology work.** The fixture
  topology landed in 12.8 session 3 (`fixture-topology.ts`,
  `buildFixtureMill`, `buildFixtureSender`) is sufficient for 12.8
  to resume once 12.9 is done. 12.9's proof-of-done-ness lives at the
  unit-test boundary only (AC-13 through AC-16).
- **8.5 DO NOT introduce a new shared helper file or package.** See
  Dependencies § Transitive. Pick re-export OR local-duplicate for
  `validateChainAddress` reuse on the handler side; do not third-option it.

## Dev Notes

### Architectural contract (why the fix goes where it does)

The protocol is a two-layer addressing system:

- **Nostr layer (identity):** `senderPubkey` (32-byte secp256k1 x-coord)
  identifies the swap sender across packets, keys the inventory ledger,
  keys the sender→channel sticky binding, and authenticates the seal in
  NIP-59 unwrap. This is the ONLY field that links packets to the same
  swap session at the application layer.
- **Chain layer (settlement):** `chainRecipient` is a chain-specific
  payout address (20-byte EVM, 32-byte Solana Ed25519 pubkey, Mina
  public-key string). It is the `recipient` field in the on-chain
  balance-proof hash. The Mill has no way to derive it from the Nostr
  pubkey — they are cryptographically independent keys. The sender MUST
  provide it.

The defect in 12.4 conflated these two layers. This story separates them
at the `IssueClaimParams` contract boundary so the fix cannot regress:
`senderPubkey` is identity-layer, `chainRecipient` is settlement-layer,
and the types enforce both.

### Rumor schema delta (final wire format after this story)

```
kind: 20032 (UnsignedEvent; no sig, no id)
tags:
  ['swap-from', '<assetCode>:<chain>']
  ['swap-to',   '<assetCode>:<chain>']
  ['amount',    '<decimal source micro-units>']
  ['seq',       '<packetIndex>', '<totalPackets>']
  ['nonce',     '<hex nonce>']
  ['chain-recipient', '<chain-format payout address>']   ← NEW IN 12.9
```

### `IssueClaimParams` delta (final contract after this story)

```ts
export interface IssueClaimParams {
  sourceAmount: bigint;
  targetAmount: bigint;
  pair: SwapPair;
  senderPubkey: string;        // identity-layer, unchanged
  chainRecipient: string;      // ← NEW: settlement-layer payout address
  rumor: UnsignedEvent;
}
```

### Known call-sites to update

- Sender: `packages/sdk/src/stream-swap.ts`
  - `StreamSwapParams` interface (~ln 87)
  - `streamSwapControlled()` construction-time validation block
  - `buildSwapRumor()` tag list (~ln 319)
  - FULFILL equality check in decode path (~ln 1147)
- Handler: `packages/sdk/src/swap-handler.ts`
  - `IssueClaimParams` interface (~ln 36)
  - Tag-reading section near `findSwapPair()` (~ln 331–369)
  - `issuer.issueClaim({...})` call-site (~ln 595–603)
- Issuer: `packages/mill/src/claim-issuer.ts`
  - `recipient:` argument to `signer.signBalanceProof` (ln 139)
  - `result.recipient` assignment (ln 178)

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** N/A — this story does not touch `.github/workflows`.
- **MAX_SAFE_INTEGER guard:** N/A — no new JS `number` assignment of u64
  values. Amounts stay `bigint`.
- **Golden test vectors (ZK story pairs):** N/A — not a ZK pair.

### Project Structure Notes

- Follows the established Epic 12 package split: protocol primitives in
  `packages/sdk`, Mill-side implementation in `packages/mill`. Types
  continue to flow sdk → mill (the Mill imports `IssueClaimParams` from
  `@toon-protocol/sdk`); there is no reverse dependency.
- No new files are required. All edits are in files listed under "Known
  call-sites to update".

### Testing Standards

- Per-package testing only: `pnpm --filter @toon-protocol/sdk test`
  and `pnpm --filter @toon-protocol/mill test`. DO NOT run
  `pnpm test` at the workspace root (CLAUDE.md OOM warning).
- Unit tests only. Integration re-enablement is out of scope (see
  AC-17 / Task 8.1).
- Use a shared fixture address `FIXTURE_EVM_RECIPIENT = '0x' + '11'.repeat(20)`
  within each test file (or a small shared `test-fixtures.ts` if it
  already exists in the package — check before creating one).

### References

- [Source: _bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md#12.4 schema-drift blocker] — origin of this story and exact blocker signature.
- [Source: packages/mill/src/claim-issuer.ts:139] — defect site (line referenced in story description).
- [Source: packages/mill/src/payment-channel-signer.ts:79] — the 20-byte EVM enforcement that surfaces the defect (CORRECT; do not change).
- [Source: packages/sdk/src/stream-swap.ts#buildSwapRumor] — rumor construction to extend (~ln 300).
- [Source: packages/sdk/src/stream-swap.ts#validateChainAddress] — chain-format validator to reuse (~ln 346).
- [Source: packages/sdk/src/swap-handler.ts#IssueClaimParams] — contract to extend (~ln 36).
- [Source: packages/sdk/src/swap-handler.ts#findSwapPair] — tag-reading pattern to follow (~ln 331).
- [Source: _bmad-output/epics/epic-12-token-swap-primitive.md] — epic spec (predates this defect; reference only).
- [Source: _bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md] — rumor schema origin; the `chain-recipient` tag is an additive extension of 12.2's wire format.
- [Source: _bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md] — the `MultiChainClaimIssuer` story whose schema this defect exposes.
- [Source: _bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md] — sender API whose params this story extends.

## Change Log

| Date       | Version | Description                                                                 | Author |
| ---------- | ------- | --------------------------------------------------------------------------- | ------ |
| 2026-04-14 | 0.1     | Story drafted (defect filed from 12.8 session 3 blocker).                    | SM     |
| 2026-04-14 | 0.2     | Adversarial review: added Dependencies, Epic Context, Out of Scope, Change Log; clarified AC-4/AC-7 wording; fixed stale line reference. | Dev    |
| 2026-04-14 | 1.3     | Code review pass #3 (yolo, final): adversarial re-audit + OWASP Top-10 posture check of the Story 12.9 attack surface (`stream-swap.ts`, `swap-handler.ts`, `claim-issuer.ts`). A03 injection / ReDoS review of the three chain-recipient regexes: all anchored, non-catastrophic. A04 design: two-layer addressing codified at the type boundary. A07 authn: `senderPubkey` still keys channel binding; `chainRecipient` is sealed inside NIP-59. A08 integrity: `MILL_RECIPIENT_MISMATCH` detects Mill-side substitution. Handler logs redact rumor payload. One LOW gap identified and fixed: pass #1 added `validateClaimIssuerChainRecipient` to `claim-issuer.ts` but no unit test exercised the third-tier malformed-path reject. Added T-14 (claim-issuer malformed-recipient pre-debit reject, asserts no signer / inventory / channel-state mutation). Mill suite 155/156 pass (+1 from T-14; 1 pre-existing skip). SDK 679/679 pass (unchanged). Issues found: 0 critical / 0 high / 0 medium / 1 low — all fixed. Status → done, sprint-status.yaml → done. | Reviewer |
| 2026-04-14 | 1.2     | Code review pass #2 (yolo): re-ran adversarial audit against post-pass-#1 state. All 17 ACs verified implemented with test coverage; three-tier AC-2 validation intact at sender/handler/claim-issuer; `IssueClaimParams.chainRecipient` REQUIRED at the type boundary; sender FULFILL equality check surfaces `MILL_RECIPIENT_MISMATCH` without accumulating; guardrails 8.1–8.5 upheld (integration `it.skip`s untouched, EVM signer unmodified, senderPubkey still keys channel/inventory, no new shared helper package, local-duplicate chosen over re-export for cycle avoidance). SDK 679/679 pass, Mill 154/155 pass (1 pre-existing skip). Issues found: 0 critical / 0 high / 0 medium / 0 low. Status stays `review` — pass #3 handles final `done` flip. | Reviewer |
| 2026-04-14 | 1.1     | Code review (yolo): added claim-issuer-side AC-2 validation tier (`validateClaimIssuerChainRecipient` in `packages/mill/src/claim-issuer.ts`) — the third boundary AC-2 requires was missing; fixed Story 12.4 T-026 test to supply `chainRecipient`; reformatted `packages/mill/src/mill.test.ts` noted; File List expanded; stale "676/676" counts corrected to 679/679; status → done. SDK 679/679 pass, Mill 154/155 pass (1 pre-existing skip). Issues found: 0 critical / 0 high / 2 medium / 2 low — all fixed. | Reviewer |
| 2026-04-14 | 1.0     | Implementation complete: Tasks 1–7 all checked. Added `chainRecipient` to `StreamSwapParams` + `IssueClaimParams`; extended `buildSwapRumor` with the `chain-recipient` tag; handler extracts + validates the tag and threads it to `ClaimIssuer`; `MultiChainClaimIssuer` now passes `chainRecipient` (not `senderPubkey`) to the balance-proof signer; sender-side FULFILL recipient equality check added (`MILL_RECIPIENT_MISMATCH`). 13 new unit tests across SDK + Mill; accommodation sweep updated ~50 existing callsites. SDK tests 679/679 pass, Mill tests 154/155 pass (1 pre-existing skip). Integration tests for Story 12.8 remain skipped per guardrail 8.1 with a pointer comment update. Status → review. | Dev |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]`

### Debug Log References

_None — implementation landed cleanly on the first pass; no HALT conditions._

### Completion Notes List

- **Two-layer addressing codified at the type boundary.** `IssueClaimParams` now declares both `senderPubkey: string` (identity-layer) and `chainRecipient: string` (settlement-layer) as REQUIRED. TypeScript enforces the separation so the Story 12.8 session-3 defect (passing 32-byte Nostr pubkey to a 20-byte EVM signer) cannot silently regress.
- **`validateChainAddress` duplication chosen over re-export.** `stream-swap.ts` already imports `applyRate` from `swap-handler.ts`, so re-exporting `validateChainAddress` from `stream-swap.ts` and importing it from `swap-handler.ts` would create a circular module cycle. Per guardrail 8.5 ("pick re-export OR local duplicate — do not third-option it"), a small local `validateChainRecipient()` in `swap-handler.ts` mirrors the sender's rules byte-for-byte (EVM `^0x[0-9a-f]{40}$`, Solana base58 decoding to 32 bytes, Mina base58 ≥32 chars). `validateChainAddress` is now exported from `stream-swap.ts` for any future non-cyclic consumers.
- **Sender-side AC-7 equality check is non-fatal.** A `recipient` mismatch in FULFILL metadata pushes the packet into `StreamSwapResult.rejections` with `code: 'MILL_RECIPIENT_MISMATCH'` and continues the loop, matching the shape of other per-packet rejection paths. Missing `recipient` (legacy pre-12.6 metadata) is permitted.
- **Sender→channel sticky binding preserved (guardrail 8.3).** `senderPubkey` remains the key for `channelState.reserve()`, `channelState.release()`, and inventory debit/credit. A dedicated regression test (`claim-issuer.test.ts` T-13) spies on `channelState.reserve` and asserts the first argument is `SENDER_PUBKEY`, NOT `chainRecipient`.
- **Integration tests remain skipped (guardrail 8.1).** Story 12.8's `it.skip(SCHEMA_BLOCKER, …)` sites in `swap-flow.integration.test.ts` and `swap-flow-anvil.integration.test.ts` are untouched functionally; the SCHEMA_BLOCKER message strings received single-line pointers to Story 12.9 as the resolution so a later reader is not misled.
- **Test accommodation sweep was wide.** ~40 `streamSwap()` callsites in `stream-swap.test.ts` gained `chainRecipient`; every `issueClaim({…})` in `claim-issuer.test.ts` gained `chainRecipient`; `swap-handler.test.ts`'s `makeRumor()` helper now emits the tag by default with a `chainRecipient: null` escape hatch for AC-1 missing-tag tests. Pre-existing Story 12.6 tests that asserted `result.recipient === SENDER_PUBKEY` were updated to the corrected `FIXTURE_EVM_RECIPIENT` expectation (the old assertion was the defect manifesting in the test suite).
- **Final test results.** `pnpm --filter @toon-protocol/sdk test` → 679/679 pass (33 files, +9 new 12.9 tests + 1 gift-wrap round-trip). `pnpm --filter @toon-protocol/mill test` → 154/155 pass (1 pre-existing skip in `payment-channel-signer.test.ts`, +4 new 12.9 tests).

### File List

Modified:

- `packages/sdk/src/stream-swap.ts` — added `chainRecipient: string` to `StreamSwapParams`; exported `validateChainAddress`; added validation in `validateParams()` throwing `INVALID_CHAIN_RECIPIENT`; extended `buildSwapRumor()` to emit the `chain-recipient` tag; added AC-7 FULFILL recipient equality check in `runLoop` generating `MILL_RECIPIENT_MISMATCH` rejections.
- `packages/sdk/src/swap-handler.ts` — added `chainRecipient: string` to `IssueClaimParams`; added local `validateChainRecipient()` + `findChainRecipient()` helpers (guardrail 8.5); handler now extracts and validates the `chain-recipient` tag from the inner rumor (T00 on missing/malformed) and threads `chainRecipient` into `ClaimIssuer.issueClaim(...)`.
- `packages/sdk/src/errors.ts` — added `INVALID_CHAIN_RECIPIENT` to the `StreamSwapError` code union.
- `packages/mill/src/claim-issuer.ts` — pass `params.chainRecipient` (not `senderPubkey`) as the `recipient` to `signer.signBalanceProof()`; echo `chainRecipient` on `IssueClaimResult.recipient`. Code-review follow-up: added the third AC-2 validation tier (`validateClaimIssuerChainRecipient`) at the claim-issuer boundary so the `chainRecipient` format is checked before the inventory debit / channel reservation — defense-in-depth for future non-EVM signers and for direct callers that bypass the swap-handler.
- `packages/mill/src/claim-issuer.test.ts` — code-review follow-up: supplied `chainRecipient: FIXTURE_EVM_RECIPIENT` on the Story 12.4 T-026 concurrent-issueClaim test that predated the REQUIRED field. Pass #3 follow-up: added T-14 exercising the claim-issuer-boundary malformed-recipient reject path (AC-2 third tier) — asserts `MillWalletError` is thrown and no inventory debit / channel reservation / signer call occurs.
- `packages/mill/src/mill.test.ts` — whitespace-only reformat at lines 555–559 (Story 12.8 AC-11 assertion) picked up by `pnpm format`; not behavior-changing.
- `packages/sdk/src/stream-swap.test.ts` — added Story 12.9 suite (T1–T4, 4 new tests); added `FIXTURE_EVM_RECIPIENT` constant; threaded `chainRecipient` through every existing `streamSwap()` / `streamSwapControlled()` callsite; updated Story 12.6 AC-3 helpers (`runWithData` / `runWithValidData`) to use per-chain-family recipient.
- `packages/sdk/src/swap-handler.test.ts` — added Story 12.9 suite (T5, T6a, T6b, T7, T7-AC3, T8, 6 new tests); `makeRumor()` now emits `chain-recipient` by default with a `chainRecipient: null` override to omit the tag.
- `packages/sdk/src/gift-wrap.test.ts` — added AC-15 round-trip regression test.
- `packages/mill/src/claim-issuer.test.ts` — added Story 12.9 suite (T10–T13, 4 new tests); added `FIXTURE_EVM_RECIPIENT` constant; threaded `chainRecipient` through every existing `issueClaim({…})` callsite; corrected Story 12.6 `result.recipient` assertion to the new chain-layer expectation.
- `packages/mill/tests/integration/swap-flow.integration.test.ts` — SCHEMA_BLOCKER message updated with pointer to Story 12.9 as resolution (single-line; tests stay `it.skip` per guardrail 8.1).
- `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts` — blocker message updated with same pointer.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 12.9 status ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md` — Status, Tasks/Subtasks, Dev Agent Record, File List, Change Log.

Created: _(none — story explicitly noted "No new files are required".)_
Deleted: _(none)_

## Code Review Record

### Review Pass #1 — 2026-04-14

- **Reviewer model:** Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]`
- **Scope:** Story 12.9 implementation (sender-provided chain recipient threading); yolo auto-fix mode.
- **Issue counts by severity:** Critical 0 · High 0 · Medium 2 · Low 2 · **Total 4** — all fixed in-pass.
  - Medium — AC-2 third-tier (claim-issuer boundary) chain-recipient validation missing; `mill.test.ts` absent from File List despite a formatting touch.
  - Low — stale `676/676` test counts in narrative (actual 679/679); `BoundedSeenPacketIds` blank-line cleanup.
- **Outcome:** All 4 issues fixed in the same pass.
  - Modified `packages/mill/src/claim-issuer.ts` → added `validateClaimIssuerChainRecipient` (third boundary tier codifies AC-2 at the claim-issuer entry).
  - Modified `packages/mill/src/claim-issuer.test.ts` → updated Story 12.4 T-026 to supply `chainRecipient: FIXTURE_EVM_RECIPIENT`.
  - Updated this story file's File List (added `packages/mill/src/mill.test.ts`) and Change Log v1.1.
- **Test results post-fix:** `pnpm --filter @toon-protocol/sdk test` → 679/679 pass. `pnpm --filter @toon-protocol/mill test` → 154/155 pass + 1 pre-existing skip in `payment-channel-signer.test.ts`.
- **Pipeline requirement — status NOT finalized by this pass.** The code-review pipeline for this story runs **three** review passes. The pass-#1 reviewer prematurely flipped `Status: review → done` and `sprint-status.yaml: 12-9 → done`. Both have been reverted to `review` so review passes #2 and #3 can run. Only the final pass may mark this story `done`. Do NOT re-flip to `done` until pass #3 completes.

### Review Pass #2 — 2026-04-14

- **Reviewer model:** Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]`
- **Scope:** Story 12.9 implementation (sender-provided chain recipient threading); yolo auto-fix mode; adversarial re-audit of post-pass-#1 state.
- **Audit methodology:** git-reality vs story File List cross-check; each of AC-1..AC-17 validated against concrete source lines and test ids; guardrails 8.1–8.5 re-verified; SDK + Mill test suites re-executed.
- **Findings:**
  - AC-1/AC-6: `chain-recipient` tag emitted in `buildSwapRumor` at `packages/sdk/src/stream-swap.ts:351`. Tag present on every packet. ✓
  - AC-2 (three-tier validation): sender at `stream-swap.ts:validateParams` (~ln 765); handler at `swap-handler.ts:findChainRecipient` / `validateChainRecipient` (ln 420–453); claim-issuer at `claim-issuer.ts:validateClaimIssuerChainRecipient` (ln 42–63, pass-#1 fix). ✓
  - AC-3: tag-ordering independence asserted by `swap-handler.test.ts:1298` (T-7 AC-3). ✓
  - AC-4/AC-5: `StreamSwapParams.chainRecipient` REQUIRED on TS interface (`stream-swap.ts:98`); runtime re-validation in `validateParams()` throws `INVALID_STATE` / `INVALID_CHAIN_RECIPIENT` before packet loop. ✓
  - AC-7: sender FULFILL equality check at `stream-swap.ts:1099–1122`, pushes `MILL_RECIPIENT_MISMATCH` rejection on mismatch, tolerates legacy (undefined) metadata. ✓
  - AC-8/AC-9: handler `findChainRecipient` + T00 reject at `swap-handler.ts:588–597`; threads to `issueClaim` at `:678`. ✓
  - AC-10/AC-11/AC-12: `IssueClaimParams.chainRecipient` REQUIRED in `swap-handler.ts:60`; `claim-issuer.ts:200–205` passes `chainRecipient` (not `senderPubkey`) to `signer.signBalanceProof`; `claim-issuer.ts:246` echoes `chainRecipient` on `result.recipient`. ✓
  - AC-13/AC-14/AC-15/AC-16: unit test ids T-1..T-13 accounted for across `stream-swap.test.ts`, `swap-handler.test.ts`, `gift-wrap.test.ts`, `claim-issuer.test.ts`. ✓
  - AC-17: `swap-flow.integration.test.ts` and `swap-flow-anvil.integration.test.ts` still `it.skip(SCHEMA_BLOCKER, …)`; blocker message updated with Story 12.9 pointer; no re-enablement. ✓
  - Guardrails 8.1–8.5 upheld: EVM signer (`payment-channel-signer.ts`) unchanged; channel/inventory keyed on `senderPubkey`; no new shared helper package; local-duplicate validators; integration tests untouched.
- **Issue counts by severity:** Critical 0 · High 0 · Medium 0 · Low 0 · **Total 0** — pass-#1 already addressed all findings; no further issues surfaced.
- **Test results:** `pnpm --filter @toon-protocol/sdk test` → 679/679 pass (33 files, 25.95s). `pnpm --filter @toon-protocol/mill test` → 154/155 pass (11 files, 1.28s; 1 pre-existing skip in `payment-channel-signer.test.ts`).
- **Outcome:** Status remains `review`. Pass #3 handles final `done` flip per pipeline requirement.
- **Action items / Review Follow-ups (AI):** None — all issues fixed in-pass; no deferred follow-ups were created by this review, so no new Tasks/Subtasks entries were required.

### Review Pass #3 — 2026-04-14 (final)

- **Reviewer model:** Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]`
- **Scope:** Story 12.9 final adversarial re-audit (yolo); OWASP Top-10 posture check across the three-file change set (`packages/sdk/src/stream-swap.ts`, `packages/sdk/src/swap-handler.ts`, `packages/mill/src/claim-issuer.ts`); authN / authZ and injection-risk review of the new `chain-recipient` wire field and its three-tier validators.
- **Audit methodology:**
  - Cross-checked git reality (uncommitted diff in `claim-issuer.ts` + `claim-issuer.test.ts`) against story File List and Change Log.
  - Verified each AC-1..AC-17 against concrete source lines (e.g., `stream-swap.ts:109`, `:351`, `:787`, `:1107`; `swap-handler.ts:61`, `:420`, `:445`, `:588`, `:678`; `claim-issuer.ts:144`, `:162`, `:204`, `:246`).
  - Ran both package test suites post-edit.
- **OWASP / security posture notes:**
  - **A03 Injection / ReDoS:** Three regexes govern chain-recipient validation. All three are anchored with `^…$`, fixed-length or bounded, single character class with no nested quantifiers → no catastrophic backtracking. `^0x[0-9a-f]{40}$` (EVM), `^[1-9A-HJ-NP-Za-km-z]+$` (base58; decode length bounds applied separately), identical shapes in sender / handler / claim-issuer tiers.
  - **A04 Insecure design:** Two-layer addressing (Nostr identity vs chain settlement) now codified in the `IssueClaimParams` type contract. Three-tier validation defends against direct-caller bypass and future non-EVM signers.
  - **A07 AuthN/AuthZ:** `senderPubkey`→channel sticky binding preserved (guardrail 8.3); `chainRecipient` is part of the sealed NIP-59 rumor — an on-wire attacker cannot substitute it without breaking the seal, which is authenticated against `senderPubkey`.
  - **A08 Data integrity:** Sender-side FULFILL `recipient` equality check emits `MILL_RECIPIENT_MISMATCH` on Mill-side substitution attempts (new integrity control introduced by 12.9).
  - **A09 Logging:** `swap_handler.malformed_rumor` debug log does NOT include the raw rumor payload.
  - **A01/A02/A05/A06/A10:** Not applicable to this change set (no access-control change, no crypto primitive weakening, no config surface, no new deps, no outbound HTTP).
- **Findings:**
  - LOW — Pass #1 added the claim-issuer-boundary validator `validateClaimIssuerChainRecipient` in `packages/mill/src/claim-issuer.ts` but no unit test exercised the malformed-recipient reject path at that boundary (T-10..T-13 all use the happy-path fixture). Transitively covered by sender/handler tests, but the defensive add deserves its own regression test so a future relaxation cannot silently revert it.
  - Fix: added **T-14** to `packages/mill/src/claim-issuer.test.ts` — drives `issueClaim()` with a 32-byte non-EVM-shaped recipient (the Story 12.8 defect value), asserts `MillWalletError` is thrown, asserts signer / inventory-debit / channel-state.reserve are all un-invoked (pre-debit rejection).
- **Issue counts by severity:** Critical 0 · High 0 · Medium 0 · Low 1 · **Total 1** — fixed in-pass.
- **Test results post-fix:**
  - `pnpm --filter @toon-protocol/sdk test` → 679/679 pass (33 files, ~26s).
  - `pnpm --filter @toon-protocol/mill test` → 155/156 pass (+1 from T-14; 1 pre-existing skip in `payment-channel-signer.test.ts`).
- **Outcome:** Status → **done**; `sprint-status.yaml:12-9-sender-chain-recipient-threading` → **done**. Guardrails 8.1–8.5 upheld throughout.
- **Action items / Review Follow-ups (AI):** None — final pass, all issues fixed.
