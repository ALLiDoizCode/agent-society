---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-10'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md'
  - '_bmad-output/epics/epic-12-token-swap-primitive.md'
  - '_bmad-output/planning-artifacts/test-design-epic-12.md'
  - 'packages/core/src/types.ts'
  - 'packages/core/src/errors.ts'
  - 'packages/core/src/events/builders.ts'
  - 'packages/core/src/events/parsers.ts'
  - 'packages/core/src/events/builders.test.ts'
  - 'packages/core/src/events/parsers.test.ts'
  - 'packages/core/src/constants.ts'
---

# ATDD Checklist — Epic 12, Story 12.1: SwapPair Type + kind:10032 Serialization

**Date:** 2026-04-10
**Author:** Jonathan
**Primary Test Level:** Unit (Backend — Vitest, `@toon-protocol/core` package)
**Generation Mode:** AI generation (backend stack — no browser; standard CRUD-style builder/parser validation)

---

## Story Summary

Add a `SwapPair` TypeScript interface to `@toon-protocol/core`, extend `IlpPeerInfo` with an optional `swapPairs?: SwapPair[]` field, and teach `buildIlpPeerInfoEvent` / `parseIlpPeerInfo` to roundtrip that field on kind:10032 events — with strict structural validation shared between builder and parser, full backward compatibility for pre-Epic-12 events (no `swapPairs` key), and `BigInt`-safe `minAmount`/`maxAmount` comparison. Foundation story for Epic 12 (Token Swap Primitive); all downstream stories depend on the stable `SwapPair` shape and swap-capable peer discovery over kind:10032.

**As a** TOON Protocol developer building the Token Swap Primitive (Epic 12)
**I want** `SwapPair`, an optional `IlpPeerInfo.swapPairs` field, and roundtrip-safe builder/parser support on kind:10032 events
**So that** swap-capable peers (Mills) can advertise token pairs, current rates, and per-packet min/max limits — without breaking any pre-Epic-12 consumer.

---

## Stack Detection

- **Detected stack:** `backend` (pure TypeScript library — `packages/core`, no UI/browser)
- **Test framework:** Vitest (co-located `*.test.ts` next to source, existing convention in `packages/core/src/events/`)
- **Generation mode:** AI generation
- **No E2E / no Playwright / no component tests** — pure unit tests only
- **tea_use_playwright_utils / tea_browser_automation:** n/a (backend library)
- **Knowledge fragments applied:** `data-factories`, `test-quality`, `test-levels-framework`, `test-priorities-matrix`, `test-healing-patterns`

---

## Acceptance Criteria Coverage

| AC | Description | Test File(s) | Tests |
| --- | --- | --- | --- |
| AC-1 | `SwapPair` interface defined and exported | `swap-pair-validation.test.ts`, `swap-pair-builder.test.ts`, `swap-pair-parser.test.ts` | Type imports across all 3 files |
| AC-2 | `IlpPeerInfo.swapPairs?: SwapPair[]` optional | builder + parser suites | All roundtrip / serialize / parse tests |
| AC-3 | Builder serializes swapPairs (present / empty / undefined) | `swap-pair-builder.test.ts` | T-001, T-006, T-007 × 2 |
| AC-4 | Parser deserializes with backward compatibility | `swap-pair-parser.test.ts` | T-002, T-003, T-005 × 2 |
| AC-5 | `SwapPair` validation rules (8 rule families) | `swap-pair-validation.test.ts` | 30+ tests across `isValidSwapPair` + 2 asserters |
| AC-6 | `INVALID_SWAP_PAIR` error code via `ToonError`; `InvalidEventError` on parse | `swap-pair-validation.test.ts`, `swap-pair-builder.test.ts`, `swap-pair-parser.test.ts` | Asserter tests + T-008 × 5 (build) + T-008 × 5 (parse) |
| AC-7 | `SwapPair` exported as type from `packages/core/src/index.ts` | All 3 test files import `SwapPair` from `'../types.js'` (exported via barrel) | Compile-time check |
| AC-8 | >= 20 tests across helper + builder + parser | All 3 files | **~52 tests total** (well over the floor) |
| AC-9 | Build + lint + test green after implementation | Dev agent runs `pnpm --filter @toon-protocol/core build && test` | Green phase gate |

---

## Test Strategy

### Test Level Selection (Backend Rules)

All scenarios are pure-function / data-shape validation — **Unit** is the correct and only appropriate level. No integration tests (no network, no DB, no external services in scope for 12.1). No contract tests (this story does not cross service boundaries; that happens in 12.2/12.3).

| Test Scenario | Level | Priority | AC | T-ID |
| --- | --- | --- | --- | --- |
| Valid baseline pair passes `isValidSwapPair` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects missing `from` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects missing `to` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects empty `assetCode` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects negative/non-integer `assetScale` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects malformed `chain` (no colon, 4 segments, empty) | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects non-string / exponent / leading-zero / negative / trailing-dot `rate` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` accepts rate `"0"` (paused quoting) | Unit | P1 | AC-5 | — |
| `isValidSwapPair` rejects decimal / non-string / negative `minAmount` / `maxAmount` | Unit | P0 | AC-5 | — |
| `isValidSwapPair` rejects `minAmount > maxAmount` via BigInt (20-digit values) | Unit | P0 | AC-5, R-013 | — |
| `isValidSwapPair` accepts 20-digit `maxAmount` > `Number.MAX_SAFE_INTEGER` | Unit | P0 | AC-5, R-013 | — |
| `assertSwapPairForBuild` throws `ToonError` code `INVALID_SWAP_PAIR` | Unit | P0 | AC-6 | — |
| `assertSwapPairForParse` throws `InvalidEventError` | Unit | P0 | AC-6 | — |
| Both asserters include `swapPairs[index]` + field in message | Unit | P0 | AC-6 | — |
| Build single valid swapPair → JSON contains correct array | Unit | P0 | AC-3 | T-001 |
| Build multiple pairs (EVM/Mina/Solana) → order preserved | Unit | P0 | AC-3 | T-006 |
| Build `swapPairs: []` → content has `"swapPairs":[]` | Unit | P0 | AC-3 | T-007 |
| Build `swapPairs: undefined` → key omitted entirely | Unit | P0 | AC-3, R-011 | T-007 |
| Build invalid pair → throws `ToonError('INVALID_SWAP_PAIR')` (5 distinct shapes) | Unit | P0 | AC-3, AC-6 | T-008 |
| Regression: pre-Epic-12 `IlpPeerInfo` builds with no `swapPairs` key in content | Unit | P0 | AC-3, R-011 | — |
| Parse pre-Epic-12 event (no `swapPairs` key) → `result.swapPairs === undefined`, `'swapPairs' in result === false` | Unit | **P0** | AC-4, R-011 | T-003 |
| Parse single swapPair → all fields roundtrip exactly | Unit | P0 | AC-4 | T-002 |
| Parse high-precision rate (> 15 sig digits) → string preserved | Unit | P0 | AC-4, R-013 | T-004 |
| Parse pair with min/max omitted → both undefined | Unit | P1 | AC-4 | T-005 |
| Parse pair with min/max present → preserved as strings | Unit | P1 | AC-4 | T-005 |
| Parse rejects non-array `swapPairs`, missing `from`, numeric `rate`, malformed `chain` | Unit | P0 | AC-4, AC-6 | T-008 |
| Parse error message includes `swapPairs[index]` | Unit | P0 | AC-6 | T-008 |
| Roundtrip 3-pair EVM/Mina/Solana → `.toEqual()` deep equality | Unit | P0 | AC-3+AC-4 | — |
| Roundtrip 20-digit `maxAmount` → lossless | Unit | P0 | AC-3+AC-4, R-013 | — |

---

## Failing Tests Created (RED Phase)

### Validation Helper Tests (AC-5, AC-6, AC-8)

**File:** `packages/core/src/events/swap-pair-validation.test.ts` (~330 lines)

- **Status:** RED — file does not yet exist at `packages/core/src/events/swap-pair-validation.ts`, so all tests in this file fail to load (module-not-found).
- **Coverage:** 30+ tests across three `describe` blocks:
  - `isValidSwapPair` — pure function returning `{ valid: true } | { valid: false; reason; field }`. 22 tests covering baseline valid, optional-field permutations, rate format (5 invalid variants + 1 high-precision valid), assetCode/assetScale/chain structural rules, and BigInt min/max comparison with 20-digit values.
  - `assertSwapPairForBuild` — throws `ToonError` with code `'INVALID_SWAP_PAIR'`. 5 tests confirming error type, code, message format (`swapPairs[index]: ... (field: X)`), and several invalid-pair shapes.
  - `assertSwapPairForParse` — throws `InvalidEventError`. 4 tests confirming error class, message format, and several invalid-pair shapes.
- **Expected failure signal for dev agent:** `Error: Failed to resolve import "./swap-pair-validation.js"` → create `packages/core/src/events/swap-pair-validation.ts` with the three exports.

### Builder Tests (AC-3, AC-6, AC-8)

**File:** `packages/core/src/events/swap-pair-builder.test.ts` (~200 lines)

- **Status:** RED — 5 of 10 tests currently fail (`T-008 × 5` invalid-pair rejection), 5 technically pass by coincidence because `JSON.stringify` and the existing builder happen to produce the expected shape when no validation is enforced. All 5 currently-passing tests still drive the implementation indirectly (they assert structural properties the dev agent must preserve).
- **10 tests across one `describe` block:**
  - `(T-001)` serializes a single valid swapPair into content.
  - `(T-006)` preserves array order for 3 pairs (EVM / Mina / Solana).
  - `(T-007)` serializes `swapPairs: []` as empty array in content.
  - `(T-007)` omits `swapPairs` key when field is undefined.
  - `(T-008)` throws `ToonError('INVALID_SWAP_PAIR')` for: negative `assetScale`, non-numeric `rate`, `minAmount > maxAmount` (20-digit BigInt), malformed `chain`, empty `assetCode`.
  - Regression: pre-Epic-12 `IlpPeerInfo` (no `swapPairs`) builds with no `swapPairs` key in content — lock-in for R-011 backward compat.
- **Expected failure signal for dev agent:** `TypeError: ... is not a function` or `AssertionError: expected function to throw ToonError` on T-008 tests — signals need to add `assertSwapPairForBuild` call loop in `buildIlpPeerInfoEvent`.

### Parser Tests (AC-4, AC-6, AC-8)

**File:** `packages/core/src/events/swap-pair-parser.test.ts` (~300 lines)

- **Status:** RED — 10 of 12 tests currently fail; T-003 (pre-Epic-12 backward compat) and one edge case pass because the current parser silently ignores unknown fields. Those 2 passing tests serve as regression locks.
- **12 tests across two `describe` blocks:**
  - `parseIlpPeerInfo — swapPairs deserialization` (10 tests):
    - `(T-003)` parses pre-Epic-12 event → `result.swapPairs === undefined`, `'swapPairs' in result === false` (lock-in R-011).
    - `(T-002)` parses event with one pair — all fields preserved.
    - `(T-004)` preserves 18-sig-digit rate `"0.000123456789012345"` exactly.
    - `(T-005)` × 2 parses pair with min/max omitted vs both present.
    - `(T-008)` × 5 throws `InvalidEventError` on: non-array `swapPairs`, missing `from`, numeric `rate`, malformed `chain`, empty `assetCode` on 2nd pair (index-in-message check).
  - `swapPairs roundtrip (build → parse)` (2 tests):
    - 3-pair EVM / Mina / Solana deep-equality roundtrip.
    - 20-digit `maxAmount` lossless roundtrip (BigInt safety under R-013).
- **Parser fixtures constructed by hand** via a local `buildEvent()` helper that signs raw JSON content with `finalizeEvent` and a throwaway key — does NOT depend on `buildIlpPeerInfoEvent`, so parser tests cannot be fooled by a broken builder.

---

## Initial Test Run (RED Phase Verification)

**Command:**
```bash
pnpm --filter @toon-protocol/core exec vitest run \
  src/events/swap-pair-validation.test.ts \
  src/events/swap-pair-builder.test.ts \
  src/events/swap-pair-parser.test.ts
```

**Result (2026-04-10):**
```
 Test Files  3 failed (3)
      Tests  15 failed | 7 passed (22 executed)
   + 1 test file (swap-pair-validation.test.ts) failed to collect because
     './swap-pair-validation.js' module does not exist yet (30+ additional
     helper tests will fail to load until dev creates the file)
```

**Why some tests "pass" before implementation is a non-issue:**

- The 7 currently-passing tests are ones where the *shape* of the happy path happens to match what `JSON.stringify` and the pass-through parser already do (e.g., `swapPairs: undefined` already gets omitted by `JSON.stringify`; unknown fields pass through untouched). These tests still serve as regression locks — once the dev adds validation, they must continue to pass.
- The 15 failing tests cover all the **behavior-forcing** assertions: every AC-5 validation rule, every AC-6 error-throwing path, the 20-digit BigInt tests, the field-name-in-message checks, and the deep-equality roundtrips.
- The missing validation helper module (`swap-pair-validation.ts`) is the single biggest signal to the dev agent — that test file cannot even load until the module exists.

✅ **RED phase verified.**

---

## Data Factories Used

No separate factory file. Each test file has a local `validPair()` / `basePeerInfo()` helper following the existing convention in `packages/core/src/events/builders.test.ts` (`createTestIlpPeerInfo`). Overrides are applied inline via object spread, which matches the existing test style for the package and keeps the dev agent's reading burden minimal.

---

## Mock Requirements

None. This story is pure in-memory data-shape validation on an existing Nostr event kind. No HTTP, no relay, no connector, no Arweave, no external service. `nostr-tools/pure` `finalizeEvent` + `generateSecretKey` provide the only "external" dependency and are already project-standard (used throughout the existing `builders.test.ts`).

---

## Required data-testid Attributes

N/A — backend library, no UI.

---

## Implementation Checklist

Mirrors the story's Task list but re-sequenced by test-driven priority: start with the test that most constrains the design, then grow outward.

### Task A — Types foundation (AC-1, AC-2, AC-7) · ~0.5h

- [ ] Add `SwapPair` interface to `packages/core/src/types.ts` with exact shape from AC-1
- [ ] Add optional `swapPairs?: SwapPair[]` field to `IlpPeerInfo`
- [ ] Export `SwapPair` as type from `packages/core/src/index.ts` (alongside `IlpPeerInfo`)
- [ ] Run: `pnpm --filter @toon-protocol/core build` → zero TypeScript errors
- [ ] ✅ Validation helper test file now loads (modules resolve)
- [ ] Gate: helper tests can now execute (still all failing — that's fine)

### Task B — Validation helper (AC-5, AC-6) · ~1.5h

- [ ] Create `packages/core/src/events/swap-pair-validation.ts` with:
  - `isValidSwapPair(pair): { valid: true } | { valid: false; reason; field }`
  - `assertSwapPairForBuild(pair, index): asserts pair is SwapPair` → throws `ToonError(msg, 'INVALID_SWAP_PAIR')`
  - `assertSwapPairForParse(pair, index): asserts pair is SwapPair` → throws `InvalidEventError(msg)`
- [ ] Both asserters format message as `swapPairs[${index}]: ${reason} (field: ${field})`
- [ ] Import `validateChainId` from `./parsers.js` (confirmed exported at line 19)
- [ ] Use `BigInt(min) > BigInt(max)` for cross-field check (Epic 11 MAX_SAFE_INTEGER guard)
- [ ] Rate regex: `/^(0|[1-9]\d*)(\.\d+)?$/`; amount regex: `/^\d+$/`
- [ ] Run: `pnpm --filter @toon-protocol/core exec vitest run src/events/swap-pair-validation.test.ts`
- [ ] ✅ All 30+ validation helper tests pass (GREEN)

### Task C — Builder wiring (AC-3, AC-6) · ~0.5h

- [ ] In `builders.ts::buildIlpPeerInfoEvent`, after the `ilpAddresses` block and before `finalizeEvent()`:
  ```ts
  if (info.swapPairs !== undefined) {
    info.swapPairs.forEach((p, i) => assertSwapPairForBuild(p, i));
  }
  ```
- [ ] Update JSDoc: add `@throws {ToonError} code 'INVALID_SWAP_PAIR' if any swapPair is structurally invalid`
- [ ] No change needed to `JSON.stringify(effectiveInfo)` call — `swapPairs: undefined` is already dropped by default
- [ ] Run: `pnpm --filter @toon-protocol/core exec vitest run src/events/swap-pair-builder.test.ts`
- [ ] ✅ All 10 builder tests pass

### Task D — Parser wiring (AC-4, AC-6) · ~0.75h

- [ ] In `parsers.ts::parseIlpPeerInfo`, after the `prefixPricing` block:
  ```ts
  const { swapPairs: rawSwapPairs } = parsed;
  let swapPairs: SwapPair[] | undefined;
  if (rawSwapPairs !== undefined) {
    if (!Array.isArray(rawSwapPairs)) {
      throw new InvalidEventError('swapPairs must be an array');
    }
    rawSwapPairs.forEach((p, i) => assertSwapPairForParse(p, i));
    swapPairs = rawSwapPairs as SwapPair[];
  }
  ```
- [ ] In return object literal, add `...(swapPairs !== undefined && { swapPairs })` in the conditional-spread block
- [ ] **Critical:** Do NOT set `swapPairs: undefined` explicitly — pre-Epic-12 events must roundtrip via deep equality, which requires the key to be literally absent
- [ ] Run: `pnpm --filter @toon-protocol/core exec vitest run src/events/swap-pair-parser.test.ts`
- [ ] ✅ All 12 parser + roundtrip tests pass

### Task E — Full verification (AC-9) · ~0.25h

- [ ] `pnpm --filter @toon-protocol/core build` → exit 0
- [ ] `pnpm --filter @toon-protocol/core test` → all tests pass, zero regressions in pre-existing `builders.test.ts` / `parsers.test.ts`
- [ ] `pnpm lint` (packages/core scope) → exit 0
- [ ] Confirm zero changes required in `packages/sdk`, `packages/town`, `packages/mill`, or any downstream consumer
- [ ] ✅ Story ready for review

**Estimated total effort:** ~3.5 hours.

---

## Running Tests

```bash
# Run all Story 12.1 failing tests
pnpm --filter @toon-protocol/core exec vitest run \
  src/events/swap-pair-validation.test.ts \
  src/events/swap-pair-builder.test.ts \
  src/events/swap-pair-parser.test.ts

# Watch mode while implementing
pnpm --filter @toon-protocol/core exec vitest \
  src/events/swap-pair-validation.test.ts \
  src/events/swap-pair-builder.test.ts \
  src/events/swap-pair-parser.test.ts

# Full core package test suite (after implementation)
pnpm --filter @toon-protocol/core test

# Type-check only
pnpm --filter @toon-protocol/core build
```

---

## Red-Green-Refactor Workflow

### RED Phase ✅ Complete

- ✅ 3 new test files written, 52 tests total
- ✅ Test files verified to FAIL before implementation (15 hard failures + 1 module-not-found for the entire validation helper suite)
- ✅ No dependency on unwritten builder/parser in parser tests (parser tests build fixtures by hand with `finalizeEvent`)
- ✅ No new factories or mocks required
- ✅ Regression tests lock in backward compatibility (R-011) — pre-Epic-12 `IlpPeerInfo` builds and parses identically

### GREEN Phase (next: dev-story)

Follow Tasks A → B → C → D → E in the checklist above. One task = one `vitest run` cycle. Do not skip ahead — task B (validation helper) unblocks both builder and parser paths, and doing it first means tasks C and D collapse to ~5 lines of code each.

### REFACTOR Phase

After all tests green:

- Verify the two-asserter pattern (`assertSwapPairForBuild` / `assertSwapPairForParse`) does not introduce any code duplication — both must delegate to a single core function
- Check JSDoc completeness on public exports (`SwapPair`, `isValidSwapPair`, both asserters)
- Sanity-check that no `Number(...)` coercion was added anywhere near `minAmount` / `maxAmount` (Epic 11 retro guard)

---

## Validation Against Checklist

- [x] Prerequisites satisfied (story approved, AC clear, vitest framework exists)
- [x] Test files created at correct paths (co-located with source per package convention)
- [x] Checklist maps 1:1 with acceptance criteria (AC-1 through AC-9)
- [x] Tests designed to fail before implementation (verified: 15 fail immediately + 1 whole file fails to collect)
- [x] No orphaned CLI sessions / browsers (backend stack — no browser automation used)
- [x] Temp artifacts stored in `_bmad-output/test-artifacts/` (this file)
- [x] No changes to existing green tests (`builders.test.ts` / `parsers.test.ts` untouched — new tests are in separate files)

---

## Key Risks & Assumptions

- **R-011 — backward compatibility breakage:** Locked in by two regression tests (builder: pre-Epic-12 IlpPeerInfo has no `swapPairs` key; parser: `'swapPairs' in result === false` for pre-Epic-12 fixture). If the dev agent accidentally sets `swapPairs: undefined` on the return object literal (vs conditional spread), the parser regression test will fail loudly.
- **R-013 — BigInt precision under 20-digit amounts:** Locked in by the 20-digit `maxAmount` roundtrip test and the 20-digit `minAmount > maxAmount` validation test. Both force the dev to use `BigInt(...)` comparison, not `Number(...)`.
- **Assumption:** `validateChainId` continues to be exported from `parsers.ts` at module scope (verified line 19 during adversarial review, confirmed again in this ATDD pass). If a future refactor hides it behind a non-exported helper, Task B must switch to `packages/core/src/chain/` extraction per the story's fallback plan.
- **Assumption:** `nostr-tools/pure` continues to provide `finalizeEvent` and `generateSecretKey` — these are already pinned workspace deps.
- **Non-risk:** The 7 currently-"passing" tests before implementation are OK because they lock in behavior the dev must preserve (JSON serialization shape, conditional spread roundtrip). They are not false positives.

---

## Next Recommended Workflow

**`bmad-bmm-dev-story`** with this checklist as the implementation guide. Target: one task per vitest iteration (A → B → C → D → E). Expected total wall-clock time ~3.5 hours for a focused dev pass on a backend-only, single-package, additive change.

After GREEN phase: skip `automate` (already automated — these ARE the automated tests) and proceed directly to `bmad-tea-testarch-nfr` if NFR assessment is required for epic-12 foundation, or straight to `/auto-bmad:story` for the next story (12.2).

---

## Knowledge Base References Applied

- `test-quality.md` — Given-When-Then structure in all tests, one concept per test, deterministic fixtures (no `Date.now()` in assertions, hardcoded seeds)
- `test-levels-framework.md` — Backend stack → Unit level; no integration/E2E/component tests for pure data-shape validation
- `test-priorities-matrix.md` — P0 for all AC-traceable tests (foundation story — downstream epic depends on exact shape)
- `test-healing-patterns.md` — Parser tests construct fixtures by hand (not via builder) to avoid coupled failures masking real bugs
- `data-factories.md` — Inline factory helpers (`validPair()`, `basePeerInfo()`) rather than separate files, matching existing `packages/core/src/events/*.test.ts` convention

---

## Notes

- All 3 test files follow the existing `packages/core/src/events/*.test.ts` convention: co-located, ESM imports with `.js` extensions, `generateSecretKey` + `finalizeEvent` from `'nostr-tools/pure'`, no global test config beyond `vitest.config.ts`.
- Tests split into 3 files (not extending existing `builders.test.ts` / `parsers.test.ts`) so pre-existing tests stay untouched during RED → GREEN transitions. Story Task 6.1 / 7.1 suggest adding a `describe('swapPairs')` block at the bottom of the existing files; the dev agent may either (a) keep the new files as-is, or (b) move the new `describe` blocks into the existing files during REFACTOR. Either is acceptable per story intent.
- No pet-circuit / o1js / WASM tests involved — safe for sub-agent execution.
- No Docker / Anvil / SDK E2E infra required.

---

## Contact

**Questions or Issues?**

- Story spec: `_bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md`
- Epic spec: `_bmad-output/epics/epic-12-token-swap-primitive.md`
- Test design: `_bmad-output/planning-artifacts/test-design-epic-12.md`

---

**Generated by BMad TEA Agent (testarch-atdd workflow, YOLO mode)** — 2026-04-10
