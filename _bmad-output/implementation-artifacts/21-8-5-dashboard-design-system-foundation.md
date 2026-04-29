# Story 21.8.5: Dashboard Design System Foundation + Vite SPA Scaffold

Status: backlog

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope revision (party mode 2026-04-29):** This story file replaces an earlier draft that used the v1–v6 spike direction (IBM Plex Mono, dark theme, Apple-HIG palette). That direction was superseded by D21-008 on 2026-04-21 (Vercel/Geist-inspired light theme). The v1–v6 spikes remain in `_bmad-output/planning-artifacts/design-spikes/` for reference only. Re-entry analysis on 2026-04-29 also resequenced primitives: 7 (not 8) — added `MetricBlock`, deferred `Sparkline`/`NodeCard`/`BreakdownPill`/`LiquidityBar`/`PairChip`/`ChainIcon`/`TokenIcon` to the view stories that need them.

## Story

As a Townhouse contributor about to build dashboard views,
I want the `packages/townhouse-web/` Vite SPA scaffolded with a 7-primitive design-system foundation, design tokens, shadcn/ui charts wired up, and a `pnpm dev:docker` loop that boots against the live Townhouse dev stack,
so that stories 21.14 (wizard) and 21.9–21.13 (dashboard views) inherit a battle-tested kit and a production-shaped data path — not theoretical components and mocked endpoints.

## Background

D21-008 (epic-21-townhouse.md, updated 2026-04-21) locks the visual direction: Vercel/Geist-inspired light theme, near-white canvas (`#ffffff`), `#171717` ink, shadow-as-border (no traditional CSS borders), Geist Sans with aggressive negative tracking, Geist Mono for technical labels, three weights (400/500/600), three named keyframe animations, no gradients, no dark theme at launch. Node identity maps to Vercel workflow accents: Town → Develop Blue (`#0a72ef`), Mill → Preview Pink (`#de1d8d`), DVM → Ship Red (`#ff5b4f`).

Re-entry analysis on 2026-04-29 (party mode with John + Sally) settled on **7 primitives** — adding `MetricBlock` to the original 6 (Shell, Button, Input, StatusDot, StateShell, TypeChip) so the Town view (21.10) inherits a ready-made counter for connected-clients and bandwidth displays. Sparkline, NodeCard, BreakdownPill, LiquidityBar, PairChip ship in the view stories that need them.

Chart library: **shadcn/ui charts** (`https://ui.shadcn.com/charts`, Recharts under the hood). Locked at this layer so the first chart-bearing view (21.10) inherits the decision.

The Vite SPA does not exist yet — `packages/townhouse-web/` is unbuilt. This story scaffolds the package, configures Tailwind + design tokens, integrates shadcn CLI for primitive composition, builds the 7 primitives, sets up Storybook for isolated primitive preview, and wires `pnpm dev:docker` so contributors can run the SPA against the dev stack from `21.8.0`.

## Dependencies

- **Story 21.8.0** (must be done before 21.8.5 dev-loop testing): provides `docker-compose-townhouse-dev.yml` + `scripts/townhouse-dev-infra.sh` + `.env.townhouse-dev`. The `pnpm dev:docker` script reads the env file to know where the Fastify API is.
- **Story 21.8** (done): `createApiServer` factory + `WS /metrics` channel + REST routes. The SPA consumes these endpoints; this story does NOT modify the API.
- **Story 21.7.5** (parallel/done): `DEFAULT_CONNECTOR_IMAGE` constant. Not directly imported by the SPA, but the dev stack the SPA runs against uses it.

**Runtime dependencies (new):**

- `vite@^5.x`, `@vitejs/plugin-react@^4.x` — SPA bundler.
- `react@^18.x`, `react-dom@^18.x`, `typescript` (already workspace-pinned).
- `tailwindcss@^3.x`, `@tailwindcss/typography`, `tailwindcss-animate` — utility-first styling.
- `class-variance-authority`, `clsx`, `tailwind-merge` — primitive variant composition (shadcn pattern).
- `recharts@^2.x` — charting; consumed via shadcn chart components.
- `lucide-react` — icon set used by shadcn primitives.
- `geist` (npm) — Geist Sans + Geist Mono fonts.
- `@storybook/react-vite@^8.x` — primitive preview (dev-only).
- `@axe-core/react`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jest-axe`, `jsdom` — accessibility + component tests.
- `react-router-dom@^6` — minimal routing so 21.9-lite, 21.10–21.13 can add routes without rework.
- `dotenv-cli`, `concurrently` — dev-loop orchestration.

**Tooling dependency (new):**

- `shadcn` CLI consumed via `npx shadcn@latest`. Initialize with `npx shadcn@latest init` in the new package — produces `components.json` per project context's UI work guidance.

## Acceptance Criteria

1. **AC-1: Package scaffold.** `packages/townhouse-web/` exists in the monorepo with `package.json` (`@toon-protocol/townhouse-web`, private, type: module), `tsconfig.json` extending the workspace base, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`. Listed in workspace `pnpm-workspace.yaml`. `pnpm install` from the workspace root succeeds. Path alias `@/*` → `src/*`.
2. **AC-2: Design tokens.** `src/theme/tokens.ts` exports: color palette (`canvas: #ffffff`, `ink: #171717`, `shadow: rgba(0,0,0,0.08)`, type accents Town `#0a72ef`/Mill `#de1d8d`/DVM `#ff5b4f` matching D21-008 hex values exactly), typography scale (size + tracking pairs — `48/-2.4`, `32/-1.6`, `24/-1.0`, `16/-0.4`, `14/-0.2`, `12/0`), three weights (400/500/600), three named animations (`fade-in`, `pulse-soft`, `rebal-pulse` — durations + easings per design spec), spacing scale (4/8/12/16/24/32/48/64), breakpoints (400/600/768/1024/1200/1400). All other code imports from this module — never inline hex, never raw size literals.
3. **AC-3: Tailwind config bridges tokens.** `tailwind.config.js` `theme.extend` references the tokens module so `bg-canvas`, `text-ink`, `bg-type-town`, `bg-type-mill`, `bg-type-dvm`, `shadow-border`, `font-geist-sans`, `font-geist-mono`, animation utilities all work via Tailwind classes. `@apply shadow-border` produces `box-shadow: 0 0 0 1px rgba(0,0,0,0.08)` (NOT a CSS `border:` declaration). Border utilities that produce `border: 1px solid` are blocked at the lint layer (AC-9).
4. **AC-4: shadcn/ui initialization + chart wiring.** `npx shadcn@latest init` run inside `packages/townhouse-web/` generates `components.json` configured to write to `src/components/ui/`. The shadcn `chart` component family added via `npx shadcn@latest add chart` (chart container, tooltip, legend, axis primitives). `recharts` and the chart components are exported from `src/charts/index.ts` — no view story imports `recharts` directly (CI rule AC-9).
5. **AC-5: 7 primitives in `src/components/primitives/`.** Each primitive is a TypeScript React component, accepts `className`, composes via `cva` for variants, exports types alongside the component. Required primitives:
   - **`Shell`** — top-level layout container; `header` + `main` + optional `footer` slots; uses shadow-as-border.
   - **`Button`** — variants `primary | secondary | ghost`, sizes `sm | md | lg`, loading state, disabled state. shadcn-derived; tokens applied.
   - **`Input`** — text input wrapped in shadow-bordered card. Variants for `slider` mode (used by fee config in 21.10/21.11) and `numeric` mode (`tnum` enabled), plus `chip` row variant for kind filters in 21.10.
   - **`StatusDot`** — small dot indicator; states `ok | degraded | down | unknown`; aria-label required (test enforces).
   - **`StateShell`** — wraps content with empty/loading/error states; consumers pass `state={'ready'|'loading'|'empty'|'error'}` plus per-state slots.
   - **`TypeChip`** — node-type accent label; types `town | mill | dvm`; renders the type name + tinted background using the type's accent color.
   - **`MetricBlock`** — number + label + optional unit + optional trend indicator (`+/-` glyph + delta value). `tnum` applied to digits. Variants `compact | full`. NOT a sparkline — sparkline is a separate primitive belonging to a future view story.
6. **AC-6: Storybook for primitives.** Storybook 8 boots via `pnpm --filter @toon-protocol/townhouse-web storybook`. Each primitive has a `*.stories.tsx` file with at minimum: default story, all variants, all states, an a11y check via `@storybook/addon-a11y`. Storybook MAY use fixture data for primitive preview (per D21-009's "Storybook may use fixtures for isolated primitive preview"). Storybook stories MUST NOT depend on a running dev stack.
7. **AC-7: `pnpm dev:docker` wires Vite + Fastify + dev stack.** `packages/townhouse-web/package.json` defines a `dev:docker` script that:
   - Reads `.env.townhouse-dev` from workspace root via `dotenv-cli`.
   - Asserts the file exists; if absent, prints "Run `./scripts/townhouse-dev-infra.sh up` first" and exits non-zero.
   - Starts the Townhouse Fastify API on the host (port 9400) pointed at `TOWNHOUSE_CONNECTOR_ADMIN_URL` from the env file (imports `createApiServer` from `@toon-protocol/townhouse`).
   - Starts Vite dev server (port 5173) with proxy: `/api` → `http://127.0.0.1:9400`, `/api/metrics` (WebSocket) → `ws://127.0.0.1:9400/metrics`.
   - Both processes shut down cleanly on `Ctrl+C` (use `concurrently --kill-others`).
8. **AC-8: Storybook fixture-mode guard.** A runtime guard in `src/main.tsx` throws a fatal error if a global `__USE_FIXTURES__` flag is detected outside Storybook context. Enforces D21-009: the product dev server consumes live Docker data only.
9. **AC-9: CI rules — no inline hex, no positive letter-spacing on Geist, no raw `border:`, no direct recharts import.** Four lint rules:
   - `no-inline-hex`: errors on any `#[0-9a-fA-F]{3,8}` literal in `src/**/*.{ts,tsx}` outside `theme/tokens.ts`.
   - `no-positive-letter-spacing-geist`: errors on any `letter-spacing` / `tracking` value `> 0` applied to a `font-geist-sans` element.
   - `no-raw-border`: errors on any `border: 1px solid` / `border-width:` / Tailwind `border` utility (without a `border-0` reset present). Use `shadow-border`.
   - `no-direct-recharts`: errors on `import ... from 'recharts'` outside `src/charts/`. View stories import from `@/charts` only.
   - Implementation: ESLint custom rules in `packages/townhouse-web/eslint-plugin-internal/`. The test failure must be unambiguous.
10. **AC-10: Axe-core baseline.** A vitest test (`src/__tests__/a11y-baseline.test.tsx`) renders each of the 7 primitives in their default variant + their interactive variant (e.g., Button enabled and disabled, StateShell in each of its four states), runs `axe-core` against the rendered tree, and asserts zero WCAG 2.1 AA violations. This is the floor view stories are required to maintain.
11. **AC-11: Build + tests.** `pnpm --filter @toon-protocol/townhouse-web build` produces a static SPA bundle in `dist/`. `pnpm --filter @toon-protocol/townhouse-web test` passes (primitive unit tests + a11y baseline + lint rules). The bundle has no runtime dependency on `@toon-protocol/townhouse` (the Fastify API is hit over HTTP/WS; the SPA does not import the Townhouse package directly at runtime — only the `dev:docker` script does, server-side).
12. **AC-12: Live-Docker smoke.** With `./scripts/townhouse-dev-infra.sh up` running, `pnpm --filter @toon-protocol/townhouse-web dev:docker` boots Vite + Fastify; visiting `http://127.0.0.1:5173` renders a placeholder Home with `Shell` + a single `TypeChip` per child node from `GET /api/nodes`. Full Home view ships in 21.9-lite — this AC verifies the plumbing works end-to-end.

## Tasks / Subtasks

- [ ] Task 1: Scaffold Vite + React + TS package (AC: #1)
  - [ ] 1.1 `pnpm create vite packages/townhouse-web --template react-ts`.
  - [ ] 1.2 Update `package.json`: name `@toon-protocol/townhouse-web`, private, scripts `dev`, `build`, `preview`, `test`, `storybook`, `dev:docker`, `lint`.
  - [ ] 1.3 Add to `pnpm-workspace.yaml` if not auto-picked up. `pnpm install` from root.
  - [ ] 1.4 `tsconfig.json` extends workspace base; strict TS settings inherit. Path alias `@/*` → `src/*` configured in both `tsconfig.json` and `vite.config.ts`.

- [ ] Task 2: Design tokens + Tailwind config (AC: #2, #3)
  - [ ] 2.1 Create `src/theme/tokens.ts` per AC-2. Cite D21-008 hex values verbatim.
  - [ ] 2.2 Install Tailwind: `pnpm --filter @toon-protocol/townhouse-web add -D tailwindcss postcss autoprefixer @tailwindcss/typography tailwindcss-animate`. `npx tailwindcss init -p`.
  - [ ] 2.3 In `tailwind.config.js` `theme.extend`, import `tokens.ts` and surface every token. Custom plugin block produces `shadow-border` utility (`box-shadow: 0 0 0 1px rgba(0,0,0,0.08)`).
  - [ ] 2.4 Install Geist: `pnpm --filter @toon-protocol/townhouse-web add geist`. Wire into `src/main.tsx` via `import { GeistSans, GeistMono } from 'geist/font'`.
  - [ ] 2.5 `src/index.css` with `@tailwind base/components/utilities` + Geist font-face declarations.

- [ ] Task 3: shadcn/ui init + chart components (AC: #4)
  - [ ] 3.1 `cd packages/townhouse-web && npx shadcn@latest init`. Components dir `src/components/ui`, utils alias `src/lib/utils`, base color matches `tokens.ts` ink, CSS variables enabled.
  - [ ] 3.2 `npx shadcn@latest add chart`. Confirms `chart.tsx` lands in `src/components/ui/`.
  - [ ] 3.3 Wrap shadcn chart exports in `src/charts/index.ts` so view stories import from `@/charts`. Re-export `LineChart`, `BarChart`, `AreaChart`, etc. helpers.
  - [ ] 3.4 One smoke story: `src/charts/__demo__/LineDemo.stories.tsx` rendering a 24-hour synthetic dataset (Storybook only).

- [ ] Task 4: Build the 7 primitives (AC: #5)
  - [ ] 4.1 `Shell.tsx` — semantic `<main>` + slots. Token-driven. Story + test.
  - [ ] 4.2 `Button.tsx` — `npx shadcn@latest add button`, then tokenized. `cva` variants, sizes, loading. Story + test.
  - [ ] 4.3 `Input.tsx` — `npx shadcn@latest add input`, plus slider, numeric (`tnum`), chip-row variants. Story + test.
  - [ ] 4.4 `StatusDot.tsx` — bespoke. aria-label required by type. Story for each state + test asserting aria-label.
  - [ ] 4.5 `StateShell.tsx` — bespoke; renders empty/loading/error/ready slots. Story + test.
  - [ ] 4.6 `TypeChip.tsx` — bespoke; node-type accent. Story + test for each type.
  - [ ] 4.7 `MetricBlock.tsx` — bespoke; number + label + unit + trend. `tnum` digits. Story + test.
  - [ ] 4.8 Barrel export `src/components/primitives/index.ts`.

- [ ] Task 5: Storybook (AC: #6)
  - [ ] 5.1 `pnpm --filter @toon-protocol/townhouse-web add -D @storybook/react-vite @storybook/addon-essentials @storybook/addon-a11y @storybook/test`. Init via `npx storybook@latest init`.
  - [ ] 5.2 Add a11y addon to `.storybook/main.ts`. Confirm each primitive story present.
  - [ ] 5.3 `pnpm storybook` boots. Capture screenshots of each primitive's default story for the PR.

- [ ] Task 6: `pnpm dev:docker` wiring (AC: #7, #8, #12)
  - [ ] 6.1 Add deps: `pnpm --filter @toon-protocol/townhouse-web add -D dotenv-cli concurrently`.
  - [ ] 6.2 `packages/townhouse-web/scripts/dev-docker.mjs`: reads `.env.townhouse-dev`, asserts presence (clear error if absent), boots Fastify API via `createApiServer` import, starts Vite. `Ctrl+C` tears down both via `concurrently --kill-others`.
  - [ ] 6.3 `vite.config.ts` `server.proxy`: `/api` → `http://127.0.0.1:9400`, with WebSocket pass-through for `/api/metrics`.
  - [ ] 6.4 In `src/main.tsx`, throw if `import.meta.env.DEV && globalThis.__USE_FIXTURES__` is set outside Storybook context.
  - [ ] 6.5 Placeholder Home component renders `<Shell>` + maps `GET /api/nodes` results to `<TypeChip>` per node. (Real Home is 21.9-lite.)

- [ ] Task 7: CI rules (AC: #9)
  - [ ] 7.1 Implement `no-inline-hex`, `no-positive-letter-spacing-geist`, `no-raw-border`, `no-direct-recharts` as ESLint plugin rules in `packages/townhouse-web/eslint-plugin-internal/`. Wire into the package's `.eslintrc.cjs`.
  - [ ] 7.2 Each rule has unit tests (RuleTester pattern) covering positive + negative cases.
  - [ ] 7.3 `pnpm --filter @toon-protocol/townhouse-web lint` invokes ESLint with the plugin enabled.

- [ ] Task 8: Axe-core baseline (AC: #10)
  - [ ] 8.1 Add deps: `pnpm --filter @toon-protocol/townhouse-web add -D @axe-core/react jest-axe @testing-library/react @testing-library/jest-dom vitest jsdom`.
  - [ ] 8.2 `vitest.config.ts` env `jsdom`. `setup.ts` extends `expect` with `jest-axe` matchers.
  - [ ] 8.3 `src/__tests__/a11y-baseline.test.tsx` — renders each primitive in default + interactive variants, runs `axe`, asserts zero WCAG 2.1 AA violations.

- [ ] Task 9: Build + verify (AC: #11, #12)
  - [ ] 9.1 `pnpm --filter @toon-protocol/townhouse-web build` produces `dist/`.
  - [ ] 9.2 `pnpm --filter @toon-protocol/townhouse-web test` — primitive tests + lint + a11y baseline all pass.
  - [ ] 9.3 With dev stack up: `pnpm dev:docker` boots; visit `http://127.0.0.1:5173` — placeholder Home with one `TypeChip` per child node visible.
  - [ ] 9.4 With dev stack DOWN: `pnpm dev:docker` exits with the clear "run `./scripts/townhouse-dev-infra.sh up` first" message.

## Dev Notes

### Why 7 primitives, not 8 (and not 6)

Re-entry analysis (party mode 2026-04-29) traded "thin token sheet" against "full 8 primitives." Sally's wizard-shaped argument for 5 (Shell + Button + StateShell + TypeChip + Input) and John's heartbeat-shaped argument for 5 (Shell + Button + StatusDot + Card + Input) both held water. Locked at 6 = union of both sets. Then 21.10's MetricBlock requirement (connected clients + bandwidth as numeric MetricBlocks) bumped to 7 — adding it here means 21.10 doesn't introduce a JIT primitive and the design system stays cohesive. NodeCard, Sparkline, BreakdownPill, LiquidityBar, PairChip, ChainIcon, TokenIcon stay in the view stories that need them.

### Why shadcn/ui (and not Material/Chakra/MUI/headless-only)

shadcn ships components as code, not as a runtime dependency. Each primitive is owned-and-modifiable in our repo. That fits the design-system rules in D21-008 (shadow-as-border, no traditional borders, custom letter-spacing) which would fight a runtime-shipped component library. Recharts under the hood is a known, boring choice — fits Winston's "boring technology for stability" lens. Project context's UI guidance also explicitly endorses shadcn (see `CLAUDE.md` UI Work section).

### Why ESLint custom rules instead of static-analysis vitest tests

Static-analysis-as-tests would catch the same violations, but ESLint surfaces them in the IDE as red squiggles before save. The friction differential — "see the bug as you type" vs. "wait for the test run" — is worth the rule-authoring cost. The custom rules are tiny (each <50 LOC) and live in the package, not the workspace, so they don't pollute other packages.

### Why `pnpm dev:docker` rather than `pnpm dev` plus a separate API command

Two separate commands invite "I forgot to start the API." The single-command loop with `concurrently --kill-others` matches what SDK contributors already learned from `pnpm test:e2e:docker` and the SDK E2E infra script. One mental model = lower onboarding cost.

### Storybook boundary

Storybook is a contributor tool for primitive isolation, never a substitute for the product dev loop. The `__USE_FIXTURES__` runtime guard (AC-8) prevents a contributor from accidentally booting the product against fixtures. D21-009's rule is unambiguous: the product dev server consumes live Docker data; only Storybook may use fixtures.

### What this story does NOT do

- Does not implement any view (Home, Town, Mill, DVM, Wallet, Wizard) — those are 21.9–21.13 + 21.14.
- Does not extend the Fastify API. `createApiServer` is consumed as-is from `packages/townhouse/src/api/server.ts`.
- Does not introduce a state management library (Zustand, Redux, Jotai, etc.). View stories pick when/whether they need one.
- Does not implement Sparkline, NodeCard, BreakdownPill, LiquidityBar, PairChip, ChainIcon, TokenIcon. Those ship in the view stories that introduce them.
- Does not lock the data-fetching pattern (TanStack Query, SWR, hand-rolled hooks). View stories pick.
- Does not configure dark theme. D21-008 explicitly defers dark theme.
- Does not deploy or publish the SPA. That's part of 21.16/21.17.
