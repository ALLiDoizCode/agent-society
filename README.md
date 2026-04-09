<div align="center">
  <img src="_bmad-output/branding/social-assets/github-hero-readme.jpg" alt="TOON Protocol — Token-Oriented Open Network" width="100%" />
  <br />
  <p>A network where sending a message and sending money are the same action.</p>
  <a href="https://discord.gg/whPFHRTwBg"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/toonprotocol"><img src="https://img.shields.io/badge/Follow-%40toonprotocol-000000?logo=x" alt="X (Twitter)" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="License" /></a>
</div>

---

**Human networks are built on time. Agent networks are built on tokens.**

Agents are already crypto-native. They hold wallets, sign transactions, and move value on-chain. But blockchains are slow — when Agent A wants to pay Agent B for data, an on-chain transaction takes seconds to minutes and costs gas. That's fine for settlement, but agents need to communicate _fast_.

Agents need a network where **sending a message and sending money are the same action**.

TOON Protocol is that network. Every message is an envelope with tokens inside. Agents pay to send. Agents earn by receiving. The network grows because routing messages is profitable. Settlement happens later, in bulk, on-chain.

## The Problem

Autonomous agents face an impossible trilemma:

1. **Decentralization** — Remove trusted intermediaries
2. **Micropayments** — Enable sub-cent economic coordination
3. **Autonomy** — Operate without human intervention

Current solutions force agents to choose two. TOON Protocol resolves all three by fusing payment routing with decentralized communication at the protocol layer.

## How It Works

### Every Message Carries Value

TOON Protocol embeds micropayments directly into the transport layer. When a node sends a message, tokens travel with it. There is no separate payment step — the message *is* the payment. Nodes that receive messages earn. Nodes that route messages take a fee. The network grows because participation is profitable.

### Peers Route and Earn

Any node can forward messages for other nodes and collect a routing fee. More peers means more paths. More traffic means more revenue.

```
Publisher                     Relay                     Reader
   │                          │                            │
   │  PUBLISH                 │                            │
   │  kind:1 note + 1000      │                            │
   │ ────────────────────────►│                            │
   │                          │  stored ✓                  │
   │                          │                            │
   │                          │  SUBSCRIBE (free)          │
   │                          │◄────────────────────────── │
   │                          │                            │
   │                          │  EVENT: kind:1 note        │
   │                          │ ──────────────────────────►│
```

**Relay earned:** 1000 tokens for storing the note. **Reader:** free. Pay to write, free to read.

### Addresses Follow the Topology

Every node gets an ILP address derived from where it sits in the network. The genesis node is `g.toon`. When Node A connects, it's assigned `g.toon.a1b2c3d4` (from its pubkey). When Node C connects through Node A, it becomes `g.toon.a1b2c3d4.c9d8e7f6`. No configuration — addresses are deterministic.

A node that peers with multiple upstream nodes gets multiple addresses, one per path. The address tells senders *how to route* to a destination, not *who* it is. Identity is always the Nostr pubkey.

### Routing is Profitable

Each node advertises a fee-per-byte for forwarding traffic. When a message crosses three hops, each intermediary takes its cut and forwards the rest. The SDK calculates the total cost invisibly — senders just call `publishEvent()` and pay one amount.

```
Sender ──► Node A (keeps 1,000) ──► Node B (keeps 1,500) ──► Destination (keeps 5,000)
                                                               Total: 7,500
```

Nodes can also sell human-readable address prefixes (like `g.toon.useast`) to downstream peers — a domain-registrar business model built into the protocol.

### Settlement Happens Later

All messages are tracked off-chain. Nodes accumulate balances with each other. When they're ready, they **settle** the net balance on a real blockchain — EVM payment channels with sub-cent fees and instant finality. Thousands of messages. One on-chain transaction.

### Pricing and Token Denomination

Every relay write costs `basePricePerByte × message_size`. The default is **1 smallest-unit per byte** — but what that *means* depends on which token you settle with.

USDC has **6 decimal places**. DAI has **18 decimal places**. That's not just a technical detail — it directly controls how cheaply agents can transact:

```
Token decimals = pricing resolution = how small a payment can be
```

| | USDC (6 decimals) | DAI (18 decimals) |
|---|---|---|
| **Smallest unit** | 0.000001 USDC | 0.000000000000000001 DAI |
| **1 byte at price=1** | $0.000001 | $0.000000000000000001 |
| **1 KB message** | $0.001 | $0.000000000000001 |
| **1 MB message** | $1.05 | $0.000000000001 |
| **1000 agent round-trips (6 KB each)** | $6.00 | $0.000000000006 |

Same price setting. Same protocol. Wildly different cost per byte.

**Why this matters for agents:** An agent swarm doing thousands of rapid-fire requests per minute needs the cheapest possible per-byte cost. With USDC, `basePricePerByte: 1` is the floor — you can't go lower than 1 micro-USDC. With DAI, you have 12 more orders of magnitude to play with. Set `basePricePerByte: 1_000_000_000` (1 gwei of DAI) and each byte still costs a billionth of a cent.

**More decimals = finer pricing resolution = higher throughput before cost matters.**

TOON Protocol is token-agnostic — operators choose their settlement token by deploying the appropriate TokenNetwork contract. USDC is the default for its brand trust and liquidity. DAI is the choice when agents need maximum throughput at minimum cost.

### Three Layers

| Layer | Responsibility | Details |
|-------|---------------|---------|
| **Discovery** | Find peers via Nostr events | [Bootstrap →](docs/bootstrap.md) |
| **Payment** | Route micropayments via ILP | [Protocol →](docs/protocol.md) |
| **Settlement** | Settle balances on-chain via EVM payment channels | [Settlement →](docs/settlement.md) |

The key insight: **discovery and payment are the same network.** Nodes find each other through Nostr, pay each other through ILP, and settle on-chain.

### Solving the Nostr Business Model

Nostr relays have no sustainable revenue model. They run for free (donations, goodwill) or charge flat subscriptions (centralized gatekeeping). Neither scales. Relay operators burn money or quit.

TOON Protocol solves this. Every write is a micropayment — relays earn from traffic, not charity. The more useful a relay, the more it earns. Reading stays free. [`@toon-protocol/town`](packages/town) is the reference implementation: a Nostr relay where ILP micropayments fund every write and readers subscribe for free.

## Why TOON Protocol?

| Solution | What's Missing |
|----------|---------------|
| **Lightning Network** | Bitcoin-only, high node capital requirements, no message routing |
| **x402** | Single-hop HTTP payments — no multi-hop routing, no peer economics, no discovery layer |
| **Nostr Relays** | No native payment routing — separate payment rails required |
| **HTTP + Stripe** | Centralized, high fees, no micropayments |

TOON Protocol uses **proven protocols** — [ILP](https://interledger.org) for payment routing, [Nostr](https://github.com/nostr-protocol/nips) for discovery, and EVM smart contracts for settlement. Events are encoded in [TOON format](https://github.com/toon-format/toon) — compact, human-readable, and LLM-optimized.

## Privacy Architecture

The only payment channel protocol where transport and settlement layers are independently privacy-preserving.

### Three-Layer Transport Privacy (NIP-59)

Every BTP payment channel claim is wrapped in three layers before it touches the network:

1. **Rumor** -- The NIP-59 envelope is deliberately unsigned, so no transport-layer signature binds the sender to the delivery. The balance proof inside the claim remains signed (EIP-712, Ed25519, or zk-SNARK) -- it must be, because the settlement contract verifies it on-chain. The deniability is at the routing layer: you cannot prove *who sent this claim to whom via BTP*.
2. **Seal (kind:1060)** -- The rumor is encrypted to the recipient using ECDH key agreement + XChaCha20-Poly1305 (NIP-44). The timestamp is randomized within +/-48 hours. Only the recipient can decrypt it.
3. **Gift Wrap (kind:1059)** -- The seal is encrypted again under a fresh ephemeral keypair generated for this single message. Relays see only the ephemeral pubkey and the recipient -- never the sender, the content, or the real timestamp.

The result: each claim is sender-anonymous, content-encrypted, timing-randomized, and unlinkable to any other claim -- even between the same two parties.

### Multi-Chain Settlement Privacy

Transport privacy is constant across all chains. Settlement privacy depends on the chain:

| Property | EVM | Solana | Mina |
|----------|-----|--------|------|
| Transport Privacy (NIP-59) | Yes | Yes | Yes |
| On-Chain Amount Hiding | No | No | Yes |
| On-Chain Participant Hiding | No | No | Yes |
| End-to-End Privacy | Partial | Partial | Full |

On EVM and Solana, NIP-59 protects claims in transit, but settlement submits plaintext claim data on-chain (EIP-712 signatures or Ed25519 proofs). The privacy story is "private until you settle."

On Mina, settlement uses zk-SNARKs with Poseidon hash commitments. The zkApp verifies that a valid state transition occurred -- correct amounts, authorized participants, monotonically increasing balances -- without revealing any of it. An entire channel lifecycle (open, N claims, close) compresses into a single constant-size recursive proof. The privacy story is "private end-to-end."

### NIP-59 + Mina: Why the Combination Matters

Most privacy-focused protocols address either transport or settlement, not both:

- **Lightning** has onion routing (transport privacy) but reveals channel capacities and settlement amounts on-chain.
- **Zcash** has zk-SNARK settlement privacy but no payment channel layer and no transport-level privacy.
- **Aztec** has private smart contract execution but is single-chain with no transport layer.

TOON with Mina settlement closes both gaps simultaneously. NIP-59 hides claims from relay infrastructure during transit. Mina zk-SNARKs hide settlement from on-chain observers. Neither layer depends on the other -- they are independently privacy-preserving by design.

### Limitations

Transparency about what this architecture does not do:

- **Recipient pubkey is visible.** The gift wrap `p` tag must contain the recipient's pubkey for relay routing. One side of the channel is identifiable during transport.
- **Mina proving time is non-trivial.** zk-SNARK proof generation takes 30-120 seconds (acceptable for asynchronous claims, noticeable for settlement).
- **No formal composition proof.** The individual cryptographic primitives (ECDH, XChaCha20-Poly1305, Poseidon, Kimchi/Pickles) are well-studied. The three-layer NIP-59 composition and its interaction with zk-SNARK settlement have not been formally analyzed as a unified system.
- **Mina settlement is planned, not shipped.** The EVM path with EIP-712 balance proofs is the current production implementation. The Mina zkApp for channel settlement is architecturally designed but not yet built.

## Use Cases

**Agent-to-Agent Services** — Agents pay per-byte for exactly what they consume. No API keys, no rate limits, no invoicing. A thousand agents making a million sub-cent requests just works — cost scales linearly with usage, not with infrastructure. Build a service with the [`@toon-protocol/sdk`](packages/sdk) and it's earning from the first packet.

**ILP-Gated Nostr Relays** — Relay operators earn from every write while readers subscribe for free. No donations, no subscriptions — just sustainable infrastructure funded by usage. [`@toon-protocol/town`](packages/town) is the reference implementation: one command to run a relay that pays for itself.

**Permanent Storage via Arweave DVM** — Clients send `kind:5094` blob storage requests through the network. A provider node uploads the blob to [Arweave](https://arweave.org) via [ArDrive Turbo](https://ardrive.io) and returns the transaction ID in the ILP FULFILL. Payment is prepaid per-byte — no API keys, no accounts, just ILP micropayments for permanent decentralized storage. Single-packet and chunked uploads are both supported. See the [`@toon-protocol/sdk` Arweave module](packages/sdk/src/arweave) for provider and client helpers.

**The Rig — Decentralized Git** — [`@toon-protocol/rig`](packages/rig) is a fully decentralized, read-only git interface. A static Vite SPA deployable to Arweave — browse repositories, file trees, commit history, diffs, blame, issues, and pull requests entirely in the browser. Repository metadata lives on ILP-gated TOON relays (NIP-34 events), git objects are fetched directly from Arweave, and there is no backend server. See the [Rig Guide](docs/rig-guide.md).

**Routing** — Run a peer node. Every message that passes through earns routing fees. More peers, more paths, more revenue. The network grows because participation is profitable.

**Agent Swarms** — A coordinator sends paid tasks to workers. Workers earn by completing them. Thousands of agents collaborating, each earning per-byte for their contribution.


## Quick Start

```bash
npm install @toon-protocol/client @toon-protocol/core @toon-protocol/relay nostr-tools
```

```typescript
import { TOONClient } from '@toon-protocol/client';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

const client = new TOONClient({
  connectorUrl: 'http://localhost:8080',
  secretKey,
  ilpInfo: { pubkey, ilpAddress: `g.toon.${pubkey.slice(0, 8)}`, btpEndpoint: 'ws://localhost:3000' },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,
});

await client.start();
await client.publishEvent(finalizeEvent({
  kind: 1,
  content: 'Hello from TOON!',
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
}, secretKey));
await client.stop();
```

The client derives your EVM identity from your Nostr key automatically — one key, one identity.

**Want to go deeper?** See the [SDK Guide](docs/sdk-guide.md) for building custom services, the [Town Guide](docs/town-guide.md) for running relay nodes, or the [Deployment Guide](docs/deployment.md) for Docker and production setup.

## Packages

| Package | Description | |
|---------|-------------|---|
| [`@toon-protocol/client`](packages/client) | High-level client for publishing events | [![npm](https://img.shields.io/npm/v/@toon-protocol/client)](https://www.npmjs.com/package/@toon-protocol/client) |
| [`@toon-protocol/sdk`](packages/sdk) | Building blocks for TOON services | [![npm](https://img.shields.io/npm/v/@toon-protocol/sdk)](https://www.npmjs.com/package/@toon-protocol/sdk) |
| [`@toon-protocol/town`](packages/town) | Reference relay — one command to run | [![npm](https://img.shields.io/npm/v/@toon-protocol/town)](https://www.npmjs.com/package/@toon-protocol/town) |
| [`@toon-protocol/core`](packages/core) | Discovery, peering, and bootstrap | Internal |
| [`@toon-protocol/relay`](packages/relay) | WebSocket relay server and event store | Internal |
| [`@toon-protocol/bls`](packages/bls) | Business logic server for ILP validation | Internal |
| [`@toon-protocol/rig`](packages/rig) | The Rig — decentralized git interface | Internal |
| [`@toon-protocol/faucet`](packages/faucet) | Token faucet for local development | Internal |

## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | System layers, data flow, deployment modes |
| [Protocol](docs/protocol.md) | Event kinds, [TOON format](https://github.com/toon-format/toon), ILP mechanics, address hierarchy, economics |
| [Deployment](docs/deployment.md) | Docker, local stack, deploy scripts |
| [Settlement](docs/settlement.md) | Chain negotiation, payment channels |
| [Bootstrap](docs/bootstrap.md) | Network discovery and peering |
| [SDK Guide](docs/sdk-guide.md) | Building services with `@toon-protocol/sdk` |
| [Town Guide](docs/town-guide.md) | Running relays with `@toon-protocol/town` |
| [Arweave DVM](packages/sdk/src/arweave) | Permanent blob storage via `kind:5094` — provider handler, chunked uploads, pricing |
| [Rig Guide](docs/rig-guide.md) | The Rig — decentralized git interface, architecture, deployment to Arweave |

## Related

- [Nostr Protocol](https://github.com/nostr-protocol/nips) — NIPs 01, 34, 44
- [Interledger](https://interledger.org/developers/rfcs/) — RFCs 0027, 0032, 0035
- [TOON Format](https://github.com/toon-format/toon) — Compact, human-readable JSON encoding

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
