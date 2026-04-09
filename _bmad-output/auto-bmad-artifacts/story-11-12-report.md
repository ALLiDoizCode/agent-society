# Story 11-12 Report: Arweave Checkpoint Automation

**Date:** 2026-04-09
**Epic:** 11 — TOON Pets — ZK-Proven Virtual Pet Economy
**Story:** 11-12 — Arweave Checkpoint Automation
**Status:** done
**Pipeline:** auto-bmad-story (22 steps)
**Model:** Claude Sonnet 4.6

---

## Summary

Story 11-12 implements periodic Arweave checkpointing of pet `.mv2` brain files in the `@toon-protocol/pet-dvm` package. Every N interactions (configurable `checkpointThreshold`, default 10), the DVM automatically uploads the pet's `.mv2` file to Arweave via kind:5094. This enables pet portability (operators can be swapped), data recovery after DVM restarts, and third-party biography verification using the publicly anchored Arweave tx ID.

---

## What Was Built

### New: `packages/pet-dvm/src/checkpoint/`

**`types.ts`** — Type definitions:
- `ArweaveUploadAdapter` interface (local copy; structurally compatible with SDK's interface — avoids circular dependency)
- `CheckpointConfig` interface with `arweaveAdapter`, `brainStoragePath`, `checkpointThreshold`, optional `arweaveTags`
- `CheckpointResult` / `CheckpointEvent` structs (`blobbiId`, `txId`, `brainHash`, `timestamp`)
- `CheckpointError` class (extends Error; `blobbiId` + `code: CheckpointErrorCode`)
- `CheckpointConfigError` class (thrown synchronously for invalid config)

**`CheckpointManager.ts`** — Core implementation:
- Extends `EventEmitter`; emits `'checkpoint'` on success, `'error'` on failure
- Default no-op `'error'` listener prevents Node.js unhandled exception crash
- `recordInteraction(blobbiId)`: per-pet Map counter, resets on threshold → returns `true`
- `checkpoint(blobbiId, brainHash)`: `fs.readFile` → upload with mandatory tags → emit `'checkpoint'`; never throws (errors → `'error'` event)
- Mandatory tags (`Pet-Brain-Id`, `Brain-Hash`, `Content-Type`, `Checkpoint-Timestamp`) override caller-supplied `arweaveTags`
- Convenience methods: `onCheckpoint()`, `onCheckpointError()`

**`index.ts`** — Barrel export

### Modified: Handler Integration

**`packages/pet-dvm/src/handler/types.ts`**:
- Added optional `checkpointConfig?: CheckpointConfig` to `PetDvmConfig` (backward-compatible)

**`packages/pet-dvm/src/handler/createPetDvmHandler.ts`**:
- Instantiates `CheckpointManager` once at factory time (not per-request)
- After each successful `stateManager.save()`: calls `recordInteraction()`, fire-and-forgots `checkpoint()` when threshold reached

**`packages/pet-dvm/src/index.ts`**:
- Exports `CheckpointManager`, `CheckpointError`, `CheckpointConfigError`, and all checkpoint types

---

## Test Results

| Metric | Value |
|--------|-------|
| Test suites | 11 passed |
| Total tests | 215 (200 pre-existing + 15 new) |
| New CheckpointManager tests | 12 |
| New handler integration tests | 3 |
| Regressions | 0 |
| Build | Clean |
| Lint | 0 errors |

---

## Key Implementation Decisions

1. **Local `ArweaveUploadAdapter` interface** — `pet-dvm` has no dependency on `@toon-protocol/sdk`. The interface is duplicated locally (same structural contract). Any `TurboUploadAdapter` instance satisfies both.

2. **Default no-op `'error'` listener** — EventEmitter throws unhandled `'error'` events. Added a no-op listener in the constructor so the DVM doesn't crash if the operator hasn't attached a listener. Discovered during code review Pass #1.

3. **Timestamp increments for WARM action tests** — WARM has a 5400s cooldown. Test interactions use 10,000s increments to avoid `COOLDOWN_ACTIVE` rejections.

4. **Jest globals (not Vitest)** — `pet-dvm` uses Jest/ts-jest (CommonJS). New tests use `jest.fn()` and `describe`/`it` globals, not Vitest imports.

5. **No `.js` extensions** — CommonJS Jest can't resolve ESM `.js` extensions. All imports use bare module paths.

---

## Architecture Alignment

Implements the "Periodic Arweave checkpoint" described in `_bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md`:
> "PERIODIC (every ~10 interactions): DVM checkpoints .mv2 → Arweave (kind:5094)"

The atomic checkpoint protocol is followed: brain is committed and closed before `checkpoint()` is called, ensuring the snapshot is consistent with the `brainHash` field.

---

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Story file | `_bmad-output/implementation-artifacts/11-12-arweave-checkpoint-automation.md` |
| ATDD checklist | `_bmad-output/test-artifacts/atdd-checklist-11-12.md` |
| NFR assessment | `_bmad-output/test-artifacts/nfr-assessment-11-12.md` |
| Traceability matrix | `_bmad-output/test-artifacts/traceability/story-11-12-trace.md` |
| Sprint status | `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-12 → done) |
