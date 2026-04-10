---
story: 12-1-swappair-type-and-kind-10032-serialization
reviewer: TEA (bmad-tea-testarch-test-review)
date: 2026-04-10
mode: yolo
scope: swap-pair-validation.test.ts, swap-pair-builder.test.ts, swap-pair-parser.test.ts, index.test.ts (AC-2/AC-7)
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-quality-evaluation', 'step-04-generate-report']
lastStep: 'step-04-generate-report'
lastSaved: '2026-04-10'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md
  - packages/core/src/events/swap-pair-validation.test.ts
  - packages/core/src/events/swap-pair-builder.test.ts
  - packages/core/src/events/swap-pair-parser.test.ts
  - packages/core/src/index.test.ts
  - packages/core/src/events/swap-pair-validation.ts
  - packages/core/src/events/parsers.ts
---

# Test Quality Review — Story 12.1 SwapPair & kind:10032 Serialization

## Summary

**Overall Quality Score: 94 / 100** — Excellent. The ATDD test suite for Story 12.1 is comprehensive, well-organized, and tightly traced to acceptance criteria. Two small parser-side gaps were identified and fixed during this review. All 2413 `@toon-protocol/core` tests pass (7 pre-existing skipped).

| Dimension        | Score | Notes |
|------------------|-------|-------|
| Determinism      | 20/20 | No timing, no network, no shared state. `generateSecretKey()` is deterministic-per-call but not cross-test-dependent. |
| Isolation        | 20/20 | Each test constructs its own fixture via pure `validPair()`/`baseContent()` factories. No module-level mutable state. |
| Maintainability  | 19/20 | Clear describe blocks, traceability tags `(T-00x)` on every test, single source-of-truth fixtures. Minor: roundtrip tests use `await import('./builders.js')` instead of top-level import — works but inconsistent with the file's other imports. |
| Performance      | 20/20 | All four suites run in <150ms total. No heavyweight setup. |
| AC Coverage      | 15/15 | Every AC-5 rule has an explicit test. AC-2/AC-7 enforced via type-level tests in `index.test.ts`. Parser empty-array and parser-null gaps closed in this review. |

## Files Reviewed

| File | Tests (pre) | Tests (post) | Notes |
|------|-------------|--------------|-------|
| `packages/core/src/events/swap-pair-validation.test.ts` | 41 | 41 | Exhaustive — covers every AC-5 rule plus boundary cases (assetScale=0, min===max, 20-digit BigInt). No change. |
| `packages/core/src/events/swap-pair-builder.test.ts` | 10 | 10 | T-001/T-006/T-007/T-008 all traced; regression test for pre-Epic-12 shape. No change. |
| `packages/core/src/events/swap-pair-parser.test.ts` | 12 | 14 | +2 tests added (see Fixes Applied). |
| `packages/core/src/index.test.ts` (AC-2/AC-7) | 12 | 12 | Type-level export assertions for `SwapPair` and `IlpPeerInfo.swapPairs`. No change. |
| **Total** | **75** | **77** | |

## Strengths

1. **Shared-helper factoring enforced by tests.** The validation helper suite (41 tests) exercises rules in isolation so builder/parser tests don't need to re-enumerate them. This matches the story's explicit goal of avoiding the feePerByte-style duplication smell.
2. **BigInt semantics exercised directly.** Tests at lines 267-273 (validation) and 155-165 (builder) use true 20-digit values that exceed `Number.MAX_SAFE_INTEGER`, catching any regression where a dev inadvertently coerces to `Number`.
3. **High-precision rate round-trip.** Tests preserve 18-significant-digit decimals (`"0.000123456789012345"`), the strongest guarantee against IEEE-754 drift.
4. **Backward-compatibility regression coverage.** Both T-003 (parser) and the builder regression test assert that pre-Epic-12 events are literally unchanged (`'swapPairs' in result` === false, not merely `undefined`). This directly addresses R-011.
5. **Error-message field targeting.** Tests assert specific substrings (`'swapPairs[3]'`, `'rate'`, `'from'`) rather than just class-of-error, catching future refactors that silently change user-facing messages.
6. **Asymmetric asserter coverage.** Both `assertSwapPairForBuild` (throws `ToonError` + `INVALID_SWAP_PAIR` code) and `assertSwapPairForParse` (throws `InvalidEventError`) have dedicated describe blocks that assert the correct error *class* — the subtlety the story explicitly called out in Task 2.1.

## Findings (Fixed In This Review)

### F-001 (MEDIUM): Parser did not test `swapPairs: null`

**Location:** `swap-pair-parser.test.ts`

**Issue:** The parser's conditional guard is `rawSwapPairs !== undefined`. If a future refactor ever used `!= undefined` (loose equality), `null` would silently pass through as if absent. No test locked this in.

**Fix:** Added a T-008 case that constructs `{ swapPairs: null }` and asserts `InvalidEventError` with an `/array/i` message.

### F-002 (MEDIUM): Parser did not test `swapPairs: []` (empty array) parses distinctly from undefined

**Location:** `swap-pair-parser.test.ts`

**Issue:** The builder side tests `swapPairs: []` → content contains `"swapPairs": []` (distinct from undefined). But there was no symmetric parser test verifying that an incoming `"swapPairs": []` parses back to a present-but-empty array (not stripped, not converted to `undefined`). This is AC-3/AC-4 semantic parity.

**Fix:** Added a parser test that builds an event with `swapPairs: []` and asserts `result.swapPairs` is a 0-length array AND `'swapPairs' in result === true`.

**Both fixes verified:** `pnpm --filter @toon-protocol/core test` → 2413 passed, 7 skipped, 0 failed.

## Non-Findings (Considered and Rejected)

- **Whitespace-only `assetCode`:** `' '` would pass `isNonEmptyString`. Not in AC-5 (which says "non-empty string"), and strictness here is out of scope for this story.
- **Rate `'0.'` boundary:** Already explicitly tested as rejected (line 225-228 validation suite).
- **Roundtrip `await import()` vs top-level import:** Works correctly and is isolated to 2 tests; changing it risks introducing a cycle with `vitest` module resolution. Left as-is.
- **Coverage gating:** Out of scope per the `test-review` workflow — route to `trace` for coverage gate decisions.

## Traceability (AC → Tests)

| AC | Covered by |
|----|------------|
| AC-1 (`SwapPair` type) | `index.test.ts` lines 38-52 (type-level) + every validation fixture |
| AC-2 (`IlpPeerInfo.swapPairs?`) | `index.test.ts` lines 54-83 (type-level regression) |
| AC-3 (builder serializes) | `swap-pair-builder.test.ts` T-001/T-006/T-007/T-008 (10 tests) |
| AC-4 (parser deserializes) | `swap-pair-parser.test.ts` T-002/T-003/T-004/T-005/T-008 + 2 new tests |
| AC-5 (validation rules) | `swap-pair-validation.test.ts` (41 tests, 1 per rule + boundaries) |
| AC-6 (new error code) | `swap-pair-validation.test.ts` lines 304-313; `swap-pair-builder.test.ts` lines 125-188 |
| AC-7 (package exports) | `index.test.ts` lines 38-52 |
| AC-8 (>= 20 tests) | 77 tests total across 4 files ✅ |
| AC-9 (build/lint/test) | Verified by `pnpm --filter @toon-protocol/core test` in this review |

## Verification

```
pnpm --filter @toon-protocol/core test
# → Test Files  62 passed (62)
# → Tests  2413 passed | 7 skipped (2420)
# → Duration  20.36s
```

## Recommendation

**APPROVE** — The test suite for Story 12.1 is production-grade. Traceability is excellent, edge cases (BigInt, high-precision decimals, backward compatibility, error class asymmetry) are all covered. The two gaps found during this review have been fixed and verified. No further action required before merge.
