# Story 10.7: Seed Script — Issues, Labels, Conversations (Push 7)

Status: done

## Story

As a **TOON developer**,
I want a seed script that publishes 2 issues (kind:1621) with labels and multi-client comment threads (kind:1622),
so that Playwright specs can verify issue listing, label filtering, comment threads, and multi-author attribution.

## Acceptance Criteria

1. **AC-7.1:** `seed/push-07-issues.ts` publishes 2 kind:1621 issues: Issue #1 "Add WebSocket reconnection logic" by Alice (t tags: enhancement, networking); Issue #2 "Fix deep path navigation bug" by Bob (t tags: bug, forge-ui). Both with `a` tag referencing repo.
2. **AC-7.2:** Comment thread on Issue #1 (kind:1622, e tag -> issue event ID): Bob: "Should we use exponential backoff?", Alice: "Yes, with jitter. See RFC 6298.", Charlie: "What about connection pooling?" — comments array preserves publication order.
3. **AC-7.3:** Comment thread on Issue #2: Alice: "Reproduced at depth 3+", Bob: "Root cause is in tree SHA resolution" — comments array preserves publication order.
4. **AC-7.4:** All comments have correct `e` tag pointing to parent issue event ID, `p` tag for author threading, and `a` tag referencing the repository.

## Tasks / Subtasks

- [x] Task 1: Create `push-07-issues.ts` module (AC: 7.1, 7.2, 7.3, 7.4)
  - [x] 1.1: Export `Push07State` interface — extends Push06State with `issues: { eventId: string; title: string; authorPubkey: string; labels: string[] }[]` and `comments: { eventId: string; issueEventId: string; authorPubkey: string; body: string }[]` fields
  - [x] 1.2: Export `runPush07(aliceClient, bobClient, charlieClient, aliceSecretKey, bobSecretKey, charlieSecretKey, push06State): Promise<Push07State>`
  - [x] 1.3: Build Issue #1 using `buildIssue(ownerPubkey, REPO_ID, 'Add WebSocket reconnection logic', body, ['enhancement', 'networking'])` signed by Alice (AC: 7.1)
  - [x] 1.4: Build Issue #2 using `buildIssue(ownerPubkey, REPO_ID, 'Fix deep path navigation bug', body, ['bug', 'forge-ui'])` signed by Bob (AC: 7.1)
  - [x] 1.5: Publish both kind:1621 events via `publishWithRetry()` — Alice publishes Issue #1, Bob publishes Issue #2 (AC: 7.1)
  - [x] 1.6: Derive event IDs using `result.eventId ?? signed.id` fallback pattern
  - [x] 1.7: Build and publish 3 kind:1622 comments on Issue #1 — Bob comment, Alice comment, Charlie comment (AC: 7.2, 7.4)
  - [x] 1.8: Build and publish 2 kind:1622 comments on Issue #2 — Alice comment, Bob comment (AC: 7.3, 7.4)
  - [x] 1.9: Return Push07State — pass through all Push06State fields unchanged, add `issues` and `comments` arrays (AC: 7.1)

- [x] Task 2: Write ATDD tests for push-07-issues (AC: 7.1, 7.2, 7.3, 7.4)
  - [x] 2.1: Create `__tests__/push-07-issues.test.ts` with `describe('Story 10.7: Push 07 — Issues, Labels, Conversations')`
  - [x] 2.2: Unit test: module exports `runPush07` function and `Push07State` type
  - [x] 2.3: Unit test: `runPush07` accepts 7 parameters (3 clients, 3 secret keys, push06State)
  - [x] 2.4: Unit test: `buildIssue` for Issue #1 produces kind:1621 with correct `a` tag, `subject` tag, `t` tags for enhancement and networking (AC: 7.1)
  - [x] 2.5: Unit test: `buildIssue` for Issue #2 produces kind:1621 with correct `a` tag, `subject` tag, `t` tags for bug and forge-ui (AC: 7.1)
  - [x] 2.6: Unit test: `buildComment` produces kind:1622 with correct `e` tag (marker: 'reply'), `a` tag, and `p` tag (AC: 7.4)
  - [x] 2.7: Unit test: Push07State.issues has 2 entries with correct titles, labels, and distinct authorPubkeys (AC: 7.1)
  - [x] 2.8: Unit test: Push07State.comments has 5 entries with correct issueEventId references and distinct authorPubkeys (AC: 7.2, 7.3)
  - [x] 2.9: Unit test: Push07State passes through all Push06State fields unchanged (commits, shaMap, branches, tags, files, prs, repoId, ownerPubkey, repoAnnouncementId, refsEventId)
  - [x] 2.10: Unit test: no new git objects created — shaMap key count unchanged, commits array unchanged, files array unchanged
  - [x] 2.11: Unit test: module does NOT import `createGitBlob`, `createGitTree`, `createGitCommit`, `uploadGitObject`, or `signBalanceProof`
  - [x] 2.12: Unit test: Push07State.comments preserves publication order — Issue #1 comments (Bob, Alice, Charlie) at indices 0-2, Issue #2 comments (Alice, Bob) at indices 3-4 (AC: 7.2, 7.3)
  - [x] 2.13: Integration test stubs (`.todo`) for live relay publishing (AC: 7.1-7.4)

## Prerequisites

- **Story 10.6 complete:** `push-06-prs.ts` must be implemented and its `Push06State` interface available for import. (Note: epic dependency table lists 10.1, but Push 07 imports `Push06State` from `push-06-prs.js`, so 10.6 is the actual prerequisite.)
- **Seed lib from Story 10.1:** All seed lib modules available (`buildIssue`, `buildComment`, `publishWithRetry` from barrel). Note: `AGENT_IDENTITIES` is NOT imported by this module — author pubkeys are derived from signed events.
- **SDK E2E infrastructure running:** `./scripts/sdk-e2e-infra.sh up` for integration verification (not required for unit tests).

## Dev Notes

### Critical Pattern: Three-Client Push Script

This is the FIRST push script that uses THREE ToonClient instances. Push 06 used two (Alice + Charlie). Push 07 adds Bob as a third author to seed multi-author comment threads for Playwright spec verification.

**Key difference from Push 06:**
- Function signature takes THREE clients and THREE secret keys (Alice + Bob + Charlie)
- Bob's identity comes from `AGENT_IDENTITIES.bob` in the socialverse harness
- Charlie's identity comes from `AGENT_IDENTITIES.carol` (NOTE: the constant is `carol`, not `charlie`)
- Each issue/comment is signed by its respective author's secret key via `finalizeEvent(event, secretKey)`
- Each issue/comment is published via its respective author's client via `publishWithRetry(client, signedEvent)`

### Import Pattern — Three-Client

```typescript
import { finalizeEvent } from 'nostr-tools/pure';
import type { ToonClient } from '@toon-protocol/client';
import {
  buildIssue,
  buildComment,
  publishWithRetry,
  type ShaToTxIdMap,
} from './lib/index.js';
import { REPO_ID } from './push-01-init.js';
import { type Push06State } from './push-06-prs.js';
```

Note: `AGENT_IDENTITIES` is NOT needed in this module. Author pubkeys are derived from signed events (`signed.pubkey`), not from identity constants. This matches the pattern established in Push 06 code review (unused AGENT_IDENTITIES import was removed).

### Issue #1 — Alice's Enhancement Issue

```typescript
const issue1Unsigned = buildIssue(
  push06State.ownerPubkey,
  REPO_ID,
  'Add WebSocket reconnection logic',
  'We need automatic reconnection with backoff when the WebSocket connection drops.',
  ['enhancement', 'networking']
);
const issue1Signed = finalizeEvent(issue1Unsigned, aliceSecretKey);
const issue1Result = await publishWithRetry(aliceClient, issue1Signed);
```

### Issue #2 — Bob's Bug Report

```typescript
const issue2Unsigned = buildIssue(
  push06State.ownerPubkey,
  REPO_ID,
  'Fix deep path navigation bug',
  'Navigation breaks when traversing directories deeper than 3 levels.',
  ['bug', 'forge-ui']
);
const issue2Signed = finalizeEvent(issue2Unsigned, bobSecretKey);
const issue2Result = await publishWithRetry(bobClient, issue2Signed);
```

### Comment Threads

**Issue #1 comments (3 comments, 3 authors):**

```typescript
// Comment 1: Bob on Issue #1
const c1Unsigned = buildComment(
  push06State.ownerPubkey,
  REPO_ID,
  issue1EventId,
  issue1Signed.pubkey,  // p tag = issue author pubkey
  'Should we use exponential backoff?'
);
const c1Signed = finalizeEvent(c1Unsigned, bobSecretKey);

// Comment 2: Alice on Issue #1
const c2Unsigned = buildComment(
  push06State.ownerPubkey,
  REPO_ID,
  issue1EventId,
  issue1Signed.pubkey,
  'Yes, with jitter. See RFC 6298.'
);
const c2Signed = finalizeEvent(c2Unsigned, aliceSecretKey);

// Comment 3: Charlie on Issue #1
const c3Unsigned = buildComment(
  push06State.ownerPubkey,
  REPO_ID,
  issue1EventId,
  issue1Signed.pubkey,
  'What about connection pooling?'
);
const c3Signed = finalizeEvent(c3Unsigned, charlieSecretKey);
```

**Issue #2 comments (2 comments, 2 authors):**

```typescript
// Comment 4: Alice on Issue #2
const c4Unsigned = buildComment(
  push06State.ownerPubkey,
  REPO_ID,
  issue2EventId,
  issue2Signed.pubkey,  // p tag = issue author pubkey (Bob)
  'Reproduced at depth 3+'
);
const c4Signed = finalizeEvent(c4Unsigned, aliceSecretKey);

// Comment 5: Bob on Issue #2
const c5Unsigned = buildComment(
  push06State.ownerPubkey,
  REPO_ID,
  issue2EventId,
  issue2Signed.pubkey,
  'Root cause is in tree SHA resolution'
);
const c5Signed = finalizeEvent(c5Unsigned, bobSecretKey);
```

### buildComment API Reference

From `event-builders.ts` line 141:

```typescript
function buildComment(
  repoOwnerPubkey: string,
  repoId: string,
  issueOrPrEventId: string,
  authorPubkey: string,    // p tag — pubkey of the ISSUE/PR author (for threading), NOT the comment author
  body: string,
  marker: 'root' | 'reply' = 'reply'
): UnsignedEvent
```

Produces kind:1622 with tags:
- `['a', '30617:<ownerPubkey>:<repoId>']` — repo reference
- `['e', issueOrPrEventId, '', marker]` — references the issue/PR event (marker defaults to 'reply')
- `['p', authorPubkey]` — pubkey of the target event author (for threading)

**IMPORTANT:** The `authorPubkey` parameter in `buildComment` is the **issue/PR author's pubkey** (for NIP-34 `p` tag threading), NOT the comment author's pubkey. The comment author is determined by who signs the event with `finalizeEvent`.

**JSDoc discrepancy:** The source code JSDoc at `event-builders.ts` line 137 says `@param authorPubkey - Pubkey of the comment author`, which is misleading. The parameter is actually used as the `p` tag value for NIP-34 threading (referencing the issue/PR author being replied to). The code examples in this story pass `issue1Signed.pubkey` / `issue2Signed.pubkey` (the issue author's pubkey), which is the correct NIP-34 usage.

### buildIssue API Reference

From `event-builders.ts` line 105:

```typescript
function buildIssue(
  repoOwnerPubkey: string,
  repoId: string,
  title: string,
  body: string,
  labels: string[] = []
): UnsignedEvent
```

Produces kind:1621 with tags:
- `['a', '30617:<ownerPubkey>:<repoId>']` — repo reference
- `['p', repoOwnerPubkey]` — repo owner pubkey
- `['subject', title]` — issue title
- `['t', label]` — one per label

### State Interface

```typescript
export interface Push07State {
  repoId: string;
  ownerPubkey: string;
  commits: { sha: string; txId: string; message: string }[];  // Same 4 commits — unchanged
  shaMap: ShaToTxIdMap;  // Unchanged — no new git objects
  repoAnnouncementId: string;
  refsEventId: string;  // Unchanged
  branches: string[];   // ['main', 'feature/add-retry'] — unchanged
  tags: string[];        // ['v1.0.0'] — unchanged
  files: string[];       // Same 9 unique paths — unchanged
  prs: {                 // Unchanged from Push06
    eventId: string;
    title: string;
    authorPubkey: string;
    statusKind: 1630 | 1631 | 1632 | 1633;
  }[];
  issues: {              // NEW field
    eventId: string;
    title: string;
    authorPubkey: string;
    labels: string[];
  }[];
  comments: {            // NEW field
    eventId: string;
    issueEventId: string;
    authorPubkey: string;
    body: string;
  }[];
}
```

The `Push07State` interface is identical to `Push06State` PLUS new `issues` and `comments` array fields. All other fields pass through from Push06State unchanged.

### No New Git Objects

Like Push 05 and Push 06, Push 07 does NOT create any new git objects. There are:
- **Zero** `uploadGitObject` calls
- **Zero** `createGitBlob`/`createGitTree`/`createGitCommit` calls
- **Zero** `signBalanceProof` calls for git object uploads
- **Seven** `publishWithRetry` calls (2 issues + 5 comments)

### Error Handling Pattern

Check `result.success` after each `publishWithRetry` call and throw descriptive errors:

```typescript
if (!issue1Result.success) {
  throw new Error(`Failed to publish Issue #1 (kind:1621): ${issue1Result.error}`);
}
```

Same pattern for all 7 publish calls. Use descriptive error messages that identify the specific event:
- `Failed to publish Issue #2 (kind:1621): ...`
- `Failed to publish comment 1 on Issue #1 (kind:1622): ...`
- `Failed to publish comment 2 on Issue #1 (kind:1622): ...`
- `Failed to publish comment 3 on Issue #1 (kind:1622): ...`
- `Failed to publish comment 1 on Issue #2 (kind:1622): ...`
- `Failed to publish comment 2 on Issue #2 (kind:1622): ...`

### Event ID Derivation Pattern

```typescript
const issue1EventId = issue1Result.eventId ?? issue1Signed.id;
const issue2EventId = issue2Result.eventId ?? issue2Signed.id;
```

This matches the fallback pattern from Push 4/5/6.

For comments, derive event IDs the same way for inclusion in the `comments` array of Push07State:

```typescript
const c1EventId = c1Result.eventId ?? c1Signed.id;
const c2EventId = c2Result.eventId ?? c2Signed.id;
const c3EventId = c3Result.eventId ?? c3Signed.id;
const c4EventId = c4Result.eventId ?? c4Signed.id;
const c5EventId = c5Result.eventId ?? c5Signed.id;
```

### Test Pattern — Follow push-06-prs.test.ts

Tests MUST follow the established pattern:
- `describe('Story 10.7: Push 07 — Issues, Labels, Conversations')` as the outer describe
- Unit tests use `[P0]` or `[P1]` priority tags
- Import via `await import('../push-07-issues.js')`
- Infrastructure-dependent tests use `it.todo('[integration] ...')`
- Since no git objects are created, tests focus on event structure and state passthrough
- Use `buildIssue` and `buildComment` directly in tests to verify event tag structure
- Source-introspection tests (`fs.readFileSync` + string matching) verify no git-builder imports

**Testing the "no uploads" constraint:**
Same approach as Push 05/06 — output-based verification:
1. `commits` array has exactly 4 entries (same as Push06State input)
2. `shaMap` has same key count as Push06State input
3. `files` array is identical to Push06State input
4. `prs` array is identical to Push06State input (unchanged)

### AGENT_IDENTITIES Reference

The project uses these names in `AGENT_IDENTITIES`:
- `alice` — first agent, typically repo owner
- `bob` — second agent
- `carol` — third agent (called "Charlie" in epic docs, but constant is `carol`)

Function parameters should be named `bobClient`/`bobSecretKey` and `charlieClient`/`charlieSecretKey` for readability (matching the epic naming), but the actual identities come from `AGENT_IDENTITIES.bob` and `AGENT_IDENTITIES.carol` respectively.

### Project Structure Notes

- File locations:
  - `packages/rig/tests/e2e/seed/push-07-issues.ts`
  - `packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts`
- Naming follows the exact pattern: `push-NN-descriptor.ts` and `push-NN-descriptor.test.ts`
- All imports use `.js` extension (ESM convention per project rules)
- No new dependencies needed — reuses existing seed library from Story 10.1
- No new seed lib exports needed — `buildIssue` and `buildComment` already exist in event-builders.ts and are exported from barrel

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` -- Story 10.7 acceptance criteria]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` -- Phase 2 seed script verification, push-07-issues assertions]
- [Source: `_bmad-output/implementation-artifacts/10-6-seed-prs-with-status.md` -- Direct predecessor story, multi-client patterns and learnings]
- [Source: `packages/rig/tests/e2e/seed/push-06-prs.ts` -- Push 6 implementation (direct predecessor, multi-client pattern)]
- [Source: `packages/rig/tests/e2e/seed/__tests__/push-06-prs.test.ts` -- Test pattern to follow]
- [Source: `packages/rig/tests/e2e/seed/lib/event-builders.ts` -- buildIssue API (line 105), buildComment API (line 141)]
- [Source: `packages/rig/tests/e2e/seed/lib/publish.ts` -- publishWithRetry API]
- [Source: `packages/rig/tests/e2e/seed/lib/constants.ts` -- AGENT_IDENTITIES re-export]
- [Source: `packages/rig/tests/e2e/seed/lib/index.ts` -- Barrel exports (confirms buildIssue, buildComment, AGENT_IDENTITIES available)]
- [Source: `packages/client/tests/e2e/socialverse-agent-harness.ts` -- AGENT_IDENTITIES definition (alice, bob, carol)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Pre-existing test file `push-07-issues.test.ts` had a test that searched for issue title strings in source; first match was in the JSDoc header comment, causing a false negative. Fixed by rewording the header comment to avoid exact issue title strings.

### Completion Notes List

- Task 1: Created `push-07-issues.ts` implementing `runPush07` with 7 parameters (3 clients, 3 secret keys, push06State). Publishes 2 kind:1621 issues (Alice: enhancement/networking, Bob: bug/forge-ui) and 5 kind:1622 comments across 3 authors. All fields from Push06State pass through unchanged. No git objects created.
- Task 2: Test file `push-07-issues.test.ts` contains 33 tests (28 active + 5 integration .todo stubs) covering all acceptance criteria. All 28 active tests pass. One test required a minor fix to the implementation file's JSDoc comment to avoid false string matching. 10 tests were added during NFR review expanding AC-7.1/7.4 coverage.
- Full regression suite: 144 test files, 4062 tests pass, 0 failures.
- Lint: 0 new errors (2 pre-existing errors in unrelated file `docker/src/entrypoint-sdk.ts`). Only warnings (non-null assertions) in test file, consistent with project pattern.

### File List

- `packages/rig/tests/e2e/seed/push-07-issues.ts` (created)
- `packages/rig/tests/e2e/seed/__tests__/push-07-issues.test.ts` (pre-existing, modified — 10 tests added in NFR review expanding AC-7.1/7.4 coverage)
- `packages/rig/tests/e2e/seed/lib/event-builders.ts` (modified — JSDoc fix: `buildComment` `authorPubkey` param clarified as issue/PR author for NIP-34 `p` tag threading, not comment author)
- `_bmad-output/implementation-artifacts/10-7-seed-issues-labels-conversations.md` (modified)

### Change Log

- 2026-03-30: Implemented Story 10.7 — created push-07-issues.ts seed script publishing 2 issues and 5 comments across 3 authors (Alice, Bob, Charlie). All tests pass, no regressions.
- 2026-03-30: Code review — Fixed File List: test file was modified (not unchanged), event-builders.ts JSDoc fix was undocumented. Updated story status to done.
- 2026-03-30: Code review #3 (adversarial + OWASP security scan) — 0 issues found. Semgrep scan clean. Full OWASP Top 10 assessment: no vulnerabilities. All 4062 tests pass, 0 lint errors.

## Code Review Record

### Review Pass #1

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Severity Counts:** 0 critical, 0 high, 3 medium, 2 low
- **Issues Found:**
  - [M1] File List missing test file modification — test file was listed as unchanged but was modified (10 tests added in NFR review). **Fixed:** File List updated to show `(pre-existing, modified)`.
  - [M2] File List missing event-builders.ts — JSDoc fix to `buildComment` `authorPubkey` param was not documented. **Fixed:** Added `event-builders.ts` entry to File List.
  - [M3] Wrong test count in Completion Notes — test count was inaccurate. **Fixed:** Completion Notes updated to reflect 33 tests (28 active + 5 integration .todo stubs).
  - [L1] Unrelated infra changes in commit — staged changes included unrelated files (docker-compose-sdk-e2e.yml, entrypoint-sdk.ts, chain-config.ts, etc.). **Noted:** These are branch-level WIP changes, not introduced by this story.
  - [L2] Non-null assertion warnings — test file uses `!` non-null assertions. **Noted:** Consistent with established project pattern across all push test files.
- **Outcome:** Pass — all medium issues fixed, low issues noted as acceptable.

### Review Pass #2

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Issues Found:** None — clean pass. No files modified.
- **Outcome:** Pass — no issues found. All action items from Review Pass #1 previously resolved.

### Review Pass #3 (Adversarial + OWASP Security Scan)

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Review Scope:** Full adversarial code review + OWASP Top 10 security assessment + Semgrep static analysis + authentication/authorization flaw analysis + injection risk analysis
- **Security Scan Results:**
  - **Semgrep:** 0 findings across all 4 scanned files (push-07-issues.ts, push-07-issues.test.ts, event-builders.ts, publish.ts)
  - **OWASP Top 10 Assessment:** No vulnerabilities. A01 (Access Control) N/A — seed script with provided credentials. A02 (Crypto) N/A — uses nostr-tools finalizeEvent. A03 (Injection) — no executable string interpolation. A07 (Auth) — secret keys are parameters, not hardcoded. All other categories N/A for seed script context.
  - **Auth/AuthZ Flaws:** None — secret keys passed as function parameters, signing handled by nostr-tools, no credential storage in source.
  - **Injection Risks:** None — error messages use template literals in throw statements only, no eval/exec/innerHTML/SQL.
- **Validation Results:**
  - **AC-7.1:** IMPLEMENTED — 2 kind:1621 issues with correct `a`, `subject`, `t`, `p` tags. Alice signs Issue #1, Bob signs Issue #2.
  - **AC-7.2:** IMPLEMENTED — 3 comments on Issue #1 (Bob, Alice, Charlie) in correct order.
  - **AC-7.3:** IMPLEMENTED — 2 comments on Issue #2 (Alice, Bob) in correct order.
  - **AC-7.4:** IMPLEMENTED — All 5 comments have correct `e` tag (parent issue event ID), `p` tag (issue author pubkey for NIP-34 threading), `a` tag (repo reference).
  - **All 19 tasks:** Verified as actually implemented (no false [x] claims).
  - **Tests:** 28 active + 5 todo = 33 total. All 28 active pass. Full suite: 4062 tests pass, 0 failures.
  - **Lint:** 0 errors, 14 warnings (non-null assertions — consistent with established project pattern across all push test files, e.g., push-06 has 16 identical warnings).
  - **File List:** Accurate — 3 files documented with correct change types.
  - **Git vs Story:** No discrepancies. All claimed files have corresponding git evidence.
- **Issues Found:** None.
- **Outcome:** Pass — clean review. No files modified. Story confirmed as done.
