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

**Telemetry (v0.1 Validation Gate)**

- **FR30:** The system SHALL send anonymous telemetry pings via `POST https://telemetry.toon-protocol.dev/v1/townhouse-pulse` every 7 days from operator first-boot timestamp (jittered ±6h) when telemetry is opted in
- **FR31:** The telemetry payload SHALL conform to a zod-validated schemaVersion=1 contract carrying: operator hash (sha256 of pubkey + STATIC_SALT), townhouseVersion, weekNumber, enabledNodes[], earnings (apex + perPeer with `'external'` allowed in the type union), metrics (eventsRelayed, uptimeSeconds, peerCount), flags (isTestnet, chainProfile)
- **FR32:** During `townhouse init`, the system SHALL prompt for telemetry opt-in with disclosure copy explaining what is sent; pilot operators SHALL be informed during recruitment that opt-in is required for participation
- **FR33:** The system SHALL provide `townhouse telemetry on|off|status` for runtime control of telemetry state
- **FR34:** Failed telemetry POSTs SHALL be retained in a local retry buffer (`~/.townhouse/telemetry.json` `pendingPings[]`) and retried with exponential backoff (1h, 4h, 1d, 3d), then dropped after 4 weeks; operators SHALL never block on telemetry

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

- **NFR5:** Telemetry payload SHALL contain no PII — no IP (Cloudflare strips), no hostname, no `.anyone` address, no wallet pubkey unhashed, no claim IDs, no peer counterparty pubkeys
- **NFR6:** Telemetry server SHALL be behind Cloudflare (DDoS + IP stripping) with Let's Encrypt SSL
- **NFR7:** The connector container SHALL NOT mount or have access to `/var/run/docker.sock`; only the host-side `townhouse-api` Fastify process owns the socket
- **NFR8:** All operator-secret files SHALL be written with mode `0o600`: `nodes.yaml`, `earnings-snapshots.jsonl`, `wallet.enc`, `telemetry.json`, `host.json`
- **NFR9:** All host-side ports SHALL bind to `127.0.0.1` only — never `0.0.0.0`

**Reliability**

- **NFR10:** Telemetry server downtime SHALL NOT block operators — local retry-buffer with exponential backoff (1h, 4h, 1d, 3d) and 4-week max retention
- **NFR11:** Earnings snapshot write SHALL recover from mid-write truncation — next boot reads to the last well-formed JSONL line without crashing
- **NFR12:** Earnings snapshot retention SHALL be ≥13 months for YEAR-over-YEAR delta computation across calendar boundaries

**Compatibility**

- **NFR13:** TUI SHALL render correctly at 80×24 (iPhone Termius baseline); column degradation order: sparklines collapse first, asset rows last
- **NFR14:** TUI SHALL be tmux-compatible — never `clear()` the full screen, respect `$TMUX`, leave operator pane geometry alone
- **NFR15:** The townhouse package SHALL run on Node.js >= 20 with TypeScript ^5.3 and ESM-only modules
- **NFR16:** Connector v3.5.0 (carrying CR-1; current connector main is v3.4.2 post-#57) SHALL maintain backward compatibility with the townhouse-pinned admin API surface — only `/admin/*` field additions are permitted; renames or removals require a major bump

**Quality Gate**

- **NFR17:** Pre-publish quality gate SHALL require all of: unit + integration green, connector contract canary green at the digest pinned in source (NOT `:latest`), image-contract test green at pinned digest, real-CLI E2E green via `scripts/townhouse-test-infra.sh`, Playwright `e2e:real` green, cosign signature verification green
- **NFR18:** Validation gate decision (v1.0 launch fork) SHALL fire on actual telemetry data, not subjective judgment — median weekly USDC across the 5 v0.1 pilot operators determines marketing copy: ≥$1.00 (full earnings hero), $0.10–$1.00 (demoted), <$0.10 (delay launch)
- **NFR19:** Empty-state copy library SHALL ship in the same PR as the TUI scaffold story — not as a follow-up ticket

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
- Telemetry instrumentation (TH-21.17.14) ships BEFORE pilot recruitment fires (Mary's 2026-05-25 outreach launch). Validation gate cannot fire on subjective data.

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

**Telemetry Server Infrastructure (open thread)**

- Telemetry endpoint hosting (`telemetry.toon-protocol.dev`), Cloudflare account, Grafana dashboard — owners not yet assigned.

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
| FR30 | Epic 49 | Weekly telemetry POST to `/v1/townhouse-pulse` (jittered ±6h) |
| FR31 | Epic 49 | Zod-validated payload schemaVersion=1 |
| FR32 | Epic 49 | Opt-in flow during `townhouse init` (required for pilot) |
| FR33 | Epic 49 | `townhouse telemetry on\|off\|status` |
| FR34 | Epic 49 | Local retry buffer with exponential backoff |
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
| NFR5 | Epic 49 | Telemetry payload no PII |
| NFR6 | Epic 49 | Cloudflare + Let's Encrypt SSL on telemetry server |
| NFR7 | Epic 45 | No docker.sock inside connector container |
| NFR8 | Cross-cutting (Epic 45, 3, 6) | All operator secrets at file mode 0o600 |
| NFR9 | Epic 45 | All host ports bind to 127.0.0.1 only |
| NFR10 | Epic 49 | Telemetry retry buffer (1h, 4h, 1d, 3d, drop after 4w) |
| NFR11 | Epic 47 | Snapshot mid-write truncation recovery |
| NFR12 | Epic 47 | Snapshot retention ≥13 months |
| NFR13 | Epic 48 | TUI renders correctly at 80×24 |
| NFR14 | Epic 48 | TUI tmux-compatible (no full-screen clears) |
| NFR15 | Cross-cutting | Node.js >=20, TypeScript ^5.3, ESM-only |
| NFR16 | Epic 44 | Connector v3.5.0 backward-compatible with v3.3.3+ admin API surface |
| NFR17 | Cross-cutting | Pre-publish quality gate (6 green checks) |
| NFR18 | Epic 49 | Validation gate fires on telemetry data ($1.00 / $0.10 / <$0.10 forks) |
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

### Epic 49: Telemetry & Validation Gate

Pilot operators opt in to anonymous earnings telemetry; their weekly pings (jittered ±6h) feed the validation-gate dataset that decides v1.0 marketing copy at the $1.00 / $0.10 / <$0.10 weekly-USDC thresholds. The payload carries no PII (no IP — Cloudflare strips, no hostname, no `.anyone` address, no unhashed wallet pubkey, no claim IDs, no peer counterparty pubkeys). Telemetry-server outages never block operators — local retry buffer with exponential backoff (1h, 4h, 1d, 3d, drop after 4 weeks). For the v0.1 pilot, opt-in is required for participation (Mary makes this explicit during recruitment). For the public release, telemetry is genuinely optional. This epic branches from Epic 47 (needs earnings data) but is independent of Epic 48 (TUI not required).

**FRs covered:** FR30, FR31, FR32, FR33, FR34
**NFRs:** NFR5, NFR6, NFR10, NFR18
**UX-DRs:** —
**Depends on:** Epic 47 (NOT Epic 48)

### Cross-Cutting Constraints

These NFRs and UX-DRs apply across multiple epics and are not owned by any single one:

- **NFR8** — file mode `0o600` on every operator-secret file (`nodes.yaml` → Epic 46, `earnings-snapshots.jsonl` → Epic 47, `wallet.enc` → Epic 45, `telemetry.json` → Epic 49, `host.json` → Epic 45)
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

## Epic 49: Telemetry & Validation Gate

Pilot operators opt in to anonymous earnings telemetry; their weekly pings (jittered ±6h) feed the validation-gate dataset that decides v1.0 marketing copy. No PII is collected. This epic branches from Epic 47 (needs earnings data) but is independent of Epic 48 (TUI not required).

### Story 49.1: Telemetry Payload Schema + Zod Validator

As a townhouse engineer,
I want a versioned, zod-validated telemetry payload schema,
So that the validation-gate dataset is type-safe end-to-end and any future schema bump is auditable.

**Acceptance Criteria:**

**Given** the schema file at `packages/townhouse/src/telemetry/schema.ts`
**When** zod validation runs on a payload
**Then** the schema enforces `schemaVersion: 1` (literal) AND the full payload shape: `operatorIdHash`, `townhouseVersion`, `weekNumber`, `enabledNodes: ('town' | 'mill' | 'dvm')[]`, `earnings.apex.usdcCents: number`, `earnings.perPeer: [{ type, usdcCents }]`, `metrics.eventsRelayed/uptimeSeconds/peerCount`, `flags.isTestnet/chainProfile`

**Given** the `'external'` peer-type case
**When** the zod literal union is checked
**Then** `'external'` is included in `perPeer[].type` so non-Townhouse peers connecting through the operator's connector are NOT dropped from the dataset

**Given** the `operatorIdHash` field
**When** computed
**Then** value = `sha256(operatorPubkey + STATIC_SALT)` — non-reversible, deterministic across runs (unit test asserts same input → same hash)

**Given** the payload contains no PII (NFR5)
**When** the schema is reviewed
**Then** there are NO fields for: IP, hostname, `.anyone` address, unhashed wallet pubkey, claim IDs, peer counterparty pubkeys

**Given** unit tests at `packages/townhouse/src/telemetry/__tests__/schema.test.ts`
**When** run
**Then** valid payloads pass round-trip AND invalid payloads (wrong types, missing required fields, unknown enum values) fail with descriptive errors

**FRs:** FR31 | **NFRs:** NFR5

---

### Story 49.2: Opt-In Flow + Disclosure Copy + State File

As a pilot operator,
I want a clear opt-in prompt during `townhouse init` with disclosure copy explaining what is sent,
So that I understand the deal before running a node and the pilot dataset is collected with informed consent.

**Acceptance Criteria:**

**Given** the operator runs `townhouse init` for the first time
**When** the CLI reaches the telemetry step
**Then** the prompt displays the locked disclosure copy: `"You're joining the v0.1 pilot. Townhouse will send anonymous earnings telemetry (peer-id hash, USDC/day, uptime — no IP, no wallet) so we can validate the economics before public launch. This is required for pilot participation. Type 'agree' to continue."`

**Given** the operator types `agree`
**When** the response is captured
**Then** `~/.townhouse/telemetry.json` is created with `{ optedIn: true, firstBootAt: <ISO-8601>, lastPingAt: null, pendingPings: [] }` and file mode `0o600`

**Given** the operator types anything other than `agree`
**When** the response is captured
**Then** `optedIn: false` is written; the operator continues but no pings are sent

**Given** v0.1 pilot recruitment (Mary's outreach)
**When** the operator is recruited
**Then** Mary's recruitment template states explicitly that pilot operators must opt in (process AC, not code AC)

**Given** the post-pilot phase (v1.0 public release)
**When** the disclosure copy is reviewed
**Then** the "required for pilot participation" sentence is replaced with optional language (story for v1.0 release, tracked as a follow-up commit)

**FRs:** FR32 | **NFRs:** NFR8

---

### Story 49.3: Telemetry HTTP Client + Retry Buffer

As the telemetry subsystem,
I want a scheduled HTTP client that POSTs payloads weekly with local retry on failure,
So that telemetry server outages don't block operators and pilot data is never lost to a transient 502.

**Acceptance Criteria:**

**Given** an opted-in operator
**When** the apex process is running
**Then** a scheduler fires every 7 days from `firstBootAt` (jittered ±6h) AND POSTs the current payload to `https://telemetry.toon-protocol.dev/v1/townhouse-pulse`

**Given** the POST succeeds (HTTP 2xx)
**When** the response returns
**Then** `lastPingAt` is updated in `telemetry.json` AND the payload is NOT added to `pendingPings[]`

**Given** the POST fails (network error or non-2xx)
**When** the failure is detected
**Then** the payload is appended to `pendingPings[]` with backoff metadata `{ payload, firstFailedAt, nextAttemptAt }`

**Given** a payload is in `pendingPings[]`
**When** the retry backoff schedule fires (1h, 4h, 1d, 3d after first failure)
**Then** the client re-POSTs

**Given** a payload's `firstFailedAt` is more than 4 weeks old
**When** the next retry would fire
**Then** the payload is dropped from `pendingPings[]` with a `~/.townhouse/telemetry-dropped.log` entry

**Given** the telemetry subsystem
**When** the apex process is operating
**Then** at no point does any operator-facing operation (CLI, TUI, host API) block waiting on telemetry

**Given** the opt-out hard-stop
**When** `optedIn: false`
**Then** the HTTP client is NEVER instantiated (unit test asserts `fetch` is not called when opted out)

**FRs:** FR30, FR34 | **NFRs:** NFR10

---

### Story 49.4: `townhouse telemetry on|off|status` CLI

As an operator who changed my mind,
I want CLI verbs to toggle telemetry on/off and see current state,
So that I can opt out at any time after the initial init prompt.

**Acceptance Criteria:**

**Given** the CLI command `townhouse telemetry status`
**When** invoked
**Then** the CLI prints `optedIn: true|false`, `firstBootAt`, `lastPingAt`, AND the count of pending retries

**Given** `townhouse telemetry off`
**When** invoked on an opted-in operator
**Then** `telemetry.json.optedIn` is set to `false` AND `pendingPings[]` is cleared AND the next scheduled tick is a no-op

**Given** `townhouse telemetry on`
**When** invoked on an opted-out operator
**Then** the CLI prints the disclosure copy AND prompts for `agree` (same as init flow) AND on `agree` flips `optedIn: true` AND records `firstBootAt: <now>`

**Given** any of these CLI verbs
**When** invoked with `--json`
**Then** machine-readable JSON output is emitted

**FRs:** FR33

---

### Story 49.5: Telemetry Receiver Server + Cloudflare + Grafana Dashboard

As the project,
I want a hosted receiver service for telemetry pings with no PII collection at the edge and a dashboard counting weekly active pings,
So that the validation-gate dataset accumulates over the 30-day pilot and we detect telemetry-server outages before they corrupt the dataset.

**Acceptance Criteria:**

**Given** the telemetry endpoint `https://telemetry.toon-protocol.dev/v1/townhouse-pulse`
**When** an operator POSTs a payload
**Then** the request terminates at Cloudflare (DDoS mitigation + IP stripping — origin server never sees client IP) AND uses Let's Encrypt SSL

**Given** the payload arrives at the origin server
**When** persisted
**Then** ONLY the validated payload fields are stored — Cloudflare-stripped IP is not re-derived AND no request headers are persisted alongside the payload

**Given** the receiver service
**When** it accepts a payload
**Then** it validates against the same zod schema (Story 49.1) AND rejects non-conforming payloads with HTTP 400 (so a schema-version drift is observable)

**Given** the Grafana dashboard
**When** rendered
**Then** it shows weekly active pings (count of unique `operatorIdHash` per week) AND a 30% week-over-week drop alert that pages the on-call

**Given** the open-thread infrastructure question
**When** this story is scheduled
**Then** the owner of the Cloudflare account, the domain `telemetry.toon-protocol.dev`, AND the Grafana hosting is named in the story description (block this story until owners are identified)

**Given** server downtime
**When** the receiver is unreachable
**Then** clients retry per Story 49.3 — never lose data

**FRs:** FR30 (server side) | **NFRs:** NFR5, NFR6

---

### Story 49.6: Pilot Day-30 Decision Artifact

As the project,
I want a documented decision at pilot day-30 that fires the validation gate against real data,
So that v1.0 marketing copy is grounded in pilot earnings, not subjective judgment.

**Acceptance Criteria:**

**Given** the v0.1 pilot has been running for 30 days
**When** the day-30 query fires
**Then** the script queries telemetry for the 5 pilot operators' week-4 records AND computes `total_usdc_cents = earnings.apex.usdcCents + sum(earnings.perPeer.usdcCents)` per operator

**Given** the per-operator totals
**When** the median is computed
**Then** the median weekly USDC across the 5 operators is the validation-gate input

**Given** the validation forks
**When** the median is compared to thresholds
**Then** EXACTLY ONE branch fires:
- `median ≥ $1.00/wk` → ship full earnings hero. Marketing: "Earn passive USDC from your homelab."
- `$0.10 ≤ median < $1.00/wk` → demote earnings panel. Hero becomes "events relayed + earnings sub-counter." Marketing: "Run yields, be early."
- `median < $0.10/wk` → DELAY public launch. Earnings UI secondary. Hero pivots to "events relayed + uptime." Marketing: "Be early to the network."

**Given** the decision
**When** it is made
**Then** the decision AND raw data are committed to `_bmad-output/v0.1-pilot-results.md` (public, auditable record)

**Given** the decision artifact
**When** read
**Then** it includes: per-operator weekly USDC, the median, the threshold-fork decision, and any caveats (e.g., one operator had testnet flagged — counted/not-counted, reasoning)

**FRs:** — (process AC)
**NFRs:** NFR18

---

### Story 49.7: Live E2E Gate — Telemetry & Validation

As a **townhouse release engineer** closing out Epic 49 (and through it, the v0.1 pilot launch readiness),
I want to run the complete telemetry user journey end-to-end against the deployed receiver server with real Cloudflare + Grafana wiring,
So that the opt-in flow, payload shape, retry buffer, and CLI controls are verified against the same surface pilot operators will hit — and the validation-gate dataset is provably populated before pilot day-30 (Epic 45 retro A4).

**Acceptance Criteria:**

**Given** a fresh `~/.townhouse/` state AND the deployed telemetry receiver at `telemetry.toon-protocol.dev` is reachable
**When** the operator runs `townhouse init`
**Then** the opt-in disclosure copy renders correctly, the consent prompt is required, AND the operator's choice persists to `~/.townhouse/telemetry.json` with mode `0o600`.

**Given** the operator opted in
**When** the gate forces an immediate telemetry POST (bypassing the ±6h jitter via a debug flag or fixture-clock)
**Then** the receiver server logs a successful payload write AND the Grafana dashboard reflects the new record within 5 minutes
**And** the payload contains NO PII (verified at the receiver side: no IP — Cloudflare strips, no hostname, no `.anyone` address, no unhashed wallet pubkey, no claim IDs, no peer counterparty pubkeys).

**Given** `townhouse telemetry status`
**When** invoked
**Then** the CLI reports the correct opt-in state, last successful POST timestamp, and retry-buffer depth (49.4 verified live).

**Given** `townhouse telemetry off`
**When** invoked
**Then** subsequent ticks emit no network traffic; `telemetry on` re-enables; idempotent on repeat invocations (49.4 verified live).

**Given** a simulated receiver outage (block `telemetry.toon-protocol.dev` at the firewall level for one full tick window)
**When** the next tick fires
**Then** the payload is enqueued to the retry buffer; backoff schedule (1h, 4h, 1d, 3d) is observable in logs; drop-after-4-weeks behavior is asserted by fast-forwarding the fixture clock (49.3 verified live — NFR10).

**Given** the day-30 decision script (49.6)
**When** run against the live receiver's test-fixture dataset
**Then** the script reads the records, computes the median, fires exactly ONE threshold branch ($1.00 / $0.10 / <$0.10), and writes the artifact to `_bmad-output/v0.1-pilot-results.md` (49.6 verified live).

**Given** the gate run completes
**When** the story is closed out
**Then** any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked done
**And** findings (or "no issues found") are documented in `### Review Findings` with a date stamp
**And** Mary signs off that the disclosure copy + opt-in flow are pilot-ready.

**FRs:** FR30–FR34 (full epic validation) | **NFRs:** NFR5, NFR6, NFR10, NFR18
