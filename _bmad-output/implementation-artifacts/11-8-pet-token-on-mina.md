# Story 11.8: PET Token on Mina

Status: review

## Story

As a TOON Protocol developer,
I want a PET custom token deployed on Mina that the PetZkApp can burn during proof settlement,
so that every pet interaction has an on-chain economic cost enforced by the ZK circuit.

## Dependencies

- **Upstream:** Story 11-3 (PetZkApp SmartContract) -- `PetZkApp` on-chain contract with `applyProof` method. DONE.
- **Upstream:** Story 11-2 (PetLifecycle ZkProgram) -- ZK circuit with `totalSpent` accumulation. DONE.
- **Upstream:** Story 11-4 (Pet Game Engine) -- Token cost lookup via `getRequiredTokenCost()`. DONE.
- **Shared:** `packages/pet-circuit/` -- Contains PetZkApp, PetLifecycle, structs, constants.
- **Downstream:** Story 11-11 (Cross-Chain DVM Pricing) -- DVM operators hold PET token inventory and bridge ILP payments.

## Acceptance Criteria

1. **AC-1 -- PetToken contract exists:** Create `packages/pet-circuit/src/PetToken.ts` implementing a custom Mina token using o1js `TokenContract` base class:
   - Token symbol: `PET`
   - State: `totalAmountInCirculation` (UInt64)
   - `init()`: set token symbol to `PET`, initialize totalAmountInCirculation to UInt64.zero
   - `approveBase(forest: AccountUpdateForest)`: implement with `this.checkZeroBalanceChange(forest)` for transfer approval
   - `mint(receiverAddress: PublicKey, amount: UInt64, adminSignature: Signature)`: admin-authorized minting with signature verification and circulation tracking
   - `burn(burnerAddress: PublicKey, amount: UInt64)`: token burn that decrements circulation -- callable by PetZkApp during proof settlement

2. **AC-2 -- PetZkApp integrates token burn:** Modify `PetZkApp.applyProof()` to accept a `petTokenAddress: PublicKey` parameter and burn `totalSpent - previousTotalSpent` PET tokens from the operator's token account during proof settlement:
   - Convert on-chain `totalSpent` (stored as `Field`) to `UInt64` via `UInt64.Unsafe.fromField()` before computing the delta (on-chain state is `@state(Field)` but proof output is `UInt64`)
   - Compute `burnAmount` as a UInt64 from the delta between `proof.publicOutput.totalSpent` and the converted on-chain `totalSpent` (UInt64 arithmetic provides underflow protection)
   - Call `petToken.burn(operatorAddress, burnAmount)` within the applyProof method -- in o1js circuits, all method calls execute unconditionally (cannot be skipped with `Provable.if`), so the burn always executes; when `burnAmount` is `UInt64.zero` this is effectively a no-op burn of zero tokens
   - The token burn is atomically tied to the proof settlement -- if burn fails, the entire TX reverts
   - **Fallback (ranked):** If cross-contract calls from PetZkApp to PetToken create compilation issues (verification key dependencies): (1) **Preferred:** implement burn as a separate `applyProofWithBurn()` method on PetZkApp that wraps both proof settlement and burn in a single transaction; (2) **Last resort:** implement burn as a separate transaction step (breaks atomicity but unblocks development)

3. **AC-3 -- Unit tests for PetToken:** Create `packages/pet-circuit/src/PetToken.test.ts` with proofsEnabled: false:
   - Deploy PetToken contract on LocalBlockchain
   - Fund token accounts with `AccountUpdate.fundNewAccount(deployer)` before first mint to each address
   - Admin mints tokens to a receiver (verify balance + totalAmountInCirculation)
   - Transfer tokens between accounts -- note: `approveBase` uses `checkZeroBalanceChange(forest)`, so transfers require constructing a transaction where sender and receiver AccountUpdates are in the same forest with net-zero balance change (send from A + receive at B in same TX)
   - Burn tokens (verify balance decremented + totalAmountInCirculation decremented)
   - Burn zero tokens (verify no-op behavior -- validates the unconditional burn path in AC-2)
   - Reject unauthorized mint (wrong signature)
   - Note: Admin key is the contract deployer key (same as `this.address` / zkApp key pair)

4. **AC-4 -- Integration test for PetZkApp + PetToken:** Create `packages/pet-circuit/src/PetToken.integration.test.ts`:
   - Deploy PetToken + PetZkApp on LocalBlockchain (proofsEnabled: false for unit-speed iteration)
   - Compile all contracts in order: `PetToken.compile()`, `PetLifecycle.compile()`, `PetZkApp.compile()`
   - Fund operator's token account with `AccountUpdate.fundNewAccount(deployer)` before first mint
   - Admin mints PET tokens to operator's token account
   - Initialize pet via `initializePet(ownerPubkey, operatorPubkey, seed, blobbiId, genesisProof)` using a genesis proof from `PetLifecycle.genesis()`
   - **Stage-aware test setup:** Genesis creates an Egg (stage=0). Egg cannot use food items (FEED action not allowed for Egg stage per `STAGE_ALLOWED_ACTIONS`). Use an Egg-compatible shop item for the token burn test: `med_bandage` (actionType=8/MEDICINE, itemId=11, tokenCost=20) or `hyg_soap` (actionType=2/CLEAN, itemId=15, tokenCost=15) -- both are allowed for Egg stage
   - Run interaction with the chosen Egg-compatible shop item (non-zero tokenCost)
   - Call `applyProof` -- verify PET tokens are burned from operator's token account
   - Verify `totalAmountInCirculation` decremented by the burn amount
   - Verify `totalSpent` on-chain matches proof output
   - Test base action path (tokenCost=0, e.g., CLEAN with itemId=0) to verify zero-amount burn executes without error
   - Test insufficient PET balance scenario (operator lacks tokens for burn -- expect TX revert)

5. **AC-5 -- Exports and build:** Update `packages/pet-circuit/src/index.ts` to export `PetToken`. Verify:
   - `pnpm build` in `packages/pet-circuit/` compiles cleanly
   - `pnpm lint` passes
   - `pnpm test` passes all existing tests plus new PetToken tests

## Tasks / Subtasks

- [x] Task 1: Create PetToken contract (AC: 1)
  - [x] 1.1 Create `packages/pet-circuit/src/PetToken.ts` extending `TokenContract`
  - [x] 1.2 Implement `init()` with token symbol `PET` and zero circulation
  - [x] 1.3 Implement `approveBase(forest)` with `this.checkZeroBalanceChange(forest)`
  - [x] 1.4 Implement `mint(receiver, amount, adminSignature)` with signature verification
  - [x] 1.5 Implement `burn(burner, amount)` that decrements circulation

- [x] Task 2: Integrate token burn into PetZkApp (AC: 2)
  - [x] 2.1 Add `petTokenAddress: PublicKey` parameter to `applyProof`
  - [x] 2.2 Convert on-chain `totalSpent` Field to UInt64 and compute `burnAmount` delta
  - [x] 2.3 Call `petToken.burn(operatorAddress, burnAmount)` unconditionally (zero-amount burn is a valid no-op)
  - [x] 2.4 Update existing PetZkApp tests to deploy PetToken + fund operator token accounts + pass `petTokenAddress`

- [x] Task 3: Create PetToken unit tests (AC: 3)
  - [x] 3.1 Create `packages/pet-circuit/src/PetToken.test.ts`
  - [x] 3.2 Test deploy, mint, transfer (net-zero forest), burn, zero-burn no-op, unauthorized mint rejection

- [x] Task 4: Create PetZkApp + PetToken integration test (AC: 4)
  - [x] 4.1 Create `packages/pet-circuit/src/PetToken.integration.test.ts`
  - [x] 4.2 Test full lifecycle: deploy both -> mint to operator -> interact -> applyProof -> verify burn

- [x] Task 5: Export and build verification (AC: 5)
  - [x] 5.1 Add `PetToken` export to `packages/pet-circuit/src/index.ts`
  - [x] 5.2 Run `pnpm build`, `pnpm lint`, `pnpm test` in `packages/pet-circuit/`

## Dev Notes

### o1js TokenContract Pattern (Current as of o1js ^2.2.0)

The PetToken MUST extend `TokenContract` from o1js (NOT `SmartContract`). The `TokenContract` base class provides `this.internal.mint()`, `this.internal.burn()`, and `this.internal.send()` for token operations.

Key implementation pattern:

```typescript
import {
  TokenContract,
  AccountUpdateForest,
  State,
  state,
  method,
  PublicKey,
  UInt64,
  Signature,
} from 'o1js';

class PetToken extends TokenContract {
  @state(UInt64) totalAmountInCirculation = State<UInt64>();

  @method async init() {
    super.init();
    this.account.tokenSymbol.set('PET');
    this.totalAmountInCirculation.set(UInt64.zero);
  }

  @method async approveBase(forest: AccountUpdateForest): Promise<void> {
    this.checkZeroBalanceChange(forest);
  }

  @method async mint(
    receiverAddress: PublicKey,
    amount: UInt64,
    adminSignature: Signature
  ): Promise<void> {
    // Verify admin signature over [amount, receiverAddress]
    adminSignature
      .verify(this.address, amount.toFields().concat(receiverAddress.toFields()))
      .assertTrue();

    let totalAmountInCirculation = this.totalAmountInCirculation.getAndRequireEquals();
    let newTotal = totalAmountInCirculation.add(amount);
    this.internal.mint({ address: receiverAddress, amount });
    this.totalAmountInCirculation.set(newTotal);
  }

  @method async burn(
    burnerAddress: PublicKey,
    amount: UInt64
  ): Promise<void> {
    let totalAmountInCirculation = this.totalAmountInCirculation.getAndRequireEquals();
    let newTotal = totalAmountInCirculation.sub(amount);
    this.internal.burn({ address: burnerAddress, amount });
    this.totalAmountInCirculation.set(newTotal);
  }
}
```

### PetZkApp applyProof Modification

The `applyProof` method needs a new `petTokenAddress: PublicKey` parameter. Within the method, instantiate the PetToken at that address and call `burn`. The burn amount is the delta between the proof's `totalSpent` and the on-chain `totalSpent`.

**Field-to-UInt64 conversion:** On-chain `totalSpent` is `@state(Field)` but proof output `totalSpent` is `UInt64`. Use `UInt64.Unsafe.fromField(onChainTotalSpent)` to convert before computing the delta. This is safe because `totalSpent` values originate from UInt64 arithmetic in the circuit.

**CRITICAL:** o1js's `TokenContract.burn()` requires that the calling contract (PetZkApp) has appropriate permissions. In practice, the burn call within `applyProof` creates an `AccountUpdate` that modifies the operator's token balance. This must be authorized -- the operator's signature (already provided as `operatorSig`) must cover the burn. The operator already signs over `[lifecycleHash]` -- this may need to be extended to include the burn amount.

**Unconditional execution:** In o1js circuits, all `@method` calls execute unconditionally -- `Provable.if` can select values but cannot skip method invocations. The `petToken.burn(operator, burnAmount)` call always executes. When `burnAmount` is `UInt64.zero`, this is a valid no-op burn on the deployed TokenContract. This means a PetToken MUST be deployed even for base-action-only scenarios.

**Fallback ranking:** If direct cross-contract calls create compilation issues: (1) Preferred: separate `applyProofWithBurn()` method keeping original `applyProof` unchanged; (2) Last resort: separate transaction (breaks atomicity). Priority is getting the token contract working and tested.

### Token Account Funding on Mina

When a new address receives custom tokens for the first time, Mina requires funding a new token account. In tests, use `AccountUpdate.fundNewAccount(deployer)` before the first mint to an address. The DVM operator's token account must be funded before they can receive PET tokens.

### Existing Test Patterns to Follow

Follow the existing test patterns in `packages/pet-circuit/src/PetZkApp.test.ts`:
- Use `Mina.LocalBlockchain({ proofsEnabled: false })` for unit tests
- Sequential test structure with shared state between tests
- `beforeAll`: compile all contracts (`PetToken.compile()`, `PetLifecycle.compile()`, `PetZkApp.compile()`)
- Deploy helper functions
- `Mina.transaction(deployer, async () => { ... })` pattern

### Token Cost Values from Constants

Shop items have defined token costs in `packages/pet-circuit/src/constants.ts` (SHOP_ITEMS array, 18 items total):
- Food (actionType=0/FEED): apple(id=1): 10, burger(id=2): 25, cake(id=3): 50, pizza(id=4): 35, sushi(id=5): 45
- Toy (actionType=1/PLAY): ball(id=6): 30, teddy(id=7): 60, blocks(id=8): 40
- Medicine (actionType=8/MEDICINE): vitamins(id=9): 40, super(id=10): 100, bandage(id=11): 20, elixir(id=12): 150, shell_repair(id=13): 60, calcium(id=14): 35
- Hygiene (actionType=2/CLEAN): soap(id=15): 15, shampoo(id=16): 25, bubble(id=17): 40, towel(id=18): 20
- Base actions (itemId=0) cost 0 PET

**Stage-action compatibility reminder:** Egg stage allows CLEAN, WARM, CHECK, SING, TALK, MEDICINE, PLAY_MUSIC only. FEED and PLAY are Baby/Adult only. For Egg-stage integration tests, use medicine or hygiene items (e.g., med_bandage: actionType=8, itemId=11, tokenCost=20).

### Backward Compatibility

Adding `petTokenAddress` parameter to `applyProof` is a **breaking change** for existing tests. All existing `PetZkApp.test.ts` and `PetZkApp.integration.test.ts` tests that call `applyProof` must be updated to pass the new parameter.

**CRITICAL:** In o1js circuits, method calls (like `petToken.burn()`) execute unconditionally -- they cannot be skipped via `Provable.if`. Even when `burnAmount` is `UInt64.zero`, the burn call still creates AccountUpdates targeting the `petTokenAddress`. This means:

- **Existing tests that do NOT deploy a PetToken** cannot simply pass `PublicKey.empty()` or a dummy address -- the unconditional burn call will attempt to interact with a non-existent contract and likely fail.
- **Two viable approaches:** (a) All existing tests must deploy a PetToken and fund operator token accounts, even for base-action-only tests (heavier but correct); (b) Use the `applyProofWithBurn()` fallback method so that existing tests continue to call the original `applyProof` (no signature change) while new token-aware tests call `applyProofWithBurn()`.

**Decision:** Start with approach (a) -- modify `applyProof` directly and update all existing tests to deploy PetToken + fund token accounts. The zero-amount burn is a valid no-op on a deployed TokenContract. If this causes unacceptable test complexity or compilation issues, fall back to approach (b) with a separate `applyProofWithBurn()` method.

### Admin Key Model

The PET token admin key is the contract's own keypair (`this.address`). The deployer who creates the PetToken contract retains the private key and uses it to sign mint authorizations. In tests, this is the `zkAppPrivateKey` used during deployment. In production, this key must be secured by the protocol treasury or a multisig.

### Circuit Size Considerations

Adding `TokenContract.burn()` inside `applyProof` will increase the AccountUpdate tree and constraint count. Monitor compilation time during development. If the combined circuit exceeds o1js limits or compilation becomes prohibitively slow (>5 minutes with proofsEnabled: true), fall back to the separate transaction approach described in the AC-2 fallback.

### Compilation Order

o1js requires specific compilation order:
1. `await PetToken.compile()` -- if PetZkApp references PetToken
2. `await PetLifecycle.compile()` -- produces VK needed by PetZkApp
3. `await PetZkApp.compile()` -- references both PetLifecycleProof and PetToken

### Project Structure Notes

- New file: `packages/pet-circuit/src/PetToken.ts` -- follows existing contract pattern
- New file: `packages/pet-circuit/src/PetToken.test.ts` -- unit tests (proofsEnabled: false)
- New file: `packages/pet-circuit/src/PetToken.integration.test.ts` -- integration test
- Modified: `packages/pet-circuit/src/PetZkApp.ts` -- add token burn to applyProof
- Modified: `packages/pet-circuit/src/PetZkApp.test.ts` -- update for new parameter
- Modified: `packages/pet-circuit/src/PetZkApp.integration.test.ts` -- update for new parameter
- Modified: `packages/pet-circuit/src/index.ts` -- add PetToken export
- No new packages created -- all changes within existing `@toon-protocol/pet-circuit`

### References

- [Source: packages/pet-circuit/src/PetZkApp.ts] -- Existing PetZkApp with applyProof method
- [Source: packages/pet-circuit/src/structs.ts] -- PetState with totalSpent field
- [Source: packages/pet-circuit/src/constants.ts] -- SHOP_ITEMS with tokenCost values, getRequiredTokenCost()
- [Source: packages/pet-circuit/src/PetZkApp.test.ts] -- Existing test patterns (LocalBlockchain, sequential tests)
- [Source: packages/pet-circuit/src/PetZkApp.integration.test.ts] -- Integration test pattern (proofsEnabled: true)
- [Source: packages/pet-circuit/src/PetLifecycle.ts] -- ZkProgram with totalSpent in PetState output
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md] -- Token economy architecture
- [Source: _bmad-output/planning-artifacts/pet-zkapp-game-rules-canonical.md#Section 9] -- PET Token Cost Table
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md] -- Test strategy for Story 11-8
- [Source: _bmad-output/project-context.md] -- TypeScript conventions, ESM-only, strict mode

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- TokenContract deploy error: `Update_not_permitted_token_symbol` -- resolved by moving `tokenSymbol.set('PET')` from `init()` to `deploy()` override, since TokenContract.deploy() sets `access: proofOrSignature()` before init's account update executes
- applyProof signature error: `Invalid signature on account_update` -- resolved by adding operator key to transaction signing (token burn creates an account update modifying operator's token balance that requires their signature)

### Completion Notes List

- **Task 1**: Created `PetToken.ts` extending `TokenContract` with `deploy()` override for token symbol, `init()` for circulation state, `approveBase()` with zero-balance-change, `mint()` with admin signature verification, and `burn()` with circulation tracking
- **Task 2**: Modified `PetZkApp.applyProof()` to accept `petTokenAddress: PublicKey`, compute burn delta via `UInt64.Unsafe.fromField()` conversion, and call `petToken.burn()` unconditionally. Used approach (a) -- direct modification, no fallback needed
- **Task 3**: ATDD tests from prior phase pass -- 6/6 PetToken unit tests (deploy, mint, transfer, burn, zero-burn no-op, unauthorized mint rejection)
- **Task 4**: ATDD integration tests from prior phase pass -- 6/6 tests (deploy both, mint to operator, initialize pet, shop item burn, zero-burn base action, insufficient balance revert)
- **Task 5**: Added `PetToken` export to index.ts. Build (tsc), lint (0 errors, 53 pre-existing warnings), and all 129 unit tests pass

### File List

- `packages/pet-circuit/src/PetToken.ts` -- CREATED: PET custom token contract
- `packages/pet-circuit/src/PetZkApp.ts` -- MODIFIED: added petTokenAddress param + token burn to applyProof
- `packages/pet-circuit/src/index.ts` -- MODIFIED: added PetToken export
- `packages/pet-circuit/src/PetZkApp.test.ts` -- MODIFIED: deploy PetToken, fund operator token accounts, pass petTokenAddress, sign with operator key
- `packages/pet-circuit/src/PetZkApp.integration.test.ts` -- MODIFIED: deploy PetToken, mint to operator, pass petTokenAddress, sign with operator key
- `packages/pet-circuit/src/PetToken.test.ts` -- MODIFIED: removed unused variable (lint fix)
- `packages/pet-circuit/src/PetToken.integration.test.ts` -- UNMODIFIED: ATDD tests from prior phase worked as-is

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-08 | Adversarial review: fixed 10 issues -- Field-to-UInt64 conversion gap, unconditional burn semantics, stage-action compatibility in AC-4, backward compat approach, incomplete token cost table, transfer test complexity, fallback ranking, compilation order in AC-4, zero-burn test case added to AC-3 |
| 2026-04-08 | Implementation complete: PetToken contract created, PetZkApp.applyProof modified with token burn, all existing tests updated for backward compatibility, all 129 unit tests + 6 integration tests passing, build + lint clean |
| 2026-04-08 | NFR assessment complete: PASS (6 PASS, 2 CONCERNS, 0 FAIL, 0 blockers). See `_bmad-output/test-artifacts/nfr-assessment-11-8.md` |
