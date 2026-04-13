# Traceability Matrix: Story 12-2 (NIP-59 Gift Wrap Integration for ILP Packets)

Generated: 2026-04-13
Test file: `packages/sdk/src/gift-wrap.test.ts`

## AC-to-Test Mapping

| AC | Description | Test(s) | Status |
|----|-------------|---------|--------|
| **AC-1** | `wrapSwapPacket()` function | `wrapSwapPacket() — AC-1` — `T-009: produces a kind:1059 gift wrap outer event`, `T-009: gift wrap outer event is signed (has sig and id)`, `T-009: gift wrap outer event has p tag with recipientPubkey`, `T-009: gift wrap pubkey is the ephemeral key (not sender key)`; `Ephemeral key uniqueness — T-011` — `T-011: 100 consecutive wraps produce 100 distinct ephemeral pubkeys`; `Input validation` — `wrapSwapPacket() rejects invalid senderSecretKey (wrong length)`, `wrapSwapPacket() rejects invalid recipientPubkey (wrong format)` | Covered |
| **AC-2** | `unwrapSwapPacket()` function | `unwrapSwapPacket() — AC-2` — `T-010: recovers original rumor content and sender pubkey`, `T-010: recovered rumor is unsigned (no sig field)`, `T-015: throws GiftWrapError with wrong recipient secret key`, `throws GiftWrapError for non-1059 kind event`, `throws GiftWrapError for malformed gift wrap content (garbled ciphertext)`; `unwrapSwapPacket() — rumor unsigned fields` — `T-010: recovered rumor has no sig field (unsigned inner event)`; `Input validation` — `unwrapSwapPacket() rejects invalid recipientSecretKey`, `unwrapSwapPacket() rejects null/undefined giftWrap` | Covered |
| **AC-3** | `wrapSwapPacketToToon()` convenience function | `wrapSwapPacketToToon() / unwrapSwapPacketFromToon() — AC-3 / AC-4` — `T-014: TOON binary roundtrip`, `wrapSwapPacketToToon() returns a valid IlpPreparePacket with base64 data`, `unwrapSwapPacketFromToon() correctly chains TOON decode + unwrap`; `wrapSwapPacketToToon() — expiresAt parameter` — `accepts a custom expiresAt date` | Covered |
| **AC-4** | `unwrapSwapPacketFromToon()` convenience function | `wrapSwapPacketToToon() / unwrapSwapPacketFromToon() — AC-3 / AC-4` — `T-014: TOON binary roundtrip`, `unwrapSwapPacketFromToon() correctly chains TOON decode + unwrap`; `unwrapSwapPacketFromToon() — error paths` — `throws GiftWrapError for invalid TOON binary data`, `throws GiftWrapError for empty TOON data`; `Input validation` — `unwrapSwapPacketFromToon() rejects non-Uint8Array toonData` | Covered |
| **AC-5** | `encryptFulfillClaim()` function | `FULFILL encryption — AC-5 / AC-6` — `encryptFulfillClaim() -> decryptFulfillClaim() roundtrip recovers original claim`, `FULFILL ephemeral key uniqueness: multiple calls produce distinct keys`; `FULFILL encryption — edge cases` — `throws GiftWrapError for empty claim data`, `handles large claim data (4 KB)`; `Input validation` — `encryptFulfillClaim() rejects invalid senderPubkey`, `encryptFulfillClaim() rejects non-Uint8Array claimData` | Covered |
| **AC-6** | `decryptFulfillClaim()` function | `FULFILL encryption — AC-5 / AC-6` — `encryptFulfillClaim() -> decryptFulfillClaim() roundtrip recovers original claim`, `FULFILL wrong key rejects: decryptFulfillClaim() with wrong key throws GiftWrapError`; `Input validation` — `decryptFulfillClaim() rejects invalid ephemeralPubkey`, `decryptFulfillClaim() rejects empty ciphertext` | Covered |
| **AC-7** | `GiftWrapError` class | `GiftWrapError class — AC-7` — `extends ToonError with code GIFT_WRAP_ERROR`, `supports cause chaining` | Covered |
| **AC-8** | Package exports | `Package exports — AC-8` — `all gift-wrap functions are importable from the module` (verifies `wrapSwapPacket`, `unwrapSwapPacket`, `wrapSwapPacketToToon`, `unwrapSwapPacketFromToon`, `encryptFulfillClaim`, `decryptFulfillClaim` are importable) | Covered |
| **AC-9** | Unit tests (>= 16 tests) | Meta-AC: the test file itself contains 37 `it()` blocks, well exceeding the >= 16 threshold. Coverage of all sub-requirements T-009 through T-016 verified (see sub-mapping below). | Covered |
| **AC-10** | Build, lint, test verification | Not directly testable in the test file. Verified by CI pipeline and story status "done". | Covered (process) |

## AC-9 Unit Test Sub-Mapping

AC-9 specifies 16 individual test categories. Coverage:

| AC-9 Requirement | Test(s) | Status |
|-------------------|---------|--------|
| T-009: Gift-wrap construction (kind:1059, signed, p tag, ephemeral pubkey) | `wrapSwapPacket() — AC-1` — 4 tests covering kind, sig/id, p tag, ephemeral pubkey | Covered |
| T-010: Unwrap at destination (recover rumor + sender pubkey) | `unwrapSwapPacket() — AC-2` — `T-010: recovers original rumor content and sender pubkey`, `T-010: recovered rumor is unsigned (no sig field)`; `unwrapSwapPacket() — rumor unsigned fields` — duplicate unsigned check | Covered |
| T-011: Ephemeral key uniqueness (100 distinct keys) | `Ephemeral key uniqueness — T-011` — `100 consecutive wraps produce 100 distinct ephemeral pubkeys` | Covered |
| T-012: Intermediary cannot extract sender identity | `Privacy: intermediary cannot extract sender identity — T-012` — verifies outer pubkey != sender, third-party decrypt fails | Covered |
| T-013: Intermediary cannot determine event kind | `Privacy: intermediary cannot determine event kind — T-013` — content does not contain kind:10032, swap metadata, or pair tag values | Covered |
| T-014: TOON binary roundtrip | `wrapSwapPacketToToon() / unwrapSwapPacketFromToon() — AC-3 / AC-4` — `T-014: TOON binary roundtrip` | Covered |
| T-015: Wrong recipient rejects | `unwrapSwapPacket() — AC-2` — `T-015: throws GiftWrapError with wrong recipient secret key` | Covered |
| T-016: Timestamp randomization | `Timestamp randomization — T-016` — `gift wrap created_at is <= current time (past-only)`, `at least some timestamps differ from real time across multiple wraps` | Covered |
| FULFILL encryption roundtrip | `FULFILL encryption — AC-5 / AC-6` — `encryptFulfillClaim() -> decryptFulfillClaim() roundtrip recovers original claim` | Covered |
| FULFILL ephemeral key uniqueness | `FULFILL encryption — AC-5 / AC-6` — `FULFILL ephemeral key uniqueness: multiple calls produce distinct keys` | Covered |
| FULFILL wrong key rejects | `FULFILL encryption — AC-5 / AC-6` — `FULFILL wrong key rejects: decryptFulfillClaim() with wrong key throws GiftWrapError` | Covered |
| Invalid gift wrap kind | `unwrapSwapPacket() — AC-2` — `throws GiftWrapError for non-1059 kind event` (checks both error type and message) | Covered |
| Malformed gift wrap content | `unwrapSwapPacket() — AC-2` — `throws GiftWrapError for malformed gift wrap content (garbled ciphertext)` | Covered |
| Convenience function integration | `wrapSwapPacketToToon() / unwrapSwapPacketFromToon()` — `returns a valid IlpPreparePacket with base64 data`, `correctly chains TOON decode + unwrap` | Covered |
| Empty rumor content | `Edge cases` — `empty rumor content: wrapping a rumor with empty content works` | Covered |
| Large rumor content | `Edge cases` — `large rumor content: wrapping a rumor with >1 KB content works` | Covered |

## Additional Tests Beyond AC-9 Requirements

The test file includes extra coverage not explicitly required by AC-9:

- **Input validation suite** (8 tests): validates `senderSecretKey` length, `recipientPubkey` format, `recipientSecretKey` validity, `ephemeralPubkey` format, `senderPubkey` format, null/undefined `giftWrap`, `toonData` type, `claimData` type, empty `ciphertext`
- **FULFILL edge cases** (2 tests): empty claim data rejection, large (4 KB) claim data roundtrip
- **TOON unwrap error paths** (2 tests): invalid TOON binary, empty TOON data
- **Custom expiresAt** (1 test): verifies `wrapSwapPacketToToon()` accepts optional `expiresAt` parameter

## Uncovered ACs

**None.** All 10 acceptance criteria (AC-1 through AC-10) have test coverage. AC-10 is a process criterion (build/lint/test pass) verified by CI and story status.

## Summary

- **Total ACs:** 10
- **Covered:** 10 (AC-10 covered by process/CI)
- **Uncovered:** 0
- **Total test count:** 37 `it()` blocks (exceeds AC-9 threshold of >= 16)
- **Test design IDs covered:** T-009, T-010, T-011, T-012, T-013, T-014, T-015, T-016
