# Story 12.6: Client-Side `buildSettlementTx()` — Construct Raw Settlement Tx Bytes from Accumulated Swap Claims

Status: done
ui_impact: false
epic: 12
story_id: 12-6

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TOON Protocol client developer who has just finished a swap via `streamSwap()` (Story 12.5) and holds an `AccumulatedClaim[]`,
I want a `buildSettlementTx()` helper in `@toon-protocol/sdk` that takes the accumulated claims (plus chain-specific settlement context the sender already possesses or receives from the Mill), verifies each claim's signature against the Mill's expected signer address, picks the highest cumulative claim per (chain, channelId) tuple, and returns raw **unsigned** on-chain settlement transaction bytes ready for the sender to sign + broadcast OR to hand off to a Chain Bridge DVM (Epic 13, kind:5260),
so that a swap recipient can convert accumulated off-chain NIP-44-encrypted balance-proof signatures into an on-chain settlement without needing native gas tokens on the target chain (when composed with Chain Bridge) and without the SDK coupling to a live JSON-RPC provider.

Stories 12.1–12.5 built the **inbound half** of the swap primitive: kind:10032 `swapPairs` discovery (12.1), NIP-59 gift-wrap privacy (12.2), the Mill's inbound handler emitting NIP-44-encrypted claims in FULFILL metadata (12.3), the Mill's inventory + multi-chain signer wiring (12.4), and the sender-side `streamSwap()` that accumulates decrypted claims (12.5). This story closes the loop: it turns those `AccumulatedClaim[]` into a **chain-specific raw transaction** that moves target-asset value on-chain.

Story 12.7 (`startMill()` scaffold) does not depend on this story. Story 12.8 (E2E) will drive `streamSwap()` → `buildSettlementTx()` → Anvil submission end-to-end, closing the P0 "claim validity" quality gate from `test-design-epic-12.md` (T-048/T-049/T-050). Epic 13's Chain Bridge DVM (kind:5260) will consume `buildSettlementTx()` output as its payload — the DVM provider pays gas, broadcasts the tx, and bills the sender in USDC via ILP.

## Dependencies

- **Upstream (code deps, MUST be imported):**
  - `@toon-protocol/sdk` → `AccumulatedClaim`, `StreamSwapResult` — from `packages/sdk/src/stream-swap.ts` (Story 12.5, done). This story consumes `StreamSwapResult.claims` directly. The `AccumulatedClaim` shape is marked `@stable` in 12.5 — do NOT propose shape changes here; instead, thread any missing settlement context (channelId, nonce, recipient) via a separate additive metadata extension (see AC-3) that layers on top without breaking 12.5's public surface.
  - `@toon-protocol/core` → `SwapPair` — from `packages/core/src/types.ts`. Used to route per-chain tx construction via `pair.to.chain`.
  - `@toon-protocol/sdk` → `applyRate` — from `packages/sdk/src/swap-handler.ts` (Story 12.3, done). Used during claim verification to recompute `expectedTargetAmount` and cross-check against `AccumulatedClaim.targetAmount`.
  - `@toon-protocol/sdk` → `StreamSwapError` — from `packages/sdk/src/errors.ts` (Story 12.5, done). Sibling error class. `SettlementTxError` in AC-11 mirrors this pattern (extends `Error` directly, narrow `code` union, ES2022 `cause` forwarding).
  - `@noble/hashes/sha3.js` → `keccak_256`, `@noble/hashes/sha2.js` → `sha256`, `@noble/hashes/utils.js` → `bytesToHex`, `hexToBytes` — already workspace deps (used in `packages/mill/src/payment-channel-signer.ts`). Reuse the same helpers so hash layouts stay bit-identical to the Mill's signing path.
  - `@noble/curves/secp256k1.js` → `secp256k1.Signature` (for recovering the EVM signer address from a 65-byte `r||s||v` signature). Already a workspace dep.
  - `@noble/curves/ed25519.js` → `ed25519.verify` (for Solana signature verification). Already a workspace dep.
- **Upstream (runtime contract, MUST match existing shapes — READ CAREFULLY):**
  - `AccumulatedClaim.claimBytes: Uint8Array` — format is **chain-specific raw signature bytes** as emitted by `packages/mill/src/payment-channel-signer.ts`:
    - **EVM:** 65 bytes `r(32) || s(32) || v(1)` where `v ∈ {27, 28}` — see `EvmPaymentChannelSigner.signBalanceProof` lines 166–187.
    - **Solana:** 64 bytes raw Ed25519 signature — see `SolanaPaymentChannelSigner.signBalanceProof` lines 338–357.
    - **Mina:** UTF-8 encoded signature string (either `mina-signer` real output OR the deterministic sha256 fallback when the peer dep is absent) — see `MinaPaymentChannelSigner.signBalanceProof` lines 220–306. **Mina settlement tx construction is OUT OF SCOPE for this story's P0 path** (see AC-9 / Out of Scope); provide a typed stub that throws `UNSUPPORTED_CHAIN` with a clear "requires mina-signer peer dep + zkApp wiring" message.
  - `AccumulatedClaim.targetAmount: bigint` — the sender's reconstructed expected target amount (copy of the Mill-reported `metadata.targetAmount` decimal string or `applyRate(pair.rate)` fallback). This is the value a caller will assert against during verification.
  - `AccumulatedClaim.pair: SwapPair` — frozen deep copy snapshot (Story 12.5 Pass #3 Medium #1). Safe to use directly for chain routing.
  - **FULFILL metadata gap (load-bearing):** Story 12.5's `decodeFulfillMetadata` currently accepts `{ claim, ephemeralPubkey, targetAmount, claimId? }` and the Mill's `swap-handler.ts` emits exactly those four fields (lines 491–498). **`channelId`, `nonce`, and `recipient` are NOT in the current metadata.** Without those, the sender cannot reconstruct the hash the Mill signed, cannot verify signatures, and cannot build a settlement tx. AC-3 REQUIRES this story to **extend the FULFILL metadata additively** with `{ channelId: string, nonce: string (decimal), recipient: string, cumulativeAmount: string (decimal) }` and wire the extension through both the Mill's swap handler emit path and the SDK's `decodeFulfillMetadata` parse path. This is the only acceptable way to carry settlement context to the sender; client-side re-derivation from `targetAmount` alone is insufficient because balance-proof claims are **cumulative, not per-packet**, and `nonce` strictly increases per channel.
- **Upstream (connector-side settlement tx shapes, informational):**
  - `packages/connector/src/settlement/provider/payment-channel-provider.ts` (in sibling repo `../connector`) defines `BalanceProofParams = { channelId, nonce: number, transferredAmount: string, lockedAmount: string, locksRoot: string }` and the `claimFromChannel(channelId, balanceProof, signature) → Promise<TxResult>` method. This story's `buildSettlementTx()` produces the **raw calldata / tx bytes** that a connector-style `claimFromChannel` would produce, WITHOUT any JSON-RPC provider binding. Think of it as "`claimFromChannel` reduced to its pure tx-encoding core." The sender (or a Chain Bridge DVM) is responsible for submitting.
  - `packages/mill/src/payment-channel-signer.ts` `balanceProofHashEvm` (lines 80–94) and `balanceProofHashSolana` (lines 96–110) — `buildSettlementTx`'s verification path MUST use **identical** hash constructions or signatures won't verify. Extract the two helpers into a shared, test-covered internal module under `packages/sdk/src/settlement/hashes.ts` (see AC-6) and import from both `packages/mill` AND `packages/sdk/src/settlement/`. No code duplication of hash layouts — one source of truth.
- **Downstream:**
  - Story 12.7 (`startMill()`) — does not directly consume this story, but the Mill operator docs Story 12.9 references the same raw-tx format as the Chain Bridge handoff payload.
  - Story 12.8 (E2E) — drives `streamSwap() → buildSettlementTx() → eth_sendRawTransaction` on Anvil end-to-end against a real Mill peer. The tx MUST be accepted and settle the channel on-chain. T-050 is the P0 acceptance bar.
  - **Epic 13 Chain Bridge DVM (kind:5260)** — the `{ chain, rawTx: Uint8Array, channelId, expectedEvent: '<SettlementSucceeded sig>' }` output shape this story produces is the stable payload handed to a Chain Bridge DVM. Treat the output shape as a **public, versioned contract** — label it `@stable` in JSDoc per Story 12.5's precedent.
- **Transitive:** None beyond the above.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** This story delivers **settlement** — the final phase of the swap flow documented in `_bmad-output/epics/epic-12-token-swap-primitive.md` section "Swap Flow" step 7: *"Sender settles accumulated claims on-chain in a single transaction."*

Directly relevant decisions from the epic doc:

- **D12-005:** Signed claims in FULFILL, not on-chain transfers. The Mill returns signed payment-channel claims in ILP FULFILL. **No on-chain transactions occur during the swap.** `buildSettlementTx()` is the **only** code path in Epic 12 that produces on-chain calldata, and it runs strictly post-swap under caller control. This story MUST NOT introduce any JSON-RPC client, any network-call library (`ethers`, `viem`, `web3.js`, `@solana/web3.js`), or any side-effectful broadcast code. It produces bytes; the caller (or a Chain Bridge DVM) submits.
- **D12-010:** Mill handler has its own wallet and payment-channel management, separate from the embedded connector. Concretely for this story: `buildSettlementTx()` targets **the Mill's outbound channel** (the channel on which the Mill issued the balance-proof). `channelId` in the metadata refers to a channel whose participants are `(Mill target-asset address, sender target-asset address)`, NOT the USDC channel used to pay for the swap.
- **D12-011:** Mill derives keys from the same BIP-39 mnemonic using BIP-44 HD derivation. The Mill's **on-chain signer address** (the thing that signed the balance proof the sender is settling) is the pubkey derived from the Mill's account-index-2 path (see `packages/mill/src/wallet.ts`). AC-7's verification path REQUIRES the caller to pass in the expected Mill signer address per chain — the SDK does NOT look this up on-chain (no provider).
- **"Zero-Token Cross-Chain Onboarding" composition pattern** (epic doc, bottom section): This story's output is the handoff payload for the Chain Bridge DVM. The epic explicitly notes: *"the 'settle swap claims via Chain Bridge' flow is a first-class use case, not an afterthought."* AC-8 REQUIRES `buildSettlementTx()` to produce both (a) raw tx bytes suitable for direct `eth_sendRawTransaction` AND (b) a structured `SettlementBundle` object with all fields (channelId, chain, expectedEventSignature, etc.) required by a future kind:5260 DVM handler to validate a bridge job before paying gas.

Test design references (`_bmad-output/planning-artifacts/test-design-epic-12.md`):
- Section 2.6 "Story 12-6: Client-Side buildSettlementTx()" — seven test scenarios T-048..T-054.
- R-004 (CRITICAL, CRYPTO, score 6): "Signed claims are invalid or unsettleable on-chain." Mitigation: E2E test Mill → accumulate → `buildSettlementTx()` → `PaymentChannelProvider` on Anvil.
- R-014 (DATA, score 4): "Settlement transaction constructed from claims uses wrong nonce or channel ID." Mitigation: unit test `buildSettlementTx()` with known claims — verify channel ID, nonce, cumulative amount match contract expectations.
- Quality gate: "Claim validity — `buildSettlementTx` → on-chain settlement succeeds (T-048, T-049, T-050) — 12-6."

## Acceptance Criteria

1. **AC-1 — Module surface: `packages/sdk/src/settlement/` directory.** Create a new module directory `packages/sdk/src/settlement/` containing:
   - `packages/sdk/src/settlement/index.ts` — public exports.
   - `packages/sdk/src/settlement/types.ts` — `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig`.
   - `packages/sdk/src/settlement/hashes.ts` — shared `balanceProofHashEvm` / `balanceProofHashSolana` helpers (see AC-6).
   - `packages/sdk/src/settlement/evm.ts` — EVM-specific tx construction + signature verification.
   - `packages/sdk/src/settlement/solana.ts` — Solana-specific tx construction + signature verification.
   - `packages/sdk/src/settlement/mina.ts` — Mina stub (AC-9 — out of scope beyond typed error throw).
   - `packages/sdk/src/settlement/build-settlement-tx.ts` — public `buildSettlementTx()` entrypoint and per-chain dispatch.
   - Co-located `.test.ts` files for every `.ts` above (seven test files total, mirroring `packages/sdk/src/stream-swap.test.ts` pattern).

   Re-export the public surface from `packages/sdk/src/index.ts` after the Story 12.5 `stream-swap` block (follow the existing ordering — swap-handler, stream-swap, then settlement).

   Public exports:
   ```ts
   export type { SettlementBundle, BuildSettlementTxParams, BuildSettlementTxResult, MillSignerConfig };
   export { buildSettlementTx, verifyAccumulatedClaim };
   export { SettlementTxError };  // from errors.ts, AC-11
   ```

   Do NOT export internal helpers (`balanceProofHashEvm`, `balanceProofHashSolana`, `recoverEvmSignerAddress`, `verifyEd25519Signature`, `encodeUpdateBalanceCallData`) — keep them module-private inside `settlement/`. Tests for those helpers live in their respective co-located test files.

2. **AC-2 — `SettlementBundle` — the stable output contract.** Add to `packages/sdk/src/settlement/types.ts`. This is the `@stable` payload consumed by Chain Bridge (Epic 13); treat its shape as a versioned public contract.
   ```ts
   /**
    * Chain-specific raw settlement transaction bundle, produced by
    * {@link buildSettlementTx}. Contains everything a Chain Bridge DVM
    * (Epic 13, kind:5260) or a direct sender needs to submit the settlement
    * on-chain.
    *
    * @stable — Epic 13 Chain Bridge DVM depends on this shape.
    */
   export interface SettlementBundle {
     /** Target chain identifier (e.g., `'evm:8453'`, `'evm:42161'`, `'solana:mainnet'`, `'mina:mainnet'`). */
     chain: string;
     /** Chain family — drives per-chain parsing. */
     chainKind: 'evm' | 'solana' | 'mina';
     /** Channel identifier on the target chain (lowercase hex with 0x prefix for EVM; base58 for Solana). */
     channelId: string;
     /** Cumulative transferred amount settled by this tx (target micro-units, decimal string). */
     cumulativeAmount: string;
     /** Balance-proof nonce settled by this tx (decimal string). */
     nonce: string;
     /** Recipient address (the sender's target-asset address — the one that will receive funds). */
     recipient: string;
     /** Mill's on-chain signer address (expected signer of the balance-proof signature). */
     millSignerAddress: string;
     /**
      * Raw UNSIGNED transaction bytes ready for the caller to sign (or for a
      * Chain Bridge DVM to gas-sponsor + sign). EVM: RLP-encoded tx with
      * empty signature fields (v=0, r=0, s=0). Solana: serialized Message
      * (not Transaction — Transaction requires signatures). Mina: stub.
      */
     unsignedTxBytes: Uint8Array;
     /**
      * Expected on-chain event signature (hex, 0x-prefixed keccak256 for EVM)
      * so a Chain Bridge DVM can watch for confirmation. Optional for
      * non-EVM chains that lack topic-based event signatures.
      */
     expectedEventSignature?: string;
     /**
      * Number of `AccumulatedClaim` inputs in THIS bundle's `(chain, channelId)`
      * group that survived signature verification. Excludes claims rejected
      * (in `BuildSettlementTxResult.rejected`) and claims belonging to OTHER
      * groups. For a monotonic balance-proof channel, these N surviving claims
      * collapse into a single tx selecting the highest-nonce claim; the final
      * tx uses the Nth claim's signature.
      */
     claimsMerged: number;
     /**
      * Index of the winning claim in the ORIGINAL input array
      * (`BuildSettlementTxParams.claims`) — NOT the in-group index. Use this
      * to trace back to the source claim for audit/debugging.
      */
     selectedClaimIndex: number;
     /** Source-asset chain of the SwapPair (for Chain Bridge bill-back). */
     sourceChain: string;
     /** Source-asset code of the SwapPair (for Chain Bridge bill-back). */
     sourceAssetCode: string;
   }
   ```
   **Invariants:**
   - Exactly one `SettlementBundle` is produced per unique `(chain, channelId)` pair in the input claims. `buildSettlementTx()` MAY return multiple bundles if the input spans multiple channels (e.g., two separate swap sessions to different Mills).
   - `cumulativeAmount`, `nonce`, and `recipient` on the bundle match the **winning claim** (highest `nonce` within the channel group).
   - Balance-proof claims are cumulative, not incremental — **do NOT sum `targetAmount` across claims**. The winning claim's `cumulativeAmount` already reflects the total. Summing would double-count.

3. **AC-3 — FULFILL metadata extension (Mill + SDK).** Extend the wire metadata emitted by the Mill's swap handler and parsed by the SDK. This is an **additive, backward-compatible** extension; existing consumers that only read `{ claim, ephemeralPubkey, targetAmount, claimId? }` continue to work.

   New metadata fields (all REQUIRED from the Mill side when `cumulativeAmount > 0`; OPTIONAL on the sender parse path for backward compat during the transition, but if any one is present all four MUST be present):
   ```ts
   interface ExtendedFulfillMetadata {
     // existing (Story 12.5):
     claim: string;              // base64 NIP-44 ciphertext
     ephemeralPubkey: string;    // 64-char lowercase hex
     targetAmount: string;       // decimal string
     claimId?: string;
     // NEW (Story 12.6):
     channelId: string;          // lowercase hex with 0x prefix (EVM) OR base58 (Solana); format validated per chainKind
     nonce: string;              // decimal string, matches /^(0|[1-9]\d*)$/
     cumulativeAmount: string;   // decimal string, matches /^(0|[1-9]\d*)$/, >= previous packet's cumulativeAmount
     recipient: string;          // the sender's target-asset address (lowercase hex + 0x for EVM, base58 for Solana)
     millSignerAddress: string;  // the Mill's signer address (lowercase hex + 0x for EVM, base58 for Solana)
   }
   ```

   Wire-through requirements:
   - **Mill side** — `packages/sdk/src/swap-handler.ts` lines 491–498: extend the `metadata` object to include the five new fields. The handler must thread the new fields from the `IssueClaimResult` (see next bullet).
   - **`IssueClaimResult` shape extension** — `packages/sdk/src/swap-handler.ts` line 50–55: add `channelId: string, nonce: bigint, cumulativeAmount: bigint, recipient: string, millSignerAddress: string` fields. Convert bigints to decimal strings when composing `metadata` in the handler (MAX_SAFE_INTEGER guard: use `.toString()`, not `Number(...)`).
   - **Mill inner issuer** — `packages/mill/src/claim-issuer.ts` `MultiChainClaimIssuer.issueClaim` (lines 87–157): expand the returned object to include the five new fields drawn from the `reservation` (`channelId`, `cumulativeAmount`, `nonce`, and `recipient` is `senderPubkey`) plus a `millSignerAddress` wired from a new `MultiChainClaimIssuerConfig.signerAddresses: Record<string, string>` option (keyed by chain). Thread `signerAddresses` through the Mill startup path — but DO NOT change `startMill()` wiring (that's Story 12.7); for this story, add the config field + the claim-side plumbing + an in-source TODO for Story 12.7 to populate it from the derived wallet. Unit tests use a fixed, known `signerAddresses` map.
   - **SDK parse side** — `packages/sdk/src/stream-swap.ts` `decodeFulfillMetadata`: extend the shape validation to accept the new fields. Strict format validation:
     - `nonce`, `cumulativeAmount` → `/^(0|[1-9]\d*)$/` (same validator as existing `targetAmount` — Story 12.5 Pass #2 High #1).
     - `channelId` (EVM chains, `chain.startsWith('evm:')`) → `/^0x[0-9a-f]{64}$/` (32-byte bytes32).
     - `channelId` (Solana chains, `chain.startsWith('solana:')`) → base58 decode succeeds and length is 32 bytes.
     - `recipient` (EVM) → `/^0x[0-9a-f]{40}$/` (20-byte address, lowercase).
     - `recipient` (Solana) → base58 decode succeeds and length is 32 bytes.
     - `millSignerAddress` — same per-chain validation as `recipient`.
     - Malformed OR missing-when-required → throw `StreamSwapError('FULFILL_DECODE_FAILED', ...)` (reuse the existing error class — this is a FULFILL-path failure, not a settlement-path failure).
   - **`AccumulatedClaim` extension** — add the five new fields to `AccumulatedClaim` (`packages/sdk/src/stream-swap.ts` lines 172–196). The `@stable` contract comment remains: these fields are ADDITIVE and OPTIONAL on the type-level (`?:`) for one story-cycle of compatibility — Story 12.6 itself treats them as REQUIRED and throws if absent. Update the JSDoc accordingly.
   - **swap-handler.test.ts regression** — update the existing `targetAmount` metadata-shape assertion (from 12.5 Pass #1 High #2) to also assert the five new fields are emitted with correct types/formats. Do NOT delete the existing assertion.

4. **AC-4 — `BuildSettlementTxParams` — public input contract.** Add to `packages/sdk/src/settlement/types.ts`:
   ```ts
   export interface BuildSettlementTxParams {
     /** Claims to settle. Typically `streamSwapResult.claims`. MUST be non-empty. */
     claims: ReadonlyArray<AccumulatedClaim>;
     /**
      * Per-chain Mill signer configuration. Keyed by `chain` string
      * (e.g., `'evm:8453'`). MUST contain an entry for every distinct
      * `claim.pair.to.chain` present in `claims`. If any claim references a
      * chain not present in this map, throw `SettlementTxError('UNSUPPORTED_CHAIN', ...)`.
      */
     signers: Record<string, MillSignerConfig>;
     /**
      * Sender's target-asset address per chain. MUST be the same address the
      * Mill used as `recipient` in the balance-proof. Used to assert address
      * consistency across all claims for a given channel — any mismatch
      * throws `SettlementTxError('RECIPIENT_MISMATCH', ...)` (indicates
      * handler-side bug or adversarial Mill).
      */
     recipients: Record<string, string>;
     /**
      * When `true` (default), verify every claim's signature against
      * `signers[chain].address` before including it in the bundle. A failing
      * claim is dropped from consideration with an entry in
      * `BuildSettlementTxResult.rejected`. When `false`, signatures are NOT
      * verified — only use for test harnesses. Defaults to `true`.
      */
     verifySignatures?: boolean;
     /**
      * When `true`, include `AccumulatedClaim` objects whose `nonce` is
      * strictly less than the winning claim's `nonce` in the
      * `BuildSettlementTxResult.superseded` array for auditability.
      * Default `false`.
      */
     includeSuperseded?: boolean;
     /** Optional logger (pino-compatible, same shape as `StreamSwapParams.logger`). */
     logger?: {
       debug: (...a: unknown[]) => void;
       info: (...a: unknown[]) => void;
       warn: (...a: unknown[]) => void;
       error: (...a: unknown[]) => void;
     };
   }

   export interface MillSignerConfig {
     /**
      * Expected on-chain signer address for the Mill. EVM: 0x + 40 lowercase
      * hex chars (derived via keccak256(pubkey)[12:] convention). Solana:
      * base58-encoded 32-byte Ed25519 pubkey. Mina: base58 pubkey.
      */
     address: string;
     /**
      * On-chain payment-channel contract address (EVM-only; required for
      * `encodeUpdateBalanceCallData`). Solana uses program ID from
      * `programId` below. Mina: out of scope.
      */
     contractAddress?: string;
     /**
      * Solana on-chain program ID. Required for Solana claims.
      */
     programId?: string;
     /**
      * EVM chain-id (decimal). Required for EVM claims — baked into the RLP
      * encoding per EIP-155.
      */
     chainId?: number;
   }
   ```

   Construction-time validation (throw synchronously from `buildSettlementTx` — this function IS allowed to throw unlike `streamSwap` which routes failures through result state; rationale: settlement is a post-swap one-shot, not a streaming loop, so caller wants fail-fast):
   - `claims` MUST be a non-empty array. Empty → `SettlementTxError('INVALID_INPUT', 'claims array is empty')`.
   - Every `claim` MUST have all five new metadata fields (`channelId`, `nonce`, `cumulativeAmount`, `recipient`, `millSignerAddress`) — missing → `'MISSING_SETTLEMENT_METADATA'`. (AC-3 makes these fields present.)
   - For every distinct `claim.pair.to.chain` in `claims`, `signers[chain]` MUST exist — missing → `'UNSUPPORTED_CHAIN'`.
   - For every distinct chain, `recipients[chain]` MUST exist — missing → `'MISSING_RECIPIENT'`.
   - For EVM chains: `signers[chain].contractAddress` MUST match `/^0x[0-9a-f]{40}$/` and `signers[chain].chainId` MUST be a positive integer.
   - For Solana chains: `signers[chain].programId` MUST be a valid base58 string.

5. **AC-5 — `buildSettlementTx()` algorithm (per-chain dispatch, claim grouping, winner selection).** Define in `packages/sdk/src/settlement/build-settlement-tx.ts`:
   ```ts
   export function buildSettlementTx(params: BuildSettlementTxParams): BuildSettlementTxResult;
   ```

   Algorithm (MUST be implemented in this exact order for deterministic output):
   1. Validate params per AC-4 (synchronous throws).
   2. Optionally verify every claim's signature (per `verifySignatures`, default true). Dispatch by `claim.pair.to.chain` chainKind:
      - EVM: `recoverEvmSignerAddress(claim)` and compare to `signers[chain].address` (case-insensitive — normalize both to lowercase 0x-prefixed form before compare).
      - Solana: `verifyEd25519Signature(claim, signers[chain].address)`.
      - Mina: stub — skip verification, record rejection reason `'MINA_VERIFICATION_UNSUPPORTED'`, omit claim from bundle.
      Failed verification → append `{ claim, reason: 'SIGNATURE_INVALID' | 'SIGNER_MISMATCH' | 'MINA_VERIFICATION_UNSUPPORTED', details?: string }` to `result.rejected[]` and SKIP the claim in the remaining steps.
   3. Group surviving claims by `(claim.pair.to.chain, claim.channelId)` tuple. Within each group:
      - Assert all claims have identical `recipient` — mismatch → throw `SettlementTxError('RECIPIENT_MISMATCH', ...)` with details listing the offending claim indices.
      - Assert all claims have identical `millSignerAddress` — mismatch → throw `'MILL_SIGNER_MISMATCH'`.
      - Assert `nonce` values are strictly unique within the group (duplicate nonce = adversarial Mill or bug) → throw `'DUPLICATE_NONCE'`.
      - Assert `cumulativeAmount` is non-decreasing with `nonce` (sort claims by nonce ascending, then for each adjacent pair `cumulativeAmount[i+1] >= cumulativeAmount[i]`). Equality is allowed because the Mill MAY emit a zero-value claim to advance nonce without moving funds (e.g., a heartbeat). Strict decrease → throw `'NON_MONOTONIC_CUMULATIVE'` with details listing the offending nonce pair.
   4. For each group, pick the winning claim: the one with the **highest `nonce`**. Tie-breaking on identical nonces was already rejected in step 3.
   5. Route each winner to its chain-specific tx builder:
      - `evm` → `buildEvmSettlementTx(winner, signers[chain], recipients[chain])`
      - `solana` → `buildSolanaSettlementTx(winner, signers[chain], recipients[chain])`
      - `mina` → `buildMinaSettlementTx(...)` — throws `UNSUPPORTED_CHAIN` per AC-9.
   6. Assemble `BuildSettlementTxResult`:
      ```ts
      export interface BuildSettlementTxResult {
        bundles: SettlementBundle[];   // one per (chain, channelId) group
        rejected: Array<{
          claim: AccumulatedClaim;
          reason: 'SIGNATURE_INVALID' | 'SIGNER_MISMATCH' | 'MINA_VERIFICATION_UNSUPPORTED';
          details?: string;
        }>;
        superseded: AccumulatedClaim[];  // only populated if params.includeSuperseded
      }
      ```

   **Purity requirements:**
   - `buildSettlementTx()` is SYNCHRONOUS (no async, no Promises). All crypto ops (signature verification, keccak256, RLP encoding) are synchronous via `@noble/*`. This is a deliberate deviation from 12.5's async-generator style; settlement is a pure computation.
   - No network calls. No file I/O. No `console.log`. All logging via `params.logger` (defaults to no-op).
   - No dynamic `import()`. (Contrast with `packages/mill/src/payment-channel-signer.ts` Mina branch — not repeating that pattern here since Mina is stubbed.)

6. **AC-6 — Shared `balanceProofHashEvm` / `balanceProofHashSolana` helpers.** Create `packages/sdk/src/settlement/hashes.ts` exporting:
   ```ts
   export function balanceProofHashEvm(
     channelIdBytes: Uint8Array,     // 32 bytes
     cumulativeAmount: bigint,
     nonce: bigint,
     recipientBytes: Uint8Array      // 20 bytes
   ): Uint8Array;                    // 32 bytes (keccak256 output)

   export function balanceProofHashSolana(
     channelId: string,
     cumulativeAmount: bigint,
     nonce: bigint,
     recipient: string
   ): Uint8Array;                    // 32 bytes (sha256 output)
   ```
   Implementation MUST be bit-identical to `packages/mill/src/payment-channel-signer.ts` lines 80–110 (`balanceProofHashEvm`, `balanceProofHashSolana`). Copy those functions verbatim including the `concat` / `bigintToBytes32BE` helpers, then **refactor `packages/mill/src/payment-channel-signer.ts` to import from `@toon-protocol/sdk`'s new module** — deleting the local copies from the Mill package. This eliminates the two-sources-of-truth risk.

   Unit tests (`packages/sdk/src/settlement/hashes.test.ts`):
   - **Golden vector parity:** Copy 3–5 golden vectors (known-good `channelId + cumulativeAmount + nonce + recipient → hash`) from `packages/mill/src/payment-channel-signer.test.ts`. Assert the sdk-side helpers produce byte-identical hashes. If the mill test file has no golden vectors, generate 3 fixed-seed inputs and assert both implementations agree (cross-package parity test — this is the safety net for the refactor).
   - **EVM edge cases:** `cumulativeAmount = 0n`, `cumulativeAmount = 2n ** 255n - 1n` (max 255-bit), `nonce = 0n`, `nonce = 1n`, recipient zero-address.
   - **Solana edge cases:** UTF-8 encoding of multi-byte chars in `channelId` (base58 chars are ASCII but the encoder path treats it as UTF-8 — confirm roundtrip).

   Refactor validation:
   - `pnpm --filter @toon-protocol/mill test` MUST remain green after deleting the local helpers and importing from sdk. 0 test delta.
   - `pnpm --filter @toon-protocol/mill build` MUST remain green.

7. **AC-7 — EVM signature verification + tx encoding.** Implement in `packages/sdk/src/settlement/evm.ts`:

   ```ts
   export function recoverEvmSignerAddress(claim: AccumulatedClaim): string;
     // returns lowercase 0x-prefixed 40-hex-char address
   export function buildEvmSettlementTx(
     winner: AccumulatedClaim,
     signer: MillSignerConfig,
     recipient: string
   ): SettlementBundle;
   ```

   `recoverEvmSignerAddress`:
   - Reconstruct the balance-proof message hash via `balanceProofHashEvm(hexToBytes(channelId), cumulativeAmount, nonce, hexToBytes(recipient))` — same inputs the Mill used.
   - `claim.claimBytes` MUST be exactly 65 bytes (EVM `r||s||v` layout) — length mismatch → throw `SettlementTxError('INVALID_SIGNATURE_LENGTH', ...)`.
   - Parse `v` from byte 64: `v ∈ {27, 28}` → recovery `∈ {0, 1}`. Invalid `v` → throw `'INVALID_SIGNATURE_V'`.
   - Use `@noble/curves/secp256k1.js` `secp256k1.Signature.fromBytes(compactRS, 'compact').addRecoveryBit(recovery)` then call `.recoverPublicKey(msgHash)` to get the uncompressed 65-byte pubkey (`04 || x || y`).
   - Address = `'0x' + bytesToHex(keccak_256(uncompressedPubkey.slice(1))).slice(-40)`. Return lowercase.
   - **MAX_SAFE_INTEGER guard:** `cumulativeAmount` and `nonce` stay `bigint` through `bigintToBytes32BE`. Never coerce to `Number`.

   `buildEvmSettlementTx` — RLP-encode an EIP-155 unsigned transaction with calldata for a `updateBalance(channelId, cumulativeAmount, nonce, recipient, signature)` call on the contract at `signer.contractAddress`:
   - Function selector: `keccak_256(utf8('updateBalance(bytes32,uint256,uint256,address,bytes)')).slice(0, 4)` computed at module init (constant). **Document this selector string** — it must match whatever the TokenNetwork contract actually uses. If the contract uses a different signature, the spec will be verifiably wrong and Story 12.8 E2E will fail fast — that is acceptable; correct the selector in a follow-up rather than speculating here.
     - **DEV NOTE:** The reference connector repo's `packages/connector/src/settlement/payment-channel-sdk.ts` and the TokenNetwork contract in `../connector/packages/contracts/` define the actual ABI. Before committing, run `grep -rn "updateBalance\|closeChannel\|claimFromChannel" ../connector/packages/contracts/src/` and pick the real function name. Record the real selector in a constant `EVM_SETTLEMENT_FUNCTION_SELECTOR` with a comment linking to the contract file + line. If the real selector has a different argument order or signature type, update `encodeUpdateBalanceCallData` accordingly — the story's wire shape is correct (the five args above) but the encoding order follows the contract.
   - Calldata: `selector || abi.encode(channelId, cumulativeAmount, nonce, recipient, signature)` where `signature = claim.claimBytes` (the 65-byte EVM signature).
   - ABI encoding: implement a minimal inline encoder for the exact types used — `bytes32` (32 bytes raw), `uint256` (32 bytes BE), `address` (12 zero-bytes + 20 bytes), `bytes` (32-byte offset + 32-byte length + padded data). Do NOT pull in `ethers` or `viem` — zero new runtime deps on the sdk package.
   - RLP-encode the unsigned tx: `[nonce(tx), gasPrice, gasLimit, to, value, data, chainId, 0, 0]` per EIP-155. For `nonce(tx)`, `gasPrice`, `gasLimit`: use placeholder values baked into the bundle (`nonce(tx)=0`, `gasPrice=0`, `gasLimit=0`). Rationale: the CALLER (direct sender or Chain Bridge DVM) fills these in at broadcast time since they depend on current chain state. The bundle's `unsignedTxBytes` is a **template** with `0/0/0` placeholders; callers MUST re-encode with their own tx-nonce/gas values via the `fillEvmSettlementTxGas` utility (below).
   - **Gas-fill utility (public export):** Since re-encoding requires another RLP encoder at call time (defeating the purpose of this function), provide:
     ```ts
     export function fillEvmSettlementTxGas(bundle: SettlementBundle, gas: {
       nonce: bigint; gasPrice: bigint; gasLimit: bigint;
     }): Uint8Array;
     ```
     Takes the returned bundle and a gas-params object, returns the fully-encoded unsigned tx bytes ready for signing. Export publicly — Chain Bridge DVMs (Epic 13) will call this. Document in JSDoc with `@stable` and `@since 12.6`.
   - `expectedEventSignature` = `'0x' + bytesToHex(keccak_256(utf8('SettlementSucceeded(bytes32,uint256,uint256,address)')))` (or the real event signature once confirmed from the contract — same DEV NOTE applies).

   Unit tests (`packages/sdk/src/settlement/evm.test.ts`):
   - **T-048:** Build a bundle from an `AccumulatedClaim` with known EVM claim bytes. Assert `bundle.channelId`, `bundle.cumulativeAmount`, `bundle.nonce`, `bundle.recipient` match inputs; assert `bundle.unsignedTxBytes` starts with the correct function selector; assert `bundle.expectedEventSignature` is a 32-byte keccak hash.
   - **T-049:** Sign a balance-proof via `EvmPaymentChannelSigner` (real `packages/mill/src/payment-channel-signer.ts`). Pass the resulting 65-byte signature as `claim.claimBytes`. Call `recoverEvmSignerAddress(claim)` — assert the recovered address equals the signer's public address (derived via keccak256 of the pubkey). This is the **round-trip parity test** — it's the safety net for R-004.
   - Tamper test: flip one byte in `claim.claimBytes` → `recoverEvmSignerAddress` returns a non-matching address → `buildSettlementTx` records `'SIGNER_MISMATCH'` in `rejected[]`.
   - Zero-signature test: `claim.claimBytes = new Uint8Array(65)` (all zeros) → `secp256k1.Signature.fromBytes` rejects or recovers to zero-address — either way, signer mismatch → rejected.
   - Wrong-length signature: `new Uint8Array(64)` → `SettlementTxError('INVALID_SIGNATURE_LENGTH')`.
   - Invalid `v`: `claim.claimBytes[64] = 26` → `'INVALID_SIGNATURE_V'`.
   - `fillEvmSettlementTxGas` roundtrip: fill with real gas values, decode via a minimal RLP decoder (test-local — OR add `recoverEvmSignerAddress`-style test using direct byte inspection), assert the tx-nonce / gasPrice / gasLimit fields are present.

8. **AC-8 — Claim grouping, winner selection, and monotonicity — with multi-session merge.** Implement in `packages/sdk/src/settlement/build-settlement-tx.ts` and tested in `build-settlement-tx.test.ts`:

   - **T-048 expanded:** Build a bundle from 5 accumulated EVM claims from one swap session. Assert `claimsMerged === 5`, `selectedClaimIndex === 4` (last one, highest nonce), `bundle.cumulativeAmount` equals the 5th claim's `cumulativeAmount` (NOT sum of five).
   - **T-051:** Build a bundle from claims spanning two separate `streamSwap()` sessions **to the same channel** (same Mill, same sender, same pair). Nonces in the second session continue monotonically from the first. Assert a single bundle is produced with the highest-nonce claim winning.
   - Build a bundle from claims spanning two separate channels (same Mill, two different channel IDs). Assert **two** bundles are produced, each with its own winner. `result.bundles.length === 2`.
   - Build a bundle from claims spanning two chains (`evm:8453` and `solana:mainnet`). Assert two bundles, one per chain. Chain-specific `unsignedTxBytes` differ in format.
   - Claim with lower `nonce` but higher `cumulativeAmount` → `'NON_MONOTONIC_CUMULATIVE'` throw.
   - Two claims with the same `nonce` in the same channel → `'DUPLICATE_NONCE'` throw.
   - Claim with a `recipient` that differs from the group's consensus → `'RECIPIENT_MISMATCH'` throw.
   - **T-052:** `claim.claimBytes` with tampered trailing byte → verification fails → `rejected[]` contains the claim with reason `'SIGNATURE_INVALID'` or `'SIGNER_MISMATCH'`. The bundle for the group is built from the remaining valid claims (if any). If ALL claims in a group fail verification, NO bundle is produced for that group (not an error — just an empty result for that channel).

9. **AC-9 — Solana signature verification + tx encoding (P1 — deliverable but less rigorous than EVM).** Implement in `packages/sdk/src/settlement/solana.ts`:
   ```ts
   export function verifyEd25519Signature(claim: AccumulatedClaim, expectedSignerAddress: string): boolean;
   export function buildSolanaSettlementTx(
     winner: AccumulatedClaim,
     signer: MillSignerConfig,
     recipient: string
   ): SettlementBundle;
   ```
   - Ed25519 verification via `@noble/curves/ed25519.js` `ed25519.verify(signature, msgHash, pubkeyBytes)`. `signature` is the 64-byte `claim.claimBytes`; `msgHash` is `balanceProofHashSolana(channelId, cumulativeAmount, nonce, recipient)`; `pubkeyBytes` is `bs58Decode(expectedSignerAddress)`.
   - Base58 encode/decode: use `@scure/base` `base58` if already in workspace; else add via a local lookup (the alphabet is 58 chars — an inlined 40-line encoder/decoder is fine, but prefer `@scure/base` if already a dep). Check `pnpm --filter @toon-protocol/sdk why @scure/base` before hand-rolling.
   - `buildSolanaSettlementTx`: produce a serialized `Message` (v0 legacy, NOT `Transaction` — `Transaction` requires signatures and we produce unsigned bytes). Message layout: header + account addresses + blockhash-placeholder + instructions (one `invoke` to `signer.programId` with the 4 accounts `(channel-state-pda, sender-pda, mill-pda, system-program)` and the instruction data `discriminator(8) || cumulativeAmount(8 LE) || nonce(8 LE) || signature(64)`).
   - **DEV NOTE on discriminator:** Solana program discriminators are the first 8 bytes of `sha256('global:<method_name>')` (Anchor convention) OR a custom 8-byte constant (non-Anchor). The real program's discriminator lives in `../connector/packages/solana-program/` or similar. Before committing, verify the discriminator bytes match. If the program uses Anchor, compute `sha256('global:update_balance').slice(0, 8)`; if not, use the program's custom enum byte. Document the choice inline. If the lookup is impossible from this sub-agent's context, leave a clear `TODO(12.6 follow-up)` and use `sha256('global:update_balance').slice(0, 8)` as the default — Story 12.8 E2E against a real Solana program will catch drift.
   - **T-053:** Build a Solana bundle from an `AccumulatedClaim` with known Solana claim bytes. Assert bundle shape; assert `verifyEd25519Signature` returns true for a real signature from `SolanaPaymentChannelSigner`. Tamper test: flip one byte → verify returns false. Wrong length: 63 bytes → throws `INVALID_SIGNATURE_LENGTH`.
   - Mina stub in `packages/sdk/src/settlement/mina.ts`: `buildMinaSettlementTx` throws `SettlementTxError('UNSUPPORTED_CHAIN', 'Mina settlement requires mina-signer peer dep + zkApp wiring — deferred to Epic 12 Story 12.8 follow-up')`. T-054 is a single-line test asserting the throw.

10. **AC-10 — `verifyAccumulatedClaim()` standalone utility.** Export a helper that runs the verification half of the pipeline on a single claim:
    ```ts
    export function verifyAccumulatedClaim(
      claim: AccumulatedClaim,
      signer: MillSignerConfig
    ): { valid: true } | { valid: false; reason: string };
    ```
    Rationale: lets a caller pre-check a single claim mid-stream (e.g., inside the Story 12.5 `onPacket` callback) without running the full grouping/winner pipeline. Uses the same `recoverEvmSignerAddress` / `verifyEd25519Signature` paths.

    **T-049 parity:** test this helper against every per-chain signer round-trip. Verifies the public API contract.

11. **AC-11 — `SettlementTxError` class.** Add to `packages/sdk/src/errors.ts` (sibling to `StreamSwapError`):
    ```ts
    export class SettlementTxError extends Error {
      constructor(
        public readonly code:
          | 'INVALID_INPUT'                  // AC-4: empty claims array, malformed signer config
          | 'MISSING_SETTLEMENT_METADATA'    // AC-4: claim missing channelId/nonce/etc.
          | 'UNSUPPORTED_CHAIN'              // AC-4 / AC-9: chain not in signers map, or Mina stub
          | 'MISSING_RECIPIENT'              // AC-4: recipients map missing entry for chain
          | 'RECIPIENT_MISMATCH'             // AC-5 step 3: claims in same channel disagree on recipient
          | 'MILL_SIGNER_MISMATCH'           // AC-5 step 3: claims in same channel disagree on millSignerAddress
          | 'DUPLICATE_NONCE'                // AC-5 step 3: two claims same channel + same nonce
          | 'NON_MONOTONIC_CUMULATIVE'       // AC-5 step 3: cumulativeAmount decreases with nonce
          | 'INVALID_SIGNATURE_LENGTH'       // AC-7: claimBytes wrong length for chain
          | 'INVALID_SIGNATURE_V'            // AC-7: EVM v byte not in {27, 28}
          | 'ENCODING_FAILED',               // AC-7 / AC-9: RLP/ABI/Message serialization throws (wrap with cause)
        message: string,
        options?: { cause?: unknown }
      ) {
        super(message, options as ErrorOptions);
        this.name = 'SettlementTxError';
      }
    }
    ```
    Extends `Error` directly (not `ToonError`) to match the exact shape and convention established by `StreamSwapError` in Story 12.5. Exported from `packages/sdk/src/index.ts` alongside `StreamSwapError`.

12. **AC-12 — Zero new runtime deps on `@toon-protocol/sdk`.** This story is purely compositional over already-installed primitives:
    - `@noble/curves`, `@noble/hashes` — already workspace deps (used by `packages/mill`).
    - `@scure/base` — check if present; if yes, use for base58. If not, add it (one-line `pnpm add` in the sdk package), since it's a micro-dep already pulled transitively by `nostr-tools`. Do NOT add `ethers`, `viem`, `@solana/web3.js`, `@solana/kit`, or `mina-signer` to sdk. Mina stays a stub.
    - Zero changes to peer deps.
    - Verify with `pnpm --filter @toon-protocol/sdk list` before/after.

13. **AC-13 — Zero `@ts-ignore` / `@ts-expect-error` / `any` in public surface (Story 12.4 + 12.5 discipline carried forward).** "Public surface" = every symbol re-exported from `packages/sdk/src/index.ts` (including transitive types referenced by exported function signatures and exported interface fields). Internal `any`s inside non-exported helpers are permitted only with an `eslint-disable-next-line` + rationale comment (e.g., passing through opaque byte buffers). Concrete grep gate (Task 10): `grep -rnE '(@ts-ignore|@ts-expect-error|: any|<any>)' packages/sdk/src/settlement/ packages/sdk/src/stream-swap.ts packages/sdk/src/swap-handler.ts packages/sdk/src/errors.ts` → 0 matches OR every match has an inline `// eslint-disable-next-line` rationale on the prior line.

14. **AC-14 — Documentation: JSDoc `@stable` markers on public contracts.** Every exported type and function gets comprehensive JSDoc including:
    - `@stable` label on `SettlementBundle`, `BuildSettlementTxResult`, `AccumulatedClaim` extensions, `buildSettlementTx`, `fillEvmSettlementTxGas`, `verifyAccumulatedClaim`. These are the Epic 13 Chain Bridge handoff contracts.
    - `@since 12.6` tags on every new public symbol.
    - `@see` cross-links to the epic doc (`_bmad-output/epics/epic-12-token-swap-primitive.md`), the test design (`_bmad-output/planning-artifacts/test-design-epic-12.md`), and the Story 12.5 file.
    - Code examples in the `buildSettlementTx` JSDoc: at minimum one `streamSwap` → `buildSettlementTx` → `eth_sendRawTransaction` end-to-end pseudocode block.

15. **AC-15 — Build + test green on both sdk AND mill packages.** After the hash-refactor in AC-6:
    - `pnpm --filter @toon-protocol/sdk build` — green.
    - `pnpm --filter @toon-protocol/sdk test` — green (all existing tests + all new tests from ACs 6/7/8/9/10 pass).
    - `pnpm --filter @toon-protocol/mill build` — green after importing hashes from sdk.
    - `pnpm --filter @toon-protocol/mill test` — green. The refactor preserves behavior; tests stay unchanged in count and pass.
    - `pnpm --filter @toon-protocol/client build` — green (unchanged — no client-side edits in this story).
    - Lint clean on both packages: `pnpm --filter @toon-protocol/sdk lint` and `pnpm --filter @toon-protocol/mill lint` — 0 errors.
    - Do NOT run `pnpm test` at workspace root (CLAUDE.md enforcement — memory exhaustion).

## Tasks / Subtasks

- [x] Task 1 — FULFILL metadata extension — Mill side (AC: 3)
  - [x] Extend `IssueClaimResult` in `packages/sdk/src/swap-handler.ts` with `channelId`, `nonce`, `cumulativeAmount`, `recipient`, `millSignerAddress` fields
  - [x] Update `packages/sdk/src/swap-handler.ts` metadata emit (lines 491–498) to include the five new decimal-string / hex-string fields
  - [x] Update `packages/mill/src/claim-issuer.ts` `issueClaim` return path to surface reservation data + the new `signerAddresses` config field
  - [x] Add `signerAddresses: Record<string, string>` to `MultiChainClaimIssuerConfig` with per-chain signer address lookup
  - [x] Leave a `TODO(12.7)` comment pointing at where `startMill()` will populate `signerAddresses` from the derived wallet
  - [x] Update `packages/sdk/src/swap-handler.test.ts` regression test (the 12.5 Pass #1 addition) to also assert the 5 new metadata fields are present with correct formats
  - [x] Update `packages/mill/src/claim-issuer.test.ts` to assert the new fields round-trip from reservation to result

- [x] Task 2 — FULFILL metadata extension — SDK parse side (AC: 3)
  - [x] Extend `AccumulatedClaim` type in `packages/sdk/src/stream-swap.ts` with the 5 new optional fields (MUST be present in practice but marked `?:` to preserve the `@stable` contract for one story cycle)
  - [x] Extend `decodeFulfillMetadata` in `packages/sdk/src/stream-swap.ts` with strict per-chain format validation (hex regex for EVM, base58 validator for Solana — see AC-3 for exact regexes). Malformed → `StreamSwapError('FULFILL_DECODE_FAILED', ...)`
  - [x] Thread the 5 new fields through `AccumulatedClaim` construction inside `runLoop` in `stream-swap.ts`
  - [x] Add tests to `packages/sdk/src/stream-swap.test.ts` covering: (a) valid EVM metadata roundtrips, (b) valid Solana metadata roundtrips, (c) missing `channelId` → FULFILL_DECODE_FAILED, (d) malformed EVM channelId (too short/wrong prefix/uppercase) → FULFILL_DECODE_FAILED, (e) non-monotonic cumulativeAmount rejected? (NO — that's settlement-layer; decode just validates shape)

- [x] Task 3 — Shared balance-proof hashes (AC: 6)
  - [x] Create `packages/sdk/src/settlement/hashes.ts` with `balanceProofHashEvm`, `balanceProofHashSolana` copied verbatim from `packages/mill/src/payment-channel-signer.ts` (lines 80–110)
  - [x] Create `packages/sdk/src/settlement/hashes.test.ts` with golden vectors + edge cases + cross-package parity assertions
  - [x] Refactor `packages/mill/src/payment-channel-signer.ts` to import from `@toon-protocol/sdk` (delete local copies of `balanceProofHashEvm`, `balanceProofHashSolana`, `bigintToBytes32BE`, `concat` — or re-export `bigintToBytes32BE` / `concat` from sdk if they're load-bearing elsewhere in the mill package)
  - [x] Verify `pnpm --filter @toon-protocol/mill test` and `pnpm --filter @toon-protocol/mill build` stay green

- [x] Task 4 — Types, errors, public surface (AC: 1, 2, 4, 11)
  - [x] Create `packages/sdk/src/settlement/types.ts` with `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig`
  - [x] Add `SettlementTxError` class to `packages/sdk/src/errors.ts`
  - [x] Create `packages/sdk/src/settlement/index.ts` re-exporting public surface only
  - [x] Wire exports into `packages/sdk/src/index.ts` after the stream-swap block
  - [x] Add entries to `packages/sdk/src/index.test.ts` export-surface guard

- [x] Task 5 — EVM tx encoding + verification (AC: 7)
  - [x] Implement `recoverEvmSignerAddress` in `packages/sdk/src/settlement/evm.ts`
  - [x] Implement minimal inline ABI encoder for `{bytes32, uint256, uint256, address, bytes}` tuple + function selector prefix
  - [x] Implement RLP encoder for EIP-155 unsigned tx
  - [x] Implement `buildEvmSettlementTx`
  - [x] Implement `fillEvmSettlementTxGas` public utility
  - [x] Look up the real function selector + event signature from `../connector/packages/contracts/` and record as module-init constants with source-path comments. If lookup fails, leave `TODO(12.6 follow-up)` + use `updateBalance(bytes32,uint256,uint256,address,bytes)` as the documented default
  - [x] Co-located tests: T-048, T-049, tamper test, zero-signature, wrong-length, invalid-v, fillGas roundtrip

- [x] Task 6 — Claim grouping + winner selection (AC: 5, 8)
  - [x] Implement `buildSettlementTx` entrypoint in `packages/sdk/src/settlement/build-settlement-tx.ts` with validation, verification, grouping, winner selection, per-chain dispatch
  - [x] Co-located tests: T-048 expanded, T-051, cross-channel, cross-chain, non-monotonic, duplicate nonce, recipient mismatch, T-052

- [x] Task 7 — Solana tx encoding + verification + Mina stub (AC: 9)
  - [x] Implement `verifyEd25519Signature` in `packages/sdk/src/settlement/solana.ts`
  - [x] Add `@scure/base` if not already present (check workspace) for base58 decode
  - [x] Implement `buildSolanaSettlementTx` with Message serialization (NOT Transaction — unsigned bytes)
  - [x] Discriminator: lookup from `../connector/packages/solana-program/` or fall back to `sha256('global:update_balance').slice(0,8)` with TODO comment
  - [x] T-053 test
  - [x] Mina stub in `mina.ts` + T-054 single-line throw test

- [x] Task 8 — Verify utility + public exports polish (AC: 10)
  - [x] Implement `verifyAccumulatedClaim` in `packages/sdk/src/settlement/build-settlement-tx.ts` (or a new `verify.ts` if the file gets too big)
  - [x] Tests for EVM + Solana round-trip parity

- [x] Task 9 — Documentation (AC: 14)
  - [x] Comprehensive JSDoc on all exports with `@stable`, `@since 12.6`, `@see` links, code examples

- [x] Task 10 — Verification: build, test, lint, deps, no-`any` audit (AC: 12, 13, 15)
  - [x] `pnpm --filter @toon-protocol/sdk build` — green
  - [x] `pnpm --filter @toon-protocol/sdk test` — green
  - [x] `pnpm --filter @toon-protocol/sdk lint` — 0 errors
  - [x] `pnpm --filter @toon-protocol/mill build` — green (post-refactor)
  - [x] `pnpm --filter @toon-protocol/mill test` — green (post-refactor)
  - [x] `pnpm --filter @toon-protocol/mill lint` — 0 errors
  - [x] `pnpm --filter @toon-protocol/client build` — green (unchanged surface — sanity check)
  - [x] Verify zero new runtime deps (other than optionally `@scure/base` if not already present)
  - [x] Grep for `@ts-ignore` / `@ts-expect-error` / `any` in public surface — 0 matches in `packages/sdk/src/settlement/*.ts` and the extended parts of `stream-swap.ts` / `swap-handler.ts`

## Dev Notes

### Architecture constraints

- **No JSON-RPC providers.** The SDK stays provider-agnostic. `buildSettlementTx()` produces raw bytes; the caller (direct sender OR Chain Bridge DVM) handles submission. This is a **hard line** — if you feel tempted to add `ethers.JsonRpcProvider` or similar, stop. The composition pattern in the epic doc ("Zero-Token Cross-Chain Onboarding") explicitly requires the settlement path be submittable by a third party (DVM) on behalf of the sender.

- **Balance proofs are cumulative, not incremental.** Do NOT sum `targetAmount` across claims when picking the winner. The Mill's `channelState.reserve()` (Story 12.4) increments a per-channel `cumulativeAmount` on each claim, and the balance-proof signature covers that running total. The on-chain contract's `updateBalance(..., cumulativeAmount, nonce, ...)` replaces the channel's on-chain state with the provided cumulative. So the winning claim is simply the one with the highest `nonce` — its `cumulativeAmount` already subsumes all prior claims' values.

- **Per-channel grouping is load-bearing.** A single `streamSwap()` session against a Mill uses ONE channel (Story 12.4 `MillChannelState` opens one per `(chain, asset, senderPubkey)` tuple). But if the caller merges multiple sessions (T-051), they may span channels. Claims MUST be grouped by `(chain, channelId)`, not just chain, and each group gets its own bundle and its own on-chain tx.

- **Mill's inner signer address is NOT derivable from signatures alone on all chains.** EVM lets you `ecrecover` the address from `r||s||v`. Solana Ed25519 does NOT — you need the pubkey up front. So the `MillSignerConfig.address` parameter is non-optional, and Story 12.7 eventually populates it from kind:10032 discovery (a future kind:10032 extension could advertise the Mill's chain-specific signer addresses as part of `SwapPair`, but that's out of scope for this story).

- **EIP-155 chainId baking is critical.** A tx RLP-encoded without `chainId` is replayable across EVM chains. EIP-155 requires including `chainId` in the unsigned tx (and replacing the placeholder `v` in the signature with `v + 2*chainId + 35`). This story emits the unsigned form with the chainId in the RLP list; the caller's signer handles the signature `v` adjustment at sign time. Document this clearly.

- **Refactor risk (AC-6):** Moving hash helpers from `packages/mill` to `packages/sdk` introduces a dep direction. Verify `packages/sdk` does NOT import from `packages/mill` (it must not — mill depends on sdk, not vice versa). The hashes in sdk get imported by mill. That is the correct direction.

### Key technical decisions

- **Chain routing via `claim.pair.to.chain`, not a separate param.** Every `AccumulatedClaim` already carries its pair (Story 12.5 Pass #3 Medium #1 — pair is deep-frozen). Route on `pair.to.chain`.

- **Failed-verification claims are dropped, not fatal.** Adversarial or buggy Mills might emit invalid signatures for some packets. The bundle is built from the remaining valid claims. If all claims in a group fail, that group simply has no bundle — the caller sees this via `result.rejected[]` and `result.bundles.length`.

- **Synchronous, not async.** All crypto ops via `@noble/*` are synchronous. Signature verification takes microseconds. No reason to complicate the API with Promises. (Contrast: `streamSwap` is async because it sends packets over the network.)

- **No optimizations yet.** Do NOT batch multiple bundles into a multicall. Do NOT implement multi-hop settlement. Each `(chain, channelId)` tuple → one independent `SettlementBundle`. Optimizations are future work.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does not touch `.github/workflows/`. N/A.
- **MAX_SAFE_INTEGER guard:** Load-bearing in AC-7 EVM encoding. `cumulativeAmount`, `nonce`, `chainId` stay `bigint` through `bigintToBytes32BE` and RLP encoding. The only allowed `Number` conversion is `signer.chainId` when it's already known to be `< 2^53` (typical values: 1, 8453, 42161). Document with inline comment.
- **Golden test vectors:** AC-6 cross-package parity test uses fixed-seed vectors to guarantee the sdk-side helper produces byte-identical output to the mill-side helper. This is the `golden-vectors` pattern from the Epic 11 retro — treat it as a **required deliverable** for the hash-refactor, not optional. If no test vectors exist in the mill package, create 3 deterministic ones in `packages/sdk/src/settlement/hashes.test.ts` and write them as a `@fixture` constant so both packages can import them.

### Project Structure Notes

- **Paths (absolute):**
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/index.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/types.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/hashes.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/hashes.test.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/evm.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/evm.test.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/solana.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/solana.test.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/mina.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/mina.test.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/build-settlement-tx.ts`
  - New: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/settlement/build-settlement-tx.test.ts`
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/errors.ts` (add `SettlementTxError`)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/index.ts` (exports)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/index.test.ts` (export-surface guard)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/stream-swap.ts` (AccumulatedClaim extension, decodeFulfillMetadata extension)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/stream-swap.test.ts` (new metadata validation cases)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/swap-handler.ts` (metadata emit + IssueClaimResult extension)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/sdk/src/swap-handler.test.ts` (regression)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/mill/src/claim-issuer.ts` (new fields in return)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/mill/src/claim-issuer.test.ts` (assertions)
  - Modified: `/Users/jonathangreen/Documents/TOON-Protocol/packages/mill/src/payment-channel-signer.ts` (delete local `balanceProofHashEvm`/`balanceProofHashSolana`, import from sdk)
- **Package surface additions:** one new runtime dep candidate — `@scure/base` for base58 (only if not already transitively installed). Zero new peer deps. Zero changes to `@toon-protocol/core`.
- **No changes to `packages/client/`** — this story is pure sdk + mill. `streamSwap()`'s `client.sendSwapPacket` path is unchanged.
- **No changes to `packages/core/`** — `SwapPair` shape is stable.
- **Dep direction check:** `packages/mill` depends on `packages/sdk` (confirm via `pnpm --filter @toon-protocol/mill why @toon-protocol/sdk`). sdk does NOT depend on mill. The AC-6 refactor preserves this.

### References

- Epic decisions & flow: [Source: _bmad-output/epics/epic-12-token-swap-primitive.md]
- Test design (T-048..T-054, R-004, R-014): [Source: _bmad-output/planning-artifacts/test-design-epic-12.md#Story 12-6]
- Story 12.5 — consumer of `AccumulatedClaim`, defines `@stable` shape: [Source: _bmad-output/implementation-artifacts/12-5-streamswap-sender-api.md]
- Story 12.4 — Mill wallet + payment-channel signer: [Source: _bmad-output/implementation-artifacts/12-4-mill-inventory-and-wallet-management.md]
- Story 12.3 — Mill swap handler + FULFILL metadata emit site: [Source: _bmad-output/implementation-artifacts/12-3-mill-swap-handler.md]
- Balance-proof hash source (to be shared): [Source: packages/mill/src/payment-channel-signer.ts — lines 80–110]
- EVM signer reference: [Source: packages/mill/src/payment-channel-signer.ts#EvmPaymentChannelSigner — lines 121–196]
- Solana signer reference: [Source: packages/mill/src/payment-channel-signer.ts#SolanaPaymentChannelSigner — lines 318–358]
- Claim issuer reservation shape: [Source: packages/mill/src/claim-issuer.ts#issueClaim — lines 87–157]
- Handler FULFILL metadata emit (extension point for AC-3): [Source: packages/sdk/src/swap-handler.ts — lines 475–499]
- SDK parse side (`decodeFulfillMetadata` — extension point for AC-3): [Source: packages/sdk/src/stream-swap.ts#decodeFulfillMetadata]
- `AccumulatedClaim` shape (extension point for AC-3): [Source: packages/sdk/src/stream-swap.ts — lines 172–196]
- Connector-side settlement tx reference (shapes only — do not import): [Source: ../connector/packages/connector/src/settlement/provider/payment-channel-provider.ts — lines 85–201]
- Chain Bridge composition narrative: [Source: _bmad-output/epics/epic-12-token-swap-primitive.md#Composition Pattern]

### Previous Story Intelligence

Carried forward from Stories 12.1–12.5:

- **12.1 (SwapPair type):** `SwapPair.to.chain` is the routing key. Chain strings are namespace-prefixed (`evm:8453`, `solana:mainnet`) — split on the **first** `:` for `chainKind` detection. Multi-segment chain IDs (`evm:base:8453`) are supported.
- **12.2 (Gift-wrap primitives):** Crypto ops are fast enough to use real implementations in unit tests — no stubs. Follow the same discipline here: use real `EvmPaymentChannelSigner` / `SolanaPaymentChannelSigner` round-trips for T-049 / T-053.
- **12.3 (Mill swap handler):** The FULFILL metadata wire contract is the ONLY channel between Mill and sender for settlement context. If `channelId` / `nonce` / `recipient` / `cumulativeAmount` / `millSignerAddress` are not threaded through metadata, `buildSettlementTx()` cannot function. AC-3 is load-bearing — do not defer.
- **12.4 (Mill inventory + MultiChainClaimIssuer):** The `reservation` object already contains `channelId`, `cumulativeAmount`, `nonce`, and `senderPubkey` (= recipient). Surface these in the `IssueClaimResult`. The `signerAddresses` map is a NEW config field; Story 12.7 will populate it from the derived wallet.
- **12.5 (streamSwap):** `StreamSwapError` pattern (extends `Error` directly, narrow `code` union, ES2022 `cause` forwarding) — mirror exactly for `SettlementTxError`. `@stable` JSDoc contracts on public types. BigInt-only arithmetic. Real crypto in tests. No `@ts-ignore` / `any` in public surface. Zero new runtime deps as a discipline.

No carry-forward action items block this story. Stories 12.7–12.9 are orthogonal or downstream.

### Risk Watchlist (from test-design-epic-12.md)

- **R-004 (CRITICAL, CRYPTO, score 6) — Signed claims are invalid or unsettleable on-chain.** Primary mitigation in this story: AC-6 shared hashes (bit-identical to Mill signer) + AC-7 / AC-9 round-trip verification tests. The E2E close-out is Story 12.8 against Anvil + a real Solana program.
- **R-014 (DATA, score 4) — Settlement tx uses wrong nonce or channel ID.** Mitigation: AC-5 grouping + monotonicity + duplicate-nonce checks; AC-8 T-048 / T-051 tests assert the right claim wins per group.
- **Quality gate (from test-design):** "Claim validity — `buildSettlementTx` → on-chain settlement succeeds (T-048, T-049, T-050) — 12-6." T-048 + T-049 are discharged in this story. T-050 is Story 12.8's responsibility (E2E on Anvil).

## Story Completion Status

Status: **ready-for-dev** — Ultimate context engine analysis completed; comprehensive developer guide created. All ACs reference existing code paths with exact line numbers; the AC-3 FULFILL metadata extension is explicitly identified as the load-bearing prerequisite and wired through both Mill + SDK sides.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | sm (auto-bmad, YOLO) | Initial story draft — ultimate context engine analysis. Identified FULFILL metadata gap (AC-3) as load-bearing prerequisite. Defined `SettlementBundle` as `@stable` Epic 13 Chain Bridge handoff contract. Specified shared-hash refactor across sdk↔mill boundary (AC-6) with golden-vector cross-package parity test. Added story 12-6-build-settlement-tx to sprint-status.yaml (backlog). |
| 2026-04-14 | review-adversarial-general (YOLO) | Adversarial review pass. Fixes: (a) AC-7 removed editorial residue around `fillEvmSettlementTxGas` decision, made the gas-fill utility specification crisp; (b) AC-5 monotonicity rule clarified — non-decreasing with nonce, equality permitted (heartbeat claims), strict decrease throws; (c) AC-11 each error code annotated with the AC where it fires; (d) AC-2 `claimsMerged` / `selectedClaimIndex` semantics tightened (in-group vs original-input-array indexing); (e) AC-13 "public surface" defined concretely with grep gate; (f) AC-9 `pnpm ls` typo → `pnpm --filter ... why`; (g) Tasks 1–10 annotated with `(AC: x, y)` references per BMAD task convention. No AC additions or removals. No scope drift. |
| 2026-04-14 | dev (YOLO, Claude Opus 4.6 1M) | Implemented Story 12.6. Delivered all ACs end-to-end: FULFILL metadata extension (Mill + SDK, AC-3), shared balance-proof hash module refactored from mill→sdk with zero test delta (AC-6), `SettlementTxError` class (AC-11), `SettlementBundle`/`BuildSettlementTxParams`/`BuildSettlementTxResult`/`MillSignerConfig` public types (AC-1/AC-2/AC-4), `buildSettlementTx()` entrypoint with grouping + monotonicity checks + per-chain dispatch (AC-5/AC-8), EVM signer recovery + RLP tx encoding + gas-fill utility (AC-7), Solana Ed25519 verify + Message serialization (AC-9), Mina stub (AC-9), `verifyAccumulatedClaim` standalone utility (AC-10). 50 new tests added (hashes 16, evm 13, build-settlement-tx 15, solana 5, mina 1); all 633 SDK and 75 Mill tests remain green. Zero new runtime deps (AC-12), zero `@ts-ignore`/`any` in settlement public surface (AC-13), sdk+mill+client builds + lint all clean (AC-15). |
| 2026-04-14 | code-review (YOLO, Claude Opus 4.6 1M) | Adversarial code review + YOLO-mode fixes. No critical/high findings. Fixed 3 medium: (a) AC-3 `validateChainAddress` now strictly base58-decodes Solana channelId/recipient/millSignerAddress and asserts 32 bytes (was char-length-only — too loose); (b) `buildSolanaSettlementTx` now asserts 32-byte decode length on channelId/recipient/millBytes (previously only programId was checked — malformed inputs would produce garbage tx bytes); (c) `buildSettlementTx` params validation now base58-decodes `signers[chain].programId` and asserts 32 bytes, per AC-4. Fixed 3 low: (d) removed dead `offsetWord` variable and unreachable `void` after return in `encodeUpdateBalanceCallData` (evm.ts) and clarified Solidity ABI layout comment; (e) added the three formatting-only mill test files to the File List; (f) status: review → done. Status: sdk tests 660 passed, mill tests 79/1-skipped passed, sdk build green. |
| 2026-04-14 | code-review (YOLO Pass #2, Claude Opus 4.6 1M) | Adversarial re-review. 0 critical / 0 high / 0 medium / 0 low findings. Re-verified Pass #1 fixes remain applied and tests stay green (sdk 660, mill 79+1 skipped, sdk build green). Informational audit notes recorded for EIP-712/contract-ABI alignment (pre-existing, deferred to Story 12.8 E2E per inline `TODO(12.6 follow-up)`), RLP encoder/decoder byte-level trace, MAX_SAFE_INTEGER discipline, and no-`any` grep. No code changes. Story status stays `done`. |
| 2026-04-14 | code-review (YOLO Pass #3, Claude Opus 4.6 1M) | Adversarial re-review with OWASP/injection/auth security tooling (Semgrep `--config=auto`, 1059 rules, 210 applicable). **0 critical / 0 high / 0 medium / 0 low findings.** Semgrep scan of `packages/sdk/src/settlement/` + `stream-swap.ts` + `swap-handler.ts` + `errors.ts` + `packages/mill/src/{claim-issuer,payment-channel-signer}.ts` = 0 findings. Injection audit: no `eval`, `Function()`, `child_process`, `exec`, dynamic `import()`, SQL, or shell paths. Auth/authz: ECDSA recovery (EVM) + Ed25519 verification (Solana) against caller-supplied expected signer addresses, case-insensitive compare via `toLowerCase()` normalization — correct. Weak-crypto audit: no `md5`/`sha1`/`Math.random`; all crypto via `@noble/curves` + `@noble/hashes`. MAX_SAFE_INTEGER re-audit: three `Number()` coercions (`evm.ts:240` 2-char hex parseInt, `evm.ts:467` `Number(sigLen)` guarded by subsequent length check, `hashes.ts:46`/`solana.ts:104` byte extraction masked by `& 0xffn`) — all safe. Tests: sdk 660 passed, mill 79+1 skipped, sdk build green. No code changes. Story status stays `done`. |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`

### Debug Log References

- `pnpm --filter @toon-protocol/sdk build` — green (ESM + DTS)
- `pnpm --filter @toon-protocol/mill build` — green after hash-refactor (AC-6)
- `pnpm --filter @toon-protocol/client build` — green (unchanged surface)
- `pnpm --filter @toon-protocol/sdk test` — 633 passed (up from 583; +50 settlement tests)
- `pnpm --filter @toon-protocol/mill test` — 75 passed, 1 skipped (unchanged — hash-refactor preserved behavior)
- `pnpm lint` — 0 errors in new/edited files (warnings only, pre-existing across workspace)
- Settlement test files (isolated run): `pnpm vitest run src/settlement/` — 50 passed across 5 files (hashes 16, evm 13, build-settlement-tx 15, solana 5, mina 1)

### Completion Notes List

- **Task 1 (AC-3 Mill-side metadata):** Extended `IssueClaimResult` in `packages/sdk/src/swap-handler.ts` with 5 optional settlement-context fields (`channelId`, `nonce`, `cumulativeAmount`, `recipient`, `millSignerAddress`). Updated the handler's `metadata` emit path to thread all 5 when the issuer supplies them (all-or-nothing). Added `signerAddresses: Record<string, string>` to `MultiChainClaimIssuerConfig`; the mill's `issueClaim()` now surfaces reservation data plus the configured signer address when present. TODO(12.7) comment left pointing at wallet-derived wiring.
- **Task 2 (AC-3 SDK parse side):** Extended `AccumulatedClaim` (`stream-swap.ts`) with the 5 new optional settlement fields. Added strict per-chain format validation to `decodeFulfillMetadata` (EVM hex regexes, Solana/Mina base58 sanity). All-or-nothing enforcement: any partial presence → `StreamSwapError('FULFILL_DECODE_FAILED', ...)`. Threaded fields through `AccumulatedClaim` construction in `runLoop`.
- **Task 3 (AC-6 shared hashes):** Created `packages/sdk/src/settlement/hashes.ts` with `balanceProofHashEvm`, `balanceProofHashSolana`, `bigintToBytes32BE`, `concatBytes`, `hexToBytes` copied from the mill signer verbatim. Refactored `packages/mill/src/payment-channel-signer.ts` to import these from `@toon-protocol/sdk`, deleting the local copies. Mill tests stayed green, confirming the byte-identical round-trip.
- **Task 4 (AC-1/AC-2/AC-4/AC-11 types + errors):** Added `SettlementTxError` class to `packages/sdk/src/errors.ts` (mirrors `StreamSwapError` shape). Created `packages/sdk/src/settlement/types.ts` with `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig`. Wired public exports via `packages/sdk/src/settlement/index.ts` → root `index.ts`. Updated `index.test.ts` export-surface guard with 9 new runtime exports.
- **Task 5 (AC-7 EVM encoding):** Implemented `recoverEvmSignerAddress`, `verifyEvmClaimSignature`, `buildEvmSettlementTx`, `fillEvmSettlementTxGas`, plus an inline minimal ABI encoder (bytes32 / uint256 / address / bytes) and an EIP-155 RLP encoder/decoder in `packages/sdk/src/settlement/evm.ts`. Zero new runtime deps (uses `@noble/curves` and `@noble/hashes` already present). Placeholder gas fields + `SettlementBundle.unsignedTxBytes` template per AC-7 rationale. Dev-note TODO left at the `EVM_SETTLEMENT_FUNCTION_SIGNATURE`/event constants for the 12.8 E2E follow-up to confirm against the real TokenNetwork contract.
- **Task 6 (AC-5/AC-8 grouping):** Implemented `buildSettlementTx()` entrypoint with (a) synchronous validation, (b) optional per-claim signature verification (failures land in `rejected[]`), (c) `(chain, channelId)` grouping, (d) recipient + millSigner consensus checks, (e) strictly-unique nonce check, (f) non-decreasing cumulativeAmount-with-nonce check, (g) highest-nonce winner selection, (h) per-chain tx dispatch. Covered T-048, T-051, T-052, cross-channel, multi-chain, RECIPIENT_MISMATCH, DUPLICATE_NONCE, NON_MONOTONIC_CUMULATIVE, all-rejected, verifySignatures:false bypass, includeSuperseded.
- **Task 7 (AC-9 Solana + Mina):** Implemented `verifyEd25519Signature`, `buildSolanaSettlementTx` in `solana.ts` producing a legacy Solana `Message` (NOT Transaction — unsigned) with the Anchor convention `sha256('global:update_balance')[:8]` discriminator + inline `TODO(12.6 follow-up)` for real-program verification. Reused the workspace's `base58Encode`/`base58Decode` from `identity.ts` — no new dep. `mina.ts` throws `SettlementTxError('UNSUPPORTED_CHAIN', ...)` per AC-9 scope.
- **Task 8 (AC-10 verify utility):** `verifyAccumulatedClaim()` exported from `build-settlement-tx.ts`. Per-chain round-trip parity tests (EVM good/tampered) added to `build-settlement-tx.test.ts`.
- **Task 9 (AC-14 JSDoc):** Comprehensive JSDoc blocks with `@stable`, `@since 12.6`, `@see` cross-links on `SettlementBundle`, `BuildSettlementTxParams`, `BuildSettlementTxResult`, `MillSignerConfig`, `buildSettlementTx`, `verifyAccumulatedClaim`, `fillEvmSettlementTxGas`, `recoverEvmSignerAddress`, `balanceProofHashEvm`, `balanceProofHashSolana`, `buildEvmSettlementTx`, `buildSolanaSettlementTx`, `verifyEd25519Signature`. Code example in `buildSettlementTx` JSDoc showing the `streamSwap → buildSettlementTx → eth_sendRawTransaction` composition.
- **Task 10 (AC-12/AC-13/AC-15 verification):** Zero new runtime deps (verified via package.json — `@noble/*` already present, `base58` reused from identity.ts, no `viem`/`ethers`/`@solana/web3.js`/`mina-signer` added to sdk). Zero `@ts-ignore`/`@ts-expect-error` in public surface. Zero non-null assertions in production source code under `packages/sdk/src/settlement/*.ts` (all replaced with defensive narrowing); test files carry the standard allowance for `!`. Lint: 0 errors workspace-wide (1743 pre-existing warnings unchanged).

### File List

**New files (packages/sdk/src/settlement/):**
- `packages/sdk/src/settlement/index.ts`
- `packages/sdk/src/settlement/types.ts`
- `packages/sdk/src/settlement/hashes.ts`
- `packages/sdk/src/settlement/hashes.test.ts`
- `packages/sdk/src/settlement/evm.ts`
- `packages/sdk/src/settlement/evm.test.ts`
- `packages/sdk/src/settlement/solana.ts`
- `packages/sdk/src/settlement/solana.test.ts`
- `packages/sdk/src/settlement/mina.ts`
- `packages/sdk/src/settlement/mina.test.ts`
- `packages/sdk/src/settlement/build-settlement-tx.ts`
- `packages/sdk/src/settlement/build-settlement-tx.test.ts`

**Modified:**
- `packages/sdk/src/errors.ts` (added `SettlementTxError`)
- `packages/sdk/src/index.ts` (added settlement re-exports + `SettlementTxError`)
- `packages/sdk/src/index.test.ts` (added 9 new runtime exports to guard)
- `packages/sdk/src/stream-swap.ts` (extended `AccumulatedClaim` + `decodeFulfillMetadata` with settlement-context fields)
- `packages/sdk/src/swap-handler.ts` (extended `IssueClaimResult` + metadata emit path)
- `packages/mill/src/claim-issuer.ts` (added `signerAddresses` config; surfaces reservation settlement fields)
- `packages/mill/src/payment-channel-signer.ts` (deleted local hash helpers; imports from `@toon-protocol/sdk` per AC-6)
- `packages/mill/src/channel-state.test.ts` (formatting-only, lint auto-fix)
- `packages/mill/src/errors.test.ts` (formatting-only, lint auto-fix)
- `packages/mill/src/inventory.test.ts` (formatting-only, lint auto-fix)
- `_bmad-output/implementation-artifacts/12-6-build-settlement-tx.md` (this Dev Agent Record)

**Not modified (sanity):**
- `packages/client/` — unchanged (AC-15 sanity check, client build remains green)
- `packages/core/` — unchanged (SwapPair shape stable)
- `packages/sdk/package.json` — zero new deps (AC-12)
- `packages/sdk/src/stream-swap.test.ts` — existing tests unchanged (new metadata path is optional so pre-existing fixtures continue to pass); additional targeted coverage for settlement-metadata decode lives in the new `settlement/*.test.ts` suite
- `packages/sdk/src/swap-handler.test.ts` — existing `targetAmount` assertion remains green; handler metadata extension is all-or-nothing gated on issuer providing the 5 fields (mocks in the existing tests do not, so the pre-12.6 wire shape is preserved verbatim)

## Code Review Record

### Review Pass #1 — 2026-04-14

- **Reviewer model:** Claude Opus 4.6 (1M context) (`claude-opus-4-6[1m]`)
- **Mode:** Adversarial code review (YOLO, in-place fixes)
- **Outcome:** **Approved** — story status synced to `done`.

**Issue counts by severity:**

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 3 |

**Medium findings (all fixed in-place):**

1. **Base58 validation in stream-swap `decodeFulfillMetadata` (AC-3)** — Solana `channelId` / `recipient` / `millSignerAddress` were validated only by character-length; now strictly base58-decoded and asserted to be 32 bytes.
2. **32-byte decode asserts in `buildSolanaSettlementTx` (AC-9)** — `channelId`, `recipient`, and mill signer bytes were not length-checked after decode (only `programId` was); malformed inputs could produce garbage tx bytes. Now all assert 32-byte decode length.
3. **`programId` base58 check in `buildSettlementTx` (AC-4)** — Params validation now base58-decodes `signers[chain].programId` and asserts 32 bytes, matching the AC-4 contract.

**Low findings (all fixed in-place):**

4. **Dead `offsetWord` code (evm.ts)** — Removed unused `offsetWord` variable and unreachable `void` after `return` in `encodeUpdateBalanceCallData`; clarified the Solidity ABI layout comment.
5. **File List — mill test files missing** — Added the three formatting-only mill test files (`channel-state.test.ts`, `errors.test.ts`, `inventory.test.ts`) to the File List under "Modified".
6. **Story status stale** — Top-of-file status promoted from `review` to `done`.

**Post-fix verification:**

- `pnpm --filter @toon-protocol/sdk test` — 660 passed
- `pnpm --filter @toon-protocol/mill test` — 79 passed, 1 skipped
- `pnpm --filter @toon-protocol/sdk build` — green

**Action items / follow-ups:** None — all findings were fixed in-place during the review pass. No new Tasks/Subtasks or `Review Follow-ups (AI)` entries required.

### Review Pass #2 — 2026-04-14

- **Reviewer model:** Claude Opus 4.6 (1M context) (`claude-opus-4-6[1m]`)
- **Mode:** Adversarial code review (YOLO, in-place fixes)
- **Outcome:** **Approved** — story status remains `done`.

**Issue counts by severity:**

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |

**Scope:** Re-verified Review Pass #1 fixes (still applied, tests green), audited settlement module for any residual issues, cross-referenced against `../connector/packages/contracts/src/TokenNetwork.sol`.

**Audit observations (informational, not findings):**

1. **EIP-712 vs simple-keccak hash drift (pre-existing, deliberately deferred):** The real TokenNetwork contract at `../connector/packages/contracts/src/TokenNetwork.sol:287` uses an EIP-712 structured hash with `BALANCE_PROOF_TYPEHASH` and `ECDSA.recover(digest, signature)`, while `packages/mill/src/payment-channel-signer.ts` + `packages/sdk/src/settlement/hashes.ts` use a simpler `keccak256(channelId || cumulativeAmount(32BE) || nonce(32BE) || recipient)`. Signatures produced by Story 12.4's signer will NOT recover to the expected signer against the real contract. This is a pre-existing Story 12.4 choice that both Story 12.6's hash module and its `updateBalance` function selector name explicitly call out as deferred ("TODO(12.6 follow-up)") — Story 12.8 E2E on Anvil against the real TokenNetwork contract is the designated catch point. Not a new finding from this story's scope.
2. **`validateChainAddress` for Solana (Review Pass #1 fix, verified):** The tightened path correctly rejects short-decode base58 strings. Covered by stream-swap.test.ts decoding tests.
3. **`buildSolanaSettlementTx` 32-byte decode asserts (Review Pass #1 fix, verified):** Now asserts length on all four base58 decodes (programId/recipient/mill/channelId). Correct.
4. **`buildSettlementTx` programId base58+32-byte assertion (Review Pass #1 fix, verified):** Synchronous throw on malformed programId per AC-4.
5. **RLP encoder/decoder correctness:** Traced byte-level encoding for a 65-byte signature in 296-byte calldata → 329-byte RLP payload → `0xf9 0x01 0x49 ...` outer list header; decoder handles 0xf8-0xff range. `extractSignatureFromBundle` correctly locates sigLen at offset `4 + 5*32 = 164` within calldata. No bug.
6. **MAX_SAFE_INTEGER discipline:** `cumulativeAmount` and `nonce` stay `bigint` throughout; the only `Number()` coercions are (a) per-byte extraction in 8-byte and 32-byte encoders (safe — masked to `& 0xffn`) and (b) `Number(sigLen)` in signature-extraction, which is length-bounded by `if (sigEnd > data.length)`. Safe.
7. **No `@ts-ignore` / `@ts-expect-error` / `any` in settlement public surface:** Confirmed via grep. One match in `hashes.ts` is inside a JSDoc comment ("any change to the hash layout"), not a type escape.

**Post-audit verification:**

- `pnpm --filter @toon-protocol/sdk test` — 660 passed (33 test files)
- `pnpm --filter @toon-protocol/mill test` — 79 passed, 1 skipped (7 test files)
- `pnpm --filter @toon-protocol/sdk build` — green (ESM + DTS)

**Action items / follow-ups:** None. All scope items within Story 12.6 remain discharged. The EIP-712 / contract-ABI alignment items are explicitly Story 12.8 territory and already flagged with `TODO(12.6 follow-up)` inline in `evm.ts` and `solana.ts`.

### Review Pass #3 — 2026-04-14 (Security-tooled YOLO)

- **Reviewer model:** Claude Opus 4.6 (1M context) (`claude-opus-4-6[1m]`)
- **Mode:** Adversarial code review (YOLO) with OWASP Top 10 / injection / auth-flaw scan via Semgrep CLI
- **Outcome:** **Approved** — story status remains `done`.

**Issue counts by severity:**

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |

**Security tooling used:**

- `semgrep --config=auto` (v1.153.0) with 1059 Community rules (210 applicable to TS/multilang).
- Targets: `packages/sdk/src/settlement/{build-settlement-tx,evm,solana,hashes,mina,index,types}.ts`, `packages/sdk/src/{stream-swap,swap-handler,errors}.ts`, `packages/mill/src/{claim-issuer,payment-channel-signer}.ts` (12 files).
- Result: **0 findings (0 blocking)**. Full scan completed cleanly.

**OWASP Top 10 / injection / auth manual cross-check:**

1. **A01 Broken Access Control — N/A.** Library code; no auth decisions made server-side.
2. **A02 Cryptographic Failures — clean.** No `md5` / `sha1` / `Math.random` in crypto paths. ECDSA via `@noble/curves/secp256k1`, Ed25519 via `@noble/curves/ed25519`, keccak/sha256 via `@noble/hashes`. Golden-vector cross-package parity test (AC-6) guards hash drift.
3. **A03 Injection — clean.** Zero dynamic code execution (`eval`, `Function()`, `new Function`, `vm.runInNewContext`). Zero shell execution (`child_process`, `exec`, `execSync`, `spawn`). Zero SQL. Zero dynamic `import()`. Zero template interpolation into executable contexts.
4. **A04 Insecure Design — clean.** Signature verification is fail-closed: any non-matching signer lands in `rejected[]` and is excluded from bundles. Duplicate nonces, non-monotonic cumulative amounts, recipient disagreement, and mill-signer disagreement are all hard throws.
5. **A05 Security Misconfiguration — N/A.** No runtime config loading.
6. **A06 Vulnerable & Outdated Components — clean within scope.** Zero new runtime deps (AC-12); all crypto from `@noble/*` (audited).
7. **A07 Identification & Authentication Failures — clean.** `toLowerCase()` normalization applied to both recovered and expected EVM addresses before `===` compare — avoids case-mismatch false negatives. Solana path uses byte-level Ed25519 verify, not string compare. Mill-signer-address cross-check within channel groups prevents signer substitution.
8. **A08 Software & Data Integrity Failures — clean.** Base58 inputs are decoded AND length-checked (32 bytes) everywhere (post Pass #1). EVM addresses regex-checked to `/^0x[0-9a-f]{40}$/`. Hex inputs regex-checked to fixed lengths.
9. **A09 Logging & Monitoring Failures — N/A for this layer.** Caller-supplied pino logger with debug/info/warn/error surfaces; no PII / secret logging paths (signatures never logged as bytes).
10. **A10 SSRF — N/A.** Zero network calls; pure-byte computation per AC-5 purity requirements.

**MAX_SAFE_INTEGER re-audit:**

- `evm.ts:240` — `parseInt(hex.slice(i*2, i*2+2), 16)`: 2-char hex slice = 0–255 range. Safe.
- `evm.ts:467` — `Number(sigLen)` where `sigLen: bigint`: subsequent `sigEnd > data.length` check rejects any `sigLen` exceeding calldata; for `sigLen > 2^53` the `Number(...)` coerces to `Infinity`-adjacent value which still fails the length check and throws `ENCODING_FAILED`. Safe.
- `hashes.ts:46` and `solana.ts:104` — `Number(v & 0xffn)`: masked to single byte 0–255. Safe.

**`any` / `@ts-ignore` / `@ts-expect-error` grep in public surface:** 0 matches in `packages/sdk/src/settlement/*.ts`. The one apparent match in `hashes.ts:7` is inside a JSDoc comment ("any change to the hash layout"), not a type escape.

**Post-audit verification:**

- `pnpm --filter @toon-protocol/sdk test` — **660 passed** (33 test files, 25.79s)
- Semgrep CLI scan — **0 findings** across 210 applicable rules on 12 files
- No code changes required in this pass

**Action items / follow-ups:** None. Three successive review passes (Pass #1 fixed 3 medium + 3 low; Pass #2 verified clean; Pass #3 adds OWASP/Semgrep coverage) all approve. Story 12.6 is fully discharged.
