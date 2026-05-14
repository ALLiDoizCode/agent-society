# Story 48.2: Two-Bucket Earnings Display (Apex + Per-Peer Table)

Status: done

> **Second story of Epic 48 (Operator Dashboard / Ink TUI).** Sized M. Mounts the apex routing-fee strip and the per-peer earnings table — the two real components that fill the `<ApexStripSlot />` (1 row) and `<PeerTableSlot />` (4 rows) reservations Story 48.1 carved out in `App.tsx`. After this story, Drew sees "the connector earned $X routing, my Town earned $Y relaying" as two distinct buckets, with an `(enable mill to route)` upsell when the apex bucket is empty AND multi-asset row stacking (UX-DR7) for peers with more than one assetCode. Unblocks 48.3 (badge mounts in hero alongside these new strips), 48.4 (footer slot replaces the existing reservation), and 48.7 (live gate asserts both buckets render against a real apex).
>
> **Critical path:** Epic 47 (DONE — `/api/earnings` wire shape locked) → 48.1 (DONE — scaffold + hero + slots reserved) → **48.2 (this — apex strip + per-peer table mount into slots)** → 48.3 (badge in hero region) → 48.4 (footer slot + activity overlay) → 48.7 (live gate).
>
> **Data-source contract is FROZEN — do NOT call `/admin/*` directly.** All TUI data flows through `GET http://127.0.0.1:28090/api/earnings` (Story 47.4). This story consumes EXACTLY the fields Story 47.4 publishes: `apex.routingFees[asset].{lifetime,today,month,year}`, `peers[].id`, `peers[].type` ∈ `{'town','mill','dvm','external'}`, `peers[].byAsset[asset].{lifetime,today,month,year}`, `peers[].lastClaimAt: string | null`. The schema-locked wire is at `packages/townhouse/src/api/schemas/earnings.ts`; the type source is `packages/townhouse/src/earnings/aggregator.ts:32-78`.
>
> **THREE explicit deviations from the epic-spec text (read before drafting).** The epic AC lists columns `PEER · STATUS · ASSET · NET 7d · LAST CLAIM` and sources `LAST CLAIM` from `peers[].byAsset[].lastClaimAt`. The current `/api/earnings` wire shape supports only two of those four data fields verbatim. The deviations + recommended resolutions:
>
> 1. **"STATUS" column → "TYPE" column** — `/api/earnings` exposes `peer.type` (`'town' | 'mill' | 'dvm' | 'external'`), NOT a runtime health/phase status. Adding `/health` polling would violate the AC #7 "no `/admin/*`" contract. **Resolution:** rename the column header to `TYPE` and render `peer.type` verbatim. Real status comes from a future v0.5+ story when per-peer `/health` is plumbed into `/api/earnings` (open-question deferred to Epic 50 backlog).
> 2. **"NET 7d" column → "NET (MONTH)" column** — `aggregator.ts` ships `today / month / year / lifetime` windows only (Story 47.3 delta computer). There is NO 7-day window. **Resolution:** rename the column header to `NET (MONTH)` and use `byAsset[asset].month`. The plan doc's "NET 7d" text is a column-name placeholder from a 2026-04-20 sketch that pre-dates 47.3's window contract. Documenting the rename in this story's Dev Notes; a 7-day window is a v0.5+ extension.
> 3. **`peers[].byAsset[].lastClaimAt` → `peers[].lastClaimAt`** — the aggregator output drops per-asset `lastClaimAt` in favor of a per-peer max across assets (see `aggregator.ts:221-230`). **Resolution:** all asset rows for the same peer share the same `LAST CLAIM` cell value — sourced from `peer.lastClaimAt` (peer-level). Note the deviation in Dev Notes; per-asset `lastClaimAt` is a wire-shape extension out of scope here.
>
> **Net-new design artifact.** This story creates `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) — Sally's locked spec for multi-chain row stacking. The artifact is created by the dev agent in first draft; Sally signs off in PR description with `Sally sign-off (UX-DR7): approved`. NOT a merge gate (the NFR19 gate was 48.1-only); but Sally's review is required before flipping the story to `done`.

## Story

As **Drew (the terminal operator)**,
I want **a one-line apex routing-fee strip below the hero band AND a per-peer table that stacks rows per-asset for multi-chain peers, with an `(enable mill to route)` upsell when the apex bucket is empty**,
so that **I understand "the connector earned $X routing, my Town earned $Y relaying" as two distinct buckets — and a peer earning in BOTH USDC-evm AND USDC-sol shows two rows so I never think the totals are double-counted**.

## Acceptance Criteria

1. **AC #1 — Apex routing-fee strip mounts into `<ApexStripSlot />`.** **Given** the TUI is mounted (Story 48.1) AND `<ApexStripSlot />` exists at `packages/townhouse/src/tui/components/ApexStripSlot.tsx`, **When** the App renders, **Then** the file's body is replaced from `(): null { return null; }` to a real component that renders a single row immediately below the hero band, BEFORE the `<Banner />` row and BEFORE `<PeerTableSlot />`. The row layout MUST stay in one Ink `<Text>` element to keep it a single row at 80×24. Layout slot ordering in `App.tsx` is preserved exactly — `App.tsx` does NOT change beyond the component-body swap inside `ApexStripSlot.tsx` (load-bearing for Story 48.4 footer slot mount).

2. **AC #2 — Apex strip with positive routing fees.** **Given** `apex.routingFees['USDC'].month` parses to a positive decimal-string bigint at scale 6 (e.g. `'1234567'` → `$1.23`), **When** the apex strip renders, **Then** the row shows `↳ apex routing: $X.XX (Y%)` where `X.XX` is the USDC-formatted month value AND `Y%` is `(apex.month / total.month) * 100` floored to the nearest integer (uses BigInt arithmetic; rendered as `Y%`, e.g. `35%`). The percentage denominator `total.month` = sum of `apex.routingFees['USDC'].month` + every `peer.byAsset['USDC'].month`. If `total.month === 0` (impossible when apex > 0 but defensive) → the `(Y%)` parenthetical is omitted entirely.

3. **AC #3 — Apex strip empty bucket with Mill upsell.** **Given** `apex.routingFees['USDC'].month === '0'` (or `apex.routingFees['USDC']` is absent) AND no peer with `type === 'mill'` exists in `peers[]`, **When** the apex strip renders, **Then** the row shows `↳ apex routing: $0.00 (enable mill to route)` rendered with `<Text dimColor italic>` (italic via Ink's `italic` prop on `<Text>` — degrades to dim on terminals without italic support). The upsell text is sourced from `COPY.future.apexRoutingEmpty` (already populated by Story 48.1 at `tui/copy.ts:13`) — this story **promotes** that token into the active `COPY.apex.routingEmpty` namespace AND removes it from `COPY.future` (the copy-sync test still passes because the markdown is updated in lockstep).

4. **AC #4 — Apex strip empty bucket with Mill already enabled (no upsell).** **Given** `apex.routingFees['USDC'].month === '0'` AND at least one `peer.type === 'mill'` exists in `peers[]`, **When** the apex strip renders, **Then** the row shows `↳ apex routing: $0.00` only — no `(enable mill to route)` parenthetical (Mill is already enabled; the upsell would be redundant noise). The empty-state phrasing is conditional on Mill peer absence, NOT on `apex.month === 0` alone.

5. **AC #5 — Per-peer table mounts into `<PeerTableSlot />`.** **Given** `<PeerTableSlot />` at `packages/townhouse/src/tui/components/PeerTableSlot.tsx`, **When** the App renders AND `peers.length > 0`, **Then** the file's body renders a 5-column table with header row + up to 4 data rows: `PEER · TYPE · ASSET · NET (MONTH) · LAST CLAIM`. Column-header row uses `<Text dimColor>` (matches hero band token `labelDim`). Header is fixed across renders; data rows recompute every refresh tick. Row budget at 80×24 stays at exactly **5 rows total** (1 header + 4 data) per the wireframe row reservation — when more than 4 data rows would render, the first 4 are shown and the 5th onward is truncated silently (scrollable in a follow-up; this story does NOT add scroll support).

6. **AC #6 — Multi-asset row stacking (UX-DR7).** **Given** a single peer with multiple assets in `byAsset` (e.g. `{ 'USDC-evm': {...}, 'USDC-sol': {...} }`), **When** the per-peer table renders, **Then** each asset is its own ROW under the same `peers[].id` — the `PEER` and `TYPE` cells show empty strings for every row after the first asset row for that peer (read top-to-bottom, the peer-id and type "belong to" the first row of the group). Asset rows for the same peer appear contiguously. Sort order: peers in `peers[]` array order (preserves connector order); within a peer, asset rows alphabetically by assetCode. The 4-row data budget counts every asset row independently (a peer with 3 assets consumes 3 of the 4 data row slots).

7. **AC #7 — All data sourced from `/api/earnings` only.** **Given** the apex strip + per-peer table components, **When** they receive props, **Then** every value comes from the `useEarnings()` hook's `AggregatedEarnings` payload (i.e. `state.data.apex` + `state.data.peers`). The components MUST NOT import from `../connector/`, `../earnings/aggregator.js` (except for type re-exports via `tui/types.js`), `../api/routes/`, or any `/admin/*` HTTP path. Verify via a static-import test (`tui-import-boundary.test.ts`) that the new component files have ZERO imports from those paths. The TUI is a renderer; the API is the contract.

8. **AC #8 — `LAST CLAIM` column as relative time.** **Given** `peer.lastClaimAt` is an ISO-8601 string OR `null`, **When** the per-peer table renders, **Then** the cell shows relative time (`3m ago`, `2d ago`, `14h ago`) computed via a new helper `formatRelativeTime(iso: string, now: Date): string` at `packages/townhouse/src/tui/format.ts` (extending the existing `format.ts` module — same file, alongside `formatUsdc`). When `peer.lastClaimAt === null` → cell shows `—` (em-dash, single character). When `Date.parse(iso)` returns NaN (malformed wire) → cell shows `?` (single question mark, defensive). The relative-time helper uses ranges: `<60s` → `<1m ago`, `<60m` → `Nm ago`, `<24h` → `Nh ago`, `<30d` → `Nd ago`, else `Nmo ago` (truncates, does NOT round). `now` is injected via prop (default `new Date()`) so tests pin a stable "now" without `vi.setSystemTime`.

9. **AC #9 — Empty per-peer table renders empty-state copy.** **Given** `peers.length === 0` (apex-only boot — day-one Drew), **When** the per-peer table renders, **Then** the header row is replaced by a single dim row showing `COPY.peerTable.empty` (promoted from `COPY.future.peerTableEmpty` per AC #3). The row is rendered as `<Text dimColor>` matching the apex-strip empty styling. Empty-state copy MUST come from `copy.ts` — no inline strings (smoke check from Story 48.1 AC #9 extends to this story's component files: the no-hardcoded-copy test at `hero-band.test.tsx:70-79` scans `tui/*.tsx`, which now includes the renamed slot files).

10. **AC #10 — Column-width degrade at narrow terminals.** **Given** the per-peer table renders, **When** `useStdout().stdout.columns < 80`, **Then** column widths shrink proportionally (the existing `Math.max(Math.floor(columns / N), MIN_COL_WIDTH)` pattern from `HeroBand.tsx:97` is the template). When `columns < 70` → `TYPE` column truncates to first 3 chars (`twn` / `mil` / `dvm` / `ext`) AND `LAST CLAIM` shows the numeric value only (`3m`, `2d`) WITHOUT the trailing `ago`. When `columns < 60` → `LAST CLAIM` column is dropped entirely (4 columns survive). The degrade ladder is documented in the new UX-DR7 artifact AND in `_bmad-output/design/townhouse-tui-wireframe.md` (update — append a "Per-Peer Table Degrade Ladder" section).

11. **AC #11 — Unit-test surface coverage.** **Given** the new component sources, **When** `pnpm --filter @toon-protocol/townhouse test` runs, **Then** the suite asserts:
    - `<ApexStrip />` renders `↳ apex routing: $1.23 (35%)` when `apex.month='1234567'`, total month sums to `'3527000'` (1234567 / 3527000 = 0.349... → 34%). [Pin the integer-floor behavior with a sample where the answer differs between floor and round.]
    - `<ApexStrip />` renders `↳ apex routing: $0.00 (enable mill to route)` when apex=0 AND no Mill peer exists.
    - `<ApexStrip />` renders `↳ apex routing: $0.00` (no upsell parenthetical) when apex=0 AND a Mill peer exists.
    - `<ApexStrip />` percentage parenthetical omits when `total.month === 0` (defensive edge).
    - `<PeerTable />` renders 1 header + 1 data row for one peer with one asset.
    - `<PeerTable />` renders 1 header + 3 data rows for one peer with 3 assets; rows 2-3 have empty `PEER` and `TYPE` cells (UX-DR7 stacking).
    - `<PeerTable />` truncates to 4 data rows when the peer/asset cross-product exceeds 4.
    - `<PeerTable />` renders `COPY.peerTable.empty` row when `peers.length === 0`.
    - `formatRelativeTime('2026-05-14T11:55:00Z', new Date('2026-05-14T12:00:00Z'))` → `'5m ago'`.
    - `formatRelativeTime('2026-05-12T12:00:00Z', new Date('2026-05-14T12:00:00Z'))` → `'2d ago'`.
    - `formatRelativeTime` returns `—` for null AND `?` for NaN-parse input.
    - `<PeerTable />` column-truncate behavior at width 65 (TYPE → 3 chars, LAST CLAIM drops "ago") AND width 55 (LAST CLAIM column dropped entirely).
    - `tui-import-boundary.test.ts` asserts the new component files import ONLY from `react`, `ink`, `../copy.js`, `../format.js`, `../types.js`, `./...` (sibling components) — NOT from `../../connector/`, `../../earnings/`, `../../api/`.
    Per the project's TUI testing rule (`townhouse-hs-v1-plan-2026-05-07.md:306-309`): **DO test** data → render mapping, keybind → state transitions, error states. **DON'T test** terminal resize, color output, animation timing.

12. **AC #12 — No regression on Story 48.1 contracts.** **Given** Story 48.1's invariants, **When** this story lands, **Then**: (a) `App.tsx` is touched ONLY to keep slot ordering identical (the body of `App.tsx`'s `return` block is unchanged at the JSX level — the slot components do all the work); (b) `<HeroBand />` still renders unchanged (`hero-band.test.tsx` passes verbatim); (c) the empty-state qualifier still hides when ANY `month > 0` (Story 48.1 AC #4) — the new apex strip's `month > 0` propagates correctly into the hero's `isEmptyState` check by sharing the same source data; (d) the 2-second refresh tick (Story 48.1 AC #5) is unchanged; (e) `mountTui()` signature is unchanged — no new props leak to `App.tsx`'s `AppProps`; (f) the copy-sync test (`copy-sync.test.ts`) still passes after the `COPY.future.*` → `COPY.apex.*` / `COPY.peerTable.*` promotions (markdown updated in lockstep).

13. **AC #13 — UX-DR7 design artifact created.** **Given** the multi-asset row layout decision, **When** this PR is reviewed, **Then** `_bmad-output/design/townhouse-tui-per-asset-row.md` exists with: (a) ASCII grid of the 5-column table at 80ch + 120ch; (b) per-asset row-stacking rules (peer/type cells empty on rows 2+); (c) sort order (peer-array order outer, alphabetical assetCode inner); (d) per-peer table degrade ladder (mirrors AC #10); (e) cross-reference to `townhouse-tui-wireframe.md` (UX-DR1). The dev agent drafts; Sally signs off in the PR description with the verbatim string `Sally sign-off (UX-DR7): approved`. **This is NOT a merge gate (NFR19 was 48.1-scoped), but the story cannot flip to `done` without the sign-off line in the PR description.**

**FRs:** FR21 (Two-bucket display: apex routing fees + per-peer table), FR22 (Empty apex bucket shows "(enable mill to route)" upsell).
**UX-DRs:** UX-DR7 (Per-asset row layout — multi-chain stacking).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` end-to-end. Story 48.1's Dev Notes (especially "Slot Pattern — How 48.2 / 48.4 Mount" and "Asset Filter — USDC Only in v1") are load-bearing — they encode the contracts this story honors. The Review Findings section (P19's no-hardcoded-copy scan extension, P6's `MIN_COL_WIDTH=8` clamp, P10's `shortLabels` collapse pattern) is the precedent for this story's component-level patterns.
  - [x] 1.2 Read `packages/townhouse/src/tui/App.tsx` end-to-end (~40 lines). Confirm the slot ordering: `<HeroBand />` → `<Banner />` → `<ApexStripSlot />` → `<PeerTableSlot />` → `<FooterSlot />`. **This story does NOT modify `App.tsx`** — every change happens inside the two slot component files.
  - [x] 1.3 Read `packages/townhouse/src/tui/components/HeroBand.tsx` end-to-end (~125 lines). The HeroBand's `useStdout()` column-width pattern (`HeroBand.tsx:81-82, 92, 97`) is the template for AC #10 (per-peer table degrade ladder). The `addDecimalStrings()` helper at `HeroBand.tsx:13-22` is the BigInt-safe accumulator pattern — reuse the same defensive `DECIMAL_RE.test(b)` + try/catch posture in the apex strip's total-month computation.
  - [x] 1.4 Read `packages/townhouse/src/tui/components/ApexStripSlot.tsx` (1 line) + `packages/townhouse/src/tui/components/PeerTableSlot.tsx` (1 line) + `packages/townhouse/src/tui/components/FooterSlot.tsx` (1 line). Confirm all three are stub fragments today. This story replaces the BODIES of ApexStripSlot.tsx and PeerTableSlot.tsx; FooterSlot.tsx is Story 48.4's territory and is NOT touched.
  - [x] 1.5 Read `packages/townhouse/src/tui/use-earnings.ts` end-to-end (~115 lines). Confirm the `EarningsState` union — `'loading' | 'ok' | 'stale'` — and that `state.data` is `null` only in `'loading'`. The new slot components receive `apex` + `peers` as props from `App.tsx` (which only renders them after the `phase === 'loading'` early return) — so the slot components never need to handle null `data`.
  - [x] 1.6 Read `packages/townhouse/src/tui/copy.ts` end-to-end (~17 lines). The promotion plan: `COPY.future.apexRoutingEmpty` → `COPY.apex.routingEmpty` AND `COPY.future.peerTableEmpty` → `COPY.peerTable.empty`. Leave `COPY.future.recentClaimsEmpty` untouched (Story 48.4's territory). Update `_bmad-output/design/empty-state-copy.md`'s table at lines 117-121 in lockstep so `copy-sync.test.ts` continues passing.
  - [x] 1.7 Read `packages/townhouse/src/tui/format.ts` end-to-end (~28 lines). The new `formatRelativeTime()` helper lives in the SAME file (one module per concern — formatting), alongside `formatUsdc`. Mirror the `NODE_ENV` defensive posture (`'development' | 'test'` throw vs production fallback) — but for relative-time the fallback is `'?'` not `'$?.??'`.
  - [x] 1.8 Read `packages/townhouse/src/tui/copy-sync.test.ts` end-to-end (~40 lines). The test uses `markdown.includes(value)` (substring match — W15 deferred). Adding tokens to COPY requires adding them to the markdown's "Copy Token Reference" table. The recursive `getLeafStrings()` walker handles nested namespaces (`COPY.apex.routingEmpty`) automatically.
  - [x] 1.9 Read `packages/townhouse/src/api/schemas/earnings.ts` end-to-end (~120 lines). Confirm the schema-locked fields this story consumes: `apex.routingFees` (object), `peers[].id` (string), `peers[].type` (enum), `peers[].byAsset` (object), `peers[].lastClaimAt` (string-or-null). All amount fields use `pattern: '^-?\\d+$'`.
  - [x] 1.10 Read `packages/townhouse/src/earnings/aggregator.ts:32-78` end-to-end (the `PerAsset` + `NodeEarnings` + `AggregatedEarnings` interfaces). Confirm there is NO `peers[].byAsset[].lastClaimAt` field on the wire (deviation #3 in the header note). The aggregator's `lastClaimAt` reduce at `aggregator.ts:221-230` is the SOURCE of the per-peer `lastClaimAt`. All asset rows for the same peer share this value.
  - [x] 1.11 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1044-1081` (Epic 48 Story 48.2 spec). Confirm this story's AC text matches the epic spec verbatim where possible AND that the three deviations (STATUS→TYPE, NET 7d→NET MONTH, byAsset[].lastClaimAt→peer.lastClaimAt) are documented as deviations rather than silent drift.
  - [x] 1.12 Read `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154` (canonical TUI design spec). The "Authoritative metrics catalog" at lines 130-141 lists `peers[].byAsset[].lastClaimAt` as the source for "Per-peer last claim" — this entry pre-dates the 47.4 wire-shape lock and is wrong; the actual wire is `peer.lastClaimAt` (per-peer). Document the catalog-doc divergence in this story's Dev Notes (not a fix here — the plan doc is a planning artifact, not a contract).
  - [x] 1.13 Read `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) end-to-end (~98 lines). The "Layout Slots (Reserved)" section names `<ApexStripSlot />` (1 row) and `<PeerTableSlot />` (4 rows) — confirm the row budget. Append the new "Per-Peer Table Degrade Ladder" section per AC #10 (Task 4.2).
  - [x] 1.14 Read `_bmad-output/design/empty-state-copy.md` (UX-DR2) end-to-end (~131 lines). The "Future-State Placeholders" section (lines 68-85) names the upsell copy this story promotes. The "Copy Token Reference" table (lines 117-121) lists the `COPY.future.*` paths — update entries for the promoted tokens (Task 4.4).
  - [x] 1.15 Run `find packages/townhouse/src/tui -type f` to confirm the directory structure from Story 48.1 — should show the 22 files (components/*, hooks, format, copy, etc.). No new directories needed; new files land in `tui/components/` and `tui/`.
  - [x] 1.16 Run `grep -rn "ApexStripSlot\\|PeerTableSlot" packages/townhouse/src` to confirm `App.tsx` is the ONLY consumer. The replacement is body-only (file paths stable for import-graph consumers).

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation: done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent → STOP.
  - [x] 2.2 Confirm `47-4-get-api-earnings-two-bucket-endpoint: done` AND `47-5-live-e2e-gate-earnings-data-plane: done`. The wire shape this story consumes is the same wire 47.5 proved against a live apex.
  - [x] 2.3 `pnpm --filter @toon-protocol/townhouse build` is clean baseline. Capture the current test count from `pnpm --filter @toon-protocol/townhouse test` — expected 1070 after 48.1's +19 delta closed. Net delta target for this story: **+18 to +28 tests** (apex-strip ~5, peer-table ~8, format-relative-time ~5, import-boundary ~2, copy-sync deltas ~0 — the sync test just continues passing).
  - [x] 2.4 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm 43 tests pass sub-500ms. This story does NOT touch the canary; the count must be unchanged at story close.
  - [x] 2.5 Confirm `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) and `_bmad-output/design/empty-state-copy.md` (UX-DR2) exist (Story 48.1 close-out gate). They are required upstream context for the UX-DR7 artifact this story creates.
  - [x] 2.6 Verify no in-flight branch is touching `tui/components/ApexStripSlot.tsx` or `tui/components/PeerTableSlot.tsx` or `tui/copy.ts`: `gh pr list --state open --search "tui OR apex OR peer-table"`. Coordinate with anyone who is.

- [x] **Task 3: Promote COPY tokens + update empty-state-copy.md (AC: 3, 9, 12)**
  - [x] 3.1 Edit `packages/townhouse/src/tui/copy.ts`:
    - Add new namespace `apex: { routingPrefix: '↳ apex routing: ', routingEmpty: '(enable mill to route)' } as const`.
    - Add new namespace `peerTable: { empty: "no peers yet — run 'townhouse node add town'", lastClaimNever: '—' } as const`.
    - Remove `future.apexRoutingEmpty` and `future.peerTableEmpty` from `COPY.future` (leave `future.recentClaimsEmpty` for Story 48.4).
    - All other COPY entries unchanged.
  - [x] 3.2 Edit `_bmad-output/design/empty-state-copy.md`:
    - In the "Future-State Placeholders" section (lines 68-85), MOVE the "Apex routing empty" and "Per-peer table empty" entries OUT of "Future-State Placeholders" and into a new top-level section "## Apex + Per-Peer Table Copy (Story 48.2)" placed AFTER "## Stale Data Hint".
    - Leave "Recent claims empty" inside "Future-State Placeholders" (Story 48.4 still owns it).
    - In the "Copy Token Reference" table (lines 117-121), update the rows:
      - `COPY.apex.routingPrefix` → `↳ apex routing: `
      - `COPY.apex.routingEmpty` → `(enable mill to route)`
      - `COPY.peerTable.empty` → `no peers yet — run 'townhouse node add town'`
      - `COPY.peerTable.lastClaimNever` → `—`
      - Remove old `COPY.future.apexRoutingEmpty` and `COPY.future.peerTableEmpty` rows.
  - [x] 3.3 Run `pnpm --filter @toon-protocol/townhouse test src/tui/copy-sync.test.ts` — confirm the sync test still passes after the promotion + markdown update.

- [x] **Task 4: Create UX-DR7 design artifact + extend UX-DR1 (AC: 6, 10, 13)**
  - [x] 4.1 Create `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7). Required sections:
    - **Frontmatter** — title "UX-DR7: Per-Asset Row Layout (Multi-Chain Stacking)" + "Status: Dev-agent first draft — awaiting Sally sign-off in PR description."
    - **80ch reference grid** — ASCII art of the 5-column table with a 2-asset peer stacked across 2 rows. Use real column widths (PEER ~15, TYPE ~6, ASSET ~12, NET (MONTH) ~14, LAST CLAIM ~12). Show that PEER + TYPE cells are empty on the second row of the same peer.
    - **120ch reference grid** — same table at 120 columns; column widths widen proportionally.
    - **Row-stacking rules** — verbatim from AC #6: peers in `peers[]` array order outer; asset rows alphabetical by assetCode inner; PEER + TYPE cells empty on rows 2+ of a peer group.
    - **Degrade ladder** — verbatim from AC #10: `<70ch` truncates TYPE to 3 chars + drops "ago" suffix; `<60ch` drops LAST CLAIM column entirely.
    - **Why multi-row stacking** — short paragraph explaining the operator mental model ("a peer earning in USDC-evm AND USDC-sol shows two rows so totals are not double-counted").
    - **Cross-references** — `townhouse-tui-wireframe.md` (UX-DR1), `empty-state-copy.md` (UX-DR2), this story file.
  - [x] 4.2 Append a new section "## Per-Peer Table Degrade Ladder (Story 48.2)" to `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1). Include the same AC #10 degrade rules so a Sally-side reader of UX-DR1 sees the peer-table-specific behavior without context-switching to UX-DR7.
  - [x] 4.3 Tag Sally in the PR description with `Sally sign-off (UX-DR7): approved` placeholder. Story does NOT flip to `done` without this line.

- [x] **Task 5: Build `formatRelativeTime()` helper (AC: 8, 11)**
  - [x] 5.1 Add `formatRelativeTime(iso: string | null, now: Date = new Date()): string` to `packages/townhouse/src/tui/format.ts`. Implementation:
    ```typescript
    export function formatRelativeTime(iso: string | null, now: Date = new Date()): string {
      if (iso === null) return '—';
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return '?';
      const deltaSec = Math.floor((now.getTime() - ms) / 1000);
      if (deltaSec < 60) return '<1m ago';
      if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
      if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
      if (deltaSec < 2_592_000) return `${Math.floor(deltaSec / 86_400)}d ago`;
      return `${Math.floor(deltaSec / 2_592_000)}mo ago`;
    }
    ```
    Truncates (does NOT round) — mirrors `formatUsdc` posture. Negative deltas (`iso` in the future) treat as `<1m ago` (defensive — wire-shape regression should not crash the render path).
  - [x] 5.2 Add `packages/townhouse/src/tui/format.test.ts` cases (extending the existing file, NOT a new file):
    - `formatRelativeTime(null, ...)` → `'—'`.
    - `formatRelativeTime('not-an-iso', ...)` → `'?'`.
    - `formatRelativeTime('2026-05-14T11:59:30Z', new Date('2026-05-14T12:00:00Z'))` → `'<1m ago'`.
    - `formatRelativeTime('2026-05-14T11:55:00Z', new Date('2026-05-14T12:00:00Z'))` → `'5m ago'`.
    - `formatRelativeTime('2026-05-14T10:00:00Z', new Date('2026-05-14T12:00:00Z'))` → `'2h ago'`.
    - `formatRelativeTime('2026-05-12T12:00:00Z', new Date('2026-05-14T12:00:00Z'))` → `'2d ago'`.
    - `formatRelativeTime('2026-02-14T12:00:00Z', new Date('2026-05-14T12:00:00Z'))` → `'2mo ago'`.
    - Negative delta (future ISO): `formatRelativeTime('2026-05-14T12:01:00Z', new Date('2026-05-14T12:00:00Z'))` → `'<1m ago'`.

- [x] **Task 6: Build `<ApexStrip />` component (AC: 1, 2, 3, 4, 11)**
  - [x] 6.1 Replace the body of `packages/townhouse/src/tui/components/ApexStripSlot.tsx`. Keep the export name `ApexStripSlot` (load-bearing for `App.tsx`'s import).
  - [x] 6.2 Move the real implementation into a new file `packages/townhouse/src/tui/components/ApexStrip.tsx` (the actual component logic — readable name) AND export it through `ApexStripSlot.tsx` (preserves the slot-pattern naming from Story 48.1):
    ```tsx
    // ApexStrip.tsx — real implementation
    import { Box, Text } from 'ink';
    import type { ReactElement } from 'react';
    import type { AggregatedEarnings } from '../types.js';
    import { formatUsdc } from '../format.js';
    import { COPY } from '../copy.js';

    const USDC_SCALE = 6;
    const ASSET = 'USDC';
    const DECIMAL_RE = /^-?\d+$/;

    function addDecimalStrings(a: string, b: string): string {
      if (!DECIMAL_RE.test(b)) return a;
      try { return (BigInt(a) + BigInt(b)).toString(); } catch { return a; }
    }

    interface ApexStripProps {
      apex: AggregatedEarnings['apex'];
      peers: AggregatedEarnings['peers'];
    }

    export function ApexStrip({ apex, peers }: ApexStripProps): ReactElement {
      const apexMonth = apex.routingFees[ASSET]?.month ?? '0';
      const apexMonthBig = DECIMAL_RE.test(apexMonth) ? BigInt(apexMonth) : 0n;

      let totalMonth = apexMonthBig;
      for (const peer of peers) {
        const peerMonth = peer.byAsset[ASSET]?.month ?? '0';
        if (DECIMAL_RE.test(peerMonth)) totalMonth += BigInt(peerMonth);
      }

      const apexFmt = formatUsdc(apexMonth, USDC_SCALE);
      const hasMillPeer = peers.some((p) => p.type === 'mill');

      if (apexMonthBig === 0n) {
        const upsell = hasMillPeer ? '' : ` ${COPY.apex.routingEmpty}`;
        return (
          <Text dimColor italic>
            {COPY.apex.routingPrefix}{apexFmt}{upsell}
          </Text>
        );
      }

      const pct = totalMonth === 0n
        ? null
        : Number((apexMonthBig * 100n) / totalMonth);
      return (
        <Text>
          {COPY.apex.routingPrefix}{apexFmt}{pct !== null ? ` (${pct}%)` : ''}
        </Text>
      );
    }
    ```
  - [x] 6.3 Update `ApexStripSlot.tsx` to read props from a context OR re-engineer how slot components receive data. **Decision point (read carefully):** the original slot was `(): null` — it accepted no props. To pass `apex` + `peers` from `App.tsx`, we have two options:
    - **Option A (recommended):** Modify `App.tsx` to pass props to the slot components: `<ApexStripSlot apex={data.apex} peers={data.peers} />`. This is a SMALL change but it DOES touch `App.tsx` (one line per slot). **AC #12 (a) says "App.tsx is touched ONLY to keep slot ordering identical" — clarify that prop-passing is the intended minimal change AND is the expected pattern. Update Story 48.1's slot-pattern claim accordingly in the Dev Notes.**
    - **Option B:** Use React Context — `App.tsx` wraps the slot block in `<EarningsContext.Provider value={data}>` and each slot reads via `useContext`. More boilerplate, slightly cleaner prop drilling story. **Rejected for v1** — one level of prop drilling does not justify a context.
    
    Pick **Option A**. The change to `App.tsx`:
    ```tsx
    <ApexStripSlot apex={data.apex} peers={data.peers} />
    <PeerTableSlot peers={data.peers} />
    <FooterSlot />
    ```
    `FooterSlot` keeps its prop-less signature (Story 48.4's territory; this story does not predict its needs).
  - [x] 6.4 Rewrite `ApexStripSlot.tsx` to re-export `<ApexStrip />` with the slot name:
    ```tsx
    // ApexStripSlot.tsx — load-bearing import name preserved for App.tsx
    export { ApexStrip as ApexStripSlot } from './ApexStrip.js';
    ```
  - [x] 6.5 Add `packages/townhouse/src/tui/components/ApexStrip.test.tsx` with 5 cases (AC #11 first 4 bullets + a percentage-floor test): apex>0 with mixed peers (asserts `(34%)` not `(35%)` for the floor edge — used 1234567/3537440 = 0.34908, not 3527000); apex=0 + no Mill peer (upsell); apex=0 + Mill peer present (no upsell); apex>0 with no peers + 0 totalMonth defensive (the `pct === null` parenthetical-omit branch); USDC asset filter (a peer with only `'USDC-sol'` does NOT contribute to apex's percentage denominator). **Note:** story spec had arithmetic error in the floor-edge example (1234567/3527000=0.350, not 0.349) — corrected to 1234567/3537440=0.349 in test.

- [x] **Task 7: Build `<PeerTable />` component (AC: 5, 6, 7, 8, 9, 10, 11)**
  - [x] 7.1 Create `packages/townhouse/src/tui/components/PeerTable.tsx` with the same "slot wraps real component" pattern. The real implementation:
    ```tsx
    // PeerTable.tsx
    import { Box, Text, useStdout } from 'ink';
    import type { ReactElement } from 'react';
    import type { AggregatedEarnings, NodeEarnings, PerAsset } from '../types.js';
    import { formatUsdc, formatRelativeTime } from '../format.js';
    import { COPY } from '../copy.js';

    const USDC_SCALE = 6;
    const MAX_DATA_ROWS = 4;
    const MIN_COL_WIDTH = 6;

    interface AssetRow {
      peerId: string;
      type: string;
      assetCode: string;
      perAsset: PerAsset;
      lastClaimAt: string | null;
      isFirstRowOfPeer: boolean;
    }

    function flattenPeers(peers: NodeEarnings[]): AssetRow[] {
      const out: AssetRow[] = [];
      for (const peer of peers) {
        const assetCodes = Object.keys(peer.byAsset).sort();
        if (assetCodes.length === 0) continue;
        let isFirst = true;
        for (const assetCode of assetCodes) {
          const perAsset = peer.byAsset[assetCode];
          if (perAsset === undefined) continue;
          out.push({
            peerId: peer.id,
            type: peer.type,
            assetCode,
            perAsset,
            lastClaimAt: peer.lastClaimAt,
            isFirstRowOfPeer: isFirst,
          });
          isFirst = false;
        }
      }
      return out;
    }

    interface PeerTableProps {
      peers: AggregatedEarnings['peers'];
      now?: Date;
    }

    export function PeerTable({ peers, now = new Date() }: PeerTableProps): ReactElement {
      const { stdout } = useStdout();
      const columns = stdout?.columns ?? 80;

      const rows = flattenPeers(peers).slice(0, MAX_DATA_ROWS);

      if (rows.length === 0) {
        return <Text dimColor>{COPY.peerTable.empty}</Text>;
      }

      const showLastClaim = columns >= 60;
      const shortType = columns < 70;
      const dropAgoSuffix = columns < 70;

      const totalCols = showLastClaim ? 5 : 4;
      const colWidth = Math.max(Math.floor(columns / totalCols), MIN_COL_WIDTH);

      const header = (
        <Box>
          <Box width={colWidth}><Text dimColor>PEER</Text></Box>
          <Box width={colWidth}><Text dimColor>TYPE</Text></Box>
          <Box width={colWidth}><Text dimColor>ASSET</Text></Box>
          <Box width={colWidth}><Text dimColor>NET (MONTH)</Text></Box>
          {showLastClaim ? <Box width={colWidth}><Text dimColor>LAST CLAIM</Text></Box> : null}
        </Box>
      );

      return (
        <Box flexDirection="column">
          {header}
          {rows.map((row, i) => {
            const peerCell = row.isFirstRowOfPeer ? row.peerId : '';
            const typeCell = row.isFirstRowOfPeer ? (shortType ? row.type.slice(0, 3) : row.type) : '';
            const netFmt = formatUsdc(row.perAsset.month, USDC_SCALE);
            let lastClaim = formatRelativeTime(row.lastClaimAt, now);
            if (dropAgoSuffix && lastClaim.endsWith(' ago')) {
              lastClaim = lastClaim.slice(0, -' ago'.length);
            }
            return (
              <Box key={`${row.peerId}-${row.assetCode}-${i}`}>
                <Box width={colWidth}><Text>{peerCell}</Text></Box>
                <Box width={colWidth}><Text>{typeCell}</Text></Box>
                <Box width={colWidth}><Text>{row.assetCode}</Text></Box>
                <Box width={colWidth}><Text>{netFmt}</Text></Box>
                {showLastClaim ? <Box width={colWidth}><Text>{lastClaim}</Text></Box> : null}
              </Box>
            );
          })}
        </Box>
      );
    }
    ```
  - [x] 7.2 Rewrite `PeerTableSlot.tsx` as a re-export shim: `export { PeerTable as PeerTableSlot } from './PeerTable.js';`
  - [x] 7.3 Update `App.tsx` to pass props to the slot components per Task 6.3's Option A. The diff is exactly:
    ```diff
    -      <ApexStripSlot />
    -      <PeerTableSlot />
    +      <ApexStripSlot apex={data.apex} peers={data.peers} />
    +      <PeerTableSlot peers={data.peers} />
          <FooterSlot />
    ```
  - [x] 7.4 Add `packages/townhouse/src/tui/components/PeerTable.test.tsx` with cases (AC #11 bullets 5-8 + 12): 1 header + 1 data row for one peer with one asset; 1 header + 3 data rows for one peer with 3 assets (rows 2-3 have empty PEER/TYPE cells); truncates to 4 data rows when input has 6; empty `peers[]` renders `COPY.peerTable.empty` row; width 65 (TYPE → first 3 chars = 'tow' not 'twn' per correct slice(0,3) of 'town'; story spec had a typo); width 55 (LAST CLAIM column entirely absent).

- [x] **Task 8: Add import-boundary test (AC: 7, 11)**
  - [x] 8.1 Create `packages/townhouse/src/tui/tui-import-boundary.test.ts`:
    ```typescript
    import { describe, it, expect } from 'vitest';
    import { readFileSync, readdirSync } from 'node:fs';
    import { resolve, dirname, join } from 'node:path';
    import { fileURLToPath } from 'node:url';

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const COMPONENTS_DIR = resolve(__dirname, 'components');

    const FORBIDDEN_IMPORT_PREFIXES = [
      '../../connector/',
      '../../earnings/',
      '../../api/',
      '../../docker/',
      '../../registry/',
      '../../wallet/',
      '../../state/',
    ];

    describe('TUI component import boundary', () => {
      it('component files import only from react/ink/copy/format/types/sibling components', () => {
        const componentFiles = readdirSync(COMPONENTS_DIR)
          .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
        for (const file of componentFiles) {
          const source = readFileSync(join(COMPONENTS_DIR, file), 'utf-8');
          for (const forbidden of FORBIDDEN_IMPORT_PREFIXES) {
            expect(
              source.includes(`from '${forbidden}`),
              `${file} imports from forbidden path '${forbidden}'`
            ).toBe(false);
          }
        }
      });
    });
    ```
    This guards AC #7 ("data only from `/api/earnings`") by enforcing the import contract — `useEarnings()` is the single egress.

- [x] **Task 9: Tests (AC: 11)**
  - [x] 9.1 Extend `packages/townhouse/src/tui/format.test.ts` with the 8 `formatRelativeTime` cases from Task 5.2. Actually added 10 cases (8 from spec + floor edge + ms-precision).
  - [x] 9.2 Create `packages/townhouse/src/tui/components/ApexStrip.test.tsx` with the 5 cases from Task 6.5.
  - [x] 9.3 Create `packages/townhouse/src/tui/components/PeerTable.test.tsx` with the 6 cases from Task 7.4 (extended to 7 for null lastClaimAt case).
  - [x] 9.4 Create `packages/townhouse/src/tui/tui-import-boundary.test.ts` per Task 8.1.
  - [x] 9.5 Verified hero-band.test.tsx:128-151 no-hardcoded-copy scan reaches `components/*.tsx` (P19 from 48.1 already covered this). All existing tests pass.
  - [x] 9.6 Verified `packages/townhouse/src/tui/copy-sync.test.ts` passes after COPY promotions + markdown updates.
  - [x] 9.7 Full suite passed: **1093/1093** (delta: **+23** tests over 1070 baseline). All 74 test files pass.

- [x] **Task 10: Build, lint, regression sweep**
  - [x] 10.1 `pnpm --filter @toon-protocol/townhouse build` — clean (no typecheck errors). The new `PeerTable.tsx` uses `noUncheckedIndexedAccess`-compatible patterns (`Object.keys` + explicit `=== undefined` guards on `peer.byAsset[assetCode]`).
  - [ ] 10.2 `pnpm lint` — not run (lint at workspace root left for dev to run pre-PR; package-level build passes clean).
  - [x] 10.3 `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — still 43 tests sub-50ms (UNCHANGED).
  - [ ] 10.4 Manual smoke at 80×24: **deferred to dev** — requires live townhouse-dev-infra stack. Dev to confirm before PR merge.
  - [ ] 10.5 Manual smoke at narrow widths: **deferred to dev** — unit tests cover the column-width logic; interactive terminal verification is a dev gate.
  - [ ] 10.6 Manual smoke with multi-asset peer: **deferred to dev** — unit tests cover multi-asset row stacking; interactive verification is a dev gate.

- [x] **Task 11: Story close-out**
  - [x] 11.1 Update `Status: ready-for-dev` → `review` in the story header AND in `sprint-status.yaml`.
  - [x] 11.2 Add the dated `### Review Findings` entry per the close-out checklist.
  - [x] 11.3 Open PR; include `Sally sign-off (UX-DR7): approved` placeholder; tag Sally; await sign-off; do NOT flip to `done` without it (AC #13).

## Dev Notes

### Source-of-Truth Reference Chain

This story's authoritative chain (priority order — if these disagree, the higher one wins):

1. **This story file** — every AC and Task above is the dev agent's contract.
2. **`_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md`** — Story 48.1's Dev Notes, especially "Slot Pattern — How 48.2 / 48.4 Mount", "Asset Filter — USDC Only in v1", and Review Findings P19 (no-hardcoded-copy scan).
3. **`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1044-1081`** — Epic 48 / Story 48.2 spec (AC text). **Three deviations documented** in the header note (STATUS→TYPE, NET 7d→NET MONTH, byAsset[].lastClaimAt→peer.lastClaimAt).
4. **`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154`** — canonical Epic 48 TUI design spec. The "Authoritative metrics catalog" entry at line 134 ("Per-peer last claim | `peers[].byAsset[].lastClaimAt`") pre-dates 47.4's wire-shape lock and is stale — actual wire is `peer.lastClaimAt` (deviation #3).
5. **`packages/townhouse/src/api/schemas/earnings.ts`** — frozen JSON schema for `/api/earnings`. The TUI's wire contract.
6. **`packages/townhouse/src/earnings/aggregator.ts:32-78`** — TypeScript interfaces (`PerAsset`, `NodeEarnings`, `AggregatedEarnings`). The TUI re-exports these via `tui/types.ts`.
7. **`_bmad-output/implementation-artifacts/47-4-get-api-earnings-two-bucket-endpoint.md`** — the `/api/earnings` story Dev Notes; Decision D2 (open subschemas), D4 (regex pattern on amounts), P3 (`clampInt` on `eventsRelayed`).
8. **`_bmad-output/project-context.md`** — coding rules + patterns + conventions (ESM `.js` extensions, `pnpm --filter` instead of root, sub-agent RAM rules).

### Library + Framework Stack

This story introduces **no new dependencies**. Story 48.1 added `ink ^5.0.0` + `react ^18.3.1` + `ink-testing-library ^4.0.0` + `@types/react ^18.3.3`. The apex strip + peer table use the same surface area:

- `<Box>`, `<Text>` — Ink primitives.
- `useStdout()` — Ink hook for column width (same pattern as `HeroBand.tsx:81-82`).
- `formatUsdc()` — existing helper in `tui/format.ts`.
- `formatRelativeTime()` — NEW helper added to `tui/format.ts` (same file, Task 5.1).

**Do NOT add:** any new library. The relative-time logic is small enough to inline (~12 lines). `date-fns`, `dayjs`, `luxon` are all rejected — Story 48.1 banned the `chalk`/`figures` family for the same reason (tree-size cost vs trivial implementation cost).

### File Structure Requirements

**NEW files (this story creates):**

```
packages/townhouse/src/tui/components/
├── ApexStrip.tsx                     # real apex routing-fee component
├── ApexStrip.test.tsx                # 5 cases (AC #11)
├── PeerTable.tsx                     # real per-peer table component
└── PeerTable.test.tsx                # 6 cases (AC #11)

packages/townhouse/src/tui/
└── tui-import-boundary.test.ts       # AC #7 enforcement test

_bmad-output/design/
└── townhouse-tui-per-asset-row.md    # UX-DR7
```

**UPDATE files (this story modifies):**

| File | Change | Reason |
|---|---|---|
| `packages/townhouse/src/tui/components/ApexStripSlot.tsx` | Body becomes `export { ApexStrip as ApexStripSlot } from './ApexStrip.js';` | Task 6.4 |
| `packages/townhouse/src/tui/components/PeerTableSlot.tsx` | Body becomes `export { PeerTable as PeerTableSlot } from './PeerTable.js';` | Task 7.2 |
| `packages/townhouse/src/tui/App.tsx` | Pass `apex` + `peers` props to `<ApexStripSlot>` + `<PeerTableSlot>` (2-line diff) | Task 6.3 / 7.3 |
| `packages/townhouse/src/tui/copy.ts` | Promote `future.apexRoutingEmpty` → `apex.routingEmpty` AND `future.peerTableEmpty` → `peerTable.empty`; add `apex.routingPrefix` + `peerTable.lastClaimNever` | Task 3.1 |
| `packages/townhouse/src/tui/format.ts` | Add `formatRelativeTime()` function | Task 5.1 |
| `packages/townhouse/src/tui/format.test.ts` | Add 8 `formatRelativeTime` cases | Task 5.2 |
| `_bmad-output/design/empty-state-copy.md` | Restructure: move apex + peer-table copy out of "Future-State Placeholders"; update "Copy Token Reference" table | Task 3.2 |
| `_bmad-output/design/townhouse-tui-wireframe.md` | Append "Per-Peer Table Degrade Ladder" section | Task 4.2 |

### Wire Shape Reference (FROZEN — do NOT modify)

The wire is unchanged from Story 48.1's Dev Notes — this story consumes the same shape. Re-stating only the fields this story touches:

```typescript
interface AggregatedEarnings {
  apex: {
    routingFees: Record<assetCode, {
      lifetime: string;   // decimal-string bigint at assetScale decimals
      today: string;
      month: string;
      year: string;
    }>;
  };
  peers: Array<{
    id: string;                              // == connector peerId
    type: 'town' | 'mill' | 'dvm' | 'external';
    byAsset: Record<assetCode, { lifetime, today, month, year }>;
    lastClaimAt: string | null;              // ISO-8601 max across peer's assets, or null
  }>;
}
```

**Critical posture points:**

- All amount fields are **decimal-string bigints**. Use `BigInt(...)` to parse. The dashboard owns scale (USDC = 6, ETH = 18, sats = 0).
- `peer.lastClaimAt` is per-peer (max across the peer's assets). **NOT per-asset** — the aggregator drops per-asset `lastClaimAt` in its reduce. All asset rows for the same peer share this value.
- USDC filter remains v1: the apex strip's percentage denominator is `apex.routingFees['USDC'].month` + every `peer.byAsset['USDC'].month`. Non-USDC apex/peer entries do NOT contribute to the percentage. The per-peer table renders EVERY asset row (multi-chain stacking — that's the UX-DR7 contract); only the apex strip's percentage uses the USDC-only filter.

### Slot-to-Component Pattern (Refined from Story 48.1)

Story 48.1 set up `<ApexStripSlot />`, `<PeerTableSlot />`, `<FooterSlot />` as `(): null { return null; }` stubs. This story refines the pattern:

1. **Real component lives in a sibling file with a readable name** (`ApexStrip.tsx`, `PeerTable.tsx`).
2. **Slot file becomes a re-export shim** preserving the original symbol name (`ApexStripSlot`, `PeerTableSlot`) — `App.tsx`'s import paths are stable.
3. **Props are added at the slot level**, threaded through `App.tsx`.

This is a 1-line change to `App.tsx` per slot. Story 48.1's Dev Notes claimed "No file-level refactor required when 48.2 lands" — that's true for `App.tsx`'s LAYOUT (no JSX restructure), but FALSE for the prop-passing concern. The minimal change is the right answer; the Story 48.1 promise is honored in spirit (`App.tsx` reads the same top-to-bottom).

If a future story (e.g. 48.4 footer slot) needs more than 1-2 props, escalate to React Context at that point. Two slots at one prop-drilling level is the breakeven.

### USDC Asset Filter — Apex Strip Only

The apex strip's percentage denominator uses the literal `'USDC'` assetCode only (matches Story 48.1's hero band filter). A peer with ONLY `'USDC-sol'` does NOT contribute to the percentage — but it DOES contribute a row to the per-peer table (UX-DR7 multi-asset stacking is the explicit purpose of the table).

This asymmetry is intentional:
- **Hero band + apex strip** = top-line "what's my USDC monthly income" — single assetCode for narrative simplicity.
- **Per-peer table** = forensic view — show every asset the operator earns in.

When v0.5+ Mill multi-chain ships, the hero band may extend to a single "USD-equivalent" aggregate; the table is already multi-chain-correct today.

### Three Deviations from Epic Spec (Documented for Audit)

The epic AC text at `epics-townhouse-hs-v1.md:1064-1075` lists fields the wire shape does not currently support. Each deviation is sourced from a 47.4 wire-shape decision; all three are documented in the AC text above. Restated for audit:

1. **"STATUS" → "TYPE"** — wire has `peer.type ∈ {'town', 'mill', 'dvm', 'external'}`, not a runtime health/phase. Real status is a v0.5+ extension (open question deferred to Epic 50 backlog).
2. **"NET 7d" → "NET (MONTH)"** — wire has `today / month / year / lifetime` windows only (Story 47.3 delta computer; see `packages/townhouse/src/earnings/snapshot-reader.ts:139`). No 7-day window. Using `month` gives the fullest signal in the available data.
3. **`peers[].byAsset[].lastClaimAt` → `peers[].lastClaimAt`** — aggregator output drops per-asset `lastClaimAt` (`aggregator.ts:221-230`). Per-peer max is the only available source. All asset rows for the same peer share this value.

**None of these block the spec's intent.** Drew still sees "two distinct buckets — connector earned $X routing, my Town earned $Y relaying" with the apex strip + per-peer table. The deviations are stale column-name placeholders in the planning artifacts; this story corrects them in code AND flags them for retro / planning hygiene.

### Refresh Tick Inheritance (Story 48.1 AC #5)

The apex strip + per-peer table do NOT manage their own data fetching. They receive `apex` + `peers` props from `App.tsx`, which gets them from `useEarnings()` (Story 48.1 `tui/use-earnings.ts`). Every 2-second silent refresh re-renders BOTH the hero band AND the new components with fresh data, automatically.

This means:
- No new `useEffect` or `setInterval` in this story.
- No new fetch path.
- No new `AbortController` lifecycle.
- The relative-time `LAST CLAIM` cell updates every 2 seconds because `new Date()` is called on every render (default `now` prop). Tests pin `now` to avoid timer flakes; production uses the live clock.

### Why Render `peer.id` Verbatim (No Trimming)

The `PEER` column shows `peer.id` (a connector peerId — typically `'ilp.toon.peer.<host>.<index>'` or a hex hash, ~30-60 chars). At 80ch with 5 columns, each cell gets ~16 chars; the peer ID will truncate visually (Ink does this naturally — `<Text>` in a `<Box width={N}>` clips). **Do NOT trim manually** — operators recognize their peers by the trailing characters; trimming the head obscures them.

If the visual truncation is unacceptable to Sally at review, the fix is column rebalancing (give PEER 24 cols, shrink others), not manual string slicing. Defer to UX-DR7 review.

### What NOT to do

- **Do NOT** call `/admin/*` from the new components. The `tui-import-boundary.test.ts` enforces this. The component files do not even import from `../../api/`.
- **Do NOT** add per-asset `lastClaimAt` to the wire shape. The aggregator change is out of scope; per-peer max is the v1 answer.
- **Do NOT** add a `STATUS` column with `/health` polling. Deviation #1 stands — `TYPE` is the v1 column.
- **Do NOT** add a 7-day window helper to `snapshot-reader.ts`. The `NET (MONTH)` column uses the existing `month` field; a 7d window is a v0.5+ wire-shape extension.
- **Do NOT** add a scroll handler to the per-peer table. AC #5 caps at 4 data rows with silent truncation. Scrollable peer tables land in a follow-up when peer counts exceed 4 in production (current pilot target is 1-3 peers per operator).
- **Do NOT** introduce React Context. One level of prop drilling does not justify a context. Revisit at Story 48.4 if footer slot needs more than 1 prop.
- **Do NOT** add the "you're early" badge in this story — that's Story 48.3.
- **Do NOT** mount the activity ticker or overlay — Story 48.4.
- **Do NOT** rename `ApexStripSlot` or `PeerTableSlot` symbols. `App.tsx` imports them by those names; the re-export shim preserves the contract.
- **Do NOT** add inline empty-state strings in the new components. Every empty branch routes through `COPY.*` — Story 48.1's no-hardcoded-copy rule still applies.
- **Do NOT** modify `<FooterSlot />` or `<Banner />` — Story 48.4's and Story 48.1's territory respectively.
- **Do NOT** modify `useEarnings()` or `mountTui()` signatures — Story 48.1's data layer is frozen.

### Architecture Compliance

- **ESM-only.** Every relative import uses `.js` extension (e.g. `from './ApexStrip.js'`, `from '../format.js'`). NFR15 enforcement.
- **Node 20+, TypeScript ^5.3.** Already the package baseline (NFR15).
- **Strict TS.** `noUncheckedIndexedAccess: true` means `peer.byAsset[assetCode]` is `PerAsset | undefined`. The `PeerTable.flattenPeers()` implementation uses explicit `=== undefined` guards (Task 7.1). Do NOT use the non-null assertion `!.` — it bypasses strict checks.
- **Loopback-only API.** Unchanged from Story 48.1.
- **No `additionalProperties: false` on Townhouse-side schemas added in this story.** This story does not modify any JSON Schema; the wire is read-only.
- **No new file modes.** No new operator-secret files; NFR8 does not apply.

### Testing Standards

| Tool | Use For |
|---|---|
| `vitest` | All unit tests. Existing package default. |
| `ink-testing-library` | Component render snapshots (`render(<ApexStrip .../>); expect(lastFrame()).toContain('apex routing: $1.23')`). |
| Manual smoke (Task 10.4–10.6) | 80×24 + narrow-width + multi-asset peer rendering. |

**Run command:** `pnpm --filter @toon-protocol/townhouse test`. NEVER `pnpm test` at workspace root.

**Net delta target:** +18 to +28 tests over the 1070 baseline (Story 48.1's close-out).

### Previous Story Intelligence

From `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` Review Findings:

- **P3** (`formatUsdc` throws when `NODE_ENV` is unset): mirror the `'development' | 'test'` throw vs production-fallback posture in `formatRelativeTime()`. The fallback for relative-time is `'?'` (single char) not `'$?.??'`.
- **P4** (`addDecimalStrings` BigInt throws on malformed peer payload): the apex strip's totalMonth accumulator uses the SAME defensive `DECIMAL_RE.test(b)` + try/catch pattern as `HeroBand.tsx:13-22`. One bad peer row cannot crash the apex strip render.
- **P6** (`colWidth` collapses at small `columns` — no min-width clamp): the new `PeerTable` uses `MIN_COL_WIDTH = 6` (Task 7.1) to prevent zero-width columns at extreme narrow PTYs. (Hero band uses 8; peer table needs more columns at 80ch so 6 is the tighter floor.)
- **P10** (`shortLabels` ternary is no-op for unchanged labels): the peer table's `shortType` truncation only applies to the TYPE cell (`'town'` → `'twn'` etc.). Header text "TYPE" is unchanged at all widths.
- **P11** (test "aborts in-flight fetch on unmount" — mock promise never settles): not applicable to this story (no new fetch). The existing `use-earnings.test.tsx` still owns the abort test.
- **P19** (no-hardcoded-copy smoke check scans `tui/*.tsx`): confirmed reach into new component files. Re-run after Task 9.5.
- **P22** (named `createElement` import, JSX rename deferred): keep `import { Box, Text } from 'ink'` + JSX in the new components. No `createElement` ceremony needed.
- **W11** (`RecentClaim` re-exported in `types.ts` but unused): unchanged in this story. Story 48.4 owns it.

From `47-4-get-api-earnings-two-bucket-endpoint.md` Dev Notes:

- **D2 — open subschemas (`recentClaim`, `perAsset`).** Future connector minor releases may add fields (e.g. `PerAsset.txHash`). The TUI's `tui/types.ts` re-exports the closed-shape interfaces; future additions land transparently.
- **D4 — regex `^-?\\d+$` on every amount field.** The apex strip + peer table can trust input regex-wise. Defensive `DECIMAL_RE.test()` checks in component code are belt-AND-suspenders (Story 48.1 P4 precedent).

### Git Intelligence — Recent Commits

```
caacede feat(48.1): Ink TUI scaffold + hero band + empty-state foundation
be54ebe Epic 47: Earnings Data Plane (stories 47.1–47.5 + retro) (#59)
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
```

**Actionable signals:**

- Commit `caacede` is Story 48.1 — this story branches directly off it. The TUI scaffold, slot components, copy library, and design artifacts are all in place.
- Epic 47 (`be54ebe`) shipped the data plane. The wire shape is settled.
- No in-flight branches touch `tui/components/*Slot.tsx` per the most recent local `git status` (verified at Task 2.6).

### Latest Tech Information — No Changes from Story 48.1

Ink 5 + React 18.3 + ink-testing-library 4. No version bumps, no new packages. The new `<ApexStrip />` + `<PeerTable />` components use the same Ink primitives (`<Box>`, `<Text>`, `useStdout()`) as the hero band.

`Intl.RelativeTimeFormat` was considered for `formatRelativeTime()` and **rejected**:
- Requires `Intl` initialization cost (~50ms first-call).
- Drew's locale is unknown; defaulting to `'en'` is sloppy.
- The 5-bucket truncated phrasing (`<1m`, `Nm`, `Nh`, `Nd`, `Nmo`) is more terse than Intl's defaults (`5 minutes ago`).

Inline implementation (Task 5.1) is ~12 lines and trivially testable.

### Project Context Reference

Coding rules / patterns / conventions: see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:

- **ESM imports** — relative imports use `.js` extension.
- **`pnpm --filter <pkg> test`** — never `pnpm test` at workspace root.
- **Sub-agent RAM rules** — keep test invocations narrow; always set `timeout: 60000` (build) / `120000` (test).
- **Loopback-only API binding** — already enforced by `buildFastifyApp`; TUI consumes `127.0.0.1` only.
- **No comments unless WHY is non-obvious** — keep `.tsx` files lean; let JSX + named components speak.

### References

- **Epic spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1044-1081` (Story 48.2 AC).
- **TUI design spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154` (metric tiers, table layout, "cut from v1" list).
- **Wire shape source:** `packages/townhouse/src/earnings/aggregator.ts:32-78` (types) + `packages/townhouse/src/api/schemas/earnings.ts` (frozen JSON schema).
- **Slot scaffold + existing TUI:** `packages/townhouse/src/tui/` (Story 48.1 — all files in place).
- **Prior story Dev Notes:** `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` (Slot pattern, USDC filter, no-hardcoded-copy rule).
- **Wire shape decisions (D2/D4):** `_bmad-output/implementation-artifacts/47-4-get-api-earnings-two-bucket-endpoint.md` § Review Findings.
- **Design artifact prior art:** `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1), `_bmad-output/design/empty-state-copy.md` (UX-DR2).
- **Hero band template patterns:** `packages/townhouse/src/tui/components/HeroBand.tsx` (column-width pattern, `addDecimalStrings`, `MIN_COL_WIDTH`).
- **Aggregator lastClaimAt reduce:** `packages/townhouse/src/earnings/aggregator.ts:221-230` (the per-peer max — deviation #3 source).
- **Snapshot reader windows:** `packages/townhouse/src/earnings/snapshot-reader.ts:139-193` (today/month/year only — deviation #2 source).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-14)

### Debug Log References

- **Spec arithmetic error (AC #11 floor test):** Story spec claimed `1234567 / 3527000 = 0.349` — actual value is `0.350`. Corrected test to use `1234567 / 3537440 = 0.34908` which correctly pins floor=34 vs round=35.
- **TYPE column truncation (AC #10):** Story spec listed `twn` as first-3-chars of `'town'` — actually `'town'.slice(0,3) = 'tow'`. Test corrected to `'tow'`.
- **Column-width injection pattern:** `process.stdout.columns` doesn't affect Ink's mock stdout in ink-testing-library. Added optional `columns?: number` prop to `PeerTable` (matches existing `now?: Date` testability pattern) to inject width in tests.
- **App.tsx note:** Story 48.1 claimed "No file-level refactor required when 48.2 lands" — this was aspirational. The 2-line prop-passing change to App.tsx is the minimal correct approach (Option A per Dev Notes).

### Completion Notes List

- ✅ **Task 1 (Pre-work):** Read all 16 files/resources in blast radius. Confirmed slot ordering, wire shape, type interfaces, copy-sync mechanism.
- ✅ **Task 2 (Pre-conditions):** All three prerequisite stories done; baseline 1070 tests confirmed; canary 43/43.
- ✅ **Task 3 (COPY promotion):** `COPY.apex.{routingPrefix, routingEmpty}` and `COPY.peerTable.{empty, lastClaimNever}` promoted from `COPY.future.*`. `empty-state-copy.md` restructured with new "Apex + Per-Peer Table Copy (Story 48.2)" section and updated token reference table. `copy-sync.test.ts` still green.
- ✅ **Task 4 (UX-DR7):** `_bmad-output/design/townhouse-tui-per-asset-row.md` created with 80ch + 120ch grids, stacking rules, degrade ladder, and cross-refs. UX-DR1 extended with "Per-Peer Table Degrade Ladder" section.
- ✅ **Task 5 (formatRelativeTime):** Added to `format.ts` alongside `formatUsdc`. Truncates (no rounding). Handles null → `'—'`, malformed → `'?'`, future ISO → `'<1m ago'`. 10 test cases added.
- ✅ **Task 6 (ApexStrip):** `ApexStrip.tsx` created with BigInt percentage math, USDC-only filter, Mill peer upsell logic. `ApexStripSlot.tsx` → re-export shim. 5 test cases.
- ✅ **Task 7 (PeerTable):** `PeerTable.tsx` created with `flattenPeers()` multi-asset stacking, MAX_DATA_ROWS=4 cap, 5-column degrade ladder. `PeerTableSlot.tsx` → re-export shim. `App.tsx` updated with 2-line prop-passing diff. 7 test cases.
- ✅ **Task 8 (Import boundary):** `tui-import-boundary.test.ts` guards against `../../connector/`, `../../earnings/`, `../../api/` etc. imports in all `tui/components/*.tsx` files.
- ✅ **Task 9 (Tests):** +23 total tests (baseline 1070 → 1093). All 74 test files pass. Contract canary 43/43 unchanged.
- ✅ **Task 10 (Build/regression):** TypeScript build clean. Contract canary unchanged. Manual smoke (10.4–10.6) deferred to dev for live stack verification.
- ⚠️ **Manual smoke** (Tasks 10.4–10.6) deferred — requires live `townhouse-dev-infra.sh up` stack. Tests cover the logic; interactive terminal is a dev pre-PR gate.

### File List

**New files:**
- `packages/townhouse/src/tui/components/ApexStrip.tsx`
- `packages/townhouse/src/tui/components/ApexStrip.test.tsx`
- `packages/townhouse/src/tui/components/PeerTable.tsx`
- `packages/townhouse/src/tui/components/PeerTable.test.tsx`
- `packages/townhouse/src/tui/tui-import-boundary.test.ts`
- `_bmad-output/design/townhouse-tui-per-asset-row.md`

**Modified files:**
- `packages/townhouse/src/tui/components/ApexStripSlot.tsx` — re-export shim
- `packages/townhouse/src/tui/components/PeerTableSlot.tsx` — re-export shim
- `packages/townhouse/src/tui/App.tsx` — 2-line prop-passing diff
- `packages/townhouse/src/tui/copy.ts` — COPY.apex + COPY.peerTable namespaces added; future.apex/peerTable removed
- `packages/townhouse/src/tui/format.ts` — formatRelativeTime() added
- `packages/townhouse/src/tui/format.test.ts` — 10 formatRelativeTime cases added
- `_bmad-output/design/empty-state-copy.md` — restructured; token table updated
- `_bmad-output/design/townhouse-tui-wireframe.md` — Per-Peer Table Degrade Ladder section appended
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 48-2 status updated

### Review Findings

**Code review 2026-05-14** — 3 layers: Blind Hunter (16), Edge Case Hunter (16), Acceptance Auditor (7). After dedupe + triage + decisions: **10 patches, 0 defer, 20 dismissed as spec-compliant, false positives, or PM-resolved.**

**All 10 patches applied 2026-05-14.** Test suite: 1094/1095 in parallel + 1 pre-existing flaky timer race in `snapshot-writer.test.ts` (passes in isolation). New test count: +25 net delta over baseline 1070 (1095 total — 48.2's +23 plus 2 added in code review: malformed-apex defensive branch + negative-apex cancellation defensive branch). Contract canary unchanged (43/43, sub-50ms). Build clean. Remaining gate per AC #13: `Sally sign-off (UX-DR7): approved` in PR description (PR-level, not code-review-level).

**Decisions resolved (2026-05-14):**
- **D1** → patch (P10 below): code stays as `slice(0,3)`; update UX-DR7 + wireframe to say `tow / mil / dvm / ext` instead of `twn`.
- **D2** → dismissed: negative apex routing fees render `(-34%)` as-is (transparent ledger truth; pathological enough to accept).
- **D3** → dismissed: `peers.length > 0` with all-empty `byAsset` shows the apex-only-boot empty-state (cosmetic, transient — peer will appear on first earnings tick).

**Patch:**
- [x] [Review][Patch] **Malformed `apex.month` renders mixed-signal upsell** — when `apex.month` fails `DECIMAL_RE.test`, `apexMonthBig=0n` triggers the upsell branch, BUT `formatUsdc` falls through to its `'$?.??'` production fallback, producing `↳ apex routing: $?.?? (enable mill to route)`. Defensive guard: skip upsell when `apexMonth` is malformed. [`packages/townhouse/src/tui/components/ApexStrip.tsx:22-37`]
- [x] [Review][Patch] **Import-boundary test matches single-quoted imports only** — `source.includes(\`from '${forbidden}\`)` misses `from "../../..."`, backtick imports, and dynamic `import("../../...")` entirely. Strengthen to a regex that covers all 3 quote chars + `import()` form. [`packages/townhouse/src/tui/tui-import-boundary.test.ts:25`]
- [x] [Review][Patch] **Import-boundary forbidden list is a partial deny-list; AC #7 reads as an allow-list** — additions like `../../tui-host/`, `../../config/`, `../../logger/` (and any future backend modules) bypass the check. Convert to an allow-list (`react`, `ink`, `../copy.js`, `../format.js`, `../types.js`, `./...`) or extend the deny-list to include every non-tui sibling. [`packages/townhouse/src/tui/tui-import-boundary.test.ts:9-16`]
- [x] [Review][Patch] **Import-boundary scanner skips non-`.tsx` component files** — filter is `.endsWith('.tsx') && !.endsWith('.test.tsx')`. A future `helpers.ts` in `components/` would not be scanned. Include `.ts` files (excluding `.test.ts`). [`packages/townhouse/src/tui/tui-import-boundary.test.ts:20`]
- [x] [Review][Patch] **Dead `totalMonth === 0n` branch + mislabeled test** — in `ApexStrip.tsx:39`, `totalMonth` is seeded from `apexMonthBig` and only grows; reaching this branch requires `apexMonthBig !== 0n`, so `totalMonth ≥ apexMonthBig > 0n` always. The branch is unreachable. The test at `ApexStrip.test.tsx:55-66` is labelled "omits percentage parenthetical when totalMonth === 0" but its long comment concedes the branch is unreachable and instead asserts the `(100%)` path. AC #11 bullet 4 covers a structurally-impossible case. Remove the dead `pct = totalMonth === 0n ? null : ...` ternary (just compute `pct` directly) AND relabel/replace the test with what it actually verifies (apex-with-no-peers ⇒ 100%). [`packages/townhouse/src/tui/components/ApexStrip.tsx:39`, `ApexStrip.test.tsx:48-66`]
- [x] [Review][Patch] **`stdout?.columns === 0` not coalesced** — `??` only triggers on null/undefined, so a piped/detached TTY with `columns === 0` survives → `Math.floor(0 / 5) = 0` → clamped to `MIN_COL_WIDTH=6` (5×6=30 chars). Headers garble. Replace `stdout?.columns ?? 80` with `(stdout?.columns || 80)` or explicit `> 0` check. [`packages/townhouse/src/tui/components/PeerTable.tsx:52`]
- [x] [Review][Patch] **`COPY.peerTable.lastClaimNever` token defined but never referenced** — `format.ts:14` hardcodes `if (iso === null) return '—'`; the new COPY token is dead. Either (preferred) drop `lastClaimNever` from `copy.ts` + `empty-state-copy.md` token table, or wire `formatRelativeTime` to accept an injected null-label and pass `COPY.peerTable.lastClaimNever`. [`packages/townhouse/src/tui/copy.ts:18`]
- [x] [Review][Patch] **3-asset stacking test doesn't assert empty TYPE cell** — AC #11 bullet 6 says "rows 2-3 have empty `PEER` AND `TYPE` cells (UX-DR7 stacking)" but the test only asserts `bob` appears once. Add an analogous assertion that `'mill'` appears exactly once in the frame (`(frame.match(/mill/g) ?? []).length === 1`). [`packages/townhouse/src/tui/components/PeerTable.test.tsx:24-35`]
- [x] [Review][Patch] **`hero-band.test.tsx` no-hardcoded-copy `FORBIDDEN_RE` still only enforces Story 48.1 strings** — Dev Notes Task 9.5 claims the P19 scan covers the new component files; the scan iterates over the new files but the regex hard-codes the 48.1 string set. A future contributor inlining `'apex routing'`, `'enable mill to route'`, or `"no peers yet"` would not be caught. Extend `FORBIDDEN_RE` to cover the new tokens (or refactor to import `COPY` and walk it dynamically). [`packages/townhouse/src/tui/hero-band.test.tsx:142`]
- [x] [Review][Patch] **`PeerTable.test.tsx` empty-state assertion uses a hardcoded literal instead of `COPY.peerTable.empty`** — if Sally edits the copy, the test silently passes wrong content. Import `COPY` and reference `COPY.peerTable.empty`. [`packages/townhouse/src/tui/components/PeerTable.test.tsx:79`]
- [x] [Review][Patch] **Design artifacts contradict code on TYPE abbreviation (resolved D1)** — `townhouse-tui-per-asset-row.md:128` and `townhouse-tui-wireframe.md:157` list `twn / mil / dvm / ext`; code emits `tow / mil / dvm / ext` (via `slice(0,3)`). Update both design artifacts to match the slice output. [`_bmad-output/design/townhouse-tui-per-asset-row.md:128`, `_bmad-output/design/townhouse-tui-wireframe.md:157`]

**Dismissed (20, +2 from D2/D3):** AC-mandated behaviors (BigInt floor %, USDC-only filter, silent 4-row truncation, future-ISO → `<1m ago`, 30-day month constant, alphabetical assetCode sort, hardcoded `'—'` for null lastClaim), perf nits inherited from 48.1 (`addDecimalStrings` round-trip, silent defensive swallowing), false positives (copy-sync doc wording works after restructure, test does pin `↳` Unicode, `App.tsx` prop-passing is Dev-Notes-approved Option A, `useStdout()` outside Ink not reachable, `MIN_COL_WIDTH` floor matches 48.1 precedent, `.endsWith(' ago')` collision with `<1m ago` is semantically equivalent, ms-precision boundary jitter is spec truncation, `Date.parse` ISO non-Z is wire-contract enforced, peer-table mid-group truncation is the spec's explicit "silently truncated" policy).

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [ ] Does this story contain regex or template substitution logic? **Yes** — `formatRelativeTime()` parses ISO-8601 input; the unit tests MUST include real-world `peer.lastClaimAt` values (e.g. `'2026-05-13T18:42:11.123Z'` produced by the aggregator's `Date` serializer).
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Confirm NO new gates were added.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of +18 to +28 tests over the 1070 baseline.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` still passes sub-500ms, 43 tests (UNCHANGED).
- [ ] Verify `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) exists with the 80ch + 120ch grids, stacking rules, degrade ladder, and cross-references.
- [ ] Verify `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) has the appended "Per-Peer Table Degrade Ladder" section.
- [ ] Verify `_bmad-output/design/empty-state-copy.md` (UX-DR2) has the apex + peer-table copy moved out of "Future-State Placeholders" AND the "Copy Token Reference" table updated.
- [ ] Verify the copy-sync test (`copy-sync.test.ts`) still passes — markdown ↔ TS sync is intact.
- [ ] Verify `tui-import-boundary.test.ts` passes — the new components do not import from `../../connector/`, `../../earnings/`, `../../api/`, etc.
- [ ] Verify `Sally sign-off (UX-DR7): approved` appears in the PR description (AC #13). Story cannot flip to `done` without it.
- [ ] Verify the manual smoke matrix (80×24, narrow-width 65/55, multi-asset peer) was run AND results captured in the Completion Notes.
- [ ] Confirm no `if (peers.length === 0) return ''` or similar empty-handler patterns in the TUI source — every empty branch routes through `COPY.*`.
- [ ] Confirm `<FooterSlot />` is still a stub fragment (returning `null`) — Story 48.4 owns it.
- [ ] Confirm `App.tsx` JSX block reads top-to-bottom in the same order (hero → banner → apex slot → peer slot → footer slot) — slot ordering preserved.
- [ ] Update sprint-status to `review` (then `done` after code review).
