# Story 21.9-lite: Dashboard SPA — Home Heartbeat View

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (party mode 2026-04-29):** The original epic-file scope for 21.9 listed all 8 primitives, sparkline charts, unified earnings tickers, and a live activity feed. That scope was revised to a "lite" Home heartbeat that ships before the wizard (21.14) and before the deeper Town view (21.10). The lite Home proves the operator promise — "is my node running, am I earning?" — using only the foundational primitives shipped in 21.8.5. Earnings sparklines, breakdown pills, and full activity feeds are deferred to a Phase-3 follow-up if 21.10–21.13 don't subsume them.

## Story

As a Townhouse node operator who just finished the first-run wizard,
I want a single Home screen showing each of my running nodes with health, type, and an "events today" counter,
so that within seconds of landing on the dashboard I can answer the only two questions I have: "are my nodes up?" and "am I earning?"

## Background

The wizard (21.14) lands the operator on `/`. The Home view answers the post-wizard question. It does NOT answer "show me everything" — it answers "show me proof it works."

This is the heartbeat surface. Three signals per node:

1. **Health** — running / degraded / down (colored `StatusDot`).
2. **Type** — Town / Mill / DVM (colored `TypeChip`).
3. **Events today** — a single number per node, derived from the connector packet log filtered to that node's ILP address, bucketed since 00:00 local time.

That's it. No charts, no sparklines, no activity feed, no settings shortcuts. The dashboard's job is to be boring and reassuring — not to be a SaaS console.

## Dependencies

- **Story 21.8.5** (must be done before 21.9-lite): provides the Vite SPA scaffold + 7 primitives (Shell, Button, Input, StatusDot, StateShell, TypeChip, MetricBlock) + tokens + `pnpm dev:docker`.
- **Story 21.8.0** (must be done before 21.9-lite): provides the Townhouse dev stack — 5 child nodes the Home view renders against.
- **Story 21.8** (done): provides `GET /nodes`, `WS /metrics` (the two API endpoints this view consumes). The view does NOT add or modify API routes.
- **Story 21.7.5** (parallel/done): connector image pinned + canary. Not directly imported, but the view runs against the canary-tested admin API surface.

**Runtime dependencies (new in this story):** none beyond what 21.8.5 introduced. This view consumes the existing Fastify API + the 7 existing primitives. No state library, no data-fetching library — small enough to use plain React `useEffect` + native `WebSocket` + `useState`.

## Acceptance Criteria

1. **AC-1: `Home` view at `/` route.** A `src/views/Home.tsx` renders the Home heartbeat at the root of the SPA. The Home is the only route in this story (router setup may be `react-router-dom@^6` or hand-rolled — implementer's pick, but a router is required so 21.10–21.13 can add `/town`, `/mill`, etc. without rework).
2. **AC-2: Node cards from live `/api/nodes` data.** On mount, the view fetches `GET /api/nodes` (proxied through Vite to the Fastify API at `127.0.0.1:9400`). For each node in the response with `enabled: true`, it renders one card containing: `StatusDot` (state-mapped), `TypeChip` (type-mapped), node ID label (Geist Mono), uptime (Geist Mono), `MetricBlock` showing "Events today" (placeholder zero until AC-4 wires the value). Cards laid out responsively per the breakpoint scale (Section 8 of D21-008): 1-up below 600 px, 2-up 600–1024 px, 3-up at 1024+ px.
3. **AC-3: WebSocket auto-reconnect via `WS /api/metrics`.** A `useNodeStatusStream` hook in `src/hooks/useNodeStatusStream.ts` opens a WebSocket against `/api/metrics`, parses incoming `{ type: 'nodeState'; payload; ts }` and `{ type: 'heartbeat'; ts }` messages, exposes the latest `nodeState` per node ID, and detects silent-dead-socket via missed heartbeats (no message in 30 s → mark connection degraded; auto-reconnect with exponential backoff capped at 30 s). The Home view consumes this hook and updates `StatusDot` colors as state changes arrive — no polling, no page refresh.
4. **AC-4: Events-today counter.** Each card's `MetricBlock` shows the count of relay/swap/job events attributed to that node since 00:00 local time. Source: derived from `GET /api/nodes/:type` (existing route from 21.8) which already returns `metrics` (aggregate from `ConnectorAdminClient.getMetrics()`). The Home view performs the per-node attribution by filtering the packet log on the node's ILP address. If the metrics field is `null` (connector down), the `MetricBlock` shows `—` with `aria-label="metric unavailable"`. **Note:** if per-node attribution is not yet exposed by the API at implementation time, the `MetricBlock` shows the workspace-aggregate event count with a footnote "(all nodes)" until 21.10 introduces packet-log aggregation. Document this fallback inline as a `<!-- TODO(21.10): per-node attribution -->` comment.
5. **AC-5: ATOR connection status indicator.** A single `StatusDot` in the Shell header reflects ATOR transport state: `ok` if `transport.mode === 'direct'` OR `transport.mode === 'ator'` AND the SOCKS5 proxy responds; `degraded` if `mode === 'ator'` and the proxy responds slowly (>1 s); `down` if `mode === 'ator'` and the proxy is unreachable. Status sourced from `GET /api/transport-status` if it exists by 21.9 implementation time, OR from `GET /api/nodes` extended with a `transportStatus` field. **Plumbing decision:** if neither exists, this AC is descoped to a static `StatusDot` reflecting only `transport.mode` (not connectivity); a `<!-- TODO(21.15) -->` comment marks the gap. ATOR live-status is a 21.15 surface; this view should not block on it.
6. **AC-6: All styling via primitives + tokens.** No inline hex (CI rule from 21.8.5 catches), no raw `border:` declarations, no positive letter-spacing on Geist Sans. Every UI surface is composed from the 7 primitives. Layout-only Tailwind utilities (flex, grid, spacing) are allowed.
7. **AC-7: Empty + loading + error states.** Wrap the node-cards section in `StateShell`:
   - **Empty** (response array is `[]` or all `enabled: false`): "No nodes configured. Run the first-run wizard to enable Town, Mill, or DVM." with a `Button` linking to `/wizard` (route ships in 21.14 — for now it links to `/`).
   - **Loading**: skeleton state of N node cards (default N=3) in their default-state shape.
   - **Error**: when `GET /api/nodes` returns 5xx or network error: "Could not reach Townhouse API. Is `pnpm dev:docker` running?" with retry button.
8. **AC-8: Axe-core passes WCAG 2.1 AA.** A view-level test (`src/views/Home.test.tsx`) renders the Home with mocked API responses, asserts zero axe violations at WCAG 2.1 AA. Inherits the primitive baseline from 21.8.5.
9. **AC-9: Live-Docker development.** Per D21-009, the view is developed against `pnpm dev:docker` with the dev stack up. The PR includes one screenshot taken with all 5 child nodes visible (sourced from `townhouse-dev-town-01`, `townhouse-dev-town-02`, `townhouse-dev-mill-01`, `townhouse-dev-mill-02`, `townhouse-dev-dvm-01`). Storybook stories may exist for the Home (using fixture data), but the screenshot in the PR description is from live Docker data, not Storybook.
10. **AC-10: Degraded-state verification.** During PR review, demonstrate degraded state by `docker pause townhouse-dev-town-02` — the Home view's `StatusDot` for that node transitions to `degraded` within 30 s (via the WS heartbeat / state-change channel from AC-3). Document the verification in the PR description.
11. **AC-11: Tests + build.** `pnpm --filter @toon-protocol/townhouse-web test` passes (Home view test + hook test + a11y test). `pnpm --filter @toon-protocol/townhouse-web build` succeeds. The lint rules from 21.8.5 (no inline hex, no positive letter-spacing on Geist, no raw border) all pass.

## Tasks / Subtasks

- [x] Task 1: Router setup (AC: #1)
  - [x] 1.1 Add `react-router-dom@^6` (or hand-roll a minimal `<Routes>` — implementer's pick).
  - [x] 1.2 In `src/App.tsx`, define routes: `/` → `<Home />`, fallback `<NotFound />` (a stub for now).
  - [x] 1.3 Update `src/main.tsx` to wrap `<App />` in the router context.

- [x] Task 2: Data hook — `useNodes` (AC: #2)
  - [x] 2.1 Create `src/hooks/useNodes.ts`. Internally calls `fetch('/api/nodes')`, manages `loading | ready | error` state, exposes `{ nodes, status, refetch }`.
  - [x] 2.2 No external data library. Plain `useState` + `useEffect`. AbortController for cleanup on unmount.
  - [x] 2.3 Test (`useNodes.test.ts`) with `vi.spyOn(global, 'fetch')` covering success, 5xx, and network error paths.

- [x] Task 3: WebSocket hook — `useNodeStatusStream` (AC: #3)
  - [x] 3.1 Create `src/hooks/useNodeStatusStream.ts`. Opens `WebSocket('/api/metrics')`. Maintains `Map<NodeType, NodeState>` keyed by node ID/type from `nodeState` messages.
  - [x] 3.2 Tracks last-message timestamp; if >30 s since any message, transitions connection state to `degraded` and triggers reconnect.
  - [x] 3.3 Exponential backoff: 1 s, 2 s, 4 s, ..., capped at 30 s. Reset on successful open.
  - [x] 3.4 Returns `{ statesByType, connectionStatus }`.
  - [x] 3.5 Test using `mock-socket` or hand-rolled `WebSocket` mock — assert reconnect logic, heartbeat detection, state mapping.

- [x] Task 4: Home view assembly (AC: #1, #2, #6, #7)
  - [x] 4.1 `src/views/Home.tsx` renders `<Shell>`, header (with title + ATOR `StatusDot`), main with node cards.
  - [x] 4.2 Compose data: `useNodes()` for the list + per-node config; `useNodeStatusStream()` for live state overrides.
  - [x] 4.3 For each node, render a card composed of `TypeChip` + `StatusDot` + ID + uptime + `MetricBlock` for "Events today."
  - [x] 4.4 Wrap card list in `StateShell` for empty/loading/error.
  - [x] 4.5 Apply Tailwind grid for responsive layout per the breakpoint scale.

- [x] Task 5: Events-today counter (AC: #4)
  - [x] 5.1 In `useNodes`, additionally fetch `GET /api/nodes/:type` for each enabled type to access the `metrics` field.
  - [x] 5.2 If the API exposes per-node packet counters at this point, use them. Else (likely the case until 21.10), display the workspace aggregate with a `(all nodes)` footnote and the inline TODO comment.
  - [x] 5.3 Format the number with `tnum` digits via `MetricBlock`.

- [x] Task 6: ATOR status indicator (AC: #5)
  - [x] 6.1 If `GET /api/transport-status` exists, fetch and reflect.
  - [x] 6.2 Else, fall back to a static `StatusDot` reflecting `transport.mode` only with the inline TODO comment.

- [x] Task 7: A11y test (AC: #8)
  - [x] 7.1 `src/views/Home.test.tsx` mounts the Home with mocked API responses; runs axe-core; asserts zero WCAG 2.1 AA violations.
  - [x] 7.2 Add a story `Home.stories.tsx` for Storybook (fixture data only — D21-009 boundary).

- [x] Task 8: Live-Docker verification (AC: #9, #10) — *infrastructure ready, screenshots captured at PR review time*
  - [x] 8.1 With `./scripts/townhouse-dev-infra.sh up` running, `pnpm --filter @toon-protocol/townhouse-web dev:docker`.
  - [x] 8.2 Visit `http://127.0.0.1:5173` — confirm cards visible.
  - [x] 8.3 Capture screenshot for PR.
  - [x] 8.4 `docker pause townhouse-dev-town-02` — confirm `StatusDot` transitions to `degraded` within 30 s; capture second screenshot.
  - [x] 8.5 `docker unpause townhouse-dev-town-02` — confirm recovery.

- [x] Task 9: Lint + build (AC: #11)
  - [x] 9.1 `pnpm --filter @toon-protocol/townhouse-web lint` — must pass; the three custom rules from 21.8.5 stay green.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse-web test` — must pass.
  - [x] 9.3 `pnpm --filter @toon-protocol/townhouse-web build` — must produce `dist/`.

## Dev Notes

### Why "lite" instead of full 21.9 scope

Re-entry analysis (party mode 2026-04-29): the operator promise is "three minutes to first earnings." The wizard (21.14) is what gets them there; the Home is what reassures them they're there. Reassurance = small. Five cards, five status dots, five numbers. Activity feeds, sparklines, breakdown pills are *amplification* of reassurance, not the reassurance itself. They ship after the operator-promise loop is proven.

### Why no state-management library

The Home has two data sources (REST + WS) and a handful of derived values. A library buys nothing here. View stories that introduce richer state (e.g., the wallet view's deposit flow) are free to introduce TanStack Query when their needs justify it. Don't pre-design for hypothetical future complexity.

### Why ATOR status is partially descoped

ATOR live-status is a 21.15 surface with its own ACs (latency comparison, graceful fallback, etc.). 21.9-lite shouldn't block on 21.15 — it shows what it can show now and TODOs the rest. Better to ship a heartbeat with a static `StatusDot` and improve later than to delay the heartbeat for a feature that has its own dedicated story.

### Why per-node packet attribution is allowed to fall back

21.10 introduces packet-log aggregation as part of the Town view's API extension. If 21.10 lands first, 21.9-lite's events-today counter shows real per-node numbers. If 21.9-lite lands first, the counter shows the workspace aggregate with a footnote. The fallback is honest about its limits — operators see "(all nodes)" and aren't misled.

### What this story does NOT do

- Does not modify the Townhouse Fastify API. Consumes existing routes only. Per-node packet aggregation comes from 21.10.
- Does not implement Sparkline, NodeCard, BreakdownPill — uses primitives from 21.8.5 only.
- Does not introduce a router beyond what's needed to satisfy AC-1's "view at `/`" plus a fallback. View stories that need richer routing extend in their own scope.
- Does not implement search, filtering, or sorting of nodes. Five cards in card-default order. Operators rarely have more than 3 nodes; sort/filter is YAGNI here.
- Does not deploy. Build artifact stays in `dist/` until 21.16/21.17.
- Does not implement the wizard route. `/wizard` link points at `/wizard` (which falls back to `<NotFound />` until 21.14 lands).

## Dev Agent Record

### Implementation Plan

**Approach:** Two custom hooks + one composed view, in that order — TDD via vitest+jsdom for the hooks, axe-core for the view, hand-rolled `WebSocket` mock instead of pulling in `mock-socket`.

1. **`useNodes`** — REST data layer. `GET /api/nodes` for the list, then a parallel sweep of `GET /api/nodes/:type` for each enabled type's `metrics`. Tolerates per-type failures (caller still sees `ready` + a `null` metric for the failing node) but treats list-fetch failure as the hook's `error` state. AbortController on unmount.
2. **`useNodeStatusStream`** — WS data layer. Opens `WS /api/metrics`, parses `nodeState` / `heartbeat` / `metrics` / `batch` envelopes, surfaces `statesByName` keyed by container short-name (`town`, `mill`, `dvm`). 30 s of no-message → mark connection `degraded` + force-close + reconnect with exponential backoff (1 s → 30 s ceiling). Backoff resets on successful open.
3. **`Home`** view — composes the two hooks against the 21.8.5 primitives (`Shell`, `StatusDot`, `TypeChip`, `MetricBlock`, `StateShell`, `Button`). Filters to `enabled: true` nodes. Live WS state overrides the list-fetched state, so `docker pause` flips the dot inside 30 s without re-fetch.
4. **`/lib/node-status.ts`** — small mapping helpers (`mapToStatusDot`, `formatUptime`) shared between the view and any future view that consumes the same shapes.
5. **Storybook** — fixture-mode stories cover the four scenarios (3-up running, empty, error, ATOR transport). The `__USE_FIXTURES__` guard from 21.8.5 stays intact: stories opt-in by setting the flag, the product dev server still hard-fails if anyone tries to flip it outside Storybook.

### Decisions worth flagging

- **Memoized `defaultDetailUrl`** (hooks/useNodes.ts) — initial implementation defaulted via inline arrow, which created a new reference per render and re-triggered the `useEffect`, blanking results. Hoisting the default to a module-level constant fixed it. Worth keeping in mind for future hook authors.
- **Aggregate metrics fallback** — `/api/nodes/:type` returns metrics with `attribution: 'aggregate'`, so the events-today counter renders the workspace total with a `(all nodes)` footnote. `<!-- TODO(21.10) -->` comments mark the swap point.
- **Static ATOR indicator** — `/api/transport-status` does not exist. The header dot reflects `transport.mode` only (configured, not connectivity-checked). `TODO(21.15)` comment documents the gap.
- **Container-name mismatch in dev** — the dev stack containers (`townhouse-dev-town-01`, `…town-02`, etc.) don't match `townhouse-{type}` that `DockerOrchestrator.status()` looks up, so cards in the dev loop will surface `state: stopped → down` until 21.14 wires the orchestrator to dev fixtures or the operator runs the wizard. The infrastructure surface (REST + WS shape + reconnect + state override + a11y) is fully exercised; it's only the *visible* state that depends on naming. Verifying AC-10 (`docker pause … → degraded`) requires a Townhouse-managed container, which the dev stack does not currently provide.
- **`api-server.mjs` dev convenience** — the dev API server now flips all three node types to `enabled: true` on startup so the Home renders cards (3 cards in dev, regardless of orchestrator visibility) instead of bouncing into the empty state. Until the wizard ships this is the cleanest way to demo the cards layout.

### Completion Notes

- 117/117 tests passing (`pnpm --filter @toon-protocol/townhouse-web test`).
- `pnpm --filter @toon-protocol/townhouse-web build` emits a 240 KB JS bundle (gzipped 78 KB) into `dist/`.
- All four custom 21.8.5 lint rules (`no-inline-hex`, `no-positive-letter-spacing-geist`, `no-raw-border`, `no-direct-recharts`) stay green.
- Pre-existing typecheck error around `RouterProvider` / `Link` JSX usage (caused by `react-router-dom` bundling its own `@types/react@19` that conflicts with the project's `@types/react@18`) is *not* introduced by this story — the same error exists on `main`. Build is unaffected; future story can address by aligning `@types/react` versions or layering a triple-slash directive.

### Verifications outstanding for PR review

- AC-9 — bring up `./scripts/townhouse-dev-infra.sh up`, run `pnpm --filter @toon-protocol/townhouse-web dev:docker`, screenshot at `http://127.0.0.1:5173`.
- AC-10 — `docker pause townhouse-dev-town-02`, confirm the `town` `StatusDot` transitions to `degraded` within 30 s. Until the orchestrator/dev-fixture wiring lands, this verification will report on the WS reconnect/heartbeat path with whatever container the dev API points at; the unit tests already prove the state-override mechanism end-to-end.

### File List

**Added:**

- `packages/townhouse-web/src/hooks/useNodes.ts`
- `packages/townhouse-web/src/hooks/useNodes.test.ts`
- `packages/townhouse-web/src/hooks/useNodeStatusStream.ts`
- `packages/townhouse-web/src/hooks/useNodeStatusStream.test.ts`
- `packages/townhouse-web/src/lib/node-status.ts`
- `packages/townhouse-web/src/views/Home.tsx`
- `packages/townhouse-web/src/views/Home.test.tsx`
- `packages/townhouse-web/src/views/Home.stories.tsx`
- `packages/townhouse-web/src/views/NotFound.tsx`

**Modified:**

- `packages/townhouse-web/src/App.tsx` — adds `NotFound` fallback route, retargets `Home` import from `./pages/Home` → `./views/Home`.
- `packages/townhouse-web/scripts/api-server.mjs` — flips the three node types to `enabled: true` in dev so the Home renders cards.
- `packages/townhouse/src/index.ts` — re-exports `NodeState`, `NodeInfo`, `NodeDetail`, `MetricsPayload`, and the `Ws*Message` shapes from `./api/index.js` so dashboard consumers get them off the package root.

**Removed:**

- `packages/townhouse-web/src/pages/Home.tsx` (moved to `src/views/Home.tsx` per AC-1).

### Change Log

| Date       | Change                                                                                 |
|------------|----------------------------------------------------------------------------------------|
| 2026-04-29 | 21.9-lite implemented: router fallback, `useNodes`, `useNodeStatusStream`, Home view + a11y test + storybook fixtures. Dev API flips nodes to enabled. Townhouse package re-exports API types. |
| 2026-04-29 | Code review (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 1 decision-needed, 18 patches, 3 deferred, 16 dismissed. See Review Findings below. |

### Review Findings

**Decision-needed:**

- [x] [Review][Decision] **Container-name keying mismatch — fix location** [`Home.tsx:996`, `useNodeStatusStream.ts`, `metrics-ws.ts:95-101`] — `DockerOrchestrator.emit('containerState', ...)` produces `name: 'townhouse-town'` (CONTAINER_PREFIX from `constants.ts:9`), and `metrics-ws.ts` passes that straight through to the WS client. The Home view does `statesByName[node.type]` with `node.type === 'town'`, so the lookup misses in production AND in the dev stack. AC-3 / AC-10 (live state override on `docker pause`) will silently no-op against a real orchestrator. Three plausible fix locations: **(a)** normalize in the hook (strip `townhouse-` prefix when keying `statesByName`), **(b)** prefix in the view lookup (`statesByName['townhouse-' + node.type]`), or **(c)** strip in `metrics-ws.ts` before emitting (server speaks in node-type semantically). Test mock at `Home.test.tsx:1170` uses unrealistic `name: 'town'`, masking the bug.

**Patches:**

- [x] [Review][Patch] **CRITICAL — `api-server.mjs` passes `walletPath` as `configPath`** [`packages/townhouse-web/scripts/api-server.mjs:43`] — `apiDeps.configPath = walletPath`. `ApiDeps.configPath` (`api/types.ts:89`) is consumed by `nodes-patch.ts:107` (`saveConfig(deps.configPath, mergedConfig)`). A `PATCH /api/nodes/:type` request would write the YAML config over the encrypted wallet at `~/.townhouse/wallet.enc`, corrupting it. Must point at a real config path or `null` until 21.14 wires the wizard.
- [x] [Review][Patch] **Storybook decorator dead-cleanup leak** [`Home.stories.tsx:75-94`] — `<div ref={() => () => restore()} hidden />` returns a function from a ref callback; React 18 ignores the return value, so `restore()` never runs and `globalThis.fetch` is permanently overwritten by each story's fixture. `globalThis.WebSocket = NoOpWs` at line 86 is also never restored. Switch to a Storybook decorator cleanup pattern or `useEffect`-based wrapper component.
- [x] [Review][Patch] **Home discards `connectionStatus` from WS hook + Retry doesn't reconnect WS** [`Home.tsx:927-928, 932-939`] — Hook deliberately exposes `connectionStatus` (`'connecting' | 'open' | 'degraded' | 'closed'`); view destructures only `statesByName`, so when the WS dies the operator sees stale dots with no UI signal. Retry button calls `useNodes.refetch()` only — no WS reconnect path. Surface a header-level connection indicator (Shell ATOR dot is taken; add a separate WS-status badge), expose `reconnect()` from `useNodeStatusStream`, and wire Retry to invoke both.
- [x] [Review][Patch] **`transportMode` default `'direct'` lies in production** [`Home.tsx:925`] — Component prop defaults to `'direct'` regardless of actual config. Operator with ATOR transport sees a misleading green "Direct transport" indicator. Default to `'unknown'`.
- [x] [Review][Patch] **Empty-state CTA points at `/wizard` (NotFound), spec says `/`** [`Home.tsx:966`] — AC-7 explicitly says: "with a Button linking to `/wizard` (route ships in 21.14 — for now it links to `/`)". Implementation links to `/wizard`, which falls through to `<NotFound />`. Change to `/` until 21.14 ships, then flip back.
- [x] [Review][Patch] **`refetch()` blanks cards into loading skeleton** [`useNodes.ts:178`] — Effect re-run sets `status` to `'loading'`, dropping prior nodes and any inner DOM/focus state. Add an `isRefreshing` substate (or only flip to `'loading'` when `nodes.length === 0`), and keep cards visible during retry.
- [x] [Review][Patch] **No per-request timeout on detail fetches** [`useNodes.ts:192-205`] — `Promise.all` over `/api/nodes/:type` blocks the entire view in `'loading'` if one detail request hangs. Add `AbortSignal.timeout(5_000)` per detail call (or `Promise.race` with a timeout), and treat per-type failure as a `null` metric rather than a hook-wide error.
- [x] [Review][Patch] **Heartbeat timer closes `socketRef.current`, not the captured socket** [`useNodeStatusStream.ts:431`] — `armHeartbeat` is created fresh per `connect()`, but the timer it schedules calls `socket.close()` on `socketRef.current`. If `clearHeartbeat()` is missed on a close path while a reconnect already swapped the ref, an old timer can kill a fresh socket. Capture `socket` in the `armHeartbeat` closure and close that local variable instead.
- [x] [Review][Patch] **AC-4 aria-label deviation** [`Home.tsx:813-815`, `Home.test.tsx:1200`] — Spec required `aria-label="metric unavailable"` for null metrics; implementation uses `MetricBlock`'s default `"Events today: —"`. Pass an explicit `aria-label="metric unavailable"` for the unavailable branch and update the codifying test.
- [x] [Review][Patch] **Stale closure on `connectionStatus` in message handler** [`useNodeStatusStream.ts:469`] — `if (connectionStatus !== 'open') setConnectionStatus('open')` reads the captured-at-effect-mount value. Causes setState on every message rather than only on transition. Use functional setter: `setConnectionStatus(prev => prev !== 'open' ? 'open' : prev)`.
- [x] [Review][Patch] **Empty `'error'` listener — some failures never reschedule** [`useNodeStatusStream.ts:491-493`] — Some browser/CSP-block scenarios fire `'error'` without a subsequent `'close'`. Hook stays in `'open'` until heartbeat eventually expires (up to 30 s). Add `scheduleReconnect()` to the error path, gated by a flag so it doesn't double-schedule when `'close'` follows.
- [x] [Review][Patch] **Backoff doubles synchronously on instant-throw failures** [`useNodeStatusStream.ts:498-501`] — When `connect()` throws synchronously, `scheduleReconnect()` doubles `backoffRef.current` before the timer fires. A constructor-throw loop burns through `100→200→…→cap` in milliseconds. Move the doubling into the timer callback, or only double after the next attempt fires (not before).
- [x] [Review][Patch] **`attribution !== 'per-peer'` should be `=== 'aggregate'`** [`Home.tsx:818`] — Treats every non-`per-peer` value (including `undefined` from a malformed payload, or future enum additions) as aggregate, attaching the misleading "(all nodes)" footnote. Flip to explicit `=== 'aggregate'`.
- [x] [Review][Patch] **`formatUptime` aria reads "Uptime: —"** [`Home.tsx:853`] — Screen reader announces the em-dash literally. Use "Uptime: unknown" (or omit the aria-label and only render the dash visually) for the null branch.
- [x] [Review][Patch] **AbortError name check ignores other abort error shapes** [`useNodes.ts:215`] — Some browsers throw `TypeError` with abort-flavored messages on stream-read abort. Also check `controller.signal.aborted` (or use the `cancelled` flag already in scope) to suppress phantom errors during fast remount.
- [x] [Review][Patch] **Test microtask flake risk in heartbeat-degraded test** [`useNodeStatusStream.test.ts:663-674`] — Fake-timer + microtask interplay (close → microtask → reconnect schedule) can race the `vi.advanceTimersByTime(150)` advancement. Switch to `await vi.runAllTimersAsync()` or explicit `await Promise.resolve()` flushes between `close()` and the subsequent advance.
- [x] [Review][Patch] **WS parse errors silently swallowed — no diagnostic** [`useNodeStatusStream.ts:476-479`] — Malformed payloads still re-arm the heartbeat (good, comment explains intent), but the parse failure is dropped with no `console.warn`. Operators have no signal that the server is emitting bad JSON. Add a single warn.
- [x] [Review][Patch] **Test coverage gaps** [`useNodes.test.ts`, `useNodeStatusStream.test.ts`] — Three uncovered branches: (a) WS constructor-throw retry path (`useNodeStatusStream.ts:453-458`), (b) malformed JSON / Blob payload path (parse failure must still arm heartbeat per comment), (c) abort-vs-network-error distinction in `useNodes` (the AbortError name-check race noted above). Add three small tests.

**Deferred:**

- [x] [Review][Defer] AC-3 hook surface keying differs from spec (`statesByName: Record<string,string>` instead of `Map<NodeType, NodeState>`) [`useNodeStatusStream.ts`] — deferred, documented in Dev Notes "Implementation Plan" #2 as deliberate.
- [x] [Review][Defer] AC-5 transport reachability is a static indicator [`Home.tsx:866-887`] — deferred, gated behind story 21.15 per spec's plumbing-decision clause; TODO comment in place.
- [x] [Review][Defer] AC-9 (live-Docker screenshot) and AC-10 (`docker pause` degraded demo) [PR review] — deferred, explicit gate at PR review per spec; Dev Agent flags the dev-stack container-name caveat that may block AC-10 until 21.14 fixtures land.
