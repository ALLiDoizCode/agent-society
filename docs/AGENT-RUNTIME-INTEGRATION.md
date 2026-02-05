# Agent-Runtime Integration Guide

This document explains how to integrate `@agent-society/protocol` with `agent-runtime` to enable Nostr-based peer discovery for ILP connectors.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│              @agent-society/protocol                         │
│                                                             │
│  NostrPeerDiscoveryService    SocialTrustManager            │
│  NostrSpspClient/Server       Event Builders/Parsers        │
│                                                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Discovers peers, computes trust
                        │ Calls Admin API or direct methods
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    agent-runtime                             │
│                                                             │
│  ConnectorNode                                              │
│    ├── BTPClientManager  ← Add peers here                   │
│    ├── RoutingTable      ← Add routes here                  │
│    ├── AdminServer       ← REST API for dynamic config      │
│    └── PacketHandler     ← Routes ILP packets               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Integration Options

### Option A: Admin API (Recommended)

The cleanest integration uses agent-runtime's Admin API. No code changes required to agent-runtime.

```
┌─────────────────────────┐        REST API        ┌─────────────────────────┐
│  Nostr Discovery        │ ───────────────────────► │  agent-runtime          │
│  (separate process)     │  POST /admin/peers      │  AdminServer :8081      │
│                         │  POST /admin/routes     │                         │
└─────────────────────────┘                         └─────────────────────────┘
```

**Advantages:**
- Decoupled deployment
- No connector code changes
- Can be any language/runtime
- Independent upgrade cycles

### Option B: Embedded Integration

For tighter integration, embed discovery logic directly in the connector startup.

```
┌─────────────────────────────────────────────────────────────┐
│  ConnectorNode                                              │
│    │                                                        │
│    ├── NostrDiscoveryIntegration (new)                      │
│    │     └── Calls BTPClientManager.addPeer()               │
│    │     └── Calls RoutingTable.addRoute()                  │
│    │                                                        │
│    ├── BTPClientManager                                     │
│    ├── RoutingTable                                         │
│    └── ...                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Advantages:**
- Single process
- Direct access to internal APIs
- Lower latency

## Admin API Integration (Option A)

### Enable Admin API in agent-runtime

```yaml
# agent-runtime config.yaml
nodeId: my-connector
btpServerPort: 3000
healthCheckPort: 8080

adminApi:
  enabled: true
  port: 8081
  apiKey: your-secret-api-key  # Optional but recommended
```

### Nostr Discovery Service

Create a service that bridges Nostr discovery to the Admin API:

```typescript
import {
  NostrPeerDiscoveryService,
  SocialTrustManager,
  parseIlpPeerInfoEvent,
} from '@agent-society/protocol';
import { SimplePool } from 'nostr-tools';

interface AgentRuntimeAdminClient {
  adminUrl: string;
  apiKey?: string;
}

export class NostrToAgentRuntimeBridge {
  private discovery: NostrPeerDiscoveryService;
  private trustManager: SocialTrustManager;
  private adminClient: AgentRuntimeAdminClient;
  private pool: SimplePool;

  constructor(config: {
    relays: string[];
    pubkey: string;
    secretKey: Uint8Array;
    adminUrl: string;
    adminApiKey?: string;
    trustConfig?: {
      baseCreditForFollowed?: bigint;
      mutualFollowerBonus?: bigint;
      maxCreditLimit?: bigint;
    };
  }) {
    this.pool = new SimplePool();

    this.discovery = new NostrPeerDiscoveryService({
      relays: config.relays,
      pubkey: config.pubkey,
      pool: this.pool,
    });

    this.trustManager = new SocialTrustManager(
      this.pool,
      config.relays,
      config.pubkey,
      config.trustConfig ?? {
        baseCreditForFollowed: 10000n,
        mutualFollowerBonus: 1000n,
        maxCreditLimit: 100000n,
      }
    );

    this.adminClient = {
      adminUrl: config.adminUrl,
      apiKey: config.adminApiKey,
    };
  }

  async start(): Promise<void> {
    // Initialize trust manager (fetches social graph)
    await this.trustManager.initialize();

    // Discover initial peers
    const peers = await this.discovery.discoverPeers();

    for (const peer of peers) {
      await this.addPeerToConnector(peer);
    }

    // Subscribe to peer updates
    this.discovery.subscribeToPeerUpdates(async (event) => {
      const peerInfo = parseIlpPeerInfoEvent(event);
      if (peerInfo) {
        await this.addPeerToConnector(peerInfo);
      }
    });
  }

  private async addPeerToConnector(peer: {
    pubkey: string;
    ilpAddress: string;
    btpEndpoint: string;
  }): Promise<void> {
    // Compute trust-based priority
    const trust = await this.trustManager.computeTrust(peer.pubkey);
    const priority = this.trustScoreToPriority(trust.score);

    // Derive auth token (could use NIP-44 encrypted exchange)
    const authToken = await this.deriveAuthToken(peer.pubkey);

    // Call Admin API
    const response = await fetch(`${this.adminClient.adminUrl}/admin/peers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.adminClient.apiKey && {
          'X-Api-Key': this.adminClient.apiKey,
        }),
      },
      body: JSON.stringify({
        id: peer.pubkey.slice(0, 16), // Use pubkey prefix as peer ID
        url: peer.btpEndpoint,
        authToken: authToken,
        routes: [
          {
            prefix: peer.ilpAddress,
            priority: priority,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`Failed to add peer ${peer.pubkey}:`, await response.text());
      return;
    }

    const result = await response.json();
    console.log(`Added peer ${result.peer.id}, connected: ${result.peer.connected}`);
  }

  private trustScoreToPriority(score: number): number {
    // Higher trust = higher priority (0-100 → 0-100)
    return Math.floor(score);
  }

  private async deriveAuthToken(peerPubkey: string): Promise<string> {
    // Option 1: Use SPSP shared secret
    // Option 2: Derive from NIP-44 key exchange
    // Option 3: Use static token from peer's kind:10032 event

    // Placeholder - implement based on your auth strategy
    return `nostr-${peerPubkey.slice(0, 8)}`;
  }

  async stop(): Promise<void> {
    this.pool.close([]);
  }
}
```

### Usage

```typescript
import { NostrToAgentRuntimeBridge } from './nostr-bridge';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

const bridge = new NostrToAgentRuntimeBridge({
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  pubkey: pubkey,
  secretKey: secretKey,
  adminUrl: 'http://localhost:8081',
  adminApiKey: process.env.ADMIN_API_KEY,
  trustConfig: {
    baseCreditForFollowed: 50000n,
    mutualFollowerBonus: 10000n,
    maxCreditLimit: 500000n,
  },
});

await bridge.start();
console.log('Nostr discovery bridge running...');

// Keep running, will update connector as peers change
process.on('SIGINT', async () => {
  await bridge.stop();
  process.exit(0);
});
```

## Admin API Reference

### Add Peer

```http
POST /admin/peers
Content-Type: application/json
X-Api-Key: your-api-key

{
  "id": "peer-alice",
  "url": "ws://alice.example.com:4000",
  "authToken": "shared-secret",
  "routes": [
    {
      "prefix": "g.alice",
      "priority": 50
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "peer": {
    "id": "peer-alice",
    "url": "ws://alice.example.com:4000",
    "connected": true
  },
  "routes": ["g.alice"],
  "message": "Peer 'peer-alice' added and connected"
}
```

### Remove Peer

```http
DELETE /admin/peers/peer-alice
X-Api-Key: your-api-key
```

### List Peers

```http
GET /admin/peers
X-Api-Key: your-api-key
```

Response:
```json
{
  "peers": [
    {
      "id": "peer-alice",
      "url": "ws://alice.example.com:4000",
      "connected": true,
      "lastSeen": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Add Route

```http
POST /admin/routes
Content-Type: application/json
X-Api-Key: your-api-key

{
  "prefix": "g.alice.wallet",
  "nextHop": "peer-alice",
  "priority": 100
}
```

### Remove Route

```http
DELETE /admin/routes/g.alice.wallet
X-Api-Key: your-api-key
```

### List Routes

```http
GET /admin/routes
X-Api-Key: your-api-key
```

## Embedded Integration (Option B)

For embedding discovery in the connector, extend `ConnectorNode`:

```typescript
// In agent-runtime codebase
// packages/connector/src/discovery/nostr-discovery-integration.ts

import {
  NostrPeerDiscoveryService,
  SocialTrustManager,
  parseIlpPeerInfoEvent,
} from '@agent-society/protocol';
import { SimplePool } from 'nostr-tools';
import { BTPClientManager } from '../btp/btp-client-manager';
import { RoutingTable } from '../routing/routing-table';

export interface NostrDiscoveryConfig {
  enabled: boolean;
  relays: string[];
  pubkey: string;
  secretKey: Uint8Array;
  trustConfig?: {
    baseCreditForFollowed?: bigint;
    mutualFollowerBonus?: bigint;
    maxCreditLimit?: bigint;
  };
}

export class NostrDiscoveryIntegration {
  private discovery: NostrPeerDiscoveryService;
  private trustManager: SocialTrustManager;
  private pool: SimplePool;

  constructor(
    private config: NostrDiscoveryConfig,
    private btpClientManager: BTPClientManager,
    private routingTable: RoutingTable
  ) {
    this.pool = new SimplePool();

    this.discovery = new NostrPeerDiscoveryService({
      relays: config.relays,
      pubkey: config.pubkey,
      pool: this.pool,
    });

    this.trustManager = new SocialTrustManager(
      this.pool,
      config.relays,
      config.pubkey,
      config.trustConfig ?? {
        baseCreditForFollowed: 10000n,
        mutualFollowerBonus: 1000n,
        maxCreditLimit: 100000n,
      }
    );
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    await this.trustManager.initialize();

    // Discover and add initial peers
    const peers = await this.discovery.discoverPeers();
    for (const peer of peers) {
      await this.addPeer(peer);
    }

    // Subscribe to updates
    this.discovery.subscribeToPeerUpdates(async (event) => {
      const peerInfo = parseIlpPeerInfoEvent(event);
      if (peerInfo) {
        await this.addPeer(peerInfo);
      }
    });
  }

  private async addPeer(peer: {
    pubkey: string;
    ilpAddress: string;
    btpEndpoint: string;
  }): Promise<void> {
    const peerId = `nostr-${peer.pubkey.slice(0, 12)}`;
    const trust = await this.trustManager.computeTrust(peer.pubkey);

    // Add to BTP client manager
    await this.btpClientManager.addPeer({
      id: peerId,
      url: peer.btpEndpoint,
      authToken: await this.deriveAuthToken(peer.pubkey),
      connected: false,
      lastSeen: new Date(),
    });

    // Add route with trust-derived priority
    this.routingTable.addRoute(
      peer.ilpAddress,
      peerId,
      Math.floor(trust.score)
    );

    console.log(`[Nostr] Added peer ${peerId} with trust score ${trust.score}`);
  }

  private async deriveAuthToken(peerPubkey: string): Promise<string> {
    // Implement auth token derivation
    return `nostr-auth-${peerPubkey.slice(0, 8)}`;
  }

  async stop(): Promise<void> {
    this.pool.close([]);
  }
}
```

Then modify `ConnectorNode.start()`:

```typescript
// In connector-node.ts

import { NostrDiscoveryIntegration, NostrDiscoveryConfig } from '../discovery/nostr-discovery-integration';

export class ConnectorNode {
  private nostrDiscovery?: NostrDiscoveryIntegration;

  async start(): Promise<void> {
    // ... existing initialization ...

    // Add after BTPClientManager and RoutingTable are created
    if (this.config.nostrDiscovery?.enabled) {
      this.nostrDiscovery = new NostrDiscoveryIntegration(
        this.config.nostrDiscovery,
        this._btpClientManager,
        this._routingTable
      );
      await this.nostrDiscovery.start();
    }

    // ... rest of startup ...
  }

  async stop(): Promise<void> {
    await this.nostrDiscovery?.stop();
    // ... existing shutdown ...
  }
}
```

Configuration:

```yaml
# config.yaml
nodeId: my-connector
btpServerPort: 3000

nostrDiscovery:
  enabled: true
  relays:
    - wss://relay.damus.io
    - wss://nos.lol
  pubkey: "your-hex-pubkey"
  # secretKey loaded from env or secure storage
  trustConfig:
    baseCreditForFollowed: 50000
    mutualFollowerBonus: 10000
    maxCreditLimit: 500000
```

## Mapping Concepts

| agent-society | agent-runtime | Notes |
|---------------|---------------|-------|
| `NostrPeerDiscoveryService.discoverPeers()` | `BTPClientManager.addPeer()` | Discovered peers become BTP connections |
| `SocialTrustManager.computeTrust()` | `RoutingTable.addRoute(priority)` | Trust score → route priority |
| `IlpPeerInfo.btpEndpoint` | `Peer.url` | WebSocket URL for BTP |
| `IlpPeerInfo.ilpAddress` | Route prefix | e.g., `g.alice` |
| Follow list (NIP-02) | Peer list | Social graph = network graph |
| `kind:10032` event | Peer configuration | Connector metadata |

## Authentication Strategies

### Strategy 1: Static Token in kind:10032

Peers publish auth tokens in their ILP Peer Info event:

```json
{
  "kind": 10032,
  "tags": [
    ["ilp_address", "g.alice"],
    ["btp_endpoint", "ws://alice.example:4000"],
    ["btp_auth", "public-shared-token"]
  ]
}
```

**Pros:** Simple, self-contained
**Cons:** Token is public, limited security

### Strategy 2: NIP-44 Encrypted Exchange

Use SPSP request/response to exchange tokens:

```typescript
const spspClient = new NostrSpspClient({ relays, secretKey });
const params = await spspClient.requestSpspParams(peerPubkey);
// params.sharedSecret can be used as auth token
```

**Pros:** End-to-end encrypted, fresh secrets
**Cons:** Requires online peer, more complex

### Strategy 3: Derived from Nostr Keys

Derive BTP auth token from NIP-44 conversation key:

```typescript
import { nip44 } from 'nostr-tools';

const conversationKey = nip44.getConversationKey(mySecretKey, peerPubkey);
const authToken = bytesToHex(conversationKey).slice(0, 32);
```

**Pros:** Deterministic, no exchange needed
**Cons:** Both sides must implement same derivation

## Complete Example

See [examples/nostr-discovery-bridge/](../examples/nostr-discovery-bridge/) for a complete working example with:

- Docker Compose setup
- agent-runtime connector configuration
- Nostr discovery bridge service
- Test relays and sample events

## Troubleshooting

### Peer not connecting

1. Check BTP endpoint is reachable: `wscat -c ws://host:port`
2. Verify auth token matches on both sides
3. Check agent-runtime logs for connection errors
4. Ensure firewall allows WebSocket connections

### Routes not working

1. Verify route prefix matches ILP address format
2. Check `GET /admin/routes` to see current routing table
3. Ensure peer is connected before adding routes
4. Check priority - higher priority routes take precedence

### Trust scores not updating

1. Verify Nostr relays are accessible
2. Check that follow lists (kind:3) are published
3. Ensure `trustManager.initialize()` completes
4. Monitor relay connections with `pool.ensureRelay()`

## Next Steps

1. **NIP Proposal**: Formalize event kinds 10032, 10047, 23194, 23195
2. **Auth Token Standard**: Define canonical BTP auth derivation from Nostr keys
3. **Credit Limit Integration**: Wire trust scores to actual credit limits in settlement
4. **Route Propagation**: Implement kind:10033 for multi-hop route announcements
