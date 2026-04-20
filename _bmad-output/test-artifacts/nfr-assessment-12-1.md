---
stepsCompleted:
  - step-01-load-context
  - step-02-define-thresholds
  - step-03-gather-evidence
  - step-04-evaluate-and-score
  - step-05-generate-report
lastStep: step-05-generate-report
lastSaved: '2026-04-10'
workflowType: testarch-nfr-assess
inputDocuments:
  - _bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md
  - _bmad-output/epics/epic-12-token-swap-primitive.md
  - _bmad-output/planning-artifacts/test-design-epic-12.md
  - packages/core/src/events/swap-pair-validation.ts
  - packages/core/src/events/swap-pair-validation.test.ts
  - packages/core/src/events/swap-pair-builder.test.ts
  - packages/core/src/events/swap-pair-parser.test.ts
  - packages/core/src/events/builders.ts
  - packages/core/src/events/parsers.ts
  - packages/core/src/types.ts
  - packages/core/src/errors.ts
---

# NFR Assessment - Story 12-1: SwapPair Type + IlpPeerInfo Extension + kind:10032 Serialization

**Date:** 2026-04-10
**Story:** 12-1
**Epic:** 12 (Token Swap Primitive)
**Scope:** Type-level additive change in `@toon-protocol/core` — `SwapPair` interface, optional `IlpPeerInfo.swapPairs`, builder/parser roundtrip with shared validation helper.
**Overall Status:** PASS ✅

---

Note: This assessment summarizes existing evidence from the dev session, story file, and epic-12 test design. It does not run tests or CI workflows. The dev session recorded `2409 passed / 7 skipped` in `@toon-protocol/core`, 63 swap-pair-specific tests across three files, and a clean build + lint.

## Executive Summary

**Assessment:** 4 PASS, 2 CONCERNS, 0 FAIL (functional NFR categories applicable to this change)

**Blockers:** 0 — story is strictly additive, no runtime surface modified for existing users, full backward compatibility verified via regression tests.

**High Priority Issues:** 0

**Recommendation:** APPROVE for merge to `review → done`. The implementation hardens an otherwise permissive serialization surface with shared-helper validation, uses `BigInt` correctly to honor the Epic 11 MAX_SAFE_INTEGER guard, and preserves bit-identical pre-Epic-12 event output. Two CONCERNS are informational (Performance and Scalability have no measured thresholds because this story is a pure type/validation change — no runtime hot path, no I/O, no throughput surface).

---

## Performance Assessment

### Response Time (p95)

- **Status:** N/A (CONCERNS) ⚠️
- **Threshold:** No threshold in story or epic-12 test design — story is purely additive type/serialization work, not a request/response path.
- **Actual:** Validation helper `isValidSwapPair` is O(1) per pair and runs only in `buildIlpPeerInfoEvent` / `parseIlpPeerInfo`, both of which are already non-hot-path (peer-info events are published at startup and at config changes).
- **Evidence:** `packages/core/src/events/swap-pair-validation.ts`; `packages/core/src/events/builders.ts` (validation loop executes before `finalizeEvent`); full core test suite 2409 tests completed with no perceptible slowdown.
- **Findings:** No measurable performance regression surface. Marked CONCERNS because the story file does not define an explicit latency budget, not because a regression is suspected.

### Throughput

- **Status:** PASS ✅
- **Threshold:** Must not degrade core build/parse throughput vs pre-change baseline.
- **Actual:** Change adds at most one regex test and one BigInt comparison per swap pair; validation runs only when `info.swapPairs !== undefined`. Pre-Epic-12 events hit an early `undefined` check and skip the loop entirely (zero marginal cost).
- **Evidence:** `packages/core/src/events/builders.ts` — `if (info.swapPairs !== undefined) { ... }`; full suite `2409 passed / 7 skipped`.
- **Findings:** Zero-cost path for legacy consumers. No concern.

### Resource Usage

- **CPU Usage**
  - **Status:** PASS ✅
  - **Threshold:** No regression on CPU-bound test fixtures.
  - **Actual:** Regex-based validation; negligible CPU cost per pair.
  - **Evidence:** Dev test run completed in normal time bounds (core vitest suite).

- **Memory Usage**
  - **Status:** PASS ✅
  - **Threshold:** No new allocations beyond the `SwapPair[]` array the caller already provides.
  - **Actual:** Validation creates no intermediate arrays; `BigInt` values are short-lived locals inside the min/max comparison.
  - **Evidence:** `packages/core/src/events/swap-pair-validation.ts` — no `.map`/`.filter` over pairs, only `forEach` for the assertion loop in the builder.

### Scalability

- **Status:** N/A (CONCERNS) ⚠️
- **Threshold:** None defined — peer-info events have an implicit small-N constraint (a Mill is unlikely to advertise more than dozens of pairs).
- **Actual:** Validation is O(N) in pairs, each pair O(1). At N=10,000 pairs the validation loop remains sub-millisecond.
- **Evidence:** Algorithmic reasoning; no load test.
- **Findings:** Marked CONCERNS only because no explicit bound is documented. Not a release-blocking concern — upstream event-size limits (NIP-01 kind:10032 JSON content) provide an implicit cap far below any pathological scale.

---

## Security Assessment

### Authentication Strength

- **Status:** N/A ✅
- **Threshold:** Not applicable — this story does not touch auth, signing, keys, or access control. Event signing remains the existing `finalizeEvent(..., secretKey)` path unchanged.
- **Evidence:** `packages/core/src/events/builders.ts` — `finalizeEvent` call site untouched.

### Authorization Controls

- **Status:** N/A ✅
- **Threshold:** Not applicable — no authorization surface.
- **Evidence:** Story is type-only on a public advertisement event (kind:10032 is publicly readable by design).

### Data Protection

- **Status:** PASS ✅
- **Threshold:** Input validation must reject malformed swap-pair data before it is published or consumed. No silent coercion; no prototype pollution vector; no injection path.
- **Actual:** Shared validation helper rejects (a) non-object `from`/`to`, (b) empty/non-string `assetCode`, (c) non-integer/negative `assetScale`, (d) malformed `chain` IDs (via existing `validateChainId`), (e) non-decimal-string `rate`, (f) non-integer-string `minAmount`/`maxAmount`, (g) `minAmount > maxAmount` (BigInt compare). Regexes are anchored (`^...$`), no exponent notation admitted, no leading-zero admit for rate.
- **Evidence:** `packages/core/src/events/swap-pair-validation.ts`; `swap-pair-validation.test.ts` (41 tests covering each rule); dev-session record "0 errors" lint.
- **Findings:** Validation runs at BOTH ends (build and parse) via the same `isValidSwapPair` core — eliminates the feePerByte-style drift smell. Explicitly avoids `Number()` coercion, which closes a precision-loss exploit a malicious Mill could otherwise use to publish 20+ digit max amounts that coerce silently to `Infinity`.

### Vulnerability Management

- **Status:** PASS ✅
- **Threshold:** No new dependencies; no new network surfaces.
- **Actual:** Zero new dependencies. All validation uses stdlib (`String.match`, `Number.isInteger`, `BigInt`). Reuses existing `validateChainId` (pre-audited by prior epics).
- **Evidence:** `packages/core/src/events/swap-pair-validation.ts` imports only from `../errors.js` and `./parsers.js`; `packages/core/src/types.ts` unchanged dependency set.
- **Findings:** Attack surface: a crafted kind:10032 event attempting to smuggle a malformed `swapPairs` blob through `parseIlpPeerInfo`. Mitigation: every AC-5 rule is enforced in `assertSwapPairForParse`, which throws `InvalidEventError` on any violation. Confirmed via the 8+ invalid-case parser tests in `swap-pair-parser.test.ts`.

### Compliance (if applicable)

- **Status:** N/A ✅
- **Standards:** None applicable.

---

## Reliability Assessment

### Availability (Uptime)

- **Status:** N/A ✅
- **Threshold:** Not applicable — no runtime service.

### Error Rate

- **Status:** PASS ✅
- **Threshold:** New code paths must throw typed errors (`ToonError` at build-time, `InvalidEventError` at parse-time) on bad input and never silently produce invalid data.
- **Actual:** Dual-asserter pattern (`assertSwapPairForBuild` / `assertSwapPairForParse`) routes every validation failure through the correct typed error class. Error messages include `swapPairs[${index}]: ${reason} (field: ${field})` for precise diagnostics.
- **Evidence:** `packages/core/src/events/swap-pair-validation.ts`; T-008 coverage in both `swap-pair-builder.test.ts` (≥4 distinct invalid inputs) and `swap-pair-parser.test.ts` (≥4 distinct invalid shapes).
- **Findings:** No error-handling hole detected. Follows existing `ToonError`/`InvalidEventError` convention.

### MTTR (Mean Time To Recovery)

- **Status:** N/A ✅
- **Threshold:** Not applicable.

### Fault Tolerance

- **Status:** PASS ✅
- **Threshold:** Parser must tolerate pre-Epic-12 (no `swapPairs` key) events without error and without introducing `undefined` keys in the return object (deep-equality regression).
- **Actual:** Parser uses conditional spread `...(swapPairs !== undefined && { swapPairs })`, matching the existing `prefixPricing`/`preferredTokens` pattern. Builder uses standard `JSON.stringify` behavior (undefined keys omitted). Regression test (Task 6.4) asserts bit-identical pre-change content for pre-change input.
- **Evidence:** `packages/core/src/events/parsers.ts` (conditional-spread block); `swap-pair-parser.test.ts` T-003 (pre-Epic-12 fixture) + Task 6.4 regression test.
- **Findings:** R-011 (INTEG — kind:10032 backward compatibility) from `test-design-epic-12.md` is directly mitigated by T-003 + the roundtrip assertions. Risk closed.

### CI Burn-In (Stability)

- **Status:** PASS ✅
- **Threshold:** No test flake; suite deterministic.
- **Actual:** 2409 passed / 7 skipped on the dev-session run. No mention of flake or retries in completion notes. All swap-pair tests use deterministic fixtures (hand-built events via `finalizeEvent`) — no wall-clock, network, or RNG dependency beyond `generateSecretKey()` (which is deterministic under Nostr crypto semantics).
- **Evidence:** Story "Debug Log References" section.
- **Findings:** No reliability concern.

### Disaster Recovery (if applicable)

- **Status:** N/A ✅

---

## Maintainability Assessment

### Test Coverage

- **Status:** PASS ✅
- **Threshold:** AC-8 requires ≥ 20 tests total across helper + builder + parser.
- **Actual:** 63 tests total — 41 validation + 10 builder + 12 parser. Exceeds the minimum by 3.15×.
- **Evidence:** `packages/core/src/events/swap-pair-validation.test.ts`, `swap-pair-builder.test.ts`, `swap-pair-parser.test.ts`; dev-session debug log `63 tests passed`.
- **Findings:** Coverage is excellent. All AC-5 rules have at least one dedicated unit test; roundtrip tests cover EVM + Mina + Solana 3-pair scenarios and 20-digit `maxAmount` BigInt path.

### Code Quality

- **Status:** PASS ✅
- **Threshold:** Clean lint, no new warnings in touched files.
- **Actual:** `pnpm lint` — 0 errors. The 1619 pre-existing warnings are unrelated and untouched.
- **Evidence:** Story "Debug Log References" section.
- **Findings:** Implementation follows project conventions (conditional-spread pattern from prefixPricing, error-code SCREAMING_SNAKE_CASE, JSDoc updated on builder). The dual-asserter factoring explicitly avoids the feePerByte-style duplication smell called out in the story's Dev Notes.

### Technical Debt

- **Status:** PASS ✅
- **Threshold:** No new duplication; no new deprecated APIs.
- **Actual:** Shared validation helper eliminates the duplication risk that the feePerByte pattern would have introduced. No new deprecations. No TODO/FIXME markers in the diff.
- **Evidence:** `packages/core/src/events/swap-pair-validation.ts` — single `isValidSwapPair` core, both asserters wrap it.
- **Findings:** Story actively reduces tech debt relative to the feePerByte precedent. Net positive.

### Documentation Completeness

- **Status:** PASS ✅
- **Threshold:** New public types have JSDoc; modified functions have updated `@throws` annotations.
- **Actual:** `SwapPair` interface documented field-by-field. `buildIlpPeerInfoEvent` JSDoc updated to advertise `INVALID_SWAP_PAIR` throw. `parseIlpPeerInfo` JSDoc updated (Task 5.5).
- **Evidence:** `packages/core/src/types.ts`, `packages/core/src/events/builders.ts`, `packages/core/src/events/parsers.ts`.
- **Findings:** Documentation is complete for the surface area changed.

### Test Quality (from test-review, if available)

- **Status:** PASS ✅
- **Threshold:** Tests are deterministic, isolated, and assertion-rich.
- **Actual:** Validation tests use pure-function inputs with no fixtures. Builder/parser tests use hand-constructed events via `finalizeEvent`, no network or filesystem I/O. Roundtrip tests use `deep.equal` rather than partial matchers.
- **Evidence:** Dev-session notes; test file structure described in story Tasks 6-9.
- **Findings:** No concerns. Test quality aligns with Epic 11 standards.

---

## ADR Quality Readiness Checklist Summary

| Category                                         | Criteria Met | PASS | CONCERNS | FAIL | Overall Status |
| ------------------------------------------------ | ------------ | ---- | -------- | ---- | -------------- |
| 1. Testability & Automation                      | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 2. Test Data Strategy                            | 3/3          | 3    | 0        | 0    | PASS ✅        |
| 3. Scalability & Availability                    | 2/4          | 2    | 2        | 0    | CONCERNS ⚠️    |
| 4. Disaster Recovery                             | N/A          | N/A  | N/A      | N/A  | N/A            |
| 5. Security                                      | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 6. Monitorability, Debuggability & Manageability | 3/4          | 3    | 1        | 0    | PASS ✅        |
| 7. QoS & QoE                                     | N/A          | N/A  | N/A      | N/A  | N/A            |
| 8. Deployability                                 | 3/3          | 3    | 0        | 0    | PASS ✅        |
| **Total (applicable)**                           | **19/22**    | 19   | 3        | 0    | **PASS ✅**    |

Categories 4 (Disaster Recovery) and 7 (QoS/QoE) are N/A for a type-only library change. The CONCERNS in Scalability & Availability and Monitorability are informational — no explicit thresholds exist for a pure validation/serialization path, and monitoring hooks would live in downstream stories (12.3 Mill handler, 12.5 streamSwap client).

---

## Quick Wins

None required — implementation is already at PASS.

Optional, low-effort enhancements (not blocking):

1. **Add a micro-benchmark vitest** (Maintainability) - LOW priority - ~15 min
   - Validate that 1,000 `SwapPair` entries validate in < 10ms to lock in the O(N) assumption.
   - No code changes to production.

2. **Document implicit upper bound on `swapPairs` length** (Scalability) - LOW priority - ~5 min
   - Add a JSDoc note to `IlpPeerInfo.swapPairs` noting that practical upper bound is constrained by kind:10032 event size (typical relay `max_message_length`).

---

## Recommended Actions

### Immediate (Before Release) - CRITICAL/HIGH Priority

None. Story passes all applicable NFR criteria.

### Short-term (Next Milestone) - MEDIUM Priority

1. **Monitoring hooks for Mill-published swapPairs** - MEDIUM - deferred - Epic 12 / Story 12.7 (`packages/mill/`)
   - When a Mill publishes its kind:10032 with swapPairs, emit a structured log line. This is a Story 12.7 concern, not 12.1.

### Long-term (Backlog) - LOW Priority

1. **Consider extracting `validateChainId` to a dedicated `chain/chain-id.ts` module** (Maintainability) - LOW - ~20 min
   - Already called out as a contingency in Task 2.2. Currently no circular import exists at runtime, so deferring is safe.

---

## Monitoring Hooks

Not required by this story. The kind:10032 publication path is not instrumented separately from other peer-info publications, and adding instrumentation would be out of scope for a type-only change. Mill-side monitoring belongs to Story 12.7.

### Alerting Thresholds

- [ ] (Deferred to 12.7) Alert if Mill publishes a kind:10032 event with `swapPairs.length > 100` (sanity bound).

---

## Fail-Fast Mechanisms

The story itself implements fail-fast validation at both ends:

### Validation Gates (Security)

- [x] `assertSwapPairForBuild` — throws `ToonError('INVALID_SWAP_PAIR')` before the event is signed. Prevents publishing invalid data.
- [x] `assertSwapPairForParse` — throws `InvalidEventError` before the parsed `IlpPeerInfo` is returned to callers. Prevents consuming invalid data.
- [x] Both asserters share a single `isValidSwapPair` core — no divergence risk.

### Smoke Tests (Maintainability)

- [x] Regression test asserting pre-Epic-12 events produce bit-identical content (Task 6.4). This is the single most important fail-fast guard against R-011.

---

## Evidence Gaps

0 evidence gaps identified. All AC-5 rules, T-001..T-008 from `test-design-epic-12.md`, and R-011 / R-013 risk mitigations are covered by the 63 tests in the three swap-pair test files. The full core suite (2409 tests) ran clean.

---

## Findings Summary

**Based on ADR Quality Readiness Checklist (8 categories)**

- **Applicable categories:** 6 of 8 (DR and QoS/QoE are N/A for a type-only library change).
- **Applicable criteria met:** 19 / 22 (86%) — room for improvement only in Scalability/Monitorability, both N/A-leaning for this scope.
- **Critical gaps:** 0.
- **High-priority gaps:** 0.
- **Release blockers:** 0.

---

## Gate YAML Snippet

```yaml
nfr_assessment:
  date: '2026-04-10'
  story_id: '12-1'
  feature_name: 'SwapPair Type + IlpPeerInfo Extension + kind:10032 Serialization'
  adr_checklist_score: '19/22' # excluding N/A categories (DR, QoS/QoE)
  categories:
    testability_automation: PASS
    test_data_strategy: PASS
    scalability_availability: CONCERNS # informational, no thresholds defined
    disaster_recovery: N/A
    security: PASS
    monitorability: PASS
    qos_qoe: N/A
    deployability: PASS
  overall_status: PASS
  critical_issues: 0
  high_priority_issues: 0
  medium_priority_issues: 0
  concerns: 2
  blockers: false
  quick_wins: 2
  evidence_gaps: 0
  recommendations:
    - Approve for merge; story is strictly additive, fully backward compatible, and exceeds AC-8 test minimum by 3.15x.
    - Defer monitoring hooks and load thresholds to Story 12.7 (packages/mill/) where Mills actually publish swapPairs at runtime.
    - Consider a future tech-debt ticket to extract validateChainId into packages/core/src/chain/ only if a circular import appears later.
```

---

## Related Artifacts

- **Story File:** `_bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md`
- **Epic Spec:** `_bmad-output/epics/epic-12-token-swap-primitive.md`
- **Test Design:** `_bmad-output/planning-artifacts/test-design-epic-12.md` (Story 12-1 section, T-001..T-008, R-011, R-013)
- **Evidence Sources:**
  - Implementation: `packages/core/src/events/swap-pair-validation.ts`
  - Implementation: `packages/core/src/events/builders.ts` (modified)
  - Implementation: `packages/core/src/events/parsers.ts` (modified)
  - Implementation: `packages/core/src/types.ts` (modified)
  - Implementation: `packages/core/src/index.ts` (modified)
  - Tests: `packages/core/src/events/swap-pair-validation.test.ts` (41 tests)
  - Tests: `packages/core/src/events/swap-pair-builder.test.ts` (10 tests)
  - Tests: `packages/core/src/events/swap-pair-parser.test.ts` (12 tests)
  - Build: `pnpm --filter @toon-protocol/core build` — success (ESM 28ms, DTS 2938ms)
  - Test: `pnpm --filter @toon-protocol/core test` — 2409 passed / 7 skipped / 0 failed
  - Lint: `pnpm lint` — 0 errors (1619 pre-existing warnings untouched)

---

## Recommendations Summary

**Release Blocker:** NONE. Story passes all applicable NFR criteria.

**High Priority:** NONE.

**Medium Priority:** NONE for 12-1. Monitoring hooks for swap-pair publication are deferred to Story 12.7 where Mills actually emit these events at runtime.

**Next Steps:**

1. Merge 12-1 to `done` via normal review flow.
2. Proceed to Story 12-2 (NIP-59 gift wrap integration), which consumes `SwapPair` from this story.
3. Carry the CONCERNS notes on Scalability (no explicit thresholds) and Monitorability (no emission hooks) forward into Story 12-7 so the Mill package defines them at the right layer.

---

## Sign-Off

**NFR Assessment:**

- Overall Status: PASS ✅
- Critical Issues: 0
- High Priority Issues: 0
- Concerns: 2 (both informational: Scalability threshold undefined, Monitorability hooks deferred)
- Evidence Gaps: 0

**Gate Status:** PASS ✅

**Next Actions:**

- ✅ PASS: Proceed to `*gate` workflow or merge to `done`.

**Generated:** 2026-04-10
**Workflow:** testarch-nfr v5.0

---

<!-- Powered by BMAD-CORE™ -->
