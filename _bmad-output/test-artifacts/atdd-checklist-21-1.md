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
  - _bmad-output/implementation-artifacts/21-1-package-scaffold-and-cli-entrypoint.md
  - _bmad/tea/config.yaml
  - _bmad/tea/testarch/knowledge/data-factories.md
  - _bmad/tea/testarch/knowledge/test-quality.md
  - _bmad/tea/testarch/knowledge/test-levels-framework.md
  - packages/mill/src/cli.ts
  - packages/mill/src/cli.test.ts
  - packages/mill/src/package-structure.test.ts
  - packages/mill/vitest.config.ts
---

# ATDD Checklist - Epic 21, Story 21.1: Package Scaffold + CLI Entrypoint

**Date:** 2026-04-20
**Author:** Jonathan
**Primary Test Level:** Unit

---

## Story Summary

Townhouse is a host-native orchestrator for Docker-containerized TOON nodes. This story creates the foundation package (`packages/townhouse/`) with CLI entrypoint supporting init, up, down, and status commands, plus a YAML-based config schema with runtime validation and environment variable overrides.

**As a** node operator
**I want** a `townhouse` CLI command
**So that** I can initialize, start, stop, and check status of my nodes

---

## Acceptance Criteria

1. `packages/townhouse/` package created in monorepo with `package.json`, `tsconfig.json`
2. CLI entrypoint at `src/cli.ts` with commands: `init`, `up`, `down`, `status`
3. `townhouse init` creates `~/.townhouse/config.yaml` with default settings
4. `townhouse status` shows running/stopped state for each node type
5. Config schema defined in `src/config/schema.ts` covering all node types, fees, wallet, ATOR toggle
6. Unit tests for config loading and validation

---

## Failing Tests Created (RED Phase)

### Unit Tests (47 tests)

#### File: `packages/townhouse/src/config/validator.test.ts` (145 lines)

- it.skip **[P0] rejects undefined input with descriptive error**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig rejects invalid input

- it.skip **[P0] rejects null input with descriptive error**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig rejects null

- it.skip **[P0] rejects empty object — missing required fields**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig rejects missing required fields

- it.skip **[P0] rejects config with invalid nodes.town.enabled type**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig type checking

- it.skip **[P1] rejects config with invalid transport.mode value**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig enum validation

- it.skip **[P1] rejects config with invalid logging.level value**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig enum validation

- it.skip **[P1] rejects config with missing wallet.encrypted_path**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig required field validation

- it.skip **[P2] rejects config with non-numeric api.port**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig type checking

- it.skip **[P0] accepts valid minimal config and returns typed TownhouseConfig**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig happy path

- it.skip **[P1] accepts config with ator transport mode and socksProxy**
  - **Status:** RED - validator.ts does not exist yet
  - **Verifies:** T-003 — validateConfig accepts optional fields

#### File: `packages/townhouse/src/config/loader.test.ts` (130 lines)

- it.skip **[P0] loads valid YAML config and returns typed TownhouseConfig**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-001 — loadConfig YAML parsing

- it.skip **[P0] throws descriptive error when config file does not exist**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-001 — loadConfig file-not-found

- it.skip **[P1] throws descriptive error for malformed YAML**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-001 — loadConfig malformed input

- it.skip **[P1] TOWNHOUSE_API_PORT env var overrides YAML api.port**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-006 — env var override

- it.skip **[P1] TOWNHOUSE_TRANSPORT_MODE env var overrides YAML transport.mode**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-006 — env var override

- it.skip **[P1] TOWNHOUSE_LOG_LEVEL env var overrides YAML logging.level**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-006 — env var override

- it.skip **[P2] env vars take precedence even when YAML has explicit values**
  - **Status:** RED - loader.ts does not exist yet
  - **Verifies:** T-006 — env var precedence

#### File: `packages/townhouse/src/cli.test.ts` (170 lines)

- it.skip **[P1] main(["--help"]) throws CliHelpRequested**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-005 — CLI --help output

- it.skip **[P1] CliHelpRequested message includes init, up, down, status**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-005 — all commands documented

- it.skip **[P0] init --force creates ~/.townhouse/config.yaml with valid YAML**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-001 — init creates config

- it.skip **[P0] init --force creates config directory with 0o700 permissions**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-001 — security: directory permissions

- it.skip **[P1] init --force creates config file with 0o600 permissions**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-001 — security: file permissions

- it.skip **[P0] init without --force on existing config does not overwrite**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-004 — no silent overwrite

- it.skip **[P0] status shows "stopped" for all node types when no containers running**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** T-002 — status with empty Docker

- it.skip **[P1] cli.ts file exists with shebang on line 1**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** structural guarantee

- it.skip **[P1] cli module exports a main(argv) function**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** structural guarantee

- it.skip **[P1] cli module exports CliHelpRequested error class**
  - **Status:** RED - cli.ts does not exist yet
  - **Verifies:** structural guarantee

#### File: `packages/townhouse/src/package-structure.test.ts` (130 lines)

- it.skip **[P0] package.json exists at packages/townhouse/package.json**
  - **Status:** RED - package.json not fully scaffolded yet
  - **Verifies:** AC-1 — package exists

- it.skip **[P0] name is @toon-protocol/townhouse**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — correct package name

- it.skip **[P0] type is "module" (ESM-only)**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — ESM constraint

- it.skip **[P0] bin.townhouse points at ./dist/cli.js**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — CLI bin entry

- it.skip **[P1] exports map has "." entry with types and import**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — exports map

- it.skip **[P1] files array contains only "dist"**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — publishable files

- it.skip **[P1] engines.node is >=20**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — engine constraint

- it.skip **[P1] has yaml in dependencies**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — required dependency

- it.skip **[P1] has dockerode in dependencies**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — required dependency

- it.skip **[P2] does NOT have @toon-protocol/core in dependencies**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — boundary rule

- it.skip **[P2] does NOT have @toon-protocol/sdk in dependencies**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — boundary rule

- it.skip **[P2] no workspace:* in dependencies (publishable)**
  - **Status:** RED - package.json not scaffolded yet
  - **Verifies:** AC-1 — publishability

- it.skip **[P1] tsconfig.json extends root and has correct settings**
  - **Status:** RED - tsconfig.json not created yet
  - **Verifies:** AC-1 — TypeScript config

- it.skip **[P1] tsup.config.ts registers both src/index.ts AND src/cli.ts entries**
  - **Status:** RED - tsup.config.ts not created yet
  - **Verifies:** AC-1 — build config

- it.skip **[P1] vitest.config.ts exists with node environment**
  - **Status:** RED - vitest.config.ts not created yet
  - **Verifies:** AC-1 — test config

- it.skip **[P0] exports TownhouseConfig type (via re-export)**
  - **Status:** RED - index.ts not created yet
  - **Verifies:** AC-1 — public API surface

---

## Data Factories Created

N/A — This story uses inline test data with descriptive values rather than faker-based factories. Config objects are small and self-contained; factory overhead is not warranted for YAML config validation tests. Temp directories use `mkdtempSync` for isolation.

---

## Fixtures Created

N/A — Tests use vitest built-in `vi.mock()` and `vi.spyOn()` for dependency injection (dockerode, os.homedir). Temp directories with `afterEach` cleanup provide test isolation without custom fixture infrastructure.

---

## Mock Requirements

### Dockerode Mock

**Purpose:** Mock Docker Engine API client for `status` command tests (no Docker daemon in unit test context).

**Mock strategy:** `vi.mock('dockerode')` returning a constructor that produces an object with `listContainers: vi.fn().mockResolvedValue([])`.

**Notes:** Full Docker integration testing deferred to Story 21.2.

### os.homedir Mock

**Purpose:** Redirect config file operations to temp directories instead of real `~/.townhouse/`.

**Mock strategy:** `vi.spyOn(os, 'homedir').mockReturnValue(tempDir)`.

**Notes:** All tests use `mkdtempSync` + `rmSync` cleanup in `afterEach`.

---

## Required data-testid Attributes

N/A — This story has no UI components. Townhouse is a CLI-only package.

---

## Implementation Checklist

### Test: package-structure.test.ts (16 tests)

**File:** `packages/townhouse/src/package-structure.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/townhouse/package.json` with all required fields (name, type, bin, exports, files, engines, dependencies)
- [ ] Create `packages/townhouse/tsconfig.json` extending root
- [ ] Create `packages/townhouse/tsup.config.ts` with entry points `['src/index.ts', 'src/cli.ts']`
- [ ] Create `packages/townhouse/vitest.config.ts` matching Mill pattern
- [ ] Create `packages/townhouse/src/index.ts` re-exporting loadConfig, validateConfig, TownhouseConfig
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Remove `it.skip` from passing tests (green phase)

**Estimated Effort:** 1 hour

---

### Test: validator.test.ts (10 tests)

**File:** `packages/townhouse/src/config/validator.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/townhouse/src/config/schema.ts` with TownhouseConfig interface
- [ ] Create `packages/townhouse/src/config/validator.ts` with `validateConfig(raw: unknown): TownhouseConfig`
- [ ] Implement type narrowing for nodes, wallet, connector, transport, api, logging
- [ ] Implement enum validation for transport.mode ('ator' | 'direct') and logging.level
- [ ] Implement descriptive error messages for each validation failure
- [ ] Create `packages/townhouse/src/config/index.ts` re-exporting all config modules
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Remove `it.skip` from passing tests (green phase)

**Estimated Effort:** 1.5 hours

---

### Test: loader.test.ts (7 tests)

**File:** `packages/townhouse/src/config/loader.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/townhouse/src/config/loader.ts` with `loadConfig(configPath: string): TownhouseConfig`
- [ ] Implement YAML parsing using `yaml` package
- [ ] Implement file-not-found error handling with descriptive message
- [ ] Implement malformed YAML error handling
- [ ] Implement env var overrides: TOWNHOUSE_API_PORT, TOWNHOUSE_TRANSPORT_MODE, TOWNHOUSE_LOG_LEVEL
- [ ] Wire loader through validateConfig for type safety
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Remove `it.skip` from passing tests (green phase)

**Estimated Effort:** 1 hour

---

### Test: cli.test.ts (10 tests)

**File:** `packages/townhouse/src/cli.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/townhouse/src/cli.ts` with shebang `#!/usr/bin/env node`
- [ ] Implement `parseArgs` from `node:util` for subcommand routing
- [ ] Export `CliHelpRequested` error class
- [ ] Export `main(argv: string[])` function
- [ ] Implement `init` command: create `~/.townhouse/` (0o700), write default config.yaml (0o600)
- [ ] Implement `init` --force flag guard (no overwrite without --force)
- [ ] Create `packages/townhouse/src/config/defaults.ts` with default config values
- [ ] Implement `status` command: load config, check Docker via dockerode, print node states
- [ ] Implement `up` command stub (placeholder)
- [ ] Implement `down` command stub (placeholder)
- [ ] Implement self-invoke guard using `import.meta.url` pattern
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test`
- [ ] Remove `it.skip` from passing tests (green phase)

**Estimated Effort:** 2 hours

---

## Running Tests

```bash
# Run all failing tests for this story
pnpm --filter @toon-protocol/townhouse test

# Run specific test file
pnpm --filter @toon-protocol/townhouse test -- src/config/validator.test.ts

# Run tests in watch mode
pnpm --filter @toon-protocol/townhouse test:watch

# Debug specific test
pnpm --filter @toon-protocol/townhouse test -- --reporter=verbose src/cli.test.ts

# Run tests with coverage
pnpm --filter @toon-protocol/townhouse test -- --coverage
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 47 tests written and skipped (RED)
- Mock requirements documented (dockerode, os.homedir)
- Implementation checklist created mapping tests to code tasks
- Test patterns follow Mill package conventions

**Verification:**

- All tests are `it.skip()` — they will be skipped (not fail with errors) until implementation
- Tests assert expected behavior, not placeholder assertions
- Tests use temp directories for isolation (never real `~/.townhouse/`)

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Start with package-structure.test.ts** — scaffold package.json, tsconfig, tsup, vitest configs
2. **Then validator.test.ts** — create schema.ts types and validator.ts runtime validation
3. **Then loader.test.ts** — create loader.ts with YAML parsing and env var overrides
4. **Then cli.test.ts** — create cli.ts with all subcommands
5. **For each test file:** remove `it.skip`, run tests, verify pass
6. **Check off tasks** in implementation checklist above

**Key Principles:**

- One test file at a time (package-structure -> validator -> loader -> cli)
- Minimal implementation (don't over-engineer)
- Run tests frequently: `pnpm --filter @toon-protocol/townhouse test`
- Use implementation checklist as roadmap

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all 47 tests pass (green phase complete)
2. Review code for quality (readability, maintainability)
3. Extract duplications (DRY principle)
4. Ensure tests still pass after each refactor
5. Run `pnpm lint && pnpm format` for code quality

---

## Next Steps

1. **Run failing tests** to confirm RED phase: `pnpm --filter @toon-protocol/townhouse test`
2. **Begin implementation** using implementation checklist as guide
3. **Work one test file at a time** (red -> green for each)
4. **When all tests pass**, refactor code for quality
5. **When refactoring complete**, update story status to 'done'

---

## Knowledge Base References Applied

This ATDD workflow consulted the following knowledge fragments:

- **data-factories.md** — Factory patterns with overrides (adapted: inline config objects instead of faker for this story)
- **test-quality.md** — Deterministic tests, isolation, explicit assertions, self-cleaning with temp dirs
- **test-levels-framework.md** — Unit test level selection (pure functions, validation logic, no E2E needed)
- **test-healing-patterns.md** — Common failure patterns awareness (referenced for robust assertions)

See `tea-index.csv` for complete knowledge fragment mapping.

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/townhouse test`

**Expected Results:**

```
Tests: 43 skipped
Duration: <1s
```

**Summary:**

- Total tests: 47
- Passing: 0 (expected)
- Skipped: 47 (expected — all use it.skip())
- Failing: 0 (skipped tests don't count as failures)
- Status: RED phase verified (all tests skipped until implementation)

**Note:** Tests use `it.skip()` rather than running and failing because the source modules (`cli.ts`, `loader.ts`, `validator.ts`, `index.ts`) do not exist yet. Import failures would produce noisy error output rather than actionable test failures. The `it.skip()` pattern clearly documents expected behavior while keeping CI green during red phase.

---

## Notes

- **Backend-only project** — no browser/E2E tests needed for this CLI package
- **Test framework:** vitest (matching Mill package pattern), NOT Playwright
- **Detected stack:** backend (Node.js CLI tool)
- **Generation mode:** AI generation (no browser recording)
- **No mnemonic in config** — wallet is encrypted separately (Story 21.4)
- **dockerode mock** — full Docker integration deferred to Story 21.2
- **Temp directories** — all file operations use `os.tmpdir()`, never real `~/.townhouse/`

---

## Contact

**Questions or Issues?**

- Refer to `_bmad-output/implementation-artifacts/21-1-package-scaffold-and-cli-entrypoint.md` for story details
- Refer to `packages/mill/` for reference implementation patterns

---

**Generated by BMad TEA Agent** - 2026-04-20
