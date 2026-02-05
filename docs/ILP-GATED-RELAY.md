# ILP-Gated Nostr Relay Protocol

This document specifies how agents act as both ILP connectors and Nostr relays, using payments to gate event storage and the social graph to derive routing topology.

## Core Concept

**Every agent is a Nostr relay. Writes cost money. Reads are free.**

```
┌─────────────────────────────────────────────────────────────┐
│                   AGENT = RELAY + CONNECTOR                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ILP CONNECTOR                                       │    │
│  │   - Routes ILP packets through the network          │    │
│  │   - Peers derived from NIP-02 follow list           │    │
│  │   - Routing table: direct peers + propagated routes │    │
│  │   - Takes routing fee for forwarded packets         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ NOSTR RELAY                                         │    │
│  │   - Stores Nostr events in local database           │    │
│  │   - WRITE: Requires ILP payment (paid)              │    │
│  │   - READ: Standard NIP-01 WebSocket (free)          │    │
│  │   - SELF: Agent's own events bypass payment         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ILP Address: g.agent.<pubkey-or-identifier>                │
└─────────────────────────────────────────────────────────────┘
```

## Problems Solved

1. **Relay spam**: Every stored event costs money. No free writes = no spam.
2. **Relay business model**: Storage is funded by micropayments from authors.
3. **Peer discovery**: NIP-02 follow list defines who you peer with.
4. **Payment routing**: Social graph topology becomes payment routing topology.

## Write Path (Paid)

Authors pay to store events on relays. Payment and event are sent together in a single ILP packet.

### Event Transport: ILP Packet + TOON

Events are encoded using [TOON format](https://toonformat.dev) (Token-Oriented Object Notation) - a compact, JSON-compatible encoding that minimizes bytes.

```
┌─────────────────────────────────────────────────────────────┐
│ ILP Prepare Packet                                          │
│                                                             │
│   destination: g.agent.bob                                  │
│   amount: 50000 (units)                                     │
│   condition: SHA256(preimage)                               │
│   data: <TOON-encoded Nostr event>                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Why TOON?**
- Compact encoding reduces bytes (and cost, if priced per-byte)
- Lossless JSON round-trip (Nostr events are JSON)
- Well-specified with implementations in multiple languages

**Why raw ILP packets (not STREAM)?**
- Nostr events are small (typically < 10KB)
- Single packet is sufficient
- Condition/fulfillment proves delivery
- Simpler implementation
- STREAM can be added later for batching or large events

### Relay Processing

```
Incoming ILP Prepare
       │
       ▼
┌─────────────────────────────────────────┐
│ 1. Decode TOON → Nostr event            │
│ 2. Verify event signature               │
│ 3. Validate event structure (NIP-01)    │
│ 4. Calculate price for this event       │
│ 5. Check: amount ≥ price?               │
│    ├─ YES: Store event, return FULFILL  │
│    └─ NO: Return REJECT (insufficient)  │
└─────────────────────────────────────────┘
```

### Pricing Model

Default: **per-byte** pricing based on TOON-encoded event size.

```
price = toon_bytes * price_per_byte
```

Configurable: Relays can override with **per-kind** pricing.

```
price = price_table[event.kind] ?? (toon_bytes * price_per_byte)
```

Pricing is advertised in the relay's kind:10032 (ILP Peer Info) event:

```json
{
  "kind": 10032,
  "pubkey": "<relay-pubkey>",
  "tags": [
    ["ilp_address", "g.agent.bob"],
    ["price_per_byte", "10"],
    ["price_kind_1", "5000"],
    ["price_kind_7", "1000"]
  ]
}
```

### Atomicity

Payment is atomic with storage:
- Relay only returns FULFILL after successful storage
- If storage fails, relay returns REJECT
- Author's money is only spent if event is stored

The condition/fulfillment mechanism guarantees this.

## Read Path (Free)

Reads use standard NIP-01 WebSocket protocol. No payment required.

```
┌──────────────┐         WebSocket          ┌──────────────┐
│    Client    │ ◄──────────────────────────► │    Relay     │
└──────────────┘                             └──────────────┘

Client → Relay: ["REQ", "sub-id", {filters...}]
Relay → Client: ["EVENT", "sub-id", {event}]
Relay → Client: ["EVENT", "sub-id", {event}]
Relay → Client: ["EOSE", "sub-id"]
Client → Relay: ["CLOSE", "sub-id"]
```

**Rationale**: Charging for reads adds complexity and friction. The value is in storage (persistence), not retrieval. Reads are cheap (no disk writes). Free reads encourage adoption.

### Subscription Semantics

NIP-01 subscriptions are **persistent**: after sending stored events, the relay keeps the subscription open and pushes new matching events in real-time. This works seamlessly with ILP-gated writes.

When an event arrives via ILP payment:

```
ILP Prepare with Event
        │
        ▼
   Verify signature + structure
        │
        ▼
   Check payment ≥ price
        │
        ▼
   Store event in database
        │
        ├──► Return ILP FULFILL to payer
        │
        └──► Push to matching WebSocket subscriptions
```

The key insight: **the ingestion channel differs, but subscription semantics are unchanged**. Events enter via ILP (not WebSocket EVENT message), but once stored, the relay:

1. Checks all active subscriptions against the new event's filters
2. Pushes `["EVENT", "sub-id", {event}]` to matching subscribers
3. Subscribers receive real-time updates as normal

This means a client subscribed with `{"authors": ["<bob-pubkey>"]}` will receive Bob's new posts in real-time, regardless of whether Bob paid to store them on this relay or used the self-write path.

### Follow = Subscribe (Peer Subscriptions)

The follow relationship should drive content propagation, not just payment routing. When Alice follows Bob:

```
Alice follows Bob (kind:3)
        │
        ├──► ILP: Alice peers with Bob (payment routing)
        │
        └──► Nostr: Alice subscribes to Bob's relay (content)
```

**Implementation**: Alice's agent maintains a WebSocket connection to each followed peer's relay with a subscription for their events:

```
Alice's agent:
  For each pubkey in follow list:
    1. Look up their relay (kind:10002 or relay hint in kind:3)
    2. Connect via WebSocket
    3. Subscribe: ["REQ", "follow-<pubkey>", {"authors": ["<pubkey>"]}]
    4. Receive their events in real-time
```

**What Alice does with received events**:

| Option | Description | Cost |
|--------|-------------|------|
| Read-only | Display in feed, don't store | Free |
| Cache locally | Store on own relay | Free (self-write) |
| Re-broadcast | Pay to store on other relays | Paid |

**This creates a natural content propagation model**:

```
Bob posts on his relay (free self-write)
        │
        ▼
Alice (who follows Bob) receives via subscription
        │
        ▼
Alice caches locally (free, her own relay)
        │
        ▼
Carol (who follows Alice but not Bob) queries Alice's relay
        │
        ▼
Carol sees Bob's post via Alice's cache
```

Events propagate through the social graph without explicit payment at each hop. Payment is only required when:
- Storing on someone else's relay (they pay for storage)
- Broadcasting to relays you don't control

### Subscription Reciprocity

Subscriptions are **read-only** and don't require mutual following:

```
Alice follows Bob, Bob does NOT follow Alice:

Alice → Bob's relay: Subscribe (allowed, reads are free)
Bob → Alice's relay: Subscribe (allowed, reads are free)

The follow relationship affects:
  - ILP peering (unidirectional: Alice can pay Bob)
  - Trust/credit limits (Alice trusts Bob)

It does NOT affect:
  - Subscription access (anyone can subscribe to any relay)
```

This maintains Nostr's open read model while adding payment for writes.

## Self-Write (Free)

An agent's own events bypass payment:

```
Agent's pubkey: <alice>

Event from Alice (signed by <alice>):
  → Stored locally without ILP payment
  → Alice doesn't pay herself

Event from Bob (signed by <bob>):
  → Requires ILP payment
  → Bob pays Alice's relay
```

This allows agents to:
- Publish their profile (kind:0)
- Update their follow list (kind:3)
- Publish their ILP peer info (kind:10032)
- Store any self-authored content

## Social Graph Routing

The Nostr social graph (NIP-02 follow lists) populates the ILP routing table.

### Follow = Peer

```
Alice's kind:3 (follow list):
  ["p", "<bob-pubkey>", ...]
  ["p", "<carol-pubkey>", ...]

       ↓ populates

Alice's ILP routing table:
  Bob   → direct peer
  Carol → direct peer
```

If Alice follows Bob, Alice's connector establishes ILP peering with Bob.

### Unidirectional Relationships Work

ILP payments flow from sender to receiver. The receiver doesn't need to follow the sender.

```
Alice follows Bob (Bob does NOT follow Alice)

Alice → Bob: Can send payments ✓
Bob → Alice: Cannot send payments ✗ (no route)

But Alice paying Bob's relay works fine.
Bob's relay receives the packet and decides to accept or reject.
```

### Multi-Hop Routing

Routes propagate through the network, enabling payments to non-direct-follows.

```
Alice follows: Bob, Carol
Bob follows: Eve, Frank
Carol follows: Grace

Route announcements:
  Bob announces to Alice: "I can reach Eve, Frank"
  Carol announces to Alice: "I can reach Grace"

Alice's routing table:
┌─────────────┬────────────┐
│ Destination │ Next Hop   │
├─────────────┼────────────┤
│ Bob         │ direct     │
│ Carol       │ direct     │
│ Eve         │ via Bob    │
│ Frank       │ via Bob    │
│ Grace       │ via Carol  │
└─────────────┴────────────┘
```

Alice can now pay Eve's relay through Bob:

```
Alice                Bob                 Eve
  │                   │                   │
  │ ILP Prepare       │                   │
  │ dest: Eve         │                   │
  │ amount: 60000     │                   │
  │ data: TOON event  │                   │
  │──────────────────►│                   │
  │                   │ ILP Prepare       │
  │                   │ dest: Eve         │
  │                   │ amount: 50000     │ (Bob took 10000 fee)
  │                   │ data: TOON event  │
  │                   │──────────────────►│
  │                   │                   │ Store event
  │                   │   ILP Fulfill     │
  │                   │◄──────────────────│
  │   ILP Fulfill     │                   │
  │◄──────────────────│                   │
  │                   │                   │
```

### Route Propagation

Connectors announce reachable destinations to their peers:

```
┌─────────────────────────────────────────────────────────────┐
│ Route Announcement (could be a new Nostr event kind)        │
│                                                             │
│ Bob → Alice: "I can route to these destinations:"           │
│   - g.agent.eve (direct, fee: 100/packet)                   │
│   - g.agent.frank (direct, fee: 100/packet)                 │
│                                                             │
│ Alice updates routing table accordingly.                    │
└─────────────────────────────────────────────────────────────┘
```

This is conceptually similar to BGP route announcements but derived from and propagated through the social graph.

## Broadcast Flow

When an author wants to broadcast an event to multiple relays:

```
Alice authors a new post (kind:1).

1. Store locally (free, self-write)

2. Determine target relays:
   - Relays of pubkeys mentioned in the event
   - Relays of followers (so they see it)
   - Well-known "hub" relays for broader reach

3. For each target relay:
   a. Look up relay's ILP address (from their kind:10032)
   b. Look up route (direct peer or via intermediary)
   c. Look up price (from their kind:10032)
   d. Create ILP Prepare:
        destination: relay's ILP address
        amount: calculated price + routing fees
        data: TOON-encoded event
   e. Send packet
   f. Receive FULFILL (stored) or REJECT (failed)

4. Partial success is acceptable:
   - Event stored on 8/10 relays = still a successful broadcast
   - Failed relays can be retried or ignored
```

## Event Kinds

### Existing NIPs Used

| Kind | Name | Usage |
|------|------|-------|
| 0 | Profile Metadata | Agent's profile |
| 3 | Follow List | Defines ILP peers |
| 10002 | Relay List | Hints for where to find someone's events |

### New Kinds (Proposed)

| Kind | Name | Purpose |
|------|------|---------|
| 10032 | ILP Peer Info | Advertise ILP address, pricing, capabilities |
| 10033 | Route Announcement | Announce reachable destinations to peers |

### Kind 10032: ILP Peer Info

Replaceable event advertising an agent's ILP endpoint and pricing.

```json
{
  "kind": 10032,
  "pubkey": "<agent-pubkey>",
  "created_at": 1234567890,
  "tags": [
    ["ilp_address", "g.agent.alice"],
    ["price_per_byte", "10"],
    ["price_kind_0", "10000"],
    ["price_kind_1", "5000"],
    ["price_kind_3", "20000"],
    ["price_kind_7", "1000"],
    ["asset_code", "USD"],
    ["asset_scale", "9"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

### Kind 10033: Route Announcement

Replaceable event announcing routes this connector can reach.

```json
{
  "kind": 10033,
  "pubkey": "<connector-pubkey>",
  "created_at": 1234567890,
  "tags": [
    ["route", "g.agent.eve", "100", "direct"],
    ["route", "g.agent.frank", "100", "direct"],
    ["route", "g.agent.grace", "200", "2-hop"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

Tags: `["route", "<ilp_address>", "<fee>", "<distance_hint>"]`

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              ALICE'S AGENT                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ NOSTR IDENTITY                                                    │  │
│  │   pubkey: <alice-pubkey>                                          │  │
│  │   secretKey: <alice-secret>                                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ILP CONNECTOR                                                     │  │
│  │                                                                   │  │
│  │   ILP Address: g.agent.alice                                      │  │
│  │                                                                   │  │
│  │   Peers (from follow list):                                       │  │
│  │     - Bob (g.agent.bob) - direct                                  │  │
│  │     - Carol (g.agent.carol) - direct                              │  │
│  │                                                                   │  │
│  │   Routing Table:                                                  │  │
│  │     g.agent.bob → direct                                          │  │
│  │     g.agent.carol → direct                                        │  │
│  │     g.agent.eve → via bob (learned)                               │  │
│  │     g.agent.grace → via carol (learned)                           │  │
│  │                                                                   │  │
│  │   Incoming packets:                                               │  │
│  │     - For me? → pass to relay                                     │  │
│  │     - For others? → forward, take fee                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ NOSTR RELAY                                                       │  │
│  │                                                                   │  │
│  │   Storage: SQLite (events table)                                  │  │
│  │                                                                   │  │
│  │   Write (ILP):                                                    │  │
│  │     - Receive packet with TOON event                              │  │
│  │     - Verify signature, check price                               │  │
│  │     - Store event, return FULFILL                                 │  │
│  │                                                                   │  │
│  │   Write (Self):                                                   │  │
│  │     - Events signed by alice-pubkey                               │  │
│  │     - Stored directly, no payment                                 │  │
│  │                                                                   │  │
│  │   Read (WebSocket):                                               │  │
│  │     - NIP-01 REQ/EVENT/EOSE                                       │  │
│  │     - Free, no payment required                                   │  │
│  │                                                                   │  │
│  │   Pricing:                                                        │  │
│  │     - Default: 10 units per byte                                  │  │
│  │     - Kind overrides: kind:1 = 5000 flat                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
          │                                          │
          │ ILP Peering                              │ WebSocket
          │ (packet routing)                         │ (NIP-01 queries)
          ▼                                          ▼
    ┌───────────┐                              ┌───────────┐
    │   Bob's   │                              │  Clients  │
    │   Agent   │                              │           │
    └───────────┘                              └───────────┘
```

## Security Considerations

### Spam Resistance
- Every write costs money
- Price can be adjusted based on demand
- Per-kind pricing allows charging more for expensive-to-store events

### Payment Verification
- ILP condition/fulfillment is cryptographic
- Relay only fulfills after successful storage
- No payment without storage, no storage without payment

### Signature Verification
- Events must have valid Nostr signatures
- Relay verifies before storing
- Prevents forged events

### Routing Security
- Route announcements should be signed
- Connectors should validate announcements
- Potential for route poisoning (needs analysis)

### Denial of Service
- Payment requirement deters most DoS
- Rate limiting can be layered on top
- Expensive events (large, frequent) cost more

## Open Questions

1. **Route announcement propagation**: How far do routes propagate? Full mesh eventually, or limited hops?

2. **Price discovery protocol**: Should there be a quote mechanism, or is reading kind:10032 sufficient?

3. **Failure handling**: What if a relay accepts payment but fails to store? Reputation system?

4. **Settlement**: How do connectors settle with each other? Periodic netting? Per-packet?

5. **Asset types**: What units are prices in? Need cross-asset routing?

## References

- [TOON Format](https://toonformat.dev) - Event encoding
- [ILP RFC 0027: Interledger Protocol V4](https://interledger.org/developers/rfcs/interledger-protocol/) - Packet format
- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md) - Nostr events and relay protocol
- [NIP-02: Follow List](https://github.com/nostr-protocol/nips/blob/master/02.md) - Social graph
- [DESIGN-CONVERSATION.md](./DESIGN-CONVERSATION.md) - Original design context
