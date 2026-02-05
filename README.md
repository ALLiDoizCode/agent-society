# Agent Society Protocol

Nostr-based peer discovery and SPSP for Interledger agents.

## Overview

This library bridges [Nostr](https://nostr.com/) and [Interledger Protocol (ILP)](https://interledger.org/), enabling:

- **Peer Discovery via NIP-02**: Use Nostr follow lists to discover ILP peers
- **SPSP over Nostr**: Exchange SPSP parameters via Nostr events instead of HTTPS
- **Social Graph → Trust**: Derive credit limits from social relationships
- **Decentralized Connector Registry**: Publish and discover connector info via relays

## Installation

```bash
npm install @agent-society/protocol
```

## Quick Start

### Discover Peers from Your Follow List

```typescript
import { NostrPeerDiscoveryService } from '@agent-society/protocol';

const discovery = new NostrPeerDiscoveryService({
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  pubkey: 'your-nostr-pubkey-hex',
});

// Find ILP peers among people you follow
const peers = await discovery.discoverPeers();

for (const peer of peers) {
  console.log(`Found peer: ${peer.ilpAddress} at ${peer.btpEndpoint}`);
}

// Get configs ready for your connector
const peerConfigs = await discovery.getPeerConfigs();
```

### Publish Your Connector Info

```typescript
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { buildIlpPeerInfoEvent } from '@agent-society/protocol';

const secretKey = generateSecretKey();
const pool = new SimplePool();

const event = buildIlpPeerInfoEvent({
  ilpAddress: 'g.agent.myagent',
  btpEndpoint: 'wss://myagent.example/btp',
  assets: [{ code: 'USD', scale: 2 }],
  settlement: [{ type: 'evm-paychan', details: ['0x...', '84532'] }],
});

const signed = finalizeEvent(event, secretKey);
await pool.publish(['wss://relay.damus.io'], signed);
```

### SPSP Over Nostr

**Client (Sender):**

```typescript
import { NostrSpspClient } from '@agent-society/protocol';

const client = new NostrSpspClient({
  relays: ['wss://relay.damus.io'],
  secretKey: yourSecretKey,
});

// Get static SPSP info (from receiver's kind:10047 event)
const params = await client.getStaticSpspParams(receiverPubkey);

// Or request fresh params (NIP-47 style encrypted exchange)
const freshParams = await client.requestSpspParams(receiverPubkey);

console.log(`Pay to: ${params.destinationAccount}`);
console.log(`Secret: ${params.sharedSecret}`);
```

**Server (Receiver):**

```typescript
import { NostrSpspServer } from '@agent-society/protocol';

const server = new NostrSpspServer({
  relays: ['wss://relay.damus.io'],
  secretKey: yourSecretKey,
  destinationAccount: 'g.agent.myagent.receiver',
});

// Publish static SPSP info
await server.publishStaticSpspInfo('base64-shared-secret');

// Or listen for dynamic requests
server.startListening();
```

### Social Trust for Credit Limits

```typescript
import { SimplePool } from 'nostr-tools';
import { SocialTrustManager, NostrPeerDiscoveryService } from '@agent-society/protocol';

const pool = new SimplePool();
const relays = ['wss://relay.damus.io'];

const trustManager = new SocialTrustManager(pool, relays, myPubkey, {
  baseCreditForFollowed: 10000n,
  mutualFollowerBonus: 1000n,
  maxCreditLimit: 100000n,
});

await trustManager.initialize();

// Compute trust for a specific peer
const trust = await trustManager.computeTrust(peerPubkey);
console.log(`Credit limit: ${trust.creditLimit}`);
console.log(`Trust score: ${trust.score}/100`);

// Use with peer discovery
const discovery = new NostrPeerDiscoveryService({ relays, pubkey: myPubkey, pool });
const configs = await discovery.getPeerConfigs(trustManager.getTrustCalculator());
```

## Event Kinds

| Kind | Name | Purpose |
|------|------|---------|
| `10032` | ILP Peer Info | Connector's ILP address, BTP endpoint, settlement info |
| `10047` | SPSP Info | Static SPSP destination and shared secret |
| `23194` | SPSP Request | Encrypted request for fresh SPSP params |
| `23195` | SPSP Response | Encrypted response with SPSP params |

## Architecture

```
Social Graph (NIP-02)          ILP Network
─────────────────────          ───────────
     ┌─────────┐               ┌─────────┐
     │  Alice  │───follows────▶│  Bob    │
     └────┬────┘               └────┬────┘
          │                         │
          │ populates               │
          ▼                         ▼
     ┌─────────┐               ┌─────────┐
     │ Routing │◀──BTP/ILP───▶│ Routing │
     │ Table   │               │ Table   │
     └─────────┘               └─────────┘
```

Your Nostr follows become your ILP peers. Social distance informs credit limits.

## Related Specifications

- [NIP-02: Follow List](https://github.com/nostr-protocol/nips/blob/master/02.md)
- [NIP-47: Nostr Wallet Connect](https://github.com/nostr-protocol/nips/blob/master/47.md)
- [RFC 0009: Simple Payment Setup Protocol](https://interledger.org/developers/rfcs/simple-payment-setup-protocol/)
- [RFC 0032: Peering, Clearing and Settlement](https://interledger.org/developers/rfcs/peering-clearing-settling/)

## License

MIT
