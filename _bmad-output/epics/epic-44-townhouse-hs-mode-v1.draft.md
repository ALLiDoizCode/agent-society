# Epic 44: Townhouse — Single-Command HS-Mode v1

**Status:** PLANNED
**Date:** 2026-05-07
**Origin:** 11-round Party Mode roundtable (Mary, John, Winston, Amelia, Sally, Murat, Victor)
**Decision Record:** [`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`](../planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md)
**Parent context:** Epic 21 (Townhouse — Node Provider Dashboard & Orchestrator)

---

## Goal

Deliver a single-command, host-native operator surface for running a TOON Protocol node behind an Anyone Protocol hidden service on a homelab box. `npx @toon-protocol/townhouse hs up` boots the apex (connector + host API + `.anyone` HS); operators add child nodes (Town first, Mill/DVM opt-in) on demand via `townhouse node add`. The default UX is an **Ink TUI** showing **monthly USDC earned** as the hero metric.

This epic is the **v1 hand-shipped product** that emerges from Epic 21's broader townhouse vision — narrowed by persona (homelab DePIN-tinkerer "Drew"), by surface (Ink TUI, not Tauri), by denomination (USDC, not sats), and by validation gate (no public launch unless 30-day pilot data supports the earnings story).

---

## Key Design Decisions

**D44-001: v1 persona is Drew the homelab DePIN-tinkerer, not Maya the laptop hobbyist.** Drew runs Proxmox/Hetzner, already self-hosts ~10 services (Jellyfin, Nextcloud, a Lightning node), is USDC-native, terminal-fluent, and competes for the same mindshare Akash/Storj/Helium operators occupy — NOT the Bitcoin maxi homelab tribe (Umbrel, Start9). Maya's product is a different binary in v2. *(Round 5)*

**D44-002: USDC denomination, not sats.** Strategic Blue Ocean exit from the Bitcoin-maxi competitive set. Hero number is `MONTH $X.XX USDC`. `townhouse status --units=sats` exists as an undocumented power-user flag only. *(Round 6)*

**D44-003: Ink TUI is the v1 surface.** Ratatui (Rust) rejected because it adds a parallel Rust build pipeline (6 prebuilt artifacts, codesigning, GHCR matrix). Ink is TypeScript, ships in the same npm tarball, talks to the Fastify host API. The web SPA at `127.0.0.1:28090` ships available but never auto-launches. Tauri is deferred to v2. *(Rounds 4–5)*

**D44-004: Apex-only at install. Lazy node provisioning.** `townhouse hs up` boots the connector + host API + `.anyone` HS — no child nodes. Operator runs `townhouse node add <town|mill|dvm>` per node they want. An idle apex with zero peers is a coherent resting state (a reachable, payable identity). *(Round 3)*

**D44-005: Town as default, Mill/DVM opt-in (Mill is the "5x earnings" upsell).** Town has the recognizable JTBD ("paid Nostr relay"). Mill ships in v0.5 reframed as the earnings multiplier — visible-but-quiet on the dashboard so empty `apex routing fees: $0.00` is an upsell hook, not a bug. *(Rounds 6–7)*

**D44-006: Two-bucket earnings: apex routing fees + per-peer claims.** Maps 1:1 to connector data model (`/admin/earnings.json` returns `connectorFees[]` and `peers[]` separately). Drew's mental model: "the connector earned $X routing, my Town earned $Y relaying." *(Round 7)*

**D44-007: Children stay health-only. Connector is the single source of truth for earnings.** Adding `/earnings` to Town/Mill/DVM creates a reconciliation problem nobody needs. Children own work-counts; connector owns money-counts. *(Round 7)*

**D44-008: Townhouse owns its own time-series.** Connector returns lifetime cumulative; townhouse snapshots hourly to `~/.townhouse/earnings-snapshots.jsonl` and computes today/month/year deltas locally. No upstream coupling to ask for windowed endpoints. *(Round 7)*

**D44-009: `~/.townhouse/nodes.yaml` is operator-managed source of truth; connector peers list is derived state.** Reconciler at boot diffs the two and converges (yaml wins). Registration is the LAST step of `node add`; deregistration is the FIRST step of `node remove`. Half-registered state is the new bug surface and is bounded by ordering. *(Round 3)*

**D44-010: No Docker socket inside the connector container.** Host-side `townhouse-api` (Fastify) owns `dockerode` and runs as the host user. Connector container never sees `/var/run/docker.sock`. Container-escape primitive eliminated. *(Round 3)*

**D44-011: CLI is a thin client of the host API.** Both terminal and any future SPA/Tauri surface hit the same `127.0.0.1:28090` endpoints. Refuting "API only" — power users SSH'd into a headless box need the CLI. *(Round 3)*

**D44-012: Layering rule — connector stays generic.** Connector does NOT learn `'town' | 'mill' | 'dvm'`. Townhouse owns the `type` concept via `packages/townhouse/src/registry/peer-type-resolver.ts`. *(Round 10)*

**D44-013: Townhouse consumes the connector image by digest, doesn't republish.** Connector repo's own `build-and-publish.yml` already publishes to `ghcr.io/toon-protocol/connector` on every `v*` tag. Townhouse pins via `image-manifest.json`. CI publishes only four images: `townhouse-api`, `town`, `mill`, `dvm`. *(Round 11)*

**D44-014: Telemetry instrumentation is mandatory before pilot recruitment.** John's validation gate ($1.00 / $0.10 / <$0.10 weekly thresholds) cannot fire on subjective vibes. Anonymous opt-in ping with no PII; opt-in REQUIRED for v0.1 pilot operators. *(Round 9)*

**D44-015: Empty-state copy ships in the same PR as the TUI scaffold.** Drew spends his first 72 hours staring at zeros. Empty-state copy is not a follow-up ticket — it merges with the rendering code or the diff doesn't ship. *(Sally, Round 8)*

---

## Architecture

### Boot topology (after `townhouse hs up`, before any `node add`)

```
┌─────────────────────────────────────────────────┐
│  HOST                                           │
│  ┌────────────────────────────────────────┐    │
│  │  townhouse CLI (Ink TUI when TTY)      │    │
│  │   ↓ HTTP                                │    │
│  │  townhouse-api (Fastify, dockerode)    │    │
│  │   ↑ writes ~/.townhouse/{nodes.yaml,   │    │
│  │      earnings-snapshots.jsonl,         │    │
│  │      telemetry.json, wallet.enc}       │    │
│  └────────────────────────────────────────┘    │
│           ↓ docker.sock                         │
│  ┌────────────────────────────────────────┐    │
│  │  Docker Network                         │    │
│  │  ┌─────────────────────┐                │    │
│  │  │  connector          │ → .anyone HS   │    │
│  │  │  (in-process anon)  │ → /admin/*     │    │
│  │  └─────────────────────┘                │    │
│  │   (no peers yet — apex idle)            │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### After `townhouse node add town`

```
                          ┌─────────────┐
              registers   │  town-01    │ → /health
              ←──────────►│             │
                          └─────────────┘
                  ↕
            ┌──────────────┐
            │  connector   │ → /admin/earnings.json
            │              │   (peers[].byAsset)
            └──────────────┘
                  ↑
                  │ derives type via
                  │ peer-type-resolver
                  ↓
            ~/.townhouse/nodes.yaml
              (source of truth)
```

### Data plane — TUI metric → source

| TUI Metric | Source | Field |
| --- | --- | --- |
| MONTH earned (USDC) | computed | snapshot delta of `peers[].byAsset[].claimsReceivedTotal` |
| Apex routing fees | `/admin/earnings.json` | `connectorFees[].total` |
| Per-peer last claim | `/admin/earnings.json` | `peers[].byAsset[].lastClaimAt` |
| Events relayed | `/admin/metrics.json` | sum of `peers[].packetsForwarded` |
| Activity ticker | `/admin/earnings.json` | `recentClaims[]` (last 50) |
| HS hostname | `/admin/hs-hostname` | `hostname` (gated on CR-1) |
| Child node phase | per-node `/health` | `phase` |

---

## Dependencies

- **Epic 21:** Townhouse package scaffold, dockerode orchestration, HD wallet manager, Fastify metrics API (Stories 21.1, 21.2, 21.4, 21.8)
- **Epic 12:** ATOR / Anyone Protocol transport
- **Connector v3.4.0+:** ships `GET /admin/hs-hostname` (CR-1, this epic's upstream dependency — see Phase F)
- **Connector v3.3.3:** already exposes `GET /admin/earnings.json`, `/admin/metrics.json`, `/admin/peers`, `/admin/balances/:peerId`, `/admin/channels`, `/health`

---

## Three-Milestone Roadmap

### v0.1 — Internal pilot (5 ops, 30 days)
Bare CLI. No TUI polish. Telemetry instrumented end-to-end. Critical path: TH-21.17.1 → .2 → .5 → .6 → .7 → .9 → .10 → .11 → .12 → .14. Plus CR-1 upstream. **Goal: produce the dataset that validates the earnings story.**

### v0.5 — Closed beta (50 ops)
Adds Ink TUI (TH-21.17.13) with full design specs from Sally. Adds `townhouse node add mill` as the "5x earnings unlock" upsell. Mary's evidence work signed off (research schedule + non-goals doc).

### v1.0 — Public launch
Marketing claim **gated by validation forks:**
- **Median weekly USDC ≥ $1.00** → ship full earnings hero. "Earn passive USDC from your homelab."
- **$0.10–$1.00** → demote earnings panel; hero = events relayed + earnings sub. "Run yields, be early."
- **< $0.10** → **delay public launch.** Hero pivots to events relayed + uptime. "Be early to the network."

DVM opt-in available. Decision + raw data committed to `_bmad-output/v0.1-pilot-results.md`.

---

## Stories

### Phase A: Image + Compose Foundation

#### Story TH-21.17.1: Multi-Arch Image Publish CI

**As a** townhouse release engineer, **I want** a CI workflow that builds and publishes townhouse-owned images to GHCR with digest pinning, **so that** operators pull pre-built images by digest and townhouse never republishes the connector image.

**Acceptance Criteria:**
- [ ] Workflow at `.github/workflows/publish-townhouse-images.yml` triggers on `v*` tags and `workflow_dispatch`
- [ ] Builds `linux/amd64` AND `linux/arm64` for FOUR images: `townhouse-api`, `town`, `mill`, `dvm` — NOT `connector` (connector is consumed upstream by digest)
- [ ] Pushes to `ghcr.io/toon-protocol/{townhouse-api,town,mill,dvm}` with `:vX.Y.Z` semver tag, `:latest` alias, and digest references
- [ ] `scripts/build-image-manifest.mjs` generates `packages/townhouse/dist/image-manifest.json` containing `{name, tag, digest}` for all four images PLUS the upstream connector digest pinned at the released-against connector version
- [ ] Cosign keyless OIDC signing on every published image (gates townhouse v1.0 publish — depends on connector CR-3 also shipping)
- [ ] Image-publish step ordered BEFORE `npm publish` step — npm version cannot resolve to a tag whose images don't exist
- [ ] CI green on at least one tagged release before any consumer story (TH-21.17.2) wires it
- [ ] Failure budget documented: arm64 + cosign + matrix manifest is the most failure-prone YAML in the repo; budget 2× nominal estimate

**Size:** L
**Critical path:** ★

---

#### Story TH-21.17.2: Embed Compose Templates + Image Manifest

**As a** townhouse operator, **I want** the npm package to ship embedded compose YAML and digest-pinned image references, **so that** I never need to clone the repo and the version of townhouse I install always pulls the exact images it was tested against.

**Acceptance Criteria:**
- [ ] `packages/townhouse/compose/townhouse-hs.yml` exists in source, references images via `image: ghcr.io/toon-protocol/<svc>@sha256:<digest>` (digests resolved from `image-manifest.json` at build time)
- [ ] `packages/townhouse/compose/townhouse-dev.yml` retained for the existing dev stack (`scripts/townhouse-dev-infra.sh`) — separate file, separate lifecycle
- [ ] `image-manifest.json` shipped inside the npm tarball (NOT gitignored, generated by TH-21.17.1's CI and committed in the release commit)
- [ ] On first `townhouse hs up`, the runtime loader writes the resolved compose YAML to `~/.townhouse/compose/townhouse-hs.yml` and digest manifest to `~/.townhouse/image-manifest.json` with mode `0o600`
- [ ] `packages/townhouse/src/compose-loader.ts` provides `loadComposeTemplate(profile: 'dev'|'hs'): string` — reads from package dist dir, substitutes digests
- [ ] Unit test: loaded compose passes `docker compose config` validation (run via dockerode against an in-process Docker stub)

**Deps:** TH-21.17.1
**Size:** M
**Critical path:** ★

---

#### Story TH-21.17.3: DockerOrchestrator Profile Param

**As a** townhouse engineer, **I want** the existing `DockerOrchestrator` to accept a `profile: 'dev' | 'hs'` parameter, **so that** the same orchestration code drives both the contributor dev stack and the operator HS-mode stack without duplication.

**Acceptance Criteria:**
- [ ] `DockerOrchestrator.constructor` accepts `{ profile: 'dev' | 'hs', composePath: string }`
- [ ] Existing dev-stack tests stay green; refactor adds the `profile` param without changing behavior for `'dev'`
- [ ] Profile selection drives compose-file-path AND the set of `--profile` flags passed to `docker compose up` (HS profile passes `--profile localnet --profile town --profile mill --profile dvm --profile faucet` per current `docker-compose-townhouse-hs.yml` shape; tests pin which flags are emitted)
- [ ] Per-profile lifecycle hooks documented in code: HS profile must wait for connector `/admin/hs-hostname` ready=true before considering "up" complete
- [ ] No regression in `pnpm --filter @toon-protocol/townhouse test` or `test:integration`

**Deps:** TH-21.17.2
**Size:** S

---

### Phase B: Apex Boot + Lazy Node Provisioning

#### Story TH-21.17.5: `townhouse hs up` Subcommand (Apex-Only Boot)

**As a** homelab operator, **I want** to run `npx @toon-protocol/townhouse hs up` once and have the apex (connector + host API + `.anyone` HS) come up with zero further configuration, **so that** I have a payable identity on the TOON network in under 5 minutes without enabling any peer node yet.

**Acceptance Criteria:**
- [ ] New CLI subcommand `townhouse hs up` registered in `packages/townhouse/src/cli.ts`
- [ ] Boots TWO services: `connector` (with anon HS volume `townhouse-hs-anon`) and `townhouse-api` (Fastify on `127.0.0.1:28090`, mounts host docker.sock RW, mounts `~/.townhouse/`)
- [ ] Polls `GET /admin/hs-hostname` (CR-1) until `ready: true`, with status narration to stdout (Sally's onboarding ribbon spec): `"Pulling apex image..."` → `"Bootstrapping hidden service (this takes 30–90s)..."` → `"Apex live at <hostname>.anyone"`
- [ ] Prints the `.anyone` address as the final line of output and writes it to `~/.townhouse/host.json` for later retrieval
- [ ] Idempotent: running `townhouse hs up` against an already-running apex re-prints the hostname and exits 0; never re-pulls or re-creates volumes
- [ ] `townhouse hs down` stops the apex preserving volumes (`.anyone` address stable across restarts)
- [ ] `townhouse hs down --rotate-keys` deletes the `townhouse-hs-anon` volume to rotate the address (operator-explicit destructive action)
- [ ] Wallet password handling: env-var or interactive prompt; non-interactive mode requires `TOWNHOUSE_WALLET_PASSWORD` or `--password` flag
- [ ] Error paths exercise Sally's failure-state copy library (anon timeout, image pull fail, port collision, missing docker.sock)
- [ ] Real-CLI E2E test in `scripts/townhouse-test-infra.sh` exercises full `init → hs up → hostname appears → hs down` cycle

**Deps:** TH-21.17.2, TH-21.17.3, TH-21.17.4 (CR-1 upstream)
**Size:** M
**Critical path:** ★

---

#### Story TH-21.17.6: `nodes.yaml` Schema + Boot Reconciler

**As a** townhouse engineer, **I want** `~/.townhouse/nodes.yaml` to be the operator-managed source of truth for enabled child nodes and a boot-time reconciler that converges connector peer state to it, **so that** laptop reboots, half-completed `node add` operations, and connector restarts all converge to the operator's declared intent without manual cleanup.

**Acceptance Criteria:**
- [ ] Schema at `packages/townhouse/src/state/nodes-yaml.ts` with zod validation: `entries: [{ id: string, type: 'town' | 'mill' | 'dvm', peerId: string, ilpAddress: string, derivationIndex: number, enabledAt: string, lastSeenAt: string | null }]`
- [ ] **AC: `nodes.yaml.entries[*].peerId` MUST equal the connector's `peerId` (from `/admin/peers` and `/admin/earnings.json`) byte-for-byte** — migration covers any historical `ilpAddress`-only or `peerPubkey`-only rows
- [ ] Reconciler at `packages/townhouse/src/reconciler.ts` runs on `townhouse hs up` after connector is healthy:
  - Reads `nodes.yaml` (truth)
  - Reads connector `GET /admin/peers` (derived state)
  - For each yaml entry not in connector: re-runs the registration step (idempotent `POST /admin/peers`)
  - For each connector peer not in yaml: logs as `external` and leaves alone (legitimate — operator may run non-Townhouse peers through the connector)
  - Logs every divergence to `~/.townhouse/reconciler.log` with timestamps
- [ ] `peer-type-resolver.ts` exposes `resolvePeerType(peerId): 'town' | 'mill' | 'dvm' | 'external'` — in-memory `Map`, rebuilt on yaml change, no async on hot path
- [ ] Integration test: seed `nodes.yaml` with 3 entries, seed connector with 2 of those + 1 external, assert convergence direction is documented and deterministic
- [ ] File mode `0o600` on `nodes.yaml` (contains derivation indices and node identities)

**Deps:** TH-21.17.5
**Size:** M
**Critical path:** ★

---

#### Story TH-21.17.7: `POST /api/nodes` and `DELETE /api/nodes/:id`

**As a** townhouse host API, **I want** to expose endpoints that provision and tear down child nodes atomically with rollback on failure, **so that** the CLI and any future SPA/TUI both drive node lifecycle through one tested code path.

**Acceptance Criteria:**
- [ ] `POST /api/nodes { type: 'town' | 'mill' | 'dvm' }` orchestrates the strict 5-step pipeline:
  1. `WalletManager.deriveNodeKey(type, nextIndex)` → derived key (no state change yet)
  2. `DockerOrchestrator.pullImage(manifest[type].digest)` → fail returns 502, no state change
  3. **Write `nodes.yaml` entry FIRST** (before connector registration)
  4. `DockerOrchestrator.startContainer(spec)` with derived key as env → fail removes yaml entry, returns 502
  5. `waitForHealthy(http://<id>:<port>/health, 60s)` → fail removes yaml entry + stops container, returns 502
  6. `ConnectorAdminClient.registerPeer({ pubkey, endpoint })` → fail removes yaml entry + stops container, returns 502
- [ ] **AC: Step ordering — `nodes.yaml` write happens BEFORE `/admin/peers` registration** — drift window is "peer in yaml but not yet registered" (harmless; reconciler catches it next boot). The reverse order would create "peer registered but not in yaml" → resolver returns `'external'` for an actually-Townhouse peer
- [ ] `DELETE /api/nodes/:id` reverses: deregister with connector FIRST → stop container → remove yaml entry. Same return-code discipline
- [ ] All state mutations idempotent (re-runs against the same operator action are no-ops)
- [ ] Returns `{ id, type, peerId, ilpAddress, hsRoute, healthCheckUrl }` on success
- [ ] Error responses include the specific step that failed (`{ step: 'healthcheck', err: '...' }`) for debuggability
- [ ] State-machine table tests with injected failures at each transition (Murat risk #1)

**Deps:** TH-21.17.6
**Size:** M

---

#### Story TH-21.17.8: `townhouse node add` / `townhouse node remove` CLI

**As a** terminal operator, **I want** terse CLI verbs that map 1:1 to host-API node lifecycle, **so that** I can `townhouse node add town --auto-key --auto-fund` and see it work without buttons or modals.

**Acceptance Criteria:**
- [ ] `townhouse node add <town|mill|dvm>` calls `POST /api/nodes` and renders status to stdout via Sally's per-card-flip ribbon (`Pulling image · Deriving wallet · Registering with apex · Live`)
- [ ] `townhouse node remove <id>` calls `DELETE /api/nodes/:id` with confirmation prompt (suppressible via `--yes`)
- [ ] `townhouse node list` calls `GET /api/nodes` and prints a table (peer · type · status · last claim)
- [ ] Every CLI action has a `--json` twin that emits machine-readable output (Drew may script this)
- [ ] Default subcommand for first-run convenience: `townhouse node add` with no type defaults to `town` (per D44-005)
- [ ] Help text includes the upsell hint: `townhouse node add mill   # earn from chain swaps (5x earnings unlock)`

**Deps:** TH-21.17.7
**Size:** S

---

### Phase C: Earnings Stack

#### Story TH-21.17.9: SDK `getEarnings()` Wrap + Contract Canary

**As a** townhouse engineer, **I want** the SDK's `ConnectorAdminClient` to expose `getEarnings()` with type-safe contract assertions, **so that** the aggregator and telemetry layers consume real connector data instead of packet-count proxies, and any future connector-version drift fails the canary loudly.

**Acceptance Criteria:**
- [ ] Add to `packages/townhouse/src/connector/types.ts` after line 207: `EarningsResponse`, `PeerEarnings`, `AssetEarnings`, `ConnectorFeeEntry`, `RecentClaim`, `EarningsTimestamp` interfaces — re-declared, NOT re-exported from `@toon-protocol/connector` (the canary exists to catch drift)
- [ ] Add `async getEarnings(): Promise<EarningsResponse>` to `packages/townhouse/src/connector/admin-client.ts` after line 177, mirroring the existing `getMetrics()` pattern (lines 81–112)
- [ ] Update `packages/townhouse/src/connector/contract-canary.test.ts` to assert: `uptimeSeconds: number`, `peers[].byAsset[].claimsReceivedTotal: string`, `connectorFees[].assetCode: string`, `recentClaims` is array
- [ ] Update `packages/townhouse/src/__integration__/connector-image-contract.test.ts` to add a real-image probe of `/admin/earnings.json` against the connector container at the digest pinned in source (NOT `:latest`) — Murat risk #4
- [ ] Bump `packages/sdk/CONNECTOR_MIGRATION.md` with v3.3.3 contract entry covering the earnings shape

**Deps:** none (parallelizable with Phase A/B)
**Size:** S

---

#### Story TH-21.17.10: Aggregator Earnings Surgery

**As a** townhouse aggregator, **I want** to derive per-peer earnings from real connector data instead of packet-volume proxies, **so that** the dashboard's hero number reflects actual settlement claims, not "I forwarded a lot of packets."

**Acceptance Criteria:**
- [ ] Delete the packet-volume proxy logic in `packages/townhouse/src/earnings/aggregator.ts` lines 31–36 (the `TODO(D4-connector-fees)` block)
- [ ] Replace with `await connectorAdmin.getEarnings()` call
- [ ] Map `connectorFees[]` → `by_source.connector.routing_fees[assetCode]`
- [ ] Map `peers[]` → match each `peerId` against `peer-type-resolver.resolvePeerType()`; bucket `'external'` for unmatched peers (do NOT drop — Murat round 10)
- [ ] Output shape conforms to the two-bucket contract:
  ```ts
  { apex: { routingFees: Record<AssetCode, AmountWithDeltas> },
    peers: Array<{ id, type: NodeType | 'external', byAsset: Record<AssetCode, AmountWithDeltas> }> }
  ```
- [ ] `AmountWithDeltas` shape: `{ lifetime: string, today: string, month: string, year: string }`
- [ ] No more direct calls to `getPacketLog()` from the earnings aggregator (packet log stays a separate metric for "events relayed")

**Deps:** TH-21.17.9
**Size:** M

---

#### Story TH-21.17.11: Hourly Earnings Snapshot Writer

**As a** townhouse host API, **I want** to persist hourly snapshots of cumulative connector earnings, **so that** the dashboard can show TODAY/MONTH/YEAR/LIFETIME deltas without asking the connector team to add windowed endpoints.

**Acceptance Criteria:**
- [ ] Snapshot writer at `packages/townhouse/src/earnings/snapshot-writer.ts` runs on an hourly tick in the apex process (cleared on `townhouse hs down`)
- [ ] Append-only JSONL at `~/.townhouse/earnings-snapshots.jsonl`, one entry per `(timestamp, peerId, assetCode, claimsReceivedTotal)` tuple
- [ ] Delta computation: TODAY = current − snapshot at most-recent UTC midnight; MONTH = current − snapshot at month boundary; YEAR = ditto; LIFETIME = current
- [ ] Pruning: retain ≥13 months minimum (so YEAR-over-YEAR comparisons survive into v2)
- [ ] Property-based tests (fast-check) per Murat: `sum(deltas) == final − initial`, monotonicity, DST transitions, year boundary, mid-write truncation recovery
- [ ] 9500-entry fixture replay: read perf <100ms, file size <2MB
- [ ] Mid-write truncation test: kill the writer mid-append, assert next boot recovers to last-good entry without crash
- [ ] File mode `0o600`

**Deps:** TH-21.17.10
**Size:** M

---

#### Story TH-21.17.12: `GET /api/earnings` Two-Bucket Endpoint

**As a** TUI / SPA / future Tauri client, **I want** a single host-API endpoint that returns the operator's earnings shaped for direct render, **so that** the surface layer doesn't compute deltas, doesn't reach into the connector, and doesn't know about external peers.

**Acceptance Criteria:**
- [ ] `GET /api/earnings` returns:
  ```json
  {
    "apex": { "routingFees": { "USDC": { "lifetime": "0.0234", "today": "0.0001", "month": "0.0078", "year": "0.0234" } } },
    "peers": [
      { "id": "town-01", "type": "town", "byAsset": { "USDC": { "lifetime": "0.0421", "today": "0.0012", "month": "0.0234", "year": "0.0421" } }, "lastClaimAt": "2026-05-07T18:23:14.000Z" },
      { "id": "external-abc", "type": "external", "byAsset": { ... } }
    ],
    "recentClaims": [ /* connector recentClaims[] passthrough, last 50 */ ],
    "eventsRelayed": 47,
    "uptimeSeconds": 432189
  }
  ```
- [ ] John's small-number-shaming guard: `eventsRelayed` always present (sourced from `/admin/metrics.json` — sum of `peers[].packetsForwarded`)
- [ ] Per-asset breakout, NOT collapsed to USD-equivalent (Winston round 7) — multi-chain operators see USDC-on-EVM and USDC-on-Solana as separate rows
- [ ] OpenAPI / TypeBox schema in `packages/townhouse/src/api/schemas/earnings.ts`
- [ ] Integration test against MockEarningsConnector covers all four delta windows + the `'external'` peer bucket

**Deps:** TH-21.17.11
**Size:** S

---

### Phase D: Operator Surface (Ink TUI)

#### Story TH-21.17.13: Ink TUI — Earnings Header + Peer Table + Activity Ticker

**As a** terminal operator (Drew), **I want** a full-screen TUI that gives me the hero earnings number, per-peer rows, and an activity heartbeat, **so that** I can see whether my homelab is earning, what's most recent, and what to do next — without a browser.

**Acceptance Criteria:**
- [ ] **MERGE GATE:** PR does not merge without `_bmad-output/design/empty-state-copy.md` populated, reviewed by Sally, signed off in PR description (D44-015)
- [ ] TUI scaffold at `packages/townhouse/src/tui/` (Ink + ink-table + ink-spinner + ink-gradient — TS-only, no Rust)
- [ ] Default invocation: `townhouse hs up` opens the TUI when stdout is a TTY; non-TTY emits structured logs only
- [ ] Layout per Sally's wireframe (`_bmad-output/design/townhouse-tui-wireframe.md`):
  - **Hero band (3 rows):** `TODAY · MONTH · YEAR · LIFETIME` + 7d ASCII sparkline
  - **Apex routing-fee strip (1 row):** `↳ apex routing: $X.XX (Y%)` with empty-state hint `(enable mill to route)` when fees == 0
  - **Per-peer table (3–4 rows, scrollable):** columns `peer · status · asset · net 7d · last claim · spark`
  - **Activity ticker footer (1 row):** rolling `recent: <peerId> ← $X.XXXX USDC · 0:42 ago [a] activity`
- [ ] Empty-state hero qualifier (D44-015): `MONTH $0.00 · 47 events relayed · you're early` — vanishes when there's a dollar to show
- [ ] "You're early" badge: appears when `lifetime < $1.00 OR uptime < 7d`; rotates copy ("you're early" / "warming up" / "first packet en route"); disappears silently after first $1 lifetime
- [ ] `[a]` opens scrollable Activity overlay (modal, j/k scroll, q close, 200-row ring buffer) — full 50-event `recentClaims` view
- [ ] 80×24 stress test: layout fits at iPhone Termius baseline; sparklines collapse first as columns shrink, asset rows last
- [ ] Refresh cadence: 2s tick (kubectl-top class). Silent updates — no animations, no chimes, no floating `+$0.001`
- [ ] Drill subcommands provided as separate CLI verbs (out of TUI scope): `townhouse channels`, `townhouse metrics`, `townhouse logs`, `townhouse peer <id>`, `townhouse health`
- [ ] Ink testing-library snapshot tests: data-to-render mapping, empty-state copy fires correctly, badge appearance/disappearance, keybind transitions
- [ ] **Sats-curious power-user flag:** `townhouse status --units=sats` exists, undocumented in main `--help`, mentioned only in a README footnote (per D44-002)

**Deps:** TH-21.17.12
**Size:** L
**Critical path:** ★ (v0.5)

---

### Phase E: Telemetry (v0.1 Critical for Validation Gate)

#### Story TH-21.17.14: TOON-Pulse Telemetry Instrumentation

**As a** townhouse pilot operator, **I want** to opt-in to anonymous earnings telemetry, **so that** the project can fire its public-launch validation gate on real data instead of subjective vibes — and so that pilot operators are explicitly part of the dataset that decides v1.0 marketing copy.

**Acceptance Criteria:**
- [ ] Endpoint client at `packages/townhouse/src/telemetry/` POSTs to `https://telemetry.toon-protocol.dev/v1/townhouse-pulse` (Let's Encrypt + Cloudflare for IP stripping)
- [ ] Cadence: every 7 days from operator's first-boot timestamp; jittered ±6h
- [ ] Zod-validated payload (schemaVersion=1):
  ```ts
  { schemaVersion: 1,
    operatorIdHash: string,           // sha256(operatorPubkey + STATIC_SALT)
    townhouseVersion: string,
    weekNumber: number,
    enabledNodes: ('town'|'mill'|'dvm')[],
    earnings: {
      apex: { usdcCents: number },
      perPeer: [{ type: 'town'|'mill'|'dvm'|'external', usdcCents: number }]   // 'external' MUST be allowed in the literal union
    },
    metrics: { eventsRelayed: number, uptimeSeconds: number, peerCount: number },
    flags: { isTestnet: boolean, chainProfile: 'localnet'|'akash-devnet'|'sepolia'|'mainnet' } }
  ```
- [ ] **No PII:** no IP (Cloudflare strips), no hostname, no `.anyone` address, no wallet pubkey unhashed, no claim IDs, no peer counterparty pubkeys
- [ ] Opt-in flow during `townhouse init`: `"Help us improve Townhouse by sending anonymous earnings stats? [Y/n]"` — for v0.1 pilot operators, opt-in is REQUIRED (Mary's recruitment makes this explicit)
- [ ] Disclosure copy locked: *"You're joining the v0.1 pilot. Townhouse will send anonymous earnings telemetry (peer-id hash, USDC/day, uptime — no IP, no wallet) so we can validate the economics before public launch. This is required for pilot participation. Type 'agree' to continue."*
- [ ] Persistent state at `~/.townhouse/telemetry.json`: `{ optedIn: bool, firstBootAt, lastPingAt, pendingPings: TelemetryPayload[] }`, mode `0o600`
- [ ] Runtime control: `townhouse telemetry on|off|status`
- [ ] Local retry-buffer: POST failure → store in `pendingPings[]`, retry with exponential backoff (1h, 4h, 1d, 3d), drop after 4 weeks. Operators never block on telemetry
- [ ] Unit tests: zod schema round-trip, hash determinism (same pubkey+salt → same hash), opt-out hard-stop (assert HTTP client never instantiated when `optedIn=false`)
- [ ] Integration test: `MockTelemetryServer` Fastify fixture on ephemeral port — assert ping fires on schedule, opt-out sends zero pings, retry-buffer flushes on server recovery
- [ ] Production: Grafana dashboard counting weekly active pings; alert on >30% week-over-week drop

**Deps:** none (parallelizable with Phase A/B/C)
**Size:** M
**Critical path:** ★ (v0.1 — validation gate cannot fire without it)

---

### Phase F: Cross-Repo Dependencies (Connector)

These items land in `toon-protocol/connector`, NOT in this repo. Tracked here for sequencing visibility.

#### Story CR-1: Connector — `GET /admin/hs-hostname` Endpoint *(UPSTREAM)*

**As a** townhouse host CLI, **I want** the connector to expose its `.anyone` hidden-service hostname via the existing admin HTTP surface, **so that** `townhouse hs up` does not fall back to a `dockerode exec cat /var/lib/anon/hs/hostname` shellout (unshippable: breaks under Podman, breaks under rootless Docker, requires privileged Docker socket access from a published npm CLI).

**Acceptance Criteria:**
- [ ] New route at `connector/src/http/admin-api.ts`: `GET /admin/hs-hostname`
- [ ] Response 200: `{ hostname: string | null, ready: boolean, publishedAt: string | null }`
  - `hostname` null until anon publishes the descriptor
  - `ready=false` during the 30–90s bootstrap window
  - `publishedAt` ISO-8601 set on first successful read
- [ ] Response 503: `{ error: "anon-disabled" }` when anon not configured
- [ ] Source: connector reads `${anon.dir}/hostname` once on bootstrap success, caches in process state, re-reads on SIGHUP (or existing config-reload signal)
- [ ] Versioning: ships as v3.4.0 (minor bump per `CONNECTOR_RELEASE_CONTRACT.md` — `/admin/*` field additions are minor)
- [ ] Connector contract test fixture asserts response shape
- [ ] Townhouse-side canary at `packages/sdk/tests/integration/connector-contract.test.ts` updated in lockstep with the connector release

**Owner:** Amelia (cross-repo PR)
**Size:** ~80 LOC + tests
**Issue filed:** [toon-protocol/connector#58](https://github.com/toon-protocol/connector/issues/58)
**Deadline:** within 3 working days of epic kickoff

---

#### Story CR-2: Connector — Verify / Add Multi-Arch Image Build *(UPSTREAM)*

**As a** townhouse arm64 operator (Apple Silicon dev, Raspberry Pi 5 homelab), **I want** the connector image to be published for `linux/amd64` AND `linux/arm64`, **so that** `docker pull` succeeds on my hardware without a manual rebuild.

**Acceptance Criteria:**
- [ ] Inspect `connector/.github/workflows/build-and-publish.yml`'s `docker/build-push-action` step
- [ ] If `platforms: linux/amd64,linux/arm64` is missing, open a ~10-line YAML PR adding it
- [ ] Verify by pulling the resulting image on an arm64 machine and inspecting `docker manifest inspect ghcr.io/toon-protocol/connector:<tag>` to confirm both architectures are present

**Owner:** Amelia (verify-then-maybe-PR)
**Size:** S (verify) / S (PR if needed)

---

#### Story CR-3: Connector — Cosign Keyless OIDC Image Signing *(UPSTREAM)*

**As a** townhouse pre-publish quality gate, **I want** the connector image to be cosign-signed via keyless OIDC, **so that** townhouse v1.0's publish workflow can verify the pinned digest before shipping.

**Acceptance Criteria:**
- [ ] PR to `connector/.github/workflows/build-and-publish.yml` adds `sigstore/cosign-installer` and a `cosign sign` step
- [ ] Uses keyless OIDC (no secrets in CI, identity sourced from GitHub Actions OIDC token)
- [ ] Verification step in townhouse's pre-publish gate: `cosign verify ghcr.io/toon-protocol/connector@<digest>` succeeds against the connector's GitHub workflow identity
- [ ] Documented in `CONNECTOR_RELEASE_CONTRACT.md` (CR-4)

**Owner:** Amelia
**Size:** S
**Blocks:** townhouse v1.0 publish

---

#### Story CR-4: `CONNECTOR_RELEASE_CONTRACT.md` (Both Repos) *(UPSTREAM + LOCAL)*

**As a** townhouse maintainer, **I want** a written contract documenting how connector versions map to admin-API stability guarantees, **so that** the team doesn't accidentally consume a breaking-change release between digest-pin time and pilot ship.

**Acceptance Criteria:**
- [ ] Doc at `connector/CONNECTOR_RELEASE_CONTRACT.md` AND `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (kept in sync)
- [ ] Rules:
  - `/admin/*` field **additions** = minor bump (e.g., v3.3.x → v3.4.0)
  - `/admin/*` field **renames or removals** = major bump (v3.x → v4.0)
  - ILP packet wire-format changes = major bump
  - Townhouse pins by digest in `image-manifest.json`; bumps deliberately on each minor
- [ ] Townhouse repo subscribes to `toon-protocol/connector` releases via GitHub release notifications
- [ ] PR includes a CHANGELOG entry on both repos pointing to the new doc

**Owner:** Amelia (doc PRs to both repos)
**Size:** S

---

## Cross-Cutting Acceptance Criteria

These ACs apply across multiple stories and are not owned by any single one:

- [ ] **CC-1:** No story merges without unit tests. Integration tests required for any story touching `dockerode`, `nodes.yaml`, the host API, or the connector contract.
- [ ] **CC-2:** Sally's empty-state copy ships in the same PR as TH-21.17.13 (D44-015). No exceptions.
- [ ] **CC-3:** Critical fixtures land BEFORE the stories that depend on them: `MockEarningsConnector`, `MockAnonBinary`, `InProcessDockerStub`, `EarningsSnapshotFixtures`. Tracked as fixture-only PRs ahead of Phase B/C/D.
- [ ] **CC-4:** Pre-publish quality gate (Murat round 8) — all six gates green before `npm publish`: unit + integration green, contract canary green at pinned digest, image-contract test green at pinned digest, real-CLI E2E green, Playwright `e2e:real` green, cosign signature verification green.
- [ ] **CC-5:** Telemetry instrumentation (TH-21.17.14) ships BEFORE pilot recruitment fires (Mary's 2026-05-25 outreach launch). Validation gate cannot fire on subjective data.

---

## Non-Goals (v1)

Explicitly cut. Documented so scope creep is visible.

- Tauri / Electron desktop wrapper (deferred to v2 if Maya persona materializes)
- ratatui (Rust) TUI rewrite (deferred until ≥50 GitHub issues OR paying homelab cohort requests it)
- Web SPA polish beyond `127.0.0.1:28090` placeholder (TUI is primary surface)
- Mill / DVM as default-on nodes (Mill ships v0.5 as the "5x earnings" upsell; DVM v1.0 opt-in)
- Multi-tenant earnings (single-operator only)
- Auto-update / image-pull-on-boot (operator-driven version bumps only)
- Leaderboards, network-wide stats, per-event animation, fiat ticker, push notifications
- Sats-denominated hero display (`townhouse status --units=sats` exists undocumented only)
- Marketing copy claiming earnings without 30-day pilot validation
- Per-node-type endpoints on the connector (layering violation)
- Forecast / estimated-earnings endpoint (deferred to v2)
- Per-asset `bytesSent` metric (cut from v1 metric list)
- Time-windowed earnings endpoints on the connector (townhouse owns its own snapshots)
- Optimizing for "Maya" — the laptop hobbyist persona explicitly named as v2

---

## Open Threads (Tracked, Unowned)

These need owners assigned before Phase B starts:

1. **Telemetry server hosting** — whose Cloudflare account, whose domain (`telemetry.toon-protocol.dev`), whose Grafana?
2. **Connector release subscription mechanism** — who owns watching `toon-protocol/connector` releases for digest-bump PRs into townhouse?
3. **Pilot operator agreement** — does the pilot need a written participation agreement beyond the telemetry opt-in?
4. **v0.5 Mill economics validation** — Mary's research must include "would you pay slippage to enable Mill if it 5×'d your monthly?" question to validate the upsell narrative.

---

## Linked Artifacts

- **Plan (canonical):** [`_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`](../planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md)
- **Parent epic:** [`_bmad-output/epics/epic-21-townhouse.md`](epic-21-townhouse.md)
- **Connector upstream issue:** [toon-protocol/connector#58](https://github.com/toon-protocol/connector/issues/58)
- **Design specs (to be created):** `_bmad-output/design/townhouse-tui-wireframe.md`, `empty-state-copy.md`
- **Pilot results (post-v0.1):** `_bmad-output/v0.1-pilot-results.md`
- **Non-goals doc (Mary, due 2026-06-04):** `_bmad-output/planning-artifacts/townhouse-v1-non-goals.md`
