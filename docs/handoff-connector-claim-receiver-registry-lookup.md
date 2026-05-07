# Handoff: connector ClaimReceiver lookup-key inconsistency blocks externally-opened channels

**Audience:** connector team (the team publishing `ghcr.io/toon-protocol/connector`)
**Reporting context:** TOON Protocol (`toon-protocol/town`)
**Date:** 2026-05-07
**Image affected:** `ghcr.io/toon-protocol/connector:3.4.0` (and likely earlier)
**Severity:** blocks on-chain settlement for any channel opened directly via `TokenNetwork.openChannel()` (i.e. NOT through the connector's `POST /admin/channels`).

---

## TL;DR

`ClaimReceiver.resolveProvider()` looks up the EVM payment-channel provider in `ChainProviderRegistry` using **two different keys depending on whether the channel is known**:

- Channel known (registered via apex's own `openChannel` call): uses `channelManager.getChannelById(channelId).chain` — which the admin-API regex enforces as `evm:<network>:<chainId>` (e.g. `evm:base:31337`).
- Channel unknown (opened externally on-chain by some other party): falls back to `${claim.blockchain}:${claim.chainId}` (e.g. `evm:31337`).

But `chainProviders` config registers **exactly one provider per chainType** (`find()` not `forEach` at `connector-node.ts:879`). Whichever single key we configure, one of the two lookup paths fails.

Net effect: a peer that opens a channel directly via `TokenNetwork.openChannel()` and then sends a claim cannot have its claim verified by the apex — `ClaimReceiver` rejects with `No provider registered for blockchain: evm`, `CLAIM_RECEIVED` never fires, `SettlementMonitor` never trips threshold, no on-chain `claimFromChannel` settlement.

The PREPARE-attached claim path (`InboundClaimValidator`) is unaffected because it uses a separate validation flow — but the per-packet path is purely a security gatekeeper, not a settlement trigger.

---

## Reproduction

The TOON repo's `social-flow-hs-e2e.ts` is the live repro:

1. Test client opens a channel directly via `TokenNetwork.openChannel(apex_addr, settlementTimeout)` (test client = participant1 = depositor).
2. Test client sends ILP PREPARE + signed payment-channel-claim BTP MESSAGE to the apex.
3. Apex logs:
   - `Received claim message blockchain=evm`
   - `No provider registered for blockchain: evm` (warn)
4. `CLAIM_RECEIVED` never emitted, `Settlement threshold exceeded` never logs, no `ChannelClaimed` event on-chain.

Direct repro at the source level:

```ts
// claim-receiver.ts:298-345 — resolveProvider:
if (this.channelManager) {
  const knownChannel = this.channelManager.getChannelById(claim.channelId);
  if (knownChannel && knownChannel.chain) {
    return this.chainProviderRegistry.getProvider(claim.blockchain, knownChannel.chain);
    // ↑ key = knownChannel.chain (e.g. "evm:base:31337")
  }
}

if (claim.chainId !== undefined) {
  const chainKey = `${claim.blockchain}:${claim.chainId}`;
  return this.chainProviderRegistry.getProvider(claim.blockchain, chainKey);
  // ↑ key = `evm:${claim.chainId}` (e.g. "evm:31337")
}
```

```ts
// connector-node.ts:879-892 — only ONE provider registered:
const evmProviderConfig = this._config.chainProviders?.find(
  (cp) => cp.chainType === 'evm'
);
// ... constructs evmProvider with chainId from this entry ...
chainRegistry.register(evmProvider);
// ↑ provider.chainId is whatever was in the config — used as the registry key
```

```ts
// chain-provider-registry.ts:101-107 — strict key match:
getProvider(chainType: BlockchainType, chainId: string): PaymentChannelProvider | undefined {
  const provider = this.providers.get(chainId);
  // ↑ exact-match Map.get; no fuzzy lookup, no fallback to chainType-only
  if (provider && provider.chainType !== chainType) {
    return undefined;
  }
  return provider;
}
```

Whichever single chainId we configure in YAML, the other lookup path returns `undefined`. The receiver only has the fallback-to-chainKey path (no fallback to `getAllProviders().find(p => p.chainType === claim.blockchain)` for the EVM case — only the Solana/Mina branches eventually fall through to that).

---

## Suggested fixes (ranked)

### Option 1 (recommended): auto-register externally-opened channels via on-chain lookup

When `ClaimReceiver` encounters an unknown channel, before falling back to chainKey lookup, query the on-chain TokenNetwork via `provider.getChannelState(claim.channelId)`. If found, register the channel in `channelManager` with its actual `chain` value (extracted from claim's self-describing fields), then re-resolve via the now-known path.

This also matches the planner's expected behavior in our test setup — the test client's claim carries `chainId`, `tokenNetworkAddress`, and `tokenAddress` in `EVMClaimMessage`, all needed for the on-chain lookup.

### Option 2: register multiple chainIds for the same provider

Either:
- Allow `chainProviders` entries to list multiple `chainId` aliases:
  ```yaml
  chainProviders:
    - chainType: evm
      chainIds: ['evm:31337', 'evm:base:31337']  # array
      ...
  ```
- Or have `ConnectorNode` register the provider under both `evm:${chainId}` and `evm:base:${chainId}` for compatibility.

This is the simplest fix but requires schema changes.

### Option 3: normalize the lookup-key format inside `ClaimReceiver`

Pick one canonical form (e.g. always `evm:${chainId}`) and have ALL paths (known channel + unknown channel) use the same form. The `channel.chain` value would then need to be normalized at registration time.

This requires touching the admin API regex too (currently enforces `evm:<network>:<chainId>`), so it's the most invasive but most consistent.

### Option 4: add an admin endpoint to register externally-opened channels

`POST /admin/channels/register` that takes `{channelId, chain, peerAddress}` and adds the channel to `channelManager` without trying to call `openChannel` on-chain. Operators can run this for any externally-opened channel (e.g. via a setup script) and the receiver path will then work.

This is a smaller fix than Option 1 — no on-chain RPC call from the receiver path — but requires operator-side knowledge.

---

## Verification (after fix)

After picking any of the options, the TOON e2e should produce:

```
docker logs apex-connector | grep -E "CLAIM_RECEIVED|Settlement threshold|claimFromChannel|ChannelClaimed"
# Expected (currently empty):
#   CLAIM_RECEIVED event emitted
#   Settlement threshold exceeded for peerId=client
#   Submitting claimFromChannel transaction
#   ChannelClaimed event observed on-chain
```

And:

```
cast call <USDC> 'balanceOf(address)(uint256)' <apex_address>
# Expected: balance increased by claim's transferredAmount
```

---

## Context for the connector team

TOON Protocol uses your connector image as the apex of a Nostr-relay-with-ILP-payment topology. We've now wired:
- per-packet claim signing via PerPacketClaimService (configured via apex YAML chainProviders)
- per-packet claim verification via InboundClaimValidator (working)
- end-to-end kind:1 publish over Anyone hidden service with attached claim (verified working)
- client-side BTP MESSAGE protocol path for sending separate `payment-channel-claim` messages
- on-chain client→apex channel open via TokenNetwork directly

The only piece preventing actual on-chain settlement is the registry-key inconsistency above. Once it's fixed, our `social-flow-hs-e2e.ts` test should produce a real `ChannelClaimed` event and apex's USDC balance should increase by the claim's `transferredAmount`.

---

## Files referenced (connector repo)

- `packages/connector/src/settlement/claim-receiver.ts` lines 298-345 — `resolveProvider`
- `packages/connector/src/core/connector-node.ts` lines 879-892 — single-provider registration
- `packages/connector/src/settlement/provider/chain-provider-registry.ts` lines 101-107 — exact-key lookup

## Files referenced (TOON repo)

- `docs/handoff-connector-claim-receiver-registry-lookup.md` — this doc
- `packages/client/scripts/social-flow-hs-e2e.ts` — repro script
- `docker/configs/townhouse-hs-connector.yaml` — apex chainProviders config
- `packages/client/src/btp/IsomorphicBtpClient.ts` — BTP MESSAGE wire path
- `packages/client/src/adapters/BtpRuntimeClient.ts` — sendClaimMessage wrapper

## Contact

Open an issue against `toon-protocol/town`. Repro deployment in `docker-compose-townhouse-hs.yml`; apex container `townhouse-hs-connector`.
