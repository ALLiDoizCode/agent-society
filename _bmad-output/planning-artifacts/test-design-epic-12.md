# Test Design: Epic 12 -- Token Swap Primitive -- NIP-59 Gift-Wrapped ILP Micropayment Swaps

**Date:** 2026-04-09
**Author:** Jonathan Green
**Status:** Draft

---

## Executive Summary

**Scope:** Risk-based test plan for Epic 12 -- Token Swap Primitive. 9 stories introducing non-custodial, privacy-preserving token swaps via ILP packet streaming with NIP-59 gift-wrap privacy. New package: `@toon-protocol/mill`. Extends `@toon-protocol/core` (SwapPair type, IlpPeerInfo extension, kind:10032 serialization) and `@toon-protocol/sdk` (streamSwap(), buildSettlementTx() client APIs).

**Nature of Testing:** This epic produces compiled TypeScript across one new package (`packages/mill/`) and extensions to two existing packages (`packages/core/`, `packages/sdk/`). Testing spans unit tests for type serialization and cryptographic operations, integration tests for handler-level swap processing, and full E2E swap flows against the existing SDK E2E infrastructure (Docker Compose with Anvil, peer nodes). Privacy properties (NIP-59 gift wrap, ephemeral-key NIP-44 encryption) require dedicated cryptographic verification tests.

**Risk Summary:**

- Total risks identified: 18
- High-priority risks (score >= 6): 8
- Critical categories: CRYPTO (5 risks), ECON (3 risks), INTEG (4 risks), DATA (2 risks), SEC (2 risks), OPS (2 risks)

**Coverage Summary:**

- P0 scenarios (crypto correctness + rate conversion + claim validity): 22 (~30-40 hours)
- P1 scenarios (integration + multi-chain wallet + settlement): 18 (~25-35 hours)
- P2 scenarios (client UX + operator tooling + edge cases): 14 (~15-20 hours)
- **Total effort**: ~70-95 hours (~3-4 weeks, aligns with epic size L)

---

## 1. Risk Assessment

### 1.1 Risk Register

| ID | Category | Risk | P | I | Score | Story | Mitigation |
|----|----------|------|---|---|-------|-------|------------|
| R-001 | CRYPTO | NIP-59 gift wrap fails to hide sender identity from intermediaries | 2 | 3 | **6** | 12-2 | Verify ephemeral key is unique per packet; assert intermediary cannot derive sender pubkey from gift wrap; roundtrip test with independent unwrapper |
| R-002 | CRYPTO | NIP-44 FULFILL encryption leaks claim data to intermediaries | 2 | 3 | **6** | 12-3 | Verify ephemeral keypair per FULFILL; assert only sender pubkey can decrypt; verify ephemeral privkey discarded after encryption |
| R-003 | ECON | Exchange rate applied incorrectly per packet (rounding, scale mismatch) | 2 | 3 | **6** | 12-3, 12-5 | Property-based tests: rate * amount = claim value within tolerance; golden test vectors for known rate/amount/scale combinations; boundary values at asset scale limits |
| R-004 | CRYPTO | Signed claims are invalid or unsettleable on-chain | 2 | 3 | **6** | 12-3, 12-6 | End-to-end test: Mill issues claim -> client accumulates -> buildSettlementTx() -> verify against on-chain PaymentChannelProvider; test with real Anvil contract |
| R-005 | INTEG | BIP-44 HD derivation with account index 2 collides with connector keys (account index 1) | 2 | 3 | **6** | 12-4 | Deterministic derivation test: same mnemonic -> distinct keys for account 1 vs account 2 across all three chains (EVM, Mina, Solana); verify derivation paths match spec |
| R-006 | CRYPTO | Ephemeral key reuse across packets breaks forward secrecy | 2 | 3 | **6** | 12-2 | Statistical test: generate 1000 gift-wrapped packets, assert all ephemeral keys unique; unit test verifies fresh keypair generation per invocation |
| R-007 | ECON | Rate drift causes unacceptable slippage without sender awareness | 2 | 2 | **4** | 12-5 | streamSwap() exposes per-packet claim amounts; test rate monitoring callback fires on deviation; test pause/stop behavior when rate crosses threshold |
| R-008 | INTEG | Mill handler + client streamSwap + settlement do not compose correctly | 3 | 3 | **9** | 12-8 | E2E integration test: full swap lifecycle (discover -> stream -> accumulate -> settle); this is the Story 12-8 deliverable itself |
| R-009 | DATA | Claim accumulation loses claims during multi-packet swap | 2 | 2 | **4** | 12-5 | Unit test: accumulate N claims, verify count and total value; test claim array persistence across packet failures |
| R-010 | SEC | Mill processes packets from non-gift-wrapped sources (privacy bypass) | 2 | 3 | **6** | 12-3 | Handler must reject non-NIP-59 packets; test raw ILP packet without gift wrap -> rejection; test malformed gift wrap -> rejection |
| R-011 | INTEG | kind:10032 backward compatibility broken by swapPairs field | 2 | 2 | **4** | 12-1 | Roundtrip test: parse pre-Epic-12 kind:10032 event (no swapPairs) -> swapPairs defaults to undefined; parse post-Epic-12 event with swapPairs -> correct deserialization |
| R-012 | OPS | Mill inventory depleted mid-swap (insufficient target-asset reserves) | 2 | 2 | **4** | 12-4 | Handler returns ILP REJECT with specific error code when reserves insufficient; test balance check before claim issuance |
| R-013 | ECON | Asset scale mismatch between SwapPair declaration and actual settlement | 2 | 2 | **4** | 12-1, 12-3 | Validate asset scale consistency between SwapPair.from/to and PaymentChannelProvider config; unit test for scale conversion |
| R-014 | DATA | Settlement transaction constructed from claims uses wrong nonce or channel ID | 2 | 2 | **4** | 12-6 | buildSettlementTx() test: construct tx from known claims -> verify channel ID, nonce, cumulative amount match contract expectations |
| R-015 | INTEG | startMill() fails to register swap handler with embedded connector | 2 | 2 | **4** | 12-7 | Integration test: startMill() -> verify handler registered -> send swap packet -> receive FULFILL |
| R-016 | SEC | Replay attack: intermediary replays a gift-wrapped packet | 1 | 3 | **3** | 12-2 | ILP packet has condition/fulfillment mechanism preventing replay; verify Mill tracks processed packet hashes |
| R-017 | OPS | Mill wallet key derivation fails on specific chain (Solana Ed25519 vs secp256k1) | 2 | 2 | **4** | 12-4 | Per-chain derivation test: derive key -> sign -> verify for EVM (secp256k1), Mina (Pallas), Solana (Ed25519) |
| R-018 | INTEG | Multiple concurrent swaps to same Mill cause channel state conflicts | 2 | 2 | **4** | 12-3, 12-4 | Concurrent swap test: two clients stream simultaneously -> both receive valid claims -> no double-spend on settlement |

### 1.2 Risk Heat Map

```
Impact  3 | R-010     R-001,R-002,R-003,R-004,R-005,R-006   R-008
        2 |           R-007,R-009,R-011,R-012,R-013,R-014,R-015,R-017,R-018
        1 |           R-016
          +--------------------------------------------------------------
            1              2                              3     Probability
```

---

## 2. Test Strategy by Story

### 2.1 Story 12-1: SwapPair Type + IlpPeerInfo Extension + kind:10032 Serialization

**Test level:** Unit
**Package:** `packages/core/`
**Risks addressed:** R-011, R-013

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-001 | P0 | Build kind:10032 event with swapPairs field | Event serialized with correct tag structure for swapPairs array |
| T-002 | P0 | Parse kind:10032 event with swapPairs field | SwapPair[] deserialized with correct from/to/rate/min/max values |
| T-003 | P0 | Parse pre-Epic-12 kind:10032 event (no swapPairs) | swapPairs is undefined; all existing fields parse correctly (backward compat) |
| T-004 | P1 | SwapPair with rate as high-precision decimal string | Rate preserves precision through serialization roundtrip (no float truncation) |
| T-005 | P1 | SwapPair with optional minAmount/maxAmount omitted | Parsed SwapPair has minAmount=undefined, maxAmount=undefined |
| T-006 | P1 | SwapPair with multiple pairs (e.g., USDC->ETH, USDC->MINA) | Array roundtrips correctly; order preserved |
| T-007 | P2 | SwapPair with empty array vs undefined | Empty array serializes as empty; undefined omits the field entirely |
| T-008 | P2 | Invalid SwapPair (missing assetCode, negative scale) | Parser rejects or returns error; does not silently produce invalid data |

### 2.2 Story 12-2: NIP-59 Gift Wrap Integration for ILP Packets

**Test level:** Unit + Integration
**Package:** `packages/sdk/`
**Risks addressed:** R-001, R-006, R-016

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-009 | P0 | Gift-wrap an ILP swap packet with ephemeral key | Wrapped event is kind:1059; inner seal is kind:1060; rumor is unsigned |
| T-010 | P0 | Unwrap gift-wrapped packet at destination Mill | Mill recovers original rumor content and sender pubkey from seal |
| T-011 | P0 | Ephemeral key uniqueness across packets | 100 consecutive wraps produce 100 distinct ephemeral pubkeys |
| T-012 | P0 | Intermediary cannot extract sender identity from gift wrap | Given only the kind:1059 outer event, no API path reveals the original sender pubkey |
| T-013 | P0 | Intermediary cannot determine event kind from gift wrap | Outer event data is opaque; parsing as anything other than kind:1059 fails |
| T-014 | P1 | Gift-wrap roundtrip through TOON binary encoding | encodeEventToToon(giftWrap) -> decodeToonToEvent -> unwrap -> original rumor |
| T-015 | P1 | Gift-wrap with incorrect recipient pubkey | Unwrap at wrong destination fails (NIP-44 decryption error) |
| T-016 | P2 | Gift-wrap timing metadata | Created_at on outer event is randomized (not real timestamp) per NIP-59 spec |

### 2.3 Story 12-3: Mill Swap Handler (createSwapHandler())

**Test level:** Unit + Integration
**Package:** `packages/mill/`
**Risks addressed:** R-002, R-003, R-010, R-013, R-018

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-017 | P0 | Handler unwraps NIP-59 gift-wrapped swap packet | Rumor content and sender pubkey extracted correctly |
| T-018 | P0 | Handler applies exchange rate to received amount | Claim value = receivedAmount * rate, correct to asset scale precision |
| T-019 | P0 | Handler issues signed payment channel claim in FULFILL | FULFILL data contains valid signed claim; claim verifiable against channel contract |
| T-020 | P0 | Handler encrypts FULFILL claim with ephemeral NIP-44 key | Ciphertext decryptable only by sender pubkey; ephemeral pubkey included in response |
| T-021 | P0 | Handler rejects non-gift-wrapped packet | ILP REJECT returned with appropriate error code |
| T-022 | P0 | Handler rejects malformed gift wrap (invalid NIP-44) | ILP REJECT returned; no claim issued; no state change |
| T-023 | P1 | Handler rate conversion with 18-decimal EVM scale | USDC (6 decimals) -> ETH (18 decimals) conversion correct at boundaries |
| T-024 | P1 | Handler with insufficient inventory | ILP REJECT with "insufficient liquidity" error; no partial claim |
| T-025 | P1 | Handler ephemeral key discarded after FULFILL encryption | After FULFILL sent, ephemeral privkey not accessible (memory cleared or scoped) |
| T-026 | P1 | Handler processes two concurrent swaps | Both receive valid claims; channel state consistent; no double-issuance |
| T-027 | P2 | Handler with unsupported swap pair | ILP REJECT with "unsupported pair" error |
| T-028 | P2 | Handler rate boundary: rate = "0" or rate = very large value | Rejects zero rate; handles large rate without overflow |

### 2.4 Story 12-4: Mill Inventory + Wallet Management (Multi-Chain)

**Test level:** Unit
**Package:** `packages/mill/`
**Risks addressed:** R-005, R-012, R-017

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-029 | P0 | BIP-44 derivation: account index 2 for EVM (m/44'/60'/2'/0/0) | Derived address differs from account index 1 (connector keys) |
| T-030 | P0 | BIP-44 derivation: account index 2 for Mina (m/44'/12586'/2'/0/0) | Valid Mina public key derived; distinct from connector Mina key |
| T-031 | P0 | BIP-44 derivation: account index 2 for Solana (m/44'/501'/2'/0/0) | Valid Ed25519 keypair derived; distinct from connector Solana key |
| T-032 | P0 | Same mnemonic -> deterministic keys across restarts | Derive keys, restart, derive again -> identical keys |
| T-033 | P1 | Inventory balance tracking: deduct on claim issuance | After issuing claim for X target units, available balance decreases by X |
| T-034 | P1 | Inventory insufficient balance check | Reject swap when target-asset balance < requested claim amount |
| T-035 | P1 | Multi-chain wallet: sign with EVM key -> verify on-chain | Signed message verifiable against derived EVM address |
| T-036 | P2 | Rate adjustment API | Operator updates rate -> next swap uses new rate |
| T-037 | P2 | Inventory funding: add balance to target-asset reserves | Fund call increases available balance; reflected in subsequent swaps |

### 2.5 Story 12-5: Client-Side streamSwap() API

**Test level:** Unit
**Package:** `packages/sdk/`
**Risks addressed:** R-007, R-009

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-038 | P0 | streamSwap() sends N packets and accumulates N claims | After N packets, accumulated claims array has N entries with correct values |
| T-039 | P0 | streamSwap() chunks total amount into sender-chosen packet count | $1000 swap with 10 packets -> 10 packets of $100 each |
| T-040 | P0 | streamSwap() extracts and decrypts claim from FULFILL data | Ephemeral pubkey used to derive decryption key; claim data matches expected structure |
| T-041 | P0 | streamSwap() rate monitoring: callback fires on each packet | Callback receives claim amount and effective rate for each FULFILL |
| T-042 | P1 | streamSwap() pause/resume | Pause after 5 packets -> no more packets sent -> resume -> remaining packets sent |
| T-043 | P1 | streamSwap() stop on rate deviation | Configure 2% threshold -> rate moves 3% -> swap stops; accumulated claims are valid |
| T-044 | P1 | streamSwap() handles ILP REJECT mid-stream | Partial swap: 7 of 10 packets succeed, 3 rejected -> 7 valid claims accumulated |
| T-045 | P1 | streamSwap() with single packet (minimum chunking) | 1 packet swap completes with 1 claim |
| T-046 | P2 | streamSwap() progress reporting | Progress callback reports packets sent, total value, average rate |
| T-047 | P2 | streamSwap() with 10,000 packets (stress) | All claims accumulated; no memory leak; total value matches expected |

### 2.6 Story 12-6: Client-Side buildSettlementTx()

**Test level:** Unit + Integration
**Package:** `packages/sdk/`
**Risks addressed:** R-004, R-014

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-048 | P0 | buildSettlementTx() from accumulated EVM claims | Raw tx bytes constructable; tx targets correct channel contract; cumulative amount correct |
| T-049 | P0 | buildSettlementTx() claim signature verification | Each claim signature verifiable against Mill's channel address before settlement |
| T-050 | P0 | buildSettlementTx() -> submit to Anvil -> on-chain settlement | Funds transferred from channel to sender's address on Anvil |
| T-051 | P1 | buildSettlementTx() with claims from multiple swap sessions | Claims from separate streamSwap() calls accumulate correctly into single settlement |
| T-052 | P1 | buildSettlementTx() with invalid/tampered claim | Rejects claim with bad signature; does not include in settlement tx |
| T-053 | P2 | buildSettlementTx() for Solana claims | Constructs valid Solana transaction from accumulated Solana claims |
| T-054 | P2 | buildSettlementTx() for Mina claims | Constructs valid Mina transaction from accumulated Mina claims |

### 2.7 Story 12-7: packages/mill/ Package Scaffold + startMill()

**Test level:** Unit + Integration
**Package:** `packages/mill/`
**Risks addressed:** R-015

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-055 | P0 | startMill() boots with valid config | Mill process starts; handler registered with embedded connector; health endpoint responds |
| T-056 | P0 | startMill() derives wallet keys from mnemonic | Keys derived for configured chains; no error on startup |
| T-057 | P1 | startMill() publishes kind:10032 with swapPairs | Peer info event published to relay with correct swapPairs data |
| T-058 | P1 | startMill() with missing mnemonic | Startup fails with clear error message |
| T-059 | P1 | Package exports: createSwapHandler, startMill | Package entry point exports both symbols; TypeScript types resolve |
| T-060 | P2 | startMill() graceful shutdown | Shutdown closes channels, stops listener, cleans up resources |

### 2.8 Story 12-8: Integration Tests (E2E Swap Flow)

**Test level:** E2E (Docker infrastructure required)
**Package:** `packages/mill/` or `packages/sdk/`
**Risks addressed:** R-008

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-061 | P0 | Full swap lifecycle: discover -> stream 5 packets -> accumulate claims -> settle on Anvil | Sender discovers Mill via kind:10032; sends 5 USDC packets; receives 5 ETH claims; settles on Anvil; on-chain balance reflects swap |
| T-062 | P0 | Privacy verification: intermediary peer logs contain no sender identity | Inspect peer1 logs for gift-wrapped packet routing; no sender pubkey, no event kind, no swap metadata visible |
| T-063 | P0 | Privacy verification: FULFILL return path is encrypted | Capture FULFILL at intermediary; ephemeral pubkey visible but claim data is opaque ciphertext |
| T-064 | P1 | Swap with rate change mid-stream | Mill operator changes rate after packet 3; packets 4-5 reflect new rate; client rate callback fires |
| T-065 | P1 | Swap with Mill inventory depletion mid-stream | Mill runs out of ETH reserves after packet 3; packets 4-5 receive ILP REJECT; 3 valid claims settleable |
| T-066 | P1 | Two clients swap simultaneously with same Mill | Both complete swaps; both settle independently; no channel state corruption |
| T-067 | P2 | Large swap: 100 packets | All 100 claims accumulated; settlement tx valid; total on-chain amount matches expected |
| T-068 | P2 | Swap with minimum packet amount | Single packet at SwapPair.minAmount -> valid claim returned |

### 2.9 Story 12-9: Operator Documentation

**Test level:** Review (no automated tests)
**Package:** `packages/mill/` or `docs/`

| ID | Priority | Scenario | Expected Outcome |
|----|----------|----------|------------------|
| T-069 | P2 | Documentation covers mnemonic setup, chain config, rate management | Operator can follow docs to start a Mill from scratch |
| T-070 | P2 | Documentation covers inventory funding and monitoring | Operator can fund target-asset reserves and check balances |

---

## 3. Quality Gates

| Gate | Threshold | Stories |
|------|-----------|---------|
| NIP-59 privacy invariant | All P0 crypto tests pass (T-009 through T-013, T-020, T-021, T-025) | 12-2, 12-3 |
| Exchange rate correctness | All P0 rate tests pass (T-018, T-023, T-038, T-039) | 12-3, 12-5 |
| Claim validity | buildSettlementTx -> on-chain settlement succeeds (T-048, T-049, T-050) | 12-6 |
| BIP-44 key isolation | Account index 2 keys distinct from account index 1 for all chains (T-029, T-030, T-031) | 12-4 |
| Backward compatibility | Pre-Epic-12 kind:10032 events parse without error (T-003) | 12-1 |
| E2E swap lifecycle | Full lifecycle test passes against Docker infra (T-061) | 12-8 |
| Line coverage | >80% for packages/mill/, affected core/ and sdk/ modules | All |

---

## 4. Test Infrastructure Requirements

### 4.1 Existing Infrastructure (Reuse)

- **SDK E2E Docker Compose** (`sdk-e2e-infra.sh`): Anvil (18545), Peer1, Peer2 -- used for E2E swap lifecycle tests
- **PaymentChannelProvider contracts** on Anvil -- used for claim settlement verification
- **nostr-tools NIP-44/NIP-59 primitives** -- used for gift wrap and encryption tests

### 4.2 New Infrastructure Required

- **Mill Docker container** or in-process Mill for E2E tests -- extends existing `docker-compose-sdk-e2e.yml` with a Mill peer
- **Test fixture: known swap mnemonic** -- deterministic mnemonic for reproducible key derivation tests
- **Test fixture: SwapPair golden vectors** -- known rate/amount/scale combinations with expected claim values
- **Mock rate oracle** -- unit test injectable for rate tests (real oracle out of scope per epic)

### 4.3 Test Data Strategy

- **Deterministic keys** -- Fixed BIP-39 mnemonic for all derivation tests (same approach as connector `WalletSeedManager` tests)
- **Fixed exchange rates** -- Known decimal string rates for arithmetic verification (e.g., "0.000357" for USDC->ETH at ~$2800/ETH)
- **Asset scale vectors** -- USDC scale 6, ETH scale 18, MINA scale 9, SOL scale 9 -- test all scale conversion paths

---

## 5. Risk-to-Story Mapping

| Risk ID | Category | P x I | Story | Test Level | Key Test IDs |
|---------|----------|-------|-------|------------|--------------|
| R-001 | CRYPTO | 2x3=6 | 12-2 | Unit | T-009, T-011, T-012, T-013 |
| R-002 | CRYPTO | 2x3=6 | 12-3 | Unit | T-020, T-025 |
| R-003 | ECON | 2x3=6 | 12-3, 12-5 | Unit | T-018, T-023, T-038, T-039 |
| R-004 | CRYPTO | 2x3=6 | 12-3, 12-6 | Unit+E2E | T-019, T-048, T-049, T-050 |
| R-005 | INTEG | 2x3=6 | 12-4 | Unit | T-029, T-030, T-031, T-032 |
| R-006 | CRYPTO | 2x3=6 | 12-2 | Unit | T-011 |
| R-007 | ECON | 2x2=4 | 12-5 | Unit | T-041, T-043 |
| R-008 | INTEG | 3x3=9 | 12-8 | E2E | T-061, T-062, T-063 |
| R-009 | DATA | 2x2=4 | 12-5 | Unit | T-038, T-044 |
| R-010 | SEC | 2x3=6 | 12-3 | Unit | T-021, T-022 |
| R-011 | INTEG | 2x2=4 | 12-1 | Unit | T-003 |
| R-012 | OPS | 2x2=4 | 12-4 | Unit | T-024, T-034 |
| R-013 | ECON | 2x2=4 | 12-1, 12-3 | Unit | T-008, T-023 |
| R-014 | DATA | 2x2=4 | 12-6 | Unit+E2E | T-048, T-050 |
| R-015 | INTEG | 2x2=4 | 12-7 | Integration | T-055, T-057 |
| R-016 | SEC | 1x3=3 | 12-2 | Unit | T-016 |
| R-017 | OPS | 2x2=4 | 12-4 | Unit | T-029, T-030, T-031, T-035 |
| R-018 | INTEG | 2x2=4 | 12-3, 12-4 | Integration | T-026, T-066 |

---

## 6. Story Acceptance Criteria Additions (from Test Design)

| Story | Test-Derived Acceptance Criteria |
|-------|---------------------------------|
| 12-1 | AC: Pre-Epic-12 kind:10032 events parse without error (swapPairs=undefined). AC: Rate string preserves arbitrary decimal precision through serialization roundtrip. |
| 12-2 | AC: Each gift-wrapped packet uses a unique ephemeral key. AC: Intermediary peers cannot extract sender pubkey, event kind, or swap metadata from outer event. |
| 12-3 | AC: Handler rejects non-NIP-59 packets with ILP REJECT. AC: FULFILL claim encrypted with fresh ephemeral key; only sender can decrypt. AC: Exchange rate applied with correct asset scale precision. |
| 12-4 | AC: Account index 2 derivation produces keys distinct from account index 1 for all configured chains. AC: Handler rejects swap when target-asset inventory insufficient. |
| 12-5 | AC: streamSwap() accumulates claims correctly across N packets. AC: Rate monitoring callback fires per packet with effective rate. AC: Swap stops when rate deviation exceeds configured threshold. |
| 12-6 | AC: buildSettlementTx() produces valid on-chain settlement tx from accumulated claims. AC: Invalid/tampered claims rejected before inclusion in settlement tx. |
| 12-7 | AC: startMill() registers swap handler with embedded connector. AC: Mill publishes kind:10032 with swapPairs on startup. |
| 12-8 | AC: Full lifecycle (discover -> stream -> accumulate -> settle) passes against Docker infra. AC: Intermediary peer logs contain no sender identity or swap metadata. |
| 12-9 | AC: Documentation covers mnemonic setup, chain config, rate management, inventory funding. |

---

## 7. Recommended Test Execution Order

1. **Story 12-1** (SwapPair type) -- foundation types; all other stories depend on correct serialization
2. **Story 12-2** (NIP-59 gift wrap) -- privacy primitive; Mill handler and client API both depend on this
3. **Story 12-4** (Wallet management) -- key derivation needed before handler can issue claims
4. **Story 12-3** (Mill handler) -- core swap logic; depends on 12-1, 12-2, 12-4
5. **Story 12-7** (Mill scaffold) -- startMill() wires handler; depends on 12-3, 12-4
6. **Story 12-5** (streamSwap()) -- client API; depends on 12-2 for gift wrap, tests against 12-3 handler
7. **Story 12-6** (buildSettlementTx()) -- settlement; depends on 12-5 for claim accumulation
8. **Story 12-8** (E2E integration) -- validates full stack; depends on all above stories
9. **Story 12-9** (Documentation) -- last; documents the implemented system

---

## 8. Test Framework & Conventions

- **Test runner:** Vitest (consistent with all non-o1js packages)
- **Unit tests:** Co-located `*.test.ts` next to source files in `packages/mill/src/`, `packages/core/src/`, `packages/sdk/src/`
- **Integration tests:** `packages/mill/src/__integration__/` or `packages/sdk/src/__integration__/`
- **E2E tests:** `packages/sdk/tests/e2e/` or `packages/mill/tests/e2e/` with separate `vitest.e2e.config.ts`
- **Docker infra:** E2E tests require `sdk-e2e-infra.sh up`; graceful skip when unavailable
- **No mocks in integration/E2E tests** -- per project testing rules
- **AAA pattern** -- Arrange, Act, Assert in all tests
- **Deterministic test data** -- fixed mnemonics, fixed rates, fixed timestamps
- **Handler testing:** Two-approach pattern (Approach A: unit with createTestContext; Approach B: integration against Docker infra)
