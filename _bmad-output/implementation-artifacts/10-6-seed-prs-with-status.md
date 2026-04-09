# Story 10.6: Seed Script — PRs with Status (Push 6)

Status: done

## Story

As a **TOON developer**,
I want a seed script that publishes 2 PRs (kind:1617 patches) with status events (kind:1630/1631),
so that Playwright specs can verify PR listing, status badges, author attribution, and conversation/files tabs.

## Acceptance Criteria

1. **AC-6.1:** `seed/push-06-prs.ts` publishes 2 kind:1617 PR events: PR #1 "feat: add retry logic" by Alice (branch tag: `feature/add-retry`, commit tags for both feature commits, `a` tag referencing repo); PR #2 "fix: update docs" by Charlie (single commit SHA, `a` tag referencing repo)
2. **AC-6.2:** kind:1630 (Open) status event published for PR #2 (referencing PR event ID via `e` tag)
3. **AC-6.3:** kind:1631 (Merged/Applied) status event published for PR #1
4. **AC-6.4:** All events signed by correct author keypairs (Alice for PR #1 and its status, Charlie for PR #2 and its status)

## Tasks / Subtasks

- [x] Task 1: Create `push-06-prs.ts` module (AC: 6.1, 6.2, 6.3, 6.4)
  - [x] 1.1: Export `Push06State` interface — extends Push05State pattern with `prs: { eventId: string; title: string; authorPubkey: string; statusKind: number }[]` field
  - [x] 1.2: Export `runPush06(aliceClient, charlieClient, aliceSecretKey, charlieSecretKey, push05State): Promise<Push06State>`
  - [x] 1.3: Build PR #1 using `buildPatch(ownerPubkey, REPO_ID, 'feat: add retry logic', commits, 'feature/add-retry')` signed by Alice — commits array includes Push 3 and Push 4 commit SHAs with their parent SHAs (AC: 6.1)
  - [x] 1.4: Build PR #2 using `buildPatch(ownerPubkey, REPO_ID, 'fix: update docs', commits)` signed by Charlie — single commit entry with a placeholder commit SHA and parent Push 2 SHA (AC: 6.1)
  - [x] 1.5: Publish both kind:1617 events via `publishWithRetry()` — Alice publishes PR #1, Charlie publishes PR #2 (AC: 6.4)
  - [x] 1.6: Build and publish kind:1631 (Applied/Merged) status for PR #1 using `buildStatus(pr1EventId, 1631, alicePubkey)` signed by Alice (AC: 6.3)
  - [x] 1.7: Build and publish kind:1630 (Open) status for PR #2 using `buildStatus(pr2EventId, 1630, charliePubkey)` signed by Charlie (AC: 6.2)
  - [x] 1.8: Derive event IDs using `result.eventId ?? signed.id` fallback pattern (matches Push 4/5 pattern)
  - [x] 1.9: Return Push06State — pass through all Push05State fields unchanged, add `prs` array with both PR entries (AC: 6.1)

- [x] Task 2: Write ATDD tests for push-06-prs (AC: 6.1, 6.2, 6.3, 6.4)
  - [x] 2.1: Create `__tests__/push-06-prs.test.ts` with `describe('Story 10.6: Push 06 — PRs with Status')`
  - [x] 2.2: Unit test: module exports `runPush06` function and `Push06State` type (AC: 6.1)
  - [x] 2.3: Unit test: `runPush06` accepts 5 parameters (aliceClient, charlieClient, aliceSecretKey, charlieSecretKey, push05State)
  - [x] 2.4: Unit test: `buildPatch` for PR #1 produces kind:1617 with correct `a` tag, `subject` tag, commit/parent-commit tags for both feature commits, and `t` tag for branch (AC: 6.1)
  - [x] 2.5: Unit test: `buildPatch` for PR #2 produces kind:1617 with correct `a` tag, `subject` tag, single commit/parent-commit pair (AC: 6.1)
  - [x] 2.6: Unit test: `buildStatus` for PR #1 produces kind:1631 with `e` tag referencing PR #1 event ID and `p` tag (AC: 6.3)
  - [x] 2.7: Unit test: `buildStatus` for PR #2 produces kind:1630 with `e` tag referencing PR #2 event ID and `p` tag (AC: 6.2)
  - [x] 2.8: Unit test: Push06State.prs has 2 entries with correct titles, statusKinds (1631 for PR #1, 1630 for PR #2), and distinct authorPubkeys (AC: 6.1)
  - [x] 2.9: Unit test: Push06State passes through all Push05State fields unchanged (commits, shaMap, branches, tags, files, repoId, ownerPubkey, repoAnnouncementId, refsEventId) (AC: 6.1)
  - [x] 2.10: Unit test: no new git objects created — shaMap key count unchanged, commits array length unchanged (4), files array unchanged
  - [x] 2.11: Unit test: module does NOT import `createGitBlob`, `createGitTree`, `createGitCommit`, `uploadGitObject`, or `signBalanceProof` (no git object work)
  - [x] 2.12: Integration test stubs (`.todo`) for live relay publishing (AC: 6.1-6.4)

## Prerequisites

- **Story 10.5 complete:** `push-05-tag.ts` must be implemented and its `Push05State` interface available for import. (Note: epic dependency table lists 10.4, but Push 06 imports `Push05State` from `push-05-tag.js`, so 10.5 is the actual prerequisite.)
- **Seed lib from Story 10.1:** All seed lib modules available (`buildPatch`, `buildStatus`, `publishWithRetry`, `AGENT_IDENTITIES` from barrel).
- **SDK E2E infrastructure running:** `./scripts/sdk-e2e-infra.sh up` for integration verification (not required for unit tests).

## Dev Notes

### Critical Pattern: Multi-Client Push Script

This is the FIRST push script that uses multiple ToonClient instances. Previous pushes (01-05) all used only Alice's client. Push 06 introduces Charlie as a second author to seed multi-author PR data for Playwright specs.

**Key difference from Push 01-05:**
- Function signature takes TWO clients and TWO secret keys (Alice + Charlie)
- Charlie's identity comes from `AGENT_IDENTITIES.carol` (NOTE: the constant is `carol`, not `charlie` — the socialverse harness uses `carol`)
- Each PR is signed by its respective author's secret key via `finalizeEvent(event, secretKey)`
- Each PR is published via its respective author's client via `publishWithRetry(client, signedEvent)`

### Import Pattern — Multi-Client

```typescript
import { finalizeEvent } from 'nostr-tools/pure';
import type { ToonClient } from '@toon-protocol/client';
import {
  buildPatch,
  buildStatus,
  publishWithRetry,
  AGENT_IDENTITIES,
  type ShaToTxIdMap,
} from './lib/index.js';
import { REPO_ID } from './push-01-init.js';
import { type Push05State } from './push-05-tag.js';
```

Note: `AGENT_IDENTITIES` IS imported this time (unlike Push 05) because we need Charlie's pubkey for the `p` tag in status events and for Push06State.prs[].authorPubkey.

### PR #1 — Alice's Feature Branch PR

```typescript
// PR #1: "feat: add retry logic" — references feature branch commits
const pr1Unsigned = buildPatch(
  push05State.ownerPubkey,
  REPO_ID,
  'feat: add retry logic',
  [
    { sha: push05State.commits[2]!.sha, parentSha: push05State.commits[1]!.sha },  // Push 3: branch creation
    { sha: push05State.commits[3]!.sha, parentSha: push05State.commits[2]!.sha },  // Push 4: branch work
  ],
  'feature/add-retry'  // branch tag
);
const pr1Signed = finalizeEvent(pr1Unsigned, aliceSecretKey);
const pr1Result = await publishWithRetry(aliceClient, pr1Signed);
```

**Commit index mapping** (from accumulated commits array):
- `commits[0]` = Push 1 initial commit
- `commits[1]` = Push 2 nested dirs commit (= main HEAD)
- `commits[2]` = Push 3 feature branch creation commit
- `commits[3]` = Push 4 feature branch work commit

### PR #2 — Charlie's Docs PR

PR #2 is a simulated "fix: update docs" PR by Charlie. It references a placeholder commit SHA since Charlie's branch work isn't actually seeded as git objects — only the PR event itself matters for Playwright spec verification.

```typescript
// PR #2: "fix: update docs" — Charlie's PR with a placeholder commit
// Use a deterministic placeholder SHA for the commit (not uploaded to Arweave)
const placeholderCommitSha = 'c'.repeat(40);  // placeholder, not a real git object
const pr2Unsigned = buildPatch(
  push05State.ownerPubkey,
  REPO_ID,
  'fix: update docs',
  [
    { sha: placeholderCommitSha, parentSha: push05State.commits[1]!.sha },  // based on main HEAD
  ]
  // No branch tag — this PR doesn't reference a named branch
);
// charlieSecretKey comes from the function parameter (passed by the orchestrator).
// Do NOT reconstruct it from AGENT_IDENTITIES.carol.secretKeyHex here.
// AGENT_IDENTITIES.carol is used only for pubkey reference in status event p tags.
const pr2Signed = finalizeEvent(pr2Unsigned, charlieSecretKey);
const pr2Result = await publishWithRetry(charlieClient, pr2Signed);
```

**IMPORTANT:** The `charlieSecretKey` parameter is passed to the function by the caller (the orchestrator). Do NOT reconstruct it from `AGENT_IDENTITIES.carol.secretKeyHex` inside `runPush06` — follow the pattern from previous pushes where the secret key is a parameter.

### Status Events

```typescript
// Status for PR #1: kind:1631 (Applied/Merged) — signed by Alice (repo maintainer)
const status1Unsigned = buildStatus(pr1EventId, 1631, pr1Signed.pubkey);
const status1Signed = finalizeEvent(status1Unsigned, aliceSecretKey);
const status1Result = await publishWithRetry(aliceClient, status1Signed);

// Status for PR #2: kind:1630 (Open) — signed by Charlie (PR author)
const status2Unsigned = buildStatus(pr2EventId, 1630, pr2Signed.pubkey);
const status2Signed = finalizeEvent(status2Unsigned, charlieSecretKey);
const status2Result = await publishWithRetry(charlieClient, status2Signed);
```

**Status kind mapping (NIP-34):**
- `1630` = Open
- `1631` = Applied (Merged)
- `1632` = Closed
- `1633` = Draft

### State Interface

```typescript
export interface Push06State {
  repoId: string;
  ownerPubkey: string;
  commits: { sha: string; txId: string; message: string }[];  // Same 4 commits as Push05
  shaMap: ShaToTxIdMap;  // Unchanged — no new git objects
  repoAnnouncementId: string;
  refsEventId: string;  // Unchanged from Push05
  branches: string[];   // ['main', 'feature/add-retry'] — unchanged
  tags: string[];        // ['v1.0.0'] — unchanged
  files: string[];       // Same 9 unique paths — unchanged
  prs: {                 // NEW field
    eventId: string;
    title: string;
    authorPubkey: string;
    statusKind: number;
  }[];
}
```

The `Push06State` interface is identical to `Push05State` PLUS a new `prs` array field. All other fields pass through from Push05State unchanged — no new git objects, no refs update, no new branches or tags.

### No New Git Objects

Like Push 05, Push 06 does NOT create any new git objects. There are:
- **Zero** `uploadGitObject` calls
- **Zero** `createGitBlob`/`createGitTree`/`createGitCommit` calls
- **Zero** `signBalanceProof` calls for git object uploads
- **Four** `publishWithRetry` calls (2 patches + 2 statuses)

### Error Handling Pattern

Check `result.success` after each `publishWithRetry` call and throw descriptive errors:

```typescript
if (!pr1Result.success) {
  throw new Error(`Failed to publish PR #1 (kind:1617): ${pr1Result.error}`);
}
```

Same pattern for pr2Result, status1Result, status2Result.

### Event ID Derivation Pattern

```typescript
const pr1EventId = pr1Result.eventId ?? pr1Signed.id;
const pr2EventId = pr2Result.eventId ?? pr2Signed.id;
```

This matches the fallback pattern from Push 4/5.

### Test Pattern — Follow push-05-tag.test.ts

Tests MUST follow the established pattern:
- `describe('Story 10.6: Push 06 — PRs with Status')` as the outer describe
- Unit tests use `[P0]` or `[P1]` priority tags
- Import via `await import('../push-06-prs.js')`
- Infrastructure-dependent tests use `it.todo('[integration] ...')`
- Since no git objects are created, tests focus on event structure and state passthrough
- Use `buildPatch` and `buildStatus` directly in tests to verify event tag structure
- Source-introspection tests (`fs.readFileSync` + string matching) verify no git-builder imports

**Testing the "no uploads" constraint:**
Same approach as Push 05 — output-based verification:
1. `commits` array has exactly 4 entries (same as Push05State input)
2. `shaMap` has same key count as Push05State input
3. `files` array is identical to Push05State input

### buildPatch API Reference

From `event-builders.ts` line 174:

```typescript
function buildPatch(
  repoOwnerPubkey: string,
  repoId: string,
  title: string,
  commits: { sha: string; parentSha: string }[],
  branchTag?: string
): UnsignedEvent
```

Produces kind:1617 with tags:
- `['a', '30617:<ownerPubkey>:<repoId>']` — repo reference
- `['p', ownerPubkey]` — repo owner pubkey
- `['subject', title]` — PR title
- `['commit', sha]` + `['parent-commit', parentSha]` — for each commit
- `['t', branchTag]` — optional branch name

### buildStatus API Reference

From `event-builders.ts` line 215:

```typescript
function buildStatus(
  targetEventId: string,
  statusKind: 1630 | 1631 | 1632 | 1633,
  targetPubkey?: string
): UnsignedEvent
```

Produces kind:1630-1633 with tags:
- `['e', targetEventId]` — references the patch/PR/issue event
- `['p', targetPubkey]` — optional, pubkey of target event author

### AGENT_IDENTITIES — Carol = Charlie

The project uses `carol` in `AGENT_IDENTITIES`, not `charlie`. This is consistent across all test infrastructure:

```typescript
// From constants.ts / socialverse-agent-harness.ts
AGENT_IDENTITIES.carol.pubkey    // '7634b7c7d979145c526202407176832b05b71e06fd5b05f977c0a371dc9913b8'
AGENT_IDENTITIES.carol.secretKeyHex  // '6e1d84d1c6437e2002629bb22e5fe21a39a5ad4139ead1d00900e1f89b981964'
```

The function parameter should be named `charlieClient` / `charlieSecretKey` for readability (matching the epic's "Alice/Bob/Charlie" naming), but the actual identity comes from `AGENT_IDENTITIES.carol`.

### Project Structure Notes

- File locations:
  - `packages/rig/tests/e2e/seed/push-06-prs.ts`
  - `packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts`
- Naming follows the exact pattern: `push-NN-descriptor.ts` and `push-NN-descriptor.test.ts`
- All imports use `.js` extension (ESM convention per project rules)
- No new dependencies needed — reuses existing seed library from Story 10.1
- No new seed lib exports needed — `buildPatch` and `buildStatus` already exist in event-builders.ts

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` -- Story 10.6 acceptance criteria]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` -- Phase 2 seed script verification, push-06-prs assertions]
- [Source: `_bmad-output/implementation-artifacts/10-5-seed-tag.md` -- Direct predecessor story, patterns and learnings]
- [Source: `packages/rig/tests/e2e/seed/push-05-tag.ts` -- Push 5 implementation (direct predecessor)]
- [Source: `packages/rig/tests/e2e/seed/__tests__/push-05-tag.test.ts` -- Test pattern to follow]
- [Source: `packages/rig/tests/e2e/seed/lib/event-builders.ts` -- buildPatch API (line 174), buildStatus API (line 215)]
- [Source: `packages/rig/tests/e2e/seed/lib/publish.ts` -- publishWithRetry API]
- [Source: `packages/rig/tests/e2e/seed/lib/constants.ts` -- AGENT_IDENTITIES re-export]
- [Source: `packages/rig/tests/e2e/seed/lib/index.ts` -- Barrel exports (confirms buildPatch, buildStatus, AGENT_IDENTITIES available)]
- [Source: `packages/client/tests/e2e/socialverse-agent-harness.ts` -- AGENT_IDENTITIES definition (carol, not charlie)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required.

### Completion Notes List

- Task 1: Created `push-06-prs.ts` implementing `runPush06()` with multi-client support (Alice + Charlie). Builds and publishes 2 kind:1617 PR events and 2 status events (kind:1631 Applied for PR #1, kind:1630 Open for PR #2). All Push05State fields pass through unchanged. No git objects created. Author pubkeys derived from signed events (pr1Signed.pubkey, pr2Signed.pubkey).
- Task 2: Test file `push-06-prs.test.ts` already existed (pre-authored ATDD). All 22 unit tests pass against the implementation. 5 integration test stubs remain as `.todo`. Total: 27 tests (22 passed, 5 todo).

### Change Log

- 2026-03-30: Story 10.6 implementation complete. Created push-06-prs.ts, verified against pre-existing ATDD test suite (27 tests, 22 passed, 5 todo). All seed tests (13 files, 189 passed) and lint pass.
- 2026-03-30: Code review #1 — removed unused AGENT_IDENTITIES import (dead code with eslint-disable), updated test to verify pubkeys derived from signed events, corrected test counts in completion notes.
- 2026-03-30: Code review #2 — fixed stale section comment in test file (AGENT_IDENTITIES reference), tightened Push06State.statusKind type from `number` to union `1630 | 1631 | 1632 | 1633`, updated test assertion to match. All 189 seed tests pass.

### File List

- packages/rig/tests/e2e/seed/push-06-prs.ts (created, review: removed unused AGENT_IDENTITIES import)
- packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts (pre-existing, review: updated AGENT_IDENTITIES test to verify pubkey derivation from signed events)
- _bmad-output/implementation-artifacts/10-6-seed-prs-with-status.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/test-artifacts/atdd-checklist-10-6.md (created)
- _bmad-output/test-artifacts/nfr-assessment-10-6.md (created)

## Code Review Record

### Review Pass #1

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 3
- **Low Issues Fixed:**
  1. Removed unused `AGENT_IDENTITIES` import (dead code with eslint-disable comment)
  2. Corrected test counts in completion notes (Dev Agent Record)
  3. Added missing test artifact files (`atdd-checklist-10-6.md`, `nfr-assessment-10-6.md`) to File List
- **Review Follow-ups:** None

### Review Pass #2

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 2
- **Low Issues Fixed:**
  1. Fixed stale section comment in test file (line 367): changed "AC-6.1: Source imports AGENT_IDENTITIES for Charlie's pubkey" to "AC-6.4: authorPubkeys derived from signed events, not AGENT_IDENTITIES"
  2. Tightened `Push06State.statusKind` type from `number` to `1630 | 1631 | 1632 | 1633` (matches `buildStatus` union type for type safety); updated corresponding test assertion
- **Review Follow-ups:** None

### Review Pass #3

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 0
- **Semgrep Security Scan:** 0 findings across 213 rules
- **Review Follow-ups:** None
