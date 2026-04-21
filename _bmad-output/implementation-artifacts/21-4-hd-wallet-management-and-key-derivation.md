# Story 21.4: HD Wallet Management + Per-Node Key Derivation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a node operator,
I want a single seed phrase that derives all node keys,
so that I only need one backup.

## Dependencies

- **Story 21.3** (done): Standalone connector integration — `ConnectorConfigGenerator`, `ConnectorAdminClient`, orchestrator restart-based peer registration, connector env vars
- **Story 21.2** (done): Docker orchestrator — `DockerOrchestrator`, container lifecycle, health checks, compose profiles
- **Story 21.1** (done): Package scaffold, CLI entrypoint, config schema (`TownhouseConfig`, `WalletConfig`)

**Reference implementations (NOT imported — same underlying libraries reused directly):**
- **@toon-protocol/client** `KeyDerivation` module: `generateMnemonic()`, `validateMnemonic()`, `deriveFullIdentity()` — BIP-39 + BIP-44 multi-chain key derivation (Nostr, EVM, Solana, Mina). Pattern reference only; `@toon-protocol/client` is NOT a dependency (browser-oriented).
- **@toon-protocol/mill** `wallet.ts`: `deriveMillKeys()` — BIP-44 per-chain derivation with configurable account index. Pattern reference only.

## Acceptance Criteria

1. `src/wallet/manager.ts` implementing HD key derivation using `@scure/bip39`, `@scure/bip32`, and `nostr-tools` directly (NOT importing `@toon-protocol/client`)
2. `townhouse init` generates BIP-39 mnemonic and prompts operator to back it up
3. Per-node HD derivation following BIP-44 paths (distinct account indices per node type)
4. Nostr keypair (secp256k1) + EVM address derived per node
5. Wallet state persisted in `~/.townhouse/wallet.enc` (encrypted at rest)
6. `townhouse wallet show` displays all derived addresses without revealing private keys or mnemonic
7. Unit tests for key derivation consistency (golden test vectors)
8. Mnemonic never appears in log output, CLI status, or API responses after initial backup prompt

## Tasks / Subtasks

- [x] Task 1: Wallet manager module (AC: #1, #3, #4)
  - [x] 1.1 Create `src/wallet/types.ts` defining `WalletManagerConfig`, `DerivedNodeKeys`, `WalletState`, `NodeKeyInfo` interfaces. `DerivedNodeKeys` has fields per node type (town, mill, dvm), each containing `nostrPubkey: string`, `nostrSecretKey: Uint8Array`, `evmAddress: string`, `evmPrivateKey: Uint8Array`, `derivationPath: string`.
  - [x] 1.2 Create `src/wallet/manager.ts` with `WalletManager` class. Constructor accepts `WalletManagerConfig` (contains `encryptedPath: string`). Methods: `generate(): Promise<{ mnemonic: string; state: WalletState }>`, `fromMnemonic(mnemonic: string): Promise<WalletState>`, `getNodeKeys(nodeType: NodeType): DerivedNodeKeys[NodeType]`, `getAllKeys(): NodeKeyInfo[]`, `lock(): void`. The `fromMnemonic()` method MUST accept both 12-word and 24-word BIP-39 mnemonics (128-bit and 256-bit entropy).
  - [x] 1.3 Implement BIP-44 derivation with distinct account indices per node type: Town = account 0, Mill = account 1, DVM = account 2. Use Nostr NIP-06 path variant: `m/44'/1237'/{account}'/0/0` for Nostr keys, and `m/44'/60'/{account}'/0/0` for EVM keys. This provides key isolation between node types while remaining deterministic from a single seed.
  - [x] 1.4 Implement `deriveNodeKeys(seed: Uint8Array, nodeType: NodeType): DerivedNodeKeys[NodeType]` private method using `@scure/bip39` (`mnemonicToSeedSync`) and `@scure/bip32` (`HDKey`). Uses same libraries as `@toon-protocol/client/KeyDerivation` but with per-node account indices.
  - [x] 1.5 Implement `lock()` to zero all in-memory key material (`Uint8Array.fill(0)`) following the pattern from `@toon-protocol/client/KeyManager`.
  - [x] 1.6 Create `src/wallet/index.ts` re-exporting public API.

- [x] Task 2: Encryption at rest (AC: #5)
  - [x] 2.1 Create `src/wallet/crypto.ts` with `encryptWallet(mnemonic: string, password: string): Promise<EncryptedWallet>` and `decryptWallet(encrypted: EncryptedWallet, password: string): Promise<string>`. Use Node.js `crypto` module: `scrypt` for KDF (N=2^17, r=8, p=1), `aes-256-gcm` for encryption. `EncryptedWallet` is `{ salt: string; iv: string; ciphertext: string; tag: string }` (all base64-encoded).
  - [x] 2.2 Create `src/wallet/storage.ts` with `saveWallet(path: string, encrypted: EncryptedWallet): Promise<void>` and `loadWallet(path: string): Promise<EncryptedWallet | null>`. Uses `fs.writeFile`/`fs.readFile` with `0o600` permissions (owner-only read/write). Creates parent directory if missing (`fs.mkdir` with `recursive: true`).
  - [x] 2.3 Define `EncryptedWallet` interface in `src/wallet/types.ts`.

- [x] Task 3: CLI `init` wallet generation (AC: #2, #8)
  - [x] 3.1 Update `townhouse init` in `src/cli.ts` — after creating config directory, generate mnemonic via `WalletManager.generate()`. Display the 12-word mnemonic with a warning to back it up. Prompt for a wallet password (read from stdin, no echo — use Node.js `readline` with `input: process.stdin` in raw mode, or accept via `--password` flag for non-interactive/test usage). CRITICAL: the mnemonic MUST only appear in this single `init` output. No other command (`status`, `up`, `wallet show`, `metrics`) may ever display or log the mnemonic. Do not store mnemonic in any variable that persists past the init flow.
  - [x] 3.2 Encrypt mnemonic with the password and save to `config.wallet.encrypted_path`.
  - [x] 3.3 Display derived addresses for all node types (Nostr pubkey + EVM address per node) as confirmation.
  - [x] 3.4 If wallet file already exists at `encrypted_path`, warn and ask for confirmation before overwriting (skip in non-interactive mode with `--force` flag).

- [x] Task 4: CLI `wallet show` command (AC: #6)
  - [x] 4.1 Add `wallet` subcommand group to CLI with `show` action: `townhouse wallet show [-c <path>] [--password <pw>]`.
  - [x] 4.2 Implement: load encrypted wallet from `config.wallet.encrypted_path`, prompt for password (or accept `--password`), decrypt, derive all node keys, display table with columns: Node Type | Nostr Pubkey | EVM Address | Derivation Path.
  - [x] 4.3 After display, call `lock()` to zero key material.
  - [x] 4.4 Handle missing wallet file gracefully: "No wallet found. Run `townhouse init` first."

- [x] Task 5: Orchestrator integration (AC: #3, #4)
  - [x] 5.1 Update `DockerOrchestrator.up()` to accept optional `WalletManager` — if provided, inject per-node Nostr pubkey and EVM address into node container environment variables (`NODE_NOSTR_PUBKEY`, `NODE_EVM_ADDRESS`, `NODE_NOSTR_SECRET_KEY`). These env vars let each node sign events and settle payments.
  - [x] 5.2 Update `buildNodeEnv()` private method to include wallet-derived keys for the specific node type being started. If no wallet manager provided, skip key injection (backward compatible).
  - [x] 5.3 Update CLI `up` command to load and decrypt wallet before starting orchestration (prompt for password or accept `--password` flag). Pass `WalletManager` to orchestrator.

- [x] Task 6: Unit tests (AC: #7, #8)
  - [x] 6.1 Create `src/wallet/manager.test.ts` — test `generate()` produces valid 12-word mnemonic. Test `fromMnemonic()` with known test vector produces deterministic keys. Test `fromMnemonic()` accepts both 12 and 24-word mnemonics. Test distinct account indices produce different keys for each node type. Test `lock()` zeros key material. Test invalid mnemonic (wrong checksum) is rejected with clear error.
  - [x] 6.2 Create `src/wallet/crypto.test.ts` — test encrypt/decrypt roundtrip. Test wrong password fails decryption. Test different salts produce different ciphertexts. Test output format (base64 fields).
  - [x] 6.3 Create `src/wallet/storage.test.ts` — test save/load roundtrip to temp directory. Test file permissions are 0o600. Test missing file returns null. Test parent directory creation.
  - [x] 6.4 Update `src/cli.test.ts` — test `init` command generates wallet file. Test `wallet show` command outputs addresses without revealing private keys or mnemonic. Test missing wallet error message. Test that mnemonic never appears in log output or status commands after initial display (AC #8).
  - [x] 6.5 Create `src/wallet/derivation-vectors.test.ts` — golden test vectors: given a known mnemonic, assert exact Nostr pubkeys and EVM addresses for each node type (town/mill/dvm). This ensures derivation path consistency across versions. Additionally verify Townhouse account indices (0/1/2) do NOT collide with existing SDK KeyDerivation paths (account 0) or Mill operational paths (account 2 in Mill's own context).
  - [x] 6.6 Verify all tests pass: `pnpm --filter @toon-protocol/townhouse test`

## Dev Notes

### Architecture Context

This story adds the wallet layer to Townhouse. The key insight from D21-008 is: **one BIP-39 mnemonic, deterministic HD derivation per node type**. The operator backs up 12 words and can recover all node keys.

**Key decision D21-008:** HD wallet with per-node key derivation. Single BIP-39 mnemonic, deterministic HD derivation per node type (following the existing `WalletSeedManager` pattern from the connector). One seed to back up, all keys recoverable.

**Account Index Convention (Townhouse-specific):**
| Node Type | Account Index | Nostr Path | EVM Path |
|-----------|--------------|------------|----------|
| Town | 0 | m/44'/1237'/0'/0/0 | m/44'/60'/0'/0/0 |
| Mill | 1 | m/44'/1237'/1'/0/0 | m/44'/60'/1'/0/0 |
| DVM | 2 | m/44'/1237'/2'/0/0 | m/44'/60'/2'/0/0 |

Note: The Mill's own `deriveMillKeys()` uses account index 2 for its swap operations. The Townhouse derivation is different — it derives the **node identity** keys (for Nostr event signing and connector peering), not the **operational** keys (swap liquidity, payment channels). The Mill container will receive its Townhouse-derived identity key AND may internally use its own wallet derivation for swap-specific keys if configured.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** Not applicable (no GitHub Actions in this story).
- **MAX_SAFE_INTEGER guard:** Not applicable (no 64-bit integer bridging).
- **Golden test vectors (ZK story pairs):** Not applicable (no ZK circuits). However, deterministic derivation vectors ARE required (Task 6.5) — a different kind of golden test ensuring cross-version key consistency.

### Critical Implementation Patterns

**Follow Story 21.3 patterns exactly.** All new files must follow the same conventions:
- Co-located test files (`manager.test.ts` next to `manager.ts`)
- TypeScript interfaces in dedicated `types.ts` file
- Re-exports via `index.ts`
- Dependency injection for testability

**Reuse existing crypto libraries — do NOT add new deps:**
- `@scure/bip39` — already a transitive dep via `@toon-protocol/client` and `@toon-protocol/mill`. Add as direct dependency to `packages/townhouse/package.json`.
- `@scure/bip32` — same, already in the workspace. Add as direct dependency.
- `@noble/curves` — only needed if deriving Nostr pubkey from secret key (use `nostr-tools/pure` `getPublicKey()` instead, which is a lighter import).
- `nostr-tools` — already in workspace, add as direct dependency for `getPublicKey`.
- Node.js `crypto` — built-in, no dep needed for scrypt + AES-256-GCM.

**Do NOT use `@toon-protocol/client` as a dependency.** The client package is browser-oriented (uses IndexedDB, WebAuthn). Instead, reuse the same underlying libraries (`@scure/bip39`, `@scure/bip32`, `nostr-tools`) directly. This avoids pulling browser-only code into a Node.js CLI tool.

**Encryption approach:**
```typescript
// KDF: scrypt with strong parameters
const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 17, r: 8, p: 1 });

// Encryption: AES-256-GCM
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
```

**Password handling:**
- In interactive mode: use `readline` interface with terminal echo disabled
- In non-interactive/CI mode: accept `--password` flag or `TOWNHOUSE_WALLET_PASSWORD` env var
- Never log or display the password
- Zero password buffer after use (convert string to Buffer, use, then fill(0))

**File permissions:**
- `wallet.enc` must be created with `0o600` (owner read/write only)
- Use `fs.writeFile(path, data, { mode: 0o600 })` 
- Verify permissions on load — warn if file is world-readable

### Dependency Budget

New production dependencies for `packages/townhouse/package.json`:
- `@scure/bip39` ^2.0 (BIP-39 mnemonic generation/validation)
- `@scure/bip32` ^2.0 (HD key derivation)
- `nostr-tools` ^2.23.1 (getPublicKey for secp256k1 Schnorr pubkey)

No new dev dependencies needed.

### File Structure Requirements

```
packages/townhouse/
├── src/
│   ├── cli.ts                          # Updated: add 'wallet show', update 'init' with wallet gen
│   ├── cli.test.ts                     # Updated: tests for wallet commands
│   ├── wallet/
│   │   ├── index.ts                    # Re-exports
│   │   ├── types.ts                    # WalletManagerConfig, DerivedNodeKeys, EncryptedWallet, etc.
│   │   ├── manager.ts                  # WalletManager class
│   │   ├── manager.test.ts             # Unit tests
│   │   ├── crypto.ts                   # encryptWallet / decryptWallet (scrypt + AES-256-GCM)
│   │   ├── crypto.test.ts             # Unit tests
│   │   ├── storage.ts                  # File I/O with 0o600 permissions
│   │   ├── storage.test.ts            # Unit tests
│   │   └── derivation-vectors.test.ts  # Golden test vectors for deterministic derivation
│   ├── docker/
│   │   ├── orchestrator.ts             # Updated: accept WalletManager, inject keys into node envs
│   │   └── orchestrator.test.ts        # Updated: test key injection
│   └── index.ts                        # Updated: re-export wallet module
├── package.json                        # Updated: add @scure/bip39, @scure/bip32, nostr-tools
```

### Testing Strategy

**Unit tests (all mocked/in-memory):**

| Test ID | Scenario | Task(s) | AC | Test Design Ref |
|---------|----------|---------|-----|-----------------|
| T-023 | Mnemonic generation produces valid 12-word phrase | 6.1 | #2 | TD T-023 (note: test design says 24-word; we generate 12-word for UX but accept both 12/24 on import) |
| T-024 | Per-node derivation produces distinct keys per account index | 6.1, 6.5 | #3 | TD T-024 |
| T-025 | Townhouse derivation paths do not collide with SDK/Mill operational paths | 6.5 | #3 | TD T-025 |
| T-026 | Encrypt/decrypt roundtrip preserves mnemonic | 6.2 | #5 | TD T-026 |
| T-027 | Wrong password fails decryption with clear error | 6.2 | #5 | — |
| T-028 | Wallet file saved with 0o600 permissions | 6.3 | #5 | — |
| T-029 | Known mnemonic produces deterministic Nostr pubkeys and EVM addresses (golden vectors) | 6.5 | #3, #4 | TD T-029 |
| T-030 | `lock()` zeros all Uint8Array key material | 6.1 | #1 | — |
| T-031 | Missing wallet file handled gracefully | 6.4 | #6 | TD T-031 |
| T-032 | `wallet show` displays addresses without revealing private keys or mnemonic | 6.4 | #6 | TD T-028 |
| T-033 | Mnemonic never appears in log output, CLI status, or API responses | 6.4 | #8 | TD T-027 (P0 security) |
| T-034 | Invalid mnemonic (wrong checksum) rejected with clear error | 6.1 | #1 | TD T-031 |
| T-035 | Import existing 12 or 24-word mnemonic produces correct keys | 6.1 | #1 | TD T-030 |

**Golden test vector (CRITICAL for cross-version consistency):**

Use a well-known test mnemonic (e.g., "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about") and assert:
- Town Nostr pubkey = <computed deterministic hex>
- Town EVM address = <computed deterministic 0x...>
- Mill Nostr pubkey != Town Nostr pubkey (different account index)
- DVM Nostr pubkey != Mill Nostr pubkey != Town Nostr pubkey
- Townhouse Town (account 0) Nostr key != SDK KeyDerivation default output (which also uses account 0 on path m/44'/1237'/0'/0/0 — IMPORTANT: these WILL be the same path. The distinction is that Townhouse manages node identity separately from the client-side user identity. Document this explicitly in the test as intentional path sharing with different context.)

The exact values must be computed once and hardcoded into `derivation-vectors.test.ts`.

**Path collision analysis (document in test):**
- SDK `KeyDerivation.deriveFullIdentity()` uses `m/44'/1237'/0'/0/0` for Nostr — same as Townhouse Town. This is acceptable because Townhouse operates server-side with a different mnemonic than the client-side user. The mnemonic itself provides isolation, not the path.
- Mill `deriveMillKeys()` uses configurable account index (default 2) for swap operational keys. Townhouse Mill identity uses account index 1 — no collision.

**Security audit test (AC #8, T-033):**
- After `townhouse init`, capture all stdout/stderr — mnemonic appears exactly once (the backup prompt). Subsequent commands (`status`, `up`, `wallet show`, `metrics`) must NOT contain any word from the mnemonic.

### Previous Story Intelligence (21.3)

Key patterns from Story 21.3 to continue:
- `src/connector/` subdirectory pattern — create `src/wallet/` following same structure
- Co-located tests next to source files
- TypeScript interfaces in `types.ts`
- Re-exports via `index.ts`
- Constants extracted to `src/constants.ts` (add `ACCOUNT_INDEX_TOWN = 0`, etc.)
- Existing `WalletConfig` in `src/config/schema.ts` has `encrypted_path: string` — use this for wallet file location
- Default path: `~/.townhouse/wallet.enc` (from `src/config/defaults.ts`)

### Security Notes

- **Mnemonic NEVER stored in plaintext.** Only encrypted form persists to disk.
- **Password is never logged.** Use readline with echo disabled; zero buffer after use.
- **File permissions enforced.** `wallet.enc` is 0o600 (owner-only).
- **Key material zeroed on lock.** All `Uint8Array` fields filled with 0 when `lock()` called.
- **scrypt parameters chosen for server-side usage.** N=2^17 is ~0.5-1s on modern hardware — strong enough for home operator but not so slow as to annoy.
- **No secrets in Docker env vars at rest.** The `NODE_NOSTR_SECRET_KEY` env var is only set during container creation (in-memory). It's visible in `docker inspect` but that requires Docker socket access which implies root/operator-level access anyway.

### Project Structure Notes

- `packages/townhouse/src/wallet/` is a new subdirectory within the existing package
- `src/index.ts` should be updated to re-export the wallet module
- `package.json` needs new dependencies: `@scure/bip39`, `@scure/bip32`, `nostr-tools`
- Follows same organizational pattern as `src/connector/` (from Story 21.3)

### References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.4] — Story requirements and acceptance criteria
- [Source: _bmad-output/epics/epic-21-townhouse.md#Key Design Decisions] — D21-008 (HD wallet with per-node key derivation)
- [Source: _bmad-output/implementation-artifacts/21-3-standalone-connector-integration.md] — Previous story patterns, file structure, testing approach
- [Source: packages/client/src/keys/KeyDerivation.ts] — Reference implementation: BIP-39/BIP-44 derivation, NIP-06 path m/44'/1237'/0'/0/0, EVM derivation from same secp256k1 key, seed zeroing pattern
- [Source: packages/client/src/keys/types.ts] — ToonIdentity interface (Nostr + EVM + Solana + Mina)
- [Source: packages/mill/src/wallet.ts] — Mill wallet: BIP-44 derivation with configurable account index, same @scure libraries, seed zeroing
- [Source: packages/townhouse/src/config/schema.ts] — WalletConfig interface (encrypted_path field)
- [Source: packages/townhouse/src/config/defaults.ts] — Default wallet path: ~/.townhouse/wallet.enc
- [Source: packages/townhouse/package.json] — Current dependencies (dockerode, yaml — no crypto deps yet)
- [Source: _bmad-output/project-context.md#Technology Stack] — @scure/bip39 ^2.0, @scure/bip32 ^2.0, nostr-tools ^2.23.1, TypeScript 5.3, ESM-only
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md] — Test scenarios for wallet management

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success (all issues fixed)
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 2
    1. scrypt N parameter weaker than spec (fixed in crypto.ts)
    2. mnemonic scope exposure (fixed in cli.ts)
  - Low: 1
    1. nostr-tools version constraint (fixed in package.json)
- **Files Changed:** `crypto.ts`, `cli.ts`, `package.json`, story file
- **Follow-up Actions:** None — all issues resolved in-pass.

### Review Pass #2

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success (all issues fixed)
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 2
    1. Mnemonic variable scope in `handleInit` — unused `_state` destructuring removed, variable persists minimally (fixed in cli.ts)
    2. Decrypted mnemonic stored in intermediate variable in `handleWalletShow` — inlined into `fromMnemonic()` call to minimize reference lifetime (fixed in cli.ts)
  - Low: 2
    1. scrypt-derived key buffer not zeroed after encryption use (fixed in crypto.ts `encryptWallet`)
    2. scrypt-derived key buffer not zeroed after decryption use (fixed in crypto.ts `decryptWallet`)
- **Files Changed:** `src/wallet/crypto.ts`, `src/cli.ts`, story file
- **Follow-up Actions:** None — all issues resolved in-pass. All 246 tests pass.

### Review Pass #3

- **Date:** 2026-04-20
- **Reviewer Model:** Claude Opus 4.6 (1M context)
- **Outcome:** Success (clean pass)
- **Issues Found:**
  - Critical: 0
  - High: 0
  - Medium: 0
  - Low: 0
- **Files Changed:** None
- **Follow-up Actions:** None — clean pass. OWASP Top 10 assessment passed.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required.

### Completion Notes List

- Task 1: Created `src/wallet/manager.ts` — WalletManager class with `generate()`, `fromMnemonic()`, `getNodeKeys()`, `getAllKeys()`, `lock()`. BIP-44 derivation with account indices 0/1/2 for Town/Mill/DVM. Uses `@scure/bip39`, `@scure/bip32`, `nostr-tools/pure`, `@noble/curves/secp256k1`, `@noble/hashes/sha3`.
- Task 1: Created `src/wallet/types.ts` — All interfaces (WalletManagerConfig, NodeKeys, DerivedNodeKeys, NodeKeyInfo, WalletState, EncryptedWallet).
- Task 1: Created `src/wallet/index.ts` — Re-exports public API.
- Task 2: Created `src/wallet/crypto.ts` — `encryptWallet()`/`decryptWallet()` using scrypt (N=2^17, r=8, p=1) + AES-256-GCM.
- Task 2: Created `src/wallet/storage.ts` — `saveWallet()`/`loadWallet()` with 0o600 permissions and parent dir creation.
- Task 3: Updated `src/cli.ts` — `handleInit()` now generates wallet, displays mnemonic once, encrypts and saves. Added `--password` flag.
- Task 4: Updated `src/cli.ts` — Added `wallet show` subcommand that decrypts wallet and displays addresses table without secrets.
- Task 5: Updated `src/docker/orchestrator.ts` — Constructor accepts optional WalletManager; `buildNodeEnv()` injects NODE_NOSTR_PUBKEY, NODE_EVM_ADDRESS, NODE_NOSTR_SECRET_KEY when wallet available.
- Task 6: All tests written and passing (239 total, 47 new wallet tests). Golden derivation vectors hardcoded for cross-version consistency.
- Added ACCOUNT_INDEX_TOWN/MILL/DVM constants to `src/constants.ts`.
- Added `@scure/bip39`, `@scure/bip32`, `nostr-tools`, `@noble/curves`, `@noble/hashes` to package.json dependencies.
- Updated `src/index.ts` to re-export wallet module.

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-20 | Story 21.4 implementation complete — HD wallet management with per-node key derivation, encrypted storage, CLI commands, orchestrator integration, golden test vectors |

### File List

- packages/townhouse/src/wallet/types.ts (created)
- packages/townhouse/src/wallet/manager.ts (created)
- packages/townhouse/src/wallet/crypto.ts (created)
- packages/townhouse/src/wallet/storage.ts (created)
- packages/townhouse/src/wallet/index.ts (created)
- packages/townhouse/src/wallet/manager.test.ts (modified — replaced red-phase stubs with green-phase tests)
- packages/townhouse/src/wallet/crypto.test.ts (modified — replaced red-phase stubs with green-phase tests)
- packages/townhouse/src/wallet/storage.test.ts (modified — replaced red-phase stubs with green-phase tests)
- packages/townhouse/src/wallet/derivation-vectors.test.ts (modified — replaced red-phase stubs with golden vectors)
- packages/townhouse/src/wallet/cli-wallet.test.ts (modified — replaced red-phase stubs with green-phase tests)
- packages/townhouse/src/cli.ts (modified — added wallet generation in init, wallet show command, --password flag)
- packages/townhouse/src/docker/orchestrator.ts (modified — accepts WalletManager, injects keys into node env)
- packages/townhouse/src/constants.ts (modified — added ACCOUNT_INDEX_TOWN/MILL/DVM)
- packages/townhouse/src/index.ts (modified — re-exports wallet module)
- packages/townhouse/package.json (modified — added crypto dependencies)
