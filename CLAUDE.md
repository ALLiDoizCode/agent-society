# TOON Protocol

ILP-gated Nostr relay. Pay to write, free to read.

## How It Works (30-second mental model)

TOON Protocol = **pay-to-write Nostr over Interledger (ILP)**. A "write" is an ILP packet carrying a TOON-encoded Nostr event plus a **signed off-chain payment-channel claim** (an EIP-712 balance proof against an on-chain `TokenNetwork` deposit). A **connector** (`@toon-protocol/connector`) validates the claim, takes a fee, routes by ILP address, and the destination node returns FULFILL (accepted) or REJECT. Reads are free. Three service-node types earn fees:

- **town** — the Nostr relay (pay-per-event publish).
- **dvm** — NIP-90 Data Vending Machine compute jobs (e.g. kind:5094 = Arweave blob storage; the job request *is* the payment).
- **mill** — multi-chain swap peer (pay asset A → receive asset B + a signed target-chain claim).

**Townhouse** (`@toon-protocol/townhouse`, the operator product) runs an **apex** = the connector (nodeId `g.townhouse`, the *parent*) + town/mill/dvm containers (its *children*), via `npx @toon-protocol/townhouse init → up → node add`. The canonical `townhouse up` boots a **direct-BTP apex** (default since the Phase-3 default flip): the connector's BTP port is exposed to the host (`ws://host:3000/btp`, bound to `127.0.0.1` unless `TOWNHOUSE_BTP_BIND=0.0.0.0`) and clients dial it directly — no hidden service. **Hidden-service mode is now opt-in** via `townhouse hs up` (boots the same apex behind an ATOR `.anon` HS, reachable through a SOCKS5h proxy); `townhouse hs enable` switches a running direct apex to HS. The direct default refuses to clobber an existing HS apex (back-compat guard keyed on `connector.yaml` `anon.enabled:true`). dev/direct/HS stacks are port-mutually-exclusive. `up --dev` = the old contributor children-only dev stack. Compose templates: `packages/townhouse/compose/townhouse-direct.yml` (direct) vs `townhouse-hs.yml` (HS). Clients pay the apex over BTP; the apex validates their claim, takes its fee, and forwards to the child **for free** — *parent→child packets carry no per-packet claim* (settled in aggregate). This requires the child to be registered `relation:'child'` AND to tag the apex's nodeId `g.townhouse` as its parent (`TOON_PARENT_PEER_ID`) — get either wrong and paid traffic to the child is rejected (T00/F06).

Deep dive: [README "How It Works"](README.md#how-it-works) · [docs/architecture.md](docs/architecture.md) · [docs/protocol.md](docs/protocol.md) · operator quickstart: [packages/townhouse/README.md](packages/townhouse/README.md) · canonical rules/decisions: `_bmad-output/project-context.md`.

> **All coding rules, patterns, conventions, and architecture details are in `_bmad-output/project-context.md`** -- loaded automatically by BMAD workflows. This file covers only setup, deployment, and troubleshooting. Do NOT duplicate rules or patterns here.

---

## Quick Reference

```bash
# Build & test
pnpm install && pnpm build                 # Build all packages
pnpm --filter <pkg> test                   # Test ONE package (e.g. @toon-protocol/client)
pnpm --filter <pkg> build                  # Build ONE package (prefer over root `pnpm build`)
pnpm lint && pnpm format                   # Lint & format
# ⚠️ NEVER run `pnpm test` at workspace root — it spawns 17 parallel vitest
#    processes and will exhaust RAM. Always test per-package with --filter.
# ⚠️ NEVER run `pnpm build` at workspace root from sub-agents — it builds 17+
#    packages and can exhaust RAM. Use `pnpm --filter <pkg> build` instead.
#    Root-level `pnpm build` is OK from the main conversation only when needed.
# ⚠️ pet-circuit tests (o1js/WASM) are extremely memory-heavy (~2-4 GB).
#    SKIP `pnpm --filter @toon-protocol/pet-circuit test` from sub-agents.
#    Only run pet-circuit tests from the main conversation with explicit user approval.
# ⚠️ Sub-agents MUST set timeouts on all Bash commands (timeout: 60000 for
#    builds, 120000 for tests) and NEVER run long processes in background
#    without cleanup. Orphaned Node processes exhaust system memory.

# SDK E2E infrastructure (multi-hop routing, payment channels, DVM lifecycle, swaps)
./scripts/sdk-e2e-infra.sh up              # Build, start Anvil + 2 Docker peers, wait for health
./scripts/sdk-e2e-infra.sh down            # Stop containers
cd packages/sdk && pnpm test:e2e:docker    # Run SDK E2E tests against infra
cd packages/sdk && pnpm test:integration   # Run SDK integration tests against infra

# Mill (multi-chain token swap peer)
pnpm --filter @toon-protocol/mill test                # Unit tests
pnpm --filter @toon-protocol/mill test:integration    # Integration tests (in-process)
pnpm --filter @toon-protocol/mill test:e2e:docker     # Docker E2E (requires sdk-e2e-infra up)

# Forge-UI (decentralized git forge SPA)
cd packages/rig && pnpm dev                # Vite dev server
cd packages/rig && pnpm build              # Production build
node scripts/deploy-forge-ui.mjs --dev     # Deploy to Arweave (free tier)
node scripts/deploy-forge-ui.mjs --wallet <path> # Deploy to Arweave (paid)

# Oyster CVM (TEE) build
docker build -f docker/Dockerfile.oyster -t toon:oyster .

# Nix reproducible Docker image (requires Nix)
nix build .#docker-image && docker load < result
```

---

## Prerequisites

- Docker & Docker Compose
- Node.js >=20, pnpm 8.15.0 (`corepack enable && corepack prepare pnpm@8.15.0 --activate`)
- Connector contracts repo cloned at `../connector` (required for Anvil contract deployment in SDK E2E)
- memvid sibling repo cloned at `../memvid` (required for `docker/Dockerfile.dvm` build — `packages/memvid-node` depends on the `memvid-core` Rust crate via `path = "../../../memvid"`):
  ```
  git clone https://github.com/ALLiDoizCode/memvid ../memvid
  ```
- (Optional) Nix package manager for reproducible builds

See `_bmad-output/project-context.md` section "Technology Stack & Versions" for exact version constraints and compiler options.

---

## Deployment Verification

```bash
# Health checks (SDK E2E infra)
curl http://localhost:19100/health   # Peer1 BLS
curl http://localhost:19110/health   # Peer2 BLS
curl http://localhost:18545           # Anvil (JSON-RPC, returns error object = healthy)

# E2E validation (requires SDK E2E infra: ./scripts/sdk-e2e-infra.sh up)
cd packages/sdk && pnpm test:e2e:docker    # SDK Docker E2E (DVM lifecycle, publish, settlement)
cd packages/sdk && pnpm test:integration   # SDK integration tests
cd packages/mill && pnpm test:e2e:docker   # Mill Docker E2E (multi-chain swap flows)
cd packages/town && pnpm test:e2e          # Town E2E (lifecycle)

# View logs
docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs -f
docker compose -p toon-sdk-e2e -f docker-compose-sdk-e2e.yml logs -f peer1  # Peer1 only
```

---

## Troubleshooting

**SDK E2E tests failing:**

1. `./scripts/sdk-e2e-infra.sh up` -- Infrastructure running?
2. `curl http://localhost:19100/health` -- Peer1 healthy?
3. `curl http://localhost:19110/health` -- Peer2 healthy?
4. `./scripts/sdk-e2e-infra.sh down && ./scripts/sdk-e2e-infra.sh up` -- Restart infra

**Mill / swap tests failing:**

1. Ensure SDK E2E infra is running: `./scripts/sdk-e2e-infra.sh up`
2. Mill unit tests are self-contained: `pnpm --filter @toon-protocol/mill test`
3. Mill integration tests use in-process fixtures (no Docker needed): `pnpm --filter @toon-protocol/mill test:integration`
4. Mill Docker E2E tests need infra: `pnpm --filter @toon-protocol/mill test:e2e:docker`
5. If swap claims fail, check connector version -- must be `@toon-protocol/connector` ^3.3.2 (v2.0.0 changed `ctx.accept()` return shape)

**Connector API drift / breaking change suspected:**

1. Run the contract canary: `pnpm --filter @toon-protocol/sdk test:integration -- tests/integration/connector-contract.test.ts` (expected <2s, ceiling 60s)
2. If it fails, see `packages/sdk/CONNECTOR_MIGRATION.md` for the version-to-version contract mapping and migration steps
3. Update both the canary and the migration doc when bumping `@toon-protocol/connector`

**Akash deploys (`scripts/akash-deploy.sh`) failing with `require_env AKASH_CONSOLE_API_KEY`:**

Akash uses the Console managed-wallet REST API (`x-api-key` header), not a mnemonic. The key (format `ac.sk.production.*`) is exported in `~/.bashrc`, but `.bashrc` returns early for non-interactive shells, so it is NOT present in scripted/agent shells. Load it explicitly before running the deploy script:

```bash
eval "$(grep -E '^export AKASH_CONSOLE_API_KEY=' ~/.bashrc)"
./scripts/akash-deploy.sh <target>
```

(Create/rotate keys at https://console.akash.network → profile → API Keys. Override the endpoint with `AKASH_CONSOLE_API_URL`; default is `https://console-api.akash.network`.)

**Port conflicts:** See `_bmad-output/project-context.md` section "Deployment" for full port allocation table. Key ranges:

- SDK E2E: Anvil 18545, Peer1 19000/19100/19700, Peer2 19010/19110/19710
- Townhouse Dev Stack: 28xxx range (see table below)
- Oyster CVM attestation server: 1300

### Townhouse Dev Stack (28xxx)

All bindings on `127.0.0.1:` only. Script: `scripts/townhouse-dev-infra.sh`. Contributor docs: `packages/townhouse/CONTRIBUTING.md`.

**Two separate scripts — different missions:**
- `scripts/townhouse-dev-infra.sh` — contributor dev loop (multi-peer, deterministic keys, 28xxx ports, SOCKS5, chain devnets). Use for dashboard development.
- `scripts/townhouse-test-infra.sh` — real-CLI E2E gate (warms image cache only; tests run the real `townhouse init`+`townhouse up` CLI against fresh config dirs). Use for pre-publish validation. Ports: 9400 (Fastify API), 9401 (connector admin). See `packages/townhouse/CONTRIBUTING.md` § "Running E2E Tests".

| Host Port | Container Port | Service |
|-----------|---------------|---------|
| 28080 | 9401 | Connector admin (`/health`, `/admin/*`) |
| 28050 | 1080 | SOCKS5 proxy (ATOR transport testing, story 21.15) |
| 28100 | 3100 | town-01 BLS health |
| 28110 | 3100 | town-02 BLS health |
| 28200 | 3200 | mill-01 BLS health (EVM↔Solana) |
| 28210 | 3200 | mill-02 BLS health (EVM↔Mina) |
| 28400 | 3400 | dvm-01 BLS health |
| 28700 | 7100 | town-01 Nostr relay WebSocket |
| 28710 | 7100 | town-02 Nostr relay WebSocket |
| 28545 | 8545 | Anvil JSON-RPC (chain-id 31337) |
| 28899 | 8899 | Solana test-validator RPC |
| 28900 | 8900 | Solana test-validator WebSocket |
| 28085 | 3085 | Mina lightnet GraphQL |
| 28181 | 8181 | Mina lightnet accounts manager |

> **Solana swap redeemability (EVM→Solana):** `up` bootstraps the deterministic Mock USDC mint (`6Gbdr…`) + faucet treasury on the dev validator (idempotent, reusing `infra/solana/bootstrap-usdc.mjs`). The **on-chain swap channel is NOT opened** — it's a runtime PDA of `(participantA, participantB, mint, program)` + an on-chain deposit, not statically reproducible. So the mill signs valid off-chain `solana:devnet` claims and EVM→Solana swaps verify at the **claim-issuance layer only** on this devnet (not on-chain redeemable). See `packages/townhouse/CONTRIBUTING.md` § "Solana swap redeemability" and issue #82.

---

## Where to Find Things

| Topic | Location |
| --- | --- |
| **All coding rules, patterns, conventions** | `_bmad-output/project-context.md` |
| Connector release contract (semver discipline) | `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` |
| Connector API contract + migration history | `packages/sdk/CONNECTOR_MIGRATION.md` |
| Connector contract canary test | `packages/sdk/tests/integration/connector-contract.test.ts` |
| HyperBEAM integration strategy & R&D phases | `_bmad-output/planning-artifacts/research/toon-hyperbeam-integration-strategy.md` |
| Claude Agent Skills (55 skill directories) | `.claude/skills/` |
| NIP-to-TOON Skill Pipeline | `.claude/skills/nip-to-toon-skill/SKILL.md` |
| Skill Eval Framework | `.claude/skills/skill-eval-framework/SKILL.md` |
| Skill structural validation tests | `tests/skills/`, `packages/core/src/skills/` |
| Epic 9 retrospective | `_bmad-output/auto-bmad-artifacts/epic-9-retro-report.md` |
| Oyster CVM Dockerfile & compose | `docker/Dockerfile.oyster`, `docker/docker-compose-oyster.yml` |
| SDK E2E peer Dockerfile | `docker/Dockerfile.sdk-e2e` (built as `toon:sdk-e2e` by `scripts/sdk-e2e-infra.sh`) |
| SDK E2E Docker compose | `docker-compose-sdk-e2e.yml` |
| Nix reproducible build flake | `flake.nix` (root) |
| Attestation server source | `docker/src/attestation-server.ts` |
| Docker entrypoint (embedded connector) | `docker/src/entrypoint-sdk.ts` |
| Mill package (multi-chain swap peer) | `packages/mill/` |
| Mill entrypoint + CLI | `packages/mill/src/mill.ts`, `packages/mill/src/cli.ts` |
| **Agent client (MCP + daemon)** | `packages/client-mcp/` (bins: `toon-clientd`, `toon-mcp`) |
| Client daemon (connection owner) | `packages/client-mcp/src/daemon.ts`, `src/daemon/` (config, lifecycle, client-runner, routes) |
| Client MCP stdio server + tools | `packages/client-mcp/src/mcp.ts`, `src/mcp-tools.ts` |
| Client persistent relay subscription (free reads) | `packages/client-mcp/src/relay-subscription.ts` |
| Client control API + HTTP client | `packages/client-mcp/src/control-api.ts`, `src/control-client.ts` |
| `toon-client` agent skill | `.claude/skills/toon-client/SKILL.md` |
| Client-MCP live-HS gated E2E (`RUN_LIVE_HS_E2E=1`) | `packages/client-mcp/src/__integration__/live-hs-daemon.integration.test.ts` |
| **`toon` Claude Code plugin** (skill + MCP server, one-step install) | `toon-plugin/` (`plugin.json`, `.mcp.json`, `skills/toon-client/`); marketplace manifest at repo-root `.claude-plugin/marketplace.json`. Install: `/plugin marketplace add toon-protocol/town` → `/plugin install toon@toon`. Docs: `toon-plugin/README.md` |
| SDK swap modules (gift-wrap, handler, stream, settlement) | `packages/sdk/src/gift-wrap.ts`, `swap-handler.ts`, `stream-swap.ts`, `settlement/` |
| SwapPair validation + chain-id | `packages/core/src/events/swap-pair-validation.ts`, `packages/core/src/chain/chain-id.ts` |
| Content publishing pipeline | `_bmad-output/planning-artifacts/content-strategy-2026-q1.md` |
| Content publishing workflow | `_bmad-output/planning-artifacts/content/publish-workflow.md` |
| Character spec (brand voice) | `_bmad-output/planning-artifacts/content/character-spec.md` |
| Article drafts | `_bmad-output/planning-artifacts/content/article-N/` |
| Prepaid protocol decisions | `_bmad-output/planning-artifacts/research/party-mode-prepaid-protocol-decisions-2026-03-20.md` |
| Network primitives strategy (four primitives) | `_bmad-output/planning-artifacts/research/party-mode-network-primitives-strategy-2026-03-22.md` |
| Overmind Protocol decisions (Epics 13-17) | `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md` |
| Overmind epics & stories | `_bmad-output/overmind-epics-and-stories.md` |
| Arweave integration research | `_bmad-output/planning-artifacts/research/technical-arweave-integration-research-2026-03-24.md` |
| Forge-UI source (Vite SPA) | `packages/rig/src/web/` |
| Forge-UI Arweave deploy script | `scripts/deploy-forge-ui.mjs` |
| Rig pointer deploy script | `scripts/deploy-rig-pointer.mjs` |
| Repo announcement creation script | `scripts/create-rig-repo.mjs` |
| Rig usage guide | `docs/rig-guide.md` |
| Socialverse E2E orchestrator | `scripts/socialverse-e2e.ts` |
| Mock USDC deployment script | `scripts/deploy-mock-usdc.sh` |
| Dev Signal template (for Drew) | `_bmad-output/dev-signals/_template.md` |
| Dev Signal archive | `_bmad-output/dev-signals/` |
| Dev Signal command | `.claude/commands/dev-signal.md` (invoke via `/dev-signal`) |
| **Townhouse dev stack** | `scripts/townhouse-dev-infra.sh` + `docker-compose-townhouse-dev.yml` |
| Townhouse dev stack docs | `packages/townhouse/CONTRIBUTING.md` § "Local Dev Loop" |
| Townhouse dev stack fixtures | `docker/dev-fixtures/` (Mill JSON configs + README) |
| **Townhouse real-CLI E2E** | `scripts/townhouse-test-infra.sh` (Story 21.16) |
| Townhouse real-CLI E2E docs | `packages/townhouse/CONTRIBUTING.md` § "Running E2E Tests" |
| **Local-HS E2E (Akash chains)** | `scripts/townhouse-e2e-local-hs.sh` + `docker-compose-e2e-local-client.yml` |
| Local-HS E2E smoke test | `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts` (gated by `RUN_LOCAL_HS_E2E=1`) |
| **Townhouse npm-tarball compose templates** | `packages/townhouse/compose/` (source) → `dist/compose/` (built output) |
| Compose loader + materializer API | `packages/townhouse/src/compose-loader.ts` |
| Image-manifest digest registry (per release) | `packages/townhouse/dist/image-manifest.json` (CI-produced; not committed) |
| DockerOrchestrator HS-profile entry point | `packages/townhouse/src/docker/orchestrator.ts` (`upHs`, `waitForHsHostname`) |
| Townhouse `up` (direct apex, **default**) / `hs up` / `hs enable` / `hs down` CLI | `packages/townhouse/src/cli.ts` `handleDirectUp` (default `up`) / `handleHsUp` / `handleHsEnable` / `handleHsDown`; back-compat guard via `detectExistingHsConfig` (`hs-config-writer.ts`) |
| Townhouse direct-apex compose template (exposes BTP `:3000`) | `packages/townhouse/compose/townhouse-direct.yml` → `dist/compose/townhouse-direct.yml`; `TOWNHOUSE_BTP_BIND` host bind |
| **Multi-chain settlement operator runbook** (Solana + Mina recovery) | `packages/townhouse/RUNBOOK.md` (connector-restart route loss, nonce-watermark persistence, SettlementMonitor `IN_PROGRESS` wedge, town inbound-session race, Mina zkApp reset) |

## Browser Verification

Use the `playwright-cli` skill (invoke via `/playwright-cli`) for browser-related tasks: verifying UI changes, debugging console/network issues, and automating E2E flows. Prefer snapshots over screenshots when interacting with elements.

## UI Work

Use the shadcn CLI (`npx shadcn@latest`) for adding, updating, and managing UI components. See https://ui.shadcn.com/docs/cli. Prefer `shadcn add <component>` over hand-rolling primitives, and use the `shadcn` skill for registry lookups, component composition, and styling guidance.
