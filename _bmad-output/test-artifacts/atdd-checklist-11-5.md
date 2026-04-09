---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-08'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-5-pet-dvm-handler.md'
  - '_bmad/tea/testarch/knowledge/data-factories.md'
  - '_bmad/tea/testarch/knowledge/test-quality.md'
  - '_bmad/tea/testarch/knowledge/test-levels-framework.md'
  - 'packages/pet-dvm/jest.config.js'
  - 'packages/pet-dvm/src/engine/types.ts'
  - 'packages/pet-dvm/src/engine/PetGameEngine.ts'
  - 'packages/sdk/src/arweave/arweave-dvm-handler.ts'
  - 'packages/sdk/src/handler-context.ts'
  - 'packages/sdk/src/handler-registry.ts'
  - 'packages/core/src/constants.ts'
  - 'packages/memvid-node/index.d.ts'
---

# ATDD Checklist - Epic 11, Story 5: Pet DVM Handler

**Date:** 2026-04-08
**Author:** Jonathan
**Primary Test Level:** Unit

---

## Story Summary

A Pet DVM handler (`createPetDvmHandler`) that receives Kind 5900 pet interaction requests via ILP, processes them through PetGameEngine and Memvid PetBrain, publishes optimistic Kind 14919 events, and queues interactions for async ZK proof generation.

**As a** TOON Protocol developer
**I want** a Pet DVM handler that processes pet interaction requests end-to-end
**So that** pet owners get instant feedback on interactions while proofs are generated in the background for eventual Mina settlement.

---

## Acceptance Criteria

1. **AC-1** -- createPetDvmHandler factory function returning async handler compatible with HandlerRegistry.on()
2. **AC-2** -- Request parsing: extract tags from Kind 5900 events, reject malformed requests with F00
3. **AC-3** -- PetStateManager: in-memory Map storing PetEngineState per blobbi_id with getOrCreate/save/get
4. **AC-4** -- Interaction processing flow: decode -> parse -> load state -> create engine -> process -> brain -> save -> evolve check -> queue -> publish -> respond
5. **AC-5** -- ProofQueue: in-memory queue with push/getBatch/drain and EventEmitter batch-ready signal
6. **AC-6** -- Optimistic Kind 14919 event builder with correct tags, fire-and-forget publish
7. **AC-7** -- Kind constants: PET_INTERACTION_REQUEST_KIND=5900, PET_INTERACTION_RESULT_KIND=6900, PET_INTERACTION_EVENT_KIND=14919
8. **AC-8** -- Type definitions: PetDvmConfig, PetInteractionRequest, ProofQueueEntry
9. **AC-9** -- Unit tests for createPetDvmHandler (12 tests)
10. **AC-10** -- PetStateManager tests (3 tests)
11. **AC-11** -- ProofQueue tests (5 tests)
12. **AC-12** -- parsePetInteractionRequest tests (5 tests)
13. **AC-13** -- Package exports updated

---

## Test Strategy

### Generation Mode

**AI Generation** -- Backend-only project (Node.js/TypeScript/Jest). No browser recording needed.

### Test Level Mapping

All tests are **Unit** level using Jest + ts-jest. This project has no UI, no API endpoints, and no database -- all components are pure TypeScript classes/functions with in-memory state. PetBrain (napi-rs native addon) is mocked in all tests.

| AC | Test Scenario | Level | Priority | Red Phase Failure Reason |
|----|---------------|-------|----------|--------------------------|
| AC-2, AC-12 | parsePetInteractionRequest -- valid event parsed correctly | Unit | P0 | Function does not exist |
| AC-2, AC-12 | parsePetInteractionRequest -- missing d tag returns null | Unit | P0 | Function does not exist |
| AC-2, AC-12 | parsePetInteractionRequest -- missing action tag returns null | Unit | P0 | Function does not exist |
| AC-2, AC-12 | parsePetInteractionRequest -- non-numeric action returns null | Unit | P1 | Function does not exist |
| AC-2, AC-12 | parsePetInteractionRequest -- optional sleeping tag defaults to false | Unit | P1 | Function does not exist |
| AC-3, AC-10 | PetStateManager -- getOrCreate returns genesis state for unknown blobbiId | Unit | P0 | Class does not exist |
| AC-3, AC-10 | PetStateManager -- save + get round-trips state correctly | Unit | P0 | Class does not exist |
| AC-3, AC-10 | PetStateManager -- multiple pets stored independently | Unit | P1 | Class does not exist |
| AC-5, AC-11 | ProofQueue -- push adds entry, size increments | Unit | P0 | Class does not exist |
| AC-5, AC-11 | ProofQueue -- getBatch returns null when queue < batchSize | Unit | P1 | Class does not exist |
| AC-5, AC-11 | ProofQueue -- getBatch returns entries when queue >= batchSize | Unit | P0 | Class does not exist |
| AC-5, AC-11 | ProofQueue -- batch-ready event emitted when batchSize reached | Unit | P0 | Class does not exist |
| AC-5, AC-11 | ProofQueue -- drain empties queue and returns all entries | Unit | P1 | Class does not exist |
| AC-1, AC-4, AC-9 | createPetDvmHandler -- valid interaction returns accept with new state | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- malformed request (missing blobbi_id) returns F00 | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- invalid action for stage returns F00 | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- cooldown violation returns F00 | Unit | P1 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- multiple sequential interactions update state | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- brain hash changes after each interaction | Unit | P0 | Function does not exist |
| AC-6, AC-9 | createPetDvmHandler -- Kind 14919 event published with correct tags | Unit | P0 | Function does not exist |
| AC-5, AC-9 | createPetDvmHandler -- proof queue entry created per interaction | Unit | P1 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- new pet gets genesis state on first interaction | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- returns base64-encoded JSON new state in FULFILL | Unit | P0 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- PetBrain open/create failure returns T00 | Unit | P1 | Function does not exist |
| AC-4, AC-9 | createPetDvmHandler -- brain.close() called even when processing throws | Unit | P0 | Function does not exist |

### Test Count Summary

| Test File | Count | Priority Breakdown |
|-----------|-------|-------------------|
| parsePetInteractionRequest.test.ts | 5 | 2xP0, 3xP1 |
| PetStateManager.test.ts | 3 | 2xP0, 1xP1 |
| ProofQueue.test.ts | 5 | 2xP0, 3xP1 |
| createPetDvmHandler.test.ts | 12 | 8xP0, 4xP1 |
| **Total** | **25** | **14xP0, 11xP1** |

### Mock Requirements

| Dependency | Mock Strategy |
|------------|--------------|
| `@toon-protocol/memvid-node` (PetBrain) | Full jest.mock -- static methods `open`/`create` return mock object with `putBytes`, `commit`, `hash`, `close` |
| `@toon-protocol/pet-circuit` (computeDecay, applyAction, etc.) | NOT mocked -- real circuit utilities used (they are pure functions) |
| `PetGameEngine` / `createPetGameEngine` | NOT mocked in handler tests -- real engine used for realistic flow |
| `publishEvent` callback | Jest fn mock -- verify calls and args |
| `HandlerContext` | Manual mock object with `decode()` returning test events |

### Red Phase Confirmation

All 25 tests are designed to fail before implementation because the target modules (`parsePetInteractionRequest.ts`, `PetStateManager.ts`, `ProofQueue.ts`, `createPetDvmHandler.ts`) do not yet exist. Tests will fail with import/module-not-found errors in the RED phase. After module stubs are created, tests will fail with assertion errors until logic is implemented.

---

## Failing Tests Created (RED Phase)

### Unit Tests -- parsePetInteractionRequest (5 tests)

**File:** `packages/pet-dvm/src/handler/parsePetInteractionRequest.test.ts`

- **Test:** should parse a valid event correctly
  - **Status:** RED - Module `./parsePetInteractionRequest` does not exist
  - **Verifies:** AC-2, AC-12 -- Valid Kind 5900 event tag extraction

- **Test:** should return null when d tag is missing
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-2, AC-12 -- Malformed request rejection (missing blobbi_id)

- **Test:** should return null when action tag is missing
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-2, AC-12 -- Malformed request rejection (missing action)

- **Test:** should return null when action tag has non-numeric value
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-2, AC-12 -- Non-numeric action tag validation

- **Test:** should default isSleeping to false when sleeping tag is absent
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-2, AC-12 -- Optional sleeping tag defaults

### Unit Tests -- PetStateManager (3 tests)

**File:** `packages/pet-dvm/src/handler/PetStateManager.test.ts`

- **Test:** should return genesis state for unknown blobbiId via getOrCreate
  - **Status:** RED - Module `./PetStateManager` does not exist
  - **Verifies:** AC-3, AC-10 -- Genesis state creation for new pets

- **Test:** should round-trip state correctly via save + get
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-3, AC-10 -- State persistence round-trip

- **Test:** should store multiple pets independently
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-3, AC-10 -- Multi-pet isolation

### Unit Tests -- ProofQueue (5 tests)

**File:** `packages/pet-dvm/src/handler/ProofQueue.test.ts`

- **Test:** should increment size when entries are pushed
  - **Status:** RED - Module `./ProofQueue` does not exist
  - **Verifies:** AC-5, AC-11 -- Push and size tracking

- **Test:** should return null from getBatch when queue is below batchSize
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-5, AC-11 -- Batch threshold guard

- **Test:** should return entries from getBatch when queue reaches batchSize
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-5, AC-11 -- Batch retrieval

- **Test:** should emit batch-ready event when batchSize is reached
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-5, AC-11 -- EventEmitter integration

- **Test:** should drain all entries and empty the queue
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-5, AC-11 -- Drain operation

### Unit Tests -- createPetDvmHandler (12 tests)

**File:** `packages/pet-dvm/src/handler/createPetDvmHandler.test.ts`

- **Test:** should return accept with new state for a valid interaction request
  - **Status:** RED - Module `./createPetDvmHandler` does not exist
  - **Verifies:** AC-1, AC-4, AC-9 -- Happy path end-to-end

- **Test:** should reject with F00 for malformed request (missing blobbi_id tag)
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Malformed request rejection

- **Test:** should reject with F00 for invalid action for current stage
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- GameEngineError INVALID_ACTION mapping

- **Test:** should reject with F00 for cooldown violation
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- GameEngineError COOLDOWN_ACTIVE mapping

- **Test:** should update pet state correctly across multiple sequential interactions
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Sequential state progression

- **Test:** should produce different brain hashes after each interaction
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Brain hash changes per interaction

- **Test:** should publish Kind 14919 event with correct tags via publishEvent callback
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-6, AC-9 -- Optimistic event tag correctness

- **Test:** should create a proof queue entry for each successful interaction
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-5, AC-9 -- ProofQueue integration

- **Test:** should create genesis state for a new pet on first interaction
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Genesis state auto-creation

- **Test:** should return base64-encoded JSON new state in FULFILL data
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Response format compliance

- **Test:** should return T00 reject when PetBrain open and create both fail
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Brain storage failure handling

- **Test:** should call brain.close() even when processing throws an error
  - **Status:** RED - Module does not exist
  - **Verifies:** AC-4, AC-9 -- Resource cleanup guarantee

---

## Data Factories Created

### Pet Event Factory

**File:** Inline in each test file (test helpers)

**Exports (per file):**

- `makeValidPetEvent(overrides?)` -- Create a valid Kind 5900 NostrEvent with optional tag overrides
- `makeHandlerContext(event)` -- Create a mock HandlerContext wrapping a NostrEvent
- `makeConfig(overrides?)` -- Create a PetDvmConfig with mock publishEvent
- `makeProofEntry(overrides?)` -- Create a ProofQueueEntry with sensible defaults

**Rationale:** Factories are colocated in each test file rather than a shared directory because:
1. Each test file has unique mock patterns (PetBrain mock is handler-specific)
2. The project uses Jest (not Playwright fixtures) -- no shared fixture infrastructure
3. Overrides pattern follows data-factories.md guidance with `Partial<T>` approach

---

## Fixtures Created

N/A -- This is a backend Jest project. No Playwright/Cypress fixtures needed. Test setup is handled by Jest `beforeEach` hooks and factory functions.

---

## Mock Requirements

### PetBrain Mock (napi-rs native addon)

**Module:** `@toon-protocol/memvid-node`

**Mock Setup:**

```typescript
const mockBrain = {
  putBytes: jest.fn().mockReturnValue(1),
  commit: jest.fn(),
  hash: jest.fn().mockReturnValue('a'.repeat(64)),
  close: jest.fn(),
};

jest.mock('@toon-protocol/memvid-node', () => ({
  PetBrain: {
    open: jest.fn().mockReturnValue(mockBrain),
    create: jest.fn().mockReturnValue(mockBrain),
  },
}));
```

**Notes:** PetBrain is a napi-rs native addon (darwin-arm64 binary). Must be fully mocked in unit tests. The mock supports configuring failure scenarios via `mockImplementationOnce()`.

---

## Required data-testid Attributes

N/A -- Backend-only project with no UI components.

---

## Implementation Checklist

### Test: parsePetInteractionRequest tests (5 tests)

**File:** `packages/pet-dvm/src/handler/parsePetInteractionRequest.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/pet-dvm/src/handler/types.ts` with `PetInteractionRequest` type (AC-8)
- [ ] Create `packages/pet-dvm/src/handler/parsePetInteractionRequest.ts` (AC-2)
- [ ] Implement tag extraction: `d` -> blobbiId, `action` -> actionType, `item` -> itemId, `cost` -> tokenCost
- [ ] Parse `sleeping` tag with default `false`
- [ ] Extract `ownerPubkey` from `event.pubkey` and `timestamp` from `event.created_at`
- [ ] Return `null` for missing required tags or non-numeric values
- [ ] Remove `it.skip` from tests
- [ ] Run test: `cd packages/pet-dvm && npx jest parsePetInteractionRequest`
- [ ] All 5 tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: PetStateManager tests (3 tests)

**File:** `packages/pet-dvm/src/handler/PetStateManager.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/pet-dvm/src/handler/PetStateManager.ts` (AC-3)
- [ ] Implement `PetStateManager` class with in-memory `Map<string, PetEngineState>`
- [ ] Implement `getOrCreate(blobbiId)` using `createGenesisState()` for unknown pets
- [ ] Implement `save(blobbiId, state)` to update Map
- [ ] Implement `get(blobbiId)` for read-only lookup
- [ ] Remove `it.skip` from tests
- [ ] Run test: `cd packages/pet-dvm && npx jest PetStateManager`
- [ ] All 3 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: ProofQueue tests (5 tests)

**File:** `packages/pet-dvm/src/handler/ProofQueue.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `ProofQueueEntry` type to `packages/pet-dvm/src/handler/types.ts` (AC-8)
- [ ] Create `packages/pet-dvm/src/handler/ProofQueue.ts` extending EventEmitter (AC-5)
- [ ] Implement `push(entry)` with batch-size check and `batch-ready` emission
- [ ] Implement `getBatch(batchSize)` returning null or entries array
- [ ] Implement `size()` getter
- [ ] Implement `drain()` to remove and return all entries
- [ ] Remove `it.skip` from tests
- [ ] Run test: `cd packages/pet-dvm && npx jest ProofQueue`
- [ ] All 5 tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: createPetDvmHandler tests (12 tests)

**File:** `packages/pet-dvm/src/handler/createPetDvmHandler.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `PetDvmConfig` type to `packages/pet-dvm/src/handler/types.ts` (AC-8)
- [ ] Create `packages/pet-dvm/src/handler/buildPetInteractionEvent.ts` (AC-6)
- [ ] Create `packages/pet-dvm/src/handler/createPetDvmHandler.ts` (AC-1, AC-4)
- [ ] Implement factory function returning `(ctx: HandlerContext) => Promise<HandlerResponse>`
- [ ] Implement request parsing via `parsePetInteractionRequest()` with F00 rejection
- [ ] Implement PetStateManager integration (getOrCreate, save)
- [ ] Implement PetGameEngine creation with INVALID_STAGE catch -> T00
- [ ] Implement `processInteraction()` with GameEngineError mapping to F00
- [ ] Implement PetBrain open/create with fallback and T00 on failure
- [ ] Wrap brain operations in try/finally for guaranteed `brain.close()`
- [ ] Implement brain ingest: `putBytes`, `commit`, `hash`
- [ ] Implement state update with brainHash mutation
- [ ] Implement evolution check via `engine.checkEvolution()`
- [ ] Implement ProofQueue push for each successful interaction
- [ ] Implement optimistic Kind 14919 event publish (fire-and-forget)
- [ ] Return `{ accept: true, data: base64(JSON(newState)) }`
- [ ] Add kind constants to `packages/core/src/constants.ts` (AC-7)
- [ ] Update `packages/pet-dvm/src/index.ts` with handler exports (AC-13)
- [ ] Remove `it.skip` from tests
- [ ] Run test: `cd packages/pet-dvm && npx jest createPetDvmHandler`
- [ ] All 12 tests pass (green phase)

**Estimated Effort:** 4 hours

---

## Running Tests

```bash
# Run all failing tests for this story
cd packages/pet-dvm && npx jest --testPathPattern='handler/'

# Run specific test file
cd packages/pet-dvm && npx jest parsePetInteractionRequest
cd packages/pet-dvm && npx jest PetStateManager
cd packages/pet-dvm && npx jest ProofQueue
cd packages/pet-dvm && npx jest createPetDvmHandler

# Run all pet-dvm tests (including existing engine tests)
cd packages/pet-dvm && pnpm test

# Run with verbose output
cd packages/pet-dvm && npx jest --verbose --testPathPattern='handler/'

# Run tests with coverage
cd packages/pet-dvm && npx jest --coverage --testPathPattern='handler/'
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 25 tests written with `it.skip()` (failing by design)
- Factory functions created with override patterns
- Mock requirements documented (PetBrain jest.mock)
- Implementation checklist created mapping tests to code tasks

**Verification:**

- All tests are skipped (will show as "skipped" in Jest output)
- When `it.skip()` is removed, tests fail with module-not-found errors
- After module stubs are created, tests fail with assertion errors

---

### GREEN Phase (DEV Team -- Next Steps)

**DEV Agent Responsibilities:**

1. **Start with types.ts** -- Create type definitions (unblocks all other modules)
2. **Build parsePetInteractionRequest.ts** -- Simplest module, no dependencies
3. **Build PetStateManager.ts** -- Simple Map wrapper, depends on types
4. **Build ProofQueue.ts** -- EventEmitter with array, depends on types
5. **Build buildPetInteractionEvent.ts** -- Event builder, depends on types
6. **Build createPetDvmHandler.ts** -- Integrates all above modules
7. **Add kind constants** to `packages/core/src/constants.ts`
8. **Update package exports** in `packages/pet-dvm/src/index.ts`
9. **Remove `it.skip()`** from each test file as its module is implemented
10. **Run tests** after each module to verify green

**Key Principles:**

- One module at a time (bottom-up dependency order)
- Remove `it.skip()` only when the target module exists
- Run tests frequently for immediate feedback
- Follow the Arweave DVM handler pattern exactly

---

### REFACTOR Phase (DEV Team -- After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all 25 tests pass (green phase complete)
2. Review handler code for error handling completeness
3. Verify PetBrain resource cleanup in all code paths
4. Ensure consistent error message formatting
5. Run `pnpm build` in pet-dvm and root to verify TypeScript compilation

---

## Next Steps

1. **Begin implementation** using implementation checklist as guide
2. **Work one module at a time** (types -> parser -> state manager -> queue -> event builder -> handler)
3. **Remove `it.skip()`** from tests as each module is completed
4. **Run tests** after each module to verify green
5. **When all 25 tests pass**, refactor code for quality
6. **Run full build**: `pnpm build` from root
7. **Update story status** to 'done' when complete

---

## Knowledge Base References Applied

This ATDD workflow consulted the following knowledge fragments:

- **data-factories.md** -- Factory patterns with `Partial<T>` overrides for test data generation
- **test-quality.md** -- Deterministic, isolated test design principles (Given-When-Then format)
- **test-levels-framework.md** -- Test level selection: all Unit level for backend pure functions

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/pet-dvm && npx jest --testPathPattern='handler/'`

**Expected Results:**

```
Test Suites: 4 skipped, 4 total
Tests:       25 skipped, 25 total
Snapshots:   0 total
Time:        ~2s
```

**Summary:**

- Total tests: 25
- Passing: 0 (expected -- all skipped)
- Skipped: 25 (expected -- TDD red phase)
- Status: RED phase verified

**Expected Failure Messages (when it.skip removed):**

- `Cannot find module './parsePetInteractionRequest'`
- `Cannot find module './PetStateManager'`
- `Cannot find module './ProofQueue'`
- `Cannot find module './createPetDvmHandler'`

---

## Notes

- PetBrain is platform-specific (darwin-arm64 napi-rs binary) and must always be mocked in unit tests
- The handler test file (428 lines) exceeds the 300-line guideline but this is acceptable given 12 tests + extensive setup helpers required for the complex handler flow
- ProofQueue does not consume batches in this story -- proof generation is deferred to Story 11-7
- Kind 14919 events are "optimistic" -- no proof or mina_tx tags until Story 11-7 proof pipeline
- Risk R-008 (proof queue loss on restart) is a known gap -- WAL persistence deferred to a later story

---

## Contact

**Questions or Issues?**

- Refer to `_bmad-output/implementation-artifacts/11-5-pet-dvm-handler.md` for full story context
- See `packages/sdk/src/arweave/arweave-dvm-handler.ts` for the canonical DVM handler pattern
- See `packages/pet-dvm/src/engine/PetGameEngine.test.ts` for existing test conventions

---

**Generated by BMad TEA Agent** - 2026-04-08

