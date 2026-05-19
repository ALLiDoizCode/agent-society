# Akash Devnet

Public, browser-reachable EVM + Solana dev chains hosted on the
[Akash Network](https://console.akash.network), used by the operator
dashboard, demos, and anyone who wants to test against a TOON
deployment without standing up local infrastructure.

| Service | What it is |
| --- | --- |
| **Anvil** | Foundry EVM chain (chain-id `31337`) with Mock USDC pre-deployed and 7 test accounts pre-funded. |
| **Solana** | `solana-test-validator` with the `payment_channel` BPF program loaded at genesis and an SPL Mock USDC mint bootstrapped on every fresh ledger. |
| **Faucet** | Dual-chain dev faucet (Express, port 3500) with unified HTTPS UI. Drips ETH+USDC on the Anvil lease and SOL+USDC on the Solana lease. Story 49.2 architecture A2 — one lease, one ingress, one image. |
| **Otterscan** | Single-page React EVM explorer pointing at our Anvil. (Recommended over Blockscout — see [Service catalog](#service-catalog).) |
| **Solana Explorer** | Optional Solana block explorer pointing at our validator. Off by default. |
| **Blockscout** | Legacy EVM explorer. Off by default; Otterscan is the recommended replacement. |

Each runs as a separate Akash deployment with its own bid, lease, and
HTTPS-with-Let's-Encrypt ingress hostname. The current set is recorded
in [`leases.json`](#statefile-leasesjson).

---

## Prerequisites

- Docker (with `buildx`) — for building images
- `jq`, `curl`, `bash` — used by the scripts
- An Akash Console account with an API key
  (https://console.akash.network → profile → API Keys, format
  `ac.sk.production.*`). Export it before any of the deploy commands:
  ```bash
  export AKASH_CONSOLE_API_KEY=ac.sk.production.…
  ```
- For pushing images: `docker login ghcr.io` against an account with
  push rights to `ghcr.io/toon-protocol/`.

The deploy script talks to the Akash Console's REST API (`x-api-key`
header) rather than the `provider-services` CLI, so you don't need a
local Akash CLI install or wallet keyring.

---

## Quick reference

```bash
# Health-check every lease (reads leases.json)
./scripts/akash-status.sh

# Redeploy whatever is currently deployed, in dependency order.
# Closes existing leases first; refunds the deposits as it goes.
./scripts/akash-deploy.sh redeploy-all

# Same, but rebuild + push all Docker images first
# (use after touching infra/solana/, docker/Dockerfile.akash-*, etc.)
./scripts/akash-deploy.sh redeploy-all --rebuild

# Redeploy a single service AND denylist its prior provider
# (use when one provider goes flaky — picks a different bidder next time).
./scripts/akash-deploy.sh redeploy anvil
./scripts/akash-deploy.sh redeploy solana
./scripts/akash-deploy.sh redeploy otterscan

# First-time deploy of the whole stack from an empty leases.json
./scripts/akash-deploy.sh all

# Drip tokens from the dev faucet
./scripts/faucet-evm.sh 0xRecipient…           # 1 ETH + 100 USDC
./scripts/faucet-sol.sh   <base58-pubkey>      # 1 SOL + 100 USDC

# Or via the Townhouse dashboard's FaucetPanel (POST /api/faucet)
```

`./scripts/akash-deploy.sh` with no args prints the full subcommand list.

---

## Service catalog

Files referenced below all live in this directory unless otherwise noted.

### Anvil — `anvil.sdl.yaml`

- Chain-id `31337`, block time 2 s, 10 prefunded accounts.
- Image: `ghcr.io/toon-protocol/akash-anvil:demo`
  (`docker/Dockerfile.akash-anvil`).
- Entrypoint runs `forge script DeployLocal.s.sol` on first boot,
  deploying Mock USDC and seeding test accounts.
- Storage is **ephemeral** — every container restart is a fresh chain.
  See [Why no persistent storage](#why-no-persistent-storage).

| Constant | Value |
| --- | --- |
| Mock USDC address | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| Decimals | 18 (test fixture, not real USDC's 6) |
| Deployer / faucet source | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Anvil account 0) |
| Pre-funded accounts | Anvil account 1–7, 10 000 USDC each |

### Solana — `solana.sdl.yaml`

- `solana-test-validator` 3.x, 400 ms slots.
- Image: `ghcr.io/toon-protocol/akash-solana:demo`
  (`docker/Dockerfile.akash-solana`).
- Entrypoint loads `contracts/solana/payment_channel.so` at genesis,
  waits for `getSlot` to actually advance (not just `getHealth: ok` —
  see [Wedged validator](#a-lease-looks-healthy-but-getslot-is-frozen)),
  then runs `infra/solana/bootstrap-usdc.mjs` to mint Mock USDC.
- Storage is **ephemeral** (entrypoint always uses `--reset`). Lease
  close = data loss; bootstrap re-runs idempotently on a fresh ledger.

| Constant | Value |
| --- | --- |
| Mock USDC mint | `6GbdrVghwNKTz9raga7y3Y4qqX5Zgg3AC4d48Kt7C59Q` |
| Decimals | 6 (matches real USDC) |
| Initial supply | 1 000 000 000 USDC (in treasury) |
| Faucet authority pubkey | `ATEh3koyCrwmCMr3cNBVEmARhSFmP9tHokjDxhtaE8m3` |
| Faucet authority keypair (full 64-byte) | `infra/solana/keys/faucet-authority.json` (committed — public dev key, like Anvil's account 0) |
| Mint keypair | `infra/solana/keys/usdc-mint.json` (committed) |
| Treasury ATA | derived: `deriveATA(authority, mint)` |

The SPL primitives (`createMint`, `mintTo`, `transferChecked`, ATA
derivation, ed25519 sign + send + confirm) live in pure ESM at
`infra/solana/spl-primitives.mjs`. They are used by the bootstrap, the
shell faucet helper (`scripts/faucet-sol-usdc.mjs`), and the route
handler (`packages/townhouse/src/api/routes/faucet.ts`).

### Otterscan — `otterscan.sdl.yaml`

- Static React explorer; image `otterscan/otterscan:latest` (Docker Hub).
- Reads its upstream RPC URL from a runtime env var that the deploy
  script templates from `leases.json` — meaning **Otterscan's lease must
  be redeployed any time Anvil's lease changes** (otherwise the
  explorer points at a dead RPC). `redeploy-all` handles this
  automatically.

### Solana Explorer — `solana-explorer.sdl.yaml`

Optional Solana counterpart to Otterscan. Not deployed by default. To
add it to a running stack:

```bash
./scripts/akash-deploy.sh solana-explorer
```

It then participates in subsequent `redeploy-all` runs because the
script redeploys *whatever's currently in `leases.json`*.

### Blockscout — `blockscout.sdl.yaml`

Legacy EVM explorer kept for historical reasons. Otterscan is the
recommended replacement; new deployments should use that instead.

---

## State files

### `leases.json`

The single source of truth for "what's deployed right now." Written by
`akash-deploy.sh` after each successful `cmd_<service>` and read by
everything else (`faucet-*.sh`, `akash-status.sh`, the `/api/faucet`
route, etc.).

```json
{
  "anvil":   { "dseq": "…", "provider": "akash1…", "url": "https://…", "deployed_at": "…" },
  "solana":  { "dseq": "…", "provider": "akash1…", "url": "https://…", "deployed_at": "…" },
  "otterscan": { … }
}
```

Committed to the repo so the dev faucet, dashboards, and demos all
agree on which lease is current. Every successful redeploy mutates
this file — that's normal, commit the change as part of the redeploy.

### `denylist.json`

A list of provider addresses that bid auctions should skip. Populated
two ways:

- Manually, when you know a provider is bad.
- Automatically by `redeploy <name>` (per-service redeploy), which adds
  the *prior* provider before re-running. Use this when a single
  service's lease is wedged on a flaky provider.

`redeploy-all` does **not** touch the denylist. Its job is "rebuild what
I have," not "escape a bad provider."

> **Gotcha.** If your SDL's resource shape narrows the bid pool to a
> single provider (e.g. `class:beta2` persistent storage), denylisting
> that provider on `redeploy <name>` will leave zero eligible bids. The
> script catches this — it now closes the orphan deployment to refund
> the deposit before exiting — but you'll need to either widen the SDL
> (drop persistence, lower the storage class) or remove the entry from
> `denylist.json` to recover.

---

## Workflows

### First-time deploy

```bash
export AKASH_CONSOLE_API_KEY=ac.sk.production.…
./scripts/akash-deploy.sh all
```

Builds + pushes all images, then deploys anvil → solana → otterscan →
solana-explorer in dependency order. Writes `leases.json`. Takes
~10–15 min total.

### Routine redeploy of the current set

```bash
./scripts/akash-deploy.sh redeploy-all
```

Closes every entry in `leases.json` (in reverse-dependency order to
avoid leaving an explorer pointing at a closed RPC), then redeploys
exactly that set in dependency order. Won't add solana-explorer or
blockscout if you've never deployed them. Takes ~5–10 min.

Pass `--rebuild` to also rebuild + push all images first:

```bash
./scripts/akash-deploy.sh redeploy-all --rebuild
```

### Redeploy + denylist one service

When `akash-status.sh` shows one service down or wedged:

```bash
./scripts/akash-deploy.sh redeploy solana
```

Adds the prior provider to `denylist.json`, closes the lease, and
deploys fresh — landing on a different bidder. After this, if anything
templated the old URL (Otterscan templates Anvil's URL; nothing
currently templates Solana's URL), redeploy that downstream too.

### Close everything

There's no `close-all` subcommand on purpose — it would be too easy to
trigger by accident. To wipe:

```bash
for s in solana-explorer otterscan blockscout anvil solana; do
  ./scripts/akash-deploy.sh close "$s" 2>/dev/null || true
done
```

Reverse-dependency order so explorers don't briefly run against a dead
RPC.

### Update an image without redeploying

```bash
./scripts/akash-deploy.sh build
```

Rebuilds + pushes all three images. The running leases keep using the
provider's cached image until they're closed/restarted, so this won't
take effect until the next `redeploy <name>` or `redeploy-all`.

---

## Faucet

The faucet drips both native gas + Mock USDC for whichever chain you
target. There are FOUR entry points, all backed by similar logic:

| Entry point | Format |
| --- | --- |
| `scripts/faucet-evm.sh <0xaddress> [usdc=10000] [eth=10]` | Shell — Anvil dev RPCs only |
| `scripts/faucet-sol.sh <pubkey> [sol=10] [usdc=100]` | Shell — calls `faucet-sol-usdc.mjs` for the SPL transfer |
| `POST /api/faucet` (Townhouse API) | JSON `{chain, recipient, amount?}` — used by the dashboard's `FaucetPanel` |
| `POST /faucet/{evm,sol}` (Akash devnet faucet, story 49.2) | JSON `{address, amount?}` — published image, see below |

### Akash-deployed Dev Faucet (story 49.2)

Architecture **A2** (dedicated faucet lease):

- Image: `ghcr.io/toon-protocol/akash-faucet:demo` (also published as
  `ghcr.io/toon-protocol/townhouse-faucet:demo` for compat with
  `townhouse.sdl.yaml`).
- SDL: `deploy/akash/faucet.sdl.yaml` — single small service exposing
  port 3500 via Akash L7 ingress (HTTPS via Let's Encrypt).
- Drives BOTH chains from one container — `RPC_URL` and `SOLANA_RPC_URL`
  are templated from `leases.json` at deploy time by
  `render_faucet_sdl` in `scripts/akash-deploy.sh`.
- Bakes the deterministic Solana faucet authority into the image at
  `/etc/faucet/sol-authority.json` (build context is the repo root so
  `infra/solana/keys/faucet-authority.json` is reachable).
- Holds an in-memory ring buffer (cap 100) for the recent-drips feed —
  no cross-origin merge required.

Deploy:

```bash
./scripts/akash-deploy.sh build-faucet   # build + push the image
./scripts/akash-deploy.sh faucet         # deploy a lease, write leases.json
```

API surface (story 49.2 schema-contract at
`packages/townhouse/contracts/faucet.schema.json`):

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /faucet/evm` | `{address, amount?}` | `{tx, chain:'evm', recipient, balanceAfter?, explorerUrl?}` |
| `POST /faucet/sol` | `{address, amount?}` | `{tx, chain:'solana', recipient, balanceAfter?, explorerUrl?}` |
| `POST /faucet` | `{chain, recipient, amount?}` | unified shape; same response |
| `GET /faucet/recent?limit=10` | — | `[{ts, address(truncated), amount, txid, chain}]` |
| `GET /health` | — | `{status:'ok', tokenReady, solanaAuthorityReady, chainIds: {...}}` |

Rate limit: **1 req/sec per source address + 5 req/min per source IP** on
the `/faucet/*` surface (unlimited supply otherwise — no daily cap).
The legacy `/api/*` surface retains its 1-hour cooldown for backwards
compat with the existing dashboards and shell scripts.

The Solana faucet authority's keypair lives at
`infra/solana/keys/faucet-authority.json`. It's committed to the repo
on purpose — same security posture as Anvil's account 0 private key,
which is the most well-known private key in EVM dev. **Devnet only.**

### Lease ownership + sunset (story 49.2 persistent-deployment discipline)

- **Owner:** `dev.jonathan.green@gmail.com` (records lease in
  `leases.json` after the first `faucet` deploy).
- **AKT-burn budget:** ~$2-5/mo at SDL prices. Alert at 50% drain via
  the existing `scripts/akash-status.sh` (manual op-side check; CI cron
  wiring is deferred to a separate hardening story).
- **Sunset:** when Epic 49 retires, close the faucet lease via
  `scripts/akash-deploy.sh close faucet`. Tracked in
  `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49
  sunset checklist".

---

## Troubleshooting

### A lease looks "healthy" but `getSlot` is frozen

Symptom: `akash-status.sh` reports `ok` for solana, but transactions
fail with timeouts and `getSlot` returns the same number on consecutive
calls.

Cause: `solana-test-validator` returns `getHealth: ok` based on whether
the RPC is alive, *not* whether the chain is progressing. The original
Akash Solana lease in this stack sat at slot `27009` for 12+ hours that
way. Usually downstream of the seccomp issue below.

Fix:
```bash
./scripts/akash-deploy.sh redeploy solana
```
The Solana entrypoint's readiness loop now requires advancing
`getSlot`, so a freshly-deployed lease will fail to come up cleanly
rather than appearing healthy in this state. But existing leases pre-
dating that change can still wedge — redeploy + denylist.

### `solana-test-validator` panics on `io_uring_supported()`

Symptom: container starts, RPC port never opens, validator log shows
`assertion failed: io_uring_supported()`.

Cause: Docker's default seccomp profile blocks `io_uring_setup`.
Provider-side seccomp varies — some allow it, some don't. Once a
provider rejects it, every fresh lease there will panic the same way.

Fix:
- **On Akash:** redeploy + denylist.
- **Locally** (testing `Dockerfile.akash-solana`): run with
  `--security-opt seccomp=unconfined`.

### `redeploy <name>` says "no eligible bids"

The only bidders all matched the denylist. The script now closes the
orphan deployment for you (refunds the deposit), but you still have to
choose:

- Widen the SDL (this is what we did — dropping `class:beta2`
  persistent storage opens the pool dramatically), or
- Remove the offending entry from `denylist.json` and accept that
  you'll land back on a known-bad provider, or
- Wait for new bidders.

### EVM RPC works but WebSocket "fails"

Don't trust the deploy script's `WebSocket upgrade rejected by this
provider` warning. It uses `curl --include` over HTTP/2, which gets
rejected at the upgrade gate even on providers where actual WS clients
(Node `ws`, browsers — both of which negotiate HTTP/1.1 specifically
for the WS handshake) connect fine.

Verify with a real client before redeploying:

```bash
node -e "const W=require('ws');const w=new W('wss://<host>');\
w.on('open',()=>w.send(JSON.stringify({jsonrpc:'2.0',method:'eth_subscribe',params:['newHeads'],id:1})));\
w.on('message',m=>console.log(m.toString()));setTimeout(()=>process.exit(),5000)"
```

### Otterscan shows a stale chain after Anvil redeploy

Otterscan templates `ERIGON_URL` from `leases.json` at deploy time, so
a redeployed Anvil leaves Otterscan pointing at a dead RPC. Fix:
```bash
./scripts/akash-deploy.sh redeploy otterscan
```
…or use `redeploy-all`, which handles dependency order automatically.

### "ingress 502" on a freshly-ready lease

Provider's nginx accepted the deployment but can't reach the upstream
container — the container is misconfigured, crashed, or the provider's
ingress→pod routing is broken. Akash Console will report the pod as
"1/1 ready" anyway (no liveness probe in the SDLs). Fix:
```bash
./scripts/akash-deploy.sh redeploy <name>
```

### "self-signed certificate" / TLS verify fails

A small fraction of Akash providers ship leases with their internal CA
instead of a real Let's Encrypt cert. Browsers refuse to load them.
Fix is the same — redeploy to land elsewhere.

---

## Costs

Approximate, in dollars (Akash deposit denomination):

| Lease | Deposit per deploy | Roughly per month at current AKT prices |
| --- | --- | --- |
| anvil | $5 | $3–5 |
| solana | $10 | $10–15 |
| otterscan | $15 | $1–2 |
| solana-explorer | $5 | $1–2 |

Closing a lease (`close <name>`, `redeploy <name>`, or `redeploy-all`)
refunds the unconsumed escrow. The deposit is not lost — it's locked
for the duration of the lease, then returned minus actual consumption.

---

## Design decisions (the why)

### Why no persistent storage

Anvil's and Solana's SDLs originally requested
`class:beta2 persistent: true` storage volumes. **Dropped** because:

1. Each container's entrypoint already runs the chain with `--reset`
   (or equivalent), so persistence within a lease was never load-
   bearing — every restart is a fresh chain regardless.
2. `class:beta2` storage is supported by very few providers in the
   current Akash market. We saw exactly one bidder for the persistent-
   storage anvil SDL; when that provider's ingress wedged, denylisting
   them left zero eligible bids and we had to open the SDL anyway.

The bootstrap step (`infra/solana/bootstrap-usdc.mjs`, the Anvil
`forge script`) is idempotent on a fresh ledger, so dropping
persistence costs nothing.

### Why public dev keypairs

`infra/solana/keys/faucet-authority.json` and
`infra/solana/keys/usdc-mint.json` are 64-byte keypair JSON files
committed to the repo. This is intentional — same security posture as
Anvil's account 0 private key
(`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`),
which is the most-published private key in EVM dev.

These keys are devnet-only. Treat them as fixtures, not secrets.

### Why one deploy script instead of separate per-service ones

`akash-deploy.sh` is large but it's the only script that knows the
dependency graph (otterscan needs anvil's URL, solana-explorer needs
solana's URL). Keeping that knowledge in one place is what makes
`redeploy-all` possible. Per-service shell scripts would duplicate the
templating + bid-handling logic.

### Why the script writes `leases.json` instead of querying Akash on demand

Two reasons:
1. **Latency.** Hitting the Console API on every faucet call would add
   seconds and a hard dependency on `AKASH_CONSOLE_API_KEY`.
2. **Operator visibility.** `leases.json` is committed; you can see
   what's deployed at a glance in `git log` and PR diffs.

The tradeoff is that a stale `leases.json` (e.g. someone closed a
lease via the web Console) silently misroutes things. Mitigation:
`akash-status.sh` is the always-current health check, and `redeploy-all`
re-syncs `leases.json` against fresh leases.

---

## Where things live

| Path | What it is |
| --- | --- |
| `deploy/akash/*.sdl.yaml` | One Akash SDL per service |
| `deploy/akash/leases.json` | Current deployed set (committed) |
| `deploy/akash/denylist.json` | Provider blocklist (committed) |
| `docker/Dockerfile.akash-{anvil,solana,solana-explorer}` | Image definitions |
| `infra/solana/entrypoint.sh` | Solana validator startup + readiness loop + USDC bootstrap call |
| `infra/solana/bootstrap-usdc.mjs` | Idempotent Mock USDC mint creator (runs in container) |
| `infra/solana/spl-primitives.mjs` | Shared SPL primitives (createMint, mintTo, transferChecked, ATA, ed25519 sign+send) |
| `infra/solana/keys/` | Public dev keypairs (mint, faucet authority) |
| `scripts/akash-deploy.sh` | The build + deploy + close + redeploy + redeploy-all driver |
| `scripts/akash-status.sh` | Probe every lease's RPC; exits 1 if any unreachable |
| `scripts/faucet-{evm,sol}.sh`, `faucet-sol-usdc.mjs` | Shell faucets, read `leases.json` |
| `packages/townhouse/src/api/routes/faucet.ts` | `POST /api/faucet` route handler |
| `packages/townhouse-web/src/components/faucet-panel.tsx` | Operator-dashboard FaucetPanel UI |
