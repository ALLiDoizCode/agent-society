# Traceability Matrix -- Story 11-6: Peer Enablement

**Date:** 2026-04-08
**Story:** `_bmad-output/implementation-artifacts/11-6-peer-enablement.md`
**Test Design:** `_bmad-output/test-artifacts/atdd-checklist-11-6.md`

---

## Test Files

| File | Test Count | Type |
|------|-----------|------|
| `docker/src/shared-pet-dvm.test.ts` | 11 | Unit (config parsing) |
| `docker/src/entrypoint-sdk-validation.test.ts` | 24 | Static analysis (file-content assertions) |
| **Total** | **35** | |

---

## AC-to-Test Mapping

### AC-1 -- Pet DVM env vars in shared.ts

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `shared-pet-dvm.test.ts` | sets petDvmEnabled to true when PET_DVM_ENABLED=true | `petDvmEnabled` parsing |
| `shared-pet-dvm.test.ts` | sets petDvmEnabled to false when PET_DVM_ENABLED is omitted (default disabled) | Default disabled (x402 pattern) |
| `shared-pet-dvm.test.ts` | sets petDvmEnabled to false when PET_DVM_ENABLED=false | Explicit false |
| `shared-pet-dvm.test.ts` | sets petDvmEnabled to false for non-standard truthy values | Strict `=== 'true'` check |
| `shared-pet-dvm.test.ts` | parses custom PET_BRAIN_STORAGE_PATH correctly | Custom path parsing |
| `shared-pet-dvm.test.ts` | defaults petBrainStoragePath to /data/pet-brains | Default path |
| `shared-pet-dvm.test.ts` | parses PET_PROOF_BATCH_SIZE=5 as number 5 | Numeric parsing |
| `shared-pet-dvm.test.ts` | defaults petProofBatchSize to 10 | Default batch size |
| `shared-pet-dvm.test.ts` | throws descriptive error when PET_PROOF_BATCH_SIZE=abc | Non-numeric rejection |
| `shared-pet-dvm.test.ts` | throws descriptive error when PET_PROOF_BATCH_SIZE=0 | Zero rejection (positive integer) |
| `shared-pet-dvm.test.ts` | throws descriptive error when PET_PROOF_BATCH_SIZE=-1 | Negative rejection |

**Coverage: FULL** -- All Config interface fields, parseConfig() parsing, defaults, and validation covered.

---

### AC-2 -- Pet DVM handler registration in entrypoint-sdk.ts

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | imports createPetDvmHandler from @toon-protocol/pet-dvm | Import present |
| `entrypoint-sdk-validation.test.ts` | imports PET_INTERACTION_REQUEST_KIND from @toon-protocol/core | Import present |
| `entrypoint-sdk-validation.test.ts` | registers handler on PET_INTERACTION_REQUEST_KIND (kind:5900) | `node.on()` registration |
| `entrypoint-sdk-validation.test.ts` | guards pet DVM registration with config.petDvmEnabled | Guard condition |
| `entrypoint-sdk-validation.test.ts` | includes pet DVM log message for kind:5900 | Log message |
| `entrypoint-sdk-validation.test.ts` | publishEvent stores in eventStore AND broadcasts to wsRelay (AC-2) | publishEvent callback wiring |

**Coverage: FULL** -- Import, guard, registration, logging, and publishEvent callback all verified via static analysis.

---

### AC-3 -- Service discovery integration

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | adds PET_INTERACTION_REQUEST_KIND to supportedKinds when pet DVM enabled | supportedKinds.push() |
| `entrypoint-sdk-validation.test.ts` | adds pet-dvm to capabilities when pet DVM enabled | capabilities array |
| `entrypoint-sdk-validation.test.ts` | adds petSkill descriptor to service discovery content | petSkill field exists |
| `entrypoint-sdk-validation.test.ts` | petSkill descriptor includes required fields: name, version, kinds, features (AC-3) | Descriptor structure |
| `entrypoint-sdk-validation.test.ts` | petSkill descriptor includes PET_INTERACTION_REQUEST_KIND in kinds array (AC-3) | kinds array content |

**Coverage: FULL** -- supportedKinds, capabilities, and petSkill descriptor (name, version, kinds, features) all verified.

---

### AC-4 -- Docker package dependency

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | contains @toon-protocol/pet-dvm workspace dependency | `workspace:*` in package.json |

**Coverage: FULL** -- Dependency presence verified.

---

### AC-5 -- Docker Compose env vars

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | contains PET_DVM_ENABLED environment variable | PET_DVM_ENABLED present |
| `entrypoint-sdk-validation.test.ts` | enables PET_DVM on peer1 | peer1 PET_DVM_ENABLED: true |
| `entrypoint-sdk-validation.test.ts` | contains PET_BRAIN_STORAGE_PATH for peer1 | peer1 PET_BRAIN_STORAGE_PATH |
| `entrypoint-sdk-validation.test.ts` | contains PET_PROOF_BATCH_SIZE for peer1 | peer1 PET_PROOF_BATCH_SIZE |
| `entrypoint-sdk-validation.test.ts` | explicitly disables PET_DVM on peer2 (AC-5) | peer2 PET_DVM_ENABLED: false |

**Coverage: FULL** -- All three env vars on peer1 and explicit opt-out on peer2 verified.

---

### AC-6 -- Brain storage directory creation

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | creates brain storage directory with mkdirSync | mkdirSync + petBrainStoragePath present |
| `entrypoint-sdk-validation.test.ts` | creates brain storage directory with recursive: true (AC-6) | `mkdirSync(config.petBrainStoragePath, { recursive: true })` |
| `entrypoint-sdk-validation.test.ts` | imports mkdirSync from node:fs (AC-6) | Import statement |

**Coverage: FULL** -- mkdirSync import, call with recursive option, and path argument all verified.

---

### AC-7 -- Health endpoint pet DVM status

| Test File | Test Name | Verifies |
|-----------|-----------|----------|
| `entrypoint-sdk-validation.test.ts` | includes petDvm in health response when enabled | petDvm field + petDvmEnabled reference |
| `entrypoint-sdk-validation.test.ts` | health petDvm block includes brainStoragePath field (AC-7) | brainStoragePath in health |
| `entrypoint-sdk-validation.test.ts` | health petDvm block includes proofBatchSize field (AC-7) | proofBatchSize in health |
| `entrypoint-sdk-validation.test.ts` | health petDvm uses conditional spread pattern like tee (AC-7) | `...(config.petDvmEnabled &&` pattern |

**Coverage: FULL** -- Conditional inclusion, all three fields (enabled, brainStoragePath, proofBatchSize), and spread pattern verified.

---

### AC-8 -- Unit tests for shared.ts pet DVM config parsing

AC-8 is a meta-criterion requiring tests to exist. The 11 tests in `shared-pet-dvm.test.ts` (mapped under AC-1 above) satisfy this criterion. All 7 test scenarios specified in the AC are covered:

| AC-8 Required Scenario | Test |
|------------------------|------|
| PET_DVM_ENABLED=true sets petDvmEnabled: true | sets petDvmEnabled to true when PET_DVM_ENABLED=true |
| PET_DVM_ENABLED omitted sets petDvmEnabled: false | sets petDvmEnabled to false when PET_DVM_ENABLED is omitted |
| PET_BRAIN_STORAGE_PATH custom value | parses custom PET_BRAIN_STORAGE_PATH correctly |
| PET_BRAIN_STORAGE_PATH omitted defaults | defaults petBrainStoragePath to /data/pet-brains |
| PET_PROOF_BATCH_SIZE=5 parsed as 5 | parses PET_PROOF_BATCH_SIZE=5 as number 5 |
| PET_PROOF_BATCH_SIZE omitted defaults to 10 | defaults petProofBatchSize to 10 |
| PET_PROOF_BATCH_SIZE=abc throws error | throws descriptive error when PET_PROOF_BATCH_SIZE=abc |

**Coverage: FULL** -- All 7 required scenarios present, plus 4 additional edge cases (explicit false, non-standard truthy, zero, negative).

---

### AC-9 -- Static analysis tests

AC-9 is a meta-criterion requiring static analysis tests to exist. The 24 tests in `entrypoint-sdk-validation.test.ts` satisfy this criterion. All 5 required checks:

| AC-9 Required Check | Test(s) |
|---------------------|---------|
| entrypoint imports createPetDvmHandler from @toon-protocol/pet-dvm | imports createPetDvmHandler from @toon-protocol/pet-dvm |
| entrypoint imports PET_INTERACTION_REQUEST_KIND from @toon-protocol/core | imports PET_INTERACTION_REQUEST_KIND from @toon-protocol/core |
| entrypoint contains node.on(PET_INTERACTION_REQUEST_KIND or node.on(5900 | registers handler on PET_INTERACTION_REQUEST_KIND (kind:5900) |
| docker-compose-sdk-e2e.yml contains PET_DVM_ENABLED | contains PET_DVM_ENABLED environment variable |
| docker/package.json contains @toon-protocol/pet-dvm | contains @toon-protocol/pet-dvm workspace dependency |

**Coverage: FULL** -- All 5 required checks present, plus 19 additional integration verification tests.

---

### AC-10 -- Build verification

AC-10 is a process criterion (build + test + lint pass). It is not directly testable via unit/static tests. Verified by the dev agent record in the story file:

- `pnpm build` in docker/ compiles cleanly (Task 8.1)
- `pnpm build` in root monorepo compiles cleanly (Task 8.2)
- `pnpm test` in docker/ passes all 93 tests (Task 8.3)
- `pnpm lint` in docker/ passes with 0 errors (Task 8.4)

**Coverage: PROCESS** -- Verified via build execution, not automated test assertion.

---

## Coverage Summary

| AC | Description | Coverage | Test Count |
|----|-------------|----------|------------|
| AC-1 | Pet DVM env vars in shared.ts | FULL | 11 |
| AC-2 | Handler registration in entrypoint-sdk.ts | FULL | 6 |
| AC-3 | Service discovery integration | FULL | 5 |
| AC-4 | Docker package dependency | FULL | 1 |
| AC-5 | Docker Compose env vars | FULL | 5 |
| AC-6 | Brain storage directory creation | FULL | 3 |
| AC-7 | Health endpoint pet DVM status | FULL | 4 |
| AC-8 | Unit tests (meta-criterion) | FULL | 11 (same as AC-1) |
| AC-9 | Static analysis tests (meta-criterion) | FULL | 24 (overlaps AC-2 through AC-7) |
| AC-10 | Build verification (process) | PROCESS | N/A |

**Unique test count:** 35 (11 unit + 24 static analysis)
**All functional ACs covered:** Yes (AC-1 through AC-9)
**Process ACs verified:** Yes (AC-10 via build execution)

---

## Quality Gate Decision

**PASS** -- All 10 acceptance criteria have adequate test coverage. No uncovered ACs.

- 11 unit tests verify config parsing behavior (AC-1, AC-8)
- 24 static analysis tests verify integration wiring (AC-2 through AC-7, AC-9)
- Build verification confirmed via process execution (AC-10)
- Test isolation verified (env var cleanup in beforeEach/afterEach)
- No runtime dependencies required for test execution (static analysis reads source files directly)

---

## Related Artifacts

- **Story:** `_bmad-output/implementation-artifacts/11-6-peer-enablement.md`
- **ATDD Checklist:** `_bmad-output/test-artifacts/atdd-checklist-11-6.md`
- **NFR Assessment:** `_bmad-output/test-artifacts/nfr-assessment-11-6.md`
- **Test Design (Epic):** `_bmad-output/planning-artifacts/test-design-epic-11.md`
- **Unit Tests:** `docker/src/shared-pet-dvm.test.ts`
- **Static Analysis Tests:** `docker/src/entrypoint-sdk-validation.test.ts`
- **Config Test Isolation:** `docker/src/shared.test.ts` (env key cleanup includes PET_DVM_* keys)

---

**Generated by BMad TEA Agent** - 2026-04-08
