---
stepsCompleted: [1, 2]
inputDocuments: []
workflowType: 'research'
lastStep: 2
research_type: 'technical'
research_topic: 'Mina VRF vs alternatives for decentralized harness loop governance'
research_goals: 'Evaluate whether Mina VRF is the optimal solution for governing the decentralized agent harness loop in TOON Protocol; identify alternative randomness/consensus primitives; assess trade-offs across latency, verifiability, cost, and implementation complexity'
user_name: 'Jonathan'
date: '2026-05-12'
web_research_enabled: true
source_verification: true
---

# Research Report: Mina VRF vs Alternatives for Decentralized Harness Loop Governance

**Date:** 2026-05-12
**Author:** Jonathan
**Research Type:** Technical

---

## Research Overview

This report evaluates whether Mina Protocol's VRF is the optimal mechanism for governing the decentralized OODA loop in Loony (Epic 15), TOON Protocol's decentralized agent harness. The harness loop requires a **scheduler primitive** that is trustless (no single party controls who runs next), verifiable (anyone can confirm selection was fair), and practical (compatible with harness-iteration latency requirements).

Three parallel research streams were conducted against current public sources (2025–2026 data):
1. VRF constructions and on-chain randomness (Mina, ECVRF/RFC 9381, RANDAO, drand, Chainlink VRF v2.5, Pyth Entropy)
2. Alternative randomness primitives (threshold BLS beacons, commit-reveal, TEE randomness, Solana PoH, VDFs, NEAR beacon)
3. Decentralized scheduling models (optimistic fraud proofs, EigenLayer AVS, keeper networks, Autonolas/Olas, Fetch.ai, Morpheus)

---

## Technical Research Scope Confirmation

**Research Topic:** Mina VRF vs alternatives for decentralized harness loop governance
**Research Goals:** Evaluate whether Mina VRF is the optimal solution; identify alternatives; assess trade-offs across latency, verifiability, cost, and implementation complexity

**Scope Confirmed:** 2026-05-12

---

## Section 1: The Problem Being Solved

The Loony harness loop (Epic 15) requires a scheduler that answers: **who is authorized to run the next OODA iteration, and can anyone verify that selection was fair?**

In a centralized harness (Claude Code, Cursor), whoever runs the process controls the loop. Loony's design goal is that no single party can rig selection — the scheduler must be trustless. The current plan (Epic 15 story 15.7) uses a Mina zkApp with a Poseidon-hash VRF construction for DVM worker election.

Two distinct sub-problems must be separated:
1. **Randomness / Selection** — producing an unpredictable, unbiasable output that determines who runs next
2. **State commitment / Verification** — proving that each iteration ran correctly and the workspace state succeeded in a valid chain

These are separable. The current Mina plan conflates them — Mina handles both. Whether that is optimal is the question this research addresses.

---

## Section 2: Mina VRF — Current Implementation Assessment

### How It Actually Works

Mina uses **Ouroboros Samasika** consensus. Each block producer evaluates a VRF using their private key over `(slot_id, epoch_nonce)`. The epoch nonce is derived from VRF outputs in the first 2/3 of the prior epoch. If the VRF output exceeds a stake-weighted threshold `φ(α) = 1 − (1/4)^α`, the producer wins the slot.

**Critical detail for Story 15.7:** The o1js VRF construction is **NOT standard ECVRF (RFC 9381)**. It is a custom Poseidon-hash commitment:
```
vrf_seed = Poseidon.hash([iteration_count, blockHash, session_id])
```
`blockHash` is passed as a `Provable.witness` and constrained to the current slot via `this.network.globalSlotSinceGenesis.getAndRequireEquals()`. This is a sound construction for the harness use case — it prevents retroactive slot-picking — but it is not interoperable with external VRF verifiers.

### Latency Profile (2026)

- **Current slot time:** 180 seconds (3 minutes)
- **Mesa Upgrade (MIP6, voted December 2025):** reduces slot time to **90 seconds** — expected in 2026
- **Practical finality:** 15–20 block confirmations ≈ **45–60 min current / 22–30 min post-Mesa**
- **Probabilistic near-finality:** most applications treat 1-2 blocks as sufficient in practice; a Loony session genesis that depends on Mina finality therefore adds **90–360 seconds** to session start latency

**Sources:** [Mina PoS Documentation](https://docs.minaprotocol.com/mina-protocol/proof-of-stake), [Road to Mesa Feb 2026](https://minaprotocol.com/blog/road-to-mesa-feb-2026), [MIP6 vote](https://x.com/MinaProtocol/status/2001389943529083331)

### Security Properties

- **Unpredictable:** VRF output unknown until the key-holder evaluates it — no look-ahead beyond one slot
- **Verifiable:** Proof included in block data; ZK-verifiable on-chain
- **Bias:** 1-bit — a producer can withhold their block (skip the slot), choosing between two possible outputs. Stake-proportional influence. **Same vulnerability as Ethereum RANDAO.**
- **Unique value-add:** ZK-provable state succession — each checkpoint can carry a recursive SNARK certifying all intermediate steps

### Weaknesses for Loony's Use Case

1. **Latency forces Mina off the hot path** — this is already accounted for in the tiered architecture (relay for fast working memory, Mina for checkpoints). But session *genesis* still requires a Mina tx, adding 90–180s before the first OODA cycle.
2. **1-bit bias** — the elected DVM can refuse the session by not responding (equivalent to withholding a block). Not catastrophic (dead-man's switch handles it), but not truly unbiasable.
3. **Single-chain dependency** — Mina congestion or downtime pauses session starts.
4. **Non-standard VRF** — Poseidon-hash construction is not ECVRF/RFC 9381 compliant; not independently verifiable by external tooling.

---

## Section 3: Alternatives — Randomness Primitives

### 3.1 drand / League of Entropy (Threshold BLS)

**The strongest contender for the randomness sub-problem.**

drand produces a publicly verifiable, chain-agnostic random beacon via threshold BLS signatures. The current production network is **quicknet**: 3-second rounds, BLS12-381 G1, unchained mode (each beacon independent — enables timelock encryption), RFC 9380-compliant.

**How it works:** The League of Entropy (Cloudflare, Protocol Labs, Ethereum Foundation, Filecoin Foundation, EPFL, Kudelski, ChainSafe, cLabs, Randamu, Gelato, UCL, ~15 orgs) runs a DKG ceremony to produce a shared BLS key. Each round, every node signs the round message with its key share; any node collecting ≥t partial signatures aggregates them into the single valid BLS signature for that round. BLS signatures are **deterministic** — no participant can produce a different output for the same input. The only attack is withholding, which requires ≥t colluding nodes from the diverse LoE membership.

| Property | Value |
|---|---|
| Round interval | **3 seconds** (quicknet) |
| Bias | **None** — BLS signatures are deterministic; output is either produced or withheld |
| Unpredictability | Yes — output unknown until ≥t partial sigs aggregated |
| Verifiability | Yes — anyone can verify against the published public key |
| Trust model | t-of-n of ~20 diverse orgs |
| Access | Free HTTP API: `api.drand.sh/52db9ba.../{round}` |
| On-chain verification | Yes — evmnet (BN254, 3s) supports EVM precompile verification; blog post Aug 2025 details Ethereum integration |
| Chain dependency | **None** — HTTP endpoint, chain-agnostic |

**Filecoin uses drand for leader election in production.** This is the most directly analogous use case to Loony's DVM worker selection.

**For Loony:** Replace the Poseidon-hash VRF in story 15.7 with a drand beacon output as the VRF seed. The Mina zkApp receives `drand_output` as the round seed (passed as `Provable.witness`) instead of deriving it from `blockHash`. This gives:
- Genuinely unbiasable selection (no 1-bit block-withholding attack)
- 3-second rounds vs. 90-second Mina slots
- No dependency on Mina liveness for randomness generation
- Mina zkApp retains its unique role: ZK state commitment and proof of succession

**Sources:** [drand.love](https://drand.love/), [drand quicknet docs](https://docs.drand.love/), [League of Entropy](https://www.drand.love/loe/), [Verifying quicknet on Ethereum Aug 2025](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum/), [SoK: Distributed Randomness Beacons IACR 2023/728](https://eprint.iacr.org/2023/728.pdf)

---

### 3.2 Ethereum RANDAO (PREVRANDAO)

Post-Merge Ethereum exposes the beacon chain's RANDAO accumulator via `block.prevrandao` (EIP-4399). Each validator XORs `SHA256(BLS_sig(epoch))` into the running accumulator.

**Assessment for Loony:** Not suitable as primary scheduler. Known vulnerabilities:
- **1-bit bias per slot** — any block proposer can withhold their block, choosing between two RANDAO outputs (same as Mina's weakness)
- **Forking attack (2025)** — [Nagy et al., ACM CCS 2025](https://eprint.iacr.org/2025/037.pdf) demonstrated that selectively forking out an honest proposer's published block is more powerful than withholding alone
- **12-second slots** — faster than Mina but still unsuitable for hot-path use
- Smart contract exploitation: a validator controlling the final slot can conditionally include transactions based on the RANDAO outcome

Ethereum researchers are actively working on [EIP-7998](https://eips.ethereum.org/EIPS/eip-7998) (VRF-based randao_reveal) and VDF postprocessing. Neither is deployed as of 2026.

**Verdict:** Avoid for Loony. Biasable. Ethereum dependency adds unnecessary coupling.

---

### 3.3 Chainlink VRF v2.5

Chainlink VRF (current version: v2.5, launched November 2024; v1 and v2 deprecated) provides request-response on-chain verifiable randomness. An oracle evaluates a VRF over the request seed using its private key, submits the output + proof, and the VRF Coordinator contract verifies the proof before calling back the consumer.

| Property | Value |
|---|---|
| Latency | **~2 seconds** end-to-end |
| Verifiability | On-chain proof verified by coordinator contract |
| Bias | None — deterministic given key; oracle can only withhold |
| Trust | Chainlink oracle operator (single key-holder per request) |
| Cost | LINK or native token; percentage premium over gas cost |
| Chains | ETH, BNB, Polygon, Avax, Arbitrum, Base |

**Assessment for Loony:** Better latency than Mina VRF (2s vs 90s). Cryptographically sound. But:
- Requires LINK token or EVM chain — adds economic dependency not in TOON's current stack
- Single oracle trust model — less decentralized than drand's t-of-n
- No ZK state commitment capability — purely a randomness oracle
- Not available natively on Nostr/ILP-gated infrastructure

**Verdict:** Viable fallback if drand integration is unavailable. Not the primary recommendation.

**Sources:** [Chainlink VRF Docs](https://docs.chain.link/vrf), [VRF v2.5 launch blog](https://blog.chain.link/introducing-vrf-v2-5/)

---

### 3.4 Pyth Entropy

Pyth Entropy uses a two-party commit-reveal protocol: the provider pre-commits a hash chain `H^N(seed)` on-chain; each request reveals the next value, verified as `H(r_k) == r_{k-1}`. The final output combines provider contribution, user contribution, and blockhash — secure if either party is honest.

| Property | Value |
|---|---|
| Latency | Few blocks (~6–30s depending on chain) |
| Bias | None if either provider or user is honest |
| Trust | 2-party: Pyth provider + requester |
| Chains | 19+ EVM chains (as of Q1 2026) |
| Cost | Protocol fee (Q1 2026 OP-PIP-94) |

**Assessment for Loony:** Not suitable as primary scheduler. It is a per-request oracle, not a continuous beacon. Each session start requires a separate Pyth request with user contribution — adds complexity without clear advantage over drand. Not available natively on TOON infrastructure.

**Sources:** [Pyth Entropy docs](https://docs.pyth.network/entropy), [Pyth Entropy protocol design](https://docs.pyth.network/entropy/protocol-design)

---

### 3.5 Threshold BLS Beacons (DFINITY / IC Model)

The Internet Computer uses a subnet-level threshold BLS beacon as part of consensus. Any t+1 nodes produce valid partial signatures; the aggregated BLS signature is the beacon output. Sub-second latency. The beacon drives committee selection, notarization, and block finalization.

**Assessment for Loony:** This is architecturally what drand provides as an external service. Running a dedicated threshold BLS beacon for TOON's DVM worker pool is possible (the ARPA Network is building exactly this as an EigenLayer AVS) but requires DKG setup and ongoing participation from ≥t DVM operators. For a bootstrap network, drand is the pragmatic path — it's the same security model without the operational overhead.

**Sources:** [DFINITY Consensus ar5iv/1805.04548](https://ar5iv.labs.arxiv.org/html/1805.04548), [IC Subnet Keys](https://learn.internetcomputer.org/hc/en-us/articles/34209540682644-Subnet-Keys-and-Subnet-Signatures), [ARPA EigenLayer AVS](https://arpa.medium.com/arpa-network-launches-eigenlayer-avs-enhancing-network-security-availability-and-scalability-12fe8c16b766)

---

### 3.6 Verifiable Delay Functions (VDFs)

VDFs (Boneh et al. 2018) produce an output that is sequentially computable in exactly T steps with no parallelism speedup, plus a succinct proof of correct computation. Security: if the VDF input is committed before computation begins, the output is completely unbiasable.

**Production use:**
- **Chia:** Wesolowski VDFs as Proof of Time (not for randomness per se)
- **Ethereum:** Researched VDF + RANDAO combination; no deployment as of 2026; [EIP-7998](https://eips.ethereum.org/EIPS/eip-7998) (VRF approach) is the active proposal instead
- **Filecoin:** Collaborated on VDF research but uses drand in production

**Assessment for Loony:** Not practical. The design latency T (must be long enough to prevent look-ahead) makes VDFs unsuitable for harness-iteration scheduling. The ASIC timelord risk also makes them operationally complex. The Ethereum community effectively abandoned VDFs for scheduling in favor of threshold BLS (drand) and VRF approaches.

**Sources:** [VDF original paper IACR 2018/601](https://eprint.iacr.org/2018/601.pdf), [Trail of Bits VDF intro](https://blog.trailofbits.com/2018/10/12/introduction-to-verifiable-delay-functions-vdfs/), [Ethereum VDF research](https://ethresear.ch/t/minimal-vdf-randomness-beacon/3566)

---

## Section 4: Alternatives — Scheduling Architectures

### 4.1 Autonolas / Olas (BFT Consensus Model — Most Mature Framework)

**The most sophisticated existing decentralized AI agent framework.** Autonolas uses **Tendermint BFT consensus** rather than VRF for loop governance. Each agent service runs N agents, each maintaining its own copy of an FSM App. State transitions only occur when ≥2/3 of agents agree on the next state via Tendermint block inclusion.

Key scheduling facts:
- No VRF — the loop advances through **consensus**, not lottery
- Round timeouts managed by `AbstractRoundBehaviour` (configurable, e.g., 7 seconds)
- Fault tolerant to f < N/3 failures (BFT threshold)
- Components, agents, and services registered as NFTs on-chain

**Assessment for Loony:** This approach is the right model for **multi-agent swarm scenarios** (Overmind Swarm, Epic 20) where multiple agents need to agree on shared state. For Loony's single-winner selection use case (one DVM holds the lock at a time), BFT is architecturally heavier than needed — it requires all N participants to be online and participating in each round. VRF (or drand) is simpler and more appropriate for single-winner selection from a pool of potentially offline workers.

**Sources:** [Olas — What is an Agent Service](https://docs.olas.network/open-autonomy/get_started/what_is_an_agent_service/), [Olas — ABCI Key Concepts](https://docs.olas.network/open-autonomy/key_concepts/abci/), [Gate Learn Autonolas](https://www.gate.com/learn/articles/what-is-autonolas-olas/7162)

---

### 4.2 Keeper Networks (Chainlink Automation, Gelato, Keep3r)

Keeper networks solve a related but different problem: triggering smart contract execution when conditions are met. Selection mechanisms:
- **Chainlink Automation:** Round-robin rotation in OCR3 DON — deterministic turn-taking
- **Gelato:** First-valid-executor race — competitive submission
- **Keep3r:** Self-selection with minimum KP3R bond and merit thresholds

**Assessment for Loony:** Keeper networks are condition-triggered, not session-affinity schedulers. They do not provide workspace state commitment or execution trace persistence. They are analogous to Loony's dead-man's switch (if the lock holder disappears, trigger re-election) rather than the primary scheduler.

**Interesting hybrid:** Keep3r's **merit threshold** model (minimum bond + job history) is a useful pattern for Loony's `trusted_worker_set_root` — DVM operators prove competence by holding a bond and accumulating successful executions before being admitted to the election pool.

**Sources:** [Chainlink Automation Architecture](https://docs.chain.link/chainlink-automation/concepts/automation-architecture), [Gelato Web3 Functions](https://www.gelato.network/web3-functions), [Keep3r Network GitHub](https://github.com/keep3r-network/keep3r.network)

---

### 4.3 EigenLayer AVS — Restaked ETH Security for DVM Pool

EigenLayer AVS allows operators to opt into custom decentralized services backed by restaked ETH. Operators stake ETH and risk slashing for misbehavior. The AVS designer defines selection logic.

**Key finding:** ARPA Network is building a **threshold BLS-based randomness beacon as an EigenLayer AVS** — effectively providing drand-equivalent randomness with restaked ETH security. This is the emerging standard for high-security on-chain randomness on Ethereum.

**Assessment for Loony:** EigenLayer is not directly applicable to TOON's Nostr/ILP infrastructure. But the ARPA pattern (threshold BLS beacon + restaked security) is instructive — it validates the drand direction at a more security-credentialed tier. If TOON ever needs to bridge to Ethereum for the scheduler, this is the correct EigenLayer-native pattern.

**Sources:** [EigenLayer AVS Guide Ava Protocol](https://avaprotocol.org/blog/a-guide-to-eigenlayer-avs-actively-validated-services-on-ethereum), [ARPA EigenLayer AVS](https://arpa.medium.com/arpa-network-launches-eigenlayer-avs-enhancing-network-security-availability-and-scalability-12fe8c16b766)

---

### 4.4 Optimistic Fraud Proofs

The optimistic rollup model (Arbitrum BoLD: 6.4-day challenge window; OP Stack Cannon) allows anyone to challenge incorrect execution during a window.

**Assessment for Loony:** Completely impractical for harness loop scheduling. A 6.4-day challenge window before execution finalizes is incompatible with any interactive agent use case. Fraud proofs are the right model for verifying *completed* long-running computations, not for scheduling the *next* iteration. The analogy breaks down at the latency requirement.

---

## Section 5: Comparative Analysis

### Randomness Primitives — Decision Matrix

| Primitive | Latency | Biasability | Verifiability | Trust Model | TOON Integration Cost | Verdict |
|---|---|---|---|---|---|---|
| **Mina Poseidon VRF (current)** | 90–180s per session | 1-bit (skip slot) | ZK-proven on Mina | Single key-holder | Already in stack | ✅ Keep for ZK state commitment; ❌ suboptimal for selection |
| **drand quicknet (threshold BLS)** | **3s** | **None** (BLS deterministic) | Yes, chain-agnostic HTTP | t-of-n (~20 diverse orgs) | HTTP fetch + Poseidon seed injection | ✅ **Best for selection** |
| **Ethereum RANDAO** | 12s | 1-bit + forking attack | Yes (beacon chain) | Honest validator majority | Requires Ethereum integration | ❌ Biasable; wrong chain |
| **Chainlink VRF v2.5** | ~2s | None | On-chain proof | Single oracle per request | LINK token + EVM chain | 🟡 Viable fallback |
| **Pyth Entropy** | Few blocks | None (2-party) | Hash chain | Provider + user | 19 EVM chains; HTTP API | 🟡 Per-request only |
| **Custom threshold BLS** | Sub-second | None | Yes | t-of-n DVM operators | Full DKG setup | 🟡 Long-term option |
| **VDF** | T seconds (design) | None (if pre-committed) | Wesolowski proof | Sequentiality assumption | Timelord required | ❌ Latency incompatible |

### Scheduling Architectures — Decision Matrix

| Architecture | Selection Model | Liveness | Sybil Defense | Best Fit For |
|---|---|---|---|---|
| **Mina VRF + zkApp (current)** | Stake-weighted lottery | Dead-man's switch | Trusted worker set Merkle | Single-winner from vetted pool |
| **drand + Mina zkApp (hybrid)** | Threshold BLS lottery | drand + dead-man's switch | drand LoE membership | ✅ Best of both |
| **Olas Tendermint BFT** | Consensus (no lottery) | ≥2/3 agents online | BFT threshold | Multi-agent swarms |
| **Keeper (round-robin)** | Turn-taking | DON stake | Registration + slashing | Condition-triggered automation |
| **Keep3r merit-threshold** | Self-select + bond | Incentive-based | Bond + execution history | DVM operator admission criteria |

---

## Section 6: Recommendations

### Primary Recommendation: Hybrid drand + Mina Architecture

**Separate the two sub-problems that story 15.7 currently conflates:**

**Sub-problem 1 — Randomness/Selection → drand quicknet**

Replace the `blockHash`-derived VRF seed in the Mina zkApp with a **drand beacon output**:

```ts
// In SessionRegistry.openSession():
// Instead of: vrf_seed = Poseidon.hash([iteration_count, blockHash, session_id])
// Use: vrf_seed = Poseidon.hash([iteration_count, drand_round_output, session_id])
// drand_round_output passed as Provable.witness, verified off-chain
```

The DVM worker calling `openSession()` fetches the current drand quicknet beacon, passes the 32-byte output as a public input, and the zkApp includes it in the VRF seed. The session cannot start until the designated drand round passes — giving a 3-second scheduling window rather than a 90-second Mina slot.

Benefits:
- Genuinely unbiasable (no 1-bit block-withholding attack)
- 3-second beacon vs 90-second slot (30x faster)
- drand liveness independent of Mina liveness
- No additional trust assumption — drand's LoE is more decentralized than a single Mina block producer

**Sub-problem 2 — State Commitment / ZK Proof → Mina zkApp (unchanged)**

Mina retains its unique value: ZK-provable state succession. The `workspace_hash` on-chain, the `checkpoint()` method, and the recursive SNARK proof chain remain exactly as designed in story 15.7. Mina is the kernel; drand is the scheduler feeding into it.

**Implementation change to story 15.7:** Add a `drand_round` parameter to `openSession()`. The round output is passed as a `Provable.witness` Field; no additional on-chain Mina state field needed (one field already used by `vrf_seed`).

---

### Secondary Recommendation: Keep3r-style DVM Admission

The current `trusted_worker_set_root` (IndexedMerkleMap of approved DVMs) is a static whitelist. A more robust design borrows from Keep3r:

- DVMs must **bond ILP liquidity** to join the eligible pool (economic stake)
- DVMs accumulate a **job completion counter** (on-chain via zkApp `recordExecution`)
- Minimum bond + minimum completions required before admission
- **Slashing condition:** DVM wins election but fails to deliver (misses the dead-man's switch) → forfeit bond

This adds Sybil resistance and economic incentives without changing the VRF selection mechanism. The `trusted_worker_set_root` becomes a **merit-weighted Merkle tree** rather than a static whitelist.

---

### Tertiary Recommendation: Olas/Tendermint BFT for Overmind Swarm (Epic 20)

For Loony (single-winner selection from a pool), drand + Mina is optimal. For **Overmind Swarm (Epic 20)** where N sub-agents need to agree on shared state, the Autonolas/Tendermint BFT model is more appropriate — loop advances through consensus, not lottery. Study Olas's `AbstractRoundBehaviour` and `ABCIApp` pattern before designing Epic 20's swarm coordination protocol.

---

## Section 7: Impact on Epic 15 Story 15.7

### What Changes

| Item | Current Plan | Revised Plan |
|---|---|---|
| VRF seed source | `Poseidon.hash([iteration_count, blockHash, session_id])` constrained by `globalSlotSinceGenesis` | `Poseidon.hash([iteration_count, drand_round_output, session_id])` with `drand_round` as `Provable.witness` |
| Session start latency | 90–180s (Mina slot) | 3s (drand quicknet round) |
| Biasability | 1-bit (block withholding) | None (BLS deterministic) |
| External dependency | Mina only | Mina (state) + drand HTTP (randomness) |
| On-chain fields | Unchanged (8 fields) | Unchanged — `vrf_seed` field stores drand output |
| DVM admission | Static Merkle whitelist | Merit-weighted: bond + completion counter |

### What Does NOT Change

- The Mina zkApp architecture remains the same
- `workspace_hash`, `checkpoint()`, `closeSession()`, `reclaimLock()` — all unchanged
- The tiered architecture (relay L2 / Mina L1 checkpoints) — unchanged
- The `trusted_worker_set_root` IndexedMerkleMap — unchanged structure, enhanced admission criteria
- Epic 13 co-development — unchanged; 15.8 still IS the Chain Bridge reference impl

### New Story Needed

Add **Story 15.0: drand Integration + Session Randomness Adapter** *(S/M)*
- HTTP client for drand quicknet API (`https://api.drand.sh/52db9ba.../{round}`)
- Verify beacon signature against published LoE public key before using as VRF seed
- `DrandAdapter.getBeacon(round?: number): Promise<DrandBeacon>` — fetch latest or specific round
- `DrandBeacon`: `{ round: number; randomness: string; signature: string }`
- Unit test: beacon verifies against known quicknet public key
- This story unblocks 15.7 (story 15.7 `Provable.witness` input comes from this adapter)

---

## Section 8: Key Findings Summary

1. **Mina VRF is sound but conflates two separable problems.** It is excellent for ZK state commitment (unique Mina value-add) but suboptimal for randomness/selection (90s latency, 1-bit biasable).

2. **drand quicknet is the correct primitive for selection.** 3-second rounds, genuinely unbiasable (threshold BLS, no last-revealer attack), chain-agnostic, already used by Filecoin for exactly this use case. Backed by Cloudflare, Protocol Labs, Ethereum Foundation, and ~17 other orgs. Integration cost: one HTTP call + Poseidon seed injection into the existing zkApp.

3. **The hybrid architecture (drand for selection + Mina for ZK state proof) is strictly better** than pure Mina VRF. It preserves everything that makes Mina valuable while eliminating the scheduling latency bottleneck and the 1-bit bias vulnerability.

4. **For multi-agent swarms (Epic 20), study Autonolas.** Olas is the most mature decentralized AI agent framework and uses Tendermint BFT (not VRF) for loop governance — the right model when N agents must agree rather than one winner being selected.

5. **VDFs and optimistic fraud proofs are wrong tools for this problem.** VDFs have incompatible latency; fraud proofs have 6.4-day challenge windows. Both are ruled out.

6. **EigenLayer AVS + threshold BLS (ARPA pattern) validates the drand direction** at the Ethereum-native security tier. If TOON ever needs a bridge to Ethereum-secured scheduling, this is the correct pattern.

---

## Sources

- [Mina PoS Documentation](https://docs.minaprotocol.com/mina-protocol/proof-of-stake)
- [Road to Mesa Feb 2026 — Mina Blog](https://minaprotocol.com/blog/road-to-mesa-feb-2026)
- [MIP6 Slot Time Reduction vote](https://x.com/MinaProtocol/status/2001389943529083331)
- [drand.love — official](https://drand.love/)
- [drand quicknet docs](https://docs.drand.love/)
- [League of Entropy members](https://www.drand.love/loe/)
- [Verifying quicknet beacons on Ethereum — Aug 2025](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum/)
- [SoK: Distributed Randomness Beacons — IACR 2023/728](https://eprint.iacr.org/2023/728.pdf)
- [a16z: Public Randomness and Randomness Beacons](https://a16zcrypto.com/posts/article/public-randomness-and-randomness-beacons/)
- [RFC 9381 — IETF VRF Standard](https://datatracker.ietf.org/doc/rfc9381/)
- [EIP-4399: PREVRANDAO](https://eips.ethereum.org/EIPS/eip-4399)
- [Forking the RANDAO — ePrint 2025/037](https://eprint.iacr.org/2025/037.pdf)
- [Optimal RANDAO Manipulation — AFT 2024](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.AFT.2024.10)
- [EIP-7998: VRF-based randao_reveal](https://eips.ethereum.org/EIPS/eip-7998)
- [Chainlink VRF v2.5 Documentation](https://docs.chain.link/vrf)
- [Chainlink VRF v2.5 launch](https://blog.chain.link/introducing-vrf-v2-5/)
- [Pyth Entropy Documentation](https://docs.pyth.network/entropy)
- [Pyth Entropy Protocol Design](https://docs.pyth.network/entropy/protocol-design)
- [DFINITY Consensus — ar5iv/1805.04548](https://ar5iv.labs.arxiv.org/html/1805.04548)
- [IC Subnet Keys](https://learn.internetcomputer.org/hc/en-us/articles/34209540682644-Subnet-Keys-and-Subnet-Signatures)
- [NEAR Randomness Beacon Blog](https://pages.near.org/blog/randomness-threshold-signatures/)
- [VDF Original Paper — IACR 2018/601](https://eprint.iacr.org/2018/601.pdf)
- [Wesolowski VDF — IACR 2018/623](https://eprint.iacr.org/2018/623.pdf)
- [Trail of Bits VDF Introduction](https://blog.trailofbits.com/2018/10/12/introduction-to-verifiable-delay-functions-vdfs/)
- [Chia VDF / Proof of Time](https://docs.chia.net/chia-blockchain/consensus/proof-of-time/)
- [RANDAO Last Revealer Attacks — arXiv 2403.09541](https://arxiv.org/html/2403.09541v1/)
- [Commit-Reveal² — arXiv 2504.03936](https://arxiv.org/abs/2504.03936)
- [Solana PoH — Anatoly Yakovenko Blog](https://medium.com/solana-labs/proof-of-history-a-clock-for-blockchain-cf47a61a9274)
- [On-Chain Randomness on Solana — Adevar Labs](https://www.adevarlabs.com/blog/on-chain-randomness-on-solana-predictability-manipulation-safer-alternatives-part-1)
- [Intel RDRAND — Wikipedia](https://en.wikipedia.org/wiki/RDRAND)
- [Secret Network Secret-VRF](https://docs.scrt.network/secret-network-documentation/development/development-concepts/secret-contract-fundamentals/secret-vrf-on-chain-randomness)
- [Arbitrum BoLD — Gentle Introduction](https://docs.arbitrum.io/how-arbitrum-works/bold/gentle-introduction)
- [EigenLayer AVS Guide — Consensys](https://consensys.io/blog/eigenlayer-decentralized-ethereum-restaking-protocol-explained)
- [ARPA Network EigenLayer AVS](https://arpa.medium.com/arpa-network-launches-eigenlayer-avs-enhancing-network-security-availability-and-scalability-12fe8c16b766)
- [Chainlink Automation Architecture](https://docs.chain.link/chainlink-automation/concepts/automation-architecture)
- [Gelato Web3 Functions](https://www.gelato.network/web3-functions)
- [Keep3r Network GitHub](https://github.com/keep3r-network/keep3r.network)
- [Olas — What is an Agent Service](https://docs.olas.network/open-autonomy/get_started/what_is_an_agent_service/)
- [Olas — ABCI Key Concepts](https://docs.olas.network/open-autonomy/key_concepts/abci/)
- [Fetch.ai uAgents — Architecture arXiv 2510.18699](https://arxiv.org/abs/2510.18699)
- [Morpheus SmartContracts — GitHub](https://github.com/MorpheusAIs/SmartContracts)
