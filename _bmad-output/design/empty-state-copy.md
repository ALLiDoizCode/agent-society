# UX-DR2: Empty-State Copy Library

**Status:** Dev-agent first draft — awaiting Sally sign-off in PR description.
**Usage:** All zero/wait/loading/failure states in the TUI source MUST import strings from `packages/townhouse/src/tui/copy.ts`. No `if (n === 0) return ''` patterns allowed — every empty branch routes through `copy.ts`.

---

## Hero Qualifier (Zero State)

Used in `<Qualifier />` when `month === '0'` across all peers and apex.

**Composed from three COPY tokens** (no inline scaffolding in components):

```
MONTH $0.00
```

```
events relayed
```

(rendered as `<COPY.qualifierPrefix> · {N} <COPY.qualifierEventsWords> · <COPY.heroEarly>`)

**Primary rendered string:**
```
MONTH $0.00 · {N} events relayed · you're early
```

Where `{N}` is the integer `eventsRelayed` from `GET /api/earnings`.

**Note:** The trailing "you're early" in the qualifier is the static empty-state hero copy (Story 48.1). The rotated variants are the badge's territory (Story 48.3 — see § "You're Early Badge (Story 48.3)").

---

## Loading State

Shown during the brief window between TUI mount and first fetch resolution.

```
Fetching earnings…
```

---

## `connector_unavailable` Banner

Shown when `GET /api/earnings` returns `{ status: 'connector_unavailable' }`. Rendered between the hero band and the (future) apex strip slot. Previous successful payload is retained in the hero.

```
Connector not reachable — showing last known values. Retrying in 2s.
```

---

## Stale Data Hint

Shown when `fetch_failed` (network error / non-200 response). Rendered in **red** (UX-DR1 `bannerError` token). The "seconds since last successful fetch" hint is deferred — see deferred-work.md (W14 / W15 follow-up).

```
Last refresh failed — retrying.
```

---

## `starting_up` Banner (warm-up)

Shown when no fetch has succeeded yet (a freshly-booted node whose `townhouse-api`
is still coming up). Rendered in **cyan** (calm, not an error). Escalates to the
`fetch_failed` banner after `STARTING_UP_GRACE_FETCHES` consecutive failures so a
genuinely-down API does not read as "starting up" forever.

```
Starting up — connecting to your node…
```

---

## Apex + Per-Peer Table Copy (Story 48.2)

The apex routing-fee strip and per-peer table components ship in Story 48.2.

**Apex routing prefix** (prefix for every apex strip row):
```
↳ apex routing: 
```

**Apex routing empty** (shown when `apex.month === 0` AND no Mill peer exists):
```
(enable mill to route)
```

**Per-peer table empty** (shown when `peers.length === 0`):
```
no peers yet — in a new terminal: townhouse node add town
```

## You're Early Badge (Story 48.3)

The `<Badge />` component renders one of three rotated strings when `lifetime < $1.00 OR uptime < 7d`. The rotation is driven by wall-clock time (30-second cadence — see UX-DR3). Once both triggers clear, the badge disappears silently.

**Rotation variants:**
- `you're early`
- `warming up`
- `first packet en route`

Sourced from `COPY.heroEarlyRotation` (defined in `tui/copy.ts:3`).

---

## Activity Ticker + Overlay Copy (Story 48.4)

The `<ActivityTicker />` (footer slot) and `<ActivityOverlay />` modal ship in Story 48.4.

**Activity ticker prefix** (static label preceding the most recent claim line):
```
recent: 
```

**Activity ticker empty** (shown when `recentClaims.length === 0`):
```
no settlements yet — press [a] when activity arrives
```

**Activity ticker keybind hint** (appended to the populated ticker line):
```
 [a] activity
```

**Activity overlay title prefix** (combined with `Math.min(claims.length, MAX_BUFFER_SIZE)` and the literal ` of ${MAX_BUFFER_SIZE}` suffix at render time, producing `Activity — last N of 200`):
```
Activity — last 
```

The `200` cap is sourced from `MAX_BUFFER_SIZE` in `use-activity-buffer.ts` (single source of truth — there is intentionally **no** `titleSuffix` COPY token so the cap cannot drift).

**Activity overlay empty hint** (shown in body when `claims.length === 0`):
```
(no activity yet)
```

**Activity overlay scroll hint** (bottom hint row when `claims.length > 0`):
```
j/k to scroll · q to close
```

**Activity overlay scroll hint — empty** (bottom hint row when `claims.length === 0`; `j`/`k` are no-ops at length 0, so the hint degrades):
```
q to close
```

**Direction label — inbound** (used in overlay row format):
```
in
```

**Direction label — outbound** (used in overlay row format):
```
out
```

**Direction label — unknown** (used in both ticker arrow and overlay row when `direction` is neither `'inbound'` nor `'outbound'` — defensive against future wire enum drift):
```
?
```

---

## Anti-Pattern Callout

**NEVER** write inline empty-state strings in TUI component files. Every zero/wait/loading branch MUST import from `copy.ts`:

```typescript
// ✅ Correct
import { COPY } from '../copy.js';
<Text>{COPY.heroEarly}</Text>

// ❌ Wrong — hardcoded string in component
<Text>you're early</Text>
```

The `copy-sync.test.ts` test enforces this by asserting that every leaf string in `COPY` appears verbatim (backtick-wrapped) in this markdown file.

---

## Copy Token Reference

| Token key | Value |
|-----------|-------|
| `COPY.heroEarly` | `you're early` |
| `COPY.heroEarlyRotation[0]` | `you're early` |
| `COPY.heroEarlyRotation[1]` | `warming up` |
| `COPY.heroEarlyRotation[2]` | `first packet en route` |
| `COPY.loading` | `Fetching earnings…` |
| `COPY.qualifierPrefix` | `MONTH $0.00` |
| `COPY.qualifierEventsWords` | `events relayed` |
| `COPY.banners.connectorUnavailable` | `Connector not reachable — showing last known values. Retrying in 2s.` |
| `COPY.banners.fetchFailed` | `Last refresh failed — retrying.` |
| `COPY.banners.startingUp` | `Starting up — connecting to your node…` |
| `COPY.apex.routingPrefix` | `↳ apex routing: ` |
| `COPY.apex.routingEmpty` | `(enable mill to route)` |
| `COPY.peerTable.empty` | `no peers yet — in a new terminal: townhouse node add town` |
| `COPY.activityTicker.prefix` | `recent: ` |
| `COPY.activityTicker.empty` | `no settlements yet — press [a] when activity arrives` |
| `COPY.activityTicker.keybind` | ` [a] activity` |
| `COPY.activityOverlay.titlePrefix` | `Activity — last ` |
| `COPY.activityOverlay.emptyHint` | `(no activity yet)` |
| `COPY.activityOverlay.scrollHint` | `j/k to scroll · q to close` |
| `COPY.activityOverlay.scrollHintEmpty` | `q to close` |
| `COPY.activityOverlay.directionInbound` | `in` |
| `COPY.activityOverlay.directionOutbound` | `out` |
| `COPY.activityOverlay.directionUnknown` | `?` |

---

## Cross-References

- Wireframe layout: `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1)
- Badge spec: `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3)
- Activity overlay spec: `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6)
- TUI copy module: `packages/townhouse/src/tui/copy.ts`
- Copy-sync test: `packages/townhouse/src/tui/copy-sync.test.ts`
- Story spec: `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` AC #4, AC #9
