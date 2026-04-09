# ZK Proofs + Arweave/AO: Analysis for TOON Protocol

**Date:** 2026-04-06
**Author:** BMAD Party Mode research agent
**Status:** Research
**Decision:** Keep Mina for proofs, Arweave for storage, AO/HyperBEAM for Tier 1 compute. Do not replace Mina with AO for ZK verification.

---

## Executive Summary

Arweave/AO should handle MORE than just storage — specifically, Tier 1 compute via HyperBEAM DVM providers and Chain Bridge access. But it should NOT replace Mina for ZK proof verification. The three systems serve complementary roles: Mina proves, Arweave stores, AO computes, TOON routes payments and discovery.

---

## 1. AO (Arweave's Compute Layer)

### What It Is
AO is a decentralized hyper-parallel compute network on Arweave. Each "process" is an independent actor communicating via async message passing. All messages permanently logged on Arweave ("holographic state").

### Key Properties
- **Mainnet:** February 2025
- **Languages:** Lua (via AOS), WASM (Rust/C/C++) via `~wasm64@1.0`
- **State model:** Per-process Lua table or WASM memory. No shared global state.
- **Parallelism:** Processes execute independently — no global bottleneck
- **Token:** $AO (live, 21M supply, Bitcoin-like halving)
- **HyperBEAM:** Erlang/OTP implementation, ~25 preloaded devices, HTTP-native

### Transaction Costs
AO messages: ~$0.001 (Arweave storage cost for small messages)
Mina TX: ~$0.05-0.20
For high-frequency interactions, AO is cheaper. For occasional proof submissions, difference is immaterial.

### Production Readiness
| Dimension | Status |
|---|---|
| Mainnet | Live since Feb 2025 |
| Token ($AO) | Live |
| DEXs | Permaswap (~$250K TVL), Botega |
| Developer tooling | AOS CLI, WAO SDK (npm `wao`), AO Cookbook |
| HyperBEAM | Preview mode (March 2025) |
| Ecosystem | ~100+ projects |

---

## 2. ZK Proofs on Arweave/AO

### Can ZK Proofs Be Verified on AO?

**Theoretically yes, practically not yet demonstrated.**

Paths:
1. WASM Groth16/PLONK verifier compiled and loaded as AO process
2. snarkjs (JS/WASM) running inside AO process
3. Future HyperBEAM ZK device (mentioned in docs, not implemented)

### What Exists Today
**No production ZK verification on AO.** Only research papers and aspirational HyperBEAM roadmap items.

### Arweave vs Mina for Proofs

| Capability | Mina | Arweave (raw) | AO (on Arweave) |
|---|---|---|---|
| Store proofs | No (22KB chain) | Yes (permanent) | Yes |
| Verify proofs natively | Yes (Kimchi/Pickles) | No | Not yet |
| Recursive proof compression | Yes (native) | No | Unproven |
| Light client verification | Yes (22KB) | N/A | No (replay log) |

---

## 3. Tokens on Arweave/AO

### AO Token Standard
Well-defined Lua blueprint: `Info()`, `Balance()`, `Transfer()`, `Mint()`, `Burn()`, `TotalSupply()`. Custom tokens fully supported.

### PET Tokens: Mina vs AO

| Feature | PET on Mina | PET on AO |
|---|---|---|
| Burn enforcement | zkApp circuit (math) | Lua handler (code trust) |
| Tamper evidence | ZK proof | Holographic state (replay) |
| Proof of care | On-chain, ZK-verified | On-process, replay-verified |
| Light verification | 22KB proof | Replay full message log |

**Key difference:** Mina's burns are enforced by ZK circuit (mathematically impossible to cheat). AO relies on correct code + replayable state.

### AO DeFi
Permaswap: ~$250K TVL. Very early vs EVM DeFi ($150B+).

---

## 4. Smart Contracts / Apps on AO

### Could PetZkApp Run on AO?

Game rules (decay, feeding, evolution) could run as Lua/WASM. What you lose:

| Aspect | PetZkApp on Mina | Pet logic on AO |
|---|---|---|
| Rule enforcement | ZK circuit (proof) | Lua code (replay) |
| State model | 8 Fields (32 post-Mesa) | Unbounded Lua table |
| Proof of correctness | Constant-size SNARK | Replay entire history |
| Verification cost | O(1) | O(n) |

**AO advantages:** Unbounded state, richer programming model, faster iteration, native Arweave integration.
**AO disadvantages:** No mathematical proof, linear verification cost, weaker adversarial guarantees.

---

## 5. Optimal Hybrid Architecture

```
MINA:      ZK proofs (PetZkApp, Overmind lifecycle, VRF selection)
           Recursive proof compression (biography chain)
           On-chain state roots (Merkle roots, counters)

ARWEAVE:   Permanent storage (git objects, .mv2 brains, event logs)
           Full state data (behind Merkle roots on Mina)

AO:        Tier 1 compute (HyperBEAM pure functions)
           Chain Bridge target (kind:5260)
           Future: AO settlement (demand-driven)
           Future: ZK verification device
```

No established projects combine Mina proofs with Arweave storage. TOON would be pioneering.

---

## 6. Arweave + ZK Without Mina

### Standalone Prover (RISC Zero / SP1) + Arweave

Viable but loses:
- Native on-chain verification (need custom verifier)
- Recursive proof compression (manual, not native)
- Light client verification (no 22KB chain)
- TypeScript circuit development (Rust only)
- On-chain state model (build your own)

Gains:
- Stronger Rust ecosystem
- ~$0.02/proof via Boundless/SP1
- More flexible proof generation

**Verdict:** For TOON's specific needs (typed recursive proofs, browser proving), Mina's integrated model is simpler.

---

## 7. HyperBEAM and TOON

Existing strategy (`toon-hyperbeam-integration-strategy.md`) is well-architected:
- `~toon-client@1.0` device connects to TOON relays
- HyperBEAM nodes as DVM providers (near-zero backend cost for Tier 1)
- AO classified as Chain Bridge target, not compute backend

HyperBEAM could host WASM ZK verifier but it's unproven. Integration should remain focused on compute provisioning.

---

## 8. Recommendations

1. **Keep Mina for ZK proofs** — native verification, recursive compression, impossible to replicate on AO without months of work
2. **Keep Arweave for storage** — already correct, no change needed
3. **Pursue HyperBEAM as planned** — DVM provider, not proof layer
4. **Consider AO tokens Phase 4+** — gate on demand from Phase 3
5. **Do NOT adopt standalone provers** to replace Mina — wrong trade-off for TOON's needs
6. **Monitor AO ZK device** — if built, enables Mina proofs verified AND stored on Arweave

---

## Sources

- AO Mainnet Launch (Feb 2025) — businesswire.com
- AO Protocol Whitepaper — arweave.net
- AO Token Blueprint — cookbook_ao.arweave.net
- HyperBEAM Documentation — permaweb.github.io/HyperBEAM
- HyperBEAM Devices — hyperbeam.ar.io
- WASM Groth16 Verifier — github.com/xycloo
- snarkjs — github.com/iden3/snarkjs
- zkVerify Universal ZK Layer — zkverify.io
- RISC Zero / Boundless — risczero.com
- SP1 Hypercube — succinct.xyz
- Permaswap/Botega AO DeFi
- Arweave Identity Management with ZK — arxiv.org/pdf/2412.13865
