# Story 21.6: Mill Node Dockerfile

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a production-grade Mill container,
so that I can run a multi-chain payment-channel swap issuer inside the Townhouse orchestration stack.

## Dependencies

- **Story 21.5** (done): Town Node Dockerfile — established Dockerfile pattern (`docker/Dockerfile.town`), esbuild entrypoint adapter (`docker/src/entrypoint-town.ts`), static-analysis test harness, compose stack wiring
- **Story 21.4** (done): HD wallet management — `WalletManager`, per-node key injection via `NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY` env vars (Mill uses `ACCOUNT_INDEX_MILL = 1`)
- **Story 21.3** (done): Standalone connector integration — `ConnectorConfigGenerator`, connector peers Mill at `btp+ws://townhouse-mill:3000`, Docker network `townhouse-net`
- **Story 21.2** (done): Docker orchestrator — `DockerOrchestrator.buildNodeEnv('mill')` producing `CONNECTOR_URL` + `FEE_BASIS_POINTS` + wallet identity env vars
- **Story 21.1** (done): Package scaffold, CLI, config schema (`MillNodeConfig` with `enabled`, `feeBasisPoints`, `image` fields)

**Runtime dependency (in-container):**
- `@toon-protocol/mill` — the `toon-mill` CLI binary + `startMill()` programmatic API (exists; supports `MILL_MNEMONIC`, `MILL_SECRET_KEY_HEX`, `MILL_BLS_PORT`, `MILL_RELAYS` env vars and `--config <path>` flag)

## Acceptance Criteria

1. `docker/Dockerfile.mill` builds successfully from repo root: `docker build -f docker/Dockerfile.mill -t toon:mill .` (Test T-033)
2. Container accepts connector peering via standalone connector's outbound BTP dial to `townhouse-mill:3000` (embedded `ConnectorNode` with `btpServerPort: 3000`; Test T-038)
3. Health endpoint at `/health` returning swap-engine status JSON on BLS port (Test T-036)
4. Swap pairs, chains, channels, and inventory configurable via `MILL_CONFIG_JSON` env var (operator-supplied JSON string) OR via `MILL_CONFIG_PATH` env var (path to JSON file mounted into container) — falls back to `--config` CLI flag for direct CLI use (Test T-040)
5. Fee markup configurable via `FEE_BASIS_POINTS` environment variable (propagated to swap handler; stored on Mill instance and reflected in `/health` response)
6. Multi-stage build with minimal final image, non-root execution (`USER toon`), HEALTHCHECK, EXPOSE 3000 (BTP) + 3200 (BLS) (Test T-042)
7. Image builds and starts successfully in townhouse compose stack (alongside connector on `townhouse-net`, profile `mill`)

## Tasks / Subtasks

- [x] Task 1: Create `docker/Dockerfile.mill` (AC: #1, #2, #3, #6)
  - [x] 1.1 Multi-stage build: `node:20-alpine` builder + minimal runtime (mirror `docker/Dockerfile.town` exactly — only entrypoint name, package filters, externals, ports, and COPY list change)
  - [x] 1.2 Builder stage: install pnpm 8.15.0, copy workspace manifests for Mill's dependency chain (`core`, `sdk`, `bls`, `mill`), `pnpm install --frozen-lockfile`, copy source
  - [x] 1.3 Build packages: `pnpm -r --filter '@toon-protocol/core' --filter '@toon-protocol/sdk' --filter '@toon-protocol/bls' --filter '@toon-protocol/mill' build` (note: relay is NOT needed; town is NOT needed)
  - [x] 1.4 Bundle entrypoint via esbuild: `docker/src/entrypoint-mill.ts` as single ESM bundle. Externals MUST include: `better-sqlite3`, `ethers`, `express` (connector `requireOptional` pattern — mirrors Town), plus `mina-signer`, `o1js`, `@solana/kit`, `@solana-program/token`, `@toon-protocol/mina-zkapp` (Mill peerDeps — optional multi-chain signers). Keep `@scure/bip32`, `@scure/bip39`, `@noble/curves`, `@noble/hashes`, `ed25519-hd-key`, `nostr-tools`, `hono`, `@hono/node-server`, `@toon-protocol/connector` BUNDLED (no externals beyond list above)
  - [x] 1.5 Runtime stage: `node:20-alpine`, `apk add libstdc++`, copy bundle + `better-sqlite3` native module + `package.json` with `"type":"module"`. Do NOT copy `ethers`/`express`/Mina/Solana packages — they are peer-optional and will throw "not installed" at runtime if used; Mill-only swap chains will never reach those code paths (see Dev Notes § Externals Rationale)
  - [x] 1.6 Set `EXPOSE 3000 3200` (BTP peer + BLS HTTP health), `HEALTHCHECK` targeting `/health` on BLS port, `USER toon` (UID 1001) for non-root execution, `VOLUME /data`
  - [x] 1.7 Default env vars: `ENV BLS_PORT=3200`, `ENV NODE_ENV=production`
  - [x] 1.8 `CMD ["node", "/app/entrypoint-mill.js"]` pointing to the esbuild bundle

- [x] Task 2: Create `docker/src/entrypoint-mill.ts` (AC: #2, #4, #5)
  - [x] 2.1 Create TypeScript entrypoint that imports `startMill()` directly from `@toon-protocol/mill` (NOT a dynamic import of the CLI — we need programmatic control to wire env-derived config)
  - [x] 2.2 Load mill config: if `MILL_CONFIG_JSON` env var set, `JSON.parse(process.env.MILL_CONFIG_JSON)`; else if `MILL_CONFIG_PATH` set, read that file; else throw descriptive error listing required config shape
  - [x] 2.3 Env var overlay on loaded config:
    - `NODE_NOSTR_SECRET_KEY` (64-hex) → `config.secretKey = Uint8Array.from(Buffer.from(hex, 'hex'))`
    - `BLS_PORT` (numeric, default 3200) → `config.blsPort`
    - `MILL_RELAYS` (comma-separated) → `config.relayUrls`
    - `FEE_BASIS_POINTS` → stored for swap-handler rate provider wrapping (see § Fee Markup Integration)
  - [x] 2.4 Force `config.btpServerPort = 3000` (override any JSON value) so embedded `ConnectorNode` listens on the BTP port the standalone connector dials. Do NOT set `config.connectorUrl` — standalone HTTP mode is deferred (see Dev Notes § Connector Wiring)
  - [x] 2.5 Rehydrate bigint/numeric fields from JSON: `config.inventory[chain]` → BigInt, `config.channels[chain][*].cumulativeAmount`/`.nonce` → BigInt (JSON doesn't preserve bigint — mirror `packages/mill/src/cli.ts` `loadConfig()` conversion logic)
  - [x] 2.6 Call `await startMill(config)`; log `Mill Ready` banner with `pubkey`, `evmAddress`, `blsPort`, swap-pair count; register SIGTERM/SIGINT handlers that call `instance.stop()` then `process.exit(0)` (mirror Town CLI's shutdown — Mill CLI does NOT auto-register handlers, unlike Town CLI)
  - [x] 2.7 Catch fatal startup errors, log with `[Fatal]` prefix, `process.exit(1)`

- [x] Task 3: Update `docker-compose-townhouse.yml` mill service (AC: #7)
  - [x] 3.1 The `mill` service already exists with profile, image, network, depends_on, and basic env vars (`CONNECTOR_URL`, `FEE_BASIS_POINTS`). Add missing production concerns below (mirror `town` service structure from Story 21.5)
  - [x] 3.2 Add healthcheck matching Dockerfile HEALTHCHECK: `wget -q --spider http://localhost:3200/health`, interval 30s, timeout 10s, retries 3, start_period 5s
  - [x] 3.3 Add named volume mount for persistent channel-state storage: `townhouse-mill-data:/data` (declare `townhouse-mill-data:` in top-level `volumes:` section)
  - [x] 3.4 Add identity env var placeholders (injected by orchestrator at runtime; leave empty-string defaults in compose): `NODE_NOSTR_PUBKEY: ''`, `NODE_EVM_ADDRESS: ''`, `NODE_NOSTR_SECRET_KEY: ''`
  - [x] 3.5 Add host port mapping for BLS health: `'127.0.0.1:3200:3200'`
  - [x] 3.6 Remove the `CONNECTOR_URL` env var from the compose mill service OR leave it as documentation — the Mill entrypoint IGNORES `CONNECTOR_URL` (see Dev Notes § Connector Wiring). Leave it with a comment: `# CONNECTOR_URL: accepted but IGNORED — Mill uses embedded connector on BTP port 3000`
  - [x] 3.7 Add `MILL_CONFIG_PATH: /config/mill.config.json` env var and a mount point `- ./config/mill:/config:ro` (config directory to be populated by a future Mill Management story — keep mount optional via `# optional:` comment)
  - [x] 3.8 Add `restart: unless-stopped`

- [x] Task 4: Verify `@toon-protocol/mill` package exports needed for entrypoint (AC: #4)
  - [x] 4.1 Confirm `startMill`, `MillConfig`, `MillInstance`, `MillChainKind`, `SwapPair`, `ChannelEntry` are exported from `packages/mill/src/index.ts` (audit; add exports if missing)
  - [x] 4.2 Ensure `packages/mill/package.json` `exports` map includes `.` → `./dist/index.js` (already present); no `./cli` export needed (entrypoint uses programmatic API, not CLI)
  - [x] 4.3 Verify existing Mill tests still pass: `pnpm --filter @toon-protocol/mill test` (no runtime changes — exports audit only)

- [x] Task 5: Static-analysis integration test (AC: #1, #3, #6, #7)
  - [x] 5.1 Create `packages/townhouse/src/docker/mill-dockerfile.test.ts` mirroring `town-dockerfile.test.ts` structure
  - [x] 5.2 Dockerfile assertions: multi-stage (`FROM node:20-alpine AS builder` + second `FROM node:20-alpine`), `USER toon`, `HEALTHCHECK` present targeting `/health`, `EXPOSE 3000 3200`, `CMD` contains `entrypoint-mill.js`, pnpm pinned to 8.15.0, `VOLUME /data`, non-root UID 1001 (`adduser -D -u 1001`)
  - [x] 5.3 Entrypoint assertions: maps `NODE_NOSTR_SECRET_KEY` → `config.secretKey`, `BLS_PORT` → `config.blsPort`, `MILL_CONFIG_JSON`/`MILL_CONFIG_PATH` loading both present, forces `btpServerPort = 3000`, does NOT forward `CONNECTOR_URL` (grep assertion), imports `startMill` from `@toon-protocol/mill`, registers SIGTERM handler
  - [x] 5.4 Compose assertions: `mill` service has image `toon:mill`, profile `mill`, depends on `connector: service_healthy`, healthcheck on port 3200, volume `townhouse-mill-data:/data`, identity env var keys present, host port `127.0.0.1:3200:3200` mapped, `townhouse-mill-data` declared in top-level `volumes:`
  - [x] 5.5 `buildNodeEnv('mill')` integration test: assert orchestrator produces `CONNECTOR_URL=ws://townhouse-connector:3000` + `FEE_BASIS_POINTS=<value>` + `NODE_NOSTR_SECRET_KEY=<hex>` (already existing test in orchestrator suite; add cross-link comment)
  - [x] 5.6 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

- [x] Task 6: Update `docker/esbuild.config.mjs` (AC: #1) — only if Docker build uses shared config
  - [x] 6.1 Check whether `Dockerfile.mill` invokes esbuild inline (like `Dockerfile.town` does) or through `docker/esbuild.config.mjs`. Story 21.5 used inline invocation, so follow the same pattern for parity (NO changes to `esbuild.config.mjs` required). Document this in Dev Notes.

## Dev Notes

### Architecture Context

This story creates the second of three node Dockerfiles (Town ✓, Mill ← **this story**, DVM). The pattern was established in Story 21.5 — mirror it almost exactly, changing only the package filters, externals, ports, entrypoint logic, and the fact that Mill uses the `startMill()` programmatic API rather than the CLI directly.

**D21-001:** Every node type runs as a Docker container. Production-grade Dockerfiles with process isolation.

### Key Architectural Divergence from Town

| Concern | Town (21.5) | Mill (this story) |
|---|---|---|
| Connector wiring | CLI reads `TOON_CONNECTOR_URL`, embeds ConnectorNode on BTP 3000 | **Embedded ConnectorNode with `btpServerPort: 3000`; `connectorUrl` NOT used** |
| Config source | All via env vars (`TOON_*`) | **Structured config (swap pairs, chains, channels, inventory) MUST come from JSON** (env var or mounted file) — too complex for flat env vars |
| Entrypoint dispatch | Dynamic import `@toon-protocol/town/cli` (CLI auto-runs `main()`) | **Direct import `startMill` + programmatic `await startMill(config)`** — we need full control to merge JSON config + env overrides |
| Shutdown handlers | Town CLI registers its own | **Entrypoint MUST register SIGTERM/SIGINT** (Mill CLI does it, but we bypass the CLI) |
| BLS port | 3100 | **3200** (distinct to avoid host-port conflict when running Town+Mill on same host) |
| Relay WS port | 7100 exposed | **N/A — Mill has no Nostr relay** |
| Native module set | `better-sqlite3` only | **`better-sqlite3` only** (channel-state store) — same |
| Extra externals | `ethers`, `express` (connector optional) | `ethers`, `express`, PLUS `mina-signer`, `o1js`, `@solana/kit`, `@solana-program/token`, `@toon-protocol/mina-zkapp` (peerDeps) |

### Connector Wiring (CRITICAL — DO NOT MIS-IMPLEMENT)

The Mill's relationship with the standalone connector is **opposite** to what the env var `CONNECTOR_URL` suggests:

- The **standalone connector** (container `townhouse-connector`) reads its peer list and establishes an **outbound** BTP WebSocket connection **TO** `btp+ws://townhouse-mill:3000`.
- The **Mill container** therefore needs a **BTP server** listening on port 3000 inside the container.
- `@toon-protocol/mill`'s `startMill()` provides this via an **auto-created embedded `ConnectorNode`** when the operator passes `btpServerPort` and omits both `connector` and `connectorUrl`.
- The `MillConfig.connectorUrl` field is **currently deferred** — `packages/mill/src/mill.ts:580-588` explicitly logs a warning and does NOT dispatch on it. Setting `connectorUrl` will silently fail to wire.

**Correct entrypoint config:**
```typescript
await startMill({
  ...configFromJson,
  secretKey: secretKeyFromEnv,       // from NODE_NOSTR_SECRET_KEY
  blsPort: 3200,                      // from BLS_PORT env
  btpServerPort: 3000,                // HARDCODED — do NOT read from env
  // NO connectorUrl, NO connector — forces embedded-connector path
});
```

The `CONNECTOR_URL` env var injected by `DockerOrchestrator.buildNodeEnv('mill')` is **intentionally ignored by the Mill entrypoint**. Leave the env var in compose (for consistency with town/dvm) but document the ignore.

### Externals Rationale

The `@toon-protocol/mill` package has several **peer-optional** dependencies used only by specific chain families:

| Package | Used by | Keep as external? |
|---|---|---|
| `mina-signer`, `o1js`, `@toon-protocol/mina-zkapp` | Mina chain swaps | **Yes** — peerDependenciesMeta.optional; only load if Mina pairs configured |
| `@solana/kit`, `@solana-program/token` | Solana swaps | **Yes** — optional; only load if Solana pairs configured |
| `ethers` | Connector's `requireOptional()` + EVM swaps | **Yes** — same pattern as Dockerfile.town |
| `express` | Connector's AdminServer/HealthServer | **Yes** — same pattern as Dockerfile.town |
| `@ardrive/turbo-sdk` | NOT used by Mill (Epic 8 Rig only) | External but won't be loaded — harmless |
| `socks-proxy-agent` | ATOR transport (Epic 35) | **Keep bundled** — Mill may use it |
| `better-sqlite3` | Mill channel-state store | **Yes** — native .node addon (only truly required external) |

**Runtime behavior:** If a Mill is configured with ONLY EVM swap pairs, the Mina/Solana externals are never resolved at runtime → no "module not found" errors. If an operator configures a Mina pair, they will get a clear error telling them `mina-signer` is not installed — which is acceptable for v1 (Townhouse v1 targets EVM-only pairs per Epic 21 scope; Mina/Solana support is a post-21 enhancement).

**Do NOT copy Mina/Solana/ethers node_modules into the runtime stage.** They stay external and unresolved; Mill gracefully skips those signers.

### Fee Markup Integration (`FEE_BASIS_POINTS`)

Mill's swap fee is implemented via `MillConfig.rateProvider` (see `packages/mill/src/mill.ts:114`). For v1 Dockerfile scope:

- **Option A (RECOMMENDED, in-scope):** Entrypoint reads `FEE_BASIS_POINTS` (integer 0–10000) and wraps `config.rateProvider` (or installs a default) with a markup applier. Pseudocode:
  ```typescript
  const bps = parseInt(process.env['FEE_BASIS_POINTS'] ?? '0', 10);
  const baseRateProvider = config.rateProvider ?? defaultOneToOneRateProvider;
  config.rateProvider = (pair) => {
    const baseRate = baseRateProvider(pair);
    return baseRate * (10_000n - BigInt(bps)) / 10_000n;  // apply markup as haircut on output
  };
  ```
  Exact semantics (markup vs. haircut, numerator/denominator) depend on `createSwapHandlerConfig`'s contract — audit `packages/sdk/src/swap-handler.ts` `RateProvider` type before implementing.

- **Option B (scope-deferred):** Ignore `FEE_BASIS_POINTS` in entrypoint; emit `[Mill Entrypoint] WARN: FEE_BASIS_POINTS not yet wired (will be in Story 21.11 Mill Management View)`. Pass integration forward.

**Choose Option A** unless the RateProvider signature makes markup wrapping non-trivial (>30 lines). Document the choice in Completion Notes.

### Existing Dockerfile Patterns (MUST FOLLOW — from Story 21.5)

The `docker/Dockerfile.town` established the project's Docker conventions. Mirror these exactly:

1. **Multi-stage build:** `node:20-alpine` builder + minimal `node:20-alpine` runtime
2. **pnpm pinned:** `corepack enable && corepack prepare pnpm@8.15.0 --activate`
3. **esbuild bundling:** Single ESM bundle with native modules as externals
4. **ESM package.json:** `{"type":"module"}` in runtime
5. **Native module cherry-pick:** Copy `better-sqlite3` build artifacts + `bindings` + `file-uri-to-path` from pnpm store paths
6. **Non-root user:** `addgroup/adduser toon` with UID 1001
7. **HEALTHCHECK:** `wget -q --spider http://localhost:${BLS_PORT}/health || exit 1`
8. **Volume for persistent data:** `VOLUME /data` (Mill uses this for channel-state persistence)
9. **Inline esbuild invocation** (not via `docker/esbuild.config.mjs`) — Dockerfile runs `cd docker && pnpm exec esbuild src/entrypoint-mill.ts --bundle --platform=node --target=node20 --format=esm --minify --outfile=dist/entrypoint-mill.js --banner:js="..." --external:better-sqlite3 --external:ethers --external:express --external:mina-signer --external:o1js --external:@solana/kit --external:@solana-program/token --external:@toon-protocol/mina-zkapp`
10. **createRequire banner:** `--banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"` (connector's `requireOptional` needs it)

### Mill Config Shape (Reference)

The JSON supplied via `MILL_CONFIG_JSON` / `MILL_CONFIG_PATH` mirrors `packages/mill/src/cli.ts` CLI config:

```json
{
  "swapPairs": [ { "from": { "chain": "ethereum", "asset": "USDC" }, "to": { "chain": "base", "asset": "USDC" }, "rate": "1.0" } ],
  "chains": ["ethereum", "base"],
  "channels": { "ethereum": [{ "channelId": "0x...", "cumulativeAmount": "1000000", "nonce": "0" }] },
  "inventory": { "ethereum": "10000000000" },
  "relayUrls": ["wss://relay.damus.io"],
  "ilpAddress": "g.townhouse.mill.<pubkey16>",
  "btpEndpoint": "",
  "advertisedAsset": { "assetCode": "USD", "assetScale": 6 }
}
```

**BigInt fields (MUST be rehydrated):** `inventory[chain]`, `channels[chain][*].cumulativeAmount`, `channels[chain][*].nonce` — JSON serializes these as strings or numbers; entrypoint MUST convert to `BigInt` before passing to `startMill()`. Mirror the `toBigInt()` helper in `packages/mill/src/cli.ts:65-70`.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** **Applicable** — `inventory` and `channel.cumulativeAmount` are bigints that may exceed `Number.MAX_SAFE_INTEGER`. The JSON config rehydration MUST use `BigInt(stringValue)`, NOT `Number()`. Static test asserts `toBigInt` is called on these fields.
- **Golden test vectors (ZK story pairs):** Not applicable (no ZK circuits in this story; the Mill's payment-channel signing is tested elsewhere).

### Dependency Budget

**No new production dependencies.** Dockerfile uses existing build tooling (esbuild from `docker/` workspace, pnpm). Entrypoint uses only `@toon-protocol/mill`'s existing public API.

### File Structure Requirements

```
docker/
├── Dockerfile.mill              # NEW: Multi-stage Mill node container
├── src/
│   ├── entrypoint-mill.ts       # NEW: Env var adapter + programmatic startMill() invocation
│   └── ...existing files (entrypoint-town.ts, entrypoint-sdk.ts, etc.)
docker-compose-townhouse.yml     # MODIFIED: Add healthcheck, volume, ports, identity env vars, MILL_CONFIG_PATH to mill service; declare townhouse-mill-data volume
packages/townhouse/src/docker/
├── mill-dockerfile.test.ts      # NEW: Static analysis / integration test (mirror town-dockerfile.test.ts)
packages/mill/src/
├── index.ts                     # VERIFY (possibly modify): ensure startMill, MillConfig, MillChainKind exported
```

**No modifications to `packages/mill/src/cli.ts` or `mill.ts` are required** (unlike Story 21.5 which added `TOON_FEE_PER_EVENT` to the Town CLI). The entrypoint uses `startMill()` directly; fee markup is layered in the entrypoint via rateProvider wrapping.

### Testing Strategy

| Test ID | Scenario | Task(s) | AC | Test Design Ref |
|---|---|---|---|---|
| T-033 | `docker/Dockerfile.mill` builds successfully from repo root | 5.2 | #1 | TD T-033 |
| T-036 | Mill container responds to `/health` endpoint | 5.2, 5.4 | #3 | TD T-036 |
| T-038 | Container accepts connector URL via env var (via embedded connector on BTP 3000) | 5.3, 5.4 | #2 | TD T-038 |
| T-040 | Swap pairs configurable via env vars (`MILL_CONFIG_JSON` / `MILL_CONFIG_PATH`) | 2.2, 5.3 | #4 | TD T-040 |
| T-041 | Static analysis: CMD points to correct entrypoint | 5.2 | #1 | TD T-041 |
| T-042 | Multi-stage build with minimal final image | 5.2 | #6 | TD T-042 |

**Unit tests (static analysis — no Docker required for CI):**
- Parse `docker/Dockerfile.mill` and assert: `FROM node:20-alpine AS builder`, second `FROM node:20-alpine`, `USER toon`, `HEALTHCHECK`, `EXPOSE 3000 3200`, `CMD` contains `entrypoint-mill.js`, pnpm 8.15.0 pinned, `VOLUME /data`, externals list includes `better-sqlite3`
- Parse `docker/src/entrypoint-mill.ts` and assert: imports `startMill`, handles both `MILL_CONFIG_JSON` and `MILL_CONFIG_PATH`, forces `btpServerPort = 3000`, does NOT set `connectorUrl`, rehydrates `BigInt` for inventory/channels, registers SIGTERM handler
- Parse compose `mill` service: image `toon:mill`, profile `mill`, depends on healthy connector, healthcheck on 3200, volume mount, identity env vars present
- Assert `buildNodeEnv('mill')` produces expected env set (already covered in orchestrator tests; verify cross-link)

**Manual integration test (Docker required — not in CI):**
1. Build: `docker build -f docker/Dockerfile.mill -t toon:mill .`
2. Create minimal `mill.config.json` with test EVM swap pair + empty channels/inventory
3. `docker run --rm -v $(pwd)/mill.config.json:/config/mill.config.json -e MILL_CONFIG_PATH=/config/mill.config.json -e NODE_NOSTR_SECRET_KEY=<64-hex> toon:mill`
4. Verify `/health` responds on port 3200 within 10 seconds
5. Verify BTP server listening on 3000 via `docker exec <container> wget -q --spider http://localhost:3200/health`

### Previous Story Intelligence (21.5 — Town Dockerfile)

Key patterns to continue from Story 21.5:

- **Cache file contents** in test harness (see `town-dockerfile.test.ts:28`): `const dockerfile = readFileSync(...)` at module scope to avoid redundant syncrhonous reads across tests.
- **Guard against silent empty section** when parsing compose YAML (see `extractTownSection()` helper) — throw if split produces empty string.
- **Inline esbuild invocation in Dockerfile** (not shared `esbuild.config.mjs`) — proven pattern, simpler to reason about per-image.
- **Externals include `ethers` + `express`** due to connector's `requireOptional()` pattern (learned from Story 21.5 Review Pass #1 fix).
- **Do NOT register SIGTERM in entrypoint** when the CLI has its own handler — but Mill DOES need one because we bypass the CLI. This is the inverse of Town's lesson learned (Story 21.5 Review Pass #1 #1).
- **Container naming:** `townhouse-mill` (via `CONTAINER_PREFIX = 'townhouse-'` + node type).
- **`buildNodeEnv('mill')`** already produces: `CONNECTOR_URL=ws://townhouse-connector:3000`, `FEE_BASIS_POINTS=<value>`, `NODE_NOSTR_PUBKEY=<hex>`, `NODE_EVM_ADDRESS=<hex>`, `NODE_NOSTR_SECRET_KEY=<hex>`.

### Git Intelligence

Recent commits (Stories 21.1–21.5) show consistent Townhouse development pattern:
- Each story self-contained within `packages/townhouse/` + `docker/` for infra stories
- Static-analysis tests preferred over Docker-in-CI (Docker builds manual-verified)
- Build system: tsup for packages, esbuild for Docker bundles
- No regression in prior tests enforced per story

### Security Notes

- **Non-root execution:** Container runs as `toon:toon` (UID 1001) after build stage.
- **Secret key via env var:** `NODE_NOSTR_SECRET_KEY` is injected by orchestrator at container creation time. Visible via `docker inspect` but requires Docker socket access (operator-level). Acceptable per Story 21.4 security analysis.
- **No mnemonic in container:** Only the derived secret key is passed, never the mnemonic or encrypted wallet file.
- **Channel-state volume permissions:** `/data` owned by `toon:toon` for channel-state SQLite DB + inventory persistence.
- **Config file confidentiality:** `mill.config.json` may contain channel IDs + cumulative amounts — treat as operator-sensitive. Mount read-only (`:ro`) in compose.
- **BTP port 3000 exposure:** NOT mapped to host (only `expose: '3000'` in compose → Docker-internal). External attackers cannot reach the BTP server.
- **BLS port 3200:** Mapped to `127.0.0.1` only — localhost-only access for dashboard polling.

### Project Structure Notes

- `docker/Dockerfile.mill` follows existing convention: all Dockerfiles live in `docker/`
- `docker/src/entrypoint-mill.ts` follows existing pattern: entrypoints live in `docker/src/`
- The `docker/package.json` may need to be updated to include `@toon-protocol/mill` as a workspace dep reference (check after first build attempt; add if esbuild fails to resolve)
- Static-analysis test lives in `packages/townhouse/` because it validates orchestrator integration, not Mill internals

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Townhouse (line 2811)] — Story 21.6 table entry (Mill Node Dockerfile, dependency 21.3, size M)
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#3.5 (lines 186–200)] — Test scenarios T-032 through T-042, specifically T-033, T-036, T-038, T-040
- [Source: _bmad-output/implementation-artifacts/21-5-town-node-dockerfile.md] — Previous story patterns; Review Pass #1 fixes (SIGTERM handling, ethers/express externals)
- [Source: docker/Dockerfile.town] — Reference Dockerfile to mirror structurally
- [Source: docker/src/entrypoint-town.ts] — Reference entrypoint adapter pattern (but note Mill uses programmatic API not CLI import)
- [Source: packages/mill/src/mill.ts:86–220] — `MillConfig` interface + `startMill()` contract
- [Source: packages/mill/src/mill.ts:575–625] — Embedded-connector auto-wire logic (`btpServerPort` path; `connectorUrl` deferred)
- [Source: packages/mill/src/cli.ts:65–170] — CLI config loading + env overlay reference for entrypoint's JSON rehydration
- [Source: packages/townhouse/src/docker/orchestrator.ts:500–546] — `buildNodeEnv('mill')` producing `CONNECTOR_URL` + `FEE_BASIS_POINTS` + wallet keys
- [Source: packages/townhouse/src/constants.ts] — `CONTAINER_PREFIX`, `NODE_BTP_PORT`, `ACCOUNT_INDEX_MILL`
- [Source: packages/townhouse/src/docker/town-dockerfile.test.ts] — Mirror structure for `mill-dockerfile.test.ts`
- [Source: docker-compose-townhouse.yml:85–103] — Existing mill service block to augment
- [Source: docker/esbuild.config.mjs] — Externals list reference (ethers, express, mina-signer, etc.)
- [Source: packages/mill/package.json] — peerDependenciesMeta.optional confirms Mina/Solana are safe externals

## Dev Agent Record

### Agent Model Used

Claude 3.7 Sonnet (via pi coding agent)

### Debug Log References

- Entrypoint imports `startMill` directly from `@toon-protocol/mill` (not CLI) — enables programmatic config merging
- Connector BTP wiring: `btpServerPort = 3000` forces embedded connector; `connectorUrl` intentionally NOT set (deferred)
- Fee markup via rateProvider wrapping: `FEE_BASIS_POINTS` reduces output by (bps / 10000) fraction
- BigInt rehydration mirrors `cli.ts` `toBigInt()` helper for inventory/channels
- SIGTERM/SIGINT handlers registered in entrypoint (Mill CLI doesn't auto-register when using programmatic API)

### Completion Notes List

- ✅ Task 1: Created `docker/Dockerfile.mill` with multi-stage build (builder + runtime), esbuild bundling, externals for optional chain signers (ethers, express, mina-signer, o1js, @solana/kit, @toon-protocol/mina-zkapp), pnpm 8.15.0 pinned, non-root user toon (UID 1001), HEALTHCHECK, VOLUME /data, EXPOSE 3000 3200
- ✅ Task 2: Created `docker/src/entrypoint-mill.ts` with JSON config loading (MILL_CONFIG_JSON / MILL_CONFIG_PATH), env var overlays (NODE_NOSTR_SECRET_KEY, BLS_PORT, MILL_RELAYS), FEE_BASIS_POINTS via rateProvider wrapping, forced btpServerPort=3000, BigInt rehydration, startup banner, SIGTERM/SIGINT handlers
- ✅ Task 3: Updated `docker-compose-townhouse.yml` mill service with healthcheck, volume mount (townhouse-mill-data:/data), identity env vars, host port 3200 mapping, documented CONNECTOR_URL as ignored
- ✅ Task 4: Verified `@toon-protocol/mill` exports (startMill, MillConfig, MillInstance, MillChainKind, etc.) — all already exported in index.ts
- ✅ Task 5: Created `packages/townhouse/src/docker/mill-dockerfile.test.ts` with comprehensive static-analysis tests for Dockerfile structure, entrypoint assertions, compose integration
- ✅ Task 6: Confirmed inline esbuild invocation (same pattern as Dockerfile.town) — no changes to esbuild.config.mjs needed

**Fee Markup Implementation Choice:** Option A (in-scope) — rateProvider wrapping in entrypoint applies FEE_BASIS_POINTS as a haircut on swap output rates. This is the recommended approach from Dev Notes.

### File List

```
docker/Dockerfile.mill                                    # NEW: Mill node container (multi-stage build)
docker/src/entrypoint-mill.ts                             # NEW: Mill entrypoint adapter
docker-compose-townhouse.yml                              # MODIFIED: mill service healthcheck, volumes, ports, identity envs
packages/townhouse/src/docker/mill-dockerfile.test.ts    # NEW: Static-analysis tests (mirrors town-dockerfile.test.ts)
```
