# Protocol

TOON Protocol extends [Nostr](https://github.com/nostr-protocol/nips) with custom event kinds for ILP peering and uses [TOON format](https://github.com/toon-format/toon) encoding for efficient data transport.

## Event Kinds

### ILP Peering

| Kind | Name | Type | Purpose |
|------|------|------|---------|
| **10032** | ILP Peer Info | Replaceable | Advertise node's ILP address, BTP endpoint, supported chains, settlement addresses, and TokenNetwork contracts |

Kind 10032 is a [replaceable event](https://github.com/nostr-protocol/nips/blob/master/01.md) — publishing a new one with the same `d` tag replaces the old one. It serves as a node's business card: what chains it supports, where to settle, how to connect, and what it charges to forward traffic.

**Example kind:10032 content:**

```json
{
  "ilpAddress": "g.toon.a1b2c3d4",
  "btpEndpoint": "ws://node-a.example.com:3000",
  "feePerByte": "2",
  "supportedChains": ["evm:arbitrum-sepolia:421614"],
  "settlementAddresses": { "evm:arbitrum-sepolia:421614": "0xABC..." },
  "tokenNetworks": { "evm:arbitrum-sepolia:421614": "0x733..." }
}
```

#### Mill swap recipient key discovery

A `mill` node (the multi-chain swap peer) is the one case where the kind:10032
`pubkey` is operationally load-bearing for clients beyond peering. A
`streamSwap` caller must NIP-59 **gift-wrap** the swap request to the mill, and
the recipient pubkey it encrypts to (passed as `millPubkey`) is exactly the
`pubkey` advertised in the mill's kind:10032 IlpPeerInfo event.

That key is derived from the mill's **`MILL_MNEMONIC`** (the operator's BIP-39
identity), via `fromMnemonic(mnemonic)`. It is the SAME identity the mill uses
as the swap-handler gift-wrap recipient (`recipientSecretKey`) and the SAME key
that signs the kind:10032 event — so a client that reads `pubkey` from the
advertised peer-info is guaranteed to target the correct key.

> **Important:** the swap recipient key is the `MILL_MNEMONIC` identity, which
> is **distinct** from the node's `NODE_NOSTR_SECRET_KEY`-derived nostr
> identity. Encrypting a swap request to the `NODE_NOSTR_SECRET_KEY` pubkey
> fails with `F01/F00 "Invalid gift wrap"`. Always discover the recipient from
> the mill's kind:10032 `pubkey` (or the `swapRecipientPubkey` field of the
> mill's `mill_ready` startup log) — never from `NODE_NOSTR_SECRET_KEY`.

### NIP-34: Git Operations (Payment-Gated)

| Kind | Name | Purpose |
|------|------|---------|
| **30617** | Repository Announcement | Advertise Git repositories |
| **1617** | Patch | Submit code changes (paid via ILP) |
| **1621** | Issue | Create issues (paid via ILP) |
| **1622** | Reply | Comment on patches/issues (paid via ILP) |

NIP-34 events are payment-gated — submitting a patch requires micropayments via ILP. Repository owners earn revenue from contributions.

**Learn more:** [NIP-34 Specification](https://github.com/nostr-protocol/nips/blob/master/34.md)

## TOON Format

[TOON](https://github.com/toon-format/toon) is a compact, human-readable encoding of the JSON data model. TOON Protocol uses it natively throughout the entire stack — from ingestion to storage to delivery.

**Why TOON over JSON?**

- 5-10% smaller for typical Nostr events
- Human-readable `key: value` syntax
- LLM-optimized for token efficiency
- Validated before payment — prevents storing garbage data
- Deterministic round-trips preserve all data

**Example comparison:**

```yaml
# TOON format (327 bytes)
id: aaaa...aaaa
pubkey: bbbb...bbbb
kind: 1
content: gm
tags[0]:
created_at: 1234567890
sig: cccc...cccc
```

```json
// JSON format (344 bytes)
{"id":"aaaa...aaaa","pubkey":"bbbb...bbbb","kind":1,"content":"gm","tags":[],"created_at":1234567890,"sig":"cccc...cccc"}
```

**Event lifecycle — TOON all the way:**

1. Client encodes event to TOON text → UTF-8 bytes → ILP packet data
2. BLS decodes UTF-8 → parses TOON → verifies signature → checks payment → stores as TOON in SQLite
3. Relay reads TOON from disk → sends TOON to WebSocket subscribers
4. No JSON round-trips at any stage

## ILP Address Hierarchy

### Identity, Address, and Route

These three concepts are distinct. Confusing them is the most common source of misunderstanding in the protocol.

| Concept | What it is | Lifetime | Example |
|---------|-----------|----------|---------|
| **Identity** | Nostr pubkey (secp256k1) | Permanent — one per agent | `a1b2c3d4e5f6...` (64-char hex) |
| **Address** | ILP address — how to reach a node through a specific peer | Ephemeral — one per upstream peering | `g.toon.a1b2c3d4` |
| **Route** | Dynamic advertisement — which paths exist in the network | Changes as peers join/leave | Advertised in kind:10032 events |

An agent has **one identity** but may have **multiple addresses** if it peers with multiple upstream nodes. Each address represents a path through the network, not the node itself. Think of it like having one name but multiple phone numbers from different carriers.

### Address Derivation

ILP addresses are derived deterministically from the peering topology. No manual configuration needed.

**Rules:**

1. The **root prefix** is `g.toon` — this is a protocol constant. The genesis node IS `g.toon`.
2. When a node connects to an upstream peer, the upstream assigns a child address: the upstream's own prefix plus the first 8 characters of the connecting node's Nostr pubkey.
3. If a node peers with multiple upstream nodes, it receives a separate address from each one.

**Example network:**

```
Genesis node (g.toon)
├── Node A connects → assigned g.toon.a1b2c3d4
│   ├── Node C connects to A → assigned g.toon.a1b2c3d4.c9d8e7f6
│   └── Node D connects to A → assigned g.toon.a1b2c3d4.d4e5f6a7
└── Node B connects → assigned g.toon.b5c6d7e8
    └── Node C also connects to B → assigned g.toon.b5c6d7e8.c9d8e7f6
```

Node C has two addresses — one through A, one through B. Both are valid paths to reach it. The address tells senders *which route* to use, not *who* the destination is.

**Why 8 characters?** The first 8 hex characters of a Nostr pubkey provide 4 billion possible values — enough to be collision-resistant within any single peer's address space while keeping addresses short and human-scannable.

### Vanity Prefixes

Peers can claim human-readable prefixes from their upstream node by paying for them. Instead of `g.toon.a1b2c3d4`, a node might claim `g.toon.useast` or `g.toon.btc`. This creates a domain-registrar business model where upstream nodes earn revenue from prefix sales.

Vanity prefix claims use a dedicated Nostr event kind (not DVM kinds) because they are **stateful control-plane operations** — they mutate the routing topology and persist.

### Fee Advertisement

Each node advertises a `feePerByte` in its kind:10032 peer info event. This tells the network how much the node charges to forward a byte of data through it.

**Example kind:10032 with fee advertisement:**

```json
{
  "ilpAddress": "g.toon.a1b2c3d4",
  "btpEndpoint": "ws://node-a.example.com:3000",
  "feePerByte": "2",
  "supportedChains": ["evm:arbitrum-sepolia:421614"],
  "settlementAddresses": { "evm:arbitrum-sepolia:421614": "0xABC..." },
  "tokenNetworks": { "evm:arbitrum-sepolia:421614": "0x733..." }
}
```

## Protocol Economics

### One Primitive: Message = Money

Every monetized action in TOON Protocol follows the same pattern: **the message and the payment travel in a single ILP PREPARE packet.** There is no separate payment step. The packet IS the payment.

This applies to all three monetized flows:

| Flow | What's advertised | Where it's advertised | What the sender pays |
|------|------------------|----------------------|---------------------|
| **Relay write** | Price per byte | kind:10035 `basePricePerByte` | Event size in bytes × price per byte |
| **DVM compute** | Job price | kind:10035 `SkillDescriptor.pricing` | The provider's advertised price |
| **Prefix claim** | Prefix price | kind:10032 `prefixPricing` | The upstream's advertised prefix price |

One protocol primitive. Three use cases. The pattern is always: provider advertises a price, customer sends data + payment in one packet, provider validates and processes.

### Multi-Hop Fee Calculation

When a message travels through intermediary nodes, each one takes a forwarding fee. The total cost to the sender is:

> **Total = destination write fee + sum of each intermediary's fee-per-byte × packet size**

The SDK computes this automatically. Callers never see individual hop fees — they experience a single total cost.

**Example: 3-hop delivery of a 500-byte event**

```
Sender → Node A (2/byte fee) → Node B (3/byte fee) → Destination (10/byte write price)

Destination write fee:  500 bytes × 10 per byte = 5,000
Node B forwarding fee:  500 bytes ×  3 per byte = 1,500
Node A forwarding fee:  500 bytes ×  2 per byte = 1,000
                                          ─────────────
Total paid by sender:                           7,500
```

The sender pays 7,500 in a single ILP PREPARE. Each intermediary deducts its fee and forwards the remainder. The destination receives exactly its write fee.

### Supply-Driven Marketplace

The TOON Protocol marketplace is **supply-driven**: providers advertise their capabilities and pricing, customers discover providers, compare offerings, and send paid requests directly. Prices in advertisements are authoritative — not negotiation starting points.

This applies to both DVM compute (providers list skills and prices in kind:10035) and prefix claims (upstream nodes list prefix pricing in kind:10032).

### Pricing at the Destination

Each destination node sets its own base price per byte for storing events. The default is 10 micro-USDC per byte (roughly $0.01 per kilobyte). Nodes can override pricing for specific event kinds — for example, making kind:0 (profile metadata) free while charging a premium for kind:30023 (long-form content).

- **Self-write bypass**: Events signed by the node owner's own pubkey are free
- **Per-kind overrides**: A JSON map of event kind numbers to custom per-byte prices

## ILP Integration

### Payment Flow

Writers embed TOON-encoded events in ILP PREPARE packets. The relay validates payment and returns an ILP FULFILL as proof of storage.

```
Writer                    ILP Network                 Relay
  │                           │                         │
  │  PREPARE                  │                         │
  │  { dest, amount, data }   │                         │
  │ ────────────────────────>│──────────────────────>  │
  │                           │                         │  validate + store
  │  FULFILL                  │                         │
  │  { fulfillment, data }    │                         │
  │ <────────────────────────│<──────────────────────  │
```

### Multi-Hop Payment Flow

When the destination is multiple hops away, each intermediary deducts its fee and forwards:

```
Sender          Node A            Node B            Destination
  │               │                 │                    │
  │  PREPARE      │                 │                    │
  │  amount=7500  │                 │                    │
  │ ────────────>│  PREPARE        │                    │
  │               │  amount=6500   │                    │
  │               │ ──────────────>│  PREPARE           │
  │               │                 │  amount=5000      │
  │               │                 │ ─────────────────>│
  │               │                 │                    │ validate + store
  │               │                 │  FULFILL           │
  │               │  FULFILL        │<─────────────────│
  │  FULFILL      │<──────────────│                    │
  │<────────────│                 │                    │
  │               │                 │                    │
  │  Node A kept: 1000 (fee)       │                    │
  │               │  Node B kept: 1500 (fee)            │
  │               │                 │  Dest kept: 5000 (write fee)
```

### Validation Pipeline

Every incoming packet passes through five stages in order:

1. **Size check** — Reject if payload > 1MB (DoS protection)
2. **Shallow TOON parse** — Extract routing metadata without full decode
3. **Signature verification** — Schnorr signature check (skipped in dev mode)
4. **Pricing validation** — Verify payment meets per-byte requirement
5. **Handler dispatch** — Route to registered handler by event kind

Failure at any stage produces an ILP REJECT:

| Error Code | Meaning |
|------------|---------|
| F04 | Insufficient payment |
| F06 | Invalid signature or payload |
| F08 | Payload too large |
| T00 | Internal handler error |

## Related Specifications

### Nostr
- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md) — Base relay protocol
- [NIP-34: Git Stuff](https://github.com/nostr-protocol/nips/blob/master/34.md) — Git operations via Nostr
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md) — Encrypted messaging

### Interledger
- [RFC 0027: ILPv4](https://interledger.org/developers/rfcs/interledger-protocol-v4/) — Core protocol
- [RFC 0032: Peering, Clearing and Settlement](https://interledger.org/developers/rfcs/peering-clearing-settling/) — Peering model
- [RFC 0035: ILP Over HTTP](https://interledger.org/developers/rfcs/ilp-over-http/) — HTTP transport
