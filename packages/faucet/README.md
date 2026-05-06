# TOON Token Faucet (EVM + Solana)

A dual-chain dev faucet for local TOON development. Drips ETH + Mock USDC on
EVM (Anvil) and SOL + Mock USDC on Solana (test-validator) from a single
container with a chain-toggle UI.

## Features

- 🚰 **Dual-chain**: EVM (ETH + ERC-20 USDC) and Solana (SOL + SPL USDC)
- 🎛️ **Chain toggle UI**: Single page, pick EVM or Solana, paste address, drip
- ⏱️ **Per-chain rate limiting**: Address-keyed, namespaced by chain
- 🔍 **Auto-discovery**: EVM token contract auto-detected when deployed
- 🪙 **Mock USDC bootstrap aware**: Solana USDC mint + faucet authority
  defaults match the bootstrap baked into `docker/Dockerfile.akash-solana`

## Quick Start

```bash
cd packages/faucet
npm install

# EVM-only (legacy mode)
RPC_URL=http://localhost:18545 npm run dev

# Dual-chain
RPC_URL=http://localhost:28545 \
SOLANA_RPC_URL=http://localhost:28899 \
SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH=$(pwd)/../../infra/solana/keys/faucet-authority.json \
npm run dev

# Open the UI
open http://localhost:3500
```

## Configuration

Configure via environment variables.

### EVM (always required for the EVM endpoints)

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3500` | HTTP port |
| `RPC_URL` | `http://anvil:8545` | EVM JSON-RPC URL |
| `ETH_PRIVATE_KEY` | Anvil Account 1 | Funds the ETH drip |
| `TOKEN_PRIVATE_KEY` | Anvil Account 0 (deployer) | Funds the ERC-20 drip |
| `TOKEN_ADDRESS` | _(auto-detect)_ | Mock USDC contract address |
| `ETH_AMOUNT` | `100` | ETH per request |
| `TOKEN_AMOUNT` | `10000` | USDC per request |
| `RATE_LIMIT_HOURS` | `1` | Hours between requests per (chain,address) |

### Solana (optional — gates the `/api/sol/*` endpoints)

| Var | Default | Notes |
| --- | --- | --- |
| `SOLANA_RPC_URL` | _(unset)_ | Solana JSON-RPC URL. **If unset, `/api/sol/request` returns 503**. |
| `SOLANA_USDC_MINT` | `6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q` | Mock USDC mint pubkey baked at validator boot |
| `SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH` | `/etc/faucet/sol-authority.json` | JSON-array keypair file (solana-keygen format) |
| `SOL_USDC_AMOUNT` | `100` | Default whole-USDC amount per request (overridable per-call) |

If the authority keypair is missing/malformed at startup, the Solana SOL
airdrop still works but the USDC drip is disabled. Same fail-soft behaviour
as the dashboard route.

## Mounting the Solana keypair

The faucet authority keypair lives at
`infra/solana/keys/faucet-authority.json` in the repo. To run the container
with USDC drip enabled, mount it into the container at
`/etc/faucet/sol-authority.json` (or override `SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH`).

Example compose snippet:

```yaml
services:
  faucet:
    image: ghcr.io/...:latest
    environment:
      RPC_URL: http://anvil:8545
      SOLANA_RPC_URL: http://solana:8899
    volumes:
      - ./infra/solana/keys/faucet-authority.json:/etc/faucet/sol-authority.json:ro
    ports:
      - "3500:3500"
```

## API Endpoints

### `GET /health`

```json
{
  "status": "ok",
  "tokenAddress": "0x...",
  "tokenReady": true,
  "solanaConfigured": true,
  "solanaAuthorityReady": true
}
```

### `GET /api/info`

```json
{
  "ethAmount": "100",
  "tokenAmount": "10000",
  "tokenSymbol": "USDC",
  "tokenAddress": "0x...",
  "rateLimitHours": 1,
  "faucetBalances": { "eth": "9900.0", "token": "990000.0" },
  "ready": true,
  "solana": {
    "rpcUrl": "http://localhost:28899",
    "usdcMint": "6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q",
    "faucetAuthority": "ATEh3koyCrwmCMr3cNBVEmARhSFmP9tHokjDxhtaE8m3",
    "usdcAmount": 100,
    "ready": true
  }
}
```

### `POST /api/request` (EVM, legacy alias)

`POST /api/evm/request` is identical — both call the same handler.

**Request:**

```json
{ "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb" }
```

**Response:**

```json
{
  "success": true,
  "transactions": {
    "eth":   { "hash": "0x...", "amount": "100" },
    "token": { "hash": "0x...", "amount": "10000", "symbol": "USDC" }
  }
}
```

### `POST /api/sol/request`

**Request:**

```json
{ "recipient": "ATEh...8m3", "amount": 100 }
```

`amount` is optional whole USDC; defaults to `SOL_USDC_AMOUNT`. Native SOL
top-up is fixed at 1 SOL per request.

**Success response:**

```json
{
  "success": true,
  "airdropSig": "5...",
  "usdcSig": "3...",
  "recipient": "ATEh...8m3"
}
```

**Soft-fail response (mint not found on RPC — SOL still went out):**

```json
{
  "error": "mint not found",
  "message": "mint not found on RPC: ...",
  "airdropSig": "5..."
}
```

**Not-configured response (`SOLANA_RPC_URL` unset):**

```json
{
  "error": "solana faucet not configured",
  "message": "SOLANA_RPC_URL is not set; the operator did not enable the Solana drip."
}
```

**Rate-limited response (HTTP 429):**

```json
{
  "error": "Rate limit exceeded",
  "message": "Please wait 45 minutes before requesting again",
  "waitMinutes": 45
}
```

## Architecture

```
                ┌─────────────┐
                │   Web UI    │  ← chain toggle + address + amount
                │ (index.html)│
                └──────┬──────┘
                       │
                       ▼
                ┌─────────────┐
                │  Express    │  ← validates, rate-limits, routes
                │   Server    │
                └──────┬──────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
      ┌──────────┐          ┌──────────────┐
      │  EVM     │          │  Solana      │
      │  drip    │          │  drip        │
      │ (ethers) │          │ (spl-prims)  │
      └────┬─────┘          └──────┬───────┘
           │                       │
           ▼                       ▼
      ┌────────┐              ┌──────────┐
      │ Anvil  │              │ Solana   │
      │  L1    │              │ validator│
      └────────┘              └──────────┘
```

## Code layout

| File | Purpose |
| --- | --- |
| `src/index.js` | Express server + EVM drip + endpoint wiring |
| `src/sol-drip.mjs` | `solDrip()` — Solana airdrop + SPL TransferChecked |
| `src/spl-primitives.mjs` | Pure-ESM SPL primitives (copy of `infra/solana/spl-primitives.mjs`) |
| `public/index.html` | Vanilla-JS UI with chain toggle |

## Rate Limiting

In-memory, namespaced by chain. Default 1 request per (chain, address) per
hour. Resets on container restart.

## Security

⚠️ **For local development only!**

- Anvil deterministic private keys are baked in
- Solana faucet authority keypair is a public dev key (same security posture
  as Anvil's account[0]) — see `infra/solana/keys/`
- No authentication
- In-memory rate limit (no persistence)

## Troubleshooting

**Faucet shows "Waiting for token contract deployment":**

- `contract-deployer` hasn't completed yet. Check: `docker compose logs contract-deployer`.

**Solana toggle says "USDC drip disabled":**

- The faucet authority keypair file is missing at the configured path. Check
  the volume mount and `SOLANA_FAUCET_AUTHORITY_KEYPAIR_PATH`. SOL airdrops
  still work in this state.

**Solana drip returns "mint not found":**

- Mock USDC isn't bootstrapped on the target validator. Bootstrap is run
  by `infra/solana/bootstrap-usdc.mjs` at validator startup; check the
  validator logs for "Mock USDC bootstrap complete".

**Rate limit persists after container restart:**

- It doesn't — limits are in-memory only. If you're still rate-limited, the
  container is still running.

## License

MIT
