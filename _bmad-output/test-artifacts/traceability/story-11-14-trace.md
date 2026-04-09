# Traceability Matrix — Story 11-14: Pet Marketplace

**Date:** 2026-04-09
**Story file:** `_bmad-output/implementation-artifacts/11-14-pet-marketplace.md`
**Package:** `@toon-protocol/client`
**Test runner:** Vitest
**Test command:** `pnpm --filter @toon-protocol/client test`

---

## Acceptance Criteria Coverage

| AC | Description | Test File(s) | Test Name(s) | Status |
|----|-------------|--------------|--------------|--------|
| AC-1 | `PetListingParams` and `PetListing` types defined and exported | `buildPetListingEvent.test.ts`, `parsePetListing.test.ts`, `filterPetListings.test.ts`, `buildPetPurchaseRequest.test.ts` | All tests import and use these types; TypeScript build validates exports | COVERED |
| AC-2 | `buildPetListingEvent()` produces valid kind:30402 event with all required tags | `buildPetListingEvent.test.ts` | "returns a kind:30402 event", "d tag equals blobbiId", "price tag contains…", "lifecycle_hash tag…", "total_spent tag…", "stage tag…", "expiration tag…", "content is valid JSON", "relay tag…", "p tag…", "title tag…", "t tags include pet and toon-pet", "created_at…", "stage 0 produces Egg", "stage 1 produces Baby", "verified biography — both lifecycle_hash and total_spent present together" | COVERED (16 tests) |
| AC-3 | `parsePetListing()` parses kind:30402 events, returns null on validation failures | `parsePetListing.test.ts` | "happy path…", "eventId populated…", "createdAt populated…", "wrong kind (1)…", "wrong kind (5900)…", "missing d tag…", "empty d tag…", "missing price…", "invalid price…", "zero price…", "negative price…", "missing lifecycle_hash…", "invalid lifecycle_hash (not 64-char)…", "invalid lifecycle_hash (63 chars)…", "missing total_spent…", "negative total_spent…", "missing stage…", "unparseable content…", "missing content stats…", "sellerPubkey…", "relayUrl…", "expiresAt…", "verified biography round-trip" | COVERED (23 tests) |
| AC-4 | `filterPetListings()` filters and sorts listings by biography value | `filterPetListings.test.ts` | "returns only valid parsed listings…", "expired listings excluded", "listings without expiration tag are not excluded", "minStage filter…", "maxAskPriceUsdc filter…", "sellerPubkey filter…", "result sorted by totalSpent descending", "minTotalSpent filter…", "empty events array…", "minTotalSpent boundary…", "combined filters…" | COVERED (11 tests) |
| AC-5 | `buildPetPurchaseRequest()` produces valid kind:5900 event for transfer-ownership | `buildPetPurchaseRequest.test.ts` | "returns a kind:5900 event", "action tag is '9'…", "i tag equals blobbiId", "listing tag equals listingEventId", "buyer tag equals buyerPubkey", "p tag equals sellerPubkey", "cost tag…", "content is empty string", "created_at…", "tokenCost of 0 is valid…" | COVERED (10 tests) |
| AC-6 | ≥ 6 unit tests for `buildPetListingEvent` | `buildPetListingEvent.test.ts` | 16 tests | COVERED (16 ≥ 6) |
| AC-7 | ≥ 8 unit tests for `parsePetListing` | `parsePetListing.test.ts` | 23 tests | COVERED (23 ≥ 8) |
| AC-8 | ≥ 6 unit tests for `filterPetListings` | `filterPetListings.test.ts` | 11 tests | COVERED (11 ≥ 6) |
| AC-9 | ≥ 5 unit tests for `buildPetPurchaseRequest` | `buildPetPurchaseRequest.test.ts` | 10 tests | COVERED (10 ≥ 5) |
| AC-10 | All new symbols exported from `pet/index.ts` and top-level `index.ts` | Build validation | TypeScript DTS build validates all re-exports at compile time | COVERED (build) |
| AC-11 | `pnpm --filter @toon-protocol/client build` passes | CI (manual) | Build output: "⚡️ Build success in ~45ms", zero TS errors | COVERED |
| AC-12 | `pnpm --filter @toon-protocol/client test` passes | All 4 new test files | 367/367 tests passing | COVERED |

---

## Test File Summary

| Test File | Tests | AC Coverage |
|-----------|-------|-------------|
| `packages/client/src/pet/buildPetListingEvent.test.ts` | 16 | AC-2, AC-6 |
| `packages/client/src/pet/parsePetListing.test.ts` | 23 | AC-3, AC-7 |
| `packages/client/src/pet/filterPetListings.test.ts` | 11 | AC-4, AC-8 |
| `packages/client/src/pet/buildPetPurchaseRequest.test.ts` | 10 | AC-5, AC-9 |
| **Total new tests** | **60** | All ACs |

*(Note: final test count is 367 total in package; 307 pre-existing + 60 new)*

---

## Uncovered ACs

None. All 12 acceptance criteria are covered by automated tests or build verification.

---

## Traceability Notes

- AC-1 (types) is verified implicitly: TypeScript strict mode + `noUncheckedIndexedAccess` means any type mismatch or missing export fails the build. The DTS build producing `dist/index.d.ts` (61KB) confirms all types are exported correctly.
- AC-10 (exports) is verified by the build: if any re-export were missing, TypeScript compilation would fail with "Module has no exported member" errors.
- AC-11 and AC-12 are verified by direct command execution during pipeline Steps 7-8 and 19-20.
- Verified biography attachment (AC-1 intent) is explicitly tested in `buildPetListingEvent.test.ts` ("verified biography — both lifecycle_hash and total_spent present together") and `parsePetListing.test.ts` ("verified biography — lifecycleHash and totalSpent round-trip correctly").
