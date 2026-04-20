---
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests', 'step-03-map-criteria', 'step-04-analyze-gaps', 'step-05-gate-decision']
lastStep: 'step-05-gate-decision'
lastSaved: '2026-04-13'
workflowType: 'testarch-trace'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md'
  - 'packages/mill/src/*.test.ts'
---

# Traceability Matrix & Gate Decision - Story 12.4

**Story:** Mill Inventory + Wallet Management — Multi-Chain `MultiChainClaimIssuer`
**Date:** 2026-04-13
**Evaluator:** TEA Agent (YOLO)
**Mode:** Deterministic gate, story-scope

---

## PHASE 1: REQUIREMENTS TRACEABILITY

### Coverage Summary

| Priority  | Total Criteria | FULL Coverage | Coverage % | Status       |
| --------- | -------------- | ------------- | ---------- | ------------ |
| P0 (ACs mapped as P0: 2, 3, 4, 6, 7, 8, 9, 10, 11) | 9 | 9 | 100% | PASS |
| P1 (ACs mapped as P1: 5) | 1 | 1 | 100% | PASS |
| P2 (ACs mapped as P2: 1, 12) | 2 | 2 | 100% (indirect) | PASS |
| P3        | 0              | 0             | n/a        | n/a          |
| **Total** | **12**         | **12**        | **100%**   | **PASS**     |

**Legend:** PASS = meets gate threshold; WARN = below threshold; FAIL = blocker.

---

### Detailed Mapping

#### AC-1: `packages/mill/` TypeScript package initialized (P2 — infrastructure)

- **Coverage:** FULL (indirect — validated by build + exports test)
- **Tests:**
  - `packages/mill/src/index.test.ts:11-51` — 10 export assertions require compiled ESM package surface, transitively validates `package.json` / `tsconfig.json` / `tsup.config.ts` wiring.
  - `pnpm --filter @toon-protocol/mill build` — greenlight per Dev Agent Record: `dist/index.js 16.74 KB`, `dist/index.d.ts 8.68 KB`.
- **Gaps:** None that block story scope. README deferred to Story 12.9 as noted in AC-1.
- **Recommendation:** Accept. Infrastructure ACs are exercised by build + lint checks, not unit tests.

#### AC-2: `MillInventoryError` + `MillWalletError` error classes (P0)

- **Coverage:** FULL
- **Tests:**
  - `packages/mill/src/errors.test.ts:17` — Error subclass + name
  - `errors.test.ts:24` — `INSUFFICIENT_INVENTORY` code literal pinned (load-bearing for Story 12.3 handler)
  - `errors.test.ts:33` — `UNKNOWN_PAIR` code literal
  - `errors.test.ts:41` — `INVENTORY_NOT_INITIALIZED` literal
  - `errors.test.ts:49` + `:82` — ES2022 `cause` preserved
  - `errors.test.ts:61` — `MillWalletError` subclass/name
  - `errors.test.ts:68` — all five wallet-error code literals (`INVALID_MNEMONIC`, `UNSUPPORTED_CHAIN`, `DERIVATION_FAILED`, `SIGNING_FAILED`, `INVALID_CONFIG`)
- **Gaps:** None.

#### AC-3: `deriveMillKeys(mnemonic, chains)` pure helper (P0)

- **Coverage:** FULL
- **Tests:**
  - `wallet.test.ts:19` **(T-029)** EVM account-idx-2 ≠ account-idx-1 (golden-vector mnemonic pinned)
  - `wallet.test.ts:44` default `accountIndex = 2` per D12-011
  - `wallet.test.ts:52` 0x-prefixed 20-byte EIP-55 address
  - `wallet.test.ts:65` **(T-030)** Mina account-idx isolation
  - `wallet.test.ts:86` **(T-031)** Solana SLIP-0010 all-hardened path isolation
  - `wallet.test.ts:114` **(T-032)** Determinism across 3 sequential calls
  - `wallet.test.ts:137` `INVALID_MNEMONIC` throw
  - `wallet.test.ts:149` empty-chains no-op
  - `wallet.test.ts:159` passphrase isolation
  - `wallet.test.ts:172` multi-chain derivation in one call
  - `wallet.test.ts:184` / `:202` addressIndex override (EVM + Mina)
  - `wallet.test.ts:222` Mina key shape (string priv + pub + coin-type-12586 path)
  - `wallet.test.ts:237` `MillWalletError` cause option
- **Gaps:** Mina branch emits a sha3-derived identifier when peer absent (documented deviation); golden-vector Mina pubkey is NOT pinned against a canonical base58 encoding — deferred to Story 12.8 E2E per Dev Notes.
- **Recommendation:** Accept. Deviation is documented and scope-appropriate.

#### AC-4: `MillInventory` in-memory per-pair reserves + debit/credit (P0)

- **Coverage:** FULL
- **Tests:**
  - `inventory.test.ts:14` **(T-033)** debit decreases available; total preserved
  - `inventory.test.ts:35` **(T-034)** INSUFFICIENT_INVENTORY + transactional state
  - `inventory.test.ts:60` **(T-037)** credit raises available + total
  - `inventory.test.ts:77` INVENTORY_NOT_INITIALIZED
  - `inventory.test.ts:88` **(T-inv-1)** concurrent-debit race resolves deterministically
  - `inventory.test.ts:119` non-positive debit throws INSUFFICIENT_INVENTORY
  - `inventory.test.ts:137` snapshot deep-copy
  - `inventory.test.ts:158` credit CREATES missing entry
  - `inventory.test.ts:170` credit non-positive throws `UNKNOWN_PAIR` (Pass #3 finding; explicitly NOT `INSUFFICIENT_INVENTORY`, must not map to ILP T04)
  - `inventory.test.ts:197` get() null for unknown
  - `inventory.test.ts:202` custom clock
  - `inventory.test.ts:231` colon-containing chain keys
- **Gaps:** None.

#### AC-5: `PaymentChannelSigner` interface + three chain signers (P1)

- **Coverage:** FULL (with one documented peer-dep skip)
- **Tests:**
  - `payment-channel-signer.test.ts:34` **(T-035)** EVM sign → recoverable public key → derived address (round-trip)
  - `payment-channel-signer.test.ts:122` EVM malformed recipient → `SIGNING_FAILED`
  - `payment-channel-signer.test.ts:151` Mina signFields round-trip (skipIf no peer)
  - `payment-channel-signer.test.ts:177` Solana 64-byte Ed25519 signature
  - `payment-channel-signer.test.ts:199` Solana cryptographic verify round-trip
  - `payment-channel-signer.test.ts:266` chain / chainKind getters
  - `payment-channel-signer.test.ts:281` / `:298` defensive 32-byte privateKey rejection (EVM + Solana)
  - `payment-channel-signer.test.ts:319` Mina signer construction without peer
- **Gaps:** Mina round-trip with real peer gated behind `describe.skipIf(!hasMinaSigner)` — documented as Story 12.8 E2E follow-up per AC-11.
- **Recommendation:** Accept. Skip is structural (peer dep gating), not a coverage hole.

#### AC-6: `MultiChainClaimIssuer` implementing `ClaimIssuer` (P0)

- **Coverage:** FULL
- **Tests:**
  - `claim-issuer.test.ts:54` happy path (debit → sign → `{ claim, claimId }`)
  - `claim-issuer.test.ts:90` debit BEFORE first await (ordering spy)
  - `claim-issuer.test.ts:133` insufficient inventory → signer NOT called
  - `claim-issuer.test.ts:171` UNSUPPORTED_CHAIN → inventory NOT debited
  - `claim-issuer.test.ts:199` signer throw → inventory credit rollback + `SIGNING_FAILED`
  - `claim-issuer.test.ts:310` custom `newClaimId` generator
  - `claim-issuer.test.ts:354` signer failure also rolls back channel-state reservation
  - `claim-issuer.test.ts:404` default UUID claimId non-empty
- **Gaps:** None.

#### AC-7: `MillChannelState` per-channel nonce + cumulativeAmount (P0)

- **Coverage:** FULL
- **Tests:**
  - `channel-state.test.ts:31` reserve increments nonce + cumulativeAmount atomically
  - `channel-state.test.ts:44` missing channel → `UNSUPPORTED_CHAIN`
  - `channel-state.test.ts:55` release reverses last reservation
  - `channel-state.test.ts:64` **(T-cs-1)** concurrent reserve distinct monotonic nonces
  - `channel-state.test.ts:88`/`:93` get() null + copy-on-read
  - `channel-state.test.ts:104`/`:111`/`:120` release no-op paths
  - `channel-state.test.ts:131` custom clock
  - `channel-state.test.ts:154`/`:181` release warn-log paths (Pass #3 additions)
- **Gaps:** None.

#### AC-8: Concurrent-safety under `Promise.all` (P0)

- **Coverage:** FULL
- **Tests:**
  - `claim-issuer.test.ts:242` **(T-026)** 10 concurrent `issueClaim` → distinct claimIds, monotonic nonces, cumulativeAmount = Σ(targetAmount)
  - Supporting: `inventory.test.ts:88` (T-inv-1), `channel-state.test.ts:64` (T-cs-1)
- **Gaps:** None. Microtask-atomicity argument validated at three layers (inventory, channel-state, issuer).

#### AC-9: Package exports (P0)

- **Coverage:** FULL
- **Tests:**
  - `index.test.ts:12-48` — 9 positive exports + 1 negative (no `startMill` in 12.4 scope)
- **Gaps:** None.

#### AC-10: Structural compatibility with Story 12.3 `ClaimIssuer` (P0)

- **Coverage:** FULL
- **Tests:**
  - `claim-issuer.test.ts:297` `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` type assignability
  - `claim-issuer.test.ts:436` **(T-int-1)** `createSwapHandler({ claimIssuer: new MultiChainClaimIssuer(...) })` accepts the instance (structural integration)
- **Gaps:** Full gift-wrap → handler → issuer round-trip deferred to Story 12.8 Docker E2E (explicitly called out in Dev Notes).
- **Recommendation:** Accept. The deferred portion is legitimately out of unit-test scope.

#### AC-11: Unit tests (≥ 26) (P0)

- **Coverage:** FULL (76 tests per `it()` count across 7 test files; 75 passing + 1 skipped per Dev Agent Record).
- **Tests:** All T-029/T-030/T-031/T-032/T-033/T-034/T-035/T-037/T-inv-1/T-cs-1/T-026/T-int-1 mappings present and linked above.
- **Gaps:** None.

#### AC-12: Build, lint, test verification (P2 — verification)

- **Coverage:** FULL (verified by Dev Agent Record)
- **Evidence:**
  - `pnpm --filter @toon-protocol/mill build` → 0 errors
  - `pnpm --filter @toon-protocol/mill test` → 75 passed | 1 skipped
  - `pnpm --filter @toon-protocol/sdk test` → 527 passed (baseline unchanged)
  - `pnpm --filter @toon-protocol/core test` → 2418 passed | 7 skipped (baseline unchanged)
  - `npx eslint packages/mill/src` → 0 errors
- **Gaps:** None.

---

### Gap Analysis

#### Critical Gaps (BLOCKER)

**0 gaps found.**

#### High Priority Gaps (PR BLOCKER)

**0 gaps found.** Two scope-appropriate deferrals (Mina real-peer round-trip, full handler gift-wrap E2E) are explicitly routed to Story 12.8 per Dev Notes and were sanctioned at story-creation time.

#### Medium Priority Gaps (Nightly)

**0 gaps found.**

#### Low Priority Gaps (Optional)

1. **Mina canonical base58 pubkey pin** — tests only assert path + idx-isolation, not a known golden Mina address. Would require adopting `mina-signer` as a non-optional dev dep. Track for Story 12.8.
2. **MAX-value nonce test** — the 2^63-1 nonce overflow check is explicitly called out as "nice-to-have; not required" in Dev Notes and not implemented. Low residual risk (BigInt arithmetic is exact).

---

### Coverage Heuristics Findings

- **Endpoint coverage:** n/a — no HTTP endpoints.
- **Auth/authz negatives:** n/a — no auth surface.
- **Happy-path-only criteria:** None. Every AC with error codes has explicit negative-path tests (`INSUFFICIENT_INVENTORY`, `UNSUPPORTED_CHAIN`, `INVALID_MNEMONIC`, `SIGNING_FAILED`, `INVALID_CONFIG`, `INVENTORY_NOT_INITIALIZED`, `UNKNOWN_PAIR`, `DERIVATION_FAILED`).

---

### Quality Assessment

#### Tests with Issues

- **BLOCKER:** None.
- **WARNING:** None.
- **INFO:** None.

#### Tests Passing Quality Gates

**76/76 test entries (100%) follow the repo's describe/it + AC-ID + [P0/P1/P2] priority-tag convention.** 75 pass; 1 intentionally gated skip (Mina peer-dep).

### Duplicate Coverage Analysis

- **Acceptable overlap (defense in depth):**
  - AC-8 concurrent-safety is validated at three layers (inventory T-inv-1, channel-state T-cs-1, issuer T-026) — this is intentional per the microtask atomicity argument.
  - `INSUFFICIENT_INVENTORY` surfaced both in `inventory.test.ts` and `claim-issuer.test.ts` (unit + integration boundary).
- **Unacceptable duplication:** None.

### Coverage by Test Level

| Test Level | Tests | Criteria Covered | Coverage % |
| ---------- | ----- | ---------------- | ---------- |
| Unit       | 75    | 12/12            | 100%       |
| Integration (structural) | 1 (T-int-1) | AC-10 | 100% |
| E2E        | 0 (deferred to Story 12.8) | n/a | n/a |
| **Total**  | **76** | **12**         | **100%**   |

### Traceability Recommendations

**Immediate Actions (Before PR Merge):** None. All critical and high-priority ACs are covered.

**Short-term Actions (This Milestone / Epic 12):**

1. Story 12.8 E2E — enable `mina-signer` peer in Docker infra and flip the `describe.skipIf(!hasMinaSigner)` gate; pin canonical Mina base58 pubkey as golden vector.
2. Story 12.8 E2E — exercise full NIP-59 gift-wrap → handler → `MultiChainClaimIssuer` → FULFILL round-trip against real Anvil + mock Solana/Mina providers.

**Long-term Actions (Backlog):**

1. Add 2^63-1 nonce overflow unit test to `payment-channel-signer.test.ts` when time permits (nice-to-have).

---

## PHASE 2: QUALITY GATE DECISION

**Gate Type:** story
**Decision Mode:** deterministic

### Evidence Summary

#### Test Execution Results

- **Total Tests:** 76 (mill only; 3020 workspace-wide including sdk+core baselines)
- **Passed:** 75 (98.7%)
- **Failed:** 0
- **Skipped:** 1 (Mina peer-dep gated — intentional)
- **Duration:** not pinned in artifact; `pnpm --filter` runtime historically <5s for mill.

**Priority Breakdown (mill package):**

- **P0 Tests:** all pass (structural — 9 of 12 ACs are P0, each has at least one `[P0]`-tagged it())
- **P1 Tests:** all pass (except 1 peer-gated skip, not a failure)
- **P2 Tests:** all pass

**Overall Pass Rate:** 98.7% (skip not counted as failure)

**Test Results Source:** Dev Agent Record (in implementation artifact, lines 614-618) + tree of it() blocks verified in this run.

#### Coverage Summary (from Phase 1)

- **P0 Acceptance Criteria:** 9/9 covered (100%) ✅
- **P1 Acceptance Criteria:** 1/1 covered (100%) ✅
- **P2 Acceptance Criteria:** 2/2 covered (100%, indirect via build+export test) ✅
- **Overall Coverage:** 100%

**Code Coverage:** Not captured in this run (per-file coverage run disabled workspace-wide per CLAUDE.md OOM warning). Existing unit-level breadth is high (76 tests / 7 source files ≈ 10.9 tests/file).

#### Non-Functional Requirements (NFRs)

- **Security:** PASS ✅ — 0 Critical / 0 High across 3 adversarial review passes; Pass #3 includes a clean `semgrep --config=auto` scan (0 findings). No raw private-key logging; error messages do not leak mnemonic/key material; dynamic Mina peer import uses hardcoded specifier (no injection).
- **Performance:** PASS ✅ — all mutation paths are synchronous microtask-atomic bigint ops; no network / disk I/O; 10-way Promise.all integration test bounded and passing.
- **Reliability:** PASS ✅ — transactional debit, rollback on signer failure, release warn-logging on underflow. Three code-review passes hardened failure paths.
- **Maintainability:** PASS ✅ — 0 eslint errors; 98 warnings all pre-existing test-file non-null assertions; file sizes modest (max 494 lines in claim-issuer.test.ts).

**NFR Source:** Implementation artifact code review passes #1–#3 (2026-04-13).

#### Flakiness Validation

Burn-in not performed as part of this workflow; however, all tests use deterministic golden-vector mnemonics and microtask-atomic operations (no timing-dependent assertions, no sleeps, no real I/O). Flake risk is structurally low.

### Decision Criteria Evaluation

#### P0 Criteria (Must ALL Pass)

| Criterion             | Threshold | Actual   | Status |
| --------------------- | --------- | -------- | ------ |
| P0 Coverage           | 100%      | 100%     | ✅ PASS |
| P0 Test Pass Rate     | 100%      | 100%     | ✅ PASS |
| Security Issues       | 0         | 0        | ✅ PASS |
| Critical NFR Failures | 0         | 0        | ✅ PASS |
| Flaky Tests           | 0         | 0 (struct.) | ✅ PASS |

**P0 Evaluation:** ✅ ALL PASS

#### P1 Criteria

| Criterion              | Threshold | Actual | Status |
| ---------------------- | --------- | ------ | ------ |
| P1 Coverage            | ≥90%      | 100%   | ✅ PASS |
| P1 Test Pass Rate      | ≥95%      | 100%   | ✅ PASS |
| Overall Test Pass Rate | ≥95%      | 98.7%  | ✅ PASS |
| Overall Coverage       | ≥85%      | 100%   | ✅ PASS |

**P1 Evaluation:** ✅ ALL PASS

### GATE DECISION: **PASS** ✅

### Rationale

All 12 acceptance criteria have explicit, test-file-mapped coverage. All 75 active tests pass; the single skipped test is a structurally-gated Mina peer-dep skip that is explicitly sanctioned in AC-11 and Dev Notes as a Story 12.8 E2E follow-up (not a gap). Three adversarial code-review passes (Critical/High/Medium/Low) are fully resolved with no outstanding action items, and a `semgrep` OWASP scan returned 0 findings. SDK (527) and core (2418) test baselines are unchanged, confirming no incidental regressions. Build, lint, and exports-surface assertions are all green. The story status `done` in the implementation artifact is consistent with the evidence.

### Residual Risks

1. **Mina canonical pubkey not golden-pinned** — Priority P2 / Probability Low / Impact Low — Mitigation: real round-trip verify will be exercised in Story 12.8 Docker E2E with the `mina-signer` peer installed.
2. **2^63-1 nonce overflow test absent** — Priority P3 / Probability Very Low / Impact Low — BigInt arithmetic is exact by language spec; nice-to-have only.

**Overall Residual Risk:** LOW

### Gate Recommendations

1. **Proceed — story is PR-mergeable and deploy-ready for Epic 12 downstream stories (12.5, 12.7, 12.8).**
2. **Feed Mina real-peer round-trip and full handler E2E into Story 12.8 test design** — already captured in Dev Notes.

### Next Steps

**Immediate (next 24–48h):**

1. Close Story 12.4 in sprint status; advance to Story 12.5 (`streamSwap()` sender API) or Story 12.7 (`startMill()` scaffold) per epic sequencing.

**Follow-up (Epic 12 remainder):**

1. Story 12.8 E2E brings up `mina-signer` peer + real chain channels, converting the currently-skipped Mina round-trip test into an always-running E2E.

**Stakeholder Communication:** Notify SM and DEV lead that Story 12.4 gate is PASS with zero blockers.

## Integrated YAML Snippet (CI/CD)

```yaml
traceability_and_gate:
  traceability:
    story_id: '12-4'
    date: '2026-04-13'
    coverage:
      overall: 100
      p0: 100
      p1: 100
      p2: 100
      p3: 0
    gaps:
      critical: 0
      high: 0
      medium: 0
      low: 2
    quality:
      passing_tests: 75
      total_tests: 76
      blocker_issues: 0
      warning_issues: 0
    recommendations:
      - 'Advance to Story 12.5 / 12.7; no pre-merge blockers'
      - 'Story 12.8 should un-skip Mina round-trip and pin canonical Mina pubkey'
  gate_decision:
    decision: 'PASS'
    gate_type: 'story'
    decision_mode: 'deterministic'
    criteria:
      p0_coverage: 100
      p0_pass_rate: 100
      p1_coverage: 100
      p1_pass_rate: 100
      overall_pass_rate: 98.7
      overall_coverage: 100
      security_issues: 0
      critical_nfrs_fail: 0
      flaky_tests: 0
    thresholds:
      min_p0_coverage: 100
      min_p0_pass_rate: 100
      min_p1_coverage: 90
      min_p1_pass_rate: 95
      min_overall_pass_rate: 95
      min_coverage: 85
    evidence:
      test_results: 'Dev Agent Record — 12-4-mill-inventory-and-wallet-management.md lines 614–618'
      traceability: '_bmad-output/test-artifacts/traceability/story-12-4-trace.md'
      nfr_assessment: '_bmad-output/test-artifacts/nfr-assessment-12-4.md'
      code_coverage: 'not_captured (workspace OOM policy)'
    next_steps: 'Proceed to Story 12.5 / 12.7; Story 12.8 absorbs Mina + full E2E round-trip.'
```

## Related Artifacts

- **Story File:** `_bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md`
- **Test Design:** `_bmad-output/planning-artifacts/test-design-epic-12.md` (T-029..T-037)
- **NFR Assessment:** `_bmad-output/test-artifacts/nfr-assessment-12-4.md`
- **Test Files:** `packages/mill/src/*.test.ts` (7 files, 76 it() blocks)
- **Source Files:** `packages/mill/src/{errors,wallet,inventory,channel-state,payment-channel-signer,claim-issuer,index}.ts`

## Sign-Off

**Phase 1 — Traceability Assessment:**

- Overall Coverage: 100%
- P0 Coverage: 100% PASS
- P1 Coverage: 100% PASS
- Critical Gaps: 0
- High Priority Gaps: 0

**Phase 2 — Gate Decision:**

- **Decision:** PASS ✅
- **P0 Evaluation:** ✅ ALL PASS
- **P1 Evaluation:** ✅ ALL PASS

**Overall Status:** PASS ✅

**Generated:** 2026-04-13
**Workflow:** testarch-trace v5.0 (step-file architecture)

<!-- Powered by BMAD-CORE™ -->
