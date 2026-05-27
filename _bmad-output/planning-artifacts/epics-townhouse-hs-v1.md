---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md
scope: townhouse-hs-mode-v1
parentEpic: epic-21-townhouse
note: |
  This document is scoped to the Townhouse HS-Mode v1 epic only. The canonical
  `_bmad-output/planning-artifacts/epics.md` covers the broader project epic
  decomposition (TOON SDK, BLS, relay, etc.) and is referenced by 35+ test/
  implementation artifacts; that file is intentionally left untouched. This
  scoped file follows the same template structure for the HS-mode v1 work.

  Path B was selected on activation: the planning doc serves as the input
  source (combining what would normally be PRD + Architecture). Epic 21 was
  excluded as a redundant input — its shipped scaffolding is referenced
  implicitly via "extend existing" language throughout v1 stories.
---

# Townhouse HS-Mode v1 — Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for **Townhouse HS-Mode v1** — a single-command, host-native operator experience for running a TOON Protocol node behind an Anyone Protocol hidden service on a homelab box. The v1 narrows Epic 21's broader townhouse vision around a specific persona (homelab DePIN-tinkerer "Drew"), surface (Ink TUI), denomination (USDC), and validation gate (no public launch unless 30-day pilot data supports the earnings story).

The decomposition below derives requirements from the consolidated planning doc that emerged from an 11-round party-mode roundtable with Mary (BA), John (PM), Winston (Architect), Amelia (Engineer), Sally (UX), Murat (Test Architect), and Victor (Innovation Strategist).

> **Scope Note:** This document covers Townhouse HS-Mode v1 only. Stories below assume Epic 21's shipped scaffolding (`packages/townhouse/` package, CLI entrypoint, `DockerOrchestrator`, HD wallet manager, Fastify host API on `127.0.0.1:28090`) exists. v1 work *extends* Epic 21 — it does not re-implement it.

## Requirements Inventory

### Functional Requirements

**Install & Apex Boot**

- **FR1:** The system SHALL provide a single-command install via `npx @toon-protocol/townhouse hs up` that boots the apex (connector + host API + `.anyone` hidden service) without prior operator configuration
- **FR2:** The system SHALL ship pre-built, multi-arch (linux/amd64 + linux/arm64), digest-pinned container images via GHCR for `townhouse-api`, `town`, `mill`, `dvm` — the connector image SHALL be consumed by digest from upstream `toon-protocol/connector`, NOT republished
- **FR3:** The system SHALL embed Docker Compose templates in the npm tarball and write them to `~/.townhouse/compose/townhouse-hs.yml` on first run, eliminating any need for operators to clone the source repo
- **FR4:** The system SHALL boot apex-only at install — connector + host API + `.anyone` HS — with zero child nodes started, providing a reachable payable identity at idle
- **FR5:** The system SHALL render the published `.anyone` hostname as the final stdout line of `townhouse hs up` and persist it to `~/.townhouse/host.json`
- **FR6:** Subsequent `townhouse hs up` invocations against an already-running apex SHALL be idempotent (re-print hostname, exit 0, no re-pull, no volume recreation)
- **FR7:** `townhouse hs down` SHALL stop the apex while preserving the `townhouse-hs-anon` volume so the `.anyone` address is stable across restarts; `townhouse hs down --rotate-keys` SHALL delete the volume to rotate the address

**Lazy Node Provisioning**

- **FR8:** The system SHALL provide `townhouse node add <town|mill|dvm>` to lazily provision child nodes via the strict pipeline: derive HD wallet key → pull pinned image → write `nodes.yaml` entry → start container → wait for `/health` → register with connector `POST /admin/peers`
- **FR9:** The system SHALL provide `townhouse node remove <id>` to lazily deprovision in reverse order: deregister with connector → stop container → remove `nodes.yaml` entry
- **FR10:** The system SHALL persist operator-declared node intent in `~/.townhouse/nodes.yaml` as the source of truth, with the connector's peers list treated as derived state
- **FR11:** The system SHALL run a boot-time reconciler that diffs `nodes.yaml` against connector `/admin/peers` and converges connector state to the yaml (yaml wins; logs every divergence to `~/.townhouse/reconciler.log`)
- **FR12:** Default node selection SHALL be Town only; Mill and DVM SHALL be opt-in via explicit `townhouse node add mill|dvm` invocation
- **FR13:** Provisioning failure at any pipeline step SHALL roll back atomically in reverse order so `nodes.yaml` and connector peers list end in a state byte-identical to the pre-add state
- **FR14:** Each CLI verb SHALL have a `--json` twin emitting machine-readable output for scripting

**Earnings Data Plane**

- **FR15:** The system SHALL consume connector earnings data exclusively via `GET /admin/earnings.json` (already exposed in connector v3.3.3) — child nodes SHALL NOT expose earnings endpoints
- **FR16:** The townhouse-api SHALL persist hourly cumulative-claims snapshots to `~/.townhouse/earnings-snapshots.jsonl` (append-only) and compute TODAY/MONTH/YEAR/LIFETIME deltas locally
- **FR17:** The system SHALL provide a `peer-type-resolver` that maps `peerId` → `'town' | 'mill' | 'dvm' | 'external'`, rebuilt on `nodes.yaml` change, returning `'external'` for unmatched peers (legitimate non-Townhouse peers connecting through the operator's connector are NOT dropped)
- **FR18:** The host API SHALL expose `GET /api/earnings` returning `{apex: {routingFees: PerAsset}, peers: NodeEarnings[], recentClaims: [], eventsRelayed: number, uptimeSeconds: number}` with per-asset breakouts NOT collapsed to USD-equivalent

**Operator Surface (TUI)**

- **FR19:** The system SHALL display an Ink-based TUI as the default operator surface when stdout is a TTY; the host SPA at `http://127.0.0.1:28090` SHALL be available but NOT auto-launched
- **FR20:** The TUI hero metric SHALL be `MONTH $X.XX USDC` (the screenshot moment); the hero band SHALL also show TODAY/YEAR/LIFETIME and a 7-day sparkline
- **FR21:** The TUI SHALL display two distinct earnings buckets: an apex routing-fee strip (`↳ apex routing: $X.XX`) showing `connectorFees[]` data, and a per-peer table showing per-peer claim data
- **FR22:** When `apex.routingFees == 0` AND no Mill is enabled, the routing-fee strip SHALL show `(enable mill to route)` as an upsell hint
- **FR23:** When earnings == 0, the hero SHALL show qualifier `MONTH $0.00 · N events relayed · you're early`; the qualifier SHALL vanish when there's a non-zero dollar number
- **FR24:** The TUI SHALL display a "you're early" badge when `lifetime < $1.00 OR uptime < 7d`, rotating copy among "you're early" / "warming up" / "first packet en route"; the badge SHALL disappear silently after the first $1 lifetime
- **FR25:** The TUI SHALL provide an activity-ticker footer showing the most recent `recentClaims[]` event with relative timestamp
- **FR26:** Pressing `[a]` SHALL open a scrollable Activity overlay (modal, j/k scroll, q close, 200-row ring buffer)
- **FR27:** The TUI SHALL refresh on a 2-second tick (kubectl-top class) with silent updates — no animations, no chimes, no slot-machine effects
- **FR28:** Drill-down details SHALL be served as separate CLI verbs (out of TUI scope): `townhouse channels`, `townhouse metrics`, `townhouse logs`, `townhouse peer <id>`, `townhouse health`
- **FR29:** `townhouse status --units=sats` SHALL exist as an undocumented power-user flag for sats-denominated display; USDC remains the canonical hero display

**End-to-End TOON-Client → Townhouse HS Loop (Epic 49 — re-scoped 2026-05-18)**

- **FR30:** A TOON client running on a foreign host SHALL be able to target a Townhouse operator's `.anyone` HS endpoint as its relay (`relay=<hostname>.anyone`) and publish a Nostr event over the established anon transport
- **FR31:** The Townhouse operator's connector SHALL surface inbound events from foreign TOON clients via the existing drill subcommands (`townhouse drill channels`, `townhouse drill logs --tail`) — no new TUI surface is required
- **FR32:** When a foreign TOON client's ILP-paid packet settles, the resulting claim SHALL appear in the operator's earnings data plane (`townhouse drill metrics` AND `GET /api/earnings`) within 2 snapshot intervals
- **FR33:** The earnings delta observed across one settlement loop SHALL equal the settled claim amount within 1 USDC-cent rounding tolerance — no silent drops, no double-counting; non-Townhouse callers bucket as `'external'` per Epic 47's peer-type resolver
- **FR34:** A live E2E gate script (`scripts/townhouse-e2e-real-hs.sh`) SHALL exercise the full loop unattended against real `.anyone` transport (not `127.0.0.1` fixtures) and exit non-zero on any AC miss

> **Aggregated Pilot Telemetry (FR30–FR34 prior wording)** — the prior bullets (telemetry POST, zod payload, opt-in flow, `townhouse telemetry on|off|status`, retry buffer) were archived on 2026-05-18 to `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49-future: Aggregated Pilot Telemetry". Re-entry gated on N ≥ 10 opted-in operators.

**Cross-Repo (Connector Upstream)**

**SOL Settlement via Mill Routing (Epic 50 — added 2026-05-27)**

- **FR39:** When `townhouse node add mill` completes, `mill.config.json` SHALL be written with a non-empty `swapPairs` array containing at least one EVM-USDC → SOL-USDC entry — writing `swapPairs: []` (current behaviour) causes Mill to reject boot with `MillConfig.swapPairs MUST be a non-empty array`
- **FR40:** The EVM swap-pair `from.chain` SHALL be derived from the operator's active chain config (`config.chainProviders[0].chainId`, defaulting to `'31337'` for Anvil devnet); the SOL swap-pair `to.chain` SHALL default to `'solana:devnet'`; both SHALL be overridable via `nodes.yaml nodes.mill.chains`
- **FR41:** The generated swap pair SHALL include `assetCode: 'USDC'`, `assetScale: 6`, `rate: '1.0'`, `minAmount: '1000'`, `maxAmount: '1000000000'`; `chains: ['evm', 'solana']` SHALL replace the current `['evm']`-only entry
- **FR42:** The E2E gate harness (`townhouse-dvm-arweave-e2e.test.ts`) SHALL start a Mill container via `docker run -d --network townhouse-hs-net` (image from `dist/image-manifest.json` key `'mill'`) and confirm BLS health at `127.0.0.1:3200` within 60s
- **FR43:** The E2E gate SHALL discover Mill's pubkey and swap pair from a kind:10032 event subscribed on the apex relay, then drive a SOL-settlement ILP payment to `g.townhouse.mill` using `streamSwap` from `packages/sdk/src/stream-swap.ts`; the `StreamSwapResult` MUST have `status: 'success'`
- **FR44:** Post-swap, `GET ${HS_API}/api/earnings` SHALL return at least one claim entry with `type: 'mill'` within 150s (poll 5s interval); this entry SHALL be distinct from the EVM apex bucket
- **FR45:** Test 6 in `townhouse-dvm-arweave-e2e.test.ts` SHALL be promoted from BLOCKED-STRUCTURAL to a live PASS; `scripts/townhouse-e2e-real-hs.sh --chain=sol` SHALL run the SOL leg end-to-end

**Cross-Repo (Connector Upstream)**

- **FR35:** The connector SHALL expose `GET /admin/hs-hostname` returning `{hostname: string|null, publishedAt: string|null}` with 503 on `anon-disabled` configuration (CR-1) — eliminates the host-side `dockerode exec cat /var/lib/anon/hs/hostname` shellout. Consumers treat `hostname !== null` as the ready signal. *(Contract resolved via [connector#58](https://github.com/toon-protocol/connector/issues/58) review on 2026-05-07: the originally-proposed `ready` field was dropped as redundant with `hostname !== null`; ships in connector v3.5.0.)*
- **FR36:** The connector image build pipeline SHALL produce multi-arch `linux/amd64` AND `linux/arm64` images (CR-2)
- **FR37:** The connector image build pipeline SHALL cosign-sign published images via keyless OIDC (CR-3)
- **FR38:** Both repos SHALL publish and maintain `CONNECTOR_RELEASE_CONTRACT.md` defining semver discipline for `/admin/*` API stability (CR-4)

### NonFunctional Requirements

**Performance**

- **NFR1:** First-boot from cold image cache to apex-ready (`.anyone` hostname published — i.e., `GET /admin/hs-hostname` returns `hostname !== null`) SHALL complete within 5 minutes on a typical homelab connection (1.5GB pull + 30–90s anon bootstrap)
- **NFR2:** TUI refresh latency SHALL be ≤2s end-to-end (data fetch + render); rendering SHALL not block on slow API calls
- **NFR3:** Earnings snapshot read performance SHALL be <100ms for a 9500-entry fixture (13 months of hourly snapshots)
- **NFR4:** Earnings snapshot file size SHALL stay under 2MB for the 9500-entry fixture

**Security & Privacy**

- **NFR5:** The Epic 49 live E2E gate SHALL run against real `.anyone` transport (NOT a `127.0.0.1` substitute or in-process loopback). Prior NFR5 ("telemetry payload no PII") archived with the Epic 49 re-scope on 2026-05-18 (see deferred-work.md).
- **NFR6:** The Epic 49 live E2E gate SHALL run on CI `workflow_dispatch` only (manual trigger) — not on every PR. Real `.anyone` bootstrap (~60–120s/side) is too slow for PR-time. Prior NFR6 ("Cloudflare + Let's Encrypt on telemetry server") archived with the Epic 49 re-scope.
- **NFR7:** The connector container SHALL NOT mount or have access to `/var/run/docker.sock`; only the host-side `townhouse-api` Fastify process owns the socket
- **NFR8:** All operator-secret files SHALL be written with mode `0o600`: `nodes.yaml`, `earnings-snapshots.jsonl`, `wallet.enc`, `host.json` (`telemetry.json` retired with Epic 49 re-scope; returns with Epic 49-future)
- **NFR9:** All host-side ports SHALL bind to `127.0.0.1` only — never `0.0.0.0`

**Reliability**

- **NFR10:** Across one full Epic 49 settlement loop, the earnings reconciliation tolerance SHALL be ≤ 1 USDC-cent (`|earnings_delta − claim_amount| ≤ 1¢`). Prior NFR10 ("telemetry retry buffer") archived with the Epic 49 re-scope.
- **NFR11:** Earnings snapshot write SHALL recover from mid-write truncation — next boot reads to the last well-formed JSONL line without crashing
- **NFR12:** Earnings snapshot retention SHALL be ≥13 months for YEAR-over-YEAR delta computation across calendar boundaries

**Compatibility**

- **NFR13:** TUI SHALL render correctly at 80×24 (iPhone Termius baseline); column degradation order: sparklines collapse first, asset rows last
- **NFR14:** TUI SHALL be tmux-compatible — never `clear()` the full screen, respect `$TMUX`, leave operator pane geometry alone
- **NFR15:** The townhouse package SHALL run on Node.js >= 20 with TypeScript ^5.3 and ESM-only modules
- **NFR16:** Connector v3.5.0 (carrying CR-1; current connector main is v3.4.2 post-#57) SHALL maintain backward compatibility with the townhouse-pinned admin API surface — only `/admin/*` field additions are permitted; renames or removals require a major bump

**Quality Gate**

- **NFR17:** Pre-publish quality gate SHALL require all of: unit + integration green, connector contract canary green at the digest pinned in source (NOT `:latest`), image-contract test green at pinned digest, real-CLI E2E green via `scripts/townhouse-test-infra.sh`, Playwright `e2e:real` green, cosign signature verification green
- **NFR18:** The Epic 49 live E2E gate SHALL exit with a PASS/FAIL code; non-zero on any AC miss, with relevant connector + drill logs captured to `./e2e-real-hs-logs/<timestamp>/`. Prior NFR18 ("median-weekly-USDC validation fork") archived with the Epic 49 re-scope.
- **NFR19:** Empty-state copy library SHALL ship in the same PR as the TUI scaffold story — not as a follow-up ticket

**SOL Settlement via Mill Routing (Epic 50 — added 2026-05-27)**

- **NFR20:** Mill container launched by the E2E harness SHALL be stopped and removed in `afterAll` alongside DVM and HS containers — no orphaned containers on test failure or early exit
- **NFR21:** The swap pair written by `townhouse node add mill` SHALL pass Mill's own `startMill()` validation (`MillConfig.swapPairs MUST be a non-empty array`) with zero code changes to the Mill package itself
- **NFR22:** `pnpm --filter @toon-protocol/townhouse build` and `pnpm --filter @toon-protocol/townhouse test` SHALL both stay clean (0 new errors, 0 new failures) after the swap-pair provisioning change
- **NFR23:** SOL settlement test (Test 6) SHALL fail fast with a clear message if Akash Solana devnet (DSEQ 26996029) is unreachable at gate boot time — it SHALL NOT silently degrade to a local devnet fixture
- **NFR24:** Test 6 total timeout SHALL be ≥ 180s to account for Mill boot + kind:10032 discovery + SOCKS5 bootstrap + `streamSwap` packet RTT + Solana confirmation + earnings poll

### Additional Requirements

Derived from the planning doc's Architecture Anchors (§4) and Technology Stack constraints (project-context.md):

**Architectural Layering (load-bearing)**

- Single source of truth for earnings = the connector. Town/Mill/DVM expose ONLY `GET /health`. Adding `/earnings` to children would create reconciliation drift.
- Townhouse owns its time-series. Connector emits cumulative; townhouse snapshots locally and computes deltas. No cross-team coupling for windowed endpoints.
- Connector remains a generic ILP router. It SHALL NOT learn `'town' | 'mill' | 'dvm'` types. Townhouse owns the `type` concept via `packages/townhouse/src/registry/peer-type-resolver.ts`.
- Apex idle state is a feature: connector + host API + `.anyone` HS with zero peers = a reachable, payable identity on the network. The lazy-provisioning UX depends on this resting state being useful.
- CLI is a thin client of the host API. Both terminal and any future SPA/Tauri surface hit `127.0.0.1:28090` endpoints — one code path, multiple front-ends.

**Sequencing Constraints**

- `nodes.yaml` write happens BEFORE connector registration (`POST /admin/peers`). Drift window resolves in the safe direction: peer in yaml but not yet registered = harmless, reconciler catches it.
- Epic 49 live E2E gate (`scripts/townhouse-e2e-real-hs.sh`) SHALL run green on a published rc tag BEFORE pilot recruitment fires (Mary's 2026-05-25 outreach launch). Telemetry instrumentation deferred to Epic 49-future; pilot recruitment pitch revised independently (see deferred-work.md § "Open downstream questions").

**Technology Stack (project-wide constraints from `project-context.md`)**

- Runtime: Node.js >=20, TypeScript ^5.3 (strict + bundler resolution), pnpm 8.15.0, ESM-only
- Build tool: tsup ^8.0
- Test runner: vitest ^1.0 (NOT jest — jest is reserved for pet-circuit / o1js packages)
- HTTP framework: hono ^4.0 (BLS, Town, Attestation Server) and Fastify (townhouse host API, per Epic 21 D21-008)
- Identity: `@scure/bip39`, `@scure/bip32` for HD derivation; `@noble/curves` for secp256k1
- Connector dep: `@toon-protocol/connector` ^3.3.3 (bumps to ^3.4.0 once CR-1 ships)
- Container management: `dockerode` from host-native node process
- TUI framework: `ink` (TS-native — ratatui rejected for parallel build pipeline cost)
- Image registry: `ghcr.io/toon-protocol/<svc>` (multi-arch + cosign-signed)

**Cross-Repo Dependencies**

- This epic depends on connector PR CR-1 (v3.5.0+ shipping `GET /admin/hs-hostname`). Critical path for FR1, FR4, FR5.
- This epic depends on connector PRs CR-2 (multi-arch verify) and CR-3 (cosign signing). Both gate v1.0 publish.
- This epic delivers CR-4 (the release contract doc) to both repos.

**Telemetry Server Infrastructure (deferred — was open thread)**

- Telemetry endpoint hosting (`telemetry.toon-protocol.dev`), Cloudflare account, Grafana dashboard — open thread closed by Epic 49 re-scope on 2026-05-18. These owners are no longer blocking; they return with Epic 49-future (see deferred-work.md § "Epic 49-future: Aggregated Pilot Telemetry").

### UX Design Requirements

Derived from the planning doc §5 (TUI Design) and Sally's 7-deliverable list. Each is a distinct deliverable that must ship to unblock specific stories:

- **UX-DR1: TUI wireframe spec.** Markdown + ASCII reference grid at `_bmad-output/design/townhouse-tui-wireframe.md`. Pins column widths at 80ch and 120ch breakpoints, Ink color tokens (dim-grey for labels, green for positive net, amber for "early"), graceful degrade rules on no-truecolor terminals, resize behavior (collapse sparklines first, asset rows last). **Unblocks:** TH-21.17.13 (TUI scaffold).

- **UX-DR2: Empty-state copy library.** `_bmad-output/design/empty-state-copy.md`. Every zero state, every wait state, every loading state — written, reviewed, signed off. **Merge gate** on TH-21.17.13: TUI scaffold PR does not merge without this artifact populated and signed off in the PR description.

- **UX-DR3: "You're early" badge spec.** Visual treatment, text rotation rules ("you're early" / "warming up" / "first packet en route"), appearance triggers (`lifetime < $1.00 OR uptime < 7d`), disappearance rule (silent after first $1 lifetime). **Unblocks:** TH-21.17.13.

- **UX-DR4: Onboarding ribbon spec for `townhouse hs up`.** Three-line rolling status with ANSI spinner fallback for non-unicode terminals. Status sequence: `Pulling apex image · Bootstrapping hidden service (this takes 30–90s) · Apex live at <hostname>.anyone`. **Unblocks:** TH-21.17.5 polish.

- **UX-DR5: Failure-state copy library.** Plain-language explanations + actionable next step for each error class: anon timeout, image pull failure, port collision, missing docker.sock, EVM RPC unreachable, connector contract drift, telemetry server unavailable. **Unblocks:** error paths across TH-21.17.5, TH-21.17.7, TH-21.17.13.

- **UX-DR6: Activity overlay spec.** Modal layout (centered, 70% terminal width), keybindings (j/k scroll, q close), 200-row ring buffer, behavior on resize. **Unblocks:** TH-21.17.13 `[a]` overlay.

- **UX-DR7: Per-asset row layout.** How `USDC-evm` and `USDC-sol` (and future chains) stack as siblings under one peer row without operators thinking they are double-counted. Hero number sums across; rows below are honest per-asset breakouts. **Unblocks:** v0.5+ Mill multi-chain rendering.

### FR Coverage Map

Every functional requirement maps to exactly one epic. NFRs and UX-DRs may be cross-cutting; primary owner epic is named, secondary touchpoints noted in epic-level descriptions.

**Functional Requirements**

| FR | Epic | Description |
| --- | --- | --- |
| FR1 | Epic 45 | Single-command `npx ... hs up` install |
| FR2 | Epic 45 | Multi-arch GHCR images for townhouse-owned services (4 images, NOT connector) |
| FR3 | Epic 45 | Embed compose templates in npm tarball |
| FR4 | Epic 45 | Apex-only at install (idle = payable identity) |
| FR5 | Epic 45 | Render `.anyone` hostname as final stdout line (depends on Epic 44 CR-1) |
| FR6 | Epic 45 | `townhouse hs up` idempotent on running apex |
| FR7 | Epic 45 | `hs down` preserves volume; `--rotate-keys` deletes |
| FR8 | Epic 46 | `townhouse node add <type>` lazy provisioning pipeline |
| FR9 | Epic 46 | `townhouse node remove <id>` reverse-order deprovisioning |
| FR10 | Epic 46 | `nodes.yaml` is operator-managed source of truth |
| FR11 | Epic 46 | Boot reconciler converges connector peers to `nodes.yaml` |
| FR12 | Epic 46 | Default node = Town only; Mill/DVM opt-in |
| FR13 | Epic 46 | Atomic rollback on partial failure |
| FR14 | Epic 46 | Every CLI verb has `--json` twin |
| FR15 | Epic 47 | Connector `GET /admin/earnings.json` is exclusive earnings source |
| FR16 | Epic 47 | Hourly snapshots → today/month/year/lifetime deltas |
| FR17 | Epic 47 | `peer-type-resolver` with `'external'` fallback |
| FR18 | Epic 47 | `GET /api/earnings` two-bucket payload |
| FR19 | Epic 48 | Ink TUI default surface when stdout is TTY |
| FR20 | Epic 48 | Hero metric `MONTH $X.XX USDC` |
| FR21 | Epic 48 | Two-bucket display: apex routing fees + per-peer table |
| FR22 | Epic 48 | Empty apex bucket shows "(enable mill to route)" upsell |
| FR23 | Epic 48 | Empty-state hero qualifier (events relayed + you're early) |
| FR24 | Epic 48 | "You're early" badge with rotating copy |
| FR25 | Epic 48 | Activity ticker footer |
| FR26 | Epic 48 | `[a]` opens scrollable Activity overlay |
| FR27 | Epic 48 | 2-second silent refresh tick |
| FR28 | Epic 48 | Drill subcommands (`channels`, `metrics`, `logs`, `peer`, `health`) |
| FR29 | Epic 48 | `--units=sats` undocumented flag |
| FR30 | Epic 49 | TOON client publishes via Townhouse `.anyone` HS as relay endpoint (foreign client) |
| FR31 | Epic 49 | Connector surfaces inbound event/packet via existing drill subcommands |
| FR32 | Epic 49 | ILP-paid packet settles → earnings delta visible within 2 snapshot intervals |
| FR33 | Epic 49 | Earnings delta == settled claim amount ± rounding tolerance (no silent drops) |
| FR34 | Epic 49 | Live E2E gate (`scripts/townhouse-e2e-real-hs.sh`) runs full loop unattended |
| FR35 | Epic 44 | CR-1: connector `GET /admin/hs-hostname` |
| FR36 | Epic 44 | CR-2: connector multi-arch images |
| FR37 | Epic 44 | CR-3: connector cosign keyless OIDC signing |
| FR38 | Epic 44 | CR-4: `CONNECTOR_RELEASE_CONTRACT.md` (both repos) |

**Non-Functional Requirements**

| NFR | Primary Epic | Notes |
| --- | --- | --- |
| NFR1 | Epic 45 | 5-minute first-boot time-to-apex-ready |
| NFR2 | Epic 45 | Idempotent re-up |
| NFR3 | Epic 48 | TUI 2s refresh latency |
| NFR4 | Epic 47 | Snapshot read perf <100ms (9500-entry fixture) |
| NFR5 | Epic 49 | Live E2E gate uses real `.anyone` transport (no 127.0.0.1 fixtures) |
| NFR6 | Epic 49 | Gate runs on CI `workflow_dispatch` only (not per-PR; real anon bootstrap too slow) |
| NFR7 | Epic 45 | No docker.sock inside connector container |
| NFR8 | Cross-cutting (Epic 45, 3, 6) | All operator secrets at file mode 0o600 |
| NFR9 | Epic 45 | All host ports bind to 127.0.0.1 only |
| NFR10 | Epic 49 | Earnings reconciliation tolerance ≤ 1 USDC-cent across one settlement loop |
| NFR11 | Epic 47 | Snapshot mid-write truncation recovery |
| NFR12 | Epic 47 | Snapshot retention ≥13 months |
| NFR13 | Epic 48 | TUI renders correctly at 80×24 |
| NFR14 | Epic 48 | TUI tmux-compatible (no full-screen clears) |
| NFR15 | Cross-cutting | Node.js >=20, TypeScript ^5.3, ESM-only |
| NFR16 | Epic 44 | Connector v3.5.0 backward-compatible with v3.3.3+ admin API surface |
| NFR17 | Cross-cutting | Pre-publish quality gate (6 green checks) |
| NFR18 | Epic 49 | Gate emits PASS/FAIL exit code; non-zero on any AC miss |
| NFR19 | Epic 48 | Empty-state copy library ships in same PR as TUI scaffold |

**UX Design Requirements**

| UX-DR | Primary Epic | Notes |
| --- | --- | --- |
| UX-DR1 | Epic 48 | TUI wireframe spec |
| UX-DR2 | Epic 48 | Empty-state copy library (merge gate on TUI scaffold) |
| UX-DR3 | Epic 48 | "You're early" badge spec |
| UX-DR4 | Epic 45 | Onboarding ribbon for `townhouse hs up` |
| UX-DR5 | Cross-cutting (Epic 45, 3, 5) | Failure-state copy library |
| UX-DR6 | Epic 48 | Activity overlay spec |
| UX-DR7 | Epic 48 | Per-asset row layout (multi-chain stacking) |

## Epic List

### Epic 44: Connector Cross-Repo Surface

Connector operators (and through them, all consumers of `@toon-protocol/connector`) gain a clean HS-hostname admin API, multi-arch image builds, cosign-signed images via keyless OIDC, and a written semver discipline contract for the `/admin/*` API surface. This epic ships entirely in the `toon-protocol/connector` repo and the `CONNECTOR_RELEASE_CONTRACT.md` doc lands in both repos. Epic 45 depends on CR-1 to render the `.anyone` hostname cleanly without a `dockerode exec` shellout.

**FRs covered:** FR35, FR36, FR37, FR38
**NFRs:** NFR16
**UX-DRs:** —
**Tracking:** [toon-protocol/connector#58](https://github.com/toon-protocol/connector/issues/58) (CR-1)

### Epic 45: One-Command Apex Install

Drew runs `npx @toon-protocol/townhouse hs up` once and has a working hidden-service apex (connector + host API + `.anyone` HS) in under 5 minutes. The apex is a reachable, payable identity even with zero peer nodes — it can receive a payment to its `.anyone` address before any Town/Mill/DVM is enabled. `hs down` preserves the HS keypair so the address is stable across restarts; `--rotate-keys` is the explicit destructive opt-out. Image pulls are pre-built and digest-pinned via the embedded `image-manifest.json`; operators never `docker compose build` and never clone the source repo.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7
**NFRs:** NFR1, NFR2, NFR7, NFR9
**UX-DRs:** UX-DR4 (onboarding ribbon)
**Depends on:** Epic 44 (CR-1 for clean hostname surfacing)

### Epic 46: Lazy Peer Node Provisioning

Drew adds Town, Mill, or DVM nodes on demand via `townhouse node add <type>` — each invocation derives an HD wallet key, pulls the pinned image, writes a `nodes.yaml` entry, starts the container, waits for `/health`, and registers with the connector. `node remove` reverses the order. The operator's declared intent in `~/.townhouse/nodes.yaml` is the source of truth; the connector's peers list is derived state. A boot-time reconciler converges the two (yaml wins). Default behavior on first `node add` with no type is Town. Atomic rollback on any pipeline failure leaves both `nodes.yaml` and the connector peers list byte-identical to the pre-add state.

**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR13, FR14
**NFRs:** —
**UX-DRs:** UX-DR5 (failure-state copy, partial)
**Depends on:** Epic 45

### Epic 47: Earnings Data Plane

Drew can query his earnings programmatically via the host API at `GET http://127.0.0.1:28090/api/earnings` — apex routing fees and per-peer claims as separate buckets, with TODAY/MONTH/YEAR/LIFETIME deltas. Townhouse owns its time-series: hourly cumulative-claims snapshots persist to `~/.townhouse/earnings-snapshots.jsonl`, deltas computed locally, no upstream coupling for windowed endpoints. The `peer-type-resolver` maps connector `peerId` to `'town' | 'mill' | 'dvm' | 'external'` — non-Townhouse peers connecting through the operator's connector are bucketed as external, not dropped. This epic is API-only — power users on headless boxes can curl earnings before any TUI ships.

**FRs covered:** FR15, FR16, FR17, FR18
**NFRs:** NFR4, NFR11, NFR12
**UX-DRs:** —
**Depends on:** Epic 46

### Epic 48: Operator Dashboard (Ink TUI)

Drew opens a TUI (`townhouse hs up` when stdout is a TTY) showing the hero earnings number `MONTH $X.XX USDC`, a 7-day sparkline, an apex routing-fee strip with empty-state upsell hint when no Mill is enabled, a per-peer table with last-claim timestamps, and an activity ticker footer. The "you're early" badge appears when `lifetime < $1.00 OR uptime < 7d` and disappears silently after the first $1 lifetime. Pressing `[a]` opens a scrollable Activity overlay. Drill detail (channels, metrics, logs, peer details, health) lives in separate CLI subcommands. The TUI refreshes silently on a 2-second tick — no animations, no chimes, no slot-machine effects. Empty-state copy ships in the same PR as the scaffold (Sally's hill).

**FRs covered:** FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29
**NFRs:** NFR3, NFR13, NFR14, NFR19
**UX-DRs:** UX-DR1, UX-DR2, UX-DR3, UX-DR6, UX-DR7
**Depends on:** Epic 47

### Epic 49: End-to-End TOON-Client → Townhouse HS Loop

Any TOON client (operator A's, operator B's, third-party) targets a Townhouse operator's `.anyone` hidden-service endpoint and publishes a Nostr event carrying an ILP-paid packet. The Townhouse operator observes (a) the inbound event/packet on the connector via existing drill subcommands AND (b) the earnings credit appears in the local earnings data plane within 2 snapshot intervals, reconciling to the settled claim amount ± rounding tolerance. This proves the full revenue loop closes on real infrastructure — real `.anyone` transport, real connector, real claim — not Anvil fixtures, not a synthetic harness. The Townhouse HS is the destination, the TOON client is the origin, earnings are the receipt. Re-scoped 2026-05-18 from the prior 7-story "Telemetry & Validation Gate" — that scope (aggregated cross-operator telemetry, Cloudflare-fronted receiver, $1.00/$0.10/<$0.10 validation fork) was archived to `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49-future: Aggregated Pilot Telemetry" with re-entry gated on N ≥ 10 opted-in operators.

**Settlement-chain scope:** EVM + Solana on Akash devnets (Akash-Anvil + Akash-Solana per `deploy/akash/leases.json`); Solana leg via Mill swap peer. Mina out of scope (no Akash deployment, not on v0.1 revenue path).

**FRs covered:** FR30, FR31, FR32, FR33, FR34
**NFRs:** NFR5, NFR6, NFR10, NFR18
**UX-DRs:** —
**Depends on:** Epic 45 (`.anyone` reachable HS), Epic 47 (earnings data plane), Epic 48 (drill subcommands), Epic 12 + Epic 13 (Mill swap peer for SOL leg). Epic 46 (peer registration) required for Mill peer in the SOL leg.

### Cross-Cutting Constraints

These NFRs and UX-DRs apply across multiple epics and are not owned by any single one:

- **NFR8** — file mode `0o600` on every operator-secret file (`nodes.yaml` → Epic 46, `earnings-snapshots.jsonl` → Epic 47, `wallet.enc` → Epic 45, `host.json` → Epic 45). `telemetry.json` retired with Epic 49 re-scope (2026-05-18); returns with Epic 49-future per deferred-work.md.
- **NFR15** — Node.js >=20, TypeScript ^5.3, ESM-only (project tech stack baseline; applies to every package)
- **NFR17** — Pre-publish quality gate (6 green checks: unit + integration, contract canary, image-contract, real-CLI E2E, Playwright e2e:real, cosign verify) — gates `npm publish` for the entire townhouse package
- **UX-DR5** — Failure-state copy library spans Epic 45 (anon timeout, port collision, missing docker.sock), Epic 46 (image pull failure, registration drift), and Epic 48 (rendering when API is unreachable)

---

## Epic 44: Connector Cross-Repo Surface

Connector operators (and through them, all consumers of `@toon-protocol/connector`) gain a clean HS-hostname admin API, multi-arch image builds, cosign-signed images via keyless OIDC, and a written semver discipline contract for the `/admin/*` API surface.

### Story 44.1: Connector — `GET /admin/hs-hostname` Endpoint

As a townhouse host CLI,
I want the connector to expose its `.anyone` hidden-service hostname via the existing admin HTTP surface,
So that `townhouse hs up` reads the hostname over HTTP instead of falling back to a `dockerode exec cat /var/lib/anon/hs/hostname` shellout (which is unshippable: breaks under Podman, breaks under rootless Docker, requires privileged Docker socket access from a published npm CLI).

> **Connector-team review** ([toon-protocol/connector#58](https://github.com/toon-protocol/connector/issues/58)) resolved the contract on 2026-05-07: `ready` field dropped (consumers check `hostname !== null`); SIGHUP re-read dropped (hostname is fixed for connector process lifetime); 503 fires for both anon-not-configured and `hiddenServiceDir`-unset sub-cases; first-publish detection via `fs.watch` + bounded fallback poll; version target updated to v3.5.0 (post-#57); LOC estimate ~150 (not 80) including new file-watcher logic in `packages/connector/src/transport/managed-anon-client.ts`. ACs below reflect those decisions.

**Acceptance Criteria:**

**Given** the connector has booted with anon configured but the descriptor has not yet published
**When** a client sends `GET /admin/hs-hostname`
**Then** the response is HTTP 200 with body `{ "hostname": null, "publishedAt": null }`

**Given** the connector's anon process has successfully published the v3 hidden-service descriptor and written the hostname to `${anon.dir}/hostname`
**When** a client sends `GET /admin/hs-hostname`
**Then** the response is HTTP 200 with body `{ "hostname": "<onion>.anyone", "publishedAt": "<ISO-8601>" }`
**And** consumers treat `hostname !== null` as the published-and-ready signal (no separate `ready` field — `ready === (hostname !== null)` is implicit)

**Given** first-publish detection
**When** the anon process writes the hostname file
**Then** detection happens via `fs.watch` on `${anon.dir}` with a bounded fallback poll for filesystems where `fs.watch` returns `ENOSYS` (Docker overlay edge cases)
**And** once the file is read on first publish, the value is cached in process state for the connector's lifetime (no per-request file read, no SIGHUP re-read — hostname rotation is a connector restart event in practice)

**Given** the connector is started without a configured hidden service
**When** a client sends `GET /admin/hs-hostname`
**Then** the response is HTTP 503 with body `{ "error": "anon-disabled" }`
**And** this 503 fires in BOTH sub-cases: `ManagedAnonClient` not configured at all, AND `ManagedAnonClient` configured but `hiddenServiceDir` unset (consumer interprets either as "no hidden service is publishing")

**Given** the route handler is added at `packages/connector/src/http/admin-api.ts` with file-watcher logic in `packages/connector/src/transport/managed-anon-client.ts`
**When** the connector contract test suite runs
**Then** a new fixture asserts all three response paths: 200 with `{ hostname, publishedAt }`, 200 with `{ hostname: null, publishedAt: null }`, and 503 with `{ error: "anon-disabled" }`

**Given** the existing admin-api security middleware (IP allowlist, auth)
**When** `GET /admin/hs-hostname` is registered
**Then** the same security applies, asserted via `admin-api-security.test.ts` (extending the existing test)

**Given** townhouse polls during the 30–90s bootstrap window (per Story 45.4)
**When** the connector returns 200 with `hostname: null`
**Then** the response MAY include `Retry-After: 3` to signal politeness; townhouse polls at ~2–3s cadence regardless

**Given** the townhouse-side canary at `packages/sdk/tests/integration/connector-contract.test.ts`
**When** the canary runs against the real connector image at the digest pinned in `image-manifest.json`
**Then** the canary asserts `{ hostname: string|null, publishedAt: string|null }` shape and fails if any field drifts

**Given** the PR ships
**When** the connector is published
**Then** the version bump is **v3.5.0** (post-#57; main is currently at v3.4.2; minor bump per `/admin/*` field-addition rule from Story 44.4)
**And** the LOC estimate is ~150 + tests (route handler + new file-watcher logic in `managed-anon-client.ts`), revising the ~80 estimate from the original planning doc

**FRs:** FR35 | **NFRs:** NFR16

---

### Story 44.2: Connector — Verify / Ensure Multi-Arch Image Build

As a townhouse arm64 operator (Apple Silicon, Raspberry Pi 5),
I want the connector image to be published for `linux/amd64` AND `linux/arm64`,
So that `docker pull` succeeds on my hardware without a manual rebuild.

**Acceptance Criteria:**

**Given** the connector repo's `.github/workflows/build-and-publish.yml`
**When** the assignee inspects the `docker/build-push-action` step
**Then** the `platforms` parameter includes both `linux/amd64` AND `linux/arm64`
**And** if either is missing, a PR is opened adding it (~10 lines of YAML)

**Given** the published connector image
**When** `docker manifest inspect ghcr.io/toon-protocol/connector:<latest-tag>` runs
**Then** the manifest output lists both `linux/amd64` AND `linux/arm64` architectures explicitly

**Given** an arm64 host (Apple Silicon laptop or RPi 5)
**When** the operator runs `docker pull ghcr.io/toon-protocol/connector:<tag>`
**Then** the pull completes without `no matching manifest` errors

**FRs:** FR36

---

### Story 44.3: Connector — Cosign Keyless OIDC Image Signing

As a townhouse pre-publish quality gate,
I want the connector image to be cosign-signed via keyless OIDC,
So that townhouse v1.0's publish workflow can verify the pinned digest before shipping and reject tampered images.

**Acceptance Criteria:**

**Given** the connector repo's `build-and-publish.yml`
**When** a `v*` tag triggers a release build
**Then** the workflow installs `sigstore/cosign-installer` and signs the published image via `cosign sign` using keyless OIDC (no static key secrets in CI)

**Given** the published signed image
**When** a downstream consumer runs `cosign verify ghcr.io/toon-protocol/connector@<digest>` with the connector workflow's GitHub Actions OIDC identity as the expected signer
**Then** verification succeeds with a valid signature record

**Given** the townhouse pre-publish quality gate (NFR17)
**When** the gate runs against the digest pinned in townhouse source
**Then** `cosign verify` is one of the six gate checks and must pass for `npm publish` to proceed

**Given** the cosign step is added
**When** the workflow runs end-to-end
**Then** no static signing keys, no Apple Developer ID, and no GHA secrets beyond the default `GITHUB_TOKEN` are required

**FRs:** FR37

---

### Story 44.4: `CONNECTOR_RELEASE_CONTRACT.md` Cross-Repo Doc

As a townhouse maintainer,
I want a written contract documenting how connector versions map to admin-API stability guarantees,
So that the team doesn't accidentally consume a breaking-change release between digest-pin time and pilot ship.

**Acceptance Criteria:**

**Given** the connector and townhouse repos
**When** the doc PR lands
**Then** an identical-content `CONNECTOR_RELEASE_CONTRACT.md` exists at both `connector/CONNECTOR_RELEASE_CONTRACT.md` AND `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md`

**Given** the contract document
**When** read
**Then** it states: `/admin/*` field additions = MINOR bump; `/admin/*` field renames or removals = MAJOR bump; ILP packet wire-format changes = MAJOR bump; townhouse pins by digest in `image-manifest.json` and bumps deliberately on each minor

**Given** the contract document
**When** read
**Then** it documents the cosign verify expectation (Story 44.3) and the multi-arch build expectation (Story 44.2)

**Given** both repos
**When** the PR lands
**Then** each repo's CHANGELOG entry references the new doc AND the townhouse repo subscribes to `toon-protocol/connector` releases via GitHub release notifications

**FRs:** FR38

---

## Epic 45: One-Command Apex Install

Drew runs `npx @toon-protocol/townhouse hs up` once and has a working hidden-service apex (connector + host API + `.anyone` HS) in under 5 minutes. The apex is a reachable, payable identity even with zero peer nodes.

### Story 45.1: Multi-Arch Townhouse Image Publish CI

As a townhouse release engineer,
I want a CI workflow that builds and publishes townhouse-owned images to GHCR with digest pinning and multi-arch support,
So that operators pull pre-built images from any architecture and townhouse never republishes the connector image.

**Acceptance Criteria:**

**Given** the workflow file at `.github/workflows/publish-townhouse-images.yml`
**When** a `v*` tag is pushed OR a manual `workflow_dispatch` is triggered
**Then** the workflow runs and produces published images

**Given** the workflow is executing
**When** images are built
**Then** EXACTLY four images are produced (NOT five): `townhouse-api`, `town`, `mill`, `dvm` — the `connector` image is consumed by digest from upstream and is NOT republished

**Given** each image is built
**When** push completes
**Then** each image exists at `ghcr.io/toon-protocol/<service>:<vX.Y.Z>` with a `:latest` alias AND the resulting digest is captured

**Given** all four images are published
**When** the post-build step runs
**Then** `scripts/build-image-manifest.mjs` writes `packages/townhouse/dist/image-manifest.json` containing `{name, tag, digest}` for each townhouse image PLUS a `connector: ghcr.io/toon-protocol/connector@sha256:<digest>` entry pinned to the upstream version this release tested against

**Given** each image build step
**When** push succeeds
**Then** `cosign sign` runs via keyless OIDC and produces a signature record (matches Story 44.3 discipline)

**Given** the publish workflow
**When** the npm publish step runs
**Then** it executes ONLY AFTER all image-publish steps succeed (npm version cannot resolve to a tag whose images don't exist)

**Given** the workflow includes both arch builds
**When** a tag triggers it
**Then** each image's manifest reports both `linux/amd64` AND `linux/arm64` (verifiable via `docker manifest inspect`)

**FRs:** FR2 | **NFRs:** NFR17 (contributes to pre-publish gate)

---

### Story 45.2: Embed Compose Templates + Image Manifest in npm Tarball

As a townhouse operator,
I want the npm package to ship embedded compose YAML and digest-pinned image references,
So that I never need to clone the source repo and the version of townhouse I install always pulls the exact images it was tested against.

**Acceptance Criteria:**

**Given** the source repo
**When** the package is built via tsup
**Then** `packages/townhouse/compose/townhouse-hs.yml` is included in the npm tarball under `dist/compose/townhouse-hs.yml`
**And** `packages/townhouse/compose/townhouse-dev.yml` is also retained for the existing dev stack

**Given** the embedded `townhouse-hs.yml`
**When** read
**Then** every service entry uses `image: ghcr.io/toon-protocol/<svc>@sha256:<digest>` form (digests resolved from `image-manifest.json` at build time)
**And** there are NO `build:` directives

**Given** `image-manifest.json` shipped inside the npm tarball
**When** an operator runs `townhouse hs up` for the first time
**Then** the loader at `packages/townhouse/src/compose-loader.ts` writes the resolved compose YAML to `~/.townhouse/compose/townhouse-hs.yml` AND writes the digest manifest to `~/.townhouse/image-manifest.json` with file mode `0o600`

**Given** the loader API
**When** invoked with `loadComposeTemplate(profile: 'dev'|'hs'): string`
**Then** it returns rendered YAML with digest substitutions applied

**Given** the loaded template
**When** `docker compose -f <path> config` runs against it
**Then** the YAML validates without errors (asserted via in-process Docker stub in unit tests)

**FRs:** FR3 | **NFRs:** NFR8

---

### Story 45.3: DockerOrchestrator Profile Param

As a townhouse engineer,
I want the existing `DockerOrchestrator` to accept a `profile: 'dev' | 'hs'` parameter,
So that the same orchestration code drives both the contributor dev stack and the operator HS-mode stack without duplication.

**Acceptance Criteria:**

**Given** the existing `DockerOrchestrator` class
**When** the refactor lands
**Then** the constructor signature accepts `{ profile: 'dev' | 'hs', composePath: string, ... }`

**Given** the existing dev-stack tests (`packages/townhouse/src/__integration__/`)
**When** they run after the refactor
**Then** they pass without modification (`'dev'` profile preserves existing behavior)

**Given** profile selection
**When** `start()` is invoked with `profile: 'hs'`
**Then** the appropriate `--profile` flags (per `docker-compose-townhouse-hs.yml`) are emitted to `docker compose up`
**And** unit tests assert the exact set of flags emitted per profile

**Given** the HS profile is active
**When** `start()` completes
**Then** the orchestrator does NOT consider startup complete until the connector's `GET /admin/hs-hostname` returns 200 with `hostname !== null` (depends on Story 44.1)

**Given** an HS-profile container fails to start
**When** the orchestrator detects the failure
**Then** the error surfaces via the existing failure-handler interface with the failed-service name

**FRs:** (supports FR4, FR8 indirectly)

---

### Story 45.4: `townhouse hs up` Subcommand — Apex-Only Boot

As a homelab operator (Drew),
I want to run `npx @toon-protocol/townhouse hs up` once and have the apex come up with zero further configuration,
So that I have a payable identity on the TOON network in under 5 minutes without enabling any peer node yet.

**Acceptance Criteria:**

**Given** the new CLI subcommand registered in `packages/townhouse/src/cli.ts`
**When** an operator runs `npx @toon-protocol/townhouse hs up`
**Then** EXACTLY two services start: `connector` (with anon HS volume `townhouse-hs-anon` mounted) AND `townhouse-api` (Fastify on `127.0.0.1:28090`, mounts host docker.sock RW, mounts `~/.townhouse/`)
**And** NO `town-*`, `mill-*`, or `dvm-*` containers start (apex-only)

**Given** the apex is starting
**When** the user watches stdout
**Then** the onboarding ribbon (UX-DR4) narrates progress in three rolling lines: `"Pulling apex image..."` → `"Bootstrapping hidden service (this takes 30–90s)..."` → `"Apex live at <hostname>.anyone"`
**And** non-unicode terminals fall back to ANSI spinner

**Given** the connector is booted
**When** the CLI polls `GET /admin/hs-hostname`
**Then** the CLI waits for 200 with `hostname !== null` (max 120s timeout, ~2–3s polling cadence) and reads the published hostname

**Given** the hostname is published
**When** boot completes
**Then** the CLI prints the `.anyone` address as the FINAL stdout line AND writes it to `~/.townhouse/host.json` (file mode `0o600`)

**Given** the apex is already running
**When** the operator runs `townhouse hs up` again
**Then** the CLI re-prints the hostname and exits 0
**And** no `docker pull`, no container recreation, no volume changes occur

**Given** the apex is running
**When** the operator runs `townhouse hs down`
**Then** containers stop AND the `townhouse-hs-anon` volume is preserved (`.anyone` address stable across restarts)

**Given** the apex is running
**When** the operator runs `townhouse hs down --rotate-keys`
**Then** containers stop AND the `townhouse-hs-anon` volume is deleted (next `hs up` produces a new `.anyone` address)

**Given** non-interactive mode
**When** the wallet password is required
**Then** the password is sourced from `--password` flag or `TOWNHOUSE_WALLET_PASSWORD` env var; otherwise an interactive prompt fires

**Given** the apex boot fails at any step
**When** the failure occurs
**Then** Sally's failure-state copy library (UX-DR5) renders the error class with plain-language explanation + actionable next step (anon timeout / image pull failure / port collision / missing docker.sock)

**Given** the connector container starts
**When** its mount config is inspected
**Then** `/var/run/docker.sock` is NOT mounted in the connector container

**Given** all host-side ports are bound
**When** the network config is inspected
**Then** every port binds to `127.0.0.1` only — never `0.0.0.0`

**Given** a 50 Mbps connection from a cold image cache
**When** `townhouse hs up` runs from a fresh state
**Then** apex-ready (hostname published — `GET /admin/hs-hostname` returns `hostname !== null`) completes within 5 minutes

**FRs:** FR1, FR4, FR5, FR6, FR7 | **NFRs:** NFR1, NFR2, NFR7, NFR9 | **UX-DRs:** UX-DR4, UX-DR5 (partial)

---

## Epic 46: Lazy Peer Node Provisioning

Drew adds Town, Mill, or DVM nodes on demand via `townhouse node add <type>`. The operator's declared intent in `~/.townhouse/nodes.yaml` is the source of truth; the connector's peers list is derived state.

### Story 46.1: `nodes.yaml` Schema + Boot Reconciler + Peer-Type Resolver

As a townhouse engineer,
I want `~/.townhouse/nodes.yaml` to be the operator-managed source of truth for enabled child nodes and a boot-time reconciler that converges connector peer state to it,
So that laptop reboots, half-completed `node add` operations, and connector restarts all converge to the operator's declared intent without manual cleanup.

**Acceptance Criteria:**

**Given** the schema definition at `packages/townhouse/src/state/nodes-yaml.ts`
**When** zod validation runs on a `nodes.yaml` file
**Then** the schema enforces `entries: [{ id: string, type: 'town' | 'mill' | 'dvm', peerId: string, ilpAddress: string, derivationIndex: number, enabledAt: string, lastSeenAt: string | null }]`

**Given** the schema requires `peerId: string`
**When** the field is checked against the connector's peer model
**Then** the value matches `connector.peers[*].peerId` byte-for-byte
**And** any pre-existing rows that used `ilpAddress` or `peerPubkey` are migrated to `peerId` as part of this story

**Given** the boot reconciler at `packages/townhouse/src/reconciler.ts`
**When** `townhouse hs up` completes the apex boot
**Then** the reconciler reads `nodes.yaml` (truth) AND reads connector `GET /admin/peers` (derived state) AND diffs them

**Given** a yaml entry with no matching connector peer
**When** the reconciler diffs
**Then** the reconciler re-runs the registration step (idempotent `POST /admin/peers`) using the persisted `peerId` and `ilpAddress`

**Given** a connector peer with no matching yaml entry
**When** the reconciler diffs
**Then** the reconciler logs the peer as `'external'` and leaves it alone (operator may legitimately run non-Townhouse peers through the connector)

**Given** every divergence detected
**When** reconciliation runs
**Then** the divergence is logged to `~/.townhouse/reconciler.log` with timestamp + action taken

**Given** the resolver at `packages/townhouse/src/registry/peer-type-resolver.ts`
**When** `resolvePeerType(peerId): NodeType | 'external'` is called with a known peerId
**Then** it returns the matching `'town' | 'mill' | 'dvm'` from yaml in O(1) (in-memory `Map`, rebuilt on yaml change)

**Given** the resolver
**When** called with an unknown peerId
**Then** it returns `'external'`

**Given** `nodes.yaml` is written
**When** the file mode is checked
**Then** mode is `0o600`

**FRs:** FR10, FR11, FR17 | **NFRs:** NFR8

---

### Story 46.2: `POST /api/nodes` and `DELETE /api/nodes/:id` Host API

As a townhouse host API,
I want endpoints that provision and tear down child nodes atomically with rollback on failure,
So that the CLI and any future SPA both drive node lifecycle through one tested code path.

**Acceptance Criteria:**

**Given** the host API at `127.0.0.1:28090`
**When** a client sends `POST /api/nodes` with body `{ "type": "town" | "mill" | "dvm" }`
**Then** the server orchestrates a strict 6-step pipeline IN ORDER:
1. `WalletManager.deriveNodeKey(type, nextIndex)` (no state change yet)
2. `DockerOrchestrator.pullImage(manifest[type].digest)` — fail returns 502
3. **Write `nodes.yaml` entry** (BEFORE connector registration)
4. `DockerOrchestrator.startContainer(spec)` with derived key as env — fail removes yaml entry, returns 502
5. `waitForHealthy(http://<id>:<port>/health, 60s)` — fail removes yaml entry + stops container, returns 502
6. `ConnectorAdminClient.registerPeer({ pubkey, endpoint })` — fail removes yaml entry + stops container, returns 502

**Given** the pipeline ordering rule
**When** the implementation is reviewed
**Then** the `nodes.yaml` write happens at step 3, BEFORE the connector registration at step 6 (never the reverse)

**Given** any pipeline step fails
**When** the rollback completes
**Then** `nodes.yaml` AND the connector peers list end byte-identical to the pre-add state (state-machine table tests with injected failures at each transition assert this)

**Given** a successful provisioning
**When** the response is returned
**Then** body is `{ id, type, peerId, ilpAddress, hsRoute, healthCheckUrl }` with HTTP 201

**Given** failure at any step
**When** the error response is returned
**Then** body includes the specific failed step `{ step: 'healthcheck', err: '...' }` for debuggability

**Given** the host API
**When** a client sends `DELETE /api/nodes/:id`
**Then** the reverse pipeline runs: deregister with connector FIRST → stop container → remove yaml entry — each step idempotent

**Given** any state mutation
**When** re-run against the same operator action
**Then** the operation is idempotent (no-op if already in target state)

**FRs:** FR8, FR9, FR13 | **UX-DRs:** UX-DR5 (partial — image pull failure copy)

---

### Story 46.3: `townhouse node add` / `node remove` / `node list` CLI

As a terminal operator (Drew),
I want terse CLI verbs that map 1:1 to host-API node lifecycle,
So that I can `townhouse node add town` and see it work without buttons or modals.

**Acceptance Criteria:**

**Given** the CLI verbs registered in `packages/townhouse/src/commands/node.ts`
**When** an operator runs `townhouse node add town`
**Then** the CLI calls `POST /api/nodes { type: "town" }` against the local host API

**Given** the CLI streams API progress
**When** rendering to stdout
**Then** progress shows as `Pulling image · Deriving wallet · Registering with apex · Live` with stages lighting up green as each completes

**Given** the operator runs `townhouse node add` with no type
**When** the CLI processes args
**Then** the default type is `town` (FR12)

**Given** the operator runs `townhouse node remove <id>`
**When** the CLI processes args
**Then** the CLI prompts for confirmation interactively unless `--yes` is passed

**Given** the operator runs `townhouse node list`
**When** the CLI executes
**Then** the CLI calls `GET /api/nodes` and prints a table with columns: `peer · type · status · last claim`

**Given** every CLI verb
**When** invoked with `--json`
**Then** machine-readable JSON output is emitted instead of human-formatted text

**Given** the help text
**When** an operator runs `townhouse node add --help`
**Then** the help includes the upsell hint: `townhouse node add mill   # earn from chain swaps (5x earnings unlock)`

**FRs:** FR12, FR14

---

### Story 46.4: Live E2E Gate — Lazy Peer Node Provisioning

As a **townhouse release engineer** closing out Epic 46,
I want to run the complete `townhouse node add` user journey end-to-end against real Docker infrastructure,
So that integration gaps not visible in code review are caught before the epic is marked done.

**Acceptance Criteria:**

**Given** a fresh `~/.townhouse/` state with apex already running (`townhouse hs up` complete)
**When** the E2E gate runs
**Then** the following sequence completes without error:
1. `townhouse node add town` — provisions a Town node, writes `nodes.yaml`, registers with connector
2. `townhouse node list` — shows the Town node as active
3. `townhouse node remove <id>` — deregisters and stops the Town node
4. `townhouse node list` — shows no active nodes
5. Re-run `townhouse hs up` — apex re-uses existing volume, hostname unchanged

**Given** the gate run completes
**When** the story is closed out
**Then** any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked done
**And** findings (or "no issues found") are documented in `### Review Findings`

**FRs:** FR1–FR17 (full epic validation) | **NFRs:** NFR1, NFR2, NFR7, NFR8, NFR9

---

## Epic 47: Earnings Data Plane

Drew can query his earnings programmatically via the host API at `GET http://127.0.0.1:28090/api/earnings` — apex routing fees and per-peer claims as separate buckets, with TODAY/MONTH/YEAR/LIFETIME deltas computed locally.

### Story 47.1: SDK `getEarnings()` Wrap + Contract Canary

As a townhouse engineer,
I want the SDK's `ConnectorAdminClient` to expose `getEarnings()` with type-safe contract assertions,
So that the aggregator and telemetry layers consume real connector data instead of packet-count proxies and any future connector-version drift fails the canary loudly.

**Acceptance Criteria:**

**Given** the connector v3.3.3+ exposes `GET /admin/earnings.json`
**When** the new types are added at `packages/townhouse/src/connector/types.ts`
**Then** the file declares 6 interfaces re-declared (NOT re-exported from `@toon-protocol/connector`): `EarningsResponse`, `PeerEarnings`, `AssetEarnings`, `ConnectorFeeEntry`, `RecentClaim`, `EarningsTimestamp`

**Given** the type definitions exist
**When** `ConnectorAdminClient` is extended at `packages/townhouse/src/connector/admin-client.ts`
**Then** a new method `async getEarnings(): Promise<EarningsResponse>` exists, mirroring the `getMetrics()` pattern

**Given** the canary at `packages/townhouse/src/connector/contract-canary.test.ts`
**When** the canary runs
**Then** it asserts: `uptimeSeconds: number`, `peers[].byAsset[].claimsReceivedTotal: string`, `connectorFees[].assetCode: string`, `recentClaims` is an array
**And** the canary fails if any asserted field shape drifts

**Given** the image-contract test at `packages/townhouse/src/__integration__/connector-image-contract.test.ts`
**When** the test boots a real connector container
**Then** the test runs against the digest pinned in source (NOT `:latest`) AND probes `/admin/earnings.json` for the asserted shape

**Given** the migration history file `packages/sdk/CONNECTOR_MIGRATION.md`
**When** this story merges
**Then** a new entry documents the v3.3.3 earnings contract

**FRs:** FR15

---

### Story 47.2: Aggregator Earnings Surgery

As a townhouse aggregator,
I want to derive per-peer earnings from real connector data instead of packet-volume proxies,
So that the dashboard's hero number reflects actual settlement claims, not "I forwarded a lot of packets."

**Acceptance Criteria:**

**Given** the aggregator at `packages/townhouse/src/earnings/aggregator.ts`
**When** the surgery completes
**Then** the packet-volume proxy block (the `TODO(D4-connector-fees)` block at lines 31–36) is DELETED
**And** in its place, the aggregator calls `await connectorAdmin.getEarnings()`

**Given** the aggregator output shape
**When** earnings are aggregated
**Then** `connectorFees[]` from the connector maps to `by_source.connector.routing_fees[assetCode]`

**Given** the per-peer mapping logic
**When** each `peers[*].peerId` from the connector is processed
**Then** the aggregator calls `peer-type-resolver.resolvePeerType(peerId)` AND unmatched peers bucket as `'external'` (NOT dropped)

**Given** the output shape
**When** clients consume the aggregator
**Then** the structure conforms to `{ apex: { routingFees: PerAsset }, peers: [{ id, type, byAsset: PerAsset }] }`
**And** each `PerAsset` value wraps `{ lifetime: string, today: string, month: string, year: string }`

**Given** the aggregator
**When** it executes
**Then** there are NO calls to `getPacketLog()` for earnings derivation (packet log remains a separate metric for "events relayed")

**FRs:** FR15, FR17 (consumer of resolver), FR18 (output shape)

---

### Story 47.3: Hourly Earnings Snapshot Writer

As a townhouse host API,
I want to persist hourly snapshots of cumulative connector earnings,
So that the dashboard can compute TODAY/MONTH/YEAR/LIFETIME deltas without asking the connector team to add windowed endpoints.

**Acceptance Criteria:**

**Given** the snapshot writer at `packages/townhouse/src/earnings/snapshot-writer.ts`
**When** the apex process is running
**Then** the writer fires on an hourly tick (cleared on `townhouse hs down`)

**Given** an hourly tick fires
**When** the writer executes
**Then** it appends one JSON-per-line entry to `~/.townhouse/earnings-snapshots.jsonl` of shape `{ts, peerId, assetCode, claimsReceivedTotal}` for each peer × asset

**Given** delta computation
**When** the dashboard requests TODAY/MONTH/YEAR/LIFETIME
**Then** TODAY = current − snapshot_at(most_recent_UTC_midnight), MONTH = current − snapshot_at(month_boundary), YEAR = current − snapshot_at(year_boundary), LIFETIME = current_cumulative

**Given** snapshot retention
**When** the pruner runs
**Then** entries older than 13 months are purged

**Given** property-based tests via fast-check
**When** the test suite runs
**Then** for arbitrary claim sequences across DST transitions, year boundaries, and corruption scenarios, `sum(deltas) == final − initial` AND monotonicity holds

**Given** a 9500-entry fixture (13 months × hourly)
**When** the writer reads the file
**Then** read perf is <100ms AND file size is <2MB

**Given** mid-write truncation
**When** the writer is killed mid-append
**Then** the next boot reads to the last well-formed JSONL line without crashing AND resumes appending

**Given** the snapshot file is created
**When** the file mode is checked
**Then** mode is `0o600`

**FRs:** FR16 | **NFRs:** NFR4, NFR8, NFR11, NFR12

---

### Story 47.4: `GET /api/earnings` Two-Bucket Endpoint

As a TUI / SPA / future Tauri client,
I want a single host-API endpoint that returns the operator's earnings shaped for direct render,
So that the surface layer doesn't compute deltas, doesn't reach into the connector, and doesn't know about external peers.

**Acceptance Criteria:**

**Given** the host API at `127.0.0.1:28090`
**When** a client sends `GET /api/earnings`
**Then** the response is HTTP 200 with body conforming to: `{ apex: { routingFees: { <assetCode>: { lifetime, today, month, year } } }, peers: [{ id, type, byAsset, lastClaimAt }], recentClaims: [...], eventsRelayed: number, uptimeSeconds: number }`

**Given** the response shape
**When** clients consume it
**Then** `eventsRelayed` is ALWAYS present (sourced from `/admin/metrics.json` `peers[].packetsForwarded` summed) — small-number-shaming guard

**Given** multi-chain operators
**When** the response renders
**Then** per-asset breakouts are NOT collapsed to USD-equivalent (preserves multi-chain story)

**Given** the OpenAPI/TypeBox schema at `packages/townhouse/src/api/schemas/earnings.ts`
**When** the schema is validated against fixtures
**Then** all required fields are present AND the `'external'` peer-type case is exercised

**Given** an integration test against MockEarningsConnector
**When** it runs
**Then** all four delta windows (TODAY/MONTH/YEAR/LIFETIME) are asserted AND the `'external'` peer bucket is exercised

**FRs:** FR18

---

### Story 47.5: Live E2E Gate — Earnings Data Plane

As a **townhouse release engineer** closing out Epic 47,
I want to run the complete earnings-readback user journey end-to-end against real Docker infrastructure and a real connector,
So that integration gaps between the SDK wrap, the aggregator, the hourly snapshot writer, and the host-API endpoint are caught before the epic is marked done (Epic 45 retro A4).

**Acceptance Criteria:**

**Given** a fresh `~/.townhouse/` state with apex already running (`townhouse hs up`) AND at least one peer node provisioned (`townhouse node add town`)
**When** the E2E gate runs
**Then** the following sequence completes without error:
1. Drive at least one real payment claim through the connector (using the SDK E2E rig or a recorded fixture replayed against the live connector).
2. `curl http://127.0.0.1:28090/api/earnings` returns 200 with the two-bucket shape from 47.4 — apex routing fees AND per-peer claims as separate top-level keys.
3. All four delta windows (`today` / `month` / `year` / `lifetime`) are populated AND consistent with the cumulative-claims data the connector reports at `GET /admin/earnings.json`.
4. `~/.townhouse/earnings-snapshots.jsonl` contains at least one hourly snapshot line with mode `0o600`.
5. `eventsRelayed` field is present in the response (small-number-shaming guard from 47.4 AC).
6. A non-Townhouse peer registered through the connector appears in the response with `type: 'external'` (peer-type resolver fallback verified live).

**Given** the gate run completes
**When** the story is closed out
**Then** any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked done
**And** findings (or "no issues found") are documented in `### Review Findings` with a date stamp.

**Given** the contract canary at `packages/townhouse/src/connector/contract-canary.test.ts`
**When** run against the digest-pinned connector image
**Then** the canary passes — confirming shape alignment between connector v3.3.3+ and Epic 47's earnings consumer code.

**FRs:** FR15–FR18 (full epic validation) | **NFRs:** NFR4, NFR8, NFR11, NFR12

---

## Epic 48: Operator Dashboard (Ink TUI)

Drew opens an Ink-based TUI showing the hero earnings number, two-bucket display, "you're early" badge, activity ticker, and drill subcommands. Empty-state copy ships in the same PR as the scaffold (Sally's hill).

### Story 48.1: Ink TUI Scaffold + Hero Band + Empty-State Foundation

As a terminal operator (Drew),
I want a TUI that takes over my terminal cleanly with a hero band showing TODAY/MONTH/YEAR/LIFETIME and a 7-day sparkline,
So that I see the shape of my system at a glance and the empty-state day-one experience tells me "you're early" instead of looking broken.

**Acceptance Criteria:**

**Given** the TUI scaffold at `packages/townhouse/src/tui/`
**When** an operator runs `townhouse hs up` AND stdout is a TTY
**Then** an Ink-rendered TUI takes over the terminal (NOT a plain `console.log` stream)

**Given** stdout is NOT a TTY (e.g., piped or redirected)
**When** `townhouse hs up` runs
**Then** the CLI emits structured logs only (no Ink rendering)

**Given** the hero band layout
**When** the TUI renders
**Then** the top three rows show `TODAY · MONTH · YEAR · LIFETIME` formatted as USDC AND a 7-day ASCII sparkline below

**Given** earnings == 0 (the empty state)
**When** the hero band renders
**Then** the qualifier shows `MONTH $0.00 · N events relayed · you're early` (where N is `eventsRelayed` from `/api/earnings`)
**And** the qualifier vanishes entirely when MONTH > 0

**Given** a refresh tick
**When** 2 seconds pass
**Then** the TUI re-fetches `/api/earnings` AND re-renders silently (no animations, no chimes, no flash)

**Given** the TUI runs at 80×24 (iPhone Termius baseline)
**When** rendered
**Then** the hero band fits without truncation
**And** sparklines collapse first as columns shrink, asset rows last

**Given** the operator is in tmux
**When** the TUI runs
**Then** it never `clear()`s the full terminal AND respects `$TMUX` AND leaves operator pane geometry alone

**Given** the merge gate (NFR19)
**When** this PR is reviewed
**Then** `_bmad-output/design/townhouse-tui-wireframe.md` exists (UX-DR1) AND `_bmad-output/design/empty-state-copy.md` exists (UX-DR2) AND Sally has signed off in the PR description
**And** the PR cannot merge without these artifacts

**Given** the empty-state copy library (UX-DR2)
**When** read
**Then** every zero state, every wait state, every loading state has explicit copy (no `if (n === 0) return ''`)

**FRs:** FR19, FR20, FR23, FR27 | **NFRs:** NFR3, NFR13, NFR14, NFR19 | **UX-DRs:** UX-DR1, UX-DR2

---

### Story 48.2: Two-Bucket Earnings Display (Apex + Per-Peer Table)

As Drew,
I want to see apex routing fees and per-peer earnings as two distinct buckets in the TUI,
So that I understand "the connector earned $X routing, my Town earned $Y relaying" — and the empty apex bucket shows me how to enable Mill if I want routing income.

**Acceptance Criteria:**

**Given** the TUI is mounted (Story 48.1)
**When** the layout renders
**Then** below the hero band, a 1-row apex routing-fee strip appears: `↳ apex routing: $X.XX`

**Given** the apex routing-fee strip
**When** `apex.routingFees.USDC.month > 0`
**Then** the strip shows the dollar amount AND the percentage of total monthly earnings

**Given** the apex routing-fee strip
**When** `apex.routingFees.USDC.month == 0` AND no Mill peer is enabled
**Then** the strip shows `↳ apex routing: $0.00 (enable mill to route)` as a dim/italic upsell hint

**Given** the per-peer table below the apex strip
**When** the table renders
**Then** columns are `PEER · STATUS · ASSET · NET 7d · LAST CLAIM` with up to 3-4 visible rows (scrollable if more peers exist)

**Given** the LAST CLAIM column
**When** rendered
**Then** it shows relative time (`3m ago`, `2d ago`) sourced from `peers[].byAsset[].lastClaimAt`

**Given** a peer has multiple assets (e.g., USDC-evm AND USDC-sol)
**When** the table renders
**Then** each asset is its own ROW under the same peer ID
**And** the layout per UX-DR7 prevents the operator from thinking the totals are double-counted

**Given** the data source
**When** the TUI fetches data
**Then** all data comes from `GET /api/earnings` (Story 47.4) — the TUI does NOT call `/admin/*` directly

**FRs:** FR21, FR22 | **UX-DRs:** UX-DR7

---

### Story 48.3: "You're Early" Badge

As Drew,
I want a visible badge that tells me "you're early" when my earnings are tiny or my uptime is fresh,
So that small numbers feel like positioning, not failure — and I don't uninstall on day one.

**Acceptance Criteria:**

**Given** the TUI is running
**When** `lifetime < $1.00 USDC OR uptime < 7d`
**Then** a "you're early" badge is visible in the hero region

**Given** the badge is visible
**When** time progresses across refreshes
**Then** the badge text rotates through `"you're early"` / `"warming up"` / `"first packet en route"` (rotation cadence per UX-DR3)

**Given** `lifetime ≥ $1.00 USDC` for the first time
**When** the next refresh fires
**Then** the badge disappears silently (no animation, no celebratory chime)

**Given** the badge is visible
**When** rendered
**Then** the visual treatment is amber color in truecolor terminals (graceful degrade to dim text in 8-color terminals)

**Given** Sally's badge spec (UX-DR3)
**When** referenced during implementation
**Then** the spec at `_bmad-output/design/townhouse-tui-wireframe.md` includes badge treatment, copy rotation, and trigger rules

**FRs:** FR24 | **UX-DRs:** UX-DR3

---

### Story 48.4: Activity Ticker Footer + Activity Overlay

As Drew,
I want a one-line activity ticker showing the most recent claim and a key to open a full activity log,
So that the dashboard heartbeat is visible at midnight without needing to leave the screen.

**Acceptance Criteria:**

**Given** the TUI is running
**When** the layout renders
**Then** the bottom row shows `recent: <peerId> ← $X.XXXX USDC · <relative_time> [a] activity`

**Given** the activity ticker
**When** a new claim arrives (via `recentClaims[]` polled from `/api/earnings`)
**Then** the ticker line updates on the next 2-second refresh (silent batched update)

**Given** the operator presses `[a]`
**When** the keybind fires
**Then** a modal Activity overlay appears centered (70% terminal width, per UX-DR6)

**Given** the Activity overlay is open
**When** the operator interacts
**Then** `j`/`k` scrolls the activity list AND `q` closes the overlay AND the buffer holds the last 200 settlement events (ring-buffered)

**Given** the overlay is open
**When** rendered
**Then** each row shows `<timestamp> · <peerId> · <amount> <asset> · <direction>` from `recentClaims[]`

**Given** the overlay is closed
**When** the operator returns to the main TUI
**Then** the underlying TUI state is unchanged (no scroll position lost, no flicker on re-render)

**FRs:** FR25, FR26 | **UX-DRs:** UX-DR6

---

### Story 48.5: Drill Subcommands (`channels`, `metrics`, `logs`, `peer`, `health`)

As a power-user operator (Drew on a debugging session),
I want CLI subcommands that expose drill-level detail outside the main TUI,
So that I can inspect channels, packet counters, log streams, and per-peer details without cluttering the dashboard's hero view.

**Acceptance Criteria:**

**Given** the CLI verbs registered in `packages/townhouse/src/commands/`
**When** an operator runs `townhouse channels`
**Then** the CLI calls connector `GET /admin/channels` AND prints a table (channelId · peer · asset · open/closed · balance)

**Given** `townhouse metrics`
**When** invoked
**Then** the CLI prints connector `GET /admin/metrics.json` per-peer ILP packet counters (`packetsForwarded`, `packetsRejected`, `bytesSent`)

**Given** `townhouse logs -f <node-id>`
**When** invoked
**Then** the CLI tails the named child node's log stream (via `dockerode logs --follow`) — `journalctl`-style

**Given** `townhouse peer <id>`
**When** invoked
**Then** the CLI prints a detail card: ILP address, registered routes, lifetime claims, last seen, channel state

**Given** `townhouse health`
**When** invoked
**Then** the CLI prints apex connector `/health` AND host API `/health` AND each registered child node's `/health` AND the published `.anyone` hostname

**Given** any drill verb
**When** invoked with `--json`
**Then** machine-readable JSON output is emitted

**FRs:** FR28

---

### Story 48.6: Sats Power-User Flag

As a Bitcoin-native operator,
I want an undocumented `--units=sats` flag on `townhouse status`,
So that I can see earnings in sats while the rest of the world sees USDC.

**Acceptance Criteria:**

**Given** the CLI command `townhouse status`
**When** invoked with `--units=sats`
**Then** all displayed earnings amounts are converted from USDC to sats (using a fixed reference rate at fetch time, sourced from a configured oracle or a CLI-supplied rate)

**Given** the `--units` flag
**When** the user runs `townhouse status --help`
**Then** the `--units` option is NOT listed (undocumented power-user flag)

**Given** the project README
**When** read
**Then** the sats flag is mentioned in a footnote ONLY (not in the main usage section, not in marketing copy)

**Given** the canonical default
**When** any CLI verb other than `status --units=sats` is used
**Then** USDC remains the canonical hero display

**FRs:** FR29

---

### Story 48.7: Live E2E Gate — Operator Dashboard

As a **townhouse release engineer** closing out Epic 48,
I want to run the complete TUI user journey end-to-end against a live apex + at least one peer node,
So that rendering, refresh-tick, drill subcommands, and empty-state copy are visually verified — code review and snapshot tests cannot catch terminal-rendering regressions or empty-state copy mistakes (Epic 45 retro A4 + UX-DR2 enforcement).

**Acceptance Criteria:**

**Given** a fresh `~/.townhouse/` state with apex already running AND at least one peer node provisioned
**When** the operator runs `townhouse hs up` in a TTY-attached terminal
**Then** the Ink TUI launches by default (TTY auto-detection from 48.1) AND renders the hero band, sparkline, two-bucket display, and activity ticker footer.

**Given** the TUI is running
**When** the gate verifies each user-visible surface
**Then** ALL of the following pass:
1. Hero metric displays `MONTH $X.XX USDC` correctly when earnings exist; the empty-state hero qualifier renders correctly when earnings are zero.
2. "You're early" badge appears when `lifetime < $1.00 OR uptime < 7d` AND disappears silently once the threshold is crossed (asserted by forcing both states with snapshot fixtures).
3. Pressing `[a]` opens the scrollable Activity overlay; pressing it again closes cleanly without terminal-state corruption.
4. The 2-second silent refresh tick is observable (verify by mutating an earnings snapshot during the run and confirming the hero updates within 2–3 seconds).
5. The apex routing-fee bucket shows "(enable mill to route)" upsell when no Mill is enabled.
6. Per-asset row layout renders correctly when multi-chain claims exist (multi-chain story preserved — no USD collapse).

**Given** the TUI is rendered at 80×24 AND inside a tmux pane
**When** visual inspection runs
**Then** layout is intact (no overflow, no full-screen clears that break tmux scrollback) — NFR13 + NFR14 verified live.

**Given** the drill subcommands (`townhouse channels`, `metrics`, `logs`, `peer`, `health`)
**When** each is invoked
**Then** each returns sane output and exits 0 — these are read-only diagnostics, not lifecycle commands.

**Given** `townhouse status --units=sats`
**When** invoked against the same fixtures
**Then** earnings render in sats (undocumented power-user flag — 48.6 AC verified live).

**Given** the gate run completes
**When** the story is closed out
**Then** any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked done
**And** findings (or "no issues found") are documented in `### Review Findings` with a date stamp
**And** Sally signs off on the empty-state copy renders (UX-DR2 enforcement — same gate as 48.1).

**FRs:** FR19–FR29 (full epic validation) | **NFRs:** NFR3, NFR13, NFR14, NFR19 | **UX-DRs:** UX-DR1, UX-DR2, UX-DR3, UX-DR6, UX-DR7

---

## Epic 49: End-to-End TOON-Client → Townhouse HS Loop

Any TOON client (operator A's, operator B's, third-party) targets a Townhouse operator's `.anyone` HS endpoint, publishes a Nostr event carrying an ILP-paid packet, and the operator observes (a) the inbound event on the connector via existing drill subcommands AND (b) the earnings credit on their local data plane. **Five stories** (re-scoped + re-sequenced 2026-05-18). Re-scoped from the prior 7-story "Telemetry & Validation Gate"; old stories archived to `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49-future: Aggregated Pilot Telemetry".

**Re-sequence 2026-05-18 (party mode):** Two infrastructure precursor stories inserted as 49.2 + 49.3 to give the settlement + close-out gate stories a real Akash-hosted foreign client. Previous 49.2 → 49.4, previous 49.3 → 49.5.

| # | Title | Status |
|---|---|---|
| 49.1 | TOON Client → Foreign Townhouse HS Smoke (in-host two-stack) | done |
| 49.2 | Akash Devnet Faucets + Unified Faucet UI | backlog |
| 49.3 | Persistent Akash Foreign-Client Pod | backlog |
| 49.4 | Paid Packet → Earnings Receipt (EVM + SOL on Akash) | backlog |
| 49.5 | Live E2E Gate — Real-`.anyone` Loop on Akash EVM + SOL | backlog |

**Settlement-chain scope (decided 2026-05-18):** Gate runs against **EVM + Solana on Akash devnets** (Akash-Anvil + Akash-Solana, already deployed — see `deploy/akash/leases.json`). EVM settles directly via the connector's USDC adapter; Solana settles via the **Mill swap peer** (Epic 12 / 13) mediating EVM-USDC → SOL-USDC. Mina is out of scope — no Akash deployment exists today and Mina is not on the v0.1 pilot revenue path.

### Story 49.1: TOON Client → Foreign Townhouse HS Smoke

As a TOON-client developer (Jonathan, Drew, or any third party),
I want to publish a Nostr event via another operator's `.anyone` HS endpoint and see it logged on their connector,
So that I prove the public protocol surface advertised by `townhouse hs up` is actually reachable by foreign clients — not just by tests in the same process.

**Acceptance Criteria:**

**Given** operator A has run `townhouse hs up` and obtained `<hostname-a>.anyone`
**When** operator B (different machine OR different container, different keypair, separate anon transport) runs a TOON client configured with `relay=<hostname-a>.anyone`
**Then** B's client establishes the anon transport AND publishes a kind:1 event AND receives an acceptance receipt within 30 seconds of transport-established.

**Given** the event reaches operator A's connector
**When** A runs `townhouse drill channels` or `townhouse drill logs --tail`
**Then** the inbound event is surfaced (event id, kind, source-peer pubkey hash, arrival timestamp) on the drill surface that Epic 48 already ships — no new TUI work required.

**Given** the smoke runs against a real `.anyone` hidden service (NOT a `127.0.0.1` substitute or in-process loopback)
**When** the bootstrap window is observed
**Then** the smoke tolerates the ~30–90s first-publish window (per Story 45.4) AND only fails if the window exceeds 120s.

**Given** operator B is a non-Townhouse TOON client (no `townhouse hs up` running on B's side; just a raw SDK/client process)
**When** B's event lands on A's connector
**Then** A's peer-type resolver tags B's pubkey as `'external'` (per Epic 47) — non-Townhouse callers are first-class.

**FRs:** FR30, FR31 | **NFRs:** NFR5

---

### Story 49.2: Akash Devnet Faucets + Unified Faucet UI

As a TOON dev or external tester who wants to drive paid publishes against a townhouse `.anyone` HS,
I want the existing Akash-Anvil and Akash-Solana devnet leases to each expose a HTTP faucet endpoint plus a single unified web UI,
So that any client (the Akash foreign-client pod from 49.3, my laptop, or a third-party developer) can self-serve unlimited devnet ETH/USDC and SOL/SPL-USDC against the same chain state operator A's local townhouse settles on.

**Source decisions:** Party Mode 2026-05-18 — chains stay on clearnet (user: "we don't need to wrap the anvil or SOL wrapped behind a HS thats not in scope for hs"); persistent foreign pod with ephemeral signer keys requires unlimited-supply faucets (user: "the foreign pod can be persitent and the anvil and sol akash nodes should just have a faucet with unlimited supply"); UI must serve both chains in one surface (user: "evm and sol").

**Hard rules (carry forward from 47.5 / 48.7 / 49.1):**
1. Modifies two shipped SDLs (`deploy/akash/anvil.sdl.yaml` + `deploy/akash/solana.sdl.yaml`) — those are existing pre-existing infra, so this story DOES touch shipped product source; that exception is authorized for the faucet sidecar service only.
2. Single unified `index.html` shipped to BOTH SDL containers (byte-identical) — no proxy, no third Akash lease. Cross-chain glue is CORS.
3. ONE new integration test file: `packages/townhouse/src/__integration__/akash-faucet-smoke.test.ts`.
4. Faucet authority key is a checked-in deterministic fixture (same posture as `project_solana_mock_usdc_keys` MEMORY note) — devnet only, no production secrets.

**Acceptance Criteria:**

**AC #1 — Faucet API on both SDLs:**
**Given** `deploy/akash/anvil.sdl.yaml` and `deploy/akash/solana.sdl.yaml` are deployed
**When** a client `POST`s `/faucet/evm` (anvil) or `/faucet/sol` (solana) with `{address, amount?}`
**Then** the faucet returns `200 {txHash, balanceAfter, chain}` within 10s, transferring native + USDC/SPL-USDC to the address.
**And** request shape validates against `packages/townhouse/contracts/faucet.schema.json` (ajv strict mode, `additionalProperties: false`).
**And** rate-limit is 1 req/sec per source address (token-bucket, in-memory), 5 req/min per source IP.
**And** unlimited supply — no daily cap, no faucet-drained state under normal devnet load.

**AC #2 — Faucet UI served from BOTH SDLs:**
**Given** the same `deploy/akash/faucet-ui/index.html` is shipped to both faucet containers
**When** a developer loads either Akash ingress URL in a browser
**Then** the UI renders a single-page form with chain dropdown (`Auto | EVM | SOL`), address input (auto-detects `0x…` → EVM, base58 → SOL), amount field, and "Drip" button.
**And** `curl <evm-ingress>/index.html` and `curl <sol-ingress>/index.html` return byte-identical bodies (sha256 match).

**AC #3 — Cross-chain CORS:**
**Given** the UI is loaded on the SOL ingress
**When** the user requests an EVM drip (different origin from the page)
**Then** the EVM faucet's `Access-Control-Allow-Origin` header allows the request and the drip succeeds.
**And** the OPTIONS preflight is handled with a 204.

**AC #4 — Recent drips feed (interleaved):**
**Given** each faucet maintains a 10-entry in-memory ring buffer of recent drips
**When** the UI calls `GET /faucet/recent?limit=10` on both ingresses and merges client-side
**Then** the feed shows interleaved EVM+SOL rows sorted desc by `ts` with a `[EVM]` or `[SOL]` chain tag on each row.

**AC #5 — UI status states:**
**Given** the UI form
**When** the user submits
**Then** the status panel cycles through `idle → requesting… → sent! tx: 0x… [view ↗] → balanceAfter: <amt>` on success, or `error: <message>` on failure.
**And** rate-limit response renders as a countdown ("next drip in 27s"), not a raw 429.
**And** invalid address shows inline red text under the field, not a toast.
**And** chain-ID badge under the dropdown shows `Anvil · 31337` or `Solana devnet · local` once a chain is picked.

**AC #6 — Schema-contract test:**
**Given** `pnpm --filter @toon-protocol/townhouse test`
**When** the faucet-contract test runs
**Then** it ajv-validates request + response shapes against `packages/townhouse/contracts/faucet.schema.json` without dialing a live faucet.

**AC #7 — E2E smoke against live Akash:**
**Given** anvil + solana Akash leases are running with the faucet sidecars
**When** the smoke test boots
**Then** a fresh EVM address receives a drip AND a fresh SOL address receives a drip AND both balances reflect within 30s of the POST.
**And** results documented in `### Review Findings` with `_Smoke run YYYY-MM-DD — …_` format per 47.5/48.7/49.1 precedent.

**Out of scope:**
- Authentication, wallet-connect, dark mode, branding, i18n, per-address history
- Canonical DNS URL (e.g. `faucet.toon.dev`) — both Akash ingresses are equivalent entry points for this story
- Persistent drips log on disk (in-memory ring buffer only)

**FRs:** FR30, FR32 (faucet is infra for the paid-packet loop) | **NFRs:** NFR8 (faucet authority key file `0o600`)

---

### Story 49.3: Persistent Akash Foreign-Client Pod

As the TOON protocol team validating that ANY foreign TOON client can publish through a townhouse `.anyone` HS,
I want a persistent Akash-hosted pod that exposes `POST /publish {event, targetHostname}` and uses `@toon-protocol/client` + `@anyone-protocol/anyone-client` to send EIP-712-signed Nostr events through a townhouse HS on the operator's local machine,
So that 49.4's settlement assertions and 49.5's close-out gate can drive the foreign-publish loop against real cross-network infrastructure — not the in-process foreign client from 49.1.

**Source decisions:** Party Mode 2026-05-18 — HTTP `POST /publish` contract (user picked option (a) over cron/CLI/HS-only); persistent pod (user: "the foreign pod can be persitent"); ephemeral signer keys auto-funded by 49.2's faucet on boot (user: "the key can be empherial since there will be a faucet that can supply it with tokens"); runtime-mutable target HS so a laptop reboot doesn't need a pod redeploy (user: "the client also needs to eb configurable at runtime with the hs to send the packet to"); no app-layer idempotency — Nostr event-id dedup at the relay is sufficient for a dev fixture (user: "is idempotency cache useful since this is just for development").

**Hard rules (carry forward from 47.5 / 48.7 / 49.1):**
1. Single new test file: `packages/townhouse/src/__integration__/akash-foreign-pod-smoke.test.ts`.
2. Test process is Tor-aware (dials the pod's clearnet ingress, but the pod itself dials the target HS via SOCKS5 — that's the path under test).
3. Bugs found during the smoke → separate PRs → re-run smoke → THEN flip to `done` (49.1 / 47.5 precedent).
4. Foreign-publish schema lives at `packages/townhouse/contracts/foreign-publish.schema.json`. Schema drift = build break.
5. Tor binary pinned in the Dockerfile (MEMORY note `connector_anyone_postinstall` — runtime fetch = guaranteed flake).
6. Persistent-deployment discipline: named lease owner in story footer; monthly AKT-burn budget AC; sunset calendar reminder; orphan-lease detector cron.

**Acceptance Criteria:**

**AC #1 — Pod boot + ephemeral signer keys + faucet auto-fund:**
**Given** the SDL `deploy/akash/foreign-toon-client.sdl.yaml` is deployed and a lease accepted
**When** the pod entrypoint runs
**Then** it (a) generates a fresh secp256k1 keypair (EVM) + ed25519 keypair (Solana) in memory only, (b) logs both pubkeys (NEVER privkeys), (c) POSTs to `${FAUCET_EVM_URL}/faucet/evm` and `${FAUCET_SOL_URL}/faucet/sol` with the derived addrs, (d) polls chain RPCs for balance ≥ threshold within 30s, (e) starts the `@anyone-protocol/anyone-client` SOCKS5 daemon, (f) marks `GET /healthz` ready.
**And** `GET /signer-info` returns `{evm: "0x...", sol: "...", balances: {...}}` — pubkeys only, never privkeys.

**AC #2 — `POST /publish` round-trip:**
**Given** the pod is healthy AND `targetHostname` is a reachable `.anyone` HS
**When** a client POSTs `/publish` with body `{event: <signed Nostr event>, targetHostname: "<hostname>.anyone"}`
**Then** the pod SOCKS5-dials the target HS, signs an EIP-712 BTP claim, publishes via `@toon-protocol/client`, and returns `202 {eventId, claimHash, chainId, publishedAt}` within 90s.
**And** request + response shapes validate against `packages/townhouse/contracts/foreign-publish.schema.json` (ajv strict mode).
**And** non-OK relay response returns `502 {error, relayAck}` — no silent swallow.

**AC #3 — Runtime-mutable target HS (no restart):**
**Given** the pod has just published to `targetHostname: hs-A`
**When** the same pod is called with `targetHostname: hs-B` (different `.anyone` hostname)
**Then** the second publish succeeds without a pod restart, dialing hs-B via SOCKS5, and both publishes land on their respective relays.
**And** the pod has no `TARGET_HOSTNAME` env var baked at deploy time — the target is per-request.

**AC #4 — Local townhouse sees Akash-rooted channel (carry-forward from 49.1 AC #2):**
**Given** AC #2 has succeeded against operator A's local `townhouse hs up` apex
**When** the test invokes `townhouse channels --json` against A's connector
**Then** the output contains a channel with `peerId === <pod's EVM pubkey>` AND `status === 'open'`.

**AC #5 — Peer-type classification (carry-forward from 49.1 AC #4):**
**Given** AC #4's channel is open
**When** A's peer-type-resolver runs over the post-publish channels snapshot
**Then** the Akash pod's pubkey resolves to `'external'` (NOT `'self'`, NOT `'town'`, NOT `'mill'`).

**AC #6 — Real `.anyone` transport, no clearnet bypass:**
**Given** the pod environment
**When** the test inspects the publish path
**Then** the SOCKS5 dial goes through the pod's local `@anyone-protocol/anyone-client` daemon; no `127.0.0.1`, no direct clearnet WSS to the relay.
**And** `targetHostname` matches `/^[a-z2-7]+\.(anyone|anon)$/` (v3 base32 alphabet, per 49.1 AC #3.2).
**And** chain RPCs ARE on clearnet (NOT routed through SOCKS5) — assert via inspecting `connector.rpcTransport !== 'socks5'`.

**AC #7 — No app-layer idempotency (trust event-id dedup):**
**Given** retries reuse the SAME signed event object (no `created_at` re-stamping)
**When** the same event is POSTed twice
**Then** the relay deduplicates by `event.id` (SHA-256 of the canonical event) — pod has no idempotency cache, no `X-Idempotency-Key` header.
**And** documented in the schema-contract spec: "Idempotency is handled at the Nostr layer. Pod is stateless w.r.t. replay."

**AC #8 — Persistent-deployment discipline:**
**Given** the pod is a long-lived Akash lease (NOT ephemeral per CI run)
**When** the story closes
**Then** the story footer names ONE lease owner (a pubkey, not "the team").
**And** a monthly AKT-burn budget AC is stated with a 50% drain alert threshold.
**And** a sunset calendar reminder is filed for when Epic 49 retires (close the lease).
**And** an orphan-lease detector cron is added to CI listing active leases vs an allowlist, paging on unknown.

**AC #9 — Pod rate limit (faucet-burn guard):**
**Given** a fat-finger hostname could cause the pod to publish into the void, draining faucet funds
**When** `POST /publish` exceeds N publishes/min from a single source IP
**Then** the pod returns `429 {error: "rate_limited", retryAfterSec}`.
**And** the rate-limit is at the POD, not the faucet (faucet stays dumb per 49.2).

**AC #10 — Smoke runs against live Akash AND local townhouse:**
**Given** the local `townhouse hs up` apex is running and `targetHostname` is the local `.anyone` hostname
**When** the test POSTs `/publish` to the live Akash foreign-pod ingress
**Then** the event lands on the local connector AND AC #4 + AC #5 + AC #6 all hold AND the AC #3 hot-swap demonstrates with a second hostname.
**And** results documented in `### Review Findings` per 47.5/48.7/49.1 precedent.

**Out of scope:**
- Auth on `/publish` beyond IP-based rate limit (no JWT/mTLS this story)
- Multi-event batching / streaming publish (one event per request)
- Idempotency / replay cache (AC #7 — trust Nostr semantics)
- AKT balance alerting wire-up (filed as 49.3-followup; this story documents the budget AC + cron, ops wire-up is a separate concern)

**Dependencies:** 49.2 (faucet — for ephemeral key funding); 49.1 (foreign client smoke — precedent for connector + drill assertions); `townhouse hs up` (45.4); existing `deploy/akash/anvil.sdl.yaml` + `solana.sdl.yaml` leases as chain backends.

**FRs:** FR30, FR31 | **NFRs:** NFR5 (real `.anyone` transport), NFR8 (`0o600` mode on any pod-side secret file, though signer keys live in memory only), NFR9 (pod-side admin endpoints `127.0.0.1`-bound where applicable)

---

### Story 49.4: Paid Packet → Earnings Receipt (EVM + SOL on Akash)

As the Townhouse operator,
I want a TOON client's ILP-paid packet to land on my connector and the resulting claim to appear in my earnings data plane on both EVM and Solana settlement chains via the Akash-hosted devnets,
So that the revenue loop is proven end-to-end on shared real infrastructure — not local 127.0.0.1 chain fixtures — for the two chains v0.1 actually transacts on.

**Acceptance Criteria:**

**Given** Story 49.1's smoke has succeeded AND the connector is configured against Akash-Anvil (EVM RPC from `deploy/akash/leases.json` → `anvil.url`)
**When** operator B publishes a paid event with ILP packet `chain=evm`, non-zero claim amount C
**Then** the EVM USDC settlement lands AND `townhouse drill metrics` on A reports `earnings.apex.usdcCents` increase ≥ C within 2 snapshot intervals (≤ 2h wall-clock OR fast-forwarded via fixture clock).

**Given** Akash-Solana is reachable (RPC from `deploy/akash/leases.json` → `solana.url`) AND a Mill peer is running locally to A (`townhouse node add mill`) mediating EVM↔SOL
**When** operator B publishes a paid event with ILP packet `chain=sol`, non-zero claim amount C
**Then** Mill performs the EVM-USDC → SOL-USDC swap AND the SOL settlement lands AND A's earnings aggregator reflects the credit under `earnings.perPeer` with `type: 'mill'` within 2 snapshot intervals.

**Given** the pre-publish snapshot reading P and the post-settle snapshot reading S for either chain
**When** the delta D = S − P is computed
**Then** `|D − C| ≤ 1 USDC-cent` rounding tolerance — no silent drops, no double-counting, no off-by-one. SOL leg tolerance accounts for Mill's documented swap-fee skim (delta against `C × (1 − mill_fee_bps)` ± 1¢).

**Given** the host API at `GET /api/earnings`
**When** queried post-settlement
**Then** the same delta is observable through the JSON surface (parity with `drill metrics`) for both EVM and SOL legs.

**Given** B is a non-Townhouse TOON client
**When** A's earnings aggregator runs
**Then** B's EVM claim appears under `earnings.perPeer` with `type: 'external'`; B's SOL claim (post-Mill swap) appears with `type: 'mill'`. Neither is dropped, neither is silently merged into apex.

**Given** A also has a Town peer (registered via `townhouse node add town`)
**When** that Town peer separately receives a paid EVM event from B
**Then** that claim lands under `earnings.perPeer` with `type: 'town'` and is distinct from both the apex bucket and the mill-mediated SOL bucket.

**Given** Akash-Anvil OR Akash-Solana is unreachable at gate-time
**When** the gate boots
**Then** the gate fails fast with a clear "Akash <chain> RPC unreachable at <url>" message AND points the operator at `scripts/akash-status.sh` for re-deploy guidance — does NOT silently fall back to local `127.0.0.1` chain fixtures.

**FRs:** FR32, FR33 | **NFRs:** NFR5, NFR10

---

### Story 49.5: Live E2E Gate — Real-`.anyone` Loop on Akash EVM + SOL

As a townhouse release engineer closing out Epic 49,
I want a single unattended script that runs the full TOON-client → HS → connector → Mill → earnings loop against real `.anyone` transport AND the Akash-hosted EVM + Solana devnets,
So that the loop is provably green on shared real infrastructure before pilot recruitment and before any v1.0 publish.

**Acceptance Criteria:**

**Given** the gate script `scripts/townhouse-e2e-real-hs.sh`
**When** invoked with no arguments (default chain profile = `evm+sol`)
**Then** it (a) reads the Akash-Anvil and Akash-Solana endpoints from `deploy/akash/leases.json`, (b) probes both for liveness via `scripts/akash-status.sh`, (c) confirms the persistent Akash foreign-client pod from Story 49.3 is reachable at its ingress AND the Akash devnet faucets from Story 49.2 are healthy, (d) executes Story 49.1's smoke topology checks, (e) drives Story 49.4's EVM leg via `POST /publish` against the 49.3 pod with chain=evm, (f) drives Story 49.4's SOL leg (Mill-mediated) via `POST /publish` with chain=sol, and (g) exits 0 iff all succeed.

**Given** the operator wants to scope the gate
**When** invoked with `--chain=evm` OR `--chain=sol`
**Then** only that chain's leg of Story 49.4 runs; default remains `evm+sol`. No `--chain=mina` option exists (out of scope per Epic 49 settlement-chain scope decision; would require an Akash Mina SDL deployment first).

**Given** any AC from Story 49.1 or 49.4 (either chain leg) fails
**When** the failure is detected
**Then** the gate exits non-zero AND prints which AC failed AND which chain leg failed AND captures relevant connector + drill + Mill logs to `./e2e-real-hs-logs/<timestamp>/` for triage.

**Given** Akash-Anvil OR Akash-Solana is unreachable at gate-time (`scripts/akash-status.sh` returns non-2xx for the relevant URL)
**When** the gate runs
**Then** the gate fails fast at the probe step with actionable output (e.g., "Akash-Anvil at <url> returned 503 — redeploy via `scripts/akash-deploy.sh anvil`") — does NOT silently fall back to local `127.0.0.1` Anvil/Solana fixtures.

**Given** the gate is wired into CI
**When** scheduled
**Then** it runs on `workflow_dispatch` ONLY (manual trigger) — never on every PR. The real `.anyone` bootstrap (~60–120s per side) plus Akash devnet RTT (~50–200ms per RPC call) makes it too slow for PR-time. The gate runs on every published rc tag before pilot recruitment fires.

**Given** the gate completes
**When** the story is marked done
**Then** findings (or "no issues found") are documented in `### Review Findings` with a date stamp AND any spec-vs-implementation drift is captured in `_bmad-output/implementation-artifacts/49-5-live-e2e-gate-real-anyone-loop.md`. The gate output AND Akash lease state at gate-time are committed to `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` as the v0.1 readiness artifact.

**FRs:** FR34 | **NFRs:** NFR5, NFR6, NFR18

---

## Epic 50: SOL Settlement via Mill Routing

Operators who run a Mill peer can now receive Solana-USDC settlement from EVM-paying foreign clients via Mill's cross-chain swap routing. Closes the BLOCKED-STRUCTURAL gap carried forward from Epic 49 (Test 6 in `townhouse-dvm-arweave-e2e.test.ts` documented the deferral — Epic 50 replaces that deferral with a live PASS). **Three stories, critical path 50.1 → 50.2 → 50.3.** No new connector cross-repo work required — this is entirely within the `town` mono-repo.

> **Root-cause of BLOCKED-STRUCTURAL (Epic 49.4 OQ-2 resolution):** `townhouse node add mill` writes `mill.config.json` with `swapPairs: []`, which causes `startMill()` to throw `MillConfig.swapPairs MUST be a non-empty array`. Even if Mill started, the foreign pod sends ILP to `g.townhouse.town` (the relay address), not `g.townhouse.mill`. Epic 50 fixes both: (1) swap-pair provisioning so Mill can boot, and (2) the E2E gate drives a payment to `g.townhouse.mill` using `streamSwap` from the SDK (already implemented, Story 12.5). Model 2 (client directly targets Mill) is the viable routing path — per 49.4 OQ-2 investigation, Model 1 (connector routing rules) and Model 3 (background inventory swap) are NOT implementable with current connector code.

**Dependencies:** Epic 49 (all 5 stories done — BLOCKED-STRUCTURAL formally deferred); `packages/mill` (production-ready); `packages/sdk/src/stream-swap.ts` (production-ready); Akash Solana devnet DSEQ 26996029 (live).

| # | Title | Status |
|---|---|---|
| 50.1 | Mill HS-Mode Swap Pair Provisioning | backlog |
| 50.2 | Mill Container + streamSwap Driver in E2E Harness | backlog |
| 50.3 | SOL Settlement E2E Gate — Remove BLOCKED-STRUCTURAL | backlog |

---

### Story 50.1: Mill HS-Mode Swap Pair Provisioning

As the Townhouse operator,
I want `townhouse node add mill` to provision Mill with a working EVM→SOL swap pair configuration,
So that Mill can actually boot and advertise its swap capabilities via kind:10032 without throwing `MillConfig.swapPairs MUST be a non-empty array`.

**Acceptance Criteria:**

**AC #1 — Swap pair written, not empty:**
**Given** the operator runs `townhouse node add mill`
**When** the provisioning pipeline reaches step 3b (write `mill.config.json`)
**Then** the written JSON contains `swapPairs` as a non-empty array with at least one entry where `from.assetCode === 'USDC'`, `from.assetScale === 6`, `from.chain` matches `/^evm:base:\d+$/`, `to.assetCode === 'USDC'`, `to.assetScale === 6`, `to.chain` matches `/^solana:(devnet|mainnet)$/`.
**And** `chains` in the written JSON includes both `'evm'` AND `'solana'` (not just `'evm'` as currently).

**AC #2 — Chain ID derives from operator config:**
**Given** the operator's townhouse config has `chainProviders[0].chainId = '31337'` (Anvil devnet default)
**When** `mill.config.json` is written
**Then** `swapPairs[0].from.chain === 'evm:base:31337'`.
**And** if `chainProviders` is absent or empty, `from.chain` defaults to `'evm:base:31337'` (same Anvil devnet constant used throughout the test suite).

**AC #3 — SOL network defaults to devnet:**
**Given** `nodes.yaml` does NOT contain an explicit `nodes.mill.chains.solana.rpcUrl` override
**When** `mill.config.json` is written
**Then** `swapPairs[0].to.chain === 'solana:devnet'`.

**AC #4 — Swap pair canonical amounts:**
**Given** any provisioning run
**When** `mill.config.json` is written
**Then** `swapPairs[0].rate === '1.0'`, `swapPairs[0].minAmount === '1000'`, `swapPairs[0].maxAmount === '1000000000'`.

**AC #5 — Mill starts without validation error:**
**Given** the provisioned `mill.config.json` (from AC #1–#4)
**When** it is passed to `startMill()` from `packages/mill/src/mill.ts`
**Then** `startMill()` does NOT throw `MillConfig.swapPairs MUST be a non-empty array` — the config is structurally valid.

**AC #6 — `feeBasisPoints` forwarded:**
**Given** the operator has set `nodes.mill.feeBasisPoints: 30` in their config
**When** Mill is provisioned and started
**Then** the `FEE_BASIS_POINTS=30` env var is passed to the Mill container (current orchestrator already reads `feeBasisPoints`; this AC verifies no regression).

**AC #7 — Unit test coverage:**
**Given** `pnpm --filter @toon-protocol/townhouse test src/api/routes/nodes-lifecycle.test.ts`
**When** the test suite runs
**Then** the Mill provisioning branch includes a test asserting `swapPairs[0].from.chain` starts with `'evm:base:'` AND `swapPairs[0].to.chain` starts with `'solana:'`.

**AC #8 — Build clean:**
**Given** `pnpm --filter @toon-protocol/townhouse build`
**When** run after the swapPairs provisioning change
**Then** 0 new TypeScript errors.

**Out of scope:** swap-pair UI (nodes.yaml editor), Mill inventory pre-funding, mainnet swap pair configuration (devnet default is sufficient for v0.1 pilot).

**FRs:** FR39, FR40, FR41 | **NFRs:** NFR21, NFR22

---

### Story 50.2: Mill Container + streamSwap Driver in E2E Harness

As the townhouse release engineer,
I want the live E2E gate to start a Mill container and drive a SOL-settlement payment through it using the SDK's `streamSwap` function,
So that the full EVM→Mill→SOL swap path is exercised in the same harness that already tests the DVM Arweave upload and ILP earnings loop.

**Acceptance Criteria:**

**AC #1 — Mill container launched in harness:**
**Given** `beforeAll` in `townhouse-dvm-arweave-e2e.test.ts` runs
**When** the HS stack (connector + town relay + DVM) is up and healthy
**Then** a Mill container is started via `docker run -d --name townhouse-hs-mill --network townhouse-hs-net -p 127.0.0.1:3200:3200 ...` using the Mill image from `dist/image-manifest.json` key `'mill'`.
**And** `CONNECTOR_URL` is set to the connector BTP WebSocket URL reachable within `townhouse-hs-net`.
**And** `MILL_CONFIG_JSON` is set to the swap-pair-populated config (from Story 50.1 provisioning path).
**And** `NODE_NOSTR_SECRET_KEY` is set to the deterministic Mill secret key derived from the test HD wallet.

**AC #2 — Mill BLS health:**
**Given** the Mill container was started (AC #1)
**When** `GET http://127.0.0.1:3200/health` is polled
**Then** it returns HTTP 200 with `{status: 'ok'}` within 60s wall-clock.

**AC #3 — kind:10032 discovery:**
**Given** Mill is healthy (AC #2)
**When** the test subscribes to the apex town relay for kind:10032 events from Mill's pubkey
**Then** at least one kind:10032 event is received within 30s, and its `swapPairs` field contains an EVM→SOL entry matching the provisioned config.

**AC #4 — streamSwap drive:**
**Given** Mill's pubkey and swap pair discovered from kind:10032 (AC #3)
**When** the test drives `streamSwap({ client, millPubkey, millIlpAddress: 'g.townhouse.mill', pair, senderSecretKey: B_SECRET_KEY_BYTES, chainRecipient: B_SOL_ADDRESS, totalAmount: 1_000_000n, packetCount: 1 })`
**Then** `result.status === 'success'` AND `result.packets.fulfilled === 1`.

**AC #5 — FULFILL contains SOL claim:**
**Given** `streamSwap` returns `status: 'success'` (AC #4)
**When** `result.claims[0]` is inspected
**Then** `claim.chain` matches `/^solana:/` AND `claim.recipient === B_SOL_ADDRESS` AND `claim.amount` is within ±1 of `1_000_000n × (1 − mill_fee_bps / 10_000)`.

**AC #6 — Mill container cleaned up:**
**Given** `afterAll` runs (whether tests pass or fail)
**When** cleanup executes
**Then** `docker rm -f townhouse-hs-mill` is called AND `docker logs townhouse-hs-mill` is captured to the `e2e-49-5-logs/<ts>/mill.log` failure log directory before removal.

**AC #7 — `MILL_CONTAINER_NAME` constant:**
**Given** the test file
**When** the Mill container name is referenced
**Then** it uses a `MILL_CONTAINER_NAME = 'townhouse-hs-mill'` constant (matching the DVM pattern: `DVM_CONTAINER_NAME = 'townhouse-dvm'`).

**AC #8 — Build clean:**
**Given** `pnpm --filter @toon-protocol/townhouse build`
**When** run after harness changes
**Then** 0 new TypeScript errors.

**Out of scope:** multi-packet streaming (packetCount: 1 is sufficient for gate validation), Mill inventory pre-funding automation (test uses faucet-funded addresses from `deploy/akash/leases.json`), Mill TUI dashboard integration.

**Dev Notes:**
- `B_SOL_ADDRESS`: derive from `B_PRIVATE_KEY`'s HD path for Solana (`m/44'/501'/4'/0'`) using `ed25519-hd-key` (same approach as `entrypoint-mill.ts`); OR use the deterministic Akash Solana devnet faucet address from `infra/solana/keys/faucet-authority.json`.
- `MILL_CONFIG_JSON`: construct inline in `beforeAll` using the same chain-ID and swap-pair logic as Story 50.1's provisioning path — do NOT call `townhouse node add mill` (test manages containers directly).
- Mill's Nostr secret key: read from the test HD wallet at the `'mill'` node derivation path (same path the orchestrator uses via `deriveNodeKey('mill', …)`).

**FRs:** FR42, FR43 | **NFRs:** NFR20, NFR23, NFR24

---

### Story 50.3: SOL Settlement E2E Gate — Remove BLOCKED-STRUCTURAL

As the townhouse release engineer closing out the Epic 49 BLOCKED-STRUCTURAL deferral,
I want Test 6 in `townhouse-dvm-arweave-e2e.test.ts` to exercise a real SOL settlement loop (using the Mill container and `streamSwap` driver from Story 50.2) and exit green,
So that the SOL leg is provably live on Akash Solana devnet and the BLOCKED-STRUCTURAL marker is retired.

**Acceptance Criteria:**

**AC #1 — BLOCKED-STRUCTURAL removed:**
**Given** `townhouse-dvm-arweave-e2e.test.ts`
**When** Test 6 runs
**Then** the `console.warn("SOL leg BLOCKED-STRUCTURAL — deferred to Epic 50 (Mill routing layer)")` call is gone AND `it.skip` is NOT used — Test 6 is a live, non-skipped test that asserts real settlement.

**AC #2 — streamSwap result passes:**
**Given** the Mill container is healthy (Story 50.2 AC #2)
**When** Test 6 drives `streamSwap` to `g.townhouse.mill`
**Then** `result.status === 'success'` AND the FULFILL SOL claim is non-null (Story 50.2 AC #4–#5 assertions).

**AC #3 — Solana devnet confirmation:**
**Given** the SOL claim from AC #2
**When** the claim's `chain` is `solana:devnet` AND its `chainId` matches the Akash Solana devnet DSEQ 26996029 chain
**Then** the claim amount matches the `totalAmount` within ±1 USDC-cent rounding.

**AC #4 — `/api/earnings` type:'mill' entry:**
**Given** `streamSwap` completed (AC #2)
**When** the test polls `GET ${HS_API}/api/earnings` for up to 150s (5s interval)
**Then** at least one claim entry with `direction === 'inbound'` AND `type === 'mill'` AND `amount` within ±10_000n of `1_000_000n` AND `at >= testStartMs` is found.
**And** if the endpoint returns HTTP 404, the assertion is gracefully skipped (matching the same 404-guard pattern as Test 3's earnings poll, AC #4 Epic 49.5).

**AC #5 — `PeerTypeResolver.resolvePeerType('mill')` still passes:**
**Given** Mill is registered in `nodes.yaml` by the test harness
**When** `PeerTypeResolver.resolvePeerType('mill')` is called
**Then** it returns `'mill'` — the resolver integration from Story 49.4 Test 5 is NOT regressed.

**AC #6 — Gate script SOL leg:**
**Given** `scripts/townhouse-e2e-real-hs.sh` is invoked with `--chain=sol`
**When** it runs
**Then** the SOL leg executes (not a stub comment) AND exits 0 on success, non-zero on failure.
**And** the SOL leg emits `SOL leg PASS (Mill streamSwap, txid: <claim>)` to stdout on success.

**AC #7 — Full gate still green:**
**Given** `RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration`
**When** all 6 tests in `townhouse-dvm-arweave-e2e.test.ts` run (Tests 1–6)
**Then** all 6 PASS — no regression to Tests 1–5 from adding Test 6's real Mill interaction.

**AC #8 — Test 6 timeout:**
**Given** Test 6 runs
**When** it is registered
**Then** it has a vitest `{ timeout: 200_000 }` option (200s ≥ NFR24's 180s minimum, matching the 150s Test 3 budget + Mill overhead).

**AC #9 — Review Findings:**
**Given** the story is complete
**When** the story is marked done
**Then** `### Review Findings` in the story file contains a dated entry with per-AC outcome + gate run evidence, and `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` is updated to reflect SOL leg status: PASS.

**Out of scope:** Mina settlement (no Akash Mina deployment; deferred to a future epic); multi-Mill load balancing; Mill inventory refill automation.

**Dependencies:** Story 50.1 (swap-pair provisioning); Story 50.2 (Mill container + streamSwap driver).

**FRs:** FR43, FR44, FR45 | **NFRs:** NFR20, NFR23, NFR24

---
