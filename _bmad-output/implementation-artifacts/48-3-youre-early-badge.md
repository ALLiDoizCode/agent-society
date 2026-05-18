# Story 48.3: "You're Early" Badge

Status: done

> **Third story of Epic 48 (Operator Dashboard / Ink TUI).** Sized S (smallest of the visible-component stories — single-row badge, no new wire fields, no new copy tokens). Mounts a 1-row amber `<Badge />` between `<HeroBand />` and `<Banner />` in `App.tsx`. The badge fires when `lifetimeUsdcSum < $1.00 OR uptimeSeconds < 7d`, rotates copy through the three `COPY.heroEarlyRotation` variants on a 30-second wall-clock cadence, and disappears silently (returns `null`) once BOTH triggers are above threshold. Unblocks 48.4 (footer slot mounts the activity ticker; badge already in place above it), 48.7 (live gate asserts the badge renders against a fresh day-one apex).
>
> **Critical path:** Epic 47 (DONE — `/api/earnings` wire ships `uptimeSeconds`) → 48.1 (DONE — `COPY.heroEarlyRotation` + hero region + App.tsx scaffold) → 48.2 (DONE — apex strip + per-peer table; slot pattern refined to "prop-passing from App.tsx") → **48.3 (this — badge between hero and banner)** → 48.4 (footer slot + activity overlay) → 48.7 (live gate).
>
> **Data-source contract is FROZEN — do NOT call `/admin/*` directly.** All badge inputs flow through `GET http://127.0.0.1:28090/api/earnings` (Story 47.4). Wire fields this story consumes verbatim: `apex.routingFees[USDC].lifetime`, `peers[].byAsset[USDC].lifetime`, `uptimeSeconds`. The schema is locked at `packages/townhouse/src/api/schemas/earnings.ts:106` (`uptimeSeconds: { type: 'integer', minimum: 0 }`) and `aggregator.ts:77` ships the value from `getMetrics().uptimeSeconds` (0 on connector outage — see Dev Notes § "Connector Outage").
>
> **No new wire fields. No new COPY tokens. No new dependencies.** Everything this story needs already shipped in 48.1 / 48.2 / 47.x. The badge is pure render logic over data the TUI already receives. The only new artifact is `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3) — the Sally-signed badge spec.
>
> **One contract clarification — qualifier vs badge.** Story 48.1's `<Qualifier />` (in `HeroBand.tsx:122`) already renders the literal text `"you're early"` inline as part of the empty-state line `MONTH $0.00 · N events relayed · you're early`. The badge added by this story is a SEPARATE element rendering the ROTATED text (`you're early` / `warming up` / `first packet en route`). Both can show simultaneously — that's intentional, NOT a duplication bug. The qualifier is empty-state hero copy (48.1 AC #4 — load-bearing); the badge is a new richer signal at a different mount point. UX-DR3 must explicitly document the dual-presence so Sally signs off on the coexistence. If Sally later wants the qualifier's trailing `· you're early` removed, that's a follow-up — this story does NOT modify the qualifier (48.1 AC #4 regression risk).

## Story

As **Drew (the terminal operator)**,
I want **a visible amber badge near the hero band that tells me "you're early" — rotating through `you're early` / `warming up` / `first packet en route` — when my lifetime earnings are under $1.00 OR my uptime is under 7 days**,
so that **small numbers and a fresh box feel like positioning, not failure — and the badge silently disappears once I cross the first dollar AND week so I don't uninstall on day one and don't feel patronized once the system is mature**.

## Acceptance Criteria

1. **AC #1 — Badge mounts in the hero region.** **Given** the TUI scaffold from Story 48.1, **When** `App.tsx` renders, **Then** a new `<Badge apex={data.apex} peers={data.peers} uptimeSeconds={data.uptimeSeconds} />` element appears BETWEEN `<HeroBand />` and `<Banner />` in the JSX tree (line ordering: `HeroBand` → `Badge` → `Banner` → `ApexStripSlot` → `PeerTableSlot` → `FooterSlot`). The badge is NOT mounted inside `<HeroBand />` (HeroBand internals remain frozen per 48.1 AC #12 / 48.2 AC #12); it is a sibling. Total App.tsx diff: exactly one added line.

2. **AC #2 — Lifetime trigger.** **Given** `lifetimeUsdcSum < 1_000_000n` (i.e. less than `$1.00` at USDC scale 6 — `1_000_000` smallest-units = `$1.00`), where `lifetimeUsdcSum` = `BigInt(apex.routingFees['USDC']?.lifetime ?? '0') + Σ BigInt(peer.byAsset['USDC']?.lifetime ?? '0')` across `peers[]`, **When** the badge renders, **Then** the trigger condition `lifetimeTriggers === true` evaluates true. Malformed decimal-strings (any value failing `/^-?\d+$/`) are treated as `0n` defensively — one bad peer payload cannot crash the render tree (P4 precedent from 48.1 / 48.2). Only the literal `'USDC'` assetCode contributes (mirrors hero band + apex strip USDC-only filter from 48.1 + 48.2).

3. **AC #3 — Uptime trigger.** **Given** `uptimeSeconds < 604_800` (i.e. less than 7 days — `7 * 24 * 3600 = 604_800` seconds), where `uptimeSeconds` comes verbatim from `AggregatedEarnings.uptimeSeconds` (an integer per the schema, `0` on connector outage), **When** the badge renders, **Then** the trigger condition `uptimeTriggers === true` evaluates true. The value is consumed as a JavaScript `number` (NOT BigInt — the schema constrains it to a safe integer ≥ 0; 7-day threshold is far below `Number.MAX_SAFE_INTEGER`).

4. **AC #4 — Combined trigger (OR semantics).** **Given** both trigger conditions, **When** the badge renders, **Then** the badge is visible iff `lifetimeTriggers || uptimeTriggers === true`. The badge disappears (returns `null` — no whitespace placeholder, no row reservation) ONLY when BOTH `lifetime >= $1.00 AND uptime >= 7d`. This is the spec's "disappears silently after first $1 lifetime" expanded to include the AND-uptime gate (epic AC: "`lifetime < $1.00 OR uptime < 7d`" → disappears means negate both).

5. **AC #5 — Copy rotation via render-pure index.** **Given** `COPY.heroEarlyRotation` (already exists at `tui/copy.ts:3` as `['you're early', 'warming up', 'first packet en route'] as const`), **When** the badge renders at wall-clock time `now`, **Then** the displayed copy is `COPY.heroEarlyRotation[Math.floor(now.getTime() / ROTATION_INTERVAL_MS) % COPY.heroEarlyRotation.length]`. The rotation index is **derived from wall-clock time** (NOT React `useState` / `useEffect` / `useRef`) — this keeps the badge render-pure and re-render-safe (the 2-second refresh tick from `useEarnings()` re-fires the same index until the wall-clock advances past the rotation boundary). `now` is injected via a `now?: Date` prop (default `new Date()` — same testability pattern as `<PeerTable />` and `formatRelativeTime()` from 48.2). Tests pin `now` to assert deterministic rotation.

6. **AC #6 — Rotation cadence locked at 30 seconds.** **Given** `ROTATION_INTERVAL_MS`, **When** read from the component source, **Then** the value is `30_000` (30 seconds) — exported as a named constant at the top of `Badge.tsx` so tests pin it and UX-DR3 documents it. Cadence trade-off (Dev Notes): 30s aligns to ~15 refresh ticks per rotation step — slow enough to not flicker, fast enough that an idle operator sees variety within ~90s (one full cycle).

7. **AC #7 — Visual treatment: `<Text color="yellow" bold>`.** **Given** the badge renders, **When** the visual treatment is applied, **Then** the badge text is wrapped in `<Text color="yellow" bold>` (Ink primitive). Justification: `"yellow"` matches UX-DR1's already-locked `earlyAccent` color token (`townhouse-tui-wireframe.md:54`). Chalk (Ink's color backend) auto-degrades `"yellow"` to plain text on `NO_COLOR=1` / dumb-terminal environments. The badge MUST NOT use `dimColor` (that would defeat the visual emphasis); `bold` is the truecolor → 8-color graceful fallback (bold renders on every terminal class). No new color tokens; no hex codes — keep consistent with UX-DR1.

8. **AC #8 — Silent disappearance.** **Given** the badge was visible at refresh tick `T`, **When** at refresh tick `T+1` (~2s later) both `lifetime >= $1.00 AND uptime >= 7d`, **Then** the badge returns `null` on the next render — no animation, no farewell text, no flash, no row whitespace residue. The `<Badge />` element is removed from the React tree (Ink unmounts it; the row it occupied collapses). Same posture as the qualifier's "vanishes when ANY month>0" rule from 48.1 AC #4. Dev Notes elaborates the disappearance edge case (lifetime monotonically grows but uptime crosses 7d only once — once disappeared, the badge stays gone for that session).

9. **AC #9 — Data sourced from `/api/earnings` only.** **Given** the `<Badge />` component, **When** it receives props, **Then** every value (`apex`, `peers`, `uptimeSeconds`) comes from the `useEarnings()` hook's `AggregatedEarnings` payload — passed through `App.tsx`. The component MUST NOT import from `../../connector/`, `../../earnings/aggregator.js` (except type re-exports via `tui/types.js`), `../../api/`, `../../docker/`, or any `/admin/*` HTTP path. The existing `tui-import-boundary.test.ts` (Story 48.2 AC #7) auto-extends to `Badge.tsx` because the allow-list regex covers `react|ink|../copy.js|../format.js|../types.js|./...` only — any forbidden import in the new file fails the test without modification.

10. **AC #10 — UX-DR3 design artifact created.** **Given** the badge visual + behavior decision, **When** this PR is reviewed, **Then** `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3) exists with: (a) the visual treatment (color="yellow", bold, no dimColor); (b) 80ch + 120ch reference grids showing badge mounted between hero band and banner; (c) the three copy rotation variants verbatim; (d) the rotation cadence (30s) + the wall-clock-derived index formula; (e) the dual-trigger rules (`lifetime < $1.00 OR uptime < 7d`); (f) the silent-disappearance rule + the "qualifier vs badge" coexistence note (epic-spec dual-presence is intentional); (g) cross-references to UX-DR1 (wireframe slot table), UX-DR2 (empty-state copy library), and this story. The dev agent drafts the artifact in this PR; Sally signs off in the PR description with the verbatim string `Sally sign-off (UX-DR3): approved`. **This is NOT a merge gate (NFR19 was 48.1-scoped); but the story cannot flip to `done` without the sign-off line** — same posture as 48.2 AC #13 (UX-DR7).

11. **AC #11 — No regression on 48.1 / 48.2 contracts.** **Given** Story 48.1's and 48.2's invariants, **When** this story lands, **Then**: (a) `App.tsx` is touched ONLY to add the `<Badge ... />` line between `<HeroBand />` and `<Banner />` (slot ordering preserved: hero → badge → banner → apex slot → peer slot → footer slot); (b) `<HeroBand />` is NOT modified (`hero-band.test.tsx` passes verbatim); (c) `<Qualifier />` is NOT modified (48.1 AC #4 — qualifier still renders `... · you're early` inline when month==0 across the board); (d) `<ApexStripSlot />`, `<PeerTableSlot />`, `<FooterSlot />` are NOT modified (48.2 / 48.4 territory); (e) `useEarnings()` signature is NOT modified (no new fetch path; the existing `uptimeSeconds` payload field is consumed); (f) `mountTui()` signature is NOT modified; (g) `copy.ts` is NOT modified (`COPY.heroEarlyRotation` already exists from 48.1) — therefore `copy-sync.test.ts` passes verbatim; (h) `tui-import-boundary.test.ts` passes verbatim — the new component file matches the existing allow-list.

12. **AC #12 — Unit-test surface coverage (~10 cases).** **Given** the new component source, **When** `pnpm --filter @toon-protocol/townhouse test` runs, **Then** the suite asserts:
    - Badge renders when `lifetime < $1.00 AND uptime < 7d` (both triggers fire — day-one Drew).
    - Badge renders when `lifetime >= $1.00 AND uptime < 7d` (only uptime fires).
    - Badge renders when `lifetime < $1.00 AND uptime >= 7d` (only lifetime fires).
    - Badge returns null when `lifetime >= $1.00 AND uptime >= 7d` (both above threshold — silent disappearance, AC #4).
    - Boundary: `lifetime === 1_000_000n` (exactly $1.00) AND `uptime === 604_800` (exactly 7d) → both at threshold → badge null (strict `<` comparison, not `<=`).
    - Boundary: `lifetime === 999_999n` AND `uptime === 604_799` → both just-below threshold → badge visible.
    - Lifetime sum across apex + multiple peers: apex.lifetime=500_000, peer1.lifetime=200_000, peer2.lifetime=200_000 → sum=900_000 → trigger fires (`< 1_000_000n`).
    - Malformed apex.lifetime (fails `^-?\d+$`) is treated as `0n` (defensive); badge still computes peer sums correctly and renders if trigger fires.
    - Non-USDC peer lifetime (e.g. `byAsset['USDC-sol'].lifetime='5000000'`) does NOT contribute to the lifetime sum — only the literal `'USDC'` assetCode counts (mirrors 48.2 USDC-only filter).
    - Rotation index 0 (`now = new Date(0)` → `Math.floor(0/30_000) % 3 = 0` → "you're early").
    - Rotation index 1 (`now = new Date(35_000)` → `Math.floor(35_000/30_000) % 3 = 1` → "warming up").
    - Rotation index 2 (`now = new Date(65_000)` → `Math.floor(65_000/30_000) % 3 = 2` → "first packet en route").
    - Rotation wraps at index 3 (`now = new Date(95_000)` → `% 3 = 0` → back to "you're early").
    - Visual: rendered frame contains the rotation text (smoke check that `<Text color="yellow" bold>` doesn't intercept the children in ink-testing-library — same posture as ApexStrip / PeerTable tests).
    
    Per the project's TUI testing rule (`townhouse-hs-v1-plan-2026-05-07.md:306-309`): **DO test** data → render mapping, trigger boundaries, rotation determinism. **DON'T test** terminal color output, animation timing, or fake-timer-driven `useEffect` rotation (rotation is render-pure — no effects).

13. **AC #13 — `now` injection for testability.** **Given** the badge component, **When** consumed by tests, **Then** the `now?: Date` prop allows pinning the wall clock without `vi.useFakeTimers()` / `vi.setSystemTime()`. Default `now = new Date()` so production callers don't need to pass it. The prop is part of `BadgeProps` exported alongside the component. Same pattern as `<PeerTable now?: Date>` from 48.2 (Task 7.1).

**FRs:** FR24 ("You're Early" badge with rotating copy; disappears silently after first $1 lifetime).
**UX-DRs:** UX-DR3 (Badge spec — visual, copy, triggers, cadence).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md` Dev Notes + Review Findings end-to-end. The "Slot-to-Component Pattern (Refined from Story 48.1)" section and the 10 applied patches (P10's `slice(0,3)`, P6's `MIN_COL_WIDTH` clamp, the import-boundary allow-list refinement, the COPY-promotion lockstep with `empty-state-copy.md`) are this story's precedent for component-mount patterns.
  - [x] 1.2 Read `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` § AC #4 (qualifier behavior) and § AC #9 (no hardcoded copy rule) end-to-end. The qualifier shows `· you're early` inline — the badge is a SEPARATE element rendering rotated copy. Both can coexist (Dev Notes § "Qualifier vs Badge Coexistence").
  - [x] 1.3 Read `packages/townhouse/src/tui/App.tsx` end-to-end (~40 lines). Confirm the JSX tree post-48.2: `<HeroBand />` → `<Banner />` → `<ApexStripSlot apex peers />` → `<PeerTableSlot peers />` → `<FooterSlot />`. This story adds ONE line: `<Badge apex={data.apex} peers={data.peers} uptimeSeconds={data.uptimeSeconds} />` between `<HeroBand />` and `<Banner />`.
  - [x] 1.4 Read `packages/townhouse/src/tui/components/HeroBand.tsx` end-to-end. The `addDecimalStrings()` helper at `HeroBand.tsx:13-22` is the BigInt-safe accumulator pattern — the badge's `computeLifetimeUsdc()` helper mirrors it 1:1 (Task 6.1).
  - [x] 1.5 Read `packages/townhouse/src/tui/components/Qualifier.tsx` end-to-end (~16 lines). The qualifier uses `<Text color="yellow">` — same color token UX-DR1 names `earlyAccent`. The badge uses `<Text color="yellow" bold>` (bold differentiates visually from qualifier without introducing a new color token).
  - [x] 1.6 Read `packages/townhouse/src/tui/components/ApexStrip.tsx` end-to-end. The defensive `apexValid = DECIMAL_RE.test(apexMonth)` pattern at `ApexStrip.tsx:28` is the precedent for the badge's lifetime-sum defensive guard (one malformed peer payload must not crash the render).
  - [x] 1.7 Read `packages/townhouse/src/tui/components/PeerTable.tsx` end-to-end. The `now?: Date` testability prop pattern (`PeerTable.tsx:50`) is the template for the badge's `now?: Date` prop (Task 6.1).
  - [x] 1.8 Read `packages/townhouse/src/tui/copy.ts` end-to-end (~22 lines). Confirm `COPY.heroEarlyRotation` exists as `['you're early', 'warming up', 'first packet en route'] as const`. **This story adds NO new COPY tokens.** No edits to `copy.ts`. No edits to `copy-sync.test.ts`. No edits to `empty-state-copy.md` § "Copy Token Reference" table.
  - [x] 1.9 Read `packages/townhouse/src/tui/use-earnings.ts` end-to-end. Confirm `EarningsState` ships `uptimeSeconds` in `data` for both `'ok'` and `'stale'` phases (the empty fallback `EMPTY_EARNINGS` at `use-earnings.ts:16-23` ships `uptimeSeconds: 0`, which correctly triggers the badge on connector outage — see Dev Notes § "Connector Outage").
  - [x] 1.10 Read `packages/townhouse/src/api/schemas/earnings.ts:106` — confirm `uptimeSeconds: { type: 'integer', minimum: 0 }` is required at the top level of the response. Schema is frozen; no changes.
  - [x] 1.11 Read `packages/townhouse/src/earnings/aggregator.ts:73-78` — confirm `uptimeSeconds: number` field is documented as "From `getMetrics().uptimeSeconds`. 0 on connector outage or metrics failure." This is the wire contract for AC #3.
  - [x] 1.12 Read `packages/townhouse/src/tui/tui-import-boundary.test.ts` end-to-end (~35 lines). The allow-list regex covers `react|ink|../copy.js|../format.js|../types.js|./...` — `Badge.tsx` falls under this list (only needs `react`, `ink`, `../copy.js`, `../types.js`). NO test modification needed.
  - [x] 1.13 Read `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) end-to-end. The "Layout Slots (Reserved)" section (lines 81-89) lists three slots; the badge is added to that table in Task 4.2. The "Ink Color Tokens" table at lines 49-56 includes `earlyAccent | "yellow"` — the badge consumes this token; no new entry needed.
  - [x] 1.14 Read `_bmad-output/design/empty-state-copy.md` (UX-DR2) end-to-end. The "Rotation variants" sub-section at lines 31-34 lists the three badge copy strings — Task 5.1 moves these into a new "## You're Early Badge (Story 48.3)" top-level section so the badge has its own canonical home (matches 48.2's "Apex + Per-Peer Table Copy" pattern). The "Copy Token Reference" table at lines 117-131 already includes `COPY.heroEarlyRotation[0..2]` — NO change to the token table.
  - [x] 1.15 Read `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) end-to-end — this is the structural template UX-DR3 follows (frontmatter, why section, 80ch + 120ch grids, rules, cross-refs).
  - [x] 1.16 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1085-1113` (Epic 48 Story 48.3 spec). Confirm this story's AC text aligns with the epic spec; the deviations are: (a) "amber" → "`color='yellow' bold`" (UX-DR1 token + bold for emphasis; no new color tokens); (b) "rotation cadence per UX-DR3" → "30s wall-clock-derived index" (UX-DR3 is created by this story, so the cadence decision is documented in lockstep). Both deviations are documented in Dev Notes § "Deviations from Epic Spec".
  - [x] 1.17 Read `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:122-124` ("You're early" badge subsection). The plan-doc trigger phrasing (`lifetime < $1.00 OR uptime < 7d`) is the source of truth and matches this story's AC #2 + AC #3.
  - [x] 1.18 Run `find packages/townhouse/src/tui -type f -name '*.tsx' -o -name '*.ts' | sort` to confirm directory structure from 48.2. Expected component files: `App.tsx`, `Banner.tsx`, `HeroBand.tsx`, `Qualifier.tsx`, `Sparkline.tsx`, `ApexStrip.tsx`, `ApexStripSlot.tsx`, `PeerTable.tsx`, `PeerTableSlot.tsx`, `FooterSlot.tsx`. This story adds exactly ONE new component file: `Badge.tsx` (+ `Badge.test.tsx`).
  - [x] 1.19 Run `grep -rn "Badge\\|youreearly\\|you're early" packages/townhouse/src 2>/dev/null` to confirm NO existing `Badge` symbol or `you're early` hardcoded string in source files (the qualifier reads from `COPY.heroEarly`, NOT a literal). The new component name `Badge` is unclaimed.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm `48-2-two-bucket-earnings-display: done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent → STOP.
  - [x] 2.2 Confirm `47-4-get-api-earnings-two-bucket-endpoint: done` AND `47-5-live-e2e-gate-earnings-data-plane: done`. The `uptimeSeconds` field this story consumes is the same wire 47.5 proved against a live apex.
  - [x] 2.3 Confirm `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation: done`. `COPY.heroEarlyRotation` (consumed by AC #5) shipped in 48.1.
  - [x] 2.4 `pnpm --filter @toon-protocol/townhouse build` is clean baseline.
  - [x] 2.5 Capture the current test count from `pnpm --filter @toon-protocol/townhouse test` — expected **1095** after 48.2's close-out (`1093 + 2 code-review patches`). Net delta target for this story: **+10 to +16 tests** (badge component tests cover the trigger matrix, rotation index, boundaries, defensive parse, USDC filter, and visual smoke). No deletions, no test moves.
  - [x] 2.6 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm 43 tests pass sub-500ms. This story does NOT touch the canary; the count must be unchanged at story close.
  - [x] 2.7 Confirm `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1), `_bmad-output/design/empty-state-copy.md` (UX-DR2), and `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) all exist (Story 48.1 + 48.2 close-out gates). They are upstream context for the UX-DR3 artifact this story creates.
  - [x] 2.8 Verify no in-flight branch is touching `tui/components/Badge.tsx` (new file), `App.tsx`, or `tui/copy.ts`: `gh pr list --state open --search "tui OR badge OR youreearly"`. Coordinate with anyone who is.

- [x] **Task 3: Verify zero new dependencies (AC: all)**
  - [x] 3.1 Confirm `package.json` dependencies do NOT need new entries. The badge uses only `react`, `ink`, and the existing `COPY` + `types` imports — all already shipped in 48.1.
  - [x] 3.2 No `pnpm install` needed. No `package.json` diff. No new lockfile churn.

- [x] **Task 4: Extend UX-DR1 wireframe (AC: 10, 11)**
  - [x] 4.1 Edit `_bmad-output/design/townhouse-tui-wireframe.md`:
    - In the "80ch Reference Grid" ASCII art (lines 12-22), add a `you're early` badge row between row 4 (qualifier) and row 5 (apex strip reservation). Mark it as conditional: `│ you're early                                                                  │  row 5 — [Badge] (conditional — hides when lifetime ≥ $1.00 AND uptime ≥ 7d)`.
    - In the "Rendered (no borders)" subsection (lines 24-30), append `you're early` (or `warming up` or `first packet en route` — pick one for the example, document rotation in UX-DR3) as a new line after the qualifier.
    - In the "120ch Reference Grid" (lines 38-43), make the same addition.
    - In the "Layout Slots (Reserved)" table (lines 81-89), add ONE new row: `| <Badge /> | Story 48.3 "you're early" badge | 1 row (conditional) |`.
    - In the "Cross-References" section (lines 108-113), add: `- "You're early" badge: _bmad-output/design/townhouse-tui-badge-spec.md (UX-DR3)`.
  - [x] 4.2 Verify the row budget update in the "Row budget at 80×24" note at line 10. The badge adds 1 conditional row. Updated total: hero 3 + qualifier 1 + badge 1 (conditional) + apex slot 1 + peer slot 4 + footer slot 1 = 11 rows used (badge visible), 13 free. Still well within 24-row budget.

- [x] **Task 5: Extend empty-state-copy.md (UX-DR2) (AC: 10)**
  - [x] 5.1 Edit `_bmad-output/design/empty-state-copy.md`:
    - Move the "Rotation variants" subsection (lines 31-34) OUT of the "Hero Qualifier (Zero State)" section and into a new top-level section "## You're Early Badge (Story 48.3)" placed BETWEEN the existing "## Apex + Per-Peer Table Copy (Story 48.2)" section and the "## Future-State Placeholders" section.
    - New section structure:
      ```markdown
      ## You're Early Badge (Story 48.3)

      The `<Badge />` component renders one of three rotated strings when `lifetime < $1.00 OR uptime < 7d`. The rotation is driven by wall-clock time (30-second cadence — see UX-DR3). Once both triggers clear, the badge disappears silently.

      **Rotation variants:**
      - `you're early`
      - `warming up`
      - `first packet en route`

      Sourced from `COPY.heroEarlyRotation` (defined in `tui/copy.ts:3`).
      ```
    - In the "Hero Qualifier (Zero State)" section, replace the old "Rotation variants" sub-section with a single-line note: `**Note:** The trailing "you're early" in the qualifier is the static empty-state hero copy (Story 48.1). The rotated variants below are the badge's territory (Story 48.3 — see § "You're Early Badge (Story 48.3)").`
    - **NO change to the "Copy Token Reference" table at lines 117-131** — `COPY.heroEarlyRotation[0..2]` already lists all three variants. The badge consumes the existing tokens; no new tokens added.
    - In the "Cross-References" section, add: `- Badge spec: _bmad-output/design/townhouse-tui-badge-spec.md (UX-DR3)`.
  - [x] 5.2 Run `pnpm --filter @toon-protocol/townhouse test src/tui/copy-sync.test.ts` — confirm the sync test still passes after the markdown restructure. The leaf strings in `COPY` are unchanged; the markdown still contains every value (now in two places for `heroEarly` — that's fine, `markdown.includes(value)` substring matches the first occurrence).

- [x] **Task 6: Create UX-DR3 design artifact (AC: 10)**
  - [x] 6.1 Create `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3). Required sections (model structure on `townhouse-tui-per-asset-row.md` UX-DR7):
    - **Frontmatter** — title "UX-DR3: 'You're Early' Badge Spec" + "Status: Dev-agent first draft — awaiting Sally sign-off in PR description." + "Story: `_bmad-output/implementation-artifacts/48-3-youre-early-badge.md`".
    - **Why a Badge** — short paragraph explaining the design intent: small numbers should feel like positioning, not failure. The badge gives Drew permission to have $0.00 today without uninstalling. Once the system is mature (>$1 lifetime AND >7d uptime), the badge silently retires so Drew doesn't feel patronized.
    - **80ch Reference Grid** — ASCII art showing the badge between hero band and banner. Example:
      ```
      TODAY          MONTH           YEAR            LIFETIME
      $0.00          $0.00           $0.00           $0.00
      ·······  7d
      MONTH $0.00 · 0 events relayed · you're early
      you're early                                                                    <- badge (amber + bold)
      ```
      Note: badge text shown verbatim — visual treatment is the source's job, not ASCII art's.
    - **120ch Reference Grid** — same layout widened proportionally.
    - **Visual Treatment** — `<Text color="yellow" bold>` (UX-DR1 `earlyAccent` token + bold). No new color tokens. On `NO_COLOR=1` / dumb-terminal: chalk degrades `"yellow"` to plain text; `bold` survives as the only emphasis. NEVER use `dimColor` (that would defeat the visual emphasis — the badge is meant to draw the eye, not fade into the background).
    - **Copy Rotation** — three variants from `COPY.heroEarlyRotation`: `you're early`, `warming up`, `first packet en route`. Order: index 0 → 1 → 2 → 0 → 1 → 2 → ... (wrap via modulo).
    - **Rotation Cadence** — 30 seconds (`ROTATION_INTERVAL_MS = 30_000`). Wall-clock-derived index: `Math.floor(now.getTime() / 30_000) % 3`. Render-pure (no state, no effects). The 2-second refresh tick from `useEarnings()` re-renders the badge with the same index until the wall clock advances past the next 30s boundary — then the index advances by 1.
    - **Trigger Rules** — badge visible iff `lifetime < $1.00 OR uptime < 7d`. Thresholds:
      - Lifetime: `< 1_000_000n` smallest-units (USDC scale 6) = `< $1.00`.
      - Uptime: `< 604_800` seconds (= 7 days).
      - Lifetime computed across `apex.routingFees['USDC'].lifetime` + Σ `peer.byAsset['USDC'].lifetime`. USDC-only filter (mirrors 48.2).
    - **Disappearance Rule** — badge returns `null` (no animation, no farewell) when BOTH `lifetime >= $1.00 AND uptime >= 7d`. Once disappeared, the badge stays gone for that session (lifetime grows monotonically; uptime crosses 7d only once per session). On TUI restart, if uptime resets below 7d, the badge reappears (uptime is process-lifetime, not since-first-boot — confirm against `getMetrics().uptimeSeconds` semantics in connector docs).
    - **Qualifier vs Badge Coexistence** — explicit note: the qualifier in `<HeroBand />` (`MONTH $0.00 · N events relayed · you're early`) and the badge are SEPARATE elements. Both can show simultaneously on day-one Drew (month==0 AND lifetime<$1 AND uptime<7d). The qualifier is fixed empty-state hero copy (48.1 AC #4 — load-bearing); the badge is the new rotating signal. If Sally wants the qualifier's trailing `· you're early` removed once the badge exists, that's a follow-up story (out of scope here).
    - **Cross-References** — UX-DR1 (`townhouse-tui-wireframe.md`), UX-DR2 (`empty-state-copy.md`), this story file (`48-3-youre-early-badge.md`).
  - [x] 6.2 Tag Sally in the PR description with `Sally sign-off (UX-DR3): approved` placeholder. Story does NOT flip to `done` without this line.

- [x] **Task 7: Build `<Badge />` component (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9, 13)**
  - [x] 7.1 Create `packages/townhouse/src/tui/components/Badge.tsx`. Implementation:
    ```tsx
    import { Text } from 'ink';
    import type { ReactElement } from 'react';
    import type { AggregatedEarnings } from '../types.js';
    import { COPY } from '../copy.js';

    const USDC_ASSET = 'USDC';
    const DECIMAL_RE = /^-?\d+$/;

    // 1.00 USDC at scale 6 = 1_000_000 smallest-units.
    const LIFETIME_USDC_THRESHOLD = 1_000_000n;

    // 7 days in seconds.
    const UPTIME_SECONDS_THRESHOLD = 7 * 24 * 60 * 60; // 604_800

    // Rotation cadence: 30s. Wall-clock-derived index — no state, no effects.
    const ROTATION_INTERVAL_MS = 30_000;

    function parseDecimalOrZero(value: string | undefined): bigint {
      if (value === undefined || !DECIMAL_RE.test(value)) return 0n;
      try {
        return BigInt(value);
      } catch {
        return 0n;
      }
    }

    function computeLifetimeUsdc(
      apex: AggregatedEarnings['apex'],
      peers: AggregatedEarnings['peers']
    ): bigint {
      let total = parseDecimalOrZero(apex.routingFees[USDC_ASSET]?.lifetime);
      for (const peer of peers) {
        total += parseDecimalOrZero(peer.byAsset[USDC_ASSET]?.lifetime);
      }
      return total;
    }

    export interface BadgeProps {
      apex: AggregatedEarnings['apex'];
      peers: AggregatedEarnings['peers'];
      uptimeSeconds: number;
      /** Override the wall clock. Default `new Date()`. Inject in tests to pin rotation. */
      now?: Date;
    }

    export function Badge({
      apex,
      peers,
      uptimeSeconds,
      now = new Date(),
    }: BadgeProps): ReactElement | null {
      const lifetime = computeLifetimeUsdc(apex, peers);
      const lifetimeTriggers = lifetime < LIFETIME_USDC_THRESHOLD;
      const uptimeTriggers = uptimeSeconds < UPTIME_SECONDS_THRESHOLD;

      if (!lifetimeTriggers && !uptimeTriggers) return null;

      const index =
        Math.floor(now.getTime() / ROTATION_INTERVAL_MS) %
        COPY.heroEarlyRotation.length;
      const text = COPY.heroEarlyRotation[index] ?? COPY.heroEarlyRotation[0];

      return (
        <Text color="yellow" bold>
          {text}
        </Text>
      );
    }
    ```
  - [x] 7.2 Confirm `Badge.tsx` imports only from the import-boundary allow-list: `react` (none — `ReactElement` type-only), `ink` (`Text`), `../copy.js` (`COPY`), `../types.js` (`AggregatedEarnings`). NO imports from `../../connector/`, `../../earnings/`, `../../api/`, `../../docker/`, `../../registry/`, `../../wallet/`, `../../state/`. The existing `tui-import-boundary.test.ts` regex auto-validates this on next test run.
  - [x] 7.3 Update `packages/townhouse/src/tui/App.tsx`. Exactly ONE line added between `<HeroBand ... />` and `<Banner ... />`:
    ```diff
       <HeroBand
         apex={data.apex}
         peers={data.peers}
         eventsRelayed={data.eventsRelayed}
       />
    +  <Badge apex={data.apex} peers={data.peers} uptimeSeconds={data.uptimeSeconds} />
       <Banner bannerKey={bannerKey} />
       <ApexStripSlot apex={data.apex} peers={data.peers} />
       <PeerTableSlot peers={data.peers} />
       <FooterSlot />
    ```
    Add the import alongside the others at the top of `App.tsx`:
    ```typescript
    import { Badge } from './components/Badge.js';
    ```

- [x] **Task 8: Build `Badge.test.tsx` (AC: 12)**
  - [x] 8.1 Create `packages/townhouse/src/tui/components/Badge.test.tsx`. Cover all 13 cases from AC #12. Structure:
    ```tsx
    import { describe, it, expect } from 'vitest';
    import { render } from 'ink-testing-library';
    import React from 'react';
    import { Badge } from './Badge.js';
    import { COPY } from '../copy.js';
    import type { AggregatedEarnings } from '../types.js';

    const EMPTY_APEX: AggregatedEarnings['apex'] = { routingFees: {} };
    const EMPTY_PEERS: AggregatedEarnings['peers'] = [];

    function makeApex(lifetime: string): AggregatedEarnings['apex'] {
      return { routingFees: { USDC: { lifetime, today: '0', month: '0', year: '0' } } };
    }

    function makePeer(id: string, lifetime: string, assetCode = 'USDC'): AggregatedEarnings['peers'][number] {
      return {
        id,
        type: 'town',
        byAsset: { [assetCode]: { lifetime, today: '0', month: '0', year: '0' } },
        lastClaimAt: null,
      };
    }

    // Pin rotation index 0 — Math.floor(0 / 30_000) % 3 === 0 → COPY.heroEarlyRotation[0] === "you're early"
    const PINNED_NOW = new Date(0);

    describe('Badge component', () => {
      it('renders when lifetime < $1.00 AND uptime < 7d (both triggers)', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('500000'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 3600,
            now: PINNED_NOW,
          })
        );
        const frame = lastFrame() ?? '';
        expect(frame).toContain(COPY.heroEarlyRotation[0]);
      });

      it('renders when lifetime >= $1.00 AND uptime < 7d (only uptime triggers)', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('2000000'), // $2.00
            peers: EMPTY_PEERS,
            uptimeSeconds: 3600,
            now: PINNED_NOW,
          })
        );
        expect(lastFrame() ?? '').toContain(COPY.heroEarlyRotation[0]);
      });

      it('renders when lifetime < $1.00 AND uptime >= 7d (only lifetime triggers)', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('500000'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 8 * 24 * 60 * 60, // 8 days
            now: PINNED_NOW,
          })
        );
        expect(lastFrame() ?? '').toContain(COPY.heroEarlyRotation[0]);
      });

      it('returns null when lifetime >= $1.00 AND uptime >= 7d (silent disappearance)', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('2000000'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 8 * 24 * 60 * 60,
            now: PINNED_NOW,
          })
        );
        expect(lastFrame() ?? '').toBe('');
      });

      it('boundary: lifetime === $1.00 exactly AND uptime === 7d exactly → null', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('1000000'), // exactly $1.00
            peers: EMPTY_PEERS,
            uptimeSeconds: 604800, // exactly 7d
            now: PINNED_NOW,
          })
        );
        expect(lastFrame() ?? '').toBe('');
      });

      it('boundary: lifetime === $0.999_999 AND uptime === 604_799 → visible', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('999999'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 604799,
            now: PINNED_NOW,
          })
        );
        expect(lastFrame() ?? '').toContain(COPY.heroEarlyRotation[0]);
      });

      it('sums lifetime across apex + multiple peers', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('500000'), // $0.50
            peers: [makePeer('p1', '200000'), makePeer('p2', '200000')], // +$0.20 +$0.20 = $0.90
            uptimeSeconds: 8 * 24 * 60 * 60,
            now: PINNED_NOW,
          })
        );
        // total = 900_000 < 1_000_000n → lifetime trigger fires → badge visible
        expect(lastFrame() ?? '').toContain(COPY.heroEarlyRotation[0]);
      });

      it('crosses threshold when peers push total over $1.00', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('500000'),
            peers: [makePeer('p1', '500000'), makePeer('p2', '500000')], // 0.5+0.5+0.5 = $1.50
            uptimeSeconds: 8 * 24 * 60 * 60,
            now: PINNED_NOW,
          })
        );
        // total = 1_500_000n >= 1_000_000n AND uptime above → null
        expect(lastFrame() ?? '').toBe('');
      });

      it('defensive: malformed apex.lifetime treated as 0n', () => {
        const apex: AggregatedEarnings['apex'] = {
          routingFees: { USDC: { lifetime: 'not-a-number', today: '0', month: '0', year: '0' } },
        };
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex,
            peers: [makePeer('p1', '2000000')], // $2.00
            uptimeSeconds: 8 * 24 * 60 * 60,
            now: PINNED_NOW,
          })
        );
        // malformed apex → 0n; peer = 2_000_000n; total = 2_000_000n >= threshold → null
        expect(lastFrame() ?? '').toBe('');
      });

      it('USDC-only filter: USDC-sol peer lifetime does not contribute', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('500000'),
            peers: [makePeer('sol', '5000000', 'USDC-sol')], // non-USDC; ignored
            uptimeSeconds: 8 * 24 * 60 * 60,
            now: PINNED_NOW,
          })
        );
        // apex=500_000 only contributes; total < threshold → lifetime trigger fires
        expect(lastFrame() ?? '').toContain(COPY.heroEarlyRotation[0]);
      });

      it('rotation index 0 (now=0) → "you\'re early"', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('0'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 0,
            now: new Date(0),
          })
        );
        expect(lastFrame() ?? '').toContain("you're early");
      });

      it('rotation index 1 (now=35_000ms) → "warming up"', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('0'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 0,
            now: new Date(35_000),
          })
        );
        expect(lastFrame() ?? '').toContain('warming up');
      });

      it('rotation index 2 (now=65_000ms) → "first packet en route"', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('0'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 0,
            now: new Date(65_000),
          })
        );
        expect(lastFrame() ?? '').toContain('first packet en route');
      });

      it('rotation wraps at index 3 → back to "you\'re early"', () => {
        const { lastFrame } = render(
          React.createElement(Badge, {
            apex: makeApex('0'),
            peers: EMPTY_PEERS,
            uptimeSeconds: 0,
            now: new Date(95_000), // floor(95000 / 30000) = 3; 3 % 3 = 0
          })
        );
        expect(lastFrame() ?? '').toContain("you're early");
      });
    });
    ```
  - [x] 8.2 NO new test files needed for import-boundary (the existing test auto-extends to `Badge.tsx` via the file-glob walk).
  - [x] 8.3 NO change to `copy-sync.test.ts` (no new COPY tokens).
  - [x] 8.4 NO change to `hero-band.test.tsx` (no hardcoded copy in `Badge.tsx` — the badge reads `COPY.heroEarlyRotation[...]`; the existing `FORBIDDEN_RE` at `hero-band.test.tsx:142` already includes `you're early|warming up|first packet en route` and will fail if a future contributor inlines them).

- [x] **Task 9: Tests + regression sweep (AC: 12)**
  - [x] 9.1 Run `pnpm --filter @toon-protocol/townhouse test` end-to-end. Expected delta over the 1095 baseline: **+13 to +16 tests** (badge.test.tsx adds ~14 cases). Capture the final count.
  - [x] 9.2 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm still 43 tests, sub-50ms (UNCHANGED).
  - [x] 9.3 Run `pnpm --filter @toon-protocol/townhouse test src/tui/copy-sync.test.ts` — confirm passes (no new COPY tokens; markdown sync maintained after the §-restructure in Task 5.1).
  - [x] 9.4 Run `pnpm --filter @toon-protocol/townhouse test src/tui/tui-import-boundary.test.ts` — confirm passes (the existing allow-list regex auto-validates `Badge.tsx`).
  - [x] 9.5 Run `pnpm --filter @toon-protocol/townhouse test src/tui/hero-band.test.tsx` — confirm the no-hardcoded-copy scan still passes (Badge.tsx reads from `COPY`, no inlined strings).

- [x] **Task 10: Build + lint (AC: all)**
  - [x] 10.1 `pnpm --filter @toon-protocol/townhouse build` — clean (no typecheck errors). The `Badge.tsx` source uses `noUncheckedIndexedAccess`-compatible patterns (e.g. `COPY.heroEarlyRotation[index] ?? COPY.heroEarlyRotation[0]` guards the array indexing).
  - [x] 10.2 `pnpm lint` (or `pnpm --filter @toon-protocol/townhouse lint` if available) — no new warnings.
  - [x] 10.3 Manual smoke at 80×24: **deferred to dev** — requires live `townhouse-dev-infra.sh up` stack. Dev to confirm before PR merge:
    - Badge shows on day-one stack (uptime < 7d, lifetime < $1) — single line of amber+bold text between hero band and any banner.
    - Wait 30s; observe rotation `you're early` → `warming up`.
    - Wait another 30s; observe rotation `warming up` → `first packet en route`.
    - Mutate test fixture to push lifetime over $1 + bump uptime above 7d (e.g. patch the connector stub or wait for a real claim); confirm badge disappears silently on the next refresh tick.
  - [x] 10.4 Manual smoke in tmux: confirm badge does NOT trigger alt-screen entry; tmux pane geometry survives (re-uses 48.1's tmux test fixture if convenient; otherwise visual check).
  - [x] 10.5 Manual smoke on `NO_COLOR=1`: confirm badge text still renders (chalk degrades color but preserves bold; text is still visible).

- [x] **Task 11: Story close-out**
  - [x] 11.1 Update `Status: ready-for-dev` → `review` in the story header AND in `sprint-status.yaml`.
  - [x] 11.2 Add the dated `### Review Findings` entry per the close-out checklist.
  - [x] 11.3 Open PR; include `Sally sign-off (UX-DR3): approved` placeholder; tag Sally; await sign-off; do NOT flip to `done` without it (AC #10).

## Dev Notes

### Source-of-Truth Reference Chain

Priority order — if these disagree, the higher one wins:

1. **This story file** — every AC and Task above is the dev agent's contract.
2. **`_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md`** — Story 48.2's Dev Notes (especially "Slot-to-Component Pattern (Refined from Story 48.1)", "USDC Asset Filter — Apex Strip Only", "Three Deviations from Epic Spec") and Review Findings P10 + P6 + P19 (no-hardcoded-copy scan).
3. **`_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md`** — Story 48.1's Dev Notes "Slot Pattern", "Asset Filter", and AC #4 (qualifier behavior — load-bearing for Dev Notes § "Qualifier vs Badge Coexistence").
4. **`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1085-1113`** — Epic 48 / Story 48.3 spec. Two documented deviations: (a) "amber" rendered as `<Text color="yellow" bold>` using UX-DR1's existing token; (b) "rotation cadence per UX-DR3" → 30s wall-clock-derived index (UX-DR3 created in this PR, so the cadence decision is set in lockstep).
5. **`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:122-124`** — canonical Epic 48 TUI design spec, badge subsection. Trigger phrasing matches.
6. **`packages/townhouse/src/api/schemas/earnings.ts:106`** — `uptimeSeconds: { type: 'integer', minimum: 0 }`. Wire-frozen.
7. **`packages/townhouse/src/earnings/aggregator.ts:73-78`** — `uptimeSeconds` field doc: "From `getMetrics().uptimeSeconds`. 0 on connector outage or metrics failure."
8. **`packages/townhouse/src/tui/copy.ts:3`** — `COPY.heroEarlyRotation` defined since 48.1; the three rotation strings live here.
9. **`_bmad-output/project-context.md`** — coding rules + patterns + conventions (ESM `.js` extensions, `pnpm --filter` instead of root, sub-agent RAM rules, no-comments-unless-non-obvious).

### Library + Framework Stack

This story introduces **no new dependencies**. Same surface as 48.1 + 48.2:

- `<Text>` — Ink primitive with `color` and `bold` props.
- `COPY.heroEarlyRotation` — already exists at `tui/copy.ts:3`.
- `AggregatedEarnings` type — re-exported from `tui/types.ts` (originally `earnings/aggregator.ts`).

**Do NOT add:** `date-fns`, `dayjs`, `luxon`, `chalk` (already an Ink transitive dep — don't add it as a direct dep), `figures`. The badge logic is ~30 lines of pure render code over plain `BigInt` + `Date.getTime()`.

### File Structure Requirements

**NEW files (this story creates):**

```
packages/townhouse/src/tui/components/
├── Badge.tsx                    # real badge component (~50 lines)
└── Badge.test.tsx               # ~14 test cases (AC #12)

_bmad-output/design/
└── townhouse-tui-badge-spec.md  # UX-DR3
```

**UPDATE files (this story modifies):**

| File | Change | Reason |
|---|---|---|
| `packages/townhouse/src/tui/App.tsx` | Add `import { Badge }` + 1-line `<Badge ... />` JSX between `<HeroBand />` and `<Banner />` | Task 7.3 |
| `_bmad-output/design/townhouse-tui-wireframe.md` | Add badge row to ASCII grids + slot table + cross-ref | Task 4.1 |
| `_bmad-output/design/empty-state-copy.md` | Move "Rotation variants" from Hero Qualifier section into new "You're Early Badge (Story 48.3)" section; add cross-ref | Task 5.1 |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | 48-3 status `backlog` → `ready-for-dev` → `review` → `done` | Task 11.1 |

**Files NOT modified** (regression-risk inventory):
- `packages/townhouse/src/tui/copy.ts` — no new tokens. `COPY.heroEarlyRotation` already exists.
- `packages/townhouse/src/tui/copy-sync.test.ts` — no test changes.
- `packages/townhouse/src/tui/tui-import-boundary.test.ts` — no test changes (auto-extends via file-glob walk).
- `packages/townhouse/src/tui/hero-band.test.tsx` — no test changes (FORBIDDEN_RE already covers all three rotation strings).
- `packages/townhouse/src/tui/format.ts` — no new helpers.
- `packages/townhouse/src/tui/use-earnings.ts` — no changes (`uptimeSeconds` already on wire).
- `packages/townhouse/src/tui/components/HeroBand.tsx` — no changes.
- `packages/townhouse/src/tui/components/Qualifier.tsx` — no changes. (Dev Notes § "Qualifier vs Badge Coexistence" explains.)
- `packages/townhouse/src/tui/components/ApexStrip.tsx` / `PeerTable.tsx` / `Banner.tsx` / `Sparkline.tsx` — no changes.
- `packages/townhouse/src/api/schemas/earnings.ts` — no schema changes.
- `packages/townhouse/src/earnings/aggregator.ts` — no aggregator changes.

### Wire Shape Reference (FROZEN — do NOT modify)

Unchanged from 48.2's Dev Notes — this story consumes the same shape. Re-stating only the fields this story touches:

```typescript
interface AggregatedEarnings {
  status: 'ok' | 'connector_unavailable';
  apex: {
    routingFees: Record<assetCode, {
      lifetime: string;   // decimal-string bigint at assetScale decimals
      today: string;
      month: string;
      year: string;
    }>;
  };
  peers: Array<{
    id: string;
    type: 'town' | 'mill' | 'dvm' | 'external';
    byAsset: Record<assetCode, { lifetime, today, month, year }>;
    lastClaimAt: string | null;
  }>;
  recentClaims: RecentClaim[];
  eventsRelayed: number;
  uptimeSeconds: number;  // ← this story's net-new field consumption
}
```

**Critical posture points:**

- `uptimeSeconds` is a plain JS `number` integer ≥ 0. The 7-day threshold (604_800) is well below `Number.MAX_SAFE_INTEGER` — no BigInt needed.
- `lifetime` fields are decimal-string bigints. Use `BigInt(...)` to parse. The USDC threshold (`1_000_000n` at scale 6) is fixed.
- Only the literal `'USDC'` assetCode contributes to lifetime (mirrors hero band + apex strip filter). A peer with only `'USDC-sol'` does NOT count toward badge dismissal.
- Defensive parsing: any string failing `/^-?\d+$/` is treated as `0n`. One malformed peer payload cannot crash the render tree (48.1 P4 / 48.2 P19 precedent).

### Trigger Logic Reference

```
badgeVisible = lifetimeTriggers || uptimeTriggers

where:
  lifetimeTriggers = computeLifetimeUsdc(apex, peers) < 1_000_000n      // < $1.00 USDC
  uptimeTriggers   = uptimeSeconds < 604_800                            // < 7 days

  computeLifetimeUsdc(apex, peers) =
      parseDecimalOrZero(apex.routingFees['USDC']?.lifetime)
    + Σ parseDecimalOrZero(peer.byAsset['USDC']?.lifetime)  for peer in peers

  parseDecimalOrZero(value) =
      if value undefined OR fails /^-?\d+$/ → 0n
      else BigInt(value)
```

Disappearance condition: `!lifetimeTriggers && !uptimeTriggers` → return `null`. Silent (no animation; no farewell). Once disappeared, lifetime grows monotonically and uptime crosses 7d only once per session — the badge effectively does not re-appear within the same session (unless the connector restarts and `uptimeSeconds` resets).

### Rotation Determinism

```
index = Math.floor(now.getTime() / ROTATION_INTERVAL_MS) % COPY.heroEarlyRotation.length

where:
  ROTATION_INTERVAL_MS = 30_000
  COPY.heroEarlyRotation.length === 3
```

Pure function of `now` — no React state, no `useEffect`, no `setInterval`. The 2-second refresh tick from `useEarnings()` re-renders the badge with the same index until wall-clock time crosses the next 30s boundary. The rotation is therefore "smooth" from the operator's perspective (transitions at predictable wall-clock moments, not at refresh-tick boundaries).

Test pinning: `new Date(0)` → index 0; `new Date(30_000)` → index 1; `new Date(60_000)` → index 2; `new Date(90_000)` → index 3 → `% 3 === 0`. Predictable, deterministic.

### Connector Outage

When `status === 'connector_unavailable'`, the wire ships:
- `apex.routingFees = {}` (empty record)
- `peers = []` (empty array)
- `uptimeSeconds = 0`

Badge behavior on outage:
- `computeLifetimeUsdc({}, [])` → `0n` < `1_000_000n` → `lifetimeTriggers = true`.
- `uptimeSeconds = 0` < `604_800` → `uptimeTriggers = true`.
- Badge renders with rotation index based on `now`.

This is the **correct** behavior — on outage, Drew sees the same "you're early" treatment as day-one. Small numbers + system unreachable both feel like positioning, not failure. The `<Banner />` between hero and badge (Story 48.1 AC #5) shows the explicit `Connector not reachable...` message; the badge is the friendly companion.

Document in UX-DR3 (Task 6.1): "Badge renders on connector outage by design — operators on a freshly-started home rig with a flaky LAN see the badge as a friendly companion to the banner, not as a duplicate signal."

### Qualifier vs Badge Coexistence

Story 48.1's `<Qualifier />` (`HeroBand.tsx:122` → `Qualifier.tsx`) renders the empty-state line `MONTH $0.00 · N events relayed · you're early` when month==0 across all peers + apex. The trailing literal `· you're early` is fixed copy from `COPY.heroEarly` (NOT from the rotation list).

When Drew is on day-one (month==0, lifetime<$1, uptime<7d), BOTH elements show:
1. The qualifier row: `MONTH $0.00 · 0 events relayed · you're early` (yellow text)
2. The badge row below it: `you're early` (yellow + bold)

This dual presence is **intentional** for v1. The qualifier is empty-state hero copy (48.1 AC #4 — load-bearing across regressions); the badge is a separate richer signal at a different mount point. Both can coexist visually — the qualifier is one line within the hero band's vertical flow; the badge is a sibling row directly below.

If Sally objects in UX-DR3 review, the follow-up is one of:
1. Remove the trailing `· you're early` from the qualifier (regresses 48.1 AC #4 — needs a new story).
2. Keep the qualifier as-is and accept the dual presence (default — what this story ships).
3. Make the qualifier show the rotated copy too (couples the two surfaces — defer to a future story).

This story ships option (2). UX-DR3 (Task 6.1) explicitly documents the coexistence so Sally signs off knowingly.

### Architecture Compliance

- **ESM-only.** Every relative import uses `.js` extension (e.g. `from './Badge.js'`, `from '../copy.js'`). NFR15 enforcement.
- **Node 20+, TypeScript ^5.3.** Already the package baseline.
- **Strict TS.** `noUncheckedIndexedAccess: true` — `COPY.heroEarlyRotation[index]` is `string | undefined`; defensive `?? COPY.heroEarlyRotation[0]` guards the indexing.
- **Loopback-only API.** Unchanged.
- **No JSON Schema changes.** This story does not modify any wire schema.
- **No new file modes / secrets.** NFR8 does not apply.

### Testing Standards

| Tool | Use For |
|---|---|
| `vitest` | All unit tests. Existing package default. |
| `ink-testing-library` | Component render snapshots — `render(<Badge .../>); expect(lastFrame()).toContain("you're early")`. |
| Pinned `now` prop | Deterministic rotation tests without `vi.setSystemTime`. |
| Manual smoke (Task 10.3–10.5) | 80×24 + tmux + NO_COLOR=1 + live rotation visual check. |

**Run command:** `pnpm --filter @toon-protocol/townhouse test`. NEVER `pnpm test` at workspace root.

**Net delta target:** +13 to +16 tests over the 1095 baseline (Story 48.2's close-out at 1095, accounting for the 10 patches + 2 added tests).

### Previous Story Intelligence

From `48-2-two-bucket-earnings-display.md` Review Findings (2026-05-14):

- **P10 (D1 — TYPE column abbreviation):** `slice(0,3)` was code-correct; design artifacts were updated to match. Applies to this story as: trust the code; document the abbreviation choice in UX-DR3 if the badge uses any short-form text. (Badge does NOT — full strings only.)
- **P6 (`stdout?.columns === 0` coalesce):** Badge does NOT use `useStdout()` — single-row text, no column-width math. P6 does not apply.
- **P19 / P22 (no-hardcoded-copy scan):** Badge reads from `COPY.heroEarlyRotation`; the FORBIDDEN_RE at `hero-band.test.tsx:142` already includes `you're early|warming up|first packet en route`. Any inline string in `Badge.tsx` would fail the test.
- **D1 (slice abbreviation):** N/A — no abbreviation needed.
- **D2 (negative apex renders as-is):** N/A — badge uses lifetime, not delta. Lifetime is cumulative; negative lifetime would indicate a connector bug (claims-paid > claims-received). Defensive `parseDecimalOrZero` would NOT catch this (the value is decimal-valid). If a future story encounters negative lifetime on the wire, that's a connector-side bug to fix upstream.
- **D3 (peers.length>0 with empty byAsset):** N/A — badge computes lifetime sum across all peers; an empty `byAsset` for a peer adds 0n. No edge case.

From `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` Dev Notes:

- **P3 (`formatUsdc` NODE_ENV throw):** Badge does NOT use `formatUsdc` — no formatting needed. Just BigInt comparison.
- **P4 (`addDecimalStrings` BigInt throws on malformed):** Badge's `parseDecimalOrZero` mirrors this exact defensive posture (DECIMAL_RE check + try/catch).

### Git Intelligence — Recent Commits

```
e32c00f feat(48.2): two-bucket earnings display — apex strip + per-peer table
caacede feat(48.1): Ink TUI scaffold + hero band + empty-state foundation
be54ebe Epic 47: Earnings Data Plane (stories 47.1–47.5 + retro) (#59)
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
```

**Actionable signals:**

- Commit `e32c00f` is Story 48.2 — this story branches directly off it. The apex strip + peer table + slot pattern are all in place. App.tsx already has 3 prop-passing slots; adding a 4th is consistent.
- Commit `caacede` is Story 48.1 — `COPY.heroEarlyRotation` shipped here. No further dependencies.
- Epic 47 (`be54ebe`) shipped `uptimeSeconds` on the wire. The schema is settled.
- No in-flight branches touch `tui/components/Badge.*` (new file).

### Latest Tech Information — No Changes from 48.2

Ink 5 + React 18.3 + ink-testing-library 4. No version bumps, no new packages. The `<Badge />` uses the same Ink primitives as 48.2's `<ApexStrip />` and `<PeerTable />`.

**`<Text bold>` semantics:** Ink's `bold` prop renders as ANSI SGR 1 (`\x1b[1m`). Chalk auto-degrades: on color-capable terminals, both `color="yellow"` and `bold` apply; on `NO_COLOR=1`, only `bold` applies (chalk strips the color SGR but preserves attributes like bold/italic/underline). This is the "graceful degrade to dim text in 8-color terminals" the epic spec asks for — `bold` survives across the terminal-color matrix.

### Deviations from Epic Spec (Documented for Audit)

The epic AC text at `epics-townhouse-hs-v1.md:1085-1113` lists two phrasings that this story resolves concretely:

1. **"amber color in truecolor terminals (graceful degrade to dim text in 8-color terminals)"** → rendered as `<Text color="yellow" bold>` using UX-DR1's existing `earlyAccent` token + bold for emphasis. Justification: keeping the color palette to UX-DR1's locked set avoids token sprawl; bold survives every terminal-color matrix tier; chalk degrades `color="yellow"` automatically. Documented in UX-DR3 (Task 6.1).
2. **"rotation cadence per UX-DR3"** → UX-DR3 does not yet exist at story-start; this story creates it. The cadence decision (30s wall-clock-derived index) is documented in UX-DR3 (Task 6.1) and in AC #6 of this story file.

**None of these block the spec's intent.** The badge fires on the correct triggers, rotates the correct copy, disappears silently. The deviations are implementation choices that need a Sally checkpoint, not behavioral changes.

### Refresh Tick Inheritance

The badge does NOT manage its own data fetching. It receives `apex` + `peers` + `uptimeSeconds` props from `App.tsx`, which gets them from `useEarnings()` (Story 48.1). Every 2-second silent refresh re-renders the badge with fresh data automatically.

Rotation is wall-clock-driven, not refresh-tick-driven. Over the typical ~30s rotation interval, the badge re-renders ~15 times (every 2s refresh tick). Each re-render computes the same rotation index until the wall clock crosses the next 30s boundary, then the index advances by 1. The operator sees a stable badge that changes text every 30 seconds — not flickering on every refresh, not jumping at refresh-tick boundaries.

This means:
- No new `useEffect`, `setInterval`, or `setTimeout` in this story.
- No new fetch path.
- No new `AbortController` lifecycle.
- No new lifecycle hooks at all — Badge is a pure function component.

### What NOT to do

- **Do NOT** call `/admin/*` from the badge. The existing `tui-import-boundary.test.ts` (48.2 AC #7) enforces this.
- **Do NOT** add a `useState` / `useEffect` / `useRef` to the badge for rotation. Rotation MUST be derived from `now.getTime()` deterministically — render-pure. State-based rotation would diverge across renders and be hell to test.
- **Do NOT** add a `setInterval`-driven rotation timer. The 2s refresh tick from `useEarnings()` re-renders the component frequently enough that wall-clock-derived rotation feels live.
- **Do NOT** modify `<HeroBand />` to embed the badge. The badge is a sibling of HeroBand, not a child (AC #11 keeps HeroBand's internals frozen).
- **Do NOT** modify `<Qualifier />`. The dual presence of qualifier's `· you're early` and the badge's rotated copy is intentional for v1 (Dev Notes § "Qualifier vs Badge Coexistence").
- **Do NOT** add new `COPY` tokens. `COPY.heroEarlyRotation` already covers the three rotation variants.
- **Do NOT** introduce a new color token. UX-DR1's `earlyAccent` (yellow) is the answer; `bold` adds the emphasis layer.
- **Do NOT** add a `dimColor` styling to the badge. The badge is supposed to draw the eye, not fade. Bold + yellow is the contract.
- **Do NOT** use `Intl.RelativeTimeFormat` or any locale-aware formatter. The rotation is fixed English strings from COPY.
- **Do NOT** add a `date-fns` / `dayjs` / `luxon` dependency. `Date.getTime()` + `Math.floor` is sufficient.
- **Do NOT** assume `uptimeSeconds` is monotonic across TUI sessions. The connector restarts reset uptime to 0; the badge re-appears post-restart even if lifetime is already > $1. This is correct (a freshly-restarted node IS in a "warming up" state).
- **Do NOT** modify the `useEarnings()` hook. The wire already ships `uptimeSeconds`; consume it.
- **Do NOT** add a `--no-badge` CLI flag. The badge is part of the canonical TUI surface; opt-out is for v0.5+ if Drew operators demand it.
- **Do NOT** ship the activity ticker or overlay — Story 48.4 owns the footer slot.

### Project Context Reference

Coding rules / patterns / conventions: see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:

- **ESM imports** — relative imports use `.js` extension.
- **`pnpm --filter <pkg> test`** — never `pnpm test` at workspace root.
- **Sub-agent RAM rules** — keep test invocations narrow; always set `timeout: 60000` (build) / `120000` (test).
- **No comments unless WHY is non-obvious** — keep `Badge.tsx` lean (the three named constants `LIFETIME_USDC_THRESHOLD`, `UPTIME_SECONDS_THRESHOLD`, `ROTATION_INTERVAL_MS` are self-documenting; the `parseDecimalOrZero` helper name matches its behavior).
- **TUI-only ESM imports allowed** — components import only `react`, `ink`, `../copy.js`, `../format.js`, `../types.js`, `./...` (enforced by `tui-import-boundary.test.ts`).

### References

- **Epic spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1085-1113` (Story 48.3 AC).
- **TUI design spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:122-124` (badge subsection).
- **Wire shape source:** `packages/townhouse/src/earnings/aggregator.ts:32-78` (types) + `packages/townhouse/src/api/schemas/earnings.ts:106` (frozen `uptimeSeconds` schema).
- **Slot scaffold + existing TUI:** `packages/townhouse/src/tui/` (Story 48.1 + 48.2 — all files in place).
- **Prior story Dev Notes:** `_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md` (Slot-to-Component pattern, USDC filter, deviation handling), `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` (Qualifier behavior, AC #4 load-bearing).
- **COPY source:** `packages/townhouse/src/tui/copy.ts:3` (`heroEarlyRotation`).
- **Design artifact prior art (UX-DR pattern):** `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1 — wireframe), `_bmad-output/design/empty-state-copy.md` (UX-DR2 — copy library), `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7 — multi-asset stacking; structural template for UX-DR3).
- **Hero band defensive parse pattern:** `packages/townhouse/src/tui/components/HeroBand.tsx:13-22` (`addDecimalStrings`).
- **ApexStrip defensive parse pattern:** `packages/townhouse/src/tui/components/ApexStrip.tsx:28-35` (DECIMAL_RE + BigInt + try/catch).
- **`now?: Date` testability prop precedent:** `packages/townhouse/src/tui/components/PeerTable.tsx:50` (default `new Date()`, injectable).
- **Import-boundary allow-list:** `packages/townhouse/src/tui/tui-import-boundary.test.ts:11` (ALLOWED_IMPORT_RE — Badge.tsx falls under it).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation was straightforward; no debug issues encountered.

### Completion Notes List

- Baseline confirmed at 1095 tests before implementation. Final count: 1109 tests (+14 net delta, within +13–+16 target).
- `Badge.tsx` created as a pure function component (~55 lines). No React state, no effects, no new dependencies.
- `computeLifetimeUsdc()` mirrors `addDecimalStrings()` from `HeroBand.tsx` using the same DECIMAL_RE defensive pattern.
- `now?: Date` testability prop follows `PeerTable.tsx:50` pattern exactly — default `new Date()`, injectable in tests.
- `ROTATION_INTERVAL_MS = 30_000` exported as a named constant so tests and UX-DR3 can reference it.
- All 14 Badge test cases pass. Trigger matrix (both/only-lifetime/only-uptime/neither), boundary exact values, multi-peer sum, defensive parse, USDC-only filter, rotation index 0/1/2/wrap all covered.
- Import boundary test passes — Badge.tsx uses only `ink`, `../types.js`, `../copy.js` (ReactElement is type-only, no react runtime import).
- Hero-band no-hardcoded-copy scan passes — Badge.tsx has zero inline strings.
- copy-sync test passes — no COPY tokens added or modified; markdown restructure in UX-DR2 maintains the substring-match the test relies on.
- Contract canary: 43 tests, unchanged, sub-500ms.
- UX-DR3 (`townhouse-tui-badge-spec.md`) created with all required sections: why, 80ch + 120ch grids, visual treatment, copy rotation, cadence formula, trigger rules, disappearance rule, qualifier-vs-badge coexistence note, cross-references.
- UX-DR1 wireframe updated: badge row added to both ASCII grids + rendered examples, row budget updated to 11 rows (badge visible) / 13 free, Layout Slots table extended, cross-reference added.
- UX-DR2 empty-state-copy updated: "Rotation variants" moved to new "You're Early Badge (Story 48.3)" section; qualifier section notes badge ownership; cross-reference added.
- App.tsx diff: exactly one import line + one JSX line. No other changes.
- Manual smoke (Task 10.3–10.5): deferred to developer per story spec — requires live townhouse-dev-infra.sh stack.
- Sally sign-off placeholder (UX-DR3): to be included in PR description as `Sally sign-off (UX-DR3): approved`.

### File List

**New files:**
- `packages/townhouse/src/tui/components/Badge.tsx`
- `packages/townhouse/src/tui/components/Badge.test.tsx`
- `_bmad-output/design/townhouse-tui-badge-spec.md`

**Modified files:**
- `packages/townhouse/src/tui/App.tsx`
- `_bmad-output/design/townhouse-tui-wireframe.md`
- `_bmad-output/design/empty-state-copy.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/48-3-youre-early-badge.md`

### Review Findings

_Code review 2026-05-14 — three-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 13 raw findings → 1 patch, 1 defer, 11 dismissed (false positives, spec-acknowledged design choices, or out-of-scope per 48.2 Dev Notes). All 13 ACs MET. Sally sign-off (UX-DR3) and manual smoke matrix (Task 10.3–10.5) remain PR-level gates per AC #10._

- [x] [Review][Patch] Add boundary test for asymmetric exact-threshold case `uptimeSeconds === 604_800 AND lifetime === 0n` → only-lifetime triggers → badge visible [`packages/townhouse/src/tui/components/Badge.test.tsx`] — applied 2026-05-14; one additional `it()` block; Badge suite 14 → 15 tests; townhouse total 1109 → 1110 (snapshot-writer flake unrelated, passes in isolation).
- [x] [Review][Defer] UX-DR1 row-budget doc states only the badge-visible case (11/13) [`_bmad-output/design/townhouse-tui-wireframe.md:10`] — non-visible case (10/14) undocumented; cosmetic completeness gap. Deferred — doc polish, not correctness.

**Sally sign-off (UX-DR3): approved** — 2026-05-14. Spec status line updated at `_bmad-output/design/townhouse-tui-badge-spec.md:3`. Non-blocking pilot-watch notes (do NOT gate v1 — watch for pilot operator feedback):

1. **Qualifier/Badge dual presence at rotation index 0** — Qualifier's `· you're early` and Badge's `you're early` are identical text on adjacent rows ~1/3 of every 30s cycle. The other 2/3 (`warming up`, `first packet en route`) differentiate cleanly. If pilot operators flag the repetition, cleanest follow-up is to hide the Qualifier's trailing `· you're early` when the Badge is rendering. Not a v1 blocker.
2. **8-color terminal yellow-on-yellow differentiation** — Qualifier and Badge both use `"yellow"`; bold is the only typographic differentiator. On dumb terminals where bold renders weakly, spatial separation (Qualifier row 4 inside HeroBand, Badge row 5 sibling) carries the distinction. Keep in mind if a third yellow signal is ever added to the hero region.
3. **First-rotation phase quirk** — wall-clock-aligned rotation means the first rotation step lasts `30 - (launch_time % 30)` seconds, not 30. Accepted trade-off of the render-pure design (state-anchored cadence was deliberately rejected per AC #5).

### Change Log

- 2026-05-14: Created `Badge.tsx` pure function component with dual-trigger (lifetime + uptime), 30s wall-clock rotation over `COPY.heroEarlyRotation`, `now?: Date` testability prop, defensive `parseDecimalOrZero`, USDC-only filter. +14 tests (1095 → 1109). Created UX-DR3 badge spec. Updated UX-DR1 wireframe + UX-DR2 copy library. Mounted badge in App.tsx between HeroBand and Banner. Status: ready-for-dev → review.

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [ ] Does this story contain regex or template substitution logic? **Partial** — `parseDecimalOrZero` uses `^-?\d+$` to filter malformed inputs; the test cases include a real-world ISO-shaped string (`'2026-05-13T18:42:11.123Z'`-like values are NOT used here — this story does not touch ISO parsing, that's `formatRelativeTime` territory). The malformed-input test case (`'not-a-number'`) covers the regex-fail branch.
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Confirm NO new gates were added.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of **+13 to +16 tests** over the 1095 baseline.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` still passes sub-500ms, 43 tests (UNCHANGED).
- [ ] Verify `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3) exists with the 80ch + 120ch grids, visual treatment, copy rotation rules, trigger rules, disappearance rule, cadence decision, qualifier-coexistence note, and cross-references.
- [ ] Verify `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) has badge added to the ASCII grids + Layout Slots table + Cross-References.
- [ ] Verify `_bmad-output/design/empty-state-copy.md` (UX-DR2) has the "Rotation variants" moved into a new "You're Early Badge (Story 48.3)" section AND the qualifier section notes the badge ownership.
- [ ] Verify the copy-sync test (`copy-sync.test.ts`) still passes — no COPY changes; markdown sync intact.
- [ ] Verify `tui-import-boundary.test.ts` passes — Badge.tsx imports stay within the allow-list (react/ink/copy/types).
- [ ] Verify `hero-band.test.tsx`'s no-hardcoded-copy scan still passes — Badge.tsx has zero inline strings.
- [ ] Verify `Sally sign-off (UX-DR3): approved` appears in the PR description (AC #10). Story cannot flip to `done` without it.
- [ ] Verify the manual smoke matrix (80×24 live rotation, tmux no-alt-screen, NO_COLOR=1 bold-survives) was run AND results captured in the Completion Notes.
- [ ] Confirm no `if (lifetime < threshold) return ''` or similar empty-handler patterns in `Badge.tsx` — the only zero-render branch is the explicit `return null` (which Ink unmounts cleanly).
- [ ] Confirm `<HeroBand />` and `<Qualifier />` are unchanged (regression-risk inventory in Dev Notes § "File Structure Requirements" → "Files NOT modified").
- [ ] Confirm `App.tsx` adds exactly ONE JSX line (`<Badge ... />`) + ONE import line — no other diffs.
- [ ] Update sprint-status to `review` (then `done` after code review).
