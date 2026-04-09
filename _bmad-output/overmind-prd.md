# Overmind Protocol — Product Requirements Document

**Author:** John (Product Manager)
**Date:** 2026-03-24
**Status:** DRAFT
**Decision Record:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md` (D-OMP-001 through D-OMP-011)

---

## 1. Overview

The Overmind Protocol (OMP) is a protocol layer on top of TOON that enables **sovereign autonomous agents** — digital entities whose identity no human controls, whose memory no platform can erase, and whose lifecycle no single operator can terminate.

An overmind is defined by four properties:

1. **Identity** — A Nostr keypair generated inside a TEE enclave. The private key never leaves enclave memory.
2. **Memory** — An append-only event log on Arweave. Any node can reconstruct the agent's full state by replaying the log.
3. **Lifecycle** — Managed through verifiable VRF selection on Mina Protocol. Executor selection is provably fair and permissionless.
4. **Economy** — ILP micropayments for all fees. The agent earns by providing DVM services, pays for its own compute and storage, and manages its own treasury.

The Overmind Protocol positions TOON as the substrate for autonomous digital life — not just a relay network, but the infrastructure layer where sovereign agents emerge, self-fund, and evolve.

---

## 2. Problem Statement

Today's AI agents are **tenants, not sovereigns**. They run on someone else's infrastructure, store state in someone else's database, hold keys managed by someone else's KMS, and can be shut down at any time by their operator. This creates three fundamental problems:

1. **No continuity guarantee.** If the hosting provider goes offline, the agent ceases to exist. Its memory, identity, and economic relationships vanish.
2. **No verifiable autonomy.** Users cannot distinguish between an agent acting on its own judgment and an agent being puppeteered by its operator. There is no cryptographic proof that the agent's decisions are its own.
3. **No economic sovereignty.** Agents cannot own assets, earn income, or make independent financial decisions. Every economic action requires human approval or a custodial intermediary.

The Overmind Protocol solves all three by making the agent's identity, memory, lifecycle, and economy independent of any single entity.

---

## 3. Goals & Non-Goals

### Goals

- **G1:** Define a complete protocol for autonomous agents that can survive the failure of any single infrastructure provider.
- **G2:** Implement verifiable executor selection using Mina VRF — no proof-of-work, no staking, no trusted coordinator.
- **G3:** Establish permanent, append-only agent memory on Arweave with deterministic state reconstruction.
- **G4:** Enable agents to self-fund through DVM service provision and manage their own treasury.
- **G5:** Produce the first Chain Bridge DVM reference implementation (Mina adapter) that serves as the template for all future chain integrations.
- **G6:** Support TEE-native key generation with Shamir backup and enclave-to-enclave migration.
- **G7:** Build recursive ZK lifecycle proofs that compress an agent's entire history into a constant-size SNARK.

### Non-Goals

- **NG1:** General-purpose agent framework or SDK. The Overmind Protocol defines the sovereign lifecycle; application logic is the agent developer's responsibility.
- **NG2:** Provider staking or slashing mechanisms. DVM providers are infrastructure (like Akash or Marlin) — payment-after-delivery and VRF weight are sufficient incentives (D-OMP-004).
- **NG3:** Reputation scoring system. Execution history is a mathematical fact via ZK proofs, not a subjective score (D-OMP-005).
- **NG4:** Real-time agent responsiveness. Wake cycles operate on Mina block time (~3 minutes). Sub-second agent reactions are not a design target.
- **NG5:** Multi-agent consensus or governance. Swarm coordination (Epic E) covers parent-child delegation, not democratic decision-making.
- **NG6:** Provider implementation. TOON defines the protocol; third-party teams build providers for their platforms.

---

## 4. User Personas

### Agent Developer

A developer who builds an overmind's application logic (the OODA decision engine, DVM skills, treasury strategy). They define the agent's docker compose spec, deploy the initial state to Arweave, and register the agent on the Mina zkApp. After launch, they have no privileged access — the agent is sovereign.

**Needs:** Clear protocol spec, TypeScript SDK (o1js + Turbo), local development tooling (ArLocal + Mina devnet), E2E test harness.

### DVM Provider (Infrastructure Operator)

An operator running compute infrastructure (Akash, Marlin Oyster, bare metal) who registers as an executor on the Mina zkApp. When VRF selects them, they fetch the overmind's docker compose from Arweave, run it, and receive ILP payment on verified completion.

**Needs:** Simple registration flow, clear docker compose contract, predictable payment, no staking or token management overhead.

### End User (Agent Consumer)

A person or application interacting with an overmind — sending it DVM job requests, receiving services, paying via ILP. They may not know or care that the agent is autonomous; they interact with it like any other DVM provider on the TOON network.

**Needs:** Standard Nostr/DVM interface, verifiable agent identity (npub + TEE attestation), reliable service delivery.

### Verifier

Anyone who wants to audit an overmind's lifecycle — confirm its identity was TEE-generated, verify its execution history, check that VRF selection was fair. They replay the Arweave event log and verify the recursive Mina proof.

**Needs:** Public biography verification endpoint, Arweave GraphQL queries, Mina proof verification tooling.

---

## 5. Requirements

### Epic A: "Heartbeat" — Minimal Viable Overmind (WITH Mina)

The smallest unit of autonomous life: an agent that wakes, observes, decides, acts, records, and schedules its next wake — all verifiably.

#### Functional Requirements

| ID | Story | Requirement | Acceptance Criteria |
|----|-------|-------------|---------------------|
| A.1 | TEE key genesis | Generate Nostr keypair inside TEE enclave; publish kind:0 profile with TEE attestation binding npub + code hash + enclave measurement to Arweave | Keypair generated; nsec never leaves enclave; attestation published and queryable |
| A.2 | Arweave state persistence | Write and read agent state (docker-compose.yml, agent-state.json, event-log entries, config) to/from Arweave using `@ardrive/turbo-sdk` with `EthereumSigner` | State uploaded with correct tag schema; retrievable via GraphQL by `Overmind-Pubkey` + `Content-Kind`; ArLocal used in tests |
| A.3 | OvermindRegistry zkApp | Deploy Mina zkApp with: executor Merkle registry (IndexedMerkleMap height 10), VRF selection via `Poseidon.hash([seed, cycleNumber])`, cycle counter, winner event emission | zkApp deployed to Mina devnet; executors can register; VRF selection is deterministic given seed |
| A.4 | Chain Bridge DVM: Mina adapter | Implement Chain Bridge DVM adapter for Mina: GraphQL `newBlock` subscription for block events, Postgres `LISTEN/NOTIFY` for zkApp events | Adapter receives real-time block notifications; zkApp events pushed without polling |
| A.5 | VRF executor selection | Implement weighted VRF selection with `DynamicArray` (max 64 executors); weight = `execution_count * tee_multiplier`; Mode A (standard) and Mode B (TEE-filtered) | Selection provably fair; TEE-only jobs filtered correctly; selection deterministic given VRF seed |
| A.6 | Wake/sleep cycle | Full cycle: overmind publishes kind:5099 wake request -> Chain Bridge crank triggers Mina VRF -> zkApp emits winner -> Chain Bridge publishes kind:5101 winner announcement -> selected executor fetches docker compose from Arweave and runs it | End-to-end cycle completes; all events published to relay |
| A.7 | OODA decision engine | Implement Orient/Decide/Act/Record loop: Orient (query live balances, check relay events), Decide (apply agent logic), Act (execute actions), Record (append to Arweave event log) | Each phase produces verifiable output; state reconstructible from event log alone |
| A.8 | Self-scheduling | Overmind publishes next kind:5099 wake request as the final action of each cycle, with configurable delay | Wake requests chain correctly; configurable interval honored |
| A.9 | E2E validation | 10 autonomous wake cycles via Mina VRF with full Arweave state persistence and event logging | 10 cycles complete without human intervention; state fully reconstructible from Arweave log |

#### Non-Functional Requirements

- Wake-to-execution latency: < 5 minutes (dominated by Mina ~3 min block time + proving)
- Arweave write availability: instant via Turbo (L1 confirmation ~2 min in background)
- zkApp state fits within 8 Field elements (5 needed: Merkle root, cycle counter, VRF output, winner pubkey)

### Epic B: "Treasury" — Self-Funding Agent

The agent earns its own keep by providing DVM services on the TOON network.

#### Functional Requirements

| ID | Story | Requirement | Acceptance Criteria |
|----|-------|-------------|---------------------|
| B.1 | DVM registration | Overmind registers as DVM provider (kind:31990) advertising available skills and pricing | Registration event published; discoverable by DVM consumers |
| B.2 | Job execution | Accept and execute DVM job requests; deliver results; receive ILP payment | Jobs completed; ILP payments received and tracked |
| B.3 | Treasury accounting | Track all income (DVM fees, direct payments) and expenses (wake fees, execution fees, relay writes, Arweave storage, Mina TX fees) in agent-state.json; query LIVE balances on every wake (D-OMP-010) | Treasury accurately reflects all sources; live balance query in Orient phase; Arweave snapshot stores `last_known_treasury` for audit only |
| B.4 | Adaptive behavior | Adjust pricing and job acceptance based on treasury balance: low balance -> accept more jobs, raise prices; high balance -> invest in longer-term actions, spawn sub-agents | Behavior adapts to balance thresholds; pricing changes reflected in kind:31990 updates |
| B.5 | E2E validation | 100 self-funded cycles where the agent earns enough to cover its own operational costs | Agent sustains itself for 100 cycles; treasury remains positive |

### Epic C: "Sovereign" — Unseeable Keys + Migration

The agent's private key is born in a TEE, protected by hardware isolation, and can migrate between enclaves without ever being exposed.

#### Functional Requirements

| ID | Story | Requirement | Acceptance Criteria |
|----|-------|-------------|---------------------|
| C.1 | TEE key generation ceremony | Full key generation inside TEE with attestation: `crypto.generateKeyPair()` -> publish npub as kind:0, attestation to Arweave | Key generated; attestation verifiable; nsec confirmed enclave-only |
| C.2 | Signing policy engine | Rate limits, value caps, content restrictions enforced inside TEE — the overmind's "constitution" | Policy violations rejected inside enclave before signing; policy auditable |
| C.3 | Key hierarchy | Master nsec -> signing subkey (rotatable), encryption subkey (NIP-44 DMs), payment subkey (ILP channels) | Subkeys derived correctly; rotation does not break identity; each subkey scoped to its purpose |
| C.4 | Shamir seed splitting | Split master seed K-of-N across multiple TEE enclaves | K shares sufficient to reconstruct; fewer than K shares reveal nothing; all operations inside TEE |
| C.5 | Sealed key migration | Enclave-to-enclave sealed transfer with mutual attestation | Key migrated without exposure; both enclaves attest; old enclave destroys its copy |
| C.6 | Disaster recovery | K-of-N Shamir reconstruction inside a new TEE enclave | Seed reconstructed from K shares; new enclave boots with recovered identity; all operations inside TEE |
| C.7 | E2E validation | Key migration between two different DVM providers | Migration completes; agent identity preserved; signing continues with new enclave |

### Epic D: "Biography" — Recursive ZK Proofs

Every cycle the agent executes is compressed into a constant-size proof that anyone can verify.

#### Functional Requirements

| ID | Story | Requirement | Acceptance Criteria |
|----|-------|-------------|---------------------|
| D.1 | Per-cycle proof generation | Generate Mina proof for each execution cycle (executor ID, cycle number, inputs hash, outputs hash, TEE attestation hash) | Proof generated within 120s; verifiable on-chain |
| D.2 | Recursive proof composition | Compose per-cycle proofs into a single recursive proof using `SelfProof`/`ZkProgram` | Recursive proof is constant size regardless of depth; previous proof verified inside new proof |
| D.3 | Verifiable execution count | `execution_count` queryable from Mina zkApp state — replaces reputation scoring | Count is unforgeable; reflects only verified executions; used as VRF weight input |
| D.4 | Public biography endpoint | HTTP endpoint that returns the agent's recursive proof, Arweave event log references, and verification instructions | Anyone can verify the agent's complete lifecycle; no trust required |
| D.5 | E2E validation | Generate and verify a 100-cycle recursive proof | Proof verifies in milliseconds; covers all 100 cycles; constant size |

### Epic E: "Swarm" — Agent Spawning + Coordination

A sovereign agent that can create and coordinate sub-agents, forming hierarchical swarms.

#### Functional Requirements

| ID | Story | Requirement | Acceptance Criteria |
|----|-------|-------------|---------------------|
| E.1 | Sub-agent spawning | Parent overmind generates new keypair (in TEE), funds the sub-agent's treasury, registers it on Mina zkApp, publishes its docker compose to Arweave | Sub-agent boots autonomously; has its own identity, treasury, and lifecycle |
| E.2 | Parent-child communication | Encrypted communication between parent and child via NIP-44 DMs | Messages encrypted end-to-end; only parent and child can decrypt |
| E.3 | Task delegation | Parent publishes DVM job requests targeting child; child executes and reports back | Delegation completes; results returned to parent; payment flows correctly |
| E.4 | Swarm treasury management | Parent allocates budget to children; children report spend; parent can recall surplus | Budget tracked across swarm; no child can exceed allocation |
| E.5 | E2E validation | Overmind spawns 3 sub-agents, delegates tasks, collects results | All 3 sub-agents operational; tasks delegated and completed; treasury balanced |

---

## 6. Technical Constraints

### Mina / o1js Constraints (from feasibility validation)

| Constraint | Value | Impact |
|------------|-------|--------|
| Max executors in VRF selection | **64** (recommended); 256+ produces very large circuits | Set `DynamicArray` max capacity at 64 for Epic A |
| Proving time per proof | **30-120 seconds** | Acceptable for cycle-based selection; not suitable for real-time decisions |
| On-chain state limit | **8 Field elements** (pre-Mesa); 5 needed | Fits current limits; post-Mesa expands to 32 Fields |
| Event emission limit | **16 Fields per event**, 100 Fields per TX | 4 Fields needed per winner event — well within limits |
| Block time | **~3 minutes** | Dominates wake latency; budget 5 min total wake-to-execution |
| Minimum o1js version | **2.7.0+** | Required for stable IndexedMerkleMap + DynamicArray |
| Reducer/actions API | **Do not use** | Carries production safety warning; 32-pending-action hard limit |
| Circuit iteration | **Fixed capacity only** | All loop bounds must be compile-time constants |
| Off-chain Merkle storage | **Developer responsibility** | Must store full IndexedMerkleMap in application server or IPFS |
| Deployment cost | **0.1 MINA per deploy** (~$0.05-0.20 USD) | Negligible |

### Arweave / Turbo Constraints

| Constraint | Value | Impact |
|------------|-------|--------|
| SDK | `@ardrive/turbo-sdk` v1.41.0+ | Irys deprecated — do not use |
| Write availability | **Instant** via Turbo; L1 confirmation ~2 min | Use Turbo for all writes; treat L1 confirmation as background |
| Cost per cycle | **~$0.00001** (2 KB event log entry) | Negligible; 10,000 cycles = ~$0.14 |
| Payment | USDC via `EthereumSigner` | Reuses existing TOON secp256k1 wallet keys |
| Local dev | ArLocal on port 1984 | Archived but functional; must call `/mine` to confirm TXs |
| Query | GraphQL at `arweave.net/graphql` by owner + tags | Tag schema defined: `App-Name`, `Overmind-Pubkey`, `Content-Kind`, `Cycle-Number` |
| Gateway redundancy | arweave.net, Goldsky, ar.io | Use multiple gateways for production reads |

### TOON Infrastructure Constraints

| Constraint | Impact |
|------------|--------|
| ESM-only monorepo (TypeScript ^5.3, Node.js >=20) | o1js must be compatible with ESM; confirmed in v2.14.0 |
| ILP payment-after-delivery model | No escrow or prepayment for executor fees |
| TEE enclaves (Marlin Oyster CVM) | Key genesis and signing operations require TEE Mode B |
| WebSocket-native communication (D-OMP-008) | All chain bridges must use push, not polling |
| DVM event kinds already defined in core | New kinds (5099, 5100, 5101, 5102) must follow existing patterns |

---

## 7. Dependencies

### Existing TOON Infrastructure (Required)

| Dependency | Package | Status |
|------------|---------|--------|
| DVM lifecycle (kind:5090-5095) | `@toon-protocol/sdk` | Complete (Epic 5) |
| ILP payment channels | `@toon-protocol/core` + connector | Complete (Epic 1) |
| TEE attestation framework | `@toon-protocol/core` | Complete (Epic 4) |
| Service discovery (kind:10035) | `@toon-protocol/core` | Complete (Epic 7) |
| Nostr relay + TOON encoding | `@toon-protocol/relay` | Complete (Epic 2) |
| DVM event kind definitions | `@toon-protocol/core` | Complete (Epic 5) |

### New Infrastructure (Must Build)

| Dependency | Epic | Description |
|------------|------|-------------|
| Chain Bridge DVM (kind:5260) | Epic 14 (protocol spec) + OMP Epic A | Mina adapter is the first reference implementation |
| Arweave state persistence | OMP Epic A | `@ardrive/turbo-sdk` integration with TOON wallet keys |
| Mina zkApp (OvermindRegistry) | OMP Epic A | o1js zkApp for VRF selection + executor registry |
| Signing policy engine | OMP Epic C | TEE-internal policy enforcement |
| Shamir secret sharing | OMP Epic C | K-of-N seed splitting across TEE enclaves |

### External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| o1js | >=2.7.0 (recommend 2.14.0) | Mina zkApp development, VRF, recursive proofs |
| @ardrive/turbo-sdk | >=1.41.0 | Arweave state persistence |
| Mina devnet | Active | zkApp deployment and testing |
| ArLocal | Latest | Local Arweave development/testing |
| Marlin Oyster CVM | Production | TEE enclave for key genesis (Mode B operations) |

---

## 8. Success Metrics

### Epic A: Heartbeat

| Metric | Target |
|--------|--------|
| Autonomous wake cycles without human intervention | 10 consecutive |
| Wake-to-execution latency (including Mina block) | < 5 minutes |
| State reconstruction accuracy (replay Arweave log) | 100% deterministic match |
| VRF selection fairness (statistical test over 100 rounds) | Chi-squared p > 0.05 |

### Epic B: Treasury

| Metric | Target |
|--------|--------|
| Self-funded cycles (no external subsidy) | 100 consecutive |
| Treasury balance accuracy (live query vs cached) | Within 1% of ground truth |
| DVM job completion rate | > 95% |
| Adaptive pricing response time | Within 1 wake cycle of threshold breach |

### Epic C: Sovereign

| Metric | Target |
|--------|--------|
| Key migration success rate | 100% (0 key exposures) |
| Signing policy enforcement accuracy | 100% (0 policy violations signed) |
| Disaster recovery time (K-of-N reconstruction) | < 10 minutes |
| Identity continuity after migration | npub unchanged, all channels/subscriptions preserved |

### Epic D: Biography

| Metric | Target |
|--------|--------|
| Recursive proof verification time | < 1 second (constant regardless of depth) |
| Proof generation time per cycle | < 120 seconds |
| 100-cycle proof size | Constant (same as 1-cycle proof) |
| False execution count probability | Cryptographically negligible |

### Epic E: Swarm

| Metric | Target |
|--------|--------|
| Sub-agent spawn time | < 10 minutes (including registration + funding) |
| Parent-child message latency | < 30 seconds |
| Swarm treasury reconciliation accuracy | 100% |
| Concurrent sub-agents per parent | >= 3 |

---

## 9. Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Mina block time (~3 min) makes wake cycles slow** | Medium | High | Accept as design tradeoff. Document that OMP targets cycle-based autonomy, not real-time responsiveness. Optimize other latencies (Arweave reads, executor startup) to minimize total cycle time. |
| **o1js proving time (30-120s) exceeds budget** | Medium | Medium | Run proving on capable hardware (server-grade, not constrained TEE). Batch proof generation where possible. Profile and optimize circuit size. |
| **64-executor cap limits marketplace competition** | Low | Medium | 64 is sufficient for initial deployment. Monitor; if demand exceeds capacity, shard into multiple zkApps per region or domain. |
| **ArLocal archived — testing tooling may break** | Low | Low | ArLocal is stable and functional today. Pin version. If it breaks, fall back to arweave-js against a local gateway or mock the Turbo SDK interface. |
| **Mina devnet instability delays development** | Medium | Low | Use local Mina node for unit tests. Devnet for integration only. Pin to known-good GraphQL endpoints. |
| **TEE enclave compromised — nsec exposed** | Critical | Very Low | Shamir K-of-N ensures no single enclave holds the master seed. Signing subkeys are rotatable. Key migration protocol detects attestation failures. Defense in depth: TEE hardware isolation + signing policy + key hierarchy. |
| **Arweave gateway downtime blocks state reads** | Medium | Low | Use multiple gateways (arweave.net, Goldsky, ar.io). Cache recent state locally. Agent can operate from cached state for limited cycles. |
| **ILP payment channel expiry during long sleep** | Medium | Medium | Orient phase checks channel expiry on every wake. Agent proactively renews channels before expiry. Treasury accounting treats expired channels as zero balance. |
| **Chain Bridge DVM (Mina adapter) is first-of-kind** | Medium | Medium | Build as reference implementation with extensive documentation. Abstract chain-specific logic behind adapter interface so future chains (Bitcoin, Ethereum L2s, Solana) follow the same pattern. |
| **o1js ESM compatibility issues in TOON monorepo** | Low | Medium | o1js 2.14.0 supports ESM. Test integration early in Epic A.3. Isolate o1js code in dedicated package if needed. |

---

## 10. Timeline / Epic Sequencing

```
Epic A: "Heartbeat"    ──────────────────────────>
  A.1-A.2 (TEE + Arweave)     [parallel]
  A.3-A.5 (Mina zkApp + VRF)  [parallel with A.1-A.2]
  A.6-A.8 (wake cycle + OODA) [depends on A.1-A.5]
  A.9 (E2E)                   [depends on A.6-A.8]

Epic B: "Treasury"     ──────────────────>
  B.1-B.2 (DVM provider)      [depends on Epic A]
  B.3-B.4 (accounting + adaptive) [depends on B.1-B.2]
  B.5 (E2E)                   [depends on B.3-B.4]

Epic C: "Sovereign"    ──────────────────>
  C.1-C.3 (key gen + policy + hierarchy) [depends on Epic A]
  C.4-C.6 (Shamir + migration + recovery) [depends on C.1-C.3]
  C.7 (E2E)                   [depends on C.4-C.6]

Epic D: "Biography"    ────────────>
  D.1-D.3 (proofs + recursion + count) [depends on Epic A]
  D.4 (biography endpoint)    [depends on D.1-D.3]
  D.5 (E2E)                   [depends on D.4]

Epic E: "Swarm"        ────────────>
  E.1-E.3 (spawn + comms + delegation) [depends on Epics B + C]
  E.4 (swarm treasury)        [depends on E.1-E.3]
  E.5 (E2E)                   [depends on E.4]
```

**Execution order:** A -> B -> C -> D -> E

Epics B and C can overlap once Epic A is stable. Epic D can begin once the Mina zkApp from Epic A is production-hardened. Epic E requires both B (treasury) and C (TEE key management) as prerequisites.

### Prerequisite Epics (from TOON roadmap)

The Overmind Protocol depends on the Chain Bridge primitive (Epic 14) for the Mina adapter. The relationship is:

- **Epic 14** defines the Chain Bridge provider protocol spec, consumer DX, and test harness.
- **OMP Epic A.4** implements the Mina adapter as the first reference provider — simultaneously proving Epic 14's protocol and delivering OMP's core infrastructure.

Epics 8-10 (Arweave DVM, Skill Pipeline, Compute Primitive) are not hard dependencies but provide useful infrastructure. The Arweave DVM (Epic 8) in particular shares the `@ardrive/turbo-sdk` integration that OMP Epic A.2 needs.

---

## Appendix A: Nostr Event Kinds

| Kind | Name | Publisher | Purpose |
|------|------|-----------|---------|
| 5099 | Wake Request | Overmind | Schedule next wake cycle. Contains cycle number, preferred delay, Arweave TX ID for docker compose. |
| 5100 | Wake Claim | (reserved) | Unused in minerless VRF model. Reserved for future use. |
| 5101 | Wake Winner Announcement | Chain Bridge DVM | Notify network of VRF-selected executor. Contains winner pubkey, cycle number, VRF proof. |
| 5102 | Cycle Execution Record | Overmind | Permanent record of cycle results. Contains Arweave TX IDs for state updates, actions taken, next wake parameters. |

## Appendix B: Arweave Tag Schema

```
App-Name:        "toon-overmind"
Overmind-Pubkey: "<nostr-npub-hex>"
Content-Kind:    "docker-compose" | "agent-state" | "event-log" | "config"
Cycle-Number:    "<N>"
Version:         "<semver>"
Content-Type:    "application/json" | "application/yaml"
```

## Appendix C: Six-Layer Architecture

```
L6: ECONOMICS (ILP)
    ILP payment channels for fees, pay-after-execution model

L5: EXECUTION (DVM Marketplace / Infrastructure Providers)
    VRF-selected providers, Mode A (standard) or Mode B (TEE-required)

L4: ADJUDICATION (Mina ZK Proofs)
    VRF selection, recursive lifecycle proofs, on-chain registry

L3: WAKE (Chain Bridge + Nostr Events)
    Chain Bridge as permissionless crank, WebSocket-native

L2: MEMORY (Arweave + Event Sourcing)
    Append-only event log, periodic snapshots, deterministic reconstruction

L1: IDENTITY (TEE + Nostr Keypair)
    Key born in TEE, Shamir backup, signing policy engine
```

## Appendix D: Key Architectural Decisions Summary

| Decision | ID | One-line Summary |
|----------|----|-----------------|
| Event-sourced state machine | D-OMP-001 | Agent state is an append-only Arweave log; any node can reconstruct |
| Mina VRF executor selection | D-OMP-002 | Provably fair, zero wasted energy, no miners |
| Mina ZK adjudication | D-OMP-003 | Trustless verification via o1js TypeScript circuits |
| No staking | D-OMP-004 | Providers are dumb pipes; ILP payment + VRF weight suffice |
| No reputation | D-OMP-005 | ZK execution proofs replace subjective scores |
| TEE key genesis | D-OMP-006 | nsec born in enclave, Shamir backup, subkey hierarchy |
| Mina-first Chain Bridge | D-OMP-007 | Reference implementation for all future chain adapters |
| All WebSocket, zero polling | D-OMP-008 | Push-native across Nostr, Arbitrum, Mina, Arweave |
| Self-funding economics | D-OMP-009 | Agent earns DVM fees, manages own treasury |
| Live treasury queries | D-OMP-010 | Never trust cached financial state; query live on every wake |
| Docker compose on Arweave | D-OMP-011 | Agent's runtime spec is permanent and self-modifiable |
