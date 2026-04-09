# Epic 13: Chain Bridge Primitive — Provider Protocol & DX (kind:5260)

**Status:** PLANNED
**Epic ID:** 13
**Date:** 2026-03-22 (Network Primitives Strategy), reordered 2026-04-09
**Decision source:** Party Mode 2026-03-22 — Network Primitives Strategy (D8-PM-003, D8-PM-006, D8-PM-008); Party Mode 2026-03-23 — Provider Protocol Model

---

## Goal / Objective

Define the chain bridge provider protocol, refine the consumer DX, and ship provider handoff documents. **Provider implementations are out of scope** — per-chain bridge operators build their own providers. Same model as Epic 14 (Compute): TOON defines the marketplace, providers integrate.

---

## Ordering Rationale

Chain Bridge (Epic 13) is positioned immediately after Token Swap (Epic 12) because the two compose for **zero-token cross-chain onboarding**: a user swaps for tokens on a chain they've never used (Epic 12), then uses a Chain Bridge DVM to broadcast the settlement transaction (Epic 13), paying the bridge provider in their original asset via ILP. The user never needs native gas tokens on the destination chain. See Epic 12 spec for full composition pattern.

---

## Scope — What TOON ships

1. **Provider Protocol Specification** — Definitive doc for "how to build a TOON chain bridge provider": kind:5260 request format, kind:6260 result format, Tier 1 trustless broadcast semantics, multi-chain packet format, per-chain receipt tags, chain-specific pricing.
2. **Reference DVM Implementation** — A working Chain Bridge DVM handler (`createChainBridgeDvmHandler()`) that a peer operator can register on their node to provide chain bridge services for supported chains. Uses a pluggable chain adapter pattern — each supported chain implements a `ChainAdapter` interface (broadcast tx, estimate gas, format receipt). Ships with adapters for:
   - **EVM** (Ethereum, Arbitrum, Base) — via viem
   - **Mina** — via o1js (critical for Token Swap claim settlement + Overmind VRF)
   - **Solana** — via @solana/web3.js
   - **AO** — via HyperBEAM node interaction
3. **Provider Test Harness** — Validates tx broadcast handling, per-chain receipt format, multi-chain packet parsing, SkillDescriptor chain-specific pricing. Tests the reference implementation and any third-party adapters.
4. **Consumer SDK Refinements** — Consumer DX for chain bridge: tx submission, receipt verification, multi-chain result parsing, chain discovery by SkillDescriptor features.
5. **DVM Event Kind Definitions** — Finalize kind:5260/6260 schemas.
6. **Operator Documentation** — How to spin up a peer that provides chain bridge services: configuration, chain adapter selection, wallet/key management, gas funding, pricing strategy.

---

## Key Design Decisions

- **Tier 1 only** for initial implementation: trustless broadcast. Provider cannot steal funds — only submit or not submit.
- **Multi-chain in one packet:** `['param', 'chains', 'ethereum,arbitrum,base,mina,ao']`. Receipt has per-chain tags.
- **AO is a blockchain target, not a compute backend.** Provider has AO wallet/HyperBEAM node, pays p4 fee, returns slot receipt.
- **Future tiers deferred:** Tier 2 (construct + broadcast), Tier 3 (custodial execute with TEE) have significant security implications.
- **Chain-specific pricing** in SkillDescriptor (different gas costs per chain).
- **Reference DVM implementation ships with TOON** — unlike Compute (Epic 14) where providers build their own, Chain Bridge ships a working DVM handler with pluggable chain adapters. Operator spins up a peer, registers the handler, funds wallets, and serves bridge requests. Third-party teams can still build custom adapters for chains TOON doesn't ship.

---

## Package Structure

New package: `packages/bridge/` (`@toon-protocol/bridge`) — the bridge peer. Provides `createChainBridgeDvmHandler()` and `startBridge()` entrypoint. Built on `@toon-protocol/sdk` + `@toon-protocol/core`. A Bridge node is a standalone ILP peer that broadcasts signed transactions to supported blockchains — separate from `packages/town/` (relay peer) and `packages/mill/` (swap peer). Operators choose which peer type(s) to run. A single node can combine roles via the shared handler registry.

## Dependencies

- Epic 8 (self-describing receipt pattern)
- Epic 5 (DVM event kinds)
- Epic 3 (multi-chain config)
- Epic 12 (Token Swap — composition pattern for swap claim settlement)

---

## Composition with Token Swap (Epic 12)

The "settle swap claims via Chain Bridge" flow is a first-class use case:

1. User swaps Asset A → Asset B via Token Swap (gift-wrapped ILP packets, signed claims returned)
2. User sends the settlement tx (spending accumulated claims) to a Chain Bridge DVM
3. Chain Bridge provider broadcasts the settlement tx on the destination chain, pays gas
4. User receives Asset B in their wallet — never needed native gas tokens

This flow MUST be explicitly tested as part of Chain Bridge E2E validation.

---

## Stories

**Phase 1: Protocol Foundation**
- 13.1: Chain Bridge DVM Event Kind Definitions (kind:5260/6260)
- 13.2: Tier 1 Trustless Broadcast Protocol Spec
- 13.3: Multi-Chain Packet Format + Per-Chain Receipt Tags

**Phase 2: Reference DVM Implementation**
- 13.4: ChainAdapter Interface + EVM Adapter (Ethereum/Arbitrum/Base via viem)
- 13.5: Mina Chain Adapter (o1js — zkApp tx broadcast + slot receipts)
- 13.6: Solana Chain Adapter (@solana/web3.js)
- 13.7: AO Chain Adapter (HyperBEAM node interaction)
- 13.8: Chain Bridge DVM Handler (`createChainBridgeDvmHandler()`) — pluggable adapter registry, gas funding, pricing

**Phase 3: Consumer DX**
- 13.9: Consumer SDK — TX Submission + Receipt Verification
- 13.10: Chain Bridge SkillDescriptor with Chain-Specific Pricing

**Phase 4: Validation & Operations**
- 13.11: Provider Test Harness (validates reference impl + third-party adapters)
- 13.12: Operator Documentation (spin up a chain bridge peer, configure adapters, fund wallets)
- 13.13: Integration Tests — Token Swap claim settlement via Chain Bridge (Epic 12 composition)
- 13.14: Publish Chain Bridge Primitive

---

## Estimated Complexity

**XL** (14 stories — includes reference DVM implementation with 4 chain adapters)

---

## FRs Covered

FR-BRIDGE-1, FR-BRIDGE-2, FR-BRIDGE-3, FR-BRIDGE-4, FR-BRIDGE-5, FR-BRIDGE-6 (reframed as protocol spec, not implementation), FR-BRIDGE-7
