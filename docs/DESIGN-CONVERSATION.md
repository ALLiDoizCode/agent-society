# Agent Society Protocol - Design Conversation

This document captures the design conversation that led to this project. Use it as context for continuing development.

## The Core Insight

**Your Nostr follows become your ILP peers. Social distance informs financial trust.**

The Nostr social graph (NIP-02 follow lists) can be used to:
1. Discover ILP connector peers
2. Derive credit limits from social trust
3. Replace HTTPS-based SPSP with Nostr events
4. Create a decentralized connector registry

## Problem Statement

Traditional ILP (Interledger Protocol) has two challenges:
1. **Peer Discovery**: How do connectors find each other? Currently requires manual configuration or centralized registries.
2. **SPSP Handshake**: Simple Payment Setup Protocol uses HTTPS to exchange `destination_account` and `shared_secret`. This requires DNS and web servers.

## Solution: Use Nostr

### NIP-02 for Peer Discovery

NIP-02 defines follow lists (kind:3 events). Each follow represents a trust relationship:

```json
{
  "kind": 3,
  "pubkey": "<my_pubkey>",
  "tags": [
    ["p", "<peer1_pubkey>", "wss://relay.example", "alice"],
    ["p", "<peer2_pubkey>", "wss://relay2.example", "bob"]
  ]
}
```

**Mapping**: If I follow someone, I trust them to route my payments.

### New Event Kinds for ILP

| Kind | Name | Purpose |
|------|------|---------|
| `10032` | ILP Peer Info | Replaceable event with connector's ILP address, BTP endpoint, settlement info |
| `10047` | SPSP Info | Replaceable event with SPSP destination_account and shared_secret |
| `23194` | SPSP Request | Ephemeral encrypted request for fresh SPSP parameters (NIP-47 style) |
| `23195` | SPSP Response | Ephemeral encrypted response with SPSP parameters |

### SPSP Over Nostr

Traditional SPSP:
```
GET https://wallet.example/.well-known/pay?p=alice
→ { destination_account, shared_secret, receipts_enabled }
```

Nostr SPSP (static):
```
Query kind:10047 from receiver's pubkey
→ Parse destination_account, shared_secret from tags
```

Nostr SPSP (dynamic, NIP-47 style):
```
Publish kind:23194 encrypted request to receiver
← Receive kind:23195 encrypted response with fresh shared_secret
```

## Architecture Decision: Nostr Populates, Doesn't Replace

**Important**: The Nostr layer is for discovery and configuration. Actual ILP packet routing still happens via local routing tables in the connector.

```
┌─────────────────────────────────────────────────────────────────┐
│                      NOSTR LAYER                                │
│         (Discovery, Trust Signals, Peer Configuration)          │
│                                                                 │
│   • Who exists that I could peer with?                          │
│   • What are their BTP endpoints?                               │
│   • How much should I trust them? (social graph distance)       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ populates / informs
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CONNECTOR LOCAL STATE                         │
│              (Fast, In-Memory, Per-Packet Decisions)            │
│                                                                 │
│   Routing Table, Peer Accounts, Credit Limits                   │
│   (packet routing happens here - fast, local, no network)       │
└─────────────────────────────────────────────────────────────────┘
```

## Project Scope Decision

This project (`agent-society`) is separate from `agent-runtime` because:

1. **Separation of concerns**: The social graph is agent-specific, not infrastructure
2. **Reusability**: Multiple agent implementations can use this library
3. **NIP potential**: Could become a formal Nostr Implementation Possibility
4. **Clean boundaries**: ILP connector knows nothing about Nostr; this bridges them

```
Individual Agent Repos
    │ uses
    ▼
@agent-society/protocol (this library)
    │ populates
    ▼
ILP Connector (routes packets, no Nostr knowledge)
```

## What Was Implemented

### Source Structure

```
src/
├── discovery/
│   └── nostr-peer-discovery.ts    # NostrPeerDiscoveryService
├── events/
│   ├── kinds.ts                   # Event kind constants (10032, 10047, etc.)
│   ├── types.ts                   # TypeScript interfaces
│   ├── parser.ts                  # Parse Nostr events → ILP types
│   └── builder.ts                 # Build ILP events from params
├── spsp/
│   ├── nostr-spsp-client.ts       # Request SPSP params over Nostr
│   └── nostr-spsp-server.ts       # Serve SPSP params over Nostr
├── trust/
│   └── social-trust-manager.ts    # Social graph → credit limits
└── index.ts
```

### Key Classes

**NostrPeerDiscoveryService**
- `discoverPeers()` - Find ILP peers from follow list
- `getPeerConfigs(trustCalculator)` - Get configs ready for connector
- `subscribeToPeerUpdates(callback)` - React to peer info changes

**NostrSpspClient**
- `getStaticSpspParams(pubkey)` - Query kind:10047 for static SPSP
- `requestSpspParams(pubkey)` - NIP-47 style encrypted request/response

**NostrSpspServer**
- `publishStaticSpspInfo(secret)` - Publish kind:10047
- `startListening()` - Handle incoming SPSP requests

**SocialTrustManager**
- `computeTrust(peerPubkey)` - Derive credit limit from social distance
- `getTrustCalculator()` - Get function for use with discovery service

## Open Questions / Next Steps

### 1. Event Storage
Currently the library only handles events (client-only). Should it:
- Keep relying on external relays?
- Add SQLite local storage for ILP events?
- Embed a relay for offline operation?

### 2. NIP Proposal
The event kinds (10032, 10047, 23194, 23195) should be formalized as a NIP. Draft needed.

### 3. Integration with agent-runtime
Wire `NostrPeerDiscoveryService` into the connector as an alternative to HTTP-based discovery.

### 4. Testing
- Unit tests with mocked SimplePool
- Integration tests against real relays (testnet)

### 5. Security Considerations
- NIP-44 encryption for SPSP requests/responses
- Shared secret rotation policies
- Trust score manipulation resistance

## Key References

### Nostr NIPs
- [NIP-02: Follow List](https://github.com/nostr-protocol/nips/blob/master/02.md) - Social graph
- [NIP-47: Nostr Wallet Connect](https://github.com/nostr-protocol/nips/blob/master/47.md) - Request/response pattern
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md) - Encryption
- [NIP-05: DNS Identity](https://github.com/nostr-protocol/nips/blob/master/05.md) - Identity mapping

### Interledger RFCs
- [RFC 0009: SPSP](https://interledger.org/developers/rfcs/simple-payment-setup-protocol/) - What we're replacing
- [RFC 0032: Peering, Clearing, Settlement](https://interledger.org/developers/rfcs/peering-clearing-settling/) - Peer relationships
- [RFC 0029: STREAM](https://interledger.org/developers/rfcs/stream/) - Uses the shared_secret

## Example Usage

```typescript
import {
  NostrPeerDiscoveryService,
  SocialTrustManager,
  NostrSpspClient
} from '@agent-society/protocol';
import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools';

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);
const relays = ['wss://relay.damus.io', 'wss://nos.lol'];

// Discover peers from follow list
const discovery = new NostrPeerDiscoveryService({ relays, pubkey });
const peers = await discovery.discoverPeers();

// Compute trust-based credit limits
const pool = new SimplePool();
const trust = new SocialTrustManager(pool, relays, pubkey, {
  baseCreditForFollowed: 10000n,
  mutualFollowerBonus: 1000n,
});
await trust.initialize();

const configs = await discovery.getPeerConfigs(trust.getTrustCalculator());
// → Ready to configure connector with peer configs

// Get SPSP params for a payment
const spsp = new NostrSpspClient({ relays, secretKey });
const params = await spsp.requestSpspParams(receiverPubkey);
// → { destinationAccount, sharedSecret, receiptsEnabled }
```

## Commands to Get Started

```bash
cd /Users/jonathangreen/Documents/agent-society

# Install dependencies
npm install

# Build
npm run build

# Run tests (once written)
npm test
```

## Related Projects

- `agent-runtime` at `/Users/jonathangreen/Documents/agent-runtime` - ILP connector infrastructure
- nostr-tools npm package - Nostr client library we depend on
