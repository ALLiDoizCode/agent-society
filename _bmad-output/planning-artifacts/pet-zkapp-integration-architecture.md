# Pet zkApp Cross-System Integration Architecture

**Date:** 2026-04-06 (updated)
**Status:** Approved — integration reference for Pet DVM and client implementation
**Companion Docs:**
- [Game Rules Canonical Reference](pet-zkapp-game-rules-canonical.md)
- [BLAKE3-to-Field Hashing Spec](pet-zkapp-blake3-hashing-spec.md)
- [TOON Pet zkApp Architecture Handoff](toon-pet-zkapp-architecture-handoff.md)

---

## 1. System Map

Four codebases compose the TOON Pet system. This document specifies how data flows between them and what each enforces.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                     │
│                                                                             │
│  ┌──────────────────┐        ┌──────────────────────────────────────────┐  │
│  │  ditto            │        │  Self-Hosted Client (future)             │  │
│  │  (React SPA)      │        │  (Node.js CLI / desktop)                │  │
│  │                    │        │                                          │  │
│  │  useToon() hook    │        │  @toon-protocol/client                  │  │
│  │  useBlobbi*()      │        │  @toon-protocol/memvid-node (napi-rs)   │  │
│  │  useArweaveDvm()   │        │  o1js (local prover)                    │  │
│  └────────┬───────────┘        └──────────────┬───────────────────────────┘  │
│           │                                    │                             │
│           │  publishEvent()                    │  publishEvent()             │
│           │  (Kind 5XXX + ILP)                │  OR direct Mina TX          │
│           ▼                                    ▼                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                          PROTOCOL LAYER                                     │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  TOON Protocol                                                        │  │
│  │                                                                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │ ILP Router   │  │ Nostr Relay  │  │ DVM Market   │  │ Payment   │  │  │
│  │  │ (Connector)  │  │ (read/write) │  │ (kind 10035) │  │ Channels  │  │  │
│  │  └──────┬───────┘  └──────────────┘  └──────┬───────┘  └───────────┘  │  │
│  │         │                                    │                          │  │
│  └─────────┼────────────────────────────────────┼──────────────────────────┘  │
│            │  ILP PREPARE/FULFILL                │  Provider discovery        │
│            ▼                                     ▼                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                          PROVIDER LAYER                                     │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Pet DVM (ServiceNode)                                                │  │
│  │                                                                        │  │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Game      │  │ Memvid     │  │ o1js     │  │ Mina TX          │  │  │
│  │  │ Engine    │  │ PetBrain   │  │ Prover   │  │ Broadcaster      │  │  │
│  │  │ (rules)   │  │ (.mv2)     │  │ (async)  │  │ (Chain DVM)      │  │  │
│  │  └───────────┘  └────────────┘  └──────────┘  └──────────────────┘  │  │
│  │                                                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         SETTLEMENT LAYER                                    │
│                                                                             │
│  ┌────────────────┐  ┌───────────────┐  ┌──────────────────────────────┐  │
│  │ EVM (USDC)      │  │ Mina (PET)    │  │ Arweave (.mv2 checkpoints)  │  │
│  │ Payment channel │  │ PetZkApp      │  │ kind:5094 DVM upload        │  │
│  │ settlement      │  │ on-chain state│  │ permanent storage           │  │
│  └────────────────┘  └───────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Enforcement Boundaries

**What is enforced where — and what is trusted.**

| Rule | Where Enforced | Trust Model |
|------|---------------|-------------|
| Stat decay rates | **ZK Circuit** | Zero trust — math |
| Action effects (stat changes) | **ZK Circuit** | Zero trust — math |
| Stat bounds [1, 100] | **ZK Circuit** | Zero trust — math |
| Cooldown windows | **ZK Circuit** | Zero trust — math |
| Stage-specific action restrictions | **ZK Circuit** | Zero trust — math |
| Cycle increments by 1 | **ZK Circuit** | Zero trust — math |
| Timestamps advance | **ZK Circuit** | Zero trust — math |
| Token cost per action | **ZK Circuit** | Zero trust — math |
| totalSpent accumulation | **ZK Circuit** | Zero trust — math |
| Evolution stat thresholds | **ZK Circuit** | Zero trust — math |
| Evolution interaction count | **ZK Circuit** | Zero trust — math |
| brainHash changed per interaction | **ZK Circuit** | Zero trust — math |
| Stage only advances | **ZK Circuit** | Zero trust — math |
| Social tasks for evolution | **DVM attestation** | Trust DVM operator |
| .mv2 brain content integrity | **BLAKE3 + Arweave** | Verifiable by anyone |
| ILP payment routing | **Connector + channels** | Cryptographic (balance proofs) |
| PET token burn/escrow | **Mina on-chain** | Zero trust — consensus |
| Event signatures | **Nostr relay** | Schnorr signature verification |
| Nostr event format | **Client + relay** | Schema validation |
| Item prices (shop) | **ZK Circuit** | Hardcoded in circuit |
| DVM pricing / spread | **Market** | Competition between operators |
| Owner authorized interaction | **ZK Circuit** | Poseidon commitment signed with Mina key (~400 rows) |
| Interaction content matches proof | **ZK Circuit** | interactionHash committed to lifecycleHash chain |
| Batch timestamp within bounds | **ZK Circuit** | Slot-bounded: ±5min future, ±1hr past |

### Trust Gradient

```
ZERO TRUST                   VERIFIABLE              TRUST OPERATOR       TRUST CLIENT
─────────────────────────────────────────────────────────────────────────────────────────
ZK Circuit (game rules)      BLAKE3 + Arweave        Social task check    UI display
Mina on-chain state          ILP balance proofs      (hatch/evolve only)  Warning thresholds
Owner Mina-key signature     Schnorr signatures                           Mood computation
interactionHash chain        Nostr event replay
Slot-bounded timestamps
```

**Gaps closed by D8-D10 (2026-04-06):**
- ~~Timestamp manipulation~~ → Owner signs commitment with Mina key; slot-bounded batches
- ~~Brain content mismatch~~ → interactionHash committed to proof chain; auditable
- Social task attestation remains DVM-attested (evolution only, 2x per pet lifetime)

---

## 3. Data Flow: Pet Interaction (DVM-Hosted)

### 3.1 Happy Path

```
Step 1: OWNER → TOON RELAY
────────────────────────────
  Owner's ditto client calls:
    toon.publishEvent(petActionEvent, { destination: dvmIlpAddress })

  Event: Kind 5XXX (Pet Interaction Request)
  Tags: [blobbi_id, action, item]
  Payment: ILP PREPARE packet (USDC on EVM, lazy channel)

  SDK internally:
    1. TOON-encode event
    2. Compute ILP amount (base relay fee + DVM bid)
    3. Sign balance proof (ChannelManager.signBalanceProof)
    4. Send ILP PREPARE to connector
    5. Connector routes to DVM's ILP address

Step 2: DVM RECEIVES REQUEST
────────────────────────────
  ServiceNode.on(5XXX, petHandler) fires
  petHandler receives: { event, amount, source }

  DVM validates:
    a. Event signature valid (Schnorr)
    b. Payment >= required amount for action + item
    c. blobbi_id maps to a pet this DVM operates
    d. Action is allowed for current stage

Step 3: DVM PROCESSES INTERACTION
─────────────────────────────────
  Game engine:
    a. Read current PetState from local cache
    b. Compute elapsed time since lastInteraction
    c. Apply decay (ditto canonical rates × elapsed hours)
    d. Apply action effects (stat deltas from game rules doc)
    e. Clamp all stats to [1, 100]
    f. Increment cycle by 1

  Memvid brain:
    g. petBrain.putBytes(interactionEvent)  // ingest into .mv2
    h. petBrain.commit()                     // WAL flush + index rebuild
    i. brainHash = petBrain.hash()           // BLAKE3 of deterministic segments

Step 4: DVM PUBLISHES OPTIMISTIC EVENT
───────────────────────────────────────
  DVM signs and publishes:
    Kind 14919 (Interaction Event)
    Tags: [blobbi_id, action, item, cost, cycle, brain_hash]
    NO proof tag, NO mina_tx tag (optimistic)

  DVM returns new state to owner via Kind 6XXX result
  Owner gets instant UI feedback

Step 5: DVM GENERATES ZK PROOF (ASYNC, BATCHED)
────────────────────────────────────────────────
  Proof queue accumulates interactions (target batch: ~10)

  When batch ready:
    a. PetLifecycle.interact(priorProof, action, decayedStats)
    b. Chain N recursive steps
    c. Final proof covers all N interactions

  Proof generation: ~10-30 sec per recursive step
  Batch of 10: ~2-5 minutes total

Step 6: DVM SETTLES ON MINA
────────────────────────────
  a. PetZkApp.applyProof(batchProof, petTokenPayment)
  b. DVM pays PET tokens from its Mina wallet to zkApp
  c. On-chain state updated: brainHash, lifecycleHash, cycle, totalSpent
  d. Mina TX confirmed (1-2 blocks, ~3-6 minutes)

Step 7: DVM PUBLISHES PROVEN EVENT
───────────────────────────────────
  DVM updates Kind 14919 events with:
    proof tag: base64 ZK proof
    mina_tx tag: Mina transaction hash

Step 8: ILP FULFILL
────────────────────
  DVM returns ILP FULFILL to owner's connector
  Owner's payment channel balance updated
  Settlement: USDC transferred on EVM (cumulative balance proof)

Step 9: PERIODIC CHECKPOINT (~every 10 interactions)
─────────────────────────────────────────────────────
  a. petBrain.commit()
  b. Acquire write lock
  c. brainHash = petBrain.hash()
  d. Upload .mv2 → Arweave via kind:5094 DVM
  e. Release lock
  f. Buffer interactions during lock, ingest after
```

### 3.2 Self-Hosted Path

The self-hosted path is identical through Step 3 (game engine + Memvid), then diverges:

```
Step 4-self: OWNER PUBLISHES OPTIMISTIC EVENT
  Same Kind 14919, signed by owner instead of DVM

Step 5-self: OWNER GENERATES ZK PROOF (LOCAL)
  Local o1js prover (same PetLifecycle circuit)
  No batching needed if owner is patient

Step 6-self: OWNER SETTLES ON MINA
  Owner pays PET tokens directly to zkApp
  No DVM spread — cheapest option
  Uses Chain DVM for Mina TX broadcast (existing infrastructure)

Step 7-self: OWNER UPLOADS CHECKPOINT
  Owner uploads .mv2 to Arweave via kind:5094 DVM
  Pays Arweave storage cost directly
```

---

## 4. Package Dependency Map

### 4.1 Existing Packages (Production)

```
@toon-protocol/client       — ToonClient, ChannelManager, EvmSigner
@toon-protocol/sdk          — ServiceNode, createNode, DVM handlers, Arweave upload
@toon-protocol/core         — Event kinds, service discovery, encoding
@toon-protocol/relay        — TOON encoding/decoding
@toon-protocol/mina-zkapp   — PaymentChannel SmartContract (production)
```

### 4.2 New Packages (Required for Pets)

```
@toon-protocol/memvid-node  — napi-rs binding for Memvid (Rust → Node.js)
                              PetBrain class: create, open, put, commit, search, hash
                              Platform-specific prebuilt binaries

@toon-protocol/pet-circuit  — PetLifecycle ZkProgram + PetZkApp SmartContract
                              Game rules encoded as o1js circuit constraints
                              Exports: PetLifecycle, PetZkApp, PetStats, PetAction, PetState

@toon-protocol/pet-dvm      — Pet DVM handler for ServiceNode
                              Wraps: game engine + memvid-node + pet-circuit + Mina TX
                              Exports: createPetDvmHandler(config)
```

### 4.3 Dependency Graph

```
ditto (React SPA)
  └── @toon-protocol/client
        └── @toon-protocol/core

Pet DVM (ServiceNode)
  ├── @toon-protocol/sdk
  │     └── @toon-protocol/core
  ├── @toon-protocol/pet-dvm
  │     ├── @toon-protocol/memvid-node   (napi-rs)
  │     ├── @toon-protocol/pet-circuit   (o1js)
  │     └── @toon-protocol/sdk           (Arweave upload, Mina TX)
  └── @toon-protocol/mina-zkapp          (PaymentChannel, shared)

Self-Hosted Client
  ├── @toon-protocol/client
  ├── @toon-protocol/memvid-node
  ├── @toon-protocol/pet-circuit
  └── @toon-protocol/sdk                 (Arweave upload)
```

### 4.4 What Ditto Does NOT Need

Ditto (the web client) does **not** need:
- `@toon-protocol/memvid-node` — DVM manages the .mv2
- `@toon-protocol/pet-circuit` — DVM generates proofs
- `o1js` — no local proving

Ditto only needs:
- `@toon-protocol/client` (existing) — publish DVM requests + ILP payment
- Kind 14919 event parsing (tag reading, no proof verification)
- Kind 31124 state rendering (existing Blobbi UI)

---

## 5. napi-rs Binding Contract

### 5.1 API Surface

```typescript
// @toon-protocol/memvid-node

export class PetBrain {
  /**
   * Create a new .mv2 file at the given path.
   * @throws PetBrainError if path is not writable
   */
  static create(path: string): PetBrain;

  /**
   * Open an existing .mv2 file.
   * @throws PetBrainError if file doesn't exist or is corrupt
   */
  static open(path: string): PetBrain;

  /**
   * Ingest raw bytes as a new frame.
   * Returns the frame sequence number.
   * Appends to WAL immediately (crash-safe).
   */
  putBytes(data: Buffer, options?: PutOptions): number;

  /**
   * Flush WAL, rebuild indexes, write TOC, fsync.
   * After commit(), hash() reflects the new state.
   * @throws PetBrainError on I/O failure
   */
  commit(): void;

  /**
   * Hybrid search (lexical + semantic + temporal).
   * Returns ranked results.
   */
  search(query: string, topK: number): SearchHit[];

  /**
   * Chronological scan of frames.
   * @param limit Max entries to return (default: all)
   */
  timeline(limit?: number): TimelineEntry[];

  /**
   * Frame count, byte sizes, index status.
   */
  stats(): BrainStats;

  /**
   * BLAKE3 hash of deterministic segments.
   * Covers: frames, lex index, time index, temporal track, sketch track.
   * Excludes: vec index (HNSW), memories track, logic mesh.
   *
   * Returns 64-char hex string (256 bits).
   * Caller truncates to 253 bits for Mina Field.
   */
  hash(): string;

  /**
   * Retrieve a single frame by ID.
   */
  getFrame(frameId: number): Frame | null;

  /**
   * Close the .mv2 file and release resources.
   * PetBrain instance is unusable after close.
   */
  close(): void;
}

export interface PutOptions {
  title?: string;
  uri?: string;
  tags?: Record<string, string>;
}

export interface SearchHit {
  frameId: number;
  score: number;
  title?: string;
  snippet: string;
}

export interface TimelineEntry {
  frameId: number;
  timestamp: number;  // Unix seconds
  title?: string;
}

export interface BrainStats {
  frameCount: number;
  totalBytes: number;
  lexIndexed: boolean;
  vecIndexed: boolean;
  timeIndexed: boolean;
}

export interface Frame {
  id: number;
  uri: string;
  title?: string;
  createdAt: number;
  payload: Buffer;
  tags: Record<string, string>;
}

export class PetBrainError extends Error {
  code: 'IO_ERROR' | 'CORRUPT' | 'NOT_FOUND' | 'LOCKED' | 'WAL_REPLAY_FAILED';
}
```

### 5.2 Threading Model

- `putBytes()` and `commit()` acquire an exclusive write lock (Rust `RwLock`)
- `search()`, `timeline()`, `hash()`, `stats()` acquire shared read locks
- `hash()` after `commit()` is guaranteed to reflect the committed state
- Multiple readers can execute concurrently; writes are serialized
- napi-rs runs Rust on the libuv thread pool — no main-thread blocking

### 5.3 Memory Lifecycle

- `PetBrain` instances hold a Rust `Arc<Mv2Store>` via napi-rs prevent GC
- `close()` drops the Rust reference; subsequent calls throw `PetBrainError('NOT_FOUND')`
- If `close()` is not called, the destructor runs on GC (non-deterministic timing)
- **Recommendation:** Always call `close()` explicitly in DVM shutdown handlers

### 5.4 Error Semantics

| Error Code | Trigger | Recovery |
|------------|---------|----------|
| `IO_ERROR` | Disk write failure, permission denied | Retry or alert operator |
| `CORRUPT` | .mv2 header invalid, TOC checksum mismatch | Restore from Arweave checkpoint |
| `NOT_FOUND` | Path doesn't exist or brain already closed | Re-open or re-create |
| `LOCKED` | Another process holds exclusive lock | Wait and retry (DVM shouldn't fork) |
| `WAL_REPLAY_FAILED` | WAL entries fail integrity check on open | Restore from Arweave checkpoint |

---

## 6. DVM Handler Integration

### 6.1 Handler Registration

```typescript
// In Pet DVM startup
import { createNode } from '@toon-protocol/sdk';
import { createPetDvmHandler } from '@toon-protocol/pet-dvm';

const petHandler = createPetDvmHandler({
  brainStoragePath: './pet-brains/',       // Directory for .mv2 files
  minaGraphqlUrl: 'https://...',           // Mina node
  petTokenAddress: '...',                  // PET token contract on Mina
  arweaveCheckpointInterval: 10,           // Checkpoint every N interactions
  proofBatchSize: 10,                      // Batch N interactions per proof
  petZkAppAddress: '...',                  // Deployed PetZkApp address
});

const node = await createNode({
  secretKey: identity.secretKey,
  handlers: {
    [PET_INTERACTION_KIND]: petHandler,    // Kind 5XXX for pet interactions
  },
  basePricePerByte: 10n,
  kindPricing: {
    [PET_INTERACTION_KIND]: 5000n,         // Base price per pet interaction (USDC micro-units)
  },
});

await node.start();
```

### 6.2 Handler Internal Flow

```typescript
// Simplified pseudocode for createPetDvmHandler

async function handlePetInteraction(event, amount, context) {
  const { blobbiId, action, item } = parsePetRequest(event);

  // 1. Load pet brain
  const brain = PetBrain.open(`./pet-brains/${blobbiId}.mv2`);

  // 2. Load current state (from local cache or on-chain)
  const currentState = await loadPetState(blobbiId);

  // 3. Validate action allowed
  assertActionAllowed(action, currentState.stage);
  assertCooldownElapsed(action, currentState);

  // 4. Apply decay
  const elapsed = event.created_at - currentState.lastInteraction;
  const decayedStats = applyDecay(currentState.stats, currentState.stage, elapsed);

  // 5. Apply action effects
  const newStats = applyAction(decayedStats, action, item, currentState.stage);

  // 6. Update brain
  brain.putBytes(Buffer.from(JSON.stringify(event)));
  brain.commit();
  const brainHash = brain.hash();

  // 7. Update local state
  const newState = {
    ...currentState,
    stats: newStats,
    cycle: currentState.cycle + 1,
    lastInteraction: event.created_at,
    brainHash,
  };
  savePetState(blobbiId, newState);

  // 8. Publish optimistic Kind 14919
  await context.node.publishFeedback(event.id, event.pubkey, 'success',
    JSON.stringify(newState));

  // 9. Queue for proof batch
  proofQueue.push({ blobbiId, newState, priorState: currentState, action, item });

  // 10. Check checkpoint interval
  if (newState.cycle % checkpointInterval === 0) {
    await checkpointToArweave(brain, blobbiId);
  }

  brain.close();

  return { accept: true, data: Buffer.from(JSON.stringify(newState)) };
}
```

---

## 7. Event Kind Registry

### 7.1 Existing Kinds (No Changes)

| Kind | Name | Publisher | Consumer |
|------|------|----------|----------|
| 31124 | Blobbi State | ditto client | ditto UI, any Nostr client |
| 14919 | Pet Interaction | DVM or owner | Verification, history |
| 14920 | Pet Breeding | DVM | Breeding verification |
| 14921 | Pet Records | DVM or owner | Permanent history |
| 31125 | Owner Profile | ditto client | ditto UI |
| 10032 | Peer Discovery | TOON peers | ToonClient bootstrap |
| 10035 | Service Discovery | DVM providers | Client provider selection |

### 7.2 New Kinds (Pet DVM)

| Kind | Name | Publisher | Consumer | Payment? |
|------|------|----------|----------|----------|
| **5XXX** | Pet Interaction Request | Owner (ditto) | Pet DVM | Yes (ILP) |
| **6XXX** | Pet Interaction Result | Pet DVM | Owner (ditto) | — |
| **7000** | DVM Feedback | Pet DVM | Owner (ditto) | — |

**Note:** Exact kind numbers TBD — should be registered in the DVM kind range (5000-5999 for requests, 6000-6999 for results).

### 7.3 Extended Kind 14919 Tags

Per the architecture handoff, Kind 14919 gains these tags when published by the Pet DVM:

| Tag | Value | When Added |
|-----|-------|-----------|
| `cost` | PET tokens consumed | Always (on publish) |
| `brain_hash` | BLAKE3 hex of .mv2 | Always (on publish) |
| `proof` | Base64 ZK proof | After batch proof generated |
| `mina_tx` | Mina transaction hash | After on-chain settlement |

Events with `proof` + `mina_tx` = **fully proven**. Without = **optimistic**.

---

## 8. Payment Flow Details

### 8.1 Three-Layer Payment

```
LAYER 1: Owner → DVM (ILP, any token)
──────────────────────────────────────
  Token: USDC on EVM (or any ILP-routable asset)
  Mechanism: Payment channel (lazy open, cumulative balance proofs)
  Amount: DVM's listed price per interaction (from kind:10035)
  Settlement: On-chain EVM when channel closes

LAYER 2: DVM → PetZkApp (Mina, PET tokens)
────────────────────────────────────────────
  Token: PET (custom Mina token)
  Mechanism: Direct on-chain TX as part of proof submission
  Amount: Circuit-enforced cost per action × batch size
  Settlement: Immediate (Mina TX confirmation)

LAYER 3: DVM → Arweave (USDC via kind:5094)
─────────────────────────────────────────────
  Token: USDC (ILP payment to Arweave DVM provider)
  Mechanism: Existing kind:5094 blob upload flow
  Amount: Size-based (pricePerByte × .mv2 file size)
  Frequency: Every N interactions (checkpoint interval)
```

### 8.2 DVM Economics

```
DVM Revenue = Σ(owner ILP payments per interaction)
DVM Costs   = PET tokens on Mina + Mina gas + Arweave storage + compute

DVM Profit  = Revenue - Costs
            = (ILP price × interactions) - (PET cost × interactions)
              - (Mina gas × batches) - (Arweave cost × checkpoints)
              - (compute: proof generation, Memvid ops)

DVM sets its own ILP price via kind:10035 service discovery.
Competition between DVMs drives price toward marginal cost.
```

### 8.3 Ditto Integration (Minimal Changes)

Ditto already has the infrastructure for Pet DVM payments:

```typescript
// Existing in ditto — useToon.ts
const result = await toon.publishEvent(petActionEvent, {
  destination: dvmIlpAddress,  // Pet DVM's ILP address
});

// Existing in ditto — useArweaveDvm.ts (same pattern)
// DVM discovery via kind:10035 — same mechanism
// Provider selection by price — same UI
```

**What ditto needs to add:**
1. Pet DVM discovery (filter kind:10035 for pet service capability)
2. Kind 5XXX event builder (action + item + blobbi_id tags)
3. Kind 6XXX result parser (new pet state from DVM)
4. Kind 14919 renderer (show proof status: optimistic vs proven)

**What ditto does NOT need to change:**
- `useToon()` — works as-is for ILP publishing
- `useNostrPublish()` — routing logic unchanged
- Payment channel management — lazy opening, cumulative proofs, all existing
- TOON relay adapter — read path unchanged

---

## 9. Migration Protocol

### 9.1 Existing Blobbi → TOON Pet

For pets that exist today in ditto (no proofs, no tokens):

```
1. SNAPSHOT: Read current Kind 31124 state from relay
2. GENESIS:  Create PetLifecycle genesis proof from snapshot values
             (stats, stage, cycle = current interaction count)
3. MINT:     Deploy PetZkApp instance on Mina with genesis state
             Owner pays: Mina account creation fee + initial PET tokens
4. BRAIN:    Create new .mv2 from historical Kind 14919 events
             Replay all interactions into Memvid chronologically
5. HASH:     Compute brainHash, store on-chain
6. UPLOAD:   Checkpoint .mv2 to Arweave
7. REGISTER: Transfer operation to Pet DVM (or self-host)
             PetZkApp.transferOperator(dvmPubkey)
8. RESUME:   DVM resumes from proven state. Future interactions are ZK-proven.
```

**Grace period:** Existing pets can continue operating in "legacy mode" (no proofs) indefinitely. Migration is optional but unlocks proof-of-care and the PET token economy.

### 9.2 DVM → DVM Migration

```
1. Owner calls PetZkApp.transferOperator(newDvmPubkey)
2. New DVM fetches latest .mv2 from Arweave
3. New DVM computes brainHash, verifies == on-chain
4. New DVM resumes operations
5. Old DVM stops accepting requests for this pet
```

No downtime. No data loss. No lock-in.

---

## 10. Sequence Diagrams

### 10.1 First Interaction (New Pet, DVM-Hosted)

```
Owner              ditto             ToonClient          ILP Router       Pet DVM           Mina          Arweave
  │                  │                   │                    │               │                │              │
  │ "feed sushi"     │                   │                    │               │                │              │
  │─────────────────>│                   │                    │               │                │              │
  │                  │ build Kind 5XXX   │                    │               │                │              │
  │                  │──────────────────>│                    │               │                │              │
  │                  │                   │ ILP PREPARE        │               │                │              │
  │                  │                   │───────────────────>│               │                │              │
  │                  │                   │                    │ route to DVM  │                │              │
  │                  │                   │                    │──────────────>│                │              │
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │               │─── apply decay │              │
  │                  │                   │                    │               │─── apply action│              │
  │                  │                   │                    │               │─── update .mv2 │              │
  │                  │                   │                    │               │─── compute hash│              │
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │               │── Kind 14919 ─────> relay     │
  │                  │                   │                    │               │   (optimistic)  │              │
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │  ILP FULFILL  │                │              │
  │                  │                   │                    │<──────────────│                │              │
  │                  │                   │  ILP FULFILL       │               │                │              │
  │                  │                   │<───────────────────│               │                │              │
  │                  │  new state        │                    │               │                │              │
  │                  │<──────────────────│                    │               │                │              │
  │  UI updates      │                   │                    │               │                │              │
  │<─────────────────│                   │                    │               │                │              │
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │               │── async proof ─>│              │
  │                  │                   │                    │               │                │── verify ──> │
  │                  │                   │                    │               │<── confirmed ──│              │
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │               │── Kind 14919 (proven) ─> relay│
  │                  │                   │                    │               │                │              │
  │                  │                   │                    │               │── checkpoint ──────────────> │
  │                  │                   │                    │               │                │    (.mv2)    │
```

---

## 11. ILP Round-Trip Design (Pet DVM vs Arweave DVM)

The Pet DVM follows the **same single-round-trip ILP pattern** as the Arweave DVM. No new ILP protocols are needed.

### 11.1 Pattern Comparison

| | Arweave DVM | Pet DVM |
|---|---|---|
| Request kind | 5094 (blob + bid) | 5XXX (action + blobbi_id + item) |
| Sync work in handler | Upload to Arweave (~1-5s) | Apply game rules + update .mv2 (~50ms) |
| FULFILL `data` field | Arweave TX ID (string) | New pet state JSON (stats + cycle + brainHash) |
| Side effects in handler | None | Publish Kind 14919 to relay (fire-and-forget) |
| Async work after FULFILL | None | Proof generation, Mina TX, Arweave checkpoint |

### 11.2 Handler Response Contract

```typescript
// Arweave DVM (existing):
return { accept: true, data: Buffer.from(arweaveTxId).toString('base64') };

// Pet DVM (new, same shape):
return { accept: true, data: Buffer.from(JSON.stringify(newPetState)).toString('base64') };
```

The client receives the FULFILL with `result.data` containing the new state. All async work (proofs, Mina settlement, Arweave checkpoints) happens **after** the FULFILL is returned — the client never waits for it.

### 11.3 Client Consumption (Identical Pattern)

```typescript
// Arweave (existing in ditto):
const result = await toon.publishEvent(uploadEvent, { destination: dvmAddress });
const txId = result.data;  // Arweave TX ID

// Pet (new, same pattern):
const result = await toon.publishEvent(petActionEvent, { destination: dvmAddress });
const newState = JSON.parse(Buffer.from(result.data!, 'base64').toString());
// newState = { stats: { hunger, happiness, ... }, cycle, stage, brainHash }
```

### 11.4 Async Work Pipeline (Invisible to Client)

After the FULFILL is returned, the Pet DVM processes a background queue:

```
FULFILL returned to client (instant)
         │
         ▼
┌─────────────────────────────┐
│ Proof Queue (in-memory)     │
│                             │
│ Accumulate interactions     │
│ until batch size reached    │
│ (default: 10 interactions)  │
└────────────┬────────────────┘
             │ batch ready
             ▼
┌─────────────────────────────┐
│ PetLifecycle Prover         │
│                             │
│ Chain N recursive steps     │
│ (~10-30s per step)          │
│ Output: single batch proof  │
└────────────┬────────────────┘
             │ proof ready
             ▼
┌─────────────────────────────┐
│ Mina TX Broadcaster         │
│                             │
│ PetZkApp.applyProof(proof)  │
│ Pay PET tokens from DVM     │
│ wallet to zkApp             │
│ Wait for confirmation       │
└────────────┬────────────────┘
             │ confirmed
             ▼
┌─────────────────────────────┐
│ Event Updater               │
│                             │
│ Update Kind 14919 events    │
│ with proof + mina_tx tags   │
│ (optimistic → proven)       │
└────────────┬────────────────┘
             │ every N interactions
             ▼
┌─────────────────────────────┐
│ Arweave Checkpointer        │
│                             │
│ Upload .mv2 via kind:5094   │
│ Atomic: commit → lock →     │
│ hash → upload → release     │
└─────────────────────────────┘
```

---

## 12. Local Mina Infrastructure (Real, Not Mocked)

**Decision:** All Pet DVM development and testing uses the **real Mina Lightnet** already in the Docker Compose stack. No `LocalBlockchain` mocks in E2E tests.

### 12.1 Existing Infrastructure

The `docker-compose-sdk-e2e.yml` already runs a full Mina local network:

| Service | Image | Host Port | Container Port | Purpose |
|---------|-------|-----------|----------------|---------|
| mina-lightnet | `o1labs/mina-local-network:compatible-latest-lightnet` | **19085** | 3101 | GraphQL endpoint (daemon) |
| mina-lightnet | (same) | **19181** | 8181 | Accounts manager (pre-funded wallets) |

**Configuration:**
- `PROOF_LEVEL=none` — skip proof verification for speed (unit tests handle constraint checking)
- `SLOT_TIME=20000` — 20-second slots
- Single-node network
- Memory limit: 4GB
- Healthcheck waits for `SYNCED` status

**Docker image already cached:** `o1labs/mina-local-network:compatible-latest-lightnet` (2.7GB)

### 12.2 PetZkApp Deployment (New)

Add `scripts/deploy-pet-zkapp.ts` mirroring `scripts/deploy-mina-zkapp.ts`:

```typescript
// Same pattern as existing deploy-mina-zkapp.ts:
// 1. Connect to Mina GraphQL (MINA_GRAPHQL_URL || http://localhost:19085/graphql)
// 2. Acquire funded account from accounts manager (MINA_ACCOUNTS_URL || http://localhost:19181)
// 3. Compile PetZkApp + PetLifecycle ZkProgram
// 4. Generate fresh keypair for zkApp
// 5. Deploy to lightnet with AccountUpdate.fundNewAccount
// 6. Output PET_ZKAPP_ADDRESS to stdout

// Environment:
//   MINA_GRAPHQL_URL (default: http://localhost:19085/graphql)
//   MINA_ACCOUNTS_URL (default: http://localhost:19181)
```

**Compile time note:** PetLifecycle ZkProgram compilation takes ~2-5 minutes (circuit analysis). The deploy script should cache the verification key to avoid recompilation on every `sdk-e2e-infra.sh up`.

### 12.3 Infrastructure Script Update

`scripts/sdk-e2e-infra.sh` gains a new deployment step:

```bash
# After existing PaymentChannel deployment:
echo "[infra] Deploying PetZkApp to Mina lightnet..."
PET_ZKAPP_ADDRESS=$(npx tsx scripts/deploy-pet-zkapp.ts)
export PET_ZKAPP_ADDRESS
echo "[infra] PetZkApp deployed at: $PET_ZKAPP_ADDRESS"
```

### 12.4 Peer Environment Variables (New)

Added to `docker-compose-sdk-e2e.yml` for peers with Pet DVM enabled:

```yaml
# Peer1 (Pet DVM enabled):
PET_ENABLED: 'true'
PET_ZKAPP_ADDRESS: ${PET_ZKAPP_ADDRESS}
MINA_GRAPHQL_URL: http://mina-lightnet:3101/graphql
MINA_ACCOUNTS_MANAGER_URL: http://mina-lightnet:8181
```

These env vars are already available to peers for PaymentChannel settlement. Pet DVM reuses the same Mina connection.

### 12.5 Test Tiers (No Mocks)

| Tier | Backend | Where | What It Tests | Speed |
|------|---------|-------|---------------|-------|
| **Unit** | `Mina.LocalBlockchain({ proofsEnabled: false })` | `packages/mina-zkapp/` | Circuit constraint logic, state transitions | Seconds |
| **E2E** | **Real Lightnet** (Docker) | `packages/sdk/tests/e2e/` | Full lifecycle: deploy → interact → prove → settle → verify | Minutes |

**Unit tests** use `LocalBlockchain` — this is o1js's in-process chain simulator. It runs the same constraint system and verification logic as the real network, just without network overhead. This is appropriate for testing that circuit rules are correct.

**E2E tests** hit the real Lightnet daemon at `http://localhost:19085/graphql`. This is where we verify:
- PetZkApp deploys correctly on a real network
- Proofs verify on-chain with real transaction lifecycle
- State updates persist across blocks
- Multiple batched interactions settle correctly
- The full Pet DVM → Mina → Arweave pipeline works end-to-end

---

## 13. Peer DVM Enablement Pattern

The Pet DVM follows the **exact same enablement pattern** as the Arweave DVM. A peer opts in via environment variable.

### 13.1 Configuration (docker/src/shared.ts)

```typescript
// Existing:
const ardriveEnabled = env['ARDRIVE_ENABLED'] !== 'false';

// New (same pattern):
const petEnabled = env['PET_ENABLED'] !== 'false';
const petZkAppAddress = env['PET_ZKAPP_ADDRESS'] ?? '';
const petBrainStoragePath = env['PET_BRAIN_STORAGE_PATH'] ?? path.join(dataDir, 'pet-brains');
```

### 13.2 Handler Registration (docker/src/entrypoint-sdk.ts)

```typescript
// Existing Arweave pattern (lines 313-323):
if (config.ardriveEnabled) {
  const chunkManager = new ChunkManager();
  const turboAdapter = new TurboUploadAdapter();
  const arweaveHandler = createArweaveDvmHandler({ turboAdapter, chunkManager });
  node.on(5094, arweaveHandler);
  console.log('[Setup] Arweave DVM handler registered for kind:5094');
}

// New Pet DVM (same pattern):
if (config.petEnabled) {
  const petHandler = createPetDvmHandler({
    brainStoragePath: config.petBrainStoragePath,
    minaGraphqlUrl: config.minaGraphqlUrl,
    minaAccountsUrl: config.minaAccountsManagerUrl,
    petZkAppAddress: config.petZkAppAddress,
    proofBatchSize: 10,
    arweaveCheckpointInterval: 10,
  });
  node.on(PET_INTERACTION_KIND, petHandler);
  console.log('[Setup] Pet DVM handler registered for kind:' + PET_INTERACTION_KIND);
}
```

### 13.3 Service Discovery (docker/src/entrypoint-sdk.ts)

```typescript
// Existing Arweave pattern (lines 525-572):
if (config.ardriveEnabled) {
  supportedKinds.push(BLOB_STORAGE_REQUEST_KIND);
  capabilities.push('dvm', 'arweave-storage');
}

// New Pet DVM (same pattern):
if (config.petEnabled) {
  supportedKinds.push(PET_INTERACTION_KIND);
  capabilities.push('dvm', 'pet-dvm');

  // Add skill descriptor for Pet DVM discovery
  serviceDiscoveryContent.petSkill = {
    name: 'pet-dvm',
    version: '1.0',
    kinds: [PET_INTERACTION_KIND],
    features: ['pet-interaction', 'zk-proof', 'memvid-brain'],
    pricing: {
      [String(PET_INTERACTION_KIND)]: String(config.basePricePerByte),
    },
  };
}
```

### 13.4 Docker Compose (docker-compose-sdk-e2e.yml)

```yaml
peer1:
  environment:
    # ... existing config ...
    ARDRIVE_ENABLED: 'true'          # Existing
    PET_ENABLED: 'true'              # New — enables Pet DVM on this peer
    PET_ZKAPP_ADDRESS: ${PET_ZKAPP_ADDRESS}  # Set by sdk-e2e-infra.sh
```

### 13.5 E2E Test (New)

`packages/sdk/tests/e2e/docker-pet-dvm-e2e.test.ts` — mirrors `docker-arweave-dvm-e2e.test.ts`:

```typescript
describe.skipIf(SKIP_E2E)('Pet DVM E2E', () => {
  let node: ServiceNode;

  beforeAll(async () => {
    node = await createNode({
      secretKey: nostrSecretKey,
      chain: 'anvil',
      btpServerPort: 19905,
      settlementPrivateKey: TEST_PRIVATE_KEY,
      basePricePerByte: 10n,
      knownPeers: [{ pubkey: PEER1_PUBKEY, relayUrl: PEER1_RELAY_URL, btpEndpoint: PEER1_BTP_URL }],
    });
    node.onDefault(async (ctx) => { ctx.decode(); return ctx.accept(); });
    await node.start();
    await new Promise((r) => setTimeout(r, 3000));
  });

  it('should process pet interaction and return new state', async () => {
    const petAction = buildPetInteractionEvent({
      blobbiId: 'blobbi-test123-pet001',
      action: 'feed',
      item: 'food_sushi',
      secretKey: nostrSecretKey,
    });

    const result = await node.publishEvent(petAction, {
      destination: 'g.toon.peer1',
    });

    expect(result.success).toBe(true);
    const newState = JSON.parse(Buffer.from(result.data!, 'base64').toString());
    expect(newState.cycle).toBe(1);
    expect(newState.stats.hunger).toBeGreaterThan(0);
    expect(newState.brainHash).toBeDefined();
    expect(newState.brainHash).toHaveLength(64);  // 256-bit hex
  });

  it('should publish Kind 14919 to relay', async () => {
    // Verify the DVM published the optimistic interaction event
    const events = await fetchFromRelay({
      kinds: [14919],
      '#blobbi_id': ['blobbi-test123-pet001'],
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].tags.find(t => t[0] === 'action')?.[1]).toBe('feed');
    expect(events[0].tags.find(t => t[0] === 'brain_hash')).toBeDefined();
  });

  it('should settle proof on real Mina lightnet', async () => {
    // After proof batch completes, verify on-chain state
    // Poll Mina GraphQL for PetZkApp state update
    const onChainState = await queryPetZkAppState(PET_ZKAPP_ADDRESS);
    expect(onChainState.cycle).toBeGreaterThan(0);
    expect(onChainState.brainHash).toBeDefined();
  });

  afterAll(async () => {
    await node.stop();
  });
});
```

---

## 14. Pet Dungeon Crawl Extension (Party Mode 2026-04-08)

### 14.1 Extended System Map

The dungeon crawl adds a second DVM handler alongside the Pet DVM. Both run on the same ServiceNode.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROVIDER LAYER (Extended)                          │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Pet DVM (ServiceNode) — EXISTING                                     │  │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Game      │  │ Memvid     │  │ o1js     │  │ Mina TX          │  │  │
│  │  │ Engine    │  │ PetBrain   │  │ Prover   │  │ Broadcaster      │  │  │
│  │  └───────────┘  └────────────┘  └──────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Dungeon DVM (same ServiceNode) — NEW                                 │  │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ rot.js    │  │ Encounter  │  │ Loot     │  │ Adventure Log    │  │  │
│  │  │ Dungeon   │  │ Resolution │  │ Tables   │  │ Generator        │  │  │
│  │  │ Generator │  │ Engine     │  │ (gacha)  │  │ (narrative)      │  │  │
│  │  └─────┬─────┘  └─────┬──────┘  └────┬─────┘  └────────┬─────────┘  │  │
│  │        │               │              │                  │            │  │
│  │        └───────┬───────┘──────────────┘                  │            │  │
│  │                ▼                                         ▼            │  │
│  │  ┌──────────────────────┐              ┌──────────────────────────┐  │  │
│  │  │ Pet-Dungeon Bridge   │              │ Arweave kind:5094        │  │  │
│  │  │ (pet stats → modifs) │              │ (permanent adventure log)│  │  │
│  │  └──────────┬───────────┘              └──────────────────────────┘  │  │
│  │             │                                                        │  │
│  │             ▼                                                        │  │
│  │  ┌──────────────────────┐                                           │  │
│  │  │ PetDvmHandler        │ ◄── stat deltas feed back as interaction  │  │
│  │  │ (ZK-proven update)   │                                           │  │
│  │  └──────────────────────┘                                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 14.2 Dungeon Enforcement Boundaries

| Rule | Where Enforced | Trust Model |
|------|---------------|-------------|
| Dungeon layout generation | **rot.js seedable RNG** | Deterministic replay (same seed = same dungeon) |
| Encounter resolution | **DungeonGameEngine** | Deterministic pure functions (auditable) |
| Loot table rolls | **Seedable RNG** | Deterministic (seed committed to result) |
| Pet stat changes from dungeon | **ZK Circuit** (via PetDvmHandler) | Zero trust — math |
| Adventure log integrity | **Arweave + BLAKE3** | Verifiable by anyone |
| Dungeon entry payment | **ILP + Connector** | Cryptographic (balance proofs) |
| Dungeon provider pricing | **Market** | Competition between operators |

### 14.3 Dungeon Data Flow (Idle Dungeon MVP)

```
Step 1: OWNER → TOON RELAY
────────────────────────────
  Owner sends ONE kind:5250 request:
    { petStateHash, dungeonId, seed }
  Payment: ILP PREPARE (USDC, covers dungeon entry fee)

Step 2: DUNGEON DVM PROCESSES
──────────────────────────────
  a. rot.js generates dungeon from seed (deterministic, ~5ms)
  b. Load pet stats from petStateHash commitment
  c. Pet-Dungeon Bridge: map pet stats → dungeon modifiers
     - discipline → combat effectiveness
     - energy → exploration range (max rooms)
     - happiness → luck (loot quality multiplier)
     - hunger → survival threshold (death check)
  d. Simulate room-by-room crawl:
     - For each room: encounter check → resolve → loot roll → survive check
     - Pet stats determine outcomes at every step
  e. Generate narrative adventure log from encounter data
  f. Compute stat deltas: energy spent, happiness gained/lost, etc.

Step 3: DUNGEON DVM RETURNS RESULT
───────────────────────────────────
  ILP FULFILL with kind:6250 result:
    {
      roomsCleared, encountersWon, encountersFled, petDied,
      loot: [{ id, name, rarity }],
      statDeltas: { hunger: -20, energy: -40, happiness: +10 },
      narrativeLog: "Blobbi entered the Kobold Caves...",
      dungeonSeed, dungeonLayoutHash
    }

Step 4: STAT DELTAS → PET DVM (Composition)
────────────────────────────────────────────
  Dungeon DVM calls PetDvmHandler with stat deltas as "dungeon-effect" action.
  PetGameEngine applies deltas. ZK circuit proves the state transition.
  Pet stat changes from dungeon are fully ZK-proven.

Step 5: ADVENTURE LOG → ARWEAVE (Async)
─────────────────────────────────────────
  Narrative log uploaded via kind:5094 DVM.
  Permanent, provable adventure record.
  Pet builds a biography of adventures over time.
```

### 14.4 Dungeon Event Kinds

| Kind | Name | Publisher | Consumer | Payment? |
|------|------|----------|----------|----------|
| **5250** | Dungeon Run Request | Owner (ditto) | Dungeon DVM | Yes (ILP) |
| **6250** | Dungeon Run Result | Dungeon DVM | Owner (ditto) | — |

**Note:** Dungeon uses the Compute primitive kinds (5250/6250) since it IS a compute DVM. The dungeon-specific semantics are in the event tags, not the kind number.

### 14.5 Dungeon SkillDescriptor (kind:10035)

```json
{
  "name": "kobold-caves",
  "version": "1.0",
  "kinds": [5250],
  "features": ["dungeon-crawl", "idle-mode", "loot-system", "pet-compatible"],
  "pricing": { "5250": "10000" },
  "metadata": {
    "difficulty": "easy",
    "theme": "kobold-cave",
    "maxRooms": 15,
    "lootTier": "common-uncommon",
    "requiredPetStage": 2
  }
}
```

### 14.6 Key Technology Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D11-PM-001 | Idle Dungeon (one-call) for MVP | Simplest UX, cheapest (one ILP payment), best ZK profile (one state transition) |
| D11-PM-002 | rot.js as dungeon engine | TypeScript, seedable RNG (ZK-compatible), headless, BSD-3, 2,700+ stars, feature-complete |
| D11-PM-003 | Separate DVM handler (not modifying PetDvmHandler) | Clean separation of concerns; dungeon is additive, not disruptive |
| D11-PM-004 | Stat deltas feed through PetDvmHandler for ZK proof | Reuses existing circuit; no new ZK infrastructure for dungeon MVP |
| D11-PM-005 | Adventure log on Arweave via kind:5094 | Permanent, provable pet biography; existing infrastructure |
| D11-PM-006 | Marketplace-as-world: anyone can publish a dungeon | Proves the DVM marketplace thesis; third-party content via kind:10035 |

---

## 15. Open Integration Questions

| # | Question | Options | Blocking? |
|---|----------|---------|-----------|
| Q1 | Pet DVM request kind number | 5900-5999 range? Register with NIP-90? | Phase 2 |
| Q2 | Pet DVM result kind number | 6900-6999 (matching request range)? | Phase 2 |
| Q3 | PET token mechanics | Burn (deflationary) vs escrow (recoverable)? | Phase 3 |
| Q4 | DVM skill descriptor format | Extend existing kind:10035 or new kind? | Phase 2 |
| Q5 | Proof batch trigger | Time-based (every N minutes) or count-based (every N interactions)? | Phase 2 |
| Q6 | Legacy pet social task verification | DVM checks relay for kind:1/36767/3367 events? | Phase 2 |
| Q7 | napi-rs distribution | npm prebuilds (node-pre-gyp) or platform-specific packages? | Phase 1 |
| Q8 | PetLifecycle verification key caching | Cache to disk after first compile? Commit to repo? | Phase 1 |
| Q9 | Dungeon "effect" action type in PetGameEngine | New action type `dungeon-effect` or reuse existing actions? | Phase 5 |
| Q10 | Dungeon loot item format | On-chain (Mina) vs off-chain (Arweave) vs event-only (Nostr)? | Phase 5 |
| Q11 | ~~Animated sprite asset pack selection~~ | **RESOLVED:** Dungeon: Ninja Adventure + 0x72 (CC0). Pets: Animated Slimes by Stealthix (CC0) + 16 Blobbi palette-swap variants generated. Pixel Mob! ($7 CC0) as upgrade path. | Phase 5 |
