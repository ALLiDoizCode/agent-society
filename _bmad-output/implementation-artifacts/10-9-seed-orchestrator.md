# Story 10.9: Seed Orchestrator

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **TOON developer**,
I want a seed orchestrator (`seed-all.ts`) that runs all 8 push scripts in sequence, checks infrastructure health, manages freshness, and exports typed state for Playwright specs,
so that Playwright `globalSetup` can seed all test data in a single deterministic pass and specs can consume a validated `state.json`.

## Acceptance Criteria

1. **AC-9.1:** `seed/seed-all.ts` checks services ready via `checkAllServicesReady()` -- polls Peer1 BLS (`localhost:19100/health`), Peer2 BLS (`localhost:19110/health`), and Anvil (`localhost:18545`) with 30s timeout before starting seeds.
2. **AC-9.2:** Runs push-01 through push-08 in sequence, each receiving the accumulated state from the prior push. State flows: Push01State -> Push02State -> ... -> Push08State.
3. **AC-9.3:** Exports final state to `seed/state.json` containing: repoId, ownerPubkey, repoAnnouncementId, refsEventId, commits (sha+txId+message), shaMap, branches, tags, files, prs (eventId+title+authorPubkey+statusKind), issues (eventId+title+authorPubkey+labels), comments (eventId+issueEventId+authorPubkey+body), closedIssueEventIds, and a `generatedAt` ISO timestamp.
4. **AC-9.4:** Configured as Playwright `globalSetup` -- exports a default async function matching Playwright's `globalSetup` contract signature.
5. **AC-9.5:** Skips seeding if `state.json` exists and is fresh (< 10 min since `generatedAt` timestamp) to speed up re-runs. Deletes stale file and re-seeds from scratch.
6. **AC-9.6:** Total seed time < 60 seconds (excluding Arweave indexing wait).

## Tasks / Subtasks

- [x] Task 0: Add `PEER2_BLS_URL` to seed lib barrel (AC: 9.1)
  - [x] 0.1: Add `PEER2_BLS_URL` to the re-export list in `seed/lib/constants.ts` (from `docker-e2e-setup.ts` where it is already defined as `'http://localhost:19110'`)
  - [x] 0.2: Add `PEER2_BLS_URL` to the barrel re-export in `seed/lib/index.ts`

- [x] Task 1: Implement `checkAllServicesReady()` function (AC: 9.1)
  - [x] 1.1: Poll Peer1 BLS using `PEER1_BLS_URL` from barrel (`${PEER1_BLS_URL}/health`) with 30s timeout, 1s interval
  - [x] 1.2: Poll Peer2 BLS using `PEER2_BLS_URL` from barrel (`${PEER2_BLS_URL}/health`) with 30s timeout, 1s interval
  - [x] 1.3: Poll Anvil using `ANVIL_RPC` from barrel -- POST `{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}` with 30s timeout
  - [x] 1.4: Run all three polls with `Promise.all` for faster startup; throw descriptive error identifying which service(s) failed, e.g. `'Services not ready: Peer2 BLS (http://localhost:19110/health), Anvil (http://localhost:18545)'`
  - [x] 1.5: Reuse the polling pattern from `healthCheck()` in `clients.ts` (retry loop with 1s interval, AbortSignal.timeout(2000))

- [x] Task 2: Implement `SeedState` interface and `loadSeedState()`/`saveSeedState()` helpers (AC: 9.3, 9.5)
  - [x] 2.1: Define `SeedState` interface matching Push08State plus `generatedAt: string` (ISO timestamp)
  - [x] 2.2: `saveSeedState(state: Push08State)` writes `state.json` with `generatedAt = new Date().toISOString()`
  - [x] 2.3: `loadSeedState()` reads `state.json`, parses JSON, returns typed `SeedState | null` (null if missing/unparseable)
  - [x] 2.4: `isFresh(state: SeedState, ttlMs: number)` returns true if `Date.now() - Date.parse(state.generatedAt) < ttlMs`

- [x] Task 3: Implement sequential push orchestration (AC: 9.2, 9.6)
  - [x] 3.1: Call `createSeedClients()` from barrel to get `{ alice, bob, carol }` ToonClient instances
  - [x] 3.2: Derive secret keys from `AGENT_IDENTITIES` -- note: carol identity maps to charlieKey/charlieClient parameter names in push scripts
  - [x] 3.3: Initialize empty `shaMap: ShaToTxIdMap = {}`
  - [x] 3.4: Record `startTime = Date.now()` before first push (for AC-9.6 timing report)
  - [x] 3.5: Run pushes sequentially: `runPush01(alice, aliceKey, shaMap)` -> `runPush02(alice, aliceKey, push01State)` -> `runPush03(alice, aliceKey, push02State)` -> `runPush04(alice, aliceKey, push03State)` -> `runPush05(alice, aliceKey, push04State)` -> `runPush06(alice, carol, aliceKey, carolKey, push05State)` -> `runPush07(alice, bob, carol, aliceKey, bobKey, carolKey, push06State)` -> `runPush08(alice, aliceKey, push07State)`
  - [x] 3.6: Log progress to console: `[seed] Push N/8 complete` after each push
  - [x] 3.7: On any push failure, log which push failed and exit immediately (fail-fast, R10-003)
  - [x] 3.8: After push 8, log `[seed] Total seed time: Ns` using `Math.round((Date.now() - startTime) / 1000)`

- [x] Task 4: Implement `globalSetup` default export (AC: 9.4, 9.5)
  - [x] 4.1: Export default async function `globalSetup(): Promise<void>`
  - [x] 4.2: Check freshness first -- if `state.json` exists and `isFresh(state, 10 * 60 * 1000)`, log `[seed] state.json is fresh, skipping seed` and return
  - [x] 4.3: If stale or missing, delete stale file if it exists, run `checkAllServicesReady()`, run orchestration, save state
  - [x] 4.4: Call `stopAllClients()` in a finally block to clean up ToonClient connections

- [x] Task 5: Write ATDD tests for seed-all (AC: 9.1-9.6)
  - [x] 5.1: Create `__tests__/seed-all.test.ts` with `describe('Story 10.9: Seed Orchestrator')`
  - [x] 5.2: Unit test: module exports `globalSetup` as default export (`typeof module.default === 'function'`)
  - [x] 5.3: Unit test: module exports `checkAllServicesReady` function
  - [x] 5.4: Unit test: source contains `interface SeedState` (source introspection via `fs.readFileSync` + string matching -- types are erased at runtime)
  - [x] 5.5: Unit test: module exports `loadSeedState` and `saveSeedState` functions
  - [x] 5.6: Unit test: module exports `isFresh` function
  - [x] 5.7: Unit test: `isFresh` returns true for timestamp < 10 min ago, false for > 10 min ago (pure function, no infra needed)
  - [x] 5.8: Unit test: source contains `generatedAt: string` in SeedState interface (source introspection)
  - [x] 5.9: Unit test: source contains all Push08State fields in SeedState interface (source introspection for repoId, ownerPubkey, commits, shaMap, repoAnnouncementId, refsEventId, branches, tags, files, prs, issues, comments, closedIssueEventIds)
  - [x] 5.10: Unit test: source imports from all 8 push scripts (source introspection for push-01 through push-08)
  - [x] 5.11: Unit test: source imports `createSeedClients` and `stopAllClients` from lib
  - [x] 5.12: Unit test: source imports `AGENT_IDENTITIES` from lib
  - [x] 5.13: Integration test stubs (`.todo`) for live orchestration, freshness skip, and stale re-seed

## Prerequisites

- **Stories 10.1-10.8 complete:** All 8 push scripts implemented and tested.
- **Seed lib from Story 10.1:** `createSeedClients`, `stopAllClients`, `healthCheck`, `AGENT_IDENTITIES`, `PEER1_BLS_URL`, `ANVIL_RPC` from barrel. Note: `PEER2_BLS_URL` is NOT currently in the barrel -- Task 0 adds it.
- **Playwright config from Story 10.1:** `globalSetup: './tests/e2e/seed/seed-all.ts'` already configured in `packages/rig/playwright.config.ts`.
- **SDK E2E infrastructure:** `./scripts/sdk-e2e-infra.sh up` for integration verification.

## Dev Notes

### Critical: Replace the Existing No-Op Stub

The current `seed-all.ts` is a no-op stub created in Story 10.1:

```typescript
export default async function globalSetup(): Promise<void> {
  // No-op stub -- seed orchestration implemented in Story 10.9
}
```

This file must be **completely rewritten** with the full orchestrator implementation. The `globalSetup` default export signature MUST be preserved (Playwright contract).

### Push Script Parameter Signatures

Each push script has a distinct signature. The orchestrator must call them correctly:

| Push | Function | Parameters (as declared in push script) | Orchestrator passes |
|------|----------|-----------|---------------------|
| 01 | `runPush01` | `(aliceClient, aliceSecretKey, shaMap)` | `(alice, aliceKey, shaMap)` |
| 02 | `runPush02` | `(aliceClient, aliceSecretKey, push01State)` | `(alice, aliceKey, push01State)` |
| 03 | `runPush03` | `(aliceClient, aliceSecretKey, push02State)` | `(alice, aliceKey, push02State)` |
| 04 | `runPush04` | `(aliceClient, aliceSecretKey, push03State)` | `(alice, aliceKey, push03State)` |
| 05 | `runPush05` | `(aliceClient, aliceSecretKey, push04State)` | `(alice, aliceKey, push04State)` |
| 06 | `runPush06` | `(aliceClient, charlieClient, aliceSecretKey, charlieSecretKey, push05State)` | `(alice, carol, aliceKey, carolKey, push05State)` |
| 07 | `runPush07` | `(aliceClient, bobClient, charlieClient, aliceSecretKey, bobSecretKey, charlieSecretKey, push06State)` | `(alice, bob, carol, aliceKey, bobKey, carolKey, push06State)` |
| 08 | `runPush08` | `(aliceClient, aliceSecretKey, push07State)` | `(alice, aliceKey, push07State)` |

Push 01 takes a raw `shaMap: ShaToTxIdMap` (initially `{}`), NOT a push state object.
Push 06 takes 2 clients (Alice + Carol) and 2 secret keys. Push script param is named `charlieClient` but receives the `carol` client.
Push 07 takes 3 clients (Alice + Bob + Carol) and 3 secret keys. Push script params are named `charlieClient`/`charlieSecretKey` but receive `carol`/`carolKey`.
All other pushes take 1 client (Alice) and 1 secret key.

### Secret Key Derivation Pattern

From `clients.ts` line 71:

```typescript
const secretKey = Uint8Array.from(Buffer.from(identity.secretKeyHex, 'hex'));
```

The orchestrator needs secret keys for all three agents:

```typescript
const aliceKey = Uint8Array.from(Buffer.from(AGENT_IDENTITIES.alice.secretKeyHex, 'hex'));
const bobKey = Uint8Array.from(Buffer.from(AGENT_IDENTITIES.bob.secretKeyHex, 'hex'));
const carolKey = Uint8Array.from(Buffer.from(AGENT_IDENTITIES.carol.secretKeyHex, 'hex'));
```

**CRITICAL:** The identity is `AGENT_IDENTITIES.carol` and the client from `createSeedClients()` is `carol`. Push script parameter names use `charlieClient`/`charlieSecretKey` but they receive the `carol` client and `carolKey`. Use `carol` naming in the orchestrator for consistency with the seed lib, passing `carol`/`carolKey` to push-06 and push-07.

### Health Check Pattern

The `healthCheck()` from `clients.ts` only checks Peer1 BLS. The orchestrator needs `checkAllServicesReady()` which checks all three services using constants from the barrel:

- **Peer1 BLS:** `${PEER1_BLS_URL}/health` -- HTTP GET, expect 200
- **Peer2 BLS:** `${PEER2_BLS_URL}/health` -- HTTP GET, expect 200 (Task 0 adds `PEER2_BLS_URL` to barrel)
- **Anvil:** `ANVIL_RPC` -- POST with `{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}`, expect JSON-RPC response

Reuse the polling pattern from `healthCheck()` in `clients.ts` (line 40): retry loop with 1s interval, `AbortSignal.timeout(2000)` per request, up to 30s total timeout. Run all three polls concurrently via `Promise.all` for faster startup.

**IMPORTANT:** Never hardcode URLs. Use `PEER1_BLS_URL`, `PEER2_BLS_URL`, and `ANVIL_RPC` from the barrel. The `PEER2_BLS_URL` constant (`'http://localhost:19110'`) already exists in `docker-e2e-setup.ts` but is not currently re-exported by `seed/lib/constants.ts` -- Task 0 fixes this gap.

### state.json Location and Schema

The `state.json` file lives at `packages/rig/tests/e2e/seed/state.json`. It is gitignored.

The file path should be derived relative to the module using `import.meta.dirname` or `import.meta.url`:

```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');
```

### SeedState Interface

```typescript
export interface SeedState {
  generatedAt: string;  // ISO timestamp, e.g. "2026-03-30T12:00:00.000Z"
  repoId: string;
  ownerPubkey: string;
  commits: { sha: string; txId: string; message: string }[];
  shaMap: Record<string, string>;  // ShaToTxIdMap is Record<string, string>
  repoAnnouncementId: string;
  refsEventId: string;
  branches: string[];
  tags: string[];
  files: string[];
  prs: {
    eventId: string;
    title: string;
    authorPubkey: string;
    statusKind: 1630 | 1631 | 1632 | 1633;
  }[];
  issues: {
    eventId: string;
    title: string;
    authorPubkey: string;
    labels: string[];
  }[];
  comments: {
    eventId: string;
    issueEventId: string;
    authorPubkey: string;
    body: string;
  }[];
  closedIssueEventIds: string[];
}
```

This matches `Push08State` plus `generatedAt`. The `SeedState` should be the canonical type imported by Playwright specs via `loadSeedState()`.

### Freshness TTL

Default TTL is 10 minutes (600000 ms). The freshness check:

```typescript
function isFresh(state: SeedState, ttlMs = 10 * 60 * 1000): boolean {
  return Date.now() - Date.parse(state.generatedAt) < ttlMs;
}
```

### Fail-Fast on Push Failure (R10-003)

If any push throws, the orchestrator must:
1. Log which push number failed and the error message
2. Call `stopAllClients()` to clean up
3. NOT write `state.json` (or write partial state with only completed pushes -- per R10-003 mitigation, partial state is acceptable but orchestrator should exit non-zero)
4. Re-throw the error so Playwright `globalSetup` reports the failure

### Console Logging Pattern

Use `console.log` with `[seed]` prefix for progress:

```
[seed] state.json is fresh (< 10 min), skipping seed     <-- freshness skip path
```

```
[seed] Checking service readiness...                      <-- full seed path
[seed] All services ready
[seed] Push 1/8 complete (initial repo)
[seed] Push 2/8 complete (nested dirs)
...
[seed] Push 8/8 complete (close issue)
[seed] State saved to state.json (generatedAt: 2026-03-30T12:00:00.000Z)
[seed] Total seed time: 42s
```

### Import Structure

```typescript
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createSeedClients,
  stopAllClients,
  AGENT_IDENTITIES,
  PEER1_BLS_URL,
  PEER2_BLS_URL,   // Added by Task 0
  ANVIL_RPC,
  type ShaToTxIdMap,
} from './lib/index.js';
import { runPush01 } from './push-01-init.js';
import { runPush02 } from './push-02-nested.js';
import { runPush03 } from './push-03-branch.js';
import { runPush04 } from './push-04-branch-work.js';
import { runPush05 } from './push-05-tag.js';
import { runPush06 } from './push-06-prs.js';
import { runPush07 } from './push-07-issues.js';
import { runPush08 } from './push-08-close.js';
```

All imports use `.js` extension (ESM convention per project rules).

### Test Pattern -- Follow push-08-close.test.ts

Tests MUST follow the established pattern from Stories 10.1-10.8:
- `describe('Story 10.9: Seed Orchestrator')` as the outer describe
- Unit tests use `[P0]` or `[P1]` priority tags
- Import via `await import('../seed-all.js')`
- Infrastructure-dependent tests use `it.todo('[integration] ...')`
- Source-introspection tests (`fs.readFileSync` + string matching) verify imports and interface fields
- Use `import.meta.dirname` for resolving source file paths

**Key differences from push script tests:**
- This module has a **default export** (`globalSetup`), so test: `expect(typeof module.default).toBe('function')`
- This module has **named exports** (`checkAllServicesReady`, `loadSeedState`, `saveSeedState`, `isFresh`, `SeedState` type)
- `isFresh` is a pure function that can be tested directly with mock timestamps (no infrastructure needed)

### Seed Lib Barrel Change (Task 0)

Almost everything needed is already exported from the barrel (`lib/index.ts`):
- `createSeedClients`, `stopAllClients` from `clients.ts`
- `AGENT_IDENTITIES`, `PEER1_BLS_URL`, `ANVIL_RPC` from `constants.ts`
- `ShaToTxIdMap` type from `git-builder.ts`

**One addition needed:** `PEER2_BLS_URL` must be added to `constants.ts` (re-export from `docker-e2e-setup.ts` where it already exists as `'http://localhost:19110'`) and to the `index.ts` barrel. This is Task 0.

### Project Structure Notes

- File locations:
  - `packages/rig/tests/e2e/seed/lib/constants.ts` -- **modify** (add `PEER2_BLS_URL` re-export, Task 0)
  - `packages/rig/tests/e2e/seed/lib/index.ts` -- **modify** (add `PEER2_BLS_URL` to barrel, Task 0)
  - `packages/rig/tests/e2e/seed/seed-all.ts` -- **rewrite** (replace no-op stub)
  - `packages/rig/tests/e2e/seed/__tests__/seed-all.test.ts` -- **create** (ATDD test file)
  - `packages/rig/tests/e2e/seed/state.json` -- **generated at runtime** (already gitignored in `packages/rig/.gitignore`)
- Naming follows exact pattern: `seed-all.ts` (already exists as stub)
- All imports use `.js` extension (ESM convention per project rules)
- No new dependencies needed -- reuses existing seed library from Story 10.1

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` -- Story 10.9 acceptance criteria]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` -- Phase 3 orchestrator verification, freshness check, service readiness, R10-003/R10-004 mitigations]
- [Source: `_bmad-output/implementation-artifacts/10-8-seed-merge-pr-close-issue.md` -- Direct predecessor story, Push08State interface]
- [Source: `packages/rig/tests/e2e/seed/seed-all.ts` -- Current no-op stub to replace]
- [Source: `packages/rig/tests/e2e/seed/lib/clients.ts` -- createSeedClients, stopAllClients, healthCheck patterns (line 40), SeedClients interface, secret key derivation (line 71)]
- [Source: `packages/rig/tests/e2e/seed/lib/constants.ts` -- AGENT_IDENTITIES re-export, PEER1_BLS_URL; needs PEER2_BLS_URL addition (Task 0)]
- [Source: `packages/rig/tests/e2e/seed/lib/index.ts` -- Barrel exports; needs PEER2_BLS_URL addition (Task 0)]
- [Source: `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` -- PEER2_BLS_URL definition (line 35), waitForServiceHealth pattern]
- [Source: `packages/rig/tests/e2e/seed/push-01-init.ts` -- runPush01 signature (takes shaMap, not state)]
- [Source: `packages/rig/tests/e2e/seed/push-06-prs.ts` -- runPush06 signature (2 clients, 2 keys)]
- [Source: `packages/rig/tests/e2e/seed/push-07-issues.ts` -- runPush07 signature (3 clients, 3 keys)]
- [Source: `packages/rig/tests/e2e/seed/push-08-close.ts` -- runPush08 signature, Push08State interface]
- [Source: `packages/rig/playwright.config.ts` -- globalSetup already points to seed-all.ts]
- [Source: `packages/rig/.gitignore` -- state.json already gitignored (line 2)]
- [Source: `packages/rig/tests/e2e/seed/__tests__/push-08-close.test.ts` -- Test pattern to follow]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- all tasks completed without errors.

### Completion Notes List

- **Task 0:** Added `PEER2_BLS_URL` re-export to `seed/lib/constants.ts` (from `docker-e2e-setup.ts`) and to the barrel `seed/lib/index.ts`.
- **Task 1:** Implemented `checkAllServicesReady()` with concurrent `Promise.all` polling of Peer1 BLS, Peer2 BLS, and Anvil (JSON-RPC `eth_blockNumber`). Uses 30s timeout, 1s retry interval, `AbortSignal.timeout(2000)` per request. Descriptive error lists which services failed.
- **Task 2:** Defined `SeedState` interface (Push08State + `generatedAt: string`). Implemented `saveSeedState()` (writes state.json with ISO timestamp), `loadSeedState()` (reads/parses, returns null on failure), and `isFresh()` (default 10-min TTL).
- **Task 3:** Implemented sequential push orchestration calling runPush01 through runPush08 with correct parameter signatures. Derives alice/bob/carol secret keys from `AGENT_IDENTITIES`. Logs `[seed] Push N/8 complete (description)` progress and total elapsed time.
- **Task 4:** Implemented `globalSetup` default export matching Playwright contract. Checks freshness first (skip if < 10 min), deletes stale file, runs health checks, orchestrates pushes, saves state, and calls `stopAllClients()` in finally block. Fail-fast on push errors with re-throw.
- **Task 5:** Pre-existing test file `seed-all.test.ts` already contained comprehensive ATDD tests (23 unit tests + 6 integration stubs). All 23 unit tests pass against the implementation.

### File List

- `packages/rig/tests/e2e/seed/lib/constants.ts` -- modified (added PEER2_BLS_URL re-export)
- `packages/rig/tests/e2e/seed/lib/index.ts` -- modified (added PEER2_BLS_URL to barrel)
- `packages/rig/tests/e2e/seed/seed-all.ts` -- rewritten (replaced no-op stub with full orchestrator)
- `packages/rig/tests/e2e/seed/__tests__/seed-all.test.ts` -- pre-existing (verified all 23 tests pass)

### Change Log

- **2026-03-30:** Story 10.9 implemented -- seed orchestrator with service health checks, sequential push execution, state persistence with freshness TTL, and Playwright globalSetup contract. All 23 unit tests pass, full regression suite (345 tests) green.

## Code Review Record

### Review Pass #1

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Status:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 2 (unused variables)
  - Low: 13 (lint warnings)
- **Outcome:** All 15 issues fixed in `packages/rig/tests/e2e/seed/__tests__/seed-all.test.ts`. No code changes required in implementation files.

### Review Pass #2

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Status:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 0
- **Outcome:** Code is clean. No changes needed.

### Review Pass #3

- **Date:** 2026-03-30
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Status:** Success
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 0
  - Security: 0
- **Outcome:** No changes needed. Code is clean and ready for completion.
