# Story 21.8.0: Townhouse Dev Infrastructure (D21-009 Prereq)

Status: backlog

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Townhouse contributor building dashboard views,
I want a Townhouse-shaped Docker dev stack and a single-command up/down script,
so that stories 21.8.5, 21.14, and 21.9–21.13 can be developed and verified against live, production-shaped data — never mocks, never the SDK-E2E topology — per design decision D21-009.

## Background

D21-009 (epic-21-townhouse.md) establishes the rule: dashboard stories MUST be developed against `docker-compose-townhouse-dev.yml` via `./scripts/townhouse-dev-infra.sh up`. The stack is required to mirror the production Townhouse topology (D21-002 — standalone connector + Town/Mill/DVM child peers) so the dashboard SPA consumes the exact data shape it will see in production: packet log from the shared connector, type-separated node identities, real cross-chain swap flows.

Audit on 2026-04-29 confirmed neither file exists. Neither does `packages/townhouse-web/` (the Vite SPA scaffold; that lands in 21.8.5). Without the dev stack, story 21.9 cannot start — and 21.8.5 has no live data to design primitives against.

This story is the prerequisite. It builds the stack, the up/down script, the dev-fixture configs for the child nodes, and the host-side env-file integration. It does NOT build the Vite SPA, does NOT modify the production `docker-compose-townhouse.yml`, and does NOT add new admin-API endpoints (those belong to specific view stories).

## Dependencies

- **Story 21.7.5** (parallel or done): Pins `DEFAULT_CONNECTOR_IMAGE`. The dev compose file references the same constant (literal in YAML; comment points at the TS constant). If 21.7.5 lands first, 21.8.0 inherits the canonical tag. If 21.8.0 lands first, this story uses `3.3.0` literally and 21.7.5's sweep updates both files together.
- **Story 21.5** (done): `docker/Dockerfile.town`, `docker/src/entrypoint-town.ts`. Two Town instances in the dev stack consume this image.
- **Story 21.6** (done) + **Story 21.6.1** (parallel): `docker/Dockerfile.mill`, `docker/src/entrypoint-mill.ts`. Two Mill instances consume this image.
- **Story 21.7** (done): `docker/Dockerfile.dvm`, `docker/src/entrypoint-dvm.ts`. One DVM instance consumes this image.
- **Story 21.3** (done): `ConnectorConfigGenerator` env-var contract. The dev compose file mirrors the env vars the orchestrator emits at runtime, so dashboard work sees the same data shape regardless of how the stack was started.
- **SDK E2E infra precedent**: `scripts/sdk-e2e-infra.sh` and `docker-compose-sdk-e2e.yml` establish the script + compose pattern this story follows. The townhouse-dev script intentionally mirrors that style (colored logging, staged startup, health polling, banner on success, `.env` file for host-side consumption).

**Runtime dependencies (new):** none. All images either already exist (`toon:town`, `toon:mill`, `toon:dvm` from 21.5/21.6/21.7; `ghcr.io/toon-protocol/connector` pulled) or are part of the chain-devnet ecosystem already used by SDK E2E (Anvil image, Solana test-validator image, Mina lightnet image — copy the `image:` lines from `docker-compose-sdk-e2e.yml`).

## Acceptance Criteria

1. **AC-1: `docker-compose-townhouse-dev.yml` at workspace root.** Single file describing the full dev topology:
   - 1 standalone connector (`townhouse-dev-connector`) using `DEFAULT_CONNECTOR_IMAGE` (literal tag with comment pointing at `packages/townhouse/src/constants.ts`).
   - 2 Town instances: `townhouse-dev-town-01`, `townhouse-dev-town-02` (distinct deterministic Nostr secret keys).
   - 2 Mill instances: `townhouse-dev-mill-01` (EVM↔Solana swap pair), `townhouse-dev-mill-02` (EVM↔Mina swap pair). Names match the references in story 21.11's ACs verbatim.
   - 1 DVM instance: `townhouse-dev-dvm-01`. Name matches story 21.12 references.
   - 3 chain devnets: `townhouse-dev-anvil`, `townhouse-dev-solana`, `townhouse-dev-mina`. Image lines copied from `docker-compose-sdk-e2e.yml`.
   - 1 SOCKS5 proxy: `townhouse-dev-socks5` (image: `serjs/go-socks5-proxy:latest` — same as SDK E2E uses, if that's what SDK E2E uses; otherwise lowest-friction pinned alternative). Optional in the sense that the connector defaults to `TRANSPORT_MODE: direct`; the proxy exists so stories that exercise ATOR mode (21.15) have something to point at.
   - One bridge network: `townhouse-dev-net`.
   - Per-service named volumes for child-node data (`townhouse-dev-town-01-data`, etc.).
2. **AC-2: Port allocation in the 28xxx range.** No collision with SDK E2E (18xxx/19xxx) or production Townhouse (3100/3200/3400/7100/9401). Suggested map:
   - Connector admin: `127.0.0.1:28080` → container `9401`.
   - Anvil: `127.0.0.1:28545` → container `8545`.
   - Solana RPC: `127.0.0.1:28899` → container `8899`.
   - Solana faucet: `127.0.0.1:28900` → container `9900` (if SDK E2E exposes it).
   - Mina GraphQL: `127.0.0.1:28085`. Mina accounts manager: `127.0.0.1:28181`.
   - Town-01 BLS health: `127.0.0.1:28100`. Town-01 relay: `127.0.0.1:28700`.
   - Town-02 BLS health: `127.0.0.1:28110`. Town-02 relay: `127.0.0.1:28710`.
   - Mill-01 BLS health: `127.0.0.1:28200`. Mill-02 BLS health: `127.0.0.1:28210`.
   - DVM-01 BLS health: `127.0.0.1:28400`.
   - SOCKS5: `127.0.0.1:28050`.
   - All bindings on `127.0.0.1:` only — never `0.0.0.0:` (operator dev machine, not exposing to LAN).
   - Final allocation table is added to `CLAUDE.md` "Port allocation" reference (search for the existing port list — the SDK E2E table) so future contributors don't pick conflicting ports.
3. **AC-3: `scripts/townhouse-dev-infra.sh` executable script.** Mirrors `scripts/sdk-e2e-infra.sh` shape:
   - `set -e`; colored `log_info` / `log_success` / `log_warning` / `log_error` helpers; deterministic Nostr secret keys defined at the top (one per Town, one per Mill, one per DVM = 5 distinct keys); `derive_nostr_pubkey` helper (lifted directly from `sdk-e2e-infra.sh`).
   - Subcommands: `up`, `down`, `down-v`, `status`. `status` runs `docker compose ps` and prints health summary.
   - `up` is staged: (1) build any local images that need rebuilding (`toon:town`, `toon:mill`, `toon:dvm` if their Dockerfiles changed since last build — use `docker build` and let Docker cache; do not skip the build step); (2) start chain devnets, wait for health; (3) deploy Mock USDC to Anvil (use the existing `scripts/deploy-mock-usdc.sh`); deploy Solana payment-channel program (use the vendored keypair pattern from `sdk-e2e-infra.sh`); deploy Mina zkApp (use `scripts/deploy-mina-zkapp.ts`); (4) start the connector with `CONNECTOR_PEERS` JSON listing all 5 child node DNS names; (5) start all 5 child nodes; (6) poll each child's `/health` endpoint until 200 (timeout 60 s per node).
   - On success, print a banner showing every endpoint URL operators/contributors will hit (connector admin, each child BLS, each chain RPC, SOCKS5).
   - Writes `.env.townhouse-dev` at workspace root containing: `TOWNHOUSE_CONNECTOR_ADMIN_URL=http://127.0.0.1:28080`, `TOWNHOUSE_DEV_TOWN_01_RELAY=ws://127.0.0.1:28700`, etc., plus chain-RPC URLs and the deployed Solana program ID + Mina zkApp address. The host-side Fastify API (story 21.8) reads from this file when `pnpm dev:docker` is invoked.
   - `down` runs `docker compose down`, removes `.env.townhouse-dev`. `down-v` adds `-v` to remove volumes.
4. **AC-4: Mill dev-fixture configs.** Two JSON files at `docker/dev-fixtures/mill-01.config.json` and `docker/dev-fixtures/mill-02.config.json`:
   - `mill-01`: `swapPairs: [{ from: 'evm:base:31337/USDC', to: 'solana:devnet/USDC' }]`, channels seeded for both chains, inventory non-zero on both sides.
   - `mill-02`: `swapPairs: [{ from: 'evm:base:31337/USDC', to: 'mina:devnet/USDC' }]`, channels seeded for both chains, inventory non-zero on both sides.
   - Each config file is mounted into its container as `MILL_CONFIG_PATH=/config/mill.config.json` via a read-only volume.
   - Both files include a top-of-file comment: `// Generated for dev infra — DO NOT use in production. Story 21.8.0.` (JSON-with-comments is fine because the entrypoint reads via `JSON.parse(content)` after a `JSON5`-style strip is unnecessary; ensure the actual file is valid JSON — comments live in a sibling `.md` doc instead if needed).
5. **AC-5: DVM dev-fixture (TURBO_TOKEN handling).** DVM container's `TURBO_TOKEN` is passed through from the host environment. The script asserts at `up` time: `if [ -z "$TURBO_TOKEN" ]; then log_warning "TURBO_TOKEN unset — DVM will boot in disabled-upload mode"; fi` and continues. Operators developing DVM-related views (story 21.12) set the var in their shell; operators working on Town/Mill don't need it. This is documented in the dev-loop README addition (AC-7).
6. **AC-6: Smoke-test integration test.** A new test at `packages/townhouse/src/__integration__/dev-stack-smoke.test.ts`:
   - `beforeAll`: assert `.env.townhouse-dev` exists and parses; if not, log a clear "run `./scripts/townhouse-dev-infra.sh up` first" message and `test.skip()` the whole suite (do NOT silently pass — skip with reason).
   - Test 1: `ConnectorAdminClient.getHealth()` against `TOWNHOUSE_CONNECTOR_ADMIN_URL` returns 200 with documented shape.
   - Test 2: `ConnectorAdminClient.getPeers()` returns an array of length 5; each entry has `id` matching one of `town-01`, `town-02`, `mill-01`, `mill-02`, `dvm-01`; each `connected` is `true`.
   - Test 3: each child node's BLS health endpoint (`/health`) returns 200.
   - Tagged `describe.skipIf(process.env['SKIP_DOCKER'] === '1')`.
   - Hard runtime budget: 30 s after stack is up.
7. **AC-7: Dev-loop documentation.** A new section in `packages/townhouse/README.md` (create the file if absent) titled `## Local Dev Loop (Townhouse Dev Stack)` documenting:
   - The one-command boot: `./scripts/townhouse-dev-infra.sh up`.
   - The endpoint banner explanation.
   - How the host-side Fastify API picks up `.env.townhouse-dev` when run as `pnpm dev:docker` (script that lands in 21.8.5; document the contract here so 21.8.5 knows what to wire).
   - When operators need `TURBO_TOKEN` set; when they don't.
   - The teardown commands (`down` vs `down-v`).
   - The port allocation table (mirrored from CLAUDE.md, kept in sync — this is the contributor-facing copy).
   - "What this stack is NOT" — not a production deployment, not the SDK E2E topology, not for performance testing.
8. **AC-8: Production compose file untouched.** `docker-compose-townhouse.yml` is byte-identical to its state at the start of this story (verified via `git diff docker-compose-townhouse.yml`). Production and dev are deliberately separate files: production keeps profiles + 1 instance per type; dev hard-codes 5 child nodes. Sharing one file with profiles would conflate "operator's actual node" with "contributor's dev rig."
9. **AC-9: Tests + smoke pass.** `pnpm --filter @toon-protocol/townhouse test` continues to pass (no regression). `./scripts/townhouse-dev-infra.sh up` completes successfully on a clean machine (no prior images cached) within 5 minutes (image-pull-dominated). Subsequent `up` runs complete within 90 seconds. `./scripts/townhouse-dev-infra.sh down` cleans up all containers + the `.env.townhouse-dev` file. AC-6's smoke test passes.

## Tasks / Subtasks

- [ ] Task 1: Author `docker-compose-townhouse-dev.yml` (AC: #1, #2, #8)
  - [ ] 1.1 Copy `docker-compose-townhouse.yml` as the starting point. Rename the file to `docker-compose-townhouse-dev.yml`. (Do NOT modify the original — AC-8.)
  - [ ] 1.2 Replace single-instance Town/Mill/DVM with: `town-01`, `town-02`, `mill-01`, `mill-02`, `dvm-01`. Each gets a unique `container_name: townhouse-dev-<role>` and unique host port bindings per AC-2.
  - [ ] 1.3 Drop all `profiles:` keys — dev stack always boots the full topology.
  - [ ] 1.4 Update connector `CONNECTOR_PEERS` JSON to include all 5 child peers (`town-01`, `town-02`, `mill-01`, `mill-02`, `dvm-01`) with the correct BTP/HTTP URLs (BTP for Town/Mill, HTTP for DVM, mirroring the production compose pattern).
  - [ ] 1.5 Add chain-devnet services — copy `anvil`, `solana-validator`, `mina-lightnet` services from `docker-compose-sdk-e2e.yml`. Update port bindings to the 28xxx range. Use the same volumes/health checks pattern.
  - [ ] 1.6 Add `townhouse-dev-socks5` service using the SOCKS5 proxy image SDK E2E uses (or a pinned `serjs/go-socks5-proxy` if SDK E2E doesn't run one). Bind `127.0.0.1:28050:1080`.
  - [ ] 1.7 Add `volumes:` block listing all 5 child-node data volumes. Add `networks:` block with one bridge network `townhouse-dev-net`.
  - [ ] 1.8 Mount `docker/dev-fixtures/mill-01.config.json` and `mill-02.config.json` read-only into their respective containers at `/config/mill.config.json`. Set `MILL_CONFIG_PATH=/config/mill.config.json` in each Mill container's env.
  - [ ] 1.9 Sanity-check the file with `docker compose -f docker-compose-townhouse-dev.yml config` (parses and validates without booting anything).

- [ ] Task 2: Author `scripts/townhouse-dev-infra.sh` (AC: #3, #5, #9)
  - [ ] 2.1 Create the file. `chmod +x`. Header comment: purpose, usage, port-allocation pointer.
  - [ ] 2.2 Lift the colored-logging helpers, `derive_nostr_pubkey`, and `wait_for_health` functions verbatim from `scripts/sdk-e2e-infra.sh`. (DRY would be nicer, but the SDK script is self-contained for a reason — keep dev-infra self-contained too. Future refactor can extract a shared `scripts/lib/infra-common.sh` if a third stack appears.)
  - [ ] 2.3 Define 5 deterministic Nostr secret keys at top of file: `TOWN_01_SECRET_KEY`, `TOWN_02_SECRET_KEY`, `MILL_01_SECRET_KEY`, `MILL_02_SECRET_KEY`, `DVM_01_SECRET_KEY`. Use distinct, easy-to-recognize patterns (e.g., repeating hex like `aaaaaaa...01`, `aaaaaaa...02`, etc.) so logs are scannable.
  - [ ] 2.4 `cmd_up`: stage 1 build images, stage 2 chain devnets + Mock USDC + Solana program + Mina zkApp deploys (re-use the SDK script's deploy logic), stage 3 connector, stage 4 child nodes. Health-poll between stages.
  - [ ] 2.5 Build the connector `CONNECTOR_PEERS` JSON dynamically from the 5 child names + the BTP/HTTP URL per node type. Inject as env override on `docker compose up` so the compose-file fallback isn't relied on for the dev shape.
  - [ ] 2.6 Inject `NODE_NOSTR_SECRET_KEY` per child container via `-e` overrides on `docker compose up`. Derive each pubkey via `derive_nostr_pubkey` and log the first 16 chars of each so contributors can grep their relay events.
  - [ ] 2.7 Write `.env.townhouse-dev` at workspace root listing every host-bound endpoint URL + chain config. Include both raw values and exported names (`TOWNHOUSE_CONNECTOR_ADMIN_URL`, `TOWNHOUSE_DEV_TOWN_01_RELAY`, etc.).
  - [ ] 2.8 Print the success banner with all 14+ endpoint URLs grouped by category (Connector / Towns / Mills / DVM / Chains / SOCKS5). Mirror the SDK script's banner aesthetic.
  - [ ] 2.9 `cmd_down`: `docker compose down`, `rm -f .env.townhouse-dev`. `cmd_down_v`: same plus `-v`. `cmd_status`: `docker compose ps` plus a one-line health summary derived from `docker inspect`.
  - [ ] 2.10 `case` dispatch on `${1:-}` mirrors the SDK script's pattern.

- [ ] Task 3: Author Mill dev-fixture configs (AC: #4)
  - [ ] 3.1 Create `docker/dev-fixtures/` directory.
  - [ ] 3.2 `mill-01.config.json`: swap-pair EVM↔Solana, channels seeded with non-zero `cumulativeAmount` and matching `nonce` for both chains, inventory entries for both chains, `chains[]` listing both, `relayUrls: ['ws://townhouse-dev-town-01:7100','ws://townhouse-dev-town-02:7100']`. Validate against `MillConfig` type from `@toon-protocol/mill`.
  - [ ] 3.3 `mill-02.config.json`: swap-pair EVM↔Mina, otherwise structurally identical to mill-01 with chain entries swapped.
  - [ ] 3.4 Add a sibling `docker/dev-fixtures/README.md` explaining: (a) these are dev-only fixtures, (b) the channel state is fake-but-valid-shape, (c) regenerating: instructions for refreshing the channels (e.g., when channel API changes).
  - [ ] 3.5 Run `node -e "JSON.parse(require('fs').readFileSync('docker/dev-fixtures/mill-01.config.json','utf8'))"` and same for mill-02 to confirm both parse.
  - [ ] 3.6 Add a Townhouse unit test (`packages/townhouse/src/__tests__/dev-fixtures.test.ts`) that imports both files and runs them through the Mill config validator (`packages/mill`'s parsing helper, if exported; else just `JSON.parse` + the same shape checks `entrypoint-mill.ts` performs). Guards against the fixtures going stale relative to the Mill config schema.

- [ ] Task 4: Port-allocation table update in `CLAUDE.md` (AC: #2)
  - [ ] 4.1 In `CLAUDE.md` "Deployment / Port allocation" reference area (the existing port list), add a new section "Townhouse Dev Stack (28xxx)" listing every port from AC-2.
  - [ ] 4.2 Cross-link from the new section back to `scripts/townhouse-dev-infra.sh` and the dev-loop README section (AC-7).

- [ ] Task 5: Dev-loop documentation (AC: #7)
  - [ ] 5.1 Create `packages/townhouse/README.md` if absent (write a minimal package README with overview + the new dev-loop section). If it exists, append the section.
  - [ ] 5.2 Section structure: one-command boot, endpoint banner explanation, host-Fastify integration via `.env.townhouse-dev` (forward-reference 21.8.5's `pnpm dev:docker`), TURBO_TOKEN guidance, teardown, port table, "What this is NOT."
  - [ ] 5.3 Cross-link from `CLAUDE.md`'s "Where to Find Things" table: add row `Townhouse dev stack | scripts/townhouse-dev-infra.sh + docker-compose-townhouse-dev.yml`.

- [ ] Task 6: Smoke-test integration test (AC: #6)
  - [ ] 6.1 Create `packages/townhouse/src/__integration__/dev-stack-smoke.test.ts`.
  - [ ] 6.2 In `beforeAll`, read `.env.townhouse-dev` from workspace root. If absent, log helpful skip reason and `describe.skip` the suite.
  - [ ] 6.3 Test 1: `getHealth()` succeeds against the connector admin URL.
  - [ ] 6.4 Test 2: `getPeers()` returns 5 entries, IDs match expected, `connected: true` for each.
  - [ ] 6.5 Test 3: `fetch('http://127.0.0.1:<port>/health')` for each child returns 200.
  - [ ] 6.6 Wrap in `describe.skipIf(process.env['SKIP_DOCKER'] === '1')`.

- [ ] Task 7: Run-through + verify (AC: #9)
  - [ ] 7.1 On a workstation with no toon images cached: `./scripts/townhouse-dev-infra.sh up`. Confirm completes in <5 minutes; banner prints; all 5 child health endpoints reachable.
  - [ ] 7.2 `pnpm --filter @toon-protocol/townhouse test:integration -- dev-stack-smoke` — must pass.
  - [ ] 7.3 `./scripts/townhouse-dev-infra.sh down`. Confirm all containers gone; `.env.townhouse-dev` removed.
  - [ ] 7.4 Re-run `up`. Confirm second run is <90 s (cached images).
  - [ ] 7.5 `./scripts/townhouse-dev-infra.sh status` mid-run prints accurate state.
  - [ ] 7.6 `git diff docker-compose-townhouse.yml` returns nothing (AC-8).

## Dev Notes

### Why a separate compose file rather than profiles on the production file

The production compose file describes one operator's actual node — one Town, one Mill, one DVM. The dev stack describes a contributor's rig — two Towns to test "node selection" UI states, two Mills to exercise both EVM↔Solana and EVM↔Mina pairs in story 21.11, and a DVM. Cramming both into one file with profiles means every dashboard developer has to remember which profiles to set; forgetting a profile gives them missing-data states the dashboard doesn't actually need to render. Separate files = clearer mental model, single command per intent.

### Why 5 child nodes (and not 3 or 7)

Story 21.11's ACs name `townhouse-dev-mill-01` (EVM↔Solana) and `townhouse-dev-mill-02` (EVM↔Mina) explicitly. Story 21.10 names `townhouse-dev-town-01` and `townhouse-dev-town-02` and exercises degraded state via `docker pause townhouse-dev-town-02`. Story 21.12 names `townhouse-dev-dvm-01`. Five is the minimum that satisfies all three view stories' D21-009 requirements. Adding more (e.g., 3 Towns, 3 Mills) doesn't unlock new test scenarios — it just slows boot.

### Why the 28xxx port range

SDK E2E owns 18xxx + 19xxx. Production Townhouse owns 3xxx (relay/health) + 7100 (relay) + 9401 (admin). 28xxx leaves clear daylight in both directions — operators can run SDK E2E and Townhouse-dev simultaneously without conflict (rare but legal), and the range is far from the 1024-10000 well-known/registered range.

### Why mounted Mill config files instead of inline JSON env vars

`MILL_CONFIG_JSON` is supported (and 21.6.1 hardens its sensitive-env-cleanup), but the dev stack's Mill configs include channel state arrays that are awkward to inline in YAML. Mounted files keep the compose YAML readable, allow contributors to tweak channel state without editing `docker compose` env, and exercise the `MILL_CONFIG_PATH` code path which the production stack doesn't currently use.

### Why deterministic Nostr keys

Dashboard development needs to grep relay events by pubkey ("show me events from town-01"). Deterministic keys mean the pubkey is the same across `up`/`down`/`up` cycles, the same across machines, and easy to copy-paste from the boot banner into search inputs. Production never uses these keys (HD wallet derives per-operator keys). The deterministic keys are pinned in the script comment as "DEV ONLY — DO NOT REUSE IN PRODUCTION."

### Why `.env.townhouse-dev` instead of process env exports

The host-side Fastify API needs the connector admin URL when it boots. If the script exports `TOWNHOUSE_CONNECTOR_ADMIN_URL` into the calling shell, contributors who source the script see env pollution; contributors who run it as a subprocess don't see anything. A workspace-root `.env` file is read by `dotenv` at Fastify-API startup (story 21.8.5's `pnpm dev:docker` script will wire this) — simple, scoped, and gitignored. SDK E2E uses the same pattern (`.env.sdk-e2e`), so contributors who already know that script will recognize the pattern.

### Why a smoke test that skips when the stack isn't running

A test that fails when the stack is down trains contributors to ignore failing tests ("oh, that's just my dev stack again"). A test that silently passes when the stack is down hides regressions. A test that skips with a clear "run `up` first" message is the only honest option — it surfaces the missing dependency without polluting the failure signal.

### What this story does NOT do

- Does not scaffold `packages/townhouse-web/` (Vite SPA). That's 21.8.5's first task.
- Does not wire `pnpm dev:docker` (the host-side Vite + Fastify integration script). That's 21.8.5.
- Does not add new admin-API endpoints — uses only what `ConnectorAdminClient` already calls.
- Does not modify `docker-compose-townhouse.yml`. AC-8 enforces this with a git-diff check.
- Does not bump the connector image tag (21.7.5's job). If 21.7.5 has not landed, this story uses `3.3.0` literally and 21.7.5's sweep updates the dev compose file as part of its AC-2 sweep.
- Does not add Akash, Oyster, or Arweave services. The dev stack is for dashboard work; production-cloud surfaces are out of scope.
- Does not stress-test the stack. Boot-and-smoke only; performance tuning lives in 21.16 (E2E) or a future infra story.
