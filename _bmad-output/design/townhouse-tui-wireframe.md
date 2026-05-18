# UX-DR1: Townhouse TUI Wireframe

**Upstream spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154`
**Status:** Dev-agent first draft — awaiting Sally sign-off in PR description.

---

## 80ch Reference Grid

Row budget at 80×24: hero 3 rows + qualifier 1 row + badge 1 row (conditional) + apex slot 1 row + peer slot 5 rows (header + 4 data) + footer slot 1 row = 12 rows used (badge visible), 12 rows free. Badge non-visible case = 10 rows used.

```
┌──────────────────────────────────────────────────────────────────────────────┐  row 0 (border only for illustration; not rendered)
│ TODAY          MONTH           YEAR            LIFETIME                      │  row 1 — labels (dim-grey)
│ $0.00          $0.00           $0.00           $0.00                         │  row 2 — values (green if >0, default if 0)
│ ·······  7d                                                                  │  row 3 — sparkline (collapses at <60ch)
│ MONTH $0.00 · 0 events relayed · you're early                                │  row 4 — empty-state qualifier (hidden when any month>0)
│ you're early                                                                 │  row 5 — [Badge] (conditional — hides when lifetime ≥ $1.00 AND uptime ≥ 7d)
│ ↳ apex routing: $0.01 USDC                                                   │  row 6 — [ApexStripSlot — Story 48.2]
│ PEER     TYPE  ASSET  NET (MONTH)  LAST CLAIM                                │  row 7 — [PeerTableSlot header — Story 48.2]
│ town-01  town  USDC   $0.01        5m ago                                    │  rows 8–11 — [PeerTableSlot data rows — Story 48.2]
│ recent: town-01 ← $0.0120 USDC · 5m ago [a] activity                        │  row 12 — [FooterSlot — ActivityTicker — Story 48.4]
└──────────────────────────────────────────────────────────────────────────────┘
```

**Rendered (no borders, actual output at 80ch):**
```
TODAY          MONTH           YEAR            LIFETIME
$0.00          $0.00           $0.00           $0.00
·······  7d
MONTH $0.00 · 0 events relayed · you're early
you're early
↳ apex routing: $0.01 USDC
PEER     TYPE  ASSET  NET (MONTH)  LAST CLAIM
town-01  town  USDC   $0.01        5m ago
recent: town-01 ← $0.0120 USDC · 5m ago [a] activity
```

---

## 120ch Reference Grid

At 120 columns the sparkline expands and asset row widens to show more decimal precision context.

```
TODAY              MONTH              YEAR               LIFETIME
$0.00              $0.00              $0.00              $0.00
▁▂▃▄▅▆▇█▁▂▃▄▅▆  7d
MONTH $0.00 · 0 events relayed · you're early
you're early
↳ apex routing: $0.01 USDC
PEER          TYPE  ASSET  NET (MONTH)  LAST CLAIM
town-01       town  USDC   $0.01        5m ago
recent: town-01 → $0.0008 USDC · 2m ago [a] activity
```

---

## Ink Color Tokens

| Token name      | Ink `<Text color="...">` | Usage |
|-----------------|--------------------------|-------|
| `labelDim`      | `"gray"` / `dimColor`    | Column headers (TODAY, MONTH, YEAR, LIFETIME) |
| `valuePositive` | `"green"`                | USDC value when > $0.00 |
| `valueNeutral`  | `undefined` (default)    | USDC value when $0.00 |
| `earlyAccent`   | `"yellow"`               | "you're early" qualifier text |
| `bannerWarn`    | `"yellow"`               | `connector_unavailable` banner |
| `bannerError`   | `"red"`                  | `fetch_failed` banner |

---

## Degrade Ladder

As terminal columns shrink:

| Width range | Behavior |
|-------------|----------|
| ≥70ch       | Full layout: long labels (TODAY MONTH YEAR LIFETIME), sparkline, all values |
| 60–69ch     | Labels truncate to short form: TODAY / MONTH / YEAR / LIFE |
| <60ch       | Sparkline collapses to empty string (decorative element; does NOT remove the row entirely) |
| <60ch       | Scalar value row ALWAYS stays (load-bearing — this row never disappears) |

Degrade rule: **sparklines collapse first** (decorative), **labels truncate second**, **values never disappear**.

---

## Resize Behavior

The TUI re-reads column width via Ink's `useStdout()` hook. Ink handles the SIGWINCH-equivalent internally — no explicit `process.on('SIGWINCH')` listener is needed or written. The `width` is passed as a prop to `<Sparkline width={columns} />` and used to gate the degrade ladder in `<HeroBand />`.

---

## Layout Slots (Reserved)

Three stub components ship in 48.1 as empty fragments. Future stories mount real content **without touching `App.tsx`**:

| Slot component      | Reserved for | Row budget |
|---------------------|--------------|------------|
| `<Badge />`         | Story 48.3 "you're early" badge | 1 row (conditional) |
| `<ApexStripSlot />` | Story 48.2 apex routing strip | 1 row |
| `<PeerTableSlot />` | Story 48.2 per-peer earnings table | 4 rows |
| `<FooterSlot />`    | Story 48.4 — `<ActivityTicker />` (1 row, always rendered when dashboard is visible; replaced by `<ActivityOverlay />` when `[a]` pressed) | 1 row |

**Note:** The `<ActivityOverlay />` modal is "outside" the slot table — it renders INSTEAD OF the entire dashboard layout when `[a]` is pressed (App.tsx conditional return, not a slot child). See UX-DR6.

---

## Per-Peer Table Degrade Ladder (Story 48.2)

The `<PeerTableSlot />` (4-row budget) degrades column-by-column as terminal width shrinks:

| Width range | Behavior |
|-------------|----------|
| ≥80ch       | Full 5-column layout: PEER · TYPE · ASSET · NET (MONTH) · LAST CLAIM |
| 70–79ch     | Full layout, column widths proportionally narrower |
| <70ch       | TYPE column truncates to first 3 chars via `slice(0,3)` (`tow` / `mil` / `dvm` / `ext`); LAST CLAIM drops ` ago` suffix |
| <60ch       | LAST CLAIM column dropped entirely; 4 columns survive |

Full detail in UX-DR7: `_bmad-output/design/townhouse-tui-per-asset-row.md`.

---

## Cross-References

- Canonical metric tiers + 80×24 row budget: `townhouse-hs-v1-plan-2026-05-07.md:104-154`
- Empty-state copy: `_bmad-output/design/empty-state-copy.md` (UX-DR2)
- Per-asset row stacking: `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7)
- "You're early" badge: `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3)
- Activity overlay: `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6)
- Story spec: `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md`
