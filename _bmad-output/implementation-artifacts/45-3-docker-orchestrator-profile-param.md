# Story 45.3: DockerOrchestrator Profile Param

Status: done (PR town#44 merged 2026-05-10 with the orchestrator HS profile + getHsHostname admin client + 14 unit tests + 3 integration test stubs; PR town#45 merged 2026-05-10 with 10 round-3 review patches — `.anyone` enforcement, integration-test config fix, `waitForHsHostname` fatal shape errors + lastError capture, `surfaceComposeFailure` regex hyphen fix, `runDockerCompose` stdout capture, AbortError detection in body-read, empty-string `publishedAt` rejection, dead-import cleanup, wallet env-var try/finally; AC #17 satisfied)

> **Critical-path third story of Epic 45 (One-Command Apex Install).** Sized M. Story 45.4 (`townhouse hs up` subcommand) cannot start until this story lands the `profile: 'dev' | 'hs'` parameter on `DockerOrchestrator`, the `getHsHostname()` admin-client method, and the HS-mode startup readiness gate. Story 45.2 already shipped `loadComposeTemplate` / `materializeComposeTemplate` (the YAML resolution layer); this story is what wires that layer into a runnable orchestrator. Independent of Story 44.1 — the `GET /admin/hs-hostname` endpoint already ships in the connector image at the digest pinned by `DEFAULT_CONNECTOR_IMAGE` (connector v3.5.0+).

## Story

As a **townhouse engineer**,
I want **the existing `DockerOrchestrator` to accept a `profile: 'dev' | 'hs'` parameter that selects between the current dockerode-based dev orchestration path and a new compose-subprocess-based HS orchestration path**,
so that **the same orchestration class drives both the contributor dev stack (preserving every existing integration test verbatim) AND the operator HS-mode apex stack (which boots from the digest-pinned `townhouse-hs.yml` template Story 45.2 ships in the npm tarball, waits on the connector's `GET /admin/hs-hostname` for true apex-ready signal, and surfaces per-service failures through the existing `containerState` event interface), without duplicating the lifecycle code or fragmenting Story 45.4's CLI surface across two orchestrator implementations**.

## Acceptance Criteria

1. **`DockerOrchestrator` constructor accepts an `options.profile: 'dev' | 'hs'` parameter (default `'dev'`).** The new fourth constructor parameter is an options object `{ profile?: ComposeProfile, composePath?: string }`. When omitted, `profile` defaults to `'dev'` — this is what preserves backward compatibility with `packages/townhouse/src/cli.ts:506` (`new DockerOrchestrator(docker, config, walletManager)`) and every existing test instantiation. The new signature is `constructor(docker: Docker, config: TownhouseConfig, walletManager?: WalletManager, options?: { profile?: ComposeProfile; composePath?: string })`. Both `profile` and `composePath` are stored as private readonly fields. `composePath` is required when `profile === 'hs'` and ignored when `profile === 'dev'`; the constructor throws `OrchestratorError` immediately if `profile === 'hs'` is passed without `composePath`.

2. **Existing dev-stack tests pass without modification.** Every test under `packages/townhouse/src/docker/orchestrator.test.ts`, `packages/townhouse/src/docker/orchestrator-connector.test.ts`, and `packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts` runs against the refactored orchestrator and passes without test-file edits. The `'dev'` profile preserves the EXACT existing dockerode-based behavior (network creation via `docker.createNetwork`, image pull via `docker.pull`, container creation via `docker.createContainer`, health-poll via `container.inspect`, ator-sidecar startup, all event emissions). Diff `git diff packages/townhouse/src/docker/orchestrator.test.ts packages/townhouse/src/docker/orchestrator-connector.test.ts packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts packages/townhouse/src/__integration__/dev-stack-smoke.test.ts` MUST be empty after this story lands. (If a test must change to accommodate a new event payload field, add the field as additive — never remove or rename existing payload fields.)

3. **`profile: 'hs'` invokes `docker compose -f <composePath> up -d` as a subprocess (NOT dockerode).** When `up()` is called on an `'hs'`-profile orchestrator, the implementation MUST shell out to the `docker` CLI binary (`execFile('docker', ['compose', '-f', composePath, 'up', '-d', ...profileFlags])`) rather than driving lifecycle through dockerode. Two paths intentionally diverge: dev stays on dockerode (proven, granular, matches existing tests); HS uses compose subprocess (uniform with `townhouse-test-infra.sh`, leverages `depends_on` healthcheck ordering, and is what Drew can reproduce manually with `docker compose -f ~/.townhouse/compose/townhouse-hs.yml up`). The orchestrator class is a thin façade — internal branching on `this.profile` selects which path runs.

4. **`profile: 'hs'` emits the correct `--profile` flags per active node set.** When `up()` is invoked with profiles `[]` (apex-only — Story 45.4's default boot) the subprocess invocation is `docker compose -f <composePath> up -d` with NO `--profile` flag (the `connector` and `townhouse-api` services have no `profiles:` declaration so they start unconditionally). When `up(['town'])` is invoked, the invocation is `docker compose -f <composePath> --profile town up -d`. When `up(['town', 'mill'])`, the invocation includes `--profile town --profile mill`. When `up(['town', 'mill', 'dvm'])`, it includes all three. The set of emitted flags is exactly `['--profile', <type>]` repeated per active type, in deterministic order (`town`, `mill`, `dvm`), inserted BEFORE `up -d` (per Docker Compose CLI grammar). Unit tests assert the exact `argv` passed to `execFile` for each profile combination.

5. **`profile: 'hs'` waits for `GET /admin/hs-hostname` to return 200 with `hostname !== null` before considering startup complete.** After `docker compose up -d` exits 0, the orchestrator polls the connector admin endpoint at the resolved admin URL (default `http://127.0.0.1:9401/admin/hs-hostname`) until the response body has `hostname !== null` AND `publishedAt !== null`. Polling cadence: 2-second interval, max 120-second timeout (matches Story 45.4 NFR1 — `.anyone` HS bootstrap is a 30–90s-typical window). On timeout, throws `OrchestratorError` with message `"HS hostname publication timeout after 120000ms"` and the most recent endpoint response shape included in the error. On 503 responses (anon-disabled config — see connector RFC §FR35), the orchestrator throws a distinct `OrchestratorError("connector is anon-disabled — set anon.enabled: true in the connector config")` and does NOT continue polling. On network errors (`ECONNREFUSED`, etc.), retry within the 120s budget. The polled URL is constructed from `this.config.connector.adminPort` (default 9401) — matches the port binding in `townhouse-hs.yml`.

6. **`profile: 'hs'` startup-failure handling surfaces the failed-service name via the existing `containerState` event.** When `docker compose up -d` exits non-zero, the orchestrator parses the subprocess stderr for the conventional Docker Compose failure pattern (`failed to start \"<service>\"` or `service \"<service>\" failed`). For each failed service identified, it emits `containerState` with `{ name: '<service>', state: 'error', detail: '<stderr-snippet>' }` BEFORE throwing the wrapping `OrchestratorError(<service-name>, <subprocess-exit-code>, <stderr-tail>)`. Integration tests assert: (a) the event payload's `name` field matches the failing service name from the compose template (e.g., `'connector'` not `'townhouse-hs-connector'`), (b) at least one `containerState`-state-`error` event is emitted before the error throws. When stderr does not match either pattern, emit a single fallback event `containerState { name: 'compose-up', state: 'error', detail: <stderr> }` so the consumer always sees at least one error event.

7. **`getHsHostname()` is added to `ConnectorAdminClient`.** New method on `packages/townhouse/src/connector/admin-client.ts`:
    ```typescript
    async getHsHostname(): Promise<{ hostname: string | null; publishedAt: string | null }>
    ```
    Calls `GET <baseUrl>/admin/hs-hostname`. On 200 response, validates the body is `{ hostname: string|null, publishedAt: string|null }` (uses the same shape-validation pattern as `getHealth()` lines 50-78); throws on any other shape. On 503 response (anon-disabled), throws a distinct `Error('connector is anon-disabled (HTTP 503)')` so `OrchestratorError` can match on the message and surface the anon-disabled diagnostic per AC #5. The TypeScript type for the response lives in `packages/townhouse/src/connector/types.ts` as `HsHostnameResponse`. The test `packages/townhouse/src/connector/admin-client.test.ts` adds three new cases: hostname-present (200 with non-null fields), hostname-pending (200 with both null), anon-disabled (503).

8. **`profile: 'dev'` ignores `composePath` even if provided.** The `'dev'` path uses dockerode end-to-end — the `composePath` parameter is silently unused (NOT validated, NOT errored) when profile is `'dev'`. This decouples the constructor signature for future Story 45.4 callers that always pass both fields from a generic factory. Unit test asserts: `new DockerOrchestrator(docker, config, undefined, { profile: 'dev', composePath: '/nonexistent/path.yml' })` constructs successfully AND `up([])` runs the dev-path codepath (dockerode `createNetwork`, `pull`, `createContainer`).

9. **`profile: 'hs'` `down()` invokes `docker compose -f <composePath> down`.** Mirroring the up path: HS `down()` shells out to `docker compose -f <composePath> down` (subprocess) instead of the dockerode-based per-container stop loop. The subprocess invocation does NOT include `-v` (volume preservation per Story 45.4 AC — the `townhouse-hs-anon` volume holds the .anyone keypair and must survive `down`). For dev profile, `down()` keeps the existing dockerode behavior verbatim. New unit test asserts the exact argv for HS down: `['compose', '-f', '<composePath>', 'down']` — five elements, no `-v` flag.

10. **Subprocess invocation uses `execFile` (NOT `exec`/`spawn` with shell).** All `docker compose ...` invocations use Node's `child_process.execFile(file, args, options)` (or `execFileSync`/`promisify`-wrapped form) to prevent shell injection from any path containing spaces or shell metacharacters. The `composePath` is passed as a single argument element, never concatenated into a command string. ESLint rule `security/detect-child-process` MUST stay clean (no `// eslint-disable` lines added). Subprocess timeout is 180_000ms (3 min) for `up` (covers image pull on slow connections — matches Story 45.4 NFR1 5-minute budget with margin), 60_000ms for `down`. Subprocess inherits `stdout`/`stderr` for the user (operator sees `docker pull` progress lines from compose), captures stderr into the orchestrator's emitted event detail.

11. **`OrchestratorError` is exported from the docker module.** New `OrchestratorError` class in `packages/townhouse/src/docker/orchestrator.ts` extends `Error`, exported alongside `DockerOrchestrator`. Constructor signature: `constructor(message: string, options?: { service?: string; exitCode?: number; stderr?: string; cause?: Error })`. The optional fields are stored as instance properties for callers (the CLI in Story 45.4 reads these to render Sally's failure-state copy library). Add to the public API surface via `packages/townhouse/src/docker/index.ts` and `packages/townhouse/src/index.ts`.

12. **HS-profile unit tests cover the pure logic without invoking real Docker.** New test file `packages/townhouse/src/docker/orchestrator-hs.test.ts`. The test suite mocks `child_process.execFile` (via `vi.mock('node:child_process')` or by injecting a callable into the constructor — see Task 5.2 for the recommended DI shape) so the assertions exercise only argv composition + readiness-poll branching + error parsing. Required cases (every case must pass):
    - Constructor stores `profile: 'hs'`, `composePath: '/test/compose.yml'`.
    - Constructor throws when `profile: 'hs'` is passed without `composePath`.
    - `up([])` invokes execFile with argv `['compose', '-f', '/test/compose.yml', 'up', '-d']` (no `--profile` flags).
    - `up(['town'])` invokes execFile with argv including `'--profile', 'town'` BEFORE `'up', '-d'`.
    - `up(['town', 'mill', 'dvm'])` orders flags as `town`, `mill`, `dvm` (deterministic).
    - On execFile success, the orchestrator polls `getHsHostname()` until `hostname !== null` (assert via mocked admin-client returning `{hostname: null, publishedAt: null}` twice then `{hostname: 'xyz.anyone', publishedAt: '2026-05-09T00:00:00Z'}`).
    - On 120s timeout with hostname always null, throws `OrchestratorError` with message containing `"timeout"`.
    - On admin-client 503 (anon-disabled), throws `OrchestratorError` with `"anon-disabled"` in the message and STOPS polling (no further admin-client calls).
    - On execFile non-zero exit with stderr containing `failed to start "connector"`, emits `containerState { name: 'connector', state: 'error' }` BEFORE throwing.
    - On execFile non-zero exit with unparseable stderr, emits a single `containerState { name: 'compose-up', state: 'error' }` fallback event.
    - `down()` invokes execFile with argv `['compose', '-f', '/test/compose.yml', 'down']` (no `-v`).

13. **HS-profile integration test boots the real apex via the published compose template.** New test file `packages/townhouse/src/__integration__/orchestrator-hs.test.ts` (gated on `RUN_DOCKER_INTEGRATION === '1'` AND `SKIP_DOCKER !== '1'` — same gates as `townhouse-cli-lifecycle.test.ts:36-47`). Test cases:
    - Materialize the HS compose template via `materializeComposeTemplate('hs', { townhouseHome: <tmpdir> })` — this returns a `composePath` pointing at the rendered YAML containing the digest-pinned connector image.
    - Construct `new DockerOrchestrator(docker, config, walletManager, { profile: 'hs', composePath })`.
    - Call `up([])` (apex-only — connector + townhouse-api start).
    - Assert the call resolves successfully within 180_000ms.
    - Assert `getHsHostname()` returns `hostname: string` (non-null) — i.e., the `.anyone` address.
    - Assert `docker ps --filter name=townhouse-hs-` shows exactly two containers: `townhouse-hs-connector` AND `townhouse-hs-api`. NO `townhouse-hs-town`, `townhouse-hs-mill`, `townhouse-hs-dvm`.
    - Call `down()`. Assert all `townhouse-hs-*` containers are gone. Assert the named volume `townhouse-hs-anon` STILL EXISTS (`docker volume ls | grep townhouse-hs-anon` matches one line).
    - Cleanup: `docker compose -f <composePath> down -v` to remove volumes between test runs.

14. **CLI's existing `handleUp` call site is updated to pass `{ profile: 'dev' }` explicitly.** `packages/townhouse/src/cli.ts:506` currently reads `const orchestrator = new DockerOrchestrator(docker, config, walletManager);`. Update to `const orchestrator = new DockerOrchestrator(docker, config, walletManager, { profile: 'dev' });`. Same surgical update at `cli.ts:336` (`status` handler) and `cli.ts:672` (`down` handler) — both call sites get `{ profile: 'dev' }`. This is a no-op behavioral change (default is already `'dev'`) but it makes the call sites self-documenting and ready for Story 45.4 to add `{ profile: 'hs', composePath }` callers without ambiguity. Smoke-verified by running `pnpm --filter @toon-protocol/townhouse test:integration -- townhouse-cli-lifecycle` after the edit (existing CLI lifecycle test must stay green).

15. **No changes to `packages/townhouse/src/cli.ts` beyond the three call-site updates in AC #14.** The `townhouse hs up` subcommand registration, the `materializeComposeTemplate('hs')` invocation site, the wallet-password prompt logic, the apex-ready stdout messaging — all of those are Story 45.4 territory. This story exposes the orchestrator API; Story 45.4 wires it to a CLI subcommand. Scope-guard: if the dev finds themselves adding `case 'hs':` to the parseArgs subcommand switch, stop — that is outside scope.

16. **Backward compatibility for the connector's anon-config requirement is documented.** The HS profile readiness gate (`getHsHostname()` returns non-null) silently fails-fast when the connector image's config has `anon.enabled: false`. Document this in (a) `packages/townhouse/README.md` § "HS Profile Orchestrator" — explain the connector config must enable `anon` for HS profile, AND (b) the `OrchestratorError` thrown on 503 has an actionable error message naming the exact config key. The dev does NOT need to write a connector-side config-mutation script — Story 45.4's `townhouse hs up` will generate the connector config. This story's scope is only the error-surfacing.

17. **Sprint-status update.** AFTER PR merges AND `pnpm --filter @toon-protocol/townhouse test`, `test:integration`, AND `test:canary` are all green: update `_bmad-output/implementation-artifacts/sprint-status.yaml` `45-3-docker-orchestrator-profile-param: backlog → done` (mirror Story 45.2 close-out style — `# done: PR town#<num> merged; orchestrator HS profile + getHsHostname admin client landed`). Bump `last_updated`. The `45-4` story unblocks immediately on this merge.

## Tasks / Subtasks

- [x] **Task 1: Cross-read prior art + Story 45.2 outputs** (AC: #1, #2, #3, #11)
  - [x] 1.1 Re-read `_bmad-output/implementation-artifacts/45-2-embed-compose-templates-and-image-manifest-in-npm-tarball.md` "Dev Notes → What This Story Does NOT Do" to confirm the boundary: 45.2 ships the loader API + compose templates + manifest; 45.3 wires them into the orchestrator. The R1-Patch list line "extended pullImages cache check from RepoTags to RepoDigests" is the only orchestrator change Story 45.2 made — everything else in `orchestrator.ts` is your blank canvas.
  - [x] 1.2 Read `packages/townhouse/src/compose-loader.ts` end-to-end (~220 lines). Confirm the public API: `loadComposeTemplate(profile, options?): string`, `materializeComposeTemplate(profile, options?): { composePath, manifestPath }`, `ComposeLoaderError` class, `ComposeProfile` type alias `'dev' | 'hs'`. Story 45.3's HS path consumes the `composePath` returned by `materializeComposeTemplate`; the orchestrator never re-implements YAML parsing or file writing — it receives `composePath` from its constructor caller (Story 45.4 or tests).
  - [x] 1.3 Read `packages/townhouse/src/docker/orchestrator.ts` end-to-end (~900 lines). Pay attention to: `up(profiles: NodeType[])` (line 113) — the existing entry point that the HS branch will fork from; `pullImages` (line 465) — already digest-aware via Story 45.2 R1 patch (matches both `RepoTags` and `RepoDigests`); `startConnector` (line 604) — the dockerode-based connector creation path that the dev profile keeps verbatim; `down` (line 204) — the dockerode-based teardown that dev keeps verbatim. The HS branch is a parallel path, NOT a refactor of the existing code — leave the dockerode path untouched.
  - [x] 1.4 Read `packages/townhouse/src/connector/admin-client.ts` (~300 lines). The existing `getHealth()` (lines 50-78) is the canonical pattern: validate response shape inline with explicit `typeof` + property checks, throw on bad shape, return typed result. `getHsHostname()` mirrors this pattern exactly. Don't pull in zod for runtime validation — the existing pattern is consistent across all admin-client methods.
  - [x] 1.5 Read `packages/townhouse/src/connector/types.ts` to find where `HealthResponse`, `PeersResponse`, etc. are declared. Add `HsHostnameResponse` to the same file (mirror the `HealthResponse` declaration style). The shape is `{ hostname: string | null; publishedAt: string | null }` per planning doc §FR35.
  - [x] 1.6 Read `packages/townhouse/src/cli.ts:506` (the `handleUp` orchestrator construction site) AND `cli.ts:336` (status handler) AND `cli.ts:672` (down handler). These are the three call sites Task 6 updates. Confirm none of them currently pass a 4th constructor argument — the new option object is purely additive.
  - [x] 1.7 Read `packages/townhouse/compose/townhouse-hs.yml` end-to-end to memorize the service set (`connector`, `townhouse-api` always-on; `town`, `mill`, `dvm` profile-gated). The orchestrator's HS path emits `--profile <type>` for each enabled type in the input array — the always-on services come up regardless. AC #4's argv assertions MUST match this template's profile declarations.

- [x] **Task 2: Add `getHsHostname()` to `ConnectorAdminClient`** (AC: #5, #7)
  - [x] 2.1 Open `packages/townhouse/src/connector/types.ts`. Add the response type:
    ```typescript
    export interface HsHostnameResponse {
      hostname: string | null;
      publishedAt: string | null;
    }
    ```
    Add the type to the file's barrel-export list (search for `export type` near the top — keep alphabetical or insertion order consistent with the existing pattern).
  - [x] 2.2 Open `packages/townhouse/src/connector/admin-client.ts`. Import the new `HsHostnameResponse` type from `./types.js`. Add the method below `getHealth()` (preserve the docblock style — see lines 47-49 for the canonical comment format):
    ```typescript
    /**
     * GET /admin/hs-hostname — returns the connector's published .anyone hidden-service
     * hostname (Epic 45 / Story 44.1). Returns 200 with {hostname, publishedAt} both
     * possibly null while bootstrap is in progress, both non-null once anon publishes.
     * Returns 503 when the connector is anon-disabled (anon.enabled: false in config).
     *
     * @throws Error('connector is anon-disabled (HTTP 503)') on 503 — caller can match
     *   on this exact prefix for actionable diagnostics.
     * @throws Error on non-200/503 status, network error, or shape-validation failure.
     */
    async getHsHostname(): Promise<HsHostnameResponse> {
      const response = await this.fetch('/admin/hs-hostname');
      if (response.status === 503) {
        throw new Error('connector is anon-disabled (HTTP 503)');
      }
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) {
        throw new Error('Connector admin API: invalid hs-hostname response shape');
      }
      const obj = body as Record<string, unknown>;
      const hostname = obj['hostname'];
      const publishedAt = obj['publishedAt'];
      if (
        (hostname !== null && typeof hostname !== 'string') ||
        (publishedAt !== null && typeof publishedAt !== 'string')
      ) {
        throw new Error('Connector admin API: invalid hs-hostname response shape');
      }
      return body as HsHostnameResponse;
    }
    ```
  - [x] 2.3 The existing `fetch()` private method (search for `private async fetch`) handles non-200 by throwing — for 503 we MUST intercept BEFORE the throw. Either (a) add a special-case 503 path in `fetch()` that returns the response without throwing, OR (b) duplicate the minimal fetch logic for `getHsHostname()` to handle the 503 case inline. **Recommended:** Use option (b) — call `globalThis.fetch(this.baseUrl + '/admin/hs-hostname', { signal })` directly in `getHsHostname()` to avoid coupling other endpoints to the 503-tolerant pathway. This costs ~15 LOC duplication but keeps `fetch()` semantics simple for the other 5+ admin endpoints.
  - [x] 2.4 Open `packages/townhouse/src/connector/admin-client.test.ts` (existing test file — do NOT create a new one). Add three test cases below the existing `getHealth` block. Use the existing test scaffolding pattern (mocked `globalThis.fetch` via `vi.spyOn(globalThis, 'fetch')` — search for `spyOn(globalThis, 'fetch')` to find the precedent). Required cases:
    - `getHsHostname()` returns `{hostname: 'abc123.anyone', publishedAt: '2026-05-09T00:00:00Z'}` when fetch resolves with 200 + that body.
    - `getHsHostname()` returns `{hostname: null, publishedAt: null}` (bootstrap-pending) when fetch resolves with 200 + nulls.
    - `getHsHostname()` throws `Error` whose message contains `'anon-disabled'` when fetch resolves with status 503.
    - `getHsHostname()` throws on shape-violating responses (e.g., `{hostname: 42}`, `{hostname: 'x', publishedAt: 99}`).
  - [x] 2.5 Run `pnpm --filter @toon-protocol/townhouse test admin-client` — all four new cases pass; existing cases stay green.

- [x] **Task 3: Author `OrchestratorError` class + module export** (AC: #11)
  - [x] 3.1 Add to the top of `packages/townhouse/src/docker/orchestrator.ts` (after the existing imports, before the `normalizeImageTag` helper at line 68):
    ```typescript
    /**
     * Error type thrown by DockerOrchestrator HS-path failures (Story 45.3).
     * Carries the failed-service name + subprocess diagnostics so CLI consumers
     * (Story 45.4) can render Sally's failure-state copy library (UX-DR5).
     */
    export class OrchestratorError extends Error {
      readonly service?: string;
      readonly exitCode?: number;
      readonly stderr?: string;
      constructor(
        message: string,
        options: {
          service?: string;
          exitCode?: number;
          stderr?: string;
          cause?: Error;
        } = {}
      ) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'OrchestratorError';
        if (options.service !== undefined) this.service = options.service;
        if (options.exitCode !== undefined) this.exitCode = options.exitCode;
        if (options.stderr !== undefined) this.stderr = options.stderr;
      }
    }
    ```
  - [x] 3.2 Add to `packages/townhouse/src/docker/index.ts`:
    ```typescript
    export { DockerOrchestrator, OrchestratorError } from './orchestrator.js';
    ```
  - [x] 3.3 Add to `packages/townhouse/src/index.ts` (after the existing `export { DockerOrchestrator }` line):
    ```typescript
    export { DockerOrchestrator, OrchestratorError } from './docker/index.js';
    ```
    (Replace the single-name re-export with the two-name form; do NOT add a duplicate line.)

- [x] **Task 4: Refactor `DockerOrchestrator` constructor + add HS-path branches** (AC: #1, #3, #4, #6, #8, #9, #10)
  - [x] 4.1 Update the class type definition in `packages/townhouse/src/docker/orchestrator.ts`:
    ```typescript
    import type { ComposeProfile } from '../compose-loader.js';
    import { execFile } from 'node:child_process';
    import { promisify } from 'node:util';

    const execFileAsync = promisify(execFile);
    ```
    Add the two new private fields to the class:
    ```typescript
    private readonly profile: ComposeProfile;
    private readonly composePath: string | undefined;
    ```
  - [x] 4.2 Update the constructor signature (replace lines 94-104):
    ```typescript
    constructor(
      docker: Docker,
      config: TownhouseConfig,
      walletManager?: WalletManager,
      options: { profile?: ComposeProfile; composePath?: string } = {}
    ) {
      super();
      this.docker = docker;
      this.config = config;
      this.configGenerator = new ConnectorConfigGenerator(config);
      this.walletManager = walletManager;
      this.profile = options.profile ?? 'dev';
      this.composePath = options.composePath;

      if (this.profile === 'hs' && !this.composePath) {
        throw new OrchestratorError(
          `profile: 'hs' requires a composePath. Pass options.composePath ` +
            `pointing at the rendered HS template (typically the composePath ` +
            `returned by materializeComposeTemplate('hs')).`
        );
      }
    }
    ```
  - [x] 4.3 Update `up(profiles: NodeType[])` to branch on profile (replace existing line 113):
    ```typescript
    async up(profiles: NodeType[]): Promise<void> {
      this.activeNodes = [...profiles];
      if (this.profile === 'hs') {
        await this.upHs(profiles);
      } else {
        await this.upDev(profiles);
      }
    }

    private async upDev(profiles: NodeType[]): Promise<void> {
      // ── Existing dockerode-based startup sequence (verbatim from pre-Story-45.3) ──
      await this.ensureNetwork();
      await this.pullImages(profiles);
      await this.startConnector();
      await this.waitForHealth('townhouse-connector');
      await Promise.all(profiles.map((type) => this.startNode(type)));
      if (profiles.includes('town') && this.config.transport.relayHiddenService) {
        await this.startRelayAtorSidecar();
      }
    }
    ```
    Move the existing five lines from the old `up()` body into `upDev()` unchanged (preserves AC #2 backward-compat).
  - [x] 4.4 Add `upHs(profiles: NodeType[])` private method:
    ```typescript
    /** HS-mode startup: shell out to `docker compose up -d`, wait for HS hostname. */
    private async upHs(profiles: NodeType[]): Promise<void> {
      const composePath = this.composePath!; // guaranteed non-null by constructor check
      const args = ['compose', '-f', composePath];
      // Profile flags MUST come BEFORE the subcommand per Docker Compose CLI grammar.
      // Deterministic order: town → mill → dvm (matches AC #4).
      const PROFILE_ORDER: NodeType[] = ['town', 'mill', 'dvm'];
      for (const type of PROFILE_ORDER) {
        if (profiles.includes(type)) {
          args.push('--profile', type);
        }
      }
      args.push('up', '-d');

      try {
        await execFileAsync('docker', args, {
          timeout: 180_000,
          maxBuffer: 16 * 1024 * 1024, // 16 MB — large enough for image-pull progress
        });
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException & {
          stderr?: string;
          stdout?: string;
          code?: number | string;
        };
        const stderr = String(e.stderr ?? '');
        const exitCode = typeof e.code === 'number' ? e.code : -1;
        this.surfaceComposeFailure(stderr);
        throw new OrchestratorError(
          `docker compose up failed (exit ${exitCode}): ${stderr.trim().slice(0, 500)}`,
          { exitCode, stderr, cause: err instanceof Error ? err : undefined }
        );
      }

      // Readiness gate: poll /admin/hs-hostname until hostname !== null.
      await this.waitForHsHostname();
    }
    ```
  - [x] 4.5 Add `surfaceComposeFailure(stderr: string)` private method:
    ```typescript
    /**
     * Parse Docker Compose stderr for the failed-service name and emit a
     * containerState event so callers see the failure via the same channel
     * dev-mode uses (AC #6). When stderr does not match either Compose
     * failure pattern, emit a single fallback event so the consumer always
     * sees at least one error event.
     */
    private surfaceComposeFailure(stderr: string): void {
      // Compose v2 patterns (varies by version):
      //   "Error response from daemon: failed to start service \"connector\""
      //   "service \"connector\" failed to start"
      //   "Container townhouse-hs-connector  Error"
      const patterns = [
        /failed to start (?:service\s+)?["']([^"']+)["']/i,
        /service\s+["']([^"']+)["']\s+failed/i,
        /Container\s+townhouse-hs-(\w+)\s+Error/i,
      ];
      let emitted = false;
      for (const pattern of patterns) {
        const match = stderr.match(pattern);
        if (match?.[1]) {
          this.emit('containerState', {
            name: match[1],
            state: 'error',
            detail: stderr.trim().slice(0, 500),
          });
          emitted = true;
          break;
        }
      }
      if (!emitted) {
        this.emit('containerState', {
          name: 'compose-up',
          state: 'error',
          detail: stderr.trim().slice(0, 500),
        });
      }
    }
    ```
  - [x] 4.6 Add `waitForHsHostname()` private method (AC #5):
    ```typescript
    private async waitForHsHostname(): Promise<void> {
      const adminUrl = `http://127.0.0.1:${this.config.connector.adminPort}`;
      const client = new ConnectorAdminClient(adminUrl, 5_000);
      const deadline = Date.now() + 120_000;
      const pollInterval = 2_000;
      let lastResponse: { hostname: string | null; publishedAt: string | null } | undefined;
      while (Date.now() < deadline) {
        try {
          lastResponse = await client.getHsHostname();
          if (lastResponse.hostname !== null && lastResponse.publishedAt !== null) {
            return;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // 503 anon-disabled is fatal — do NOT keep polling.
          if (msg.includes('anon-disabled')) {
            throw new OrchestratorError(
              `connector is anon-disabled — set anon.enabled: true in the connector config`,
              { cause: err instanceof Error ? err : undefined }
            );
          }
          // Network errors (ECONNREFUSED, etc.) — retry within budget.
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      throw new OrchestratorError(
        `HS hostname publication timeout after 120000ms` +
          (lastResponse
            ? ` (last response: ${JSON.stringify(lastResponse)})`
            : ' (no successful response received)')
      );
    }
    ```
    Add the import: `import { ConnectorAdminClient } from '../connector/admin-client.js';` near the top of the file.
  - [x] 4.7 Update `down()` to branch on profile (replace existing line 204):
    ```typescript
    async down(): Promise<void> {
      if (this.profile === 'hs') {
        await this.downHs();
      } else {
        await this.downDev();
      }
    }

    private async downDev(): Promise<void> {
      // ── Existing dockerode-based teardown (verbatim from pre-Story-45.3) ──
      const containers = await this.docker.listContainers({ all: true });
      // ... the existing 30-line body moves here unchanged ...
    }

    private async downHs(): Promise<void> {
      const composePath = this.composePath!;
      const args = ['compose', '-f', composePath, 'down'];
      // NO -v flag — preserves the townhouse-hs-anon volume so the .anyone
      // address survives `down` (Story 45.4 AC).
      try {
        await execFileAsync('docker', args, { timeout: 60_000 });
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException & { stderr?: string; code?: number | string };
        throw new OrchestratorError(
          `docker compose down failed: ${String(e.stderr ?? '').trim().slice(0, 500)}`,
          {
            exitCode: typeof e.code === 'number' ? e.code : -1,
            stderr: String(e.stderr ?? ''),
            cause: err instanceof Error ? err : undefined,
          }
        );
      }
    }
    ```
    Move the existing `down()` body into `downDev()` unchanged.

- [x] **Task 5: Inject `execFile` for testability** (AC: #12)
  - [x] 5.1 The Task 4.4 implementation calls `execFileAsync` (the module-level import). For unit testing, inject the function via constructor options to avoid `vi.mock('node:child_process')` (which has hoisting + ESM-load-order pitfalls). Update the constructor options type:
    ```typescript
    options: {
      profile?: ComposeProfile;
      composePath?: string;
      execFileAsync?: typeof execFileAsync;
    } = {}
    ```
    Store as a private field:
    ```typescript
    private readonly execFileAsync: typeof execFileAsync;
    // in constructor:
    this.execFileAsync = options.execFileAsync ?? execFileAsync;
    ```
    Replace the two `await execFileAsync(...)` calls in `upHs` and `downHs` with `await this.execFileAsync(...)`.
  - [x] 5.2 Same DI shape for the admin client: the readiness poll constructs `new ConnectorAdminClient(adminUrl, 5_000)` inline (Task 4.6). For unit tests, inject the admin-client factory:
    ```typescript
    options: {
      // ... above fields ...
      adminClientFactory?: (baseUrl: string, timeoutMs: number) => ConnectorAdminClient;
    } = {}
    ```
    Store + use:
    ```typescript
    private readonly adminClientFactory: (baseUrl: string, timeoutMs: number) => ConnectorAdminClient;
    // in constructor:
    this.adminClientFactory = options.adminClientFactory ?? ((url, t) => new ConnectorAdminClient(url, t));
    // in waitForHsHostname:
    const client = this.adminClientFactory(adminUrl, 5_000);
    ```
    These two DI hooks let `orchestrator-hs.test.ts` exercise the entire HS path with no Docker daemon, no real HTTP, no mocked module imports.
  - [x] 5.3 Default behavior MUST be unchanged when neither override is passed. Existing tests pass arbitrary positional args (`new DockerOrchestrator(docker, config)`, `new DockerOrchestrator(docker, config, walletManager)`) — the new options-object 4th arg defaults to `{}` which leaves all fields at their production defaults. Run `pnpm --filter @toon-protocol/townhouse test orchestrator` after the constructor refactor to confirm no regression.

- [x] **Task 6: Update CLI orchestrator construction sites** (AC: #14)
  - [x] 6.1 Open `packages/townhouse/src/cli.ts`. At line 506 (inside `handleUp`), change:
    ```typescript
    const orchestrator = new DockerOrchestrator(docker, config, walletManager);
    ```
    to:
    ```typescript
    const orchestrator = new DockerOrchestrator(docker, config, walletManager, {
      profile: 'dev',
    });
    ```
  - [x] 6.2 At cli.ts:336 (inside the status handler), change:
    ```typescript
    const orchestrator = new DockerOrchestrator(docker, config);
    ```
    to:
    ```typescript
    const orchestrator = new DockerOrchestrator(docker, config, undefined, {
      profile: 'dev',
    });
    ```
  - [x] 6.3 At cli.ts:672 (inside the down handler), apply the same edit pattern as 6.2.
  - [x] 6.4 Run `pnpm --filter @toon-protocol/townhouse test:integration -- townhouse-cli-lifecycle` to verify the CLI lifecycle test stays green. Do NOT modify the test file.
  - [x] 6.5 NO new CLI subcommand registrations. NO `case 'hs':` branches in `parseArgs`. The hs subcommand is Story 45.4.

- [x] **Task 7: Author HS-path unit tests** (AC: #12)
  - [x] 7.1 Create `packages/townhouse/src/docker/orchestrator-hs.test.ts`. Use vitest. Use the constructor's DI hooks (Task 5) instead of `vi.mock`. Required imports:
    ```typescript
    import { describe, it, expect, vi, beforeEach } from 'vitest';
    import { DockerOrchestrator, OrchestratorError } from './orchestrator.js';
    import type { TownhouseConfig } from '../config/schema.js';
    ```
  - [x] 7.2 Write a `makeConfig()` factory that returns a minimal `TownhouseConfig` for tests:
    ```typescript
    function makeConfig(): TownhouseConfig {
      return {
        connector: {
          image: 'ghcr.io/toon-protocol/connector@sha256:abc',
          adminPort: 9401,
          // ... fill in remaining required fields per the schema ...
        },
        // ... nodes, transport, wallet ...
      } as TownhouseConfig;
    }
    ```
    Reference `packages/townhouse/src/docker/orchestrator.test.ts` lines 1-60 for the exact factory the existing test suite uses — copy verbatim.
  - [x] 7.3 Implement the cases listed in AC #12. Pattern for argv assertion:
    ```typescript
    it('up([]) emits no profile flags', async () => {
      const calls: Array<{ file: string; args: string[] }> = [];
      const fakeExec: typeof import('node:util').promisify extends infer P
        ? Awaited<ReturnType<typeof import('node:util').promisify>>
        : never = (file, args) => {
        calls.push({ file: file as string, args: args as string[] });
        return Promise.resolve({ stdout: '', stderr: '' });
      };
      const fakeAdminFactory = () =>
        ({
          getHsHostname: vi
            .fn()
            .mockResolvedValue({ hostname: 'test.anyone', publishedAt: '2026-05-09T00:00:00Z' }),
        }) as unknown as ConnectorAdminClient;
      const docker = {} as Docker;
      const orch = new DockerOrchestrator(docker, makeConfig(), undefined, {
        profile: 'hs',
        composePath: '/test/compose.yml',
        execFileAsync: fakeExec as never,
        adminClientFactory: fakeAdminFactory as never,
      });
      await orch.up([]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.file).toBe('docker');
      expect(calls[0]!.args).toEqual([
        'compose', '-f', '/test/compose.yml', 'up', '-d'
      ]);
    });
    ```
  - [x] 7.4 The readiness-poll timeout test uses `vi.useFakeTimers()` to advance through 60 polling intervals without real-time wait:
    ```typescript
    it('throws OrchestratorError on hostname-publication timeout', async () => {
      vi.useFakeTimers();
      const fakeExec: typeof execFileAsync = () =>
        Promise.resolve({ stdout: '', stderr: '' });
      const fakeAdminFactory = () =>
        ({
          getHsHostname: vi
            .fn()
            .mockResolvedValue({ hostname: null, publishedAt: null }),
        }) as unknown as ConnectorAdminClient;
      const orch = new DockerOrchestrator(/* ... */ {
        profile: 'hs',
        composePath: '/test/c.yml',
        execFileAsync: fakeExec,
        adminClientFactory: fakeAdminFactory,
      });
      const promise = orch.up([]);
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(promise).rejects.toThrow(OrchestratorError);
      await expect(promise).rejects.toThrow(/timeout/);
      vi.useRealTimers();
    });
    ```
    Be careful with `vi.useFakeTimers()` interacting with `Date.now()` inside `waitForHsHostname` — `vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })` ensures both clocks tick together.
  - [x] 7.5 The error-surfacing test asserts the event-emission order:
    ```typescript
    it('emits containerState before throwing on compose up failure', async () => {
      const fakeExec: typeof execFileAsync = () => {
        const e = new Error('Process exited with code 1') as NodeJS.ErrnoException & {
          stderr?: string; code?: number;
        };
        e.stderr = 'failed to start "connector": container exited 1';
        e.code = 1;
        return Promise.reject(e);
      };
      const orch = new DockerOrchestrator(/* ... */ { profile: 'hs', composePath: '/x.yml', execFileAsync: fakeExec });
      const events: Array<{ name: string; state: string }> = [];
      orch.on('containerState', (e) => events.push(e));
      await expect(orch.up([])).rejects.toThrow(OrchestratorError);
      expect(events).toContainEqual(expect.objectContaining({ name: 'connector', state: 'error' }));
    });
    ```
  - [x] 7.6 The 503 anon-disabled test asserts polling stops:
    ```typescript
    it('stops polling on anon-disabled (503) and throws actionable error', async () => {
      const callCount = { count: 0 };
      const fakeAdminFactory = () =>
        ({
          getHsHostname: vi.fn().mockImplementation(() => {
            callCount.count++;
            return Promise.reject(new Error('connector is anon-disabled (HTTP 503)'));
          }),
        }) as unknown as ConnectorAdminClient;
      const orch = new DockerOrchestrator(/* ... */ {
        profile: 'hs',
        composePath: '/x.yml',
        execFileAsync: () => Promise.resolve({ stdout: '', stderr: '' }) as never,
        adminClientFactory: fakeAdminFactory,
      });
      await expect(orch.up([])).rejects.toThrow(/anon-disabled/);
      expect(callCount.count).toBe(1); // exactly one call, no retry on 503
    });
    ```
  - [x] 7.7 Run `pnpm --filter @toon-protocol/townhouse test orchestrator-hs` — all cases pass. Run `pnpm --filter @toon-protocol/townhouse test orchestrator` (the existing dev tests) — all pass without modification (AC #2).

- [x] **Task 8: Author HS-path integration test** (AC: #13)
  - [x] 8.1 Create `packages/townhouse/src/__integration__/orchestrator-hs.test.ts`. Imports + skip-gate scaffolding mirror `townhouse-cli-lifecycle.test.ts:21-47`:
    ```typescript
    import { describe, it, expect, beforeAll, afterAll } from 'vitest';
    import { execSync } from 'node:child_process';
    import { mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import Docker from 'dockerode';
    import { DockerOrchestrator } from '../docker/orchestrator.js';
    import { materializeComposeTemplate } from '../compose-loader.js';
    import { ConnectorAdminClient } from '../connector/admin-client.js';
    import { isTruthyEnv } from './_test-helpers.js';

    const SKIP_DOCKER = isTruthyEnv(process.env['SKIP_DOCKER']);
    const RUN_INTEGRATION = process.env['RUN_DOCKER_INTEGRATION'] === '1';
    const shouldRun = RUN_INTEGRATION && !SKIP_DOCKER;
    ```
  - [x] 8.2 Setup uses `materializeComposeTemplate('hs', { townhouseHome: <tmpdir> })` — this produces the `composePath` AND requires `dist/image-manifest.json` to be present (Story 45.2 invariant). The test must run AFTER `pnpm --filter @toon-protocol/townhouse build` AND with `dist/image-manifest.json` placed in `dist/` (the publish workflow does this; locally `gh run download <latest-publish-run> --name image-manifest -D packages/townhouse/dist/`).
  - [x] 8.3 The body asserts:
    ```typescript
    describe.skipIf(!shouldRun)('HS profile orchestrator boots apex-only stack', () => {
      let tmpDir: string;
      let composePath: string;
      let orch: DockerOrchestrator;

      beforeAll(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'townhouse-hs-orch-'));
        ({ composePath } = materializeComposeTemplate('hs', { townhouseHome: tmpDir }));
        // Set TOWNHOUSE_WALLET_PASSWORD before docker compose up — the HS template
        // uses ${TOWNHOUSE_WALLET_PASSWORD:?} which fails compose up if unset.
        process.env['TOWNHOUSE_WALLET_PASSWORD'] = 'integration-test-pwd';
        const docker = new Docker();
        orch = new DockerOrchestrator(docker, /* makeConfig */ {} as never, undefined, {
          profile: 'hs',
          composePath,
        });
        await orch.up([]); // apex-only
      }, 240_000); // generous — image pull on cold cache

      afterAll(async () => {
        try { await orch.down(); } catch { /* best-effort */ }
        // Wipe the named volume so subsequent runs get a fresh .anyone address.
        try {
          execSync(`docker compose -f "${composePath}" down -v`, { timeout: 30_000 });
        } catch { /* best-effort */ }
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env['TOWNHOUSE_WALLET_PASSWORD'];
      }, 60_000);

      it('exactly two containers running: connector + townhouse-api', () => {
        const out = execSync('docker ps --filter name=townhouse-hs- --format "{{.Names}}"', {
          encoding: 'utf-8',
        });
        const names = out.trim().split('\n').filter(Boolean).sort();
        expect(names).toEqual(['townhouse-hs-api', 'townhouse-hs-connector']);
      }, 10_000);

      it('getHsHostname() returns a non-null .anyone address', async () => {
        const client = new ConnectorAdminClient('http://127.0.0.1:9401', 5_000);
        const result = await client.getHsHostname();
        expect(result.hostname).toMatch(/\.anyone$/);
        expect(result.publishedAt).toBeTruthy();
      }, 10_000);

      it('down() stops containers but preserves townhouse-hs-anon volume', async () => {
        await orch.down();
        const containers = execSync('docker ps -a --filter name=townhouse-hs- --format "{{.Names}}"', {
          encoding: 'utf-8',
        });
        expect(containers.trim()).toBe('');
        const volumes = execSync('docker volume ls --filter name=townhouse-hs-anon --format "{{.Name}}"', {
          encoding: 'utf-8',
        });
        expect(volumes.trim()).toBe('townhouse-hs-anon');
      }, 60_000);
    });
    ```
  - [x] 8.4 Run `RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- orchestrator-hs` to verify against a local Docker daemon. First run will pull the connector + townhouse-api images (~2-3 min); subsequent runs are fast.

- [x] **Task 9: Documentation updates** (AC: #16)
  - [x] 9.1 Update `packages/townhouse/README.md`. Add a new section near the existing "Compose Templates" section (added by Story 45.2):
    ```markdown
    ## DockerOrchestrator Profiles

    The `DockerOrchestrator` class drives both the contributor dev stack and
    the operator HS-mode apex stack via a single `profile: 'dev' | 'hs'`
    parameter:

    - **`profile: 'dev'`** (default) — uses `dockerode` for fine-grained
      programmatic control. Matches the lifecycle the existing `townhouse up`
      CLI has shipped since Epic 21. No `composePath` required.
    - **`profile: 'hs'`** — shells out to `docker compose -f <composePath> up -d`
      with `--profile <type>` flags for each enabled peer. Waits on the
      connector's `GET /admin/hs-hostname` endpoint (connector v3.5.0+) until
      the `.anyone` hostname is published. Requires `composePath` (typically
      the path returned by `materializeComposeTemplate('hs')`).

    Example (HS-mode caller, as Story 45.4's `townhouse hs up` will use):
    \`\`\`typescript
    import { materializeComposeTemplate } from '@toon-protocol/townhouse';
    import { DockerOrchestrator } from '@toon-protocol/townhouse';
    import Docker from 'dockerode';

    const { composePath } = materializeComposeTemplate('hs');
    const orch = new DockerOrchestrator(docker, config, walletManager, {
      profile: 'hs',
      composePath,
    });
    await orch.up([]); // apex-only (connector + townhouse-api)
    \`\`\`

    ### Connector Anon Requirement (HS Profile)

    The HS profile's readiness gate calls `GET /admin/hs-hostname`. The
    connector container MUST be configured with `anon.enabled: true` —
    if anon is disabled, the endpoint returns 503 and the orchestrator
    throws `OrchestratorError("connector is anon-disabled — set
    anon.enabled: true in the connector config")`. Story 45.4's
    `townhouse hs up` generates the connector config with `anon.enabled: true`
    by default; manual configurations should mirror that setting.
    ```
  - [x] 9.2 Update `CLAUDE.md` "Where to Find Things" table — add one row:
    ```markdown
    | DockerOrchestrator HS-profile entry point | `packages/townhouse/src/docker/orchestrator.ts` (`upHs`, `waitForHsHostname`) |
    ```
  - [x] 9.3 NO updates to `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` (per Story 45.2 scope guard — never edit ACs while implementing them).

- [x] **Task 10: Smoke test the full path locally** (AC: all)
  - [x] 10.1 Run the dev-path regression suite first — this is what AC #2 protects:
    ```bash
    pnpm --filter @toon-protocol/townhouse test
    pnpm --filter @toon-protocol/townhouse test orchestrator
    pnpm --filter @toon-protocol/townhouse test admin-client
    # Optionally if Docker is available locally:
    RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- townhouse-cli-lifecycle
    ```
    All green. Specifically verify the existing `dev-stack-smoke.test.ts` still works against the contributor dev stack (`./scripts/townhouse-dev-infra.sh up` first if the stack isn't already running).
  - [x] 10.2 Run the new HS-path unit tests:
    ```bash
    pnpm --filter @toon-protocol/townhouse test orchestrator-hs
    ```
    All cases pass.
  - [x] 10.3 (Optional, requires Docker) Run the HS-path integration test:
    ```bash
    # First place the manifest from the latest publish run
    gh run download $(gh run list --workflow=publish-townhouse-images.yml --limit 1 --json databaseId --jq '.[0].databaseId') \
      --name image-manifest -D packages/townhouse/dist/
    pnpm --filter @toon-protocol/townhouse build
    RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- orchestrator-hs
    ```
    The test boots the apex (~2-3 min cold), asserts hostname publication, asserts volume preservation on `down`, then cleans up.
  - [x] 10.4 Run `pnpm --filter @toon-protocol/townhouse test:canary` — the connector image contract canary (Story 45.2) MUST stay green. The orchestrator refactor does not touch `DEFAULT_CONNECTOR_IMAGE` or the manifest-alignment test.
  - [x] 10.5 Run `pnpm --filter @toon-protocol/townhouse build` and inspect `dist/index.d.ts` — verify the new exports (`OrchestratorError`, the updated `DockerOrchestrator` constructor signature) appear in the type declarations.

- [x] **Task 11: Open PR + close out** (AC: #17)
  - [x] 11.1 Branch as `feat/45-3-orchestrator-profile-param` from current main. Open PR via `gh pr create` with a summary linking to this story file and listing every touched path (see "Files this story touches" in Dev Notes for the exhaustive list).
  - [x] 11.2 PR body includes: (a) the new `OrchestratorError` class signature, (b) the updated `DockerOrchestrator` constructor signature, (c) the dev-path test results showing zero regressions, (d) the HS-path unit test pass output, (e) (if Docker available) the integration-test pass output. Confirm `pnpm --filter @toon-protocol/townhouse test:canary` is green in PR description.
  - [x] 11.3 After PR merges to main:
    - Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `45-3-docker-orchestrator-profile-param: backlog → done`
    - Bump `last_updated` to merge date
    - Add the `# done: ...` comment naming the PR number, e.g. `# done: PR town#<N> merged; orchestrator HS profile + getHsHostname admin client + 13 new unit tests + 3 integration tests landed`
  - [x] 11.4 Story Status → review → done.

## Dev Notes

### Cross-Repo Boundary

This story is **town-only**. No connector-side code changes. The `GET /admin/hs-hostname` endpoint already ships in the connector image at the digest pinned by `DEFAULT_CONNECTOR_IMAGE` (Story 45.2 captured `sha256:4a24ccb0...` from connector v3.5.0+). If the dev finds themselves opening a PR in `toon-protocol/connector`, stop — they are outside the story.

Files this story touches in `toon-protocol/town`:

- `packages/townhouse/src/docker/orchestrator.ts` (MODIFY — add `OrchestratorError` class, constructor options object, `upHs` / `downHs` / `waitForHsHostname` / `surfaceComposeFailure` private methods, branch `up()` and `down()` on profile)
- `packages/townhouse/src/docker/index.ts` (MODIFY — add `OrchestratorError` to barrel export)
- `packages/townhouse/src/index.ts` (MODIFY — re-export `OrchestratorError`)
- `packages/townhouse/src/connector/admin-client.ts` (MODIFY — add `getHsHostname()` method)
- `packages/townhouse/src/connector/types.ts` (MODIFY — add `HsHostnameResponse` interface)
- `packages/townhouse/src/connector/admin-client.test.ts` (MODIFY — add 4 new test cases)
- `packages/townhouse/src/cli.ts` (MODIFY — pass `{ profile: 'dev' }` at three orchestrator construction sites)
- `packages/townhouse/src/docker/orchestrator-hs.test.ts` (NEW — HS-path unit tests, ~12 cases)
- `packages/townhouse/src/__integration__/orchestrator-hs.test.ts` (NEW — HS-path Docker integration test, ~3 cases)
- `packages/townhouse/README.md` (MODIFY — add "DockerOrchestrator Profiles" section)
- `CLAUDE.md` (MODIFY — add one row to "Where to Find Things")
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFY — Task 11.3)
- This story file (Task 11.4)

Files this story does **NOT** touch (scope guards):

- `packages/townhouse/src/cli.ts` beyond the three call-site updates — the `townhouse hs up` subcommand registration is Story 45.4 territory. If the dev adds a `case 'hs':` branch to `parseArgs`, stop.
- `packages/townhouse/compose/townhouse-hs.yml` — Story 45.2 deliverable. The HS template's service set, profile declarations, image refs, and env-var passthroughs are frozen. If the orchestrator needs a service the template doesn't declare, that's a Story 45.2 follow-up, not a 45.3 fix.
- `packages/townhouse/src/compose-loader.ts` — Story 45.2 deliverable. The `loadComposeTemplate` / `materializeComposeTemplate` / `ComposeLoaderError` API is frozen. The orchestrator consumes the API; it does not extend it.
- `packages/townhouse/src/constants.ts` `DEFAULT_CONNECTOR_IMAGE` — frozen at the digest Story 45.2 captured (`sha256:4a24ccb0...`). The orchestrator reads `this.config.connector.image` (operator-overridable) — it does not consume the constant directly.
- `packages/townhouse/src/wallet/` — wallet code is Story 21.4 / 45.4 territory. The HS path receives `walletManager` as a constructor arg (same as dev path) and uses it identically (no new methods invoked).
- `packages/townhouse/src/api/` — host API server is Story 45.4 territory.
- `scripts/build-image-manifest.mjs` and `scripts/render-compose-template.mjs` — Story 45.1 / 45.2 deliverables; do not modify.
- `.github/workflows/publish-townhouse-images.yml` — Story 45.1 / 45.2 deliverable.
- `docker-compose-townhouse-hs.yml` (root) — legacy operator-facing compose; does not affect the orchestrator (the orchestrator reads from `composePath` which Story 45.4 will resolve via `materializeComposeTemplate('hs')`).
- `docker-compose-townhouse-dev.yml` (root) — used by `scripts/townhouse-dev-infra.sh`; the orchestrator does not read it. Stays untouched.
- `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` — planning doc; do NOT modify story ACs while implementing them.

### Why Dual Paths (Dockerode for Dev, Subprocess for HS)

The two profiles intentionally diverge in implementation:

- **Dev profile uses dockerode (programmatic).** The contributor dev stack pre-dates Compose v2 stabilization in this codebase. Existing tests assert on dockerode-emitted events (`pullProgress`, `containerState`) at fine granularity. Switching the dev path to subprocess would require rewriting every test in `orchestrator.test.ts` (1500+ lines) AND would lose per-image pull progress visibility (subprocess only forwards Compose's coarse output). AC #2 is the load-bearing constraint: existing tests pass without modification. Dockerode preservation is non-negotiable.

- **HS profile uses subprocess.** The HS path's success criterion is "operator can reproduce the boot manually" — `docker compose -f ~/.townhouse/compose/townhouse-hs.yml up -d` must work identically whether invoked by the orchestrator OR pasted into the operator's terminal. Subprocess invocation guarantees that — there is no orchestrator-only state. It also leverages Docker Compose's mature `depends_on: condition: service_healthy` semantics for ordering (the connector must reach healthy before townhouse-api starts), which dockerode does not provide natively. The trade-off: lower-fidelity progress reporting. AC #6's stderr-parsing approach gives Story 45.4 enough signal to surface the failed-service name in Sally's failure copy library; finer-grained per-image pull progress is deferred to a future enhancement (and is acceptable because Compose's stderr already shows pull progress to the user when `inheritStdio` is set).

The orchestrator class is a thin façade: a `if (this.profile === 'hs')` branch at the top of `up()` and `down()` selects the path. Internal methods (`upDev`, `upHs`, `downDev`, `downHs`) keep the two implementations distinct and independently testable.

### Why `getHsHostname()` Is the Readiness Signal (Not `getHealth()`)

The connector reports `getHealth() → status: 'healthy'` once its HTTP servers are accepting connections — typically within 5-10 seconds of container start. The `.anyone` hidden-service hostname publication is a separate async operation that takes 30-90 seconds (anon network bootstrap + descriptor publication to v3 HS directory authorities). Calling `getHealth()` as the readiness signal would return success ~80 seconds before the apex is actually usable to outside callers — Drew would get a green `townhouse hs up` exit and discover the `.anyone` URL doesn't resolve.

`getHsHostname()` returns `{hostname: null, publishedAt: null}` until the descriptor is published, then transitions to `{hostname: 'xyz.anyone', publishedAt: '...'}`. The orchestrator polls until the transition occurs (or 120s timeout). This is the load-bearing readiness contract for Story 45.4's `townhouse hs up` "apex-ready" signal.

### Why Integration Tests Are Optional (RUN_DOCKER_INTEGRATION Gate)

The HS-path integration test (`orchestrator-hs.test.ts`) requires a real Docker daemon, the digest-pinned connector image (~600 MB pull on cold cache), AND the `dist/image-manifest.json` to materialize a valid HS template. CI runs it in the publish workflow (manifest is present); dev loops typically don't (manifest absent + Docker pull cost is too high for fast feedback). The skip gate `RUN_DOCKER_INTEGRATION === '1' && SKIP_DOCKER !== '1'` matches the existing pattern in `townhouse-cli-lifecycle.test.ts:36-47`. The unit tests (Task 7) cover the entire HS path WITHOUT Docker — argv composition, readiness polling, error parsing, event emission. The integration test is the end-to-end smoke proof; the unit tests are the contract tests.

### Failure-Surfacing Pattern: Why `containerState` Reuse

AC #6 mandates surfacing failures via the existing `containerState` event interface (NOT a new event type) so that consumers (the CLI in 45.4, the dashboard SPA later, the CI smoke harness) treat dev-path and HS-path failures uniformly. The dev path emits `containerState { name: 'townhouse-town', state: 'error' }` when a node fails to start; the HS path emits `containerState { name: 'connector', state: 'error' }` (note: container name vs service name is a deliberate choice — Compose stderr typically names services, not containers). The consumer's failure-handler doesn't need to know which profile produced the event.

Stderr parsing is unavoidable but kept narrow: three regex patterns covering Compose v2's actual error messages (verified empirically against `docker compose v2.29.x`). When stderr matches none of the patterns, the fallback event with `name: 'compose-up'` ensures the consumer always sees at least one error event (so Story 45.4's CLI doesn't get a thrown error with no preceding event-emission — the spinner stays consistent).

### Architecture Compliance

- **NFR1 (5-min apex-ready from cold cache):** The 120s readiness budget for `getHsHostname()` polling is the upper bound after image pull completes. Image pull (~2-3 min for connector image on 50 Mbps) + 30-90s anon bootstrap = within the 5-min total budget. No further tuning required.
- **NFR7 (no docker.sock in connector container):** The HS template (Story 45.2) does not mount the socket in the connector service. The orchestrator does not need to enforce this — the template is the contract.
- **NFR9 (host ports bind to 127.0.0.1 only):** The HS template (Story 45.2) binds all host-side ports to `127.0.0.1`. The orchestrator reads `this.config.connector.adminPort` (default 9401) which the template binds to `127.0.0.1:9401:9401`. The orchestrator's readiness poll URL `http://127.0.0.1:9401/admin/hs-hostname` matches.
- **NFR15 (Node.js >=20, ESM-only):** The new code uses `node:child_process.execFile` + `node:util.promisify`, both stable at Node 20. ESM-only — no `require()` calls added.
- **NFR17 (pre-publish quality gate):** This story does NOT change the gate set. The Story 45.2 canary (`connector-image-contract.test.ts`) and Story 45.1 image-publish workflow remain authoritative. The new tests (orchestrator-hs unit + integration) extend the gate but don't replace existing checks.
- **D44-013 (cross-repo release contract):** This story consumes `GET /admin/hs-hostname` which is documented in `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (Story 44.4 deliverable) as a connector v3.5.0+ contract. Story 45.2 already pinned the digest to a v3.5.0+ image; this story's readiness gate exercises that contract.
- **OWASP A03 (injection):** All `docker compose` invocations use `execFile(file, args[])`. The `composePath` is passed as a single args-array element — never string-concatenated. ESLint `security/detect-child-process` clean. Subprocess shell flag is OFF (`shell: false` is the default for `execFile`).
- **OWASP A09 (security logging failures):** `OrchestratorError.stderr` is the captured subprocess stderr — passed to consumers verbatim. Consumers (Story 45.4's CLI) MUST avoid leaking stderr to telemetry without redaction (the stderr may contain env vars set by Compose). This story's surface is the error class; the redaction policy is Story 45.4's CLI concern.

### Critical Implementation Patterns

- **Don't refactor the dev path.** AC #2 is non-negotiable: the existing `up()` body's five lines move into `upDev()` UNCHANGED. Resist any temptation to "improve" the dev path while you're in the file. Every event, every dockerode call, every retry loop must stay identical.
- **`execFile`, not `exec`.** Shell-mode invocation is forbidden. The composePath is operator-controlled (could come from `~/.townhouse/compose/townhouse-hs.yml` which is operator-writable by design). Even with the `assertNotSymlink` + path-validation in compose-loader, defense-in-depth means the orchestrator never invokes a shell.
- **Inject `execFileAsync` and `adminClientFactory` for testability.** Module-level mocking via `vi.mock('node:child_process')` works but creates ESM-load-order brittleness. Constructor-injected functions are the established pattern in this codebase (see `walletManager` injection for precedent). Tests that need to mock execFile pass a stub via the `options.execFileAsync` field.
- **Don't catch+re-throw errors as plain `Error`.** All HS-path errors are `OrchestratorError` instances with structured fields (`service`, `exitCode`, `stderr`, `cause`). Story 45.4's CLI uses `instanceof OrchestratorError` to render Sally's failure-state copy; throwing plain `Error` breaks that branch.
- **`waitForHsHostname` polling stops on 503.** The 503 anon-disabled response is a configuration error, not a transient state. Continuing to poll wastes 120 seconds and confuses the operator. The `if (msg.includes('anon-disabled'))` check in the catch block fires on the FIRST 503 and immediately throws.
- **Profile flags come BEFORE the subcommand.** Docker Compose CLI grammar: `docker compose [global-opts] [-f file] [--profile NAME ...] <subcommand> [subcommand-opts]`. Putting `--profile` after `up` produces `unknown flag` errors. The Task 4.4 implementation pushes the profile flags onto `args` BEFORE pushing `'up', '-d'`.
- **Compose subprocess timeout of 180s is generous, not strict.** The 5-min NFR1 budget includes image pull + anon bootstrap. The subprocess timeout covers only `docker compose up -d` (which returns once containers are CREATED, not once they're HEALTHY — `depends_on: condition: service_healthy` blocks the subprocess until healthy). On cold image cache + 50 Mbps, the connector image (~600 MB) pulls in ~100s; 180s gives 80s of headroom for healthcheck startup. Tighter values risk false timeouts on slow networks.
- **Don't include `-v` in HS down.** The `townhouse-hs-anon` named volume holds the .anyone keypair. Removing it rotates the address — that's an explicit operator action (`townhouse hs down --rotate-keys` in Story 45.4) NOT a default. The orchestrator's `downHs()` always preserves volumes.
- **Stderr parsing is best-effort.** The three regex patterns cover empirically-observed Compose v2 messages; if a future Compose version changes its message format, the fallback `compose-up` event ensures consumers still see a failure signal. Don't add zero-fallback logic that throws when stderr doesn't match — that creates a worse failure mode than imperfect parsing.

### Sequencing Within Epic 45

```
   45.1 (DONE) ──→ 45.2 (DONE) ──→ 45.4 (BLOCKED on this story)
       │              │              │
       └────────── 45.3 (this) ──────┘
                   (consumer of 45.2,
                    producer for 45.4)
```

- **45.1 produced:** `image-manifest.json` artifact, four signed multi-arch GHCR images
- **45.2 produced:** `loadComposeTemplate` / `materializeComposeTemplate` API, embedded compose templates in npm tarball, digest-pinned `DEFAULT_CONNECTOR_IMAGE`
- **45.3 (this) produces:** `DockerOrchestrator` HS-profile path, `OrchestratorError` class, `getHsHostname()` admin-client method
- **45.4 consumes:** all of the above — calls `materializeComposeTemplate('hs')` → constructs `new DockerOrchestrator(..., { profile: 'hs', composePath })` → `up([])` → reads the published `.anyone` hostname from `getHsHostname()` for stdout / `~/.townhouse/host.json`
- **Critical path:** 45.1 (DONE) → 45.2 (DONE) → 45.3 (this) → 45.4 → 46.1 (next critical)

### Latest tech (verified 2026-05-09)

- **`node:child_process.execFile` (Node ≥20):** Stable. The promisified form via `node:util.promisify(execFile)` returns `Promise<{stdout: string; stderr: string}>`. On non-zero exit, the rejection has shape `Error & { code: number; stderr: string; stdout: string; signal?: string; killed?: boolean }`. The `maxBuffer` option defaults to 1 MB — too small for `docker compose up` output on image pull. Bump to 16 MB.
- **`docker compose v2 --profile` flag ordering:** Flag MUST appear before the subcommand. Multiple `--profile <name>` flags accumulate (compose v2.29+; older v2 versions accept comma-separated form `--profile a,b` which is more brittle). Use the multi-flag form for forward compatibility.
- **`docker compose -f <file> down`:** Default behavior preserves named volumes. `-v` flag removes them. `--remove-orphans` flag removes containers not in the current compose file. The orchestrator omits both flags — the compose file IS the single source of truth, and volume preservation is required.
- **Connector v3.5.0+ `GET /admin/hs-hostname` contract** (CR-1, planning doc §FR35): Returns 200 with `{hostname: string|null, publishedAt: string|null}`; returns 503 with `{ error: 'anon-disabled' }` body when `anon.enabled: false` in connector config. Documented in `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (Story 44.4).
- **vitest fake timers + Promise interaction:** `vi.useFakeTimers()` does NOT advance promise queues. Use `vi.advanceTimersByTimeAsync(ms)` (returns a promise) when the code under test awaits inside a polling loop. `vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })` is required when the polling loop checks `Date.now()` for the deadline.
- **dockerode 4.0+ `listImages()` `RepoDigests` field:** Already shipped. Story 45.2 R1 patch extended the cache-hit check to match digest-form refs against `RepoDigests` in addition to `RepoTags`. This story's HS path doesn't pull images programmatically (Compose handles it), so the dockerode digest-handling is a non-issue here — but it's the reason the dev path's `pullImages` continues working with the digest-form `DEFAULT_CONNECTOR_IMAGE`.

### What This Story Does NOT Do (scope guard)

- **Does NOT add the `townhouse hs up` CLI subcommand.** Story 45.4 owns the CLI surface, the wallet-password prompt, the apex-ready stdout messaging, the `~/.townhouse/host.json` write, the `--rotate-keys` flag handling.
- **Does NOT generate the connector config.** The HS template uses `~/.townhouse/connector.yaml` (operator-supplied) — Story 45.4 generates this on first run with `anon.enabled: true`. This story's orchestrator only READS the connector at runtime (via `getHsHostname()`); it does not write the config.
- **Does NOT modify the dev compose template (`townhouse-dev.yml`) or the dev-stack script (`scripts/townhouse-dev-infra.sh`).** Both are pre-existing. The dev profile of the orchestrator continues using dockerode, not the dev compose template.
- **Does NOT modify `docker-compose-townhouse-hs.yml` (root) or `docker-compose-townhouse-dev.yml` (root).** Both are legacy. The orchestrator reads from `composePath` which the caller resolves via `materializeComposeTemplate`.
- **Does NOT add per-image pull progress reporting for the HS path.** Compose subprocess inherits stdout/stderr to the user; finer-grained `pullProgress` events are dev-path-only. A future enhancement could parse Compose's stderr for pull progress, but it is out of scope here.
- **Does NOT add a `docker compose pull` pre-step.** Compose v2's `up -d` automatically pulls missing images. Adding a separate pull would duplicate work and break the 5-min NFR1 budget timing.
- **Does NOT add zod runtime validation for `HsHostnameResponse`.** The existing admin-client pattern uses inline `typeof` checks (see `getHealth` lines 60-78). Adding zod here would diverge from the established pattern; reuse it.
- **Does NOT add a healthcheck-based readiness gate as a fallback for `getHsHostname()`.** The HS template's `connector` service already has a `healthcheck` directive (Story 45.2); Compose's `depends_on: condition: service_healthy` on `townhouse-api` blocks the subprocess until the connector is healthy. The orchestrator's `waitForHsHostname` adds the SECOND gate (HS publication, not just process health).
- **Does NOT bump the townhouse package version.** Version stays at `0.1.0-rc5` (or whatever current). Version bumps happen with the next `v*` tag push that triggers Story 45.1's publish workflow.
- **Does NOT touch any code outside `packages/townhouse/`, `CLAUDE.md`, or `_bmad-output/`.** If the dev finds themselves editing `packages/town/`, `packages/mill/`, `packages/dvm/`, the connector repo, or any other package — stop, that's outside scope.
- **Does NOT delete `DockerOrchestrator`'s old methods (`startConnector`, `startNode`, `startRelayAtorSidecar`, `pullImages`, etc.).** Every dev-path method stays. The HS path is additive.

## References

### From `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md`

- [Source: epics-townhouse-hs-v1.md#L550-L580] — Story 45.3 ACs (canonical)
- [Source: epics-townhouse-hs-v1.md#L85] — FR35 (`GET /admin/hs-hostname` contract)
- [Source: epics-townhouse-hs-v1.md#L94] — NFR1 (5-min apex-ready budget)
- [Source: epics-townhouse-hs-v1.md#L106] — NFR9 (host ports bind to 127.0.0.1 only)
- [Source: epics-townhouse-hs-v1.md#L122] — NFR17 (pre-publish quality gate)
- [Source: epics-townhouse-hs-v1.md#L150] — Connector dep version (digest-pinned via image-manifest.json)
- [Source: epics-townhouse-hs-v1.md#L277-L284] — Epic 45 overview (One-Command Apex Install)
- [Source: epics-townhouse-hs-v1.md#L337-L390] — Story 44.1 (`GET /admin/hs-hostname` endpoint — connector-side, dependency)
- [Source: epics-townhouse-hs-v1.md#L583-L642] — Story 45.4 (`townhouse hs up` — downstream consumer)

### From `_bmad-output/implementation-artifacts/`

- [Source: 45-1-multi-arch-townhouse-image-publish-ci.md] — produces `image-manifest.json`; HS template references its digests
- [Source: 45-2-embed-compose-templates-and-image-manifest-in-npm-tarball.md] — produces `loadComposeTemplate` / `materializeComposeTemplate` API + HS template + `DEFAULT_CONNECTOR_IMAGE` digest
- [Source: 45-2-embed-compose-templates-and-image-manifest-in-npm-tarball.md#L498-L500] — note that 45.3 owns the orchestrator profile-param refactor; 45.2 only added the `RepoDigests` cache-hit fix to `pullImages`
- [Source: 44-4-connector-release-contract-cross-repo-doc.md] — release contract; defines the `GET /admin/hs-hostname` connector v3.5.0+ contract this story consumes

### From this repo

- [Source: packages/townhouse/src/docker/orchestrator.ts] — file under refactor; preserve the dev-path code verbatim
- [Source: packages/townhouse/src/docker/orchestrator.ts:113-129] — current `up(profiles)` body — moves to `upDev` unchanged
- [Source: packages/townhouse/src/docker/orchestrator.ts:204-236] — current `down()` body — moves to `downDev` unchanged
- [Source: packages/townhouse/src/docker/orchestrator.ts:465-505] — `pullImages` — already digest-aware (Story 45.2 R1 patch)
- [Source: packages/townhouse/src/docker/orchestrator.ts:604-646] — `startConnector` (dockerode dev path) — DO NOT touch
- [Source: packages/townhouse/src/docker/orchestrator.test.ts] — existing dev-path unit tests (1536 lines) — must pass without modification (AC #2)
- [Source: packages/townhouse/src/docker/orchestrator-connector.test.ts] — existing connector-path unit tests (525 lines) — must pass without modification (AC #2)
- [Source: packages/townhouse/src/connector/admin-client.ts] — file modified to add `getHsHostname()`
- [Source: packages/townhouse/src/connector/admin-client.ts:50-78] — `getHealth()` — canonical inline-validation pattern to mirror in `getHsHostname()`
- [Source: packages/townhouse/src/connector/admin-client.test.ts] — file modified to add 4 new test cases
- [Source: packages/townhouse/src/connector/types.ts] — file modified to add `HsHostnameResponse` interface
- [Source: packages/townhouse/src/compose-loader.ts] — Story 45.2 deliverable; `loadComposeTemplate` / `materializeComposeTemplate` API consumed by this story's caller (Story 45.4)
- [Source: packages/townhouse/compose/townhouse-hs.yml] — Story 45.2 deliverable; defines the service set + profile declarations the orchestrator emits flags for
- [Source: packages/townhouse/compose/townhouse-hs.yml:73-96] — `connector` service (always-on, no `profiles:` declaration)
- [Source: packages/townhouse/compose/townhouse-hs.yml:110-141] — `townhouse-api` service (always-on)
- [Source: packages/townhouse/compose/townhouse-hs.yml:156,199,246] — `town`, `mill`, `dvm` profile declarations (each gated by single-element profile array)
- [Source: packages/townhouse/src/cli.ts:336] — status handler orchestrator construction
- [Source: packages/townhouse/src/cli.ts:506] — `handleUp` orchestrator construction (primary call site)
- [Source: packages/townhouse/src/cli.ts:672] — down handler orchestrator construction
- [Source: packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts] — existing CLI lifecycle integration test — must pass without modification (AC #2)
- [Source: packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts:36-47] — skip-gate pattern (`RUN_DOCKER_INTEGRATION` + `SKIP_DOCKER`) — mirror in new integration test
- [Source: packages/townhouse/src/__integration__/_test-helpers.ts] — `isTruthyEnv`, `runCli`, `waitForExit`, `waitForUrl` helpers
- [Source: packages/townhouse/src/__integration__/connector-image-contract.test.ts] — Story 45.2 manifest-alignment canary; must stay green (Task 10.4)
- [Source: packages/townhouse/src/constants.ts:26-27] — `DEFAULT_CONNECTOR_IMAGE` (digest form, Story 45.2)
- [Source: packages/townhouse/package.json:58-59] — `@toon-protocol/mill` workspace dep, `dockerode ^4.0.0` (already installed; no new deps)
- [Source: packages/townhouse/README.md] — append "DockerOrchestrator Profiles" section (Task 9.1)
- [Source: CLAUDE.md] — append one row to "Where to Find Things" (Task 9.2)

### Latest tech references (verified 2026-05-09)

- [Node.js `child_process.execFile` docs](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback) — `maxBuffer` option, error shape on non-zero exit
- [Docker Compose v2 CLI reference](https://docs.docker.com/reference/cli/docker/compose/up/) — flag ordering, multi-`--profile` accumulation, `-d` detached mode semantics
- [Docker Compose v2 down](https://docs.docker.com/reference/cli/docker/compose/down/) — default volume preservation, `-v` to remove named volumes
- [vitest fake timers](https://vitest.dev/api/vi.html#vi-usefaketimers) — `advanceTimersByTimeAsync` for promise-aware advance, `toFake` option for `Date` inclusion
- [Connector `GET /admin/hs-hostname` contract](https://github.com/toon-protocol/connector/issues/58) — CR-1 contract (resolved 2026-05-07; ships in connector v3.5.0)

## Verification

After Task 11 PR merges:

```bash
# 1. Dev-path regression (AC #2)
pnpm --filter @toon-protocol/townhouse test
pnpm --filter @toon-protocol/townhouse test orchestrator
pnpm --filter @toon-protocol/townhouse test admin-client
# Expected: all green, no test-file edits in git diff

# 2. HS-path unit tests (AC #12)
pnpm --filter @toon-protocol/townhouse test orchestrator-hs
# Expected: all 12 cases pass

# 3. (Optional, Docker required) HS-path integration test (AC #13)
gh run download $(gh run list --workflow=publish-townhouse-images.yml --limit 1 --json databaseId --jq '.[0].databaseId') \
  --name image-manifest -D packages/townhouse/dist/
pnpm --filter @toon-protocol/townhouse build
RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- orchestrator-hs
# Expected: 3 cases pass, ~3 min on cold image cache

# 4. Canary (must stay green, Story 45.2 deliverable)
pnpm --filter @toon-protocol/townhouse test:canary
# Expected: green

# 5. Type check (new export visible in dist/index.d.ts)
pnpm --filter @toon-protocol/townhouse build
grep -E '(OrchestratorError|getHsHostname|HsHostnameResponse|profile.*ComposeProfile)' packages/townhouse/dist/index.d.ts
# Expected: ≥3 lines (one per new export)

# 6. Public API smoke
node --input-type=module -e "
  import { DockerOrchestrator, OrchestratorError } from '@toon-protocol/townhouse';
  console.log(typeof DockerOrchestrator, typeof OrchestratorError);
  // Expected: 'function function'
"

# 7. Sprint-status update (AC #17)
grep -A1 "45-3-docker-orchestrator-profile-param" _bmad-output/implementation-artifacts/sprint-status.yaml
# Expected: status reads "done", trailing # comment names PR number
```

If any of these checks fail, the story is NOT done. Re-open. Do not flip sprint-status to `done`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation proceeded without blockers.

### Completion Notes List

- `OrchestratorError` class added to `orchestrator.ts` before `normalizeImageTag`, exported through docker barrel + public API.
- Constructor options object (4th param, default `{}`) preserves all three-arg call sites; existing tests pass verbatim with no test-file edits (AC #2 diff confirmed empty).
- `upDev()` is the verbatim body of the old `up()` — no behavioral change. `upHs()` uses `this.execFileAsync` (DI) for subprocess invocation + `this.adminClientFactory` (DI) for polling, avoiding vi.mock ESM brittleness.
- `getHsHostname()` uses direct `fetch()` (not `this.fetch()`) to intercept 503 before the shared helper throws — keeps the shared helper semantics clean.
- Fake-timer timeout test uses `Promise.then/catch` settlement capture to avoid `PromiseRejectionHandledWarning` (fixed after first run showed unhandled rejection).
- 14 unit tests + 3 integration test stubs (skip-gated by `RUN_DOCKER_INTEGRATION`).
- Pre-existing `logs.test.ts` failures (4 tests) confirmed on main before this PR — not introduced.

### File List

- `packages/townhouse/src/docker/orchestrator.ts` — added OrchestratorError, profile/composePath/execFileAsync/adminClientFactory fields, updated constructor, branched up()/down(), added upHs/downHs/upDev/downDev/surfaceComposeFailure/waitForHsHostname
- `packages/townhouse/src/docker/index.ts` — added OrchestratorError to barrel export
- `packages/townhouse/src/docker/orchestrator-hs.test.ts` — NEW: 14 HS-path unit tests
- `packages/townhouse/src/__integration__/orchestrator-hs.test.ts` — NEW: 3-case Docker integration test (skip-gated)
- `packages/townhouse/src/connector/admin-client.ts` — added getHsHostname() method with 503 handling
- `packages/townhouse/src/connector/admin-client.test.ts` — added 5 new getHsHostname test cases
- `packages/townhouse/src/connector/types.ts` — added HsHostnameResponse interface
- `packages/townhouse/src/connector/index.ts` — added HsHostnameResponse to type exports
- `packages/townhouse/src/index.ts` — added OrchestratorError + HsHostnameResponse to public API exports
- `packages/townhouse/src/cli.ts` — updated 3 orchestrator call sites to pass { profile: 'dev' }
- `packages/townhouse/README.md` — added "DockerOrchestrator Profiles" section
- `CLAUDE.md` — added DockerOrchestrator HS-profile row to "Where to Find Things"
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated

### Change Log

- 2026-05-09: Implemented Story 45.3 — DockerOrchestrator HS profile, getHsHostname admin client, OrchestratorError class, 14 unit tests + 3 integration test stubs; PR #44 opened

### Review Findings

_Code review 2026-05-09 — Blind Hunter + Edge Case Hunter + Acceptance Auditor (claude-sonnet-4-6)_

- [x] [Review][Decision→Patch] AC #10 stdio inheritance gap — operator sees no `docker pull` progress during HS up — Resolved by switching the default subprocess runner from `promisify(execFile)` to a `spawn`-based helper (`runDockerCompose`) that uses `stdio: ['ignore', 'inherit', 'pipe']` for HS up, captures stderr into a chunk buffer for the failure-surface path, and inherits stdout to the operator's TTY. Test contract preserved via `execFileAsync` injection point.

- [x] [Review][Patch] `response.json()` body-read happens AFTER `clearTimeout(timer)` — request timeout doesn't cover JSON parse, slow body hangs forever past `timeoutMs` [packages/townhouse/src/connector/admin-client.ts:117-119]
- [x] [Review][Patch] `response.json()` SyntaxError on non-JSON body propagates unwrapped — readiness loop treats it as transient and retries to deadline [packages/townhouse/src/connector/admin-client.ts:119]
- [x] [Review][Patch] Empty-string `hostname` (`''`) passes the `typeof string` check and orchestrator returns "ready" with an unusable address — tighten shape validation to reject empty strings [packages/townhouse/src/connector/admin-client.ts:127-129]
- [x] [Review][Patch] `surfaceComposeFailure` breaks after the FIRST regex match — multi-service compose failures lose every service after the first; AC #6 says "For each failed service identified, it emits ..." [packages/townhouse/src/docker/orchestrator.ts:249-260]
- [x] [Review][Patch] String error codes (`ENOENT` when docker CLI not on PATH, `ETIMEDOUT`, `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) coerced to `exitCode = -1`, the most common failure modes lose their diagnostic — preserve the string code in the message and on `OrchestratorError.exitCode` (or add a `codeName` field) [packages/townhouse/src/docker/orchestrator.ts:225, :434]
- [x] [Review][Patch] Unknown profile types in input array are silently dropped — `for (const type of PROFILE_ORDER)` only iterates the canonical set, so any new `NodeType` member or runtime-injected unknown value is ignored without warning [packages/townhouse/src/docker/orchestrator.ts:206-210]
- [x] [Review][Patch] `execFileAsync` invocations have no `encoding` option — stderr is a Buffer by default; `String(buf)` works for ASCII but loses non-UTF8 detail and breaks if a future caller passes a non-Buffer encoding [packages/townhouse/src/docker/orchestrator.ts:214-217, :425]
- [x] [Review][Patch] `composePath` whitespace-only string passes `!this.composePath` falsy check — `.trim()` before validation; throw on whitespace-only path [packages/townhouse/src/docker/orchestrator.ts:159-165]
- [x] [Review][Patch] `downHs` lacks `maxBuffer` ceiling — defaults to Node's 1 MB; voluminous compose-down stderr triggers `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and reports an empty diagnostic. Mirror upHs's 16 MB [packages/townhouse/src/docker/orchestrator.ts:425]

- [x] [Review][Defer] README documents the anon-disabled error message verbatim — drift hazard between code and doc [packages/townhouse/README.md] — deferred, doc-style improvement
- [x] [Review][Defer] Magic numbers (timeouts, intervals, maxBuffer, stderr-truncation) not named constants [packages/townhouse/src/docker/orchestrator.ts] — deferred, style only
- [x] [Review][Defer] AC #5 ECONNREFUSED retry-within-budget path has no dedicated unit test — branch exists but is untested [packages/townhouse/src/docker/orchestrator-hs.test.ts] — deferred, test gap (AC #12 didn't list it as required)
- [x] [Review][Defer] AC #12 "constructor stores profile/composePath" assertion is `instanceof`-only — fields are private and never observably verified [packages/townhouse/src/docker/orchestrator-hs.test.ts:479-491] — deferred, test improvement
- [x] [Review][Defer] Integration test container assertion uses substring `name=townhouse-hs-` filter — pollutes on a host with leftover state [packages/townhouse/src/__integration__/orchestrator-hs.test.ts:161-167] — deferred, integration-test gated on RUN_DOCKER_INTEGRATION
- [x] [Review][Defer] Integration test depends on vitest `it`-order for volume-preservation assertion (`afterAll` runs `down -v`, third `it` checks volume survives `orch.down()` first) [packages/townhouse/src/__integration__/orchestrator-hs.test.ts] — deferred
- [x] [Review][Defer] `process.env['TOWNHOUSE_WALLET_PASSWORD']` mutated in `beforeAll` without try/finally restore — leaks across worker reuse [packages/townhouse/src/__integration__/orchestrator-hs.test.ts:129, :153] — deferred
- [x] [Review][Defer] No partial-failure rollback when `docker compose up` times out — Node kills the CLI but dockerd keeps going, leaving a half-started stack [packages/townhouse/src/docker/orchestrator.ts:213-231] — deferred, product decision (Story 45.4 retry policy)
- [x] [Review][Defer] User-visible error message truncates stderr to 500 chars — full stderr is preserved on `error.stderr` field but human-readable diagnostic is gutted for real compose errors [packages/townhouse/src/docker/orchestrator.ts:228, :432] — deferred, UX
- [x] [Review][Defer] `composePath` not validated as absolute or existing on disk — defense-in-depth gap; current callers pass paths from `materializeComposeTemplate` [packages/townhouse/src/docker/orchestrator.ts:159] — deferred
- [x] [Review][Defer] Non-503 / non-200 statuses (404, 500, 502) silently retried for 120s — old connector image (`pre-v3.5.0`) returns 404 and times out instead of fast-failing [packages/townhouse/src/docker/orchestrator.ts:284-294] — deferred, AC neutral
- [x] [Review][Defer] `activeNodes` mutated before `upHs/upDev` could fail — leaves stale state on error [packages/townhouse/src/docker/orchestrator.ts:174] — deferred, pre-existing in dev path

_Code review round 3 — 2026-05-10 — Blind Hunter + Edge Case Hunter + Acceptance Auditor (claude-opus-4-7[1m])_

> Acceptance Auditor: ACs satisfied 17/17, scope-guard violations 0, prior-review (round 2) regressions 0. All 9 round-2 patches verified intact post lint-fix commits.

- [x] [Review][Decision→Patch] `getHsHostname()` now enforces `hostname.endsWith('.anyone')` at the trust boundary so a misbehaving connector publishing e.g. `example.com` is rejected before propagating through the orchestrator. AC #7 only mandates shape; the integration test enforces `.anyone` externally — this puts the same check in the admin-client where the contract is asserted. [packages/townhouse/src/connector/admin-client.ts]
- [x] [Review][Patch][CRITICAL] Integration test now passes `getDefaultConfig()` instead of `undefined as never` — `waitForHsHostname` reads `config.connector.adminPort`, so undefined would have TypeError'd mid-test. AC #13's integration test was previously skip-gated and untested; would have crashed on first real run. [packages/townhouse/src/__integration__/orchestrator-hs.test.ts]
- [x] [Review][Patch] `waitForHsHostname` now treats `"invalid hs-hostname response shape"` and `"invalid JSON in hs-hostname response"` as fatal alongside `anon-disabled` — surfaces malformed connector responses immediately instead of masking them behind a generic 120 s timeout. [packages/townhouse/src/docker/orchestrator.ts]
- [x] [Review][Patch] `waitForHsHostname` now captures the most recent `lastError` and prefers it over the stale `lastResponse` in the timeout message — operator sees connector death (ECONNREFUSED) instead of a misleading earlier-success snapshot. Also passes `cause` on the timeout error. [packages/townhouse/src/docker/orchestrator.ts]
- [x] [Review][Patch] `surfaceComposeFailure` pattern 3 regex now uses `[\w-]+?(?:-\d+)?` (non-greedy with optional Compose `-N` instance suffix) so `townhouse-hs-townhouse-api-1` captures `"townhouse-api"` instead of `"townhouse"`. Eliminates duplicate `containerState` events for one logical failure. [packages/townhouse/src/docker/orchestrator.ts]
- [x] [Review][Patch] `getHsHostname` now detects AbortError inside the body-read try/catch and re-throws as a timeout error matching the request-phase diagnostic — body-read timeouts no longer masquerade as "invalid JSON". [packages/townhouse/src/connector/admin-client.ts]
- [x] [Review][Patch] `runDockerCompose` now actually captures stdout (listener was never attached) — function's `{stdout, stderr}` return type now reflects reality. Inherit-stdio mode still leaves stdoutChunks empty (correct: child.stdout is null when inherited to TTY). [packages/townhouse/src/docker/orchestrator.ts]
- [x] [Review][Patch] Integration test wallet-password env var now wrapped in `try/finally` with previous-value capture — restores even if cleanup throws; never leaks across vitest worker reuse. [packages/townhouse/src/__integration__/orchestrator-hs.test.ts]
- [x] [Review][Patch] `getHsHostname` empty-string check extended from `hostname` to `publishedAt` for consistency — `{hostname: "x.anyone", publishedAt: ""}` now rejected as malformed shape. [packages/townhouse/src/connector/admin-client.ts]
- [x] [Review][Patch] Dead imports removed: `execFile` no longer imported, `promisify` no longer imported, `void promisify; void execFile;` lint-suppress hack deleted. Only `spawn` (used by `runDockerCompose`) remains. [packages/townhouse/src/docker/orchestrator.ts]

- [x] [Review][Defer] `up()` mutates `this.activeNodes` before HS-path validation rejects unknown profiles — pre-existing pattern in dev path (round-2 deferred for the same reason); HS-path's new `OrchestratorError` for unknown profile types interacts with it but doesn't fundamentally change the picture. [packages/townhouse/src/docker/orchestrator.ts:279,320-334] — deferred, pre-existing
- [x] [Review][Defer] `upHs` does not roll back successfully-started compose containers when `waitForHsHostname` later times out — operator must `townhouse hs down` manually before re-invoking. Same product-decision space as round-2 deferred "no partial-failure rollback when `docker compose up` times out"; Story 45.4 retry policy. [packages/townhouse/src/docker/orchestrator.ts:343-376] — deferred, Story 45.4 territory
- [x] [Review][Defer] `surfaceComposeFailure` pattern 3 hardcodes `townhouse-hs-` container-name prefix — silently dead code for operators who set `COMPOSE_PROJECT_NAME`. [packages/townhouse/src/docker/orchestrator.ts:389] — deferred, advanced operator override
- [x] [Review][Defer] Integration test `docker ps --filter name=townhouse-hs-` is a substring filter — pollutes on a host with leftover state or a parallel townhouse stack. Same family as round-2 deferred "Integration test container assertion uses substring filter". [packages/townhouse/src/__integration__/orchestrator-hs.test.ts:90,107] — deferred, RUN_DOCKER_INTEGRATION-gated
- [x] [Review][Defer] HS `up()` ENOENT path attributes failure to "docker CLI not found on PATH" — could equally mean the compose subcommand plugin is missing. Operator gets pointed in roughly the right direction. [packages/townhouse/src/docker/orchestrator.ts:360-361] — deferred, edge case
- [x] [Review][Defer] `runDockerCompose` silently drops stderr chunks past 16 MB without truncation marker — 16 MB is well above realistic compose stderr size. [packages/townhouse/src/docker/orchestrator.ts:78-83] — deferred, polish
- [x] [Review][Defer] HS `waitForHsHostname` "polls until non-null" unit test uses real timers (~6 s wall clock) — slows CI marginally but correctness is fine. [packages/townhouse/src/docker/orchestrator-hs.test.ts] — deferred, perf only
- [x] [Review][Defer] `waitForHsHostname` deadline can overrun the advertised 120 s by ~7 s when each request takes ~5 s and the deadline check happens before the call. Sub-second precision not required. [packages/townhouse/src/docker/orchestrator.ts:419] — deferred, drift acceptable
- [x] [Review][Defer] `waitForHsHostname` uses `Date.now()` for the deadline — laptop suspend/resume + system clock backward jump can extend the timeout indefinitely. Would need monotonic clock (`process.hrtime.bigint()`). Realistic on the target deployment (laptops) but rare. [packages/townhouse/src/docker/orchestrator.ts:414,419] — deferred, future hardening
- [x] [Review][Defer] `downHs` is not idempotent when nothing is running — exits 0 with WARN on some Compose versions, exits 1 on others. CLI consumers (Story 45.4) need to handle "already-stopped" gracefully. — deferred, Story 45.4 product decision
- [x] [Review][Defer] `downHs` 60 s timeout may be tight for 3-peer (`town`+`mill`+`dvm`) HS stacks where each container's SIGTERM grace is 10 s. Compose stops in parallel, so likely fine; tune if it bites. [packages/townhouse/src/docker/orchestrator.ts:570] — deferred, tune-on-evidence
- [x] [Review][Defer] HS-path fake-timer tests are sensitive to microtask ordering between `getHsHostname` mock resolution and `setTimeout` advance. Tests pass per dev report; refactor would be style only. [packages/townhouse/src/docker/orchestrator-hs.test.ts:660-685] — deferred, style

