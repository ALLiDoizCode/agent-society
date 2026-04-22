# Story 21.7: DVM Node Dockerfile

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a production-grade DVM container,
so that I can run compute-for-hire services inside the Townhouse orchestration stack.

## Dependencies

- **Story 21.3** (done): Standalone connector integration — `ConnectorConfigGenerator`, connector peers DVM at `btp+http://townhouse-dvm:3300`, Docker network `townhouse-net`
- **Story 21.5** (done): Town Node Dockerfile — established Dockerfile pattern (`docker/Dockerfile.town`), esbuild entrypoint adapter (`docker/src/entrypoint-town.ts`), static-analysis test harness, compose stack wiring
- **Story 21.6** (done): Mill Node Dockerfile — second Dockerfile, programmatic `startMill()` API, JSON config + env overlay pattern
- **Story 21.4** (done): HD wallet management — `WalletManager`, per-node key injection via `NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY` env vars (DVM uses `ACCOUNT_INDEX_DVM = 2`)
- **Story 21.2** (done): Docker orchestrator — `DockerOrchestrator`, `buildNodeEnv('dvm')` producing `CONNECTOR_URL` + `FEE_PER_JOB` + wallet identity env vars
- **Story 21.1** (done): Package scaffold, CLI, config schema (`DvmNodeConfig` with `enabled`, `feePerJob`, `image`, `handlers` fields)

**Runtime dependencies (in-container):**
- `@toon-protocol/sdk` — `createNode()`, `ArweaveDvmConfig`, `createArweaveDvmHandler` (Arweave blob storage DVM, kind:5094)
- `@toon-protocol/pet-dvm` — `createDungeonDvmHandler` (Dungeon run DVM, kind:5250) + engine + memvid
- `@toon-protocol/memvid-node` — PetBrain (pet memory state store)
- `@toon-protocol/pet-circuit` — o1js ZK circuits (for pet proofs)
- `rot-js` — Seedable RNG for dungeon generation

## Acceptance Criteria

1. `docker/Dockerfile.dvm` builds successfully from repo root: `docker build -f docker/Dockerfile.dvm -t toon:dvm .` (Test T-034)
2. Container accepts connector peering via standalone connector's outbound HTTP ILP dial to `http://townhouse-dvm:3300` (standalone mode HTTP handler; Test T-038)
3. Health endpoint at `/health` returning DVM worker status JSON on BLS port (Test T-037)
4. DVM handlers (`ArweaveDvmHandler` + `createDungeonDvmHandler`) registered and responding to their respective event kinds (Test T-040)
5. Fee per job configurable via `FEE_PER_JOB` environment variable (propagated to pricing validator; Test T-039)
6. Multi-stage build with minimal final image, non-root execution (`USER toon`), HEALTHCHECK, EXPOSE 3300 (HTTP handler) + 3400 (BLS) (Test T-042)
7. Image builds and starts successfully in townhouse compose stack (alongside connector on `townhouse-net`, profile `dvm`)

## Tasks / Subtasks

- [x] Task 1: Create `docker/Dockerfile.dvm` (AC: #1, #2, #3, #6)
  - [x] 1.1 Multi-stage build: `node:20-alpine` builder + minimal runtime (mirror `docker/Dockerfile.mill` exactly — only entrypoint name, package filters, externals, ports, and COPY list change)
  - [x] 1.2 Builder stage: install pnpm 8.15.0, copy workspace manifests for DVM's dependency chain (`core`, `sdk`, `arweave`/`turbo`, `bls`, `pet-dvm`, `memvid-node`, `pet-circuit`, plus `rot-js` peer dep)
  - [x] 1.3 Build packages: `pnpm -r --filter '@toon-protocol/core' --filter '@toon-protocol/sdk' --filter '@toon-protocol/bls' --filter '@toon-protocol/pet-dvm' --filter '@toon-protocol/memvid-node' --filter '@toon-protocol/pet-circuit' build`
  - [x] 1.4 Bundle entrypoint via esbuild: `docker/src/entrypoint-dvm.ts` as single ESM bundle. Externals MUST include: `better-sqlite3`, `ethers`, `express` (connector `requireOptional` pattern — mirrors Town/Mill), plus `mina-signer`, `o1js`, `@solana/kit`, `@solana-program/token`, `@toon-protocol/mina-zkapp` (optional chain signers). Keep `@scure/bip32`, `@scure/bip39`, `@noble/curves`, `@noble/hashes`, `ed25519-hd-key`, `nostr-tools`, `hono`, `@hono/node-server`, `@toon-protocol/connector` BUNDLED. ALSO bundle `@ardrive/turbo-sdk` (Arweave DVM dependency) since pet-dvm bundles it.
  - [x] 1.5 Runtime stage: `node:20-alpine`, `apk add libstdc++`, copy bundle + `better-sqlite3` native module + `package.json` with `"type":"module"`. Do NOT copy Mina/Solana node_modules — they are peer-optional and will throw at runtime if used. The `better-sqlite3` is for the pet-dvm's SQLite-backed pet state store (Memvid).
  - [x] 1.6 Set `EXPOSE 3300 3400` (HTTP ILP handler + BLS HTTP health), `HEALTHCHECK` targeting `/health` on BLS port, `USER toon` (UID 1001) for non-root execution, `VOLUME /data`
  - [x] 1.7 Default env vars: `ENV BLS_PORT=3400`, `ENV NODE_ENV=production`, `ENV HANDLER_PORT=3300`
  - [x] 1.8 `CMD ["node", "/app/entrypoint-dvm.js"]` pointing to the esbuild bundle

- [x] Task 2: Create `docker/src/entrypoint-dvm.ts` (AC: #2, #4, #5)
  - [x] 2.1 Create TypeScript entrypoint that imports `createNode()` from `@toon-protocol/sdk` (standalone mode, NOT embedded connector — standalone connector dials this container via HTTP)
  - [x] 2.2 Configure standalone mode: `connectorUrl` from `CONNECTOR_URL` env var, `handlerPort` from `HANDLER_PORT` env var (default 3300). The standalone connector sends ILP packets to this HTTP server.
  - [x] 2.3 Env var mapping: `NODE_NOSTR_SECRET_KEY` (64-hex) → `config.secretKey`, `BLS_PORT` (default 3400) → `config.blsPort`, `FEE_PER_JOB` → set as `basePricePerByte` or via `kindPricing[5250]` for pet-dvm kind. Note: DVM pricing is per-job, not per-byte. See Dev Notes § DVM Pricing Model.
  - [x] 2.4 Register DVM handlers (in priority order):
    - Arweave DVM: `createArweaveDvmHandler({ turboAdapter, chunkManager })` → register on kind:5094 (Arweave blob storage)
    - Dungeon DVM: `createDungeonDvmHandler()` → register on kind:5250 (Dungeon run compute)
  - [x] 2.5 Initialize `ArweaveUploadAdapter` and `ChunkManager` for the Arweave DVM. The adapter uses `TURBO_TOKEN` env var (Arweave upload token from operator). The chunk manager uses in-memory state (v1 — no persistence).
  - [x] 2.6 Call `node.start()`, log DVM ready banner with pubkey, registered handler kinds, `handlerPort`; register SIGTERM/SIGINT handlers that call `node.stop()` then `process.exit(0)` (mirror Mill entrypoint)
  - [x] 2.7 Catch fatal startup errors, log with `[Fatal]` prefix, `process.exit(1)`

- [x] Task 3: Update `docker-compose-townhouse.yml` dvm service (AC: #7)
  - [x] 3.1 The `dvm` service already exists with profile, image, network, depends_on, and basic env vars. Add missing production concerns below (mirror `town` and `mill` service structure from Stories 21.5/21.6)
  - [x] 3.2 Add healthcheck matching Dockerfile HEALTHCHECK: `wget -q --spider http://localhost:3400/health`, interval 30s, timeout 10s, retries 3, start_period 5s
  - [x] 3.3 Add named volume mount for persistent pet state storage: `townhouse-dvm-data:/data` (declare `townhouse-dvm-data:` in top-level `volumes:` section)
  - [x] 3.4 Add identity env var placeholders: `NODE_NOSTR_PUBKEY: ''`, `NODE_EVM_ADDRESS: ''`, `NODE_NOSTR_SECRET_KEY: ''`
  - [x] 3.5 Add host port mapping for BLS health: `'127.0.0.1:3400:3400'`
  - [x] 3.6 Add `TURBO_TOKEN` env var (placeholder) for Arweave upload in DVM node. Operator supplies their Arweave upload token at deploy time.
  - [x] 3.7 Add `restart: unless-stopped`

- [x] Task 4: Verify DVM package exports for entrypoint (AC: #4)
  - [x] 4.1 Confirm `createArweaveDvmHandler`, `ArweaveDvmConfig`, `ArweaveUploadAdapter`, `ChunkManager` are exported from `@toon-protocol/sdk`
  - [x] 4.2 Confirm `createDungeonDvmHandler`, `DungeonDvmConfig` are exported from `@toon-protocol/pet-dvm`
  - [x] 4.3 Check `@toon-protocol/pet-dvm` dependencies are all resolvable in Docker build: `rot-js` is a peer dep (npm: `rot-js@^2.2.1`) — verify it resolves during pnpm install. If not resolvable from npm, add to workspace `package.json`.

- [x] Task 5: Static-analysis integration test (AC: #1, #3, #6, #7)
  - [x] 5.1 Create `packages/townhouse/src/docker/dvm-dockerfile.test.ts` mirroring `town-dockerfile.test.ts` and `mill-dockerfile.test.ts` structure
  - [x] 5.2 Dockerfile assertions: multi-stage (`FROM node:20-alpine AS builder` + second `FROM node:20-alpine`), `USER toon`, `HEALTHCHECK` present targeting `/health`, `EXPOSE 3300 3400`, `CMD` contains `entrypoint-dvm.js`, pnpm pinned to 8.15.0, `VOLUME /data`, non-root UID 1001 (`adduser -D -u 1001`)
  - [x] 5.3 Entrypoint assertions: uses `createNode()` in standalone mode, maps `NODE_NOSTR_SECRET_KEY` → `config.secretKey`, maps `HANDLER_PORT` (default 3300), maps `FEE_PER_JOB`, registers kind:5094 + kind:5250 handlers, initializes ArweaveUploadAdapter with `TURBO_TOKEN`, registers SIGTERM handler
  - [x] 5.4 Compose assertions: `dvm` service has image `toon:dvm`, profile `dvm`, depends on `connector: service_healthy`, healthcheck on port 3400, volume `townhouse-dvm-data:/data`, identity env vars present, host port `127.0.0.1:3400:3400` mapped, `townhouse-dvm-data` declared in top-level `volumes:`
  - [x] 5.5 `buildNodeEnv('dvm')` integration test: assert orchestrator produces `CONNECTOR_URL=ws://townhouse-connector:3000` + `FEE_PER_JOB=<value>` + `NODE_NOSTR_SECRET_KEY=<hex>` (verify cross-link with existing orchestrator tests)
  - [x] 5.6 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

### Review Findings

- [x] [Review][Decision] FEE_PER_JOB pricing mechanism ambiguous — Resolved: map to both basePricePerByte AND kindPricing[5250] for dual pricing

- [x] [Review][Patch] Invalid BigInt literal in dungeon pricePerRun default [docker/src/entrypoint-dvm.ts:268] — Fixed: changed '10000n' to 10000

- [x] [Review][Patch] CONNECTOR_URL protocol conversion breaks wss:// [docker/src/entrypoint-dvm.ts:203-205] — Fixed: use .replace(/^ws(s)?:/, (m, s) => s ? 'https:' : 'http:')

- [x] [Review][Patch] No validation that handler and BLS ports differ [docker/src/entrypoint-dvm.ts:175-185] — Fixed: added port conflict validation

- [x] [Review][Patch] Turbo adapter created even when token missing [docker/src/entrypoint-dvm.ts:239-241] — Fixed: only create adapter when turboToken is truthy

- [x] [Review][Patch] CONNECTOR_URL query parameters lost in transformation [docker/src/entrypoint-dvm.ts:203-205] — Fixed: preserve query params in URL transform

- [x] [Review][Patch] Native module copy path is fragile [docker/Dockerfile.dvm:89-95] — Fixed: added explicit error messages on copy failure

- [x] [Review][Patch] SIGTERM handler race condition [docker/src/entrypoint-dvm.ts:319-330] — Fixed: added process.off() before on() to prevent duplicates

- [x] [Review][Patch] kindPricing key type mismatch risk [docker/src/entrypoint-dvm.ts:115-117] — Fixed: added filter to skip non-numeric keys

- [x] [Review][Defer] Health check doesn't verify JSON response [docker-compose-townhouse.yml:161-165] — deferred, static test cannot validate runtime health behavior

- [x] [Review][Defer] Process.env secret deletion ineffective [docker/src/entrypoint-dvm.ts:310-312] — deferred, requires Docker-level handling out of scope

- [x] [Review][Defer] rot-js dependency not explicitly bundled [docker/Dockerfile.dvm:67-78] — deferred, transitive dependency should work

### Architecture Context

This story creates the third and final node Dockerfile (Town ✓, Mill ✓, DVM ← **this story**). The pattern was established in Stories 21.5–21.6 — mirror it almost exactly, changing only the package filters, externals, ports, and entrypoint logic.

**D21-001:** Every node type runs as a Docker container. Production-grade Dockerfiles with process isolation.

### DVM Deployment Mode: Standalone (HTTP Handler)

Unlike Town (embedded connector on BTP port 3000) and Mill (embedded connector on BTP port 3000), the DVM container uses **standalone mode** where the standalone connector dials the container via HTTP:

```
Townhouse standalone connector (HTTP client)
  └── HTTP ILP POST to http://townhouse-dvm:3300/ilp
```

The DVM's `createNode()` is configured with `connectorUrl` (external connector URL) + `handlerPort: 3300` (HTTP server port inside container). This is the **opposite** of Town/Mill's BTP server pattern:

| Node | Mode | Port | How connector reaches node |
|------|------|------|------------------------|
| Town | Embedded BTP server | 3000 | `btp+ws://townhouse-town:3000` |
| Mill | Embedded BTP server | 3000 | `btp+ws://townhouse-mill:3000` |
| **DVM** | **Standalone HTTP** | **3300** | **`http://townhouse-dvm:3300`** |

**Rationale:** The DVM's primary job is compute processing (Dungeon runs, Arweave uploads), not ILP routing. Standalone HTTP mode is simpler for DVM workloads and aligns with the existing `createNode()` API's `connectorUrl` + `handlerPort` pattern.

### DVM Pricing Model

DVM services charge per **job**, not per byte. Two pricing paths:

**Arweave DVM (kind:5094):** Price per byte (like Town relay). Set via `basePricePerByte` on the DVM node config. The Arweave DVM handler receives pre-priced packets from the pricing validator.

**Dungeon DVM (kind:5250):** Per-job pricing. The `FEE_PER_JOB` env var maps to `kindPricing[5250]` or a custom pricing override. The `createDungeonDvmHandler` processes kind:5250 events where the ILP amount covers the job cost.

**Entrypoint implementation:**
```typescript
const config = {
  secretKey: secretKeyFromEnv,
  connectorUrl: process.env['CONNECTOR_URL'], // standalone connector URL
  handlerPort: parseInt(process.env['HANDLER_PORT'] ?? '3300', 10),
  blsPort: parseInt(process.env['BLS_PORT'] ?? '3400', 10),
  // Pricing: apply FEE_PER_JOB as basePricePerByte (default 10n = same as SDK default)
  basePricePerByte: BigInt(process.env['FEE_PER_JOB'] ?? '10'),
};
```

### Externals Rationale

The DVM node bundles a wide range of dependencies because pet-dvm has deep transitive dependencies:

| Package | Used by | Keep as external? |
|---|---|---|
| `mina-signer`, `o1js`, `@toon-protocol/mina-zkapp` | Pet proofs (optional) | **Yes** — peerDependenciesMeta.optional; only loaded if proofs needed |
| `@solana/kit`, `@solana-program/token` | Solana DVM (post-v1) | **Yes** — optional; not in v1 scope |
| `ethers` | Connector's `requireOptional()` | **Yes** — same pattern as Town/Mill |
| `express` | Admin/Health servers | **Yes** — same pattern as Town/Mill |
| `better-sqlite3` | Memvid pet state store | **Yes** — native .node addon (required for pet-dvm) |
| `@ardrive/turbo-sdk` | Arweave upload (Arweave DVM) | **Keep bundled** — needed by ArweaveUploadAdapter |
| `rot-js` | Dungeon generation | **Keep bundled** — needed by pet-dvm |
| `o1js` | ZK proofs for pet breeding | **Keep bundled** — pet-circuit depends on it |

**Do NOT copy Mina/Solana node_modules into the runtime stage.** They are peer-optional and gracefully skipped at runtime. Do NOT copy the full `@ardrive/turbo-sdk` (too large) — instead, bundle it via esbuild externals exclusion. The turbo-sdk is large (~10MB) so bundling vs. externalizing is a trade-off:
- **External:** Save build time and image size if turbo not used. Risk: "module not found" if Arweave DVM is used without turbo.
- **Bundled:** Increases image size by ~10MB but guarantees turbo is available. Arweave DVM is v1 scope.
- **Decision: Keep bundled** — Arweave DVM is in v1 scope; operator needs turbo for blob uploads.

### Key Architectural Divergence from Town/Mill

| Concern | Town (21.5) | Mill (21.6) | DVM (this story) |
|---|---|---|---|
| Connector wiring | CLI env var (`TOON_CONNECTOR_URL`) | Embedded BTP server on 3000 | **Standalone HTTP on 3300 (`connectorUrl` + `handlerPort`)** |
| Config source | CLI env vars | JSON config + env overlay | **createNode() config object** |
| Entrypoint dispatch | Dynamic import CLI | Direct `startMill()` | **`createNode()` + `.on()` + `.start()`** |
| Health port | 3100 | 3200 | **3400** |
| Handler port | 7100 (relay WS) | 3000 (BTP) | **3300 (HTTP ILP)** |
| External deps | better-sqlite3, ethers, express | better-sqlite3, ethers, express, Mina, Solana | **better-sqlite3, ethers, express, Mina** |

### DVM Handler Wiring (Entrypoint Detail)

```typescript
import { createNode } from '@toon-protocol/sdk';
import { createArweaveDvmHandler } from '@toon-protocol/sdk';
import { createDungeonDvmHandler } from '@toon-protocol/pet-dvm';
import { TurboUploader } from '@ardrive/turbo-sdk';
import type { ArweaveUploadAdapter } from '@toon-protocol/sdk';
import type { ChunkManager } from '@toon-protocol/sdk';

// Build secret key from NODE_NOSTR_SECRET_KEY
const secretKeyHex = process.env['NODE_NOSTR_SECRET_KEY'];
if (!secretKeyHex) throw new Error('NODE_NOSTR_SECRET_KEY required');
const secretKey = Uint8Array.from(Buffer.from(secretKeyHex, 'hex'));

// Build Arweave DVM components
const turboToken = process.env['TURBO_TOKEN'];
const turboAdapter: ArweaveUploadAdapter = turboToken
  ? createTurboAdapter(turboToken)
  : createNullAdapter(); // or throw — turbo token required for Arweave DVM
const chunkManager = new ChunkManager(/* in-memory, v1 no persistence */);

// Create node in standalone mode
const node = await createNode({
  secretKey,
  connectorUrl: process.env['CONNECTOR_URL'], // standalone connector admin URL
  handlerPort: parseInt(process.env['HANDLER_PORT'] ?? '3300', 10),
  blsPort: parseInt(process.env['BLS_PORT'] ?? '3400', 10),
  basePricePerByte: BigInt(process.env['FEE_PER_JOB'] ?? '10'),
});

// Register handlers
node.on(5094, await createArweaveDvmHandler({ turboAdapter, chunkManager }));
node.on(5250, createDungeonDvmHandler(/* DungeonDvmConfig */));

// Start
await node.start();
console.log('[DVM Entrypoint] DVM ready — handlers: kind:5094, kind:5250');
```

### Existing Dockerfile Patterns (MUST FOLLOW — from Stories 21.5/21.6)

Mirror `docker/Dockerfile.mill` exactly with these changes:
- Entrypoint: `entrypoint-dvm.ts` (not `entrypoint-mill.ts`)
- Package filters: `core`, `sdk`, `bls`, `pet-dvm`, `memvid-node`, `pet-circuit`
- Plus Arweave/Turbo: `packages/sdk/src/arweave/` is inside `@toon-protocol/sdk` (already included by sdk filter)
- esbuild externals: `better-sqlite3`, `ethers`, `express`, `mina-signer`, `o1js`, `@solana/kit`, `@solana-program/token`, `@toon-protocol/mina-zkapp`
- Ports: EXPOSE 3300 3400, default BLS_PORT=3400, default HANDLER_PORT=3300
- HEALTHCHECK: `wget -q --spider http://localhost:${BLS_PORT}/health || exit 1`

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** Not applicable (DVM pricing uses `BigInt` for amounts but no 64-bit bridging here).
- **Golden test vectors (ZK story pairs):** Not applicable (pet proofs tested in Epic 11 stories, not here).

### Dependency Budget

**No new production dependencies.** Dockerfile uses existing packages already in workspace:
- `@toon-protocol/sdk` (Arweave DVM, `createNode()`, `createArweaveDvmHandler`)
- `@toon-protocol/pet-dvm` (Dungeon DVM, `createDungeonDvmHandler`)
- `rot-js` (dungeon RNG, peer dep of pet-dvm)

**Potential issue:** `@toon-protocol/pet-dvm` is a jest-test package (`"test": "jest"`). For Docker runtime, we need it to work with Node.js ESM. The package uses tsc for `dist/` build, so it should work fine in Docker. Verify `package.json` exports map.

**Potential issue 2:** `pet-dvm` depends on `rot-js@^2.2.1` which is not in the workspace. During Docker pnpm install, it resolves from npm registry. This is fine.

### File Structure Requirements

```
docker/
├── Dockerfile.dvm              # NEW: Multi-stage DVM node container
├── src/
│   ├── entrypoint-town.ts      # existing (Story 21.5)
│   ├── entrypoint-mill.ts    # existing (Story 21.6)
│   └── entrypoint-dvm.ts   # NEW: createNode() + DVM handler wiring
docker-compose-townhouse.yml     # MODIFIED: Add healthcheck, volume, ports, identity env vars to dvm service
packages/townhouse/src/docker/
├── town-dockerfile.test.ts     # existing (Story 21.5)
├── mill-dockerfile.test.ts      # existing (Story 21.6)
└── dvm-dockerfile.test.ts    # NEW: Static analysis / integration test (mirror town-dockerfile.test.ts)
```

### Testing Strategy

| Test ID | Scenario | Task(s) | AC | Test Design Ref |
|---|---|---|---|---|
| T-034 | `docker/Dockerfile.dvm` builds successfully from repo root | 5.1 | #1 | TD T-034 |
| T-037 | DVM container responds to `/health` endpoint | 5.2, 5.4 | #3 | TD T-037 |
| T-038 | Container accepts connector URL via env var (standalone HTTP mode) | 5.3 | #2 | TD T-038 |
| T-039 | Fee configurable via `FEE_PER_JOB` env var | 2.3, 5.2 | #5 | TD T-039 |
| T-040 | DVM handlers respond to respective event kinds | 2.4, 5.3 | #4 | TD T-040 |
| T-041 | Static analysis: CMD points to correct entrypoint | 5.2 | #1 | TD T-041 |
| T-042 | Multi-stage build with minimal final image | 5.2 | #6 | TD T-042 |

**Unit tests (static analysis — no Docker required for CI):**
- Parse `docker/Dockerfile.dvm` and assert: `FROM node:20-alpine AS builder`, second `FROM node:20-alpine`, `USER toon`, `HEALTHCHECK`, `EXPOSE 3300 3400`, `CMD` contains `entrypoint-dvm.js`, pnpm 8.15.0 pinned, `VOLUME /data`
- Parse `docker/src/entrypoint-dvm.ts` and assert: imports `createNode`, uses standalone mode with `connectorUrl` + `handlerPort`, registers kind:5094 + kind:5250 handlers, initializes ArweaveUploadAdapter, registers SIGTERM handler
- Parse compose `dvm` service: image `toon:dvm`, profile `dvm`, depends on healthy connector, healthcheck on 3400, volume mount, identity env vars present
- Assert `buildNodeEnv('dvm')` produces expected env set (already covered in orchestrator tests; verify cross-link)

**Manual integration test (Docker required — not in CI):**
1. Build: `docker build -f docker/Dockerfile.dvm -t toon:dvm .`
2. `docker run --rm -e CONNECTOR_URL=http://townhouse-connector:8081 -e NODE_NOSTR_SECRET_KEY=<64-hex> -e TURBO_TOKEN=<token> toon:dvm`
3. Verify `/health` responds on port 3400 within 10 seconds
4. Verify kind:5094 and kind:5250 handlers registered (check health response JSON)

### Previous Story Intelligence (21.5 — Town Dockerfile, 21.6 — Mill Dockerfile)

Key patterns to continue from Stories 21.5 and 21.6:

- **Cache file contents** in test harness (see `town-dockerfile.test.ts:28`): `const dockerfile = readFileSync(...)` at module scope to avoid redundant synchronous reads across tests.
- **Guard against silent empty section** when parsing compose YAML (see `extractTownSection()` helper) — throw if split produces empty string.
- **Inline esbuild invocation in Dockerfile** (not shared `esbuild.config.mjs`) — proven pattern, simpler to reason about per-image.
- **Externals include `ethers` + `express`** due to connector's `requireOptional()` pattern (learned from Story 21.5 Review Pass #1 fix).
- **Register SIGTERM/SIGINT handlers** in entrypoint (Mill pattern — Town CLI auto-registers, but DVM's `createNode()` may or may not. Implement explicit handlers as defensive).
- **`CONTAINER_PREFIX = 'townhouse-'`** — container name will be `townhouse-dvm`.
- **`buildNodeEnv('dvm')`** should already produce: `CONNECTOR_URL=ws://townhouse-connector:3000`, `FEE_PER_JOB=<value>`, `NODE_NOSTR_PUBKEY=<hex>`, `NODE_EVM_ADDRESS=<hex>`, `NODE_NOSTR_SECRET_KEY=<hex>`.

### Git Intelligence

Recent commits (Stories 21.1–21.6) show consistent Townhouse development pattern:
- Each story self-contained within `packages/townhouse/` + `docker/` for infra stories
- Static-analysis tests preferred over Docker-in-CI (Docker builds manual-verified)
- Build system: tsup for packages, esbuild for Docker bundles
- No regression in prior tests enforced per story

### Security Notes

- **Non-root execution:** Container runs as `toon:toon` (UID 1001) after build stage.
- **Secret key via env var:** `NODE_NOSTR_SECRET_KEY` is injected by orchestrator at container creation time. Visible via `docker inspect` but requires Docker socket access (operator-level). Acceptable per Story 21.4 security analysis.
- **No mnemonic in container:** Only the derived secret key is passed, never the mnemonic.
- **Data volume permissions:** `/data` owned by `toon:toon` for pet state persistence.
- **Arweave token via env var:** `TURBO_TOKEN` is injected at deploy time. Treat as operator-sensitive.
- **Handler port 3300:** NOT mapped to host (only `expose: '3300'` in compose → Docker-internal). The standalone connector reaches it via Docker DNS. External attackers cannot reach the DVM HTTP handler.
- **BLS port 3400:** Mapped to `127.0.0.1` only — localhost-only access for dashboard/health polling.

### Project Structure Notes

- `docker/Dockerfile.dvm` follows existing convention: all Dockerfiles live in `docker/`
- `docker/src/entrypoint-dvm.ts` follows existing pattern: entrypoints live in `docker/src/`
- Static-analysis test lives in `packages/townhouse/` because it validates orchestrator integration, not DVM handler internals
- The DVM entrypoint imports from `@toon-protocol/sdk` and `@toon-protocol/pet-dvm` which are workspace packages built during the Dockerfile builder stage

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 21 (line 2812)] — Story 21.7 table entry (DVM Node Dockerfile, dependency 21.3, size M)
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#3.5 (lines 186–200)] — Test scenarios T-032 through T-042, specifically T-034, T-037, T-038, T-039, T-040
- [Source: _bmad-output/implementation-artifacts/21-5-town-node-dockerfile.md] — Town Dockerfile pattern; Review Pass #1 fixes (SIGTERM handling, ethers/express externals)
- [Source: _bmad-output/implementation-artifacts/21-6-mill-node-dockerfile.md] — Mill Dockerfile pattern; fee markup via rateProvider wrapping; previous story patterns
- [Source: docker/Dockerfile.town] — Reference Dockerfile to mirror structurally
- [Source: docker/Dockerfile.mill] — Second reference Dockerfile (most similar pattern to DVM)
- [Source: docker/src/entrypoint-town.ts] — Town entrypoint (env var mapping, dynamic CLI import)
- [Source: docker/src/entrypoint-mill.ts] — Mill entrypoint (JSON config + programmatic API + rate provider wrapping)
- [Source: packages/sdk/src/create-node.ts:85–240] — `NodeConfig` interface + `createNode()` API, standalone mode (`connectorUrl` + `handlerPort`)
- [Source: packages/sdk/src/arweave/arweave-dvm-handler.ts:55–] — `createArweaveDvmHandler()` + `ArweaveDvmConfig`
- [Source: packages/sdk/src/arweave/turbo-adapter.ts] — `ArweaveUploadAdapter` interface
- [Source: packages/sdk/src/arweave/chunk-manager.ts:35–] — `ChunkManager` class
- [Source: packages/pet-dvm/src/dungeon/dungeonDvmHandler.ts:167–] — `createDungeonDvmHandler()` + `DungeonDvmConfig`
- [Source: packages/pet-dvm/src/handler/createPetDvmHandler.ts:1–] — Pet DVM handler factory
- [Source: packages/townhouse/src/docker/orchestrator.ts:500–546] — `buildNodeEnv('dvm')` producing `CONNECTOR_URL` + `FEE_PER_JOB` + wallet keys
- [Source: packages/townhouse/src/constants.ts:18–20] — `CONTAINER_PREFIX`, `NODE_BTP_PORT`, `ACCOUNT_INDEX_DVM`
- [Source: packages/townhouse/src/docker/town-dockerfile.test.ts] — Mirror structure for `dvm-dockerfile.test.ts`
- [Source: packages/townhouse/src/docker/mill-dockerfile.test.ts] — Mirror structure for `dvm-dockerfile.test.ts`
- [Source: docker-compose-townhouse.yml:104–] — Existing dvm service block to augment

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

```
docker/Dockerfile.dvm                                    # NEW: DVM node container (multi-stage build)
docker/src/entrypoint-dvm.ts                           # NEW: createNode() + DVM handler wiring entrypoint
docker-compose-townhouse.yml                              # MODIFIED: dvm service healthcheck, volumes, ports, identity envs
packages/townhouse/src/docker/dvm-dockerfile.test.ts    # NEW: Static-analysis tests
```