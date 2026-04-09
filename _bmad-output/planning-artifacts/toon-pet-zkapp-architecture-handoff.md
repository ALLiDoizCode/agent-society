# TOON Pet zkApp Architecture Handoff

**Date:** 2026-04-04
**Author:** Jonathan Green (with BMAD party-mode collaborative analysis)
**Audience:** TOON Protocol development team
**Status:** Exploration / Pre-RFC
**Extends:** [Memvid + TOON Integration Handoff](memvid-toon-integration-handoff.md)

---

## Executive Summary

This document captures the architecture for **TOON Pets** — Nostr virtual pets (Blobbi) with ZK-proven lifecycle, portable Memvid memory, and cross-chain payment via ILP. The design composes four existing TOON building blocks (ILP routing, Mina zkApps, Arweave DVMs, Memvid memory) into a pet economy where every interaction is a proven state transition paid for with real tokens.

**Key innovations over existing virtual pet systems:**
1. **ZK-proven game rules** — Pet stat changes, evolution, and breeding are enforced by a Mina zkApp circuit. Nobody can cheat.
2. **Cross-chain payment** — Owners pay in any token on any ILP-connected chain. DVM operators bridge to Mina's pet token economy.
3. **Portable memory** — Pet brain (`.mv2` file) lives on Arweave. Pet can migrate between operators or go self-hosted.
4. **Economic proof of care** — Every interaction costs tokens burned on-chain. A pet's value has a provable floor: the total tokens spent raising it.

**No TEE required.** ZK proofs + BLAKE3 hashing + ILP payment receipts provide tamper evidence, recovery, and third-party verification without trusted hardware.

---

## Architecture Overview

### The Stack

```
┌──────────────────────────────────────────────────┐
│  MINA PROTOCOL     — Proof + token layer         │
│  Pet zkApp (game rules, token sink, state)       │
│  PetLifecycle ZkProgram (recursive proofs)        │
├──────────────────────────────────────────────────┤
│  ARWEAVE            — Archive layer (permanent)   │
│  .mv2 brain checkpoints via kind:5094 DVM        │
├──────────────────────────────────────────────────┤
│  MEMVID (.mv2)      — Working memory layer       │
│  Pet brain: interactions, semantic search, RAG   │
├──────────────────────────────────────────────────┤
│  TOON PROTOCOL      — Communication + discovery  │
│  Nostr events, DVM marketplace, relay network    │
├──────────────────────────────────────────────────┤
│  CONNECTOR (ILP)    — Settlement layer           │
│  Multi-chain routing, payment channels           │
│  Any token → PET token bridge via DVM operators  │
└──────────────────────────────────────────────────┘
```

### Why No TEE for Pets

TEE solves "protect secrets during computation." Pets don't have secrets that need protecting from their owners:

| Concern | Solution | TEE needed? |
|---------|----------|-------------|
| Tamper-evident history | BLAKE3 hash → Mina recursive proof | No |
| Recovery from data loss | Replay Kind 14919 events from relays + Arweave .mv2 snapshots | No |
| Third-party verification | Mina on-chain state + proof verification | No |
| Anti-pump / fake history | zkApp enforces token payment per interaction | No |
| Breeding privacy (both parents' data) | ZK circuit proves correct offspring derivation without revealing parent memories | No |

TEE remains appropriate for Overmind sovereign agents (Epic 18) where runtime secrecy is the requirement. Pets use the ZK-only verification path.

---

## Token Economy

### Pet Token on Mina

Every pet interaction costs PET tokens burned/escrowed by the zkApp. This is the anti-pump mechanism:

- Pumping 1,000 interactions = spending tokens for 1,000 interactions
- The economic cost of fraud scales linearly with the fraud
- `totalSpent` field on-chain = provable floor price for the pet

### Cross-Chain Payment via ILP

Owners don't need Mina tokens or PET tokens. They pay in whatever they have:

```
Owner (has USDC on EVM)
    │
    │  ILP Prepare: 0.1 USDC
    ▼
DVM Operator (ILP peer, holds PET tokens on Mina)
    │
    │  Mina TX: 100 PET tokens → zkApp
    ▼
Pet zkApp (burns/escrows PET, updates state)
```

**DVM operators are market makers:** They hold PET token inventory on Mina and liquidity on other chains. They accept ILP payments in any routable token and pay the Mina-side cost from their own wallets. They profit on the spread.

### Three-Sided Market

| Participant | Role | Incentive |
|-------------|------|-----------|
| **Pet owners** | Demand side — care for pets | Pay any token, any chain |
| **DVM operators** | Supply side — run proofs, bridge tokens | Profit on spread between ILP payment and PET token cost |
| **PET token economy** | Utility sink — every action burns tokens | Real demand from gameplay, not speculation |

---

## Dual Operating Mode

The architecture supports both self-hosted and DVM-hosted operation. The zkApp doesn't care who generates the proof — the circuit is identical.

### Self-Hosted (Desktop / Power Users)

```
Owner's machine:
  1. Maintain local .mv2 (pet brain)
  2. Apply game rules locally
  3. Generate ZK proof locally (~10-30 sec)
  4. Pay PET tokens directly to zkApp on Mina
  5. Use Chain DVM for Mina TX broadcast (already exists)
  6. Publish Kind 14919 to TOON relay

Cost: PET tokens + Mina gas + Chain DVM fee
Trust: ZERO (owner runs everything)
Devices: Single machine (or manual .mv2 sync)
Requires: napi-rs Memvid binding, local o1js prover
```

### DVM-Hosted (Mobile / Web / Multi-Device)

```
Owner sends: "feed sushi" + ILP payment (any token, any chain)
DVM handles:
  1. Manage .mv2 brain
  2. Apply game rules
  3. Generate ZK proof
  4. Pay PET tokens to zkApp from DVM wallet
  5. Broadcast Mina TX
  6. Publish Kind 14919 to TOON relay
  7. Return new state to owner (instant feedback)
  8. Periodic Arweave checkpoints

Cost: ILP payment (covers PET tokens + gas + DVM margin)
Trust: Circuit-enforced (DVM can't cheat the rules)
Devices: Any (DVM is the single source of truth)
Requires: Nothing special on client side
```

### Migration Between Modes

```
DVM-HOSTED → SELF-HOSTED:
  1. Owner calls PetZkApp.transferOperator(ownPubkey)
  2. Download latest .mv2 from Arweave checkpoint
  3. Verify BLAKE3 matches on-chain brainHash
  4. Start proving locally

SELF-HOSTED → DVM-HOSTED:
  1. Upload .mv2 to Arweave (kind:5094)
  2. Owner calls PetZkApp.transferOperator(dvmPubkey)
  3. DVM downloads .mv2, verifies hash
  4. DVM resumes operations

DVM-A → DVM-B (switch providers):
  1. Owner calls PetZkApp.transferOperator(dvmBPubkey)
  2. DVM-B fetches latest .mv2 from Arweave
  3. DVM-B verifies BLAKE3 matches on-chain brainHash
  4. DVM-B resumes. No lock-in.
```

---

## Mina zkApp Design

### On-Chain State (8 Fields)

```typescript
class PetZkApp extends SmartContract {
  @state(Field) petId = State<Field>();          // 1. Poseidon(owner, seed, blobbiId)
  @state(Field) brainHash = State<Field>();      // 2. BLAKE3 of current .mv2 (as Field)
  @state(Field) lifecycleHash = State<Field>();  // 3. Accumulated recursive proof output
  @state(Field) cycle = State<Field>();          // 4. Total interaction count
  @state(Field) stage = State<Field>();          // 5. 0=egg, 1=baby, 2=adult
  @state(Field) ownerX = State<Field>();         // 6. Owner pubkey x-coordinate
  @state(Field) operatorX = State<Field>();      // 7. Current operator (DVM or owner)
  @state(Field) totalSpent = State<Field>();     // 8. Cumulative PET tokens spent

  events = {
    'interaction': Field,   // lifecycle hash after interaction
    'evolution': Field,     // new stage
    'operator-transfer': Field, // new operator pubkey
  };
}
```

### PetLifecycle ZkProgram (Recursive Proofs)

The game rules are encoded in the circuit. Every state transition is proven.

```typescript
// Core structs
class PetStats extends Struct({
  hunger: UInt32,      // 0-100
  happiness: UInt32,   // 0-100
  health: UInt32,      // 0-100
  hygiene: UInt32,     // 0-100
  energy: UInt32,      // 0-100
})

class PetAction extends Struct({
  actionType: UInt32,  // 0=feed, 1=play, 2=clean, 3=rest, 4=medicine
  itemId: UInt32,      // 0=none, or shop item ID
  timestamp: UInt64,   // unix seconds
  tokenCost: UInt64,   // PET tokens required for this action+item
})

class PetState extends Struct({
  stats: PetStats,
  stage: UInt32,          // 0=egg, 1=baby, 2=adult
  cycle: UInt64,          // interaction count
  lastInteraction: UInt64, // timestamp of last action
  brainHash: Field,       // BLAKE3 of .mv2 (as Field)
  totalSpent: UInt64,     // cumulative PET tokens
})
```

**ZkProgram methods:**

| Method | Purpose | Private Inputs |
|--------|---------|----------------|
| `genesis` | Birth/adoption (cycle 1, egg stage) | None |
| `interact` | Standard care action (feed, play, etc.) | SelfProof, PetAction, PetStats (decayed) |
| `evolve` | Stage transition (egg→baby, baby→adult) | SelfProof, new stage |
| `breed` | Cross-breed two adult pets | Two parent proofs, offspring derivation |

**What the circuit enforces:**

1. **Cycle increments by exactly 1** per interaction
2. **Timestamps must advance** (no backdating)
3. **Decay correctly applied** (elapsed time × stage-specific rates)
4. **Action correctly applied** (item effects match hardcoded values)
5. **Stats bounded 0-100** (no overflow)
6. **Stage only advances** (egg→baby→adult, never regress)
7. **Brain hash changed** (proves .mv2 was updated)
8. **Token cost matches action** (sushi costs what the circuit says it costs)
9. **Total spent accumulates** (running sum of all token costs)

**Game balance is in the circuit.** Changing what sushi does requires deploying a new circuit version — visible, auditable, no silent server-side patches.

### Optimistic State + Async Proof (Batching)

Mina proof generation takes ~10-30 seconds. For real-time feedback:

```
1. Owner sends "feed sushi" → DVM (or local)
2. Immediately:
   a. Update .mv2 (fast, local operation)
   b. Publish Kind 14919 WITHOUT proof (optimistic)
   c. Return new state to owner (instant UI feedback)
3. Asynchronously:
   a. Batch N interactions into one proof
   b. PetLifecycle chains N steps recursively
   c. Submit single Mina TX (one on-chain update per batch)
4. Publish UPDATED Kind 14919 WITH proof + mina_tx tags

Recommended batch size: ~10 interactions per Mina TX
Owner gets instant feedback. Proof settles within minutes.
```

This follows Mina's Actions and Reducer pattern — dispatch is cheap, reduction is batched.

---

## Memvid Integration

### Pet Brain (.mv2)

Every Kind 14919 interaction event is ingested into the pet's `.mv2` file with three representations:

- **Lexical (Tantivy)** — full-text searchable ("fed sushi at 2pm")
- **Vector (HNSW)** — semantic embeddings (food interactions cluster together)
- **Temporal** — timestamped for replay and decay correlation

The pet can semantically search its own history: "what makes me happy?" returns actual experience data, not a number.

### BLAKE3 Hashing Scope

For deterministic replay and provability, the BLAKE3 hash covers only deterministic segments:

```
HASH INCLUDES:
  ├── WAL (ordered event log) — deterministic by definition
  ├── Lex index (Tantivy)     — deterministic with fixed merge policy
  └── Time index              — deterministic (timestamp-ordered)

HASH EXCLUDES:
  └── Vec index (HNSW)        — non-deterministic graph construction

The proof covers WHAT the pet experienced (events + text + time).
Semantic search (vectors) is a derived capability, rebuilt on demand.
```

### napi-rs Binding Surface

Memvid is Rust-only. A thin napi-rs binding is needed for Node.js integration:

```typescript
// @toon-protocol/memvid-node (napi-rs wrapper)

class PetBrain {
  static create(path: string): PetBrain;
  static open(path: string): PetBrain;

  putBytes(data: Buffer, options?: PutOptions): number;  // frame sequence
  commit(): void;                                         // WAL flush + TOC update
  search(query: string, topK: number): SearchHit[];      // hybrid search
  timeline(limit?: number): TimelineEntry[];              // chronological scan
  stats(): Stats;                                         // frame count, sizes
  hash(): string;                                         // BLAKE3 of current state
  getFrame(frameId: number): Frame | null;                // retrieve by ID
}
```

### Checkpoint Protocol (Atomic)

```
1. WAL flush + commit (Memvid native)
2. Acquire write lock on .mv2
3. BLAKE3 hash (deterministic, from committed state)
4. Upload frozen .mv2 → Arweave (kind:5094 DVM)
5. Release write lock
6. Buffer any interactions during lock, ingest after
```

Arweave upload and Mina proof submission happen asynchronously after the hash is computed atomically.

---

## Nostr Event Schema

### Kind 14919: Interaction Event (Extended)

```json
{
  "kind": 14919,
  "pubkey": "<DVM or owner pubkey>",
  "tags": [
    ["blobbi_id", "blobbi-abc123"],
    ["action", "feed"],
    ["item", "sushi"],
    ["cost", "100"],
    ["cycle", "47"],
    ["brain_hash", "<blake3 hex>"],
    ["proof", "<base64 ZK proof>"],
    ["mina_tx", "<mina transaction hash>"],
    ["b", "blobbi:ecosystem:v1"],
    ["t", "blobbi"]
  ],
  "content": ""
}
```

**New tags vs original Blobbi spec:**
- `cost` — PET tokens consumed (on-chain verifiable)
- `brain_hash` — BLAKE3 of .mv2 after this interaction
- `proof` — Base64 ZK proof (optional, added async after batch proving)
- `mina_tx` — Mina transaction hash (optional, added after on-chain settlement)

Events without `proof`/`mina_tx` tags are optimistic. Events with them are fully proven.

### Kind 31124: Current State (Unchanged)

The replaceable state event remains as-is from the Blobbi spec. The on-chain Mina state is the source of truth; Kind 31124 is the Nostr-native view for clients that don't verify proofs.

---

## DVM Interaction Flow

### Full Sequence (DVM-Hosted Mode)

```
1. OWNER → TOON RELAY:
   Kind 5XXX DVM request
   Tags: [blobbi_id, action, item]
   Payment: ILP Prepare (0.1 USDC on EVM)

2. DVM receives request + ILP payment
   a. Read current .mv2 state
   b. Calculate decay (elapsed × stage rates)
   c. Apply action (feed sushi → hunger +30, happiness +5)
   d. Ingest interaction into .mv2
   e. Commit .mv2 (WAL flush)
   f. Read new BLAKE3 hash

3. DVM publishes optimistic event
   Kind 14919 (no proof tag yet)
   Returns new state to owner immediately

4. DVM generates ZK proof (async, batched)
   PetLifecycle.interact(newState, priorProof, action, decayedStats)

5. DVM submits to Mina
   PetZkApp.applyProof(proof, tokenPayment)
   DVM pays 100 PET tokens from its Mina wallet

6. DVM publishes proven event
   Updated Kind 14919 WITH proof + mina_tx tags

7. ILP Fulfill returned to owner
   Settlement: 0.1 USDC → DVM's EVM address

8. PERIODIC (every ~10 interactions):
   DVM checkpoints .mv2 → Arweave (kind:5094)
```

---

## Verification by Third Parties

Anyone can verify a pet's entire biography:

```
1. Read Mina on-chain state:
   - petId, brainHash, lifecycleHash, cycle, stage, totalSpent

2. Fetch .mv2 from Arweave (by latest checkpoint TX ID)

3. Verify BLAKE3(.mv2 deterministic segments) == on-chain brainHash

4. For each Kind 14919 event on Nostr relays:
   a. Verify event signature (owner or DVM signed)
   b. If proof tag present: verify ZK proof
   c. Check temporal consistency (timestamps advance)

5. Verify totalSpent on-chain matches sum of all interaction costs

6. Confidence assessment:
   - All proofs valid + timestamps consistent + totalSpent matches = HIGH
   - Missing proofs but ILP receipts present = MEDIUM
   - No proofs, no receipts = LOW (unverifiable)
```

---

## Competitive Analysis

| Feature | Tamagotchi | Axie Infinity | Blobbi (current) | **TOON Pet** |
|---------|-----------|---------------|-------------------|-------------|
| Game rules | Firmware | Server-side | Client-side JS | ZK circuit (math) |
| Payment | One-time | Single token/chain | Free | Any token, any chain |
| Memory | None | None | Flat events | Semantic, searchable |
| Provenance | N/A | On-chain (opaque) | Event signatures | ZK-verifiable biography |
| Anti-cheat | Hardware | Server authority | Honor system | Circuit + token cost |
| Portability | Physical device | Chain-locked | Relay-dependent | Arweave + Mina (permanent) |
| Operator lock-in | Manufacturer | Platform | Relay | None (transferable) |
| Pet value floor | Sentimental | Market speculation | None | Provable: totalSpent |

---

## Implementation Order

### Phase 1: Foundation
1. **napi-rs Memvid binding** — Expose create/open/put/commit/search/hash to Node.js
2. **PetLifecycle ZkProgram** — Encode game rules (stats, decay, actions, evolution) in o1js circuit
3. **PetZkApp SmartContract** — 8-field on-chain state with proof verification and token payment

### Phase 2: Integration
4. **PET token on Mina** — Custom token for pet economy (or use existing Mina token mechanism)
5. **Pet DVM handler** — Wraps Memvid brain + game engine + prover + Mina TX submission
6. **Chain DVM extension** — Support PetZkApp transactions for self-hosted mode

### Phase 3: Economy
7. **Cross-chain DVM pricing** — ILP-to-PET-token exchange rate oracle / market maker logic
8. **Arweave checkpoint automation** — Periodic .mv2 upload with configurable frequency
9. **Ditto integration** — Wire Pet DVM into existing Blobbi UI (Ditto already has TOON client)

### Phase 4: Advanced
10. **Breeding circuit** — ZK-proven offspring derivation from two parent states
11. **Personality emergence** — Memvid semantic queries drive trait development
12. **Pet marketplace** — On-chain pet trading with verified biography

---

## Mapping to Overmind Epics

| Overmind Epic | TOON Pet Relevance |
|---------------|-------------------|
| **15 (Heartbeat)** | Pet DVM IS a heartbeat service — periodic checkpoint + proof cycle |
| **16 (Treasury)** | PET token economy, DVM revenue model, ILP settlement |
| **17 (Sovereign)** | Self-hosted mode = sovereign pet. No DVM required. |
| **18 (Biography)** | PetLifecycle recursive proof IS the verifiable biography primitive |
| **19 (Swarms)** | Breeding = multi-agent coordination. Pet marketplace = swarm economy |

TOON Pets serve as the **proving ground** for the ZK-only verification path that Overmind will use. If a pet biography works without TEE, agent biographies can follow the same pattern (with TEE added only for sovereign runtime secrecy).

---

## Open Questions

1. **PET token economics** — Fixed cost per action? Or market-determined? Should the zkApp burn tokens or escrow them?
2. **Batch size for proofs** — How many interactions per Mina TX? Trade-off: fewer TXs (cheaper) vs faster on-chain settlement.
3. **Game balance governance** — New circuit = new game rules. Who decides when to update? On-chain governance vote?
4. **Breeding genetics in-circuit** — How much of the offspring derivation can fit in a Mina circuit? May need Merkle tree for trait lookup.
5. **Existing Blobbi migration** — How do current Blobbi pets (no proofs, no tokens) onboard? Grace period? Snapshot-and-mint?
6. **napi-rs build pipeline** — Does TOON's CI/CD support platform-specific native addons? Or should we ship prebuilt binaries?

---

## Key Resources

| Resource | Location |
|----------|----------|
| Memvid + TOON integration handoff | `_bmad-output/planning-artifacts/memvid-toon-integration-handoff.md` |
| Memvid source | `/Users/jonathangreen/Documents/memvid/` |
| nostr-pet (Blobbi) source | `/Users/jonathangreen/Documents/nostr-pet/` |
| Ditto (TOON-integrated Blobbi) | `/Users/jonathangreen/Documents/ditto/` |
| RecursiveLifecycle spike | `packages/overmind/spike/src/RecursiveLifecycle.ts` |
| OvermindRegistry spike | `packages/overmind/spike/src/OvermindRegistry.ts` |
| PaymentChannel zkApp | `packages/mina-zkapp/src/PaymentChannel.ts` |
| Mina zkApp docs | https://docs.minaprotocol.com/zkapps/writing-a-zkapp |
| TOON Arweave DVM | `packages/sdk/src/arweave/` |
| Ditto TOON client hook | `/Users/jonathangreen/Documents/ditto/src/hooks/useToon.ts` |
| Blobbi tag schema | `/Users/jonathangreen/Documents/ditto/docs/blobbi/blobbi-tag-schema.md` |
| Overmind PRD | `_bmad-output/overmind-prd.md` |
| Overmind epics | `_bmad-output/overmind-epics-and-stories.md` |

---

## Summary

TOON Pets compose four existing building blocks into something no competitor can replicate:

1. **Mina zkApp** — Game rules as math. Every stat change, every evolution, every breeding event is a proven computation. The circuit enforces token payment per interaction — the anti-pump mechanism.

2. **ILP + Connector** — Pay in any token on any chain. DVM operators bridge to Mina's pet token economy. Owners never need to touch Mina directly.

3. **Memvid (.mv2)** — Pet brain with semantic memory. Not fake stats — real searchable, queryable experience history with BLAKE3 integrity.

4. **Arweave + Nostr** — Permanent storage + decentralized discovery. Pet survives any single point of failure.

The architecture supports both self-hosted (sovereign, cheapest) and DVM-hosted (convenient, multi-device) modes producing identical on-chain state. The pet's value has a mathematical floor: `totalSpent` PET tokens, verified on Mina, provable to anyone.

Most building blocks already exist in production or spike form. The primary new work is: napi-rs Memvid binding, PetLifecycle ZkProgram circuit, PetZkApp SmartContract, and Pet DVM handler.
