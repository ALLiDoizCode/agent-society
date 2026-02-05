# Agent Society Protocol

A Nostr-based protocol for Interledger peer discovery, SPSP handshakes, and social graph-informed payment routing.

## Project Overview

This library bridges Nostr and Interledger Protocol (ILP), enabling:

1. **Peer Discovery via NIP-02**: Use Nostr follow lists to discover ILP peers
2. **SPSP over Nostr**: Exchange SPSP parameters via Nostr events instead of HTTPS
3. **Social Graph → Trust**: Derive credit limits and routing preferences from social relationships
4. **Decentralized Connector Registry**: Publish and discover connector info via relays

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Individual Agents                         │
│                                                             │
│  - Own their Nostr identity (keypair)                       │
│  - Manage their follow list (who they peer with)            │
│  - Import this library for ILP integration                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              @agent-society/protocol (this library)          │
│                                                             │
│  - NostrPeerDiscovery: NIP-02 → peer list                   │
│  - NostrSpspClient: SPSP over Nostr events                  │
│  - SocialTrustManager: social graph → credit limits         │
│  - Event kinds for ILP peering (kind:10032, kind:10047)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ populates
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ILP Connector                             │
│                                                             │
│  - Routes packets (no Nostr knowledge)                      │
│  - Manages balances with configured peers                   │
│  - Settlement engines                                       │
└─────────────────────────────────────────────────────────────┘
```

## Event Kinds (Proposed NIPs)

| Kind | Name | Purpose |
|------|------|---------|
| `10032` | ILP Peer Info | Replaceable event with connector's ILP address, BTP endpoint, settlement info |
| `10047` | SPSP Info | Replaceable event with SPSP destination_account and shared_secret |
| `23194` | SPSP Request | Ephemeral request for fresh SPSP parameters (NIP-47 style) |
| `23195` | SPSP Response | Ephemeral response with SPSP parameters |

## Key Design Decisions

### Social Graph = Network Graph
NIP-02 follows represent peering relationships. If Alice follows Bob, Alice trusts Bob to route payments.

### Nostr Populates, Doesn't Replace
The Nostr layer is for discovery and configuration. Actual packet routing uses local routing tables in the connector.

### Trust Derivation
Credit limits can be computed from:
- Social distance (hops in follow graph)
- Mutual followers
- Reputation (NIP-57 zaps received)
- Historical payment success

## Development Guidelines

- Use `nostr-tools` for all Nostr operations
- All event kinds should be well-documented for potential NIP submission
- Keep ILP-specific logic separate from Nostr-specific logic
- Write tests that don't require live relays (mock SimplePool)

## Related Specifications

- [NIP-02: Follow List](https://github.com/nostr-protocol/nips/blob/master/02.md)
- [NIP-47: Nostr Wallet Connect](https://github.com/nostr-protocol/nips/blob/master/47.md)
- [RFC 0009: Simple Payment Setup Protocol](https://interledger.org/developers/rfcs/simple-payment-setup-protocol/)
- [RFC 0032: Peering, Clearing and Settlement](https://interledger.org/developers/rfcs/peering-clearing-settling/)
