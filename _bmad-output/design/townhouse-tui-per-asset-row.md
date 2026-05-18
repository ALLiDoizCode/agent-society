# UX-DR7: Per-Asset Row Layout (Multi-Chain Stacking)

**Status:** Dev-agent first draft — awaiting Sally sign-off in PR description.
**Story:** `_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md`

---

## Why Multi-Row Stacking

An operator running a Mill peer earns in multiple assets simultaneously — e.g. `USDC-evm` on Ethereum and `USDC-sol` on Solana. If we collapsed these into one row with a summed total, Drew would see a single number and wonder "is that double-counted?" The per-asset row stacking answers that question visually: each asset gets its own row, the PEER and TYPE cells are blank for rows 2+, and the totals are clearly distinct. The operator understands: "this peer earned X from Ethereum routing and Y from Solana routing — those are separate streams."

---

## 80ch Reference Grid

Column widths at 80ch with 5 columns: PEER=16, TYPE=6, ASSET=12, NET(MONTH)=14, LAST CLAIM=12 (remaining chars distributed by `Math.floor(80 / 5) = 16`).

```
PEER            TYPE  ASSET        NET (MONTH)   LAST CLAIM  
ilp.peer.alice  town  USDC         $1.23         2d ago      
ilp.peer.bob    mill  USDC-evm     $0.45         5m ago      
                      USDC-sol     $0.12         5m ago      
```

Notes:
- `PEER` and `TYPE` cells are **empty** on rows 2+ of the same peer group.
- The second and third rows both belong to `ilp.peer.bob` — the stacked layout makes the grouping clear.
- `LAST CLAIM` is the per-peer max across all assets (same value for all rows of the same peer).
- Column headers use `dimColor` (matches hero band `labelDim` token).

---

## 120ch Reference Grid

At 120 columns: `Math.floor(120 / 5) = 24` per column.

```
PEER                    TYPE    ASSET           NET (MONTH)             LAST CLAIM              
ilp.peer.alice          town    USDC            $1.23                   2d ago                  
ilp.peer.bob            mill    USDC-evm        $0.45                   5m ago                  
                                USDC-sol        $0.12                   5m ago                  
ilp.peer.charlie        dvm     USDC            $0.08                   14h ago                 
```

---

## Row-Stacking Rules

1. **Outer order:** peers appear in `peers[]` array order (preserves connector order; operators recognize their peers by position).
2. **Inner order:** within a single peer, asset rows are sorted **alphabetically by assetCode** (e.g. `USDC-evm` before `USDC-sol`).
3. **PEER cell:** shows `peer.id` on the **first asset row** of a peer group; blank string `''` on all subsequent rows.
4. **TYPE cell:** shows `peer.type` on the **first asset row** of a peer group; blank string `''` on all subsequent rows.
5. **Row budget:** the table caps at **4 data rows total** (1 header + 4 data = 5 rows). A peer with 3 assets consumes 3 of the 4 data row slots. Rows beyond 4 are silently truncated (scroll support deferred to v0.5+).
6. **Empty peers:** when `peers.length === 0`, the header row is replaced by a single dim row showing `COPY.peerTable.empty`.

---

## Degrade Ladder

As terminal columns shrink, the per-peer table degrades gracefully:

| Width range | Behavior |
|-------------|----------|
| ≥80ch       | Full 5-column layout (PEER · TYPE · ASSET · NET (MONTH) · LAST CLAIM) |
| 70–79ch     | Full layout, column widths narrower |
| <70ch       | TYPE column truncates to **first 3 chars** via `slice(0,3)` (`tow` / `mil` / `dvm` / `ext`); LAST CLAIM drops the ` ago` suffix (shows `3m`, `2d`, `14h`) |
| <60ch       | LAST CLAIM column **dropped entirely** (4 columns survive: PEER · TYPE · ASSET · NET (MONTH)) |

Degrade rule: **time suffix drops first** (decorative), **LAST CLAIM column drops second**, **PEER/TYPE/ASSET/NET columns never disappear**.

---

## Cross-References

- **UX-DR1:** `_bmad-output/design/townhouse-tui-wireframe.md` — overall TUI layout and row budget
- **UX-DR2:** `_bmad-output/design/empty-state-copy.md` — `COPY.peerTable.empty` and `COPY.peerTable.lastClaimNever`
- **Story spec:** `_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md` (AC #5, AC #6, AC #10)
- **Wire shape:** `packages/townhouse/src/earnings/aggregator.ts:32-78` (NodeEarnings, PerAsset)
