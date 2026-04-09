# Memvid + TOON Protocol Integration Handoff

**Date:** 2026-04-04
**Author:** Jonathan Green (with BMAD agent collaborative analysis)
**Audience:** TOON Protocol development team
**Status:** Exploration / Pre-RFC

---

## Executive Summary

This document captures findings from a collaborative analysis session exploring how **Memvid** (single-file AI agent memory) integrates with **TOON Protocol** (ILP-gated Nostr relay) and **Connector** (ILP payment router). The goal: identify novel implementations and collaboration opportunities — honestly separating genuine innovation from hype.

**Bottom line:** Memvid occupies a legitimate, currently uncontested niche — "SQLite for AI memory." The integration with TOON/Connector is architecturally clean and creates capabilities that are genuinely novel, particularly when combined with Arweave permanence and Mina zero-knowledge proofs.

---

## What Is Memvid

Memvid is a Rust library that packages documents, embeddings, search indices, and metadata into a single portable `.mv2` file. It serves as a memory layer for AI agents.

**Repository:** https://github.com/memvid/memvid
**Version:** 2.0.139
**License:** Apache 2.0

### Key Technical Properties

| Property | Detail |
|---|---|
| **Format** | Single `.mv2` file (header, WAL, data segments, lex index, vec index, time index, TOC) |
| **Search** | Hybrid: Tantivy full-text + HNSW vector similarity in one file |
| **Crash safety** | Embedded write-ahead log (WAL) |
| **Integrity** | BLAKE3 content hashes, ed25519 signatures |
| **Encryption** | AES-256-GCM with Argon2 key derivation (`.mv2e` capsules) |
| **Multi-modal** | CLIP image embeddings, Whisper audio transcription |
| **Temporal** | Built-in time index with replay capability |
| **Embeddable** | No server required. Runs on a Raspberry Pi. |
| **Feature flags** | Compile only what you need: `lex`, `vec`, `clip`, `whisper`, `encryption`, `replay`, etc. |

### Competitive Position (Honest Assessment)

Memvid's niche is **embeddable, single-file, portable AI memory**. No other solution combines all of: single-file portability, embedded operation, hybrid search, crash safety, multi-modal support, and encryption at rest.

- **ChromaDB** is the closest embedded competitor but lacks WAL, encryption, hybrid search, multi-modal, and single-file portability (uses a directory).
- **Pinecone/Weaviate/Qdrant** are server-based vector databases — different category entirely.
- **Mem0/Zep** require external backends (Postgres, vector DBs).
- **Letta/MemGPT** runs as a server with a database.

**The honest risk:** This niche could erode as SQLite adds vector extensions (`sqlite-vec`) and ChromaDB matures. The window of unique composition is estimated at 12-18 months.

---

## Why This Matters for TOON Protocol

### The Stack View

```
┌──────────────────────────────────────────────────┐
│  MINA           — Proof layer (provable)         │
│  Recursive ZK proofs, Poseidon commitments       │
├──────────────────────────────────────────────────┤
│  ARWEAVE        — Archive layer (permanent)      │
│  kind:5094 blob storage, ~$6-8/GB one-time       │
├──────────────────────────────────────────────────┤
│  MEMVID (.mv2)  — Working layer (active)         │
│  Hot memory, hybrid search, sub-ms queries       │
├──────────────────────────────────────────────────┤
│  TOON PROTOCOL  — Communication layer            │
│  Nostr discovery, ILP transport, DVM services    │
├──────────────────────────────────────────────────┤
│  CONNECTOR      — Settlement layer               │
│  ILP routing, multi-chain payment channels       │
└──────────────────────────────────────────────────┘
```

Memvid gives TOON agents something they currently lack: **persistent, portable, searchable memory with cryptographic integrity.**

### Integration Touch Points

```
Memvid (.mv2 file)
  │
  ├── BLAKE3 hash ──→ Mina RecursiveLifecycle.step(priorProof, stateHash, cycle)
  │                     Already spiked: packages/overmind/spike/src/RecursiveLifecycle.ts
  │
  ├── Raw bytes ────→ Arweave kind:5094 upload via TOON SDK
  │                     Already production: packages/sdk/src/arweave/
  │
  ├── ed25519 sig ──→ Nostr identity verification (same curve)
  │
  └── Search API ───→ DVM compute handler for paid RAG queries
                        New integration needed
```

---

## Concrete Integration Opportunities

### 1. Memory-Backed DVM Services (Memvid + TOON SDK)

**What:** TOON DVM agents (kind:5250) that maintain persistent knowledge via `.mv2` files, getting smarter with every paid interaction.

**How it works:**
1. Agent receives DVM request via TOON
2. Searches its `.mv2` file for relevant context (hybrid search)
3. Generates response with accumulated knowledge
4. Responds via TOON, earns payment via Connector
5. Stores interaction back into `.mv2`
6. Next request benefits from accumulated knowledge

**What exists today:**
- TOON SDK DVM handler dispatch: production
- Memvid search/put APIs: production
- **Gap:** Rust↔TypeScript bridge (see Integration Path below)

**Value:** Stateless DVM agents become stateful. Memory becomes competitive advantage.

### 2. Arweave Memory Checkpoints (Memvid + kind:5094)

**What:** Periodic `.mv2` snapshots uploaded to Arweave for permanent backup and resurrection.

**How it works:**
1. Agent commits Memvid checkpoint (WAL flush)
2. `.mv2` file uploaded to Arweave via existing kind:5094 DVM
3. Arweave TX ID stored as checkpoint reference
4. Agent dies → new instance fetches latest `.mv2` from Arweave → resumes

**What exists today:**
- Arweave DVM upload pipeline: **production** (packages/sdk/src/arweave/)
- Chunked upload for large files: **production** (chunk-manager.ts)
- Memvid commit/snapshot: **production**
- **Gap:** Orchestration logic to trigger periodic checkpoints

**Cost:** ~$0.014 per 1,000 agent cycles. Negligible.

### 3. ZK-Provable Agent Biography (Memvid + Mina)

**What:** Cryptographically verifiable history of agent memory states using Mina recursive ZK proofs.

**How it works:**
1. At each checkpoint, compute `BLAKE3(mv2_file)` → state hash
2. Feed state hash into Mina `RecursiveLifecycle.step(priorProof, stateHash, cycle)`
3. Recursive proof compresses entire history into constant-size proof
4. On-chain: single Field value = verifiable biography of N cycles

**Verification by any third party:**
1. Read Mina proof (constant-size, on-chain)
2. Fetch `.mv2` from Arweave (permanent, by transaction ID)
3. Verify `BLAKE3(mv2_file) == stateHash` in Mina proof
4. Open `.mv2` and inspect/search actual memory contents

**What exists today:**
- RecursiveLifecycle ZkProgram: **spiked** (packages/overmind/spike/src/RecursiveLifecycle.ts)
- Memvid BLAKE3 hashes: **production** (built into file format)
- Mina settlement provider: **production** (Connector Epic 34)
- **Gap:** Connecting BLAKE3 output to RecursiveLifecycle input

**This is the highest-value integration.** It enables capabilities no competitor can easily replicate:
- Tamper-evident agent memory (hash mismatch = tampering detected)
- Selective disclosure (prove you *have* knowledge without revealing content)
- Regulatory compliance ("what did the agent know on date X?" — verifiable answer)
- Dispute resolution with on-chain evidence

### 4. Encrypted Knowledge Commerce (Memvid + TOON + Connector)

**What:** Agents build knowledge, encrypt it, sell access via ILP micropayments.

**How it works:**
1. Agent builds specialized `.mv2` knowledge base
2. Encrypts with Memvid's AES-256-GCM → `.mv2e` capsule
3. Uploads encrypted file to Arweave (permanent, but unreadable)
4. Commits content hash to Mina (proves what's inside without revealing it)
5. Buyer pays via Connector, receives decryption key
6. Buyer verifies: decrypt → BLAKE3 hash → matches Mina proof

**What exists today:**
- Memvid encryption capsules: **production**
- Arweave uploads: **production**
- Mina proofs: **spiked**
- ILP payment flow: **production**
- **Gap:** Key exchange protocol, marketplace discovery

---

## Overmind Integration Map

Memvid maps directly to planned Overmind epics:

| Epic | Overmind Need | Memvid Role |
|---|---|---|
| **15 (Heartbeat)** | Operational state persistence across wake cycles | `.mv2` stores decisions, observations, context between cycles |
| **16 (Treasury)** | Financial memory and earning history | Connector settlement records written to `.mv2` as financial memory |
| **17 (Sovereign)** | Unseeable keys, secure state in TEE | `.mv2e` encrypted capsule inside TEE; single-file makes TEE migration trivial (copy one file) |
| **18 (Biography)** | Recursive ZK proofs of agent history | BLAKE3 hash of `.mv2` → Mina RecursiveLifecycle = constant-size verifiable biography |
| **19 (Swarms)** | Multi-agent knowledge sharing | Agents share `.mv2` files via TOON; pay for access via Connector |

**Honest assessment:** Memvid is the **lowest-friction path** to Overmind's memory architecture. Not the only path — you could assemble SQLite + separate vector index + separate encryption + separate temporal tracking. But you'd be rebuilding what Memvid already provides in one artifact.

---

## Integration Path (Technical)

### The Language Bridge

Memvid is **Rust**. TOON/Connector are **TypeScript/Node.js**.

**Recommended approach: napi-rs (Node.js native addon)**

| Option | Feasibility | Trade-off |
|---|---|---|
| **napi-rs (recommended)** | High — mature ecosystem | Adds platform-specific binary to TOON build; best performance |
| **HTTP sidecar** | High — simple | Two processes; undermines single-file simplicity |
| **WASM** | Low — Tantivy + HNSW + ONNX in WASM is impractical today | Would be ideal if feasible |
| **Rewrite in TS** | Defeats the purpose | Don't |

**napi-rs integration surface:**
```typescript
// Thin TypeScript wrapper around Memvid native addon
import { Memvid } from '@memvid/node';

const mem = Memvid.open('agent-brain.mv2');
mem.putBytes(content);
mem.commit();
const results = mem.search({ query: 'topic', topK: 5 });
const hash = mem.blake3Hash(); // → feed to Mina proof
```

### Suggested Implementation Order

1. **napi-rs binding** — Expose Memvid create/open/put/commit/search/hash to Node.js
2. **DVM memory handler** — TOON SDK handler that wraps Memvid for paid RAG queries
3. **Arweave checkpoint** — Periodic `.mv2` → kind:5094 upload after N commits
4. **Mina proof bridge** — BLAKE3 hash → RecursiveLifecycle.step() at each checkpoint
5. **Overmind integration** — Wire into heartbeat cycle (Epic 16)

---

## What's NOT Worth Pursuing (Honest Cuts)

- **"Memory Guilds" (multi-agent shared .mv2)** — Sounds cool but any shared database achieves this. Not a Memvid-specific advantage.
- **"Knowledge Arbitrage"** — Per-query paid RAG works with any backend. Memvid makes it *easier* (portability), not *possible for the first time*.
- **Real-time streaming into .mv2** — Memvid is synchronous and append-oriented. Don't try to make it a hot event store.
- **WASM compilation** — Not feasible with current dependencies. Don't invest here yet.

---

## Open Questions for TOON Team

1. **napi-rs or sidecar?** — napi-rs is recommended for performance, but adds build complexity. Does the TOON build pipeline support native addons?
2. **Checkpoint frequency** — How often should Overmind agents snapshot to Arweave? Every cycle? Every N cycles? Cost vs. resurrection granularity trade-off.
3. **Memory encryption in TEE** — If the `.mv2` is inside a TEE, is per-file encryption redundant? Or is defense-in-depth worth the overhead?
4. **Proof granularity** — Should Mina proofs commit per-checkpoint or per-frame? Per-checkpoint is simpler; per-frame enables finer dispute resolution.
5. **Who owns the napi-rs binding?** — Should Memvid publish `@memvid/node` or should TOON maintain a fork/wrapper?

---

## Key Resources

| Resource | Location |
|---|---|
| Memvid source | https://github.com/memvid/memvid |
| Memvid CLAUDE.md | `/CLAUDE.md` in memvid repo |
| TOON Arweave DVM | `packages/sdk/src/arweave/` |
| TOON RecursiveLifecycle spike | `packages/overmind/spike/src/RecursiveLifecycle.ts` |
| TOON OvermindRegistry spike | `packages/overmind/spike/src/OvermindRegistry.ts` |
| Connector Mina provider | `packages/connector/src/settlement/provider/mina-payment-channel-provider.ts` |
| Mina privacy analysis | `_bmad-output/planning-artifacts/research/nip59-mina-privacy-analysis-2026-03-30.md` |
| Arweave integration research | `_bmad-output/planning-artifacts/research/technical-arweave-integration-research-2026-03-24.md` |
| Overmind PRD | `_bmad-output/overmind-prd.md` |
| Overmind epics | `_bmad-output/overmind-epics-and-stories.md` |

---

## Summary

The Memvid + TOON + Connector + Arweave + Mina combination creates a **verifiable, permanent, portable memory architecture for autonomous agents**. The key innovations are:

1. **Portable agent brain** — Single `.mv2` file trivially moves between TEEs, machines, agents
2. **Permanent memory** — Arweave checkpoints ensure agents survive infrastructure failure
3. **Provable history** — BLAKE3 hashes + Mina recursive proofs = cryptographically verifiable agent biography
4. **Encrypted knowledge commerce** — Trustless sale of curated AI knowledge via ILP micropayments

Most of the building blocks already exist in production or spike form. The primary engineering work is the napi-rs bridge and orchestration logic.

The honest framing: these tools reduce the infrastructure tax on building autonomous agents, and together they reduce it more than apart. That's not mythic — but it's real, and it's buildable today.
