# Pet zkApp BLAKE3-to-Field & Hashing Spec

**Date:** 2026-04-05
**Status:** Approved — canonical hashing specification for PetLifecycle ZkProgram
**Companion Docs:**
- [Game Rules Canonical Reference](pet-zkapp-game-rules-canonical.md)
- [TOON Pet zkApp Architecture Handoff](toon-pet-zkapp-architecture-handoff.md)

---

## 1. Problem Statement

The PetLifecycle ZkProgram needs to:
1. Prove that a pet's `.mv2` brain was updated (BLAKE3 hash changed)
2. Store that hash on-chain in a Mina Field (~254-bit integer)
3. Chain hashes across recursive proofs into a single `lifecycleHash`

BLAKE3 outputs 256 bits. Mina Fields are ~254 bits (mod Pasta curve prime). This document specifies how to bridge that gap and what gets hashed.

---

## 2. Mina Field Properties

| Property | Value |
|----------|-------|
| Type | Integer mod p (Pasta/Pallas scalar field) |
| Modulus p | `28948022309329048855892746252171976963363056481941560715954676764349967630337` |
| Bit length | 254.99... bits (~255 bits, but max value < 2^255) |
| Max safe value | p - 1 |
| Poseidon output | 1 Field (native, no conversion needed) |

**Key fact:** Any 254-bit unsigned integer fits in a Field. A 256-bit value *may* exceed p and wrap around modularly, producing a different value than intended.

---

## 3. BLAKE3-to-Field Conversion

### 3.1 Strategy: Truncate to 253 bits

**Decision:** Truncate BLAKE3 output to 253 bits (drop the 3 most significant bits).

**Why 253, not 254?**
- 254-bit values can still exceed p (the field modulus), causing silent modular reduction
- 253-bit values are guaranteed < 2^253 < p, so the mapping is always injective (no collisions from reduction)
- Security margin: BLAKE3 at 253 bits still provides 126.5 bits of collision resistance — far exceeding Mina's ~128-bit security level

**Why not split into two Fields?**
- Uses 2 of 8 precious on-chain state slots for one hash
- Doubles Poseidon inputs in recursive proofs
- No security benefit — 253 bits is already overkill for this application

### 3.2 Conversion Algorithm

```
Input:  blake3_hash: [u8; 32]  (256 bits, big-endian)
Output: field_value: Field      (253 bits)

Steps:
  1. Take the full 32-byte BLAKE3 digest
  2. Mask the top 3 bits: blake3_hash[0] &= 0x1F  (clear bits 7, 6, 5 of first byte)
  3. Interpret as big-endian unsigned integer
  4. Convert to Field: Field(BigInt(hex_string))

Pseudocode (TypeScript/o1js):
  const digest = blake3(mv2DeterministicBytes);
  digest[0] &= 0x1F;  // truncate to 253 bits
  const bigint = BigInt('0x' + Buffer.from(digest).toString('hex'));
  const brainHash = Field(bigint);
```

### 3.3 Collision Resistance Analysis

| Bits | Collision resistance | Birthday attack |
|------|---------------------|-----------------|
| 256 (full BLAKE3) | 128 bits | 2^128 |
| 253 (truncated) | 126.5 bits | 2^126.5 |
| Mina security level | ~128 bits | — |

253-bit truncation is within Mina's security level. No practical attack vector.

### 3.4 Determinism Requirement

The same `.mv2` content must always produce the same `brainHash` Field value. This means:
- The BLAKE3 input must be **deterministic** (same content → same bytes → same hash)
- The truncation must be **deterministic** (always drop the same 3 bits)
- The Field conversion must be **deterministic** (always big-endian interpretation)

---

## 4. What Gets Hashed: .mv2 Deterministic Segments

### 4.1 .mv2 File Structure (Memvid)

An `.mv2` file contains multiple segments. Not all are deterministic:

```
┌───────────────────���─────────────────────────────┐
│ HEADER (4,096 bytes)                            │  ✅ Deterministic
│  magic, version, offsets, toc_checksum          │
├────────────────────��────────────────────────────┤
│ WAL (Write-Ahead Log)                           │  ✅ Deterministic
│  Ordered entries, each with blake3 checksum     │  (append-only, sequenced)
├─────────────────────────────────────────────────┤
│ DATA SEGMENTS (Frame Payloads)                  │  ✅ Deterministic
│  Serialized frames via bincode LE               │  (sorted, checksummed)
│  primary_checksum: blake3(serialized_frames)    │
├─────────────────────────────────────────────────┤
│ LEX INDEX (Tantivy full-text)                   │  ✅ Deterministic
│  Indexed: body, title, uri, tags                │  (BTreeMap sort order)
│  checksum: blake3(serialized_docs)              │
├─────────────────────────────────────────────────┤
│ VEC INDEX (HNSW graph OR flat list)             │  ❌ NON-DETERMINISTIC
│  <1000 vectors: flat (deterministic)            │  (HNSW graph layout depends
│  >=1000 vectors: HNSW (non-deterministic)       │   on input order & RNG seed)
├─────────────────────────────────────────────────┤
│ TIME INDEX (chronological ordering)             │  ✅ Deterministic
│  Sorted by (timestamp, frame_id)                │  (explicit sort guarantee)
│  checksum: blake3(sorted_entries)               │
├─────────────────────────────��───────────────────┤
│ TEMPORAL TRACK (temporal mentions)              │  ✅ Deterministic
│  Sorted mentions & anchors                      │  (explicit sort guarantee)
│  checksum: blake3(sorted_data)                  │
├─────────────────────────────────────────────────┤
│ SKETCH TRACK (SimHash fingerprints)             │  ✅ Deterministic
│  SimHash uses blake3(token) internally          │  (sorted entries)
│  checksum: blake3(track_data)                   │
├─────────────────────────────────────────────────┤
│ MEMORIES TRACK (structured cards)               │  ⚠️ Verify order
│  checksum: blake3(uncompressed_bytes)           │
├─────────────────────────────────────────────────┤
│ LOGIC MESH (entity graph)                       │  ⚠️ Verify order
│  checksum: blake3(uncompressed_bytes)           │
├─────────────────────────────────────────────────┤
│ TOC (Table of Contents)                         │  ✅ Deterministic
│  All segment manifests, bincode serialized      │
│  toc_hash: blake3(serialized_toc)               │
├─────────────────────────────────────────────────┤
│ COMMIT FOOTER (56 bytes)                        │  ✅ Deterministic
│  magic + toc_len + toc_hash + generation        │
└─────────────────────────────────────────────────┘
```

### 4.2 Hash Scope: Deterministic Segments Only

**The `brainHash` covers the content the pet experienced, not the search infrastructure built from it.**

```
brainHash = BLAKE3(
    frames_primary_checksum     ‖  // What the pet experienced (events)
    lex_segment_checksum        ‖  // Full-text index of experiences
    time_index_checksum         ‖  // Temporal ordering of experiences
    temporal_track_checksum     ‖  // Temporal mentions/anchors
    sketch_track_checksum          // Fingerprints for dedup
)
```

**Excluded from brainHash:**
- **Vec index (HNSW)** — Non-deterministic graph construction. The same vectors can produce different HNSW layouts. This is a search performance artifact, not content.
- **Memories track** — Serialization order unverified. Exclude until Memvid guarantees deterministic ordering.
- **Logic mesh** — Same concern as memories track.

**Why not just hash the entire .mv2 file?**
- The vec index makes the whole file non-deterministic
- A different HNSW construction from the same vectors would produce a different file hash
- Third parties verifying the proof need reproducibility: same events in → same hash out

### 4.3 Composite Hash Construction

The `brainHash` is a hash-of-hashes. Each segment already computes its own BLAKE3 checksum during Memvid's commit process. The composite hash chains these together:

```rust
// In napi-rs binding (Rust side):
pub fn brain_hash(&self) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();

    // Deterministic segment checksums from TOC
    hasher.update(&self.toc.frames_primary_checksum);   // [u8; 32]
    hasher.update(&self.toc.lex_checksum);              // [u8; 32]
    hasher.update(&self.toc.time_index_checksum);       // [u8; 32]
    hasher.update(&self.toc.temporal_track_checksum);    // [u8; 32]
    hasher.update(&self.toc.sketch_track_checksum);      // [u8; 32]

    hasher.finalize().into()
}
```

**Why hash-of-hashes, not hash-of-raw-bytes?**
- Memvid already computes per-segment BLAKE3 checksums during commit
- No need to re-read raw bytes; the TOC contains all checksums
- O(1) computation regardless of .mv2 file size
- Each individual checksum is independently verifiable

### 4.4 napi-rs Binding: `hash()` Method

```typescript
// @toon-protocol/memvid-node

class PetBrain {
  /**
   * Returns the BLAKE3 brain hash of deterministic segments.
   * This is the value that goes on-chain (after 253-bit truncation).
   *
   * Covers: frames, lex index, time index, temporal track, sketch track.
   * Excludes: vec index (HNSW), memories track, logic mesh.
   *
   * @returns 64-character hex string (32 bytes / 256 bits)
   */
  hash(): string;
}
```

The napi-rs binding returns the full 256-bit hex string. The 253-bit truncation happens in the TypeScript/o1js layer before creating the Field, keeping the Rust side format-agnostic.

---

## 5. Recursive Proof Hash Chaining

### 5.1 Existing Pattern: RecursiveLifecycle Spike

**Source:** `packages/overmind/spike/src/RecursiveLifecycle.ts`

The spike established this chaining pattern:

```
genesis:
  lifecycleHash = Poseidon.hash([cycleNumber, stateHash, executionCount, genesisHash])

step(n):
  lifecycleHash = Poseidon.hash([
    previousLifecycleHash,   // from prior proof
    cycleNumber,
    stateHash,               // new state for this cycle
    executionCount,
    genesisHash
  ])
```

### 5.2 PetLifecycle Chain Pattern

The pet adapts this pattern with pet-specific fields:

```
genesis:
  lifecycleHash = Poseidon.hash([
    Field(0),          // no prior hash (genesis)
    Field(1),          // cycle = 1
    brainHash,         // BLAKE3 of initial .mv2 (truncated to 253-bit Field)
    Field(0),          // interactionHash = 0 (no interaction at genesis)
    Field(0),          // stage = egg
    Field(0),          // totalSpent = 0
  ])

interact(n):
  // Owner signs this commitment with Mina key (~400 rows to verify)
  interactionHash = Poseidon.hash([actionType, itemId, timestamp, tokenCost])
  ownerSignature.verify(ownerPublicKey, [interactionHash])

  lifecycleHash = Poseidon.hash([
    previousLifecycleHash,  // from prior proof
    cycle,                  // must be previousCycle + 1
    brainHash,              // BLAKE3 of .mv2 AFTER this interaction
    interactionHash,        // cryptographic binding to exact interaction (D9)
    stage,                  // current stage (0/1/2)
    totalSpent,             // cumulative PET tokens after this interaction
  ])

evolve:
  interactionHash = Poseidon.hash([actionType, Field(0), timestamp, tokenCost])

  lifecycleHash = Poseidon.hash([
    previousLifecycleHash,
    cycle,                  // cycle at evolution
    brainHash,              // .mv2 hash after evolution event recorded
    interactionHash,        // evolution event commitment
    newStage,               // incremented stage
    totalSpent,
  ])
```

### 5.3 Properties of the Chain

| Property | Value |
|----------|-------|
| Chain length | Arbitrary (recursive proofs compose) |
| Proof size | **Constant** — does not grow with cycle count (Kimchi/Pickles property) |
| Verification time | **Constant** — milliseconds on-chain regardless of history length |
| What it proves | Every state transition from genesis followed the game rules |
| What it doesn't prove | Content of .mv2 (that requires fetching from Arweave + re-hashing) |

### 5.4 On-Chain State Usage

```
PetZkApp on-chain state (8 Fields):
  [0] petId          = Poseidon(owner, seed, blobbiId)
  [1] brainHash      = BLAKE3(.mv2 deterministic segments) → 253-bit Field
  [2] lifecycleHash  = Poseidon chain of all interactions
  [3] cycle          = total interaction count
  [4] stage          = 0 (egg) | 1 (baby) | 2 (adult)
  [5] ownerX         = owner public key x-coordinate
  [6] operatorX      = current operator (DVM or owner) pubkey x
  [7] totalSpent     = cumulative PET tokens burned
```

`brainHash` is BLAKE3 → Field (external hash brought in).
`lifecycleHash` is Poseidon (native Mina hash, computed in-circuit).

---

## 6. Third-Party Verification Protocol

Anyone can verify a pet's biography by checking three layers:

### 6.1 On-Chain Verification (Mina)

```
1. Read PetZkApp on-chain state: brainHash, lifecycleHash, cycle, stage, totalSpent
2. The lifecycleHash encodes the ENTIRE history — if it's valid, every transition was proven
3. No need to replay interactions; the recursive proof already did that
```

### 6.2 Brain Verification (Arweave + BLAKE3)

```
1. Fetch latest .mv2 checkpoint from Arweave (via kind:5094 DVM response)
2. Open .mv2, read TOC segment checksums
3. Compute: compositeBrainHash = BLAKE3(frames ‖ lex ‖ time ‖ temporal ‖ sketch)
4. Truncate to 253 bits: compositeBrainHash[0] &= 0x1F
5. Convert to Field: Field(BigInt('0x' + hex))
6. ASSERT: computedField == on-chain brainHash
```

### 6.3 Event Verification (Nostr Relays)

```
1. Fetch all Kind 14919 events for this pet from relays
2. For each event with a `proof` tag:
   a. Deserialize ZK proof from base64
   b. Verify proof against PetLifecycle verification key
3. For events without `proof` tag: optimistic (unverified)
4. Check temporal consistency: timestamps must advance monotonically
5. Check cycle consistency: cycle values must increment by 1
```

### 6.4 Confidence Levels

| Evidence | Confidence |
|----------|------------|
| Valid lifecycleHash + brainHash matches Arweave .mv2 | **HIGH** — cryptographic guarantee |
| Valid lifecycleHash, no .mv2 on Arweave yet | **MEDIUM** — proof valid but brain not archived |
| Kind 14919 events exist but no proof tags | **LOW** — optimistic, unverified |
| No events, no on-chain state | **NONE** — pet doesn't exist or is brand new |

---

## 7. Checkpoint Atomicity Protocol

When the DVM (or self-hosted operator) checkpoints the .mv2 to Arweave:

```
1. COMMIT:     PetBrain.commit()           — WAL flush, index rebuild, TOC write, fsync
2. LOCK:       Acquire exclusive write lock on .mv2
3. HASH:       brainHash = PetBrain.hash() — BLAKE3 of deterministic segments
4. UPLOAD:     Upload frozen .mv2 → Arweave via kind:5094 DVM
5. RELEASE:    Release write lock
6. BUFFER:     Any interactions during lock are buffered, ingested after release
7. PROVE:      Submit brainHash to PetLifecycle proof (async, may be batched)
8. SETTLE:     PetZkApp.applyProof(proof) on Mina (async)
```

**Ordering invariant:** The brainHash in the proof MUST correspond to the .mv2 file uploaded to Arweave. Hash is computed from the committed, locked state — never from a partially-written file.

---

## 8. Edge Cases & Failure Modes

### 8.1 .mv2 Corruption

If the .mv2 file is corrupted (individual segment checksums don't match):
- Memvid's WAL replay recovers to last consistent checkpoint
- The recovered state may differ from the on-chain brainHash
- **Recovery:** Fetch the last Arweave checkpoint matching on-chain brainHash, restore from there

### 8.2 Hash Mismatch After Migration

When migrating between DVM operators:
- New operator downloads .mv2 from Arweave
- Computes brainHash and compares to on-chain state
- **If mismatch:** Reject migration. The .mv2 is stale or tampered.
- **If match:** Safe to resume operations.

### 8.3 Vec Index Rebuild

After restoring a .mv2 from Arweave:
- The vec index (HNSW) may differ from the original (non-deterministic construction)
- This is fine — brainHash doesn't cover vec index
- Semantic search still works (same vectors, different graph layout)
- Full-text search (lex) is identical (deterministic)

### 8.4 Concurrent Interactions During Proof Generation

Proof generation takes ~10-30 seconds per recursive step. During this time:
- New interactions are applied to .mv2 (instant)
- New interactions are published as optimistic Kind 14919 events
- The in-flight proof covers state UP TO when it was started
- Next proof batch picks up where this one left off
- On-chain brainHash reflects the proven state, not the optimistic tip

---

## 9. Summary: Data Flow

```
Interaction → .mv2 commit → BLAKE3(deterministic segments) → truncate 253 bits → Field
                                                                                   │
                                                                                   ▼
                                                                          PetLifecycle.interact()
                                                                                   │
                                                           Poseidon.hash([prevLifecycleHash, cycle,
                                                                          brainHash, stage, totalSpent])
                                                                                   │
                                                                                   ▼
                                                                        new lifecycleHash (1 Field)
                                                                                   │
                                                                                   ▼
                                                                 PetZkApp on-chain state update
                                                                  brainHash + lifecycleHash stored

                                    Independently:
                                    .mv2 → Arweave (kind:5094)
                                    Kind 14919 → TOON relay (optimistic, then proven)
```
