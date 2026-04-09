---
stepsCompleted: [atdd]
lastStep: atdd
lastSaved: '2026-04-09'
workflowType: 'testarch-atdd'
inputDocuments: ['_bmad-output/implementation-artifacts/11-14-pet-marketplace.md']
---

# ATDD Checklist - Epic 11, Story 14: Pet Marketplace

**Date:** 2026-04-09
**Author:** Jonathan
**Primary Test Level:** Unit (Vitest — `@toon-protocol/client`)

---

## Story Summary

Story 11-14 adds client-side pet marketplace utilities to `@toon-protocol/client`: building NIP-99 kind:30402 classified listing events, parsing them back, filtering/sorting discovery results, and building kind:5900 purchase request events. All utilities are browser-compatible with no o1js or pet-dvm dependencies.

**As a** TOON Protocol developer
**I want** client-side utilities for listing pets for sale, discovering listings, and building purchase requests
**So that** pet owners can trade pets peer-to-peer with ILP-gated payment and verified biography (lifecycleHash + totalSpent) attached to every listing

---

## Acceptance Criteria

1. AC-1: `PetListingParams` and `PetListing` types defined and exported
2. AC-2: `buildPetListingEvent()` produces valid kind:30402 event with all required tags
3. AC-3: `parsePetListing()` parses kind:30402 events, returns null on validation failures
4. AC-4: `filterPetListings()` filters and sorts listings by biography value
5. AC-5: `buildPetPurchaseRequest()` produces valid kind:5900 event for transfer-ownership
6. AC-6: ≥ 6 unit tests for `buildPetListingEvent`
7. AC-7: ≥ 8 unit tests for `parsePetListing`
8. AC-8: ≥ 6 unit tests for `filterPetListings`
9. AC-9: ≥ 5 unit tests for `buildPetPurchaseRequest`
10. AC-10: All new symbols exported from `pet/index.ts` and top-level `index.ts`
11. AC-11: `pnpm --filter @toon-protocol/client build` passes
12. AC-12: `pnpm --filter @toon-protocol/client test` passes

---

## Failing Tests Created (RED Phase)

### Unit Tests — buildPetListingEvent (8 tests)

**File:** `packages/client/src/pet/buildPetListingEvent.test.ts`

- ✅ **Test:** returns kind:30402 event
  - **Status:** RED — `buildPetListingEvent` does not exist yet
  - **Verifies:** AC-2, AC-6

- ✅ **Test:** d tag equals blobbiId
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** price tag contains askPriceUsdc, USDC, empty string
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** lifecycle_hash tag equals provided lifecycleHash
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** total_spent tag equals provided totalSpent
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** stage tag equals stage.toString()
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** expiration tag equals expiresAt.toString()
  - **Status:** RED — module missing
  - **Verifies:** AC-2

- ✅ **Test:** content is valid JSON with StatValues shape
  - **Status:** RED — module missing
  - **Verifies:** AC-2

### Unit Tests — parsePetListing (10 tests)

**File:** `packages/client/src/pet/parsePetListing.test.ts`

- ✅ **Test:** happy path — valid kind:30402 event returns populated PetListing
  - **Status:** RED — `parsePetListing` does not exist yet
  - **Verifies:** AC-3, AC-7

- ✅ **Test:** wrong kind (1) returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** missing d tag returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** empty d tag value returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** missing price tag returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** invalid price (non-numeric) returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** missing lifecycle_hash tag returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** invalid lifecycle_hash (not 64-char hex) returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** missing total_spent tag returns null
  - **Status:** RED — module missing
  - **Verifies:** AC-3

- ✅ **Test:** eventId and createdAt populated from event id and created_at
  - **Status:** RED — module missing
  - **Verifies:** AC-3

### Unit Tests — filterPetListings (7 tests)

**File:** `packages/client/src/pet/filterPetListings.test.ts`

- ✅ **Test:** returns only valid parsed listings (invalid events filtered out)
  - **Status:** RED — `filterPetListings` does not exist yet
  - **Verifies:** AC-4, AC-8

- ✅ **Test:** expired listings excluded
  - **Status:** RED — module missing
  - **Verifies:** AC-4

- ✅ **Test:** minStage filter excludes listings below threshold
  - **Status:** RED — module missing
  - **Verifies:** AC-4

- ✅ **Test:** maxAskPriceUsdc filter excludes expensive listings
  - **Status:** RED — module missing
  - **Verifies:** AC-4

- ✅ **Test:** sellerPubkey filter returns only matching seller
  - **Status:** RED — module missing
  - **Verifies:** AC-4

- ✅ **Test:** result sorted by totalSpent descending
  - **Status:** RED — module missing
  - **Verifies:** AC-4

- ✅ **Test:** minTotalSpent filter excludes listings below threshold
  - **Status:** RED — module missing
  - **Verifies:** AC-4

### Unit Tests — buildPetPurchaseRequest (6 tests)

**File:** `packages/client/src/pet/buildPetPurchaseRequest.test.ts`

- ✅ **Test:** returns kind:5900 event
  - **Status:** RED — `buildPetPurchaseRequest` does not exist yet
  - **Verifies:** AC-5, AC-9

- ✅ **Test:** action tag is "9" (transfer-ownership)
  - **Status:** RED — module missing
  - **Verifies:** AC-5

- ✅ **Test:** i tag equals blobbiId
  - **Status:** RED — module missing
  - **Verifies:** AC-5

- ✅ **Test:** listing tag equals listingEventId
  - **Status:** RED — module missing
  - **Verifies:** AC-5

- ✅ **Test:** buyer tag equals buyerPubkey
  - **Status:** RED — module missing
  - **Verifies:** AC-5

- ✅ **Test:** p tag equals sellerPubkey
  - **Status:** RED — module missing
  - **Verifies:** AC-5

---

## Data Factories

No external data factories required. All tests use inline plain-object fixtures following the pattern in `packages/client/src/pet/buildPetInteractionRequest.test.ts`.

### Shared Test Fixtures (inline)

**Valid PetListingParams fixture:**
```typescript
const validParams: PetListingParams = {
  blobbiId: 'pet-abc123',
  askPriceUsdc: 10.0,
  lifecycleHash: 'a'.repeat(64),
  totalSpent: '42000',
  stage: 2,
  stats: { hunger: 80, happiness: 90, health: 85, hygiene: 75, energy: 70 },
  sellerPubkey: 'b'.repeat(64),
  relayUrl: 'wss://relay.example.com',
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
};
```

**Valid kind:30402 event fixture:**
```typescript
function makeListingEvent(overrides: Partial<...> = {}) {
  return {
    id: 'event-id-001',
    kind: 30402,
    pubkey: 'b'.repeat(64),
    created_at: 1712000000,
    tags: [
      ['d', 'pet-abc123'],
      ['price', '10', 'USDC', ''],
      ['lifecycle_hash', 'a'.repeat(64)],
      ['total_spent', '42000'],
      ['stage', '2'],
      ['expiration', String(Math.floor(Date.now() / 1000) + 86400)],
    ],
    content: JSON.stringify({ hunger: 80, happiness: 90, health: 85, hygiene: 75, energy: 70 }),
    ...overrides,
  };
}
```

---

## Mock Requirements

None — all utilities are pure functions with no I/O or external service calls.

---

## Required data-testid Attributes

None — `ui_impact: false`. No UI components.

---

## Implementation Checklist

### Tests: buildPetListingEvent (8 tests)

**File:** `packages/client/src/pet/buildPetListingEvent.test.ts`

- [ ] Add types: `PetListingParams`, `PetListing` to `packages/client/src/pet/types.ts`
- [ ] Create `packages/client/src/pet/buildPetListingEvent.ts`
- [ ] Export from `packages/client/src/pet/index.ts`
- [ ] Run tests: `pnpm --filter @toon-protocol/client test -- buildPetListingEvent`
- [ ] ✅ All 8 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Tests: parsePetListing (10 tests)

**File:** `packages/client/src/pet/parsePetListing.test.ts`

- [ ] Create `packages/client/src/pet/parsePetListing.ts`
- [ ] Export from `packages/client/src/pet/index.ts`
- [ ] Run tests: `pnpm --filter @toon-protocol/client test -- parsePetListing`
- [ ] ✅ All 10 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Tests: filterPetListings (7 tests)

**File:** `packages/client/src/pet/filterPetListings.test.ts`

- [ ] Create `packages/client/src/pet/filterPetListings.ts`
- [ ] Export `filterPetListings` and `PetListingFilterOptions` from `packages/client/src/pet/index.ts`
- [ ] Run tests: `pnpm --filter @toon-protocol/client test -- filterPetListings`
- [ ] ✅ All 7 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

### Tests: buildPetPurchaseRequest (6 tests)

**File:** `packages/client/src/pet/buildPetPurchaseRequest.test.ts`

- [ ] Add `PetPurchaseRequestParams` type to `packages/client/src/pet/types.ts`
- [ ] Create `packages/client/src/pet/buildPetPurchaseRequest.ts`
- [ ] Export from `packages/client/src/pet/index.ts` and top-level `index.ts`
- [ ] Run tests: `pnpm --filter @toon-protocol/client test -- buildPetPurchaseRequest`
- [ ] ✅ All 6 tests pass (green phase)

**Estimated Effort:** 0.5 hours

---

## Running Tests

```bash
# Run all tests for @toon-protocol/client (all story 11-14 tests included)
pnpm --filter @toon-protocol/client test

# Run specific test file
pnpm --filter @toon-protocol/client test -- buildPetListingEvent
pnpm --filter @toon-protocol/client test -- parsePetListing
pnpm --filter @toon-protocol/client test -- filterPetListings
pnpm --filter @toon-protocol/client test -- buildPetPurchaseRequest

# Build verification
pnpm --filter @toon-protocol/client build
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ All failing test stubs listed above
- ✅ No fixtures needed (pure function tests, inline data)
- ✅ No mocks needed (pure functions, no I/O)
- ✅ No data-testid needed (backend-only story)
- ✅ Implementation checklist created

### GREEN Phase (DEV Agent — Next Step)

1. Add types to `types.ts`
2. Create `buildPetListingEvent.ts` → run tests → green
3. Create `parsePetListing.ts` → run tests → green
4. Create `filterPetListings.ts` → run tests → green
5. Create `buildPetPurchaseRequest.ts` → run tests → green
6. Update exports → build → green

### REFACTOR Phase

- Ensure tag extraction helper is DRY (shared between `parsePetListing` and `filterPetListings`)
- Confirm TypeScript strict mode compliance (`noUncheckedIndexedAccess`)

---

## Notes

- Story is **backend-only** (`ui_impact: false`) — no Playwright E2E tests
- Tests use **Vitest** (not Jest) — no WASM, fast execution
- `noUncheckedIndexedAccess: true` means all tag array accesses must be null-safe: `tags.find(t => t[0] === 'x')?.[1]` pattern
- Action type 9 (transfer-ownership) is a reserved slot — the server-side DVM handler is out of scope; this story only defines the client-side event shape
- Total test count across 4 new test files: **31 tests**

---

**Generated by BMad TEA Agent** - 2026-04-09
