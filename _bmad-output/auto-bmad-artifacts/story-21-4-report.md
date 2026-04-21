# Story 21.4 Report

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md`
- **Git start**: `2bcf397819de1683e56de603884925d43d1513f3`
- **Duration**: ~45 minutes wall-clock pipeline time
- **Pipeline result**: success
- **Migrations**: None

## What Was Built
HD wallet management and per-node key derivation for Townhouse. A single BIP-39 mnemonic generates deterministic Nostr keypairs and EVM addresses for Town (account 0), Mill (account 1), and DVM (account 2) nodes via BIP-44 derivation paths. The wallet is encrypted at rest with scrypt (N=2^17) + AES-256-GCM and stored with 0o600 file permissions.

## Acceptance Criteria Coverage
- [x] AC1: HD key derivation using @scure/bip39, @scure/bip32, nostr-tools directly — covered by: `manager.test.ts`, `derivation-vectors.test.ts`
- [x] AC2: `townhouse init` generates BIP-39 mnemonic — covered by: `cli-wallet.test.ts`
- [x] AC3: Per-node HD derivation with distinct account indices — covered by: `derivation-vectors.test.ts`, `manager.test.ts`
- [x] AC4: Nostr keypair + EVM address derived per node — covered by: `derivation-vectors.test.ts`
- [x] AC5: Wallet persisted encrypted at `~/.townhouse/wallet.enc` — covered by: `storage.test.ts`, `crypto.test.ts`
- [x] AC6: `townhouse wallet show` displays addresses without secrets — covered by: `cli-wallet.test.ts`
- [x] AC7: Docker orchestrator injects keys into node containers — covered by: `orchestrator.test.ts`
- [x] AC8: Mnemonic never appears in logs after initial display — covered by: `cli-wallet.test.ts`

## Files Changed
### packages/townhouse/src/wallet/ (new)
- `types.ts` — created: WalletManagerConfig, NodeKeys, DerivedNodeKeys, NodeKeyInfo, WalletState, EncryptedWallet interfaces
- `manager.ts` — created: WalletManager class (generate, fromMnemonic, getNodeKeys, getAllKeys, lock)
- `crypto.ts` — created: encryptWallet/decryptWallet (scrypt N=2^17 + AES-256-GCM)
- `storage.ts` — created: saveWallet/loadWallet with 0o600 permissions
- `index.ts` — created: re-exports public API
- `manager.test.ts` — modified: 20 tests
- `crypto.test.ts` — modified: 9 tests
- `storage.test.ts` — modified: 6 tests
- `derivation-vectors.test.ts` — modified: 13 golden tests
- `cli-wallet.test.ts` — modified: 10 tests

### packages/townhouse/src/ (modified)
- `cli.ts` — modified: wallet generation during init, `wallet show` command, `--password` flag
- `docker/orchestrator.ts` — modified: accepts WalletManager, injects NODE_NOSTR_PUBKEY/NODE_EVM_ADDRESS/NODE_NOSTR_SECRET_KEY
- `docker/orchestrator-connector.test.ts` — modified: lint fix (unused var)
- `docker/orchestrator.test.ts` — modified: 4 new wallet integration tests
- `constants.ts` — modified: added ACCOUNT_INDEX_TOWN=0, ACCOUNT_INDEX_MILL=1, ACCOUNT_INDEX_DVM=2
- `index.ts` — modified: re-exports wallet module

### packages/townhouse/
- `package.json` — modified: added @scure/bip39, @scure/bip32, nostr-tools, @noble/curves, @noble/hashes

### _bmad-output/
- `implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md` — created & updated through pipeline
- `implementation-artifacts/sprint-status.yaml` — modified: story status → done
- `test-artifacts/atdd-checklist-21-4.md` — created: ATDD checklist
- `test-artifacts/nfr-assessment-21-4.md` — created: NFR assessment
- `test-artifacts/traceability-report-21-4.md` — created: traceability matrix

## Pipeline Steps

### Step 1: Story Create
- **Status**: success
- **Duration**: ~2 min
- **What changed**: Story file created, sprint-status updated
- **Key decisions**: Account index convention Town=0/Mill=1/DVM=2; no @toon-protocol/client dependency; scrypt + AES-256-GCM encryption
- **Issues found & fixed**: 0

### Step 2: Story Validate
- **Status**: success
- **Duration**: ~3 min
- **What changed**: Story file refined
- **Key decisions**: 12-word mnemonic (accepts 12/24 on import); path collision acceptable (different mnemonics)
- **Issues found & fixed**: 7 (contradictory dependency, AC wording, missing security AC, test ID misalignment, missing import support, missing security test, unowned AC)

### Step 3: ATDD
- **Status**: success
- **Duration**: ~4 min
- **What changed**: 5 test files created (40 RED tests)
- **Key decisions**: Co-located test pattern; golden EVM vector from "abandon...about" mnemonic

### Step 4: Develop
- **Status**: success
- **Duration**: ~15 min
- **What changed**: 15 files (6 new source, 5 modified tests, 4 modified existing)
- **Key decisions**: Initially scrypt N=2^15 (Node.js memory limit); sync API; separate Nostr/EVM derivation paths
- **Issues found & fixed**: 1 (scrypt memory limit — reduced N parameter)

### Step 5: Post-Dev Artifact Verify
- **Status**: success
- **Duration**: ~30s
- **Issues found & fixed**: 2 (status corrections: complete→review, ready-for-dev→review)

### Step 6: Frontend Polish
- **Status**: skipped (backend-only story)

### Step 7: Post-Dev Lint & Typecheck
- **Status**: success
- **Duration**: ~2 min
- **Issues found & fixed**: 3 (2 unused-vars, 1 no-non-null-assertion)

### Step 8: Post-Dev Test
- **Status**: success
- **Duration**: ~30s
- **What changed**: None — 239 tests pass

### Step 9: NFR
- **Status**: success (PASS, 93%)
- **Duration**: ~3 min
- **What changed**: NFR assessment report created

### Step 10: Test Automate
- **Status**: success
- **Duration**: ~3 min
- **What changed**: 5 new tests (4 orchestrator wallet integration, 1 CLI security)
- **Issues found & fixed**: 1 gap (orchestrator had zero wallet integration tests)

### Step 11: Test Review
- **Status**: success
- **Duration**: ~3 min
- **What changed**: 3 test improvements (pinned golden vectors, permissions warning test, env var fallback test)
- **Issues found & fixed**: 3 (incomplete golden vectors, missing permissions test, missing env var test)

### Step 12: Code Review #1
- **Status**: success
- **Issues**: Critical 0, High 0, Medium 2, Low 1
- **What changed**: crypto.ts (scrypt N→2^17), cli.ts (mnemonic scope), package.json (nostr-tools version)

### Step 13: Review #1 Artifact Verify
- **Status**: success
- **Issues found & fixed**: 1 (added Code Review Record section)

### Step 14: Code Review #2
- **Status**: success
- **Issues**: Critical 0, High 0, Medium 2, Low 2
- **What changed**: cli.ts (inlined mnemonic), crypto.ts (key buffer zeroing)

### Step 15: Review #2 Artifact Verify
- **Status**: success — already correct

### Step 16: Code Review #3
- **Status**: success
- **Issues**: Critical 0, High 0, Medium 0, Low 0 (clean pass)
- **OWASP Top 10**: No vulnerabilities

### Step 17: Review #3 Artifact Verify
- **Status**: success
- **Issues found & fixed**: 3 (added review pass #3, status→done in story and sprint-status)

### Step 18: Security Scan (semgrep)
- **Status**: success
- **Issues found & fixed**: 1 (GCM auth tag length not explicitly set)

### Step 19: Regression Lint & Typecheck
- **Status**: success — clean

### Step 20: Regression Test
- **Status**: success — 246 tests pass

### Step 21: E2E
- **Status**: skipped (backend-only story)

### Step 22: Trace
- **Status**: success (PASS, 100% AC coverage)

## Test Coverage
- **Test files**: `manager.test.ts`, `crypto.test.ts`, `storage.test.ts`, `derivation-vectors.test.ts`, `cli-wallet.test.ts`, `orchestrator.test.ts`
- **Coverage**: All 8 acceptance criteria covered with happy + unhappy paths
- **Gaps**: None
- **Test count**: post-dev 239 → regression 246 (delta: +7)

## Code Review Findings

| Pass | Critical | High | Medium | Low | Total Found | Fixed | Remaining |
|------|----------|------|--------|-----|-------------|-------|-----------|
| #1   | 0        | 0    | 2      | 1   | 3           | 3     | 0         |
| #2   | 0        | 0    | 2      | 2   | 4           | 4     | 0         |
| #3   | 0        | 0    | 0      | 0   | 0           | 0     | 0         |

## Quality Gates
- **Frontend Polish**: skipped — backend-only story
- **NFR**: PASS (93%, 27/29 criteria) — 2 minor concerns not applicable to CLI tool
- **Security Scan (semgrep)**: PASS — 1 issue found and fixed (GCM auth tag length)
- **E2E**: skipped — backend-only story
- **Traceability**: PASS — 100% coverage, all 8 ACs mapped to tests

## Known Risks & Gaps
- JavaScript strings (mnemonic, password) cannot be zeroed in memory — language-level limitation. Implementation minimizes exposure scope and zeros Buffer keys.
- `NODE_NOSTR_SECRET_KEY` in Docker env vars is visible via `docker inspect` (requires root/Docker socket access). Documented as acceptable trade-off; future story could use Docker secrets.
- scrypt N=2^17 was restored per spec (was temporarily N=2^15 due to Node.js memory limit, fixed with explicit maxmem parameter).

---

## TL;DR
Story 21.4 implements HD wallet management for Townhouse: a single BIP-39 mnemonic derives deterministic Nostr keypairs and EVM addresses for Town/Mill/DVM nodes via BIP-44 paths, encrypted at rest with scrypt+AES-256-GCM. The pipeline completed cleanly with all 22 steps passing (2 skipped as backend-only), 246 tests green, 3 code review passes converging to zero issues, semgrep clean, and 100% acceptance criteria traceability. No action items require human attention.
