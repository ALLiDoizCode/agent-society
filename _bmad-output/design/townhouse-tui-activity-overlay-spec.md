# UX-DR6: Activity Overlay Spec

**Status:** Dev-agent first draft — awaiting Sally sign-off in PR description.
**Story:** `_bmad-output/implementation-artifacts/48-4-activity-ticker-footer-and-activity-overlay.md`

---

## Why an Overlay

Settlement events are high-cardinality (200+ per day at scale); inlining them in the dashboard would push the hero metric below the fold. The overlay is "drill, not header" — operator-initiated, returns to dashboard when done. Drew sees the ticker heartbeat passively and drills in on demand by pressing `[a]`.

---

## Ticker Line Spec (Footer)

The activity ticker occupies the `<FooterSlot />` (bottom row of the dashboard, always visible while dashboard is rendered).

**Populated format:**
```
recent: <peerId> ← $X.XXXX <assetCode> · <relative_time> [a] activity
```

Example:
```
recent: town-01 ← $0.0120 USDC · 5m ago [a] activity
```

Outbound example:
```
recent: town-02 → $0.0008 USDC · 2m ago [a] activity
```

**Empty state** (no claims in ring buffer):
```
no settlements yet — press [a] when activity arrives
```

Both states styled `<Text dimColor>`. The `[a]` keybind always works (even in empty state — the overlay opens and shows `(no activity yet)`).

---

## Overlay Modal Layout

When `[a]` is pressed, `App.tsx` returns `<ActivityOverlay />` INSTEAD OF the dashboard JSX (replace-on-toggle, not z-index — Ink is a flat layout engine with no stacking context).

### 80ch Reference Grid

Modal width at 80 columns: `max(40, floor(80 * 0.7)) = 56` cols. `visibleRows = max(5, 24 - 5) = 19`.

```
┌────────────────────────────────────────────────────────┐
│ Activity — last 6 of 200                               │
│ 14:32:08 · town-01 · ← $0.0120 USDC · in              │
│ 14:30:00 · town-02 · → $0.0008 USDC · out             │
│ 14:28:45 · town-03 · ← $0.0050 USDC · in              │
│ 14:25:12 · town-04 · ← $0.0030 USDC · in              │
│ 14:20:00 · town-05 · → $0.0020 USDC · out             │
│ j/k to scroll · q to close                             │
└────────────────────────────────────────────────────────┘
```

### 120ch Reference Grid

Modal width at 120 columns: `max(40, floor(120 * 0.7)) = 84` cols. `visibleRows = max(5, 24 - 5) = 19`.

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Activity — last 6 of 200                                                           │
│ 14:32:08 · town-01 · ← $0.0120 USDC · in                                          │
│ 14:30:00 · town-02 · → $0.0008 USDC · out                                         │
│ 14:28:45 · town-03 · ← $0.0050 USDC · in                                          │
│ 14:25:12 · town-04 · ← $0.0030 USDC · in                                          │
│ 14:20:00 · town-05 · → $0.0020 USDC · out                                         │
│ 14:15:33 · town-06 · ← $0.0010 USDC · in                                          │
│ j/k to scroll · q to close                                                         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Keybindings

| Key | Action | Notes |
|-----|--------|-------|
| `a` / `A` | Open overlay (from dashboard) | Case-insensitive. Ctrl-A and Alt-A ignored. |
| `q` / `Q` | Close overlay | Case-insensitive. |
| `ESC` | Close overlay | Alternative close. |
| `j` / `↓` | Scroll down (newer → older) | Clamps at `max(0, claims.length - visibleRows)`. |
| `k` / `↑` | Scroll up (older → newer) | Clamps at 0. |
| Ctrl-* / Alt-* | Ignored | Overlay's `useInput` early-returns on `key.ctrl || key.meta` (matches App's same guard). Ctrl-Q, Ctrl-J, etc. do NOT trigger close/scroll. |

Pressing `a` while overlay is open is silently ignored (App's `[a]` listener is gated `isActive={false}` when overlay is mounted).

---

## Row Format

```
<HH:MM:SS> · <peerId> · <arrow> $X.XXXX <assetCode> · <dir>
```

Fields:
- `<HH:MM:SS>` — local 24h time from `new Date(claim.at).toLocaleTimeString('en-GB', { hour12: false })`. Malformed `at` → `--:--:--`.
- `<peerId>` — truncated to 24 chars with `…` ellipsis if longer.
- `<arrow>` — `←` for inbound, `→` for outbound, `?` for any future enum drift (defensive — the wire enum is open over time even though the schema enforces today's two-value set).
- `$X.XXXX <assetCode>` — 4-decimal `formatUsdcMicro` amount + asset code. Malformed amount → `$?.????`.
- `<dir>` — `in` (inbound), `out` (outbound), or `?` for unknown direction (mirrors `<arrow>` fallback).

---

## Ring Buffer

- **Capacity:** 200 entries (`MAX_BUFFER_SIZE`).
- **Dedup key:** `${peerId}|${at}|${amount}|${assetCode}|${direction}` (5-field composite — `at` alone is not unique enough for settlement bursts).
- **Sort order:** DESC by `Date.parse(at)`. Malformed `at` (NaN) sorts to the end (`-Infinity` sort key).
- **Truncation:** After sort, keep the most recent 200 entries.
- **Hook:** `useActivityBuffer(incoming)` — merges on each `useEarnings()` refresh tick (every 2s). Lives in `tui/` (not `components/`).

---

## Resize Behavior

- `modalWidth = max(MIN_OVERLAY_WIDTH=40, floor(stdout.columns * 0.7))`.
- `visibleRows = max(5, stdout.rows - 5)`.
- Ink re-renders on terminal SIGWINCH automatically. Overlay re-measures via `useStdout()` on each render.

---

## Empty-State Overlay

When ticker shows the empty copy AND operator presses `[a]`, the overlay opens. Body shows `(no activity yet)`. Title shows `Activity — last 0 of 200`. **Hint row degrades** from `j/k to scroll · q to close` (populated) to `q to close` (empty) — `j`/`k` are no-ops at length 0 and advertising them is misleading. This is INTENTIONAL — same UX-DR2 posture as 48.1 (every zero state has explicit copy + accurate affordances; no silent no-op).

---

## Two USDC Formatters Side-by-Side

| Function | Decimals | Used by | Example (`amount='12000'` at scale 6) |
|----------|----------|---------|---------------------------------------|
| `formatUsdc(d, s)` | 2 (truncate) | HeroBand, ApexStrip, PeerTable | `$0.01` |
| `formatUsdcMicro(d, s)` | 4 (truncate) | ActivityTicker, ActivityOverlay | `$0.0120` |

Per-claim USDC amounts are typically sub-cent micropayments. 4 decimals preserves the signal; 2 decimals would collapse most claims to `$0.00`.

---

## Cross-References

- Wireframe: `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1)
- Empty-state copy: `_bmad-output/design/empty-state-copy.md` (UX-DR2)
- Badge spec: `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3)
- Per-asset row spec: `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7)
- Story: `_bmad-output/implementation-artifacts/48-4-activity-ticker-footer-and-activity-overlay.md`
