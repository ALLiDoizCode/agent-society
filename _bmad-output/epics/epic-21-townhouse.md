# Epic 21: Townhouse — Node Provider Dashboard & Orchestrator

**Status:** PLANNED
**Date:** 2026-04-20
**Origin:** Party Mode brainstorm session (2026-04-20)
**Decision Record:** Party mode discussion — node provider management for Town, Mill, and Arweave DVM

---

## Goal

Provide a simple, beautiful way for node providers to spin up and manage one or many TOON node types (Town, Mill, Arweave DVM) on a local machine running on their home network. Townhouse is a host-native orchestrator + dashboard that manages Docker-containerized nodes behind a shared standalone connector, with ATOR privacy transport as a config option via public ATOR SOCKS5 proxies.

**Townhouse is the operator on-ramp for the TOON network.** One command to install, three minutes to first earnings.

---

## Key Design Decisions

**D21-001: Every node type runs as a Docker container.** Town, Mill, and DVM each get production-grade Dockerfiles. This gives realistic environment parity, process isolation, easy updates, and per-container resource visibility. The Townhouse orchestrator runs natively on the host so it can manage Docker and serve the dashboard even if node containers are down.

**D21-002: Standalone connector, not embedded.** A single shared connector instance (pulled from `ghcr.io/toon-protocol/connector`) handles all ILP routing for all nodes. Benefits: single routing table, shared ATOR transport, unified balance tracking, resource efficiency, cleaner separation of concerns. Each node registers as a peer with the standalone connector over the Docker network. Fee enforcement happens at the connector's routing layer.

**D21-003: Connector image is pre-built.** Townhouse pulls `ghcr.io/toon-protocol/connector:latest` — no custom connector Dockerfile needed. Updates are trivial: `docker pull` + restart.

**D21-004: ATOR is a config option, not a container.** Nodes connect to the public Anyone/ATOR SOCKS5 proxy network via the `ator-transport` layer from Epic 12. No ATOR proxy container to build or manage. Operators choose ATOR (privacy) or Direct (speed) in setup.

**D21-005: All three node types have equal priority.** The architecture uses a uniform `NodeProvider` abstraction. Dashboard grid, health monitoring, Docker lifecycle — all generic. Per-node detail views are the only type-specific UI.

**D21-006: Unified transaction ledger via standalone connector.** All ILP packets flow through one connector, providing a single source of truth for earnings breakdowns by node type (relay writes, swaps, DVM jobs).

**D21-007: Docker Compose profiles for selective node activation.** `townhouse up --town --mill` starts only the connector + Town + Mill. Profiles keep the compose file unified while allowing any combination.

**D21-008: HD wallet with per-node key derivation.** Single BIP-39 mnemonic, deterministic HD derivation per node type (following the existing `WalletSeedManager` pattern from the connector). One seed to back up, all keys recoverable.

---

## Architecture

### Container Stack

```
Container    Image Source                         Required
───────────  ───────────────────────────────────  ────────
Connector    ghcr.io/toon-protocol/connector      Always
Town         toon:town (built from packages/town)  Profile
Mill         toon:mill (built from packages/mill)  Profile
DVM          toon:dvm (built from packages/sdk)    Profile
```

### System Diagram

```
┌─────────────────────────────────────────────┐
│  TOWNHOUSE (host-native)                    │
│  CLI + Fastify API + WebSocket + Vite SPA   │
├─────────────────────────────────────────────┤
│  Docker Network (townhouse-net)             │
│  ┌──────────────────────┐                   │
│  │  Connector            │                  │
│  │  (standalone mode)    │──→ ATOR / Direct │
│  │  ghcr.io/toon-proto.. │                  │
│  └────┬─────┬─────┬─────┘                   │
│       │     │     │                         │
│  ┌────┴┐ ┌──┴──┐ ┌┴────┐                   │
│  │Town │ │Mill │ │ DVM │                    │
│  │relay│ │swap │ │comp.│                    │
│  └─────┘ └─────┘ └─────┘                   │
└─────────────────────────────────────────────┘
```

### Dashboard UX

- **Home view:** Node cards (health, uptime, key metric, earnings), unified earnings ticker, ATOR status
- **Per-node views:** Type-specific management (Town: event stream, write-fee; Mill: liquidity, fees, profit chart; DVM: job queue, pricing)
- **Wallet view:** All keypairs, fund balances per chain, deposit/withdraw, backup
- **First-run wizard:** Choose nodes → Fund wallet → Set fees → Dashboard

---

## Dependencies

- Epic 1-3: ILP SDK + protocol economics
- Epic 5: DVM event kinds
- Epic 12: Token swap primitive (Mill), ATOR transport
- Connector standalone mode: `ghcr.io/toon-protocol/connector`
- `dockerode`: Docker management from Node.js

---

## Stories

### Phase 1: Orchestrator Core

#### Story 21.1: Package Scaffold + CLI Entrypoint

**As a** node operator, **I want** a `townhouse` CLI command **so that** I can initialize, start, stop, and check status of my nodes.

**Acceptance Criteria:**
- [ ] `packages/townhouse/` package created in monorepo with `package.json`, `tsconfig.json`
- [ ] CLI entrypoint at `src/cli.ts` with commands: `init`, `up`, `down`, `status`
- [ ] `townhouse init` creates `~/.townhouse/config.yaml` with default settings
- [ ] `townhouse status` shows running/stopped state for each node type
- [ ] Config schema defined in `src/config/schema.ts` covering all node types, fees, wallet, ATOR toggle
- [ ] Unit tests for config loading and validation

---

#### Story 21.2: Docker Orchestration Engine

**As a** node operator, **I want** Townhouse to manage Docker containers for my nodes **so that** I don't need to manually run Docker commands.

**Acceptance Criteria:**
- [ ] `src/docker/orchestrator.ts` using `dockerode` for container lifecycle
- [ ] `docker-compose-townhouse.yml` with profiles: `town`, `mill`, `dvm`
- [ ] Connector service (always started) pulls `ghcr.io/toon-protocol/connector`
- [ ] `townhouse up --town --mill` starts connector + selected node profiles
- [ ] `townhouse down` stops all containers gracefully
- [ ] Health check polling for each container with status reporting
- [ ] Image pull progress reporting for first-time setup
- [ ] Unit tests for orchestration logic

---

#### Story 21.3: Standalone Connector Integration

**As a** node operator, **I want** a shared standalone connector managing all ILP routing **so that** my nodes share a single routing table and ATOR connection.

**Acceptance Criteria:**
- [ ] Connector config generated from Townhouse config (fees, ATOR proxy endpoint, peer list)
- [ ] Connector started first, health-checked before nodes start
- [ ] When nodes start/stop, connector config is regenerated and connector restarted (Option A: restart-based peer registration)
- [ ] Connector admin API endpoint exposed for dashboard metrics
- [ ] ATOR transport toggle: `socks5h://proxy.ator.io:9050` or direct, configurable per operator
- [ ] Integration test: connector + one node communicating over Docker network

---

#### Story 21.4: HD Wallet Management + Per-Node Key Derivation

**As a** node operator, **I want** a single seed phrase that derives all node keys **so that** I only need one backup.

**Acceptance Criteria:**
- [ ] `src/wallet/manager.ts` wrapping existing `KeyManager` from SDK
- [ ] `townhouse init` generates BIP-39 mnemonic and prompts operator to back it up
- [ ] Per-node HD derivation following BIP-44 paths (distinct account indices per node type)
- [ ] Nostr keypair (secp256k1) + EVM address derived per node
- [ ] Wallet state persisted in `~/.townhouse/wallet.enc` (encrypted at rest)
- [ ] `townhouse wallet show` displays all derived addresses
- [ ] Unit tests for key derivation consistency

---

#### Story 21.5: Town Node Dockerfile

**As a** node operator, **I want** a production-grade Town container **so that** I can run a Nostr relay with ILP write-fees.

**Acceptance Criteria:**
- [ ] `docker/Dockerfile.town` building from `packages/town`
- [ ] Container accepts connector URL via environment variable
- [ ] Registers as peer with standalone connector on startup
- [ ] Health endpoint at `/health` returning relay status
- [ ] Exposes relay WebSocket port for client connections
- [ ] Write-fee configuration via environment variables
- [ ] Image builds and starts successfully in townhouse compose stack

---

#### Story 21.6: Mill Node Dockerfile

**As a** node operator, **I want** a production-grade Mill container **so that** I can run a token swap peer.

**Acceptance Criteria:**
- [ ] `docker/Dockerfile.mill` building from `packages/mill`
- [ ] Container accepts connector URL, wallet config via environment variables
- [ ] Registers as peer with standalone connector on startup
- [ ] Health endpoint at `/health` returning swap engine status
- [ ] Liquidity pool and fee configuration via environment variables
- [ ] Supported swap pairs configurable
- [ ] Image builds and starts successfully in townhouse compose stack

---

#### Story 21.7: DVM Node Dockerfile

**As a** node operator, **I want** a production-grade DVM container **so that** I can run an Arweave compute worker.

**Acceptance Criteria:**
- [ ] `docker/Dockerfile.dvm` building from DVM worker in `packages/sdk/src/dvm/`
- [ ] Container accepts connector URL, pricing config via environment variables
- [ ] Registers as peer with standalone connector on startup
- [ ] Health endpoint at `/health` returning worker status
- [ ] Job pricing configurable per job type
- [ ] Image builds and starts successfully in townhouse compose stack

---

### Phase 2: API + Dashboard

#### Story 21.8: Fastify REST + WebSocket Metrics API

**As a** dashboard, **I need** a real-time API backend **so that** I can display live node metrics and handle configuration changes.

**Acceptance Criteria:**
- [ ] `src/api/server.ts` Fastify server with REST + WebSocket
- [ ] REST endpoints: `GET /nodes`, `GET /nodes/:type`, `PATCH /nodes/:type/config`, `GET /wallet`
- [ ] WebSocket stream: real-time metrics (events/sec, swap volume, job count, earnings)
- [ ] Metrics sourced from standalone connector's packet log (unified transaction ledger)
- [ ] Per-node health status polling and broadcasting
- [ ] CORS configured for local dashboard only
- [ ] API tests for all endpoints

---

#### Story 21.9: Dashboard SPA — Home View

**As a** node operator, **I want** a dashboard home screen **so that** I can see all node health and earnings at a glance.

**Acceptance Criteria:**
- [ ] Vite + React SPA at `web/` directory
- [ ] Built using `frontend-design` skill for distinctive, polished UI
- [ ] Dark theme default (operators check 24/7)
- [ ] Node cards for each active node: health status, uptime, key metric, earnings
- [ ] Color-coded by type: Town (amber), Mill (green), DVM (blue)
- [ ] Unified earnings ticker ("Today: X ETH across N nodes")
- [ ] ATOR connection status indicator (green/amber/red)
- [ ] Live activity feed (recent events from all nodes)
- [ ] Responsive layout (desktop + mobile)

---

#### Story 21.10: Dashboard — Town Management View

**As a** Town node operator, **I want** a relay management view **so that** I can monitor relay activity and configure write fees.

**Acceptance Criteria:**
- [ ] Live event stream (filterable by kind)
- [ ] Connected clients count
- [ ] Write-fee configuration with slider/input
- [ ] Events relayed per hour/day chart
- [ ] Bandwidth usage display
- [ ] Apply config changes via API (triggers connector restart)

---

#### Story 21.11: Dashboard — Mill Management View

**As a** Mill node operator, **I want** a liquidity management view **so that** I can visualize profits and manage swap operations.

**Acceptance Criteria:**
- [ ] Liquidity pool visualization (allocated, in active swaps, available)
- [ ] Fee percentage configuration with earning estimate preview
- [ ] Profit chart over time (daily/weekly/monthly)
- [ ] Supported swap pairs display and configuration
- [ ] "Add Funds" flow with deposit address and balance detection
- [ ] Active swaps count and volume

---

#### Story 21.12: Dashboard — DVM Management View

**As a** DVM node operator, **I want** a compute management view **so that** I can monitor jobs and set pricing.

**Acceptance Criteria:**
- [ ] Job queue visualization (pending, in-progress, completed)
- [ ] Pricing configuration per job type
- [ ] Jobs processed chart over time
- [ ] Storage costs vs. revenue breakdown
- [ ] Earnings from DVM compute display

---

#### Story 21.13: Dashboard — Wallet & Keys View

**As a** node operator, **I want** a wallet management view **so that** I can see all my keys, balances, and manage funds.

**Acceptance Criteria:**
- [ ] All keypairs listed with node type association
- [ ] Fund balances per chain (ETH, USDC, etc.)
- [ ] Deposit addresses with QR codes
- [ ] Withdraw/transfer functionality
- [ ] Seed phrase backup prompt and export
- [ ] Visual derivation path display (which key belongs to which node)

---

### Phase 3: First-Run + Polish

#### Story 21.14: First-Run Setup Wizard

**As a** new node operator, **I want** a guided setup experience **so that** I can go from install to running nodes in under 5 minutes.

**Acceptance Criteria:**
- [ ] Web-based wizard (served by Fastify, not CLI-only)
- [ ] Step 1: Choose your nodes (toggle Town/Mill/DVM with descriptions)
- [ ] Step 2: Wallet setup (generate mnemonic, backup prompt, or import existing)
- [ ] Step 3: Privacy mode (ATOR recommended / Direct)
- [ ] Step 4: Fee configuration (sliders per node type with earning estimates)
- [ ] Docker image pull with progress indicator
- [ ] Lands on dashboard with nodes starting up
- [ ] Skipped on subsequent launches (detects existing config)

---

#### Story 21.15: ATOR Privacy Transport + Connectivity Status

**As a** privacy-conscious operator, **I want** ATOR transport with clear status indication **so that** I know my traffic is private.

**Acceptance Criteria:**
- [ ] ATOR toggle in settings (ATOR / Direct) with explanation
- [ ] Connector configured with `socks5h://` proxy when ATOR enabled
- [ ] Dashboard shows ATOR connectivity: connected (green), degraded (amber), disconnected (red)
- [ ] Latency comparison display (ATOR vs. estimated direct)
- [ ] Graceful fallback notification if ATOR proxy unreachable
- [ ] Config change triggers connector restart

---

#### Story 21.16: E2E Integration Tests

**As a** developer, **I want** end-to-end tests for the full Townhouse stack **so that** we can validate the orchestration pipeline.

**Acceptance Criteria:**
- [ ] Test infrastructure script: `scripts/townhouse-test-infra.sh` (up/down)
- [ ] E2E: `townhouse init` + `townhouse up` starts connector + all 3 nodes
- [ ] E2E: All nodes register with connector and pass health checks
- [ ] E2E: Dashboard SPA loads, shows correct node states
- [ ] E2E: Config change via dashboard propagates to running containers
- [ ] E2E: `townhouse down` stops all containers cleanly
- [ ] E2E: Single-node operation (only Mill) works correctly
- [ ] Playwright tests for dashboard (using existing Playwright infrastructure)

---

#### Story 21.17: Publish Package

**As a** node operator, **I want** to install Townhouse from npm **so that** I can get started easily.

**Acceptance Criteria:**
- [ ] Published as `@toon-protocol/townhouse` on npm with public access
- [ ] `npx @toon-protocol/townhouse init` works for first-time users
- [ ] README with quick-start guide
- [ ] Docker image prerequisites documented
- [ ] Version pinning for connector image (`ghcr.io/toon-protocol/connector:X.Y.Z`)
- [ ] All dependencies correctly declared (no workspace:* in published package)
