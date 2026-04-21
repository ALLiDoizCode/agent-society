# Story 21.5: Town Node Dockerfile

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a production-grade Town container,
so that I can run a Nostr relay with ILP write-fees inside the Townhouse orchestration stack.

## Dependencies

- **Story 21.4** (done): HD wallet management — `WalletManager`, per-node key injection via `NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY` env vars
- **Story 21.3** (done): Standalone connector integration — `ConnectorConfigGenerator`, connector restart-based peer registration, Docker network `townhouse-net`
- **Story 21.2** (done): Docker orchestrator — `DockerOrchestrator`, `startNode()`, `buildNodeEnv()` producing `CONNECTOR_URL` + `FEE_PER_EVENT` env vars
- **Story 21.1** (done): Package scaffold, CLI, config schema (`TownNodeConfig` with `enabled`, `feePerEvent`, `image` fields)

**Runtime dependency (in-container):**
- `@toon-protocol/town` — the `toon-town` CLI binary (already exists with `--connector-url`, `--secret-key`, `--relay-port`, `--bls-port`, `--dev-mode` flags and matching `TOON_*` env var support)

## Acceptance Criteria

1. `docker/Dockerfile.town` builds successfully from repo root: `docker build -f docker/Dockerfile.town -t toon:town .`
2. Container accepts connector URL via `CONNECTOR_URL` environment variable (mapped to `TOON_CONNECTOR_URL` internally)
3. Registers as peer with standalone connector on startup (uses `--connector-url` mode of `toon-town` CLI)
4. Health endpoint at `/health` returning relay status (BLS HTTP port, same as existing Town health endpoint)
5. Exposes relay WebSocket port for client connections (port 7100 default)
6. Write-fee configuration via `FEE_PER_EVENT` environment variable
7. Image builds and starts successfully in townhouse compose stack (alongside connector on `townhouse-net`)

## Tasks / Subtasks

- [x] Task 1: Create `docker/Dockerfile.town` (AC: #1, #2, #4, #5, #6)
  - [x] 1.1 Multi-stage build: `node:20-alpine` builder + minimal runtime (mirror `Dockerfile.sdk-e2e` pattern)
  - [x] 1.2 Builder stage: install pnpm 8.15.0, copy workspace manifests, `pnpm install --frozen-lockfile`, copy source, build only `@toon-protocol/town` and its workspace deps (`core`, `relay`, `sdk`, `bls`)
  - [x] 1.3 Bundle entrypoint via esbuild: `docker/src/entrypoint-town.ts` as single ESM bundle with `better-sqlite3` external (native module). The entrypoint maps Townhouse env vars to Town CLI env vars then dynamically imports the Town CLI.
  - [x] 1.4 Runtime stage: `node:20-alpine`, `apk add libstdc++`, copy bundle + `better-sqlite3` native module + `package.json` with `"type":"module"`
  - [x] 1.5 Set `EXPOSE 3000 3100 7100` (BTP + BLS HTTP + Relay WS), `HEALTHCHECK` targeting `/health` on BLS port, `USER toon` for non-root execution
  - [x] 1.6 `CMD ["node", "/app/entrypoint-town.js"]` pointing to the esbuild bundle

- [x] Task 2: Create entrypoint adapter script (AC: #2, #3, #6)
  - [x] 2.1 Create `docker/src/entrypoint-town.ts` — a thin Node.js script that maps Townhouse-injected env vars to Town CLI env vars, then dynamically imports the Town CLI main. NOT a shell script — TypeScript compiled via esbuild alongside the bundle.
  - [x] 2.2 Map: `CONNECTOR_URL` -> `TOON_CONNECTOR_URL`, `NODE_NOSTR_SECRET_KEY` -> `TOON_SECRET_KEY`, `FEE_PER_EVENT` -> `TOON_FEE_PER_EVENT`, `BLS_PORT` -> `TOON_BLS_PORT` (default 3100), `WS_PORT` -> `TOON_RELAY_PORT` (default 7100)
  - [x] 2.3 Set `TOON_DEV_MODE=true` when `DEV_MODE` env is "true" (for Townhouse dev scenarios)
  - [x] 2.4 Set `TOON_DATA_DIR=/data` for persistent volume mount
  - [x] 2.5 Handle graceful shutdown (SIGTERM -> forward to child process)

- [x] Task 3: Update `docker-compose-townhouse.yml` town service (AC: #7)
  - [x] 3.1 The `town` service already exists with profile, image, network, depends_on, and basic env vars (`CONNECTOR_URL`, `FEE_PER_EVENT`). Add missing production concerns below.
  - [x] 3.2 Add healthcheck matching Dockerfile HEALTHCHECK: `wget -q --spider http://localhost:3100/health`
  - [x] 3.3 Add named volume mount for persistent relay storage: `townhouse-town-data:/data`
  - [x] 3.4 Add identity env vars (injected by orchestrator at runtime): `NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY` (placeholder comments in compose, actual values from orchestrator)
  - [x] 3.5 Add host port mapping for relay WS: `'127.0.0.1:7100:7100'` and BLS: `'127.0.0.1:3100:3100'`

- [x] Task 4: Add `TOON_FEE_PER_EVENT` env var to Town CLI (AC: #6)
  - [x] 4.1 In `packages/town/src/cli.ts` `parseCli()`: add `TOON_FEE_PER_EVENT` env var parsing. Read `process.env['TOON_FEE_PER_EVENT']`, parse as integer, pass as `feePerEvent` in TownConfig.
  - [x] 4.2 In `packages/town/src/town.ts` `startTown()`: ensure `feePerEvent` from TownConfig is passed to `createPricingValidator()`. If `TownConfig` lacks this field, add it (optional number).
  - [x] 4.3 Verify existing town tests still pass: `pnpm --filter @toon-protocol/town test`

- [x] Task 5: Integration test (AC: #1, #4, #7)
  - [x] 5.1 Create `packages/townhouse/src/docker/town-dockerfile.test.ts` — static analysis test asserting Dockerfile structure: multi-stage build, CMD contains `entrypoint-town.js`, `EXPOSE 3000 3100 7100`, HEALTHCHECK present, USER non-root
  - [x] 5.2 Test that `buildNodeEnv('town')` output maps correctly to what the entrypoint script expects (CONNECTOR_URL, FEE_PER_EVENT, NODE_NOSTR_SECRET_KEY all present)
  - [x] 5.3 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

## Dev Notes

### Architecture Context

This story creates the first of three node Dockerfiles (Town, Mill, DVM). The pattern established here will be reused for Stories 21.6 and 21.7. Design decisions:

**D21-001:** Every node type runs as a Docker container. Production-grade Dockerfiles with process isolation.

**Key insight:** The Town package already has a CLI (`toon-town`) that accepts `TOON_CONNECTOR_URL` for standalone connector mode. The Dockerfile just needs to:
1. Build `@toon-protocol/town` into a minimal bundle via esbuild (entry: `docker/src/entrypoint-town.ts`)
2. The entrypoint adapter maps Townhouse env vars -> Town env vars, then dynamically imports Town CLI
3. Expose BTP + health + relay ports (3000, 3100, 7100)

### Existing Dockerfile Patterns (MUST FOLLOW)

The `docker/Dockerfile.sdk-e2e` establishes the project's Docker conventions:

1. **Multi-stage build:** `node:20-alpine` builder + minimal `node:20-alpine` runtime
2. **pnpm pinned:** `corepack enable && corepack prepare pnpm@8.15.0 --activate`
3. **esbuild bundling:** Single ESM bundle with native modules as externals
4. **ESM package.json:** `{"type":"module"}` in runtime
5. **Native module cherry-pick:** Copy `better-sqlite3` build artifacts + `bindings` + `file-uri-to-path`
6. **Non-root user:** `addgroup/adduser toon` with UID 1001
7. **HEALTHCHECK:** `wget -q --spider http://localhost:${PORT}/health || exit 1`
8. **Volume for persistent data:** `VOLUME /data`

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** Not applicable (no 64-bit integer bridging).
- **Golden test vectors (ZK story pairs):** Not applicable (no ZK circuits).

### Critical Implementation Details

**Entrypoint adapter approach (NOT a shell script):**

Use a TypeScript entrypoint (compiled via esbuild alongside the bundle) that:
```typescript
// docker/src/entrypoint-town.ts
// Maps Townhouse orchestrator env vars to Town CLI env vars, then imports and runs
process.env['TOON_CONNECTOR_URL'] = process.env['CONNECTOR_URL'];
process.env['TOON_SECRET_KEY'] = process.env['NODE_NOSTR_SECRET_KEY'];
process.env['TOON_BLS_PORT'] = process.env['BLS_PORT'] ?? '3100';
process.env['TOON_RELAY_PORT'] = process.env['WS_PORT'] ?? '7100';
process.env['TOON_DATA_DIR'] = '/data';
if (process.env['FEE_PER_EVENT']) {
  // Town's fee is set via its pricing validator, passed via env
  process.env['TOON_FEE_PER_EVENT'] = process.env['FEE_PER_EVENT'];
}
if (process.env['DEV_MODE'] === 'true') {
  process.env['TOON_DEV_MODE'] = 'true';
}
// Import and run the Town CLI main function
await import('./town-bundle.js');
```

**Alternative (simpler, preferred):** Bundle `packages/town/src/cli.ts` directly via esbuild from the monorepo root context (like `Dockerfile.sdk-e2e` does with `docker/src/entrypoint-sdk.ts`). The entrypoint-town.ts sets env vars then dynamically imports the Town CLI. This avoids a separate "town-bundle.js" — esbuild bundles everything into one file.

**esbuild invocation (in Dockerfile builder stage):**
```dockerfile
RUN cd docker && \
    pnpm exec esbuild src/entrypoint-town.ts \
      --bundle \
      --platform=node \
      --target=node20 \
      --format=esm \
      --minify \
      --outfile=dist/entrypoint-town.js \
      --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
      --external:better-sqlite3
```

**Key externals:** Only `better-sqlite3` needs to be external (native .node addon). Unlike `Dockerfile.sdk-e2e`, we do NOT need ethers, express, @ardrive/turbo-sdk, socks-proxy-agent, o1js, or @solana packages because Town doesn't use those at runtime.

**Town CLI env var mapping (from `packages/town/src/cli.ts`):**
| Townhouse Orchestrator Env | Town CLI Env | Purpose |
|---|---|---|
| `CONNECTOR_URL` | `TOON_CONNECTOR_URL` | Standalone connector WebSocket URL |
| `NODE_NOSTR_SECRET_KEY` | `TOON_SECRET_KEY` | 32-byte hex secret key for event signing |
| `FEE_PER_EVENT` | (custom — see below) | Write fee in millisatoshis |
| `BLS_PORT` (default 3100) | `TOON_BLS_PORT` | BLS HTTP API port |
| `WS_PORT` (default 7100) | `TOON_RELAY_PORT` | Nostr relay WebSocket port |
| `DEV_MODE` | `TOON_DEV_MODE` | Skip signature verification |
| `NODE_NOSTR_PUBKEY` | (informational only) | Not consumed by Town CLI directly |
| `NODE_EVM_ADDRESS` | (informational only) | Not consumed by Town CLI directly |

**Note on FEE_PER_EVENT:** The Town CLI does not currently have a `TOON_FEE_PER_EVENT` env var. The fee is set programmatically via `createPricingValidator()` in `startTown()`. Decision: **(A) Add env var support to Town CLI** — add `TOON_FEE_PER_EVENT` to the `parseCli()` function in `packages/town/src/cli.ts`. This is Task 4 and must be completed before Docker integration testing.

**BTP port 3000:** The Town node runs an embedded ConnectorNode that listens on BTP port 3000 for peer connections from the standalone connector. The compose file already uses `expose: ['3000']` for Docker-internal access. The Dockerfile must also `EXPOSE 3000` to document this.

### Dependency Budget

No new production dependencies for any package. The Dockerfile uses existing build tooling (esbuild from `docker/` workspace, pnpm).

**Modification to `packages/town/src/cli.ts`:** Add `TOON_FEE_PER_EVENT` env var parsing (maps to `feePerEvent` in TownConfig). This is a minor, backward-compatible change.

### File Structure Requirements

```
docker/
├── Dockerfile.town          # NEW: Multi-stage Town node container
├── src/
│   ├── entrypoint-town.ts   # NEW: Env var adapter + dynamic import of Town CLI
│   └── ...existing files
docker-compose-townhouse.yml # MODIFIED: Add healthcheck, volumes, ports, identity env vars to town service
packages/town/src/
├── cli.ts                   # MODIFIED: Add TOON_FEE_PER_EVENT env var support
├── town.ts                  # MODIFIED: Accept feePerEvent in TownConfig (if not already)
packages/townhouse/src/docker/
├── town-dockerfile.test.ts  # NEW: Static analysis / integration test
```

### Testing Strategy

| Test ID | Scenario | Task(s) | AC | Test Design Ref |
|---------|----------|---------|-----|-----------------|
| T-032 | `docker/Dockerfile.town` builds successfully from repo root | 5.1 | #1 | TD T-032 |
| T-035 | Town container responds to `/health` endpoint | 5.2 | #4 | TD T-035 |
| T-038 | Container accepts connector URL via `CONNECTOR_URL` env var | 5.2 | #2 | TD T-038 |
| T-039 | Write-fee configurable via `FEE_PER_EVENT` env var | 4.1, 5.2 | #6 | TD T-039 |
| T-041 | Static analysis: Dockerfile CMD points to correct entrypoint | 5.1 | #1 | TD T-041 |
| T-042 | Multi-stage build with minimal final image | 5.1 | #1 | TD T-042 |

**Unit tests (static analysis — no Docker required for CI):**
- Parse `docker/Dockerfile.town` content and assert: `FROM node:20-alpine AS builder`, second `FROM node:20-alpine`, `USER toon`, `HEALTHCHECK`, `EXPOSE 3000 3100 7100`, `CMD` contains `entrypoint-town.js`
- Verify `buildNodeEnv('town')` produces env vars matching what entrypoint-town.ts expects

**Manual integration test (Docker required — not in CI):**
- `docker build -f docker/Dockerfile.town -t toon:town .`
- `docker run --rm -e CONNECTOR_URL=ws://host.docker.internal:3000 -e NODE_NOSTR_SECRET_KEY=<64-hex> -e DEV_MODE=true toon:town` -- verify `/health` responds on port 3100

### Previous Story Intelligence (21.4)

Key patterns from Story 21.4 to continue:
- Co-located test files next to source
- TypeScript interfaces in dedicated `types.ts`
- Re-exports via `index.ts`
- Follow `docker/Dockerfile.sdk-e2e` almost exactly for structure — just swap the entrypoint and externals
- `CONTAINER_PREFIX = 'townhouse-'` — container name will be `townhouse-town`
- `buildNodeEnv('town')` already produces: `CONNECTOR_URL=ws://townhouse-connector:3000`, `FEE_PER_EVENT=<value>`, `NODE_NOSTR_PUBKEY=<hex>`, `NODE_EVM_ADDRESS=<hex>`, `NODE_NOSTR_SECRET_KEY=<hex>`

### Git Intelligence

Recent commits show all 4 prior Townhouse stories completed sequentially. Patterns:
- Each story is self-contained within `packages/townhouse/`
- This story uniquely spans two packages: `docker/` (Dockerfile + entrypoint) AND `packages/town/` (minor env var addition)
- Build system: tsup for packages, esbuild for Docker bundles

### Security Notes

- **Non-root execution:** Container runs as `toon:toon` (UID 1001) — no root after build stage.
- **Secret key via env var:** `NODE_NOSTR_SECRET_KEY` is injected by orchestrator at container creation time. Visible via `docker inspect` but requires Docker socket access (operator-level). Acceptable per Story 21.4 security analysis.
- **No mnemonic in container:** Only the derived secret key is passed, never the mnemonic.
- **Data volume permissions:** `/data` owned by `toon:toon` for SQLite relay database.

### Project Structure Notes

- `docker/Dockerfile.town` follows existing convention: all Dockerfiles live in `docker/`
- `docker/src/entrypoint-town.ts` follows existing pattern: entrypoints live in `docker/src/`
- The `docker/package.json` and `docker/esbuild.config.mjs` may need updating to include the new entrypoint
- Static analysis test lives in `packages/townhouse/` because it validates orchestrator integration

### References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.5] — Story requirements and acceptance criteria
- [Source: _bmad-output/epics/epic-21-townhouse.md#Key Design Decisions] — D21-001 (every node as Docker container), D21-002 (standalone connector)
- [Source: docker/Dockerfile.sdk-e2e] — Reference Dockerfile pattern (multi-stage, esbuild, native modules, non-root)
- [Source: packages/town/src/cli.ts] — Town CLI entrypoint with env var parsing (TOON_CONNECTOR_URL, TOON_SECRET_KEY, etc.)
- [Source: packages/town/src/town.ts] — startTown() API, TownConfig interface, standalone connector mode
- [Source: packages/townhouse/src/docker/orchestrator.ts] — buildNodeEnv('town') producing CONNECTOR_URL + FEE_PER_EVENT + wallet keys
- [Source: packages/townhouse/src/constants.ts] — CONTAINER_PREFIX, NODE_BTP_PORT
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#3.5] — Test scenarios T-032 through T-042
- [Source: _bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md] — Previous story patterns, wallet key injection

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Task 1: Created `docker/Dockerfile.town` — multi-stage build mirroring `Dockerfile.sdk-e2e` pattern. Builder stage installs pnpm 8.15.0, builds Town dependency chain (core, relay, sdk, bls, town), bundles via esbuild with only `better-sqlite3` as external. Runtime stage is minimal alpine with non-root user, HEALTHCHECK, EXPOSE 3000/3100/7100, VOLUME /data.
- Task 2: Created `docker/src/entrypoint-town.ts` — TypeScript adapter mapping Townhouse orchestrator env vars (CONNECTOR_URL, NODE_NOSTR_SECRET_KEY, FEE_PER_EVENT, BLS_PORT, WS_PORT, DEV_MODE) to Town CLI env vars (TOON_*). Handles SIGTERM graceful shutdown. Dynamically imports Town CLI which auto-invokes on import.
- Task 3: Updated `docker-compose-townhouse.yml` town service — added healthcheck (wget /health on port 3100), named volume `townhouse-town-data:/data`, identity env var placeholders (NODE_NOSTR_PUBKEY, NODE_EVM_ADDRESS, NODE_NOSTR_SECRET_KEY), host port mappings (127.0.0.1:7100:7100, 127.0.0.1:3100:3100).
- Task 4: Added `TOON_FEE_PER_EVENT` env var support to Town CLI — new `feePerEvent?: number` field in TownConfig interface, parsed as integer in `parseCli()` with validation, used in `startTown()` to override `basePricePerByte`. Also added `./cli` export path to `packages/town/package.json` for Docker entrypoint import.
- Task 5: Enabled all 26 static analysis tests in `town-dockerfile.test.ts` and 6 tests in `fee-per-event-env.test.ts`. Fixed test regex pattern to use `{2}` quantifier instead of literal spaces (lint compliance). All tests pass.

### File List

- docker/Dockerfile.town (created)
- docker/src/entrypoint-town.ts (created)
- docker-compose-townhouse.yml (modified)
- packages/town/package.json (modified)
- packages/town/src/cli.ts (modified)
- packages/town/src/town.ts (modified)
- packages/town/src/fee-per-event-env.test.ts (modified)
- packages/townhouse/src/docker/town-dockerfile.test.ts (modified)

### Change Log

- 2026-04-20: Story 21.5 implementation complete — Town Node Dockerfile, entrypoint adapter, compose updates, TOON_FEE_PER_EVENT env var support, all tests enabled and passing (237 town tests, 272 townhouse tests, 0 lint errors).
- 2026-04-20: Code review fixes — (1) HIGH: Removed entrypoint SIGTERM handler that preempted CLI graceful shutdown (process.exit(0) fired before instance.stop()). (2) MEDIUM: Added --external:ethers --external:express to Dockerfile esbuild (connector uses requireOptional for these; mirrors sdk-e2e pattern). (3) LOW: Updated comment to explain why no SIGTERM handler is needed.

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Issues Found:** 3 total (0 critical, 1 high, 1 medium, 1 low)
- **Outcome:** All fixed

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| 1 | High | Broken SIGTERM handler in entrypoint preempted CLI graceful shutdown — `process.exit(0)` fired before `instance.stop()` could complete | Removed SIGTERM handler entirely; Town CLI handles its own shutdown |
| 2 | Medium | Missing esbuild externals (`ethers`, `express`) — connector uses `requireOptional` for these; mirrors sdk-e2e pattern | Added `--external:ethers --external:express` to Dockerfile esbuild command |
| 3 | Low | Misleading SIGTERM comment implied handler was needed | Updated comment to explain why no SIGTERM handler is needed (CLI handles it) |

### Review Pass #2

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Issues Found:** 0 total (0 critical, 0 high, 0 medium, 0 low)
- **Outcome:** Clean — no issues found. Implementation is correct after pass #1 fixes.

### Review Pass #3

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Issues Found:** 0 total (0 critical, 0 high, 0 medium, 0 low)
- **Outcome:** Clean pass — security review confirmed. No issues found.
