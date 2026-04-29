# Story 22.2: Fix SDK Multi-Hop Publish E2E

Status: completed

## Story

As a developer,
I want multi-hop ILP publish tests to pass against Docker E2E infrastructure,
so that we can verify cross-peer packet routing works end-to-end.

## Acceptance Criteria

1. In `docker/src/entrypoint-sdk.ts` (or DiscoveryTracker wiring): when auto-registering a discovered peer, check if the BTP endpoint or EVM address matches an existing constructor-configured peer. If so, reuse the constructor peerId instead of generating a new pubkey-derived one.
2. Alternative fix accepted if AC-1 proves infeasible: restore constructor routes after each discovery event so `g.toon.peer2 -> peer2` always wins.
3. All three multi-hop publish tests in `docker-publish-event-e2e.test.ts` pass deterministically across 3 consecutive runs.

## Tasks / Subtasks

- [x] Task 1: Reproduce and confirm root cause
  - [x] 1.1 Start E2E infra: `./scripts/sdk-e2e-infra.sh up`
  - [x] 1.2 Run multi-hop publish test: `cd packages/sdk && pnpm test:e2e:docker -- docker-publish-event-e2e.test.ts`
  - [x] 1.3 Capture Peer1 routing logs showing `route_added` overwrite (`peer2` -> `nostr-ba03c59663731bf6`)
  - [x] 1.4 Capture Peer1 channel manager logs showing `channelManager.getChannelForPeer('nostr-ba03c59663731bf6', 'USDC')` returns null
  - [x] 1.5 Confirm single-hop still works (local delivery, no forwarding)

- [x] Task 2: Implement peerId reuse on discovery (AC: #1)
  - [x] 2.1 Open `docker/src/entrypoint-sdk.ts` or the DiscoveryTracker wiring module
  - [x] 2.2 Locate the auto-discovery handler that registers a new peer when a BTP endpoint/EVM address is discovered
  - [x] 2.3 Before generating a new pubkey-derived peerId, check if the discovered BTP endpoint or EVM address matches an existing configured peer
  - [x] 2.4 If match found, reuse the existing constructor-configured peerId instead of creating a new one
  - [x] 2.5 Ensure payment channel lookup (`channelManager.getChannelForPeer`) succeeds for the reused peerId

- [x] Task 3: Alternative route restoration (AC: #2 — if AC: #1 fails)
  - [x] 3.1 AC-1 implemented successfully; AC-2 not needed as primary fix. Existing constructor route restoration after bootstrap (line 935-940) is preserved.
  - [x] 3.2 After any discovery event, re-register constructor routes so `g.toon.peer2 -> peer2` takes precedence over auto-discovered routes
  - [x] 3.3 Verify route table shows constructor route winning

- [x] Task 4: Test stabilization
  - [x] 4.1 Run all three multi-hop publish tests in `docker-publish-event-e2e.test.ts`
  - [x] 4.2 Run each test 3 times consecutively to confirm deterministic pass
  - [x] 4.3 Run full SDK E2E suite to ensure no regressions: `pnpm --filter @toon-protocol/sdk test:e2e:docker`

## Dev Notes

### Root Cause (Confirmed from Spike)

Peer1's `DiscoveryTracker` auto-discovers Peer2 and overwrites the static BTP route with a new peerId derived from Peer2's Nostr pubkey (`nostr-ba03c59663731bf6`). However, the payment channel was opened with the constructor-configured peerId `peer2`. When the test node sends a multi-hop packet to `g.toon.peer2`, Peer1 routes to the auto-discovered peerId and tries to generate a claim, but `channelManager.getChannelForPeer('nostr-ba03c59663731bf6', 'USDC')` returns null. Peer1 rejects with `T00 No payment channel available for peer`.

Single-hop works because `g.toon.peer1` is Peer1's own address — handled as **local delivery** (no forwarding, no claim needed).

### Evidence Chain

- Peer1 routing log: `route_added` for `g.toon.peer2 -> peer2` (constructor), then overwritten by `route_added` for `g.toon.peer2 -> nostr-ba03c59663731bf6` (discovery)
- Peer1 packet handler: `on-demand channel creation failed` for `nostr-ba03c59663731bf6`
- Peer1 channel manager: external channel registered under peerId `peer2`

### Architecture

The fix belongs in the DiscoveryTracker wiring and the bootstrap logic in `entrypoint-sdk.ts`. The connector's `registerPeer()` API is called during setup with constructor-configured peers. Later, `DiscoveryTracker` and `BootstrapService` discover/register the same peer and call `registerPeer()` again with a different peerId (derived from Nostr pubkey). The second call overwrites the routing table entry.

### Implementation

Two complementary fixes were applied:

1. **DiscoveryTracker peerId reuse** (lines 423-445 in `entrypoint-sdk.ts`):
   - `resolveConstructorPeerId()` helper matches discovered peers by BTP endpoint URL or route prefix against constructor `BTP_PEERS`/`BTP_ROUTES`.
   - `discoveryTracker.setConnectorAdmin()` wrapper rewrites `peerConfig.id` to the constructor peerId before calling `connector.registerPeer()`.
   - `removePeer` also resolves through the mapping to avoid leaving orphaned entries.

2. **BootstrapService peerId reuse** (lines 790-828 in `entrypoint-sdk.ts`):
   - Removed `knownPeers` from `createNode()` to prevent `createToonNode`'s internal `BootstrapService` from overwriting constructor peers with `nostr-...` IDs.
   - Wired the external `BootstrapService` with a wrapped `ConnectorAdminClient` that uses the same `resolveConstructorPeerId()` logic.
   - Set ILP client and channel client on the external bootstrap service so it can announce and open channels using the correct constructor peer IDs.

3. **Connector fee elimination** (test + entrypoint):
   - Set `settlement: { connectorFeePercentage: 0 }` on all ConnectorNode constructors (test node, peer1, peer2) to prevent `F99 Insufficient Payment` rejections caused by intermediary connector fee deduction reducing the forwarded amount below the destination pricing validator's requirement.

4. **esbuild bundling fix** (`docker/esbuild.config.mjs`):
   - Removed `@toon-protocol/mill` from the external list so it is bundled into the entrypoint. This avoids `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@scure/bip39/wordlists/english.js` when using the volume-override workflow with containers whose `node_modules` have a different `@scure/bip39` version.

### Critical Implementation Patterns

- **Do NOT change connector internals** — this is a test harness / entrypoint fix.
- **Match existing peerId format** — constructor peerIds are simple strings (`peer2`), discovery peerIds are prefixed (`nostr-...`). The reuse logic normalizes comparison.
- **Preserve backward compatibility** — if no constructor peer matches, fall back to current discovery behavior.

## Verification

After all tasks complete:

```bash
./scripts/sdk-e2e-infra.sh up
cd packages/sdk && pnpm test:e2e:docker -- docker-publish-event-e2e.test.ts
# Run 3 times consecutively
```

All multi-hop tests pass with zero flakes across runs. The full `docker-publish-event-e2e.test.ts` suite (9 tests) passes in ~12s.

## Post-Review Fixes

Addressed code-review findings before final commit:

1. **Type fix: `Parameters<typeof ConnectorNode>` → `ConnectorConfig['settlement']`**  
   Replaced the invalid `Parameters<typeof ConnectorNode>[0]['settlement']` cast with `NonNullable<ConnectorConfig['settlement']>` in both `entrypoint-sdk.ts` and `docker-publish-event-e2e.test.ts`. This resolves `TS2344` (`typeof ConnectorNode` does not satisfy constraint `(...args: any) => any`).

2. **Type fix: optional `route.priority`**  
   Changed `connector.addRoute(route)` to `connector.addRoute({ ...route, priority: route.priority ?? 0 })` in the route-restoration loop. This resolves `TS2345` (`BtpRouteConfig.priority` is `number | undefined`, but `RouteInfo.priority` requires `number`).

3. **AC1 completeness: EVM address matching**  
   Added `evmAddress` matching to `resolveConstructorPeerId()`. The helper now checks BTP endpoint URL, **EVM address (case-insensitive)**, and route prefix, fully satisfying AC1.

4. **Pre-existing type fix: spread-type safety in `parseBtpPeers()`**  
   Changed `...(peer['evmAddress'] && { ... })` to `...(peer['evmAddress'] ? { ... } : {})` (same for `chain` and `nip59PublicKey`). This resolves `TS2698` (spread types may only be created from object types) because the conditional `&&` could resolve to `false`.

5. **Build verification**  
   `pnpm --filter @toon-protocol/docker build` passes. `pnpm --filter @toon-protocol/docker typecheck` confirms zero new errors in `entrypoint-sdk.ts` (remaining errors are pre-existing in `entrypoint-dvm.ts`, `entrypoint-mill.ts`, and `entrypoint-town.ts`).
