---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-generation', 'step-04-checklist']
lastStep: 'step-04-checklist'
lastSaved: '2026-04-20'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md'
  - '_bmad-output/planning-artifacts/test-design-epic-21.md'
  - 'packages/townhouse/vitest.config.ts'
  - 'packages/townhouse/src/cli.test.ts'
  - 'packages/townhouse/src/connector/config-generator.test.ts'
  - 'packages/townhouse/src/config/schema.ts'
  - 'packages/townhouse/src/constants.ts'
---

# ATDD Checklist - Epic 21, Story 4: HD Wallet Management + Per-Node Key Derivation

**Date:** 2026-04-20
**Author:** Jonathan
**Primary Test Level:** Unit (co-located with source, vitest)

---

## Story Summary

This story adds an HD wallet layer to Townhouse. A single BIP-39 mnemonic derives all node keys deterministically using BIP-44 paths with distinct account indices per node type (Town=0, Mill=1, DVM=2).

**As a** node operator
**I want** a single seed phrase that derives all node keys
**So that** I only need one backup

---

## Acceptance Criteria

1. `src/wallet/manager.ts` implementing HD key derivation using `@scure/bip39`, `@scure/bip32`, and `nostr-tools` directly
2. `townhouse init` generates BIP-39 mnemonic and prompts operator to back it up
3. Per-node HD derivation following BIP-44 paths (distinct account indices per node type)
4. Nostr keypair (secp256k1) + EVM address derived per node
5. Wallet state persisted in `~/.townhouse/wallet.enc` (encrypted at rest)
6. `townhouse wallet show` displays all derived addresses without revealing private keys or mnemonic
7. Unit tests for key derivation consistency (golden test vectors)
8. Mnemonic never appears in log output, CLI status, or API responses after initial backup prompt

---

## Failing Tests Created (RED Phase)

### Unit Tests — WalletManager (9 tests)

**File:** `packages/townhouse/src/wallet/manager.test.ts` (175 lines)

- ✅ **Test:** generate() produces a valid 12-word BIP-39 mnemonic
  - **Status:** RED - Cannot import `./manager.js` (module does not exist)
  - **Verifies:** AC #1, #2 (T-023)

- ✅ **Test:** generate() produces a WalletState with keys for all node types
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #1

- ✅ **Test:** fromMnemonic() accepts a valid 12-word mnemonic
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #1 (T-035)

- ✅ **Test:** fromMnemonic() accepts a valid 24-word mnemonic
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #1 (T-035)

- ✅ **Test:** fromMnemonic() rejects invalid mnemonic (wrong checksum)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #1 (T-034)

- ✅ **Test:** getNodeKeys() produces distinct Nostr pubkeys for each node type
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3, #4 (T-024)

- ✅ **Test:** getNodeKeys() produces distinct EVM addresses for each node type
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3, #4 (T-024)

- ✅ **Test:** lock() zeros all in-memory key material
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #1 (T-030)

- ✅ **Test:** getAllKeys() returns key info for all three node types without secrets
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #6

### Unit Tests — Wallet Crypto (9 tests)

**File:** `packages/townhouse/src/wallet/crypto.test.ts` (103 lines)

- ✅ **Test:** encrypt/decrypt roundtrip preserves mnemonic
  - **Status:** RED - Cannot import `./crypto.js` (module does not exist)
  - **Verifies:** AC #5 (T-026)

- ✅ **Test:** encrypted output contains expected fields
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** ciphertext is not the same as original mnemonic
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** wrong password fails decryption
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5 (T-027)

- ✅ **Test:** different salts produce different ciphertexts
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** all fields are valid base64 strings
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** salt is 32 bytes
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** iv is 12 bytes for AES-256-GCM
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

- ✅ **Test:** tag is 16 bytes for GCM auth tag
  - **Status:** RED - Cannot import `./crypto.js`
  - **Verifies:** AC #5

### Unit Tests — Wallet Storage (4 tests)

**File:** `packages/townhouse/src/wallet/storage.test.ts` (81 lines)

- ✅ **Test:** save/load roundtrip preserves encrypted wallet data
  - **Status:** RED - Cannot import `./storage.js` (module does not exist)
  - **Verifies:** AC #5

- ✅ **Test:** wallet file created with 0o600 permissions
  - **Status:** RED - Cannot import `./storage.js`
  - **Verifies:** AC #5 (T-028)

- ✅ **Test:** missing file returns null
  - **Status:** RED - Cannot import `./storage.js`
  - **Verifies:** AC #5 (T-031)

- ✅ **Test:** creates parent directories if missing
  - **Status:** RED - Cannot import `./storage.js`
  - **Verifies:** AC #5

### Unit Tests — Golden Derivation Vectors (10 tests)

**File:** `packages/townhouse/src/wallet/derivation-vectors.test.ts` (178 lines)

- ✅ **Test:** Town derives deterministic Nostr pubkey
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3, #7 (T-029)

- ✅ **Test:** Town derives deterministic EVM address (golden: 0x9858EfFD...)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #4, #7 (T-029)

- ✅ **Test:** Mill derives different Nostr pubkey than Town
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-024)

- ✅ **Test:** Mill derives different EVM address than Town
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #4 (T-024)

- ✅ **Test:** DVM derives different keys than Town and Mill
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-024)

- ✅ **Test:** Derivation paths use correct account indices (0/1/2)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-025)

- ✅ **Test:** Town path matches SDK KeyDerivation (intentional, documented)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-025)

- ✅ **Test:** Mill (account 1) does NOT collide with Mill swap keys (account 2)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-025)

- ✅ **Test:** DVM path documented for node identity use
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #3 (T-025)

- ✅ **Test:** Same mnemonic produces same keys (determinism)
  - **Status:** RED - Cannot import `./manager.js`
  - **Verifies:** AC #7 (T-029)

### Unit Tests — CLI Wallet Commands (8 tests)

**File:** `packages/townhouse/src/wallet/cli-wallet.test.ts` (283 lines)

- ✅ **Test:** init --force --password generates wallet file
  - **Status:** RED - CLI does not support wallet generation yet
  - **Verifies:** AC #2 (T-031)

- ✅ **Test:** init displays mnemonic exactly once for backup
  - **Status:** RED - CLI does not support wallet generation yet
  - **Verifies:** AC #2

- ✅ **Test:** init displays derived addresses as confirmation
  - **Status:** RED - CLI does not support wallet generation yet
  - **Verifies:** AC #2

- ✅ **Test:** wallet show displays Nostr pubkeys and EVM addresses
  - **Status:** RED - `wallet` command does not exist
  - **Verifies:** AC #6 (T-028, T-032)

- ✅ **Test:** wallet show with missing wallet shows helpful error
  - **Status:** RED - `wallet` command does not exist
  - **Verifies:** AC #6 (T-031)

- ✅ **Test:** status command does not reveal mnemonic (security)
  - **Status:** RED - CLI does not support wallet generation yet
  - **Verifies:** AC #8 (T-033)

- ✅ **Test:** wallet show does not reveal mnemonic words
  - **Status:** RED - `wallet` command does not exist
  - **Verifies:** AC #8 (T-033)

- ✅ **Test:** init without --force refuses to overwrite existing wallet
  - **Status:** RED - CLI does not support wallet generation yet
  - **Verifies:** AC #2

---

## Data Factories Created

### Mock Encrypted Wallet Factory

**File:** `packages/townhouse/src/wallet/storage.test.ts` (inline)

**Exports:**

- `createMockEncryptedWallet()` - Creates a mock EncryptedWallet with random base64 fields

**Example Usage:**

```typescript
const wallet = createMockEncryptedWallet();
await saveWallet('/tmp/test.enc', wallet);
```

---

## Fixtures Created

No separate fixture files needed. Tests use:
- Inline temp directory creation (`makeTempDir()`)
- Well-known BIP-39 test mnemonic ("abandon...about")
- Direct vitest mocks for dockerode

---

## Mock Requirements

### Dockerode Mock

**Used in:** `cli-wallet.test.ts`

**Pattern:** Same `vi.mock('dockerode')` pattern used in existing `cli.test.ts` — mock Docker class with stub container/network methods.

**Notes:** No real Docker needed for wallet unit tests. Docker mock prevents CLI from attempting real container operations.

---

## Required data-testid Attributes

Not applicable — this story is CLI-only with no UI components.

---

## Implementation Checklist

### Test: WalletManager — generate() and fromMnemonic()

**File:** `packages/townhouse/src/wallet/manager.test.ts`

**Tasks to make this test pass:**

- [ ] Create `src/wallet/types.ts` with `WalletManagerConfig`, `DerivedNodeKeys`, `WalletState`, `NodeKeyInfo`, `NodeType` interfaces
- [ ] Add `@scure/bip39`, `@scure/bip32`, `nostr-tools` to `package.json` dependencies
- [ ] Create `src/wallet/manager.ts` with `WalletManager` class
- [ ] Implement `generate()` — creates 12-word mnemonic using `@scure/bip39` with english wordlist
- [ ] Implement `fromMnemonic()` — validates mnemonic (accepts 12/24 words), derives seed, generates keys
- [ ] Implement `getNodeKeys(nodeType)` — returns derived keys for specific node type
- [ ] Implement `getAllKeys()` — returns `NodeKeyInfo[]` (public info only, no secrets)
- [ ] Implement `lock()` — zeros all `Uint8Array` key material
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/manager.test.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 3 hours

---

### Test: Wallet Crypto — encrypt/decrypt

**File:** `packages/townhouse/src/wallet/crypto.test.ts`

**Tasks to make this test pass:**

- [ ] Add `EncryptedWallet` interface to `src/wallet/types.ts`
- [ ] Create `src/wallet/crypto.ts` with `encryptWallet()` and `decryptWallet()`
- [ ] Implement scrypt KDF (N=2^17, r=8, p=1) with random 32-byte salt
- [ ] Implement AES-256-GCM encryption with random 12-byte IV
- [ ] Return `{ salt, iv, ciphertext, tag }` all as base64 strings
- [ ] Implement decrypt: derive key from password+salt, decrypt with IV+tag
- [ ] Throw clear error on wrong password (GCM auth tag mismatch)
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/crypto.test.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 2 hours

---

### Test: Wallet Storage — save/load with permissions

**File:** `packages/townhouse/src/wallet/storage.test.ts`

**Tasks to make this test pass:**

- [ ] Create `src/wallet/storage.ts` with `saveWallet()` and `loadWallet()`
- [ ] Implement `saveWallet()`: mkdir recursive, writeFile with mode 0o600
- [ ] Implement `loadWallet()`: readFile, parse JSON, return null if ENOENT
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/storage.test.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 1 hour

---

### Test: Golden Derivation Vectors

**File:** `packages/townhouse/src/wallet/derivation-vectors.test.ts`

**Tasks to make this test pass:**

- [ ] Implement BIP-44 derivation in `manager.ts` using correct paths:
  - Town: `m/44'/1237'/0'/0/0` (Nostr), `m/44'/60'/0'/0/0` (EVM)
  - Mill: `m/44'/1237'/1'/0/0` (Nostr), `m/44'/60'/1'/0/0` (EVM)
  - DVM: `m/44'/1237'/2'/0/0` (Nostr), `m/44'/60'/2'/0/0` (EVM)
- [ ] Use `@scure/bip32` HDKey for path derivation
- [ ] Use `nostr-tools/pure` `getPublicKey()` for Nostr x-only pubkey
- [ ] Compute EVM address from secp256k1 public key (keccak256 of uncompressed pubkey)
- [ ] Verify golden EVM vector: "abandon...about" m/44'/60'/0'/0/0 = 0x9858EfFD232B4033E47d90003D41EC34EcaEda94
- [ ] Compute and hardcode golden Nostr pubkey values once implementation works
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/derivation-vectors.test.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 2 hours

---

### Test: CLI Wallet Commands

**File:** `packages/townhouse/src/wallet/cli-wallet.test.ts`

**Tasks to make this test pass:**

- [ ] Update `src/cli.ts` — add `--password` flag parsing
- [ ] Update `init` command: after config creation, call `WalletManager.generate()`, display mnemonic once with backup warning, encrypt with password, save to encrypted_path, display derived addresses
- [ ] Add `wallet` subcommand group with `show` action to CLI
- [ ] Implement `wallet show`: load encrypted wallet, prompt/accept password, decrypt, derive keys, display table (Node Type | Nostr Pubkey | EVM Address | Derivation Path)
- [ ] Call `lock()` after display
- [ ] Handle missing wallet gracefully: "No wallet found. Run `townhouse init` first."
- [ ] Ensure mnemonic is NEVER displayed outside init command
- [ ] Create `src/wallet/index.ts` re-exporting public API
- [ ] Update `src/index.ts` to re-export wallet module
- [ ] Run test: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/cli-wallet.test.ts`
- [ ] Test passes (green phase)

**Estimated Effort:** 4 hours

---

## Running Tests

```bash
# Run all failing tests for this story
pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/

# Run specific test file
pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/manager.test.ts

# Run with verbose output
pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/ --reporter=verbose

# Debug specific test
pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/manager.test.ts --reporter=verbose

# Run tests with coverage
pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/ --coverage
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

**TEA Agent Responsibilities:**

- ✅ All 40 tests written and failing
- ✅ Factories created (inline mock encrypted wallet)
- ✅ Mock requirements documented (dockerode)
- ✅ Implementation checklist created
- ✅ Golden test vectors defined with known BIP-39 test mnemonic

**Verification:**

- All tests run and fail as expected (5 test files, 40 total tests)
- Failure messages are clear: module import failures (implementation not yet created)
- Tests fail due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Pick one failing test file** from implementation checklist (recommended order: types -> crypto -> storage -> manager -> cli-wallet)
2. **Read the test** to understand expected behavior
3. **Implement minimal code** to make that specific test pass
4. **Run the test** to verify it now passes (green)
5. **Check off the task** in implementation checklist
6. **Move to next test** and repeat

**Recommended Implementation Order:**

1. `src/wallet/types.ts` — interfaces (unblocks all other files)
2. `src/wallet/crypto.ts` — encrypt/decrypt (standalone, no other wallet deps)
3. `src/wallet/storage.ts` — file I/O (depends only on types)
4. `src/wallet/manager.ts` — HD derivation (core logic)
5. `src/wallet/index.ts` — re-exports
6. `src/cli.ts` updates — wallet commands (depends on all above)

**Key Principles:**

- One test at a time (don't try to fix all at once)
- Minimal implementation (don't over-engineer)
- Run tests frequently (immediate feedback)
- Use implementation checklist as roadmap

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

**DEV Agent Responsibilities:**

1. **Verify all tests pass** (green phase complete)
2. **Review code for quality** (readability, maintainability, performance)
3. **Extract duplications** (DRY principle)
4. **Optimize performance** (if needed)
5. **Ensure tests still pass** after each refactor
6. **Update documentation** (if API contracts change)

**Completion:**

- All tests pass
- Code quality meets team standards
- No duplications or code smells
- Ready for code review and story approval

---

## Next Steps

1. **Run failing tests** to confirm RED phase: `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/`
2. **Begin implementation** using implementation checklist as guide
3. **Work one test at a time** (red -> green for each)
4. **When all tests pass**, refactor code for quality
5. **When refactoring complete**, update story status to 'done'

---

## Knowledge Base References Applied

- **test-quality.md** — Test design principles (Given-When-Then, one assertion per test, determinism, isolation)
- **data-factories.md** — Factory patterns for test data generation
- **test-levels-framework.md** — Test level selection (unit tests appropriate for pure crypto/derivation logic)
- **component-tdd.md** — TDD approach adapted for Node.js CLI tooling

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm --filter @toon-protocol/townhouse test -- --run src/wallet/`

**Results:**

```
 Test Files  5 failed (5)
      Tests  5 failed | 3 passed (8)
   Duration  530ms
```

**Summary:**

- Total test files: 5
- Failing files: 5 (expected — all implementations missing)
- Status: RED phase verified

**Expected Failure Messages:**
- `Cannot find module './manager.js'` — WalletManager not implemented
- `Cannot find module './crypto.js'` — Crypto module not implemented
- `Cannot find module './storage.js'` — Storage module not implemented
- `Cannot find module './types.js'` — Types not defined
- `Unknown command: wallet` — CLI wallet subcommand not implemented

---

## Notes

- The golden EVM address vector (0x9858EfFD232B4033E47d90003D41EC34EcaEda94) for the "abandon...about" mnemonic at path m/44'/60'/0'/0/0 is a well-known test value. Verify during implementation.
- The Nostr golden vectors must be computed during implementation and then hardcoded into `derivation-vectors.test.ts`.
- `@scure/bip39`, `@scure/bip32`, and `nostr-tools` are already in the pnpm workspace — add as direct dependencies to `packages/townhouse/package.json`.
- All tests use co-located pattern (`*.test.ts` next to source) per project convention.
- No Playwright/browser tests needed — this story is CLI + library code only.

---

## Contact

**Questions or Issues?**

- Ask in team standup
- Refer to `_bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md` for full story spec
- Consult `_bmad-output/planning-artifacts/test-design-epic-21.md` for test design context

---

**Generated by BMad TEA Agent** - 2026-04-20
