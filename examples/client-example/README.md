# Client Examples

Standalone `@toon-protocol/client` examples that connect to external TOON peer containers.

## Quick Start (Dogfooding)

```bash
# 1. Clone and build
git clone https://github.com/toon-protocol/town.git && cd town
pnpm install && pnpm build

# 2. Start the devnet (EVM + Solana + Mina)
./scripts/sdk-e2e-infra.sh up

# 3. Publish your first event
cd examples/client-example && pnpm run example:03
```

## Key Difference from SDK/Town

- **SDK/Town**: The connector creates and attaches signed claims to every packet automatically.
- **Client (legacy)**: YOU create self-describing claims via `signBalanceProof()` and attach them to each `publishEvent()` call.
- **Client (lazy channels)**: Just call `publishEvent()` — the client opens channels and signs claims automatically on first use.

The client does not run its own connector. It connects to external peer containers via BTP and manages its own balance proofs.

## Prerequisites

Start the SDK E2E infrastructure:

```bash
./scripts/sdk-e2e-infra.sh up
```

This starts:

| Service | Port | Purpose |
|---------|------|---------|
| Anvil (EVM) | 18545 | Local Ethereum (chain 31337) |
| Solana | 19899 | Solana test validator |
| Mina GraphQL | 19085 | Mina lightnet daemon |
| Mina Accounts | 19181 | Mina accounts manager |
| Peer1 BTP | 19000 | BTP WebSocket endpoint |
| Peer1 BLS | 19100 | Business Logic Server |
| Peer1 Relay | 19700 | Nostr relay (WebSocket) |
| Peer2 BTP | 19010 | BTP WebSocket endpoint |
| Peer2 BLS | 19110 | Business Logic Server |
| Peer2 Relay | 19710 | Nostr relay (WebSocket) |

## Examples

### 01 - Publish Event (Manual Claims)

Demonstrates the complete standalone client lifecycle with manual claim signing: fund wallet, bootstrap, open payment channel, sign a self-describing EIP-712 claim, publish a Nostr event, and verify it on the relay.

```bash
pnpm run example:01
```

### 02 - Payment Channel Lifecycle

Publishes multiple events with incrementing balance proofs, showing cumulative nonces and amounts. Queries on-chain channel state to verify participants and deposits.

```bash
pnpm run example:02
```

### 03 - Multi-Chain Publish (Lazy Channels)

**Flagship dogfooding example.** Uses lazy channels — ToonClient opens payment channels automatically on first publish. No manual channel management needed.

```bash
pnpm run example:03
```

Supports multi-chain configuration (EVM, Solana, Mina). See the source file for commented-out Solana/Mina configuration examples.

### 04 - Subscribe to Events (Read-Side)

Connects to a peer's relay and subscribes to kind:1 events. Reading is free — no payment needed. Run this in a separate terminal while publishing events.

```bash
pnpm run example:04
```

Press Ctrl+C to stop.

## Multi-Chain Configuration

By default, examples use EVM (Anvil). To configure additional chains:

```typescript
// Solana
supportedChains: ['evm:base:31337', 'solana:devnet'],
chainRpcUrls: {
  'evm:base:31337': 'http://localhost:18545',
  'solana:devnet': 'http://localhost:19899',
},

// Mina
supportedChains: ['evm:base:31337', 'mina:devnet'],
chainRpcUrls: {
  'evm:base:31337': 'http://localhost:18545',
  'mina:devnet': 'http://localhost:19085/graphql',
},
```

## Troubleshooting

- **Peer1 not healthy**: Run `./scripts/sdk-e2e-infra.sh up` and wait for the health checks.
- **Channel open fails**: Ensure your Anvil account has USDC tokens (Account #9 is pre-funded).
- **Mina tests slow**: Mina proof generation takes 30-60s even with `proof-level=none`. Use 180s timeouts.
- **Solana program not found**: Check that `contracts/solana/payment_channel.so` exists and the keypair is included.

## Notes

- Examples use **Anvil Account #9** (`0xa0Ee7A142d267C1f36714E4a8F75612F20a79720`).
- Contract addresses are deterministic from the Anvil deployment.
- Peer1 prefers EVM, Peer2 prefers Solana (for mixed-chain testing).

## Teardown

```bash
./scripts/sdk-e2e-infra.sh down
```
