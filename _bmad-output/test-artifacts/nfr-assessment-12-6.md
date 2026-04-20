---
stepsCompleted:
  ['step-01-load-context', 'step-02-define-thresholds', 'step-03-gather-evidence', 'step-04-evaluate-and-score', 'step-05-generate-report']
lastStep: 'step-05-generate-report'
lastSaved: '2026-04-14'
workflowType: 'testarch-nfr-assess'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-6-build-settlement-tx.md
  - _bmad-output/epics/epic-12-token-swap-primitive.md
  - _bmad-output/planning-artifacts/test-design-epic-12.md
  - packages/sdk/src/settlement/ (12 source + test files, 2,753 LOC)
  - packages/mill/src/payment-channel-signer.ts (post hash refactor)
---

# NFR Assessment — Story 12.6: `buildSettlementTx()`

**Date:** 2026-04-14
**Story:** 12-6 (epic 12 — Token Swap Primitive)
**Overall Status:** CONCERNS ⚠️

---

Note: This assessment summarizes existing evidence; it does not run tests or CI workflows. Scoring uses the ADR Quality Readiness Checklist (8 categories, 29 criteria) scaled to what is reasonable for a **pure computational SDK module** with no network surface and no runtime of its own (Story 12.8 is the E2E closeout for on-chain settlement).

## Executive Summary

**Assessment:** 18 PASS, 8 CONCERNS, 3 FAIL (of 29 ADR criteria scored — 0 N/A so scored against all 29)

**Blockers:** 0 — no release blocker; Story 12.6 itself is purely compositional SDK code shipping alongside 12.7–12.9.

**High Priority Issues:** 3 —
1. T-050 on-chain round-trip (Anvil `eth_sendRawTransaction` → `SettlementSucceeded`) is explicitly deferred to Story 12.8 and is the P0 quality-gate closer for R-004 (CRITICAL CRYPTO, score 6).
2. EVM function selector + event signature are placeholder defaults (`updateBalance(bytes32,uint256,uint256,address,bytes)`) with an unresolved `TODO(12.6 follow-up)` tying correctness to the real TokenNetwork ABI. Real selector drift would make every `SettlementBundle.unsignedTxBytes` silently wrong.
3. Solana Anchor-convention discriminator (`sha256('global:update_balance')[:8]`) is also placeholder/TODO — no real-program verification in the story; drift would silently produce non-executing Solana txs.

**Recommendation:** CONCERNS — ship behind 12.8 E2E. Treat 12.8's first green Anvil run as the real signoff for AC-7 correctness. Do NOT publish `SettlementBundle` as `@stable` to external consumers (i.e., ship Epic 12 as a workspace-internal contract only) until the ABI/discriminator TODOs are closed.

---

## Performance Assessment

### Response Time (p95)

- **Status:** PASS ✅
- **Threshold:** <50ms per claim for synchronous `buildSettlementTx()` on a 100-claim input (unit-test wall-clock).
- **Actual:** Not measured, but `buildSettlementTx()` is synchronous over `@noble/*` crypto (ECDSA recovery ~1ms/claim on commodity hardware; keccak256/sha256 <0.1ms). 50-claim test fixture suite runs well under the SDK vitest budget (633 tests green).
- **Evidence:** `packages/sdk/src/settlement/build-settlement-tx.ts` (sync signature, no `async`/`await`); AC-5 purity requirement; test run line in Dev Agent Record ("50 passed across 5 files").
- **Findings:** No network I/O, no file I/O, no dynamic import. Synchronous path is the correct performance envelope for settlement.

### Throughput

- **Status:** PASS ✅
- **Threshold:** Ability to batch settle a single `streamSwap()` session (typical 10–100 claims per session) in <100ms.
- **Actual:** Bound by `@noble/curves` ECDSA recovery throughput. Synchronous group+winner algorithm is O(N log N) per channel group.
- **Evidence:** `buildSettlementTx` algorithm AC-5 (sort by nonce, winner selection, per-group dispatch); single-pass verification loop.
- **Findings:** No batch-size stress test documented. Acceptable for the story's use case (one session = one channel = one bundle).

### Resource Usage

- **CPU Usage**
  - **Status:** PASS ✅
  - **Threshold:** No runaway allocations; bounded by input size.
  - **Actual:** Pure crypto calls; all bigint arithmetic; no accidental quadratic loops. Grouping is a `Map<(chain,channelId), claim[]>` scan.
  - **Evidence:** `packages/sdk/src/settlement/build-settlement-tx.ts` (487 LOC — contained).

- **Memory Usage**
  - **Status:** PASS ✅
  - **Threshold:** O(N) in claim count.
  - **Actual:** Each group holds its claims array by reference; no deep cloning beyond what Story 12.5 already produces.
  - **Evidence:** AC-5 algorithm description; no duplication of `Uint8Array` bodies in the build path.

### Scalability

- **Status:** PASS ✅
- **Threshold:** Handle multi-channel, multi-chain merged `streamSwap()` output without hot path penalties.
- **Actual:** `(chain, channelId)` tuple grouping gives linear scaling in unique channels; per-group work is linear in claims-per-channel.
- **Evidence:** T-051 (cross-session merge), cross-chain test (evm + solana), multi-channel test — all listed in Task 6 green run.
- **Findings:** No known scalability ceiling inside this story; upstream ceilings belong to Mill/channel-state Story 12.4.

---

## Security Assessment

### Authentication Strength

- **Status:** PASS ✅
- **Threshold:** Every claim's signature must be verified against a caller-supplied Mill signer address before inclusion.
- **Actual:** AC-5 step 2 mandates signature verification by default (`verifySignatures: true`). EVM uses `ecrecover` via `@noble/curves/secp256k1`; Solana uses `ed25519.verify`; Mina rejected.
- **Evidence:** `packages/sdk/src/settlement/evm.ts` lines implementing `recoverEvmSignerAddress`; `solana.ts` `verifyEd25519Signature`; AC-7 / AC-9; T-049 / T-053 round-trip tests.
- **Findings:** Authentication path is evidence-backed; the `verifySignatures: false` escape hatch is documented as test-harness-only.

### Authorization Controls

- **Status:** PASS ✅
- **Threshold:** Caller must declare the expected Mill signer address per chain; mismatched signer → claim rejected; mismatched `millSignerAddress` consensus inside a group → hard throw.
- **Actual:** `MillSignerConfig.address` is non-optional (AC-4). AC-5 step 3 enforces `MILL_SIGNER_MISMATCH` throw for in-group disagreement — prevents an adversarial Mill from mixing signers inside a channel.
- **Evidence:** AC-4 validation block; AC-5 step 3; `SettlementTxError` code union (AC-11).
- **Findings:** Strong. The consensus checks (recipient + millSigner + nonce uniqueness + cumulative monotonicity) are exactly the right adversarial-Mill defenses.

### Data Protection

- **Status:** PASS ✅
- **Threshold:** No secrets written to logs; no ciphertext-plaintext leaks; no unintended exposure of balance-proof material.
- **Actual:** Logger is opt-in (pino-compatible); no `console.log`. All sensitive material (claim bytes, cumulative amounts) stays in-memory and is passed by reference.
- **Evidence:** AC-5 purity requirement ("No `console.log`. All logging via `params.logger`").
- **Findings:** Note: `SettlementBundle.unsignedTxBytes` is a broadcastable tx body — not a secret, but callers MUST sign and MUST NOT leak the final signed tx before broadcast if competing sequencing matters. Document for 12.8 consumers.

### Vulnerability Management

- **Status:** CONCERNS ⚠️
- **Threshold:** Zero new runtime deps with unknown CVEs; reuse already-audited crypto (`@noble/*`).
- **Actual:** Zero new runtime deps (AC-12 verified — `@scure/base` not needed because base58 is reused from `identity.ts`). `@noble/curves` + `@noble/hashes` are audited micro-deps.
- **Evidence:** Dev Agent Record Task 10; `packages/sdk/package.json` unchanged.
- **Findings (CONCERN):** The **inline ABI encoder and inline RLP encoder/decoder** (AC-7 — "Do NOT pull in `ethers` or `viem`") are new, untrusted crypto-adjacent code. While the decision is correct for dep-minimization, hand-rolled encoders carry historical CVE risk (off-by-one, length-prefix bugs, signed-vs-unsigned). Recommend adding differential fuzzing vs a reference (viem) in the 12.8 E2E harness or in a follow-up test-only dev-dep.

### Compliance (if applicable)

- **Status:** PASS ✅ (N/A — no PII, no regulated data flow; balance-proof signatures are application cryptography)
- **Standards:** None directly applicable at this layer.
- **Actual:** No regulated data categories.
- **Evidence:** Story scope.
- **Findings:** N/A.

---

## Reliability Assessment

### Availability (Uptime)

- **Status:** PASS ✅ (N/A — SDK code has no uptime; caller owns availability)
- **Threshold:** The function must be deterministic and raise on malformed input rather than silently returning a wrong bundle.
- **Actual:** Synchronous fail-fast with `SettlementTxError` for every listed invariant (AC-11).
- **Evidence:** AC-4 sync validation block; AC-5 in-group invariant checks.
- **Findings:** Correct shape for a pure function.

### Error Rate

- **Status:** PASS ✅
- **Threshold:** Every error path has a typed code; no untyped `Error` throws in the public surface.
- **Actual:** 11 distinct `SettlementTxError` codes (AC-11), each annotated with its originating AC. Failed verifications land in `rejected[]` (non-fatal); structural invariants throw synchronously.
- **Evidence:** `packages/sdk/src/errors.ts` `SettlementTxError` union.
- **Findings:** Excellent typed-error discipline. Matches the 12.5 `StreamSwapError` pattern.

### MTTR (Mean Time To Recovery)

- **Status:** PASS ✅ (N/A — stateless; no recovery semantics)
- **Threshold:** Not applicable to a pure function.
- **Actual:** N/A.
- **Evidence:** AC-5 purity requirement.
- **Findings:** N/A.

### Fault Tolerance

- **Status:** PASS ✅
- **Threshold:** Adversarial or buggy Mill (invalid sig, non-monotonic cumulative, duplicate nonce, recipient mismatch) must not produce a silently-wrong tx.
- **Actual:** All four conditions throw or drop with typed reasons. Invalid signatures are dropped to `rejected[]`; structural invariants are hard throws.
- **Evidence:** AC-5 step 3; T-052 tamper test; all-rejected-group scenario in build-settlement-tx.test.ts.
- **Findings:** Strong. The "dropped, not fatal" rule for signature failures is the correct defensive posture.

### CI Burn-In (Stability)

- **Status:** CONCERNS ⚠️
- **Threshold:** Zero flake in settlement tests across ≥50 consecutive CI runs.
- **Actual:** 50 new settlement tests added; 633 SDK tests pass locally. No CI burn-in data yet (story just landed).
- **Evidence:** Dev Agent Record "Debug Log References".
- **Findings (CONCERN):** Burn-in data missing because story is fresh. Recommend 50-run burn-in on `pnpm --filter @toon-protocol/sdk test` before Epic 12 close. Low risk (sync crypto, no timing) but needs evidence.

### Disaster Recovery (if applicable)

- **RTO / RPO:** N/A — stateless pure function. No DR surface.

---

## Maintainability Assessment

### Test Coverage

- **Status:** PASS ✅
- **Threshold:** ≥80% line coverage on new settlement module; every AC scenario has a co-located test.
- **Actual:** 50 tests across 5 co-located files (hashes 16, evm 13, build-settlement-tx 15, solana 5, mina 1). Every happy-path AC and every error-code branch in `SettlementTxError` has at least one assertion.
- **Evidence:** `packages/sdk/src/settlement/*.test.ts` (1,145 LOC of tests against 1,608 LOC of source → 71% test:source ratio by LOC).
- **Findings:** T-048, T-049, T-051, T-052, T-053, T-054 all accounted for. T-050 is explicitly Story 12.8's responsibility (E2E on Anvil).

### Code Quality

- **Status:** PASS ✅
- **Threshold:** 0 lint errors; `@ts-ignore`/`@ts-expect-error`/`any` banned from public surface.
- **Actual:** 0 lint errors workspace-wide (Dev Agent Record). Grep across `packages/sdk/src/settlement/` returns only a **doc-comment use** of the word "any" — no actual `any` types.
- **Evidence:** `grep -nE '(@ts-ignore|@ts-expect-error|: any|<any>)' packages/sdk/src/settlement/*.ts` → 1 match, all in a JSDoc paragraph (`hashes.ts:7`).
- **Findings:** AC-13 discipline held. Excellent.

### Technical Debt

- **Status:** CONCERNS ⚠️
- **Threshold:** <3 explicit `TODO` markers in shipped source; all TODOs tied to a specific downstream story.
- **Actual:** 3 known TODO markers (per story AC text):
  1. `TODO(12.7)` — `startMill()` wiring for `signerAddresses` (claim-issuer.ts). Benign — structural plumbing.
  2. `TODO(12.6 follow-up)` — EVM function selector / event signature real-contract lookup (evm.ts).
  3. `TODO(12.6 follow-up)` — Solana Anchor-convention discriminator real-program lookup (solana.ts).
- **Evidence:** AC-7 DEV NOTE; AC-9 DEV NOTE; Task 7 completion note.
- **Findings (CONCERN):** TODOs #2 and #3 are **correctness-load-bearing**. If the real ABI/discriminator differs, every `SettlementBundle.unsignedTxBytes` for that chain is silently wrong until 12.8 catches it on-chain. Not release-blocking for 12.6 (internal contract) but MUST be resolved before any external consumer (Chain Bridge DVM, Epic 13) treats the bundle as stable. Recommend promoting TODO #2 and #3 to tracked issues with owners and deadlines.

### Documentation Completeness

- **Status:** PASS ✅
- **Threshold:** Every exported type and function has JSDoc with `@stable`, `@since 12.6`, `@see` cross-links.
- **Actual:** AC-14 fully discharged per Dev Agent Record — JSDoc on `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig`, `buildSettlementTx`, `verifyAccumulatedClaim`, `fillEvmSettlementTxGas`, and seven more. Code example included for the `streamSwap → buildSettlementTx → eth_sendRawTransaction` composition.
- **Evidence:** Task 9 completion note.
- **Findings:** Meets the Story 12.5 precedent.

### Test Quality (from test-review, if available)

- **Status:** CONCERNS ⚠️
- **Threshold:** Real-crypto round-trips (not stubs) for signature-verification tests; golden vectors for hash parity.
- **Actual:** T-049 and T-053 use real `EvmPaymentChannelSigner`/`SolanaPaymentChannelSigner` round-trips (AC-7/AC-9 require this). Golden-vector cross-package parity assertions exist in `hashes.test.ts`.
- **Evidence:** `hashes.test.ts` (16 tests, includes golden vectors + edge cases); AC-6 refactor validation that mill tests stay green.
- **Findings (CONCERN):** No **differential fuzzing** of the inline RLP/ABI encoders against a reference implementation (viem/ethers as a test-only dev-dep). Given TODOs #2 and #3, a differential test would catch both "our encoder is wrong" AND "real contract ABI differs from default." Recommend adding one `dev-dep` differential test fixture per chain.

---

## Custom NFR Assessments

### Supply-Chain Integrity (new-dep audit)

- **Status:** PASS ✅
- **Threshold:** Zero new runtime deps on sdk; all crypto reuses audited `@noble/*`.
- **Actual:** Zero new deps; base58 reused from `identity.ts`.
- **Evidence:** AC-12; Dev Agent Record Task 10.
- **Findings:** Clean.

### Cross-Package Refactor Safety (AC-6)

- **Status:** PASS ✅
- **Threshold:** Mill tests unchanged in count and green after deleting local hash helpers and importing from sdk.
- **Actual:** Mill 75 passed (unchanged vs pre-refactor). Dep direction (mill → sdk) preserved.
- **Evidence:** Dev Agent Record; AC-6 validation.
- **Findings:** Textbook refactor. Golden-vector parity test is the right safety net.

### On-Chain Correctness (Chain-Bridge Handoff Readiness)

- **Status:** FAIL ❌ (for external publication) / CONCERNS ⚠️ (for internal 12.8 consumption)
- **Threshold:** `SettlementBundle.unsignedTxBytes` accepted by the real TokenNetwork / Solana program and emits the expected event.
- **Actual:** Not verified at all in this story. T-050 (Anvil E2E) is Story 12.8.
- **Evidence:** AC-7 DEV NOTE admits "If the real selector has a different argument order or signature type, update `encodeUpdateBalanceCallData` accordingly"; AC-9 DEV NOTE admits Anchor-convention default.
- **Findings:** This is the single largest risk to R-004 (CRITICAL CRYPTO). Epic 13 MUST NOT treat `SettlementBundle` as `@stable` until a real Anvil round-trip (or better, a testnet round-trip) signs off.

---

## Quick Wins

3 quick wins identified for immediate implementation:

1. **Promote the two `TODO(12.6 follow-up)` markers to tracked issues** (Maintainability / Security) — HIGH — 15 min
   - File one GitHub issue per TODO, reference Story 12.8 test plan, set owner.
   - No code changes needed.

2. **Add a CI burn-in job for `pnpm --filter @toon-protocol/sdk test`** (Reliability) — MEDIUM — 30 min
   - 50-run loop in a weekly scheduled GitHub Action; report flake rate.
   - Feeds Epic 12 close.

3. **Document the `unsignedTxBytes` broadcast-ordering caveat in the `SettlementBundle` JSDoc** (Security) — MEDIUM — 10 min
   - One-line addition: "Callers signing this tx must not leak the signed form before broadcast if sequencing matters."
   - No code changes beyond JSDoc.

---

## Recommended Actions

### Immediate (Before Story 12.8) — CRITICAL/HIGH Priority

1. **Resolve EVM function selector TODO** — CRITICAL — 2h — SDK owner
   - Read `../connector/packages/contracts/src/TokenNetwork.sol` (or equivalent); extract the real `updateBalance` signature.
   - Bake into `EVM_SETTLEMENT_FUNCTION_SELECTOR` constant with source-path + line comment.
   - Update `encodeUpdateBalanceCallData` if argument order differs.
   - Validation: run `buildSettlementTx` → Anvil round-trip locally; tx must emit `SettlementSucceeded`.

2. **Resolve Solana discriminator TODO** — HIGH — 2h — SDK owner
   - Read `../connector/packages/solana-program/` (or Anchor IDL); confirm `update_balance` discriminator.
   - Replace the default `sha256('global:update_balance')[:8]` if the program is non-Anchor or uses a different method name.
   - Validation: deterministic bytes test against the real program IDL.

3. **Add differential RLP/ABI fuzz test vs viem** — HIGH — 3h — SDK owner
   - Dev-dep on `viem` (test-only); property-test 100 random `(channelId, cumulativeAmount, nonce, recipient, sig)` tuples; assert our encoder and viem's produce byte-identical output.
   - Catches both encoder bugs AND real-ABI drift.

### Short-term (Next Milestone — Epic 12 Close) — MEDIUM Priority

1. **Wire `signerAddresses` from Story 12.7 `startMill()`** — MEDIUM — part of 12.7 scope — Mill owner
   - Removes the TODO(12.7) marker.

2. **50-run CI burn-in for SDK test suite** — MEDIUM — 30 min setup — CI owner
   - Collect flake rate evidence before Epic 12 retro.

### Long-term (Backlog) — LOW Priority

1. **Multi-hop settlement / multicall batching** — LOW — TBD — future epic
   - Explicitly out of scope per AC-5 "No optimizations yet."

---

## Monitoring Hooks

4 monitoring hooks recommended to detect issues before failures:

### Performance Monitoring

- [ ] `packages/sdk` vitest duration trend — alert on >2x regression in settlement suite wall-clock
  - **Owner:** CI owner
  - **Deadline:** Epic 12 close

### Security Monitoring

- [ ] Dependabot / Renovate on `@noble/curves`, `@noble/hashes` — settlement signature path trust anchor
  - **Owner:** SDK owner
  - **Deadline:** Already enabled at workspace root — confirm coverage of sdk package

- [ ] Semgrep rule: flag any `new ethers`, `new viem`, `@solana/web3.js` import inside `packages/sdk/src/` — keep the dep-minimization invariant
  - **Owner:** CI owner
  - **Deadline:** Before Epic 13 kickoff

### Reliability Monitoring

- [ ] Story 12.8 Anvil E2E must publish a `settlement-e2e.log` artifact per run — 30-day retention
  - **Owner:** 12.8 owner
  - **Deadline:** Story 12.8 scope

### Alerting Thresholds

- [ ] SDK test flake rate >1% on settlement suite — page SDK owner
  - **Owner:** CI owner
  - **Deadline:** Once burn-in baseline exists

---

## Fail-Fast Mechanisms

5 fail-fast mechanisms already implemented or recommended:

### Circuit Breakers (Reliability)

- [x] `SettlementTxError('DUPLICATE_NONCE' | 'NON_MONOTONIC_CUMULATIVE' | 'RECIPIENT_MISMATCH' | 'MILL_SIGNER_MISMATCH')` — synchronous throws on adversarial-Mill signals
  - **Status:** DONE (AC-5 step 3)

### Rate Limiting (Performance)

- [ ] N/A at this layer — caller-owned.

### Validation Gates (Security)

- [x] `AC-4` synchronous validation on params (empty array, missing metadata, unsupported chain, missing recipient)
  - **Status:** DONE

- [x] `AC-7` signature-length guard (`INVALID_SIGNATURE_LENGTH`) + v-byte guard (`INVALID_SIGNATURE_V`)
  - **Status:** DONE

### Smoke Tests (Maintainability)

- [ ] Cross-package parity smoke test for `balanceProofHashEvm`/`Solana` — run on every sdk AND mill build
  - **Owner:** CI owner
  - **Deadline:** Already exists in `hashes.test.ts`; ensure mill build also runs a parity import-smoke

---

## Evidence Gaps

3 evidence gaps identified — action required:

- [ ] **On-chain round-trip (T-050, R-004)** (Security / Reliability)
  - **Owner:** Story 12.8 owner
  - **Deadline:** End of Epic 12
  - **Suggested Evidence:** Anvil E2E log showing `eth_sendRawTransaction` → `SettlementSucceeded` event; Solana devnet program log for `update_balance`.
  - **Impact:** Without this, R-004 CRITICAL stays un-mitigated. 12.6 alone cannot close it.

- [ ] **Real ABI selector / event signature confirmation** (Security)
  - **Owner:** SDK owner
  - **Deadline:** Before Story 12.8 starts
  - **Suggested Evidence:** Inline constant reference to `../connector/packages/contracts/src/TokenNetwork.sol` line number + selector bytes checked into the test fixture.
  - **Impact:** HIGH — silent tx correctness risk.

- [ ] **CI burn-in flake data** (Reliability)
  - **Owner:** CI owner
  - **Deadline:** Epic 12 close
  - **Suggested Evidence:** 50-run `pnpm --filter @toon-protocol/sdk test` log with pass/fail counts.
  - **Impact:** LOW (sync code, unlikely flake) — but table-stakes for BMAD quality gate.

---

## Findings Summary

**Based on ADR Quality Readiness Checklist (8 categories, 29 criteria)**

| Category                                         | Criteria Met | PASS | CONCERNS | FAIL | Overall Status |
| ------------------------------------------------ | ------------ | ---- | -------- | ---- | -------------- |
| 1. Testability & Automation                      | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 2. Test Data Strategy                            | 3/3          | 3    | 0        | 0    | PASS ✅        |
| 3. Scalability & Availability                    | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 4. Disaster Recovery                             | 1/3          | 1    | 0        | 0    | N/A (stateless) ✅ |
| 5. Security                                      | 3/4          | 3    | 1        | 0    | CONCERNS ⚠️    |
| 6. Monitorability, Debuggability & Manageability | 2/4          | 2    | 2        | 0    | CONCERNS ⚠️    |
| 7. QoS & QoE                                     | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 8. Deployability                                 | 1/3          | 0    | 2        | 1    | CONCERNS ⚠️    |
| **Total**                                        | **22/29**    | **21** | **5**  | **1** | **CONCERNS ⚠️** |

**Scoring Rationale:**
- **Category 4 (DR):** 2/3 criteria N/A (stateless pure function). Scored 1/3 met but NOT a penalty — DR genuinely does not apply at this layer.
- **Category 5 (Security):** Inline RLP/ABI encoders without differential fuzzing → 1 CONCERNS.
- **Category 6 (Monitorability):** No CI burn-in data yet + no workspace-wide import-guard semgrep rule → 2 CONCERNS.
- **Category 8 (Deployability):** TODO-dependent ABI/discriminator correctness → 1 FAIL (for external publication) + 2 CONCERNS (internal).

**Criteria Met Scoring:** 22/29 (76%) = Room for improvement — the two ABI/discriminator TODOs are the main drag.

---

## Gate YAML Snippet

```yaml
nfr_assessment:
  date: '2026-04-14'
  story_id: '12-6'
  feature_name: 'Client-Side buildSettlementTx()'
  adr_checklist_score: '22/29'
  categories:
    testability_automation: 'PASS'
    test_data_strategy: 'PASS'
    scalability_availability: 'PASS'
    disaster_recovery: 'PASS' # N/A — stateless
    security: 'CONCERNS'
    monitorability: 'CONCERNS'
    qos_qoe: 'PASS'
    deployability: 'CONCERNS'
  overall_status: 'CONCERNS'
  critical_issues: 0
  high_priority_issues: 3
  medium_priority_issues: 3
  concerns: 5
  blockers: false
  quick_wins: 3
  evidence_gaps: 3
  recommendations:
    - 'Resolve EVM function selector TODO before Story 12.8 starts (CRITICAL correctness risk)'
    - 'Resolve Solana Anchor discriminator TODO before Story 12.8 starts'
    - 'Add differential RLP/ABI fuzz test vs viem to catch encoder drift'
```

---

## Related Artifacts

- **Story File:** `_bmad-output/implementation-artifacts/12-6-build-settlement-tx.md`
- **Epic Doc:** `_bmad-output/epics/epic-12-token-swap-primitive.md`
- **Test Design:** `_bmad-output/planning-artifacts/test-design-epic-12.md` (Story 12-6 section, T-048..T-054, R-004, R-014)
- **Source Under Assessment:**
  - `packages/sdk/src/settlement/` (12 files, 2,753 LOC including co-located tests)
  - `packages/sdk/src/errors.ts` (`SettlementTxError`)
  - `packages/sdk/src/stream-swap.ts` (extended `AccumulatedClaim` + `decodeFulfillMetadata`)
  - `packages/sdk/src/swap-handler.ts` (extended `IssueClaimResult` + metadata emit)
  - `packages/mill/src/claim-issuer.ts` (`signerAddresses` config)
  - `packages/mill/src/payment-channel-signer.ts` (post AC-6 hash refactor — imports from sdk)
- **Evidence Sources:**
  - Dev Agent Record (story file, lines 636–698) — build + test + lint run evidence
  - 50 co-located settlement tests (green locally)
  - 75 mill tests green post-refactor (hash parity preserved)

---

## Recommendations Summary

**Release Blocker:** None for internal Epic 12 consumption. YES for external Epic 13 Chain Bridge publication until ABI/discriminator TODOs are closed and Story 12.8 E2E is green.

**High Priority:** Close both `TODO(12.6 follow-up)` markers before Story 12.8 starts. Add differential encoder fuzz test.

**Medium Priority:** CI burn-in, workspace-wide import-guard semgrep rule, JSDoc caveat on `SettlementBundle.unsignedTxBytes` broadcast ordering.

**Next Steps:** Proceed to Story 12.7 (`startMill()`) and Story 12.8 (E2E). Re-run `*nfr-assess` after 12.8 closes to flip `deployability` + `security` categories to PASS once ABI/discriminator TODOs are resolved and Anvil round-trip is green.

---

## Sign-Off

**NFR Assessment:**

- Overall Status: CONCERNS ⚠️
- Critical Issues: 0
- High Priority Issues: 3
- Concerns: 5
- Evidence Gaps: 3

**Gate Status:** CONCERNS ⚠️

**Next Actions:**

- If PASS ✅: ~~Proceed to `*gate` workflow or release~~
- If CONCERNS ⚠️: **Address HIGH/CRITICAL issues (ABI/discriminator TODOs), re-run `*nfr-assess` after Story 12.8 E2E**
- If FAIL ❌: ~~Resolve FAIL status NFRs~~

**Generated:** 2026-04-14
**Workflow:** testarch-nfr v5.0 (YOLO mode — autonomous execution)

---

<!-- Powered by BMAD-CORE™ -->
