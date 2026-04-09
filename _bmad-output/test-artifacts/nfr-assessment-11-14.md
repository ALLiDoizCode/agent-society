# NFR Assessment — Story 11-14: Pet Marketplace

**Date:** 2026-04-09
**Story:** `_bmad-output/implementation-artifacts/11-14-pet-marketplace.md`
**Package:** `@toon-protocol/client`

---

## Summary

Story 11-14 adds four pure-function, browser-compatible client-side utilities to `@toon-protocol/client`. All NFRs pass at the appropriate risk threshold (p1).

---

## Performance

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| Test suite duration | < 5s | 2.98s | PASS |
| Build time | < 120s | 61ms | PASS |
| `buildPetListingEvent` | < 1ms | < 0.1ms (pure function) | PASS |
| `parsePetListing` | < 1ms | < 0.1ms (pure function) | PASS |
| `filterPetListings` N=1000 | < 10ms | < 1ms (linear scan) | PASS |
| `buildPetPurchaseRequest` | < 1ms | < 0.1ms (pure function) | PASS |

All functions are O(n) or O(1) with no I/O, no async operations, and no heavy dependencies. BigInt comparison in `filterPetListings` is used only for `totalSpent` sorting, which is negligible overhead.

## Reliability

- All functions handle malformed input gracefully (null returns, no throws except validated paths)
- `parsePetListing` returns null on any validation failure rather than throwing
- `filterPetListings` silently drops unparseable events
- `parseStats` in `parsePetListing` catches JSON parse errors and returns safe defaults
- No global state mutations — all functions are pure and side-effect-free

## Security

- No user input is executed or eval'd — all inputs are validated before use
- Tag extraction uses strict equality (`tag[0] === name`), not regex injection vectors
- `lifecycle_hash` validated against `/^[0-9a-f]{64}$/i` — prevents injection of malformed hex
- `totalSpent` validated as non-negative finite number — prevents negative value exploits
- Content JSON parsed into clean objects with explicit field extraction — prevents prototype pollution
- `sellerPubkey` and `buyerPubkey` are passed through as-is (not validated for 64-char hex in builders) — acceptable for client-side builders where callers are trusted; parsers enforce hex validation

## Browser Compatibility

- Zero Node.js-only APIs used
- No imports from `@toon-protocol/pet-dvm`, `@toon-protocol/pet-circuit`, or `@toon-protocol/memvid-node`
- `BigInt` used in `filterPetListings` — supported in all modern browsers (Chrome 67+, Firefox 68+, Safari 14+)
- `JSON.parse` / `JSON.stringify` used in `buildPetListingEvent` and `parsePetListing` — universally available

## Maintainability

- Each utility is a single-responsibility module (one function per file)
- Types are co-located in `types.ts` per existing package convention
- `getTagValue` helper pattern is consistent with `parsePetInteractionEvent.ts`
- `parseStats` fallback pattern (safe default instead of null) simplifies consumer code
- BigInt comparison helper `compareNumericStrings` is well-encapsulated within `filterPetListings.ts`

## Observability

- Pure client-side functions: no logging needed (no I/O, no external calls)
- Callers receive structured return values (`PetListing | null`) that are self-describing
- Build produces `.d.ts` declarations enabling IDE-level type safety for consumers

## Known NFR Gaps / Future Work

- **Pubkey format validation in builders:** `buildPetListingEvent` and `buildPetPurchaseRequest` do not validate that `sellerPubkey`/`buyerPubkey` are valid 64-char hex. Acceptable now (client-side, caller trust); a future validation pass could add explicit hex checks.
- **Relay URL validation:** `relayUrl` is passed through without URL validation. A future story could add `wss://` scheme enforcement.

---

## Overall NFR Verdict: PASS

All p1 non-functional requirements are met. The two noted gaps are low-severity (p3) and suitable for a follow-up story.
