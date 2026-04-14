---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-generation-mode',
    'step-03-test-strategy',
    'step-04-generate-tests',
    'step-05-validate-and-complete',
  ]
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-14T18:33:14Z'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md'
  - '_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md'
  - '_bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md'
  - '_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md'
  - '_bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md'
  - '_bmad-output/epics/epic-12-token-swap-primitive.md'
  - 'packages/sdk/src/stream-swap.ts'
  - 'packages/sdk/src/swap-handler.ts'
  - 'packages/sdk/src/gift-wrap.ts'
  - 'packages/mill/src/claim-issuer.ts'
  - 'packages/mill/src/payment-channel-signer.ts'
  - '_bmad/tea/testarch/knowledge/data-factories.md'
  - '_bmad/tea/testarch/knowledge/test-quality.md'
  - '_bmad/tea/testarch/knowledge/test-levels-framework.md'
  - '_bmad/tea/testarch/knowledge/test-priorities-matrix.md'
  - '_bmad/tea/testarch/knowledge/test-healing-patterns.md'
---

# ATDD Checklist — Epic 12, Story 12.9: Sender-provided chain recipient threading

**Date:** 2026-04-14
**Author:** Jonathan (TEA)
**Primary Test Level:** Unit (vitest) — SDK + Mill
**Mode:** yolo (autonomous)
**Stack Detected:** backend (pnpm workspace, TypeScript, vitest; no browser)

---

## Step 1 — Preflight & Context

### Stack detection

- `config.test_stack_type = auto` → repo is a pnpm/TypeScript monorepo with
  vitest across `packages/*`. No Playwright/Cypress. No `page.goto` /
  `page.locator` usage for this story's files.
- **Detected stack:** `backend`. Loading Backend Patterns profile only;
  Playwright/Pact.js loaders skipped.

### Prerequisites

- [x] Story 12.9 is `ready-for-dev` with 17 ACs and clearly scoped tasks.
- [x] vitest configured in both `@toon-protocol/sdk` and
      `@toon-protocol/mill` packages (existing `*.test.ts` files adjacent
      to sources).
- [x] Source call-sites exist at the lines the story identifies
      (`stream-swap.ts:301 buildSwapRumor`, `:346 validateChainAddress`,
      `swap-handler.ts:36 IssueClaimParams`, `claim-issuer.ts:139/178`).
- [x] `MultiChainClaimIssuer` defect reproducible: current code passes
      32-byte `senderPubkey` to `signer.signBalanceProof` which enforces
      20-byte EVM recipient.

### Knowledge fragments loaded (core tier)

- `data-factories.md` — shared fixture/factory patterns
- `test-quality.md` — Given-When-Then, one-assertion-per-behaviour, isolation
- `test-healing-patterns.md` — avoid brittle coupling; prefer behaviour checks
- `test-levels-framework.md` — backend tier selection (unit > integration > contract)
- `test-priorities-matrix.md` — P0/P1 triage

### Inputs confirmed

- Story file + 5 cross-referenced 12.x artifacts
- 4 source files to modify + 4 test files to extend
- Two-layer addressing contract (D12-010/011) is the invariant under test.
- Out-of-scope guardrails (8.1–8.5) are test-enforceable via regression
  assertions (e.g., `senderPubkey` still keys channel/inventory).

---

## Step 2 — Generation Mode

**Mode:** AI generation, unit-level only.

- Stack is pure backend; no UI, no recording needed.
- Story explicitly scopes proof-of-done to **the unit-test boundary**
  (AC-13..AC-16). Integration / E2E re-enablement is Story 12.8's job
  (Out-of-Scope 8.1).
- The workflow's Step 4A/4B subprocess split (API tests + E2E tests) does
  not apply: no HTTP API, no browser. All generated failing tests are
  **unit tests** colocated with their sources. The aggregation (Step 4C)
  role is fulfilled by this checklist.

---

## Step 3 — Test Strategy

### Acceptance-criteria → test-case map

| AC    | Scenario                                                                 | Level | File                                           | Priority | Failure mode (RED)                                                |
| ----- | ------------------------------------------------------------------------ | ----- | ---------------------------------------------- | -------- | ----------------------------------------------------------------- |
| AC-1  | Rumor carries `chain-recipient` tag; missing → handler T00               | Unit  | `packages/sdk/src/swap-handler.test.ts`        | P0       | Today no code emits/reads tag → assertion on tag absent fails.    |
| AC-2  | `chain-recipient` validated per `pair.to.chain` (evm/solana/mina)        | Unit  | `stream-swap.test.ts` + `swap-handler.test.ts` | P0       | `validateChainAddress` not wired on recipient → throw missing.    |
| AC-3  | Additive tag ordering — parse by name                                    | Unit  | `swap-handler.test.ts` (happy-path)            | P2       | Reader doesn't know the tag yet.                                  |
| AC-4  | `StreamSwapParams.chainRecipient` REQUIRED; runtime throw if missing     | Unit  | `stream-swap.test.ts`                          | P0       | Field does not exist → TS error in test; runtime throw missing.   |
| AC-5  | `streamSwap()` validates pre-send; throws INVALID_CHAIN_RECIPIENT        | Unit  | `stream-swap.test.ts`                          | P0       | No validation code path yet.                                      |
| AC-6  | `buildSwapRumor()` emits tag on every packet                             | Unit  | `stream-swap.test.ts`                          | P0       | Tag not emitted.                                                  |
| AC-7  | FULFILL `recipient` echo equals `params.chainRecipient`; else reject     | Unit  | `stream-swap.test.ts`                          | P1       | Sender equality check not tightened.                              |
| AC-8  | Handler reads tag + validates; missing/malformed → `ctx.reject('T00')`   | Unit  | `swap-handler.test.ts`                         | P0       | Handler doesn't read tag.                                         |
| AC-9  | Handler threads `chainRecipient` into `IssueClaimParams`                 | Unit  | `swap-handler.test.ts`                         | P0       | `IssueClaimParams` lacks field.                                   |
| AC-10 | `IssueClaimParams.chainRecipient: string` REQUIRED; `senderPubkey` stays | Unit  | `swap-handler.test.ts` (TS contract)           | P0       | Field missing on interface.                                       |
| AC-11 | `MultiChainClaimIssuer` passes `chainRecipient` (not `senderPubkey`)     | Unit  | `packages/mill/src/claim-issuer.test.ts`       | P0       | Current code passes `senderPubkey` → 32 vs 20 byte throw today.   |
| AC-12 | `IssueClaimResult.recipient` = `params.chainRecipient`                   | Unit  | `claim-issuer.test.ts`                         | P1       | Result still carries `senderPubkey`.                              |
| AC-13 | SDK stream-swap tests (required-field, format, tag-emit)                 | Unit  | `stream-swap.test.ts`                          | P0       | See AC-4/5/6 above.                                               |
| AC-14 | SDK swap-handler tests (missing tag, malformed tag, happy-path)          | Unit  | `swap-handler.test.ts`                         | P0       | See AC-8/9.                                                       |
| AC-15 | `chain-recipient` round-trips through NIP-59 wrap/unwrap                 | Unit  | `packages/sdk/src/gift-wrap.test.ts`           | P2       | Wire format is opaque; regression-guard only.                     |
| AC-16 | Mill unit test: 20-byte recipient to signer; rollback regression         | Unit  | `claim-issuer.test.ts`                         | P0       | Defect reproduction + fix assertion.                              |
| AC-17 | 12.8 skips stay skipped (no test authored here)                          | N/A   | N/A                                            | N/A      | Process check only — Task 8.1 guardrail.                          |

### Level selection rationale

- **Unit is correct level** for every AC: ACs target (a) interface shape
  (TypeScript contracts), (b) pure validation functions
  (`validateChainAddress`), (c) tag emission (pure string manipulation
  over `UnsignedEvent.tags`), (d) one-call-site argument threading in
  `MultiChainClaimIssuer`. No network, no chain, no multi-process state
  is implicated.
- **Integration omitted by design** (Story AC-17, Out-of-Scope 8.1): the
  existing `swap-flow.integration.test.ts` / `swap-flow-anvil.*`
  `it.skip(SCHEMA_BLOCKER, …)` sites stay skipped until Story 12.8
  resumes.
- **No contract tests** — there is no external HTTP/Pact contract; the
  wire-format "contract" is the kind:20032 rumor tag set, which is
  already exercised at the unit level by AC-15's round-trip.

### Priority matrix

| Priority | ACs                                               | Why                                                                                |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P0       | AC-1, 2, 4, 5, 6, 8, 9, 10, 11, 13, 14, 16        | Defect-remediation path; without these the Mill cannot sign any EVM claim.         |
| P1       | AC-7, 12                                          | Correctness/authenticity of the sender-side equality check and FULFILL echo.       |
| P2       | AC-3, 15                                          | Regression-guards (additivity + encryption opacity). One assertion each.           |
| N/A      | AC-17                                             | Scope-protection rule; asserted by _absence_ of test changes in 12.8 files.        |

### Red-phase compliance

All generated tests reference code paths that do not yet exist on
`epic-12` HEAD:

- `StreamSwapParams.chainRecipient` is not declared.
- `buildSwapRumor()` does not accept a `chainRecipient` argument.
- `IssueClaimParams.chainRecipient` is not declared.
- `MultiChainClaimIssuer.issueClaim()` passes `senderPubkey` at
  `claim-issuer.ts:139`.

Therefore tests WILL fail at **both compile time (TS)** and **runtime
(missing tag / wrong arg)** until Story 12.9 lands. TDD RED is satisfied
structurally — no `test.skip()` wrapping is required (in fact TS compile
failure is the stronger red signal for an interface-extension story).

---

## Step 4 — Failing Tests Generated (RED Phase Specs)

> **Delivery model.** Because Story 12.9 explicitly says *"No new files
> are required"* (§ Project Structure Notes), this checklist specifies
> the failing test cases to be added to **existing** test files rather
> than creating new files. Each block below is the authoritative test
> contract — it tells the dev agent exactly what to author. The
> step-04c-aggregate phase is collapsed into this section.

### 4.1 SDK — `packages/sdk/src/stream-swap.test.ts` (AC-13 + AC-4/5/6/7)

**Shared fixture (put at top-of-file or extract to local helper block):**

```ts
const FIXTURE_EVM_RECIPIENT = '0x' + '11'.repeat(20); // 20 bytes, lowercase hex
const FIXTURE_BAD_EVM = '0xNOTHEX';                   // malformed
```

#### Test 12.9-T1 — `streamSwapControlled` throws when `chainRecipient` missing

- **Maps to:** AC-4, AC-13(a)
- **Status:** RED — field does not exist on `StreamSwapParams`
- **Shape:**

  ```ts
  it('throws INVALID_STATE when chainRecipient is missing', async () => {
    const params = makeBaseParams(); // omit chainRecipient
    await expect(streamSwapControlled(params as any)).rejects.toMatchObject({
      name: 'StreamSwapError',
      code: 'INVALID_STATE',
    });
  });
  ```

- **RED reason today:** `StreamSwapParams` has no such field → test cannot
  import a type for it, and no runtime throw exists.

#### Test 12.9-T2 — Per-chain format validation (evm / solana / mina / unknown)

- **Maps to:** AC-2, AC-5, AC-13(b)
- **Status:** RED — `validateChainAddress` not applied to `chainRecipient`
- **Four sub-cases (table-driven):**

  ```ts
  it.each([
    { chain: 'evm:base:8453',    good: FIXTURE_EVM_RECIPIENT, bad: FIXTURE_BAD_EVM },
    { chain: 'solana:mainnet',   good: /* 32-byte base58 */,  bad: '!!!' },
    { chain: 'mina:mainnet',     good: /* base58 pubkey */,   bad: 'xxx' },
    { chain: 'unknown:chain',    good: 'anything',            bad: null },
  ])('validates chainRecipient against $chain', async ({ chain, good, bad }) => {
    // good passes pre-send; bad throws INVALID_CHAIN_RECIPIENT (or MillWalletError-family)
  });
  ```

- **RED reason:** no call to `validateChainAddress(chainRecipient, pair.to.chain, 'address')`
  exists in `streamSwapControlled()` entry.

#### Test 12.9-T3 — `buildSwapRumor()` emits `['chain-recipient', value]` on every packet

- **Maps to:** AC-6, AC-13(c)
- **Status:** RED — `buildSwapRumor` doesn't accept the arg
- **Shape:** use the existing MockMill harness that records
  `unwrappedRumors`; run a 3-packet swap and assert on each:

  ```ts
  const rumors = handle.unwrappedRumors;
  expect(rumors).toHaveLength(3);
  for (const r of rumors) {
    const tag = r.tags.find((t) => t[0] === 'chain-recipient');
    expect(tag?.[1]).toBe(FIXTURE_EVM_RECIPIENT);
  }
  ```

#### Test 12.9-T4 — FULFILL recipient mismatch is rejected (AC-7)

- **Maps to:** AC-7
- **Status:** RED — sender-side equality check not tightened.
- **Shape:** configure the MockMill to echo a DIFFERENT recipient in its
  FULFILL metadata; assert `result.state !== 'success'` and that the
  packet appears in `result.rejections` with
  `reason === 'MILL_RECIPIENT_MISMATCH'`.

### 4.2 SDK — `packages/sdk/src/swap-handler.test.ts` (AC-14 + AC-1/8/9/10)

Three required sub-cases plus a typing check:

#### Test 12.9-T5 — Handler rejects T00 when `chain-recipient` tag is missing

- **Maps to:** AC-1, AC-8, AC-14(a)
- **Shape:** build a rumor with `swap-from`/`swap-to`/`amount` only,
  wrap, feed to `createSwapHandler()`; spy `ctx.reject` → expect
  `('T00', 'Internal error')`. Also assert `issueClaim` was NOT called.

#### Test 12.9-T6 — Handler rejects T00 on malformed-per-chain value

- **Maps to:** AC-2, AC-8, AC-14(b)
- **Shape:** same harness; inject `['chain-recipient', '0xNOTHEX']`
  with an `evm:*` pair → `ctx.reject('T00', ...)`. Repeat one solana
  malformed variant.

#### Test 12.9-T7 — Happy path: handler passes tag value through to `issueClaim`

- **Maps to:** AC-3 (order-independence), AC-9, AC-14(c)
- **Shape:** stub `ClaimIssuer` as `vi.fn()` returning a canned
  `IssueClaimResult`; assert:

  ```ts
  expect(stubIssuer.issueClaim).toHaveBeenCalledWith(
    expect.objectContaining({
      chainRecipient: FIXTURE_EVM_RECIPIENT,
      senderPubkey: expect.any(String), // preserved, not replaced
      pair: expect.objectContaining({ to: expect.objectContaining({ chain: 'evm:base:8453' }) }),
    }),
  );
  ```

- **AC-3 covered by** shuffling the rumor's tag array before wrapping
  (e.g., place `chain-recipient` first, then `nonce`, then others) —
  parse must still succeed by name.

#### Test 12.9-T8 — Static `IssueClaimParams` shape guard (AC-10)

- **Maps to:** AC-10
- **Shape:** a compile-time-only `expectTypeOf` (or equivalent `satisfies`)
  assertion that `IssueClaimParams` has BOTH
  `senderPubkey: string` AND `chainRecipient: string`. Prevents a future
  regression that removes `senderPubkey` thinking the new field replaces
  it (Out-of-Scope 8.3).

### 4.3 SDK — `packages/sdk/src/gift-wrap.test.ts` (AC-15)

#### Test 12.9-T9 — `chain-recipient` survives wrap → TOON encode → decode → unwrap

- **Maps to:** AC-15
- **Shape (one-assertion regression):**

  ```ts
  const rumor: UnsignedEvent = makeRumor([
    ['swap-from', 'USDC:evm:base:8453'],
    ['swap-to',   'ETH:evm:base:8453'],
    ['amount',    '1000000'],
    ['seq',       '0', '1'],
    ['nonce',     'deadbeef'],
    ['chain-recipient', FIXTURE_EVM_RECIPIENT],
  ]);
  const toon = wrapSwapPacketToToon(rumor, /* ... */);
  const { rumor: decoded } = await unwrapSwapPacketFromToon(toon, /* ... */);
  expect(decoded.tags).toContainEqual(['chain-recipient', FIXTURE_EVM_RECIPIENT]);
  ```

- **Why one test suffices:** NIP-59/NIP-44 layers treat the tag array as
  opaque. This is a belt-and-braces regression guard that an encoder
  change doesn't silently truncate an unknown tag.

### 4.4 Mill — `packages/mill/src/claim-issuer.test.ts` (AC-16 + AC-11/12)

#### Test 12.9-T10 — Signer receives 20-byte `chainRecipient`, NOT 32-byte `senderPubkey`

- **Maps to:** AC-11, AC-16(a)
- **Status:** RED — current code at `claim-issuer.ts:139` calls
  `signer.signBalanceProof({ ..., recipient: senderPubkey })` and the EVM
  signer throws on the 32-byte value. Adding `chainRecipient` to the call
  is the fix.
- **Shape:**

  ```ts
  const signBalanceProof = vi.fn(async () => new Uint8Array([0x01]));
  const signer = { chain: 'evm:base:8453', chainKind: 'evm' as const, signBalanceProof };
  // ... assemble MultiChainClaimIssuer with makeMockSigner replaced by `signer` ...
  await issuer.issueClaim({
    sourceAmount: 1_000_000n, targetAmount: 500n,
    pair: PAIR_USDC_TO_ETH,
    senderPubkey: SENDER_PUBKEY,             // 32-byte hex
    chainRecipient: FIXTURE_EVM_RECIPIENT,   // 20-byte hex
    rumor: makeRumor(),
  });
  expect(signBalanceProof).toHaveBeenCalledTimes(1);
  const arg = signBalanceProof.mock.calls[0][0];
  expect(arg.recipient).toBe(FIXTURE_EVM_RECIPIENT);
  expect(arg.recipient).not.toBe(SENDER_PUBKEY);
  expect(arg.recipient).toMatch(/^0x[0-9a-f]{40}$/);
  ```

#### Test 12.9-T11 — `IssueClaimResult.recipient` echoes `chainRecipient`

- **Maps to:** AC-12, AC-16(b)
- **Shape:** same call; assert `result.recipient === FIXTURE_EVM_RECIPIENT`
  and `result.recipient !== SENDER_PUBKEY`.

#### Test 12.9-T12 — Rollback regression: signer-throw still releases reserve + re-credits inventory

- **Maps to:** AC-16(c), Out-of-Scope 8.3 guardrail
- **Shape:** force `signBalanceProof` to `throw new Error('signer boom')`;
  assert (a) `issuer.issueClaim(...)` rejects with `MillWalletError`,
  (b) `channelState.release(SENDER_PUBKEY, ...)` was called with the
  **senderPubkey** key (NOT `chainRecipient`), (c) inventory is
  re-credited. One assertion per branch; the full rollback suite from
  12.4 is not re-derived.

#### Test 12.9-T13 (optional, nice-to-have) — Inventory + channel-state still keyed by `senderPubkey`

- **Maps to:** Out-of-Scope 8.3 guardrail (enforces the invariant in code)
- **Shape:** spy on `channelState.reserve` and assert the first argument
  equals `SENDER_PUBKEY`, NOT `FIXTURE_EVM_RECIPIENT`. Single assertion.
  If 12.4 tests already cover this, fold it into T10 rather than
  authoring a new test case.

### 4.5 Existing-test accommodation sweep (Task 7.1)

Any pre-existing test that constructs a `StreamSwapParams` or an
`IssueClaimParams` literal WILL break as soon as AC-4 / AC-10 land. Sweep
and add `chainRecipient: FIXTURE_EVM_RECIPIENT` to:

- `packages/sdk/src/stream-swap.test.ts` — every
  `streamSwap(...)` / `streamSwapControlled(...)` callsite (all existing
  Story 12.5 tests).
- `packages/sdk/src/swap-handler.test.ts` — any `rumor` literal that
  lacks the new tag (inject the tag; do not rely on default).
- `packages/mill/src/claim-issuer.test.ts` — every `issuer.issueClaim({…})`
  call in Story 12.4 tests. Use the same `FIXTURE_EVM_RECIPIENT`.
- `packages/mill/tests/integration/*` — **DO NOT EDIT**; the Story 12.8
  files stay untouched until 12.8 resumes (Out-of-Scope 8.1).

Green-gate: `pnpm --filter @toon-protocol/sdk test` and
`pnpm --filter @toon-protocol/mill test` BOTH must stay green after the
sweep + the 12.9 edits.

---

## Data Factories

No new factory file required. Shared fixture constants declared inline
per test file:

```ts
const FIXTURE_EVM_RECIPIENT = '0x' + '11'.repeat(20);
const FIXTURE_SENDER_PUBKEY = 'b'.repeat(64); // 32-byte hex secp256k1
```

If either constant would be duplicated across all three SDK test files,
extract to `packages/sdk/src/test-fixtures.ts` — but check for an
existing helper first (Story 12.9 testing standards: "check before
creating one"). As of 2026-04-14 no such file exists; inlining is
preferred to avoid scope-creep.

---

## Fixtures

No new Playwright-style fixtures required (backend stack). The existing
MockMill harness in `stream-swap.test.ts` is sufficient; extend it to
accept a `fulfillRecipientOverride?: string` option to drive Test 12.9-T4
without duplicating the harness.

---

## Mock Requirements

- **`signer.signBalanceProof`** (mill test T10/T12): `vi.fn()` capturing
  args; assert on `arg.recipient`.
- **`ClaimIssuer`** (swap-handler test T7): `vi.fn()` returning a canned
  `IssueClaimResult`; assert call args via `expect.objectContaining`.
- **`channelState.reserve` / `channelState.release`** (mill test T12/T13):
  spies on the real `MillChannelState` instance; assert keys are
  `senderPubkey`.
- **`MillInventory`** (mill test T12): real instance with a small
  opening balance; assert re-credit on rollback.

No network mocks, no MSW, no Pact, no HTTP. Pure in-memory.

---

## Required data-testid Attributes

N/A — backend story, no UI.

---

## Implementation Checklist

Mirrors Story 12.9 Tasks 1–7 but framed as *"the change that makes each
failing test pass"*. The dev agent should work test-by-test in this order
(topological: types → pure helpers → sender → handler → mill → sweep):

### Phase A — Types & Schema (unblocks everything)

- [ ] **Task 3.1** Add `chainRecipient: string` to `IssueClaimParams` in
      `packages/sdk/src/swap-handler.ts:~36` (REQUIRED).
      → Makes Test 12.9-T8 compile and pass.
- [ ] **Task 1.1** Add `chainRecipient: string` to `StreamSwapParams` in
      `packages/sdk/src/stream-swap.ts:~87` (REQUIRED).
      → Makes Test 12.9-T1 compile; runtime throw not yet added.

### Phase B — Sender (AC-4/5/6/7)

- [ ] **Task 1.2** In `streamSwapControlled()` entry, throw
      `StreamSwapError('INVALID_STATE', ...)` if `params.chainRecipient`
      is missing / non-string. Then validate with
      `validateChainAddress(params.chainRecipient, pair.to.chain, 'address')`;
      throw `INVALID_CHAIN_RECIPIENT` on failure.
      → Makes T1 and T2 pass.
- [ ] **Task 1.3** Extend `buildSwapRumor()` to accept `chainRecipient`
      and push `['chain-recipient', chainRecipient]` into `rumor.tags`.
      → Makes T3 and T9 pass.
- [ ] **Task 1.4** Plumb the field from `streamSwap()` → `streamSwapControlled()`
      → `buildSwapRumor()` call at `stream-swap.ts:~951`.
- [ ] **Task 4.1** After `decodeFulfillMetadata()` returns, if
      `metadata.recipient !== params.chainRecipient`, push a rejection
      with reason `MILL_RECIPIENT_MISMATCH`.
      → Makes T4 pass.

### Phase C — Handler (AC-1/2/3/8/9)

- [ ] **Task 2.1** Add a `chain-recipient` reader in `swap-handler.ts`
      alongside `findSwapPair()` (use the existing `findTagValue`
      helper).
- [ ] **Task 2.2** Validate the value against `pair.to.chain` with
      `validateChainAddress`. Choose re-export from `stream-swap.ts` OR
      one-file local dup (Out-of-Scope 8.5: do NOT introduce a new
      shared file).
- [ ] **Task 2.3** On missing/malformed, call `ctx.reject('T00', 'Internal error')`
      and emit the `malformed_rumor` debug-log event (match existing
      `handler.rumor_rejected` shape).
      → Makes T5, T6 pass.
- [ ] **Task 3.2** Populate `params.chainRecipient` at the
      `issuer.issueClaim({...})` call-site (`swap-handler.ts:~595`).
      → Makes T7 pass.

### Phase D — Mill (AC-11/12/16)

- [ ] **Task 3.3** In `packages/mill/src/claim-issuer.ts:~139`, change
      `recipient: senderPubkey` → `recipient: params.chainRecipient`.
      → Makes T10 pass.
- [ ] **Task 3.4** In `packages/mill/src/claim-issuer.ts:~178`, change
      `result.recipient = senderPubkey` → `result.recipient = params.chainRecipient`.
      → Makes T11 pass.
- [ ] **Task 3.5** Verify `channelState.reserve/release()` and inventory
      keys stay on `senderPubkey`.
      → Makes T12/T13 pass (regression-guard).

### Phase E — Test sweep (Task 7)

- [ ] **Task 7.1** Add `chainRecipient: FIXTURE_EVM_RECIPIENT` to every
      pre-existing `StreamSwapParams` / `IssueClaimParams` construction
      in 12.3, 12.4, 12.5 tests.
- [ ] `pnpm --filter @toon-protocol/sdk test` → all green.
- [ ] `pnpm --filter @toon-protocol/mill test` → all green.

### Scope-protection checks (DO NOT do these)

- [ ] **DO NOT** edit `packages/mill/src/payment-channel-signer.ts`
      (Out-of-Scope 8.2). The 20-byte enforcement stays.
- [ ] **DO NOT** re-enable `it.skip(SCHEMA_BLOCKER, …)` blocks in
      `swap-flow.integration.test.ts` or `swap-flow-anvil.integration.test.ts`
      (Out-of-Scope 8.1, Story AC-17). A single-line comment pointer to
      12.9 is allowed.
- [ ] **DO NOT** introduce a new `packages/sdk/src/shared-*.ts` helper
      (Out-of-Scope 8.5).
- [ ] **DO NOT** rekey inventory/channel on `chainRecipient`
      (Out-of-Scope 8.3).

**Estimated effort:** ~0.5 day for a dev familiar with Epic 12.

---

## Running Tests

```bash
# Story 12.9 RED-phase verification (will fail pre-implementation):
pnpm --filter @toon-protocol/sdk  test -- stream-swap.test.ts
pnpm --filter @toon-protocol/sdk  test -- swap-handler.test.ts
pnpm --filter @toon-protocol/sdk  test -- gift-wrap.test.ts
pnpm --filter @toon-protocol/mill test -- claim-issuer.test.ts

# Full green-gate at implementation close:
pnpm --filter @toon-protocol/sdk  test
pnpm --filter @toon-protocol/mill test

# NEVER run `pnpm test` at the workspace root (CLAUDE.md OOM warning).
```

Debug single test:

```bash
pnpm --filter @toon-protocol/mill test -- claim-issuer.test.ts -t "20-byte chainRecipient"
```

---

## Red-Green-Refactor Workflow

### RED (this checklist) — ✅ specified

- 13 failing test cases enumerated (T1..T13).
- All reference types or behaviours that do not yet exist on `epic-12`.
- TS compile errors + runtime AssertionError are both expected until
  Phase A/B/C/D land.

### GREEN (dev story 12.9)

- Work the Phase A → E ladder above; do NOT skip Phase A (types unblock
  everyone else).
- Run the per-package command after each phase to shrink the failing
  set monotonically.

### REFACTOR

- Consolidate the `validateChainAddress` reuse choice (re-export vs
  local-dup) to the lower-surface-area option.
- If `FIXTURE_EVM_RECIPIENT` duplicates across three SDK test files,
  extract to `packages/sdk/src/test-fixtures.ts`.
- Ensure `malformed_rumor` logging fields match the existing
  `handler.rumor_rejected` structured-log shape.

---

## Knowledge Base References Applied

- `test-levels-framework.md` — unit selected over integration per story
  AC-17 and because every AC target is a pure-function or one-call-site
  argument change.
- `test-priorities-matrix.md` — P0 for the defect-remediation path, P1
  for sender-side equality tightening, P2 for additivity /
  encryption-opacity regression guards.
- `test-quality.md` — Given-When-Then preserved; one meaningful
  assertion per test (T9 and T11 are deliberate one-liners).
- `data-factories.md` — shared `FIXTURE_EVM_RECIPIENT` pattern from
  story testing standards (§ Testing Standards).
- `test-healing-patterns.md` — tests assert on **behaviour observable at
  the contract boundary** (signer arg, issueClaim arg, rumor tag) not on
  private fields — keeps them robust under 12.9 refactoring.

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command (to be run by the dev agent at story-start):**

```bash
pnpm --filter @toon-protocol/sdk  test
pnpm --filter @toon-protocol/mill test
```

**Expected results:**

- `stream-swap.test.ts` — 4 new failures (T1..T4) + TS compile error on
  `StreamSwapParams.chainRecipient`.
- `swap-handler.test.ts` — 4 new failures (T5..T8) + TS compile error
  on `IssueClaimParams.chainRecipient`.
- `gift-wrap.test.ts` — 1 new failure (T9): tag round-trip succeeds for
  a literal rumor construction but no sender code path uses it yet →
  depends on whether T9 uses `buildSwapRumor()` (fails) or a literal
  tags array (passes immediately once added). **Prefer the literal-tags
  form** so T9 is a pure encoder regression guard and stays green once
  authored.
- `claim-issuer.test.ts` — 3 new failures (T10..T12) + likely cascade
  failures in pre-existing 12.4 tests that build `IssueClaimParams`
  without the new field (AC-14 sweep).

**Summary (expected at story start):**

- Total NEW tests: 12–13 (T13 optional).
- NEW tests expected failing: 12–13.
- Pre-existing tests expected failing (until sweep): O(10-20) across
  SDK + Mill (every `StreamSwapParams` / `IssueClaimParams` literal).
- Status: ✅ RED verified by **both** compile and runtime signals.

---

## Notes / Risks / Assumptions

- **Risk — re-export vs duplication of `validateChainAddress`.** Story
  leaves this to the implementer. The choice affects T7/T5/T6 very
  little; pick re-export to keep behaviour centralized unless it
  introduces a cycle (none expected — handler already imports from
  `stream-swap`-adjacent modules; check with `pnpm --filter @toon-protocol/sdk build`).
- **Risk — `MILL_RECIPIENT_MISMATCH` reason code naming.** Story
  suggests the name but does not mandate it. Any stable string is fine
  provided T4 and the dev code agree; avoid leaking it into the public
  `StreamSwapError.code` enum unless an existing pattern covers it.
- **Assumption — FULFILL metadata already carries `recipient`.** Per
  Story 12.6 reference in AC-7 ("`metadata.recipient` is copied onto the
  collected claim"); confirm by reading current
  `decodeFulfillMetadata()` before authoring T4. If absent, T4 degrades
  into a "if present, assert equality" soft-check.
- **Assumption — no new E2E or integration work.** Locked by AC-17 and
  Out-of-Scope 8.1.
- **Scope-creep guard — Test 12.9-T13.** Mark as OPTIONAL; do not
  author if 12.4's rollback tests already cover the key-by-pubkey
  invariant. A failing 12.4 regression would be a louder signal than a
  green 12.9 T13.
- **CLI session cleanup.** N/A — no browser/CLI sessions used.
- **Temp artifacts.** This checklist is the only artifact; written to
  `{test_artifacts}/atdd-checklist-12-9.md` per workflow default. No
  `/tmp` files used because the API/E2E subprocess fan-out is not
  applicable for a pure-unit backend story.

---

## Step 5 — Validation Summary

Ran through `checklist.md` criteria:

- [x] Prerequisites satisfied (story approved, vitest configured,
      framework present).
- [x] Test cases mapped 1:1 to acceptance criteria (AC-1..AC-16
      covered; AC-17 is a scope-protection rule, no test).
- [x] Tests designed to fail before implementation (types + runtime).
- [x] RED phase is structurally enforced by missing
      interface fields — no `test.skip()` band-aid needed.
- [x] Guardrails 8.1–8.5 are explicit in the implementation checklist.
- [x] CLI sessions cleaned up (none used).
- [x] Temp artifacts stored under `{test_artifacts}/` only.
- [x] No `pnpm test` at workspace root; per-package commands documented.
- [x] Output polished: no duplicate sections; terminology consistent
      with story ("`chainRecipient`", not "`chain_recipient`" in code
      identifiers; the `chain-recipient` spelling is reserved for the
      rumor tag name per AC-1).

### Test files to be edited (no new files)

| File                                             | New tests | Sweep updates |
| ------------------------------------------------ | --------- | ------------- |
| `packages/sdk/src/stream-swap.test.ts`           | T1..T4    | yes           |
| `packages/sdk/src/swap-handler.test.ts`          | T5..T8    | yes           |
| `packages/sdk/src/gift-wrap.test.ts`             | T9        | no            |
| `packages/mill/src/claim-issuer.test.ts`         | T10..T13  | yes           |

### Next recommended workflow

1. **Hand off to `bmad-bmm-dev-story`** with this checklist + the story
   markdown; the dev agent works Phase A → E.
2. After GREEN, run **`bmad-tea-testarch-trace`** against Story 12.9 to
   emit a traceability matrix proving AC-1..AC-16 coverage.
3. Then the separate **Story 12.8 resumption** can begin (its own dev
   cycle re-enables the `it.skip(SCHEMA_BLOCKER)` blocks).

---

## Contact

- Questions: ping TEA (@Jonathan) in standup.
- Refer to `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md`
  for the authoritative spec; this checklist is the ATDD companion.
- Refer to `_bmad/tea/testarch/knowledge/` for test-quality conventions.

---

**Generated by BMad TEA Agent (yolo mode)** — 2026-04-14T18:33:14Z
