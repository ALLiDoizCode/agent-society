# Test Design: Epic 21 -- Townhouse -- Node Provider Dashboard & Orchestrator

**Date:** 2026-04-20
**Author:** TEA Master Test Architect
**Status:** Draft
**Epic:** Epic 21 (17 stories, 3 phases)
**Package:** `@toon-protocol/townhouse` (`packages/townhouse/`)

---

## Executive Summary

**Scope:** Risk-based test plan for Epic 21 -- Townhouse. 17 stories introducing a host-native orchestrator + dashboard for managing Docker-containerized TOON nodes (Town, Mill, DVM) behind a shared standalone connector. New package: `@toon-protocol/townhouse`. New Dockerfiles: `docker/Dockerfile.town`, `docker/Dockerfile.mill`, `docker/Dockerfile.dvm`. New compose file: `docker-compose-townhouse.yml`.

**Nature of Testing:** This epic spans host-native CLI tooling (Node.js), Docker orchestration (dockerode), Fastify REST/WebSocket API, React Vite SPA dashboard, HD wallet key derivation, and ATOR privacy transport configuration. Testing requires real Docker containers for integration/E2E (per project rules: no mocks for infrastructure boundaries). Dashboard testing uses Playwright.

**Risk Summary:**

- Total risks identified: 22
- High-priority risks (score >= 6): 9
- Critical categories: DOCKER (5 risks), SEC (4 risks), INTEG (5 risks), UX (3 risks), OPS (3 risks), NET (2 risks)

**Coverage Summary:**

- P0 scenarios (Docker lifecycle + wallet security + connector integration): 28 (~35-45 hours)
- P1 scenarios (API endpoints + dashboard views + config propagation): 24 (~30-40 hours)
- P2 scenarios (first-run wizard + ATOR + polish + edge cases): 16 (~15-25 hours)
- **Total effort**: ~80-110 hours (~4-5 weeks, aligns with epic size XL)

---

## 1. Risk Assessment

### 1.1 Risk Register

| ID | Category | Risk | P | I | Score | Story | Mitigation |
|----|----------|------|---|---|-------|-------|------------|
| R-001 | SEC | HD wallet seed stored unencrypted or with weak encryption at `~/.townhouse/wallet.enc` | 2 | 3 | **6** | 21.4 | Verify AES-256-GCM encryption at rest; test that raw mnemonic never appears in plaintext on disk; test encryption key derivation from operator passphrase |
| R-002 | SEC | Per-node HD key derivation collides with existing connector key paths (account index 1) or Mill key paths (account index 2) | 2 | 3 | **6** | 21.4 | Deterministic derivation test: same mnemonic -> distinct keys for all node types; verify BIP-44 path indices do not overlap with existing SDK/Mill paths |
| R-003 | DOCKER | Connector container fails to start before node containers, causing peer registration failures | 3 | 3 | **9** | 21.2, 21.3 | Health-check gate: orchestrator must confirm connector health before starting any node container; integration test with timing validation |
| R-004 | DOCKER | `townhouse down` leaves orphan containers or Docker network behind | 2 | 2 | **4** | 21.2 | E2E test: `up` -> verify containers running -> `down` -> verify all containers stopped, network removed; test SIGINT/SIGTERM graceful shutdown |
| R-005 | INTEG | Connector config regeneration on node start/stop causes packet loss during restart window | 3 | 2 | **6** | 21.3 | Measure connector restart duration; integration test: active ILP session survives node add/remove (or fails gracefully with defined behavior) |
| R-006 | DOCKER | Docker image pull hangs or fails silently on first-time setup (no local images) | 2 | 2 | **4** | 21.2, 21.14 | Test pull timeout handling; test progress reporting for multi-GB image pulls; test offline/network-error scenarios |
| R-007 | SEC | Wallet mnemonic displayed in CLI output or logs after initial backup prompt | 2 | 3 | **6** | 21.4 | Audit all log output paths; test that mnemonic is redacted from `townhouse status`, log files, and API responses |
| R-008 | INTEG | Node containers cannot reach standalone connector over Docker network (`townhouse-net`) | 2 | 3 | **6** | 21.3, 21.5-7 | Integration test: node container resolves `connector` hostname; ILP packet sent from node to connector succeeds |
| R-009 | DOCKER | Docker compose profiles produce invalid combinations (e.g., connector missing when nodes selected) | 2 | 2 | **4** | 21.2 | Unit test: every valid profile combination includes connector; test `--town`, `--mill`, `--dvm`, `--town --mill --dvm`, all combos |
| R-010 | NET | ATOR SOCKS5 proxy unreachable causes entire connector to fail instead of graceful degradation | 2 | 2 | **4** | 21.15 | Test ATOR fallback behavior: proxy timeout -> connector continues in direct mode with warning; test dashboard shows degraded status |
| R-011 | UX | Dashboard WebSocket connection drops and does not reconnect, showing stale data | 2 | 2 | **4** | 21.8, 21.9 | Playwright test: kill API server -> restart -> verify dashboard reconnects and refreshes data within 10s |
| R-012 | INTEG | Config change via dashboard API does not propagate to running containers | 2 | 3 | **6** | 21.8, 21.10-12 | E2E test: change write-fee via API -> verify Town container receives new config -> verify connector restarts with updated peer config |
| R-013 | SEC | API endpoints accessible from non-localhost origins (remote attack surface) | 2 | 3 | **6** | 21.8 | Test CORS policy rejects non-localhost origins; test binding to 127.0.0.1 only |
| R-014 | DOCKER | Town/Mill/DVM Dockerfiles fail to build from monorepo due to workspace dependency resolution | 2 | 2 | **4** | 21.5-7 | CI test: build each Dockerfile from repo root; verify built images start and respond to health checks |
| R-015 | OPS | `townhouse init` overwrites existing config without confirmation | 1 | 2 | **2** | 21.1 | Unit test: init with existing config prompts for overwrite confirmation; test --force flag behavior |
| R-016 | INTEG | Unified transaction ledger double-counts packets routed through connector | 2 | 2 | **4** | 21.3, 21.8 | Integration test: send N packets through connector -> verify ledger shows exactly N entries, attributed to correct node type |
| R-017 | UX | Dashboard shows incorrect node type attribution for earnings (Town earnings shown as Mill) | 2 | 2 | **4** | 21.9, 21.10-12 | E2E test: generate known earnings per node type -> verify dashboard displays correct breakdown per card |
| R-018 | OPS | npm publish includes workspace:* dependencies, breaking installation | 2 | 3 | **6** | 21.17 | Static analysis test: parse published package.json, assert no `workspace:*` in dependencies; test `npx @toon-protocol/townhouse init` from clean environment |
| R-019 | DOCKER | Container restart loop when connector is misconfigured (bad ATOR proxy, invalid fees) | 2 | 2 | **4** | 21.2, 21.3 | Test max restart attempts with backoff; test error reporting to dashboard when container enters restart loop |
| R-020 | NET | WebSocket metrics stream overwhelms dashboard with high-frequency updates | 1 | 2 | **2** | 21.8 | Test throttling/batching of WebSocket updates; test dashboard with 100+ events/sec without freezing |
| R-021 | SEC | Seed phrase export in wallet view exposes mnemonic without re-authentication | 2 | 3 | **6** | 21.13 | Test wallet view requires passphrase re-entry before showing mnemonic; test API endpoint requires auth token |
| R-022 | OPS | First-run wizard state machine allows skipping wallet backup step | 2 | 2 | **4** | 21.14 | Test wizard enforces backup confirmation before proceeding; test "I have backed it up" checkbox is mandatory |

### 1.2 Risk Heat Map

```
Impact  3 | R-007,R-013,R-021  R-001,R-002,R-005,R-008,R-012,R-018   R-003
        2 | R-015,R-020        R-004,R-006,R-009,R-010,R-011,R-014,R-016,R-017,R-019,R-022
        1 |
          +--------------------------------------------------------------
            1                  2                                    3     Probability
```

---

## 2. Test Levels & Boundary Definitions

### 2.1 Unit Tests

**Location:** `packages/townhouse/src/**/*.test.ts` (co-located)
**Runner:** Vitest
**Mocks allowed:** Yes (dockerode, fs, child_process, crypto)

Coverage areas:
- Config schema validation and loading (`src/config/schema.ts`)
- CLI argument parsing (`src/cli.ts`)
- HD wallet key derivation (`src/wallet/manager.ts`)
- Docker compose profile generation
- Connector config generation from Townhouse config
- API route handlers (mocked orchestrator + metrics)
- WebSocket message serialization

### 2.2 Integration Tests

**Location:** `packages/townhouse/src/__integration__/`
**Runner:** Vitest with extended timeout (vitest.integration.config.ts, 60s timeout)
**Mocks:** NONE (real Docker containers required)
**Infrastructure:** `scripts/townhouse-test-infra.sh up`

Coverage areas:
- Orchestrator starts/stops real Docker containers
- Connector health check gating before node startup
- Node-to-connector communication over Docker network
- API -> orchestrator -> Docker container lifecycle
- Config change propagation to running containers
- Unified transaction ledger accuracy

### 2.3 E2E Tests

**Location:** `packages/townhouse/tests/e2e/`
**Runner:** Vitest E2E config + Playwright for dashboard
**Mocks:** NONE
**Infrastructure:** `scripts/townhouse-test-infra.sh up`

Coverage areas:
- Full lifecycle: `init` -> `up` -> health -> `down`
- Dashboard SPA: home view, per-node views, wallet view
- First-run wizard flow
- Config change via dashboard propagates to containers
- Single-node and multi-node operation modes

---

## 3. Test Strategy by Story

### 3.1 Story 21.1: Package Scaffold + CLI Entrypoint

**Test level:** Unit
**Risks addressed:** R-015

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-001 | P0 | `townhouse init` creates default config at `~/.townhouse/config.yaml` | Config file exists with valid YAML matching schema |
| T-002 | P0 | `townhouse status` with no containers running | Shows "stopped" for all node types |
| T-003 | P0 | Config schema rejects invalid YAML (missing required fields) | Validation error with descriptive message |
| T-004 | P1 | `townhouse init` with existing config (no --force) | Prompts for confirmation, does not overwrite without consent |
| T-005 | P1 | CLI `--help` output includes all commands | All 4 commands documented: init, up, down, status |
| T-006 | P2 | Config loading with environment variable overrides | Env vars override YAML values for key settings (fees, ATOR toggle) |

### 3.2 Story 21.2: Docker Orchestration Engine

**Test level:** Unit + Integration
**Risks addressed:** R-003, R-004, R-006, R-009, R-019

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-007 | P0 | `townhouse up --town --mill` starts connector + Town + Mill containers | 3 containers running; DVM not started |
| T-008 | P0 | Connector health check passes before node containers start | Node containers wait for connector `/health` 200 before starting |
| T-009 | P0 | `townhouse down` stops all containers and removes Docker network | Zero townhouse containers after down; `townhouse-net` network removed |
| T-010 | P0 | All profile combinations include connector | `--town`, `--mill`, `--dvm`, and all combos always start connector |
| T-011 | P1 | Image pull progress reporting on first-time setup | Progress events emitted for each layer; test with mock pull stream |
| T-012 | P1 | Container restart limit with backoff on failure | Container stops after N restart attempts; error reported to status |
| T-013 | P1 | SIGINT during `townhouse up` triggers graceful shutdown | All containers stopped; no orphans |
| T-014 | P2 | Docker daemon not running when `townhouse up` invoked | Clear error message: "Docker is not running" |
| T-015 | P2 | Health check polling interval and timeout are configurable | Custom intervals reflected in polling behavior |

### 3.3 Story 21.3: Standalone Connector Integration

**Test level:** Unit + Integration
**Risks addressed:** R-003, R-005, R-008, R-016

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-016 | P0 | Connector config generated with correct peer list for active nodes | Generated config includes BTP endpoints for started nodes only |
| T-017 | P0 | Connector started first and health-checked before nodes | Orchestrator blocks node start until connector `/health` returns 200 |
| T-018 | P0 | Node start triggers connector config regeneration and restart | New node appears in connector peer list after restart |
| T-019 | P1 | ATOR toggle: connector uses `socks5h://proxy.ator.io:9050` when enabled | Connector config includes SOCKS5 proxy setting |
| T-020 | P1 | Connector admin API endpoint accessible from host | Metrics endpoint returns valid JSON with packet counts |
| T-021 | P1 | Transaction ledger: N packets = N ledger entries, correct node attribution | Send packets through Town and Mill -> ledger shows correct source per packet |
| T-022 | P2 | Connector restart completes within 5s | Measure restart duration; alert if > 5s |

### 3.4 Story 21.4: HD Wallet Management + Per-Node Key Derivation

**Test level:** Unit
**Risks addressed:** R-001, R-002, R-007, R-021

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-023 | P0 | BIP-39 mnemonic generation produces valid 24-word phrase | Mnemonic validates against BIP-39 wordlist |
| T-024 | P0 | Per-node HD derivation produces distinct keys for Town, Mill, DVM | Same mnemonic -> 3 different secp256k1 keypairs + 3 different EVM addresses |
| T-025 | P0 | Key derivation paths do not collide with existing SDK paths (account index 1) or Mill paths (account index 2) | Townhouse uses distinct account indices; deterministic test with known mnemonic |
| T-026 | P0 | Wallet file encrypted at rest | `~/.townhouse/wallet.enc` is not valid JSON/YAML; requires passphrase to decrypt |
| T-027 | P0 | Mnemonic never appears in log output or CLI status | Grep all log output from init/status/up/down; mnemonic string absent |
| T-028 | P1 | `townhouse wallet show` displays addresses without revealing private keys | Output contains npub/EVM addresses; no hex private keys or mnemonic |
| T-029 | P1 | Key derivation is deterministic: same mnemonic + same path = same key | Golden test vector: known mnemonic -> known derived keys |
| T-030 | P1 | Import existing mnemonic (12 or 24 words) | Imported mnemonic derives same keys as original generation |
| T-031 | P2 | Invalid mnemonic (wrong checksum) rejected | Error message indicates invalid mnemonic; no wallet file created |

### 3.5 Stories 21.5-7: Town, Mill, DVM Dockerfiles

**Test level:** Unit (static analysis) + Integration
**Risks addressed:** R-008, R-014

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-032 | P0 | `docker/Dockerfile.town` builds successfully from repo root | Image `toon:town` created; `docker run toon:town --help` exits 0 |
| T-033 | P0 | `docker/Dockerfile.mill` builds successfully from repo root | Image `toon:mill` created; `docker run toon:mill --help` exits 0 |
| T-034 | P0 | `docker/Dockerfile.dvm` builds successfully from repo root | Image `toon:dvm` created; `docker run toon:dvm --help` exits 0 |
| T-035 | P0 | Town container responds to `/health` endpoint | HTTP 200 with relay status JSON |
| T-036 | P0 | Mill container responds to `/health` endpoint | HTTP 200 with swap engine status JSON |
| T-037 | P0 | DVM container responds to `/health` endpoint | HTTP 200 with worker status JSON |
| T-038 | P1 | Each container accepts connector URL via `CONNECTOR_URL` env var | Container logs show connection attempt to specified connector URL |
| T-039 | P1 | Town container: write-fee configurable via `WRITE_FEE` env var | Fee value reflected in relay info document |
| T-040 | P1 | Mill container: swap pairs configurable via env vars | Configured pairs appear in Mill health response |
| T-041 | P1 | Static analysis: Dockerfile CMD points to correct entrypoint per node type | Parse each Dockerfile; assert CMD matches expected binary/script |
| T-042 | P2 | Static analysis: All Dockerfiles use multi-stage builds with minimal final image | Parse Dockerfiles; assert `FROM ... AS build` + separate runtime stage |

### 3.6 Story 21.8: Fastify REST + WebSocket Metrics API

**Test level:** Unit + Integration
**Risks addressed:** R-012, R-013, R-016, R-020

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-043 | P0 | `GET /nodes` returns list of all configured nodes with health status | JSON array with type, status, uptime per node |
| T-044 | P0 | `GET /nodes/:type` returns detail for specific node type | JSON with config, metrics, health for requested type |
| T-045 | P0 | `PATCH /nodes/:type/config` updates node configuration | 200 response; config change propagated to orchestrator |
| T-046 | P0 | `GET /wallet` returns wallet addresses (not private keys) | JSON with addresses; no privateKey or mnemonic fields |
| T-047 | P0 | WebSocket stream delivers real-time metrics | Connect WS -> receive metrics within 1s of packet activity |
| T-048 | P1 | CORS rejects requests from non-localhost origin | Request with `Origin: http://evil.com` gets 403 |
| T-049 | P1 | API binds to 127.0.0.1 only | Request from external IP rejected |
| T-050 | P1 | WebSocket throttling under high throughput | 100+ events/sec -> WS batches to <= 10 messages/sec |
| T-051 | P2 | API returns 404 for unknown node type | `GET /nodes/unknown` returns 404 |
| T-052 | P2 | API graceful shutdown closes WebSocket connections | Server shutdown -> all WS clients receive close frame |

### 3.7 Stories 21.9-12: Dashboard Views (Home, Town, Mill, DVM)

**Test level:** Unit (React component) + E2E (Playwright)
**Risks addressed:** R-011, R-017

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-053 | P1 | Home view displays node cards for all active nodes | Playwright: 3 cards visible when Town+Mill+DVM running |
| T-054 | P1 | Node cards color-coded by type | Town=amber, Mill=green, DVM=blue; assert CSS classes |
| T-055 | P1 | Unified earnings ticker shows aggregate across all nodes | Ticker value = sum of per-node earnings |
| T-056 | P1 | ATOR status indicator reflects actual connectivity | Green when ATOR connected; red when disconnected |
| T-057 | P1 | Town view: write-fee slider updates config via API | Change slider -> API PATCH called -> Town container receives new fee |
| T-058 | P1 | Mill view: liquidity pool visualization shows correct values | Pool allocated + in-swap + available = total liquidity |
| T-059 | P1 | DVM view: job queue shows pending/in-progress/completed | Queue counts match API response |
| T-060 | P2 | Dashboard responsive layout on mobile viewport | Playwright: set 375px width -> all critical elements visible |
| T-061 | P2 | Dark theme default | Assert body background is dark; no white flash on load |
| T-062 | P2 | WebSocket reconnection after API restart | Kill API -> restart -> dashboard shows live data within 10s |

### 3.8 Story 21.13: Wallet & Keys View

**Test level:** Unit + E2E (Playwright)
**Risks addressed:** R-007, R-021

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-063 | P0 | Wallet view lists all keypairs with node type association | Each key shows which node (Town/Mill/DVM) it belongs to |
| T-064 | P0 | Seed phrase export requires re-authentication | Click "Show Seed" -> passphrase prompt appears -> correct passphrase reveals mnemonic |
| T-065 | P1 | Fund balances displayed per chain | ETH, USDC balances shown per derived address |
| T-066 | P1 | Deposit address with QR code | QR code encodes correct EVM address |
| T-067 | P2 | Derivation path display shows BIP-44 path per key | Path like `m/44'/60'/3'/0/0` shown next to each key |

### 3.9 Story 21.14: First-Run Setup Wizard

**Test level:** E2E (Playwright)
**Risks addressed:** R-022

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-068 | P1 | Wizard appears on first launch (no existing config) | Browser navigates to wizard URL; step 1 visible |
| T-069 | P1 | Step 1: toggle node selection | Select Town+Mill -> proceed; DVM not selected |
| T-070 | P1 | Step 2: wallet setup generates mnemonic with backup prompt | 24-word phrase displayed; "I have backed up" checkbox required |
| T-071 | P1 | Step 3: privacy mode selection (ATOR/Direct) | ATOR selected -> config includes SOCKS5 proxy |
| T-072 | P1 | Step 4: fee configuration with earning estimates | Slider changes update estimated earnings display |
| T-073 | P1 | Wizard skipped on subsequent launches | Existing config -> redirect to dashboard home |
| T-074 | P2 | Import existing mnemonic in step 2 | Switch to import -> paste 24 words -> validation passes |

### 3.10 Story 21.15: ATOR Privacy Transport + Connectivity Status

**Test level:** Unit + Integration
**Risks addressed:** R-010

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-075 | P1 | ATOR enabled: connector config includes `socks5h://proxy.ator.io:9050` | Config file contains SOCKS5 proxy URL |
| T-076 | P1 | ATOR toggle change triggers connector restart | Config change -> connector container restarted -> new config active |
| T-077 | P1 | ATOR proxy unreachable: dashboard shows red status | Mock unreachable proxy -> dashboard ATOR indicator turns red |
| T-078 | P2 | Latency comparison display (ATOR vs direct) | Both values shown; ATOR latency > direct latency |

### 3.11 Story 21.16: E2E Integration Tests

**Test level:** E2E
**Risks addressed:** All (validation story)

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-079 | P0 | Full lifecycle: `init` -> `up` (all 3 nodes) -> health checks pass | All containers running; all `/health` return 200 |
| T-080 | P0 | All nodes register with connector and appear in peer list | Connector admin API lists 3 peers |
| T-081 | P0 | Dashboard loads and shows correct node states | Playwright: 3 node cards with "running" status |
| T-082 | P0 | Config change via dashboard propagates to container | Change Town write-fee -> verify Town container reflects new value |
| T-083 | P0 | `townhouse down` stops all containers cleanly | Zero townhouse containers; compose down exit 0 |
| T-084 | P1 | Single-node operation: `--mill` only | Only connector + Mill running; Town and DVM absent |
| T-085 | P1 | `scripts/townhouse-test-infra.sh up/down` works reliably | Script exits 0; health checks pass after up; clean after down |

### 3.12 Story 21.17: Publish Package

**Test level:** Unit (static analysis)
**Risks addressed:** R-018

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-086 | P0 | Published package.json has no `workspace:*` dependencies | Parse package.json; assert all deps use semver ranges |
| T-087 | P0 | `npx @toon-protocol/townhouse init` works from clean install | Simulated clean install -> init command succeeds |
| T-088 | P1 | Connector image version pinned (not `:latest`) | package.json or config references `ghcr.io/toon-protocol/connector:X.Y.Z` |
| T-089 | P2 | README quick-start guide exists and is accurate | Static check: README.md exists with "Quick Start" heading |

---

## 4. Cross-Story Test Scenarios

These scenarios span multiple stories and validate end-to-end integration across the Townhouse system.

### 4.1 Full Node Lifecycle (Stories 21.1 + 21.2 + 21.3 + 21.4 + 21.5-7 + 21.8 + 21.9)

**Priority:** P0
**Infrastructure:** `scripts/townhouse-test-infra.sh up`

| ID | Scenario | Stories Covered |
|----|----------|-----------------|
| X-001 | Scaffold -> Docker -> Connector -> API -> Dashboard: `init` creates config with wallet -> `up` pulls images and starts connector then nodes -> API serves node status -> Dashboard displays live cards | 21.1, 21.2, 21.3, 21.4, 21.8, 21.9 |
| X-002 | Wallet-to-node key flow: init generates mnemonic -> HD derivation produces per-node keys -> keys injected into Docker containers as env vars -> nodes use correct keys for signing | 21.4, 21.5-7 |
| X-003 | Config change propagation: Dashboard slider changes write-fee -> API PATCH -> orchestrator regenerates connector config -> connector restarts -> Town container receives new fee via connector peer update | 21.8, 21.10, 21.3, 21.5 |

### 4.2 Earnings Attribution Pipeline (Stories 21.3 + 21.8 + 21.9 + 21.10-12)

**Priority:** P1

| ID | Scenario | Stories Covered |
|----|----------|-----------------|
| X-004 | Town earnings: client pays write-fee -> ILP packet through connector -> packet logged in unified ledger -> API reads ledger -> Dashboard home shows Town earnings; Town view shows event count | 21.3, 21.8, 21.9, 21.10 |
| X-005 | Mill earnings: swap packets through connector -> ledger attributes to Mill -> Dashboard shows swap volume and profit | 21.3, 21.8, 21.9, 21.11 |
| X-006 | Aggregate earnings: multiple node types active -> Dashboard home ticker shows sum across all types with correct per-node breakdown | 21.8, 21.9, 21.10-12 |

### 4.3 First-Run to Dashboard (Stories 21.14 + 21.1 + 21.2 + 21.4 + 21.9)

**Priority:** P1

| ID | Scenario | Stories Covered |
|----|----------|-----------------|
| X-007 | Complete first-run: wizard selects Town+Mill -> generates wallet -> sets fees -> ATOR off -> images pulled with progress -> dashboard loads with 2 node cards within 3 minutes of wizard completion | 21.14, 21.1, 21.2, 21.4, 21.9 |
| X-008 | Subsequent launch: existing config detected -> wizard skipped -> dashboard loads directly with persisted node states | 21.14, 21.1, 21.9 |

### 4.4 ATOR Transport Toggle (Stories 21.15 + 21.3 + 21.9)

**Priority:** P1

| ID | Scenario | Stories Covered |
|----|----------|-----------------|
| X-009 | Toggle ATOR on: dashboard settings -> connector config updated with SOCKS5 -> connector restarted -> dashboard shows green ATOR indicator -> all nodes continue operating through ATOR proxy | 21.15, 21.3, 21.9 |
| X-010 | ATOR degraded: proxy becomes unreachable -> dashboard shows red indicator -> graceful fallback notification -> operator toggles to Direct -> connector restarts without proxy | 21.15, 21.3, 21.9 |

---

## 5. Key Integration Points

### 5.1 Orchestrator <-> Docker (dockerode)

- **Boundary:** `src/docker/orchestrator.ts` calls dockerode API to create/start/stop/remove containers
- **Test strategy:** Integration tests with real Docker daemon; unit tests mock dockerode for error path coverage
- **Critical paths:** Container creation order (connector first), health check polling, graceful shutdown, image pull with progress

### 5.2 API <-> Orchestrator

- **Boundary:** Fastify route handlers call orchestrator methods
- **Test strategy:** Unit tests mock orchestrator; integration tests use real orchestrator + Docker
- **Critical paths:** `PATCH /nodes/:type/config` -> orchestrator.updateConfig() -> connector restart -> node config update

### 5.3 Dashboard <-> API

- **Boundary:** React SPA fetches REST endpoints and subscribes to WebSocket
- **Test strategy:** Playwright E2E tests against running API; React component tests with mocked fetch/WS
- **Critical paths:** Initial load, WebSocket reconnection, config change roundtrip

### 5.4 Connector <-> Nodes (Docker network)

- **Boundary:** Node containers connect to connector via BTP over `townhouse-net` Docker network
- **Test strategy:** Integration tests verify BTP peering; E2E tests verify ILP packet flow
- **Critical paths:** Peer registration, packet routing, fee enforcement, connector restart resilience

### 5.5 Wallet <-> Nodes

- **Boundary:** HD-derived keys passed to Docker containers as environment variables
- **Test strategy:** Unit tests verify derivation; integration tests verify containers receive correct keys
- **Critical paths:** Key derivation determinism, no path collision, encrypted storage

---

## 6. Performance Considerations

| Metric | Target | Test Method |
|--------|--------|-------------|
| Docker container startup (per container) | < 10s after image cached | Integration test with timing assertion |
| `townhouse up` full stack (connector + 3 nodes) | < 30s after images cached | E2E test with wall-clock measurement |
| First-time image pull (3 node images + connector) | < 5 min on 50Mbps | Manual test with progress reporting validation |
| WebSocket metrics latency (event -> dashboard) | < 500ms | Playwright test: generate event -> measure time to dashboard update |
| Dashboard initial load (SPA) | < 2s (LCP) | Playwright performance measurement |
| Connector restart duration | < 5s | Integration test with timing assertion |
| Dashboard responsiveness during 100+ events/sec | No frame drops, < 100ms interaction delay | Playwright with synthetic load generator |
| `townhouse down` complete shutdown | < 15s | E2E test with timing assertion |

---

## 7. Security Considerations

### 7.1 HD Wallet & Key Management

- **Encryption at rest:** `wallet.enc` uses AES-256-GCM with operator passphrase-derived key (Argon2id KDF recommended)
- **Mnemonic exposure:** Test that mnemonic is never logged, never in API responses, never in `townhouse status`
- **Key derivation isolation:** Verify BIP-44 account indices do not overlap with existing paths in SDK (account 1) or Mill (account 2)
- **Seed export gating:** Dashboard wallet view requires re-authentication before revealing mnemonic

### 7.2 API Security

- **Localhost-only binding:** API server binds to `127.0.0.1`, not `0.0.0.0`
- **CORS policy:** Only `http://localhost:*` origins allowed
- **No authentication for local API:** Acceptable for localhost-only service; document this design decision
- **Private key exclusion:** `GET /wallet` must never include private keys or mnemonic in response

### 7.3 ATOR Transport

- **SOCKS5 configuration:** Verify `socks5h://` prefix (DNS resolved through proxy, not locally)
- **Proxy credential handling:** If ATOR requires auth, credentials must not appear in logs
- **Fallback behavior:** ATOR failure must not expose traffic on clearnet without operator awareness

### 7.4 Docker Security

- **Container isolation:** Containers run as non-root user
- **Network isolation:** `townhouse-net` is an internal Docker network; no ports exposed to host except health endpoints
- **Secret injection:** Wallet keys passed via Docker secrets or tmpfs-mounted files (not env vars in production -- test both paths)

---

## 8. Test Data Strategy

### 8.1 Docker Images

- **Unit tests:** Mock dockerode; no real images needed
- **Integration tests:** Build real images from Dockerfiles (`toon:town`, `toon:mill`, `toon:dvm`); pull real connector image (`ghcr.io/toon-protocol/connector`)
- **CI optimization:** Cache built images between runs; use `--cache-from` for Dockerfile builds
- **Test infra script:** `scripts/townhouse-test-infra.sh` builds images if not present, then starts compose stack

### 8.2 Wallet Seeds

- **Deterministic test mnemonic:** Use a fixed 24-word test mnemonic for all derivation tests (committed to test fixtures, never used in production)
- **Golden test vectors:** Pre-computed derived keys for the test mnemonic at each BIP-44 path, validated against reference implementations
- **Example:** `abandon abandon abandon ... about` -> Town key: `0x...`, Mill key: `0x...`, DVM key: `0x...`

### 8.3 Connector Configuration

- **Test configs:** Fixture YAML files with known fee structures, peer lists, ATOR toggle states
- **Config generation tests:** Input Townhouse config -> expected connector JSON output
- **ATOR proxy mock:** For unit tests, mock SOCKS5 proxy at `localhost:19050`; for integration tests, test with ATOR toggle off (Direct mode) to avoid external dependency

### 8.4 Metrics & Earnings Data

- **Synthetic packet data:** Generate ILP packets with known amounts and node attribution for ledger accuracy tests
- **Dashboard test fixtures:** Pre-populated metrics API responses for Playwright snapshot tests
- **Time-series data:** Fixed timestamp sequences for chart rendering tests

---

## 9. Test Infrastructure

### 9.1 `scripts/townhouse-test-infra.sh`

```bash
# Usage (mirrors sdk-e2e-infra.sh pattern)
./scripts/townhouse-test-infra.sh up    # Build images, start compose, wait for health
./scripts/townhouse-test-infra.sh down  # Stop all containers, remove network
```

**Compose services:**
- `connector` (always): `ghcr.io/toon-protocol/connector`
- `town` (profile): `toon:town` (built from `docker/Dockerfile.town`)
- `mill` (profile): `toon:mill` (built from `docker/Dockerfile.mill`)
- `dvm` (profile): `toon:dvm` (built from `docker/Dockerfile.dvm`)

**Port allocation (must not conflict with SDK E2E infra):**

| Service | Port | Purpose |
|---------|------|---------|
| Townhouse API | 21000 | Fastify REST + WS |
| Connector BTP | 21100 | BTP peering |
| Connector Admin | 21110 | Admin metrics API |
| Town Relay | 21700 | WebSocket relay |
| Town Health | 21701 | Health endpoint |
| Mill Health | 21801 | Health endpoint |
| DVM Health | 21901 | Health endpoint |

### 9.2 CI Pipeline Integration

```yaml
# Proposed CI steps for Epic 21
- name: Build Townhouse Docker images
  run: |
    docker build -f docker/Dockerfile.town -t toon:town .
    docker build -f docker/Dockerfile.mill -t toon:mill .
    docker build -f docker/Dockerfile.dvm -t toon:dvm .

- name: Unit tests
  run: pnpm --filter @toon-protocol/townhouse test

- name: Start test infrastructure
  run: ./scripts/townhouse-test-infra.sh up

- name: Integration tests
  run: pnpm --filter @toon-protocol/townhouse test:integration

- name: E2E tests
  run: pnpm --filter @toon-protocol/townhouse test:e2e

- name: Playwright dashboard tests
  run: pnpm --filter @toon-protocol/townhouse test:e2e:playwright

- name: Stop test infrastructure
  run: ./scripts/townhouse-test-infra.sh down
```

---

## 10. BLOCKERS -- Team Must Decide

### Pre-Implementation Critical Path

1. **R-003: Connector startup ordering** -- The orchestrator MUST implement a health-check gate ensuring the connector is fully ready before any node container starts. Failure here causes cascading registration failures. (recommended owner: Dev)

2. **R-002: Key derivation path allocation** -- Architecture must document which BIP-44 account indices are used by Townhouse vs. existing SDK/Mill code. Current SDK uses account 1, Mill uses account 2. Townhouse needs 3+ distinct indices. (recommended owner: Architecture)

3. **R-013: API security model** -- Confirm that localhost-only binding + CORS is sufficient security for the Townhouse API, or whether token-based auth is needed. This affects Stories 21.8 and 21.13. (recommended owner: Architecture)

4. **Dockerfile build context** -- All three Dockerfiles (Town, Mill, DVM) must build from the monorepo root with pnpm workspace. Confirm the Docker build strategy (full monorepo copy vs. pre-bundled). (recommended owner: Dev)

### HIGH PRIORITY -- Team Should Validate

1. **R-005: Connector restart impact** -- Adding/removing a node requires connector restart. What happens to in-flight ILP packets? Recommend: drain period before restart, or accept packet loss with client retry.

2. **R-001: Wallet encryption scheme** -- Confirm encryption algorithm (AES-256-GCM) and KDF (Argon2id vs. scrypt) for `wallet.enc`. This affects key derivation test vectors.

3. **Port allocation** -- Proposed ports (21000-21999 range) must be validated against existing port allocations in `project-context.md` to avoid conflicts.

---

## Appendix: Test Count Summary

| Story | Unit | Integration | E2E/Playwright | Total |
|-------|------|-------------|----------------|-------|
| 21.1 | 6 | 0 | 0 | 6 |
| 21.2 | 5 | 4 | 0 | 9 |
| 21.3 | 3 | 4 | 0 | 7 |
| 21.4 | 6 | 0 | 3 | 9 |
| 21.5-7 | 4 | 7 | 0 | 11 |
| 21.8 | 5 | 5 | 0 | 10 |
| 21.9-12 | 2 | 0 | 8 | 10 |
| 21.13 | 2 | 0 | 3 | 5 |
| 21.14 | 0 | 0 | 7 | 7 |
| 21.15 | 2 | 2 | 0 | 4 |
| 21.16 | 0 | 0 | 7 | 7 |
| 21.17 | 4 | 0 | 0 | 4 |
| Cross-story | 0 | 4 | 6 | 10 |
| **Total** | **39** | **26** | **34** | **99** |
