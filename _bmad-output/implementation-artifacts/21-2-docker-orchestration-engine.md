# Story 21.2: Docker Orchestration Engine

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want Townhouse to manage Docker containers for my nodes,
so that I don't need to manually run Docker commands.

## Dependencies

- **Story 21.1** (done): Package scaffold, CLI entrypoint with `handleUp`/`handleDown` stubs, config schema, dockerode installed
- **Epic 21 test design** (`_bmad-output/planning-artifacts/test-design-epic-21.md`): Test scenarios T-007 through T-015

## Acceptance Criteria

1. `src/docker/orchestrator.ts` using `dockerode` for container lifecycle (create, start, stop, remove)
2. `docker-compose-townhouse.yml` at project root with profiles: `town`, `mill`, `dvm`
3. Connector service (always started) pulls `ghcr.io/toon-protocol/connector`
4. `townhouse up --town --mill` starts connector + selected node profiles
5. `townhouse down` stops all containers gracefully (reverse order: nodes first, then connector)
6. Health check polling for each container with status reporting
7. Image pull progress reporting for first-time setup
8. Clear error message when Docker daemon is unavailable (T-014)
9. Unit tests for orchestration logic

## Tasks / Subtasks

- [x] Task 1: Docker orchestrator module (AC: #1, #6)
  - [x] 1.1 Create `src/docker/orchestrator.ts` with `DockerOrchestrator` class. Constructor accepts `dockerode` instance (DI for testability) and `TownhouseConfig`. Methods: `up(profiles: NodeType[])`, `down()`, `status()`, `pullImages(profiles: NodeType[])`.
  - [x] 1.2 Implement `ensureNetwork()` — creates Docker bridge network `townhouse-net` if it doesn't exist. Use `docker.createNetwork({ Name: 'townhouse-net', Driver: 'bridge' })`. Check existence first via `docker.listNetworks({ filters: { name: ['townhouse-net'] } })`.
  - [x] 1.3 Implement `startConnector()` — always runs first. Creates and starts connector container from `config.connector.image` with name `townhouse-connector`. Attach to `townhouse-net`. Expose `config.connector.adminPort` on host. Wait for health check before returning.
  - [x] 1.4 Implement `startNode(type: NodeType)` — starts a node container (`townhouse-town`, `townhouse-mill`, `townhouse-dvm`). Each node gets type-specific environment variables from config. Attach to `townhouse-net`. Set `depends_on` equivalent by only calling after connector is healthy.
  - [x] 1.5 Implement `up(profiles: NodeType[])` — orchestrates full startup sequence: `ensureNetwork()` -> `pullImages(profiles)` -> `startConnector()` -> wait for connector health -> `startNode()` for each profile in parallel.
  - [x] 1.6 Implement `down()` — stops containers in reverse order: all node containers first (parallel), then connector, then optionally remove network. Use `container.stop({ t: 10 })` for graceful 10s timeout, then `container.remove()`.
  - [x] 1.7 Implement `healthCheck(containerName: string)` — poll container's health status via `container.inspect()`. Return health state. Implement retry loop with configurable interval (default 2s) and timeout (default 60s).
  - [x] 1.8 Create `src/docker/types.ts` with `NodeType = 'town' | 'mill' | 'dvm'`, `ContainerSpec` interface, `OrchestratorEvents` type for progress reporting.
  - [x] 1.9 Create `src/docker/index.ts` re-exporting public API.

- [x] Task 2: Docker Compose file (AC: #2, #3)
  - [x] 2.1 Create `docker-compose-townhouse.yml` at project root with Docker Compose profiles. Include `connector` service (always, no profile — runs unconditionally), `town` service (profile: town), `mill` service (profile: mill), `dvm` service (profile: dvm).
  - [x] 2.2 Connector service definition: image from config (`ghcr.io/toon-protocol/connector:3.3.0`), container_name `townhouse-connector`, network `townhouse-net`, healthcheck using `/health` endpoint, restart `unless-stopped`, expose admin port.
  - [x] 2.3 Town service definition: image `toon:town` (placeholder, built in Story 21.5), container_name `townhouse-town`, network `townhouse-net`, depends_on connector (service_healthy), profiles: [`town`], env vars from config.
  - [x] 2.4 Mill service definition: image `toon:mill` (placeholder, built in Story 21.6), container_name `townhouse-mill`, network `townhouse-net`, depends_on connector (service_healthy), profiles: [`mill`], env vars from config.
  - [x] 2.5 DVM service definition: image `toon:dvm` (placeholder, built in Story 21.7), container_name `townhouse-dvm`, network `townhouse-net`, depends_on connector (service_healthy), profiles: [`dvm`], env vars from config.
  - [x] 2.6 Shared network definition: `townhouse-net` bridge network.

- [x] Task 3: CLI integration (AC: #4, #5, #8)
  - [x] 3.1 Update `src/cli.ts` — replace `handleUp` stub with real orchestration. Make `handleUp` async (currently sync `void`). Parse `--town`, `--mill`, `--dvm` flags from `parseArgs`. If no flags, start all enabled nodes from config. Pass profiles to `DockerOrchestrator.up()`. Wrap orchestrator calls in try/catch to surface Docker-unavailable errors clearly (AC #8).
  - [x] 3.2 Update `src/cli.ts` — replace `handleDown` stub with real orchestration. Make `handleDown` async (currently sync `void`). Call `DockerOrchestrator.down()`. Report each container's stop status.
  - [x] 3.3 Update `handleStatus` to use `DockerOrchestrator.status()` for richer output including health state, uptime, and port mappings.
  - [x] 3.4 Add `--town`, `--mill`, `--dvm` boolean options to the existing `parseArgs` `options` object (currently has `help`, `force`, `config`, `config-dir`). Note: `strict: false` is already set so unknown flags won't error, but adding them explicitly provides type-safe access via `values['town']` etc.
  - [x] 3.5 Update HELP_TEXT to document new flags (e.g., `townhouse up [--town] [--mill] [--dvm]`).
  - [x] 3.6 Register `process.on('SIGINT', ...)` handler in `handleUp` that calls `orchestrator.down()` before exiting, preventing orphaned containers on Ctrl+C.

- [x] Task 4: Image pull progress (AC: #7)
  - [x] 4.1 Implement `pullImages(profiles: NodeType[])` in orchestrator — pulls required images before starting containers. Uses `docker.pull(imageName)` with stream-based progress tracking.
  - [x] 4.2 Implement progress reporting — parse Docker pull stream events (`Downloading`, `Extracting`, `Pull complete`) and emit structured progress events. Use `docker.modem.followProgress()` to consume the pull stream.
  - [x] 4.3 Console output: show image name + progress bar or percentage for each layer during first-time setup. Skip pull if image already exists locally (check via `docker.listImages()`).

- [x] Task 5: Unit tests (AC: #9)
  - [x] 5.1 Create `src/docker/orchestrator.test.ts` — test `up()` with mock dockerode: verifies network creation, connector start, node start order, health check polling. Corresponds to T-007, T-008, T-010.
  - [x] 5.2 Test `down()` with mock dockerode: verifies stop order (nodes before connector), network removal. Corresponds to T-009.
  - [x] 5.3 Test profile combinations: `--town` only, `--mill --dvm`, all three, none enabled in config. All combinations must include connector. Corresponds to T-010.
  - [x] 5.4 Test health check polling: mock container returning unhealthy then healthy, verify retry behavior and timeout. Corresponds to T-015.
  - [x] 5.5 Test image pull progress: mock pull stream, verify progress events emitted correctly. Corresponds to T-011.
  - [x] 5.6 Test Docker daemon unavailable (AC #8): mock dockerode throwing connection error, verify clear error message "Docker is not running" or similar. Corresponds to T-014.
  - [x] 5.7 Test graceful shutdown on SIGINT (from Task 3.6): verify `process.on('SIGINT')` handler calls `orchestrator.down()`, containers stopped, no orphans. Corresponds to T-013.
  - [x] 5.8 Test container restart limit: mock container that keeps exiting, verify orchestrator stops retrying after N attempts. Corresponds to T-012.
  - [x] 5.9 Update `src/cli.test.ts` — add tests for `--town`, `--mill`, `--dvm` flags being parsed correctly and passed to orchestrator.
  - [x] 5.10 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

## Dev Notes

### Architecture Context

This story replaces the `handleUp` and `handleDown` stubs from Story 21.1 with real Docker orchestration. The orchestrator manages the full container lifecycle: network creation, image pulling, container creation/start/stop/removal, and health check polling.

**Key decision D21-002:** Standalone connector, not embedded. The connector container ALWAYS starts first and must be healthy before any node container starts. This is the fundamental ordering constraint.

**Key decision D21-007:** Docker Compose profiles for selective node activation. `townhouse up --town --mill` starts only connector + Town + Mill. The compose file uses profiles so `docker compose --profile town --profile mill up` achieves the same result.

**Orchestrator vs. Compose:** The `DockerOrchestrator` class uses `dockerode` directly (not `docker compose` CLI) for programmatic control, progress reporting, and health check integration. The `docker-compose-townhouse.yml` file serves as documentation and as an alternative for operators who prefer compose directly. Both approaches produce identical container configurations.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** Not applicable (no 64-bit integer bridging).
- **Golden test vectors (ZK story pairs):** Not applicable.

### Critical Implementation Patterns

**Follow Story 21.1 patterns exactly.** All new files must follow the same conventions established in Story 21.1:
- Co-located test files (`orchestrator.test.ts` next to `orchestrator.ts`)
- TypeScript interfaces in dedicated `types.ts` file
- Re-exports via `index.ts`
- Dependency injection for testability (dockerode instance passed in, not instantiated internally)

**dockerode API patterns (from Story 21.1 `status` command):**
```typescript
// Already established in cli.ts — use same pattern:
const docker = new Docker(); // connects to local Docker socket
const containers = await docker.listContainers({ all: true });
const container = docker.getContainer(containerName);
await container.inspect(); // get full container info including health
await container.stop({ t: 10 }); // graceful stop with 10s timeout
await container.remove();
```

**Container naming convention:** All containers use prefix `townhouse-`:
- `townhouse-connector` (always runs)
- `townhouse-town` (profile: town)
- `townhouse-mill` (profile: mill)
- `townhouse-dvm` (profile: dvm)

This prefix is already defined as `CONTAINER_PREFIX` in `cli.ts` from Story 21.1.

**Network name:** `townhouse-net` (Docker bridge network, created by orchestrator).

**Container start order:**
1. Create `townhouse-net` network
2. Pull required images (with progress)
3. Start `townhouse-connector`, wait for health
4. Start enabled node containers in parallel

**Container stop order (reverse):**
1. Stop all node containers in parallel
2. Stop connector
3. Optionally remove network

**Health check pattern:** Poll `container.inspect()` and check `State.Health.Status === 'healthy'`. Retry every 2 seconds, timeout after 60 seconds. The connector exposes `/health` endpoint; node containers will also expose `/health` (defined in Stories 21.5-21.7).

**Image pull with progress:** Use `docker.pull(imageName)` which returns a stream. Pipe through `docker.modem.followProgress(stream, onFinished, onProgress)` to track layer download/extraction progress.

**SIGINT handling:** Register a `process.on('SIGINT', ...)` handler in the CLI that calls `orchestrator.down()` before exiting. This prevents orphaned containers if the operator Ctrl+C during `townhouse up`.

### Dependency Budget

No new dependencies needed. `dockerode` (^4.0.0) is already installed from Story 21.1. All Docker operations use the dockerode API.

### File Structure Requirements

```
# Project root (alongside docker-compose-sdk-e2e.yml)
docker-compose-townhouse.yml        # Docker Compose with profiles (NOT inside packages/townhouse/)

# Package files
packages/townhouse/
├── src/
│   ├── cli.ts                      # Updated: real up/down orchestration, new flags, SIGINT handler
│   ├── cli.test.ts                 # Updated: tests for --town, --mill, --dvm flags
│   ├── docker/
│   │   ├── index.ts                # Re-exports
│   │   ├── types.ts                # NodeType, ContainerSpec, OrchestratorEvents
│   │   ├── orchestrator.ts         # DockerOrchestrator class
│   │   └── orchestrator.test.ts    # Unit tests with mocked dockerode
│   ├── config/                     # Unchanged from Story 21.1
│   └── index.ts                    # Updated: re-export docker module
```

### Testing Strategy

**Test level:** Unit (mocked dockerode). No real Docker containers in unit tests.

**Test scenario to task mapping:**

| Test ID | Scenario | Task(s) | AC |
|---------|----------|---------|-----|
| T-007 | `townhouse up --town --mill` starts connector + Town + Mill (DVM not started) | 5.1, 5.3 | #4 |
| T-008 | Connector health check passes before node containers start | 5.1 | #6 |
| T-009 | `townhouse down` stops all containers and removes network | 5.2 | #5 |
| T-010 | All profile combinations include connector | 5.3 | #4 |
| T-011 | Image pull progress reporting on first-time setup | 5.5 | #7 |
| T-012 | Container restart limit with backoff on failure | 5.8 | #6 |
| T-013 | SIGINT during `townhouse up` triggers graceful shutdown | 5.7 | #5 |
| T-014 | Docker daemon not running -- clear error message | 5.6 | #8 |
| T-015 | Health check polling interval and timeout configurable | 5.4 | #6 |

**Mock strategy:** Create a mock dockerode that simulates:
- `listContainers()` returning configurable container lists
- `createContainer()` / `getContainer()` returning mock container objects
- Container `.start()`, `.stop()`, `.remove()`, `.inspect()` methods
- `createNetwork()` / `listNetworks()` for network management
- `pull()` returning a mock stream for progress testing
- `modem.followProgress()` for consuming pull streams

Use `vi.mock('dockerode')` or inject via constructor (preferred, matching Story 21.1's DI pattern for the `status` command).

### Environment Variables for Containers

The orchestrator must pass config-derived environment variables to each container:

**Connector:**
- `CONNECTOR_ADMIN_PORT` from `config.connector.adminPort`
- `TRANSPORT_MODE` from `config.transport.mode`
- `SOCKS_PROXY` from `config.transport.socksProxy` (if ATOR mode)

**Town:**
- `FEE_PER_EVENT` from `config.nodes.town.feePerEvent`
- `CONNECTOR_URL` = `ws://townhouse-connector:3000` (Docker-internal, no TLS needed)

**Mill:**
- `FEE_BASIS_POINTS` from `config.nodes.mill.feeBasisPoints`
- `CONNECTOR_URL` = `ws://townhouse-connector:3000`

**DVM:**
- `FEE_PER_JOB` from `config.nodes.dvm.feePerJob`
- `CONNECTOR_URL` = `ws://townhouse-connector:3000`

All containers share `townhouse-net` network and communicate via Docker DNS (container names resolve within the network).

### Security Notes

- Docker socket access (`/var/run/docker.sock`) is inherently privileged. Townhouse runs on the host, not inside a container, so this is the expected access pattern.
- Container names are deterministic (no user input in container names) to prevent injection.
- No secrets passed via Docker labels or environment that would be visible in `docker inspect` beyond what's necessary for node operation.

### Project Structure Notes

- `packages/townhouse/src/docker/` is a new subdirectory within the existing package
- `docker-compose-townhouse.yml` at project root follows the same pattern as `docker-compose-sdk-e2e.yml`
- No new package dependencies -- reuses `dockerode` already installed
- `src/index.ts` should be updated to re-export the `DockerOrchestrator` class and docker types

### References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.2] -- Story requirements and acceptance criteria
- [Source: _bmad-output/epics/epic-21-townhouse.md#Key Design Decisions] -- D21-001 (Docker containers), D21-002 (standalone connector), D21-003 (pre-built connector image), D21-007 (compose profiles)
- [Source: _bmad-output/implementation-artifacts/21-1-package-scaffold-and-cli-entrypoint.md] -- Previous story: package scaffold, CLI stubs, config schema, dockerode setup
- [Source: packages/townhouse/src/cli.ts] -- Current CLI with stub `handleUp`/`handleDown` to replace
- [Source: packages/townhouse/src/config/schema.ts] -- TownhouseConfig type definitions (ConnectorConfig, NodesConfig, TransportConfig)
- [Source: packages/townhouse/src/config/defaults.ts] -- Default config values (connector image, ports)
- [Source: docker-compose-sdk-e2e.yml] -- Reference compose file for network, healthcheck, depends_on patterns
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#Story 21.2] -- Test scenarios T-007 through T-015
- [Source: _bmad-output/project-context.md#Technology Stack] -- TypeScript 5.3, ESM-only, tsup, vitest
- [Source: _bmad-output/project-context.md#Boundary Rules] -- Package dependency rules (townhouse is a leaf package)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required.

### Completion Notes List

- **Task 1**: Implemented `DockerOrchestrator` class in `src/docker/orchestrator.ts` with full container lifecycle management: `up()`, `down()`, `status()`, `pullImages()`, `healthCheck()`, `ensureNetwork()`, `startConnector()`, `startNode()`. Uses EventEmitter for progress reporting. DI pattern with dockerode instance passed via constructor.
- **Task 2**: Created `docker-compose-townhouse.yml` at project root with Docker Compose profiles for town, mill, dvm. Connector runs unconditionally. All nodes depend on connector health. Bridge network `townhouse-net` defined.
- **Task 3**: Updated `src/cli.ts` — replaced `handleUp`/`handleDown` stubs with real orchestration. Added `--town`, `--mill`, `--dvm` boolean flags to parseArgs. Added `resolveProfiles()` for flag/config-based profile resolution. Added SIGINT handler for graceful shutdown. Updated HELP_TEXT with new flags.
- **Task 4**: Implemented `pullImages()` with `docker.modem.followProgress()` for stream-based progress tracking. Emits `pullProgress` events. Skips images already present locally via `listImages()`.
- **Task 5**: Activated all 32 ATDD tests in `orchestrator.test.ts` (previously skipped). Updated `cli.test.ts` with 20 tests including new flag parsing, SIGINT handler, and orchestration integration. All 98 tests pass.

### File List

- `packages/townhouse/src/docker/orchestrator.ts` — **created** (DockerOrchestrator class)
- `packages/townhouse/src/docker/orchestrator.test.ts` — **modified** (activated all skipped tests, removed stubs)
- `packages/townhouse/src/docker/types.ts` — unchanged (created by ATDD, already complete)
- `packages/townhouse/src/docker/index.ts` — **modified** (uncommented DockerOrchestrator export)
- `packages/townhouse/src/cli.ts` — **modified** (real orchestration, new flags, SIGINT handler)
- `packages/townhouse/src/cli.test.ts` — **modified** (unskipped ATDD tests, updated mock Docker, new flag tests)
- `packages/townhouse/src/index.ts` — **modified** (added docker module re-exports)
- `docker-compose-townhouse.yml` — **created** (Docker Compose with profiles)

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-20 | Story 21.2 implementation complete: DockerOrchestrator class with full container lifecycle, docker-compose-townhouse.yml with profiles, CLI integration with --town/--mill/--dvm flags and SIGINT handler, all 98 tests passing |

## Code Review Record

### Review Pass #1

| Field | Value |
|-------|-------|
| **Date** | 2026-04-20 |
| **Reviewer Model** | Claude Opus 4.6 (1M context) |
| **Critical Issues** | 0 |
| **High Issues** | 1 |
| **Medium Issues** | 3 |
| **Low Issues** | 4 |
| **Total Issues** | 8 |
| **Outcome** | All 8 issues found and fixed |

**Issues Summary:**

- **High:** SIGINT handler listener leak fixed
- **Medium:** `stopAndRemove` error handling made selective
- **Medium:** `status()` now populates health field
- **Medium:** Non-idiomatic `in` check replaced
- **Low:** `ContainerSpec` kept as public API
- **Low:** Docker network filter comment added
- **Low:** Dead `DockerOrchestratorEmitter` interface removed
- **Low:** Image tag normalization helper added

### Review Pass #2

| Field | Value |
|-------|-------|
| **Date** | 2026-04-20 |
| **Reviewer Model** | Claude Opus 4.6 (1M context) |
| **Critical Issues** | 0 |
| **High Issues** | 0 |
| **Medium Issues** | 2 |
| **Low Issues** | 2 |
| **Total Issues** | 4 |
| **Outcome** | All 4 issues found and fixed |

**Issues Summary:**

- **Medium:** Residual non-idiomatic `'image' in nodeConfig` check in `startNode()` replaced with `nodeConfig.image ?? DEFAULT_NODE_IMAGES[type]`
- **Medium:** `healthCheck()` could propagate transient `inspect()` errors immediately instead of retrying — added try/catch within polling loop to absorb transient failures and retry within the timeout window
- **Low:** Misleading JSDoc comment on `normalizeImageTag()` referenced impossible `toon:town:latest` case — corrected to describe the actual untagged image scenario (e.g., `nginx` vs `nginx:latest`)
- **Low:** `pullImages()` test asserted against `config.connector.image` variable instead of the explicit normalized string — updated to assert against `'ghcr.io/toon-protocol/connector:3.3.0'` directly for precision

### Review Pass #3 (Security + Adversarial)

| Field | Value |
|-------|-------|
| **Date** | 2026-04-20 |
| **Reviewer Model** | Claude Opus 4.6 (1M context) |
| **Critical Issues** | 0 |
| **High Issues** | 0 |
| **Medium Issues** | 2 |
| **Low Issues** | 3 |
| **Total Issues** | 5 |
| **Outcome** | All 5 issues found and fixed |

**Security Scan:** Semgrep (v1.153.0) with `.semgrep.yml` + `auto` rulesets. 1 finding (ws:// WebSocket URL) — suppressed with nosemgrep inline comment (Docker-internal, TLS unnecessary). OWASP Top 10 analysis: no injection (CWE-78/79/89), no auth flaws (Docker socket is host-level expected access), no secrets exposure, prototype pollution already guarded in loader.ts (CWE-1321), log injection sanitized (CWE-117).

**Issues Summary:**

- **Medium:** Semgrep security finding — `ws://` WebSocket URL in `buildNodeEnv()` missing `nosemgrep` suppression comment (CWE-319). Docker-internal container-to-container URL on bridge network, TLS unnecessary. Added inline `nosemgrep` comment consistent with `docker-compose-townhouse.yml` pattern.
- **Medium:** `handleStatus` in CLI still used legacy `getContainerStatuses` helper instead of `DockerOrchestrator.status()` (AC #3.3 not fulfilled). Migrated to use orchestrator, which returns health state. Updated status display to show health info. Updated CLI tests to provide config path.
- **Low:** `stopAndRemove` error event lost error detail — added `detail` field to emitted `containerState` event for observability during shutdown failures.
- **Low:** Dead code removal — `NODE_TYPES` constant, `StatusResult` interface, and `getContainerStatuses` function were vestigial from Story 21.1 stubs, now replaced by orchestrator usage.
- **Low:** `status` command now requires config file (via `-c` flag or default path) to construct orchestrator — updated CLI tests accordingly.
