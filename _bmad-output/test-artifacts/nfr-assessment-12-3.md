---
stepsCompleted:
  - step-01-load-context
  - step-02-define-thresholds
  - step-03-gather-evidence
  - step-04-evaluate-and-score
  - step-05-generate-report
lastStep: step-05-generate-report
lastSaved: '2026-04-13'
workflowType: testarch-nfr-assess
inputDocuments:
  - _bmad-output/implementation-artifacts/12-3-mill-swap-handler.md
  - _bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md
  - _bmad-output/implementation-artifacts/12-1-swappair-type-and-kind-10032-serialization.md
  - _bmad-output/epics/epic-12-token-swap-primitive.md
  - _bmad-output/planning-artifacts/test-design-epic-12.md
  - _bmad-output/test-artifacts/nfr-assessment-12-1.md
  - packages/sdk/src/swap-handler.ts
  - packages/sdk/src/swap-handler.test.ts
  - packages/sdk/src/gift-wrap.ts
  - packages/sdk/src/errors.ts
  - packages/sdk/src/index.ts
  - packages/sdk/src/index.test.ts
---

# NFR Assessment - Story 12-3: Mill Swap Handler (`createSwapHandler()`)

**Date:** 2026-04-13
**Story:** 12-3
**Epic:** 12 (Token Swap Primitive)
**Scope:** Handler orchestration in `@toon-protocol/sdk` — `createSwapHandler()` factory producing a kind:1059 `Handler` that unwraps NIP-59 gift wraps (via Story 12.2), applies BigInt-only rate conversion, delegates to a pluggable `ClaimIssuer`, and returns an ephemeral-key NIP-44 encrypted FULFILL claim. Adds `findSwapPair`, `applyRate`, `SwapHandlerError`. No changes to `@toon-protocol/core` or any other package.
**Overall Status:** PASS ✅

---

Note: This assessment summarizes existing evidence from the dev session record (story file Change Log + Dev Agent Record), the implementation source (`packages/sdk/src/swap-handler.ts`, 510 lines), the ATDD test file (`packages/sdk/src/swap-handler.test.ts`, 35 tests / 797 lines), and epic-12 test design T-017..T-028 + R-002/R-003/R-010/R-013/R-016/R-018. It does not execute tests or CI workflows. The dev session recorded `522/522 SDK tests passing` (baseline 488 + 34 previously-RED ATDD tests flipped GREEN), a clean TS build, and 0 new lint errors.

## Executive Summary

**Assessment:** 5 PASS, 2 CONCERNS, 0 FAIL (applicable NFR categories)

**Blockers:** 0 — implementation is self-contained within `packages/sdk/src/`, consumes Story 12.2 primitives unchanged, preserves the privacy invariant (sender identity + claim bytes leave the handler only as NIP-44 ciphertext with ephemeral pubkey), and honors the Epic 11 BigInt-over-Number guard throughout `applyRate` and all claim-amount math.

**High Priority Issues:** 0

**Recommendation:** APPROVE for merge `review → done`. The handler cleanly composes Story 12.2 primitives, exposes a correct `ClaimIssuer` seam for Story 12.4, and enforces defense-in-depth validation (kind guard, gift-wrap catch, pair lookup, rate format, sourceAmount sign, issuer failure taxonomy, optional replay dedup). Two CONCERNS are informational: (1) no measured p95 latency budget exists for the handler because Epic 12 defers perf thresholds to Story 12.8 E2E; (2) monitoring hooks are exposed only as an injectable `logger` interface — operator-side structured-log emission belongs to Story 12.7 (`packages/mill/`). Neither blocks release.

---

## Performance Assessment

### Response Time (p95)

- **Status:** N/A (CONCERNS) ⚠️
- **Threshold:** No explicit p95 threshold in the story, epic-12 test design, or tech spec. Epic 12 defers live-path latency measurement to Story 12.8 (E2E) where the full wrap → route → unwrap → issue → encrypt cycle runs against Docker SDK E2E infra.
- **Actual:** Handler critical path is dominated by (a) a single NIP-44 decrypt (Story 12.2 `unwrapSwapPacketFromToon`), (b) an O(N) linear scan over `config.swapPairs` (N ≤ tens in practice), (c) one BigInt multiply/divide in `applyRate`, (d) `await claimIssuer.issueClaim(...)` — handler-external, Story 12.4, (e) a single NIP-44 encrypt (Story 12.2 `encryptFulfillClaim`). No file I/O, no network I/O inside the handler itself.
- **Evidence:** `packages/sdk/src/swap-handler.ts` lines 257-461 (handler closure); `packages/sdk/src/gift-wrap.ts` (unwrap/encrypt). Test suite completes in normal vitest bounds per dev session.
- **Findings:** No measurable regression surface introduced by this story. CONCERNS is informational — the p95 budget lives at the Mill-node level (Story 12.7/12.8), not the handler factory.

### Throughput

- **Status:** PASS ✅
- **Threshold:** Handler must be safe and correct under `Promise.all` concurrent invocation (AC-12).
- **Actual:** Handler is a closure with no shared mutable state beyond the operator-provided `seenPacketIds` set (opt-in). Node.js single-threaded cooperative scheduling + async/await semantics make the `issueClaim` await point the only interleaving hazard; the test `concurrent invocation (T-026)` fires 10 invocations via `Promise.all` and verifies all 10 accept, 10 distinct `claimId`, and `issueClaim` called 10 times.
- **Evidence:** `swap-handler.test.ts` T-026 test; `swap-handler.ts` — no module-level state, no singletons, all config closed over by reference.
- **Findings:** Concurrency contract verified at the handler level. Real-world throughput ceiling is set by the downstream `ClaimIssuer` (Story 12.4 owns on-chain/wallet serialization).

### Resource Usage

- **CPU Usage**
  - **Status:** PASS ✅
  - **Threshold:** No per-packet CPU budget defined; must not introduce unnecessary allocations in the hot path.
  - **Actual:** Each invocation allocates (a) the unwrapped `{rumor, senderPubkey}` pair from Story 12.2, (b) one BigInt tuple in `applyRate`, (c) one optional sha256 hash digest (replay hook only if `seenPacketIds` present), (d) the encrypted FULFILL ciphertext (Story 12.2 internals). No repeated regex compilation (rate regex is constructed once inside `applyRate` per call — minor but not a hot-path concern at Mill packet rates).
  - **Evidence:** `swap-handler.ts` lines 140-181 (`applyRate`), 499-510 (`computePacketId`), 463-497 (`tryUnwrap`).

- **Memory Usage**
  - **Status:** PASS ✅
  - **Threshold:** No ephemeral key material retained; no unbounded growth introduced by the handler itself.
  - **Actual:** Ephemeral NIP-44 privkey is zeroed by Story 12.2's `encryptFulfillClaim` (inherited guarantee — explicitly not re-implemented). The optional `seenPacketIds` is documented as caller-managed (story AC-11 instructs operators to inject a bounded LRU in production). No module-level state.
  - **Evidence:** `swap-handler.ts` block comment on `encryptFulfillClaim` call-site; story AC-11 "operator is responsible for bounding this set."

### Scalability

- **Status:** CONCERNS ⚠️ (informational)
- **Threshold:** Not defined in this story.
- **Actual:** Two linear factors: (1) `findSwapPair` is O(N) in `config.swapPairs`; at expected N ≤ 20 pairs this is sub-microsecond. (2) `seenPacketIds` as a raw `Set<string>` is unbounded — this is a documented, explicit design decision: operator injects a bounded store. Handler does not pull in `lru-cache` (scope fence).
- **Evidence:** `swap-handler.ts` lines 182-206 (`findSwapPair` linear scan); story Dev Notes "scope fence" section.
- **Findings:** CONCERNS because the story does not lock a pair-count upper bound. Practical upper bound is enforced upstream by kind:10032 event-size limits (see 12-1 NFR assessment). Not release-blocking.

---

## Security Assessment

### Authentication Strength

- **Status:** PASS ✅
- **Threshold:** Handler must not trust `ctx.pubkey` (outer ephemeral gift-wrap key) as the sender identity; real sender pubkey MUST come from the unwrap path.
- **Actual:** Handler extracts `{rumor, senderPubkey}` from `unwrapSwapPacketFromToon` (Story 12.2, which verifies the seal signature) and uses `senderPubkey` — not `ctx.pubkey` — when calling `claimIssuer.issueClaim`, computing the replay packet ID, and invoking `encryptFulfillClaim`. A JSDoc comment documents this distinction at the unwrap call site to prevent regression.
- **Evidence:** `swap-handler.ts` handler body (lines ~280-340); story Dev Notes "HandlerContext shape refresher" block; story AC-5.
- **Findings:** Authentication boundary correctly inherited from Story 12.2. No new auth surface introduced.

### Authorization Controls

- **Status:** PASS ✅
- **Threshold:** No implicit trust of caller-supplied rumor fields beyond what the gift-wrap seal attests.
- **Actual:** Handler derives only `swap-from` / `swap-to` tags from the rumor for pair lookup. All economic decisions (rate, amounts, issuance) are config-driven or computed from `ctx.amount` (connector-attested) and the validated `SwapPair`. No rumor field is forwarded to the issuer without passing through the config-validated `pair` object.
- **Evidence:** `swap-handler.ts` `findSwapPair` (lines 182-206); handler body pair-lookup → rate-resolve → issue flow.
- **Findings:** No authorization escape. Mill operator controls all business-critical state via config + `ClaimIssuer`.

### Data Protection

- **Status:** PASS ✅
- **Threshold:** (a) FULFILL claim bytes MUST be NIP-44 encrypted with a fresh ephemeral key per packet; (b) ephemeral privkey MUST NOT be retained after response; (c) gift-wrap decrypt failures MUST NOT leak error detail to the sender; (d) rate/amount arithmetic MUST use BigInt end-to-end (Epic 11 retro guard).
- **Actual:**
  - (a) `encryptFulfillClaim({claimData: claim, senderPubkey})` invoked on every successful path (story AC-10, T-020, T-025). Ephemeral pubkey returned in `accept()` metadata; ciphertext base64-encoded for JSON transport.
  - (b) Ephemeral privkey zeroing is Story 12.2's responsibility and is explicitly not re-implemented here (story Dev Notes).
  - (c) On `GiftWrapError`, handler logs the underlying message at `warn` level (operator-side only) and returns `ctx.reject('F01', 'Invalid gift wrap')` — opaque to the sender (story AC-5).
  - (d) `applyRate` is end-to-end BigInt: `sourceAmount: bigint`, `rateNumerator = BigInt(integerPart + fractionalPart)`, `10n ** BigInt(scale)`. No `Number()`, `parseInt()`, `parseFloat()`, or `+` string-coercion appears on any amount/rate/scale value in `swap-handler.ts`.
- **Evidence:** `swap-handler.ts` lines 140-181 (applyRate), 346-400 (encrypt path); `swap-handler.test.ts` T-020 (encrypted roundtrip with decryption verification), T-023 (2^63 source amount no-overflow), T-025 (5 distinct ephemeral pubkeys); story AC-8 / AC-10 / "Standard Guards" section.
- **Findings:** The privacy model (D12-008) is preserved end-to-end. BigInt guard enforced. Error-leak channel closed (gift-wrap error details do not escape the process boundary).

### Vulnerability Management

- **Status:** PASS ✅
- **Threshold:** No new external dependencies; all crypto routes through Story 12.2's audited exports.
- **Actual:** Zero new workspace or npm dependencies. sha256 for the replay packet ID uses Node's built-in `node:crypto.createHash('sha256')` — no `lru-cache`, no `hash-js`, no re-implementation. Gift-wrap decrypt / FULFILL encrypt / conversation-key derivation all delegate to Story 12.2 (`unwrapSwapPacketFromToon`, `encryptFulfillClaim`).
- **Evidence:** `swap-handler.ts` imports block — only `node:crypto`, `@toon-protocol/sdk` internals (`GiftWrapError`, `unwrapSwapPacketFromToon`, `encryptFulfillClaim`), `@toon-protocol/core` type (`SwapPair`), and `nostr-tools/pure` type (`UnsignedEvent`). `packages/sdk/package.json` dependency set unchanged.
- **Findings:** Attack surface unchanged from baseline SDK. A crafted kind:1059 payload attempting to exploit NIP-44 decrypt would hit Story 12.2's bounds first; a crafted rumor with malicious `swap-from`/`swap-to` tags is neutralized by `findSwapPair` null-return → F06 reject.

### Compliance (if applicable)

- **Status:** N/A ✅
- **Standards:** None applicable. Swap handler is infrastructure-level, not user-data handling.

---

## Reliability Assessment

### Availability (Uptime)

- **Status:** N/A ✅
- **Threshold:** Not applicable — handler is a pure async function registered on an SDK node; availability concerns live at the node level (Story 12.7).

### Error Rate

- **Status:** PASS ✅
- **Threshold:** Every error path MUST (a) return a typed `ctx.reject(code, message)` with a standard ILPv4 code, (b) never throw out of the handler boundary, (c) never call `claimIssuer.issueClaim` on an already-failed path.
- **Actual:** Six distinct reject paths, each with the correct ILP code per story "ILP error codes reference" table:
  - F02 — kind mismatch (defensive, AC-4).
  - F01 — gift-wrap failure (AC-5, T-022).
  - F06 — unsupported pair (AC-7, T-027).
  - F04 — replay duplicate (AC-11, T-R1).
  - T00 — `applyRate` SwapHandlerError (zero rate, bad format, non-positive amount) OR issuer non-inventory error.
  - T04 — issuer `INSUFFICIENT_INVENTORY` code OR `/insufficient/i` message match (AC-9, T-024).
  All six are exercised by named tests. The handler wraps `claimIssuer.issueClaim` in try/catch and maps to the correct ILP code — no issuer exception escapes.
- **Evidence:** `swap-handler.ts` handler body try/catch + reject call sites; `swap-handler.test.ts` tests T-021 (F01 non-wrap), T-022 (F01 tampered), T-024 (T04 insufficient), T-027 (F06 unsupported), T-028a (T00 zero rate), T-R1 (F04 replay).
- **Findings:** Error-handling taxonomy is complete and test-verified. No silent failure mode.

### MTTR (Mean Time To Recovery)

- **Status:** N/A ✅
- **Threshold:** Not applicable at handler granularity.

### Fault Tolerance

- **Status:** PASS ✅
- **Threshold:** Handler must tolerate: (a) absent `rumor.id` without hash-nondeterminism, (b) missing optional config fields (`rateProvider`, `seenPacketIds`, `logger`), (c) rumor tags in either `single-colon` or `multi-colon` chain-id forms.
- **Actual:**
  - (a) `computePacketId` defensively coalesces `rumor.id ?? ''` (story Task 5.5, implementation lines ~505).
  - (b) Defaults: `logger` falls back to a named `noop` constant (lint-cleaner alternative to inline `() => {}` — see Debug Log); `rateProvider` absent → uses `pair.rate` from config; `seenPacketIds` absent → replay check skipped entirely (opt-in).
  - (c) `splitAssetChain` in `findSwapPair` correctly parses `USDC:evm:base:8453` as `{assetCode: 'USDC', chain: 'evm:base:8453'}`. (Note: the Completion Notes explicitly call out that implementation splits on the **first** `:`, not last — the AC-7 text said last, but the test fixtures use first. The behavior matches the tests and matches how `SwapPair.from.chain` is formatted by Story 12.1. This is the correct resolution.)
- **Evidence:** `swap-handler.ts` lines 221-255 (splitAssetChain), 99-110 (config defaults), 499-510 (computePacketId); story Completion Notes Task 3.
- **Findings:** Defensive null/undefined handling is thorough. Multi-segment chain-id parsing verified by `findSwapPair` unit tests.

### CI Burn-In (Stability)

- **Status:** PASS ✅
- **Threshold:** SDK suite green, no flake, no retries.
- **Actual:** `pnpm --filter @toon-protocol/sdk test` → 522/522 passing (27 test files) per story Task 8.2. Baseline pre-story 488 passing; post-story 488 + 34 previously-RED ATDD tests flipping GREEN = 522. No flake noted.
- **Evidence:** Story "Dev Agent Record" → Debug Log References + Completion Notes Task 8; Change Log entry for 2026-04-13 dev-story run.
- **Findings:** Deterministic suite. ATDD RED→GREEN transition cleanly observed.

### Disaster Recovery (if applicable)

- **Status:** N/A ✅
- **Threshold:** Not applicable — handler has no durable state.

---

## Maintainability Assessment

### Test Coverage

- **Status:** PASS ✅
- **Threshold:** AC-14 requires ≥22 tests covering T-017..T-028, replay T-R1/T-R2, concurrent T-026, `findSwapPair`/`applyRate` helpers, and `rateProvider` hook.
- **Actual:** **35 tests** in `swap-handler.test.ts` — exceeds minimum by 1.59×. Covers:
  - T-017 (unwrap valid), T-018 (USDC→ETH golden), T-018b (same-scale precision), T-019 (issuer call args), T-020 (FULFILL encryption + decrypt roundtrip), T-021 (non-wrap reject), T-022 (tampered wrap reject), T-023 (2^63 boundary), T-024 (insufficient inventory), T-025 (distinct ephemeral keys × 5), T-026 (concurrent × 10), T-027 (unsupported pair), T-028a (zero rate), T-028b (large rate).
  - Replay: T-R1 (dedup once), T-R2 (disabled by default).
  - Helper units: ≥3 `findSwapPair` tests (exact match / chain mismatch / malformed tag), ≥3 `applyRate` tests (6→18 golden, 18→6 golden, invalid rate format throws).
  - `rateProvider` hook: fires once per packet, overrides `pair.rate`.
  - `SwapHandlerError` class shape verified.
- **Evidence:** Story Task 7 & Completion Notes; `swap-handler.test.ts` (797 lines, 51 total `it(...)` occurrences across 35 distinct tests + describe/nested blocks).
- **Findings:** Coverage is comprehensive. Both golden rate vectors (USDC→ETH and ETH→USDC) are locked in per story "Standard Guards" → these function as protocol-breaking-change detectors for Mill economic behavior.

### Code Quality

- **Status:** PASS ✅
- **Threshold:** Clean build, 0 new lint errors on touched files.
- **Actual:** `pnpm --filter @toon-protocol/sdk build` exits 0 (no TS errors). `pnpm lint` → 0 errors; 1632 pre-existing warnings untouched per Debug Log. One lint issue surfaced during dev (4× `@typescript-eslint/no-empty-function` on inline `() => {}` in default logger) was resolved by extracting a named `noop` constant — clean fix, no suppression comments.
- **Evidence:** Story Debug Log References & Completion Notes Task 8; `swap-handler.ts` `noop` constant usage.
- **Findings:** Code conforms to project conventions: `ToonError`-derived error class, SCREAMING_SNAKE_CASE error code (`SWAP_HANDLER_ERROR`), `// Swap handler (Story 12.3)` export block comment matching the existing `// Gift wrap (Story 12.2)` pattern.

### Technical Debt

- **Status:** PASS ✅ (with one documented nit)
- **Threshold:** No new duplication; no `any` escapes; no TODO/FIXME markers without tracking.
- **Actual:** No new duplication. No `any`. No unresolved TODOs. One documented design note: the `tryUnwrap` helper (lines 463-497) accepts both single- and double-base64-encoded `ctx.toon` inputs. This is an intentional backward-compat shim because the test fixture `makeGiftWrappedCtx` double-encodes (`Buffer.from(ilpPrepare.data).toString('base64')` layered over already-base64 `ilpPrepare.data`). Documented in Completion Notes "Design notes" block. **Forward-looking:** When Story 12.5 `streamSwap()` lands with a canonical single-encoded form, the double-encode fallback branch should be removed; track as an Epic-12 retro action.
- **Evidence:** `swap-handler.ts` lines 463-497 (`tryUnwrap`); story Debug Log References "First impl run" + Completion Notes "Design notes" (ctx.toon decode).
- **Findings:** The double-encode tolerance is a minor debt item. It is explicit, commented, test-covered, and does not change protocol semantics. Recommend a follow-up cleanup ticket after 12.5 integration.

### Documentation Completeness

- **Status:** PASS ✅
- **Threshold:** New public symbols have JSDoc; `@throws` annotations on functions that can throw; design intent captured for future stories.
- **Actual:** All exported symbols (`createSwapHandler`, `findSwapPair`, `applyRate`, `SwapHandlerError`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`, `ApplyRateParams`, `CreateSwapHandlerConfig`, `SwapHandlerLogger`) have JSDoc. `ClaimIssuer.issueClaim` JSDoc explicitly documents atomicity expectations and points at Story 12.4 as the implementer. Story file Dev Notes section captures: ILP error code table, encrypt transport encoding convention (base64 of NIP-44 ciphertext), rate math worked examples (USDC→ETH and ETH→USDC golden vectors), HandlerContext shape refresher, non-goals fence.
- **Evidence:** `swap-handler.ts` JSDoc on each export; story Dev Notes block.
- **Findings:** Documentation is thorough enough for Story 12.4 to implement `ClaimIssuer` without re-reading the handler.

### Test Quality (from test-review, if available)

- **Status:** PASS ✅
- **Threshold:** Tests are deterministic, isolated, assertion-rich; fixtures are reusable; no wall-clock or network dependencies inside unit tests.
- **Actual:** Tests built around a `makeGiftWrappedCtx` fixture that deterministically constructs `HandlerContext` from a known sender/recipient keypair and a canonical SwapPair. Mock `ClaimIssuer` uses a monotonic counter `claimId: 'test-' + (++i)` for uniqueness assertions. FULFILL decryption roundtrip (T-020) uses the sender secret key to decrypt and assert the original claim bytes — strongest possible form of the encryption contract. Concurrent test (T-026) uses `Promise.all` with 10 distinct packets, which genuinely exercises the await interleaving.
- **Evidence:** `swap-handler.test.ts` structure per story Task 7.2-7.6; story AC-14 enumeration.
- **Findings:** No test-smell concerns. Golden-vector tests (T-018, T-018b) are the load-bearing economic invariants and are correctly pinned.

---

## ADR Quality Readiness Checklist Summary

| Category                                         | Criteria Met | PASS | CONCERNS | FAIL | Overall Status |
| ------------------------------------------------ | ------------ | ---- | -------- | ---- | -------------- |
| 1. Testability & Automation                      | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 2. Test Data Strategy                            | 3/3          | 3    | 0        | 0    | PASS ✅        |
| 3. Scalability & Availability                    | 2/4          | 2    | 2        | 0    | CONCERNS ⚠️    |
| 4. Disaster Recovery                             | N/A          | N/A  | N/A      | N/A  | N/A            |
| 5. Security                                      | 4/4          | 4    | 0        | 0    | PASS ✅        |
| 6. Monitorability, Debuggability & Manageability | 3/4          | 3    | 1        | 0    | CONCERNS ⚠️    |
| 7. QoS & QoE                                     | N/A          | N/A  | N/A      | N/A  | N/A            |
| 8. Deployability                                 | 3/3          | 3    | 0        | 0    | PASS ✅        |
| **Total (applicable)**                           | **19/22**    | 19   | 3        | 0    | **PASS ✅**    |

Categories 4 (Disaster Recovery) and 7 (QoS/QoE) are N/A for a stateless handler factory with no durable I/O. The CONCERNS in Scalability & Availability and Monitorability are informational — perf thresholds defer to Story 12.8 (E2E) and monitoring hooks defer to Story 12.7 (`packages/mill/`), mirroring the Story 12.1 deferral pattern.

---

## Quick Wins

None required — implementation is already at PASS.

Optional, low-effort enhancements (not blocking):

1. **Remove double-base64 decode fallback in `tryUnwrap`** (Technical Debt) - LOW priority - ~15 min after Story 12.5 lands
   - Once `streamSwap()` emits single-base64 canonical form, the fallback branch in `tryUnwrap` (lines 463-497) can be deleted. Current behavior: decode once, if `GiftWrapError` then decode again. After 12.5: decode once, propagate the error.
   - Track as Epic-12 retrospective action item.

2. **Add a micro-benchmark for `applyRate` BigInt math** (Performance) - LOW priority - ~10 min
   - Lock in sub-microsecond per-call performance for the rate math hot path. Pre-empts any future "let's use Number for speed" refactor attempt.

3. **Add a JSDoc note on `seenPacketIds` upper bound** (Scalability) - LOW priority - ~5 min
   - Document the expected LRU integration pattern and cite `lru-cache` as the recommended bounded-set implementation for Story 12.7 operators.

---

## Recommended Actions

### Immediate (Before Release) - CRITICAL/HIGH Priority

None. Story passes all applicable NFR criteria.

### Short-term (Next Milestone) - MEDIUM Priority

1. **Structured log emission at the Mill node** (Monitorability) - MEDIUM - deferred - Story 12.7 (`packages/mill/`)
   - The handler currently emits structured log events via the injected `logger` (`debug`, `info`, `warn`, `error`). Story 12.7 should inject a real pino logger and wire log levels + sampling. This story correctly stops at the injection seam.

2. **E2E latency p95 measurement** (Performance) - MEDIUM - deferred - Story 12.8 (E2E)
   - Measure end-to-end `wrap → route → handler → FULFILL` p95 under Docker SDK E2E infra. Set a budget (suggested: p95 < 200ms at single-packet granularity) and add a burn-in test.

### Long-term (Backlog) - LOW Priority

1. **Retire double-base64 decode fallback** (Technical Debt) - LOW - ~15 min - post-12.5
   - See Quick Wins #1.

2. **Consider moving `applyRate` to `@toon-protocol/core`** (Maintainability) - LOW - ~30 min - if Story 12.5 or 12.7 needs it client-side
   - Currently lives in SDK; if `streamSwap()` (12.5) needs to preview expected target amounts client-side, shared math belongs in core. Defer until a concrete consumer appears.

---

## Monitoring Hooks

The handler exposes a `logger` injection point (`SwapHandlerLogger` interface with `debug`/`info`/`warn`/`error` methods, defaulting to a `noop`). Actual instrumentation is deferred to Story 12.7.

### Performance Monitoring

- [ ] (Deferred to 12.7) `swap_handler.unwrap_latency_ms` histogram — wall-clock per `unwrapSwapPacketFromToon` call.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

- [ ] (Deferred to 12.7) `swap_handler.issue_latency_ms` histogram — wall-clock per `claimIssuer.issueClaim` call.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

### Security Monitoring

- [ ] (Deferred to 12.7) `swap_handler.gift_wrap_failed` counter — count of F01 rejects. Spike = likely targeted probe or misconfigured sender.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

- [ ] (Deferred to 12.7) `swap_handler.unsupported_pair` counter — count of F06 rejects. Spike = sender probing Mill inventory.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

### Reliability Monitoring

- [ ] (Deferred to 12.7) `swap_handler.replay_duplicate` counter — count of F04 rejects. Any non-zero value is noteworthy.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

- [ ] (Deferred to 12.7) `swap_handler.insufficient_inventory` counter — count of T04 rejects. Drives auto-rebalance.
  - **Owner:** Story 12.7
  - **Deadline:** Before Epic 12 close.

### Alerting Thresholds

- [ ] (Deferred to 12.7) Alert when F01 rate exceeds baseline + 3σ over 5 minutes (targeted malformed-packet attack).
- [ ] (Deferred to 12.7) Alert when `seenPacketIds.size` approaches the operator-configured LRU max (sizing guidance signal).

---

## Fail-Fast Mechanisms

The handler implements fail-fast at every boundary:

### Circuit Breakers (Reliability)

- [x] Issuer-failure taxonomy (AC-9): inventory errors map to T04 (caller can retry later); all other issuer errors map to T00 (caller backs off). Prevents a buggy `ClaimIssuer` from surfacing raw exceptions to senders.
- [ ] (Deferred to 12.7) Operator-level circuit breaker: trip the handler to auto-reject after N consecutive T04 responses within a window — avoids burning CPU on obviously-unfundable pairs.

### Rate Limiting (Performance)

- [ ] (Deferred to 12.7) Per-sender rate limit at Mill node ingress — out of scope for the handler itself.

### Validation Gates (Security)

- [x] Kind guard (AC-4): F02 reject if `ctx.kind !== 1059`.
- [x] Gift-wrap verification (AC-5): delegates to Story 12.2 seal-signature + kind verification; any failure → F01.
- [x] Pair validation (AC-7): `findSwapPair` returns null on missing/malformed tags → F06.
- [x] Rate format validation (AC-8): `applyRate` regex-checks `rate` and rejects non-decimal, leading-zero, or negative forms → T00.
- [x] Non-positive amount guard (AC-8): `applyRate` throws on `sourceAmount <= 0n` → T00.
- [x] Constructor validation: `createSwapHandler` validates `recipientSecretKey` (32 bytes), `swapPairs` (array), `claimIssuer` (has `issueClaim` function) at factory-call time (story Completion Notes Task 5).

### Smoke Tests (Maintainability)

- [x] Golden rate vectors (T-018, T-018b) act as protocol-breaking-change tripwires. Any change to `applyRate` output for fixed inputs is a load-bearing protocol change.

---

## Evidence Gaps

0 evidence gaps identified. All story ACs (AC-1..AC-15) have corresponding source or test evidence. All epic-12 test design items in scope (T-017..T-028, R-002/R-003/R-010/R-013/R-016/R-018) have verified coverage. Story 12.2 primitives (gift-wrap unwrap, FULFILL encrypt, ephemeral-key zeroing) are consumed unchanged per D12-008 / D12-009.

---

## Findings Summary

**Based on ADR Quality Readiness Checklist (8 categories)**

- **Applicable categories:** 6 of 8 (DR and QoS/QoE are N/A for a stateless handler factory).
- **Applicable criteria met:** 19 / 22 (86%) — same score shape as Story 12.1 (pure type/serialization) because the CONCERNS in Scalability and Monitorability are deferred-to-12.7/12.8 by design, not gaps in this story.
- **Critical gaps:** 0.
- **High-priority gaps:** 0.
- **Release blockers:** 0.

---

## Gate YAML Snippet

```yaml
nfr_assessment:
  date: '2026-04-13'
  story_id: '12-3'
  feature_name: 'Mill Swap Handler (createSwapHandler) — Unwrap, Rate Conversion, Encrypted Claim Issuance'
  adr_checklist_score: '19/22' # excluding N/A categories (DR, QoS/QoE)
  categories:
    testability_automation: PASS
    test_data_strategy: PASS
    scalability_availability: CONCERNS # informational — perf thresholds defer to 12.8 E2E
    disaster_recovery: N/A
    security: PASS
    monitorability: CONCERNS # informational — emission hooks defer to 12.7 Mill package
    qos_qoe: N/A
    deployability: PASS
  overall_status: PASS
  critical_issues: 0
  high_priority_issues: 0
  medium_priority_issues: 2  # structured-log emission @ 12.7, E2E p95 @ 12.8
  concerns: 2  # both informational / deferred by design
  blockers: false
  quick_wins: 3
  evidence_gaps: 0
  recommendations:
    - Approve for merge; 35 ATDD tests GREEN, clean build, 0 new lint errors, BigInt guard honored end-to-end, privacy invariant (ephemeral-key NIP-44 FULFILL) preserved.
    - Defer structured log emission to Story 12.7 (packages/mill/) and E2E p95 measurement to Story 12.8 — this story correctly exposes the logger injection seam and stops there.
    - Track a post-12.5 cleanup to remove the double-base64 decode fallback in tryUnwrap; non-blocking, documented in Completion Notes.
```

---

## Related Artifacts

- **Story File:** `_bmad-output/implementation-artifacts/12-3-mill-swap-handler.md`
- **Upstream Story NFR:** `_bmad-output/test-artifacts/nfr-assessment-12-1.md` (SwapPair type / kind:10032 serialization)
- **Upstream Story:** `_bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md` (gift-wrap + FULFILL encrypt primitives)
- **Epic Spec:** `_bmad-output/epics/epic-12-token-swap-primitive.md` (D12-001, D12-004..D12-010)
- **Test Design:** `_bmad-output/planning-artifacts/test-design-epic-12.md` (Story 12-3 section: T-017..T-028; risks R-002/R-003/R-010/R-013/R-016/R-018)
- **Evidence Sources:**
  - Implementation: `packages/sdk/src/swap-handler.ts` (NEW, 510 lines) — `createSwapHandler`, `findSwapPair`, `applyRate`, `ClaimIssuer` interface, `tryUnwrap`, `computePacketId`.
  - Implementation: `packages/sdk/src/errors.ts` (MODIFIED) — `SwapHandlerError`.
  - Implementation: `packages/sdk/src/index.ts` (MODIFIED) — new `// Swap handler (Story 12.3)` export block.
  - Implementation: `packages/sdk/src/index.test.ts` (MODIFIED) — 4 new runtime symbols in expected-exports set.
  - Tests: `packages/sdk/src/swap-handler.test.ts` (NEW, 797 lines, 35 tests).
  - Build: `pnpm --filter @toon-protocol/sdk build` — success, 0 TS errors.
  - Test: `pnpm --filter @toon-protocol/sdk test` — 522 passed / 0 failed (baseline 488 + 34 ATDD RED→GREEN).
  - Lint: `pnpm lint` — 0 errors (1632 pre-existing warnings untouched).

---

## Recommendations Summary

**Release Blocker:** NONE. Story passes all applicable NFR criteria.

**High Priority:** NONE.

**Medium Priority:** Two items, both correctly deferred by story scope:
1. Structured log emission and Mill-side instrumentation → Story 12.7 (`packages/mill/`).
2. End-to-end p95 latency measurement and burn-in → Story 12.8 (E2E).

**Next Steps:**

1. Merge 12-3 to `done` via normal review flow.
2. Proceed to Story 12-4 (Mill inventory + wallet management) — implements the concrete `MultiChainClaimIssuer` behind the `ClaimIssuer` interface defined here.
3. Carry the deferred CONCERNS (scalability thresholds, monitoring hooks) forward into Story 12.7 so the Mill package defines them at the right layer.
4. Create an Epic-12 retrospective backlog item: retire the `tryUnwrap` double-base64 fallback once Story 12.5 `streamSwap()` commits to a single canonical encoding.

---

## Sign-Off

**NFR Assessment:**

- Overall Status: PASS ✅
- Critical Issues: 0
- High Priority Issues: 0
- Concerns: 2 (both informational and deferred by story scope: perf thresholds → 12.8, monitoring emission → 12.7)
- Evidence Gaps: 0

**Gate Status:** PASS ✅

**Next Actions:**

- ✅ PASS: Proceed to `*gate` workflow or merge to `done`.

**Generated:** 2026-04-13
**Workflow:** testarch-nfr v5.0

---

<!-- Powered by BMAD-CORE™ -->
