# Epic 21 Start Report

## Overview
- **Epic**: 21 — Townhouse: Node Provider Dashboard & Orchestrator
- **Git start**: `7b479621ea5fa44a1d9573b3316830426b0afc9a`
- **Duration**: ~12 minutes wall-clock
- **Pipeline result**: success
- **Previous epic retro**: N/A (Epic 20 is backlog, never started)
- **Baseline test count**: 5014

## Previous Epic Action Items

Epic 20 (Overmind Swarm) is in `backlog` — never started. No retrospective exists. Its entire dependency chain (Epics 13, 16, 17, 18) is also in backlog. No action items to resolve.

| # | Action Item | Priority | Resolution |
|---|------------|----------|------------|
| — | No action items | — | Epic 20 never started |

## Baseline Status
- **Lint**: pass — 0 errors, 1886 warnings (all `warn`-level: `no-non-null-assertion`, `no-explicit-any`)
- **Format**: pass — all files clean (Prettier)
- **Tests**: 5014/5014 passing (0 fixed during cleanup)
- **Skipped packages**: pet-circuit (WASM memory), mina-zkapp (broken ts-node dep, pre-existing)

## Epic Analysis
- **Stories**: 17 stories across 3 phases

| Phase | Stories | Description |
|-------|---------|-------------|
| Phase 1: Orchestrator Core | 21.1–21.7 | Package scaffold, Docker orchestration, connector, wallet, 3 Dockerfiles |
| Phase 2: API + Dashboard | 21.8–21.13 | REST/WS API, dashboard SPA home + 4 detail views |
| Phase 3: First-Run + Polish | 21.14–21.17 | Setup wizard, ATOR privacy, E2E tests, publish |

- **Oversized stories** (>8 ACs): **Story 21.9** (9 ACs) — recommend splitting into 21.9a (SPA scaffold + node cards) and 21.9b (activity feed + status indicators)
- **Borderline**: Story 21.2 (8 ACs), Story 21.16 (8 ACs) — monitor during implementation

### Dependencies
- **Cross-epic** (all satisfied): Epic 1-3 (ILP), Epic 5 (DVM kinds), Epic 12 (Token Swap + ATOR transport)
- **External risk**: `ghcr.io/toon-protocol/connector` image — verify exists and supports standalone mode before Story 21.3

### Design patterns needed
1. **Framework mismatch**: Epic specifies Fastify for Story 21.8, but project uses **hono** everywhere. Recommend hono for consistency.
2. **Host-native orchestrator** (dockerode) — new pattern for this codebase
3. **NodeProvider abstraction** — generic interface for Town/Mill/DVM, established in Story 21.2
4. **Config file** (`~/.townhouse/config.yaml`) — new pattern (other packages use env vars)

### Recommended story order

| Order | Story | Rationale |
|-------|-------|-----------|
| 1 | 21.1 | Foundation — scaffold, CLI, config schema |
| 2–3 (parallel) | 21.4, 21.2 | Wallet and Docker orchestration are independent |
| 4 | 21.3 | Connector integration — critical seam |
| 5–7 (parallel) | 21.5, 21.6, 21.7 | Three Dockerfiles, independent |
| 8 | 21.8 | API server — bridges orchestrator to dashboard |
| 9 | 21.9 | Dashboard home view (recommend split) |
| 10–13 (parallel) | 21.10, 21.11, 21.12, 21.13 | Four detail views, independent |
| 14 (parallel w/ 10–13) | 21.15 | ATOR transport |
| 15 | 21.14 | First-run wizard |
| 16 | 21.16 | E2E integration tests |
| 17 | 21.17 | Publish package |

**Critical path**: 21.1 → 21.2 → 21.3 → 21.8 → 21.9 → 21.14 → 21.16 → 21.17 (8 stories sequential)

## Test Design
- **Epic test plan**: `_bmad-output/planning-artifacts/test-design-epic-21.md`
- **Total test scenarios**: 99 (39 unit, 26 integration, 34 E2E/Playwright)
- **Key risks identified**:
  - R-003: Connector startup ordering (score 9, highest)
  - BIP-44 account index allocation (blocker — needs documented indices)
  - API security model (localhost-only vs. token auth — needs design decision)
  - Docker build strategy for monorepo Dockerfiles
  - Port allocation: test infra uses 21000-21999 range

## Pipeline Steps

### Step 1: Previous Retro Check
- **Status**: success
- **Duration**: ~30s
- **What changed**: none (read-only)
- **Key decisions**: Searched multiple paths for retro files
- **Issues found & fixed**: 0
- **Remaining concerns**: none

### Step 2: Tech Debt Cleanup
- **Status**: skipped
- **Duration**: —
- **Reason**: No action items from step 1

### Step 3: Lint Baseline
- **Status**: success
- **Duration**: ~1 minute
- **What changed**: none (already clean)
- **Key decisions**: 1886 warnings are warn-level only, not blocking
- **Issues found & fixed**: 0
- **Remaining concerns**: none

### Step 4: Test Baseline
- **Status**: success
- **Duration**: ~4 minutes
- **What changed**: none (read-only)
- **Key decisions**: Ran 10 packages in batches of 2-3; skipped pet-circuit (WASM), mina-zkapp (broken dep)
- **Issues found & fixed**: 0 (5014 tests passed first run)
- **Remaining concerns**: mina-zkapp has pre-existing broken test setup

### Step 5: Epic Overview Review
- **Status**: success
- **Duration**: ~2 minutes
- **What changed**: none (analysis only)
- **Key decisions**: Flagged 21.9 as oversized, identified Fastify/hono mismatch, mapped dependency graph
- **Issues found & fixed**: 0
- **Remaining concerns**: connector image availability, framework choice

### Step 6: Sprint Status Update
- **Status**: success
- **Duration**: ~10s
- **What changed**: `sprint-status.yaml` — epic-21: backlog → in-progress
- **Key decisions**: none
- **Issues found & fixed**: 0
- **Remaining concerns**: none

### Step 7: Test Design
- **Status**: success
- **Duration**: ~4 minutes
- **What changed**: created `_bmad-output/planning-artifacts/test-design-epic-21.md` (561 lines)
- **Key decisions**: Port range 21000-21999 for test infra, 99 test scenarios weighted toward E2E
- **Issues found & fixed**: 0
- **Remaining concerns**: port allocation validation, API security model decision needed

## Ready to Develop
- [x] All critical retro actions resolved (none needed)
- [x] Lint and tests green (zero failures, 5014 tests passing)
- [x] Sprint status updated (epic-21: in-progress)
- [x] Story order established (17 stories, critical path identified)

## Next Steps
**First story: 21.1 — Package Scaffold + CLI Entrypoint**

Preparation notes:
1. **Decide**: hono vs. Fastify for Story 21.8 before it starts (recommend hono)
2. **Verify**: `ghcr.io/toon-protocol/connector` image availability before Story 21.3
3. **Consider**: splitting Story 21.9 (9 ACs) before it starts
4. **Document**: BIP-44 account index allocation (SDK=1, Mill=2, Townhouse=?) before Story 21.4

---

## TL;DR
Epic 21 (Townhouse) is ready to start with a green baseline: 5014 tests passing, zero lint errors, sprint status updated to in-progress. The epic has 17 stories across 3 phases with a critical path of 8 sequential stories. Key pre-implementation decisions needed: hono vs. Fastify for the API layer, connector image availability, and BIP-44 index allocation. Test design covers 99 scenarios with connector startup ordering identified as the highest risk.
