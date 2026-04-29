# Story 21.7.5: Connector v3.3.x Sweep + Townhouse-Side Contract Canary

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Townhouse maintainer,
I want the Townhouse package to pin the connector image at the workspace-canonical version and to ship its own contract canary,
so that we never again ship dashboard work on top of an unverified connector contract — and so that the next connector bump (3.3.x → 3.4.x → 4.x) fails fast at a Townhouse-shaped seam, not deep in a dashboard rendering bug.

## Background

Epic 22 (PR #29, merged 2026-04-28) standardized the workspace on `@toon-protocol/connector ^3.3.3` and added a fast contract canary at `packages/sdk/tests/integration/connector-contract.test.ts`. That canary asserts the SDK's view of the connector — `sendPacket`, `buildSwarmSelectionEvent`, `registerPeer`, `openChannel`, `PaymentHandler`/`PaymentResponse`, `ConnectorConfig` shape — and is documented in `packages/sdk/CONNECTOR_MIGRATION.md`.

Townhouse is a different consumer. It does NOT import the connector npm package at runtime. It pulls the connector Docker image (`ghcr.io/toon-protocol/connector:X.Y.Z`) and talks to it across two seams the SDK canary cannot reach:

- **Admin HTTP API** — `ConnectorAdminClient` (`packages/townhouse/src/connector/admin-client.ts`) issues `GET /health`, `GET /metrics`, `GET /peers` and validates response shape inline. If a future connector release renames a field or changes a status string, every dashboard view that consumes those endpoints breaks silently.
- **Env-var + peer-config contract** — `ConnectorConfigGenerator` (`packages/townhouse/src/connector/config-generator.ts`) emits `CONNECTOR_ADMIN_PORT`, `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS` (JSON), `TRANSPORT_MODE`, `SOCKS_PROXY` env vars; the connector image must accept those names and parse `CONNECTOR_PEERS` as the documented `PeerEntry[]` shape. Drift here means containers boot with empty routing tables and "everything looks fine but no packets flow."

Today, every Townhouse source/test reference pins `ghcr.io/toon-protocol/connector:3.3.0` (audit on 2026-04-29 found 14 occurrences in `defaults.ts`, `docker-compose-townhouse.yml`, and 12 test files). The workspace npm side is on `^3.3.3`. Connector v3.3.2 introduced F02/F04 reject-code tightening — a runtime behavior change Townhouse has never been tested against.

This story closes both gaps: bumps the version pin AND ships a Townhouse-flavored canary that protects the two surfaces the SDK canary doesn't.

## Dependencies

- **Story 21.3** (done): `ConnectorAdminClient`, `ConnectorConfigGenerator`, `ConnectorRuntimeConfig` types — this story extends their tests with a contract canary, no API changes.
- **Story 21.6.1** (parallel): closes Mill review findings on `entrypoint-mill.ts` / `Dockerfile.mill`. 21.7.5 may land before, after, or in parallel with 21.6.1 — they touch different files. If both are in flight, sequence the connector image bump (this story) AFTER 21.6.1's tracking-doc reconciliation so the diff is clean.
- **Story 22.5** (done, on `main`): SDK contract canary at `packages/sdk/tests/integration/connector-contract.test.ts` and migration doc at `packages/sdk/CONNECTOR_MIGRATION.md`. This story mirrors that pattern, not replaces it.

**Runtime dependencies (new):** none. The Townhouse canary uses Node's native `fetch` (already used by `ConnectorAdminClient`) and `dockerode` (already a Townhouse dep) to launch the connector container.

## Acceptance Criteria

1. **AC-1: Workspace-canonical connector image tag.** `packages/townhouse/src/config/defaults.ts` `connector.image` defaults to the same connector version the workspace npm side pins (`^3.3.3` → image tag `3.3.3`, unless the connector publishes a higher 3.3.x patch by the time this lands; verify with `pnpm view @toon-protocol/connector dist-tags.latest` immediately before the bump). The new tag is exported as a single `DEFAULT_CONNECTOR_IMAGE` constant from `src/constants.ts` so future bumps touch one line, not 14.
2. **AC-2: Sweep all hard-coded `3.3.0` references.** Every occurrence of `ghcr.io/toon-protocol/connector:3.3.0` in `packages/townhouse/**` and the workspace-root `docker-compose-townhouse.yml` is either (a) replaced with `DEFAULT_CONNECTOR_IMAGE` (production code) or (b) kept as a literal but updated to the new tag (test fixtures where the literal is the assertion). Verification: `rg -n 'connector:3\.3\.0' packages/townhouse docker-compose-townhouse.yml` returns zero matches.
3. **AC-3: Townhouse contract canary — admin API shape (stub-driven).** A new test file `packages/townhouse/src/connector/contract-canary.test.ts` asserts:
   - `ConnectorAdminClient.getHealth()` rejects when the connector returns a body missing `status` or `uptime`, or when those fields have the wrong type. Each negative case is one test.
   - `ConnectorAdminClient.getMetrics()` rejects when `packetsForwarded`, `packetsRejected`, or `bytesSent` is missing or non-numeric. Each negative case is one test.
   - `ConnectorAdminClient.getPeers()` rejects when the body is not an array.
   - `ConnectorAdminClient.getHealth()` succeeds on the documented shape `{ status: string, uptime: number }` and returns the parsed body unchanged.
   - Tests use `vi.spyOn(global, 'fetch')` with `Response.json(...)` stubs — no Docker, no network. Total runtime <500 ms. (Mirrors the SDK canary's stub style.)
4. **AC-4: Townhouse contract canary — config-generator env-var shape.** The same canary file asserts `ConnectorConfigGenerator.toEnvVars()`:
   - Always emits keys `CONNECTOR_ADMIN_PORT`, `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS`, `TRANSPORT_MODE` for any non-empty `activeNodes`.
   - Emits `SOCKS_PROXY` if and only if `transport.socksProxy` is set.
   - `CONNECTOR_PEERS` is valid JSON and round-trips to `PeerEntry[]` with each entry containing `id`, `relation: 'child'`, `btpUrl: 'btp+ws://townhouse-{type}:3000'`, `assetCode`, `assetScale`.
   - Snapshot-style assertion of the full env-var key set so a regression that adds/removes a key fails the canary explicitly.
5. **AC-5: Townhouse contract canary — running-image smoke (integration tier).** `packages/townhouse/src/__integration__/connector-image-contract.test.ts` (new file, vitest in `vitest.integration.config.ts`):
   - Pulls `DEFAULT_CONNECTOR_IMAGE` via `dockerode` if not present locally.
   - Starts the container with the env-var set produced by `ConnectorConfigGenerator.toEnvArray()` for `activeNodes: []` (no real peers; we are testing only that the image accepts the env-var contract and serves the admin endpoints).
   - Polls the admin port until `/health` returns 200 with the documented shape, then asserts `/metrics` and `/peers` shapes against the same validators in `ConnectorAdminClient`.
   - Tears down the container in `afterAll`.
   - Tagged `describe.skipIf(process.env.SKIP_DOCKER === '1')` so contributors without Docker (rare, but possible) can `SKIP_DOCKER=1 pnpm test`. CI runs without the skip.
   - Hard runtime budget: 30 seconds (image-pull dominated; subsequent runs are <5 s).
6. **AC-6: Migration doc extension.** `packages/sdk/CONNECTOR_MIGRATION.md` gains a new section "Townhouse-Side Contract" documenting the two seams covered by this canary (admin API endpoints + env-var/peer-config shape) and a `## Townhouse Migration Steps` checklist for future bumps: (1) update `DEFAULT_CONNECTOR_IMAGE`, (2) run `packages/townhouse/src/connector/contract-canary.test.ts`, (3) run `packages/townhouse/src/__integration__/connector-image-contract.test.ts`, (4) on failure, follow the same row-add discipline as the SDK doc. The Townhouse section appears BEFORE the existing "When to Update This Document" close so the doc reads as one workspace-wide migration guide, not two parallel lists. (Adding a Townhouse section to the SDK migration doc, rather than creating `packages/townhouse/CONNECTOR_MIGRATION.md`, is intentional — see Dev Notes.)
7. **AC-7: Tests + build.** `pnpm --filter @toon-protocol/townhouse test` passes (count rises by the AC-3/AC-4 additions, on the order of +12 tests). `pnpm --filter @toon-protocol/townhouse test:integration` (which currently runs the previously-skipped `__integration__/connector-integration.test.ts`) succeeds with the new image-contract test included. `pnpm --filter @toon-protocol/townhouse build` succeeds.
8. **AC-8: Connector contract canary catches version drift.** Add a deliberate-failure test that exercises the ratchet: changing `DEFAULT_CONNECTOR_IMAGE` to a known-bad tag (e.g., `ghcr.io/toon-protocol/connector:0.0.0-broken`) makes AC-5's image-contract test fail loudly within the 30 s budget. This test is gated behind `RUN_CANARY_NEGATIVE=1` so CI doesn't run it by default — but a contributor verifying the canary's value can run it on demand.

## Tasks / Subtasks

- [x] Task 1: Pin `DEFAULT_CONNECTOR_IMAGE` constant + sweep references (AC: #1, #2)
  - [x] 1.1 `pnpm view @toon-protocol/connector dist-tags.latest` — record the latest 3.3.x tag. If it has advanced past 3.3.3 since this story was written, use the latest patch.
  - [x] 1.2 In `packages/townhouse/src/constants.ts`, export `export const DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.3.X'` (where X is the tag from 1.1). Add a comment block above pointing at `packages/sdk/CONNECTOR_MIGRATION.md` and warning that bumps require AC-5 to pass.
  - [x] 1.3 In `packages/townhouse/src/config/defaults.ts:20`, replace the literal with `DEFAULT_CONNECTOR_IMAGE`. Re-run `pnpm --filter @toon-protocol/townhouse build` to confirm the type system still narrows correctly.
  - [x] 1.4 In `docker-compose-townhouse.yml:21`, update the literal to the new tag. Add a comment line above pointing at `DEFAULT_CONNECTOR_IMAGE` and noting the two must stay in sync (compose can't import a TS constant; this is the trade-off).
  - [x] 1.5 In each of the 12 test files referencing `connector:3.3.0` (`config/validator.test.ts`, `config/loader.test.ts:30,239`, `wallet/cli-wallet.test.ts:266,338,397,471,545`, `docker/orchestrator.test.ts:447,497`, `package-structure.test.ts:106`, `cli.test.ts:98,349`), replace the literal with the new tag. Tests that ASSERT the default value (e.g., `package-structure.test.ts:106` `expect(connector['image']).toBe(...)`) should import `DEFAULT_CONNECTOR_IMAGE` from `src/constants.ts` rather than re-stringifying the tag — that way future bumps only touch `constants.ts`. Tests that produce YAML fixtures may keep the literal but with the new tag.
  - [x] 1.6 Verify zero matches: `rg -n 'connector:3\.3\.0' packages/townhouse docker-compose-townhouse.yml`. Commit as a single atomic "chore(townhouse): bump connector image to 3.3.X" commit.

- [x] Task 2: Stub-driven canary — admin API shape (AC: #3)
  - [x] 2.1 Create `packages/townhouse/src/connector/contract-canary.test.ts`. Top of file: a comment block explaining purpose, runtime budget, and pointer to `CONNECTOR_MIGRATION.md` (mirror the header in `packages/sdk/tests/integration/connector-contract.test.ts`).
  - [x] 2.2 Test group `getHealth() shape contract`: success path; missing `status`; missing `uptime`; wrong-type `status`; wrong-type `uptime`. Each negative case asserts the thrown message contains `invalid health response shape`.
  - [x] 2.3 Test group `getMetrics() shape contract`: success path; missing each of `packetsForwarded`/`packetsRejected`/`bytesSent`; wrong-type field. Negative cases assert thrown message contains `invalid metrics response shape`.
  - [x] 2.4 Test group `getPeers() shape contract`: success path with empty array; success path with one peer; non-array body (e.g., object) rejects with `invalid peers response shape`.
  - [x] 2.5 All tests `vi.spyOn(global, 'fetch')` with `mockResolvedValue(new Response(JSON.stringify(body), {status: 200}))`. No real network. Run with `pnpm --filter @toon-protocol/townhouse test contract-canary` — must complete in <500 ms.

- [x] Task 3: Stub-driven canary — config-generator env shape (AC: #4)
  - [x] 3.1 In the same file (`contract-canary.test.ts`), add test group `ConnectorConfigGenerator env-var contract`. Use `getDefaultConfig()` plus `enabled: true` overrides for each node type as inputs.
  - [x] 3.2 Test: with `activeNodes: ['town', 'mill', 'dvm']` and `transport.mode: 'direct'`, `toEnvVars()` returns exactly the keys `CONNECTOR_ADMIN_PORT`, `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS`, `TRANSPORT_MODE` (no `SOCKS_PROXY`). Use `Object.keys(envVars).sort()` against an expected snapshot.
  - [x] 3.3 Test: with `transport.mode: 'ator'` and `socksProxy: 'socks5h://proxy.ator.io:9050'`, the env set additionally contains `SOCKS_PROXY` with that value.
  - [x] 3.4 Test: `JSON.parse(envVars['CONNECTOR_PEERS'])` returns an array; for each `activeNodes` entry, the corresponding peer has `id === type`, `relation === 'child'`, `btpUrl === 'btp+ws://townhouse-{type}:3000'`, `assetCode === 'USD'`, `assetScale === 6`.
  - [x] 3.5 Test: `toEnvArray()` returns `KEY=VALUE` strings whose set matches `toEnvVars()` round-tripped. Guards against future `toEnvArray` divergence.

- [x] Task 4: Running-image smoke canary (AC: #5)
  - [x] 4.1 Create `packages/townhouse/src/__integration__/connector-image-contract.test.ts`. Confirm `vitest.integration.config.ts` includes `src/__integration__/**/*.test.ts` (it should — Story 21.3 already configured this).
  - [x] 4.2 `beforeAll`: pull `DEFAULT_CONNECTOR_IMAGE` via `dockerode` if absent (`docker.pull(image)` + stream consume). Start the container with a config.yaml mounted (connector requires config file — env vars are not consumed by the image). `HostConfig.AutoRemove: true`. Capture bound host ports via inspect().
  - [x] 4.3 Poll `http://127.0.0.1:<healthCheckPort>/health` with `ConnectorAdminClient` until 200 (timeout 20 s). Assert response shape via the same validator the production client uses.
  - [x] 4.4 Hit `/admin/peers` and `/admin/metrics.json` on the adminApi port. Assert each returns 200 and contains the expected sub-fields (aggregate metrics, peers array in wrapper). See Dev Agent Record for contract gap findings.
  - [x] 4.5 `afterAll`: stop the container if not already auto-removed; never leave a stray container running.
  - [x] 4.6 Wrap the entire `describe` in `describe.skipIf(process.env['SKIP_DOCKER'] === '1')`. Add a one-line comment explaining the gate.
  - [x] 4.7 Add to `packages/townhouse/package.json` a script `"test:canary": "vitest run --config vitest.integration.config.ts src/__integration__/connector-image-contract.test.ts"` so the canary can be invoked standalone (e.g., during a connector bump).

- [x] Task 5: Migration doc extension (AC: #6)
  - [x] 5.1 In `packages/sdk/CONNECTOR_MIGRATION.md`, after the "Breaking Changes" section and before "When to Update This Document", insert a new section `## Townhouse-Side Contract` documenting:
    - Why Townhouse needs its own canary (image + admin API + env-var contract, none of which the SDK canary covers).
    - The two surfaces guarded: `ConnectorAdminClient` HTTP shape, `ConnectorConfigGenerator` env-var shape.
    - The two test files: `packages/townhouse/src/connector/contract-canary.test.ts` (stub, fast) and `packages/townhouse/src/__integration__/connector-image-contract.test.ts` (real container, ~5 s after image cache).
  - [x] 5.2 Append a `## Townhouse Migration Steps` checklist for future contributors bumping the connector image: (1) confirm npm and image versions match, (2) update `DEFAULT_CONNECTOR_IMAGE` in `packages/townhouse/src/constants.ts`, (3) run `pnpm --filter @toon-protocol/townhouse test contract-canary`, (4) run `pnpm --filter @toon-protocol/townhouse test:canary` (the new package script), (5) on failure, back-fill a row in this doc's breaking-changes table with the fix.
  - [x] 5.3 Update the existing "When to Update This Document" section to also cover Townhouse (currently it's SDK-only). Single combined doc, one workspace migration guide.

- [x] Task 6: Deliberate-failure ratchet test (AC: #8)
  - [x] 6.1 In `packages/townhouse/src/__integration__/connector-image-contract.test.ts`, add a separate `describe.runIf(process.env['RUN_CANARY_NEGATIVE'] === '1')` block.
  - [x] 6.2 Test: with `image = 'ghcr.io/toon-protocol/connector:0.0.0-broken'` (replace `DEFAULT_CONNECTOR_IMAGE`), the same setup throws within 30 s — either at image-pull (image not found) or at health-poll timeout. Assert the failure surfaces a useful message (not just a timeout). This test exists to prove the canary catches what it claims to catch; it is opt-in to keep CI fast.

- [x] Task 7: Regression sweep + verification (AC: #7)
  - [x] 7.1 `pnpm --filter @toon-protocol/townhouse test` — must pass with new tests added.
  - [x] 7.2 `pnpm --filter @toon-protocol/townhouse test:integration` — must pass; image-contract canary lights up.
  - [x] 7.3 `pnpm --filter @toon-protocol/townhouse build` — must pass.
  - [x] 7.4 Run the SDK canary as well (`pnpm --filter @toon-protocol/sdk test:integration -- tests/integration/connector-contract.test.ts`) to confirm nothing in the npm-side contract regressed during this work. (Should be a no-op; included for paranoia.)

## Dev Notes

### Why two canaries (stub + real-image), not one

The SDK canary is stub-only because the SDK consumes the connector through a programmatic API the test can mock end-to-end. Townhouse consumes the connector through a network boundary (HTTP admin API) AND a process boundary (env vars → container init). A pure-stub canary catches admin-client validator drift and config-generator env-shape drift, both of which are real risks. But it cannot catch the case where the connector image changes its env-var contract (e.g., renames `CONNECTOR_PEERS` to `CONNECTOR_PEER_LIST`) — only running the actual image catches that. So both tiers are load-bearing. The stub canary runs every test cycle (~500 ms); the real-image canary runs on integration test runs and on every PR touching `packages/townhouse/**` or any file that mentions a connector tag (CI globs gate).

### Why extend `packages/sdk/CONNECTOR_MIGRATION.md` instead of writing a separate Townhouse migration doc

Two parallel migration docs would drift. A single document with a "SDK-Side Contract" section and a "Townhouse-Side Contract" section keeps the breaking-changes table unified — the next time the connector tightens reject codes or renames a field, one PR updates both surfaces' guidance. The doc-living-in-the-SDK-package is a cosmetic mismatch (Townhouse code is documented in SDK's package), but co-locating the migration narrative outweighs the cosmetic concern. If/when this becomes meaningfully cumbersome (e.g., a third consumer joins the contract), promote `CONNECTOR_MIGRATION.md` to a workspace-root doc.

### Why a single `DEFAULT_CONNECTOR_IMAGE` constant rather than a config-validated runtime value

Operators can override `connector.image` in their `~/.townhouse/config.yaml`. The constant is the *default* value, not the only legal value. This story doesn't change override semantics — operators stay free to pin a specific tag for testing or rollback. The constant centralizes the *workspace default* so we ratchet one line, not 14, on the next upgrade.

### Why the running-image canary is gated behind `SKIP_DOCKER`

CI always runs Docker. Some local dev environments (laptops in low-resource mode, sandbox containers) cannot run Docker-in-Docker. The skip gate is courtesy, not policy — `pnpm --filter @toon-protocol/townhouse test:integration` is the canonical command, and CI invokes it without the skip set.

### Why the deliberate-failure test exists

A canary that nobody trusts does no work. The deliberate-failure ratchet (AC-8) is a one-time proof-of-value: a contributor onboarding to this surface can run `RUN_CANARY_NEGATIVE=1 pnpm --filter @toon-protocol/townhouse test:canary` and watch the canary catch a known-bad image. It's opt-in so CI doesn't pay the cost on every run; it's part of the test suite so it doesn't bit-rot in a separate scratch script. (Pattern borrowed from chaos-engineering "kill the database, prove the alert fires.")

### What this story does NOT do

- Does not modify `ConnectorAdminClient` or `ConnectorConfigGenerator` source. The contract is the existing surface; this story just guards it.
- Does not add new admin-API endpoints. If 21.10 (Town view) needs new endpoints, that's a 21.10 task — and the canary will need to be extended at that time.
- Does not change the `docker-compose-townhouse-dev.yml` story (`21.8.0`). That dev stack uses `DEFAULT_CONNECTOR_IMAGE` once it exists; landing 21.7.5 first means 21.8.0 inherits a pinned, contract-tested image.
- Does not bump `@toon-protocol/connector` npm dependency anywhere. Townhouse does not import the connector npm package; only the SDK does (and Epic 22 already bumped that side).
- Does not touch the SDK canary or migration doc beyond the AC-6 additions.

## Dev Agent Record

### Debug Log

| # | Finding | Action |
|---|---------|--------|
| D1 | Latest connector tag is `3.3.3` (matches story assumption). | Used `3.3.3` throughout. |
| D2 | Connector image requires `config.yaml` file — does NOT accept env vars (`CONNECTOR_ADMIN_PORT`, `CONNECTOR_PEERS`, etc.). The `ConnectorConfigGenerator.toEnvArray()` output is silently ignored by the container. | Integration test mounts a `config.yaml` instead. Contract gap documented in `CONNECTOR_MIGRATION.md §Known Contract Gaps`. |
| D3 | Connector serves two separate HTTP servers: `healthCheckPort` (returns `{status,uptime,...}`) and `adminApi.port` (returns `{status,service,nodeId,timestamp}` on `/health`, serves `/admin/peers` and `/admin/metrics.json` under `/admin/` prefix). `ConnectorAdminClient.getMetrics()` and `getPeers()` use wrong paths (`/metrics`, `/peers`) and expect wrong shapes. | Integration test verifies correct paths/shapes against the real image; contract gap fully documented in migration doc. |
| D4 | `vitest.config.ts` included `src/**/*.test.ts` which picked up the new integration test and timed out in the unit test run. | Added `src/__integration__/**` to `vitest.config.ts` excludes. |

### Completion Notes

- **Task 1**: `DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.3.3'` exported from `constants.ts`. All 14 occurrences of `:3.3.0` eliminated (verified with rg). 5 tests that ASSERT the default import the constant; 7 YAML fixture strings use the updated literal. Build passes.
- **Tasks 2+3**: `contract-canary.test.ts` — 17 stub-driven tests covering all AC-3 and AC-4 negative/positive cases. Runtime 376ms, well under 500ms budget.
- **Task 4**: `connector-image-contract.test.ts` — real Docker image booted in `beforeAll` with a config.yaml mount (both healthCheckPort: 9401 and adminApi.port: 9402). `/health` verified via `ConnectorAdminClient.getHealth()`. `/admin/peers` and `/admin/metrics.json` verified via direct fetch with correct paths. Deliberate-failure ratchet gated behind `RUN_CANARY_NEGATIVE=1`. `test:integration` and `test:canary` scripts added to `package.json`.
- **Task 5**: `CONNECTOR_MIGRATION.md` extended with `## Townhouse-Side Contract`, `## Known Contract Gaps` table, and `## Townhouse Migration Steps` checklist. `## When to Update This Document` expanded to cover Townhouse.
- **Task 6**: `describe.runIf(RUN_CANARY_NEGATIVE === '1')` block in integration test; tries to pull `0.0.0-broken` tag, asserts failure.
- **Task 7**: `pnpm test` 439/439 ✅; `pnpm test:integration` 3/3 ✅; `pnpm build` ✅; SDK canary 37/37 ✅.

### Review Findings

_Code review run: 2026-04-29 (sources: blind-hunter + edge-case-hunter + acceptance-auditor)_
_Resolution: 2026-04-29 — user redirected scope to "use the connector as the source of truth for the api." All decision-needed and patch findings closed via the contract realignment below._

#### Scope expansion: contract realignment with connector source

The decision-needed item ("stub canary asserts shapes the running connector does not serve") was resolved by aligning `ConnectorAdminClient` to the connector source-of-truth, rather than documenting a permanent gap. This expanded the story scope beyond its original "Does not modify ConnectorAdminClient" carve-out.

**Connector source-of-truth (pulled from `@toon-protocol/connector` v3.3.3):**

- `GET /health` on `healthCheckPort` → `HealthStatus` (`{ status, uptime, peersConnected, totalPeers, timestamp, … }`) — see `packages/connector/src/http/types.ts`.
- `GET /admin/peers` on `adminApi.port` → wrapped envelope `{ nodeId, peerCount, connectedCount, peers: [{ id, connected, ilpAddresses, routeCount, settlement? }] }` — see `packages/connector/src/http/admin-api.ts:538`.
- `GET /admin/metrics.json` on `adminApi.port` → `AdminMetricsJsonResponse` (`{ uptimeSeconds, aggregate: {…}, peers: [{ peerId, … }], timestamp }`) — see `packages/connector/src/http/admin-api.ts:1665`.

**Versions verified:** `pnpm view @toon-protocol/connector dist-tags.latest` → `3.3.3`. Workspace pins `^3.3.3` in every `package.json` (sdk, town, mill, core, townhouse via image). `DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.3.3'` matches. No version bump needed.

#### Patches applied

- [x] [Review][Decision-Resolved] Stub canary contract realigned — `ConnectorAdminClient` now calls the correct paths (`/admin/peers`, `/admin/metrics.json`) and validates the connector's actual served shapes. The stub canary uses URL-bound `mockFetchAt(...)` to fail on either path drift or shape drift. [packages/townhouse/src/connector/{admin-client,types,contract-canary.test}.ts]
- [x] [Review][Patch] Negative canary's any-throw assertion tightened — asserts `errorMsg` matches `/manifest unknown|not found|denied|no such|404/i`. The mid-block bad-image start path was removed because the pull failure short-circuits it deterministically; keeping that dead code was misleading. [packages/townhouse/src/__integration__/connector-image-contract.test.ts]
- [x] [Review][Patch] `beforeAll` health-poll loop now throws diagnostic on deadline expiry — tracks `lastError`, throws `Connector container failed to become healthy within 20s; last error: …` if not ready. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:153-173]
- [x] [Review][Patch] `mockFetch` URL-bound — `mockFetchAt(expectedPath, body)` rejects unless the client requests a URL ending in `expectedPath`, so path drift fails the canary just as loudly as shape drift. [packages/townhouse/src/connector/contract-canary.test.ts:50-72]
- [x] [Review][Patch] Migration doc reconciled — removed the `Known Contract Gaps` table (gaps are now closed in code) and rewrote Seam 1/Seam 2 to reflect the corrected contract. The new "Seam 2 — Container config contract" describes the actual config.yaml-driven contract instead of the never-honored env-var contract. [packages/sdk/CONNECTOR_MIGRATION.md §Townhouse-Side Contract]
- [x] [Review][Patch] Townhouse Migration Steps checklist updated — step 1 reframed as a side-by-side comparison; step 2 references the structural test (`package-structure.test.ts`) that catches `docker-compose-townhouse.yml` drift; step 5 instructs reading the connector source for new shapes. [packages/sdk/CONNECTOR_MIGRATION.md §Townhouse Migration Steps]
- [x] [Review][Patch] `SKIP_DOCKER` accepts `'1'`, `'true'`, `'yes'` (case-insensitive) via `isTruthyEnv` helper. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:39-43]
- [x] [Review][Patch] `afterAll` adds `container.remove({ force: true })` fallback so a created-but-not-started container can't leak. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:176-195]
- [x] [Review][Patch] AC-8 "useful message" assertion tightened to require registry-failure regex, satisfied by the same regex pattern. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:259-262]
- [x] [Review][Patch] Unused `beforeEach` import removed from contract-canary.test.ts. [packages/townhouse/src/connector/contract-canary.test.ts:39]

- [x] [Review][Defer] SOCKS_PROXY empty-string handling is inconsistent across `generate()` and `toEnvVars()` [packages/townhouse/src/connector/config-generator.ts] — deferred, pre-existing (story does not modify config-generator)
- [x] [Review][Defer] `getPeers()` returns `PeerStatus[]` but does not validate per-element shape — `[null]` / `[{}]` pass the array check [packages/townhouse/src/connector/admin-client.ts:77-84] — deferred, pre-existing (story scope-excludes admin-client modifications)
- [x] [Review][Defer] Possible race: `inspect()` immediately after `start()` on slow systems may report `Ports['9401/tcp'] === null` before forwarding completes [packages/townhouse/src/__integration__/connector-image-contract.test.ts:139-150] — deferred, low-frequency speculative; address if it actually flakes
- [x] [Review][Defer] `getHealth()` validator accepts `NaN`/`Infinity`/negative `uptime` (`typeof NaN === 'number'`) [packages/townhouse/src/connector/admin-client.ts:40-47] — deferred, pre-existing
- [x] [Review][Defer] Stub canary lacks coverage for empty / single-element / very-large `activeNodes` cases [packages/townhouse/src/connector/contract-canary.test.ts] — deferred, pre-existing test-coverage gap
- [x] [Review][Defer] No escaping of pathological values (NUL byte, newline) in `toEnvArray()` joining [packages/townhouse/src/connector/config-generator.ts:81-84] — deferred, pre-existing
- [x] [Review][Defer] Image-pull has no abort/retry/timeout — a hung pull blocks `beforeAll` for the full 30s and aborts mid-stream [packages/townhouse/src/__integration__/connector-image-contract.test.ts:76-92] — deferred, follow CI's pre-pull pattern if flakiness emerges

## File List

- `packages/townhouse/src/constants.ts` — added `DEFAULT_CONNECTOR_IMAGE` constant
- `packages/townhouse/src/config/defaults.ts` — replaced literal with `DEFAULT_CONNECTOR_IMAGE`
- `packages/townhouse/src/config/validator.test.ts` — use `DEFAULT_CONNECTOR_IMAGE` in assertion
- `packages/townhouse/src/config/loader.test.ts` — updated YAML fixture literals to `3.3.3`
- `packages/townhouse/src/package-structure.test.ts` — use `DEFAULT_CONNECTOR_IMAGE` in assertion
- `packages/townhouse/src/cli.ts` — consumer updated for `metrics.aggregate.*`; per-peer counts now joined from `metrics.peers[]` by `peerId`
- `packages/townhouse/src/cli.test.ts` — fetch mocks updated to corrected paths/shapes; YAML fixture updated to `3.3.3`
- `packages/townhouse/src/wallet/cli-wallet.test.ts` — all 5 YAML fixture literals updated to `3.3.3`
- `packages/townhouse/src/docker/orchestrator.test.ts` — 2 assertions use `DEFAULT_CONNECTOR_IMAGE`
- `packages/townhouse/src/connector/types.ts` — `HealthResponse`/`MetricsResponse`/`PeerStatus` reshaped to mirror connector source-of-truth; new `MetricsPeerEntry` and `PeersResponse` types exported
- `packages/townhouse/src/connector/admin-client.ts` — paths corrected to `/admin/peers` and `/admin/metrics.json`; validators expanded to mirror `HealthStatus` / `AdminMetricsJsonResponse` / wrapped peers envelope
- `packages/townhouse/src/connector/admin-client.test.ts` — unit tests rewritten against corrected paths/shapes
- `packages/townhouse/src/connector/contract-canary.test.ts` — URL-bound stub canary (`mockFetchAt`) covering corrected paths + full shape contracts; `beforeEach` import removed
- `packages/townhouse/src/connector/index.ts` — exports `MetricsPeerEntry`, `PeersResponse`
- `packages/townhouse/src/index.ts` — re-exports new connector types
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — assertions routed through `ConnectorAdminClient`; SKIP_DOCKER accepts truthy values; beforeAll throws on health-poll deadline; container-leak fallback in afterAll; negative canary asserts registry-failure regex
- `packages/townhouse/src/__integration__/connector-integration.test.ts` — Story 21.3 metrics assertions updated to `metrics.aggregate.*`
- `packages/townhouse/src/api/routes/nodes.ts` — `metricsRes.aggregate.*` consumer
- `packages/townhouse/src/api/routes/metrics-ws.ts` — `metricsRes.aggregate.*` consumer
- `packages/townhouse/src/api/routes/nodes.test.ts`, `nodes-patch.test.ts`, `wallet.test.ts`, `metrics-ws.test.ts`, `api/server.test.ts` — mock `getMetrics()` returns the corrected shape
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — new file (Tasks 4+6)
- `packages/townhouse/package.json` — added `test:integration` and `test:canary` scripts
- `packages/townhouse/vitest.config.ts` — exclude `src/__integration__/**` from default run
- `docker-compose-townhouse.yml` — updated tag to `3.3.3`, added comment pointing to `DEFAULT_CONNECTOR_IMAGE`
- `packages/sdk/CONNECTOR_MIGRATION.md` — Townhouse-Side Contract section rewritten for source-of-truth alignment; Known Contract Gaps removed; checklist tightened

## Change Log

- 2026-04-29: Implement story 21.7.5 — connector image bumped to 3.3.3, DEFAULT_CONNECTOR_IMAGE constant added, all 14 references swept, stub contract canary (17 tests), real-image contract canary (3 tests), migration doc extended with Townhouse-Side Contract section and known contract gap findings.
- 2026-04-29: Code review complete — 1 decision-needed, 10 patches, 7 deferred (pre-existing), 9 dismissed.
- 2026-04-29: Scope expanded by user direction ("use the connector as the source of truth for the api"). Closed the contract gap rather than documenting it: `ConnectorAdminClient` now calls `/admin/peers` and `/admin/metrics.json` and validates the connector's actual served shapes (`HealthStatus`, `AdminMetricsJsonResponse`, wrapped peers envelope). Stub canary rewritten with URL-bound mocks; integration test asserts through `ConnectorAdminClient`; consumers (`cli`, `nodes`, `metrics-ws`) updated for `aggregate.*` shape; mock test fixtures across 5 test files updated. All 10 review patches applied. Tests: 448/448 unit ✅, 3/3 integration ✅, SDK canary 37/37 ✅, build ✅. Status → done.
