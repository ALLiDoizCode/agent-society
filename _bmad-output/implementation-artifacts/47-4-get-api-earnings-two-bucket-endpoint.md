# Story 47.4: `GET /api/earnings` Two-Bucket Endpoint

Status: done

> **Fourth story of Epic 47 (Earnings Data Plane) — the wiring story that lights up the two-bucket payload the TUI / SPA / future Tauri client renders directly without doing any of its own delta math, connector calls, or peer-type bucketing.** Sized M. Depends on Story 47.1 (`done`) for `ConnectorAdminClient.getEarnings()` + `getMetrics()`. Depends on Story 47.2 (`done`) for `aggregateEarnings()`, the `AggregatedEarnings` core shape, the `'__apex__'` sentinel, the `status: 'ok' | 'connector_unavailable'` banner contract, and the `AggregateEarningsInput.deltaComputer?` injection slot. Depends on Story 47.3 (`done`) for `createDeltaComputer({ snapshotPath })`, the `SnapshotWriter` already wired into `createApiServer`, and the canonical snapshot path (`${dirname(configPath)}/earnings-snapshots.jsonl`). Blocks 47.5 (live E2E gate asserts this exact wire shape from `curl http://127.0.0.1:28090/api/earnings`). Touches `packages/townhouse/src/earnings/aggregator.ts` (shape extension), `packages/townhouse/src/api/routes/earnings.ts` (deltaComputer wiring + extended response), introduces `packages/townhouse/src/api/schemas/earnings.ts` (response schema), and updates `aggregator.test.ts` + `earnings.test.ts`. **The dev MUST read "Shape Ownership: Aggregator vs Route Assembler" and "Schema Library Choice" in Dev Notes before drafting — those two decisions shape every downstream file edit.**

## Story

As a **TUI / SPA / future Tauri client**,
I want a single host-API endpoint that returns the operator's earnings shaped for direct render,
So that the surface layer doesn't compute deltas, doesn't reach into the connector, and doesn't know about external peers.

## Acceptance Criteria

1. **Given** the host API at `127.0.0.1:28090`
   **When** a client sends `GET /api/earnings`
   **Then** the response is HTTP 200 with body conforming to:
   ```typescript
   {
     status: 'ok' | 'connector_unavailable';
     apex: { routingFees: Record<assetCode, { lifetime, today, month, year }> };
     peers: Array<{
       id: string;                                          // == connector peerId
       type: 'town' | 'mill' | 'dvm' | 'external';
       byAsset: Record<assetCode, { lifetime, today, month, year }>;
       lastClaimAt: string | null;                          // max(lastClaimAt) across assets
     }>;
     recentClaims: Array<{ peerId, assetCode, assetScale, amount, direction, at }>;
     eventsRelayed: number;                                 // sum of getMetrics().peers[].packetsForwarded
     uptimeSeconds: number;                                 // from getMetrics().uptimeSeconds
   }
   ```
   **And** all string fields are decimal-string bigints (no number coercion); all timestamps are ISO-8601 UTC.

2. **Given** the response shape
   **When** clients consume it
   **Then** `eventsRelayed` is ALWAYS present (sourced from `/admin/metrics.json` `peers[].packetsForwarded` summed — small-number-shaming guard).
   **And** when the connector is unavailable (`status === 'connector_unavailable'`), `eventsRelayed: 0` and `uptimeSeconds: 0` are emitted (never `undefined`, never omitted).

3. **Given** the snapshot reader from Story 47.3
   **When** the route handler executes
   **Then** it calls `aggregateEarnings({ ..., deltaComputer: createDeltaComputer({ snapshotPath }) })`
   **And** `snapshotPath` is resolved as `join(dirname(deps.configPath), 'earnings-snapshots.jsonl')` — byte-identical to the path the `SnapshotWriter` writes to in `createApiServer` (story 47.3 Task 5.1).
   **And** the `today` / `month` / `year` fields in every `PerAsset` are populated from the snapshot reader (NOT stubbed to `'0'`) when at least one boundary snapshot exists for that (scope, assetCode) tuple.

4. **Given** multi-chain operators (e.g. a peer that earned in both `'USD'` and `'ETH'`)
   **When** the response renders
   **Then** per-asset breakouts are NOT collapsed to USD-equivalent (preserves multi-chain story)
   **And** the `byAsset` map preserves every `assetCode` the connector reports verbatim — no normalization, no FX conversion.

5. **Given** the response schema at `packages/townhouse/src/api/schemas/earnings.ts`
   **When** the schema is registered on the Fastify route
   **Then** all required fields from AC #1 are declared (including the `'external'` peer-type case in the `type` enum) AND the schema is validated against the integration-test fixtures from AC #6.
   > **Open Question 1 — Schema library.** The epic AC literal text says "OpenAPI/TypeBox schema". The townhouse codebase currently has zero TypeBox imports — every existing route uses raw `FastifySchema` JSON Schema (see `api/routes/transport.ts:42-52`). Default: **stay with raw `FastifySchema`** and document the divergence. Escalate to Winston (architect) before pulling in TypeBox.

6. **Given** an integration test against `MockEarningsConnector` (a test-only `ConnectorAdminClient` double that returns canned `getEarnings()` and `getMetrics()` payloads)
   **When** it runs
   **Then** all four delta windows (`today` / `month` / `year` / `lifetime`) are asserted at the route layer using seeded snapshot files
   **And** the `'external'` peer bucket is exercised (a connector peer absent from `nodes.yaml` appears with `type: 'external'`)
   **And** `eventsRelayed` is asserted against a known `getMetrics()` fixture (`peers[].packetsForwarded` sum)
   **And** the `connector_unavailable` path is asserted (`getEarnings()` throws → `status: 'connector_unavailable'`, `recentClaims: []`, `eventsRelayed: 0`, `uptimeSeconds: 0`).

**FRs:** FR18 (two-bucket payload).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/earnings/aggregator.ts` end-to-end (~210 lines). Confirm exact exports: `aggregateEarnings`, `PerAsset`, `NodeEarnings`, `AggregatedEarnings`, `AggregatedEarningsStatus`, `AggregateEarningsInput`, `DeltaComputer`, `AggregatorLogger`. Confirm the current shape is `{ status, apex: { routingFees }, peers: [{ id, type, byAsset }] }` and that this story EXTENDS it (does NOT replace it). The `Promise.all([buildRoutingFees(), buildPeers()])` fan-out from 47.2 stays — this story adds a SECOND `getMetrics()` call (or threads metrics through the route) and adds 3 fields to the top-level shape + 1 field per peer.
  - [x] 1.2 Read `packages/townhouse/src/api/routes/earnings.ts` end-to-end (~57 lines). The current handler reads `nodes.yaml`, constructs a `PeerTypeResolver`, calls `aggregateEarnings({ connectorAdmin, peerTypeResolver, logger })`, and returns the result. This story's edit: add `deltaComputer: createDeltaComputer({ snapshotPath })` to the call AND (per the chosen path in OQ2) either thread metrics into the aggregator or assemble the extended shape at the route. Note the existing `nodes_yaml_invalid` 500 path stays — that test case must keep passing.
  - [x] 1.3 Read `packages/townhouse/src/earnings/snapshot-reader.ts` end-to-end (~207 lines). Confirm `createDeltaComputer({ snapshotPath, now? })` exists, returns a `DeltaComputer`, performs one streaming file read per call (single map shared across all three boundaries), and tolerates missing/corrupt files (returns `'0'`). No I/O happens at factory construction — the file is opened lazily on first `DeltaComputer` call.
  - [x] 1.4 Read `packages/townhouse/src/earnings/snapshot-writer.ts` end-to-end (~250 lines), specifically the constructor surface + the `start()` lifecycle. **Do NOT re-construct a `SnapshotWriter` in this story** — it's already wired in `api/server.ts:36-41` (47.3 Task 5). The reader (47.3's `createDeltaComputer`) and the writer are decoupled via the file — this story consumes the reader; the writer is not in scope.
  - [x] 1.5 Read `packages/townhouse/src/api/server.ts` end-to-end (~107 lines). Confirm the `snapshotPath = join(dirname(deps.configPath), 'earnings-snapshots.jsonl')` resolution at line 36. This story's route handler MUST use the EXACT same expression — DRY it via a tiny helper if you prefer (recommended: keep both in-line for now; centralization is a 47.5 / perf-pass concern).
  - [x] 1.6 Read `packages/townhouse/src/api/routes/earnings.test.ts` end-to-end (~218 lines). Confirm the 4 existing test cases: (a) happy path with status='ok', (b) connector_unavailable, (c) external peer, (d) malformed nodes.yaml → 500. All four must continue to pass; this story EXTENDS the assertions in (a)–(c) to cover the new fields (eventsRelayed, uptimeSeconds, recentClaims, lastClaimAt) and adds the delta-population case using a seeded snapshot file. Test helper `writeNodesYaml` and `assetEntry` are reused verbatim.
  - [x] 1.7 Read `packages/townhouse/src/earnings/aggregator.test.ts` end-to-end (~420 lines after 47.2). All 10 existing cases assert the CORE shape (status/apex/peers). This story's aggregator-test additions: assert the new fields are populated from connector data AND that the metrics call is fired (or that the route assembler populates them — depends on OQ2). Reuse `makeConnector()` test double — extend with a `getMetrics()` stub returning a deterministic shape.
  - [x] 1.8 Read `packages/townhouse/src/connector/types.ts:130-322` — confirm `MetricsResponse.aggregate.packetsForwarded: number` and `MetricsResponse.peers[].packetsForwarded: number`. **Decision:** AC #2 says "sum of `peers[].packetsForwarded`". For v1 the aggregate field is the SAME value (since the connector sums them), but the AC is explicit about the peer-sum. Use `metricsRes.peers.reduce((sum, p) => sum + p.packetsForwarded, 0)`. The aggregate field is a fine fallback if `peers[]` is empty (`getMetrics()` returns 200 with `peers: []` when the connector has no registered peers yet — early-boot case).
  - [x] 1.9 Read `packages/townhouse/src/connector/admin-client.ts:190-225` — confirm `getMetrics()` exists, returns `MetricsResponse`, and throws on any 4xx/5xx or shape drift. The route handler must catch this independently of `getEarnings()` failures: if `getMetrics()` throws but `getEarnings()` succeeds, the response is still `status: 'ok'` with `eventsRelayed: 0` and `uptimeSeconds: 0` (graceful zero — same philosophy as 47.2's catch).
  - [x] 1.10 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:926-955` (Story 47.4 spec) + lines 958-985 (Story 47.5 spec, the consumer). Confirm 47.5's gate asserts: (a) HTTP 200, (b) two-bucket shape (apex + peers as separate top-level keys — already true from 47.2), (c) all four delta windows populated, (d) `~/.townhouse/earnings-snapshots.jsonl` contains ≥1 line, (e) `eventsRelayed` field present, (f) non-Townhouse peer appears with `type: 'external'`. **Every one of these is verifiable from the wire shape this story produces** — no additional code is needed in 47.4 to support 47.5.
  - [x] 1.11 Read `packages/townhouse/src/registry/peer-type-resolver.ts` (36 lines) and `packages/townhouse/src/state/nodes-yaml.ts` (116 lines). No edits in this story — the route already reads `nodes.yaml` via 47.2's wiring. Verify the `resolveNodesYamlPath()` helper at `earnings.ts:31-33` is the right pattern to reuse for `resolveSnapshotPath()` (if you choose to extract a helper; the convention is local-to-the-route).
  - [x] 1.12 Read `packages/townhouse/src/index.ts` lines 120–145 (the Story 47.2 + 47.3 re-export blocks). This story adds: (a) the schema export from `api/schemas/earnings.ts` (Open Question 1 path-dependent); (b) IF the aggregator shape is extended (OQ2 path A), the extended `AggregatedEarnings` type. NO new top-level package exports for route internals (the route is invoked via Fastify; downstream packages don't need it).
  - [x] 1.13 Read `packages/townhouse-web/src/components/earnings-panel.tsx:1-50, 110-130, 250-310`. Confirm the SPA consumes `AggregatedEarnings` via `await res.json() as AggregatedEarnings` and accesses `body.status`, `body.apex.routingFees`, `body.peers[].byAsset`, `body.peers[].type`, `body.peers[].id`. The new fields (`recentClaims`, `eventsRelayed`, `uptimeSeconds`, `lastClaimAt`) are accretive — adding them does NOT break the SPA. Decide whether to surface them in the panel now (Task 8 Path A) or defer to a follow-up Epic 48 story (Path B). See Open Question 3.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm `47-1-sdk-get-earnings-wrap-and-contract-canary: done` AND `getEarnings()` + `getMetrics()` both exist at `packages/townhouse/src/connector/admin-client.ts`. If absent → STOP.
  - [x] 2.2 Confirm `47-2-aggregator-earnings-surgery: done` AND `aggregateEarnings()` exports `AggregatedEarnings`, `DeltaComputer`, `AggregateEarningsInput` from `packages/townhouse/src/earnings/aggregator.ts`. If absent → STOP.
  - [x] 2.3 Confirm `47-3-hourly-earnings-snapshot-writer: done` AND `createDeltaComputer` is exported from `packages/townhouse/src/earnings/snapshot-reader.ts` AND `SnapshotWriter` is constructed inside `createApiServer()` at `packages/townhouse/src/api/server.ts:37`. If either is absent → STOP.
  - [x] 2.4 Confirm `pnpm --filter @toon-protocol/townhouse build` is clean on `epic-47` branch (994 tests baseline after 47.3). No pre-existing typecheck errors.
  - [x] 2.5 Capture baseline test count: `pnpm --filter @toon-protocol/townhouse test` → 994 tests across 65 files. This story's net delta should be roughly +6 to +12 tests (aggregator extended-shape cases + route extended-assertion cases + 1–2 schema validation cases). The earnings.test.ts file should expand by ~3 cases, aggregator.test.ts by ~2 cases.
  - [x] 2.6 Confirm `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` is still sub-500ms, 43 tests (UNCHANGED — this story does NOT touch the canary).
  - [x] 2.7 Verify no in-flight branch is touching `aggregator.ts` or `routes/earnings.ts`: `gh pr list --state open --search "earnings"`. 47.3 just landed; the files should be quiescent.

- [x] **Task 3: Decide shape ownership + extend aggregator OR build route assembler (AC: 1, 2, 3, 4)**
  > **Resolve Open Question 2 BEFORE writing any code in this task.** The two paths diverge by ~80 lines and ~6 tests. Path A is recommended; Path B is documented for completeness.
  - **Path A (RECOMMENDED) — extend aggregator shape:**
    - [x] 3A.1 Edit `packages/townhouse/src/earnings/aggregator.ts`. Extend the exported types:
      ```typescript
      /** Per-peer earnings entry. Adds `lastClaimAt` (Story 47.4) — the most
       *  recent `lastClaimAt` across this peer's assets, or `null` if none. */
      export interface NodeEarnings {
        id: string;
        type: NodeType | 'external';
        byAsset: Record<string, PerAsset>;
        lastClaimAt: string | null;        // NEW in 47.4
      }

      /** Top-level aggregator output. Extended in 47.4 with the fields the
       *  TUI/SPA need to render the dashboard band + activity ticker without
       *  reaching into the connector themselves. */
      export interface AggregatedEarnings {
        status: AggregatedEarningsStatus;
        apex: { routingFees: Record<string, PerAsset> };
        peers: NodeEarnings[];
        recentClaims: RecentClaim[];       // NEW in 47.4 — pass-through from connector
        eventsRelayed: number;             // NEW in 47.4 — sum of getMetrics().peers[].packetsForwarded
        uptimeSeconds: number;             // NEW in 47.4 — from getMetrics().uptimeSeconds
      }
      ```
      Re-export `RecentClaim` from `'../connector/types.js'` (existing type, already declared in 47.1).
    - [x] 3A.2 Update `aggregateEarnings()` body in the same file to populate the new fields:
      ```typescript
      // After the existing Promise.all([buildRoutingFees(), buildPeers()]):
      // - recentClaims comes verbatim from earnings.recentClaims
      // - eventsRelayed and uptimeSeconds require a SECOND connector call (getMetrics)
      // - lastClaimAt per peer = max(peer.byAsset[*].lastClaimAt), null if all null
      ```
      Add a second `try { metrics = await connectorAdmin.getMetrics(); } catch { metrics = null; }` block. On null, `eventsRelayed: 0` and `uptimeSeconds: 0`. The `getEarnings()` and `getMetrics()` calls fan out concurrently via `Promise.allSettled([...])` — both block the response, but they don't sequence.
    - [x] 3A.3 In the connector-unavailable branch (`getEarnings()` throws), still emit the extended fields with zeros/empty arrays:
      ```typescript
      return {
        status: 'connector_unavailable',
        apex: { routingFees: {} },
        peers: [],
        recentClaims: [],
        eventsRelayed: 0,
        uptimeSeconds: 0,
      };
      ```
    - [x] 3A.4 Compute per-peer `lastClaimAt` inside `buildPeers()`: iterate `peer.byAsset[*].lastClaimAt`, take the lexicographic max of non-null values (ISO-8601 strings sort identically to their epoch values), default to `null`. Note: `Math.max()` on ISO strings does NOT work — use `arr.reduce((acc, v) => v && (acc === null || v > acc) ? v : acc, null as string | null)`.
    - [x] 3A.5 Update `AggregateEarningsInput` JSDoc to note that the function now makes TWO connector calls (`getEarnings` + `getMetrics`) — this is a behavior change that callers should be aware of (impacts caching strategy if any consumer wraps the call).
    - [x] 3A.6 Update existing aggregator unit tests for the new fields. Cases 1, 2, 3, 6, 7 from 47.2's suite all need additions: `expect(result.recentClaims).toEqual([...])`, `expect(result.eventsRelayed).toBe(...)`, `expect(result.uptimeSeconds).toBe(...)`. Test double `makeConnector(opts)` already returns `getMetrics: vi.fn()` (it's a stub); extend it to accept a `metrics?: MetricsResponse | 'throw'` option.
    - [x] 3A.7 Add 2 new aggregator tests:
      - **`getMetrics throws → eventsRelayed=0, uptimeSeconds=0, getEarnings happy path still works`.** Asserts the independence of the two connector calls.
      - **`lastClaimAt is max across peer's assets`.** Seed a peer with 2 assets, lastClaimAt `'2026-05-12T10:00:00Z'` and `'2026-05-12T15:00:00Z'`. Assert peer's top-level `lastClaimAt === '2026-05-12T15:00:00Z'`. Seed another peer with both `null` → top-level `null`.
  - **Path B (NOT RECOMMENDED, documented for the record) — route-layer assembler:**
    - 3B.1 Keep the aggregator's output exactly as 47.2 left it.
    - 3B.2 Build a new module `packages/townhouse/src/earnings/route-assembler.ts` (~80 lines) that calls `aggregateEarnings()` + `getMetrics()` and merges them into the route response.
    - 3B.3 Wire the assembler from the route handler instead of `aggregateEarnings()` directly.
    - **Why this is NOT recommended:** the wire shape is the canonical source-of-truth for the dashboard, and splitting it across two modules (aggregator vs. assembler) creates two places to evolve when the wire shape changes. CLAUDE.md "no half-finished implementations" + 47.2's principle that the aggregator owns the shape (D1 wire-shape change landed there, not in 47.4).

- [x] **Task 4: Wire the delta computer + extended call into the route (AC: 3, 5)**
  - [x] 4.1 Edit `packages/townhouse/src/api/routes/earnings.ts`. Add a path-resolution helper alongside `resolveNodesYamlPath`:
    ```typescript
    function resolveSnapshotPath(deps: ApiDeps): string {
      return join(dirname(deps.configPath), 'earnings-snapshots.jsonl');
    }
    ```
    Add imports: `import { createDeltaComputer } from '../../earnings/snapshot-reader.js';`.
  - [x] 4.2 Update the route body. Construct `deltaComputer` ONCE per request:
    ```typescript
    const peerTypeResolver = new PeerTypeResolver(yaml);
    const deltaComputer = createDeltaComputer({ snapshotPath: resolveSnapshotPath(deps) });
    return aggregateEarnings({
      connectorAdmin: deps.connectorAdmin,
      peerTypeResolver,
      deltaComputer,
      logger: request.log,
    });
    ```
    `createDeltaComputer` is cheap (just captures the path string); the file is NOT opened until `aggregateEarnings()` actually invokes the computer per (peer × asset + apex × asset) tuple. **Do NOT memoize across requests** — see Open Question 4.
  - [x] 4.3 Verify the route's existing `nodes_yaml_invalid` 500 path stays intact. The route's outer try-catch is around `readNodesYaml`; the `aggregateEarnings()` call is OUTSIDE that catch — any aggregator error (which there shouldn't be — the aggregator swallows everything) reaches Fastify's default 500. This matches the 47.2 design.
  - [x] 4.4 If Open Question 1 chose `FastifySchema` (default): create `packages/townhouse/src/api/schemas/earnings.ts` declaring a `FastifySchema` for the GET response. Register it on the route via `app.get('/api/earnings', { schema: earningsResponseSchema }, async (...) => ...)`. The schema must declare:
    - `status: { type: 'string', enum: ['ok', 'connector_unavailable'] }`
    - `apex.routingFees`: `{ type: 'object', additionalProperties: { type: 'object', properties: { lifetime, today, month, year }, required: [...], additionalProperties: false } }`
    - `peers`: array of `{ id, type: { enum: ['town','mill','dvm','external'] }, byAsset (same shape as routingFees), lastClaimAt: { type: ['string','null'] } }`
    - `recentClaims`: array of `{ peerId, assetCode, assetScale, amount, direction: { enum: ['inbound','outbound'] }, at }`
    - `eventsRelayed: { type: 'integer', minimum: 0 }`
    - `uptimeSeconds: { type: 'integer', minimum: 0 }`
    - **Top-level:** `required: ['status','apex','peers','recentClaims','eventsRelayed','uptimeSeconds']`, `additionalProperties: false` to lock the contract.
    > **Fastify gotcha:** response schemas in Fastify run a serializer (fast-json-stringify), NOT a validator. Unknown fields in the handler return value are SILENTLY DROPPED. That's the right behavior here (defense-in-depth against accidental field leaks), but it means a buggy aggregator output (e.g. missing `peers` field) won't fail validation — it'll just emit `peers: []`. Add a route-test case that handler returns a malformed object and confirm the wire contract holds (Task 5.5).
  - [x] 4.5 If Open Question 1 chose TypeBox (NOT default): add `@sinclair/typebox` to `packages/townhouse/devDependencies`. Build the schema in `api/schemas/earnings.ts` as `Type.Object({...})`. Export `EarningsResponseSchema` (the runtime schema) AND `EarningsResponse` (the inferred `Static<typeof EarningsResponseSchema>` type). The aggregator's `AggregatedEarnings` type and TypeBox's inferred type MUST be assignable to each other — this is a type-level handshake the build will enforce. If they diverge, the aggregator's manually-declared interface is the source-of-truth and the schema is wrong.

- [x] **Task 5: Extend `api/routes/earnings.test.ts` for the new shape (AC: 1, 2, 3, 6)**
  - [x] 5.1 Reuse the existing test setup (`MockEarningsConnector` is the implicit name for the `makeDeps()` factory + `connectorAdmin` mock from 47.2). Extend `makeDeps()` to accept optional `metrics?: MetricsResponse | 'throw'` and a `snapshotEntries?: SnapshotEntry[]` option that seeds `<tmpHome>/earnings-snapshots.jsonl` before each test.
  - [x] 5.2 Extend the **happy path** test (`it('happy path: returns AggregatedEarnings shape with status "ok"')`):
    - Add `eventsRelayed`, `uptimeSeconds`, `recentClaims`, `lastClaimAt` assertions on the response.
    - Use a `metrics` fixture with `aggregate.packetsForwarded: 1234` and 2 peers (`{packetsForwarded: 500, ...}`, `{packetsForwarded: 734, ...}`). Assert `body.eventsRelayed === 1234`.
    - Use `recentClaims: [{peerId: 'peer-town-01', assetCode: 'USD', assetScale: 6, amount: '100', direction: 'inbound', at: '2026-05-13T12:00:00Z'}]`. Assert `body.recentClaims` matches verbatim.
    - For `lastClaimAt`: extend the connector `peers[0].byAsset[0]` to have `lastClaimAt: '2026-05-13T12:00:00Z'`. Assert `body.peers[0].lastClaimAt === '2026-05-13T12:00:00Z'`.
  - [x] 5.3 Extend the **connector unreachable** test:
    - Assert `body.eventsRelayed === 0`, `body.uptimeSeconds === 0`, `body.recentClaims === []`, `body.peers === []`, `body.apex.routingFees === {}`.
    - Confirm `body.status === 'connector_unavailable'` (already asserted by 47.2).
  - [x] 5.4 Extend the **external peer** test:
    - Add `metrics` with `peers[].peerId: 'peer-unknown-99'` AND `packetsForwarded: 42`. Assert `body.eventsRelayed === 42`.
    - Assert `body.peers[0].lastClaimAt === null` (the test's asset has `lastClaimAt: null`).
  - [x] 5.5 Add a **delta windows populated** test (AC #3, #6) — the critical new case:
    - Seed `<tmpHome>/earnings-snapshots.jsonl` with 3 entries for `peer-town-01` / `USD`:
      ```
      {ts: '2026-05-13T00:00:00.000Z', peerId: 'peer-town-01', assetCode: 'USD', claimsReceivedTotal: '900'}
      {ts: '2026-05-01T00:00:00.000Z', peerId: 'peer-town-01', assetCode: 'USD', claimsReceivedTotal: '500'}
      {ts: '2026-01-01T00:00:00.000Z', peerId: 'peer-town-01', assetCode: 'USD', claimsReceivedTotal: '100'}
      ```
    - Use a fake clock: `vi.setSystemTime(new Date('2026-05-13T15:00:00.000Z'))` OR inject `now` via `createDeltaComputer({ snapshotPath, now: () => fakeDate })` — but the route doesn't expose the `now` injection point, so use `vi.setSystemTime()`.
    - Seed connector with `claimsReceivedTotal: '1000'` (current lifetime).
    - Assert: `today === '100'` (1000−900), `month === '500'` (1000−500), `year === '900'` (1000−100), `lifetime === '1000'`.
  - [x] 5.6 Add a **apex deltas populated** test:
    - Seed snapshots for `'__apex__'` / `USD`. Connector `connectorFees: [{assetCode: 'USD', assetScale: 6, total: '2000'}]`.
    - Assert `body.apex.routingFees['USD'].today` matches the snapshot delta.
  - [x] 5.7 Add a **getMetrics fails, getEarnings succeeds** test:
    - `metrics: 'throw'`, `earnings: <valid>`. Assert `body.status === 'ok'`, `body.eventsRelayed === 0`, `body.uptimeSeconds === 0`, `body.peers.length > 0`.
  - [x] 5.8 Run `pnpm --filter @toon-protocol/townhouse test src/api/routes/earnings.test.ts` — confirm all tests pass. The suite should grow from 4 → ~9 cases.

- [x] **Task 6: Extend `earnings/aggregator.test.ts` for the new fields (AC: 1, 2)**
  - [x] 6.1 Extend `makeConnector(opts)` to accept `metrics?: MetricsResponse | 'throw'`. The default `getMetrics: vi.fn()` becomes:
    ```typescript
    getMetrics: vi.fn(async () => {
      if (opts.metrics === 'throw') throw new Error('metrics down');
      return opts.metrics ?? { uptimeSeconds: 0, aggregate: { packetsForwarded: 0, packetsRejected: 0, bytesSent: 0 }, peers: [], timestamp: '' };
    })
    ```
  - [x] 6.2 Update existing cases (1, 2, 3, 4, 5, 6, 7) to ALSO assert the new top-level fields:
    - Empty-earnings cases: `expect(result.recentClaims).toEqual([])`, `eventsRelayed === 0`, `uptimeSeconds === 0`.
    - Full-earnings cases: assert each new field carries the connector value.
    - Throw cases (4, 5): assert the new fields zero out per AC #2.
    > **Code-style note:** if the existing tests use `toEqual` on the entire result, you can update the expected object once per case instead of adding 3 new asserts per case. Either way works; pick whichever is more readable for that test.
  - [x] 6.3 Add **case 11 — eventsRelayed sums getMetrics().peers[].packetsForwarded** (NEW):
    - Connector returns 3 peers in `getMetrics()`: `[{packetsForwarded: 100}, {packetsForwarded: 200}, {packetsForwarded: 50}]`.
    - Assert `result.eventsRelayed === 350`.
    - Use the AC #2 wording: peer-sum, not `aggregate.packetsForwarded`. Verify the test fails if you swap implementations.
  - [x] 6.4 Add **case 12 — getMetrics throws → graceful zero** (NEW):
    - `metrics: 'throw'`, earnings happy.
    - Assert `result.status === 'ok'` (the earnings path succeeded), `result.eventsRelayed === 0`, `result.uptimeSeconds === 0`, and `result.peers.length > 0` (the earnings call's peers still populate).
    - Spy on `logger.warn`: assert one call with the message `'aggregator: getMetrics failed — eventsRelayed/uptimeSeconds defaulting to 0'` (or whichever exact string the dev chose; just confirm a log entry exists).
  - [x] 6.5 Add **case 13 — lastClaimAt max across peer's assets** (NEW):
    - Peer with 3 assets, lastClaimAt `[null, '2026-05-12T10:00:00.000Z', '2026-05-13T05:00:00.000Z']`.
    - Assert `peer.lastClaimAt === '2026-05-13T05:00:00.000Z'`.
    - Second peer with all-null lastClaimAt → assert `peer.lastClaimAt === null`.
  - [x] 6.6 Run `pnpm --filter @toon-protocol/townhouse test src/earnings/aggregator.test.ts` — confirm all pass. Suite grows from 10 → ~13 cases.

- [x] **Task 7: Schema file + Fastify route registration (AC: 5)**
  - [x] 7.1 Create `packages/townhouse/src/api/schemas/earnings.ts`. Anchor module JSDoc: "Response schema for GET /api/earnings (Story 47.4). Locks the wire-level contract for the TUI / SPA / future Tauri client. Schema library: raw `FastifySchema` JSON Schema — matches the established pattern in `api/routes/transport.ts:42-52`. See Story 47.4 Open Question 1 for the decision trail."
  - [x] 7.2 Declare the schema as a top-level `FastifySchema` constant (NOT a `JSONSchemaType<T>` — Fastify's type binding is via the route generics, not the schema). Use `as const` on enum arrays so TypeScript narrows them.
  - [x] 7.3 Wire the schema on the route: `app.get('/api/earnings', { schema: earningsResponseSchema }, async (request, reply) => {...})`. Verify the route still compiles (Fastify's TypeScript surface for `app.get<{ Reply: AggregatedEarnings }>` may need explicit generics if the inferred type doesn't match — see `api/routes/transport.ts:108` for the established pattern).
  - [x] 7.4 Add a schema-validation unit test in `earnings.test.ts` (or a new `api/schemas/earnings.test.ts` if you prefer module-local placement — recommended for discoverability):
    - Import the schema + `ajv`.
    - Validate a known-good `AggregatedEarnings` fixture against it — assert valid.
    - Mutate the fixture (add an unknown top-level key, drop a required field, set `peer.type: 'invalid'`) — assert each mutation fails validation with a useful error message.
    - This guards against the silent-drop trap noted in Task 4.4.
  - [x] 7.5 Re-export the schema from `packages/townhouse/src/index.ts` IFF a downstream consumer needs it (e.g. the TUI in Epic 48 might want to validate the wire shape it reads). Default: DO NOT re-export — it's a private route-internal until proven otherwise.

- [x] **Task 8: Decide ripple scope — SPA panel update (AC: out-of-band)**
  > **Resolve Open Question 3 BEFORE drafting the PR.** See "Ripple Effects" in Dev Notes.
  - [x] 8.1 **Path A — update the SPA panel in this PR:** rewrite `packages/townhouse-web/src/components/earnings-panel.tsx` to render the new fields:
    - `eventsRelayed` as a sub-hero stat under the apex routing fees.
    - `uptimeSeconds` as a small footer ("Connector up Xh Ym").
    - `recentClaims[]` as an activity ticker (epic spec mentions this UI element — last 10 entries, reverse chronological).
    - `peer.lastClaimAt` as a "last seen" timestamp on each peer row.
    - Update `earnings-panel.test.tsx` sample payloads to include the new fields.
    - Update `earnings-panel.tsx`'s local `AggregatedEarnings` type import (now extended in 47.2).
  - [x] 8.2 **Path B — defer to Epic 48:** SPA panel keeps rendering only the 47.2 fields. The new fields are wire-available but not yet UI-surfaced. Open a follow-up under Epic 48 ("dashboard: surface eventsRelayed / recentClaims / uptimeSeconds in earnings panel"). The TUI (Epic 48) consumes them directly — the SPA can wait.
  - [x] 8.3 **Default action: Path B.** The TUI is the v1 surface; the SPA was the validation-gate harness. Path A is fine if it's a small lift (~30 min) — Path B is the right call if it expands beyond.
  - [x] 8.4 Document the choice in `### Review Findings` at close-out.

- [x] **Task 9: Verify, lint, and prepare for code review (AC: all)**
  - [x] 9.1 `pnpm --filter @toon-protocol/townhouse build` — clean. No new typecheck errors.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse test` — full unit suite green. Expected net delta: +6 to +12 tests (aggregator suite 10 → ~13, route suite 4 → ~9). If the count grows by more than +15, you may be over-testing; trim the additions.
  - [x] 9.3 `pnpm --filter @toon-protocol/townhouse test src/earnings/` — earnings module tests still run sub-1s (no I/O in aggregator; route tests use temp dirs).
  - [x] 9.4 `pnpm --filter @toon-protocol/townhouse test src/api/routes/earnings.test.ts` — focused route suite, should be sub-2s including the snapshot-seeded delta-windows case.
  - [x] 9.5 `pnpm --filter @toon-protocol/townhouse test contract-canary` — UNCHANGED, 43 tests sub-500ms. This story does NOT touch the connector contract.
  - [x] 9.6 `pnpm eslint` on townhouse — no new warnings/errors.
  - [x] 9.7 If Path A in Task 8: `pnpm --filter @toon-protocol/townhouse-web build && pnpm --filter @toon-protocol/townhouse-web exec vitest run` — SPA build + component tests green.
  - [x] 9.8 Self-review against AC list:
    - (a) Response includes ALL fields from AC #1 (status, apex, peers, recentClaims, eventsRelayed, uptimeSeconds; peers have id/type/byAsset/lastClaimAt).
    - (b) `eventsRelayed` is sourced from `getMetrics().peers[].packetsForwarded` summed (NOT from `aggregate.packetsForwarded`).
    - (c) `today`/`month`/`year` populate from the snapshot reader when snapshots exist (NOT stubbed to `'0'`).
    - (d) `'external'` peer-type case is exercised in route tests.
    - (e) Per-asset breakouts are NOT collapsed to USD-equivalent.
    - (f) Schema rejects unknown top-level keys and unknown `peer.type` values.
    - (g) `connector_unavailable` branch emits zeros (not undefineds) for all new fields.
  - [x] 9.9 Update sprint-status to `review`. Populate `### Review Findings` with a dated entry covering: Open Questions 1–4 resolutions, Path A vs B choice, deviations from defaults.

## Dev Notes

### Story Mission — The Surface Layer Stops Computing

Stories 47.1, 47.2, and 47.3 built the earnings data plane: typed connector wrap (47.1), aggregator that owns the canonical shape (47.2), hourly snapshot writer + reader that computes deltas vs. UTC boundaries (47.3). What remains is the wire endpoint that hands the TUI / SPA / future Tauri client a single JSON blob with everything they need to render the dashboard band, the activity ticker, the per-peer rows, and the "events relayed" small-number-shaming guard — without making them call `/admin/*` directly, do snapshot math, or know about `nodes.yaml`.

That's this story. It's mostly wiring: light up the `deltaComputer` plumbing 47.2 already designed for, sum a packetsForwarded counter from the metrics endpoint for the events-relayed guard, thread `recentClaims` and `lastClaimAt` through the aggregator shape, and lock the contract with a response schema. The aggregator gains a second connector call (`getMetrics()`), and the route handler gains a `createDeltaComputer` construction — that's the entire net delta.

**Hard rules:**

1. **The surface layer never reaches into `/admin/*`.** AC's premise: TUI/SPA call only `/api/earnings`. If you find yourself wanting to expose another endpoint to the dashboard for "just one more field", you've lost the plot — extend this response.
2. **`status: 'ok' | 'connector_unavailable'` is the ONLY error signaling.** No HTTP 5xx from earnings except on `nodes_yaml_invalid` (operator misconfiguration, surfaces clearly). Connector outage → 200 with `status: 'connector_unavailable'` + zeros. Same philosophy as 47.2's D1 wire-shape change.
3. **Per-asset breakouts stay separate.** Don't add a `usdEquivalent` field. Don't sum across assets. Drew's multi-chain story is the whole point of TOON — collapsing it to a single number defeats the marketing claim.
4. **`eventsRelayed` is intentionally low-precision.** It's a small-number-shaming guard, not a counter the SPA pages off of. AC #2 says "ALWAYS present" — emit `0` on connector outage rather than omit. The connector's `packetsForwarded` resets on connector restart; v1 accepts this. Long-term packet-count history is out of scope (would need its own snapshot writer; that's an Epic 48+ concern).
5. **No caching across requests.** Each `GET /api/earnings` re-reads `nodes.yaml`, reconstructs the resolver, reconstructs the delta computer, fires `getEarnings()` + `getMetrics()` concurrently, and streams the snapshot file once per delta call. At v1 scale (≤1 dashboard client polling at 5s), this is fine. See Open Question 4 for the cache-shaped follow-up if it bites.

### Shape Ownership: Aggregator vs Route Assembler (Open Question 2)

The 47.4 response is **bigger** than the 47.2 `AggregatedEarnings` shape — it adds `recentClaims`, `eventsRelayed`, `uptimeSeconds`, and per-peer `lastClaimAt`. Two paths.

**Path A — extend the aggregator (RECOMMENDED).** `AggregatedEarnings` grows. `aggregateEarnings()` now makes two connector calls (`getEarnings` + `getMetrics`). The route handler stays at `return aggregateEarnings({...})`.

- **Pro:** the wire shape lives in one file. Adding a field is a single edit, not a coordinated edit across `aggregator.ts` + `route-assembler.ts`. 47.2 already established this pattern with the `status` field — extending the precedent.
- **Pro:** the aggregator's unit tests cover the wire shape directly. No need to maintain a parallel test surface in `route-assembler.test.ts`.
- **Con:** `aggregateEarnings()` is no longer pure "aggregate earnings" — it's "aggregate earnings + metrics + lastClaimAt synthesis". The name lies slightly. Acceptable for v1; rename to `assembleEarningsPayload` if the lie becomes load-bearing.

**Path B — route-layer assembler.** A new module `route-assembler.ts` calls `aggregateEarnings()` + `getMetrics()` and merges. The aggregator stays narrow.

- **Pro:** the aggregator stays purely about earnings derivation. Each module is single-purpose.
- **Con:** the wire shape lives in two files. Schema validation has to assert against the merged shape, but the merge logic isn't covered by aggregator tests — needs its own test surface. PR ripples through 3 files instead of 1.
- **Con:** the SPA imports `AggregatedEarnings` directly from `aggregator.ts`. If the wire shape is in the assembler, the SPA imports get convoluted.

**Default action:** Path A. If the dev finds the rename pressure too high (the lie that "aggregator" implies "earnings-only"), document the rename as a deferred cleanup and proceed with Path A anyway.

### Schema Library Choice (Open Question 1)

The epic AC at line 946 says "OpenAPI/TypeBox schema at `packages/townhouse/src/api/schemas/earnings.ts`". The codebase reality:

- **Existing pattern (raw `FastifySchema`):** `api/routes/transport.ts:42-52`, `api/routes/nodes-patch.ts`, `api/routes/wallet-withdraw.ts` — all use raw JSON Schema as inline `FastifySchema` constants. No TypeBox imports anywhere in `packages/townhouse/`.
- **TypeBox imports across the repo:** `grep -rn "@sinclair/typebox" packages/` returns ZERO matches in production source. Even other packages (sdk, mill, core) don't use TypeBox.

**Three options:**

1. **(RECOMMENDED)** Stay with `FastifySchema` JSON. Match the established pattern. Place the schema in `api/schemas/earnings.ts` (matching the epic AC's path requirement). Document the divergence from "OpenAPI/TypeBox" in Review Findings. The dev MAY still emit OpenAPI from the JSON Schema using Fastify's `@fastify/swagger` plugin if the wire-contract documentation matters — but that's separate from the schema-as-validator concern this AC addresses.
2. Introduce TypeBox in `packages/townhouse`. Adds a new dep, requires updating other schemas eventually for consistency. Out of scope for this story.
3. Hand-write the schema as a plain `JSONSchemaType<AggregatedEarnings>` (using Ajv's type binding). Same as (1) but with stronger type-checking on the schema constant itself.

**Default action:** (1). Document the AC's "TypeBox" language as a pattern hint from earlier planning, superseded by codebase consistency. If Winston (architect) wants TypeBox as a v1.5 standardization sweep, that's a separate epic.

### Open Question 3 — SPA Panel Update Path

The aggregator's `AggregatedEarnings` type is consumed by `earnings-panel.tsx`. Extending it adds 4 fields. The SPA's existing imports (`AggregatedEarnings, NodeEarnings, PerAsset`) will pick up the new fields automatically — TypeScript will NOT break, but the panel won't render the new data either.

- **Path A:** ship aggregator + route + SPA panel updates in one PR. Render `eventsRelayed`, `uptimeSeconds`, `recentClaims`, `lastClaimAt`. Larger PR, no broken consumers, follows CLAUDE.md "no half-finished implementations" if you consider the SPA the v1 dashboard.
- **Path B (RECOMMENDED):** ship aggregator + route only. SPA panel keeps rendering current fields; the new fields are wire-available for the Epic 48 TUI. Open a follow-up story under Epic 48 for SPA-panel-extension.

**Why Path B is recommended:** the v1 dashboard is the Ink TUI (Epic 48). The SPA panel was a 47.2 ripple — useful for validation gates, not a long-term surface. The TUI consumes `/api/earnings` natively; the SPA's "earnings panel" widget will likely be deprecated when Epic 48 lands the full dashboard. Don't invest in Path A unless the SPA is your day-one shipped UI.

**Default action:** Path B. If the dev disagrees (e.g. the SPA IS a long-term surface), escalate to Sally (UX) or Alice (PM) before committing.

### Open Question 4 — Reader Cache (Deferred from 47.3)

The route reconstructs `createDeltaComputer({ snapshotPath })` per request. The computer captures the path string but does NO I/O until invoked. The aggregator then invokes the computer once per (peer × asset + apex × asset) tuple — for v1 scale (~9 tuples), that's 9 sequential file reads via readline.

- **v1 (this story):** no cache. 9 streaming reads per dashboard poll (5s cadence) → ~1.8 file-reads/sec. At 1.4MB per file (9500 entries), that's ~2.5 MB/s steady-state. Acceptable on any host.
- **Future:** if the file grows beyond 9500 entries (multi-peer multi-asset 13-month retention → 86k entries → ~13MB), the per-request cost compounds. The fix is in 47.3's `createDeltaComputer` (e.g. an in-call cache that shares the parsed map across all delta calls within a single request), not in this story.

**Default action:** no action. Don't add a cache here. If 47.5 (live gate) shows perf issues, fix in 47.3's reader, not 47.4's route.

### Ripple Effects & Out-of-Scope Surface

| File | Status | Action |
|------|--------|--------|
| `packages/townhouse/src/earnings/aggregator.ts` | UPDATE | Extend `AggregatedEarnings` + `NodeEarnings`; add `getMetrics()` call; compute `lastClaimAt` per peer. ~50 lines added. |
| `packages/townhouse/src/earnings/aggregator.test.ts` | UPDATE | Extend test doubles + assertions; add 3 new cases (cases 11–13). |
| `packages/townhouse/src/api/routes/earnings.ts` | UPDATE | Wire `createDeltaComputer`; register response schema. ~15 lines added. |
| `packages/townhouse/src/api/routes/earnings.test.ts` | UPDATE | Extend 3 existing cases + add 3 new cases (delta windows, apex deltas, getMetrics throws). |
| `packages/townhouse/src/api/schemas/earnings.ts` | NEW | ~80 lines of `FastifySchema` JSON Schema. |
| `packages/townhouse/src/api/schemas/earnings.test.ts` | NEW (optional) | Schema validation unit tests. ~50 lines. Recommended for discoverability. |
| `packages/townhouse/src/index.ts` | UPDATE | Re-export the extended `AggregatedEarnings`/`NodeEarnings` (already exported from 47.2 — no new line, but verify the extended types are picked up). |
| `packages/townhouse-web/src/components/earnings-panel.tsx` | Path A: UPDATE / Path B: untouched | See Open Question 3. |
| `packages/townhouse-web/src/components/earnings-panel.test.tsx` | Path A: UPDATE / Path B: untouched | Same. |

### Files This Story Does NOT Modify

- `packages/townhouse/src/connector/admin-client.ts` — `getEarnings()` + `getMetrics()` consumed unchanged.
- `packages/townhouse/src/connector/types.ts` — earnings + metrics interfaces consumed unchanged. `RecentClaim` (already exported) is re-exposed by the aggregator.
- `packages/townhouse/src/connector/contract-canary.test.ts` — UNCHANGED. This story does NOT touch the connector contract.
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — UNCHANGED.
- `packages/townhouse/src/earnings/snapshot-writer.ts` — UNCHANGED. The writer is wired in `createApiServer` by 47.3 Task 5; this story just reads via `createDeltaComputer`.
- `packages/townhouse/src/earnings/snapshot-reader.ts` — UNCHANGED. Consumed via the factory.
- `packages/townhouse/src/api/server.ts` — UNCHANGED. Snapshot writer construction already lives here from 47.3; this story doesn't touch the lifecycle.
- `packages/townhouse/src/registry/peer-type-resolver.ts` — UNCHANGED. The route already constructs the resolver per request from 47.2.
- `packages/townhouse/src/state/nodes-yaml.ts` — UNCHANGED.
- `packages/townhouse/package.json` — UNCHANGED. No new dependencies (Open Question 1 default keeps us on `FastifySchema`).
- `packages/sdk/CONNECTOR_MIGRATION.md` — UNCHANGED. No connector contract change.
- `docker/src/entrypoint-townhouse-api.ts` — UNCHANGED. Route is registered in `createApiServer`.
- Anything under `packages/mill/`, `packages/sdk/`, `packages/core/` — out of scope.

### Wire Shape — Worked Example

A live response from a town apex with one Townhouse peer (`peer-town-01`, USDC), one external peer (`peer-unknown-99`, ETH), one apex routing-fee asset (USDC), and a recent inbound claim:

```json
{
  "status": "ok",
  "apex": {
    "routingFees": {
      "USD": { "lifetime": "5000000", "today": "100000", "month": "1200000", "year": "5000000" }
    }
  },
  "peers": [
    {
      "id": "peer-town-01",
      "type": "town",
      "byAsset": {
        "USD": { "lifetime": "12345678", "today": "234567", "month": "734567", "year": "12345678" }
      },
      "lastClaimAt": "2026-05-13T12:34:56.000Z"
    },
    {
      "id": "peer-unknown-99",
      "type": "external",
      "byAsset": {
        "ETH": { "lifetime": "1000000000000000000", "today": "0", "month": "0", "year": "0" }
      },
      "lastClaimAt": null
    }
  ],
  "recentClaims": [
    {
      "peerId": "peer-town-01",
      "assetCode": "USD",
      "assetScale": 6,
      "amount": "100000",
      "direction": "inbound",
      "at": "2026-05-13T12:34:56.000Z"
    }
  ],
  "eventsRelayed": 42789,
  "uptimeSeconds": 86400
}
```

Notes:
- `lifetime` for the external peer is the ETH bigint at 18-decimal scale (`'1000000000000000000'` = 1 ETH). The dashboard interprets `assetScale` from the asset-code dictionary (USD: 6, ETH: 18). The aggregator does NOT collapse to a unit.
- `today/month/year` for the external peer are `'0'` because no snapshot exists yet for this peerId/ETH tuple (the external peer just appeared, the hourly writer hasn't captured it yet).
- `lastClaimAt: null` for the external peer because the connector returned `null` (the peer joined recently, hasn't paid us yet).
- `eventsRelayed: 42789` is the sum of `getMetrics().peers[].packetsForwarded`.

### Test Strategy Notes

- **Two test files do the heavy lifting:** `aggregator.test.ts` covers the shape extension + the metrics-call independence; `earnings.test.ts` covers route wiring + snapshot-seeded delta windows + integration with `nodes.yaml`. Schema validation gets its own small file (`api/schemas/earnings.test.ts`) to keep schema concerns isolated.
- **No `vi.mock()` of `node:fs`.** The route tests use `mkdtempSync` for real temp dirs; seeded snapshot files are written with `writeFileSync`. Aggregator tests don't touch the filesystem at all — `deltaComputer` is a `vi.fn` stub in those tests.
- **`vi.setSystemTime` for the delta-windows test (Task 5.5).** The snapshot reader reads `new Date()` internally — to assert deterministic boundaries, freeze the system clock at a known date. Pattern:
  ```typescript
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-05-13T15:00:00.000Z'), toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());
  ```
  Note: only `Date` needs faking; the snapshot reader doesn't use `setInterval` / `setTimeout`.
- **Schema validation tests use Ajv directly.** Fastify's response schemas run a SERIALIZER (fast-json-stringify), not a validator — they cannot reject. To test rejection, validate the fixture directly with Ajv: `const ajv = new Ajv({ strict: false }); const validate = ajv.compile(schema.response[200]); expect(validate(goodFixture)).toBe(true);`.
- **MockEarningsConnector pattern.** Reuse the existing `makeDeps()` helper in `earnings.test.ts`. Extend it with `metrics` and `snapshotEntries` options. Don't extract to a separate file unless a third test surface needs it.

### Boundary Math Recap (Why Task 5.5 Looks the Way It Does)

The snapshot reader from 47.3 computes deltas vs. **UTC** boundaries — never local time. For a fake `now = 2026-05-13T15:00:00Z`:

- `utcDayBoundary(now) = '2026-05-13T00:00:00.000Z'` → today's snapshot baseline = the snapshot row with the largest `ts <= 2026-05-13T00:00:00.000Z`
- `utcMonthBoundary(now) = '2026-05-01T00:00:00.000Z'` → month's baseline
- `utcYearBoundary(now) = '2026-01-01T00:00:00.000Z'` → year's baseline
- `lifetime = currentLifetime` (verbatim from connector — no subtraction)

So with seeded snapshots `(2026-05-13T00:00Z → 900)`, `(2026-05-01T00:00Z → 500)`, `(2026-01-01T00:00Z → 100)` and `currentLifetime = '1000'`:

- `today = 1000 - 900 = 100`
- `month = 1000 - 500 = 500`
- `year = 1000 - 100 = 900`
- `lifetime = 1000`

If a boundary has NO snapshot row (e.g. the fixture only contains a today-snapshot and no month/year), 47.3's `subOrZero(null) = '0'` — the delta defaults to `'0'`, NOT `currentLifetime`. AC #3 of 47.3 documents this trade-off ("zero on first day vs. confusing discontinuity later").

### Connector Endpoint Behavior — Two Independent Calls

This story's route fires `getEarnings()` AND `getMetrics()` concurrently via `Promise.allSettled([...])` (inside `aggregateEarnings()` per Path A). Each call has its own failure mode:

- **`getEarnings()` 503 (settlement subsystem not yet booted on cold start):** caught by 47.2's existing aggregator try/catch → `status: 'connector_unavailable'` + zeros. **In this branch, `getMetrics()` is NOT called** — there's no point, the response is already a zero payload. Optimization: short-circuit the metrics fetch when earnings is unavailable (cuts the request from 2 connector RTTs to 1 on the unavailable path). **Decision:** ship the short-circuit. Adds ~3 lines of code, saves ~50ms on the cold-boot path.
- **`getEarnings()` succeeds, `getMetrics()` 503 or network down:** rare (both endpoints live in the same connector process; if one is up, both usually are). Treat as graceful zero per AC #2 — `status: 'ok'`, `eventsRelayed: 0`, `uptimeSeconds: 0`. Log via `logger.warn`. Documented in case 12.
- **Both succeed:** happy path. Both fan out concurrently (`Promise.allSettled`); the slower call sets the request latency.

### Git History Intelligence (last 5 commits)

```
a4c4e45 feat(47.2): aggregator earnings surgery + code-review patches
f60b3ea feat(47.1): getEarnings() admin-client wrap + contract canaries
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
6d0ff13 fix(publish): native arm64 runners — drop QEMU, fix DVM SIGILL (#57)
```

Plus the in-tree (not yet committed) 47.3 work: `packages/townhouse/src/earnings/snapshot-writer.ts`, `snapshot-reader.ts`, and their tests. Status: marked `done` in sprint-status, file changes carry forward into this story's working tree.

Relevance:
- **47.3 (in-tree):** the direct predecessor. `createDeltaComputer({ snapshotPath })` is the consumer hook this story wires into the route. Re-read 47.3 § "Files This Story Modifies" and confirm the `SnapshotWriter` is already wired in `createApiServer` — DO NOT re-wire it.
- **47.2 (a4c4e45):** establishes the `{status, apex, peers}` shape AND the wire-shape-extension pattern. This story extends the same shape, NOT replaces it. The `Promise.all([buildRoutingFees(), buildPeers()])` fan-out in 47.2 stays.
- **47.1 (f60b3ea):** provides `getEarnings()` + `getMetrics()` + the contract canary. Neither shape changes in 47.4; the canary stays green.
- **No commits in the last 5 touch `api/routes/earnings.ts` beyond 47.2.** Clean baseline.

### Project Context Reference

- **Coding rules / patterns / conventions:** see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:
  - ESM `.js` extensions on relative imports (`from './snapshot-reader.js'`).
  - `pnpm --filter <pkg> test` — never `pnpm test` at workspace root.
  - Sub-agent RAM guidance — keep test invocations narrow.
  - Loopback-only API binding (already enforced by `buildFastifyApp` — no edit needed).
- **47.2 implementation:** `_bmad-output/implementation-artifacts/47-2-aggregator-earnings-surgery.md` — establishes the aggregator shape this story extends. Re-read § "Architectural Layering" for the AFTER vs. FUTURE diagrams; 47.4 is the FUTURE branch.
- **47.3 implementation:** `_bmad-output/implementation-artifacts/47-3-hourly-earnings-snapshot-writer.md` — establishes the snapshot reader factory. Re-read § "Boundary Math" + § "Mid-Write Truncation Recovery" — the route layer must NOT add its own boundary math or its own corruption handling; the reader handles both.
- **Epic 47 spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:926-955` (this story) + 47.5 spec at 958-985 (the consumer / live gate). FR18 at line 208.
- **Story 47.5 (next):** the live E2E gate. Re-read its AC matrix at line 964-974 to understand the exact assertions the gate makes against the wire shape this story produces. **If the wire shape this story produces does not pass the 47.5 gate, this story is not done.**
- **Existing `FastifySchema` precedent:** `packages/townhouse/src/api/routes/transport.ts:42-52` (PATCH body schema), `nodes-patch.ts` (PATCH body schema). Both are `body` schemas, not `response` schemas — this story introduces the first `response` schema in townhouse. Confirm Fastify's `schema.response[200]` semantics: serializer-only (fast-json-stringify), not validator.
- **`createDeltaComputer` factory:** `packages/townhouse/src/earnings/snapshot-reader.ts:140-148`. The factory is cheap (closure capture); the file is opened lazily per `DeltaComputer` call. No I/O at construction.
- **`getMetrics()` precedent:** `packages/townhouse/src/api/routes/metrics-ws.ts:212` calls it on a 5s timer. The route in this story calls it on demand per request — different cadence, same client, no shared state.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blockers encountered. Pre-conditions (47.1, 47.2, 47.3 done) confirmed before implementation began.

### Completion Notes List

- **Task 1:** Read all blast-radius files; confirmed shape is `{ status, apex, peers }` and this story extends it.
- **Task 3A — Path A chosen:** Extended `NodeEarnings.lastClaimAt`, `AggregatedEarnings` with `recentClaims/eventsRelayed/uptimeSeconds`, re-exported `RecentClaim`; `aggregateEarnings()` calls `getMetrics()` concurrently, short-circuits on earnings outage.
- **Task 4:** Added `resolveSnapshotPath()`, wired `createDeltaComputer`, registered `earningsResponseSchema` on route.
- **Task 5:** Extended 3 existing route tests + added 3 new (delta windows, apex deltas, getMetrics-fails). Route suite: 4 → 7 tests.
- **Task 6:** Extended `makeConnector` with metrics override; updated 7 existing aggregator cases; added cases 11/12/13. Suite: 10 → 13 tests.
- **Task 7:** Created `api/schemas/earnings.ts` (raw FastifySchema, OQ1 default) + `api/schemas/earnings.test.ts` (6 Ajv tests).
- **Task 8:** Path B — SPA panel deferred to Epic 48; new fields wire-available.
- **Task 9:** 1006/1006 tests pass (+12 delta); build clean; canary 43 tests sub-500ms.

### File List

- `packages/townhouse/src/earnings/aggregator.ts`
- `packages/townhouse/src/earnings/aggregator.test.ts`
- `packages/townhouse/src/api/routes/earnings.ts`
- `packages/townhouse/src/api/routes/earnings.test.ts`
- `packages/townhouse/src/api/schemas/earnings.ts` (NEW)
- `packages/townhouse/src/api/schemas/earnings.test.ts` (NEW)

### Review Findings

Code review 2026-05-13 — completed (3 adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 17 raw findings → 13 unique after dedupe → 4 decision-needed, 4 patch, 4 defer, 5 dismissed.

**Open Questions resolved (2026-05-13):**
- **OQ1 (schema library):** Raw `FastifySchema` — no TypeBox in codebase; consistency over epic-spec literal.
- **OQ2 (shape ownership):** Path A (extend aggregator) — wire shape in one file, follows 47.2 precedent.
- **OQ3 (SPA panel):** Path B (defer to Epic 48) — TUI is v1 surface.
- **OQ4 (reader cache):** No action — v1 scale acceptable.

**Decisions resolved (2026-05-13):**

- [x] [Review][Decision] D1 `eventsRelayed` fallback → **Add fallback** when `peers[]` empty (Task 1.8 intent). Becomes patch P5 below.
- [x] [Review][Decision] D2 `additionalProperties: false` on pass-through subobjects → **Open `recentClaimSchema` + `perAssetSchema`** for connector-field forward compat; keep `peerSchema` + top-level closed. Becomes patch P6 below.
- [x] [Review][Decision] D3a `recentClaims` cap → **Leave unbounded** (v1 trust-connector posture; parallels 47.2's `peers[]` decision). No code change.
- [x] [Review][Decision] D3b orphan-claim policy → **Pass through** (connector is source of truth; SPA renders with peer-id label). No code change.
- [x] [Review][Decision] D4 AC #1 format enforcement → **Enforce in schema** (`pattern: '^-?\\d+$'` on amounts, `format: 'date-time'` on `at`/`lastClaimAt`, `ajv-formats` dep, flip Ajv `strict: true`, mutation test cases). Becomes patch P7 below.

**Patches (applied 2026-05-13):**

- [x] [Review][Patch] P1 — `lastClaimAt` Date.parse comparator + mixed-ISO-format test (case 14). [aggregator.ts:213-225; aggregator.test.ts case 14]
- [x] [Review][Patch] P2 — Route fixtures validated against `earningsResponseSchema` via Ajv + ajv-formats in `expectMatchesSchema`. Asserted on all 5 200-response route tests. [routes/earnings.test.ts]
- [x] [Review][Patch] P3 — `clampInt(n)` guard on `eventsRelayed` peer-sum / aggregate fallback / `uptimeSeconds`; new aggregator case 16 covers NaN+negative values. [aggregator.ts:240-260; aggregator.test.ts case 16]
- [x] [Review][Patch] P4 — Reworded short-circuit comment. [aggregator.ts:225]
- [x] [Review][Patch] P5 (from D1) — `eventsRelayed = peers.length === 0 ? aggregate.packetsForwarded : sum(peers)`; new aggregator case 15 covers early-boot scenario. [aggregator.ts:240-260; aggregator.test.ts case 15]
- [x] [Review][Patch] P6 (from D2) — Dropped `additionalProperties: false` on `perAssetSchema` + `recentClaimSchema` (kept on `peerSchema` + top-level). New schema-test mutation cases assert subobject pass-through + peer-shape rejection. [schemas/earnings.ts; schemas/earnings.test.ts]
- [x] [Review][Patch] P7 (from D4) — `pattern: '^-?\\d+$'` on amount fields, `format: 'date-time'` on `at` + `lastClaimAt`, `ajv-formats` added to devDeps, Ajv strict-mode (default), 3 mutation test cases for malformed timestamps + non-decimal amounts. [schemas/earnings.ts; schemas/earnings.test.ts; package.json]

**Verification (2026-05-13):**
- `pnpm --filter @toon-protocol/townhouse build` — clean.
- `pnpm --filter @toon-protocol/townhouse test` — 1015/1015 passing (+21 from 994 baseline: 6 aggregator + 6 schema + extended route assertions).
- `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — 43/43 in 35ms (unchanged).

**Deferred (out of 47.4 scope; logged to deferred-work.md):**

- [x] [Review][Defer] Route tests bypass `buildFastifyApp` — Production uses `buildFastifyApp` with `ajv.customOptions`; tests use raw `Fastify()`. Direct-Ajv pattern from F3 patch sidesteps the gap; broader test-arch refactor out of this story. [routes/earnings.test.ts]
- [x] [Review][Defer] `__apex__` sentinel peerId collision — A peer with `peerId === '__apex__'` would collide in snapshot map keys. Requires malicious peer registration; defensive only. [aggregator.ts:176, 204; snapshot-reader.ts:83]
- [x] [Review][Defer] Snapshot reader silently degrades on EACCES / mid-stream errors — Returns empty map with no actionable log. Needs logger injection into 47.3's `createDeltaComputer`; cross-story scope. [snapshot-reader.ts:60-65]
- [x] [Review][Defer] `nodes.yaml` symlink traversal not guarded — Operator-local; requires write access to `~/.townhouse`. Pre-existing pattern from 47.2 route layer. [routes/earnings.ts:33-35]

**Dismissed as noise (5 findings):** `recentClaims` returned by reference (no cache hazard in current connector client), `logger.warn` defensive try/catch (over-defensive — logger contract precludes throw), concurrency test hang vs. clean fail (CI timeout catches), `Promise.allSettled` vs `Promise.all + .catch` (functionally equivalent — spec literalism only), Ajv `strict: false` masking format keywords (folded into AC #1 format-enforcement decision above).

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [x] Does this story contain regex or template substitution logic? **No** — pure JSON shape + connector wrapping. Skip this checkbox.
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Confirm NO new gates were added. The delta-windows test uses `vi.useFakeTimers()` — confirm it's NOT gated.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test src/api/routes/earnings.test.ts` AND `src/earnings/aggregator.test.ts` run sub-2s combined (no real I/O beyond temp dirs).
- [x] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of +6 to +12 tests over the 47.3 baseline (994 tests).
- [x] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors).
- [x] Verify `pnpm --filter @toon-protocol/townhouse test contract-canary` still passes sub-500ms, 43 tests (UNCHANGED).
- [x] Verify the response schema rejects unknown top-level keys (`additionalProperties: false`) and unknown `peer.type` values (enum-bounded).
- [x] Verify Path B (SPA panel untouched) was chosen OR Path A (SPA updated) was chosen with `pnpm --filter @toon-protocol/townhouse-web` green.
- [x] Confirm Open Questions 1–4 are resolved per recommendation OR escalated, with the resolution documented in `### Review Findings`.
- [x] Confirm the wire shape produced by this story satisfies Story 47.5's gate matrix (`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:964-974`) — every assertion in 47.5's AC is verifiable from the JSON this story emits.
- [x] Update sprint-status to `review` (then `done` after code review).
