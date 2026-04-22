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

**D21-008: Dashboard design system is Vercel/Geist-inspired (updated 2026-04-21).** Near-white canvas (`#ffffff`), `#171717` ink, shadow-as-border (`box-shadow: 0 0 0 1px rgba(0,0,0,0.08)`), Geist Sans with aggressive negative tracking (-2.4px at 48px), Geist Mono for technical labels. Node identity maps to Vercel workflow accents: Town → Develop Blue (`#0a72ef`), Mill → Preview Pink (`#de1d8d`), DVM → Ship Red (`#ff5b4f`). Three weights (400/500/600), three named keyframe animations, no gradients, no traditional CSS borders, no dark theme at launch. Full spec in Story 21.8.5. Supersedes the earlier v1–v6 design spike directions (Ink Terminal / IBM Plex Mono / dark-native) preserved in `_bmad-output/planning-artifacts/design-spikes/` for reference only.

**D21-009: Dashboard stories (21.9–21.13) are developed against a Townhouse-shaped Docker dev stack — never mocks, never SDK E2E.** Per the project CLAUDE.md rule ("ALWAYS USE DOCKER — NEVER USE MOCKS"), every dashboard view story runs against `docker-compose-townhouse-dev.yml` via `./scripts/townhouse-dev-infra.sh up`. This stack mirrors the production Townhouse topology (D21-002) — standalone connector + Town/Mill/DVM child peers — so the dashboard consumes the exact data shape it will see in production (packet log from the shared connector, type-separated node identities, real cross-chain swap flows), not the embedded-connector shape of SDK E2E. The stack includes 2 Town nodes, 2 Mill nodes, 1 DVM node, the standalone connector image, and the three chain devnets (Anvil + Solana + Mina) so settlement and wallet balances are real. Story 21.8.5 ships `pnpm --filter @toon-protocol/townhouse-web dev:docker` as the canonical dev loop. Storybook may use fixtures for isolated primitive preview; the product dev server must not. PRs for 21.9–21.13 include a screenshot sourced from live Docker data, and degraded/rebalancing states are exercised via `docker pause` / real swap triggers, not simulated flags.

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
- [ ] Vite + React SPA at `packages/townhouse/web/` scaffolded by Story 21.8.5
- [ ] Uses design-system primitives from Story 21.8.5 (`Shell`, `NodeCard`, `StatusDot`, `TypeChip`, `Sparkline`, `BreakdownPill`, `StateShell`, `Button`) — no reimplementation, no ad-hoc styling
- [ ] Imports tokens from `@/theme/tokens`; no inline hex, no arbitrary Tailwind colors, no raw `border:` declarations (shadow-as-border only)
- [ ] Light Vercel/Geist-inspired theme per D21-008 (NOT dark — reversal from earlier epic direction)
- [ ] Node cards for each active node: health status, uptime, key metric, earnings — color-coded by type via `TypeChip` (Town → Develop Blue, Mill → Preview Pink, DVM → Ship Red)
- [ ] Unified earnings ticker using `BreakdownPill` ("Today: X ETH across N nodes")
- [ ] ATOR connection status indicator via `StatusDot` (ok/degraded/down)
- [ ] Live activity feed (recent events from all nodes) using `StateShell` for empty/loading/error
- [ ] Typography uses the token tracking scale; no positive letter-spacing on Geist (CI-enforced)
- [ ] Responsive layout per Section 8 breakpoints (400/600/768/1024/1200/1400)
- [ ] **Developed against `pnpm --filter @toon-protocol/townhouse-web dev:docker` with the Townhouse dev stack up (`./scripts/townhouse-dev-infra.sh up`). PR screenshot sourced from live Docker data with all 5 child nodes visible (2 Town + 2 Mill + 1 DVM).**
- [ ] Axe-core passes at WCAG 2.1 AA

---

#### Story 21.10: Dashboard — Town Management View

**As a** Town node operator, **I want** a relay management view **so that** I can monitor relay activity and configure write fees.

**Acceptance Criteria:**
- [ ] Uses design-system primitives from Story 21.8.5; no reimplementation, no inline colors, no raw borders
- [ ] Live event stream (filterable by kind) using `StateShell` for empty/loading/error
- [ ] Connected clients count rendered as `MetricBlock`
- [ ] Write-fee configuration with slider/input wrapped in shadow-bordered card
- [ ] Events relayed per hour/day chart using token palette; chart library is the epic-wide choice locked in Story 21.9
- [ ] Bandwidth usage display
- [ ] Apply config changes via API (triggers connector restart)
- [ ] **Developed against `pnpm dev:docker` with live Town peer telemetry from `townhouse-dev-town-01` and `townhouse-dev-town-02` (per D21-009). Event-stream view verified against real relay traffic; degraded-state rendering verified via `docker pause townhouse-dev-town-02`.**
- [ ] Axe-core passes at WCAG 2.1 AA

---

#### Story 21.11: Dashboard — Mill Management View

**As a** Mill node operator, **I want** a liquidity management view **so that** I can visualize profits and manage swap operations.

**Acceptance Criteria:**
- [ ] Uses design-system primitives; `LiquidityBar` for pool viz, `PairChip` + `ChainIcon`/`TokenIcon` for swap pairs; no reimplementation
- [ ] Liquidity pool visualization (allocated, in active swaps, available) via `LiquidityBar`; `rebal-pulse` animates only during active rebalance
- [ ] Fee percentage configuration with earning estimate preview in shadow-bordered card
- [ ] Profit chart over time (daily/weekly/monthly) using token palette
- [ ] Supported swap pairs display using `PairChip`
- [ ] "Add Funds" flow with deposit address and balance detection
- [ ] Active swaps count and volume as `MetricBlock`s
- [ ] **Developed against `pnpm dev:docker` with live Mill peer telemetry from `townhouse-dev-mill-01` (EVM↔Solana pair) and `townhouse-dev-mill-02` (EVM↔Mina pair), per D21-009. `rebal-pulse` exercised by triggering a real cross-chain swap via `packages/mill` CLI, not a simulated flag.**
- [ ] Axe-core passes at WCAG 2.1 AA

---

#### Story 21.12: Dashboard — DVM Management View

**As a** DVM node operator, **I want** a compute management view **so that** I can monitor jobs and set pricing.

**Acceptance Criteria:**
- [ ] Uses design-system primitives; no reimplementation, no inline colors, no raw borders
- [ ] Job queue visualization (pending, in-progress, completed) using `StateShell` for empty queue
- [ ] Pricing configuration per job type in shadow-bordered cards
- [ ] Jobs processed chart over time using token palette
- [ ] Storage costs vs. revenue breakdown via `BreakdownPill`
- [ ] Earnings from DVM compute displayed via `MetricBlock`
- [ ] **Developed against `pnpm dev:docker` with live DVM peer telemetry from `townhouse-dev-dvm-01` (per D21-009). Job queue lifecycle (pending → in-progress → completed) verified against real jobs submitted through the connector.**
- [ ] Axe-core passes at WCAG 2.1 AA

---

#### Story 21.13: Dashboard — Wallet & Keys View

**As a** node operator, **I want** a wallet management view **so that** I can see all my keys, balances, and manage funds.

**Acceptance Criteria:**
- [ ] Uses design-system primitives; wallet rows render as shadow-bordered cards, NOT a traditional bordered table
- [ ] All keypairs listed with node type association via `TypeChip`
- [ ] Fund balances per chain (ETH, USDC, etc.) using `ChainIcon` + `TokenIcon` + `MetricBlock` with `tnum` enabled
- [ ] Deposit addresses with QR codes inside shadow-bordered cards
- [ ] Withdraw/transfer functionality using `Button` primary variant
- [ ] Seed phrase backup prompt and export
- [ ] Visual derivation path display (which key belongs to which node) using Geist Mono caption style
- [ ] **Developed against `pnpm dev:docker` with real wallet balances read from `townhouse-dev-anvil` (EVM), `townhouse-dev-solana`, and `townhouse-dev-mina` (per D21-009). Per-node-type key derivation verified against the five child-node Nostr secret keys in the compose file.**
- [ ] Axe-core passes at WCAG 2.1 AA

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
