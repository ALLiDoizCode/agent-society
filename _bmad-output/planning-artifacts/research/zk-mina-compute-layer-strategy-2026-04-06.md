# TOON Protocol ZK Strategy: Mina as Universal Computation Verification Layer

**Date:** 2026-04-06
**Author:** BMAD Party Mode (Winston, Amelia, Mary, Victor)
**Status:** Research / Strategic Planning
**Context:** Pet zkApp architecture serves as proving ground for generalized ZK verification across all TOON DVMs

---

## Executive Summary

Mina Protocol should serve as TOON's universal computation verification layer using a three-tier verification pyramid. Not all DVM compute needs full ZK proofs — the system uses Tier 1 (full ZK) for deterministic state machines, Tier 2 (ZK commitment + TEE) for non-deterministic compute, and Tier 3 (ZK commitment only) for low-value operations. Every DVM result gets at minimum a Tier 3 commitment proof on Mina.

---

## 1. Generalized Computation Proofs

### What Already Works

TOON has two proven recursive proof implementations:
- **RecursiveLifecycle ZkProgram** (`packages/overmind/spike/src/RecursiveLifecycle.ts`) — genesis + arbitrary step proofs chaining a Poseidon lifecycle hash
- **PetLifecycle design** (architecture handoff) — extends with domain-specific constraints

The pattern is structurally identical: `hash(previousHash, cycleNumber, stateHash, domainSpecificFields)`. This is already a generalized computation proof template.

### Generalized ComputeProof ZkProgram

```
ComputeProof:
  genesis(jobId, inputHash, outputHash, providerPubkey) → proofHash
  step(priorProof, inputHash, outputHash, providerPubkey) → proofHash
```

Where:
- `inputHash = Poseidon(hash of DVM request inputs)`
- `outputHash = Poseidon(hash of DVM response)`
- `providerPubkey` — who computed it

### What Can Be Practically Proven in o1js

**Provable (practical budgets):**
- Arithmetic on Field elements (native)
- Hash computations (Poseidon native; BLAKE3 via 253-bit truncation)
- Merkle tree membership/update proofs
- Signature verification (Schnorr, ECDSA via foreign field)
- State machine transitions (pet lifecycle, agent biographies)
- Balance/payment channel claims
- Deterministic data transformations (sort, filter, aggregate)
- Game logic

**Provable but expensive (~25,000-40,000 rows):**
- Complex conditional logic with many branches
- Large Merkle tree operations (depth > 20)
- Foreign field arithmetic (ECDSA on secp256k1)

**Not practically provable in o1js:**
- LLM inference (billions of floating-point ops)
- Non-deterministic algorithms (random sampling, HNSW construction)
- Floating-point arithmetic (requires fixed-point workarounds)
- Large data processing (image/video, genome alignment)
- External I/O during proof generation

### Recommendation: Commitment-and-Verify Model

Do not attempt to prove arbitrary computation inside o1js. Instead:
1. DVM commits: `inputHash = Poseidon(inputs)`, `outputHash = Poseidon(outputs)`
2. ZK proof verifies: commitment chain valid, provider registered, payment made
3. Actual computation correctness via: (a) deterministic replay, (b) TEE attestation, or (c) domain-specific circuits

---

## 2. Three-Tier Verification Pyramid

| Tier | Mechanism | What It Proves | Cost | Applicable DVM Types |
|------|-----------|----------------|------|---------------------|
| **Tier 1: Full ZK** | o1js circuit verifies computation | Computation was correct | High (proof gen) | Deterministic state machines, game rules, payment validation |
| **Tier 2: Commitment + TEE** | ZK proves commitment chain; TEE attests runtime | Input/output binding + trusted execution | Medium | LLM inference, data processing, non-deterministic compute |
| **Tier 3: Commitment Only** | ZK proves commitment chain; economic deterrent | Input/output binding + reputation at stake | Low | Low-value compute, cached responses, simple transforms |

### Pricing Model

```
DVM Job Price = Base Compute Cost + Verification Premium + Mina Gas Share

Verification Premium (Tier 1) = proof_generation_time × prover_cost/second
Verification Premium (Tier 2) = TEE_overhead + commitment_proof_cost
Verification Premium (Tier 3) = commitment_proof_cost only

Mina Gas Share = mina_tx_fee / batch_size
```

Proof generation costs: ~$0.06/proof (2025), declining to ~$0.001/proof (2030).

---

## 3. Agent Biographies on Mina

### Direct Extension of Pet Architecture

| Pet Concept | Agent Biography Equivalent |
|-------------|---------------------------|
| PetStats (hunger, health, etc.) | Agent metrics (jobs completed, revenue, uptime) |
| PetAction (feed, play, etc.) | Agent actions (compute job, payment, wake cycle) |
| brainHash (BLAKE3 of .mv2) | stateHash (Poseidon of agent-state.json snapshot) |
| lifecycleHash chain | biographyHash chain (already in RecursiveLifecycle) |
| cycle (interaction count) | cycleNumber (already in CycleState) |
| totalSpent (PET tokens) | totalEarned / totalSpent (ILP payment totals) |
| stage (egg/baby/adult) | mode (bootstrap/active/sovereign) |

### On-Chain State (Post-Mesa: 32 Fields)

Pre-Mesa (8 fields): petId, biographyHash, cycleNumber, executionCount, stateHash, ownerX, treasuryCommitment, registryRoot

Post-Mesa (32 fields): All above plus per-skill execution counts, cooldown timestamps, TEE attestation hash, last wake cycle, sub-agent count, cumulative ILP volume, reputation metrics, multiple Merkle roots.

**Recommendation:** Design for 32 fields from the start, deploy on 8 with packing pre-Mesa.

---

## 4. Mina as Universal Settlement

### Recommendation: Complement, Do Not Replace EVM

| Layer | Chain | Purpose |
|-------|-------|---------|
| **Verification** | Mina | Biography proofs, computation verification, agent identity, registry |
| **Settlement** | EVM (Arbitrum) | Payment channels, USDC settlement, high-frequency value transfer |
| **Storage** | Arweave | Permanent data, .mv2 brains, event logs |

Rationale: Mina's DeFi is nascent. USDC on Arbitrum has deep liquidity. ILP router already bridges both. Lambda Class Mina-to-Ethereum bridge enables Mina proofs to unlock EVM-side actions.

---

## 5. Proof Aggregation

### Tree-Based Recursive Aggregation

```
Level 0 (Leaves):    DVM_A proof    DVM_B proof    DVM_C proof    DVM_D proof
Level 1 (Merge):      Aggregate_AB              Aggregate_CD
Level 2 (Root):          TOON_Epoch_Proof (1 Mina TX)
```

Break-even at ~20+ proofs per epoch. Start with direct Mina L1. Consider Zeko L2 when volume justifies it.

---

## 6. Limitations

| Computation Type | Why Not Provable | Mitigation |
|-----------------|------------------|------------|
| LLM inference | Billions of non-linear ops | Tier 2: TEE attestation |
| Random sampling | Non-deterministic | Commit seed, prove from seed |
| Floating-point | o1js uses Field elements | Fixed-point (100x scaling) |
| Large data I/O | Circuit can't read files | Prove hash of fetched data |
| Image/video | Exceeds 65,536 row limit | TEE for processing verification |

### Constraint Ceilings
- Kimchi circuit: 2^16 = 65,536 rows per method
- Recursive step: ~10-30 seconds
- Compilation: ~30-120 seconds
- Field size: ~254 bits
- State slots: 8 fields (32 post-Mesa)

---

## 7. Economic Model

### ZK Verification Creates a Moat

1. **Network effect**: More verified DVMs → more trust → more clients → more DVMs
2. **Proof infrastructure investment**: First-mover advantage in ZkProgram catalog
3. **Biography accumulation**: Recursive proofs compound over time. Unforkable.
4. **Economic ceiling**: totalSpent/totalEarned are on-chain facts, not claims

---

## 8. Strategic Priorities

### Build Now
1. PetLifecycle ZkProgram (first full Tier 1 circuit, proves pattern end-to-end)
2. ComputeCommitment ZkProgram (Tier 3, universal — every DVM result gets commitment)
3. Design all zkApps for 32 fields (Mesa-ready)

### Build Next
4. TEE attestation + ZK commitment (Tier 2) for LLM/data DVMs
5. Generalize into BiographyProof ZkProgram (serves pets + agents)
6. Proof aggregation tree when volume > 20 proofs/epoch

### Future
7. Zeko L2 for high-throughput proof settlement
8. Mina-to-Ethereum bridge for cross-chain biography verification

### Do Not Do
- Prove LLM inference in o1js (use TEE)
- Wait for Mesa to start building
- Build aggregation before volume exists
- Create general settlement token on Mina (keep USDC on EVM)

---

## Sources

- Road to Mesa: Status Update (Feb 2026) — minaprotocol.com
- Mina Recursion Documentation — docs.minaprotocol.com
- Zeko Core Concepts — docs.zeko.io
- zkGPT: ZK Proof Framework for LLM Inference — eprint.iacr.org/2025/1184
- Economics of ZK-Proving — chorus.one
- Mina-to-Ethereum ZK Bridge (Lambda Class)
- Aligned Bridge for Mina Proofs on Ethereum
