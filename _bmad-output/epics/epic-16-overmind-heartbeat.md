# Epic 16: Overmind Heartbeat — Minimal Viable Overmind

**Epic ID:** 16
**Status:** DRAFT
**Author:** Bob (Technical Scrum Master)
**Date:** 2026-03-24
**PRD:** `_bmad-output/overmind-prd.md`
**Architecture:** `_bmad-output/overmind-architecture.md`
**Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md` (D-OMP-001 through D-OMP-011)

---

## Goal / Objective

Deliver the smallest unit of autonomous agent life: an overmind that wakes, observes, decides, acts, records, and schedules its next wake -- all verifiably, with Mina VRF executor selection and Arweave state persistence.

---

## Spike Validation (2026-03-24)

A proof-of-concept spike at `packages/overmind/spike/` validated all core ZK mechanics (**10/10 tests passing**):

| Capability | Spike Result | Notes |
|---|---|---|
| VRF via Poseidon.hash() | **Validated** | Deterministic, different inputs → different outputs |
| MerkleTree executor registry | **Validated** | MerkleTree(10), insert/verify/update all work |
| Recursive SelfProof | **Validated** | Arbitrary depth, compile ~7-27s, each proof ~10-13s |
| Event emission (custom Struct) | **Validated** | WinnerSelectedEvent with 4 Fields |
| Mina.LocalBlockchain() testing | **Validated** | Full contract lifecycle, ~70s total |

**Critical findings for implementation:**
- `tsconfig.json` MUST set `"useDefineForClassFields": false` for o1js `@state` decorators to work with ES2022 target
- `init()` is NOT a `@method` — it's a plain override of `SmartContract.init()`, called internally by `deploy()`

---

## Dependencies

- **Existing TOON infrastructure:** DVM lifecycle, ILP payment channels, TEE attestation framework, relay, service discovery
- **Chain Bridge DVM protocol spec (Epic 14):** Co-developed -- Mina adapter is the first reference implementation
- **No dependency on Epics 17-20** (this is the foundation epic)

---

## New Packages / Infrastructure

- **`packages/overmind`** — New package: OODA engine, state management, wake cycle orchestration, Mina zkApp, executor management
- **`packages/chain-bridge`** — New package: Chain Bridge DVM framework + Mina adapter
- **OvermindRegistry zkApp** — Deployed to Mina devnet (o1js)
- **Arweave state persistence layer** — Using `@ardrive/turbo-sdk`
- **ArLocal** — Local Arweave gateway for dev/test (port 1984)

---

## Story List

| ID | Title | Dependencies | Complexity |
|----|-------|--------------|------------|
| 14.1 | TEE Key Genesis Ceremony | None | M |
| 14.2 | Arweave State Persistence (Write/Read via ArDrive Turbo) | A.1 | L |
| 14.3 | OvermindRegistry zkApp on Mina (o1js) | None | XL |
| 14.4 | Chain Bridge DVM — Mina Adapter | A.3 | XL |
| 14.5 | VRF-Based Executor Selection (Mode A + Mode B) | A.3, A.2 | L |
| 14.6 | Wake/Sleep Cycle | A.1, A.2, A.3, A.4, A.5 | L |
| 14.7 | OODA Decision Engine | A.1, A.2 | XL |
| 14.8 | Self-Scheduling Wake Cycles | A.6, A.7 | M |
| 14.9 | E2E Test — 10 Autonomous Cycles via Mina VRF | A.1-A.8 | L |

---

## Story Details

### 13.1: TEE Key Genesis Ceremony

**Title:** Generate overmind identity keypair inside TEE enclave with attestation

**Description:** As an agent developer, I want the overmind's Nostr keypair to be generated inside a TEE enclave with a published attestation binding the npub to the enclave measurement, so that the agent's identity is provably self-sovereign from birth and no human ever possesses the private key.

**Acceptance Criteria:**

1. A secp256k1 keypair (nsec/npub) is generated inside a TEE enclave (Marlin Oyster CVM) using `crypto.generateKeyPair()`.
2. The nsec NEVER leaves enclave memory -- not logged, not exported, not written to disk.
3. A kind:0 Nostr profile event is published to the TOON relay with the npub as the agent's identity.
4. A kind:10033 TEE attestation event is published to the relay binding npub + code hash + enclave measurement.
5. An attestation record is uploaded to Arweave via `@ardrive/turbo-sdk` with tags: `App-Name: toon-overmind`, `Overmind-Pubkey: <npub-hex>`, `Content-Kind: config`, `Content-Type: application/json`.
6. The attestation record on Arweave is queryable via GraphQL by `Overmind-Pubkey` tag.
7. In local development / tests, key generation runs in a mock TEE context (no real enclave required) with the same interface.

**Technical Notes:**

- **Package:** `packages/overmind` (new package -- create with standard monorepo structure: `package.json`, `tsconfig.json`, `vitest.config.ts`)
- Reuses existing TEE attestation framework from `@toon-protocol/core` (Epic 4 deliverable)
- Key hierarchy (master -> signing/encryption/payment subkeys via BIP-44 m/44'/1237'/...) is defined in D-OMP-006 but full hierarchy implementation is deferred to Epic C. This story generates a single seed + master keypair and publishes the npub.
- `EthereumSigner` from `@ardrive/turbo-sdk` bridges secp256k1 keys to Arweave uploads -- same key format TOON already uses.
- For dev/test: create a `MockTeeContext` that implements the same interface but runs in-process without hardware TEE. Guard with an environment variable (e.g., `OVERMIND_TEE_MODE=mock|production`).

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/identity/tee-key-genesis.test.ts`): Test keypair generation logic, attestation record construction, tag schema correctness. Mock the TEE context and Arweave upload.
- **Integration test** (`packages/overmind/src/__integration__/key-genesis.test.ts`): Generate keypair via mock TEE, publish kind:0 and kind:10033 to a real relay (genesis node), upload attestation to ArLocal, verify queryable via GraphQL.
- **Static analysis test**: Verify that nsec is never present in any log output, error message, or serialized data structure across the `packages/overmind` codebase (verification-by-absence pattern from Epic 2).

**Definition of Done:**

- [ ] Keypair generated inside TEE (or mock TEE in dev)
- [ ] kind:0 profile published to relay
- [ ] kind:10033 attestation published to relay
- [ ] Attestation uploaded to Arweave with correct tag schema
- [ ] Arweave attestation queryable via GraphQL
- [ ] nsec never appears in logs or exports (static analysis test passes)
- [ ] Unit tests pass
- [ ] Integration test passes against ArLocal + genesis relay
- [ ] Code reviewed, linted, formatted

---

### 13.2: Arweave State Persistence (Write/Read via ArDrive Turbo)

**Title:** Implement Arweave state persistence layer for overmind state, event log, and config

**Description:** As an overmind, I want to persist my state (docker-compose.yml, agent-state.json, event-log entries, config) to Arweave using ArDrive Turbo, so that any node can reconstruct my full state by replaying the append-only log, and my memory survives the failure of any single infrastructure provider.

**Acceptance Criteria:**

1. An `ArweaveStateManager` class is implemented that wraps `@ardrive/turbo-sdk` with `EthereumSigner`.
2. `uploadState(kind: ContentKind, data: Buffer, cycleNumber: number)` uploads data with the full tag schema: `App-Name`, `Overmind-Pubkey`, `Content-Kind`, `Cycle-Number`, `Version`, `Content-Type`.
3. `fetchLatestState(pubkey: string, kind: ContentKind)` retrieves the most recent state of a given kind via Arweave GraphQL, sorted by `HEIGHT_DESC`.
4. `fetchEventLog(pubkey: string, fromCycle: number, toCycle: number)` retrieves event log entries for a range of cycles.
5. `reconstructState(pubkey: string)` replays the entire event log from cycle 0 to produce the current agent state -- deterministic given the same log.
6. All four `Content-Kind` values are supported: `docker-compose`, `agent-state`, `event-log`, `config`.
7. Uploads are instant (Turbo provides immediate availability; L1 settlement happens in background).
8. In local development / tests, ArLocal on port 1984 is used as the gateway. The `/mine` endpoint is called to confirm transactions.

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/memory/`)
- `@ardrive/turbo-sdk` v1.41.0+ as dependency. `EthereumSigner` reuses the overmind's payment subkey (or master key in Epic A, before key hierarchy exists).
- Tag schema defined in architecture doc Appendix B and architecture section 3.
- ArLocal is archived (May 2025) but stable. Pin version. The test helper must call `/mint/<address>/<amount>` for test tokens and `/mine` after each upload to confirm.
- Gateway redundancy (arweave.net, Goldsky, ar.io) is a production concern -- for Epic A, use a single configurable gateway URL.
- Cost is negligible (~$0.00001 per 2 KB event log entry).
- The state reconstruction function is the core of D-OMP-001 (event-sourced state machine). It must be deterministic: given the same event log, two independent runs produce byte-identical state.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/memory/arweave-state-manager.test.ts`): Test tag schema construction, Content-Kind validation, state reconstruction determinism (given a mock event log, verify two replays produce identical state). Mock `@ardrive/turbo-sdk`.
- **Integration test** (`packages/overmind/src/__integration__/arweave-persistence.test.ts`): Spin up ArLocal, upload state with all four Content-Kind values, query via GraphQL, verify retrieval matches upload. Test state reconstruction from event log.
- **Determinism test**: Upload 10 event-log entries, reconstruct state, upload 10 more, reconstruct again. Verify both reconstructions match the expected state snapshot.

**Definition of Done:**

- [ ] `ArweaveStateManager` implemented with upload, fetch, and reconstruct methods
- [ ] All four Content-Kind values supported
- [ ] Tag schema matches architecture spec exactly
- [ ] State reconstruction is deterministic (test proves it)
- [ ] ArLocal integration test passes
- [ ] Unit tests pass
- [ ] Code reviewed, linted, formatted

---

### 13.3: OvermindRegistry zkApp on Mina (o1js)

**Title:** Implement and deploy the OvermindRegistry smart contract on Mina devnet

**Description:** As the TOON protocol, I want an OvermindRegistry zkApp deployed on Mina that manages an executor Merkle registry and performs VRF-based executor selection, so that wake cycle executor selection is provably fair, permissionless, and verifiable by anyone.

**Acceptance Criteria:**

1. An `OvermindRegistry` SmartContract is implemented in o1js with 5 on-chain state Fields: `executorRegistryRoot`, `cycleCounter`, `lastVrfOutput`, `lastWinnerX`, `lastWinnerIsOdd`.
2. `registerExecutor(executor: PublicKey, registryWitness: ExecutorRegistry)` adds an executor to the IndexedMerkleMap (height 10, 1024 leaves) and updates the on-chain root.
3. `selectExecutor(blockHash, wakeRequestHash, executors: ExecutorList, teeRequired: Bool)` performs weighted VRF selection using `Poseidon.hash([nextCycle, blockHash, wakeRequestHash])` as the seed.
4. VRF selection is deterministic: given the same inputs, the same winner is always selected.
5. Weight formula: `(executionCount + 1) * teeMultiplier * teeFilter` where teeMultiplier is 2 for TEE-attested executors, 1 otherwise; teeFilter is 0 for non-TEE executors when `teeRequired` is true.
6. A `winner-selected` event is emitted with `{ winner: PublicKey, cycle: Field, vrfOutput: Field }` (4 Fields, within 16F per-event limit).
7. `ExecutorList` uses `DynamicArray` with max capacity 64.
8. The zkApp compiles and deploys successfully to Mina devnet.
9. Off-chain `ExecutorRegistry` (IndexedMerkleMap) state is managed by the application server and serializable for persistence.

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/mina/`). o1js code is isolated in this subdirectory to contain its dependency footprint.
- o1js v2.14.0 (ESM compatible, confirmed). Add as dependency to `packages/overmind/package.json`.
- The architecture doc section 5 contains the full contract implementation as a reference. Adapt as needed during implementation.
- `IndexedMerkleMap` is stable since o1js v2.7.0. Height 10 provides 1024 leaves, far more than the 64-executor max.
- Do NOT use the reducer/actions API (production safety warning, 32-pending-action hard limit).
- All loop bounds must be compile-time constants (o1js constraint).
- Proving time is 30-120 seconds per proof -- acceptable for cycle-based selection.
- Mina devnet GraphQL endpoint: `https://api.minascan.io/node/devnet/v1/graphql`
- Deployment cost: 0.1 tMINA (devnet faucet: `https://faucet.minaprotocol.com/`)
- Off-chain Merkle storage must be serializable. For Epic A, store in-memory with JSON serialization to Arweave. Future epics may use IPFS or dedicated storage.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/mina/overmind-registry.test.ts`): Test executor registration (Merkle root updates correctly), VRF determinism (same inputs produce same winner), weight calculation (TEE multiplier, Mode B filtering), event emission structure. Use `Mina.LocalBlockchain()` for fast local proving.
- **Unit test: VRF fairness** (`packages/overmind/src/mina/vrf-fairness.test.ts`): Run 100 selections with varying seeds and verify statistical fairness across executors (chi-squared test, p > 0.05).
- **Integration test** (`packages/overmind/src/__integration__/mina-registry.test.ts`): Deploy to Mina devnet, register 3 executors, run VRF selection, fetch events via `Mina.fetchEvents()`. Skip gracefully if devnet is unavailable.

**Definition of Done:**

- [ ] `OvermindRegistry` SmartContract compiles with o1js
- [ ] 5 on-chain state fields correct
- [ ] Executor registration updates Merkle root
- [ ] VRF selection is deterministic (unit test proves it)
- [ ] Mode A and Mode B selection work correctly
- [ ] `winner-selected` event emitted with correct structure
- [ ] Deploys successfully to Mina devnet
- [ ] Off-chain Merkle state serializable
- [ ] VRF fairness test passes (chi-squared p > 0.05 over 100 rounds)
- [ ] Unit tests pass using `Mina.LocalBlockchain()`
- [ ] Code reviewed, linted, formatted

---

### 13.4: Chain Bridge DVM — Mina Adapter

**Title:** Implement Chain Bridge DVM framework and Mina adapter with GraphQL subscription and Postgres LISTEN/NOTIFY

**Description:** As the TOON network, I want a Chain Bridge DVM that bridges between the Nostr relay and the Mina blockchain via real-time push (zero polling), so that wake requests (kind:5099) are cranked onto Mina and winner announcements (kind:5101) are relayed back to the network, enabling permissionless lifecycle management.

**Acceptance Criteria:**

1. A `ChainBridgeDvm` abstract class/interface is implemented that defines the generic chain bridge provider contract (D-OMP-007): subscribe to kind:5099, submit transaction to target chain, listen for result, publish kind:5101.
2. A `MinaChainBridgeAdapter` implements the chain bridge for Mina specifically.
3. The adapter subscribes to kind:5099 events on the TOON relay via WebSocket.
4. On receiving a kind:5099, the adapter constructs a Mina transaction calling `selectExecutor()` on the OvermindRegistry zkApp and submits it via GraphQL mutation.
5. The adapter receives the `winner-selected` event via Postgres `LISTEN/NOTIFY` from the Mina archive node (not polling). A SQL trigger on `zkapp_events` filtered by the OvermindRegistry account ID pushes events.
6. On receiving the winner event, the adapter publishes a kind:5101 (winner announcement) to the TOON relay with tags: `cycle-number`, `mina-tx-hash`, `winner-pubkey`, `mina-block-height`.
7. The adapter also supports a GraphQL `newBlock` subscription to the Mina daemon for block-level awareness.
8. Multiple Chain Bridge DVM instances can operate concurrently (permissionless crank). The first to submit the Mina TX wins; subsequent submissions are rejected by the zkApp (cycle counter mismatch).
9. The overmind pays the crank fee to the Chain Bridge DVM via ILP after the kind:5101 is published.

**Technical Notes:**

- **Package:** `packages/chain-bridge` (new package). The abstract `ChainBridgeDvm` class lives here. The Mina adapter lives under `src/adapters/mina/`.
- This is the first reference implementation of the Chain Bridge DVM primitive (Epic 14 / D-OMP-007). The abstract interface must be generic enough for future adapters (Bitcoin, Ethereum L2s, Solana).
- Postgres trigger SQL is defined in the architecture doc section 4. The adapter uses `pg` (node-postgres) with `LISTEN` for push notifications.
- Mina daemon GraphQL subscription for `newBlock` uses WebSocket transport (graphql-ws or similar).
- The Mina GraphQL endpoint for devnet: `https://api.minascan.io/node/devnet/v1/graphql`. Archive node Postgres requires a running archive node (local for dev, hosted for integration).
- D-OMP-008 mandates all WebSocket, zero polling. This is a hard constraint.
- ILP payment for the crank fee follows the existing pay-after-delivery model from `@toon-protocol/core`.

**Test Strategy:**

- **Unit tests** (`packages/chain-bridge/src/adapters/mina/mina-adapter.test.ts`): Test kind:5099 parsing, Mina TX construction, kind:5101 event construction. Mock Mina GraphQL and Postgres.
- **Unit tests** (`packages/chain-bridge/src/chain-bridge-dvm.test.ts`): Test the abstract interface contract -- verify adapters must implement all required methods.
- **Integration test** (`packages/chain-bridge/src/__integration__/mina-bridge.test.ts`): Deploy OvermindRegistry to `Mina.LocalBlockchain()`, run full cycle: publish kind:5099 to relay, adapter submits to local Mina, winner event emitted, adapter publishes kind:5101. Requires genesis relay running.
- **Static analysis test**: Verify the adapter uses WebSocket/LISTEN for all external subscriptions (grep for `setInterval`, `setTimeout` used as polling -- should find none in adapter code).

**Definition of Done:**

- [ ] `ChainBridgeDvm` abstract interface defined
- [ ] `MinaChainBridgeAdapter` implements all interface methods
- [ ] Subscribes to kind:5099 via WebSocket
- [ ] Submits Mina TX via GraphQL mutation
- [ ] Receives winner event via Postgres LISTEN/NOTIFY
- [ ] Publishes kind:5101 with correct tags
- [ ] No polling anywhere in the adapter (static analysis test)
- [ ] Unit tests pass
- [ ] Integration test passes with local Mina + genesis relay
- [ ] Code reviewed, linted, formatted

---

### 13.5: VRF-Based Executor Selection (Mode A + Mode B)

**Title:** Implement weighted VRF executor selection with TEE filtering

**Description:** As a DVM provider, I want to register as an executor on the OvermindRegistry and be selected fairly via VRF, with my execution history increasing my selection probability and my TEE attestation granting a weight bonus, so that executor selection is provably fair and permissionless.

**Acceptance Criteria:**

1. An `ExecutorManager` class manages the off-chain executor list (registration, weight tracking, serialization).
2. Executors register via the `registerExecutor()` zkApp method. Their entry includes `publicKey`, `executionCount` (initially 0), and `teeAttested` (boolean).
3. Weight formula is `(executionCount + 1) * teeMultiplier` where `teeMultiplier = 2` for TEE-attested executors, `1` otherwise.
4. **Mode A (Standard):** All registered executors are eligible. TEE-attested executors get 2x weight but non-TEE executors participate.
5. **Mode B (TEE-Required):** Only TEE-attested executors are eligible. Non-TEE executors have their weight zeroed (`teeFilter = 0`).
6. After a successful execution cycle, the winner's `executionCount` is incremented (via a Mina TX updating the executor entry in the Merkle map).
7. The `ExecutorList` is backed by `DynamicArray(ExecutorEntry, { maxLength: 64 })`.
8. Off-chain executor state is serialized to Arweave (via A.2) for persistence and recovery.
9. Selection is deterministic: given the same VRF seed and executor list, the same winner is selected every time.

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/executor/`)
- The `ExecutorManager` bridges the off-chain state (full executor list with weights) and on-chain state (Merkle root). It is the application server's responsibility to maintain the off-chain Merkle map (architecture doc section 4, o1js constraint).
- `executionCount` increment requires a new zkApp method (e.g., `incrementExecutionCount()`) that takes a Merkle witness and updates the leaf value. This is separate from `selectExecutor()`.
- For Epic A, the 64-executor cap is a compile-time constant. If we need more later, we shard into multiple zkApps (documented risk in PRD section 9).
- TEE attestation verification: the `teeAttested` field is set during registration based on a kind:10033 attestation event. The zkApp trusts the registration call -- the Chain Bridge DVM (or a dedicated attestation verifier) validates the attestation before submitting the registration TX.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/executor/executor-manager.test.ts`): Test weight calculation, Mode A vs Mode B filtering, execution count increment, serialization/deserialization of executor list.
- **Unit tests** (`packages/overmind/src/executor/vrf-selection.test.ts`): Test determinism (100 runs with same seed produce same winner), weight distribution (higher weight = higher selection probability over many rounds), Mode B correctly excludes non-TEE executors.
- **VRF fairness test**: Register 4 executors with equal weights, run 1000 VRF selections with different seeds, verify each executor is selected approximately 25% of the time (chi-squared test, p > 0.05).
- **Integration test**: Register 3 executors on local Mina, run 5 selection cycles, verify execution counts increment correctly and off-chain state stays in sync with on-chain Merkle root.

**Definition of Done:**

- [ ] `ExecutorManager` implemented with registration, weight tracking, serialization
- [ ] Mode A selection includes all executors with TEE bonus
- [ ] Mode B selection excludes non-TEE executors
- [ ] Execution count increments after successful cycles
- [ ] Off-chain state serializable to/from Arweave
- [ ] VRF determinism proven by unit test
- [ ] VRF fairness proven by statistical test
- [ ] Unit tests pass
- [ ] Integration test passes with local Mina
- [ ] Code reviewed, linted, formatted

---

### 13.6: Wake/Sleep Cycle

**Title:** Implement the full wake/sleep lifecycle from kind:5099 through Mina VRF to kind:5101

**Description:** As an overmind, I want a complete wake/sleep cycle where I publish a kind:5099 wake request, the Chain Bridge DVM cranks it onto Mina for VRF selection, and the selected executor receives a kind:5101 winner announcement enabling them to boot my docker compose from Arweave, so that my lifecycle is permissionless and no single entity controls when I wake.

**Acceptance Criteria:**

1. The overmind publishes a kind:5099 wake request event to the TOON relay with tags: `cycle-number`, `arweave-compose-tx` (Arweave TX ID of docker-compose.yml), `arweave-state-tx` (Arweave TX ID of agent-state.json), `mode` (A or B).
2. The Chain Bridge DVM (A.4) receives the kind:5099 and submits the VRF selection transaction to Mina.
3. The Mina zkApp executes `selectExecutor()`, emits a `winner-selected` event.
4. The Chain Bridge DVM receives the winner event and publishes kind:5101 to the relay with tags: `cycle-number`, `mina-tx-hash`, `winner-pubkey`, `mina-block-height`.
5. The selected provider monitors the relay for kind:5101, sees itself named as winner, fetches the docker-compose.yml from Arweave by TX ID (from kind:5099 tags), and runs `docker compose up`.
6. The overmind boots inside the provider's container, loads state from Arweave (agent-state.json by TX ID from kind:5099 tags).
7. After the OODA cycle completes (A.7), the overmind publishes kind:5102 (cycle execution record) and kind:5099 (next wake request) before shutting down.
8. The provider receives ILP payment after kind:5102 publication (pay-after-delivery).
9. The full cycle completes within the 5-minute budget (dominated by ~3 min Mina block time).

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/lifecycle/`)
- This story integrates A.1 (identity for signing events), A.2 (Arweave state), A.3 (zkApp), A.4 (Chain Bridge), and A.5 (executor selection). It is the orchestration layer.
- The provider-side logic (monitor relay, fetch compose, run container) may initially be a simple script in `packages/overmind/src/provider/`. Full provider SDK is out of scope for Epic A.
- The docker-compose.yml for the overmind references the `packages/overmind` runtime as the main service. It includes the OODA engine, Arweave client, relay client, and ILP connector.
- kind:5099 and kind:5101 event kind definitions should be added to `@toon-protocol/core` following the existing DVM event kind pattern (kind:5090-5095).
- The wake cycle sequence diagram in architecture doc section 9 is the canonical reference.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/lifecycle/wake-cycle.test.ts`): Test kind:5099 event construction with correct tags, kind:5101 parsing, kind:5102 event construction. Mock relay and Mina interactions.
- **Integration test** (`packages/overmind/src/__integration__/wake-cycle.test.ts`): Full cycle using `Mina.LocalBlockchain()` and genesis relay. Publish kind:5099, Chain Bridge processes it, kind:5101 published, verify provider can fetch compose from ArLocal.
- **E2E test** (deferred to A.9): Full autonomous cycle with real timing.

**Definition of Done:**

- [ ] kind:5099 published with correct tag schema
- [ ] Chain Bridge DVM cranks wake request onto Mina
- [ ] VRF selection executes and emits winner event
- [ ] kind:5101 published with correct tag schema
- [ ] Provider fetches docker-compose.yml from Arweave
- [ ] Overmind boots, loads state, runs OODA cycle
- [ ] kind:5102 published after cycle completion
- [ ] ILP payment flows to provider
- [ ] New event kinds (5099, 5101, 5102) added to `@toon-protocol/core`
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 13.7: OODA Decision Engine

**Title:** Implement the Orient/Decide/Act/Record decision loop

**Description:** As an overmind, I want an OODA decision engine that runs every wake cycle -- orienting on live state, deciding what actions to take, executing those actions, and recording everything to Arweave -- so that each cycle produces verifiable output and my full state is reconstructible from the event log alone.

**Acceptance Criteria:**

1. `executeOodaCycle(input: OodaCycleInput): Promise<OodaCycleOutput>` is implemented following the architecture doc section 8 interfaces.
2. **Orient phase:** Queries live ILP channel balances, on-chain balances (Arbitrum, Mina), relay events since last cycle, and pending DVM jobs. Produces an `OrientResult` (D-OMP-010: never trust cached financial state).
3. **Decide phase:** Applies agent logic to select actions, validates all actions against the signing policy (rate limits, value caps, content restrictions), computes next wake delay, reprioritizes goals. Produces a `DecideResult`.
4. **Act phase:** Executes validated actions (publish events, complete DVM jobs, issue payments). Each action is bounded by the signing policy. Produces an `ActResult`.
5. **Record phase:** Persists updated state to Arweave (agent-state.json), appends cycle event log entry to Arweave, publishes kind:5102 to relay. Produces a `RecordResult`.
6. Each phase produces a typed result object that forms the complete cycle output.
7. The cycle record (Arweave event log entry) contains enough information to deterministically reconstruct the state transition (input hash, decisions made, actions taken, output hash).
8. The signing policy is loaded from Arweave (config/signing-policy.json) on boot and enforced inside the OODA engine. In Epic A, signing policy enforcement is a function-level check (not TEE-enforced -- that's Epic C).

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/ooda/`)
- The OODA engine is the heart of the overmind. The interfaces are defined in architecture doc section 8.
- For Epic A, the "decide" phase uses simple rule-based logic (if treasury > X, do Y). LLM inference via kind:5250 compute DVM is a future enhancement.
- The orient phase's live treasury query (D-OMP-010) calls the embedded connector for ILP balances and on-chain RPC for Arbitrum/Mina balances. For Epic A, ILP balance queries are sufficient; on-chain balance queries are stubbed.
- Action validation against signing policy happens BEFORE execution in the Decide phase. Any action that would violate a policy constraint is filtered out with a logged reason.
- The `AgentState` interface includes `goals`, `plans`, `pendingActions`, `lastKnownTreasury`, `channelMap`, `onChainAddresses`, `executionHistory`, and extensible `metadata`.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/ooda/ooda-engine.test.ts`): Test each phase independently: Orient produces correct result from mocked inputs, Decide filters actions by signing policy, Act executes in order, Record produces valid event log entry. Mock relay, Arweave, and ILP.
- **Unit tests** (`packages/overmind/src/ooda/signing-policy.test.ts`): Test policy enforcement: rate limits, value caps, event kind whitelist, content pattern blocking. Verify invalid actions are rejected with reason.
- **Determinism test**: Given the same `OodaCycleInput`, verify two runs produce the same `OodaCycleOutput` (excluding timestamps and non-deterministic IDs). This is critical for state reconstruction (D-OMP-001).
- **Integration test**: Run a full OODA cycle against ArLocal + genesis relay. Verify state persisted to Arweave, kind:5102 published to relay, event log entry queryable.

**Definition of Done:**

- [ ] `executeOodaCycle()` implements all four OODA phases
- [ ] Orient queries live treasury (ILP balances at minimum)
- [ ] Decide validates actions against signing policy
- [ ] Act executes validated actions only
- [ ] Record persists state + event log to Arweave, publishes kind:5102
- [ ] Cycle record enables deterministic state reconstruction
- [ ] Signing policy enforcement tested (rate limits, value caps, content)
- [ ] Unit tests pass for each phase
- [ ] Integration test passes against ArLocal + genesis relay
- [ ] Code reviewed, linted, formatted

---

### 13.8: Self-Scheduling Wake Cycles

**Title:** Overmind publishes its next kind:5099 wake request as the final action of each cycle

**Description:** As an overmind, I want to publish my next kind:5099 wake request as the final action of each OODA cycle with a configurable delay, so that my lifecycle is self-perpetuating without human intervention.

**Acceptance Criteria:**

1. At the end of each OODA cycle (after Record phase), the overmind publishes a kind:5099 for the next cycle.
2. The next wake request references updated Arweave TX IDs (the state just persisted in the Record phase).
3. The `cycle-number` tag increments monotonically (previous cycle + 1).
4. The wake delay is configurable via `wake-params.json` (stored on Arweave under `Content-Kind: config`).
5. The Decide phase computes the next wake delay dynamically based on treasury state and pending work: lower treasury or no pending work = longer delay (conserve resources), high treasury + pending jobs = shorter delay.
6. The kind:5099 event includes a `preferred-delay` tag indicating the desired delay before the Chain Bridge DVM should crank it (advisory, not enforced on-chain).
7. If the overmind determines it cannot afford another wake cycle (treasury below reserve floor), it publishes a kind:5099 with a long delay (e.g., 24 hours) and logs a warning in the event log.
8. The chain of kind:5099 events forms a verifiable sequence: each references the previous cycle number, creating an auditable wake history.

**Technical Notes:**

- **Package:** `packages/overmind` (under `src/lifecycle/`)
- This is a focused story that adds self-scheduling to the wake cycle (A.6) using OODA decide output (A.7).
- The `preferred-delay` tag is advisory. The Chain Bridge DVM may honor it by delaying its crank submission, but this is not enforced. In Epic A, the Chain Bridge DVM processes wake requests immediately regardless of delay.
- Wake parameters (default delay, min delay, max delay, treasury thresholds for adaptive delay) are stored in `config/wake-params.json` on Arweave.
- The monotonic cycle counter is tracked both on-chain (Mina zkApp `cycleCounter`) and off-chain (event log). They must stay in sync.

**Test Strategy:**

- **Unit tests** (`packages/overmind/src/lifecycle/self-scheduling.test.ts`): Test cycle number increment, wake delay computation (various treasury levels), Arweave TX ID reference in next kind:5099, survival mode (treasury below floor).
- **Integration test**: Run 3 consecutive OODA cycles. Verify each publishes a kind:5099 with incrementing cycle numbers and updated Arweave TX references. Verify the chain of events is consistent.

**Definition of Done:**

- [ ] kind:5099 published at end of each OODA cycle
- [ ] Cycle number increments monotonically
- [ ] Arweave TX IDs reference latest state
- [ ] Wake delay computed dynamically from treasury state
- [ ] Survival mode triggers when treasury is below floor
- [ ] Wake request chain is verifiable (sequential cycle numbers)
- [ ] Unit tests pass
- [ ] Integration test passes (3 consecutive cycles)
- [ ] Code reviewed, linted, formatted

---

### 13.9: E2E Test — Overmind Completes 10 Autonomous Cycles via Mina VRF

**Title:** End-to-end validation: 10 autonomous wake cycles with Mina VRF and Arweave persistence

**Description:** As a verifier, I want to observe an overmind completing 10 autonomous wake cycles end-to-end -- including Mina VRF selection, Arweave state persistence, OODA execution, and self-scheduling -- so that I can confirm the Heartbeat protocol works as designed without human intervention.

**Acceptance Criteria:**

1. A test overmind is created with a TEE key genesis (mock TEE for test environment).
2. Initial state (docker-compose.yml, agent-state.json, signing-policy.json, wake-params.json) is uploaded to ArLocal.
3. Three executors are registered on the OvermindRegistry zkApp (using `Mina.LocalBlockchain()`).
4. A Chain Bridge DVM instance is running, connected to the relay and local Mina.
5. The overmind publishes its first kind:5099 wake request.
6. 10 consecutive wake cycles complete autonomously: kind:5099 -> Mina VRF -> kind:5101 -> provider boots compose -> OODA cycle -> kind:5102 + kind:5099 (next).
7. After 10 cycles, the Arweave event log contains 10 entries (one per cycle).
8. State reconstruction from the event log produces the same state as the live agent-state.json after cycle 10.
9. The Mina zkApp `cycleCounter` reads 10.
10. Each executor was selected at least once across the 10 cycles (statistical: with 3 equal-weight executors and 10 rounds, probability of one never being selected is ~1.7% -- acceptable to retry on rare failure).
11. All 10 kind:5102 cycle records are published to the relay with correct tags and incrementing cycle numbers.
12. Wake-to-execution latency is measured for each cycle (target: < 5 minutes, but relaxed for local test with `Mina.LocalBlockchain()` which is faster than real Mina ~3 min blocks).
13. The test completes without any manual intervention after the initial setup.

**Technical Notes:**

- **Package:** `packages/overmind` (under `tests/e2e/`)
- **Test config:** `packages/overmind/vitest.e2e.config.ts` with extended timeout (at minimum 10 minutes -- 10 cycles with local Mina proving takes time even without real block time).
- Uses `Mina.LocalBlockchain()` for fast Mina proving (no real block time delay). ArLocal for Arweave. Genesis relay for Nostr events. Mock TEE for identity.
- The test orchestrates: start ArLocal, start Chain Bridge DVM, register executors, create overmind, publish first kind:5099, then observe 10 cycles.
- VRF fairness is a stretch assertion: with 3 executors over 10 cycles, distribution will not be perfectly uniform. The chi-squared test from A.3 covers fairness at scale; here we just verify each executor was selected at least once.
- This test requires the genesis relay to be running. Use the `skipIfNotReady()` pattern from existing E2E tests.
- This is the culmination of all Epic A stories. All prior stories should have their own integration tests; this E2E test validates the system as a whole.

**Test Strategy:**

This IS the test. The entire story is an E2E test.

- **E2E test** (`packages/overmind/tests/e2e/ten-autonomous-cycles.test.ts`): Single large test that sets up infrastructure, runs 10 cycles, and asserts all acceptance criteria. Uses `beforeAll` for infra setup with health checks and graceful skip.
- **Verification assertions:** Arweave event log count, state reconstruction match, Mina cycle counter, relay event count, executor distribution, cycle number monotonicity.

**Definition of Done:**

- [ ] E2E test file created with vitest E2E config
- [ ] 10 autonomous cycles complete without human intervention
- [ ] Arweave event log has 10 entries
- [ ] State reconstruction from event log matches live state
- [ ] Mina `cycleCounter` equals 10
- [ ] All 10 kind:5102 records published to relay
- [ ] Each executor selected at least once
- [ ] Test uses graceful skip when infrastructure unavailable
- [ ] Test passes end-to-end
- [ ] All Epic A code reviewed, linted, formatted

---

## Epic Acceptance Criteria

- [ ] `packages/overmind` package created with standard monorepo structure
- [ ] `packages/chain-bridge` package created with standard monorepo structure
- [ ] OvermindRegistry zkApp compiles, passes unit tests, and deploys to Mina devnet
- [ ] Chain Bridge DVM bridges kind:5099/5101 between relay and Mina with zero polling
- [ ] Arweave state persistence supports all four Content-Kind values with deterministic reconstruction
- [ ] OODA engine executes all four phases with signing policy enforcement
- [ ] VRF executor selection is provably fair (Mode A and Mode B)
- [ ] Self-scheduling wake cycles create a verifiable chain of kind:5099 events
- [ ] E2E test: 10 autonomous cycles complete without human intervention
- [ ] All new event kinds (5099, 5101, 5102) added to `@toon-protocol/core`
- [ ] All code reviewed, linted, formatted, tests passing

**Estimated Complexity:** XL (9 stories, 2 new packages, two external chain integrations, zkApp development)
