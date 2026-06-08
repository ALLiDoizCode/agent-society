# Settlement

TOON uses payment channels for off-chain micropayments, settled on-chain when needed. Settlement is **multi-chain**: a client can settle on EVM, Solana, or Mina, signing the claim format each chain's connector verifier expects. See [Multi-Chain Claims](#multi-chain-claims) below.

## Chain Negotiation

When two nodes want to peer, they need to agree on which blockchain to use for settlement. This happens automatically using publicly advertised kind:10032 data.

**Algorithm:**

1. Both nodes publish kind:10032 events listing their supported chains
2. The joining node reads the peer's kind:10032 event
3. `negotiateSettlementChain()` finds the intersection of supported chains
4. Picks the optimal chain (prefer mainnet over testnet, lower fees over higher)

**Chain format:** `{blockchain}:{network}:{chainId}`

| Example | Chain |
|---------|-------|
| `evm:arbitrum:42161` | Arbitrum One (mainnet) |
| `evm:arbitrum:421614` | Arbitrum Sepolia (testnet) |
| `evm:anvil:31337` | Local Anvil |

## Payment Channels

Channels are opened unilaterally — the joining node opens a channel on the negotiated chain's TokenNetwork contract without requiring the peer's cooperation.

**How channels work:**

1. Joiner calls `openChannel(peerAddress, timeout)` on the TokenNetwork contract
2. TokenNetwork enforces one open channel per participant pair
3. Off-chain balance updates happen via signed BTP claims
4. On-chain settlement claims can be submitted at any time — the channel remains open for continued use

### Self-Describing BTP Claims

Each BTP claim includes all the information needed for verification:

- `chainId` — Which chain the channel is on
- `tokenNetworkAddress` — Which TokenNetwork contract
- `tokenAddress` — Which token
- `channelId` — Which channel

The receiving connector verifies the channel on-chain the first time it sees a new channel (TOFU model — trust on first use), then caches the verification for subsequent claims.

### EIP-712 Signatures

Claims use EIP-712 typed data signatures with `chainId` and `verifyingContract` in the domain separator. This makes claims tamper-proof and chain-specific — a claim from one chain cannot be replayed on another.

## Multi-Chain Claims

A client built from a single BIP-39 mnemonic derives an identity on every supported chain (Nostr/EVM share secp256k1; Solana is Ed25519; Mina is Pallas). When it pays a destination, it builds the **chain-appropriate** balance-proof claim for the channel it negotiated, and the connector validates each by `blockchain` type:

| Chain      | Signature scheme                                                                                                                | Claim shape (per-publish balance proof)                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **EVM**    | EIP-712 over `keccak256(channelId ‖ cumulativeAmount ‖ nonce ‖ recipient)`                                                      | `{ blockchain:'evm', channelId (0x hex), nonce, transferredAmount, signature }`                                                           |
| **Solana** | Ed25519 over the raw on-chain message `channel_pda(32) ‖ nonce(8 LE) ‖ transferredAmount(8 LE)`                                 | `{ blockchain:'solana', channelAccount (base58 PDA), programId, nonce, transferredAmount, signature (base64), signerPublicKey (base58) }` |
| **Mina**   | Pallas-Schnorr over `[balanceCommitment, nonce, channelHash]`, where `balanceCommitment = Poseidon([balanceA, balanceB, salt])` | `{ blockchain:'mina', zkAppAddress (B62), tokenId, balanceCommitment, salt, nonce, proof (base64), signerPublicKey (B62) }`               |

The canonical hash/field layouts live in `@toon-protocol/core` (`packages/core/src/settlement/`) so client signers and connector verifiers cannot drift.

### On-Chain Settlement Through a Townhouse Apex

When a client pays a Townhouse apex, the apex validates the claim, returns FULFILL, and — once the per-channel settlement threshold is exceeded — auto-drives the on-chain redemption (the client never submits a settlement transaction itself):

- **EVM** — net balance settled on the `TokenNetwork` contract.
- **Solana** — the connector calls `CLAIM_FROM_CHANNEL` per advancing claim; the recipient's tokens are credited **at channel close** via `SETTLE_CHANNEL` (vault → recipient ATA).
- **Mina** — the connector calls `claimFromChannel` per advancing claim, **co-signing the counterparty signature** with the apex Mina key, so the on-chain zkApp nonce and balance commitment advance and the tx lands. The recipient's tokens are credited **at channel close** via the Story 34.4 fund-custody zkApp (`@toon-protocol/connector` ≥3.10.0): `deposit()` escrows the deposit on the zkApp account and `settle()` drains the custodied balance to the participants (`balanceB`→recipient / apex, `balanceA`→depositor refund) — the Mina analog of Solana's `SETTLE_CHANNEL` vault→recipient transfer.

(Verified against `@toon-protocol/connector` 3.10.0; see `packages/sdk/CONNECTOR_MIGRATION.md` for the version-by-version settlement history.)

## Settlement Info in kind:10032

Nodes advertise their settlement capabilities in kind:10032 events:

```json
{
  "supportedChains": ["evm:base:84532", "evm:base:31337"],
  "settlementAddresses": {
    "evm:base:84532": "0xABC...",
    "evm:base:31337": "0xDEF..."
  },
  "tokenNetworks": {
    "evm:base:31337": "0xCafac3dD18aC6c6e92c921884f9E4176737C052c"
  },
  "preferredTokens": {
    "evm:base:31337": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  }
}
```

The TokenNetwork address (not the registry address) must be published — peers use this to open channels directly.

## Contracts (Local Anvil)

These addresses are deterministic from the Anvil deployment:

| Contract | Address |
|----------|---------|
| Mock USDC (ERC20) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TokenNetworkRegistry | `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` |
| TokenNetwork (USDC) | `0xCafac3dD18aC6c6e92c921884f9E4176737C052c` |
