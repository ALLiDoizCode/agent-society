# Story 11.14: Pet Marketplace

Status: done
ui_impact: false

## Story

As a TOON Protocol developer,
I want client-side utilities in `@toon-protocol/client` for listing pets for sale (kind:30402 classified listings), discovering listings, and building purchase requests (kind:5900 DVM),
so that pet owners can trade pets peer-to-peer with ILP-gated payment and verified biography (lifecycleHash + totalSpent) attached to every listing.

## Dependencies

- **Upstream:** Story 11-3 (PetZkApp SmartContract) — `lifecycleHash`, `totalSpent`, `ownerX` on-chain fields are the biography source that listings reference. DONE.
- **Upstream:** Story 11-5 (Pet DVM Handler) — Kind 5900/6900 request/response pattern used for the purchase flow. DONE.
- **Upstream:** Story 11-9 (Ditto Pet DVM Integration) — Client-side pet utilities pattern; new marketplace utils follow the same no-import-from-pet-dvm / browser-compatible constraint. DONE.
- **Upstream:** Story 11-13 (Breeding Circuit) — Bred pets have their own `lifecycleHash` chains starting from `PetBreeding.breed()` output; marketplace listings reference these same hash fields. DONE.
- **Shared:** `packages/client/src/pet/` — existing pet utilities; new marketplace utilities live alongside in `packages/client/src/pet/` following the same patterns.

## Acceptance Criteria

1. **AC-1 — PetListing type:** Create `PetListingParams` and `PetListing` interfaces in `packages/client/src/pet/types.ts`:
   - `PetListingParams` fields: `blobbiId` (string, non-empty), `askPriceUsdc` (number, > 0), `lifecycleHash` (string, 64-char hex), `totalSpent` (string, numeric string ≥ "0"), `stage` (number, 0|1|2), `stats` (StatValues), `sellerPubkey` (string, 64-char hex), `relayUrl` (string), `expiresAt` (number, unix timestamp > now)
   - `PetListing` extends `PetListingParams` adding `eventId` (string) and `createdAt` (number)
   - Export both from `packages/client/src/pet/types.ts`

2. **AC-2 — buildPetListingEvent():** Create `packages/client/src/pet/buildPetListingEvent.ts`:
   - Signature: `buildPetListingEvent(params: PetListingParams): UnsignedNostrEvent`
   - Produces a kind:30402 (NIP-99 classified listing) event with:
     - `d` tag: `params.blobbiId` (stable listing identifier)
     - `title` tag: `"Pet ${params.blobbiId} for sale"`
     - `price` tag: `[params.askPriceUsdc.toString(), "USDC", ""]`
     - `summary` tag: short summary string including stage name and totalSpent
     - `t` tag: `"pet"` (category)
     - `t` tag: `"toon-pet"` (TOON-specific tag for relay filtering)
     - `lifecycle_hash` tag: `params.lifecycleHash`
     - `total_spent` tag: `params.totalSpent`
     - `stage` tag: `params.stage.toString()`
     - `expiration` tag: `params.expiresAt.toString()`
     - `relay` tag: `params.relayUrl`
     - Content: JSON-serialized `StatValues` (so buyers can see stats)
   - `created_at`: current unix timestamp (Math.floor(Date.now() / 1000))
   - Export `buildPetListingEvent` from the module and from `packages/client/src/pet/index.ts`

3. **AC-3 — parsePetListing():** Create `packages/client/src/pet/parsePetListing.ts`:
   - Signature: `parsePetListing(event: { id: string; kind: number; pubkey: string; tags: string[][]; content: string; created_at: number }): PetListing | null`
   - Returns `null` if `event.kind !== 30402`
   - Returns `null` if any required tag (`d`, `price`, `lifecycle_hash`, `total_spent`, `stage`) is missing
   - Returns `null` if `d` tag value is empty
   - Returns `null` if `price` tag has fewer than 2 elements or price[0] is not a valid positive number
   - Returns `null` if `lifecycle_hash` tag value is not a 64-char hex string
   - Returns `null` if `total_spent` tag value is not a valid non-negative numeric string
   - On success, returns `PetListing` with all fields populated from tags; `stats` parsed from content JSON (or `null`-safe default if content is unparseable)
   - Export `parsePetListing` from the module and from `packages/client/src/pet/index.ts`

4. **AC-4 — filterPetListings():** Create `packages/client/src/pet/filterPetListings.ts`:
   - Signature: `filterPetListings(events: Array<{ id: string; kind: number; pubkey: string; tags: string[][]; content: string; created_at: number }>, options?: PetListingFilterOptions): PetListing[]`
   - `PetListingFilterOptions` interface in `types.ts`: `minStage?: number`, `maxAskPriceUsdc?: number`, `minTotalSpent?: string`, `sellerPubkey?: string`
   - Parses each event with `parsePetListing`, filters out `null` results
   - Filters out expired listings (expiration tag < Date.now() / 1000) when expiration tag is present
   - Applies `options.minStage` filter if provided
   - Applies `options.maxAskPriceUsdc` filter if provided
   - Applies `options.minTotalSpent` filter if provided (numeric string comparison)
   - Applies `options.sellerPubkey` filter if provided
   - Returns the filtered array sorted by `totalSpent` descending (highest biography value first)
   - Export `filterPetListings` and `PetListingFilterOptions` from `packages/client/src/pet/index.ts`

5. **AC-5 — buildPetPurchaseRequest():** Create `packages/client/src/pet/buildPetPurchaseRequest.ts`:
   - Signature: `buildPetPurchaseRequest(params: PetPurchaseRequestParams): UnsignedNostrEvent`
   - `PetPurchaseRequestParams` interface in `types.ts`: `blobbiId` (string), `listingEventId` (string), `buyerPubkey` (string, 64-char hex), `tokenCost` (number, ≥ 0), `sellerPubkey` (string, 64-char hex)
   - Returns a kind:5900 event (same pet interaction kind used in Story 11-5) with:
     - `action` tag: `"9"` (action type 9 = transfer-ownership, reserved slot)
     - `i` tag: `params.blobbiId`
     - `listing` tag: `params.listingEventId` (references the kind:30402 event)
     - `buyer` tag: `params.buyerPubkey`
     - `p` tag: `params.sellerPubkey` (routes ILP payment to seller)
     - `cost` tag: `params.tokenCost.toString()`
   - Export `buildPetPurchaseRequest` and `PetPurchaseRequestParams` from `packages/client/src/pet/index.ts`

6. **AC-6 — Unit tests — buildPetListingEvent:** Create `packages/client/src/pet/buildPetListingEvent.test.ts` with ≥ 6 tests:
   - Returns kind:30402 event
   - `d` tag equals `blobbiId`
   - `price` tag contains `askPriceUsdc`, "USDC", ""
   - `lifecycle_hash` tag equals `lifecycleHash`
   - `total_spent` tag equals `totalSpent`
   - `stage` tag equals stage string
   - `expiration` tag equals `expiresAt` string
   - Content is valid JSON parseable as `StatValues`

7. **AC-7 — Unit tests — parsePetListing:** Create `packages/client/src/pet/parsePetListing.test.ts` with ≥ 8 tests:
   - Happy path: valid kind:30402 event → populated `PetListing`
   - Wrong kind (1) → null
   - Missing `d` tag → null
   - Missing `price` tag → null
   - Missing `lifecycle_hash` tag → null
   - Invalid `lifecycle_hash` (not 64-char hex) → null
   - Missing `total_spent` tag → null
   - Invalid price (non-numeric) → null
   - `eventId` and `createdAt` populated from event `id` and `created_at`

8. **AC-8 — Unit tests — filterPetListings:** Create `packages/client/src/pet/filterPetListings.test.ts` with ≥ 6 tests:
   - Returns only valid parsed listings (invalid events filtered out)
   - Expired listings excluded
   - `minStage` filter works
   - `maxAskPriceUsdc` filter works
   - `sellerPubkey` filter works
   - Result sorted by `totalSpent` descending

9. **AC-9 — Unit tests — buildPetPurchaseRequest:** Create `packages/client/src/pet/buildPetPurchaseRequest.test.ts` with ≥ 5 tests:
   - Returns kind:5900 event
   - `action` tag is "9"
   - `i` tag equals `blobbiId`
   - `listing` tag equals `listingEventId`
   - `buyer` tag equals `buyerPubkey`
   - `p` tag equals `sellerPubkey`

10. **AC-10 — Package exports updated:** All new functions and types are exported from `packages/client/src/pet/index.ts` and from the top-level `packages/client/src/index.ts`.

11. **AC-11 — Build verification:** `pnpm --filter @toon-protocol/client build` compiles cleanly with zero TypeScript errors.

12. **AC-12 — Test verification:** `pnpm --filter @toon-protocol/client test` runs all tests (including new ones) with all passing.

## Tasks / Subtasks

- [x] Task 1: Add marketplace types (AC: 1, 5)
  - [x] 1.1 Add `PetListingParams`, `PetListing`, `PetListingFilterOptions`, `PetPurchaseRequestParams` to `packages/client/src/pet/types.ts`

- [x] Task 2: Implement buildPetListingEvent (AC: 2)
  - [x] 2.1 Create `packages/client/src/pet/buildPetListingEvent.ts`
  - [x] 2.2 Write unit tests in `packages/client/src/pet/buildPetListingEvent.test.ts` (15 tests)

- [x] Task 3: Implement parsePetListing (AC: 3)
  - [x] 3.1 Create `packages/client/src/pet/parsePetListing.ts`
  - [x] 3.2 Write unit tests in `packages/client/src/pet/parsePetListing.test.ts` (22 tests)

- [x] Task 4: Implement filterPetListings (AC: 4)
  - [x] 4.1 Create `packages/client/src/pet/filterPetListings.ts`
  - [x] 4.2 Write unit tests in `packages/client/src/pet/filterPetListings.test.ts` (10 tests)

- [x] Task 5: Implement buildPetPurchaseRequest (AC: 5)
  - [x] 5.1 Create `packages/client/src/pet/buildPetPurchaseRequest.ts`
  - [x] 5.2 Write unit tests in `packages/client/src/pet/buildPetPurchaseRequest.test.ts` (10 tests)

- [x] Task 6: Update package exports (AC: 10)
  - [x] 6.1 Export all new functions and types from `packages/client/src/pet/index.ts`
  - [x] 6.2 Export new symbols from `packages/client/src/index.ts`

- [x] Task 7: Build and test verification (AC: 11, 12)
  - [x] 7.1 `pnpm --filter @toon-protocol/client build` — PASS (61ms, zero TypeScript errors)
  - [x] 7.2 `pnpm --filter @toon-protocol/client test` — PASS (364 tests, 21 files, 2.98s)

## Dev Notes

### Architecture & Design Philosophy

This story implements the **client-side half** of pet marketplace trading. There is no new DVM server-side handler — the marketplace uses:
1. **NIP-99 kind:30402** — parameterized replaceable classified listings. Pet owners publish listings; buyers discover via relay subscription.
2. **Kind:5900** — existing pet interaction event kind, with action type 9 (transfer-ownership) as the purchase signal. The actual ownership transfer on Mina (PetZkApp.transferOperator) is an out-of-scope follow-up (requires Mina TX signing infrastructure).

The `lifecycleHash` and `totalSpent` fields in every listing serve as the **verified biography attachment** — a buyer can verify the listing's claimed biography against the Mina chain.

### Browser-Compatible Constraint

All new utilities MUST be browser-compatible — no Node.js-only imports. Follow the same pattern as `packages/client/src/pet/buildPetInteractionRequest.ts`:
- No imports from `@toon-protocol/pet-dvm`
- No imports from `@toon-protocol/pet-circuit`
- No imports from `@toon-protocol/memvid-node`
- Pure TypeScript + standard Web APIs only

### Kind Numbers

| Kind | Name | Usage |
|------|------|-------|
| 30402 | Classified Listing (NIP-99) | Pet-for-sale listing (parameterized replaceable, `d` = blobbiId) |
| 5900 | Pet Interaction Request | Reused for purchase requests (action type 9 = transfer-ownership) |

### Action Type 9 Reservation

Action type 9 ("transfer-ownership") is a reserved slot in the pet DVM protocol — it is not currently handled by `createPetDvmHandler`. The purchase request event signals intent; the actual Mina ownership transfer is out of scope for this story. This is intentional: the client-side protocol shape is defined now so downstream stories (Overmind Treasury, etc.) can implement the server-side handler.

### Tag Schema for kind:30402 Pet Listing

```
["d", "<blobbiId>"]                    -- stable listing identifier
["title", "Pet <blobbiId> for sale"]   -- display title
["price", "<askPriceUsdc>", "USDC", ""]-- price tag (NIP-99 format)
["summary", "..."]                     -- short description
["t", "pet"]                           -- category tag
["t", "toon-pet"]                      -- TOON-specific tag
["lifecycle_hash", "<64-char hex>"]    -- verified biography hash
["total_spent", "<numeric string>"]    -- cumulative PET tokens
["stage", "0"|"1"|"2"]                -- egg/baby/adult
["expiration", "<unix timestamp>"]     -- listing expiry
["relay", "<wss://...>"]               -- preferred relay URL
```

Content: JSON-serialized `StatValues` (hunger, happiness, health, hygiene, energy as numbers 1-100)

### Testing Pattern

Use **Vitest** (not Jest) — the `@toon-protocol/client` package uses Vitest with the standard `pnpm --filter @toon-protocol/client test` command. No WASM issues — no o1js dependency. Tests should be fast (< 1s total).

Follow the existing test pattern in `packages/client/src/pet/buildPetInteractionRequest.test.ts`:
- Import only from local relative paths
- Use plain objects for test fixtures (no relay library required)
- Test validation logic exhaustively

### Project Structure Notes

New files live in `packages/client/src/pet/`:
- `buildPetListingEvent.ts` + `.test.ts`
- `parsePetListing.ts` + `.test.ts`
- `filterPetListings.ts` + `.test.ts`
- `buildPetPurchaseRequest.ts` + `.test.ts`

All exported from `packages/client/src/pet/index.ts` (add to existing exports) and `packages/client/src/index.ts` (add to Pet DVM Utilities section).

### References

- [Source: packages/client/src/pet/types.ts] — existing type patterns, `StatValues`, `UnsignedNostrEvent`
- [Source: packages/client/src/pet/buildPetInteractionRequest.ts] — builder pattern, kind 5900 tag construction
- [Source: packages/client/src/pet/filterPetDvmProviders.ts] — filter function pattern
- [Source: packages/client/src/pet/parsePetInteractionEvent.ts] — parser pattern, null-safe tag extraction
- [Source: packages/client/src/pet/index.ts] — export pattern
- [Source: .claude/skills/marketplace/SKILL.md] — NIP-99 kind:30402 tag schema, `price` tag format
- [Source: _bmad-output/planning-artifacts/toon-pet-zkapp-architecture-handoff.md#Phase-4] — "Pet marketplace — On-chain pet trading with verified biography"
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#Story-11-14] — Test strategy: list/buy/transfer (4 unit), verified biography (2 unit), integration (1)
- [Source: _bmad-output/implementation-artifacts/11-13-breeding-circuit.md] — `lifecycleHash` from bred pets, downstream dependency note
- [Source: _bmad-output/implementation-artifacts/11-3-pet-zkapp-smartcontract.md] — `lifecycleHash`, `totalSpent`, `ownerX` on-chain fields

## Code Review Record

### Review Pass #3 (Final)

- **Date:** 2026-04-09
- **Reviewer:** Claude Sonnet 4.6
- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 1 — `compareNumericStrings` fallback path could produce NaN if both BigInt conversion and Number conversion fail (e.g., caller passes invalid `minTotalSpent`). Fixed: added explicit `Number.isFinite` guard, treating NaN as less than any valid number.
- **Security (OWASP):** No injection vectors (pure data shaping, no I/O). No auth/authz logic. No SQL, shell, or eval. Prototype pollution prevented by explicit field extraction in `parseStats`. Tag validation regex prevents malformed hex. All clean.
- **Outcome:** All issues fixed, 367/367 tests passing. Story is DONE.

### Review Pass #2

- **Date:** 2026-04-09
- **Reviewer:** Claude Sonnet 4.6
- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 1 — `buildPetPurchaseRequest` used a local `const PET_INTERACTION_REQUEST_KIND = 5900` instead of importing from `@toon-protocol/core` (inconsistent with `buildPetInteractionRequest.ts`). Fixed: now imports from core. Added clarifying comment on `buildPetListingEvent`'s local `PET_LISTING_KIND` explaining it isn't in core yet.
- **Outcome:** All issues fixed, 367/367 tests passing.

### Review Pass #1

- **Date:** 2026-04-09
- **Reviewer:** Claude Sonnet 4.6
- **Critical:** 0
- **High:** 0
- **Medium:** 1 — `filterPetListings` had duplicate `getTagValue` helper and re-read raw event tags for expiry instead of using already-parsed `listing.expiresAt`. Fixed: removed redundant helper, use `listing.expiresAt` directly.
- **Low:** 1 — `DEFAULT_STATS` used zero values (outside [1,100] game range) without explanation. Fixed: added clarifying comment marking zeros as "stats unknown / content malformed" sentinel.
- **Outcome:** All issues fixed, 367/367 tests passing.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

None.

### Completion Notes List

- Four new browser-compatible utility modules added to `packages/client/src/pet/`: `buildPetListingEvent`, `parsePetListing`, `filterPetListings`, `buildPetPurchaseRequest`.
- Four new marketplace types added to `types.ts`: `PetListingParams`, `PetListing`, `PetListingFilterOptions`, `PetPurchaseRequestParams`.
- All utilities follow the existing no-pet-dvm / no-pet-circuit / no-memvid-node browser-compatible constraint.
- `buildPetListingEvent` produces NIP-99 kind:30402 classified listings with TOON-specific biography tags (`lifecycle_hash`, `total_spent`).
- `parsePetListing` validates all required tags with strict `noUncheckedIndexedAccess`-safe bracket notation; malformed content falls back to zero stats without throwing.
- `filterPetListings` uses BigInt comparison for `totalSpent` to correctly handle large PET token amounts; sorts highest biography value first.
- `buildPetPurchaseRequest` uses action type 9 (reserved transfer-ownership slot) on kind:5900; server-side handler is out of scope.
- 57 new tests across 4 test files; all 364 tests in the package pass.
- Build passes cleanly with zero TypeScript errors (strict mode + `noUncheckedIndexedAccess`).

### File List

- `packages/client/src/pet/types.ts` — MODIFIED: added `PetListingParams`, `PetListing`, `PetListingFilterOptions`, `PetPurchaseRequestParams`
- `packages/client/src/pet/buildPetListingEvent.ts` — NEW: kind:30402 listing event builder
- `packages/client/src/pet/buildPetListingEvent.test.ts` — NEW: 15 unit tests
- `packages/client/src/pet/parsePetListing.ts` — NEW: kind:30402 listing parser
- `packages/client/src/pet/parsePetListing.test.ts` — NEW: 22 unit tests
- `packages/client/src/pet/filterPetListings.ts` — NEW: listing discovery filter/sorter
- `packages/client/src/pet/filterPetListings.test.ts` — NEW: 10 unit tests
- `packages/client/src/pet/buildPetPurchaseRequest.ts` — NEW: kind:5900 purchase request builder
- `packages/client/src/pet/buildPetPurchaseRequest.test.ts` — NEW: 10 unit tests
- `packages/client/src/pet/index.ts` — MODIFIED: added marketplace utility and type exports
- `packages/client/src/index.ts` — MODIFIED: added marketplace utility and type re-exports

### Change Log

- 2026-04-09: Story 11-14 created and ready for development.
- 2026-04-09: Implementation complete. Four marketplace utilities, four new types, 57 tests. Build and all 364 tests pass. Status → review.
