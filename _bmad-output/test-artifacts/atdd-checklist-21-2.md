---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-20'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/21-2-docker-orchestration-engine.md
  - _bmad-output/planning-artifacts/test-design-epic-21.md
  - packages/townhouse/src/cli.ts
  - packages/townhouse/src/cli.test.ts
  - packages/townhouse/src/config/schema.ts
  - packages/townhouse/src/config/defaults.ts
  - packages/townhouse/vitest.config.ts
---

# ATDD Checklist - Epic 21, Story 2: Docker Orchestration Engine

**Date:** 2026-04-20
**Author:** Jonathan
**Primary Test Level:** Unit (mocked dockerode)

---

## Story Summary

Story 21.2 adds a Docker orchestration engine to Townhouse that manages container lifecycle (create, start, stop, remove) using dockerode. It replaces the stub `handleUp`/`handleDown` methods from Story 21.1 with real Docker orchestration, including network management, health check polling, image pull progress, and graceful shutdown.

**As a** node operator
**I want** Townhouse to manage Docker containers for my nodes
**So that** I don't need to manually run Docker commands

---

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

---

## Failing Tests Created (RED Phase)

### Unit Tests (31 tests) - Orchestrator

**File:** `packages/townhouse/src/docker/orchestrator.test.ts` (340 lines)

- **Test:** `[P0] starts connector + Town + Mill when profiles are [town, mill]`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #4, T-007 - Profile-based container startup

- **Test:** `[P0] creates 3 containers total (connector + 2 nodes) for town+mill`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #4, T-007 - Correct container count

- **Test:** `[P0] waits for connector health before starting node containers`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6, T-008 - Health check gating

- **Test:** `[P0] polls container health via inspect() with retry`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6, T-008 - Health check polling behavior

- **Test:** `[P0] stops node containers before connector`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #5, T-009 - Reverse stop order

- **Test:** `[P0] calls container.stop() with 10s graceful timeout`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #5, T-009 - Graceful shutdown timeout

- **Test:** `[P0] removes containers after stopping them`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #5, T-009 - Container cleanup

- **Test:** `[P0] removes townhouse-net network after stopping all containers`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #5, T-009 - Network cleanup

- **Test:** `[P0] profiles [town] always starts connector` (+ 6 more profile combos)
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #4, T-010 - All combos include connector

- **Test:** `[P1] pulls required images before starting containers`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #7, T-011 - Image pull

- **Test:** `[P1] emits progress events during image pull`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #7, T-011 - Progress reporting

- **Test:** `[P1] skips pull if image already exists locally`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #7, T-011 - Skip existing images

- **Test:** `[P1] stops retrying after N failed start attempts`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6, T-012 - Restart limit

- **Test:** `[P2] throws clear error when Docker daemon is not running`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #8, T-014 - Docker unavailable error

- **Test:** `[P2] respects custom polling interval`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6, T-015 - Configurable health check

- **Test:** `[P2] times out when container never becomes healthy`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6, T-015 - Health check timeout

- **Test:** `[P0] creates townhouse-net bridge network if it does not exist`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - Network creation

- **Test:** `[P0] skips network creation if townhouse-net already exists`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - Idempotent network

- **Test:** `[P1] passes connector env vars from config`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1, AC #3 - Connector env vars

- **Test:** `[P1] passes town-specific env vars from config`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - Town env vars

- **Test:** `[P1] passes mill-specific env vars from config`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - Mill env vars

- **Test:** `[P1] passes dvm-specific env vars from config`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - DVM env vars

- **Test:** `[P1] includes SOCKS_PROXY env when transport mode is ator`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1 - ATOR transport config

- **Test:** `[P1] returns health state for each running container`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #6 - Status reporting

- **Test:** `[P0] executes startup in correct order: network -> pull -> connector -> nodes`
  - **Status:** RED (skipped) - DockerOrchestrator class not implemented
  - **Verifies:** AC #1, #3, #4, #6, #7 - Full startup sequence

### Unit Tests (7 tests) - CLI Flag Parsing

**File:** `packages/townhouse/src/cli.test.ts` (additions, 7 new skipped tests)

- **Test:** `[P0] parses --town flag and passes to orchestrator`
  - **Status:** RED (skipped) - CLI not yet updated with new flags
  - **Verifies:** AC #4, T-007 - Town flag parsing

- **Test:** `[P0] parses --mill flag and passes to orchestrator`
  - **Status:** RED (skipped) - CLI not yet updated with new flags
  - **Verifies:** AC #4, T-007 - Mill flag parsing

- **Test:** `[P0] parses --dvm flag and passes to orchestrator`
  - **Status:** RED (skipped) - CLI not yet updated with new flags
  - **Verifies:** AC #4, T-007 - DVM flag parsing

- **Test:** `[P0] parses combined --town --mill flags`
  - **Status:** RED (skipped) - CLI not yet updated with new flags
  - **Verifies:** AC #4, T-007 - Combined flags

- **Test:** `[P0] defaults to all enabled nodes when no flags provided`
  - **Status:** RED (skipped) - CLI not yet updated with new flags
  - **Verifies:** AC #4, T-010 - Default behavior

- **Test:** `[P1] registers SIGINT handler during up command`
  - **Status:** RED (skipped) - SIGINT handler not implemented
  - **Verifies:** AC #5, T-013 - Graceful shutdown

- **Test:** `[P2] up shows clear error when Docker daemon is not running`
  - **Status:** RED (skipped) - Docker error handling not implemented
  - **Verifies:** AC #8, T-014 - Docker unavailable error in CLI

---

## Data Factories Created

### Mock Docker Factory

**File:** `packages/townhouse/src/docker/orchestrator.test.ts` (inline)

**Exports (test-local):**

- `createMockDocker()` - Creates a fully-mocked dockerode instance with container, network, and image stubs
- `configWithNodes(enabled)` - Creates a TownhouseConfig with specified nodes enabled

**Example Usage:**

```typescript
const { docker, mockContainer, mockNetwork } = createMockDocker();
const config = configWithNodes(['town', 'mill']);
// const orchestrator = new DockerOrchestrator(docker as any, config);
```

---

## Fixtures Created

No external fixture files needed. All test infrastructure is co-located in test files following Story 21.1 patterns (vitest + vi.fn() mocks, temp directories for config).

---

## Mock Requirements

### dockerode Mock

**Target:** `dockerode` npm package (Docker Engine API client)

**Mocked Methods:**

| Method | Success Return | Failure Return |
|--------|---------------|----------------|
| `createContainer(opts)` | Mock container object | `Error('connect ENOENT')` |
| `getContainer(name)` | Mock container object | `Error('no such container')` |
| `listContainers({ all })` | `ContainerInfo[]` | `Error('connect ENOENT')` |
| `createNetwork(opts)` | Mock network object | `Error('connect ENOENT')` |
| `listNetworks(opts)` | `NetworkInfo[]` | `Error('connect ENOENT')` |
| `pull(image)` | Mock stream | `Error('pull access denied')` |
| `modem.followProgress(stream, onFinished, onProgress)` | Calls `onFinished(null)` | Calls `onFinished(error)` |
| `listImages()` | `ImageInfo[]` | `Error('connect ENOENT')` |

**Container Mock Methods:**

| Method | Success Return | Failure Return |
|--------|---------------|----------------|
| `start()` | `undefined` | `Error('container exited')` |
| `stop({ t: 10 })` | `undefined` | `Error('not running')` |
| `remove()` | `undefined` | `Error('conflict')` |
| `inspect()` | `{ State: { Health: { Status: 'healthy' } } }` | `Error('no such container')` |

**Notes:** All mocks use `vi.fn()` from vitest. The mock factory (`createMockDocker()`) is defined inline in `orchestrator.test.ts` following the DI pattern established in Story 21.1.

---

## Required data-testid Attributes

Not applicable. This story is backend/CLI only with no UI components.

---

## Implementation Checklist

### Test: `[P0] starts connector + Town + Mill when profiles are [town, mill]`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Create `src/docker/orchestrator.ts` with `DockerOrchestrator` class
- [ ] Implement constructor accepting dockerode instance + TownhouseConfig
- [ ] Implement `up(profiles: NodeType[])` method
- [ ] Implement `startConnector()` to create+start connector container
- [ ] Implement `startNode(type: NodeType)` to create+start node containers
- [ ] Uncomment import of `DockerOrchestrator` in test file
- [ ] Uncomment orchestrator instantiation and `up()` call in test
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 2-3 hours

---

### Test: `[P0] waits for connector health before starting node containers`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `healthCheck(containerName, options?)` method
- [ ] Add health check polling loop with configurable interval/timeout
- [ ] Call `healthCheck('townhouse-connector')` after starting connector, before nodes
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 1-2 hours

---

### Test: `[P0] stops node containers before connector`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `down()` method
- [ ] Stop node containers first (parallel), then connector
- [ ] Call `container.stop({ t: 10 })` then `container.remove()`
- [ ] Optionally remove `townhouse-net` network
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 1-2 hours

---

### Test: `[P0] profiles [X] always starts connector` (7 combinations)

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Ensure `up()` always calls `startConnector()` regardless of profile selection
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] All 7 profile combination tests pass (green phase)

**Estimated Effort:** 0.5 hours (should pass once `up()` is implemented)

---

### Test: `[P0] creates townhouse-net bridge network if it does not exist`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `ensureNetwork()` method
- [ ] Check `listNetworks()` for existing `townhouse-net`
- [ ] Create with `createNetwork({ Name: 'townhouse-net', Driver: 'bridge' })` if missing
- [ ] Call `ensureNetwork()` at start of `up()`
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: `[P1] pulls required images before starting containers`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Implement `pullImages(profiles: NodeType[])` method
- [ ] Check `listImages()` to skip already-present images
- [ ] Use `docker.pull(imageName)` with `modem.followProgress()` for progress
- [ ] Call `pullImages()` in `up()` after network, before containers
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 1-2 hours

---

### Test: `[P1] passes connector/town/mill/dvm env vars from config`

**File:** `packages/townhouse/src/docker/orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Build environment variable arrays from config for each container type
- [ ] Pass `Env` array to `createContainer()` options
- [ ] Include `CONNECTOR_URL=ws://townhouse-connector:3000` for all node containers
- [ ] Include `SOCKS_PROXY` when transport mode is `ator`
- [ ] Uncomment test assertions
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] All env var tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: `[P0] parses --town/--mill/--dvm flags` (CLI)

**File:** `packages/townhouse/src/cli.test.ts`

**Tasks to make this test pass:**

- [ ] Add `town`, `mill`, `dvm` boolean options to `parseArgs` options
- [ ] Update `handleUp()` to be async, accept parsed flag values
- [ ] If flags provided, use those; else fall back to all enabled nodes from config
- [ ] Pass profiles to `DockerOrchestrator.up()`
- [ ] Update HELP_TEXT with new flags
- [ ] Remove `it.skip` from flag tests
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] All flag parsing tests pass (green phase)

**Estimated Effort:** 1-2 hours

---

### Test: `[P1] registers SIGINT handler during up command`

**File:** `packages/townhouse/src/cli.test.ts`

**Tasks to make this test pass:**

- [ ] Add `process.on('SIGINT', ...)` handler in `handleUp`
- [ ] Handler calls `orchestrator.down()` then exits
- [ ] Remove `it.skip` from SIGINT test
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: `[P2] Docker unavailable clear error`

**File:** `packages/townhouse/src/cli.test.ts` + `orchestrator.test.ts`

**Tasks to make this test pass:**

- [ ] Wrap orchestrator operations in try/catch
- [ ] Detect `ENOENT` / `ECONNREFUSED` from dockerode
- [ ] Throw user-friendly error: "Docker is not running" or similar
- [ ] Remove `it.skip` from Docker unavailable tests
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Test passes (green phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all tests for townhouse package (includes skipped ATDD tests)
pnpm --filter @toon-protocol/townhouse test

# Run only orchestrator tests
pnpm --filter @toon-protocol/townhouse test -- src/docker/orchestrator.test.ts

# Run only CLI tests
pnpm --filter @toon-protocol/townhouse test -- src/cli.test.ts

# Run tests in watch mode
pnpm --filter @toon-protocol/townhouse test:watch

# Run tests with verbose output
pnpm --filter @toon-protocol/townhouse test -- --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 38 tests written and skipped (31 orchestrator + 7 CLI)
- Mock factory created with auto-cleanup pattern
- Mock requirements documented
- Implementation checklist created

**Verification:**

- All tests run and are reported as skipped
- Existing 59 tests still pass (zero regressions)
- Skipped tests fail due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Pick one failing test** from implementation checklist (start with P0 orchestrator tests)
2. **Read the test** to understand expected behavior
3. **Implement minimal code** to make that specific test pass
4. **Remove `it.skip`** from the test
5. **Run the test** to verify it now passes (green)
6. **Check off the task** in implementation checklist
7. **Move to next test** and repeat

**Recommended implementation order:**

1. Create `orchestrator.ts` with class skeleton + `ensureNetwork()`
2. Implement `startConnector()` + `healthCheck()`
3. Implement `startNode()` + `up()` orchestration
4. Implement `down()` with reverse ordering
5. Implement `pullImages()` with progress
6. Update CLI (`handleUp`/`handleDown`) with flag parsing + orchestrator
7. Add SIGINT handler
8. Docker-unavailable error handling

**Key Principles:**

- One test at a time (don't try to fix all at once)
- Minimal implementation (don't over-engineer)
- Run tests frequently (immediate feedback)
- Use implementation checklist as roadmap

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. **Verify all tests pass** (green phase complete)
2. **Review code for quality** (readability, maintainability, performance)
3. **Extract duplications** (DRY principle)
4. **Ensure tests still pass** after each refactor
5. **Create `docker-compose-townhouse.yml`** at project root (AC #2)

---

## Next Steps

1. **Review this checklist** -- confirm test coverage matches expectations
2. **Run failing tests** to confirm RED phase: `pnpm --filter @toon-protocol/townhouse test`
3. **Begin implementation** using implementation checklist as guide
4. **Work one test at a time** (remove `it.skip` -> implement -> green)
5. **When all tests pass**, refactor code for quality
6. **When refactoring complete**, update story status to 'done'

---

## Knowledge Base References Applied

This ATDD workflow consulted the following knowledge fragments:

- **test-quality.md** - Test design principles (Given-When-Then, one assertion per test, determinism, isolation)
- **data-factories.md** - Factory patterns for mock Docker objects with configurable behavior
- **test-levels-framework.md** - Test level selection: Unit tests with mocked dockerode (no real Docker in unit tests)

Additionally referenced:
- **test-design-epic-21.md** - Test scenarios T-007 through T-015 with priorities
- **Story 21.1 patterns** - DI pattern, co-located tests, vi.mock/vi.fn usage

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/townhouse test`

**Results:**

```
 RUN  v1.6.1 /packages/townhouse

 ✓ src/package-structure.test.ts  (9 tests) 2ms
 ↓ src/docker/orchestrator.test.ts  (31 tests | 31 skipped)
 ✓ src/config/validator.test.ts  (23 tests) 5ms
 ✓ src/config/loader.test.ts  (14 tests) 27ms
 ✓ src/cli.test.ts  (20 tests | 7 skipped) 25ms

 Test Files  4 passed | 1 skipped (5)
      Tests  59 passed | 38 skipped (97)
   Duration  334ms
```

**Summary:**

- Total tests: 97 (59 existing + 38 new ATDD)
- Passing: 59 (all existing tests -- zero regressions)
- Skipped: 38 (all new ATDD tests -- RED phase)
- Status: RED phase verified

---

## Notes

- All new tests follow Story 21.1 conventions: co-located test files, DI for dockerode, vitest + vi.fn() mocks
- The `types.ts` stub file is created with full type definitions to support test authoring; implementation code will import from it
- The `docker/index.ts` re-export stub is ready; uncomment `DockerOrchestrator` export when implemented
- The `docker-compose-townhouse.yml` file (AC #2) is not tested via unit tests; it should be created during the GREEN/REFACTOR phase as documentation and alternative compose path

---

**Generated by BMad TEA Agent** - 2026-04-20
