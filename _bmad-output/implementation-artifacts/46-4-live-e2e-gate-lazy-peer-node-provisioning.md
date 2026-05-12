# Story 46.4: Live E2E Gate — Lazy Peer Node Provisioning

Status: done

> **Fourth and final story of Epic 46 (Lazy Peer Node Provisioning) — the close-out gate per Epic 45 retro A4.** Sized S–M. Depends on Stories 46.1 (`nodes.yaml` schema + reconciler + peer-type resolver — done), 46.2 (POST/DELETE `/api/nodes` 6-step pipeline — done), 46.3 (`townhouse node add|remove|list` CLI verbs + GET `/api/nodes` — done). This story does **not** ship new product code by default; it ships ONE new vitest integration test file that drives the real CLI against real Docker and asserts the happy-path lazy-provisioning lifecycle survives the integration layer. If the gate finds bugs, those are patched in separate PRs **before** this story flips to `done` — that is the explicit rule from `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:802-805` ("any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked done"). Epic 47 cannot start until this story is `done`. Epic 46 cannot flip to `done` until this story is `done`. Both gates are enforced by the comment header in `_bmad-output/implementation-artifacts/sprint-status.yaml:1` (line: "46.4 must complete before Epic 46 flips to done").

## Story

As a **townhouse release engineer** closing out Epic 46,
I want to run the complete `townhouse node add` user journey end-to-end against real Docker infrastructure,
so that **integration gaps not visible in code review are caught before the epic is marked done**.

## Acceptance Criteria

1. **Given** a fresh `~/.townhouse/` state with apex already running (`townhouse hs up` complete)
   **When** the E2E gate runs
   **Then** the following sequence completes without error:
   1. `townhouse node add town` — provisions a Town node, writes `nodes.yaml`, registers with connector
   2. `townhouse node list` — shows the Town node as active
   3. `townhouse node remove <id>` — deregisters and stops the Town node
   4. `townhouse node list` — shows no active nodes
   5. Re-run `townhouse hs up` — apex re-uses existing volume, hostname unchanged

2. **Given** the gate run completes
   **When** the story is closed out
   **Then** any bugs found during the gate run are patched (in separate PRs if needed) before this story is marked `done`
   **And** findings (or "no issues found") are documented in `### Review Findings` with a date stamp

**FRs:** FR1–FR17 (full epic validation) | **NFRs:** NFR1, NFR2, NFR7, NFR8, NFR9

## Tasks / Subtasks

- [ ] **Task 1: Pre-work — read modified files end-to-end (AC: all)**
  - [ ] 1.1 Read `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts` end-to-end (312 lines). This is the **template** for the new test file — same skip gates, same `runCli` + `waitForExit` helpers, same `mkdtempSync` + `TOWNHOUSE_WALLET_PASSWORD` pattern, same `dockerPs()` / `volumeExists()` / `cleanupContainersAndVolumes()` helpers, same `cli.ts` argv routing (`init` takes `--config-dir`, `hs`/`node` take `-c <config.yaml>`).
  - [ ] 1.2 Read `packages/townhouse/src/__integration__/_test-helpers.ts` end-to-end (187 lines). Confirm: `CLI_BIN` resolves to `packages/townhouse/dist/cli.js` (requires `pnpm --filter @toon-protocol/townhouse build` before the test runs); `runCli(command, opts)` returns `{ process, stdout, stderr }` and routes `init`/`setup` → `--config-dir <dir>` vs. other commands → `-c <dir>/config.yaml`; `waitForExit` SIGKILLs on timeout; `waitForUrl` polls with 2s interval default.
  - [ ] 1.3 Read `packages/townhouse/src/cli/node-commands.ts` end-to-end (548 lines). Confirm exit-code contract: `handleNodeAdd` exits 0 on 201, 1 on 4xx/5xx; `handleNodeRemove` exits 0 on 200, 1 on 4xx/5xx; `handleNodeList` exits 0 on 200, 1 on connection error. CLI prints **stage labels** for add (`· Pulling image · Deriving wallet · Registering with apex · Live`); list emits a 4-column table (`peer · type · status · last claim`) and shows `(no nodes — try \`townhouse node add town\`)` on empty.
  - [ ] 1.4 Read `packages/townhouse/src/api/routes/nodes-lifecycle.ts` lines 125–270 (POST happy path + step 1–3 ordering). Confirm: containers are named `townhouse-hs-${type}` (NOT `townhouse-${type}` — the dev-stack prefix is different); `nodes.yaml` write happens at step 3, BEFORE connector registration at step 6; 201 response shape is `{id, type, peerId, ilpAddress, hsRoute, healthCheckUrl}`; the response does not echo `derivationIndex` (it's an internal HD-wallet detail).
  - [ ] 1.5 Read `packages/townhouse/src/state/nodes-yaml.ts` end-to-end (116 lines). Confirm the file mode invariant is `0o600` (assertion target in the gate); on ENOENT the read returns `{entries: []}` rather than throwing.
  - [ ] 1.6 Read `packages/townhouse/src/docker/orchestrator.ts` lines 376–500 (`upHs` + `waitForHsHostname`) AND lines 671–717 (`downHs`). Confirm: HS-mode containers are `townhouse-hs-connector` + `townhouse-hs-api` at apex, `townhouse-hs-${type}` for child nodes; the `townhouse-hs-anon` volume is preserved across `hs down` (no `-v` flag); `hs down` is idempotent (returns 0 if nothing is running).
  - [ ] 1.7 Read `packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts` end-to-end (220+ lines) for the SIGTERM-based teardown pattern (`upProcess?.process.kill('SIGTERM')` + `waitForExit`). Reuse this pattern when the test needs to stop `townhouse hs up` after the AC #1 sequence completes (the `hs up` CLI does NOT exit on its own — it keeps the API server alive until SIGTERM, per `cli.ts:500-525`).
  - [ ] 1.8 Read `packages/townhouse/scripts/get-image-digest.mjs` and `packages/townhouse/scripts/start-api-only.mjs` to confirm there is no existing E2E-against-real-CLI helper script we should reuse here (there isn't — the helpers live in `_test-helpers.ts` instead).

- [ ] **Task 2: Verify pre-conditions before drafting the test (AC: all)**
  - [ ] 2.1 Confirm `packages/townhouse/dist/image-manifest.json` exists OR document how to obtain it. The CI publish workflow `.github/workflows/publish-townhouse-images.yml:222-226` uploads it as an artifact named `image-manifest`. The local dev path is `gh run download <id> --name image-manifest -D packages/townhouse/dist/`. The test MUST skip gracefully (with a clear warning) if the manifest is missing — mirror the pattern in `townhouse-hs-up.test.ts:17-19` and `townhouse-hs-up.test.ts:45`.
  - [ ] 2.2 Confirm `pnpm --filter @toon-protocol/townhouse build` has been run (so `dist/cli.js` exists). The test will spawn `node dist/cli.js ...` — without the build, every `runCli` call throws ENOENT at the CLI binary path.
  - [ ] 2.3 Confirm `bash scripts/townhouse-test-infra.sh up` succeeds (warms the Docker image cache so the first `hs up` does not spend 5 minutes pulling). The script is preset-agnostic — it warms the same cache for every downstream `townhouse init` flow.
  - [ ] 2.4 Confirm `127.0.0.1:9401` (connector admin) and `127.0.0.1:28090` (townhouse-api) are free. The CLI binds the connector admin to `9401` and the host API to `28090` — port conflict ⇒ `hs up` fails with an opaque docker error.
  - [ ] 2.5 Confirm Docker daemon is reachable: `docker ps > /dev/null && echo ok`. Without it, the gate is a no-op.

- [ ] **Task 3: Implement the new gate test file (AC: 1)**
  - [ ] 3.1 NEW file: `packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts`. Header comment block mirrors `townhouse-hs-up.test.ts:1-20` exactly: purpose, prereqs (RUN_DOCKER_INTEGRATION=1, SKIP_DOCKER unset, dist/image-manifest.json, pnpm build), test budget, AC mapping (Story 46.4 AC #1 steps 1–5).
  - [ ] 3.2 Skip gates: `const SKIP_DOCKER = isTruthyEnv(process.env['SKIP_DOCKER'])`, `const RUN_INTEGRATION = process.env['RUN_DOCKER_INTEGRATION'] === '1'`, `const shouldRun = RUN_INTEGRATION && !SKIP_DOCKER`. Print the `console.warn` skip notice when `!shouldRun` (mirror `townhouse-hs-up.test.ts:41-47`). Wrap the entire suite in `describe.skipIf(!shouldRun)`.
  - [ ] 3.3 Test-fixture state (suite-level `let`s):
    - `tmpDir: string` — fresh `mkdtempSync(join(tmpdir(), 'townhouse-node-e2e-'))` per suite
    - `apexProcess: ReturnType<typeof runCli> | undefined` — long-lived `hs up` subprocess kept alive across all tests; SIGTERM'd in `afterAll`
    - `firstHostname: string` — captured after the first `hs up` succeeds; compared against the AC #1 step 5 re-run hostname
    - `addedNodeId: string` — captured from the POST 201 response so the remove step uses the actual id (defensive against any future schema change where id ≠ type)
  - [ ] 3.4 `beforeAll`:
    1. `process.env['TOWNHOUSE_WALLET_PASSWORD'] = 'integration-test'`
    2. `cleanupContainersAndVolumes()` — defensive against a crashed prior run; reuse the helper inlined from `townhouse-hs-up.test.ts:70-91`
    3. Run `townhouse init` via `runCli('init', { configDir: tmpDir, password: TEST_PASSWORD })`; assert exit 0 within 30s
    4. Spawn `townhouse hs up` via `runCli('hs', { configDir: tmpDir, password: TEST_PASSWORD, extraArgs: ['up'] })`; await exit 0 within **360_000 ms** (matches `townhouse-hs-up.test.ts:138` — first-boot can take up to 5 min per NFR1)
    5. Capture `firstHostname` from `host.json` (NOT from stdout — the structured artifact is more reliable: `JSON.parse(readFileSync(join(tmpDir, 'host.json'), 'utf-8')).hostname`)
    6. **Do NOT keep `hs up` alive as a long-lived process** — `townhouse hs up` exits 0 once the apex is published (idempotent re-run path takes <30s; cold-start path waits for `.anyone` hostname then exits per `cli.ts:1110` family). Confirm this against the cli.ts source before relying on it; if it actually stays alive, switch to the SIGTERM-on-afterAll pattern from `townhouse-cli-lifecycle.test.ts:122-133`.
    7. Wait for the host API to become healthy: `waitForUrl('http://127.0.0.1:28090/health', { maxMs: 30_000, label: 'townhouse-api /health' })`. This guards against AC #1 step 1 racing with the API server's boot.
    - Total `beforeAll` budget: **480_000 ms** (8 min — generous for cold image pulls).
  - [ ] 3.5 `afterAll`:
    1. Best-effort `townhouse hs down` via `runCli('hs', { configDir: tmpDir, extraArgs: ['down'] })`; await exit within 60s
    2. `cleanupContainersAndVolumes()` — reuse helper from 3.3; explicitly removes `townhouse-hs-anon` and all `townhouse-hs-{town,mill,dvm}-data` volumes so re-running the suite is clean
    3. `rmSync(tmpDir, { recursive: true, force: true })`
    4. `delete process.env['TOWNHOUSE_WALLET_PASSWORD']`
    - Total `afterAll` budget: **120_000 ms**.
  - [ ] 3.6 Test #1 (AC #1 step 1): `'node add town provisions a Town node and registers with the connector'`. Run `townhouse node add town --json` via `runCli` and capture stdout. Assert exit 0 within 180_000 ms. Parse the JSON body; assert `body.ok === true`, `body.type === 'town'`, `body.peerId === 'town'` (per v1 invariant: `peerId === id === type`), `body.ilpAddress === 'g.townhouse.town'`. Verify `~/.townhouse/nodes.yaml` exists with mode `0o600` and one entry of `type: 'town'` (use `readNodesYaml(join(tmpDir, 'nodes.yaml'))` — import via dynamic ESM import so the test file stays in the integration suite). Verify the container `townhouse-hs-town` is in `docker ps`. Store `addedNodeId = body.id` for the remove step.
  - [ ] 3.7 Test #2 (AC #1 step 2): `'node list shows the Town node as active'`. Run `townhouse node list --json`. Assert exit 0 within 10_000 ms. Parse stdout (it's the API response body verbatim, not wrapped in `{ok}` — per the 46.3 contract). Assert `body.nodes.length === 1`, `body.nodes[0].type === 'town'`, `body.nodes[0].status === 'connected'`. (If `status === 'disconnected'` or `'unknown'`, poll up to 30s — the connector's peer-connected flag is async after `register-peer` returns 200; this matches the polling pattern in `townhouse-cli-lifecycle.test.ts:156-165`.)
  - [ ] 3.8 Test #3 (AC #1 step 3): `'node remove <id> deregisters and stops the Town node'`. Run `townhouse node remove ${addedNodeId} --yes --json`. Assert exit 0 within 60_000 ms. Parse stdout; assert `body.ok === true`, `body.id === addedNodeId`, `body.type === 'town'`. Verify `townhouse-hs-town` is **no longer** in `docker ps`. Verify `nodes.yaml` is now `{ entries: [] }`.
  - [ ] 3.9 Test #4 (AC #1 step 4): `'node list shows no active nodes after remove'`. Run `townhouse node list --json`. Assert exit 0 within 10_000 ms. Parse stdout; assert `body.nodes.length === 0`. (Empty state — the `(no nodes — try ...)` hint only fires in non-JSON mode; with `--json`, the response is `{nodes: []}`.)
  - [ ] 3.10 Test #5 (AC #1 step 5): `'re-run hs up preserves volume + hostname (apex idempotent)'`. Run `townhouse hs up` again via `runCli`. Assert exit 0 within 30_000 ms (idempotent path is fast — see `cli.ts:878-908`'s idempotency probe via `getHsHostname()`). Verify `townhouse-hs-anon` volume still exists. Re-read `host.json`; assert `hostname === firstHostname`. Verify `townhouse-hs-connector` and `townhouse-hs-api` containers are still running (no recreated containers — same container IDs would be ideal but is brittle; container *names* present is sufficient).
  - [ ] 3.11 Per-test timeout discipline: each `it(...)` call has an explicit numeric third argument matching the budgets above. NEVER rely on the suite-level `testTimeout: 120000` from `vitest.integration.config.ts:14` — the suite-level value is a ceiling, not a per-test default that scales with the operation.

- [ ] **Task 4: Helper extraction (AC: all)**
  - [ ] 4.1 Inline `dockerPs`, `volumeExists`, and `cleanupContainersAndVolumes` helpers from `townhouse-hs-up.test.ts:54-91` INTO the new test file. Do NOT extract them to `_test-helpers.ts` in this story — Story 21.16 deliberately kept them per-test-file to avoid a shared mutation surface, and that discipline still holds. The cost is ~40 lines of duplication; the benefit is zero coupling between tests. **Exception:** if a future story needs the same helpers, that story can extract them — not this story.
  - [ ] 4.2 Use `runCli`, `waitForExit`, `waitForUrl`, `CLI_BIN`, and `isTruthyEnv` from `_test-helpers.ts` directly. Do NOT duplicate them.
  - [ ] 4.3 Reading `nodes.yaml` from the test: import `readNodesYaml` from `'../state/nodes-yaml.js'` (relative path, ESM, `.js` extension per the project ESM convention from `project-context.md`). This avoids hand-rolling a YAML parser in the test.

- [ ] **Task 5: Gate execution (AC: 1, 2)**
  - [ ] 5.1 Run the gate locally:
    ```
    cd /home/jonathan/Documents/town
    pnpm --filter @toon-protocol/townhouse build
    bash scripts/townhouse-test-infra.sh up
    # Ensure dist/image-manifest.json is present (gh run download artifact or hand-write a local one)
    RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration src/__integration__/townhouse-node-lifecycle-e2e.test.ts
    ```
  - [ ] 5.2 Total wall time: 8–12 minutes on a typical machine (5 min for the first `hs up` if images aren't already cached, plus ~30–60 s for `node add`, plus ~10 s per other test).
  - [ ] 5.3 Categorize any failures:
    - **Integration bug** (not visible in unit tests): file a separate PR, fix, retry the gate. Document the bug + fix link in `### Review Findings` below.
    - **Flake** (intermittent): mark with `it.skipIf(false, 'flake — investigated, root cause: ...')` only if the root cause is known and out-of-scope (e.g., upstream Docker bug). Document the flake category + workaround.
    - **Environmental** (missing dist, port conflict, daemon down): not a gate failure — surface a clearer skip/error message in the test header, retry.
  - [ ] 5.4 Document the gate outcome in `### Review Findings` with this format:
    ```
    _Gate run 2026-05-XX — [no issues found | N bugs found, all patched in PRs #X, #Y, #Z]._

    - [Test 1: add town] PASS — Town container appeared in docker ps in 42 s; nodes.yaml mode 0o600 confirmed; peerId match.
    - [Test 2: list shows active] PASS — status transitioned connected within 4 s of POST 201.
    - [Test 3: remove] PASS — container removed in 8 s; nodes.yaml empty.
    - [Test 4: list shows empty] PASS — {nodes: []}.
    - [Test 5: re-up idempotency] PASS — hostname unchanged, volume preserved.
    ```
    If bugs were found, replace each PASS with a brief diagnosis + PR link.

- [ ] **Task 6: Close-out (AC: 2)**
  - [ ] 6.1 Verify the test file passes when re-run cleanly from a fresh tmp dir (no carryover state from prior runs).
  - [ ] 6.2 `pnpm --filter @toon-protocol/townhouse build` — clean.
  - [ ] 6.3 `pnpm --filter @toon-protocol/townhouse test` — unit suite still green (no regressions from the new test file landing in the integration suite; the integration suite is only run via `test:integration`, not `test`).
  - [ ] 6.4 `pnpm lint` — no new errors introduced.
  - [ ] 6.5 Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `46-4-live-e2e-gate-lazy-peer-node-provisioning` → `review` (then `done` after code review per the standard flow). The yaml's leading comment block at line 1 already records the dependency; do NOT remove or rewrite it.
  - [ ] 6.6 Confirm `### Review Findings` contains a **dated** entry (not "Pending review"). The close-out checklist below enforces this.

## Dev Notes

### Story Mission — Validation Only, No New Product Code

This is a **gate** story. Epic 45 retrospective action A4 (referenced in `_bmad-output/implementation-artifacts/sprint-status.yaml:1`) introduced these "Live E2E Gate" stories to every epic close-out so that *integration gaps not visible in code review* fail before the epic is marked done. The pattern mirrors Story 21.16 (Epic 21's gate, which delivered `townhouse-test-infra.sh` and the `townhouse-cli-lifecycle.test.ts` suite).

**Hard rules** for this story:

1. **No new product source files outside `src/__integration__/`.** If the gate reveals a bug, fix it in a separate PR with its own story-less commit message; this story only contains the test file.
2. **No changes to existing product source.** Same reason — bug fixes go in separate PRs.
3. **One new test file only.** `packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts`. Do not split into multiple files; the 5-step sequence belongs in one `describe` block so the suite-level `beforeAll` (which boots the apex) amortizes across all 5 tests.
4. **No new test infra script.** `scripts/townhouse-test-infra.sh` already warms the image cache for every downstream `townhouse init` flow — the new test uses it without modification.
5. **Bugs found → separate PRs → gate re-run → THEN flip to `done`.** This is the explicit rule from `epics-townhouse-hs-v1.md:802-805`.

### Architectural Layering — What the Gate Actually Exercises

```
real CLI binary (dist/cli.js, spawned via node)
   ↓ argv parsing (cli.ts:1359 case 'node')
node-commands.ts (handleNodeAdd / Remove / List)
   ↓ fetch()  ← REAL HTTP, not stubbed
HS host API (127.0.0.1:28090)  ← REAL Fastify, not in-process supertest
   ↓ Fastify route handlers
nodes-lifecycle.ts (POST / DELETE / GET /api/nodes)
   ↓ WalletManager.deriveNodeKey, orchestrator.pullImage, orchestrator.startContainer,
   ↓ orchestrator.waitForHealthy, connectorAdmin.registerPeer
DockerOrchestrator (real dockerode, REAL docker.sock)
ConnectorAdminClient → connector container at 127.0.0.1:9401  ← REAL container
WalletManager → wallet.enc on tmpDir  ← REAL HD derivation
nodes-yaml.ts → tmpDir/nodes.yaml  ← REAL filesystem
```

Every layer the unit tests stub is real here. That is the point — the unit suite has 944+ tests passing, but they all stop at the `fetch` boundary or the `Mock` boundary. The integration gaps that ship to operators are the seams between layers, and those only surface with end-to-end execution.

### Why This Story Exists — Epic 45 Retro A4

Epic 45 closed `done` with a passing CI suite. Inside two weeks, a pilot operator hit an integration bug that no unit test could have caught: the orchestrator's `upHs()` left `activeNodes` stale after a partial failure, which made the reconciler observe a phantom node on the next `hs up`. The retro identified this as a **structural gap**: every epic ends with surfaces that compose only at runtime, and unit-level mocking can't exercise that composition.

A4 mandates a Live E2E Gate per epic. Story 46.4 is the Epic 46 instance. Story 47.5 is the Epic 47 instance (earnings data plane). Story 48.7 and Story 49.7 follow the same pattern for their respective epics.

### Container Naming — HS-Mode vs. Dev-Stack (DO NOT CONFUSE)

The `dev` profile (`townhouse-dev-infra.sh` → `townhouse up`) uses container names:
- `townhouse-connector`, `townhouse-town`, `townhouse-mill`, `townhouse-dvm`

The `hs` profile (`townhouse hs up`) uses container names with a `hs-` infix:
- `townhouse-hs-connector`, `townhouse-hs-api`, `townhouse-hs-town`, `townhouse-hs-mill`, `townhouse-hs-dvm`

This story exercises the **`hs` profile**. Every `docker ps` filter must use `--filter name=townhouse-hs-` (with the `hs-` infix) to avoid catching containers from a parallel dev-stack run on the same machine.

### Image Manifest Requirement

The POST `/api/nodes` route reads `~/.townhouse/image-manifest.json` to resolve the digest-pinned image for each node type (step 2 `pull-image`). The manifest is materialized by `compose-loader.ts` during `townhouse hs up` from `dist/image-manifest.json` shipped in the npm tarball. **The dist artifact must be present** before the test runs — either via `gh run download <id> --name image-manifest -D packages/townhouse/dist/` (downloads from the latest CI publish run) or by hand-writing a local stub with valid `sha256:...` digests.

If the manifest is missing, `hs up` will fail at the compose-template materialization step with an error like `image-manifest.json not found`. The test's `beforeAll` will then time out at 360s waiting for the apex hostname. To prevent silent failures, the new test file's header comment block MUST call out this requirement explicitly (mirror `townhouse-hs-up.test.ts:17-19`).

### Port Allocation — HS Mode

The `hs` profile binds:
- `127.0.0.1:9401` — connector admin (`/health`, `/admin/*`)
- `127.0.0.1:28090` — townhouse-api (Fastify, `/api/nodes`, `/api/earnings`, etc.)

Both ports must be free before `hs up` runs. The 28xxx range is shared with `townhouse-dev-infra.sh` (which uses 28080 for *its* connector admin) — running both stacks simultaneously WILL collide. The new test does NOT need to defend against this (the dev-stack is opt-in); it just needs to fail fast with a clear message if the ports are bound.

### Idempotency Probe Path (AC #1 step 5)

`townhouse hs up` invoked against an already-running apex takes a **fast path** at `cli.ts:878-908`:

1. Probe `connectorAdmin.getHsHostname()` with a 3s timeout.
2. If `hostname !== null` → print `Apex live at <hostname>`, refresh `host.json`, return.

This path takes <5s in practice and does NOT touch Docker. So AC #1 step 5 ("re-run `townhouse hs up` — apex re-uses existing volume, hostname unchanged") is the idempotency-probe path, not a cold boot. The test's 30s budget for this step is generous; the actual wall-clock is 1–3s.

### Connection-Reachability Race (AC #1 step 2)

After the POST `/api/nodes` 201 response returns, the new peer is registered with the connector. But the connector's internal `peers[].connected` flag transitions to `true` asynchronously, after the BTP handshake completes. The window is typically <2s but can stretch to 10s under load.

The `townhouse node list` AC asserts `status === 'connected'`. To avoid flake, the test MUST poll up to 30s for the connected state, with 2s interval (mirror `townhouse-cli-lifecycle.test.ts:156-165`). Don't assert on the first call.

### Wallet Password Discipline

The test uses `TOWNHOUSE_WALLET_PASSWORD='integration-test'` via env var (mirrors `townhouse-hs-up.test.ts:49,98`). The `runCli` helper forwards env. Do NOT use `--password` flag; the env var path is the documented test convention and is what every other integration test uses. Restore by `delete process.env['TOWNHOUSE_WALLET_PASSWORD']` in `afterAll`.

### What NOT to Test (Scope Guards)

- **No multi-instance tests.** v1 enforces single-instance-per-type at the API layer (409 `node_type_in_use`). 46.3's unit suite covers the 409 case. The gate does not need to re-exercise it.
- **No rollback path tests.** The 6-step pipeline's rollback is covered by 46.2's state-machine table tests with injected failures. The gate exercises the **happy path**; rollback paths are unit-suite territory.
- **No Mill / DVM provisioning.** AC #1 explicitly enumerates `node add town`. Mill and DVM are opt-in (FR12) and have their own provisioning quirks (Mill writes `mill.config.json`; DVM has no `nodes.yaml` mill-style config). Future stories may add Mill/DVM gate tests; this one stays focused on the AC.
- **No reconciler tests.** Story 46.1's reconciler runs silently on `hs up`; its assertions live in `reconciler.test.ts`. The gate trusts the unit suite for reconciler correctness.
- **No earnings tests.** Story 47.5 owns the earnings gate. This story does NOT touch `/api/earnings`.
- **No SPA tests.** Playwright specs against the SPA are out-of-scope; the CLI is the user-facing surface for v1.
- **No telemetry tests.** Telemetry has its own integration story (TH-21.17.14 in the planning doc); this gate ignores telemetry.
- **No `--rotate-keys` tests.** Hostname-rotation is tested in `townhouse-hs-up.test.ts:273-311`; the gate uses the volume-preserved path (idempotent re-up).
- **No production-code edits.** Per the hard rules above.

### Previous Story Intelligence (46.1 + 46.2 + 46.3)

- **POST response shape (46.2):** `{id, type, peerId, ilpAddress, hsRoute, healthCheckUrl}` on 201. No `derivationIndex` (internal). Test assertions key off `id` and `peerId`.
- **DELETE response shape (46.2):** `{id, type}` on 200.
- **GET response shape (46.3, NEW):** `{nodes: [{id, type, peerId, ilpAddress, status, enabledAt, lastSeenAt}]}`. `status: 'connected' | 'disconnected' | 'unknown'`.
- **CLI exit codes (46.3):** add/remove/list all exit 0 on success, 1 on error. `--json` mode emits one-line JSON to stdout; failures emit `{ok: false, error, ...}` JSON (also to stdout) per the 46.3 contract.
- **`--json` is the gate's friend.** Parse stdout as one-line JSON; do NOT regex over human-formatted output. AC #5 in 46.3 specifies `node list --json` emits the API body verbatim (no `ok` envelope) — list responses are `{nodes: [...]}`; add/remove responses are `{ok: true, ...}`.
- **Step identifiers (46.2):** `derive-key`, `pull-image`, `write-yaml`, `start-container`, `healthcheck`, `register-peer` (POST); `deregister-peer`, `stop-container`, `remove-yaml` (DELETE). These appear in error response bodies as `{step, err}`. The gate does not assert on step values in the happy path, but they're useful for failure diagnosis in `### Review Findings`.
- **`node_lifecycle_in_flight` 409:** concurrent POST/DELETE serialization (mutex). The gate runs sequentially, so this should not fire. If it does in the gate, something is leaking the mutex across tests — file a bug PR.
- **Known deferred 46.3 issues** (10 items in 46.3 Review Findings, all marked Defer): `getPeers()` error classification, `AbortController` not torn down on success, no SIGINT cleanup during `confirmInteractive`, unbounded id length, ANSI passthrough in stderr, yaml-read 500 leaks filesystem path, `'disconnected'` collapses missing-peer states, `parseArgs({strict: false})` typos, DELETE-id regex duplicated, STAGE_LABELS visual-order mismatch. **None of these are blockers for this gate** — they're refinements. If the gate happens to trip on one of them, document it in `### Review Findings` and decide whether to patch in a follow-up PR or accept as known-deferred.

### Files This Story Creates

- **`packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts`** — the one new file. Sized ~250–350 lines (header comment ~30 lines, suite setup ~80 lines, 5 tests ~30–50 lines each, cleanup helpers ~40 lines).

### Files Read but NOT Modified

- `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts` — template for the new test file. Read end-to-end (Task 1.1).
- `packages/townhouse/src/__integration__/_test-helpers.ts` — `runCli`, `waitForExit`, `waitForUrl`, `CLI_BIN`, `isTruthyEnv`. Read end-to-end (Task 1.2).
- `packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts` — SIGTERM teardown pattern (Task 1.7).
- `packages/townhouse/src/cli/node-commands.ts` — exit codes, `--json` contract, stdout format (Task 1.3).
- `packages/townhouse/src/api/routes/nodes-lifecycle.ts` — response shapes, container naming (Task 1.4).
- `packages/townhouse/src/state/nodes-yaml.ts` — `readNodesYaml`, file mode invariant (Task 1.5).
- `packages/townhouse/src/docker/orchestrator.ts` — HS up/down semantics, volume preservation (Task 1.6).
- `packages/townhouse/src/constants.ts` — `CONTAINER_PREFIX`, port constants.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — the comment block at line 1 establishes the dependency rule; the body needs a status flip in Task 6.5.

### Test Strategy Notes

- **No real wallet decryption mocking.** The test boots a real wallet with `password='integration-test'` and trusts the actual HD-derivation path. This is the same posture as `townhouse-hs-up.test.ts`.
- **No `vi.mock` calls.** This is an integration test. Every dependency is real. Mocking defeats the purpose.
- **No stdin shimming.** The CLI runs as a subprocess; its stdin is `'ignore'` (per `runCli` default in `_test-helpers.ts:108`). The test never injects stdin.
- **`process.exitCode` is NOT the assertion target.** The CLI runs as a subprocess; its exit code is observed via `waitForExit(child.process, timeoutMs)`, which returns the numeric exit code.
- **Container assertions are name-based, not id-based.** Container IDs change across runs; container names are stable per the orchestrator's deterministic naming.
- **Volume-existence assertions are name-based.** `volumeExists('townhouse-hs-anon')` returns boolean from `docker volume ls --filter name=...`.
- **Per-test timeout is the third argument to `it(...)`.** Suite-level `testTimeout` is a ceiling, not a default.
- **Sequential, not parallel.** The 5 tests share state (the apex booted in `beforeAll`). `it.concurrent` would race them. Vitest's default is sequential; do NOT override.

### Connector Endpoint References (consumed, not modified)

- `GET /admin/peers` (via `connectorAdmin.getPeers()`) — used by `GET /api/nodes` and the connector's own peer-state machine. The gate observes the result indirectly through `node list`.
- `POST /admin/peers` — issued by the POST `/api/nodes` step 6. The gate observes the result indirectly through `node list` showing `status: 'connected'`.
- `DELETE /admin/peers/:peerId` — issued by the DELETE `/api/nodes/:id` step 1 (reverse pipeline). The gate observes the result indirectly through `node list` showing 0 nodes.
- `GET /admin/hs-hostname` (CR-1, connector v3.5.0+) — used by `cli.ts:878-908` idempotency probe and by `waitForHsHostname()`. The gate's AC #1 step 5 exercises this.

### NPM-Tarball Coupling — Future Compatibility

The `npm publish` pipeline (Story TH-21.17 — not yet shipped) will ship `dist/compose/`, `dist/cli.js`, and `dist/image-manifest.json` in the tarball. The new test file MUST work against this tarball-shaped layout when 21.17 ships; the only thing that should change is the path to `dist/cli.js` (already abstracted via `CLI_BIN` in `_test-helpers.ts`). The gate is forward-compatible by construction.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- Pre-existing 11 typecheck failures in townhouse (transportProbe missing, dev-fixtures undefined, wizard mock shape) — out-of-scope for this story; no new typecheck errors introduced by the new file.
- Gate first run (rc5 manifest as-shipped): `townhouse hs up` exits 1 in <15 s with `Connector admin API unexpected status 404 on /admin/hs-hostname` → uncovered Finding A.
- Gate second run (local manifest patched to connector v3.5.1): `townhouse hs up` exits 1 in ~13 s with `Hidden service didn't publish in time`; root-caused by direct probe of `127.0.0.1:9401/admin/hs-hostname` (503 anon-disabled) + `docker exec townhouse-hs-connector cat /config/connector.yaml` showing `transport: type: direct` despite tmpDir-local `connector.yaml` having `transport: type: socks5` + `anon.enabled: true` → uncovered Finding B (hardcoded `~/.townhouse/` bind-mount in compose template).

### Completion Notes List

- Implemented the single new gate test file at `packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts` (~310 lines). Helpers (`dockerPs`, `volumeExists`, `cleanupContainersAndVolumes`) inlined per Story 21.16 discipline; `runCli` / `waitForExit` / `waitForUrl` / `readNodesYaml` imported. Per-test timeouts explicit (3rd arg to `it`). Skip gates mirror `townhouse-hs-up.test.ts` (`RUN_DOCKER_INTEGRATION=1` + `!SKIP_DOCKER`).
- Gate executed locally (Task 5) — found 2 high-severity integration bugs (Findings A and B in Review Findings). Per the explicit rule in `epics-townhouse-hs-v1.md:802-805` and Story Close-Out Checklist, the story status is `review` (test file landed, gate ran) but cannot flip to `done` until both findings are patched in separate PRs and the gate re-runs green.
- No production source files were modified — gate-only story. Findings will be patched in follow-up PRs (one for the publish workflow's manifest generation, one for the compose template's bind-mount sources).
- pnpm build green; pnpm lint clean on the new file; integration test suite gated correctly (skips without `RUN_DOCKER_INTEGRATION=1`).

### File List

- `packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts` — NEW: 5-test integration suite covering AC #1 sequence. Currently fails at `beforeAll` due to Findings A + B (documented in Review Findings).
- `_bmad-output/implementation-artifacts/46-4-live-e2e-gate-lazy-peer-node-provisioning.md` — status flipped to `review`; Review Findings populated with dated 2026-05-11 entry; Dev Agent Record completed.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `46-4-live-e2e-gate-lazy-peer-node-provisioning` → `review`.

### Change Log

- 2026-05-11: Added `townhouse-node-lifecycle-e2e.test.ts` integration suite. Ran gate locally; documented 2 integration bugs in Review Findings; story status → `review`.

### Review Findings

_Gate run 2026-05-11 — 2 integration bugs found at apex boot (BLOCKED before AC #1 step 1 could execute). The 5-step lifecycle sequence could not be exercised end-to-end; gate is **FAIL** until the two findings below are patched in separate PRs and the gate re-runs green._

The gate boots a fresh tmpDir via `townhouse init` + `townhouse hs up`. The first run failed because the apex never produced a hostname; root-cause analysis surfaced two distinct integration defects.

- **Finding A (HIGH) — rc5 npm tarball pins connector v3.4.1, which lacks `/admin/hs-hostname`.**
  - Symptom: `townhouse hs up` exits 1 with `Apex boot failed: Connector admin API unexpected status 404 on /admin/hs-hostname — expected 200 or 503 (connector image may be too old or misconfigured)`.
  - Root cause: `packages/townhouse/dist/image-manifest.json` (artifact from publish workflow run 25614777350 / v0.1.0-rc5, 2026-05-09) sets `images.connector = { tag: "3.4.1", digest: "sha256:4a24ccb0997d…" }`. The `/admin/hs-hostname` endpoint was added in connector v3.5.0 (toon-protocol/connector#59, Story 44.1). The rc5 manifest was built before the connector pin was bumped, so the published tarball cannot satisfy `townhouse hs up`. Any operator running `npm install -g @toon-protocol/townhouse@0.1.0-rc5 && townhouse hs up` hits this immediately.
  - Workaround for local gate: I substituted a local manifest pointing to `ghcr.io/toon-protocol/connector@sha256:b3c535831a64…` (v3.5.1, already cached locally) and re-rendered `dist/compose/townhouse-hs.yml`. With v3.5.1 the connector starts and serves `/admin/hs-hostname` — exposing Finding B.
  - Patch direction: bump `images.connector.tag` to a v3.5.x release in the publish workflow's manifest generation step, republish as rc6 (or v0.1.0 GA). Out-of-scope for Epic 46; falls under Epic 45 retro / publish pipeline. File as a separate PR against the publish workflow.

- **Finding B (HIGH) — `compose/townhouse-hs.yml` hardcodes `~/.townhouse/connector.yaml` as a bind-mount source, ignoring `--config-dir`.**
  - Symptom: with connector v3.5.1 in place, `townhouse hs up` exits 1 with `Hidden service didn't publish in time` after ~13 s. The connector logs show `transport: type: direct` and no `anon:` block — the config the CLI just wrote to `<tmpDir>/connector.yaml` is NOT what the container reads. Direct probe: `curl http://127.0.0.1:9401/admin/hs-hostname` → `503 {"error":"anon-disabled"}`. The orchestrator's fatal-503 early-exit (`packages/townhouse/src/docker/orchestrator.ts:510-514`) then bails before the 120 s timeout can elapse.
  - Root cause: `packages/townhouse/compose/townhouse-hs.yml:106` declares `- ~/.townhouse/connector.yaml:/config/connector.yaml:ro` (also lines 155, 160, 275 for `~/.townhouse:/.townhouse`, `mill.config.json`). Docker Compose expands `~` to the invoking user's `$HOME`, NOT to the operator's `--config-dir`. `handleHsUp` calls `writeHsConnectorConfig(configDir, …)` which writes to `<configDir>/connector.yaml` (`src/connector/hs-config-writer.ts:42-107`), but the container always reads `/home/<user>/.townhouse/connector.yaml`. When the two paths diverge (any test using `mkdtempSync`, any operator using `-c /custom/path`), the apex boots against a stale or non-existent config.
  - Why this isn't caught by `townhouse-hs-up.test.ts`: that suite's `beforeAll` happens to run on machines where `~/.townhouse/connector.yaml` was already provisioned with `anon.enabled: true` by a prior real-CLI run, so the container picks up the leftover good config by accident. On a clean machine (CI, fresh dev box, or after `rm ~/.townhouse/connector.yaml`) the test would fail identically.
  - Patch direction: rewrite the four `~/.townhouse/*` bind-mount sources to use a Docker Compose variable that the CLI exports before `docker compose up` (e.g. `${TOWNHOUSE_HOME}/connector.yaml`), and have `handleHsUp` set `process.env['TOWNHOUSE_HOME'] = configDir` alongside the existing `TOWNHOUSE_WALLET_PASSWORD` / `TOWNHOUSE_UID` / `TOWNHOUSE_WALLET_DIR` exports (`packages/townhouse/src/cli.ts:957-966`). Compose interpolation handles the rest. Same fix needed for lines 106, 155, 160, 275. File as a separate PR against `packages/townhouse/`.

**Per-test status (re-run pending both fixes):**

- [Test 1: node add town] BLOCKED — apex never reached healthy state.
- [Test 2: list shows active] BLOCKED — never executed.
- [Test 3: remove] BLOCKED — never executed.
- [Test 4: list shows empty] BLOCKED — never executed.
- [Test 5: re-up idempotency] BLOCKED — never executed.

**Close-out gate (per Task 6.5 + Story Close-Out Checklist):** Findings A and B MUST be patched in separate PRs and this gate MUST re-run with all 5 tests PASS before `46-4-live-e2e-gate-lazy-peer-node-provisioning` flips from `review` to `done`. The story is correctly in `review` status with the test file landed; the close-out checklist's "gate ran green at least once" item is the merge gate against `done`.

**Gate value demonstrated:** both findings are textbook "integration gaps not visible in code review" (Epic 45 retro A4 motivation). Finding A is a cross-repo publish-pipeline regression; Finding B is a Compose-template / CLI-export contract that the unit suite cannot exercise. The story did its job — even with zero PASS rows, the gate caught two operator-visible blockers before any pilot operator hit them.

---

_Code review 2026-05-11 — three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **Acceptance Auditor: fully compliant** with all Task 3 sub-bullets (3.1–3.11), Task 4 sub-bullets (4.1–4.3), Hard Rules (1–5), and Test Strategy Notes. No AC violations. **0 patches required.** 7 items deferred (all are improvements to pre-existing shared helpers or speculative flake hardening, none are introduced by this story). 14 noise items dismissed._

The gate-only discipline of this story limits the actionable surface: by design, the test file may not modify product source, and Task 4.1 mandates inlined helpers (no edits to `_test-helpers.ts`). Most of the defer items below live in `_test-helpers.ts` or in patterns mirrored from `townhouse-hs-up.test.ts`; touching them here would create drift from the template.

- [x] [Review][Defer] `waitForExit` resolves on `'exit'` before stdout pipe `'close'` [packages/townhouse/src/__integration__/_test-helpers.ts:127-139] — verified: helper resolves on the `exit` event, but Node guarantees stdout drain only by `close`. For single-line JSON outputs the race rarely manifests, but a chatty CLI or a heavily loaded runner could produce a truncated `lastLine` and a `JSON.parse('')` failure. Shared helper used by every integration test; fix belongs in a cross-cutting PR.
- [x] [Review][Defer] `cleanupContainersAndVolumes` depends on GNU `xargs -r` [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:84-87] — BSD `xargs` (macOS) lacks `-r`; on empty match the pipe invokes `docker rm -f` with no args and exits non-zero. The `try/catch` swallows it, so cleanup proceeds, but the intent is broken on macOS. Same pattern lives in `townhouse-hs-up.test.ts:54-91` (the Task 4.1 template); fix would be cross-cutting.
- [x] [Review][Defer] Test 5 has no positive proof the idempotent path was taken [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:347-380] — assertions check hostname, volume, and container *names* preserved, but container names are stable even across a cold boot. A regression that silently falls through to cold-boot and completes in ≤30 s would pass this test. Hardening would compare container IDs across the re-up, or assert on a stdout marker like `Apex live at ...` (idempotent fast path) vs cold-boot output.
- [x] [Review][Defer] Poll-loop iteration time vs 30 s budget in test 2 [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:257-279] — each iteration spends `runCli` spawn (~1–3 s on cold Node) + `waitForExit(10s)` + `sleep(2s)`. Under heavy CI load, only 3–5 iterations may fit; if the connector handshake takes longer than expected, the loop exhausts before the connected state is observed. Real flake risk; mitigations include exponential backoff or a longer per-iteration `waitForExit` budget.
- [x] [Review][Defer] `hs up` re-run 30 s budget ignores cold-boot fallback [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:353-359] — the idempotency probe at `cli.ts:879-911` falls through to cold-boot when `hostname === null`. If the connector transiently reports `null` between tests (e.g., anon-network blip), the test SIGKILLs the CLI mid-boot, corrupting state for `afterAll`'s `hs down`. Probability is low (apex was just verified in beforeAll), but no graceful degradation.
- [x] [Review][Defer] `dockerPs` / `volumeExists` `execSync` calls have no timeout [packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts:66-80,243,317,375] — a hung dockerd freezes the test until the outer vitest budget kills the worker, producing a confusing "test exceeded timeout" rather than "docker ps hung". Adding `timeout: 15_000` would improve diagnostic clarity but would drift from the inlined helper pattern in `townhouse-hs-up.test.ts:54-91`. Cross-cutting decision.
- [x] [Review][Defer] `runCli` `stderr` buffer is declared on `RunCliResult` but never populated [packages/townhouse/src/__integration__/_test-helpers.ts:62-118] — `stdio: ['ignore', 'pipe', 'inherit']` means stderr is inherited to the test runner's TTY, but the test's assertion-failure messages (e.g., `\`node add stdout: ${stdout}\``) include only the empty stderr array. On a CLI failure that writes only to stderr, the diagnostic is on the runner's inherited stderr but not attached to the failure. Shared helper issue; cross-cutting PR.

---

_Gate re-run 2026-05-11 (post-PR #50 merge) — Finding B verified fixed end-to-end. Two new issues surfaced: a PR #50 regression in `handleHsDown` (patched via PR #51), a test endpoint bug (patched in this file), and a deeper structural blocker: **rc5 townhouse-api predates Epic 46's `/api/nodes` API**. The gate cannot pass end-to-end until a tarball ships with Epic 46 included (Finding C, below). PR #50 is validated; the 5-test sequence remains BLOCKED until Finding C is resolved by a fresh release._

After PR #50 merged, the apex now boots cleanly against a fresh `mkdtempSync` config dir — the connector reads the test's tmpDir-local `connector.yaml`, the anon HS publishes a hostname, and `townhouse hs up` exits 0 with `Apex live at <hostname>` as expected. Manual gate run confirmed (against connector v3.5.1, local manifest patched per Finding A workaround):

```
Pulling apex image…
Apex live at udhyqzfybfqc6gsoift234tehrbwgwxqvvxwgtezdrc7wlxx3xwkyaid.anon
```

But the vitest gate hit two distinct problems after the apex came up:

- **PR #50 regression in `handleHsDown` (PATCHED via [PR #51](https://github.com/toon-protocol/town/pull/51)).** PR #50 added `${TOWNHOUSE_HOME}` interpolation to three bind-mounts in `compose/townhouse-hs.yml` and exported `TOWNHOUSE_HOME = configDir` in `handleHsUp`. It did NOT export the same var in `handleHsDown`. Result: `townhouse hs down` (and `upHs`'s internal rollback after `waitForHsHostname` timeout) failed with `warning: TOWNHOUSE_HOME is not set` → `invalid spec: :/.townhouse:rw: empty section between colons` → `Apex boot failed. docker compose down failed (exit 1)`. Verified locally: applying the PR #51 patch and manually re-running `townhouse hs down` produces a clean teardown ("Apex stopped. Volumes preserved", all `townhouse-hs-*` containers gone, no warnings). Filed as PR #51 against `main`.

- **Test-file bug: `townhouse-api` does not serve `/health` (PATCHED in this file's working tree).** The Task 3.4 step-7 directive told the dev to call `waitForUrl('http://127.0.0.1:28090/health', { maxMs: 30_000, label: 'townhouse-api /health' })` as a race guard against test 1. The rc5 townhouse-api image returns HTTP 404 on `/health` — the route does not exist (route inventory: `/api/transport`, `/wallet`, `/wallet/balances`, `/wallet/reveal`, etc.; `/nodes` returns 500 EACCES). Polling `/api/nodes` (the spec's natural alternative) also 404s because rc5 predates Epic 46 — see Finding C below. Patched the test to poll `/api/transport` (lightweight read endpoint that DOES exist on rc5) — this is the only known-good route for the race-guard purpose. The full assertion against `/api/nodes` still happens in test 1's `node add town` call, which has its own 180s budget.

- **Finding C (CRITICAL — STRUCTURAL) — rc5 townhouse-api predates Epic 46.** The published `0.1.0-rc5` townhouse-api image (`sha256:48cb3df42201…`, built 2026-05-10T00:04:39Z from `headBranch: v0.1.0-rc5`) does NOT include the `/api/nodes` POST/DELETE/GET routes from Stories 46.2 and 46.3. Those routes landed in commits `94c9e79` (46.2, 2026-05-11) and `0b09571` (46.3, 2026-05-11) — AFTER rc5 was cut. Direct probe of the running rc5 apex confirms:
  - `/api/nodes` → HTTP 404 `{"message":"Route GET:/api/nodes not found"}`
  - `/api/transport` → HTTP 200 (only the pre-Epic-46 routes exist)
  - The gate's test 1 calls `townhouse node add town --json` which the CLI fetches via POST `/api/nodes`. Against rc5, this is a guaranteed 404 → CLI exits 1 → test fails.
  - **The gate cannot pass end-to-end until a tarball ships with Epic 46 included.** That requires either (a) running the publish workflow against a commit on `main` that has Epic 46 merged + bumping the connector pin (the Finding A successor PR), producing rc6 / v0.1.0 GA; or (b) materializing a local townhouse-api image from current source and patching `image-manifest.json` to point at it (operator workaround for local validation, NOT a release).
  - The story's hard-rule #1 ("no product source outside `src/__integration__/`") is satisfied — the gate test file is fine; the test would pass if the tarball had the right product code. This is a release-management blocker, not a product-code blocker on this story.

**Per-test status (re-run pending PR #51 merge AND a tarball release containing Epic 46):**

- [Test 1: node add town] BLOCKED on Finding C — POST /api/nodes returns 404 on rc5.
- [Test 2: list shows active] BLOCKED — depends on test 1.
- [Test 3: remove] BLOCKED — depends on test 1.
- [Test 4: list shows empty] BLOCKED — depends on test 1.
- [Test 5: re-up idempotency] BLOCKED — would currently fail anyway because the test runs after test 1's blocked state, but the underlying idempotency path itself is exercised cleanly by the manual run (`hs up` against an already-running apex returned in <1s with "Apex live at <unchanged-hostname>", volume preserved, no new container creates).

**Updated dependency chain to `done`:**

1. ✓ PR #50 (Finding B, compose template) — MERGED.
2. ⏳ PR #51 (handleHsDown TOWNHOUSE_HOME export) — open, awaiting review.
3. ⏳ Test-file endpoint fix (`/health` → `/api/transport`) — in this branch's working tree, lands with the rest of the Story 46.4 commits.
4. ⏳ Finding A successor (connector pin bump in publish workflow `connector_version: '3.4.1' → '3.5.x'`) — separate PR against the publish workflow.
5. ⏳ Cut rc6 (or v0.1.0 GA) — manual release run of the publish workflow against a `main` SHA that has Epic 46 merged. This is when Finding C is structurally resolved.
6. ⏳ Re-run the gate against the freshly-published tarball (no local manifest workaround). All 5 tests expected PASS.
7. ⏳ Flip 46.4 → `done` with PR #50, PR #51, and the publish-workflow PR cited in Review Findings.

**Gate value re-affirmed.** This run caught a fresh integration bug (PR #50's `handleHsDown` regression) that would have shipped operator-visible. It also surfaced Finding C — the rc5 / Epic 46 release ordering — which is exactly the "integration gap not visible in code review" the Epic 45 retro A4 motivation called out: the unit suite never noticed because it stubs `fetch`; only end-to-end execution against the actual tarball-shipped image surfaces this.

---

_Final gate run 2026-05-12T17:33:24Z — **5/5 PASS** against the rc6 tarball with no local workarounds. Story → `done`._

**Tarball under test:** `0.1.0-rc6` (publish workflow run [25750788502](https://github.com/toon-protocol/town/actions/runs/25750788502)).

**Image manifest (from rc6 artifact):**

| Image | Digest |
|---|---|
| townhouse-api | `sha256:b490df09d163dd88ae6f7d62faa6b0650d4a3a9aa5af7ab21102e82952c17755` |
| town | `sha256:edd8c11c55fef11efd5d5bd530215f2393c79ff646299505592315eaf9ba469f` |
| mill | `sha256:f59cdac83b33def16c33fbb75bd484c1a88c454b50e17ec9eb3bfb764d224c80` |
| dvm | `sha256:90e116b6571b0fa5edead2bd17d15152b16b5a7e6fdf65d35f1ecaac3cb9ceeb` |
| connector (3.6.2) | `sha256:815cef14708fa3e23f605379b19eeb26a478d4bdc52bd786806b55223cda09dd` |

**Per-test PASS:**

- [Test 1: `node add town`] PASS — all 6 pipeline steps complete (derive-key → pull-image → write-yaml → start-container → healthcheck → register-peer). Town container `townhouse-hs-town` healthy; nodes.yaml mode `0o600`; peerId / id / type all `town`; ilpAddress `g.townhouse.town`.
- [Test 2: `node list` shows connected] PASS — connector reported `peer.connected: true` within the 30 s poll window after Finding Q's per-peer direct-transport opt-in landed (PR #56 + connector v3.6.2).
- [Test 3: `node remove <id>`] PASS — container removed in ~8 s; nodes.yaml back to `entries: []`.
- [Test 4: `node list` shows empty] PASS — `{nodes: []}`.
- [Test 5: re-up idempotency] PASS — hostname unchanged via fast-path probe at `cli.ts:879-911` (<3 s); `townhouse-hs-anon` volume preserved (named without project prefix per Finding H); apex containers still running.

**Suite duration:** 82.3 s on a warm-cache local box.

**Findings resolution map (14 total — all closed):**

| Finding | PR / external | Notes |
|---|---|---|
| A — rc5 connector pin too old | #52 | Publish-workflow default bumped 3.4.1 → 3.5.1, then 3.5.1 → 3.6.2 in #56 |
| B — `~/.townhouse` hardcoded bind-mounts | #50 | `${TOWNHOUSE_HOME}` interpolation |
| B.1 — `handleHsDown` env exports | #51 | Mirror handleHsUp pattern |
| C — rc5 predates Epic 46 | #53 | Epic 46 merge to main → rc6 publish ships the new API |
| D — docker.sock EACCES | #54 | `group_add: [${TOWNHOUSE_DOCKER_GID:-0}]` |
| E — docker CLI missing from townhouse-api image | #54 | `apk add docker-cli docker-cli-compose` |
| F — orchestrator constructed without HS profile | #54 | Pass `{profile:'hs', composePath}` in entrypoint |
| G — connector URL via container loopback | #54 | `http://connector:${port}` via Docker DNS |
| H — volume project-prefix | #54 | Explicit `name:` on volumes |
| I — handleHsDown missing wallet-dir / UID / DOCKER_GID exports | #54 | Extend save/restore block |
| J — `${VAR:?}` mandatory-error broke teardown | #54 | Switch to `${VAR:-}` lenient default |
| L — env passthrough into townhouse-api container | #55 | Inner compose-up needs same vars |
| M — networks lack explicit `name:` | #55 | Match volume treatment from H |
| N — town settlement env var name wrong | #55 | Rename to `TOON_SETTLEMENT_PRIVATE_KEY` |
| O — settlement key missing 0x prefix | #55 | Prefix in `buildNodeEnv` |
| Q — connector routes local peers through SOCKS5 | toon-protocol/connector#69 → #70 → v3.6.2 → #56 | Per-peer `transport: 'direct'` field added to connector admin API; Townhouse opts every Docker-sibling peer into direct transport |
| (operational) — DVM arm64 QEMU SIGILL | #57 | Replaced QEMU with native `ubuntu-24.04-arm` runners |

Finding P was investigated and rejected (entrypoint-town.ts already maps the legacy env var names; no defect).

Finding K (transport probe uses container loopback when `transport.mode === 'ator'`) was identified during triage but is dormant — the gate uses direct transport. Recorded as a known follow-up; will need the same Finding-G-style fix when ATOR mode is exercised in HS configuration.

**Epic-level effect:** Epic 46 → `done`. Epic 47 (Earnings Data Plane) unblocks.

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a **dated** entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section. The entry MUST take the form `_Gate run YYYY-MM-DD — ..._` with per-test PASS/FAIL diagnosis.
- [ ] Per the explicit rule in `epics-townhouse-hs-v1.md:802-805`: if the gate found bugs, those bugs MUST have separate PRs merged BEFORE this story flips to `done`. The PR numbers must appear in the Review Findings dated entry.
- [ ] Does this story contain regex or template substitution logic? **No** — pure orchestration test. Skip this checkbox if NA.
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? **Yes** — the entire new test suite is gated by `RUN_DOCKER_INTEGRATION=1` + `!SKIP_DOCKER` (mirror existing convention). This gate must be **lifted and the suite run green** before this story flips to `done`. The Review Findings entry IS the evidence that the gate ran.
- [ ] Verify `packages/townhouse/src/__integration__/townhouse-node-lifecycle-e2e.test.ts` exists and the file lives in the integration suite (not the unit suite — confirm `vitest.integration.config.ts:12` glob includes it: `include: ['src/__integration__/**/*.test.ts']`).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse build` succeeds — the test depends on `dist/cli.js`.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test` (unit suite, no Docker) still green — no regressions from the new integration file.
- [ ] Verify `RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration src/__integration__/townhouse-node-lifecycle-e2e.test.ts` ran green at least once locally OR in CI before flipping the story to `done`.
- [ ] Update sprint-status to `done` (with PR number in trailing comment).
- [ ] If Epic 46 has no remaining backlog stories after this one, the epic comment block at the top of `sprint-status.yaml` should be reviewed before Epic 47 starts (the comment header line 1 explicitly enforces this gate).
