# Story 21.1: Package Scaffold + CLI Entrypoint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a `townhouse` CLI command,
so that I can initialize, start, stop, and check status of my nodes.

## Acceptance Criteria

1. `packages/townhouse/` package created in monorepo with `package.json`, `tsconfig.json`
2. CLI entrypoint at `src/cli.ts` with commands: `init`, `up`, `down`, `status`
3. `townhouse init` creates `~/.townhouse/config.yaml` with default settings
4. `townhouse status` shows running/stopped state for each node type
5. Config schema defined in `src/config/schema.ts` covering all node types, fees, wallet, ATOR toggle
6. Unit tests for config loading and validation

## Tasks / Subtasks

- [x] Task 1: Package scaffold (AC: #1)
  - [x] 1.1 Create `packages/townhouse/` directory
  - [x] 1.2 Create `package.json` following Mill's pattern exactly. Required fields: `"name": "@toon-protocol/townhouse"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "./dist/index.js"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `"bin": { "townhouse": "./dist/cli.js" }`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, `"files": ["dist"]`, `"engines": { "node": ">=20" }`, `"publishConfig": { "access": "public" }`. Scripts: `"build": "tsup"`, `"dev": "tsup --watch"`, `"test": "vitest run"`, `"test:watch": "vitest"`.
  - [x] 1.3 Add dependencies: `yaml` (YAML 1.2 parser), `dockerode` (Docker Engine API client). Add devDependencies: `@types/dockerode`, `@types/node` (^20.0.0), `tsup` (^8.0.0), `typescript` (^5.3.0), `vitest` (^1.0.0). Do NOT add `@toon-protocol/core` or `@toon-protocol/sdk`.
  - [x] 1.4 Create `tsconfig.json` extending root (`../../tsconfig.json`) with `outDir: ./dist`, `rootDir: ./src`, `include: ["src/**/*"]`, `exclude: ["node_modules", "dist"]`
  - [x] 1.5 Create `tsup.config.ts` with entry points `['src/index.ts', 'src/cli.ts']`, ESM format, dts, sourcemap, `clean: true`, `outDir: 'dist'`, `outExtension: () => ({ js: '.js' })` (required so bin entry `./dist/cli.js` resolves correctly)
  - [x] 1.6 Create `vitest.config.ts` matching Mill's pattern: `environment: 'node'`, `include: ['src/**/*.test.ts']`, `exclude: ['**/node_modules/**', '**/dist/**']`
  - [x] 1.7 Create `src/index.ts` re-exporting public API types and functions (TownhouseConfig, loadConfig, validateConfig)
  - [x] 1.8 Verify `packages/*` glob in root `pnpm-workspace.yaml` already covers `packages/townhouse/` (it does). Verify `dist/` is covered by existing `.gitignore` patterns.
  - [x] 1.9 Run `pnpm install` and `pnpm --filter @toon-protocol/townhouse build` to verify scaffold compiles

- [x] Task 2: Config schema (AC: #5)
  - [x] 2.1 Create `src/config/schema.ts` with `TownhouseConfig` TypeScript interface covering:
    - `nodes: { town: TownNodeConfig; mill: MillNodeConfig; dvm: DvmNodeConfig }` (each with `enabled: boolean`, type-specific fee settings)
    - `wallet: { encrypted_path: string }` (no plaintext mnemonic in config)
    - `connector: { image: string; adminPort: number }`
    - `transport: { mode: 'ator' | 'direct'; socksProxy?: string }`
    - `api: { port: number; host: string }`
    - `logging: { level: 'debug' | 'info' | 'warn' | 'error' }` (operator needs log-level control)
  - [x] 2.2 Create `src/config/defaults.ts` with sensible default values (all nodes disabled, connector image `ghcr.io/toon-protocol/connector:3.3.0`, api port 9400, host `127.0.0.1`, logging level `info`, transport mode `direct`)
  - [x] 2.3 Create `src/config/loader.ts` with `loadConfig(configPath: string): TownhouseConfig` function. Uses `yaml` package to parse YAML. Supports env var overrides for key settings: `TOWNHOUSE_API_PORT`, `TOWNHOUSE_TRANSPORT_MODE`, `TOWNHOUSE_LOG_LEVEL` (env vars take precedence over YAML values; required for T-006).
  - [x] 2.4 Create `src/config/validator.ts` with `validateConfig(raw: unknown): TownhouseConfig` that validates shape, narrows types, and returns typed config or throws descriptive errors. Note: schema.ts defines the TypeScript types/interfaces only; validator.ts owns all runtime validation logic.
  - [x] 2.5 Create `src/config/index.ts` re-exporting all config modules

- [x] Task 3: CLI entrypoint (AC: #2, #3, #4)
  - [x] 3.1 Create `src/cli.ts` with shebang `#!/usr/bin/env node`, `parseArgs` from `node:util` (same pattern as Mill CLI at `packages/mill/src/cli.ts`)
  - [x] 3.2 Implement subcommand routing for `init`, `up`, `down`, `status`, `--help`
  - [x] 3.3 Implement `init` command: create `~/.townhouse/` directory (via `os.homedir()`, not hardcoded) with `0o700` permissions, generate default config YAML at `~/.townhouse/config.yaml` with `0o600` permissions, prompt-guard for existing config (no overwrite without `--force`)
  - [x] 3.4 Implement `status` command: load config, check Docker container states via `dockerode`, print table of node types with running/stopped state. Accept dockerode instance as optional parameter for testability (dependency injection).
  - [x] 3.5 Implement `up` command stub: load config, log "Starting nodes..." placeholder (full orchestration is Story 21.2)
  - [x] 3.6 Implement `down` command stub: load config, log "Stopping nodes..." placeholder (full orchestration is Story 21.2)
  - [x] 3.7 Export `main(argv: string[])` for testability (same pattern as Mill CLI)
  - [x] 3.8 Export `CliHelpRequested` error class for test assertions
  - [x] 3.9 Self-invoke guard using `import.meta.url === pathToFileURL(process.argv[1]).href` pattern (use `fileURLToPath(import.meta.url)` + `path.dirname()` for `__dirname` equivalent -- `import.meta.dirname` requires Node 21+, project targets >=20)

- [x] Task 4: Unit tests (AC: #6)
  - [x] 4.1 Create `src/config/validator.test.ts` — test `validateConfig` rejects invalid input (missing required fields, wrong types), accepts valid input, returns typed `TownhouseConfig`. Corresponds to T-003.
  - [x] 4.2 Create `src/config/loader.test.ts` — test YAML loading from temp directory (use `os.tmpdir()`, never real `~/.townhouse/`), test file-not-found error, test malformed YAML error, test env var overrides (`TOWNHOUSE_API_PORT`, `TOWNHOUSE_TRANSPORT_MODE`) take precedence over YAML values. Corresponds to T-001, T-006.
  - [x] 4.3 Create `src/cli.test.ts` — test `--help` returns CliHelpRequested (T-005), test `init --force` creates config (T-001), test `init` without `--force` on existing config does not overwrite (T-004), test `status` with mocked dockerode returning no containers shows "stopped" for all node types (T-002). Mock dockerode via `vi.mock('dockerode')` or inject via constructor parameter.
  - [x] 4.4 Create `src/package-structure.test.ts` — verify package.json has correct fields: `type: "module"`, `exports` map, `bin` entry, `engines`, `files: ["dist"]`, no `workspace:*` in dependencies at publish time.
  - [x] 4.5 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

## Dev Notes

### Architecture Context

Townhouse is a **host-native** orchestrator + dashboard managing Docker-containerized TOON nodes (Town, Mill, DVM) behind a shared standalone connector. This story creates the foundation package and CLI skeleton. Stories 21.2+ add Docker orchestration, connector integration, and dashboard.

**Key decision D21-002:** Standalone connector, not embedded. A single shared connector handles all ILP routing. Townhouse CLI manages the connector container alongside node containers. This is fundamentally different from Town/Mill which each embed their own connector instance.

**Key decision D21-003:** Connector image is pre-built (`ghcr.io/toon-protocol/connector:3.3.0`). No custom Dockerfile.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** If this story creates or modifies GitHub Actions workflows, pin ALL action references to full commit SHAs (not tags). Unpinned SHAs are an OWASP A08 supply-chain risk. Example: `uses: actions/checkout@<full-sha>` not `uses: actions/checkout@v4`.
- **MAX_SAFE_INTEGER guard:** If this story bridges Rust u64 (or any 64-bit integer) values into JavaScript, guard against exceeding `Number.MAX_SAFE_INTEGER` (2^53 - 1) before assigning to a JS `number`. Use `BigInt` for values that may exceed this limit. Pattern: `if (value > Number.MAX_SAFE_INTEGER) throw new RangeError(...)`.
- **Golden test vectors (ZK story pairs):** Not applicable to this story.

### Critical Implementation Patterns

**Follow the Mill package pattern exactly.** Mill (`packages/mill/`) was the most recent new package added to the monorepo (Epic 12). Mirror its structure:

| File | Mill | Townhouse |
|------|------|-----------|
| `package.json` | `"type": "module"`, tsup build, vitest, bin entry | Same |
| `tsconfig.json` | Extends `../../tsconfig.json` | Same |
| `tsup.config.ts` | ESM, dts, sourcemap, `['src/index.ts', 'src/cli.ts']` | Same |
| `src/cli.ts` | `parseArgs`, `CliHelpRequested`, self-invoke guard | Same |
| `src/index.ts` | Re-exports public API | Same |

**TypeScript compiler options (inherited from root):**
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- `moduleResolution: "bundler"`
- Target ES2022, ESNext modules

**Config format: YAML, not JSON.** Townhouse config is YAML (`~/.townhouse/config.yaml`) because it's operator-facing and will be hand-edited. Mill uses JSON because its config is typically generated. Use a YAML parser library -- `yaml` (npm package, already available in ecosystem) or `js-yaml`. Prefer `yaml` (YAML 1.2 compliant, TypeScript types).

**Dependency budget for this story:**
- `yaml` -- YAML parser for config loading
- `dockerode` -- Docker Engine API client (needed for `status` command container inspection). Add as dependency now even though full orchestration is Story 21.2.
- `@types/dockerode` -- TypeScript types (devDependency)
- Do NOT add `@toon-protocol/core` or `@toon-protocol/sdk` yet -- Townhouse is an orchestrator, not a TOON node. It manages containers that run TOON nodes. Direct SDK dependency may come later for wallet integration (Story 21.4).

**Config file location:** `~/.townhouse/config.yaml` (using `os.homedir()`, not hardcoded `/home/`). Create directory `~/.townhouse/` if it doesn't exist. On macOS this is `/Users/<name>/.townhouse/`.

**No mnemonic in config file.** The config schema must NOT include a mnemonic or seed phrase field. Wallet is encrypted separately at `~/.townhouse/wallet.enc` (Story 21.4). Config only references the encrypted wallet path.

### File Structure Requirements

```
packages/townhouse/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts            # Required (matches Mill pattern: environment node, include src/**/*.test.ts)
├── src/
│   ├── index.ts                # Re-exports public API
│   ├── cli.ts                  # CLI entrypoint
│   ├── cli.test.ts             # CLI tests
│   ├── config/
│   │   ├── index.ts            # Re-exports
│   │   ├── schema.ts           # TownhouseConfig type definitions (interfaces only)
│   │   ├── validator.test.ts   # Runtime validation tests
│   │   ├── defaults.ts         # Default config values
│   │   ├── loader.ts           # YAML file loading
│   │   ├── loader.test.ts
│   │   └── validator.ts        # Runtime type validation
│   └── package-structure.test.ts  # Package integrity tests
└── dist/                       # Build output (gitignored)
```

### Testing Strategy

**Test level:** Unit only (no Docker containers needed for this story).

**From the Epic 21 test design (R-015):**
- T-001: `townhouse init` creates default config at `~/.townhouse/config.yaml` -- Config file exists with valid YAML matching schema
- T-002: `townhouse status` with no containers running -- Shows "stopped" for all node types
- T-003: Config schema rejects invalid YAML (missing required fields) -- Validation error with descriptive message
- T-004: `townhouse init` with existing config (no --force) -- Prompts for confirmation, does not overwrite without consent
- T-005: CLI `--help` output includes all commands -- All 4 commands documented: init, up, down, status
- T-006: Config loading with environment variable overrides -- Env vars override YAML values for key settings

**Mock strategy:** Mock `dockerode` for `status` command tests (containers not available in unit test context). Mock `fs` for config file tests (use temp directories, not real `~/.townhouse/`). This is unit-level testing; real Docker comes in Story 21.2 integration tests.

### Security Notes

- Config file should have restrictive permissions (0600) when created
- Never log or display wallet paths with plaintext content
- `--force` flag for init must be explicit -- no silent overwrite

### Project Structure Notes

- `packages/townhouse/` is a new leaf package -- nothing imports from it
- Aligns with monorepo conventions: ESM-only, tsup build, vitest tests, co-located test files
- Package name: `@toon-protocol/townhouse`
- Binary name: `townhouse` (in package.json `bin` field)

### References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.1] -- Story requirements and acceptance criteria
- [Source: _bmad-output/epics/epic-21-townhouse.md#Key Design Decisions] -- D21-001 through D21-008
- [Source: _bmad-output/project-context.md#Technology Stack] -- TypeScript 5.3, ESM-only, tsup, vitest
- [Source: _bmad-output/project-context.md#Boundary Rules] -- Package dependency rules
- [Source: packages/mill/package.json] -- Reference package.json for new package scaffold
- [Source: packages/mill/src/cli.ts] -- Reference CLI pattern (parseArgs, CliHelpRequested, self-invoke)
- [Source: packages/mill/tsup.config.ts] -- Reference tsup config
- [Source: packages/mill/tsconfig.json] -- Reference tsconfig extending root
- [Source: packages/mill/vitest.config.ts] -- Reference vitest config for unit tests
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#Story 21.1] -- Test scenarios T-001 through T-006

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None.

### Completion Notes List

- Task 1: Created `packages/townhouse/` package scaffold mirroring Mill's pattern exactly: `package.json` (ESM, tsup, vitest, bin entry), `tsconfig.json` (extends root), `tsup.config.ts` (dual entry points, ESM, dts, sourcemap), `vitest.config.ts` (node environment). Verified pnpm-workspace.yaml glob covers new package. Build compiles cleanly.
- Task 2: Implemented config schema with TypeScript interfaces (`schema.ts`), sensible defaults (`defaults.ts`), YAML file loader with env var overrides (`loader.ts`), and runtime validator with descriptive errors (`validator.ts`). All re-exported via `config/index.ts`.
- Task 3: Implemented CLI entrypoint with `init`, `up`, `down`, `status`, `--help` subcommands. `init` creates `~/.townhouse/config.yaml` with `0o600` permissions, respects `--force` flag. `status` uses dockerode to check container states. `up`/`down` are stubs for Story 21.2. Uses `parseArgs` from `node:util`, exports `main()` and `CliHelpRequested` for testability. Self-invoke guard uses `pathToFileURL` pattern (Node 20 compatible).
- Task 4: Created 4 test files with 36 tests covering: config validation (14 tests), config loading with env overrides (7 tests), CLI commands (6 tests), package structure integrity (9 tests). All tests pass. Corresponds to test scenarios T-001 through T-006.
- Fixed DTS build error (TownhouseConfig not assignable to Record<string, unknown> in deepMerge).
- Fixed 4 lint errors: unused imports (`dirname`, `tmpdir`, `randomBytes`, `currentFile`/`fileURLToPath`), dynamic delete in test env cleanup (switched to Map).

### File List

- `packages/townhouse/package.json` (created)
- `packages/townhouse/tsconfig.json` (created)
- `packages/townhouse/tsup.config.ts` (created)
- `packages/townhouse/vitest.config.ts` (created)
- `packages/townhouse/src/index.ts` (created)
- `packages/townhouse/src/cli.ts` (created)
- `packages/townhouse/src/cli.test.ts` (created)
- `packages/townhouse/src/package-structure.test.ts` (created)
- `packages/townhouse/src/config/index.ts` (created)
- `packages/townhouse/src/config/schema.ts` (created)
- `packages/townhouse/src/config/defaults.ts` (created)
- `packages/townhouse/src/config/loader.ts` (created)
- `packages/townhouse/src/config/loader.test.ts` (created)
- `packages/townhouse/src/config/validator.ts` (created)
- `packages/townhouse/src/config/validator.test.ts` (created)

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-20 | Story 21.1 implementation: Created @toon-protocol/townhouse package scaffold with CLI entrypoint (init/up/down/status), YAML config schema with runtime validation and env var overrides, and 36 unit tests. All ACs met. |

## Code Review Record

### Review Pass #1

| Field | Value |
|-------|-------|
| Date | 2026-04-20 |
| Reviewer Model | Claude Opus 4.6 (1M context) |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 1 |
| Outcome | Success — all issues fixed |

**Medium issues (fixed):**
1. CLI tests refactored to use temp dirs via `--config-dir` flag (test isolation)
2. Port range validation added to validator (runtime safety)
3. Init command made testable (dependency injection for filesystem ops)

**Low issues (fixed):**
1. Non-null assertions replaced in tests (type safety)

**Post-fix verification:** 56 tests passing.

### Review Pass #2

| Field | Value |
|-------|-------|
| Date | 2026-04-20 |
| Reviewer Model | Claude Opus 4.6 (1M context) |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 1 |
| Outcome | Success — all issues fixed |

**Medium issues (fixed):**
1. Empty/array YAML files caused crashes in `loadConfig` due to unsafe null cast — added guards for null/non-object parse results.

**Low issues (fixed):**
1. Prettier formatting fixes applied.

**Post-fix verification:** 58 tests passing.

### Review Pass #3 (Security-Focused)

| Field | Value |
|-------|-------|
| Date | 2026-04-20 |
| Reviewer Model | Claude Opus 4.6 (1M context) |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 1 |
| Outcome | Success — all issues fixed |

**Medium issues (fixed):**
1. **Prototype pollution in `deepMerge`** (CWE-1321): `deepMerge` in `loader.ts` did not filter dangerous keys (`__proto__`, `constructor`, `prototype`). A crafted YAML config could pollute `Object.prototype`. Fixed by adding a `DANGEROUS_KEYS` set guard before key assignment.
2. **Log injection via unsanitized user input** (CWE-117): `Unknown command: ${command}` in `cli.ts` echoed raw user input which could contain ANSI escape sequences or control characters. Fixed by stripping control chars before logging.
3. **No path resolution on `--config-dir`** (CWE-22 hardening): The `--config-dir` flag value was used as-is in `mkdirSync`. Fixed by resolving to absolute path via `path.resolve()`.

**Low issues (fixed):**
1. **ESLint `no-control-regex` violation**: The sanitization regex triggered the rule; added targeted inline disable comment with justification.

**Security scan (Semgrep):** Ran custom rules for path traversal, prototype pollution, and information disclosure. 1 true positive (prototype pollution — fixed), 2 informational (path in error messages — acceptable for CLI diagnostics).

**Post-fix verification:** 59 tests passing, lint clean, build clean.
