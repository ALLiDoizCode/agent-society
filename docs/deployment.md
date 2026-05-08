# Deployment

## Prerequisites

- Docker & Docker Compose
- Node.js >= 20
- pnpm 8.15.0 (`corepack enable && corepack prepare pnpm@8.15.0 --activate`)
- Connector contracts repo cloned at `../connector` (required for SDK E2E infrastructure)

## Building from Source

```bash
git clone https://github.com/toon-protocol/town.git
cd toon

pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run tests (optional)
pnpm lint           # Lint (optional)
pnpm format         # Format (optional)
```

## SDK E2E Infrastructure

Deploy a controlled 2-peer setup with Anvil for local development and testing:

```bash
./scripts/sdk-e2e-infra.sh up
```

To stop the infrastructure:

```bash
./scripts/sdk-e2e-infra.sh down
```

**Services started:**

| Service | URL | Purpose |
|---------|-----|---------|
| Anvil | http://localhost:18545 | Local EVM chain (chain ID 31337) |
| Peer 1 BLS | http://localhost:19100 | ILP packet validation |
| Peer 1 Relay | ws://localhost:19700 | Nostr WebSocket |
| Peer 2 BLS | http://localhost:19110 | ILP packet validation |
| Peer 2 Relay | ws://localhost:19710 | Nostr WebSocket |

## Akash Devnet

Public, browser-reachable EVM + Solana dev chains (plus Otterscan)
hosted on the [Akash Network](https://console.akash.network). Used by
the operator dashboard, demos, and anyone who wants to test against
TOON without standing up local infrastructure.

```bash
export AKASH_CONSOLE_API_KEY=ac.sk.production.…   # console.akash.network → API Keys

./scripts/akash-status.sh                # health check every lease
./scripts/akash-deploy.sh redeploy-all   # close + redeploy current set in dependency order
./scripts/akash-deploy.sh redeploy-all --rebuild   # also rebuild + push images first
./scripts/akash-deploy.sh all            # first-time deploy from empty leases.json
```

| Service | Notes |
|---------|-------|
| Anvil | EVM chain-id 31337, Mock USDC at `0x5FbDB2…` baked in |
| Solana | `solana-test-validator`, Mock USDC SPL mint `6Gbdr…` bootstrapped on each fresh ledger |
| Otterscan | EVM block explorer pointing at our Anvil |

Current lease URLs live in `deploy/akash/leases.json` (committed). For
service catalog, faucet usage, troubleshooting, and design decisions,
see [`deploy/akash/README.md`](../deploy/akash/README.md).

## Town CLI

Run a relay with one command (no Docker required):

```bash
npx @toon-protocol/town --mnemonic "your twelve word mnemonic phrase here"
```

Town embeds its own ILP connector by default — no external connector needed. See the [Town Guide](town-guide.md) for full CLI reference and environment variables.

## Health Checks

```bash
curl http://localhost:19100/health   # Peer 1 BLS
curl http://localhost:19110/health   # Peer 2 BLS
curl http://localhost:18545           # Anvil (returns error object = healthy)
```

The relay ports (19700, 19710) are WebSocket-only — no HTTP health endpoint.

## View Logs

```bash
docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs -f
```

## E2E Testing

```bash
# SDK E2E (requires SDK E2E infrastructure)
cd packages/sdk && pnpm test:e2e:docker

# Client E2E (requires SDK E2E infrastructure)
cd packages/client && pnpm test:e2e

# Town E2E (requires SDK E2E infrastructure)
cd packages/town && pnpm test:e2e
```

## Troubleshooting

**Infrastructure won't start:**

1. Check Docker is running: `docker ps`
2. Verify connector repo: `ls ../connector/packages/contracts`
3. Check logs: `docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs`

**Tests failing:**

1. Verify infrastructure is up: `curl http://localhost:19100/health`
2. Check Anvil: `curl http://localhost:18545`
3. Restart: `./scripts/sdk-e2e-infra.sh down && ./scripts/sdk-e2e-infra.sh up`

**Port conflicts:**

Use `lsof -i :<port>` to find conflicting processes. See port tables above for expected assignments.
