# Agent-Society Integration Gaps

**Last Updated:** 2026-02-09
**Context:** Epic 7 (Settlement Negotiation) and Epic 8 (ILP-First Bootstrap) implementation analysis

---

## Executive Summary

Epic 7 and Epic 8 are **60-75% complete**. The core infrastructure (types, event builders/parsers, TOON encoding, ILP packet sending, bootstrap phases) is in place and working. However, **settlement negotiation and payment channel opening are not wired into the ILP code path**, causing the bootstrap flow to complete without establishing payment channels.

**Critical Impact:** The 5-phase bootstrap flow executes through Phase 4, but payment channels are never opened because the settlement negotiation logic exists in `NostrSpspServer` (for direct Nostr SPSP) but not in the BLS `/handle-payment` handler (for ILP-routed SPSP).

---

## Gap 1: BLS `/handle-payment` Missing Settlement Negotiation ❌ CRITICAL

**File:** `docker/src/entrypoint.ts` lines 331-390
**Epic:** 7 (Story 7.3)

### Current Implementation

The BLS `/handle-payment` endpoint handles kind:23194 SPSP requests but:
1. Parses the request (NIP-44 decrypt)
2. Generates `destinationAccount` + `sharedSecret`
3. Builds kind:23195 response with only those two fields
4. Returns `{accept: true, data: "<base64-toon-kind23195>"}`

### Missing Logic

Per Epic 7 Story 7.3, the handler should:
1. Extract `supportedChains`, `settlementAddresses`, `preferredTokens` from decrypted SPSP request
2. Call `negotiateSettlementChain()` to find matching chain
3. Extract peer's settlement address: `request.settlementAddresses[negotiatedChain]`
4. Call `POST /admin/peers` to register peer with settlement config (so connector has peer address)
5. Call `POST /admin/channels` via connector Admin API to open channel
6. Poll `GET /admin/channels/:channelId` until status is "open"
7. Include `channelId`, `negotiatedChain`, `settlementAddress`, `tokenAddress`, `tokenNetworkAddress` in kind:23195 response

### Why It Matters

Without this, Phase 3 of bootstrap completes but:
- No payment channels are opened
- SPSP response lacks `channelId`
- Peers cannot update their connector registration with settlement info
- Multi-hop payments will fail due to insufficient credit/liquidity

### Fix Location

Add settlement negotiation to `createBlsServer()` in `entrypoint.ts` lines 331-390, between parsing the request (line 348) and building the response (lines 354-363).

---

## Gap 2: `ConnectorChannelClient` Implementation Never Created ❌ CRITICAL

**File:** `docker/src/entrypoint.ts`
**Epic:** 7 (Story 7.3)

### Current State

- Interface exists: `packages/core/src/types.ts` lines 182-187
- `NostrSpspServer` constructor accepts `channelClient?: ConnectorChannelClient` (line 44)
- `NostrSpspServer.negotiateSettlement()` calls `channelClient.openChannel()` and `channelClient.getChannelState()` (lines 197, 219)

BUT:
- `entrypoint.ts` line 536 creates `NostrSpspServer` with NO `channelClient` argument
- No HTTP client implementation exists

### Missing Implementation

Need to create an HTTP client in `entrypoint.ts`:

```typescript
const channelClient: ConnectorChannelClient = {
  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    const response = await fetch(`${config.connectorAdminUrl}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerId: params.peerId,
        chain: params.chain,
        token: params.token,
        tokenNetwork: params.tokenNetwork,
        peerAddress: params.peerAddress,
        initialDeposit: params.initialDeposit || '0',
        settlementTimeout: params.settlementTimeout || 86400,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to open channel: ${response.status} ${text}`);
    }
    return await response.json();
  },

  async getChannelState(channelId: string): Promise<ChannelState> {
    const response = await fetch(`${config.connectorAdminUrl}/channels/${channelId}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get channel state: ${response.status} ${text}`);
    }
    const data = await response.json();
    return {
      channelId,
      status: data.status,
      chain: data.chain || 'unknown',
    };
  },
};
```

Then pass to both `NostrSpspServer` (line 536) AND wire into BLS `/handle-payment` handler.

### Why It Matters

`NostrSpspServer.negotiateSettlement()` will throw `TypeError: Cannot read property 'openChannel' of undefined` at runtime if it ever gets called (which it won't, because it's not wired into the ILP path anyway — see Gap 1).

---

## Gap 3: `NostrSpspServer` Not Configured for ILP Flow ❌ CRITICAL

**File:** `docker/src/entrypoint.ts` lines 536-543
**Epic:** 7, 8

### Current Code

```typescript
const spspServer = new NostrSpspServer(
  [`ws://localhost:${config.wsPort}`],
  config.secretKey
  // Missing: pool, settlementConfig, channelClient
);
```

### Missing Configuration

`NostrSpspServer` constructor accepts 5 arguments (NostrSpspServer.ts:39-50):
1. `relayUrls` ✅ provided
2. `secretKey` ✅ provided
3. `pool` ❌ missing (defaults to new SimplePool)
4. `settlementConfig` ❌ missing
5. `channelClient` ❌ missing

Without `settlementConfig` and `channelClient`, `negotiateSettlement()` short-circuits at line 160:
```typescript
if (!config || !channelClient || !supportedChains) {
  return; // Graceful degradation — no settlement
}
```

### Why This Matters

Even if `NostrSpspServer` was wired into the ILP code path, it wouldn't negotiate settlement because the entrypoint never passes the required config.

---

## Gap 4: Two SPSP Code Paths Never Converge ⚠️ ARCHITECTURAL

**Files:** `entrypoint.ts` lines 286-431 (BLS handler) vs `NostrSpspServer.ts` (dedicated SPSP server)
**Epic:** 7, 8

### The Problem

There are **two separate implementations** of SPSP handling:

**Path 1: Direct Nostr SPSP** (NostrSpspServer)
- Subscribes to kind:23194 on relay via Nostr WebSocket
- Has full settlement negotiation logic
- Calls connector Admin API for channel opening
- Publishes kind:23195 response to relay

**Path 2: ILP-Routed SPSP** (BLS `/handle-payment`)
- Receives kind:23194 via ILP PREPARE → connector → agent-runtime → BLS HTTP
- Has NO settlement negotiation logic
- Just generates destinationAccount + sharedSecret
- Returns kind:23195 in HTTP response data (passed through to ILP FULFILL)

### Why Two Paths Exist

- **NostrSpspServer** was built for Epic 2 (direct Nostr SPSP)
- **ILP-routed flow** was added in Epic 8 (ILP-first bootstrap)
- The settlement negotiation from Epic 7 was added to NostrSpspServer but never ported to the ILP path

### Impact

The ILP bootstrap flow (Phase 3) uses Path 2, which lacks settlement negotiation. Channels are never opened during bootstrap.

### Fix Required

Either:
- **Option A:** Extract settlement logic from `NostrSpspServer.negotiateSettlement()` into a shared function, call it from both paths
- **Option B:** Route ILP-received SPSP requests through `NostrSpspServer` instead of handling in `/handle-payment`
- **Option C:** Duplicate the settlement logic in the BLS `/handle-payment` handler (code duplication, not ideal)

---

## Gap 5: Circular Dependency in Peer Registration ⚠️ DESIGN ISSUE

**Files:** `BootstrapService.ts` lines 439-461, `admin-api.ts` lines 811-818
**Epic:** 7, 8

### The Circular Dependency

**Bootstrap Flow:**
1. Phase 1: Query relay for peer's kind:10032 → get ILP address and BTP endpoint
2. Phase 2: Register peer via `POST /admin/peers` (no settlement)
3. Phase 3: Send SPSP request to peer via ILP
4. Peer's BLS wants to open channel via `POST /admin/channels`
5. Connector's `POST /admin/channels` handler looks up `settlementPeers.get(peerId).xrpAddress` (or `evmAddress`)
6. **But settlementPeers doesn't have that info yet** — it gets populated AFTER SPSP completes (BootstrapService.ts:439-461)

### Current Workaround (Broken)

`NostrSpspServer.negotiateSettlement()` passes `peerAddress` in the `openChannel()` request, expecting the connector to accept it. But the connector endpoint doesn't have a `peerAddress` parameter — it only looks up from `settlementPeers`.

### Fix Required

The connector's `POST /admin/channels` endpoint must accept `peerAddress` (and `peerTokenAddress`, `peerTokenNetwork` if needed) in the request body instead of relying on `settlementPeers` map.

**Change to `admin-api.ts`** (lines 751-865):
- Add `peerAddress?: string` to `OpenChannelRequest` interface
- Use `body.peerAddress` directly instead of looking up from `settlementPeers`
- Keep `settlementPeers` lookup as fallback for backward compatibility

This is an **agent-runtime change**, not agent-society.

---

## Gap 6: `IlpSendResult` Field Name Mismatch ❌

**Files:**
- Agent-society expects: `packages/core/src/bootstrap/types.ts` lines 108-114
- Agent-runtime returns: `packages/agent-runtime/src/http/ilp-send-handler.ts` lines 199-221

### The Mismatch

**Agent-runtime sends:**
```typescript
{ fulfilled: true, ... }   // FULFILL
{ fulfilled: false, ... }  // REJECT
```

**Agent-society checks:**
```typescript
if (!ilpResult.accepted) {  // ← "accepted" not "fulfilled"
  throw new BootstrapError(...);
}
```

### Impact

BootstrapService Phase 2 (lines 410-414) will always throw because `ilpResult.accepted` is undefined. The check should be `!ilpResult.fulfilled`.

### Fix Required

Either:
- **Option A:** Change agent-runtime to return `accepted` instead of `fulfilled`
- **Option B:** Change agent-society to check `fulfilled` instead of `accepted`
- **Option C:** Add both fields for backward compatibility

This affects **both repos**.

---

## Gap 7: BLS Generates Fulfillment (Should Be Removed) ⚠️ MINOR

**File:** `docker/src/entrypoint.ts` lines 371, 415
**Epic:** 22

### Current Code

```typescript
fulfillment: generateFulfillment(event.id),
```

### Per Deployment Plan

"Fulfillment = SHA256(toon_bytes). Computed by agent-runtime (not BLS)." (UNIFIED-DEPLOYMENT-PLAN.md line 12)

"Remove fulfillment from responses" (Phase 2, line 110)

### Impact

The BLS's fulfillment is returned in the HTTP response but **agent-runtime ignores it** and computes its own (`packet-handler.ts:79`). This works but violates the architectural boundary — BLS shouldn't compute fulfillment at all.

### Fix Required

Remove `fulfillment` field from `HandlePaymentAcceptResponse` return in `entrypoint.ts` lines 369-376 and 413-420.

---

## Gap 8: Settlement Config Not Passed to NostrSpspServer ⚠️

**File:** `docker/src/entrypoint.ts` lines 536-542
**Epic:** 7

### Current Code

```typescript
const spspServer = new NostrSpspServer(
  [`ws://localhost:${config.wsPort}`],
  config.secretKey
);
```

### Missing

The constructor accepts `settlementConfig?: SettlementNegotiationConfig` (4th arg) but it's never provided. Need to build it from env vars:

```typescript
let settlementConfig: SettlementNegotiationConfig | undefined;
if (config.settlementInfo) {
  settlementConfig = {
    ownSupportedChains: config.settlementInfo.supportedChains || [],
    ownSettlementAddresses: config.settlementInfo.settlementAddresses || {},
    ownPreferredTokens: config.settlementInfo.preferredTokens,
    ownTokenNetworks: parseTokenNetworks(process.env), // Need to parse TOKEN_NETWORK_* env vars
    initialDeposit: process.env.INITIAL_DEPOSIT,
    settlementTimeout: parseInt(process.env.SETTLEMENT_TIMEOUT || '86400', 10),
    channelOpenTimeout: 30000,
    pollInterval: 1000,
  };
}

const spspServer = new NostrSpspServer(
  [`ws://localhost:${config.wsPort}`],
  config.secretKey,
  undefined, // pool
  settlementConfig,
  channelClient // from Gap 2
);
```

But this only fixes the **direct Nostr SPSP path**, not the ILP-routed path (Gap 1).

---

## Gap 9: No Integration Test for TOON + NIP-44 Round-Trip ⚠️

**Epic:** 7, 8

### Missing Test

No test verifies:
1. Build kind:23194 with NIP-44 encrypted settlement data
2. TOON-encode the event
3. Send as ILP PREPARE data
4. Receive at BLS, base64 decode → TOON decode
5. Verify NIP-44 decryption succeeds and settlement fields are intact
6. Build kind:23195 response with NIP-44 encryption
7. TOON-encode response
8. Return in ILP FULFILL data
9. Receive at client, decode, verify fields

### Impact

If TOON encoding doesn't preserve the NIP-44 encrypted content byte-for-byte, the entire handshake silently fails with decryption errors.

### Fix Required

Add integration test: `packages/core/src/spsp/__tests__/ilp-spsp-roundtrip.test.ts` that exercises the full encode/send/receive/decode cycle with encryption.

---

## Gap 10: RelayMonitor Inverts Phase 4 Flow ⚠️ ARCHITECTURAL

**File:** `packages/core/src/bootstrap/RelayMonitor.ts`
**Epic:** 8

### Expected Flow (per UNIFIED-DEPLOYMENT-PLAN.md Phase 4)

1. Non-bootstrap peer publishes kind:10032 as **paid ILP PREPARE** through bootstrap node
2. Bootstrap node receives it via ILP → stores in relay
3. Bootstrap node sends **paid SPSP response** back via ILP FULFILL
4. Peer receives FULFILL with settlement info

### Actual Flow

1. Non-bootstrap peer publishes kind:10032 as paid ILP PREPARE through bootstrap ✅ (Phase 3 of BootstrapService)
2. Bootstrap node receives it via ILP → stores in relay ✅
3. **RelayMonitor subscribes to relay, sees new kind:10032**
4. **RelayMonitor INITIATES paid SPSP FROM bootstrap TO peer** (RelayMonitor.ts lines 246-300)
5. Peer receives SPSP request and responds

### The Inversion

The bootstrap node initiates the reverse SPSP instead of responding to the peer's announcement. This works but doesn't match the plan's design where:
- Peer announces (kind:10032 as ILP PREPARE)
- Bootstrap responds with SPSP info (kind:23195 in FULFILL data)

The current flow requires an extra round-trip:
- Peer announces → Bootstrap reads relay → Bootstrap initiates SPSP → Peer responds

### Impact

- Extra ILP packets (more fees)
- Bootstrap node bears the cost of initiating reverse handshakes
- Design mismatch with plan

### Fix Required

Option A: Keep current flow, update plan documentation
Option B: Redesign so kind:10032 announcement includes SPSP request, bootstrap responds with SPSP in same FULFILL

---

## Gap 11: `POST /admin/peers` Called Twice for Same Peer ⚠️ INEFFICIENT

**Files:** `BootstrapService.ts` lines 345-347, 440-460

### Current Flow

1. Phase 1: `addPeerToConnector()` calls `POST /admin/peers` with routing only (line 677)
2. Phase 2: SPSP handshake completes
3. Phase 2: `addPeerToConnector()` called AGAIN with settlement config (line 440)

### Why This Happens

The first call registers the peer for routing. The second call updates with settlement info after SPSP negotiation.

### Impact

- `POST /admin/peers` returns 409 Conflict on second call (admin-api.ts line 334-340)
- Second call fails silently or overwrites
- Wastes HTTP round-trip

### Fix Required

Either:
- Make `POST /admin/peers` idempotent (update if exists, create if not)
- Add `PUT /admin/peers/:peerId` for updates
- Skip second call if settlement update fails (already gracefully degraded)

This is an **agent-runtime change**.

---

## Gap 12: Missing Token Network Parsing from Env Vars ⚠️

**File:** `docker/src/entrypoint.ts` lines 135-165
**Epic:** 7

### Current Parsing

The entrypoint parses:
- `SUPPORTED_CHAINS` → array
- `SETTLEMENT_ADDRESS_*` → settlementAddresses map
- `PREFERRED_TOKEN_*` → preferredTokens map

### Missing

No parsing for `TOKEN_NETWORK_*` environment variables. These are needed for EVM `TokenNetwork` contract addresses (used for multi-token payment channels).

### Expected Pattern

```typescript
const tokenNetworks: Record<string, string> = {};
for (const chain of supportedChains) {
  const envKey = chain.replace(/:/g, '_').toUpperCase();
  const tokenNet = env[`TOKEN_NETWORK_${envKey}`];
  if (tokenNet) tokenNetworks[chain] = tokenNet;
}

settlementInfo = {
  ...,
  tokenNetworks: Object.keys(tokenNetworks).length > 0 ? tokenNetworks : undefined,
};
```

### Impact

Without this, settlement negotiation can't include `tokenNetworkAddress` in responses, limiting the connector's ability to use TokenNetwork contracts for settlement.

---

## Gap 13: No Health Check for Bootstrap Phase ⚠️ MINOR

**File:** `docker/src/entrypoint.ts` lines 274-283
**Epic:** 8

### Current Health Endpoint

```typescript
app.get('/health', (c: Context) => {
  return c.json({
    status: 'healthy',
    nodeId: config.nodeId,
    pubkey: config.pubkey,
    ilpAddress: config.ilpAddress,
    timestamp: Date.now(),
    ...(getBootstrapPhase && { bootstrapPhase: getBootstrapPhase() }),
  });
});
```

### Issue

The `bootstrapPhase` field is conditionally included but the deploy script (agent-runtime repo) doesn't check it. Phase verification (deploy-5-peer-multihop.sh lines 700-743) only checks:
- BLS health returns 200
- Admin API peers list includes peer1
- Generic log parsing

### Missing Verification

Should check:
- `bootstrapPhase === 'ready'` before considering bootstrap complete
- `peerCount` and `channelCount` from health endpoint
- Explicit channel verification via `GET /admin/channels`

This is a **test/verification gap**, not a code gap.

---

## Priority Fix Order

### P0 - Critical (Bootstrap Broken)
1. **Gap 1:** Add settlement negotiation to BLS `/handle-payment` handler for kind:23194
2. **Gap 2:** Create `ConnectorChannelClient` HTTP implementation
3. **Gap 6:** Fix `accepted` vs `fulfilled` field mismatch (coordinate with agent-runtime)

### P1 - High (Functionality Incomplete)
4. **Gap 5:** Add `peerAddress` parameter to connector `POST /admin/channels` endpoint (agent-runtime change)
5. **Gap 3:** Pass `settlementConfig` and `channelClient` to `NostrSpspServer`
6. **Gap 12:** Parse `TOKEN_NETWORK_*` env vars

### P2 - Medium (Polish)
7. **Gap 7:** Remove BLS fulfillment generation (cleanup per Epic 22)
8. **Gap 11:** Make `POST /admin/peers` idempotent (agent-runtime change)

### P3 - Low (Documentation/Testing)
9. **Gap 9:** Add TOON + NIP-44 round-trip integration test
10. **Gap 4:** Decide on unified SPSP code path architecture
11. **Gap 10:** Document Phase 4 inversion or fix RelayMonitor flow
12. **Gap 13:** Enhance deploy script bootstrap verification

---

## Related Agent-Runtime Gaps

See `INTEGRATION-GAPS.md` in the agent-runtime repository for connector-side gaps:
- Missing `peerAddress` parameter in `POST /admin/channels`
- `fulfilled` vs `accepted` response field
- Idempotent peer registration
- Stale SPSP endpoint tests

---

## Testing Recommendations

### Unit Tests Needed
- [ ] Settlement negotiation in BLS handler (mock connector Admin API)
- [ ] TOON encoding preserves NIP-44 encrypted content
- [ ] Channel client error handling (404, 503, timeouts)

### Integration Tests Needed
- [ ] Full bootstrap with channel opening (requires local Anvil)
- [ ] SPSP handshake via ILP with channel verification
- [ ] 0-amount SPSP bypass for bootstrap node

### E2E Tests Needed
- [ ] 5-peer unified deployment with channel verification
- [ ] Cross-peer SPSP after bootstrap completes
- [ ] Payment routing through opened channels

---

## Notes

- Most gaps are in the **integration layer** between components, not in the core logic
- The pieces exist but aren't wired together
- Fixes are mostly straightforward HTTP client creation and config plumbing
- The architectural decision to separate direct Nostr SPSP from ILP-routed SPSP created code duplication
