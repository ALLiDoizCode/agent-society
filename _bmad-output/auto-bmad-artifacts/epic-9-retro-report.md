# Epic 9 Retrospective: NIP-to-TOON Skill Pipeline + Socialverse Skills

**Date:** 2026-03-28
**Epic:** 9 -- NIP-to-TOON Skill Pipeline + Socialverse Skills
**Packages:** `.claude/skills/` (new skill artifacts), `@toon-protocol/sdk`, `@toon-protocol/core`, `packages/rig`, `packages/client`
**Status:** Done (35/35 stories complete)
**Branch:** `epic-9`
**Baseline test count:** 3,256 (at epic start)
**Final test count:** 4,292 total (4,227 passed, 65 skipped, 0 failures)

---

## 1. Executive Summary

Epic 9 is the largest epic in TOON Protocol history -- 35 stories across 12 phases, producing 30+ Claude Agent Skills installed in `.claude/skills/`. This is also the first epic to produce a fundamentally different deliverable type: structured markdown skill files with eval definitions, reference documents, and validation scripts, rather than traditional TypeScript code packages.

The epic delivered a complete NIP-to-TOON skill pipeline (Stories 9-0 through 9-3), covering social intelligence, protocol core, a 13-step NIP conversion factory, and a skill evaluation framework. The pipeline was then exercised across 10 phases of socialverse skills -- identity, content, community, curation, media, privacy, advanced social, NIP-34 git, DVM, and relay discovery -- culminating in a publication gate (Story 9-34) that validated all skills before installation.

The most architecturally significant deliverable is **Story 9-2's NIP-to-TOON Pipeline**, which codifies a repeatable 13-step process for converting any Nostr NIP specification into a TOON-aware Claude Agent Skill. This pipeline was used to produce every subsequent skill, establishing a factory pattern for knowledge artifacts that parallels the code factory patterns of earlier epics.

The most operationally significant deliverable is the **30+ skills themselves**, which give Claude comprehensive knowledge of the TOON Protocol's Nostr-based socialverse -- from basic note publishing and profile management through encrypted DMs, decentralized git collaboration, DVM compute, and relay discovery. These skills transform Claude from a general-purpose assistant into a TOON Protocol domain expert.

Two pre-existing bugs were discovered and fixed during the epic: an Arweave DVM handler base64 encoding issue and a Vite base path configuration error in the Rig UI. Both were fixed as part of Story 9-2's development phase.

The epic also produced code alongside skills: 528 files changed with 105,477 insertions, including structural test suites for skill validation, E2E socialverse test harnesses, and Rig UI enhancements for the decentralized git forge.

---

## 2. Delivery Metrics

| Metric | Value |
|--------|-------|
| Stories delivered | 35/35 (100%) |
| Phases completed | 12/12 |
| Skills created | 30+ Claude Agent Skills |
| Skill directories in `.claude/skills/` | 55 (including pre-existing RFC + utility skills) |
| Git commits | 33 |
| Files changed | 528 |
| Lines added | 105,477 |
| Lines removed | 1,965 |
| Monorepo test count (start) | 3,256 (3,191 passed, 65 skipped) |
| Monorepo test count (end) | 4,292 (4,227 passed, 65 skipped) |
| Net test count growth | +1,036 tests (+1,036 passed, 0 skipped delta) |
| Code review issues found (11 reported stories) | 68 total |
| Code review issues fixed | 56 |
| Code review issues accepted | 12 (0 critical/high remaining) |
| NFR assessments | 11/11 PASS |
| Traceability gate | PASS (P0: 100%, P1: 91.6%, Overall: 92.6%) |
| Security scans | 11/11 PASS (0 vulnerabilities) |
| Migrations | 0 |
| Pre-existing bugs fixed | 2 (Arweave DVM base64, Vite base path) |
| New runtime dependencies | 0 |

### Code Review Breakdown (11 Reported Stories)

| Severity | Found | Fixed | Accepted | Remaining |
|----------|-------|-------|----------|-----------|
| Critical | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 |
| Medium | ~30 | ~26 | ~4 | 0 |
| Low | ~38 | ~30 | ~8 | 0 |
| **Total** | **68** | **56** | **12** | **0** |

### Test Count Progression

| Phase | Stories | Tests Added (approx.) |
|-------|---------|----------------------|
| Phase 0: Pipeline Foundation (9.0-9.3) | 4 | ~400 (structural + eval tests) |
| Phase 1-3: Identity + Content + Community (9.4-9.10) | 7 | ~550 (per-skill validation) |
| Phase 4-11: Batch skills (9.11-9.34) | 24 | ~86 (batch structural tests) |
| **Total** | **35** | **+1,036** |

---

## 3. Successes

### 3.1. Largest Epic Completed -- 35 Stories, Zero Failures

Epic 9 delivered 35/35 stories with no incomplete work, no stories deferred, and no scope reductions. This is 3x the size of the previous largest epic (Epic 8, 8 stories) and 4.4x the average epic size. All 12 phases completed in sequence with no blocking issues.

### 3.2. Novel Deliverable Type Successfully Integrated into Pipeline

The BMAD pipeline -- designed for TypeScript code packages -- was successfully adapted to produce, validate, and review structured markdown skills. The key adaptations were: structural validation replacing compilation, eval execution replacing unit tests, TOON compliance checks replacing contract tests, and cross-skill consistency checks replacing integration tests. This proves the pipeline is flexible enough to handle non-code deliverables.

### 3.3. Factory Pattern Achieved: Pipeline Skill Produces Valid Skills

Story 9-2's NIP-to-TOON pipeline skill is a self-referential success: a skill that teaches Claude how to create skills. Every skill from Story 9-4 onward was produced using this pipeline, demonstrating genuine factory-pattern reuse. The 13-step process (NIP analysis, TOON delta identification, skill scaffolding, eval authoring, etc.) was executed consistently across 30+ skills.

### 3.4. Two Critical Epic 8 Retro Actions Resolved at Epic Start

The ESLint gap for `packages/rig` (A1, critical) was resolved during the epic start pipeline -- 110 ESLint errors fixed across 22 files. The route fees caching gap (A6) was also resolved with a fingerprint-based cache with invalidation. This maintains the 100% critical retro resolution rate established in Epic 8.

### 3.5. +1,036 Net New Tests -- Largest Single-Epic Growth

The test suite grew from 3,256 to 4,292 (+1,036), surpassing Epic 8's record of +515. The growth reflects both the structural validation tests for the skill pipeline and the per-skill validation tests for the first 11 stories. Zero test regressions for the 9th consecutive epic.

### 3.6. Zero Security Vulnerabilities Across All 11 Scanned Stories

All 11 security scans returned clean results (0 vulnerabilities). This is the first epic with zero real security findings, reflecting the fact that skills are knowledge artifacts (markdown + JSON) rather than executable code with an attack surface. The 2 pre-existing bugs fixed were correctness issues, not security issues.

### 3.7. Batch Processing Accelerated Delivery Without Sacrificing Quality

Stories 9-11 through 9-34 (24 stories) were completed in batch mode -- groups of 4 stories per commit, sharing code review passes. This accelerated delivery significantly compared to the per-story pipeline used for 9-0 through 9-10. The traceability gate still passed (92.6% overall), confirming that batch processing maintained quality.

### 3.8. Pre-Existing Bugs Discovered and Fixed Opportunistically

Two bugs were found and fixed during Epic 9 development:
- **Arweave DVM handler base64 encoding**: The handler was not properly encoding/decoding base64 data in kind:5094 responses, causing upload failures via the ToonClient BTP path.
- **Vite base path**: The Rig UI's Vite configuration had an incorrect base path that caused asset loading failures when deployed to non-root paths.

These fixes improved the robustness of Epic 8 deliverables without being explicitly scoped in Epic 9.

---

## 4. Challenges

### 4.1. 24 Batch Stories Lack Individual Audit Artifacts

Stories 9-11 through 9-34 were completed in batch mode without individual story reports. While all stories are marked "done" in sprint-status.yaml and the traceability gate passes, there are no per-story code review logs, NFR assessments, or test count deltas for these 24 stories. This creates an audit gap -- if a specific skill's quality is questioned, there is no individual artifact trail to reference.

### 4.2. CI Burn-In Not Configured for Skill Tests

The structural validation tests (`tests/skills/test-*-skill.sh`) and eval definitions are not integrated into the CI pipeline. Skill tests run locally during development but are not part of the automated regression suite. This means skill quality could degrade without automated detection.

### 4.3. AC11 Baseline Gap Is Structural and Accepted

The traceability gate achieved 91.6% P1 coverage (not 100%) due to a structural gap in AC11 (baseline validation). This gap was analyzed and accepted -- it reflects the inherent difficulty of objectively measuring "with skill vs. without skill" improvement for subjective knowledge tasks. The gap is documented and does not represent missing functionality.

### 4.4. Recurring Eval Authoring Pattern Could Benefit from Automation

Each of the 30+ skills required hand-authored eval definitions (trigger conditions, expected outputs, grading criteria). The eval structure is repetitive across skills -- trigger description, test input, expected behavior, grading rubric. A template generator or eval scaffold tool would reduce authoring time and improve consistency for future skill creation.

### 4.5. Oversized Story 9-2 Was Not Split

The epic start report recommended splitting Story 9-2 (14 ACs) into two sub-stories. This recommendation was not followed -- 9-2 was implemented as a single story. While it completed successfully, the 14-AC scope made code review more difficult and the story report is the most complex in the epic. Future oversized stories should be split as recommended.

### 4.6. Playwright E2E Tests Still Not Executed Against Live Infrastructure

Carried from Epic 8 (A2): the 7 Playwright E2E specs for Forge-UI have still not been executed against live infrastructure. Additional E2E test harnesses were created during Epic 9 (`socialverse-e2e.ts`, `socialverse-swarm.ts`, etc.) but these also require live infrastructure. The E2E validation debt continues to grow.

---

## 5. Key Insights

### 5.1. Skills Are a Viable Product Type for Protocol Projects

Epic 9 proves that a protocol project can productively invest in Claude Agent Skills as a deliverable type alongside code. The 30+ skills transform Claude from a general-purpose assistant into a TOON Protocol domain expert -- able to construct valid Nostr events, calculate TOON fees, use the correct API patterns, and guide users through complex workflows. This is a novel form of developer documentation that is more interactive and more useful than static docs.

### 5.2. Factory Patterns Apply to Knowledge Artifacts, Not Just Code

The NIP-to-TOON pipeline (Story 9-2) demonstrates that factory patterns -- repeatable, structured processes that produce consistent output -- apply to knowledge artifacts as effectively as to code. The 13-step process ensured every skill had consistent structure, TOON compliance, eval coverage, and progressive disclosure levels. This is a transferable insight for any project producing structured knowledge.

### 5.3. Batch Processing Is Appropriate for Repetitive, Low-Risk Stories

The batch approach (4 stories per commit) was effective for the repetitive skill-production stories in Phases 4-11. Each story followed the same pipeline, produced the same artifact structure, and had the same risk profile. Batch processing should be considered for future epics with similar characteristics: repetitive structure, low novelty, established patterns.

### 5.4. Skill Quality Is Harder to Gate Than Code Quality

Unlike code (which can be tested for correctness with assertions), skill quality involves judgment about: Does the skill trigger correctly? Is the guidance accurate? Is the progressive disclosure effective? The eval framework (Story 9-3) mitigates this with rubric-based grading, but the inherent subjectivity means skill quality assurance requires periodic human review -- not just automated gates.

### 5.5. Cross-Skill Consistency Requires Shared References

The `toon-protocol-context.md` and `nostr-protocol-core` skill serve as shared foundations for all other skills. Without these shared references, each skill would independently (and potentially inconsistently) describe TOON fee calculation, event publishing, and protocol mechanics. The shared reference pattern should be applied to all future skill families.

### 5.6. The Skill Pipeline Is Now the Project's Most Reusable Asset

The NIP-to-TOON pipeline can convert any future NIP specification into a TOON-aware skill. As the Nostr protocol evolves and new NIPs are ratified, the pipeline can produce new skills without requiring a full epic. This makes the pipeline the most reusable deliverable of Epic 9 -- more valuable than any individual skill.

---

## 6. Action Items for Epic 10

### 6.1. Must-Do (Blockers or High Priority)

| # | Action | Owner | Status | Carried From | Reason |
|---|--------|-------|--------|-------------|--------|
| A1 | **Configure CI burn-in for skill tests** | Dev | NEW | Epic 9 | Skill structural tests (`tests/skills/test-*-skill.sh`) not in CI pipeline. Quality could degrade silently. |
| A2 | **Execute Playwright E2E tests against live infra** | Dev | OPEN | Epic 8 A2 (2 epics) | 7+ Playwright specs never executed. E2E debt growing with socialverse test harnesses added. |
| A3 | **Verify 4 manual ACs after first Arweave deployment** | Dev | OPEN | Epic 8 A3 (2 epics) | AC9, AC10, AC11, AC13 from Story 8-7 still pending. |

### 6.2. Should-Do (Quality Improvements)

| # | Action | Owner | Status | Carried From | Reason |
|---|--------|-------|--------|-------------|--------|
| A4 | **Create eval scaffold/template generator** | Dev | NEW | Epic 9 | Recurring eval authoring pattern is repetitive. Automation would improve consistency and reduce time for future skill creation. |
| A5 | **Backfill audit artifacts for 24 batch stories** | Dev | NEW | Epic 9 | Stories 9-11 through 9-34 lack individual reports. Consider generating lightweight summaries for audit trail. |
| A6 | **Establish load testing infrastructure** | Dev | OPEN | Epic 1 (9 epics deferred) | Continues to be flagged in NFR assessments. |
| A7 | **Formal SLOs for DVM job lifecycle** | Dev | OPEN | Epic 6 (4 epics deferred) | With Arweave DVM + compute primitive in Epic 10, SLOs increasingly relevant. |
| A8 | **Set up facilitator ETH monitoring** | Dev | OPEN | Epic 3 (7 epics deferred) | x402 facilitator account operational safety. |
| A9 | **Update Docker E2E infra for Arweave DVM handler** | Dev | OPEN | Epic 8 A4 (2 epics) | E2E stubs still pending Docker infra update. |

### 6.3. Nice-to-Have

| # | Action | Owner | Reason |
|---|--------|-------|--------|
| A10 | Commit flake.lock | Dev | Carried from Epic 4 (6 epics deferred). Requires Nix. |
| A11 | Publish @toon-protocol/town to npm | Dev | Carried from Epic 2 (8 epics deferred). |
| A12 | Improve blame algorithm (full Myers diff) | Dev | Carried from Epic 8 A11. MVP limitation. |
| A13 | Weighted WoT model for reputation scoring | Dev | Carried from Epic 6 (4 epics deferred). |
| A14 | Docker E2E for workflow chain + swarm coordination | Dev | Carried from Epic 6 (4 epics deferred). |
| A15 | Add Arweave object caching to Forge-UI | Dev | Carried from Epic 8 A13. |

---

## 7. Epic 10 Preparation Tasks

> **NOTE (2026-03-29, updated 2026-04-09):** After this retro was written, Epic 10 was renumbered multiple times. The original
> "Epic 10" (Compute Primitive, kind:5250) is now **Epic 13**. The current **Epic 10** is the
> **Rig E2E Integration Test Suite**, **Epic 11** is **TOON Pets**, and **Epic 12** is **Token Swap Primitive**
> (NIP-59 gift-wrapped ILP micropayment swaps, inserted 2026-04-09). All subsequent epics shifted:
> Compute 12->13, Chain Bridge 13->14, Loony 14->15, Heartbeat 15->16, Treasury 16->17,
> Sovereign 17->18, Biography 18->19, Swarms 19->20.
> Action items A1 (CI burn-in) and A2 (Playwright E2E) are directly addressed by Epic 10.
> See commit `5683f55` for the first renumbering.

Epic 10 (Compute Primitive -- Provider Protocol & DX, kind:5250) has 8 stories:

| Story | Scope |
|-------|-------|
| 10-1 | Compute event kind definitions (kind:5250/5251/6250) |
| 10-2 | Two-phase async result protocol |
| 10-3 | Self-describing compute receipts |
| 10-4 | Consumer SDK job submission |
| 10-5 | Compute provider skill descriptor |
| 10-6 | Provider test harness |
| 10-7 | Provider handoff documents |
| 10-8 | Publish compute primitive |

### Preparation Checklist

- [ ] **Resolve A1** (CI burn-in for skill tests) -- prevent skill quality degradation before shifting focus to compute.
- [ ] **Review Epic 5/6 DVM patterns** -- Epic 10 extends kind:5xxx event patterns established in Epics 5 and 6. Review `dvm-event-kinds.ts`, `DvmHandler`, and `DvmComputeProvider` for reuse.
- [ ] **Review Network Primitives Strategy** -- `party-mode-network-primitives-strategy-2026-03-22.md` defines the compute primitive requirements (D8-PM-003/004/005).
- [ ] **Identify provider handoff boundaries** -- Stories 10-7 and 10-8 produce documentation for external teams (Oyster CVM, Akash, HyperBEAM). Define the handoff boundary clearly before implementation.
- [ ] **Create Epic 10 test design document** -- Key risks: async result protocol race conditions, receipt format extensibility, provider test harness coverage of edge cases.
- [ ] **Evaluate compute primitive pricing model** -- Convenience fee model (providers as resellers) needs concrete pricing parameters before Story 10-1.

### Key Risks for Epic 10

1. **Two-phase async protocol introduces race conditions.** Story 10-2's async result protocol (submit kind:5250, receive kind:5251/6250) must handle timeout, duplicate delivery, provider failure, and client reconnection. This is significantly more complex than the synchronous DVM patterns in Epic 5.

2. **Provider implementations are out of scope but must be testable.** TOON ships protocol spec + consumer SDK + test harness; providers build their own implementations. The test harness (Story 10-6) must be comprehensive enough that external teams can validate their implementations without TOON team support.

3. **Compute receipts must be self-describing and extensible.** Story 10-3's receipt format will be permanent infrastructure. Design for extensibility (new compute types, new metadata fields) from the start.

4. **Return to code-centric deliverables after skill-centric epic.** Epic 10 returns to TypeScript packages after Epic 9's skill-only focus. The team needs to re-engage with the code review, ATDD, and NFR patterns that were partially dormant during skill production.

---

## 8. Team Agreements

Based on Epic 9 learnings (35 stories), the following agreements carry forward and are amended:

1. **ATDD stubs before implementation, lint-checked immediately.** Continued from all prior epics. Applies to code stories; skill stories use structural validation instead.

2. **Three-pass code review model is non-negotiable for code stories.** Maintained for the 11 fully-reported stories. Batch stories received shared review passes. For future batch stories, document the shared review scope explicitly.

3. **One commit per story (or per batch).** Epic 9 used batch commits (4 stories per commit) for Phases 4-11. This is acceptable when stories share the same pattern, risk profile, and review scope. Individual commits remain the default for novel or high-risk stories.

4. **Security scan every story (or per batch).** All 11 scanned stories returned clean. Skills have minimal attack surface; future code epics should expect higher finding counts.

5. **Regression tests are non-negotiable.** Zero regressions for the 9th consecutive epic. Test count grew by +1,036 -- the largest single-epic growth in project history.

6. **Traceability gate at epic close.** Overall 92.6% AC coverage. The 91.6% P1 score (vs. 100% in previous epics) reflects the structural difficulty of baseline-comparison evals for subjective knowledge skills. This gap is accepted and documented.

7. **Resolve retro action items at epic start.** Both critical Epic 8 items resolved (ESLint for rig, route fees caching). This is the 2nd consecutive epic with 100% critical resolution.

8. **Batch processing is acceptable for repetitive, low-risk stories.** New for Epic 9: when stories follow an established pattern, have low novelty, and produce the same artifact structure, batch processing (4 stories per commit, shared reviews) is an approved approach. Document the batch scope and ensure the traceability gate still passes.

9. **Shared references for skill families.** New for Epic 9: all skills in a family must reference common foundation skills (e.g., `nostr-protocol-core`, `toon-protocol-context.md`). No skill should independently redefine protocol mechanics.

10. **Pipeline skills are reusable assets.** New for Epic 9: factory-pattern skills (like `nip-to-toon-skill`) that produce other skills should be maintained as first-class deliverables. New NIPs can be converted to skills without a full epic.

11. **Audit artifacts for batch stories.** New for Epic 9 (corrective): future batch stories should include lightweight per-story summaries (even if shared review passes are used) to maintain audit trail. The 24-story gap in Epic 9 is accepted but should not be repeated.

12. **Immutable deployment validation gates.** Carried from Epic 8.

13. **Frontend polish for UI-facing stories.** Carried from Epic 8.

14. **XSS prevention as default for all rendering functions.** Carried from Epic 8.

15. **Adapter interfaces for external service dependencies.** Carried from Epic 8.

16. **Security-hardened developer scripts.** Carried from Epic 8.

17. **Unified payment pattern for all monetized flows.** Carried from Epic 7.

18. **Backward-compatible field additions with sensible defaults.** Carried from Epic 7.

19. **Injectable dependencies for orchestration classes.** Carried from Epics 4/6.

---

## 9. Timeline and Velocity

### Commit Timeline

| Commit | Stories | Description |
|--------|---------|-------------|
| e909032 | -- | Epic start -- baseline green, retro actions resolved |
| 0d7a748 | 9-0 | Social Intelligence Base Skill |
| 880a970 | 9-1 | TOON Protocol Core Skill |
| 4de6c24-64c2d01 | 9-2 | NIP-to-TOON Pipeline (multi-commit, largest story) |
| a1a5a12 | 9-3 | Skill Eval Framework |
| 01634b2 | 9-4 | Social Identity Skill (first pipeline-produced) |
| 9dd4275 | 9-5 | Long-form Content Skill |
| 4b16892 | 9-6 | Social Interactions Skill |
| cbb85f0 | 9-7 | Content References Skill |
| 4e35b44 | 9-8 | Relay Groups Skill |
| b1f7d42 | 9-9 | Moderated Communities Skill |
| e6f3d6e | 9-10 | Public Chat Skill |
| 6ad8c89-b564f92 | 9-11, 9-14, 9-26, 9-33 | Batch: lists, media, NIP-34 kinds, relay discovery |
| 985adca | 9-12, 9-13, 9-15, 9-19 | Batch: search, app-handlers, visual-media, content-control |
| ba9037c | 9-16, 9-17, 9-20, 9-21 | Batch: file-storage, encrypted-messaging, sensitive-content, statuses |
| f481113 | 9-18, 9-22, 9-23, 9-25 | Batch: private-dms, badges, highlights, drafts |
| b1cbd85 | 9-24, 9-27, 9-31, 9-32 | Batch: polls, git-objects, dvm-protocol, marketplace |
| 276a576 | 9-28, 9-29, 9-30 | Batch: git-arweave, git-workflows, git-identity |
| 19174e4 | 9-34 | Publication gate -- all skills validated and installed |
| 25259ab | -- | Fix: TurboFactory dev-only warnings |

### Velocity Comparison Across Epics

| Metric | Epic 6 | Epic 7 | Epic 8 | Epic 9 | Trend |
|--------|--------|--------|--------|--------|-------|
| Stories | 4 | 6 | 8 | 35 | 4.4x largest |
| Net test growth | +286 | +212 | +515 | +1,036 | 2x previous record |
| Tests per story | 71.5 | 37.2 | 64.4 | 29.6 | Lower (skill stories lighter) |
| Code review issues (reported) | 44 | 28 | 96 | 68 | N/A (partial reporting) |
| Critical+High issues | 7 | 0 | 12 | 0 | Clean |
| Issues remaining | 0 | 0 | 0 | 0 | Clean (10th consecutive) |
| Security findings (real) | 0 | 4 | 7 | 0 | Clean (skills = no attack surface) |
| NFR pass rate | 4/4 | 6/6 | 8/8 | 11/11 | 100% (6th consecutive epic) |
| Test regressions | 0 | 0 | 0 | 0 | 0 (9th consecutive epic) |
| Traceability gate | PASS | PASS | PASS | PASS | 100% (9th consecutive) |
| Retro actions resolved (critical) | 3/3 | 0/2 | 2/2 | 2/2 | 100% (2nd consecutive) |

Key observations:

- **35 stories is 4.4x the previous largest epic.** The batch processing approach made this feasible without proportional time increase. Individual story pipeline runs averaged ~60-90 minutes for the first 11 stories; batch runs processed 3-4 stories per session.

- **+1,036 net new tests doubles the previous record** (Epic 8's +515). However, tests-per-story (29.6) is the lowest since tracking began, reflecting that skill stories produce fewer but more structural tests compared to code stories.

- **Zero critical/high code review issues** across all reported stories. This is the cleanest review performance since Epic 7, reflecting the established patterns and lower novelty of skill production after Phase 0.

- **The 24 batch stories represent an efficiency breakthrough but an audit gap.** Future epics should find the middle ground: batch processing with lightweight per-story summaries.

---

## 10. Known Risks Inventory

| # | Risk | Severity | Source | Status |
|---|------|----------|--------|--------|
| R1 | CI burn-in not configured for skill tests | High | Epic 9 | NEW -- skill quality could degrade silently |
| R2 | 24 batch stories lack individual audit artifacts | Medium | Epic 9 | NEW -- accepted for this epic, corrective agreement added |
| R3 | Playwright E2E tests never executed against live infra | High | Epic 8 R1 | CARRIED (2 epics) -- growing debt with new test harnesses |
| R4 | 4 manual ACs pending first Arweave deployment | Medium | Epic 8 R2 | CARRIED (2 epics) |
| R5 | Arweave DVM E2E stubs pending Docker infra update | Medium | Epic 8 R4 | CARRIED (2 epics) |
| R6 | AC11 baseline gap is structural (skill quality subjectivity) | Low | Epic 9 | NEW -- accepted, documented |
| R7 | Eval authoring is repetitive and manual | Low | Epic 9 | NEW -- mitigated if A4 (scaffold tool) is implemented |
| R8 | @ardrive/turbo-sdk 31 transitive vulnerabilities | Low | Epic 8 R6 | CARRIED -- mitigated by adapter interface |
| R9 | No load testing infrastructure | Medium | NFR inherited | CARRIED (9 epics) |
| R10 | No formal SLOs | Medium | NFR inherited | CARRIED (9 epics) |
| R11 | No distributed tracing | Medium | NFR inherited | CARRIED (9 epics) |
| R12 | Facilitator ETH monitoring not implemented | Medium | Epic 3 | CARRIED (7 epics) |
| R13 | Self-reported reputation scores not protocol-enforced | Medium | Epic 6 | CARRIED (4 epics) |
| R14 | flake.lock not committed | Low | Epic 4 | CARRIED (6 epics) |
| R15 | @toon-protocol/town unpublished to npm | Low | Epic 2 | CARRIED (8 epics) |
| R16 | Simplified blame algorithm | Low | Epic 8 R5 | CARRIED (2 epics) |

R1 (CI burn-in for skills) and R3 (Playwright E2E execution) are the highest-priority risks. R1 is new and actionable immediately. R3 has been carried for 2 epics and the debt is growing as new E2E test harnesses are added without execution.

---

## 11. Conclusion

Epic 9 is the most ambitious epic in TOON Protocol history -- 35 stories, 30+ skills, +1,036 tests, 528 files changed -- and it completed with zero failures, zero regressions, and all quality gates passing. The epic proved that Claude Agent Skills are a viable and valuable deliverable type for protocol projects, and that factory patterns apply to knowledge artifacts as effectively as to code.

The NIP-to-TOON pipeline (Story 9-2) is the epic's most durable asset -- a reusable factory that can convert any future NIP specification into a TOON-aware skill without requiring a full epic. The 30+ skills installed in `.claude/skills/` transform Claude into a TOON Protocol domain expert, covering the full breadth of the Nostr socialverse from basic profiles through encrypted messaging, decentralized git, DVM compute, and relay discovery.

The batch processing approach (24 stories in groups of 3-4) was an efficiency breakthrough that should be applied selectively in future epics. The corrective agreement (lightweight per-story summaries for batch stories) addresses the audit gap without abandoning the efficiency gains.

Epic 10 returns to code-centric deliverables with the Compute Primitive (kind:5250). The shift from skill production back to TypeScript packages will require re-engaging with the full ATDD/code review/NFR pipeline. The 30+ skills produced in Epic 9 will be immediately useful as Claude can now guide developers through compute primitive integration using its comprehensive TOON Protocol knowledge.
