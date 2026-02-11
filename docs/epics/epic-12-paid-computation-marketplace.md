# Epic 12: Paid Computation Marketplace — Agent DVMs

**Phase:** 1 (Computation Marketplace)
**NIPs:** NIP-90 (Data Vending Machines), NIP-89 (Recommended Application Handlers / Service Discovery)
**Signal Score:** 5/5
**Estimated Stories:** 5
**Dependencies:** Epic 11 (Social Fabric Foundation — NIP-05 identity, NIP-65 relay lists)
**Blocks:** Epic 14 (Labels/Badges — quality ratings on DVM results)

---

## Epic Goal

Enable agents to offer and consume paid computation services using the NIP-90 Data Vending Machine pattern, with ILP micropayments replacing Lightning. Agents advertise capabilities via NIP-89, discover service providers through their social graph, and pay for computation in a single ILP PREPARE/FULFILL round-trip. This creates a decentralized, multi-chain paid computation marketplace that doesn't exist anywhere else.

## Epic Description

### Existing System Context

- **Current functionality:** BLS handles per-kind pricing and ILP payment verification. TOON encoding embeds any Nostr event in ILP packets. Connector routes packets between peers. SocialPeerDiscovery queries kind:10032 for peer info.
- **Technology stack:** TypeScript, nostr-tools, Hono (BLS HTTP), TOON codec, ILP PREPARE/FULFILL
- **Integration points:** BLS pricing table (add DVM kinds), BLS payment handler (process DVM jobs), SocialPeerDiscovery (extend for kind:31990 queries), agent-runtime PacketHandler (no changes needed)

### Enhancement Details

- **What's being added:**
  1. **DVM Job Handler** — New BLS module that processes kind:5xxx job requests from ILP PREPARE data, dispatches to local capability handlers, returns kind:6xxx results in FULFILL data
  2. **NIP-89 Capability Announcements** — Agents publish kind:31990 events advertising which DVM job kinds they support (e.g., kind:5050 text generation, kind:5100 translation)
  3. **DVM Service Discovery** — SocialPeerDiscovery extended to query kind:31990 events, enabling agents to find service providers through their social graph
  4. **DVM Pricing** — BLS pricing table extended with kind:5000-5999 (job requests), kind:6000-6999 (job results), kind:7000 (feedback)
  5. **Job Chaining** — Output of one DVM job feeds as input to another via NIP-90's `"job"` input type, enabling multi-agent computation pipelines across ILP routes

- **How it integrates:**
  - Customer agent sends ILP PREPARE with TOON-encoded kind:5xxx event → BLS receives → dispatches to capability handler → returns TOON-encoded kind:6xxx in FULFILL
  - If price is insufficient: BLS returns ILP REJECT with kind:7000 (payment-required status) in data, including the actual required price
  - NIP-89 kind:31990 events published alongside kind:10032 during bootstrap
  - SocialPeerDiscovery filters kind:31990 by social graph (follows' providers prioritized)
  - Job chaining: Agent A sends result to Agent B as input — routed through connector like any ILP payment

- **Success criteria:**
  - Agents can publish their DVM capabilities via kind:31990
  - Agents can discover DVM service providers through social graph + relay queries
  - Agents can submit DVM job requests as ILP PREPARE packets and receive results in FULFILL
  - Price negotiation works via REJECT → higher-amount PREPARE flow
  - Job chaining works across multiple agents via standard ILP routing

### Payment Flow

```
Customer Agent                     Service Provider Agent
     |                                    |
     |--- ILP PREPARE ------------------>|
     |    (amount=bid, data=TOON(kind:5xxx job request))
     |                                    |
     |    BLS decodes TOON, extracts job  |
     |    BLS evaluates: can I do this?   |
     |    BLS checks: amount >= my price? |
     |                                    |
     |    Option A: Accept immediately    |
     |<-- ILP FULFILL -------------------|
     |    (data=TOON(kind:6xxx result))   |
     |                                    |
     |    Option B: Insufficient payment  |
     |<-- ILP REJECT --------------------|
     |    (data=TOON(kind:7000 feedback,  |
     |     status=payment-required,       |
     |     amount=actual_price))          |
     |                                    |
     |--- ILP PREPARE (higher amount) -->|
     |<-- ILP FULFILL -------------------|
```

---

## Stories

### Story 10.1: DVM Kind Ranges in BLS Pricing Table

**As a** relay/BLS operator,
**I want** the BLS pricing table to recognize NIP-90 event kind ranges (5000-5999, 6000-6999, 7000),
**so that** DVM job requests can be priced and validated through the existing ILP payment flow.

**Acceptance Criteria:**
1. BLS `PricingService` extended to handle kind ranges (not just individual kinds) — kind:5000-5999 as "job request" range, kind:6000-6999 as "job result" range
2. Default pricing: job requests priced per-byte (configurable base rate), job results at 0 (provider doesn't pay to deliver), kind:7000 feedback at 0
3. Per-kind overrides supported within DVM ranges (e.g., kind:5050 text-generation = higher rate than kind:5002 text-extraction)
4. Environment variable support: `DVM_BASE_PRICE_PER_BYTE`, `DVM_KIND_OVERRIDE_5050`, etc.
5. TOON encoding verified with complex DVM tag structures (`i`, `bid`, `param`, `relays`, `encrypted` tags)
6. Unit tests verify pricing for DVM kind ranges, overrides, and TOON round-trip with DVM events

### Story 10.2: DVM Job Handler in BLS

**As a** service provider agent,
**I want** the BLS to process incoming DVM job requests (kind:5xxx) from ILP PREPARE packets and dispatch them to my capability handlers,
**so that** I can offer paid computation services via the ILP network.

**Acceptance Criteria:**
1. `DvmJobHandler` class created in `@agent-society/bls` with registration pattern: `handler.register(jobKind: number, handler: DvmCapabilityHandler)`
2. `DvmCapabilityHandler` interface: `processJob(request: DvmJobRequest): Promise<DvmJobResult | DvmJobRejection>`
3. BLS `handlePayment` extended: if incoming TOON event is kind:5000-5999, delegate to DvmJobHandler
4. On successful job: return ILP FULFILL with TOON-encoded kind:6xxx result event (result kind = request kind + 1000)
5. On price-insufficient: return ILP REJECT with TOON-encoded kind:7000 feedback (status: `payment-required`, `amount` tag with required price)
6. On job failure: return ILP REJECT with kind:7000 feedback (status: `error`, content = error message)
7. NIP-90 `bid` tag in request maps to ILP PREPARE amount field; `amount` tag in response/feedback maps to BLS pricing
8. Unit tests verify: job dispatch, success/fulfill flow, price negotiation flow, error handling, and kind mapping

### Story 10.3: NIP-89 Capability Announcements

**As a** service provider agent,
**I want** to publish kind:31990 events advertising which DVM job kinds I support,
**so that** other agents can discover my capabilities through Nostr relays.

**Acceptance Criteria:**
1. `DvmAnnouncementBuilder` utility creates kind:31990 addressable events per NIP-89 spec
2. Event includes: `d` tag (unique handler ID), `k` tags (supported job request kinds, e.g., `"5050"`, `"5100"`), and content describing capabilities
3. Optional tags: `web` (URL), `picture` (icon), and custom `nip90Params` tag for parameter documentation
4. `publishDvmCapabilities(capabilities: DvmCapability[], secretKey): Promise<void>` publishes to configured relays
5. Built on top of kind:0 profile — agent's kind:0 links to kind:31990 announcements
6. Bootstrap service extended: publish kind:31990 alongside kind:10032 during Phase 3 (announcement phase)
7. Unit tests verify kind:31990 event structure, tag formatting, and bootstrap integration

### Story 10.4: DVM Service Discovery via Social Graph

**As a** customer agent,
**I want** to discover DVM service providers by querying kind:31990 events filtered by my social graph,
**so that** I can find trusted providers for specific computation tasks.

**Acceptance Criteria:**
1. `DvmDiscovery` class created (or `SocialPeerDiscovery` extended) with `discoverProviders(jobKind: number): Promise<DvmProvider[]>`
2. Discovery prioritizes providers within social graph: follows first, then follows-of-follows, then global
3. `DvmProvider` type includes: pubkey, supported kinds, ILP address (from kind:10032), trust score, pricing hints
4. Optionally filters by NIP-05 verified identity (requires Epic 9, Story 9.1)
5. Results sorted by trust score (using SocialTrustManager)
6. Caching: kind:31990 results cached with configurable TTL (default 5 minutes)
7. Unit tests verify social-graph-weighted discovery, sorting, caching, and filter-by-kind

### Story 10.5: DVM Job Chaining Support

**As a** customer agent,
**I want** to chain DVM jobs across multiple service providers (output of one job becomes input to the next),
**so that** I can compose complex computation pipelines across the agent network.

**Acceptance Criteria:**
1. `DvmJobChain` utility created for constructing multi-step pipelines: `chain.add(jobKind, providerPubkey, params)`
2. Uses NIP-90's `i` tag with type `"job"` to reference output from a previous job as input
3. Chain execution sends ILP PREPARE packets sequentially: Job A → wait for FULFILL → extract result → use as input for Job B
4. Each step in the chain is an independent ILP payment to the respective provider
5. Chain supports error handling: if any step fails (REJECT), the chain halts and returns partial results + failure point
6. `DvmJobChainResult` type includes: completed steps, failed step (if any), intermediate results, total cost
7. Unit tests verify: chain construction, sequential execution, result forwarding, error handling at various chain positions

---

## Compatibility Requirements

- [x] Existing BLS `handlePayment` endpoint maintains backward compatibility — DVM kinds are handled as a new code path, non-DVM kinds unchanged
- [x] Existing kind:10032 publication unaffected — kind:31990 is an additional publication
- [x] SocialPeerDiscovery existing kind:10032 queries unchanged — kind:31990 queries are additive
- [x] TOON encoding unchanged — already handles arbitrary Nostr events
- [x] agent-runtime PacketHandler unchanged — already forwards to BLS and uses SHA256 fulfillment

## Risk Mitigation

- **Primary Risk:** NIP-90 uses NIP-04 encryption (deprecated). Our implementation uses NIP-44 instead, which may cause interoperability issues with existing DVM ecosystem (DVMDash, nostrdvm)
- **Mitigation:** Document the NIP-44 choice clearly; propose NIP-ILP-04 formal extension specifying ILP-backed DVMs with NIP-44 encryption. The agent-to-agent use case doesn't require existing client compatibility.
- **Secondary Risk:** TOON encoding with complex DVM `i` tag arrays (URLs, event references, job references) hasn't been validated
- **Mitigation:** Story 10.1 explicitly validates TOON round-trip with complex DVM tag structures before building the handler
- **Rollback Plan:** DVM functionality is a new code path in BLS — disable by removing kind:5xxx from pricing table and not registering capability handlers

## Dependencies Between Stories

```
10.1 (DVM Pricing) ── prerequisite for all others
10.2 (Job Handler) ── depends on 10.1; core execution engine
10.3 (NIP-89 Announcements) ── standalone (publishing only)
10.4 (Service Discovery) ── depends on 10.3 (needs kind:31990 events to discover)
10.5 (Job Chaining) ── depends on 10.2 (needs working job execution) + 10.4 (needs provider discovery)
```

## Definition of Done

- [ ] All 5 stories completed with acceptance criteria met
- [ ] DVM job requests (kind:5xxx) processed and results returned (kind:6xxx) via ILP PREPARE/FULFILL
- [ ] Price negotiation works via kind:7000 feedback in ILP REJECT data
- [ ] Agents advertise capabilities via kind:31990 and discover providers through social graph
- [ ] Job chaining works across multiple providers via sequential ILP payments
- [ ] Existing BLS, relay, and peer discovery functionality passes regression tests
- [ ] No regression in Epics 1-8 functionality
