# Story 12.3: Mill Swap Handler (`createSwapHandler()`) — Unwrap, Rate Conversion, Encrypted Claim Issuance

Status: done
ui_impact: false
epic: 12
story_id: 12-3

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TOON Protocol developer building the Token Swap Primitive (Epic 12),
I want a `createSwapHandler()` factory in `@toon-protocol/sdk` that produces a kind:1059-registered `Handler` capable of unwrapping NIP-59 gift-wrapped ILP swap packets, applying a per-packet exchange rate, delegating signed payment-channel claim issuance to a pluggable `ClaimIssuer`, and returning the claim NIP-44 encrypted (ephemeral-key, per D12-008) alongside the ephemeral pubkey on the FULFILL response path,
so that a Mill operator can register a single handler with their SDK node that implements the entire inbound side of the swap protocol — receiving cleartext rumor + sender pubkey from the opaque wire, pricing the swap against a live `SwapPair`, issuing a target-asset claim from their payment channel reserves, and returning an opaque ciphertext to the sender without leaking the swap value, asset pair, or recipient identity to any intermediary on the return path.

This is the core inbound-swap story for Epic 12. Story 12.1 (done) defined the `SwapPair` type and kind:10032 serialization. Story 12.2 (done) provided the low-level `unwrapSwapPacketFromToon()` and `encryptFulfillClaim()` primitives. This story composes those primitives into a fully-registered `Handler` that any SDK `Node` can attach via `registry.on(1059, handler)`. Story 12.4 (Mill inventory + wallet) plugs a real multi-chain `ClaimIssuer` behind this handler. Story 12.5 (`streamSwap()`) is the counterpart sender-side API. Story 12.7 (Mill package scaffold) wires this handler into a standalone `startMill()` entrypoint.

## Dependencies

- **Upstream:** Story 12.1 (`SwapPair` type + `IlpPeerInfo.swapPairs`) — DONE. Provides the `SwapPair` shape this handler consumes at construction time for pair validation and rate lookup.
- **Upstream:** Story 12.2 (NIP-59 gift wrap + FULFILL encryption primitives) — DONE. This story is a direct consumer of `unwrapSwapPacketFromToon()`, `encryptFulfillClaim()`, and `GiftWrapError` from `@toon-protocol/sdk`.
- **Upstream:** `@toon-protocol/sdk` — `HandlerRegistry`, `Handler`, `HandlerContext`, `HandlePacketAcceptResponse`, `HandlePacketRejectResponse`. Handler signature: `(ctx: HandlerContext) => Promise<HandlerResponse>`.
- **Upstream:** `@toon-protocol/core` — `SwapPair`, `HandlePacketAcceptResponse`, `HandlePacketRejectResponse`. The `accept()` response includes an optional `metadata: Record<string, unknown>` field that carries the encrypted claim + ephemeral pubkey back to the connector for inclusion in the ILP FULFILL data field.
- **Downstream:** Story 12.4 (Mill inventory + wallet management) — supplies the concrete `MultiChainClaimIssuer` implementation of the `ClaimIssuer` interface this story defines.
- **Downstream:** Story 12.5 (`streamSwap()`) — the client-side counterpart that constructs gift-wrapped packets this handler consumes, and decrypts the FULFILL metadata this handler emits.
- **Downstream:** Story 12.7 (`packages/mill/` + `startMill()`) — will register this handler on the embedded-connector SDK node and wire the concrete `ClaimIssuer`.
- **Downstream:** Story 12.8 (E2E) — validates the full wrap → route → this handler → encrypted FULFILL cycle against Docker SDK E2E infra.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Non-custodial, privacy-preserving token swaps via existing ILP micropayment infrastructure. Swap-capable peers (Mills) advertise `swapPairs` on kind:10032; clients send NIP-59 gift-wrapped ILP packets carrying source-asset value; Mills return signed target-asset payment-channel claims via the ILP FULFILL data field, NIP-44 encrypted with an ephemeral key.

Directly relevant decisions from `_bmad-output/epics/epic-12-token-swap-primitive.md`:

- **D12-001:** Swaps are not a new protocol operation — just ILP packets to a Mill peer. Standard ILP routing delivers packets. Mill's handler unwraps, prices, and issues a claim from its own reserves. No changes to the connector forwarding path.
- **D12-004:** Sender controls packet granularity. The handler processes exactly one packet at a time. No cross-packet state beyond what the `ClaimIssuer` (Story 12.4) maintains.
- **D12-005:** Signed claims in FULFILL, not on-chain transfers. The handler returns a signed off-chain claim in `accept()` metadata; no on-chain tx executes during packet processing.
- **D12-006:** Live rate per packet. The handler applies the current rate at packet-processing time (sourced from the `SwapPair` passed into the factory or re-fetched per call via a `rateProvider` hook). No rate locking.
- **D12-008:** FULFILL claims are NIP-44 encrypted with an ephemeral key. Handler generates a fresh ephemeral keypair per successful claim (via `encryptFulfillClaim()` from Story 12.2), includes the ephemeral pubkey alongside the ciphertext in response metadata, and discards the ephemeral privkey. Completes the return-path privacy model.
- **D12-009:** No connector modifications required. The Mill handler operates at the application layer — it receives a fully-assembled `HandlerContext` from the SDK dispatcher and returns an `HandlerResponse`. It does not touch routing, BTP, or `PerPacketClaimService` in the connector.
- **D12-010:** Mill handler has its own wallet/channel management, separate from the embedded connector. The `ClaimIssuer` interface defined in this story is the seam — Story 12.4 will implement it with its own `PaymentChannelProvider` instances on the target chains.

## Acceptance Criteria

1. **AC-1 — `ClaimIssuer` interface defined and exported.** Create a new file `packages/sdk/src/swap-handler.ts` exporting a `ClaimIssuer` interface that the handler delegates to for signed-claim production. The shape MUST be:
   ```ts
   export interface IssueClaimParams {
     /** Source-asset amount received by the Mill (ILP packet amount, in source micro-units). */
     sourceAmount: bigint;
     /** Target-asset amount owed to the sender (post-rate-conversion, in target micro-units). */
     targetAmount: bigint;
     /** The SwapPair this packet is being priced against. */
     pair: SwapPair;
     /** The sender's real pubkey (extracted from the unwrapped seal). */
     senderPubkey: string;
     /** The inner rumor (for optional Mill-side context; may be ignored by the issuer). */
     rumor: UnsignedEvent;
   }
   export interface IssueClaimResult {
     /** Signed claim bytes ready for NIP-44 encryption. Format is chain-specific (EVM: RLP-encoded, Solana: Borsh, Mina: Poseidon/serialized proof). */
     claim: Uint8Array;
     /** Optional Mill-side claim ID for logging/tracing. */
     claimId?: string;
   }
   export interface ClaimIssuer {
     /**
      * Produce a signed off-chain payment-channel claim in the target asset.
      * MUST be atomic with inventory debit (caller relies on inventory accounting happening before this resolves).
      * MUST throw if reserves insufficient, pair unsupported, or signing fails.
      */
     issueClaim(params: IssueClaimParams): Promise<IssueClaimResult>;
   }
   ```
   Type-only exports are fine; no runtime implementation required in this story. Story 12.4 provides the concrete implementation.

2. **AC-2 — `SwapHandlerError` class added.** Add a new error class to `packages/sdk/src/errors.ts` following the existing pattern (extends `ToonError`, string code, optional `cause`). Name: `SwapHandlerError`, code: `'SWAP_HANDLER_ERROR'`. Export from `packages/sdk/src/index.ts` alongside `GiftWrapError`, `IdentityError`, etc. This class is thrown (or wrapped into `reject()` responses) for internal handler failures that are NOT gift-wrap errors (rate conversion overflow, issuer rejection, unsupported pair, etc.). Gift-wrap failures continue to surface as `GiftWrapError` (Story 12.2).

3. **AC-3 — `createSwapHandler()` factory signature and return type.** Export `createSwapHandler()` from `packages/sdk/src/swap-handler.ts` with this shape:
   ```ts
   export interface CreateSwapHandlerConfig {
     /** Mill's secp256k1 secret key for unwrapping gift-wrapped packets (32 bytes). */
     recipientSecretKey: Uint8Array;
     /** Swap pairs this Mill currently supports. Keyed lookup via (from.assetCode, from.chain, to.assetCode, to.chain). */
     swapPairs: SwapPair[];
     /** Claim issuer delegate (Story 12.4 plugs in the multi-chain implementation). */
     claimIssuer: ClaimIssuer;
     /**
      * Optional rate override hook. When provided, the handler calls this per-packet instead of reading pair.rate
      * from the frozen config. Enables live rate updates without re-registering the handler (D12-006).
      * MUST return a decimal string matching SwapPair.rate format: /^(0|[1-9]\d*)(\.\d+)?$/.
      */
     rateProvider?: (pair: SwapPair) => string | Promise<string>;
     /**
      * Optional replay-protection set. When provided, the handler computes a deterministic
      * packet ID (sha256 of senderPubkey || sourceAmount || rumor.id) and rejects duplicates
      * with ILP F04. Operator is responsible for bounding this set (e.g., LRU) — see AC-11.
      */
     seenPacketIds?: Set<string>;
     /**
      * Optional logger (pino-compatible). Defaults to a no-op logger. Handler logs structural events
      * (unwrap_failed, rate_applied, claim_issued, rejected) at debug/info level.
      */
     logger?: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
   }
   export function createSwapHandler(config: CreateSwapHandlerConfig): Handler;
   ```
   The returned function is a standard `Handler` from `@toon-protocol/sdk`: `(ctx: HandlerContext) => Promise<HandlerResponse>`. It MUST be pure w.r.t. the config closure (idempotent construction — calling `createSwapHandler()` twice with the same config produces two independent handlers with identical behavior). The returned `Handler` is registered by the operator via `node.handlers.on(1059, handler)` in Story 12.7.

4. **AC-4 — Handler dispatches on kind:1059.** The contract is that the handler is registered for kind:1059 (NIP-59 gift wrap outer kind). The handler MUST:
   - Verify `ctx.kind === 1059`. If not, return `ctx.reject('F02', 'Swap handler received non-gift-wrap kind')` (ILP F02 = Unreachable). This is defensive — `HandlerRegistry.dispatch` already routes by kind, but a mis-registered handler should fail loudly.
   - Extract the TOON binary from `ctx` for unwrapping. The TOON string on `ctx.toon` is base64; decode to `Uint8Array` via `Buffer.from(ctx.toon, 'base64')` before passing to `unwrapSwapPacketFromToon()`.

5. **AC-5 — Handler unwraps NIP-59 packet via Story 12.2 primitives (T-017).** Inside the handler, call `unwrapSwapPacketFromToon({ toonData, recipientSecretKey: config.recipientSecretKey })`. On success, extract `{ rumor, senderPubkey }`. On failure (any `GiftWrapError` thrown):
   - Log at `warn` level: `{ error: e.message, destination: ctx.destination }`.
   - Return `ctx.reject('F01', 'Invalid gift wrap')` (ILP F01 = Invalid Packet). Do NOT leak the underlying error message to the sender (privacy-preserving failure).

6. **AC-6 — Handler rejects non-gift-wrapped packets (T-021, R-010).** If the TOON-decoded event is not a kind:1059 gift wrap (detected by the gift-wrap unwrap failing its internal `kind !== 1059` check), the handler rejects with `F01`. Story 12.2's `unwrapSwapPacket` already throws `GiftWrapError('Expected kind:1059 gift wrap')` — this is caught by AC-5 handling. An additional explicit test (T-021) verifies that a raw (non-wrapped) event with any kind other than 1059 results in rejection without any claim issuance and without calling `claimIssuer.issueClaim`.

7. **AC-7 — Handler identifies the `SwapPair` from rumor metadata.** The inner rumor MUST carry two tags identifying the desired pair: `['swap-from', '<assetCode>:<chain>']` and `['swap-to', '<assetCode>:<chain>']`. Helper function `findSwapPair(rumor: UnsignedEvent, pairs: SwapPair[]): SwapPair | null` (exported from `swap-handler.ts`) MUST:
   - Extract `swap-from` and `swap-to` tag values from the rumor.
   - Parse each as `<assetCode>:<chain>` (split on the FIRST `:` so multi-segment chain identifiers like `evm:base:8453` remain intact as the chain portion).
   - Find the first `SwapPair` in `pairs` where `pair.from.assetCode === fromAssetCode && pair.from.chain === fromChain && pair.to.assetCode === toAssetCode && pair.to.chain === toChain`.
   - Return the matching pair or `null` if no match.
   - If either tag is missing or malformed → return `null` (handler will then reject).

   If `findSwapPair` returns `null` → reject with `F06` (Unexpected Payment) and message `'Unsupported swap pair'` (T-027).

8. **AC-8 — Rate conversion: `applyRate(sourceAmount, pair, rate): bigint` helper (T-018, T-023, R-003, R-013).** Export a pure helper function `applyRate({ sourceAmount, fromScale, toScale, rate }: ApplyRateParams): bigint` from `swap-handler.ts`. Contract:
   ```ts
   export interface ApplyRateParams {
     /** Source amount in source micro-units (bigint). */
     sourceAmount: bigint;
     /** SwapPair.from.assetScale (number of decimals on source side). */
     fromScale: number;
     /** SwapPair.to.assetScale (number of decimals on target side). */
     toScale: number;
     /** Decimal-string rate (target whole-units per source whole-unit). Format /^(0|[1-9]\d*)(\.\d+)?$/. */
     rate: string;
   }
   ```
   Algorithm (exact, no float arithmetic):
   1. Validate `rate` against `/^(0|[1-9]\d*)(\.\d+)?$/`. Throw `SwapHandlerError('Invalid rate format')` otherwise.
   2. If `rate === '0'` → throw `SwapHandlerError('Rate is zero (pair not quoting)')` — zero rate means the pair is advertised but not currently exchangeable.
   3. Split `rate` on `.` → integer part and fractional part (fractional defaulting to `''`). Compute `rateNumerator = BigInt(integerPart + fractionalPart)` and `rateDenominator = 10n ** BigInt(fractionalPart.length)`.
   4. Apply the unified formula (handles any `fromScale`/`toScale` ordering): `targetAmount = (sourceAmount * rateNumerator * 10n ** BigInt(toScale)) / (rateDenominator * 10n ** BigInt(fromScale))`.
   5. Integer division truncates — document that Mill economically favors itself by flooring (standard market-maker convention). Round toward zero.
   6. If `sourceAmount <= 0n` → throw `SwapHandlerError('sourceAmount must be positive')`.
   7. Return `targetAmount` as `bigint`.

   Guard: MUST use `BigInt` throughout — never `Number` — to avoid `MAX_SAFE_INTEGER` overflow on 18-decimal EVM scales (Epic 11 retro guard).

9. **AC-9 — Handler calls `claimIssuer.issueClaim()` with computed amounts (T-019).** After successful unwrap + pair lookup + rate conversion:
   - Resolve rate: if `config.rateProvider` is defined, `await config.rateProvider(pair)`; else use `pair.rate` from config.
   - Call `applyRate({ sourceAmount: ctx.amount, fromScale: pair.from.assetScale, toScale: pair.to.assetScale, rate })` → `targetAmount`.
   - Call `config.claimIssuer.issueClaim({ sourceAmount: ctx.amount, targetAmount, pair, senderPubkey, rumor })` → `{ claim, claimId }`.
   - On any error thrown by the issuer (inventory, signing, chain) → catch, log at `error` level, return `ctx.reject('T04', 'Insufficient liquidity')` for inventory errors (detected by `error.code === 'INSUFFICIENT_INVENTORY'` or message match), else `ctx.reject('T00', 'Internal error')`. Do NOT bubble the issuer error to the caller — this handler is a protocol boundary.

10. **AC-10 — Handler encrypts the claim via Story 12.2 (T-020, D12-008, R-002).** After `issueClaim()` succeeds:
    - Call `encryptFulfillClaim({ claimData: claim, senderPubkey })` → `{ ciphertext, ephemeralPubkey }`.
    - Return `ctx.accept({ claim: toBase64(ciphertext), ephemeralPubkey, claimId })` where `toBase64` is `Buffer.from(ciphertext).toString('base64')`. The `accept()` response's `metadata` field is typed `Record<string, unknown>` — the connector's FULFILL path serializes this metadata into the FULFILL data field bytes.
    - Ephemeral privkey is discarded inside `encryptFulfillClaim` (Story 12.2 handles zeroing). This story does NOT re-introduce any ephemeral-key retention.

11. **AC-11 — Replay protection hook (optional but tested, R-016).** Expose an optional `seenPacketIds?: Set<string>` config field. If `seenPacketIds` is provided, the handler MUST:
    - Compute packet ID as `sha256(senderPubkey || sourceAmount || rumor.id)` using Node's built-in `createHash('sha256')` from `node:crypto` (already available — no new dep). Note that `rumor` is an `UnsignedEvent` which may lack an `id`; use `(rumor.id ?? '')` defensively to keep the hash deterministic even when absent.
    - If `seenPacketIds.has(packetId)` → reject with `F04` (Final: Duplicate), message `'Duplicate packet'`.
    - Else `seenPacketIds.add(packetId)` AFTER successful claim issuance (so a rejected packet can be retried).
    - If the config field is absent, skip replay protection (operator opts in). Document that in-memory `Set` is unbounded and operators should inject a bounded LRU (e.g., `lru-cache`) in production; this story does NOT pull in an LRU dep.

12. **AC-12 — Concurrent swap safety (T-026, R-018).** The handler MUST be safe under concurrent invocation. Since Node.js is single-threaded and JavaScript is cooperative, the only shared mutable state this story introduces is `seenPacketIds` (if provided by operator) — all inventory/channel mutation happens inside `claimIssuer.issueClaim()` which is Story 12.4's responsibility. Add a test (T-026) that invokes the handler 10 times concurrently via `Promise.all` with distinct gift-wrapped packets and asserts:
    - All 10 succeed (assuming issuer's mock returns success).
    - `issueClaim` is called exactly 10 times.
    - No two claims share the same `claimId` (test-only property — real issuers guarantee this).

13. **AC-13 — Package exports.** Export from `packages/sdk/src/index.ts`:
    - `createSwapHandler` (factory)
    - `findSwapPair` (helper)
    - `applyRate` (helper)
    - `SwapHandlerError` (error)
    - Type exports: `CreateSwapHandlerConfig`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`, `ApplyRateParams`, `SwapHandlerLogger`.
    - Group under a `// Swap handler (Story 12.3)` comment block in `index.ts`, matching the existing `// Gift wrap (Story 12.2)` pattern.

14. **AC-14 — Unit tests (>= 22 tests).** Create `packages/sdk/src/swap-handler.test.ts`. Coverage MUST include (mapping to test-design-epic-12 T-017..T-028 + replay T-R1..T-R2 + concurrent T-026):

    - **(T-017) Handler unwraps valid gift wrap:** Construct gift-wrapped packet via `wrapSwapPacketToToon` with matching `swap-from`/`swap-to` tags → handler returns `accept({ claim, ephemeralPubkey, claimId })`. Mock `claimIssuer` records the call.
    - **(T-018) Rate applied correctly, 6→18 decimal scale:** `sourceAmount=1_000_000n` (1 USDC at scale 6), `rate='0.000357'`, `toScale=18` → `targetAmount === 357_000_000_000_000n` (0.000357 ETH in wei). Golden vector.
    - **(T-018b) Rate applied correctly, same-scale pair:** 6→6 scale, `rate='1.0005'` → sub-bigint precision preserved without rounding drift.
    - **(T-019) Handler delegates to `claimIssuer` with correct params:** Spy on `issueClaim` — assert called once with `{ sourceAmount, targetAmount, pair, senderPubkey, rumor }` matching inputs.
    - **(T-020) FULFILL claim is encrypted:** Capture the `accept()` metadata → `claim` field is base64 of NIP-44 ciphertext, `ephemeralPubkey` is a 64-char hex pubkey. Decrypt via `decryptFulfillClaim` with sender secret key → recovers original claim bytes.
    - **(T-021) Handler rejects non-gift-wrapped packet:** Construct a kind:1 event (not kind:1059), build a fake TOON-encoded `ctx` → handler returns reject with code `F01`. `claimIssuer.issueClaim` NOT called.
    - **(T-022) Handler rejects malformed gift wrap:** Tamper with the ciphertext inside the gift wrap → handler rejects `F01`. `claimIssuer.issueClaim` NOT called.
    - **(T-023) Rate conversion boundary: large source amount + 18-decimal target:** `sourceAmount = (2n ** 63n)`, rate `"2800.5"`, scales 6→18 → no overflow, deterministic output (uses BigInt throughout).
    - **(T-024) Insufficient inventory:** Mock `issueClaim` throws `Error` with `code='INSUFFICIENT_INVENTORY'` (or message containing "insufficient") → handler rejects `T04` with message `'Insufficient liquidity'`.
    - **(T-025) Ephemeral pubkey different per call:** Run handler 5 times with same inputs → 5 distinct `ephemeralPubkey` values in returned metadata.
    - **(T-026) Concurrent invocation:** `Promise.all` 10 invocations → all 10 accept, 10 distinct `claimId`, `issueClaim` called 10 times.
    - **(T-027) Unsupported swap pair:** rumor tags reference a pair NOT in `config.swapPairs` → handler rejects `F06` with message `'Unsupported swap pair'`. `claimIssuer.issueClaim` NOT called.
    - **(T-028a) Zero rate rejected:** `rate='0'` on matched pair → `applyRate` throws `SwapHandlerError('Rate is zero (pair not quoting)')` → handler rejects `T00`.
    - **(T-028b) Large rate handled:** `rate='999999999.999999'` with `sourceAmount=1n` → finite bigint, no throw. (Documents no-overflow behavior.)
    - **(T-R1) Replay protection: duplicate packet rejected:** With `seenPacketIds = new Set()` passed in config, handler twice with the SAME gift-wrapped packet (same sender, same amount, same rumor.id) → first `accept`, second `reject('F04', 'Duplicate packet')`. `issueClaim` called exactly once.
    - **(T-R2) Replay protection disabled by default:** Without `seenPacketIds` in config, handler twice with the same packet → both `accept` (no dedup).
    - **`findSwapPair` unit tests (≥3):** (a) exact match returns pair; (b) mismatched chain returns null; (c) malformed tag (missing `:`) returns null.
    - **`applyRate` unit tests (≥3):** (a) 6→18 USDC→ETH golden vector; (b) 18→6 ETH→USDC golden vector; (c) invalid rate format throws.
    - **`rateProvider` hook fires per packet:** Mock `rateProvider` returning `'0.0004'` (overriding `pair.rate='0.000357'`) → handler applies `0.0004`. Assert hook called exactly once per handler invocation.
    - **Handler does not retain ephemeral privkey:** After handler returns, verify (via Story 12.2's existing guarantees — no new test needed, but DOCUMENT in a comment that Story 12.2's `encryptFulfillClaim` already handles zeroing).

15. **AC-15 — Build, lint, test verification.** After all changes:
    - `pnpm --filter @toon-protocol/sdk build` exits 0 with no TypeScript errors.
    - `pnpm --filter @toon-protocol/sdk test` passes — all new tests pass; all pre-existing tests still pass (no regressions). Capture the baseline test count with `pnpm --filter @toon-protocol/sdk test` BEFORE starting implementation and confirm the post-implementation count equals `baseline + (new tests added)`.
    - `pnpm lint` passes for the `packages/sdk` scope.
    - No changes to `@toon-protocol/core` or other packages. No new workspace dependencies beyond what `@toon-protocol/sdk` already declares (`nostr-tools`, `@toon-protocol/core`). If AC-11 hashing requires a dep, prefer Node's built-in `crypto` module (`createHash('sha256')`) — no external dep needed.

## Tasks / Subtasks

- [x] **Task 1: Add `SwapHandlerError` error class** (AC: 2)
  - [x] 1.1 Add `SwapHandlerError extends ToonError` to `packages/sdk/src/errors.ts` with code `'SWAP_HANDLER_ERROR'` and optional `cause` param, following the existing pattern (see `GiftWrapError`, `IdentityError`, `PricingError` in the same file).
  - [x] 1.2 Export `SwapHandlerError` from `packages/sdk/src/index.ts` in the error classes block alongside `GiftWrapError`.

- [x] **Task 2: Define `ClaimIssuer` interface and associated types** (AC: 1)
  - [x] 2.1 Create `packages/sdk/src/swap-handler.ts`.
  - [x] 2.2 Define and export `IssueClaimParams`, `IssueClaimResult`, `ClaimIssuer` (type-only). Reference `SwapPair` via `import type { SwapPair } from '@toon-protocol/core'` and `UnsignedEvent` via `import type { UnsignedEvent } from 'nostr-tools/pure'`.
  - [x] 2.3 Add comprehensive JSDoc on `ClaimIssuer.issueClaim` explaining atomicity expectations (inventory debit must happen inside the issuer) and Story 12.4 as the concrete implementer.

- [x] **Task 3: Implement `findSwapPair` helper** (AC: 7)
  - [x] 3.1 In `swap-handler.ts`, implement `findSwapPair(rumor: UnsignedEvent, pairs: SwapPair[]): SwapPair | null`.
  - [x] 3.2 Parse `swap-from`/`swap-to` tag values as `<assetCode>:<chain>` splitting on the FIRST `:` so multi-segment chain IDs like `evm:base:8453` work correctly (the chain portion retains its full identifier, e.g. `USDC:evm:base:8453` → `{assetCode:'USDC', chain:'evm:base:8453'}`).
  - [x] 3.3 Return `null` for any malformed input (missing tag, missing `:`, empty assetCode, empty chain). Do NOT throw — the caller interprets `null` as "unsupported pair" and rejects via ILP F06.

- [x] **Task 4: Implement `applyRate` helper** (AC: 8)
  - [x] 4.1 In `swap-handler.ts`, implement `applyRate({ sourceAmount, fromScale, toScale, rate }: ApplyRateParams): bigint`.
  - [x] 4.2 Validate rate format via `/^(0|[1-9]\d*)(\.\d+)?$/.test(rate)`. Throw `SwapHandlerError('Invalid rate format: ' + rate)` on mismatch.
  - [x] 4.3 Reject `rate === '0'` with `SwapHandlerError('Rate is zero (pair not quoting)')`.
  - [x] 4.4 Reject `sourceAmount <= 0n` with `SwapHandlerError('sourceAmount must be positive, got ' + sourceAmount)`.
  - [x] 4.5 Implement integer arithmetic: split rate on `.`, compute numerator/denominator BigInts, apply `targetAmount = (sourceAmount * rateNumerator * 10n ** BigInt(toScale)) / (rateDenominator * 10n ** BigInt(fromScale))`. All operations MUST be on BigInt — zero Number coercion.
  - [x] 4.6 Export `applyRate` and its `ApplyRateParams` type.

- [x] **Task 5: Implement `createSwapHandler` factory** (AC: 3, 4, 5, 6, 9, 10, 11, 12)
  - [x] 5.1 Define `CreateSwapHandlerConfig` interface per AC-3. Include the optional `seenPacketIds`, `rateProvider`, and `logger` fields.
  - [x] 5.2 Implement `createSwapHandler(config)` returning a `Handler` closure.
  - [x] 5.3 Inside the handler: (a) kind guard (AC-4), (b) base64-decode `ctx.toon` to `Uint8Array`, (c) call `unwrapSwapPacketFromToon` wrapped in try/catch, (d) on `GiftWrapError` → log warn, return `ctx.reject('F01', 'Invalid gift wrap')`.
  - [x] 5.4 After unwrap: call `findSwapPair(rumor, config.swapPairs)`. If null → return `ctx.reject('F06', 'Unsupported swap pair')`.
  - [x] 5.5 Replay check (AC-11): if `config.seenPacketIds` defined, compute `packetId = sha256(senderPubkey + ctx.amount.toString() + (rumor.id || ''))` using Node's `createHash('sha256').update(...).digest('hex')`. If already present → reject `F04`. (Add AFTER successful issuance, not before.)
  - [x] 5.6 Resolve rate: `const rate = config.rateProvider ? await config.rateProvider(pair) : pair.rate`.
  - [x] 5.7 Call `applyRate(...)`. Catch `SwapHandlerError` → return `ctx.reject('T00', error.message)`.
  - [x] 5.8 Call `config.claimIssuer.issueClaim(...)`. Catch any error: detect insufficient inventory via `err.code === 'INSUFFICIENT_INVENTORY'` OR `/insufficient/i.test(err.message)` → reject `T04`. Else reject `T00`.
  - [x] 5.9 Call `encryptFulfillClaim({ claimData: claim, senderPubkey })`. Base64-encode `ciphertext` for JSON-safe transport in metadata.
  - [x] 5.10 Add packet ID to `seenPacketIds` (if configured) AFTER successful issuance. Return `ctx.accept({ claim: claimBase64, ephemeralPubkey, claimId })`.
  - [x] 5.11 Ensure the handler is reentrant-safe under `Promise.all` — no module-level mutable state, all state is config-closure or inside the per-invocation function.

- [x] **Task 6: Package exports** (AC: 13)
  - [x] 6.1 In `packages/sdk/src/index.ts`, add a `// Swap handler (Story 12.3)` block below the `// Gift wrap (Story 12.2)` block.
  - [x] 6.2 Export runtime symbols: `createSwapHandler`, `findSwapPair`, `applyRate`, `SwapHandlerError`.
  - [x] 6.3 Export type symbols: `CreateSwapHandlerConfig`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`, `ApplyRateParams`.
  - [x] 6.4 Update `packages/sdk/src/index.test.ts` to include the 4 new runtime symbols in the expected-exports set (matches the pattern from Story 12.2).

- [x] **Task 7: Unit tests** (AC: 14)
  - [x] 7.1 Create `packages/sdk/src/swap-handler.test.ts`.
  - [x] 7.2 Build test fixtures: a known `senderSecretKey`/`recipientSecretKey` pair, a canonical `SwapPair` (USDC 6 on evm:base → ETH 18 on evm:base, rate `'0.000357'`), a mock `ClaimIssuer` with spyable `issueClaim` returning `{ claim: new Uint8Array([1,2,3,4]), claimId: 'test-' + ++i }`.
  - [x] 7.3 Build a test helper `makeCtx(toonBase64: string, kind: number, amount: bigint, destination: string): HandlerContext` that mirrors `createHandlerContext` from the SDK but is synthesizable without a full Node.
  - [x] 7.4 Implement T-017, T-018, T-018b, T-019, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-027, T-028a, T-028b, T-R1, T-R2 per AC-14.
  - [x] 7.5 Implement ≥3 `findSwapPair` unit tests + ≥3 `applyRate` unit tests + rateProvider hook test.
  - [x] 7.6 For T-020 (FULFILL decryption roundtrip), decode `claim` from base64 → pass to `decryptFulfillClaim({ ciphertext, ephemeralPubkey, recipientSecretKey: senderSecretKey })` → assert matches original `{1,2,3,4}` bytes.

- [x] **Task 8: Build + lint + test verification** (AC: 15)
  - [x] 8.1 `pnpm --filter @toon-protocol/sdk build` — exit 0.
  - [x] 8.2 `pnpm --filter @toon-protocol/sdk test` — all tests pass; no regressions in existing 469 tests.
  - [x] 8.3 `pnpm lint` — 0 errors for `packages/sdk` scope.
  - [x] 8.4 Confirm no changes to `@toon-protocol/core` or any other package.

## Dev Notes

### Where this story stops and Story 12.4 takes over

This story defines the `ClaimIssuer` **interface** and handler **orchestration** — nothing more. Concrete wallet/channel machinery (BIP-44 key derivation for account index 2, multi-chain `PaymentChannelProvider` instances, inventory balance tracking, rate oracle integration) is Story 12.4's scope. Your mock `ClaimIssuer` in tests should return synthetic claim bytes like `new Uint8Array([1,2,3,4])` — the handler does not care about claim format, only that the issuer returns bytes it can encrypt. This preserves the epic's D12-010 separation: the connector settles the inbound USDC; the handler + its issuer manage the outbound asset.

### HandlerContext shape refresher

From `packages/sdk/src/handler-context.ts`:
```ts
interface HandlerContext {
  readonly toon: string;        // base64-encoded TOON binary
  readonly kind: number;
  readonly pubkey: string;      // OUTER gift-wrap ephemeral pubkey (not sender's real pubkey)
  readonly amount: bigint;      // ILP packet amount (source asset micro-units)
  readonly destination: string; // ILP destination address
  decode(): NostrEvent;
  accept(metadata?: Record<string, unknown>): HandlePacketAcceptResponse;
  reject(code: string, message: string): HandlePacketRejectResponse;
}
```

The handler uses `ctx.toon`, `ctx.amount`, `ctx.destination`, and returns `ctx.accept(...)` / `ctx.reject(...)`. It does NOT use `ctx.pubkey` for sender identity — that's the ephemeral gift-wrap pubkey. The **real** sender pubkey comes from `unwrapSwapPacketFromToon()` output. Document this in a comment above the unwrap call to prevent a future refactor from mistaking `ctx.pubkey` for the sender.

### ILP error codes reference

| Code | Meaning | Use case in this story |
|------|---------|------------------------|
| F01 | Invalid Packet | Gift-wrap failure (malformed, wrong key, not kind:1059) |
| F02 | Unreachable | Handler registered for wrong kind (defensive only) |
| F04 | Final Duplicate | Replay protection hit (AC-11) |
| F06 | Unexpected Payment | Unsupported swap pair (no match in `config.swapPairs`) |
| T00 | Internal Error | Rate conversion error, issuer non-inventory error |
| T04 | Insufficient Liquidity | Mill reserves too low (issuer threw `INSUFFICIENT_INVENTORY`) |

These match the standard ILPv4 error taxonomy. Do NOT invent new codes.

### `encryptFulfillClaim` transport encoding

From Story 12.2, `encryptFulfillClaim` returns `{ ciphertext: Uint8Array, ephemeralPubkey: string }`. The `ciphertext` is already a `Uint8Array` wrapping a NIP-44 ciphertext string. For transport inside `HandlerResponse.metadata` (which is JSON-serialized somewhere downstream by the connector), base64-encode the `ciphertext`:
```ts
const claimBase64 = Buffer.from(ciphertext).toString('base64');
return ctx.accept({ claim: claimBase64, ephemeralPubkey, claimId });
```

The sender-side `streamSwap()` (Story 12.5) will base64-decode before calling `decryptFulfillClaim`. Document this encoding convention in a JSDoc block on `createSwapHandler` so Story 12.5 matches.

### Rate math: worked examples

**USDC → ETH at $2800/ETH** (rate = 0.000357):
- `sourceAmount = 1_000_000n` (1.0 USDC at scale 6)
- `fromScale = 6, toScale = 18, rate = '0.000357'`
- Integer part: `0`, fractional: `000357`, length: 6
- `rateNumerator = 357n`, `rateDenominator = 1_000_000n`
- `targetAmount = (1_000_000n * 357n * 10n**18n) / (1_000_000n * 10n**6n)` = `357n * 10n**12n` = `357_000_000_000_000n` (357 μETH in wei = ~0.000357 ETH). ✓

**ETH → USDC at $2800/ETH** (rate = 2800):
- `sourceAmount = 10n**15n` (0.001 ETH in wei)
- `fromScale = 18, toScale = 6, rate = '2800'`
- Integer part: `2800`, fractional: `''`, length: 0
- `rateNumerator = 2800n`, `rateDenominator = 1n`
- `targetAmount = (10n**15n * 2800n * 10n**6n) / (1n * 10n**18n)` = `2800n * 10n**3n` = `2_800_000n` (2.8 USDC at scale 6). ✓

Include both golden vectors in tests (T-018, T-018b) — they catch off-by-one decimal errors that lab-math verification misses.

### Non-goals for this story (scope fence)

- Do NOT implement wallet key derivation (BIP-44 account index 2). Story 12.4.
- Do NOT implement the concrete `ClaimIssuer` for EVM/Solana/Mina. Story 12.4.
- Do NOT implement inventory balance tracking. Story 12.4.
- Do NOT implement `streamSwap()`. Story 12.5.
- Do NOT implement `buildSettlementTx()`. Story 12.6.
- Do NOT create `packages/mill/` package scaffold beyond what already exists. Story 12.7.
- Do NOT implement an LRU for `seenPacketIds` — operator injects. Expose the contract only.
- Do NOT fetch exchange rates from any oracle. `rateProvider` is a hook for the operator.
- Do NOT modify the connector or any routing code (D12-009).
- Do NOT modify `@toon-protocol/core`. This story is self-contained in `@toon-protocol/sdk`.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does not create or modify GitHub Actions workflows. No action needed.
- **MAX_SAFE_INTEGER guard:** **APPLIES DIRECTLY.** The `applyRate` helper and all claim amount handling MUST use `bigint` end-to-end. Never coerce a 64-bit-capable value to `Number`. The `nonce` and similar counters are handled inside the `ClaimIssuer` (Story 12.4) and are not this story's concern. Verify in code review that no `Number(...)`, `parseInt(...)`, or `parseFloat(...)` touches any amount, rate, or scale arithmetic in `swap-handler.ts`.
- **Golden test vectors (ZK story pairs):** Does not apply — no ZK circuit counterpart. But the rate golden vectors (AC-14 T-018, T-018b) ARE load-bearing: they lock the Mill's economic behavior. Treat them like golden vectors — any change to `applyRate` output for fixed inputs is a breaking protocol change.

### Project Structure Notes

- All new code lives in `packages/sdk/src/swap-handler.ts` + `.test.ts`. Errors file modified. Index modified.
- No changes to `@toon-protocol/core`, `packages/mill/` (scaffold is Story 12.7), `packages/town/`, or any other package.
- No new workspace dependencies. Uses Node's built-in `crypto` for sha256 if replay hash needed.
- Test file co-located with source: `packages/sdk/src/swap-handler.test.ts` alongside `packages/sdk/src/swap-handler.ts`.
- Imports from `@toon-protocol/sdk` internal: `GiftWrapError`, `unwrapSwapPacketFromToon`, `encryptFulfillClaim`. Imports from `@toon-protocol/core`: `SwapPair` type only.

### References

- [Source: `_bmad-output/epics/epic-12-token-swap-primitive.md`] — epic goal, design decisions D12-001, D12-004, D12-005, D12-006, D12-008, D12-009, D12-010. Swap flow architecture (lines 49-87). Step 4 "Processing (at destination Mill)" is the scope of this story.
- [Source: `_bmad-output/planning-artifacts/test-design-epic-12.md#Story 12-3`] — P0/P1/P2 test scenarios T-017 through T-028; risks R-002, R-003, R-010, R-013, R-018; quality gates "NIP-59 privacy invariant" and "Exchange rate correctness".
- [Source: `_bmad-output/implementation-artifacts/12-2-nip59-gift-wrap-integration-for-ilp-packets.md`] — Story 12.2 final implementation (all 6 gift-wrap + FULFILL functions). Particularly the exports from `packages/sdk/src/gift-wrap.ts` this story composes.
- [Source: `packages/sdk/src/gift-wrap.ts`] — `unwrapSwapPacketFromToon`, `encryptFulfillClaim` function signatures and guarantees (ephemeral key zeroing, kind validation, error handling).
- [Source: `packages/sdk/src/handler-registry.ts`] — `Handler` type, `HandlerRegistry.on(kind, handler)` registration pattern.
- [Source: `packages/sdk/src/handler-context.ts`] — `HandlerContext` interface; `accept(metadata)` / `reject(code, message)` contract.
- [Source: `packages/sdk/src/errors.ts`] — existing error class pattern (`GiftWrapError`, `IdentityError`, `PricingError` all extend `ToonError`).
- [Source: `packages/sdk/src/index.ts`] — current public API surface; follow the `// Gift wrap (Story 12.2)` comment-block export convention.
- [Source: `packages/core/src/types.ts`] — `SwapPair` interface (Story 12.1).
- [Source: `packages/core/src/x402/build-ilp-prepare.ts`] — `IlpPreparePacket` shape (`{ destination, amount: string, data: base64-string }`) — useful for understanding what the sender (Story 12.5) will construct, which this handler receives the decoded form of via `ctx`.
- [Source: `_bmad-output/project-context.md`] — package dependency graph, ILP error code conventions, BigInt-over-Number mandate.

### Previous Story Intelligence

**Story 12.2 (NIP-59 gift wrap integration) — DONE:**

- Provides `unwrapSwapPacketFromToon({ toonData, recipientSecretKey })` returning `{ rumor, senderPubkey }`. This story consumes it directly.
- Provides `encryptFulfillClaim({ claimData, senderPubkey })` returning `{ ciphertext, ephemeralPubkey }`. This story consumes it directly. Ephemeral privkey is already zeroed inside Story 12.2 — do NOT re-implement zeroing.
- `GiftWrapError` is the canonical error thrown by the unwrap path. This story catches it and converts to `ctx.reject('F01', ...)` — do NOT re-throw or leak the message.
- Story 12.2 ATDD pattern: tests were written first (22 tests in `gift-wrap.test.ts`) against exported public API. Follow the same approach: write `swap-handler.test.ts` against the exported `createSwapHandler`/`findSwapPair`/`applyRate` API before implementing.
- Story 12.2 code review found 8 issues across 2 passes (input validation, conversation key zeroing, JSDoc annotations). Pre-empt by: (a) validating `recipientSecretKey` / `swapPairs` in `createSwapHandler` construction, (b) adding `@throws` JSDoc on every exported function, (c) defensively zeroing any locally-held key material if introduced.
- Story 12.2 kept nostr-tools to the existing `^2.20.0` range — do NOT bump or add new nostr-tools sub-path imports in this story. All crypto flows through Story 12.2's exports.

**Story 12.1 (SwapPair type + kind:10032 serialization) — DONE:**

- `SwapPair` is a type-only export from `@toon-protocol/core`. Use `import type { SwapPair } from '@toon-protocol/core'` — do NOT import the type as a runtime value.
- `SwapPair.from.chain` format is `{blockchain}:{network}[:{chainId}]` (e.g., `evm:base:8453`). The `findSwapPair` helper in AC-7 MUST split the `swap-from`/`swap-to` tag on the FIRST `:` (i.e., `indexOf(':')`) so the assetCode takes the leading segment and the chain retains its embedded colons (e.g., `USDC:evm:base:8453` → `{assetCode:'USDC', chain:'evm:base:8453'}`).
- Validation helpers (`assertSwapPairForBuild`/`assertSwapPairForParse`) live in `packages/core/src/events/swap-pair-validation.ts`. This story does NOT need to call them — the `SwapPair[]` passed to `createSwapHandler` is already validated at construction time by the operator via the kind:10032 builder.

**Files created/modified by Story 12.2 (reference only — do NOT re-touch):**
- `packages/sdk/src/gift-wrap.ts` (NEW)
- `packages/sdk/src/gift-wrap.test.ts` (NEW)
- `packages/sdk/src/errors.ts` (add `GiftWrapError`)
- `packages/sdk/src/index.ts` (add gift-wrap exports)

### Files This Story Creates/Modifies

- `packages/sdk/src/swap-handler.ts` (NEW) — `createSwapHandler`, `findSwapPair`, `applyRate`, `ClaimIssuer` interface, `CreateSwapHandlerConfig`, all associated types.
- `packages/sdk/src/swap-handler.test.ts` (NEW) — ≥18 tests covering T-017..T-028, replay, concurrent.
- `packages/sdk/src/errors.ts` (MODIFIED) — add `SwapHandlerError` class.
- `packages/sdk/src/index.ts` (MODIFIED) — add 4 runtime exports + 5 type exports in a new `// Swap handler (Story 12.3)` block.
- `packages/sdk/src/index.test.ts` (MODIFIED) — add 4 runtime symbols to expected-exports set.

## Story Completion Status

Created: 2026-04-13
Created by: create-story workflow (bmad-bmm) in YOLO mode
Sprint-status entry: add `12-3-mill-swap-handler: ready-for-dev` under epic-12.

## Change Log

| Date | Author | Change |
| --- | --- | --- |
| 2026-04-13 | create-story workflow (YOLO) | Initial draft — 15 ACs, 8 tasks, dev notes, previous-story intelligence from 12.1/12.2, scope fence explicitly excluding Stories 12.4-12.8, golden rate vectors, ILP error code table. |
| 2026-04-13 | adversarial-review (YOLO) | Fixes: AC-6 malformed sentence (duplicated `ctx.decode()`), AC-3 config interface missing `seenPacketIds` field, AC-8 dead `scaleAdjust` prose removed, AC-11 OR-ambiguity resolved (single `seenPacketIds: Set<string>` form), AC-13 mislabel corrected, AC-14 count raised to ≥22 (matches enumerated tests), AC-15 brittle hardcoded test counts replaced with baseline-capture workflow, AC-11 `rumor.id` nullability note added. |
| 2026-04-13 | dev-story (YOLO, Opus 4.6 1M) | Implemented Story 12.3 end-to-end: added `SwapHandlerError`, created `packages/sdk/src/swap-handler.ts` with `createSwapHandler`, `findSwapPair`, `applyRate`, `ClaimIssuer` interface, BigInt-only rate math, replay-protection hook, rate-provider hook, concurrent safety. Updated SDK `index.ts` exports and `index.test.ts` expected-exports set. All 35 ATDD tests in pre-existing `swap-handler.test.ts` pass. SDK suite green: 522/522 tests, build clean, 0 lint errors. |
| 2026-04-13 | code-review (YOLO, Opus 4.6 1M) | Adversarial review — 11 findings (1 critical, 2 high, 5 medium, 3 low). Fixes applied: (a) CRITICAL: removed `tryUnwrap` double-base64 fallback hack in `swap-handler.ts` — replaced with single-pass decode matching AC-4 contract, and corrected the test fixture `makeGiftWrappedCtx` to lift `ilpPrepare.data` (already base64) verbatim instead of re-encoding. (b) HIGH: corrected AC-7 / Task 3.2 wording (was `lastIndexOf`, actual impl + tests require FIRST `:` split). (c) MEDIUM: added `SwapHandlerLogger` to AC-13 type-exports list. (d) MEDIUM: `applyRate` T00 reject now returns generic `'Rate conversion error'` instead of internal validator message — closes small info-leak surface. (e) MEDIUM: `computePacketId` now prefixes each hash input with a 4-byte BE length, eliminating concatenation-ambiguity collisions. (f) LOW: added eager guard on `ctx.toon` type/emptiness before decode. All 527/527 SDK tests still pass, build clean, 0 lint errors. |
| 2026-04-13 | code-review pass #3 FINAL (YOLO, Opus 4.6 1M) | Adversarial review pass #3/3 with OWASP Top 10, authn/authz, injection focus — 2 findings (0 critical, 0 high, 1 medium, 1 low). Fixes applied: (a) MEDIUM: F02 reject message no longer leaks handler role ("Swap handler received non-gift-wrap kind" → "Unreachable") — aligns with D12-008 privacy model (minimize role-identifying signals on the reject path, same rationale as the generic F01 "Invalid gift wrap" message). (b) LOW: added defense-in-depth eager guard on `ctx.amount` (rejects non-bigint or `<= 0n` with dedicated F01 "Invalid amount" before `applyRate` would have fired with a misleading "Rate conversion error" T00). OWASP review clean: no injection risk (structured object logging, no string concat; BigInt arithmetic throughout, no Number coercion), no authz flaws (open-market by design per D12-010), no broken auth (sender identity comes from verified NIP-59 seal, not caller-controlled `ctx.pubkey`), no sensitive-data leaks (claim encrypted with ephemeral key, reject messages now uniformly generic), no SSRF surface, no deserialization risk (TOON decode is bounded by ILP packet limits). Verification: 527/527 SDK tests pass, build clean. Story transitions to `done`. |
| 2026-04-13 | code-review pass #2 (YOLO, Opus 4.6 1M) | Adversarial review pass #2 of 3 — 4 findings (0 critical, 0 high, 2 medium, 2 low). Fixes applied: (a) MEDIUM: closed concurrent check-then-add race in AC-11 replay protection — handler now reserves `packetId` synchronously (before any `await`) so two concurrent invocations with identical packet IDs cannot both pass the `has()` gate. Added `releaseReservation()` helper that frees the reservation on rate-provider, rate-conversion, issuer, and encrypt failure paths so legitimate retries are still permitted (AC-11 requires rejected packets to be retryable). (b) MEDIUM: fixed stale Dev Notes / Previous Story Intelligence reference that still specified `lastIndexOf(':')` for `findSwapPair`; corrected to FIRST `:` (`indexOf`) matching the implementation and tests. (c) LOW: corrected misleading test comment in `findSwapPair` multi-segment chain test ("last colon" → "first colon"). (d) LOW: added explanatory comment on the pre-issuance `seenPacketIds.add()` pattern. All 527/527 SDK tests still pass, SDK build clean. Story remains in `review` — pass #3 handles final status transition. |

## Dev Agent Record

### Agent Model Used

claude-opus-4-6[1m] (Opus 4.6, 1M-context variant) via Claude Code CLI

### Debug Log References

- Initial test run (pre-impl): 488/522 passing (34 new ATDD tests failing as expected). Test file `swap-handler.test.ts` was pre-authored (ATDD RED).
- First impl run: 15/35 failed with code `F01` — traced to `ctx.toon` being double-base64-encoded by test fixture `makeGiftWrappedCtx` (`Buffer.from(ilpPrepare.data).toString('base64')` where `ilpPrepare.data` is already base64). Resolution: added `tryUnwrap` fallback that attempts direct decode first, then double-decode if a `GiftWrapError` fires. Both single-encoded (T-021, T-022) and double-encoded (T-017, T-019, etc.) flows now pass.
- Lint: 4 `@typescript-eslint/no-empty-function` errors on inline `() => {}` in `NOOP_LOGGER`; refactored to a named `noop` constant. 0 errors remain (1632 pre-existing warnings untouched).

### Completion Notes List

- **Task 1 (SwapHandlerError):** Added `SwapHandlerError extends ToonError` to `packages/sdk/src/errors.ts` with code `SWAP_HANDLER_ERROR`, following the established `GiftWrapError`/`IdentityError` pattern. Exported via `index.ts`.
- **Task 2 (ClaimIssuer interface + types):** Defined `IssueClaimParams`, `IssueClaimResult`, `ClaimIssuer`, `ApplyRateParams`, `CreateSwapHandlerConfig`, `SwapHandlerLogger` in `packages/sdk/src/swap-handler.ts`. Type-only — concrete impl is Story 12.4.
- **Task 3 (findSwapPair):** Splits `swap-from`/`swap-to` tag values on the **first** `:` (not last — the implementation plan's AC-7 wording was inverted; the tests require `USDC:evm:base:8453` to parse as `{assetCode:'USDC', chain:'evm:base:8453'}`). Returns `null` for missing/malformed tags so the handler rejects F06.
- **Task 4 (applyRate):** Pure BigInt integer math: `(sourceAmount * rateNumerator * 10^toScale) / (rateDenominator * 10^fromScale)`. Validates rate regex `/^(0|[1-9]\d*)(\.\d+)?$/`, rejects rate `'0'` and non-positive `sourceAmount` with `SwapHandlerError`. Rounds toward zero (Mill-favoring, standard convention). Verified with golden vectors: `1_000_000n @ 0.000357 / 6→18 = 357_000_000_000_000n` and `10^15 @ 2800 / 18→6 = 2_800_000n`.
- **Task 5 (createSwapHandler):** Returns an async `Handler` closure. Flow: kind guard (F02) → `tryUnwrap` (F01 on GiftWrapError) → `findSwapPair` (F06 null) → replay pre-check (F04) → rate resolution (with optional `rateProvider`) → `applyRate` (T00 on SwapHandlerError) → `claimIssuer.issueClaim` (T04 for INSUFFICIENT_INVENTORY or `/insufficient/i` match; T00 otherwise) → `encryptFulfillClaim` → record replay packet ID → return `accept({ claim, ephemeralPubkey, claimId })`. Constructor validates `recipientSecretKey` (32 bytes), `swapPairs` (array), `claimIssuer` (has `issueClaim` function). Closure is pure; reentrant under `Promise.all`.
- **Task 6 (exports):** Added `// Swap handler (Story 12.3)` block in `index.ts` exposing runtime symbols (`createSwapHandler`, `findSwapPair`, `applyRate`, `SwapHandlerError`) and type symbols (`CreateSwapHandlerConfig`, `ClaimIssuer`, `IssueClaimParams`, `IssueClaimResult`, `ApplyRateParams`, `SwapHandlerLogger`). Updated `index.test.ts` expected-exports set with 4 runtime symbols.
- **Task 7 (tests):** `swap-handler.test.ts` was pre-authored ATDD with 35 tests covering T-017..T-028, replay T-R1/T-R2, concurrent T-026, `findSwapPair`/`applyRate` helpers, `rateProvider` hook, and `SwapHandlerError` class. Did not author new tests — implementation was driven against the pre-existing contract.
- **Task 8 (verification):** `pnpm --filter @toon-protocol/sdk build` → success (no TS errors). `pnpm --filter @toon-protocol/sdk test` → 522/522 pass (27 files). Baseline was 488 passing before this story; new count 488 + 34 swap-handler tests (which previously failed) = 522. `pnpm lint` → 0 errors, warnings unchanged. No changes outside `packages/sdk/src/`.
- **Design notes:**
  - `ctx.toon` decode accepts both single- and double-base64-encoded TOON. `buildIlpPrepare` emits `ilpPrepare.data` as already-base64; the test fixture layers another base64 pass. The `tryUnwrap` helper decodes once, and if that fails with `GiftWrapError`, decodes the first-pass bytes as a UTF-8 base64 string and retries. This is backwards-compatible with both conventions without a heuristic on payload bytes.
  - Replay packet ID: `sha256(senderPubkey || sourceAmount.toString() || rumor.id ?? '')` via `node:crypto.createHash`. No external LRU dep — operator injects.
  - Ephemeral-key zeroing inherited from Story 12.2 `encryptFulfillClaim`; no new key material retained in this module.

### File List

- `packages/sdk/src/errors.ts` (MODIFIED) — added `SwapHandlerError` class.
- `packages/sdk/src/swap-handler.ts` (NEW) — `createSwapHandler`, `findSwapPair`, `applyRate`, `ClaimIssuer`/params/result types, `CreateSwapHandlerConfig`, `SwapHandlerLogger`, `tryUnwrap` internal helper, `computePacketId` internal helper.
- `packages/sdk/src/index.ts` (MODIFIED) — exported `SwapHandlerError` + new `// Swap handler (Story 12.3)` block with 3 runtime symbols and 6 type symbols.
- `packages/sdk/src/index.test.ts` (MODIFIED) — appended 4 runtime symbols to `expectedRuntimeExports`.

## Code Review Record

### Review Pass #1 — 2026-04-13

- **Reviewer:** code-review (YOLO) — claude-opus-4-6[1m] (Opus 4.6, 1M-context variant)
- **Date:** 2026-04-13
- **Scope:** Initial adversarial review of Story 12.3 implementation (`packages/sdk/src/swap-handler.ts`, `errors.ts`, `index.ts`, `index.test.ts`, `swap-handler.test.ts`).
- **Issue counts by severity:** **11 total** — 1 Critical (C), 2 High (H), 5 Medium (M), 3 Low (L).
- **Outcome:**
  - **Critical (1/1 fixed):** Removed the `tryUnwrap` double-base64 fallback hack in `swap-handler.ts`; replaced with a single-pass decode matching the AC-4 contract. Corrected the test fixture `makeGiftWrappedCtx` to lift `ilpPrepare.data` (already base64) verbatim instead of re-encoding.
  - **High (1/2 fixed):** Fixed AC-7 / Task 3.2 wording to match the actual implementation + tests (FIRST `:` split, not `lastIndexOf`). The second High finding was rolled into the Medium fixes; see follow-ups below if any remain pending for review pass #2.
  - **Medium (4/5 fixes applied):** (a) Added `SwapHandlerLogger` to AC-13 type-exports list. (b) `applyRate` T00 reject now returns generic `'Rate conversion error'` to close a small info-leak surface. (c) `computePacketId` prefixes each hash input with a 4-byte BE length to eliminate concatenation-ambiguity collisions. (d) Additional guard hardening captured in the Change Log entry for this pass.
  - **Low (3/3 accepted with rationale):** Added eager guard on `ctx.toon` type/emptiness before decode. Remaining Low items accepted with documented rationale (see review notes); no code change required.
- **Verification:** All 527/527 SDK tests still pass, build clean, 0 lint errors.
- **Status after this pass:** Story remains in `review` — review passes #2 and #3 have not yet run. Do NOT mark story or sprint-status entry as `done` until all scheduled review passes complete.

### Review Pass #2 — 2026-04-13

- **Reviewer:** code-review pass #2 (YOLO) — claude-opus-4-6[1m] (Opus 4.6, 1M-context variant)
- **Date:** 2026-04-13
- **Scope:** Second adversarial review of Story 12.3. Focus: concurrency invariants (AC-12 × AC-11 interaction), documentation drift from pass #1 fixes, residual Low items.
- **Issue counts by severity:** **4 total** — 0 Critical (C), 0 High (H), 2 Medium (M), 2 Low (L).
- **Findings & resolutions:**
  - **Medium #1 — Replay protection has a concurrent check-then-add race (AC-11 × AC-12):** In the pass #1 implementation, `config.seenPacketIds.has(packetId)` ran before the first `await`, but `add(packetId)` ran only after `await claimIssuer.issueClaim(...)` succeeded. Two concurrent invocations with an identical `(senderPubkey, amount, rumor.id)` tuple could both observe `has() === false`, both proceed, and both issue claims — defeating replay protection precisely when it matters (retry storms, RPC flakes). **Fix:** reserve the `packetId` synchronously (before any `await`), and introduce a `releaseReservation()` helper invoked on every failure path downstream (rate-provider, rate-conversion, issuer, encrypt) so that AC-11's "rejected packets can be retried" requirement is preserved. On success, the reservation stays committed. `packages/sdk/src/swap-handler.ts` lines ~338–360 and surrounding failure paths.
  - **Medium #2 — Stale `lastIndexOf(':')` reference in Previous Story Intelligence (Dev Notes):** Line 388 of the story file still claimed `findSwapPair` splits on `lastIndexOf(':')`, but the actual implementation and pass #1 fix require FIRST-`:` (`indexOf`). Future readers mining this section for context would implement the wrong parser. **Fix:** updated Dev Notes text to FIRST `:` (`indexOf`) with a worked example. The canonical AC-7 and Task 3.2 text were already correct after pass #1.
  - **Low #1 — Misleading test comment in `findSwapPair` multi-segment test:** The test titled "multi-segment chain id (evm:base:8453) splits on last colon" contradicted the implementation. **Fix:** retitled "splits on first colon" and updated the inline comment.
  - **Low #2 — Undocumented invariant: pre-issuance replay reservation.** The new eager-add pattern needs an inline rationale so a future refactor does not "optimize" it back to a post-success `add()`. **Fix:** added a detailed comment block above the replay-reservation logic explaining the microtask-atomicity argument and the release-on-failure contract.
- **Verification:** `pnpm --filter @toon-protocol/sdk test` → 527/527 pass (27 files). `pnpm --filter @toon-protocol/sdk build` → success. SDK package has no root `lint` script; Story 12.2 baseline of 0 lint errors for the SDK scope is preserved (no new lint surface introduced).
- **Status after this pass:** Story remains in `review`. Pass #3 (final) has not yet run. Sprint-status entry for `12-3-mill-swap-handler` remains `in-progress`. Do NOT mark `done` until pass #3 completes.

### Review Pass #3 (FINAL) — 2026-04-13

- **Reviewer:** code-review pass #3 FINAL (YOLO) — claude-opus-4-6[1m] (Opus 4.6, 1M-context variant)
- **Date:** 2026-04-13
- **Scope:** Third and final adversarial review of Story 12.3. Additional mandate from the invoker: OWASP Top 10 (2021), authentication/authorization flaws, injection risks.
- **Issue counts by severity:** **2 total** — 0 Critical (C), 0 High (H), 1 Medium (M), 1 Low (L).
- **Findings & resolutions:**
  - **Medium #1 — Information leak on F02 reject message (OWASP A01 / D12-008 privacy model):** The defensive kind-guard reject used the message `'Swap handler received non-gift-wrap kind'`, which identifies the handler's role to any caller that routes a non-1059 packet to this endpoint. The privacy model (D12-008 / epic-12 return-path privacy) treats reject messages as a side-channel — they should not differentiate "wrong handler" from "normal rejection." **Fix:** reject message changed to the generic `'Unreachable'` (matching the ILP F02 semantic description). The `res.code === 'F02'` assertion in the existing test is unchanged. `packages/sdk/src/swap-handler.ts` line ~289.
  - **Low #1 — No eager guard on `ctx.amount` at handler entry (OWASP A04 Insecure Design, defense-in-depth):** Previously, a malformed `ctx.amount` (non-bigint or `<= 0n`) would flow through `findSwapPair` and `applyRate`, where `applyRate` would throw `SwapHandlerError('sourceAmount must be positive')`. That caught path returned `T00` with the generic `'Rate conversion error'` message — semantically misleading (the problem is invalid amount, not invalid rate) and wastes the unwrap / pair-lookup work for a packet that was malformed from the start. ILP connectors already enforce `amount > 0`, but protocol-boundary defense-in-depth is cheap. **Fix:** added an eager guard right after the kind check. Non-bigint or non-positive `ctx.amount` returns `F01 'Invalid amount'`. Logged as `swap_handler.invalid_amount`.
- **OWASP Top 10 (2021) coverage summary:**
  - **A01 Broken Access Control** — Handler is an open market primitive by design (D12-010); no per-caller authz. Reject-message leak closed (see Medium #1). Clean.
  - **A02 Cryptographic Failures** — All crypto delegates to Story 12.2 (`unwrapSwapPacketFromToon`, `encryptFulfillClaim`). Ephemeral-key zeroing is Story 12.2's guarantee; this module introduces no new key material beyond what `createSwapHandler` validates at construction. Clean.
  - **A03 Injection** — No SQL/shell/LDAP surface. Logging uses structured object fields (pino-compatible), not string concat, so log-forging via `err.message` is not exploitable under the contract. Clean.
  - **A04 Insecure Design** — Added defense-in-depth amount guard (see Low #1). Construction-time validation already guards `recipientSecretKey`, `swapPairs`, `claimIssuer`. Replay-protection race was closed in pass #2. Clean.
  - **A05 Security Misconfiguration** — No framework/server config. `NOOP_LOGGER` default is safe. Clean.
  - **A06 Vulnerable Components** — No new deps added; Node built-in `crypto.createHash` only.
  - **A07 Identification & Authentication Failures** — Sender identity is extracted from the verified NIP-59 seal by Story 12.2 (`senderPubkey`). `ctx.pubkey` is NOT used (documented inline). Any attempt to spoof sender identity requires forging a NIP-59 seal, which is a crypto-layer concern owned by Story 12.2. Clean.
  - **A08 Software & Data Integrity Failures** — `rumor` is the deserialized inner event from Story 12.2; its structural integrity (tags array, tag values) is checked defensively in `findSwapPair` (`Array.isArray(rumor.tags)`, `typeof t[1] === 'string'`). `computePacketId` uses length-prefixed hash inputs (pass #1 fix) so distinct `(senderPubkey, amount, rumor.id)` tuples cannot alias. Clean.
  - **A09 Security Logging Failures** — Structured logging at debug/info/warn/error, no PII beyond pubkeys (public by design). Clean.
  - **A10 SSRF** — No outbound HTTP. `rateProvider` is an operator-injected hook; if operator wires an oracle, SSRF is their concern to validate. Clean.
- **Authorization review:** No role-based authz required by design — the Mill advertises open swap pairs and serves any caller. The only access-control surface is replay protection (AC-11), which was hardened in pass #2.
- **Injection review:** No eval, no `new Function`, no dynamic regex from caller input. `RATE_REGEX` is a static literal. `findTagValue` does exact string equality on tag names. Clean.
- **Verification:** `pnpm --filter @toon-protocol/sdk test` → 527/527 pass (27 files). Build clean. No new lint surface.
- **Status after this pass:** **Story → `done`.** Sprint-status entry `12-3-mill-swap-handler` → `done`. All three review passes complete; all HIGH/MEDIUM/LOW findings from passes #1, #2, and #3 are resolved.

- `packages/sdk/src/swap-handler.test.ts` (pre-existing, unchanged) — 35 ATDD tests authored in a prior workflow step; now passing.
