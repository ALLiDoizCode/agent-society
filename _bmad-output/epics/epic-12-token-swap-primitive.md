# Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps

**Status:** PLANNED
**Date:** 2026-04-09
**Origin:** Party Mode brainstorm session (2026-04-09)
**Decision Record:** Party mode discussion — token swapping via ILP packet streaming with NIP-59 privacy

---

## Goal

Enable non-custodial, privacy-preserving token swaps between any asset pairs by leveraging the existing ILP micropayment infrastructure. Swap-capable peers advertise supported token pairs via an optional `swapPairs` field on `IlpPeerInfo` (kind:10032). Clients send NIP-59 gift-wrapped ILP packets carrying value in the source asset; the swap connector returns signed claims in the target asset via the FULFILL response. Swaps happen over sender-chosen packet counts — a $1,000 swap can flow as 3 packets or 30,000 packets, entirely at the sender's discretion.

---

## Key Design Decisions

**D12-001: Swaps are not a new protocol operation.** A swap is just sending ILP packets to a connector that settles in a different asset. No new event kinds. No new handshake. The connector receives value on one side and issues signed claims on the other. The ILP packet is agnostic to whether a swap is happening.

**D12-002: Optional `swapPairs` field on `IlpPeerInfo`.** Peers that facilitate swaps advertise their supported pairs and rates in the existing kind:10032 peer info event. Peers without `swapPairs` behave exactly as today. No protocol-level change, no breaking change.

**D12-003: NIP-59 gift-wrapped swap packets.** All swap packets MUST be NIP-59 gift-wrapped to prevent information leakage. Each packet uses a fresh ephemeral key. Intermediary peers routing the ILP packet see opaque TOON-encoded binary in the data field — they cannot determine the event kind, sender identity, or swap intent. Only the destination connector unwraps and processes.

**D12-004: Sender controls packet granularity.** The protocol defines the primitive: one packet in, one signed claim out. The sender decides how to chunk a swap — packet count and size are client-side decisions based on risk tolerance, connector trust, and speed preference.

**D12-005: Signed claims in FULFILL, not on-chain transfers.** The connector returns signed payment channel claims in the target asset via the ILP FULFILL data field. No on-chain transactions occur during the swap. The sender accumulates claims and settles on-chain in a single transaction when ready.

**D12-006: Live rate per packet.** Connectors apply the current exchange rate to each packet independently. If the rate moves, the sender sees it in the claim amounts returned in each FULFILL and can stop sending at any time. No rate locking, no commitment beyond the current packet.

**D12-007: Connector is a market maker.** Rate management, inventory balancing, and spread pricing are connector operator concerns, not protocol concerns. Different operators compete on execution quality. The protocol stays thin.

---

## Architecture

### Swap Flow

```
1. Discovery
   Sender queries kind:10032 events, filters peers with swapPairs field
   matching desired asset pair (e.g., USDC → ETH)

2. Packet Construction (per packet)
   Inner rumor (unsigned): swap metadata (optional, for connector context)
       ↓
   Seal (kind:1060): NIP-44 encrypt rumor with sender privkey → connector pubkey
       ↓
   Gift wrap (kind:1059): NIP-44 encrypt seal with ephemeral key → connector pubkey
       ↓
   encodeEventToToon() → TOON binary
       ↓
   buildIlpPrepare() → ILP PREPARE (destination: connector address, amount: source asset value)

3. Routing
   connector.sendPacket() → multi-hop ILP routing
   Intermediary peers see: ILP packet with destination + opaque data. Nothing else.

4. Processing (at destination connector)
   Connector unwraps: gift wrap → seal → rumor
   Applies exchange rate to ILP amount
   Issues signed payment channel claim in target asset

5. Fulfillment
   ILP FULFILL returned with signed claim in data field
   (Gift-wrapped back to sender for return-path privacy)

6. Repeat
   Sender sends as many packets as desired at whatever size they choose
   Each packet is independent — its own ephemeral key, its own claim

7. Settlement
   Sender settles accumulated claims on-chain in a single transaction
```

### Privacy Properties

| Party | Visibility |
|-------|-----------|
| Sender | Full knowledge (constructed the swap) |
| Intermediary peers | ILP destination address + opaque TOON binary. No event kind, no sender identity, no amount details beyond ILP packet header |
| Swap connector | Unwrapped rumor + ILP amount. Knows sender pubkey (from seal). Cannot prove it to third parties (rumor is unsigned — plausible deniability) |
| On-chain observers | Nothing until settlement. Single channel settlement tx with no link to swap flow |

### IlpPeerInfo Extension

```typescript
export interface IlpPeerInfo {
  // ... existing fields ...

  /** Token pairs this peer can swap, with current rates. Absent = no swap support. */
  swapPairs?: SwapPair[];
}

export interface SwapPair {
  /** Source asset */
  from: { assetCode: string; assetScale: number; chain: string };
  /** Target asset */
  to: { assetCode: string; assetScale: number; chain: string };
  /** Exchange rate as decimal string (target units per source unit) */
  rate: string;
  /** Minimum swap amount per packet in source asset micro-units (optional) */
  minAmount?: string;
  /** Maximum swap amount per packet in source asset micro-units (optional) */
  maxAmount?: string;
}
```

### Risk Model

- **Per-packet exposure:** If connector disappears mid-swap, sender loses at most one packet's value. All previous claims are signed and settleable.
- **Rate drift:** Sender monitors claim amounts in each FULFILL. Stops sending if rate deteriorates beyond tolerance. No locked funds.
- **MEV protection:** No on-chain footprint until settlement. No mempool visibility. Front-running is impossible.
- **Plausible deniability:** NIP-59 unsigned rumor means connector cannot cryptographically prove who initiated a swap.

---

## Package Structure

New package: `packages/mill/` (`@toon-protocol/mill`) — the swap peer. Provides `createSwapHandler()` and `startMill()` entrypoint. Built on `@toon-protocol/sdk` + `@toon-protocol/core`. A Mill node is a standalone ILP peer that facilitates token swaps — separate from `packages/town/` (relay peer) and `packages/bridge/` (bridge peer). Operators choose which peer type(s) to run. A single node can combine roles (Town + Mill + Bridge) via the shared handler registry.

## Dependencies

- Existing ILP packet routing infrastructure (Epic 1-3)
- NIP-44 / NIP-59 encryption primitives (implemented in nostr-tools)
- Payment channel infrastructure (`openChannel()`, `getChannelState()`) (Epic 3)
- Multi-chain settlement negotiation (`negotiateSettlementChain()`) (Epic 3)
- `IlpPeerInfo` and kind:10032 event builders/parsers (Epic 1)

---

## Scope

**In scope:**
- `SwapPair` type definition and `IlpPeerInfo.swapPairs` optional field
- kind:10032 builder/parser updates for `swapPairs` serialization
- NIP-59 gift wrap encoding/decoding for swap packets in SDK
- Swap connector handler: unwrap, rate conversion, signed claim issuance in FULFILL
- Client-side `streamSwap()` API: packet chunking, claim accumulation, rate monitoring, pause/stop
- Claim extraction from FULFILL data field
- Unit tests, integration tests for swap flow
- Provider handoff documentation for swap connector operators

**Out of scope:**
- Specific exchange rate oracle integrations (connector operator concern)
- Inventory management strategies (connector operator concern)
- UI/wallet integration
- Cross-chain payment channel contract deployments (uses existing TokenNetwork contracts per chain)

---

## Estimated Complexity

**L** (6-8 stories estimated)

Key stories:
1. `SwapPair` type + `IlpPeerInfo` extension + kind:10032 serialization
2. NIP-59 gift wrap integration for ILP packets (encode + decode)
3. Swap connector handler (unwrap → rate conversion → claim issuance)
4. Client-side `streamSwap()` API with chunking + claim accumulation
5. FULFILL signed claim encoding/extraction
6. Rate advertisement and discovery via peer info
7. Integration tests: end-to-end swap flow through connector
8. Provider handoff documentation for swap connector operators

---

## Composition Pattern: Token Swap + Chain Bridge = Zero-Token Cross-Chain Onboarding

When Epic 13 (Chain Bridge) is complete, Token Swap and Chain Bridge compose to solve the cold-start problem for cross-chain onboarding:

**Problem:** Alice holds USDC on Arbitrum and wants MINA on Mina Protocol. She has zero MINA — can't even pay gas to settle a channel claim on Mina.

**Solution (Token Swap + Chain Bridge):**

1. **Token Swap (Epic 12):** Alice sends gift-wrapped USDC ILP packets to a swap connector. Connector returns signed MINA channel claims in each FULFILL. Alice now holds MINA claims but has no MINA in a wallet — the claims are off-chain.
2. **Chain Bridge (Epic 13, kind:5260):** Alice sends the MINA channel settlement transaction to a Chain Bridge DVM — pays the bridge provider **in USDC via ILP**. The provider pays Mina gas, broadcasts the settlement tx. Alice receives MINA in her Mina address.

**Result:** Alice goes from holding one asset on one chain to holding any asset on any chain **without ever needing native gas tokens**. Zero on-chain transactions until the final settlement. The entire cross-chain flow is private (gift-wrapped ILP packets).

**Why this matters:**
- No centralized exchange needed for cross-chain asset acquisition
- No native gas tokens needed on the destination chain
- MEV-immune: no mempool visibility until final settlement
- The sender pays for everything (swap spread + bridge fee) in their original asset via ILP

**Implementation note:** This composition pattern should be explicitly tested when Chain Bridge (Epic 13) stories are decomposed. The "settle swap claims via Chain Bridge" flow is a first-class use case, not an afterthought.

---

## Network Primitive Status

Token swaps are **not** a fifth network primitive. They are an emergent property of multi-asset connectors joining the ILP routing network. The four network primitives remain: Messaging, Blob Storage, Compute, Chain Bridge. Swaps leverage the existing ILP value transfer layer with multi-asset settlement — the connector is the swap engine.
