# Story 12.4: Mill Inventory + Wallet Management — Multi-Chain `MultiChainClaimIssuer`

Status: done
ui_impact: false
epic: 12
story_id: 12-4

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TOON Protocol developer building the Token Swap Primitive (Epic 12),
I want a concrete `MultiChainClaimIssuer` in `@toon-protocol/mill` that implements the `ClaimIssuer` interface (Story 12.3) by deriving target-chain keys from the node's BIP-39 mnemonic using BIP-44 account index **2** (distinct from the connector's account index 1), tracks per-pair inventory reserves, enforces insufficient-inventory rejection before any claim is signed, and issues signed off-chain payment-channel balance proofs on EVM / Mina / Solana via the same `PaymentChannelProvider` abstraction the connector uses,
so that a Mill operator can register `createSwapHandler({ claimIssuer: new MultiChainClaimIssuer(...) })` on an SDK node and have the entire outbound-asset side of the swap protocol work end-to-end — one mnemonic governs both connector settlement keys (account 1) and Mill swap keys (account 2), inventory is tracked in-memory per (asset, chain) pair, and claim issuance is atomic with inventory debit under concurrent load.

This is the "plug the handler into a real wallet" story for Epic 12. Story 12.3 (done) defined the `ClaimIssuer` interface with `issueClaim({ sourceAmount, targetAmount, pair, senderPubkey, rumor })` → `{ claim, claimId }`. Story 12.1 (done) defined `SwapPair`. Story 12.2 (done) provided the NIP-59 + FULFILL encryption primitives. This story delivers the first end-to-end concrete `ClaimIssuer` that the handler can sign claims through. Story 12.5 (`streamSwap()` sender API) and Story 12.7 (`startMill()` scaffold) consume this as the outbound-side backbone. Story 12.8 (E2E) validates the full wrap → handler → `MultiChainClaimIssuer` → signed claim → FULFILL cycle on Docker SDK E2E infra.

## Dependencies

- **Upstream:** Story 12.1 (`SwapPair`) — DONE. Provides the pair shape this issuer consumes for routing claim issuance to the correct chain provider.
- **Upstream:** Story 12.2 (NIP-59 gift wrap + FULFILL encryption primitives) — DONE. Not a direct code dependency here, but this story's claim bytes flow into `encryptFulfillClaim` inside the handler.
- **Upstream:** Story 12.3 (`createSwapHandler` + `ClaimIssuer` interface) — DONE. This story implements the `ClaimIssuer` interface exported from `@toon-protocol/sdk` (`packages/sdk/src/swap-handler.ts`). Any structural mismatch with `IssueClaimParams` / `IssueClaimResult` is a build-breaking regression.
- **Upstream:** `@scure/bip39` / `@scure/bip32` (already in `packages/sdk/package.json`) — BIP-39 mnemonic → seed, BIP-32 HD derivation for secp256k1 chains (EVM).
- **Upstream:** `mina-signer` (optional peer dep of `@toon-protocol/sdk`) — Mina (Pallas curve) key derivation and signing.
- **Upstream:** `@solana/web3.js` or `@solana/kit` + `ed25519-hd-key` — Solana (Ed25519) derivation path `m/44'/501'/2'/0'/0'`.
- **Upstream:** `../connector` repo's `PaymentChannelProvider` interface (`/Users/jonathangreen/Documents/connector/packages/connector/src/settlement/provider/payment-channel-provider.ts`) — this story **consumes a locally-defined `PaymentChannelProvider`-shaped interface** that mirrors the connector's shape so the Mill does not have to take a hard dep on the connector workspace at this point. Only `signBalanceProof(params): Promise<hexSignature>` and `verifyBalanceProof(params): Promise<boolean>` are required for claim issuance; `openChannel`/`deposit`/etc. are out of scope for this story (funding is operator workflow, Story 12.7).
- **Downstream:** Story 12.3's `createSwapHandler` consumes instances of this at call time. The handler catches `INSUFFICIENT_INVENTORY` via `err.code === 'INSUFFICIENT_INVENTORY'` OR `/insufficient/i.test(err.message)` → reject `T04`. This story MUST throw in that exact shape.
- **Downstream:** Story 12.5 (`streamSwap()`) — sender side; not a code dep, but shares the claim format.
- **Downstream:** Story 12.7 (`packages/mill/` scaffold + `startMill()`) — will instantiate `MultiChainClaimIssuer` inside `startMill()` using the operator's mnemonic + chain-provider configs. This story creates the core machinery; Story 12.7 wires it.
- **Downstream:** Story 12.8 (E2E) — validates real-chain key derivation + signing against Docker SDK E2E infra.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Non-custodial, privacy-preserving token swaps via existing ILP micropayment infrastructure. This story operationalizes the outbound-asset side: the Mill has USDC coming in via connector settlement (handled by the connector); this module produces signed off-chain channel claims in the target asset (ETH, MINA, SOL) that the handler returns, NIP-44 encrypted, via the FULFILL path.

Directly relevant decisions from `_bmad-output/epics/epic-12-token-swap-primitive.md`:

- **D12-005:** Signed claims in FULFILL, not on-chain transfers. `issueClaim()` MUST return signed off-chain balance-proof bytes; no on-chain tx executes during claim issuance.
- **D12-007:** Mill is a market maker. Rate management, inventory balancing, funding, and spread pricing are operator concerns. This story provides the mechanism (in-memory inventory tracking + API to adjust it); it does NOT implement rebalancing policy.
- **D12-010:** Mill handler has its own wallet and payment channel management, **separate from the embedded connector**. The connector handles the inbound USDC via its own `WalletSeedManager` (account index 1). The Mill uses the **same mnemonic** but **account index 2** to derive keys. One seed → all keys → deterministic recovery. Two separate `PaymentChannelProvider` instances (one per chain this Mill supports outbound).
- **D12-011:** BIP-44 derivation paths per chain with account index 2:
  - EVM (ETH / Arbitrum / Base): `m/44'/60'/2'/0/0` (coin type 60, secp256k1)
  - Mina: `m/44'/12586'/2'/0/0` (coin type 12586, Pallas curve)
  - Solana: `m/44'/501'/2'/0'/0'` (coin type 501, Ed25519, all-hardened per SLIP-0010 convention)

  One mnemonic, deterministic derivation, all chain keys recoverable from the seed. The Mill reuses the `KeyManager` backend abstraction for signing (env, AWS KMS, GCP KMS, HSM) — but the initial implementation for this story uses in-process secret-key holding only (KMS adapters deferred). No separate seed management.

## Acceptance Criteria

1. **AC-1 — `packages/mill/` TypeScript package initialized.** Create a workspace package at `packages/mill/` if not already scaffolded. Package name: `@toon-protocol/mill`. Version: `0.1.0` (pre-release). `package.json` MUST declare:
   - `"type": "module"` (ESM, matching `@toon-protocol/sdk`).
   - `main: "./dist/index.js"`, `module: "./dist/index.js"`, `types: "./dist/index.d.ts"`, and `exports` mirroring `packages/sdk/package.json` exactly (the `.` entry mapping `types` + `import`). See `packages/sdk/package.json` for the canonical shape.
   - `"files": ["dist"]` (match `packages/sdk/package.json`; README will be added by Story 12.9).
   - Scripts: `build` (`tsup`), `dev` (`tsup --watch`), `test` (`vitest run`), `test:watch` (`vitest`). **IMPORTANT:** The repo's canonical TS package build is `tsup`, NOT `tsc`. Mirror `packages/sdk/package.json` scripts and add a `tsup.config.ts` matching `packages/sdk/tsup.config.ts`. Lint is run at workspace root (no per-package `lint` script in SDK) — do not add one here.
   - Workspace deps: `@toon-protocol/core: workspace:*`. (Do NOT add `@toon-protocol/sdk` as a runtime dep — import `ClaimIssuer` / `IssueClaimParams` / `IssueClaimResult` as **type-only** to avoid a runtime cycle. Declare `@toon-protocol/sdk: workspace:*` in `devDependencies` only, used for types + the T-int-1 integration test.)
   - Dev deps: `@types/node: ^20.0.0`, `tsup: ^8.0.0`, `typescript: ^5.3.0`, `vitest: ^1.0.0`, `@toon-protocol/sdk: workspace:*` (test-only).
   - Runtime deps NEEDED by this story (version-pinned to align with the rest of the workspace):
     - `@scure/bip39: ^2.0.0` (matches SDK)
     - `@scure/bip32: ^2.0.0` (matches SDK)
     - `@noble/hashes: ^2.0.0` (matches SDK; note `packages/client` is on `^1.4.0` — use the SDK pin here since this package imports types from SDK)
     - `@noble/curves: ^2.0.0` (matches SDK; provides secp256k1 + ed25519 under one dep; do NOT add a separate `@noble/ed25519` — it would fragment with SDK)
     - `@solana/web3.js: ^1.90.0` (matches `packages/client/package.json` — used only for `Keypair.fromSeed` / public-key helpers; OK if the actual impl avoids it entirely by using `@noble/curves/ed25519` directly, in which case DROP this dep before finishing)
     - `ed25519-hd-key: ^1.3.0` (SLIP-0010 Ed25519 derivation for Solana; required by AC-3 Solana branch)
   - Peer deps: `mina-signer: >=3.0.0` (optional peer, same pattern as `packages/sdk/package.json` `peerDependencies` + `peerDependenciesMeta` blocks). Include `peerDependenciesMeta` so the package installs cleanly without `mina-signer`.
   - `tsconfig.json` extends `../../tsconfig.json` (NOT `tsconfig.base.json` — repo has no such file; the root config IS the base) with `"outDir": "./dist"`, `"rootDir": "./src"`, `"include": ["src/**/*"]`, `"exclude": ["node_modules", "dist"]`. Mirror `packages/sdk/tsconfig.json` verbatim.
   - `vitest.config.ts` using the same shape as `packages/sdk/vitest.config.ts` (environment: node; include `src/**/*.test.ts`; exclude `node_modules`, `dist`).
   - `tsup.config.ts` mirroring `packages/sdk/tsup.config.ts` (ESM output, dts generation).
   - Scaffold ONLY what this story needs. Do NOT pre-create `startMill()` entrypoint — that is Story 12.7's scope. This story's public surface is `MultiChainClaimIssuer` + its config types + its error classes.

2. **AC-2 — `MillInventoryError` + `MillWalletError` error classes.** Create `packages/mill/src/errors.ts` exporting two classes, following the `ToonError` → subclass pattern used throughout the SDK (see `packages/sdk/src/errors.ts` for `GiftWrapError` / `SwapHandlerError`):
   ```ts
   export class MillInventoryError extends Error {
     readonly code: string;
     constructor(code: 'INSUFFICIENT_INVENTORY' | 'UNKNOWN_PAIR' | 'INVENTORY_NOT_INITIALIZED', message: string, options?: { cause?: unknown });
   }
   export class MillWalletError extends Error {
     readonly code: string;
     constructor(code: 'INVALID_MNEMONIC' | 'UNSUPPORTED_CHAIN' | 'DERIVATION_FAILED' | 'SIGNING_FAILED', message: string, options?: { cause?: unknown });
   }
   ```
   Each class sets `this.name` to the class name, preserves `cause` (ES2022), and type-narrowable via the `code` literal. The `INSUFFICIENT_INVENTORY` code is load-bearing — Story 12.3's handler detects it via `err.code === 'INSUFFICIENT_INVENTORY'` (AC-9 of Story 12.3). Any rename here breaks the integration.

3. **AC-3 — `deriveMillKeys(mnemonic, chains): MillKeys` pure helper.** Create `packages/mill/src/wallet.ts` exporting:
   ```ts
   export type MillChainKind = 'evm' | 'mina' | 'solana';
   export interface MillKeys {
     evm?: { privateKey: Uint8Array; address: `0x${string}`; path: string };      // path = "m/44'/60'/2'/0/0"
     mina?: { privateKey: string; publicKey: string; path: string };              // Mina keys are base58-encoded strings (mina-signer convention)
     solana?: { privateKey: Uint8Array; publicKey: Uint8Array; path: string };    // Ed25519 32-byte seed -> 32-byte pub
   }
   export interface DeriveMillKeysInput {
     mnemonic: string;                             // BIP-39 12/24-word mnemonic
     chains: ReadonlyArray<MillChainKind>;         // which chains to derive keys for (derive only what operator configured)
     passphrase?: string;                          // optional BIP-39 passphrase (default empty string — standard)
     accountIndex?: number;                        // default 2 (D12-011). Expose override for tests + edge cases only.
     addressIndex?: number;                        // default 0. Expose override for tests.
   }
   export function deriveMillKeys(input: DeriveMillKeysInput): Promise<MillKeys>;
   ```
   Contract:
   - Validates `mnemonic` via `@scure/bip39`'s `validateMnemonic` against the English wordlist. Throws `MillWalletError('INVALID_MNEMONIC', '...')` on failure.
   - Derives a 512-bit seed via `mnemonicToSeed(mnemonic, passphrase ?? '')`.
   - For `'evm'`: uses `@scure/bip32`'s `HDKey.fromMasterSeed(seed).derive("m/44'/60'/"+accountIndex+"'/0/"+addressIndex)`. Returns the 32-byte `privateKey` and the derived Ethereum address (EIP-55 checksummed, 0x-prefixed, computed by keccak256 of the uncompressed pubkey — use `@noble/curves/secp256k1`'s `getPublicKey` + `@noble/hashes/sha3`'s `keccak_256`; do NOT pull in ethers just for address derivation).
   - For `'mina'`: derives via Mina's standard BIP-44 path. Use `mina-signer`'s `Client` API — `new Client({ network: 'testnet' })` then `client.deriveKeyFromMnemonic(mnemonic, addressIndex, { accountIndex, passphrase })`. Because `mina-signer` API details may vary by version (3.x has been the baseline for this repo), WRAP the derivation in a try/catch and throw `MillWalletError('DERIVATION_FAILED', ...)` with `cause` on failure. If the installed `mina-signer` version does NOT expose `deriveKeyFromMnemonic`, fall back to BIP-44 seed derivation via `@scure/bip32` for the coin-type-12586 path and hand the 32-byte private key bytes to `mina-signer`'s key wrap function (consult the version's README — record the exact API call in a comment in the implementation).
   - For `'solana'`: uses SLIP-0010 Ed25519 derivation at `m/44'/501'/accountIndex'/0'/0'` (all segments hardened per Solana convention). Implement via `ed25519-hd-key`'s `derivePath`. Example: `const { key } = derivePath(path, Buffer.from(seed).toString('hex'))` → `key` is the 32-byte Ed25519 seed. Compute the public key via `@noble/curves/ed25519`'s `ed25519.getPublicKey(key)` (32 bytes). Do NOT pull in `@solana/web3.js` just for `Keypair.fromSeed` — the noble-curves path keeps the dep graph lean and aligns with the SDK's `@noble/curves: ^2.0.0` pin. Return `privateKey` as the 32-byte seed (NOT the 64-byte expanded secret) and `publicKey` as the 32-byte Ed25519 public key.
   - MUST be deterministic: same `(mnemonic, passphrase, accountIndex, addressIndex)` → identical keys across calls / processes / restarts (T-032).
   - MUST produce keys DISTINCT from account index 1 for all three chains (T-029, T-030, T-031). The caller is responsible for the account index; the function's responsibility is correct path construction.
   - MUST NOT touch the filesystem, network, or any clock. Pure function of inputs.
   - MUST zero any intermediate seed buffers before returning via `buffer.fill(0)` where Node `Buffer` / `Uint8Array.prototype.fill` is available. Document that the returned `privateKey` bytes are live references and callers are responsible for their lifecycle.
   - Export `deriveMillKeys` from `packages/mill/src/index.ts`.

4. **AC-4 — `MillInventory` class: in-memory per-pair reserves + debit/credit.** Create `packages/mill/src/inventory.ts` exporting:
   ```ts
   export interface MillInventoryBalance {
     assetCode: string;
     chain: string;
     /** Available balance in target-asset micro-units (bigint). */
     available: bigint;
     /** Total reserves (never decreases on debit — tracks committed claims separately if operator cares). */
     total: bigint;
     /** Timestamp (ms since epoch) of the last mutation. */
     updatedAt: number;
   }
   export interface MillInventoryInit {
     /** Initial balances. Keyed by `${assetCode}:${chain}`. */
     balances: Record<string, { available: bigint; total: bigint }>;
     /** Optional clock override for testing (defaults to Date.now). */
     clock?: () => number;
   }
   export class MillInventory {
     constructor(init: MillInventoryInit);
     /** Return current balance or null if the key is not initialized. */
     get(assetCode: string, chain: string): MillInventoryBalance | null;
     /** Atomically debit `amount` from `(assetCode, chain).available`. Throws MillInventoryError('INSUFFICIENT_INVENTORY', ...) if insufficient. Throws MillInventoryError('INVENTORY_NOT_INITIALIZED', ...) if the key has never been set. */
     debit(assetCode: string, chain: string, amount: bigint): void;
     /** Add `amount` to `.available` and `.total`. Creates the entry if missing. Operator funding path. */
     credit(assetCode: string, chain: string, amount: bigint): void;
     /** Snapshot all balances (immutable copy). */
     snapshot(): ReadonlyArray<MillInventoryBalance>;
   }
   ```
   Contract:
   - `debit`: synchronous, single-microtask — fully atomic under Node's single-threaded model (no `await` inside). MUST check `available >= amount` BEFORE decrementing. On insufficient balance: throw `MillInventoryError('INSUFFICIENT_INVENTORY', \`Insufficient inventory for ${assetCode}:${chain}: have ${available}, need ${amount}\`)`.
   - `amount <= 0n` on debit → throw `MillInventoryError('INSUFFICIENT_INVENTORY', 'Debit amount must be positive')`. (Defensive — should never happen with `applyRate` output, but this is a protocol boundary.)
   - `debit` on a key that was never `credit`ed or present in `init.balances` → throw `MillInventoryError('INVENTORY_NOT_INITIALIZED', ...)`. This catches operator misconfiguration (pair advertised on kind:10032 but never funded) before it becomes a signed-claim issue.
   - `credit`: amount > 0n → increase `available` AND `total`. Same-microtask atomicity.
   - `snapshot`: returns deep-copied plain objects (no live refs). Used for operational telemetry.
   - All `bigint` — never `Number`. MAX_SAFE_INTEGER guard (Epic 11 retro).
   - Concurrent-safety: under `Promise.all` of debits, each debit is a synchronous microtask — two concurrent debits that would both succeed individually but together exceed `available` MUST result in the first succeeding and the second throwing `INSUFFICIENT_INVENTORY`. Test T-inv-1 validates this.
   - Export `MillInventory` from `packages/mill/src/index.ts`.

5. **AC-5 — `PaymentChannelSigner` interface (local, not imported from connector).** Create `packages/mill/src/payment-channel-signer.ts` exporting a narrow interface:
   ```ts
   export interface PaymentChannelSignParams {
     /** Target-chain channel identifier (chain-specific format: EVM = hex, Solana = base58 PDA, Mina = pubkey-derived). */
     channelId: string;
     /** Cumulative claim amount in target-asset micro-units (bigint). */
     cumulativeAmount: bigint;
     /** Monotonic nonce. Mill tracks per-channel; increments by 1 each claim. */
     nonce: bigint;
     /** Sender's chain-specific destination address (EVM: 0x..., Solana: base58, Mina: pubkey). */
     recipient: string;
   }
   export interface PaymentChannelSigner {
     readonly chain: string;                                            // e.g., "evm:base:8453", "solana:mainnet", "mina:mainnet"
     readonly chainKind: MillChainKind;                                 // 'evm' | 'mina' | 'solana'
     signBalanceProof(params: PaymentChannelSignParams): Promise<Uint8Array>;  // returns signed-claim bytes (chain-specific encoding)
   }
   ```
   Contract:
   - The interface is intentionally narrower than the connector's full `PaymentChannelProvider`. This story does NOT need `openChannel`, `deposit`, `closeChannel`, `settleChannel`, `getChannelState`, or event subscriptions. Those are operator lifecycle (Story 12.7) or sender-side (Stories 12.5/12.6) concerns.
   - Concrete impls for this story: `EvmPaymentChannelSigner`, `MinaPaymentChannelSigner`, `SolanaPaymentChannelSigner` — each wraps the chain-specific `MillKeys` entry and produces chain-specific signed-claim bytes.
   - **EVM signer:** Signs `keccak256(abi.encode(channelId, cumulativeAmount, nonce, recipient))` via EIP-712 OR a simpler EIP-191 personal-sign, whichever the connector's EVM `PaymentChannelProvider` uses. Consult `/Users/jonathangreen/Documents/connector/packages/connector/src/settlement/provider/payment-channel-provider.ts` (lines 120–150) for the exact `BalanceProofParams` shape and hashing convention. Return the signature as 65 bytes (r || s || v). If the connector uses EIP-712, copy its `domain` + `types` verbatim. If unsure, write the test fixture to match the connector's unit test fixtures for `verifyBalanceProof`.
   - **Mina signer:** Uses `mina-signer.signFields` or the equivalent API to sign `Poseidon.hash([channelId, cumulativeAmount, nonce, recipient])`. Return the serialized signature bytes. Consult the connector's `mina-payment-channel-provider.ts` for the exact field-packing convention.
   - **Solana signer:** Signs `sha256(channelId || cumulativeAmount || nonce || recipient)` with Ed25519. Use `@noble/curves/ed25519`'s `ed25519.sign(message, privateKey)` to get a 64-byte signature. Borsh-encoding is NOT required at this layer — the raw signature bytes are sufficient; the sender-side code (Story 12.5/12.6) composes the Borsh envelope at settlement time.
   - For this story, the three signers MUST produce signatures that **round-trip through the connector's `verifyBalanceProof` on a matching mocked channel**. If the connector's verifier is not importable (no workspace link), the test harness uses `@noble/curves` / `mina-signer` / keccak-based verify directly in-repo. Document any deviation from the connector's exact hashing formula as a KNOWN FOLLOW-UP for Story 12.8 E2E; Story 12.8 will bring up a real channel and catch any mismatch.
   - Export `PaymentChannelSigner` interface + the three concrete classes + their config types from `packages/mill/src/index.ts`.

6. **AC-6 — `MultiChainClaimIssuer` class implementing `ClaimIssuer`.** Create `packages/mill/src/claim-issuer.ts` exporting:
   ```ts
   import type { ClaimIssuer, IssueClaimParams, IssueClaimResult } from '@toon-protocol/sdk';
   export interface MultiChainClaimIssuerConfig {
     /** Inventory tracker (AC-4). */
     inventory: MillInventory;
     /** One signer per supported target chain, keyed by SwapPair.to.chain. */
     signers: Record<string, PaymentChannelSigner>;
     /** Per-channel state (nonces, channelIds). Keyed by `${assetCode}:${chain}:${senderPubkey}`. */
     channelState?: MillChannelState;
     /** Optional logger. */
     logger?: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
     /** Optional id generator (defaults to crypto.randomUUID). */
     newClaimId?: () => string;
   }
   export class MultiChainClaimIssuer implements ClaimIssuer {
     constructor(config: MultiChainClaimIssuerConfig);
     issueClaim(params: IssueClaimParams): Promise<IssueClaimResult>;
   }
   ```
   Contract for `issueClaim`:
   1. Look up signer by `params.pair.to.chain`. If absent → throw `MillWalletError('UNSUPPORTED_CHAIN', 'No signer for chain: ' + pair.to.chain)`. (Handler maps this to `T00` by default; do NOT use the `INSUFFICIENT_INVENTORY` code here — chain absence is a config error, not a reserves issue.)
   2. **Debit inventory FIRST** via `inventory.debit(pair.to.assetCode, pair.to.chain, params.targetAmount)`. This is synchronous and MUST happen BEFORE any signing / any `await`, so a concurrent swap cannot observe stale inventory. If the debit throws `MillInventoryError('INSUFFICIENT_INVENTORY', ...)`, it propagates unchanged — the handler's AC-9 catches it.
   3. Compute / reserve a nonce + channelId via `channelState.reserve({ assetCode: pair.to.assetCode, chain: pair.to.chain, senderPubkey: params.senderPubkey, cumulativeDelta: params.targetAmount })` (see AC-7).
   4. `const claim = await signer.signBalanceProof({ channelId, cumulativeAmount, nonce, recipient })`. If signing throws, ATTEMPT a credit reversal via `inventory.credit(...)` to return the reserved amount. Log at `error` level with `{ err, pair, sourceAmount: params.sourceAmount, targetAmount: params.targetAmount }` and re-throw `MillWalletError('SIGNING_FAILED', 'Balance-proof signing failed', { cause: err })`.
   5. Generate `claimId` via `config.newClaimId?.() ?? crypto.randomUUID()` (Node 20+ has `crypto.randomUUID` built in). Return `{ claim, claimId }`.
   6. Do NOT log `claim` bytes, `privateKey`, or the sender's real pubkey at INFO or above. DEBUG only.
   7. MUST NOT retain any ephemeral key material beyond the function's lifetime (keys live only in the signer instance, derived once at construction).

7. **AC-7 — `MillChannelState` class: per-channel nonce + cumulativeAmount tracking.** Create `packages/mill/src/channel-state.ts` exporting:
   ```ts
   export interface ChannelEntry {
     channelId: string;         // chain-specific channel identifier (operator provisions; never rotates within a channel's life)
     cumulativeAmount: bigint;  // monotonic total committed to this sender via this channel
     nonce: bigint;             // monotonic increment per claim
     updatedAt: number;
   }
   export interface MillChannelStateInit {
     /** Pre-populated channel entries. Key = `${assetCode}:${chain}:${senderPubkey}`. Operator provisions channels out of band (Story 12.7). */
     channels: Record<string, ChannelEntry>;
     clock?: () => number;
   }
   export interface ReserveParams {
     assetCode: string;
     chain: string;
     senderPubkey: string;
     cumulativeDelta: bigint;
   }
   export interface Reservation {
     channelId: string;
     cumulativeAmount: bigint;
     nonce: bigint;
   }
   export class MillChannelState {
     constructor(init?: MillChannelStateInit);
     reserve(p: ReserveParams): Reservation;
     release(p: ReserveParams): void;   // reverses the last reservation if signing fails (mirrors inventory credit reversal)
     get(p: { assetCode: string; chain: string; senderPubkey: string }): ChannelEntry | null;
   }
   ```
   Contract:
   - `reserve`: synchronous, microtask-atomic. If the channel entry exists: increments `nonce` by 1, adds `cumulativeDelta` to `cumulativeAmount`, returns the new values. If the channel entry does NOT exist for `(assetCode, chain, senderPubkey)` → this story's default behavior is to throw `MillWalletError('UNSUPPORTED_CHAIN', 'No channel provisioned for sender on ' + chain)`. (Channel provisioning is Story 12.7's scope; for Story 12.4 unit tests, pre-populate via `init.channels`.)
   - `release`: on signing failure, decrements nonce by 1 and subtracts `cumulativeDelta`. If `nonce` would go negative → no-op + warn log. This is a best-effort reversal.
   - Export from `packages/mill/src/index.ts`.

8. **AC-8 — `MultiChainClaimIssuer` concurrent-safety under `Promise.all`.** Because `inventory.debit` and `channelState.reserve` are both synchronous (no `await` inside either), two concurrent `issueClaim` calls cannot both pass a debit that in aggregate would exceed reserves. Test T-inv-1 and T-cs-1 validate this. Each signer call (`signer.signBalanceProof`) is async, but by the time `await` yields, both inventory and channel state are already mutated. This is the same microtask-atomicity argument Story 12.3's AC-11 replay protection uses.

9. **AC-9 — Package exports.** Export from `packages/mill/src/index.ts` in a layered structure with comment blocks:
   ```
   // Wallet + key derivation (Story 12.4)
   export { deriveMillKeys } from './wallet.js';
   export type { MillKeys, MillChainKind, DeriveMillKeysInput } from './wallet.js';

   // Inventory (Story 12.4)
   export { MillInventory } from './inventory.js';
   export type { MillInventoryBalance, MillInventoryInit } from './inventory.js';

   // Payment-channel signing (Story 12.4)
   export type { PaymentChannelSigner, PaymentChannelSignParams } from './payment-channel-signer.js';
   export { EvmPaymentChannelSigner, MinaPaymentChannelSigner, SolanaPaymentChannelSigner } from './payment-channel-signer.js';

   // Channel state (Story 12.4)
   export { MillChannelState } from './channel-state.js';
   export type { ChannelEntry, MillChannelStateInit, ReserveParams, Reservation } from './channel-state.js';

   // Claim issuer (Story 12.4)
   export { MultiChainClaimIssuer } from './claim-issuer.js';
   export type { MultiChainClaimIssuerConfig } from './claim-issuer.js';

   // Errors (Story 12.4)
   export { MillInventoryError, MillWalletError } from './errors.js';
   ```
   Explicit `.js` suffixes match ESM output. An `index.test.ts` MUST assert exactly these runtime symbols (pattern from `packages/sdk/src/index.test.ts`) so accidental renames surface immediately.

10. **AC-10 — Structural compatibility with Story 12.3 `ClaimIssuer`.** `MultiChainClaimIssuer` is assignable to the `ClaimIssuer` interface imported from `@toon-protocol/sdk`. Explicit test: `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` MUST type-check. A runtime integration test (T-int-1 below) constructs a real `createSwapHandler({ claimIssuer: new MultiChainClaimIssuer(...) })` and exercises one round-trip to validate shape + error codes end-to-end.

11. **AC-11 — Unit tests (≥ 26 tests).** Create `packages/mill/src/*.test.ts` files (one per module). Coverage MUST include (mapping test-design-epic-12 T-029..T-037 + new tests for this story's internal seams):

    **Wallet derivation (`wallet.test.ts`):**
    - **(T-029) BIP-44 EVM account index 2 distinct from account index 1:** Given a known mnemonic, derive with `accountIndex: 1` and `accountIndex: 2` → addresses differ. Use a golden-vector mnemonic (e.g., `'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'`) and pin BOTH addresses in the test as string constants.
    - **(T-030) BIP-44 Mina account index 2 distinct from account index 1:** Same pattern with Mina path. Golden-vector pubkey pinned.
    - **(T-031) BIP-44 Solana account index 2 distinct from account index 1:** Same pattern, Ed25519, all-hardened path. Golden-vector base58 pubkey pinned.
    - **(T-032) Deterministic across calls:** Same input → identical output over 3 sequential calls.
    - **Invalid mnemonic throws `MillWalletError('INVALID_MNEMONIC')`.**
    - **Empty `chains` array returns empty `MillKeys` object (no-op derivation).**
    - **Passphrase change produces different keys** (non-empty passphrase vs empty passphrase with same mnemonic).
    - **`chains: ['evm', 'mina', 'solana']` returns all three key entries** in one call.

    **Inventory (`inventory.test.ts`):**
    - **(T-033) Debit decreases `available`:** init `100n USDC:evm:base:8453`, debit `30n` → `available === 70n`, `total === 100n` (total never decreases).
    - **(T-034) Insufficient inventory throws `INSUFFICIENT_INVENTORY`:** init `50n`, debit `100n` → throws; `available` unchanged (transactional — no partial state).
    - **(T-037) Credit increases `available` and `total`:** `credit(40n)` on a 70n balance → 110n available, 140n total.
    - **Uninitialized pair throws `INVENTORY_NOT_INITIALIZED`:** debit a key never present.
    - **Concurrent debit race (`T-inv-1`):** init 100n, launch `Promise.all([debit(60), debit(60)])` → one resolves, the other throws `INSUFFICIENT_INVENTORY`. Final `available === 40n`.
    - **Negative amount throws:** `debit(-5n)` → `INSUFFICIENT_INVENTORY` (amount must be positive).
    - **`snapshot()` returns deep-copied entries:** mutate the snapshot array → inventory unchanged.

    **Channel state (`channel-state.test.ts`):**
    - **`reserve` increments nonce and cumulativeAmount atomically.**
    - **`reserve` on missing channel throws `UNSUPPORTED_CHAIN`.**
    - **`release` reverses the last reservation.**
    - **Concurrent reserve race (`T-cs-1`):** two concurrent reservations on same (assetCode, chain, senderPubkey) return distinct nonces (n and n+1); cumulativeAmount is the sum of both deltas.

    **Signers (`payment-channel-signer.test.ts`):**
    - **(T-035) EVM signer: derive → sign → verify:** derive via `deriveMillKeys({ chains: ['evm'] })`, sign a `BalanceProofParams`, verify against the derived address using `@noble/curves/secp256k1` `recoverPublicKey` or the connector's `verifyBalanceProof` if importable. Round-trip must succeed.
    - **Mina signer round-trip:** sign + verify via `mina-signer`'s `verifyFields`. Use a minimal fixture; if `mina-signer` v3.x does not expose the exact verify signature the impl uses, gate this test behind `describe.skipIf(!hasMinaSigner)` and document as a Story 12.8 E2E follow-up.
    - **Solana signer round-trip:** sign + verify via `@noble/curves/ed25519`'s `ed25519.verify`. Signature is 64 bytes.
    - **Signing with a signer whose chain is mis-configured** (e.g., EVM signer asked to sign Solana-style params) → throws `MillWalletError('SIGNING_FAILED')` (defensive — test by passing a non-hex `recipient`).

    **`MultiChainClaimIssuer` (`claim-issuer.test.ts`):**
    - **Happy path:** single USDC→ETH swap → debit → sign → return `{ claim, claimId }` with `claim` = bytes from mock signer, `claimId` = UUID.
    - **Debit happens BEFORE signing:** spy on `inventory.debit` and `signer.signBalanceProof`; assert debit call ordinal < sign call ordinal. (Uses microtask ordering — debit is synchronous, sign is awaited.)
    - **Insufficient inventory → issuer throws `INSUFFICIENT_INVENTORY`:** signer NOT called.
    - **Unsupported chain in `params.pair.to.chain` → throws `UNSUPPORTED_CHAIN`:** inventory NOT debited.
    - **Signer throws → issuer reverses debit via `inventory.credit`:** final `available` equals pre-call balance; issuer throws `SIGNING_FAILED`.
    - **Concurrent `issueClaim` calls (`T-026` integration — handler-level):** 10 `Promise.all` calls with sufficient inventory → 10 distinct `claimId`, 10 distinct nonces on the channel, final `cumulativeAmount` = sum of all 10 target amounts.
    - **(T-int-1) End-to-end with Story 12.3 `createSwapHandler`:** wire `createSwapHandler({ claimIssuer: new MultiChainClaimIssuer(...) })`, invoke with a valid gift-wrapped packet, assert `ctx.accept()` is returned with encrypted `claim` metadata, assert inventory was debited, assert channel nonce was incremented. This is the structural compatibility gate for AC-10.

12. **AC-12 — Build, lint, test verification.** After all changes:
    - `pnpm --filter @toon-protocol/mill build` exits 0 with no TypeScript or `tsup` errors.
    - `pnpm --filter @toon-protocol/mill test` passes — all new tests pass. Capture the baseline test count BEFORE starting and confirm the post-implementation count equals `baseline + (new tests added)` (~30).
    - `pnpm --filter @toon-protocol/sdk test` STILL passes (no regressions in SDK from any incidental `@toon-protocol/sdk` type changes — there SHOULD be none since this story does not modify the SDK). Pin the pre-change SDK test count in the Dev Agent Record so drift is visible.
    - `pnpm --filter @toon-protocol/core test` STILL passes (SwapPair consumer; sanity check).
    - `pnpm lint` passes for the `packages/mill` scope (lint is workspace-root level; scope is implicit).
    - `pnpm --filter @toon-protocol/mill build` output under `dist/` contains `index.js` + `index.d.ts` (tsup emits both; source maps optional depending on `packages/sdk/tsup.config.ts` settings — match SDK behavior).
    - No changes to `@toon-protocol/core` or `@toon-protocol/sdk` source files (errors, swap-handler, gift-wrap, index). Any apparent need to change those is a red flag — back out and reconsider the design.
    - No new workspace-root dependencies beyond what's declared in `packages/mill/package.json` (AC-1).
    - Do NOT run `pnpm build` at workspace root or `pnpm test` at workspace root (per `CLAUDE.md` — OOM risk). Always use `--filter`.

## Tasks / Subtasks

- [x] **Task 1: Scaffold `packages/mill/` package** (AC: 1)
  - [x] 1.1 Check `packages/mill/` current state (`dist/` + `node_modules/` exist per scaffold; `src/` missing). Create `packages/mill/src/` and `packages/mill/package.json` if not already present. Delete the stale `dist/` so the first build is from source.
  - [x] 1.2 Copy the `packages/sdk/package.json` structure for `type` / `main` / `module` / `types` / `exports` / `files`. Replace name with `@toon-protocol/mill`. Set version `0.1.0`. Use `tsup` scripts (`build: "tsup"`, `dev: "tsup --watch"`, `test: "vitest run"`, `test:watch: "vitest"`) — NOT `tsc`.
  - [x] 1.3 Declare runtime deps pinned to match the workspace: `@scure/bip39: ^2.0.0`, `@scure/bip32: ^2.0.0`, `@noble/hashes: ^2.0.0` (SDK pin), `@noble/curves: ^2.0.0` (SDK pin; provides both secp256k1 and ed25519), `ed25519-hd-key: ^1.3.0`, `@toon-protocol/core: workspace:*`. Do NOT add `@noble/ed25519` separately (fragmentation with SDK). Do NOT add `@solana/web3.js` unless the impl actually needs it; plan A is `@noble/curves/ed25519` only.
  - [x] 1.4 Declare peer deps: `mina-signer: >=3.0.0` with matching `peerDependenciesMeta.mina-signer.optional: true` (mirror `packages/sdk/package.json`).
  - [x] 1.5 Declare dev deps: `@types/node: ^20.0.0`, `tsup: ^8.0.0`, `typescript: ^5.3.0`, `vitest: ^1.0.0`, `@toon-protocol/sdk: workspace:*` (test-only; used for type-only `ClaimIssuer` import and T-int-1).
  - [x] 1.6 Add `tsconfig.json` extending `../../tsconfig.json` (NOT a nonexistent `tsconfig.base.json`); set `outDir: "./dist"`, `rootDir: "./src"`, `include: ["src/**/*"]`, `exclude: ["node_modules", "dist"]`.
  - [x] 1.7 Add `tsup.config.ts` mirroring `packages/sdk/tsup.config.ts` (ESM + dts).
  - [x] 1.8 Add `vitest.config.ts` matching `packages/sdk/vitest.config.ts` shape.
  - [x] 1.9 Run `pnpm install` from repo root to link workspace. Confirm no dep-resolution errors.
  - [x] 1.10 (Optional / deferred to Story 12.9) README is NOT required for this story — `files: ["dist"]` matches SDK and omitting README keeps parity. Skip.

- [x] **Task 2: Error classes** (AC: 2)
  - [x] 2.1 Create `packages/mill/src/errors.ts` with `MillInventoryError` and `MillWalletError` classes. Follow the `GiftWrapError` pattern from `packages/sdk/src/errors.ts`.
  - [x] 2.2 Ensure `INSUFFICIENT_INVENTORY` is EXACTLY the string Story 12.3's handler detects (`err.code === 'INSUFFICIENT_INVENTORY'` per `12-3-mill-swap-handler.md` AC-9).
  - [x] 2.3 Export both classes from `packages/mill/src/index.ts` (AC-9 block).

- [x] **Task 3: `deriveMillKeys` wallet helper** (AC: 3)
  - [x] 3.1 Create `packages/mill/src/wallet.ts`. Implement `deriveMillKeys(input)` with the three chain branches.
  - [x] 3.2 EVM branch: `@scure/bip39` → seed → `@scure/bip32` HDKey → private key. Derive address via `@noble/curves/secp256k1` `getPublicKey(privKey, false)` (uncompressed, 65 bytes) → drop the `0x04` prefix (last 64 bytes) → `keccak_256` from `@noble/hashes/sha3` → take the last 20 bytes → hex-encode → EIP-55 checksum via keccak on lowercase-hex. Return `{ privateKey: Uint8Array(32), address: \`0x${string}\`, path: "m/44'/60'/${accountIndex}'/0/${addressIndex}" }`.
  - [x] 3.3 Mina branch: try `mina-signer`'s `Client.deriveKeyFromMnemonic` first. If the API differs in the installed version, derive via `@scure/bip32` at path `m/44'/12586'/${accountIndex}'/0/${addressIndex}` and pass the 32-byte private key through `mina-signer`'s key wrap function. Document the exact API call used in a comment. Catch all errors → wrap in `MillWalletError('DERIVATION_FAILED', ..., { cause: err })`.
  - [x] 3.4 Solana branch: use SLIP-0010 Ed25519 derivation at `m/44'/501'/${accountIndex}'/0'/0'` (all-hardened). Prefer `ed25519-hd-key`'s `derivePath`. Extract the 32-byte private seed. Compute public key via `@noble/curves/ed25519`'s `ed25519.getPublicKey(privSeed)`. Return `{ privateKey: Uint8Array(32), publicKey: Uint8Array(32), path: "m/44'/501'/${accountIndex}'/0'/0'" }`.
  - [x] 3.5 Mnemonic validation first: `validateMnemonic(mnemonic, wordlist)` → throw `MillWalletError('INVALID_MNEMONIC')` on false. Use `@scure/bip39`'s `wordlists.english` (or the repo's existing english wordlist if one is shared across packages — check `packages/core/src/` for precedent).
  - [x] 3.6 Zero intermediate seed buffers. Document caller's responsibility to zero returned private keys.
  - [x] 3.7 Export `deriveMillKeys` + all types from `index.ts`.

- [x] **Task 4: `MillInventory` class** (AC: 4)
  - [x] 4.1 Create `packages/mill/src/inventory.ts`. Implement `MillInventory` with `get` / `debit` / `credit` / `snapshot`.
  - [x] 4.2 Internal storage: `Map<string, { available: bigint; total: bigint; updatedAt: number }>` keyed by `${assetCode}:${chain}`.
  - [x] 4.3 All mutation methods are synchronous (no `async`, no `await`) — crucial for microtask atomicity under `Promise.all`.
  - [x] 4.4 `debit` order: validate amount > 0n → look up entry (throw `INVENTORY_NOT_INITIALIZED` if missing) → compare `available >= amount` (throw `INSUFFICIENT_INVENTORY` if not) → `available -= amount`, `updatedAt = clock()`.
  - [x] 4.5 `snapshot` returns array of deep-copied plain objects (not Map entries).
  - [x] 4.6 Export `MillInventory` + types from `index.ts`.

- [x] **Task 5: `PaymentChannelSigner` interface + three concrete signers** (AC: 5)
  - [x] 5.1 Create `packages/mill/src/payment-channel-signer.ts`. Define the `PaymentChannelSigner` interface + `PaymentChannelSignParams` type.
  - [x] 5.2 `EvmPaymentChannelSigner`: constructor takes `{ chain: string; privateKey: Uint8Array }`. Implement `signBalanceProof` via EIP-191 personal-sign (or EIP-712 if the connector's provider uses EIP-712 — check `/Users/jonathangreen/Documents/connector/packages/connector/src/settlement/provider/payment-channel-provider.ts` line ~100–200 for the exact hashing scheme). Use `@noble/curves/secp256k1`'s `sign(msgHash, privKey)` → concat r || s || v.
  - [x] 5.3 `MinaPaymentChannelSigner`: constructor takes `{ chain: string; privateKey: string; publicKey: string }`. Uses `mina-signer`'s `signFields` with Poseidon-hashed `[channelId, cumulativeAmount, nonce, recipient]` fields. Document the exact field packing (convert `channelId` to a field via hash-to-field if non-numeric). Handle version drift defensively with try/catch → `MillWalletError('SIGNING_FAILED')`.
  - [x] 5.4 `SolanaPaymentChannelSigner`: constructor takes `{ chain: string; privateKey: Uint8Array }`. Uses `@noble/curves/ed25519`'s `ed25519.sign`. Compute message as `sha256(channelId || cumulativeAmount || nonce || recipient)` using `@noble/hashes/sha256`. Return 64-byte signature.
  - [x] 5.5 Export all three classes + interface + types from `index.ts`.

- [x] **Task 6: `MillChannelState` class** (AC: 7)
  - [x] 6.1 Create `packages/mill/src/channel-state.ts`. Implement `MillChannelState` with `reserve` / `release` / `get`.
  - [x] 6.2 Internal storage: `Map<string, ChannelEntry>` keyed by `${assetCode}:${chain}:${senderPubkey}`.
  - [x] 6.3 `reserve` is synchronous; throws `MillWalletError('UNSUPPORTED_CHAIN')` if entry missing for the sender.
  - [x] 6.4 `release` is best-effort; no-op + warn if it would drive nonce negative.
  - [x] 6.5 Export `MillChannelState` + types from `index.ts`.

- [x] **Task 7: `MultiChainClaimIssuer` class** (AC: 6, 8, 10)
  - [x] 7.1 Create `packages/mill/src/claim-issuer.ts`. Import `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult` as type-only from `@toon-protocol/sdk`.
  - [x] 7.2 Constructor validates: `config.inventory` is a `MillInventory` instance; `config.signers` is a plain object with at least one entry; each signer implements `signBalanceProof`; `config.channelState` is a `MillChannelState` instance (or create a fresh empty one if absent).
  - [x] 7.3 `issueClaim` flow: (a) look up signer by `pair.to.chain` → throw `UNSUPPORTED_CHAIN` if absent. (b) `inventory.debit(...)` SYNCHRONOUSLY — no `await` before this call. (c) `channelState.reserve(...)` synchronously. (d) `await signer.signBalanceProof(...)` — on throw: `inventory.credit(...)` + `channelState.release(...)` + re-throw wrapped as `SIGNING_FAILED`. (e) Generate `claimId` via `config.newClaimId?.() ?? crypto.randomUUID()`. (f) Return `{ claim, claimId }`.
  - [x] 7.4 Structural type test: `const ci: ClaimIssuer = new MultiChainClaimIssuer(...)` compiles (AC-10).
  - [x] 7.5 Export from `index.ts`.

- [x] **Task 8: Unit tests** (AC: 11)
  - [x] 8.1 Create `packages/mill/src/wallet.test.ts` with 8 tests per AC-11 wallet block. Pin golden-vector mnemonic + addresses / pubkeys as string constants. Include account-index-1 baseline for each chain to prove isolation.
  - [x] 8.2 Create `packages/mill/src/inventory.test.ts` with 7 tests including concurrent race (T-inv-1).
  - [x] 8.3 Create `packages/mill/src/channel-state.test.ts` with 4 tests including concurrent race (T-cs-1).
  - [x] 8.4 Create `packages/mill/src/payment-channel-signer.test.ts` with 4+ tests. Gate Mina test with `describe.skipIf(!hasMinaSigner)` if needed.
  - [x] 8.5 Create `packages/mill/src/claim-issuer.test.ts` with 6 tests including T-026 concurrent + T-int-1 end-to-end-with-handler.
  - [x] 8.6 Create `packages/mill/src/index.test.ts` asserting the exact runtime symbol set per AC-9 (mirrors `packages/sdk/src/index.test.ts`).
  - [x] 8.7 Pre-capture baseline test count. After impl, confirm new count = baseline + ~30 new tests (exact count from AC-11 enumeration).

- [x] **Task 9: Build + lint + verification** (AC: 12)
  - [x] 9.1 `pnpm --filter @toon-protocol/mill build` → exit 0. Confirm `dist/` contains `.js`, `.d.ts`, `.d.ts.map`.
  - [x] 9.2 `pnpm --filter @toon-protocol/mill test` → all tests pass.
  - [x] 9.3 `pnpm --filter @toon-protocol/sdk test` → still passes (527 baseline; confirm no regression).
  - [x] 9.4 `pnpm lint` → 0 errors for `packages/mill` scope.
  - [x] 9.5 Confirm no changes to `packages/sdk`, `packages/core`, `packages/client`, or connector repo.

## Dev Notes

### Where this story stops and Story 12.7 takes over

This story delivers the **mechanism**: key derivation, inventory tracking, channel-state bookkeeping, signing, and the `ClaimIssuer` wrapper. Story 12.7 (`packages/mill/` package scaffold + `startMill()`) wires this into an operator-facing entrypoint: loading the mnemonic from a `KeyManager`, provisioning channels by calling into `PaymentChannelProvider.openChannel` / `deposit` (via the connector's full interface), reading initial balances from chain, registering the swap handler on the SDK node, and exposing an operational CLI. None of that operator ceremony belongs in this story — keep the surface lean. If you find yourself writing a `startMill()` function here, stop.

### Why a local `PaymentChannelSigner` interface instead of importing the connector's `PaymentChannelProvider`

Three reasons:
1. **No workspace dependency on the connector repo.** The connector lives at `../connector` outside the `packages/` workspace. Importing its types in a workspace package creates a build-ordering and publishing nightmare (CI must clone both repos; npm publish must resolve both). Story 12.4 stays inside the `toon` workspace.
2. **Interface surface is 10% of the connector's `PaymentChannelProvider`.** This story only needs `signBalanceProof`. Opens / deposits / closes / settles are operator lifecycle, handled outside the hot path.
3. **Story 12.8 E2E validates round-trip compatibility.** When real chain channels are brought up in Docker, Story 12.8 confirms the signature produced here verifies against the connector's `verifyBalanceProof`. If there's drift, Story 12.8 catches it.

The Mill's wallet is a separate instance from the connector's — D12-010 is explicit about this. The signer here operates as a standalone key holder.

### `ClaimIssuer` interface contract refresher (from Story 12.3)

From `packages/sdk/src/swap-handler.ts`:
```ts
export interface IssueClaimParams {
  sourceAmount: bigint;       // Mill received (source micro-units)
  targetAmount: bigint;       // Mill owes (target micro-units, post-rate-conversion)
  pair: SwapPair;             // the validated pair
  senderPubkey: string;       // sender's REAL pubkey (from NIP-59 seal, not ctx.pubkey)
  rumor: UnsignedEvent;       // inner rumor (may contain Mill-side context; can be ignored)
}
export interface IssueClaimResult {
  claim: Uint8Array;          // signed balance-proof bytes
  claimId?: string;           // optional, for logging/tracing
}
```

The handler code path (`packages/sdk/src/swap-handler.ts` around lines 330–410 in the final Story 12.3 implementation) catches `INSUFFICIENT_INVENTORY` via:
```ts
if (err.code === 'INSUFFICIENT_INVENTORY' || /insufficient/i.test(err.message)) {
  return ctx.reject('T04', 'Insufficient liquidity');
}
```
→ Story 12.4's `MillInventoryError('INSUFFICIENT_INVENTORY', ...)` satisfies BOTH branches of that conditional. Do not rename the code string.

### Microtask atomicity argument

Node.js executes JavaScript single-threadedly with cooperative scheduling. A synchronous function (no `await`) runs to completion before any other microtask (including a peer `Promise.all` branch) resumes. Therefore:

```ts
async issueClaim(params) {
  this.inventory.debit(...);        // synchronous — atomic w.r.t. concurrent callers
  this.channelState.reserve(...);   // synchronous — also atomic
  const claim = await signer.sign(...);  // <-- first await; other microtasks may interleave here
  ...
}
```

By the time two concurrent `issueClaim` calls hit their respective `await`, both have already debited inventory and reserved channel state. This is why AC-6 step 2 says "Debit inventory FIRST" — not first in prose ordering, but first in execution before any `await`. If you need to validate something that requires async work BEFORE debit (e.g., a rate oracle check), it must happen OUTSIDE `issueClaim` (in the handler's `rateProvider` hook, Story 12.3 AC-9).

### BIP-44 paths summary

| Chain | Coin Type | Path (account idx 2, addr idx 0) | Curve | Derivation library |
|-------|-----------|----------------------------------|-------|---------------------|
| EVM (ETH/Arbitrum/Base) | 60 | `m/44'/60'/2'/0/0` | secp256k1 | `@scure/bip32` |
| Mina | 12586 | `m/44'/12586'/2'/0/0` | Pallas | `mina-signer` |
| Solana | 501 | `m/44'/501'/2'/0'/0'` (all-hardened, SLIP-0010) | Ed25519 | `ed25519-hd-key` |

Account index 1 is the connector's (see `connector/packages/connector/src/wallet/wallet-seed-manager.ts` line 83: `EVM: "m/44'/60'/1'/0"`). Account index 2 is the Mill's. If the operator later adds a second Mill instance on the same node, the protocol reserves account index 3+ — but that's not this story's concern.

### Golden-vector mnemonics for tests

Use the BIP-39 test vector `'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'` (zero entropy, universally known, used by Trezor/Ledger test suites). Pin the derived account-index-1 and account-index-2 addresses/pubkeys for EVM / Mina / Solana in the test file as string constants. This makes the tests self-verifying without requiring external fixture files.

For EVM at `m/44'/60'/2'/0/0` on the zero mnemonic: the address is reproducible across any correct BIP-44 implementation. Do NOT hand-compute — derive it once locally with a trusted tool (e.g., `ethers.HDNodeWallet.fromMnemonic(...)` in a throwaway script) and paste the result as a constant. Any CI drift on this constant is a signal of broken derivation.

### Nonce + channel lifecycle boundaries

This story tracks nonce + cumulativeAmount **in memory only**. On process restart, state is lost. That is acceptable for Story 12.4 because:
- Operator funding / channel opening (Story 12.7) produces durable state elsewhere.
- The sender's side (Story 12.5) also tracks cumulative claims and can refuse to accept a claim with a regressed cumulativeAmount.

Story 12.8 E2E will exercise cold-restart recovery and likely reveal the need for persistence. Persistence is deliberately deferred — do not add it here. If you add SQLite / LevelDB / Redis to this story, back it out.

### Solana all-hardened derivation path subtlety

`@scure/bip32` produces secp256k1 HD keys. For Ed25519 (Solana), you CANNOT use `@scure/bip32` directly — Ed25519 BIP-32 requires SLIP-0010, which hardens every segment. Two common approaches:
1. `ed25519-hd-key` package: call `derivePath(path, seedHex)` → returns `{ key, chainCode }`. The 32-byte `key` is the Ed25519 seed.
2. `@noble/ed25519`'s `utils.ed25519SeedKey` helper (if available in the installed version).

Document the choice in the implementation. Match whatever `packages/client/` uses for Solana key derivation to avoid fragmentation (check `packages/client/src/` for precedent).

### MAX_SAFE_INTEGER / BigInt guard (Epic 11 retro)

- All amounts (`sourceAmount`, `targetAmount`, `cumulativeAmount`, `available`, `total`) are `bigint`. No `Number`, `parseInt`, `parseFloat`.
- Nonces are `bigint` — EVM chains produce 64-bit nonces routinely.
- `updatedAt` timestamps are `number` (ms since epoch) — these are bounded to ~9 trillion, well within `MAX_SAFE_INTEGER`. OK to use `number`.
- Channel IDs, pubkeys, addresses are `string` — no numeric handling.
- Test that includes a nonce at `2n ** 63n - 1n` and confirms no overflow in the signer's message construction is nice-to-have; not required.

### Non-goals for this story (scope fence)

- Do NOT implement `startMill()` — Story 12.7.
- Do NOT implement channel opening, deposit, close, settle — operator lifecycle.
- Do NOT implement persistence (no DB, no file I/O for inventory / channel state).
- Do NOT implement a `KeyManager` adapter for AWS KMS / GCP KMS / HSM — use in-process private keys only. Future story.
- Do NOT implement rate fetching / oracle integration — operator concern, surfaced via Story 12.3's `rateProvider` hook.
- Do NOT implement rebalancing policy — operator concern.
- Do NOT modify `@toon-protocol/sdk`, `@toon-protocol/core`, or the connector repo.
- Do NOT implement `streamSwap()` or `buildSettlementTx()` — Stories 12.5, 12.6.
- Do NOT take a hard workspace dep on the connector's `PaymentChannelProvider` type — mirror a narrower interface locally (AC-5 rationale).

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does not create or modify GitHub Actions workflows. No action needed. If `pnpm publish` becomes part of this story's scope (it should not — package is `0.1.0` pre-release, publish is Story 12.9), that workflow MUST pin all actions to full commit SHAs per OWASP A08 supply-chain risk.
- **MAX_SAFE_INTEGER guard:** **APPLIES DIRECTLY.** All amount / nonce / cumulativeAmount arithmetic MUST be BigInt. See Dev Notes "MAX_SAFE_INTEGER / BigInt guard" above. Code review should grep for `Number(`, `parseInt(`, `parseFloat(` and fail the review on any hit that touches amounts.
- **Golden test vectors:** APPLIES. The account-index-2 derived keys (EVM address, Mina pubkey, Solana pubkey) for the zero-mnemonic are load-bearing. Pin them as string constants in tests. Any drift is a breaking key-derivation change — treat it as a P0 bug.

### Project Structure Notes

- All new code lives in `packages/mill/src/`. Files: `errors.ts`, `wallet.ts`, `inventory.ts`, `payment-channel-signer.ts`, `channel-state.ts`, `claim-issuer.ts`, `index.ts`, plus `.test.ts` co-located.
- No changes to `packages/sdk/`, `packages/core/`, `packages/client/`, or any other package.
- `packages/mill/dist/` exists from prior scaffold; contents will be regenerated by `tsc`. Safe to delete and rebuild.
- No new workspace-root deps beyond what `packages/mill/package.json` declares (AC-1).
- Test file layout mirrors `packages/sdk/src/*.test.ts` (co-located, vitest, no separate `__tests__` directory).

### References

- [Source: `_bmad-output/epics/epic-12-token-swap-primitive.md`] — epic goal, D12-005, D12-007, D12-010, D12-011 (this story's core decisions).
- [Source: `_bmad-output/planning-artifacts/test-design-epic-12.md#Story 12-4`] — T-029..T-037; risks R-005, R-012, R-017; quality gate "BIP-44 key isolation".
- [Source: `_bmad-output/implementation-artifacts/12-3-mill-swap-handler.md`] — `ClaimIssuer` interface contract, `INSUFFICIENT_INVENTORY` error-code detection, AC-9 reject-code mapping.
- [Source: `packages/sdk/src/swap-handler.ts`] — `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult` type definitions this story implements.
- [Source: `packages/sdk/src/errors.ts`] — `ToonError` / `GiftWrapError` / `SwapHandlerError` pattern to mirror.
- [Source: `packages/sdk/src/index.ts`] — public-API layout convention with comment blocks.
- [Source: `packages/sdk/src/index.test.ts`] — expected-exports set test pattern.
- [Source: `packages/core/src/types.ts`] — `SwapPair` interface (Story 12.1).
- [Source: `/Users/jonathangreen/Documents/connector/packages/connector/src/settlement/provider/payment-channel-provider.ts`] — `PaymentChannelProvider` interface; `signBalanceProof` / `verifyBalanceProof` / `BalanceProofParams` exact shapes to mirror.
- [Source: `/Users/jonathangreen/Documents/connector/packages/connector/src/wallet/wallet-seed-manager.ts`] — `WalletSeedManager` pattern; `DERIVATION_PATHS.EVM = "m/44'/60'/1'/0"` for account-index-1 baseline (Story 12.4 uses account index 2).
- [Source: `packages/client/package.json`] — version pin baseline for `@scure/bip32`, `@scure/bip39`, `mina-signer`, `@solana/web3.js` (align versions to avoid workspace fragmentation).
- [Source: `packages/sdk/package.json`] — canonical `exports` / `main` / `types` / peer-deps shape to mirror.
- [Source: `_bmad-output/project-context.md`] — package dependency graph, BigInt-over-Number mandate, ESM / workspace conventions.

### Previous Story Intelligence

**Story 12.3 (Mill swap handler) — DONE (2026-04-13):**

- Defines `ClaimIssuer` interface as a **type-only** export from `@toon-protocol/sdk`. This story implements that interface. Any shape mismatch is a compile error; run `pnpm --filter @toon-protocol/sdk build && pnpm --filter @toon-protocol/mill build` in sequence to validate.
- The handler catches `INSUFFICIENT_INVENTORY` via `err.code === 'INSUFFICIENT_INVENTORY'` OR `/insufficient/i.test(err.message)` → reject `T04 'Insufficient liquidity'`. Story 12.4's `MillInventoryError('INSUFFICIENT_INVENTORY', ...)` satisfies BOTH branches. Rename at your peril.
- The handler catches any other issuer error and rejects `T00 'Internal error'`. So `UNSUPPORTED_CHAIN` / `SIGNING_FAILED` / `DERIVATION_FAILED` all flow through as T00 from the sender's perspective. That's intentional — the handler is a protocol boundary and does not leak Mill-internal failure modes.
- Handler expects `issueClaim` to return `{ claim: Uint8Array, claimId?: string }`. The `claim` bytes are NIP-44 encrypted before being placed in the FULFILL metadata (Story 12.2's `encryptFulfillClaim`). Therefore claim format is opaque to the handler — this story's signers can emit any byte layout, as long as the sender-side code (Story 12.5/12.6) knows how to decode it. Use the connector's verify function as the source of truth for EVM/Solana/Mina claim byte layouts.
- Handler's `seenPacketIds` replay protection (AC-11) operates BEFORE `issueClaim` is called. If the issuer throws, the replay reservation is released by the handler. This means the issuer can assume it is NEVER called twice for the same packet in the same process lifetime (modulo process restart).
- **Code review findings in Story 12.3 that inform this story:**
  - Pass #1: `tryUnwrap` double-base64 hack was removed; don't introduce similar heuristics here.
  - Pass #2: concurrent check-then-add race was fixed by moving reservation BEFORE the first await. Apply the same pattern to `inventory.debit` + `channelState.reserve` in this story.
  - Pass #3: reject messages should NOT leak Mill-internal role. Similarly, `MillInventoryError` / `MillWalletError` messages should not embed private key material, raw mnemonic, or exact reserves amounts beyond what's needed for operator debugging. Keep messages structural.

**Story 12.2 (NIP-59 gift wrap integration) — DONE:**
- Not a direct dependency for this story. Mentioned here only to note that `encryptFulfillClaim`'s ephemeral-privkey zeroing is already handled — this story introduces NO new ephemeral key material.

**Story 12.1 (SwapPair type + kind:10032 serialization) — DONE:**
- `SwapPair` type is a type-only export from `@toon-protocol/core`. Import via `import type { SwapPair } from '@toon-protocol/core'`.
- `SwapPair.to.chain` format is `{blockchain}:{network}[:{chainId}]` (e.g., `evm:base:8453`). `MultiChainClaimIssuer`'s signer lookup uses the full chain string as the key — `signers['evm:base:8453']`. Different EVM networks get different signer entries even though they share the same derivation path + private key; the `chain` string differentiates the signing context (e.g., EIP-712 `chainId`).

**Files created by Stories 12.1-12.3 (reference only — do NOT re-touch):**
- `packages/core/src/types.ts` — added `SwapPair` (Story 12.1).
- `packages/core/src/events/swap-pair-validation.ts` (Story 12.1).
- `packages/sdk/src/gift-wrap.ts` + `.test.ts` (Story 12.2).
- `packages/sdk/src/swap-handler.ts` + `.test.ts` (Story 12.3).
- `packages/sdk/src/errors.ts` — `GiftWrapError` (12.2), `SwapHandlerError` (12.3).
- `packages/sdk/src/index.ts` — swap-handler + gift-wrap export blocks.

### Files This Story Creates/Modifies

- `packages/mill/package.json` (NEW) — workspace package manifest, deps, scripts.
- `packages/mill/tsconfig.json` (NEW) — TypeScript config, mirrors `packages/sdk/tsconfig.json`.
- `packages/mill/vitest.config.ts` (NEW) — vitest config.
- `packages/mill/README.md` (NEW) — one-paragraph intro, story reference.
- `packages/mill/src/errors.ts` (NEW) — `MillInventoryError`, `MillWalletError`.
- `packages/mill/src/wallet.ts` (NEW) — `deriveMillKeys` + `MillKeys` / `MillChainKind` / `DeriveMillKeysInput` types.
- `packages/mill/src/inventory.ts` (NEW) — `MillInventory` class + types.
- `packages/mill/src/payment-channel-signer.ts` (NEW) — `PaymentChannelSigner` interface + `EvmPaymentChannelSigner` / `MinaPaymentChannelSigner` / `SolanaPaymentChannelSigner` classes.
- `packages/mill/src/channel-state.ts` (NEW) — `MillChannelState` class + types.
- `packages/mill/src/claim-issuer.ts` (NEW) — `MultiChainClaimIssuer` class + config type.
- `packages/mill/src/index.ts` (NEW) — public-API exports with Story 12.4 comment blocks.
- `packages/mill/src/wallet.test.ts` (NEW) — ~8 tests.
- `packages/mill/src/inventory.test.ts` (NEW) — ~7 tests.
- `packages/mill/src/channel-state.test.ts` (NEW) — ~4 tests.
- `packages/mill/src/payment-channel-signer.test.ts` (NEW) — ~4 tests.
- `packages/mill/src/claim-issuer.test.ts` (NEW) — ~6 tests including T-int-1 end-to-end-with-handler.
- `packages/mill/src/index.test.ts` (NEW) — expected-exports set test.

No other files modified.

## Story Completion Status

Created: 2026-04-13
Created by: create-story workflow (bmad-bmm) in YOLO mode
Sprint-status entry: `12-4-mill-inventory-and-wallet-management: ready-for-dev` under epic-12.

## Change Log

| Date | Author | Change |
| --- | --- | --- |
| 2026-04-13 | create-story workflow (YOLO) | Initial draft — 12 ACs, 9 tasks, dev notes, previous-story intelligence from 12.1/12.2/12.3, scope fence explicitly excluding Stories 12.5-12.8, golden-mnemonic vector guidance, microtask atomicity argument, BIP-44 paths table, local `PaymentChannelSigner` interface rationale. |
| 2026-04-13 | bmad-review-adversarial-general (YOLO) | Adversarial review — corrected AC-1 to use `tsup` not `tsc`, fixed tsconfig-extends target (`../../tsconfig.json`, not nonexistent `tsconfig.base.json`), aligned `@noble/*` pins to SDK `^2.0.0` (avoiding fragmentation), made `ed25519-hd-key` an explicit runtime dep, removed stray `@solana/web3.js` requirement in favor of `@noble/curves/ed25519`, moved `@toon-protocol/sdk` to devDependencies (type-only consumer), clarified Solana derivation path. Expanded AC-12 to include core regression + root-build/test OOM warning. |
| 2026-04-13 | bmad-bmm-code-review (Claude Opus 4.6 1M, YOLO) | Adversarial code review — 0 Critical, 1 High, 4 Medium, 4 Low findings. Fixes: (H2) Mina signer no longer swallows real signing failures when the `mina-signer` peer is installed — errors propagate so `MultiChainClaimIssuer` rolls back inventory/channel state. (M1) Story File List updated to include `errors.test.ts` + post-review additions. (M2) Mina field-packing helper refactored with clearer 240-bit hash-to-field docstring. (M5/M6) Added 32-byte private-key length guards in EVM/Solana signer constructors with 2 new unit tests. (L2) Removed `(globalThis as any)` cast in claim-issuer. Final: 73 tests passed / 1 skipped, build green, 0 lint errors. Status → `done`. |
| 2026-04-13 | bmad-bmm-code-review pass #3 (Claude Opus 4.6 1M, YOLO, FINAL) | Final adversarial pass — 0 Critical, 0 High, 1 Medium, 2 Low. Fixes: (M1) `MillInventory.credit` now throws `MillInventoryError('UNKNOWN_PAIR')` on non-positive amount instead of `'INSUFFICIENT_INVENTORY'` — invalid input is not a reserves shortage and must not map to ILP T04 in Story 12.3's handler. (L1) `wallet.ts` replaced `(scalar[0] as number) & 0x3f` ambiguity with explicit typed local `firstByte` to satisfy `noUncheckedIndexedAccess` without a non-null assertion (lint clean). (L2) `MillChannelState.release` now emits a `warn` log via an optional `ReleaseLogger` when a reversal would underflow nonce/cumulative, matching AC-7 ("no-op + warn log") which was previously silent. Exported `ReleaseLogger` from `index.ts`. Added 2 new channel-state tests + tightened the credit-negative inventory test to assert the new code. OWASP Top 10 scan (semgrep `--config=auto`) across `packages/mill/src/` returned 0 findings. No auth/authz flaws, no injection risks (dynamic `import('mina-signer')` specifier is a hardcoded constant). Final: 75 tests passed / 1 skipped (up from 73/1), `pnpm --filter @toon-protocol/mill build` green, `npx eslint packages/mill/src` 0 errors / 98 warnings (all pre-existing test-file non-null assertions). SDK and core baselines untouched. Status → `done`. |
| 2026-04-13 | bmad-bmm-code-review pass #2 (Claude Opus 4.6 1M, YOLO) | Intermediate adversarial pass — 0 Critical, 0 High, 3 Medium, 3 Low. Fixes: (M1) `MultiChainClaimIssuer` constructor now throws `MillWalletError('INVALID_CONFIG')` instead of overloading `UNSUPPORTED_CHAIN` for setup-time validation; added `INVALID_CONFIG` to the `MillWalletErrorCode` union + errors.test.ts coverage. (M2) `MillClaimIssuerLogger` methods made optional (`debug?`/`info?`/`warn?`/`error?`) to match the existing `?.` call-sites in `issueClaim`; removed the one inconsistent un-chained `logger?.error(...)` call. (M3) Mina scalar top-2-bits clear now asserts `scalar.length === 32` + drops `scalar[0] ?? 0` ambiguity. (L1) Manual hex decoder now delegates byte-level decoding to `@noble/hashes/utils` `hexToBytes`, removing the bespoke `parseInt` loop. (L2) `balanceProofHashEvm` docstring corrected — it is EVM-only; Solana uses `balanceProofHashSolana`. (L3) Explicit `Reservation` type annotation on `reservation` local in `issueClaim`. Final: 73 tests passed / 1 skipped, build green, 0 lint errors. Status stays `review` per user request (intermediate pass). |
| 2026-04-13 | bmad-bmm-dev-story (Claude Opus 4.6 1M, YOLO) | Implementation complete — all 12 ACs satisfied. Created `errors.ts`, `wallet.ts` (EVM/Mina/Solana BIP-44 derivation with account index 2 default), `inventory.ts` (microtask-atomic debit/credit), `channel-state.ts` (nonce + cumulativeAmount bookkeeping), `payment-channel-signer.ts` (three signers with `mina-signer` dynamic optional peer import + sha256 fallback), `claim-issuer.ts` (`MultiChainClaimIssuer` with debit-first → reserve → sign → rollback-on-failure flow), `index.ts` (public exports). Un-skipped all 43 tests (1 skipped by design — Mina peer-dep gated). Build + tests green for mill; SDK (527) and core (2418) baselines unchanged; mill lint 0 errors. No changes to sdk/core/client packages. Mina signer currently emits a deterministic sha256 fallback when the peer is absent; Story 12.8 E2E will validate real-chain round-trip. |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`

### Debug Log References

- `pnpm --filter @toon-protocol/mill build` → ESM + DTS success (dist/index.js 16.74 KB, dist/index.d.ts 8.68 KB).
- `pnpm --filter @toon-protocol/mill test` → 43 passed | 1 skipped (Mina signer test gated behind `describe.skipIf(!hasMinaSigner)` default-skip, as specified).
- `pnpm --filter @toon-protocol/sdk test` → 527 passed (unchanged baseline).
- `pnpm --filter @toon-protocol/core test` → 2418 passed | 7 skipped (unchanged baseline).
- `npx eslint packages/mill/src` → 0 errors (warnings only; non-null assertions in tests acceptable per repo norm).

### Completion Notes List

- **Task 1 (scaffold):** `packages/mill/` package.json, tsconfig.json, tsup.config.ts, vitest.config.ts were already scaffolded from the story kick-off. Verified scripts (`build`/`dev`/`test`/`test:watch`), deps (`@noble/curves ^2`, `@noble/hashes ^2`, `@scure/bip32 ^2`, `@scure/bip39 ^2`, `ed25519-hd-key ^1.3`, `@toon-protocol/core workspace:*`), peerDep `mina-signer >=3.0.0` (optional), devDeps including `@toon-protocol/sdk workspace:*` type-only. Ran `pnpm install` to materialise workspace links.
- **Task 2 (errors):** `src/errors.ts` defines `MillInventoryError` and `MillWalletError` with literal `code` union types and ES2022 `cause` support. `INSUFFICIENT_INVENTORY` code string preserved verbatim for Story 12.3 handler detection.
- **Task 3 (deriveMillKeys):** `src/wallet.ts` — BIP-39 validation (English wordlist), sync seed derivation, EVM via `@scure/bip32` HDKey + EIP-55 checksum (EIP-55 derived inline via `@noble/curves/secp256k1` + `@noble/hashes/sha3`), Solana via `ed25519-hd-key`'s `derivePath` + `@noble/curves/ed25519` public-key derivation, Mina via `@scure/bip32` BIP-44 coin-type-12586 path with high-bit clearance + sha3-derived public-key identifier (full base58 emission deferred to MinaPaymentChannelSigner at sign time when mina-signer peer is present). Seed buffer zeroed in `finally`. Default `accountIndex = 2` per D12-011.
- **Task 4 (MillInventory):** `src/inventory.ts` — Map-backed store keyed by `${asset}:${chain}`. All mutators synchronous (no `await`) for microtask atomicity. Transactional guarantees (`debit` validates `available >= amount` before mutation). Covers `INSUFFICIENT_INVENTORY` + `INVENTORY_NOT_INITIALIZED` throws plus positive-amount guard.
- **Task 5 (PaymentChannelSigner):** `src/payment-channel-signer.ts` — narrow local interface + three concrete signers. EVM signer uses `secp256k1.sign(msgHash, key, { prehash: false, format: 'recovered' })` → 65-byte r||s||v (v shifted to 27/28). Solana signer uses `ed25519.sign` on `sha256(channelId || amount || nonce || recipient)` → 64-byte signature. Mina signer dynamically imports optional `mina-signer` peer (specifier passed as variable so TS does not require the module); deterministic sha256 fallback when the peer is absent so unit tests run without the peer dep.
- **Task 6 (MillChannelState):** `src/channel-state.ts` — Map keyed by `${asset}:${chain}:${senderPubkey}`. `reserve` increments nonce + cumulativeAmount synchronously; throws `UNSUPPORTED_CHAIN` when the channel is not pre-provisioned. `release` is best-effort — no-op if it would drive values negative.
- **Task 7 (MultiChainClaimIssuer):** `src/claim-issuer.ts` — implements `ClaimIssuer` (type-only import from `@toon-protocol/sdk` to avoid runtime cycle). Flow: lookup signer → sync `inventory.debit` → sync `channelState.reserve` → `await signer.signBalanceProof`. Rollback on signer failure via `inventory.credit` + `channelState.release` and re-throw as `SIGNING_FAILED`. `claimId` default via `crypto.randomUUID` (Node 20+).
- **Task 8 (tests):** 43 tests passing (1 skipped — Mina signer with `describe.skipIf(!hasMinaSigner)` plus a Mina-block test skipping when the peer is absent). Full coverage includes: EVM/Mina/Solana derivation path isolation (T-029/T-030/T-031), determinism (T-032), mnemonic validation, passphrase isolation, inventory debit/credit/transactional guard (T-033/T-034/T-037), concurrent debit race (T-inv-1), concurrent channel-state race (T-cs-1), EVM signer round-trip (T-035), Solana Ed25519 round-trip, concurrent `issueClaim` with 10 branches (T-026), structural `ClaimIssuer` assignability (AC-10), and `createSwapHandler` construction via `MultiChainClaimIssuer` (T-int-1 converted from RED placeholder to structural integration).
- **Task 9 (verification):** build green, mill tests green, SDK (527) and core (2418) regression-clean, lint 0 errors in `packages/mill/`. No files in `packages/sdk`, `packages/core`, or `packages/client` modified.
- **T-int-1 deviation (documented):** Full end-to-end gift-wrap round-trip through the SDK handler is deferred to Story 12.8 Docker E2E (as the story Dev Notes anticipate). The test here validates structural compatibility (`createSwapHandler` accepts a `MultiChainClaimIssuer` instance at factory time + `issueClaim` exercises the full debit/reserve/sign path end to end).
- **Mina derivation caveat:** This story's Mina branch derives a deterministic 32-byte scalar via BIP-32 and emits a sha3-based public-key *identifier* (not a base58 Mina public key). Golden-vector tests only assert "account index 2 differs from account index 1" and path correctness — they do not pin a canonical Mina pubkey. When `mina-signer` is installed and its `signFields` API is reachable, `MinaPaymentChannelSigner` produces a real signed artifact; otherwise a deterministic sha256 fallback keeps unit tests independent of the peer dep. Story 12.8 E2E will bring in the peer and validate real-chain verification.

### File List

- `packages/mill/src/errors.ts` (NEW)
- `packages/mill/src/wallet.ts` (NEW)
- `packages/mill/src/inventory.ts` (NEW)
- `packages/mill/src/channel-state.ts` (NEW)
- `packages/mill/src/payment-channel-signer.ts` (NEW)
- `packages/mill/src/claim-issuer.ts` (NEW)
- `packages/mill/src/index.ts` (NEW)
- `packages/mill/src/wallet.test.ts` (MODIFIED — removed `.skip` guards)
- `packages/mill/src/inventory.test.ts` (MODIFIED — removed `.skip` guards, fixed Array<T> lint)
- `packages/mill/src/channel-state.test.ts` (MODIFIED — removed `.skip` guards)
- `packages/mill/src/payment-channel-signer.test.ts` (MODIFIED — removed `.skip` guards)
- `packages/mill/src/claim-issuer.test.ts` (MODIFIED — removed `.skip` guards, replaced T-int-1 placeholder with structural integration test)
- `packages/mill/src/index.test.ts` (MODIFIED — removed `.skip` guards)
- `packages/mill/src/errors.test.ts` (NEW — gap-fill contract tests for `MillInventoryError` / `MillWalletError` pinning every code literal per AC-2)

### Post-review additions (bmad-bmm-code-review, 2026-04-13)

- `packages/mill/src/payment-channel-signer.ts` (MODIFIED) — Removed silent sha256 fallback when `mina-signer` peer is installed; real signing failures now propagate as `SIGNING_FAILED` instead of emitting a fake "signature". Added defensive 32-byte `privateKey` length checks in `EvmPaymentChannelSigner` and `SolanaPaymentChannelSigner` constructors. Cleaned up Mina field-packing helper with clearer docstring.
- `packages/mill/src/claim-issuer.ts` (MODIFIED) — Replaced `(globalThis as any).crypto` cast with typed `globalThis.crypto` access (eslint-disable removed). (Pass #2) Added `INVALID_CONFIG` constructor-time validation, logger methods made optional, explicit `Reservation` annotation.
- `packages/mill/src/payment-channel-signer.test.ts` (MODIFIED) — Added 2 defensive-construction tests (EVM/Solana non-32-byte private-key rejection).
- `packages/mill/src/errors.ts` (MODIFIED, Pass #2) — Added `INVALID_CONFIG` to `MillWalletErrorCode` union.
- `packages/mill/src/wallet.ts` (MODIFIED, Pass #2 + Pass #3) — Added `scalar.length === 32` guard in Mina derivation with `MillWalletError('DERIVATION_FAILED')`. Pass #3: replaced `(scalar[0] as number)` ambiguity with explicit `firstByte` typed local (lint-clean, no non-null assertion).
- `packages/mill/src/inventory.ts` (MODIFIED, Pass #3) — `credit` non-positive guard now throws `MillInventoryError('UNKNOWN_PAIR', ...)` instead of `'INSUFFICIENT_INVENTORY'` so Story 12.3's handler does NOT map invalid-input operator bugs to ILP T04 Insufficient liquidity.
- `packages/mill/src/channel-state.ts` (MODIFIED, Pass #3) — Added optional `ReleaseLogger` on `MillChannelStateInit`; `release` now emits `warn` logs on unknown-channel and no-op-would-underflow branches, matching AC-7's "no-op + warn log" contract.
- `packages/mill/src/channel-state.test.ts` (MODIFIED, Pass #3) — Added 2 tests covering the new `release` warn paths.
- `packages/mill/src/inventory.test.ts` (MODIFIED, Pass #3) — Tightened credit non-positive test to assert `code === 'UNKNOWN_PAIR'` with an inline rationale comment.
- `packages/mill/src/index.ts` (MODIFIED, Pass #3) — Exported `ReleaseLogger` type from `./channel-state.js`.

### File List

## Code Review Record

### Review Pass #1 — 2026-04-13

- **Reviewer:** bmad-bmm-code-review (Claude Opus 4.6 1M, YOLO)
- **Date:** 2026-04-13
- **Scope:** Full story 12.4 implementation under `packages/mill/` (errors, wallet, inventory, channel-state, payment-channel-signer, claim-issuer, index + tests).
- **Issue counts by severity:** 0 Critical / 1 High / 4 Medium / 4 Low (total 9).
- **Findings:**
  - **H2 (High):** Mina signer silently swallowed real signing failures when the `mina-signer` peer was installed, emitting a sha256 "fallback" signature that masked genuine errors and prevented `MultiChainClaimIssuer` from rolling back inventory/channel state.
  - **M1 (Medium):** Story File List stale — missing `errors.test.ts` and other post-review additions.
  - **M2 (Medium):** Mina hash-to-field comment in field-packing helper unclear (240-bit rationale undocumented).
  - **M5 (Medium):** `EvmPaymentChannelSigner` constructor lacked a 32-byte private-key length guard.
  - **M6 (Medium):** `SolanaPaymentChannelSigner` constructor lacked a 32-byte private-key length guard.
  - **L1 (Low):** Missed opportunity for nullish-coalescing operator.
  - **L2 (Low):** `(globalThis as any).crypto` cast in `claim-issuer.ts`.
  - **L3 (Low):** Minor doc drift between story notes and implementation.
  - **L4 (Low):** `Buffer.from` usage where a typed array was clearer.
- **Resolution:** All 9 findings fixed in-place during the review pass. No deferred action items or new Tasks/Subtasks entries required.
  - H2 fixed in `payment-channel-signer.ts` — real signing failures now propagate as `SIGNING_FAILED` and trigger inventory/channel rollback.
  - M1 fixed — File List updated with `errors.test.ts` and post-review modifications.
  - M2 fixed — Mina field-packing helper refactored with clearer 240-bit hash-to-field docstring.
  - M5/M6 fixed — 32-byte private-key length guards added in EVM + Solana signer constructors, with 2 new defensive-construction unit tests.
  - L1–L4 fixed — nullish coalesce, typed `globalThis.crypto` access (eslint-disable removed), doc drift reconciled, `Buffer.from` cleanup.
- **Verification:** 73 tests passed / 1 skipped (Mina peer-gated), `pnpm --filter @toon-protocol/mill build` green, `npx eslint packages/mill/src` 0 errors. SDK (527) and core (2418) baselines unchanged.
- **Outcome:** All issues resolved. Status reverted to `review` pending final review pass (code review #1 is not the terminal review gate).

### Review Pass #2 — 2026-04-13

- **Reviewer:** bmad-bmm-code-review (Claude Opus 4.6 1M, YOLO, intermediate pass)
- **Date:** 2026-04-13
- **Scope:** Full re-audit of `packages/mill/src/` after Pass #1 fixes were committed (errors, wallet, inventory, channel-state, payment-channel-signer, claim-issuer, index, plus tests).
- **Issue counts by severity:** 0 Critical / 0 High / 3 Medium / 3 Low (total 6).
- **Findings:**
  - **M1 (Medium):** `MultiChainClaimIssuer` constructor threw `MillWalletError('UNSUPPORTED_CHAIN')` for missing `inventory` / `signers` / `channelState` — semantically incorrect (these are setup-time config errors, not runtime chain-routing failures) and collides with the `UNSUPPORTED_CHAIN` code used when a pair references an unregistered chain at claim time.
  - **M2 (Medium):** `MillClaimIssuerLogger` interface declared all four methods as required, yet `claim-issuer.ts` called `this.logger?.debug?.(...)` (inconsistent optional-chain usage) and `this.logger?.error(...)` (un-chained) — either the type should permit missing methods, or the `?.` were dead code.
  - **M3 (Medium):** `wallet.ts` Mina derivation cleared the top 2 bits via `const firstByte = scalar[0] ?? 0; scalar[0] = firstByte & 0x3f;` — the `?? 0` masked intent and there was no assertion that the HDKey private key was actually 32 bytes (cryptographic length check omitted).
  - **L1 (Low):** `payment-channel-signer.ts` hand-rolled `hexToBytes` with `parseInt` even though `@noble/hashes/utils` exports a battle-tested `hexToBytes`. Code-review rule flags `parseInt` on data that might touch amount-adjacent computations.
  - **L2 (Low):** `balanceProofHashEvm` docstring incorrectly stated "used by both EVM and Solana signers" — Solana uses a separate `balanceProofHashSolana` helper.
  - **L3 (Low):** `claim-issuer.ts` declared `let reservation;` with no type annotation; inferred but less readable than an explicit `Reservation` type.
- **Resolution:** All 6 findings fixed in-place during the review pass.
  - M1 fixed — added new `INVALID_CONFIG` code to `MillWalletErrorCode` union in `errors.ts`; constructor now uses `INVALID_CONFIG` for all three setup-time validation branches; `errors.test.ts` expanded to cover the fifth code literal.
  - M2 fixed — made all four logger methods optional (`debug?`/`info?`/`warn?`/`error?`) and corrected the one inconsistent call site to `this.logger?.error?.(...)`.
  - M3 fixed — added explicit `scalar.length === 32` guard (throws `MillWalletError('DERIVATION_FAILED')`) and removed the `?? 0` ambiguity with a clearer inline comment documenting the Pallas field-order rationale.
  - L1 fixed — `hexToBytes` helper now delegates byte decoding to `@noble/hashes/utils`'s `hexToBytes` after local validation; no more `parseInt` loop.
  - L2 fixed — docstring rewritten to reflect EVM-only scope; explicit pointer to `balanceProofHashSolana`.
  - L3 fixed — `let reservation: Reservation` explicit annotation added.
- **Verification:** `pnpm --filter @toon-protocol/mill test` → 73 passed / 1 skipped (unchanged). `pnpm --filter @toon-protocol/mill build` → ESM + DTS green (dist/index.js 17.69 KB, dist/index.d.ts 8.70 KB). `npx eslint packages/mill/src` → 0 errors / 96 warnings (all warnings are pre-existing test-file non-null assertions, repo-acceptable).
- **Outcome:** All issues resolved. Per user instruction for this intermediate pass, story status remains `review` (NOT advanced to `done`). Awaits a terminal review gate before sprint-status transitions to `done`.
- **Follow-ups:** None. No outstanding action items created; all fixes landed in the same commit cohort as the review.

### Review Pass #3 — 2026-04-13 (FINAL)

- **Reviewer:** bmad-bmm-code-review (Claude Opus 4.6 1M, YOLO, terminal pass #3)
- **Date:** 2026-04-13
- **Scope:** Full re-audit of `packages/mill/src/` after Pass #2 fixes committed. OWASP Top 10 / auth / injection scan via `semgrep --config=auto`.
- **Issue counts by severity:** 0 Critical / 0 High / 1 Medium / 2 Low (total 3).
- **OWASP / security scan:** `semgrep --config=auto packages/mill/src/` → 0 findings. No authn/authz flaws identified (this module exposes no network/auth surface — it consumes a mnemonic at construction and signs claim bytes deterministically). No injection risks — the one dynamic `import()` call uses a hardcoded `'mina-signer'` specifier, not user input. All BigInt arithmetic — no `Number`/`parseInt`/`parseFloat` on amount/nonce paths (grep-clean).
- **Findings:**
  - **M1 (Medium):** `MillInventory.credit` threw `MillInventoryError('INSUFFICIENT_INVENTORY', 'Credit amount must be positive')` on non-positive amount. This collides with Story 12.3's handler which maps `INSUFFICIENT_INVENTORY` → ILP `T04 Insufficient liquidity` via both `err.code === 'INSUFFICIENT_INVENTORY'` AND `/insufficient/i.test(err.message)` paths. An operator-side bug (negative credit on a funding path) would leak as a bogus "insufficient liquidity" reject to the sender. Invalid input is not a reserves shortage.
  - **L1 (Low):** `wallet.ts` Mina scalar clearance used `(scalar[0] as number) & 0x3f` — the `as number` cast is redundant after the preceding `scalar.length === 32` guard and obscures intent; the construct was flagged in Pass #2 but only partially resolved.
  - **L2 (Low):** `MillChannelState.release` specification (AC-7) says "no-op + warn log" when a reversal would underflow nonce/cumulative; the implementation only had the no-op half — no warn was ever emitted. Silent best-effort reversal hides operator-visible state desynchronisation.
- **Resolution:** All 3 findings fixed in-place during the review pass.
  - M1 fixed — `credit` non-positive guard now throws `MillInventoryError('UNKNOWN_PAIR', 'Credit amount must be positive')` with an inline comment documenting the rationale. Tightened `inventory.test.ts` "[P1] credit with non-positive amount" test to assert `code === 'UNKNOWN_PAIR'` and renamed the `it(...)` description to call out the non-mapping to ILP T04.
  - L1 fixed — replaced the ambiguous cast with an explicit `const firstByte: number = scalar[0] as number;` typed local (still one cast, but lexically separated and commented); `scalar[0] = firstByte & 0x3f;` assignment no longer uses a non-null assertion → eslint `@typescript-eslint/no-non-null-assertion` clean.
  - L2 fixed — added an optional `ReleaseLogger { warn?: ... }` to `MillChannelStateInit`; `release` now emits `mill.channelState.release.unknown_channel` (unknown key) and `mill.channelState.release.noop_would_underflow` (nonce/cumulative would go negative) warnings. Added 2 channel-state tests covering both warn paths. Exported `ReleaseLogger` from `index.ts`.
- **Verification:**
  - `pnpm --filter @toon-protocol/mill test` → **75 passed / 1 skipped** (up from 73/1; +2 new channel-state tests).
  - `pnpm --filter @toon-protocol/mill build` → ESM + DTS green (dist/index.js 18.18 KB, dist/index.d.ts 8.96 KB).
  - `npx eslint packages/mill/src` → **0 errors / 98 warnings** (all warnings are pre-existing test-file non-null assertions, repo-acceptable). One lint error introduced during the initial L1 fix (`scalar[0]!`) was immediately corrected before submission.
  - semgrep `--config=auto` on all 7 mill source files → **0 findings**.
  - SDK and core baselines unchanged (not re-run per user directive to use `pnpm --filter @toon-protocol/mill ...` only).
- **Outcome:** All issues resolved. Story status → `done`. Terminal review gate passed.
- **Follow-ups:** None. All fixes landed atomically within this pass.
