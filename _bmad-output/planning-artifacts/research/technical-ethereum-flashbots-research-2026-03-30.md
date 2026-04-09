---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'Ethereum Flashbots'
research_goals: 'Broad overview and general learning deep-dive of the full Flashbots ecosystem — MEV problem, architecture, searcher/builder/proposer interactions, MEV-Boost, MEV-Share, SUAVE'
user_name: 'Jonathan'
date: '2026-03-30'
web_research_enabled: true
source_verification: true
---

# Research Report: Ethereum Flashbots

**Date:** 2026-03-30
**Author:** Jonathan
**Research Type:** Technical

---

## Research Overview

This research provides a comprehensive technical deep-dive into the Ethereum Flashbots ecosystem — the suite of protocols, tools, and infrastructure that has fundamentally reshaped how blocks are built on Ethereum. Starting from the MEV (Maximal Extractable Value) problem that motivated Flashbots' creation, the report covers the full architecture of Proposer-Builder Separation (PBS), the MEV-Boost middleware, MEV-Share orderflow auctions, BuilderNet's TEE-based decentralized block building, and the long-term SUAVE vision.

Key findings include: MEV-Boost is the de facto standard for Ethereum block production; builder centralization remains the critical open challenge (top 3 builders hold ~86% market share); BuilderNet represents the most significant architectural response to date; and Enshrined PBS (EIP-7732) is 1+ years from mainnet but will eventually eliminate relay trust assumptions. The full executive summary and strategic recommendations are in the Research Synthesis section at the end of this document.

---

## Technical Research Scope Confirmation

**Research Topic:** Ethereum Flashbots
**Research Goals:** Broad overview and general learning deep-dive of the full Flashbots ecosystem — MEV problem, architecture, searcher/builder/proposer interactions, MEV-Boost, MEV-Share, SUAVE

**Technical Research Scope:**

- Architecture Analysis - MEV supply chain, proposer-builder separation (PBS), relay system, MEV-Boost architecture
- Implementation Approaches - Searcher bundle construction, builder block construction, proposer selection
- Technology Stack - MEV-Boost, MEV-Share, Flashbots Protect, SUAVE, Ethereum consensus/execution layer interaction
- Integration Patterns - Searcher-to-builder APIs, relay protocols, auction mechanisms, on-chain vs off-chain coordination
- Performance Considerations - Latency in block building, MEV extraction economics, centralization risks, protocol evolution

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-03-30

## Technology Stack Analysis

### The MEV Problem — Why Flashbots Exists

**Maximal Extractable Value (MEV)** refers to the profit that can be obtained by including, excluding, or reordering transactions within a block, beyond standard block rewards and gas fees. Originally called "Miner Extractable Value" (pre-Merge), the concept was renamed to "Maximal" after Ethereum's transition to Proof of Stake.

_Key MEV Strategies:_
- **Sandwich Attacks**: An attacker places a buy transaction before and a sell transaction after a victim's trade on an AMM. The frontrun inflates the token price, the victim buys at a higher price, and the attacker sells at the inflated price. Sandwich attacks accounted for **51% of all MEV volume in 2025**.
- **Frontrunning**: An MEV searcher detects a profitable pending transaction in the mempool and places their own transaction ahead of it (with higher gas) to capture the profit first.
- **Backrunning**: A transaction is placed immediately after a target transaction to capitalize on the price movement it creates (e.g., arbitrage after a large swap).
- **DEX Arbitrage**: Bots exploit price discrepancies between decentralized exchanges, buying low on one and selling high on another.

Over **$1.2 billion** has been extracted through MEV and frontrunning on Ethereum, making it one of the most significant economic forces in DeFi.

_Source: [Ethereum.org MEV Docs](https://ethereum.org/developers/docs/mev/), [Chainlink MEV Education](https://chain.link/education-hub/maximal-extractable-value-mev), [a16z Crypto MEV Explained](https://a16zcrypto.com/posts/article/mev-explained/)_

### Core Architecture: Proposer-Builder Separation (PBS)

Flashbots' central architectural innovation is **Proposer-Builder Separation (PBS)** — splitting the dual role of block construction and block proposal (previously both done by miners/validators) into two specialized roles:

1. **Block Builders** — Specialists who accept transactions from users and searchers, then construct the most profitable block possible by optimally ordering transactions for MEV extraction.
2. **Block Proposers (Validators)** — PoS validators who select the most valuable block from competing builders and propose it to the network.

This separation prevents validators from needing to run sophisticated MEV strategies themselves, democratizing access to MEV profits while reducing centralization pressure on the validator set.

_How the PBS flow works:_
1. **Searchers** identify MEV opportunities and construct "bundles" (ordered sets of transactions) that capture value.
2. Searchers submit bundles to **Block Builders**.
3. Builders assemble full blocks from bundles + regular transactions, optimizing for maximum total value.
4. Builders submit blocks to **Relays**.
5. Relays validate blocks and forward **blinded headers** (execution payload headers stripped of transaction content) to the proposer via MEV-Boost.
6. The proposer selects the most valuable header, signs it, and returns it to the relay.
7. The relay reveals the full block for network propagation.

_Source: [Flashbots MEV-Boost Overview](https://docs.flashbots.net/flashbots-mev-boost/introduction), [MEV-Boost in a Nutshell](https://boost.flashbots.net/), [Flashbots MEV-Boost GitHub](https://github.com/flashbots/mev-boost)_

### MEV-Boost — The Core Middleware

**MEV-Boost** is open-source middleware (written in **Go**) that validators run as a sidecar to their consensus client. It implements out-of-protocol PBS by connecting validators to a competitive block-building marketplace.

_Technical Details:_
- **Language**: Go (Golang)
- **Architecture**: Sidecar process alongside the Ethereum consensus client (Lighthouse, Prysm, Teku, Lodestar, Nimbus)
- **API**: Implements the Builder API specification, communicating with consensus clients via standardized REST endpoints
- **Block Proposal Flow**: Registration → Header request → Header selection → Blinded block signing → Full block reveal
- **Trust Model**: Validators trust relays to honestly report block values and reveal valid blocks after signing

_Key Components:_
- **mev-boost** (sidecar): Queries registered relays, selects highest-value block header, mediates the signing/reveal flow
- **mev-boost-relay**: The relay implementation — validates builder submissions, stores blocks, serves headers to proposers, reveals blocks post-signature
- **Relay API**: RESTful endpoints for builder submission (`/relay/v1/builder/blocks`), proposer registration (`/relay/v1/builder/validators`), and block retrieval

_Source: [MEV-Boost Specifications](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/specifications), [MEV-Boost Block Proposal](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/block-proposal), [mev-boost-relay GitHub](https://github.com/flashbots/mev-boost-relay)_

### Flashbots Protect — User-Facing Transaction Protection

**Flashbots Protect** is a free RPC endpoint that users and developers can add to their wallet (e.g., MetaMask) to protect transactions from frontrunning and sandwich attacks. Launched October 2021.

_How it works:_
- Users send transactions to the Flashbots Protect RPC (`https://rpc.flashbots.net`) instead of the public mempool
- Transactions are routed directly to block builders, bypassing the public mempool entirely
- This prevents MEV searchers from seeing and frontrunning/sandwiching the transaction
- Failed transactions don't cost gas (no on-chain revert fees)
- Users can receive MEV refunds — a share of the MEV their transaction generates

_Developer Integration:_
- Simple RPC endpoint swap — works with any Ethereum library (ethers.js, web3.py, viem)
- No code changes required beyond pointing to the Flashbots RPC URL
- Configurable settings for fast inclusion, MEV refunds, and builder selection

_Source: [Flashbots Protect Overview](https://docs.flashbots.net/flashbots-protect/overview), [Flashbots Protect Settings Guide](https://docs.flashbots.net/flashbots-protect/settings-guide), [Flashbots Protect RPC GitHub](https://github.com/flashbots/rpc-endpoint)_

### MEV-Share — Orderflow Auction Protocol

**MEV-Share** is an open-source protocol that allows users to selectively share data about their pending transactions with searchers, who then bid to include those transactions in their bundles. The bid revenue is redistributed back to users.

_Key Design:_
- **Selective Privacy**: Users choose what transaction data to reveal (e.g., target contract, calldata hash, logs) — searchers see hints, not full transactions
- **Competitive Auction**: Searchers compete by bidding for the right to backrun user transactions
- **Redistribution**: A configurable share of searcher profits flows back to the originating user/wallet
- **Permissionless for Searchers**: Any searcher can participate in the auction
- **Credibly Neutral**: Designed to reduce the centralizing impact of exclusive orderflow deals

_Source: [MEV-Share Introduction](https://docs.flashbots.net/flashbots-mev-share/introduction), [MEV-Share GitHub](https://github.com/flashbots/mev-share)_

### BuilderNet — Decentralized Block Building with TEEs

**BuilderNet** (launched November 2024) is a decentralized block building network that addresses the critical centralization problem: two builders were constructing ~90% of Ethereum blocks.

_Architecture:_
- **Multi-operator Network**: Jointly operated by Flashbots, Beaverbuild, and Nethermind (with open operator onboarding)
- **TEE-based Privacy**: Each operator runs an open-source builder inside a **Trusted Execution Environment (TEE)** — encrypted secure enclaves where transactions are processed without revealing orderflow data
- **Verifiable Computation**: Orderflow providers (wallets, apps, searchers) can cryptographically verify the TEE attestation before sending encrypted orderflow
- **MEV Sharing**: MEV profits are shared with the community rather than captured by a single builder

_Timeline:_
- November 2024: BuilderNet v1.0 launched (Flashbots + Beaverbuild + Nethermind)
- December 2024: Flashbots migrated ALL builders, orderflow, and refunds to BuilderNet — ceased operating centralized block builders
- February 2025: BuilderNet v1.2 released — streamlined operator onboarding, enhanced security and performance

_Source: [Introducing BuilderNet](https://buildernet.org/blog/introducing-buildernet), [The Block: BuilderNet Announcement](https://www.theblock.co/post/328457/flashbots-unveils-buildernet-to-combat-centralization-in-ethereums-block-building), [Blockworks: BuilderNet](https://blockworks.co/news/flashbots-block-building-network-mev)_

### SUAVE — The Future Vision

**SUAVE (Single Unifying Auction for Value Expression)** is Flashbots' long-term vision for fully decentralizing block building across chains.

_Concept:_
- Unbundles the mempool and block builder role from existing blockchains entirely
- Provides a specialized, decentralized plug-and-play alternative for transaction ordering
- Cross-chain capable — not limited to Ethereum
- Currently in **alpha/research phase**

_Status:_
- August 2023: Open-sourced `suave-geth` and launched Toliman public testnet
- Protocol specifications available at [flashbots/suave-specs](https://github.com/flashbots/suave-specs)
- Still actively researched; not yet production-ready

_Relationship to Enshrined PBS:_
MEV-Boost is conceptualized as an **intermediate step** toward full in-protocol PBS, where proposer/builder separation will eventually be enshrined directly in the Ethereum protocol itself to further harden trust assumptions.

_Source: [The Future of MEV is SUAVE](https://writings.flashbots.net/the-future-of-mev-is-suave), [SUAVE Specs GitHub](https://github.com/flashbots/suave-specs), [Flashbots Collective SUAVE Forum](https://collective.flashbots.net/c/suave/27)_

### Technology Adoption Trends

_Current State (2025-2026):_
- **MEV-Boost adoption**: The majority of Ethereum validators run MEV-Boost, making it the de facto standard for block production
- **BuilderNet migration**: Flashbots fully transitioned from centralized builders to the decentralized BuilderNet TEE-based system
- **Enshrined PBS research**: Ethereum core developers are actively researching enshrining PBS into the protocol itself, which would supersede the out-of-protocol MEV-Boost approach
- **TEE proliferation**: TEE-based solutions (Intel TDX, SGX) are becoming a cornerstone of the Flashbots stack for privacy-preserving computation
- **Cross-chain MEV**: SUAVE and related research indicate a trend toward chain-agnostic MEV infrastructure

_Developer Ecosystem:_
- Flashbots Auction Quick Start and SDKs for searcher development
- Integration with major Ethereum libraries (ethers.js, web3.py)
- Open-source tooling: Simple-Arbitrage, Searcher-Sponsored-TX, Searcher-Minter example bots
- Active community forum at [collective.flashbots.net](https://collective.flashbots.net)

_Source: [Flashbots Quick Start](https://docs.flashbots.net/flashbots-auction/quick-start), [Flashbots.net](https://www.flashbots.net), [Flashbots Writings](https://writings.flashbots.net/)_

## Integration Patterns Analysis

### Searcher Bundle API (eth_sendBundle)

The primary integration point for MEV searchers is the **Flashbots Auction JSON-RPC API**, accessed at `relay.flashbots.net`. Searchers submit atomic bundles of transactions that must execute together in a specific order.

**`eth_sendBundle` Parameters:**
- `txs` — Array of signed transactions to execute atomically in the bundle
- `blockNumber` — Hex-encoded target block number for which the bundle is valid
- `minTimestamp` / `maxTimestamp` — (Optional) Unix epoch bounds for bundle validity
- `revertingTxHashes` — (Optional) Array of tx hashes that are allowed to revert without failing the whole bundle
- `replacementUuid` — (Optional) UUIDv4 for canceling/replacing bundles via `eth_cancelBundle`
- `builders` — (Optional) Array of registered builder names to share the bundle with

**Authentication — X-Flashbots-Signature:**
All requests require payload signing. The signature is calculated by taking the **EIP-191 hash** of the JSON body (UTF-8 encoded), signed with the searcher's private key. The signature is included in the `X-Flashbots-Signature` HTTP header as `{signerAddress}:{signature}`. This authenticates the searcher without requiring API keys.

**Rate Limits:**
Relay submissions are rate-limited to **600 submissions per 5 minutes per IP** (~2 submissions/sec).

**Response:**
Returns a `bundleHash` field. If specific builders are targeted, includes additional routing metadata.

_Source: [JSON-RPC Endpoints](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint), [Sending Tx and Bundles](https://docs.flashbots.net/guide-send-tx-bundle), [Quick Start](https://docs.flashbots.net/flashbots-auction/quick-start)_

### Builder API (MEV-Boost Relay ↔ Builder ↔ Proposer)

The **Builder API** is the standardized REST interface between block builders, relays, and proposers in the PBS architecture.

**Key Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/eth/v1/builder/header/{slot}/{parent_hash}/{pubkey}` | GET | Proposer requests the most valuable execution payload header for a slot |
| `/eth/v1/builder/blinded_blocks` | POST | Proposer submits a signed blinded block; relay returns the unblinded execution payload |
| `/relay/v1/builder/blocks` | POST | Builder submits a full block to the relay for validation and escrow |
| `/relay/v1/builder/validators` | GET | Builder fetches the list of registered validators and their fee recipients |

**Block Submission Flow:**
1. Builder constructs a block optimizing for MEV + priority fees
2. Builder submits the full block to the relay via `POST /relay/v1/builder/blocks`
3. Relay validates the block (simulates execution, verifies payment to proposer's `feeRecipient`)
4. Relay stores the block and creates a blinded header (execution payload without transaction content)
5. Proposer's MEV-Boost sidecar calls `GET /eth/v1/builder/header/...` — relay returns the highest-value header
6. Proposer signs the header and submits it back via `POST /eth/v1/builder/blinded_blocks`
7. Relay reveals the full block for network propagation

**Trust Properties:**
- Proposers never see transaction content before signing (prevents proposer-side MEV theft)
- Relays verify block validity and payment correctness before serving headers
- Builders compete on block value, creating a fair auction

_Source: [MEV-Boost Specifications](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/specifications), [Relay Fundamentals](https://docs.flashbots.net/flashbots-mev-boost/relay), [Block Builders](https://docs.flashbots.net/flashbots-mev-boost/block-builders)_

### MEV-Share Event Stream & Bundle Protocol

MEV-Share uses a **Server-Sent Events (SSE)** streaming protocol for real-time orderflow distribution to searchers.

**Event Stream (SSE):**
- Searchers connect to the MEV-Share Node's SSE endpoint to receive a stream of pending transactions/events
- Each event contains **hints** — selectively revealed transaction data chosen by the user/wallet
- Available hint types: `calldata`, `contract_address`, `logs`, `function_selector`, `hash`
- Searchers use these hints to construct backrun bundles without seeing the full transaction

**`mev_sendBundle` — Enhanced Bundle Submission:**
MEV-Share extends the standard bundle API with:
- **Privacy settings** — Users configure which hints to expose about their transactions
- **Validity conditions** — Fine-grained control over when bundles are valid
- **Complex bundle bodies** — Support for nested bundles and transaction references by hash (allowing searchers to reference user transactions they've only seen partial hints of)

**Orderflow Auction Mechanism:**
1. User submits a transaction to MEV-Share Node with privacy preferences
2. MEV-Share Node broadcasts hints via SSE to connected searchers
3. Searchers construct backrun bundles referencing the user's transaction hash
4. Searchers bid by including a payment to the user's specified refund address
5. Highest-bidding bundle wins inclusion alongside the user's transaction
6. User receives a share of the MEV their transaction generated

_Source: [MEV-Share Event Stream](https://docs.flashbots.net/flashbots-mev-share/searchers/event-stream), [MEV-Share Getting Started](https://docs.flashbots.net/flashbots-mev-share/searchers/getting-started), [Searching on MEV-Share](https://writings.flashbots.net/searching-on-mev-share), [MEV-Share Protocol Spec](https://github.com/flashbots/mev-share)_

### Client Libraries & SDK Integration

Flashbots provides official and community libraries for multiple languages:

**JavaScript/TypeScript:**
- `@flashbots/ethers-provider-bundle` — ethers.js provider that wraps bundle submission, simulation, and Flashbots-specific RPC methods
- `@flashbots/mev-share-client-ts` — TypeScript client for MEV-Share event stream and bundle API
- Integrates with ethers.js `JsonRpcProvider` pattern; searchers create a `FlashbotsBundleProvider` and call `sendBundle()` / `simulate()`

**Python:**
- `web3-flashbots` — web3.py middleware for `eth_sendBundle` and `eth_callBundle` (simulation)
- Attaches to a standard `Web3` instance as middleware

**Go:**
- `github.com/lmittmann/flashbots` — Go package for Flashbots bundle submission
- Native Go HTTP client integration

**Authentication Pattern (all libraries):**
All libraries handle EIP-191 signature generation internally — the searcher provides their signing key, and the library constructs the `X-Flashbots-Signature` header automatically.

_Source: [Ethers.js Provider](https://docs.flashbots.net/flashbots-auction/libraries/ethers-js-provider), [ethers-provider-flashbots-bundle GitHub](https://github.com/flashbots/ethers-provider-flashbots-bundle), [Go Flashbots Package](https://pkg.go.dev/github.com/lmittmann/flashbots)_

### Data Transparency & Monitoring APIs

Flashbots emphasizes three pillars: **Illuminate** (transparency), **Democratize** (open access), **Distribute** (MEV redistribution).

**Relay Data API:**
- Relays expose data transparency endpoints for querying delivered payloads, builder submissions, and validator registrations
- Block value calculations are standardized across the ecosystem for consistent accounting

**Flashbots Transparency Dashboard:**
- Public metrics on relay performance since the Merge (September 15, 2022)
- Builder market share, relay utilization, MEV extraction volumes

**Relayscan (Community Monitoring):**
- Open-source monitoring tool for MEV-Boost builders and relays
- Queries relay data APIs, checks payload values, tracks builder statistics
- Available at [github.com/flashbots/relayscan](https://github.com/flashbots/relayscan)

**MEV-Explore:**
- Historical MEV data and analytics across the Ethereum network
- Transaction-level MEV classification (arbitrage, liquidation, sandwich)

_Source: [Flashbots Transparency Dashboard](https://boost.flashbots.net/mev-boost-status-updates/introducing-the-flashbots-transparency-dashboard), [Relayscan GitHub](https://github.com/flashbots/relayscan), [Flashbots Auction Overview](https://docs.flashbots.net/flashbots-auction/overview)_

### Integration Security Patterns

**Searcher Authentication:**
- EIP-191 signed payloads via `X-Flashbots-Signature` header — no API keys, no account creation required
- Reputation is tied to the signing address (consistent address use builds reputation with builders)

**Transaction Privacy:**
- Flashbots Protect RPC bypasses the public mempool entirely — transactions are invisible to frontrunners
- MEV-Share hint system provides programmable privacy — users control exactly what data searchers can see
- BuilderNet TEE enclaves process transactions in encrypted memory — even operators cannot inspect orderflow

**Relay Trust Model:**
- Relays are trusted third parties in the current architecture (a known centralization concern)
- Relays verify block validity via simulation before serving headers to proposers
- Multiple independent relays exist (Flashbots, bloXroute, Ultrasound, Agnostic, etc.) — proposers can register with multiple relays for redundancy
- Enshrined PBS aims to eventually remove relay trust assumptions entirely

**Bundle Atomicity:**
- Bundles execute atomically — all transactions succeed or none are included
- `revertingTxHashes` allows specific transactions to fail without breaking the bundle
- Failed bundles are never landed on-chain (no wasted gas)

_Source: [JSON-RPC Endpoints](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint), [MEV-Boost Risks and Considerations](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/risks), [Flashbots Protect Overview](https://docs.flashbots.net/flashbots-protect/overview)_

## Architectural Patterns and Design

### System Architecture: The MEV Supply Chain

The Flashbots ecosystem implements a **layered auction architecture** that separates concerns across the MEV supply chain:

```
Users/DApps → [Public Mempool OR Flashbots Protect RPC]
                         ↓
              Searchers (bundle construction)
                         ↓
              Block Builders (block assembly)
                         ↓
              Relays (validation + escrow)
                         ↓
              MEV-Boost Sidecar (header selection)
                         ↓
              Proposer/Validator (signing + proposal)
                         ↓
              Ethereum Consensus Layer (finalization)
```

**Key Architectural Decisions:**

1. **Commit-Reveal Scheme**: Proposers sign blinded block headers (commit) before seeing transaction content. The relay then reveals the full block. This prevents proposer-side MEV theft but introduces relay trust — a deliberate trade-off over the alternative "Stage 1 PBS" where builders send cleartext blocks directly to validators.

2. **Sidecar Pattern**: MEV-Boost runs as a sidecar alongside the consensus client, not as a modification to the client itself. This allows any consensus client (Lighthouse, Prysm, Teku, Lodestar, Nimbus) to integrate without protocol changes.

3. **Multi-Relay Architecture**: Proposers can register with multiple independent relays simultaneously, creating redundancy and competitive pressure. If one relay fails or censors, others can still serve blocks.

_Source: [MEV-Boost Risks and Considerations](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/risks), [Understanding Liveness Risks from MEV-Boost](https://boost.flashbots.net/mev-boost-status-updates/understanding-liveness-risks-from-mev-boost), [MEV-Boost Architecture (HackMD)](https://hackmd.io/@manifold/S1jRmGIPF)_

### Design Trade-offs and Trust Model

**What Relays Must Be Trusted For:**
- Filter invalid execution payloads (reject blocks that don't execute correctly)
- Accurately report payload value (don't lie about how much a block pays the proposer)
- Reveal transaction content after the proposer signs the header (don't withhold blocks)

**Liveness Risk:**
If the entire network connects to the same relay AND that relay is the highest bidder AND the relay withholds the block after receiving the proposer's signature, the result is a series of empty slots. Mitigations:
- Multiple independent relays (Flashbots, bloXroute, Ultrasound, Agnostic Gnosis, etc.)
- Proposers configure fallback to local block building if no relay responds
- Circuit-breaker patterns in MEV-Boost for relay timeouts

**Why NOT Stage 1 PBS (Cleartext Blocks)?**
- Validators would need to open a DOS-vulnerable RPC to receive builder blocks
- Builders must trust validators not to steal MEV from inspected transactions
- Current commit-reveal scheme trades relay trust for these properties

**Censorship Considerations:**
- A dominant builder could theoretically censor transactions (though lacks incentive)
- OFAC compliance concerns: Some relays have historically filtered sanctioned addresses
- BuilderNet's multi-operator TEE model aims to provide censorship resistance at the builder level

_Source: [MEV-Boost Risks and Considerations](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/risks), [Stanford Blockchain Review: MEV and Flashbots](https://review.stanfordblockchain.xyz/p/mev-and-flashbots-the-uniquely-defi), [Flashbots Overview](https://docs.flashbots.net/flashbots-auction/overview)_

### Builder Market Centralization Problem

The block builder market exhibits extreme concentration — this is the central architectural challenge Flashbots is working to solve:

**Current State (March 2025):**
- **16 active block builders** on Ethereum
- **Top 5 builders account for ~99%** of block production
- **Top 3 builders hold ~85.9%** market share of all blocks and **86.8%** of MEV value
- Two to three builders consistently produce 80-95% of blocks

**Root Cause — Private Orderflow Feedback Loop:**
1. Builders with more market share attract more **exclusive orderflow** (private transactions from searchers, wallets, and apps)
2. More exclusive orderflow = more MEV opportunities = more profitable blocks
3. More profitable blocks = higher relay bids = more blocks won
4. More blocks won = higher market share → return to step 1

**Barriers to Entry:**
- Access to private orderflow is gated by reputation and market share thresholds (often ≥1%)
- New entrants face costly subsidy requirements (~1.4 ETH or more) just to establish credibility
- Searcher-builder integration creates vertical consolidation where searchers accept lower margins for guaranteed prioritization

**BuilderNet as Architectural Response:**
BuilderNet directly attacks this centralization by pooling orderflow across operators in TEEs — no single operator can capture exclusive orderflow advantage.

_Source: [Decentralization of Ethereum Builder Market](https://decentralizedthoughts.github.io/2024-05-07-decentralization-ethereum/), [Who Wins Ethereum Block Building Auctions and Why?](https://arxiv.org/abs/2407.13931), [Blockworks: BuilderNet](https://blockworks.co/news/flashbots-block-building-network-mev), [Private Order Flows and Builder Bidding Dynamics](https://arxiv.org/html/2410.12352)_

### rbuilder — High-Performance Block Builder in Rust

Flashbots' current production block builder is **rbuilder**, an open-source Rust implementation that replaced the earlier Go-based builder:

- **Language**: Rust (chosen for performance in latency-sensitive block building)
- **Designed for Reth**: Built to integrate with the Reth Ethereum execution client
- **Production since Q1 2024**, open-sourced July 2024
- **Pluggable algorithms**: Supports multiple block building strategies (effective gas price sorting, total profit optimization)
- **Smart nonce management**: Identifies and handles nonce dependencies between bundles and transactions
- **Backtesting**: Leverages `mempool-dumpster` open database to backtest block building against historical blocks
- **Active development**: Continuously receiving new features and performance improvements

The deprecated Go builder (`flashbots/builder`) has been fully replaced by rbuilder in production.

_Source: [rbuilder GitHub](https://github.com/flashbots/rbuilder), [Open Sourcing rbuilder](https://writings.flashbots.net/open-sourcing-rbuilder), [Flashbots Collective: rbuilder](https://collective.flashbots.net/t/open-sourcing-rbuilder/3631)_

### Enshrined PBS (ePBS) — The Protocol-Level Future

MEV-Boost is explicitly designed as a **stepping stone** toward **Enshrined Proposer-Builder Separation (ePBS)**, where PBS is built directly into Ethereum's consensus layer.

**EIP-7732 (Draft):**
- Separates the Ethereum block into consensus and execution parts at the protocol level
- Proposer commits to a builder's block header in the beacon block
- Builders reveal execution payloads within protocol-enforced time windows
- A **Payload Timeliness Committee (PTC)** monitors builder behavior (~4 seconds for payload, ~10 seconds for blobs)
- Eliminates the need for trusted relays entirely

**The "Free Option Problem":**
After a proposer commits to a builder's header, the builder has a short window (~8 seconds) to decide whether to reveal the execution data. During market volatility, this creates a "free option" where the builder can choose not to reveal if market conditions have changed unfavorably. Research shows this can reach ~6% exploitation during volatility spikes.

**Centralization Concerns:**
Recent academic research (2025) raises concerns that ePBS could actually *amplify* builder centralization:
- Gini coefficient for profits rises from **0.1749** (standard PoS without ePBS) to **0.8358** under ePBS
- Efficient builders capture most value via MEV-driven auctions
- The auction mechanism itself may concentrate power rather than distribute it

**Current Status:**
- Advanced research stage, no finalized specification
- Likely **1+ year away** from Ethereum mainnet deployment
- Active discussion on [Ethereum Magicians](https://ethereum-magicians.org/t/eip-7732-enshrined-proposer-builder-separation-epbs/19634)

_Source: [EIP-7732](https://eips.ethereum.org/EIPS/eip-7732), [Ethereum.org PBS Roadmap](https://ethereum.org/roadmap/pbs), [SoK: Current State of ePBS](https://arxiv.org/abs/2506.18189), [Why Enshrine PBS?](https://ethresear.ch/t/why-enshrine-proposer-builder-separation-a-viable-path-to-epbs/15710)_

### Deployment and Operations Architecture

**Validator Operators:**
- Install MEV-Boost as a sidecar binary alongside their consensus client
- Register with one or more relays (configuration specifies relay URLs)
- Set `feeRecipient` address for block value payments
- Optional: Configure minimum bid threshold (reject blocks below a certain value, fall back to local building)

**Relay Operators:**
- Run the `mev-boost-relay` stack: API server, Redis, PostgreSQL, block simulation infrastructure
- Handle high throughput of builder submissions (validated, simulated, stored)
- Serve headers to proposers with sub-second latency requirements
- Maintain data transparency APIs for ecosystem monitoring

**Builder Operators (BuilderNet):**
- Run rbuilder inside a TEE (Intel TDX) with remote attestation
- Connect to BuilderNet network for pooled orderflow
- Produce blocks targeting specific relay(s)
- Backtest and optimize building algorithms against historical data

_Source: [Relay Fundamentals](https://docs.flashbots.net/flashbots-mev-boost/relay), [Block Builders](https://docs.flashbots.net/flashbots-mev-boost/block-builders), [mev-boost-relay GitHub](https://github.com/flashbots/mev-boost-relay)_

## Implementation Approaches and Technology Adoption

### Getting Started as an MEV Searcher

Flashbots has lowered the barrier to entry for searchers significantly. The onboarding process requires:

1. **Generate an ECDSA-secp256k1 key pair** — This identifies you to the Flashbots network (separate from your Ethereum wallet; used only for `X-Flashbots-Signature` authentication)
2. **Choose a client library** — `@flashbots/ethers-provider-bundle` (JS/TS), `web3-flashbots` (Python), or raw JSON-RPC calls
3. **Connect to the Flashbots relay** at `relay.flashbots.net` (or MEV-Share Node at `mev-share.flashbots.net`)
4. **Develop a strategy** — Identify MEV opportunities, construct bundles, submit via `eth_sendBundle`

**Three Searching Strategies on MEV-Share:**
- **Probabilistic**: Send many bundles that probabilistically backrun MEV-Share orderflow — high volume, lower per-bundle precision
- **On-chain logic**: Move more searching logic into smart contracts rather than off-chain computation
- **Full-information**: Only search on transactions that share all the data you need via hints — higher precision, fewer opportunities

**Example Bots and Tutorials:**
- [Automated Flash Loan Arbitrage Bot](https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/flash-loan-arbitrage/bot) — Complete tutorial
- [Limit Order Bot](https://docs.flashbots.net/flashbots-mev-share/searchers/tutorials/limit-order/introduction) — MEV-Share integration tutorial
- `simple-arbitrage` — Basic DEX arbitrage example
- `searcher-sponsored-tx` — Gasless transaction patterns
- `searcher-minter` — NFT minting MEV example

_Source: [MEV-Share Getting Started](https://docs.flashbots.net/flashbots-mev-share/searchers/getting-started), [Flashbots Quick Start](https://docs.flashbots.net/flashbots-auction/quick-start), [Searching on MEV-Share](https://writings.flashbots.net/searching-on-mev-share), [New to MEV](https://docs.flashbots.net/new-to-mev)_

### Validator MEV-Boost Setup

For Ethereum validators, adopting MEV-Boost is straightforward:

**System Requirements:**
- MEV-Boost runs as a lightweight sidecar — minimal additional CPU/RAM
- Must be installed on the same machine as the consensus client (or accessible via network with `0.0.0.0:18550`)
- Compatible with all consensus clients: Lighthouse, Prysm, Teku, Lodestar, Nimbus

**Installation:**
```bash
# Install via Go
go install github.com/flashbots/mev-boost@latest

# Or download pre-built binaries (Linux, macOS, Windows)
# from github.com/flashbots/mev-boost/releases
```

**Configuration:**
```bash
mev-boost \
  -mainnet \
  -relay-check \
  -relays "https://relay1.example.com,https://relay2.example.com" \
  -addr 127.0.0.1:18550
```

Key flags:
- `-mainnet` / `-sepolia` — Network selection
- `-relays` — Comma-separated list of relay URLs
- `-relay-check` — Verify relay connectivity on startup
- `-addr` — Listen address (default `127.0.0.1:18550`)
- `-min-bid` — (Optional) Minimum bid threshold; below this, fall back to local block building

**Production Deployment:**
- Run as a systemd service for process management
- Register with multiple relays for redundancy
- Configure consensus client to use MEV-Boost via the builder endpoint flag
- Verify registration by querying the relay's validator registration endpoint

**Verification:**
Confirm your validator is registered by checking the relay's validator endpoint for your `feeRecipient` address.

_Source: [MEV-Boost Usage](https://docs.flashbots.net/flashbots-mev-boost/getting-started/usage), [MEV-Boost System Requirements](https://docs.flashbots.net/flashbots-mev-boost/getting-started/system-requirements), [MEV-Boost GitHub](https://github.com/flashbots/mev-boost), [CoinCashew MEV-Boost Guide](https://www.coincashew.com/coins/overview-eth/mev-boost)_

### Relay Operator Setup

Running a relay is **permissionless** — anyone can operate one. The relay stack consists of three independently scalable components:

1. **API Services** — Handles proposer registrations, builder block submissions, and data requests
2. **Website** — Serves relay information and transparency data
3. **Housekeeper** — Background process that updates known validators and proposer duties (single instance only)

**Infrastructure Requirements:**
- One or more beacon nodes with SSE event support (particularly `head` and `payload_attributes` topics)
- Multiple beacon nodes specifiable via comma-separated list for redundancy
- Block simulation capabilities for verifying builder submissions
- PostgreSQL + Redis for data storage and caching
- Rate limiting infrastructure (600 submissions / 5 min / IP)

**Operational Responsibilities:**
- Validate and simulate builder block submissions
- Escrow blocks (store full content, serve only blinded headers to proposers)
- Maintain data transparency APIs
- Handle validator registrations at scale
- Ensure high availability (missed blocks = missed slots for proposers)

_Source: [Relay Fundamentals](https://docs.flashbots.net/flashbots-mev-boost/relay), [mev-boost-relay GitHub](https://github.com/flashbots/mev-boost-relay), [Flashbots Relay Mainnet](https://boost-relay.flashbots.net/)_

### Skills and Team Requirements

**For MEV Searcher Development:**

| Skill Area | Required Knowledge | Proficiency |
|---|---|---|
| Blockchain Fundamentals | Ethereum transaction lifecycle, gas mechanics, mempool dynamics | Deep |
| Smart Contracts | Solidity, EVM opcodes, contract interaction patterns | Deep |
| DeFi Protocols | AMM mechanics (Uniswap, Curve), lending protocols (Aave, Compound), liquidation flows | Deep |
| Programming | Rust (performance), Python (prototyping), JavaScript/TypeScript (ethers.js/viem) | Strong |
| Data Analysis | Statistical analysis, on-chain data querying, real-time event processing | Strong |
| Tooling | ethers.js/web3.py, Foundry/Hardhat, Flashbots client libraries | Moderate |
| Infrastructure | Low-latency node access, mempool monitoring, co-location considerations | Moderate |

**Reality Check on Profitability:**
- The searcher space is extremely competitive — well-funded teams with optimized bots and latency advantages dominate
- Most MEV opportunities are captured within milliseconds
- New entrants should expect a significant learning curve before profitability
- Off-chain processing is preferred over on-chain to reduce gas costs
- One developer's candid account: ["How I've Built an Unprofitable Crypto MEV Bot in Rust"](https://pawelurbanek.com/rust-mev-bot) illustrates the steep competition

**For Validator Operators:**
- MEV-Boost setup requires minimal additional expertise beyond standard validator operation
- Configuration is straightforward — install binary, point to relays, set fee recipient
- Main decision: which relays to trust and whether to set minimum bid thresholds

_Source: [Blocknative MEV Bot Guide](https://www.blocknative.com/blog/mev-and-creating-a-basic-arbitrage-bot-on-ethereum-mainnet), [CryptoMarketPool MEV Guide](https://cryptomarketpool.com/how-to-search-for-mev-opportunities/), [Flashbots Troubleshooting Guide](https://fifikobayashi.medium.com/beginners-guide-to-troubleshooting-mev-on-flashbots-aee175048858)_

### Risk Assessment and Mitigation

**For Users (Flashbots Protect):**
- **Risk**: Transactions in the public mempool are visible to frontrunners/sandwich bots
- **Mitigation**: Use Flashbots Protect RPC — zero-config, just change your wallet's RPC URL
- **Residual Risk**: Minimal — transactions bypass the mempool entirely

**For Validators (MEV-Boost):**
- **Risk**: Relay failure causes missed blocks (empty slots)
- **Mitigation**: Register with multiple relays; configure fallback to local block building with `-min-bid`
- **Risk**: Relay dishonesty (reporting incorrect block values)
- **Mitigation**: Use established relays with transparency track records; community monitoring via Relayscan

**For Searchers:**
- **Risk**: Bundle inclusion is not guaranteed — competitive auction
- **Mitigation**: Optimize strategies, use `revertingTxHashes` for fault tolerance, target multiple builders
- **Risk**: Strategy leakage — builders could front-run searcher bundles
- **Mitigation**: BuilderNet TEEs process bundles in encrypted enclaves; use MEV-Share for selective data sharing

**For the Ethereum Network:**
- **Risk**: Builder centralization threatens censorship resistance
- **Mitigation**: BuilderNet (decentralized TEE building), future enshrined PBS (EIP-7732)
- **Risk**: Relay centralization as single points of failure
- **Mitigation**: Multiple independent relay operators; enshrined PBS removes relay dependency entirely

_Source: [MEV-Boost Risks and Considerations](https://docs.flashbots.net/flashbots-mev-boost/architecture-overview/risks), [Understanding Liveness Risks](https://boost.flashbots.net/mev-boost-status-updates/understanding-liveness-risks-from-mev-boost)_

## Technical Research Recommendations

### Key Takeaways

1. **Flashbots has fundamentally reshaped Ethereum's block production** — MEV-Boost is the de facto standard, used by the majority of validators
2. **The MEV supply chain is a layered auction** — Users → Searchers → Builders → Relays → Proposers, with each layer having distinct roles and trust properties
3. **Builder centralization is the critical open problem** — Top 3 builders control ~86% of blocks; BuilderNet TEEs are the current response, enshrined PBS is the long-term solution
4. **MEV-Share redistributes value to users** — A meaningful step toward aligning MEV extraction with user interests
5. **The architecture is explicitly transitional** — MEV-Boost is designed as a bridge to in-protocol PBS; the relay trust assumption will eventually be eliminated

### For Users and Wallet Developers
- **Integrate Flashbots Protect** as the default RPC — simple URL swap, immediate frontrunning protection
- **Enable MEV-Share refunds** so users capture a share of MEV their transactions generate
- Consider **MEV-aware transaction routing** as a product differentiator

### For Validators
- **Run MEV-Boost** — straightforward setup, significant increase in staking rewards
- **Register with multiple relays** for redundancy and censorship resistance
- **Set a minimum bid threshold** to ensure fallback to local building when MEV is low

### For Developers Interested in MEV
- Start with **Flashbots' official tutorials** and example bots before building custom strategies
- Focus on **MEV-Share searching** — the protocol's hint system is where innovation is happening
- Be realistic about competition — the searcher space is mature and highly optimized
- **Rust** is the performance language of choice for production searchers; **Python** for prototyping

---

## Research Synthesis

### Executive Summary

Flashbots has become one of the most consequential infrastructure projects in the Ethereum ecosystem, fundamentally restructuring how blocks are produced through Proposer-Builder Separation (PBS). What began as a research initiative to mitigate the negative externalities of Maximal Extractable Value (MEV) — frontrunning, sandwich attacks, and gas price auctions that extracted over $1.2 billion from users — has evolved into the de facto standard for Ethereum block production. MEV-Boost, Flashbots' open-source middleware, is used by the majority of validators, while Flashbots Protect shields millions of transactions from mempool predators.

However, the MEV supply chain has created a new centralization challenge: the top 3 block builders now control approximately 86% of Ethereum's block production, sustained by a self-reinforcing feedback loop between private orderflow access and block win rates. Flashbots' response — BuilderNet, a decentralized TEE-based block building network launched in late 2024 — represents the most ambitious effort yet to break this concentration. Looking further ahead, Enshrined PBS (EIP-7732) aims to integrate proposer-builder separation directly into Ethereum's consensus layer, eliminating the relay trust assumption entirely, though it remains 1+ years from mainnet and carries its own centralization risks.

**Key Technical Findings:**

- MEV-Boost implements out-of-protocol PBS via a commit-reveal scheme with trusted relays — a deliberate architectural trade-off for privacy over liveness guarantees
- Builder centralization (top 5 = ~99% of blocks) is driven by exclusive orderflow feedback loops and high barriers to entry (~1.4 ETH subsidy for new entrants)
- BuilderNet uses Intel TDX TEEs to process orderflow in encrypted enclaves, preventing even operators from inspecting transactions — fully operational since December 2024
- MEV-Share's SSE-based hint system creates a programmable privacy layer where users control what searchers can see about their transactions
- rbuilder (Rust) replaced the Go-based builder in production, reflecting the ecosystem's shift toward latency-optimized infrastructure
- SUAVE remains in alpha — the long-term vision for fully decentralized, cross-chain block building
- Flashnet, an anonymous broadcast protocol, is planned to further reduce latency and enhance censorship resistance in the BuilderNet pipeline
- L2 integration via Rollup-Boost will extend BuilderNet's decentralized block building to rollups like Unichain

**Strategic Recommendations:**

1. **For users/wallets**: Adopt Flashbots Protect RPC as default — zero-config frontrunning protection with MEV refunds
2. **For validators**: Run MEV-Boost with multiple relays and a minimum bid threshold for resilience
3. **For searchers**: Focus on MEV-Share's hint-based searching; expect steep competition from established players
4. **For protocol designers**: Study Flashbots' architectural evolution (auction design, TEE integration, relay trust model) as a reference for any system mediating transaction ordering
5. **For the ecosystem**: Monitor the ePBS research trajectory — EIP-7732's "free option problem" and potential to amplify Gini inequality (0.17→0.84) are open concerns

### Table of Contents

1. [Technology Stack Analysis](#technology-stack-analysis) — MEV problem, PBS architecture, MEV-Boost, Flashbots Protect, MEV-Share, BuilderNet, SUAVE, adoption trends
2. [Integration Patterns Analysis](#integration-patterns-analysis) — Searcher Bundle API, Builder API, MEV-Share Event Stream, client libraries, data transparency APIs, security patterns
3. [Architectural Patterns and Design](#architectural-patterns-and-design) — MEV supply chain architecture, trust model trade-offs, builder centralization, rbuilder, Enshrined PBS, deployment operations
4. [Implementation Approaches](#implementation-approaches-and-technology-adoption) — Searcher onboarding, validator setup, relay operations, skills matrix, risk assessment
5. [Technical Recommendations](#technical-research-recommendations) — Key takeaways and actionable guidance

### Future Technical Outlook

**Near-term (2025-2026):**
- BuilderNet operator onboarding expands beyond Flashbots/Beaverbuild/Nethermind
- Flashnet anonymous broadcast protocol deployment
- Rollup-Boost brings decentralized block building to L2s (Unichain first)
- MEV-Share adoption grows as wallets integrate refund mechanisms

**Medium-term (2026-2028):**
- Enshrined PBS (EIP-7732) moves through specification finalization and client implementation
- SUAVE progresses from alpha toward production cross-chain MEV infrastructure
- TEE technology (Intel TDX) matures with improved attestation and performance

**Long-term (2028+):**
- In-protocol PBS eliminates relay trust assumptions entirely
- Cross-chain MEV coordination becomes standardized
- Blockspace markets evolve beyond simple auction mechanisms toward more sophisticated allocation

_Source: [Flashbots.net](https://www.flashbots.net), [MEV and the Limits of Scaling](https://writings.flashbots.net/mev-and-the-limits-of-scaling), [Blockworks: BuilderNet](https://blockworks.co/news/flashbots-block-building-network-mev), [The Block: BuilderNet](https://www.theblock.co/post/328457/flashbots-unveils-buildernet-to-combat-centralization-in-ethereums-block-building)_

### Research Methodology and Sources

**Research Approach:**
- Comprehensive web search across official Flashbots documentation, GitHub repositories, academic papers (arXiv), Ethereum research forums (ethresear.ch), and industry analysis
- Multi-source verification for all quantitative claims (market share statistics, dollar figures, timeline dates)
- Cross-referencing official docs with community forums (collective.flashbots.net) and third-party analysis

**Primary Sources:**
- [Flashbots Official Documentation](https://docs.flashbots.net/) — Architecture specs, API reference, guides
- [Flashbots GitHub Organization](https://github.com/flashbots) — mev-boost, mev-boost-relay, rbuilder, mev-share, suave-specs
- [Flashbots Writings](https://writings.flashbots.net/) — Technical blog posts and announcements
- [Ethereum.org](https://ethereum.org/roadmap/pbs) — PBS roadmap and MEV documentation
- [EIP-7732](https://eips.ethereum.org/EIPS/eip-7732) — Enshrined PBS specification draft

**Academic Sources:**
- [Who Wins Ethereum Block Building Auctions and Why?](https://arxiv.org/abs/2407.13931) — Builder market dynamics
- [Decentralization of Ethereum's Builder Market](https://arxiv.org/abs/2405.01329) — Centralization analysis
- [SoK: Current State of Ethereum's Enshrined PBS](https://arxiv.org/abs/2506.18189) — ePBS research survey
- [Private Order Flows and Builder Bidding Dynamics](https://arxiv.org/html/2410.12352) — Orderflow centralization

**Confidence Level:** High — all core claims verified against official documentation and multiple independent sources. Builder market share statistics cross-referenced across academic papers and industry reports.

---

**Technical Research Completion Date:** 2026-03-30
**Research Period:** Comprehensive technical analysis covering Flashbots ecosystem through March 2026
**Source Verification:** All technical facts cited with current sources
**Technical Confidence Level:** High — based on multiple authoritative technical sources

_This comprehensive technical research document serves as an authoritative reference on Ethereum Flashbots and provides strategic insights for understanding MEV infrastructure, block production economics, and the evolution of Ethereum's transaction ordering mechanisms._

