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

**Rotation variants** (used by Story 48.3 badge animation — ship here so Sally reviews one library):
- `you're early`
- `warming up`
- `first packet en route`

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

## Future-State Placeholders

The following copy entries ship in this doc NOW so Sally can review one library — the TUI components that render them land in 48.2 / 48.4. The strings MUST be present in `copy.ts` today (even if the components using them are in future stories) so the copy-sync test passes.

**Apex routing empty** (Story 48.2 `<ApexStripSlot />`):
```
(enable mill to route)
```

**Per-peer table empty** (Story 48.2 `<PeerTableSlot />`):
```
no peers yet — run 'townhouse node add town'
```

**Recent claims empty** (Story 48.4 `<FooterSlot />`):
```
no settlements yet — press [a] when activity arrives
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
| `COPY.future.apexRoutingEmpty` | `(enable mill to route)` |
| `COPY.future.peerTableEmpty` | `no peers yet — run 'townhouse node add town'` |
| `COPY.future.recentClaimsEmpty` | `no settlements yet — press [a] when activity arrives` |

---

## Cross-References

- Wireframe layout: `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1)
- TUI copy module: `packages/townhouse/src/tui/copy.ts`
- Copy-sync test: `packages/townhouse/src/tui/copy-sync.test.ts`
- Story spec: `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` AC #4, AC #9
