# Vendored Contracts

Chain contracts vendored from the connector repository for self-contained builds.

## Source

- **Repository:** `https://github.com/toon-protocol/connector`
- **Commit:** `8b6b3c53`
- **Date:** 2026-03-31

## Structure

- `evm/` — Foundry EVM contracts (TokenNetwork, TokenNetworkRegistry, MockUSDC)
- `solana/` — Pre-compiled Solana BPF programs (.so) + keypair for deterministic program ID

## Building

### EVM (requires Foundry)

```bash
cd evm && forge build
```

### Solana

Pre-compiled — no build step needed. Programs are deployed by the Solana test-validator entrypoint.
