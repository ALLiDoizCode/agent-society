# Test Design: Epic 11 -- TOON Pets -- ZK-Proven Virtual Pet Economy

**Date:** 2026-04-06
**Author:** Jonathan Green
**Status:** Draft

---

## Executive Summary

**Scope:** Risk-based test plan for Epic 11 -- TOON Pets. 14 stories across 4 sprints introducing ZK-proven pet lifecycle on Mina, Memvid brain via napi-rs, ILP cross-chain payment, and Pet DVM integration. Three new packages: `@toon-protocol/memvid-node` (napi-rs), `@toon-protocol/pet-circuit` (o1js), `@toon-protocol/pet-dvm`.

**Nature of Testing:** This epic produces compiled TypeScript + Rust code across three new packages, a ZK circuit (o1js), and cross-system integrations (Mina lightnet, Arweave DVM, ILP payment channels, Memvid native addon). Testing spans unit tests, circuit constraint verification, integration tests, and full E2E against the existing SDK E2E infrastructure (Docker Compose with Anvil, Mina lightnet, peer nodes).

**Risk Summary:**

- Total risks identified: 22
- High-priority risks (score >= 6): 9
- Critical categories: ZK (5 risks), NAPI (3 risks), INTEG (4 risks), PERF (3 risks), ECON (3 risks), DATA (2 risks), SEC (2 risks)

**Coverage Summary:**

- P0 scenarios (circuit correctness + napi-rs stability): 28 (~40-60 hours)
- P1 scenarios (integration + DVM flow + payment): 24 (~30-45 hours)
- P2 scenarios (client UI + marketplace + breeding): 18 (~20-30 hours)
- **Total effort**: ~90-135 hours (~4-6 weeks, aligns with 4-sprint plan)

---

## 1. Risk Assessment

### 1.1 Risk Register

| ID | Category | Risk | P | I | Score | Story | Mitigation |
|----|----------|------|---|---|-------|-------|------------|
| R-001 | NAPI | napi-rs native binding fails on CI/CD or platform mismatch | 3 | 3 | **9** | 11-1 | Prebuilt binaries per platform; CI matrix (linux-x64, darwin-arm64); fallback to sidecar |
| R-002 | ZK | PetLifecycle circuit exceeds 40K row constraint budget | 2 | 3 | **6** | 11-2 | Budget tracked per constraint group (see canonical spec: ~3,500 rows/interaction); compile-time check |
| R-003 | ZK | Circuit compilation takes 2-5 minutes, blocks iteration | 3 | 2 | **6** | 11-2 | Cache verification key to disk; compile once per CI run; unit tests use `proofsEnabled: false` |
| R-004 | ZK | Decay arithmetic diverges from Ditto canonical values | 2 | 3 | **6** | 11-2, 11-4 | Property-based tests: circuit decay vs reference TypeScript implementation; golden test vectors |
| R-005 | ZK | Recursive proof chain breaks on state mismatch | 2 | 3 | **6** | 11-2 | Integration test: genesis -> 10 interactions -> verify lifecycleHash chain |
| R-006 | NAPI | PetBrain.hash() non-deterministic due to .mv2 segment ordering | 2 | 3 | **6** | 11-1 | Determinism test: same events in -> same hash out (100 iterations); exclude HNSW (per spec) |
| R-007 | INTEG | Cross-package type mismatch (memvid-node <-> pet-circuit <-> pet-dvm) | 3 | 2 | **6** | 11-5 | Shared type definitions in pet-circuit; integration test compiles all three packages together |
| R-008 | INTEG | Async proof queue loses interactions on DVM restart | 2 | 3 | **6** | 11-5 | WAL-backed proof queue; recovery test: kill DVM mid-batch, restart, verify no lost interactions |
| R-009 | PERF | Proof generation > 5 min for batch of 10, blocking settlement | 3 | 2 | **6** | 11-2, 11-7 | Performance benchmark: measure batch-10 proof time; circuit optimization if > 5 min |
| R-010 | ZK | BLAKE3-to-Field truncation (253-bit) introduces collision | 1 | 2 | **2** | 11-1 | Theoretical analysis sufficient (126.5 bits collision resistance > Mina security level) |
| R-011 | DATA | .mv2 file corruption loses pet brain state | 2 | 2 | **4** | 11-12 | Recovery test: corrupt .mv2 -> restore from Arweave checkpoint -> verify brainHash matches on-chain |
| R-012 | INTEG | DVM-to-Mina settlement fails (lightnet config, gas, PET token) | 2 | 2 | **4** | 11-3, 11-7 | E2E test against real Mina lightnet (existing infra); deploy script for PetZkApp |
| R-013 | ECON | PET token pricing not resolved (fixed vs market) | 2 | 2 | **4** | 11-8, 11-11 | Use fixed placeholder pricing for Sprint 1-2; parametric token cost in circuit |
| R-014 | SEC | Timestamp manipulation allows interaction replay | 2 | 3 | **6** | 11-2 | Circuit enforces: timestamps advance, slot-bounded batches (D8/D10); fuzz test with adversarial timestamps |
| R-015 | ECON | ILP-to-PET cross-chain pricing oracle unavailable | 2 | 2 | **4** | 11-11 | Static exchange rate for testing; oracle integration deferred to late Sprint 3 |
| R-016 | INTEG | Ditto integration breaks existing Blobbi UI | 2 | 2 | **4** | 11-9 | Regression: existing Kind 31124 rendering unchanged; new tags additive only |
| R-017 | DATA | Checkpoint atomicity violation (hash computed from partial write) | 2 | 3 | **6** | 11-12 | Lock protocol (commit -> lock -> hash -> upload -> release); test concurrent write during checkpoint |
| R-018 | PERF | .mv2 files grow unbounded, slowing DVM operations | 2 | 2 | **4** | 11-1, 11-12 | Size monitoring in BrainStats; checkpoint + archive older segments |
| R-019 | ZK | Owner signature verification adds unexpected constraint overhead | 2 | 2 | **4** | 11-2 | Budget estimate: ~400 rows for Mina-native Signature; validate in constraint count test |
| R-020 | SEC | Cooldown bypass via manipulated lastTimestamp array | 2 | 3 | **6** | 11-2, 11-4 | Circuit enforces cooldown per action type with Poseidon hash of timestamp array; adversarial test |
| R-021 | ECON | DVM operator can front-run or delay proof settlement | 2 | 2 | **4** | 11-5 | Slot-bounded timestamps (max 1hr batch window); owner can verify via on-chain state |
| R-022 | ZK | Breeding circuit exceeds constraint budget (two parent proofs) | 3 | 2 | **6** | 11-13 | Feasibility spike before implementation; may need simplified offspring derivation |

### 1.2 Risk Heat Map

```
Impact  3 │ R-001     R-002,R-004,R-005,R-006   R-014,R-017,R-020
        2 │           R-003,R-007,R-009,R-022   R-010
        1 │           R-018                      
          └──────────────────────────────────────
            1              2                 3     Probability
```

---

## 2. Three-Tier Trust Model Test Strategy

The TOON Pet system has three distinct enforcement tiers. Each requires a different test approach.

### Tier 1: Full ZK (Zero Trust -- Math)

**What:** Game rules encoded in PetLifecycle ZkProgram circuit. Stat decay, action effects, cooldowns, evolution thresholds, token costs, timestamps, owner signatures.

**Test approach:**

| Test Type | What It Validates | Package | Speed |
|-----------|-------------------|---------|-------|
| **Constraint count test** | Circuit stays within 40K row budget | pet-circuit | Seconds (compile once) |
| **Property-based tests** | Decay arithmetic matches Ditto canonical values for all stages | pet-circuit | Seconds (`proofsEnabled: false`) |
| **Golden vector tests** | Known input -> known output for every action type x stage combination | pet-circuit | Seconds |
| **Boundary tests** | Stats clamped to [1,100], stage never regresses, cycle increments by 1 | pet-circuit | Seconds |
| **Adversarial tests** | Reject backdated timestamps, cooldown violations, wrong action for stage | pet-circuit | Seconds |
| **Recursive chain test** | Genesis -> N interactions -> verify lifecycleHash continuity | pet-circuit | Minutes (proof gen) |
| **Owner sig verification** | Invalid Mina key signature rejected; valid accepted | pet-circuit | Seconds |
| **Slot-bound test** | Batch timestamp outside [now-3600s, now+300s] rejected | pet-circuit | Seconds |

**Key test scenarios (P0):**

| ID | Scenario | Expected |
|----|----------|----------|
| ZK-001 | Feed sushi to baby pet: hunger +30, happiness +5, hygiene -6, energy +7 | Stats match exactly |
| ZK-002 | Decay baby pet for 2 hours (awake): hunger -14, happiness -8, hygiene -10, energy -16 | Stats match (floored) |
| ZK-003 | Attempt feed on egg stage | Circuit rejects |
| ZK-004 | Attempt interaction before cooldown elapsed | Circuit rejects |
| ZK-005 | Hatch with cycle=6 (below 7 threshold) | Circuit rejects |
| ZK-006 | Hatch with cycle=7, all stats >= 70 | Circuit accepts, stage 0->1 |
| ZK-007 | Evolve with all stats >= 80, cycle >= 21 | Circuit accepts, stage 1->2 |
| ZK-008 | Stage regression (adult -> baby) | Circuit rejects |
| ZK-009 | tokenCost below required cost | Circuit rejects |
| ZK-010 | Recursive proof chain: 10 interactions with valid state transitions | Chain verifies |
| ZK-011 | brainHash unchanged between interactions | Circuit rejects |
| ZK-012 | Owner signature with wrong Mina key | Circuit rejects |
| ZK-013 | Batch timestamp > currentSlot + 300s | Circuit rejects |
| ZK-014 | interactionHash mismatch (tampered action data) | Circuit rejects |

### Tier 2: Verifiable (BLAKE3 + Arweave)

**What:** Pet brain (.mv2) integrity. brainHash on-chain matches BLAKE3 of .mv2 stored on Arweave. Anyone can verify.

**Test approach:**

| Test Type | What It Validates | Package | Speed |
|-----------|-------------------|---------|-------|
| **Determinism test** | Same events -> same brainHash (100 iterations) | memvid-node | Seconds |
| **Truncation test** | BLAKE3 (256-bit) -> 253-bit Field conversion is injective | pet-circuit | Milliseconds |
| **Hash-of-hashes test** | Composite hash covers exactly: frames, lex, time, temporal, sketch | memvid-node | Seconds |
| **Exclusion test** | Vec index (HNSW) changes do NOT affect brainHash | memvid-node | Seconds |
| **Round-trip test** | Upload .mv2 -> download from Arweave -> recompute hash -> matches | pet-dvm + Arweave DVM | Minutes (E2E) |
| **Corruption recovery test** | Corrupt .mv2 -> restore from Arweave -> hash matches on-chain | pet-dvm | Minutes |

**Key test scenarios (P0):**

| ID | Scenario | Expected |
|----|----------|----------|
| BK-001 | Create brain, put 10 events, commit, hash() returns 64-char hex | Valid BLAKE3 hex |
| BK-002 | Repeat BK-001 with same events -- hash identical | Deterministic |
| BK-003 | Truncate hash to 253 bits, convert to Field | Field < p (Pasta modulus) |
| BK-004 | Change only vec index (rebuild HNSW) -- brainHash unchanged | Excluded segment |
| BK-005 | Upload .mv2 to Arweave, download, recompute brainHash | Match |

### Tier 3: DVM-Attested (Trust Operator)

**What:** Social task completion for evolution (hatch: kind:1 + kind:36767 + kind:3367; evolve: 3x kind:36767 + 3x kind:3367 + kind:1 + kind:16769). DVM checks relay for these events.

**Test approach:**

| Test Type | What It Validates | Package | Speed |
|-----------|-------------------|---------|-------|
| **Attestation test** | DVM correctly queries relay for social task events | pet-dvm | Seconds (mocked relay) |
| **Missing task test** | DVM rejects evolution when social tasks incomplete | pet-dvm | Seconds |
| **Fake event test** | DVM verifies event signatures (not just existence) | pet-dvm | Seconds |

**Key test scenarios (P1):**

| ID | Scenario | Expected |
|----|----------|----------|
| DV-001 | Hatch request with all 3 social events present on relay | DVM attests, evolution proceeds |
| DV-002 | Hatch request with missing kind:36767 event | DVM rejects hatch |
| DV-003 | Evolution request with forged social events (wrong pubkey) | DVM rejects |

---

## 3. Per-Story Risk Assessment and Test Strategy

### Sprint 1: Foundation

#### Story 11-1: napi-rs Memvid Binding (`@toon-protocol/memvid-node`)

**Risks:** R-001 (platform mismatch, score 9), R-006 (hash non-determinism, score 6), R-018 (file growth)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 12 | PetBrain lifecycle: create -> putBytes -> commit -> hash -> search -> close |
| Unit | 4 | Error handling: corrupt file, missing path, locked file, WAL replay failure |
| Unit | 3 | Threading: concurrent reads during write; hash() after commit() reflects new state |
| Integration | 2 | Platform matrix: linux-x64 + darwin-arm64 CI runners |
| Property | 1 | Determinism: 100x same input -> same hash |

**Quality gate:** `PetBrain.hash()` returns identical value for identical input across 100 iterations and across platforms.

#### Story 11-2: PetLifecycle ZkProgram (`@toon-protocol/pet-circuit`)

**Risks:** R-002 (row budget, score 6), R-003 (compile time, score 6), R-004 (decay divergence, score 6), R-005 (chain break, score 6), R-009 (proof time), R-014 (timestamp manipulation), R-019 (sig overhead), R-020 (cooldown bypass)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Constraint | 1 | Compile circuit, assert total rows < 40,000 per interaction step |
| Golden vectors | 33 | One per action type (11) x stage (3), using canonical Ditto values |
| Boundary | 12 | Stat clamp [1,100], stage transitions, cycle increment |
| Adversarial | 8 | Backdated timestamps, cooldown bypass, wrong stage action, token underpayment, sig forgery |
| Recursive | 1 | Genesis -> 10-step chain -> verify final lifecycleHash |
| Performance | 1 | Time single interaction proof generation (target: < 30s) |

**Quality gate:** All golden vectors match Ditto canonical reference. Constraint count < 40K. Adversarial inputs rejected.

**Note on compile time:** Tests MUST use `proofsEnabled: false` for constraint-checking tests (seconds). Only the recursive chain test and performance test enable actual proof generation (minutes). CI caches the verification key.

#### Story 11-3: PetZkApp SmartContract

**Risks:** R-012 (Mina settlement), R-013 (PET token)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 8 | On-chain state: 8 fields read/write correctly on LocalBlockchain |
| Unit | 4 | applyProof: valid proof updates state; invalid proof rejected |
| Unit | 3 | transferOperator: only owner can transfer; operator field updated |
| Unit | 2 | Events emitted: interaction, evolution, operator-transfer |
| Integration | 1 | Deploy to Mina lightnet, submit real proof, verify state update |

**Quality gate:** PetZkApp deploys and accepts valid proofs on LocalBlockchain with correct state updates.

#### Story 11-4: Pet Game Engine

**Risks:** R-004 (decay divergence, shared with 11-2), R-020 (cooldown bypass)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 33 | Decay calculation: all action x stage combinations match canonical doc |
| Unit | 11 | Cooldown enforcement per action type per stage |
| Unit | 6 | Evolution threshold validation |
| Unit | 4 | Stage-specific action restrictions |
| Unit | 3 | Stat clamping [1,100] edge cases |
| Property | 5 | Fuzz: random action sequences never produce stats outside [1,100] |
| Cross-verify | 33 | Game engine output == circuit output for same inputs (golden vectors shared with 11-2) |

**Quality gate:** Game engine produces identical results to pet-circuit for all golden vectors. This is the critical consistency gate -- the TypeScript game engine and the o1js circuit MUST agree on every calculation.

### Sprint 2: DVM Integration

#### Story 11-5: Pet DVM Handler

**Risks:** R-007 (type mismatch, score 6), R-008 (proof queue loss, score 6), R-021 (front-running)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 6 | Handler lifecycle: receive request -> validate -> process -> publish optimistic event |
| Unit | 4 | Proof queue: accumulate -> batch -> submit -> update events with proof tags |
| Unit | 3 | Error paths: invalid action, insufficient payment, unknown blobbi_id |
| Integration | 2 | Handler + memvid-node + game engine: full interaction flow |
| Recovery | 1 | Kill DVM mid-batch, restart, verify proof queue recovered |

**Quality gate:** Pet DVM handler processes interaction, publishes optimistic Kind 14919, queues proof, and returns new state to caller.

#### Story 11-6: Peer Enablement

**Risks:** R-007 (cross-package)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | Config parsing: PET_ENABLED, PET_ZKAPP_ADDRESS, PET_BRAIN_STORAGE_PATH |
| Unit | 2 | Handler registration: petHandler registered on correct kind when enabled |
| Unit | 2 | Service discovery: kind:10035 includes pet-dvm capability |
| Integration | 1 | Peer boots with PET_ENABLED=true, handler responds to pet interaction request |

**Quality gate:** Peer with `PET_ENABLED=true` registers handler and appears in service discovery.

#### Story 11-7: Pet DVM E2E Test

**Risks:** R-009 (proof time), R-012 (Mina settlement)

**Test strategy:**

This story IS the E2E test. It validates the full pipeline against real infrastructure.

| Level | Tests | What |
|-------|-------|------|
| E2E | 1 | Full lifecycle: create pet -> feed -> play -> clean -> verify on-chain state |
| E2E | 1 | Kind 14919 published to relay with correct tags |
| E2E | 1 | Proof settles on real Mina lightnet |
| E2E | 1 | brainHash on-chain matches .mv2 hash |

**Infrastructure:** Extends existing `docker-compose-sdk-e2e.yml`. Uses Anvil (port 18545) + Mina lightnet (port 19085) + Peer1 (port 19100). Adds PetZkApp deployment via `scripts/deploy-pet-zkapp.ts`.

**Quality gate:** End-to-end interaction succeeds: ILP payment -> DVM processes -> proof generated -> Mina state updated -> Kind 14919 on relay.

### Sprint 3: Client + Economy

#### Story 11-8: PET Token on Mina

**Risks:** R-013 (pricing unresolved)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 4 | Token minting, transfer, burn mechanics on LocalBlockchain |
| Unit | 2 | PetZkApp integrates token burn into applyProof |
| Integration | 1 | Token deployed on lightnet, DVM pays tokens during proof settlement |

**Quality gate:** PET token deploys, DVM can burn tokens as part of proof settlement.

#### Story 11-9: Ditto Pet DVM Integration

**Risks:** R-016 (Blobbi UI regression)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | Pet DVM discovery via kind:10035 filter |
| Unit | 2 | Kind 5XXX event builder constructs correct tags |
| Unit | 2 | Kind 6XXX result parser extracts new pet state |
| Regression | 1 | Existing Kind 31124 rendering unchanged after new tag additions |

**Quality gate:** Ditto can discover Pet DVM, send interaction request via ILP, and parse result.

#### Story 11-10: Proof Status UI (Ditto)

**Risks:** Low (UI-only, no protocol risk)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | Kind 14919 tag parser: optimistic vs proven status |
| Unit | 2 | UI renders proof badge (optimistic/proven/settled) correctly |
| Snapshot | 2 | Visual regression for proof status indicators |

**Quality gate:** Users can see whether a pet interaction is optimistic, proven, or settled.

#### Story 11-11: Cross-Chain DVM Pricing

**Risks:** R-015 (oracle unavailable), R-013 (token pricing)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | ILP-to-PET exchange rate calculation |
| Unit | 2 | Price advertisement in kind:10035 |
| Unit | 2 | DVM profit margin calculation |
| Integration | 1 | Owner pays USDC via ILP, DVM pays PET on Mina |

**Quality gate:** Cross-chain pricing produces valid exchange rate. DVM advertises correct price.

### Sprint 4: Advanced

#### Story 11-12: Arweave Checkpoint Automation

**Risks:** R-011 (corruption), R-017 (atomicity violation, score 6)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | Checkpoint protocol: commit -> lock -> hash -> upload -> release |
| Unit | 2 | Concurrent interaction during checkpoint is buffered |
| Integration | 1 | Full checkpoint to Arweave, download, verify hash matches |
| Adversarial | 1 | Simulate write during lock window, verify no partial hash |

**Quality gate:** Checkpoint produces consistent brainHash that matches the uploaded .mv2 file.

#### Story 11-13: Breeding Circuit

**Risks:** R-022 (constraint budget, score 6)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Feasibility | 1 | Compile breeding circuit, measure constraint count |
| Unit | 4 | Offspring derivation: two adult parents -> valid offspring state |
| Unit | 2 | Non-adult parents rejected |
| Unit | 2 | Cross-breed produces deterministic offspring traits |

**Quality gate:** Breeding circuit compiles within constraint budget. Offspring derivation is deterministic.

#### Story 11-14: Pet Marketplace

**Risks:** Low (builds on proven PetZkApp + token infrastructure)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 4 | List pet for sale, buy pet, transfer ownership |
| Unit | 2 | Verified biography accompanies listing (lifecycleHash + totalSpent) |
| Integration | 1 | Full marketplace flow on lightnet |

**Quality gate:** Pet can be listed, purchased, and ownership transferred on-chain.

### Sprint 5: Pet Dungeon Crawl (Party Mode 2026-04-08)

#### Story 11-15: Dungeon Engine Core

**Risks:** R-023 (rot.js headless compatibility), R-024 (RNG determinism across platforms)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 6 | rot.js dungeon generation: Digger, Cellular, Rogue layouts produce valid maps |
| Unit | 4 | Seedable RNG determinism: same seed → same dungeon (100 iterations, cross-platform) |
| Unit | 8 | Encounter resolution: pet stats vs monster stats, combat outcomes deterministic |
| Unit | 4 | Loot table rolls: rarity distribution, seed-based determinism |
| Unit | 3 | Room-by-room simulation: pet traverses dungeon, encounters resolve correctly |
| Property | 3 | Fuzz: random seeds never produce invalid dungeon layouts or out-of-bounds rooms |
| Benchmark | 1 | Full dungeon generation + simulation completes in < 50ms |

**Quality gate:** `DungeonGameEngine.run(seed, petStats)` produces identical output for identical inputs across 100 iterations.

#### Story 11-16: Pet-Dungeon Stat Bridge

**Risks:** R-004 (shared: stat divergence)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 5 | Stat mapping: each pet stat maps to correct dungeon modifier |
| Unit | 4 | Boundary cases: min stats (all 1) → worst modifiers; max stats (all 100) → best modifiers |
| Unit | 3 | Stat deltas: dungeon outcome produces valid pet stat deltas within [1,100] range |
| Cross-verify | 4 | Bridge output + PetGameEngine accepts stat deltas as valid interaction |

**Quality gate:** Pet stat deltas from dungeon run pass PetGameEngine validation and stay within [1,100] bounds.

#### Story 11-17: Dungeon DVM Handler

**Risks:** R-007 (type mismatch), R-025 (DVM-to-DVM composition latency)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 5 | Handler lifecycle: receive request → validate → run dungeon → return result |
| Unit | 3 | Error paths: invalid pet state hash, insufficient payment, unknown dungeon_id |
| Unit | 2 | SkillDescriptor: dungeon advertised correctly in kind:10035 |
| Integration | 2 | Dungeon DVM → PetDvmHandler composition: stat deltas applied and ZK-proven |
| Integration | 1 | Full flow: kind:5250 request → dungeon run → kind:6250 result with loot + stats |

**Quality gate:** Dungeon DVM handler processes request, returns deterministic result, and stat deltas feed back through PetDvmHandler successfully.

#### Story 11-18: Dungeon Adventure Log

**Risks:** Low (builds on existing kind:5094 infrastructure)

**Test strategy:**

| Level | Tests | What |
|-------|-------|------|
| Unit | 3 | Narrative generator: encounter data → readable story text |
| Unit | 2 | Log format: valid JSON with required fields (rooms, encounters, loot, stats) |
| Integration | 1 | Full log uploaded to Arweave via kind:5094 DVM, retrievable by tx ID |
| Integration | 1 | Pet biography query: fetch all adventure logs for a given blobbi_id |

**Quality gate:** Adventure log uploads to Arweave and is retrievable with correct content.

---

## 3.6 Risk Register Additions (Sprint 5)

| ID | Category | Risk | P | I | Score | Story | Mitigation |
|----|----------|------|---|---|-------|-------|------------|
| R-023 | INTEG | rot.js headless mode has undocumented DOM dependency | 1 | 3 | **3** | 11-15 | Spike: run rot.js Digger in Node.js without jsdom; verify no canvas/window usage |
| R-024 | ZK | rot.js RNG produces different output across Node.js versions | 2 | 3 | **6** | 11-15 | Determinism test: same seed on Node 20 + 24, compare dungeon layout byte-for-byte |
| R-025 | INTEG | DVM-to-DVM composition (dungeon → pet) exceeds ILP timeout | 2 | 2 | **4** | 11-17 | Dungeon returns result first (within timeout); stat feedback is async fire-and-forget |

---

## 4. Integration Test Approach for Cross-Package Dependencies

### 4.1 Package Dependency Graph

```
@toon-protocol/pet-dvm
  |-- @toon-protocol/memvid-node   (napi-rs, Rust native addon)
  |-- @toon-protocol/pet-circuit   (o1js ZkProgram + SmartContract)
  |-- @toon-protocol/sdk           (ServiceNode, Arweave upload)
  |-- @toon-protocol/core          (event kinds, encoding)

@toon-protocol/pet-circuit
  |-- o1js                         (Mina SDK, ZK proof system)

@toon-protocol/memvid-node
  |-- memvid (Rust, via napi-rs)   (external: /Users/jonathangreen/Documents/memvid/)
```

### 4.2 Integration Test Layers

**Layer 1: memvid-node <-> pet-circuit** (brainHash flow)

```
Test: PetBrain.hash() -> BLAKE3 hex -> truncate 253 bits -> Field -> circuit accepts
Validates: The hashing spec (pet-zkapp-blake3-hashing-spec.md) is correctly implemented end-to-end.
```

**Layer 2: game-engine <-> pet-circuit** (state consistency)

```
Test: TypeScript game engine and o1js circuit produce identical outputs for same inputs
Validates: The canonical game rules (pet-zkapp-game-rules-canonical.md) are identically encoded in both.
Uses: Shared golden test vector file (JSON) consumed by both test suites.
```

**Layer 3: pet-dvm <-> memvid-node + pet-circuit + sdk** (handler flow)

```
Test: Pet DVM handler receives Kind 5XXX, processes through all packages, returns result
Validates: The integration architecture (pet-zkapp-integration-architecture.md) data flow works.
```

**Layer 4: pet-dvm <-> Mina lightnet + Arweave DVM** (settlement)

```
Test: Full E2E against Docker infrastructure
Validates: Proof settles on real Mina, checkpoint uploads to real Arweave DVM.
```

### 4.3 Shared Golden Test Vectors

A single JSON file (`packages/pet-circuit/test-vectors/golden-vectors.json`) serves as the canonical test data consumed by:
- `pet-circuit` unit tests (circuit constraint verification)
- `pet-dvm` game engine unit tests (TypeScript rule engine)
- `pet-dvm` integration tests (end-to-end flow)

Format:

```json
{
  "vectors": [
    {
      "id": "feed-sushi-baby",
      "stage": 1,
      "action": { "actionType": 0, "itemId": 5, "timestamp": 1712345678, "tokenCost": 45 },
      "inputStats": { "hunger": 50, "happiness": 50, "health": 80, "hygiene": 80, "energy": 80 },
      "elapsedSeconds": 3600,
      "expectedDecayedStats": { "hunger": 43, "happiness": 46, "health": 79, "hygiene": 75, "energy": 72 },
      "expectedFinalStats": { "hunger": 73, "happiness": 46, "health": 89, "hygiene": 69, "energy": 79 }
    }
  ]
}
```

Any divergence between game engine and circuit output for the same vector is a **P0 blocker**.

---

## 5. Performance Test Strategy

### 5.1 Circuit Compilation

| Metric | Target | Acceptable | Test |
|--------|--------|------------|------|
| PetLifecycle compile time | < 3 min | < 5 min | CI: measure compile time, fail if > 5 min |
| Verification key size | < 5 MB | < 10 MB | CI: measure VK size |
| VK caching hit rate | 100% (after first compile) | -- | CI: second compile uses cache |

### 5.2 Proof Generation

| Metric | Target | Acceptable | Test |
|--------|--------|------------|------|
| Single interaction proof | < 30s | < 60s | Benchmark test |
| Batch of 10 (recursive) | < 3 min | < 5 min | Benchmark test |
| Memory during proof gen | < 4 GB | < 8 GB | Process monitor |

### 5.3 napi-rs Operations

| Metric | Target | Acceptable | Test |
|--------|--------|------------|------|
| PetBrain.putBytes() | < 10 ms | < 50 ms | Benchmark (1000 frames) |
| PetBrain.commit() | < 100 ms | < 500 ms | Benchmark (1000 frames) |
| PetBrain.hash() | < 50 ms | < 200 ms | Benchmark (1000 frames) |
| PetBrain.search() | < 20 ms | < 100 ms | Benchmark (1000 frames) |

### 5.4 E2E Latency

| Metric | Target | Acceptable | Test |
|--------|--------|------------|------|
| Interaction response (optimistic) | < 500 ms | < 2s | E2E test timing |
| Proof settlement (batch of 10) | < 10 min | < 15 min | E2E test timing |
| Arweave checkpoint | < 30s | < 60s | E2E test timing |

---

## 6. E2E Test Strategy (SDK E2E Infrastructure)

### 6.1 Infrastructure Extension

The existing `docker-compose-sdk-e2e.yml` provides:
- Anvil (EVM, port 18545) -- payment channels, USDC
- Mina lightnet (port 19085 GraphQL, port 19181 accounts manager)
- Peer1 (BLS port 19100, relay port 19000, BTP port 19700)
- Peer2 (BLS port 19110, relay port 19010, BTP port 19710)

**Epic 11 additions:**
- `scripts/deploy-pet-zkapp.ts` -- deploys PetZkApp + PetLifecycle to lightnet
- `PET_ENABLED=true` on Peer1 -- registers Pet DVM handler
- `PET_ZKAPP_ADDRESS` env var -- set by deploy script
- `PET_BRAIN_STORAGE_PATH` -- mounted volume for .mv2 files

### 6.2 E2E Test File

`packages/sdk/tests/e2e/docker-pet-dvm-e2e.test.ts`

Mirrors existing `docker-arweave-dvm-e2e.test.ts` pattern:

```
describe.skipIf(SKIP_E2E)('Pet DVM E2E', () => {
  1. Create test client with ILP payment channel to Peer1
  2. Discover Pet DVM via kind:10035
  3. Send Kind 5XXX pet interaction (feed sushi)
  4. Assert: ILP FULFILL returned with new pet state
  5. Assert: Kind 14919 published to relay (optimistic)
  6. Wait for proof batch completion
  7. Assert: Kind 14919 updated with proof + mina_tx tags
  8. Assert: PetZkApp on-chain state matches (brainHash, cycle, stage)
  9. Send 9 more interactions (to trigger batch of 10)
  10. Assert: Single Mina TX covers all 10 interactions
});
```

### 6.3 Infrastructure Script

`scripts/sdk-e2e-infra.sh` updated to:

```bash
# After existing PaymentChannel deployment:
echo "[infra] Compiling PetLifecycle ZkProgram (this takes 2-5 minutes)..."
PET_ZKAPP_ADDRESS=$(npx tsx scripts/deploy-pet-zkapp.ts)
export PET_ZKAPP_ADDRESS
echo "[infra] PetZkApp deployed at: $PET_ZKAPP_ADDRESS"
```

### 6.4 CI Considerations

- Circuit compilation (2-5 min) runs ONCE per CI pipeline, not per test
- Verification key cached in `packages/pet-circuit/.cache/`
- E2E tests tagged `@slow` -- run in separate CI stage from unit tests
- napi-rs prebuilt binaries for CI runner platform (linux-x64 for GitHub Actions)

---

## 7. Test Priority and Sequencing

### Sprint 1 Quality Gates (Must Pass Before Sprint 2)

| Gate | Test | Blocking? |
|------|------|-----------|
| G1 | napi-rs builds and passes on CI platform | Yes -- blocks all .mv2 work |
| G2 | PetBrain.hash() deterministic (100x) | Yes -- blocks brainHash integration |
| G3 | PetLifecycle compiles within 40K rows | Yes -- blocks all circuit work |
| G4 | All 33 golden vectors pass in circuit (proofsEnabled: false) | Yes -- blocks DVM integration |
| G5 | Game engine matches circuit for all golden vectors | Yes -- blocks DVM integration |
| G6 | Recursive 10-step proof chain verifies | Yes -- blocks settlement |

### Sprint 2 Quality Gates

| Gate | Test | Blocking? |
|------|------|-----------|
| G7 | Pet DVM handler processes interaction end-to-end | Yes -- blocks E2E |
| G8 | Peer with PET_ENABLED=true boots and registers handler | Yes -- blocks E2E |
| G9 | E2E test passes against real infrastructure | Yes -- blocks Sprint 3 |

### Sprint 3 Quality Gates

| Gate | Test | Blocking? |
|------|------|-----------|
| G10 | PET token mints, transfers, burns on lightnet | Yes -- blocks economy |
| G11 | Ditto sends pet interaction via ILP, receives result | Yes -- blocks UI |
| G12 | Cross-chain pricing produces valid exchange rate | No -- static fallback |

### Sprint 4 Quality Gates

| Gate | Test | Blocking? |
|------|------|-----------|
| G13 | Checkpoint atomicity: no partial hash under concurrent writes | Yes -- blocks checkpoint |
| G14 | Breeding circuit compiles (feasibility) | Yes -- blocks breeding |
| G15 | Marketplace list + buy flow on lightnet | No -- nice-to-have |

### Sprint 5 Quality Gates

| Gate | Test | Blocking? |
|------|------|-----------|
| G16 | rot.js dungeon generation deterministic (100 seeds × 2 Node versions) | Yes -- blocks all dungeon work |
| G17 | DungeonGameEngine.run() produces identical output for identical inputs | Yes -- blocks DVM handler |
| G18 | Pet stat deltas from dungeon accepted by PetGameEngine | Yes -- blocks composition |
| G19 | Dungeon DVM handler processes request end-to-end | Yes -- blocks E2E |
| G20 | Adventure log uploads to Arweave and is retrievable | No -- nice-to-have |

---

## 8. What Is NOT Tested

| Item | Reasoning | Mitigation |
|------|-----------|------------|
| Ditto UI rendering fidelity | UI is in external repo (ditto); tested there | Ditto regression suite |
| Memvid Rust internals | Tested in memvid repo; napi-rs binding tests cover surface | Memvid's own test suite |
| Mina network consensus behavior | Tested by Mina protocol team | Use real lightnet for E2E |
| LLM-generated pet personality | Non-deterministic, out of scope for ZK proofs | Not provable by design |
| Production Arweave uploads | Requires real AR tokens; E2E uses Arweave DVM in test mode | Manual smoke test before prod |
| Multi-DVM migration | Complex coordination; deferred to post-epic | Manual testing protocol |

---

## 9. Risk-to-Test Traceability Matrix

| Risk | Score | Test IDs | Level | Sprint |
|------|-------|----------|-------|--------|
| R-001 (napi-rs platform) | 9 | G1, BK-001-005 | Unit + CI matrix | 1 |
| R-002 (row budget) | 6 | G3, constraint count test | Compile | 1 |
| R-003 (compile time) | 6 | Perf-compile, VK cache test | CI | 1 |
| R-004 (decay divergence) | 6 | G4, G5, golden vectors | Unit | 1 |
| R-005 (chain break) | 6 | G6, ZK-010 | Integration | 1 |
| R-006 (hash non-determinism) | 6 | G2, BK-001-002 | Property | 1 |
| R-007 (type mismatch) | 6 | G7, integration compile | Integration | 2 |
| R-008 (proof queue loss) | 6 | Recovery test | Integration | 2 |
| R-009 (proof time) | 6 | Perf-batch-10 | Performance | 1-2 |
| R-014 (timestamp manipulation) | 6 | ZK-013, adversarial tests | Unit | 1 |
| R-017 (checkpoint atomicity) | 6 | G13, concurrent write test | Integration | 4 |
| R-020 (cooldown bypass) | 6 | ZK-004, adversarial tests | Unit | 1 |
| R-022 (breeding budget) | 6 | G14, feasibility spike | Compile | 4 |

---

## 10. Recommended BMAD Workflow Sequence

1. **TEA Test Design** (this document) -- COMPLETE
2. **BMAD Create Story** (11-1) -- embed G1, G2 as acceptance criteria
3. **TEA ATDD** -- generate failing acceptance tests for 11-1 (napi-rs)
4. **BMAD Dev Story** (11-1) -- implement with test-first guidance
5. **TEA ATDD** -- generate failing tests for 11-2 (circuit) using golden vectors
6. **BMAD Dev Story** (11-2) -- implement circuit, verify golden vectors match
7. **BMAD Dev Story** (11-4) -- implement game engine, cross-verify against 11-2
8. Continue per sprint plan, with each story embedding its quality gates from this document
