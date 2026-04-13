# Story 12.2: NIP-59 Gift Wrap Integration for ILP Packets

Status: done
ui_impact: false
epic: 12
story_id: 12-2

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Adversarial review 2026-04-13: Fixed 8 issues: (1) nostr-tools version ^2.23.1 corrected to ^2.20.0 matching actual package.json; (2) GiftWrapError now extends ToonError with error code + cause param per SDK error pattern; (3) AC-3 buildIlpPrepare params corrected — amount: bigint not string, no condition/executionCondition param, returns IlpPreparePacket not Buffer; (4) NIP-59 timestamp randomization corrected from "+/- 48 hours" to past-only subtract 0-172800s across AC-1/AC-9/Task 6.6/Dev Notes; (5) T-014 test description updated for base64 data extraction from IlpPreparePacket; (6) Task 6.4 updated for corrected roundtrip flow; (7) project-context.md version discrepancy noted in References; (8) Convenience test description corrected from Buffer to IlpPreparePacket. All source-of-truth claims verified against packages/sdk/src/errors.ts, packages/core/src/x402/build-ilp-prepare.ts, packages/sdk/package.json, and packages/core/src/toon/index.ts. -->

## Story

As a TOON Protocol developer building the Token Swap Primitive (Epic 12),
I want NIP-59 gift wrap encoding and decoding functions for ILP swap packets in `@toon-protocol/sdk`,
so that swap clients can construct privacy-preserving ILP packets where intermediary peers cannot determine the sender identity, event kind, or swap metadata — and the destination Mill can unwrap to recover the original rumor and sender pubkey for claim issuance.

This is the privacy primitive story for Epic 12. Story 12.1 (done) established `SwapPair` types and kind:10032 serialization. This story provides the NIP-59 gift wrap encode/decode layer that all downstream stories depend on: Story 12.3 (Mill handler) needs unwrap on the receive side, Story 12.5 (`streamSwap()`) needs wrap on the send side. Without this story, swap packets travel in cleartext — intermediaries can see the swap intent, breaking the core privacy guarantee (D12-003).

## Dependencies

- **Upstream:** Story 12.1 (`SwapPair` type, kind:10032 serialization) — DONE. Provides the `SwapPair` type for swap context.
- **Upstream:** `nostr-tools` ^2.20.0 — already a dependency of `@toon-protocol/sdk` (see `packages/sdk/package.json` line 57). Provides `nip44` (XChaCha20-Poly1305 encryption) and `nip59` (gift wrap) primitives. The `nip59` module provides `wrapEvent()` and `unwrapEvent()` functions, and `nip44` provides `encrypt()`/`decrypt()` with conversation key derivation. (Note: project-context.md says ^2.23.1 — the actual installed range is ^2.20.0; both resolve to 2.x which is the mandatory constraint.)
- **Upstream:** `@toon-protocol/core/toon` — provides `encodeEventToToon()` and `decodeEventFromToon()` for TOON binary encoding of wrapped events.
- **Upstream:** `@toon-protocol/core` — provides `buildIlpPrepare()` for ILP packet construction.
- **Downstream:** Story 12.3 (Mill swap handler) — will call the unwrap function to extract rumor + sender pubkey from incoming ILP packets.
- **Downstream:** Story 12.5 (`streamSwap()` client API) — will call the wrap function to gift-wrap each outbound swap packet.
- **Downstream:** Story 12.8 (E2E integration) — validates the full wrap→route→unwrap→FULFILL cycle.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Non-custodial, privacy-preserving token swaps via existing ILP micropayment infrastructure. Swap-capable peers advertise supported token pairs via an optional `swapPairs` field on `IlpPeerInfo` (kind:10032); clients send NIP-59 gift-wrapped ILP packets carrying value in the source asset; Mill returns signed payment-channel claims in the target asset via the ILP FULFILL data field. Sender controls packet granularity.

Relevant design decisions from `_bmad-output/epics/epic-12-token-swap-primitive.md`:

- **D12-003:** NIP-59 gift-wrapped swap packets. All swap packets MUST be NIP-59 gift-wrapped to prevent information leakage. Each packet uses a fresh ephemeral key. Intermediary peers routing the ILP packet see opaque TOON-encoded binary in the data field — they cannot determine the event kind, sender identity, or swap intent. Only the destination Mill unwraps and processes.
- **D12-008:** FULFILL claims are NIP-44 encrypted with an ephemeral key. The Mill generates a fresh ephemeral keypair per FULFILL. The signed claim is NIP-44 encrypted using the ephemeral privkey and sender pubkey. The ephemeral pubkey is included alongside the ciphertext so the sender can decrypt. This completes the privacy model: NIP-59 gift wrap (ephemeral sender) hides the forward path, ephemeral-key NIP-44 encryption hides the return path.
- **D12-009:** No connector modifications required. Standard ILP routing delivers packets to the Mill — the connector's forwarding logic, accounting, and settlement infrastructure remain untouched.

## Acceptance Criteria

1. **AC-1 — `wrapSwapPacket()` function.** Create and export a `wrapSwapPacket()` function in `packages/sdk/src/gift-wrap.ts` that:
   - Takes: `{ rumor: UnsignedEvent, senderSecretKey: Uint8Array, recipientPubkey: string }` where `rumor` is the unsigned inner event (swap metadata), `senderSecretKey` is the sender's secp256k1 secret key, and `recipientPubkey` is the Mill's compressed hex pubkey (64 chars).
   - Returns: `{ giftWrap: Event, ephemeralPubkey: string }` — a fully-formed kind:1059 event signed by a fresh ephemeral key, plus the ephemeral pubkey used.
   - Internally performs the NIP-59 three-layer construction:
     1. **Rumor** (unsigned inner event): the `rumor` parameter as-is. No `sig` field, no `id` field.
     2. **Seal** (kind:1060): NIP-44 encrypt the rumor JSON using `ECDH(senderSecretKey, recipientPubkey)`. Signed by the sender's real key. `created_at` randomized per NIP-59 spec (subtract 0–172800 seconds from real time — past-only, never future).
     3. **Gift wrap** (kind:1059): Generate a fresh ephemeral secp256k1 keypair. NIP-44 encrypt the seal JSON using `ECDH(ephemeralPrivkey, recipientPubkey)`. Signed by the ephemeral key. `created_at` randomized (subtract 0–172800 seconds — past-only). `p` tag contains `recipientPubkey`.
   - Uses `nostr-tools` NIP-44 and NIP-59 primitives — do NOT reimplement crypto.
   - Each invocation MUST generate a fresh ephemeral keypair (critical for forward secrecy and message unlinkability — risk R-006).

2. **AC-2 — `unwrapSwapPacket()` function.** Create and export an `unwrapSwapPacket()` function in `packages/sdk/src/gift-wrap.ts` that:
   - Takes: `{ giftWrap: Event, recipientSecretKey: Uint8Array }` where `giftWrap` is a kind:1059 event and `recipientSecretKey` is the Mill's secret key.
   - Returns: `{ rumor: UnsignedEvent, senderPubkey: string }` — the decrypted inner rumor and the sender's real pubkey (extracted from the seal layer).
   - Internally performs:
     1. Verify `giftWrap.kind === 1059`, throw `GiftWrapError('Expected kind:1059 gift wrap')` otherwise.
     2. Decrypt the gift wrap layer using `ECDH(recipientSecretKey, giftWrap.pubkey)` to recover the seal (kind:1060).
     3. Extract `senderPubkey` from the seal's `pubkey` field.
     4. Decrypt the seal using `ECDH(recipientSecretKey, senderPubkey)` to recover the rumor.
     5. Return `{ rumor, senderPubkey }`.
   - Throws `GiftWrapError` with descriptive messages on any decryption failure, malformed structure, or unexpected kind.

3. **AC-3 — `wrapSwapPacketToToon()` convenience function.** Create and export a higher-level function that combines gift wrapping with TOON binary encoding and ILP PREPARE construction:
   - Takes: `{ rumor: UnsignedEvent, senderSecretKey: Uint8Array, recipientPubkey: string, destination: string, amount: bigint, expiresAt?: Date }` — the rumor to wrap plus ILP PREPARE parameters. Note: `amount` is `bigint` per `BuildIlpPrepareParams`; `expiresAt` is optional (defaults to 30s from now inside `buildIlpPrepare`).
   - Returns: `{ ilpPrepare: IlpPreparePacket, ephemeralPubkey: string }` — a ready-to-send ILP PREPARE packet (with `destination: string`, `amount: string`, `data: string` base64 fields) containing the gift-wrapped TOON binary as the data field.
   - Internally: `wrapSwapPacket()` → `encodeEventToToon(giftWrap)` → `buildIlpPrepare({ destination, amount, expiresAt, data: toonBinary })`. Note: `buildIlpPrepare` (from `@toon-protocol/core`) does NOT accept `executionCondition` or `condition` — it takes `{ destination, amount: bigint, data: Uint8Array, expiresAt?: Date }` and returns `IlpPreparePacket` with base64-encoded data string.
   - This is the convenience path that `streamSwap()` (Story 12.5) will use in its per-packet loop.

4. **AC-4 — `unwrapSwapPacketFromToon()` convenience function.** Create and export a higher-level function that combines TOON binary decoding with gift wrap unwrapping:
   - Takes: `{ toonData: Uint8Array, recipientSecretKey: Uint8Array }` — the data field from an incoming ILP PREPARE.
   - Returns: `{ rumor: UnsignedEvent, senderPubkey: string }`.
   - Internally: `decodeEventFromToon(toonData)` → `unwrapSwapPacket({ giftWrap: decodedEvent, recipientSecretKey })`.
   - This is the convenience path that the Mill handler (Story 12.3) will use to process incoming swap packets.

5. **AC-5 — `encryptFulfillClaim()` function.** Create and export a function for the return-path privacy (D12-008):
   - Takes: `{ claimData: Uint8Array, senderPubkey: string }` — the signed claim bytes and the original sender's pubkey (recovered from unwrap).
   - Returns: `{ ciphertext: Uint8Array, ephemeralPubkey: string }` — NIP-44 encrypted claim plus the Mill's ephemeral pubkey.
   - Internally: Generate a fresh ephemeral keypair. NIP-44 encrypt `claimData` using `ECDH(ephemeralPrivkey, senderPubkey)`. Return ciphertext and ephemeral pubkey. Discard ephemeral privkey (scope the variable so it cannot be accessed after the function returns).
   - The Mill includes both `ciphertext` and `ephemeralPubkey` in the ILP FULFILL data field.

6. **AC-6 — `decryptFulfillClaim()` function.** Create and export the sender-side decryption counterpart:
   - Takes: `{ ciphertext: Uint8Array, ephemeralPubkey: string, recipientSecretKey: Uint8Array }` — the FULFILL data components and the sender's secret key.
   - Returns: `Uint8Array` — the decrypted signed claim bytes.
   - Internally: NIP-44 decrypt using `ECDH(recipientSecretKey, ephemeralPubkey)`.
   - Throws `GiftWrapError` on decryption failure.

7. **AC-7 — `GiftWrapError` class.** Create a new error class in `packages/sdk/src/errors.ts` following the existing SDK error pattern (all SDK errors extend `ToonError` from `@toon-protocol/core` with a string error code and optional `cause`):
   ```ts
   export class GiftWrapError extends ToonError {
     constructor(message: string, cause?: Error) {
       super(message, 'GIFT_WRAP_ERROR', cause);
       this.name = 'GiftWrapError';
     }
   }
   ```
   This follows the pattern established by `IdentityError`, `NodeError`, `HandlerError`, `VerificationError`, and `PricingError` in the same file. Export from `packages/sdk/src/index.ts` alongside existing error classes.

8. **AC-8 — Package exports.** Export all new functions and types from `packages/sdk/src/index.ts`:
   - `wrapSwapPacket`, `unwrapSwapPacket` (core primitives)
   - `wrapSwapPacketToToon`, `unwrapSwapPacketFromToon` (convenience wrappers)
   - `encryptFulfillClaim`, `decryptFulfillClaim` (FULFILL privacy)
   - `GiftWrapError` (error class)
   - Type exports for all input/output parameter shapes.

9. **AC-9 — Unit tests (>= 16 tests).** Create `packages/sdk/src/gift-wrap.test.ts` with coverage including (mapping to test-design-epic-12 T-009..T-016):
   - **(T-009) Gift-wrap construction:** `wrapSwapPacket()` produces kind:1059 outer event; inner seal is kind:1060; rumor is unsigned (no `sig`, no `id`).
   - **(T-010) Unwrap at destination:** `unwrapSwapPacket()` recovers original rumor content and sender pubkey from a wrapped packet.
   - **(T-011) Ephemeral key uniqueness:** 100 consecutive calls to `wrapSwapPacket()` with the same inputs produce 100 distinct ephemeral pubkeys. Statistical test — risk R-006.
   - **(T-012) Intermediary cannot extract sender identity:** Given only the kind:1059 outer event and a third-party secret key (not the recipient), no API path reveals the sender pubkey. Decrypt attempt fails.
   - **(T-013) Intermediary cannot determine event kind:** The outer event data field is opaque to a non-recipient. Attempting to parse the encrypted content fails or returns gibberish.
   - **(T-014) TOON binary roundtrip:** `wrapSwapPacketToToon()` → extract base64 data string from `IlpPreparePacket` → decode base64 to `Uint8Array` → `unwrapSwapPacketFromToon()` → recovered rumor matches original.
   - **(T-015) Wrong recipient rejects:** `unwrapSwapPacket()` with a different secret key (not the intended recipient) throws `GiftWrapError`.
   - **(T-016) Timestamp randomization:** The `created_at` on the gift wrap outer event is <= current system time and differs from real time in at least some invocations (NIP-59 subtracts 0–172800 seconds — past-only randomization).
   - **FULFILL encryption roundtrip:** `encryptFulfillClaim()` → `decryptFulfillClaim()` with matching keys recovers original claim bytes.
   - **FULFILL ephemeral key uniqueness:** Multiple calls to `encryptFulfillClaim()` produce distinct ephemeral pubkeys.
   - **FULFILL wrong key rejects:** `decryptFulfillClaim()` with wrong secret key throws `GiftWrapError`.
   - **Invalid gift wrap kind:** `unwrapSwapPacket()` with a non-1059 event throws `GiftWrapError('Expected kind:1059 gift wrap')`.
   - **Malformed gift wrap content:** `unwrapSwapPacket()` with garbled content (not valid NIP-44 ciphertext) throws `GiftWrapError`.
   - **Convenience function integration:** `wrapSwapPacketToToon()` returns a valid `IlpPreparePacket` with base64-encoded data; `unwrapSwapPacketFromToon()` correctly chains TOON decode + unwrap.
   - **Empty rumor content:** Wrapping a rumor with empty `content` field works correctly (edge case — some swap metadata may be minimal).
   - **Large rumor content:** Wrapping a rumor with content > 1 KB works correctly (NIP-44 padding handles size).

10. **AC-10 — Build, lint, test verification.** After all changes:
    - `pnpm --filter @toon-protocol/sdk build` compiles cleanly with no TypeScript errors.
    - `pnpm --filter @toon-protocol/sdk test` passes — all new tests pass; all pre-existing tests still pass (no regressions).
    - `pnpm lint` passes for the `packages/sdk` scope.
    - No changes to `@toon-protocol/core` or other packages are required — this story is self-contained in `@toon-protocol/sdk`.

## Tasks / Subtasks

- [x] **Task 1: Create `GiftWrapError` class** (AC: 7)
  - [x] 1.1 Add `GiftWrapError` class to `packages/sdk/src/errors.ts` following the existing error class pattern (`IdentityError`, `NodeError`, `HandlerError`, `VerificationError`, `PricingError`).
  - [x] 1.2 Export `GiftWrapError` from `packages/sdk/src/index.ts` in the error classes export block.

- [x] **Task 2: Create `gift-wrap.ts` with core wrap/unwrap functions** (AC: 1, 2)
  - [x] 2.1 Create `packages/sdk/src/gift-wrap.ts`.
  - [x] 2.2 Implement `wrapSwapPacket()` using `nostr-tools` NIP-44 and NIP-59 primitives. Use `import { nip44 } from 'nostr-tools'` and `import { nip59 } from 'nostr-tools'` (or the specific subpath exports if nostr-tools uses them). Check the actual `nostr-tools` API — it may expose `wrapEvent` / `unwrapEvent` directly from `nip59`, or require manual seal+wrap construction. If `nostr-tools/nip59` does not provide a usable `wrapEvent()`, construct the three layers manually using `nip44.encrypt()` and `generateSecretKey()`/`getPublicKey()` from nostr-tools.
  - [x] 2.3 Implement `unwrapSwapPacket()` — the reverse of wrap. Decrypt gift wrap layer → extract seal → decrypt seal → extract rumor + sender pubkey.
  - [x] 2.4 Ensure ephemeral keypair generation uses `generateSecretKey()` from `nostr-tools/pure` (NOT from `@noble/curves` directly — stay consistent with the nostr-tools cryptographic stack used throughout the project).
  - [x] 2.5 Verify ephemeral privkey is let-scoped (not module-level or closured) so it is garbage-collected after function return.

- [x] **Task 3: Create convenience wrappers for TOON + ILP integration** (AC: 3, 4)
  - [x] 3.1 Implement `wrapSwapPacketToToon()` — chains `wrapSwapPacket()` → `encodeEventToToon()` → `buildIlpPrepare()`.
  - [x] 3.2 Implement `unwrapSwapPacketFromToon()` — chains `decodeEventFromToon()` → `unwrapSwapPacket()`.
  - [x] 3.3 Import `encodeEventToToon` and `decodeEventFromToon` from `@toon-protocol/core/toon` (sub-path export — see project-context.md "Core Sub-Path Exports").
  - [x] 3.4 Import `buildIlpPrepare` from `@toon-protocol/core` (already used throughout the codebase — see `packages/core/src/x402/build-ilp-prepare.test.ts` for the existing API shape).

- [x] **Task 4: Create FULFILL encryption/decryption functions** (AC: 5, 6)
  - [x] 4.1 Implement `encryptFulfillClaim()` — generate ephemeral keypair, NIP-44 encrypt claim bytes with `ECDH(ephemeralPrivkey, senderPubkey)`, return `{ ciphertext, ephemeralPubkey }`.
  - [x] 4.2 Implement `decryptFulfillClaim()` — NIP-44 decrypt using `ECDH(recipientSecretKey, ephemeralPubkey)`, return claim bytes.
  - [x] 4.3 Ensure ephemeral privkey in `encryptFulfillClaim` is let-scoped and not retained.

- [x] **Task 5: Package exports** (AC: 8)
  - [x] 5.1 Add all new function exports to `packages/sdk/src/index.ts` in a new `// Gift wrap (Story 12.2)` section.
  - [x] 5.2 Add type exports for input/output parameter shapes (e.g., `WrapSwapPacketParams`, `UnwrapSwapPacketResult`, etc.).

- [x] **Task 6: Unit tests** (AC: 9)
  - [x] 6.1 Create `packages/sdk/src/gift-wrap.test.ts`.
  - [x] 6.2 Implement all test scenarios from AC-9 (T-009 through T-016 plus FULFILL and edge cases).
  - [x] 6.3 Use `generateSecretKey()` and `getPublicKey()` from nostr-tools for test key generation.
  - [x] 6.4 For the TOON roundtrip test (T-014), use `wrapSwapPacketToToon()` which returns `IlpPreparePacket` (with base64 `data` string). Decode the base64 `data` field back to `Uint8Array` and pass to `unwrapSwapPacketFromToon()` to verify the full roundtrip.
  - [x] 6.5 For the ephemeral key uniqueness test (T-011), generate 100 wraps in a loop and assert all ephemeral pubkeys are unique (use a `Set`).
  - [x] 6.6 For timestamp randomization (T-016), assert `giftWrap.created_at <= Math.floor(Date.now() / 1000)` (NIP-59 subtracts 0–172800 seconds, so timestamps are always in the past or at most equal to current time). Run multiple wraps and assert at least some `created_at` values differ from current time (variance test).

- [x] **Task 7: Build + lint + test verification** (AC: 10)
  - [x] 7.1 `pnpm --filter @toon-protocol/sdk build` — exit 0.
  - [x] 7.2 `pnpm --filter @toon-protocol/sdk test` — all new tests pass; no regressions in existing tests.
  - [x] 7.3 `pnpm lint` — 0 errors for `packages/sdk` scope.
  - [x] 7.4 No downstream package changes required — story is self-contained in `packages/sdk`.

## Dev Notes

### nostr-tools NIP-59 API

The `nostr-tools` library (^2.20.0) is already a dependency of `@toon-protocol/sdk` (see `packages/sdk/package.json` line 57). Check the actual API surface before implementing:

```ts
// Option A: nostr-tools exposes high-level wrapEvent/unwrapEvent
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip59';

// Option B: Build manually using nip44 encrypt/decrypt
import { encrypt, decrypt } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
```

If nostr-tools' `nip59` module provides `wrapEvent(rumor, senderSecret, recipientPubkey)` that handles the three-layer construction (rumor → seal → gift wrap) including ephemeral key generation and timestamp randomization, **use it directly**. Do not reimplement what the library already provides. If the library's API does not match the exact needs (e.g., it doesn't return the ephemeral pubkey separately), wrap the library call and extract what's needed from the returned event.

### NIP-59 Three-Layer Architecture (Reference)

From `_bmad-output/planning-artifacts/research/nip59-mina-privacy-analysis-2026-03-30.md`:

- **Layer 1 — Rumor (Inner Event):** Unsigned, no `sig` or `id`. Contains the actual swap metadata.
- **Layer 2 — Seal (kind:1060):** NIP-44 encrypted with `ECDH(sender_privkey, recipient_pubkey)`. Signed by sender's real key. `created_at` randomized (subtract 0–172800 seconds, i.e., up to 48 hours in the past — never future).
- **Layer 3 — Gift Wrap (kind:1059):** Fresh ephemeral keypair per message. NIP-44 encrypted with `ECDH(ephemeral_privkey, recipient_pubkey)`. Signed by ephemeral key. `created_at` randomized. `p` tag contains recipient pubkey.

### Privacy Invariants (MUST be preserved)

These are the core privacy properties from D12-003 and D12-008 that tests must verify:

1. **Sender identity hidden:** Intermediaries see only the ephemeral pubkey on the kind:1059 event. The real sender pubkey is encrypted inside the seal, which is encrypted inside the gift wrap.
2. **Message unlinkability:** Each packet uses a unique ephemeral keypair. N packets from the same sender produce N distinct ephemeral pubkeys. No correlation possible without the recipient's private key.
3. **Content hiding:** The swap metadata (rumor content) is protected by two layers of NIP-44 encryption (seal + gift wrap). XChaCha20-Poly1305 with power-of-2 padding.
4. **Return-path privacy:** FULFILL claims are NIP-44 encrypted with a fresh Mill ephemeral key. Intermediaries on the return path see ephemeral pubkey + opaque ciphertext.
5. **Deniability:** The rumor is unsigned — the Mill holds the content but cannot produce a cryptographic proof that the sender authored it.

### TOON Binary Encoding

The gift-wrapped event is encoded to TOON binary format before being placed in the ILP PREPARE data field. Use the existing codec:

```ts
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/core/toon';
```

This is a sub-path export — import from `@toon-protocol/core/toon`, NOT from `@toon-protocol/core` directly. See `packages/core/src/toon/index.ts` for the exported functions.

### ILP PREPARE Construction

Use the existing `buildIlpPrepare()` from `@toon-protocol/core`:

```ts
import { buildIlpPrepare } from '@toon-protocol/core';
```

See `packages/core/src/x402/build-ilp-prepare.test.ts` for the API shape and usage examples.

### NIP-44 for FULFILL Claims (D12-008)

The FULFILL encryption is NOT NIP-59 (three-layer gift wrap). It is a single layer of NIP-44 encryption with an ephemeral key:
- Mill generates ephemeral keypair
- Encrypts claim data: `nip44.encrypt(ephemeralPrivkey, senderPubkey, claimBytes)`
- Returns `{ ciphertext, ephemeralPubkey }` in the FULFILL data field
- Sender decrypts: `nip44.decrypt(senderSecretKey, ephemeralPubkey, ciphertext)`

This is simpler than full NIP-59 gift wrap because the FULFILL response does not need the three-layer deniability model — it just needs to be opaque to intermediaries on the return path.

### Connector NIP-59 Precedent

The connector already has NIP-59 configuration support (see `packages/sdk/src/create-node.ts` line 201: `nip59?: { enabled: boolean }`). This is for per-packet claim transport privacy (the connector's own NIP-59 usage, separate from swap packet wrapping). The swap gift wrap functions in this story are independent — they operate at the application layer above the connector, not inside the connector's routing logic (D12-009).

### What NOT to do in this story

- Do NOT modify any connector routing logic. Gift wrapping is application-layer, not routing-layer (D12-009).
- Do NOT implement the Mill swap handler. That's Story 12.3.
- Do NOT implement `streamSwap()`. That's Story 12.5.
- Do NOT implement rate application or claim issuance. That's Story 12.3.
- Do NOT add `packages/mill/` package scaffold. That's Story 12.7.
- Do NOT modify `@toon-protocol/core`. This story is self-contained in `@toon-protocol/sdk`.
- Do NOT reimplement NIP-44 or NIP-59 crypto. Use `nostr-tools` primitives.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does not create or modify GitHub Actions workflows. No action needed.
- **MAX_SAFE_INTEGER guard:** Does not apply directly — this story handles binary data and string keys, not numeric values that could exceed safe integer range.
- **Golden test vectors (ZK story pairs):** Does not apply — this story has no ZK circuit counterpart.

### Project Structure Notes

- All changes live in `packages/sdk/`. No workspace dependency changes (nostr-tools is already a dep).
- New file: `packages/sdk/src/gift-wrap.ts` (+ `.test.ts`).
- Modified files: `packages/sdk/src/errors.ts` (add `GiftWrapError`), `packages/sdk/src/index.ts` (add exports).
- No changes to `packages/core/`, `packages/town/`, or any other package.
- Test file co-located with source: `packages/sdk/src/gift-wrap.test.ts` alongside `packages/sdk/src/gift-wrap.ts`.

### References

- [Source: `_bmad-output/epics/epic-12-token-swap-primitive.md`] — epic goal, design decisions D12-003, D12-008, D12-009; swap flow architecture (lines 49-87); privacy properties table (lines 89-97).
- [Source: `_bmad-output/planning-artifacts/test-design-epic-12.md#Story 12-2`] — P0/P1/P2 test scenarios T-009..T-016; risks R-001, R-006, R-016; quality gate "NIP-59 privacy invariant".
- [Source: `_bmad-output/planning-artifacts/research/nip59-mina-privacy-analysis-2026-03-30.md`] — NIP-59 three-layer architecture deep-dive, privacy properties analysis, deniability model.
- [Source: `packages/sdk/src/create-node.ts` line 201] — existing `nip59` config on `NodeConfig` (connector-level NIP-59, separate from this story's application-level gift wrap).
- [Source: `packages/sdk/src/index.ts`] — current SDK public API exports; `packages/sdk/src/errors.ts` — existing error class patterns.
- [Source: `packages/core/src/toon/index.ts`] — `encodeEventToToon()`, `decodeEventFromToon()` codec functions.
- [Source: `packages/core/src/x402/build-ilp-prepare.test.ts`] — `buildIlpPrepare()` API shape and usage examples.
- [Source: `_bmad-output/project-context.md`] — nostr-tools version constraint (must stay 2.x; project-context says ^2.23.1 but actual SDK package.json has ^2.20.0), package dependency graph, SDK structure.

### Previous Story Intelligence

**Story 12.1 (SwapPair type + kind:10032 serialization) — DONE:**

- Established the `SwapPair` type in `packages/core/src/types.ts` and optional `swapPairs` field on `IlpPeerInfo`.
- Created shared validation helper pattern in `packages/core/src/events/swap-pair-validation.ts` — dual asserter pattern (`assertSwapPairForBuild` throws `ToonError`, `assertSwapPairForParse` throws `InvalidEventError`). This pattern is a good reference but does NOT apply to this story (we have a single `GiftWrapError` for both wrap and unwrap failures).
- Extracted `validateChainId` to `packages/core/src/chain/chain-id.ts` to resolve circular-import issue. No similar concern for this story since all new code is in `packages/sdk/` importing from `@toon-protocol/core`.
- Code review pass #2 found that `isObject` was accepting arrays — added explicit `Array.isArray` guard. Lesson: always guard structural type checks against arrays.
- Code review pass #3 added BigInt DoS guard (`MAX_NUMERIC_STRING_LENGTH=80`) on numeric strings. Lesson: consider pathological inputs for any user-controlled data that feeds into crypto or BigInt operations.
- Total: 63 swap-pair tests (41 validation + 10 builder + 12 parser). All 2418 core tests green. Zero lint errors.

**Files created/modified by Story 12.1:**
- `packages/core/src/chain/chain-id.ts` (NEW)
- `packages/core/src/events/swap-pair-validation.ts` (NEW + test)
- `packages/core/src/types.ts` — `SwapPair` interface, `IlpPeerInfo.swapPairs` field
- `packages/core/src/index.ts` — exported `SwapPair` type
- `packages/core/src/events/builders.ts` — swapPairs validation in builder
- `packages/core/src/events/parsers.ts` — swapPairs deserialization in parser

## Story Completion Status

Created: 2026-04-13
Created by: create-story workflow (bmad-bmm)
Sprint-status entry: added as `12-2-nip59-gift-wrap-integration-for-ilp-packets: ready-for-dev` under epic-12.

## Change Log

| Date | Author | Change |
| --- | --- | --- |
| 2026-04-13 | create-story workflow | Initial draft — ACs, tasks, dev notes, previous story intelligence |
| 2026-04-13 | adversarial review | Fixed 8 issues: nostr-tools version, GiftWrapError pattern, AC-3 buildIlpPrepare API mismatch, NIP-59 timestamp direction, T-014/Task 6.4 roundtrip flow, project-context version note, convenience test description |
| 2026-04-13 | dev agent (Claude Opus 4.6) | Implemented Story 12.2: GiftWrapError in errors.ts, 6 functions in gift-wrap.ts (wrapSwapPacket, unwrapSwapPacket, wrapSwapPacketToToon, unwrapSwapPacketFromToon, encryptFulfillClaim, decryptFulfillClaim), barrel exports in index.ts, updated index.test.ts expected exports. All 469 SDK tests pass, build clean, 0 regressions. |
| 2026-04-13 | code review #1 (Claude Opus 4.6) | Review pass #1: 0 critical, 0 high, 2 medium, 2 low — all 4 issues fixed. Medium: (1) added input validation on pubkey/secretkey params, (2) fixed misleading test description. Low: (1) added @throws JSDoc annotations, (2) added conversation key zeroing in finally block. |
| 2026-04-13 | code review #2 (Claude Opus 4.6) | Review pass #2: 0 critical, 0 high, 2 medium, 2 low — all 4 issues fixed. Medium: (1) unwrapSwapPacket leaked ECDH conversation keys — added zeroing in finally block, (2) decryptFulfillClaim leaked conversation key — added zeroing in finally block. Low: (1) encryptFulfillClaim had no explicit empty claim data validation — added check, (2) updated test to match improved error message. |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- all tests passed on first run.

### Completion Notes List

- **Task 1 (GiftWrapError):** Added `GiftWrapError` class to `packages/sdk/src/errors.ts` extending `ToonError` with code `'GIFT_WRAP_ERROR'` and optional `cause`, following the existing error hierarchy pattern. Exported from `packages/sdk/src/index.ts`.
- **Task 2 (Core wrap/unwrap):** Created `packages/sdk/src/gift-wrap.ts` with `wrapSwapPacket()` and `unwrapSwapPacket()`. Used nostr-tools `createRumor`, `createSeal`, `createWrap` building blocks (rather than the high-level `wrapEvent`) to capture the ephemeral pubkey from the gift wrap event. For unwrap, manually decrypted both layers using `nip44.decrypt` + `getConversationKey` to extract the sender pubkey from the seal's pubkey field (since nostr-tools' `unwrapEvent` does not expose it).
- **Task 3 (Convenience wrappers):** Implemented `wrapSwapPacketToToon()` chaining wrap -> `encodeEventToToon` -> `buildIlpPrepare`, and `unwrapSwapPacketFromToon()` chaining `decodeEventFromToon` -> unwrap. Imported TOON codec from `@toon-protocol/core/toon` sub-path and `buildIlpPrepare` from `@toon-protocol/core`.
- **Task 4 (FULFILL encryption):** Implemented `encryptFulfillClaim()` and `decryptFulfillClaim()` using NIP-44 encryption with fresh ephemeral keypairs. Claim bytes are base64-encoded for NIP-44 string-based encrypt/decrypt, then converted back on decryption. Ephemeral privkey is let-scoped and nulled after use.
- **Task 5 (Package exports):** Added all 6 functions + `GiftWrapError` + 10 type exports to `packages/sdk/src/index.ts`. Updated `index.test.ts` expected runtime exports set to include the 7 new runtime symbols.
- **Task 6 (Tests):** Pre-existing ATDD test file `packages/sdk/src/gift-wrap.test.ts` with 22 tests covering T-009 through T-016, FULFILL roundtrip/uniqueness/rejection, and edge cases (empty content, large content). All 22 tests pass.
- **Task 7 (Verification):** `pnpm --filter @toon-protocol/sdk build` exits 0. `pnpm --filter @toon-protocol/sdk test` passes all 469 tests (22 new + 447 existing, 0 regressions). No changes to `@toon-protocol/core` or other packages.

### File List

- `packages/sdk/src/gift-wrap.ts` — NEW: NIP-59 gift wrap and NIP-44 FULFILL encryption functions
- `packages/sdk/src/errors.ts` — MODIFIED: Added `GiftWrapError` class
- `packages/sdk/src/index.ts` — MODIFIED: Added gift wrap function/type exports and `GiftWrapError`
- `packages/sdk/src/index.test.ts` — MODIFIED: Added 7 new runtime symbols to expected exports set

## Code Review Record

### Review Pass #1

- **Date:** 2026-04-13
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Issue counts:** 0 critical, 0 high, 2 medium, 2 low (4 total)
- **All issues fixed:** Yes
- **Outcome:** PASS

#### Issues Found & Fixed

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| 1 | Medium | No input validation on pubkey/secretkey params | Added validators |
| 2 | Medium | Misleading test description | Fixed test description |
| 3 | Low | Missing @throws JSDoc annotations | Added @throws annotations |
| 4 | Low | Conversation key not zeroed after use | Added zeroing in finally block |

### Review Pass #2

- **Date:** 2026-04-13
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Issue counts:** 0 critical, 0 high, 2 medium, 2 low (4 total)
- **All issues fixed:** Yes
- **Outcome:** PASS

#### Issues Found & Fixed

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| 1 | Medium | `unwrapSwapPacket` leaked ECDH conversation keys | Added zeroing in finally block |
| 2 | Medium | `decryptFulfillClaim` leaked conversation key | Added zeroing in finally block |
| 3 | Low | `encryptFulfillClaim` had no explicit empty claim data validation | Added check |
| 4 | Low | Updated test to match improved error message | Fixed test assertion |

### Review Pass #3 (Final)

- **Date:** 2026-04-13
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Issue counts:** 0 critical, 0 high, 1 medium, 4 low (5 total)
- **All issues fixed:** Yes
- **OWASP top 10 review:** Clean
- **Previous review fixes verified:** All integrated
- **Tests:** All 40 pass
- **Outcome:** PASS (final)

#### Issues Found & Fixed

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| 1 | Medium | Unvalidated seal.pubkey from decrypted JSON used in ECDH | Added validatePubkey() call |
| 2 | Low | Missing instanceof Uint8Array check on claimData | Added type guard |
| 3 | Low | Missing instanceof Uint8Array + empty check on ciphertext | Added type guard + empty check |
| 4 | Low | Missing null/object guard on giftWrap param | Added null/object guard |
| 5 | Low | Missing instanceof Uint8Array + empty check on toonData | Added type guard + empty check |
