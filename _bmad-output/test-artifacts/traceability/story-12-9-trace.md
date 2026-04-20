---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03-map-criteria',
    'step-04-analyze-gaps',
    'step-05-gate-decision',
  ]
lastStep: 'step-05-gate-decision'
lastSaved: '2026-04-14'
workflowType: 'testarch-trace'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md'
---

# Traceability Matrix & Gate Decision — Story 12.9

**Story:** Sender-provided chain recipient threading (defect remediation)
**Date:** 2026-04-14
**Evaluator:** TEA Agent (yolo mode)
**Story file:** `_bmad-output/implementation-artifacts/12-9-sender-chain-recipient-threading.md`

---

## PHASE 1: REQUIREMENTS TRACEABILITY

### Coverage Summary

| Priority  | Total Criteria | FULL Coverage | Coverage % | Status    |
| --------- | -------------- | ------------- | ---------- | --------- |
| P0        | 10             | 10            | 100%       | ✅ PASS   |
| P1        | 6              | 6             | 100%       | ✅ PASS   |
| P2        | 1              | 1             | 100%       | ✅ PASS   |
| P3        | 0              | 0             | 100%       | ✅ PASS   |
| **Total** | **17**         | **17**        | **100%**   | **✅ PASS** |

Priority assignments (TEA):
- **P0 (must cover):** AC-1, AC-2, AC-4, AC-6, AC-8, AC-10, AC-11, AC-13, AC-14, AC-16
- **P1:** AC-5, AC-7, AC-9, AC-12, AC-15, AC-17
- **P2:** AC-3

---

### Detailed Mapping

#### AC-1: kind:20032 rumor carries REQUIRED `chain-recipient` tag; missing → T00 (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - `T-3` (sender) — `packages/sdk/src/stream-swap.test.ts:2066` — rumor tag emitted on every packet
  - `T-5` (handler) — `packages/sdk/src/swap-handler.test.ts:1198` — missing tag → `ctx.reject('T00')`

#### AC-2: Per-chain format validation at sender / handler / claim-issuer (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - Sender: `T-2a/T-2b/T-2c/T-2d` — `stream-swap.test.ts:1953/1963/1984/2011` (EVM, Solana, Mina, unknown)
  - Handler: `T-6a/T-6b/T-6c` — `swap-handler.test.ts:1216/1230/1253`
  - Claim issuer: `T-14` — `claim-issuer.test.ts:856` (third-tier pre-debit reject)

#### AC-3: Tag parsing by name, ordering-independent (P2)

- **Coverage:** FULL ✅
- **Tests:** `T-7 (AC-3)` — `swap-handler.test.ts:1298` (tag order shuffled, still parses)

#### AC-4: `StreamSwapParams.chainRecipient` REQUIRED; TS compile-time + runtime guard (P0)

- **Coverage:** FULL ✅
- **Tests:** `T-1` — `stream-swap.test.ts:1941` (missing field → throws); `T-8` compile-time type shape at `swap-handler.test.ts:1324`.

#### AC-5: `streamSwap()` validates `chainRecipient` BEFORE sending any packet (P1)

- **Coverage:** FULL ✅
- **Tests:** `T-2a/T-2b/T-2c` — `stream-swap.test.ts:1953/1963/1984` (rejects with `INVALID_CHAIN_RECIPIENT` pre-send).

#### AC-6: `buildSwapRumor()` emits `chain-recipient` on EVERY packet, no transformation (P0)

- **Coverage:** FULL ✅
- **Tests:** `T-3` — `stream-swap.test.ts:2066` — asserts tag on every rumor with exact equality.

#### AC-7: FULFILL recipient echo equality; mismatch → `MILL_RECIPIENT_MISMATCH` (P1)

- **Coverage:** FULL ✅
- **Tests:** `T-4` — `stream-swap.test.ts:2087` — injected mismatched Mill recipient produces per-packet rejection with code `MILL_RECIPIENT_MISMATCH`.

#### AC-8: Handler extracts + validates `chain-recipient`, T00 on missing/malformed (P0)

- **Coverage:** FULL ✅
- **Tests:** `T-5`, `T-6a`, `T-6b`, `T-6c` — `swap-handler.test.ts:1198–1272`.

#### AC-9: Handler threads validated `chainRecipient` into `ClaimIssuer.issueClaim()` (P1)

- **Coverage:** FULL ✅
- **Tests:** `T-7` — `swap-handler.test.ts:1280` — spies on `issueClaim`, asserts `params.chainRecipient` matches rumor value.

#### AC-10: `IssueClaimParams.chainRecipient` REQUIRED; `senderPubkey` retained (P0)

- **Coverage:** FULL ✅
- **Tests:** `T-8` compile-time shape — `swap-handler.test.ts:1324`; reinforced by `T-7`, and by Mill `T-10–T-13`.

#### AC-11: `MultiChainClaimIssuer.issueClaim()` passes `chainRecipient` (not `senderPubkey`) to `signer.signBalanceProof()` (P0)

- **Coverage:** FULL ✅
- **Tests:** `T-10` — `claim-issuer.test.ts:766` — signer spy asserts received 20-byte `chainRecipient`, NOT 32-byte `senderPubkey`.

#### AC-12: `IssueClaimResult.recipient` echoes `chainRecipient` (P1)

- **Coverage:** FULL ✅
- **Tests:** `T-11` — `claim-issuer.test.ts:787`; also asserted in Story 12.6 AC-3 settlement-field tests (updated to new contract).

#### AC-13: SDK stream-swap unit tests — (a) missing field, (b) per-chain format, (c) rumor-tag emission (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - AC-13a: `T-1` — `stream-swap.test.ts:1941`
  - AC-13b: `T-2a/2b/2c/2d` — per chain family
  - AC-13c: `T-3` — rumor round-trip on every packet

#### AC-14: SDK swap-handler unit tests — (a) missing tag, (b) malformed-per-chain, (c) happy-path threading (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - AC-14a: `T-5`
  - AC-14b: `T-6a`, `T-6b`, `T-6c`
  - AC-14c: `T-7`

#### AC-15: NIP-59 wrap→TOON→decode→unwrap round-trip preserves `chain-recipient` (P1)

- **Coverage:** FULL ✅
- **Tests:** `packages/sdk/src/gift-wrap.test.ts:855` — AC-15 regression-guard round-trip.

#### AC-16: Mill claim-issuer unit tests — (a) signer receives 20-byte recipient, (b) result echoes, (c) rollback semantics unchanged (P0)

- **Coverage:** FULL ✅
- **Tests:**
  - AC-16a: `T-10` — `claim-issuer.test.ts:766`
  - AC-16b: `T-11` — `claim-issuer.test.ts:787`
  - AC-16c: `T-12` — `claim-issuer.test.ts:801` (signer-throw still releases reserve / re-credits inventory)
  - Supplementary: `T-13` (keying invariant) — `claim-issuer.test.ts:834`; `T-14` (pre-debit reject) — `:856`

#### AC-17: Story 12.8 `it.skip(SCHEMA_BLOCKER, …)` blocks remain skipped; messages updated with 12.9 resolution pointer (P1)

- **Coverage:** FULL ✅ (guardrail-by-inspection)
- **Evidence:**
  - `packages/mill/tests/integration/swap-flow.integration.test.ts:200` — blocker message updated with `[BLOCKED — fixed in Story 12.9; re-enable is Story 12.8's job]`.
  - `packages/mill/tests/integration/swap-flow-anvil.integration.test.ts:50` — same pattern; `it.skip` preserved.

---

### Gap Analysis

#### Critical Gaps (BLOCKER) ❌

**0 gaps.**

#### High Priority Gaps (PR BLOCKER) ⚠️

**0 gaps.**

#### Medium Priority Gaps (Nightly) ⚠️

**0 gaps.**

#### Low Priority Gaps (Optional) ℹ️

**0 gaps.**

---

### Coverage Heuristics Findings

- **Endpoint Coverage Gaps:** N/A — story is protocol-schema + in-process type-contract work; no HTTP endpoints added. Wire boundaries (rumor tag, `IssueClaimParams`, `signer.signBalanceProof`) are each exercised by direct unit tests.
- **Auth/Authz Negative-Path Gaps:** 0. Adjacent security posture is validated by Review Pass #3 OWASP A07/A08 audit; `senderPubkey`→channel sticky binding regression-guarded by `T-13`; Mill-side substitution detection covered by `T-4` (`MILL_RECIPIENT_MISMATCH`).
- **Happy-Path-Only Criteria:** 0. Every AC with a validation/error axis has an explicit negative-path test (missing tag, malformed per chain, wrong recipient echo, signer-throw rollback, pre-debit reject).

---

### Quality Assessment

- **SDK suite:** 679/679 pass (33 files, ~26s). +9 new 12.9 tests + 1 gift-wrap AC-15 round-trip.
- **Mill suite:** 155/156 pass (+1 from T-14; 1 pre-existing skip in `payment-channel-signer.test.ts`). +4 new 12.9 tests.
- **Integration suites (12.8):** `it.skip` with updated pointer messages — per guardrail 8.1.

No BLOCKER or WARNING quality issues surfaced. All new tests follow Given-When-Then structure via descriptive `it(...)` titles carrying AC refs.

---

### Coverage by Test Level

| Test Level | Tests                                          | Criteria Covered         | Coverage %       |
| ---------- | ---------------------------------------------- | ------------------------ | ---------------- |
| E2E        | 0 (AC-17: integration remains skipped per 8.1) | 0 direct, 1 (AC-17) meta | n/a              |
| API        | 0                                              | 0                        | n/a              |
| Component  | 0                                              | 0                        | n/a              |
| Unit       | 14 new (T-1..T-14) + sweep of ~50 existing     | 17/17                    | 100%             |
| **Total**  | **14 new + accommodation sweep**               | **17/17**                | **100%**         |

Unit-only coverage is **correct and intentional** for Story 12.9 per AC-17 / guardrail 8.1: "12.9's proof-of-done-ness lives at the unit-test boundary only." Re-enabling Story 12.8's integration tests is Story 12.8's responsibility (explicit scope boundary).

---

### Traceability Recommendations

#### Immediate Actions (Before PR Merge)

1. **None.** Story is already at Status: done (Review Pass #3 final); all ACs fully covered.

#### Short-term Actions (This Milestone)

1. **Unblock Story 12.8** — Now that 12.9 ships, 12.8's `it.skip(SCHEMA_BLOCKER, …)` blocks can be re-enabled (AC-3/4/5/6/7/8/9/12 in 12.8). This is 12.8's task, not a 12.9 remediation.

#### Long-term Actions (Backlog)

1. **Epic 13 (Chain Bridge) propagation** — Any new chain signer added downstream inherits the three-tier `chainRecipient` validation contract. Claim-issuer `validateClaimIssuerChainRecipient` is the extension point.

---

## PHASE 2: QUALITY GATE DECISION

**Gate Type:** story
**Decision Mode:** deterministic

### Evidence Summary

- **Total Tests (new + swept):** 14 new (T-1..T-14) plus ~50 accommodation-swept callsites.
- **Passed:** SDK 679/679; Mill 155/156 (1 pre-existing unrelated skip).
- **Requirements Coverage:** P0 100%, P1 100%, P2 100%, Overall 100%.
- **Three review passes completed** (Change Log v1.1, v1.2, v1.3). Final pass added T-14 to close a low-severity gap (claim-issuer-tier malformed reject previously only transitively covered).

### Decision Criteria Evaluation

| Criterion             | Threshold | Actual       | Status    |
| --------------------- | --------- | ------------ | --------- |
| P0 Coverage           | 100%      | 100% (10/10) | ✅ PASS   |
| P0 Test Pass Rate     | 100%      | 100%         | ✅ PASS   |
| Security Issues       | 0         | 0 (OWASP pass-#3 posture check clean) | ✅ PASS |
| Flaky Tests           | 0         | 0            | ✅ PASS   |
| P1 Coverage           | ≥90%      | 100% (6/6)   | ✅ PASS   |
| Overall Coverage      | ≥80%      | 100% (17/17) | ✅ PASS   |
| Overall Pass Rate     | ≥95%      | ~99.9%       | ✅ PASS   |

### GATE DECISION: ✅ PASS

### Rationale

All 17 acceptance criteria have full unit-test coverage with explicit AC↔test ID mapping (T-1..T-14). The three-tier AC-2 validation (sender/handler/claim-issuer) is separately exercised by `T-2*`, `T-6*`, and `T-14`. The two-layer addressing fix (AC-10/11/12) is pinned by `T-8` (type shape), `T-10` (signer byte length), `T-11` (result echo), and `T-13` (regression guard that inventory/channel stay keyed on `senderPubkey`). AC-15 NIP-59 round-trip and AC-7 FULFILL equality check close the remaining schema-transit and integrity axes. AC-17 is satisfied by preserved `it.skip` markers with updated resolution pointers. SDK 679/679 and Mill 155/156 green. Review Pass #3 OWASP posture check clean (A03/A04/A07/A08/A09). Guardrails 8.1–8.5 upheld.

**No blockers, no concerns, no residual risk.** Story ready to release; Story 12.8 is now unblocked.

---

## Step Summary

- **Status:** ✅ PASS — traceability workflow complete
- **Duration:** Single-pass autonomous (yolo mode)
- **What changed:** Created `_bmad-output/test-artifacts/traceability/story-12-9-trace.md` — full 17-AC matrix, gate decision, recommendations
- **Key decisions:**
  - All 17 ACs mapped FULL via unit tests (14 new T-ids + accommodation sweep of ~50 existing callsites)
  - AC-17 (integration `it.skip` preservation) treated as guardrail-by-inspection rather than gap, per guardrail 8.1
  - Unit-only coverage deemed correct and intentional (story explicitly defers integration re-enablement to 12.8)
  - P0/P1/P2 priority assigned by TEA based on risk exposure (schema boundary + EVM-signer defect-site ACs → P0)
- **Issues found & fixed:** None — story already absorbed three review passes including a late-added T-14 (pass #3) that closed the only surfaced low-severity gap
- **Remaining concerns:** None for 12.9 itself. Forward-looking: Story 12.8 must re-enable its 7 skipped `it.skip(SCHEMA_BLOCKER, …)` blocks to cash in on the 12.9 fix; not a 12.9 obligation
- **Uncovered ACs:** **None.** All 17 ACs (AC-1 through AC-17) have explicit test coverage
- **Migrations:** None — no data migrations, no config surface changes, no workflow SHAs touched, no new packages introduced (guardrail 8.5 upheld)
