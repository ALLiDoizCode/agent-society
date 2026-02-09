# Epic 7: SPSP Settlement Negotiation Protocol

**Goal:** Extend the SPSP handshake (kind:23194/23195) to negotiate settlement chains between peers and synchronously open payment channels. The ILP FULFILL proves the channel is live. Extend kind:10032 to advertise settlement capabilities.

## Background

Currently, SPSP (kind:23194/23195) only exchanges an ILP destination address and shared secret. Settlement is configured statically on the connector side via environment variables. Peers have no way to discover each other's chain preferences or automatically establish payment channels.

The connector already supports per-peer settlement via `PeerConfig` (preference, EVM/XRP/Aptos addresses) and has SDKs for opening channels on all three chains (`PaymentChannelSDK`, `XRPChannelSDK`, `AptosChannelSDK`). What's missing is the **negotiation protocol** — a way for two peers to agree on a chain and open a channel as part of the peering handshake.

This epic makes settlement **per-relationship** and **self-configuring**: each peer-pair negotiates their own chain and opens their own channel during the SPSP handshake.

### Architectural Boundary: BLS Negotiates, Connector Executes

**The BLS does NOT directly open, close, fund, or manage payment channels.** The connector owns all payment channel infrastructure (SDKs, private keys, on-chain operations, claim signing, BTP claim exchange). The BLS handles **negotiation policy only** — deciding which chain, which token, and whether to accept a peering request. Channel operations are executed via the connector's Admin API:

- `POST /admin/channels` — open a channel (BLS calls this during SPSP)
- `GET /admin/channels/:channelId` — verify a channel is live
- `POST /admin/channels/:channelId/deposit` — fund a channel
- `POST /admin/channels/:channelId/close` — close a channel
- `GET /admin/balances/:peerId` — query balance state for pricing decisions

This keeps the BLS simple (no blockchain SDKs, no private keys, no on-chain monitoring) while leveraging the connector's existing tri-chain settlement infrastructure.

> **Reference:** See `docs/architecture/payment-channel-reference.md` for connector SDK interfaces, channel lifecycle, and settlement flow.

## Existing System Context

- **Technology stack:** TypeScript, pnpm monorepo, nostr-tools, NIP-44 encryption, Hono HTTP
- **Existing SPSP code:** `packages/core/src/spsp/NostrSpspClient.ts`, `NostrSpspServer.ts`
- **Existing event code:** `packages/core/src/events/builders.ts`, `parsers.ts`
- **Existing types:** `packages/core/src/types.ts` — `IlpPeerInfo`, `SpspRequest`, `SpspResponse`
- **Existing constants:** `packages/core/src/constants.ts` — kind 10032, 23194, 23195
- **Connector Admin API:** `POST /admin/peers` with settlement fields (agent-runtime Epic 20, Story 20.3)
- **Connector SDKs:** `PaymentChannelSDK` (EVM), `XRPChannelSDK`, `AptosChannelSDK` — see payment-channel-reference.md

## Integration Points

- `packages/core/src/types.ts` — Extend `IlpPeerInfo`, `SpspRequest`, `SpspResponse`
- `packages/core/src/events/builders.ts` — Updated event builders
- `packages/core/src/events/parsers.ts` — Updated event parsers
- `packages/core/src/spsp/NostrSpspServer.ts` — Settlement negotiation logic (chain matching + connector Admin API calls)
- `packages/core/src/spsp/NostrSpspClient.ts` — Settlement request construction
- `packages/bls/src/bls/` — BLS payment handler (accept 0-amount SPSP, call connector Admin API for channel operations)
- Agent-runtime `POST /ilp/send` (agent-runtime Epic 20) — for sending SPSP as ILP packets
- Agent-runtime `POST /admin/peers` with settlement (agent-runtime Epic 20) — for registering peers
- Connector `POST /admin/channels` (agent-runtime Epic 21) — for opening payment channels during SPSP
- Connector `GET /admin/channels/:channelId` (agent-runtime Epic 21) — for verifying channel state
- Connector `GET /admin/balances/:peerId` (agent-runtime Epic 21) — for pricing/acceptance decisions

**Dependencies:**

- Agent-runtime Epic 20 must be completed first (provides `POST /ilp/send` and settlement fields on Admin API)
- Agent-runtime Epic 21 must be completed first (provides payment channel Admin APIs for channel operations)

---

## Story 7.1: Extend kind:10032 IlpPeerInfo with Settlement Capabilities

**As a** peer node,
**I want** to advertise my supported settlement chains, addresses, and preferred tokens in my kind:10032 event,
**so that** other peers can discover my settlement capabilities before initiating an SPSP handshake.

**Current `IlpPeerInfo` interface:**
```typescript
interface IlpPeerInfo {
  ilpAddress: string;
  btpEndpoint: string;
  settlementEngine?: string;  // Single string — inadequate
  assetCode: string;
  assetScale: number;
}
```

**New `IlpPeerInfo` interface:**
```typescript
interface IlpPeerInfo {
  ilpAddress: string;
  btpEndpoint: string;
  assetCode: string;
  assetScale: number;
  // New settlement fields
  supportedChains: string[];              // e.g., ["evm:base:8453", "xrp:mainnet"]
  settlementAddresses: Record<string, string>;  // chain → address
  preferredTokens?: Record<string, string>;     // chain → token contract address
  tokenNetworks?: Record<string, string>;       // chain → TokenNetwork contract address
}
```

**Acceptance Criteria:**

1. `IlpPeerInfo` in `types.ts` extended with `supportedChains`, `settlementAddresses`, `preferredTokens`, `tokenNetworks`
2. Old `settlementEngine` field deprecated (kept for backward compat, ignored)
3. `buildIlpPeerInfoEvent()` serializes new fields into kind:10032 content
4. Parser validates new fields (supportedChains is non-empty array, addresses match chain format)
5. Backward compatible: events without new fields parse successfully (empty arrays/objects)
6. Chain identifier format defined: `{blockchain}:{network}:{chainId}` (e.g., `evm:base:8453`, `xrp:mainnet`, `aptos:mainnet:1`)
7. Unit tests for serialization, parsing, backward compat, and validation

---

## Story 7.2: Extend SPSP Request/Response with Settlement Negotiation

**As a** peer initiating an SPSP handshake,
**I want** to include my settlement preferences in the SPSP request (kind:23194) and receive the negotiated chain in the response (kind:23195),
**so that** both peers agree on a settlement chain during the handshake.

**Current interfaces:**
```typescript
interface SpspRequest {
  requestId: string;
  timestamp: number;
}

interface SpspResponse {
  requestId: string;
  destinationAccount: string;
  sharedSecret: string;
}
```

**New interfaces:**
```typescript
interface SpspRequest {
  requestId: string;
  timestamp: number;
  // New settlement fields
  ilpAddress: string;
  supportedChains: string[];
  settlementAddresses: Record<string, string>;
  preferredTokens?: Record<string, string>;
}

interface SpspResponse {
  requestId: string;
  destinationAccount: string;
  sharedSecret: string;
  // New settlement fields
  negotiatedChain: string;                    // The agreed-upon chain
  settlementAddress: string;                  // Responder's address on negotiated chain
  tokenAddress?: string;                      // Token contract (EVM)
  tokenNetworkAddress?: string;               // TokenNetwork contract (EVM)
  channelId?: string;                         // Channel ID if opened during handshake
  settlementTimeout?: number;                 // Challenge period in seconds
}
```

**Acceptance Criteria:**

1. `SpspRequest` and `SpspResponse` in `types.ts` extended with settlement fields
2. `buildSpspRequestEvent()` includes settlement preferences in encrypted payload
3. `buildSpspResponseEvent()` includes negotiated chain and channel info
4. NIP-44 encryption preserved for both request and response
5. Backward compatible: responses without settlement fields parse as basic SPSP
6. Unit tests for builders, parsers, encryption round-trip with new fields

---

## Story 7.3: Implement Settlement Negotiation in SPSP Server

**As a** peer receiving an SPSP request,
**I want** to negotiate the best matching settlement chain, request a payment channel via the connector Admin API, and return the channel details in my SPSP response,
**so that** the ILP FULFILL proves the payment channel is live and ready for claim exchange.

**Scope:**

- Update `NostrSpspServer` to handle settlement negotiation when processing kind:23194
- Implement chain matching: intersect requester's `supportedChains` with own `supportedChains`, prefer matching `preferredTokens`
- If match found: call the connector Admin API to open a channel:
  - `POST /admin/channels` on `CONNECTOR_ADMIN_URL` with `{ peerId, chain, token, tokenNetwork, initialDeposit, settlementTimeout }`
  - Connector handles all on-chain operations internally (SDK selection, key management, tx submission)
  - Connector returns `{ channelId, status }` — BLS waits for `status: "open"`
- Verify channel is live: `GET /admin/channels/:channelId` — confirm state is `open`
- Include `channelId`, `negotiatedChain`, `settlementAddress` in SPSP response
- If no chain match: return SPSP response without settlement (graceful degradation)
- If channel opening fails: return ILP REJECT with error details

**The BLS does NOT import or call any blockchain SDK directly.** All on-chain operations are delegated to the connector via its Admin API. The BLS only needs `CONNECTOR_ADMIN_URL` (already available from env config).

**Acceptance Criteria:**

1. Chain matching logic implemented: intersection of supportedChains arrays
2. Preference order: requester's preferredTokens → responder's preferredTokens → first match
3. Channel opened via `POST /admin/channels` on connector (not via direct SDK call)
4. BLS verifies channel state via `GET /admin/channels/:channelId` before returning FULFILL
5. Channel opening is **synchronous** — SPSP response only sent after connector confirms channel is open
6. `channelId` included in SpspResponse when channel successfully opened
7. ILP REJECT returned with `invalid_request` code if no chain intersection
8. ILP REJECT returned with `internal_error` code if connector returns channel opening failure
9. Timeout handling: if channel opening exceeds ILP packet expiresAt, reject with T00
10. Configurable `initialDeposit` and `settlementTimeout` via environment variables
11. No blockchain SDK imports in BLS code — all chain operations via connector Admin API
12. Unit tests with mocked connector Admin API, integration test with real connector + Anvil

---

## Story 7.4: Configurable 0-Amount SPSP Acceptance for Bootstrap

**As a** bootstrap node operator,
**I want** to accept 0-amount ILP packets for SPSP events,
**so that** new peers can perform their initial SPSP handshake without needing a pre-existing payment channel.

**Scope:**

- Add `SPSP_MIN_PRICE` environment variable to BLS config (default: standard pricing)
- When set to `"0"`, BLS accepts 0-amount packets that contain SPSP requests (kind:23194)
- Only applies to SPSP request events — other event kinds still require payment
- Log when 0-amount SPSP is accepted (for monitoring bootstrap activity)

**Acceptance Criteria:**

1. `SPSP_MIN_PRICE=0` env var makes BLS accept 0-amount SPSP packets
2. Non-SPSP events still require standard pricing even when SPSP_MIN_PRICE=0
3. Default behavior (no env var): SPSP requires standard pricing
4. Accepted 0-amount SPSP requests logged at INFO level
5. Unit tests for pricing bypass on SPSP events

---

## Compatibility Requirements

- [x] Existing kind:10032 events without settlement fields parse successfully
- [x] Existing SPSP handshakes without settlement fields still work
- [x] NIP-44 encryption preserved for kind:23194/23195
- [x] BLS payment validation unchanged for non-SPSP events

## Risk Mitigation

**Primary Risk:** On-chain channel opening during SPSP could timeout, leaving the channel in an inconsistent state.

**Mitigation:**

- Set ILP packet timeout to accommodate chain confirmation time (configurable per chain)
- If timeout occurs, SPSP request is rejected — peer can retry
- Channel opening is idempotent for MVP (always creates new channel)
- Failed channels can be cleaned up out-of-band by the connector

**Secondary Risk:** Connector Admin API unavailability during SPSP handshake.

**Mitigation:**

- BLS checks connector health before initiating channel operations
- Clear error propagation: connector 503 → BLS returns ILP REJECT with `internal_error`
- Retry logic on transient connector errors (1 retry with backoff)

**Rollback Plan:**

1. Revert `IlpPeerInfo`, `SpspRequest`, `SpspResponse` to original interfaces
2. Revert SPSP server to original logic
3. Remove connector Admin API calls from SPSP negotiation
4. Settlement reverts to static env var configuration

## Definition of Done

- [ ] kind:10032 advertises settlement capabilities
- [ ] SPSP request includes settlement preferences
- [ ] SPSP response includes negotiated chain and channel details
- [ ] Channel opened synchronously during SPSP — FULFILL = channel is live
- [ ] 0-amount SPSP acceptance configurable for bootstrap nodes
- [ ] Backward compatible with existing events and handshakes
- [ ] Integration test: two peers negotiate chain and open channel via SPSP

## Related Work

- **Agent-Runtime Epic 20:** Bidirectional middleware (`POST /ilp/send`, settlement on `POST /admin/peers`)
- **Agent-Runtime Epic 21:** Payment Channel Admin APIs (channel CRUD, deposit, close, balance queries — used by this epic's SPSP negotiation)
- **Agent-Society Epic 6:** Decentralized peer discovery (provides the discovery layer this epic's negotiation builds on)
- **Agent-Society Epic 8:** Network bootstrap (uses this epic's settlement negotiation in the bootstrap flow)
- **Reference:** `docs/architecture/payment-channel-reference.md` — Connector SDK interfaces (internal to connector, not called by BLS)
