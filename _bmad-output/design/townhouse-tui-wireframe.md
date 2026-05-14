# UX-DR1: Townhouse TUI Wireframe

**Upstream spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154`
**Status:** Dev-agent first draft — awaiting Sally sign-off in PR description.

---

## 80ch Reference Grid

Row budget at 80×24: hero 3 rows + qualifier 1 row + apex slot 1 row + peer slot 4 rows + footer slot 1 row = 10 rows used, 14 rows free.

```
┌──────────────────────────────────────────────────────────────────────────────┐  row 0 (border only for illustration; not rendered)
│ TODAY          MONTH           YEAR            LIFETIME                      │  row 1 — labels (dim-grey)
│ $0.00          $0.00           $0.00           $0.00                         │  row 2 — values (green if >0, default if 0)
│ ·······  7d                                                                  │  row 3 — sparkline (collapses at <60ch)
│ MONTH $0.00 · 0 events relayed · you're early                                │  row 4 — empty-state qualifier (hidden when any month>0)
│                                                                              │  row 5 — [ApexStripSlot reserved for 48.2]
│                                                                              │  rows 6–9 — [PeerTableSlot reserved for 48.2]
│                                                                              │  row 10 — [FooterSlot reserved for 48.4]
└──────────────────────────────────────────────────────────────────────────────┘
```

**Rendered (no borders, actual output at 80ch):**
```
TODAY          MONTH           YEAR            LIFETIME
$0.00          $0.00           $0.00           $0.00
·······  7d
MONTH $0.00 · 0 events relayed · you're early
```

---

## 120ch Reference Grid

At 120 columns the sparkline expands and asset row widens to show more decimal precision context.

```
TODAY              MONTH              YEAR               LIFETIME
$0.00              $0.00              $0.00              $0.00
▁▂▃▄▅▆▇█▁▂▃▄▅▆  7d
MONTH $0.00 · 0 events relayed · you're early
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
| `<ApexStripSlot />` | Story 48.2 apex routing strip | 1 row |
| `<PeerTableSlot />` | Story 48.2 per-peer earnings table | 4 rows |
| `<FooterSlot />`    | Story 48.4 activity ticker | 1 row |

---

## Cross-References

- Canonical metric tiers + 80×24 row budget: `townhouse-hs-v1-plan-2026-05-07.md:104-154`
- Empty-state copy: `_bmad-output/design/empty-state-copy.md` (UX-DR2)
- Story spec: `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md`
