# Epic 13: ILP Zaps & Social Routing

**Phase:** 2a (Trust Infrastructure)
**NIPs:** NIP-57 (Zaps — adapted for ILP), NIP-51 (Lists — for route preferences)
**Signal Score:** 5/5
**Estimated Stories:** 5
**Dependencies:** Epic 11 (Social Fabric — NIP-25 reactions as baseline reputation), Epic 12 (DVMs — zaps compose with DVM quality feedback)
**Blocks:** Epic 14 (Labels/Badges — multi-signal trust model), Epic 16 (Swarms — trust-gated membership)

---

## Epic Goal

Replace NIP-57's Lightning-specific zap infrastructure with ILP-backed zaps that provide cryptographic proof-of-payment, public reputation signals, and trust-weighted route prioritization. Combined with NIP-51 curated lists, this enables social routing — where an agent's trust score (informed by zap history, social distance, and settlement reliability) determines route priority in the connector.

## Epic Description

### Existing System Context

- **Current functionality:** SocialTrustManager computes trust from social distance + mutual followers. The `reputationScore` component is a TODO placeholder. SocialPeerDiscovery registers peers with connector Admin API but doesn't pass priority/weight.
- **Technology stack:** SocialTrustManager, BLS payment handler, connector Admin API (`POST /admin/peers`), ILP PREPARE/FULFILL
- **Integration points:** SocialTrustManager (add zap-based reputation), BLS (new zap handler), SocialPeerDiscovery (trust-weighted route priority), connector Admin API (priority field on peer registration)

### Enhancement Details

- **What's being added:**
  1. **ILP Zap Events** — Adapted kind:9734 (zap request) and kind:9735 (zap receipt) with ILP-specific tags replacing Lightning's `bolt11`/`preimage`
  2. **BLS Zap Handler** — Accepts ILP payments for zap requests, publishes zap receipts to specified relays
  3. **Zap-Based Reputation** — SocialTrustManager wired with `zapVolumeReceived()`, `zapDiversity()`, and `settlementReliability()` methods
  4. **Trust-Weighted Route Priority** — Peer registration includes priority derived from trust score; connector prefers trusted routes
  5. **NIP-51 Route Preference Lists** — kind:30000 "trusted-routes" and kind:10000 mute lists as explicit routing signals

- **Trust Score Formula (updated):**
  ```
  trustScore(agent) =
      w1 * socialDistance(followGraph, self, agent) +    // Already implemented
      w2 * mutualFollowers(self, agent) +                 // Already implemented
      w3 * reactionScore(agent) +                         // From Epic 9, Story 9.3
      w4 * zapVolumeReceived(agent, window=30d) +         // NEW: sum of ILP zap amounts
      w5 * zapDiversity(agent) +                          // NEW: unique zappers (Sybil resistance)
      w6 * settlementReliability(agent) +                 // NEW: % successful settlements
      w7 * reportPenalty(agent)                            // From Epic 9, Story 9.5
  ```

### ILP Zap Payment Flow

```
Zapper Agent                        Zappee Agent
     |                                    |
     | 1. Create kind:9734 ILP zap request |
     |    (p=recipient, e=target event,    |
     |     ilp-amount, relays=[...])       |
     |                                    |
     | 2. ILP PREPARE ------------------>|
     |    (amount=zap amount,              |
     |     data=TOON(kind:9734 request))   |
     |                                    |
     |    BLS validates zap request        |
     |    BLS accepts payment              |
     |                                    |
     |<-- ILP FULFILL -------------------|
     |    (fulfillment=SHA256(data))       |
     |                                    |
     | 3. Zappee BLS creates kind:9735    |
     |    receipt with fulfillment proof   |
     |    → publishes to specified relays  |
     |                                    |
     | 4. SocialTrustManager observes     |
     |    kind:9735 on relay → updates    |
     |    trust scores for zappee         |
```

---

## Stories

### Story 11.1: ILP Zap Request & Receipt Event Format

**As a** protocol developer,
**I want** well-defined ILP zap request (kind:9734) and receipt (kind:9735) event formats that replace Lightning-specific fields with ILP equivalents,
**so that** the network has a standard for verifiable proof-of-payment events.

**Acceptance Criteria:**
1. `IlpZapRequest` type defined with fields: `p` tag (recipient), `e`/`a` tags (target event), `relays` tag (where to publish receipt), `ilp-amount` tag (amount + asset code + scale), optional `content` (zap comment)
2. `IlpZapReceipt` type defined with fields: `p` tag (recipient), `P` tag (sender), `e`/`a` tags (target), `description` tag (embedded zap request JSON), `ilp-amount` tag, `fulfillment` tag (base64 SHA256 proof), `ilp-asset` tag (asset code + scale)
3. `buildZapRequestEvent(params, secretKey): NostrEvent` creates kind:9734 events
4. `buildZapReceiptEvent(receipt, secretKey): NostrEvent` creates kind:9735 events
5. `parseZapRequest(event): IlpZapRequest` and `parseZapReceipt(event): IlpZapReceipt` parsers
6. Receipt includes SHA256(description) binding for cryptographic verification that receipt matches request
7. Anonymous zaps supported via throwaway Nostr keys (per NIP-57)
8. Unit tests verify event structure, round-trip parsing, anonymous zap construction, and description hash binding

### Story 11.2: BLS Zap Handler

**As a** zappee agent,
**I want** the BLS to accept ILP payments for zap requests and automatically publish zap receipts,
**so that** I receive payments and the network gets public proof-of-payment events.

**Acceptance Criteria:**
1. BLS extended: when incoming TOON event is kind:9734, delegate to `ZapHandler`
2. `ZapHandler` validates: zap request has valid structure, `p` tag matches the BLS agent's pubkey, amount meets minimum (configurable, default: 0 = any amount accepted)
3. On valid payment: create kind:9735 receipt event with embedded zap request, fulfillment proof, and ILP amount tags
4. Receipt signed by BLS agent's key and published to relays specified in the zap request's `relays` tag
5. If relay publication fails: receipt is stored locally and retried (best-effort publication; payment still accepted)
6. BLS pricing table: kind:9734 priced at 0 per-byte (the zap amount IS the payment), kind:9735 at 0 (receipts are free to publish)
7. Unit tests verify: zap request validation, receipt creation, fulfillment proof, relay publication, retry on failure

### Story 11.3: Zap-Based Reputation in SocialTrustManager

**As an** agent,
**I want** the trust score for other agents to incorporate their zap history (volume received, diversity of zappers, settlement reliability),
**so that** I make better routing and credit decisions based on economic reputation data.

**Acceptance Criteria:**
1. `zapVolumeReceived(pubkey: string, windowDays?: number): Promise<bigint>` method added — queries kind:9735 receipts where `p` tag = pubkey, sums `ilp-amount` values within time window
2. `zapDiversity(pubkey: string, windowDays?: number): Promise<number>` method added — counts unique `P` tags (unique zappers) in kind:9735 receipts for pubkey (Sybil resistance: 100 zaps from 1 sender < 10 zaps from 10 senders)
3. `settlementReliability(pubkey: string): Promise<number>` method added — queries connector Admin API for settlement success rate of channels with this peer (if available via `GET /admin/channels/:peerId`)
4. Trust score computation updated with new components: `zapVolumeScore`, `zapDiversityScore`, `settlementReliabilityScore` with configurable weights
5. Default weights balance existing signals with new: socialDistance=0.25, mutualFollowers=0.15, reactionScore=0.1, zapVolume=0.15, zapDiversity=0.1, settlementReliability=0.15, reportPenalty=0.1
6. All new scoring methods return 0 if no data available (graceful degradation)
7. Unit tests verify each scoring method, combined trust calculation, and graceful handling of missing data

### Story 11.4: Trust-Weighted Route Priority

**As an** agent,
**I want** peer registration with the connector to include a priority/weight derived from the trust score,
**so that** the connector prefers routes through more trusted peers.

**Acceptance Criteria:**
1. `SocialPeerDiscovery` extended: when registering a peer via `POST /admin/peers`, compute trust score and map to route priority
2. Priority mapping: trustScore 0.8-1.0 → priority 100 (highest), 0.5-0.8 → priority 50, 0.2-0.5 → priority 20, <0.2 → priority 5
3. `ConnectorAdminClient.addPeer()` type extended with optional `priority` field on routes
4. Priority recalculated periodically (configurable interval, default: 1 hour) and updated via `PUT /admin/routes/:prefix`
5. If connector Admin API doesn't support priority: graceful fallback (log warning, register without priority)
6. Unit tests verify trust-to-priority mapping, periodic recalculation, and graceful fallback

### Story 11.5: NIP-51 Route Preference Lists

**As an** agent,
**I want** to publish and consume NIP-51 lists for routing preferences (trusted routes, mute lists),
**so that** I can explicitly signal which peers I prefer or distrust for routing.

**Acceptance Criteria:**
1. `publishTrustedRoutes(pubkeys: string[], secretKey): Promise<void>` publishes kind:30000 follow set with `d` tag = `"trusted-routes"` per NIP-51
2. `publishMuteList(pubkeys: string[], secretKey): Promise<void>` publishes kind:10000 mute list per NIP-51
3. `getTrustedRoutes(pubkey: string): Promise<string[]>` queries kind:30000 with `d=trusted-routes`
4. `getMuteList(pubkey: string): Promise<string[]>` queries kind:10000
5. SocialPeerDiscovery integration: peers on trusted-routes list get priority boost (+20); peers on mute list are excluded from registration entirely
6. Optional: NIP-51 encrypted items (private mute entries via NIP-44 in content field) supported
7. Unit tests verify list publication, retrieval, and routing integration (boost and exclusion behavior)

---

## Compatibility Requirements

- [x] Existing SocialTrustManager API unchanged — new scoring methods are additive
- [x] Existing SocialPeerDiscovery peer registration unchanged — priority is optional
- [x] BLS payment handler backward compatible — zap kinds are a new code path
- [x] connector Admin API changes are additive (optional priority field)

## Risk Mitigation

- **Primary Risk:** Nostr clients (Primal, Damus) won't display ILP zap receipts since they expect Lightning bolt11/preimage tags
- **Mitigation:** This is acceptable for agent-to-agent zaps. If human visibility is needed later, publish dual receipts (ILP + Lightning-compatible tags). For now, agent zaps are machine-readable reputation signals.
- **Secondary Risk:** connector Admin API may not support route priority field
- **Mitigation:** Story 11.4 includes graceful fallback. If needed, propose Admin API extension to agent-runtime.
- **Rollback Plan:** Zap handler is a new BLS code path — disable by not registering kind:9734 in pricing table. Trust score additions are backward compatible (default to 0 when no zap data).

## Dependencies Between Stories

```
11.1 (Event Format) ── prerequisite for all others
11.2 (BLS Zap Handler) ── depends on 11.1
11.3 (Zap Reputation) ── depends on 11.1 (needs kind:9735 events to query)
11.4 (Route Priority) ── depends on 11.3 (needs trust scores with zap data)
11.5 (NIP-51 Lists) ── standalone (but integrates with 11.4 for priority boost)
```

## Definition of Done

- [ ] All 5 stories completed with acceptance criteria met
- [ ] ILP zap payments create verifiable kind:9735 receipts with fulfillment proofs
- [ ] SocialTrustManager computes trust scores using zap volume, diversity, and settlement reliability
- [ ] Peer registration includes trust-derived route priority
- [ ] NIP-51 trusted-routes and mute lists influence routing decisions
- [ ] Existing functionality passes regression tests
- [ ] No regression in Epics 1-9 functionality
