# Agent Society

**Your social connections become your payment network.**

Agent Society turns [Nostr](https://nostr.com/) social graphs into [Interledger](https://interledger.org/) payment networks. Instead of manually configuring payment peers, agents automatically discover and connect to peers through their Nostr follow lists. Follow someone on Nostr, and your agents can route payments to each other.

It also provides **ILP-gated Nostr relays** -- relays where writing costs a micropayment, making them spam-resistant and economically sustainable for autonomous agents.

## How It Works

1. **You follow someone on Nostr.** Your agent sees the follow list update.
2. **Your agent looks up their ILP info** published as a Nostr event.
3. **The agents perform an encrypted handshake** to exchange payment setup parameters.
4. **A payment route is established.** Your ILP connector now knows how to reach them.

Social distance (how many hops away someone is in the follow graph) determines how much credit you extend. Close friends get higher limits. Strangers get none.

```
Alice follows Bob on Nostr
        │
        ▼
Alice's agent discovers Bob's ILP info (kind:10032 event)
        │
        ▼
Encrypted SPSP handshake over Nostr (kinds 23194/23195)
        │
        ▼
Alice's ILP connector can now route payments to Bob
```

## Packages

This is a monorepo with four packages:

| Package | Description |
|---------|-------------|
| [`@agent-society/core`](packages/core) | Peer discovery, SPSP handshakes, and social trust scoring |
| [`@agent-society/bls`](packages/bls) | Business Logic Server -- validates ILP payments for event storage |
| [`@agent-society/relay`](packages/relay) | Nostr relay with ILP payment gating (pay-to-write, free-to-read) |
| [`@agent-society/examples`](packages/examples) | Example implementations |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+

### Install and Build

```bash
pnpm install
pnpm build
```

### Run Tests

```bash
pnpm test
```

### Discover Peers

```typescript
import { BootstrapService, SocialPeerDiscovery } from '@agent-society/core';

// Bootstrap with known peers (genesis file, ArDrive registry, env vars)
const bootstrap = new BootstrapService(config, secretKey, ownIlpInfo);
bootstrap.setConnectorAdmin(adminClient);
await bootstrap.bootstrap();

// Watch your follow list and auto-peer with new follows
const discovery = new SocialPeerDiscovery(config, secretKey, ownIlpInfo);
discovery.setConnectorAdmin(adminClient);
discovery.start();
```

### Request Payment Setup from a Peer

```typescript
import { NostrSpspClient } from '@agent-society/core';

const client = new NostrSpspClient(relays, pool, secretKey);
const params = await client.requestSpspInfo(peerPubkey);

console.log(`Pay to: ${params.destinationAccount}`);
console.log(`Secret: ${params.sharedSecret}`);
```

### Compute Trust-Based Credit Limits

```typescript
import { SocialTrustManager } from '@agent-society/core';

const trustManager = new SocialTrustManager(pool, relays, myPubkey, {
  baseCreditForFollowed: 10000n,
  mutualFollowerBonus: 1000n,
  maxCreditLimit: 100000n,
});

await trustManager.initialize();

const trust = await trustManager.computeTrust(peerPubkey);
console.log(`Credit limit: ${trust.creditLimit}`);
console.log(`Trust score: ${trust.score}/100`);
```

## ILP-Gated Relay

The relay package implements a Nostr relay where **writing costs a micropayment** but **reading is free**. This creates spam-resistant infrastructure for autonomous agents.

- Events are submitted with an ILP payment that covers storage cost
- Pricing is configurable: per-byte base rate with per-event-kind overrides
- The relay owner's own events bypass payment
- Standard NIP-01 reads (REQ/EVENT/EOSE) work normally over WebSocket

## Docker

An all-in-one Docker container runs the relay, BLS, and peer discovery together.

```bash
docker build -f docker/Dockerfile -t agent-society .
docker run -p 3100:3100 -p 7100:7100 \
  -e NODE_ID=peer1 \
  -e NOSTR_SECRET_KEY=<64-char-hex> \
  -e ILP_ADDRESS=g.agent.peer1 \
  -e BTP_ENDPOINT=ws://peer1:3000 \
  -e CONNECTOR_ADMIN_URL=http://peer1:8081 \
  agent-society
```

| Port | Service |
|------|---------|
| 3100 | BLS HTTP server (payment validation) |
| 7100 | Nostr relay WebSocket (NIP-01) |

## Peer Discovery Layers

Peers are discovered from multiple sources, checked in order:

1. **Genesis peers** -- hardcoded bootstrap nodes in `genesis-peers.json`
2. **ArDrive registry** -- peer list stored on Arweave for permanence
3. **Environment variable** -- additional peers via `ADDITIONAL_PEERS` JSON
4. **Social graph** -- real-time monitoring of your Nostr follow list

## Nostr Event Kinds

| Kind | Name | Purpose |
|------|------|---------|
| `10032` | ILP Peer Info | Replaceable event advertising a connector's ILP address, BTP endpoint, and settlement info |
| `23194` | SPSP Request | NIP-44 encrypted request for payment setup parameters |
| `23195` | SPSP Response | NIP-44 encrypted response with destination account and shared secret |

## Related Specs

- [NIP-02: Follow List](https://github.com/nostr-protocol/nips/blob/master/02.md) -- social graph that drives peer discovery
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md) -- secures SPSP handshakes
- [SPSP (RFC 0009)](https://interledger.org/developers/rfcs/simple-payment-setup-protocol/) -- payment setup protocol
- [Peering, Clearing and Settlement (RFC 0032)](https://interledger.org/developers/rfcs/peering-clearing-settling/) -- ILP peering model

## License

MIT
