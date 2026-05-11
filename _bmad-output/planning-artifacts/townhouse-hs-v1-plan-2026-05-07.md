# Townhouse HS-Mode v1 — Consolidated Plan

**Date:** 2026-05-07
**Status:** Planning complete, ready for execution
**Source:** 11-round party-mode roundtable (Mary, John, Winston, Amelia, Sally, Murat, Victor)

---

## 1. Executive Summary

Townhouse v1 is a **single-command, host-native orchestrator for a TOON Protocol homelab node** that ships behind an Anyone Protocol hidden service. Operators run `npx @toon-protocol/townhouse hs up`, the apex (connector + host API + `.anyone` HS) boots, and they enable child nodes (Town first, Mill/DVM opt-in) via `townhouse node add`. The default surface is an **Ink TUI**; the hero metric is **monthly USDC earned**.

| Decision | Value |
| --- | --- |
| **Persona (v1)** | Drew — homelab DePIN-tinkerer (Hetzner/Proxmox/k3s, runs Akash/Storj-class workloads, USDC-native, terminal-fluent) |
| **Install** | `npx @toon-protocol/townhouse hs up` — pre-built ghcr.io images, digest-pinned, embedded compose YAML written to `~/.townhouse/compose/` |
| **Apex at boot** | `connector` + `townhouse-api` (Fastify on `127.0.0.1:28090`) + `.anyone` HS. No child nodes. |
| **Provisioning** | Lazy via `townhouse node add <town\|mill\|dvm>` — pull → derive key → start → healthcheck → register with `/admin/peers` → write `nodes.yaml` |
| **State of truth** | `~/.townhouse/nodes.yaml` (operator-managed); connector peers list is derived state, reconciled at boot |
| **Default node** | Town only. Mill/DVM are opt-in (Mill is the "5x earnings" upsell) |
| **Surface** | Ink TUI (TS-native, zero new toolchain) — default when stdout is a TTY. SPA at `127.0.0.1:28090` available, not auto-launched. |
| **Denomination** | USDC (Blue Ocean — exits the Bitcoin-maxi competitive set, enters the DePIN comp set: Akash/Storj/Helium) |
| **Hero metric** | `MONTH $X.XX USDC` (the screenshot moment) |
| **Earnings source** | Connector `GET /admin/earnings.json` (already exists in v3.3.3); two buckets — apex routing fees + per-peer claims |

---

## 2. Three-Milestone Roadmap

### v0.1 — Internal pilot (5 ops, 30 days)
- Bare `townhouse hs up` CLI. No TUI polish.
- `/admin/earnings.json` wired end-to-end. Telemetry instrumentation **mandatory** (validation gate cannot fire without it).
- One purpose: produce the dataset that decides whether v1 is a product or a hobby kit.
- **Engineering scope:** install script, hidden-service binding (TH-21.17.1–.7 + .14 telemetry).
- **Recruitment:** see §8.

### v0.5 — Closed beta (50 ops)
- Ink TUI ships (full design from §5).
- `townhouse node add` lazy provisioning (TH-21.17.7–.13).
- **Mill ships here** as the "5x earnings unlock" upsell. Reframe: Mill is the *earnings multiplier*, not a peer feature.
- Mary's evidence work (§8) MUST land before v0.5 kickoff.

### v1.0 — Public launch
- Marketing claim **gated by pilot data** (validation forks below).
- DVM opt-in available.
- Non-goals doc signed off (§9).

### Validation forks (formal — Murat instrumentation feeds this)
At pilot day-30, compute median weekly USDC across 5 operators (`earnings.apex.usdcCents + sum(earnings.perPeer.usdcCents)`):

| Median Week-4 Earnings | Action |
| --- | --- |
| **≥ $1.00/wk** | Ship full earnings hero. Marketing: "Earn passive USDC from your homelab." |
| **$0.10–$1.00/wk** | Demote earnings panel. Hero becomes "events relayed + earnings sub-counter." Marketing: "Run yields, be early." |
| **< $0.10/wk** | **Delay public launch.** Earnings UI secondary. Hero pivots to "events relayed + uptime." Marketing: "Be early to the network." |

Decision + raw data committed to `_bmad-output/v0.1-pilot-results.md`. Public, auditable.

---

## 3. Story List (14 stories, dependency-ordered)

| # | ID | Title | Deps | Size | Critical Path |
| --- | --- | --- | --- | --- | --- |
| 1 | **TH-21.17.1** | `chore(ci): multi-arch image publish workflow` | — | L | ★ |
| 2 | **TH-21.17.2** | `feat(townhouse): embed compose templates + image-manifest` | 1 | M | ★ |
| 3 | **TH-21.17.3** | `refactor(townhouse): DockerOrchestrator profile param` | 2 | S | |
| 4 | **TH-21.17.4** | `feat(connector): admin endpoint for HS hostname` *(upstream PR — see §7)* | — | S | |
| 5 | **TH-21.17.5** | `feat(townhouse): hs up subcommand (apex-only boot)` | 2,3,4 | M | ★ |
| 6 | **TH-21.17.6** | `feat(townhouse): nodes.yaml schema + reconciler` | 5 | M | ★ |
| 7 | **TH-21.17.7** | `feat(townhouse-api): POST/DELETE /api/nodes` | 6 | M | |
| 8 | **TH-21.17.8** | `feat(cli): node add/remove subcommands` | 7 | S | |
| 9 | **TH-21.17.9** | `feat(sdk): getEarnings() wrap + canary + contract test` | — | S | |
| 10 | **TH-21.17.10** | `refactor(townhouse-api): aggregator earnings surgery` | 9 | M | |
| 11 | **TH-21.17.11** | `feat(townhouse-api): hourly snapshot writer` | 10 | M | |
| 12 | **TH-21.17.12** | `feat(townhouse-api): GET /api/earnings` | 11 | S | |
| 13 | **TH-21.17.13** | `feat(tui): Ink scaffold + earnings header + peer table + ticker` | 12 | L | ★ |
| 14 | **TH-21.17.14** | `feat(townhouse): telemetry instrumentation (TOON pulse)` | — | M | ★ (v0.1 gate) |

**Critical path (v1 ship):** 1 → 2 → 5 → 6 → 13. Plus 14 must land before v0.1 pilot recruitment fires.
**Parallelizable:** 4 + 9 + 14 run alongside 1–3.
**Highest slip risk:** **TH-21.17.1** (multi-arch CI + cosign + matrix manifest fanout). Budget 2× nominal estimate.

### Cross-story acceptance criteria (locked)

- **TH-21.17.6 AC:** `nodes.yaml` entries expose `peerId: string` matching connector's `peerId` byte-for-byte. Migration covers historical `ilpAddress`/`peerPubkey` fields.
- **TH-21.17.7 AC:** Provisioning pipeline writes `nodes.yaml` **before** connector registration (`POST /admin/peers`). Drift window resolves in the safe direction (peer in nodes.yaml but not yet registered = harmless).
- **TH-21.17.13 merge gate:** does not merge without `_bmad-output/design/empty-state-copy.md` populated, reviewed by Sally, signed off in PR description. **(Sally's hill — empty-state copy is not a follow-up ticket.)**
- **TH-21.17.14:** Telemetry zod payload accepts `'external'` in `perPeer[].type` literal union (handles legitimate non-Townhouse peers that connect through the operator's connector).

---

## 4. Architecture Anchors

- **Single source of truth for earnings = the connector.** Children (`packages/town/src/town.ts`, `packages/mill/src/mill.ts`) expose ONLY `/health`. Adding `/earnings` to children = reconciliation hell. **Do not add it.**
- **Townhouse owns its time-series.** Connector returns lifetime cumulative; townhouse snapshots hourly to `~/.townhouse/earnings-snapshots.jsonl` and computes today/month/year deltas locally. No upstream coupling.
- **Layering rule.** Connector is a generic ILP router. It does NOT learn `'town' | 'mill' | 'dvm'`. Townhouse owns the `type` concept via `packages/townhouse/src/registry/peer-type-resolver.ts` — an in-memory `Map<peerId, NodeType>` rebuilt on `nodes.yaml` change, returning `'external'` on miss.
- **Apex idle state is useful.** Connector + host API + HS with zero peers = a reachable, payable identity on the network. Maya can receive a payment to her HS before running a single peer.
- **No Docker socket inside the connector container.** Host-side `townhouse-api` (Fastify) owns `dockerode` and runs as the host user. Connector container never sees `/var/run/docker.sock`.
- **CLI is a thin client of the host API.** Same code path serves both terminal and any future SPA/Tauri surface.

---

## 5. TUI Design — Metric List & Layout

### Three tiers of metrics

**HERO (1 number, the screenshot moment).** `MONTH $X.XX USDC` — computed delta from snapshots.

**TOPLINE (always visible, ~8 row budget):**
- Hero band (3 rows): `TODAY · MONTH · YEAR · LIFETIME` + 7d sparkline
- Apex routing-fee strip (1 row): `↳ apex routing: $X.XX (Y%)` — `connectorFees[]`
- Per-peer table (3–4 rows, scrollable): `peer · status · asset · net 7d · last claim · spark`
- Activity ticker footer (1 row): rolling settlements from `recentClaims[]`

**DRILL (subcommands):** `townhouse channels`, `townhouse metrics`, `townhouse logs`, `townhouse peer <id>`, `townhouse health`. Peer count, channel count, uptime, packet counters, hostname → drill only.

### Empty-state hero (qualifier dies once dollars exist)
- Empty: `MONTH $0.00 · 47 events relayed · you're early`
- Live: `MONTH $14.32 · ↑ $2.10 vs last week`

### "You're early" badge
Appears when `lifetime < $1.00 OR uptime < 7d`. Disappears silently after first `$1` lifetime. Text rotation: "you're early," "warming up," "first packet en route."

### 80×24 stress test (iPhone Termius baseline)
Layout fits at 80 cols. Order of degradation as columns shrink: **sparklines collapse first** (decorative); **asset rows last** (load-bearing). At 80 cols: hero band 4 rows + peer table 4 rows + ticker 1 row + borders 4 rows = 13 rows committed, 11 free.

### Authoritative metrics catalog (data → source)

| TUI Metric | Source | Field | Notes |
| --- | --- | --- | --- |
| MONTH earned (USDC) | computed | snapshot delta of `peers[].byAsset[].claimsReceivedTotal` | hourly delta job; assetCode=USDC filter |
| Apex routing fees | `/admin/earnings.json` | `connectorFees[].total` | filter assetCode=USDC |
| Per-peer last claim | `/admin/earnings.json` | `peers[].byAsset[].lastClaimAt` | format relative ("3m ago") |
| Events relayed | `/admin/metrics.json` | sum of `peers[].packetsForwarded` | NOT settlement count |
| Peer count | `/admin/peers` | `peers.length` | drill only |
| Uptime | `/admin/earnings.json` | `uptimeSeconds` | drill only |
| Activity ticker | `/admin/earnings.json` | `recentClaims[]` | last 50, ring-buffered |
| HS hostname | `/admin/hs-hostname` | `hostname` | header — gated on TH-21.17.4 |
| Child node phase | per-node `/health` | `phase` | per-row in peer table |
| Channel state | `/admin/channels` | full payload | drill only |

### Cut from v1 entirely
Leaderboards, network-wide stats, per-event sparkline, historical heatmap, fiat ticker, per-claim animation, notifications, terminal-resize testing, color customization, theme API.

### Design artifacts (Sally — must land alongside engineering)
1. `_bmad-output/design/townhouse-tui-wireframe.md` — formalized ASCII grid + Ink color tokens + degrade rules → unblocks TH-21.17.13
2. `_bmad-output/design/empty-state-copy.md` — every zero state, every wait state → **merge gate on TH-21.17.13**
3. "You're early" badge spec → unblocks TH-21.17.13
4. Onboarding ribbon spec for `townhouse hs up` → unblocks TH-21.17.5 polish
5. Failure-state copy library (anon timeout, image pull, port collision, missing docker.sock) → unblocks error paths
6. Activity overlay spec (modal dimensions, j/k scroll, q close, 200-row buffer) → unblocks TH-21.17.13
7. Per-asset row layout (USDC-evm vs USDC-sol stacking) → unblocks v0.5+ Mill multi-chain

---

## 6. Telemetry Instrumentation Spec (TH-21.17.14)

Story owner: Murat. Rationale: validation gate cannot fire without instrumentation; story lands **before pilot recruitment**.

### Endpoint
- `POST https://telemetry.toon-protocol.dev/v1/townhouse-pulse`
- Let's Encrypt SSL, behind Cloudflare for DDoS + IP stripping
- Cadence: every 7 days from operator first-boot, jittered ±6h

### Payload (zod-validated, schemaVersion=1)
```ts
{
  schemaVersion: 1,
  operatorIdHash: string,           // sha256(operatorPubkey + STATIC_SALT)
  townhouseVersion: string,         // npm version
  weekNumber: number,               // weeks since first boot
  enabledNodes: ('town' | 'mill' | 'dvm')[],
  earnings: {
    apex: { usdcCents: number },
    perPeer: { type: 'town' | 'mill' | 'dvm' | 'external', usdcCents: number }[]
  },
  metrics: {
    eventsRelayed: number,
    uptimeSeconds: number,
    peerCount: number
  },
  flags: {
    isTestnet: boolean,
    chainProfile: 'localnet' | 'akash-devnet' | 'sepolia' | 'mainnet'
  }
}
```

### Privacy guarantees (no PII)
No IP (Cloudflare strips), no hostname, no `.anyone` address, no wallet pubkey unhashed, no claim IDs, no peer counterparty pubkeys.

### Opt-in flow
- First-boot prompt during `townhouse init`: `"Help us improve Townhouse by sending anonymous earnings stats? [Y/n]"`
- **Pilot operators: opt-in REQUIRED** — Mary makes this explicit during recruitment. This is the validation dataset, not a normal opt-in.
- State at `~/.townhouse/telemetry.json`: `{ optedIn, firstBootAt, lastPingAt, pendingPings: [] }`
- Runtime control: `townhouse telemetry on|off|status`

### Disclosure copy (Mary, locked)
> "You're joining the v0.1 pilot. Townhouse will send anonymous earnings telemetry (peer-id hash, USDC/day, uptime — no IP, no wallet) so we can validate the economics before public launch. This is required for pilot participation. Type 'agree' to continue."

### Test layers (Murat)
- **Unit** (`packages/townhouse/src/telemetry/__tests__/`): zod round-trip, hash determinism, opt-out hard-stop (HTTP client never instantiated when `optedIn=false`)
- **Integration** (`packages/townhouse/__integration__/telemetry.test.ts`): `MockTelemetryServer` Fastify fixture — assert ping fires on schedule, opt-out sends zero, retry-buffer flushes on recovery
- **Production:** Grafana dashboard counting weekly active pings; alert on >30% week-over-week drop

### Server-side risk
Telemetry server is TOON-owned infra and a single point of failure for the validation signal. Mitigation: **local retry-buffer** — POST failure → store in `pendingPings[]`, retry with exponential backoff (1h, 4h, 1d, 3d), drop after 4 weeks. Operators never block on telemetry.

---

## 7. Connector Upstream Work

Total: **1 code PR + 1–2 verify-PRs + 1 doc PR**. All before townhouse v0.1 tag.

| ID | Title | Owner | Size | Blocking |
| --- | --- | --- | --- | --- |
| **CR-1** | feat(admin): `GET /admin/hs-hostname` endpoint | Amelia | ~80 LOC + tests | v0.1 (kills `dockerode exec` shellout) |
| **CR-2** | ci: verify multi-arch (amd64+arm64) image publish | Amelia | ~10 LOC YAML if missing | arm64 operators (Apple Silicon, RPi 5) |
| **CR-3** | ci: cosign keyless OIDC signing | Amelia | small workflow PR | townhouse v1.0 publish gate |
| **CR-4** | docs: `CONNECTOR_RELEASE_CONTRACT.md` (both repos) | Amelia | doc only | Cross-repo drift hygiene |

### CR-1 spec (frozen)
- **Path:** `GET /admin/hs-hostname`
- **Response (200):** `{ hostname: string | null, ready: boolean, publishedAt: string | null }`
- `hostname` null until anon publishes; `ready=false` during 30–90s bootstrap window; `publishedAt` ISO-8601 set on first successful read
- **503 with `{ error: "anon-disabled" }`** if anon not configured
- **Source:** connector reads `/var/lib/anon/hs/hostname` once on bootstrap-success, caches in process state, re-reads on SIGHUP
- **File:** `src/http/admin-api.ts` (mirrors existing routes — see `dist/http/admin-api.js:1030` for `/admin/earnings.json` pattern)
- **Tests:** new fixture in connector contract suite + townhouse-side canary at `packages/sdk/tests/integration/connector-contract.test.ts`

### CR-4 — release contract (rules)
- `/admin/*` field **additions** = minor bump
- `/admin/*` field **renames or removals** = major bump
- ILP packet wire-format changes = major bump
- Townhouse pins by digest in `image-manifest.json`, bumps deliberately on each minor

### Image-publish coordination (correction to TH-21.17.1)
Connector image is **already published upstream** by `connector/.github/workflows/build-and-publish.yml` to `ghcr.io/toon-protocol/connector` on every `v*` tag. Townhouse must NOT republish.

**TH-21.17.1 AC update:**
- `image-manifest.json` includes `connector: ghcr.io/toon-protocol/connector@sha256:<digest>` (upstream-published, consume by digest)
- Townhouse CI publishes only **four** images: `townhouse-api`, `town`, `mill`, `dvm`
- Digest pin updated via PR to townhouse repo when consuming a new connector release

### Explicitly NOT asking the connector team for
| Rejected request | Reason |
| --- | --- |
| Node-type field on peers (`'town'\|'mill'\|'dvm'`) | Layering violation. Connector is generic ILP router. |
| Per-node-type endpoints | Same — connector stays generic. |
| Per-asset `bytesSent` in metrics | Cut from v1 metric list (Sally). Defer. |
| Time-windowed earnings endpoints | Townhouse owns its own time-series via hourly snapshots. |
| Forecast / estimated-earnings endpoint | Punt to v2. |

### Single biggest cross-repo risk for v1
Connector ships v3.4.0 with backwards-incompatible admin-API drift between digest-pin time and townhouse v0.1 ship. Mitigation triple: (a) `connector-contract.test.ts` canary already in place, (b) `CONNECTOR_RELEASE_CONTRACT.md` from CR-4, (c) townhouse repo subscribes to connector release notifications.

---

## 8. Research Schedule & Pilot Recruitment (Mary)

### Evidence work — 4-week schedule (locked)
v0.5 kickoff lands ~week of 2026-07-02. Working backwards:

| Week ending | Deliverable |
| --- | --- |
| **2026-05-14** | r/selfhosted + r/dePIN keyword scrape (terms: "Akash provider," "Storj node," "idle homelab," "passive income $," "USDC payout"). Output: segment-size memo with post counts, active-author counts, verdict on which subreddit Drew lives in. |
| **2026-05-21** + **2026-05-28** | 5 operator interviews. Composition: 2 Akash providers, 2 Storj operators, 1 Helium/Saturn operator. Interview guide drafted by 2026-05-15; recruitment DMs out 2026-05-16; synthesis memo by 2026-05-28. |
| **2026-06-04** | Non-goals doc circulated for team sign-off. Three explicit nots: "v1 will not optimize for Maya. v1 will not denominate in sats. v1 will not promise greater than $10/month Year-1 earnings." |

### Pilot recruitment — 5 Drews
**Channels (3, ranked):**
1. Akash provider Discord `#provider-help`
2. r/selfhosted weekly recruitment thread
3. Existing TOON Protocol Nostr followers

**Skipped for v0.1:** HN Show HN comments, Saturn-operator DMs (too cold/slow). Re-add Saturn DMs as escalation channel if confirmed count <3 by 2026-06-05.

**Calendar:**
- 2026-05-22 — recruitment post template drafted
- 2026-05-25 — outreach launches
- **2026-06-12 — five-confirmed milestone target**

---

## 9. Test & Quality Strategy (Murat)

### Risk-ranked v1 gaps
| Risk | L×I | Coverage |
| --- | --- | --- |
| Lazy provisioning rollback on partial failure | 4×5=20 | State-machine table tests with injected failures + assertion that nodes.yaml + connector peers are byte-identical to pre-add state |
| Earnings delta arithmetic (DST, year boundary, corruption) | 5×4=20 | Property-based tests (fast-check): `sum(deltas) == final − initial`, monotonicity. Plus 9500-entry fixture replay (read perf <100ms, file <2MB). Plus mid-write truncation recovery test. |
| Reconciler drift at boot (nodes.yaml ↔ connector peers) | 4×4=16 | Integration test with seeded mismatched state, assert convergence direction documented + deterministic |
| Digest-pinned image mismatch | 3×5=15 | Image-contract test must run against the *digest currently pinned in townhouse source*, not `:latest` |
| Anon HS bootstrap timeout handling | 4×3=12 | Probe-injection via `MockAnonBinary` — never 90s in CI |

### Critical fixtures (build first)
- `MockEarningsConnector` — realistic claim shapes, configurable rate
- `MockAnonBinary` — stub binary, configurable bootstrap delay, injectable via env var
- `InProcessDockerStub` — implements the dockerode subset townhouse uses; real Docker only in `townhouse-test-infra.sh` nightly
- `EarningsSnapshotFixtures` — 13-month files including corrupted, truncated, DST-spanning, cross-year cases

### Contract testing
**Defend the shape-assertion canary.** Pact is overkill for one consumer + one provider in a synced monorepo. Trade-off accepted: canary won't catch *semantic* drift (field renamed but old field zeroed). Mitigation: extend canary to assert non-zero values under known-good fixture load. Revisit Pact when a third consumer appears.

### TUI testing
- **Test:** data → render mapping, keybind → state transitions, error states
- **Don't test:** terminal resize, color output, animation timing
- Tools: `ink-testing-library` + snapshot-on-state-transition. ~70% TUI logic testable; rest is visual QA.

### Pre-publish quality gates (all green or no `npm publish`)
1. Unit + integration green
2. Connector contract canary green against pinned digest
3. Image-contract test green against pinned digest
4. `townhouse-test-infra.sh` real-CLI E2E green
5. Playwright `e2e:real` green
6. Cosign signature verification on pinned image (gates on CR-3)

---

## 10. Decisions Log

| Round | Decision | Rationale |
| --- | --- | --- |
| 1–2 | Pre-built ghcr images, digest-pinned | Operators never `docker compose build` |
| 3 | Apex-only at install, lazy node provisioning | Idle apex is a reachable payable identity; node-type adds are operator-driven |
| 4–5 | Ink TUI primary surface (not ratatui, not Tauri) | TS-native, zero new toolchain. ratatui rejected for parallel build pipeline cost. Tauri deferred — Maya is not v1's persona |
| 5 | v1 = homelab Drew, not hobbyist Maya | Self-hosters fund projects; Maya's product is a different binary in v2 |
| 6 | USDC denomination, not sats | Blue Ocean exit from Bitcoin-maxi competitive set. Comp set becomes Akash/Storj/Helium |
| 6 | Town as default node, Mill/DVM opt-in | Town has the recognizable JTBD (paid Nostr relay). Mill is the "5x earnings" upsell |
| 7 | Two-bucket earnings display: apex routing fees + per-peer | Maps 1:1 to connector data model. Drew's mental model: "connector earned $X routing, town earned $Y relaying" |
| 7 | Children stay health-only; connector is single source of truth for earnings | Adding `/earnings` to children = reconciliation hell |
| 7 | Townhouse owns its own time-series via hourly snapshots | Avoids cross-team coupling for windowed endpoints |
| 9 | Validation forks formalized at $1.00 / $0.10 / <$0.10 weekly | Honest small numbers > marketing fiction. <$0.10 = delay launch |
| 10 | Connector stays generic ILP router (no node-type knowledge) | Layering rule — Townhouse owns the `type` concept |
| 11 | Townhouse consumes connector image by digest, doesn't republish | Connector repo already publishes upstream |

---

## 11. Non-Goals (v1 — explicit cuts)

- Tauri/Electron desktop wrapper
- ratatui (Rust) TUI rewrite
- Web SPA polish beyond `127.0.0.1:28090` placeholder
- Mill/DVM as default-on nodes
- Multi-tenant earnings (single-operator only)
- Auto-update / image-pull-on-boot
- Leaderboards, network-wide stats, per-event animation, fiat ticker, notifications
- Optimizing for "Maya" (the laptop hobbyist persona)
- Sats-denominated earnings display (`townhouse status --units=sats` exists as undocumented flag only)
- Promising earnings >$10/month Year-1
- Marketing copy claiming earnings without 30-day pilot validation
- Per-node-type endpoints on the connector
- Forecast/estimated-earnings endpoint
- Per-asset `bytesSent` metric

---

## 12. Open Threads (next planning round)

- **Connector release subscription mechanism** — who owns watching `toon-protocol/connector` releases for digest-bump PRs?
- **Telemetry server hosting** — whose Cloudflare account, whose domain (`telemetry.toon-protocol.dev`), Grafana hosting?
- **Pilot operator NDA / agreement** — do pilots sign anything, or is the telemetry opt-in the only contract?
- **v0.5 Mill economics** — what's the expected earnings lift from Mill enable? Mary's research must include "would you pay slippage to enable Mill if it 5×'d your monthly?" question.

---

## 13. Index of Linked Artifacts

- This plan: `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`
- Pilot results (post-v0.1): `_bmad-output/v0.1-pilot-results.md` *(to be created)*
- Design artifacts (Sally): `_bmad-output/design/townhouse-tui-wireframe.md`, `empty-state-copy.md` *(to be created)*
- Non-goals doc (Mary, due 2026-06-04): `_bmad-output/planning-artifacts/townhouse-v1-non-goals.md` *(to be created)*
- Connector upstream issue (CR-1): GitHub `toon-protocol/connector` *(filed alongside this plan)*
- Existing connector contract canary: `packages/sdk/tests/integration/connector-contract.test.ts`
- Existing connector migration history: `packages/sdk/CONNECTOR_MIGRATION.md`
- Existing townhouse README: `packages/townhouse/README.md` (HS-mode section)
