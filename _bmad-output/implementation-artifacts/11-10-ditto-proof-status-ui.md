# Story 11.10: Ditto Proof Status UI

Status: done
ui_impact: true

## Story

As a ditto (React SPA) developer,
I want React components and utility hooks for displaying pet interaction proof status from Kind 14919 events,
so that users can visually distinguish between optimistic (pending ZK proof) and proven (ZK-settled on Mina) pet interactions.

## Dependencies

- **Upstream:** Story 11-9 (Ditto Pet DVM Integration) -- `parsePetInteractionEvent` and `PetInteractionEventData` types consumed here. DONE.
- **Shared:** `@toon-protocol/client` -- `parsePetInteractionEvent`, `PetInteractionEventData`, `ProofStatus` types.
- **Shared:** `@toon-protocol/rig` -- Forge-UI React app; proof status components live here.
- **UI toolkit:** `packages/rig/src/web/components/ui/badge.tsx` -- existing Badge component for status indicators.

## Acceptance Criteria

1. **AC-1 -- ProofStatusBadge component:** Create a `ProofStatusBadge` React component in `packages/rig/src/web/components/proof-status-badge.tsx` that:
   - Accepts `proofStatus: ProofStatus` prop (`'optimistic' | 'proven'`)
   - Renders `'optimistic'` as a yellow/warning-style badge with text "Optimistic" and a clock icon (Lucide `Clock` icon)
   - Renders `'proven'` as a green/success-style badge with text "ZK Proven" and a shield check icon (Lucide `ShieldCheck` icon)
   - Uses the existing `Badge` component from `@/components/ui/badge`
   - Accepts optional `className` prop for layout customization
   - Is fully accessible (aria-label prop passed through)

2. **AC-2 -- PetInteractionCard component:** Create a `PetInteractionCard` React component in `packages/rig/src/web/components/pet-interaction-card.tsx` that:
   - Accepts `event: PetInteractionEventData` prop
   - Displays the interaction summary: action type name (mapped from actionType number: 0=Feed, 1=Play, 2=Clean, 3=Rest, 4=Warm, 5=Check, 6=Sing, 7=Talk, 8=Medicine, 9=Cruzar, 10=PlayMusic), cycle number, stage name (0=Egg, 1=Baby, 2=Adult)
   - Displays the `ProofStatusBadge` with the event's `proofStatus`
   - Shows brain hash (truncated to first 8 + last 4 chars: `abc12345...ef01`)
   - Shows stat changes when `event.content` is non-null: final hunger, happiness, health, hygiene, energy values
   - Shows Mina TX link placeholder when `event.minaTx` is present (plain text: "Mina: {minaTx}")
   - Uses Tailwind CSS for layout

3. **AC-3 -- useProofStatus hook:** Create a `useProofStatus` hook in `packages/rig/src/web/hooks/use-proof-status.ts` that:
   - Accepts `events: PetInteractionEventData[]`
   - Returns `{ optimisticCount: number, provenCount: number, total: number }`
   - Is a pure computation hook (no side effects, no subscriptions)
   - Uses `useMemo` for performance

4. **AC-4 -- Action type and stage utilities:** Create `packages/rig/src/web/lib/pet-utils.ts` with:
   - `getActionName(actionType: number): string` -- maps 0-10 to action names, returns `'Unknown'` for out-of-range values
   - `getStageName(stage: number): string` -- maps 0-2 to stage names (`'Egg'`, `'Baby'`, `'Adult'`), returns `'Unknown'` for out-of-range
   - `truncateBrainHash(hash: string): string` -- returns first 8 + `'...'` + last 4 chars; returns `'...'` if hash is too short (< 12 chars)
   - All three are pure functions with no external dependencies

5. **AC-5 -- Unit tests:** >= 12 unit tests across 3 test files:
   - `ProofStatusBadge.test.tsx` (>= 4): renders optimistic badge, renders proven badge, passes className, renders with aria-label
   - `pet-interaction-card.test.tsx` (>= 5): renders action name, renders proof status badge, shows truncated brain hash, renders stat values when content present, handles null content
   - `pet-utils.test.ts` (>= 3): getActionName valid/invalid, getStageName valid/invalid, truncateBrainHash normal/short

6. **AC-6 -- Build verification:** After all changes:
   - `pnpm build` compiles cleanly across all packages
   - `pnpm lint` passes
   - `pnpm --filter @toon-protocol/rig test` passes -- all new + existing tests pass

## Tasks / Subtasks

- [x] Task 1: Create utility functions (AC: 4)
  - [x] 1.1 Create `packages/rig/src/web/lib/pet-utils.ts` with `getActionName`, `getStageName`, `truncateBrainHash`

- [x] Task 2: Create React components (AC: 1, 2)
  - [x] 2.1 Create `packages/rig/src/web/components/proof-status-badge.tsx` (ProofStatusBadge)
  - [x] 2.2 Create `packages/rig/src/web/components/pet-interaction-card.tsx` (PetInteractionCard)

- [x] Task 3: Create hook (AC: 3)
  - [x] 3.1 Create `packages/rig/src/web/hooks/use-proof-status.ts` (useProofStatus)

- [x] Task 4: Write unit tests (AC: 5)
  - [x] 4.1 Create `packages/rig/src/web/components/proof-status-badge.test.tsx`
  - [x] 4.2 Create `packages/rig/src/web/components/pet-interaction-card.test.tsx`
  - [x] 4.3 Create `packages/rig/src/web/lib/pet-utils.test.ts`

- [x] Task 5: Build and lint verification (AC: 6)
  - [x] 5.1 Run `pnpm build`
  - [x] 5.2 Run `pnpm lint`
  - [x] 5.3 Run `pnpm --filter @toon-protocol/rig test`

## Dev Notes

### Critical: Package Boundary

The `rig` package imports `@toon-protocol/client` as a `devDependency` (Vite bundles it). Import pet types from `@toon-protocol/client`:

```typescript
import type { PetInteractionEventData, ProofStatus } from '@toon-protocol/client';
```

The `parsePetInteractionEvent` function itself lives in `@toon-protocol/client` -- rig only needs the output types + the `ProofStatus` type union for display.

### Component Location

Components go in `packages/rig/src/web/components/` (same directory as `branch-selector.tsx`, `code-view.tsx`). The `lib/` directory is at `packages/rig/src/web/lib/` (where `utils.ts` lives).

### Existing UI Patterns

- Use `Badge` from `@/components/ui/badge` for status indicators
- Use Lucide React icons: `Clock`, `ShieldCheck` (already a lucide-react dependency in rig)
- Use Tailwind CSS classes for styling
- Use `cn()` from `@/lib/utils` for className merging

### Action Type Map (from pet-circuit/src/constants.ts)

```
0=Feed, 1=Play, 2=Clean, 3=Rest, 4=Warm, 5=Check, 6=Sing, 7=Talk, 8=Medicine, 9=Cruzar, 10=PlayMusic
```

### Test Framework

The rig uses:
- Vitest with jsdom environment
- `@testing-library/react` for component tests
- Setup file: `packages/rig/src/web/__tests__/setup.ts` (jest-dom matchers already loaded)
- Tests colocated with source OR in `__tests__/` directory (prefer colocated per project convention)

### Brain Hash Truncation

Standard convention: show `hash.slice(0, 8) + '...' + hash.slice(-4)`. This gives `abcd1234...ef01` -- enough to identify visually without overwhelming the UI.

### ProofStatus Display Colors

- `optimistic`: use `variant="secondary"` or outline with amber/yellow styling -- not "warning" (use Tailwind `text-amber-600` or similar)
- `proven`: use `variant="default"` (primary/green) or a success indicator

Since the Badge component uses `cva` variants (default, secondary, destructive, outline, ghost, link), use:
- `optimistic` → `variant="outline"` + custom className for amber color
- `proven` → `variant="default"` (primary blue-ish works, or secondary for contrast)

### Previous Story Intelligence (11-9)

- `PetInteractionEventData` has: `blobbiId`, `actionType`, `itemId`, `tokenCost`, `cycle`, `stage`, `brainHash`, `proofStatus`, `content`, optional `proof`, optional `minaTx`
- `ProofStatus = 'optimistic' | 'proven'`
- Kind 14919 events are emitted by the Pet DVM and readable from any Nostr relay

### References

- [Source: packages/client/src/pet/types.ts] -- PetInteractionEventData, ProofStatus, StatValues
- [Source: packages/rig/src/web/components/ui/badge.tsx] -- Badge component (cva variants)
- [Source: packages/rig/src/web/components/branch-selector.tsx] -- component pattern example
- [Source: packages/rig/src/web/__tests__/repo-list-page.test.tsx] -- React testing pattern
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#8.3] -- Ditto requirements
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#11-10] -- Test strategy

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None — all tests passed after fixing test isolation (explicit `cleanup()` calls to handle missing `globals: true` in vitest config).

### Completion Notes List

- Implemented `getActionName`, `getStageName`, `truncateBrainHash` pure utilities in `packages/rig/src/web/lib/pet-utils.ts`
- Created `ProofStatusBadge` React component using existing `Badge` + Lucide icons (`Clock` for optimistic, `ShieldCheck` for proven); amber outline for optimistic, green default for proven
- Created `PetInteractionCard` React component displaying action name, stage, cycle, proof badge, truncated brain hash, final stats (conditional on content), Mina TX (conditional)
- Created `useProofStatus` hook aggregating optimistic/proven counts via `useMemo`
- 45 unit tests: 23 pet-utils, 14 card, 8 badge — all passing
- Test isolation fix: added explicit `afterEach(() => cleanup())` because vitest config lacks `globals: true` (testing-library auto-cleanup requires globals)
- No modifications to existing files (purely additive)

### File List

- packages/rig/src/web/lib/pet-utils.ts (created)
- packages/rig/src/web/components/proof-status-badge.tsx (created)
- packages/rig/src/web/components/pet-interaction-card.tsx (created)
- packages/rig/src/web/hooks/use-proof-status.ts (created)
- packages/rig/src/web/lib/pet-utils.test.ts (created)
- packages/rig/src/web/components/proof-status-badge.test.tsx (created)
- packages/rig/src/web/components/pet-interaction-card.test.tsx (created)
- _bmad-output/implementation-artifacts/11-10-ditto-proof-status-ui.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-04-09: Story 11-10 development complete. Implemented proof status UI components (ProofStatusBadge, PetInteractionCard), useProofStatus hook, and pet-utils utilities in packages/rig/. 45 unit tests, all passing.
- 2026-04-09: Added use-proof-status.test.ts (7 hook tests). Total: 52 tests.
- 2026-04-09: Code Review Pass #1 — fixed cn() usage in PetInteractionCard className (consistency with codebase convention).

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 1 low
- **Outcome:** Pass with fix applied

#### Issues Found

1. **[Low] `PetInteractionCard` used template literal for className instead of `cn()`** — Inconsistent with codebase convention (all other components use `cn()` from `@/lib/utils`). Fixed by importing and using `cn()`.

#### Tests

- All 395 tests pass after fix — no behavioral change, purely style fix.

### Review Pass #2

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Notes

- Verified `??` fallback on `Record<number, string>` is correct (TypeScript allows undefined on numeric index)
- Verified `event.content !== null` guard is the right check (type is `InteractionResultContent | null`)
- Verified `event.minaTx !== undefined` guard handles optional field correctly
- All 395 tests pass — no files modified

### Review Pass #3 (FINAL — Security Focus)

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Security Checks Performed

- XSS: all data rendered as React text nodes (never innerHTML) — safe
- Prototype pollution: display layer never parses JSON; upstream parser (11-9) already hardened — safe
- ReDoS: no regex in new source files — safe
- Injection: no href/src/eval/dynamic script loading; minaTx rendered as plain text — safe
- Info leakage: brainHash and minaTx are intentionally shown (UX requirement) — acceptable
- Props spreading (`...props` in ProofStatusBadge): consistent with all shadcn components — acceptable

#### Tests

- All 395 tests pass — no files modified
