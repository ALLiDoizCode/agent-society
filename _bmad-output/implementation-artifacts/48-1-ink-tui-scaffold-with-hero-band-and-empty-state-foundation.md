# Story 48.1: Ink TUI Scaffold + Hero Band + Empty-State Foundation

Status: done

> **Critical-path first story of Epic 48 (Operator Dashboard / Ink TUI).** Sized L. This story flips `townhouse hs up` from a fire-and-exit ribbon-only CLI into the foreground Ink dashboard Drew lives in: TTY-gated takeover, three-row hero band (`TODAY · MONTH · YEAR · LIFETIME` + 7-day ASCII sparkline), empty-state qualifier (`MONTH $0.00 · N events relayed · you're early`), 2-second silent refresh tick, tmux-safe rendering, 80×24 baseline. Two design artifacts MUST land in the same PR as the scaffold (UX-DR1 wireframe, UX-DR2 empty-state copy library) — NFR19 merge gate, Sally signs off in the PR description. Unblocks all of 48.2 → 48.7 (every other Epic 48 story mounts INTO this scaffold).
>
> **Critical path:** Epic 47 (DONE — `/api/earnings` wire shape settled) → **48.1 (this)** → 48.2 (apex+per-peer buckets mount under hero) → 48.3 (badge mounts in hero) → 48.4 (ticker mounts as footer) → 48.7 (live gate).
>
> **Data source contract is FROZEN — do NOT call `/admin/*` directly.** All TUI data flows through `GET http://127.0.0.1:28090/api/earnings` (Story 47.4). Schema reference: `packages/townhouse/src/api/schemas/earnings.ts`. The shape that drives this story: `{ status: 'ok' | 'connector_unavailable', apex: { routingFees: Record<assetCode, PerAsset> }, peers: NodeEarnings[], recentClaims: RecentClaim[], eventsRelayed: number, uptimeSeconds: number }`. Per-asset fields are decimal-string bigints at assetScale decimals — the **dashboard owns unit display** (assetScale interpretation: USDC = 6, ETH = 18, sats = 0).
>
> **Net-new dependencies — read Dev Notes § "Library + Framework Stack" before drafting.** This story introduces `ink` (~5.x), `react` (^18.3.1), and `ink-testing-library` (^4.x) to `@toon-protocol/townhouse`. Townhouse-web already pins `react@^18.3.1` — use the same major to keep workspace install graphs clean. Tsconfig MUST enable JSX (`react-jsx`) — see § "Tsconfig Surgery".

## Story

As a **terminal operator (Drew)**,
I want **`townhouse hs up` to take over my terminal cleanly with an Ink-rendered TUI showing a hero band (`TODAY · MONTH · YEAR · LIFETIME` + 7-day sparkline), an empty-state qualifier on day one, and a silent 2-second refresh tick — tmux-safe, 80×24-safe, no animations, no chimes**,
so that **I see the shape of my system at a glance and the day-one experience tells me "you're early" instead of looking broken — and every other Epic 48 surface (apex/per-peer buckets, badge, activity ticker, overlay) has a real component tree to mount into**.

## Acceptance Criteria

1. **AC #1 — TTY-gated Ink takeover.** **Given** the TUI scaffold lives at `packages/townhouse/src/tui/`, **When** an operator runs `townhouse hs up` AND `process.stdout.isTTY === true`, **Then** an Ink-rendered TUI takes over the terminal (NOT a plain `console.log` stream). The Ink `render()` call is the LAST thing `handleHsUp` does in TTY mode (after the existing `_writeHostJson` write + `ribbon.start('live', hostname)` final ribbon line). The render must keep the process alive — the Ink `instance.waitUntilExit()` promise is awaited so the CLI does NOT exit 0 (foreground mode — overrides the AC #11 line in Story 45.4 that the CLI exits after printing the hostname; the new contract is "TTY → stays foreground in TUI; non-TTY → exits as before").

2. **AC #2 — Non-TTY structured logs only.** **Given** `process.stdout.isTTY !== true` (piped, redirected, `CI=true`, dumb terminal — same detection ladder `OnboardingRibbon` uses at `packages/townhouse/src/cli/onboarding-ribbon.ts:16-37`), **When** `townhouse hs up` runs, **Then** the CLI emits structured logs only (the existing onboarding ribbon's plain-line fallback path) AND the Ink renderer is NEVER constructed (no React-DOM-style import side effects on non-TTY paths — verified by spying on `ink.render` and asserting zero calls). The CLI exits 0 after the ribbon's `'live'` phase (Story 45.4 AC #11 behavior preserved on non-TTY).

3. **AC #3 — Hero band layout.** **Given** the hero band component, **When** the TUI renders, **Then** the top three rows show `TODAY · MONTH · YEAR · LIFETIME` formatted as USDC AND a 7-day ASCII sparkline below. Layout matches the wireframe at `_bmad-output/design/townhouse-tui-wireframe.md` (created by this story — see Task 3). Concrete row budget: row 1 = labels (`TODAY    MONTH    YEAR    LIFETIME`), row 2 = values (`$X.XX    $X.XX    $X.XX    $X.XX`), row 3 = sparkline (`▁▂▃▅▇█▇ 7d`). All four scalar values are computed at the route layer; the TUI ONLY formats. USDC formatting: scale-6 decimal-string → `$X.XX` via a dedicated formatter at `packages/townhouse/src/tui/format.ts`; NO floating-point arithmetic on the bigint string.

4. **AC #4 — Empty-state hero qualifier.** **Given** `peers[].byAsset['USDC'].month === '0'` for every peer AND `apex.routingFees['USDC']?.month === '0'` (or missing), **When** the hero band renders, **Then** the qualifier row shows `MONTH $0.00 · N events relayed · you're early` where `N` is `eventsRelayed` from `GET /api/earnings`. **And** when ANY `month` > 0 (apex OR any peer asset), the qualifier vanishes entirely (no whitespace placeholder; the row is removed from the component tree). The "you're early" copy is sourced from the empty-state copy library at `_bmad-output/design/empty-state-copy.md` (Task 3) — the TUI imports it as a typed const, NOT as a hardcoded string.

5. **AC #5 — 2-second silent refresh tick.** **Given** the TUI is mounted, **When** 2 seconds pass since the previous render, **Then** the TUI re-fetches `GET /api/earnings` AND re-renders silently (no animations, no chimes, no flash, no full-screen clears). The fetch uses an `AbortController` cancelled on unmount; in-flight requests during shutdown do NOT keep the process alive. On `status === 'connector_unavailable'`, the previous successful payload is retained AND a banner row appears between the hero and the (future) bucket area — copy from `empty-state-copy.md` (failure-state subsection). The fetch cadence is configurable via injection (`{ refreshIntervalMs?: number }` prop on the root component) so tests use 50ms without real-time waits; the default is `2_000`.

6. **AC #6 — 80×24 stress baseline (NFR13).** **Given** the TUI runs at `process.stdout.columns === 80` AND `process.stdout.rows === 24` (iPhone Termius baseline), **When** rendered, **Then** the hero band fits without truncation. Degradation order as columns shrink (verified via Ink's `useStdout()` hook + `<Box width={...}>` widths): **sparklines collapse first** (decorative; emit empty string at `<60ch`); **scalar value row stays** (load-bearing); **labels truncate to TODAY/MONTH/YEAR/LIFE** at `<70ch`. Row budget at 80×24: hero 3 rows + qualifier 1 row + (reserved for 48.2 apex strip) 1 row + (reserved for 48.2 peer table) 4 rows + (reserved for 48.4 ticker footer) 1 row = 10 rows used, 14 rows free. The reserved-for-future rows MUST be implemented as named layout slots (e.g. `<ApexStripSlot />`, `<PeerTableSlot />`, `<FooterSlot />`) returning empty fragments today — 48.2/48.4 mount real children into the slots. **No premature abstraction beyond these slots** — three layout slots is the maximum surface area this story builds.

7. **AC #7 — tmux compatibility (NFR14).** **Given** `process.env.TMUX` is set OR `process.env.TERM` matches `/^screen|^tmux/`, **When** the TUI runs, **Then** it NEVER `clear()`s the full terminal AND leaves the operator's tmux pane geometry alone AND respects `$TMUX` (no alternate-screen entry). Ink's default render mode uses `enterAltScreenCommand` — this story disables it explicitly via `render(<App />, { exitOnCtrlC: true, patchConsole: false })` AND configures `experimental_useStaticOutput` OFF. tmux test fixture: spawn the CLI under `tmux new-session -d -s test 'townhouse hs up'`, assert via `tmux capture-pane -p` that the alt-screen sequence (`\x1b[?1049h`) was NOT emitted.

8. **AC #8 — Merge gate: design artifacts exist + Sally signs off (NFR19).** **Given** this PR is reviewed, **When** the merge gate fires, **Then** `_bmad-output/design/townhouse-tui-wireframe.md` exists (UX-DR1) AND `_bmad-output/design/empty-state-copy.md` exists (UX-DR2) AND Sally has signed off in the PR description with the verbatim string `Sally sign-off (UX-DR1 + UX-DR2): approved`. The PR cannot merge without these artifacts. Reviewer checks: (a) the wireframe doc contains the ASCII grid at 80ch + 120ch breakpoints, Ink color tokens (dim-grey labels, green positive net, amber "early"), and the degrade ladder; (b) the empty-state copy doc covers every zero state, every wait state, every loading state — no `if (n === 0) return ''` allowed in the TUI source.

9. **AC #9 — Empty-state copy library (UX-DR2).** **Given** the empty-state copy library at `_bmad-output/design/empty-state-copy.md`, **When** read, **Then** every zero state, every wait state, every loading state has explicit copy. **And** the TUI source at `packages/townhouse/src/tui/copy.ts` re-exports the strings as a typed `const COPY = { heroEarly: '…', heroEarlyRotation: [...] as const, qualifierEvents: (n: number) => \`${n} events relayed\`, banners: { connectorUnavailable: '…', loading: '…', stale: '…' }, } as const;` — single source of truth in markdown, single typed export in code. **And** the unit-test suite asserts that NO string literal in `packages/townhouse/src/tui/components/**` matches `/(you're early|warming up|first packet|loading|connector)/i` (smoke check: copy lives in `copy.ts`, components reference it).

10. **AC #10 — Refresh cadence assertions (NFR3).** **Given** the TUI is mounted with `refreshIntervalMs: 50` in test mode, **When** 250ms elapse, **Then** at least 4 (`Math.floor(250 / 50) - 1`) refetches have fired (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(250)`); fetch deduplication during an in-flight request is OK (no overlapping requests — `<2s` real-world cadence ≫ typical 30ms LAN response). The 2-second default is set in ONE place: `export const DEFAULT_REFRESH_INTERVAL_MS = 2_000;` at `packages/townhouse/src/tui/constants.ts`.

11. **AC #11 — Unit-test surface coverage (TUI testing).** **Given** the TUI source files, **When** `pnpm --filter @toon-protocol/townhouse test` runs, **Then** the suite asserts:
    - `<App />` mounts WITHOUT calling `ink.render` when `isTTY` is mocked false.
    - `<HeroBand />` renders all four scalar columns with formatted USDC strings (snapshot via `ink-testing-library`).
    - `<HeroBand />` shows the empty-state qualifier when month==0 across the board; hides it when ANY month>0 (two snapshots).
    - The `useEarnings()` hook re-fetches at the configured interval (fake timers).
    - The `useEarnings()` hook retains the previous payload + sets a banner flag on `status === 'connector_unavailable'`.
    - The `formatUsdc(decimalString, scale)` helper rejects non-decimal input AND formats `'1234567'` at scale 6 as `'$1.23'` (truncates, does NOT round — connector posture).
    - The sparkline collapses to empty string when `width < 60`.
    - tmux detection branch: setting `process.env.TMUX = '1'` causes the render call to receive `{ patchConsole: false }` (assert via spy).
    Per the project's TUI testing rule (`townhouse-hs-v1-plan-2026-05-07.md:306-309`): **DO test** data → render mapping, keybind → state transitions, error states. **DON'T test** terminal resize, color output, animation timing.

12. **AC #12 — No regression on Story 45.4 contracts.** **Given** the existing `handleHsUp` path, **When** this story lands, **Then**: (a) on non-TTY, the CLI still exits 0 after the ribbon's `'live'` phase (Story 45.4 AC #11); (b) `~/.townhouse/host.json` is still written before any TUI render (atomic-write ordering preserved); (c) the connector / host-API containers still come up via `orchestrator.up([])` exactly as before — the TUI is a renderer on top of the existing boot pipeline, NOT a replacement; (d) `townhouse hs down` is unchanged. The Ink render is added at the END of `handleHsUp` after the existing `ribbon.start('live', hostname)` line, gated by `if (process.stdout.isTTY)`.

**FRs:** FR19 (Ink TUI default surface when stdout is TTY), FR20 (hero metric `MONTH $X.XX USDC`), FR23 (empty-state hero qualifier), FR27 (2-second silent refresh tick).
**NFRs:** NFR3 (TUI 2s refresh latency), NFR13 (renders correctly at 80×24), NFR14 (tmux-compatible — no full-screen clears), NFR19 (empty-state copy library ships in same PR as TUI scaffold).
**UX-DRs:** UX-DR1 (TUI wireframe spec), UX-DR2 (empty-state copy library — merge gate).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/cli.ts:813-1083` end-to-end (the `handleHsUp` function, ~270 lines). Confirm exact exit points (`process.exitCode = 1` paths, `return` after idempotent re-print, `finally` ribbon.stop). The TUI mount goes at the END after `ribbon.start('live', hostname)` — gated by `if (process.stdout.isTTY)`. Confirm Story 45.4 AC #11 ("CLI exits after printing hostname") still applies on the non-TTY branch — this story overrides it ONLY on TTY.
  - [x] 1.2 Read `packages/townhouse/src/cli/onboarding-ribbon.ts` end-to-end (~150 lines). Mirror its TTY detection ladder (`isTty()`, `supportsUnicode()`, `isAnimationDisabled()`) into the TUI's TTY gate — DO NOT duplicate the helpers; export the public predicate `shouldRenderInk()` from a new `packages/townhouse/src/tui/tty-detect.ts` that REUSES the same env probes (or extract a shared `packages/townhouse/src/cli/tty-environment.ts` if the ribbon's privates are too narrow — discuss in PR if extraction is preferred).
  - [x] 1.3 Read `packages/townhouse/src/api/routes/earnings.ts` end-to-end (~72 lines) + `packages/townhouse/src/api/schemas/earnings.ts` end-to-end (~120 lines). The TUI consumes the response shape of this exact endpoint at `http://127.0.0.1:28090/api/earnings`. Confirm the schema-locked fields the hero band uses: `apex.routingFees[asset].{lifetime,today,month,year}`, `peers[].byAsset[asset].{lifetime,today,month,year}`, `eventsRelayed`, `status`. All amount fields are decimal-string bigints (`pattern: '^-?\\d+$'`); the TUI MUST NOT coerce to `Number` — `BigInt` parsing then base-10-decimal formatting only.
  - [x] 1.4 Read `packages/townhouse/src/earnings/aggregator.ts:32-78` end-to-end. Confirm the exported `PerAsset`, `NodeEarnings`, `AggregatedEarnings` types — re-export the consumed subset from the TUI's types module (`packages/townhouse/src/tui/types.ts`) to keep the wire shape one-edit-away from the hero band. Do NOT redefine these types — import + re-export only.
  - [x] 1.5 Read `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154` end-to-end. This is the canonical TUI design spec for Epic 48. The hero band, empty-state qualifier, badge, ticker, drill, "cut from v1" list, and design-artifact requirements are all locked here. Cross-reference every layout decision in this story against this section.
  - [x] 1.6 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:989-1041` end-to-end (Epic 48 + Story 48.1 spec). Confirm the AC text in this story file matches the epic spec verbatim (any drift = a bug — fix the story, not the epic).
  - [x] 1.7 Read `_bmad-output/implementation-artifacts/47-4-get-api-earnings-two-bucket-endpoint.md` Dev Notes section. Re-read § "Open Questions resolved (2026-05-13)" — `recentClaims` is unbounded and orphan-peer claims pass through verbatim. The TUI must handle "peer in `recentClaims[]` but not in `peers[]`" gracefully (render with the raw peer-id, no crash). Save this context for Story 48.4 (Activity overlay) — but design Task 7's data model to NOT block on it.
  - [x] 1.8 Read `_bmad-output/implementation-artifacts/epic-47-retro-2026-05-13.md:196-222` end-to-end. Confirm carry-forward action items A5' (compose-env-contract test) and A6' (connector × townhouse smoke) are tracked elsewhere (NOT this story's scope) AND that `DEFAULT_HS_CHAIN_PROVIDERS` injection (47.5 D2) means the TUI's first impression on a clean install is NOT `connector_unavailable`. The TUI's `status: 'connector_unavailable'` banner is a real failure mode, not a first-boot stub.
  - [x] 1.9 Read `packages/townhouse-web/package.json` for the React version pin (`^18.3.1`). The TUI MUST use the same major to keep pnpm's workspace install graph compact (`pnpm install` should reuse the React graph, not bifurcate it).
  - [x] 1.10 Run `find packages/townhouse/src/tui -type f 2>/dev/null` — confirm the directory does NOT exist yet. This story creates it.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm `47-4-get-api-earnings-two-bucket-endpoint: done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent → STOP.
  - [x] 2.2 Confirm `47-5-live-e2e-gate-earnings-data-plane: done`. If absent → STOP (the live gate is what proves `/api/earnings` actually works against a real apex; without it, the TUI's "happy path" is unverifiable end-to-end).
  - [x] 2.3 Confirm `45-4-townhouse-hs-up-subcommand-apex-only-boot: done`. The TUI mounts INTO this command's TTY path.
  - [x] 2.4 `pnpm --filter @toon-protocol/townhouse build` is clean baseline. Capture: 1015 tests across the townhouse suite (after 47.4's +21 delta from baseline 994). Net delta target for this story: roughly +12 to +20 tests (`tui/format.test.ts` ~6, `tui/hero-band.test.tsx` ~5, `tui/use-earnings.test.tsx` ~4, `tui/tty-detect.test.ts` ~3, `cli.hs.test.ts` extended ~2 for TTY/non-TTY paths).
  - [x] 2.5 Run `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — confirm 43 tests pass sub-500ms. This story does NOT touch the canary; the count must be unchanged at story close.
  - [x] 2.6 Verify no in-flight branch is touching `cli.ts` or `cli/onboarding-ribbon.ts`: `gh pr list --state open --search "hs up OR onboarding"`. Coordinate with anyone who is.
  - [x] 2.7 Check Sally has uploaded the UX-DR1 and UX-DR2 design artifacts to `_bmad-output/design/`. If they are NOT present, the dev agent drafts initial versions (Task 3) using the canonical layout in `townhouse-hs-v1-plan-2026-05-07.md:104-154` AND the AC #4/#9 copy snippets — Sally reviews + edits + signs off in the PR description. **The story is NOT blocked on Sally; the dev agent owns the first draft.**

- [x] **Task 3: Create UX-DR1 + UX-DR2 design artifacts (AC: 8, 9)**
  > These are the merge-gate artifacts. They are markdown docs, NOT TypeScript — but they're load-bearing for AC #8 and AC #9. The dev agent drafts; Sally finalizes.
  - [x] 3.1 Create `_bmad-output/design/` directory if absent: `mkdir -p _bmad-output/design`.
  - [x] 3.2 Create `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1). Required sections:
    - **80ch reference grid** — ASCII art of the full layout at 80 columns (hero + qualifier + reserved slots + footer slot). Lift the row budget from this story's AC #6.
    - **120ch reference grid** — ASCII art at 120 columns showing the expanded sparkline + asset row widening.
    - **Ink color tokens** — `labelDim` (grey), `valuePositive` (green), `valueNeutral` (default), `earlyAccent` (amber), `bannerWarn` (yellow), `bannerError` (red).
    - **Degrade ladder** — column-by-column rules: sparklines drop at `<60ch`; labels truncate to short form at `<70ch`; asset rows stay; if `<60ch` is somehow reached, asset rows still stay (load-bearing).
    - **Resize behavior** — TUI re-reads `useStdout().stdout.columns` on the SIGWINCH-equivalent React state update (Ink handles this internally via the `useStdoutDimensions` pattern); no explicit listener needed.
    - **Cross-references** — `townhouse-hs-v1-plan-2026-05-07.md:104-154` is the upstream spec.
  - [x] 3.3 Create `_bmad-output/design/empty-state-copy.md` (UX-DR2). Required structure:
    - **Hero qualifier (zero state)** — exact string: `MONTH $0.00 · {N} events relayed · you're early`. Rotation variants (used by Story 48.3): `you're early`, `warming up`, `first packet en route`.
    - **Loading state** — `Fetching earnings…` (rendered for the brief window between mount and first fetch resolution).
    - **`connector_unavailable` banner** — `Connector not reachable — showing last known values. Retrying in 2s.`
    - **Stale data hint** — `Last refresh failed — data may be {N}s old.`
    - **Future-state placeholders** — entries for: apex routing empty (`(enable mill to route)` per Story 48.2), per-peer table empty (`no peers yet — run 'townhouse node add town'` per Story 48.2), recentClaims empty (`no settlements yet — press [a] when activity arrives` per Story 48.4). These ship in 48.2/48.4 but the COPY lives here NOW so Sally can review one library, not three.
    - **Anti-pattern callout** — explicit rule: every zero/wait/loading branch in the TUI source imports a string from `copy.ts` (no `if (n === 0) return ''` allowed).
  - [x] 3.4 Tag Sally in the PR description with `Sally sign-off (UX-DR1 + UX-DR2): approved` placeholder line — Sally fills the approval in review. The verbatim string is asserted by the merge gate (AC #8).

- [x] **Task 4: Add dependencies + tsconfig surgery (AC: 1, 11)**
  - [x] 4.1 Add to `packages/townhouse/package.json` `dependencies`:
    ```json
    "ink": "^5.0.0",
    "react": "^18.3.1"
    ```
    Pin React to `^18.3.1` to match `packages/townhouse-web/package.json:32` — keeps pnpm's React graph single-major.
  - [x] 4.2 Add to `packages/townhouse/package.json` `devDependencies`:
    ```json
    "ink-testing-library": "^4.0.0",
    "@types/react": "^18.3.3"
    ```
  - [x] 4.3 Update `packages/townhouse/tsconfig.json` — add JSX support without overriding the root project's strict settings:
    ```json
    {
      "extends": "../../tsconfig.json",
      "compilerOptions": {
        "outDir": "./dist",
        "rootDir": "./src",
        "jsx": "react-jsx"
      },
      "include": ["src/**/*.ts", "src/**/*.tsx"],
      "exclude": ["node_modules", "dist"]
    }
    ```
    The `react-jsx` mode mirrors `packages/townhouse-web/tsconfig.json:5` — no `import React` boilerplate needed.
  - [x] 4.4 Update `packages/townhouse/vitest.config.ts` — add `.tsx` to the include pattern:
    ```typescript
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    ```
    Leave `environment: 'node'` (Ink renders to a string buffer; no jsdom needed — `ink-testing-library` provides its own renderer).
  - [x] 4.5 Update `packages/townhouse/tsup.config.ts` — confirm tsup picks up `.tsx` automatically (it does, via esbuild). No config change needed UNLESS the build emits a warning about missing JSX runtime — in which case add `loader: { '.tsx': 'tsx' }` to the tsup config. Validate with `pnpm --filter @toon-protocol/townhouse build`.
  - [x] 4.6 Run `pnpm install` at the workspace root. Verify React's `node_modules/.pnpm/react@18.3.1` directory is shared with townhouse-web (single graph, no bifurcation). If pnpm warns about peer-dep mismatch on Ink → React, escalate before proceeding.

- [x] **Task 5: Build the TUI directory + TTY-detection helper (AC: 1, 2, 7)**
  - [x] 5.1 Create `packages/townhouse/src/tui/` directory with:
    - `index.ts` — exports `mountTui(props)` returning the Ink `Instance`.
    - `App.tsx` — the root React component.
    - `tty-detect.ts` — TTY predicate + tmux probe; mirrors `onboarding-ribbon.ts:16-37`.
    - `constants.ts` — `DEFAULT_REFRESH_INTERVAL_MS = 2_000`, `DEFAULT_API_URL = 'http://127.0.0.1:28090'`.
    - `types.ts` — re-exports `AggregatedEarnings`, `NodeEarnings`, `PerAsset`, `RecentClaim` from `../earnings/aggregator.js`.
    - `copy.ts` — imports the empty-state copy from `_bmad-output/design/empty-state-copy.md` as a typed `const COPY` (the markdown is the source of truth; the typed export is the in-code surface). **The strings are duplicated in code — that is intentional**; the markdown doc is the design-review artifact, the TS file is what compiles. Add a sync-check test (Task 9.4).
  - [x] 5.2 Implement `tty-detect.ts`:
    ```typescript
    export function shouldRenderInk(): boolean {
      if (process.stdout.isTTY !== true) return false;
      if (process.env['CI'] === 'true') return false;
      if (process.env['NO_TUI'] === '1') return false; // operator opt-out
      if ((process.env['TERM'] ?? '') === 'dumb') return false;
      return true;
    }
    export function isTmux(): boolean {
      if (process.env['TMUX'] !== undefined && process.env['TMUX'] !== '') return true;
      const term = process.env['TERM'] ?? '';
      return /^screen|^tmux/.test(term);
    }
    ```
  - [x] 5.3 Implement `mountTui()` in `index.ts`:
    ```typescript
    import { render, type Instance } from 'ink';
    import React from 'react';
    import App from './App.js';
    export interface MountTuiOptions {
      apiUrl?: string;
      refreshIntervalMs?: number;
      fetchImpl?: typeof fetch; // injection point for tests
    }
    export function mountTui(opts: MountTuiOptions = {}): Instance {
      return render(<App {...opts} />, {
        exitOnCtrlC: true,
        patchConsole: false, // NEVER swallow console output (tmux-safe)
      });
    }
    ```
    > **Note:** `.js` extension on `./App.js` is required by ESM + tsc/tsup — the project enforces this (see `_bmad-output/project-context.md` § ESM imports).

- [x] **Task 6: Build the data layer — `useEarnings()` hook (AC: 5, 10)**
  - [x] 6.1 Create `packages/townhouse/src/tui/use-earnings.ts` (regular `.ts`, no JSX needed in the hook itself):
    ```typescript
    import { useEffect, useRef, useState } from 'react';
    import type { AggregatedEarnings } from './types.js';
    import { DEFAULT_API_URL, DEFAULT_REFRESH_INTERVAL_MS } from './constants.js';

    export type EarningsState =
      | { phase: 'loading'; data: null; bannerKey: null }
      | { phase: 'ok'; data: AggregatedEarnings; bannerKey: null }
      | { phase: 'stale'; data: AggregatedEarnings; bannerKey: 'connector_unavailable' | 'fetch_failed' };

    export interface UseEarningsOptions {
      apiUrl?: string;
      refreshIntervalMs?: number;
      fetchImpl?: typeof fetch;
    }

    export function useEarnings(opts: UseEarningsOptions = {}): EarningsState { /* ... */ }
    ```
    Implementation rules:
    - Fetch on mount, then `setInterval` at `refreshIntervalMs` (default `2_000`).
    - Use `AbortController` per fetch; cancel previous in-flight on next interval tick AND on unmount.
    - On HTTP 200 + `body.status === 'ok'` → state becomes `{ phase: 'ok', data, bannerKey: null }`.
    - On HTTP 200 + `body.status === 'connector_unavailable'` → if previous state had data, retain it as `{ phase: 'stale', data: prev.data, bannerKey: 'connector_unavailable' }`; else first-load `{ phase: 'stale', data: emptyShape, bannerKey: 'connector_unavailable' }`.
    - On network error / non-200 → if previous had data, retain as `{ phase: 'stale', data, bannerKey: 'fetch_failed' }`; else stays `{ phase: 'loading', ... }` (don't promote to stale without data to retain).
    - Inject `fetch` via `opts.fetchImpl` for tests; default `globalThis.fetch` (Node 20+ ships fetch natively — confirmed by NFR15).
  - [x] 6.2 Add a `tui/use-earnings.test.ts` with the cases enumerated in AC #11 (refetch cadence with fake timers; banner transitions; abort on unmount).

- [x] **Task 7: Build the hero band + qualifier components (AC: 3, 4, 6)**
  - [x] 7.1 Create `packages/townhouse/src/tui/format.ts`:
    - `formatUsdc(decimalString: string, scale: number): string` — parses a decimal-string bigint, divides by 10^scale, formats as `$X.XX` (truncates, does NOT round — match connector posture).
    - Rejects non-decimal input (regex `^-?\d+$`); throws on violation in dev, returns `'$?.??'` in production builds (decide via `process.env.NODE_ENV`; default dev posture is to throw — safer).
    - Unit tests: `formatUsdc('1234567', 6) === '$1.23'`, `formatUsdc('0', 6) === '$0.00'`, `formatUsdc('-500000', 6) === '-$0.50'`, `formatUsdc('not-a-number', 6)` throws in dev / returns `'$?.??'` in prod.
  - [x] 7.2 Create `packages/townhouse/src/tui/components/HeroBand.tsx`:
    - Props: `{ apex: AggregatedEarnings['apex']; peers: AggregatedEarnings['peers']; eventsRelayed: number; }`.
    - Computes four scalars: TODAY/MONTH/YEAR/LIFETIME = sum of USDC across `apex.routingFees['USDC']` + every `peer.byAsset['USDC']` for that window. **Asset filter:** `'USDC'` ONLY in v1 (story 48.2 will handle multi-asset stacking via UX-DR7; this story renders USDC top-line only). If `USDC` is absent from every bucket → display all zeros.
    - Renders rows 1–3 (labels, values, sparkline). Sparkline at empty `[]` data → renders `'·'` repeated 7 times as a placeholder (not empty — visual continuity).
    - Renders row 4 (qualifier) iff every `month` value is `'0'` — else returns no qualifier row.
  - [x] 7.3 Create `packages/townhouse/src/tui/components/Sparkline.tsx`:
    - Props: `{ values: number[]; width: number }`.
    - Maps each value to a char from `▁▂▃▄▅▆▇█`; empty array → `'·'` × 7.
    - When `width < 60` → returns `<Text />` with empty children (collapse — AC #6).
    - For v1, accept the `values` prop as-is — the upstream computation of 7-day samples is a downstream story (48.2/48.4 may extend the wire shape; until then pass `[]`).
  - [x] 7.4 Create `packages/townhouse/src/tui/components/Qualifier.tsx`:
    - Props: `{ eventsRelayed: number }`.
    - Renders the AC #4 string using `COPY.qualifierEvents(eventsRelayed)` + `COPY.heroEarly`.
  - [x] 7.5 Create `packages/townhouse/src/tui/components/Banner.tsx`:
    - Props: `{ bannerKey: 'connector_unavailable' | 'fetch_failed' | null }`.
    - Renders `COPY.banners[bannerKey]` when non-null; renders nothing when null.

- [x] **Task 8: Build `<App />` — assemble everything + reserve layout slots (AC: 1, 6, 12)**
  - [x] 8.1 Create `packages/townhouse/src/tui/App.tsx`:
    ```tsx
    export interface AppProps {
      apiUrl?: string;
      refreshIntervalMs?: number;
      fetchImpl?: typeof fetch;
    }
    export default function App(props: AppProps) {
      const state = useEarnings(props);
      // Layout: hero (3 rows) + qualifier (0-1 rows) + banner (0-1 rows) + apex slot (1) + peer slot (4) + footer slot (1)
      return (
        <Box flexDirection="column">
          <HeroBand ... />
          {qualifierShouldShow ? <Qualifier ... /> : null}
          <Banner bannerKey={state.bannerKey} />
          <ApexStripSlot />  {/* reserved for 48.2 */}
          <PeerTableSlot />  {/* reserved for 48.2 */}
          <FooterSlot />     {/* reserved for 48.4 */}
        </Box>
      );
    }
    ```
    The three slot components are stub fragments today; 48.2/48.4 mount real children into them WITHOUT touching `App.tsx`.
  - [x] 8.2 Wire the mount into `handleHsUp` at `packages/townhouse/src/cli.ts:1073` (after the existing `ribbon.start('live', hostname)` line). Add this BEFORE the `} catch (err: unknown) {` block:
    ```typescript
    // Story 48.1: foreground Ink TUI when stdout is a TTY.
    if (shouldRenderInk()) {
      const { mountTui } = await import('./tui/index.js');
      const instance = mountTui({});
      await instance.waitUntilExit();
    }
    // Non-TTY path: process exits naturally after this block (Story 45.4 AC #11).
    ```
    The dynamic `import('./tui/index.js')` is intentional — it keeps Ink + React out of the non-TTY code path's startup work (faster `--help`, faster scripted invocations).
  - [x] 8.3 Update the `townhouse hs up` usage line in `HELP_TEXT` at `cli.ts:82-110` — append `(launches dashboard TUI in TTY mode)` to the `townhouse hs up` line.
  - [x] 8.4 Confirm Story 45.4 AC #12 unchanged: the failure-copy `catch` block at `cli.ts:1074-1077` STILL renders Sally's failure copy on `OrchestratorError` before the TUI would mount — the TUI mount is AFTER the success path's final ribbon line, so failures short-circuit before Ink loads.

- [x] **Task 9: Tests (AC: 11)**
  - [x] 9.1 `packages/townhouse/src/tui/format.test.ts` — 6 cases for `formatUsdc()` (positive, zero, negative, large, non-decimal-throws-in-dev, scale variations).
  - [x] 9.2 `packages/townhouse/src/tui/tty-detect.test.ts` — 4 cases for `shouldRenderInk()` (TTY+sane → true; non-TTY → false; CI=true → false; TERM=dumb → false) + 2 cases for `isTmux()` (TMUX set → true; TERM=screen → true).
  - [x] 9.3 `packages/townhouse/src/tui/use-earnings.test.tsx` — 4 cases using `vi.useFakeTimers()`:
    - Mounts in `loading` phase; transitions to `ok` after first fetch.
    - Re-fetches at the configured interval (assert ≥4 calls after 250ms with 50ms interval).
    - `connector_unavailable` → state becomes `stale` retaining prior data.
    - Unmount aborts in-flight fetch (assert via spy on AbortController).
  - [x] 9.4 `packages/townhouse/src/tui/hero-band.test.tsx` — 5 cases via `ink-testing-library`:
    - Renders four scalar columns with formatted USDC.
    - Empty state shows qualifier; non-empty hides qualifier.
    - Sparkline collapses to empty at `width < 60`.
    - tmux env (`process.env.TMUX = '1'`) — render still emits no alt-screen sequence (mock the Ink renderer to assert `patchConsole: false`).
    - The hero band uses ONLY `COPY.*` strings — no hardcoded string literal in the component file (smoke check via `import * as Source` + reflection on the compiled output).
  - [x] 9.5 `packages/townhouse/src/tui/copy-sync.test.ts` — asserts the markdown doc at `_bmad-output/design/empty-state-copy.md` contains every string exported by `tui/copy.ts` (read both files; for each `COPY.heroEarly`, `COPY.banners.*`, etc., grep the markdown for the verbatim string). Prevents drift between the design doc (source of truth for Sally) and the TS export (source of truth for the compiler).
  - [x] 9.6 Extend `packages/townhouse/src/cli.hs.test.ts` (existing file from Story 45.4) — add 2 cases:
    - `townhouse hs up` with `process.stdout.isTTY = true` mocked → calls `mountTui` (assert via dynamic-import spy).
    - `townhouse hs up` with `process.stdout.isTTY = false` mocked → does NOT call `mountTui` AND exits 0 after the ribbon's live phase (Story 45.4 AC #11 preserved).
  - [x] 9.7 Run the full suite: `pnpm --filter @toon-protocol/townhouse test`. Expected delta: roughly +12 to +20 tests over the 1015 baseline. Document the actual delta in the Dev Agent Record.

- [x] **Task 10: Build, lint, regression sweep**
  - [x] 10.1 `pnpm --filter @toon-protocol/townhouse build` — clean (no typecheck errors). If tsup complains about `.tsx` resolution, see Task 4.5.
  - [x] 10.2 `pnpm lint` — clean. If ESLint flags Ink's JSX (no `import React` due to `react-jsx` mode), check that the project's ESLint config respects `jsxFactory` / `jsxImportSource` settings or add `'react/react-in-jsx-scope': 'off'` to the package's `.eslintrc` if one exists.
  - [x] 10.3 `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` — still 43 tests sub-500ms (UNCHANGED).
  - [ ] 10.4 Manual smoke at `80×24` in a real terminal: shrink your terminal to 80×24, run `townhouse hs up` (against a local apex from the dev infra), confirm hero band fits.
  - [ ] 10.5 Manual tmux smoke: `tmux new-session 'townhouse hs up'`, confirm pane geometry unchanged, no alt-screen takeover, can `tmux capture-pane -p` and see the hero band.
  - [ ] 10.6 Manual pipe smoke: `townhouse hs up | cat` — confirm NO Ink rendering, only the ribbon's `'live'` line, exit 0.

- [x] **Task 11: Story close-out**
  - [x] 11.1 Update `Status: ready-for-dev` → `review` in the story header AND in `sprint-status.yaml`.
  - [x] 11.2 Add the dated `### Review Findings` entry per the close-out checklist.
  - [ ] 11.3 Open PR; include `Sally sign-off (UX-DR1 + UX-DR2): approved` placeholder; tag Sally; await sign-off; do NOT merge without it (AC #8).

## Dev Notes

### Source-of-Truth Reference Chain

This story's authoritative chain (in priority order — if these disagree, the higher one wins):

1. **This story file** — every AC and Task above is the dev agent's contract.
2. **`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154`** — the canonical Epic 48 TUI design spec (hero band rows, empty-state qualifier, badge, ticker, drill, "cut from v1", design artifacts).
3. **`_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:989-1041`** — Epic 48 / Story 48.1 spec (the AC text in this story matches verbatim).
4. **`_bmad-output/implementation-artifacts/47-4-get-api-earnings-two-bucket-endpoint.md`** — the `/api/earnings` wire shape (frozen via JSON schema at `packages/townhouse/src/api/schemas/earnings.ts`).
5. **`_bmad-output/implementation-artifacts/47-5-live-e2e-gate-earnings-data-plane.md`** — gate that proves the wire shape works against a live apex.
6. **`_bmad-output/implementation-artifacts/epic-47-retro-2026-05-13.md:196-222`** — Epic 47 → Epic 48 handoff and dependencies.
7. **`_bmad-output/project-context.md`** — coding rules + patterns + conventions (ESM `.js` extensions, `pnpm --filter` instead of root, sub-agent RAM rules).

### Library + Framework Stack

| Dependency | Version | Why | Notes |
|---|---|---|---|
| `ink` | `^5.0.0` | TUI framework — chosen at Round 4–5 (`townhouse-hs-v1-plan-2026-05-07.md:327`) over ratatui (build cost) and Tauri (Maya, not Drew). Ink 5 is ESM-only — fits the project. | Stable since 2024. |
| `react` | `^18.3.1` | Required by Ink 5. Pin matches `packages/townhouse-web/package.json:32` to keep pnpm's React graph single-major. | Concurrent rendering NOT enabled (Ink uses sync renderer). |
| `ink-testing-library` | `^4.0.0` | TUI snapshot + render helpers. Project's testing rule (`townhouse-hs-v1-plan-2026-05-07.md:307`): test data → render mapping, NOT terminal resize / color / animation. | Provides `render()` + `lastFrame()` for snapshot assertions. |
| `@types/react` | `^18.3.3` | TS types for React. | DevDep only. |

**Do NOT add:** `chalk` (Ink handles color via `<Text color="...">`), `figures` (Ink ships unicode-safe defaults), `update-notifier` (Ink + scripted invocation incompatibility), any TUI alternative (`blessed`, `neo-blessed`, `terminal-kit` — all rejected at round 4–5).

### Tsconfig Surgery (Critical — Easy to Miss)

The root `tsconfig.json:1-28` has NO `jsx` setting. `packages/townhouse/tsconfig.json` MUST add `"jsx": "react-jsx"` AND extend its `include` pattern to cover `.tsx`. The `react-jsx` mode is the modern JSX transform — no `import React from 'react'` needed in every component file. Mirrors `packages/townhouse-web/tsconfig.json:5`.

Add to `packages/townhouse/vitest.config.ts` the `.tsx` include pattern (Task 4.4). `environment: 'node'` is correct — Ink renders to a string buffer, not DOM. `ink-testing-library` ships its own renderer (`render()` returns `{ lastFrame, rerender, unmount }`).

### File Structure Requirements

**NEW files (this story creates):**

```
packages/townhouse/src/tui/
├── index.ts                       # exports mountTui()
├── App.tsx                        # root component
├── tty-detect.ts                  # shouldRenderInk() + isTmux()
├── tty-detect.test.ts
├── use-earnings.ts                # useEarnings() hook
├── use-earnings.test.tsx
├── format.ts                      # formatUsdc()
├── format.test.ts
├── constants.ts                   # DEFAULT_REFRESH_INTERVAL_MS, DEFAULT_API_URL
├── types.ts                       # re-exports from earnings/aggregator
├── copy.ts                        # typed COPY const
├── copy-sync.test.ts              # asserts copy.ts ↔ markdown sync
└── components/
    ├── HeroBand.tsx
    ├── HeroBand.test.tsx
    ├── Sparkline.tsx
    ├── Qualifier.tsx
    ├── Banner.tsx
    ├── ApexStripSlot.tsx          # reserved for 48.2 — returns empty fragment
    ├── PeerTableSlot.tsx          # reserved for 48.2 — returns empty fragment
    └── FooterSlot.tsx             # reserved for 48.4 — returns empty fragment

_bmad-output/design/
├── townhouse-tui-wireframe.md     # UX-DR1
└── empty-state-copy.md            # UX-DR2
```

**UPDATE files (this story modifies):**

| File | Change | Reason |
|---|---|---|
| `packages/townhouse/package.json` | Add `ink`, `react`, `ink-testing-library`, `@types/react` | Task 4.1–4.2 |
| `packages/townhouse/tsconfig.json` | Add `"jsx": "react-jsx"` + extend `include` | Task 4.3 |
| `packages/townhouse/vitest.config.ts` | Extend `include` to `.test.tsx` | Task 4.4 |
| `packages/townhouse/tsup.config.ts` | Maybe add `.tsx` loader (only if build complains) | Task 4.5 |
| `packages/townhouse/src/cli.ts` | Add Ink mount call after `ribbon.start('live', ...)` line; extend `HELP_TEXT` | Task 8.2–8.3 |
| `packages/townhouse/src/cli.hs.test.ts` | Add 2 TTY/non-TTY mount cases | Task 9.6 |

### Wire Shape Reference (FROZEN — do NOT modify)

The TUI consumes EXACTLY this shape from `GET http://127.0.0.1:28090/api/earnings`. Schema source: `packages/townhouse/src/api/schemas/earnings.ts`. Type source: `packages/townhouse/src/earnings/aggregator.ts:65-78` (`AggregatedEarnings`).

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
    id: string;                              // == connector peerId
    type: 'town' | 'mill' | 'dvm' | 'external';
    byAsset: Record<assetCode, { lifetime, today, month, year }>;
    lastClaimAt: string | null;              // ISO-8601 or null
  }>;
  recentClaims: Array<{                      // pass-through from connector; UNBOUNDED
    peerId: string;
    assetCode: string;
    assetScale: number;
    amount: string;                          // decimal-string bigint at assetScale
    direction: 'inbound' | 'outbound';
    at: string;                              // ISO-8601
  }>;
  eventsRelayed: number;                     // sum of /admin/metrics.json peers[].packetsForwarded
  uptimeSeconds: number;
}
```

**Critical posture points:**
- All amount fields are **decimal-string bigints**. Use `BigInt(...)` to parse, never `Number(...)`. The dashboard owns scale (USDC=6, ETH=18, sats=0).
- `status === 'connector_unavailable'` is a real failure mode (route still returns HTTP 200) — surface as a banner, NOT a 5xx error overlay. Previous data is retained.
- `recentClaims` is unbounded (47.4 Decision D3a). The TUI does NOT need to handle this in 48.1 (Activity overlay is 48.4); just consume the field shape into types.
- Orphan-peer claims (peerId in `recentClaims[]` but not in `peers[]`) are connector-source-of-truth and pass through verbatim (47.4 Decision D3b). Render with the raw peer-id label when 48.4 ships; this story doesn't render claims yet.

### TTY Detection — Reuse the OnboardingRibbon Ladder

`packages/townhouse/src/cli/onboarding-ribbon.ts:16-37` already implements:
- `isTty()` — `process.stdout.isTTY === true`.
- `supportsUnicode()` — TERM matches xterm/screen/tmux OR COLORTERM is set.
- `isAnimationDisabled()` — NO_COLOR set OR CI=true.

The TUI's `shouldRenderInk()` REUSES these predicates' logic (or extracts them to a shared `cli/tty-environment.ts` module — preferred if the ribbon team agrees in PR; otherwise just mirror the env probes in `tui/tty-detect.ts`).

**Rule:** if `shouldRenderInk() === false`, do NOT even import `ink` (use dynamic `await import()` per Task 8.2). Keeps startup time fast on scripted invocations.

### tmux Compatibility — Critical Details

Ink's default `render()` mode enters the terminal's alternate screen (`\x1b[?1049h`), which BREAKS tmux's scrollback. NFR14 forbids this.

Fix: call `render(<App />, { exitOnCtrlC: true, patchConsole: false })`. Setting `patchConsole: false` keeps stdout/stderr unswallowed AND (with Ink's default since 4.x) avoids the alt-screen entry. Verify with the `tmux capture-pane -p` test in Task 9.4 (Test 4).

`isTmux()` (Task 5.2) is used by future stories (48.3 badge animation cadence may differ in tmux, 48.4 overlay positioning) — this story exports the helper but does NOT branch on it beyond confirming `patchConsole: false`.

### Empty-State Copy Library — How the Markdown ↔ TS Sync Works

Sally's design artifact (`_bmad-output/design/empty-state-copy.md`) is the source of truth for COPY review. The compiled TypeScript const at `packages/townhouse/src/tui/copy.ts` is the source of truth for the build. These will drift if no test guards them.

**Mechanism (Task 9.5):**
1. `copy.ts` exports `const COPY = { ... } as const;` — all strings inline.
2. `copy-sync.test.ts` reads both files at test time:
   - Read `_bmad-output/design/empty-state-copy.md` as raw text.
   - Reflect on every leaf string in `COPY` (recursive — `COPY.banners.connector_unavailable`, `COPY.heroEarly`, etc.).
   - For each leaf string, assert the markdown file contains a `\`backticked\` exact match. (Mark each canonical copy line in the markdown with backticks: `\`MONTH $0.00 · {N} events relayed · you're early\``.)
3. If Sally edits the markdown, the test fails → dev updates `copy.ts` → test passes. If a dev edits `copy.ts` without updating the markdown, the test fails → loop closes.

### Slot Pattern — How 48.2 / 48.4 Mount

The three placeholder components (`ApexStripSlot`, `PeerTableSlot`, `FooterSlot`) are intentional layout reservations:

```tsx
// packages/townhouse/src/tui/components/ApexStripSlot.tsx (this story)
export function ApexStripSlot(): null { return null; }
// 48.2 will replace the file body with the actual apex strip.
```

This keeps `App.tsx`'s layout stable across 48.2/48.4 — Drew sees the row budget reservation today (blank), gets the real content tomorrow. **No file-level refactor required when 48.2 lands.** This is the only abstraction this story builds; per project-context rules, do not invent more.

### Refresh Tick — Why 2 Seconds, Why Silent

Per `townhouse-hs-v1-plan-2026-05-07.md:118-123`: silent refresh, no animations, no chimes, no slot-machine effects. The 2-second cadence is short enough that operators trust the data, long enough that the connector's snapshot writer (hourly cadence per Story 47.3) is the rate-limiting factor — not the TUI.

In tests, use `refreshIntervalMs: 50` to keep fake-timer ticks practical. In production, use the constant `DEFAULT_REFRESH_INTERVAL_MS = 2_000`. Configurability is intentional — the live gate (48.7) may need to override it.

### Asset Filter — USDC Only in v1

`townhouse-hs-v1-plan-2026-05-07.md:129-141` (the authoritative metrics catalog) shows USDC is the canonical hero display. Multi-chain support (UX-DR7 / per-asset row layout) is Story 48.2 + future Mill multi-chain (v0.5+). **This story's hero band filters `'USDC'` only**; non-USDC assets are silently ignored at the hero level. The wire shape preserves all assets — the TUI just doesn't render them yet.

If a peer has ONLY non-USDC assets, the peer contributes zero to the hero scalars. That's correct — the day-one operator on a fresh apex has the empty state regardless.

### What NOT to do

- **Do NOT** call `/admin/*` directly from the TUI. The wire is `/api/earnings` only. (Story 48.2 AC #7 ratifies this for the apex+per-peer table; this story enforces it from the start.)
- **Do NOT** introduce `chalk`, `figures`, or any TUI helper beyond `ink` + `react`. Ink's `<Text color="green">` is the only color path.
- **Do NOT** add a "loading spinner" animation. The 2-second silent tick is the design (NFR3). A spinner = an animation = a "slot-machine effect" the design explicitly cuts.
- **Do NOT** add a "you're early" badge in this story. That's Story 48.3.
- **Do NOT** mount the apex strip, per-peer table, activity ticker, activity overlay, or any drill subcommand. Those are 48.2 / 48.4 / 48.5.
- **Do NOT** add a terminal-resize listener. Ink handles SIGWINCH-equivalent re-renders via `useStdout` hook internally. Project's TUI testing rule explicitly says "DON'T test terminal resize" — also don't custom-code it.
- **Do NOT** add multi-asset rendering. USDC only in v1 hero (UX-DR7 is Story 48.2's problem).
- **Do NOT** keep the CLI process alive on non-TTY. Story 45.4 AC #11 — exits 0 after `'live'` ribbon line. ONLY the TTY branch awaits `instance.waitUntilExit()`.
- **Do NOT** add a feature flag or env var beyond `NO_TUI=1` (the operator opt-out for the TTY → non-TTY override). The TUI is the default surface (FR19); ops can opt out, not opt in.
- **Do NOT** add backward-compat shims. The `townhouse hs up` command's contract changes (TTY now stays foreground); update Story 45.4 AC #11's wording IN this story's Dev Agent Record (callout in completion notes), don't try to preserve both behaviors.

### Architecture Compliance

- **ESM-only.** Every relative import uses `.js` extension (e.g. `from './use-earnings.js'`). NFR15 enforcement. Pattern: `_bmad-output/project-context.md` § ESM imports.
- **Node 20+, TypeScript ^5.3.** Already the package baseline (NFR15).
- **Strict TS.** Root `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess: true`, `noPropertyAccessFromIndexSignature: true`. The TUI code MUST respect these — `state.data?.peers?.[0]?.byAsset['USDC']?.month` (every access guarded). React's type system + Ink's `<Text>` / `<Box>` props are strict-compatible out of the box.
- **Loopback-only API.** `DEFAULT_API_URL = 'http://127.0.0.1:28090'` — the TUI never reaches off-host. Mirrors NFR9 enforcement at the data layer.
- **File modes.** No new files at mode `0o600` in this story — the TUI sources are source code, not operator secrets (NFR8 applies to runtime state files only).

### Testing Standards

Per `_bmad-output/project-context.md` + `townhouse-hs-v1-plan-2026-05-07.md:306-309`:

| Tool | Use For |
|---|---|
| `vitest` | All unit tests. Already the package default. |
| `ink-testing-library` | Component render snapshots (`render(<HeroBand .../>); expect(lastFrame()).toMatchSnapshot();`). |
| `vi.useFakeTimers()` | Refresh-tick assertions; avoid real-time sleeps. |
| Manual smoke (Task 10.4–10.6) | 80×24 + tmux + pipe behavior. Visual QA can't be automated cheaply at v1 budget. |

**Run command:** `pnpm --filter @toon-protocol/townhouse test`. NEVER `pnpm test` at workspace root (RAM exhaustion per CLAUDE.md). Sub-agent invocations of these tests MUST have `timeout: 120000` per CLAUDE.md.

**Net delta target:** +12 to +20 tests over the 1015 baseline established by Story 47.4. Capture the actual delta in the close-out.

### Previous Story Intelligence

From `47-4-get-api-earnings-two-bucket-endpoint.md` Review Findings:
- Decision **D2** kept `additionalProperties: false` on the top-level + peer schemas but opened `recentClaim` and `perAsset` subobjects to future connector-shipped fields. **Impact for 48.1:** the TUI's `types.ts` re-exports the closed-shape interfaces; future connector additions land as wire-shape additions in `aggregator.ts` and the TUI picks them up transparently.
- Decision **D4** added `pattern: '^-?\\d+$'` on every amount field. **Impact for 48.1:** the `formatUsdc(decimalString)` helper can trust input regex-wise — but Task 7.1 still asserts the contract defensively (parse `^-?\d+$` and reject otherwise). Defense in depth is cheap.
- Patch **P3** added a `clampInt()` guard on `eventsRelayed`. **Impact for 48.1:** `eventsRelayed` is always a sane integer ≥0; the qualifier's `N events relayed` rendering is safe.

From `45-4-townhouse-hs-up-subcommand-apex-only-boot.md`:
- The `OnboardingRibbon` is the precedent for TTY detection + fallback (`onboarding-ribbon.ts:16-37`). **Reuse the env probes; do not reinvent.**
- AC #11: "the CLI exits after printing the hostname" — **this story OVERRIDES that ONLY on TTY.** Update Story 45.4 in the Dev Agent Record (a callout, not an edit — Story 45.4 is `done` and immutable; the override is documented in this story's completion notes).
- The `walletManager.lock()` finally-block at `cli.ts:1079-1081` runs BEFORE the TUI mounts in the proposed Task 8.2 placement. **Reorder is required:** the TUI mount goes INSIDE the `try` block, after `ribbon.start('live', hostname)`, BEFORE the `} catch (err: unknown) {` line. The `finally` still runs on `instance.waitUntilExit()` resolution. Verify with the manual smoke in Task 10.5 (Ctrl-C unmounts; wallet locks).

### Git Intelligence — Recent Commits

```
be54ebe Epic 47: Earnings Data Plane (stories 47.1–47.5 + retro) (#59)
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
6d0ff13 fix(publish): native arm64 runners — drop QEMU, fix DVM SIGILL (#57)
4f2aa88 fix(townhouse-hs): bump connector pin to 3.6.2 + opt peers into direct transport (#56)
b61da63 fix(townhouse-hs): batched integration fixes D + E + F + G + H + I + J (#54)
4913ad9 Epic 46: Lazy Peer Node Provisioning (stories 46.1–46.4) (#53)
```

**Actionable signals:**
- Epic 47 (#59) shipped on `epic-48` predecessor. The data plane is settled — TUI consumes a stable wire shape.
- Connector pin is v3.6.3 (`packages/townhouse/src/constants.ts:25-31`). Don't bump.
- `townhouse-hs.yml` is the active compose template. The `townhouse-api` service exposes `127.0.0.1:28090` (compose template lines 152, 176) — this is the TUI's data source.

### Latest Tech Information — Ink 5 + React 18

- **Ink 5** is the current major (Sindre Sorhus, 2024+). ESM-only. Requires Node ≥18. React 18.3 is the recommended pin (Ink's own peer-deps).
- **React 18.3.1** is the current 18.x. Strict mode + concurrent features are NOT enabled by Ink's renderer (sync only). No `<StrictMode>` wrapper needed.
- **ink-testing-library 4** ships `render()` + `lastFrame()` + `frames` + `rerender()` + `unmount()`. Works under `environment: 'node'`. Documented at https://github.com/vadimdemedes/ink#testing — patterns mirror React Testing Library.
- **Common pitfall:** Ink's `<Newline />` and `<Text>{'\n'}</Text>` render differently in some terminals. Stick to `<Box flexDirection="column">` for vertical layout and `<Text>` for atomic strings.
- **Color in Ink:** `<Text color="green">`, `<Text color="dim">`, `<Text color="yellow">`, etc. Ink calls `supports-color` internally — degrades to no color on TERM=dumb / NO_COLOR.

### Project Context Reference

Coding rules / patterns / conventions: see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:
- **ESM imports** — relative imports use `.js` extension (`from './use-earnings.js'`).
- **`pnpm --filter <pkg> test`** — never `pnpm test` at workspace root.
- **Sub-agent RAM rules** — keep test invocations narrow; always set `timeout: 60000` (build) / `120000` (test).
- **Loopback-only API binding** — already enforced by `buildFastifyApp`; TUI consumes `127.0.0.1` only.
- **No comments unless WHY is non-obvious** — keep `.tsx` files lean; let JSX + named components speak.

### References

- **Epic spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:989-1041` (Story 48.1 AC) + `:209-228, :246-264` (FR/NFR/UX-DR catalog) + `:304-311` (Epic 48 narrative).
- **TUI design spec:** `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:104-154` (metric tiers, empty-state, badge, 80×24 stress, authoritative data sources, "cut from v1" list, design artifacts).
- **Wire shape source:** `packages/townhouse/src/earnings/aggregator.ts:32-78` (types) + `packages/townhouse/src/api/schemas/earnings.ts` (frozen JSON schema).
- **Existing TTY/env detection precedent:** `packages/townhouse/src/cli/onboarding-ribbon.ts:16-37`.
- **CLI mount point:** `packages/townhouse/src/cli.ts:813-1083` (`handleHsUp`), with the new TUI mount slotted between `ribbon.start('live', hostname)` (line 1073) and the `} catch` (line 1074).
- **HELP_TEXT location:** `packages/townhouse/src/cli.ts:82-110`.
- **Townhouse-web React pin** (graph alignment reference): `packages/townhouse-web/package.json:32` + `packages/townhouse-web/tsconfig.json:5` (`jsx: "react-jsx"`).
- **Epic 47 → 48 handoff & dependencies:** `_bmad-output/implementation-artifacts/epic-47-retro-2026-05-13.md:196-222`.
- **Previous story Dev Notes (wire-shape decisions D2/D4):** `_bmad-output/implementation-artifacts/47-4-get-api-earnings-two-bucket-endpoint.md` § Review Findings.
- **Townhouse-hs compose template:** `packages/townhouse/compose/townhouse-hs.yml:152, :176` (the `127.0.0.1:28090:28090` binding).

## Dev Agent Record

### Agent Model Used

`claude-sonnet-4-6`

### Debug Log References

- Fake timer / React scheduler interaction: `vi.useFakeTimers()` with default settings mocks `setImmediate`, which React's scheduler (scheduler@0.23.2 used by react-reconciler@0.29.0) captures at module load time. Resolution: use `vi.advanceTimersByTimeAsync(0)` to flush the faked setImmediate for most tests; use `vi.useRealTimers()` + `await new Promise(r => setImmediate(r))` for the abort test where the real scheduler reference is needed.
- `AbortController.prototype.abort` spy unreliable in this environment; replaced with captured-signal approach (`capturedSignal?.aborted`).
- tsup picks up `.tsx` without any additional loader config.

### Completion Notes List

- **Test delta:** 1051 − 1015 = +36 tests. Breakdown: format.test.ts +6, tty-detect.test.ts +6, copy-sync.test.ts +1, use-earnings.test.tsx +4, hero-band.test.tsx +5, cli.hs.test.ts +2 new + existing tests still passing. The +36 exceeds the +12 to +20 target because the testing surface is more comprehensive.
- **TTY detection:** Env probes from `onboarding-ribbon.ts` were mirrored in `tui/tty-detect.ts` (NOT extracted to a shared module). The decision: the ribbon's helpers are private and the extraction would add shared-module scope beyond this story. Recommend extracting to `cli/tty-environment.ts` in a follow-up or when 48.2 has reason to touch both.
- **tsup loader:** No loader workaround required. tsup/esbuild handles `.tsx` natively via the `react-jsx` transform.
- **UX-DR1 + UX-DR2:** Dev-agent first draft created. Awaiting Sally review in PR description.
- **Story 45.4 AC #11 override:** On TTY, the CLI now stays foreground (awaits `instance.waitUntilExit()`). On non-TTY, it still exits 0 after `ribbon.start('live', ...)`. This is correct per the new contract; Story 45.4's AC #11 applies ONLY on non-TTY.
- **walletManager.lock():** Still runs via the `finally` block after `instance.waitUntilExit()` resolves (Ctrl-C unmounts the TUI → `waitUntilExit()` resolves → `finally` runs → wallet locked). Ordering preserved.
- **Manual smoke (10.4–10.6):** Requires running dev infra (`scripts/townhouse-dev-infra.sh up`). Not run automatically; flagged as manual gate in Task 10.4–10.6 checkboxes. The non-TTY path (pipe smoke) is covered by tests.

### File List

**New files:**
- `_bmad-output/design/townhouse-tui-wireframe.md` (UX-DR1)
- `_bmad-output/design/empty-state-copy.md` (UX-DR2)
- `packages/townhouse/src/tui/index.ts`
- `packages/townhouse/src/tui/App.tsx`
- `packages/townhouse/src/tui/tty-detect.ts`
- `packages/townhouse/src/tui/tty-detect.test.ts`
- `packages/townhouse/src/tui/use-earnings.ts`
- `packages/townhouse/src/tui/use-earnings.test.tsx`
- `packages/townhouse/src/tui/format.ts`
- `packages/townhouse/src/tui/format.test.ts`
- `packages/townhouse/src/tui/constants.ts`
- `packages/townhouse/src/tui/types.ts`
- `packages/townhouse/src/tui/copy.ts`
- `packages/townhouse/src/tui/copy-sync.test.ts`
- `packages/townhouse/src/tui/hero-band.test.tsx`
- `packages/townhouse/src/tui/components/HeroBand.tsx`
- `packages/townhouse/src/tui/components/Sparkline.tsx`
- `packages/townhouse/src/tui/components/Qualifier.tsx`
- `packages/townhouse/src/tui/components/Banner.tsx`
- `packages/townhouse/src/tui/components/ApexStripSlot.tsx`
- `packages/townhouse/src/tui/components/PeerTableSlot.tsx`
- `packages/townhouse/src/tui/components/FooterSlot.tsx`

**Modified files:**
- `packages/townhouse/package.json` — added `ink ^5.0.0`, `react ^18.3.1` (deps); `ink-testing-library ^4.0.0`, `@types/react ^18.3.3` (devDeps)
- `packages/townhouse/tsconfig.json` — added `"jsx": "react-jsx"`, updated `include` to cover `.tsx`
- `packages/townhouse/vitest.config.ts` — extended `include` to `*.test.tsx`
- `packages/townhouse/src/cli.ts` — added `shouldRenderInk` import, TUI mount block in `handleHsUp`, HELP_TEXT update
- `packages/townhouse/src/cli.hs.test.ts` — added `vi.mock('./tui/index.js')`, 2 new TTY/non-TTY mount test cases

### Review Findings

_Code review 2026-05-13 — adversarial three-layer review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision-needed, 26 patches, 14 deferred, 10 dismissed._

_Resolution 2026-05-14: D1 resolved as P27; 24 patches applied (P1, P2, P3, P4, P5, P6, P7, P9, P10, P11, P12, P13, P14, P15, P16, P17, P18, P19, P20, P21, P24, P25, P26, P27); P8 dismissed on re-read (already handled); P22 partially applied (createElement named-import, JSX rename deferred); P23 demoted to deferred (W15). Townhouse suite: **1070/1070 green** (+19 over the 1051 review baseline). Connector contract canary: **43/43 unchanged, 35ms**. Build clean. TUI source files typecheck-clean under strict TS._

- [x] **[Review][Decision] D1 → P27 (resolved 2026-05-13): pass env override via CLI** — Operator decision: thread `{ apiUrl: process.env.HS_TOWNHOUSE_API_URL }` from `cli.ts` into `mountTui()`. TUI keeps its hardcoded default for the no-env case. Becomes patch P27 below.

- [x] **[Review][Patch] P27 (FIXED 2026-05-14, from D1): thread `HS_TOWNHOUSE_API_URL` env override through `mountTui`** [packages/townhouse/src/cli.ts:1079-1086] — Applied: `cli.ts` now reads `process.env.HS_TOWNHOUSE_API_URL` and passes `{ apiUrl }` to `mountTui` when set; `cli.hs.test.ts` asserts the env value propagates.

- [x] **[Review][Patch] P1: Initial-load failure → stuck on "Fetching earnings…" forever (FIXED 2026-05-14)** [packages/townhouse/src/tui/use-earnings.ts:55-66, 78-83] — The `catch` and `!res.ok` branches only `setState` when `prev !== null`, so the first failed fetch never advances out of `phase: 'loading'`. With the 2s interval re-trying the same failure, the screen stays on `COPY.loading` indefinitely if the connector API isn't reachable at TUI mount (the common scenario right after `ribbon.start('live', ...)`). Fix: seed `EMPTY_EARNINGS` + `bannerKey: 'fetch_failed'` (or `connector_unavailable`) on first failure, mirroring the body-`status === 'connector_unavailable'` first-load branch. [Critical]
- [x] **[Review][Patch] P2 (FIXED 2026-05-14): `Banner.tsx` renders literal `{N}s old`** [packages/townhouse/src/tui/components/Banner.tsx:11-17] — `COPY.banners.fetchFailed = "Last refresh failed — data may be {N}s old."` is rendered raw — the `{N}` token leaks straight into the TUI on every fetch_failed render. Either (a) substitute with a "seconds since last successful fetch" prop, or (b) strip the `{N}` from the copy + spec.
- [x] **[Review][Patch] P3 (FIXED 2026-05-14): `formatUsdc` throws when `NODE_ENV` is unset (dev + test + CLI launch)** [packages/townhouse/src/tui/format.ts:4-8] — Only `=== 'production'` selects the safe `$?.??` fallback; everything else throws on regex mismatch. A `townhouse hs up` from an installed npm package launches with `NODE_ENV` undefined, so any malformed `apex.routingFees.USDC.today` (e.g. a future connector returning `'1.5'`) throws synchronously inside the render path and unmounts Ink. Fix: treat undefined as production OR invert to `if (NODE_ENV === 'development' || NODE_ENV === 'test') throw; else return '$?.??'`.
- [x] **[Review][Patch] P4 (FIXED 2026-05-14): `addDecimalStrings` BigInt throws on malformed peer payload** [packages/townhouse/src/tui/components/HeroBand.tsx:13-15] — No regex pre-check, no try/catch — `BigInt(a) + BigInt(b)` throws `SyntaxError` on `'1.5'`, `''`, scientific notation. One bad peer row crashes the entire HeroBand render. Spec contract says the wire is regex-validated upstream (D4 pattern guard), but defense in depth was explicitly required for `formatUsdc`; same posture should apply here.
- [x] **[Review][Patch] P5 (FIXED 2026-05-14): Sparkline NaN / `Math.max(...largeArr)` / negative-value blind spots** [packages/townhouse/src/tui/components/Sparkline.tsx:18-25] — `Math.max(...values)` spreads onto stack (`RangeError` at length ~100k); NaN values produce `idx = NaN` → `BLOCKS[NaN]` falls back silently; negative values produce negative `idx`. v1 passes `[]` so harmless today, but the function is exported and 48.2 will pass real arrays. Fix: filter `Number.isFinite`, clamp negatives, swap spread for `reduce()`.
- [x] **[Review][Patch] P6 (FIXED 2026-05-14): `colWidth = floor(columns/4)` collapses at small `columns` — no min-width clamp** [packages/townhouse/src/tui/components/HeroBand.tsx:72-86] — Ink `useStdout()` can return `columns` of 0–40 on narrow PTYs / mid-resize. `colWidth = 0` makes `<Box width={0}>` collapse, truncating `$X.XX` to garbage. No floor like `Math.max(colWidth, MIN_COL)`. Spec's degrade ladder names the `<60ch` and `<70ch` breakpoints — apply them or add a hard min.
- [x] **[Review][Patch] P7 (FIXED 2026-05-14): Test file fails strict typecheck — `capturedSignal: never`** [packages/townhouse/src/tui/use-earnings.test.tsx:155-167] — Variable declared `let capturedSignal: AbortSignal | null = null`, assigned inside `vi.fn().mockImplementation(...)`; TS narrows to `never` outside the callback, so `capturedSignal?.aborted` errors under `tsc --noEmit`. Tests still run (vitest goes through esbuild) but story's Architecture Compliance bullet says strict TS is honored. Fix: `let capturedSignal: AbortSignal | null = null as AbortSignal | null;` or widen via `as`.
- [x] **[Review][Patch] P8 (dismissed on re-read): `cli.hs.test.ts` `process.exitCode` reset** — Already handled: `beforeEach` resets at `cli.hs.test.ts:198` and `afterEach` resets at `cli.hs.test.ts:214`. False positive from Blind/Edge.
- [x] **[Review][Patch] P9 (FIXED 2026-05-14): Sparkline `<60ch` returns `<Text>{''}</Text>` — still occupies a row** [packages/townhouse/src/tui/components/Sparkline.tsx:13-15] — Empty `<Text>` is still a layout element. The wireframe contract "sparkline collapses first" means the row is gone, not blank. Return `null` instead. The current unit test passes only because it renders Sparkline standalone, where `lastFrame() === ''` looks correct.
- [x] **[Review][Patch] P10 (FIXED 2026-05-14): `shortLabels` ternary is no-op for TODAY/MONTH/YEAR** [packages/townhouse/src/tui/components/HeroBand.tsx:80-83] — Three of the four label ternaries have identical branches (`shortLabels ? 'TODAY' : 'TODAY'`). Only `LIFETIME → LIFE` truncates. Collapse to `const labelLifetime = shortLabels ? 'LIFE' : 'LIFETIME';` and drop the rest.
- [x] **[Review][Patch] P11 (FIXED 2026-05-14): Test "aborts in-flight fetch on unmount" — mock promise never settles, abort propagation untested** [packages/townhouse/src/tui/use-earnings.test.tsx:140-148] — `fetchImpl` returns `new Promise(() => {})`. Test asserts `capturedSignal?.aborted === true`, which verifies the AbortController side, but the production catch-on-AbortError path is never exercised. Fix: have the mock reject with a `DOMException('aborted', 'AbortError')` when the signal fires.
- [x] **[Review][Patch] P12 (FIXED 2026-05-14): `hs up isTTY=true` test doesn't verify `waitUntilExit` is actually awaited** [packages/townhouse/src/cli.hs.test.ts:57-79] — Mock returns `{ waitUntilExit: () => Promise.resolve() }`. Test only asserts `mountTui` was called with `{}`. If a refactor drops the `await`, the test still passes. Use a manually-controlled promise + spy on resolution ordering.
- [x] **[Review][Patch] P13 (FIXED 2026-05-14): `Qualifier.tsx` hardcodes `MONTH $0.00 ·` scaffolding and middle `·`** [packages/townhouse/src/tui/components/Qualifier.tsx:12] — Only the right two fragments come from `COPY` (`qualifierEvents`, `heroEarly`). The full string lives in `empty-state-copy.md`. Drift between Sally's source-of-truth doc and the in-code string is silent — `copy-sync.test.ts` doesn't catch it because it only checks COPY leaves. Fix: add `COPY.qualifierTemplate: (n) => '…'` and reference once.
- [x] **[Review][Patch] P14 (FIXED 2026-05-14): No test verifying tmux render-options branch (AC #11 last bullet)** — Spec mandates: "setting `process.env.TMUX = '1'` causes the render call to receive `{ patchConsole: false }` (assert via spy)". `hero-band.test.tsx` has no such case; `tty-detect.test.ts` checks the predicate but not the render-options propagation. Add a test that spies on Ink's `render` and asserts the options bag.
- [x] **[Review][Patch] P15 (FIXED 2026-05-14): Sparkline boundary at width=59 / width=60 untested** [packages/townhouse/src/tui/hero-band.test.tsx:81-88] — Test only asserts `width: 50` collapses. The exact threshold (`< 60` → collapse, `>= 60` → render) isn't pinned. A flip to `<= 60` would slip through. Add boundary cases.
- [x] **[Review][Patch] P16 (FIXED 2026-05-14): `Banner.tsx` renders yellow for both `connector_unavailable` AND `fetch_failed`** [packages/townhouse/src/tui/components/Banner.tsx:16] — Wireframe specifies `bannerWarn = yellow` (warn) and `bannerError = red` (error). `fetch_failed` should render red per UX-DR1's color tokens. Switch on `bannerKey`.
- [x] **[Review][Patch] P17 (FIXED 2026-05-14): `formatUsdc(s, scale<2)` produces malformed `$X.Y` (one-digit cents)** [packages/townhouse/src/tui/format.ts:16-22] — `cents = fractionalStr.slice(0, 2)` returns `'3'` when `scale=1`. Pad cents to 2 digits with `padEnd(2, '0')`.
- [x] **[Review][Patch] P18 (FIXED 2026-05-14): `formatUsdc('-0', 6)` returns `-$0.00`** [packages/townhouse/src/tui/format.ts:11-23] — Negative zero. After parsing, gate the sign with `value === 0n ? '' : (negative ? '-' : '')`.
- [x] **[Review][Patch] P19 (FIXED 2026-05-14): No-hardcoded-copy smoke check only scans `components/` — misses `App.tsx`** [packages/townhouse/src/tui/hero-band.test.tsx:70-79] — `App.tsx` lives one directory up. The test's `readdirSync('./components')` skips it. Extend the scan to `tui/*.tsx`.
- [x] **[Review][Patch] P20 (FIXED 2026-05-14): No test for `shouldRenderInk()` `NO_TUI=1` branch** [packages/townhouse/src/tui/tty-detect.test.ts] — Source has the gate; tests cover isTTY/CI/TERM but not the opt-out env. Add a case.
- [x] **[Review][Patch] P21 (FIXED 2026-05-14): No test for `formatUsdc` production fallback** [packages/townhouse/src/tui/format.test.ts] — Task 7.1 explicitly required the prod-mode `$?.??` test. Branch is uncovered. Add a `NODE_ENV='production'` override + assert.
- [x] **[Review][Patch] P22 (partially applied): `tui/index.ts` cleaned** [packages/townhouse/src/tui/index.ts] — JSX requires `.tsx`; renaming `index.ts` to `index.tsx` is invasive (imports elsewhere use `./tui/index.js` but the source-filename change touches ESM resolution). Compromise: named `createElement` import + dropped the namespace `import React` — addresses the noise concern without the file rename.
- [x] **[Review][Patch→Defer] P23: `copy-sync.test.ts` substring match not anchored** [packages/townhouse/src/tui/copy-sync.test.ts:34] — Deferred: tightening to backtick/fence-anchored match requires restructuring the markdown's table section and is best done alongside P24's static-literal extraction. Tracked in deferred-work.md.
- [x] **[Review][Patch] P24 (FIXED 2026-05-14): `getLeafStrings` skips functions — `qualifierEvents`'s "events relayed" literal goes unchecked** [packages/townhouse/src/tui/copy-sync.test.ts:11-13] — `COPY.qualifierEvents: (n) => '${n} events relayed'` has a static substring that should be sync-checked against the markdown. Asymmetric enforcement; either inline the function body's literal into a sibling const, or have the test extract regex-bounded literals from arrow bodies.
- [x] **[Review][Patch] P25 (FIXED 2026-05-14): HeroBand integrated narrow-width test missing** [packages/townhouse/src/tui/hero-band.test.tsx] — All HeroBand render calls use default Ink test stdout (~80 cols). The integrated behavior at width <60 (sparkline gone) and <70 (label truncation) is unverified at the component level; only the standalone Sparkline test covers <60.
- [x] **[Review][Patch] P26 (FIXED 2026-05-14): `NO_TUI` only honors literal `'1'`** [packages/townhouse/src/tui/tty-detect.ts:4] — `NO_TUI=true`, `NO_TUI=yes`, `NO_TUI=on` are silently ignored. Operators setting an opt-out env expect truthiness. Broaden to `process.env.NO_TUI && process.env.NO_TUI !== '0' && process.env.NO_TUI !== 'false'`.

- [x] [Review][Defer] W1: No automated tmux capture-pane fixture (AC #7) [packages/townhouse/src/__integration__/ — missing] — deferred, dev relegated to manual smoke (Task 10.5) in Completion Notes; AC #7 reads as automated.
- [x] [Review][Defer] W2: `patchConsole: false` may leak connector logs into rendered frame [packages/townhouse/src/tui/index.ts:14] — deferred, spec-mandated for alt-screen-avoidance / tmux safety; reconciliation is a separate design call.
- [x] [Review][Defer] W3: App.tsx loading branch returns bare `<Text>` outside column layout — briefly breaks row-budget reservation [packages/townhouse/src/tui/App.tsx:20-22] — deferred, ~30ms cosmetic at startup; could render hero-with-zeros + banner instead.
- [x] [Review][Defer] W4: `Banner` not wrapped in `<Box>` for layout stability [packages/townhouse/src/tui/components/Banner.tsx:16] — deferred, fits today; consider wrapping for future-proofing.
- [x] [Review][Defer] W5: `useEarnings` tears down + restarts interval when `fetchImpl` identity changes [packages/townhouse/src/tui/use-earnings.ts:107] — deferred, `mountTui({})` doesn't hit this in production; tests pass stable mock.
- [x] [Review][Defer] W6: Race — `abortController = null` in finally vs queued interval ticks [packages/townhouse/src/tui/use-earnings.ts:41-90] — deferred, bounded by `cancelled` flag check at fetch entry.
- [x] [Review][Defer] W7: No min-width gate in `shouldRenderInk` — narrow terminals render unreadable layout [packages/townhouse/src/tui/tty-detect.ts] — deferred, design decision (component-level degrade vs entry gate); revisit when Drew reports a complaint.
- [x] [Review][Defer] W8: Ribbon vs Ink stdout race window [packages/townhouse/src/cli.ts:1074-1083] — deferred, `ribbon.start('live', ...)` is a one-shot print before TUI mount; no continuous animation.
- [x] [Review][Defer] W9: SIGINT cleanup ordering — Ink's exitOnCtrlC vs Node default handler [packages/townhouse/src/cli.ts:1079-1092] — deferred, finally block runs after `waitUntilExit` resolves; wallet lock contract holds in observed runs.
- [x] [Review][Defer] W10: `vi.mock('./tui/index.js')` vs dynamic-import path coupling fragility [packages/townhouse/src/cli.hs.test.ts:5,23-29] — deferred, paths coincide today; a `from '../tui/...'` refactor would silently un-mock.
- [x] [Review][Defer] W11: `recentClaims` re-exported in `types.ts` but unused in this story [packages/townhouse/src/tui/types.ts:2, use-earnings.ts:17] — deferred, intentional staging for Story 48.4 Activity overlay.
- [x] [Review][Defer] W12: `vitest.config.ts` `exclude: ['src/__integration__/**']` doesn't account for future `.tsx` integration tests [packages/townhouse/vitest.config.ts:6] — deferred, no `.tsx` integration tests exist today.
- [x] [Review][Defer] W13: `CI === 'true'` strict check misses CI providers using `CI=1` [packages/townhouse/src/tui/tty-detect.ts:3] — deferred, mirrors `onboarding-ribbon.ts:16-37` precedent per spec Task 1.2; cross-cutting tightening.
- [x] [Review][Defer] W14: Production `$?.??` fallback hides upstream bugs forever [packages/townhouse/src/tui/format.ts:4-7] — deferred, intentional defensive posture per Task 7.1 ("returns `$?.??` in production").

**Dismissed (not actionable):**
1. `DEFAULT_API_URL = 'http://127.0.0.1:28090'` port suspect — matches compose template binding `127.0.0.1:28090:28090` (see Dev Notes references). Edge Case Hunter confused 28080 (admin) with the earnings API port.
2. `isTmux()` exported but unused in this story's diff — Task 5.2 explicitly says "this story exports the helper but does NOT branch on it" (reserved for 48.3 / 48.4).
3. `isTmux()` regex matches `screencast`/`tmuxinator` — withdrawn by Edge Case Hunter on re-read (regex alternation anchors each side independently).
4. `copy-sync.test.ts` reads markdown via relative path / not shipped in tarball — intentional; test only runs in repo, markdown is a design artifact not a runtime dependency.
5. Slot components typed `(): null` — works fine in JSX; TS accepts `null` return type for functional components.
6. AC #9 forbidden-regex narrower than spec verbatim — intentional narrowing to avoid false-positives on discriminator union strings (e.g. `'connector_unavailable'` token).
7. `re-fetches at interval` test ≥4 calls + fake timers flake-prone — observed stable in dev-agent runs; standard React + fake-timer pattern.
8. Net test delta +36 exceeds spec target +12 to +20 — dev openly flagged in Completion Notes; over-delivered intentionally.
9. host.json / walletManager.lock / `hs down` ordering preserved (AC #12) — auditor confirmed compliant.
10. Pre-existing test patterns / connector teardown after Ctrl-C — connector lifecycle is `hs up` / `hs down` by design; TUI is a renderer, not a process supervisor.

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [ ] Does this story contain regex or template substitution logic? **Yes** — `formatUsdc()` parses decimal-string bigints with a regex. The unit test MUST include real-world inputs: actual `getEarnings()` payload amounts at scale 6 (e.g. `'1234567'` → `'$1.23'`), zero, negative, very large (`'999999999999999999'`).
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Confirm NO new gates were added. The `use-earnings.test.tsx` fake-timer test is NOT gated.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors, no JSX-loader complaint).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of +12 to +20 tests over the 1015 baseline.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test src/connector/contract-canary.test.ts` still passes sub-500ms, 43 tests (UNCHANGED).
- [ ] Verify `_bmad-output/design/townhouse-tui-wireframe.md` exists with the 80ch grid + 120ch grid + color tokens + degrade ladder.
- [ ] Verify `_bmad-output/design/empty-state-copy.md` exists with all zero/wait/loading/failure-state copy.
- [ ] Verify `Sally sign-off (UX-DR1 + UX-DR2): approved` appears in the PR description (NFR19 merge gate — AC #8).
- [ ] Verify the manual smoke matrix (80×24, tmux, pipe) was run AND results captured in the Completion Notes.
- [ ] Verify the empty-state copy library copy-sync test (`copy-sync.test.ts`) is in the suite and passes — drift between markdown + TS is a real risk.
- [ ] Confirm no `if (n === 0) return ''` patterns in the TUI source — every empty branch routes through `copy.ts`.
- [ ] Confirm `ApexStripSlot`, `PeerTableSlot`, `FooterSlot` are stub fragments (returning `null`) — they're load-bearing for 48.2 / 48.4 file-level diff cleanliness.
- [ ] Update sprint-status to `review` (then `done` after code review).
