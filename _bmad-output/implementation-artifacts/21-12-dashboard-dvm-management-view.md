# Story 21.12: Dashboard — DVM Management View (with BLS Health Server + API Extensions + 1 Primitive)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (story creation 2026-04-30):** Like 21.10 and 21.11, the original epic-file scope for 21.12 named the view but did not enumerate the data sources. The DVM is in worse shape than Town/Mill: today its `/health` is the bare `{ status: 'healthy', pubkey }` string emitted by `createNode()`'s standalone HTTP handler on port 3300, NOT a rich payload on the BLS port (3400) the Dockerfile already exposes. The dev-infra healthcheck (`wait_for_health http://localhost:28400/health dvm-01`) currently times out silently — `wait_for_health` logs an error but its return value is unchecked, so the rest of the stack still comes up. This story fixes that pre-existing gap by starting a real BLS health server inside `entrypoint-dvm.ts` on `blsPort`, exposing a `DvmHealthResponse` shape with handler kinds, current `kindPricing`, recent-jobs telemetry, and node identity — the data the dashboard needs to render this view honestly. It also bundles Townhouse-side API extensions (jobs/recent endpoint, optional per-kind PATCH support) and a single new primitive (`BreakdownPill`, deferred from 21.8.5) so the AC's "storage costs vs revenue" surface has a real component to render with. Chart library is shadcn/ui charts, locked by 21.9 and reused unchanged. Inherits 21.8.5 design tokens, 21.10 FeeSlider pattern, 21.10 connector-restart awareness, 21.11 generic `useNodeHealth`/`useDepositAddresses` hooks verbatim.

## Story

As a DVM node operator,
I want a compute-management view showing my registered handler kinds, my recent job throughput broken down by kind and status, my per-kind pricing knobs, my jobs-per-hour chart, and my deposit address,
so that I get visceral proof my compute node is earning revenue from real customers — and a single place to tune what I charge for each service kind I expose.

## Background

The Home view (21.9) tells the operator their DVM is *running*. The Town view (21.10) tells them their relay is *forwarding events*. The Mill view (21.11) tells them their swap peer is *moving liquidity*. The DVM view tells them their compute node is *answering jobs*. The visceral signal is the job-queue counters ticking — `pending` rising as a kind:5094 packet arrives, then `success` ticking up a moment later as the matching kind:6094 result is dispatched. That two-step flicker is the difference between "I have a Nostr DVM container" and "I'm a paid worker on the TOON compute marketplace."

The dev stack runs one DVM instance: `townhouse-dev-dvm-01`. It registers two handler kinds — `kind:5094` (Arweave blob storage, per-byte priced) and `kind:5250` (Dungeon run, per-job priced). The view renders one card; degraded state is verified via `docker pause`; job traffic is exercised by submitting a real DVM request through the SDK's existing test harness (`packages/sdk/tests/__integration__/dvm-*.test.ts` or a one-off seed script).

Three Townhouse API surfaces are extended; one primitive is added; the DVM container's BLS server is wired up; then the view is built on top.

**DVM-side change (in `docker/src/entrypoint-dvm.ts` + small additions in `packages/sdk` if needed):**

1. **Start a Hono BLS server on `blsPort`** (3400 by default). Today the entrypoint sets `blsPort` in the `createNode()` config but `createNode()` never listens on it — the only HTTP server is on `handlerPort` (3300). This is a latent bug: the Dockerfile `EXPOSE`s 3400 with a `HEALTHCHECK` against it, but nothing serves the port; the dev-infra healthcheck times out silently because `wait_for_health`'s return code is unchecked. The fix is additive: spin up a small Hono server on `blsPort` from inside `entrypoint-dvm.ts` (mirror the Mill pattern in `mill.ts:680`), serving `GET /health` with a richer `DvmHealthResponse`.

2. **Define `DvmHealthResponse`** (new exported type from `@toon-protocol/sdk` or a co-located type in the entrypoint, mirrored in `packages/townhouse/src/api/types.ts`):
   - `status: 'starting' | 'ok' | 'stopping' | 'stopped' | 'error'`
   - `version` (from `package.json` of the entrypoint or hard-coded constant)
   - `nodePubkey` (hex)
   - `uptimeSec`
   - `handlerKinds: number[]` (`[5094, 5250]` in the dev stack)
   - `kindPricing: Record<string, string>` (string-encoded bigint, keyed by stringified kind: `{ "5094": "10", "5250": "10000" }`)
   - `basePricePerByte: string`
   - `jobsRecent: { total: number; byKind: { kind: number; count: number }[]; byStatus: { processing: number; success: number; error: number; partial: number } }` — windowed in-memory counter; window 5 min; updated by an `entrypoint-dvm.ts` handler-wrapping shim that increments counters as jobs flow through

**Townhouse API extensions (in `packages/townhouse`, not `townhouse-web`):**

3. **`GET /api/nodes/:nodeId/jobs/recent`** — DVM-flavored equivalent of Mill's `/swaps/recent`. Returns `{ count: number; volume: string; byKind: { kind: number; count: number; volume: string }[]; byStatus: { processing: number; success: number; error: number; partial: number } }`. Source: connector packet log filtered to the DVM's ILP address, grouped by kind range (5000–5999 inbound = job requests; 6000–6999 outbound = job results). `byStatus` reads from the DVM's own `jobsRecent.byStatus` field (proxied through `/health` 2 s cache) since kind:7000 feedback events are not always emitted on the DVM-receive side.
4. **PATCH `/api/nodes/dvm/config` accepts optional `kindPricing`.** Today the route accepts `feePerJob` only. Extend the JSON-schema validator and the per-type field-pick to accept an optional `kindPricing: Record<string, number>` alongside `feePerJob`. Both are independently optional; if both are provided, `kindPricing` takes precedence per-kind. Schema add: `DvmNodeConfig.kindPricing?: Record<string, number>`. Orchestrator `buildNodeEnv('dvm')` emits `KIND_PRICING_5094=...`/`KIND_PRICING_5250=...` env vars when set; the entrypoint reads them in `applyEnvOverlay()` and folds into `out.kindPricing`. Backward-compatible: existing configs with only `feePerJob` continue to work.
5. **`GET /api/nodes/:nodeId/deposit-addresses` for DVM.** Already exists from 21.11 and already returns EVM-only for `dvm` per its existing branch. **Verify**, do not duplicate; just write tests asserting the dvm response shape.

**View (in `packages/townhouse-web`):**

The DVM view at `/dvm` renders one card per DVM node. Each card has: header (`StatusDot` + node id + `TypeChip` accent `dvm`), `MetricBlock`s for active-jobs count and 5-min revenue, a per-status segmented summary using stacked `MetricBlock`s wrapped in `StateShell` (empty when total = 0), a `TypeChip`-style row of supported-handler-kind chips (e.g. `kind:5094 Arweave`, `kind:5250 Dungeon`), per-kind pricing sliders (one per registered handler kind), a jobs-per-hour `LineChart` from the existing `/packets/timeseries` endpoint, a `BreakdownPill` showing storage-cost vs revenue (storage cost rendered as `—` for v1 with a one-line caveat — operator pays Turbo bundlers separately, see Dev Notes § Storage cost handling), and an "Add Funds" disclosure copied verbatim from the Mill view (the Townhouse `/deposit-addresses` route already supports DVM).

## Dependencies

- **Story 21.8.5** (done): primitives + Vite SPA scaffold + shadcn chart components + ESLint rules. Inherited verbatim. Adds `BreakdownPill` here per the 21.8.5 deferral note.
- **Story 21.8.0** (done): dev stack with `townhouse-dev-dvm-01`. The view is developed against this stack per D21-009.
- **Story 21.8** (done): `createApiServer` factory + existing routes (`GET /api/nodes`, `GET /api/nodes/:type`, `PATCH /api/nodes/:type/config`, `WS /metrics`, `connectorRestarting`/`connectorRestarted` WS events). This story extends but does not break those.
- **Story 21.7** (done): DVM container (`docker/Dockerfile.dvm`, `docker/src/entrypoint-dvm.ts`, `dvm-dockerfile.test.ts`). This story extends `entrypoint-dvm.ts` to actually serve the BLS port — a fix-in-place for the latent bug noted in the scope note.
- **Story 21.10** (done): introduced `getNodeRelayEndpoint` + `getContainerStats` + `connectorRestarting`/`connectorRestarted` WS messages + `usePacketTimeseries` hook + `tokens.accent` alias + `FeeSlider` pattern. All reused unchanged.
- **Story 21.11** (done): introduced `getNodeHealthEndpoint(nodeId, type)` + 2 s health cache + `useNodeHealth<T>` generic hook + `/api/nodes/:nodeId/deposit-addresses` route (already supports `dvm`) + `useDepositAddresses` hook + `MILL_HEALTH_PORT`/`DVM_HEALTH_PORT` constants. All reused unchanged. Establishes the bundled-API-with-view-with-primitive precedent.
- **Story 21.9** (done): Home view. The DVM card on Home links to `/dvm`. `VIEW_LINKS` in `src/views/Home.tsx` already maps `town`/`mill`; this story extends it for `dvm`.

**Runtime dependencies (new):**

- **Townhouse package:** none — uses existing `dockerode`, `ConnectorAdminClient.getPacketLog`, `WalletManager.getNodeKeys`, native `fetch`. The DVM `/health` proxy already exists from 21.11 and routes by `:type === 'dvm'` automatically via `getNodeHealthEndpoint`.
- **Townhouse-web package:** none new — shadcn primitives + chart, hooks, plain React. Pulls in `BreakdownPill` from this story as a sibling primitive in the same package.
- **Docker entrypoint:** `hono` and `@hono/node-server` are already bundled into `docker/Dockerfile.dvm` (kept BUNDLED per 21.7's externals list). No new runtime deps in the container image.

## Acceptance Criteria

### DVM-side change (entrypoint + Dockerfile + dev infra)

1. **AC-1: BLS health server starts on `blsPort` from `entrypoint-dvm.ts`.** Add a Hono server bootstrap to `docker/src/entrypoint-dvm.ts` that listens on `config.blsPort` (3400 default). Mounts `GET /health` returning a `DvmHealthResponse` shape (AC-2). Bootstrap occurs after `node.start()` resolves and before the startup banner. The server is `app.listen()`-style via `serve` from `@hono/node-server`. SIGTERM handler is extended to `await server.close()` before `node.stop()`. Test: `docker/src/entrypoint-dvm.test.ts` (existing or new) — assert that the entrypoint imports `Hono` + `serve`, registers `GET /health`, listens on `blsPort`, and shutdown closes the server.
2. **AC-2: `DvmHealthResponse` shape.** New type (exported from somewhere reusable — preferred location: `packages/sdk/src/dvm-health.ts` and re-exported from `@toon-protocol/sdk` index; alternative: co-locate in `docker/src/entrypoint-dvm.ts` and re-declare in `packages/townhouse/src/api/types.ts`. Pick the SDK-exported path so the Townhouse `NodeHealthPayload` union can import the canonical type — mirrors the `MillHealthResponse` precedent). Fields: `status`, `version`, `nodePubkey`, `uptimeSec`, `handlerKinds: number[]`, `kindPricing: Record<string, string>` (string-encoded bigint per kind, e.g. `{ "5094": "10", "5250": "10000" }`), `basePricePerByte: string`, `jobsRecent: { total, byKind: { kind, count }[], byStatus: { processing, success, error, partial } }`. All counts are integers. Test: a `dvm-health.test.ts` shape test verifying the type exports, default values, and that `kindPricing` keys round-trip through `JSON.stringify`.
3. **AC-3: In-process job counters.** Wrap each registered handler in `entrypoint-dvm.ts` with a counter shim that increments `byKind[kind].count` and (when known) `byStatus[status]` on each invocation. Window the counters at 5 min via a sliding ring buffer of `{ ts, kind, status }` events, evicted lazily on read. `byStatus.processing` is incremented on handler entry; on handler return success it's decremented and `success` incremented; on handler throw, `processing` decremented and `error` incremented. `partial` is reserved for future kind:7000-feedback-driven updates and remains 0 in v1. Test: a unit test for the counter shim asserting increment/decrement under success and error paths.
4. **AC-4: Healthcheck validation in dev infra is no longer silent.** `scripts/townhouse-dev-infra.sh` line 282 (`wait_for_health "http://localhost:28400/health" "dvm-01" 30`) currently logs an error on timeout but does not abort. Change `cmd_up` to capture `wait_for_health` exit codes (e.g. `wait_for_health ... || exit 1` for the DVM line). Test: live-Docker — bring the stack up; the wait is satisfied within 30 s now that the BLS server actually listens. (Verified manually as part of Task 18.)
5. **AC-5: DVM regression — no breakage of existing tests.** `pnpm --filter @toon-protocol/sdk test` passes. `pnpm --filter @toon-protocol/pet-dvm test` passes. The existing `dvm-dockerfile.test.ts` static-analysis test passes after the entrypoint additions. The Arweave DVM and Dungeon DVM handlers continue to work unmodified — the counter shim wraps but does not modify their inputs/outputs.

### Townhouse API extensions (Townhouse package)

6. **AC-6: `GET /api/nodes/:nodeId/jobs/recent` endpoint.** Returns `{ count: number; volume: string; byKind: { kind: number; count: number; volume: string }[]; byStatus: { processing: number; success: number; error: number; partial: number } }`. Validates `:nodeId` resolves to a `dvm` instance (404 if not — mirror the Mill `swaps/recent` 404-on-non-mill pattern). Accepts `?windowSec` (default 300, max 3600, integer; 400 on out-of-range). Source: `connectorAdmin.getPacketLog({ ilpAddress: <dvm's ilp address>, since: Date.now() - windowSec*1000, limit: 10_000 })`. Group by `kind` field of the packet (extract via the existing packet-log shape; if the connector packet log does not surface `kind` per-entry, infer from the ILP packet's TOON-decoded event kind via a lazy decode helper — see Dev Notes § Kind extraction from packet log). For `byStatus`, fetch `/api/nodes/:nodeId/health` server-side once and re-use the `jobsRecent.byStatus` field (cached 2 s by the existing health cache). Returns 503 on connector-down (mirrors 21.10's 503 behavior). Test: `routes/nodes-jobs-recent.test.ts` covering happy path, empty window, windowSec validation, connector-down 503, type !== 'dvm' 404, byStatus from health proxy.
7. **AC-7: PATCH `/api/nodes/dvm/config` accepts optional `kindPricing`.** Update `packages/townhouse/src/api/routes/nodes-patch.ts`'s JSON schema to allow `kindPricing` as an additional body field for `dvm`. Schema: `kindPricing: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } }`. The handler merges `body.kindPricing` into `mergedConfig.nodes.dvm.kindPricing`. The existing `feePerJob` field continues to work; both are independently optional. The connector restart trigger (`regenerateConnectorConfig`) fires when EITHER changes (extend the existing feePerJob/feePerEvent/feeBasisPoints check at line 130). Test: `routes/nodes-patch.test.ts` (existing) extended with: PATCH dvm with `{ kindPricing: { '5094': 5 } }` succeeds and persists; PATCH dvm with both `feePerJob` + `kindPricing` succeeds; PATCH dvm with malformed `kindPricing` returns 400.
8. **AC-8: Schema + types update.** `packages/townhouse/src/config/schema.ts`: add `kindPricing?: Record<string, number>` to `DvmNodeConfig`. `packages/townhouse/src/api/types.ts`: add `kindPricing?: Record<string, number>` to `NodeDetail.config`; add `JobsRecentPayload` (`{ count, volume, byKind, byStatus }`); replace `DvmHealthPayload` (currently a thin placeholder) with the real `DvmHealthResponse` from `@toon-protocol/sdk` and update the `NodeHealthPayload` union. Re-export the new types from `src/api/index.ts` and `src/index.ts`.
9. **AC-9: Orchestrator env-var emission for `kindPricing`.** In `packages/townhouse/src/docker/orchestrator.ts:buildNodeEnv('dvm')`, emit one env var per kindPricing entry: `KIND_PRICING_<kind>=<value>` (e.g. `KIND_PRICING_5094=5`, `KIND_PRICING_5250=10000`). Continue to emit `FEE_PER_JOB` when set (backward-compatible). Test: `orchestrator.test.ts` extended — assert `buildNodeEnv('dvm')` produces both env-var styles when `kindPricing` is set.
10. **AC-10: Entrypoint reads `KIND_PRICING_<kind>` env vars.** In `docker/src/entrypoint-dvm.ts:applyEnvOverlay()`, scan `process.env` for keys matching `/^KIND_PRICING_(\d+)$/`, parse each as a kind+value pair, and merge into `out.kindPricing`. Per-kind values from env vars take precedence over JSON config and over `FEE_PER_JOB`. Test: `entrypoint-dvm.test.ts` extended — assert both single (`KIND_PRICING_5094`) and multiple (`KIND_PRICING_5094 + KIND_PRICING_5250`) env-var combinations populate `out.kindPricing` correctly.
11. **AC-11: API regression.** `pnpm --filter @toon-protocol/townhouse test` passes — existing 21.8/21.10/21.11 tests stay green; new tests added (AC-6, AC-7, AC-9). Existing connector contract canary (`packages/townhouse/src/connector/contract-canary.test.ts`) untouched.

### Primitive (Townhouse-web package)

12. **AC-12: `BreakdownPill` primitive.** New file `src/components/primitives/BreakdownPill.tsx`. Props: `{ segments: { label: string; value: string; tone?: 'positive' | 'neutral' | 'negative' }[]; className?: string }`. Renders a single shadow-bordered pill containing all segments inline, separated by a thin Geist-Mono `·` middot in `text-ink/40`. Each segment renders `<span>{label}</span> <code class="font-geist-mono">{value}</code>`. The optional `tone` prop tints the value text — `positive` → `text-green-600/80`, `negative` → `text-red-500/80`, `neutral` (default) → `text-ink`. Defaults: `aria-hidden` on decorative middots, full text label on the pill itself for screen readers (`aria-label` derived from `segments.map(s => '${s.label}: ${s.value}').join(', ')`). Story file (`BreakdownPill.stories.tsx`) — default story with three positive-neutral-negative segments + a single-segment story + a long-string story (overflow truncation behavior). Test file (`BreakdownPill.test.tsx`) — snapshot, all three tones render distinct classes, computed `aria-label` matches expected, axe-core zero violations. Barrel-export from `src/components/primitives/index.ts`. The 21.8.5 a11y-baseline test (`src/__tests__/a11y-baseline.test.tsx`) is extended with `BreakdownPill` in default + tone-mixed variants.

### View (Townhouse-web package)

13. **AC-13: `/dvm` route.** A new route `/dvm` renders the DVM view from `src/views/Dvm.tsx`. The view fetches `GET /api/nodes` (already present) and renders one card per DVM node in a 2-column grid at ≥1024 px, stacked below. Empty state ("No DVM nodes are enabled. Enable one on the Home dashboard.") and error state ("Could not load DVM nodes. Is `pnpm dev:docker` running?") use `StateShell` and mirror the Town/Mill view empty/error UX exactly. `Home.tsx`'s `VIEW_LINKS` map is extended with `dvm: '/dvm'`.
14. **AC-14: Active jobs + 5-minute revenue `MetricBlock`s per DVM card.** Each card has two top-row `MetricBlock`s: `Active jobs` (from health's `jobsRecent.byStatus.processing`, falls back to `byStatus.processing` from `/api/nodes/:nodeId/jobs/recent` — the latter is the source-of-truth via the health proxy) and `Revenue (5m)` (formatted from `jobs/recent` `volume`). Polls every 5 s via `useDvmJobsRecent`. Format revenue as USDC (asset scale 6, mirrors the Mill volume formatter; reuse `formatVolume` extracted to `src/lib/format-volume.ts` in this story — extracted from `Mill.tsx:60` so both views share one implementation). Volume falling back to `—` when the metric is unavailable.
15. **AC-15: Job queue counts (`pending` / `in-progress` / `completed`).** Each card has a row of three `MetricBlock`s wrapped in `StateShell` (state = `empty` when `total === 0`, else `ready`). Sources: `pending = byStatus.processing - active_being_handled`? In v1 simplification, `pending` is unobservable from the DVM-side counter (the connector queue is the canonical pending source, not exposed yet); render `pending` as `byStatus.processing` (jobs the DVM has accepted but not yet completed) and document the simplification in Dev Notes § Pending-job semantics. `in-progress` is also `byStatus.processing` for v1; merge the two into a single "Active" `MetricBlock` and add a footnote. `completed` is `byStatus.success` for the 5-minute window. Failed = `byStatus.error`. Layout: three `MetricBlock`s — Active / Completed / Failed — wrapped in `StateShell`. Empty state caption: "No jobs in the last 5 minutes."
16. **AC-16: Handler-kinds row.** Each card has a horizontal row of badges (one per `handlerKinds[i]` from `/health`), styled identically to `PairChip` but with single-kind content. Reuse `TypeChip` styling via a small inline component — do NOT add another primitive. Each badge shows `kind:<N>` in Geist Mono with the friendly name when known (`kind:5094 Arweave`, `kind:5250 Dungeon`; for unknown kinds, render `kind:<N>` only). Friendly name map lives inline in `Dvm.tsx` (e.g. `KIND_LABELS: Record<number, string> = { 5094: 'Arweave', 5250: 'Dungeon' }`).
17. **AC-17: Per-kind pricing sliders.** For each `handlerKinds[i]` from `/health`, render a slider section containing: (a) the kind badge from AC-16, (b) an `Input` slider variant (range 0–10000, default current value from `health.kindPricing[String(kind)]`; if absent, default from `feePerJob` — mirrors the entrypoint precedence), (c) an Apply `Button`. Apply PATCHes `/api/nodes/dvm/config` with body `{ kindPricing: { [kind]: value } }`. Retry-once on 409 (mirror 21.10/21.11). Subscribe to `connectorRestarting`/`connectorRestarted` WS events, transition the card's `StateShell` to `loading` during restart, then back to `ready`. After successful PATCH, refetch `useNodeHealth` and `useDvmJobsRecent`. Fallback when the DVM exposes only `feePerJob`: show one slider labeled "Fee per job" PATCHing `{ feePerJob: value }` instead — applied for handler kinds where `kindPricing[kind]` is unset on the server.
18. **AC-18: Jobs-per-hour chart.** Each DVM card renders a shadcn `LineChart` (via `@/charts`) showing 24 hourly buckets. Sourced from `GET /api/nodes/:type/packets/timeseries?bucket=hour&since=<24h-ago>` (existing endpoint from 21.10; works for `:type=dvm` via the same ILP-address filter). Line color is `tokens.accent.dvm` (`#ff5b4f`). Y-axis is `count` (packets per hour). Empty/loading/error/unavailable states reuse the Mill view's `VolumeChart` component verbatim, hoisted to `src/components/charts/JobsChart.tsx` for cross-view reuse. The earnings caption reads "Approx earnings at current fee: ~{count × averageVolume × kindPricing[primaryKind] / 1000000}" using the operator's primary kind (largest count in `byKind`). When the connector returns 503 (endpoint unavailable), render the same "Volume chart requires connector v3.4+ (endpoint not yet available)" empty-state copy from 21.11.
19. **AC-19: `BreakdownPill` for storage costs vs revenue.** Render one `BreakdownPill` per card with three segments: `Revenue 5m: <value>` (positive tone), `Storage cost: —` (neutral; tooltip "Operator pays Turbo bundlers separately"), `Net: <revenue value>` (positive tone, equal to revenue for v1). When revenue is zero or unavailable, all values render as `—`. The "Storage cost: —" caveat is lifted to a separate caption beneath the pill on first paint and disappears on hover/focus per WCAG content-on-hover guidance — alternatively, render as a static caption always visible if focus management proves fiddly. Document this in Dev Notes § Storage cost handling. The `tone` props are honored.
20. **AC-20: Add Funds expander.** Reuse the Mill view's `<AddFunds>` component verbatim — extracted into `src/components/AddFunds.tsx` in this story (taken from `Mill.tsx`, deduplicated across both views). The DVM `useDepositAddresses({ nodeId })` returns EVM-only (per 21.11's existing behavior). No code changes needed in `useDepositAddresses` or the API route.
21. **AC-21: All styling via primitives + tokens.** No inline hex (CI rule), no raw `border:` (CI rule), no positive letter-spacing on Geist (CI rule), no direct recharts imports (CI rule). The new primitive (`BreakdownPill`) and the new view respect all four rules. `Dvm.tsx` imports recharts only via `@/charts`.
22. **AC-22: Axe-core passes WCAG 2.1 AA.** View test `src/views/Dvm.test.tsx` asserts zero violations. The job-queue-counters row uses `MetricBlock`'s existing a11y guarantees; the per-kind slider sections use the existing `Input` slider's a11y guarantees; the `BreakdownPill` exposes a single computed `aria-label` (AC-12).
23. **AC-23: Live-Docker development per D21-009.** PR includes screenshots taken with `pnpm dev:docker` against the dev stack:
    - Default state: `dev-dvm-01` card visible with handler-kind row showing kind:5094 + kind:5250, three job-queue counters at 0 (empty StateShell), pricing sliders at default values, empty chart, BreakdownPill with `—` values.
    - Active state: trigger a real DVM job via the existing SDK integration test harness (e.g. `pnpm --filter @toon-protocol/sdk test:integration -- dvm` or a one-off seed script `scripts/trigger-dvm-job.mjs`) — capture the `Active` counter ticking up, `Completed` ticking up, jobs-per-hour chart populating, BreakdownPill revenue value updating. Document the exact CLI invocation in the PR description.
    - Degraded state: `docker pause townhouse-dev-dvm-01` — confirm `StatusDot` transitions to `degraded` and the card's `MetricBlock`s show `—` placeholders.
    - Pricing apply: drag a per-kind slider, click Apply, screenshot the connector-restart `loading` state, then the post-restart `ready` state. Confirm the new value persists via a refetch of `useNodeHealth`.
24. **AC-24: Tests + build.** Townhouse-web side: view tests + a11y + lint + build all green. `pnpm --filter @toon-protocol/townhouse-web lint test build`. Townhouse-side: `pnpm --filter @toon-protocol/townhouse test`. SDK-side: `pnpm --filter @toon-protocol/sdk test`. SDK contract canary: `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` (defensive — AC-6 reuses existing `getPacketLog` shape; expected to remain green).

## Tasks / Subtasks

### Phase A: DVM-side BLS health server

- [x] Task 1: Define `DvmHealthResponse` type (AC: #2)
  - [x] 1.1 Create `packages/sdk/src/dvm-health.ts` exporting `DvmHealthResponse` interface per AC-2 (status, version, nodePubkey, uptimeSec, handlerKinds, kindPricing, basePricePerByte, jobsRecent shape).
  - [x] 1.2 Re-export from `packages/sdk/src/index.ts`.
  - [x] 1.3 Shape test in `packages/sdk/src/dvm-health.test.ts` — JSON round-trip, handler-kinds is `number[]`, `kindPricing` keys are stringified kinds, `jobsRecent.byStatus` has the four named status fields. Pure type/shape validation; no runtime behavior.

- [x] Task 2: Job-counter shim in `entrypoint-dvm.ts` (AC: #3)
  - [x] 2.1 New helper `createJobCounter(windowMs: number = 5 * 60 * 1000)` returning `{ wrap(kind, handler), snapshot(): jobsRecent }`. The `wrap` returns a new handler that increments `processing` on entry, decrements + increments `success` on resolve, decrements + increments `error` on reject. The `snapshot` returns the current windowed counts after evicting entries older than `windowMs`.
  - [x] 2.2 In `main()`, after `node = await createNode(...)`, instantiate the counter and replace `node.on(5094, createArweaveDvmHandler(...))` with `node.on(5094, counter.wrap(5094, createArweaveDvmHandler(...)))`. Same for `kind:5250`. The wrap closure must propagate the original handler's promise resolution — preserve return value verbatim.
  - [x] 2.3 Unit test in `docker/src/entrypoint-dvm.test.ts` (existing or create): counter wraps a fake handler; success path increments `success`; error path increments `error`; window eviction works.

- [x] Task 3: Hono BLS server in `entrypoint-dvm.ts` (AC: #1)
  - [x] 3.1 Import `Hono` and `serve` from `@hono/node-server` (already bundled per 21.7).
  - [x] 3.2 After `node.start()` resolves and before the startup banner, build the Hono app:
    ```ts
    const app = new Hono();
    const startedAt = Date.now();
    app.get('/health', (c) => c.json({
      status: 'ok' as const,
      version: '1.0.0',
      nodePubkey: pubkey,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      handlerKinds: [5094, 5250],
      kindPricing: Object.fromEntries(
        Object.entries(config.kindPricing ?? {}).map(([k, v]) => [k, String(v)])
      ),
      basePricePerByte: String(config.basePricePerByte ?? 10n),
      jobsRecent: counter.snapshot(),
    } satisfies DvmHealthResponse));
    const blsServer = serve({ fetch: app.fetch, port: config.blsPort ?? 3400 });
    console.log(`[DVM Entrypoint] BLS health server on port ${config.blsPort ?? 3400}`);
    ```
  - [x] 3.3 Extend the SIGTERM/SIGINT shutdown to `await blsServer.close()` before `node.stop()`.
  - [x] 3.4 Static-analysis update in `packages/townhouse/src/docker/dvm-dockerfile.test.ts` (existing): assert the entrypoint imports `Hono` and registers `GET /health`. Mirror Mill's existing health-test assertion pattern.

- [x] Task 4: `KIND_PRICING_<kind>` env-var support (AC: #10)
  - [x] 4.1 In `applyEnvOverlay()`, after `FEE_PER_JOB` handling, scan `process.env` keys for `/^KIND_PRICING_(\d+)$/`. For each match, parse the kind as integer and the value as `BigInt(envValue)`, merge into `out.kindPricing`. Keys override any prior value (per-kind env-var wins over `FEE_PER_JOB` dual-mapping and JSON config).
  - [x] 4.2 Test in `entrypoint-dvm.test.ts` covering:
    - `KIND_PRICING_5094=5` alone — `out.kindPricing[5094] === 5n`.
    - `KIND_PRICING_5094=5` + `KIND_PRICING_5250=10000` — both populated.
    - `KIND_PRICING_5094=5` + `FEE_PER_JOB=10` — `kindPricing[5094] === 5n`, `kindPricing[5250]` from `FEE_PER_JOB === 10n`, `basePricePerByte === 10n`.
    - Malformed key (`KIND_PRICING_abc`) — ignored, no throw.

- [x] Task 5: Dev-infra healthcheck strict mode (AC: #4)
  - [x] 5.1 In `scripts/townhouse-dev-infra.sh:282`, change `wait_for_health "http://localhost:28400/health" "dvm-01" 30` to `wait_for_health "http://localhost:28400/health" "dvm-01" 30 || exit 1` (also do the same for the four other waits at lines 278–281 to be consistent).
  - [x] 5.2 Manual verification: bring stack up; the dvm-01 wait now succeeds within ~5–10 s of the BLS server starting.

### Phase B: Townhouse API extensions

- [x] Task 6: `GET /api/nodes/:nodeId/jobs/recent` route (AC: #6)
  - [x] 6.1 New route in `packages/townhouse/src/api/routes/nodes.ts`. Signature mirrors `swaps/recent`: `app.get<{ Params: { nodeId: string }; Querystring: { windowSec?: string } }>`. Use the existing `resolveNodeId` helper. 404 on non-`dvm` resolved type. 400 on bad `windowSec` (1–3600 inclusive integer).
  - [x] 6.2 Resolve the DVM's ILP address via `connectorAdmin.getPeers()` — mirror the existing `swaps/recent` logic at line 432–445.
  - [x] 6.3 If ILP address is missing, return `{ count: 0, volume: '0', byKind: [], byStatus: { processing: 0, success: 0, error: 0, partial: 0 } }`.
  - [x] 6.4 Call `getPacketLog({ ilpAddress, since: Date.now() - windowSec*1000, limit: 10_000 })`. Group by `kind` extracted via `extractKindFromPacketEntry(entry)` — see Task 7. Compute `byKind` array + total `count`, `volume`.
  - [x] 6.5 Fetch `/api/nodes/:nodeId/health` server-side using the existing `getNodeHealthEndpoint` + 2 s health cache (deps.orchestrator + the existing `healthCache` Map). Read `health.jobsRecent.byStatus` and return it as the response's `byStatus`. If health fetch fails, return `byStatus: { processing: 0, success: 0, error: 0, partial: 0 }` and continue with the other fields.
  - [x] 6.6 503 on connector-down (mirror the swaps/recent error path).
  - [x] 6.7 Test in `routes/nodes-jobs-recent.test.ts`: happy path with mocked `getPacketLog` + mocked health, empty packet log, windowSec validation 400, type !== 'dvm' 404, connector-down 503, health fetch fail returns zero-status.

- [x] Task 7: Kind extraction helper (AC: #6)
  - [x] 7.1 In `packages/townhouse/src/api/routes/nodes.ts` (or a small helper file), add `extractKindFromPacketEntry(entry: PacketLogEntry): number | null` — see Dev Notes § Kind extraction from packet log for the strategy. Implementation: prefer a top-level `entry.kind` field if the connector exposes it; otherwise fall back to `null` and group those packets under `byKind: { kind: 0, count: ... }` (or filter them out — pick "kind: 0" so the operator can see the unattributed bucket and we don't silently lose data).
  - [x] 7.2 Document the connector-side gap in `packages/sdk/CONNECTOR_MIGRATION.md` "Townhouse-Side Contract" section: "Townhouse expects PacketLogEntry to carry an event kind for DVM views — feature-detect; absent kind groups under bucket 0."
  - [x] 7.3 Test the helper with both shapes (kind present, kind absent).

- [x] Task 8: PATCH `kindPricing` support (AC: #7)
  - [x] 8.1 In `packages/townhouse/src/api/routes/nodes-patch.ts`, extend the JSON schema body type to allow `kindPricing: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } }`.
  - [x] 8.2 In the handler, when `body.kindPricing` is present and `:type === 'dvm'`, merge it into `mergedConfig.nodes.dvm.kindPricing` (initialize if absent). Trigger `regenerateConnectorConfig` when EITHER `feePerJob` OR `kindPricing` changes. Other types reject `kindPricing` with a 400 (`kindPricing not supported for type=<type>`).
  - [x] 8.3 Update the per-type response pick at line 150–156 to include `kindPricing` for dvm: `return { enabled: u.enabled, feePerJob: u.feePerJob, kindPricing: u.kindPricing }`.
  - [x] 8.4 Tests in `routes/nodes-patch.test.ts`: PATCH dvm `{ kindPricing: { '5094': 5 } }` succeeds, persists, returns the new value; PATCH dvm with both `feePerJob + kindPricing` succeeds; PATCH town with `kindPricing` returns 400; malformed `kindPricing` (negative value) returns 400.

- [x] Task 9: Schema + types (AC: #8)
  - [x] 9.1 In `packages/townhouse/src/config/schema.ts`, extend `DvmNodeConfig` interface with `kindPricing?: Record<string, number>`. Update validator JSON schema to allow it.
  - [x] 9.2 In `packages/townhouse/src/api/types.ts`, extend `NodeDetail.config` type with `kindPricing?: Record<string, number>`. Add `JobsRecentPayload` interface (`{ count, volume, byKind, byStatus }` per AC-6). Replace `DvmHealthPayload` with the imported `DvmHealthResponse` from `@toon-protocol/sdk` and update `NodeHealthPayload` union to use it.
  - [x] 9.3 Re-export new types from `src/api/index.ts` and `src/index.ts`.

- [x] Task 10: Orchestrator env-var emission (AC: #9)
  - [x] 10.1 In `packages/townhouse/src/docker/orchestrator.ts:buildNodeEnv('dvm')` (line 700), after the existing `feePerJob` block, iterate `this.config.nodes.dvm.kindPricing` (if present) and push `KIND_PRICING_${kind}=${value}` for each entry.
  - [x] 10.2 Test in `orchestrator.test.ts`: assert env-var emission for various `kindPricing` shapes.

### Phase C: `BreakdownPill` primitive

- [x] Task 11: `BreakdownPill` (AC: #12)
  - [x] 11.1 `src/components/primitives/BreakdownPill.tsx` per AC-12. Use `colors.ink`, `text-green-600/80`, `text-red-500/80` for tones; tokens-only, no inline hex outside `theme/tokens.ts`.
  - [x] 11.2 `BreakdownPill.stories.tsx` — default story (three positive-neutral-negative segments), single-segment story, long-string truncation story.
  - [x] 11.3 `BreakdownPill.test.tsx` — snapshot, tone-class assertions, computed `aria-label` matches expected, axe-core zero violations.
  - [x] 11.4 Barrel-export from `src/components/primitives/index.ts`.

- [x] Task 12: A11y baseline extension (AC: #12)
  - [x] 12.1 In `src/__tests__/a11y-baseline.test.tsx`, append `BreakdownPill` in default + tone-mixed variants.

### Phase D: DVM view

- [x] Task 13: Volume formatter extraction + JobsChart hoist (AC: #14, #18)
  - [x] 13.1 Extract `formatVolume` from `Mill.tsx:60` to `src/lib/format-volume.ts` (export same signature). Update `Mill.tsx` import to consume from the new location. Add tests `src/lib/format-volume.test.ts` covering edge cases (assetScale 6/18, negative inputs, zero, malformed).
  - [x] 13.2 Hoist `VolumeChart` from `Mill.tsx` to `src/components/charts/JobsChart.tsx` (rename for clarity since this story consumes it as a jobs-per-hour chart, not a volume chart). Mill.tsx continues to consume the same component via the new path — accepts a `color` prop so Mill passes `tokens.accent.mill` and DVM passes `tokens.accent.dvm`. Update Mill imports + add color-prop test in `Mill.test.tsx`.
  - [x] 13.3 Pure refactor — Mill behavior unchanged after the moves. `Mill.test.tsx` continues to pass with no semantic change.

- [x] Task 14: AddFunds extraction (AC: #20)
  - [x] 14.1 Extract `<AddFunds>` from `Mill.tsx:308` to `src/components/AddFunds.tsx`. Same props (`{ nodeId: string }`).
  - [x] 14.2 Update `Mill.tsx` to import from the new path. Update `Dvm.tsx` to consume.
  - [x] 14.3 Add `AddFunds.test.tsx` — happy path with mocked `useDepositAddresses`, copy-button success/error states, type=dvm renders evm-only.

- [x] Task 15: DVM data hooks (AC: #14, #15, #17, #18, #19)
  - [x] 15.1 New hook `src/hooks/useDvmJobsRecent.ts` — polls `/api/nodes/:nodeId/jobs/recent?windowSec=300` every 5 s. Exposes `{ data: JobsRecentPayload | null; status; refetch }`. Mirror `useMillSwapsRecent` shape verbatim.
  - [x] 15.2 Tests in `useDvmJobsRecent.test.ts` covering polling, error transitions, refetch, abort on unmount. Mirror `useMillSwapsRecent.test.ts`.
  - [x] 15.3 In `useNodeMetrics.ts`, extend the `currentFee` derivation: `currentFee = detail.config?.feePerJob ?? detail.config?.feeBasisPoints ?? detail.config?.feePerEvent ?? null` (add `feePerJob` first; works for DVM single-knob fallback).

- [x] Task 16: DVM view scaffold + route (AC: #13, #21)
  - [x] 16.1 New route `/dvm` in `src/App.tsx` → `<DvmView />` from `src/views/Dvm.tsx`.
  - [x] 16.2 In `src/views/Home.tsx`, extend `VIEW_LINKS` with `dvm: '/dvm'`.
  - [x] 16.3 Layout: 2-column grid at ≥1024 px, stacked below.
  - [x] 16.4 Empty state, error state, retry button — copy 21.10/21.11 patterns.
  - [x] 16.5 Connector restart awareness — copy the WS-event-listener pattern from `Mill.tsx:597–648`.

- [x] Task 17: DVM card composition (AC: #14, #15, #16, #17, #18, #19, #20)
  - [x] 17.1 `<DvmCard>` component:
    - Header: `StatusDot` + `nodeId` (Geist Mono) + `TypeChip type="dvm"`.
    - Top row: `MetricBlock` Active jobs + `MetricBlock` Revenue (5m).
    - `StateShell` job-queue counters: three `MetricBlock`s (Active / Completed / Failed) with caption "No jobs in the last 5 minutes." when total === 0.
    - Handler-kinds badge row with friendly labels for kind:5094 / kind:5250.
    - Per-kind pricing slider stack (one slider per `handlerKinds[i]`): label "Fee for {KIND_LABELS[kind] || `kind:${kind}`}", value from `health.kindPricing[String(kind)] ?? feePerJob`. Apply PATCH the per-kind value (or `feePerJob` if kindPricing slot is empty for backward-compat). Subscribe to connector-restart WS events.
    - `JobsChart` from `src/components/charts/JobsChart.tsx`, color `tokens.accent.dvm`.
    - `BreakdownPill` Revenue/Storage/Net per AC-19.
    - `AddFunds nodeId={nodeId}` per AC-20.
  - [x] 17.2 Render-side data flow:
    - `useNodeMetrics({ nodeType: 'dvm' })` for `currentFee` (fallback for kindPricing-absent kinds).
    - `useNodeHealth<DvmHealthResponse>({ nodeId })` — narrows the generic to the DVM-specific shape.
    - `useDvmJobsRecent({ nodeId, windowSec: 300 })` for jobs-recent.
    - `usePacketTimeseries({ nodeType: 'dvm' })` for the 24h chart.
    - `useDepositAddresses({ nodeId })` (consumed inside `<AddFunds>`).

- [x] Task 18: A11y + tests (AC: #22, #24)
  - [x] 18.1 `src/views/Dvm.test.tsx` — render with mocked API responses, assert zero axe violations at WCAG 2.1 AA, assert key elements present (handler kinds row, three job-queue counters, per-kind sliders, chart, BreakdownPill, AddFunds).
  - [x] 18.2 Hook tests for `useDvmJobsRecent`.

- [x] Task 19: Live-Docker verification (AC: #23)
  - [x] 19.1 With dev stack up: `pnpm dev:docker`. Visit `/dvm`. Confirm `dev-dvm-01` card visible with handler-kinds row, three counters, two sliders, chart, BreakdownPill, AddFunds.
  - [x] 19.2 Capture default-state screenshot: `screenshots/21-12-dvm-view-default.png`.
  - [x] 19.3 Trigger a real DVM job — pick the simplest path: an existing SDK integration test (`pnpm --filter @toon-protocol/sdk test:integration -- arweave-dvm` or similar) OR a one-off seed script `scripts/trigger-dvm-job.mjs` analogous to existing seed scripts. Document the exact command in PR description. Capture `screenshots/21-12-dvm-view-active.png` showing counters + chart populating.
  - [x] 19.4 `docker pause townhouse-dev-dvm-01` — confirm degraded state. Capture `screenshots/21-12-dvm-view-degraded.png`.
  - [x] 19.5 Adjust a per-kind slider to 100, click Apply — capture `screenshots/21-12-dvm-pricing-applied.png` showing the connector-restart `loading` state, then post-restart `ready` state. Verify the new value persists by refetching `useNodeHealth` (check the slider's initial value on next mount).
  - [x] 19.6 Capture the Home → DVM link: `screenshots/21-12-home-dvm-link.png` (Home view's NodeCard for dvm now shows the "View →" link wired to `/dvm`).

- [x] Task 20: Build + lint + cross-package smoke (AC: #24)
  - [x] 20.1 `pnpm --filter @toon-protocol/townhouse-web lint test build` — all green.
  - [x] 20.2 `pnpm --filter @toon-protocol/townhouse test` — all green (existing + new route tests).
  - [x] 20.3 `pnpm --filter @toon-protocol/sdk test` — all green (new `dvm-health` shape test + existing tests stay green).
  - [x] 20.4 `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` — passes (defensive).
  - [x] 20.5 `pnpm --filter @toon-protocol/pet-dvm test` — all green (Dungeon DVM handler unchanged; counter-shim wraps without modifying behavior).

## Dev Notes

### Why bundle the BLS health server, API extensions, view, and primitive in one story

Same logic as 21.10 and 21.11. The `BreakdownPill` primitive only has one consumer in epic 21 — this view. Splitting it out creates a dead component for the duration between merges. The DVM `/health` enrichment exists exclusively to feed this view (Active counter, kindPricing sliders, handler-kinds row); splitting it would create a no-op intermediate state where the BLS port is wired but no consumer reads it. The Townhouse-side `kindPricing` PATCH support exists for the per-kind sliders; splitting it would create a slider that PATCHes a route that returns 400. Bundling means a single end-to-end PR with screenshots that prove the entire pipeline works — operator pushes a slider, connector restarts, new `kindPricing` env var lands in the DVM container, next health-poll surfaces the new value back into the slider's initial state.

### Why we're starting a Hono BLS server inside `entrypoint-dvm.ts`, not in `createNode()`

`createNode()` is consumed by both standalone-mode (DVM, today) and embedded-mode (Town, Mill via `@toon-protocol/bls`'s entrypoint). Making `createNode()` itself spin up a BLS server keyed off `blsPort` would force every consumer to either get the BLS server or opt out — invasive across packages, and the BLS shape needed by Town (Nostr event store, kind:10032 publishing) differs from what DVM needs (job counters, kindPricing). The clean line is: the entrypoint owns its `/health` shape because it knows what it's running. The Mill entrypoint owns its rich health response (`MillHealthResponse` with swap pairs and inventory). Town's entrypoint owns its (`packages/bls/src/entrypoint.ts:387` defines `/health` directly). DVM's entrypoint should own its too. The `blsPort` field on `NodeConfig` becomes a pure declaration ("here's a port reserved for the BLS health server"); the actual server is created by whoever runs `createNode()`, with `entrypoint-dvm.ts` doing it for the dockerized DVM.

### Why the BLS server bug is a pre-existing issue we're inheriting and resolving here

Story 21.7 (DVM Dockerfile) wrote `EXPOSE 3300 3400` and a `HEALTHCHECK` against 3400, but the entrypoint never listened on 3400. The static-analysis test `dvm-dockerfile.test.ts` only checks the Dockerfile and entrypoint shape — it never boots the container, so it never caught the gap. The dev-infra script's `wait_for_health http://localhost:28400/health dvm-01 30` does check at runtime, but `wait_for_health` returns a non-zero exit code on timeout that's silently dropped because the caller doesn't `||` exit. Result: the container reports unhealthy in `docker ps` (HEALTHCHECK fails) but the dev infra log says "dvm-01 failed health check after 60s" and proceeds anyway. A 21.12 implementer running `docker ps` will see this immediately. The fix is one Hono `app.get('/health', ...)` registration plus a strict `|| exit 1` on the wait. Both small, both right.

### Why `jobsRecent.byStatus` lives on the DVM container (not the connector)

The connector knows about *packets* (ILP routing). It does not know about *jobs* (DVM-handler outcomes). A kind:5094 packet that the DVM rejects mid-handler still routes through the connector successfully (the F00 rejection is in the ILP response data). The status `success` vs `error` is only knowable from inside the handler closure. Rather than push that out as a separate kind:7000 feedback event for every job (operationally noisy, requires connector-side packet inspection on the receive path), the DVM keeps an in-memory counter and exposes it via `/health`. Trade-off: counters are lost on container restart. For v1 that's acceptable — a 5-minute window means counters re-populate within minutes, and operators get a "session" view rather than a forever-history view. Forever-history is a separate "DVM logs" story not in epic 21.

### Why the byStatus is reached through the health proxy on the API side

The `byStatus` computation requires reading the DVM container's `/health` field. Two paths considered:
- (A) Townhouse API's `/jobs/recent` route fetches the connector packet log AND the container `/health`, merges, returns. One client call → one server response with all the data.
- (B) Client makes two parallel calls: `/jobs/recent` (connector packet log only, byKind only) + `/health` (byStatus only).
Path (B) is two HTTP requests where one suffices, and the dashboard already gets `/health` via `useNodeHealth`, so the client could drop the `byStatus` from `/jobs/recent` entirely. Path (A) keeps the API surface single-purpose: "give me everything I need to render the jobs-recent panel." Path (A) wins on API ergonomics. The 2 s health cache means (A)'s server-side fetch is amortized — a polling loop hitting `/jobs/recent` every 5 s only triggers a real container-side fetch every 2 s.

### Why per-kind pricing is bundled here and not deferred

The AC says "Pricing configuration per job type in shadow-bordered cards." Plural "cards" makes the multi-kind interpretation strong. Implementing it as a single `feePerJob` slider that dual-maps to both `kindPricing[5094]` and `kindPricing[5250]` (today's behavior) means the operator can't independently tune Arweave (per-byte) and Dungeon (per-job) — and these have wildly different cost profiles (Arweave is byte-priced, Dungeon is run-priced). One slider for both is the wrong shape. The change to introduce `kindPricing: Record<string, number>` in `DvmNodeConfig` is small (one optional schema field, one PATCH branch, one orchestrator env-var emission). Deferring it would mean re-doing the slider section in a future story to support what the AC already names as v1 scope.

### Why `KIND_PRICING_<kind>` env vars instead of a single `KIND_PRICING_JSON`

Two paths considered:
- (A) `KIND_PRICING_5094=10`, `KIND_PRICING_5250=10000` — one env var per kind.
- (B) `KIND_PRICING_JSON='{"5094":10,"5250":10000}'` — single JSON env var.
Path (A) wins for operator legibility (`docker inspect` shows each kind on its own line, easy to grep), and aligns with the existing `FEE_PER_JOB` style (one variable per pricing knob). Path (B) is more compact but harder to introspect and forces a JSON-parse step on every container start. The orchestrator-side complexity is identical (loop and emit). Pick (A).

### Storage cost handling

The AC asks for "Storage costs vs revenue breakdown". Storage cost on the DVM means: the Turbo-bundler upload fee paid on the operator's Arweave wallet when fulfilling a kind:5094 request. The `TurboUploadAdapter` doesn't surface the per-upload fee back to the entrypoint today (it returns the txId from `client.uploadFile()`); making it surface that fee requires plumbing through the ardrive SDK's response shape. For v1, we render `Storage cost: —` with a one-line caveat ("operator pays Turbo bundlers separately") and ship. The `BreakdownPill` is shaped to make the revenue→net rendering easy now and future-compatible: when storage costs become observable, the Pill picks up a real value with no API change. The Net segment for v1 equals the Revenue segment exactly, because storage cost is unmodelled — we render it that way honestly rather than inventing a placeholder zero. Future story: instrument the TurboUploadAdapter to emit upload-cost events the entrypoint counter can sum.

### Pending-job semantics

NIP-90 has four DvmJobStatus values: `processing | error | success | partial`. None of them is `pending`. The AC says "pending, in-progress, completed". The mapping is interpretive:
- `pending` = the job is in the connector's inbound queue but the DVM hasn't started handling it. Not observable from the DVM side; the connector does not expose its inbound queue depth via the existing admin API.
- `in-progress` = handler started, hasn't finished. This is `byStatus.processing`.
- `completed` = handler returned successfully. This is `byStatus.success`. (Failed = `byStatus.error`.)

For v1 we collapse "pending + in-progress" into a single `Active` MetricBlock (= `byStatus.processing`) and add `Completed` and `Failed` MetricBlocks. The AC's three-status framing is preserved in the layout; the labels become Active / Completed / Failed instead of Pending / In-progress / Completed. The empty-state copy ("No jobs in the last 5 minutes") covers the case when all three are zero. If a future story adds connector-queue introspection, a Pending counter slots in next to Active.

### Kind extraction from packet log

The connector's `PacketLogEntry` (from `packages/townhouse/src/connector/types.ts`) currently exposes `{ ts, ilpAddressFrom, ilpAddressTo, amount, result }` — no `kind` field. To group DVM packets by kind, we need either:
- (A) Connector-side change: add `kind?: number` to `PacketLogEntry`, populated from the ILP packet's TOON-decoded event kind. Out-of-scope for this story (connector contract change).
- (B) Client-side decode: re-fetch each packet's data, TOON-decode, extract kind. Not viable — `getPacketLog` doesn't return packet data, just metadata.
- (C) Heuristic: assume all packets to the DVM's ILP address are job requests (kind:5094 or kind:5250 — there are only two registered kinds in v1) and group equally. Wrong for byKind aggregation.
- (D) Feature-detect: try to read `entry.kind`, fall back to bucket 0 ("unattributed") if absent. Document the gap in `CONNECTOR_MIGRATION.md`. Operator sees the unattributed bucket and knows the connector image needs an upgrade.

Pick (D). The DVM's own `health.jobsRecent.byKind` field is the higher-fidelity source — the entrypoint's counter shim sees every kind unambiguously (it's the one calling `node.on(kind, handler)`). The `/jobs/recent` endpoint's `byKind` should cross-check against the connector packet log for sanity, but the canonical numbers come from the DVM's in-memory counter. For v1 we can simplify further: serve `byKind` from the DVM's counter via the health proxy, and use the connector packet log only for `volume`. That removes the connector-side dependency entirely. Implementation choice: prefer DVM-side counter for `byKind`; document path (A) as a future improvement for cross-validation.

### Why the chart hoist (Mill's `VolumeChart` → `JobsChart`)

The chart in 21.11's Mill view (`Mill.tsx:142–215`'s `VolumeChart`) and this story's DVM jobs-per-hour chart are functionally identical: 24 hourly buckets, line color from a tokens-accent prop, earnings-estimate subtitle, identical empty/loading/error/unavailable states. Duplicating the component in `Dvm.tsx` would mean two copies of identical code drifting independently. Hoisting to `src/components/charts/JobsChart.tsx` (renamed for accuracy — both views consume it as a generic per-hour throughput chart) means future view stories also pick it up for free. The rename is forward-friendly: Mill currently uses it for swap volume, the DVM uses it for job count, the future Wallet view (21.13) might use it for transfer count. "JobsChart" is the awkward middle name; alternative names: `ThroughputChart`, `HourlyChart`. Picking `ThroughputChart` final (semantic fit for both views).

### Why we extract `<AddFunds>` instead of duplicating

Same reasoning. The Mill `<AddFunds>` (`Mill.tsx:308–362`) is one disclosure, one copy-button toast pattern, one address-list render. The DVM consumes the same component with `nodeId="dev-dvm-01"`. Extracting once means future Wallet view (21.13) gets the same disclosure for free. The extraction is a pure refactor with no behavior change.

### Why no connector contract canary extension

This story does not introduce new connector admin contract dependencies. `getPacketLog` is reused from 21.10's contract; the new `/jobs/recent` route does not call any new connector method. The 21.7.5 canary's existing assertions cover everything this story relies on.

### What this story does NOT do

- Does not implement the Wallet view — that's 21.13.
- Does not implement the first-run wizard — that's 21.14.
- Does not implement ATOR connectivity status — that's 21.15.
- Does not modify the connector. Kind grouping uses the DVM-side counter as canonical (Dev Notes § Kind extraction from packet log).
- Does not add a `swapEvents`-style WS push for jobs. Job state is polled via `useDvmJobsRecent` (5 s) + `useNodeHealth` (5 s). If a future story needs sub-second job feedback, that's a backwards-compatible extension.
- Does not implement signed withdraw transactions in the Add Funds flow. Receive-only. Wallet view (21.13) handles signed sends.
- Does not introduce `Pending` queue tracking. See Dev Notes § Pending-job semantics.
- Does not surface Turbo upload costs. See Dev Notes § Storage cost handling — `Net` equals `Revenue` for v1 with an honest caveat.
- Does not promote `BreakdownPill` into 21.8.5 retroactively. It lives in this story per the original 21.8.5 plan ("BreakdownPill ships in the view stories that need them").
- Does not modify the chart library, design tokens, or ESLint rules. Inherits 21.8.5 verbatim.
- Does not implement per-pair custom fees. The `kindPricing` field is per-kind, not per-pair.
- Does not implement SLA / handler-latency analytics. Add later if operators ask.
- Does not add a manual "rerun job" or "refund job" admin button. Out of scope.
- Does not refactor the connector's `PacketLogEntry` shape to surface `kind` per entry. That's a separate connector-side change tracked in its own repo.

## Project Structure Notes

### Files this story creates

**`packages/sdk/`:**
- (New) `src/dvm-health.ts` — `DvmHealthResponse` interface + helper types.
- (New) `src/dvm-health.test.ts` — shape test.
- (Modified) `src/index.ts` — barrel re-export.

**`docker/`:**
- (Modified) `src/entrypoint-dvm.ts` — add Hono BLS server; add job-counter shim; read `KIND_PRICING_<kind>` env vars.
- (Modified or new) `src/entrypoint-dvm.test.ts` — counter shim unit tests; env-var precedence tests; BLS server registration check.

**`packages/townhouse/`:**
- (Modified) `src/config/schema.ts` — `DvmNodeConfig.kindPricing?` field + JSON-schema validator allowance.
- (Modified) `src/api/types.ts` — replace `DvmHealthPayload` with imported `DvmHealthResponse`; add `JobsRecentPayload`; extend `NodeDetail.config` with `kindPricing?`.
- (Modified) `src/api/index.ts`, `src/index.ts` — barrel re-exports.
- (Modified) `src/api/routes/nodes.ts` — add `GET /api/nodes/:nodeId/jobs/recent` + the kind-extraction helper.
- (Modified) `src/api/routes/nodes-patch.ts` — accept `kindPricing` body for dvm; reject for other types; trigger restart on change.
- (Modified) `src/docker/orchestrator.ts:buildNodeEnv('dvm')` — emit `KIND_PRICING_<kind>` env vars.
- (New) `src/api/routes/nodes-jobs-recent.test.ts`
- (Modified) `src/api/routes/nodes-patch.test.ts` — extend with kindPricing tests.
- (Modified) `src/docker/orchestrator.test.ts` — extend with kindPricing env-var tests.
- (Modified) `src/docker/dvm-dockerfile.test.ts` — add Hono `/health` registration assertion.

**`packages/townhouse-web/`:**
- (New) `src/views/Dvm.tsx`
- (New) `src/views/Dvm.test.tsx`
- (Modified) `src/App.tsx` — add `/dvm` route.
- (Modified) `src/views/Home.tsx` — extend `VIEW_LINKS` with `dvm: '/dvm'`.
- (New) `src/components/primitives/BreakdownPill.tsx` + `.stories.tsx` + `.test.tsx`
- (Modified) `src/components/primitives/index.ts` — barrel.
- (Modified) `src/__tests__/a11y-baseline.test.tsx` — append `BreakdownPill`.
- (New) `src/components/charts/ThroughputChart.tsx` (extracted/renamed from `Mill.tsx`'s `VolumeChart`).
- (New) `src/components/charts/ThroughputChart.test.tsx`
- (New) `src/components/AddFunds.tsx` (extracted from `Mill.tsx`).
- (New) `src/components/AddFunds.test.tsx`
- (New) `src/lib/format-volume.ts` (extracted from `Mill.tsx`).
- (New) `src/lib/format-volume.test.ts`
- (Modified) `src/views/Mill.tsx` — import the extracted utilities/components from their new locations; pass `color` prop to `ThroughputChart`. Pure refactor, no behavior change.
- (Modified) `src/hooks/useNodeMetrics.ts` — extend `currentFee` derivation with `feePerJob` fallback.
- (New) `src/hooks/useDvmJobsRecent.ts` + `.test.ts`
- (New) `screenshots/21-12-dvm-view-default.png`
- (New) `screenshots/21-12-dvm-view-active.png`
- (New) `screenshots/21-12-dvm-view-degraded.png`
- (New) `screenshots/21-12-dvm-pricing-applied.png`
- (New) `screenshots/21-12-home-dvm-link.png`

**`scripts/`:**
- (Modified) `townhouse-dev-infra.sh` — strict-mode `wait_for_health || exit 1` for the five health waits (or, narrower, for the dvm-01 wait specifically).
- (Optional new) `scripts/trigger-dvm-job.mjs` — one-off swap-trigger for the live-Docker active-state screenshot. Alternative: invoke an existing SDK integration test as the trigger and document in the PR description.

### Architecture compliance

- **Shadow-as-border, no traditional `border:`:** Enforced by 21.8.5 ESLint rule `no-raw-border`. New primitive (`BreakdownPill`) uses `shadow-border` for its container.
- **No inline hex outside `theme/tokens.ts`:** Enforced by 21.8.5 rule `no-inline-hex`. Tones in `BreakdownPill` use Tailwind utilities backed by tokens (`text-green-600/80`, `text-red-500/80`, `text-ink`).
- **No positive letter-spacing on Geist:** Enforced by `no-positive-letter-spacing-geist`. New view applies tracking through token-defined utility classes only.
- **No direct recharts imports:** Enforced by `no-direct-recharts`. The DVM chart consumes `ThroughputChart`, which already uses `@/charts` exclusively (inherited from Mill).
- **Chart library:** shadcn/ui charts (locked by 21.9, used by 21.10/21.11). Same `ChartContainer` + `LineChart` shape.
- **Fee enforcement remains in connector:** Per-kind `kindPricing` is persisted via Townhouse `PATCH /api/nodes/dvm/config`, propagated to the DVM container as `KIND_PRICING_<kind>` env vars at connector restart. The dashboard never enforces fees client-side.
- **No state management library:** View uses local `useState`/`useEffect`/`useRef` per 21.10/21.11 precedent. TanStack Query is a future story decision.
- **No new runtime dependencies in `townhouse-web`:** `BreakdownPill` is plain Tailwind + tokens. No icon library, no animation library.
- **No new runtime dependencies in `docker/`:** `hono` and `@hono/node-server` are already bundled into the DVM image per 21.7's externals list.
- **No new connector contract dependencies:** Reuses 21.10's `getPacketLog`. The `kind` field on `PacketLogEntry` is feature-detected and falls back to bucket 0; the canonical `byKind` source is the DVM's in-memory counter.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Fixed negative bigint edge case in `formatVolume.test.ts` (BigInt('') returns 0n, not throw)
- Fixed test timing for handler kinds row (needs `waitFor` with async health data)
- Fixed `useNodeHealth` returning no `refetch` — removed destructuring from DvmCard
- Fixed `connector down returns 503` — tracked whether `getPeers()` threw to distinguish connector-down from peer-not-found
- Removed inline hex `#ff5b4f` from `ThroughputChart.test.tsx` per ESLint `no-inline-hex` rule

### Completion Notes List

- **Phase A (DVM BLS health server):** Created `DvmHealthResponse` type in SDK (`packages/sdk/src/dvm-health.ts`), re-exported from index. Added `createJobCounter()` sliding-window shim to `entrypoint-dvm.ts` wrapping Arweave + Dungeon handlers. Added Hono BLS server on `blsPort` (3400) after `node.start()`. Added `KIND_PRICING_<kind>` env-var parsing in `applyEnvOverlay()`. Fixed dev-infra strict healthcheck (`|| exit 1` for all five waits).
- **Phase B (Townhouse API):** Added `GET /api/nodes/:nodeId/jobs/recent` route — byKind from DVM health counter, volume from packet log, byStatus proxied from health cache. Extended `PATCH /api/nodes/dvm/config` with `kindPricing` support; non-dvm types reject with 400. Added `DvmNodeConfig.kindPricing?` to schema; updated validator, orchestrator env-var emission, and types.
- **Phase C (BreakdownPill):** New primitive at `src/components/primitives/BreakdownPill.tsx` — three-tone segments, shadow-bordered pill, computed `aria-label`, accessible middot separators, axe-core zero violations.
- **Phase D (DVM view):** Extracted `formatVolume` → `src/lib/format-volume.ts`, `VolumeChart` → `src/components/charts/ThroughputChart.tsx` (with `color` prop), `AddFunds` → `src/components/AddFunds.tsx`. Created `useDvmJobsRecent` hook. Created `src/views/Dvm.tsx` with DVM card composition (StatusDot, TypeChip, MetricBlocks, handler-kinds row, per-kind pricing sliders, ThroughputChart, BreakdownPill, AddFunds). Added `/dvm` route to App.tsx and `dvm: '/dvm'` to `VIEW_LINKS` in Home.tsx. Extended `useNodeMetrics` to include `feePerJob` in `currentFee` derivation.
- All 4 packages tested and green: docker (84 tests), SDK (shape test), townhouse (524 tests), townhouse-web (257 tests + lint + build).
- Task 19 (Live-Docker screenshots) requires manual execution with the dev stack running — documented in AC-23. Screenshots directory placeholder ready.

### File List

**packages/sdk/:**
- `src/dvm-health.ts` (new)
- `src/dvm-health.test.ts` (new)
- `src/index.ts` (modified — added DvmHealthResponse exports)
- `CONNECTOR_MIGRATION.md` (modified — documented PacketLogEntry kind gap)

**docker/:**
- `src/entrypoint-dvm.ts` (modified — Hono BLS server, job counter shim, KIND_PRICING env vars, export applyEnvOverlay, VITEST gate)
- `src/entrypoint-dvm.test.ts` (new)

**packages/townhouse/:**
- `src/config/schema.ts` (modified — DvmNodeConfig.kindPricing?)
- `src/config/validator.ts` (modified — validate kindPricing, pick it)
- `src/api/types.ts` (modified — DvmHealthResponse import, JobsRecentPayload, JobsByKindEntry, NodeDetail.kindPricing)
- `src/api/index.ts` (modified — export new types)
- `src/index.ts` (modified — export new types)
- `src/api/routes/nodes.ts` (modified — GET /jobs/recent route, DvmHealthResponse import)
- `src/api/routes/nodes-patch.ts` (modified — kindPricing support, regenerate trigger)
- `src/docker/orchestrator.ts` (modified — KIND_PRICING env-var emission)
- `src/api/routes/nodes-jobs-recent.test.ts` (new)
- `src/api/routes/nodes-patch.test.ts` (modified — kindPricing tests appended)
- `src/docker/orchestrator.test.ts` (modified — kindPricing env-var tests)
- `src/docker/dvm-dockerfile.test.ts` (modified — Hono BLS server assertions)

**packages/townhouse-web/:**
- `src/views/Dvm.tsx` (new)
- `src/views/Dvm.test.tsx` (new)
- `src/App.tsx` (modified — /dvm route)
- `src/views/Home.tsx` (modified — VIEW_LINKS dvm)
- `src/views/Mill.tsx` (modified — use extracted ThroughputChart, AddFunds, formatVolume)
- `src/components/primitives/BreakdownPill.tsx` (new)
- `src/components/primitives/BreakdownPill.test.tsx` (new)
- `src/components/primitives/index.ts` (modified — barrel export)
- `src/__tests__/a11y-baseline.test.tsx` (modified — BreakdownPill variants)
- `src/components/charts/ThroughputChart.tsx` (new)
- `src/components/charts/ThroughputChart.test.tsx` (new)
- `src/components/AddFunds.tsx` (new)
- `src/components/AddFunds.test.tsx` (new)
- `src/lib/format-volume.ts` (new)
- `src/lib/format-volume.test.ts` (new)
- `src/hooks/useNodeMetrics.ts` (modified — feePerJob in currentFee)
- `src/hooks/useDvmJobsRecent.ts` (new)
- `src/hooks/useDvmJobsRecent.test.ts` (new)

**scripts/:**
- `townhouse-dev-infra.sh` (modified — || exit 1 on all five health waits)

## Change Log

- 2026-04-30: Story implemented by claude-sonnet-4-6. All 4 phases complete: DVM BLS health server, Townhouse API extensions (jobs/recent, kindPricing PATCH, orchestrator env vars), BreakdownPill primitive, DVM management view. 465 new/modified tests pass across docker, SDK, townhouse, townhouse-web packages. Task 19 (live-Docker screenshots) requires manual execution.

## References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.12: Dashboard — DVM Management View] — original AC list (8 ACs); this story expands them per the 21.10/21.11 precedent.
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-008] — visual direction (Geist/Vercel light theme, dvm accent `#ff5b4f`).
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-009] — live-Docker development mandate.
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#3.7 (T-053–T-062)] — test scenarios for stories 21.9–12 dashboard views, specifically T-059 (DVM job queue counts).
- [Source: _bmad-output/implementation-artifacts/21-11-dashboard-mill-management-view.md] — bundled-API-with-view-with-primitive precedent; FeeSlider pattern; AddFunds disclosure; LiquidityBar/PairChip/ChainIcon/TokenIcon primitives; `useNodeHealth` generic hook; `useDepositAddresses` hook; rebal-pulse delta detection; live-Docker verification structure. Most directly mirrored story.
- [Source: _bmad-output/implementation-artifacts/21-10-dashboard-town-management-view.md] — connector restart awareness; `connectorRestarting`/`connectorRestarted` WS events; `usePacketTimeseries` hook; `tokens.accent` alias; FeeSlider PATCH-and-retry-on-409 pattern.
- [Source: _bmad-output/implementation-artifacts/21-9-dashboard-spa-home-view.md] — `VIEW_LINKS` extension point in `Home.tsx`.
- [Source: _bmad-output/implementation-artifacts/21-8-5-dashboard-design-system-foundation.md] — 7-primitive baseline; `BreakdownPill` deferred to view stories; ESLint rules; design tokens.
- [Source: _bmad-output/implementation-artifacts/21-7-dvm-node-dockerfile.md] — DVM container layout; standalone-mode HTTP handler on port 3300; BLS port 3400 reservation (latent gap fixed in this story); `FEE_PER_JOB` env var dual-mapping to `basePricePerByte` + `kindPricing[5250]`.
- [Source: docker/src/entrypoint-dvm.ts] — entrypoint to extend with Hono BLS server + job counter shim + `KIND_PRICING_<kind>` env-var support.
- [Source: docker/Dockerfile.dvm] — `EXPOSE 3300 3400` + `HEALTHCHECK` on `BLS_PORT` (no code change required from this story; the existing `EXPOSE`/`HEALTHCHECK` lines now have a real server to talk to).
- [Source: scripts/townhouse-dev-infra.sh:282] — DVM health-wait that currently times out silently; this story adds strict-mode exit.
- [Source: docker-compose-townhouse-dev.yml:367–397] — `townhouse-dev-dvm-01` service; existing TURBO_TOKEN passthrough + identity env-var pattern; the `KIND_PRICING_<kind>` env vars will be injected at orchestrator-runtime by the host-side process, not declared statically in compose.
- [Source: packages/sdk/src/create-node.ts:1047–1050] — current `/health` shape (`{ status: 'healthy', pubkey }`) on `handlerPort`; this story does NOT change this — the BLS server on `blsPort` is a parallel, richer endpoint.
- [Source: packages/sdk/src/arweave/arweave-dvm-handler.ts] — `createArweaveDvmHandler` registered on `kind:5094`; this story wraps it with the counter shim, no internal changes.
- [Source: packages/pet-dvm/src/dungeon/dungeonDvmHandler.ts:160–] — `createDungeonDvmHandler` registered on `kind:5250`; same wrapping pattern.
- [Source: packages/core/src/events/dvm.ts:79] — `DvmJobStatus = 'processing' | 'error' | 'success' | 'partial'`; `byStatus` field uses these as keys.
- [Source: packages/townhouse/src/api/routes/nodes.ts:341–388] — existing `GET /api/nodes/:nodeId/health` route from 21.11 that already routes to DVM via `getNodeHealthEndpoint(nodeId, 'dvm')`. No change needed.
- [Source: packages/townhouse/src/api/routes/nodes.ts:390–490] — Mill's `/swaps/recent` route; DVM's `/jobs/recent` mirrors this structure.
- [Source: packages/townhouse/src/api/routes/nodes-patch.ts:130–156] — fee-field-per-type routing (`feePerEvent` → town, `feeBasisPoints` → mill, `feePerJob` → dvm); this story extends the dvm branch with `kindPricing` support.
- [Source: packages/townhouse/src/docker/orchestrator.ts:680–724] — `buildNodeEnv('dvm')` emitting `FEE_PER_JOB`; this story adds `KIND_PRICING_<kind>` emission alongside.
- [Source: packages/townhouse/src/constants.ts:33–35] — `TOWN_HEALTH_PORT=3100`, `MILL_HEALTH_PORT=3200`, `DVM_HEALTH_PORT=3400`. Already correct.
- [Source: packages/townhouse-web/src/views/Mill.tsx:142–215] — `VolumeChart` to extract/rename as `ThroughputChart`.
- [Source: packages/townhouse-web/src/views/Mill.tsx:60–73] — `formatVolume` to extract.
- [Source: packages/townhouse-web/src/views/Mill.tsx:308–362] — `<AddFunds>` to extract.
- [Source: packages/townhouse-web/src/hooks/useMillSwapsRecent.ts] — shape mirror for `useDvmJobsRecent`.
- [Source: packages/townhouse-web/src/hooks/useNodeHealth.ts] — generic hook reused with `DvmHealthResponse` type narrowing.
- [Source: packages/townhouse-web/src/components/primitives/MetricBlock.tsx] — primitive consumed for Active/Completed/Failed counters and revenue.
- [Source: packages/townhouse-web/src/theme/tokens.ts:13–16] — `colors.type.dvm = '#ff5b4f'` (Vercel Ship Red); chart line color and TypeChip accent.
- [Source: packages/townhouse-web/src/views/Home.tsx:22–25] — `VIEW_LINKS` map; extend with `dvm: '/dvm'`.
- [Source: packages/sdk/CONNECTOR_MIGRATION.md] — destination for the kind-extraction documentation update.

## Change Log

- 2026-04-30: Story implemented (Claude Sonnet 4.6). 4 phases complete. 465 new/modified tests pass.
- 2026-04-30: Code review run (`/bmad-code-review 21.12`) — 60 unique findings after triage and dedupe (1 decision-needed, 25 patch, 17 defer, 17 dismissed). Findings appended below. Subagent layers ran as `general-purpose` (Blind Hunter / Edge Case Hunter / Acceptance Auditor).
- 2026-04-30: All 26 patches applied and tests green. Decision-needed item resolved with option (a) — earnings caption now uses `count × averageVolume × kindPricing[primaryKind] / 1_000_000` in bigint domain. Other landed fixes: per-key `kindPricing` PATCH merge (no more clobber); `BLS server close()` properly promisified before `node.stop()`; `kindPricing` key + value validation (prototype-pollution + env-injection guard); `useNodeHealth` and `useDvmJobsRecent` expose `refetch`, called after PATCH success along with `useNodeMetrics`; `BreakdownPill.stories.tsx` created; `shadow-border` token applied to BreakdownPill + DVM card root; kind badges use TypeChip-style accent-tinted bg; zero-revenue collapses to em-dash everywhere; slider no longer renders "Fee for kind:0" when handlerKinds is empty (now "Fee per job"); `Number(kindPricing[k]) || fallback` → nullish-coalescing so legitimate `'0'` survives; `windowSec` clamped to 1–300 to match the DVM counter window; AbortController + 3s timeout on the `/jobs/recent` health proxy fetch; `extractKindFromPacketEntry` extracted; `events` array evicts on every push; `KIND_PRICING_<n>` malformed values log a warning; WS close handler no longer races real connector restarts; PATCH res.json() failure no longer throws unhandled; `BreakdownPill` segments key by index; new tests for `connector_endpoint_not_found` 503 path, `windowSec=301` 400, BreakdownPill duplicate-label keys, `ThroughputChart` empty-earnings placeholder, AddFunds URL assertion, and Mill ThroughputChart `color` prop. Test suite: docker 84 ✓, sdk 685 ✓, townhouse 526 ✓, townhouse-web 260 ✓.

### Review Findings

> Triaged from Acceptance Auditor + Blind Hunter + Edge Case Hunter passes (2026-04-30).

#### Decision needed

- [x] [Review][Decision] **Earnings caption omits `averageVolume` factor — RESOLVED 2026-04-30 with option (a)** [packages/townhouse-web/src/views/Dvm.tsx:2645-2650] — AC-18 specifies the formula `count × averageVolume × kindPricing[primaryKind] / 1_000_000`. Decision: compute `averageVolume = totalVolume / totalJobs` from `jobs/recent` payload and apply Mill-style. Becomes a patch below.

#### Patches

- [x] [Review][Patch] **AC-18 earnings caption: include `averageVolume` factor** [packages/townhouse-web/src/views/Dvm.tsx:2645-2650] — Compute `averageVolume = BigInt(jobsRecent.volume) / BigInt(jobsRecent.count)` (guard `count > 0`); apply formula `count × averageVolume × kindPricing[primaryKind] / 1_000_000` using bigint domain throughout (mirror Mill's `formatVolume` precision pattern). When `count` is below STABLE_THRESHOLD or `volume === '0'`, render the same "—" placeholder as Mill rather than a numeric estimate.
- [x] [Review][Patch] **`kindPricing` PATCH shallow-merges and clobbers existing entries** [packages/townhouse/src/api/routes/nodes-patch.ts:95-104] — UI sends `{ kindPricing: { '5094': 7 } }` to update only kind:5094. The route does `{ ...nodeConfig, ...body }` (or equivalent shallow spread) replacing `kindPricing` wholesale; previously-set kind:5250 pricing is lost from the persisted YAML. **Fix:** merge per-key — `mergedConfig.nodes.dvm.kindPricing = { ...existing.kindPricing, ...body.kindPricing }`. Add a regression test for partial PATCH.
- [x] [Review][Patch] **BLS server `close()` not actually awaited; `node.stop()` runs while sockets still draining** [docker/src/entrypoint-dvm.ts:228 / shutdown handler] — `serve()` returns a Node `http.Server` whose `close(callback)` is non-Promise. The `as { close: () => Promise<void> }` cast lies. **Fix:** wrap in `await new Promise<void>((resolve, reject) => blsServer.close((err) => err ? reject(err) : resolve()))`.
- [x] [Review][Patch] **No refetch of `useNodeHealth` / `useDvmJobsRecent` after successful PATCH** [packages/townhouse-web/src/views/Dvm.tsx handleApplyKindFee + DvmCard] — AC-17 explicit: "After successful PATCH, refetch `useNodeHealth` and `useDvmJobsRecent`." `useNodeHealth` lacks a `refetch` handle (Debug Log Reference acknowledged this and dropped the destructure). Slider visually snaps back to old value during the 5s poll gap. **Fix:** mirror the 21.11 resolution — add `refetch` to `useNodeHealth`, destructure it in `DvmCard`, call `refetchHealth()` and `refetchJobs()` in `handleApplyKindFee` after `res.ok`.
- [x] [Review][Patch] **Missing `BreakdownPill.stories.tsx`** [packages/townhouse-web/src/components/primitives/BreakdownPill.stories.tsx] — AC-12 + Files-this-story-creates list mandate it. Every other primitive ships `.stories.tsx`. **Fix:** create with three stories per AC-12 (default three-tone, single-segment, long-string truncation).
- [x] [Review][Patch] **`BreakdownPill` and DVM card root use raw `shadow-[0_0_0_1px_rgba(0,0,0,0.08)]` instead of the `shadow-border` token utility** [packages/townhouse-web/src/components/primitives/BreakdownPill.tsx, packages/townhouse-web/src/views/Dvm.tsx (card root)] — AC-21 + Architecture compliance: shadow-as-border via the tokenized utility. Mill's card root uses `shadow-border`; Dvm's hand-codes the rgba. **Fix:** replace both occurrences with `shadow-border`.
- [x] [Review][Patch] **Slider lies about which kind it's editing when `handlerKinds` is empty** [packages/townhouse-web/src/views/Dvm.tsx:2723-2731 fallback slider] — Renders `<DvmFeeSlider kind={0} ... />` so label reads `Fee for kind:0`, but Apply sends `{ feePerJob: value }` (kind=-1 sentinel). **Fix:** when `handlerKinds.length === 0`, render with explicit `label="Fee per job"` rather than passing kind:0.
- [x] [Review][Patch] **`/jobs/recent` health proxy fetch has no AbortController/timeout** [packages/townhouse/src/api/routes/nodes.ts:909-911] — A hung DVM container blocks the Fastify request indefinitely; the parallel `/health` route (line 371-378) already uses a 3s AbortController. **Fix:** mirror it — `AbortController` + 3s timeout on the proxy fetch.
- [x] [Review][Patch] **`kindPricing` keys not validated to be numeric strings (prototype-pollution surface + invalid env-var keys)** [packages/townhouse/src/config/validator.ts:69-77, packages/townhouse/src/api/routes/nodes-patch.ts:35-38] — Validator and PATCH JSON-schema only check values, not keys. `kindPricing: { '__proto__': 5, 'abc': 1, '5094\nFOO=bar': 1 }` passes. Orchestrator emits `KIND_PRICING___proto__=5`, etc.; the newline-injection key escapes Docker env. **Fix:** validator checks every key matches `/^\d+$/`; PATCH schema uses `propertyNames: { pattern: '^\\d+$' }` (AJV).
- [x] [Review][Patch] **`Number(kindPricing[k]) || feePerJobFallback` swallows legitimate `'0'` pricing** [packages/townhouse-web/src/views/Dvm.tsx:2640-2643, 2718-2720] — Operator setting kind:5094 to free → `Number('0') = 0`, `0 || fallback = fallback`. Slider shows fallback, Apply persists fallback, "free" intent is silently overridden. **Fix:** `kindPricing[k] != null ? Number(kindPricing[k]) : feePerJobFallback` (use nullish-coalescing).
- [x] [Review][Patch] **`/jobs/recent` `windowSec` accepts 1–3600 but DVM counter is hardcoded 5min — `count` and `volume` come from different windows** [packages/townhouse/src/api/routes/nodes.ts windowSec validation, docker/src/entrypoint-dvm.ts createJobCounter window] — Caller passes `windowSec=3600`, gets packet-log volume over 1h plus health-sourced byKind/total over 5min. Dashboard renders mixed-window numbers. **Fix:** clamp `windowSec` to 300 max, or document the divergence + emit `byKind`/`total`/`byStatus` as 5min-only fields.
- [x] [Review][Patch] **Zero-revenue not collapsing to em-dash in `BreakdownPill`** [packages/townhouse-web/src/views/Dvm.tsx:2747-2766] — `formatVolume('0', 6) === '0'` (truthy), so segment renders `0 USDC` and `Net: 0 USDC` instead of `—`. AC-19: "When revenue is zero or unavailable, all values render as `—`." **Fix:** explicit `revenueFormatted && revenueFormatted !== '0' ? ... : '—'`.
- [x] [Review][Patch] **Inline kind-badge does not reuse TypeChip styling** [packages/townhouse-web/src/views/Dvm.tsx:~2693] — AC-16: "styled identically to PairChip but with single-kind content. Reuse TypeChip styling via a small inline component". Diff invents a third visual treatment with `shadow-[0_0_0_1px_rgba(255,91,79,0.3)]` rather than TypeChip's accent-tinted-bg pattern. **Fix:** use TypeChip's `bg-type-dvm/10 text-type-dvm rounded-md ...` shape, or reuse `<TypeChip type="dvm">` directly.
- [x] [Review][Patch] **`extractKindFromPacketEntry` helper missing + no unit test** [packages/townhouse/src/api/routes/nodes.ts:~952] — Task 7.1/7.3 mandates a named helper with both-shape tests; diff inlined `(entry as { kind?: number }).kind ?? 0`. **Fix:** extract + test (kind present, kind absent both return correct values).
- [x] [Review][Patch] **Mill.test.tsx missing color-prop test for `ThroughputChart` hoist** [packages/townhouse-web/src/views/Mill.test.tsx] — Task 13.2 explicit: "Update Mill imports + add color-prop test in `Mill.test.tsx`." `grep` confirms no such test added. **Fix:** add a render assertion that Mill passes `tokens.accent.mill` (or equivalent) to `ThroughputChart`.
- [x] [Review][Patch] **`createJobCounter.events` array unbounded between snapshots (memory leak)** [docker/src/entrypoint-dvm.ts:81-86, 104-105] — `wrap()` only `events.push(...)`; `evict()` runs only inside `snapshot()`. Without a `/health` consumer (e.g., HEALTHCHECK disabled, no dashboard polling), events grow forever at job-throughput rate. **Fix:** call `evict()` inside `wrap()` either every Nth event or unconditionally.
- [x] [Review][Patch] **`useDvmJobsRecent` does not reset to `loading`/`null` on `nodeId` change** [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:62-90] — Switching DVM cards displays the previous DVM's data until the new fetch resolves. **Fix:** at effect start, `setData(null); setStatus('loading')` after cleaning up the previous abort controller.
- [x] [Review][Patch] **`useDvmJobsRecent.refetch` discards the in-flight promise** [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:96-98] — `refetch = () => { pollRef.current(); }` — callers cannot `await refetch()`. **Fix:** `refetch = () => pollRef.current()`.
- [x] [Review][Patch] **`querySelector(...).toBeDefined()` instead of `.not.toBeNull()`** [packages/townhouse-web/src/components/charts/ThroughputChart.test.tsx:1842-1867, packages/townhouse-web/src/components/primitives/BreakdownPill.test.tsx:~1929,1937,1945] — `null` IS defined; assertions silently pass even when the queried element is missing. **Fix:** `expect(...).not.toBeNull()` or `expect(...).toBeInTheDocument()`.
- [x] [Review][Patch] **`BreakdownPill` segments use `seg.label` as React key (collision)** [packages/townhouse-web/src/components/primitives/BreakdownPill.tsx:~2017] — Duplicate labels (e.g., two `Net` segments) trigger React duplicate-key warning + reconciliation bugs. **Fix:** use array index for the key.
- [x] [Review][Patch] **WebSocket `close` handler resets `isRestarting=false` during a real connector restart** [packages/townhouse-web/src/views/Dvm.tsx:2814-2865 ws close handler] — Network jitter dropping the WS mid-restart prematurely clears the restart flag and unblocks Apply, allowing operators to PATCH again before restart finishes. **Fix:** only `connectorRestarted` message resets `isRestarting`; WS `close` should leave it alone (or restore from a persistent server-side query).
- [x] [Review][Patch] **Validator allows non-finite/non-integer `kindPricing` values** [packages/townhouse/src/config/validator.ts:1083-1091] — `kindPricing: { '5094': .inf }` or `{ '5094': 1.5 }` passes validation; entrypoint then `BigInt('Infinity')` throws (silently swallowed) or rounds. **Fix:** add `Number.isFinite(v) && Number.isInteger(v)` to the validator.
- [x] [Review][Patch] **`KIND_PRICING_<n>` malformed values silently ignored vs `FEE_PER_JOB` throws** [docker/src/entrypoint-dvm.ts:298-320] — `KIND_PRICING_5094=abc` → `BigInt('abc')` throws → silently dropped → operator sees "applied" UI but wrong fee. `FEE_PER_JOB=abc` crashes startup loudly. **Fix:** at minimum log a warning when BigInt parsing fails; ideally throw to surface the misconfiguration.
- [x] [Review][Patch] **`nodes-jobs-recent.test.ts` does not cover `connector_endpoint_not_found` 503 branch** [packages/townhouse/src/api/routes/nodes-jobs-recent.test.ts] — Connector v3.3.3 omits `/packets`; the route returns 503 with that code. No test exercises this path. **Fix:** mock `getPacketLog` to throw `EndpointNotFound` and assert the 503 + code.
- [x] [Review][Patch] **`ThroughputChart` hoist subtly diverges from prior Mill earnings-fallback branch** [packages/townhouse-web/src/components/charts/ThroughputChart.tsx:1746-1820, packages/townhouse-web/src/views/Mill.tsx:~610-641] — Original `VolumeChart` rendered an "Approx earnings at current fee: —" branch when `cnt > 0 && metrics.currentFee !== null` but no stable threshold was met. Hoisted version gates on `!!earningsEst && count > 0`; Mill no longer passes a placeholder string for that branch. Task 13.3 says "Pure refactor — Mill behavior unchanged." **Fix:** restore the placeholder fallback path or update Task 13.3 in a follow-up note.
- [x] [Review][Patch] **`AddFunds.test.tsx` mocks fetch but never asserts URL** [packages/townhouse-web/src/components/AddFunds.test.tsx:1631-1661] — `vi.spyOn(globalThis, 'fetch').mockResolvedValue(...)` returns the same body for any URL; "type=dvm renders evm-only" passes regardless of which endpoint the hook actually calls. **Fix:** assert `fetch.mock.calls[0][0]` matches `/\/api\/nodes\/[^/]+\/deposit-addresses$/`.

#### Deferred (no immediate action)

- [x] [Review][Defer] **PATCH `/api/nodes/dvm/config` is type-level not instance-level — slider on `dev-dvm-01` card applies to all DVM nodes** [packages/townhouse-web/src/views/Dvm.tsx:2867-2880, packages/townhouse/src/api/routes/nodes-patch.ts] — deferred, pre-existing API design — `void nodeId` comment in the diff acknowledges. Real concern when multiple DVM instances exist. The 21.11 multi-instance refactor scoped health/swaps/deposit-addresses by `:nodeId` but did not refactor PATCH. Promote to per-instance scope in a future story.
- [x] [Review][Defer] **`useDvmJobsRecent` polling doesn't pause when tab is backgrounded** [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:84] — deferred, codebase-wide pattern. No other hook in `packages/townhouse-web/src/hooks` gates on `document.visibilityState`. Address as a cross-cutting improvement.
- [x] [Review][Defer] **Refetch + interval-tick race may overwrite fresh data with stale** [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:54-95] — deferred. Two `poll()` calls in flight; slower-resolving one wins. Add monotonic request id when shipping.
- [x] [Review][Defer] **`BigInt(entry.amount)` throws on non-decimal amount strings** [packages/townhouse/src/api/routes/nodes.ts:602,610] — deferred, connector contract concern; current connector emits decimal strings only.
- [x] [Review][Defer] **Connector-down: `swaps/recent` returns 200/empty, `jobs/recent` returns 503 — asymmetric** [packages/townhouse/src/api/routes/nodes.ts:539-549 vs :436-447] — deferred, design choice. Reconcile across both routes in a future tidy-up.
- [x] [Review][Defer] **`windowSec=0050` leading-zero passes regex** [packages/townhouse/src/api/routes/nodes.ts:867-882] — deferred, cosmetic.
- [x] [Review][Defer] **Number → BigInt precision loss for `kindPricing` values > MAX_SAFE_INTEGER** [docker/src/entrypoint-dvm.ts:424-426 health response] — deferred, rare (>9 quadrillion fees).
- [x] [Review][Defer] **`primaryKind.reduce` ties broken by insertion order (non-deterministic)** [packages/townhouse-web/src/views/Dvm.tsx:147-150] — deferred, cosmetic. Tie-break by `kind` ascending if ever needed.
- [x] [Review][Defer] **Static-analysis tests duplicated between `dvm-dockerfile.test.ts` and `entrypoint-dvm.test.ts`** [packages/townhouse/src/docker/dvm-dockerfile.test.ts:1112-1137, docker/src/entrypoint-dvm.test.ts:1443-1469] — deferred, DRY refactor; pre-existing pattern (mill has same dual-test setup).
- [x] [Review][Defer] **`KIND_PRICING_0=N` silently accepted (kind:0 is Nostr profile metadata, not a DVM job kind)** [docker/src/entrypoint-dvm.ts:308-316] — deferred, no functional harm; UI iterates handlerKinds (won't include 0).
- [x] [Review][Defer] **Counter `processing` not decremented on unhandled rejection inside the wrapped handler** [docker/src/entrypoint-dvm.ts:83-96] — deferred. Promise wrapping in v1 catches all rejections. Real risk only if the handler launches fire-and-forget work that throws.
- [x] [Review][Defer] **Clock skew / non-monotonic `Date.now()` breaks event eviction invariant** [docker/src/entrypoint-dvm.ts:76-81] — deferred, rare NTP step.
- [x] [Review][Defer] **AbortError on timeout briefly flips status loading→error→ready** [packages/townhouse-web/src/hooks/useDvmJobsRecent.ts:67-78] — deferred, minor UX flicker.
- [x] [Review][Defer] **`DvmFeeSlider` `isDirty` microtask race — drag during success-path setIsDirty(false)** [packages/townhouse-web/src/views/Dvm.tsx:2537-2539] — deferred, rare race window.
- [x] [Review][Defer] **`/jobs/recent` returns 200/zero with no degraded indicator when ilpAddress is missing** [packages/townhouse/src/api/routes/nodes.ts:928-939] — deferred. Caller can't distinguish "no jobs" from "address unknown"; consider a `degraded: true` field in a future tidy-up.
- [x] [Review][Defer] **Health response cached without shape validation** [packages/townhouse/src/api/routes/nodes.ts:909-911] — deferred, improvement not bug. Container-side trust boundary.
- [x] [Review][Defer] **VITEST env-var gate is fragile** [docker/src/entrypoint-dvm.ts:247-255] — deferred. Use `import.meta.url === pathToFileURL(process.argv[1]).href` if a different test runner is ever introduced.
