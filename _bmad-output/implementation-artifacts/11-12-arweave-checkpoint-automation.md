# Story 11.12: Arweave Checkpoint Automation

Status: done
ui_impact: false

## Story

As a pet DVM operator,
I want the DVM to automatically checkpoint each pet's `.mv2` brain file to Arweave (via kind:5094) every N interactions, with a configurable threshold, and to update the Mina on-chain `brainHash` reference after each successful upload,
so that pet brains survive DVM restarts, operators can be swapped without data loss, and third parties can independently verify the pet's memory integrity using the publicly anchored Arweave tx ID.

## Dependencies

- **Upstream:** Story 11-5 (Pet DVM Handler) — `createPetDvmHandler`, `PetDvmConfig`, `PetStateManager`, `brainHash` in `PetEngineState`. DONE.
- **Upstream:** Story 11-4 (Pet Game Engine) — `PetEngineState`, `brainHash` field. DONE.
- **Shared:** `@toon-protocol/sdk` — `ArweaveUploadAdapter`, `TurboUploadAdapter`, `ArweaveDvmConfig` pattern. In `packages/sdk/src/arweave/`.
- **Shared:** `@toon-protocol/pet-dvm` — `createPetDvmHandler`, `PetDvmConfig`, `PetStateManager`, `PetBrain`.
- **Downstream:** Story 11-13 (Breeding Circuit) — reads `brainHash` from on-chain state for parent verification.
- **Architecture reference:** `_bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md` section "Checkpoint Protocol (Atomic)".

## Acceptance Criteria

1. **AC-1 — CheckpointManager class:** Create `packages/pet-dvm/src/checkpoint/CheckpointManager.ts` with class `CheckpointManager`:
   - Constructor: `constructor(config: CheckpointConfig)`
   - `CheckpointConfig` interface (in `packages/pet-dvm/src/checkpoint/types.ts`):
     - `arweaveAdapter: ArweaveUploadAdapter` — upload adapter (injected; matches `ArweaveUploadAdapter` interface from `packages/sdk/src/arweave/turbo-adapter.ts`)
     - `brainStoragePath: string` — directory containing `.mv2` files
     - `checkpointThreshold: number` — number of interactions between checkpoints (default: 10; must be >= 1)
     - `arweaveTags?: Record<string, string>` — additional Arweave data item tags (merged with mandatory tags)
   - Method: `recordInteraction(blobbiId: string): boolean` — increments the interaction counter for this pet; returns `true` if the threshold is reached (checkpoint should fire), `false` otherwise. Counter resets to 0 after returning `true`.
   - Method: `getInteractionCount(blobbiId: string): number` — returns current interaction count for a pet (0 if unknown).
   - Method: `async checkpoint(blobbiId: string, brainHash: string): Promise<CheckpointResult>` — uploads the `.mv2` file to Arweave and returns the tx ID. Emits `'checkpoint'` event. Returns `CheckpointResult` (see AC-2).
   - `CheckpointManager` extends `EventEmitter`. Emits:
     - `'checkpoint'` — `CheckpointEvent` (see AC-2) after each successful upload
     - `'error'` — `CheckpointError` on upload failure (non-fatal; DVM continues)
   - Throws `CheckpointConfigError` in constructor if `checkpointThreshold < 1`.

2. **AC-2 — CheckpointResult, CheckpointEvent, and CheckpointError types:** Create `packages/pet-dvm/src/checkpoint/types.ts` with:
   - `CheckpointConfig` interface (described in AC-1)
   - `CheckpointResult` interface: `{ blobbiId: string, txId: string, brainHash: string, timestamp: number }`
   - `CheckpointEvent` interface: same fields as `CheckpointResult` (emitted on `'checkpoint'` event)
   - `CheckpointError` class extending `Error` with `blobbiId: string` and `code: CheckpointErrorCode` fields; supported codes: `'UPLOAD_FAILED'`, `'FILE_NOT_FOUND'`, `'CONFIG_ERROR'`
   - `CheckpointConfigError` class extending `Error` (thrown synchronously in constructor for invalid config)
   - Export all from `packages/pet-dvm/src/checkpoint/index.ts` barrel

3. **AC-3 — Arweave upload with pet-specific tags:** `CheckpointManager.checkpoint()` uploads the `.mv2` file at `path.join(config.brainStoragePath, blobbiId + '.mv2')` using `config.arweaveAdapter.upload(buffer, tags)` where `tags` is:
   - `{ 'Content-Type': 'application/octet-stream', 'Pet-Brain-Id': blobbiId, 'Brain-Hash': brainHash, 'Checkpoint-Timestamp': String(Date.now()), ...config.arweaveTags }`
   - Mandatory tags (`Content-Type`, `Pet-Brain-Id`, `Brain-Hash`, `Checkpoint-Timestamp`) are applied AFTER `config.arweaveTags` so they cannot be overridden by caller-supplied tags
   - If `.mv2` file does not exist, emit `'error'` with `CheckpointError(code: 'FILE_NOT_FOUND')` and resolve with `undefined` (do NOT throw, do NOT reject handler)
   - If upload fails, emit `'error'` with `CheckpointError(code: 'UPLOAD_FAILED')` and resolve with `undefined`

4. **AC-4 — Integration into createPetDvmHandler:** Extend `PetDvmConfig` in `packages/pet-dvm/src/handler/types.ts` with optional `checkpointConfig?: CheckpointConfig` field. Update `createPetDvmHandler` in `packages/pet-dvm/src/handler/createPetDvmHandler.ts` to:
   - When `config.checkpointConfig` is set: instantiate a `CheckpointManager` once (not per-request) at handler creation time
   - After each successful interaction (after step l — `stateManager.save()`), call `checkpointManager.recordInteraction(request.blobbiId)`
   - If `recordInteraction` returns `true`, fire-and-forget `checkpointManager.checkpoint(blobbiId, brainHash)` (errors already emitted as `'error'` events — do NOT await in the hot path)
   - When `config.checkpointConfig` is NOT set: skip all checkpoint logic (backward-compatible default)
   - `CheckpointManager` instance is NOT created if `checkpointConfig` is undefined

5. **AC-5 — Atomic checkpoint semantics:** The checkpoint sequence in `CheckpointManager.checkpoint()` MUST follow the atomic protocol from the architecture spec:
   - Read entire `.mv2` file into a buffer (do NOT stream — must be a snapshot)
   - Upload buffer to Arweave via `arweaveAdapter.upload(buffer, tags)`
   - Only emit `'checkpoint'` event after upload succeeds (contains resulting `txId`)
   - Do NOT hold a file lock during upload (Memvid lock is released before `checkpoint()` is called — the handler already calls `brain.close()` before returning)
   - File is captured at the moment `checkpoint()` is called; any in-flight writes to a new `.mv2` are to a separate file path (per-blobbiId isolation)

6. **AC-6 — Package exports:** Export from `packages/pet-dvm/src/index.ts`:
   - Classes: `CheckpointManager`
   - Types: `CheckpointConfig`, `CheckpointResult`, `CheckpointEvent`, `CheckpointError`, `CheckpointConfigError`, `CheckpointErrorCode`

7. **AC-7 — Unit tests:** >= 8 unit tests across 2 test files:
   - `CheckpointManager.test.ts` (>= 6 tests):
     - Constructor rejects `checkpointThreshold < 1` with `CheckpointConfigError`
     - `recordInteraction` returns `false` below threshold and `true` at threshold, then resets counter
     - `checkpoint` uploads buffer and emits `'checkpoint'` event with correct `txId` and `brainHash`
     - `checkpoint` emits `'error'` event (not throw) when `.mv2` does not exist
     - `checkpoint` emits `'error'` event (not throw) when upload fails
     - Mandatory tags (`Pet-Brain-Id`, `Brain-Hash`) are present in upload call, caller tags do not override them
   - `createPetDvmHandler-checkpoint.test.ts` (>= 2 tests):
     - Handler does NOT call checkpoint adapter when `checkpointConfig` is absent
     - Handler fires checkpoint after `checkpointThreshold` interactions (use mock adapter, assert `upload` called once after N calls)

8. **AC-8 — Build verification:** After all changes:
   - `pnpm build` compiles cleanly across all packages
   - `pnpm lint` passes
   - `pnpm --filter @toon-protocol/pet-dvm test` passes — all new + existing tests pass

## Tasks / Subtasks

- [x] Task 1: Create checkpoint types (AC: 2)
  - [x] 1.1 Create `packages/pet-dvm/src/checkpoint/types.ts` with `CheckpointConfig`, `CheckpointResult`, `CheckpointEvent`, `CheckpointError`, `CheckpointConfigError`
  - [x] 1.2 Create `packages/pet-dvm/src/checkpoint/index.ts` barrel export

- [x] Task 2: Implement CheckpointManager (AC: 1, 3, 5)
  - [x] 2.1 Create `packages/pet-dvm/src/checkpoint/CheckpointManager.ts`
  - [x] 2.2 Implement `recordInteraction` with per-pet counter (Map<string, number>)
  - [x] 2.3 Implement `checkpoint` with atomic read + upload + tag composition + event emission

- [x] Task 3: Integrate into createPetDvmHandler (AC: 4)
  - [x] 3.1 Add optional `checkpointConfig?: CheckpointConfig` to `PetDvmConfig` in `packages/pet-dvm/src/handler/types.ts`
  - [x] 3.2 Instantiate `CheckpointManager` at factory time (not per-request) in `createPetDvmHandler`
  - [x] 3.3 Add `recordInteraction` + conditional fire-and-forget `checkpoint` call after `stateManager.save()`

- [x] Task 4: Update package exports (AC: 6)
  - [x] 4.1 Add checkpoint exports to `packages/pet-dvm/src/index.ts`

- [x] Task 5: Write unit tests (AC: 7)
  - [x] 5.1 Create `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`
  - [x] 5.2 Create `packages/pet-dvm/src/handler/createPetDvmHandler-checkpoint.test.ts`

- [x] Task 6: Build and lint verification (AC: 8)
  - [x] 6.1 Run `pnpm build`
  - [x] 6.2 Run `pnpm lint`
  - [x] 6.3 Run `pnpm --filter @toon-protocol/pet-dvm test`

## Dev Notes

### Critical: Atomic Checkpoint Protocol

Per `_bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md` section "Checkpoint Protocol (Atomic)":

```
1. WAL flush + commit (Memvid native) — already done by handler before close()
2. Acquire write lock on .mv2           — NOT needed here; brain.close() already called
3. BLAKE3 hash (deterministic)          — already done by handler; passed in as brainHash param
4. Upload frozen .mv2 → Arweave (kind:5094 DVM)
5. Release write lock                   — N/A (already released in step 2)
```

The handler already calls `brain.commit()` then `brain.close()` before `stateManager.save()`. By the time `checkpoint()` is called, the `.mv2` file is fully committed and the native handle is closed. No lock contention is possible.

### ArweaveUploadAdapter Interface

Import the interface from the SDK (NOT pet-dvm):
```typescript
import type { ArweaveUploadAdapter } from '@toon-protocol/sdk';
```

The `ArweaveUploadAdapter` interface is defined in `packages/sdk/src/arweave/turbo-adapter.ts`:
```typescript
export interface ArweaveUploadAdapter {
  upload(data: Buffer, tags?: Record<string, string>): Promise<{ txId: string }>;
}
```

This is already exported from `packages/sdk/src/arweave/index.ts`. Confirm export chain before use.

### Tag Priority Convention

Mandatory tags MUST override caller-supplied tags. Use spread order:
```typescript
const finalTags: Record<string, string> = {
  ...config.arweaveTags,          // caller-supplied (lower priority)
  'Content-Type': 'application/octet-stream',
  'Pet-Brain-Id': blobbiId,
  'Brain-Hash': brainHash,
  'Checkpoint-Timestamp': String(Date.now()),
};
```

### EventEmitter Pattern

`CheckpointManager` extends Node.js `EventEmitter`. Use typed emitter pattern:
```typescript
import { EventEmitter } from 'node:events';

export class CheckpointManager extends EventEmitter {
  // typed emit/on methods for 'checkpoint' and 'error'
}
```

TypeScript typed events require declaration merging or a typed interface. Keep it simple — use `declare` overrides:
```typescript
declare interface CheckpointManager {
  on(event: 'checkpoint', listener: (evt: CheckpointEvent) => void): this;
  on(event: 'error', listener: (err: CheckpointError) => void): this;
  emit(event: 'checkpoint', evt: CheckpointEvent): boolean;
  emit(event: 'error', err: CheckpointError): boolean;
}
```

### File Reading Pattern

Use Node.js `fs/promises.readFile` — not streaming, not `fs.readFileSync`. Full buffer read is required:
```typescript
import { readFile } from 'node:fs/promises';
const buffer = await readFile(brainPath);
```

Catch `ENOENT` to detect missing files:
```typescript
try {
  const buffer = await readFile(brainPath);
  // ... upload
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    this.emit('error', new CheckpointError('File not found', blobbiId, 'FILE_NOT_FOUND'));
    return undefined;
  }
  this.emit('error', new CheckpointError('Upload failed', blobbiId, 'UPLOAD_FAILED'));
  return undefined;
}
```

### CheckpointManager Instantiation Placement

The `CheckpointManager` is created ONCE at handler factory time, NOT per-request:

```typescript
export function createPetDvmHandler(config: PetDvmConfig) {
  const stateManager = new PetStateManager();
  const proofQueue = new ProofQueue(config.proofBatchSize ?? 10);
  // Instantiate checkpoint manager once if configured:
  const checkpointManager = config.checkpointConfig
    ? new CheckpointManager(config.checkpointConfig)
    : undefined;

  return async (ctx: HandlerContext): Promise<HandlerResponse> => {
    // ... existing handler logic ...

    // After stateManager.save(), before proofQueue.push():
    if (checkpointManager) {
      const shouldCheckpoint = checkpointManager.recordInteraction(request.blobbiId);
      if (shouldCheckpoint) {
        // fire-and-forget — errors are emitted as 'error' events
        checkpointManager.checkpoint(request.blobbiId, brainHash).catch(() => {
          // already emitted as 'error' event by CheckpointManager
        });
      }
    }
    // ... rest of handler ...
  };
}
```

### Test Mock Pattern

Tests use a mock `ArweaveUploadAdapter` — do NOT use `@ardrive/turbo-sdk` in tests:
```typescript
const mockAdapter: ArweaveUploadAdapter = {
  upload: vi.fn().mockResolvedValue({ txId: 'mock-tx-id-123' }),
};
```

For file system tests in `CheckpointManager.test.ts`, use `node:fs/promises` to write a temp `.mv2` file in `os.tmpdir()` before calling `checkpoint()`. Clean up in `afterEach`.

### TypeScript Strict Mode Compliance

This project uses `noUncheckedIndexedAccess: true` and `noPropertyAccessFromIndexSignature: true`. For Map access:
```typescript
// Wrong: this.counters[blobbiId]  (index signature)
// Correct:
const count = this.counters.get(blobbiId) ?? 0;
```

### No UI Impact

This story adds a checkpoint module to `pet-dvm` (server-side). No UI components. Ditto currently has no checkpoint visibility — that is deferred.

### Regression Risk

- Existing `createPetDvmHandler` callers that do NOT pass `checkpointConfig` must continue to work unchanged (backward-compatible optional field).
- `CheckpointManager` must NOT be imported unconditionally — instantiation only when `config.checkpointConfig` is set.
- All 200 existing tests in pet-dvm must continue to pass.

### Directory Structure

New subdirectory in `packages/pet-dvm/src/checkpoint/`:
```
packages/pet-dvm/src/checkpoint/
  types.ts                           (CheckpointConfig, CheckpointResult, CheckpointEvent, CheckpointError, CheckpointConfigError)
  CheckpointManager.ts               (implementation)
  CheckpointManager.test.ts          (unit tests)
  index.ts                           (barrel export)
```

New test file alongside existing handler tests:
```
packages/pet-dvm/src/handler/createPetDvmHandler-checkpoint.test.ts
```

### ArweaveUploadAdapter Export Verification

Before implementing, confirm `ArweaveUploadAdapter` is exported from `packages/sdk`. Check `packages/sdk/src/arweave/index.ts` to verify the export chain. If not exported, add it. The `TurboUploadAdapter` class is already in `packages/sdk/src/arweave/turbo-adapter.ts`.

### References

- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md#Checkpoint-Protocol] — Atomic checkpoint protocol
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md#DVM-Interaction-Flow] — "PERIODIC (every ~10 interactions): DVM checkpoints .mv2 → Arweave (kind:5094)"
- [Source: packages/pet-dvm/src/handler/createPetDvmHandler.ts] — handler lifecycle, brain.close() placement, stateManager.save() location
- [Source: packages/pet-dvm/src/handler/types.ts] — PetDvmConfig, HandlerContext (brainHash flow)
- [Source: packages/pet-dvm/src/engine/types.ts] — PetEngineState.brainHash
- [Source: packages/sdk/src/arweave/turbo-adapter.ts] — ArweaveUploadAdapter interface
- [Source: packages/sdk/src/arweave/arweave-dvm-handler.ts] — ArweaveDvmConfig pattern, upload tags pattern
- [Source: packages/pet-dvm/src/pricing/types.ts] — PricingError pattern (replicate for CheckpointError)
- [Source: packages/pet-dvm/src/handler/PetStateManager.ts] — per-pet Map pattern

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None — all tests passed after three fix rounds: (1) `@toon-protocol/sdk` import removed (pet-dvm has no SDK dep — ArweaveUploadAdapter defined locally with structural compatibility), (2) `.js` extensions removed from checkpoint imports (CommonJS Jest can't resolve ESM `.js`), (3) WARM action cooldown is 5400s — timestamp increments raised from +10s to +10000s between interactions.

### Completion Notes List

- Created `packages/pet-dvm/src/checkpoint/` subdirectory with 4 source files + barrel
- `types.ts`: Local `ArweaveUploadAdapter` interface (structurally compatible with SDK's), `CheckpointConfig`, `CheckpointResult`, `CheckpointEvent`, `CheckpointError` (with `blobbiId` + `code`), `CheckpointConfigError`
- `CheckpointManager.ts`: Extends `EventEmitter`; `recordInteraction` (per-pet counter Map, resets on threshold); `checkpoint` (fs.readFile → upload → emit 'checkpoint' | emit 'error'); mandatory tags override caller `arweaveTags`; never throws
- `index.ts`: barrel export of all types + classes
- Extended `PetDvmConfig` in `handler/types.ts` with optional `checkpointConfig?: CheckpointConfig` (backward-compatible)
- Extended `createPetDvmHandler` to instantiate `CheckpointManager` once at factory time; fire-and-forget checkpoint after each `stateManager.save()` when threshold reached
- Added checkpoint exports to `packages/pet-dvm/src/index.ts`
- 15 new tests across 2 files; 215 total tests pass (200 existing + 15 new)

### File List

- packages/pet-dvm/src/checkpoint/types.ts (created)
- packages/pet-dvm/src/checkpoint/CheckpointManager.ts (created)
- packages/pet-dvm/src/checkpoint/index.ts (created)
- packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts (created)
- packages/pet-dvm/src/handler/createPetDvmHandler-checkpoint.test.ts (created)
- packages/pet-dvm/src/handler/types.ts (modified — added checkpointConfig field + CheckpointConfig import/re-export)
- packages/pet-dvm/src/handler/createPetDvmHandler.ts (modified — CheckpointManager import + instantiation + fire-and-forget call)
- packages/pet-dvm/src/index.ts (modified — added checkpoint exports)
- _bmad-output/implementation-artifacts/11-12-arweave-checkpoint-automation.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-04-09: Story 11-12 development complete. Implemented CheckpointManager in packages/pet-dvm/src/checkpoint/. 15 new tests, 215 total passing.
- 2026-04-09: Code Review Pass #1 — added default no-op 'error' listener in constructor to prevent Node.js unhandled error crash when no operator listener is attached.

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 1 medium, 0 low
- **Outcome:** Pass with fix applied

#### Issues Found

1. **[Medium] Unhandled `'error'` event on EventEmitter causes Node.js crash** — If `CheckpointManager` emits `'error'` with no listeners attached (operator hasn't called `onCheckpointError()`), Node.js throws the error as an unhandled exception, crashing the DVM process. Fixed by installing a default no-op `'error'` listener in the constructor. Operators may still replace it with a real listener via `onCheckpointError()`.

#### Tests

- All 215 tests pass after fix.

### Review Pass #2

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Security Checks Performed

- Path traversal: `blobbiId` is already sanitised by handler guard before reaching `checkpoint()` — safe
- Error message leakage: `CheckpointError` is an internal event, not returned to ILP clients — safe
- Tag injection: `blobbiId` and `brainHash` are operator-controlled values — no injection risk
- `Date.now()` in tags: deterministic, non-sensitive — safe
- No JSON.parse, no regex, no prototype pollution surface in new code

#### Tests

- All 215 tests pass — no files modified.

### Review Pass #3 (FINAL)

- **Date:** 2026-04-09
- **Reviewer Model:** Claude Sonnet 4.6
- **Severity Counts:** 0 critical, 0 high, 0 medium, 0 low
- **Outcome:** Pass — no issues found

#### Notes

- Code is clean, consistent with `GameEngineError`/`PricingError` error patterns
- `onCheckpoint()`/`onCheckpointError()` convenience methods are good DX additions
- `recordInteraction` reset logic (returns true, resets to 0) is correct and well-tested
- All 215 tests pass — no files modified
