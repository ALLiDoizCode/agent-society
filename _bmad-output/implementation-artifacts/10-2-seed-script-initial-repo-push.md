# Story 10.2: Seed Script — Initial Repo Push (Push 1)

Status: done

## Story

As a **TOON developer**,
I want **a seed script that creates the first git push for a test repository — uploading initial blobs, trees, and a commit to Arweave via kind:5094 DVM, and publishing kind:30617 repo announcement and kind:30618 refs events**,
so that **subsequent seed scripts can build on this initial commit (parent chain), and Playwright specs can verify repo listing, file tree rendering, and README display against real seeded data**.

## Acceptance Criteria

1. **AC-2.1 — Git Object Creation:** `packages/rig/tests/e2e/seed/push-01-init.ts` creates git objects for: `README.md`, `package.json`, `src/index.ts` — 3 blobs, 2 trees (root tree containing `README.md`, `package.json`, and `src/` directory entry; `src/` subtree containing `index.ts`), and 1 commit referencing the root tree.

2. **AC-2.2 — Arweave DVM Upload:** Each of the 6 git objects is uploaded to Arweave via kind:5094 DVM through Peer1 using `uploadGitObject()` from the seed lib. All `{ sha, txId }` pairs are captured in the `ShaToTxIdMap`. Upload order: blobs first, then trees (leaf-to-root), then commit.

3. **AC-2.3 — Repo Announcement (kind:30617):** A kind:30617 repo announcement event is published with:
   - `d` tag containing the repo ID (e.g., `"rig-e2e-test-repo"`)
   - `name` tag with a human-readable repo name
   - `description` tag with a short description
   Built via `buildRepoAnnouncement(REPO_ID, name, description)` which produces `d`, `name`, `description` tags. Note: the `HEAD` reference is part of kind:30618 refs (AC-2.4), NOT the repo announcement.
   Published via `publishWithRetry()` through Alice's ToonClient.

4. **AC-2.4 — Refs/State (kind:30618):** A kind:30618 refs event is published with:
   - `d` tag matching the repo ID from kind:30617
   - `r` tag: `["r", "refs/heads/main", "<commit-sha>"]`
   - `HEAD` tag: `["HEAD", "ref: refs/heads/main"]`
   - `arweave` tags mapping every git SHA to its Arweave txId (all 6 objects)
   Published via `publishWithRetry()` through Alice's ToonClient.

5. **AC-2.5 — State Return:** The `runPush01()` function returns a `Push01State` object containing: `repoId`, `ownerPubkey`, `commits` array with `{ sha, txId, message }`, `shaMap` with all SHA-to-txId mappings, `repoAnnouncementId` + `refsEventId` for published Nostr event IDs, `branches`, and `files`. The function does NOT write `state.json` directly -- it returns structured data for the orchestrator (Story 10.9) to accumulate and persist.

6. **AC-2.6 — Alice's Client:** All events are published via Alice's ToonClient with valid ILP claims (using `publishWithRetry()` which handles claim signing internally).

## Tasks / Subtasks

- [x] Task 1: Create `push-01-init.ts` file structure (AC: #all)
  - [x] 1.1: Create `packages/rig/tests/e2e/seed/push-01-init.ts`
  - [x] 1.2: Import seed lib utilities from `./lib/index.js` (clients, git-builder, event-builders, publish, constants)
  - [x] 1.3: Define file content constants (`README_CONTENT`, `PACKAGE_JSON_CONTENT`, `INDEX_TS_CONTENT`)
  - [x] 1.4: Define `REPO_ID` constant (e.g., `"rig-e2e-test-repo"`)

- [x] Task 2: Implement git object creation (AC: #1)
  - [x] 2.1: Create 3 blobs using `createGitBlob()`: README.md, package.json, src/index.ts
  - [x] 2.2: Create `src/` subtree using `createGitTree()` with entry `{ mode: '100644', name: 'index.ts', sha: indexBlob.sha }`
  - [x] 2.3: Create root tree using `createGitTree()` with entries: `{ mode: '100644', name: 'README.md', sha: readmeBlob.sha }`, `{ mode: '100644', name: 'package.json', sha: pkgBlob.sha }`, `{ mode: '040000', name: 'src', sha: srcTree.sha }`
  - [x] 2.4: Create commit using `createGitCommit({ treeSha: rootTree.sha, authorName: 'Alice', authorPubkey: AGENT_IDENTITIES.alice.pubkey, message: 'Initial commit', timestamp: 1700000000 })` — no parent. Use a fixed timestamp (e.g., `1700000000`) for deterministic SHA computation.

- [x] Task 3: Upload git objects to Arweave (AC: #2)
  - [x] 3.1: Derive `aliceSecretKey` as `Uint8Array.from(Buffer.from(AGENT_IDENTITIES.alice.secretKeyHex, 'hex'))` and obtain `channelId` from `aliceClient.getTrackedChannels()[0]`
  - [x] 3.2: For each object upload, sign a claim BEFORE calling `uploadGitObject()`: compute cumulative amount (each object adds `BigInt(obj.body.length) * 10n`), then `await aliceClient.signBalanceProof(channelId, amount)`. Claims must be monotonically increasing (cumulative).
  - [x] 3.3: Upload blobs first: README.md blob, package.json blob, index.ts blob — each via `uploadGitObject(aliceClient, obj.body, obj.sha, 'blob', REPO_ID, shaMap, claim, aliceSecretKey)` where `aliceClient` is the ToonClient instance
  - [x] 3.4: Upload trees: src/ subtree first, then root tree — via `uploadGitObject(...)` with type `'tree'`
  - [x] 3.5: Upload commit — via `uploadGitObject(...)` with type `'commit'`
  - [x] 3.6: Verify all 6 uploads returned valid txIds (throw if any txId is undefined)

- [x] Task 4: Publish Nostr events (AC: #3, #4, #6)
  - [x] 4.1: Build kind:30617 via `buildRepoAnnouncement(REPO_ID, repoName, description)`, sign with `finalizeEvent(unsignedEvent, aliceSecretKey)`, publish via `publishWithRetry(aliceClient, signedEvent)` — `aliceClient` is the ToonClient instance
  - [x] 4.2: Build kind:30618 via `buildRepoRefs(REPO_ID, { 'refs/heads/main': commitSha }, shaMap)`, sign with `finalizeEvent(unsignedEvent, aliceSecretKey)`, publish via `publishWithRetry(aliceClient, signedEvent)`
  - [x] 4.3: Capture event IDs from publish results for state persistence

- [x] Task 5: State persistence (AC: #5)
  - [x] 5.1: Define `Push01State` interface containing: `repoId`, `ownerPubkey`, `commits: { sha, txId, message }[]`, `shaMap: ShaToTxIdMap`, `repoAnnouncementId`, `refsEventId`, `branches: string[]`, `files: string[]`
  - [x] 5.2: Export a main `runPush01(aliceClient: ToonClient, aliceSecretKey: Uint8Array, shaMap: ShaToTxIdMap)` function that takes Alice's ToonClient instance, her secret key for event signing, and an initial (empty or pre-populated) shaMap, runs all tasks, and returns `Promise<Push01State>`
  - [x] 5.3: The function does NOT write state.json directly — it returns state for the orchestrator (Story 10.9) to accumulate and persist

- [x] Task 6: Write ATDD tests (AC: #all)
  - [x] 6.1: Create `packages/rig/tests/e2e/seed/__tests__/push-01-init.test.ts` (created in Story 10.1, validated here)
  - [x] 6.2: Test: `runPush01` module exports a function
  - [x] 6.3: Test: File content constants are defined and non-empty
  - [x] 6.4: Test: Git objects are created correctly (blob SHAs are deterministic for known content; tree and commit SHAs depend on blob SHAs)
  - [x] 6.5: Test: `REPO_ID` constant is a valid non-empty string
  - [x] 6.6: Tests that require infrastructure (Arweave DVM, ToonClient) should be skipped with `.todo()` or guarded by an env check — they will be validated during integration via the orchestrator (Story 10.9)

## Prerequisites

- **Story 10.1 complete:** All seed lib modules (`clients.ts`, `git-builder.ts`, `event-builders.ts`, `publish.ts`, `constants.ts`) must be available.
- **SDK E2E infrastructure running:** `./scripts/sdk-e2e-infra.sh up` for integration verification (not required for unit tests).

## Dev Notes

### Architecture

This is the first of 8 seed scripts (Push 1 through Push 8) that incrementally build a test repository. Each push script:
1. Receives the accumulated `ShaToTxIdMap` from prior pushes (empty for Push 1)
2. Creates new git objects (only delta — objects already in shaMap are skipped)
3. Uploads new objects to Arweave via kind:5094 DVM
4. Publishes Nostr events (repo announcement, refs, issues, PRs, etc.)
5. Returns structured state for the orchestrator to accumulate

Push 1 is special because it also creates the kind:30617 repo announcement, which is a one-time event. Subsequent pushes only update kind:30618 refs.

### File Contents (Minimal — Stays Under 100KB Free Tier)

Use minimal but realistic file contents:

```typescript
const README_CONTENT = `# rig-e2e-test-repo

A test repository for Rig E2E integration tests.
Seeded by the TOON Protocol test infrastructure.
`;

const PACKAGE_JSON_CONTENT = `{
  "name": "rig-e2e-test-repo",
  "version": "1.0.0",
  "description": "Test repository for Rig E2E",
  "main": "src/index.ts"
}
`;

const INDEX_TS_CONTENT = `export function hello(): string {
  return 'Hello from rig-e2e-test-repo';
}
`;
```

Total content size: ~300 bytes across 3 blobs. Well under the 95KB limit per object and well under the 100KB Arweave free tier.

### Git Object Upload Order

Objects must be uploaded bottom-up (leaves first):
1. Blobs (README.md, package.json, src/index.ts)
2. Subtree (src/)
3. Root tree
4. Commit

This order doesn't strictly matter for Arweave (it's content-addressed), but it's conventional and ensures SHA dependencies are satisfied before parent objects reference them.

### Deterministic Timestamps

Use a fixed timestamp (`1700000000`, i.e. 2023-11-14T22:13:20Z) for `createGitCommit()` so that commit SHAs are deterministic and reproducible across test runs. This enables ATDD tests (Task 6.4) to verify exact SHA values.

### Claim Signing for DVM Uploads

The `uploadGitObject()` function in `git-builder.ts` requires a `claim: SignedBalanceProof` parameter. For each upload, the caller must:
1. Get the channel ID from `aliceClient.getTrackedChannels()[0]`
2. Track a cumulative amount — each upload adds `BigInt(objectBody.length) * 10n`
3. Sign a balance proof: `await aliceClient.signBalanceProof(channelId, cumulativeAmount)`

Claims must be monotonically increasing (cumulative amount). Sign a new claim before each `uploadGitObject()` call with the running total.

For the Nostr event publishes (kind:30617, kind:30618), use `publishWithRetry()` which handles claim signing internally via `ToonClient.signBalanceProof()`.

### Event Signing Pattern

```typescript
import { finalizeEvent } from 'nostr-tools/pure';

const unsignedEvent = buildRepoAnnouncement(REPO_ID, name, description);
const signedEvent = finalizeEvent(unsignedEvent, aliceSecretKey);
const result = await publishWithRetry(aliceClient, signedEvent);
```

The `finalizeEvent()` function from `nostr-tools/pure` adds `id`, `pubkey`, and `sig` fields to the unsigned event.

### State Return Structure

```typescript
interface Push01State {
  repoId: string;
  ownerPubkey: string;   // Alice's pubkey (hex)
  commits: { sha: string; txId: string; message: string }[];
  shaMap: ShaToTxIdMap;  // All 6 SHA-to-txId mappings
  repoAnnouncementId: string;  // Nostr event ID
  refsEventId: string;         // Nostr event ID
  branches: string[];          // ['main']
  files: string[];             // ['README.md', 'package.json', 'src/index.ts']
}
```

The orchestrator (Story 10.9) will accumulate state from all push scripts and write the final `state.json`.

### Key Imports

```typescript
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { ToonClient, SignedBalanceProof } from '@toon-protocol/client';
import {
  createGitBlob,
  createGitTree,
  createGitCommit,
  uploadGitObject,
  type ShaToTxIdMap,
  buildRepoAnnouncement,
  buildRepoRefs,
  publishWithRetry,
  AGENT_IDENTITIES,
} from './lib/index.js';
```

### Deriving Alice's Secret Key

The `aliceSecretKey` (Uint8Array) required by `finalizeEvent()` and `uploadGitObject()` must be derived from the hex string in `AGENT_IDENTITIES`:

```typescript
const aliceSecretKey = Uint8Array.from(
  Buffer.from(AGENT_IDENTITIES.alice.secretKeyHex, 'hex')
);
```

This is the same pattern used in `clients.ts` line 71.

### Existing Code References

| What | Where | Usage |
|------|-------|-------|
| Git object construction pattern | `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` | Reference implementation — seed lib already ports these |
| Seed lib (all utilities) | `packages/rig/tests/e2e/seed/lib/index.ts` | Import everything from here |
| Agent identities (Alice keypairs) | `packages/client/tests/e2e/socialverse-agent-harness.ts` via `constants.ts` | `AGENT_IDENTITIES.alice.secretKeyHex`, `.pubkey`, `.evmKey` |
| Upload pattern with kind:5094 | `packages/rig/tests/e2e/seed/lib/git-builder.ts` | `uploadGitObject()` handles all DVM event construction |

### Flakiness Prevention (from Test Design)

- **R10-001 (Arweave indexing lag):** After all uploads complete, optionally call `waitForArweaveIndex(txId)` for the commit txId to confirm it's indexed before returning. This prevents downstream push scripts from failing when they try to resolve parent commit SHAs.
- **R10-003 (Cascading failure):** If any upload returns `undefined` txId, throw immediately with a descriptive error including the object SHA and type. Do not continue with partial state.
- **R10-005 (Size limits):** File contents are deliberately minimal (~300 bytes total). `uploadGitObject()` already validates < 95KB.

### Test File Structure

```
packages/rig/tests/e2e/
  seed/
    push-01-init.ts              # <-- THIS STORY
    lib/                         # From Story 10.1
      index.ts
      clients.ts
      constants.ts
      event-builders.ts
      git-builder.ts
      publish.ts
    __tests__/
      push-01-init.test.ts       # <-- ATDD tests for this story
```

### Project Structure Notes

- New file `packages/rig/tests/e2e/seed/push-01-init.ts` follows the established seed script directory pattern from Story 10.1
- New test file `packages/rig/tests/e2e/seed/__tests__/push-01-init.test.ts` follows the `__tests__/` colocated test pattern
- All imports from `./lib/index.js` — never import individual seed lib modules directly
- No new packages or dependencies required — all utilities already exist in the seed lib

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` - Story 10.2 AC details]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` - Phase 2 verification approach, R10-001/003/005 mitigations]
- [Source: `_bmad-output/implementation-artifacts/10-1-test-infra-and-shared-seed-library.md` - Seed lib implementation details, API signatures]
- [Source: `packages/rig/tests/e2e/seed/lib/git-builder.ts` - uploadGitObject(), createGitBlob/Tree/Commit signatures]
- [Source: `packages/rig/tests/e2e/seed/lib/event-builders.ts` - buildRepoAnnouncement(), buildRepoRefs() signatures]
- [Source: `packages/rig/tests/e2e/seed/lib/publish.ts` - publishWithRetry() signature]
- [Source: `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` - Reference git push implementation]

## Handoff

STORY_FILE: _bmad-output/implementation-artifacts/10-2-seed-script-initial-repo-push.md

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None — no debug issues encountered.

### Completion Notes List
- Task 1: Created `push-01-init.ts` with file content constants (README_CONTENT, PACKAGE_JSON_CONTENT, INDEX_TS_CONTENT), REPO_ID constant, and all seed lib imports from `./lib/index.js`.
- Task 2: Implemented git object creation — 3 blobs, src/ subtree, root tree, and initial commit with fixed timestamp 1700000000 for deterministic SHAs. No parent commit (first push).
- Task 3: Implemented Arweave upload loop with monotonically increasing cumulative claims. Upload order: blobs first, trees leaf-to-root, then commit. Immediate throw on undefined txId (R10-003).
- Task 4: Published kind:30617 repo announcement and kind:30618 refs/state via `publishWithRetry()` with `finalizeEvent()` signing. Error handling throws on failed publishes.
- Task 5: Defined `Push01State` interface and `runPush01()` function returning structured state. Function does NOT write state.json — returns data for orchestrator (Story 10.9).
- Task 6: Pre-existing ATDD test file from Story 10.1 validated — all 18 unit tests pass, 14 integration tests correctly marked as `.todo()`.

### Change Log
- 2026-03-29: Story 10.2 implementation complete. Created push-01-init.ts seed script. All 18 ATDD unit tests pass, 14 integration tests deferred to Story 10.9 orchestrator. Full seed test suite (8 files, 86 tests) green.

### File List
- `packages/rig/tests/e2e/seed/push-01-init.ts` (created)
- `_bmad-output/implementation-artifacts/10-2-seed-script-initial-repo-push.md` (modified)

## Code Review Record

### Review Pass #1
- **Date:** 2026-03-29
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Issue Counts:** 0 critical, 1 high, 0 medium, 0 low
- **High Issues:**
  1. Cumulative vs delta amount in `signBalanceProof` calls — fixed to pass delta amounts
- **Outcome:** All issues fixed, review passed

### Review Pass #2
- **Date:** 2026-03-29
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Issue Counts:** 0 critical, 0 high, 0 medium, 3 low
- **Low Issues:**
  1. Incorrect test counts in Completion Notes and Change Log — story claimed "12 unit tests, 13 integration tests" but actual counts are 18 unit tests passing + 14 integration `.todo()` tests (32 total). Fixed documentation.
  2. Test file imports seed lib modules directly (`../lib/git-builder.js`, `../lib/constants.js`, `../lib/event-builders.js`) instead of through barrel export (`../lib/index.js`). Acceptable for test files since barrel re-exports are validated separately in `barrel-exports.test.ts`. No code change needed.
  3. Story "Key Imports" section lists `getPublicKey` and `SignedBalanceProof` imports that are unused/unneeded in the actual implementation. Documentation-only mismatch, no code change needed.
- **Verification:**
  - All 86 seed tests pass (18 unit + 14 todo for push-01-init; 54 from other seed test files)
  - Review Pass #1 fix (delta vs cumulative `signBalanceProof`) confirmed correct against `ChannelManager.signBalanceProof(channelId, additionalAmount)` API
  - TypeScript compilation clean (no errors in seed files)
  - All 6 ACs verified implemented in code
  - All tasks marked `[x]` confirmed done
- **Outcome:** All low issues addressed (1 fixed, 2 accepted). Story approved, status set to done.

### Review Pass #3
- **Date:** 2026-03-29
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Focus:** Security (OWASP Top 10), authentication/authorization, injection risks, edge cases, anything prior reviews missed
- **Issue Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Security Analysis:**
  - Semgrep scan (213 rules including OWASP rules) on all 5 source files: 0 findings
  - OWASP A01 (Broken Access Control): No hardcoded secrets; keys passed as parameters from test harness
  - OWASP A02 (Cryptographic Failures): SHA-1 used correctly per git spec (content addressing, not security); Schnorr signing via nostr-tools
  - OWASP A03 (Injection): All inputs are hardcoded constants; base64 encoding in DVM events prevents injection
  - OWASP A04 (Insecure Design): Channel balance consumption on partial failure acceptable for test scripts (Anvil funds are free)
  - OWASP A07 (Identity & Auth): Standard nostr-tools finalizeEvent() signing pattern; no bypass vectors
  - OWASP A08 (Integrity): Git SHA-1 checksums verify content integrity; in-place shaMap mutation is documented and intentional
- **Edge Case Review:**
  - Empty getTrackedChannels(): guarded with descriptive error (line 117-119)
  - Undefined txId from upload: immediate throw with SHA and type (line 152-156)
  - Failed publishWithRetry: checked and thrown (lines 172-176, 187-190)
  - Missing commit SHA in shaMap post-upload: guarded (lines 198-200)
  - Undefined eventId from publish result: fallback to signed event ID (line 213)
- **Verification:**
  - All 343 rig tests pass (18 unit + 14 todo for push-01-init, rest from other test files)
  - TypeScript compilation clean for push-01-init.ts and push-01-init.test.ts (0 errors)
  - Review Pass #1 fix (delta signBalanceProof) re-verified against ChannelManager source: `additionalAmount` parameter auto-accumulates internally
  - All 6 ACs confirmed implemented
- **Outcome:** No issues found. Third and final review pass complete. Story confirmed done.
