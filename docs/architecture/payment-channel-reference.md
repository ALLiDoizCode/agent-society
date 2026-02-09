# Payment Channel Reference (from agent-runtime)

This document provides the interfaces, lifecycle, and settlement flow for payment channels as implemented in the agent-runtime connector. Agent-society needs this reference to open, manage, and settle payment channels during SPSP handshakes.

> **Source:** `agent-runtime/packages/connector/src/settlement/`

---

## Architecture Overview

```
Agent-Society BLS
  │
  ├─ POST /admin/peers (with settlement config)
  │   → Connector registers peer + creates PeerConfig
  │
  ├─ POST /ilp/send (SPSP handshake)
  │   → Agent-runtime → Connector → ILP network → peer
  │
  └─ On-chain channel opening (during SPSP handling)
      → PaymentChannelSDK.openChannel() (EVM)
      → XRPChannelSDK.openChannel() (XRP)
      → AptosChannelSDK.openChannel() (Aptos)

Connector handles claim exchange automatically via BTP sub-protocol
```

## Per-Peer Settlement Configuration

Each peer has independent settlement preferences. When registering a peer via `POST /admin/peers`, include settlement config:

```typescript
interface PeerConfig {
  peerId: string;
  address: string;                                    // ILP address
  settlementPreference: 'evm' | 'xrp' | 'aptos' | 'any' | 'both';
  settlementTokens: string[];                         // Supported tokens
  evmAddress?: string;                                // 0x-prefixed Ethereum address
  xrpAddress?: string;                                // r-prefixed XRP address
  aptosAddress?: string;                              // 0x-prefixed Aptos address
  aptosPubkey?: string;                               // 64-char hex ed25519 pubkey
}
```

---

## EVM Payment Channels (Base L2)

### Opening a Channel

```typescript
// PaymentChannelSDK.openChannel()
async openChannel(
  participant2: string,       // Counterparty's 0x address
  tokenAddress: string,       // ERC20 token contract (e.g., AGENT token)
  settlementTimeout: number,  // Challenge period in seconds (e.g., 86400 = 24h)
  initialDeposit: bigint      // Initial deposit in token smallest unit (0 for none)
): Promise<{
  channelId: string;          // bytes32 channel identifier
  txHash: string;             // On-chain transaction hash
}>
```

- Calls `TokenNetwork.openChannel()` smart contract
- If `initialDeposit > 0`, also calls `deposit()`
- Channel ID comes from `ChannelOpened` event
- **For MVP, always opens a new channel** (channel reuse deferred)

### Depositing Funds

```typescript
async deposit(
  channelId: string,
  tokenAddress: string,
  amount: bigint
): Promise<void>
```

- Approves ERC20 spend (max uint256 approval) then deposits
- Can be called multiple times to add funds

### Signing Balance Proofs

```typescript
async signBalanceProof(
  channelId: string,
  nonce: number,                // Monotonically increasing
  transferredAmount: bigint,    // Cumulative amount transferred
  lockedAmount?: bigint,        // Pending HTLCs (default: 0)
  locksRoot?: string            // Merkle root (default: 0x0...)
): Promise<string>              // secp256k1 signature (EIP-712)
```

### Verifying Balance Proofs

```typescript
async verifyBalanceProof(
  balanceProof: BalanceProof,
  signature: string,
  expectedSigner: string        // 0x address
): Promise<boolean>
```

### Closing & Settlement

```typescript
// Unilateral close (starts challenge period)
async closeChannel(
  channelId: string,
  tokenAddress: string,
  balanceProof: BalanceProof,
  signature: string
): Promise<void>

// Cooperative close (immediate, both parties agree)
async cooperativeSettle(
  channelId: string,
  tokenAddress: string,
  myBalanceProof: BalanceProof,
  mySignature: string,
  theirBalanceProof: BalanceProof,
  theirSignature: string
): Promise<void>

// Finalize after challenge period expires
async settleChannel(
  channelId: string,
  tokenAddress: string
): Promise<void>
```

### Querying State

```typescript
async getChannelState(channelId: string, tokenAddress: string): Promise<ChannelState>
async getMyChannels(tokenAddress: string): Promise<string[]>
async getSignerAddress(): Promise<string>
async getTokenNetworkAddress(tokenAddress: string): Promise<string>
```

### Event Listeners

```typescript
async onChannelOpened(tokenAddress: string, callback: (event) => void): Promise<void>
async onChannelClosed(tokenAddress: string, callback: (event) => void): Promise<void>
async onChannelSettled(tokenAddress: string, callback: (event) => void): Promise<void>
async onChannelCooperativeSettled(tokenAddress: string, callback: (event) => void): Promise<void>
removeAllListeners(): void
```

---

## XRP Payment Channels

### Opening a Channel

```typescript
// XRPChannelSDK.openChannel()
async openChannel(
  destination: string,    // r-address
  amount: string,         // XRP drops
  settleDelay: number,    // seconds
  peerId?: string         // for telemetry
): Promise<string>        // Returns channelId (64-char hex)
```

- Submits `PaymentChannelCreate` transaction to XRP Ledger
- Returns channel ID from validated transaction

### Claims

```typescript
interface XRPClaim {
  channelId: string;      // 64-char hex (256-bit hash)
  amount: string;         // XRP drops as string
  signature: string;      // 128-char hex (ed25519 signature)
  publicKey: string;      // 66-char hex (ED prefix + 64 hex)
}

async signClaim(channelId: string, amount: string): Promise<XRPClaim>
async verifyClaim(claim: XRPClaim): Promise<boolean>
async submitClaim(claim: XRPClaim, peerId?: string): Promise<void>
```

### Channel Lifecycle

```typescript
async fundChannel(channelId: string, additionalAmount: string): Promise<void>
async closeChannel(channelId: string, peerId?: string): Promise<void>
async getChannelState(channelId: string): Promise<XRPChannelState>
async getMyChannels(): Promise<string[]>
startAutoRefresh(): void    // 30s interval polling
stopAutoRefresh(): void
```

---

## Aptos Payment Channels

### Opening a Channel

```typescript
// AptosChannelSDK.openChannel()
async openChannel(
  destination: string,         // 0x-prefixed 64-char hex
  destinationPubkey: string,   // 64-char hex (32 bytes ed25519)
  amount: bigint,              // octas (1 APT = 100M octas)
  settleDelay?: number         // seconds (default: 86400)
): Promise<string>             // Returns channel owner address
```

### Claims

```typescript
interface AptosClaim {
  channelOwner: string;
  amount: bigint;
  nonce: number;          // Auto-incremented
  signature: string;      // ed25519
}

signClaim(channelOwner: string, amount: bigint): AptosClaim
verifyClaim(claim: AptosClaim): boolean
async submitClaim(claim: AptosClaim): Promise<void>
```

### Two-Phase Closure

```typescript
async requestClose(channelOwner: string): Promise<void>   // Start challenge period
async finalizeClose(channelOwner: string): Promise<void>   // After settleDelay
```

### State & Lifecycle

```typescript
async getChannelState(channelOwner: string): Promise<AptosChannelState | null>
getMyChannels(): string[]
async deposit(amount: bigint): Promise<void>
startAutoRefresh(): void
stopAutoRefresh(): void
```

---

## Settlement Routing (UnifiedSettlementExecutor)

The connector's `UnifiedSettlementExecutor` routes settlement based on per-peer config:

```
Token type + PeerConfig.settlementPreference → Settlement method

APT token + allows aptos  → Aptos settlement
XRP token + allows xrp    → XRP settlement
ERC20     + allows evm    → EVM settlement
Incompatible              → Error
```

Settlement is triggered by `SettlementMonitor` when balance thresholds are exceeded. The executor:
1. Opens channel (if none exists)
2. Signs balance proof / claim
3. Sends claim to peer via BTP `payment-channel-claim` sub-protocol
4. Updates TigerBeetle accounts

---

## BTP Claim Exchange (Epic 17)

Claims are exchanged over the existing BTP WebSocket using a sub-protocol:

```typescript
// BTP message with claim
{
  protocolData: [
    {
      protocolName: 'ilp',
      contentType: 0,
      data: <ILP PREPARE/FULFILL/REJECT>
    },
    {
      protocolName: 'payment-channel-claim',  // Epic 17
      contentType: 1,                         // application/json
      data: <balance proof JSON>
    }
  ]
}
```

**EVM claim structure:**
```json
{
  "version": "1.0",
  "blockchain": "evm",
  "channelId": "0x...",
  "nonce": 42,
  "transferredAmount": "5000000",
  "lockedAmount": "0",
  "locksRoot": "0x000...",
  "signature": "0x...",
  "publicKey": "0x..."
}
```

The connector handles claim exchange automatically once a channel is opened and PeerConfig is registered. Agent-society does not need to manage ongoing claims — only the initial channel opening during SPSP.

---

## Admin API Reference

### Register Peer with Settlement

```
POST /admin/peers
Content-Type: application/json

{
  "id": "peer1",
  "url": "ws://peer1:3000",
  "authToken": "btp-secret",
  "routes": [
    { "prefix": "g.peer1", "priority": 0 }
  ],
  "settlement": {
    "preference": "evm",
    "evmAddress": "0xPEER1_ADDRESS",
    "tokenAddress": "0xAGENT_TOKEN",
    "tokenNetworkAddress": "0xTOKEN_NETWORK",
    "chainId": 8453,
    "channelId": "0xCHANNEL_ID",
    "initialDeposit": "1000000"
  }
}
```

> **Note:** The `settlement` field on `POST /admin/peers` is being added in agent-runtime Epic 20, Story 20.3. Until then, settlement config is loaded from static environment variables.

### Other Endpoints

```
GET    /admin/peers              — List all peers with settlement info
DELETE /admin/peers/:peerId      — Remove peer + routes + settlement config
POST   /admin/routes             — Add route { prefix, nextHop, priority }
GET    /admin/routes             — List all routes
DELETE /admin/routes/:prefix     — Remove route
```

---

## Key Contracts & Addresses

For local development (Anvil):
- **TokenNetworkRegistry** — Deploys TokenNetwork per token
- **TokenNetwork** — Channel operations (open, deposit, close, settle, cooperativeSettle)
- **ERC20 Token** — The settlement token (e.g., AGENT token)

For Base Sepolia testnet:
- Addresses configured via `M2M_TOKEN_ADDRESS`, `TOKEN_NETWORK_REGISTRY_ADDRESS` env vars

---

## What Agent-Society Needs to Do

During an SPSP handshake (kind:23194 → kind:23195), agent-society's BLS:

1. **Receives** SPSP request with peer's settlement preferences (supported chains, addresses, preferred tokens)
2. **Negotiates** chain by intersecting both peers' supported chains
3. **Opens channel** on the negotiated chain using the appropriate SDK (or via connector API)
4. **Waits** for on-chain confirmation (synchronous — the ILP FULFILL is only returned after the channel is confirmed)
5. **Returns** SPSP response with negotiated chain, channelId, and settlement addresses in the ILP FULFILL data
6. **Registers peer** via `POST /admin/peers` with settlement config so the connector knows about the channel

The connector then handles ongoing claim exchange automatically via BTP.
