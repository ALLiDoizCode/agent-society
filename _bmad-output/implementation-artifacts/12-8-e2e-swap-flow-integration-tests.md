# Story 12.8: End-to-End Swap Flow Integration Tests — Real Mill Node Receiving Gift-Wrapped ILP Packets, Issuing Signed Claims, and Sender Settlement

Status: ready-for-dev
ui_impact: false
epic: 12
story_id: 12-8

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **TOON Protocol maintainer** who needs to prove that the Token Swap Primitive actually works end-to-end before shipping the epic,
I want **a hermetic, reproducible integration-test suite that boots a real Mill node via `startMill()`, drives a full USDC→ETH swap through `streamSwap()` with NIP-59 gift-wrapped ILP packets, accumulates signed EVM payment-channel claims in encrypted FULFILL responses, and demonstrates that `buildSettlementTx()` produces a settlement transaction that would credit the sender on-chain**,
so that every Epic 12 primitive (12.1 kind:10032 swapPairs, 12.2 NIP-59 gift-wrap, 12.3 swap handler, 12.4 inventory/wallet/claim-issuer, 12.5 `streamSwap()`, 12.6 `buildSettlementTx()`, 12.7 `startMill()`) is validated in composition against a running ILP node — not in isolation with mocks — and the composition assertions explicitly exercise the known-gap items Story 12.7 deferred (auto-`ConnectorNode` wiring, per-sender channel provisioning, `kind:10032` relay broadcast, `HandlerRegistry.unregister`, `seenPacketIds` size cap).

Epic 12 stories 12.1–12.7 each ship unit + component tests that prove their piece in isolation. **Story 12.8 is the composition test that proves they work together.** It is the gate that demonstrates the swap primitive is ready for operator adoption. Without 12.8, we have seven green packages and zero evidence that a swap actually flows end-to-end.

This story deliberately does **not** introduce new runtime code paths. Its only production-code changes are the small wiring fixes required to make `startMill()` bootable in an E2E topology without operator hand-wiring — the four "Story 12.8 scope" items the 12.7 report explicitly listed as deferred. Everything else is test infrastructure, fixtures, and assertions.

Story 12.9 (operator documentation) will reference the test topology established here as the canonical "minimal working Mill" example.

## Dependencies

- **Upstream (code deps, MUST be imported by tests — all already shipped):**
  - `@toon-protocol/mill` → `startMill`, `MillConfig`, `MillInstance`, `MillStartError`, `deriveMillKeys`, `MillInventory`, `MillChannelState`, `MultiChainClaimIssuer`, `EvmPaymentChannelSigner` — from Story 12.4 + 12.7 (all done). Tests construct a Mill via `startMill()` with a deterministic fixture mnemonic; NO test fixtures may bypass `startMill()` and hand-assemble the handler. The point of 12.8 is to prove the public entrypoint boots correctly.
  - `@toon-protocol/sdk` → `streamSwap`, `StreamSwapConfig`, `StreamSwapResult`, `CollectedClaim` — from `packages/sdk/src/stream-swap.ts` (Story 12.5, done). Tests drive the swap from the sender side via `streamSwap()`; again, no bypass.
  - `@toon-protocol/sdk` → `buildSettlementTx`, `BuildSettlementTxConfig`, `SettlementTx` — from `packages/sdk/src/settlement/build-settlement-tx.ts` (Story 12.6, done). Tests assert that `buildSettlementTx()` accepts the shape of the claims collected by `streamSwap()` (schema round-trip test — production-critical because it is the ONLY place the two SDKs cross).
  - `@toon-protocol/sdk` → `createSwapHandler`, `createNode`, `ToonClient`, `HandlerRegistry`, `createHandlerContext`, `fromMnemonic`, `fromSecretKey`, `NodeIdentity` — composition primitives. Test nodes use the same primitives that `startMill()` / `startTown()` use internally, so the test doubles exercise production code paths, not parallel ones.
  - `@toon-protocol/sdk` → `giftWrapSwapPacket`, `decodeGiftWrapPayload` — from `packages/sdk/src/gift-wrap.ts` (Story 12.2, done). Used ONLY by tests asserting the intermediary-view privacy property (see AC-6). Production senders use `streamSwap()` which wraps this internally.
  - `@toon-protocol/core` → `ILP_PEER_INFO_KIND` (`10032`), `buildIlpPeerInfoEvent`, `parseIlpPeerInfoEvent`, `SwapPair`, `IlpPeerInfo`, `resolveChainConfig`, `VERSION`, `encodeEventToToon`, `decodeEventFromToon` — read-side primitives for the discovery assertion (AC-2). Tests fetch the Mill's advertised kind:10032 and round-trip it to verify `swapPairs` integrity.
  - `@toon-protocol/connector` → `ConnectorNode`, `createLogger as createConnectorLogger`, `WalletSeedManager`, `KeyManager` — these are what `startMill()` composes when `config.connector` is omitted (the "auto-`ConnectorNode`" branch the 12.7 report flagged as the #1 12.8 scope item). This story's wiring fix wires that default path.
  - `nostr-tools/pure` → `getPublicKey`, `generateSecretKey`, `finalizeEvent` — sender-side identity construction for the deterministic fixture.
  - `@noble/curves/secp256k1` → `secp256k1` — test-only secp256k1 signing helpers (used only inside test assertions; no production import).
  - `viem` → `createPublicClient`, `http`, `parseEther`, `formatEther` — used ONLY by the `Anvil-backed settlement assertion` (AC-9) to verify `buildSettlementTx()` produces bytes that a real EVM JSON-RPC would accept as a well-formed tx. Anvil is already running in the SDK E2E infra (port 18545). No new chain dependencies.
  - `vitest` → `describe`, `it`, `expect`, `beforeAll`, `afterAll` — standard test runner; configured the same way Town's `vitest.e2e.config.ts` is set up (mirror precedent, do not invent a new config shape).

- **Upstream (runtime contract, MUST match existing shapes — READ CAREFULLY):**
  - **`streamSwap()` output shape MUST be consumable by `buildSettlementTx()` without transformation.** Story 12.5 and 12.6 were developed in parallel; their schema contract is the single most load-bearing cross-story invariant in the epic. AC-8 codifies this as a no-transformation round-trip. If a test helper is needed to adapt one shape to the other, THAT IS A BUG — file it against 12.5/12.6 and fix there, not in the test harness.
  - **FULFILL claims are NIP-44 encrypted with an ephemeral Mill key** (D12-008). The sender's `streamSwap()` decrypts them; the test asserts the ciphertext is opaque to intermediaries (AC-6) AND that the plaintext is a valid `CollectedClaim` after decryption (AC-4).
  - **Gift-wrap recipient is the Mill's Nostr identity pubkey, NOT the Mill's chain signer address.** (D12-010/011.) AC-1 fixtures MUST use the deterministic Nostr pubkey derived from the mnemonic at Nostr path, not the EVM `0x` address. Mixing these up is the single most likely test-wiring bug — call it out in fixture comments.
  - **`HandlerRegistry.on(1059, ...)` is the registration contract** (Epic 1). AC-5 asserts the Mill has a handler on kind:1059 post-boot by sending a gift-wrapped packet and observing the FULFILL. It does NOT use a private registry introspection API (there isn't one, and we don't add one — black-box observation is the contract).
  - **`kind:10032` publication path.** Story 12.7 DEBUG-logged the built event but did not broadcast to relays (explicitly deferred to 12.8). This story wires the broadcast using the same `SimplePool.publish()` pattern `startTown()` uses at boot. AC-2 asserts a subscriber can read the event back and see the expected `swapPairs`.
  - **`seenPacketIds` DoS cap.** Story 12.7 documented an unbounded default. This story adds a size-capped default (e.g., `Set` with LRU eviction at 10,000 entries, constant documented in `createSwapHandler` source). AC-10 asserts the cap exists and evicts. NOT a functional swap test — a handler-hardening test.
  - **Per-sender channel provisioning.** Story 12.7 noted the key-scheme mismatch: channel entries are provisioned under `{assetCode}:{chain}:{channelId}` but looked up at runtime under `{assetCode}:{chain}:{senderPubkey}`. This story fixes the lookup key to match provisioning (or vice-versa — pick whichever requires fewer call-site changes; document the choice). AC-7 asserts a second sender with a distinct pubkey can swap against the same Mill without channel re-provisioning.

- **Upstream (infrastructure, MUST be running):**
  - **Anvil** — JSON-RPC on `http://localhost:18545` (already provisioned by `./scripts/sdk-e2e-infra.sh up`). Used for AC-9 only (validating `buildSettlementTx()` bytes against a live EVM). If Anvil is not up, AC-9 SKIPs with a clear message (not FAILs — skip and document in the trace).
  - **Mill-under-test: in-process** — this story's tests boot the Mill in the same Node process as the test (`startMill()` is async-friendly and cleans up on `instance.stop()`). No Docker container for the Mill in this story. Rationale: Docker Mill deployment is a Story 12.9 / operator-docs concern; the composition proof lives at the TypeScript boundary and does not require container packaging.
  - **Sender-under-test: in-process** — same Node process; sender uses `ToonClient` / `createNode` to connect to the Mill. The connector loopback is wired via the Mill's embedded `ConnectorNode` — tests construct a `ConnectorNode` pair (sender-side + Mill-side) peered over `@toon-protocol/connector`'s in-process peer transport (the same `InProcessBtpPlugin` pattern Town's integration tests use). **DO NOT open a real BTP WebSocket for this story** — it adds flakiness for zero composition coverage. The ILP hop is what matters; the transport is orthogonal.
  - **`scripts/sdk-e2e-infra.sh` is NOT a hard prerequisite for the default test suite.** The default `pnpm --filter @toon-protocol/mill test:integration` runs fully in-process. Only the optional `AC-9 Anvil settlement validation` test requires the infra script to be up. Add a `test:integration:anvil` npm script for the opt-in suite; the default suite is CI-safe without Docker.

- **Upstream (documentation anchors — MUST read once before coding):**
  - `_bmad-output/epics/epic-12-token-swap-primitive.md` — full architecture, all D12-00X decisions. The "Swap Flow" section (step 1–7) is the canonical sequence the E2E test MUST exercise in order.
  - `_bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md` — especially the "Known Risks & Gaps" section the 12.7 dev note called out. Every item listed there is either fixed or explicitly test-covered by this story.
  - `_bmad-output/auto-bmad-artifacts/story-12.7-report.md` — "Known Risks & Gaps" section. This is the exact scope handoff list for 12.8.
  - `packages/sdk/tests/e2e/docker-mina-settlement-e2e.test.ts` — reference for E2E test shape (imports, lifecycle, assertions). Mirror the structure; do not invent a new one.
  - `packages/town/vitest.e2e.config.ts` — reference for the integration-test vitest config. Mirror for `packages/mill/vitest.integration.config.ts`.
  - `packages/sdk/src/__integration__/create-node.test.ts` — reference for in-process peered `ConnectorNode` construction. Reuse the `createPeeredNodes()` helper if it exists; if not, copy-adapt inline (DO NOT extract a new shared helper in this story — that's a refactor distraction).

- **Downstream:**
  - Story 12.9 (operator documentation) — references the test topology as a minimal working example.
  - Epic 13 (Chain Bridge) — composition test pattern established here (`startX()` + `streamY()` + black-box assertion) is the template for Epic 13's E2E story.
  - Overmind Epics (16–20) — agents that consume swap primitives will rely on the wire-level invariants this story codifies (FULFILL encryption, claim schema, `swapPairs` discovery).

- **Transitive:** None. **In particular, do NOT add:**
  - No real cross-chain settlement on Mina or Solana. EVM via Anvil is the sole on-chain assertion (AC-9). Mina/Solana settlement are covered by existing SDK E2E tests (`docker-mina-settlement-e2e.test.ts`, `docker-solana-settlement-e2e.test.ts`); Mill integration tests do not duplicate that coverage. The claim-issuance side is exercised in-process for Mina/Solana (signers produce claims; tests verify signature validity via the signer's own `verify()` — no on-chain broadcast).
  - No new Docker Compose service. Mill runs in-process. The 12.7 scaffold already ships a CLI — Docker packaging is a 12.9 concern.
  - No property-based fuzzing of the swap flow. Fuzz testing is a follow-on hardening concern; this story is composition proof, not robustness proof.
  - No new production code except the four explicitly-scoped wiring fixes in AC-11 through AC-14.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Stories 12.1–12.7 delivered all the primitives. Story 12.8 is the first test that proves they compose. From the epic doc:

Directly relevant decisions:

- **D12-001 (Swaps are handler-level, not routing-level):** The E2E must not rely on connector routing changes. Standard ILP routing delivers packets to the Mill. This story's tests use the in-process peered-connector topology to verify that — if anyone regresses and adds swap logic to the connector, the tests must still pass (because they assert the swap happens at the HANDLER layer).
- **D12-002 (Optional `swapPairs` advertisement):** AC-2 asserts `kind:10032` round-trips `swapPairs` through the publish → subscribe loop. A Town peer (no `swapPairs`) should coexist; this story does NOT need to spin up a Town for coexistence, but the Mill's event parser MUST not reject events without `swapPairs` (regression test AC-2.3).
- **D12-003 (NIP-59 gift-wrapped swap packets):** AC-1, AC-5 assert gift-wrapped packets flow through ILP; AC-6 asserts intermediaries see opaque data (the privacy property). The privacy assertion is non-negotiable — this story is the LAST place in the epic where we can catch a plaintext leak.
- **D12-004 (Sender controls packet granularity):** AC-4 runs a 1-packet swap AND a 10-packet swap against the same Mill, asserts both accumulate into a coherent `CollectedClaim[]`. Packet-count flexibility is a protocol invariant, not a convenience.
- **D12-005 (Signed claims in FULFILL, not on-chain transfers):** AC-4 asserts FULFILL data field contains the encrypted claim; no on-chain tx is broadcast during the swap phase. AC-9 separately validates that `buildSettlementTx()` produces a tx that Anvil would accept — but only after the swap has completed, and only as a transaction-construction test, not a transaction-broadcast test.
- **D12-006 (Live rate per packet):** AC-4 drives a 10-packet swap with a `rateProvider` that yields three distinct rates across the packets; test asserts each claim reflects the rate active at that packet's time.
- **D12-008 (FULFILL claims NIP-44 encrypted with ephemeral key):** AC-6 asserts the FULFILL data field is ciphertext from the intermediary view AND that each packet's FULFILL uses a distinct ephemeral pubkey (no key reuse). Key-reuse would break the privacy model — this is a regression trap.
- **D12-010 / D12-011 (Mill wallet separate from connector, BIP-44 accountIndex=2):** AC-1 fixture derives both the connector's WalletSeedManager key (account 1) and the Mill's `deriveMillKeys()` (account 2) from the same test mnemonic and asserts the two address sets are disjoint. Key collision would catastrophically break the Mill; the fixture test catches it cheaply.

Test design references (`_bmad-output/planning-artifacts/test-design-epic-12.md`, section 2.8 — IDs and priorities taken verbatim from that doc; mapping of T-0XX → AC is this story's responsibility):

- **T-061 (P0 — E2E)**: "Full swap lifecycle: discover → stream 5 packets → accumulate claims → settle on Anvil." This story implements a stronger variant (1-packet and 10-packet variants, rate drift, schema round-trip, Anvil tx-construction). **Primarily covers AC-1, AC-2, AC-4, AC-8, AC-9.**
- **T-062 (P0 — E2E)**: "Privacy verification: intermediary peer logs contain no sender identity." **Covers AC-6.1, AC-6.2.**
- **T-063 (P0 — E2E)**: "Privacy verification: FULFILL return path is encrypted (opaque ciphertext)." **Covers AC-6.2, AC-6.4.**
- **T-064 (P1 — E2E)**: "Swap with rate change mid-stream; packets reflect new rate; rate callback fires." **Covers AC-4.3.**
- **T-065 (P1 — E2E)**: "Mill inventory depletion mid-stream — packets past depletion REJECTed; prior claims remain settleable." **NOT IN THIS STORY'S SCOPE.** Inventory-depletion behavior is covered by Story 12.3/12.4 component tests; re-asserting it at the E2E layer is a Story 12.9 operator-path concern. Out of scope called out here so traceability reviewers don't flag it as missing.
- **T-066 (P1 — E2E)**: "Two clients swap simultaneously with same Mill; no channel state corruption." **Covers AC-7.** This story runs the two-sender swaps sequentially, not concurrently — concurrent interleaving is out of scope (no promise-race assertions); sequential two-sender suffices to prove the per-sender channel-lookup fix (AC-12). A follow-on hardening story can add concurrent stress.
- **T-067 (P2 — E2E)**: "Large swap: 100 packets; all claims accumulated; total on-chain amount matches." **NOT IN THIS STORY'S SCOPE.** AC-4.2 uses 10 packets; 100-packet stress is a performance assertion beyond composition proof. Deferred to a Story 12.9 or post-epic hardening pass.
- **T-068 (P2 — E2E)**: "Swap with minimum packet amount — single packet at `SwapPair.minAmount`." **NOT IN THIS STORY'S SCOPE** (12.3/12.5 component-level boundary test already covers minAmount; composition doesn't need to re-assert it).

Additional story-level test concerns not in test-design-epic-12.md 2.8 (introduced by this story's scope expansion to cover 12.7 handoff items — document explicitly so traceability reviewers flag as new, not missing-from-upstream):

- **T-8A (P0 — INTEG, new)**: `streamSwap()` → `buildSettlementTx()` schema round-trip, NO transformation. **Covers AC-8.**
- **T-8B (P1 — INTEG, new)**: `startMill()` with only `mnemonic` (no `config.connector`) auto-wires embedded `ConnectorNode`. **Covers AC-11.**
- **T-8C (P1 — INTEG, new)**: `kind:10032` publisher injection + boot-time publish + failure-tolerance. **Covers AC-2, AC-13.**
- **T-8D (P1 — INTEG, new)**: Malformed kind:1059 → REJECT (black-box handler-registration proof). **Covers AC-3.**
- **T-8E (P1 — INTEG, new)**: Replay of captured packet bytes → REJECT (seenPacketIds dedupe wired). **Covers AC-5.**
- **T-8F (P1 — UNIT, new)**: `seenPacketIds` default cap evicts at `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000` with LRU (access-order) eviction. **Covers AC-10, AC-14.**

Risk mitigations (IDs from test-design-epic-12.md section 1.1 — verbatim):

- **R-006 (CRYPTO, score 6 — "Ephemeral key reuse across packets breaks forward secrecy")**: Mitigation — AC-6.3 asserts 10 distinct Mill-side ephemeral pubkeys across a 10-packet swap. Re-asserts at the composition layer what 12.2 unit tests assert in isolation.
- **R-008 (INTEG, score 9 — "Mill handler + client streamSwap + settlement do not compose correctly"; THE central risk for 12-8)**: Mitigation — the entire story. AC-4 + AC-8 + AC-9 are the P0 compose-test trio.
- **R-010 (SEC, score 6 — "Mill processes packets from non-gift-wrapped sources")**: Mitigation — AC-3 asserts malformed kind:1059 → REJECT; the 12.3 handler enforces gift-wrap shape and this story validates that enforcement is wired through `startMill()`.
- **R-015 (INTEG, score 4 — "startMill() fails to register swap handler")**: Mitigation — AC-3 (black-box handler-registration) + AC-11 (auto-wire fix).
- **R-018 (INTEG, score 4 — "Multiple concurrent swaps cause channel state conflicts")**: Mitigation — AC-7 (two-sender sequential) + AC-12 (per-sender channel-lookup fix). Concurrent variant deferred.

New risks this story introduces (to be tracked in Story 12.9 / epic retro):

- **R-8N1 (INTEG, score 4)**: "12.5 + 12.6 schema drift — claims collected by `streamSwap()` fail `buildSettlementTx()` schema validation." Mitigation: AC-8 (schema round-trip + TypeScript compile gate).
- **R-8N2 (OPS, score 3)**: "Flaky relay breaks Mill boot" — AC-13 requires `Promise.allSettled` on publish so relay rejection does not fail boot.
- **R-8N3 (SEC, score 3)**: "Insertion-order LRU re-opens replay window after 10k packets." Mitigation: AC-14 requires access-order (not insertion-order) eviction; gotcha documented in Dev Notes.

- **Quality gate** (from test-design-epic-12.md §3 "Quality Gates"): "E2E swap lifecycle — Full lifecycle test passes against Docker infra (T-061) — 12-8." Reading: the Docker-infra constraint here refers to the Anvil JSON-RPC infra (port 18545), NOT a containerized Mill. AC-9 satisfies the Anvil dependency; in-process Mill is a deliberate scope decision (see Dependencies).

## Acceptance Criteria

1. **AC-1 — Deterministic fixture topology.** A new test file `packages/mill/tests/integration/swap-flow.integration.test.ts` defines a deterministic fixture via a `beforeAll` that:
   1. Generates a fixed test mnemonic (hardcoded 12-word BIP-39 string; NOT operator-usable — test-only, documented with a `// test-only mnemonic, DO NOT reuse` header).
   2. Derives (a) the connector-side `WalletSeedManager` key at BIP-44 account 1, and (b) `deriveMillKeys()` at account 2, and asserts the two derived EVM addresses are disjoint (AC-1.1).
   3. Boots a single Mill via `startMill()` with:
      - `mnemonic` (fixture string)
      - `swapPairs: [{ from: { assetCode: 'USDC', assetScale: 6, chain: 'evm:31337' }, to: { assetCode: 'ETH', assetScale: 18, chain: 'evm:31337' }, rate: '0.0004' }]` (Anvil chain id = 31337)
      - `chains: ['evm']`
      - `channels: { 'evm:31337': [<one pre-opened channel entry with Anvil-valid contract address>] }`
      - `inventory: { 'evm:31337': 10n ** 20n }` (100 ETH in wei, fixture-sized)
      - `relayUrls: ['ws://localhost:0']` (no actual relay for the default suite; AC-2 variant uses a mock relay)
      - `connector` OMITTED (exercises the auto-wire branch — see AC-11)
   4. Boots a sender node via `createNode()` (or `ToonClient`) peered to the Mill's embedded connector in-process (reuse the pattern at `packages/sdk/src/__integration__/create-node.test.ts`).
   5. Exposes `mill: MillInstance`, `sender: SenderNode`, `fixtureMnemonic: string`, and an `afterAll` that calls `mill.stop()` and `sender.close()` idempotently.

   **AC-1.1** (assertion): The derived EVM address at account 1 ≠ the derived EVM address at account 2. (D12-011 invariant.)
   **AC-1.2** (assertion): `mill.identity.publicKey` is a valid 32-byte Nostr x-only pubkey. (Identity coherence.)
   **AC-1.3** (assertion): `mill.listeningPort > 0` after boot; `/health` endpoint responds `{ status: 'ok', ... }` within 2s.

2. **AC-2 — `kind:10032` publication round-trip.** A mock in-process relay stub is injected via the Mill's publication path (the fix in AC-13 exposes a `publisher?:` hook on `MillConfig` specifically to make this testable; default remains `SimplePool`). The test:
   1. Boots the Mill with `publisher: mockPublisher` where `mockPublisher.publish(event)` captures events to an array.
   2. Waits for the boot-time publication (bounded by 3s timeout).
   3. Asserts `mockPublisher.captured.length === 1`.
   4. Asserts `captured[0].kind === 10032`.
   5. Parses `captured[0]` via `parseIlpPeerInfoEvent()` and asserts `parsed.swapPairs` deep-equals `config.swapPairs`.
   6. **AC-2.3** (regression): Constructs a second event via `buildIlpPeerInfoEvent({ ..., swapPairs: undefined })` and asserts `parseIlpPeerInfoEvent()` returns `swapPairs === undefined` (not `[]`, not an error). Coexistence invariant.

3. **AC-3 — Handler registered on kind:1059.** No private introspection. The test sends a malformed non-gift-wrap event on kind:1059 via the sender's ILP packet and asserts the Mill responds with an ILP REJECT whose error code matches the swap-handler's "malformed gift-wrap" path (read the actual constant from `packages/sdk/src/swap-handler.ts` — DO NOT hardcode `F06` or any other guessed code in the assertion; import the symbol). The REJECT response is itself proof that a handler is registered — absence of a handler would yield a different error (`F02 Unreachable` or similar). This is a black-box assertion of R-015 ("startMill() fails to register swap handler") AND R-010 ("Mill processes packets from non-gift-wrapped sources") — the REJECT proves the handler is both registered AND enforcing gift-wrap shape.

4. **AC-4 — Full swap cycle, 1 packet and 10 packets.**
   1. **AC-4.1 (single-packet swap):** Sender calls `streamSwap({ mill: millNostrPubkey, pair: swapPairs[0], packetCount: 1, amountPerPacket: 1_000_000n })` (1 USDC). Asserts:
      - Resolves with `StreamSwapResult` containing 1 `CollectedClaim`.
      - `claim.chain === 'evm:31337'`.
      - `claim.amount > 0n` and approximately equals `1_000_000 * 0.0004 * 10^12` (USDC→ETH scaling with configured rate; allow ±1% for rate provider rounding).
      - `claim.signature` is a valid secp256k1 signature over the canonical balance-proof hash by the Mill's EVM signer address (verifiable via `EvmPaymentChannelSigner.verify()` OR inline `secp256k1.verify()`).
   2. **AC-4.2 (10-packet swap):** Same, with `packetCount: 10`. Asserts 10 claims collected, each with monotonically increasing `nonce`, all signed by the same Mill EVM address.
   3. **AC-4.3 (rate drift):** Mill is booted with a `rateProvider` that cycles through `['0.0004', '0.0003', '0.0005']` across packets. After a 9-packet swap, asserts the collected claims reflect those three rates in interleaved order (exact packet→rate mapping depends on `rateProvider` call order — assert the SET of observed rates equals the set of provider rates, which is the D12-006 invariant).

5. **AC-5 — No-op replay protection.** After AC-4.1 completes, the test captures the last outbound ILP packet bytes from the sender and re-sends them directly to the Mill via the in-process connector. Asserts the Mill replies with a REJECT (packet-id already seen — `seenPacketIds` hit). Proves the handler-level dedupe the 12.3 handler implements is wired at the `startMill()` level.

6. **AC-6 — Intermediary privacy properties.** The test intercepts the ILP packet bytes at the sender→Mill hop (via a lightweight logging peer plugin) and asserts:
   1. **AC-6.1** The outbound PREPARE's `data` field decodes via `decodeEventFromToon()` to a `{ kind: 1059, ... }` event (gift-wrap confirmed).
   2. **AC-6.2** The gift-wrap's `content` (ciphertext) is NOT valid JSON and NOT a parseable kind-1060 seal without the Mill's privkey (prove it's opaque to intermediaries). Formally: attempting `nip44.decrypt()` with a randomly generated non-Mill privkey throws.
   3. **AC-6.3** Across the 10-packet swap in AC-4.2, the 10 FULFILL responses carry 10 DISTINCT ephemeral pubkeys (`ephemeralPubkey` field in the Mill's encrypted FULFILL response). Zero reuse. (D12-008 regression trap.)
   4. **AC-6.4** The FULFILL's encrypted claim field, attempted to decrypt with a non-sender privkey, throws. (Sender-only readability.)

7. **AC-7 — Two-sender channel provisioning.** The test boots a SECOND sender (distinct Nostr pubkey, same Mill), runs a single-packet swap. Asserts both senders receive valid claims signed by the same Mill. This proves the per-sender channel-lookup fix in AC-12 works — the key mismatch documented in the 12.7 report would have caused the second sender's packet to fail channel lookup.

8. **AC-8 — `streamSwap()` → `buildSettlementTx()` schema round-trip (NO TRANSFORMATION).** After the 10-packet swap in AC-4.2:
   ```ts
   const result = await streamSwap({ ... });
   // NO transformation, NO mapping, NO schema adaptation — direct pipe:
   const tx = buildSettlementTx({
     chain: 'evm:31337',
     channelId: result.claims[0].channelId,
     claims: result.claims, // <— MUST be directly assignable
     senderAddress: senderEvmAddress,
   });
   expect(tx.chain).toBe('evm:31337');
   expect(tx.rawBytes).toBeInstanceOf(Uint8Array);
   expect(tx.rawBytes.length).toBeGreaterThan(0);
   ```
   If TypeScript compiles this without a cast or any `as` assertion, AC-8 passes the typecheck gate. If any runtime transformation is required, the test FAILS even if it passes the runtime assertion — this is enforced by the test reviewer, not the test runner.

9. **AC-9 — Anvil-backed settlement tx well-formedness (OPT-IN, SDK E2E infra required).** A separate test file `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts` (separate so it can be gated on Anvil availability). Uses `viem` to:
   1. Connect to `http://localhost:18545` (Anvil).
   2. Read the `rawBytes` produced by AC-8.
   3. Call `anvilClient.call({ data: rawBytes, to: channelContractAddress })` (or `eth_estimateGas` equivalent).
   4. Assert the call succeeds (does not throw a malformed-tx error). This proves `buildSettlementTx()` produces bytes a live EVM would accept; it does NOT broadcast, so Anvil state is untouched.

   Skip condition: if `fetch('http://localhost:18545')` fails within 500ms, SKIP the test with `test.skip` and a clear message ("SDK E2E infra not running — skip Anvil settlement validation. Run `./scripts/sdk-e2e-infra.sh up` to enable.").

10. **AC-10 — `seenPacketIds` default size cap (wiring fix AC-14 validated).** A dedicated unit test in `packages/sdk/src/swap-handler.test.ts` (extend existing file):
    1. Constructs a swap handler with default config (no `seenPacketIds` override).
    2. Accesses the internal `seenPacketIds` set via handler-returned introspection helper (`getInternalState()` on handler — add IF NOT PRESENT as a @internal testing hook; OR inject a custom Set via config and assert eviction on the injected instance).
    3. Inserts 10,001 packet IDs.
    4. Asserts set size ≤ 10,000 (exact cap documented in source as `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000`).
    5. Asserts the OLDEST id was evicted (LRU behavior).

11. **AC-11 — Auto-`ConnectorNode` wiring fix (production code change).** Story 12.7's report flagged: `startMill()` hardcodes `ownsConnector = false` and requires `config.connector`. THIS STORY FIXES THAT. When `config.connector` is undefined AND `config.connectorUrl` is undefined:
    1. `startMill()` constructs a new `ConnectorNode` internally with sensible defaults (use the same config shape `startTown()` does when it auto-wires — mirror, do not invent).
    2. Sets `ownsConnector = true`.
    3. On `instance.stop()`, awaits `connector.stop()` and releases all related resources.
    4. **AC-11 test:** `startMill({ mnemonic, swapPairs, chains, channels, inventory, relayUrls })` (NO connector/connectorUrl) boots successfully; `mill.connector` is a live `ConnectorNode`; `mill.stop()` cleanly tears it down.

12. **AC-12 — Per-sender channel lookup fix (production code change).** Story 12.7's report flagged a key-scheme mismatch: channel entries keyed `{assetCode}:{chain}:{channelId}` at provision vs `{assetCode}:{chain}:{senderPubkey}` at runtime lookup. THIS STORY FIXES THAT by aligning the two paths. **Decision (to be finalized in dev, document in `packages/mill/src/channel-state.ts` JSDoc):** lookup should index by `{chain}` + channel-selection-policy, where the policy defaults to "first channel with sufficient capacity". Per-sender binding is established on first use (sender-pubkey → channelId sticky map, memory-only, per-Mill-instance lifetime). AC-12 test: two senders against same Mill, each uses a distinct channel entry, sticky-bound after first claim. (Runs inside AC-7's test body; separate assertion block.)

13. **AC-13 — `kind:10032` relay publication + testable `publisher` injection (production code change).** Story 12.7 DEBUG-logged the built event. THIS STORY:
    1. Wires `SimplePool.publish()` to broadcast to all `config.relayUrls` on boot (after 100ms debounce to let connector finish handshake).
    2. Adds `MillConfig.publisher?: Publisher` (test-seam interface `{ publish(event): Promise<void> }`) that defaults to the `SimplePool`-backed implementation but is overridable for tests.
    3. Logs publish failures at `warn` level (don't fail boot — relays can be flaky; AC-13 test injects a rejecting publisher and asserts Mill boots anyway).
    4. AC-13 test (inside AC-2): injected publisher captures the event; regression — inject a publisher that rejects and assert `startMill()` still resolves (does not throw).

14. **AC-14 — `seenPacketIds` default cap constant (production code change).** In `packages/sdk/src/swap-handler.ts`:
    1. Export `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000` (document the rationale inline: "10k packet-ids at ~64 bytes each = ~640KB ceiling; high enough for legitimate bursts, low enough to bound DoS").
    2. When `config.seenPacketIds` is undefined, construct a `BoundedSet` (or `LruCache`-like — use an existing dep if convenient, else inline a 30-line implementation). When `config.seenPacketIds` is provided, use it verbatim (operator's choice; don't second-guess).
    3. AC-14 test: AC-10's test body.

15. **AC-15 — Test infra: `vitest.integration.config.ts`, npm scripts, CI exclusion policy.**
    1. Add `packages/mill/vitest.integration.config.ts` mirroring `packages/town/vitest.e2e.config.ts` — test glob: `tests/integration/**/*.integration.test.ts`, timeout: 30s, pool: `forks` (isolation matters for the in-process connector topology).
    2. Add `"test:integration": "vitest run --config vitest.integration.config.ts"` to `packages/mill/package.json` scripts.
    3. Add `"test:integration:anvil": "vitest run --config vitest.integration.config.ts tests/integration/swap-flow-anvil.integration.test.ts"` for the opt-in Anvil suite.
    4. Default `pnpm --filter @toon-protocol/mill test` (the existing unit-test script) MUST NOT pick up the integration tests — exclude `tests/**` from the default `vitest.config.ts` `include` glob explicitly.
    5. Document in `packages/mill/README.md` (create if absent, minimal — this is NOT the operator doc that 12.9 owns; just a one-liner "Integration tests: see `tests/integration/` — run `pnpm test:integration`").

16. **AC-16 — Traceability gate.** Every functional AC (AC-1 through AC-15) is covered by at least one automated test. The traceability matrix at `_bmad-output/test-artifacts/traceability/12-8-e2e-swap-flow-trace.md` shows 15/15 functional ACs covered, P0 scenarios 3/3 (AC-4, AC-8, AC-11), P1 scenarios 8/8 (AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-12, AC-13, AC-15), P2 scenarios 1/1 (AC-9), P3 (unit hardening) 2/2 (AC-10, AC-14). AC-16 (this gate) and AC-17 (sprint-status flip) are process ACs, not code ACs, and are excluded from the test-coverage count. Every assertion in the matrix names its file path and its `it()` block — no implicit coverage claims.

17. **AC-17 — Sprint-status flip.** On story close: `12-8-e2e-swap-flow-integration-tests: ready-for-dev` → `in-progress` → `review` → `done`. No implicit transitions.

## Tasks / Subtasks

- [ ] **Task 1: Production wiring fixes (AC-11, AC-12, AC-13, AC-14)**
  - [ ] 1.1 Implement auto-`ConnectorNode` branch in `startMill()` when `config.connector` and `config.connectorUrl` are both undefined (mirror `startTown()` auto-wire). Set `ownsConnector=true`; wire `connector.stop()` into `MillInstance.stop()`.
  - [ ] 1.2 Fix per-sender channel lookup in `packages/mill/src/channel-state.ts`: align provision-time and lookup-time keys; add sticky-map binding for first-use pubkey→channelId. Document the choice inline.
  - [ ] 1.3 Add `MillConfig.publisher?` hook; default to a `SimplePool`-backed implementation that publishes the kind:10032 event after 100ms boot-debounce. Log publish failures at `warn`; do not fail boot on publisher rejection.
  - [ ] 1.4 Export `DEFAULT_SEEN_PACKET_IDS_CAP = 10_000` from `packages/sdk/src/swap-handler.ts`; default `seenPacketIds` to a bounded LRU-ish Set; preserve override semantics for operator-supplied sets.
  - [ ] 1.5 Lint, typecheck, existing-unit-tests must pass after each sub-task before moving on.

- [ ] **Task 2: Test infrastructure (AC-15)**
  - [ ] 2.1 Create `packages/mill/vitest.integration.config.ts` mirroring Town's e2e config (30s timeout, `forks` pool, include glob `tests/integration/**/*.integration.test.ts`).
  - [ ] 2.2 Update `packages/mill/vitest.config.ts` to exclude `tests/**` from default test run.
  - [ ] 2.3 Add `test:integration` + `test:integration:anvil` scripts to `packages/mill/package.json`.
  - [ ] 2.4 Add minimal `packages/mill/README.md` (one-line pointer to integration tests; NOT operator docs).
  - [ ] 2.5 Create `packages/mill/tests/integration/helpers/fixture-topology.ts` with the fixture mnemonic, `buildFixtureMill()`, and `buildFixtureSender()` factory functions. Keep helpers small and readable.

- [ ] **Task 3: Core swap-flow integration test (AC-1 through AC-8)**
  - [ ] 3.1 Create `packages/mill/tests/integration/swap-flow.integration.test.ts` with `beforeAll` + `afterAll` bootstrap.
  - [ ] 3.2 AC-1: fixture topology assertions (account-1 vs account-2 disjoint, `/health` responds).
  - [ ] 3.3 AC-2: mock publisher injection + kind:10032 round-trip + coexistence regression.
  - [ ] 3.4 AC-3: malformed kind:1059 packet → REJECT assertion (black-box handler registration).
  - [ ] 3.5 AC-4.1 single-packet swap; AC-4.2 10-packet swap; AC-4.3 rate-drift swap.
  - [ ] 3.6 AC-5: replay rejection.
  - [ ] 3.7 AC-6: intermediary privacy properties (gift-wrap visible; content opaque; distinct ephemeral keys per FULFILL; sender-only decryption).
  - [ ] 3.8 AC-7: two-sender swap (distinct pubkeys).
  - [ ] 3.9 AC-8: `streamSwap()` → `buildSettlementTx()` schema round-trip (no transformation) + typecheck gate.

- [ ] **Task 4: Anvil-backed settlement validation test (AC-9)**
  - [ ] 4.1 Create `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts`.
  - [ ] 4.2 Implement reachability probe (500ms timeout) → `test.skip` gate.
  - [ ] 4.3 Use `viem` to validate `buildSettlementTx()` bytes via `eth_call` or `eth_estimateGas`.
  - [ ] 4.4 Document in test-file header: "opt-in; requires `./scripts/sdk-e2e-infra.sh up`".

- [ ] **Task 5: Unit hardening tests (AC-10, AC-14)**
  - [ ] 5.1 Extend `packages/sdk/src/swap-handler.test.ts` with `DEFAULT_SEEN_PACKET_IDS_CAP` cap + LRU eviction tests.
  - [ ] 5.2 Verify eviction order (oldest first).

- [ ] **Task 6: Artifact + status updates (AC-16, AC-17)**
  - [ ] 6.1 Run traceability: generate `_bmad-output/test-artifacts/traceability/12-8-e2e-swap-flow-trace.md`. 16/16 ACs → test files/it-blocks.
  - [ ] 6.2 Update Dev Agent Record (File List, Completion Notes).
  - [ ] 6.3 Sprint-status flip `12-8-e2e-swap-flow-integration-tests: review` on PR-ready, `done` post-merge.

## Dev Notes

### Architectural constraints

- **In-process peered connectors are the right topology for this story.** Don't reach for Docker. The composition that needs proof lives at the TypeScript interface boundary (`streamSwap` → gift-wrap → ILP → connector → handler → claim → FULFILL → decrypt → `buildSettlementTx`). Docker adds packaging concerns that are 12.9's problem. The in-process peer topology at `packages/sdk/src/__integration__/create-node.test.ts` is the blueprint — copy it.

- **No new shared helpers.** It is tempting to extract a `createPeeredMillAndSender()` utility. Don't. First: there is no second consumer yet (Bridge integration tests are Epic 13, months away). Second: the helper would live in a shared location (`packages/test-utils/`?) that doesn't exist, and creating it is a refactor distraction. Keep the helper file private to `packages/mill/tests/integration/helpers/` and inline what you need.

- **Production code changes are minimal (4 items, all pre-identified in the 12.7 report).** If you find yourself editing 12.1/12.2/12.3/12.4/12.5/12.6 source during this story, STOP. Either (a) the test is wrong, or (b) you've discovered a bug that deserves its own story. Don't silently patch.

- **Typecheck is a functional gate.** AC-8 specifies NO transformation between `streamSwap()` and `buildSettlementTx()`. The only way to enforce that durably is to let the TypeScript compiler reject mismatched shapes. If you need an `as` cast to make AC-8 compile, AC-8 has failed — file a schema-drift bug against 12.5/12.6.

### Critical gotchas

- **Nostr pubkey ≠ EVM address ≠ Mill signer address.** The Mill has THREE identities: (1) its Nostr pubkey (gift-wrap recipient, kind:10032 author, derived from mnemonic via SLIP-0010 or `nip06` path), (2) its connector-side EVM address (settlement-inbound, BIP-44 account 1), (3) its Mill-side chain signer addresses (settlement-outbound, BIP-44 account 2). Fixtures that conflate any two of these will produce baffling errors. Comment every fixture line that picks one identity over another.

- **Anvil chain id is 31337, not 1 or 1337.** Many EVM test stacks use 1337; Anvil defaults to 31337. If your fixture uses `chain: 'evm:1337'` and the channel contract is deployed to the Anvil chain, `buildSettlementTx()` will produce a tx with the wrong chain-id in the EIP-155 signature and Anvil will reject. Double-check.

- **`seenPacketIds` LRU must not evict by insertion order alone — it must evict by LAST-ACCESS order to be useful.** A replay attacker retries the same packet forever; an insertion-order LRU would evict it after 10k new packets pass through, re-opening the replay window. Use access-order eviction. The naïve `Map` approach of `.delete(key); .set(key, value)` on each access gives you access-order iteration for free; prefer that over a bespoke LRU class.

- **`SimplePool.publish()` returns an array of promises, one per relay, that may each reject. Awaiting the array surfaces a `Promise.all` rejection cascade.** Use `Promise.allSettled` to avoid boot-time crashes on flaky relays. AC-13.3 requires this exact behavior.

- **Gift-wrap packets use a NEW ephemeral key per packet (D12-003 / D12-008).** The 10-packet swap AC-4.2 must observe 10 distinct sender-side ephemeral pubkeys AND 10 distinct Mill-side ephemeral pubkeys. 20 total, all unique. If any two match, the privacy model is broken.

- **`streamSwap()` is async and emits claims as they arrive, but AC-4 asserts on the completed result.** Drive to completion via `await streamSwap({...}).result` (or whatever the actual API is — read `stream-swap.ts` before writing the test). Don't race on intermediate events unless you're testing them.

- **The Mill's reply path is ILP FULFILL, not a Nostr event.** There is no publish-back to a relay. The encrypted claim lives in the `data` field of the FULFILL ILP packet, returned synchronously (well, within the packet lifetime) to the sender's `connector.sendPacket()` promise. Sender-side `streamSwap()` decrypts the `data` field. Do not spin up a subscriber listener expecting the Mill to publish claims.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does NOT create or modify GitHub Actions workflows. If that changes during implementation (e.g., adding CI for the Anvil integration tests), pin ALL action references to full commit SHAs (not tags). Unpinned SHAs are an OWASP A08 supply-chain risk. Example: `uses: actions/checkout@<full-sha>` not `uses: actions/checkout@v4`.
- **MAX_SAFE_INTEGER guard:** Claim amounts are `bigint` throughout the swap flow (USDC and ETH micro-units easily exceed `Number.MAX_SAFE_INTEGER`). Do NOT downcast to `number` anywhere in test assertions. Use `toBe(...n)` / `toEqual(...n)` against bigint literals. If a test helper accepts `number`, that is a bug and must be fixed before AC-4 passes.
- **Golden test vectors (ZK story pairs):** N/A — no ZK circuit pair in this story.

### Project Structure Notes

- **Alignment with unified project structure:** `packages/mill/tests/integration/` is a new directory. Precedent: `packages/sdk/tests/e2e/`. Naming convention: `*.integration.test.ts` for in-process integration; `*.e2e.test.ts` reserved for Docker-backed E2E (none in this story). Helpers live under `tests/integration/helpers/` — NOT in `src/`.
- **Detected conflicts or variances:** None. `packages/mill/` is a young package; no legacy structure to reconcile.
- **`packages/mill/vitest.config.ts` vs `packages/mill/vitest.integration.config.ts`:** the default config's `include` glob must be updated to `src/**/*.test.ts` explicitly (if it's currently `**/*.test.ts`) so the integration tests don't double-run.

### References

- [Source: _bmad-output/epics/epic-12-token-swap-primitive.md#Key-Design-Decisions] — D12-001, D12-002, D12-003, D12-004, D12-005, D12-006, D12-008, D12-009, D12-010, D12-011.
- [Source: _bmad-output/epics/epic-12-token-swap-primitive.md#Architecture] — Swap flow 7-step sequence (canonical for AC-4).
- [Source: _bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md#Known-Risks-&-Gaps] — Handoff list for AC-11 through AC-14.
- [Source: _bmad-output/auto-bmad-artifacts/story-12.7-report.md#Known-Risks-&-Gaps] — Same handoff, with Pipeline context.
- [Source: packages/sdk/src/stream-swap.ts] — `streamSwap()` API surface (Story 12.5).
- [Source: packages/sdk/src/settlement/build-settlement-tx.ts] — `buildSettlementTx()` API surface (Story 12.6).
- [Source: packages/sdk/src/swap-handler.ts] — `createSwapHandler()` + `seenPacketIds` default (Story 12.3, AC-14 target).
- [Source: packages/sdk/src/gift-wrap.ts] — NIP-59 gift-wrap primitives (Story 12.2).
- [Source: packages/mill/src/mill.ts] — `startMill()` composition (Story 12.7, AC-11 + AC-13 target).
- [Source: packages/mill/src/channel-state.ts] — per-sender channel lookup (Story 12.4 + 12.7, AC-12 target).
- [Source: packages/mill/src/claim-issuer.ts] — `MultiChainClaimIssuer` (Story 12.4).
- [Source: packages/town/vitest.e2e.config.ts] — integration-config blueprint.
- [Source: packages/sdk/tests/e2e/docker-mina-settlement-e2e.test.ts] — E2E test-shape blueprint.
- [Source: packages/sdk/src/__integration__/create-node.test.ts] — in-process peered-connector topology blueprint.

## Dev Agent Record

### Agent Model Used

_pending_

### Debug Log References

### Completion Notes List

### File List
