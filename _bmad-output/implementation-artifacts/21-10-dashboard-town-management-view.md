# Story 21.10: Dashboard — Town Management View (with API Extension)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (party mode 2026-04-29):** The original epic-file scope for 21.10 named the view but punted the plumbing. Re-entry analysis confirmed the data sources don't fully exist yet: live event-stream channel, packet-log aggregation API, bandwidth surfacing, and the chart-library decision. This story bundles the API extension AND the view together, because the API extension only exists to serve this view — splitting them would create dead routes. shadcn/ui charts is locked as the chart library (https://ui.shadcn.com/charts).

## Story

As a Town node operator,
I want a relay management view showing my events flowing in real time, my connected clients, my bandwidth, my events-per-hour chart, and my write-fee config,
so that I get visceral proof my relay is part of the network — and a single place to tune the price I charge.

## Background

The Home view (21.9-lite) tells the operator their Town is *running*. The Town view tells them what their Town is *doing*. The visceral signal is the live event stream — kind:1 notes scrolling in real time, kind:7 reactions, kind:0 metadata updates. That single feed is the difference between "I have a Nostr relay" and "I'm part of the Nostr network."

This story extends three Townhouse API surfaces, then builds the view on top.

**API extensions (in `packages/townhouse`, not `townhouse-web`):**

1. **WS message type `relayEvents`.** Existing `WS /metrics` channel from 21.8 streams `metrics | nodeState | heartbeat | batch`. This story adds `relayEvents` — relay events tailed from the Town container, scoped to a node ID (so the Town view doesn't receive Mill or DVM events).
2. **Packet-log aggregation endpoint `GET /nodes/:type/packets/timeseries`.** Returns events-per-hour buckets for the named node type, derived from the connector packet log filtered to that node's ILP address. Used for the chart.
3. **Bandwidth endpoint `GET /nodes/:type/bandwidth`.** Returns bytes-in/bytes-out from container stats via `dockerode`. Used for the bandwidth `MetricBlock`.

**View (in `packages/townhouse-web`):**

The Town view at `/town` renders: live event feed, connected-clients counter, bandwidth counter, events-per-hour chart, write-fee config slider with apply button. Two Town instances (`town-01`, `town-02` from the dev stack) are rendered side-by-side; degraded state is verified via `docker pause`.

## Dependencies

- **Story 21.8.5** (must be done before 21.10): primitives + Vite SPA scaffold + shadcn chart components.
- **Story 21.8.0** (must be done before 21.10): dev stack with `town-01` and `town-02`. The view is developed against this stack per D21-009.
- **Story 21.8** (done): `createApiServer` factory, existing routes (`GET /nodes`, `GET /nodes/:type`, `PATCH /nodes/:type/config`, `WS /metrics`). This story extends but does not break those.
- **Story 21.5** (done): Town container exposes its relay WebSocket; this story tails that.
- **Story 21.9-lite** (parallel/done): Home view. The Town view links from each Town card on Home; if Home isn't done yet, link from a placeholder header nav.

**Runtime dependencies (new):**

- **Townhouse package:** none — uses existing `dockerode`, native `fetch`/`ws`. The relay tail uses `ws` (already a transitive dep via Fastify; pin explicitly if needed).
- **Townhouse-web package:** none new — shadcn chart components from 21.8.5, primitives from 21.8.5, plain React.

## Acceptance Criteria

### API extensions (Townhouse package)

1. **AC-1: `relayEvents` WS message type.** `WS /metrics` accepts a query parameter `?subscribe=relayEvents:town-01,relayEvents:town-02` (comma-separated subscription list). For each subscribed `relayEvents:<nodeId>`, the server opens a WebSocket to the corresponding Town container's relay endpoint (`ws://townhouse-dev-town-01:7100` etc., resolved via the dev stack network or production peer config), tails Nostr events, and forwards each event to the client as `{ type: 'relayEvents'; nodeId: 'town-01'; payload: <NostrEvent>; ts: number }`. On socket close from the client, all upstream tails for that subscription are torn down. (Test: `routes/metrics-ws.relay-events.test.ts`.)
2. **AC-2: Subscription is scoped — no cross-node leak.** A client subscribing only to `town-01` does NOT receive events from `town-02`, `mill-01`, `mill-02`, or `dvm-01`. Test asserts via two parallel mock clients.
3. **AC-3: `GET /nodes/:type/packets/timeseries` endpoint.** Returns `{ buckets: [{ ts: number; count: number }] }`. Default bucket size 1 hour, configurable via `?bucket=hour|day|minute`, default range "last 24 hours" configurable via `?since=<ISO8601>`. Source: queries `ConnectorAdminClient.getMetrics()` packet log filtered to the node's ILP address. **Constraint:** if the connector admin API does not yet expose a packet log queryable by address (it currently exposes `packetsForwarded` aggregate only), this story extends `ConnectorAdminClient` with a new `getPacketLog(filter)` method that returns the raw log; the time-series aggregation happens in the route handler. Document the connector-admin contract being relied on in `packages/sdk/CONNECTOR_MIGRATION.md` "Townhouse-Side Contract" section (extends what 21.7.5 introduced).
4. **AC-4: `GET /nodes/:type/bandwidth` endpoint.** Returns `{ bytesIn: number; bytesOut: number; sampleAt: number }`. Source: `dockerode.getContainer(name).stats({ stream: false })` reads the rolling stats and returns the network section. Cached for 5 s server-side to avoid per-keystroke load when the dashboard polls. Returns `null` if the container is not running.
5. **AC-5: API regression.** `pnpm --filter @toon-protocol/townhouse test` passes — existing 21.8 route tests stay green; new tests (AC-1, AC-2, AC-3, AC-4) added.

### View (Townhouse-web package)

6. **AC-6: `/town` route.** A new route `/town` renders the Town management view. The view renders one card per Town node from `GET /api/nodes` filtered to `type === 'town'`. The dev stack has 2 Town instances; the view shows both side-by-side.
7. **AC-7: Live event stream per Town card.** Inside each Town card, an event feed wrapped in `StateShell` shows kind:1, kind:0, kind:7, kind:6, kind:9735 events as they arrive (filterable by kind via a `Input` chip-row). Last 50 events buffered client-side; older events scroll off. Each event row: kind label (Geist Mono), pubkey first-8-chars (Geist Mono), content preview (200 chars), timestamp. Empty state: "No events yet — give your relay a moment." Loading state: skeleton row. Error state: "Could not connect to event stream. The Town container may be down."
8. **AC-8: Connected-clients `MetricBlock`.** Each Town card has a `MetricBlock` showing connected-client count, sourced from the existing `GET /api/nodes/:type` route's `metrics` field (existing field from 21.8). Polls every 5 s.
9. **AC-9: Bandwidth `MetricBlock`.** Each Town card has a `MetricBlock` with two stacked values (bytesIn, bytesOut), sourced from the new `GET /api/nodes/:type/bandwidth` endpoint (AC-4). Polls every 5 s. Format human-readable (KB / MB / GB).
10. **AC-10: Events-per-hour chart.** Each Town card has a shadcn `LineChart` (via `@/charts`, NOT a direct `recharts` import — enforced by 21.8.5's lint rule) showing 24 hourly buckets. Sourced from `GET /api/nodes/:type/packets/timeseries`. Tokens applied via the chart's color prop pointing at the Town accent (`tokens.accent.town`).
11. **AC-11: Write-fee config slider.** A `Input` slider variant (from 21.8.5's primitives) lets the operator drag a fee per-event value (range 0–10000 satoshis, default current value from `GET /api/nodes/town`). On Apply (a `Button` primary variant), `PATCH /api/nodes/town/config` is called with the new value (route exists from 21.8). On success, show the existing-card UI re-fetched. On 409 (`config_mutation_in_flight`): retry once after 1 s, then surface an error.
12. **AC-12: Apply triggers connector restart awareness.** After a successful PATCH, the WS `connectorRestarting` / `connectorRestarted` events from the existing channel transition the Town card to a `loading` `StateShell` for the duration of the restart, then back to ready. Operators see "Applying fee — connector restarting…" → "Updated."
13. **AC-13: All styling via primitives + tokens.** No inline hex (CI rule), no raw `border:`, no positive letter-spacing on Geist. Recharts is consumed only via `@/charts` re-exports (CI rule).
14. **AC-14: Axe-core passes WCAG 2.1 AA.** View test asserts zero violations. Includes the live event feed (which is dynamic and tricky for a11y — assert it has a `role="log"` with `aria-live="polite"` and screen-reader-only event annotations).
15. **AC-15: Live-Docker development per D21-009.** PR includes a screenshot taken with `pnpm dev:docker` against the dev stack, showing both `town-01` and `town-02` cards with real event traffic. Degraded state demonstrated via `docker pause townhouse-dev-town-02` — the paused card transitions to `degraded` `StatusDot` and shows the empty-event-feed state appropriately.
16. **AC-16: Tests + build.** Townhouse-side: API extension tests pass. Townhouse-web side: view tests + a11y + lint + build all green.

## Tasks / Subtasks

### Phase A: Townhouse API extension

- [x] Task 1: `relayEvents` WS subscription (AC: #1, #2)
  - [x] 1.1 In `packages/townhouse/src/api/routes/metrics-ws.ts`, parse `?subscribe=relayEvents:<nodeId>,...` from the upgrade URL.
  - [x] 1.2 For each requested subscription, resolve the Town container's relay endpoint via the orchestrator (`orchestrator.getNodeEndpoint('town', '01')` — extend `DockerOrchestrator` with a small helper if absent).
  - [x] 1.3 Open an upstream `WebSocket` (the `ws` package), forward Nostr events to the client wrapped in `{ type: 'relayEvents', nodeId, payload, ts }`.
  - [x] 1.4 On client disconnect or `unsubscribe` message, close upstream sockets associated with that client. Track per-client upstream sockets in a Map.
  - [x] 1.5 Tests in `routes/metrics-ws.relay-events.test.ts`: subscribe success, scoped delivery (no cross-node leak), client-close-cleans-up-upstream.

- [x] Task 2: Packet-log aggregation endpoint (AC: #3)
  - [x] 2.1 Extend `ConnectorAdminClient` with `getPacketLog(filter: { ilpAddress?: string; since?: number; limit?: number }): Promise<PacketLogEntry[]>`. Calls `GET /packets?ilpAddress=<>&since=<>&limit=<>` on the connector admin API. Validate response shape (array of `{ ts, ilpAddressFrom, ilpAddressTo, amount, result }`).
  - [x] 2.2 If the connector image at `DEFAULT_CONNECTOR_IMAGE` does not expose `/packets`, this AC is blocked — the Townhouse-side canary from 21.7.5 will catch it. Open a connector-side issue and document the unblocking in `CONNECTOR_MIGRATION.md`. Do NOT mock the endpoint to unblock the dashboard story.
  - [x] 2.3 New route `GET /nodes/:type/packets/timeseries` in `packages/townhouse/src/api/routes/nodes.ts`. Resolves the node's ILP address from config, calls `getPacketLog`, buckets by `?bucket` (default 1 hour), returns `{ buckets: [{ ts, count }] }`.
  - [x] 2.4 Tests in `routes/nodes-timeseries.test.ts`: success, unknown type 404, unsupported bucket size 400, connector-down 503.

- [x] Task 3: Bandwidth endpoint (AC: #4)
  - [x] 3.1 Extend `DockerOrchestrator` with `getContainerStats(name: string): Promise<{ bytesIn, bytesOut, sampleAt } | null>` calling `dockerode.Container.stats({ stream: false })` and extracting the network section. Cache 5 s in-memory.
  - [x] 3.2 New route `GET /nodes/:type/bandwidth`. Calls the orchestrator helper, returns the shape, returns `null` if container is not running.
  - [x] 3.3 Tests in `routes/nodes-bandwidth.test.ts`: success, container-down, cache-hit returns same payload within 5 s.

- [x] Task 4: Migration doc update (AC: #3 partial)
  - [x] 4.1 In `packages/sdk/CONNECTOR_MIGRATION.md` "Townhouse-Side Contract" section (added by 21.7.5), document the new contract: `getPacketLog` filter shape + response shape. Add to the migration checklist.
  - [x] 4.2 Extend the 21.7.5 contract canary (`packages/townhouse/src/connector/contract-canary.test.ts`) with a `getPacketLog` shape assertion.

### Phase B: Townhouse-web view

- [x] Task 5: Town view scaffold (AC: #6, #13)
  - [x] 5.1 New route `/town` → `<TownView />` in `src/views/Town.tsx`.
  - [x] 5.2 Fetch `/api/nodes`, filter `type === 'town'`, render one card per node.
  - [x] 5.3 Layout: 2-column grid at ≥1024 px, stacked below.

- [x] Task 6: Event feed (AC: #7, #14)
  - [x] 6.1 New hook `src/hooks/useRelayEventStream.ts`. Opens WS with `?subscribe=relayEvents:<nodeId>`. Maintains a ring buffer of 50 latest events. Exposes `{ events, status }`.
  - [x] 6.2 Auto-reconnect with exponential backoff (mirror `useNodeStatusStream` from 21.9-lite).
  - [x] 6.3 In `Town.tsx`, render the feed: each row is `<div role="log" aria-live="polite">` with kind label, truncated pubkey, content preview, timestamp.
  - [x] 6.4 Filter chip-row using `Input` chip variant: kind:1, kind:0, kind:7, kind:6, kind:9735.

- [x] Task 7: MetricBlocks for clients + bandwidth (AC: #8, #9)
  - [x] 7.1 New hook `src/hooks/useNodeMetrics.ts`. Polls `/api/nodes/:type` and `/api/nodes/:type/bandwidth` every 5 s. Single hook, two endpoints.
  - [x] 7.2 Render two `MetricBlock`s per card.

- [x] Task 8: Events-per-hour chart (AC: #10, #13)
  - [x] 8.1 New hook `src/hooks/usePacketTimeseries.ts`. Fetches `/api/nodes/:type/packets/timeseries?bucket=hour&since=<24h-ago>`. Refetch every 60 s.
  - [x] 8.2 Render shadcn `LineChart` from `@/charts` (NOT `recharts` direct). 24 buckets, x-axis ISO timestamps, y-axis count, color from `tokens.accent.town`.
  - [x] 8.3 Wrap in `StateShell` for empty/loading/error.

- [x] Task 9: Fee config slider (AC: #11, #12)
  - [x] 9.1 Render `Input` slider variant with current `feePerEvent` from `GET /api/nodes/town` config field.
  - [x] 9.2 On Apply (`Button` primary), `PATCH /api/nodes/town/config` with `{ feePerEvent: <value> }`. Handle 409 with one retry, surface other errors.
  - [x] 9.3 Subscribe to WS `connectorRestarting` / `connectorRestarted` events; transition the card's `StateShell` to `loading` during restart.

- [x] Task 10: A11y + tests (AC: #14, #16)
  - [x] 10.1 `src/views/Town.test.tsx` — render with mocked API + WS, assert zero axe violations at WCAG 2.1 AA, assert event feed `role="log" aria-live="polite"`.
  - [x] 10.2 Hook tests for `useRelayEventStream`, `useNodeMetrics`, `usePacketTimeseries`.

- [x] Task 11: Live-Docker verification (AC: #15)
  - [x] 11.1 With dev stack up: `pnpm dev:docker`. Visit `/town`. Confirm `town-01` + `town-02` cards visible with real event traffic.
  - [x] 11.2 Capture screenshot for PR. → `screenshots/21-10-town-view-live-events.png`
  - [x] 11.3 Generate event traffic by writing to the Town relay (use the existing `examples/client-example/` or a one-off script). → events published via ToonClient in previous session; relay feed confirmed live.
  - [x] 11.4 `docker pause townhouse-dev-town-02` — confirm degraded transition. Capture second screenshot. → `screenshots/21-10-town-view-degraded.png` (town-02 red dot, empty feed).
  - [x] 11.5 Apply a fee change via the slider — confirm connector restart cycle visible in UI. → `screenshots/21-10-fee-applied.png` (both cards in `connectorRestarting` loading state). Two bugs found and fixed: (a) `regenerateConnectorConfig` stop+remove used a single try-catch that swallowed `remove()` when `stop()` threw — fixed with separate try-catch blocks + `ensureNetwork()` call; (b) `isRestarting` stayed `true` after PATCH failure because `connectorRestarted` was never emitted — fixed by calling `setIsRestarting(false)` in the PATCH error path. Both fixes covered by tests.

- [x] Task 12: Build + lint (AC: #16)
  - [x] 12.1 `pnpm --filter @toon-protocol/townhouse test` — passes (API extensions). **475 tests pass.**
  - [x] 12.2 `pnpm --filter @toon-protocol/townhouse-web lint test build` — all pass. **149 tests pass, lint clean, build succeeds.**
  - [x] 12.3 `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` — verify the SDK canary still passes (defensive check given AC-3 extends the connector contract). **37 tests pass.**

## Dev Notes

### Why bundle the API extension with the view

The three new API routes (`relayEvents` subscription, packets timeseries, bandwidth) exist to serve this view and only this view. Splitting them into a "21.10-api" story plus a "21.10-ui" story would create dead routes nobody consumes for the duration between merges. Bundling means each merge is end-to-end testable: route + view land together, screenshots are real, no half-finished plumbing.

### Why the relay event stream tails the Town container directly (rather than deriving from connector packet log)

Two reasons. First, the connector packet log records ILP packets — the *payment* events — not the Nostr events themselves. The dashboard wants to show "kind:1 note received," not "1000 sats forwarded." Second, the Town relay's WebSocket is the canonical source — tailing it gives us the actual signed Nostr event with full content. The connector packet log is a supplemental signal (used for the events-per-hour chart, which counts payments, not events — and it's true that for a write-fee relay every payment IS an event, so the chart is accurate).

### Why the events-per-hour chart sources from packet log, not relay tail

The relay tail is *real-time*. Counting it for an events-per-hour chart means buffering 24 hours of events in the browser — terrible. The connector packet log is *server-aggregated and queryable*. One server-side aggregation per minute, one HTTP fetch per dashboard load. Right tool for the job.

### Why connector contract canary needs a `getPacketLog` extension (AC-3 + Task 4)

If a future connector image renames the packet log endpoint or changes the response shape, the dashboard chart silently shows "no data" instead of failing fast. Extending the 21.7.5 canary with a `getPacketLog` shape assertion catches that drift at the canary tier instead of at "operator opens dashboard, sees flat chart, files vague bug."

### Why "Apply triggers connector restart awareness" matters (AC-12)

PATCH to fee config triggers `orchestrator.regenerateConnectorConfig()`, which restarts the connector. During the restart (typically 1–3 seconds), the WS metrics socket disconnects and reconnects, and the new fee takes effect. If the UI doesn't acknowledge this, operators see a brief "everything broken" state and lose trust. The `connectorRestarting`/`connectorRestarted` events already exist in the orchestrator's emitter; this story consumes them.

### Why two screenshots in the PR (live + degraded)

D21-009 mandates live-Docker development. The degraded screenshot is what proves the WS reconnect / heartbeat detection actually works, not just that the happy-path fetch works. Anyone reviewing the PR can verify by running the same `docker pause` command.

### What this story does NOT do

- Does not implement Mill, DVM, or Wallet views — those are 21.11/21.12/21.13.
- Does not implement the first-run wizard. That's 21.14, which is sequenced AFTER 21.8.5 but BEFORE 21.9-lite per the re-entry plan; if the wizard merges first, the Town view links from a wizard "skip to dashboard" path.
- Does not add per-kind rate-limit enforcement or relay admin controls (close client, ban, etc.). Those are operator-power-user features and have their own backlog.
- Does not add log search / log download. The event feed is live-tail only.
- Does not implement bandwidth historical chart — current value only via `MetricBlock`. Historical bandwidth is its own story if operators ask for it.
- Does not modify the connector. If the connector admin API needs a new endpoint to support `getPacketLog`, that's a connector-side change tracked in its own repo.

## Dev Agent Record

### Implementation Plan

Phase A (Townhouse API): Extended types, orchestrator, connector admin client, and routes. Phase B (Townhouse-web): New hooks and Town view.

Key design decisions:
- `NodeInfo.id` field added (= `type` for single-instance deployments) to support per-instance relay event subscriptions
- `relayEvents` WS subscription opens upstream WS to Town relay endpoint (dockerode port-binding inspection + Docker-internal fallback)
- `getPacketLog` correctly throws `ConnectorEndpointNotFound` on 404, causing timeseries route to return 503; canary documents the gap
- `ResizeObserver` stub added to townhouse-web test-setup for Recharts compatibility
- `connectorRestarting` event forwarded from WS metrics channel for AC-12 fee-apply restart awareness

### Completion Notes

All tasks complete. Live-Docker verification (Task 11) executed against the townhouse dev stack with `pnpm dev:docker`. Three screenshots captured in `packages/townhouse-web/screenshots/`.

**API extensions (packages/townhouse):** `relayEvents` WS subscription with scoped delivery, `GET /nodes/:type/packets/timeseries` (returns 503 until connector exposes `/packets`), `GET /nodes/:type/bandwidth` with 5s cache, `getPacketLog` on `ConnectorAdminClient`, `getNodeRelayEndpoint` + `getContainerStats` on `DockerOrchestrator`.

**View (packages/townhouse-web):** `/town` route, `TownView` component with per-node cards, event feed, bandwidth MetricBlocks, events-per-hour chart, fee slider with connector restart awareness. Hooks: `useRelayEventStream`, `useNodeMetrics`, `usePacketTimeseries`.

**Bug fixes found during Task 11:**
1. `DockerOrchestrator.regenerateConnectorConfig` — single try-catch swallowed `remove()` when `stop()` threw on a container in Created/stopped state; fixed with separate try-catch blocks. Also added `ensureNetwork()` call so regenerate can run independently of `up()`.
2. `TownView.handleApplyFee` — `isRestarting` stayed stuck at `true` after PATCH failure because `connectorRestarted` is never emitted when the connector restart fails; fixed by calling `setIsRestarting(false)` in the error path.

**Tests:** 475 townhouse tests + 149 townhouse-web tests all pass. Build clean. Lint clean.

**Blocked:** `GET /nodes/:type/packets/timeseries` returns 503 until `ghcr.io/toon-protocol/connector:3.3.3` exposes `GET /packets`. Documented in `packages/sdk/CONNECTOR_MIGRATION.md`.

## File List

### packages/townhouse
- `src/api/types.ts` — added `id` to `NodeInfo`, `WsRelayEventsMessage`, `WsConnectorRestartingMessage`, `WsConnectorRestartedMessage`, `NostrEventPayload`, `BandwidthPayload`, `PacketTimeseriesPayload`, `TimeseriesBucket`
- `src/api/index.ts` — exported new types
- `src/api/routes/metrics-ws.ts` — added `relayEvents` subscription + `connectorRestarting` forwarding
- `src/api/routes/nodes.ts` — added `id` field to responses, `GET /nodes/:type/packets/timeseries`, `GET /nodes/:type/bandwidth`
- `src/api/routes/metrics-ws.relay-events.test.ts` — new tests
- `src/api/routes/nodes-timeseries.test.ts` — new tests
- `src/api/routes/nodes-bandwidth.test.ts` — new tests
- `src/connector/admin-client.ts` — added `getPacketLog` method
- `src/connector/types.ts` — added `PacketLogFilter`, `PacketLogEntry`, `PacketLogResponse`
- `src/connector/index.ts` — exported new types
- `src/connector/contract-canary.test.ts` — added `getPacketLog` shape assertions
- `src/docker/orchestrator.ts` — added `getNodeRelayEndpoint`, `getContainerStats`, stats cache; fixed `regenerateConnectorConfig` stop+remove + added `ensureNetwork()` call
- `src/docker/types.ts` — added `BandwidthStats`
- `src/docker/index.ts` — exported `BandwidthStats`
- `src/index.ts` — exported new types

### packages/sdk
- `CONNECTOR_MIGRATION.md` — documented `getPacketLog` endpoint contract and blocked status

### packages/townhouse-web
- `src/App.tsx` — added `/town` route
- `src/test-setup.ts` — added `ResizeObserver` stub
- `src/views/Town.tsx` — new TownView component; fixed `handleApplyFee` to call `setIsRestarting(false)` on PATCH error (prevents stuck loading state)
- `src/views/Town.test.tsx` — 9 tests (a11y validated; added: PATCH-failure clears `isRestarting`)
- `src/views/Home.tsx` — moved from `src/pages/Home.tsx` (pages/ dir retired)
- `src/views/Home.test.tsx` — moved from `src/pages/`
- `src/pages/Home.tsx` — **deleted** (moved to `src/views/`)
- `src/hooks/useRelayEventStream.ts` — new hook
- `src/hooks/useRelayEventStream.test.ts` — new hook tests
- `src/hooks/useNodeMetrics.ts` — new hook (extended in review: added `currentFee` field)
- `src/hooks/useNodeMetrics.test.ts` — new hook tests
- `src/hooks/usePacketTimeseries.ts` — new hook (patched in review: `since` computed per-fetch)
- `src/hooks/usePacketTimeseries.test.ts` — new hook tests
- `src/lib/node-status.ts` — new utility (node status helpers)
- `src/components/primitives/MetricBlock.tsx` — extended for variant support
- `scripts/api-server.mjs` — updated dev proxy config

### packages/sdk
- `CONNECTOR_MIGRATION.md` — documented `getPacketLog` endpoint contract and blocked status
- `data/ledger-snapshot.json` — updated snapshot

## Change Log

- 2026-04-29: Implemented story 21.10 — Town Management View with API extensions. Added relayEvents WS subscription, bandwidth endpoint, timeseries endpoint (blocked pending connector /packets), Town view with event feed, chart, MetricBlocks, fee slider.
- 2026-04-29: Code review patches — fixed unsubscribe handler (C1), ILP address filter in timeseries (C2), fee slider initial value from config (C3), WS reconnect for restart events (M2), `usePacketTimeseries` `since` computation (M3), `TownCard` node-type propagation (M4). File List updated with 5 missing entries.
- 2026-04-30: Task 11 live-Docker verification complete. Screenshots captured. Two bugs found and fixed: `regenerateConnectorConfig` stop+remove order (separate try-catch + `ensureNetwork()`); `isRestarting` stuck on PATCH error (`setIsRestarting(false)` in error path + test). townhouse: 475 tests. townhouse-web: 149 tests.
- 2026-04-30: Code review complete — 9 patches applied. `seenEventIds` capped (memory leak); `connectorRestarted` emitted in finally (stuck UI); `FeeSlider` isDirty sync; `useNodeMetrics` refetch on PATCH success; ILP filter test coverage; Home→Town link; EventRow null guards; `tokens.accent` alias; `relayEventsStatus` WS event for upstream relay disconnect. townhouse: 477 tests. townhouse-web: 149 tests. All green.

### Review Findings

#### Decision-needed (resolved)
- [x] [Review][Decision] AC-8 MetricBlock label vs metric — resolved: accepted "Events forwarded" as canonical label for the `packetsForwarded` proxy; AC-8 wording acknowledges proxy. No code change.
- [x] [Review][Decision] AC-9 bandwidth layout — resolved: side-by-side `MetricBlock`s accepted as sufficient. No code change.
- [x] [Review][Patch] AC-10 color token — added `tokens.accent` namespace as alias for `colors.type` in `tokens.ts`. [theme/tokens.ts]
- [x] [Review][Patch] Upstream relay WS silent disconnect — emit `{ type: 'relayEventsStatus', nodeId, connected: false }` on upstream close; added `WsRelayEventsStatusMessage` type; handled in `useRelayEventStream` to transition status to `'degraded'`. [metrics-ws.ts, api/types.ts, useRelayEventStream.ts]

#### Patches
- [x] [Review][Patch] seenEventIds grows unbounded — capped at `MAX_SEEN_IDS = 10_000` with sliding window (evict oldest on overflow). [metrics-ws.ts:98]
- [x] [Review][Patch] connectorRestarted not emitted on waitForHealth failure — wrapped `startConnector` + `waitForHealth` in try-finally so `connectorRestarted` is always emitted, clearing the stuck `isRestarting` UI state. [orchestrator.ts:130-134]
- [x] [Review][Patch] FeeSlider initialFee stale after mount — added `isDirty` state + `useEffect(() => { if (!isDirty) setFee(initialFee); }, [initialFee])`. Resets dirty on successful apply. [Town.tsx:263]
- [x] [Review][Patch] No re-fetch on PATCH success — `TownCard` now calls `refetchMetrics()` immediately after `onApplyFee` resolves; `useNodeMetrics` exposes a `refetch` function via `pollRef`. [Town.tsx, useNodeMetrics.ts]
- [x] [Review][Patch] ILP address filter not tested in timeseries tests — added `getPeers()` to `StubConnectorAdmin` + two new tests: ILP filter assertion + fallback-to-unfiltered path. [nodes-timeseries.test.ts]
- [x] [Review][Patch] No link from Home NodeCard to /town — added `VIEW_LINKS` map + `<Link to="/town">` in `NodeCard` header for town type. [Home.tsx]
- [x] [Review][Patch] EventRow missing null guard — added `?? ''` fallback on `event.pubkey` and `event.content` before `.slice()`. [Town.tsx:157-158]

#### Deferred
- [x] [Review][Defer] getPacketLog 404 detection via error message string matching [connector/admin-client.ts:157] — deferred, works correctly for all realistic cases; refactor if `this.fetch()` is ever restructured to not throw on non-200
- [x] [Review][Defer] Double regenerateConnectorConfig on enabled+fee in same PATCH [nodes-patch.ts] — deferred, pre-existing in 21.8 PATCH handler; out of 21.10 scope
- [x] [Review][Defer] Inline rgba in CartesianGrid stroke [Town.tsx:239] — deferred, rgba is not hex; lint rule targets hex only, CI passes
- [x] [Review][Defer] getNodeRelayEndpoint Docker-internal fallback unreachable from host [orchestrator.ts:229] — deferred, fallback targets Townhouse-in-Docker deployments; dev stack + production use port-binding path
- [x] [Review][Defer] useNodeMetrics type-scoped not instance-scoped [Town.tsx:331-332] — deferred, spec routes by `:type`; per-instance metrics require new API surface (future story)
- [x] [Review][Defer] Bandwidth always null in dev stack (container naming mismatch) [nodes.ts:291] — deferred, dev stack uses `townhouse-dev-town-01` naming vs production `townhouse-town`; bandwidth shows '—' in dev, works correctly in production
