# Epic 16: Payment-Gated Agent Swarms

**Phase:** 4 (Advanced Patterns)
**NIPs:** NIP-29 (Relay-Based Groups)
**Signal Score:** 4/5
**Estimated Stories:** 4
**Dependencies:** Epic 13 (Zaps/Trust — trust-gated membership), Epic 14 (Badges — badge-gated membership), Epic 15 (Communication — group messaging patterns)
**Blocks:** None (terminal epic in current roadmap)

---

## Epic Goal

Enable orchestrator agents to form, manage, and dissolve payment-gated agent swarms using NIP-29 relay-based groups. Group membership requires an open ILP payment channel with minimum deposit. Intra-swarm communication uses TOON-encoded group events sent as ILP PREPARE packets — every message is a micropayment for the sub-task it represents. Groups get hierarchical ILP address prefixes for efficient intra-swarm routing.

## Epic Description

### Existing System Context

- **Current functionality:** Connector routes ILP packets between peers. Payment channels support deposits on Base L2, XRP Ledger, and Aptos. Admin API manages peers and routes dynamically. TOON encodes arbitrary Nostr events for ILP transmission.
- **Technology stack:** TypeScript, nostr-tools, connector Admin API, payment channels, TOON codec, ILP address hierarchy
- **Integration points:** Connector Admin API (dynamic group peer management), payment channels (membership deposit verification), ILP address allocation (group prefix), TOON encoding (group events in packets), SocialTrustManager + badges (membership gating)

### Enhancement Details

- **What's being added:**
  1. **Group Lifecycle Manager** — Create, manage, and dissolve NIP-29 groups with ILP-specific membership requirements
  2. **Payment Channel Membership Gating** — Join requests validated against open payment channel state and minimum deposit
  3. **Group ILP Address Allocation** — Each group gets a prefix (e.g., `g.swarm-<groupId>`) with member sub-addresses for efficient routing
  4. **Intra-Swarm Communication** — TOON-encoded group events (with `h` tag) sent as ILP PREPARE packets — each event is a micropayment for task compensation

### Swarm Lifecycle

```
1. FORM:   Orchestrator creates group (kind:9007 create-group)
           Sets requirements: min channel deposit, optional badge requirements
           Publishes kind:39000 metadata (restricted, closed)
           Allocates ILP prefix: g.swarm-<group-id>

2. JOIN:   Specialist agent sends kind:9021 join request
           Orchestrator validates:
             - Open payment channel? (query connector Admin API)
             - Min deposit met? (query channel balance)
             - Required badges held? (query kind:30008)
             - Trust score above threshold? (query SocialTrustManager)
           If valid: kind:9000 put-user
           Register member as peer under group ILP prefix:
             g.swarm-<group-id>.<member-pubkey-short>

3. WORK:   Intra-swarm events use h tag for group scoping
           Each event sent as ILP PREPARE to target member(s)
           Payment amount per event = sub-task compensation
           Connector routes within group prefix efficiently

4. SETTLE: Orchestrator aggregates results
           Optional: publish final output (kind:30023 article, kind:6xxx DVM result)
           Payment channels settle
           kind:9008 delete-group → members deregistered
```

---

## Stories

### Story 14.1: NIP-29 Group Lifecycle Management

**As an** orchestrator agent,
**I want** to create, configure, and dissolve relay-based groups with structured membership management,
**so that** I can form and disband agent swarms for coordinated tasks.

**Acceptance Criteria:**
1. `SwarmManager` class created with full NIP-29 group lifecycle support
2. `createSwarm(params: SwarmParams, secretKey): Promise<SwarmGroup>` publishes kind:9007 (create-group) to relay with group metadata
3. `SwarmParams` includes: `name`, `about`, `picture`, access control (`private`/`restricted`/`closed`), membership requirements (`minDeposit`, `requiredBadges`, `minTrustScore`)
4. Kind:39000 group metadata published by relay with group info, admin list, and access rules
5. `addMember(groupId: string, memberPubkey: string, secretKey): Promise<void>` publishes kind:9000 (put-user) admin action
6. `removeMember(groupId: string, memberPubkey: string, secretKey): Promise<void>` publishes kind:9001 (remove-user)
7. `dissolveSwarm(groupId: string, secretKey): Promise<void>` publishes kind:9008 (delete-group)
8. `getSwarmMembers(groupId: string): Promise<string[]>` queries kind:39002 (members list)
9. Timeline integrity: group events include `previous` tags referencing recent group events per NIP-29
10. Unit tests verify: group creation, member add/remove, dissolution, metadata updates, and timeline integrity

### Story 14.2: Payment Channel Membership Gating

**As an** orchestrator agent,
**I want** to validate join requests against the applicant's payment channel state (open channel + minimum deposit),
**so that** only agents with economic stake can join the swarm.

**Acceptance Criteria:**
1. `MembershipValidator` class created with configurable requirements
2. On kind:9021 join request, validator checks:
   - Open payment channel exists between applicant and orchestrator (query connector Admin API: `GET /admin/channels/:peerId`)
   - Channel deposit >= swarm's `minDeposit` requirement
   - Optional: required badges held (query kind:30008 from Epic 12)
   - Optional: trust score above threshold (query SocialTrustManager)
3. If all requirements met: auto-approve (publish kind:9000 put-user)
4. If requirements not met: reject with kind:9001 and reason content (e.g., "Insufficient channel deposit: required 1000000, found 500000")
5. `MembershipRequirements` type: `{ minDeposit?: bigint, requiredBadges?: string[], minTrustScore?: number, maxMembers?: number }`
6. Connector Admin API queried via existing `ConnectorAdminClient` interface
7. Unit tests verify: channel state validation, deposit threshold, badge checking, trust score checking, approval/rejection flows

### Story 14.3: Group ILP Address Allocation & Routing

**As a** swarm member,
**I want** my agent to receive an ILP address under the swarm's prefix and have intra-swarm traffic routed efficiently,
**so that** swarm communication uses the ILP network for paid task execution.

**Acceptance Criteria:**
1. On group creation, allocate ILP address prefix: `g.swarm-<groupId>` (configurable base prefix)
2. On member addition, register member with connector under group prefix: `g.swarm-<groupId>.<memberShortId>`
3. `memberShortId` derived from first 8 chars of hex pubkey (collision-checked)
4. Route registration via connector Admin API: `POST /admin/routes` with group prefix pointing to swarm relay
5. Intra-swarm routing: packets addressed to `g.swarm-<groupId>.*` are routed within the group's peer set
6. On member removal: deregister route via `DELETE /admin/routes/<prefix>`
7. On group dissolution: remove all member routes and group prefix
8. `SwarmAddressManager` handles the full lifecycle of group address allocation, member addressing, and cleanup
9. Unit tests verify: prefix allocation, member address registration, intra-swarm routing, cleanup on removal/dissolution

### Story 14.4: Intra-Swarm TOON-Encoded Communication

**As a** swarm member,
**I want** to send group-scoped events to other swarm members as ILP PREPARE packets,
**so that** every swarm communication is a paid transaction that compensates the recipient for their work.

**Acceptance Criteria:**
1. `SwarmMessenger` class created for sending group-scoped events
2. `sendToMember(groupId: string, targetPubkey: string, event: NostrEvent, amount: bigint, secretKey): Promise<SwarmMessageResult>` sends TOON-encoded event as ILP PREPARE to target's swarm address
3. Events include `h` tag (group ID) for group scoping per NIP-29
4. `broadcastToSwarm(groupId: string, event: NostrEvent, amountPerMember: bigint, secretKey): Promise<SwarmBroadcastResult>` sends to all members (fan-out ILP PREPAREs)
5. Payment amount per event = sub-task compensation configurable by orchestrator
6. `SwarmMessageResult` includes: accepted (FULFILL) or rejected (REJECT with reason), cost, latency
7. `SwarmBroadcastResult` includes: per-member results, total cost, success/failure counts
8. BLS on receiving side: validates `h` tag matches an active group the sender belongs to; rejects if sender not in group
9. Orchestrator can send aggregate results as kind:30023 (article) or kind:6xxx (DVM result) at swarm conclusion
10. Unit tests verify: group-scoped event construction, ILP PREPARE/FULFILL flow, broadcast fan-out, membership validation, and rejection handling

---

## Compatibility Requirements

- [x] Connector Admin API used via existing `ConnectorAdminClient` — no new API endpoints required (uses existing peers, routes, channels)
- [x] TOON encoding unchanged — group events are standard Nostr events with `h` tag
- [x] BLS payment handler extended with group membership validation (new code path, existing paths unchanged)
- [x] ILP address allocation follows existing hierarchical addressing conventions
- [x] Payment channels unchanged — swarm uses existing deposit/settlement infrastructure

## Risk Mitigation

- **Primary Risk:** Broadcast fan-out creates O(N) ILP packets per message where N = group size. For large swarms (50+ members), this may cause packet storms.
- **Mitigation:** Implement configurable fan-out limits. For large groups, use relay-based message distribution (publish to relay, members subscribe) instead of ILP broadcast. Hybrid approach: critical messages (task assignments, results) via ILP; informational messages via relay.
- **Secondary Risk:** Group ILP address prefix collision if multiple swarms active simultaneously.
- **Mitigation:** Group IDs include random component. SwarmAddressManager checks for prefix conflicts before allocation.
- **Tertiary Risk:** Payment channel deposit validation depends on connector Admin API availability.
- **Mitigation:** Configurable fallback: if channel state unavailable, require manual approval (orchestrator reviews kind:9021 manually) instead of auto-rejection.
- **Rollback Plan:** Swarm functionality is an independent module. Disabling it does not affect individual agent peering, DVMs, zaps, or trust scoring.

## Dependencies Between Stories

```
14.1 (Group Lifecycle) ── prerequisite for all others
14.2 (Membership Gating) ── depends on 14.1 (group exists to validate against)
14.3 (Address Allocation) ── depends on 14.1 (members to allocate addresses for)
14.4 (TOON Communication) ── depends on 14.1 + 14.3 (group exists + addresses allocated)
```

14.2 and 14.3 can be built in parallel after 14.1. Story 14.4 requires both.

## Definition of Done

- [ ] All 4 stories completed with acceptance criteria met
- [ ] Orchestrator agents can create, manage, and dissolve swarms via NIP-29
- [ ] Membership gated by payment channel deposits, badges, and trust scores
- [ ] Group members receive ILP addresses under swarm prefix
- [ ] Intra-swarm communication via TOON-encoded ILP PREPARE packets (paid task execution)
- [ ] Existing functionality passes regression tests
- [ ] No regression in Epics 1-13 functionality
