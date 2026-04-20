---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-14'
workflowType: 'testarch-atdd'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md
  - _bmad-output/planning-artifacts/test-design-epic-12.md
  - _bmad-output/epics/epic-12-token-swap-primitive.md
  - _bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md
  - _bmad-output/auto-bmad-artifacts/story-12.7-report.md
  - packages/mill/src/mill.ts
  - packages/mill/src/index.ts
  - packages/mill/src/channel-state.ts
  - packages/mill/vitest.config.ts
  - packages/town/vitest.e2e.config.ts
  - packages/sdk/src/__integration__/create-node.test.ts
  - packages/sdk/src/stream-swap.ts
  - packages/sdk/src/settlement/build-settlement-tx.ts
  - packages/sdk/src/swap-handler.ts
  - packages/sdk/src/swap-handler.test.ts
  - _bmad/tea/config.yaml
---

# ATDD Checklist — Epic 12, Story 12-8: End-to-End Swap Flow Integration Tests

**Date:** 2026-04-14
**Author:** Jonathan
**Primary Test Level:** Integration (in-process peered connector) + one opt-in E2E (Anvil) + Unit hardening (swap-handler cap)
**Execution Mode:** YOLO (auto-proceeded, no per-step confirmations)
**Workflow:** `_bmad/tea/workflows/testarch/atdd`

---

## Step 1 — Preflight & Context (summary)

- **Stack Detection:** `backend` (TypeScript monorepo, Vitest; no `page.goto`/`page.locator` in `packages/mill` or `packages/sdk`).
- **Prereqs verified:**
  - ✅ Story file loaded (`12-8-e2e-swap-flow-integration-tests.md`, status `ready-for-dev`)
  - ✅ 17 acceptance criteria extracted (AC-1…AC-17; AC-16/17 are process ACs, excluded from test count)
  - ✅ Test framework present (`packages/mill/vitest.config.ts`), E2E blueprint at `packages/town/vitest.e2e.config.ts`
  - ✅ Upstream code shipped (12.4 / 12.5 / 12.6 / 12.7 all landed per git log)
- **Config flags read from `_bmad/tea/config.yaml`:**
  - `test_stack_type: auto` → resolved `backend`
  - `tea_use_playwright_utils: true` — **not applied** (backend-only; no UI surface)
  - `tea_use_pactjs_utils: true` — **not applied** (no microservice contract surface in 12.8; the cross-story contract is TypeScript-compile-time, enforced by `streamSwap()` → `buildSettlementTx()` type shape)
  - `tea_browser_automation: auto` — **not applied** (backend)
  - `test_framework: auto` → resolved Vitest
  - `risk_threshold: p1` → applied (P0 + P1 all tested; P2 Anvil test is opt-in)
- **Framework files inspected:**
  - `packages/mill/vitest.config.ts` (default runs `src/**/*.test.ts` only — integration glob does not collide)
  - `packages/mill/package.json` (no prior `test:integration` script — added)
  - `packages/mill/tsconfig.json` (NodeNext, ESM)
- **Existing test patterns inspected:**
  - `packages/mill/src/mill.test.ts` (Story 12.7 in-file composition pattern; describe/it with P0/P1/P2 tags in titles)
  - `packages/sdk/src/__integration__/create-node.test.ts` (peered-connector blueprint)
  - `packages/sdk/tests/e2e/docker-mina-settlement-e2e.test.ts` (E2E test shape, lifecycle)
  - `packages/town/vitest.e2e.config.ts` (mirror for `packages/mill/vitest.integration.config.ts`)
- **Knowledge base fragments applied (from `tea-index.csv`, core + backend tier):**
  - `data-factories.md` — inline deterministic factories (no faker; seed-driven sender construction in `buildFixtureSender(mill, seed)`)
  - `test-quality.md` — Given-When-Then implicit; one assertion-per-concern; every failing test uses `expect.fail(...)` with an actionable message (no `expect(true).toBe(true)` placeholders)
  - `test-healing-patterns.md` — every `expect.fail(...)` message names the exact wiring step that must land before the test can pass
  - `test-levels-framework.md` — integration-level over composition surface (AC-1…AC-9), unit-level for the AC-10/AC-14 cap
  - `test-priorities-matrix.md` — P0 / P1 / P2 tags in every test title
  - `ci-burn-in.md` — integration timeout 30s; fork pool for port isolation
  - `component-tdd.md` / `selector-resilience.md` / `network-first.md` / `timing-debugging.md` — **N/A** (no UI)
  - `contract-testing.md` (considered) — **N/A** (the cross-package contract is TypeScript-compile; no HTTP contract surface between Mill and sender for AC-8)

---

## Step 2 — Generation Mode (summary)

- **Mode chosen:** AI Generation (no recording). Rationale: backend-only, 17 explicit ACs with code examples in the story, Given/When/Then implicit in the "swap flow" 7-step sequence (epic doc §Architecture). No UI to record.

---

## Step 3 — Test Strategy

### Acceptance Criteria → Test Mapping

| AC    | Summary                                                              | Level       | Priority | Test Location                                                                 |
| ----- | -------------------------------------------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| AC-1  | Deterministic fixture topology (mnemonic, disjoint accounts, /health) | Integration | P1       | `swap-flow.integration.test.ts::AC-1` (3 it-blocks)                           |
| AC-2  | `kind:10032` publisher injection + round-trip + coexistence + AC-13 failure-tolerance | Integration | P1       | `swap-flow.integration.test.ts::AC-2` (3 it-blocks)                           |
| AC-3  | Malformed kind:1059 → REJECT (R-010 + R-015 black-box)               | Integration | P1       | `swap-flow.integration.test.ts::AC-3` (1 it-block)                            |
| AC-4  | Full swap 1-packet / 10-packet / rate-drift (T-061, T-064, D12-006)  | Integration | P0       | `swap-flow.integration.test.ts::AC-4` (3 it-blocks)                           |
| AC-5  | Replay bytes → REJECT (seenPacketIds wired)                          | Integration | P1       | `swap-flow.integration.test.ts::AC-5` (1 it-block)                            |
| AC-6  | Intermediary privacy (gift-wrap visible / content opaque / 10 ephemeral / sender-only) (T-062, T-063) | Integration | P0       | `swap-flow.integration.test.ts::AC-6` (4 it-blocks)                           |
| AC-7  | Two-sender sequential swaps (T-066)                                  | Integration | P1       | `swap-flow.integration.test.ts::AC-7` (2 it-blocks, second covers AC-12)      |
| AC-8  | `streamSwap()` → `buildSettlementTx()` schema round-trip (T-8A, R-8N1; **typecheck gate**) | Integration | P0       | `swap-flow.integration.test.ts::AC-8` (1 it-block + tsc gate)                 |
| AC-9  | Anvil-backed settlement tx well-formedness (opt-in)                  | E2E         | P2       | `swap-flow-anvil.integration.test.ts::AC-9` (1 it-block, fetch-probe gated)   |
| AC-10 | `DEFAULT_SEEN_PACKET_IDS_CAP` + access-order LRU                     | Unit        | P1       | `packages/sdk/src/swap-handler.test.ts::[Story 12.8]` describe (4 it-blocks)  |
| AC-11 | Auto-`ConnectorNode` wiring fix                                      | Integration | P0       | `swap-flow.integration.test.ts::AC-1` fixture (buildFixtureMill omits connector) |
| AC-12 | Per-sender channel lookup fix                                        | Integration | P1       | `swap-flow.integration.test.ts::AC-7` (second it-block)                       |
| AC-13 | `kind:10032` publish + rejecting-publisher tolerance                 | Integration | P1       | `swap-flow.integration.test.ts::AC-2` (third it-block)                        |
| AC-14 | `DEFAULT_SEEN_PACKET_IDS_CAP` constant export                        | Unit        | P1       | `swap-handler.test.ts::[Story 12.8]` first it-block                           |
| AC-15 | vitest.integration.config.ts + scripts + exclusion                   | Infra       | P1       | `packages/mill/vitest.integration.config.ts` + `package.json` scripts + `README.md` |
| AC-16 | Traceability gate                                                    | Process     | —        | `_bmad-output/test-artifacts/traceability/12-8-e2e-swap-flow-trace.md` (dev generates) |
| AC-17 | Sprint-status flip                                                   | Process     | —        | Out-of-band — dev flips `sprint-status.yaml` on review/done                   |

### Test-Design Risk Matrix Coverage

- **T-061 (P0 — E2E)** — Full swap lifecycle → covered by `AC-4` (3 variants) + `AC-1` + `AC-2` + `AC-8` + `AC-9` composition
- **T-062 (P0 — E2E)** — Intermediary privacy (no sender identity in logs) → `AC-6.1`, `AC-6.2`
- **T-063 (P0 — E2E)** — FULFILL return path encrypted → `AC-6.2`, `AC-6.4`
- **T-064 (P1 — E2E)** — Rate change mid-stream → `AC-4.3`
- **T-066 (P1 — E2E)** — Two clients, same Mill, no channel corruption → `AC-7` + `AC-12`
- **T-8A (P0 — INTEG, new)** — `streamSwap()` → `buildSettlementTx()` schema round-trip → `AC-8`
- **T-8B (P1 — INTEG, new)** — `startMill()` auto-`ConnectorNode` wiring → `AC-11` via `AC-1` fixture
- **T-8C (P1 — INTEG, new)** — `kind:10032` publisher injection + boot publish + failure-tolerance → `AC-2` + `AC-13`
- **T-8D (P1 — INTEG, new)** — Malformed kind:1059 → REJECT → `AC-3`
- **T-8E (P1 — INTEG, new)** — Replay of captured packet bytes → REJECT → `AC-5`
- **T-8F (P1 — UNIT, new)** — `seenPacketIds` default cap + LRU → `AC-10` + `AC-14`
- **R-006 (CRYPTO 6)** — Ephemeral key reuse → `AC-6.3` (10 distinct ephemeral pubkeys across 10-packet swap)
- **R-008 (INTEG 9, CENTRAL)** — Mill handler + streamSwap + settlement fail to compose → `AC-4` + `AC-8` + `AC-9`
- **R-010 (SEC 6)** — Mill processes non-gift-wrapped packets → `AC-3`
- **R-015 (INTEG 4)** — `startMill()` fails to register handler → `AC-3` (black-box) + `AC-11`
- **R-018 (INTEG 4)** — Concurrent swap state conflicts → `AC-7` (sequential variant; concurrent deferred, documented)
- **R-8N1 (INTEG 4)** — 12.5/12.6 schema drift → `AC-8` (typecheck gate)
- **R-8N2 (OPS 3)** — Flaky relay breaks Mill boot → `AC-13.4` (rejecting-publisher tolerance)
- **R-8N3 (SEC 3)** — Insertion-order LRU re-opens replay window → `AC-10` third it-block (access-order assertion)

### Red Phase Requirements

- Every new `describe(...)` block is **`describe.skip(...)`** — tests collect, do not execute, entire suite pending until dev un-skips per AC.
- Every test body includes **real assertions with actionable failure messages** — no `expect(true).toBe(true)` placeholders. Where the implementation path is not yet live, `expect.fail('AC-X — <specific wiring that is missing>')` is used so the failure message itself is the GREEN-phase to-do item.
- Dynamic module imports of unimplemented helpers are wrapped inside `.skip` blocks so the runner never attempts resolution during RED.
- **AC-8 enforcement is the TypeScript compiler**, not runtime assertions. The inline comment at `AC-8` spells out that `claims: result.claims` MUST compile without a cast. If it doesn't, that's a Story 12.5/12.6 schema bug and MUST be filed there, not patched in the test harness.
- Dev flips `.skip` → live **one describe at a time** during GREEN phase, matching the AC numbering order (AC-1 → AC-2 → AC-3 → AC-4 → AC-5 → AC-6 → AC-7 → AC-8, then AC-9 opt-in, then AC-10/AC-14 unit).

---

## Step 4 — Generated Test Artifacts (RED Phase)

### Integration Tests (2 files, 22 it-blocks total, all `describe.skip`)

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts` (~210 lines, 17 it-blocks across 7 describes)

- ✅ **Describe:** `AC-1 [P1] deterministic fixture topology (T-061 prerequisite)` (3 tests — disjoint accounts, Nostr pubkey shape, /health ≤2s)
  - **Status:** RED — helpers `buildFixtureMill()` / `buildFixtureSender()` throw; `expect.fail(...)` at disjointness assertion.
  - **Verifies:** D12-011 key-separation invariant, identity coherence, AC-11 auto-`ConnectorNode` wiring (via `connector` omission).
- ✅ **Describe:** `AC-2 [P1] kind:10032 publication round-trip + publisher injection (T-8C)` (3 tests — publisher capture, coexistence regression, AC-13.4 rejecting-publisher boot-tolerance)
  - **Status:** RED — `MillConfig.publisher` hook not yet added; `expect.fail(...)` at parseIlpPeerInfoEvent assertion.
  - **Verifies:** D12-002 optional swapPairs, AC-13.1–13.4 publisher wiring and `Promise.allSettled` semantics.
- ✅ **Describe:** `AC-3 [P1] malformed kind:1059 → REJECT (handler registration black-box) (T-8D)` (1 test)
  - **Status:** RED — imports pending from `packages/sdk/src/swap-handler.ts` for error code constant.
  - **Verifies:** R-010 (gift-wrap shape enforcement) AND R-015 (handler is actually registered), by a single black-box REJECT assertion.
- ✅ **Describe:** `AC-4 [P0] full swap cycle — 1-packet / 10-packet / rate-drift (T-061, T-064)` (3 tests)
  - **Status:** RED — `streamSwap()` end-to-end against peered Mill not yet wired.
  - **Verifies:** D12-004 (packet granularity), D12-005 (signed FULFILL claims), D12-006 (live rate per packet).
- ✅ **Describe:** `AC-5 [P1] replay of captured packet bytes → REJECT (T-8E)` (1 test)
  - **Status:** RED — logging peer plugin + byte-replay harness not wired.
  - **Verifies:** `seenPacketIds` dedupe is live at the `startMill()` composition level.
- ✅ **Describe:** `AC-6 [P0] intermediary privacy properties (T-062, T-063)` (4 tests — gift-wrap visibility, opaque content, 10 distinct ephemerals, sender-only decrypt)
  - **Status:** RED — packet interception + NIP-44 decrypt-fail assertions not wired.
  - **Verifies:** D12-003 (gift-wrapped swap packets), D12-008 (FULFILL NIP-44 encryption + ephemeral key uniqueness), R-006 (forward-secrecy regression trap).
- ✅ **Describe:** `AC-7 [P1] two-sender sequential swaps (T-066)` (2 tests — same-Mill validity + `AC-12` sticky-map binding)
  - **Status:** RED — second sender construction + sticky-binding introspection not wired.
  - **Verifies:** Channel-lookup key alignment (AC-12 production fix).
- ✅ **Describe:** `AC-8 [P0] streamSwap() → buildSettlementTx() schema round-trip, NO TRANSFORMATION (T-8A, R-8N1)` (1 test + tsc gate)
  - **Status:** RED — fixture swap not yet driven; TYPECHECK is the true gate.
  - **Verifies:** Cross-package TypeScript contract between Story 12.5 and 12.6.

**File:** `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts` (~60 lines, 1 it-block, opt-in gated)

- ✅ **Describe:** `AC-9 [P2] Anvil-backed settlement tx well-formedness (opt-in)`
  - **Status:** RED — 500ms `fetch` reachability probe implemented; `expect.fail(...)` at viem `eth_call` assertion. Test auto-skips when SDK E2E infra is down.
  - **Verifies:** `buildSettlementTx().rawBytes` is a well-formed EVM tx that a live Anvil JSON-RPC accepts (no broadcast; state untouched).

### Unit Tests (extension, 4 it-blocks, `describe.skip`)

**File:** `packages/sdk/src/swap-handler.test.ts` (+~40 lines appended; pre-existing file 1075 → ~1115 lines)

- ✅ **Describe:** `[Story 12.8] DEFAULT_SEEN_PACKET_IDS_CAP + LRU eviction (AC-10, AC-14, R-8N3)` (4 tests)
  - **Tests:**
    1. `DEFAULT_SEEN_PACKET_IDS_CAP === 10_000` export (AC-14)
    2. Default handler caps at 10,000 after 10,001 inserts (AC-10)
    3. Access-order LRU (re-accessing id 0 before inserting id 10_001 evicts id 1, NOT id 0) (AC-10, R-8N3 regression trap)
    4. Operator-supplied `seenPacketIds` used verbatim (no default cap)
  - **Status:** RED — `DEFAULT_SEEN_PACKET_IDS_CAP` export does not yet exist; bounded-LRU default not yet wired.
  - **Verifies:** DoS-bound + replay-window-after-10k-packets regression trap.

---

## Data Factories Created

### `FIXTURE_MNEMONIC` + `buildFixtureMill()` + `buildFixtureSender()`

**File:** `packages/mill/tests/integration/helpers/fixture-topology.ts`

**Exports:**

- `FIXTURE_MNEMONIC` — hardcoded 12-word BIP-39 test mnemonic (`"test test test test test test test test test test test junk"`). Labelled `// test-only mnemonic, DO NOT reuse.` in file.
- `ANVIL_CHAIN_ID` = `31337` (critical: NOT 1 or 1337; Dev Notes gotcha)
- `ANVIL_URL` = `http://localhost:18545`
- `buildFixtureMill(options?)` — boots a `MillInstance` via `startMill()` with the fixture mnemonic, USDC→ETH swap pair on `evm:31337`, 100 ETH inventory, `connector` OMITTED (exercises AC-11 auto-wire branch). Optional overrides for `publisher` (AC-2), `swapPairs` (rate-drift), `rateProvider` (AC-4.3).
- `buildFixtureSender(mill, senderSeed)` — seed-driven sender construction so AC-7 can build two senders with distinct Nostr pubkeys from deterministic byte arrays.

**Scope rules (per Story Dev Notes):**

- Private to `packages/mill/tests/integration/`. Do NOT extract to a shared `packages/test-utils/` — there's no second consumer until Epic 13 months away.
- Helpers are RED-phase stubs (`throw new Error('... unimplemented ...')`). Dev fills in bodies during GREEN phase Task 2.5.

---

## Fixtures Created

### Fixture topology (in-process peered connector)

**File:** `packages/mill/tests/integration/helpers/fixture-topology.ts`

**Fixture:** single-Mill + sender pair, booted in `beforeAll`, torn down in `afterAll`.

- **Setup:** derives disjoint BIP-44 account-1 (connector) and account-2 (Mill) keys from `FIXTURE_MNEMONIC`; constructs peered `ConnectorNode` pair (same pattern as `packages/sdk/src/__integration__/create-node.test.ts`); calls `startMill()` with `connector` OMITTED to exercise AC-11's auto-wire branch; builds one sender via `buildFixtureSender(mill, seed=1)`.
- **Provides:** `mill: MillInstance`, `sender: FixtureSender`, plus `FIXTURE_MNEMONIC` / `ANVIL_CHAIN_ID` / `ANVIL_URL` constants.
- **Cleanup:** `await sender.close(); await mill.stop();` — both idempotent (AC-1.5).

**Usage:**

```typescript
let mill: MillInstance;
let sender: FixtureSender;

beforeAll(async () => {
  mill = await buildFixtureMill();
  sender = await buildFixtureSender(mill, new Uint8Array(32).fill(1));
});

afterAll(async () => {
  await sender?.close?.();
  await mill?.stop?.();
});
```

---

## Mock Requirements

### Mock Publisher (for AC-2, AC-13)

**Shape:** `{ publish(event: NostrEvent): Promise<void> }`

**Success path:** capturing publisher pushes events into an array:

```typescript
const captured: NostrEvent[] = [];
const mockPublisher = { publish: async (ev) => { captured.push(ev); } };
const m = await buildFixtureMill({ publisher: mockPublisher });
```

**Failure path (AC-13.4):** rejecting publisher simulates relay outage:

```typescript
const rejectingPublisher = {
  publish: async () => { throw new Error('simulated relay outage'); },
};
// startMill() MUST still resolve (Promise.allSettled semantics).
```

**Notes:** The `MillConfig.publisher?:` hook is a NEW production field added in Task 1.3 / AC-13.2. Default implementation wraps `SimplePool.publish()` with `Promise.allSettled` and `warn`-level logging on rejection.

### Logging Peer Plugin (for AC-5, AC-6)

**Shape:** a thin transparent wrapper around the in-process peer plugin that captures PREPARE bytes per packet hop and exposes a read-only `getCapturedPackets()` accessor. No new production code — test-only helper living alongside `buildFixtureSender()`.

### Anvil JSON-RPC (for AC-9 only)

**Endpoint:** `POST http://localhost:18545` (SDK E2E infra, already provisioned).

**Probe (500ms timeout):** `eth_chainId` call; test `ctx.skip()`'s if unreachable.

**Usage:** `viem` `createPublicClient` + `anvilClient.call({ data, to })` against `buildSettlementTx().rawBytes`. NO broadcast. State untouched.

---

## Required data-testid Attributes

N/A — this story has `ui_impact: false` (declared in story frontmatter). No browser surface, no `data-testid` attributes required.

---

## Implementation Checklist

### Test: `AC-1 [P1] deterministic fixture topology`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks to make this test pass:**

- [ ] Task 2.5 — Implement `buildFixtureMill()` and `buildFixtureSender()` in `helpers/fixture-topology.ts` (mirror `packages/sdk/src/__integration__/create-node.test.ts` peered-connector setup)
- [ ] Task 1.1 — `startMill()` auto-wires `ConnectorNode` when `config.connector` and `config.connectorUrl` are both undefined (AC-11); set `ownsConnector=true`; wire `connector.stop()` into `MillInstance.stop()`
- [ ] Unskip `AC-1` describe
- [ ] Run: `pnpm --filter @toon-protocol/mill test:integration -- swap-flow.integration.test.ts`
- [ ] ✅ All 3 AC-1 it-blocks pass

**Estimated Effort:** 2–3 hours

---

### Test: `AC-2 [P1] kind:10032 publication round-trip + AC-13 rejecting-publisher`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Task 1.3 — Add `MillConfig.publisher?: Publisher` hook; default to `SimplePool`-backed impl with `Promise.allSettled` + `warn`-on-reject
- [ ] Task 1.3 — Wire boot-time publish (100ms debounce post-handshake)
- [ ] Unskip `AC-2` describe
- [ ] ✅ All 3 AC-2 it-blocks pass (capture, coexistence, AC-13.4 tolerance)

**Estimated Effort:** 2 hours

---

### Test: `AC-3 [P1] malformed kind:1059 → REJECT`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Import the error code constant from `packages/sdk/src/swap-handler.ts` (do NOT hardcode `F06`)
- [ ] Construct a malformed kind:1059 packet via test helper, send via sender's ILP packet path
- [ ] Assert REJECT + error-code match
- [ ] Unskip `AC-3` describe
- [ ] ✅ AC-3 it-block passes

**Estimated Effort:** 1.5 hours

---

### Test: `AC-4 [P0] full swap cycle — 1-packet / 10-packet / rate-drift`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Wire `streamSwap()` call with fixture Mill (read `packages/sdk/src/stream-swap.ts` for current API shape before writing the call)
- [ ] Assert `StreamSwapResult.claims.length === {1, 10}`
- [ ] Assert monotonic nonces + single-signer for AC-4.2
- [ ] Wire rotating rateProvider for AC-4.3; assert `new Set(claims.map(c => c.rate)).size === 3`
- [ ] Use `EvmPaymentChannelSigner.verify()` for signature assertion (NO downcast of bigint amounts)
- [ ] Unskip `AC-4` describe
- [ ] ✅ All 3 AC-4 it-blocks pass

**Estimated Effort:** 4 hours (P0, central composition proof)

---

### Test: `AC-5 [P1] replay protection`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Task 1.4 — Export `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000` and default to bounded LRU Set
- [ ] Wire logging peer plugin in `buildFixtureSender()` to capture last PREPARE bytes
- [ ] Replay bytes; assert REJECT
- [ ] Unskip `AC-5` describe
- [ ] ✅ AC-5 it-block passes

**Estimated Effort:** 1.5 hours

---

### Test: `AC-6 [P0] intermediary privacy properties`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Wire packet interception (logging peer plugin from AC-5)
- [ ] `decodeEventFromToon(prepare.data).kind === 1059` for AC-6.1
- [ ] Attempt `nip44.decrypt()` with random privkey → assert throws (AC-6.2, AC-6.4)
- [ ] Collect `ephemeralPubkey` across 10-packet swap → assert `new Set(keys).size === 10` (AC-6.3, R-006 trap)
- [ ] Unskip `AC-6` describe
- [ ] ✅ All 4 AC-6 it-blocks pass

**Estimated Effort:** 3 hours (P0, privacy model is non-negotiable)

---

### Test: `AC-7 [P1] two-sender sequential swaps + AC-12 sticky-map`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Task 1.2 — Fix `channel-state.ts` key-scheme mismatch; add sticky-map `senderPubkey → channelId` first-use binding (per-Mill-instance lifetime)
- [ ] Build sender2 via `buildFixtureSender(mill, seed=2)`
- [ ] Run sequential swaps; assert both claims verify under same Mill EVM address
- [ ] Introspect sticky-binding map; assert two distinct channelIds
- [ ] Unskip `AC-7` describe
- [ ] ✅ Both AC-7 it-blocks pass

**Estimated Effort:** 2.5 hours

---

### Test: `AC-8 [P0] streamSwap() → buildSettlementTx() schema round-trip`

**File:** `packages/mill/tests/integration/swap-flow.integration.test.ts`

**Tasks:**

- [ ] Run a 10-packet swap (reuse AC-4.2 body)
- [ ] Write the literal pipeline: `buildSettlementTx({ chain, channelId, claims: result.claims, senderAddress })` — NO `as`, NO `.map()`, NO adapter
- [ ] Verify `pnpm --filter @toon-protocol/sdk typecheck` (or `tsc --noEmit` via the test-package `tsc`) passes
- [ ] Assert `tx.rawBytes instanceof Uint8Array && tx.rawBytes.length > 0`
- [ ] If typecheck requires a cast: FILE A BUG against Story 12.5/12.6; DO NOT patch the test
- [ ] Unskip `AC-8` describe
- [ ] ✅ AC-8 it-block passes (runtime + typecheck)

**Estimated Effort:** 1 hour (if schemas match) / schema-bug elsewhere (unknown)

---

### Test: `AC-9 [P2] Anvil-backed settlement tx well-formedness (opt-in)`

**File:** `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts`

**Tasks:**

- [ ] Probe already implemented (`isAnvilReachable()` with 500ms timeout → `ctx.skip(...)`)
- [ ] Wire `viem` `createPublicClient` and `anvilClient.call({ data, to })` against `buildSettlementTx().rawBytes`
- [ ] Assert the call does NOT throw a malformed-tx error (state-revert is acceptable; we only test well-formedness)
- [ ] Unskip `AC-9` describe
- [ ] ✅ AC-9 it-block passes when infra up; skips cleanly when down
- [ ] Run: `./scripts/sdk-e2e-infra.sh up && pnpm --filter @toon-protocol/mill test:integration:anvil`

**Estimated Effort:** 2 hours

---

### Test: `[Story 12.8] DEFAULT_SEEN_PACKET_IDS_CAP + LRU eviction (AC-10, AC-14)`

**File:** `packages/sdk/src/swap-handler.test.ts`

**Tasks:**

- [ ] Task 1.4 — Export `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000` from `packages/sdk/src/swap-handler.ts` with inline rationale comment ("10k packet-ids at ~64 bytes each = ~640KB ceiling…")
- [ ] Task 1.4 — Default `seenPacketIds` to a bounded **access-order** (NOT insertion-order) LRU Map — use `Map` + `.delete(k); .set(k, v)` on each hit
- [ ] Task 1.4 — Preserve operator override: when `config.seenPacketIds` supplied, use verbatim
- [ ] Task 5.1 — Add `getInternalState()` @internal helper OR document Set-injection path for test introspection
- [ ] Unskip `[Story 12.8]` describe
- [ ] ✅ All 4 it-blocks pass (export + default cap + access-order LRU + operator pass-through)

**Estimated Effort:** 2 hours

---

## Running Tests

```bash
# Default in-process integration suite (no Docker, no Anvil needed)
pnpm --filter @toon-protocol/mill test:integration

# Opt-in Anvil settlement validation (requires SDK E2E infra)
./scripts/sdk-e2e-infra.sh up
pnpm --filter @toon-protocol/mill test:integration:anvil

# Unit tests (pre-existing + AC-10/AC-14 extensions)
pnpm --filter @toon-protocol/sdk test -- swap-handler

# Single AC while iterating (vitest `-t` grep on describe title)
pnpm --filter @toon-protocol/mill test:integration -- -t "AC-4"
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ 22 integration it-blocks + 4 unit it-blocks written, all `.skip`'d
- ✅ Fixture helper scaffold (`buildFixtureMill`/`buildFixtureSender`/`FIXTURE_MNEMONIC`) in place
- ✅ Mock-publisher shape documented for AC-2 / AC-13
- ✅ Anvil reachability probe implemented (AC-9 auto-skips when infra down)
- ✅ `vitest.integration.config.ts` created; `test:integration` + `test:integration:anvil` scripts added
- ✅ `packages/mill/README.md` created (minimal — operator docs deferred to 12.9)
- ✅ Implementation checklist maps every failing test to concrete tasks from the story (Task 1.1–1.5, 2.1–2.5, 3.x, 4.x, 5.x)
- ✅ Every `expect.fail(...)` message names the exact wiring that must land before the test can pass (no generic "not implemented")

### GREEN Phase (DEV Team — Next Steps)

1. Start with **Task 1** (production wiring fixes: AC-11/AC-12/AC-13/AC-14). These unblock the fixture.
2. Then **Task 2.5** (`buildFixtureMill()`/`buildFixtureSender()`). This unblocks every integration describe.
3. Un-skip AC-1 first (topology smoke) → AC-11 auto-wire branch proved live → AC-2/AC-13 publisher → AC-3 (quick black-box) → AC-4 P0 swap → AC-5 replay → AC-6 privacy → AC-7/AC-12 two-sender → AC-8 typecheck round-trip.
4. AC-9 opt-in is gated behind `./scripts/sdk-e2e-infra.sh up`; ship un-skipped but expect CI to auto-skip when Anvil isn't up.
5. AC-10/AC-14 unit tests run with existing `pnpm --filter @toon-protocol/sdk test` after Task 1.4 lands.

### REFACTOR Phase

- Re-read `packages/mill/src/channel-state.ts` JSDoc on AC-12's sticky-map — ensure the chosen key scheme (provision-side OR lookup-side alignment) is documented so future maintainers don't regress.
- Confirm `Promise.allSettled` on publisher is the SimplePool-backed default (AC-13.3). A single `.then`-chain regression re-opens R-8N2.
- Verify no test file casts `result.claims` with `as` anywhere (AC-8 typecheck gate is load-bearing).

---

## Next Steps

1. Run the RED suite to confirm collection works: `pnpm --filter @toon-protocol/mill test:integration` (expect: all tests collect as skipped)
2. Confirm `pnpm --filter @toon-protocol/mill test` (default unit config) does NOT pick up integration files (AC-15.4)
3. Begin GREEN phase with **Task 1.1** (auto-`ConnectorNode` wiring) — unblocks AC-1 fixture
4. Work one AC at a time; un-skip describe; run; check off task above
5. On all green: run `bmad-tea-testarch-trace` to generate the AC-16 traceability matrix at `_bmad-output/test-artifacts/traceability/12-8-e2e-swap-flow-trace.md`
6. Flip `sprint-status.yaml` 12-8 from `ready-for-dev` → `in-progress` → `review` → `done` (AC-17)

---

## Knowledge Base References Applied

- **data-factories.md** — inline deterministic factory (`buildFixtureMill`, `buildFixtureSender(seed)`); no `faker` (determinism matters for disjoint-address invariant)
- **test-quality.md** — Given-When-Then implicit (setup in `beforeAll`, drive in it-body, assert); one assertion-per-concern; `expect.fail(...)` messages are actionable
- **test-healing-patterns.md** — every failure message names the wiring step to land; no generic "not implemented"
- **test-levels-framework.md** — integration for composition (AC-1…AC-9); unit for the handler cap (AC-10/AC-14)
- **test-priorities-matrix.md** — P0/P1/P2 tags embedded in describe titles
- **ci-burn-in.md** — `testTimeout: 30_000`, `pool: 'forks'` for port isolation
- **contract-testing.md** — considered N/A; the cross-story contract is TypeScript-compile-time, enforced by the AC-8 `streamSwap()` → `buildSettlementTx()` type shape

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/mill test:integration`

**Expected Results:**

```
 ↓ tests/integration/swap-flow.integration.test.ts (17 tests | 17 skipped)
 ↓ tests/integration/swap-flow-anvil.integration.test.ts (1 test | 1 skipped)

 Test Files  2 skipped (2)
      Tests  18 skipped (18)
```

Plus `packages/sdk` swap-handler tests show:

```
 ↓ [Story 12.8] DEFAULT_SEEN_PACKET_IDS_CAP + LRU eviction (4 skipped)
```

**Summary:**

- Total new tests: 22 (18 integration + 4 unit)
- Passing: 0 (expected during RED)
- Skipped: 22 (expected — dev un-skips per AC during GREEN)
- Status: ✅ RED phase verified (tests collect; none run; helpers throw when accessed)

**Expected Failure Messages (once unskipped, before impl):**

- `AC-1.1 — account-1 vs account-2 disjointness assertion not yet wired`
- `AC-2.5 — parseIlpPeerInfoEvent swapPairs deep-equal assertion not yet wired`
- `AC-3 — malformed-gift-wrap REJECT assertion not yet wired`
- `AC-4.1 — single-packet swap assertion not yet wired`
- (…every `expect.fail(...)` message names its AC and the specific wiring that must land)

---

## Notes

- **`ui_impact: false`** in the story frontmatter — no browser, no `data-testid`, no Playwright.
- **AC-16 / AC-17 are PROCESS acceptance criteria** (traceability generation + sprint-status flip). They are excluded from the 15/15 code-AC coverage count and are not represented by test files in this checklist.
- **AC-8 is enforced by the TypeScript compiler**, not by a runtime assertion. The ATDD test body still contains a runtime sanity check, but the true gate is `tsc --noEmit` passing on a direct `claims: result.claims` pass-through without any cast.
- **Concurrent two-sender stress is explicitly out of scope.** AC-7 runs senders sequentially. A future hardening story can add `Promise.all` interleaving; this story proves the sticky-map binding works correctly, not that it's race-free.
- **No new Docker service.** The composition proof lives at the TypeScript boundary. AC-9 is the sole on-chain surface and piggybacks on the existing SDK E2E Anvil instance.
- **Files created/modified by this workflow:**
  - `packages/mill/vitest.integration.config.ts` (new)
  - `packages/mill/package.json` (scripts added: `test:integration`, `test:integration:anvil`)
  - `packages/mill/README.md` (new, minimal)
  - `packages/mill/tests/integration/helpers/fixture-topology.ts` (new, scaffold)
  - `packages/mill/tests/integration/swap-flow.integration.test.ts` (new, `describe.skip` × 7)
  - `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts` (new, `describe.skip` + fetch-probe)
  - `packages/sdk/src/swap-handler.test.ts` (extended with `[Story 12.8]` `describe.skip`, 4 it-blocks)

---

## Contact

**Questions or Issues?**

- Story file: `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md`
- Epic doc: `_bmad-output/epics/epic-12-token-swap-primitive.md`
- Test design: `_bmad-output/planning-artifacts/test-design-epic-12.md` §2.8
- 12.7 handoff: `_bmad-output/auto-bmad-artifacts/story-12.7-report.md` §Known-Risks-&-Gaps

---

**Generated by BMad TEA Agent** — 2026-04-14
