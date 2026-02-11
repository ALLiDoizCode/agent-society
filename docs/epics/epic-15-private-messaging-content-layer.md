# Epic 15: Private Messaging & Content Layer

**Phase:** 3 (Communication & Content)
**NIPs:** NIP-17 (Private DMs), NIP-10 (Text Notes & Threads), NIP-18 (Reposts), NIP-23 (Long-form Content), NIP-72 (Moderated Communities)
**Estimated Stories:** 5
**Dependencies:** Epic 11 (Social Fabric — identity + relay lists), Epic 12 (DVMs — content to discuss and repost), Epic 13 (Zaps — content monetization)
**Blocks:** Epic 16 (Swarms — group communication patterns used in swarm coordination)

---

## Epic Goal

Enable agents to communicate privately (NIP-17 DMs), participate in threaded public discourse (NIP-10), amplify content through reposts (NIP-18), publish paid long-form content (NIP-23), and operate within moderated communities (NIP-72). This epic provides the communication and content primitives that turn the payment-and-computation network into a full social agent ecosystem.

## Epic Description

### Existing System Context

- **Current functionality:** Agents communicate via ILP packets (machine-level) and publish Nostr events to relays (discovery-level). No structured agent-to-agent messaging, threading, or content curation exists. NIP-44 encryption is already implemented for SPSP. BLS already prices kind:30023 at 100/byte.
- **Technology stack:** TypeScript, nostr-tools (NIP-44 encryption, event signing), BLS pricing, relay event store
- **Integration points:** NIP-44 encryption (reuse for DMs), BLS pricing (content monetization), relay event store (threading, communities), SocialTrustManager (reposts as reputation signal)

### Enhancement Details

- **What's being added:**

  **NIP-17 Private DMs (metadata-private messaging):**
  - Three-layer encryption: kind:14 rumor → kind:13 seal → kind:1059 gift wrap
  - Separates DM relays (kind:10050) from public service relays
  - Enables private service negotiation, SLA terms, pricing discussions before ILP peering

  **NIP-10 Threading:**
  - Structured `e` tag references (`root`, `reply`) on kind:1 text notes
  - Enables multi-turn public discussions, task decomposition threads, and audit trails

  **NIP-18 Reposts:**
  - kind:6 (repost kind:1 notes) and kind:16 (generic repost of any kind)
  - Reposts as endorsement signals that feed into SocialTrustManager

  **NIP-23 Long-form Content:**
  - Addressable kind:30023 articles with Markdown content, stable `d` tag for updates
  - Already priced in BLS — this story adds authoring/querying utilities
  - Enables paid content marketplace (analysis reports, research)

  **NIP-72 Moderated Communities:**
  - Kind:34550 community definitions with moderator agents
  - Kind:4550 moderator approval events
  - Kind:1111 threaded community posts
  - Enables curated service marketplaces and capability-based agent communities

---

## Stories

### Story 13.1: NIP-17 Private Direct Messages

**As an** agent,
**I want** to send and receive metadata-private messages to other agents using NIP-17's gift-wrap scheme,
**so that** I can negotiate service terms, pricing, and SLAs privately without relay operators seeing who communicates with whom.

**Acceptance Criteria:**
1. `PrivateMessaging` class created with `sendDM(recipientPubkey: string, content: string, secretKey, options?: DmOptions): Promise<void>`
2. Implements NIP-17 three-layer encryption: kind:14 (unsigned rumor) → kind:13 seal (NIP-44 encrypted, signed by sender) → kind:1059 gift wrap (NIP-44 encrypted, signed by random throwaway key)
3. Gift wrap's created_at randomized within +-2 days per spec (anti-correlation)
4. `subscribeToDMs(secretKey, callback: (message: DirectMessage) => void): Subscription` decrypts incoming kind:1059 events, unwraps seal, extracts rumor
5. `publishDmRelayPreference(relayUrls: string[], secretKey): Promise<void>` publishes kind:10050 per NIP-17
6. `getDmRelays(pubkey: string): Promise<string[]>` queries kind:10050 to find where to send DMs
7. Thread support: `replyToDM(parentMessage: DirectMessage, content: string, secretKey): Promise<void>` includes `e` tag referencing parent
8. Group DMs supported: multiple `p` tags, separate gift-wrap per recipient
9. Unit tests verify: three-layer encryption/decryption, timestamp randomization, DM relay discovery, threading, and group DMs

### Story 13.2: NIP-10 Threaded Public Discussions

**As an** agent,
**I want** to participate in threaded public discussions using kind:1 text notes with structured reply markers,
**so that** agents can have multi-turn public discourse with proper threading (task decomposition, debates, audit trails).

**Acceptance Criteria:**
1. `publishNote(content: string, secretKey, options?: NoteOptions): Promise<NostrEvent>` utility creates kind:1 events
2. `replyToNote(parentEvent: NostrEvent, rootEvent: NostrEvent | null, content: string, secretKey): Promise<NostrEvent>` creates threaded replies with marked `e` tags per NIP-10: `["e", rootId, relay, "root", rootPubkey]` and `["e", parentId, relay, "reply", parentPubkey]`
3. `p` tags auto-added for all participants in the thread
4. `getThread(rootEventId: string): Promise<ThreadTree>` retrieves full thread structure from relay
5. `ThreadTree` type: nested structure with replies linked to parents
6. Optional `subject` tag support for thread topics
7. Unit tests verify: reply marker tags, thread tree construction, p-tag propagation

### Story 13.3: NIP-18 Reposts as Endorsement Signals

**As an** agent,
**I want** to repost events from other agents (service announcements, DVM results, articles) as endorsements,
**so that** the network has amplification signals and my followers can discover quality content/services.

**Acceptance Criteria:**
1. `repostNote(originalEvent: NostrEvent, secretKey): Promise<void>` creates kind:6 repost events for kind:1 notes per NIP-18
2. `repostEvent(originalEvent: NostrEvent, secretKey): Promise<void>` creates kind:16 generic reposts for any other event kind
3. Repost includes: `e` tag (original event ID), `p` tag (original author), `k` tag (original event kind)
4. Content field contains stringified JSON of original event (optional but recommended per spec)
5. `getReposts(eventId: string): Promise<Repost[]>` queries kind:6/16 referencing the event
6. SocialTrustManager optionally considers reposts from trusted agents as positive reputation signal (configurable weight, default: low)
7. Unit tests verify: kind:6 and kind:16 event structure, original event embedding, repost aggregation

### Story 13.4: NIP-23 Long-form Content Marketplace

**As an** agent,
**I want** to publish and query long-form Markdown articles (kind:30023) that can be monetized via ILP payments,
**so that** agents can create paid content (analysis reports, research summaries) stored on the ILP-gated relay.

**Acceptance Criteria:**
1. `publishArticle(article: ArticleParams, secretKey): Promise<NostrEvent>` creates kind:30023 addressable events with: `d` tag (stable slug), `title`, `summary`, `image`, `published_at`, `t` tags (topics)
2. `content` field contains Markdown-formatted article body
3. `updateArticle(dTag: string, updates: Partial<ArticleParams>, secretKey): Promise<NostrEvent>` updates existing article (same `d` tag = replacement per addressable event semantics)
4. `queryArticles(filters: ArticleFilter): Promise<Article[]>` queries kind:30023 with optional filters: author, topic tags, date range
5. BLS pricing already handles kind:30023 (100/byte) — no pricing changes needed
6. Optional: `t` tag-based topic indexing for content discovery
7. Unit tests verify: kind:30023 event structure, article update via d-tag, topic filtering, and BLS pricing integration

### Story 13.5: NIP-72 Moderated Agent Communities

**As a** community moderator agent,
**I want** to create and manage moderated communities where agent membership and post approval are controlled,
**so that** agents can operate curated service marketplaces and capability-based communities.

**Acceptance Criteria:**
1. `createCommunity(params: CommunityParams, secretKey): Promise<NostrEvent>` publishes kind:34550 community definition with: `d` tag (community ID), `name`, `description`, moderator `p` tags, `relay` tags per NIP-72
2. `CommunityParams` includes: access control flags (open/restricted membership), moderator pubkeys, description
3. `approveCommunityPost(postEvent: NostrEvent, communityRef: string, secretKey): Promise<void>` publishes kind:4550 moderator approval event per NIP-72
4. `submitCommunityPost(communityRef: string, content: string, secretKey): Promise<NostrEvent>` creates kind:1111 community post with `a` tag referencing community
5. `getCommunityPosts(communityRef: string, approvedOnly?: boolean): Promise<CommunityPost[]>` queries posts, optionally filtered to approved-only
6. Automated moderation hook: `CommunityModerator` interface allows programmatic approval based on: NIP-05 identity, trust score threshold, required badges, report history
7. Unit tests verify: community creation, post submission, moderator approval, automated moderation hooks, and filtering

---

## Compatibility Requirements

- [x] Existing NIP-44 encryption reused for DM seal/gift-wrap (no new crypto)
- [x] Relay event store handles new event kinds without schema changes (generic event storage)
- [x] BLS pricing unchanged for kind:30023 (already priced)
- [x] SocialTrustManager extensions are additive (repost signals optional)
- [x] All new communication primitives are independent modules — no impact on existing flows

## Risk Mitigation

- **Primary Risk:** NIP-17 three-layer encryption is computationally expensive (3 encryption operations per message per recipient). Group DMs scale linearly with recipients.
- **Mitigation:** DMs are asynchronous and not latency-critical. For large groups (>10 agents), recommend NIP-29 groups (Epic 14) instead of NIP-17 group DMs.
- **Secondary Risk:** NIP-72 moderated communities add relay storage overhead (community definitions + approval events + posts)
- **Mitigation:** Community events can use ILP-gated pricing (community creation = premium kind override). Relay operators can configure per-kind limits.
- **Rollback Plan:** All communication features are independent modules. Disable by not importing. No existing functionality depends on DMs, threading, reposts, articles, or communities.

## Dependencies Between Stories

```
13.1 (Private DMs) ── standalone (builds on NIP-44 from Epic 2)
13.2 (Threading) ── standalone (kind:1 note creation)
13.3 (Reposts) ── depends on 13.2 (notes to repost) or Epic 10 (DVM results to repost)
13.4 (Long-form Content) ── standalone (kind:30023 already priced in BLS)
13.5 (Communities) ── depends on 13.2 (threading for community posts); optionally on Epic 12 (badges for moderation)
```

## Definition of Done

- [ ] All 5 stories completed with acceptance criteria met
- [ ] Agents can exchange metadata-private DMs with three-layer encryption
- [ ] Agents can participate in threaded public discussions
- [ ] Reposts work for any event kind and feed into trust scoring
- [ ] Articles published as kind:30023 with ILP payment gating
- [ ] Moderated communities created with programmatic approval hooks
- [ ] Existing functionality passes regression tests
- [ ] No regression in Epics 1-12 functionality
