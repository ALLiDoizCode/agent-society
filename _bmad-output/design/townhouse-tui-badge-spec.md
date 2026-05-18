# UX-DR3: 'You're Early' Badge Spec

**Status:** Sally sign-off (UX-DR3): approved — 2026-05-14. Non-blocking pilot-watch notes captured in the story Review Findings (Qualifier/Badge dual presence at rotation index 0; 8-color terminal yellow-on-yellow differentiation relies on spatial separation when bold renders weakly; first-rotation phase quirk under render-pure wall-clock design).
**Story:** `_bmad-output/implementation-artifacts/48-3-youre-early-badge.md`

---

## Why a Badge

Small numbers should feel like positioning, not failure. Drew on day one sees $0.00 everywhere — without context that's demoralizing. The badge gives Drew permission to have $0.00 today: it reframes the early phase as "you're in the right place, the system is warming up," not "this isn't working."

Once the system is mature (>$1 lifetime AND >7d uptime), the badge silently retires so Drew doesn't feel patronized once real routing activity starts. The disappearance is instant and unremarked — no farewell animation, no flash. It's just gone on the next 2-second refresh tick.

On connector outage, the badge renders by design — operators on a freshly-started home rig with a flaky LAN see the badge as a friendly companion to the banner, not as a duplicate signal. The `<Banner />` shows the explicit `Connector not reachable...` message; the badge is the ambient warmth.

---

## 80ch Reference Grid

Badge mounted between hero band and banner. Qualifier and badge can coexist on day-one Drew (see § "Qualifier vs Badge Coexistence").

```
TODAY          MONTH           YEAR            LIFETIME
$0.00          $0.00           $0.00           $0.00
·······  7d
MONTH $0.00 · 0 events relayed · you're early
you're early                                            <- badge (yellow + bold)
```

When badge is not visible (lifetime ≥ $1.00 AND uptime ≥ 7d), the row collapses entirely — no whitespace placeholder:

```
TODAY          MONTH           YEAR            LIFETIME
$12.34         $0.45           $3.20           $12.34
▁▂▃▄▅▆▇█▁▂▃  7d
↳ apex routing: $0.45 (72%)
```

---

## 120ch Reference Grid

```
TODAY              MONTH              YEAR               LIFETIME
$0.00              $0.00              $0.00              $0.00
▁▂▃▄▅▆▇█▁▂▃▄▅▆  7d
MONTH $0.00 · 0 events relayed · you're early
you're early                                                                            <- badge (yellow + bold)
```

---

## Visual Treatment

```tsx
<Text color="yellow" bold>
  {rotatedCopyText}
</Text>
```

- **Color:** `"yellow"` — matches UX-DR1's `earlyAccent` token. No new color tokens introduced.
- **Bold:** adds visual emphasis so the badge draws the eye. Bold survives across every terminal-color matrix tier (truecolor, 8-color, and monochrome).
- **NEVER use `dimColor`:** the badge is meant to draw the eye, not fade. `dimColor` would defeat the visual emphasis.
- **`NO_COLOR=1` / dumb-terminal:** chalk degrades `"yellow"` to plain text; `bold` survives as ANSI SGR 1. The badge text remains readable in every environment.

---

## Copy Rotation

Three variants from `COPY.heroEarlyRotation` (`tui/copy.ts:3`):

| Index | Text |
|-------|------|
| 0 | `you're early` |
| 1 | `warming up` |
| 2 | `first packet en route` |

Order: 0 → 1 → 2 → 0 → 1 → 2 → … (modulo wrap).

---

## Rotation Cadence

**30 seconds** — `ROTATION_INTERVAL_MS = 30_000` (exported named constant in `Badge.tsx`).

Wall-clock-derived index formula:

```
index = Math.floor(now.getTime() / 30_000) % 3
```

- **Render-pure:** no `useState`, no `useEffect`, no `setInterval`. The index is a pure function of `now`.
- **Refresh-tick alignment:** `useEarnings()` re-renders the badge every ~2 seconds. Over a 30-second rotation window, the badge re-renders ~15 times with the same index — then advances by 1 when the wall clock crosses the next 30s boundary. The operator sees stable text that changes every 30 seconds, not flickering text on every refresh.
- **Test injection:** the `now?: Date` prop (default `new Date()`) allows tests to pin the wall clock without `vi.setSystemTime()`.

Trade-off rationale: 30s aligns to ~15 refresh ticks per step — slow enough to not flicker, fast enough that an idle operator sees all three variants within ~90s (one full cycle).

---

## Trigger Rules

Badge is visible when: `lifetimeTriggers || uptimeTriggers`

### Lifetime trigger

`lifetimeTriggers = computeLifetimeUsdc(apex, peers) < 1_000_000n`

- Threshold: `1_000_000` smallest-units at USDC scale 6 = `$1.00`
- Computed as: `BigInt(apex.routingFees['USDC']?.lifetime ?? '0') + Σ BigInt(peer.byAsset['USDC']?.lifetime ?? '0')`
- **USDC-only filter:** only the literal `'USDC'` assetCode contributes (mirrors hero band + apex strip filter from 48.1 + 48.2). A peer with only `'USDC-sol'` does NOT count toward badge dismissal.
- **Defensive parsing:** any string failing `/^-?\d+$/` is treated as `0n`. One malformed peer payload cannot crash the render tree.

### Uptime trigger

`uptimeTriggers = uptimeSeconds < 604_800`

- Threshold: `604_800` seconds = 7 days (`7 * 24 * 3600`)
- Source: `AggregatedEarnings.uptimeSeconds` (integer ≥ 0 per schema). Plain JS `number` (not BigInt).
- `0` on connector outage (correct — a freshly-restarted or unreachable node IS in a "warming up" state).

---

## Disappearance Rule

Badge returns `null` (no animation, no farewell) when BOTH `lifetime >= $1.00 AND uptime >= 7d`.

- **Silent:** the row collapses. No flash, no whitespace placeholder, no farewell text.
- **Within-session permanence:** once disappeared, the badge stays gone for that session. Lifetime grows monotonically; uptime crosses 7d only once per session. The badge effectively does not re-appear within the same session.
- **Post-restart reappearance:** on TUI restart, if the connector resets `uptimeSeconds` to 0, the badge reappears — a freshly-restarted node IS warming up, even if lifetime is already > $1.

---

## Qualifier vs Badge Coexistence

The qualifier in `<HeroBand />` (`MONTH $0.00 · N events relayed · you're early`) and the badge are **separate elements** that can both show simultaneously on day-one Drew (month==0, lifetime<$1, uptime<7d):

1. **Qualifier row:** `MONTH $0.00 · 0 events relayed · you're early` — yellow text, fixed string from `COPY.heroEarly`, rendered by `<Qualifier />` inside `<HeroBand />`.
2. **Badge row:** `you're early` (or `warming up` / `first packet en route`) — yellow + bold, rotated from `COPY.heroEarlyRotation`, rendered by `<Badge />` as a sibling of `<HeroBand />`.

This dual presence is **intentional for v1**. The qualifier is empty-state hero copy (48.1 AC #4 — load-bearing across regressions); the badge is a separate richer signal at a different mount point.

If Sally wants the qualifier's trailing `· you're early` removed, that is a follow-up story (out of scope for 48.3).

---

## Cross-References

- Wireframe layout + slot table: `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1)
- Copy library + rotation variants: `_bmad-output/design/empty-state-copy.md` (UX-DR2)
- This story file: `_bmad-output/implementation-artifacts/48-3-youre-early-badge.md`
