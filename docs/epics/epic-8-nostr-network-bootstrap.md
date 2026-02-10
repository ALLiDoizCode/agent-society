# Epic 8: Nostr-Based Network Bootstrap with ILP Settlement

**Goal:** Implement the complete network bootstrap flow where peers discover each other via Nostr relays, establish ILP routes via 0-amount packets, negotiate settlement via SPSP, and open payment channels — with only relay reads and initial connector registration being free. All subsequent communication is paid and ILP-routed.

## Background

Epic 6 established decentralized peer discovery (genesis peers, ArDrive registry, social graph). Epic 7 added settlement negotiation to SPSP. This epic wires them together into a complete bootstrap flow that self-organizes a network of peers with payment channels.

The key economic design: **the bootstrap node (peer1) earns routing fees** from all subsequent peer announcements and cross-peer SPSP handshakes. Only the initial relay reads and connector registration are free. The bootstrap SPSP handshake to peer1 uses 0-amount ILP packets (configured via `SPSP_MIN_PRICE=0` from Epic 7, Story 7.4).

**Dependencies:**

- Agent-runtime Epic 20 (bidirectional middleware — `POST /ilp/send`, settlement on `POST /admin/peers`)
- Agent-runtime Epic 21 (payment channel Admin APIs — channel open/close/deposit/query, balance queries)
- Agent-Society Epic 7 (settlement negotiation — chain matching, SPSP extensions)

## Existing System Context

- **Technology stack:** TypeScript, pnpm monorepo, nostr-tools, Hono, ws, better-sqlite3
- **Discovery:** `GenesisPeerLoader`, `ArDrivePeerRegistry`, `NostrPeerDiscovery`, `SocialPeerDiscovery` (Epic 6)
- **SPSP with settlement:** `NostrSpspClient`, `NostrSpspServer` with chain negotiation (Epic 7)
- **Event schemas:** kind:10032 (IlpPeerInfo with settlement capabilities), kind:23194/23195 (SPSP with settlement)
- **Bootstrap service:** `packages/core/src/bootstrap.ts` — current bootstrap orchestration
- **Docker entrypoint:** `docker/src/entrypoint.ts` — container orchestrator
- **Agent-runtime APIs:** `POST /ilp/send` (outbound packets), `POST /admin/peers` (peer registration with settlement)

## Integration Points

- `packages/core/src/bootstrap.ts` — Rewrite bootstrap orchestration
- `docker/src/entrypoint.ts` — Update startup sequence
- `packages/core/src/spsp/NostrSpspClient.ts` — Send SPSP as ILP packets via `POST /ilp/send`
- `packages/core/src/discovery/NostrPeerDiscovery.ts` — kind:10032 relay reads
- Agent-runtime `POST /ilp/send` endpoint (Epic 20)
- Agent-runtime `POST /admin/peers` with settlement config (Epic 20)
- Connector `POST /admin/channels` for channel operations (Epic 21)
- Connector `GET /admin/channels/:channelId` for channel verification (Epic 21)
- Agent-runtime Docker Compose and deploy scripts

---

## Bootstrap Flow Overview

### Phase 1: Free Operations (no ILP routes exist)

```
1. Peer1 publishes kind:10032 (with settlement capabilities) to own relay
2. Peer2 reads kind:10032 from peer1's relay (passive WebSocket — FREE)
3. Peer2 registers peer1 via POST /admin/peers on own connector (local call — FREE)
   → Now peer2's connector has a BTP route to peer1
```

### Phase 2: 0-Amount ILP Bootstrap (uses ILP path, but no cost)

```
4. Peer2 sends 0-amount ILP PREPARE to peer1:
   → BLS calls POST /ilp/send on agent-runtime
   → Packet: destination=g.peer1, amount=0, data=TOON(kind:23194 with settlement prefs)
   → Routes: peer2 connector → BTP → peer1 connector → agent-runtime-1 → BLS-1

5. Peer1 BLS handles SPSP:
   → Negotiates chain (intersection of supportedChains)
   → Opens payment channel via connector Admin API: POST /admin/channels (synchronous)
   → Returns ILP FULFILL with kind:23195 (channelId, negotiated chain)

6. Peer2 receives FULFILL:
   → Extracts channel details from response data
   → Updates peer1 registration with channelId via POST /admin/peers
```

### Phase 3: Paid Operations (all ILP-routed, peer1 earns fees)

```
7. Peer2 publishes kind:10032 as TOON-encoded ILP PREPARE (amount > 0)
   → Routes through peer1 (peer1 earns routing fee)
   → Peer1's relay stores the event

8. Peer1 discovers peer2's kind:10032 on its relay
   → Sends paid SPSP (kind:23194) to peer2 via POST /ilp/send
   → Peer2 negotiates chain, opens channel via connector Admin API → FULFILL
   → Peer1 registers peer2 via POST /admin/peers

9. Peer3-5 discover peers on relay (free reads)
   → All SPSP handshakes route through ILP (paid)
   → Each peer-pair negotiates own settlement chain
   → Network grows organically
```

### Phase 4 Implementation Note: Reverse SPSP (RelayMonitor)

> **Actual flow vs. original plan:** The original design had peers responding to kind:10032 announcements within the same ILP FULFILL (peer announces → bootstrap responds with SPSP in the FULFILL payload). The implemented flow uses a separate round-trip:
>
> 1. Peer publishes kind:10032 as paid ILP PREPARE → stored on bootstrap relay
> 2. Bootstrap node's `RelayMonitor` (Story 8.4) detects the new kind:10032 event on its relay
> 3. Bootstrap node **initiates** a paid SPSP handshake (kind:23194) back to the new peer via `POST /ilp/send`
> 4. Peer responds with SPSP FULFILL (kind:23195) including channel details
>
> **Rationale for current design:**
> - Cleaner separation of concerns: relay event monitoring is decoupled from SPSP handling
> - Independent retry on handshake failure without re-sending the announcement
> - RelayMonitor can process events at its own pace (no blocking within ILP packet handling)

---

## Story 8.1: Rewrite Bootstrap Service for ILP-First Flow

**As a** node operator,
**I want** the bootstrap service to discover peers via Nostr relays and establish ILP routes using 0-amount packets,
**so that** my node joins the network through the standard ILP path without special-case direct communication.

**Scope:**

- Rewrite `packages/core/src/bootstrap.ts` to implement the three-phase flow
- Phase 1: Load genesis/ArDrive peers, read their relays for kind:10032, register via `POST /admin/peers`
- Phase 2: For each registered peer, send 0-amount SPSP via `POST /ilp/send` on agent-runtime
- Phase 3: After bootstrap, publish own kind:10032 as paid ILP PREPARE
- Track bootstrap state: `discovering` → `registering` → `handshaking` → `announcing` → `ready`
- Emit bootstrap progress events for monitoring

**Acceptance Criteria:**

1. Bootstrap service reads kind:10032 from genesis peer relays (passive WebSocket)
2. Registers each discovered peer via `POST /admin/peers` (with BTP endpoint from kind:10032)
3. Sends 0-amount SPSP (kind:23194) via `POST /ilp/send` for each registered peer
4. Waits for FULFILL (channel opened) before proceeding
5. On FULFILL: updates peer registration with channelId and settlement config
6. On REJECT: logs error, skips peer, continues with others
7. After all handshakes complete: publishes own kind:10032 as paid ILP PREPARE
8. Bootstrap state machine emits events: `bootstrap:phase`, `bootstrap:peer-registered`, `bootstrap:channel-opened`, `bootstrap:ready`
9. Health endpoint reports bootstrap state
10. Unit tests with mocked agent-runtime APIs and Nostr relay

---

## Story 8.2: Send SPSP Handshakes as ILP Packets via Agent-Runtime

**As a** BLS developer,
**I want** the SPSP client to send handshake requests as ILP packets through agent-runtime's `POST /ilp/send`,
**so that** all peer-to-peer communication uses the ILP network (with 0-amount for bootstrap, paid for post-bootstrap).

**Scope:**

- Update `NostrSpspClient` (or create `IlpSpspClient`) to send SPSP via `POST /ilp/send` instead of direct Nostr relay writes
- TOON-encode the kind:23194 event as ILP PREPARE data
- Set amount=0 for bootstrap handshakes, amount>0 for post-bootstrap
- Parse FULFILL data as kind:23195 SPSP response
- Parse REJECT data for error details
- Configure agent-runtime URL via `AGENT_RUNTIME_URL` env var

**Acceptance Criteria:**

1. SPSP request sent as ILP PREPARE via `POST /ilp/send`
2. TOON encoding of kind:23194 event matches BLS `/handle-payment` expectations
3. Amount configurable: 0 for bootstrap, standard pricing for post-bootstrap
4. FULFILL data decoded as SpspResponse (with settlement fields from Epic 7)
5. REJECT data decoded as error with code and message
6. Timeout configurable per handshake (accounts for on-chain channel opening time)
7. `AGENT_RUNTIME_URL` env var validated on startup
8. Retry logic: 1 retry on timeout, no retry on explicit REJECT
9. Unit tests for TOON encoding, response parsing, error handling

---

## Story 8.3: Publish Peer Announcements as Paid ILP Packets

**As a** peer node,
**I want** to publish my kind:10032 event as a paid ILP packet after bootstrap,
**so that** the bootstrap node earns routing fees and the event is stored on its relay.

**Scope:**

- After bootstrap SPSP handshake completes, publish own kind:10032 as TOON-encoded ILP PREPARE
- Route through bootstrap peer (who has a relay that stores events)
- Amount set to standard event pricing (base price per byte)
- kind:10032 published to bootstrap peer's relay via ILP (not direct WebSocket write)
- Verify event appears on the relay after FULFILL

**Acceptance Criteria:**

1. kind:10032 published as TOON-encoded ILP PREPARE via `POST /ilp/send`
2. Destination is bootstrap peer's ILP address
3. Amount calculated from standard event pricing (byte-based)
4. FULFILL confirms event stored on relay
5. Other peers can subsequently read the event from the relay
6. Publish only happens after own SPSP handshake is complete
7. Failure to publish logged as WARNING (non-fatal — peer is still operational)
8. Unit test verifies TOON encoding of kind:10032 event

---

## Story 8.4: Reverse Registration and Cross-Peer Discovery

**As a** bootstrap node,
**I want** to discover newly announced peers on my relay and initiate SPSP handshakes with them,
**so that** the bootstrap node has bidirectional payment channels with all peers in the network.

**Scope:**

- Bootstrap node subscribes to its own relay for new kind:10032 events
- When a new peer's kind:10032 arrives (paid via ILP from Story 8.3):
  - Register peer via `POST /admin/peers`
  - Send paid SPSP handshake (kind:23194) via `POST /ilp/send`
  - On FULFILL: update registration with channelId
- Cross-peer discovery: non-bootstrap peers also subscribe to relay for new peers
  - SPSP handshakes between non-bootstrap peers route through ILP (multi-hop, paid)
  - Each peer-pair negotiates own settlement chain independently

**Acceptance Criteria:**

1. Bootstrap node monitors own relay for new kind:10032 events
2. New peers automatically registered and SPSP-handshaked
3. Payment channel opened for each new peer (bidirectional with bootstrap)
4. Cross-peer SPSP handshakes route through ILP network
5. Each peer-pair has independent settlement relationship
6. Duplicate kind:10032 events from same peer are idempotent (no double registration)
7. Peer removal: if kind:10032 event has newer timestamp with empty content, deregister
8. Unit tests for relay subscription, event filtering, idempotent registration

---

## Story 8.5: Update Docker Entrypoint and Compose for Bootstrap Flow

**As a** deployer,
**I want** the Docker entrypoint and Compose configuration to support the new ILP-first bootstrap flow,
**so that** a multi-peer network self-organizes when containers start.

**Scope:**

- Update `docker/src/entrypoint.ts` to use new bootstrap service from Story 8.1
- Add environment variables for settlement capabilities:
  ```
  SUPPORTED_CHAINS=evm:base:8453
  SETTLEMENT_ADDRESS_EVM_BASE=0x...
  PREFERRED_TOKEN_EVM_BASE=0x...
  TOKEN_NETWORK_EVM_BASE=0x...
  SETTLEMENT_TIMEOUT=86400
  INITIAL_DEPOSIT=1000000
  SPSP_MIN_PRICE=0          # Bootstrap node only
  AGENT_RUNTIME_URL=http://agent-runtime-1:3100
  ```
- Update startup sequence: wait for agent-runtime health before starting bootstrap
- Update agent-runtime docker-compose-unified.yml in agent-runtime repo:
  - Add settlement env vars to agent-society services
  - Add EVM addresses to .env.peers
  - Add contract addresses as shared env vars
- Update `scripts/deploy-5-peer-multihop.sh` in agent-runtime repo:
  - Add bootstrap verification: check that peers discover each other
  - Add channel verification: query TokenNetwork for opened channels
  - Add routing verification: send test packet through full topology

**Acceptance Criteria:**

1. Docker entrypoint starts bootstrap service after agent-runtime health check
2. Settlement env vars configured and validated on startup
3. Peer1 configured as bootstrap node (`SPSP_MIN_PRICE=0`)
4. Peers 2-5 configured with peer1 as known bootstrap peer
5. Full 5-peer network self-organizes: relay reads → registration → SPSP → channels
6. Deploy script verifies: health checks, routing tables, payment channels
7. End-to-end test: send paid packet from peer1 to peer5 through full topology
8. All 16 containers (TigerBeetle + 5 connectors + 5 agent-runtimes + 5 agent-societies) healthy

---

## Compatibility Requirements

- [x] Existing peer discovery (genesis, ArDrive, social) still works as discovery layer
- [x] Existing SPSP client/server code reused (extended in Epic 7)
- [x] Docker entrypoint backward compatible (new env vars are additive)
- [x] Non-bootstrap nodes work without `SPSP_MIN_PRICE=0`

## Risk Mitigation

**Primary Risk:** Bootstrap node is a single point of failure during initial network formation.

**Mitigation:**

- Multiple bootstrap nodes can be configured via `KNOWN_PEERS` array
- ArDrive registry provides permanent backup peer list
- Once peers have direct channels, bootstrap node failure doesn't affect existing peering
- Health monitoring emits events for bootstrap failures

**Secondary Risk:** On-chain channel opening during SPSP could slow bootstrap significantly.

**Mitigation:**

- Base L2 confirmation time is ~2-4 seconds per channel
- Bootstrap handshakes are sequential per peer but could be parallelized in future
- Failed channel openings don't block other peer handshakes (continue with next peer)
- Configurable timeout per chain via `SETTLEMENT_TIMEOUT` env var

**Rollback Plan:**

1. Revert entrypoint.ts to pre-Epic 8 bootstrap
2. Remove settlement env vars from Docker Compose
3. Peers fall back to static YAML config in connector
4. Settlement reverts to static env var configuration

## Story 8.6: Fix IlpSendResult Field Name Mismatch

**As a** node bootstrapping into the network,
**I want** the `IlpSendResult` interface to match what agent-runtime actually returns,
**so that** SPSP handshakes and peer announcements correctly detect FULFILL vs REJECT responses.

**Integration Gap Addressed:** Gap 6 (`accepted` vs `fulfilled` field mismatch — CRITICAL)

**Acceptance Criteria:**

1. `IlpSendResult` field name aligned — `AgentRuntimeClient` normalizes both `accepted` and `fulfilled` fields
2. All consumers (`BootstrapService`, `IlpSpspClient`, `RelayMonitor`) correctly detect FULFILL responses
3. Backward compatible with both field names
4. Unit tests verify both field names handled

---

## Story 8.7: TOON + NIP-44 Round-Trip Integration Test

**As a** developer maintaining the SPSP-over-ILP flow,
**I want** an integration test verifying the full TOON + NIP-44 encode/decode round-trip,
**so that** encoding/encryption issues are caught before they silently break settlement handshakes.

**Integration Gap Addressed:** Gap 9 (no round-trip test for TOON + NIP-44)

**Acceptance Criteria:**

1. Test exercises full encode/send/receive/decode cycle for kind:23194 and kind:23195
2. NIP-44 encrypted content survives TOON round-trip byte-for-byte
3. Settlement fields preserved through the full pipeline
4. Uses real cryptography and real TOON encoder/decoder

---

## Story 8.8: Fix Peer Registration Circular Dependency

**As a** peer node opening payment channels during bootstrap,
**I want** the channel opening flow to work without requiring settlement info that isn't available yet,
**so that** the bootstrap flow can register peers, handshake, and open channels in sequence.

**Integration Gaps Addressed:** Gap 5 (circular dependency in peer registration), Gap 11 (POST /admin/peers called twice)

**Acceptance Criteria:**

1. `peerAddress` flows through from SPSP request to `channelClient.openChannel()`
2. Agent-runtime changes documented: `POST /admin/channels` accepts `peerAddress`, `POST /admin/peers` made idempotent
3. Agent-society side verified as correct (peerAddress already in interface)

---

## Story 8.9: Bootstrap Cleanup — Fulfillment Generation, Phase 4 Flow, Health Check

**As a** node operator,
**I want** cleanup items addressed: unnecessary fulfillment generation removed, Phase 4 flow documented, health check enhanced,
**so that** the bootstrap system follows design contracts and provides accurate observability.

**Integration Gaps Addressed:** Gap 7 (BLS fulfillment generation), Gap 10 (Phase 4 flow inversion), Gap 13 (health check)

**Acceptance Criteria:**

1. BLS `/handle-payment` no longer returns `fulfillment` in responses
2. Phase 4 (RelayMonitor) flow documented with rationale for current design
3. Health endpoint includes `peerCount` and `channelCount` when bootstrap is ready
4. Unit tests verify fulfillment removal and health counts

---

## Definition of Done

- [ ] Bootstrap service implements three-phase flow (free discovery → 0-amount SPSP → paid announcements)
- [ ] SPSP handshakes sent as ILP packets via `POST /ilp/send`
- [ ] Peer announcements (kind:10032) sent as paid ILP packets
- [ ] Bootstrap node auto-discovers and handshakes with newly announced peers
- [ ] Cross-peer discovery routes SPSP through ILP network
- [ ] Docker Compose deploys 5-peer network that self-organizes
- [ ] Deploy script verifies routing, channels, and end-to-end packet delivery
- [ ] No regression in existing discovery or SPSP functionality
- [ ] IlpSendResult field mismatch fixed — bootstrap correctly detects FULFILL/REJECT
- [ ] TOON + NIP-44 round-trip verified by integration test
- [ ] Peer registration circular dependency resolved (with agent-runtime coordination)
- [ ] BLS fulfillment generation removed, health check enhanced

## Related Work

- **Agent-Society Epic 6:** Decentralized peer discovery (provides discovery layer)
- **Agent-Society Epic 7:** SPSP settlement negotiation (provides negotiation protocol)
- **Agent-Runtime Epic 20:** Bidirectional middleware (provides `POST /ilp/send` and settlement on `POST /admin/peers`)
- **Agent-Runtime Epic 21:** Payment Channel Admin APIs (channel open/close/deposit/query, balance queries — used during SPSP)
- **Agent-Runtime Epic 17:** BTP claim exchange (automatic claim exchange after channel opens)
- **Agent-Runtime Epic 19:** Production deployment parity (TigerBeetle integration)
- **Reference:** `docs/architecture/payment-channel-reference.md`
