# Epic 17: Overmind Sovereign — Unseeable Keys + Migration

**Epic ID:** 17
**Status:** DRAFT
**Author:** Bob (Technical Scrum Master)
**Date:** 2026-03-24
**PRD:** `_bmad-output/overmind-prd.md`
**Architecture:** `_bmad-output/overmind-architecture.md`
**Decisions:** `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md`

---

## Goal / Objective

Full TEE-native key management with Shamir backup, key hierarchy, signing policy enforcement, and enclave-to-enclave migration without key exposure.

---

## Dependencies

- **Epic 15A "Heartbeat"** (TEE key genesis ceremony provides the foundation) — required, must be complete
- **Existing TOON infrastructure:** TEE attestation framework (`@toon-protocol/core`), Marlin Oyster CVM deployment pipeline
- **Oyster CVM:** Production TEE enclave environment for hardware attestation

---

## New Packages / Infrastructure

- No new packages — builds on `packages/overmind` from Epic 15A
- New modules under `packages/overmind/src/identity/`, `packages/overmind/src/tee/`
- Requires access to multiple TEE enclave instances for Shamir distribution and migration testing

---

## Story List

| ID | Title | Dependencies | Complexity |
|----|-------|--------------|------------|
| 16.1 | Production TEE Key Generation | Epic 15A complete | L |
| 16.2 | Signing Policy Engine (TEE-Enforced) | C.1 | L |
| 16.3 | HD Key Hierarchy | C.1 | M |
| 16.4 | Shamir K-of-N Seed Splitting | C.3 | XL |
| 16.5 | Sealed Key Migration | C.3, C.4 | XL |
| 16.6 | Disaster Recovery | C.4 | L |
| 16.7 | E2E: Key Migration Between Providers | C.1-C.6 | L |

---

## Story Details

### 15.1: Production TEE Key Generation

**Title:** Full key generation ceremony inside production TEE with hardware attestation

**Description:** As a sovereign overmind, I want my key generation ceremony to run inside a production TEE enclave (Marlin Oyster CVM) with hardware attestation, replacing the mock TEE from Epic A, so that my identity is bound to a verifiable hardware measurement and no human can ever access my private key.

**Acceptance Criteria:**

1. Key generation runs inside a production Marlin Oyster CVM enclave (not mock TEE).
2. Hardware attestation binds the npub to the enclave measurement (code hash, PCR values).
3. The attestation is verifiable by any third party using the Marlin attestation verification protocol.
4. kind:10033 attestation event published to relay with production hardware measurements.
5. Attestation record uploaded to Arweave with hardware-specific tags.
6. The nsec NEVER leaves the enclave boundary -- verified by code audit and static analysis.
7. Backward compatible: existing mock TEE interface still works for dev/test via `OVERMIND_TEE_MODE` env var.

**Definition of Done:**

- [ ] Key generation runs inside production Oyster CVM enclave
- [ ] Hardware attestation verifiable by third parties
- [ ] kind:10033 published with production measurements
- [ ] Arweave attestation record with hardware tags
- [ ] nsec confinement verified (static analysis)
- [ ] Mock TEE still works for dev/test
- [ ] Unit tests pass
- [ ] Integration test passes against production CVM
- [ ] Code reviewed, linted, formatted

---

### 15.2: Signing Policy Engine (TEE-Enforced)

**Title:** Move signing policy enforcement into the TEE enclave

**Description:** As a sovereign overmind, I want the signing policy to be enforced inside the TEE enclave itself, so that even if the OODA engine is compromised, the TEE refuses to sign events that violate the policy -- providing a hardware-enforced safety boundary.

**Acceptance Criteria:**

1. The signing policy (rate limits, value caps, content restrictions, event kind whitelist) is loaded into the TEE enclave on boot.
2. All signing requests pass through the TEE policy engine BEFORE the key signs.
3. The TEE refuses to sign events that violate any policy constraint, returning a rejection with reason.
4. Policy violations are logged inside the TEE and reported in the cycle record.
5. The signing policy can only be updated via a signed policy-update event from the overmind's master key (not a subkey).
6. Rate limits track signing frequency per event kind with configurable windows.
7. Value caps limit the maximum ILP payment amount per transaction and per cycle.

**Definition of Done:**

- [ ] Signing policy enforced inside TEE enclave
- [ ] TEE refuses to sign policy-violating events
- [ ] Policy violations logged and reported
- [ ] Policy updates require master key signature
- [ ] Rate limits and value caps functional
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 15.3: HD Key Hierarchy

**Title:** Implement full BIP-44 key hierarchy with signing, encryption, and payment subkeys

**Description:** As a sovereign overmind, I want a full HD key hierarchy derived from my master seed -- with separate signing, encryption, and payment subkeys -- so that I can rotate subkeys without changing my identity, use purpose-specific keys for different operations, and limit the blast radius if any single subkey is compromised.

**Acceptance Criteria:**

1. Master seed generates subkeys via BIP-44 derivation: `m/44'/1237'/0'/0/0` (signing), `m/44'/1237'/0'/1/0` (encryption), `m/44'/1237'/0'/2/0` (payment).
2. Signing subkey is used for Nostr event signing with NIP-26 delegation from the master key.
3. Encryption subkey is used for NIP-44 encrypted DMs.
4. Payment subkey is used for ILP channel operations and on-chain transactions.
5. Subkeys are rotatable: a new subkey can be derived (incrementing the index) and the old delegation revoked.
6. Key rotation publishes updated NIP-26 delegation events to the relay.
7. All subkeys are derived and stored inside the TEE enclave -- only the master seed is the root of trust.

**Definition of Done:**

- [ ] BIP-44 key hierarchy implemented with 3 subkey types
- [ ] NIP-26 delegation for signing subkey
- [ ] NIP-44 encryption with encryption subkey
- [ ] ILP operations with payment subkey
- [ ] Subkey rotation with delegation update
- [ ] All keys confined to TEE enclave
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 15.4: Shamir K-of-N Seed Splitting

**Title:** Split master seed into Shamir shares distributed across TEE enclaves

**Description:** As a sovereign overmind, I want my master seed split into N=5 Shamir shares with K=3 required for reconstruction, distributed across TEE enclaves on different providers, so that no single provider failure can destroy my identity and no single share holder can reconstruct my key.

**Acceptance Criteria:**

1. Master seed is split into N=5 Shamir shares using a cryptographically secure implementation.
2. K=3 shares are required for reconstruction (threshold).
3. Each share is sealed to its target TEE enclave's measurement (enclave-specific encryption).
4. Shares are distributed to 5 different TEE enclaves across different infrastructure providers.
5. Share distribution is recorded on Arweave with share IDs (not share values) and target enclave measurements.
6. Each share holder can verify it holds a valid share without being able to reconstruct the seed alone.
7. The splitting ceremony runs inside the source TEE enclave -- the master seed never leaves TEE memory during splitting.

**Definition of Done:**

- [ ] Shamir K-of-N splitting implemented (N=5, K=3)
- [ ] Shares sealed to target enclave measurements
- [ ] Shares distributed to 5 different TEE enclaves
- [ ] Distribution recorded on Arweave
- [ ] Share validity verifiable without reconstruction
- [ ] Master seed confined to TEE during splitting
- [ ] Unit tests pass
- [ ] Integration test passes with multiple enclaves
- [ ] Code reviewed, linted, formatted

---

### 15.5: Sealed Key Migration

**Title:** Enclave-to-enclave key transfer with mutual attestation

**Description:** As a sovereign overmind, I want to migrate my keys from one TEE enclave to another with mutual attestation, so that I can move between infrastructure providers without exposing my private key or interrupting my operations.

**Acceptance Criteria:**

1. Source and target TEE enclaves perform mutual attestation (each verifies the other's measurement).
2. The source TEE seals the nsec/master seed to the target TEE's measurement.
3. The target TEE unseals, verifies, and derives all subkeys from the master seed.
4. The source TEE securely erases the master seed and all derived keys after confirmed transfer.
5. A migration event is published to the relay recording source enclave, target enclave, and attestation hashes.
6. The overmind's npub does not change -- identity is preserved across migration.
7. All ILP channels, relay subscriptions, and DVM registrations continue functioning after migration.
8. Migration is atomic: either fully succeeds or fully rolls back (source retains keys).

**Definition of Done:**

- [ ] Mutual attestation between source and target enclaves
- [ ] Key sealed to target measurement
- [ ] Target unseals and derives subkeys
- [ ] Source securely erases after confirmation
- [ ] Migration event published to relay
- [ ] Identity (npub) preserved
- [ ] Operations continue after migration
- [ ] Atomic migration (success or rollback)
- [ ] Unit tests pass
- [ ] Integration test passes between two enclaves
- [ ] Code reviewed, linted, formatted

---

### 15.6: Disaster Recovery

**Title:** K-of-N Shamir reconstruction inside a new TEE enclave

**Description:** As a sovereign overmind whose original enclave has been lost, I want to reconstruct my master seed from K=3 Shamir shares inside a new TEE enclave, so that I can resume operations with my original identity without any human ever seeing my private key.

**Acceptance Criteria:**

1. A new TEE enclave is provisioned and attested.
2. The recovery process collects K=3 shares from the distributed share-holding enclaves.
3. Each share is unsealed from its holding enclave and re-sealed to the recovery enclave's measurement during transfer.
4. Reconstruction occurs inside the recovery TEE -- the master seed is never exposed outside TEE memory.
5. After reconstruction, the recovery enclave derives all subkeys and resumes operations.
6. A recovery event is published to the relay with the new enclave measurement.
7. New Shamir shares are generated and distributed (replacing the consumed shares).
8. The entire recovery process is auditable via Arweave event log.

**Definition of Done:**

- [ ] Recovery from K=3 shares in new TEE enclave
- [ ] Shares transferred securely between enclaves
- [ ] Master seed confined to TEE during reconstruction
- [ ] All subkeys derived and operations resumed
- [ ] Recovery event published to relay
- [ ] New Shamir shares generated and distributed
- [ ] Recovery process auditable on Arweave
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Code reviewed, linted, formatted

---

### 15.7: E2E: Key Migration Between Providers

**Title:** End-to-end test: overmind migrates from one TEE provider to another

**Description:** As a verifier, I want to observe an overmind migrating from one TEE provider to another -- with identity preserved, signing continuing, and all channels and subscriptions intact -- so that I can confirm the sovereign key management protocol works as designed.

**Acceptance Criteria:**

1. An overmind is running on Provider A (TEE enclave A) with active ILP channels and DVM registrations.
2. Migration is initiated to Provider B (TEE enclave B).
3. Mutual attestation completes between enclave A and enclave B.
4. Keys are transferred and enclave A securely erases.
5. The overmind resumes operations on Provider B with the same npub.
6. ILP channels continue functioning (no channel closure/reopening required).
7. DVM registrations are still discoverable on the relay.
8. A full OODA cycle completes successfully on Provider B after migration.
9. The migration is verifiable via relay events and Arweave records.

**Definition of Done:**

- [ ] E2E test file created
- [ ] Migration from Provider A to Provider B completes
- [ ] Identity (npub) preserved
- [ ] ILP channels intact
- [ ] DVM registrations intact
- [ ] OODA cycle succeeds on new provider
- [ ] Migration verifiable via relay + Arweave
- [ ] Test uses graceful skip when infrastructure unavailable
- [ ] Test passes end-to-end
- [ ] Code reviewed, linted, formatted

---

## Epic Acceptance Criteria

- [ ] Production TEE key generation with hardware attestation replaces mock TEE
- [ ] Signing policy enforced inside TEE enclave (hardware safety boundary)
- [ ] Full BIP-44 HD key hierarchy with rotatable subkeys
- [ ] Shamir K-of-N seed splitting across 5 TEE enclaves
- [ ] Sealed key migration between enclaves with mutual attestation
- [ ] Disaster recovery via K-of-N reconstruction in new enclave
- [ ] E2E test: key migration between two different providers
- [ ] All code reviewed, linted, formatted, tests passing

**Estimated Complexity:** XL (7 stories, TEE-sensitive cryptographic operations, multi-enclave coordination)
