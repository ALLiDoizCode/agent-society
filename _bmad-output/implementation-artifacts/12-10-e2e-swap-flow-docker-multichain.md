# Story 12.10: E2E swap flow against Docker infra (multi-chain)

Status: ready
ui_impact: false
epic: 12
story_id: 12-10
story_type: feat

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Story type:** `feat` (graduates Story 12.8's in-process integration suite to real Docker infrastructure and expands coverage to all three supported chains: EVM, Solana, Mina).

## Story

As a **TOON Protocol maintainer shipping the Token Swap Primitive**,
I want **the Epic 12 swap composition proven end-to-end against real peered Docker infrastructure — real BTP transport, real kind:10032 relay publication, real NIP-59 gift-wraps, and real on-chain settlement on every supported chain family (EVM, Solana, Mina)**,
so that **Epic 12 exits with a deployment-realistic validation of the whole swap flow (not just the TS-interface boundary proved in Story 12.8), and Epic 13 (Chain Bridge) can build on a swap primitive that is known to work against live chain endpoints on every supported pair permutation**.

## Context (why this story now)

Story 12.8 validated swap composition at the TS-interface level using an in-process dispatch-bridge fixture (`packages/mill/tests/integration/helpers/fixture-topology.ts`): the Mill was booted with a fake `EmbeddableConnectorLike`, and the sender bypassed ILP/BTP entirely by calling `mill._handlerRegistry.dispatch()` directly. 18 integration tests pass, but:

- No real ILP/BTP transport between sender and Mill.
- No real kind:10032 peer-info relay publication.
- No real settlement submission to any chain; no on-chain effect verification.
- Tests run on EVM only; Solana and Mina code paths (validated at unit-test level in Stories 12.4 and 12.9) have no E2E coverage through the swap flow.

Story 12.9 closed the schema-drift blocker and now threads a sender-supplied `chainRecipient` through the rumor → handler → claim-issuer → signer pipeline for all three chain families. That means the swap flow is now **code-complete across EVM, Solana, and Mina** — but still only proven against EVM in in-process tests. This story is the real-infra graduation.

Epic 12's remaining stories after 12.10 are 12.11 (operator documentation) and the epic-12 retrospective.

## Dependencies

- **Upstream (infrastructure — reuse as-is, do NOT rebuild):**
  - `docker-compose-sdk-e2e.yml` — defines Anvil (EVM chain 31337, port 18545, Mock USDC @ `0x5FbDB2315678afecb367f032d93F642f64180aa3`, 10 accounts funded), `solana-validator` (port 19899 RPC / 19900 WS), `mina-lightnet` (port 19085 GraphQL / 19181 Accounts Manager), `peer1` (BTP 19000, BLS 19100, relay 19700), `peer2` (BTP 19010, BLS 19110, relay 19710). Both peers set `SUPPORTED_CHAINS: evm:base:31337,solana:devnet,mina:devnet` (verified at lines 183 and 278 of the compose file) — peer1 orders EVM first, peer2 orders Solana first. Both set `ASSET_CODE: USD` and `ASSET_SCALE: 6` (lines 200–201, 295–296).
  - `./scripts/sdk-e2e-infra.sh up` / `down` — builds `toon:optimized`, starts containers, waits for healthchecks, exports `SOLANA_PROGRAM_ID`, `MINA_ZKAPP_ADDRESS`, `PEER{1,2}_SOLANA_TOKEN_ACCOUNT`, `PEER{1,2}_MINA_ACCOUNT`, `PEER{1,2}_BOOTSTRAP_PEERS`, `PEER{1,2}_NIP59_PEER_PUBKEYS` env vars.
  - `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` — SHARED helper module: `ANVIL_RPC`, `PEER{1,2}_{RELAY,BTP,BLS}_URL`, `TOKEN_ADDRESS`, `TOKEN_NETWORK_ADDRESS`, `SOLANA_RPC`, `MINA_GRAPHQL`, `MINA_ACCOUNTS_MANAGER`, `anvilChain`, `TOKEN_NETWORK_ABI`, `ERC20_ABI`, `BALANCE_PROOF_TYPES`, `createViemClient()`, `getChannelState()`, `getParticipantInfo()`, `getTokenBalance()`, `waitForEventOnRelay()`, `waitForServiceHealth()`, `waitForRelayReady()`, `waitForPeer2Bootstrap()`, `checkAllServicesReady()`, `waitForSolanaHealth()`, `waitForMinaHealth()`, `acquireMinaAccount()`, `releaseMinaAccount()`, `skipIfNotReady()`, per-test Anvil private keys #3–#10. **Import this helper from `packages/mill/tests/e2e/...` — do NOT duplicate.** Accounts #3–#10 are already claimed by SDK E2E test files; the Mill E2E suite MUST allocate different accounts (see Task 6.1).
  - `packages/sdk/tests/e2e/docker-*.test.ts` — 9 reference patterns: `docker-publish-event-e2e.test.ts` (full lifecycle incl. settlement), `docker-solana-settlement-e2e.test.ts` (Solana channel + Ed25519 balance proof), `docker-mina-settlement-e2e.test.ts` (Mina GraphQL submission), `docker-dvm-lifecycle-e2e.test.ts` (two-peer DVM flow — CLOSEST analog to a two-peer swap test), `docker-workflow-chain-e2e.test.ts`.
  - `packages/sdk/vitest.e2e.config.ts` — reference config (globals, node env, `tests/e2e/**/*.test.ts`, `testTimeout: 120000`, package alias resolution for `@toon-protocol/*`).
  - `packages/mill/tests/integration/helpers/fixture-topology.ts` — reference for sender/Mill wiring at TS level. Useful to read to understand the Story 12.8 shape being replaced; **do NOT import it from E2E code** (E2E must boot against real Docker peers, not in-process fixtures).

- **Upstream (code — SUT; exercised via the SDK boundary, not modified):**
  - `@toon-protocol/sdk` — `streamSwap`, `streamSwapControlled`, `buildSettlementTx`, `buildSwapRumor` (Stories 12.2/12.5/12.6/12.9). Called through the public SDK surface.
  - `@toon-protocol/mill` — `startMill` (Story 12.7 scaffold), `MultiChainClaimIssuer`, `EvmPaymentChannelSigner`, `SolanaPaymentChannelSigner`, `MinaPaymentChannelSigner` (Stories 12.4 / 12.9). Consumed via `startMill()` / the Mill's connector-integration boundary.
  - `@toon-protocol/sdk/settlement/{evm,solana,mina}.ts` — chain-specific settlement builders invoked via `buildSettlementTx()`.

- **Upstream (documentation anchors — MUST read once before coding):**
  - `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md` — ACs this story graduates; fixture-topology approach being replaced.
  - `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md` — `chainRecipient` wire contract (AC-1/2/6/10/11/12), must be threaded per-chain in every E2E test here.
  - `_bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md` — `startMill()` entry point Dev Notes reference for standalone Mill boot.
  - `_bmad-output/epics/epic-12-token-swap-primitive.md` — epic goals, D12-001 through D12-011.
  - `_bmad-output/planning-artifacts/test-design-epic-12.md` — epic test design (cross-reference for coverage gaps).

- **Downstream:**
  - **Story 12.11** (operator docs) — will cite this test suite as the deployment-smoke reference.
  - **Epic 12 retrospective** — this suite's pass/fail state is the "shipped" signal.
  - **Epic 13 (Chain Bridge)** — will reuse the Mill peer image and multi-chain settlement verification pattern.

- **Transitive (DO NOT do in this story):**
  - **Do NOT extend or modify `packages/mill/tests/integration/helpers/fixture-topology.ts`** or the Story 12.8 integration suite. Keep `swap-flow.integration.test.ts` as the fast hermetic unit-boundary check (Task 9.1).
  - **Do NOT modify `packages/mill/src/payment-channel-signer.ts`, `claim-issuer.ts`, or `payment-channel.ts`** — signers are validated in 12.4/12.9 unit tests; fix at the call-site or in the test if a wiring gap surfaces, do NOT patch the signer.
  - **Do NOT alter the docker-compose peer image.** The existing `toon:optimized` image is the peer runtime. If more peers are needed for pair-matrix coverage, add services that reuse `image: toon:optimized` (new env vars only). Do NOT change the Dockerfile unless a concrete gap is identified AND logged in Dev Notes with justification.
  - **Do NOT re-enable Story 12.8's `it.skip(SCHEMA_BLOCKER, …)` blocks.** Those were resolved by 12.9 already; if any remain skipped in 12.8 suite when 12.10 starts, leave them alone (they are 12.8's responsibility; 12.10 is additive).
  - **Do NOT introduce a new `@toon-protocol/*` package** for E2E helpers. Either import `docker-e2e-setup.ts` from the SDK package (allowed — it is test-only code, same workspace) or co-locate Mill-specific helpers under `packages/mill/tests/e2e/helpers/`. No new publishable packages.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Stories 12.1–12.9 shipped all primitives and proved composition in-process. Story 12.10 is the real-infra graduation on top of the finished swap flow. Directly relevant decisions:

- **D12-001/002 (SwapPair + kind:10032):** The Mill publishes its supported swap pairs as kind:10032 events to the relay. This story asserts real relay publication is observable (AC-4 below).
- **D12-003 (NIP-59 gift-wrapped swap packets):** Gift-wrap is done end-to-end on real BTP transport, not stubbed (AC-5 below).
- **D12-004 (Sender controls packet granularity):** `streamSwap()` drives the packet stream; this story exercises it through real BTP WebSockets (AC-3 below).
- **D12-010/011 (Two-layer addressing):** Every chain pair test threads a chain-specific `chainRecipient` (20-byte EVM, 32-byte Solana, Mina string), per Story 12.9 AC-2.

## Acceptance Criteria

**Infrastructure + skip gate**

1. A new `packages/mill/tests/e2e/` directory hosts all Story 12.10 tests. New `packages/mill/vitest.e2e.config.ts` (modeled on `packages/sdk/vitest.e2e.config.ts`) targets `tests/e2e/**/*.test.ts` with `testTimeout: 180000` (settlement + Mina lightnet can be slow). A new `test:e2e:docker` script in `packages/mill/package.json` invokes it. The config adds `@toon-protocol/*` aliases matching the SDK's so cross-package imports resolve without a dist build.
2. Every test in `packages/mill/tests/e2e/` calls `checkAllServicesReady()` + (where applicable) `waitForSolanaHealth()` / `waitForMinaHealth()` + `waitForPeer2Bootstrap()` in `beforeAll`, then uses `skipIfNotReady()` to runtime-skip (NOT fail) when `./scripts/sdk-e2e-infra.sh up` has not been run — matching the Story 12.8 AC-9 Anvil-probe pattern and the SDK E2E pattern. CI behavior (from `skipIfNotReady`: throws under `CI=1`) is preserved.

**Real peered swap flow (replaces 12.8's in-process dispatch bridge)**

3. `docker-swap-flow-evm-e2e.test.ts` drives a live `streamSwap()` session where the sender connects to peer2's BTP endpoint (`ws://localhost:19010`, using a fresh SDK `createNode()` or equivalent real-connector wiring), targeting peer1 as the Mill. Assertions:
   - The sender opens a real BTP WebSocket (no in-process dispatch bridge); connection close on test teardown leaves no dangling sockets.
   - At least one PREPARE packet carrying a NIP-59 gift-wrapped kind:1059 rumor reaches peer1 and returns a FULFILL.
   - `streamSwap()` resolves with `state: 'completed'` (not `'failed'` / `'aborted'`) and `claims.length >= 1`.
   - Every accumulated claim carries `recipient === sender's chainRecipient` (Story 12.9 AC-7 equality check under real transport).
4. `docker-swap-flow-evm-e2e.test.ts` also asserts peer1's kind:10032 SwapPair announcement is observable on peer1's relay (`ws://localhost:19700`) via `waitForEventOnRelay()`: the event's `kind` field equals 10032, its content decodes to a SwapPair list containing at least one pair where `from.chain` and `to.chain` are both among `{evm:base:31337, solana:devnet, mina:devnet}`, and BTP endpoint / asset code / asset scale fields match the `docker-compose-sdk-e2e.yml` peer1 env vars (`ASSET_CODE: USD`, `ASSET_SCALE: 6`).
5. `docker-swap-flow-evm-e2e.test.ts` asserts the gift-wrap envelope is genuine (not test-shimmed): a kind:1059 event traverses BTP (as an ILP PREPARE payload, NOT relay-published — gift-wrapped packets ride the ILP transport per D12-003 and are never seen by the relay), the Mill unwraps it via the real NIP-59 path (no `fixture-topology.ts` shims), and the inner rumor carries the `chain-recipient` tag with the sender-supplied address. Verified by asserting that when the sender injects a malformed `chain-recipient` tag value (bypassing sender-side validation by constructing the rumor via `buildSwapRumor` and sending through the same BTP socket), the Mill returns `T00` per Story 12.9 AC-8. A positive-path assertion complements this by reading the unwrapped inner rumor `chain-recipient` tag from the Mill's debug-log / telemetry hook (if available) OR by asserting the returned FULFILL claim's `recipient` equals the sender-supplied `chainRecipient` — proving the tag round-tripped through the real gift-wrap pipeline.

**On-chain settlement per chain**

6. After a successful `streamSwap()` EVM session, `docker-swap-flow-evm-e2e.test.ts` calls `buildSettlementTx()` with the last accumulated claim, submits the resulting raw transaction via viem (`eth_sendRawTransaction`) to Anvil at `http://localhost:18545`, waits for the receipt, and asserts the Mock USDC balance of the sender's EVM `chainRecipient` increased by the settled amount (or, if the settlement contract uses nonce-advance semantics rather than direct transfer, the channel's `participants[sender].nonce` advanced and `transferredAmount` equals the claim's cumulative amount). The semantically correct EVM check is spelled out in Dev Notes § "Settlement verification rubric".
7. `docker-swap-flow-solana-e2e.test.ts` drives a `streamSwap()` session where the sender's `swapPair.to.chain === 'solana:devnet'` and `chainRecipient` is a 32-byte base58 Ed25519 pubkey. After completion, the test calls `buildSettlementTx()` with the Solana settlement builder, submits via raw Solana JSON-RPC (`sendTransaction`) to `http://localhost:19899`, and asserts the channel program's on-chain effect — SPL token balance at the channel PDA / token account shifts by the claimed amount, OR the channel account's `nonce` field advances (rubric in Dev Notes). Follows the account/discriminator conventions already in `docker-solana-settlement-e2e.test.ts`.
8. `docker-swap-flow-mina-e2e.test.ts` drives a `streamSwap()` session where `swapPair.to.chain === 'mina:devnet'` and `chainRecipient` is a Mina public-key string acquired via `acquireMinaAccount()`. After completion, calls `buildSettlementTx()` with the Mina settlement builder, submits the zkApp transaction via the lightnet GraphQL endpoint (`http://localhost:19085/graphql`), and asserts a zkApp state update corresponding to the settled claim (rubric in Dev Notes). `releaseMinaAccount()` is called in an `afterAll` hook so the Accounts Manager pool is returned.

**Chain-pair permutation matrix (MUST cover all 9 ordered pairs across the three chains; same-chain pairs included)**

9. A pair-matrix describe block (either one file `docker-swap-flow-pair-matrix-e2e.test.ts` using `it.each`, OR one file per pair) covers every ordered `(sourceChain, targetChain)` in `{evm:base:31337, solana:devnet, mina:devnet}` × itself — **9 pairs total** (EVM→EVM, EVM→Solana, EVM→Mina, Solana→EVM, Solana→Solana, Solana→Mina, Mina→EVM, Mina→Solana, Mina→Mina). Each pair test: runs `streamSwap()` end-to-end through peer2 → peer1; asserts `state: 'completed'` and ≥1 accepted claim; asserts the claim's `recipient === sender chainRecipient` (20-byte for evm, 32-byte for solana, Mina string for mina). Settlement submission is only asserted in the three per-chain dedicated files (AC-6/7/8); the pair-matrix tests assert swap composition + claim accumulation, not on-chain effect (to keep the matrix fast and the settlement harness DRY).
10. The pair-matrix decision — **2 peers with multi-chain wallets (Option A) vs. N peers one-chain-per-peer (Option B)** — is resolved in favor of **Option A (reuse peer1/peer2 as-is)**, since the existing compose file already advertises all three chains on both peers and each peer already has per-chain settlement keys wired. The Dev Notes § "Topology tradeoff" records the reasoning; if during implementation Option A proves ergonomically intractable (e.g., a missing per-chain wallet on one side), the dev MAY add a third service `peer3` with `image: toon:optimized` and a narrowed `SUPPORTED_CHAINS` env — but must document the deviation and the specific blocker in Dev Notes. No new Docker image builds are permitted.

**Guardrails + non-regression**

11. Story 12.8's in-process suite — `packages/mill/tests/integration/swap-flow.integration.test.ts` AND `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts` (both verified present at story-creation time) — remains unmodified and passes `pnpm --filter @toon-protocol/mill test:integration` at the end of Story 12.10. That suite is the fast hermetic unit-boundary check and is additive to — not replaced by — the new Docker suite.
12. `packages/mill/tests/integration/helpers/fixture-topology.ts` is not imported from any file under `packages/mill/tests/e2e/`. Mutual-exclusion is enforced by a lint/grep assertion in Dev Notes (not a runtime check), OR by the reviewer at PR time.
13. `pnpm --filter @toon-protocol/mill build` succeeds. `pnpm --filter @toon-protocol/mill test` succeeds (unit tests, no Docker required). `pnpm --filter @toon-protocol/mill test:integration` succeeds (Story 12.8's suite, no Docker). With `./scripts/sdk-e2e-infra.sh up` running, `pnpm --filter @toon-protocol/mill test:e2e:docker` runs the 12.10 suite and all nine pair-matrix cases + the three dedicated per-chain settlement tests pass.

## Tasks / Subtasks

- [ ] **Task 1: E2E harness skeleton (AC-1, AC-2)**
  - [ ] 1.1 Create `packages/mill/vitest.e2e.config.ts` modeled on `packages/sdk/vitest.e2e.config.ts`. Include `@toon-protocol/{core,core/toon,core/nip34,relay,sdk,mill}` aliases. `testTimeout: 180000`, `include: ['tests/e2e/**/*.test.ts']`.
  - [ ] 1.2 Add `"test:e2e:docker": "vitest run --config vitest.e2e.config.ts"` to `packages/mill/package.json` scripts (keep existing scripts untouched).
  - [ ] 1.3 Create `packages/mill/tests/e2e/helpers/infra-gate.ts` that re-exports `skipIfNotReady`, `checkAllServicesReady`, `waitForPeer2Bootstrap`, `waitForSolanaHealth`, `waitForMinaHealth`, `acquireMinaAccount`, `releaseMinaAccount` from `@toon-protocol/sdk` test helpers — or import directly from the SDK `tests/e2e/helpers/docker-e2e-setup.ts` via a relative path if an in-package re-export is preferable. Decision point: pick lowest-surface-area reuse; document in Dev Notes.
  - [ ] 1.4 Add a Mill-E2E-specific Anvil account allocator in `helpers/` that picks accounts NOT already used by SDK E2E. **SDK claims #3–#10 per `docker-e2e-setup.ts`.** Mill E2E has two valid sources of sender keys: (a) **accounts #1 and #2** (unclaimed by SDK E2E; #0 is the Anvil deployer, holding all Mock USDC) — preferred for simplicity, one sender per chain family test to avoid nonce contention across parallel tests; OR (b) **freshly derived keys** from a test-local mnemonic, funded with a one-time `cast send` at the top of the suite (needed only if >2 concurrent signers are required, which is not expected given tests run serially). Document the chosen option in the helper JSDoc.
  - [ ] 1.5 Sanity check: run `./scripts/sdk-e2e-infra.sh up`, then `pnpm --filter @toon-protocol/mill test:e2e:docker` with an empty test body — confirm the skip-gate fires when infra is down and no-ops clean when up.

- [ ] **Task 2: EVM swap-flow + settlement test (AC-3, AC-4, AC-5, AC-6)**
  - [ ] 2.1 Create `packages/mill/tests/e2e/docker-swap-flow-evm-e2e.test.ts`. `beforeAll`: health gate + peer2 bootstrap wait.
  - [ ] 2.2 Construct the sender via the SDK's public `createNode()` or equivalent — connect to peer2's BTP WebSocket at `ws://localhost:19010`. Do NOT use `buildFixtureSender()` from the Story 12.8 helpers.
  - [ ] 2.3 Invoke `streamSwap({ swapPair: {from: 'evm:base:31337', to: 'evm:base:31337'}, chainRecipient: <20-byte recipient>, … })`. Collect all claims.
  - [ ] 2.4 Assert `state: 'completed'`, `claims.length >= 1`, every `claim.recipient === chainRecipient` (AC-3).
  - [ ] 2.5 Subscribe to peer1's relay (`ws://localhost:19700`) via `waitForEventOnRelay` (or an open-subscription variant filtered by `{kinds:[10032], authors:[peer1Pubkey]}`); assert the SwapPair announcement content (AC-4).
  - [ ] 2.6 Malformed-rumor probe (AC-5): build one rumor with an invalid `chain-recipient` tag (e.g., `0xdeadbeef`), send via a low-level packet helper (bypassing `streamSwap()`'s sender-side validation — use `buildSwapRumor` with a bad value and send through the same BTP socket); assert the FULFILL response is a T00 error.
  - [ ] 2.7 Settlement (AC-6): take the last claim, call `buildSettlementTx()`, sign + submit via viem `walletClient.sendRawTransaction`, wait for receipt, assert the Dev-Notes-rubric outcome (balance or nonce/transferredAmount change). Use a fresh Anvil account (see Task 1.4) to avoid nonce contention.

- [ ] **Task 3: Solana swap-flow + settlement test (AC-7)**
  - [ ] 3.1 Create `packages/mill/tests/e2e/docker-swap-flow-solana-e2e.test.ts`. Reuse `generateSolanaKeypair`, `base58Encode`, `base58Decode` from the SDK `identity.ts`.
  - [ ] 3.2 `beforeAll`: health gate + `waitForSolanaHealth()`.
  - [ ] 3.3 Sender-side `chainRecipient` is a 32-byte Ed25519 pubkey (base58-encoded). Run `streamSwap()` against peer2 → peer1 with `swapPair.to.chain === 'solana:devnet'`.
  - [ ] 3.4 Assert swap completion + recipient equality.
  - [ ] 3.5 Settlement: call `buildSettlementTx()` via the Solana builder, submit via raw JSON-RPC `sendTransaction`, confirm, read the channel PDA state, assert per Dev-Notes rubric.

- [ ] **Task 4: Mina swap-flow + settlement test (AC-8)**
  - [ ] 4.1 Create `packages/mill/tests/e2e/docker-swap-flow-mina-e2e.test.ts`.
  - [ ] 4.2 `beforeAll`: health gate + `waitForMinaHealth()` (180s budget per existing helper).
  - [ ] 4.3 `acquireMinaAccount()` in `beforeAll` / `releaseMinaAccount()` in `afterAll`. Use the acquired `pk` as `chainRecipient`.
  - [ ] 4.4 Run `streamSwap()` against peer2 → peer1 with `swapPair.to.chain === 'mina:devnet'`. Assert swap completion + recipient equality.
  - [ ] 4.5 Settlement: call `buildSettlementTx()` via the Mina builder, POST the signed zkApp txn via the GraphQL endpoint, poll for inclusion, assert the zkApp state change per Dev-Notes rubric.

- [ ] **Task 5: Pair-matrix coverage (AC-9, AC-10)**
  - [ ] 5.1 Create `packages/mill/tests/e2e/docker-swap-flow-pair-matrix-e2e.test.ts`.
  - [ ] 5.2 Enumerate all 9 `(source, target)` pairs in a `describe.each` / `it.each` block. Each case: construct sender with `chainRecipient` of correct format for `target`, run `streamSwap()`, assert completion + claim equality. Skip same-chain settlement submission (covered in Tasks 2/3/4).
  - [ ] 5.3 If Option A (reuse peer1/peer2) proves blocked by a missing per-chain wallet on peer1 or peer2, add a `peer3` service to `docker-compose-sdk-e2e.yml` reusing `image: toon:optimized` with narrowed `SUPPORTED_CHAINS` — DOCUMENT the deviation in Dev Notes and update `scripts/sdk-e2e-infra.sh` to export any new env vars. Do NOT rebuild the Docker image.

- [ ] **Task 6: Non-regression + cleanup (AC-11, AC-12, AC-13)**
  - [ ] 6.1 Confirm `pnpm --filter @toon-protocol/mill test:integration` still passes (Story 12.8 suite untouched).
  - [ ] 6.2 Grep-check: `grep -r 'fixture-topology' packages/mill/tests/e2e/` returns zero results.
  - [ ] 6.3 Run the full local verification matrix: `pnpm --filter @toon-protocol/mill build` + `pnpm --filter @toon-protocol/mill test` + `pnpm --filter @toon-protocol/mill test:integration` (all without Docker), then `./scripts/sdk-e2e-infra.sh up` + `pnpm --filter @toon-protocol/mill test:e2e:docker` (with Docker). Record results in the Dev Agent Record.

## Out of Scope / Guardrails

- **9.1 DO NOT touch Story 12.8's in-process suite.** `swap-flow.integration.test.ts`, `swap-flow-anvil.integration.test.ts` (if present), and `fixture-topology.ts` are untouched. Story 12.10 is additive.
- **9.2 DO NOT modify SUT source in any package.** No edits to `@toon-protocol/sdk`/`@toon-protocol/mill` source files under `src/`. If a genuine E2E bug surfaces, file a new fix-type story; do not patch in-line.
- **9.3 DO NOT rebuild or modify the `toon:optimized` Docker image** unless a concrete blocker is identified and logged in Dev Notes. Only env-var additions to compose services are permitted.
- **9.4 DO NOT introduce a new publishable package.** E2E helpers live in `packages/mill/tests/e2e/helpers/` or are imported from the SDK's test helpers.
- **9.5 DO NOT use `buildFixtureMill` / `buildFixtureSender` in E2E tests.** E2E must boot against real Docker peers end-to-end.
- **9.6 DO NOT run root-level `pnpm test` or `pnpm build`.** CLAUDE.md explicitly forbids root-level test/build for OOM reasons. All verification is per-package via `--filter`.
- **9.7 DO NOT assume more than 2 peers exist.** Start with peer1/peer2. Only add peer3 if pair-matrix coverage provably cannot be achieved with 2 peers (AC-10 fallback clause); even then, reuse the existing image.

## Dev Notes

### Topology tradeoff (Option A vs Option B) — recorded for AC-10

Story 12.10 proceeds with **Option A: 2 peers with multi-chain wallets**, because:

1. `docker-compose-sdk-e2e.yml` already declares `SUPPORTED_CHAINS: evm:base:31337,solana:devnet,mina:devnet` on BOTH peer1 and peer2 and wires per-chain settlement addresses for each (`SETTLEMENT_ADDRESS_EVM_BASE_31337`, `SETTLEMENT_ADDRESS_SOLANA_DEVNET`, `SETTLEMENT_ADDRESS_MINA_DEVNET` on each peer).
2. Adding N peers would require N forks of the peer compose entry + N NIP-59 peer pubkeys + N bootstrap lists + N startup health waits. Test startup time would multiply. For 9 pair permutations, Option B is ~$3\times$ Option A's infra cost.
3. The one legitimate Option B argument — "a single peer cannot genuinely prefer multiple target chains" — is moot here because the Mill's `SwapPair` announcement is a LIST; peer1 announces all pairs it supports regardless of preference ordering, and the sender picks the pair it wants per-swap.

**If Option A fails:** the dev MAY add a `peer3` service reusing `image: toon:optimized` with a narrower `SUPPORTED_CHAINS`. Log the specific failure mode in the Dev Agent Record and reference this § in the commit message.

### Docker image rebuild (AC for scope protection)

A full `./scripts/sdk-e2e-infra.sh up` rebuilds `toon:optimized` if its layers changed. **No changes to the Dockerfile are anticipated for Story 12.10.** If the sender's `createNode()` flow surfaces a runtime env-var the peer image needs that isn't already set (e.g., a new Mill-side env var for swap handling), prefer adding it via `docker-compose-sdk-e2e.yml` environment section (no rebuild needed — env vars are runtime) over a Dockerfile change. If a Dockerfile change proves unavoidable, STOP and document in Dev Notes + Completion Notes List before proceeding.

### Settlement verification rubric (AC-6, AC-7, AC-8)

Each chain's settlement contract semantics differ; the "on-chain effect" that proves settlement succeeded is chain-specific. Dev MUST pick the semantically correct check per chain:

- **EVM (Raiden-style TokenNetwork at `0xCafac3dD18aC6c6e92c921884f9E4176737C052c`, verified against peer1 `TOKEN_NETWORK_EVM_BASE_31337` env var):** Settlement does NOT immediately transfer tokens — `closeChannel` + `settleChannel` is a two-phase flow with a challenge period. The fast, correct E2E check is: after submitting the `closeChannel(channelId, balanceProof, signature)` txn, read `participants[channelId, sender]` via `getParticipantInfo()` and assert `nonce` and `transferredAmount` match the claim. Full `settleChannel()` requires time-travel (`evm_increaseTime` via Anvil RPC); if the dev wants to cover the full lifecycle, reference `docker-publish-event-e2e.test.ts:480-684` which already does this on Anvil. **Minimum required for AC-6: `closeChannel` submission + nonce/transferredAmount advance.** Full settle + balance change is a stretch goal.
- **Solana (PDA channel program):** Settlement via `CLAIM_FROM_CHANNEL` discriminator advances a per-participant counter in the channel account data AND transfers SPL tokens out of the channel ATA. **Minimum required for AC-7: submit the claim, poll account data, assert either (a) SPL token balance at the recipient's ATA increased by the claimed amount, OR (b) the channel account's nonce field advanced.** Pattern: `docker-solana-settlement-e2e.test.ts`.
- **Mina (zkApp):** Settlement posts a zkApp transaction that updates the zkApp's on-chain state fields. **Minimum required for AC-8: submit via GraphQL, poll `account(publicKey: $ZKAPP_ADDRESS) { zkappState }` until the state field corresponding to the settled claim updates.** Lightnet SLOT_TIME is 20s (see compose env); allow ≥60s for inclusion.

Document the specific chain check chosen per file in the test's top-of-file JSDoc block.

### Why this story is additive to 12.8 (not a replacement)

12.8's in-process suite is FAST (seconds) and hermetic (no Docker); it catches regressions in swap composition at dev-time without spinning up Anvil/Solana/Mina. 12.10's Docker suite is SLOW (minutes, Mina alone needs 3 min startup) and requires the infra script. They target different failure modes:

- 12.8 catches: TS-interface bugs, dispatch wiring, inventory/channel-state logic, malformed-rumor handling at the handler boundary.
- 12.10 catches: BTP transport integration, real relay pub/sub, gift-wrap round-trip over real sockets, on-chain settlement validity against real chain semantics.

Both must keep passing. Deleting either is a scope violation.

### Test-run budget

With Mina lightnet included, expect ~3-4 min infra startup, ~1-2 min for the EVM test, ~1-2 min for Solana, ~2-3 min for Mina, and ~2-3 min for the 9-pair matrix. Total local wall-time target: **under 15 minutes** for the full `test:e2e:docker` run with infra already up. If a pair-matrix iteration blows past 60s per case, investigate BTP WebSocket re-use rather than opening a fresh sender per iteration.

### Local verification checklist (copy into Completion Notes List when done)

1. `pnpm --filter @toon-protocol/mill build`
2. `pnpm --filter @toon-protocol/mill test` (no Docker)
3. `pnpm --filter @toon-protocol/mill test:integration` (no Docker, Story 12.8 unchanged)
4. `./scripts/sdk-e2e-infra.sh up` + healthchecks green
5. `pnpm --filter @toon-protocol/mill test:e2e:docker` — all EVM/Solana/Mina/pair-matrix tests pass
6. `./scripts/sdk-e2e-infra.sh down`

## Dev Agent Record

### Context Reference

Story 12.10 was scaffolded via `/bmad-bmm-create-story` with YOLO mode; no context-gathering interview was run. Upstream anchors:

- Story 12.8 (in-process fixture) — `_bmad-output/implementation-artifacts/12-8-e2e-swap-flow-integration-tests.md`
- Story 12.9 (chainRecipient threading) — `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md`
- docker-compose-sdk-e2e.yml — reviewed in full at story-creation time; all three chains + both peers wired.
- SDK E2E helper — `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` reviewed in full; re-use is the expected pattern.

### Agent Model Used

(to be filled by dev-story agent)

### Debug Log References

(to be filled by dev-story agent)

### Completion Notes List

(to be filled by dev-story agent; MUST include the 6-item local verification checklist result from Dev Notes)

### File List

(to be filled by dev-story agent)

## Change Log

| Date       | Version | Description                                              | Author     |
| ---------- | ------- | -------------------------------------------------------- | ---------- |
| 2026-04-14 | 0.1     | Initial draft via /bmad-bmm-create-story yolo            | sm / claude |
| 2026-04-14 | 0.2     | Adversarial review pass: corrected env-var casing (ASSET_CODE/ASSET_SCALE), fixed AC-5 factual error (kind:1059 rides BTP not the relay), removed "if present" hedge on swap-flow-anvil.integration.test.ts (verified present), expanded Anvil account allocator guidance (Task 1.4), inlined full TokenNetwork address, explicitly verified compose line numbers for SUPPORTED_CHAINS claim. | sm / claude |

## Handoff

STORY_FILE: /Users/jonathangreen/Documents/TOON-Protocol/_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md
