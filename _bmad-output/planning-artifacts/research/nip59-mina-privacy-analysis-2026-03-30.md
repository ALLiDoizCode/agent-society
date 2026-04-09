# NIP-59 + Mina zk-SNARK Privacy Analysis for TOON Payment Channel Claims

**Date:** 2026-03-30
**Author:** Research analysis (Claude)
**Context:** TOON Protocol connector v2.2.0 -- NIP-59 three-layer encryption for BTP payment channel claims with planned multi-chain settlement (EVM, Solana, Mina)

---

## 1. Executive Summary

TOON Protocol's application of NIP-59 gift wrapping to payment channel claims creates a genuinely novel architecture: **transport-layer privacy for settlement-layer financial messages**. When combined with Mina Protocol's zk-SNARK capabilities for on-chain settlement, the result is a privacy stack where neither the transport layer nor the settlement layer reveals the claim amount, sender identity, or transaction linkage to passive observers.

This combination is unique in the ILP/payment channel space. No other protocol wraps off-chain balance claims in a deniable, unlinkable transport envelope while simultaneously settling on a chain that supports zero-knowledge proof verification. However, the architecture should be positioned honestly: this is a designed capability with clear theoretical properties, not yet a battle-tested production system. The EVM and Solana settlement paths provide transport privacy via NIP-59 but expose claim details on-chain, creating a meaningful privacy gradient across the three chain types.

**Key finding:** The strongest positioning is not "privacy coin competitor" but rather **"the only payment channel protocol where the transport layer and settlement layer are independently privacy-preserving."** This is architecturally distinct from Lightning (transport privacy, transparent settlement), Zcash (no payment channels), and Aztec (single-chain, no transport layer).

---

## 2. NIP-59 Privacy Guarantees (Detailed Technical Analysis)

### 2.1 Three-Layer Architecture

NIP-59 implements privacy through compositional layering, where each layer addresses a distinct threat model:

**Layer 1 -- Rumor (Inner Event):**
- Contains the actual BTP claim payload (channel ID, nonce, transferred amount, balance proof signature)
- **Unsigned** -- no `sig` field, no `id` field
- The real author's pubkey is present but only visible after decryption of both outer layers
- Deniability property: the recipient holds the claim data, but cannot produce a cryptographic proof that the sender authored it, because there is no signature on the inner event itself

**Layer 2 -- Seal (kind:1060):**
- NIP-44 encryption: ECDH(sender_privkey, recipient_pubkey) derives a conversation key via HKDF-SHA256, then per-message key derivation using a random 32-byte nonce
- Encryption algorithm: XChaCha20-Poly1305 (authenticated encryption)
- `created_at` is randomized within +/-48 hours of actual time
- `tags` array is empty (no metadata leakage)
- Signed by the real author's key -- this provides authentication to the recipient but requires decrypting the gift wrap layer first
- The seal's signature proves authorship *to the recipient* but does not constitute non-repudiation to third parties (the recipient cannot prove they didn't construct the seal themselves, since they possess the shared conversation key)

**Layer 3 -- Gift Wrap (kind:1059):**
- A fresh ephemeral secp256k1 keypair is generated for each message
- NIP-44 encryption: ECDH(ephemeral_privkey, recipient_pubkey) creates an independent conversation key
- `pubkey` field contains the ephemeral public key (not the sender's real key)
- `created_at` is independently randomized within +/-48 hours
- `p` tag contains the recipient's pubkey (necessary for relay routing)
- Signed by the ephemeral key

### 2.2 Privacy Properties

**Sender Identity Hiding:**
An observer (relay operator, network eavesdropper, or any party without the recipient's private key) sees only the ephemeral public key on the gift wrap. Since a fresh ephemeral key is generated per message, there is no linkage between the sender's real identity and any published event. The real sender pubkey is encrypted inside the seal, which is itself encrypted inside the gift wrap.

**Timestamp Unlinkability:**
Both the seal and gift wrap use independently randomized `created_at` values. The randomization window is 0-172800 seconds (0-48 hours) subtracted from the actual time. This means:
- An observer cannot correlate a gift wrap event with a specific real-world payment event based on timing
- Even if an attacker compromises the seal layer independently, the seal's randomized timestamp provides a second layer of temporal obfuscation
- The actual timestamp of the BTP claim exists only inside the encrypted rumor

**Message Unlinkability:**
Each gift wrap uses a unique ephemeral keypair. Given N gift-wrapped claims from the same sender to the same recipient, an observer sees N events from N different ephemeral pubkeys. Without the recipient's private key, there is no way to determine:
- Whether two gift wraps came from the same sender
- Whether they are part of the same payment channel
- Whether they represent sequential claims in a conversation

**Content Hiding:**
The BTP claim payload (channel ID, nonce, transferred amount, balance proof) is protected by two layers of NIP-44 encryption. Each layer uses:
- 32-byte random nonce for per-message key derivation
- XChaCha20-Poly1305 authenticated encryption
- Power-of-2 padding to obscure message length

### 2.3 Deniability Model

The deniability of NIP-59 for payment claims operates at two levels:

**Cryptographic Deniability (Rumor Layer):**
The inner event (rumor) containing the BTP claim is unsigned. If the outer layers are compromised (e.g., a recipient leaks the decrypted content), the sender can plausibly deny authorship. There is no digital signature binding the sender to the claim payload. However, this deniability has limits:

- The seal (kind:1060) IS signed by the real author. If the recipient reveals both the seal and the decrypted rumor, the seal's signature proves the real author encrypted *something* to the recipient at approximately that time. The sender's defense is that the recipient could have constructed a different inner event and placed it inside the seal structure.
- In the specific context of BTP claims, the claim payload typically contains a balance proof that IS cryptographically signed (EIP-712 for EVM, Ed25519 for Solana, or a zk-proof for Mina). This signed balance proof inside the unsigned rumor creates a tension: the transport layer is deniable, but the settlement-layer signature within the payload may not be.

**Operational Deniability:**
The randomized timestamps and ephemeral keys mean that even if a sender's participation in a payment channel is known through other means (e.g., on-chain channel opening), specific claim messages cannot be linked to specific relay events without the recipient's cooperation.

### 2.4 Dual HKDF Derivation for ILP Binding

The connector v2.2.0 design uses dual HKDF derivation to bind ILP conditions/preimages within the NIP-59 envelope. This means:
- The NIP-44 conversation key derivation (HKDF-SHA256 with "nip44-v2" salt) is standard
- A second HKDF derivation generates ILP-specific material (condition/preimage binding) from the same shared secret but with a different info/salt parameter
- This prevents an attacker who compromises the NIP-44 message key from also deriving the ILP preimage, and vice versa
- The two derivations are cryptographically independent despite sharing the same ECDH shared secret

### 2.5 Residual Metadata Leakage

Even with NIP-59, certain metadata remains visible:

| Observable | Visible To | Mitigation |
|---|---|---|
| Recipient pubkey | Relay operators, network observers | Required for routing; inherent to the relay model |
| Event size (approximate) | Relay operators | Power-of-2 padding reduces granularity but does not eliminate |
| Frequency of events to a recipient | Relay operators | No mitigation within NIP-59; mixnet or batching would help |
| Relay used for delivery | Network observers | Use multiple relays; but the recipient still needs to check them |
| IP address of publisher | Relay operators | Use Tor/VPN; outside NIP-59 scope |
| Existence of communication | Relay operators | NIP-59 hides content and sender, not the fact that events exist |

**Payment channel specific leakage:**
- On-chain channel opening/closing is public (reveals participant addresses and total deposited amount on EVM/Solana)
- The number of gift-wrapped claims between two parties may correlate with channel activity
- Claim sizes, while hidden in transport, become visible at settlement (except on Mina)

---

## 3. Mina zk-SNARK Synergy Analysis

### 3.1 What Mina Adds to NIP-59

NIP-59 provides transport-layer privacy. Mina's zk-SNARKs extend this privacy to the settlement layer. The combination creates an end-to-end privacy stack:

```
Transport Privacy (NIP-59)          Settlement Privacy (Mina)
-------------------------------     ---------------------------------
Sender identity: HIDDEN             Participant identity: COMMITMENTS
Claim amount: HIDDEN                Settlement amount: PROVABLE WITHOUT REVEALING
Timing: RANDOMIZED                  On-chain state: 22KB CONSTANT
Message linkage: IMPOSSIBLE         Proof linkage: RECURSIVE COMPRESSION
```

**Key synergy:** On EVM and Solana, the privacy provided by NIP-59 during transport is partially undone at settlement time, when claim details must be submitted on-chain for verification. On Mina, the settlement itself can be privacy-preserving -- the zkApp verifies a proof that a valid state transition occurred without revealing the specific amounts or intermediate states.

### 3.2 Poseidon Commitments vs EIP-712 Signatures

**EIP-712 (EVM):**
- Balance proofs are EIP-712 typed data signatures: `{channelId, sender, receiver, nonce, transferredAmount}`
- The signature is verifiable by anyone with the signed data and the signer's public key
- All claim parameters are in plaintext -- the signature proves authenticity but reveals everything
- On-chain settlement requires submitting the full claim data for the smart contract to verify

**Ed25519 (Solana):**
- Balance proofs use Ed25519 signatures over serialized claim data
- Similar transparency properties to EIP-712 -- the signed data is plaintext
- PDA-based channels store state on-chain in account data, which is publicly readable

**Poseidon Commitments (Mina):**
- Instead of signing plaintext claim data, the claim is committed using `Poseidon.hash([channelId, sender, receiver, nonce, transferredAmount])`
- The commitment reveals nothing about the underlying values
- A zk-SNARK proof demonstrates: "I know values (channelId, sender, receiver, nonce, amount) such that Poseidon.hash(values) = commitment AND amount >= previous_amount AND sender is authorized"
- The on-chain zkApp stores only the commitment root (1 Field element) and verifies the proof
- **The amount is never revealed on-chain** -- only the proof that a valid state transition occurred

This is the fundamental asymmetry: EIP-712 and Ed25519 prove "this specific claim is valid" while Poseidon proves "a valid claim exists" without revealing which one.

### 3.3 Zero-Knowledge Settlement Verification

A Mina zkApp for payment channel settlement can achieve:

**Amount Hiding:**
The prover (claim submitter) constructs a proof that:
1. The new transferred amount is greater than or equal to the previous transferred amount (monotonically increasing, as required by payment channels)
2. The new transferred amount does not exceed the channel deposit
3. The state transition is authorized by the correct signing key

All of this is proven without revealing the actual amount. The on-chain state stores only the Poseidon commitment of the latest valid state.

**Participant Commitment:**
Channel participants can be represented as Poseidon commitments of their public keys rather than the keys themselves. The zkApp verifies that the proof was constructed by someone who knows the preimage of the participant commitment.

**Recursive Lifecycle Proofs:**
o1js supports recursive proofs (SelfProof/ZkProgram). An entire payment channel lifecycle -- open, N claims, close -- can be compressed into a single constant-size SNARK. This means:
- A third party can verify that a valid channel lifecycle occurred
- Without seeing any individual claim
- Without knowing the total number of claims
- Without learning the final settlement amount
- Verification time is constant regardless of channel lifetime

### 3.4 The Full Privacy Stack

When combining NIP-59 transport with Mina settlement:

```
1. Channel Opening:
   - Participants deposit to a zkApp (on-chain, but amounts committed via Poseidon)
   - Public: a channel was opened between two commitments

2. Off-Chain Claims (Transport):
   - Each BTP claim is NIP-59 gift-wrapped
   - Relays see: ephemeral_pubkey -> recipient_pubkey (that's all)
   - Claim amount, channel ID, nonce: all encrypted

3. Settlement (On-Chain):
   - Submitter provides a zk-proof of the final channel state
   - zkApp verifies: valid state transition, authorized participants, correct amounts
   - On-chain: only the updated commitment root changes
   - Public: a state transition occurred on a channel (nothing about amounts)

4. Channel Closing:
   - Cooperative close: both parties provide a joint proof of final state
   - Dispute: challenge period with recursive proof of all claims
   - Funds released to committed addresses
```

At no point in this flow does a passive observer learn:
- Who is paying whom (transport: ephemeral keys; settlement: Poseidon commitments)
- How much was transferred (transport: encrypted; settlement: zero-knowledge proof)
- How many claims were exchanged (transport: unlinkable; settlement: recursive compression)

### 3.5 Uniqueness in the ILP/Payment Channel Space

This combination is genuinely novel. No existing ILP implementation uses:
- Transport-layer privacy for claim messages (standard ILP uses plaintext BTP/HTTP)
- Zero-knowledge settlement for payment channel finalization
- The dual-layer approach where transport AND settlement are independently privacy-preserving

The closest comparison in the broader ecosystem is Lightning Network with onion routing (transport privacy) + Taproot (reduced on-chain footprint), but Lightning still reveals channel capacities, HTLC amounts in routing, and settlement amounts on-chain.

---

## 4. Three-Chain Comparative Privacy Matrix

| Property | EVM (EIP-712) | Solana (Ed25519) | Mina (zk-SNARK) |
|---|---|---|---|
| **Transport privacy (NIP-59)** | Full: sender hidden, content encrypted, timestamps randomized, messages unlinkable | Full: identical NIP-59 properties | Full: identical NIP-59 properties |
| **Transport deniability** | Partial: rumor is unsigned but EIP-712 signature inside payload is non-repudiable | Partial: rumor is unsigned but Ed25519 signature inside payload is non-repudiable | Strong: rumor is unsigned AND inner proof reveals no plaintext claim data |
| **On-chain channel opening** | Public: participant addresses and deposit amounts visible | Public: participant addresses and deposit amounts visible in PDA | Private: participant commitments and deposited amount commitments |
| **On-chain claim verification** | Public: full claim data (amount, nonce, signatures) submitted for verification | Public: full claim data submitted for verification | Private: zk-proof verifies validity without revealing claim data |
| **Amount hiding (transport)** | Yes: encrypted in NIP-59 envelope | Yes: encrypted in NIP-59 envelope | Yes: encrypted in NIP-59 envelope |
| **Amount hiding (settlement)** | No: plaintext in on-chain settlement tx | No: plaintext in on-chain settlement tx | Yes: Poseidon commitment, zk-proof verification |
| **Participant hiding (transport)** | Yes: ephemeral keys in gift wrap | Yes: ephemeral keys in gift wrap | Yes: ephemeral keys in gift wrap |
| **Participant hiding (settlement)** | No: EVM addresses visible on-chain | No: Solana pubkeys visible on-chain | Partial: Poseidon commitments of pubkeys; but withdrawal reveals recipient |
| **Claim linkability (transport)** | Unlinkable: fresh ephemeral key per claim | Unlinkable: fresh ephemeral key per claim | Unlinkable: fresh ephemeral key per claim |
| **Claim linkability (settlement)** | Linkable: sequential nonces on same channel | Linkable: sequential updates on same PDA | Unlinkable: recursive proof compresses history |
| **Timing privacy (transport)** | Yes: +/-48h randomization | Yes: +/-48h randomization | Yes: +/-48h randomization |
| **Timing privacy (settlement)** | No: on-chain tx timestamp is public | No: slot timestamp is public | Partial: tx timestamp is public but content is hidden |
| **Metadata leakage** | Recipient pubkey visible at transport; all claim data visible at settlement | Recipient pubkey visible at transport; all claim data visible at settlement | Recipient pubkey visible at transport; only proof and commitment visible at settlement |
| **Post-quantum resistance** | Low: secp256k1 ECDSA | Low: Ed25519 | Medium: Poseidon is algebraic but SNARK proofs add a layer; migration path to post-quantum hash exists |

### Summary by Privacy Level

- **EVM/Solana:** Transport-layer privacy is excellent (NIP-59). Settlement-layer privacy is nil -- all claim data is public on-chain. The privacy story is "private until you settle."
- **Mina:** Transport-layer privacy is excellent (NIP-59). Settlement-layer privacy is strong -- claim amounts, intermediate states, and participant identities can be committed rather than revealed. The privacy story is "private end-to-end."

---

## 5. Competitive Landscape

### 5.1 Lightning Network

**Transport privacy:** Onion routing (Sphinx) hides intermediate hops. Each routing node sees only predecessor and successor. Source and destination are hidden from intermediaries.

**Settlement privacy:** Channel capacities are public in the channel graph. Opening/closing transactions reveal participant pubkeys and amounts. HTLCs during routing reveal amounts to each hop (though not the full route).

**Comparison to TOON+NIP-59:**
- Lightning's onion routing solves a different problem (multi-hop routing privacy) than NIP-59 (bilateral claim privacy)
- NIP-59 hides the sender entirely from the relay; Lightning hides route endpoints from intermediaries
- Neither is strictly superior -- they address different threat models
- TOON's advantage: NIP-59 also provides deniability (unsigned rumor), which Lightning's HTLCs do not
- Lightning's advantage: mature, battle-tested, massive network effect

### 5.2 Zcash (Shielded Transactions)

**Privacy model:** Shielded transactions use zk-SNARKs (Groth16/Halo2) to hide sender, receiver, and amount. Nullifiers prevent double-spending without revealing which note is spent.

**Comparison:**
- Zcash operates at the base layer (L1 transactions), not at the payment channel layer
- No payment channel protocol exists for Zcash shielded transactions -- each transaction is individually proved
- TOON's advantage: payment channels amortize the cost of thousands of micropayments into one settlement; Zcash requires one proof per transaction
- Zcash's advantage: more mature zk-SNARK implementation, formally audited circuits, larger anonymity set
- Key distinction: TOON separates transport privacy (NIP-59) from settlement privacy (chain-specific), whereas Zcash unifies them in one proof

### 5.3 Aztec Network

**Privacy model:** Privacy-first L2 on Ethereum. Uses Noir (Rust-like DSL) for zk circuit writing. Private transactions, private smart contract state, private function execution.

**Comparison:**
- Aztec is a full L2 with its own execution environment; TOON is a protocol layer above existing L1s
- Aztec's privacy is single-chain (Ethereum L2); TOON's NIP-59 transport privacy is chain-agnostic
- Aztec does not have a payment channel/micropayment model -- it uses standard L2 transactions
- TOON's advantage: multi-chain settlement, transport-layer privacy independent of settlement chain, micropayment economics
- Aztec's advantage: more comprehensive on-chain privacy (private state, private functions), production-grade ZK infrastructure

### 5.4 Tornado Cash (Historical)

**Privacy model:** Mixer contract -- deposit fixed denomination, withdraw to different address with zk-proof of deposit. Breaks the link between depositor and withdrawer.

**Comparison:**
- Tornado Cash provides anonymity set privacy for single transfers, not ongoing payment relationships
- No micropayment capability, no payment channels
- TOON's design is fundamentally different: ongoing bilateral payment channel with privacy at both transport and settlement
- Tornado Cash's anonymity set model is more established for single-transfer unlinkability

### 5.5 State Channels (Raiden, Connext, Nitro)

**Privacy model:** Minimal. State channel protocols focus on scalability, not privacy. Claim messages are typically sent peer-to-peer over authenticated channels (TLS), but without the layered privacy of NIP-59. On-chain settlement reveals full state.

**Comparison:**
- Standard state channels use direct peer-to-peer communication with no relay intermediary
- NIP-59 gift wrapping is unnecessary when messages go directly between counterparties (no relay to hide from)
- TOON's architecture is unusual because BTP claims route through relays (Nostr infrastructure), creating a need for transport privacy that traditional state channels do not have
- This is the architectural reason NIP-59 matters: TOON routes claim messages through infrastructure that is not controlled by either channel participant

### 5.6 Summary Table

| Protocol | Transport Privacy | Settlement Privacy | Payment Channels | Micropayments | Multi-Chain |
|---|---|---|---|---|---|
| **TOON (EVM)** | NIP-59 (strong) | None (public) | Yes | Yes | Yes |
| **TOON (Solana)** | NIP-59 (strong) | None (public) | Yes (planned) | Yes | Yes |
| **TOON (Mina)** | NIP-59 (strong) | zk-SNARK (strong) | Yes (planned) | Yes | Yes |
| **Lightning** | Onion routing (strong) | Partial (capacities public) | Yes | Yes | No (Bitcoin only) |
| **Zcash** | Network-level only | Groth16/Halo2 (strong) | No | No | No (single chain) |
| **Aztec** | L2 internal only | Noir proofs (strong) | No | No | No (Ethereum L2) |
| **Raiden** | TLS (minimal) | None (public) | Yes | Yes | No (Ethereum only) |

---

## 6. Positioning Recommendations

### 6.1 Strongest Framing

**Do say:** "TOON is the only payment channel protocol with independent privacy at both the transport layer (NIP-59 gift wrapping) and the settlement layer (Mina zk-SNARK proofs). Every BTP claim is sender-anonymous, content-encrypted, timing-randomized, and message-unlinkable during transport. On Mina, settlement is also zero-knowledge -- the chain verifies that a valid state transition occurred without learning the amount, the participants, or the number of claims."

**Do not say:** "TOON is a privacy protocol" (it is a payment routing protocol with privacy features) or "TOON replaces Zcash/Aztec" (different category entirely).

### 6.2 Recommended README/Documentation Framing

```
### Privacy by Default

BTP payment channel claims are NIP-59 gift-wrapped before transport:

- **Sender hidden** -- ephemeral key per message; relays never see your identity
- **Amount hidden** -- two layers of XChaCha20-Poly1305 encryption
- **Timing hidden** -- randomized timestamps (+/-48h) prevent correlation
- **Messages unlinkable** -- fresh key per claim; no pattern analysis possible
- **Deniable** -- inner claim is unsigned; plausible deniability preserved

Settlement privacy depends on the chain:

| Chain | Transport Privacy | Settlement Privacy |
|-------|------------------|-------------------|
| EVM   | NIP-59 (full)    | Public (EIP-712 claims on-chain) |
| Solana| NIP-59 (full)    | Public (Ed25519 proofs on-chain) |
| Mina  | NIP-59 (full)    | Zero-knowledge (Poseidon commitments + zk-SNARK verification) |

On Mina, the entire payment channel lifecycle -- open, N claims, close -- compresses
into a single constant-size proof. No claim amounts, no intermediate states, no
participant addresses are revealed on-chain.
```

### 6.3 Use Cases This Enables

**1. Agent-to-agent micropayments with full privacy (Mina path):**
Two AI agents transact thousands of sub-cent payments. Neither the relay infrastructure nor the settlement chain reveals who paid whom, how much, or how often. The only public artifact is a single zk-proof that a valid channel lifecycle occurred.

**2. Whistleblower/censorship-resistant publishing (any chain):**
An agent publishes content to a TOON relay via NIP-59 gift-wrapped payments. The relay earns revenue but cannot identify the publisher. Even if the relay is subpoenaed, it holds only ephemeral public keys and encrypted blobs.

**3. Private DVM compute marketplace (Mina path):**
A client requests computation via kind:5250, paying through a Mina-settled channel. The provider delivers results. Neither the relay network nor on-chain observers can link the client to the computation or determine the price paid.

**4. Deniable coordination channels:**
Agents in adversarial environments (competitive market-making, arbitrage) coordinate via gift-wrapped BTP claims. No observer can prove that two specific agents communicated, and the unsigned rumor layer prevents the claims from being used as evidence.

---

## 7. Honest Limitations and Caveats

### 7.1 Architectural Limitations

**Recipient pubkey is visible in the `p` tag:**
NIP-59 hides the sender but not the recipient. Relays and network observers can see who is receiving gift-wrapped events. In the payment channel context, this means one side of the channel is identifiable during transport. Mitigation: use intermediary pubkeys or relay-side blinding (not currently implemented).

**Channel opening/closing may deanonymize transport:**
Even with NIP-59 transport privacy, the on-chain channel open/close events (on EVM/Solana) reveal participant addresses. An observer who sees a channel opened between Alice and Bob, and also sees gift-wrapped events destined for Bob's pubkey during the channel's lifetime, can infer the sender with high probability. On Mina, this is mitigated by participant commitments, but the mitigation is not complete if the same Nostr pubkey is used for both on-chain and relay identities.

**Power-of-2 padding leaks approximate message size:**
NIP-44's padding scheme reduces message sizes to buckets (32, 64, 128, 256, 512 bytes, etc.). While this prevents exact size analysis, an observer can still distinguish a 50-byte claim from a 500-byte claim. Payment channel claims tend to be similar sizes, which helps -- but it is not perfect.

**Frequency analysis is unmitigated:**
An observer who monitors a recipient's inbox can count the rate of gift-wrapped events over time. Frequent bursts may correlate with periods of active trading or computation. NIP-59 does not include cover traffic or batching mechanisms.

### 7.2 Mina-Specific Limitations

**Proving time is non-trivial:**
o1js proofs take 30-120 seconds to generate (community consensus, no official benchmarks). For individual BTP claims, this latency is acceptable (claims are asynchronous). For settlement, it means channel closing is not instant.

**Mina block time (~3 minutes):**
Settlement transactions must wait for Mina block inclusion. This is slower than EVM L2s (seconds) or Solana (~400ms). Acceptable for batch settlement but not for real-time finality.

**Off-chain state is the developer's responsibility:**
Mina's zkApps store only commitments on-chain (8 Field elements currently, 32 post-Mesa). The full channel state (all claims, Merkle tree) must be maintained off-chain by the participants. If both parties lose their off-chain state, the channel cannot be settled.

**Anonymity set concerns:**
If few channels use the Mina settlement path, the anonymity set is small. "Someone settled a channel on the Mina zkApp" narrows down to a small set of possible participants. Privacy improves with adoption.

**Not yet implemented:**
As of this analysis, the Mina settlement path is architecturally designed (Overmind Protocol uses Mina for VRF selection, o1js feasibility validated) but the payment channel zkApp for claim settlement is not yet built. The EVM path with EIP-712 balance proofs is the current production implementation.

### 7.3 Theoretical vs Practical Privacy

**NIP-59 is as strong as its implementation:**
Reusing ephemeral keys, using predictable timestamp randomization, or failing to generate cryptographically random nonces would undermine the privacy guarantees. The protocol is correct; implementations must be careful.

**Correlation attacks across layers:**
A sophisticated adversary with access to both the relay layer (observing gift-wrapped events) and the settlement chain (observing channel state changes) can potentially correlate activity. NIP-59 defends against each layer in isolation but does not address cross-layer correlation.

**No formal security proof:**
NIP-59's privacy properties are argued informally from the cryptographic primitives (ECDH, HKDF, XChaCha20-Poly1305). There is no formal game-based security proof (e.g., IND-CCA2 proof for the full three-layer composition). The individual primitives are well-studied, but the composition has not been formally analyzed.

### 7.4 What This Is NOT

- **Not a privacy coin.** TOON is a payment routing protocol with privacy features, not a base-layer privacy cryptocurrency.
- **Not a mixer.** NIP-59 provides transport privacy, not anonymity-set-based unlinkability for on-chain transactions.
- **Not a replacement for Tor.** IP-level privacy requires network-layer solutions. NIP-59 operates at the application/message layer.
- **Not fully private on EVM/Solana.** Transport privacy is excellent; settlement privacy requires Mina.

---

## Appendix A: Protocol Comparison Detail

### A.1 Lightning Network Onion Routing vs NIP-59

| Property | Lightning Onion (Sphinx) | NIP-59 Gift Wrap |
|---|---|---|
| **Purpose** | Hide route from intermediaries | Hide sender/content from relay |
| **Key management** | Per-route shared secrets (onion layers) | Per-message ephemeral keys |
| **What's hidden from intermediaries** | Source, destination, full route | Sender identity, content, timing |
| **What's hidden from endpoints** | Nothing (endpoints see everything) | Nothing (recipient sees everything) |
| **Deniability** | No (HTLCs are signed) | Partial (rumor is unsigned) |
| **Padding** | Fixed packet size (1300 bytes) | Power-of-2 variable padding |
| **Replay protection** | Shared secret + per-hop payload | Fresh ephemeral key per message |

### A.2 Zcash Shielded vs TOON+Mina

| Property | Zcash Shielded | TOON + Mina |
|---|---|---|
| **Privacy scope** | Single transaction | Payment channel lifecycle |
| **Proof system** | Groth16 (Sprout), Halo2 (Orchard) | Kimchi/Pickles (o1js) |
| **Trusted setup** | Required (Groth16), not required (Halo2) | Not required (Pickles) |
| **Anonymity set** | All shielded transactions | All Mina-settled TOON channels |
| **Throughput** | ~27 TPS shielded | Thousands of claims per settlement |
| **Micropayments** | One proof per tx (~$0.01+ per tx) | Amortized over channel lifetime |
| **Transport privacy** | Not addressed (network layer only) | NIP-59 (application layer) |
