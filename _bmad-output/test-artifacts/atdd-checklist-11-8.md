---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-08'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-8-pet-token-on-mina.md'
  - 'packages/pet-circuit/src/PetZkApp.ts'
  - 'packages/pet-circuit/src/PetZkApp.test.ts'
  - 'packages/pet-circuit/src/PetZkApp.integration.test.ts'
  - 'packages/pet-circuit/src/structs.ts'
  - 'packages/pet-circuit/src/constants.ts'
  - 'packages/pet-circuit/src/index.ts'
  - 'packages/pet-circuit/package.json'
---

# ATDD Checklist - Epic 11, Story 8: PET Token on Mina

**Date:** 2026-04-08
**Author:** Jonathan
**Primary Test Level:** Unit + Integration (backend ZK circuit -- no UI/API)

---

## Story Summary

Create a PET custom token on Mina using o1js `TokenContract` that the PetZkApp can burn during proof settlement, enforcing an on-chain economic cost for every pet interaction with non-zero tokenCost.

**As a** TOON Protocol developer
**I want** a PET custom token deployed on Mina that PetZkApp can burn during proof settlement
**So that** every pet interaction has an on-chain economic cost enforced by the ZK circuit

---

## Acceptance Criteria

1. **AC-1** -- PetToken contract exists: `PetToken.ts` extending `TokenContract` with init, approveBase, mint, burn
2. **AC-2** -- PetZkApp integrates token burn: `applyProof()` accepts `petTokenAddress` and burns `totalSpent` delta
3. **AC-3** -- Unit tests for PetToken: deploy, mint, transfer, burn, zero-burn, unauthorized mint rejection
4. **AC-4** -- Integration test for PetZkApp + PetToken: full lifecycle deploy-mint-interact-burn
5. **AC-5** -- Exports and build: PetToken exported from index.ts, build/lint/test pass

---

## Stack Detection

**Detected Stack:** `backend`
- Project type: o1js ZK circuit smart contracts (Mina Protocol)
- Test framework: Jest (ts-jest)
- No frontend/UI, no API endpoints, no browser testing
- Test levels: Unit tests (proofsEnabled: false) and Integration tests

## Generation Mode

**Mode:** AI Generation (backend project -- no browser recording needed)
- Acceptance criteria are clear and detailed
- All tests are smart contract / ZK circuit tests using Mina LocalBlockchain

---

## Test Strategy

### Test Level Mapping

| AC | Test Level | Priority | Rationale |
|----|-----------|----------|-----------|
| AC-1 | Unit | P0 | Core contract: deploy, init, token symbol, zero circulation |
| AC-3 (mint) | Unit | P0 | Token minting with admin signature, balance + circulation tracking |
| AC-3 (transfer) | Unit | P0 | Net-zero forest transfer between accounts |
| AC-3 (burn) | Unit | P0 | Token burn with balance + circulation decrement |
| AC-3 (zero-burn) | Unit | P0 | Validates unconditional burn path for AC-2 |
| AC-3 (unauthorized) | Unit | P0 | Reject mint with wrong admin signature |
| AC-2 + AC-4 (shop item burn) | Integration | P0 | Full lifecycle: deploy both -> mint -> interact -> applyProof -> verify burn |
| AC-4 (base action zero-burn) | Integration | P0 | Zero tokenCost path through modified applyProof |
| AC-4 (insufficient balance) | Integration | P0 | TX revert when operator lacks PET tokens for burn |

### Red Phase Design

All tests are designed to fail before implementation because:
1. `PetToken.ts` does not exist yet -- import fails with `Cannot find module './PetToken'`
2. `PetZkApp.applyProof()` does not yet accept `petTokenAddress` -- `Expected 3 arguments, but got 4`

---

## Failing Tests Created (RED Phase)

### Unit Tests (6 tests)

**File:** `packages/pet-circuit/src/PetToken.test.ts`

- **Test:** `[P0] AC-3: should deploy PetToken contract with token symbol PET and zero circulation`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** PetToken deploys correctly, token symbol is 'PET', totalAmountInCirculation starts at zero

- **Test:** `[P0] AC-3: should mint tokens to receiver with valid admin signature and update circulation`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Admin-signed mint adds tokens to receiver, updates totalAmountInCirculation

- **Test:** `[P0] AC-3: should transfer tokens between accounts using net-zero balance change forest`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Transfer via approveBase with checkZeroBalanceChange, sender/receiver balances correct

- **Test:** `[P0] AC-3: should burn tokens from account and decrement circulation`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Burn decrements account balance and totalAmountInCirculation

- **Test:** `[P0] AC-3: should burn zero tokens without error (validates unconditional burn path in AC-2)`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Zero-amount burn is a valid no-op (critical for unconditional burn in applyProof)

- **Test:** `[P0] AC-3: should reject mint with wrong admin signature`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Unauthorized minting (wrong private key) is rejected

### Integration Tests (4 tests)

**File:** `packages/pet-circuit/src/PetToken.integration.test.ts`

- **Test:** `[P0] AC-4: should deploy PetToken and PetZkApp contracts`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Both contracts deploy correctly on LocalBlockchain

- **Test:** `[P0] AC-4: should mint PET tokens to operator token account`
  - **Status:** RED - Cannot find module './PetToken'
  - **Verifies:** Operator receives PET tokens with funded token account

- **Test:** `[P0] AC-4: should burn PET tokens from operator during applyProof with shop item interaction`
  - **Status:** RED - Cannot find module './PetToken' + Expected 3 arguments, but got 4
  - **Verifies:** Full lifecycle with med_bandage (Egg-compatible, tokenCost=20): deploy -> mint -> interact -> applyProof with burn -> verify balance + circulation decremented

- **Test:** `[P0] AC-4: should execute zero-amount burn without error for base action (tokenCost=0)`
  - **Status:** RED - Cannot find module './PetToken' + Expected 3 arguments, but got 4
  - **Verifies:** Base CHECK action (tokenCost=0) passes through modified applyProof without changing balances

- **Test:** `[P0] AC-4: should revert when operator has insufficient PET balance for burn`
  - **Status:** RED - Cannot find module './PetToken' + Expected 3 arguments, but got 4
  - **Verifies:** TX reverts atomically when operator cannot cover the burn amount

---

## Data Factories Created

N/A -- This is a ZK circuit project. Test data is constructed inline using o1js primitives (Field, UInt64, PrivateKey.random(), etc.) following existing test patterns in PetZkApp.test.ts. No faker-based factories needed.

---

## Fixtures Created

N/A -- Tests use Jest with shared `beforeAll` setup following existing patterns in `PetZkApp.test.ts`. o1js LocalBlockchain provides the test fixture infrastructure (test accounts, local chain state). No Playwright fixtures applicable.

---

## Mock Requirements

N/A -- All tests run against Mina LocalBlockchain (in-memory chain simulation). No external services to mock.

---

## Required data-testid Attributes

N/A -- No UI components in this story.

---

## Implementation Checklist

### Test: Deploy PetToken + mint/transfer/burn/zero-burn/unauthorized

**File:** `packages/pet-circuit/src/PetToken.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `packages/pet-circuit/src/PetToken.ts` extending `TokenContract`
- [ ] Implement `@state(UInt64) totalAmountInCirculation`
- [ ] Implement `init()` with `this.account.tokenSymbol.set('PET')` and zero circulation
- [ ] Implement `approveBase(forest: AccountUpdateForest)` with `this.checkZeroBalanceChange(forest)`
- [ ] Implement `mint(receiverAddress, amount, adminSignature)` with signature verification over `[amount, receiverAddress]`
- [ ] Implement `burn(burnerAddress, amount)` with `this.internal.burn()` and circulation decrement
- [ ] Run test: `cd packages/pet-circuit && pnpm test:unit`
- [ ] All 6 unit tests pass (green phase)

**Estimated Effort:** 2-3 hours

---

### Test: PetZkApp + PetToken integration (burn during applyProof)

**File:** `packages/pet-circuit/src/PetToken.integration.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `petTokenAddress: PublicKey` parameter to `PetZkApp.applyProof()`
- [ ] Convert on-chain `totalSpent` (Field) to UInt64 via `UInt64.Unsafe.fromField()`
- [ ] Compute `burnAmount = proof.publicOutput.totalSpent - UInt64.Unsafe.fromField(onChainTotalSpent)`
- [ ] Instantiate `PetToken` at `petTokenAddress` and call `petToken.burn(operatorAddress, burnAmount)`
- [ ] Update ALL existing PetZkApp tests to deploy PetToken + fund operator token accounts + pass `petTokenAddress`
- [ ] If cross-contract compilation issues: fall back to `applyProofWithBurn()` method
- [ ] Add `PetToken` export to `packages/pet-circuit/src/index.ts`
- [ ] Run test: `cd packages/pet-circuit && pnpm test`
- [ ] All integration tests pass (green phase)
- [ ] All existing PetZkApp tests still pass (no regressions)

**Estimated Effort:** 3-4 hours

---

### Test: Build verification (AC-5)

**Tasks:**

- [ ] Verify `pnpm build` in `packages/pet-circuit/` compiles cleanly
- [ ] Verify `pnpm lint` passes
- [ ] Verify `pnpm test` passes all existing + new tests

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all PetToken unit tests
cd packages/pet-circuit && pnpm test:unit -- --testPathPattern='PetToken\.test'

# Run PetToken integration tests
cd packages/pet-circuit && pnpm test -- --testPathPattern='PetToken\.integration'

# Run all unit tests (excludes recursive and integration)
cd packages/pet-circuit && pnpm test

# Run all tests including integration
cd packages/pet-circuit && pnpm test:integration

# Run specific test file with verbose output
cd packages/pet-circuit && npx jest --verbose src/PetToken.test.ts

# Run with coverage
cd packages/pet-circuit && pnpm test:coverage
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 11 tests written and failing (6 unit + 5 integration)
- Tests fail due to missing implementation (PetToken.ts not created, applyProof not modified)
- Failure messages are clear: `Cannot find module './PetToken'` and `Expected 3 arguments, but got 4`
- Implementation checklist created mapping tests to code tasks

**Verification:**

- All tests run and fail as expected
- Failures are import/compilation errors (missing module, wrong argument count)
- No test bugs -- tests are structurally correct for expected behavior
- Existing PetZkApp tests are unaffected (new files only)

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Create PetToken.ts** -- implement TokenContract with mint/burn/approveBase
2. **Run PetToken unit tests** -- verify 6 tests pass
3. **Modify PetZkApp.applyProof** -- add petTokenAddress parameter, compute burn delta, call petToken.burn
4. **Update existing PetZkApp tests** -- deploy PetToken, fund operator accounts, pass petTokenAddress
5. **Run integration tests** -- verify 5 tests pass
6. **Run full test suite** -- verify no regressions
7. **Export PetToken** from index.ts
8. **Build + lint** -- verify clean compilation

**Key Principles:**

- One test at a time (start with unit tests, then integration)
- Follow o1js TokenContract pattern from Dev Notes in story spec
- Compilation order: PetToken -> PetLifecycle -> PetZkApp
- If cross-contract calls fail: use applyProofWithBurn() fallback

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

1. Verify all 11 new tests pass alongside existing tests
2. Review PetToken for code quality and o1js best practices
3. Verify compilation times remain acceptable
4. Ensure backward compatibility with existing PetZkApp consumers

---

## Next Steps

1. **Review this checklist** and confirm test design covers all ACs
2. **Run failing tests** to confirm RED phase: `cd packages/pet-circuit && pnpm test 2>&1 | grep -E 'FAIL|PASS'`
3. **Begin implementation** using implementation checklist as guide
4. **Work unit tests first** (PetToken.ts creation), then integration (PetZkApp modification)
5. **When all tests pass**, verify build + lint + exports (AC-5)

---

## Knowledge Base References Applied

- **test-quality.md** -- Test design principles (determinism, isolation, clear failure messages)
- **data-factories.md** -- Assessed; N/A for ZK circuit tests (o1js primitives used directly)
- **component-tdd.md** -- Assessed; N/A for backend ZK project
- **test-healing-patterns.md** -- Assessed; N/A for non-browser tests

Adapted from Playwright/Cypress-centric ATDD workflow to backend ZK circuit testing with Jest + o1js LocalBlockchain.

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `cd packages/pet-circuit && npx jest --testPathPattern='PetToken' --no-coverage`

**Results:**

```
FAIL src/PetToken.test.ts
  - Cannot find module './PetToken' or its corresponding type declarations.

FAIL src/PetToken.integration.test.ts
  - Cannot find module './PetToken' or its corresponding type declarations.
  - Expected 3 arguments, but got 4. (3 instances -- applyProof calls with petTokenAddress)

Test Suites: 2 failed, 2 total
Tests:       0 total (suite-level compilation failure)
```

**Summary:**

- Total test suites: 2
- Passing: 0 (expected)
- Failing: 2 (expected)
- Status: RED phase verified

**Expected Failure Messages:**
- `TS2307: Cannot find module './PetToken'` -- PetToken.ts not yet created
- `TS2554: Expected 3 arguments, but got 4` -- PetZkApp.applyProof not yet modified

---

## Notes

- **Compilation order matters:** PetToken must compile before PetZkApp when PetZkApp references PetToken for cross-contract burn calls
- **Token account funding:** First-time PET token recipients require `AccountUpdate.fundNewAccount(deployer)` -- tests account for this
- **Egg-stage compatibility:** Integration tests use MEDICINE (med_bandage, itemId=11) and CHECK actions which are allowed for Egg stage per STAGE_ALLOWED_ACTIONS
- **Unconditional burn semantics:** o1js circuits cannot conditionally skip method calls; zero-amount burn is a valid no-op that always executes
- **Backward compatibility:** Adding petTokenAddress to applyProof is a breaking change; all existing tests must be updated during GREEN phase
- **Fallback strategy:** If cross-contract compilation fails, fall back to separate `applyProofWithBurn()` method (see AC-2 fallback ranking)

---

**Generated by BMad TEA Agent** - 2026-04-08
