# Story 22.3: Fix SDK Workflow Chain E2E

Status: done

## Story

As a developer,
I want workflow chain E2E tests to pass deterministically,
so that Nostr event workflow orchestration is verified end-to-end.

## Acceptance Criteria

1. Extend `isParameterizedReplaceableKind` in `packages/relay/src/storage/SqliteEventStore.ts` to cover the TOON-specific range `10032–10099` (currently only `30000–39999` is parameterized). This makes the relay key replacement on `pubkey + kind + d-tag`, matching the protocol design.
2. Confirm that `workflow.ts` already generates unique `d` tags per workflow (`wf-${Date.now()}-${steps.length}`), so collisions disappear once parameterized logic is applied.
3. The workflow chain E2E test passes deterministically across 5 consecutive runs.

## Tasks / Subtasks

- [x] Task 1: Confirm root cause in relay storage
  - [x] 1.1 Open `packages/relay/src/storage/SqliteEventStore.ts`
  - [x] 1.2 Verify `isReplaceableKind(10040)` returns `true` (10040 is in 10000–19999)
  - [x] 1.3 Verify `storeReplaceableEvent` logic: only replaces if `created_at > existing.created_at` OR (`created_at === existing.created_at && event.id < existing.id`)
  - [x] 1.4 Verify `isParameterizedReplaceableKind` currently only covers `30000–39999`

- [x] Task 2: Extend parameterized replaceable kind range (AC: #1)
  - [x] 2.1 Locate `isParameterizedReplaceableKind()` in `packages/relay/src/storage/SqliteEventStore.ts`
  - [x] 2.2 Extend the range check to include TOON-specific kinds `10032–10099`
  - [x] 2.3 Ensure `storeReplaceableEvent` uses `pubkey + kind + d-tag` as the replacement key for kinds in the new range
  - [x] 2.4 Verify no other relay storage logic assumes parameterized = 30000–39999 only

- [x] Task 3: Verify workflow.ts d-tag uniqueness (AC: #2)
  - [x] 3.1 Open `packages/sdk/src/workflow.ts` (or relevant workflow module)
  - [x] 3.2 Confirm `d` tag generation uses `wf-${Date.now()}-${steps.length}` or equivalent unique pattern
  - [x] 3.3 If not unique, adjust `d` tag to include additional entropy (e.g., random suffix)

- [x] Task 4: Run and stabilize workflow chain E2E test (AC: #3)
  - [x] 4.1 Run `cd packages/sdk && pnpm test:e2e:docker -- docker-workflow-chain-e2e.test.ts`
  - [x] 4.2 Run the test 5 times consecutively
  - [x] 4.3 Confirm zero failures across all 5 runs
  - [x] 4.4 Run full SDK E2E suite to ensure no regressions

## Dev Notes

### Root Cause (Confirmed from Spike)

The relay treats `kind:10040` (WORKFLOW_CHAIN_KIND) as standard NIP-01 replaceable (range 10000–19999). When multiple tests publish from the **same pubkey** within the **same `created_at` second**, the relay's `storeReplaceableEvent` silently drops the new event if its ID is lexicographically larger than the existing one. The event was **paid for and fulfilled** (`success: true`) but **not stored** — so `waitForEventOnRelay` returns null.

This is a ~40% flaky failure when tests share a pubkey and fall within the same second.

### Evidence Chain

- `packages/relay/src/storage/SqliteEventStore.ts`: `isReplaceableKind(10040)` returns `true` (10040 is in 10000–19999)
- `storeReplaceableEvent` only replaces if `created_at > existing.created_at` OR (`created_at === existing.created_at && event.id < existing.id`)
- Instrumentation captured: new event ID absent from relay, old event ID from prior test still present
- The protocol design expects `kind:10040` to be **parameterized** replaceable (keyed on `pubkey + kind + d-tag`), but the relay only wires parameterized logic for `30000–39999`

### Architecture

The fix is purely in the relay's event storage layer. No SDK or connector changes required. The relay must treat TOON-specific kind range `10032–10099` as parameterized replaceable, consistent with how it handles `30000–39999`.

### TOON Kind Ranges

- `10032`: `IlpPeerInfo` (swap pairs advertisement)
- `10040`: `WorkflowChain` (workflow orchestration)
- `10050–10099`: Reserved for future TOON replaceable event kinds

All should be parameterized replaceable: replacement key = `pubkey + kind + d-tag`.

### Critical Implementation Patterns

- **Minimal relay change** — only `isParameterizedReplaceableKind` and its call sites need updating.
- **Do not break NIP-01 compliance** — standard replaceable kinds (10000–19999 outside TOON range) must keep their current behavior.
- **Database schema** — verify the `d_tag` column is indexed and available for parameterized lookup.

## Dev Agent Record

### Implementation Summary

- **Task 1:** Confirmed root cause — `isReplaceableKind(10040)` returned `true` because 10040 is in the 10000–19999 range, routing workflow chain events through `storeReplaceableEvent` which keys on `pubkey + kind` only. This caused same-pubkey events published within the same second to collide on lexicographic ID comparison, silently dropping the newer event.

- **Task 2:** Extended parameterized replaceable logic across both relay and BLS packages:
  - `isReplaceableKind` now excludes TOON-specific range `10032–10099` from standard NIP-01 replaceable behavior.
  - `isParameterizedReplaceableKind` now covers both NIP-33 (`30000–39999`) and TOON (`10032–10099`) ranges.
  - Events with kinds in `10032–10099` now route through `storeParameterizedReplaceableEvent`, keying replacement on `pubkey + kind + d-tag`.
  - Added comprehensive unit tests in both `relay` and `bls` `SqliteEventStore.test.ts` covering kind 10040 (different d-tags coexist, same d-tag replaces), kind 10032 (different d-tags coexist), and kind 10099 (boundary check).

- **Task 3:** Verified `workflow.ts` d-tag generation. Confirmed `buildWorkflowDefinitionEvent` uses `wf-${Date.now()}-${params.steps.length}`. Added a random hex suffix (`Math.random().toString(36).slice(2, 8)`) as defensive entropy to guarantee uniqueness even in same-millisecond scenarios. Updated d-tag format: `wf-${Date.now()}-${steps.length}-${randomSuffix}`.

- **Task 4:** Rebuilt `toon:sdk-e2e` Docker image to bundle the updated relay code, recreated peer1/peer2 containers, and ran `docker-workflow-chain-e2e.test.ts` 5 consecutive times. All 15 tests (3 per run × 5 runs) passed with zero flakes.

### Tests Created / Updated

| File | Tests | Result |
|------|-------|--------|
| `packages/relay/src/storage/SqliteEventStore.test.ts` | +4 TOON parameterized replaceable tests | 42 pass |
| `packages/bls/src/storage/SqliteEventStore.test.ts` | +4 TOON parameterized replaceable tests | 42 pass |

### Files Changed

1. `packages/relay/src/storage/SqliteEventStore.ts` — extended `isReplaceableKind` and `isParameterizedReplaceableKind`
2. `packages/bls/src/storage/SqliteEventStore.ts` — same change (mirror implementation)
3. `packages/core/src/events/workflow.ts` — added random suffix to d-tag generation
4. `packages/relay/src/storage/SqliteEventStore.test.ts` — added TOON parameterized replaceable test suite
5. `packages/bls/src/storage/SqliteEventStore.test.ts` — added TOON parameterized replaceable test suite

## Verification

After all tasks complete:

```bash
./scripts/sdk-e2e-infra.sh up
cd packages/sdk && pnpm test:e2e:docker -- docker-workflow-chain-e2e.test.ts
# Run 5 times consecutively
```

Test must pass with zero flakes across 5 consecutive runs.
