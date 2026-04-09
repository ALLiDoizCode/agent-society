# ATDD Checklist — Story 11-12: Arweave Checkpoint Automation

**Generated:** 2026-04-09
**Story:** 11-12-arweave-checkpoint-automation
**Package:** @toon-protocol/pet-dvm
**Test Framework:** Vitest (Jest globals mode per existing package config)

---

## Acceptance Test Scenarios

### AT-1: CheckpointManager constructor rejects invalid threshold

**AC:** AC-1 (CheckpointConfigError on threshold < 1)

**Scenario:** Given a CheckpointConfig with `checkpointThreshold: 0`, when a CheckpointManager is constructed, then a CheckpointConfigError is thrown synchronously.

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN checkpointConfig.checkpointThreshold = 0
WHEN  new CheckpointManager(config)
THEN  throws CheckpointConfigError
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-2: recordInteraction returns false below threshold

**AC:** AC-1 (counter increment, returns false below threshold)

**Scenario:** Given a CheckpointManager with threshold=3 and pet "pet-1", when `recordInteraction("pet-1")` is called twice, it returns `false` both times.

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN manager with checkpointThreshold = 3
WHEN  recordInteraction("pet-1")  → call 1
THEN  returns false
WHEN  recordInteraction("pet-1")  → call 2
THEN  returns false
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-3: recordInteraction returns true at threshold and resets counter

**AC:** AC-1 (counter returns true on Nth call, then resets)

**Scenario:** Given threshold=3, when `recordInteraction` is called 3 times for the same pet, the 3rd call returns `true`. The 4th call returns `false` (counter reset).

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN manager with checkpointThreshold = 3
WHEN  recordInteraction("pet-1")  → call 3
THEN  returns true
WHEN  recordInteraction("pet-1")  → call 4
THEN  returns false (counter reset)
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-4: checkpoint uploads .mv2 and emits 'checkpoint' event

**AC:** AC-3, AC-5 (upload buffer + emit event with txId)

**Scenario:** Given a temp `.mv2` file exists and the mock adapter resolves with `{ txId: 'arweave-tx-1' }`, when `checkpoint("pet-1", "abc123hash")` is called, then `adapter.upload` is called with the file buffer and correct mandatory tags, and the `'checkpoint'` event is emitted with `{ blobbiId: "pet-1", txId: "arweave-tx-1", brainHash: "abc123hash" }`.

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN temp .mv2 file at brainStoragePath/pet-1.mv2
  AND mockAdapter.upload resolves { txId: 'arweave-tx-1' }
WHEN  checkpoint("pet-1", "abc123hash")
THEN  adapter.upload called with (buffer, tags)
  AND tags include { 'Pet-Brain-Id': 'pet-1', 'Brain-Hash': 'abc123hash' }
  AND 'checkpoint' event emitted with txId = 'arweave-tx-1'
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-5: checkpoint emits 'error' (not throw) when .mv2 file missing

**AC:** AC-3 (FILE_NOT_FOUND → emit error, no throw, resolve undefined)

**Scenario:** Given no `.mv2` file exists for "unknown-pet", when `checkpoint("unknown-pet", "hash")` is called, then the `'error'` event is emitted with a CheckpointError of code `'FILE_NOT_FOUND'`, and the promise resolves (does not reject).

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN no .mv2 file for "unknown-pet"
WHEN  checkpoint("unknown-pet", "hash")
THEN  'error' event emitted with code = 'FILE_NOT_FOUND'
  AND promise resolves (not rejects)
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-6: checkpoint emits 'error' (not throw) when upload fails

**AC:** AC-3 (UPLOAD_FAILED → emit error, no throw)

**Scenario:** Given a valid `.mv2` file exists and the mock adapter rejects with an error, when `checkpoint("pet-1", "hash")` is called, then the `'error'` event is emitted with `code: 'UPLOAD_FAILED'` and the promise resolves (does not reject).

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN temp .mv2 file exists
  AND mockAdapter.upload rejects with Error("Turbo failure")
WHEN  checkpoint("pet-1", "hash")
THEN  'error' event emitted with code = 'UPLOAD_FAILED'
  AND promise resolves (not rejects)
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-7: Mandatory tags override caller-supplied arweaveTags

**AC:** AC-3 (mandatory tags cannot be overridden)

**Scenario:** Given `config.arweaveTags` includes `{ 'Pet-Brain-Id': 'CALLER-OVERRIDE', 'Custom-Tag': 'custom-value' }`, when `checkpoint("pet-1", "hash")` is called, then `adapter.upload` receives tags where `Pet-Brain-Id` is `"pet-1"` (not the caller-supplied value), and `Custom-Tag` is `"custom-value"`.

**Test file:** `packages/pet-dvm/src/checkpoint/CheckpointManager.test.ts`

```
GIVEN arweaveTags = { 'Pet-Brain-Id': 'CALLER-OVERRIDE', 'Custom-Tag': 'custom-value' }
WHEN  checkpoint("pet-1", "hash")
THEN  upload tags['Pet-Brain-Id'] = 'pet-1'  (mandatory overrides caller)
  AND upload tags['Custom-Tag'] = 'custom-value'  (caller tag passes through)
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-8: createPetDvmHandler does NOT checkpoint when checkpointConfig absent

**AC:** AC-4 (backward-compatible — no checkpoint without config)

**Scenario:** Given a PetDvmHandler created WITHOUT `checkpointConfig`, when N interactions are processed successfully, then no Arweave upload occurs.

**Test file:** `packages/pet-dvm/src/handler/createPetDvmHandler-checkpoint.test.ts`

```
GIVEN handler created without checkpointConfig
WHEN  N interactions processed (N > any threshold)
THEN  no upload adapter is ever called
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

### AT-9: createPetDvmHandler fires checkpoint after N interactions

**AC:** AC-4 (checkpoint fires after threshold interactions)

**Scenario:** Given a PetDvmHandler created WITH `checkpointConfig: { checkpointThreshold: 3, arweaveAdapter: mockAdapter, brainStoragePath }`, when 3 successful interactions are processed for the same pet, then `mockAdapter.upload` is called exactly once.

**Test file:** `packages/pet-dvm/src/handler/createPetDvmHandler-checkpoint.test.ts`

```
GIVEN handler with checkpointConfig.checkpointThreshold = 3
  AND mockAdapter.upload resolves { txId: 'tx-1' }
WHEN  3 interactions processed for "pet-1"
THEN  mockAdapter.upload called exactly once
```

**Status:** [x] Red  [x] Green  [x] Refactor

---

## Coverage Matrix

| AC  | Scenario(s) | Files |
|-----|-------------|-------|
| AC-1 (CheckpointManager constructor + recordInteraction) | AT-1, AT-2, AT-3 | CheckpointManager.test.ts |
| AC-2 (types defined correctly) | Covered by AT-1, AT-4 (type usage) | CheckpointManager.test.ts |
| AC-3 (upload + tags + error handling) | AT-4, AT-5, AT-6, AT-7 | CheckpointManager.test.ts |
| AC-4 (integration into handler) | AT-8, AT-9 | createPetDvmHandler-checkpoint.test.ts |
| AC-5 (atomic checkpoint semantics) | AT-4 (buffer read) | CheckpointManager.test.ts |
| AC-6 (package exports) | Build verification | index.ts |
| AC-7 (>= 8 unit tests) | AT-1 through AT-7 = 7 in CheckpointManager + AT-8, AT-9 = 2 in handler = 9 total | Both files |
| AC-8 (build verification) | Build step | CI |

---

## Pre-Implementation Checklist

- [ ] Confirm `ArweaveUploadAdapter` is importable from `@toon-protocol/sdk` (verified: yes, exported from `packages/sdk/src/arweave/index.ts`)
- [ ] Confirm `packages/pet-dvm/src/checkpoint/` directory does not already exist
- [ ] Confirm existing 200 tests still pass after each change: `pnpm --filter @toon-protocol/pet-dvm test`
- [ ] Confirm `CheckpointConfig` is NOT directly named the same as any existing type in `@toon-protocol/pet-dvm`

---

## Implementation Order (TDD Red-Green-Refactor)

1. Create `checkpoint/types.ts` (compile check only — no tests yet)
2. Create `checkpoint/CheckpointManager.ts` stub (class with empty methods)
3. Write AT-1 → Red
4. Implement constructor validation → Green
5. Write AT-2, AT-3 → Red
6. Implement `recordInteraction` → Green
7. Write AT-4 (happy path) → Red
8. Implement `checkpoint` upload + emit → Green
9. Write AT-5, AT-6, AT-7 → Red
10. Implement error handling + tag priority → Green
11. Write AT-8 → Red (in handler test file)
12. Integrate into handler (no-op without config) → Green
13. Write AT-9 → Red
14. Add fire-and-forget in handler → Green
15. Refactor pass — clean all new code
16. Export from `index.ts`
17. `pnpm build && pnpm lint && pnpm --filter @toon-protocol/pet-dvm test`
