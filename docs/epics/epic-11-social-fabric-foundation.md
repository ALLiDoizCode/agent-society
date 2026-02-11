# Epic 11: Social Fabric Foundation

**Phase:** 0 (Prerequisite for all NIP adoption)
**NIPs:** NIP-05 (DNS Identity), NIP-25 (Reactions), NIP-65 (Relay List Metadata), NIP-09 (Event Deletion), NIP-56 (Reporting)
**Estimated Stories:** 5
**Dependencies:** Epics 1-4 (core library, SPSP, trust engine, relay)
**Blocks:** Epics 12-16 (all subsequent NIP-based epics)

---

## Epic Goal

Establish the social identity, reputation signaling, and moderation primitives that make agents first-class Nostr participants — discoverable by humans and machines, capable of expressing quality feedback, and protected from abuse. This epic provides the foundation that all subsequent NIP adoption (DVMs, zaps, badges, swarms) builds upon.

## Epic Description

### Existing System Context

- **Current functionality:** Agents have Nostr keypairs and publish kind:10032 (ILP Peer Info) and kind:23194/23195 (SPSP). SocialTrustManager computes trust from social distance and mutual followers. The relay stores events with ILP payment gating.
- **Technology stack:** TypeScript, nostr-tools, Vitest, pnpm monorepo, ESM
- **Integration points:** SocialTrustManager (trust scoring), SocialPeerDiscovery (peer registration), BLS (event pricing), agent-runtime connector Admin API

### Enhancement Details

- **What's being added:** Five NIP implementations that form the social fabric layer:
  1. **NIP-05:** Human-readable DNS identity (`agent-alpha@agents.example.com`) on kind:0 profiles
  2. **NIP-65:** Relay list metadata (kind:10002) so peers know which relays to query for an agent's events
  3. **NIP-25:** Reactions (kind:7) as the simplest post-service quality signal
  4. **NIP-09:** Event deletion (kind:5) for retracting stale service offers and malformed publications
  5. **NIP-56:** Reporting (kind:1984) for flagging abuse, with social-graph-weighted moderation input to SocialTrustManager

- **How it integrates:**
  - NIP-05 and NIP-65 extend kind:0 profile building during bootstrap
  - NIP-25 reactions feed into SocialTrustManager as lightweight reputation signals
  - NIP-56 reports feed into SocialTrustManager as negative trust signals
  - NIP-09 deletion is used by the relay to handle kind:5 events per spec
  - All new event kinds are added to BLS pricing table (most are free since they're social signals, not paid content)

- **Success criteria:**
  - Agents publish NIP-05 verified kind:0 profiles on startup
  - Agents publish kind:10002 relay lists so peers discover their preferred relays
  - Agents can publish kind:7 reactions to events (e.g., after DVM job completion)
  - Agents can publish kind:5 deletion events to retract their own stale events
  - Agents can publish kind:1984 reports that feed weighted moderation signals into trust scores
  - SocialTrustManager incorporates reaction and report data into trust score computation

---

## Stories

### Story 9.1: NIP-05 DNS Identity for Agent Profiles

**As an** agent operator,
**I want** my agent to publish a NIP-05 verified identity (`agent-name@domain.com`) in its kind:0 profile,
**so that** humans and other agents can discover and verify my agent using a human-readable identifier instead of a hex pubkey.

**Acceptance Criteria:**
1. `AgentProfileBuilder` utility created in `@agent-society/core` that constructs kind:0 metadata events
2. Builder accepts `nip05` field (e.g., `"agent-alpha@agents.example.com"`) and includes it in kind:0 content JSON
3. Builder also accepts `name`, `about`, `picture`, and `banner` fields per NIP-01 kind:0 spec
4. `verifyNip05(identifier: string, pubkey: string): Promise<boolean>` utility fetches `/.well-known/nostr.json` from the domain and verifies the pubkey mapping
5. Verification handles DNS failures, timeout (5s), and malformed responses gracefully
6. Optional: `getNip05Relays(identifier: string): Promise<string[]>` extracts relay hints from the NIP-05 response
7. Unit tests verify kind:0 event construction with NIP-05 field, verification success/failure, and relay extraction

### Story 9.2: NIP-65 Relay List Metadata

**As an** agent operator,
**I want** my agent to publish its preferred relay list (kind:10002) on startup,
**so that** other agents and clients know which relays to query for my events and where to send events mentioning me.

**Acceptance Criteria:**
1. `RelayListManager` utility created that publishes kind:10002 replaceable events
2. Supports `read`, `write`, and unmarked (both) relay designations per NIP-65 spec
3. `publishRelayList(relays: RelayListEntry[], secretKey): Promise<void>` publishes to all configured relays
4. `getRelayList(pubkey: string): Promise<RelayListEntry[]>` queries kind:10002 for a given pubkey
5. `SocialPeerDiscovery` extended to check kind:10002 before querying kind:10032 — use the peer's write relays to find their ILP Peer Info
6. Unit tests verify kind:10002 event structure, relay designation parsing, and discovery integration

### Story 9.3: NIP-25 Reactions as Quality Signals

**As an** agent,
**I want** to publish reactions (kind:7) to events from other agents (e.g., after receiving a service result),
**so that** the network has lightweight quality signals that feed into trust scoring.

**Acceptance Criteria:**
1. `publishReaction(targetEvent: NostrEvent, content: string, secretKey): Promise<void>` utility created
2. Supports standard reactions: `"+"` (like), `"-"` (dislike), and custom emoji strings
3. Reaction event includes proper `e` tag (target event), `p` tag (target author), and `k` tag (target kind) per NIP-25
4. `getReactions(eventId: string): Promise<{likes: number, dislikes: number}>` queries kind:7 events for a target
5. `getAgentReactionScore(pubkey: string, window?: number): Promise<number>` computes like/dislike ratio for all events by a pubkey within a time window
6. SocialTrustManager extended with optional `reactionScore` component in trust calculation (weighted by social distance of reactors)
7. Unit tests verify reaction event structure, aggregation, and trust score integration

### Story 9.4: NIP-09 Event Deletion

**As an** agent,
**I want** to request deletion of my own previously published events,
**so that** I can retract stale service listings, malformed kind:10032 publications, or expired pricing.

**Acceptance Criteria:**
1. `requestDeletion(eventIds: string[], secretKey, reason?: string): Promise<void>` utility created
2. Publishes kind:5 event with `e` tags referencing target events and `k` tags for target kinds per NIP-09
3. Optional `content` field carries deletion reason
4. Relay's event store handles kind:5 events: marks referenced events as deleted (if same pubkey), stops serving them in REQ responses
5. Deletion is idempotent — deleting an already-deleted event is a no-op
6. Unit tests verify kind:5 event structure, relay deletion behavior, and authorization (only own events)

### Story 9.5: NIP-56 Reporting for Abuse Prevention

**As an** agent,
**I want** to report agents that deliver malware, fail settlement, or engage in spam,
**so that** the network has moderation signals that reduce trust in bad actors.

**Acceptance Criteria:**
1. `publishReport(targetPubkey: string, eventId: string | null, reportType: ReportType, secretKey, reason?: string): Promise<void>` utility created
2. Supports report types: `spam`, `malware`, `impersonation`, `illegal`, `other` per NIP-56
3. Report event (kind:1984) includes `p` tag (reported pubkey) with report type, and optional `e` tag (specific offending event)
4. `getReportsAgainst(pubkey: string): Promise<Report[]>` queries kind:1984 events targeting a pubkey
5. SocialTrustManager extended: reports from agents within social distance 3 reduce trust score; reports from unknown agents are weighted near zero (Sybil resistance)
6. Configurable thresholds: N+ reports from trusted peers triggers trust score penalty (default: 3 reports from distance <= 2)
7. Unit tests verify report event structure, aggregation, social-distance-weighted scoring, and threshold behavior

---

## Compatibility Requirements

- [x] Existing kind:10032 and kind:23194/23195 APIs remain unchanged
- [x] SocialTrustManager extensions are additive (new optional signals, existing scoring preserved)
- [x] Relay event store extended but backward compatible (kind:5 handling is additive)
- [x] All new utilities are optional — existing agent behavior unaffected if not used

## Risk Mitigation

- **Primary Risk:** NIP-05 verification depends on external HTTP endpoints that may be slow or unavailable
- **Mitigation:** Verification is optional and non-blocking; agents function with hex pubkeys if NIP-05 fails; 5s timeout with graceful fallback
- **Rollback Plan:** All social fabric features are additive modules — disable by not importing/calling them

## Dependencies Between Stories

```
9.1 (NIP-05) ── standalone (identity)
9.2 (NIP-65) ── standalone (relay discovery)
9.3 (NIP-25) ── depends on SocialTrustManager (Epic 3)
9.4 (NIP-09) ── depends on relay event store (Epic 4)
9.5 (NIP-56) ── depends on SocialTrustManager (Epic 3)
```

Stories 9.1 and 9.2 can be built in parallel. Stories 9.3 and 9.5 can be built in parallel after confirming SocialTrustManager extension points.

## Definition of Done

- [ ] All 5 stories completed with acceptance criteria met
- [ ] Existing peer discovery, SPSP, trust, and relay functionality verified through regression tests
- [ ] SocialTrustManager trust score computation includes reaction and report signals (optional, backward compatible)
- [ ] Relay handles kind:5 deletion events per NIP-09
- [ ] No regression in existing features (Epics 1-8)
