# Story 12.11 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md`
- **Git start**: `7ca7d45648632a4311a1a92fdec4a2ddebf1fc21`
- **Duration**: ~45 min (Steps 3–22; Steps 1–2 completed in prior session)
- **Pipeline result**: success with upstream-blocker (Status: `blocked`, not `done`)
- **Migrations**: None (infra-only story)

## What Was Built
Split a single shared Docker image (`Dockerfile.oyster` / `toon:optimized`) into two dedicated images by creating `docker/Dockerfile.sdk-e2e` (`toon:sdk-e2e`) for the SDK E2E harness, decoupling the SDK E2E infrastructure from the Oyster TEE image. Removes supervisord, attestation server, and port 1300 from the SDK E2E image; runs a minimal non-root Node process. Unblocks Story 12.10 (structurally) and enables independent evolution of test-harness vs TEE images.

## Acceptance Criteria Coverage
All 14 ACs mapped 1:1 to shell probes in `_bmad-output/test-artifacts/atdd-checklist-12-11.md`.
- [x] AC-1: Dockerfile.sdk-e2e exists with header & example build cmd — static probe PASS
- [x] AC-2: `FROM node:20-alpine` + `pnpm@8.15.0` pinned — static probe PASS
- [x] AC-3: no `cd docker && pnpm run build`; direct esbuild on entrypoint-sdk — static probe PASS
- [x] AC-4: no supervisord, no port 1300, EXPOSE 3000/3100/7100 only — anchored static probe PASS
- [x] AC-5: CMD is `node /app/entrypoint-sdk.js` — static probe PASS
- [x] AC-6: runtime deps (better-sqlite3, ethers@6, express@4, @ardrive/turbo-sdk) present — static probe PASS
- [x] AC-7: non-root `USER toon` (uid/gid 1001) before CMD — static probe PASS (awk ordering)
- [x] AC-8: `scripts/sdk-e2e-infra.sh` builds `Dockerfile.sdk-e2e` as `toon:sdk-e2e` — static probe PASS
- [x] AC-9: `docker-compose-sdk-e2e.yml` peer1 & peer2 image = `toon:sdk-e2e` — static probe PASS
- [ ] AC-10: Oyster non-regression baseline — **blocked-upstream** (probe authored)
- [ ] AC-11: SDK E2E infra up + 6 health probes — **blocked-upstream** (probe authored)
- [ ] AC-12: clean `down` leaves no containers — **blocked-upstream** (probe authored)
- [ ] AC-13: SDK E2E regression parity vs baseline — **blocked-upstream** (reuses existing 9 docker-*.test.ts files)
- [x] AC-14: CLAUDE.md references Dockerfile.sdk-e2e — static probe PASS

**Blocked-upstream cause**: `@toon-protocol/memvid-node` lacks a Linux build artifact (napi-rs native addon; Rust `memvid-core` in sibling repo). Requires follow-up story.

## Files Changed

**Code / Infra**
- `docker/Dockerfile.sdk-e2e` (new, 175+ lines) — minimal SDK E2E peer image
- `scripts/sdk-e2e-infra.sh` (modified, L84–85) — build repointed at `Dockerfile.sdk-e2e` → `toon:sdk-e2e`
- `docker-compose-sdk-e2e.yml` (modified, L161, L256) — peer1/peer2 image tag → `toon:sdk-e2e`
- `.dockerignore` (modified) — exclude `packages/memvid-node/target/`, `packages/*/target/`, `**/Cargo.lock`, `*.node`
- `CLAUDE.md` (modified) — added Dockerfile.sdk-e2e row under "Where to Find Things"

**Artifacts**
- `_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md` — Dev Agent Record, Code Review Record (3 passes), Change Log populated; Status = `blocked`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `12-11-...: blocked`
- `_bmad-output/test-artifacts/atdd-checklist-12-11.md` (new) — 14 shell probes
- `_bmad-output/test-artifacts/nfr-assessment-12-11.md` (new) — NFR rollup
- `_bmad-output/test-artifacts/test-reviews/test-review-12-11-20260415.md` (new)
- `_bmad-output/test-artifacts/traceability-report-12-11.md` (new)

## Pipeline Steps

### Step 1: Create — skipped (file existed)
### Step 2: Validate — skipped (prior session)
### Step 3: ATDD — success (~6 min) — 14 shell probes mapped 1:1 to ACs; no TS tests (story prohibits)
### Step 4: Develop — success-partial (~10 min) — all structural deliverables; AC-10(a) escape clause invoked for upstream defect
### Step 5: Post-Dev Artifact Verify — success (~1 min) — Status flipped to `review`
### Step 6: Frontend Polish — skipped (no UI)
### Step 7: Post-Dev Lint — success — no issues in 12.11 files (13 pre-existing errors in mill/ from 12.10)
### Step 8: Post-Dev Test — success (10/10 probes pass)
### Step 9: NFR — CONCERNS — structural PASS; runtime gates deferred upstream; attack surface reduced vs Oyster
### Step 10: Test Automate — no gaps (all ACs mapped)
### Step 11: Test Review — 82/100 (B); 3 probe upgrades applied (AC-4 anchored, AC-7 ordering, new runtime-artifact probe block)
### Step 12: Code Review #1 — 2C / 3H / 3M / 3L; C/H/M fixed, 3 Lows deferred
### Step 13: Review #1 Artifact Verify — success (created Code Review Record section)
### Step 14: Code Review #2 — 0C / 1H / 2M / 2L; all H/M/L fixed
### Step 15: Review #2 Artifact Verify — success
### Step 16: Code Review #3 — 0 actionable; OWASP Top 10 clean; 2 non-actionable items inherited from Oyster baseline
### Step 17: Review #3 Artifact Verify — success (Status correctly preserved as `blocked`, not `done`)
### Step 18: Security Scan (semgrep) — clean for 12.11 files (2 findings pre-date this story)
### Step 19: Regression Lint — clean
### Step 20: Regression Test — 10/10 probes pass, no count decrease
### Step 21: E2E — skipped (no UI)
### Step 22: Trace — gate CONCERNS; 100% design coverage; 4 ACs blocked-upstream (not uncovered)

## Test Coverage
- 14 shell probes authored in `atdd-checklist-12-11.md`, mapped 1:1 to ACs
- 10/14 executable now (static); 4/14 gated on upstream memvid-node fix
- Existing `packages/sdk/tests/e2e/docker-*.test.ts` (9 files) re-used as AC-13 parity gate
- **Test count**: post-dev 10 → regression 10 (delta: 0)

## Code Review Findings

| Pass | Critical | High | Medium | Low | Total | Fixed | Remaining |
|------|----------|------|--------|-----|-------|-------|-----------|
| #1   | 2        | 3    | 3      | 3   | 11    | 8     | 3 (Lows, deferred) |
| #2   | 0        | 1    | 2      | 2   | 5     | 5     | 0 |
| #3   | 0        | 0    | 0      | 0   | 0     | 0     | 0 |

## Quality Gates
- **Frontend Polish**: skipped — backend/infra-only story
- **NFR**: CONCERNS — structural PASS; runtime deferred upstream; security posture improved
- **Security Scan (semgrep)**: PASS — no 12.11-introduced findings
- **E2E**: skipped — no UI
- **Traceability**: CONCERNS — 100% design coverage; 4 ACs blocked-upstream, 0 uncovered

## Known Risks & Gaps
- **Upstream block**: `@toon-protocol/memvid-node` lacks Linux build artifact. Requires follow-up story before AC-10/11/12/13 runtime gates can execute. Story 12.10 (downstream) remains blocked on the same upstream defect.
- **Deferred cosmetic Lows** (L1/L2/L3): single-layer Dockerfile style improvements; tracked in story's "Review Follow-ups (AI)" subsection.
- **Inherited baseline non-actionables** (from pass #3): `FROM node:20-alpine` not digest-pinned, floating major versions in `npm install ethers@6 express@4 @ardrive/turbo-sdk`. Both required for AC-2/AC-6 parity with Oyster; address in a separate hardening epic.

## Manual Verification
N/A — no UI impact.

---

## TL;DR
Story 12.11 structurally splits the Oyster/SDK-E2E shared image into two dedicated images with full AC coverage via 14 shell probes; static verification (10/14) passes cleanly through three code-review passes, NFR, security scan, lint, and regression. Runtime verification (AC-10/11/12/13) is **blocked-upstream** by a pre-existing `@toon-protocol/memvid-node` Linux build-artifact defect that also blocks Story 12.10; story Status is correctly `blocked` (not `done`). Action item: create a follow-up story to restore the memvid-node Linux build path, then re-run Tasks 0.2 / 4.1 / 5 / 6 to close this story.
