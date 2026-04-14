# Story 12.7 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md`
- **Git start**: `a02e18e6e6e5391522d6c2c9196c92047787278a`
- **Duration**: ~65 minutes wall-clock across 22 pipeline steps
- **Pipeline result**: success (all steps passed; E2E skipped as backend-only scaffold)
- **Migrations**: None

## What Was Built
Story 12.7 delivers the `startMill()` sender API: a package scaffold that composes Mill identity/keys, per-chain payment-channel signers, inventory, channel-state, `MultiChainClaimIssuer`, the NIP-59 swap handler on kind 1059, and a Hono `/health` endpoint — mirroring Town's `startTown()` shape. Ships with a `toon-mill` CLI (JSON config + env overlay) and a minimal fixture.

## Acceptance Criteria Coverage
All 14 ACs covered by automated tests. Full matrix in `_bmad-output/test-artifacts/traceability/12-7-start-mill-scaffold-trace.md` — P0 4/4, P1 9/9, P2 1/1. Coverage: 100%.

- [x] AC-1 Package exports (`package-structure.test.ts`)
- [x] AC-2 MillConfig validation (`mill.test.ts`)
- [x] AC-3 MillInstance shape + releaseAll (`mill.test.ts`, `channel-state.test.ts`)
- [x] AC-4 Composition pipeline T-055/056/058 (`mill.test.ts`)
- [x] AC-5 buildSignerAddresses EVM/Solana/Mina (`mill.test.ts`)
- [x] AC-6 kind:10032 build (`mill.test.ts`)
- [x] AC-7 Connector ownership (`mill.test.ts`)
- [x] AC-8 /health endpoint (`health.test.ts`)
- [x] AC-9 CLI main + env overlay (`cli.test.ts`)
- [x] AC-10 HandlerRegistry 1059 R-015 (`mill.test.ts`)
- [x] AC-11 MillStartError codes (`errors.test.ts`, `mill.test.ts`)
- [x] AC-12 Idempotent shutdown T-060 (`mill.test.ts`)
- [x] AC-13 No dependency cycle (`package-structure.test.ts`)
- [x] AC-14 Sprint-status flip (story/sprint-status.yaml)

## Files Changed

### Source (packages/mill/src/)
- **new**: `mill.ts`, `cli.ts` — primary scaffold + CLI
- **new**: `mill.test.ts`, `health.test.ts`, `cli.test.ts`, `package-structure.test.ts`
- **modified**: `errors.ts` (added `MillStartError` + 6 codes), `channel-state.ts` (`releaseAll()`), `index.ts` (barrel), `channel-state.test.ts`

### Packages
- **modified**: `packages/mill/package.json` (bin, deps), `packages/mill/tsup.config.ts` (dual entry)
- **modified**: `packages/sdk/src/handler-registry.ts` (added `get(kind)`)

### Fixtures
- **new**: `packages/mill/fixtures/mill.config.json`

### Artifacts
- **new**: `_bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md`
- **new**: `_bmad-output/test-artifacts/atdd-checklist-12-7.md`
- **new**: `_bmad-output/test-artifacts/nfr-assessment-12-7.md`
- **new**: `_bmad-output/test-artifacts/test-reviews/12-7-start-mill-scaffold-test-review.md`
- **new**: `_bmad-output/test-artifacts/traceability/12-7-start-mill-scaffold-trace.md`
- **modified**: `_bmad-output/implementation-artifacts/sprint-status.yaml` (12-7 → done)

## Pipeline Steps

| # | Step | Status | Key output |
|---|---|---|---|
| 1 | Create | ✅ | Story spec + sprint-status entry |
| 2 | Validate | ✅ | 9 adversarial fixes (HandlerRegistry API, bin shape, deps, publication path) |
| 3 | ATDD (retry) | ✅ | 38 red-phase it-blocks across 4 files + checklist |
| 4 | Develop | ✅ | `startMill()` + CLI + all supporting modules |
| 5 | Artifact Verify | ✅ | Status → review, Tasks checkboxed, Dev Agent Record complete |
| 6 | Frontend Polish | ⏭️ skipped (backend-only) |
| 7 | Lint/Typecheck | ✅ | tsup DTS clean, prettier clean |
| 8 | Test Verify | ✅ | 784 tests passing (mill 124 + sdk 660) |
| 9 | NFR | ⚠️ CONCERNS 66% (no release blocker; deferred items are explicitly 12.8 scope) |
| 10 | Test Automate | ✅ | +12 tests (releaseAll, env overlay branches) |
| 11 | Test Review | ✅ PASS 88/100 |
| 12 | Code Review #1 | ✅ 0C/2H/3M/2L fixed |
| 13 | Verify #1 | ✅ |
| 14 | Code Review #2 | ✅ 0C/1H/3M/3L fixed (Task 4.2 reopened as 12.8 scope) |
| 15 | Verify #2 | ✅ |
| 16 | Code Review #3 (security) | ✅ 0C/2H/3M/1L fixed + 6 new security tests |
| 17 | Verify #3 | ✅ Status → done |
| 18 | Semgrep Scan | ✅ 0 findings (1 doc-level `ws://` comment hardened to `wss://`) |
| 19 | Regression Lint | ✅ clean |
| 20 | Regression Test | ✅ 801 tests (mill 141 + sdk 660) |
| 21 | E2E | ⏭️ skipped (backend-only) |
| 22 | Trace | ✅ 14/14 ACs covered, gate PASS |

## Test Coverage
- **Tests generated**: `mill.test.ts` (22 it-blocks), `health.test.ts` (3), `cli.test.ts` (11), `package-structure.test.ts` (9), plus `errors.test.ts`/`channel-state.test.ts` extensions.
- **All 14 ACs have dedicated tests.** Full matrix in trace report.
- **Test count delta**: post-dev 784 → regression 801 (**+17**, no regression).

## Code Review Findings

| Pass | Critical | High | Medium | Low | Total | Fixed | Remaining |
|------|----------|------|--------|-----|-------|-------|-----------|
| #1   | 0        | 2    | 3      | 2   | 7     | 7     | 0         |
| #2   | 0        | 1    | 3      | 3   | 7     | 7     | 0         |
| #3   | 0        | 2    | 3      | 1   | 6     | 6     | 0         |
| **Total** | **0** | **5** | **9** | **6** | **20** | **20** | **0** |

Pass #3 focused on OWASP/security: prototype pollution (Object.create(null) + assertSafeKey), hex validation on secretKey, split-seed passphrase rejection, log scrubbing via `errSummary()`, `seenPacketIds` DoS documentation, silent `connectorUrl` WARN.

## Quality Gates
- **Frontend Polish**: skipped — backend-only scaffold (CLI + daemon).
- **NFR**: CONCERNS (66%) — 3 FAILs all trace to explicitly deferred Story 12.8 scope (auto-ConnectorNode, relay broadcast, HandlerRegistry.unregister). Not a release blocker.
- **Security Scan (semgrep)**: PASS — 0 runtime findings; one doc-level `ws://` JSDoc hardened to `wss://`.
- **E2E**: skipped — no UI. Real packet→FULFILL loop deferred to Story 12.8 E2E.
- **Traceability**: PASS — 14/14 ACs covered.

## Known Risks & Gaps
- **Auto-created `ConnectorNode` branch not wired** — `ownsConnector` hardcoded `false`; caller must supply `config.connector`. (Story 12.8 E2E scope.)
- **Channel-state key scheme mismatch** — `{assetCode}:{chain}:{channelId}` at provision vs `{assetCode}:{chain}:{senderPubkey}` at runtime lookup. Per-sender channel provisioning deferred to 12.8.
- **kind:10032 event built but not broadcast** — `knownPeers` publication is DEBUG-logged only; real SimplePool relay publication deferred.
- **`HandlerRegistry.unregister` missing** — GC-based cleanup accepted for scaffold scope.
- **`_handlerRegistry` on public `MillInstance`** — @internal JSDoc only (no TS-level stripping).
- **SDK `fromMnemonic` lacks BIP-39 passphrase** — `startMill()` hard-fails on non-empty passphrase to prevent split-seed identity mismatch.
- **`seenPacketIds` unbounded by default** — size cap belongs in `createSwapHandler` factory (Story 12.8 follow-up).

## Manual Verification
N/A — backend-only scaffold, no UI.

---

## TL;DR
Story 12.7 ships `startMill()` + CLI scaffold mirroring Town's pattern, with all 14 ACs covered (100% traceability), 801 tests passing, and 20 review findings fixed across 3 passes including a security-focused pass. NFR gate flags known scope reductions that are Story 12.8's explicit responsibility (auto-ConnectorNode, relay broadcast, per-sender channel provisioning) — no release blocker. Pipeline passed cleanly end-to-end; no manual action required.
