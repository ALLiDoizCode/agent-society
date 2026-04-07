# TOON Dogfood Guide

Run a local TOON network and create events using Ditto.

## Prerequisites

- Docker & Docker Compose
- The `contracts/evm` directory (included in this repo)

## Quickstart

```bash
# 1. Start the local TOON network
docker compose -f docker-compose-dogfood.yml up
```

Wait for all services to show healthy (Anvil deploys contracts, then peers start, then Ditto serves).

```bash
# 2. Open Ditto
open http://localhost:8080
```

3. **Create a Nostr identity** — Generate or import an nsec key in Ditto's login screen.

4. **Fund your wallet** — Go to the Wallet page and tap the **Dev Faucet** button. This sends 1 ETH + 1,000 USDC to your derived EVM address from Anvil's pre-funded deployer account.

5. **Enable TOON** — In Wallet settings, toggle **Enable TOON**. Ditto will discover the local peers and connect via ILP.

6. **Create events** — Post notes, react, reply. Each event is paid for via ILP micropayments and relayed through the TOON network. Arweave DVM is available for blob storage.

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| Ditto | http://localhost:8080 | Nostr social client |
| Anvil | http://localhost:18545 | Local EVM chain (chain ID 31337) |
| Peer1 Relay | ws://localhost:19700 | TOON relay (Arweave DVM, 5/byte) |
| Peer1 BLS | http://localhost:19100 | Peer1 health/API |
| Peer2 Relay | ws://localhost:19710 | TOON relay (Arweave DVM, 10/byte) |
| Peer2 BLS | http://localhost:19110 | Peer2 health/API |

## Contracts (Anvil — deterministic addresses)

| Contract | Address |
|----------|---------|
| ERC20 Token | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TokenNetworkRegistry | `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` |
| TokenNetwork | `0xCafac3dD18aC6c6e92c921884f9E4176737C052c` |

## Stopping

```bash
docker compose -f docker-compose-dogfood.yml down       # Stop
docker compose -f docker-compose-dogfood.yml down -v    # Stop and wipe data
```

## Troubleshooting

**Peers won't start:** Check Anvil is healthy first — `curl http://localhost:18545` should return a JSON-RPC error object (that means it's running).

**Ditto can't connect to TOON:** Ensure you logged in with an **nsec key** (not a browser extension). The EVM wallet is derived from the nsec — extension logins don't expose the secret key.

**Faucet not working:** The Dev Faucet only works on Anvil (chain ID 31337). If you see errors, check that Anvil is running on port 18545.

**Images not found:** If the public images haven't been pushed yet, build locally:
```bash
# Build peer image
docker build -f docker/Dockerfile.oyster -t ghcr.io/toon-protocol/toon:latest .

# Build ditto image (builds TOON packages, then Ditto SPA, then Docker image)
./scripts/prep-ditto-build.sh
```
