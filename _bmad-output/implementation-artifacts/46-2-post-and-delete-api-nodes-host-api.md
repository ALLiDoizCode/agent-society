# Story 46.2: `POST /api/nodes` and `DELETE /api/nodes/:id` Host API

Status: done

> **Second story of Epic 46 (Lazy Peer Node Provisioning).** Sized L. Depends on Story 46.1 (nodes.yaml schema, reconciler, peer-type resolver — all done). Unblocks Story 46.3 (CLI verbs `townhouse node add/remove/list`) and Story 46.4 (Live E2E gate). The strict 6-step pipeline ordering and atomic rollback are the load-bearing contract of this story — get those right and the CLI in 46.3 is a thin wrapper.

## Story

As a **townhouse host API**,
I want **endpoints that provision and tear down child nodes atomically with rollback on failure**,
so that **the CLI and any future SPA both drive node lifecycle through one tested code path**.

## Acceptance Criteria

1. **Given** the host API at `127.0.0.1:28090`
   **When** a client sends `POST /api/nodes` with body `{ "type": "town" | "mill" | "dvm" }`
   **Then** the server orchestrates a strict 6-step pipeline IN ORDER:
   1. `WalletManager.deriveNodeKey(type, nextIndex)` (no state change yet)
   2. `DockerOrchestrator.pullImage(manifest[type].digest)` — fail returns 502
   3. **Write `nodes.yaml` entry** (BEFORE connector registration)
   4. `DockerOrchestrator.startContainer(spec)` with derived key as env — fail removes yaml entry, returns 502
   5. `waitForHealthy(http://<id>:<port>/health, 60s)` — fail removes yaml entry + stops container, returns 502
   6. `ConnectorAdminClient.registerPeer({ pubkey, endpoint })` — fail removes yaml entry + stops container, returns 502

2. **Given** the pipeline ordering rule
   **When** the implementation is reviewed
   **Then** the `nodes.yaml` write happens at step 3, BEFORE the connector registration at step 6 (never the reverse)

3. **Given** any pipeline step fails
   **When** the rollback completes
   **Then** `nodes.yaml` AND the connector peers list end byte-identical to the pre-add state (state-machine table tests with injected failures at each transition assert this)

4. **Given** a successful provisioning
   **When** the response is returned
   **Then** body is `{ id, type, peerId, ilpAddress, hsRoute, healthCheckUrl }` with HTTP 201

5. **Given** failure at any step
   **When** the error response is returned
   **Then** body includes the specific failed step `{ step: 'healthcheck', err: '...' }` for debuggability

6. **Given** the host API
   **When** a client sends `DELETE /api/nodes/:id`
   **Then** the reverse pipeline runs: deregister with connector FIRST → stop container → remove yaml entry — each step idempotent

7. **Given** any state mutation
   **When** re-run against the same operator action
   **Then** the operation is idempotent (no-op if already in target state)

**FRs:** FR8, FR9, FR13 | **UX-DRs:** UX-DR5 (partial — image pull failure copy)

## Dev Notes

### Critical Architectural Rule — Yaml-First Ordering

This story enforces the load-bearing rule from Epic 46 planning:

> **`nodes.yaml` write happens BEFORE `POST /admin/peers` (step 3 < step 6).**

The drift window resolves in the safe direction (already documented in `packages/townhouse/src/reconciler.ts` `reconcile()` block comment):
- yaml entry without connector peer = harmless. Reconciler re-registers on next `hs up`.
- connector peer without yaml entry = treated as `'external'` (left alone).

The unsafe direction (register first, then write yaml) creates a window where the connector routes to a peer Townhouse cannot clean up. **Do not invert the order.** Any code review that flips it must be rejected.

### Existing Helpers This Story Reuses (do NOT reinvent)

- **`readNodesYaml(path)` / `writeNodesYaml(path, data)`** at `packages/townhouse/src/state/nodes-yaml.ts` — atomic, mode `0o600`, ISO-8601-validated, unique `peerId` + `derivationIndex` enforced by zod. Use these for every yaml mutation. Do NOT bypass the zod schema.
- **`ConnectorAdminClient.registerPeer({id, url, authToken, routes?})`** at `packages/townhouse/src/connector/admin-client.ts:261` — already exists. Used by reconciler + this story. POST /admin/peers is idempotent on the connector side (re-registering same id is a no-op for the peer; routes dedupe by prefix per `routingTable.addRoute()`).
- **`PeerStatus` / `PeersResponse`** at `packages/townhouse/src/connector/types.ts` — connector peer shape. The connector's `id` field maps to yaml's `peerId` field byte-for-byte (Story 46.1 Implementation Notes — "Field-name mapping").
- **`ApiDeps`** at `packages/townhouse/src/api/types.ts:411` — DI bag passed to every route registrar. This story does NOT add new fields to `ApiDeps`; it consumes existing `orchestrator`, `wallet`, `connectorAdmin`, `config`, `configPath`.
- **`CONTAINER_PREFIX`, `NODE_BTP_PORT`, `TOWN_HEALTH_PORT`, `MILL_HEALTH_PORT`, `DVM_HEALTH_PORT`** at `packages/townhouse/src/constants.ts` — single source of truth for container naming and port assignments. HS-profile container names follow the pattern `townhouse-hs-<type>` (note: `-hs-` infix in compose template differs from the `townhouse-<type>` dev pattern — see `compose/townhouse-hs.yml:202,244,291`).
- **`ACCOUNT_INDEX_TOWN/MILL/DVM`** at `packages/townhouse/src/constants.ts:33-35` — fixed HD account indices per node type.

### NEW Methods This Story Adds

Three new methods land in this story. Keep them small, testable, and side-effect-free where possible:

1. **`WalletManager.deriveNodeKey(type: NodeType, derivationIndex: number): NodeKeys`** at `packages/townhouse/src/wallet/manager.ts`.
   - Derives keys at the given `derivationIndex` (BIP-44 account index), not the fixed `ACCOUNT_INDEX_{type}` constant. This future-proofs for multi-instance per type (Story 46.4+).
   - **v1 constraint:** the host-API caller MUST pass `derivationIndex = ACCOUNT_INDEX_{type}` for the first instance per type. Multi-instance support is out of scope; the API enforces single-instance-per-type at the route layer (see Task 3.3 — return 409 if a yaml entry of the same type already exists).
   - Pure derivation. Does NOT mutate `WalletManager.state` (the existing `getNodeKeys(type)` / `state` pathway is for the wallet-load lifecycle, distinct from this transient derivation).
   - For `'mill'`, also derives Solana + Mina addresses via `deriveMillKeys` at the same `accountIndex` — mirror the existing `deriveAllKeys` flow for the mill branch.

2. **`DockerOrchestrator.pullImage(image: string): Promise<void>`** at `packages/townhouse/src/docker/orchestrator.ts`.
   - Pulls a single image-by-digest reference (e.g. `ghcr.io/toon-protocol/town@sha256:abc...`). Existing `pullImages(profiles[])` pulls many images at once and is the wrong shape — extract the per-image inner loop (lines 952–959) into a public method that pulls exactly one ref and emits `pullProgress`. Skip-if-exists logic (match against `RepoTags ∪ RepoDigests`) is preserved.
   - Failure path throws `OrchestratorError` so the route layer can return HTTP 502 with structured `{ step: 'pull', err }`.

3. **`DockerOrchestrator.startNodeViaCompose(type: NodeType, env: Record<string, string>): Promise<void>`** at `packages/townhouse/src/docker/orchestrator.ts` (HS profile only).
   - **DO NOT reuse `startNode()`** (private, dockerode `createContainer` path) — that path is `dev` profile only. The HS profile uses `docker compose -f <composePath> --profile <type> up -d <service>` so the container picks up the rendered HS-template's network, volumes, healthcheck, and env-var interpolation (compose/townhouse-hs.yml:199–319).
   - Per-node env vars (`TOWN_SECRET_KEY` / `MILL_SECRET_KEY` / `DVM_SECRET_KEY`, `APEX_EVM_ADDRESS`, `MILL_MNEMONIC`, plus the existing `TOWNHOUSE_WALLET_PASSWORD`) are passed via the subprocess `env` parameter to `execFileAsync`. Compose interpolates `${VAR}` references at up-time. Use `process.env` as the base, layer the new env on top.
   - Constructor invariant: requires `composePath` (already enforced in `DockerOrchestrator` ctor for HS profile).
   - Wraps `this.execFileAsync('docker', ['compose', '-f', composePath, '--profile', type, 'up', '-d', type], {...})` with the same error-surfacing pattern as `upHs()` (lines 374–404). Reuse `surfaceComposeFailure` for stderr classification.

4. **`DockerOrchestrator.stopNodeViaCompose(type: NodeType): Promise<void>`** — symmetric teardown. Runs `docker compose -f <composePath> --profile <type> stop <type>` followed by `rm -f <type>` so the named container is removed and a future `up` re-creates it cleanly. Idempotent: a not-running service must not throw (use the same `'no such service' / 'no containers to remove' / 'No such container'` stderr-match pattern from `downHs()` lines 675–682).

5. **`ConnectorAdminClient.removePeer(peerId: string): Promise<void>`** at `packages/townhouse/src/connector/admin-client.ts`.
   - Maps to `DELETE /admin/peers/:peerId?removeRoutes=true` (connector handler at `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts:826`).
   - Default `removeRoutes=true` matches the desired semantic: tearing down a peer also drops its ILP routes.
   - **Idempotent:** a 404 from the connector (peer already gone) MUST be treated as success. The connector returns `{ error: 'Not found', message: "Peer '<id>' not found" }` — do not surface this as a route-layer failure.
   - All other non-2xx responses throw `Error` so callers can decide whether to retry.
   - Mirror `registerPeer()`'s timeout-safety pattern (clear AbortController timer in `finally`, distinguish AbortError from connection errors).

6. **`waitForHealthy(url: string, timeoutMs: number): Promise<void>`** at `packages/townhouse/src/api/routes/nodes-lifecycle.ts` (route-internal helper, not a public surface).
   - Polls `url` (typically `http://townhouse-hs-<type>:<healthPort>/health` resolved via Docker DNS) until `200 OK` or timeout (60_000 ms default).
   - Poll interval: 1_000 ms (so 60 polls max). Uses `fetch` with a 3_000 ms per-request timeout (mirror `nodes.ts:391` pattern: `AbortController` + `setTimeout` cleared in `finally`).
   - Body content is ignored — only HTTP status matters. The various node health endpoints (Town `TownHealthPayload`, Mill `MillHealthResponse`, DVM `DvmHealthResponse`) all return `{ status: 'ok' | ... }` but parsing them here couples the route to three union shapes for no value.
   - Throws on timeout with a clear message including the URL.

### Image Manifest Reader (NEW utility, small)

Step 2 of the POST pipeline needs the image digest for the requested type. The manifest lives at `~/.townhouse/image-manifest.json` (materialized by `compose-loader.ts:211–217` during `townhouse hs up`).

Add a small typed reader:

- **`packages/townhouse/src/state/image-manifest.ts`** — zod schema mirroring the fixture shape at `packages/townhouse/src/__tests__/fixtures/compose-loader/image-manifest.json`:
  ```ts
  const ImageEntrySchema = z.object({
    name: z.string().min(1),
    tag: z.string().min(1),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }).strict();
  export const ImageManifestSchema = z.object({
    schemaVersion: z.literal(1),
    townhouseVersion: z.string(),
    builtAt: z.string().datetime({ offset: true }),
    images: z.object({
      'townhouse-api': ImageEntrySchema,
      town: ImageEntrySchema,
      mill: ImageEntrySchema,
      dvm: ImageEntrySchema,
      connector: ImageEntrySchema,
    }).strict(),
  }).strict();
  export type ImageManifest = z.infer<typeof ImageManifestSchema>;
  export async function readImageManifest(path: string): Promise<ImageManifest> { /* fs.readFile + JSON.parse + ImageManifestSchema.parse */ }
  ```
- The reader is async and returns the parsed manifest. Caller composes the image ref as `${entry.name}@${entry.digest}` and passes that to `pullImage()`.
- Export `ImageManifest` and `readImageManifest` from `packages/townhouse/src/index.ts` so Epic 47/48 can reuse the same schema.

### Pipeline Step Identifiers (used in error payloads + tests)

The error response shape `{ step, err }` is part of the API contract. Use these EXACT string identifiers across all error paths and tests:

| Step # | Step name (literal) | Failure HTTP | Rollback actions |
|--------|---------------------|--------------|------------------|
| 1 | `'derive-key'` | 500 | none (no state change yet) |
| 2 | `'pull-image'` | 502 | none |
| 3 | `'write-yaml'` | 500 | none |
| 4 | `'start-container'` | 502 | remove yaml entry |
| 5 | `'healthcheck'` | 502 | remove yaml entry + stop container |
| 6 | `'register-peer'` | 502 | remove yaml entry + stop container |

Step 1 failure is 500 (internal — derivation should never fail with a loaded wallet) rather than 502 (which connotes upstream/dependency failure). Step 3 is also 500 because a yaml write failure points at disk problems, not docker/connector. Step 2/4/5/6 are 502 because the failure is in docker daemon or connector subprocess.

### DELETE Pipeline (Reverse Order, Each Step Idempotent)

`DELETE /api/nodes/:id` runs the inverse:

1. **`removePeer(peerId)`** — deregister with connector FIRST. Stop routing TO the peer before stopping the container, so in-flight ILP packets get a "no such peer" 404 rather than a connection-refused. Idempotent: 404 = success.
2. **`stopNodeViaCompose(type)`** — stop + remove the container. Idempotent: not-running = no-op.
3. **`writeNodesYaml`** with the entry filtered out. Idempotent: entry-not-present = no-op (write the same array).

The `:id` route param is matched against `yaml.entries[*].id`. If no match exists, return 404 with `{ error: 'unknown_node', id }`. (Note: this is `id`, not `peerId` — the `id` is the operator-facing handle; the `peerId` is the connector-side identifier. For v1 single-instance-per-type they happen to coincide, but the API contract uses `id`.)

Response on success: `{ id, type }` with HTTP 200. No body content beyond the deleted entry's identity is necessary.

### Single-Instance-per-Type Constraint (v1)

For v1, refuse `POST /api/nodes { type: T }` when `yaml.entries` already contains an entry of type `T`. Return HTTP 409 `{ error: 'node_type_in_use', type, existingId }`. This guard lives at the start of the POST handler, BEFORE step 1.

Rationale (do NOT silently allow multi-instance):
- The HS compose template uses single-container-per-profile (`townhouse-hs-town`, `townhouse-hs-mill`, `townhouse-hs-dvm` at `compose/townhouse-hs.yml:202,244,291`). A second `docker compose --profile mill up -d` would either fail on container-name collision OR re-up the existing container — both are broken semantics.
- The connector POST /admin/peers handler treats matching `id` as re-registration. Two yaml entries with type=mill but different peerIds would race the connector's peer table.
- Multi-instance support is a future story (likely Epic 47+ if/when operators want to run e.g. two mills on different chains). The yaml schema's `derivationIndex` uniqueness constraint already supports it — only the route guard needs to lift.

### Derivation of Response Fields

For each successful POST:

- **`id`** = container suffix in HS mode = `type` for v1 (e.g. `'town'`, `'mill'`, `'dvm'`). Future multi-instance may use `${type}-${derivationIndex}` (e.g. `'mill-1'`).
- **`type`** = request body's `type`.
- **`peerId`** = same as `id` for v1 (the connector's peer.id). Stored in yaml.
- **`ilpAddress`** = `g.townhouse.<type>` — the apex node id is `g.townhouse` (default `DEFAULT_ILP_ADDRESS` at `packages/townhouse/src/connector/config-generator.ts:16`); child peers append their type. Stored in yaml. Passed to `registerPeer({routes: [{prefix: ilpAddress, priority: 0}]})`.
- **`hsRoute`** = the ILP routing prefix registered with the connector = `ilpAddress` for v1. Surfaced separately in the response so future stories (operator-defined routes, multi-prefix peers) can diverge.
- **`healthCheckUrl`** = `http://<containerName>:<healthPort>/health` resolved via Docker DNS — what `waitForHealthy` polled. `containerName = ${CONTAINER_PREFIX}hs-<type>` for the HS-mode compose template (note the `hs-` infix). `healthPort` = `TOWN_HEALTH_PORT (3100)` / `MILL_HEALTH_PORT (3200)` / `DVM_HEALTH_PORT (3400)`.

### Compose Env Var Injection (Step 4 — Critical)

`docker compose up -d --profile <type> <type>` interpolates `${VAR}` from the subprocess env. The HS template references these per-type vars at `compose/townhouse-hs.yml:224,267,309`:

| Type | Required env vars (rendered into container env) |
|------|------------------------------------------------|
| town | `TOWN_SECRET_KEY` (hex), `TOWN_SETTLEMENT_PRIVATE_KEY` (hex, currently same as secret), `APEX_EVM_ADDRESS`, `TOWNHOUSE_UID`, `TOWNHOUSE_WALLET_DIR`, `TOWNHOUSE_WALLET_PASSWORD` |
| mill | `MILL_SECRET_KEY` (hex), `MILL_SETTLEMENT_PRIVATE_KEY` (hex), `MILL_MNEMONIC` (the operator's full mnemonic — `Mill` needs it to derive Solana + Mina keys at runtime), `APEX_EVM_ADDRESS`, `EVM_RPC_URL`, `EVM_CHAIN_ID`, `EVM_USDC_ADDRESS`, `SOLANA_RPC_URL`, `SOLANA_USDC_MINT`, `MILL_RELAYS` (optional), plus the shared `TOWNHOUSE_*` vars |
| dvm | `DVM_SECRET_KEY` (hex), `TURBO_TOKEN` (optional — DVM degrades to stub adapter without it; see `orchestrator.ts:1304`), plus shared vars |

**Inheritance:** the subprocess env MUST start as a copy of `process.env` (don't pass a fresh object — that drops `PATH`, `HOME`, etc. and breaks the docker CLI). Layer the per-node vars on top.

**Mnemonic injection (mill only):** `MILL_MNEMONIC` is the operator's full BIP-39 mnemonic. The host API has this in memory via `WalletManager` (decrypted at `townhouse hs up`). Add a `WalletManager.getMnemonic(): string | null` accessor — returns null if locked, else the cached mnemonic. This is the smallest possible new surface; do NOT add separate mnemonic-export endpoints (the wallet-reveal route already gates that flow on password re-entry).

**Logging guard:** the subprocess env contains secrets. The orchestrator's existing `execFileAsync` wrapper logs stderr/stdout slices on failure — verify those slices cannot leak the env (they shouldn't, but eyeball the failure path before merging).

### Mill Config Provisioning (Step 4 sub-step)

The mill container mounts `~/.townhouse/mill.config.json:/config/mill.config.json:ro` at `compose/townhouse-hs.yml:275`. This file does NOT exist by default — without it, the mill container will fail healthcheck.

When `type === 'mill'`, the POST pipeline MUST write `~/.townhouse/mill.config.json` BETWEEN step 3 (yaml write) and step 4 (container start). Use a minimal v1 default:
```json
{ "swapPairs": [], "chains": ["evm"], "channels": {} }
```
This is an empty mill that registers with the connector but accepts no swap routes — operators add pairs later via a future API (out of scope for this story). Write with mode `0o600` (NFR8). Rollback on step 4/5/6 failure must also remove this file.

Reference fixture for the mill config shape: `docker/dev-fixtures/townhouse-hs-mill.config.json` and `mill-01.config.json`.

### Rollback State Machine (AC #3 — load-bearing)

The state-machine table tests are the single most important test artifact in this story. Write a table-driven test that injects a failure at each transition and asserts the disk + connector state ends byte-identical to the pre-add baseline.

Pre-add baseline:
- `nodes.yaml` exists and has `entries: [/* zero or more entries, but NOT one matching {type, peerId} */]`
- Connector `/admin/peers` returns peers list NOT containing this peer's `id`
- No container named `townhouse-hs-<type>` exists in `docker ps -a`
- (For `mill` only) `~/.townhouse/mill.config.json` does not exist

The table covers each failure-injection point:

| Inject failure at | Steps that ran before failure | Rollback actions required |
|-------------------|------------------------------|---------------------------|
| Step 1 | none | none |
| Step 2 | derive | none |
| Step 3 | derive, pull | none |
| Step 4 | derive, pull, write-yaml, (write-mill-config) | remove yaml entry, remove mill config |
| Step 5 | derive, pull, write-yaml, (write-mill-config), start-container | remove yaml entry, remove mill config, stop+rm container |
| Step 6 | derive, pull, write-yaml, (write-mill-config), start-container, healthcheck-passed | remove yaml entry, remove mill config, stop+rm container |

For each row, run the pipeline with a mock that throws at the specified step; assert disk + connector state matches the baseline. Tests use the existing mock pattern from `nodes.test.ts` (`MockDockerOrchestrator`, `MockWalletManager`, `MockConnectorAdminClient`).

**Rollback failure handling:** if the rollback itself fails (e.g., `removePeer` throws while rolling back step 6), the route handler MUST still return the original step's 502 — the rollback failure is logged to stderr (via `request.log.error`) but not surfaced as a second error. The reconciler on next `hs up` will converge the drift. Document this with a unit test that asserts the response body still contains the ORIGINAL step's identifier, not the rollback step's.

### Route File Layout

Place the lifecycle routes in a NEW file: `packages/townhouse/src/api/routes/nodes-lifecycle.ts`. Do NOT extend `nodes.ts` (the existing file is 729 lines of read-only GET handlers; mixing mutation logic into it bloats review and obscures the strict ordering invariant).

- Export `registerNodeLifecycleRoutes(app, deps)`.
- Register the new function in `packages/townhouse/src/api/server.ts` alongside `registerNodeRoutes`.
- Update `packages/townhouse/src/api/routes/index.ts` to export it (mirrors existing pattern at lines 5–12).
- Use Fastify JSON schema (`additionalProperties: false`) for the `POST` body so unknown keys 400 (mirror `nodes-patch.ts:29-53`).
- DELETE has no body — only `:id` param.

### Concurrency Guard

The pipeline must not interleave with a parallel POST/DELETE for the same type. Reuse the existing `config-mutex` pattern from `packages/townhouse/src/api/config-mutex.ts` (acquired by `nodes-patch.ts`) OR add a new lock — discuss with the test suite which is cleaner. Recommended: a per-route mutex named `nodeLifecycleMutex` so config fee-patches and node-add can run in parallel (they touch disjoint state). Return HTTP 409 `{ error: 'node_lifecycle_in_flight' }` if the mutex is held.

### Logging at Trust Boundaries

Each pipeline step emits a structured log entry via `request.log.info({ event: 'node_lifecycle_step', step, type, peerId }, '...')`. On failure, also emit `request.log.error({ event: 'node_lifecycle_failure', step, err: err.message }, '...')`. NEVER log the mnemonic, secret keys, or `TOWNHOUSE_WALLET_PASSWORD`. The existing pino redact paths at `build-app.ts:60-68` already cover `mnemonic`/`password`/`password_confirm` — verify the new log call sites match those paths (or add new redact paths if you introduce new field names).

### Files This Story Creates

- `packages/townhouse/src/api/routes/nodes-lifecycle.ts` — POST + DELETE handlers, the 6-step pipeline orchestration, rollback state machine, idempotency checks, `waitForHealthy` helper.
- `packages/townhouse/src/api/routes/nodes-lifecycle.test.ts` — table-driven rollback tests, success path tests, idempotency tests, schema rejection tests, 409-on-duplicate-type tests.
- `packages/townhouse/src/state/image-manifest.ts` — zod schema + `readImageManifest(path)`.
- `packages/townhouse/src/state/__tests__/image-manifest.test.ts` — schema validation tests.

### Files This Story Modifies

- `packages/townhouse/src/wallet/manager.ts` — add `deriveNodeKey(type, derivationIndex)` and `getMnemonic()`. `deriveNodeKey` is a pure derivation method (no `state` mutation); reuse the existing `deriveNodeKeys(seed, type)` private helper but parameterize the account index.
- `packages/townhouse/src/docker/orchestrator.ts` — add `pullImage(image)`, `startNodeViaCompose(type, env)`, `stopNodeViaCompose(type)`. Extract `pullImages`' per-image inner loop into a public `pullImage` and reuse it from the existing batch path. The new compose methods are HS-profile-only (throw `OrchestratorError` if called on `dev` profile — match existing constructor invariant style).
- `packages/townhouse/src/connector/admin-client.ts` — add `removePeer(peerId)`. Mirror `registerPeer`'s timeout/abort/finally pattern.
- `packages/townhouse/src/api/server.ts` — register the new lifecycle routes.
- `packages/townhouse/src/api/routes/index.ts` — re-export `registerNodeLifecycleRoutes`.
- `packages/townhouse/src/index.ts` — export `ImageManifest`, `readImageManifest` (already exports `NodesYaml`, `NodesYamlEntry`, etc. from Story 46.1 — match the pattern).

### Files Read but NOT Modified (read fully before touching mutations)

These files are existing UPDATE targets you must understand before changing them:

- **`packages/townhouse/src/docker/orchestrator.ts`** — Read `up()`, `upHs()` (lines 287–417), `pullImages` (920–960), `addNode` (577–584), `removeNode` (590–596), `startNode` (1107–1149), `buildNodeEnv` (1260–1327), `getNodeHealthEndpoint` (737–766). Preserve: HS-profile constructor invariant (`composePath` required), `surfaceComposeFailure` stderr classification, idempotent `downHs`. Do NOT touch the dev-profile path (`upDev`, `startNode`); this story adds parallel HS-profile lifecycle methods, not replacements.
- **`packages/townhouse/src/connector/admin-client.ts`** — Read `registerPeer` (261–314). Mirror its timeout/abort/finally pattern. Preserve: `ws://`/`wss://` URL guard; AbortError-distinguished error messages.
- **`packages/townhouse/src/wallet/manager.ts`** — Read `deriveAllKeys` (175–212), `deriveNodeKeys` (217–246), `getNodeKeys` (111–118). Preserve: seed-zeroing in `finally`; secret-key zero on `lock()`. The new `deriveNodeKey(type, idx)` is a transient, non-state-mutating derivation — it does NOT participate in the wallet `state` lifecycle.
- **`packages/townhouse/src/api/build-app.ts`** — Read the error handler (87–119) and Pino redact paths (60–68). The new route's secret-handling logging MUST match these paths.
- **`packages/townhouse/src/api/server.ts`** — Read full file (85 lines). Append the new route registration alongside the existing ones.
- **`packages/townhouse/src/api/routes/nodes.ts`** — Read `resolveNodeId` (348–360), `getNodeHealthEndpoint` invocations (386–410). Pattern for AbortController + setTimeout + fetch + finally lives there — reuse exactly.

### Previous Story Intelligence (Story 46.1, Done 2026-05-10)

- **Zod field name:** `peerId` (yaml) ↔ `id` (connector `PeerStatus.id`). The reconciler diffs by this mapping — do NOT diverge.
- **Reconciler is non-fatal.** `handleHsUp` catches reconciler errors. This story's failures should ALSO be non-fatal at the `hs up` boot level — they only surface as HTTP errors on the active POST/DELETE request.
- **Test mocks pattern:** `MockDockerOrchestrator`, `MockWalletManager`, `MockConnectorAdminClient` at `packages/townhouse/src/api/routes/nodes.test.ts:15-104`. Extend these for this story rather than rolling new mocks.
- **Public surface exports:** Story 46.1 added `NodesYaml`, `NodesYamlEntry`, `readNodesYaml`, `writeNodesYaml`, `PeerTypeResolver`, `BootReconciler`, `DivergenceAction`, `DivergenceLog`, `NodesYamlSchema` to `packages/townhouse/src/index.ts`. Mirror the pattern when adding `ImageManifest`, `readImageManifest`.
- **Review patches applied (Story 46.1):** schema uses `.strict()`, unique peerId/derivationIndex, ISO-8601 datetime validation, `min(1)` on string fields. Reuse these patterns for the new image-manifest schema.
- **Connector retains routes on re-register:** `routingTable.addRoute()` dedupes by prefix (connector source — `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts:708-719`). Re-registering the same `peerId` is safe.

### Connector Endpoint References (Read Before Writing Tests)

- `POST /admin/peers` — register/re-register. Source: `connector/packages/connector/src/http/admin-api.ts` (existing `registerPeer` client method).
- `DELETE /admin/peers/:peerId?removeRoutes=true` — deregister. Source: `connector/packages/connector/src/http/admin-api.ts:826-884`. Response: `{success, peerId, removedRoutes, message}`. 404 if peer not found.
- `GET /admin/peers` — list peers. Returns `{nodeId, peerCount, connectedCount, peers: PeerStatus[]}`. Used by tests + reconciler.

### Default ILP Apex and Route Prefix Convention

- Apex (connector's own) ILP address: `g.townhouse` (constant `DEFAULT_ILP_ADDRESS` at `packages/townhouse/src/connector/config-generator.ts:16`). The connector config-generator already sets this on apex startup.
- Child peer ILP addresses: `g.townhouse.<type>` — append the type to the apex. (Some test fixtures use `g.toon.*` — that's test-only; production runs at `g.townhouse.*`.)
- Route prefix for `registerPeer` = child's ILP address. The connector routes any ILP packet with this prefix to that BTP peer.
- Future-proofing: if `nodes.yaml`'s `ilpAddress` is already populated for a re-registered peer (reconciler path), use that value verbatim. For new instances created by this story, compute it as `g.townhouse.<type>`.

### Scope Guards — What This Story Does NOT Touch

- **No CLI verbs.** `townhouse node add` / `node remove` / `node list` are Story 46.3.
- **No multi-instance per type.** v1 enforces single-instance-per-type via 409 at POST. Schema already supports multi via `derivationIndex` uniqueness, but route layer rejects.
- **No dev-profile lifecycle changes.** `addNode`/`removeNode` on `DockerOrchestrator` (existing methods used by `nodes-patch.ts`) are the dev-mode flow — leave them alone. This story adds HS-profile-only methods.
- **No reconciler changes.** Story 46.1's reconciler converges on next `hs up`; this story's pipeline never calls it.
- **No operator-defined routes / BTP URLs.** v1 uses convention (route prefix = `g.townhouse.<type>`, BTP URL = `ws://townhouse-hs-<type>:3000`). Operator-defined values are a future story.
- **No mill swap-pair management.** Step-4-sub-step writes an empty `mill.config.json`; populating it (operator-defined swap pairs) is out of scope.
- **No telemetry hooks.** Epic 49's telemetry is separate.
- **No earnings tracking.** Epic 47's earnings aggregator is separate.

## Tasks

- [x] **Task 1: Pre-work — read modified files end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/docker/orchestrator.ts` relevant sections. Public methods: `pullImages`, `upHs`, `downHs`, `healthCheck`, `getNodeHealthEndpoint`, `startNodeViaCompose` (new), `pullImage` (new), `stopNodeViaCompose` (new). HS-only: compose-path methods.
  - [x] 1.2 Read `ConnectorAdminClient.registerPeer` — timeout/abort/finally pattern confirmed. `removePeer` mirrors it.
  - [x] 1.3 Read `WalletManager` end-to-end. Confirmed seed-zeroing in `finally` at `deriveAllKeys`. Added `mnemonic` field to `WalletState`.
  - [x] 1.4 Read `compose/townhouse-hs.yml:199-319`. Env var table confirmed: `TOWN_SECRET_KEY`, `MILL_SECRET_KEY`/`MILL_MNEMONIC`, `DVM_SECRET_KEY` injected; rest inherited from `process.env`.
  - [x] 1.5 Read connector DELETE handler at `admin-api.ts:826-884`. 404 = peer not found (idempotent). `removeRoutes=true` is default.

- [x] **Task 2: Image manifest reader (AC: 1.step-2)**
  - [x] 2.1 Created `packages/townhouse/src/state/image-manifest.ts` with strict zod schema + `readImageManifest`.
  - [x] 2.2 Created `packages/townhouse/src/state/__tests__/image-manifest.test.ts` with 6 cases (all green).
  - [x] 2.3 Added `ImageManifest` and `readImageManifest` to `packages/townhouse/src/index.ts`.
  - [x] 2.4 `pnpm --filter @toon-protocol/townhouse test image-manifest` — 6/6 green.

- [x] **Task 3: WalletManager.deriveNodeKey + getMnemonic (AC: 1.step-1)**
  - [x] 3.1 Refactored `deriveNodeKeys(seed, type, accountIndex?)` — optional `accountIndex` param. Existing `deriveAllKeys` flow unchanged.
  - [x] 3.2 Added `async deriveNodeKey(type, derivationIndex)` — re-derives from mnemonic in state; mill also derives Solana+Mina. Throws if locked.
  - [x] 3.3 Extended `WalletState` to hold `mnemonic: string`. Confirmed no JSON.stringify of WalletState. Added `getMnemonic(): string | null`.
  - [x] 3.4 Added 7 new unit tests at `manager.test.ts` (identity invariant, different index = different keys, locked throws, mill Solana/Mina, getMnemonic lifecycle).
  - [x] 3.5 `pnpm --filter @toon-protocol/townhouse test manager` — 30/30 green.

- [x] **Task 4: DockerOrchestrator HS lifecycle methods (AC: 1.step-2, 1.step-4, 6)**
  - [x] 4.1 Added `pullImage(image)` — extracts per-image loop from `pullImages`; `pullImages` delegates to it. Added `env` field to `RunDockerOptions` and `runDockerCompose` for subprocess env override.
  - [x] 4.2 Added `startNodeViaCompose(type, env)` — HS-only, env layered on `process.env`, mirrors `upHs` error handling.
  - [x] 4.3 Added `stopNodeViaCompose(type)` — HS-only, stop then rm, idempotent stderr patterns from `downHs`.
  - [x] 4.4 Added 9 unit tests to `orchestrator.test.ts` (skip-if-exists, pull new, OrchestratorError wrap, dev-profile throws, compose args+env, stop+rm args, no-such-container swallow).
  - [x] 4.5 `pnpm --filter @toon-protocol/townhouse test orchestrator` — 89/89 green (all 3 orchestrator test files).

- [x] **Task 5: ConnectorAdminClient.removePeer (AC: 6)**
  - [x] 5.1 Added `removePeer(peerId)` — mirrors `registerPeer` timeout/abort/finally. 404 = idempotent success. Empty peerId throws before network.
  - [x] 5.2 Added 6 unit tests to `admin-client.test.ts` (200 resolves, 404 resolves, 500 throws, timeout, ECONNREFUSED, empty peerId early throw).
  - [x] 5.3 `pnpm --filter @toon-protocol/townhouse test admin-client` — 24/24 green.

- [x] **Task 6: Route file — `nodes-lifecycle.ts` (AC: 1, 2, 4, 5, 6, 7)**
  - [x] 6.1 Created `packages/townhouse/src/api/routes/nodes-lifecycle.ts`. YAML-FIRST block comment on POST handler. `waitForHealthy` internal helper. `nodeLifecycleMutex` added to `config-mutex.ts`.
  - [x] 6.2 `POST /api/nodes` — full 6-step pipeline with rollback state machine. Step 3b mill config. Pino structured logging at each step. Redact-safe (no secrets in log calls).
  - [x] 6.3 `DELETE /api/nodes/:id` — reverse pipeline. Each step idempotent. Mill config removed on mill teardown.
  - [x] 6.4 Registered in `server.ts` + exported from `routes/index.ts`.

- [x] **Task 7: Route tests — `nodes-lifecycle.test.ts` (AC: 1, 2, 3, 4, 5, 6, 7)**
  - [x] 7.1-7.9 All implemented: success path (town/mill/dvm), per-step failure injection with rollback assertions, mill config rollback, idempotency, schema rejection, concurrency guard, DELETE success, rollback-failure-during-rollback. `fetch` stubbed globally for health checks.
  - [x] 7.10 `pnpm --filter @toon-protocol/townhouse test nodes-lifecycle` — 27/27 green.

- [x] **Task 8: Integration with existing server.test.ts (AC: 1, 6)**
  - [x] 8.1 Existing `server.test.ts` passes with new lifecycle routes registered.
  - [x] 8.2 `pnpm --filter @toon-protocol/townhouse test server` — 10/10 green.

- [x] **Task 9: Full test pass + build (AC: all)**
  - [x] 9.1 897/908 tests pass (11 pre-existing failures in `logs.test.ts`+`earnings.test.ts` — confirmed pre-existing via `git stash` baseline check). Zero regressions introduced.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse build` — clean build, no type errors.
  - [x] 9.3 Lint clean (0 new errors; 1 pre-existing error in `nodes-yaml.ts:41` from Story 46.1).
  - [x] 9.4 Sprint status updated to `review`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-11)

### Debug Log References

- Healthcheck failure test requires 60 s timeout (actual `waitForHealthy` loop); vitest test timeout set to 70 s.
- `WalletState` mnemonic field: confirmed no `JSON.stringify` paths before adding field (grepped entire src tree).
- `fetch` stubbed globally in tests (`vi.stubGlobal`) so `waitForHealthy` doesn't make real network calls.
- 11 pre-existing failures in `logs.test.ts` + `earnings.test.ts` confirmed via `git stash` baseline check (not introduced by this story).
- ESLint error `no-non-null-assertion` at `nodes-yaml.ts:41` is pre-existing from Story 46.1.

### Completion Notes List

- YAML-FIRST ordering invariant enforced and documented with block comment in `POST /api/nodes` handler.
- `nodeLifecycleMutex` added to `config-mutex.ts` alongside existing `configMutex` — they serialize disjoint state (lifecycle vs. config patch), so they can run in parallel.
- `APEX_EVM_ADDRESS` env var derived from `wallet.getNodeKeys('town').evmAddress` (account 0 = primary operator address). Compose template uses `${APEX_EVM_ADDRESS:-}` (empty default) so this is best-effort.
- `RunDockerOptions.env` field added to support subprocess env override; backward-compatible (optional, undefined = inherits process.env via spawn default).
- Mill config written as `{ swapPairs: [], chains: ['evm'], channels: {} }` (minimal empty config as specified).
- Rollback on failure logs to `request.log.error` but never surfaces as a second error — original step response always returned.

### File List

**Created:**
- `packages/townhouse/src/state/image-manifest.ts`
- `packages/townhouse/src/state/__tests__/image-manifest.test.ts`
- `packages/townhouse/src/api/routes/nodes-lifecycle.ts`
- `packages/townhouse/src/api/routes/nodes-lifecycle.test.ts`

**Modified:**
- `packages/townhouse/src/wallet/types.ts` — added `mnemonic: string` to `WalletState`
- `packages/townhouse/src/wallet/manager.ts` — added `deriveNodeKey`, `getMnemonic`; refactored `deriveNodeKeys` to accept optional `accountIndex`
- `packages/townhouse/src/docker/orchestrator.ts` — added `pullImage`, `startNodeViaCompose`, `stopNodeViaCompose`; added `env` field to `RunDockerOptions`
- `packages/townhouse/src/connector/admin-client.ts` — added `removePeer`
- `packages/townhouse/src/api/config-mutex.ts` — added `nodeLifecycleMutex` (acquire/release/reset)
- `packages/townhouse/src/api/server.ts` — registered `registerNodeLifecycleRoutes`
- `packages/townhouse/src/api/routes/index.ts` — exported `registerNodeLifecycleRoutes`
- `packages/townhouse/src/index.ts` — exported `ImageManifest`, `readImageManifest`, `ImageManifestSchema`
- `packages/townhouse/src/wallet/manager.test.ts` — added 7 new tests for `deriveNodeKey` + `getMnemonic`
- `packages/townhouse/src/docker/orchestrator.test.ts` — added 9 new tests for `pullImage`, `startNodeViaCompose`, `stopNodeViaCompose`
- `packages/townhouse/src/connector/admin-client.test.ts` — added 6 new tests for `removePeer`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status → review

### Review Findings

Code review run: 2026-05-11 (claude-opus-4-7[1m], bmad-code-review skill, 3 parallel reviewers: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

**Triage summary:** 5 decision-needed, 12 patch, 24 deferred, 7 dismissed (raw findings de-duplicated from ~50 across layers).

#### Decisions resolved (2026-05-11)

- [x] D1 → **keep new DELETE step identifiers (`'deregister-peer'`/`'stop-container'`/`'remove-yaml'`); spec § Pipeline Step Identifiers table to be extended in a follow-up edit to cover DELETE.** No code change. Rationale: asymmetric names carry triage information (operator can distinguish POST vs DELETE failure at a glance).
- [x] D2 → **keep yaml-first rollback order.** No code change. Rationale: spec rollback-actions column lists yaml-removal first; failure semantics favor yaml-first (orphaned container is benign, orphaned yaml is reconciler-noisy); secrets-in-env exposure window is milliseconds and the secrets are already on disk in the wallet.
- [x] D3 → **promoted to patch P13** (re-read yaml inside rollback, filter only our entry). Rationale: cheap defense-in-depth, more faithful to AC #3 "byte-identical to pre-add state" under any external-mutation scenario.
- [x] D4 → **deferred to Story 46.3** (CLI verbs naturally surface the `enabled`-flag-vs-lifecycle question). Add `TODO(46.3)` comment at the POST route head (patch P14). Deferred entry tracked in `deferred-work.md`.
- [x] D5 → **keep `'write-yaml'` step identifier for mill-config write failure.** No code change. Rationale: preserves the 6-literal spec contract; `err` text already names `mill.config.json` for disambiguation.

#### Patches applied (2026-05-11)

- [x] [Review][Patch] P1 — DELETE `remove-yaml` now returns HTTP 500 (disk-class). [`nodes-lifecycle.ts` DELETE step 3]
- [x] [Review][Patch] P2 — Pino redact paths extended in `build-app.ts` to cover `nostrSecretKey`, `evmPrivateKey`, `TOWN_SECRET_KEY`, `MILL_SECRET_KEY`, `DVM_SECRET_KEY`, `TOWN_SETTLEMENT_PRIVATE_KEY`, `MILL_SETTLEMENT_PRIVATE_KEY`, `DVM_SETTLEMENT_PRIVATE_KEY`, `MILL_MNEMONIC`, `TOWNHOUSE_WALLET_PASSWORD`.
- [x] [Review][Patch] P3 — Added `fs.chmod(dirname(millConfigPath), 0o700)` after recursive mkdir so existing parent dirs are hardened. [`nodes-lifecycle.ts` step 3b]
- [x] [Review][Patch] P4 — Capture `mnemonicSnapshot` once after step 1 succeeds; fail-fast with 500 `step:'derive-key'` if it returns null at snapshot time. `apexEvmAddress` empty-string fallback removed. [`nodes-lifecycle.ts` step 1 post-condition]
- [x] [Review][Patch] P5 — Added `sanitizeErrorMessage` (route side) and `redactSecretsInComposeStderr` (orchestrator side). Both strip known secret-name env assignments (`*_KEY=…`, `MILL_MNEMONIC=…`, `*_PASSWORD=…`) from stderr before it lands in `err.message`/response body.
- [x] [Review][Patch] P6 — Rollback helpers now return a `string | undefined`; route surfaces the merged `rollbackError` field in every step-failure response body when rollback throws. `combineRollbackErrors` collapses multiple rollback failures into one string. Doc comment in the helper block updated to reflect new behavior.
- [x] [Review][Patch] P7 — DELETE `/api/nodes/:id` now declares a params JSON schema: `{ id: { minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$' } }`. Tests assert 400 for over-length, uppercase, and whitespace-injected ids.
- [x] [Review][Patch] P8 — Mill chain-key derivation catch block now emits `console.warn` with the underlying error message (and accountIndex context) instead of silently swallowing. [`wallet/manager.ts deriveNodeKey`]
- [x] [Review][Patch] P9 — Renamed misleading test to "throws when wallet has never been initialized"; added a NEW test "throws when wallet is locked after being initialized" that actually calls `lock()` first.
- [x] [Review][Patch] P10 — New test asserts that calling `deriveNodeKey` after `lock()` throws the same `/not initialized/i` error class (negative path for the lock contract).
- [x] [Review][Patch] P11 — Both `stop` and `rm` failure branches of `stopNodeViaCompose` now wrap raw errors in `OrchestratorError` (with `exitCode`, sanitized `stderr`, and `cause`), matching `startNodeViaCompose` shape.
- [x] [Review][Patch] P12 — New test `returns 500 step:remove-yaml when removePeer is idempotent-404 but writeNodesYaml fails (P1+P12)` exercises the step-3 DELETE error path with a chmod-induced EACCES on the home dir.
- [x] [Review][Patch] P13 (from D3) — `safeRollbackYaml` rewritten to re-read `nodes.yaml` inside the helper and filter out only the entry added by this request (by `peerId`). External edits during the healthcheck window survive rollback. All four call sites updated.
- [x] [Review][Patch] P14 (from D4) — `TODO(46.3): decide whether config.nodes[type].enabled gates lifecycle provisioning` comment added at the POST handler head.

**Verification:**
- `pnpm --filter @toon-protocol/townhouse build` — clean, no type errors.
- `pnpm --filter @toon-protocol/townhouse test` — 905/916 passing. 11 pre-existing failures in `logs.test.ts` + `earnings.test.ts` only (same set documented in Dev Agent Record). Zero regressions introduced.
- `pnpm exec eslint` on modified files — 0 errors, 4 pre-existing warnings (non-null assertions in `manager.test.ts` unrelated to this patch).

#### Deferred (pre-existing or out-of-scope; tracked separately)

- [x] [Review][Defer] DF1 — `getMnemonic()` public plaintext accessor returns live string reference [wallet/manager.ts:226-228] — deferred, spec-mandated v1 surface
- [x] [Review][Defer] DF2 — `registerPeer` called with empty `authToken: ''` [nodes-lifecycle.ts:370] — deferred, v1 in-network convention
- [x] [Review][Defer] DF3 — Brittle compose-stderr regex matching in idempotent stop [orchestrator.ts:613-616] — deferred, mirrors existing `downHs` pattern
- [x] [Review][Defer] DF4 — Per-process mutex; no flock against multi-process race [config-mutex.ts:18-23] — deferred, v1 single-process constraint
- [x] [Review][Defer] DF5 — Mutex blocks all lifecycle ops globally for up to 4 min [config-mutex.ts:39-50] — deferred, per-type granularity is forward work
- [x] [Review][Defer] DF6 — `removePeer` doesn't inspect response body for `success:false` shape [admin-client.ts:329-379] — deferred, 2xx=removed per connector contract
- [x] [Review][Defer] DF7 — Atomic `.tmp` orphan on ENOSPC during yaml write [nodes-yaml.ts:97-112] — deferred, pre-existing in Story 46.1
- [x] [Review][Defer] DF8 — `waitForHealthy` URL not validated; malformed URL would poll forever [nodes-lifecycle.ts:67-88] — deferred, URL is constructed from constants not user input
- [x] [Review][Defer] DF9 — Mnemonic-in-heap window after `lock()` for previously-captured refs — deferred, spec accepts trade-off
- [x] [Review][Defer] DF10 — `surfaceComposeFailure` regex pattern misses some container-name shapes [orchestrator.ts:430-460] — deferred, existing pattern
- [x] [Review][Defer] DF11 — Healthcheck URL only resolves via Docker DNS [nodes-lifecycle.ts:176] — deferred, by design (API runs in `townhouse-hs-net`)
- [x] [Review][Defer] DF12 — Re-register of same id may dup routes if priorities differ [nodes-lifecycle.ts:371] — deferred, connector spec dedupes by prefix
- [x] [Review][Defer] DF13 — `removePeer` non-AbortError body-read failures lose `cause` [admin-client.ts:218-233] — deferred, error-message polish
- [x] [Review][Defer] DF14 — `pullImage` re-pulls digest-form ref when only tag-form is locally cached [orchestrator.ts:500-518] — deferred, performance not correctness
- [x] [Review][Defer] DF15 — `runDockerCompose` `env: {}` would drop PATH/HOME for future callers [orchestrator.ts:462-474] — deferred, no current caller does this
- [x] [Review][Defer] DF16 — `enabledAt` timestamp uses local clock without NTP-skew documentation [nodes-lifecycle.ts:229] — deferred, not 46.2-specific
- [x] [Review][Defer] DF17 — 409 `node_lifecycle_in_flight` lacks retry-after / in-flight detail [nodes-lifecycle.ts:146-150] — deferred, UX polish
- [x] [Review][Defer] DF18 — EACCES on mill.config.json write lacks operator guidance [nodes-lifecycle.ts:270-283] — deferred, polish
- [x] [Review][Defer] DF19 — Mutex acquire pattern is sync test-and-set; future maintainer could leak by inserting between acquire and try [nodes-lifecycle.ts:146-152] — deferred, structurally safe today
- [x] [Review][Defer] DF20 — Mill happy-path route test uses mock wallet that always returns FAKE_KEYS; real Solana/Mina derivation never exercised end-to-end [nodes-lifecycle.test.ts:142-152] — deferred, integration test gap
- [x] [Review][Defer] DF21 — Healthcheck timeout test does not use fake timers; cannot assert AbortController cleanup per iteration [nodes-lifecycle.test.ts:430-453] — deferred, test polish
- [x] [Review][Defer] DF22 — Rollback tests don't assert absence of `.tmp` files in homeDir — deferred, test polish
- [x] [Review][Defer] DF23 — No regression test guarding mutex-leak-on-throw-between-acquire-and-try — deferred, refactor (with DF19)
- [x] [Review][Defer] DF24 — `id = peerId = type` v1 invariant — forward-compat trap when multi-instance lands [nodes-lifecycle.ts:170-172] — deferred, comment-documented

#### Dismissed (false positive / noise)

- Blind Hunter "blocker" on healthcheck DNS resolution from host — false positive: `townhouse-api` runs inside `townhouse-hs-net` (`compose/townhouse-hs.yml:144`), Docker DNS resolves correctly. Hunter lacked project context.
- dvm `buildNodeEnv` omits APEX_EVM_ADDRESS — spec table doesn't require it for dvm; other shared vars inherit via `process.env`.
- `waitForHealthy` deadline + REQUEST_TIMEOUT_MS can overshoot by ~4 s — within tolerance; spec doesn't promise exact-60.
- `mill.config.json` overwrites prior file silently — that IS the documented v1 behavior; rollback removes it on failure.
- 409 echoes `existing.id` (info disclosure) — localhost-only API; non-issue.
- JSON indent style inconsistency between yaml writer and mill config writer — style, not bug.
- `fs.rm` during stop-cleanup race on bind-mounted file — benign on Linux.

## Change Log

- 2026-05-11: Story implemented by claude-sonnet-4-6. POST /api/nodes 6-step pipeline + rollback state machine + DELETE /api/nodes/:id reverse pipeline. New files: `nodes-lifecycle.ts`, `image-manifest.ts` + tests. New methods: `WalletManager.deriveNodeKey`/`getMnemonic`, `DockerOrchestrator.pullImage`/`startNodeViaCompose`/`stopNodeViaCompose`, `ConnectorAdminClient.removePeer`. 55 new tests; 0 regressions.

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section
- [ ] Does this story contain regex or template substitution logic? The compose-stderr classification in `stopNodeViaCompose` is regex-driven — at least one unit test MUST use a real-world `docker compose rm` stderr string (capture a sample from local docker output, not a synthetic one)
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? If yes, those tests must be un-gated and run before marking this story done, OR have a comment: `// Gate: <condition>. Run before marking story done.`
- [ ] Verify the yaml-first ordering invariant is documented in code comments at `nodes-lifecycle.ts` (block comment on the POST handler) so future maintainers cannot accidentally flip it during a refactor
- [ ] Verify Pino redact paths cover any new field names introduced by the lifecycle routes (mnemonic, secret keys, settlement keys) — extend `build-app.ts:60-68` if needed
- [ ] Update sprint-status to `done` (with PR number in trailing comment)
