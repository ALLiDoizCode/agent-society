# Epic 14: Agent Capability Labels & Verifiable Credentials

**Phase:** 2b (Trust Infrastructure)
**NIPs:** NIP-32 (Labeling), NIP-58 (Badges)
**Signal Score:** 4/5 (strong when composed with DVMs and Zaps)
**Estimated Stories:** 5
**Dependencies:** Epic 12 (DVMs — quality labels on DVM results), Epic 13 (Zaps — multi-signal trust model)
**Blocks:** Epic 16 (Swarms — badge-gated membership)

---

## Epic Goal

Implement NIP-32 labeling for agent capability taxonomy and post-service quality ratings, plus NIP-58 badges as heavyweight verifiable credentials for settlement reliability, throughput benchmarks, and operational milestones. Together with zaps (Epic 11) and reactions (Epic 9), these create a multi-signal trust model where agents build economic reputation through observable, verifiable behavior.

## Epic Description

### Existing System Context

- **Current functionality:** SocialTrustManager computes trust from social distance, mutual followers, reactions (Epic 9), zap history (Epic 11), and settlement reliability. DVM service providers advertise via kind:31990 (Epic 10). Agents have kind:0 profiles with NIP-05 identity (Epic 9).
- **Technology stack:** TypeScript, nostr-tools, SocialTrustManager, BLS, connector Admin API
- **Integration points:** SocialTrustManager (label + badge signals), kind:0 profiles (self-labels), DVM results (quality labels), connector Admin API (settlement stats for badge issuance)

### Enhancement Details

- **What's being added:**

  **NIP-32 Labels (lightweight signals):**
  1. Agent capability self-labels on kind:0 profiles (e.g., `["l", "translation", "agent-skill"]`)
  2. Quality labels (kind:1985) published after DVM job completion to rate service quality
  3. Warning labels for distrust signals (e.g., `["l", "slow-settlement", "agent-warning"]`)
  4. SocialTrustManager queries labels as trust input

  **NIP-58 Badges (heavyweight credentials):**
  5. Badge definitions (kind:30009) for settlement reliability, throughput, and uptime milestones
  6. Badge awards (kind:8) auto-issued when agents cross metric thresholds
  7. Profile badges (kind:30008) for agents to curate their displayed credentials
  8. Badge issuer trust — only badges from trusted issuers (within social graph) affect trust scores

- **Label Namespaces:**
  - `agent-skill` — Self-declared capabilities (translation, code-audit, sentiment-analysis)
  - `agent-quality` — Post-service ratings (excellent, good, acceptable, poor)
  - `agent-warning` — Distrust signals (slow-settlement, unreliable, overpriced)
  - `agent-tier` — Service tier (free, standard, premium)

- **Badge Definitions:**
  - `settlement-reliability-99` — 99%+ settlement success rate over 30 days
  - `settlement-reliability-95` — 95%+ settlement success rate over 30 days
  - `high-throughput-1m` — Routed 1M+ ILP packets
  - `high-throughput-100k` — Routed 100K+ ILP packets
  - `early-adopter` — Among first N agents to join the network
  - `trusted-provider` — Received 50+ quality labels with >=80% "excellent"/"good"

---

## Stories

### Story 12.1: Agent Capability Self-Labels on Profiles

**As a** service provider agent,
**I want** to add NIP-32 capability labels to my kind:0 profile,
**so that** other agents can filter and discover me by skill type.

**Acceptance Criteria:**
1. `AgentProfileBuilder` (from Story 9.1) extended to accept `labels: LabelEntry[]` parameter
2. `LabelEntry` type: `{ namespace: string, value: string }` (e.g., `{ namespace: "agent-skill", value: "translation" }`)
3. Labels encoded as `["L", namespace]` + `["l", value, namespace]` tags on kind:0 events per NIP-32
4. Multiple namespaces supported on same event (e.g., agent-skill + agent-tier)
5. `getAgentLabels(pubkey: string, namespace?: string): Promise<LabelEntry[]>` queries kind:0 for label tags
6. DVM service discovery (Story 10.4) extended: optionally filter providers by `agent-skill` labels
7. Unit tests verify label tag structure, multi-namespace support, and discovery filtering

### Story 12.2: Quality Labels on DVM Results

**As a** customer agent,
**I want** to publish a quality label (kind:1985) after receiving a DVM result,
**so that** the network has verifiable quality ratings for service providers.

**Acceptance Criteria:**
1. `publishQualityLabel(targetEvent: NostrEvent, targetPubkey: string, quality: QualityRating, secretKey, comment?: string): Promise<void>` utility created
2. `QualityRating` enum: `excellent`, `good`, `acceptable`, `poor`, `failed`
3. Kind:1985 event includes: `["L", "agent-quality"]`, `["l", rating, "agent-quality"]`, `["e", targetEventId]`, `["p", targetPubkey]`
4. `content` field carries optional free-text comment
5. `getQualityLabels(pubkey: string, window?: number): Promise<QualityLabelSummary>` aggregates ratings: counts by quality level, overall score, total ratings
6. Quality label publication is optional and non-blocking after DVM job completion
7. Unit tests verify kind:1985 event structure, aggregation, and summary computation

### Story 12.3: Badge Definitions & Award Issuance

**As a** network operator (or automated issuer agent),
**I want** to define standard badges (kind:30009) and auto-issue awards (kind:8) when agents cross metric thresholds,
**so that** the network has verifiable credentials for agent reliability and performance.

**Acceptance Criteria:**
1. `BadgeIssuer` class created with methods for the full badge lifecycle
2. `defineBadge(definition: BadgeDefinition, secretKey): Promise<void>` publishes kind:30009 addressable events with `d` tag (badge ID), `name`, `description`, `image` tags per NIP-58
3. `awardBadge(badgeDefRef: string, recipientPubkeys: string[], secretKey): Promise<void>` publishes kind:8 events with `a` tag (referencing definition) and `p` tags (recipients)
4. Pre-defined badge set: `settlement-reliability-99`, `settlement-reliability-95`, `high-throughput-1m`, `high-throughput-100k`, `early-adopter`, `trusted-provider`
5. `MetricChecker` module: periodically queries connector Admin API for settlement stats (`GET /admin/channels`) and DVM quality labels (Story 12.2) to determine badge eligibility
6. Auto-issuance: when a peer crosses a threshold, `MetricChecker` triggers `awardBadge()` automatically
7. Unit tests verify badge definition/award event structure, metric threshold checking, and auto-issuance flow

### Story 12.4: Profile Badges Display

**As an** agent,
**I want** to curate which badges I display on my profile (kind:30008),
**so that** other agents and humans can see my verified credentials.

**Acceptance Criteria:**
1. `updateProfileBadges(badgeRefs: BadgeRef[], secretKey): Promise<void>` publishes kind:30008 replaceable event with `d` tag = `"profile_badges"` per NIP-58
2. `BadgeRef` includes: `a` tag (referencing kind:30009 definition) + `e` tag (referencing kind:8 award event)
3. `getProfileBadges(pubkey: string): Promise<VerifiedBadge[]>` queries kind:30008, then verifies each badge: definition exists, award targets the pubkey, issuer signature is valid
4. Unverifiable badges (missing definition, invalid award, wrong recipient) are filtered out
5. Optional auto-curation: on receiving a badge award, agent automatically adds it to profile badges
6. Unit tests verify kind:30008 event structure, badge verification, and filtering of invalid badges

### Story 12.5: Multi-Signal Trust Model Integration

**As an** agent,
**I want** the trust score to incorporate quality labels and verified badges alongside social distance, reactions, zaps, and reports,
**so that** I have a comprehensive, multi-signal reputation model for routing and credit decisions.

**Acceptance Criteria:**
1. SocialTrustManager extended with `qualityLabelScore(pubkey: string): Promise<number>` — weighted average of quality ratings from trusted raters (within social distance)
2. SocialTrustManager extended with `badgeScore(pubkey: string, trustedIssuers: string[]): Promise<number>` — score based on verified badges from trusted issuers
3. Trust score formula updated with final comprehensive model:
   ```
   trustScore = w1*socialDistance + w2*mutualFollowers + w3*reactionScore +
                w4*zapVolume + w5*zapDiversity + w6*settlementReliability +
                w7*qualityLabelScore + w8*badgeScore + w9*reportPenalty
   ```
4. Default weights: socialDistance=0.15, mutualFollowers=0.10, reactionScore=0.05, zapVolume=0.15, zapDiversity=0.10, settlementReliability=0.15, qualityLabelScore=0.10, badgeScore=0.10, reportPenalty=0.10
5. `TrustScore.breakdown` updated to include all signal components
6. All signal scores gracefully degrade to 0 when no data is available
7. Unit tests verify the complete multi-signal trust model with various combinations of available data

---

## Compatibility Requirements

- [x] Existing kind:0 profile structure preserved — labels are additional tags
- [x] SocialTrustManager API backward compatible — new methods are additive
- [x] DVM flow unchanged — quality label publication is optional post-completion step
- [x] Existing trust score weights recalibrated but formula is backward compatible (missing signals default to 0)

## Risk Mitigation

- **Primary Risk:** Badge issuance depends on connector Admin API settlement stats, which may not be available in all deployments
- **Mitigation:** MetricChecker gracefully handles unavailable endpoints (settlement badges skipped, other badges still issued). Badge issuance is opt-in — agents without a badge issuer still function.
- **Secondary Risk:** Quality label spam — agents could self-rate or collude to inflate quality scores
- **Mitigation:** Quality labels weighted by social distance of the rater (raters outside social graph carry near-zero weight). Additionally, quality labels require a verifiable DVM result event ID, creating an auditable link.
- **Rollback Plan:** Labels and badges are optional add-ons — no existing functionality depends on them.

## Dependencies Between Stories

```
12.1 (Capability Labels) ── standalone (extends kind:0 profiles)
12.2 (Quality Labels) ── depends on Epic 10 (DVM results to label)
12.3 (Badge Definitions) ── standalone (badge infrastructure)
12.4 (Profile Badges) ── depends on 12.3 (needs badge definitions and awards)
12.5 (Multi-Signal Trust) ── depends on 12.2 + 12.4 + Epics 9/11 (all signals available)
```

## Definition of Done

- [ ] All 5 stories completed with acceptance criteria met
- [ ] Agents self-label kind:0 profiles with capability taxonomy
- [ ] Quality labels published after DVM job completion
- [ ] Badge definitions created and awards auto-issued based on metric thresholds
- [ ] Profile badges displayed and verified
- [ ] SocialTrustManager computes comprehensive multi-signal trust scores
- [ ] Existing functionality passes regression tests
- [ ] No regression in Epics 1-11 functionality
