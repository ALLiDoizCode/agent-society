# Story 10.3: Seed Script — Nested Directory Structure (Push 2)

Status: done

## Story

As a **TOON developer**,
I want a seed script that adds deeply nested directory structures to the E2E test repository via incremental git push,
so that Playwright specs can verify the known depth navigation bug is fixed and regression-tested at depth 4.

## Acceptance Criteria

1. **AC-3.1:** `seed/push-02-nested.ts` adds files at increasing depths: `src/lib/core.ts` (depth 2), `src/lib/utils/format.ts` (depth 3), `src/lib/utils/helpers/deep-file.ts` (depth 4), `docs/guide.md` (depth 1)
2. **AC-3.2:** Only new/changed git objects uploaded (delta from Push 1's SHA map)
3. **AC-3.3:** New commit has parent = Push 1's commit SHA
4. **AC-3.4:** kind:30618 refs updated — main branch advances, arweave map includes all objects from both pushes
5. **AC-3.5:** `runPush02()` returns `Push02State` with appended commits array, expanded shaMap, and updated files list — no direct `state.json` writes (orchestrator handles persistence)

## Tasks / Subtasks

- [x] Task 1: Create `push-02-nested.ts` module with file content constants (AC: 3.1)
  - [x] 1.1: Define content constants for `src/lib/core.ts`, `src/lib/utils/format.ts`, `src/lib/utils/helpers/deep-file.ts`, `docs/guide.md`
  - [x] 1.2: Export `Push02State` interface extending Push01State with new commit and file entries
  - [x] 1.3: Export `runPush02` function accepting `(aliceClient, aliceSecretKey, push01State)` parameters
- [x] Task 2: Build git objects with nested tree structure (AC: 3.1, 3.3)
  - [x] 2.1: Create 4 new blobs (core.ts, format.ts, deep-file.ts, guide.md)
  - [x] 2.2: Build nested tree hierarchy bottom-up: `helpers/` tree -> `utils/` tree -> `lib/` tree -> `src/` tree -> root tree (also including `docs/` subtree)
  - [x] 2.3: Root tree must include ALL entries from Push 1 (README.md, package.json, src/) plus new `docs/` — reuse Push 1 blob SHAs, but trees at `src/` and above are NEW because tree contents changed
  - [x] 2.4: Create commit with `parentSha` = Push 1 commit SHA, fixed timestamp for determinism
- [x] Task 3: Upload only delta objects to Arweave (AC: 3.2)
  - [x] 3.1: Pass accumulated `shaMap` from Push 1 to `uploadGitObject()` — delta logic in `git-builder.ts` skips already-uploaded SHAs
  - [x] 3.2: Sign per-object balance proofs via `aliceClient.signBalanceProof(channelId, perObjectAmount)` — same pattern as Push 1
  - [x] 3.3: Validate each upload returns a valid txId (fail-fast per R10-003)
- [x] Task 4: Publish updated kind:30618 refs (AC: 3.4)
  - [x] 4.1: Call `buildRepoRefs()` with REPO_ID, updated `{ 'refs/heads/main': newCommitSha }`, and the full accumulated `shaMap` (both Push 1 + Push 2 entries)
  - [x] 4.2: Sign and publish via `publishWithRetry(aliceClient, refsSigned)`
  - [x] 4.3: Do NOT re-publish kind:30617 repo announcement (it doesn't change)
- [x] Task 5: Return updated state (AC: 3.5)
  - [x] 5.1: Return `Push02State` with appended commits array, expanded shaMap, updated files list
  - [x] 5.2: State return only — no direct `state.json` writes (orchestrator handles persistence)
- [x] Task 6: Write ATDD tests (AC: all)
  - [x] 6.1: Create `__tests__/push-02-nested.test.ts` following push-01-init.test.ts pattern
  - [x] 6.2: Unit tests for deterministic SHA computation of all 4 new blobs
  - [x] 6.3: Unit tests for nested tree structure correctness (entries, sorting, SHA references)
  - [x] 6.4: Unit test verifying commit body contains `parent <push01CommitSha>`
  - [x] 6.5: Unit test verifying delta logic — only new objects are in the upload list (reused Push 1 blobs like README.md, package.json are NOT re-uploaded)
  - [x] 6.6: Unit test verifying kind:30618 refs includes arweave tags from BOTH pushes
  - [x] 6.7: Integration test stubs (`.todo`) for live Arweave DVM upload validation

## Prerequisites

- **Story 10.2 complete:** `push-01-init.ts` must be implemented and its `Push01State` interface available for import.
- **Seed lib from Story 10.1:** All seed lib modules (`git-builder.ts`, `event-builders.ts`, `publish.ts`, `constants.ts`) must be available.
- **SDK E2E infrastructure running:** `./scripts/sdk-e2e-infra.sh up` for integration verification (not required for unit tests).

## Dev Notes

### Critical Pattern: Follow Push 1 Exactly

The implementation MUST follow the exact same patterns established in `push-01-init.ts` (Story 10.2). Key patterns:

1. **Import from barrel**: `import { createGitBlob, createGitTree, createGitCommit, uploadGitObject, buildRepoRefs, publishWithRetry, AGENT_IDENTITIES, type ShaToTxIdMap } from './lib/index.js';`
2. **finalizeEvent for signing**: `import { finalizeEvent } from 'nostr-tools/pure';`
3. **ToonClient type import**: `import type { ToonClient } from '@toon-protocol/client';`
4. **Channel ID retrieval**: `const channelId = aliceClient.getTrackedChannels()[0];`
5. **Balance proof signing**: `aliceClient.signBalanceProof(channelId, BigInt(obj.body.length) * 10n)` — pass per-object delta, NOT cumulative (ChannelManager auto-accumulates internally)
6. **Upload order**: blobs first, then trees leaf-to-root, then commit
7. **Fail-fast on undefined txId**: Check `result.txId` after each upload

### Git Tree Construction — The Tricky Part

Building nested trees requires careful bottom-up construction. The tree hierarchy for Push 2 is:

```
root tree
├── README.md       (blob SHA from Push 1 — REUSED, not re-uploaded)
├── package.json    (blob SHA from Push 1 — REUSED, not re-uploaded)
├── docs/           (NEW tree)
│   └── guide.md    (NEW blob)
└── src/            (NEW tree — different SHA from Push 1 because children changed)
    ├── index.ts    (blob SHA from Push 1 — REUSED)
    └── lib/        (NEW tree)
        ├── core.ts (NEW blob)
        └── utils/  (NEW tree)
            ├── format.ts    (NEW blob)
            └── helpers/     (NEW tree)
                └── deep-file.ts (NEW blob)
```

**Build order (leaf-to-root):**
1. `helpers/` tree (contains deep-file.ts blob)
2. `utils/` tree (contains format.ts blob + helpers/ tree)
3. `lib/` tree (contains core.ts blob + utils/ tree)
4. `src/` tree (contains index.ts blob from Push 1 + lib/ tree) — NEW SHA because lib/ is new
5. `docs/` tree (contains guide.md blob)
6. Root tree (contains README.md blob, package.json blob, src/ tree, docs/ tree)

**Critical**: Even though `README.md`, `package.json`, and `src/index.ts` blob SHAs are reused from Push 1, any tree that has new entries or changed child tree SHAs will produce a NEW tree SHA. The root tree SHA will be different from Push 1's root tree because `src/` subtree changed and `docs/` was added.

### Delta Upload Logic

The `uploadGitObject()` function in `git-builder.ts` already handles delta logic:
```typescript
// Delta logic: skip if already uploaded
const existing = shaMap[sha];
if (existing) {
  return { sha, txId: existing };
}
```

Push 2 reuses blob SHAs from Push 1 (README.md, package.json, index.ts). These will be automatically skipped by the delta check. Only NEW objects need uploading:
- 4 new blobs (core.ts, format.ts, deep-file.ts, guide.md)
- 6 new trees (helpers/, utils/, lib/, src/, docs/, root) — all trees are new because structure changed; root tree SHA differs from Push 1 because `src/` subtree changed and `docs/` was added
- 1 new commit

That's exactly 11 new objects to upload (4 blobs + 6 trees + 1 commit). The 3 reused blobs from Push 1 are skipped by delta logic.

### File Contents — Keep Minimal (R10-005)

Per test design risk R10-005, seed file content must stay well under 95KB. Use short, meaningful content:

```typescript
export const CORE_TS_CONTENT = `export class Core {
  init(): void { /* core initialization */ }
}
`;

export const FORMAT_TS_CONTENT = `export function formatOutput(data: string): string {
  return data.trim();
}
`;

export const DEEP_FILE_TS_CONTENT = `export const DEEP_CONSTANT = 'found-at-depth-4';
`;

export const GUIDE_MD_CONTENT = `# Guide

Getting started with rig-e2e-test-repo.
`;
```

### Commit Determinism

Use a fixed timestamp that is AFTER Push 1's timestamp (1700000000):

```typescript
const commit = createGitCommit({
  treeSha: rootTree.sha,
  parentSha: push01State.commits[0].sha, // Push 1 commit
  authorName: 'Alice',
  authorPubkey: AGENT_IDENTITIES.alice.pubkey,
  message: 'Add nested directory structure',
  timestamp: 1700001000, // 1000 seconds after Push 1
});
```

### State Interface

```typescript
export interface Push02State {
  repoId: string;
  ownerPubkey: string;
  commits: { sha: string; txId: string; message: string }[];
  shaMap: ShaToTxIdMap;
  repoAnnouncementId: string;
  refsEventId: string;
  branches: string[];
  files: string[];
}
```

The `commits` array appends the new commit to Push 1's commits. The `files` array includes all files from both pushes.

### Test Pattern — Follow push-01-init.test.ts

Tests in `__tests__/push-02-nested.test.ts` must follow the same pattern:
- `describe('Story 10.3: Push 02 — Nested Directory Structure')`
- Unit tests use `[P0]` priority tags
- Import via `await import('../push-02-nested.js')` and `await import('../lib/git-builder.js')`
- Infrastructure-dependent tests use `it.todo('[integration] ...')`
- Test deterministic SHA generation by running object creation twice and comparing
- Test tree entry contents by inspecting `body.toString('binary')`

### Key Dependency: Push01State Input

`runPush02` receives the output of `runPush01` (or equivalent state). It needs:
- `push01State.commits[0].sha` — parent commit SHA
- `push01State.shaMap` — accumulated SHA-to-txId map (mutated in-place by uploadGitObject)
- `push01State.repoAnnouncementId` — passed through (not re-published)
- `push01State.repoId` — REPO_ID for refs event

Import `REPO_ID` from `push-01-init.ts` or pass via state — keep consistent.

### Project Structure Notes

- File location: `packages/rig/tests/e2e/seed/push-02-nested.ts`
- Test location: `packages/rig/tests/e2e/seed/__tests__/push-02-nested.test.ts`
- Both files follow the exact naming pattern from Story 10.2
- All imports use `.js` extension (ESM convention per project rules)
- No new dependencies needed — reuses existing seed library from Story 10.1

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` — Story 10.3 acceptance criteria]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` — Phase 2 seed script verification, R10-001/R10-003/R10-005 mitigations]
- [Source: `packages/rig/tests/e2e/seed/push-01-init.ts` — Push 1 implementation pattern (the template)]
- [Source: `packages/rig/tests/e2e/seed/__tests__/push-01-init.test.ts` — Test pattern to follow]
- [Source: `packages/rig/tests/e2e/seed/lib/git-builder.ts` — createGitBlob/createGitTree/createGitCommit/uploadGitObject APIs]
- [Source: `packages/rig/tests/e2e/seed/lib/event-builders.ts` — buildRepoRefs API]
- [Source: `packages/rig/tests/e2e/seed/lib/publish.ts` — publishWithRetry API]
- [Source: `packages/rig/tests/e2e/seed/lib/constants.ts` — AGENT_IDENTITIES, PEER1_DESTINATION]

## Handoff

STORY_FILE: _bmad-output/implementation-artifacts/10-3-seed-nested-directory-structure.md

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — all 19 unit tests passed on first run.

### Completion Notes List
- Task 1: Created `push-02-nested.ts` with 4 file content constants (CORE_TS_CONTENT, FORMAT_TS_CONTENT, DEEP_FILE_TS_CONTENT, GUIDE_MD_CONTENT), Push02State interface, and runPush02 function accepting (aliceClient, aliceSecretKey, push01State).
- Task 2: Built nested git tree hierarchy bottom-up (helpers/ -> utils/ -> lib/ -> src/ -> docs/ -> root), reusing Push 1 blob SHAs for README.md, package.json, index.ts. Commit uses parentSha from push01State and fixed timestamp 1700001000.
- Task 3: Delta upload implemented — reused blob SHAs checked against shaMap before signing claims, only new objects uploaded. Fail-fast on undefined txId per R10-003.
- Task 4: kind:30618 refs published with accumulated shaMap from both pushes. kind:30617 repo announcement NOT re-published (passed through from push01State).
- Task 5: Returns Push02State with appended commits array (2 entries), expanded shaMap, full 7-file list. No direct state.json writes.
- Task 6: Pre-existing ATDD tests (push-02-nested.test.ts) — all 19 unit tests pass, 14 integration test stubs marked .todo.

### Change Log
- 2026-03-29: Created push-02-nested.ts implementation; all ATDD tests green. Updated story status to complete.
- 2026-03-29: Code review #1 — 0 critical, 0 high, 2 medium, 1 low issues found. All fixed. Status → review.
- 2026-03-29: Code review #2 — 0 critical, 0 high, 0 medium, 0 low issues found. Clean pass. Status → review (complete).
- 2026-03-29: Code review #3 (security-focused) — 0 critical, 0 high, 0 medium, 0 low issues found. Semgrep scan clean. OWASP Top 10 manual review clean. Status → review (complete).

### File List
- `packages/rig/tests/e2e/seed/push-02-nested.ts` (created, then modified in review)
- `packages/rig/tests/e2e/seed/__tests__/push-02-nested.test.ts` (modified in review)
- `_bmad-output/implementation-artifacts/10-3-seed-nested-directory-structure.md` (modified — status, tasks, dev agent record, code review record)

## Code Review Record

### Review #1
**Reviewer:** Claude Opus 4.6 (1M context) — 2026-03-29

#### Findings Summary
- **Critical: 0**
- **High: 0**
- **Medium: 2** (both fixed)
- **Low: 1** (accepted — correct pattern per API constraints)

#### Medium Issues (Fixed)

**M-1: TypeScript compilation errors in implementation file (push-02-nested.ts:127)**
`push01State.commits[0].sha` triggers TS2532 ("Object is possibly undefined") due to `noUncheckedIndexedAccess: true` in tsconfig. Fixed with non-null assertion `commits[0]!.sha`.

**M-2: Redundant reused blobs in uploadOrder array (push-02-nested.ts:148-151)**
Three reused blobs (README.md, package.json, index.ts) were included in the uploadOrder array only to be immediately skipped by the manual delta check. Removed from uploadOrder — only 11 new objects now listed. Clarified comments.

#### Low Issues (Accepted)

**L-1: TypeScript compilation errors in test file (push-02-nested.test.ts:878-880)**
Same `noUncheckedIndexedAccess` pattern — array index access `commits[0].message` etc. Fixed with non-null assertions `commits[0]!.message`.

#### Verification
- All 24 unit tests pass (14 integration stubs remain as .todo)
- Full seed test suite: 9 files, 110 tests passed, 0 failures
- Zero TypeScript errors for push-02 files after fixes
- No regressions in push-01 or other seed tests

### Review #2
**Reviewer:** Claude Opus 4.6 (1M context) — 2026-03-29

#### Findings Summary
- **Critical: 0**
- **High: 0**
- **Medium: 0**
- **Low: 0**

No new issues found. Second-pass review focused on:

1. **Git tree binary format correctness**: Verified tree entry sort order matches real git for all entries used (README.md < docs < package.json < src). The `040000` mode prefix vs git's native `40000` is a pre-existing pattern from Story 10.1's `createGitTree` — SHAs are internally consistent within the TOON system.
2. **Balance proof signing flow**: Upload loop and `publishWithRetry` both call `signBalanceProof` which auto-accumulates internally — no double-accounting risk.
3. **shaMap mutation safety**: Push 1's shaMap is mutated in-place by `uploadGitObject`, consistent with documented pattern and Push 1's own approach.
4. **Delta logic completeness**: Upload order correctly contains only 11 new objects (4 blobs + 6 trees + 1 commit). Reused blob SHAs from Push 1 are excluded from upload loop (fixed in Review #1).
5. **Test coverage adequacy**: 24 unit tests cover all ACs. Integration stubs (.todo) cover infrastructure-dependent scenarios. Tests verify determinism, hierarchy, delta counts, refs tags, and state structure.
6. **Pre-existing dependency issues noted** (out of scope for Push 2): `publish.ts` has a TS error (`PublishEventResult` re-exported but not imported for local use); `vitest.seed.config.ts` missing resolve aliases from root config. Both are Story 10.1 artifacts, not Push 2 regressions.

#### Verification
- All 24 unit tests pass (14 integration stubs remain as .todo)
- Full seed test suite: 9 files, 110 tests passed, 0 failures
- Zero TypeScript errors for push-02 files
- No regressions in push-01 or other seed tests

### Review #3 (Security-Focused)
**Reviewer:** Claude Opus 4.6 (1M context) — 2026-03-29

#### Findings Summary
- **Critical: 0**
- **High: 0**
- **Medium: 0**
- **Low: 0**

No issues found. Third-pass review focused on security (OWASP Top 10, authentication/authorization, injection):

1. **Injection (OWASP A03:2021)**: No user input flows into git object construction — all content is hardcoded constants. `uploadGitObject` constructs kind:5094 events with base64-encoded data and static tags. No SQL, command injection, XSS, or template injection vectors.
2. **Broken Authentication (OWASP A07:2021)**: `aliceSecretKey` (Uint8Array) is passed as parameter, never logged/hardcoded/exposed. Used correctly for `finalizeEvent` signing and `signBalanceProof` cryptographic operations.
3. **Sensitive Data Exposure (OWASP A02:2021)**: No secrets hardcoded in implementation or tests. `AGENT_IDENTITIES` imported from test harness (expected for E2E infrastructure).
4. **Insecure Deserialization (OWASP A08:2021)**: `result.data` from `publishEvent` undergoes simple base64-to-string decode for txId — no complex deserialization.
5. **Security Misconfiguration (OWASP A05:2021)**: DVM event timestamps use `Date.now()` (non-deterministic, acceptable). Commit timestamps are fixed (deterministic, correct).
6. **Broken Access Control (OWASP A01:2021)**: Balance proof signing gates all uploads/publishes via `channelId` from tracked channels. Fail-fast on missing channel (line 139).
7. **SHA-1 in git-builder.ts**: Used for git content addressing (inherent to git format), not for security purposes — acceptable.
8. **Semgrep automated scan**: Zero findings across all 6 scanned files (push-02-nested.ts, push-02-nested.test.ts, git-builder.ts, publish.ts, event-builders.ts, constants.ts).

#### Verification
- All 24 unit tests pass (14 integration stubs remain as .todo)
- Full seed test suite: 9 files, 110 tests passed, 0 failures
- Zero TypeScript errors for push-02 files
- Semgrep scan: 0 findings, 0 errors
- No regressions in push-01 or other seed tests
