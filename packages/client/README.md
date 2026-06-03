# @toon-protocol/client

High-level TypeScript client for publishing Nostr events to the TOON protocol — an ILP-gated Nostr relay that enables sustainable relay operation through micropayments.

## What It Does

This client handles:

- **ILP Micropayments**: Pay to publish Nostr events (read is free)
- **Payment Channels**: Automatic on-chain channel creation with off-chain settlement via signed balance proofs
- **Unified Identity**: One Nostr key = one EVM address (both secp256k1, derived automatically) — or a single BIP-39 **mnemonic** to derive a full multi-chain identity
- **Multi-Chain Settlement**: Sign payment-channel claims on EVM (EIP-712), Solana (Ed25519), and Mina (Pallas) from one mnemonic
- **Multi-Hop Routing**: Publish to any destination address, not just your direct peer
- **Network Bootstrap**: Automatically discover and register with ILP peers via NIP-02 follow lists
- **TOON Encoding**: Native binary format for agent-friendly event encoding

## Installation

```bash
pnpm add @toon-protocol/client @toon-protocol/core @toon-protocol/relay nostr-tools

# Optional — only needed to derive/sign on Mina (Pallas):
pnpm add mina-signer
```

## Prerequisites

The client requires external services. Use the SDK E2E infrastructure for local development:

```bash
# Start SDK E2E infrastructure
./scripts/sdk-e2e-infra.sh up

# Verify services are healthy
curl http://localhost:19100/health  # Peer 1 BLS
curl http://localhost:19110/health  # Peer 2 BLS
# Nostr relays on ws://localhost:19700 and ws://localhost:19710 (WebSocket, no HTTP endpoint)

# Stop infrastructure
./scripts/sdk-e2e-infra.sh down
```

| Service          | Port  | Purpose                                             |
| ---------------- | ----- | --------------------------------------------------- |
| **Anvil**        | 18545 | Local EVM chain (chain ID 31337)                    |
| **Peer 1 BLS**   | 19100 | Validates events, calculates pricing, stores events |
| **Peer 1 Relay** | 19700 | WebSocket relay for peer discovery (kind:10032)     |
| **Peer 2 BLS**   | 19110 | Validates events, calculates pricing, stores events |
| **Peer 2 Relay** | 19710 | WebSocket relay for peer discovery (kind:10032)     |

---

## Quick Start

```typescript
import { ToonClient } from '@toon-protocol/client';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';

// 1. Generate identity — one key gives you both Nostr and EVM identities
const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

// 2. Create client
const client = new ToonClient({
  connectorUrl: 'http://localhost:8080',
  secretKey,
  ilpInfo: {
    pubkey,
    ilpAddress: `g.toon.${pubkey.slice(0, 8)}`,
    btpEndpoint: 'ws://localhost:3000',
  },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,
});

// 3. Start (bootstrap network, discover peers)
await client.start();

// Your EVM address is derived from the same key — no separate config needed
console.log(`EVM address: ${client.getEvmAddress()}`);

// 4. Publish event to relay via ILP payment
const event = finalizeEvent(
  { kind: 1, content: 'Hello from TOON!', tags: [], created_at: Math.floor(Date.now() / 1000) },
  secretKey,
);

const result = await client.publishEvent(event);
if (result.success) {
  console.log(`Published: ${result.eventId}`);
}

// 5. Clean up
await client.stop();
```

---

## Identity & Multi-Chain Settlement

There are two ways to give the client an identity:

### 1. Raw `secretKey` — Nostr + EVM (secp256k1)

A 32-byte Nostr key. Because Nostr and EVM both use secp256k1, the same key provides your EVM identity automatically. This is the path shown in the Quick Start, and it only supports EVM settlement.

### 2. `mnemonic` — full multi-chain identity (recommended for non-EVM)

A single BIP-39 phrase derives **all** chain identities: Nostr (NIP-06) + EVM (secp256k1), Solana (Ed25519), and Mina (Pallas). This is required to settle on Solana or Mina — a raw secp256k1 `secretKey` cannot represent those curves.

```typescript
import { ToonClient, generateMnemonic, deriveFullIdentity } from '@toon-protocol/client';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';

const mnemonic = generateMnemonic(); // or restore an existing 12-word phrase
const { nostr } = await deriveFullIdentity(mnemonic); // peek at the derived keys if needed

const client = new ToonClient({
  connectorUrl: 'http://localhost:8080',
  mnemonic, // derives Nostr/EVM synchronously; Solana/Mina during start()
  ilpInfo: {
    pubkey: nostr.pubkey,
    ilpAddress: `g.toon.${nostr.pubkey.slice(0, 8)}`,
    btpEndpoint: 'ws://localhost:3000',
  },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,
});

await client.start();

// EVM is available before start(); Solana/Mina are derived during start()
console.log('Nostr: ', client.getPublicKey());
console.log('EVM:   ', client.getEvmAddress());
console.log('Solana:', client.getSolanaAddress()); // base58, after start()
console.log('Mina:  ', client.getMinaAddress());   // base58, after start() (needs mina-signer)
```

**Notes & rules:**

- **Precedence**: `mnemonic` and `secretKey` are mutually exclusive (a separate `secretKey` would split the Nostr identity from the Solana/Mina identity — the client rejects it). An `evmPrivateKey` override **is** allowed alongside `mnemonic` (e.g. a hardware-wallet EVM key while still deriving Solana/Mina from the phrase).
- **Solana/Mina addresses** (`getSolanaAddress()`, `getMinaAddress()`) are only available **after `start()`** — those keys are derived asynchronously. `getEvmAddress()`/`getPublicKey()` work before `start()`.
- **Mina is optional**: it requires the `mina-signer` peer dependency (see Installation). Without it, the client still works for Nostr/EVM/Solana and `getMinaAddress()` returns `undefined`.
- **Security**: JavaScript strings can't be zeroed from memory, so a `mnemonic` may linger in the heap. For high-security contexts, derive keys yourself (e.g. via `KeyManager`) and pass a pre-derived `secretKey`.
- Balance-proof claims are signed with the canonical layout the connector verifies: EVM via EIP-712, Solana/Mina via the shared hashes in `@toon-protocol/core` (`balanceProofHashSolana` / `balanceProofFieldsMina`).

---

## Payment Channels

The client supports payment channels for off-chain settlement on EVM, Solana, and Mina. With a raw `secretKey` you get EVM only; construct from a `mnemonic` (above) to settle on Solana/Mina. Your EVM identity is derived automatically — no separate EVM key needed.

### Enabling Payment Channels

To use payment channels, add chain configuration. The client already has your EVM identity from `secretKey`:

```typescript
const client = new ToonClient({
  connectorUrl: 'http://localhost:8080',
  secretKey,
  ilpInfo: { pubkey, ilpAddress: `g.toon.${pubkey.slice(0, 8)}`, btpEndpoint: 'ws://localhost:3000' },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,

  // Add chain config to enable payment channels
  supportedChains: ['evm:anvil:31337'],
  chainRpcUrls: { 'evm:anvil:31337': 'http://localhost:8545' },
  settlementAddresses: { 'evm:anvil:31337': client.getEvmAddress()! },
  tokenNetworks: { 'evm:anvil:31337': '0xCafac3dD18aC6c6e92c921884f9E4176737C052c' },
  initialDeposit: '1000000000000000000', // 1 ETH in wei
});

await client.start();

// Channels are created automatically during bootstrap
const channels = client.getTrackedChannels();
console.log(`Tracking ${channels.length} payment channels`);

// Publish with signed balance proof
const channelId = channels[0];
const claim = await client.signBalanceProof(channelId, 1000n);
await client.publishEvent(event, { claim });
```

### How It Works

1. **Bootstrap**: Client discovers peers via NIP-02 and kind:10032 events
2. **Channel Creation**: Opens on-chain payment channel using your derived EVM address
3. **Off-chain Payments**: Signed balance proofs settle payments off-chain
4. **Auto-tracking**: ChannelManager automatically tracks channels and increments nonces

### Using a Separate EVM Key (Advanced)

If you need a different EVM identity than your Nostr key (e.g., hardware wallet or custodial key), pass `evmPrivateKey` explicitly:

```typescript
const client = new ToonClient({
  // ... required config ...
  evmPrivateKey: '0x...', // Overrides the default derivation from secretKey
});
```

---

## Documentation

- **[API Reference](docs/api-reference.md)** — Constructor, config interface, and all methods
- **[Error Handling](docs/error-handling.md)** — Error class hierarchy, codes, and usage patterns
- **[HTTP Adapters](docs/adapters.md)** — Low-level `HttpRuntimeClient`, `HttpConnectorAdmin`, and `withRetry`
- **[Troubleshooting](docs/troubleshooting.md)** — Common issues and solutions

---

## Testing

### Unit & Integration Tests

```bash
cd packages/client
pnpm test                 # Run all unit/integration tests
pnpm test:coverage        # Run with coverage report
```

### E2E Tests

E2E tests require the SDK E2E infrastructure:

```bash
# Start infrastructure
./scripts/sdk-e2e-infra.sh up

# Run E2E tests
cd packages/client
pnpm test:e2e
```

See [tests/e2e/README.md](tests/e2e/README.md) for detailed E2E setup.

---

## Examples

See [examples/client-example/](../../examples/client-example/) for standalone client examples:

- **01 - Publish Event**: Full client lifecycle with self-describing claims
- **02 - Payment Channel Lifecycle**: Multiple events with incrementing balance proofs

---

## Related Packages

- **[@toon-protocol/core](../core/)** — Core protocol (peer discovery, bootstrap)
- **[@toon-protocol/relay](../relay/)** — Nostr relay with ILP payment gating
- **[@toon-protocol/bls](../bls/)** — Business Logic Server (pricing, validation, storage)

---

## License

MIT
