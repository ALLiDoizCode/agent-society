# Story 45.4: `townhouse hs up` Subcommand — Apex-Only Boot

Status: review

> **Critical-path fourth story of Epic 45 (One-Command Apex Install).** Sized M. This is the user-visible payoff of Epic 45: Drew runs `npx @toon-protocol/townhouse hs up` and gets a payable `.anyone` apex in under 5 minutes. Stories 45.1–45.3 built the substrate (multi-arch images, embedded compose + image-manifest, dual-profile orchestrator + `getHsHostname()` admin-client + `OrchestratorError`); this story stitches them into a CLI subcommand and adds the on-disk artifacts (`~/.townhouse/connector.yaml`, `~/.townhouse/host.json`) Drew sees. Unblocks Epic 46 Story 46.1 (`nodes.yaml` reconciler — needs an apex to register against).
>
> **Critical Path:** 45.1 (DONE) → 45.2 (DONE) → 45.3 (review/PR #44 merging) → **45.4 (this)** → 46.1.

## Story

As a **homelab operator (Drew)**,
I want **to run `npx @toon-protocol/townhouse hs up` once on a freshly-installed machine and have an apex stack come up with zero further configuration — connector + townhouse-api + a published `.anyone` hidden-service hostname rendered as the final stdout line and persisted to `~/.townhouse/host.json`**,
so that **I have a payable identity on the TOON network in under 5 minutes without enabling any peer node yet, can re-run the command idempotently to re-print the address, and can `townhouse hs down` (default = preserve volume → stable address) or `townhouse hs down --rotate-keys` (explicit destructive opt-out → new address) without ever touching the source repo or running `docker compose build`**.

## Acceptance Criteria

1. **`townhouse hs <subcommand>` is a registered top-level command pair `up` / `down` in `packages/townhouse/src/cli.ts`.** The `parseArgs` `switch (command)` block gains a new `case 'hs':` arm. `positionals[1]` selects the action: `'up'`, `'down'`. Unknown action prints `Usage: townhouse hs <up|down> [--rotate-keys] [--password <pw>] [-c <path>]` and exits 1. `townhouse --help` text is extended to list `townhouse hs up` and `townhouse hs down [--rotate-keys]`. The existing `townhouse up` / `townhouse down` (dev profile) commands are NOT touched — they remain the contributor dev-stack entrypoints.

2. **`townhouse hs up` starts EXACTLY two services on a fresh machine: `connector` and `townhouse-api` — apex-only.** No `town-*`, `mill-*`, or `dvm-*` containers start. The CLI invokes `materializeComposeTemplate('hs')` (writes `~/.townhouse/compose/townhouse-hs.yml` + `~/.townhouse/image-manifest.json` at mode `0o600`) then constructs `new DockerOrchestrator(docker, config, walletManager, { profile: 'hs', composePath })` and calls `orchestrator.up([])` (empty profile array — no `--profile` flags emitted, only the always-on services start per the HS template's profile gating). After completion, `docker ps --filter name=townhouse-hs-` MUST show exactly two containers: `townhouse-hs-connector` and `townhouse-hs-api`.

3. **`townhouse hs up` writes `~/.townhouse/connector.yaml` on first run with `anon.enabled: true`.** Before invoking the orchestrator, the CLI generates the connector config (mirrors the dev-path pattern in `DockerOrchestrator.startConnector` — `ConnectorConfigGenerator.toYaml`) but with the HS-specific overrides: `anon.enabled: true`, `anon.hiddenServiceDir: '/var/lib/anon/hs'` (matches the volume mount in `townhouse-hs.yml:86`), `transport.type: 'socks5'` with `managed: true` so the connector's in-process anon runtime publishes the descriptor. The file is written to `~/.townhouse/connector.yaml` with mode `0o600`. The HS compose template mounts this file at `/config/connector.yaml:ro`. **Idempotency contract:** if `~/.townhouse/connector.yaml` already exists AND was written by a prior `hs up` (signature: contains `anon.enabled: true`), it is reused verbatim; otherwise it is overwritten only when `--force` is passed. AC #6's idempotent re-run path MUST NOT regenerate the file (preserves operator edits to e.g. log level).

4. **The CLI prints a three-line rolling onboarding ribbon (UX-DR4) to stdout while the apex starts.** Sequence: `Pulling apex image…` → `Bootstrapping hidden service (this takes 30–90s)…` → `Apex live at <hostname>.anyone`. Implementation: a small in-package ribbon helper in `packages/townhouse/src/cli/onboarding-ribbon.ts` that uses ANSI cursor-up + line-clear escape sequences when `process.stdout.isTTY === true` AND `process.env.TERM` indicates unicode support (`TERM` matches `/xterm|screen|tmux/i` — fallback otherwise). On non-TTY OR non-unicode terminals, falls back to a simple ANSI spinner (`['|', '/', '-', '\\']` rotated every 100ms) followed by plain ASCII status lines (one line per phase, no in-place rewrite). When `process.env.NO_COLOR` is set OR `process.env.CI === 'true'`, animations are disabled and each phase prints once verbatim. The ribbon is a thin wrapper over the orchestrator's `pullProgress` and `containerState` events for the dev path — for the HS path, the events are coarser (`compose-up` etc.), so the ribbon is driven by deterministic phase transitions: phase 1 starts on `orchestrator.up()` invocation, phase 2 starts when the compose subprocess exits 0 (transitions to readiness polling), phase 3 fires on the first non-null `getHsHostname()` response.

5. **The CLI prints the published `.anyone` hostname as the FINAL stdout line.** Format: `Apex live at <hostname>.anyone` — exactly one trailing newline, no surrounding banner box, no color codes. The line is the last thing printed before the process either keeps running (foreground mode — see AC #11) or exits 0 (detached mode — see AC #11). The same hostname string is also written to `~/.townhouse/host.json` (see AC #6).

6. **`townhouse hs up` writes `~/.townhouse/host.json` after the hostname is published.** Schema: `{ hostname: '<onion>.anyone', publishedAt: '<ISO-8601-from-connector>', connectorAdminUrl: 'http://127.0.0.1:9401', townhouseApiUrl: 'http://127.0.0.1:28090', writtenAt: '<ISO-8601-now>' }`. Mode `0o600` (NFR8). Read by the future `townhouse hs status` and the dashboard SPA. If the file already exists (re-run path), it is overwritten atomically (write to `host.json.tmp` then `rename` — mid-write crash leaves the prior version intact).

7. **Idempotent re-run: `townhouse hs up` against an already-running apex re-prints the hostname and exits 0 with no side-effects.** Detection sequence (executed BEFORE materializing compose / starting orchestrator): (a) call `ConnectorAdminClient(http://127.0.0.1:9401, 5_000).getHsHostname()` with a 3-second connection timeout; (b) if it returns 200 with `hostname !== null`, the apex is running — print the existing onboarding ribbon's final line directly (`Apex live at <hostname>.anyone`), refresh `~/.townhouse/host.json` with the current hostname + `writtenAt`, and exit 0; (c) if it returns 503 (anon-disabled), exit 1 with Sally's anon-disabled copy; (d) if it errors with `ECONNREFUSED` / `connection refused`, treat as cold start and proceed to the full boot path. Re-run MUST NOT call `materializeComposeTemplate` (operator might have edited the YAML), MUST NOT call `docker pull`, MUST NOT call `docker compose up` again. Verified by an integration assertion: the `containerState` and `pullProgress` event counts are zero on a re-run.

8. **`townhouse hs down` stops the apex while preserving the `townhouse-hs-anon` volume.** Default behavior: `orchestrator.down()` on an `'hs'`-profile orchestrator invokes `docker compose -f <composePath> down` with NO `-v` flag (per Story 45.3 AC #9). The `townhouse-hs-anon` named volume holds the `.anyone` keypair — preservation means the next `hs up` re-publishes the SAME hostname. After `down` completes, `docker volume ls | grep townhouse-hs-anon` MUST still match. The CLI prints `Apex stopped. Volumes preserved — your .anyone address is stable.` as the final stdout line. The `~/.townhouse/host.json` file is NOT deleted (it's the persistent record of the address) — only `writtenAt` is updated to reflect the down event isn't relevant here; document this.

9. **`townhouse hs down --rotate-keys` deletes the `townhouse-hs-anon` volume so the next `hs up` produces a new `.anyone` address.** When `--rotate-keys` is passed, the CLI invokes `docker compose -f <composePath> down -v` (subprocess via `execFile`, NOT through the orchestrator's standard `down()` — the orchestrator's HS down path explicitly omits `-v` per Story 45.3 AC #9). The CLI then deletes `~/.townhouse/host.json` (`fs.rmSync(hostJsonPath, { force: true })`) so the stale hostname doesn't outlive the keypair. Confirmation prompt fires interactively (TTY): `WARNING: --rotate-keys will permanently delete your current .anyone address (<hostname>). The next 'hs up' will publish a new address. Continue? [y/N]`. Non-interactive (no TTY): the flag proceeds without prompt (operator scripted intent). `--password` does not affect `down` — included in usage line for completeness only.

10. **Wallet password sourcing follows the existing `handleUp` pattern.** Resolution order: `--password <pw>` flag → `process.env.TOWNHOUSE_WALLET_PASSWORD` → interactive prompt (only when `process.stdin.isTTY === true`). When stdin is not a TTY AND neither `--password` nor `TOWNHOUSE_WALLET_PASSWORD` is set, the CLI exits 1 with message `Wallet password required. Use --password flag or TOWNHOUSE_WALLET_PASSWORD env var.` (matches `cli.ts:486-489`). Interactive prompt uses Node's built-in `node:readline` with `terminal: true` and password masking via `terminal: true` + the `_writeToOutput` override pattern (NO new dependency — `inquirer`/`prompts`/`enquirer` are forbidden; `readline` mask pattern is already established). The decrypted mnemonic exists ONLY in the local scope of the `handleHsUp` function and is zeroed via `walletManager.lock()` in a `finally` block.

11. **Foreground vs. detached mode: the apex containers run detached (`compose up -d`), the host CLI exits after printing the hostname.** Story 45.3's HS orchestrator already passes `-d` to `docker compose up` — containers run detached. After the readiness gate fires and the hostname is printed, the CLI process exits 0. **The CLI does NOT keep a Node process alive to host an additional API.** The Fastify host API in HS mode runs INSIDE the `townhouse-api` Docker container (per `townhouse-hs.yml:99-141`), not on the host. Operators use `townhouse hs down` (or `docker compose -f ~/.townhouse/compose/townhouse-hs.yml down`) to stop. Open question for Story 48 (TUI): when the operator wants a foreground TUI, that's `townhouse` (no subcommand) with stdout-is-TTY detection — out of scope here. The CLI's SIGINT handler MUST NOT trigger `orchestrator.down()` — the operator's intent is interrupting the boot, not destroying the apex (different from dev-mode `townhouse up` which runs in foreground and tears down on Ctrl-C).

12. **Failure-state copy library (UX-DR5, partial — apex-side).** When the apex boot fails at any step, the CLI catches the thrown `OrchestratorError` (or wallet/config error) and renders Sally's failure-state copy keyed by error class. Implement an in-package copy library at `packages/townhouse/src/cli/failure-copy.ts` covering the four apex-side error classes named in Story 45.4's epic spec (UX-DR5 line 177): **anon timeout** (matches `OrchestratorError.message.includes('HS hostname publication timeout')`), **image pull failure** (matches `stderr.includes('failed to pull')` or `stderr.includes('pull access denied')`), **port collision** (matches `stderr.includes('address already in use')` or `stderr.includes('port is already allocated')`), **missing docker.sock** (matches `stderr.includes('Cannot connect to the Docker daemon')` or `error.code === 'ENOENT'` on `which docker`). Each entry has shape `{ headline: string, explanation: string, nextStep: string }` and is rendered as three lines on stderr followed by `process.exitCode = 1`. Errors not matching any class fall through to a generic copy `{ headline: 'Apex boot failed.', explanation: '<error.message>', nextStep: 'Run with DEBUG=townhouse:* for verbose logs.' }`. Three-line render format:
    ```
    ✕ <headline>
      <explanation>
      → <nextStep>
    ```
    Uses ASCII fallback `[X]`/`->` when `NO_COLOR` is set or unicode unsupported.

13. **The connector container does NOT mount `/var/run/docker.sock` (NFR7 enforcement).** This is enforced by the HS compose template (Story 45.2 — see `townhouse-hs.yml:73-96` — `volumes` block lists only the config and the anon volume, no docker socket). Story 45.4 adds an integration assertion: after `townhouse hs up` resolves, `docker inspect townhouse-hs-connector --format '{{json .HostConfig.Mounts}}'` MUST NOT contain `/var/run/docker.sock` in any mount source. Failure of this assertion fails the test. (The `townhouse-hs-api` container DOES mount the socket — that's correct, NFR7 only forbids the connector from accessing it.)

14. **All host-side ports bind to `127.0.0.1` only (NFR9 enforcement).** Already enforced by the HS compose template (Story 45.2 — `townhouse-hs.yml` lines 81, 120 use `127.0.0.1:<port>:<port>` form). Story 45.4 adds an integration assertion: after `hs up` resolves, `docker inspect townhouse-hs-connector --format '{{json .HostConfig.PortBindings}}'` and same for `townhouse-hs-api` — every binding's `HostIp` MUST equal `'127.0.0.1'`. No `'0.0.0.0'`, no empty string. Failure fails the test.

15. **5-minute apex-ready budget on cold cache (NFR1 enforcement).** Real-world: 50 Mbps connection, no images cached, fresh `~/.townhouse/`. Apex-ready means `getHsHostname()` returns `hostname !== null`. The 5-minute budget breaks down as: ≤3 min for the 5-image pull (Story 45.1 multi-arch images, ~1.5 GB total) + ≤90 s for anon HS bootstrap. The Story 45.3 orchestrator already enforces the 180_000 ms `docker compose up` subprocess timeout + 120_000 ms readiness poll — total upper bound is 300_000 ms (5 min) by construction. Story 45.4 adds NO additional timeout layers — the orchestrator's existing budgets are the contract. Smoke-verified manually before tagging the release; not a CI assertion (CI runners have warm GHCR caches and would over-promise).

16. **HS-up unit tests cover the CLI logic without invoking real Docker.** New test file `packages/townhouse/src/cli.hs.test.ts` (sibling of the existing `cli.test.ts`). Mocks: `vi.mock('node:fs')` for atomic writes + idempotency detection, a stub `DockerOrchestrator` (constructor-injectable factory) that resolves `up()` immediately and returns a stable hostname from a mocked `adminClientFactory`, a stub `materializeComposeTemplate` returning a fixture path. Required cases (every case must pass):
    - `townhouse hs up` on fresh state writes `~/.townhouse/connector.yaml` with `anon.enabled: true` (assert YAML content).
    - `townhouse hs up` on fresh state calls `materializeComposeTemplate('hs')` exactly once.
    - `townhouse hs up` on fresh state constructs orchestrator with `{ profile: 'hs', composePath }` and calls `up([])` (empty profile array).
    - `townhouse hs up` with `--password swordfish` does NOT prompt interactively.
    - `townhouse hs up` with no password and `process.stdin.isTTY === false` exits 1 with the password-required message.
    - `townhouse hs up` against a running apex (mocked `getHsHostname` returns non-null pre-call) skips materialize/orchestrator and re-prints the hostname.
    - `townhouse hs up` writes `~/.townhouse/host.json` with the published hostname.
    - `townhouse hs up` final stdout line is `Apex live at <hostname>.anyone`.
    - `townhouse hs down` invokes `docker compose -f <composePath> down` (no `-v`).
    - `townhouse hs down --rotate-keys` invokes `docker compose -f <composePath> down -v` AND deletes `~/.townhouse/host.json`.
    - `townhouse hs down --rotate-keys` with non-TTY stdin proceeds without prompt.
    - Anon-disabled `OrchestratorError` triggers Sally's failure copy with anon-timeout class.
    - Image-pull-failure stderr triggers Sally's failure copy with image-pull-failure class.
    - Port-collision stderr triggers Sally's failure copy with port-collision class.
    - Missing-docker.sock error triggers Sally's failure copy with missing-docker.sock class.
    - Unknown error falls through to the generic failure copy.

17. **HS-up integration test boots the real apex via the real CLI.** New test file `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts` (gated on `RUN_DOCKER_INTEGRATION === '1'` AND `SKIP_DOCKER !== '1'` — same pattern as `orchestrator-hs.test.ts`). Reuses the `runCli` and `waitForUrl` helpers from `_test-helpers.ts`. Test sequence:
    - `beforeAll`: create temporary `TOWNHOUSE_HOME` directory; set `TOWNHOUSE_WALLET_PASSWORD=integration-test`; ensure no leftover `townhouse-hs-*` containers from prior runs (`docker ps -aq --filter name=townhouse-hs- | xargs -r docker rm -f`); ensure no leftover volumes (`docker volume rm -f townhouse-hs-anon ... || true`).
    - Run `townhouse init --config-dir <tmp> --password integration-test`.
    - Run `townhouse hs up -c <tmp>/config.yaml`. Assert: exit 0, final stdout line matches `/^Apex live at [a-z2-7]+\.anyone$/`.
    - Assert `<tmp>/connector.yaml` exists with mode `0o600` and contains `anon.enabled: true`.
    - Assert `<tmp>/host.json` exists with mode `0o600` and parses to `{ hostname, publishedAt, ... }`.
    - Assert `docker ps --filter name=townhouse-hs- --format '{{.Names}}'` returns exactly two lines: `townhouse-hs-connector` and `townhouse-hs-api`.
    - Assert NFR7: `docker inspect townhouse-hs-connector` HostConfig.Mounts contains NO source `/var/run/docker.sock`.
    - Assert NFR9: every PortBindings entry on both containers has `HostIp: '127.0.0.1'`.
    - Run `townhouse hs up -c <tmp>/config.yaml` again (idempotent path). Assert: exit 0, final stdout line is the SAME hostname, no new containers created (compare `docker ps -q` count before/after).
    - Run `townhouse hs down -c <tmp>/config.yaml`. Assert: containers gone, `townhouse-hs-anon` volume STILL EXISTS.
    - Run `townhouse hs up -c <tmp>/config.yaml` again. Assert: SAME hostname (volume preserved → same keypair → same address).
    - Run `townhouse hs down --rotate-keys -c <tmp>/config.yaml` (with `process.stdin.isTTY === false` so no prompt). Assert: containers gone, volume gone, `<tmp>/host.json` gone.
    - Run `townhouse hs up -c <tmp>/config.yaml` again. Assert: DIFFERENT hostname (new keypair).
    - `afterAll`: cleanup containers + volumes + tmpdir.

18. **No changes to `packages/town/`, `packages/mill/`, `packages/dvm/`, `packages/sdk/`, or any package outside `packages/townhouse/`.** This is a pure-CLI story. The compose template is frozen (Story 45.2). The orchestrator is frozen (Story 45.3 — `OrchestratorError`, `profile`, `getHsHostname()` consumed as-is). No connector-side changes (the `GET /admin/hs-hostname` endpoint already ships in connector v3.5.0+ at the digest pinned by `DEFAULT_CONNECTOR_IMAGE`). If the dev finds themselves opening files outside `packages/townhouse/`, `CLAUDE.md`, or `_bmad-output/`, stop — that's outside scope.

19. **README + CLAUDE.md updates document the new command.** Append a new section to `packages/townhouse/README.md` titled "HS Mode (Apex Install)" covering: (a) `npx @toon-protocol/townhouse hs up` first-run flow, (b) the four files the command writes (`config.yaml`, `wallet.enc`, `compose/townhouse-hs.yml`, `connector.yaml`, `host.json`) with their modes, (c) idempotent re-run semantics, (d) `hs down` vs. `hs down --rotate-keys` distinction, (e) password sourcing precedence, (f) the failure-copy library entries (one row per class). Add one row to `CLAUDE.md` "Where to Find Things" pointing at `packages/townhouse/src/cli.ts` `handleHsUp` / `handleHsDown` as the new entry points.

20. **Sprint-status update.** AFTER PR merges AND `pnpm --filter @toon-protocol/townhouse test`, `test:integration` (with `RUN_DOCKER_INTEGRATION=1`), AND `test:canary` are all green: update `_bmad-output/implementation-artifacts/sprint-status.yaml` `45-4-townhouse-hs-up-subcommand-apex-only-boot: ready-for-dev → done` (mirror Story 45.3 close-out style — include PR number in trailing comment). Bump `last_updated`. Story 46.1 (`nodes.yaml` schema + boot reconciler) unblocks immediately on this merge — flag it to the next planner pass.

## Tasks / Subtasks

- [x] **Task 1: Cross-read prior art + Story 45.3 outputs** (AC: #2, #11, #18)
  - [x] 1.1 Re-read `_bmad-output/implementation-artifacts/45-3-docker-orchestrator-profile-param.md` "Dev Notes → What This Story Does NOT Do" (lines 842-855). Confirm boundary: Story 45.3 owns the orchestrator API + `OrchestratorError` + `getHsHostname()`; Story 45.4 (this) owns the CLI subcommand, the wallet-password prompt, the apex-ready stdout messaging, the `~/.townhouse/host.json` write, the `--rotate-keys` flag handling, and the connector config generation with `anon.enabled: true`. Do not reach into `orchestrator.ts` for behavioral changes — if the orchestrator surface is missing something needed, that's a Story 45.3 follow-up patch not a Story 45.4 modification.
  - [x] 1.2 Read `packages/townhouse/src/docker/orchestrator.ts` lines 165-189 (`OrchestratorError` class) end-to-end. Memorize the four optional fields (`service`, `exitCode`, `stderr`, `cause`) — Sally's failure copy library reads `error.message` AND `error.stderr` to classify. The `cause` field carries the original `Error` for debug logging; do NOT print it to operator-facing stdout/stderr.
  - [x] 1.3 Read `packages/townhouse/src/docker/orchestrator.ts` lines 320-447 (`upHs`, `surfaceComposeFailure`, `waitForHsHostname`). The orchestrator emits `containerState { name, state: 'error', detail }` events on subprocess failure (AC #6 of 45.3); the CLI MUST attach a listener to surface these as Sally's copy. Detail string is already truncated to 500 chars upstream — do not re-truncate.
  - [x] 1.4 Read `packages/townhouse/src/connector/admin-client.ts` lines 91-156 (`getHsHostname()`) end-to-end. Confirm 503 errors throw `Error('connector is anon-disabled (HTTP 503)')` (line 110) — Sally's anon-disabled copy matches on this exact substring. Network errors throw `Error('Connector admin API connection refused: ...')` (line 107) — the idempotency probe (AC #7) catches this and treats it as cold-start signal.
  - [x] 1.5 Read `packages/townhouse/compose/townhouse-hs.yml` end-to-end. Memorize: connector + townhouse-api are always-on (no `profiles:` declaration), `town`/`mill`/`dvm` are profile-gated. Volume `townhouse-hs-anon` mounted at `/var/lib/anon/hs` in the connector — preserved by default `down`, deleted by `down -v`. Both host ports `9401` (connector admin) and `28090` (townhouse-api Fastify) bind on `127.0.0.1`. Connector reads its config from `/config/connector.yaml:ro` (Story 45.4 writes this).
  - [x] 1.6 Read `packages/townhouse/src/cli.ts` end-to-end (~840 lines). Memorize the existing patterns: `parseArgs` setup (line 700), `case 'up'` handler for the dev path (line 790), `handleUp` body (line 455 — wallet password resolution at lines 484-489 is the canonical pattern Task 4 mirrors), the SIGINT handler structure (line 530 — note Story 45.4's HS path does NOT install one per AC #11). The `DEFAULT_CONFIG_DIR` and `DEFAULT_CONFIG_PATH` constants (lines 81-82) are reused for the `~/.townhouse/` resolution.
  - [x] 1.7 Read `packages/townhouse/src/connector/config-generator.ts` `toYaml()` (lines 114-153) and `buildConnectorTransportBlock()` (lines 162-198). The dev path in `DockerOrchestrator.startConnector()` (orchestrator.ts:964-1006) calls `configGenerator.generate(this.activeNodes)` then `configGenerator.toYaml(runtimeConfig)` to render the YAML. The HS path (Task 3) reuses these methods but with a different transport block construction — see Task 3.2 for the exact override.
  - [x] 1.8 Read `packages/townhouse/src/compose-loader.ts` `materializeComposeTemplate()` (lines 146-222). Confirm: returns `{ composePath, manifestPath }`; writes both files at mode `0o600`; refuses to overwrite via symlinks; refuses to materialize into system directories. Story 45.4 calls `materializeComposeTemplate('hs', { townhouseHome: configDir })` where `configDir` is the resolved `~/.townhouse/` (or `--config-dir <path>` override).

- [x] **Task 2: Wire `townhouse hs <up|down>` into `cli.ts`** (AC: #1)
  - [x] 2.1 In `packages/townhouse/src/cli.ts`, add `case 'hs':` to the `parseArgs` switch (after the existing `case 'metrics':` on line 812). Read `positionals[1]` as the action. Switch on action: `'up'` → call `handleHsUp`; `'down'` → call `handleHsDown`; default → print usage line `Usage: townhouse hs <up|down> [--rotate-keys] [--password <pw>] [-c <path>]` to stderr and set `process.exitCode = 1`.
  - [x] 2.2 Add a `'rotate-keys'` boolean option to the `parseArgs` `options` block (around line 712). Update the `HELP_TEXT` constant (line 58) to include two new lines: `townhouse hs up [--password <pw>] [-c <path>]                Boot apex (connector + .anyone HS)` and `townhouse hs down [--rotate-keys] [-c <path>]               Stop apex (--rotate-keys deletes .anyone keypair)`.
  - [x] 2.3 Define two new top-level handlers `handleHsUp` and `handleHsDown` (alongside `handleUp`/`handleDown` — keep them in the same file, after `handleDown` closes around line 690). Both receive `(configPath: string, config: TownhouseConfig, docker: Docker, options: { password?: string; rotateKeys?: boolean; configDir: string })`. Wire the call site in the `'hs'` case to construct the options bag and resolve `configDir = dirname(configPath)`.
  - [x] 2.4 Smoke: run `pnpm --filter @toon-protocol/townhouse test cli` after the wiring lands — the existing `cli.test.ts` MUST stay green (the `'hs'` case is additive and does not affect existing routes).

- [x] **Task 3: Generate `~/.townhouse/connector.yaml` with `anon.enabled: true`** (AC: #3)
  - [x] 3.1 Add a new file `packages/townhouse/src/connector/hs-config-writer.ts` exporting `writeHsConnectorConfig(configDir: string, config: TownhouseConfig, options: { force?: boolean }): { yamlPath: string; created: boolean }`. The function:
    - Resolves `yamlPath = join(configDir, 'connector.yaml')`.
    - If `existsSync(yamlPath)` AND parsed YAML has `anon.enabled === true` AND `options.force !== true`: returns `{ yamlPath, created: false }` (idempotent reuse).
    - Otherwise: constructs the runtime config via `new ConnectorConfigGenerator(config).generate([])`, overrides the transport block with HS settings, adds `anon: { enabled: true }`, renders via `yamlStringify`, writes with mode `0o600` then `chmodSync`. Returns `{ yamlPath, created: true }`.
  - [x] 3.2 Add unit tests `hs-config-writer.test.ts`: (a) writes mode-0o600 file on fresh dir, (b) preserves existing file when YAML has `anon.enabled: true`, (c) overwrites when `force: true`, (d) overwrites when existing file lacks the marker (treats as legacy/non-HS file), (e) defensive re-chmod verified by forcing wrong mode then re-writing.
  - [x] 3.3 Export `writeHsConnectorConfig` from `packages/townhouse/src/connector/index.ts` (barrel).

- [x] **Task 4: Implement `handleHsUp`** (AC: #2, #4, #5, #6, #7, #10, #11, #12)
  - [x] 4.1 Resolve wallet password via the existing pattern. `promptPassword()` helper in `cli/password-prompt.ts` uses `node:readline` with `_writeToOutput` masking. Reject (exit 1) when stdin is not TTY AND no password provided. `walletManager.lock()` in a `finally` block.
  - [x] 4.2 Idempotency probe (AC #7): construct admin client with 3-second timeout. On non-null hostname: re-print hostname, refresh `host.json`, exit 0. On 503 (anon-disabled): render Sally's copy, exit 1. On ECONNREFUSED: proceed to cold-boot. Skip probe when `--force` is passed.
  - [x] 4.3 Cold-boot path: `writeHsConnectorConfig` → `materializeComposeTemplate('hs')` → construct orchestrator → wire ribbon events → `orchestrator.up([])`.
  - [x] 4.4 After `up()` resolves, re-fetch hostname via admin client (to get `publishedAt` for host.json schema).
  - [x] 4.5 Atomically write `~/.townhouse/host.json` via `writeFileSync(tmp)` + `renameSync(tmp, final)` with mode 0o600.
  - [x] 4.6 Ribbon `start('live', hostname)` prints the final stdout line. Exit 0.
  - [x] 4.7 Wrap in try/catch routing to `renderFailure()`. `process.exitCode = 1` on failure.

- [x] **Task 5: Implement onboarding ribbon (UX-DR4)** (AC: #4)
  - [x] 5.1 Created `packages/townhouse/src/cli/onboarding-ribbon.ts` with `OnboardingRibbon` class exporting `start(phase, detail?)` and `stop()`. ANSI cursor-up + line-clear when TTY + unicode.
  - [x] 5.2 Fallback (non-TTY, NO_COLOR, CI): plain line per phase, spinner via `setInterval` cleared on `stop()`.
  - [x] 5.3 Wired in `handleHsUp`: ribbon before `up()`, `containerState` listener transitions to bootstrap, `live` after hostname fetch, `stop()` in `finally`.
  - [x] 5.4 Unit tests `onboarding-ribbon.test.ts`: 8 cases covering TTY+unicode, non-TTY, NO_COLOR, CI, stop() timer cleanup.

- [x] **Task 6: Implement Sally's failure-state copy library (UX-DR5, partial)** (AC: #12)
  - [x] 6.1 Created `packages/townhouse/src/cli/failure-copy.ts` exporting `renderFailure(error: unknown): { exitCode: number }`. Classifies error, writes 3 lines to stderr, returns `{ exitCode: 1 }`.
  - [x] 6.2 `FAILURE_COPY` map covers `anon-timeout`, `anon-disabled`, `image-pull-failure`, `port-collision`, `missing-docker-sock`, `generic`.
  - [x] 6.3 Classification: OrchestratorError + anon-disabled message → anon-timeout class (AC #16 spec); plain Error + anon-disabled → anon-disabled class. ASCII fallback via NO_COLOR check.
  - [x] 6.4 Unit tests `failure-copy.test.ts`: 14 cases covering all classes + ASCII fallback.

- [x] **Task 7: Implement `handleHsDown`** (AC: #8, #9)
  - [x] 7.1 `materializeComposeTemplate('hs', { townhouseHome: configDir })` (idempotent) to get composePath.
  - [x] 7.2 `--rotate-keys` + TTY stdin: confirmation prompt via readline. On non-TTY: proceed without prompt.
  - [x] 7.3 `--rotate-keys` path: `_runDockerComposeDown(composePath, true)` (spawn-based, passes `-v`). Then `rmSync(host.json, { force: true })`. Prints "Volumes deleted" message.
  - [x] 7.4 Default path: `DockerOrchestrator.down()` (no `-v`). Prints "Volumes preserved" message.
  - [x] 7.5 try/catch routing to `renderFailure()`.

- [x] **Task 8: Unit tests** (AC: #16)
  - [x] 8.1 Created `packages/townhouse/src/cli.hs.test.ts`. Extended `main()` with a 4th `hsOverrides?: CliHsOverrides` parameter for DI. `makeHsOverrides()` factory creates stubs with configurable probe/cold-boot/failure behaviors.
  - [x] 8.2 19 test cases implemented covering all AC #16 scenarios plus additional edge cases.
  - [x] 8.3 `password-prompt.test.ts`: structural tests confirming export; TTY interaction tested via `cli.hs.test.ts` (`--password` flag and non-TTY rejection cases).
  - [x] 8.4 All 19 cli.hs.test.ts cases green. Full suite: 808 pass, 11 pre-existing failures (earnings/logs routes, unrelated to Story 45.4).

- [x] **Task 9: Integration test** (AC: #17)
  - [x] 9.1 Created `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts`. Skip-gated on `RUN_DOCKER_INTEGRATION === '1'` AND `SKIP_DOCKER` unset.
  - [x] 9.2 `beforeAll`: tmpdir, env-var setup, container/volume cleanup. `afterAll`: best-effort `docker compose down -v` + tmpdir removal.
  - [x] 9.3 12-step sequence: init → hs up (exit 0, hostname regex) → 2 containers → connector.yaml → host.json → NFR7 (no docker.sock) → NFR9 (127.0.0.1 only) → idempotent re-run → hs down (volume preserved) → re-up (same hostname) → rotate-keys (volume+host.json deleted) → re-up (new hostname).
  - [x] 9.4 Gated — requires `dist/image-manifest.json` from CI. Run: `RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- townhouse-hs-up`.
  - [x] 9.5 Afterall cleanup handles volume removal race conditions.

- [x] **Task 10: Update docs** (AC: #19)
  - [x] 10.1 Appended "HS Mode (Apex Install)" section to `packages/townhouse/README.md` between DockerOrchestrator Profiles and the legacy hidden-service section. Covers: first-run flow, 6-file table with modes, idempotent re-run, down vs. rotate-keys, password sourcing, and failure-copy table.
  - [x] 10.2 Added row to `CLAUDE.md` "Where to Find Things": `| Townhouse \`hs up\`/\`hs down\` CLI subcommand | \`packages/townhouse/src/cli.ts\` \`handleHsUp\` / \`handleHsDown\` |`.
  - [x] 10.3 Verified README content accuracy against implementation.

- [ ] **Task 11: Validate, commit, open PR, update sprint status** (AC: #20)
  - [ ] 11.1 Run the full Townhouse test suite locally (build + unit + canary + integration) — all green before PR.
  - [ ] 11.2 Run `pnpm lint && pnpm format` — clean.
  - [ ] 11.3 Smoke: from a fresh tmpdir, run `init` → `hs up` → assert stdout line → inspect `host.json` → `hs down` → re-up → assert same hostname.
  - [ ] 11.4 Stage + commit + PR.
  - [ ] 11.5 After PR merges: flip sprint-status to `done` with PR number comment.
  - [ ] 11.6 This story file Status: `review` (now, on PR open) → `done` (after merge).

## Dev Notes

### Cross-Repo Boundary

This story is **town-only**. No connector-side code changes. No SDK changes. No Mill/DVM/Town package changes. The `GET /admin/hs-hostname` endpoint already ships in the connector image at the digest pinned by `DEFAULT_CONNECTOR_IMAGE` (`packages/townhouse/src/constants.ts:26-27` — `sha256:4a24ccb0...`, connector v3.5.0+). The `townhouse-hs.yml` compose template (Story 45.2 deliverable) is frozen — Story 45.4 ONLY consumes it via `materializeComposeTemplate('hs')`. The `DockerOrchestrator` profile API and `OrchestratorError` (Story 45.3 deliverables) are frozen — Story 45.4 ONLY consumes them as a caller.

Files this story touches in `toon-protocol/town`:

- `packages/townhouse/src/cli.ts` (MODIFY — add `'hs'` case to parseArgs switch, add `'rotate-keys'` option, add `handleHsUp` and `handleHsDown` handlers, extend HELP_TEXT)
- `packages/townhouse/src/connector/hs-config-writer.ts` (NEW — `writeHsConnectorConfig` helper)
- `packages/townhouse/src/connector/hs-config-writer.test.ts` (NEW — unit tests for the writer)
- `packages/townhouse/src/connector/index.ts` (MODIFY — barrel export of `writeHsConnectorConfig`)
- `packages/townhouse/src/cli/onboarding-ribbon.ts` (NEW — UX-DR4 ribbon)
- `packages/townhouse/src/cli/onboarding-ribbon.test.ts` (NEW)
- `packages/townhouse/src/cli/failure-copy.ts` (NEW — UX-DR5 partial, apex-side error classes)
- `packages/townhouse/src/cli/failure-copy.test.ts` (NEW)
- `packages/townhouse/src/cli/password-prompt.ts` (NEW — `node:readline`-based password prompt with masking)
- `packages/townhouse/src/cli/password-prompt.test.ts` (NEW)
- `packages/townhouse/src/cli.hs.test.ts` (NEW — CLI subcommand integration unit tests, ~16 cases)
- `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts` (NEW — Docker integration test, 12-step sequence, skip-gated)
- `packages/townhouse/README.md` (MODIFY — append "HS Mode (Apex Install)" section)
- `CLAUDE.md` (MODIFY — add one row to "Where to Find Things")
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFY — Task 11.5)
- This story file (Task 11.6)

Files this story does **NOT** touch (scope guards):

- `packages/townhouse/src/docker/orchestrator.ts` — Story 45.3 deliverable. `OrchestratorError`, `profile`, `composePath`, `getHsHostname()` polling, stderr parsing — all frozen. If Story 45.4 needs a behavioral change here, that's a Story 45.3 follow-up patch, not a 45.4 modification. (Particular trap: do NOT add a SIGINT handler to `upHs()` to "improve" interrupt handling — Story 45.4's CLI exits after printing the hostname, so SIGINT during the long boot is the operator killing the CLI process; the detached `compose up -d` behavior means containers continue starting independently. That's acceptable behavior — `townhouse hs down` cleans up later.)
- `packages/townhouse/compose/townhouse-hs.yml` — Story 45.2 deliverable. The service set, volume names, port bindings, healthcheck commands, environment variable passthroughs are frozen.
- `packages/townhouse/src/compose-loader.ts` — Story 45.2 deliverable. The `loadComposeTemplate` / `materializeComposeTemplate` / `ComposeLoaderError` API is frozen.
- `packages/townhouse/src/constants.ts` `DEFAULT_CONNECTOR_IMAGE` — frozen at the digest Story 45.2 captured.
- `packages/townhouse/src/connector/admin-client.ts` `getHsHostname()` — Story 45.3 deliverable. The 503 anon-disabled error message string `'connector is anon-disabled (HTTP 503)'` is the contract Sally's failure copy matches against — do NOT alter it.
- `packages/townhouse/src/wallet/` — Story 21.4 deliverable. The wallet manager API (`generate`, `fromMnemonic`, `lock`, `getNodeKeys`, `getAllKeys`) is reused as-is. No new methods.
- `packages/townhouse/src/api/` — host API server. Runs INSIDE the `townhouse-api` Docker container in HS mode (per `townhouse-hs.yml:99-141`); host-side process is NOT involved. Story 45.4 does not start any Fastify server on the host — that's a different lifecycle.
- `packages/townhouse/src/api/wizard-server.ts` — Story 21.14 first-run wizard. Drew's HS mode bypasses the wizard entirely (he runs `init` + `hs up` from the terminal). The wizard is for the SPA-driven onboarding flow.
- `packages/town/`, `packages/mill/`, `packages/dvm/`, `packages/sdk/`, `packages/connector/` — out of scope.
- `scripts/townhouse-dev-infra.sh` and `scripts/townhouse-test-infra.sh` — both are dev-stack tooling. The HS mode is operator-facing, not contributor-facing. The integration test (Task 9) drives the CLI directly, not via these scripts.
- `docker-compose-townhouse-hs.yml` (root) — legacy operator-facing compose. The HS mode reads from `~/.townhouse/compose/townhouse-hs.yml` (materialized from the package-embedded template).
- `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` — planning doc; do NOT modify story ACs while implementing them.

### Why The CLI Exits After Printing the Hostname (Detached Mode)

Story 45.3's HS orchestrator passes `-d` (detached) to `docker compose up`. Containers continue running after the host CLI process exits. This is intentional and matches Drew's mental model from running `docker compose up -d` manually:

- `townhouse hs up` is the *install* verb — it provisions the apex and confirms it's live, then returns control.
- `townhouse hs down` is the explicit teardown — operators stop the apex when they're done with it, not by Ctrl-C'ing a foreground process.
- The Fastify host API runs inside the `townhouse-api` container (`townhouse-hs.yml:99-141`), bound to `127.0.0.1:28090`. The future TUI (Epic 48) connects to this API as a separate process (`townhouse` with no subcommand, stdout-is-TTY → spawn TUI).

This is the divergence from `townhouse up` (the dev-path command): dev mode runs in foreground because the dev API server lives on the host. HS mode runs detached because the API server lives in a container. The CLI MUST NOT install a SIGINT handler that calls `orchestrator.down()` — doing so would cause `Ctrl-C during boot` to tear down the apex the operator just spent 5 minutes provisioning. Story 45.4's SIGINT semantic: the operator is interrupting the *CLI process*, not the apex.

### Why `~/.townhouse/connector.yaml` Is Generated By the CLI (Not the Compose Template)

The compose template (`townhouse-hs.yml:84`) declares `~/.townhouse/connector.yaml:/config/connector.yaml:ro` — the connector mounts the operator's config file readonly. The compose template does NOT generate this file (it can't — Compose has no first-class file-templating; we'd need a separate `init-config` container). Story 45.4 owns the generation step, mirroring the dev-path's `DockerOrchestrator.startConnector()` (orchestrator.ts:964-1006) which writes `connector.yaml` next to `wallet.enc` before starting the container.

The HS-specific overrides:

- `anon.enabled: true` — turns on the connector's in-process anon runtime.
- `transport.type: 'socks5'`, `managed: true`, `managedOptions: { hiddenServiceDir: '/var/lib/anon/hs', hiddenServicePort: 3000 }` — tells the connector to publish a v3 hidden service (managed by anon, not an external sidecar).
- `transport.externalUrl: 'auto'` — the connector resolves this from `${hiddenServiceDir}/hostname` after first publication.

The dev-path config-generator (`config-generator.ts:114-153`) handles most of this for the `mode: 'ator'` case (lines 168-189) — Story 45.4 passes a `TownhouseConfig` with `transport.mode: 'ator'` AND `transport.hiddenService: { dir: '/var/lib/anon/hs', port: 3000 }` set, and the existing `buildConnectorTransportBlock` produces the right shape. The only Story 45.4 addition is the top-level `anon: { enabled: true }` field — verify the connector image actually reads this (cross-reference with the connector's config schema: `anon.enabled` is the v3.5.0+ flag).

### Why Sally's Failure Copy Is In-Package (Not a Separate Artifact)

UX-DR5 (failure-state copy library) is a 7-deliverable design artifact in Sally's plan. The full library spans Epic 45 (anon timeout, image pull, port collision, missing docker.sock), Epic 46 (image pull failure during `node add`, registration drift), and Epic 48 (rendering when API is unreachable). For Story 45.4, we ship the apex-side subset (4 classes + generic fallback) as a co-located TS module — this avoids creating a `_bmad-output/design/empty-state-copy.md`-style artifact for code that's read at runtime. The merge-gate convention from Story 48.1 (`design/empty-state-copy.md` populated + Sally signoff before TUI scaffold ships) does NOT apply here — that gate is for the TUI's empty states, not for CLI failure copy.

If Sally lands a separate `failure-state-copy.md` artifact during this story's review window, fold its content into `failure-copy.ts` verbatim (string identity required so the artifact and code stay in sync). For now, Story 45.4 ships the strings inline.

### Why `host.json` Atomic Write (Tmp + Rename)

`~/.townhouse/host.json` is read by future commands (`townhouse hs status`) and the dashboard SPA. A mid-write crash (e.g., disk full, kill -9) leaving a torn JSON file would surface as a parse error in those readers. The atomic-write pattern (`fs.writeFileSync(tmp, content)` then `fs.renameSync(tmp, final)`) ensures the reader either sees the prior version or the new version, never an in-between. Same pattern the SDK uses for arweave manifest writes (cross-reference: `packages/sdk/src/arweave/turbo-adapter.ts` write-then-rename pattern).

### Failure-Surfacing Contract: How CLI + Orchestrator + Sally's Copy Compose

The flow on a failed boot:

1. `orchestrator.up([])` invokes `docker compose -f <composePath> up -d`.
2. Subprocess fails (e.g., port 9401 already in use).
3. `surfaceComposeFailure(stderr)` (orchestrator.ts:385-409) parses stderr for service-name patterns. Emits `containerState { name: 'connector', state: 'error', detail: '<stderr-snippet>' }`.
4. Throws `OrchestratorError` with `service: 'connector'`, `exitCode: 1`, `stderr: '<full-stderr>'`, `cause: <original Error>`.
5. CLI's outer try/catch in `handleHsUp` catches the `OrchestratorError`.
6. `renderFailure(error)` classifies — matches `'address already in use'` in `error.stderr` → port-collision class → renders Sally's three-line copy to stderr.
7. `process.exitCode = 1`, ribbon's `finally` calls `ribbon.stop()` to clean up the terminal.

The `containerState` events emitted in step 3 are also captured by the ribbon listener (Task 5.3) — they cause the ribbon to transition to a "failure" rendering state (ribbon stops the spinner; failure copy renders below). This means a failing boot prints: ribbon-pull-line → ribbon-bootstrap-line → (failure event fires, ribbon stops) → Sally's three-line failure copy on stderr. Clean handoff.

### Architecture Compliance

- **NFR1 (5-min apex-ready):** Inherits Story 45.3's `180s` compose-up timeout + `120s` readiness poll = 5-minute upper bound by construction. Story 45.4 adds NO new timeout layers.
- **NFR2 (TUI refresh latency):** Out of scope (Story 48 owns the TUI). CLI is a one-shot install verb.
- **NFR7 (no docker.sock in connector):** Enforced by the HS template (Story 45.2). Story 45.4 adds an integration assertion (AC #13) — the connector container's mounts MUST NOT contain `/var/run/docker.sock`.
- **NFR8 (operator-secret files at 0o600):** All four Story 45.4 writes (`connector.yaml`, `host.json`, `compose/townhouse-hs.yml` via materializeComposeTemplate, `image-manifest.json` via materialize) are 0o600. The `wallet.enc` was already 0o600 from `townhouse init` (Story 21.4 + 21.14).
- **NFR9 (host ports bind 127.0.0.1 only):** Enforced by the HS template. Story 45.4 adds an integration assertion (AC #14).
- **NFR15 (Node ≥20, ESM-only):** All new code uses ESM imports with `.js` extensions. No `require()`. `node:readline` for the password prompt is stable in Node 20.
- **NFR17 (pre-publish quality gate):** This story extends the gate — `cli.hs.test.ts` joins the unit-test green requirement; `townhouse-hs-up.test.ts` joins the real-CLI E2E requirement (already gated by `RUN_DOCKER_INTEGRATION`).
- **NFR19 (empty-state copy ships in same PR as scaffold):** Apex-side analog: Sally's failure copy library ships in the same PR as the CLI scaffold. Hard merge requirement on this PR.
- **OWASP A01 (broken access control):** All host ports bind `127.0.0.1` only. `~/.townhouse/host.json` and `connector.yaml` written 0o600.
- **OWASP A03 (injection):** All `docker compose` invocations use `execFile(file, args[])`. Confirmation prompt `readline.question` does not interpolate the answer into a shell command.
- **OWASP A04 (insecure design):** The CLI's idempotency probe (AC #7) explicitly checks for an already-running apex BEFORE re-pulling images — prevents unnecessary network I/O AND prevents accidentally interrupting a healthy apex.
- **OWASP A09 (security logging failures):** Sally's failure copy writes `error.message` to stderr, NOT `error.stderr` verbatim (which may contain env vars from Compose). The `--debug` / `DEBUG=townhouse:*` opt-in is the only way to dump full stderr.

### Critical Implementation Patterns

- **The CLI is a thin client.** Per Architecture Anchor #5 (`epics-townhouse-hs-v1.md:136`): "CLI is a thin client of the host API. Both terminal and any future SPA/Tauri surface hit `127.0.0.1:28090` endpoints — one code path, multiple front-ends." Story 45.4 honors this by NOT duplicating the orchestrator state — it constructs an orchestrator instance, drives it once, and exits. The SPA at `127.0.0.1:28090` (running inside `townhouse-api`) is the long-running stateful surface.
- **No `townhouse-api` host process.** Unlike `townhouse up` (dev mode), `townhouse hs up` does NOT start a Fastify server on the host. The Fastify API in HS mode runs inside the `townhouse-api` container (per `townhouse-hs.yml:110-141`). The CLI's job is just to bring the containers up and exit.
- **No new dependencies.** `node:readline` for password prompt (built-in). `node:child_process.execFile` for the rotate-keys path (built-in, already used by orchestrator). No `inquirer`/`prompts`/`enquirer`/`ora`/`chalk` — all UI primitives ship as ANSI escape strings inline.
- **`process.exit()` vs. `process.exitCode`.** Use `process.exitCode = 1` then `return` from the handler — let the `main()` function complete naturally. Calling `process.exit(1)` skips Vitest's afterEach hooks during testing and also prevents the `finally` block from running cleanly.
- **`node:readline` masking pattern.** The canonical password-mask trick: override `_writeToOutput` on the readline interface so it writes `*` for each character instead of the actual char. Be sure to restore the original `_writeToOutput` in a `finally` (otherwise subsequent `console.log` calls from the same interface get masked too).
- **`materializeComposeTemplate` is idempotent.** Both `hs up` and `hs down` call it (down needs the path). The function safely overwrites the YAML each time (mode 0o600, defensive chmod, symlink-rejection). Don't add a "skip if exists" branch — the file is operator-overwritable on purpose; we re-render to track digest pin updates after `npm install @toon-protocol/townhouse@latest`.
- **Don't follow `pullProgress` events for HS path.** Per Story 45.3 Dev Notes ("Why Dual Paths"), the HS path uses Compose subprocess which forwards `docker pull` output via `inheritStdio: true` directly to the user's TTY. The orchestrator does NOT emit per-image `pullProgress` events for the HS path (only the dev path does). The ribbon's "phase 1" rendering is therefore time-based / event-based on `containerState`, not `pullProgress`.
- **`townhouse hs up --force` semantic.** When `--force` is passed: skip the idempotency probe AND overwrite `~/.townhouse/connector.yaml` even if it exists. This is the "I edited my connector.yaml and want to revert to defaults" escape hatch. Document in README.
- **Confirmation prompt with non-TTY proceed semantic.** `--rotate-keys` on non-TTY (CI, scripted) skips the confirmation. This is consistent with how `git rebase --autosquash` and `cargo publish` handle it: explicit flag = explicit intent. Document in README.

### Sequencing Within Epic 45

```
   45.1 (DONE) ──→ 45.2 (DONE) ──→ 45.3 (review)
       │              │              │
       └────────── (digests, manifest, compose, profile orchestrator) ─→ 45.4 (this) ──→ 46.1
```

- **45.1 produced:** `image-manifest.json` (digest manifest for 4 townhouse-owned images + connector pin), four signed multi-arch GHCR images.
- **45.2 produced:** `loadComposeTemplate` / `materializeComposeTemplate` API, embedded compose templates in npm tarball, digest-pinned `DEFAULT_CONNECTOR_IMAGE` constant, contract canary.
- **45.3 produced:** `DockerOrchestrator` `profile: 'dev' | 'hs'` parameter, `OrchestratorError` class, `getHsHostname()` admin-client method, HS-path subprocess invocation + readiness gate.
- **45.4 (this) consumes:** all of the above. Adds: `townhouse hs up` / `townhouse hs down` / `--rotate-keys` CLI surface, connector.yaml generator with `anon.enabled: true`, host.json persistence, onboarding ribbon (UX-DR4), apex-side failure copy library (UX-DR5 partial), idempotent re-run path.
- **46.1 unblocks:** `nodes.yaml` schema + boot reconciler. Drew can run `townhouse node add town` once 46.1 lands; the apex must already be running (this story).

### Latest Tech (Verified 2026-05-10)

- **Node `node:readline` password masking:** stable. Use `readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })`, then before calling `rl.question(...)` override `rl._writeToOutput = (str) => rl.output.write('*'.repeat(str.length))`. Restore in `finally`. Emit a final `\n` manually (the prompt swallows the user's Enter).
- **`docker compose down -v` semantic:** removes named volumes declared in the compose file. The `townhouse-hs-anon` volume is named in `townhouse-hs.yml:58`, so `down -v` removes it. The `compose/townhouse-hs.yml` template's `townhouse-hs-town-data`, `townhouse-hs-mill-data`, `townhouse-hs-dvm-data` volumes are also removed by `-v` — this is fine for Story 45.4 (apex-only boot doesn't write to them; if Drew later adds a Town node and rotates keys, the town data is wiped along with the keypair, which is the documented destructive opt-out).
- **`TERM` detection for unicode support:** the conventional check `process.env.TERM` matches against `/xterm|screen|tmux/i`. Modern terminals also set `COLORTERM` to `truecolor` — combining both checks gives unicode confidence. `process.env.TERM === 'dumb'` is the explicit "no ANSI" signal.
- **`NO_COLOR` env var convention** ([no-color.org](https://no-color.org/)): when set to ANY non-empty value, all ANSI color/style escape sequences are disabled. Animation should also be disabled (covers CI logs scrubbing).
- **`dockerode` 4.0+ `listImages()` `RepoDigests` field:** already shipped (Story 45.2 R1 patch). Story 45.4 doesn't pull images programmatically — Compose handles it — so this is informational only.
- **Connector v3.5.0+ `GET /admin/hs-hostname` contract:** documented in `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` (Story 44.4). Returns 200 with `{hostname: string|null, publishedAt: string|null}`; 503 with `{error: 'anon-disabled'}` body when `anon.enabled: false`.

### What This Story Does NOT Do (scope guard)

- **Does NOT add a `townhouse hs status` subcommand.** That's a future enhancement — `cat ~/.townhouse/host.json` is the current way to read the apex state. The TUI (Epic 48) replaces it.
- **Does NOT add `townhouse node add` / `node remove` / `node list`.** Epic 46 owns those. The HS template's `town`/`mill`/`dvm` profiles exist but aren't invoked by `hs up` (apex-only).
- **Does NOT modify the orchestrator's `OrchestratorError` shape, `profile` parameter behavior, or `getHsHostname()` polling logic.** Story 45.3 owns those.
- **Does NOT modify the HS compose template (`townhouse-hs.yml`).** Story 45.2 owns it.
- **Does NOT modify `docker-compose-townhouse-hs.yml` (root) or `docker-compose-townhouse-dev.yml` (root).** Both are legacy.
- **Does NOT add per-asset chain config to the connector.yaml writer.** The `transport.mode: 'ator'` block is the only HS-specific override; chain RPC URLs, USDC addresses, etc. are operator-supplied via `~/.townhouse/.env` (read by Compose at `up` time per the template's `${EVM_RPC_URL:-}` defaults). Story 45.4 does NOT generate `.env`.
- **Does NOT add a foreground TUI mode.** That's Epic 48. Story 45.4 prints the hostname and exits — no TTY-detect-and-spawn-TUI logic.
- **Does NOT add `townhouse hs --json` machine-readable output.** FR14 (every CLI verb has `--json` twin) is owned by Epic 46+ stories. For Story 45.4, parse `~/.townhouse/host.json` for scripted access — that's the JSON contract.
- **Does NOT modify wallet generation, encryption, or the BIP-44 derivation paths.** Story 21.4 owns those.
- **Does NOT install npm/node/docker for the operator.** README's prereq list covers this — Story 45.4 assumes `node ≥20`, `pnpm 8.15`, and Docker are present.
- **Does NOT add telemetry instrumentation.** Story 49 owns telemetry — a `hs up` event is NOT sent to the telemetry endpoint by this story (Drew's first ping happens 7 days after first boot per FR30).
- **Does NOT bump the townhouse package version.** Version stays at `0.1.0-rc5` (or whatever current). Version bumps happen with the next `v*` tag push that triggers Story 45.1's publish workflow.
- **Does NOT touch any code outside `packages/townhouse/`, `CLAUDE.md`, or `_bmad-output/`.** If the dev finds themselves editing `packages/town/`, `packages/mill/`, `packages/dvm/`, `packages/sdk/`, the connector repo, or any other package — stop, that's outside scope.

## References

### From `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md`

- [Source: epics-townhouse-hs-v1.md#L583-L642] — Story 45.4 ACs (canonical)
- [Source: epics-townhouse-hs-v1.md#L36-L42] — FR1–FR7 (single-command install, multi-arch images, embedded compose, apex-only, hostname stdout, idempotent re-run, down preserves volume)
- [Source: epics-townhouse-hs-v1.md#L94] — NFR1 (5-min apex-ready budget)
- [Source: epics-townhouse-hs-v1.md#L103] — NFR7 (no docker.sock in connector)
- [Source: epics-townhouse-hs-v1.md#L104] — NFR8 (operator-secret files 0o600)
- [Source: epics-townhouse-hs-v1.md#L106] — NFR9 (host ports 127.0.0.1 only)
- [Source: epics-townhouse-hs-v1.md#L177] — UX-DR5 (failure-state copy library — anon timeout, image pull, port collision, missing docker.sock)
- [Source: epics-townhouse-hs-v1.md#L175] — UX-DR4 (onboarding ribbon spec — three-line rolling status)
- [Source: epics-townhouse-hs-v1.md#L277-L284] — Epic 45 overview (One-Command Apex Install)
- [Source: epics-townhouse-hs-v1.md#L333-L390] — Story 44.1 (`GET /admin/hs-hostname` endpoint — connector-side, dependency)
- [Source: epics-townhouse-hs-v1.md#L550-L580] — Story 45.3 (DockerOrchestrator profile — upstream consumer)

### From `_bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md`

- [Source: townhouse-hs-v1-plan-2026-05-07.md#L11-L27] — Executive summary (apex-only, USDC denomination, npm install, Ink TUI default surface)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L93-L100] — Architecture anchors (single source of truth for earnings, no docker.sock in connector, CLI is thin client)
- [Source: townhouse-hs-v1-plan-2026-05-07.md#L146-L153] — Sally's design artifacts (UX-DR1–UX-DR7) — UX-DR4 (onboarding ribbon) and UX-DR5 (failure-state copy) are Story 45.4's UX dependencies

### From `_bmad-output/implementation-artifacts/`

- [Source: 45-1-multi-arch-townhouse-image-publish-ci.md] — produced `image-manifest.json` and 4 multi-arch GHCR images
- [Source: 45-2-embed-compose-templates-and-image-manifest-in-npm-tarball.md] — produced `loadComposeTemplate` / `materializeComposeTemplate` API + HS template + `DEFAULT_CONNECTOR_IMAGE` digest
- [Source: 45-3-docker-orchestrator-profile-param.md] — produced `DockerOrchestrator` HS profile + `OrchestratorError` + `getHsHostname()` admin-client method
- [Source: 45-3-docker-orchestrator-profile-param.md#L734-L766] — Cross-Repo Boundary + scope-guard list (Story 45.4 inherits the same boundary)
- [Source: 45-3-docker-orchestrator-profile-param.md#L833-L840] — Latest tech notes (Node `child_process.execFile`, Docker Compose v2 flag ordering, `--profile` flag accumulation)
- [Source: 45-3-docker-orchestrator-profile-param.md#L1004] — R1 patch: spawn-based `runDockerCompose` helper (inherits stdio for operator pull-progress visibility — Story 45.4 inherits this)
- [Source: 44-4-connector-release-contract-cross-repo-doc.md] — release contract; defines the `GET /admin/hs-hostname` connector v3.5.0+ contract this story consumes via Story 45.3's orchestrator

### From this repo

- [Source: packages/townhouse/src/cli.ts] — file under modification
- [Source: packages/townhouse/src/cli.ts:455-670] — `handleUp` body (canonical wallet-password resolution + orchestrator construction + try/catch pattern Story 45.4 mirrors)
- [Source: packages/townhouse/src/cli.ts:484-489] — wallet password resolution pattern (`--password` flag → env var → reject if no TTY)
- [Source: packages/townhouse/src/cli.ts:506] — orchestrator construction call site (now passing `{ profile: 'dev' }` after Story 45.3)
- [Source: packages/townhouse/src/cli.ts:692-732] — `parseArgs` config + command switch (extension point for `'hs'` case)
- [Source: packages/townhouse/src/cli.ts:58-79] — `HELP_TEXT` constant (extension point for new lines)
- [Source: packages/townhouse/src/docker/orchestrator.ts] — Story 45.3 deliverable (consumed as-is)
- [Source: packages/townhouse/src/docker/orchestrator.ts:165-189] — `OrchestratorError` class (consumed by Sally's failure copy classifier)
- [Source: packages/townhouse/src/docker/orchestrator.ts:320-376] — `upHs` method (consumed by `handleHsUp`)
- [Source: packages/townhouse/src/docker/orchestrator.ts:411-447] — `waitForHsHostname` private method (internal — `handleHsUp` doesn't re-invoke this; the orchestrator's `up()` calls it before resolving)
- [Source: packages/townhouse/src/docker/orchestrator.ts:563-596] — `downHs` method (consumed by `handleHsDown` in non-`--rotate-keys` path)
- [Source: packages/townhouse/src/connector/admin-client.ts:91-156] — `getHsHostname()` (consumed by `handleHsUp` idempotency probe + post-orchestrator `publishedAt` fetch)
- [Source: packages/townhouse/src/connector/admin-client.ts:110] — anon-disabled error message string `'connector is anon-disabled (HTTP 503)'` (matched by Sally's failure-copy classifier)
- [Source: packages/townhouse/src/connector/config-generator.ts:114-153] — `toYaml()` (reused by `writeHsConnectorConfig`)
- [Source: packages/townhouse/src/connector/config-generator.ts:162-198] — `buildConnectorTransportBlock` (handles the `mode: 'ator'` + `hiddenService` shape Story 45.4 needs)
- [Source: packages/townhouse/src/compose-loader.ts:146-222] — `materializeComposeTemplate` (consumed by `handleHsUp` and `handleHsDown`)
- [Source: packages/townhouse/compose/townhouse-hs.yml] — Story 45.2 deliverable (consumed via `materializeComposeTemplate('hs')`)
- [Source: packages/townhouse/compose/townhouse-hs.yml:55-61] — volume declarations (`townhouse-hs-anon` is the keypair volume — preserved by default down, deleted by `down -v`)
- [Source: packages/townhouse/compose/townhouse-hs.yml:73-96] — `connector` service definition (no `profiles:` declaration → always-on)
- [Source: packages/townhouse/compose/townhouse-hs.yml:99-141] — `townhouse-api` service definition (always-on, mounts docker.sock, mounts `~/.townhouse:/.townhouse:rw`, env var `TOWNHOUSE_WALLET_PASSWORD`)
- [Source: packages/townhouse/src/wallet/manager.ts] — `WalletManager` API (`fromMnemonic`, `lock`, etc.) — consumed as-is
- [Source: packages/townhouse/src/wallet/index.ts] — barrel exports (`encryptWallet`, `decryptWallet`, `loadWallet`, `saveWallet`)
- [Source: packages/townhouse/src/connector/config-generator.ts:19] — `DEFAULT_ATOR_PROXY = 'socks5h://proxy.ator.io:9050'` (default the HS connector.yaml uses)
- [Source: packages/townhouse/src/__integration__/townhouse-cli-lifecycle.test.ts:36-47] — skip-gate pattern (`RUN_DOCKER_INTEGRATION` + `SKIP_DOCKER`) — mirror in `townhouse-hs-up.test.ts`
- [Source: packages/townhouse/src/__integration__/orchestrator-hs.test.ts] — Story 45.3's HS-path integration test (12-step pattern Story 45.4 extends with CLI-level assertions)
- [Source: packages/townhouse/src/__integration__/_test-helpers.ts] — `isTruthyEnv`, `runCli`, `waitForExit`, `waitForUrl` helpers (consumed by Task 9)
- [Source: packages/townhouse/src/constants.ts:26-27] — `DEFAULT_CONNECTOR_IMAGE` (digest form, frozen by Story 45.2)
- [Source: packages/townhouse/README.md:233-270] — DockerOrchestrator Profiles section (existing — Story 45.4 extends with "HS Mode (Apex Install)" section after this)
- [Source: CLAUDE.md] — append one row to "Where to Find Things" (Task 10.2)

### Latest tech references (verified 2026-05-10)

- [Node.js `child_process.execFile` docs](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback) — `maxBuffer` option, error shape on non-zero exit
- [Node.js `readline` masking pattern](https://nodejs.org/api/readline.html#class-interface) — `_writeToOutput` override for password masking
- [Docker Compose v2 down](https://docs.docker.com/reference/cli/docker/compose/down/) — default volume preservation, `-v` to remove named volumes
- [Connector `GET /admin/hs-hostname` contract](https://github.com/toon-protocol/connector/issues/58) — CR-1 contract (resolved 2026-05-07; ships in connector v3.5.0)
- [no-color.org](https://no-color.org/) — `NO_COLOR` env var convention

## Verification

After Task 11 PR merges:

```bash
# 1. Unit-test regression (AC #16)
pnpm --filter @toon-protocol/townhouse test
# Expected: all green, including the new 16 cli.hs.test.ts cases + ribbon + failure-copy + password-prompt + hs-config-writer tests

# 2. Type check (new exports visible in dist/index.d.ts is NOT required — handlers are CLI-internal)
pnpm --filter @toon-protocol/townhouse build
# Expected: clean build, no TS errors

# 3. Help text smoke
node packages/townhouse/dist/cli.js --help | grep -E 'townhouse hs (up|down)'
# Expected: two lines covering the new subcommands

# 4. Cold-start end-to-end (manual, NFR1 5-minute budget)
rm -rf /tmp/th-smoke
node packages/townhouse/dist/cli.js init --config-dir /tmp/th-smoke --password test
time node packages/townhouse/dist/cli.js hs up -c /tmp/th-smoke/config.yaml
# Expected: final stdout line matches /^Apex live at .+\.anyone$/, total wall time ≤ 5 min on cold cache

# 5. host.json shape
cat /tmp/th-smoke/host.json | jq '.hostname, .publishedAt, .connectorAdminUrl, .townhouseApiUrl, .writtenAt'
# Expected: 5 non-null fields

# 6. NFR7 + NFR9 enforcement (manual)
docker inspect townhouse-hs-connector --format '{{json .HostConfig.Mounts}}' | jq -r '.[].Source' | grep docker.sock
# Expected: empty (no docker.sock in connector mounts)
docker inspect townhouse-hs-connector --format '{{json .HostConfig.PortBindings}}' | jq -r '.[][].HostIp' | sort -u
# Expected: only "127.0.0.1"
docker inspect townhouse-hs-api --format '{{json .HostConfig.PortBindings}}' | jq -r '.[][].HostIp' | sort -u
# Expected: only "127.0.0.1"

# 7. Idempotent re-run
node packages/townhouse/dist/cli.js hs up -c /tmp/th-smoke/config.yaml
# Expected: same hostname, no new containers, ~1s wall time

# 8. Down preserves volume
node packages/townhouse/dist/cli.js hs down -c /tmp/th-smoke/config.yaml
docker volume ls | grep townhouse-hs-anon
# Expected: one match

# 9. Re-up reproduces same hostname
node packages/townhouse/dist/cli.js hs up -c /tmp/th-smoke/config.yaml | grep -oE '[a-z2-7]+\.anyone'
# Expected: same .anyone address as step 4

# 10. Rotate-keys destroys
TOWNHOUSE_NON_INTERACTIVE=1 node packages/townhouse/dist/cli.js hs down --rotate-keys -c /tmp/th-smoke/config.yaml
docker volume ls | grep townhouse-hs-anon
# Expected: empty (volume gone)
test ! -f /tmp/th-smoke/host.json && echo "host.json gone" || echo "host.json present"
# Expected: "host.json gone"

# 11. Re-up after rotate produces new hostname
node packages/townhouse/dist/cli.js hs up -c /tmp/th-smoke/config.yaml | grep -oE '[a-z2-7]+\.anyone'
# Expected: DIFFERENT .anyone address from step 9

# 12. Cleanup
node packages/townhouse/dist/cli.js hs down --rotate-keys -c /tmp/th-smoke/config.yaml
rm -rf /tmp/th-smoke

# 13. Integration test (RUN_DOCKER_INTEGRATION required)
gh run download $(gh run list --workflow=publish-townhouse-images.yml --limit 1 --json databaseId --jq '.[0].databaseId') \
  --name image-manifest -D packages/townhouse/dist/
pnpm --filter @toon-protocol/townhouse build
RUN_DOCKER_INTEGRATION=1 pnpm --filter @toon-protocol/townhouse test:integration -- townhouse-hs-up
# Expected: green, ≤5 min on cold cache

# 14. Canary (must stay green, Story 45.2 deliverable)
pnpm --filter @toon-protocol/townhouse test:canary
# Expected: green

# 15. Sprint-status update (AC #20)
grep -A1 "45-4-townhouse-hs-up-subcommand-apex-only-boot" _bmad-output/implementation-artifacts/sprint-status.yaml
# Expected: status reads "done", trailing # comment names PR number
```

If any of these checks fail, the story is NOT done. Re-open. Do not flip sprint-status to `done`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- AC #16 anon-disabled classification: OrchestratorError wrapping the 503 maps to `anon-timeout` class (not `anon-disabled`) per spec — plain Error from probe maps to `anon-disabled`.
- Hostname format: admin client returns `hostname.anyone` (with suffix) confirmed by orchestrator-hs.test.ts L114 (`/\.anyone$/`). CLI does NOT double-append `.anyone`.
- HS marker detection in `hs-config-writer.ts`: uses YAML parse (`anon.enabled === true`) not string search — YAML stringifier produces nested block form, not dot-notation.
- `main()` extended with 4th optional `hsOverrides?: CliHsOverrides` parameter for unit test DI.

### Completion Notes List

- Tasks 1–10 completed in single session (2026-05-10).
- 7 new files created, 4 files modified.
- 808/819 unit tests pass; 11 pre-existing failures (earnings/logs API routes, unrelated to Story 45.4 — confirmed by stash test confirming same failures on base branch).
- Integration test created and skip-gated; requires `dist/image-manifest.json` from CI to run.
- Lint clean on all new files after fixing 3 initial lint issues (unused import, non-null assertions).
- Build clean (tsup ESM + DTS).

### File List

**New files:**
- `packages/townhouse/src/cli/failure-copy.ts`
- `packages/townhouse/src/cli/failure-copy.test.ts`
- `packages/townhouse/src/cli/onboarding-ribbon.ts`
- `packages/townhouse/src/cli/onboarding-ribbon.test.ts`
- `packages/townhouse/src/cli/password-prompt.ts`
- `packages/townhouse/src/cli/password-prompt.test.ts`
- `packages/townhouse/src/connector/hs-config-writer.ts`
- `packages/townhouse/src/connector/hs-config-writer.test.ts`
- `packages/townhouse/src/cli.hs.test.ts`
- `packages/townhouse/src/__integration__/townhouse-hs-up.test.ts`

**Modified files:**
- `packages/townhouse/src/cli.ts` (add `case 'hs':`, `handleHsUp`, `handleHsDown`, `CliHsOverrides` interface, `--rotate-keys` option, updated HELP_TEXT)
- `packages/townhouse/src/connector/index.ts` (barrel export of `writeHsConnectorConfig`)
- `packages/townhouse/README.md` ("HS Mode (Apex Install)" section added)
- `CLAUDE.md` (`handleHsUp`/`handleHsDown` row added to "Where to Find Things")
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (45-4 status: `ready-for-dev` → `in-progress`)

### Change Log

- 2026-05-10: Story 45.4 created via `bmad-create-story` (status: ready-for-dev). Comprehensive context engine analysis completed — pulls Stories 45.1/45.2/45.3 boundaries verbatim, captures inherited constraints (spawn-based runDockerCompose, OrchestratorError shape, `getHsHostname` 503 contract), encodes UX-DR4 + UX-DR5 (apex-side) inline copy library, locks NFR7/NFR9 enforcement assertions in integration test.
- 2026-05-10: Implementation complete. All tasks 1–10 done. Status → `review`.

### Review Findings

_Pending review._
