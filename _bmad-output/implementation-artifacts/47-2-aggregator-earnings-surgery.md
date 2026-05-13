# Story 47.2: Aggregator Earnings Surgery

Status: done

> **Second story of Epic 47 (Earnings Data Plane) — the critical surgery that replaces the legacy packet-volume proxy with real connector earnings data.** Sized M. Depends on Story 47.1 (`done`) for the `getEarnings()` client + `EarningsResponse` type. Depends on Story 46.1 (`done`) for `PeerTypeResolver` + `nodes.yaml`. Blocks 47.3 (snapshot writer reads the same connector endpoint; aggregator's shape contract is consumed by 47.4). This story DELETES the existing `aggregateEarnings()` implementation in `packages/townhouse/src/earnings/aggregator.ts` and re-builds it on top of `connectorAdmin.getEarnings()` + `PeerTypeResolver`, changing the aggregator's return shape from `{ since, totals, by_source, items }` to `{ apex: { routingFees: PerAsset }, peers: [{ id, type, byAsset: PerAsset }] }`. The wire-shape change ripples through `api/routes/earnings.ts`, `api/routes/earnings.test.ts`, `aggregator.test.ts`, and the SPA's `townhouse-web/src/components/earnings-panel.tsx` + `townhouse-web/e2e/demo-roundtable.spec.ts`. **The dev MUST read "Ripple Effects & Out-of-Scope Surface" in Dev Notes before drafting — those decisions shape the size of the PR.**

## Story

As a **townhouse aggregator**,
I want to derive per-peer earnings from real connector data instead of packet-volume proxies,
So that the dashboard's hero number reflects actual settlement claims, not "I forwarded a lot of packets."

## Acceptance Criteria

1. **Given** the aggregator at `packages/townhouse/src/earnings/aggregator.ts`
   **When** the surgery completes
   **Then** the packet-volume proxy block (the `TODO(D4-connector-fees)` block at lines 31–36 of the existing file, plus the entire `getPacketLog`-driven flow at lines 248–267 and 293–339) is DELETED
   **And** in its place, the aggregator calls `await connectorAdmin.getEarnings()`.

2. **Given** the aggregator output shape
   **When** earnings are aggregated
   **Then** `connectorFees[]` from the connector maps to `apex.routingFees[<assetCode>]` (keyed by `assetCode`, value is a `PerAsset` — see AC #4).
   > **Spec note (carried from epic):** the original epic wording said "maps to `by_source.connector.routing_fees[assetCode]`". FR18 at `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:59` overrides that with the canonical `{apex: {routingFees: PerAsset}, peers: NodeEarnings[], ...}` shape. This story follows FR18 — see Open Question 2 in Dev Notes.

3. **Given** the per-peer mapping logic
   **When** each `peers[*].peerId` from the connector is processed
   **Then** the aggregator calls `peerTypeResolver.resolvePeerType(peerId)`
   **And** unmatched peerIds bucket as `'external'` (NOT dropped)
   **And** each peer's `byAsset` array is preserved verbatim from the connector's `AssetEarnings[]` shape.

4. **Given** the output shape
   **When** clients consume the aggregator
   **Then** the structure conforms to `{ apex: { routingFees: Record<string, PerAsset> }, peers: Array<{ id: string, type: NodeType | 'external', byAsset: Record<string, PerAsset> }> }`
   **And** each `PerAsset` value wraps `{ lifetime: string, today: string, month: string, year: string }` (all four keys present; `today`/`month`/`year` may be `'0'` until 47.3 wires the delta computer — see Open Question 1).

5. **Given** the aggregator
   **When** it executes
   **Then** there are NO calls to `connectorAdmin.getPacketLog()` for earnings derivation (packet log remains a separate metric used by other endpoints, e.g. `eventsRelayed` in 47.4 and `WsMetricsMessage`).

6. **Given** the unit tests at `packages/townhouse/src/earnings/aggregator.test.ts`
   **When** the test suite runs
   **Then** the existing test cases are rewritten to assert the new `{ apex, peers }` shape, the resolver-based peer-type mapping (including the `'external'` fallback), and graceful degradation when `getEarnings()` throws (503-from-connector OR network error).

**FRs:** FR15 (connector earnings as exclusive source), FR17 (resolver consumer with `'external'` fallback), FR18 (output shape).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/earnings/aggregator.ts` end-to-end (383 lines). This file is being DELETED and re-built. Document for yourself: (a) the exports (`aggregateEarnings`, `MAX_ITEMS`, `DEFAULT_SINCE_MS`, types `EarningsPayload`, `EarningsItem`, `AssetBucket`, `PerSourceTotals`, `EarningsSource`) — every consumer of the OLD shape must be located and updated; (b) the `loadLeases` / `buildExplorerUrl` integration via `explorer-links.ts` — these are no longer relevant to earnings derivation (recentClaims comes through the connector verbatim) and should be removed from the aggregator's import surface; (c) the `peerIdToNodeType` heuristic at lines 148–157 — this is REPLACED wholesale by `PeerTypeResolver`.
  - [x] 1.2 Read `packages/townhouse/src/earnings/aggregator.test.ts` end-to-end (293 lines). All 9 test cases currently assert the OLD `by_source` shape. Document: which tests can be DELETED outright (cases keyed on `getPacketLog` behavior — rejected packets, MAX_ITEMS cap, sinceMs, peer-id heuristic, orchestrator-unavailable), and which need to be REWRITTEN against the new shape (empty connector, full sources, partial sources, connector unavailable). The new test file targets ≥7 cases — see Task 5 for the gate matrix.
  - [x] 1.3 Read `packages/townhouse/src/api/routes/earnings.ts` end-to-end (111 lines). The route currently passes `{ connectorAdmin, orchestrator, leasesPath, sinceMs }` to `aggregateEarnings()`. After surgery, the input shape is `{ connectorAdmin, peerTypeResolver, deltaComputer? }`. The route must construct the resolver per request from `nodes.yaml` (pattern: `dirname(deps.configPath) + '/nodes.yaml'`, then `readNodesYaml` — see `api/routes/nodes-lifecycle.ts:139-140` for the established convention). The route's `?since=` query parameter becomes a no-op for 47.2 (deltas live in 47.3); decide whether to keep it as a forward-compat slot (recommended: keep with a `void since` reference + JSDoc note) or remove (simpler — recommended if no docs leak the parameter).
  - [x] 1.4 Read `packages/townhouse/src/api/routes/earnings.test.ts` end-to-end (267 lines). Every test asserts the OLD shape. Document which can be DELETED (`leases.json present/absent` — leases no longer affect earnings; `400 on non-numeric since` — only retain if `?since=` is kept) and which need REWRITING (`happy path`, `connector unreachable`). Comprehensive route coverage lands in 47.4 — keep this story's route tests minimal (3–4 cases is sufficient).
  - [x] 1.5 Read `packages/townhouse/src/registry/peer-type-resolver.ts` (36 lines) + `packages/townhouse/src/registry/__tests__/peer-type-resolver.test.ts`. Confirm: constructor takes a `NodesYaml` (NOT a path — yaml reading happens in the caller). `resolvePeerType(peerId)` returns `NodeType | 'external'`. Resolver is immutable per construction (rebuild on yaml change). The aggregator MUST receive a pre-constructed resolver — it does NOT read `nodes.yaml` itself.
  - [x] 1.6 Read `packages/townhouse/src/state/nodes-yaml.ts` (116 lines), especially `readNodesYaml(path)` at lines 69–86. Confirm: ENOENT returns `{ entries: [] }` (graceful first-run); ZodError on shape violation throws. The route layer reads the yaml and constructs the resolver fresh per request — this matches the existing pattern in `nodes-lifecycle.ts:140-144`.
  - [x] 1.7 Read `packages/townhouse/src/connector/admin-client.ts:240-325` — the `getEarnings()` method. Confirm: returns `EarningsResponse` (interfaces declared in `connector/types.ts:317-323`); throws on 503-when-disabled (connector misconfigured) and on shape drift. Document the error message regex Path B in 47.1 used: `/Connector admin API error: 503\b/` — if you want to swallow 503 in production (e.g. when settlement subsystem boots later than the API), the aggregator's try/catch must use this regex; otherwise let the error bubble.
  - [x] 1.8 Read `packages/townhouse/src/connector/types.ts:223-323` (the 6 earnings interfaces). Confirm field names exactly: `AssetEarnings.assetCode/assetScale/claimsReceivedTotal/claimsSentTotal/netBalance/lastClaimAt`, `PeerEarnings.peerId/byAsset`, `ConnectorFeeEntry.assetCode/assetScale/total`. `claimsReceivedTotal` is the value the operator earned from the peer (peer paid us); `claimsSentTotal` is what flowed the other way. **For 47.2's `lifetime` field, use `claimsReceivedTotal` — that's what "earnings" means for Drew.** See Open Question 3.
  - [x] 1.9 Read `packages/townhouse/src/docker/types.ts:9` (the `NodeType = 'town' | 'mill' | 'dvm'` definition). The aggregator's output `peers[].type` is `NodeType | 'external'`. Re-export through `connector/index.ts` or `earnings/aggregator.ts` so consumers (47.4 route, 47.3 snapshot writer, telemetry) can import without deep paths.
  - [x] 1.10 Read `packages/townhouse-web/src/components/earnings-panel.tsx:1-160` and `packages/townhouse-web/e2e/demo-roundtable.spec.ts:1-240`. These consume the OLD `EarningsPayload` shape at runtime. They define their own local `EarningsPayload` interface (NOT imported from townhouse), so TypeScript compilation will succeed — but at runtime they hit `GET /api/earnings` and parse the body. After 47.2's route change, the SPA panel renders zeros and the e2e fails. See "Ripple Effects & Out-of-Scope Surface" in Dev Notes for the recommended path.
  - [x] 1.11 Read `packages/townhouse/src/api/server.ts:31-91`. The `createApiServer` constructs `deps` and passes them to `registerEarningsRoutes(app, deps)`. The dev does NOT need to add the resolver to `ApiDeps` — the route reads `nodes.yaml` per request (matching `nodes-lifecycle.ts`).
  - [x] 1.12 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:846-924` (Story 47.2 + Story 47.3 specs). Confirm: 47.3 introduces `snapshot-writer.ts` and a delta-computer that reads `~/.townhouse/earnings-snapshots.jsonl`. 47.3 is the only place where TODAY/MONTH/YEAR deltas are computed. 47.4 wires the delta-computer into the route. **47.2 outputs `PerAsset` with `today/month/year` stubbed to `'0'` UNLESS the optional `deltaComputer` dep is provided** — that decouples 47.2 from 47.3 cleanly.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm Story 47.1 is `done` in `sprint-status.yaml` and `connectorAdmin.getEarnings()` exists at `packages/townhouse/src/connector/admin-client.ts:240`. If absent → STOP, 47.1 is the dependency.
  - [x] 2.2 Confirm `PeerTypeResolver` exists at `packages/townhouse/src/registry/peer-type-resolver.ts` and is exported from `packages/townhouse/src/index.ts:140`. If absent → STOP, Story 46.1 is the dependency.
  - [x] 2.3 Confirm `pnpm --filter @toon-protocol/townhouse build` is clean on `main` before starting (no pre-existing typecheck errors).
  - [x] 2.4 Confirm `pnpm --filter @toon-protocol/townhouse test` baseline count (currently 967 tests across 62 files after 47.1's 12 additions; this story's net delta should be roughly neutral or negative — old aggregator + route tests delete, new aggregator + route tests add, net ≈ ±2).
  - [x] 2.5 Confirm no in-flight PR is concurrently touching `packages/townhouse/src/earnings/aggregator.ts` (run `gh pr list --state open --search "earnings aggregator"`). 46.4 + 46-retro just closed; 47.1 just landed; the file should be quiescent.

- [x] **Task 3: Replace `aggregator.ts` with the new shape (AC: 1, 2, 3, 4, 5)**
  - [x] 3.1 Rewrite `packages/townhouse/src/earnings/aggregator.ts` from scratch (the existing 383-line file is being deleted entirely — the surgery is too deep for incremental edits). The new file should be ~120–180 lines. Anchor JSDoc on the new contract: "Aggregates connector-reported earnings into the canonical `{ apex, peers }` shape consumed by the host-API `/api/earnings` endpoint. Source of truth: `connectorAdmin.getEarnings()` (Story 47.1). Peer-type attribution via `PeerTypeResolver` (Story 46.1); unmatched peers bucket as `'external'`."
  - [x] 3.2 Declare the new exported types in the same file (do not split into a separate types module — they're small and tightly coupled to the aggregator):
    ```typescript
    /**
     * Per-asset cumulative + delta breakdown. `lifetime` is the connector's
     * cumulative `claimsReceivedTotal` (decimal-string bigint at `assetScale`
     * decimals). `today` / `month` / `year` are deltas computed by Story 47.3's
     * snapshot-reader; until the `deltaComputer` dep is provided, they stub
     * to '0'. Asset-scale interpretation (USD: 6, ETH: 18, sats: 0) is the
     * dashboard's job — the aggregator never collapses to a unit.
     */
    export interface PerAsset {
      lifetime: string;
      today: string;
      month: string;
      year: string;
    }

    /** Per-peer earnings entry in the aggregator output. */
    export interface NodeEarnings {
      id: string;                     // == connector peerId
      type: NodeType | 'external';    // PeerTypeResolver attribution
      byAsset: Record<string, PerAsset>;  // keyed by assetCode
    }

    /** Top-level aggregator output. */
    export interface AggregatedEarnings {
      apex: {
        routingFees: Record<string, PerAsset>;  // keyed by assetCode
      };
      peers: NodeEarnings[];
    }
    ```
    Re-export `NodeType` from `'../docker/types.js'` so consumers don't need a deep import.
  - [x] 3.3 Declare the new input shape:
    ```typescript
    export interface AggregateEarningsInput {
      connectorAdmin: ConnectorAdminClient;
      peerTypeResolver: PeerTypeResolver;
      /**
       * Optional delta computer (Story 47.3). When omitted, all PerAsset
       * `today` / `month` / `year` fields stub to '0'. The route layer (47.4)
       * wires the snapshot-backed implementation.
       */
      deltaComputer?: DeltaComputer;
    }

    /** Resolves TODAY / MONTH / YEAR deltas for a (peerId-or-apex, assetCode) tuple. */
    export type DeltaComputer = (params: {
      /** Either a connector peerId or the literal `'__apex__'` for routing-fee rows. */
      scope: string;
      assetCode: string;
      /** Current cumulative (matches the lifetime value in the response). */
      currentLifetime: string;
    }) => Promise<{ today: string; month: string; year: string }>;
    ```
    The `'__apex__'` sentinel keeps the delta-computer signature uniform across apex routing-fee rows and per-peer rows. (Alternative: a typed union — defer; sentinel is simpler and 47.3's snapshot writer can switch on it.)
  - [x] 3.4 Implement `aggregateEarnings(input: AggregateEarningsInput): Promise<AggregatedEarnings>`:
    - Call `await input.connectorAdmin.getEarnings()`. Wrap in try/catch; on any throw (503-when-disabled, network down, shape drift), return an empty payload: `{ apex: { routingFees: {} }, peers: [] }` (mirrors the legacy "connector unavailable → zero, no crash" semantics — AC #6 explicitly asserts this).
    - For `apex.routingFees`: iterate `earnings.connectorFees[]`, map each to `apex.routingFees[fee.assetCode] = { lifetime: fee.total, ...(await maybeDeltas(...)) }`. Where `maybeDeltas` calls `deltaComputer({ scope: '__apex__', assetCode: fee.assetCode, currentLifetime: fee.total })` if provided, else returns `{ today: '0', month: '0', year: '0' }`.
    - For `peers[]`: iterate `earnings.peers[]`, for each call `const type = input.peerTypeResolver.resolvePeerType(peer.peerId);`, build `byAsset: Record<string, PerAsset>` by iterating `peer.byAsset[]` and mapping each `AssetEarnings` to `PerAsset` with `lifetime: a.claimsReceivedTotal` + delta stubs/computer call.
    - Do NOT drop unmatched peers — they bucket as `type: 'external'` per AC #3 (the resolver returns `'external'` by default).
    - Concurrency: if `deltaComputer` is provided, the per-asset delta calls fan out — use `Promise.all` to parallelize within a peer (a single peer with N assets does N delta calls; do them concurrently). Across peers serial-iterate is fine (peer count is small for v1).
  - [x] 3.5 Delete the now-orphaned imports + helpers in this file: `buildExplorerUrl`, `loadLeases`, `AkashLeasesForExplorer` (no longer needed — recentClaims arrives through the connector in 47.4, not synthesized from packet log). Delete `MAX_ITEMS`, `DEFAULT_SINCE_MS` constants (items + sinceMs no longer exist).
    > **Note on `explorer-links.ts`:** keep the module file at `packages/townhouse/src/earnings/explorer-links.ts` and its tests at `explorer-links.test.ts` — they are still consumed by `presets/demo.ts` and (likely) future on-chain settlement views. This story does NOT delete that module; only removes the aggregator's import of it.
  - [x] 3.6 Add explicit JSDoc to `aggregateEarnings` documenting: input contract, output shape, failure mode philosophy (connector throw → empty payload), and the `deltaComputer` opt-in pattern.

- [x] **Task 4: Wire `nodes.yaml` → `PeerTypeResolver` into the route (AC: 3)**
  - [x] 4.1 Edit `packages/townhouse/src/api/routes/earnings.ts`. Replace the existing call site:
    ```typescript
    // BEFORE (Story D4):
    const payload: EarningsPayload = await aggregateEarnings({
      connectorAdmin: deps.connectorAdmin,
      orchestrator: deps.orchestrator,
      leasesPath,
      sinceMs,
    });
    return payload;
    ```
    with:
    ```typescript
    // AFTER (Story 47.2):
    const homeDir = dirname(deps.configPath);
    const nodesYamlPath = join(homeDir, 'nodes.yaml');
    const yaml = await readNodesYaml(nodesYamlPath); // ENOENT → { entries: [] }
    const peerTypeResolver = new PeerTypeResolver(yaml);
    const payload = await aggregateEarnings({
      connectorAdmin: deps.connectorAdmin,
      peerTypeResolver,
      // deltaComputer omitted — wired in 47.4 from 47.3's snapshot reader.
    });
    return payload;
    ```
    Imports: add `import { dirname, join } from 'node:path';`, `import { readNodesYaml } from '../../state/nodes-yaml.js';`, `import { PeerTypeResolver } from '../../registry/peer-type-resolver.js';`. Delete the `loadLeases`/`defaultLeasesPath`/`leasesPath` machinery (and `RegisterEarningsRoutesOptions`) — items + leases are out of scope post-surgery.
  - [x] 4.2 Decide on `?since=` query handling. **Recommended:** DELETE the `?since=` parsing entirely (deltas are computed against snapshot boundaries, not caller-supplied lower bounds). This removes ~20 lines of validation + the 400-on-non-numeric and 400-on-scientific-notation tests. Document the removal in the route's module JSDoc: "The `?since=` parameter from Story D4 is gone — TODAY/MONTH/YEAR deltas are anchored on UTC boundaries by the snapshot writer (Story 47.3)."
  - [x] 4.3 The route's outer try/catch on `aggregateEarnings()` is now unreachable for connector errors (the aggregator swallows them per Task 3.4) — DELETE the outer 500 path. Any throw from the route reaches Fastify's default 500 handler and that's the right outcome (it'd mean nodes.yaml is corrupt — a zod validation throw — which is operator misconfiguration that should surface clearly).
  - [x] 4.4 Update `RegisterEarningsRoutesOptions` — the `leasesPath` field is gone. If the interface no longer has any fields, delete the interface and the `opts` parameter from `registerEarningsRoutes`. Update the route registration call in `api/server.ts:60` to drop the (currently default) opts argument.

- [x] **Task 5: Rewrite `aggregator.test.ts` for the new shape (AC: 6)**
  - [x] 5.1 Delete the entire existing test file body. The 9 existing cases assert obsolete shape + obsolete inputs (`orchestrator.status()`, `getPacketLog`, `leasesPath`, `MAX_ITEMS`).
  - [x] 5.2 Build new test doubles:
    - `makeConnector(earningsResponse?: EarningsResponse | 'throw' | '503')` — `vi.fn()` for `getEarnings()`, plus stubs for `getMetrics`/`getHealth`/`getPeers`/`getPacketLog` returning empty defaults (the aggregator never calls these but the type requires the methods).
    - `makeResolver(entries: Array<{peerId:string, type:NodeType}>)` — wraps `new PeerTypeResolver({ entries: entries.map(toFullEntry) })`. `toFullEntry` fills the mandatory zod fields (`id` = peerId, `ilpAddress`, `derivationIndex`, `enabledAt`, `lastSeenAt: null`) with synthetic values.
  - [x] 5.3 Write at least the following 7 test cases:
    1. **Empty earnings** — connector returns `{ uptimeSeconds: 0, peers: [], connectorFees: [], recentClaims: [], timestamp: {iso:''} }`. Assert `result.apex.routingFees == {}` and `result.peers == []`.
    2. **Full earnings, all known peers** — 3 connector peers, all 3 known to the resolver as `town`/`mill`/`dvm`. 2 assets each. Connector reports `connectorFees: [{ assetCode:'USD', total:'1000', assetScale:6 }]`. Assert `result.apex.routingFees['USD'].lifetime === '1000'`. Assert `result.peers.length === 3` and `peers[i].type` matches. Assert `peers[0].byAsset['USD'].lifetime` matches `claimsReceivedTotal`. Assert deltas all default to `'0'`.
    3. **Unknown peer → `'external'`** — connector reports 1 peer with peerId not in nodes.yaml. Resolver returns `'external'`. Assert `result.peers[0].type === 'external'` AND the peer is NOT dropped from the array.
    4. **Connector throws** — `getEarnings` throws `Error('connector down')`. Assert `result === { apex: { routingFees: {} }, peers: [] }` (no rethrow).
    5. **Connector returns 503-when-disabled** — `getEarnings` throws `Error('Connector admin API error: 503 Service Unavailable: …')`. Assert empty payload (same as case 4).
    6. **`deltaComputer` is invoked and threads through** — provide a stub `deltaComputer` that returns `{ today: '1', month: '2', year: '3' }`. Connector reports 1 peer × 1 asset + 1 apex fee. Assert: `peers[0].byAsset[code].today === '1'` AND `apex.routingFees[code].today === '1'`. Assert `deltaComputer` was called twice — once with `scope: '__apex__'` and once with `scope: <peerId>`.
    7. **`deltaComputer` is called concurrently per peer's assets** — provide a `deltaComputer` that records call order with a delay-then-resolve pattern, and assert that for a single peer with 3 assets, the 3 calls overlap in time (alternatively: assert via call ordering that the second call started before the first resolved). This guards the `Promise.all` fan-out in Task 3.4.
  - [x] 5.4 Run `pnpm --filter @toon-protocol/townhouse test src/earnings/aggregator.test.ts` — confirm all new tests pass. Confirm zero references to `getPacketLog`, `orchestrator.status`, `leasesPath`, `by_source`, `MAX_ITEMS`, `EarningsPayload` (the OLD shape).

- [x] **Task 6: Update `api/routes/earnings.test.ts` to assert the new shape (AC: all)**
  - [x] 6.1 Delete the existing test cases that are now obsolete:
    - `leases.json absent` — leases no longer affect the route.
    - `leases.json present but no on-chain rows` — same.
    - `400 on non-numeric since` — `?since=` is gone (per Task 4.2).
    - `400 on scientific-notation since` — same.
    - `200 with explicit since lower bound` — same.
  - [x] 6.2 Rewrite the remaining cases (`happy path`, `connector unreachable`) against the new shape. Add a third case: `unknown peer appears as type: 'external'`. Keep this story's route tests narrow — comprehensive coverage (recentClaims, eventsRelayed, OpenAPI/TypeBox schema) lands in 47.4.
  - [x] 6.3 Update test doubles: `makeDeps` no longer needs `orchestrator.status` mocks (the aggregator doesn't use it); it does need `connectorAdmin.getEarnings`. The route reads `nodes.yaml` per request — tests need to either point the route at a temp dir with a real (or empty) `nodes.yaml`, or accept the ENOENT-→-empty fallback. Recommended: use `mkdtempSync` to build a temp `~/.townhouse`-like dir, write a minimal `nodes.yaml` matching the test's peer set, set `configPath` to `<temp>/config.yaml`. The route reads `<temp>/nodes.yaml` via `dirname(configPath)`.
  - [x] 6.4 Verify the route returns `Content-Type: application/json` and the response body parses as `AggregatedEarnings`. Import the type from `'../../earnings/aggregator.js'`.

- [x] **Task 7: Decide ripple-effect scope: SPA panel + demo-roundtable e2e (AC: out-of-band)**
  - [x] 7.1 Read "Ripple Effects & Out-of-Scope Surface" in Dev Notes. Two paths:
    - **Path A (recommended):** update `packages/townhouse-web/src/components/earnings-panel.tsx` + `earnings-panel.test.tsx` to consume `AggregatedEarnings` (apex bucket + per-peer rows, with a "deltas pending" placeholder for today/month/year until 47.3/47.4). Update `packages/townhouse-web/e2e/demo-roundtable.spec.ts` shape assertions accordingly. Lands in the same PR as 47.2.
    - **Path B:** leave the SPA broken. Add a note to the PR description listing the affected files. Open a follow-up story under Epic 48 or 49 for the SPA migration. The CI `pnpm -r build` still passes (the SPA file defines its own local types), but the runtime + e2e assertions break.
  - [x] 7.2 If Path A: rewrite `earnings-panel.tsx` to render the apex routing-fee row + a peer table grouped by `type`. Empty-state copy for `apex.routingFees == {}` and `peers == []`. Skip delta columns (or render `—`) when `today === '0' AND month === '0' AND year === '0'` (proxy for "deltas not yet wired"). Update `earnings-panel.test.tsx` sample payloads to match.
  - [x] 7.3 If Path A: rewrite `demo-roundtable.spec.ts` shape guard from `body.by_source` to `body.apex.routingFees` + `body.peers`. Note that this e2e runs against the `townhouse demo` preset, not `townhouse hs up` — confirm the demo preset still wires the connector with `accountManager`/`claimReceiver` (it probably does; if not, the demo's earnings endpoint will return empty post-surgery and the e2e needs to assert the empty case).
  - [x] 7.4 Either path: document the choice in `### Review Findings` at story close-out.

- [x] **Task 8: Update consumers, exports, and docs (AC: all)**
  - [x] 8.1 The aggregator's exported types changed. Search for external consumers:
    - `grep -rn "from '.*earnings/aggregator'" packages/townhouse/src/` — currently 1 consumer (`api/routes/earnings.ts` — handled in Task 4). Any new consumer found must be updated.
    - `grep -rn "EarningsPayload\b\|by_source\b\|PerSourceTotals\b\|EarningsSource\b\|AssetBucket\b" packages/townhouse/src/` — should return zero matches after the surgery (these names are deleted).
  - [x] 8.2 Re-export new types from `packages/townhouse/src/index.ts` if the package surface needs them for downstream packages (telemetry, TUI). Recommended: re-export `AggregatedEarnings`, `NodeEarnings`, `PerAsset`, `DeltaComputer` alongside the existing earnings module exports. Place them in the same section as the Story 46.1 exports (`PeerTypeResolver` neighborhood).
  - [x] 8.3 The `loadLeases` / `buildExplorerUrl` exports in `earnings/explorer-links.ts` are still used by `presets/demo.ts` — leave them alone. Do NOT delete that file.
  - [x] 8.4 Update `packages/sdk/CONNECTOR_MIGRATION.md` is NOT required for this story (no connector contract change — the consumer changes inside Townhouse only). The migration doc gets a new entry from 47.3 (snapshot writer) and/or 47.4 (route shape) if those stories alter the consumer pattern further.

- [x] **Task 9: Verify, lint, and prepare for code review (AC: all)**
  - [x] 9.1 `pnpm --filter @toon-protocol/townhouse build` — must be clean. The type changes ripple — every consumer of the old `aggregator.ts` exports must now consume the new types or compile-break.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse test` — full unit suite green. Expect a net delta of roughly +0 ± 5 tests (old aggregator suite was 9 cases, new is ≥7; old route suite was 6 cases, new is 3). If the suite shrinks materially (>15 tests lost), re-examine: deletion-by-default is acceptable for obsolete coverage, but make sure new shape coverage isn't thin.
  - [x] 9.3 `pnpm --filter @toon-protocol/townhouse test src/earnings/` — earnings module tests must run sub-1s (the new aggregator has no I/O, all `vi.fn` stubs).
  - [x] 9.4 `pnpm eslint` on townhouse — no new warnings/errors. Watch for `no-unused-vars` on the deleted `orchestrator`/`leasesPath` imports — those imports must be removed, not commented out.
  - [x] 9.5 If Path A in Task 7: `pnpm --filter @toon-protocol/townhouse-web build && pnpm --filter @toon-protocol/townhouse-web test` — SPA build + component tests green.
  - [x] 9.6 `pnpm --filter @toon-protocol/townhouse test contract-canary` — still sub-500ms, 43 tests, unchanged (this story does NOT touch the canary).
  - [x] 9.7 Self-review against the AC list. Confirm: (a) no `getPacketLog` call remains in the aggregator code path; (b) every peer is bucketed (none dropped); (c) the `'external'` case is exercised in tests; (d) connector failures gracefully degrade to empty payload; (e) the wire shape matches FR18.
  - [x] 9.8 Update sprint-status to `review`. Populate `### Review Findings` with a dated entry noting any deviations from the recommended defaults (Open Questions 1/2/3, Path A vs B).

## Dev Notes

### Story Mission — Replace the Proxy, Not the Plumbing

This is the **earnings-truth** story for Epic 47. Until now, the dashboard's earnings number was a packet-volume proxy: the aggregator counted fulfilled ILP packets passing through the connector and reported the sum as "sats earned". That number had no relationship to actual settlement claims — a peer could push a billion packets and the connector might have paid them all back out. Story 47.1 added the typed wrap around `GET /admin/earnings.json`. This story uses it: the aggregator now derives `apex.routingFees` from `connectorFees[]` and per-peer earnings from `peers[*].byAsset[*].claimsReceivedTotal` — both of which are real settlement-claim totals tracked by the connector's claim receiver.

The peer-type resolution is the second half of the surgery. The current aggregator uses a substring-match heuristic (`peerId.includes('town')`) plus an orchestrator-status cross-reference. Both are replaced by `PeerTypeResolver` (Story 46.1), which is fed from `~/.townhouse/nodes.yaml` — the operator-managed source of truth for which peerIds correspond to which node types. Peers connected to the operator's connector that are NOT in `nodes.yaml` (e.g. a partner's relay, a mill counterparty, a manually-added peer for testing) bucket as `'external'`. They appear in the response so Drew sees them; they're not aggregated under any of the four legacy buckets because they don't belong to the operator.

**Hard rules** for this story:

1. **No `getPacketLog` in the earnings path.** The packet log remains as a metric (used by 47.4's `eventsRelayed` and by the metrics-ws), but it MUST NOT participate in earnings derivation post-surgery. AC #5 is explicit.
2. **No silent peer drops.** Unknown peerIds bucket as `'external'`, never disappear. AC #3.
3. **Connector failure → empty payload, no rethrow.** The aggregator preserves the legacy "graceful degradation" semantics — if `getEarnings()` throws (network, 503, shape drift), return `{ apex: { routingFees: {} }, peers: [] }`. Operators see zeros, not 5xx errors. The route layer no longer needs an outer try/catch.
4. **`PeerTypeResolver` is INJECTED, not constructed inside the aggregator.** The aggregator never reads `nodes.yaml`. The route reads it per request and constructs the resolver fresh — this matches the established pattern in `nodes-lifecycle.ts` and lets tests pass a stub resolver without filesystem fixtures.
5. **`deltaComputer` is OPTIONAL.** 47.2 stubs the today/month/year fields to `'0'` when no computer is provided. 47.3 ships the computer; 47.4 wires it. Do NOT inline a stub snapshot reader in 47.2 — that's 47.3's surface.
6. **No wire-shape preservation hacks.** Do not add a "by_source adapter" to the route to keep the old SPA dashboard alive. Either update the SPA in the same PR (Path A — recommended) or document it as broken and schedule the migration separately (Path B). See "Ripple Effects" below. CLAUDE.md global rule: avoid backwards-compat hacks.

### Open Question 1 — `PerAsset` shape vs 47.3/47.4 layering

AC #4 specifies `PerAsset = { lifetime, today, month, year }`. 47.2 only knows `lifetime` (cumulative `claimsReceivedTotal` from the connector). 47.3 produces the deltas via the snapshot writer. 47.4 wires the route.

**Three possible interpretations:**

1. **(Recommended)** 47.2 outputs `PerAsset` with all 4 keys; today/month/year default to `'0'`. An optional `deltaComputer` dep, when provided, overrides the stubs. 47.3 implements the computer; 47.4 passes it in. **Pro:** AC satisfied verbatim; shape stable from the moment 47.2 ships; 47.4 needs zero shape munging. **Con:** the `'0'` strings are technically wrong (no claim happened "today" matching `lifetime - 0`, the delta is unknown) — but Drew sees `today: '0'` instead of an error, which is the legacy behavior anyway.
2. 47.2 outputs `PerAsset = { lifetime: string }` only — narrower shape. 47.3 widens it. **Pro:** honest. **Con:** violates AC #4 (says 4 keys); also forces 47.4 to widen the shape at the route layer; bigger surface for 47.4.
3. 47.2 takes a required `deltaComputer` dep and stubs it inside the route layer until 47.3 lands. **Pro:** no `'0'` placeholders. **Con:** the stub still emits `'0'` strings, just hidden in the route; adds a doomed-to-be-deleted indirection.

**Default action:** dev implements (1). If the dev disagrees, escalate to Alice (PM) or Winston (architect) BEFORE merging.

### Open Question 2 — AC #2 wording vs FR18 shape

The epic spec at line 863 says: "`connectorFees[]` from the connector maps to `by_source.connector.routing_fees[assetCode]`". This is leftover legacy phrasing — the canonical shape per FR18 (`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:59`) is `{apex: {routingFees: PerAsset}, peers: NodeEarnings[]}`. AC #4 of this story (the same epic spec, three ACs down) defines the canonical shape. There's no `by_source` in the new model.

**Default action:** follow FR18 + AC #4. The `connectorFees[]` mapping target is `apex.routingFees[assetCode]`. The `by_source` phrasing in AC #2 is treated as an editorial leftover from the D4-era shape that this story is replacing. Document the resolution in `### Review Findings` at close-out. If the dev disagrees, escalate to Alice.

### Open Question 3 — `claimsReceivedTotal` vs `claimsSentTotal` for `lifetime`

The connector's `AssetEarnings` ships both `claimsReceivedTotal` (peer paid us) and `claimsSentTotal` (we paid the peer). Which one is "earnings"?

**Recommended:** `claimsReceivedTotal`. The dashboard's hero number is "what Drew earned" — value flowing IN from each peer. `claimsSentTotal` is what he paid OUT (e.g. settlement to a downstream peer). The new `PerAsset.lifetime` MUST be `claimsReceivedTotal`. If a future view needs net (`claimsReceivedTotal - claimsSentTotal`), expose it as `netBalance` (which the connector also ships) on the same `byAsset` row — but that's a separate feature, not in 47.2's AC.

If the dev finds the connector's semantics ambiguous (e.g. a routing-fee scenario where the operator's connector both receives a claim from peer A and forwards it to peer B), check `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts:1865-1945` for the handler's interpretation. The `connectorFees[]` array is the routing-fee delta (received-minus-forwarded for fee-eligible flows), so the per-peer `claimsReceivedTotal` doesn't double-count fees.

**Default action:** use `claimsReceivedTotal`. Document if the dev disagrees.

### Open Question 4 — Concurrent vs serial `deltaComputer` calls

Task 3.4 says: parallelize delta calls within a peer via `Promise.all`. The rationale: a peer with 5 assets × delta-each-takes-50ms = 250ms serial vs 50ms parallel. At v1 scale (≤3 nodes × ≤3 assets each), the difference is negligible. The parallel pattern matters more when the snapshot reader (47.3) does real I/O.

**Default action:** implement `Promise.all` per-peer. If the dev wants to defer to 47.3 to introduce parallelism only when needed, that's acceptable — but document the trade-off and add a TODO at the serial-iteration point.

### Ripple Effects & Out-of-Scope Surface

The aggregator's exported type changes from `EarningsPayload` (with `by_source`, `items`, `totals`, `since`) to `AggregatedEarnings` (with `apex`, `peers`). Every consumer of the old shape breaks.

**Direct consumers in this repo:**

| File | Path | Action |
|------|------|--------|
| Aggregator unit tests | `packages/townhouse/src/earnings/aggregator.test.ts` | DELETE + rewrite — Task 5 |
| Earnings route | `packages/townhouse/src/api/routes/earnings.ts` | UPDATE — Task 4 |
| Earnings route tests | `packages/townhouse/src/api/routes/earnings.test.ts` | DELETE + rewrite — Task 6 |
| SPA panel | `packages/townhouse-web/src/components/earnings-panel.tsx` | Path A: UPDATE; Path B: KNOWN BROKEN — Task 7 |
| SPA panel tests | `packages/townhouse-web/src/components/earnings-panel.test.tsx` | Path A: UPDATE; Path B: KNOWN BROKEN — Task 7 |
| Demo e2e | `packages/townhouse-web/e2e/demo-roundtable.spec.ts` | Path A: UPDATE; Path B: KNOWN BROKEN — Task 7 |

**Path A vs Path B trade-off:**

- **Path A (recommended):** ship aggregator + route + SPA + e2e in one PR. The SPA's earnings-panel migrates to the new shape with placeholder rendering for deltas (`—` until 47.3/47.4 light them up). The demo e2e shape guard updates accordingly. Larger PR (~6–8 files modified) but no broken consumers. **This is the honest, no-half-finished-implementation path** per CLAUDE.md.
- **Path B:** ship aggregator + route only. SPA + e2e are known-broken at runtime; build still passes because the SPA defines its own local `EarningsPayload` type. Smaller PR (~3 files) but a deliberate regression. Requires a follow-up story to migrate the SPA — schedule with Alice (PM) before opening the PR.

**Default action:** Path A unless Alice (PM) explicitly says hs-v1 is shipping with the SPA dashboard deprecated. If Path B, the dev MUST cite the PM decision in `### Review Findings` and open the follow-up issue/story.

### Architectural Layering — What This Story Changes

```
BEFORE (Story D4):
  aggregator.ts
    ├── reads connector packet log (multiple peer addresses)
    ├── uses orchestrator.status() + peerIdToNodeType() heuristic for peer→type
    ├── loads leases.json for explorerUrl synthesis
    ├── emits { since, totals, by_source: { relay|mill|dvm|connector }, items[] }

  /api/earnings route
    └── passes through aggregator output verbatim

  townhouse-web SPA earnings-panel
    └── consumes { by_source.relay.sats, by_source.mill.sats, … }

AFTER (Story 47.2):
  aggregator.ts
    ├── reads connector earnings (single call)
    ├── uses PeerTypeResolver (from injected nodes.yaml snapshot)
    ├── (optional) calls deltaComputer for today/month/year
    ├── emits { apex: { routingFees }, peers: [{ id, type, byAsset }] }

  /api/earnings route
    ├── reads nodes.yaml → constructs resolver per request
    └── passes resolver into aggregator; emits AggregatedEarnings

  townhouse-web SPA earnings-panel
    └── Path A: consumes { apex.routingFees, peers[].byAsset } + delta placeholders
    └── Path B: broken until follow-up story

Future (Story 47.3 + 47.4):
  snapshot-writer.ts (47.3)
    ├── hourly tick: writes (peerId, assetCode, claimsReceivedTotal) → JSONL
    └── delta-reader: computes TODAY/MONTH/YEAR/LIFETIME from snapshots

  /api/earnings route (47.4)
    ├── (existing) reads nodes.yaml → resolver
    ├── (47.4) constructs deltaComputer from snapshot-reader
    └── (47.4) extends response with recentClaims + eventsRelayed + uptimeSeconds
```

### Test Strategy Notes

- **Unit test coverage MUST exercise the `'external'` peer bucket.** A connector with a peer that nodes.yaml doesn't know about returns `type: 'external'` — that's a load-bearing contract for 47.4 (the SPA / TUI renders external peers separately) and 47.5 (the live gate explicitly tests this).
- **No `vi.mock` calls.** Use `vi.fn` stubs for `ConnectorAdminClient` methods. The resolver is a real `PeerTypeResolver` constructed from a stub `NodesYaml` — testing a stub resolver class would dupe the 46.1 test surface.
- **Snapshot tests are NOT recommended.** The new shape is small and stable; explicit `.toEqual` / `.toMatchObject` assertions are clearer and don't suffer from "snapshot rot".
- **No I/O in the aggregator unit tests.** The route tests handle nodes.yaml reading via `mkdtempSync`; the aggregator tests pass a pre-built resolver.
- **The route tests use a temp dir for nodes.yaml.** Pattern (see `nodes-lifecycle.ts:140` for the production read site):
  ```typescript
  const tmpHome = mkdtempSync(join(tmpdir(), '47-2-route-'));
  await writeFile(join(tmpHome, 'nodes.yaml'), yamlStringify({ entries: [...] }), { mode: 0o600 });
  const deps: ApiDeps = { configPath: join(tmpHome, 'config.yaml'), … };
  // route reads <tmpHome>/nodes.yaml via dirname(configPath)
  ```
  Clean up with `rmSync(tmpHome, { recursive: true, force: true })` in `afterEach`.

### Connector Endpoint Behavior — 503 Path

Per Story 47.1's Edge Case A: `GET /admin/earnings.json` returns 503 when `accountManager` or `claimReceiver` are missing from the connector's config. Townhouse's apex (configured by `writeHsConnectorConfig`) wires both — production never hits 503 except during cold-boot when the settlement subsystem hasn't initialized yet.

The aggregator's `try/catch` in Task 3.4 catches the 503 (and any other error) and returns the empty payload. This is the right semantics for Drew: a fresh `townhouse hs up` may briefly return empty earnings before the connector finishes settlement-subsystem boot — better that than a 5xx error in the SPA.

Do NOT try to distinguish 503-from-disabled vs 503-from-bug in the aggregator. That's a route-layer concern (47.4 might emit a "settlement subsystem not ready" hint header) or a metrics concern (oncall paging on persistent 503s). 47.2's aggregator just returns empty.

### Git History Intelligence (last 5 commits)

```
f60b3ea feat(47.1): getEarnings() admin-client wrap + contract canaries
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
6d0ff13 fix(publish): native arm64 runners — drop QEMU, fix DVM SIGILL (#57)
4f2aa88 fix(townhouse-hs): bump connector pin to 3.6.2 + opt peers into direct transport (#56)
```

Relevance to this story:
- **#f60b3ea (47.1):** the direct predecessor. Adds `connectorAdmin.getEarnings()` + the 6 earnings interfaces. This story is the first consumer. Re-read 47.1's `### Review Findings` for context on the EarningsTimestamp wrap, the 503 behavior, and the deferred work items (body-read outside timeout, non-ISO timestamp slip, etc.) — those don't block 47.2 but may surface during the new tests.
- **#a4124af (Epic 46 close):** Epic 46 introduced `PeerTypeResolver` (story 46.1), `nodes.yaml` (story 46.1), and the lifecycle CLI verbs (46.3). 47.2 is the first downstream consumer of `PeerTypeResolver` outside the reconciler — exercise it.
- **#56 (4f2aa88):** bumped connector image to v3.6.2 + added per-peer `transport: 'direct'` option. The connector's `/admin/earnings.json` is unchanged; 47.2 inherits 47.1's coverage.
- **No commits in the last 5 touch `packages/townhouse/src/earnings/` or `packages/townhouse-web/src/components/earnings-panel.*`.** Clean baseline for the surgery.

### Files This Story Modifies

- `packages/townhouse/src/earnings/aggregator.ts` — DELETE + rewrite. Net delta: −383 lines old + ~150 lines new = ~−230 net.
- `packages/townhouse/src/earnings/aggregator.test.ts` — DELETE + rewrite. Net delta: −293 lines old + ~200 lines new = ~−90 net.
- `packages/townhouse/src/api/routes/earnings.ts` — UPDATE (remove leases/since machinery, wire resolver). Net delta: −60 lines old + ~30 lines new = ~−30 net.
- `packages/townhouse/src/api/routes/earnings.test.ts` — DELETE + rewrite. Net delta: −267 lines old + ~120 lines new = ~−145 net.
- `packages/townhouse/src/api/server.ts` — small edit (drop opts arg if `RegisterEarningsRoutesOptions` is deleted). Net delta: ~−1 line.
- `packages/townhouse/src/index.ts` — re-export new types if Task 8.2 is followed. Net delta: ~+4 lines.
- **Path A only:**
  - `packages/townhouse-web/src/components/earnings-panel.tsx` — UPDATE to new shape. Net delta: ~−30 / +60 lines.
  - `packages/townhouse-web/src/components/earnings-panel.test.tsx` — UPDATE sample payloads. Net delta: ~±50 lines.
  - `packages/townhouse-web/e2e/demo-roundtable.spec.ts` — UPDATE shape guard. Net delta: ~±20 lines.

### Files This Story Does NOT Modify

- `packages/townhouse/src/connector/admin-client.ts` — `getEarnings()` is consumed unchanged.
- `packages/townhouse/src/connector/types.ts` — the 6 earnings interfaces are consumed unchanged.
- `packages/townhouse/src/connector/contract-canary.test.ts` — 47.1's stub canary is untouched.
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — 47.1's real-image canary is untouched.
- `packages/townhouse/src/earnings/explorer-links.ts` + tests — kept; still used by `presets/demo.ts`.
- `packages/townhouse/src/registry/peer-type-resolver.ts` — consumed unchanged.
- `packages/townhouse/src/state/nodes-yaml.ts` — consumed unchanged.
- `packages/townhouse/src/constants.ts` — no connector pin bump in this story.
- `packages/sdk/CONNECTOR_MIGRATION.md` — no contract change in this story (Townhouse-internal refactor).
- `packages/townhouse/src/api/routes/metrics-ws.ts` and `wallet*`, `wizard*`, `transport*`, `nodes*` — out of scope.
- Anything under `packages/mill/`, `packages/sdk/`, `packages/core/` — out of scope.

### Project Context Reference

- **Coding rules / patterns / conventions:** see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:
  - ESM `.js` extensions on relative imports (`from './aggregator.js'`).
  - `pnpm --filter <pkg> test` pattern — never `pnpm test` at workspace root.
  - Sub-agent RAM guidance — keep test invocations narrow.
- **Connector contract / migration discipline:** `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` and `packages/sdk/CONNECTOR_MIGRATION.md`. No migration entry needed for 47.2 (Townhouse-internal change).
- **Story 47.1:** `_bmad-output/implementation-artifacts/47-1-sdk-get-earnings-wrap-and-contract-canary.md` — predecessor, locks the `getEarnings()` contract and the 6 earnings interfaces this story consumes.
- **Epic 46 retros:** `_bmad-output/auto-bmad-artifacts/epic-46-retro-report.md` — no direct blocker; A2' (connector-pin SoT) is parallel structural work unrelated to this story.
- **Epic 47 spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:846-925` (this story) and the surrounding stories 47.1 / 47.3 / 47.4 / 47.5 for downstream context. FR15/FR17/FR18 at lines 205–208.
- **PeerTypeResolver origin:** Story 46.1 + retro at `_bmad-output/implementation-artifacts/46-1-*.md`. Architectural rule (Epic 46 planning §Architectural Layering): downstream consumers MUST call through the resolver — never hardcode peer-to-type mappings.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-12)

### Debug Log References

No blockers. 7 aggregator tests + 3 route tests + 428 SPA tests all green. Fixed two `Array<T>` lint errors and two `getByText`/`getByLabelText` ambiguity issues in test assertions.

### Completion Notes List

- ✅ Deleted 383-line D4-era aggregator (getPacketLog proxy, peerIdToNodeType heuristic, leasesPath, sinceMs, by_source shape). Rebuilt as ~130-line aggregator on `connectorAdmin.getEarnings()` + `PeerTypeResolver`.
- ✅ New exported types: `PerAsset`, `NodeEarnings`, `AggregatedEarnings`, `AggregateEarningsInput`, `DeltaComputer`. Re-exported `NodeType` from `../docker/types.js`.
- ✅ Route `earnings.ts` stripped from 111 lines to 30 lines: `?since=` gone, leasesPath gone, outer try/catch gone, `RegisterEarningsRoutesOptions` deleted.
- ✅ Aggregator test suite: 9 obsolete cases deleted, 7 new cases written (all required by AC #6, including concurrent `Promise.all` fan-out proof via suspend-until-all-started pattern).
- ✅ Route test suite: 7 obsolete cases deleted, 3 new cases written.
- ✅ Path A: `earnings-panel.tsx` rewritten for `AggregatedEarnings` (apex routing fees + peer table). Delta columns hidden when all delta fields are '0'. `earnings-panel.test.tsx` + `demo-roundtable.spec.ts` updated.
- ✅ New types re-exported from `packages/townhouse/src/index.ts`.
- ✅ Net test delta: 967 → 961 (−6 = deleted 16 obsolete, added 10 new). Within acceptable range.
- ✅ Builds clean: townhouse + townhouse-web. Contract canary: 43 tests, 34ms.

### File List

- `packages/townhouse/src/earnings/aggregator.ts` — REWRITTEN (383 lines → ~130 lines)
- `packages/townhouse/src/earnings/aggregator.test.ts` — REWRITTEN (293 lines → ~210 lines)
- `packages/townhouse/src/api/routes/earnings.ts` — REWRITTEN (111 lines → 30 lines)
- `packages/townhouse/src/api/routes/earnings.test.ts` — REWRITTEN (267 lines → ~120 lines)
- `packages/townhouse/src/index.ts` — added Story 47.2 type re-exports (+7 lines)
- `packages/townhouse-web/src/components/earnings-panel.tsx` — REWRITTEN for AggregatedEarnings shape
- `packages/townhouse-web/src/components/earnings-panel.test.tsx` — REWRITTEN for new shape
- `packages/townhouse-web/e2e/demo-roundtable.spec.ts` — updated AC-D10-3 + AC-D10-4 shape guards

### Review Findings

**Date:** 2026-05-12

**Open Question 1 (PerAsset shape):** Implemented recommendation (1) — all 4 keys present; today/month/year stub to '0' until 47.3 wires the `deltaComputer`. Optional `DeltaComputer` dep added for clean layering.

**Open Question 2 (AC #2 vs FR18):** Followed FR18. `connectorFees[]` maps to `apex.routingFees[assetCode]`. The "by_source.connector.routing_fees" phrasing in the original AC #2 is treated as D4-era editorial leftover — FR18's canonical shape takes precedence.

**Open Question 3 (claimsReceivedTotal vs claimsSentTotal):** Used `claimsReceivedTotal` for `lifetime` — value flowing IN from each peer.

**Open Question 4 (concurrent deltaComputer):** Implemented `Promise.all` fan-out within each peer. Test case 7 proves concurrency via suspend-until-all-started pattern.

**Path A vs Path B:** Path A chosen. SPA panel, tests, and demo-roundtable e2e updated in this story. Delta columns hidden when all three delta fields are '0' (placeholder until 47.3/47.4 wire the snapshot reader).

---

**Reviewer findings — 2026-05-12 (bmad-code-review, Opus 4.7)**

Triage of 43 raw findings across three review layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) → 28 unique → 2 decision-needed, 19 patch, 7 defer, 9 dismissed as noise. All 6 ACs satisfied at the code level; the gaps are around robustness (error paths, defensive access, test coverage of branches the spec didn't enumerate).

**Decisions resolved (2026-05-12):**

- **D1 — Operator visibility regression:** Chosen: **option (b) — add `status: 'ok' | 'connector_unavailable'` field to the wire shape and render a banner in the SPA.** Rationale: lands the wire-shape change in 47.2 (the surgery story) rather than bolting it onto 47.4. 47.3/47.4/47.5 build on top of the new shape. Expanded into patches P20–P23 below.
- **D2 — Unbounded `peers[]` cap:** Chosen: **leave unbounded.** Rationale: Drew's v1 fleet is ≤3 nodes; connector is operator-trusted; capping is YAGNI today. Moved to deferred (see deferred-work entry).

**Patch:**

- [x] [Review][Patch] **[BLOCKER] Malformed `nodes.yaml` → 500 with leaked ZodError; route lacks outer try/catch** — `readNodesYaml` throws ZodError on shape violation (`type` not in enum, etc.); surfaces as Fastify 500 with stringified Zod error in body. Tests don't cover this path. Wrap in try/catch returning structured 500 (pattern from `nodes-lifecycle.ts:142-152`), plus add a test that writes a malformed `nodes.yaml`. [`packages/townhouse/src/api/routes/earnings.ts:24-30`]
- [x] [Review][Patch] **`deltaComputer` rejection bubbles through `Promise.all`, breaking "graceful empty" contract** — `maybeDeltas()` has no try/catch. A single rejected delta (e.g. corrupt snapshot file in 47.3) blows up the entire aggregate. Wrap the `deltaComputer(...)` call in try/catch returning `'0'` stubs on reject. [`packages/townhouse/src/earnings/aggregator.ts:74-82`]
- [x] [Review][Patch] **Aggregator swallows `getEarnings()` errors without logging** — Inject Fastify logger (or `deps.logger`) and emit `logger.warn({ err }, 'aggregator: getEarnings failed, returning empty payload')` in the catch block. Pairs with the decision above. [`packages/townhouse/src/earnings/aggregator.ts:101-105`]
- [x] [Review][Patch] **Defensive-access regression on hero + peer cells** — `apexEntries[0][1].lifetime` and `firstAsset[1].lifetime` can throw on malformed `byAsset` (the deleted "Home.test mocks /api/earnings with arbitrary shapes. Never crash" comment documented a real concern). Add optional-chain `?.lifetime ?? '0'`. [`packages/townhouse-web/src/components/earnings-panel.tsx:hero + PeerRow`]
- [x] [Review][Patch] **"Hide delta column" test asserts global absence — won't catch per-row regression** — `queryByText(/today/i)` global match passes for both intended and broken behavior. Add a mixed-row payload (apex non-zero, peer zero) and assert per-row visibility. [`packages/townhouse-web/src/components/earnings-panel.test.tsx:447-452`]
- [x] [Review][Patch] **`[case 7]` concurrency test proves only intra-peer fan-out, not apex+peer concurrency** — `connectorFees: []` in fixture excludes apex; `pendingCount === 3` matches 3 assets on one peer only. Extend fixture with 1 apex fee + assert `pendingCount === 4` (or split into two tests). [`packages/townhouse/src/earnings/aggregator.test.ts:case 7`]
- [x] [Review][Patch] **No test for `deltaComputer` rejection path** — Bundle with the P2 fix: assert empty payload (or `'0'`-stub-on-failed-asset, depending on chosen semantics). [`packages/townhouse/src/earnings/aggregator.test.ts`]
- [x] [Review][Patch] **No test for peer with empty `byAsset: []`** — Common case at first launch (peer connected, zero claims). Aggregator emits `byAsset: {}`; SPA `PeerRow` should render the empty state. Add one case. [`packages/townhouse/src/earnings/aggregator.test.ts`]
- [x] [Review][Patch] **No test for mixed known/unknown peers** — Cases 2 (all known) and 3 (all unknown) bracket the matrix; the realistic 3-peer/1-known case is uncovered. Add one case. [`packages/townhouse/src/earnings/aggregator.test.ts`]
- [x] [Review][Patch] **`dirname(deps.configPath) + 'nodes.yaml'` coupling is brittle and undocumented** — Convention asserted, not enforced; moving config.yaml relative to nodes.yaml silently buckets every peer as `'external'`. Extract `resolveNodesYamlPath(deps): string` shared with `nodes-lifecycle.ts`, OR add a code comment. [`packages/townhouse/src/api/routes/earnings.ts:25-26`]
- [x] [Review][Patch] **`[case 7]` asserts `pendingCount === 3` but not that resolved deltas reach the output** — Assert `peers[0].byAsset[asset].today === '<delta-value>'` after Promise.all resolves. [`packages/townhouse/src/earnings/aggregator.test.ts:case 7 final assertion`]
- [x] [Review][Patch] **`AggregateEarningsInput` + `DeltaComputer` re-export missing from `index.ts`** — 47.4 will pass a real `deltaComputer`; without the export, callers reconstruct the input type or import internals. [`packages/townhouse/src/index.ts`]
- [x] [Review][Patch] **`NODE_TYPE_LABEL[peer.type]` returns `undefined` for unexpected types** — Add fallback: `NODE_TYPE_LABEL[peer.type] ?? 'Unknown'`. [`packages/townhouse-web/src/components/earnings-panel.tsx:NODE_TYPE_LABEL site`]
- [x] [Review][Patch] **Aggregator docstring claims `'external'` enforcement that's actually in `PeerTypeResolver`** — One-line comment correction. [`packages/townhouse/src/earnings/aggregator.ts:~module-docstring`]
- [x] [Review][Patch] **`writeNodesYaml` test helper writes JSON, not YAML — misleading name** — If `readNodesYaml` ever tightens to reject non-YAML, test passes but prod breaks. Use `yaml.stringify` from the YAML library, OR rename helper to acknowledge the JSON-happens-to-be-valid-YAML hack. [`packages/townhouse/src/api/routes/earnings.test.ts:writeNodesYaml helper`]
- [x] [Review][Patch] **`AggregatedEarnings` type duplicated in `earnings-panel.tsx` instead of imported** — Re-exported per Task 8.2; SPA panel doesn't consume it. e2e self-redeclare is justified ("lock the wire contract independently"); panel has no such justification. [`packages/townhouse-web/src/components/earnings-panel.tsx:24-44`]
- [x] [Review][Patch] **Test doesn't assert `getPacketLog` was NEVER called** — AC #5 satisfied at code level (grep); add defensive `expect(connector.getPacketLog).not.toHaveBeenCalled()` to lock it. [`packages/townhouse/src/earnings/aggregator.test.ts`]
- [x] [Review][Patch] **Hero `aria-label` divergence: `'Apex routing fees: 0 USD'` vs `'Apex routing fees: 0'`** — Normalize to a single canonical form for semantically equivalent empty states. [`packages/townhouse-web/src/components/earnings-panel.tsx:hero aria-label`]
- [x] [Review][Patch] **`byAsset` array-in / record-out asymmetry undocumented** — Connector ships `AssetEarnings[]`; aggregator emits `Record<string, PerAsset>`. Conversion happens silently in `peer.byAsset.map(...)`. Add one-line comment. [`packages/townhouse/src/earnings/aggregator.ts:byAsset mapping site`]

**From D1 resolution (wire-shape change):**

- [x] [Review][Patch] **Add `status: 'ok' | 'connector_unavailable'` field to `AggregatedEarnings`** — Aggregator sets `'connector_unavailable'` in the catch block of `getEarnings()`, `'ok'` on the happy path. Re-export updated type from `index.ts`. [`packages/townhouse/src/earnings/aggregator.ts:exported types + happy/empty branches`]
- [x] [Review][Patch] **Render `connector_unavailable` banner in SPA panel** — `earnings-panel.tsx` renders a "Connector unreachable — showing last-known zero" affordance when `status === 'connector_unavailable'`. Wires the SPA error state to the data signal (not just HTTP non-200). [`packages/townhouse-web/src/components/earnings-panel.tsx`]
- [x] [Review][Patch] **Aggregator tests assert `status` field** — Happy cases assert `status === 'ok'`; throw/503 cases assert `status === 'connector_unavailable'`. [`packages/townhouse/src/earnings/aggregator.test.ts`]
- [x] [Review][Patch] **Route tests + e2e shape guard cover `status` field** — Route happy/connector-throw tests assert the field; demo-roundtable e2e adds `body.status === 'ok'` to AC-D10-3. [`packages/townhouse/src/api/routes/earnings.test.ts`, `packages/townhouse-web/e2e/demo-roundtable.spec.ts`]

**Patch application — 2026-05-12**

All 23 patches applied. Notable side-effect: while wiring case 7 (apex+peer concurrency assertion), the aggregator was refactored from sequential apex→peers `await`s to a single `Promise.all([buildRoutingFees(), buildPeers()])`. Apex and peer blocks have no ordering dependency; running them concurrently makes the "one wave of delta calls" story honest and eliminates the artificial phase boundary.

Verification:
- `pnpm --filter @toon-protocol/townhouse build` — clean
- `pnpm --filter @toon-protocol/townhouse test` — 965/965 passing (62 files); net delta from baseline of 961 = +4 tests (aggregator suite 7 → 10, route suite 3 → 4)
- `pnpm --filter @toon-protocol/townhouse test src/earnings/` — 10 aggregator tests in 9 ms (sub-1s ✓)
- `pnpm --filter @toon-protocol/townhouse test contract-canary` — 43/43 in 34 ms (unchanged)
- `pnpm --filter @toon-protocol/townhouse-web build` — clean
- `pnpm --filter @toon-protocol/townhouse-web exec vitest run` — 429/429 passing (55 files)
- Pre-existing eslint failures in `packages/townhouse-web/src/charts/chart.tsx` + `components/ui/card.tsx` are unrelated (epic-21 config drift, files untouched in this PR).

**Deferred (logged in `deferred-work.md`):**

- [x] [Review][Defer] **No upper bound on `peers[]` (D2 resolution: leave unbounded)** [`packages/townhouse/src/earnings/aggregator.ts`] — deferred; v1 fleet ≤ 3 nodes, connector is operator-trusted
- [x] [Review][Defer] **Per-request `nodes.yaml` disk read on every 5s poll, no caching** [`packages/townhouse/src/api/routes/earnings.ts:27`] — deferred to 47.4 / perf pass; v1 has single dashboard client
- [x] [Review][Defer] **Duplicate `peerId` and duplicate `assetCode` silently dedup via last-write-wins** [`packages/townhouse/src/earnings/aggregator.ts:122-142, 109-119`] — deferred; connector contract should tighten via canary
- [x] [Review][Defer] **`peerId === ''` empty string passes through to `id: ''`** [`packages/townhouse/src/earnings/aggregator.ts:124`] — deferred; contract canary + connector-side validation
- [x] [Review][Defer] **`claimsReceivedTotal` content not validated (negative / scientific / empty)** [`packages/townhouse/src/earnings/aggregator.ts:117, 136`] — deferred; contract canary tightening
- [x] [Review][Defer] **Hero shows only first asset — multi-asset apex earnings under-report** [`packages/townhouse-web/src/components/earnings-panel.tsx:142-151`] — deferred; v1 is USDC-only
- [x] [Review][Defer] **e2e `PerAssetShape` interface drops `assetScale`** [`packages/townhouse-web/e2e/demo-roundtable.spec.ts:55-60`] — deferred; document semantic loss in 47.3/47.4
- [x] [Review][Defer] **`truncateHash` exported but no in-component consumer (dead export from removed recent-claims block)** [`packages/townhouse-web/src/components/earnings-panel.tsx:74-77`] — deferred; minor cleanup

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry.
- [x] Does this story contain regex or template substitution logic? **No** — pure refactor of an existing aggregator. Skip this checkbox.
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? **No new gates added in 47.2.** If Path A is chosen and the SPA e2e is updated, confirm it inherits the existing Playwright skip gates and does not regress them.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test src/earnings/` runs sub-1s (no I/O in unit tests).
- [x] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of ~±5 tests (deletion-by-default is acceptable).
- [x] Verify `pnpm --filter @toon-protocol/townhouse build` is clean.
- [x] Verify there are zero remaining references to `EarningsPayload`, `by_source`, `PerSourceTotals`, `EarningsSource`, `AssetBucket`, `MAX_ITEMS`, `DEFAULT_SINCE_MS`, `getPacketLog` in the townhouse package (outside `metrics-ws.ts` / packet-log API surface).
- [x] Confirm Open Question 1 (`PerAsset` shape) is resolved per recommendation OR escalated.
- [x] Confirm Open Question 2 (AC #2 vs FR18) is resolved per FR18.
- [x] Confirm Open Question 3 (`claimsReceivedTotal` vs `claimsSentTotal`) is resolved per recommendation OR escalated.
- [x] Confirm Path A vs Path B for SPA scope is documented in `### Review Findings`.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test contract-canary` still passes sub-500ms (unchanged from 47.1).
- [x] If Path A: verify `pnpm --filter @toon-protocol/townhouse-web build` + tests are green.
- [x] Update sprint-status to `review`.
