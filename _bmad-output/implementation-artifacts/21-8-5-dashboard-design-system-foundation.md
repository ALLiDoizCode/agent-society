# Story 21.8.5: Dashboard Design System Foundation

Status: draft

<!-- Inserted between Story 21.8 (Fastify REST + WebSocket API) and Story 21.9 (Home view) based on design-direction spike work completed 2026-04-20 (v1 through v6). See _bmad-output/planning-artifacts/design-spikes/. -->

## Story

As a node operator,
I want the Townhouse dashboard to have a coherent, pre-committed visual language,
so that every view I use (home, town, mill, dvm, wallet, wizard) feels like one considered product rather than five dev-agent inventions stitched together.

## Acceptance Criteria

1. Design tokens codified in CSS custom properties and TypeScript constants, covering surfaces, ink, borders, Apple-HIG semantic palette, node identity (Town/Mill/DVM), status scale, type stack, 8px spacing scale, radii, and motion durations.
2. Tailwind 4 theme extended from the token set with no ad-hoc colors permitted in application code (enforced via lint rule).
3. Base layout primitives built: `Shell`, `NodeCard` (with `is-selected`, `is-degraded`, `is-rebalancing` variants), `StatusDot`, `TypeChip`, `MetricBlock`, `Sparkline`, `LiquidityBar`, `BreakdownPill`, `ChainTile`, `PairChip`, `StateShell` (loading/empty/error).
4. Brand asset library: `ChainIcon` and `TokenIcon` primitives resolving symbol → self-hosted asset URL at `public/marks/`. Seven marks committed: Ethereum, Base, Optimism, Arbitrum, Solana, Mina (chains); ETH, USDC, SOL, MINA (tokens). `ASSETS.md` documents origin and license for each file.
5. Motion budget enforced: exactly three named keyframe animations in the codebase (`deg-heartbeat`, `status-heartbeat`, `rebal-pulse`). Any new animation requires explicit reviewer sign-off documented in the PR description.
6. Storybook (or equivalent component-preview harness) renders every primitive with a canonical fixture matching the v6 scenario: 3 Towns (town-03 degraded), 2 Mills (mill-eth-01 rebalancing), 1 DVM, six supported chains, ATOR connected.
7. Accessibility: all primitives pass `axe-core` at WCAG 2.1 AA. Color contrast verified for every ink/surface pair including the inverted `is-degraded` card state.
8. No drop shadows, no gradients, no noise overlays, no vignettes anywhere in the design system (flat-surface discipline from OpenCode influence). Enforced via code review; documented in component file headers.
9. Font stack self-hosted: `IBM Plex Mono` shipped as woff2 in `public/fonts/`. Berkeley Mono listed first in the fallback chain for licensed developers but not bundled. No reliance on Google Fonts CDN at runtime.
10. Unit tests for `ChainIcon` and `TokenIcon` verify: unknown symbol renders a placeholder, known symbol resolves to expected URL, `alt` text is present.

## Tasks / Subtasks

- [ ] Task 1: Scaffold `web/` directory structure (AC: #1, #3)
  - [ ] 1.1 Create `packages/townhouse/web/` with Vite 5 + React 19 + TypeScript (mirror `packages/rig/` pattern exactly)
  - [ ] 1.2 Configure Tailwind 4 with `@tailwindcss/typography` plugin; disable the default color palette so only token-derived colors are reachable
  - [ ] 1.3 Configure Vite with `public/` directory for static marks + fonts
  - [ ] 1.4 Add `eslint-plugin-tailwindcss` with a custom rule forbidding arbitrary color literals (e.g., `bg-[#ff9f0a]`) — all colors must come from `theme.extend`
  - [ ] 1.5 Add `axe-playwright` or `@axe-core/react` for accessibility assertions in component tests
  - [ ] 1.6 Wire up Storybook 8 (or Ladle if lighter weight is preferred) with a "Design System" top-level story group

- [ ] Task 2: Design tokens (AC: #1, #2)
  - [ ] 2.1 Create `src/styles/tokens.css` — every CSS custom property from the v6 `:root` block, organized into labeled sections (surfaces, ink, borders, HIG, identity, status, type, spacing, radii, motion). Exact values from `_bmad-output/planning-artifacts/design-spikes/townhouse-dashboard-v6.html` lines 51–103.
  - [ ] 2.2 Create `src/theme/tokens.ts` — TypeScript `const` mirror of the CSS variables for use in JS/TSX logic (e.g., chart libraries that accept color strings). Single source of truth; CSS variables derive from it via a small build script if practical, otherwise keep manually synced with a unit test that verifies both contain the same keys.
  - [ ] 2.3 Create `tailwind.config.ts` with `theme.extend.colors`, `theme.extend.spacing`, `theme.extend.borderRadius`, `theme.extend.fontFamily` all reading from `tokens.ts`
  - [ ] 2.4 Add `src/theme/tokens.test.ts` verifying CSS and TS token sets contain identical keys and values (prevents drift)

- [ ] Task 3: Typography pipeline (AC: #9)
  - [ ] 3.1 Download IBM Plex Mono woff2 files (weights 400, 500, 700) from `@ibm/plex` npm package or Google Fonts CSS source — place in `public/fonts/ibm-plex-mono/`
  - [ ] 3.2 Add `@font-face` declarations in `tokens.css` with `font-display: swap`
  - [ ] 3.3 Document licensing: `public/fonts/ibm-plex-mono/LICENSE.txt` (OFL-1.1, upstream license bundled with the package)
  - [ ] 3.4 Keep Berkeley Mono first in the CSS fallback chain (`'Berkeley Mono', 'IBM Plex Mono', ...`) so licensed developers see it automatically without a config change

- [ ] Task 4: Brand-asset pipeline (AC: #4)
  - [ ] 4.1 Create `public/marks/` directory; commit seven asset files: `ethereum.webp`, `base.webp`, `optimism.webp`, `arbitrum.webp`, `solana.webp` (resized from DefiLlama CDN sources), `mina.png` (from `_bmad-output/planning-artifacts/design-spikes/assets/Mina.png`, optimized to ≤32KB via `squoosh-cli` or `sharp`), `eth.svg`, `usdc.svg`, `sol.svg` (from spothq/cryptocurrency-icons CC0-1.0)
  - [ ] 4.2 Create `scripts/sync-brand-assets.ts` — one-shot fetch script that pulls fresh versions from their respective sources; commits new files; does NOT run in CI (manual refresh only, to avoid surprise changes from upstream)
  - [ ] 4.3 Create `packages/townhouse/web/ASSETS.md` listing every file in `public/marks/` with: origin URL, license, date fetched, notes on optimization applied
  - [ ] 4.4 Create `src/components/ChainIcon.tsx` — props: `{ symbol: ChainSymbol; size?: 'sm' | 'md' | 'lg' | 'xl'; alt?: string }`. Resolver: `symbol → /marks/{symbol}.webp` (or `.png` for Mina). Unknown symbol renders a stylized placeholder (inline SVG) so the UI degrades gracefully.
  - [ ] 4.5 Create `src/components/TokenIcon.tsx` — same shape, ticker-based resolution, `.svg` extension
  - [ ] 4.6 Create `src/components/chains/ChainSymbol.ts` — union type: `'ethereum' | 'base' | 'optimism' | 'arbitrum' | 'solana' | 'mina'`. Add `TokenTicker` type similarly: `'eth' | 'usdc' | 'sol' | 'mina'`
  - [ ] 4.7 Unit tests (`ChainIcon.test.tsx`, `TokenIcon.test.tsx`) — verify URL resolution, placeholder fallback, `alt` attribute presence

- [ ] Task 5: Layout primitives (AC: #3)
  - [ ] 5.1 `Shell` — top-bar + main area layout. Props: `{ operator: string; host: string; walletSats: number; atorStatus: 'connected' | 'degraded' | 'disconnected'; atorHops: number; clock: string }`. Sticky top-bar, `max-w-[1560px]` centered.
  - [ ] 5.2 `NodeCard` — the core primitive. Props: `{ id: string; host: string; type: 'town' | 'mill' | 'dvm'; status: NodeStatus; metric: MetricBlock; subMetric?: MetricBlock; activity: SparklineData; footer?: ReactNode; pairChips?: ReactNode; selected?: boolean }`. MUST support `is-degraded` as an inverted variant (Apple Warning Orange ground, dark ink) — do not talk yourself into a red-border alternative, the inverted block is the attention affordance Sally signed off on during spike review.
  - [ ] 5.3 `StatusDot` — props: `{ variant: 'ok' | 'degraded' | 'rebalancing' | 'down' | 'pending' }`. `degraded` variant animates `status-heartbeat` 2.4s loop.
  - [ ] 5.4 `TypeChip` — props: `{ type: 'TOWN' | 'MILL' | 'DVM' }`. Solid fill in identity color.
  - [ ] 5.5 `MetricBlock` — props: `{ label: string; value: number | string; unit?: string; align?: 'left' | 'right' }`. All numerics render with tabular-nums.
  - [ ] 5.6 `Sparkline` — props: `{ data: number[]; accent?: ChainSymbol; highlightLast?: boolean; errorIndices?: number[] }`. Uses identity-color bars; no curves (operators want bars, not lines, for this scale).
  - [ ] 5.7 `LiquidityBar` — props: `{ allocated: number; inSwap: number; available: number; leftChain?: ChainSymbol; rightChain?: ChainSymbol; rebalancing?: boolean }`. Rebalance `rebal-pulse` animates ONLY when `rebalancing === true`.
  - [ ] 5.8 `BreakdownPill` — props: `{ type: 'TOWN' | 'MILL' | 'DVM'; count: number; countLabel: string; value: number; unit: string }`. The pills used in the earnings hero.
  - [ ] 5.9 `ChainTile` — props: `{ chain: ChainSymbol; ticker: string; tokens: TokenTicker[]; status: 'ok' | 'active' | 'idle'; blockHeight?: string | number }`. Used in the chains strip.
  - [ ] 5.10 `PairChip` — props: `{ icons: ReactNode[]; separator?: string }`. Generic composition primitive used for "[ETH] · [USDC]" and "[ETH-chain] ↔ [BASE-chain]" patterns on Mill cards.
  - [ ] 5.11 `StateShell` — props: `{ variant: 'loading' | 'empty' | 'error'; label: string; children: ReactNode }`. Loading uses CSS skeleton-wipe; empty uses the `townhouse init` prompt pattern; error uses red-border + code block convention.

- [ ] Task 6: Storybook fixtures (AC: #6)
  - [ ] 6.1 Create `src/fixtures/townhouse-v6-scenario.ts` — the canonical scenario data (operator jonathan, 6 nodes, 6 chains, specific timestamps). Importable by any test or story.
  - [ ] 6.2 Create one `.stories.tsx` per primitive showing: default state, each variant, and the fixture-driven example
  - [ ] 6.3 Add a "Full Page" story at the top of the design-system group that composes the entire v6 layout using only the primitives — proves the system is complete
  - [ ] 6.4 Verify the Storybook page visually matches the v6 spike HTML side-by-side (developer checklist, documented in PR)

- [ ] Task 7: Accessibility + motion discipline (AC: #5, #7, #8)
  - [ ] 7.1 Add `axe-core` assertions to every `.stories.tsx` via `@storybook/addon-a11y` or equivalent; CI fails on any AA violation
  - [ ] 7.2 Write `tokens.ts` contrast test: programmatically verify every `--ink-*` on every `--bg-*` passes WCAG 2.1 AA (4.5:1 for text). Special-case the inverted degraded card: verify dark ink on `--orange` ground passes.
  - [ ] 7.3 Add a lint rule or CI check that counts `@keyframes` declarations in the built CSS — fails if >3 animations total
  - [ ] 7.4 Add a lint rule forbidding `box-shadow`, `filter: drop-shadow`, `background-image: linear-gradient`, and `backdrop-filter: blur` in component styles (grep or stylelint). OpenCode flat-surface discipline.

- [ ] Task 8: Downstream story AC amendments (AC: all)
  - [ ] 8.1 Amend Story 21.9 (Home view) with ACs: imports tokens from `@/theme/tokens`, uses `NodeCard` + `StatusDot` + `Sparkline` primitives, follows `StateShell` conventions, passes axe AA, no inline colors
  - [ ] 8.2 Amend Story 21.10 (Town view) with equivalent ACs, plus: uses `LiquidityBar` only for cross-type widgets, not for Town-specific UI
  - [ ] 8.3 Amend Story 21.11 (Mill view) with equivalent ACs, plus: uses `LiquidityBar` + `PairChip` + `ChainIcon`/`TokenIcon` for the pair display; `rebal-pulse` animates only during active rebalance
  - [ ] 8.4 Amend Story 21.12 (DVM view) with equivalent ACs, plus: job-queue list uses `StateShell` empty/loading patterns
  - [ ] 8.5 Amend Story 21.13 (Wallet view) with equivalent ACs, plus: wallet columns follow the `tree`-style hierarchy from v6, not a flat table

## Dev Notes

### Architecture Context

This story inserts a design-system foundation between the backend-complete stories (21.1–21.8) and the first dashboard view story (21.9). It was added after the design-direction spike work on 2026-04-20 surfaced that Stories 21.9–21.13 were functionally spec'd but not design-spec'd — every dev agent picking them up would invent aesthetic conventions fresh and diverge across five views.

The spike produced six reference HTML files in `_bmad-output/planning-artifacts/design-spikes/` exploring:
- v1: "Night Shift Terminal" — warm graphite, JetBrains Mono + Space Mono
- v2: "Broadsheet Operations" — editorial serif/sans/mono, warm paper-dark
- v3: "Terminal-Brutalist" — pure TUI, single Fira Code face, ASCII box-drawing
- v4: "Brutalist + Dep-Graph" — v3 extended with Host/Service/Dep/Identity taxonomy
- v5: "Ink Terminal" — cool deep-navy palette, hand-drawn SVG chain marks
- **v6: "Ink Terminal + Real Assets"** ← THE DIRECTION THIS STORY IMPLEMENTS

v6 committed to: cool deep-navy ground (#0B111C), cool off-white ink (#EEF1F7), IBM Plex Mono as the single typeface, Apple-HIG semantic palette mapped directly onto the epic-mandated Town/Mill/DVM identity colors (Warning Orange / Success Green / Apple Cyan respectively — Cyan not Blue because Blue loses contrast against the navy ground), inverted cards for degraded state (stolen from v3), real brand marks for chains and tokens.

### Design Direction Summary

One paragraph for anyone picking this up cold: Ink Terminal is an operator console set in the cool-mono discipline of Linear + the warm-literal typography of OpenCode + the data density of Bloomberg. It is flat — no shadows, no gradients, no noise, no ornament. Colors come from a small fixed palette. The inverted orange degraded card is the ONLY saturated color moment on a typical screen and is the only place the operator's eye should need to go at 2am when something is wrong.

### Token Architecture

Tokens live in two places and must stay in sync:
- `src/styles/tokens.css` — CSS custom properties, the source-of-truth for styling
- `src/theme/tokens.ts` — TypeScript constants mirroring the CSS values, for use in JS/TSX logic (chart libraries, dynamic styles)

A unit test asserts the key/value sets are identical. If this turns out to be annoying to maintain manually, consider a build step that generates one from the other — but only after manual sync has proven painful. Do not premature-optimize.

The exact token values come directly from `_bmad-output/planning-artifacts/design-spikes/townhouse-dashboard-v6.html` lines 51–103. Copy them verbatim.

### Primitive Inventory (what this story ships)

Thirteen components, in a single namespace:

| Primitive | Purpose | Used by |
|---|---|---|
| `Shell` | top-bar + main layout | every page |
| `NodeCard` | 6-card home grid + any list-of-nodes | Home, per-type views |
| `StatusDot` | ok/degraded/rebalancing/down indicator | `NodeCard`, `ChainTile`, detail panels |
| `TypeChip` | TOWN/MILL/DVM label chip | `NodeCard`, `BreakdownPill` |
| `MetricBlock` | label + big number + unit | `NodeCard`, detail panels, wallet |
| `Sparkline` | 12-bar activity indicator | `NodeCard`, detail panels |
| `LiquidityBar` | segmented allocated/in-swap/available | Mill detail only |
| `BreakdownPill` | earnings-by-type hero pills | Home view earnings strip |
| `ChainTile` | chain status card (with icon, tokens, block height) | Chains strip |
| `PairChip` | generic icon/text composition | Mill cards, swap events |
| `StateShell` | loading/empty/error shell | every data surface |
| `ChainIcon` | chain brand mark resolver | `ChainTile`, `PairChip`, `LiquidityBar` ends |
| `TokenIcon` | token brand mark resolver | `PairChip`, swap events |

### Asset Pipeline

Marks live at `packages/townhouse/web/public/marks/` and are served as static assets by Vite. Resolution is pure string concatenation in `ChainIcon`/`TokenIcon` — no dynamic import, no runtime fetch, no CDN dependency.

Seven committed files:
- `ethereum.webp`, `base.webp`, `optimism.webp`, `arbitrum.webp`, `solana.webp` — sourced from DefiLlama icon CDN (`icons.llamao.fi/icons/chains/rsz_{chain}.jpg`), one-shot downloaded and resized via `sharp` to ≤16KB each
- `mina.png` — sourced from the operator's `~/Documents/game_assets/Mina.png` asset (299KB), optimized to ≤32KB via `sharp` (resize to 128×128, PNG quality optimization, strip metadata)
- `eth.svg`, `usdc.svg`, `sol.svg` — sourced from `spothq/cryptocurrency-icons` (CC0-1.0), committed verbatim (SVGs are already small)

`ASSETS.md` records, for each file: origin URL, license, date fetched, and any optimization applied. This file is load-bearing for audit.

`scripts/sync-brand-assets.ts` exists to manually refresh the DefiLlama-sourced marks (chains can rebrand). It is NOT run in CI and NOT on `pnpm install` — refresh is a deliberate PR.

### Motion Budget

Exactly three named keyframes in the entire codebase. No ad-hoc `transition`-based animations, no one-off inline keyframes, no `framer-motion` (we do not need it).

| Name | Duration | Target | Meaning |
|---|---|---|---|
| `deg-heartbeat` | 3s ease-in-out | `NodeCard.is-degraded` background | "this one needs you" |
| `status-heartbeat` | 2.4s ease-in-out | `StatusDot.degraded`, `ChainTile.is-active ::after`, detail-panel chip pulse | quiet presence indicator |
| `rebal-pulse` | 2.2s linear | `LiquidityBar::before` on the in-swap segment when `rebalancing === true` | "liquidity is moving right now" |

A CI check counts `@keyframes` declarations. If it exceeds 3, the build fails.

Staggered card-reveal on mount is NOT in the budget. OpenCode's "instant state change" philosophy supersedes it. The v1 spike had this; we dropped it during tuning.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** If this story adds any GitHub Actions steps (e.g., for axe or Storybook deploy), pin action refs to full commit SHAs.
- **MAX_SAFE_INTEGER:** Not applicable — this story is purely visual; no large-integer bridging.
- **Golden test vectors (ZK):** Not applicable.
- **Font license provenance:** IBM Plex Mono ships via `@ibm/plex` npm package (OFL-1.1). Verify the LICENSE.txt from the package is bundled into `public/fonts/ibm-plex-mono/` and that `ASSETS.md` cross-references it.

### File Structure Requirements

```
packages/townhouse/web/
├── package.json                    # new — React 19 + Vite 5 + Tailwind 4
├── vite.config.ts                  # new
├── tailwind.config.ts              # new — extends theme from tokens.ts
├── tsconfig.json                   # new
├── vitest.config.ts                # new
├── .storybook/                     # new
│   ├── main.ts
│   └── preview.ts
├── public/
│   ├── fonts/ibm-plex-mono/        # new — woff2 + LICENSE.txt
│   └── marks/                      # new — 9 brand assets
│       ├── ethereum.webp
│       ├── base.webp
│       ├── optimism.webp
│       ├── arbitrum.webp
│       ├── solana.webp
│       ├── mina.png
│       ├── eth.svg
│       ├── usdc.svg
│       └── sol.svg
├── src/
│   ├── styles/
│   │   ├── tokens.css              # new — :root block from v6 spike
│   │   └── global.css              # new — body reset + @font-face
│   ├── theme/
│   │   ├── tokens.ts               # new — TS mirror of CSS tokens
│   │   └── tokens.test.ts          # new — CSS↔TS drift check
│   ├── fixtures/
│   │   └── townhouse-v6-scenario.ts # new — canonical scenario data
│   └── components/
│       ├── Shell.tsx
│       ├── NodeCard.tsx
│       ├── StatusDot.tsx
│       ├── TypeChip.tsx
│       ├── MetricBlock.tsx
│       ├── Sparkline.tsx
│       ├── LiquidityBar.tsx
│       ├── BreakdownPill.tsx
│       ├── ChainTile.tsx
│       ├── PairChip.tsx
│       ├── StateShell.tsx
│       ├── ChainIcon.tsx
│       ├── TokenIcon.tsx
│       └── chains/
│           ├── ChainSymbol.ts      # union types
│           └── TokenTicker.ts
├── scripts/
│   └── sync-brand-assets.ts        # new — manual asset refresh
└── ASSETS.md                       # new — asset audit log
```

### Downstream AC Amendments (Stories 21.9 – 21.13)

When each of these stories is drafted or opened, add the following ACs. The primitives built in 21.8.5 make these cheap to comply with — the amendments only matter because without them, a dev agent can still reach for `@shadcn/ui defaults` or `just Tailwind colors` and diverge.

- Imports token constants from `@/theme/tokens` — NO inline hex colors, NO Tailwind arbitrary values like `bg-[#ff9f0a]`.
- Uses the design-system primitives from this story — do NOT reimplement `NodeCard`, `StatusDot`, etc.
- Loading / empty / error states use `StateShell`.
- Any chart/visualization uses the token palette; chart library choice (recharts, visx, tremor, or custom) is an epic-wide decision, pick ONE in 21.9's design review and stick with it.
- Axe-core passes at WCAG 2.1 AA for every new view.
- Motion budget honored (no new keyframes unless explicitly approved and documented).

### Out of Scope (do not do in this story)

- **Table/dense mode** — the v3 Terminal-Brutalist direction. Deferred pending user signal (operators running 8+ nodes asking for denser view). If the signal comes, implement as a layout-mode toggle that consumes the same tokens and primitives — no fork of the design system.
- **Dependency-graph taxonomy view** — the v4 direction. Requires a domain-layer dependency model (Host/Service/Dependency as first-class entities) which is an epic-scope decision, not a design-system story.
- **Light theme** — Townhouse is a 24/7 operator console; dark is the right default. Light mode can be added later, using the same token architecture, when a signal warrants it.
- **Chain/token beyond the initial seven** — additions (Polygon, Avalanche, etc.) happen per-mark in follow-up stories using the same `public/marks/` + `ChainIcon`/`TokenIcon` pattern.
- **Berkeley Mono bundling** — paid font; stays in the fallback chain only. Developers with licenses get it automatically. Do not commit Berkeley Mono woff2 files to the repo.

### Dependencies

This story blocks: 21.9, 21.10, 21.11, 21.12, 21.13 (all dashboard views).
This story depends on: 21.8 (Fastify API — not because of runtime coupling but because the Storybook fixture will eventually swap from static JSON to live API data in a later story).

### Estimate

2 story points. The v6 spike proves the system converges; the work here is conversion (HTML → React components, CSS → Tailwind, inline styles → tokens) plus the asset pipeline and Storybook scaffolding. Low novelty, medium volume, high discipline.

### Risks

| Risk | Mitigation |
|---|---|
| Dev agent adds a fourth animation "because it felt right" | CI check on `@keyframes` count; PR reviewer enforcement. |
| Dev agent uses an inline color during a rush | eslint-plugin-tailwindcss + custom `no-arbitrary-colors` rule; CI fails the build. |
| Mina PNG stays 299KB, dashboard bundle bloats | Optimization step in Task 4.1 — require ≤32KB check in CI (fail if `public/marks/mina.png` > 32KB). |
| DefiLlama rebrands a chain, mark goes stale | Not a CI problem — it's a manual-refresh problem; `scripts/sync-brand-assets.ts` is the answer, run it before major releases. |
| Storybook adds build-time weight the dashboard doesn't need | Keep Storybook out of the production bundle; Vite already handles this via separate entry points. |
