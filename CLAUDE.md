# TOON Protocol

ILP-gated Nostr relay. Pay to write, free to read.

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

# SDK E2E infrastructure (multi-hop routing, payment channels, DVM lifecycle)
./scripts/sdk-e2e-infra.sh up              # Build, start Anvil + 2 Docker peers, wait for health
./scripts/sdk-e2e-infra.sh down            # Stop containers
cd packages/sdk && pnpm test:e2e:docker    # Run SDK E2E tests against infra
cd packages/sdk && pnpm test:integration   # Run SDK integration tests against infra

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

**Port conflicts:** See `_bmad-output/project-context.md` section "Deployment" for full port allocation table. Key ranges:

- SDK E2E: Anvil 18545, Peer1 19000/19100/19700, Peer2 19010/19110/19710
- Oyster CVM attestation server: 1300

---

## Where to Find Things

| Topic | Location |
| --- | --- |
| **All coding rules, patterns, conventions** | `_bmad-output/project-context.md` |
| Epic roadmap & status (Epics 1-9 complete, 10+ planned) | `_bmad-output/project-context.md` section "Epic Roadmap" |
| TOON Agent Architecture (six-layer model, Loony, provider model) | `_bmad-output/project-context.md` section "TOON Agent Architecture" |
| HyperBEAM integration strategy & R&D phases | `_bmad-output/planning-artifacts/research/toon-hyperbeam-integration-strategy.md` |
| Known action items (Epic 9 retro) | `_bmad-output/project-context.md` section "Known Action Items" |
| Claude Agent Skills (30+ TOON skills, Epic 9) | `.claude/skills/` |
| NIP-to-TOON Skill Pipeline | `.claude/skills/nip-to-toon-skill/SKILL.md` |
| Skill Eval Framework | `.claude/skills/skill-eval-framework/SKILL.md` |
| Skill structural validation tests | `tests/skills/`, `packages/core/src/skills/` |
| Epic 9 retrospective | `_bmad-output/auto-bmad-artifacts/epic-9-retro-report.md` |
| DVM compute marketplace architecture | `_bmad-output/project-context.md` section "DVM Compute Marketplace" |
| Advanced DVM coordination (workflows, swarms, reputation) | `_bmad-output/project-context.md` section "Advanced DVM Coordination + TEE Integration" |
| TEE architecture & attestation flow | `_bmad-output/project-context.md` section "TEE Integration" |
| Chain config & env vars | `_bmad-output/project-context.md` section "Chain Configuration Rules" |
| Oyster CVM Dockerfile & compose | `docker/Dockerfile.oyster`, `docker/docker-compose-oyster.yml` |
| SDK E2E Docker compose | `docker-compose-sdk-e2e.yml` |
| Nix reproducible build flake | `flake.nix` (root) |
| Attestation server source | `docker/src/attestation-server.ts` |
| Docker entrypoint (embedded connector) | `docker/src/entrypoint-sdk.ts` |
| Content publishing pipeline | `_bmad-output/planning-artifacts/content-strategy-2026-q1.md` |
| Content publishing workflow | `_bmad-output/planning-artifacts/content/publish-workflow.md` |
| Character spec (brand voice) | `_bmad-output/planning-artifacts/content/character-spec.md` |
| Article drafts | `_bmad-output/planning-artifacts/content/article-N/` |
| ILP address hierarchy & protocol economics | `_bmad-output/project-context.md` section "ILP Address Hierarchy & Protocol Economics" |
| Prepaid protocol decisions | `_bmad-output/planning-artifacts/research/party-mode-prepaid-protocol-decisions-2026-03-20.md` |
| Network primitives strategy (four primitives) | `_bmad-output/planning-artifacts/research/party-mode-network-primitives-strategy-2026-03-22.md` |
| Overmind Protocol decisions (Epics 13-17) | `_bmad-output/planning-artifacts/research/party-mode-overmind-protocol-decisions-2026-03-24.md` |
| Overmind epics & stories | `_bmad-output/overmind-epics-and-stories.md` |
| Arweave integration research | `_bmad-output/planning-artifacts/research/technical-arweave-integration-research-2026-03-24.md` |
| The Rig -- Arweave DVM + Forge-UI (Epic 8) | `_bmad-output/project-context.md` section "The Rig" |
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

## Browser Verification

Use the `playwright-cli` skill (invoke via `/playwright-cli`) for browser-related tasks: verifying UI changes, debugging console/network issues, and automating E2E flows. Prefer snapshots over screenshots when interacting with elements.
