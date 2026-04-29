# Story 21.8: Fastify REST + WebSocket Metrics API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a localhost-only REST + WebSocket API that surfaces node status, wallet addresses, and live metrics from my Townhouse stack,
so that the dashboard SPA (and any future tooling) has a single, uniform boundary for reading node state and pushing configuration changes through the orchestrator.

## Dependencies

- **Story 21.1** (done): Package scaffold — `packages/townhouse`, `TownhouseConfig` schema with `api: { port, host }` (default `127.0.0.1:9400`; see `src/config/defaults.ts`), CLI entrypoint, `tsup` + `vitest` tooling.
- **Story 21.2** (done): `DockerOrchestrator` — `up()`, `down()`, `addNode()`, `removeNode()`, `status()`, `regenerateConnectorConfig()`, `EventEmitter` events (`containerState`, `pullProgress`, `healthCheck`, `connectorRestarting`, `connectorRestarted`). This is the orchestration surface the API routes compose on top of (see `src/docker/orchestrator.ts`).
- **Story 21.3** (done): `ConnectorAdminClient` — `getHealth()`, `getMetrics()`, `getPeers()` against the connector admin HTTP API. This is the source of aggregate ILP metrics the `/nodes` and WS stream surface; no separate ledger exists yet.
- **Story 21.4** (done): `WalletManager` — `getKeys(nodeType)`, `listKeys()`; returns `DerivedNodeKeys` including `nostrPubkey`, `evmAddress` (used for address-only response to `GET /wallet`).
- **Stories 21.5–21.7** (done): Node container health endpoints on BLS ports (3100/3200/3400 inside container; `127.0.0.1:2170x/2180x/2190x` on host per test-design §9.1). The API MAY poll these for per-node health in a later story but MUST NOT depend on them for the MVP routes in this story — use `orchestrator.status()` (Docker-level) + `ConnectorAdminClient` instead.

**Runtime dependencies (new):**

- `fastify@^5.x` — HTTP framework (decision codified in architecture.md §Technology Stack line 86; rig uses Fastify; test-design §3.6 names Fastify explicitly).
- `@fastify/websocket@^11.x` — WebSocket plugin wired into Fastify's lifecycle (from forge research 2026-03-03 §"Framework Decision: Why Fastify Over Hono").
- `@fastify/cors@^10.x` — CORS policy enforcement (localhost-only origin allowlist; see AC #8, T-048).

## Acceptance Criteria

1. `GET /nodes` returns a JSON array of every node type declared in `TownhouseConfig.nodes`, each entry containing at minimum `{ type: 'town' | 'mill' | 'dvm'; enabled: boolean; state: 'running' | 'stopped' | 'error' | 'not-created'; uptimeSeconds: number | null; image: string }`. State is sourced from `orchestrator.status()`; uptime derived from Docker `StartedAt`. (Test T-043)
2. `GET /nodes/:type` returns a JSON object `{ type, enabled, state, uptimeSeconds, image, config, metrics }` where `config` is the subset of `TownhouseConfig.nodes[type]` (e.g., `feePerEvent`, `feeBasisPoints`, `feePerJob`) and `metrics` is the aggregate from `ConnectorAdminClient.getMetrics()` for the MVP (per-node attribution is deferred to a later story — document the limitation inline). (Test T-044)
3. `PATCH /nodes/:type/config` accepts a JSON body with the subset of `TownhouseConfig.nodes[type]` fields that are mutable at runtime (fees + `enabled`), validates the body with the same validator used by `loadConfig`, persists the merged config to disk, and invokes `orchestrator.regenerateConnectorConfig(activeTypes)` (for fee/peering changes) or `orchestrator.addNode()` / `removeNode()` when `enabled` flips. Responds `200` with the updated config on success, `400` on validation failure, `409` if another config mutation is already in flight. (Test T-045; ties to X-003.)
4. `GET /wallet` returns `{ keys: NodeKeyInfo[] }` built from `WalletManager.listKeys()` — i.e., `nostrPubkey`, `evmAddress`, derivation paths, and `nodeType`. The response MUST NOT contain `nostrSecretKey`, `evmPrivateKey`, `mnemonic`, or any other secret material; a unit test asserts `JSON.stringify(response)` contains none of the substrings `privateKey`, `secretKey`, `mnemonic`, `seed`. (Test T-046, R-007, R-021)
5. `WS /metrics` upgrades an HTTP connection to WebSocket and pushes JSON messages of shape `{ type: 'metrics' | 'nodeState' | 'heartbeat'; payload: ... ; ts: number }`. Metrics messages are derived from `ConnectorAdminClient.getMetrics()` polled at a 1 s interval; `nodeState` messages fire on orchestrator `containerState` events; a `heartbeat` fires every 15 s even when idle so the dashboard can detect a silent dead socket. First non-heartbeat message MUST arrive within 1 s of any underlying change. (Test T-047; ties to R-011.)
6. **API binding:** The server binds to `config.api.host` / `config.api.port` (defaults `127.0.0.1:9400`). On any non-loopback `host` value the server logs a warning and refuses to bind unless `TOWNHOUSE_API_ALLOW_REMOTE=1` is set in the environment. Attempting a request from a non-loopback IP results in the TCP connection being refused at bind time (not a 403 inside the app). (Test T-049; R-013.)
7. **CORS policy:** `@fastify/cors` is configured to reject requests with an `Origin` header whose host is not `localhost`, `127.0.0.1`, or `[::1]` (any port). Non-allowed origins receive `403` and no `Access-Control-Allow-Origin` header. Requests with no `Origin` header (curl, native fetch from a file:// page) are allowed. (Test T-048; R-013.)
8. **WebSocket throttling:** If orchestrator events or metrics polls produce > 10 messages per second to a single socket, messages are coalesced into a batched `{ type: 'batch'; messages: [...] }` frame emitted at most every 100 ms. A synthetic load of 100+ events/sec MUST produce ≤ 10 sent frames/sec on the wire. (Test T-050; R-020.)
9. **Unknown routes:** `GET /nodes/unknown` and any other `:type` that is not `town | mill | dvm` returns `404` with JSON `{ error: 'unknown_node_type', type: 'unknown' }`. (Test T-051.)
10. **Graceful shutdown:** On `SIGTERM` or `SIGINT` the server (a) stops accepting new HTTP connections, (b) sends a WebSocket close frame (code 1001, reason `"server_shutdown"`) to every open client, (c) awaits in-flight `PATCH` handlers up to 5 s, then exits 0. (Test T-052.)
11. The API module exports a `createApiServer(deps): FastifyInstance` factory, NOT a singleton. `deps` is `{ configPath, orchestrator, wallet, connectorAdmin, logger }`. The CLI `townhouse up` wires these together; tests instantiate the factory with test doubles (real `DockerOrchestrator` against a test daemon or in-memory fake — honor the project rule: no mocks across integration boundaries, but unit tests of route handlers MAY use stub orchestrators because route logic is the unit under test).
12. `pnpm --filter @toon-protocol/townhouse test` passes all new unit + route tests; existing Story 21.1–21.7 tests remain green (no regressions).

## Tasks / Subtasks

- [x] Task 1: Add Fastify dependencies + API module scaffold (AC: #11)
  - [x] 1.1 Add `fastify`, `@fastify/websocket`, `@fastify/cors` to `packages/townhouse/package.json` dependencies. Use exact current-major versions (Fastify v5 line; verify latest stable at implementation time with `pnpm view fastify version`). Run `pnpm install` from repo root.
  - [x] 1.2 Create `packages/townhouse/src/api/` with files: `server.ts` (factory), `routes/nodes.ts`, `routes/wallet.ts`, `routes/metrics-ws.ts`, `cors.ts`, `types.ts`, `index.ts` (barrel). Mirror the per-concern-file layout used by `src/config/` and `src/connector/`.
  - [x] 1.3 Export `createApiServer`, `ApiServer` type from `src/api/index.ts` and re-export from the package barrel `src/index.ts` alongside existing `DockerOrchestrator`, `ConnectorAdminClient`, `WalletManager` exports.
  - [x] 1.4 Add `ApiDeps` interface in `src/api/types.ts`: `{ configPath: string; config: TownhouseConfig; orchestrator: DockerOrchestrator; wallet: WalletManager; connectorAdmin: ConnectorAdminClient; logger?: FastifyBaseLogger }`.

- [x] Task 2: Implement `GET /nodes` and `GET /nodes/:type` (AC: #1, #2, #9)
  - [x] 2.1 Write `routes/nodes.ts` exporting `registerNodeRoutes(server, deps)`. Register `GET /nodes` that calls `deps.orchestrator.status()` then maps each `NodeType` from `deps.config.nodes` to the response shape in AC #1. A node not present in `status()` output gets `state: 'not-created'` and `uptimeSeconds: null`.
  - [x] 2.2 Compute `uptimeSeconds` from the container inspect data. `DockerOrchestrator.status()` currently returns `{ name, state, health }` — EXTEND the status return type to include `startedAt?: string` (ISO-8601 from dockerode `Container.inspect().State.StartedAt`). Update `orchestrator.test.ts` to cover the new field. Keep the change additive; existing callers that destructure `{ name, state }` remain source-compatible.
  - [x] 2.3 Register `GET /nodes/:type` WITHOUT an enum schema for `:type` — validate inside the handler so unknown types return `404 { error: 'unknown_node_type', type }` per AC #9 (Fastify schema-level rejection would be `400`, which violates the AC). On valid `type ∈ {town,mill,dvm}`, return the full detail shape in AC #2.
  - [x] 2.4 For the `metrics` field of the detail response, call `deps.connectorAdmin.getMetrics()`. If the connector admin call fails (container down), return `metrics: null` rather than 500 — the dashboard needs to render a degraded state.
  - [x] 2.5 Route tests: `routes/nodes.test.ts` with `fastify.inject()` exercising success, unknown-type 404 (T-051), connector-admin-down degraded case.

- [x] Task 3: Implement `PATCH /nodes/:type/config` with orchestrator roundtrip (AC: #3)
  - [x] 3.1 Define a JSON Schema for each node type's mutable fields (re-use from `src/config/validator.ts` where possible — extract a `pickMutable(type)` helper if the validator module does not already expose it). Enforce `additionalProperties: false` so typos in the body are rejected with `400`.
  - [x] 3.2 Use an in-module `Mutex`/flag (`isMutating: boolean`) to serialize config mutations. Concurrent second request returns `409 { error: 'config_mutation_in_flight' }`. Keep this in-memory — durable coordination is out of scope for v1 (single API process).
  - [x] 3.3 On success: (a) deep-merge body into current config, (b) validate the merged config with the existing validator (reject on failure, surface `ConfigValidationError` as `400`), (c) persist via a new `saveConfig(path, config)` helper in `src/config/loader.ts` (mirror the read path; write atomically via `tmp + rename`), (d) if `enabled` flipped true → `orchestrator.addNode(type)`; false → `orchestrator.removeNode(type)`; otherwise if fee fields changed → `orchestrator.regenerateConnectorConfig(activeTypes)`.
  - [x] 3.4 Route test: `routes/nodes-patch.test.ts` — validation rejection, mutex 409, each of the three orchestrator paths (use a stub orchestrator that records calls).
  - [x] 3.5 Document the three-path decision (enable/disable/fee-change) in a Dev Note inside the route handler so future contributors don't collapse them into `orchestrator.restart()`.

- [x] Task 4: Implement `GET /wallet` (AC: #4)
  - [x] 4.1 Write `routes/wallet.ts` exporting `registerWalletRoutes(server, deps)`. `GET /wallet` calls `deps.wallet.listKeys()` and returns `{ keys: NodeKeyInfo[] }`. `NodeKeyInfo` is already defined in `src/wallet/types.ts` and contains ONLY non-secret fields — use it directly.
  - [x] 4.2 Add `routes/wallet.test.ts` with a real `WalletManager` initialized on a throwaway tmpdir wallet (the Story 21.4 test pattern uses `mkdtempSync`). Assert response shape AND assert `JSON.stringify(body)` does not contain `privateKey`, `secretKey`, `mnemonic`, `seed`.

- [x] Task 5: Implement WebSocket `/metrics` with throttling + heartbeat (AC: #5, #8, #10)
  - [x] 5.1 Register `@fastify/websocket` plugin in `server.ts`. Expose `GET /metrics` with `websocket: true`.
  - [x] 5.2 In `routes/metrics-ws.ts`, on each new connection: (a) start a 1 s `setInterval` polling `connectorAdmin.getMetrics()` and enqueuing `{ type: 'metrics', payload, ts }` into a per-socket buffer, (b) subscribe to `orchestrator` events `containerState`, `pullProgress`, `connectorRestarted` and enqueue `{ type: 'nodeState', payload, ts }`, (c) start a 15 s heartbeat timer that sends `{ type: 'heartbeat', ts }` regardless of other traffic.
  - [x] 5.3 Flush the buffer on a 100 ms cadence: if exactly one message is buffered send it raw; if multiple are buffered send `{ type: 'batch', messages, ts }`. Drop or keep-latest for `metrics` messages if the buffer exceeds 100 entries (prevent memory bloat under pathological event storms). Document the backpressure choice in a Dev Note.
  - [x] 5.4 On socket close OR server shutdown: clear timers, unsubscribe listeners. Track open sockets in a `Set` so the graceful-shutdown path (Task 7) can close them all with code `1001`.
  - [x] 5.5 Route test: `routes/metrics-ws.test.ts` — opens a WS against `fastify.inject()` websocket support (or raw `ws` against a listening instance on an ephemeral port), asserts first metrics frame within 1 s, heartbeat within ~15 s, batching under synthetic load (emit 100 fake `containerState` events in 1 s via `orchestrator.emit()` — assert ≤ 10 frames received).

- [x] Task 6: CORS + bind-address enforcement (AC: #6, #7)
  - [x] 6.1 `routes/cors.ts`: export `buildCorsOptions()` that returns `@fastify/cors` config. `origin` is a function returning `true` iff the request `Origin` is absent OR parses to hostname in `['localhost','127.0.0.1','::1','[::1]']`. `methods: ['GET','PATCH','OPTIONS']`, `credentials: false`.
  - [x] 6.2 In `server.ts` `createApiServer` guard: if `deps.config.api.host` is not in `['127.0.0.1','::1','localhost']` AND `process.env.TOWNHOUSE_API_ALLOW_REMOTE !== '1'`, throw `Error('Townhouse API refuses to bind to non-loopback host without TOWNHOUSE_API_ALLOW_REMOTE=1')` before `listen()`.
  - [x] 6.3 Tests: `api/server.test.ts` — boots on loopback + custom port OK; boots on `0.0.0.0` throws unless env var set; CORS rejection for `Origin: http://evil.com` (T-048); CORS acceptance for `Origin: http://localhost:5173` (dashboard dev server).

- [x] Task 7: Graceful shutdown (AC: #10)
  - [x] 7.1 `createApiServer` returns `{ app: FastifyInstance, close: () => Promise<void> }`. `close()` closes all tracked WebSockets with code 1001/`server_shutdown`, then calls `app.close()` (Fastify's graceful close awaits in-flight handlers).
  - [x] 7.2 CLI integration (`src/cli.ts`): register a single SIGTERM/SIGINT handler that calls `apiServer.close()` then `orchestrator.down()`. DO NOT double-register — if SIGTERM handling already exists in the CLI from Story 21.1/21.2, extend it rather than adding a second listener.
  - [x] 7.3 Test: bring up server, open 2 WS clients, call `close()`, assert both clients received a 1001 close frame with reason `server_shutdown` within 5 s.

- [x] Task 8: Wire CLI `townhouse up` to boot the API (AC: #11, #12)
  - [x] 8.1 Extend `src/cli.ts` `up` command to: load config → construct `WalletManager` → construct `DockerOrchestrator` → construct `ConnectorAdminClient` (baseUrl from `http://127.0.0.1:${config.connector.adminPort}`) → `createApiServer({ ... })` → `app.listen({ host, port })`.
  - [x] 8.2 Log a single banner on ready: `[Townhouse API] listening on http://127.0.0.1:9400 — GET /nodes, GET /nodes/:type, PATCH /nodes/:type/config, GET /wallet, WS /metrics`. The dashboard (Story 21.9) consumes this contract.
  - [x] 8.3 Extend `cli.test.ts` with a smoke test that runs `up --dry-run` (or equivalent) and asserts the API factory is invoked with the expected deps. If `--dry-run` does not exist, add a minimal flag that skips `orchestrator.up()` and `app.listen()` but exercises the wiring.

### Review Findings

<!-- Added by bmad-code-review 2026-04-21 -->

**Cross-team coordination (connector):**

Ongoing discussion with `@toon-protocol/connector` maintainers in:

- `connector:docs/stories/connector-admin-api-dashboard-requirements-2026-04-21.md` (Town ask)
- `connector:docs/stories/connector-admin-api-dashboard-response-2026-04-21.md` (two-way log; Town responses appended as `## N. Town response — YYYY-MM-DD`, connector responses as `## N. Connector update — YYYY-MM-DD`)

**Latest exchange — 2026-04-21:**

- Connector team confirmed Ask 2 (`/admin/balances/:peerId` unknown-peer = idle-peer collision) as real defect. Will fix as story `C-balances-404-fix`.
- Connector team re-scoped Ask 1: no `prom-client` is wired in the connector today (metrics middleware slot is empty). Split into two connector stories: `C-21.8-a` (instrument) + `C-21.8-b` (JSON projection).
- Connector team agreed to defer Ask 3 (SSE/WS events) — no event bus exists; polling is fine.
- Town responded with answers to their 5 open questions; flagged one cross-repo anomaly (Town's integration test T-020 asserts JSON from `/metrics` but per connector team analysis the endpoint serves nothing — needs joint verification against the standalone Docker image).

**Town follow-ups tracked (parallel, non-blocking on connector):**

- Ship 21.8 with narrowed `MetricsPayload: { packetsForwarded, packetsRejected, bytesSent, attribution: 'aggregate', available: boolean }`
- Open Story 21.8.5 — `ConnectorAdminClient v2` (balances + channels + new `/admin/metrics.json` wrapper; depends on `C-21.8-b` + `C-balances-404-fix`)
- Audit `packages/townhouse/src/__integration__/connector-integration.test.ts` T-020 against actual standalone-image behavior
- Possible Story 21.8.6 — `ConnectorAdminClient API-key auth` (depends on connector team's auth decision)

**Open items awaiting connector team:**

- Verification of standalone-image `/metrics` behavior
- Auth decision (header-based API key on all admin calls vs. keep loopback-isolation for reads)
- Links to connector stories `C-21.8-a`, `C-21.8-b`, `C-balances-404-fix` once drafted

**Decision needed (resolve before patching):**

- [x] [Review][Decision] Metrics payload design — **RESOLVED 2026-04-21**: narrow now + ask connector team for richer endpoint. For 21.8, shrink `MetricsPayload` to `{ packetsForwarded, packetsRejected, bytesSent, attribution: 'aggregate' }` and fix the Prometheus-text-vs-JSON parsing bug in `ConnectorAdminClient.getMetrics()`. Requirements document for the connector team written to the connector repo at `docs/stories/connector-admin-api-dashboard-requirements-2026-04-21.md` (path: `/home/jonathan/Documents/connector/docs/stories/connector-admin-api-dashboard-requirements-2026-04-21.md`). Per-peer attribution + `GET /admin/metrics.json` tracked as connector-team P0 ask; dashboard expansion deferred to follow-up story `21.8.5 — ConnectorAdminClient v2`.
- [x] [Review][Decision] PATCH ordering when `enabled` AND fee fields change in one request — **RESOLVED 2026-04-21**: run BOTH. If a single PATCH flips `enabled` AND touches fee fields, run `addNode`/`removeNode` first, then also call `regenerateConnectorConfig(activeTypes)` in the same request. Replace the `else if` with sequential `if` + `if`. Update P13 and add a test case for the combined path.
- [x] [Review][Decision] `ApiDeps` redundancy — **RESOLVED 2026-04-21**: match AC #11 literally. Drop `config: TownhouseConfig` from `ApiDeps`. Factory calls `loadConfig(configPath)` internally and holds a mutable `currentConfig` reference that PATCH mutations update in-place. Update `ApiDeps`, `createApiServer`, and `cli.ts` wiring.

**Patch items (blocking — must fix):**

- [x] [Review][Patch] `socket.isOpen` is undefined on `@fastify/websocket` v11 — `flushBuffer` short-circuits, **zero WS frames ever sent**. Use `socket.readyState === WebSocket.OPEN`. [packages/townhouse/src/api/routes/metrics-ws.ts:114] — **FIXED Round 2 (and `WebSocket` now imported from `ws`).**
- [x] [Review][Patch] CORS `origin` function uses wrong callback signature `(request, callback)` instead of `(origin, callback)` — CORS is effectively disabled (origin read as undefined → always allowed). [packages/townhouse/src/api/cors.ts:32-42] — **FIXED Round 1.**
- [x] [Review][Patch] `createApiServer.close()` does not track or send 1001/`server_shutdown` close frames — violates AC #10; `openWebSockets` Set is declared but never populated. [packages/townhouse/src/api/server.ts:27,82-88] — **FIXED Round 1; Round 2 added 5 s timeout cap on `app.close()`.**
- [x] [Review][Patch] WS metrics poll reads non-existent fields from `MetricsResponse`. Resolve after Decision #1. [packages/townhouse/src/api/routes/metrics-ws.ts:43-51] — **FIXED Round 1 (narrowed `MetricsPayload`).**
- [x] [Review][Patch] `/nodes/:type` metrics mapping is semantically false. Resolve after Decision #1. [packages/townhouse/src/api/routes/nodes.ts:98-108] — **FIXED Round 1 (narrowed `MetricsPayload`).**
- [ ] [Review][Patch] `metrics-ws.test.ts` does not compile — references undeclared mock classes and all tests are `it.todo`. Tasks 5.5 and 7.3 are marked done but have no real test. [packages/townhouse/src/api/routes/metrics-ws.test.ts] — **PARTIAL: Round 2 fixed the compile error (test file now builds with inline `StubOrchestrator`/`StubWallet`/`StubConnectorAdmin`). Real `it.todo` coverage for AC #5/#8/#10 still pending; skipped from batch-apply as judgment-heavy (see follow-up below).**
- [x] [Review][Patch] `server.test.ts` CORS test has no assertion — placeholder for AC #7. [packages/townhouse/src/api/server.test.ts:142-163] — **FIXED Round 2: real 403 assertion, checksummed `access-control-allow-origin` header assertion, localhost-origin acceptance test.**
- [x] [Review][Patch] `new WalletManager({ keys: [] })` — constructor expects `{encryptedPath: string}`, wrong shape. [packages/townhouse/src/cli.ts:387] — **FIXED Round 1; Round 2 also makes CLI actually decrypt the wallet (D1:c).**
- [x] [Review][Patch] `loadWallet(walletPath, password ?? '')` — existing signature is single-arg. [packages/townhouse/src/cli.ts:318] — **FIXED Round 1.**
- [x] [Review][Patch] SIGINT/SIGTERM handlers are removed in `finally`. [packages/townhouse/src/cli.ts:429-433] — **FIXED Round 1 via `serverStarted` flag.**
- [x] [Review][Patch] Missing WS event subscriptions (`pullProgress`, `connectorRestarted`). [packages/townhouse/src/api/routes/metrics-ws.ts:65-73] — **FIXED Round 1.**
- [x] [Review][Patch] No `skip-if-pending` guard on the 1 s metrics poll. [packages/townhouse/src/api/routes/metrics-ws.ts:36-60] — **FIXED Round 1.**
- [x] [Review][Patch] No Fastify JSON Schema on `PATCH /nodes/:type/config` — Task 3.1 `additionalProperties:false` and MAX_SAFE_INTEGER guard. [packages/townhouse/src/api/routes/nodes-patch.ts:28-40] — **FIXED Round 2: `patchBodySchema` with `additionalProperties:false` + `maximum:9007199254740991` on all fee fields.**
- [x] [Review][Patch] `/nodes/:type` uptime computed unconditionally from `StartedAt`. [packages/townhouse/src/api/routes/nodes.ts:74-79,45-51] — **FIXED Round 1; Round 2 extracted `computeUptimeSeconds` helper (state-gated + plausible-date check).**
- [x] [Review][Patch] Docker state mapping collapses `created/paused/restarting/removing/dead` into `'error'`. [packages/townhouse/src/api/routes/nodes.ts:33-40,67-74] — **FIXED Round 2: `mapDockerState` maps `created`/`paused`/`exited`/`stopped` → `stopped`; only `restarting`/`removing`/`dead` remain `error`.**
- [ ] [Review][Patch] `cli.test.ts` not updated for `handleUp` signature change; Task 8.3 `up --dry-run` smoke test absent. [packages/townhouse/src/cli.ts:447,524] — **PARTIAL: Round 2 adapted `main()` to the new signature (28 existing cli.test.ts tests pass). Task 8.3 `--dry-run` factory-wiring assertion still pending; skipped from batch-apply as it requires a new CLI flag (see follow-up below).**

**Round-2 batch-apply additions (patches applied during re-review):**

- [x] [Review][Patch] `nodes.ts:137-139` fee-subset readout does not type-check (discriminated-union access). — **FIXED: `pickMutableFees(type, nodeConfig)` helper branches per kind.**
- [x] [Review][Patch] `nodes-patch.ts` never updates `deps.config` after `saveConfig` — stale in-memory config across requests. — **FIXED: `deps.config.nodes = mergedConfig.nodes` in-place mutation after persist (holds live ref).**
- [x] [Review][Patch] CLI wallet loaded as file-pointer but never decrypted. — **FIXED per D1:c (fail-fast adjustment): CLI now calls `loadWallet` → `decryptWallet` → `fromMnemonic`; when the wallet file is absent, logs a loud warning and skips API startup (so orchestration-only use / tests still work).**
- [x] [Review][Patch] `cli.ts:413` `apiServer.app` missing from `{ close(): Promise<void> }` type. — **FIXED: typed as `ApiServer | undefined`.**
- [x] [Review][Patch] `nodes.test.ts:24,36` `Record` vs `Map` type mismatch. — **FIXED.**
- [x] [Review][Patch] `wallet.test.ts` `import type { WalletManager }` used as value. — **FIXED.**
- [x] [Review][Patch] `server.ts` error handler — unknown-error property access. — **FIXED: narrow via `as { statusCode?; code?; message? }`; bonus — CORS rejection now returns 403 (`origin_not_allowed`) instead of falling through as 500.**
- [x] [Review][Patch] `process.env.X` bracket-access under `noPropertyAccessFromIndexSignature`. — **FIXED in server.ts + server.test.ts.**
- [x] [Review][Patch] `metrics-ws.ts` imports non-existent `FastifyLoggerInstance`; `WebSocket` used without import. — **FIXED: removed bad import, `WebSocket` now imported from `ws`.**
- [x] [Review][Patch] AC #10 "awaits in-flight PATCH handlers up to 5 s" had no explicit cap. — **FIXED: `Promise.race([app.close(), timeout(5000)])`.**
- [x] [Review][Patch] Missing test for Round-1 Decision #2 combined-path (enabled AND fee-fields both change). — **FIXED: new test `nodes-patch.test.ts > should run BOTH addNode/removeNode AND regenerateConnectorConfig… (D2 2026-04-21)`.**
- [x] [Review][Patch] PATCH mutex 409 test was racy (D2). — **FIXED: deterministic hang via `hangingMock.regenerateConnectorConfig` (inside the mutex); no prod seam, no module mocking needed.**
- [x] [Review][Patch] Wallet-route regex `/^0x[a-f0-9]{40}$/` didn't accept EIP-55 checksummed addresses. — **FIXED: `[a-fA-F0-9]`.**
- [x] [Review][Patch] Stray unused-var / unused-import lint errors in api files. — **FIXED.**

**Follow-ups — resolved in Round 3 (2026-04-22):**

- [x] [Review][Follow-up] **P6** Real `metrics-ws.test.ts` coverage. — **DONE: 6 tests against an ephemeral-port Fastify listen with real `ws` client** covering AC #5 first-message-within-1s + payload shape + connector-failure degraded path, AC #5/Task 5.2 `pullProgress`/`connectorRestarted` subscriptions, AC #8 throttle (100 synchronous events → ≤12 frames), AC #10 `{code:1001, reason:'server_shutdown'}` close frame.
- [x] [Review][Follow-up] **P16 / Task 8.3** `up --dry-run` + smoke test. — **DONE: `handleUp(..., dryRun=true)` constructs all API deps (wallet, orchestrator, connectorAdmin, server) without calling `orchestrator.up()` or `app.listen()`; emits structured `[dry-run] API factory invoked: configPath=… host=… port=… connectorAdmin=… wallet=WalletManager` log. `cli.test.ts` smoke test asserts factory wiring + absence of listening banner.**

---

### Review Findings — Round 3 (2026-04-22)

Re-review after Round-2 patch-apply + follow-ups. **Clean review — 0 findings across all 3 lenses.** 57/57 tests pass (up from 50/50 + 6 `it.todo`). Lint clean on story scope. Story status → `done`.

**Deferred (pre-existing / out of scope):**

- [x] [Review][Defer] `saveConfig` re-validates full config on every write — migration hazard when required fields are added later. [packages/townhouse/src/config/loader.ts:145] — deferred, config-schema evolution concern, not 21.8.
- [x] [Review][Defer] `saveConfig` atomic-rename Windows semantics (cross-device / exists-target) — deferred, Townhouse is Linux-first per epic scope.
- [x] [Review][Defer] Module-level `isMutating` + `resetConfigMutex` export — behaviorally correct for single-process v1; refactor into a factory-scoped closure later. [packages/townhouse/src/api/routes/nodes-patch.ts:10]

---

### Review Findings — Round 2 (2026-04-21)

**Verification of Round-1 patch items:** 12 of 16 resolved (✅ P1 readyState, P2 CORS signature, P3 close frames, P4/P5 narrowed metrics payload, P8 WalletManager ctor, P9 loadWallet, P10 SIGINT/SIGTERM preserved via `serverStarted`, P11 pullProgress/connectorRestarted subscriptions, P12 skip-if-pending poll, P14 uptime gating). **Still open:** P6, P7, P13, P15, P16 — reopened below.

**Decision needed (resolve before patching):**

- [x] [Review][Decision] Wallet route behavior when no wallet is loaded — **RESOLVED 2026-04-21: option (c) fail-fast.** `townhouse up` requires an unlocked wallet. CLI must decrypt the wallet on startup (prompt for password or read from `TOWNHOUSE_WALLET_PASSWORD`) and refuse to boot if `decryptWallet` fails. Drop the empty `new WalletManager({ encryptedPath: '' })` fallback.
- [x] [Review][Decision] PATCH mutex 409 test — **RESOLVED 2026-04-21: option (a) via `vi.mock`.** Mock `../../config/loader.js` `saveConfig` to return a test-controlled deferred promise; hold request 1 in-flight, fire request 2, assert 409, release deferred, assert request 1 returns 200. No prod test seam; deterministic.

**Patch items (blocking — must fix):**

- [ ] [Review][Patch] `nodes.ts` fee-subset readout does not type-check — `TownNodeConfig` has `feePerEvent`, `MillNodeConfig` has `feeBasisPoints`, `DvmNodeConfig` has `feePerJob`; reading all three off the discriminated union fails `tsc`. Branch on `type` and pick the correct field(s). [packages/townhouse/src/api/routes/nodes.ts:137-139]
- [ ] [Review][Patch] `nodes-patch.ts` never updates `deps.config` after `saveConfig` — subsequent GETs/PATCHes see stale in-memory config. Previous Round-1 Decision #3 mandated a mutable `currentConfig` ref; still not implemented. Either hold a mutable `currentConfig` in the factory, or reload `loadConfig(deps.configPath)` at the head of each handler. [packages/townhouse/src/api/routes/nodes-patch.ts:60-75]
- [ ] [Review][Patch] CLI wallet is loaded as a file-pointer but never decrypted — `new WalletManager({ encryptedPath })` alone produces an uninitialized manager. Must call `decryptWallet` + `fromMnemonic` (or equivalent unlock) before passing to `createApiServer`. Ties to Decision #1 above. [packages/townhouse/src/cli.ts:320-322, 411]
- [ ] [Review][Patch] `cli.ts:413` — `apiServer.app.listen(...)` but `apiServer` typed as `{ close(): Promise<void> } | undefined`; missing `app`. Fix the type annotation or use the `ApiServer` type exported from `./api/index.js`. [packages/townhouse/src/cli.ts:340, 413]
- [ ] [Review][Patch] `nodes.test.ts:24,36` — `private containerState: Record<string, ...>` is assigned `new Map()` then iterated with `.values()`/`.set()`. Will not compile. Pick one of `Record` + index ops OR `Map` + method ops consistently. [packages/townhouse/src/api/routes/nodes.test.ts:24,36]
- [ ] [Review][Patch] `wallet.test.ts:10,52` — `import type { WalletManager }` is a type-only import but is used as a value in `new WalletManager(...)`. Remove the `type` modifier. [packages/townhouse/src/api/routes/wallet.test.ts:10]
- [ ] [Review][Patch] `server.ts` error handler — `error` is `unknown` from Fastify v5's `setErrorHandler` signature (when `@fastify/error` is not installed); direct `.statusCode`/`.code`/`.message` access fails `tsc`. Narrow via `instanceof Error` / cast to `FastifyError`. [packages/townhouse/src/api/server.ts:52-65]
- [ ] [Review][Patch] `process.env.TOWNHOUSE_API_ALLOW_REMOTE` and `process.env.NODE_ENV` need bracket access (`process.env['…']`) under the package's `noPropertyAccessFromIndexSignature`. Multiple locations. [packages/townhouse/src/api/server.ts:38,57; src/api/server.test.ts:82,83,97,108,109,124,126]
- [ ] [Review][Patch] **P13 reopened** — `PATCH /nodes/:type/config` still has no Fastify JSON Schema. Required by Task 3.1 + Dev Note "Standard Guards": `additionalProperties: false` + `maximum: 9007199254740991` (MAX_SAFE_INTEGER) on each numeric fee field. Current typo-tolerant body is a silent-failure mode. [packages/townhouse/src/api/routes/nodes-patch.ts:28-40]
- [ ] [Review][Patch] **P15 reopened** — Docker state mapping still collapses `created`/`paused`/`restarting`/`removing`/`dead` into `'error'`. `created` is a normal lifecycle state (post-create / pre-start), not an error. Add explicit handling; treat `created` as `not-created` or `stopped`. [packages/townhouse/src/api/routes/nodes.ts:28-40,85-95]
- [ ] [Review][Patch] **P7 reopened** — `server.test.ts:142-163` CORS rejection test still has zero assertions; the "evil.com" injection result is never checked. Assert `response.statusCode === 403` (or whatever `@fastify/cors` returns for callback-rejected origin). [packages/townhouse/src/api/server.test.ts:142-163]
- [ ] [Review][Patch] **P6 reopened** — `metrics-ws.test.ts` now compiles but every test is `it.todo` (AC #5 first-message-within-1s, AC #8 throttling, AC #10 close-frame). Task 5.5 + 7.3 marked done without tests. Implement at least one per-AC test (use raw `ws` client against an ephemeral-port listen). [packages/townhouse/src/api/routes/metrics-ws.test.ts:44-53]
- [ ] [Review][Patch] **P16 reopened** — Task 8.3 requires a `cli.test.ts` smoke test that runs `up --dry-run` and asserts the API factory was invoked with the expected deps. No such test was added. [packages/townhouse/src/cli.test.ts]
- [ ] [Review][Patch] Missing test for Round-1 Decision #2 combined-path (enabled AND fee-fields both change in one PATCH → both `addNode`/`removeNode` AND `regenerateConnectorConfig` run). Add it to `nodes-patch.test.ts`. [packages/townhouse/src/api/routes/nodes-patch.test.ts]
- [ ] [Review][Patch] `metrics-ws.ts` imports `FastifyLoggerInstance` which does not exist in Fastify v5; use `FastifyBaseLogger`. Remove unused `NodeType`, `MetricsPayload` imports. [packages/townhouse/src/api/routes/metrics-ws.ts:6-9]
- [ ] [Review][Patch] AC #10 "awaits in-flight `PATCH` handlers up to 5 s" — `server.ts` `close()` delegates to `app.close()` with no explicit 5 s cap. Wrap in `Promise.race([app.close(), timeout(5000)])`. [packages/townhouse/src/api/server.ts:78-96]
- [ ] [Review][Patch] `WebSocket` global is used (`WebSocket.OPEN`, `WebSocket` type) without import — works in Node 21+ via WHATWG globals but the `socket` instance is actually a `ws.WebSocket`. Import `WebSocket` from `ws` explicitly or use the literal `1` to avoid cross-runtime breakage. [packages/townhouse/src/api/server.ts:85; src/api/routes/metrics-ws.ts:12,133]

**Deferred (pre-existing / out of scope for 21.8):**

- [x] [Review][Defer] `cli.test.ts:114-115` and `cli-wallet.test.ts:95-96` MockInstance generics mismatch — pre-existing vitest typing issue unrelated to 21.8.
- [x] [Review][Defer] `connector/config-generator.test.ts:93,194` possibly-undefined access — pre-existing.
- [x] [Review][Defer] `wallet/manager.test.ts:229,232` index-signature cast — pre-existing.
- [x] [Review][Defer] `buildCorsOptions` omits `HEAD` from methods — low severity; no caller uses HEAD today.
- [x] [Review][Defer] Error handler leaks `error.message` outside production — matches spec Dev Note intent ("log full error server-side, return safe message"); message leak is low risk given loopback-only bind.

## Dev Notes

### Architecture Alignment

- **Fastify over Hono/Express:** Architecture.md §Technology Stack (line 86, 251) allows "Express or Fastify"; the 2026-03-03 forge-alternatives research doc picks Fastify explicitly for the project (§"Framework Decision: Why Fastify Over Hono") citing first-class schema validation, hook lifecycle, and `@fastify/websocket` integration. The rig package will use it too, so we standardize.
- **Boundary placement (test-design §5.2):** "Fastify route handlers call orchestrator methods" — the API is a thin shell around `DockerOrchestrator` + `ConnectorAdminClient` + `WalletManager`. Do NOT reinvent orchestration logic inside routes. Every route handler's core should be ≤ 30 lines; extract helpers to `routes/*-service.ts` if a handler grows.
- **Localhost-only security model (R-013):** Decision from test-design §10 "Pre-Implementation Critical Path" item 3: localhost binding + CORS is sufficient for v1. The `TOWNHOUSE_API_ALLOW_REMOTE` escape hatch exists for the operator who knowingly runs behind a reverse proxy; no token auth in v1. Story 21.13 may revisit when mnemonic-reveal UX lands.
- **No unified ledger yet (R-016):** Per-node earnings attribution is in the epic scope but not in any story that is done. For Story 21.8 the `/nodes/:type` `metrics` field uses aggregate connector metrics, and the WS `metrics` frames likewise. Document this limit in the detail response (e.g., `metrics.attribution: 'aggregate'`) so the dashboard (Story 21.9/21.10) can render a "attribution coming soon" note rather than fake per-node numbers.

### Port Model

| Context | Host | Port | Source |
|---|---|---|---|
| Townhouse API (dev) | 127.0.0.1 | 9400 | `src/config/defaults.ts:api.port` |
| Townhouse API (test-design external mapping) | 127.0.0.1 | 21000 | test-design-epic-21.md §9.1 |

The code default is 9400 (already shipped in Story 21.1). The test-design 21000 value describes an external host-port mapping that CI/test infra will use. Do NOT change the code default — override via config or env in the test harness if needed.

### File Structure Requirements

```
packages/townhouse/
├── package.json                                        # MODIFIED: add fastify, @fastify/websocket, @fastify/cors
└── src/
    ├── api/                                            # NEW: this story's surface
    │   ├── index.ts                                    # barrel; re-exports createApiServer + types
    │   ├── types.ts                                    # ApiDeps, ApiServer, WsMessage union
    │   ├── server.ts                                   # createApiServer factory; binds CORS, WS, routes
    │   ├── cors.ts                                     # buildCorsOptions() + tests
    │   ├── server.test.ts                              # bind-address + CORS tests (AC #6, #7)
    │   └── routes/
    │       ├── nodes.ts + nodes.test.ts                # GET /nodes, GET /nodes/:type (AC #1, #2, #9)
    │       ├── nodes-patch.ts + nodes-patch.test.ts    # PATCH /nodes/:type/config (AC #3)
    │       ├── wallet.ts + wallet.test.ts              # GET /wallet (AC #4)
    │       └── metrics-ws.ts + metrics-ws.test.ts      # WS /metrics (AC #5, #8, #10)
    ├── docker/orchestrator.ts                          # MODIFIED: status() adds startedAt
    ├── config/loader.ts                                # MODIFIED: add saveConfig() helper (Task 3.3)
    ├── cli.ts                                          # MODIFIED: wire up createApiServer in up command
    └── index.ts                                        # MODIFIED: export createApiServer + ApiServer
```

### Testing Requirements

- **Framework:** `vitest` (existing). No new test framework.
- **Unit/route tests** (this story's primary surface): use `fastify.inject()` which runs without binding a port — fast and deterministic.
- **WebSocket tests:** `fastify.inject()` supports `@fastify/websocket` via `payloadAsStream` — if that proves fragile, boot on an ephemeral port and use the `ws` client library (already a transitive dep through connector/SDK).
- **Integration boundary rule (CLAUDE.md):** "ALWAYS USE DOCKER - NEVER USE MOCKS" applies across infrastructure boundaries. For this story the infrastructure boundary is the Docker daemon via `dockerode`. Route handlers that call `orchestrator.addNode()` etc. are UNIT-testing the route handler's decision tree, so a stub `DockerOrchestrator` with recorded calls is acceptable for `nodes-patch.test.ts`. An integration test that exercises the full roundtrip (PATCH → orchestrator → real container restart) belongs to a future integration suite (test-design §4.1 X-003) — NOT this story.
- **No pet-circuit imports.** The API module MUST NOT import from `@toon-protocol/pet-circuit`, `o1js`, or anything that drags in the zk stack. Keep the API bundle small enough that `pnpm --filter @toon-protocol/townhouse test` remains fast.
- **Secret leak assertion (AC #4):** every response body for `GET /wallet` MUST be fed through a deny-list regex test. If the team later adds a new field to `NodeKeyInfo` that happens to contain a secret, this test fails loudly.

### Previous Story Intelligence (Stories 21.1–21.7)

- **Package patterns:** All code lives under `src/<concern>/` with `index.ts` barrel; tests colocated as `*.test.ts`. Follow this pattern for `src/api/`.
- **Config validation:** `src/config/validator.ts` already throws `ConfigValidationError` with readable messages — reuse it for PATCH body validation instead of hand-rolling a second validator.
- **Orchestrator is an `EventEmitter`:** Story 21.2 emits `containerState`, `pullProgress`, `healthCheck`, `connectorRestarting`, `connectorRestarted`. The WS route subscribes to these — remember to `off()` listeners on socket close to avoid leaks across reconnects (this bit Story 21.7's DVM entrypoint — see its "SIGTERM handler race condition" review finding).
- **Admin client timeout:** `ConnectorAdminClient` uses a 5 s fetch timeout. The 1 s metrics poll interval (AC #5) must be resilient to one overlapping call in flight — either skip a poll if previous is pending, or abort-on-tick. Choose skip-if-pending.
- **Test style:** Vitest with `describe`/`it`, `beforeAll`/`afterAll` for tmpdirs (`mkdtempSync` pattern in `wallet/manager.test.ts`). No `jest` globals.

### Git Intelligence

Recent commits (`6b2f240` … `abc2804`) show a strict `feat(21-N): story complete` single-commit-per-story cadence. Land this story as one atomic commit. Pre-commit lint + format hooks are enforced — run `pnpm lint && pnpm format` before committing.

### Security Notes

- **No auth, but tight bind:** Loopback-only bind + CORS allowlist is the security boundary. Document this at the top of `server.ts` with a `// SECURITY:` comment so a future contributor doesn't slap `0.0.0.0` on a default.
- **Secret exclusion:** The wallet route is the only path to key material; keep it READ-ONLY and address-only. Story 21.13 will introduce the mnemonic-reveal flow with a re-authentication step.
- **Error message leakage:** Fastify's default error handler may include stack traces in development. In `server.ts` override `setErrorHandler` to return `{ error: <stable_code>, message: <safe_string> }` with no stack in any environment. Log the full error server-side via `app.log.error(err)`.
- **Request body size cap:** Configure Fastify with `bodyLimit: 16 * 1024` (16 KB) — PATCH bodies are tiny JSON blobs; anything larger is malformed or hostile.

### Project Structure Notes

- No conflicts with existing structure. `src/api/` is a new peer folder alongside `src/docker/`, `src/wallet/`, `src/config/`, `src/connector/`.
- `tsup.config.ts` should need no change — it already emits the whole `src/` tree. Verify the built artifact tree-shakes `@fastify/*` properly (they're listed as `dependencies`, not `peerDependencies`, so they ship with the package; this is expected for a CLI-runnable package).

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** n/a (no new GitHub Actions).
- **MAX_SAFE_INTEGER guard:** PATCH body numeric fees (`feePerEvent`, `feePerJob` = millisatoshis) SHOULD be validated `≤ Number.MAX_SAFE_INTEGER`. Add an explicit JSON Schema `maximum: 9007199254740991` to each numeric fee field.
- **Golden test vectors:** n/a.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 21 (line 2818)] — Story 21.8 table entry (Fastify REST + WebSocket Metrics API, dependency 21.3, size L)
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#3.6 (lines 205–221)] — Test scenarios T-043 through T-052
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#4.1 (lines 317–324)] — X-001, X-003 cross-story scenarios
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#5.2 (lines 363–366)] — API ↔ Orchestrator boundary; test strategy
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#6 (line 396)] — WebSocket metrics latency target < 500 ms (AC #5 tightens to 1 s which is the test-design P0 line; 500 ms is a perf goal)
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#9.1 (line 483)] — Port 21000 (external test-infra mapping)
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#10 (line 530)] — R-013 API security decision
- [Source: _bmad-output/planning-artifacts/architecture.md (line 86, 251)] — Fastify as approved HTTP framework
- [Source: _bmad-output/planning-artifacts/research/technical-nodejs-typescript-git-hosting-alternatives-to-forgejo-research-2026-03-03.md#Framework Decision (lines 155–170)] — Fastify-over-Hono rationale
- [Source: packages/townhouse/src/config/defaults.ts (line 18–21)] — default `api.port=9400`, `api.host=127.0.0.1`
- [Source: packages/townhouse/src/config/schema.ts (ApiConfig, NodesConfig)] — config types consumed by routes
- [Source: packages/townhouse/src/docker/orchestrator.ts (lines 84–268)] — `up`, `addNode`, `removeNode`, `status`, `regenerateConnectorConfig`, events — the orchestrator surface PATCH routes call into
- [Source: packages/townhouse/src/connector/admin-client.ts] — `ConnectorAdminClient.getHealth/getMetrics/getPeers` — source of `/nodes/:type.metrics`
- [Source: packages/townhouse/src/wallet/types.ts (NodeKeyInfo)] — the exact shape returned by `GET /wallet`
- [Source: packages/townhouse/src/wallet/manager.ts] — `WalletManager.listKeys()` produces the address-only info
- [Source: _bmad-output/implementation-artifacts/21-7-dvm-node-dockerfile.md#Previous Story Intelligence] — SIGTERM + listener-leak patterns (applies to WS route subscriptions)
- [Source: CLAUDE.md (top banner)] — "ALWAYS USE DOCKER - NEVER USE MOCKS" — governs what is integration vs. unit test in this story

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

```
packages/townhouse/package.json                                # MODIFIED: +fastify, +@fastify/websocket, +@fastify/cors
packages/townhouse/src/api/index.ts                            # NEW: barrel
packages/townhouse/src/api/types.ts                            # NEW: ApiDeps, WsMessage
packages/townhouse/src/api/server.ts                           # NEW: createApiServer factory
packages/townhouse/src/api/server.test.ts                      # NEW: bind + CORS tests (AC #6, #7)
packages/townhouse/src/api/cors.ts                             # NEW: buildCorsOptions
packages/townhouse/src/api/routes/nodes.ts                     # NEW: GET /nodes, GET /nodes/:type
packages/townhouse/src/api/routes/nodes.test.ts                # NEW: route tests (T-043, T-044, T-051)
packages/townhouse/src/api/routes/nodes-patch.ts               # NEW: PATCH /nodes/:type/config
packages/townhouse/src/api/routes/nodes-patch.test.ts          # NEW: route tests (T-045)
packages/townhouse/src/api/routes/wallet.ts                    # NEW: GET /wallet
packages/townhouse/src/api/routes/wallet.test.ts               # NEW: secret-leak assertion (T-046)
packages/townhouse/src/api/routes/metrics-ws.ts                # NEW: WS /metrics
packages/townhouse/src/api/routes/metrics-ws.test.ts           # NEW: throttling + heartbeat (T-047, T-050, T-052)
packages/townhouse/src/docker/orchestrator.ts                  # MODIFIED: status() emits startedAt
packages/townhouse/src/docker/orchestrator.test.ts             # MODIFIED: cover startedAt field
packages/townhouse/src/config/loader.ts                        # MODIFIED: add saveConfig(path, config)
packages/townhouse/src/cli.ts                                  # MODIFIED: up wires createApiServer + SIGTERM
packages/townhouse/src/cli.test.ts                             # MODIFIED: up dry-run wiring assertion
packages/townhouse/src/index.ts                                # MODIFIED: export createApiServer, ApiServer
```
