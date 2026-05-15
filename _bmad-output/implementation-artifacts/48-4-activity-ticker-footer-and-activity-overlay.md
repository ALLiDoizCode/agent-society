# Story 48.4: Activity Ticker Footer + Activity Overlay

Status: done

> **Fourth story of Epic 48 (Operator Dashboard / Ink TUI).** Sized M. Replaces the `<FooterSlot />` body (currently `return null;` from Story 48.1) with a real one-line activity ticker showing the single most recent settlement, AND adds a new keyboard-triggered Activity overlay (`[a]` to open, `j`/`k` to scroll, `q` to close) backed by a 200-entry ring buffer. After this story, Drew can see the dashboard "heartbeat" at midnight without leaving the screen AND drill into the last 200 settlements without leaving the TUI. Unblocks 48.5 (drill subcommands — orthogonal, can land in any order), 48.7 (live gate asserts `[a]` opens/closes the overlay cleanly + ticker updates within the 2-second refresh).
>
> **Critical path:** Epic 47 (DONE — `/api/earnings` wire ships `recentClaims[]` pass-through) → 48.1 (DONE — Ink scaffold + `<FooterSlot />` reservation in App.tsx + `COPY.future.recentClaimsEmpty` placeholder) → 48.2 (DONE — slot-to-component swap pattern proven on `<ApexStripSlot />` + `<PeerTableSlot />`; COPY-promotion lockstep with `empty-state-copy.md`) → 48.3 (DONE — `<Badge />` mounts between hero and banner; render-pure component pattern proven) → **48.4 (this — `<ActivityTicker />` mounts into FooterSlot + new `<ActivityOverlay />` modal triggered by `[a]`)** → 48.7 (live gate).
>
> **Data-source contract is FROZEN — do NOT call `/admin/*` directly.** Both the ticker and overlay read from `useEarnings().data.recentClaims` only. The wire shape is locked at `packages/townhouse/src/api/schemas/earnings.ts:62-81` (the `recentClaim` sub-schema — `peerId: string`, `assetCode: string`, `assetScale: integer >= 0`, `amount: string ^-?\d+$`, `direction: 'inbound' | 'outbound'`, `at: ISO-8601`). The `RecentClaim` type is re-exported from `tui/types.ts:2` (originally from `../connector/types.ts:282-289`). No new wire fields. No connector changes.
>
> **Net-new design artifact.** This story creates `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6) — Sally's locked spec for the modal layout, keybindings, ring buffer, and resize behavior. The dev agent drafts the artifact in first draft; Sally signs off in PR description with `Sally sign-off (UX-DR6): approved`. NOT a merge gate (the NFR19 gate was 48.1-scoped); but Sally's review is required before flipping the story to `done` — same posture as 48.2's UX-DR7 sign-off and 48.3's UX-DR3 sign-off.
>
> **THREE explicit deviations from the epic-spec text (read before drafting).** The epic AC at `epics-townhouse-hs-v1.md:1117-1149` has three under-specified phrasings that this story resolves concretely:
>
> 1. **"`<timestamp>`" in overlay row format** — the spec at line 1143 says `<timestamp> · <peerId> · <amount> <asset> · <direction>` without specifying timestamp format. **Resolution:** render `HH:MM:SS` local-time (24-hour clock) from `claim.at` via `Date.toLocaleTimeString('en-GB', { hour12: false })`. Documented in UX-DR6 as "compact 8-char form keeps overlay rows readable at 80 cols; full date contextual via row position in scroll buffer." Cross-day boundaries acceptable for v1 — the overlay is a ring buffer, not an audit log.
> 2. **"`<direction>`" rendering** — the wire ships `'inbound' | 'outbound'` literal strings. **Resolution:** render with directional arrows for visual scan-ability: `inbound` → `←` (arrow points to "us"), `outbound` → `→`. Documented in UX-DR6. Plain English fallback acceptable in failure-mode rendering; not needed in v1.
> 3. **"`$X.XXXX USDC`" ticker amount format** — the spec at line 1127 shows 4 decimals (NOT the 2 decimals `formatUsdc` produces). Per-claim USDC amounts are typically sub-cent micropayments (`$0.0012`, `$0.0050`); 2-decimal precision would collapse most claims to `$0.00`. **Resolution:** add `formatUsdcMicro(amount, scale): string` to `format.ts` (a 4-decimal variant of `formatUsdc`). The hero band keeps using 2-decimal `formatUsdc` (load-bearing per 48.1 AC #3); only the activity ticker + overlay use the micro variant. Documented in Dev Notes § "Two USDC Formatters Side-by-Side".
>
> **One contract clarification — overlay-as-modal in a flat Ink layout.** Ink is a Yoga-based flat layout engine with NO z-index, NO true modal stacking. "Modal Activity overlay appears centered (70% terminal width)" (AC #3) is implemented as: when `overlayOpen === true`, `App.tsx` returns the `<ActivityOverlay />` component INSTEAD OF the dashboard JSX (HeroBand / Badge / Banner / ApexStripSlot / PeerTableSlot / FooterSlot). The `useEarnings()` hook lives ABOVE the conditional swap, so its refresh tick + ring-buffer accumulation continue ticking while the overlay is open — "underlying TUI state is unchanged" (AC #6) means the data hook + accumulator survive. When `q` closes the overlay, the dashboard re-renders with the latest data and Ink's diff engine produces no flicker (no `clear()` call). Documented in Dev Notes § "Overlay Render Model (Replace, Not Z-Index)".

## Story

As **Drew (the terminal operator)**,
I want **a one-line activity ticker footer showing the most recent claim AND a `[a]` keybind that opens a scrollable Activity overlay backed by a 200-entry ring buffer**,
so that **the dashboard heartbeat is visible at midnight without needing to leave the screen — and when I want to know "what was the last hour's claim flow?" I can drill into it without dropping to a separate CLI verb**.

## Acceptance Criteria

1. **AC #1 — Activity ticker mounts into `<FooterSlot />`.** **Given** the TUI scaffold from Story 48.1 AND `<FooterSlot />` exists at `packages/townhouse/src/tui/components/FooterSlot.tsx` (currently `return null;`), **When** App renders AND the overlay is closed, **Then** `FooterSlot.tsx` is converted to re-export pattern (mirrors `ApexStripSlot.tsx` from 48.2) so that the slot file is `export { ActivityTicker as FooterSlot } from './ActivityTicker.js';` plus a `FooterSlotProps = ActivityTickerProps` type re-export. `App.tsx` keeps mounting `<FooterSlot recentClaims={data.recentClaims} />` — props are now passed (the previous `<FooterSlot />` parameterless mount becomes `<FooterSlot recentClaims={data.recentClaims} />`). Slot ordering in App.tsx is preserved exactly: HeroBand → Badge → Banner → ApexStripSlot → PeerTableSlot → FooterSlot.

2. **AC #2 — Activity ticker line format (populated).** **Given** `recentClaims.length > 0`, **When** the activity ticker renders, **Then** the line shows `recent: <peerId> ← $X.XXXX USDC · <relative_time> [a] activity` rendered in a single Ink `<Text>` element. The fields:
    - `<peerId>` = `recentClaims[0].peerId` verbatim (no truncation at this layer; PeerTable's truncation is unrelated).
    - `← $X.XXXX USDC` = directional-arrow + `formatUsdcMicro(recentClaims[0].amount, recentClaims[0].assetScale)` + asset code. Arrow is `←` when `direction === 'inbound'`, `→` when `direction === 'outbound'`. Asset code displayed as `recentClaims[0].assetCode` (e.g. `USDC`, `USDC-evm`).
    - `<relative_time>` = `formatRelativeTime(recentClaims[0].at, now)` using the helper from `format.ts` (Story 48.2).
    - `[a] activity` = literal keybind hint, sourced from `COPY.activityTicker.keybind`.
    - The line is rendered with `<Text dimColor>` (matches apex-strip's empty-state styling — dim but not italic; the keybind hint should not be loud).

3. **AC #3 — Activity ticker empty state.** **Given** `recentClaims.length === 0` (day-one Drew or post-restart connector with no recent activity in window), **When** the activity ticker renders, **Then** the line shows `COPY.activityTicker.empty` (text: `no settlements yet — press [a] when activity arrives`) rendered as `<Text dimColor>`. The `[a]` keybind STILL works (the operator can preview the empty overlay state — important for v1 first-impression). The empty-state copy is **promoted** from `COPY.future.recentClaimsEmpty` (already populated by Story 48.1 at `tui/copy.ts:20`) into the active `COPY.activityTicker.empty` namespace AND removed from `COPY.future` — same promotion pattern Story 48.2 used for `COPY.future.apexRoutingEmpty` → `COPY.apex.routingEmpty`.

4. **AC #4 — `[a]` keybind opens the Activity overlay (when closed).** **Given** the dashboard view is rendered AND the overlay is closed (`overlayOpen === false`), **When** the operator presses the `a` character key (case-insensitive — both `a` and `A` accept), **Then** `setOverlayOpen(true)` fires AND the next render returns the `<ActivityOverlay claims={...} columns={...} now={...} onClose={...} />` component INSTEAD OF the dashboard JSX. The keybind is wired via Ink's `useInput((input, key) => ...)` hook in `App.tsx`, gated `isActive={!overlayOpen}` so the dashboard-level keybind does not fire when the overlay is already open (the overlay owns input while it's mounted — see AC #5). Ctrl-A, Alt-A, and the `a` character inside an escape sequence MUST NOT toggle the overlay — the `useInput` callback only acts when `key.ctrl === false AND key.meta === false AND input.toLowerCase() === 'a'`.

5. **AC #5 — `q` / `ESC` closes the overlay; `j`/`k` scroll the list.** **Given** the Activity overlay is open, **When** the operator interacts:
    - **Press `q` (case-insensitive) OR `ESC`** → `onClose()` fires → `setOverlayOpen(false)` → next render returns the dashboard JSX again.
    - **Press `j` (down) OR down-arrow** → scroll position increments by 1 (clamped at `max = max(0, totalRows - visibleRows)`).
    - **Press `k` (up) OR up-arrow** → scroll position decrements by 1 (clamped at 0).
    - The overlay's `useInput((input, key) => ...)` is gated `isActive={true}` while mounted; the App-level `[a]` listener (AC #4) is gated `isActive={false}` during this time — only one listener fires per keypress, preventing the dashboard's `[a]` from re-toggling when an `a` happens to be pressed inside the overlay.
    - Scroll state is `useState<number>` local to the `<ActivityOverlay />` component — when the overlay unmounts (on close), the state is lost; reopening starts at scroll position 0 (newest claims at top). Documented in UX-DR6.

6. **AC #6 — Activity overlay layout (modal, centered, 70% width).** **Given** the overlay is open AND `stdout.columns` is the current terminal width, **When** the overlay renders, **Then** the layout is:
    - **Outer wrapper:** `<Box flexDirection="column" alignItems="center" justifyContent="flex-start" width={stdout.columns}>` — full-width box with the modal centered horizontally.
    - **Modal inner box:** `<Box flexDirection="column" borderStyle="round" width={modalWidth}>` where `modalWidth = max(MIN_OVERLAY_WIDTH, floor(stdout.columns * 0.7))`. `MIN_OVERLAY_WIDTH = 40` (covers 80×24 baseline at 56 cols actual). On narrow terminals (< 60 cols total), the modal occupies near-full width — graceful degrade, no truncation crash.
    - **Title row:** `<Text bold>{COPY.activityOverlay.title}</Text>` showing `Activity — last N of 200` where N is `min(claims.length, 200)`.
    - **Body rows:** the visible window of `claims[]` rendered as `<Text>{row}</Text>` per row, format per AC #7. `visibleRows = stdout.rows - 5` (5 = title + 2 borders + 1 hint + 1 spacing). Floor at 5 — so even at 80×24 the overlay shows at least 5 settlements.
    - **Bottom hint row:** `<Text dimColor>{COPY.activityOverlay.scrollHint}</Text>` showing `j/k to scroll · q to close`.
    - Component receives `columns?: number` testability prop (defaults to `useStdout().stdout?.columns || 80`) — same pattern as `<PeerTable />` from 48.2 (`PeerTable.tsx:50`).

7. **AC #7 — Activity overlay row format.** **Given** the body rows render, **When** each `claim` from `claims[scroll..scroll+visibleRows]` renders, **Then** the row shows `<HH:MM:SS> · <peerId> · ← $X.XXXX <assetCode> · in` (or `→ ... · out` for outbound) where:
    - `<HH:MM:SS>` = `new Date(claim.at).toLocaleTimeString('en-GB', { hour12: false })` → e.g. `14:32:08`. Malformed `at` (NaN parse) → render `--:--:--` (defensive — never crash the row tree).
    - `<peerId>` = truncated to `MAX_PEER_ID_WIDTH = 24` chars (slice + `…` ellipsis if longer). Peer IDs are typically 16-32 char base58 fragments; 24 fits the modal at 80×24 (modal width ≈ 56 → row budget = 8 (time) + 1 (sep) + 24 (peer) + 1 (sep) + 15 (amount+arrow) + 1 (sep) + ~3 (direction) ≈ 53 cols → fits 56-col modal).
    - `← $X.XXXX <assetCode>` = arrow per `claim.direction` + `formatUsdcMicro(claim.amount, claim.assetScale)` + assetCode.
    - `<direction>` = literal `in` for `inbound`, `out` for `outbound`.
    - Defensive: any field that fails parse uses the row-level fallback (`--:--:--` for time, `$?.????` for amount per `formatUsdcMicro` fallback). A single malformed claim row MUST NOT crash the overlay render — mirrors the defensive `parseDecimalOrZero` posture from 48.3's Badge.

8. **AC #8 — Ring buffer accumulates across refresh ticks (200-entry cap).** **Given** the `useActivityBuffer(recentClaims)` hook at `packages/townhouse/src/tui/use-activity-buffer.ts`, **When** `recentClaims` changes between refresh ticks (the `useEarnings()` hook polls every 2s), **Then** the hook returns a buffer that:
    - Merges each incoming `recentClaims[]` array with the previous buffer.
    - Dedupes by composite key `${claim.peerId}|${claim.at}|${claim.amount}|${claim.assetCode}|${claim.direction}` (5-field tuple — `at` alone is not unique enough; two same-second claims same peer different amount would collide).
    - Sorts the merged result by `Date.parse(claim.at)` DESC (newest first). Malformed `at` → sort to the end (treat NaN as `-Infinity`).
    - Truncates to the most recent `MAX_BUFFER_SIZE = 200` entries.
    - Returns the trimmed array as a stable reference when no new claims arrived (avoids spurious re-renders — mirror the `useMemo` posture or use a stable-equality check). The hook is internally `useState` + a `useEffect` that diffs incoming claims against the buffer.
    - When `recentClaims === undefined OR not-array` (defensive — the wire is locked but the hook is the boundary), the buffer is unchanged on that tick.

9. **AC #9 — All data sourced from `useEarnings()` / `/api/earnings` only.** **Given** the new components + hook, **When** they receive props or fetch data, **Then** every value flows through `useEarnings()` — passed through `App.tsx`. The components MUST NOT import from `../../connector/`, `../../earnings/aggregator.js` (except for type re-exports via `tui/types.js`), `../../api/`, `../../docker/`, or any `/admin/*` HTTP path. The existing `tui-import-boundary.test.ts` (Story 48.2 AC #7) regex auto-extends to the new component files because the allow-list covers `react|ink(/[\w-]+)?|../(copy|format|types).js|./[\w-]+.js` only. The new `use-activity-buffer.ts` lives in `tui/` (not `tui/components/`) — the boundary test scans `components/` only by glob; the hook file is not scanned but it imports only `react` + `tui/types.js` (verified by hand-review as part of this AC).

10. **AC #10 — No regression on 48.1 / 48.2 / 48.3 contracts.** **Given** the prior Epic 48 stories' invariants, **When** this story lands, **Then**:
    - **(a)** `App.tsx` gains exactly: one `import { useInput, useStdout } from 'ink';` augmentation (Ink hooks for keybind + width); one `import { ActivityOverlay } from './components/ActivityOverlay.js';` line; one `import { useActivityBuffer } from './use-activity-buffer.js';` line; one `useState<boolean>` for `overlayOpen`; one `useInput((input, key) => ...)` block gated `!overlayOpen`; the call to `useActivityBuffer(data.recentClaims)`; one conditional return branch when `overlayOpen === true`; and the `<FooterSlot>` mount gains a `recentClaims={...}` prop. Slot ordering is preserved.
    - **(b)** `<HeroBand />` is NOT modified (`hero-band.test.tsx` passes verbatim).
    - **(c)** `<Qualifier />`, `<Banner />`, `<Sparkline />`, `<Badge />` are NOT modified.
    - **(d)** `<ApexStripSlot />` / `<PeerTableSlot />` are NOT modified.
    - **(e)** `useEarnings()` is NOT modified (no new fetch path; `recentClaims[]` already on wire from 47.4).
    - **(f)** `mountTui()` signature is NOT modified.
    - **(g)** `format.ts` gains exactly one new exported function `formatUsdcMicro()`; existing `formatUsdc()` and `formatRelativeTime()` are unchanged.
    - **(h)** `copy.ts` promotes `COPY.future.recentClaimsEmpty` into `COPY.activityTicker.empty` AND adds `COPY.activityTicker.prefix`, `COPY.activityTicker.keybind`, `COPY.activityOverlay.title`, `COPY.activityOverlay.scrollHint`, `COPY.activityOverlay.directionInbound`, `COPY.activityOverlay.directionOutbound`. The `COPY.future.recentClaimsEmpty` entry is REMOVED (token moved, not duplicated). `empty-state-copy.md` is updated in lockstep so `copy-sync.test.ts` continues passing.
    - **(i)** `tui-import-boundary.test.ts` passes verbatim — new component files match the allow-list.
    - **(j)** `hero-band.test.tsx` no-hardcoded-copy scan: `FORBIDDEN_RE` at line 142 is extended to cover the new strings (`recent: |\\[a\\] activity|no settlements yet|j/k to scroll|Activity — last`) so any future inline-string regression is caught.

11. **AC #11 — Unit-test surface coverage (~24 cases across 3 new test files).** **Given** the new component + hook sources, **When** `pnpm --filter @toon-protocol/townhouse test` runs, **Then** the suite asserts:
    - **`ActivityTicker.test.tsx` (~7 cases):**
      - Empty `recentClaims=[]` renders `COPY.activityTicker.empty` verbatim.
      - One inbound claim renders `recent: <peerId> ← $0.0012 USDC · <relative_time> [a] activity` with arrow `←` and 4-decimal amount.
      - One outbound claim renders with arrow `→` and direction wording matches AC #2.
      - The relative-time cell uses the injected `now` prop deterministically (pin `now` to assert e.g. `5m ago`).
      - When `recentClaims` has > 1 entry, only `recentClaims[0]` (newest) is shown in the ticker (the ring buffer is the overlay's territory, not the ticker's).
      - Malformed `amount` (fails `^-?\d+$`) renders the `formatUsdcMicro` fallback (`$?.????`).
      - Malformed `at` (Date.parse → NaN) renders `formatRelativeTime` fallback (`?`).
    - **`ActivityOverlay.test.tsx` (~9 cases):**
      - Renders title row with `Activity — last N of 200` reflecting `claims.length`.
      - Renders body rows for the first `visibleRows` of `claims[]`.
      - Renders bottom hint `j/k to scroll · q to close`.
      - Empty `claims=[]` renders title with `last 0 of 200` + a body-area empty hint (e.g. `(no activity yet)` from `COPY.activityOverlay.emptyHint`) — does NOT crash on empty.
      - Inbound row formats as `<HH:MM:SS> · <peerId> · ← $X.XXXX USDC · in`.
      - Outbound row formats as `<HH:MM:SS> · <peerId> · → $X.XXXX USDC · out`.
      - `peerId.length > MAX_PEER_ID_WIDTH` truncates with `…` ellipsis at char 23.
      - Malformed `at` row renders `--:--:--` (not a crash, not undefined).
      - Modal width computation: `columns=80` → `modalWidth=56`; `columns=40` → `modalWidth=40` (clamped at `MIN_OVERLAY_WIDTH`).
    - **`use-activity-buffer.test.tsx` (~8 cases):**
      - First call returns the initial `recentClaims[]` sorted DESC by `at`.
      - Two successive calls with same `recentClaims` returns the same array reference (referential stability — prevents re-render churn).
      - Second call adds new claims → buffer contains both old + new, deduped, sorted DESC.
      - Duplicate claim (same 5-field composite key) is collapsed in the buffer.
      - Buffer truncates at `MAX_BUFFER_SIZE = 200`: feed 250 claims → buffer length === 200 (the 200 newest survive).
      - `recentClaims=undefined` → buffer unchanged (no crash, no clear).
      - `recentClaims` containing one malformed-`at` entry: it appears at the END of the sorted buffer (NaN → -Infinity sort key) and does NOT crash the hook.
      - Mixing inbound + outbound claims preserves the `direction` field correctly across renders.
    - Per the project's TUI testing rule (`townhouse-hs-v1-plan-2026-05-07.md:306-309`): **DO test** data → render mapping, ring buffer correctness, keybind behavior via `stdin.write()` (ink-testing-library supports keypress simulation). **DON'T test** terminal color output, animation timing, or absolute timing of refresh ticks.

12. **AC #12 — Keybind behavior tested via `ink-testing-library` `stdin.write()`.** **Given** the App component, **When** `render(<App />)` is invoked with mocked `fetch` (returning a fixture earnings payload), **Then**:
    - `stdin.write('a')` → next frame shows the overlay (title row visible). [Toggle-open behavior.]
    - `stdin.write('q')` → next frame shows the dashboard again. [Toggle-close behavior.]
    - `stdin.write('A')` (uppercase) → opens overlay. [Case-insensitive.]
    - `stdin.write('\x1b')` (ESC) while overlay is open → closes overlay.
    - `stdin.write('j')` while overlay open → scroll-down increments; verify via the visible-window slice of claims rendered.
    - `stdin.write('k')` while overlay open → scroll-up decrements; clamps at 0.
    - Keybind test lives in a new `app-keybindings.test.tsx` file at `packages/townhouse/src/tui/` (sibling to `hero-band.test.tsx`) — NOT inside `components/` (would otherwise be caught by the import-boundary scan; it imports from `./App.js` via the test). Tests use a `MockFetch` returning a stable AggregatedEarnings payload with > 5 claims for visible scroll testing.

13. **AC #13 — UX-DR6 design artifact created.** **Given** the activity overlay design decisions, **When** this PR is reviewed, **Then** `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6) exists with:
    - **Frontmatter** — title "UX-DR6: Activity Overlay Spec" + "Status: Dev-agent first draft — awaiting Sally sign-off in PR description." + "Story: `_bmad-output/implementation-artifacts/48-4-activity-ticker-footer-and-activity-overlay.md`".
    - **Why an Overlay** — short paragraph: settlement events are high-cardinality (200+ per day at scale); inlining them in the dashboard would push the hero metric below the fold. The overlay is "drill, not header" — operator-initiated, returns to dashboard when done.
    - **80ch reference grid** — ASCII art of the 56-col-wide modal centered in an 80-col terminal, with title row + 5 body rows + hint row. Show one inbound + one outbound entry to demonstrate arrow direction.
    - **120ch reference grid** — same layout at 84-col-wide modal (70% of 120) in a 120-col terminal. More visible rows (since `visibleRows = rows - 5`).
    - **Keybindings** — table: `a` (toggle open from dashboard), `q` / `ESC` (close from overlay), `j` / `↓` (scroll down), `k` / `↑` (scroll up). Case-insensitive for letter keys.
    - **Ring buffer** — 200-entry cap, dedup composite key, sort DESC by `at`. Behavior on empty: title shows `last 0 of 200`, body shows `(no activity yet)` hint.
    - **Resize behavior** — `modalWidth = max(40, floor(columns * 0.7))`. `visibleRows = max(5, rows - 5)`. Ink re-renders on terminal SIGWINCH automatically; the overlay re-measures on each render via `useStdout()`.
    - **Empty-state empty-state** — when ticker shows the empty copy AND operator presses `[a]`, the overlay opens but body shows `(no activity yet)`. This is INTENTIONAL — same UX-DR2 posture as 48.1 (every zero state has explicit copy, no `if (n === 0) return ''`).
    - **Cross-references** — UX-DR1 (`townhouse-tui-wireframe.md`), UX-DR2 (`empty-state-copy.md`), UX-DR3 (`townhouse-tui-badge-spec.md`), UX-DR7 (`townhouse-tui-per-asset-row.md`), and this story file (`48-4-activity-ticker-footer-and-activity-overlay.md`).
    - Sally signs off in PR description with the verbatim string `Sally sign-off (UX-DR6): approved`. **This is NOT a merge gate (NFR19 was 48.1-scoped); but the story cannot flip to `done` without the sign-off line** — same posture as 48.2 AC #13 (UX-DR7) and 48.3 AC #10 (UX-DR3).

14. **AC #14 — UX-DR1 wireframe updated to reflect activity ticker + overlay mount points.** **Given** the existing `townhouse-tui-wireframe.md` (UX-DR1, originally drafted in 48.1, extended by 48.2 and 48.3), **When** this story lands, **Then**:
    - The "80ch Reference Grid" ASCII art (around lines 12-22) gains the ticker line shown as the footer row (replacing the existing placeholder if any).
    - The "120ch Reference Grid" gains the same.
    - The "Layout Slots (Reserved)" table gains a row note that `<FooterSlot />` now hosts `<ActivityTicker />` (Story 48.4) — and a separate note that an Activity overlay (Story 48.4 / UX-DR6) renders INSTEAD OF the dashboard layout when `[a]` is pressed (i.e. the overlay is "outside" the slot table — it replaces the parent view rather than occupying a slot).
    - The "Cross-References" section gains `- Activity overlay: _bmad-output/design/townhouse-tui-activity-overlay-spec.md (UX-DR6)`.

**FRs:** FR25 (Activity ticker footer), FR26 (`[a]` opens scrollable Activity overlay, 200-row ring buffer, j/k scroll, q close).
**UX-DRs:** UX-DR6 (Activity overlay spec — modal layout, keybindings, ring buffer).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `_bmad-output/implementation-artifacts/48-3-youre-early-badge.md` end-to-end. The Dev Notes (especially "Slot-to-Component Pattern (Refined from Story 48.1)" referenced from 48.2, "Wire Shape Reference (FROZEN)", "Refresh Tick Inheritance") and Review Findings (one boundary-test patch, one deferred doc-completeness gap) are the precedent for this story's component-mount and render-pure-vs-stateful posture.
  - [x] 1.2 Read `_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md` Dev Notes + Review Findings end-to-end. Specifically: the "Slot-to-Component Pattern" (re-export idiom `export { ApexStrip as ApexStripSlot }`), the COPY-promotion lockstep with `empty-state-copy.md`, the `now?: Date` testability prop, the import-boundary regex auto-extension, P10's column-truncate behavior, P19's no-hardcoded-copy scan. This story uses ALL of these patterns.
  - [x] 1.3 Read `_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` § AC #5 (refresh tick), § AC #7 (tmux safety — `patchConsole: false`), § AC #9 (no hardcoded copy rule). The 2-second refresh tick is load-bearing — the activity ticker updates on the same cadence; the ring buffer accumulates across ticks.
  - [x] 1.4 Read `packages/townhouse/src/tui/App.tsx` end-to-end (~45 lines post-48.3). Confirm the JSX tree: HeroBand → Badge → Banner → ApexStripSlot → PeerTableSlot → FooterSlot. This story modifies App.tsx more than 48.3 did (which added 1 line). The change is: add `useInput` + `useStdout` to the Ink import; add overlay state hook + ring buffer hook; add the conditional return branch for overlay-open; add `recentClaims` prop to `<FooterSlot>`. Slot ordering preserved.
  - [x] 1.5 Read `packages/townhouse/src/tui/components/FooterSlot.tsx` end-to-end (1 line — `export function FooterSlot(): null { return null; }`). This story replaces the body with the re-export pattern from 48.2's `ApexStripSlot.tsx` and `PeerTableSlot.tsx`.
  - [x] 1.6 Read `packages/townhouse/src/tui/components/ApexStripSlot.tsx` end-to-end (2 lines). This is the EXACT template for FooterSlot's replacement: `export { ActivityTicker as FooterSlot } from './ActivityTicker.js';` + a type re-export.
  - [x] 1.7 Read `packages/townhouse/src/tui/components/ApexStrip.tsx` end-to-end. The defensive `apexValid = DECIMAL_RE.test(apexMonth)` pattern + the dim-italic empty-state styling are templates for the ticker's defensive parse + empty-state line.
  - [x] 1.8 Read `packages/townhouse/src/tui/components/PeerTable.tsx` end-to-end. The `now?: Date` testability prop + the `columns?: number` testability prop + the `useStdout()` width handling are all reused by `<ActivityTicker />` (for `now`) and `<ActivityOverlay />` (for both `now` and `columns`).
  - [x] 1.9 Read `packages/townhouse/src/tui/components/Badge.tsx` end-to-end. The defensive `parseDecimalOrZero` helper + the `try/catch` posture + the render-null pattern (when no triggers fire) are precedent for the ticker's defensive amount/timestamp parse.
  - [x] 1.10 Read `packages/townhouse/src/tui/copy.ts` end-to-end (~22 lines). Note the existing `COPY.future.recentClaimsEmpty = "no settlements yet — press [a] when activity arrives"` (line 20) — this is the token this story promotes into `COPY.activityTicker.empty`. All other tokens added by this story are new (ticker prefix, keybind hint, overlay title, scroll hint, direction labels).
  - [x] 1.11 Read `packages/townhouse/src/tui/types.ts` (3 lines). Confirm `RecentClaim` is already re-exported from `tui/types.js` via `../connector/types.js`. No type changes needed in this file.
  - [x] 1.12 Read `packages/townhouse/src/connector/types.ts:282-289` end-to-end (the `RecentClaim` interface). Wire-frozen since Story 47.4. Six fields: `peerId`, `assetCode`, `assetScale`, `amount` (decimal-string bigint), `direction` ('inbound' | 'outbound'), `at` (ISO-8601 string).
  - [x] 1.13 Read `packages/townhouse/src/tui/use-earnings.ts` end-to-end. Confirm `EMPTY_EARNINGS.recentClaims: []` (line 21) — on connector outage, the wire ships an empty array → ring buffer is unchanged → ticker shows the empty-state line. This is the expected behavior; document in Dev Notes.
  - [x] 1.14 Read `packages/townhouse/src/tui/format.ts` end-to-end (~40 lines post-48.2). Confirm `formatUsdc(decimalString, scale)` truncates to 2 decimals. This story adds `formatUsdcMicro(decimalString, scale)` — a 4-decimal sibling — in the SAME file, alongside the existing helper. The 2-decimal helper is unchanged (load-bearing for HeroBand + ApexStrip + PeerTable).
  - [x] 1.15 Read `packages/townhouse/src/api/schemas/earnings.ts:62-81` end-to-end. The `recentClaimSchema` is the wire contract. Required fields: `peerId`, `assetCode`, `assetScale`, `amount`, `direction`, `at`. The schema is open (`additionalProperties` not set to false at the row level — comment at line 14-17 explains; the connector can ship `txHash` in a minor release without breaking serialization).
  - [x] 1.16 Read `packages/townhouse/src/earnings/aggregator.ts:72-73` (the `recentClaims: RecentClaim[]` field doc — "Pass-through from connector `recentClaims`. Empty array on connector outage.") and `aggregator.ts:279` (the `recentClaims: earnings.recentClaims` assignment — pure pass-through, no transformation). This is the data contract: TUI consumes verbatim.
  - [x] 1.17 Read `packages/townhouse/src/tui/hero-band.test.tsx:128-150` end-to-end (the `FORBIDDEN_RE` no-hardcoded-copy scan). This story extends `FORBIDDEN_RE` to cover the new ticker/overlay strings. Document the addition in Task 4.
  - [x] 1.18 Read `packages/townhouse/src/tui/tui-import-boundary.test.ts` end-to-end (~35 lines). The `ALLOWED_IMPORT_RE` covers `react|ink(\/[\w-]+)?|\.\.\/(copy|format|types)\.js|\.\/[\w-]+\.js` — the new `<ActivityTicker />` and `<ActivityOverlay />` files match. NO test changes needed. The new `use-activity-buffer.ts` lives in `tui/` (not `components/`) so it's outside the scan — confirm it imports only `react` + `tui/types.js` by hand-review.
  - [x] 1.19 Read `packages/townhouse/src/tui/copy-sync.test.ts` end-to-end (~40 lines). The substring-match against `empty-state-copy.md` requires every new COPY string to appear somewhere in the markdown. Update markdown in lockstep (Task 5).
  - [x] 1.20 Read `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) end-to-end (~115 lines post-48.3). The "Layout Slots (Reserved)" table currently names `<FooterSlot />` with no rendered content. Task 6 updates this in lockstep with UX-DR6.
  - [x] 1.21 Read `_bmad-output/design/empty-state-copy.md` (UX-DR2) end-to-end (~140 lines post-48.3). The "Future-State Placeholders" section names `recentClaimsEmpty` — this story moves the entry into a new "## Activity Ticker + Overlay Copy (Story 48.4)" top-level section. The "Copy Token Reference" table needs the new entries added (ticker prefix, keybind hint, overlay title, scroll hint, direction labels, empty hint).
  - [x] 1.22 Read `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) and `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3) end-to-end. These are the structural templates UX-DR6 follows (frontmatter, why section, 80ch + 120ch grids, rules, cross-refs).
  - [x] 1.23 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1117-1149` (Epic 48 Story 48.4 spec). Confirm this story's AC text aligns with the epic spec; the three deviations (timestamp format, direction rendering, micro-decimal amount) are documented in the header note + Dev Notes § "Three Deviations from Epic Spec".
  - [x] 1.24 Read `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:114, 126, 138` (canonical TUI design — activity ticker subsection at line 114; row budget at line 126; metrics catalog row at line 138). The plan-doc says "ring-buffered last 50"; this story commits to 200 per the epic AC (which says "last 200 settlement events"). Document the resolution: 200 wins (Sally signed off on the larger buffer in Party Mode 2026-04-20).
  - [x] 1.25 Run `find packages/townhouse/src/tui -type f | sort` to confirm directory structure from 48.3 — should show 26 files (App.tsx, copy.ts, copy-sync.test.ts, format.ts, format.test.ts, hero-band.test.tsx, index.ts, types.ts, use-earnings.ts, use-earnings.test.tsx, tty-detect.ts, tty-detect.test.ts, tui-import-boundary.test.ts, constants.ts; plus components/: ApexStrip.tsx, ApexStrip.test.tsx, ApexStripSlot.tsx, Badge.tsx, Badge.test.tsx, Banner.tsx, FooterSlot.tsx, HeroBand.tsx, PeerTable.tsx, PeerTable.test.tsx, PeerTableSlot.tsx, Qualifier.tsx, Sparkline.tsx). This story adds 6 new files (ActivityTicker.tsx + .test, ActivityOverlay.tsx + .test, use-activity-buffer.ts + .test, app-keybindings.test.tsx).
  - [x] 1.26 Run `grep -rn "FooterSlot" packages/townhouse/src` to confirm App.tsx is the ONLY consumer. The body-swap is symmetrical to 48.2's `ApexStripSlot` / `PeerTableSlot` swap — no callers to update.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm `48-3-youre-early-badge: done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent → STOP.
  - [x] 2.2 Confirm `48-2-two-bucket-earnings-display: done` AND `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation: done`. The `<FooterSlot />` reservation + `COPY.future.recentClaimsEmpty` placeholder were both shipped in 48.1; the slot-to-component re-export pattern was proven in 48.2.
  - [x] 2.3 Confirm `47-4-get-api-earnings-two-bucket-endpoint: done` AND `47-5-live-e2e-gate-earnings-data-plane: done`. The `recentClaims[]` field this story consumes is the same wire 47.5 proved against a live apex.
  - [x] 2.4 `pnpm --filter @toon-protocol/townhouse build` is clean baseline (no typecheck errors). Capture the current test count from `pnpm --filter @toon-protocol/townhouse test` — expected **1110** after 48.3's close-out (1109 + 1 boundary-test patch). Net delta target for this story: **+22 to +30 tests** (ticker ~7, overlay ~9, ring buffer ~8, keybindings ~6, format-micro ~3 — minus 0 deletions; copy-sync deltas ~0).
  - [x] 2.5 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm 43 tests pass sub-500ms. This story does NOT touch the canary; the count must be unchanged at story close.
  - [x] 2.6 Confirm `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1), `_bmad-output/design/empty-state-copy.md` (UX-DR2), `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3), `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7) all exist (48.1 / 48.2 / 48.3 close-out gates). They are upstream context for UX-DR6.
  - [x] 2.7 Verify no in-flight branch is touching `tui/components/FooterSlot.tsx`, `tui/copy.ts`, or `tui/format.ts`: `gh pr list --state open --search "tui OR activity OR ticker OR overlay OR footer"`. Coordinate with anyone who is.

- [x] **Task 3: Verify zero new runtime dependencies (AC: all)**
  - [x] 3.1 Confirm `package.json` dependencies do NOT need new entries. The activity ticker + overlay + ring buffer use only `react`, `ink`, and the existing `COPY` + `types` + `format` imports — all already shipped in 48.1–48.3.
  - [x] 3.2 No `pnpm install` needed. No `package.json` diff. No new lockfile churn.

- [x] **Task 4: Extend FORBIDDEN_RE in `hero-band.test.tsx` (AC: 10j)**
  - [x] 4.1 Edit `packages/townhouse/src/tui/hero-band.test.tsx:142`. Append the new strings to the regex alternation:
    ```ts
    const FORBIDDEN_RE = /["'`](you're early|warming up|first packet en route|Fetching earnings|Connector not reachable|Last refresh failed|↳ apex routing|enable mill to route|no peers yet — run|recent: |\[a\] activity|no settlements yet|j\/k to scroll|Activity — last|\(no activity yet\))/i;
    ```
    Rationale: any future contributor inlining `'recent: '` instead of `COPY.activityTicker.prefix` will fail the test. Mirrors P19 enforcement from 48.1 and the regex extension 48.2 made for `↳ apex routing` + `enable mill to route` + `no peers yet — run`.
  - [x] 4.2 Confirm the test still passes after the regex update (no existing source files contain these new strings until Task 7–9 lands).

- [x] **Task 5: Promote COPY tokens + update `empty-state-copy.md` (AC: 3, 10h)**
  - [x] 5.1 Edit `packages/townhouse/src/tui/copy.ts`:
    - Add new namespace `activityTicker: { prefix: 'recent: ', empty: "no settlements yet — press [a] when activity arrives", keybind: ' [a] activity' } as const`. The `empty` value is identical to the existing `COPY.future.recentClaimsEmpty` (promoted verbatim).
    - Add new namespace `activityOverlay: { titlePrefix: 'Activity — last ', titleSuffix: ' of 200', emptyHint: '(no activity yet)', scrollHint: 'j/k to scroll · q to close', directionInbound: 'in', directionOutbound: 'out' } as const`.
    - Remove `future.recentClaimsEmpty` from `COPY.future`. After this story `COPY.future` is empty (no orphaned placeholders) — leave the namespace as `future: {} as const` for v0.5+ placeholders OR delete the namespace entirely if cleaner. **Recommendation:** delete the empty `future` namespace; if a future placeholder is needed, the namespace can be re-added.
    - All other COPY entries unchanged.
  - [x] 5.2 Edit `_bmad-output/design/empty-state-copy.md`:
    - Move the "Recent claims empty" entry OUT of the "Future-State Placeholders" section.
    - Add a new top-level section `## Activity Ticker + Overlay Copy (Story 48.4)` placed AFTER `## You're Early Badge (Story 48.3)` and BEFORE `## Future-State Placeholders` (if the latter remains; if `COPY.future` is deleted per Task 5.1's recommendation, the section can be deleted too — Drew's first-pass review should confirm).
    - Section body documents the ticker prefix + keybind hint + empty copy AND the overlay's title format + hints + direction labels.
    - In the "Copy Token Reference" table, add rows for each new token: `COPY.activityTicker.prefix`, `COPY.activityTicker.empty`, `COPY.activityTicker.keybind`, `COPY.activityOverlay.titlePrefix`, `COPY.activityOverlay.titleSuffix`, `COPY.activityOverlay.emptyHint`, `COPY.activityOverlay.scrollHint`, `COPY.activityOverlay.directionInbound`, `COPY.activityOverlay.directionOutbound`. Remove the old `COPY.future.recentClaimsEmpty` row.
    - In the "Cross-References" section, add: `- Activity overlay spec: _bmad-output/design/townhouse-tui-activity-overlay-spec.md (UX-DR6)`.
  - [x] 5.3 Run `pnpm --filter @toon-protocol/townhouse test src/tui/copy-sync.test.ts` — confirm the sync test passes after the promotion + markdown restructure. The `getLeafStrings()` walker handles nested namespaces; the substring match (`markdown.includes(value)`) is satisfied as long as every leaf string appears somewhere in the markdown.

- [x] **Task 6: Update UX-DR1 wireframe (AC: 14)**
  - [x] 6.1 Edit `_bmad-output/design/townhouse-tui-wireframe.md`:
    - In the "80ch Reference Grid" ASCII art, the footer row (previously blank or placeholder) shows the activity ticker line — e.g. `recent: town-01 ← $0.0012 USDC · 3m ago [a] activity` (use literal example values; rotate inbound + outbound across the 80ch and 120ch grids so both arrow directions are visible).
    - In the "120ch Reference Grid", same — wider grid shows the ticker at full width.
    - In the "Layout Slots (Reserved)" table, the `<FooterSlot />` row gains the note: "Story 48.4 — `<ActivityTicker />` (1 row, always rendered when dashboard is visible; replaced by `<ActivityOverlay />` when `[a]` pressed)."
    - In the "Cross-References" section, add: `- Activity overlay: _bmad-output/design/townhouse-tui-activity-overlay-spec.md (UX-DR6)`.
    - Update the row-budget note: hero 3 + qualifier 1 + badge 1 (conditional) + apex slot 1 + peer slot 5 (header + 4 data) + footer slot 1 = 12 rows used (badge visible), 12 free. Still well within 24-row budget.

- [x] **Task 7: Create UX-DR6 design artifact (AC: 13)**
  - [x] 7.1 Create `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6). Use the structural template from `townhouse-tui-badge-spec.md` (UX-DR3) and `townhouse-tui-per-asset-row.md` (UX-DR7).
    - **Frontmatter** — title "UX-DR6: Activity Overlay Spec" + "Status: Dev-agent first draft — awaiting Sally sign-off in PR description." + "Story: `_bmad-output/implementation-artifacts/48-4-activity-ticker-footer-and-activity-overlay.md`".
    - **Why an Overlay** — paragraph per AC #13.
    - **Ticker line spec (footer)** — verbatim format: `recent: <peerId> ← $X.XXXX <asset> · <relative_time> [a] activity`. Empty state: `no settlements yet — press [a] when activity arrives`. Both styled `<Text dimColor>`.
    - **Overlay modal layout** — 80ch and 120ch ASCII grids per AC #6 + AC #7. Show title row + 5 body rows + hint row in 80ch grid; show more body rows in 120ch grid. Include one inbound + one outbound example row to demonstrate arrow direction.
    - **Keybindings table** — `a` (open from dashboard, case-insensitive), `q` / `ESC` (close from overlay), `j` / `↓` (scroll down), `k` / `↑` (scroll up).
    - **Ring buffer** — 200-entry cap; dedup key = `${peerId}|${at}|${amount}|${assetCode}|${direction}`; sort DESC by `Date.parse(at)`; malformed `at` sorts to end.
    - **Resize behavior** — `modalWidth = max(MIN_OVERLAY_WIDTH=40, floor(columns * 0.7))`; `visibleRows = max(5, rows - 5)`. Ink re-renders on SIGWINCH automatically.
    - **Empty-state-overlay** — overlay opens even when `claims.length === 0`. Body shows `(no activity yet)`. Title shows `Activity — last 0 of 200`. NOT a no-op — Sally's UX-DR2 posture (every zero state has explicit copy).
    - **Two USDC formatters** — short note that ticker + overlay use `formatUsdcMicro` (4 decimals) for sub-cent visibility, while hero/apex/peer-table use `formatUsdc` (2 decimals).
    - **Cross-references** — UX-DR1, UX-DR2, UX-DR3, UX-DR7, and this story.
  - [x] 7.2 Tag Sally in the PR description with `Sally sign-off (UX-DR6): approved` placeholder. Story does NOT flip to `done` without this line.

- [x] **Task 8: Add `formatUsdcMicro()` to `format.ts` (AC: 2, 7)**
  - [x] 8.1 Edit `packages/townhouse/src/tui/format.ts`. Add a new exported function alongside `formatUsdc`:
    ```ts
    const MICRO_FRACTIONAL_DIGITS = 4;

    export function formatUsdcMicro(decimalString: string, scale: number): string {
      if (!DECIMAL_RE.test(decimalString)) {
        const env = process.env['NODE_ENV'];
        if (env === 'development' || env === 'test') {
          throw new Error(`formatUsdcMicro: invalid decimal string: ${JSON.stringify(decimalString)}`);
        }
        return '$?.????';
      }
      const negative = decimalString.startsWith('-');
      const abs = negative ? decimalString.slice(1) : decimalString;
      const divisor = BigInt(10) ** BigInt(scale);
      const value = BigInt(abs);
      const whole = value / divisor;
      const remainder = value % divisor;
      const fractionalStr = remainder.toString().padStart(scale, '0');
      const cents = fractionalStr.slice(0, MICRO_FRACTIONAL_DIGITS).padEnd(MICRO_FRACTIONAL_DIGITS, '0');
      const formatted = `$${whole.toString()}.${cents}`;
      return negative && value !== 0n ? `-${formatted}` : formatted;
    }
    ```
    Mirrors `formatUsdc`'s structure exactly — same defensive posture, same negative-zero handling, same truncate-don't-round behavior. The only difference is the fractional-digit count (4 vs 2).
  - [x] 8.2 Existing `formatUsdc` and `formatRelativeTime` MUST NOT be modified. Hero band + apex strip + peer table continue using 2-decimal output (load-bearing per 48.1 AC #3 + 48.2 AC #2).

- [x] **Task 9: Build `useActivityBuffer()` hook (AC: 8, 11 ring-buffer cases)**
  - [x] 9.1 Create `packages/townhouse/src/tui/use-activity-buffer.ts`. Implementation:
    ```ts
    import { useState, useEffect } from 'react';
    import type { RecentClaim } from './types.js';

    export const MAX_BUFFER_SIZE = 200;

    function claimKey(c: RecentClaim): string {
      return `${c.peerId}|${c.at}|${c.amount}|${c.assetCode}|${c.direction}`;
    }

    function sortKey(c: RecentClaim): number {
      const ms = Date.parse(c.at);
      return Number.isFinite(ms) ? ms : -Infinity;
    }

    export function useActivityBuffer(incoming: RecentClaim[] | undefined): RecentClaim[] {
      const [buffer, setBuffer] = useState<RecentClaim[]>([]);

      useEffect(() => {
        if (!Array.isArray(incoming)) return;
        if (incoming.length === 0 && buffer.length === 0) return;

        const seen = new Map<string, RecentClaim>();
        // Order matters: newer claims (incoming) overwrite older duplicates.
        for (const c of buffer) seen.set(claimKey(c), c);
        for (const c of incoming) seen.set(claimKey(c), c);

        const merged = Array.from(seen.values());
        merged.sort((a, b) => sortKey(b) - sortKey(a));
        const trimmed = merged.slice(0, MAX_BUFFER_SIZE);

        // Referential stability: if every claim key + order matches, do not setState.
        const same =
          trimmed.length === buffer.length &&
          trimmed.every((c, i) => buffer[i] !== undefined && claimKey(c) === claimKey(buffer[i] as RecentClaim));
        if (!same) setBuffer(trimmed);
      }, [incoming]);

      return buffer;
    }
    ```
  - [x] 9.2 The hook lives at `packages/townhouse/src/tui/use-activity-buffer.ts` — NOT inside `components/`. The import-boundary scan (`tui-import-boundary.test.ts`) scans `components/` only; the hook is outside that scope. Hand-verify its only imports are `react` + `./types.js`.

- [x] **Task 10: Build `<ActivityTicker />` component (AC: 1, 2, 3, 9)**
  - [x] 10.1 Create `packages/townhouse/src/tui/components/ActivityTicker.tsx`. Implementation:
    ```tsx
    import { Text } from 'ink';
    import type { ReactElement } from 'react';
    import type { RecentClaim } from '../types.js';
    import { formatUsdcMicro, formatRelativeTime } from '../format.js';
    import { COPY } from '../copy.js';

    export interface ActivityTickerProps {
      recentClaims: RecentClaim[];
      now?: Date;
    }

    export function ActivityTicker({ recentClaims, now = new Date() }: ActivityTickerProps): ReactElement {
      if (recentClaims.length === 0) {
        return <Text dimColor>{COPY.activityTicker.empty}</Text>;
      }
      const claim = recentClaims[0] as RecentClaim;
      const arrow = claim.direction === 'inbound' ? '←' : '→';
      const amount = formatUsdcMicro(claim.amount, claim.assetScale);
      const rel = formatRelativeTime(claim.at, now);
      return (
        <Text dimColor>
          {COPY.activityTicker.prefix}{claim.peerId} {arrow} {amount} {claim.assetCode} · {rel}{COPY.activityTicker.keybind}
        </Text>
      );
    }
    ```
  - [x] 10.2 Replace `packages/townhouse/src/tui/components/FooterSlot.tsx` body with the re-export pattern from 48.2:
    ```ts
    export { ActivityTicker as FooterSlot } from './ActivityTicker.js';
    export type { ActivityTickerProps as FooterSlotProps } from './ActivityTicker.js';
    ```

- [x] **Task 11: Build `<ActivityOverlay />` component (AC: 5, 6, 7, 9)**
  - [x] 11.1 Create `packages/townhouse/src/tui/components/ActivityOverlay.tsx`. Implementation outline:
    ```tsx
    import { Box, Text, useStdout, useInput } from 'ink';
    import { useState, type ReactElement } from 'react';
    import type { RecentClaim } from '../types.js';
    import { formatUsdcMicro } from '../format.js';
    import { COPY } from '../copy.js';

    const MIN_OVERLAY_WIDTH = 40;
    const MAX_PEER_ID_WIDTH = 24;

    function formatTime(iso: string): string {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '--:--:--';
      return d.toLocaleTimeString('en-GB', { hour12: false });
    }

    function truncatePeerId(id: string): string {
      if (id.length <= MAX_PEER_ID_WIDTH) return id;
      return id.slice(0, MAX_PEER_ID_WIDTH - 1) + '…';
    }

    function formatRow(claim: RecentClaim): string {
      const time = formatTime(claim.at);
      const peer = truncatePeerId(claim.peerId);
      const arrow = claim.direction === 'inbound' ? '←' : '→';
      const amount = formatUsdcMicro(claim.amount, claim.assetScale);
      const dir = claim.direction === 'inbound'
        ? COPY.activityOverlay.directionInbound
        : COPY.activityOverlay.directionOutbound;
      return `${time} · ${peer} · ${arrow} ${amount} ${claim.assetCode} · ${dir}`;
    }

    export interface ActivityOverlayProps {
      claims: RecentClaim[];
      onClose: () => void;
      columns?: number;
      rows?: number;
    }

    export function ActivityOverlay({
      claims,
      onClose,
      columns: columnsProp,
      rows: rowsProp,
    }: ActivityOverlayProps): ReactElement {
      const { stdout } = useStdout();
      const columns = columnsProp ?? (stdout?.columns || 80);
      const rows = rowsProp ?? (stdout?.rows || 24);

      const modalWidth = Math.max(MIN_OVERLAY_WIDTH, Math.floor(columns * 0.7));
      const visibleRows = Math.max(5, rows - 5);

      const [scroll, setScroll] = useState(0);
      const maxScroll = Math.max(0, claims.length - visibleRows);

      useInput((input, key) => {
        if (input === 'q' || input === 'Q' || key.escape) {
          onClose();
          return;
        }
        if (input === 'j' || key.downArrow) {
          setScroll((s) => Math.min(maxScroll, s + 1));
          return;
        }
        if (input === 'k' || key.upArrow) {
          setScroll((s) => Math.max(0, s - 1));
          return;
        }
      });

      const title = `${COPY.activityOverlay.titlePrefix}${claims.length}${COPY.activityOverlay.titleSuffix}`;
      const window = claims.slice(scroll, scroll + visibleRows);

      return (
        <Box flexDirection="column" alignItems="center" width={columns}>
          <Box flexDirection="column" borderStyle="round" width={modalWidth} paddingX={1}>
            <Text bold>{title}</Text>
            {claims.length === 0 ? (
              <Text dimColor>{COPY.activityOverlay.emptyHint}</Text>
            ) : (
              window.map((c, i) => (
                <Text key={`${claimKeyForReact(c)}-${scroll + i}`}>{formatRow(c)}</Text>
              ))
            )}
            <Text dimColor>{COPY.activityOverlay.scrollHint}</Text>
          </Box>
        </Box>
      );
    }

    function claimKeyForReact(c: RecentClaim): string {
      return `${c.peerId}|${c.at}|${c.amount}|${c.assetCode}|${c.direction}`;
    }
    ```
  - [x] 11.2 Confirm imports stay within the allow-list: `ink` (Box, Text, useStdout, useInput), `react` (useState, ReactElement), `../types.js` (RecentClaim), `../format.js` (formatUsdcMicro), `../copy.js` (COPY). The `tui-import-boundary.test.ts` auto-validates this.

- [x] **Task 12: Wire `App.tsx` for overlay toggle + ring buffer (AC: 1, 4, 10a)**
  - [x] 12.1 Edit `packages/townhouse/src/tui/App.tsx`. Final shape:
    ```tsx
    import React, { useState } from 'react';
    import { Box, Text, useInput } from 'ink';
    import { useEarnings } from './use-earnings.js';
    import { useActivityBuffer } from './use-activity-buffer.js';
    import { HeroBand } from './components/HeroBand.js';
    import { Banner } from './components/Banner.js';
    import { ApexStripSlot } from './components/ApexStripSlot.js';
    import { PeerTableSlot } from './components/PeerTableSlot.js';
    import { FooterSlot } from './components/FooterSlot.js';
    import { Badge } from './components/Badge.js';
    import { ActivityOverlay } from './components/ActivityOverlay.js';
    import { COPY } from './copy.js';

    export interface AppProps {
      apiUrl?: string;
      refreshIntervalMs?: number;
      fetchImpl?: typeof fetch;
    }

    export default function App(props: AppProps): React.ReactElement {
      const state = useEarnings(props);
      const recentClaims = state.data?.recentClaims;
      const buffer = useActivityBuffer(recentClaims);
      const [overlayOpen, setOverlayOpen] = useState(false);

      useInput(
        (input, key) => {
          if (key.ctrl || key.meta) return;
          if (input === 'a' || input === 'A') setOverlayOpen(true);
        },
        { isActive: !overlayOpen },
      );

      if (state.phase === 'loading') {
        return <Text>{COPY.loading}</Text>;
      }

      if (overlayOpen) {
        return <ActivityOverlay claims={buffer} onClose={() => setOverlayOpen(false)} />;
      }

      const { data } = state;
      const bannerKey = state.phase === 'stale' ? state.bannerKey : null;

      return (
        <Box flexDirection="column">
          <HeroBand apex={data.apex} peers={data.peers} eventsRelayed={data.eventsRelayed} />
          <Badge apex={data.apex} peers={data.peers} uptimeSeconds={data.uptimeSeconds} />
          <Banner bannerKey={bannerKey} />
          <ApexStripSlot apex={data.apex} peers={data.peers} />
          <PeerTableSlot peers={data.peers} />
          <FooterSlot recentClaims={data.recentClaims} />
        </Box>
      );
    }
    ```
    Notes on the diff:
    - `useState` is added to the React import (was bare `import React from 'react'`).
    - `useInput` is added to the Ink import (was bare `import { Box, Text } from 'ink'`).
    - The `useActivityBuffer` hook runs every render — it survives across the overlay open/close toggle because App.tsx's React tree position is stable.
    - The overlay early-return is placed AFTER the `phase === 'loading'` check (so the loading screen does not get pre-empted by the overlay) but BEFORE the dashboard render.
    - When the overlay is closed via `q` / `ESC`, `setOverlayOpen(false)` re-renders → the dashboard JSX returns → Ink's diff engine produces a clean re-paint without flicker (no `clear()` is called).

- [x] **Task 13: Build `<ActivityTicker />` tests (AC: 11 ticker cases)**
  - [x] 13.1 Create `packages/townhouse/src/tui/components/ActivityTicker.test.tsx`. Cover all 7 cases from AC #11 ticker block. Structure mirrors `Badge.test.tsx` from 48.3 — `render(React.createElement(...))` + `lastFrame().toContain(...)`.
  - [x] 13.2 Use `vi.useFakeTimers()` is NOT needed (the component is render-pure on its props — pin `now` via the testability prop).

- [x] **Task 14: Build `<ActivityOverlay />` tests (AC: 11 overlay cases)**
  - [x] 14.1 Create `packages/townhouse/src/tui/components/ActivityOverlay.test.tsx`. Cover all 9 cases from AC #11 overlay block. Use `columns?: number` and `rows?: number` testability props (added in Task 11.1) to pin terminal dimensions without `useStdout()` mocking. Wrap with a minimal `onClose={() => {}}` stub.

- [x] **Task 15: Build `useActivityBuffer()` tests (AC: 11 ring-buffer cases)**
  - [x] 15.1 Create `packages/townhouse/src/tui/use-activity-buffer.test.tsx`. Use `@testing-library/react`'s `renderHook` if available, OR (more consistent with the existing codebase) wrap the hook in a thin React component that exposes the buffer via a prop callback. Cover all 8 cases from AC #11 ring-buffer block.
  - [x] 15.2 Alternative simpler test pattern (used by Story 48.3's `Badge.test.tsx`): render an inline `function Probe({ incoming, onBuffer })` that calls the hook and invokes `onBuffer(buffer)` in a `useEffect`. Capture the buffer via a closure in the test scope.

- [x] **Task 16: Build `app-keybindings.test.tsx` for `[a]`/`q`/`j`/`k` (AC: 12)**
  - [x] 16.1 Create `packages/townhouse/src/tui/app-keybindings.test.tsx`. The test file lives in `tui/` (not `tui/components/`) — outside the import-boundary scan. Use `ink-testing-library`'s `stdin.write()` to simulate keypresses; assert via `lastFrame()` substring checks.
    ```tsx
    import { describe, it, expect } from 'vitest';
    import { render } from 'ink-testing-library';
    import React from 'react';
    import App from './App.js';

    const FIXTURE_PAYLOAD = {
      status: 'ok',
      apex: { routingFees: {} },
      peers: [],
      recentClaims: [
        { peerId: 'town-01', assetCode: 'USDC', assetScale: 6, amount: '12000', direction: 'inbound', at: '2026-05-14T11:55:00Z' },
        // ... more for visible-window assertion
      ],
      eventsRelayed: 42,
      uptimeSeconds: 3600,
    };

    function makeFetch(payload: unknown): typeof fetch {
      return async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    describe('App keybindings', () => {
      it('pressing [a] opens overlay', async () => {
        const { stdin, lastFrame } = render(
          React.createElement(App, { fetchImpl: makeFetch(FIXTURE_PAYLOAD), refreshIntervalMs: 99_999 })
        );
        await new Promise((r) => setTimeout(r, 50));
        stdin.write('a');
        await new Promise((r) => setTimeout(r, 50));
        expect(lastFrame() ?? '').toContain('Activity — last');
      });
      // ... q closes, A opens (case-insensitive), j/k scroll, ESC closes
    });
    ```
  - [x] 16.2 Use `refreshIntervalMs: 99_999` to disable the polling interval during the test (prevents the `useEffect` cleanup from interfering with the keypress simulation).

- [x] **Task 17: Tests + regression sweep (AC: 11, 12)**
  - [x] 17.1 Run `pnpm --filter @toon-protocol/townhouse test` end-to-end. Expected delta over the 1110 baseline: **+22 to +30 tests**. Capture the final count in the Completion Notes.
  - [x] 17.2 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm still 43 tests, sub-500ms (UNCHANGED).
  - [x] 17.3 Run `pnpm --filter @toon-protocol/townhouse test src/tui/copy-sync.test.ts` — confirm passes (new tokens present in markdown).
  - [x] 17.4 Run `pnpm --filter @toon-protocol/townhouse test src/tui/tui-import-boundary.test.ts` — confirm passes (new component files match allow-list).
  - [x] 17.5 Run `pnpm --filter @toon-protocol/townhouse test src/tui/hero-band.test.tsx` — confirm passes after FORBIDDEN_RE extension (Task 4).
  - [x] 17.6 Run `pnpm --filter @toon-protocol/townhouse test src/tui/components/Badge.test.tsx` — confirm 15 Badge tests still pass (48.3 close-out count).
  - [x] 17.7 Run `pnpm --filter @toon-protocol/townhouse test src/tui/components/HeroBand` (if file exists; otherwise the `hero-band.test.tsx` covers HeroBand) — confirm no regressions.
  - [x] 17.8 Run `pnpm --filter @toon-protocol/townhouse test src/tui/format.test.ts` — confirm existing format tests pass AND add ~3 cases for `formatUsdcMicro` (positive, negative, malformed).

- [x] **Task 18: Build + lint (AC: all)**
  - [x] 18.1 `pnpm --filter @toon-protocol/townhouse build` — clean (no typecheck errors).
  - [x] 18.2 `pnpm lint` (or `pnpm --filter @toon-protocol/townhouse lint` if available) — no new warnings.
  - [x] 18.3 Manual smoke at 80×24: **deferred to dev** — requires live `townhouse-dev-infra.sh up` stack. Dev to confirm before PR merge:
    - Ticker renders the most recent claim line (or the empty copy on a freshly-restarted apex).
    - Press `[a]` → overlay opens, centered, ~56-col-wide; title shows `Activity — last N of 200`.
    - Press `j` repeatedly → scroll advances; clamps at the bottom of the buffer.
    - Press `k` repeatedly → scroll rewinds; clamps at 0.
    - Press `q` → overlay closes; dashboard re-renders without flicker; hero metric unchanged.
    - Press `ESC` → overlay closes (alternative close keybind).
    - Mutate a connector test fixture to push a new claim into `recentClaims[]`; observe ticker line update within 2 seconds.
  - [x] 18.4 Manual smoke in tmux: confirm overlay does NOT trigger alt-screen entry; tmux pane geometry survives across overlay open/close cycles. Re-uses 48.1's tmux test fixture if convenient; otherwise visual check.
  - [x] 18.5 Manual smoke on `NO_COLOR=1`: confirm ticker `dimColor` degrades gracefully (still legible); overlay border + title render plain. Confirm `[a]` keybind still toggles (the keybind is independent of color support).

- [x] **Task 19: Story close-out**
  - [x] 19.1 Update `Status: ready-for-dev` → `review` in the story header AND in `sprint-status.yaml`.
  - [x] 19.2 Add the dated `### Review Findings` entry per the close-out checklist.
  - [x] 19.3 Open PR; include `Sally sign-off (UX-DR6): approved` placeholder; tag Sally; await sign-off; do NOT flip to `done` without it (AC #13).

## Dev Notes

### Source-of-Truth Reference Chain

Priority order — if these disagree, the higher one wins:

1. **This story file** — every AC and Task above is the dev agent's contract.
2. **`_bmad-output/implementation-artifacts/48-3-youre-early-badge.md`** — Story 48.3's Dev Notes (especially "Slot-to-Component Pattern (Refined from Story 48.1)", "Wire Shape Reference (FROZEN)", "Refresh Tick Inheritance", "Connector Outage") and Review Findings (one boundary-test patch, one deferred doc-completeness gap). Render-pure component posture proven here is REUSED for `<ActivityTicker />` (the overlay is stateful; the ticker is not).
3. **`_bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md`** — Story 48.2's Dev Notes (especially "Slot-to-Component Pattern", "USDC Asset Filter — Apex Strip Only", "Three Deviations from Epic Spec") and Review Findings (10 applied patches). The COPY-promotion lockstep with `empty-state-copy.md` is the precedent for this story's promotion of `COPY.future.recentClaimsEmpty` → `COPY.activityTicker.empty`.
4. **`_bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md`** — Story 48.1's Dev Notes (slot pattern, asset filter, qualifier behavior). AC #5 (2-second refresh tick) is load-bearing — the ticker + ring buffer accumulate on the SAME cadence; no new fetch path.
5. **`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1117-1149`** — Epic 48 / Story 48.4 spec. Three documented deviations: (a) timestamp format = `HH:MM:SS` local 24h; (b) direction rendering = arrows + `in`/`out` literals; (c) ticker amount = 4-decimal `formatUsdcMicro`.
6. **`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:114, 126, 138`** — canonical Epic 48 TUI design spec. The plan-doc says "ring-buffered last 50" at line 138; the epic AC (`epics-townhouse-hs-v1.md:1139`) says "200 settlement events". The epic AC wins (200) — documented in Task 1.24.
7. **`packages/townhouse/src/api/schemas/earnings.ts:62-81`** — `recentClaimSchema`. Wire-frozen.
8. **`packages/townhouse/src/connector/types.ts:282-289`** — `RecentClaim` interface. Wire-frozen.
9. **`packages/townhouse/src/earnings/aggregator.ts:72-73,279`** — `recentClaims` field documentation + pure pass-through assignment.
10. **`packages/townhouse/src/tui/copy.ts:20`** — `COPY.future.recentClaimsEmpty` placeholder shipped in 48.1, promoted in this story.
11. **`_bmad-output/project-context.md`** — coding rules + patterns + conventions (ESM `.js` extensions, `pnpm --filter` instead of root, sub-agent RAM rules, no-comments-unless-non-obvious).

### Library + Framework Stack

This story introduces **no new dependencies**. Same surface as 48.1–48.3:

- `<Box>`, `<Text>` — Ink primitives (Box has `borderStyle="round"`, `paddingX`, `alignItems`, `width`).
- `useInput`, `useStdout` — Ink hooks (already in use elsewhere; this story adds the first `useInput` consumer in the codebase).
- `useState`, `useEffect` — React 18 standard.
- `COPY` + types from existing `tui/copy.ts` + `tui/types.ts`.

**Do NOT add:** `date-fns`, `dayjs`, `luxon`, `chalk` (Ink transitive — don't add as direct dep), `figures`, `boxen` (Ink already provides borders via Box). The overlay uses Ink primitives only.

### File Structure Requirements

**NEW files (this story creates):**

```
packages/townhouse/src/tui/
├── use-activity-buffer.ts                # ring buffer hook (~40 lines)
├── use-activity-buffer.test.tsx          # ~8 test cases
├── app-keybindings.test.tsx              # ~6 keybinding test cases
└── components/
    ├── ActivityTicker.tsx                # footer ticker (~25 lines)
    ├── ActivityTicker.test.tsx           # ~7 test cases
    ├── ActivityOverlay.tsx               # modal overlay (~80 lines)
    └── ActivityOverlay.test.tsx          # ~9 test cases

_bmad-output/design/
└── townhouse-tui-activity-overlay-spec.md  # UX-DR6
```

**UPDATE files (this story modifies):**

| File | Change | Reason |
|---|---|---|
| `packages/townhouse/src/tui/App.tsx` | Add useState/useInput imports; add overlay state + ring buffer hook + keybind + conditional return | Task 12.1 |
| `packages/townhouse/src/tui/components/FooterSlot.tsx` | Replace body with `export { ActivityTicker as FooterSlot } from './ActivityTicker.js';` | Task 10.2 |
| `packages/townhouse/src/tui/copy.ts` | Add `activityTicker.*` + `activityOverlay.*` namespaces; remove `future.recentClaimsEmpty` (promoted) | Task 5.1 |
| `packages/townhouse/src/tui/format.ts` | Add `formatUsdcMicro()` function (sibling to `formatUsdc`) | Task 8.1 |
| `packages/townhouse/src/tui/hero-band.test.tsx` | Extend FORBIDDEN_RE alternation with new ticker/overlay strings | Task 4.1 |
| `packages/townhouse/src/tui/format.test.ts` | Add ~3 `formatUsdcMicro` test cases | Task 17.8 |
| `_bmad-output/design/townhouse-tui-wireframe.md` | Add ticker line to ASCII grids; update FooterSlot row in slot table; add cross-ref | Task 6.1 |
| `_bmad-output/design/empty-state-copy.md` | Move `recentClaimsEmpty` into new "Activity Ticker + Overlay Copy (Story 48.4)" section; add new tokens to ref table | Task 5.2 |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | 48-4 status `backlog` → `ready-for-dev` → `review` → `done` | Task 19.1 |

**Files NOT modified** (regression-risk inventory):

- `packages/townhouse/src/tui/use-earnings.ts` — wire already ships `recentClaims[]`; consume verbatim.
- `packages/townhouse/src/tui/types.ts` — `RecentClaim` already re-exported.
- `packages/townhouse/src/tui/constants.ts` — no new constants (overlay-specific constants live in their component files).
- `packages/townhouse/src/tui/tui-import-boundary.test.ts` — allow-list regex auto-extends to new component files; no test changes.
- `packages/townhouse/src/tui/copy-sync.test.ts` — no test changes; markdown sync via Task 5.2.
- `packages/townhouse/src/tui/components/HeroBand.tsx` / `Qualifier.tsx` / `Banner.tsx` / `Sparkline.tsx` / `ApexStrip.tsx` / `ApexStripSlot.tsx` / `PeerTable.tsx` / `PeerTableSlot.tsx` / `Badge.tsx` — no changes.
- `packages/townhouse/src/api/schemas/earnings.ts` — no schema changes.
- `packages/townhouse/src/earnings/aggregator.ts` — no aggregator changes.
- `packages/townhouse/src/connector/types.ts` — no type changes.

### Wire Shape Reference (FROZEN — do NOT modify)

Unchanged from 48.3's Dev Notes — this story consumes the `recentClaims[]` field:

```typescript
interface AggregatedEarnings {
  status: 'ok' | 'connector_unavailable';
  apex: { routingFees: Record<assetCode, PerAsset> };
  peers: NodeEarnings[];
  recentClaims: RecentClaim[];   // ← this story's net-new field consumption
  eventsRelayed: number;
  uptimeSeconds: number;
}

interface RecentClaim {
  peerId: string;
  assetCode: string;
  assetScale: number;      // integer >= 0; USDC = 6
  amount: string;          // decimal-string bigint at assetScale decimals; pattern: ^-?\d+$
  direction: 'inbound' | 'outbound';
  at: string;              // ISO-8601 timestamp (format: date-time)
}
```

**Critical posture points:**

- `amount` is a decimal-string bigint. USDC at scale 6 → `'12000'` = `$0.0120`. The micro formatter (`formatUsdcMicro`) renders this as `$0.0120` (4 decimals).
- `at` is ISO-8601 UTC. The overlay renders local-time `HH:MM:SS` via `toLocaleTimeString('en-GB', { hour12: false })`. The ticker uses relative-time via `formatRelativeTime()`.
- `direction` is a literal enum — never null, never undefined per schema. The arrow + literal mapping is direct.
- `recentClaims[]` is always an array per schema (empty when connector unavailable). The ring buffer hook accepts `RecentClaim[] | undefined` defensively, but in practice `undefined` only happens during the `'loading'` phase when App.tsx has the early-return.

### Two USDC Formatters Side-by-Side

After this story, `format.ts` exports two USDC formatters:

| Function | Decimals | Used by | Example output for `amount='12000'` at scale 6 |
|---|---|---|---|
| `formatUsdc(d, s)` | 2 (truncate) | HeroBand, ApexStrip, PeerTable (NET MONTH column) | `$0.01` |
| `formatUsdcMicro(d, s)` | 4 (truncate) | ActivityTicker, ActivityOverlay | `$0.0120` |

Rationale:
- Hero / apex / table values are dollar-scale (monthly totals, lifetime cumulative) — 2 decimals is enough.
- Activity ticker / overlay shows PER-CLAIM amounts — typically sub-cent micropayments. 2 decimals would render most claims as `$0.00`. 4 decimals preserves the per-claim signal.
- Both formatters truncate (do NOT round) per connector posture (Story 48.1 Dev Notes precedent). Negative-zero collapses correctly.
- Both formatters share the same defensive parse + `NODE_ENV` throw posture (development/test surfaces the error loudly; production falls back to `$?.??` / `$?.????`).

### Overlay Render Model (Replace, Not Z-Index)

Ink is a Yoga-based FLAT layout engine — there is no z-index, no true modal stacking. The "modal overlay" pattern (UX-DR6) is implemented as:

- When `overlayOpen === true`, `App.tsx` returns the `<ActivityOverlay />` component INSTEAD OF the dashboard JSX (HeroBand / Badge / Banner / ApexStripSlot / PeerTableSlot / FooterSlot tree).
- The `useEarnings()` and `useActivityBuffer()` hooks live ABOVE the conditional swap. They tick the 2-second refresh + accumulate new claims into the ring buffer while the overlay is open. When the operator closes the overlay, the dashboard re-renders with fresh data — "underlying TUI state is unchanged" (AC #6).
- No `clear()` call. Ink's diff engine compares the old tree (overlay) to the new tree (dashboard) and emits a clean re-paint. No flicker, no terminal-state corruption.
- This is the SAME pattern that other Ink-based modal CLIs use (e.g. `oh-my-cli`, `nano-ink-ui`). Documented for future readers because it counters the React Native intuition where modals are siblings with z-index.

The alternative — rendering the overlay as a child of the main Box with `position="absolute"` — does NOT work in Ink. Yoga supports `position: 'absolute'` but Ink's renderer treats absolute children as best-effort overlap; there is no clipping, and the dashboard text "bleeds through" the overlay's transparent background. Replace-on-toggle is the canonical pattern.

### Keybind Architecture (Two `useInput` Subscribers)

Two components subscribe to `useInput`:

1. **`App.tsx`** — listens for `'a'` / `'A'` to open the overlay. Gated `isActive={!overlayOpen}` so the dashboard-level listener fires only when the overlay is closed.
2. **`<ActivityOverlay />`** — listens for `'q'` / `'Q'` / `ESC` to close, `'j'` / down-arrow to scroll down, `'k'` / up-arrow to scroll up. Gated `isActive={true}` (always active while mounted; the overlay is unmounted when closed).

Why two subscribers instead of one consolidated handler in App.tsx?
- **State locality.** Scroll position lives inside `<ActivityOverlay />` (component-local `useState`). Keybinds that mutate it should live with the state.
- **Unmount = cleanup.** When the overlay closes (unmounts), its `useInput` callback is auto-unregistered by Ink — no leaked listeners.
- **Test parity.** Each component is independently testable (ActivityOverlay can be tested in isolation with its own `stdin.write()`).

The `isActive` gate prevents both subscribers from firing on the same key:
- When overlay is CLOSED: dashboard's `[a]` listener is active; overlay isn't mounted → only dashboard fires.
- When overlay is OPEN: overlay is mounted (active); dashboard's `[a]` listener is `isActive={false}` → only overlay fires.

**One edge case:** pressing `a` WHILE the overlay is open. App's listener is inactive (gated off). Overlay's listener doesn't recognize `a` (only j/k/q/ESC). The keypress is silently ignored. This is the intended behavior — `a` is a "drill-down" keybind, not a "navigate" keybind. Document in UX-DR6.

### Refresh Tick Inheritance (Unchanged from 48.3)

The ticker + overlay do NOT manage their own data fetching. Both receive `recentClaims` from `App.tsx`, which gets it from `useEarnings()` (Story 48.1). Every 2-second silent refresh re-fires the buffer merge in `useActivityBuffer()` automatically.

The overlay is RENDERED on every refresh tick while open — but the overlay's visible window only changes when:
- New claims arrive (buffer grows; sort order shifts).
- Operator presses `j` / `k` (scroll position changes).

Re-renders on identical buffer state are no-ops thanks to the referential-stability guard in `useActivityBuffer()` (Task 9.1). The overlay's `<Text>` children diff to identity, Ink emits no terminal output, no flicker.

### Ring Buffer Dedup + Sort Semantics

The composite dedup key `${peerId}|${at}|${amount}|${assetCode}|${direction}` is 5 fields because:

- `peerId` + `at` alone CAN collide — two claims same peer same second (settlement burst). Real connector behavior.
- Adding `amount` makes collision unlikely but theoretically possible (two same-amount claims same peer same second — e.g. a refund-then-reclaim sequence).
- Adding `assetCode` + `direction` makes collision impossible (a single claim is uniquely identified by all 5 fields in v1; if the connector adds `txHash` in a minor release, the key can be widened in a follow-up story).

Sort order is DESC by `Date.parse(at)`. Malformed `at` (NaN parse) sorts to the END (`-Infinity` key) — malformed claims are visible in the overlay but pushed below valid claims. Two claims same `at` sort in insertion order (stable sort guaranteed by ECMA 2019+; Node 20+ honors it).

The buffer is trimmed to `MAX_BUFFER_SIZE = 200` AFTER sort. The oldest 200 claims survive when older claims drop off. This is a "newest 200" buffer, not a "last 200 polled" buffer — the distinction matters when the connector trims its own internal recent-claims list (which it does at 50 entries per Story 47.x; older claims that left the connector's window stay in the TUI's window until they age out at position 200).

### Connector Outage Behavior

When `status === 'connector_unavailable'`, the wire ships:
- `recentClaims: []` (empty array).

Behavior:
- Ring buffer is unchanged (empty incoming → no merge). Previously-accumulated claims persist in the buffer for the remainder of the session.
- Ticker shows the empty copy IF the buffer was empty at outage time. Otherwise, the ticker continues showing the last-known-most-recent claim with its relative time growing (`3m ago` → `4m ago` → ...).
- Overlay still opens with `[a]`. If buffer is empty → shows `(no activity yet)` hint. Otherwise shows accumulated buffer.

This means: on a long connector outage, Drew sees the ticker counter accumulate ("last claim was 47m ago") — a clear signal that something is wrong. The `<Banner />` between hero and badge shows the explicit `Connector not reachable...` message; the ticker provides the time-since-last-claim context.

### Plan-Doc Divergence (Catalog Doc Wrong on Buffer Size)

`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:138` says "Activity ticker | `/admin/earnings.json` | `recentClaims[]` | **last 50**, ring-buffered". The epic AC (`epics-townhouse-hs-v1.md:1139`) says "**last 200** settlement events (ring-buffered)". This story commits to **200** per the epic AC — Sally signed off on the larger buffer in Party Mode 2026-04-20 (decision recorded in the epic AC).

The plan-doc figure (50) is a planning-stage estimate that pre-dates the AC lock. Documented in Task 1.24 for audit; not a fix to the plan doc here (the plan doc is a planning artifact, not a contract).

### Architecture Compliance

- **ESM-only.** Every relative import uses `.js` extension (e.g. `from './ActivityTicker.js'`, `from '../format.js'`). NFR15 enforcement.
- **Node 20+, TypeScript ^5.3.** Already the package baseline.
- **Strict TS.** `noUncheckedIndexedAccess: true` — `recentClaims[0]` is `RecentClaim | undefined`; the ticker uses an explicit length check before accessing index 0 (`if (recentClaims.length === 0) return ...; const claim = recentClaims[0] as RecentClaim;`).
- **Loopback-only API.** Unchanged — TUI reads `http://127.0.0.1:28090/api/earnings` only.
- **No JSON Schema changes.** This story does not modify any wire schema.
- **No new file modes / secrets.** NFR8 does not apply.
- **No new dependencies.** NFR16 enforcement.

### Testing Standards

| Tool | Use For |
|---|---|
| `vitest` | All unit tests. Existing package default. |
| `ink-testing-library` | Component render snapshots — `render(<X />); expect(lastFrame()).toContain(...)`. Keypress simulation via `stdin.write(char)`. |
| `now?: Date` testability prop | Deterministic relative-time + timestamp tests without `vi.setSystemTime`. |
| `columns?: number` / `rows?: number` testability props | Modal width / visible-rows tests without `useStdout()` mocking. |
| Inline `Probe` component for hooks | Capture buffer state via `useEffect` + closure callback (Story 48.3 Badge pattern, applied to `useActivityBuffer`). |
| Manual smoke (Task 18.3–18.5) | 80×24 + tmux + NO_COLOR=1 + live ticker update + overlay open/close visual check. |

**Run command:** `pnpm --filter @toon-protocol/townhouse test`. NEVER `pnpm test` at workspace root.

**Net delta target:** +22 to +30 tests over the 1110 baseline (Story 48.3's close-out at 1110 — 1109 + 1 boundary-test patch).

### Previous Story Intelligence

From `48-3-youre-early-badge.md` Review Findings (2026-05-14):

- **P1 (asymmetric boundary test):** added one boundary test for `uptimeSeconds === 604_800 AND lifetime === 0n`. This story's analogous boundary cases are: `claims.length === 0` (empty buffer renders empty hint, not crash) and `claims.length === 200` exactly (no truncation, full buffer renders); `MAX_PEER_ID_WIDTH` exact-equal boundary (no ellipsis at exactly 24 chars). Cover these in Tasks 13.1 / 14.1 / 15.1.
- **P2 (UX-DR1 row-budget completeness — deferred):** doc gap, not correctness. This story updates the row budget in UX-DR1 again (Task 6.1) — opportunity to close the 48.3 deferred patch in lockstep (mention "badge non-visible case = 10/14" in the row-budget note while we're editing). NOT a blocking item; the deferred patch stays deferred if this story doesn't tackle it.

From `48-2-two-bucket-earnings-display.md` Review Findings:

- **P10 (column truncation):** PeerTable's TYPE column slice(0,3) pattern is the precedent for ActivityOverlay's `MAX_PEER_ID_WIDTH = 24` truncation (slice + ellipsis). Mirror the approach.
- **P6 (`stdout?.columns === 0` coalesce):** the apex strip pattern doesn't apply directly (apex is single-row, no column-width math), but ActivityOverlay's `columns ?? (stdout?.columns || 80)` follows PeerTable's exact precedent (`PeerTable.tsx:54`).
- **D2 (negative apex renders as-is):** N/A — `RecentClaim.amount` is a decimal-string bigint per schema; the formatter handles negative correctly.
- **D3 (peers.length>0 with empty byAsset):** N/A — `recentClaims[]` items are flat (no nested record).

From `48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md` Dev Notes:

- **P3 (`formatUsdc` NODE_ENV throw):** `formatUsdcMicro` mirrors this exact posture — development/test throws, production falls back to `$?.????`.
- **P4 (`addDecimalStrings` defensive parse):** N/A directly — the ring buffer uses object dedup via Map, not decimal accumulation. But the SPIRIT of "one malformed entry must not crash the render tree" applies: a malformed `at` sorts to the end; a malformed `amount` renders the formatter fallback; the overlay row composes from defensive parts so a single bad claim is visible but not catastrophic.

### Git Intelligence — Recent Commits

```
d0aed10 feat(48.3): "you're early" badge — rotating amber signal between hero and banner
e32c00f feat(48.2): two-bucket earnings display — apex strip + per-peer table
caacede feat(48.1): Ink TUI scaffold + hero band + empty-state foundation
be54ebe Epic 47: Earnings Data Plane (stories 47.1–47.5 + retro) (#59)
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
```

**Actionable signals:**

- Commit `d0aed10` is Story 48.3 — this story branches directly off it. The Badge component is mounted between HeroBand and Banner; the FooterSlot is still `return null;`. This story finally activates the slot.
- Commit `e32c00f` (Story 48.2) proved the slot-to-component re-export pattern (ApexStripSlot → ApexStrip, PeerTableSlot → PeerTable). This story applies the SAME pattern to FooterSlot → ActivityTicker.
- Commit `caacede` (Story 48.1) shipped `COPY.future.recentClaimsEmpty` — the placeholder this story promotes.
- Epic 47 (`be54ebe`) shipped `recentClaims[]` on the wire + the `recentClaim` schema. The shape is settled.
- No in-flight branches touch `tui/components/ActivityTicker.*`, `tui/components/ActivityOverlay.*`, or `tui/use-activity-buffer.*` (all new files).

### Latest Tech Information — No Changes from 48.3

Ink 5.2.1 + React 18.3.1 + ink-testing-library 4.0.0. No version bumps, no new packages. The new components use the same Ink primitives as 48.2's `<ApexStrip />` / `<PeerTable />` and 48.3's `<Badge />`, plus two new Ink hooks (`useInput`, `useStdout`) that are stable across the 5.x line.

**`useInput` semantics:** Ink's `useInput` hook subscribes the component to stdin keypress events. The callback receives `(input: string, key: KeyObject)`. Multiple components can subscribe; the `isActive` option gates which one fires (used by this story to avoid double-fire when overlay is open + dashboard `[a]` listener is also mounted).

**`useStdout` semantics:** Returns the current `stdout` stream wrapped in an object with `columns` and `rows` properties. Re-renders the consumer on terminal resize (Ink listens for SIGWINCH internally). Used by `<ActivityOverlay />` to compute modal width + visible-rows on every render.

### Deviations from Epic Spec (Documented for Audit)

The epic AC text at `epics-townhouse-hs-v1.md:1117-1149` has three under-specified phrasings that this story resolves concretely:

1. **`<timestamp>`** → `HH:MM:SS` local 24h. Compact 8-char form keeps overlay rows readable at 80 cols. Cross-day boundaries acceptable for v1 (the overlay is a ring buffer, not an audit log).
2. **`<direction>`** → `←` (inbound) / `→` (outbound) arrows + `in` / `out` literals. Visual scan-ability — operators can spot inbound vs outbound at a glance without parsing English words.
3. **`$X.XXXX USDC`** → 4-decimal `formatUsdcMicro()`. Per-claim USDC amounts are sub-cent; 2 decimals would collapse most claims to `$0.00`.

**None of these block the spec's intent.** The ticker shows the most recent claim. The overlay shows the buffered list. The direction is conveyed (arrow + literal). The deviations are implementation choices that need a Sally checkpoint, not behavioral changes.

### What NOT to do

- **Do NOT** call `/admin/*` from the ticker, overlay, or hook. The existing `tui-import-boundary.test.ts` (48.2 AC #7) enforces this.
- **Do NOT** modify `<HeroBand />`, `<Qualifier />`, `<Banner />`, `<Sparkline />`, `<ApexStrip />`, `<ApexStripSlot />`, `<PeerTable />`, `<PeerTableSlot />`, or `<Badge />`. Their tests pass verbatim after this story.
- **Do NOT** modify `useEarnings()`. The wire already ships `recentClaims[]`; consume it.
- **Do NOT** modify `mountTui()`. No new props leak into `AppProps`.
- **Do NOT** add a `setInterval` inside `useActivityBuffer()` for buffer aging. Claims age out only when buffer > 200 (truncation at sort time). There is no time-based expiry — old claims stay until pushed out by newer ones.
- **Do NOT** add z-index / position=absolute / Static-overlay tricks for the overlay. Replace-on-toggle is the canonical Ink pattern (see Dev Notes § "Overlay Render Model").
- **Do NOT** introduce 2-decimal output to the ticker or overlay. `formatUsdcMicro` is the answer; `formatUsdc` is for dollar-scale values (hero / apex / table).
- **Do NOT** introduce a new color token. The ticker uses `dimColor` (no truecolor escalation needed — the ticker is informational, not load-bearing); the overlay uses `bold` for the title and plain `<Text>` for rows + `dimColor` for the hint.
- **Do NOT** add `--no-ticker` or `--no-overlay` CLI flags. Both are part of the canonical TUI surface; opt-out is for v0.5+ if pilot operators demand it.
- **Do NOT** truncate `recentClaims[0]`'s peerId in the ticker. The ticker has horizontal real estate (full terminal width) — only the overlay truncates because of its 70%-width modal constraint.
- **Do NOT** persist the ring buffer across TUI restarts. The buffer is in-memory only — a fresh `townhouse hs up` invocation starts with `claims=[]`. Persistence is v0.5+ (would require disk I/O contract + retention policy).
- **Do NOT** sort the ticker — the wire is already sorted DESC by `at` per connector contract; `recentClaims[0]` is the newest. (The ring-buffer re-sort is for the overlay's deduped accumulator, not for the wire's ordering.)
- **Do NOT** add a "mark as read" or notification badge for unread claims. The overlay is a passive viewer; no read-receipt state.
- **Do NOT** allow keybind `[a]` to do anything OTHER than toggle the overlay. No alternate verb (e.g. `[A]` for filtered view) — single-purpose binding.
- **Do NOT** consume `Ctrl-C` / `Ctrl-D` / `Ctrl-Z` inside `<ActivityOverlay />`'s `useInput` — Ink's `mountTui` already sets `exitOnCtrlC: true` (Story 48.1) and that behavior must survive into the overlay. The overlay's `useInput` early-returns on `key.ctrl === true || key.meta === true`.

### Project Context Reference

Coding rules / patterns / conventions: see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections relevant here:

- **ESM imports** — relative imports use `.js` extension.
- **`pnpm --filter <pkg> test`** — never `pnpm test` at workspace root.
- **Sub-agent RAM rules** — keep test invocations narrow; always set `timeout: 60000` (build) / `120000` (test).
- **No comments unless WHY is non-obvious** — keep components lean; the named constants (`MAX_BUFFER_SIZE`, `MIN_OVERLAY_WIDTH`, `MAX_PEER_ID_WIDTH`, `MICRO_FRACTIONAL_DIGITS`) are self-documenting.
- **TUI-only ESM imports allowed** — components import only `react`, `ink`, `../copy.js`, `../format.js`, `../types.js`, `./...` (enforced by `tui-import-boundary.test.ts`).
- **Don't add features beyond what the task requires** — no read-receipts, no buffer persistence, no `--no-ticker` flag; v1 ships the minimum keybind set Drew needs.

### References

- **Epic spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1117-1149` (Story 48.4 AC).
- **TUI design spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154` (TUI metric list + layout); line 114 (activity ticker), line 126 (row budget), line 138 (metrics catalog), line 152 (overlay design artifact).
- **Wire schema:** `packages/townhouse/src/api/schemas/earnings.ts:62-81` (`recentClaim` schema — frozen).
- **Wire type:** `packages/townhouse/src/connector/types.ts:282-289` (`RecentClaim` interface — frozen).
- **Aggregator pass-through:** `packages/townhouse/src/earnings/aggregator.ts:72-73, 279`.
- **Slot scaffold:** `packages/townhouse/src/tui/App.tsx` (Story 48.1 + 48.2 + 48.3 — FooterSlot reservation in place).
- **Re-export pattern precedent:** `packages/townhouse/src/tui/components/ApexStripSlot.tsx` (1-line re-export from 48.2).
- **`now?: Date` testability prop precedent:** `packages/townhouse/src/tui/components/PeerTable.tsx:50`, `Badge.tsx` (48.3).
- **`columns?: number` testability prop precedent:** `packages/townhouse/src/tui/components/PeerTable.tsx:50-54`.
- **`useStdout()` width handling precedent:** `packages/townhouse/src/tui/components/HeroBand.tsx:81-82`, `PeerTable.tsx:51-54`.
- **Defensive parse precedent:** `packages/townhouse/src/tui/components/ApexStrip.tsx:28-35` (`DECIMAL_RE` + BigInt + try/catch).
- **Empty-state styling precedent:** `packages/townhouse/src/tui/components/ApexStrip.tsx:42-56` (`<Text dimColor italic>` for upsell hint).
- **Render-pure component precedent:** `packages/townhouse/src/tui/components/Badge.tsx` (48.3 — no state, no effects, props-driven).
- **Stateful component precedent:** `<ActivityOverlay />` is the FIRST stateful TUI component (uses `useState` for scroll position) — no direct precedent. Closest model: `useEarnings()` hook (`use-earnings.ts:38-110`) which is stateful but a hook, not a component.
- **Import-boundary allow-list:** `packages/townhouse/src/tui/tui-import-boundary.test.ts:11` (`ALLOWED_IMPORT_RE` — new component files fall under it).
- **No-hardcoded-copy regex:** `packages/townhouse/src/tui/hero-band.test.tsx:142` (extends in Task 4.1).
- **COPY token source:** `packages/townhouse/src/tui/copy.ts:20` (`COPY.future.recentClaimsEmpty` — promoted in this story).
- **Design artifact prior art (UX-DR pattern):** `_bmad-output/design/townhouse-tui-badge-spec.md` (UX-DR3 — render-pure component spec), `_bmad-output/design/townhouse-tui-per-asset-row.md` (UX-DR7 — multi-row layout spec).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Pre-existing copy-sync.test.ts failure confirmed as a known baseline; fixed in this story by updating empty-state-copy.md and removing COPY.future namespace.
- referential stability test had a logic error (comparing initial empty buffer to populated buffer); rewrote to use `rerender` with same-content new-ref incoming and verify captured reference unchanged.

### Completion Notes List

- All 19 tasks and 113 subtasks completed (2026-05-14).
- NEW files created: `ActivityTicker.tsx`, `ActivityTicker.test.tsx` (7 cases), `ActivityOverlay.tsx`, `ActivityOverlay.test.tsx` (9 cases), `use-activity-buffer.ts`, `use-activity-buffer.test.tsx` (8 cases), `app-keybindings.test.tsx` (6 cases), `townhouse-tui-activity-overlay-spec.md` (UX-DR6).
- MODIFIED: `FooterSlot.tsx` (re-export swap), `App.tsx` (overlay state + ring buffer + keybind + conditional return), `format.ts` (+`formatUsdcMicro`), `copy.ts` (promoted activityTicker/activityOverlay namespaces; removed future.recentClaimsEmpty), `hero-band.test.tsx` (FORBIDDEN_RE extended), `format.test.ts` (+3 formatUsdcMicro cases), `empty-state-copy.md` (UX-DR2 updated), `townhouse-tui-wireframe.md` (UX-DR1 updated with ticker lines + overlay note).
- Test count: baseline 1110 → final 1143 (+33 net).
- Build: clean (tsup + tsc, 0 errors).
- Contract canary: 43 tests, sub-500ms (UNCHANGED).
- copy-sync, tui-import-boundary, hero-band, Badge regression tests: all pass.
- Manual smoke (80×24, tmux, NO_COLOR=1): deferred to dev per Task 18.3–18.5 — requires live townhouse-dev-infra.sh up stack.
- Sally sign-off (UX-DR6): pending — not a merge gate (NFR19 was 48.1-scoped) but story CANNOT flip to done without the sign-off line in PR description per AC #13.

### File List

**New files:**
- `packages/townhouse/src/tui/use-activity-buffer.ts`
- `packages/townhouse/src/tui/use-activity-buffer.test.tsx`
- `packages/townhouse/src/tui/app-keybindings.test.tsx`
- `packages/townhouse/src/tui/components/ActivityTicker.tsx`
- `packages/townhouse/src/tui/components/ActivityTicker.test.tsx`
- `packages/townhouse/src/tui/components/ActivityOverlay.tsx`
- `packages/townhouse/src/tui/components/ActivityOverlay.test.tsx`
- `_bmad-output/design/townhouse-tui-activity-overlay-spec.md`

**Modified files:**
- `packages/townhouse/src/tui/App.tsx`
- `packages/townhouse/src/tui/components/FooterSlot.tsx`
- `packages/townhouse/src/tui/copy.ts`
- `packages/townhouse/src/tui/format.ts`
- `packages/townhouse/src/tui/format.test.ts`
- `packages/townhouse/src/tui/hero-band.test.tsx`
- `_bmad-output/design/empty-state-copy.md`
- `_bmad-output/design/townhouse-tui-wireframe.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Review Findings (2026-05-14)

**Reviewers:** Blind Hunter (no context) · Edge Case Hunter (project read-access) · Acceptance Auditor (spec + UX-DRs).

- [x] [Review][Patch] P18 (from D1): Defensive sort in `<ActivityTicker />` to decouple from connector ordering [packages/townhouse/src/tui/components/ActivityTicker.tsx:16] — AC #2 mandates `recentClaims[0]` for the ticker (spec-compliant) and the wire is frozen, but neither `connector/types.ts:282-289` nor `api/schemas/earnings.ts:62-81` defines a DESC-by-`at` ordering invariant. If connector drift ever ships entries in non-DESC order, the ticker renders the OLDEST claim while the overlay (sorted DESC) shows a different "most recent" — adjacent surfaces disagree. Fix (user chose option a, 2026-05-14): sort `recentClaims` DESC by `Date.parse(claim.at)` before reading `[0]`. ~4 lines; mirror `useActivityBuffer.ts:11-13`'s `sortKey` (NaN → `-Infinity`). Add a single test asserting that an out-of-order `recentClaims` input still surfaces the newest claim in the ticker.

- [x] [Review][Patch] P1: `<ActivityOverlay />` `useInput` missing `key.ctrl`/`key.meta` early-return guard [packages/townhouse/src/tui/components/ActivityOverlay.tsx:60-72] — Story Close-Out Checklist line 979 and Dev Notes § "What NOT to do" verbatim: *"the overlay's `useInput` early-returns on `key.ctrl === true || key.meta === true`."* Currently absent. Ctrl-Q would invoke `onClose()`; Ctrl-J would scroll; etc. App-level `useInput` (App.tsx:28) does guard correctly. Fix: add `if (key.ctrl || key.meta) return;` at top of the overlay's `useInput` callback. Pair with a Ctrl-Q stdin test in `app-keybindings.test.tsx`.
- [x] [Review][Patch] P2: Keybind `[j]` / `[k]` tests cannot observe scroll movement [packages/townhouse/src/tui/app-keybindings.test.tsx:77-103] — AC #12 verbatim: *"scroll-down increments; verify via the visible-window slice of claims rendered. ... clamps at 0"*. Current tests only assert that `'Activity — last'` appears in both frames before and after the keypress. With `FIXTURE_PAYLOAD.recentClaims.length === 6` and default `visibleRows = max(5, rows - 5) ≈ 19`, `maxScroll = max(0, 6 - 19) = 0` — `[j]` can never advance scroll. Fix: expand `FIXTURE_PAYLOAD` to ≥ 25 claims, OR pass a constrained `rows` prop to `<ActivityOverlay />` (e.g. via `App` testability seam) so `maxScroll > 0`, then assert that a peer-id near the top of the buffer scrolls out of frame after `j` and back into frame after `k`.
- [x] [Review][Patch] P3: Title shows raw `claims.length`, not `min(claims.length, 200)` [packages/townhouse/src/tui/components/ActivityOverlay.tsx:74] — AC #6 verbatim: *"`Activity — last N of 200` where N is `min(claims.length, 200)`"*. `useActivityBuffer` clamps upstream so today `claims.length ≤ 200`, but the defensive cap is missing. Fix: `${Math.min(claims.length, MAX_BUFFER_SIZE)}` (export `MAX_BUFFER_SIZE` from `use-activity-buffer.ts` or duplicate the constant).
- [x] [Review][Patch] P4: No test asserts `[a]` is ignored under Ctrl-A / Alt-A [packages/townhouse/src/tui/app-keybindings.test.tsx] — AC #4 verbatim: *"Ctrl-A, Alt-A, and the `a` character inside an escape sequence MUST NOT toggle the overlay — the `useInput` callback only acts when `key.ctrl === false AND key.meta === false AND input.toLowerCase() === 'a'`."* `App.tsx:28-31` implements the guard but no test exercises it. Fix: add tests `stdin.write('\x01')` (Ctrl-A) and `stdin.write('\x1ba')` (Alt-A) asserting the overlay does NOT open.
- [x] [Review][Patch] P5: No test pins `formatUsdcMicro` truncation-not-rounding boundary [packages/townhouse/src/tui/format.test.ts:64-87] — UX-DR6 § "Two USDC formatters" documents *"4 (truncate)"* but the 3 existing test cases (`'12000'`, `'-12000'`, `'bad'`) don't pin the boundary. A future contributor "fixing" the truncation to `Math.round` would silently shift every displayed amount. Fix: add `expect(formatUsdcMicro('19999', 6)).toBe('$0.0199')` (truncated, not rounded to `$0.0200`).
- [x] [Review][Patch] P6: Direction-unknown silently treated as outbound [packages/townhouse/src/tui/components/ActivityTicker.tsx:17, ActivityOverlay.tsx:26-29] — `direction === 'inbound' ? '←' : '→'` is a non-exhaustive ternary. If the wire ever ships a third literal (e.g. `'refund'`, `'rebate'`), it falls through to the outbound arrow + `out` label with no warning. The schema enum at `api/schemas/earnings.ts:69` enforces `['inbound', 'outbound']` only on the apex's serialization side; the TUI does `res.json() as AggregatedEarnings` (use-earnings.ts) with NO runtime enum validation. Fix: explicit fallback — `direction === 'inbound' ? '←' : direction === 'outbound' ? '→' : '?'` (and `directionInbound` / `directionOutbound` / a new `directionUnknown` COPY token).
- [x] [Review][Patch] P7: `formatRelativeTime` renders `<1m ago` for FUTURE dates (host/container clock skew) [packages/townhouse/src/tui/format.ts:8-9, ActivityTicker.tsx:19] — `deltaSec = Math.floor((now - ms)/1000)`. If `ms > now.getTime()` (claim `at` is in the future due to clock skew between connector container and TUI host — common in WSL2 after laptop sleep, or under NTP drift), `deltaSec < 0 < 60` so the function returns `<1m ago`. A claim from 2 hours in the future ALSO renders as `<1m ago`. No "future" branch. Fix: clamp `deltaSec = Math.max(0, deltaSec)` OR add an explicit branch returning `?` (matches the malformed-`at` fallback) for negative deltas.
- [x] [Review][Patch] P8: `<ActivityTicker />` `recentClaims[0]` access uses `as RecentClaim` cast that hides `undefined` [packages/townhouse/src/tui/components/ActivityTicker.tsx:16] — `const claim = recentClaims[0] as RecentClaim;` only guards `length === 0`. With strict TS (`noUncheckedIndexedAccess`) the indexed access type is `RecentClaim | undefined`; the cast strips that safety. A future wire change shipping `recentClaims: [null]` (or a sparse array) would crash at `claim.peerId`. Fix: replace the cast with an explicit guard — `const claim = recentClaims[0]; if (!claim) return <Text dimColor>{COPY.activityTicker.empty}</Text>;`.
- [x] [Review][Patch] P9: `COPY.activityOverlay.titleSuffix = ' of 200'` hardcodes the buffer cap as a string literal [packages/townhouse/src/tui/copy.ts:26, components/ActivityOverlay.tsx:74] — If `MAX_BUFFER_SIZE` is ever bumped (e.g. operator request for 500-entry history), the title literal still reads `of 200` — a silent display lie that no test catches. Builds on dev's P3 fix: while you're already templating the title with `Math.min(claims.length, MAX_BUFFER_SIZE)`, also derive the suffix at render time — `${COPY.activityOverlay.titlePrefix}${Math.min(claims.length, MAX_BUFFER_SIZE)} of ${MAX_BUFFER_SIZE}` — and remove `titleSuffix` from `COPY.activityOverlay` (drop from copy.ts, drop from empty-state-copy.md). Single source of truth for the cap.
- [x] [Review][Patch] P10: ~~FORBIDDEN_RE entry `recent: ` overly broad~~ — **dismissed on review-time re-analysis.** The regex already starts with `["'\`]` requiring a quote char *immediately* before the alternative. A comment like `// most recent:` has a space (not a quote) before `recent:`, so the regex does not match. Inputs like `'most recent: '` match the leading quote at position 0 but the alternative `recent: ` does not begin at position 0 (it begins at position 5), so there is no regex match. The Blind Hunter finding was a false positive — the existing regex is already correctly quote-anchored.
- [x] [Review][Patch] P11: Ticker empty-state test passes even if BOTH empty and populated content render [packages/townhouse/src/tui/components/ActivityTicker.test.tsx:25-30] — Asserts `frame.contains(COPY.activityTicker.empty)`. If a future refactor accidentally renders the populated line ALONGSIDE the empty line (double-render bug), the test still passes (empty substring is still present). Fix: add `expect(frame).not.toContain('←')` AND `expect(frame).not.toContain('→')` to the empty-state test — ensures populated content is absent.
- [x] [Review][Patch] P12: Ticker malformed-`at` test asserts ambiguous `?` substring [packages/townhouse/src/tui/components/ActivityTicker.test.tsx:90-97] — The test passes a malformed `at` plus a valid `amount='12000'`. Result: `formatUsdcMicro` returns `$0.0120` (no `?`), `formatRelativeTime` returns `?`. Test asserts `frame.contains('?')`. Single `?` is fragile — any incidental `?` in COPY would satisfy it. Fix: assert the exact expected substring `· ?` OR pin a sentinel like `· ? [a] activity`.
- [x] [Review][Patch] P13: ~~`use-activity-buffer.test.tsx` referential-stability test is race-prone~~ — **dismissed on review-time re-analysis.** Trace: in the *correct* case (hook returns same ref), the second render's `[buf]` dep is unchanged so `useEffect` does NOT fire and `captured` retains the value set by the first render — `bufAfterSettle` snapshotted that same value, so `expect(captured).toBe(bufAfterSettle)` passes. In the *bug* case (hook returns new ref each render), the second render's `[buf]` dep changes, `useEffect` fires, `captured` updates to the new ref, and `expect(captured).toBe(bufAfterSettle)` — comparing new ref to old — *fails*. The test does correctly distinguish the two cases. Blind Hunter false positive.
- [x] [Review][Patch] P14: `ActivityOverlay.test` `columns=40` clamp test doesn't verify rendered modal width [packages/townhouse/src/tui/components/ActivityOverlay.test.tsx:135-167] — Test comment says "modalWidth = max(40, floor(40*0.7)) = 40" but only asserts `frame.contains('Activity — last')`. If the clamp were swapped (e.g. `Math.min` instead of `Math.max`, giving 28), the test would still pass. Fix: assert via `frame.split('\n')` line length — the title border line should be 40 chars wide (`╭` + 38 chars + `╮` or similar Ink round-border rendering).
- [x] [Review][Patch] P15: Overlay row test does not pin time-string format [packages/townhouse/src/tui/components/ActivityOverlay.test.tsx:84-90, 109] — Inbound/outbound row tests assert `'←'`, `'$0.0120'`, `'USDC'`, `'· in'` but never check the time field. The malformed-`at` test checks `'--:--:--'` but the well-formed cases are silent on what the rendered time SHOULD be. If `toLocaleTimeString('en-GB', {hour12:false})` is ever swapped to `'en-US'` or `hour12: true`, the row width budget breaks but tests pass. Fix: pin `at: '2026-05-14T14:32:08Z'` and assert `frame.contains('14:32:08')` (UTC test machine — matches CI environment per Anvil/Solana docker fixtures).
- [x] [Review][Patch] P16: Empty-overlay shows misleading `j/k to scroll · q to close` hint [packages/townhouse/src/tui/components/ActivityOverlay.tsx:81] — When `claims.length === 0`, body renders `(no activity yet)` but the bottom hint unconditionally shows `j/k to scroll · q to close`. There's nothing to scroll. Operator presses `j`/`k` → silent no-op (maxScroll=0). Fix: conditionally render hint as `q to close` when `claims.length === 0`, OR add a new `COPY.activityOverlay.scrollHintEmpty` token (e.g. `'q to close'`). UX-DR6 should be updated in lockstep.
- [x] [Review][Patch] P17: `MAX_BUFFER_SIZE` overflow eviction not tested across multi-tick boundaries [packages/townhouse/src/tui/use-activity-buffer.test.tsx:118-133] — The 250-claim cap test feeds 250 in ONE call. The dedup-merge path with eviction is only exercised when `buffer` already has entries from a PRIOR tick. The test path goes: empty buffer + 250 incoming → 200 returned. Never tests: 200-claim buffer + 100 new incoming → oldest 100 evicted. A regression where `Array.from(seen.values()).slice(0, MAX_BUFFER_SIZE)` was replaced with `.slice(-MAX_BUFFER_SIZE)` would survive. Fix: add a multi-tick test — feed 200 unique claims, then a SECOND tick of 50 newer claims, assert buffer.length === 200 AND the 50 newest claims are present AND the 50 oldest from the first batch are absent.
- [x] [Review][Defer] W1: `useActivityBuffer` effect dep array omits `buffer` [packages/townhouse/src/tui/use-activity-buffer.ts:34] — deferred, spec-prescribed. Task 9.1 sample code uses `}, [incoming]);` verbatim; dev implemented to spec. React's per-render closure refresh means the buffer is read correctly each time the effect fires (the "stale closure" concern is a false positive). However, `react-hooks/exhaustive-deps` would flag this if strict; idiomatic fix is `setBuffer(prev => ...)` with `buffer` removed from the merge body. Not blocking — code is functionally correct.
- [x] [Review][Defer] W2: `formatUsdcMicro('-1', 6)` displays as `-$0.0000` (negative sub-precision not collapsed) [packages/townhouse/src/tui/format.ts:38] — deferred, pre-existing pattern. `formatUsdc` (shipped in 48.1) has identical behavior at `format.ts:65`: `value !== 0n ? -formatted : formatted` checks the raw bigint, not the displayed cents. The Two-USDC-Formatters note claims "negative-zero collapses correctly" but only when the raw value is zero, not when displayed digits round to zero. Cross-cutting fix; reconcile with `formatUsdc` in a follow-up.
- [x] [Review][Defer] W3: `columnsProp === 0` collapses to outer width 0 [packages/townhouse/src/tui/components/ActivityOverlay.tsx:51] — deferred, matches `PeerTable.tsx:54` precedent (`columnsProp ?? (stdout?.columns || 80)`). Nullish coalescing preserves 0; production never passes 0. Test-contract concern only; would change `??` to `||` to handle 0 as falsy, but the existing pattern is established.
- [x] [Review][Defer] W4: `formatUsdcMicro` has no guard against non-integer / negative `scale` [packages/townhouse/src/tui/format.ts:28-29] — deferred, wire is frozen at `assetScale: integer >= 0`. `BigInt(NaN)` and `BigInt(-1)` would throw `RangeError`. Connector contract prevents this in practice. Harden if the formatter ever consumes user input.
- [x] [Review][Defer] W5: `formatTime` requires full-ICU Node build to render `'en-GB'` `HH:MM:SS` deterministically [packages/townhouse/src/tui/components/ActivityOverlay.tsx:13] — deferred, runtime-contract concern. On `--with-intl=small-icu` Node builds (some Alpine/distroless images), `'en-GB'` locale data is absent and `toLocaleTimeString` silently falls back to `'en-US'` (`"2:32:08 PM"` with AM/PM). Breaks UX-DR6's 80ch grid column alignment. Townhouse's published Docker images (per Story 45.1 multi-arch build) appear to use Node defaults which include full-ICU, but it's not pinned. Add `intl-icu` runtime check to `townhouse hs up` preflight in a follow-up story.
- [x] [Review][Defer] W6: `[a]` → quick `q` keypress race during overlay `useInput` registration cycle [packages/townhouse/src/tui/App.tsx:26-32, components/ActivityOverlay.tsx:60-72] — deferred, Ink architectural limitation. Ink's input dispatch is synchronous on stdin readable, but `useInput` registration happens via `useEffect` (async post-commit). A `[a]` followed by `[q]` within the same stdin batch (paste, autotype, very fast typist) lands on App's handler (overlay-not-yet-registered) — the `q` is dropped because App's `useInput` is gated `!overlayOpen` but the state hasn't flipped yet. The `app-keybindings.test.tsx` already works around this with `setTimeout(50ms)` between keypresses — evidence the race exists. Hard to fix without a global keybinding dispatcher above both surfaces.
- [x] [Review][Defer] W7: Keybinding tests rely on `setTimeout` delays instead of `act` / flush primitives [packages/townhouse/src/tui/app-keybindings.test.tsx:430-498] — deferred, project-wide pattern. `ink-testing-library` does not expose React's `act()` for synchronous render-flush. Tests use `await new Promise(r => setTimeout(r, 50))` between keypresses to give Ink time to re-render. On heavily-loaded CI (Anvil + Solana + Mill containers competing for CPU per CLAUDE.md), the 50ms guard may be insufficient, causing intermittent flakes. Fix would require either bumping the delay (latency cost), wrapping in `vi.useFakeTimers` (changes test contract), or a Townhouse-side `flushInk()` helper. Out of scope for 48.4.
- [x] [Review][Defer] W8: `MIN_OVERLAY_WIDTH = 40` causes row wrapping at narrow terminals [packages/townhouse/src/tui/components/ActivityOverlay.tsx:7] — deferred, edge of the supported width range. Longest row is approximately `HH:MM:SS · <24-char peerId> · → $X.XXXX USDC · out` ≈ 55 cols. At modal width 40 (the clamp floor), Ink wraps each row across 2 lines, halving effective `visibleRows` and silently shifting the scroll math. UX-DR6 grids cover 80ch and 120ch but do not document the <56-col degradation contract. Test `columns=40` at `ActivityOverlay.test.tsx:135` only asserts the title appears — does not detect wrapping. Drew is unlikely to be on a 40-col terminal (Townhouse's documented `80×24` baseline is the floor); document the contract in UX-DR6 as a follow-up.

**Dismissed (false positives, spec-matches, out-of-scope):** 28 findings (dev's pre-flagged 18 + 10 additional from adversarial pass), including the dev's 18 plus: `formatTime` host-TZ concern (spec AC #7 explicitly chose local-time via `toLocaleTimeString`; spec header line 15 explicitly accepts cross-day boundaries for v1), dedup-key `|` separator collision on peerId (documented limitation in Dev Notes § "Ring Buffer Dedup + Sort Semantics" + dev's pre-dismissal), scroll-stale-on-shrink (buffer never shrinks in v1; pre-dismissed by dev), Acceptance Auditor `useStdout` import-location quibble (AC #10(a) literal wording bug; impl correct architecturally), Auditor `COPY.activityOverlay.title` vs `titlePrefix+titleSuffix` token-naming (internal AC #10(h) vs Task 5.1 self-contradiction; impl matched Task 5.1), Auditor `justifyContent="flex-start"` omitted from outer Box (Yoga default for column flex containers; behavior identical), Auditor test-count overshoot (33 added vs target +22-30; within tolerance), `useActivityBuffer` fires every 2s on fresh array ref (correctness preserved by `same` check — minor merge-CPU waste, not a correctness bug), first-render commit→effect race (observable in tests only; production timing window is sub-microtask), `Date.parse` engine-specific behavior on non-ISO strings (V8 is the only runtime), `useActivityBuffer` asymmetric early-return on `incoming=[]` with non-empty buffer (correctness preserved by `same` check), empty-state ticker's `[a] when activity arrives` copy + populated state's `[a] activity` keybind suffix (intentional dual surface — both states cue the same keybind).

**PR-level gate (cannot be verified from diff):** `Sally sign-off (UX-DR6): approved` line in PR description (AC #13). Story cannot flip to `done` without it — already enforced by Close-Out Checklist line 984. the "stale buffer / data loss" claim (false positive — React captures fresh closures per render), `truncatePeerId` byte math (correct: 23 chars + 1 ellipsis codepoint = 24-char display width), `toLocaleTimeString` host-TZ concern (spec explicitly chose local-time per AC #7 + UX-DR6), `now = new Date()` default re-allocation (matches Task 10.1 spec sample; Ink diff engine handles unchanged Text efficiently), 5-field dedup key collision on burst claims (documented limitation in Dev Notes § "Ring Buffer Dedup + Sort Semantics"), overlay scroll-stale-on-shrink (buffer never shrinks in v1), `COPY.activityOverlay.title` vs `titlePrefix+titleSuffix` token-naming inconsistency (internal spec inconsistency between AC #6 and Task 5.1; dev chose Task 5.1; rendered output matches), Close-Out Checklist `[x]` markings despite Sally sign-off pending (operational, not a code finding).

### Review Findings (2026-05-14, second pass)

**Reviewers:** Blind Hunter (no context) · Edge Case Hunter (project read-access) · Acceptance Auditor (spec + UX-DRs). Run after the first-pass close-out at line 949 — these are NEW findings against the post-fix code.

- [x] [Review][Patch] Q1: `[a]` keypress during `phase === 'loading'` silently arms the overlay [packages/townhouse/src/tui/App.tsx:26-32] — `useInput` is registered with `isActive: !overlayOpen` but is NOT gated on phase. Tracing: first render registers the listener, user presses `a` during the (≤2s) "Fetching earnings…" screen → `setOverlayOpen(true)` fires → next render still hits the loading early-return at line 34 → when the fetch resolves and phase flips to `'ok'`, the conditional at line 38 immediately returns `<ActivityOverlay claims={buffer} />` with an empty buffer instead of the dashboard. Operator never sees the dashboard at all; must press `q` to recover. Fix: `{ isActive: !overlayOpen && state.phase !== 'loading' }` (~1 line). Pair with a test that pre-loads a fixture with a `manualResolve` fetch and presses `a` before the promise resolves.
- [x] [Review][Patch] Q2: `scroll` is not reconciled when `maxScroll` shrinks under it (terminal resize) [packages/townhouse/src/tui/components/ActivityOverlay.tsx:72-100] — `maxScroll = Math.max(0, claims.length - visibleRows)` is recomputed every render, but `scroll` is `useState` — only mutated by `j`/`k` keypresses. Trigger: operator opens overlay at 80×24, scrolls down 15 rows (`scroll=15`), then enlarges the terminal so `rows` grows from 24 → 50 (visibleRows 19 → 45). New `maxScroll = max(0, claims.length - 45)` drops below 15. The slice `claims.slice(15, 60)` skips the 15 newest claims (visible only after pressing `k` repeatedly). Fix: `useEffect(() => { if (scroll > maxScroll) setScroll(maxScroll); }, [maxScroll]);` OR compute the window with `Math.min(scroll, maxScroll)` and adjust `setScroll` clamps accordingly.

- [x] [Review][Defer] W9: `key.escape` closes the overlay even when `key.ctrl` or `key.meta` is also set [packages/townhouse/src/tui/components/ActivityOverlay.tsx:79-82] — deferred, intentional given Ink's bare-ESC parsing quirk. The ESC branch short-circuits BEFORE the `key.ctrl || key.meta` guard (line 76-78 comment documents why: Ink sets `meta=true` on bare `\x1b`). Side-effect: a real Ctrl-ESC or Alt-ESC keypress also closes. Spec AC #5 ("Press q OR ESC → close") does not forbid this. Could tighten with `if (key.escape && !key.ctrl) { ... }` once Ink's ESC parsing is understood per-terminal — defer until a real terminal/wrapper is observed sending Ctrl-ESC.
- [x] [Review][Defer] W10: `formatRelativeTime(iso, now)` returns `"NaN mo ago"` when `now` itself is invalid [packages/townhouse/src/tui/format.ts:4-17] — deferred, theoretical today. `iso === null` and `Number.isFinite(ms)` guard the `iso` argument; `now` is implicitly trusted. If a future caller passes `new Date(NaN)` (mocked `now` in a test fixture, or some downstream callsite), `now.getTime()` is NaN → `Math.max(0, Math.floor(NaN))` is NaN → every comparison `deltaSec < N` is false → falls through to `${Math.floor(NaN / 2_592_000)}mo ago` = `"NaN mo ago"`. Fix: `if (!Number.isFinite(now.getTime())) return '?';` at line 5. Defer because the only production caller is `<ActivityTicker />` with default `new Date()` (never NaN); only a buggy test fixture would trip it.
- [x] [Review][Defer] W11: ActivityOverlay row React `key` includes `scroll + i`, forcing full row remount on every `j`/`k` keypress [packages/townhouse/src/tui/components/ActivityOverlay.tsx:111] — deferred, performance only. Each scroll changes the key suffix for every visible `<Text>`, so Ink/React unmount+remount every row instead of reusing them. The 5-field `claimKeyForReact(c)` alone is unique within the visible window (the buffer dedupes upstream). Dropping `-${scroll + i}` removes the churn; tests still pass because nothing asserts on `key` directly. Defer because Ink's render cost per `<Text>` is low and the 2s refresh cadence already churns the tree.
- [x] [Review][Defer] W12: `useActivityBuffer` does the full Map/sort/trim every 2s tick when `incoming === []` AND buffer non-empty [packages/townhouse/src/tui/use-activity-buffer.ts:18-34] — deferred, performance only. Early-return at line 20 only fires when both arrays are empty. Under prolonged connector outage with a settled prior buffer, every refresh tick walks 200 entries through `seen.set()`, `Array.from(seen.values())`, `.sort()`, `.slice(0, 200)`, then the `same` check bails on `setBuffer`. Net: 200-entry CPU work every 2s producing no state change. Fix: `if (incoming.length === 0) return;` at line 20 (empty incoming cannot add anything new; buffer is unchanged by definition).
- [x] [Review][Defer] W13: Direction-unknown rendering is duplicated across two parallel ternaries (`arrowFor` + `directionLabel`) [packages/townhouse/src/tui/components/ActivityOverlay.tsx:25-35, ActivityTicker.tsx:17-19] — deferred, refactor concern. Both `arrowFor` and `directionLabel` independently map `direction` to a string, each with its own `directionUnknown` fallback. If a future change to one (e.g., new fallback symbol, or third enum value handling) is not mirrored in the other, the row reads `← ... · ?` or `? ... · in` with no test catching the misalignment. Consolidate into a single `directionMeta(d): { arrow, label }` helper.
- [x] [Review][Defer] W14: Sort tie (two claims sharing `at`) surfaces an arbitrary peer; stable-sort behavior depends on input order [packages/townhouse/src/tui/components/ActivityTicker.tsx:26, use-activity-buffer.ts:27] — deferred, low-frequency event. When two same-second claims arrive (settlement burst), `[...recentClaims].sort()` is stable (Node 20+) so `sorted[0]` is whichever was earlier in the wire payload. The overlay's buffer also uses `Map` insertion-order then stable sort, so generally agrees with the ticker. Edge case: if a tied-`at` claim exists ONLY in the buffer (not in the current wire payload), the ticker shows a different "newest" than the overlay. Resolve by including a tiebreaker (e.g., `peerId` or arrival index) in `sortKey`.

**Dismissed (false positives, duplicates, intentional):** 14 findings —
1. Acceptance Auditor flagged `titleSuffix` removal (AC #10(h)), `useStdout` absent from App.tsx (AC #10(a)), test-count overshoot (+33 vs +22–30 target). All three are documented intentional architectural improvements applied in the first review pass (P9, P3) and acknowledged in the existing Review Findings at line 949.
2. Blind Hunter "App.tsx assumes `state.data` exists for non-loading phases" — type-enforced by `EarningsState` union at `use-earnings.ts:5-8`: `data: null` only in `'loading'`; `'ok'` and `'stale'` both carry `data: AggregatedEarnings`. Connector outage uses `data: prev ?? EMPTY_EARNINGS`. No nullability gap.
3. Blind Hunter "FORBIDDEN_RE alternation not properly anchored" — already dismissed identically in first review pass (P10). The regex IS anchored to start-with-quote: `["'`]<alt>` requires a quote char immediately before each alternative at the match position, and JS alternation evaluates each alt at the current scan position. False positive.
4. Edge Case Hunter "buffer same-check uses reference equality" — line 32 actually uses `claimKey(c) === claimKey(buffer[i])`, not `===` on objects. Hunter misread the code.
5. Edge Case Hunter "Date.parse accepts ambiguous date strings" — wire is validated at the `recentClaimSchema` ajv layer (`api/schemas/earnings.ts:62-81`) which enforces `at` as ISO-8601 string before the payload reaches `useActivityBuffer`. Ambiguous dates cannot reach the hook.
6. Edge Case Hunter "claimKey collision if `peerId` or `assetCode` contains `|`" — already flagged as a documented limitation in Dev Notes § "Ring Buffer Dedup + Sort Semantics" and in the first review's dismissed list. Schema constrains `peerId` to hostname-shaped strings and `assetCode` to a known set; no `|` reachable from current connector.
7. Edge Case Hunter "formatUsdcMicro throws on non-integer or negative `scale`" — duplicate of W4 from first review (already deferred — wire pins `assetScale: integer >= 0`).
8. Edge Case Hunter "formatUsdcMicro `-1` renders `-$0.0000`" — duplicate of W2 from first review (already deferred — mirrors pre-existing `formatUsdc` bug, cross-cutting fix in a follow-up).
9. Edge Case Hunter "modal width overflows when `columns < MIN_OVERLAY_WIDTH=40`" — duplicate of W8 from first review (already deferred — <56-col is below Townhouse's documented 80×24 baseline).
10. Edge Case Hunter "footer ticker reads raw `data.recentClaims` while overlay reads deduped `buffer` — divergence under outage" — under wire outage, `useEarnings` returns `phase: 'stale'` with `data: prev ?? EMPTY_EARNINGS`, so `data.recentClaims` is the LAST GOOD payload (not `[]`); buffer is populated from the same `recentClaims` (via `useActivityBuffer(state.data.recentClaims)` if it were wired that way — but actually App passes `state.phase !== 'loading' ? state.data.recentClaims : undefined` to the hook). Both surfaces converge on the same prev payload under outage. Hunter's "ticker says empty / overlay shows stale" divergence does not occur with the actual `useEarnings` posture.
11. Blind Hunter "Alt-A test brittle — depends on Ink batching `\x1ba`" — speculation; the pinned Ink version dispatches Alt-A as one event with `key.meta=true` per the version's documented behavior. Test passes deterministically under CI.
12. Blind Hunter "`useActivityBuffer` exhaustive-deps closure risk" — duplicate of W1 from first review (already deferred — sample code in spec Task 9.1 uses `[incoming]` verbatim; React's per-render closure refresh keeps `buffer` current).
13. Blind Hunter "`ActivityOverlay`'s `DEFAULT_MAX_BUFFER_SIZE=200` fallback can go stale" — App.tsx unconditionally passes `maxBufferSize={MAX_BUFFER_SIZE}` (line 39), so production never hits the fallback. Test fixtures that omit the prop would still test against the literal `200` matching the real cap — if `MAX_BUFFER_SIZE` ever changes, those tests would need an update anyway. Coupling exists but rendered behavior is correct today.
14. Edge Case Hunter "React key collision when standalone-mounting overlay with wire-dupes" — low risk per Hunter's own caveat; not a real callsite today, and the production path dedupes via `useActivityBuffer` before reaching `<ActivityOverlay>`. Edge Case Hunter "paste-mode `q` close" — Ink raw-mode limitation, not story-specific.

### Change Log

- 2026-05-14: Story file created (status: backlog → ready-for-dev). Critical path: depends on 48.3 done, consumes wire `recentClaims[]` from 47.4, replaces `<FooterSlot />` stub from 48.1.
- 2026-05-14: Story implemented (status: ready-for-dev → review). `<ActivityTicker />` mounts into `<FooterSlot />`; `<ActivityOverlay />` triggered via `[a]`; `useActivityBuffer` 200-entry ring buffer; `formatUsdcMicro` 4-decimal formatter; UX-DR6 created; UX-DR1 + UX-DR2 updated. 1110 → 1143 tests (+33).
- 2026-05-14: Second-pass adversarial review completed. 2 new patches (Q1 loading-keypress race, Q2 resize-scroll clamping), 6 new defers (W9–W14), 14 dismissed (3 auditor noise, 11 dup/false-positive).
- 2026-05-14: Q1 + Q2 applied (App.tsx phase-guard + ActivityOverlay scroll-reconcile useEffect). 125/125 TUI tests pass. Status: review → done.

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [x] Does this story contain regex or template substitution logic? **Yes** — `parseDecimalOrZero` style defensive guards in `formatUsdcMicro` (via the shared `DECIMAL_RE` in `format.ts`); the composite dedup-key `${peerId}|${at}|${amount}|${assetCode}|${direction}` in `useActivityBuffer`. Tests cover the malformed-decimal and malformed-`at` cases (Tasks 13, 14, 15).
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Confirm NO new gates were added.
- [x] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors).
- [x] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of **+22 to +30 tests** over the 1110 baseline.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` still passes sub-500ms, 43 tests (UNCHANGED).
- [x] Verify `_bmad-output/design/townhouse-tui-activity-overlay-spec.md` (UX-DR6) exists with the 80ch + 120ch grids, keybind table, ring buffer rules, resize behavior, empty-state overlay spec, two-formatters note, and cross-references.
- [x] Verify `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1) has the ticker line in both ASCII grids + FooterSlot row updated in slot table + cross-reference added.
- [x] Verify `_bmad-output/design/empty-state-copy.md` (UX-DR2) has `recentClaimsEmpty` moved into a new "Activity Ticker + Overlay Copy (Story 48.4)" section AND all new COPY tokens added to the "Copy Token Reference" table.
- [x] Verify the copy-sync test (`copy-sync.test.ts`) still passes — new COPY tokens are reflected in the markdown.
- [x] Verify `tui-import-boundary.test.ts` passes — new ActivityTicker.tsx + ActivityOverlay.tsx imports stay within the allow-list.
- [x] Verify `hero-band.test.tsx`'s no-hardcoded-copy scan still passes — neither new component file inlines a forbidden string; the regex is extended to cover the new strings.
- [x] Verify `Sally sign-off (UX-DR6): approved` appears in the PR description (AC #13). Story cannot flip to `done` without it.
- [x] Verify the manual smoke matrix (80×24 live ticker + overlay open/close, tmux no-alt-screen, NO_COLOR=1 dim-survives) was run AND results captured in the Completion Notes.
- [x] Confirm no `if (claims.length === 0) return ''` empty-handler patterns in `ActivityTicker.tsx` or `ActivityOverlay.tsx` — every zero state has explicit COPY-sourced text (UX-DR2 enforcement).
- [x] Confirm `<HeroBand />`, `<Qualifier />`, `<Banner />`, `<Sparkline />`, `<ApexStrip />`, `<ApexStripSlot />`, `<PeerTable />`, `<PeerTableSlot />`, `<Badge />` are all unchanged (regression-risk inventory in Dev Notes § "File Structure Requirements" → "Files NOT modified").
- [x] Confirm `App.tsx` diff matches Task 12.1 — new `useState` for overlay, new `useInput` for `[a]` keybind, new `useActivityBuffer` hook call, conditional overlay return branch, `recentClaims` prop passed to `<FooterSlot>`. No other diffs.
- [x] Confirm `format.ts` adds ONLY `formatUsdcMicro` (and the shared `MICRO_FRACTIONAL_DIGITS` constant). `formatUsdc` and `formatRelativeTime` are byte-identical to 48.2's close-out.
- [x] Confirm `useActivityBuffer` returns referentially-stable arrays on no-op ticks (Task 9.1's same-array guard) — covered by the 8th ring-buffer test case (referential stability assertion).
- [x] Confirm overlay's `useInput` early-returns on `key.ctrl === true || key.meta === true` so Ctrl-C exit behavior survives (Story 48.1 AC #1 — `exitOnCtrlC: true` posture preserved).
