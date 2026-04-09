---
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
lastSaved: '2026-03-29'
workflowType: 'testarch-test-design'
inputDocuments:
  - _bmad-output/epics/epic-10-rig-e2e-integration-tests.md
  - _bmad-output/test-artifacts/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design-qa.md
---

# Test Design: Epic 10 — Rig E2E Integration Test Suite

**Date:** 2026-03-29
**Author:** Jonathan
**Status:** Draft
**Epic:** `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md`

---

## Executive Summary

**Scope:** Risk-based test design for Epic 10 — 18 stories delivering end-to-end integration tests for the Rig (Forge-UI). The epic has three phases: infrastructure + seed library (10.1), seed scripts performing incremental git pushes via ToonClient + ILP through Arweave DVM (10.2-10.9), and Playwright browser specs verifying read-side UI rendering (10.10-10.18). All tests run against real SDK E2E infrastructure (Anvil + 2 Docker peers) with no mocks.

**Nature of Testing:** This epic IS the test suite. The deliverables are test infrastructure, seed scripts, and Playwright specs. The test design therefore focuses on: risk mitigation strategies for the test infrastructure itself, flakiness prevention for CI, coexistence with the existing 6 E2E specs from Epic 8, and definition of done for coverage confidence.

**Risk Summary:**

- Total risks identified: 12
- High-priority risks (score >= 6): 5
- Critical categories: INFRA (3 risks), FLAKY (3 risks), STATE (3 risks), SCOPE (3 risks)

**Estimated Effort:**

- Phase 1 (infra + seed lib): 3-4 days
- Phase 2 (seed scripts + orchestrator): 4-5 days
- Phase 3 (Playwright specs): 5-7 days
- **Total:** ~12-16 days (2-3 weeks with 1 engineer)

---

## Not in Scope

| Item | Reasoning | Mitigation |
|------|-----------|------------|
| **Write-side UI testing** | Forge-UI is read-only; write-side handlers are stubs | Seed scripts exercise the write path via ToonClient |
| **Arweave permanence verification** | Free tier uploads may expire; not a test concern | Seeds use `seedShaCache()` from kind:30618 arweave tags |
| **Performance/load testing** | No NFR targets for Forge-UI rendering | Monitor Playwright timeouts as a proxy signal |
| **Cross-browser testing** | Single browser (Chromium) sufficient for E2E validation | Add Firefox/WebKit in future CI matrix if needed |
| **Mobile viewport testing** | Forge-UI is desktop-first | Deferred to UX-focused epic |
| **Existing Epic 8 spec regression** | 6 existing specs are not being rewritten | Coexistence strategy defined below |

---

## Risk Assessment

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description | Prob | Impact | Score | Mitigation | Owner | Timeline |
|---------|----------|-------------|------|--------|-------|------------|-------|----------|
| **R10-001** | **INFRA** | Arweave free tier latency — GraphQL indexing lag (5-30s) causes seed scripts to publish git objects but Forge-UI cannot resolve them yet, producing flaky spec failures | 3 | 3 | **9** | (1) Seed scripts poll kind:30618 arweave tags to confirm indexing before proceeding. (2) `git-builder.ts` includes `waitForArweaveIndex(txId, timeoutMs=30000)` retry helper. (3) Specs use `expect.poll()` with 15s timeout on data-dependent assertions. (4) Orchestrator adds 5s buffer between DVM uploads. | Dev | Story 10.1 |
| **R10-002** | **INFRA** | Multi-client payment channel bootstrapping — 3 ToonClients (Alice/Bob/Charlie) each need funded Anvil wallets + open payment channels to Peer1. Sequential channel opening may hit nonce races or gas estimation failures on Anvil. | 2 | 3 | **6** | (1) `clients.ts` bootstraps channels sequentially (Alice, then Bob, then Charlie) with explicit nonce management. (2) Each client waits for channel open confirmation before next client starts. (3) Use Anvil accounts #3/#4/#5 (pre-funded with 10K ETH each). (4) Retry wrapper with 3 attempts on channel open. | Dev | Story 10.1 |
| **R10-003** | **STATE** | Seed script fragility — push scripts run in sequence; if any Arweave DVM upload fails mid-chain, all downstream pushes break because parent commit SHAs are unresolvable. One failure cascades to 7+ subsequent failures. | 3 | 2 | **6** | (1) Each push script validates its prerequisites by checking `state.json` for required SHAs before running. (2) Orchestrator logs specific failure point and stops immediately (fail-fast, no silent skip). (3) Individual push scripts are idempotent: re-running skips already-uploaded objects (SHA-to-txId cache). (4) `state.json` is written incrementally after each successful push (not all-at-once at end). | Dev | Story 10.9 |
| **R10-004** | **STATE** | Cross-story state sharing — `state.json` is the sole handoff between seed layer and spec layer. If stale (cached from prior run with different repo ID/event IDs), specs test against ghost data. If missing, specs fail with cryptic errors. | 2 | 3 | **6** | (1) `state.json` includes a generation timestamp; Playwright `globalSetup` checks freshness (default 10 min TTL). (2) Specs import state via typed `loadSeedState()` that validates required fields exist and throws descriptive errors for missing keys. (3) `playwright.config.ts` `globalSetup` deletes stale `state.json` before re-seeding. (4) CI always seeds fresh (no caching). | Dev | Story 10.9 |
| **R10-005** | **FLAKY** | Arweave DVM upload size limits — free tier caps at 100KB per upload. If seed scripts create git objects (especially trees with many entries) that exceed this limit, uploads silently fail or return errors that break the chain. | 2 | 3 | **6** | (1) `git-builder.ts` validates each object size < 95KB before upload (5KB safety margin). (2) Seed scripts use minimal file content (short strings, not real code). (3) If a single tree exceeds limit, split into sub-tree uploads. (4) Upload wrapper asserts DVM response contains valid Arweave txId. | Dev | Story 10.1 |

### Medium-Priority Risks (Score 3-5)

| Risk ID | Category | Description | Prob | Impact | Score | Mitigation |
|---------|----------|-------------|------|--------|-------|------------|
| **R10-006** | **SCOPE** | Existing 6 E2E specs coexistence — Epic 8 specs (`repo-list.spec.ts`, `tree-view.spec.ts`, `navigation.spec.ts`, `blob-view.spec.ts`, `issues.spec.ts`, `pulls.spec.ts`) rely on manually seeded data or different relay state. New specs + `globalSetup` seeding may conflict. | 2 | 2 | **4** | (1) Epic 10 specs live in `tests/e2e/specs/` subdirectory (not root `tests/e2e/`). (2) Playwright config uses `testDir: './tests/e2e/specs'` for Epic 10 suite; existing specs stay at `tests/e2e/*.spec.ts`. (3) Separate Playwright projects in config: `legacy` (no globalSetup, existing specs) and `rig-e2e` (with globalSetup, new specs). (4) CI runs both projects sequentially. |
| **R10-007** | **FLAKY** | Vite dev server cold start — `webServer.command: 'pnpm dev'` may take >15s on CI, causing Playwright to timeout before the app is ready. | 2 | 1 | **2** | (1) Increase `webServer.timeout` from 15s to 30s. (2) Use `reuseExistingServer: true` (already set). (3) CI step starts Vite server before Playwright run and waits for health. |
| **R10-008** | **STATE** | Relay event ordering — Seed scripts publish events rapidly; relay may reorder or batch events. Specs expecting specific chronological order of comments or status events may see wrong ordering. | 2 | 2 | **4** | (1) Seed scripts add explicit `created_at` timestamps with 1-second gaps between related events. (2) Specs sort displayed items by timestamp, not insertion order. (3) Comment thread specs verify content presence, not strict visual ordering. |
| **R10-009** | **FLAKY** | Playwright selector brittleness — Specs use CSS class selectors (`.repo-card`, `.repo-name`) which break if shadcn-ui component class names change. | 2 | 2 | **4** | (1) New specs prefer `data-testid` attributes over CSS classes. (2) Story 10.1 adds `data-testid` attributes to Forge-UI components as needed. (3) Existing Epic 8 specs are not refactored (out of scope) but new specs set the pattern. |
| **R10-010** | **SCOPE** | Blame view implementation gap — Story 10.18 tests blame view, but blame may not be fully implemented in Forge-UI yet (Epic 8 scope). | 1 | 2 | **2** | (1) Story 10.18 is lowest priority; defer if blame view is not implemented. (2) Spec asserts blame UI exists and renders; does not test algorithmic correctness. |

### Low-Priority Risks (Score 1-2)

| Risk ID | Category | Description | Prob | Impact | Score | Mitigation |
|---------|----------|-------------|------|--------|-------|------------|
| **R10-011** | **INFRA** | Anvil deterministic addresses drift — If Anvil contract deployment scripts change, hardcoded addresses in `constants.ts` break seed scripts. | 1 | 2 | **2** | Re-export constants from `docker-e2e-setup` (single source of truth); never hardcode in seed lib. |
| **R10-012** | **SCOPE** | SHA collision in minimal test data — Extremely unlikely with SHA-1 over small object set. | 1 | 1 | **1** | No mitigation needed; flag if it ever occurs. |

---

## Test Strategy by Story Phase

### Phase 1: Infrastructure (Story 10.1)

**What is delivered:** Playwright config, ToonClient factory, git-builder, event-builders, publish wrapper, constants.

**Verification approach:**

| Component | Verification | Priority |
|-----------|-------------|----------|
| `clients.ts` — 3 ToonClient instances | Smoke test: each client can `publishEvent()` a kind:1 note and receive it back via relay subscription | P0 |
| `git-builder.ts` — SHA-to-txId tracking | Unit test: `buildGitBlob("hello")` produces correct SHA; upload mock validates kind:5094 event structure | P0 |
| `event-builders.ts` — NIP-34 builders | Unit test: each builder produces events with correct kind, required tags (`a`, `e`, `d`, `subject`, `t`), valid Nostr structure | P0 |
| `publish.ts` — ILP claim wrapper | Integration test: publish via ToonClient to Peer1, verify event stored on relay | P1 |
| `constants.ts` — re-exports | Compile-time: TypeScript import resolution validates constants exist | P2 |
| `playwright.config.ts` — globalSetup | Integration: `globalSetup` runs seed-all, produces `state.json` | P1 |

**Flakiness mitigation for Phase 1:**
- ToonClient factory includes a `healthCheck()` that verifies BLS endpoint responds before returning clients.
- `git-builder.ts` SHA computation is deterministic and can be unit-tested without infrastructure.
- Event builders are pure functions; unit tests have zero flakiness risk.

---

### Phase 2: Seed Scripts (Stories 10.2-10.8)

**What is delivered:** 7 push scripts that incrementally build git repo state on Arweave via the TOON relay.

**Verification approach:** Each seed script is both a test deliverable AND testable. Verification happens at two levels:

**Level 1 — Script correctness (verified during development):**

| Script | Key Assertions | Priority |
|--------|---------------|----------|
| `push-01-init.ts` | 3 blobs + 2 trees + 1 commit uploaded; kind:30617 has `d` tag + `name`; kind:30618 has `r` tag with main ref | P0 |
| `push-02-nested.ts` | Only delta objects uploaded (not re-uploading Push 1 objects); depth-4 path exists in tree | P0 |
| `push-03-branch.ts` | kind:30618 contains both `refs/heads/main` and `refs/heads/feature/add-retry` | P0 |
| `push-04-branch-work.ts` | Commit parent chain intact (push-04 -> push-03 -> push-02); modified `src/index.ts` blob has new SHA | P1 |
| `push-05-tag.ts` | kind:30618 includes `refs/tags/v1.0.0`; no new git objects uploaded | P1 |
| `push-06-prs.ts` | 2 kind:1617 events; kind:1630 + kind:1631 status events reference correct PR event IDs | P0 |
| `push-07-issues.ts` | 2 kind:1621 events with `t` tags; 5 kind:1622 comments with correct `e` tag threading | P0 |
| `push-08-close.ts` | kind:1632 references Issue #2 event ID | P1 |

**Level 2 — State integrity (verified by orchestrator):**

After all pushes, orchestrator validates `state.json` contains:
- `repoId` (non-empty string)
- `ownerPubkey` (64-char hex)
- `commits` (array with >= 4 entries, each with SHA + txId)
- `branches` (array containing "main" and "feature/add-retry")
- `tags` (array containing "v1.0.0")
- `issues` (array with 2 entries, each with eventId)
- `prs` (array with 2 entries, each with eventId + statusKind)
- `comments` (array with >= 5 entries)

**Flakiness mitigation for Phase 2:**

1. **Arweave indexing lag (R10-001):** Each push script includes a `confirmUpload(txId)` step that polls the Arweave GraphQL endpoint (or the DVM result event) with exponential backoff (100ms, 200ms, 400ms... up to 30s total). Script does not return success until confirmation.
2. **DVM upload failure (R10-003):** Each push wraps its DVM uploads in a retry loop (max 3 attempts, 2s delay). On final failure, the script throws with a descriptive error including the object SHA and size.
3. **Payment channel issues (R10-002):** If `publishEvent()` fails with a payment error, the script logs the client name and ILP error code, then retries once after a 5s delay (channel may need time to settle).
4. **Object size limits (R10-005):** Seed file content is deliberately minimal — `README.md` is 50 bytes, `src/index.ts` is 80 bytes, etc. Total per-push upload size stays well under 50KB.

---

### Phase 3: Orchestrator (Story 10.9)

**What is delivered:** `seed-all.ts` — single entry point that runs all pushes in sequence and exports state.

**Verification approach:**

| Scenario | Expected Behavior | Priority |
|----------|-------------------|----------|
| Cold run (no `state.json`) | Runs all 8 pushes, writes `state.json`, exits 0 | P0 |
| Warm run (fresh `state.json`, < 10 min) | Skips seeding, exits 0 immediately | P0 |
| Stale run (`state.json` > 10 min) | Deletes stale file, re-seeds from scratch | P1 |
| Infrastructure down (Peer1 unreachable) | `checkAllServicesReady()` fails, exits non-zero with descriptive message | P0 |
| Mid-chain failure (push-03 fails) | Exits non-zero, `state.json` contains push-01 + push-02 state only, logs point to push-03 | P1 |
| Total seed time | < 60 seconds end-to-end (excluding Arweave indexing wait) | P1 |

**Flakiness mitigation for Phase 3:**

1. **Service readiness:** `checkAllServicesReady()` polls Peer1 BLS (`localhost:19100/health`), Peer2 BLS (`localhost:19110/health`), and Anvil (`localhost:18545`) with 30s timeout before starting seeds.
2. **Freshness check race:** If two Playwright workers both check `state.json` freshness simultaneously, use a file lock (or Playwright's `globalSetup` single-execution guarantee) to prevent double-seeding.
3. **CI cold cache:** CI environments always delete `state.json` before running, ensuring deterministic state.

---

### Phase 4: Playwright Specs (Stories 10.10-10.18)

**What is delivered:** 12 spec files covering all Forge-UI read-side flows.

**Verification approach — spec-by-spec coverage map:**

| Story | Spec File(s) | Seeded Data Dependency | Risk | Priority |
|-------|-------------|----------------------|------|----------|
| 10.10 | `repo-list.spec.ts` | Repo announcement (push-01) | Low | P0 |
| 10.11 | `deep-nav.spec.ts` | Nested dirs (push-02) | **High** (R10-001 + known depth bug) | P0 |
| 10.12 | `file-view.spec.ts` | Files from push-01/02 | Low | P1 |
| 10.13 | `branch-switch.spec.ts` | Feature branch (push-03/04) | Medium (R10-001) | P0 |
| 10.14 | `tag-view.spec.ts` | Tag (push-05) | Low | P1 |
| 10.15 | `commit-log.spec.ts`, `commit-detail.spec.ts` | Multiple commits (push-01-04) | Medium | P1 |
| 10.16 | `issue-list.spec.ts`, `issue-detail.spec.ts` | Issues + comments (push-07/08) | Medium | P0 |
| 10.17 | `pr-list.spec.ts`, `pr-detail.spec.ts` | PRs + statuses (push-06) | Medium | P0 |
| 10.18 | `blame.spec.ts` | Multi-commit file (push-01/02) | **High** (R10-010, may not be implemented) | P2 |

**Flakiness mitigation for Phase 4:**

1. **Data loading delays:** All specs use `expect(locator).toBeVisible({ timeout: 15000 })` for initial data-dependent assertions. First assertion per spec is the "data loaded" gate.
2. **Selector stability (R10-009):** Specs use `data-testid` attributes exclusively for structural assertions. Visual text assertions use `getByText()` or `getByRole()`.
3. **Relay query timing:** Specs do NOT assume immediate relay response. After navigation, specs wait for a known element (e.g., file tree root, issue title) before asserting details.
4. **Parallel safety:** Each spec reads from `state.json` (immutable after globalSetup) and performs read-only UI interactions. No spec modifies state. Full parallelism is safe.
5. **Retry policy:** `playwright.config.ts` sets `retries: 1` for CI (not local) to absorb rare timing issues. Any test that fails twice is a real bug.

---

## Existing E2E Spec Coexistence Strategy

Epic 8 produced 6 E2E specs in `packages/rig/tests/e2e/`:

| Existing Spec | Overlap with Epic 10 | Strategy |
|--------------|----------------------|----------|
| `repo-list.spec.ts` | Direct overlap with 10.10 | Epic 10 spec in `specs/` subdirectory; existing spec untouched |
| `tree-view.spec.ts` | Partial overlap with 10.11 | Epic 10 covers deeper depth; existing spec untouched |
| `navigation.spec.ts` | Partial overlap with 10.11 | Epic 10 is more systematic; existing spec untouched |
| `blob-view.spec.ts` | Direct overlap with 10.12 | Epic 10 spec tests more file types; existing spec untouched |
| `issues.spec.ts` | Direct overlap with 10.16 | Epic 10 covers multi-author threading; existing spec untouched |
| `pulls.spec.ts` | Direct overlap with 10.17 | Epic 10 covers status lifecycle; existing spec untouched |

**Playwright config approach:**

```typescript
// playwright.config.ts — two projects
export default defineConfig({
  projects: [
    {
      name: 'legacy',
      testDir: './tests/e2e',
      testMatch: '*.spec.ts',       // Root-level specs only
      testIgnore: 'specs/**',       // Exclude Epic 10 subdirectory
      // No globalSetup — relies on existing manual seeding
    },
    {
      name: 'rig-e2e',
      testDir: './tests/e2e/specs',
      globalSetup: './tests/e2e/seed/seed-all.ts',
      dependencies: [],             // Independent of legacy project
    },
  ],
  // Shared settings
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
```

**Deprecation path:** Once Epic 10 specs are stable and cover all existing spec scenarios, the legacy specs can be removed (separate cleanup story, not part of Epic 10).

---

## CI Integration Approach

### Pipeline Design

```
┌─────────────────────────────────────────────────────────┐
│ CI Job: rig-e2e                                         │
│                                                         │
│ 1. pnpm install                                         │
│ 2. pnpm build (all packages)                            │
│ 3. ./scripts/sdk-e2e-infra.sh up                        │
│ 4. Wait for health checks (Peer1, Peer2, Anvil)         │
│ 5. cd packages/rig && npx playwright install chromium    │
│ 6. cd packages/rig && npx playwright test --project=rig-e2e │
│ 7. Upload test-results/ as artifact (on failure)        │
│ 8. ./scripts/sdk-e2e-infra.sh down                      │
└─────────────────────────────────────────────────────────┘
```

### CI-Specific Configuration

| Setting | Local | CI | Rationale |
|---------|-------|-----|-----------|
| `retries` | 0 | 1 | CI absorbs rare timing; local sees real failures |
| `state.json` caching | 10 min TTL | Always re-seed | CI must be deterministic |
| `webServer.timeout` | 15s | 30s | CI runners are slower |
| `timeout` (per test) | 30s | 45s | Arweave indexing slower on CI |
| Parallelism | `workers: 4` | `workers: 2` | CI has fewer cores |
| Trace | Off | On failure | Debug CI-only failures |

### Artifact Collection (on failure)

- Playwright HTML report (`playwright-report/`)
- Playwright traces (`test-results/*/trace.zip`)
- Seed orchestrator log (`seed/seed.log`)
- `state.json` snapshot at failure time
- Docker container logs (`docker compose logs`)

### When to Run

| Trigger | Scope |
|---------|-------|
| PR touching `packages/rig/` | Full rig-e2e suite |
| PR touching `packages/client/` or `packages/core/` | Full rig-e2e suite (dependency) |
| Nightly | Full rig-e2e suite + legacy suite |
| Manual dispatch | Full rig-e2e suite |

---

## Flakiness Mitigation Summary

All flakiness mitigations consolidated:

| Source | Mitigation | Implemented In |
|--------|-----------|----------------|
| Arweave GraphQL indexing lag | Poll-based confirmation with exponential backoff in seed scripts; 15s timeout in spec assertions | `git-builder.ts`, all specs |
| Payment channel bootstrap race | Sequential client bootstrap; retry wrapper; explicit nonce management | `clients.ts` |
| DVM upload transient failure | 3-attempt retry per upload; fail-fast on final failure | `publish.ts` |
| Stale seed state | Timestamp-based freshness check; CI always re-seeds; typed state loader with validation | `seed-all.ts`, `state.json` |
| Vite cold start | 30s webServer timeout; `reuseExistingServer: true` | `playwright.config.ts` |
| Selector drift | `data-testid` attributes for structural assertions; `getByText`/`getByRole` for content | All new specs |
| Event ordering | Explicit `created_at` gaps; content-based assertions over order-based | Seed scripts |
| Infrastructure unavailable | `checkAllServicesReady()` with 30s timeout before seeding | `seed-all.ts` |
| CI timing variance | Higher timeouts; 1 retry; parallel worker reduction | `playwright.config.ts` (CI overrides) |

---

## Definition of Done

### Epic-Level Gate

All of the following must be true for Epic 10 to be considered complete:

1. **Seed infrastructure works end-to-end:** `seed-all.ts` runs against SDK E2E infra, uploads all git objects via Arweave DVM, publishes all NIP-34 events, and produces a valid `state.json` — consistently (3/3 consecutive runs pass).

2. **All 12 Playwright specs pass:** Stories 10.10-10.18 produce 12 spec files that all pass against the seeded data. Zero spec failures on a clean seed run.

3. **CI pipeline passes:** The `rig-e2e` CI job completes green on the merge PR. Seed + spec execution total time < 5 minutes (excluding infra startup).

4. **Legacy specs unaffected:** The 6 existing Epic 8 E2E specs continue to pass (run via the `legacy` Playwright project). No regressions introduced.

5. **Known depth regression covered:** `deep-nav.spec.ts` (Story 10.11) navigates to depth 4 and verifies file content renders — the known nested navigation bug is now a regression gate.

6. **Multi-author attribution verified:** At least one spec (10.16 or 10.17) verifies that events from Alice, Bob, and Charlie render with distinct author identifiers.

7. **State documentation complete:** `state.json` schema is documented in the seed lib (TypeScript interface + JSDoc). Other engineers can understand and extend the seed data.

### Per-Story Acceptance

| Story | Done When |
|-------|-----------|
| 10.1 | All seed lib modules compile; 3 ToonClients connect to Peer1; git-builder produces valid SHAs; event-builders produce valid NIP-34 events |
| 10.2 | `push-01-init.ts` runs; 6 git objects uploaded; kind:30617 + kind:30618 published; `state.json` has initial entries |
| 10.3 | `push-02-nested.ts` runs; depth-4 path in tree; only delta objects uploaded |
| 10.4 | Both push-03 and push-04 run; 2 branches in refs; parent chain intact |
| 10.5 | `push-05-tag.ts` runs; tag in refs; no new git objects |
| 10.6 | `push-06-prs.ts` runs; 2 PRs with status events; correct author attribution |
| 10.7 | `push-07-issues.ts` runs; 2 issues; 5+ comments with threading |
| 10.8 | `push-08-close.ts` runs; Issue #2 closed |
| 10.9 | `seed-all.ts` orchestrates all pushes; freshness check works; total time < 60s |
| 10.10 | Repo list spec passes; repo card visible with name and description |
| 10.11 | Deep nav spec passes at depth 4; breadcrumbs update; back navigation works |
| 10.12 | File view spec passes; markdown preview and code view both render |
| 10.13 | Branch switch spec passes; file tree changes between main and feature branch |
| 10.14 | Tag view spec passes; tag selectable; content matches tagged commit |
| 10.15 | Commit log + detail specs pass; parent chain visible; diff renders |
| 10.16 | Issue list + detail specs pass; open/closed filter; comment thread with 3 authors |
| 10.17 | PR list + detail specs pass; merged/open badges; conversation + files tabs |
| 10.18 | Blame spec passes; commit attribution per line (or deferred if blame view not implemented) |

---

## Test Priority Matrix

| Priority | Count | Description | Gate |
|----------|-------|-------------|------|
| P0 | 7 specs | Core navigation, depth regression, multi-author, PRs, issues | Merge blocker |
| P1 | 4 specs | File viewing, tags, commit history, blame | Should pass; non-blocking with documented reason |
| P2 | 1 spec | Blame view (may not be implemented) | Nice-to-have |

**P0 specs (merge blockers):** repo-list, deep-nav, branch-switch, issue-list, issue-detail, pr-list, pr-detail

**P1 specs (should pass):** file-view, tag-view, commit-log, commit-detail

**P2 specs (best effort):** blame

---

## Open Questions for Team

1. **Blame view status:** Is blame view implemented in Forge-UI (Epic 8)? If not, Story 10.18 should be deferred or marked skip-on-CI.
2. **Arweave free tier reliability:** Has the free tier been reliable enough for CI? If not, consider a dedicated Arweave gateway or local mock for CI-only runs.
3. **`data-testid` attribute policy:** Should Story 10.1 add `data-testid` attributes to existing Forge-UI components, or should that be a separate prep story?
4. **Legacy spec deprecation timeline:** When should the 6 Epic 8 specs be removed in favor of Epic 10's more comprehensive specs?
