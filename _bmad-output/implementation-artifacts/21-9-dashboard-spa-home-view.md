# Story 21.9-lite: Dashboard SPA — Home Heartbeat View

Status: backlog

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

- [ ] Task 1: Router setup (AC: #1)
  - [ ] 1.1 Add `react-router-dom@^6` (or hand-roll a minimal `<Routes>` — implementer's pick).
  - [ ] 1.2 In `src/App.tsx`, define routes: `/` → `<Home />`, fallback `<NotFound />` (a stub for now).
  - [ ] 1.3 Update `src/main.tsx` to wrap `<App />` in the router context.

- [ ] Task 2: Data hook — `useNodes` (AC: #2)
  - [ ] 2.1 Create `src/hooks/useNodes.ts`. Internally calls `fetch('/api/nodes')`, manages `loading | ready | error` state, exposes `{ nodes, status, refetch }`.
  - [ ] 2.2 No external data library. Plain `useState` + `useEffect`. AbortController for cleanup on unmount.
  - [ ] 2.3 Test (`useNodes.test.ts`) with `vi.spyOn(global, 'fetch')` covering success, 5xx, and network error paths.

- [ ] Task 3: WebSocket hook — `useNodeStatusStream` (AC: #3)
  - [ ] 3.1 Create `src/hooks/useNodeStatusStream.ts`. Opens `WebSocket('/api/metrics')`. Maintains `Map<NodeType, NodeState>` keyed by node ID/type from `nodeState` messages.
  - [ ] 3.2 Tracks last-message timestamp; if >30 s since any message, transitions connection state to `degraded` and triggers reconnect.
  - [ ] 3.3 Exponential backoff: 1 s, 2 s, 4 s, ..., capped at 30 s. Reset on successful open.
  - [ ] 3.4 Returns `{ statesByType, connectionStatus }`.
  - [ ] 3.5 Test using `mock-socket` or hand-rolled `WebSocket` mock — assert reconnect logic, heartbeat detection, state mapping.

- [ ] Task 4: Home view assembly (AC: #1, #2, #6, #7)
  - [ ] 4.1 `src/views/Home.tsx` renders `<Shell>`, header (with title + ATOR `StatusDot`), main with node cards.
  - [ ] 4.2 Compose data: `useNodes()` for the list + per-node config; `useNodeStatusStream()` for live state overrides.
  - [ ] 4.3 For each node, render a card composed of `TypeChip` + `StatusDot` + ID + uptime + `MetricBlock` for "Events today."
  - [ ] 4.4 Wrap card list in `StateShell` for empty/loading/error.
  - [ ] 4.5 Apply Tailwind grid for responsive layout per the breakpoint scale.

- [ ] Task 5: Events-today counter (AC: #4)
  - [ ] 5.1 In `useNodes`, additionally fetch `GET /api/nodes/:type` for each enabled type to access the `metrics` field.
  - [ ] 5.2 If the API exposes per-node packet counters at this point, use them. Else (likely the case until 21.10), display the workspace aggregate with a `(all nodes)` footnote and the inline TODO comment.
  - [ ] 5.3 Format the number with `tnum` digits via `MetricBlock`.

- [ ] Task 6: ATOR status indicator (AC: #5)
  - [ ] 6.1 If `GET /api/transport-status` exists, fetch and reflect.
  - [ ] 6.2 Else, fall back to a static `StatusDot` reflecting `transport.mode` only with the inline TODO comment.

- [ ] Task 7: A11y test (AC: #8)
  - [ ] 7.1 `src/views/Home.test.tsx` mounts the Home with mocked API responses; runs axe-core; asserts zero WCAG 2.1 AA violations.
  - [ ] 7.2 Add a story `Home.stories.tsx` for Storybook (fixture data only — D21-009 boundary).

- [ ] Task 8: Live-Docker verification (AC: #9, #10)
  - [ ] 8.1 With `./scripts/townhouse-dev-infra.sh up` running, `pnpm --filter @toon-protocol/townhouse-web dev:docker`.
  - [ ] 8.2 Visit `http://127.0.0.1:5173` — confirm 5 cards visible.
  - [ ] 8.3 Capture screenshot for PR.
  - [ ] 8.4 `docker pause townhouse-dev-town-02` — confirm `StatusDot` transitions to `degraded` within 30 s; capture second screenshot.
  - [ ] 8.5 `docker unpause townhouse-dev-town-02` — confirm recovery.

- [ ] Task 9: Lint + build (AC: #11)
  - [ ] 9.1 `pnpm --filter @toon-protocol/townhouse-web lint` — must pass; the three custom rules from 21.8.5 stay green.
  - [ ] 9.2 `pnpm --filter @toon-protocol/townhouse-web test` — must pass.
  - [ ] 9.3 `pnpm --filter @toon-protocol/townhouse-web build` — must produce `dist/`.

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
- Does not implement the wizard route. `/wizard` link points at `/` until 21.14 lands.
