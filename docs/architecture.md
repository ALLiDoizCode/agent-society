# Architecture

TOON Protocol is a monorepo with packages organized into four layers. Each layer has a single responsibility.

## System Layers

```
┌─────────────────────────────────────────────────────┐
│  Discovery Layer                                    │
│  @toon-protocol/core                                │
│  Find peers via Nostr events (kind:10032)           │
│  Bootstrap into the network                         │
├─────────────────────────────────────────────────────┤
│  Addressing Layer                                   │
│  Hierarchical ILP addresses from peering topology   │
│  g.toon → g.toon.{peer} → g.toon.{peer}.{child}    │
│  Fee-per-byte advertisement for routing economics   │
├─────────────────────────────────────────────────────┤
│  Payment Layer                                      │
│  ILP Connector (@toon-protocol/connector)           │
│  Route micropayments between peers                  │
│  Each hop deducts its fee and forwards the rest     │
├─────────────────────────────────────────────────────┤
│  Storage Layer                                      │
│  @toon-protocol/relay + @toon-protocol/bls          │
│  Accept paid events, store them, serve for free     │
└─────────────────────────────────────────────────────┘
```

**Key distinction:** Identity (Nostr pubkey) is permanent. ILP addresses are ephemeral — derived from peering topology, one per upstream connection. A node with two upstream peers has two ILP addresses. See [Protocol — ILP Address Hierarchy](protocol.md#ilp-address-hierarchy) for details.

## Package Dependency Graph

```
@toon-protocol/town
├── @toon-protocol/sdk
│   └── @toon-protocol/core
├── @toon-protocol/relay
│   └── @toon-protocol/core
└── @toon-protocol/connector (peer dependency)

@toon-protocol/bls
└── @toon-protocol/core
```

- **`@toon-protocol/core`** — Foundation with no TOON dependencies. Provides bootstrap, discovery, settlement negotiation, [TOON](https://github.com/toon-format/toon) codec, and [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md) handling.
- **`@toon-protocol/sdk`** — Framework layer. Adds identity derivation, handler registry, verification pipeline, pricing validation, and node composition on top of core.
- **`@toon-protocol/relay`** — [Nostr](https://github.com/nostr-protocol/nips) relay server with WebSocket ([NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)), SQLite event store, and upstream relay propagation.
- **`@toon-protocol/town`** — Production relay. Composes SDK + relay + BLS + storage into a single `startTown()` call.
- **`@toon-protocol/bls`** — Standalone business logic server. HTTP endpoint that validates ILP packets and stores events.
- **`@toon-protocol/faucet`** — Development tool. Distributes test ETH and tokens for local development.

## Data Flow

### Writing (Paid)

```
Client              Connector               BLS                    EventStore
  │                      │                    │                         │
  │  ILP Prepare         │                    │                         │
  │  (TOON event)        │                    │                         │
  │ ──────────────────> │  Route packet      │                         │
  │                      │ ──────────────────>│                         │
  │                      │                    │  1. Decode TOON          │
  │                      │                    │  2. Verify signature     │
  │                      │                    │  3. Check payment        │
  │                      │                    │  4. Store event ────────>│
  │                      │                    │  5. Generate proof       │
  │  ILP Fulfill         │  Return fulfillment│                         │
  │ <────────────────── │ <──────────────────│                         │
```

Validation order matters — TOON format is checked **before** payment. Malformed events are rejected immediately, even if payment is correct. This prevents paying to store garbage data.

#### Multi-Chain Settlement

The payment a write carries is a signed payment-channel balance proof, and that proof can be denominated on **EVM, Solana, or Mina**. A client built from a single BIP-39 mnemonic derives an identity on each chain (Nostr/EVM share secp256k1; Solana is Ed25519; Mina is Pallas) and signs the claim format that chain's connector verifier expects — EIP-712 for EVM, a raw Ed25519 message for Solana, a Pallas-Schnorr claim over a Poseidon commitment for Mina. When the destination is a Townhouse apex, the apex validates the claim, fulfills, and auto-drives the on-chain redemption on the matching chain once the per-channel settlement threshold is exceeded. The EVM and Solana paths credit the recipient on-chain (Solana at channel close via `SETTLE_CHANNEL`); on Mina the per-publish claim redeems on-chain (`claimFromChannel`, apex co-signs the counterparty signature) but recipient credit-at-close is a deferred follow-up (Story 34.4). Full detail: [Settlement →](settlement.md).

### Reading (Free)

```
Client              Relay
  │                   │
  │  REQ (filter)     │
  │ ───────────────> │
  │                   │  Query EventStore
  │  EVENT (TOON)     │
  │ <─────────────── │
  │  EOSE             │
  │ <─────────────── │
```

Reads use the standard [Nostr](https://github.com/nostr-protocol/nips) WebSocket protocol ([NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)). Events are served in [TOON format](https://github.com/toon-format/toon).

## Deployment Modes

### Embedded (Library)

Import SDK packages directly. The connector runs in-process — zero network overhead.

```typescript
import { createNode, fromMnemonic } from '@toon-protocol/sdk';

const node = createNode({ secretKey, connector, ...config });
await node.start();
```

Best for: AI agents, custom services, applications that need ILP payment capabilities.

### Standalone (Docker)

Run as a microservice using the SDK E2E infrastructure.

```bash
./scripts/sdk-e2e-infra.sh up
```

| Port | Service | Protocol |
|------|---------|----------|
| 19100 | Peer 1 BLS — ILP packet validation | HTTP |
| 19700 | Peer 1 Nostr relay — event reads | WebSocket |

Best for: Relay operators, infrastructure providers.

### One-Call API (Town)

Use `startTown()` or the CLI for a complete relay with minimal configuration.

```bash
npx @toon-protocol/town --mnemonic "..." --connector-url http://localhost:8080
```

Best for: Quick relay deployment, testing, development.
