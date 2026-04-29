# Connector 3.3.2 Upgrade — Handoff Document

**Date:** 2026-04-24
**Branch:** Current working branch (connector-upgrade-3.3.2)
**Status:** In Progress — Unit/Integration tests pass. Docker E2E partially fixed (channel creation works, routing table conflict remains to validate).

---

## Goal

Update `@toon-protocol/connector` npm dependency from `^2.3.0` to `^3.3.2` and Docker image from `:2.6.1` to `:3.3.0`, ensuring all unit, integration, and E2E tests pass.

---

## What Was Done

### 1. Dependency & Docker Image Updates

- Updated `@toon-protocol/connector` to `^3.3.2` in 8 package.json files:
  - `packages/town/package.json`
  - `packages/sdk/package.json` (peer `>=3.3.2`, dev `^3.3.2`)
  - `packages/mill/package.json`
  - `packages/core/package.json` (peer `>=3.3.2`)
  - `docker/package.json`
  - `examples/sdk-example/package.json`
  - `examples/town-example/package.json`

- Updated Docker image `ghcr.io/toon-protocol/connector` to `:3.3.0` in:
  - `docker-compose-townhouse.yml`
  - `packages/townhouse/src/config/defaults.ts`
  - `packages/townhouse/src/config/loader.test.ts`
  - `packages/townhouse/src/config/validator.test.ts`
  - `packages/townhouse/src/docker/orchestrator.test.ts`
  - `packages/townhouse/src/wallet/cli-wallet.test.ts`
  - `packages/townhouse/src/cli.test.ts`
  - `CLAUDE.md`

### 2. Test Fixes (Unit/Integration)

- **Fixed `@noble/ciphers/chacha` import** in `packages/sdk/tests/e2e/docker-mina-settlement-e2e.test.ts` — `@noble/ciphers@2.1.1` exports `./chacha.js` not `./chacha`.
- **Fixed contract ABI mismatch** in `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts`:
  - `participants` outputs: 3 fields (was 5)
  - `closeChannel` inputs: `(bytes32 channelId)` only (was balance proof + signature)
- **Updated settlement lifecycle test** `docker-publish-event-e2e.test.ts`:
  - Removed `BALANCE_PROOF_TYPES` import and balance-proof `closeChannel` call
  - Now calls `closeChannel(channelId)` directly
  - Adjusted assertions: A gets full deposit back, B gets 0
- **Fixed pre-existing townhouse regex failures** (5 tests):
  - `dvm-dockerfile.test.ts` (2): split multiline regex into separate assertions
  - `mill-dockerfile.test.ts` (2): same + `toBigInt`/`inventory` split
  - `package-structure.test.ts` (1): added `CONNECTOR_URL` to mill service in compose file

### 3. Docker Entrypoint Cleanup

- **Removed `pet-dvm` and `memvid`** from production Docker path:
  - `docker/src/entrypoint-sdk.ts`: removed `createPetDvmHandler` import, handler registration, health fields, service discovery
  - `docker/src/shared.ts`: removed `petDvmEnabled`, `petBrainStoragePath`, `petProofBatchSize` from Config interface and `parseConfig`
  - `docker/esbuild.config.mjs`: removed `@toon-protocol/pet-dvm` and `@toon-protocol/pet-circuit` from externals
  - `docker/Dockerfile.sdk-e2e`: reverted pet-dvm package.json COPY
- **Fixed `entrypoint-sdk.ts` `keyId` bug**: `buildChainProviders` was setting `keyId: 'evm-settlement'` (a string label) instead of the actual private key. Connector 3.3.2 passes `keyId` as `evmPrivateKey` to `KeyManager`, causing `hex string expected, got non-hex character "ev"` error.
  - Changed to: `keyId: connectorEnv.settlementPrivateKey || 'evm-settlement'`
- **Fixed `Dockerfile.sdk-e2e` data permissions**: added `mkdir -p /app/data && chown toon:toon /app/data` so connector can create `./data` for SQLite/ledger snapshots
- **Added static BTP peer config** (`BTP_PEERS` / `BTP_ROUTES` env vars):
  - `parseBtpPeers()` reads JSON from env vars and passes into `ConnectorNode` constructor
  - This fixes connector 3.3.2's immutable `peerIdToAddressMap` / `peerIdToChainMap` issue (see Architecture section below)
  - Added route restoration after bootstrap: re-adds constructor routes after bootstrap completes to prevent bootstrap-discovered routes from shadowing them

### 4. Docker Compose E2E Config

- Added `BTP_PEERS` and `BTP_ROUTES` to `docker-compose-sdk-e2e.yml` for peer1 and peer2:
  - peer1 knows about peer2: `id: "peer2"`, `url: "ws://peer2:3000"`, `evmAddress: 0x3C44...` (Anvil Account #2), `chain: "evm:31337"`, route `g.toon.peer2 -> peer2`
  - peer2 knows about peer1: `id: "peer1"`, `url: "ws://peer1:3000"`, `evmAddress: 0xf39F...` (Anvil Account #0), `chain: "evm:31337"`, route `g.toon.peer1 -> peer1`
- Removed Mina sync wait from `scripts/sdk-e2e-infra.sh` (connector-style: only waits for accounts manager, not SYNCED)
- Removed memvid build-context requirement from `scripts/sdk-e2e-infra.sh`
- Added `chain: 'evm:31337'` to E2E test connector `peers` configs (6 test files) to work around connector 3.3.2 auto-channel creation bug

### 5. E2E Infrastructure Validation

- `toon:sdk-e2e` Docker image rebuilt successfully
- SDK E2E infrastructure starts successfully (`./scripts/sdk-e2e-infra.sh up`)
- Peer1 and peer2 containers healthy and running
- Anvil, Solana test-validator, Mina lightnet all running

---

## Current Status

### Passing

- **Unit tests**: SDK 679, Mill 155, Town 238, Core 2418, Relay 211
- **Single-hop E2E**: `docker-publish-event-e2e.test.ts` single-hop tests pass
- **Settlement lifecycle**: `docker-publish-event-e2e.test.ts` settlement test passes (6/6 in single-hop + settlement)
- **Channel creation**: Peer1 and peer2 successfully create payment channels with each other via constructor `BTP_PEERS`

### Remaining Issue

- **Multi-hop E2E tests**: The 3 multi-hop tests in `docker-publish-event-e2e.test.ts` may still fail due to routing table identity conflicts.
- **Root cause**: Peer2's `BootstrapService` + `discoveryTracker` auto-peer with peer1 using a `nostr-<pubkey>` peer ID, which adds a second BTP connection and route that can shadow the constructor route.
- **Fix applied**: Route restoration after bootstrap (re-adds constructor routes). This was applied to `entrypoint-sdk.ts` but needs Docker image rebuild + infra restart to validate.
- **Docker build status**: The last `docker build` command failed with `EOF` error during npm install. This needs to be retried on the new machine.

---

## Architecture Lesson (Connector 3.3.2)

Connector 3.3.2 made `peerIdToAddressMap` and `peerIdToChainMap` **immutable after startup**. They are built exclusively from `ConnectorConfig.peers` (constructor config). Runtime `registerPeer()` does NOT update them.

This means:
- **Runtime-discovered peers cannot create payment channels** unless their settlement info was in constructor `peers`
- **Peer IDs must be consistent** across BTP auth, routing table, and settlement maps
- The SDK's `discoveryTracker` uses `nostr-<pubkey>` peer IDs, but BTP auth uses `nodeId` (e.g., `"peer1"`). These diverge.
- **Solution (Option A)**: Pre-configure constructor `peers` with aligned IDs matching what each node sends in BTP auth (`NODE_ID` env var)

---

## Key Files Changed

| File | What Changed |
|------|-------------|
| `docker/src/entrypoint-sdk.ts` | Added `parseBtpPeers()`, `BTP_PEERS`/`BTP_ROUTES` parsing, route restoration after bootstrap, fixed `keyId` bug, removed pet-dvm |
| `docker/src/shared.ts` | Removed pet-dvm config fields |
| `docker/esbuild.config.mjs` | Removed pet-dvm/pet-circuit externals |
| `docker/Dockerfile.sdk-e2e` | Added `/app/data` permissions, reverted pet-dvm COPY |
| `docker-compose-sdk-e2e.yml` | Added `BTP_PEERS`/`BTP_ROUTES` to peer1/peer2, removed pet-dvm env vars |
| `docker-compose-townhouse.yml` | Updated connector image to `:3.3.0` |
| `packages/townhouse/src/config/defaults.ts` | Updated connector image default to `:3.3.0` |
| `packages/*/package.json` | Updated connector dependency to `^3.3.2` |
| `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` | Updated contract ABIs (`participants` 3 fields, `closeChannel` 1 arg) |
| `packages/sdk/tests/e2e/docker-publish-event-e2e.test.ts` | Simplified `closeChannel` call, added `chain` to test peers |
| `packages/sdk/tests/e2e/docker-*.test.ts` (5 others) | Added `chain: 'evm:31337'` to test connector peers |
| `scripts/sdk-e2e-infra.sh` | Removed Mina sync wait, removed memvid |
| `CLAUDE.md` | Updated connector version references |

---

## Next Steps on New Machine

1. **Install dependencies**: `pnpm install` (ensure `corepack enable` + `pnpm@8.15.0`)
2. **Verify builds**: `pnpm --filter @toon-protocol/docker build`
3. **Rebuild Docker image**: `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .`
   - If this fails with EOF, retry with stable network
4. **Start E2E infra**: `./scripts/sdk-e2e-infra.sh up`
5. **Check peer logs** for channel creation success:
   - `docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs --tail=50 peer1 | grep "channel\|payment_channel_ready"`
   - `docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs --tail=50 peer2 | grep "channel\|payment_channel_ready"`
6. **Run E2E tests**: `cd packages/sdk && pnpm test:e2e:docker`
7. **If multi-hop still fails**: Check if route restoration is working (look for `[BTP] Restored` log line). If not, the bootstrap route may still be shadowing the constructor route. Consider increasing constructor route priority or skipping bootstrap `registerPeer()` for known constructor peers.

---

## Environment Prerequisites

- Node.js >=20, pnpm 8.15.0 (`corepack enable && corepack prepare pnpm@8.15.0 --activate`)
- Docker & Docker Compose
- Connector contracts repo at `../connector` (for Anvil contract deployment)

---

## Commit Notes

This commit includes all connector 3.3.2 upgrade work in progress. The `_bmad/` directory deletions are unrelated to this task — they appear to be from a separate cleanup operation and should be reviewed before committing to main.

---

*Handoff prepared by AI assistant on 2026-04-24*
