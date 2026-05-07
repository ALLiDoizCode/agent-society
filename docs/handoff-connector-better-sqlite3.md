# Handoff: connector image is missing better-sqlite3 native bindings

**Audience:** connector team (the team publishing `ghcr.io/toon-protocol/connector`)
**Reporting context:** TOON Protocol (sibling repo, depends on the published image)
**Date:** 2026-05-06
**Image affected:** `ghcr.io/toon-protocol/connector:3.3.3`
**Severity:** breaks per-packet claim signing for any deployment that wires `chainProviders` and uses payment channels — i.e. all production-shaped deployments.

---

## TL;DR

The published connector image ships **without the compiled `better-sqlite3` `.node` binary**. Result:

- `PerPacketClaimService` and `ClaimReceiver` cannot initialize at startup
- The connector emits `per_packet_claims_init_failed` and `payment_channel_init_failed` events
- The connector continues to run as a **routing-only** node and rejects all forwarded paid PREPAREs with `T00 - Per-packet claim service not configured` (`packet-handler.ts:1236-1248`)

A correctly-configured `chainProviders` block is read and validated successfully (`token_symbol_resolved` fires, RPC is reachable, USDC `symbol()` returns) — but the per-packet claim machinery downstream of that, gated by SQLite-backed claim storage, can't load.

Likely cause: the npm install step in the connector image's Dockerfile didn't trigger a native rebuild for the runtime base, and `better-sqlite3` doesn't ship a prebuilt `.node` for `node-v127-linux-x64` in its npm tarball.

---

## Reproduction

Any deployment of `ghcr.io/toon-protocol/connector:3.3.3` with a valid `chainProviders` block in the YAML config will hit this. Minimal repro:

```yaml
# config.yaml
nodeId: g.test
btpServerPort: 3000
healthCheckPort: 8080
environment: development
deploymentMode: standalone
peers: []
routes: []
chainProviders:
  - chainType: evm
    chainId: evm:31337
    rpcUrl: http://anvil:8545
    registryAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
    tokenAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    keyId: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
```

```bash
docker run --rm -it \
  -v $(pwd)/config.yaml:/config/connector.yaml:ro \
  -e CONFIG_FILE=/config/connector.yaml \
  ghcr.io/toon-protocol/connector:3.3.3 \
  2>&1 | grep -E 'per_packet_claims|payment_channel_init|claim_receiver|token_symbol_resolved'
```

Expected:
- `token_symbol_resolved` fires (good — chainProviders is being read)
- `per_packet_claims_init_failed` fires with bindings error (the bug)
- `payment_channel_init_failed` fires with bindings error (the bug)
- `per_packet_claims_enabled` does **NOT** fire
- `claim_receiver_enabled` does **NOT** fire

---

## Direct evidence (from a live deployment)

```
$ docker exec townhouse-hs-connector node --version
v22.22.2

$ docker exec townhouse-hs-connector cat /app/node_modules/better-sqlite3/package.json | grep version
  "version": "11.10.0",

$ docker exec townhouse-hs-connector ls /app/node_modules/better-sqlite3/build/
ls: /app/node_modules/better-sqlite3/build/: No such file or directory

$ docker exec townhouse-hs-connector find /app/node_modules/better-sqlite3 -name '*.node'
(empty)
```

The package is installed, but the `build/` directory (where `node-gyp` would put compiled binaries) doesn't exist, and no prebuilt binary was downloaded either.

The connector's own log:

```json
{"level":50,"event":"per_packet_claims_init_failed","error":"Could not locate the bindings file. Tried:\n → /app/node_modules/better-sqlite3/build/better_sqlite3.node\n → /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node\n ...\n → /app/node_modules/better-sqlite3/lib/binding/node-v127-linux-x64/better_sqlite3.node","msg":"Failed to initialize per-packet claim service"}
```

(All 13 candidate paths in the standard `bindings` package search were checked; none exist.)

---

## What's broken downstream

The init failure happens at `connector-node.ts:1020-1041` (PerPacketClaimService) and `:1081-1095` (ClaimReceiver). Both wrap their construction in try/catch and `throw error` on failure, which the surrounding `if (chainRegistry && evmProvider...) { ... }` block lets propagate up — but the connector is configured to **degrade gracefully**: it logs the event and continues startup as a routing-only node.

Then at request time, every forwarded paid packet hits this gate at `packet-handler.ts:1236-1248`:

```ts
if (!isLocalDelivery && forwardingPacket.amount > 0n) {
  if (!this.perPacketClaimService) {
    return this.generateReject(
      ILPErrorCode.T00_INTERNAL_ERROR,
      'Per-packet claim service not configured',
      this.nodeId
    );
  }
  // ...
}
```

Net effect: the connector silently demotes itself from "trust-minimised payment-channel ILP" to "routing-only ILP that can only carry zero-amount packets." Operators who don't grep for `per_packet_claims_init_failed` at startup may not notice until first paid packet.

---

## Suggested fix

Three options, ranked:

### Option 1 (recommended): rebuild bindings in the image

Add an explicit native rebuild step to the connector's Dockerfile after `npm/pnpm install`:

```dockerfile
# Build stage — ensure native modules compile against the runtime ABI
RUN apk add --no-cache python3 py3-setuptools make g++   # if alpine
# OR
RUN apt-get update && apt-get install -y python3 build-essential   # if debian/ubuntu

# After npm install:
RUN npm rebuild better-sqlite3 --build-from-source
# OR (preferred — uses prebuilt binaries when available, falls back to source):
RUN cd node_modules/better-sqlite3 && node-pre-gyp install --fallback-to-build
```

Then in the runtime stage, copy `node_modules/better-sqlite3/build/Release/better_sqlite3.node` into the runtime image alongside the rest of the bundle.

### Option 2: ship `prebuild-install` as a runtime dep + `postinstall` hook

Add `prebuild-install` to the connector's production `dependencies`. better-sqlite3's npm package includes a `postinstall` script that calls `prebuild-install` to fetch a precompiled `.node` matching the running Node version. If that script is being run during your image build but failing silently (e.g. no network at install time, or `--ignore-scripts`), surface the failure.

### Option 3: lazy-load + degrade more loudly

Patch the connector to surface this earlier — fail-closed at startup if `chainProviders` is configured but native modules can't load, rather than silently demoting to routing-only. Doesn't fix the bug; reduces the time-to-detect.

Pick (1) for fastest unblock. (2) is more elegant but depends on `better-sqlite3` upstream prebuild availability for the Node version you're shipping (currently node-v127, i.e. Node 22.x).

---

## Verification (after fix)

A successful image rebuild should produce these connector startup events when given a valid `chainProviders` config:

```bash
docker logs <connector> 2>&1 | grep -E 'per_packet_claims_enabled|claim_receiver_enabled|token_symbol_resolved'
```

Expected output (all three, in order):

```
{... "event":"token_symbol_resolved" ...}
{... "event":"per_packet_claims_enabled" ...}
{... "event":"claim_receiver_enabled" ...}
```

And `payment_channel_init_failed` should **NOT** appear.

A functional smoke test: send a forwarded ILP PREPARE with `amount: 1` from a peer that has no payment channel open. The reject reason should change from:

- Current: `T00 - Per-packet claim service not configured`
- After fix: `T00 - No payment channel available for peer` (per `per-packet-claim-service.ts:144` returning null when no channel exists)

That message change is the canonical confirmation the claim service is loaded and is the gating logic now, not the missing-init path.

---

## Context for the connector team (optional reading)

TOON Protocol is an ILP-gated Nostr relay system. Each "town" node hosts a Nostr relay that charges per-event publishing fees via ILP. The deployment topology is hierarchical: an apex connector (your image) is the public BTP entry point, and town/mill/dvm child nodes embed their own `ConnectorNode` instances that BTP-dial the apex as parent peers. A successful kind:1 publish requires:

1. Client → apex BTP (over Anyone hidden service in our case): client signs balance proof
2. Apex receives PREPARE, routes to town
3. **Apex signs a fresh balance proof for the apex→town hop** ← this is where we hit the bug
4. Town verifies, accepts, persists the event

Step 3 is what `PerPacketClaimService` does. Without it, paid kind:1 events can't flow.

We've verified the rest of the architecture works end-to-end — see `packages/client/scripts/social-flow-hs-e2e.ts` in the TOON repo for an Anyone-routed e2e harness that publishes a kind:1 over the apex's `.anyone` hidden service. With `amount=0` the test passes today; with `amount > 0` it hits the T00 from this bug.

---

## Files referenced (connector repo)

- `packages/connector/src/core/connector-node.ts` lines 559-620 (chainProviders read), 875-1037 (PerPacketClaimService init), 1067-1100 (ClaimReceiver init)
- `packages/connector/src/core/packet-handler.ts` lines 1236-1248 (T00 gate)
- `packages/connector/src/settlement/per-packet-claim-service.ts` line 144 (null-channel branch)
- `packages/connector/src/settlement/claim-receiver.ts` (BTP-server-registered claim verifier)

## Files referenced (TOON repo, for context)

- `docs/handoff-connector-better-sqlite3.md` — this doc
- `docker/configs/townhouse-hs-connector.yaml` — example chainProviders block
- `packages/client/scripts/social-flow-hs-e2e.ts` — the e2e harness exhibiting the bug

## Contact

Questions: open an issue against `toon-protocol/town`. The repro deployment is in `docker-compose-townhouse-hs.yml` of that repo; the apex container name there is `townhouse-hs-connector`.
