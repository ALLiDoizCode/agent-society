# Story 21.7.5: Connector v3.3.x Sweep + Townhouse-Side Contract Canary

Status: backlog

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

- [ ] Task 1: Pin `DEFAULT_CONNECTOR_IMAGE` constant + sweep references (AC: #1, #2)
  - [ ] 1.1 `pnpm view @toon-protocol/connector dist-tags.latest` — record the latest 3.3.x tag. If it has advanced past 3.3.3 since this story was written, use the latest patch.
  - [ ] 1.2 In `packages/townhouse/src/constants.ts`, export `export const DEFAULT_CONNECTOR_IMAGE = 'ghcr.io/toon-protocol/connector:3.3.X'` (where X is the tag from 1.1). Add a comment block above pointing at `packages/sdk/CONNECTOR_MIGRATION.md` and warning that bumps require AC-5 to pass.
  - [ ] 1.3 In `packages/townhouse/src/config/defaults.ts:20`, replace the literal with `DEFAULT_CONNECTOR_IMAGE`. Re-run `pnpm --filter @toon-protocol/townhouse build` to confirm the type system still narrows correctly.
  - [ ] 1.4 In `docker-compose-townhouse.yml:21`, update the literal to the new tag. Add a comment line above pointing at `DEFAULT_CONNECTOR_IMAGE` and noting the two must stay in sync (compose can't import a TS constant; this is the trade-off).
  - [ ] 1.5 In each of the 12 test files referencing `connector:3.3.0` (`config/validator.test.ts`, `config/loader.test.ts:30,239`, `wallet/cli-wallet.test.ts:266,338,397,471,545`, `docker/orchestrator.test.ts:447,497`, `package-structure.test.ts:106`, `cli.test.ts:98,349`), replace the literal with the new tag. Tests that ASSERT the default value (e.g., `package-structure.test.ts:106` `expect(connector['image']).toBe(...)`) should import `DEFAULT_CONNECTOR_IMAGE` from `src/constants.ts` rather than re-stringifying the tag — that way future bumps only touch `constants.ts`. Tests that produce YAML fixtures may keep the literal but with the new tag.
  - [ ] 1.6 Verify zero matches: `rg -n 'connector:3\.3\.0' packages/townhouse docker-compose-townhouse.yml`. Commit as a single atomic "chore(townhouse): bump connector image to 3.3.X" commit.

- [ ] Task 2: Stub-driven canary — admin API shape (AC: #3)
  - [ ] 2.1 Create `packages/townhouse/src/connector/contract-canary.test.ts`. Top of file: a comment block explaining purpose, runtime budget, and pointer to `CONNECTOR_MIGRATION.md` (mirror the header in `packages/sdk/tests/integration/connector-contract.test.ts`).
  - [ ] 2.2 Test group `getHealth() shape contract`: success path; missing `status`; missing `uptime`; wrong-type `status`; wrong-type `uptime`. Each negative case asserts the thrown message contains `invalid health response shape`.
  - [ ] 2.3 Test group `getMetrics() shape contract`: success path; missing each of `packetsForwarded`/`packetsRejected`/`bytesSent`; wrong-type field. Negative cases assert thrown message contains `invalid metrics response shape`.
  - [ ] 2.4 Test group `getPeers() shape contract`: success path with empty array; success path with one peer; non-array body (e.g., object) rejects with `invalid peers response shape`.
  - [ ] 2.5 All tests `vi.spyOn(global, 'fetch')` with `mockResolvedValue(new Response(JSON.stringify(body), {status: 200}))`. No real network. Run with `pnpm --filter @toon-protocol/townhouse test contract-canary` — must complete in <500 ms.

- [ ] Task 3: Stub-driven canary — config-generator env shape (AC: #4)
  - [ ] 3.1 In the same file (`contract-canary.test.ts`), add test group `ConnectorConfigGenerator env-var contract`. Use `getDefaultConfig()` plus `enabled: true` overrides for each node type as inputs.
  - [ ] 3.2 Test: with `activeNodes: ['town', 'mill', 'dvm']` and `transport.mode: 'direct'`, `toEnvVars()` returns exactly the keys `CONNECTOR_ADMIN_PORT`, `CONNECTOR_ILP_ADDRESS`, `CONNECTOR_PEERS`, `TRANSPORT_MODE` (no `SOCKS_PROXY`). Use `Object.keys(envVars).sort()` against an expected snapshot.
  - [ ] 3.3 Test: with `transport.mode: 'ator'` and `socksProxy: 'socks5h://proxy.ator.io:9050'`, the env set additionally contains `SOCKS_PROXY` with that value.
  - [ ] 3.4 Test: `JSON.parse(envVars['CONNECTOR_PEERS'])` returns an array; for each `activeNodes` entry, the corresponding peer has `id === type`, `relation === 'child'`, `btpUrl === 'btp+ws://townhouse-{type}:3000'`, `assetCode === 'USD'`, `assetScale === 6`.
  - [ ] 3.5 Test: `toEnvArray()` returns `KEY=VALUE` strings whose set matches `toEnvVars()` round-tripped. Guards against future `toEnvArray` divergence.

- [ ] Task 4: Running-image smoke canary (AC: #5)
  - [ ] 4.1 Create `packages/townhouse/src/__integration__/connector-image-contract.test.ts`. Confirm `vitest.integration.config.ts` includes `src/__integration__/**/*.test.ts` (it should — Story 21.3 already configured this).
  - [ ] 4.2 `beforeAll`: pull `DEFAULT_CONNECTOR_IMAGE` via `dockerode` if absent (`docker.pull(image)` + stream consume). Start the container with: `Env: configGenerator.toEnvArray(generator.generate([]))`, `HostConfig.PortBindings: { '9401/tcp': [{ HostPort: '<ephemeral>' }] }`, `HostConfig.AutoRemove: true`. Capture the bound host port via `docker.getContainer().inspect().NetworkSettings.Ports`.
  - [ ] 4.3 Poll `http://127.0.0.1:<port>/health` with `ConnectorAdminClient` until 200 (timeout 20 s). Assert response shape via the same validator the production client uses.
  - [ ] 4.4 Hit `/metrics` and `/peers`. Assert each parses through `ConnectorAdminClient` without throwing the "invalid ... shape" error. (Both endpoints will return zeros / empty arrays; that's the contract — they exist and have the right shape.)
  - [ ] 4.5 `afterAll`: stop the container if not already auto-removed; never leave a stray container running.
  - [ ] 4.6 Wrap the entire `describe` in `describe.skipIf(process.env['SKIP_DOCKER'] === '1')`. Add a one-line comment explaining the gate.
  - [ ] 4.7 Add to `packages/townhouse/package.json` a script `"test:canary": "vitest run --config vitest.integration.config.ts src/__integration__/connector-image-contract.test.ts"` so the canary can be invoked standalone (e.g., during a connector bump).

- [ ] Task 5: Migration doc extension (AC: #6)
  - [ ] 5.1 In `packages/sdk/CONNECTOR_MIGRATION.md`, after the "Breaking Changes" section and before "When to Update This Document", insert a new section `## Townhouse-Side Contract` documenting:
    - Why Townhouse needs its own canary (image + admin API + env-var contract, none of which the SDK canary covers).
    - The two surfaces guarded: `ConnectorAdminClient` HTTP shape, `ConnectorConfigGenerator` env-var shape.
    - The two test files: `packages/townhouse/src/connector/contract-canary.test.ts` (stub, fast) and `packages/townhouse/src/__integration__/connector-image-contract.test.ts` (real container, ~5 s after image cache).
  - [ ] 5.2 Append a `## Townhouse Migration Steps` checklist for future contributors bumping the connector image: (1) confirm npm and image versions match, (2) update `DEFAULT_CONNECTOR_IMAGE` in `packages/townhouse/src/constants.ts`, (3) run `pnpm --filter @toon-protocol/townhouse test contract-canary`, (4) run `pnpm --filter @toon-protocol/townhouse test:canary` (the new package script), (5) on failure, back-fill a row in this doc's breaking-changes table with the fix.
  - [ ] 5.3 Update the existing "When to Update This Document" section to also cover Townhouse (currently it's SDK-only). Single combined doc, one workspace migration guide.

- [ ] Task 6: Deliberate-failure ratchet test (AC: #8)
  - [ ] 6.1 In `packages/townhouse/src/__integration__/connector-image-contract.test.ts`, add a separate `describe.runIf(process.env['RUN_CANARY_NEGATIVE'] === '1')` block.
  - [ ] 6.2 Test: with `image = 'ghcr.io/toon-protocol/connector:0.0.0-broken'` (replace `DEFAULT_CONNECTOR_IMAGE`), the same setup throws within 30 s — either at image-pull (image not found) or at health-poll timeout. Assert the failure surfaces a useful message (not just a timeout). This test exists to prove the canary catches what it claims to catch; it is opt-in to keep CI fast.

- [ ] Task 7: Regression sweep + verification (AC: #7)
  - [ ] 7.1 `pnpm --filter @toon-protocol/townhouse test` — must pass with new tests added.
  - [ ] 7.2 `pnpm --filter @toon-protocol/townhouse test:integration` — must pass; image-contract canary lights up.
  - [ ] 7.3 `pnpm --filter @toon-protocol/townhouse build` — must pass.
  - [ ] 7.4 Run the SDK canary as well (`pnpm --filter @toon-protocol/sdk test:integration -- tests/integration/connector-contract.test.ts`) to confirm nothing in the npm-side contract regressed during this work. (Should be a no-op; included for paranoia.)

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
