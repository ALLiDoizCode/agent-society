# Story 12.1: SwapPair Type + IlpPeerInfo Extension + kind:10032 Serialization

Status: done
ui_impact: false
epic: 12
story_id: 12-1

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Adversarial review 2026-04-10: source-of-truth claims verified against packages/core/src/events/{builders,parsers}.ts, errors.ts, and _bmad-output/epics/epic-12-token-swap-primitive.md. All referenced line numbers, export statements, and type definitions confirmed accurate. -->

## Story

As a TOON Protocol developer building the Token Swap Primitive (Epic 12),
I want a `SwapPair` type added to `@toon-protocol/core`, an optional `swapPairs` field on `IlpPeerInfo`, and roundtrip-safe builder/parser support on kind:10032 events,
so that swap-capable peers (Mills) can advertise the token pairs they exchange, the current rates, and per-packet min/max limits in their existing peer-info event — with full backward compatibility for pre-Epic-12 events that have no `swapPairs` field.

This is the foundation story for Epic 12. All subsequent stories (NIP-59 gift wrap, Mill handler, streamSwap client API, Mill package scaffold) depend on (a) swap-capable peer discovery via the extended kind:10032 schema and (b) a stable `SwapPair` shape that the handler, client, and test harness agree on.

## Dependencies

- **Upstream:** Epic 1-3 (ILP peering + kind:10032 event infrastructure) — DONE. All referenced builder/parser functions already exist.
- **Upstream:** Story 7.4 (`feePerByte` field pattern on `IlpPeerInfo`) — DONE. Sets the precedent for optional decimal/integer-string fields.
- **Upstream:** Story 7.6 (`prefixPricing` field pattern) — DONE. Sets the precedent for optional nested object fields.
- **Downstream:** Story 12.2 (NIP-59 gift wrap integration) — will consume `SwapPair` for swap packet construction.
- **Downstream:** Story 12.3 (Mill swap handler) — will consume `SwapPair.rate`/`from`/`to` for rate application and claim issuance.
- **Downstream:** Story 12.5 (client-side `streamSwap()` API) — will filter peers via `IlpPeerInfo.swapPairs`.
- **Downstream:** Story 12.7 (`packages/mill/` + `startMill()`) — will publish a kind:10032 event containing the Mill's `swapPairs` on startup.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Non-custodial, privacy-preserving token swaps via existing ILP micropayment infrastructure. Swap-capable peers advertise supported token pairs via an optional `swapPairs` field on `IlpPeerInfo` (kind:10032); clients send NIP-59 gift-wrapped ILP packets carrying value in the source asset; Mill returns signed payment-channel claims in the target asset via the ILP FULFILL data field. Sender controls packet granularity.

Relevant design decisions from `_bmad-output/epics/epic-12-token-swap-primitive.md`:

- **D12-002:** Optional `swapPairs` field on `IlpPeerInfo`. Peers without `swapPairs` behave exactly as today. No protocol-level change, no breaking change.
- **D12-006:** Live rate per packet. Rate is not locked — it applies to each packet independently. Serializing rate as a decimal **string** (not float) preserves arbitrary precision and avoids float drift.
- **D12-007:** Mill is a market maker. `SwapPair` is a declarative advertisement; rate management and inventory balancing are Mill operator concerns.

## Acceptance Criteria

1. **AC-1 — `SwapPair` type defined.** Create and export a `SwapPair` TypeScript interface in `packages/core/src/types.ts` matching the epic spec:
   ```ts
   export interface SwapPair {
     /** Source asset */
     from: { assetCode: string; assetScale: number; chain: string };
     /** Target asset */
     to: { assetCode: string; assetScale: number; chain: string };
     /** Exchange rate as decimal string (target units per source unit) */
     rate: string;
     /** Minimum swap amount per packet in source asset micro-units (optional) */
     minAmount?: string;
     /** Maximum swap amount per packet in source asset micro-units (optional) */
     maxAmount?: string;
   }
   ```
   `chain` uses the same `{blockchain}:{network}[:{chainId}]` format as `IlpPeerInfo.supportedChains` (validated by `validateChainId()` in `parsers.ts`).

2. **AC-2 — `IlpPeerInfo.swapPairs` optional field.** Extend `IlpPeerInfo` in `packages/core/src/types.ts` with:
   ```ts
   /** Token pairs this peer can swap, with current rates. Absent = no swap support. */
   swapPairs?: SwapPair[];
   ```
   Field is strictly optional. Existing `IlpPeerInfo` consumers (relay, SDK, town, bridge) are not required to handle `swapPairs`; absence means "no swap support" (default behavior).

3. **AC-3 — Builder serializes `swapPairs` when present.** `buildIlpPeerInfoEvent(info, secretKey)` in `packages/core/src/events/builders.ts` MUST:
   - When `info.swapPairs === undefined` → omit `swapPairs` entirely from the serialized JSON content (do NOT emit `"swapPairs": undefined` or `"swapPairs": null`).
   - When `info.swapPairs` is an empty array `[]` → serialize as `"swapPairs": []` (empty array is distinct from undefined — it means "swap peer with no currently active pairs").
   - When `info.swapPairs` is non-empty → serialize each `SwapPair` in array order, preserving all fields including optional `minAmount`/`maxAmount`.
   - Throw `ToonError` with code `INVALID_SWAP_PAIR` (new error code) if any `SwapPair` is structurally invalid per AC-5 validation rules below (validation performed at build time so bad data cannot be published).
   - Existing behavior for all other fields is UNCHANGED.

4. **AC-4 — Parser deserializes `swapPairs` with backward compatibility.** `parseIlpPeerInfo(event)` in `packages/core/src/events/parsers.ts` MUST:
   - When the JSON content has no `swapPairs` key → returned `IlpPeerInfo.swapPairs` is `undefined` (use conditional spread — do NOT set `swapPairs: undefined` explicitly; omit the property).
   - When `swapPairs` is present and valid → returned `IlpPeerInfo.swapPairs` is a `SwapPair[]` with identical field values (roundtrip-preserving).
   - When `swapPairs` is present but not an array → throw `InvalidEventError('swapPairs must be an array')`.
   - When any element fails AC-5 validation → throw `InvalidEventError` with a descriptive message including the invalid field name.
   - All existing field parsing behavior UNCHANGED. Pre-Epic-12 kind:10032 events (no `swapPairs` key) MUST parse successfully with `swapPairs === undefined` and all other fields intact.

5. **AC-5 — `SwapPair` validation rules.** Both builder and parser MUST enforce these structural rules on every `SwapPair` (shared helper function preferred; see Dev Notes). A `SwapPair` is invalid if any of the following hold:
   - `from` or `to` is missing, not an object, or null.
   - `from.assetCode` or `to.assetCode` is not a non-empty string.
   - `from.assetScale` or `to.assetScale` is not a non-negative integer (`Number.isInteger(x) && x >= 0`).
   - `from.chain` or `to.chain` is not a string that passes `validateChainId()` (the existing parser helper — export it from `parsers.ts` if not already exported, or duplicate the logic in a new `isValidChainId()` helper co-located with the validation function).
   - `rate` is not a string matching `/^(0|[1-9]\d*)(\.\d+)?$/` (non-negative decimal, no leading zeros except `0`, no trailing dot, no exponent notation). Rate `"0"` is valid (means "not currently quoting this pair"); negative rates are invalid.
   - `minAmount` is present and is not a string matching `/^\d+$/` (non-negative integer string in source micro-units).
   - `maxAmount` is present and is not a string matching `/^\d+$/`.
   - Both `minAmount` and `maxAmount` are present AND `BigInt(minAmount) > BigInt(maxAmount)` (min must not exceed max). Use `BigInt` comparison — these values can exceed `Number.MAX_SAFE_INTEGER`.

6. **AC-6 — New error code.** Add `'INVALID_SWAP_PAIR'` to the error code taxonomy used by `ToonError` in `packages/core/src/errors.ts` (or wherever error codes are centrally defined). The builder throws `ToonError` with this code; the parser throws `InvalidEventError` (existing class) with a descriptive message. Follow the existing convention where builders throw `ToonError` with a code and parsers throw `InvalidEventError` with a string.

7. **AC-7 — Package exports.** Export `SwapPair` as a `type` from `packages/core/src/index.ts` alongside the existing `IlpPeerInfo` type export. Do NOT add any new runtime exports beyond what the builder/parser already expose — `SwapPair` is a type-only surface.

8. **AC-8 — Unit tests (>= 20 tests total across helper + builder + parser files).** Extend `packages/core/src/events/builders.test.ts` and `packages/core/src/events/parsers.test.ts`, and create `packages/core/src/events/swap-pair-validation.test.ts`. Coverage MUST include (mapping to test-design-epic-12 T-001..T-008):

   - **Validation helper tests (>= 8):** See Task 9 — one valid-pair baseline plus at least 7 invalid-case tests covering each rule in AC-5. These tests exercise the shared helper in isolation so the rules are locked down independently of builder/parser integration.
   - **Builder tests (>= 5):**
     - (T-001) Build kind:10032 event with a single valid `swapPair` → JSON content contains `swapPairs` array with correct fields.
     - (T-006) Build with multiple pairs (e.g., USDC→ETH on `evm:base:8453`, USDC→MINA on `mina:mainnet`) → array order preserved.
     - (T-007) Build with `swapPairs: []` → content has `"swapPairs":[]`. Build with `swapPairs: undefined` → no `swapPairs` key in content at all.
     - (T-008 / AC-5) Build with invalid pair (negative `assetScale`, non-numeric `rate`, `minAmount > maxAmount`, invalid `chain` format, empty `assetCode`) → throws `ToonError` with code `INVALID_SWAP_PAIR`. Cover at least 4 distinct invalid inputs.
     - Build with a pre-Epic-12 `IlpPeerInfo` (no `swapPairs` at all) → works exactly as before, produces bit-identical content to the pre-change builder for the same input (regression test).
   - **Parser tests (>= 5):**
     - (T-003) Parse a pre-Epic-12 kind:10032 event (no `swapPairs` key) → `result.swapPairs === undefined`; all other fields parsed correctly. Use a fixture that exactly matches the shape produced by pre-change code.
     - (T-002) Parse an event with one `swapPair` → `result.swapPairs` is a 1-element array; every field roundtrips exactly.
     - (T-004) Parse with high-precision rate (e.g., `"0.000123456789012345"`) → rate string preserved exactly (no float truncation). Use a decimal with > 15 significant digits.
     - (T-005) Parse with `minAmount`/`maxAmount` omitted → both undefined on the parsed pair; parse with both present → both preserved as strings.
     - (T-008) Parse events where `swapPairs` is not an array, where a pair has missing `from`, where `rate` is a number not a string, where `chain` is malformed → each throws `InvalidEventError` with a message naming the bad field. Cover at least 4 distinct invalid shapes.
   - **Roundtrip tests (>= 2):** Build then parse the same `IlpPeerInfo` with non-trivial `swapPairs` and assert deep equality on `swapPairs`. Include one test with 3+ pairs covering EVM, Mina, and Solana chains. Include one test with a `BigInt`-requiring `maxAmount` (e.g., `"99999999999999999999"` — 20 digits, well beyond `Number.MAX_SAFE_INTEGER`) to verify no precision loss.

9. **AC-9 — Build, lint, test verification.** After all changes:
   - `pnpm --filter @toon-protocol/core build` compiles cleanly with no TypeScript errors.
   - `pnpm --filter @toon-protocol/core test` passes — all new tests pass; all pre-existing builder/parser tests still pass (no regressions).
   - `pnpm lint` passes for the `packages/core` scope.
   - No changes to downstream packages are required — this story is purely additive to `@toon-protocol/core`.

## Tasks / Subtasks

- [x] **Task 1: Define `SwapPair` type and extend `IlpPeerInfo`** (AC: 1, 2, 7)
  - [x] 1.1 Add `SwapPair` interface to `packages/core/src/types.ts` with the exact shape from AC-1.
  - [x] 1.2 Add optional `swapPairs?: SwapPair[]` field to existing `IlpPeerInfo` interface.
  - [x] 1.3 Export `SwapPair` as a type from `packages/core/src/index.ts` (add to the existing type export block that exports `IlpPeerInfo`).
  - [x] 1.4 Verify `pnpm --filter @toon-protocol/core build` compiles — the type additions alone should not break anything.

- [x] **Task 2: Create shared `SwapPair` validation helper** (AC: 5)
  - [x] 2.1 Create `packages/core/src/events/swap-pair-validation.ts` exporting TWO thin wrappers over a shared boolean-returning core:
    - `isValidSwapPair(pair: unknown): { valid: true } | { valid: false; reason: string; field: string }` — pure function, no throws, returns discriminated union with the offending field name for precise error messages.
    - `assertSwapPairForBuild(pair: unknown, index: number): asserts pair is SwapPair` — throws `ToonError(message, 'INVALID_SWAP_PAIR')` on failure.
    - `assertSwapPairForParse(pair: unknown, index: number): asserts pair is SwapPair` — throws `InvalidEventError(message)` on failure.
    Both asserters format the message as `swapPairs[${index}]: ${reason} (field: ${field})`. This factoring guarantees identical validation logic in both paths and eliminates the feePerByte-style duplication smell.
  - [x] 2.2 Import `validateChainId` from `./parsers.js` — CONFIRMED exported at `packages/core/src/events/parsers.ts` line 19 (verified during adversarial review 2026-04-10). If a circular import emerges during implementation, extract `validateChainId` to a new `packages/core/src/chain/chain-id.ts` file and import from there in both `parsers.ts` and `swap-pair-validation.ts` rather than duplicating the logic.
  - [x] 2.3 Unit tests for the helper are specified in Task 9 below — implement the helper first so Task 9 tests can import it.

- [x] **Task 3: Error code convention** (AC: 6)
  - [x] 3.1 CONFIRMED during adversarial review: `ToonError` (packages/core/src/errors.ts:9) takes `code: string` — codes are informal string literals, NOT a typed union or enum. Existing codes in use: `INVALID_FEE`, `ADDRESS_EMPTY_ADDRESSES`, `ADDRESS_INVALID_PREFIX`. No central taxonomy file update is required.
  - [x] 3.2 Use the literal `'INVALID_SWAP_PAIR'` in the asserter from Task 2.1. Follow the existing convention: SCREAMING_SNAKE_CASE, short and self-documenting.
  - [x] 3.3 No changes to `packages/core/src/errors.ts` are expected by this task. If review finds the taxonomy has been formalized since this story was written, add `'INVALID_SWAP_PAIR'` to the union/enum at that time.

- [x] **Task 4: Extend builder with `swapPairs` serialization** (AC: 3)
  - [x] 4.1 In `packages/core/src/events/builders.ts::buildIlpPeerInfoEvent` (CONFIRMED: 79 lines total, feePerByte validation at lines 31-39, ilpAddresses validation at lines 43-68, finalizeEvent at lines 70-78), insert the `swapPairs` validation block AFTER the `ilpAddresses` block and BEFORE `finalizeEvent()`.
  - [x] 4.2 Implementation: `if (info.swapPairs !== undefined) { info.swapPairs.forEach((pair, index) => assertSwapPairForBuild(pair, index)); }`. On the first failure the asserter throws `ToonError` with code `INVALID_SWAP_PAIR` and a message naming the index and bad field — no further iteration occurs.
  - [x] 4.3 Because the current builder uses `JSON.stringify(effectiveInfo)` (line 73) and `effectiveInfo` is derived from `info`, `swapPairs` will be serialized automatically when present and omitted when `undefined` (standard `JSON.stringify` behavior for undefined-valued keys). No change to the serialization call is needed. Verify in a test that `swapPairs: undefined` produces output with no `swapPairs` key.
  - [x] 4.4 Update the JSDoc on `buildIlpPeerInfoEvent` (currently documents INVALID_FEE, ADDRESS_EMPTY_ADDRESSES, ADDRESS_INVALID_PREFIX) to add: `@throws {ToonError} With code 'INVALID_SWAP_PAIR' if any swapPair is structurally invalid`.

- [x] **Task 5: Extend parser with `swapPairs` deserialization** (AC: 4)
  - [x] 5.1 In `packages/core/src/events/parsers.ts::parseIlpPeerInfo`, after the existing `prefixPricing` parsing block and before the `ilpAddresses` block (or at any clean insertion point — keep existing order stable for minimal diff), destructure `swapPairs` from `parsed`.
  - [x] 5.2 If `swapPairs === undefined` → do nothing (will be omitted from the return object via conditional spread).
  - [x] 5.3 If `swapPairs` is present → assert it's an array (throw `InvalidEventError('swapPairs must be an array')` otherwise), then iterate and call the parser-mode validation helper on each element. On failure, throw `InvalidEventError` with a message like `Invalid swapPairs[${index}]: ${reason}`.
  - [x] 5.4 In the returned object literal at the bottom of `parseIlpPeerInfo`, add `...(swapPairs !== undefined && { swapPairs: swapPairs as SwapPair[] })` in the same style as the existing conditional spreads (`prefixPricing`, `preferredTokens`, etc.). **Do NOT set `swapPairs: undefined` — use the conditional spread so the field is literally absent when not provided.** This preserves deep-equality roundtrip for pre-Epic-12 events.
  - [x] 5.5 Update the JSDoc on `parseIlpPeerInfo` if it enumerates throwable errors.

- [x] **Task 6: Builder unit tests** (AC: 8) — covered by pre-existing ATDD file `swap-pair-builder.test.ts` (10 tests, all passing).
  - [x] 6.1 `describe('buildIlpPeerInfoEvent — swapPairs serialization')` block in `swap-pair-builder.test.ts`.
  - [x] 6.2 Uses the existing `IlpPeerInfo` fixture pattern.
  - [x] 6.3 Uses `generateSecretKey()` and parses `event.content` back as JSON.
  - [x] 6.4 Regression test included: pre-Epic-12 `IlpPeerInfo` produces content with no `swapPairs` key.

- [x] **Task 7: Parser unit tests** (AC: 8) — covered by pre-existing ATDD file `swap-pair-parser.test.ts` (12 tests, all passing).
  - [x] 7.1 `describe('parseIlpPeerInfo — swapPairs deserialization')` block in `swap-pair-parser.test.ts`.
  - [x] 7.2 Fixtures constructed by hand with `finalizeEvent`.
  - [x] 7.3 Pre-Epic-12 backward-compat fixture test included.
  - [x] 7.4 High-precision rate test (> 15 significant digits) included.

- [x] **Task 8: Roundtrip tests** (AC: 8) — covered by `swap-pair-parser.test.ts` roundtrip describe block (EVM/Mina/Solana 3-pair test + 20-digit maxAmount test).

- [x] **Task 9: Validation helper unit tests** (AC: 5, 8) — covered by `swap-pair-validation.test.ts` (41 tests, all passing, covering every case enumerated in AC-5 plus extras).

- [x] **Task 10: Build + lint + test verification** (AC: 9)
  - [x] 10.1 `pnpm --filter @toon-protocol/core build` — exit 0.
  - [x] 10.2 `pnpm --filter @toon-protocol/core test` — 2409 passed / 7 skipped, no regressions.
  - [x] 10.3 `pnpm lint` — 0 errors (1619 pre-existing warnings unrelated to this story).
  - [x] 10.4 No downstream package changes required — story is self-contained in `packages/core`.

## Dev Notes

### Why this story is strictly additive

Every pre-Epic-12 field on `IlpPeerInfo` and every pre-Epic-12 kind:10032 event MUST continue to work bit-identically. The `swapPairs` field is optional, omitted when absent, and the parser uses conditional spread (`...(x !== undefined && { x })`) to avoid producing `{ swapPairs: undefined }` on legacy input — this matches how `preferredTokens`, `tokenNetworks`, `prefixPricing`, and `blsHttpEndpoint` are already handled in `parseIlpPeerInfo`. Copy that exact pattern; do not invent a new one.

Regression risk: R-011 from `_bmad-output/planning-artifacts/test-design-epic-12.md` — "kind:10032 backward compatibility broken by swapPairs field". Mitigation: the pre-Epic-12 fixture test in Task 7.3 and the regression test in Task 6.4.

### Shared validation: single source of truth

The AC-5 rules are enforced in TWO places (builder AND parser), which means they MUST share a single implementation. Put the core logic in `packages/core/src/events/swap-pair-validation.ts`. Do NOT copy-paste the rules into both files — divergence between builder-time and parse-time validation is exactly the kind of bug that produces mysterious "round-tripping my own output fails" issues months later. The existing `feePerByte` validation is duplicated between builder and parser (see `builders.ts` lines 31-39 and `parsers.ts` lines 170-184) — do NOT follow that precedent for `swapPairs`; use the shared helper.

### Rate format: decimal string, not float

D12-006 mandates live rate per packet. Rates like `0.000123456789012345` or `1234567.000000001` MUST roundtrip exactly. JavaScript `number` CANNOT represent these (IEEE 754 double has ~15 significant digits and many decimal fractions have no exact binary representation). **Always serialize rate as a string.** The validation regex `/^(0|[1-9]\d*)(\.\d+)?$/` enforces: non-negative, no leading zeros (except the single digit `0`), no scientific notation, no trailing dot. Rate `"0"` is explicitly valid — it means "I list this pair but am not currently quoting a price" (the Mill can still receive packets and return REJECT if paused).

### minAmount / maxAmount: BigInt semantics

These are source-asset micro-unit integers. For USDC (`assetScale: 6`), a max of `"1000000000"` means $1,000.00. For a Mill willing to do a single $1M swap, max is `"1000000000000"` — 13 digits, still under `Number.MAX_SAFE_INTEGER` (~9×10^15). But the type contract says **string**, and the validation MUST use `BigInt` comparison, not `Number` — because (a) it future-proofs against assets with tiny scales (e.g., a hypothetical `assetScale: 0` token where amounts are raw units and could exceed 2^53), and (b) it defends against a malicious Mill publishing a 30-digit max to break downstream parsers that coerce to `Number`. The Epic 11 retro "MAX_SAFE_INTEGER guard" standard guard (see Standard Guards section below) applies exactly here.

### Chain identifier format

`SwapPair.from.chain` and `SwapPair.to.chain` use the same `{blockchain}:{network}[:{chainId}]` format as `IlpPeerInfo.supportedChains`. The parser already has `validateChainId()` — reuse it. Examples from the codebase: `"evm:base:8453"`, `"evm:arbitrum:42161"`, `"mina:mainnet"`, `"solana:mainnet"`, `"xrp:mainnet"`. Do NOT invent new chain identifier conventions.

### Where to insert the parser logic

`parseIlpPeerInfo` in `parsers.ts` currently handles fields in this order: required fields → `supportedChains` → `settlementAddresses` → `preferredTokens` → `tokenNetworks` → `feePerByte` → `prefixPricing` → `ilpAddresses`. Insert `swapPairs` parsing **between `prefixPricing` and `ilpAddresses`** or **after `ilpAddresses`** — either location is fine; pick the one that produces the minimal diff. The return-object literal at line 226+ should add `...(swapPairs !== undefined && { swapPairs: ... })` in the same conditional-spread block as the existing optional fields.

### What NOT to do in this story

- Do NOT add any swap-packet construction logic. That's Story 12.2 (NIP-59 gift wrap).
- Do NOT add any Mill handler logic. That's Story 12.3.
- Do NOT add any `streamSwap()` client API. That's Story 12.5.
- Do NOT add any rate application or claim issuance logic. That's Story 12.3.
- Do NOT add any fields beyond what's in the epic spec's `SwapPair` interface. Rate oracle integration, inventory depth, spread asymmetry, partial fills — all explicitly out of scope (D12-007).
- Do NOT touch `packages/sdk`, `packages/town`, or any other package. This story is self-contained in `packages/core`.
- Do NOT modify the existing feePerByte-style duplicated validation — just follow the shared-helper pattern for the new field.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** This story does not create or modify GitHub Actions workflows. No action needed.
- **MAX_SAFE_INTEGER guard:** APPLIES DIRECTLY. `minAmount` and `maxAmount` are integer strings that may exceed `Number.MAX_SAFE_INTEGER`. Use `BigInt(minAmount) > BigInt(maxAmount)` for the cross-field check in AC-5. Do NOT convert to `Number` anywhere. The validation regex guarantees the string is a valid `BigInt` input so `BigInt(x)` will not throw.
- **Golden test vectors (ZK story pairs):** Does not apply — this story has no ZK circuit counterpart.

### Project Structure Notes

- All changes live in `packages/core/`. No workspace dependency changes.
- New file: `packages/core/src/events/swap-pair-validation.ts` (+ `.test.ts`).
- Modified files: `packages/core/src/types.ts`, `packages/core/src/index.ts`, `packages/core/src/events/builders.ts`, `packages/core/src/events/builders.test.ts`, `packages/core/src/events/parsers.ts`, `packages/core/src/events/parsers.test.ts`.
- No changes to `packages/core/src/constants.ts` — `ILP_PEER_INFO_KIND = 10032` is already defined.
- Naming: the interface is `SwapPair` (singular), the field is `swapPairs` (plural array). Match the spec exactly.

### References

- [Source: `_bmad-output/epics/epic-12-token-swap-primitive.md`] — epic goal, design decisions D12-001 through D12-011, `SwapPair` TypeScript declaration (lines 100-120), key story list (lines 172-181).
- [Source: `_bmad-output/planning-artifacts/test-design-epic-12.md#Story 12-1`] — P0/P1/P2 test scenarios T-001..T-008, risks R-011 and R-013, traceability matrix entries.
- [Source: `packages/core/src/types.ts`] — existing `IlpPeerInfo` interface to extend.
- [Source: `packages/core/src/events/builders.ts`] — `buildIlpPeerInfoEvent` reference implementation; follow its validation-then-finalize pattern.
- [Source: `packages/core/src/events/parsers.ts`] — `parseIlpPeerInfo` reference implementation; `validateChainId()` helper (line 19); conditional-spread pattern for optional fields (lines 226-249); existing `feePerByte` and `prefixPricing` optional-field precedents.
- [Source: `packages/core/src/constants.ts`] — `ILP_PEER_INFO_KIND = 10032`.
- [Source: `packages/core/src/errors.ts`] — `ToonError` and `InvalidEventError` classes; existing error code literals.
- [Source: `packages/pet-dvm/src/pricing/calculatePetInteractionPrice.ts`] — reference for BigInt-safe numeric validation (Epic 11 story 11.11 pattern).

### Previous Story Intelligence

Epic 12 has no prior stories (this is 12.1, the foundation story). Relevant prior-epic intelligence:

- **Epic 7 story 7.4 (`feePerByte`)** introduced the pattern of optional decimal/integer-string fields on `IlpPeerInfo`. It duplicated validation between builder and parser. Lesson learned: the duplication has been stable but is a known code smell — for `swapPairs`, use a shared helper (Task 2) to avoid that smell on a more complex validation surface.
- **Epic 7 story 7.6 (`prefixPricing`)** introduced the pattern of optional nested-object fields. It correctly uses conditional spread `...(prefixPricing !== undefined && { prefixPricing })` in the parser return object (parsers.ts line 249). Copy that exact pattern for `swapPairs`.
- **Epic 11 story 11.11 (`calculatePetInteractionPrice`)** demonstrated BigInt-safe pricing validation with `PricingError`. The error-code pattern there (string `code` field on the error class) is the reference for how `'INVALID_SWAP_PAIR'` should be shaped if `ToonError` uses a similar structure.
- **Epic 11 retro** produced the MAX_SAFE_INTEGER standard guard, which applies directly to `minAmount`/`maxAmount` comparison in AC-5.

### Project Context Reference

See `_bmad-output/project-context.md` for the full set of coding rules, patterns, and conventions — in particular the sections on (a) TypeScript strict-mode conventions, (b) Nostr event builder/parser patterns, (c) error-handling conventions (`ToonError` vs `InvalidEventError`), and (d) test file co-location with source files in `packages/core`.

## Story Completion Status

Created: 2026-04-10
Created by: create-story workflow (bmad-bmm)
Last reviewed: 2026-04-10 (adversarial review — source-of-truth claims verified, tasks refined, AC-8 test count reconciled with Task 9)
Sprint-status entry: added as `12-1-swappair-type-and-kind-10032-serialization: ready-for-dev` under epic-12.

## Change Log

| Date | Author | Change |
| --- | --- | --- |
| 2026-04-10 | create-story workflow | Initial draft — ACs, tasks, dev notes |
| 2026-04-10 | adversarial review | Verified file/line references against source; clarified Task 2 (two-asserter pattern), Task 3 (error codes are informal strings, no central taxonomy update needed), Task 4 (confirmed builder line numbers and insertion point); reconciled AC-8 test count (>= 20 total) to include Task 9 helper tests; removed duplicate Status line |
| 2026-04-10 | dev agent (Opus 4.6 1M) | Implementation session — added `SwapPair` interface + optional `IlpPeerInfo.swapPairs`, shared validation helper with dual asserters (`assertSwapPairForBuild` throws `ToonError('INVALID_SWAP_PAIR')`, `assertSwapPairForParse` throws `InvalidEventError`), builder/parser integration with conditional-spread return, all 63 swap-pair tests green (41 validation + 10 builder + 12 parser including roundtrip), 2409 total core tests pass, 0 lint errors. Status → review (pipeline convention: dev → review → done after code review). |
| 2026-04-10 | code review pass #1 (Opus 4.6 1M) | Adversarial code review — 0C/0H/1M/3L. Medium: extracted `validateChainId` to new `packages/core/src/chain/chain-id.ts` to eliminate circular-import smell. Low: `isObject` array guard, parser JSDoc, chainId dedup. All findings fixed inline. Verification: build clean, 2413 tests green, lint clean. No follow-up tasks required. |
| 2026-04-10 | code review pass #2 (Opus 4.6 1M) | Adversarial code review — 0C/1H/1M/2L. High: `parsers.ts` `isObject` was accepting arrays — fixed. Medium: added runtime `Array.isArray` guard on `swapPairs` in `builders.ts` — fixed. Low: hoisted dynamic imports to static in `swap-pair-parser.test.ts`; added defensive non-array builder test in `swap-pair-builder.test.ts`. All findings fixed inline. Verification: build clean, 2414 tests green. Outcome: APPROVED. |
| 2026-04-10 | code review pass #3 (Opus 4.6 1M) | Final security-focused code review with OWASP scan — 0C/0H/0M/1L. Low: BigInt DoS guard via `MAX_NUMERIC_STRING_LENGTH=80` cap on `rate`/`minAmount`/`maxAmount` to prevent pathological BigInt construction on attacker-supplied giant numeric strings — fixed inline in `swap-pair-validation.ts`. Added 4 new security boundary tests to `swap-pair-validation.test.ts`. Security review: OWASP A03 (injection) safe, A04 (DoS) hardened, A08 (prototype pollution) safe, ReDoS linear-time verified, no auth/authz scope. Verification: build clean, 2418 tests green. Outcome: APPROVED — final pass. Story → done. |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`

### Debug Log References

- `pnpm --filter @toon-protocol/core build` — success (ESM 28ms, DTS 2938ms).
- `pnpm --filter @toon-protocol/core test -- swap-pair-validation` — 41 tests passed.
- `pnpm --filter @toon-protocol/core test -- swap-pair` — 63 tests passed (validation 41 + builder 10 + parser 12).
- `pnpm --filter @toon-protocol/core test` — 2409 passed / 7 skipped, 62 test files, 0 failures, no regressions.
- `pnpm lint` — 0 errors / 1619 pre-existing warnings (none in files touched by this story).

### Completion Notes List

- **Task 1 — Types:** Added `SwapPair` interface to `packages/core/src/types.ts` with the exact AC-1 shape (from/to asset structs, rate string, optional min/max amount strings). Added optional `swapPairs?: SwapPair[]` field to `IlpPeerInfo`. Exported `SwapPair` as a type from `packages/core/src/index.ts` alongside `IlpPeerInfo`. No runtime exports added.
- **Task 2 — Validation helper:** Created `packages/core/src/events/swap-pair-validation.ts` with three exports: `isValidSwapPair` (pure discriminated-union returning validator), `assertSwapPairForBuild` (throws `ToonError('INVALID_SWAP_PAIR')`), `assertSwapPairForParse` (throws `InvalidEventError`). All three delegate to a single shared `isValidSwapPair` core so build-time and parse-time rules cannot drift. Validation regex for rate: `/^(0|[1-9]\d*)(\.\d+)?$/`; for amounts: `/^\d+$/`. Cross-field min/max comparison uses `BigInt` per Epic 11 retro MAX_SAFE_INTEGER guard. Chain validation delegates to existing `validateChainId` from `parsers.ts` — no circular-import issue at runtime (both modules only invoke each other's exports inside function bodies, not at module top level).
- **Task 3 — Error code:** Used literal string `'INVALID_SWAP_PAIR'` in `assertSwapPairForBuild`. No changes required to `errors.ts` since codes are informal strings.
- **Task 4 — Builder:** Added `swapPairs` validation loop in `buildIlpPeerInfoEvent` after the `ilpAddresses` block and before `finalizeEvent()`. Serialization is handled automatically by the existing `JSON.stringify(effectiveInfo)` call (undefined keys omitted by default). Updated JSDoc to advertise the new `INVALID_SWAP_PAIR` throw code.
- **Task 5 — Parser:** Added `swapPairs` deserialization block in `parseIlpPeerInfo` after the `prefixPricing` block. Array check throws `InvalidEventError('swapPairs must be an array')`; per-element validation delegates to `assertSwapPairForParse`. Returned object uses conditional spread `...(swapPairs !== undefined && { swapPairs })` so pre-Epic-12 events roundtrip without gaining a literal `undefined` key.
- **Tasks 6-9 — Tests:** ATDD test files (`swap-pair-builder.test.ts`, `swap-pair-parser.test.ts`, `swap-pair-validation.test.ts`) were already scaffolded in RED phase at dev-start. Implementation turned all 63 tests green on the first run. Test count by file: 41 validation, 10 builder, 12 parser. Roundtrip tests (3-pair EVM/Mina/Solana + 20-digit `maxAmount`) live in `swap-pair-parser.test.ts`. Total swap-pair tests: 63, exceeds AC-8 minimum of 20.
- **Task 10 — Verification:** Build, full 62-file core test suite, and workspace lint all pass. No downstream packages touched. Change is strictly additive.

### File List

**Added:**

- `packages/core/src/events/swap-pair-validation.ts`
- `packages/core/src/chain/chain-id.ts` — extracted `validateChainId` helper (code review pass #1, Medium finding) to break a circular-import smell between `parsers.ts` and `swap-pair-validation.ts`.

**Modified:**

- `packages/core/src/types.ts` — added `SwapPair` interface; added `swapPairs?: SwapPair[]` field to `IlpPeerInfo`.
- `packages/core/src/index.ts` — exported `SwapPair` type alongside `IlpPeerInfo`.
- `packages/core/src/events/builders.ts` — imported `assertSwapPairForBuild`; added swapPairs validation loop; updated JSDoc. Code review pass #2: added defensive runtime `Array.isArray(info.swapPairs)` guard before the validation loop (Medium finding) so non-array inputs fail fast with a clear error even when TypeScript types are bypassed.
- `packages/core/src/events/swap-pair-validation.ts` — code review pass #3: added `MAX_NUMERIC_STRING_LENGTH = 80` cap on `rate`, `minAmount`, and `maxAmount` string inputs to prevent BigInt DoS via pathologically large numeric strings (Low / OWASP A04 hardening).
- `packages/core/src/events/swap-pair-validation.test.ts` — code review pass #3: added 4 new security boundary tests covering the `MAX_NUMERIC_STRING_LENGTH` guard for `rate`, `minAmount`, `maxAmount`, and the 80-character boundary itself.
- `packages/core/src/events/parsers.ts` — imported `assertSwapPairForParse` and `SwapPair` type; added swapPairs deserialization block; added conditional-spread for `swapPairs` in return object. Code review pass #1: re-imports `validateChainId` from new `chain/chain-id.ts` module; parser JSDoc expanded; chainId dedup cleanup. Code review pass #2: tightened `isObject` helper to reject arrays (High finding) — `isObject` was previously accepting arrays, allowing malformed array-shaped inputs to slip past the plain-object type guard.
- `packages/core/src/events/swap-pair-validation.ts` — code review pass #1: imports `validateChainId` from `../chain/chain-id.js` instead of `./parsers.js`; tightened `isObject` array guard; minor cleanup.
- `packages/core/src/events/swap-pair-parser.test.ts` — code review pass #2 (Low): hoisted dynamic `import()` calls to static top-of-file imports for consistency with the rest of the core test suite.
- `packages/core/src/events/swap-pair-builder.test.ts` — code review pass #2 (Low): added defensive non-array builder test covering the new runtime `Array.isArray` guard on `swapPairs`.

**Pre-existing ATDD test files (unchanged during dev, all green against implementation):**

- `packages/core/src/events/swap-pair-validation.test.ts` (41 tests)
- `packages/core/src/events/swap-pair-builder.test.ts` (10 tests)
- `packages/core/src/events/swap-pair-parser.test.ts` (12 tests)

## Code Review Record

### Review Pass #1 — 2026-04-10

- **Reviewer:** Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`
- **Scope:** Full story 12.1 implementation (SwapPair type, IlpPeerInfo extension, builder/parser integration, shared validation helper).
- **Findings by severity:** 0 Critical / 0 High / 1 Medium / 3 Low
  - **Medium (1):** Circular-import smell between `packages/core/src/events/parsers.ts` and `packages/core/src/events/swap-pair-validation.ts` via `validateChainId`. **Fixed inline** by extracting `validateChainId` to a new module `packages/core/src/chain/chain-id.ts`; both `parsers.ts` and `swap-pair-validation.ts` now import from the new location.
  - **Low (3):** (a) `isObject` helper needed an explicit array guard to avoid treating arrays as plain objects; (b) parser JSDoc missing enumeration of new throwable conditions; (c) minor chainId validation dedup inside parsers. **All fixed inline.**
- **Verification:** `pnpm --filter @toon-protocol/core build` clean; full workspace test suite 2413 tests green; `pnpm lint` clean.
- **Files modified by review:** `packages/core/src/chain/chain-id.ts` (new), `packages/core/src/events/parsers.ts`, `packages/core/src/events/swap-pair-validation.ts`.
- **Action items / follow-up tasks:** None. All findings were resolved inline during the review pass; no new Tasks/Subtasks or "Review Follow-ups (AI)" items required.

### Review Pass #2 — 2026-04-10

- **Reviewer:** Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`
- **Scope:** Delta review of the pass #1 fixes plus full re-sweep of the builder/parser surface for `swapPairs` — focusing on runtime type guards, test hygiene, and defensive input handling.
- **Findings by severity:** 0 Critical / 1 High / 1 Medium / 2 Low
  - **High (1):** `parsers.ts` `isObject` helper accepted arrays (arrays are `typeof === 'object'` and non-null), which allowed malformed array-shaped payloads to slip past the plain-object type guard used for `swapPairs` elements and other nested-object fields. **Fixed inline** by tightening `isObject` to explicitly reject arrays via `!Array.isArray(value)`.
  - **Medium (1):** `builders.ts` had no runtime `Array.isArray(info.swapPairs)` guard before iterating — TypeScript types alone are insufficient for a public API that may be called from JavaScript or with bypassed types. **Fixed inline** by adding an explicit `Array.isArray` check that throws `ToonError('INVALID_SWAP_PAIR')` with a clear "swapPairs must be an array" message before the per-element validation loop.
  - **Low (2):** (a) `swap-pair-parser.test.ts` used dynamic `import()` calls inside test bodies — hoisted to static top-of-file imports for consistency with the rest of the core test suite. (b) `swap-pair-builder.test.ts` lacked a defensive non-array builder test — added one covering the new runtime `Array.isArray` guard. **Both fixed inline.**
- **Verification:** `pnpm --filter @toon-protocol/core build` clean; full core test suite 2414 tests green (one new defensive test added); no regressions.
- **Files modified by review:** `packages/core/src/events/parsers.ts`, `packages/core/src/events/builders.ts`, `packages/core/src/events/swap-pair-parser.test.ts`, `packages/core/src/events/swap-pair-builder.test.ts`.
- **Action items / follow-up tasks:** None. All findings were resolved inline during the review pass.
- **Outcome:** APPROVED.

### Review Pass #3 — 2026-04-10

- **Reviewer:** Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`
- **Scope:** Final security-focused code review with OWASP Top 10 scan across the full story 12.1 surface (`SwapPair` type, `IlpPeerInfo.swapPairs`, shared validation helper, builder/parser integration, all test files). Emphasis on injection, DoS, prototype pollution, ReDoS, and auth/authz boundaries.
- **Findings by severity:** 0 Critical / 0 High / 0 Medium / 1 Low
  - **Low (1):** BigInt DoS hardening — attacker-supplied `rate`, `minAmount`, or `maxAmount` strings of pathological length (e.g., tens of thousands of digits) would have forced `BigInt(x)` construction with super-linear cost on every validation call. **Fixed inline** by introducing `MAX_NUMERIC_STRING_LENGTH = 80` in `swap-pair-validation.ts` and rejecting any numeric string that exceeds the cap before handing it to `BigInt`. 80 characters is ~2× the digit count of `2^256` and far beyond any legitimate on-chain amount or decimal rate, while keeping validation strictly O(n) in input size.
- **Security review summary:**
  - **OWASP A03 (Injection):** Safe. No dynamic code paths, no SQL/NoSQL, no command surface. All string inputs go through strict regex allow-lists.
  - **OWASP A04 (Insecure Design / DoS):** Hardened via `MAX_NUMERIC_STRING_LENGTH` cap (see Low finding above).
  - **OWASP A08 (Software & Data Integrity — prototype pollution):** Safe. `isObject` rejects arrays and null; no dynamic key assignment from untrusted input; no use of `Object.assign` with attacker-controlled sources.
  - **ReDoS:** Verified linear-time. Rate regex `/^(0|[1-9]\d*)(\.\d+)?$/` and amount regex `/^\d+$/` contain no nested quantifiers or alternations with overlapping prefixes — safe under pathological input.
  - **Auth / Authz:** Out of scope. Story 12.1 is pure data validation; authorization lives at the ILP packet and Nostr signature layer in downstream stories.
- **Security tests added:** 4 new boundary tests in `swap-pair-validation.test.ts` covering the `MAX_NUMERIC_STRING_LENGTH` guard for `rate`, `minAmount`, `maxAmount`, and the exact 80-character boundary.
- **Verification:** `pnpm --filter @toon-protocol/core build` clean; full core test suite 2418 tests green (4 new security boundary tests added); no regressions.
- **Files modified by review:** `packages/core/src/events/swap-pair-validation.ts`, `packages/core/src/events/swap-pair-validation.test.ts`.
- **Action items / follow-up tasks:** None. All findings were resolved inline during the review pass.
- **Outcome:** APPROVED — final pass. Story status → done.
- **Outcome:** APPROVED — story remains in `review` status pending final pipeline gate to `done`.
