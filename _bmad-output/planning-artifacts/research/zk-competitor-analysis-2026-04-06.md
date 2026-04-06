# ZK-Proof & Verifiable Computation Landscape: Competitor Analysis for TOON Protocol

**Date:** 2026-04-06
**Author:** BMAD Party Mode research agent
**Status:** Research
**Decision:** Stay with Mina for ZK application layer; consider hybrid with zkVM for DVM compute

---

## Executive Summary

No competitor matches Mina's combination of TypeScript SDK + browser proving + native recursive composition + constant-size proofs. For TOON Protocol's core needs (recursive pet lifecycle proofs, agent biographies, client-side proving in Nostr clients), Mina remains the best fit. Consider complementing with SP1 or RISC Zero for arbitrary DVM compute verification (server-side).

---

## Comparison Matrix

| Platform | Recursive Proofs | Client-Side Proving | TS/JS SDK | Proof Gen Time | Constraint Budget | Ecosystem | EVM Interop | TOON Fit |
|---|---|---|---|---|---|---|---|---|
| **Mina (current)** | Excellent (native) | Yes (browser) | o1js (TS) | 10-60s | Moderate | Small | Bridge (WIP) | **Excellent** |
| StarkNet/Cairo | Good | No | No (Cairo) | 10-60s | Unlimited | Large | Via L1 | Poor |
| Aztec/Noir | Good | Partial (noir_js) | Partial | 2-15s | Moderate | Early | Via L1 | Moderate |
| RISC Zero | Good | No | No (Rust) | 30-120s | Unlimited | Growing | Verifier | Moderate (DVM) |
| SP1 (Succinct) | Good | No | No (Rust) | 5-30s | Unlimited | Growing | Verifier | Moderate (DVM) |
| Plonky2/3 | Excellent | No | No (Rust) | ~170ms recurse | Large | Polygon | Native | Low |
| Aleo/Leo | Good | Yes (browser) | No (Leo) | 5-30s | Moderate | Small | Weak | Moderate |
| Lurk | Good (Nova) | No | No (Lisp) | 1-10s/step | Large (folding) | Minimal | None | Poor |
| ZKsync | Internal | No | TS (interaction) | N/A (server) | Full EVM | Large | Native | Poor |
| Scroll | Internal | No | TS (interaction) | N/A (server) | Full EVM | Large | Native | Poor |
| Halo2 | Good | No | No (Rust) | 1-10s | Large | Wide use | Verifier | Low |

---

## Detailed Analysis by Platform

### StarkNet / Cairo
- **Architecture:** STARK-based L2 on Ethereum, Cairo language
- **Pros:** Unlimited constraint budget, battle-tested, large ecosystem
- **Cons:** No TS, no browser proving, large proof sizes (~50-200KB vs Mina's ~1KB), requires Cairo rewrite
- **TOON Fit:** Poor — losing client-side proving breaks the architecture

### Aztec / Noir
- **Architecture:** Privacy L2, Noir language (Rust-inspired)
- **Pros:** Privacy-native, noir_js enables partial browser proving, recursive proofs
- **Cons:** Aztec still testnet, Noir is separate language, smaller ecosystem
- **TOON Fit:** Moderate — watch noir_js maturity. Potential long-term alternative.

### RISC Zero (zkVM)
- **Architecture:** General-purpose zkVM proving RISC-V execution
- **Pros:** "Just write Rust, get proofs." Unlimited computation. Bonsai proving service.
- **Cons:** 30-120s proof time, no browser proving, not a blockchain
- **TOON Fit:** Moderate for DVM compute verification only. Not for pets/biographies.

### SP1 (Succinct)
- **Architecture:** Fastest zkVM, RISC-V based, Plonky3 backend
- **Pros:** 10-100x faster than RISC Zero. $0.02/proof via Hypercube. Succinct Network.
- **Cons:** No browser proving, very new, Rust-only
- **TOON Fit:** Best zkVM option for server-side DVM compute verification.

### Aleo / Leo
- **Architecture:** Privacy-first L1, closest architectural match to Mina
- **Pros:** Client-side proving, privacy-native, recursive composition, $298M+ funding
- **Cons:** Leo not TypeScript, smaller ecosystem, weaker interop
- **TOON Fit:** Moderate — credible alternative if ecosystem grows substantially.

### zkEVM Rollups (ZKsync, Scroll, Polygon zkEVM)
- **Architecture:** Scale Ethereum via zkEVM
- **TOON Fit:** Wrong paradigm entirely. Users don't create proofs. ZK is hidden infrastructure.

### Halo2 (Zcash/PSE)
- **Architecture:** Proof system library (not a blockchain)
- **Pros:** Flexible, battle-tested, no trusted setup, lookup tables
- **Cons:** Very low-level Rust, months of work to replicate o1js capabilities
- **TOON Fit:** Low — too low-level unless building custom proof system.

---

## Key Finding: The ZK Space Is Bifurcating

**Category 1: zkEVM Rollups** — Winning "scale Ethereum." Wrong for TOON.
**Category 2: Application-Specific ZK** — Where TOON lives. Mina is uniquely positioned.

---

## Switching Cost from Mina

- Direct: 2-4 weeks rewriting circuits + all test infrastructure
- Indirect: Potential loss of browser proving (architectural redesign)
- Total estimate: 4-8 weeks + redesign if browser proving lost

---

## Recommendations

1. **Stay with Mina** for ZK application layer (pets, biographies, client-side proofs)
2. **Consider SP1/RISC Zero** later for arbitrary DVM compute verification (server-side)
3. **Watch Noir + noir_js** — potential alternative if browser proving matures
4. **Watch Aleo** — credible if ecosystem grows
5. **Track Mina's Bridge** — EVM interop is the weakest point

---

## Sources

- o1js ECDSA Documentation — docs.minaprotocol.com
- o1js Foreign Fields Documentation — docs.minaprotocol.com
- Support Secp256r1 PR #1885 (constraint counts) — github.com/o1-labs/o1js
- sha256-o1js Optimized Implementation — github.com/Shigoto-dev19/sha256-o1js
- EdDSA-o1js (circuit size warning) — github.com/o1-labs-XT/eddsa-o1js
- BIP-340 Schnorr Signatures Specification — bips.dev/340
- Pickles Specification — o1-labs.github.io/proof-systems
- Kimchi Specification — o1-labs.github.io/proof-systems
