---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-08'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-6-peer-enablement.md'
  - '_bmad/tea/testarch/knowledge/data-factories.md'
  - '_bmad/tea/testarch/knowledge/test-quality.md'
  - '_bmad/tea/testarch/knowledge/test-levels-framework.md'
  - 'docker/src/shared.ts'
  - 'docker/src/shared.test.ts'
  - 'docker/src/entrypoint-sdk.ts'
  - 'docker/package.json'
  - 'docker/vitest.config.ts'
  - 'docker-compose-sdk-e2e.yml'
  - 'packages/pet-dvm/src/index.ts'
  - 'packages/pet-dvm/src/handler/types.ts'
  - 'packages/core/src/constants.ts'
---

# ATDD Checklist - Epic 11, Story 6: Peer Enablement

**Date:** 2026-04-08
**Author:** Jonathan
**Primary Test Level:** Unit + Static Analysis

---

## Story Summary

Wire the Pet DVM handler into the Docker peer entrypoint so that TOON infrastructure peers can process Kind 5900 pet interaction requests via ILP without operator-level code changes. This story adds config parsing, handler registration, service discovery, health endpoint status, Docker Compose env vars, and validation tests.

**As a** TOON Protocol operator
**I want** the Pet DVM handler registered in the Docker peer entrypoint
**So that** peers can process Kind 5900 pet interaction requests via ILP without code changes at the operator level.

---

## Acceptance Criteria

1. **AC-1** -- Pet DVM env vars in shared.ts: `petDvmEnabled`, `petBrainStoragePath`, `petProofBatchSize` added to Config interface and parseConfig()
2. **AC-2** -- Pet DVM handler registration in entrypoint-sdk.ts following Arweave DVM pattern exactly
3. **AC-3** -- Service discovery integration: PET_INTERACTION_REQUEST_KIND in supportedKinds, 'pet-dvm' in capabilities, petSkill descriptor
4. **AC-4** -- Docker package dependency: `@toon-protocol/pet-dvm: "workspace:*"` in docker/package.json
5. **AC-5** -- Docker Compose env vars: PET_DVM_ENABLED, PET_BRAIN_STORAGE_PATH, PET_PROOF_BATCH_SIZE on peer1; PET_DVM_ENABLED=false on peer2
6. **AC-6** -- Brain storage directory creation via mkdirSync before handler processes first request
7. **AC-7** -- Health endpoint pet DVM status: conditional petDvm field in /health response
8. **AC-8** -- Unit tests for shared.ts pet DVM config parsing (10 tests)
9. **AC-9** -- Static analysis tests for entrypoint integration points (15 tests)
10. **AC-10** -- Build verification: pnpm build + pnpm test + pnpm lint pass

---

## Test Strategy

### Generation Mode

**AI Generation** -- Backend-only project (Node.js/TypeScript/Vitest). No browser recording needed.

### Test Level Mapping

Two test levels for this wiring/integration story:

1. **Unit tests** (vitest) for `shared.ts` config parsing -- AC-1, AC-8
2. **Static analysis tests** (vitest, file-content assertions) for entrypoint wiring -- AC-2 through AC-7, AC-9

No E2E or API tests -- this story is infrastructure wiring, not user-facing behavior. E2E validation is deferred to Story 11-7.

| AC | Test Scenario | Level | Priority | Red Phase Failure Reason |
|----|---------------|-------|----------|--------------------------|
| AC-1, AC-8 | PET_DVM_ENABLED=true sets petDvmEnabled: true | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_DVM_ENABLED omitted defaults to false | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_DVM_ENABLED=false sets petDvmEnabled: false | Unit | P1 | Config field does not exist |
| AC-1, AC-8 | Custom PET_BRAIN_STORAGE_PATH parsed correctly | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_BRAIN_STORAGE_PATH omitted defaults to /data/pet-brains | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_PROOF_BATCH_SIZE=5 parsed as number 5 | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_PROOF_BATCH_SIZE omitted defaults to 10 | Unit | P0 | Config field does not exist |
| AC-1, AC-8 | PET_PROOF_BATCH_SIZE=abc throws descriptive error | Unit | P0 | Validation logic does not exist |
| AC-1, AC-8 | PET_PROOF_BATCH_SIZE=0 throws descriptive error | Unit | P1 | Validation logic does not exist |
| AC-1, AC-8 | PET_PROOF_BATCH_SIZE=-1 throws descriptive error | Unit | P1 | Validation logic does not exist |
| AC-2, AC-9 | entrypoint imports createPetDvmHandler from @toon-protocol/pet-dvm | Static | P0 | Import not present |
| AC-2, AC-9 | entrypoint imports PET_INTERACTION_REQUEST_KIND from @toon-protocol/core | Static | P0 | Import not present |
| AC-2, AC-9 | entrypoint registers handler on PET_INTERACTION_REQUEST_KIND | Static | P0 | Registration not present |
| AC-2, AC-9 | entrypoint guards registration with config.petDvmEnabled | Static | P0 | Guard not present |
| AC-6, AC-9 | entrypoint creates brain storage directory with mkdirSync | Static | P0 | mkdirSync call not present |
| AC-2, AC-9 | entrypoint logs Pet DVM handler registration | Static | P1 | Log message not present |
| AC-5, AC-9 | docker-compose contains PET_DVM_ENABLED | Static | P0 | Env var not present |
| AC-5, AC-9 | docker-compose enables PET_DVM on peer1 | Static | P0 | Env var not present |
| AC-5, AC-9 | docker-compose contains PET_BRAIN_STORAGE_PATH for peer1 | Static | P1 | Env var not present |
| AC-5, AC-9 | docker-compose contains PET_PROOF_BATCH_SIZE for peer1 | Static | P1 | Env var not present |
| AC-4, AC-9 | docker/package.json contains @toon-protocol/pet-dvm | Static | P0 | Dependency not present |
| AC-3, AC-9 | entrypoint adds PET_INTERACTION_REQUEST_KIND to supportedKinds | Static | P0 | Service discovery not updated |
| AC-3, AC-9 | entrypoint adds 'pet-dvm' to capabilities | Static | P0 | Capability not present |
| AC-3, AC-9 | entrypoint adds petSkill descriptor | Static | P1 | Descriptor not present |
| AC-7, AC-9 | entrypoint includes petDvm in health response | Static | P1 | Health response not updated |

### Test Count Summary

| Test File | Count | Priority Breakdown |
|-----------|-------|-------------------|
| shared-pet-dvm.test.ts | 10 | 7xP0, 3xP1 |
| entrypoint-sdk-validation.test.ts | 15 | 10xP0, 5xP1 |
| **Total** | **25** | **17xP0, 8xP1** |

### Mock Requirements

| Dependency | Mock Strategy |
|------------|--------------|
| `nostr-tools/pure` (getPublicKey) | `vi.mock` -- returns deterministic pubkey (existing pattern from shared.test.ts) |
| File system (readFileSync) | NOT mocked -- static analysis tests read real source files from disk |

### Red Phase Confirmation

All 25 tests verified to fail in RED phase. Unit tests fail because `petDvmEnabled`, `petBrainStoragePath`, and `petProofBatchSize` do not exist on the `Config` interface or in `parseConfig()`. Static analysis tests fail because the entrypoint, docker-compose, and package.json have not been updated with pet DVM integration points.

---

## Failing Tests Created (RED Phase)

### Unit Tests -- shared.ts Pet DVM Config Parsing (10 tests)

**File:** `docker/src/shared-pet-dvm.test.ts` (170 lines)

- **Test:** sets petDvmEnabled to true when PET_DVM_ENABLED=true
  - **Status:** RED - Config field `petDvmEnabled` does not exist
  - **Verifies:** AC-1, AC-8 -- PET_DVM_ENABLED=true parsing

- **Test:** sets petDvmEnabled to false when PET_DVM_ENABLED is omitted (default disabled)
  - **Status:** RED - Config field `petDvmEnabled` does not exist
  - **Verifies:** AC-1, AC-8 -- Default disabled (x402Enabled pattern)

- **Test:** sets petDvmEnabled to false when PET_DVM_ENABLED=false
  - **Status:** RED - Config field `petDvmEnabled` does not exist
  - **Verifies:** AC-1, AC-8 -- Explicit false

- **Test:** parses custom PET_BRAIN_STORAGE_PATH correctly
  - **Status:** RED - Config field `petBrainStoragePath` does not exist
  - **Verifies:** AC-1, AC-8 -- Custom path parsing

- **Test:** defaults petBrainStoragePath to /data/pet-brains
  - **Status:** RED - Config field `petBrainStoragePath` does not exist
  - **Verifies:** AC-1, AC-8 -- Default path

- **Test:** parses PET_PROOF_BATCH_SIZE=5 as number 5
  - **Status:** RED - Config field `petProofBatchSize` does not exist
  - **Verifies:** AC-1, AC-8 -- Numeric parsing

- **Test:** defaults petProofBatchSize to 10
  - **Status:** RED - Config field `petProofBatchSize` does not exist
  - **Verifies:** AC-1, AC-8 -- Default batch size

- **Test:** throws descriptive error when PET_PROOF_BATCH_SIZE=abc
  - **Status:** RED - Validation logic does not exist
  - **Verifies:** AC-1, AC-8 -- Non-numeric rejection

- **Test:** throws descriptive error when PET_PROOF_BATCH_SIZE=0
  - **Status:** RED - Validation logic does not exist
  - **Verifies:** AC-1, AC-8 -- Zero rejection

- **Test:** throws descriptive error when PET_PROOF_BATCH_SIZE=-1
  - **Status:** RED - Validation logic does not exist
  - **Verifies:** AC-1, AC-8 -- Negative rejection

### Static Analysis Tests -- Entrypoint Integration (15 tests)

**File:** `docker/src/entrypoint-sdk-validation.test.ts` (155 lines)

- **Test:** imports createPetDvmHandler from @toon-protocol/pet-dvm
  - **Status:** RED - Import not present in entrypoint
  - **Verifies:** AC-2, AC-9

- **Test:** imports PET_INTERACTION_REQUEST_KIND from @toon-protocol/core
  - **Status:** RED - Import not present in entrypoint
  - **Verifies:** AC-2, AC-9

- **Test:** registers handler on PET_INTERACTION_REQUEST_KIND
  - **Status:** RED - Registration not present
  - **Verifies:** AC-2, AC-9

- **Test:** guards pet DVM registration with config.petDvmEnabled
  - **Status:** RED - Guard condition not present
  - **Verifies:** AC-2, AC-9

- **Test:** creates brain storage directory with mkdirSync
  - **Status:** RED - mkdirSync call not present
  - **Verifies:** AC-6, AC-9

- **Test:** includes pet DVM log message for kind:5900
  - **Status:** RED - Log message not present
  - **Verifies:** AC-2, AC-9

- **Test:** contains PET_DVM_ENABLED environment variable (docker-compose)
  - **Status:** RED - Env var not present
  - **Verifies:** AC-5, AC-9

- **Test:** enables PET_DVM on peer1 (docker-compose)
  - **Status:** RED - Env var not present
  - **Verifies:** AC-5, AC-9

- **Test:** contains PET_BRAIN_STORAGE_PATH for peer1 (docker-compose)
  - **Status:** RED - Env var not present
  - **Verifies:** AC-5, AC-9

- **Test:** contains PET_PROOF_BATCH_SIZE for peer1 (docker-compose)
  - **Status:** RED - Env var not present
  - **Verifies:** AC-5, AC-9

- **Test:** contains @toon-protocol/pet-dvm workspace dependency (package.json)
  - **Status:** RED - Dependency not present
  - **Verifies:** AC-4, AC-9

- **Test:** adds PET_INTERACTION_REQUEST_KIND to supportedKinds
  - **Status:** RED - Service discovery not updated
  - **Verifies:** AC-3, AC-9

- **Test:** adds 'pet-dvm' to capabilities
  - **Status:** RED - Capability not present
  - **Verifies:** AC-3, AC-9

- **Test:** adds petSkill descriptor to service discovery content
  - **Status:** RED - Descriptor not present
  - **Verifies:** AC-3, AC-9

- **Test:** includes petDvm in health response when enabled
  - **Status:** RED - Health response not updated
  - **Verifies:** AC-7, AC-9

---

## Data Factories Created

### Config Factory

**File:** Inline in `docker/src/shared-pet-dvm.test.ts`

**Pattern:** `requiredEnv` base object + `Object.assign(process.env, requiredEnv, overrides)` -- matches the established pattern in `docker/src/shared.test.ts`.

**Rationale:** Factories are colocated in the test file following the existing shared.test.ts convention. Uses `Object.assign` + env var manipulation (not factory functions) because config parsing reads from `process.env` directly.

---

## Fixtures Created

N/A -- Backend vitest project. No Playwright/Cypress fixtures needed. Test setup uses `beforeEach`/`afterEach` hooks with env var save/restore pattern matching the existing `shared.test.ts`.

---

## Mock Requirements

### nostr-tools/pure Mock

**Module:** `nostr-tools/pure`

**Mock Setup:**

```typescript
vi.mock('nostr-tools/pure', () => ({
  getPublicKey: vi.fn(() => 'a'.repeat(64)),
}));
```

**Notes:** Required to avoid native crypto dependency in CI. Existing pattern from `shared.test.ts`. Only needed in unit tests (not static analysis tests).

---

## Required data-testid Attributes

N/A -- Backend-only project with no UI components.

---

## Implementation Checklist

### Test: shared.ts Pet DVM config parsing (10 tests)

**File:** `docker/src/shared-pet-dvm.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `petDvmEnabled: boolean` to `Config` interface in `docker/src/shared.ts`
- [ ] Add `petBrainStoragePath: string` to `Config` interface
- [ ] Add `petProofBatchSize: number` to `Config` interface
- [ ] Add `PET_DVM_ENABLED` parsing: `const petDvmEnabled = env['PET_DVM_ENABLED'] === 'true'` (x402 pattern, NOT ardrive pattern)
- [ ] Add `PET_BRAIN_STORAGE_PATH` parsing: `const petBrainStoragePath = env['PET_BRAIN_STORAGE_PATH'] || '/data/pet-brains'`
- [ ] Add `PET_PROOF_BATCH_SIZE` parsing with `parseInt` + validation (positive integer check, throw on invalid)
- [ ] Add all three fields to the `return` object in `parseConfig()`
- [ ] Add `PET_DVM_ENABLED`, `PET_BRAIN_STORAGE_PATH`, `PET_PROOF_BATCH_SIZE` to `envKeysToClean` in shared.test.ts if needed
- [ ] Run test: `cd docker && npx vitest run src/shared-pet-dvm.test.ts`
- [ ] All 10 tests pass (green phase)

**Estimated Effort:** 1 hour

---

### Test: entrypoint-sdk.ts Pet DVM integration (6 tests)

**File:** `docker/src/entrypoint-sdk-validation.test.ts`

**Tasks to make these tests pass:**

- [ ] Add import: `import { createPetDvmHandler } from '@toon-protocol/pet-dvm'`
- [ ] Add import: `PET_INTERACTION_REQUEST_KIND` to existing `@toon-protocol/core` import
- [ ] Add import: `import { mkdirSync } from 'node:fs'`
- [ ] Add guarded handler registration block after Arweave DVM block (lines 313-323 pattern)
- [ ] Add `mkdirSync(config.petBrainStoragePath, { recursive: true })` inside guard
- [ ] Add `createPetDvmHandler({ brainStoragePath, proofBatchSize, publishEvent })` call
- [ ] Add `node.on(PET_INTERACTION_REQUEST_KIND, petDvmHandler)` registration
- [ ] Add `console.log('[Setup] Pet DVM handler registered for kind:5900')` log
- [ ] Run test: `cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts`
- [ ] Entrypoint integration tests pass (green phase)

**Estimated Effort:** 1.5 hours

---

### Test: docker-compose env vars (4 tests)

**File:** `docker/src/entrypoint-sdk-validation.test.ts`

**Tasks to make these tests pass:**

- [ ] Add to peer1 environment in `docker-compose-sdk-e2e.yml`:
  - `PET_DVM_ENABLED: 'true'`
  - `PET_BRAIN_STORAGE_PATH: /data/pet-brains`
  - `PET_PROOF_BATCH_SIZE: '5'`
- [ ] Add to peer2 environment: `PET_DVM_ENABLED: 'false'`
- [ ] Add comment: `# Pet DVM: enabled on peer1 (pet interaction provider)`
- [ ] Run test: `cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts`
- [ ] Docker compose tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: docker/package.json dependency (1 test)

**File:** `docker/src/entrypoint-sdk-validation.test.ts`

**Tasks to make this test pass:**

- [ ] Add `"@toon-protocol/pet-dvm": "workspace:*"` to dependencies in `docker/package.json`
- [ ] Run `pnpm install` to update lockfile
- [ ] Run test: `cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts`
- [ ] Dependency test passes (green phase)

**Estimated Effort:** 0.25 hours

---

### Test: service discovery Pet DVM (3 tests)

**File:** `docker/src/entrypoint-sdk-validation.test.ts`

**Tasks to make these tests pass:**

- [ ] In service discovery block, add `if (config.petDvmEnabled)` guard:
  - Push `PET_INTERACTION_REQUEST_KIND` to `supportedKinds`
  - Push `'pet-dvm'` to `capabilities`
  - Add `petSkill` descriptor to `serviceDiscoveryContent`
- [ ] Run test: `cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts`
- [ ] Service discovery tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Test: health endpoint Pet DVM (1 test)

**File:** `docker/src/entrypoint-sdk-validation.test.ts`

**Tasks to make this test pass:**

- [ ] Add conditional `petDvm` field to health response in `/health` handler:
  - `...(config.petDvmEnabled && { petDvm: { enabled: true, brainStoragePath: config.petBrainStoragePath, proofBatchSize: config.petProofBatchSize } })`
- [ ] Run test: `cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts`
- [ ] Health endpoint test passes (green phase)

**Estimated Effort:** 0.25 hours

---

## Running Tests

```bash
# Run all failing tests for this story
cd docker && npx vitest run src/shared-pet-dvm.test.ts src/entrypoint-sdk-validation.test.ts

# Run config parsing tests only
cd docker && npx vitest run src/shared-pet-dvm.test.ts

# Run static analysis tests only
cd docker && npx vitest run src/entrypoint-sdk-validation.test.ts

# Run all docker tests (existing + new)
cd docker && pnpm test

# Run with verbose output
cd docker && npx vitest run --reporter=verbose src/shared-pet-dvm.test.ts src/entrypoint-sdk-validation.test.ts
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 25 tests written and failing (verified by test run)
- Factory patterns follow existing shared.test.ts conventions
- Mock requirements documented (nostr-tools/pure vi.mock)
- Implementation checklist created mapping tests to code tasks

**Verification:**

- All 25 tests fail as expected
- Unit tests fail with TypeScript property access errors (fields not on Config type)
- Static analysis tests fail with assertion errors (strings not found in source)
- Failures are due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team -- Next Steps)

**DEV Agent Responsibilities:**

1. **Add pet-dvm dependency** to `docker/package.json` + `pnpm install`
2. **Update shared.ts** -- Add Config fields + parseConfig() parsing + validation
3. **Update entrypoint-sdk.ts** -- Import, register handler, service discovery, health
4. **Update docker-compose-sdk-e2e.yml** -- Add Pet DVM env vars to peer1/peer2
5. **Run tests** after each change to verify green
6. **Run full build**: `pnpm build` from root

**Key Principles:**

- Follow the Arweave DVM pattern exactly for handler registration
- Follow the x402Enabled pattern for config parsing (NOT ardriveEnabled pattern)
- Use `petSkill` field (separate from existing `skill`) for backward compatibility
- Test frequently for immediate feedback

---

### REFACTOR Phase (DEV Team -- After All Tests Pass)

**DEV Agent Responsibilities:**

1. Verify all 25 tests pass (green phase complete)
2. Run existing tests: `cd docker && pnpm test` (regression)
3. Run `pnpm build` in docker/ and root -- TypeScript compiles cleanly
4. Run `pnpm lint` in docker/ -- no lint errors

---

## Next Steps

1. **Begin implementation** using implementation checklist as guide
2. **Start with package.json** dependency (unblocks TypeScript imports)
3. **Then shared.ts** config parsing (unblocks entrypoint changes)
4. **Then entrypoint-sdk.ts** handler registration, service discovery, health
5. **Then docker-compose** env var updates
6. **Run tests** after each file to verify green
7. **When all 25 tests pass**, run full build verification (AC-10)
8. **Update story status** to 'done' when complete

---

## Knowledge Base References Applied

This ATDD workflow consulted the following knowledge fragments:

- **data-factories.md** -- Factory patterns with env var override approach matching existing shared.test.ts
- **test-quality.md** -- Deterministic, isolated test design principles (Given-When-Then format)
- **test-levels-framework.md** -- Test level selection: Unit for config parsing, Static Analysis for wiring validation

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd docker && npx vitest run src/shared-pet-dvm.test.ts src/entrypoint-sdk-validation.test.ts`

**Results:**

```
Test Files  2 failed (2)
     Tests  25 failed (25)
  Start at  13:14:54
  Duration  370ms (transform 122ms, setup 0ms, collect 182ms, tests 25ms, environment 0ms, prepare 147ms)
```

**Summary:**

- Total tests: 25
- Passing: 0 (expected)
- Failing: 25 (expected)
- Status: RED phase verified

**Expected Failure Messages:**

- Unit tests: `Property 'petDvmEnabled' does not exist` / `expected [Function] to throw an error`
- Static analysis tests: `expected '...' to contain '...'` (strings not found in source files)

---

## Notes

- Static analysis tests use `readFileSync` to read real source files -- no mocking of the filesystem. This means tests break if files are moved/renamed, which is intentional (validates integration points).
- The `import.meta.dirname` approach for path resolution works with vitest's ESM environment.
- Config parsing tests are in a separate file (`shared-pet-dvm.test.ts`) rather than appended to `shared.test.ts` to keep concerns isolated and avoid merge conflicts with other stories.
- The `envKeysToClean` pattern in shared-pet-dvm.test.ts is minimal (only pet DVM keys + required keys) to avoid interference with other env var tests.
- Risk: Static analysis tests are pattern-matching on source code strings. If the implementation uses different formatting or variable names than expected, tests may need adjustment. This is acceptable for a wiring story where the exact integration pattern is specified in the story's Dev Notes.

---

## Contact

**Questions or Issues?**

- Refer to `_bmad-output/implementation-artifacts/11-6-peer-enablement.md` for full story context
- See `docker/src/shared.test.ts` for existing config parsing test conventions
- See `docker/src/entrypoint-sdk.ts` lines 313-323 for the Arweave DVM handler pattern to follow

---

**Generated by BMad TEA Agent** - 2026-04-08
