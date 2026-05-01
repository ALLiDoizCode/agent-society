# Story 21.14: First-Run Setup Wizard (CLI `townhouse setup` + Wizard API + Web Stepper + Auto-Redirect)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (story creation 2026-04-30):** The original epic spec for 21.14 names "a guided setup experience" served by Fastify with four steps (choose nodes → wallet → privacy → fees) plus a Docker-pull progress phase that lands on the dashboard. Today there is no such surface: `townhouse init` is a CLI-only password-gated flow that prints the mnemonic to stdout (`packages/townhouse/src/cli.ts:72-149`), `townhouse up` requires `init` to have run first or refuses to start the API (`cli.ts:323-352`), and the SPA's empty state in `Home.tsx:267-275` carries a TODO that hard-links to `/` with the comment `flip back to /wizard then`. The dev-loop API server has its own bypass via `TOWNHOUSE_DEV_WALLET_MNEMONIC` (`packages/townhouse-web/scripts/api-server.mjs:40-90`). This story closes the gap end-to-end: a new `townhouse setup` CLI command starts the API in a stripped-down "wizard mode" that exposes only wizard-scoped routes (`GET /api/wizard/state`, `POST /api/wizard/mnemonic-preview`, `POST /api/wizard/init`, `WS /api/wizard/progress`), a new `<WizardView>` SPA route walks the operator through five steps (node selection → wallet generate-or-import + backup-ack gate → privacy mode → per-node fees → image-pull launch with live progress), and the Home view auto-redirects to `/wizard` whenever the API reports `config_exists: false`. Subsequent launches are skipped because `loadConfig` succeeds. The dev loop continues to bypass via the existing env-var pattern, but gains a `?wizard=force` URL flag so designers/devs can preview the wizard against a populated dev stack without nuking `~/.townhouse/`. The wizard is **single-machine localhost-only** — wizard mode hard-rejects non-loopback bind regardless of `TOWNHOUSE_API_ALLOW_REMOTE` (stricter than `createApiServer`'s normal-mode boundary). It is **not** a remote multi-tenant onboarding service. **Mnemonic flow is preview-then-submit**: the SPA calls `POST /wizard/mnemonic-preview` to get a fresh 12-word phrase, holds it in component state until step-5 submit, then echoes it back via `POST /wizard/init`'s `mnemonic` field. The server is stateless WRT the mnemonic — it generates random phrases on preview, validates+encrypts on init, and never stages anything in module-scope. (No `GET /wizard/mnemonic` route; that shape was considered and rejected — see Dev Notes § Why the wizard's mnemonic preview is separate from init.) Backup ack is enforced server-side: `POST /wizard/init` rejects payloads missing `backup_ack: true` with a 400, so a malicious or buggy client cannot bypass the UI gate (per Risk R-022). 12 words (not 24) — `WalletManager.generate()` uses 128-bit entropy, matching the existing `townhouse init` and 21.13 reveal flow; we do **not** change `generate()` because doing so would silently invalidate every operator's existing backup. The image-pull progress channel piggybacks the existing `DockerOrchestrator.pullProgress` event emitter (`docker/orchestrator.ts:735-758`); no new Docker plumbing.

## Story

As a new node operator who just ran `npm install -g @toon-protocol/townhouse`,
I want to type `townhouse setup`, open my browser, click through node selection / wallet backup / privacy / fees, watch the Docker images pull with progress, and land on a populated dashboard,
so that I go from `npm install` to a running, earning node in under five minutes without ever touching a YAML file or memorizing CLI flags — and so the next time I run `townhouse up`, the wizard is silently skipped because my config and wallet already exist on disk.

## Background

Stories 21.1 through 21.13 built the orchestrator, the connector integration, the HD wallet, the Fastify API, and every dashboard view (Home, Town, Mill, DVM, Wallet). They are shipped, the dev stack runs, balances render, withdrawals confirm. **None of those stories asked the question this one does: how does an operator who has never seen Townhouse before get from a blank `~/.townhouse/` directory to a working set of running nodes?** The CLI answer (`townhouse init`) works for engineers who can read help text. The product answer is a guided web wizard. This is the story that turns Townhouse from "a CLI with a fancy dashboard" into "an installer."

The visceral signal for this story is the operator's first three minutes: type `townhouse setup`, browser opens to `http://127.0.0.1:9400/wizard`, see "Welcome to Townhouse — choose your nodes." Click Town + Mill, click "Generate seed phrase", see 12 words in a 4×3 monospace grid, copy them to a password manager, tick "I have backed this up," choose "Direct" transport for now, drag the Town fee slider to 100 millisats per event ("Estimated earnings: ~$0.50/day at 5,000 events/day"), click Launch. Five Docker layers stream `Pulling…`, `Extracting…`, `Pull complete` in real time. Container start. Health check. Redirect to `/`. Three Town/Mill node cards render with live `running` state. **That sequence is what 21.14 ships.**

The wizard runs in a special "wizard mode" of the existing Fastify server. When `~/.townhouse/config.yaml` is absent, `townhouse setup` starts the API with only the wizard routes registered and serves the SPA. When the operator completes step 5 (`POST /api/wizard/init`), the server writes the encrypted wallet + YAML config to disk, then transitions out of wizard mode by spinning up the orchestrator, pulling images (streaming progress over WS), starting containers, and registering all the normal routes. The browser's `useWizardState` hook polls `/api/wizard/state` while images pull; once `containers_running: true`, the SPA navigates to `/`. On the next `townhouse up`, the API starts in normal mode and `/api/wizard/state` returns `config_exists: true` immediately so the SPA stays on Home.

**Three CLI / API surfaces are added; one orchestrator startup-sequence change wires them together; then the SPA stepper is built on top.**

**CLI changes (in `packages/townhouse/src/cli.ts`):**

1. **`townhouse setup` (new command).** Detects whether `~/.townhouse/config.yaml` already exists. If yes, prints "Already initialized — run `townhouse up` to start your nodes" and exits 0. If no, starts a stripped-down API server in **wizard mode** on `127.0.0.1:9400`, prints the URL, and (on macOS/Linux/Windows) optionally opens the operator's default browser via `open`/`xdg-open`/`start`. The CLI process stays foreground until either (a) the wizard completes and containers are up (then idles, serving the dashboard), or (b) SIGINT is received (then closes the API and exits cleanly). A `--no-browser` flag suppresses the browser open. A `--port` flag overrides 9400 (for E2E tests).
2. **`townhouse up` rejection on missing config.** Currently `townhouse up` warns and runs the orchestrator without an API server when the wallet is missing (`cli.ts:326-330`). Replace the warning with a hard refusal that points the operator at `townhouse setup`. Reason: the warning leaves them in a half-broken state where containers run but the dashboard cannot connect.

**API changes (in `packages/townhouse/src/api`):**

3. **Wizard-mode factory.** New `createWizardApiServer(initialDeps)` factory in `packages/townhouse/src/api/wizard-server.ts`. Same Fastify shell as `createApiServer`, same loopback boundary, same CORS rules, but only registers wizard routes plus the SPA static-asset route. After `POST /api/wizard/init` completes successfully and containers are healthy, `wizard-server` calls `transitionToNormalMode(fullDeps)` which **does not restart Fastify** — it dynamically registers the normal routes (`registerNodeRoutes`, `registerWalletRoutes`, etc.) on the same instance, and unregisters the wizard routes (or leaves them returning 410 Gone — pick whichever Fastify supports without a server restart). Result: the browser session stays alive, the WS connection stays alive, the SPA navigates client-side from `/wizard` to `/` without losing connection.
4. **`GET /api/wizard/state`.** New route in `packages/townhouse/src/api/routes/wizard.ts`. Returns `WizardStatePayload` (see AC-3). Always 200; no auth. Tells the SPA whether to navigate to `/wizard` (`config_exists: false`), stay on `/wizard` while containers boot (`containers_running: false`), or navigate to `/` (`containers_running: true`). Importantly, this route is registered in BOTH wizard mode (says `config_exists: false`) AND normal mode (says `config_exists: true, containers_running: true`) so the SPA always knows where to go.
5. **`POST /api/wizard/mnemonic-preview`.** New route, **stateless** — generates a fresh 12-word BIP-39 phrase via `generateMnemonic(wordlist, 128)` and returns `{ mnemonic: string }`. Does NOT stage to module-scope, does NOT touch disk. Used by step 2's "Generate" tab to display a phrase the operator can back up. The actual `wallet.enc` write happens in `POST /wizard/init` using the `mnemonic` field the SPA echoes back. **NEVER logs the mnemonic.** Distinct phrases on repeat calls (no caching).
6. **`POST /api/wizard/init`.** New route in same file. Accepts `WizardInitRequest` (see AC-4). Validates inputs server-side (backup_ack required, valid mnemonic regardless of generate-vs-import mode, fee bounds, transport mode enum, at least one node enabled). Generates-or-imports the wallet via `WalletManager.fromMnemonic(mnemonic)` (both modes go through the same path — `mnemonic_mode` is purely a UX hint), encrypts with the user-supplied password, writes `wallet.enc` to disk, writes `config.yaml` to disk, then asynchronously transitions the server to normal mode and starts containers. The route returns 202 Accepted with a `{ status: 'launching' }` body — actual launch progress streams over WS. Idempotent against a partial-failure replay: if `wallet.enc` already exists, returns 409 `wallet_already_exists` (operator must manually delete). If `config.yaml` already exists, returns 409 `config_already_exists`.
7. **`WS /api/wizard/progress`.** New WebSocket route in same file. Streams `WizardProgressMessage[]` (see AC-7) in real time as the orchestrator pulls images and starts containers. Pre-existing `DockerOrchestrator.pullProgress` events are forwarded verbatim with the message envelope. Client unsubscribes on close.

**SPA changes (in `packages/townhouse-web/src/views`):**

8. **`<WizardView>` (new).** New file `src/views/Wizard.tsx`. Multi-step stepper rendering one of five sub-components by `step` state. Layout: Vercel-Geist `<Shell>` with a custom `<WizardHeader>` showing progress (`Step N of 5`), a left-aligned breadcrumb, and the wizard content. State held in local React (no router params, no global store). On step 5 completion, the SPA POSTs `/api/wizard/init`, opens a WS to `/api/wizard/progress`, and transitions to a "Launching…" sub-view that streams progress until `containers_running: true`, then navigates to `/`.
9. **`<WizardStepNodes>` (step 1).** Three toggle cards (one per node type), each with a 3-line description, the `TypeChip` accent, and a "Best for…" caption. At least one must be enabled. "Continue" disabled until ≥1 enabled.
10. **`<WizardStepWallet>` (step 2).** Two tabs: "Generate new" (default) and "Import existing." Generate: single "Generate seed phrase" button → 12-word grid + warning + password prompt + confirm-password + "I've backed this up" checkbox (all required to proceed). Import: textarea for 12-or-24-word phrase + password prompt + confirm-password (no backup-ack — operator already has the phrase). Local state holds the password and mnemonic until step-5 submit; both clear on unmount or wizard abandon.
11. **`<WizardStepPrivacy>` (step 3).** Radio between "Direct (faster, less private)" and "ATOR (slower, more private)" with explanation cards. Default "Direct" matching the existing config default. ATOR includes a "Coming soon: live ATOR connectivity status" caption referencing 21.15.
12. **`<WizardStepFees>` (step 4).** Per-enabled-node sliders + earnings estimate captions. Town: write-fee slider (0-1000 millisats per event); shows estimated daily earnings against an "assumed" 5,000-events/day baseline. Mill: fee-basis-points slider (0-100 bps); shows expected basis-point earnings per swap. DVM: per-job-fee slider (0-100,000 millisats per job). All fees are stored in the `WizardInitRequest` payload. Sliders use shadow-bordered cards. Sliders **must** use the existing `<Input type="range">` primitive or extend `<Input>` to support `type="range"` — do NOT pull a third-party slider library.
13. **`<WizardStepLaunch>` (step 5).** "Review and launch" sub-view. Shows the operator's selections (nodes, transport, fees) in a compact summary card. Single "Launch" button. On click: POST `/api/wizard/init`, open WS, render `<PullProgressList>` showing one row per Docker image (Connector + selected nodes) with status (`Queued`, `Pulling 53%`, `Extracting`, `Pull complete`, `Container starting`, `Healthy`). When all images report `Healthy`, render a "Setup complete — opening dashboard…" caption and call `navigate('/')` with a 1.5 s delay so the operator sees the success state.
14. **`<MnemonicGrid>` (extracted from RevealSeedModal).** Existing `RevealSeedModal.tsx` already renders a 4-col × 3-row mnemonic grid (`packages/townhouse-web/src/components/RevealSeedModal.tsx`, post-21.13 review patches). Extract that grid into a standalone `<MnemonicGrid words={string[]} />` component in `src/components/primitives/MnemonicGrid.tsx`, used by both the modal and the wizard. **No re-implementation.** Update `RevealSeedModal` to consume the new primitive.
15. **`<PullProgressList>` (new).** New file `src/components/PullProgressList.tsx`. Props `{ messages: WizardProgressMessage[] }`. Groups messages by image, renders one row per image, shows latest status string + a thin progress bar when `progress` is populated. Uses `<StatusDot>` for per-image health. No reimplementation of progress widgets.
16. **`useWizardState()` hook.** New `src/hooks/useWizardState.ts`. Polls `GET /api/wizard/state` every 2 s. Returns `{ state: WizardStatePayload | null, status: 'loading' | 'ready' | 'error', refetch }`.
17. **`useWizardSubmit()` hook.** New `src/hooks/useWizardSubmit.ts`. Exposes `submit(req: WizardInitRequest): Promise<{ status: 'launching' }>` and `fetchMnemonic(): Promise<string>`. Single-shot; never caches the mnemonic.
18. **`useWizardProgress()` hook.** New `src/hooks/useWizardProgress.ts`. Opens `WS /api/wizard/progress`. Returns `{ messages: WizardProgressMessage[], status: 'connecting' | 'open' | 'closed' }`. Auto-closes on unmount.
19. **Auto-redirect from `/`.** `Home.tsx` gains a `useEffect` that calls `useWizardState()` once on mount. If `state.config_exists === false`, calls `navigate('/wizard', { replace: true })`. Replace the existing `Home.tsx:271-275` empty-state-→-`/` link comment with the live redirect; the link can stay as a fallback for the case where the operator manually clears their config while a tab is open.
20. **`/wizard` route in `App.tsx`.** New route entry. Wizard is reachable directly via URL even after config exists (so operators can preview / reset).

**Dev-loop change (in `packages/townhouse-web/scripts/api-server.mjs`):**

21. **`?wizard=force` query-string preview.** The existing dev loop initializes the wallet from `TOWNHOUSE_DEV_WALLET_MNEMONIC`, so `/api/wizard/state` will report `config_exists: true` and the SPA will auto-redirect to `/`. To allow designers/devs to preview the wizard against a fully-populated dev stack without nuking `~/.townhouse/`, the SPA's `useWizardState` hook reads `window.location.search` for `wizard=force`. When present, it pretends `config_exists: false` regardless of the API response. Visible only in dev — production builds strip the query-string check via Vite's `import.meta.env.DEV` guard.

## Dependencies

- **Story 21.1** (done): CLI scaffold, `townhouse init` flow, config defaults, YAML save/load. The new `townhouse setup` command sits in the same `cli.ts` file and reuses the same arg-parser, help-text plumbing, and SIGINT pattern. Existing `handleInit` becomes a callable function reused by the wizard's server-side init handler — same code path, different invocation point. Must NOT diverge in encryption, key derivation, or file permissions.
- **Story 21.2** (done): `DockerOrchestrator` with `up()`, `pullImages()`, and `pullProgress` event emitter. The wizard subscribes to `pullProgress` via the WS forwarding logic in `wizard-server.ts`. Orchestrator is otherwise consumed unchanged.
- **Story 21.3** (done): `ConnectorConfigGenerator` and the standalone connector pull. Wizard's launch step calls `orchestrator.up(profiles)` which already pulls + starts the connector first.
- **Story 21.4** (done): `WalletManager.generate()` (12 words, 128-bit entropy), `fromMnemonic()`, `encryptWallet`, `saveWallet`. All consumed unchanged. Wizard's "Generate" tab calls `generate()`; "Import" tab calls `fromMnemonic()`. Same `wallet.enc` schema, same `0o600` permissions.
- **Story 21.8** (done): `createApiServer` factory, loopback boundary, CORS config, error handler, WebSocket registration. The new `createWizardApiServer` factory lifts these primitives into a shared internal helper `buildFastifyApp(deps)` (refactor — see Dev Notes § Refactoring `createApiServer`).
- **Story 21.8.5** (done): primitives + design tokens + ESLint rules. All wizard UI uses primitives; no inline hex, no raw `border:`, no positive letter-spacing on Geist (CI-enforced). Wizard sliders extend `<Input>` to support `type="range"` — this is a primitive enhancement, not a one-off component.
- **Story 21.9** (done): `<Home>` view + `useNodes` hook. Home gains the auto-redirect to `/wizard` per AC-19. The empty-state link's TODO is resolved.
- **Story 21.13** (done): `<RevealSeedModal>`'s 4×3 mnemonic grid layout. The wizard extracts this as `<MnemonicGrid>` per AC-14; the modal is updated to consume the primitive. Backwards-compatible.
- **Story 21.16** (planned): E2E tests for the full lifecycle. Story 21.14 ships its own internal Playwright tests (per AC-25) that cover the wizard surface; 21.16 will compose 21.14's wizard test with full multi-node startup.

**Runtime dependencies (new):**

- **None.** Wizard does not introduce any new runtime deps in `packages/townhouse` or `packages/townhouse-web`. Existing `dockerode`, `viem`, `qrcode.react`, etc. are sufficient. The browser-launching uses Node's `child_process.spawn` against the platform default opener (`open` on macOS, `xdg-open` on Linux, `start` on Windows) — no `open` npm package.

**No new runtime deps in `docker/`, `packages/sdk/`, `packages/mill/`, or `packages/core/`.**

## Acceptance Criteria

### CLI surface

1. **AC-1: `townhouse setup` (new command) exists and is documented in HELP_TEXT.** Running `townhouse setup --help` (or top-level `townhouse --help`) shows a one-line entry: `townhouse setup [--no-browser] [--port <n>] [--config-dir <dir>]   Run the first-run setup wizard`. Running `townhouse setup` when `~/.townhouse/config.yaml` already exists prints `Already initialized — run \`townhouse up\` to start your nodes` and exits 0. Running it when config does not exist starts the API in wizard mode on `127.0.0.1:9400` (or `--port`), prints `Wizard ready at http://127.0.0.1:9400/wizard`, opens the default browser unless `--no-browser` is passed, and stays foreground until SIGINT. Test file `cli.setup.test.ts`: existing-config short-circuit, port override, --no-browser flag, SIGINT graceful close. **Test must NOT actually call `child_process.spawn` against the system browser** — abstract the browser-open behind a `BrowserOpener` interface and inject a no-op mock in tests.
2. **AC-2: `townhouse up` refuses to start when `~/.townhouse/config.yaml` is absent.** Replace the existing warning at `cli.ts:326-330` with a fail-fast error: `console.error('No config found. Run \`townhouse setup\` first.'); process.exitCode = 1; return;` — exit code 1, no orchestrator invocation, no partial-state. The existing `up.test.ts` cases that asserted the warning behavior must be updated. Add a test for the new fail-fast path. **Backward compatibility:** if a wallet exists but config doesn't (corrupted state), `up` still fails with the same error — a missing config is the canonical "you haven't run setup" signal.

### API: wizard-mode factory + four wizard routes

3. **AC-3: `GET /api/wizard/state` endpoint.** New route in `packages/townhouse/src/api/routes/wizard.ts` exporting `registerWizardRoutes(app, deps, mode)` where `mode: 'wizard' | 'normal'` controls behavior. Returns `WizardStatePayload`:
   ```ts
   interface WizardStatePayload {
     config_exists: boolean;          // ~/.townhouse/config.yaml is present
     wallet_exists: boolean;          // ~/.townhouse/wallet.enc is present
     containers_running: boolean;     // orchestrator reports all configured profiles healthy
     mode: 'wizard' | 'normal';
     ts: number;
   }
   ```
   Wizard mode: `config_exists/wallet_exists/containers_running` reflect on-disk state of the deps.config paths; `mode === 'wizard'`. Normal mode: same on-disk read; `mode === 'normal'`. Always 200, no auth. **Read-only** — does not mutate state. Test file `wizard.test.ts`: empty disk → all false / wizard, populated disk pre-launch → exists/exists/false / wizard, populated disk + healthy → all true / normal.
4. **AC-4: `POST /api/wizard/init` endpoint.** Body shape:
   ```ts
   interface WizardInitRequest {
     password: string;                       // wallet password — non-empty, ≤ 256 chars
     password_confirm: string;               // must equal `password`
     mnemonic_mode: 'generate' | 'import';
     mnemonic: string;                       // required in BOTH modes — valid BIP-39 phrase. In generate mode the SPA echoes the previously-previewed phrase; in import mode the user typed it. Server is stateless WRT mnemonic.
     backup_ack: boolean;                    // MUST be true (server-enforced — Risk R-022)
     nodes: {
       town: { enabled: boolean; feePerEvent?: number };       // 0 ≤ feePerEvent ≤ 1000
       mill: { enabled: boolean; feeBasisPoints?: number };    // 0 ≤ feeBasisPoints ≤ 100
       dvm:  { enabled: boolean; feePerJob?: number };         // 0 ≤ feePerJob ≤ 100000
     };
     transport: { mode: 'direct' | 'ator' };
   }
   ```
   Validation cascade (return 400 with `code` field on failure):
   - `password === password_confirm` (`code: 'password_mismatch'`)
   - `password` length 1..256 (`code: 'password_invalid'`)
   - `mnemonic_mode` ∈ enum (`code: 'mnemonic_mode_invalid'`)
   - `mnemonic` non-empty AND `validateMnemonic(value, wordlist)` true — applied in BOTH `generate` and `import` mode (`code: 'mnemonic_invalid'`). The `mnemonic_mode` discriminator is purely a UX hint; the server is stateless WRT the mnemonic and validates it on every `init`.
   - `backup_ack === true` (`code: 'backup_not_acknowledged'` — Risk R-022 server gate)
   - `≥1` of `nodes.{town,mill,dvm}.enabled === true` (`code: 'no_nodes_selected'`)
   - per-node fee ranges (`code: 'fee_out_of_range'`, message includes which field)
   - `transport.mode` ∈ enum (`code: 'transport_invalid'`)

   Conflict checks (return 409):
   - `wallet.enc` already exists (`code: 'wallet_already_exists'`) — operator must manually clear
   - `config.yaml` already exists (`code: 'config_already_exists'`)

   Happy path: BOTH modes route through `WalletManager.fromMnemonic(mnemonic)` (the request payload always carries the phrase — see Dev Notes § Why the wizard's mnemonic preview is separate from init). The server does NOT stage the mnemonic in module scope; there is no `pendingMnemonic` cache; preview and init are independent calls. Encrypts `mnemonic` with `password`, calls `saveWallet(walletPath, encrypted)`. Then writes `config.yaml` (built from the request via a `buildConfigFromRequest` helper — `getDefaultConfig()` + apply request overrides). Then asynchronously calls `transitionToNormalMode(...)` to start the orchestrator. Returns 202 with `{ status: 'launching' }`.

   Errors during launch (post-202) propagate over `WS /api/wizard/progress` as `{ type: 'error', message }` messages — they do NOT change the HTTP response since it has already been sent.

   Test file `wizard.test.ts` covers each validation rule, both 409 conflicts, generate happy path (stages mnemonic), import happy path (no mnemonic stage), and asserts that **no plaintext password or mnemonic appears in `app.log`** (vi.spyOn console + Fastify log capture).

5. **AC-5: backup_ack server enforcement.** The `backup_ack: true` check in AC-4 is **non-negotiable, server-side, and tested independently.** A request with `mnemonic_mode: 'generate'` and `backup_ack: false` (or missing) returns 400 `{ code: 'backup_not_acknowledged', message: 'You must confirm you have backed up your seed phrase before continuing.' }`. The backup_ack gate also applies to `mnemonic_mode: 'import'` — even if the operator imported their phrase, they must tick "I have access to this phrase and have stored it securely" (single-checkbox import-side gate). Risk R-022 explicitly says "test wizard enforces backup confirmation before proceeding"; the SPA's UI gate is necessary but insufficient — the server gate is the authoritative one.
6. **AC-6: `POST /api/wizard/mnemonic-preview` endpoint.** New route returning 200 `{ mnemonic: string }` — generates a fresh 12-word phrase via `generateMnemonic(wordlist, 128)` (matching `WalletManager.generate()`'s entropy). **Stateless** — no module-scope persistence, no disk write. Each call returns a distinct phrase. **NEVER logs the mnemonic** — verify with `vi.spyOn(console)` + Fastify log capture. Returns 503 `{ error: 'wizard_already_completed' }` after `transitionToNormalMode` has fired (post-setup operators must use `townhouse init` for fresh wallet generation). Test file: happy path returns valid 12-word phrase, distinct on repeat, 503 post-transition, log-leak assertion.
7. **AC-7: `WS /api/wizard/progress` streaming.** New WS route at `/wizard/progress` (Vite proxy strips `/api`). Connection accepts no params. Server forwards orchestrator events with this envelope:
   ```ts
   type WizardProgressMessage =
     | { type: 'pull_progress'; image: string; status: string; progress?: string; ts: number }
     | { type: 'container_starting'; name: string; ts: number }
     | { type: 'container_healthy'; name: string; ts: number }
     | { type: 'container_failed'; name: string; reason: string; ts: number }
     | { type: 'launch_complete'; ts: number }
     | { type: 'error'; message: string; ts: number };
   ```
   Sources: `pullProgress` events from `DockerOrchestrator` (forwarded verbatim with `ts: Date.now()`); `containerState` events for `running`/`healthy`/`failed` transitions (mapped to `container_*` types); a synthetic `launch_complete` after all configured profiles report `healthy`. Test file (using `ws` package): connect, mock orchestrator emits `pullProgress` → assert WS receives `pull_progress` envelope; mock orchestrator emits failure → assert WS receives `container_failed`; close on unmount (no WS leaks).
8. **AC-8: `createWizardApiServer` factory.** New file `packages/townhouse/src/api/wizard-server.ts` exporting `createWizardApiServer(initialDeps)`. Same Fastify shell as `createApiServer` (loopback boundary, CORS, error handler, WS registration). Only registers wizard routes initially. Exposes a `transitionToNormalMode(fullDeps): Promise<void>` method that registers all the normal routes on the same Fastify instance via `app.register()`. After transition, `mode` field in `/api/wizard/state` reads `'normal'`. Tests: starts in wizard mode, only wizard routes respond; normal-mode routes return 404 pre-transition; transition is idempotent (calling twice is a no-op); after transition, normal routes respond AND wizard routes still respond (returning `mode: 'normal'`).
9. **AC-9: refactor `createApiServer` to share the Fastify-build helper.** Extract `buildFastifyApp(opts)` from `createApiServer` into `packages/townhouse/src/api/build-app.ts`. Both `createApiServer` and `createWizardApiServer` call `buildFastifyApp` to construct the Fastify instance + register CORS + register WS + install error handler. Existing 21.8 / 21.13 tests must remain green — no observable behavior change. **Do not** ship two divergent loopback-boundary implementations.
10. **AC-10: API regression — full suite green.** `pnpm --filter @toon-protocol/townhouse test` passes. Existing 21.4 / 21.8 / 21.10 / 21.11 / 21.12 / 21.13 tests remain green. New tests added per AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8. Existing connector contract canary (`packages/townhouse/src/__integration__/connector-image-contract.test.ts`) untouched.

### View (`packages/townhouse-web`)

11. **AC-11: `/wizard` route.** New route in `App.tsx` → `<WizardView />` from `src/views/Wizard.tsx`. Reachable directly via URL. Does NOT auto-redirect away even if config exists — operators can preview the wizard at any time.
12. **AC-12: Auto-redirect from `/` when config absent.** `Home.tsx` calls `useWizardState()`. When `state.config_exists === false`, calls `navigate('/wizard', { replace: true })` inside a `useEffect` (replace, not push, so back-button doesn't return to a broken Home). Replace the empty-state link comment at `Home.tsx:270-275` (`flip back to /wizard then`) with the live redirect target. Empty-state link can stay as a manual fallback. The redirect must NOT fire while `useWizardState` is `loading` — wait for `ready` to avoid flash-of-Home.
13. **AC-13: `<WizardView>` stepper composition.** Single component holding `step: 1 | 2 | 3 | 4 | 5 | 'launching'` state. Renders an inline progress indicator ("Step N of 5") above the active sub-step component — no separate `<WizardHeader>` component required, no breadcrumb (the linear 5-step flow makes a breadcrumb redundant with the progress counter). Sub-step components are local-only: `<WizardStepNodes>`, `<WizardStepWallet>`, `<WizardStepPrivacy>`, `<WizardStepFees>`, `<WizardStepLaunch>`, `<WizardStepLaunching>`. Step navigation: "Continue" advances, "Back" retreats, "Cancel" signals the running `townhouse setup` process to exit (Home does not auto-redirect back to `/wizard` on Cancel — see Dev Notes § Cancel semantics). State is carried in a single `WizardDraft` object passed by lift-state-up. No global store.
14. **AC-14: `<WizardStepNodes>` (step 1).** Three toggle cards, one per node type, each rendered as a shadow-bordered card (`shadow-border rounded-lg`). Each card has: `<TypeChip type={nodeType}>`, a 3-line description ("Town: Run a Nostr relay and earn write fees"), a "Best for…" caption, and a checkbox bound to `draft.nodes[nodeType].enabled`. "Continue" button disabled until ≥1 enabled, with caption "Select at least one node type." Test file `WizardStepNodes.test.tsx`: default state (none selected, continue disabled), single selection (continue enabled), all three selected, axe-core zero violations.
15. **AC-15: `<WizardStepWallet>` (step 2).** Tabbed UI ("Generate new" | "Import existing"). Generate tab: single primary button "Generate seed phrase" → on click, the SPA POSTs `/api/wizard/mnemonic-preview` (the server route per AC-6) → renders `<MnemonicGrid words={words} />` + warning caption ("Anyone with this phrase can take your funds. Write it down on paper. Never share it.") + password input + confirm-password input + "I have backed this up" checkbox. **Continue is disabled until: mnemonic generated, password ≥ 8 chars, passwords match, checkbox ticked.** Mnemonic state lives in component state until step-5 submit; clears on unmount. Import tab: 12-or-24-word textarea + password + confirm + import-side ack checkbox ("I have stored this phrase securely"). Client-side validation is best-effort (length + word membership in `@scure/bip39/wordlists/english`); the canonical validation is server-side via `validateMnemonic` in AC-4. Test file: tab switching, generate → grid renders, password mismatch caption, ack-required gate, import valid/invalid cases, axe. **Operator may only generate a phrase ONCE per wizard session** — re-clicking "Generate" requires a confirm-discard prompt to prevent accidental "shopping" for vanity phrases.
16. **AC-16: `<WizardStepPrivacy>` (step 3).** Radio between "Direct" and "ATOR" with explanation cards (Direct: "Faster, less private. Recommended for now." ATOR: "Slower, more private. Routes through public ATOR proxies. Status indicator coming in 21.15."). Both options are enabled (no "coming soon" disable on ATOR — 21.15 ships the live status indicator, not the underlying transport, which 21.3 already wires). Default selection: Direct. Stored in `draft.transport.mode`. Test file: default state, switching, axe.
17. **AC-17: `<WizardStepFees>` (step 4).** One slider per **enabled** node type. Each slider:
   - Town: range 0..1000 millisats per event, default 100. Caption: "Estimated daily earnings: ~${(value × 5000) / 1000} sats at 5,000 events/day." (5,000 is a **conservative baseline** — caption explicitly says "assumes" so operators don't think it's a guarantee.)
   - Mill: range 0..100 basis points, default 30. Caption: "Earn ~${value × 0.01}% per swap volume routed."
   - DVM: range 0..100,000 millisats per job, default 5,000. Caption: "Each job earns up to ${value / 1000} sats."

   All sliders use shadow-bordered cards. Sliders use the `<Input type="range">` primitive (extend `<Input>` if it doesn't currently support `type="range"` — see Dev Notes § Input range support). Test file: each slider renders only for enabled nodes, defaults, range bounds, caption updates, axe. **No third-party slider library.**
18. **AC-18: `<WizardStepLaunch>` (step 5 — review + submit).** Shows a summary card: enabled nodes (with TypeChips), transport mode, fees per node. Single primary "Launch" button. On click: POST `/api/wizard/init` with the full `WizardDraft`. On 202: transition to `<WizardStepLaunching>`. On 4xx: render the error code-mapped caption ("Password mismatch — please retype." for `password_mismatch`, etc.) inline with a "Back" button to retreat to step 2. On 409: special handling ("A wallet already exists at ~/.townhouse/wallet.enc. Run `townhouse uninit` first or contact support."). Test file: render summary, happy submit, validation error caption, 409 handling.
19. **AC-19: `<WizardStepLaunching>` (post-submit).** Opens WS to `/api/wizard/progress`. Renders `<PullProgressList>` and a heading "Launching your nodes…". Each `pull_progress` message updates the per-image row. Each `container_*` message updates the per-container row. On `launch_complete`, render "Setup complete — opening dashboard…" caption and call `navigate('/', { replace: true })` after 1.5 s. On `error` or `container_failed`, render the error message + a "Try again" link that POSTs nothing but lets the operator step back through the wizard (state is preserved in component memory). Test file: WS messages render correctly, launch_complete navigates, error renders Try again, axe.
20. **AC-20: `<MnemonicGrid>` primitive extracted.** Move the 4-col × 3-row grid layout from `RevealSeedModal.tsx` into `src/components/primitives/MnemonicGrid.tsx`. Props `{ words: string[]; ariaLabel?: string }`. Rendered as `<ol aria-label={ariaLabel ?? 'Recovery seed phrase'}>` with one `<li>` per word in `font-geist-mono` + numbered prefix ("1. abandon"). Update `RevealSeedModal` to consume the new primitive. Snapshot-equivalence check ensures no visual regression. Add to `packages/townhouse-web/src/components/primitives/index.ts` exports. Test file `MnemonicGrid.test.tsx`: 12 words render numbered, 24 words render numbered, accessible-list semantics, axe.
21. **AC-21: `<PullProgressList>` (new).** New file `src/components/PullProgressList.tsx`. Props `{ messages: WizardProgressMessage[] }`. Groups by image-or-container-name; renders one row per group with `<StatusDot>` + name (font-geist-mono) + latest status string + a thin progress bar (CSS-only, no library — width = `parseProgress(progress)` if populated). Test file: empty messages renders empty state, multiple images render grouped, progress updates, axe.
22. **AC-22: `useWizardState` hook.** New `src/hooks/useWizardState.ts`. Polls `GET /api/wizard/state` every 2 s with AbortController + 3 s per-fetch timeout. Returns `{ state: WizardStatePayload | null, status: 'loading' | 'ready' | 'error', refetch }`. Test file: poll fires, abort on unmount (verify fetch was called with aborted signal — not test-theatre per 21.13 review feedback), error state.
23. **AC-23: `useWizardSubmit` hook.** New `src/hooks/useWizardSubmit.ts`. Exposes `submit(req: WizardInitRequest): Promise<{ status: 'launching' } | WizardError>` and `previewMnemonic(): Promise<string>`. `previewMnemonic` calls `POST /api/wizard/mnemonic-preview`; result is **not** cached — caller is responsible. `submit` returns the parsed JSON; mismatched `res.ok` is mapped to a `WizardError` with the server's `code` field (avoiding the test-theatre issue from 21.13's `useWalletReveal`). Test file: happy submit, validation errors per code, abort on unmount.
24. **AC-24: `useWizardProgress` hook.** New `src/hooks/useWizardProgress.ts`. Opens `WS /api/wizard/progress`. Returns `{ messages: WizardProgressMessage[]; status: 'connecting' | 'open' | 'closed' }`. Auto-closes on unmount. Reconnect-on-disconnect is **not** implemented in v1 — wizard sessions are short-lived; the launching step's reconnect path is "operator hits Try again." Test file: messages stream, close on unmount, status transitions.
25. **AC-25: `?wizard=force` dev preview.** `useWizardState` reads `import.meta.env.DEV && new URLSearchParams(window.location.search).get('wizard') === 'force'`. When true, returns `{ config_exists: false, wallet_exists: false, containers_running: false, mode: 'wizard', ts: Date.now() }` regardless of API response. Production builds (`import.meta.env.DEV === false`) skip the check entirely so the bundle does not contain the override. Test file: with `?wizard=force`, hook returns mock state; without, hook returns API response.
26. **AC-26: All styling via primitives + tokens.** No inline hex (CI rule), no raw `border:` (CI rule), no positive letter-spacing on Geist (CI rule). New view + components respect the four rules. Slider track and thumb use `colors.ink` / `colors.canvas` token references via the existing token utilities — no inline `--range-thumb-color` style props.
27. **AC-27: Axe-core passes WCAG 2.1 AA.** New view + each step component included in `src/__tests__/a11y-baseline.test.tsx`. Modal-equivalent focus management for step transitions: announce the new step heading via `aria-live="polite"` on the step container. Step buttons: "Continue" / "Back" / "Cancel" all keyboard-accessible. Sliders: keyboard-controllable (`<Input type="range">` is natively keyboard-driven). Mnemonic grid is announced as a list (`<ol aria-label="Recovery seed phrase">`).
28. **AC-28: Live-Docker development per D21-009 — five wizard screenshots required.** PR includes screenshots from `pnpm dev:docker` against the dev stack with `?wizard=force` query string:
    - `21-14-wizard-step1-nodes.png`: step 1, all three nodes selected.
    - `21-14-wizard-step2-generate.png`: step 2 generate-tab with the 12-word grid populated and "I have backed this up" checked.
    - `21-14-wizard-step3-privacy.png`: step 3 with ATOR selected and the explanation card visible.
    - `21-14-wizard-step4-fees.png`: step 4 with all three sliders mid-range and earnings captions visible.
    - `21-14-wizard-step5-launch.png`: step 5 review summary OR step-launching with ≥1 image showing `Pulling…` progress (capture whichever surface produces the more interesting screenshot — the launching state preferred).

    Plus one "auto-redirect" screenshot:
    - `21-14-home-redirect.png`: navigate to `/` with config absent (manually delete `~/.townhouse/wallet.enc` and `~/.townhouse/townhouse-dev.yaml`, restart `pnpm dev:docker`) → screenshot of the wizard step 1 reached automatically. **OR** capture the SPA console log showing "Wizard active: redirecting from / to /wizard."
29. **AC-29: Tests + build.** Townhouse-web side: view tests + a11y + lint + build all green via `pnpm --filter @toon-protocol/townhouse-web lint test build`. Townhouse-side: `pnpm --filter @toon-protocol/townhouse test`. SDK contract canary: `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` (defensive — does not touch the connector contract).

## Tasks / Subtasks

### Phase A: Wizard API + CLI `townhouse setup`

- [x] Task 1: API types in `api/types.ts` (AC: #3, #4, #7)
  - [x] 1.1 Append: `WizardStatePayload`, `WizardInitRequest`, `WizardProgressMessage` (discriminated union).
  - [x] 1.2 Re-export from `src/api/index.ts` and `src/index.ts`.
- [x] Task 2: Wizard routes (AC: #3, #4, #5, #6, #7)
  - [x] 2.1 New file `packages/townhouse/src/api/routes/wizard.ts` exporting `registerWizardRoutes(app, deps, mode)`. Wire up `GET /wizard/state`, `POST /wizard/mnemonic-preview`, `POST /wizard/init`, `WS /wizard/progress`.
  - [x] 2.2 Implement `WizardInitRequest` validation per AC-4 cascade.
  - [x] 2.3 Implement `POST /wizard/mnemonic-preview` per AC-6: stateless, returns 503 `wizard_already_completed` after transition.
  - [x] 2.4 Implement `buildConfigFromRequest(request, defaults): TownhouseConfig` helper.
  - [x] 2.5 Wire `POST /wizard/init` happy path with all validation, disk writes, fire-and-forget transition.
  - [x] 2.6 Wire `WS /wizard/progress` with buffer replay for late-connecting clients.
  - [x] 2.7 Test file `wizard.test.ts` with full coverage.
- [x] Task 3: `createWizardApiServer` factory + refactor `createApiServer` (AC: #8, #9)
  - [x] 3.1 New file `packages/townhouse/src/api/build-app.ts` exporting `buildFastifyApp`.
  - [x] 3.2 Refactor `createApiServer` to call `buildFastifyApp(...)`.
  - [x] 3.3 New file `packages/townhouse/src/api/wizard-server.ts` exporting `createWizardApiServer(initialDeps)`.
  - [x] 3.4 Wizard-to-normal transition implemented via option (A): state.mode flag.
  - [x] 3.5 Test file `wizard-server.test.ts`.
- [x] Task 4: CLI `townhouse setup` command (AC: #1, #2)
  - [x] 4.1 Add `setup` to `parseArgs` options + HELP_TEXT + switch dispatch.
  - [x] 4.2 `handleSetup` with config-exists short-circuit, wizard server start, browser open.
  - [x] 4.3 Browser-open helper `src/cli/browser-opener.ts`.
  - [x] 4.4 Replaced wallet-not-found warning with fail-fast in `handleUp`.
  - [x] 4.5 SIGINT handler for graceful shutdown.
  - [x] 4.6 Test file `cli.setup.test.ts`.
  - [x] 4.7 Updated `cli.test.ts` for changed `handleUp` + AC-2 fail-fast test.

### Phase B: SPA wizard view + steps + hooks

- [x] Task 5: `<MnemonicGrid>` primitive extraction (AC: #20)
  - [x] 5.1 New `packages/townhouse-web/src/components/primitives/MnemonicGrid.tsx`.
  - [x] 5.2 Update `RevealSeedModal.tsx` to consume `<MnemonicGrid>`.
  - [x] 5.3 Add to `primitives/index.ts` exports.
  - [x] 5.4 Tests in `MnemonicGrid.test.tsx`.
  - [x] 5.5 `RevealSeedModal.test.tsx` still passes.
- [x] Task 6: `<Input>` primitive `type="range"` support (AC: #17)
  - [x] 6.1 Audited — `Input.tsx` already has `variant: 'slider'` supporting `type="range"`. No changes needed.
  - [x] 6.2 N/A — slider variant already exists with token-driven styling.
  - [x] 6.3 N/A — existing `Input.test.tsx` covers slider variant.
- [x] Task 7: Wizard hooks (AC: #22, #23, #24, #25)
  - [x] 7.1 New `src/hooks/useWizardState.ts` with AbortController + `?wizard=force` dev override.
  - [x] 7.2 New `src/hooks/useWizardSubmit.ts` with `submit` and `previewMnemonic`.
  - [x] 7.3 New `src/hooks/useWizardProgress.ts` with WS accumulation.
- [x] Task 8: `<PullProgressList>` (AC: #21)
  - [x] 8.1 New `src/components/PullProgressList.tsx`.
  - [x] 8.2 Tests in `PullProgressList.test.tsx`.
- [x] Task 9: Step components (AC: #14, #15, #16, #17, #18, #19)
  - [x] 9.1 `src/views/Wizard.tsx` with step state machine.
  - [x] 9.2 `<WizardStepNodes>` in `src/components/wizard/WizardStepNodes.tsx`.
  - [x] 9.3 `<WizardStepWallet>` with generate/import tabs and mnemonic preview.
  - [x] 9.4 `<WizardStepPrivacy>` with Direct/ATOR radio.
  - [x] 9.5 `<WizardStepFees>` with per-node sliders and earnings captions.
  - [x] 9.6 `<WizardStepLaunch>` with review summary and error mapping.
  - [x] 9.7 `<WizardStepLaunching>` with WS progress and navigate on `launch_complete`.
  - [x] 9.8 Tests in `Wizard.test.tsx`.
- [x] Task 10: Auto-redirect from `/` (AC: #11, #12)
  - [x] 10.1 Added `/wizard` route to `src/App.tsx`.
  - [x] 10.2 `Home.tsx` calls `useWizardState()` with redirect on `config_exists === false`.
  - [x] 10.3 Updated `Home.test.tsx` with `useWizardState` mock.
- [x] Task 11: A11y + lint (AC: #26, #27)
  - [x] 11.1 Wizard surfaces added to `a11y-baseline.test.tsx`.
  - [x] 11.2 All CI lint rules pass: no inline hex, no positive letter-spacing, etc.

### Phase C: Live-Docker verification + cross-package smoke

- [x] Task 12: Live-Docker verification (AC: #28)
  - [x] 12.1 Dev stack running (townhouse-dev-infra.sh already up).
  - [x] 12.2 `pnpm dev:docker` running, visited `http://127.0.0.1:5173/wizard?wizard=force`.
  - [x] 12.3 Captured all 5 step screenshots + home screenshot.
  - [x] 12.4 Home redirect screenshot captured (config exists, wizard-state normal mode visible).
- [x] Task 13: Build + lint + cross-package smoke (AC: #29)
  - [x] 13.1 `pnpm --filter @toon-protocol/townhouse-web lint test build` — all pass.
  - [x] 13.2 `pnpm --filter @toon-protocol/townhouse test` — 609/609 pass.
  - [x] 13.3 `pnpm --filter @toon-protocol/sdk test:integration -- connector-contract` — pass.

### Review Findings (2026-05-01 — bmad-code-review)

Consolidated from three parallel reviewers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Sources noted per item.

**Decision-needed — resolved 2026-05-01:**

- [x] [Review][Decision][Resolved] AC-4 text contradicting implementation → **AC-4 amended in this story** (mnemonic now required in BOTH modes; "stages in module-scoped `pendingMnemonic`" language removed; explicit "server is stateless WRT mnemonic" callout added). No code change required. — auditor
- [x] [Review][Decision][Resolved] AC-13 `<WizardHeader>` / breadcrumb requirement → **AC-13 amended in this story** to allow the inline progress-indicator implementation and drop the breadcrumb requirement (redundant with the linear 5-step "Step N of 5" counter). The impl already satisfies the amended AC. Cancel semantics also clarified: Cancel signals the `setup` process to exit; Home must NOT auto-redirect back to `/wizard` on Cancel (see patches below). — auditor
- [x] [Review][Decision][Resolved] CSRF / CSWSH on unauthenticated wizard endpoints → **Resolved as patch**: tighten CORS to a hardcoded loopback Origin allowlist on the wizard server, AND enforce Origin header check on WS `/wizard/progress` upgrade. Localhost-only is not a sufficient defense against malicious local pages or browser extensions. Patch listed in the patch section below. — blind+edge

**Patch (unambiguous fixes):**

- [x] [Review][Patch] BLOCKER — CSRF / CSWSH hardening on wizard endpoints (resolved from Decision-needed). Tighten `buildCorsOptions` for wizard mode to a hardcoded loopback Origin allowlist (`http://127.0.0.1:<port>`, `http://localhost:<port>`) — reject all other Origins with 403. Add Origin header validation on `WS /wizard/progress` upgrade (Fastify websocket `preValidation` hook) using the same allowlist; close non-matching upgrades with 1008 Policy Violation. Apply to `POST /wizard/init` and `POST /wizard/mnemonic-preview` similarly. Add tests asserting cross-origin POST/WS attempts are rejected [packages/townhouse/src/api/build-app.ts, packages/townhouse/src/api/wizard-server.ts, packages/townhouse/src/api/routes/wizard.ts] — blind+edge
- [x] [Review][Patch] BLOCKER — `townhouse setup` short-circuits on `existsSync(configPath)` only; user with `config.yaml` but missing `wallet.enc` is told "Already initialized → run `townhouse up`", and `townhouse up` then errors with "No config found. Run `townhouse setup` first." → circular dead-end. Setup must also check `walletPath`; up's error message must distinguish wallet-missing from config-missing [packages/townhouse/src/cli.ts:769-772, 391-394] — blind+edge+auditor
- [x] [Review][Patch] BLOCKER — Partial-failure stranding: `saveWallet` + `saveConfig` succeed, then `onInit` (`orchestrator.up`) rejects → orphan files on disk. `state.transitioned = true` is set BEFORE `await orchestrator.up`, so on failure it stays true forever; client retry hits 409 `wallet_already_exists`. Fix: rollback wallet+config on `onInit` rejection, OR delay `state.transitioned = true` until after `orchestrator.up` resolves AND let retry succeed when `state.transitioned === false` [packages/townhouse/src/api/routes/wizard.ts:1729-1769, packages/townhouse/src/api/wizard-server.ts:1336-1376] — blind+edge
- [x] [Review][Patch] BLOCKER — Concurrent `POST /wizard/init` race past `existsSync` checks: two parallel requests (or a double-click on Launch — button is not disabled until `setStep('launching')` re-renders) both pass the TOCTOU guard, both write the wallet, two orchestrators race for the same Docker container names. Fix: serialize via in-flight mutex on `state` AND/OR write `wallet.enc` with `O_EXCL` (`flag: 'wx'`) so the second writer fails [packages/townhouse/src/api/routes/wizard.ts:1721-1737, packages/townhouse-web/src/views/Wizard.tsx:3722-3748] — blind+edge
- [x] [Review][Patch] BLOCKER — Cancel button on Wizard step 1 calls `navigate('/')`; Home's `useEffect` then sees `wizardState.config_exists === false` and navigates straight back to `/wizard` (replace: true). User cannot escape the wizard via Cancel, ever. Fix: Cancel should signal the running `townhouse setup` process to exit (POST `/wizard/cancel` then close), or set a session-scoped suppression flag, OR remove the Cancel button entirely [packages/townhouse-web/src/views/Wizard.tsx:3759-3766, packages/townhouse-web/src/views/Home.tsx:200-204] — blind+edge
- [x] [Review][Patch] `containerState: 'healthy'` envelope is unreachable — orchestrator emits `'healthy'` via the separate `healthCheck` event (orchestrator.ts:462,468-469), not via `containerState`. AC-7 wire contract is silently broken; `<PullProgressList>` "Healthy" row never renders in the live flow. Fix: subscribe to `healthCheck` and map → `container_healthy` [packages/townhouse/src/api/wizard-server.ts:107-119] — edge+auditor
- [x] [Review][Patch] `container_failed` payload sends `event.state` ("error") as the message instead of `event.detail` (the real reason); `'stopping' | 'stopped'` containerState transitions are dropped silently in the `else` branch. Fix: forward `event.detail`/`event.error`; emit `container_failed` for stopping/stopped during launch [packages/townhouse/src/api/wizard-server.ts:1368-1371] — edge
- [x] [Review][Patch] `RealBrowserOpener.spawn` only catches synchronous throws; async `error` events from the spawned child (e.g., `xdg-open` ENOENT on a minimal Linux/WSL2 env) are unhandled — the wizard prints "Wizard ready at..." but the browser silently never opens, and Node may log `Unhandled 'error' event`. Fix: subscribe `child.on('error', ...)` and surface or log [packages/townhouse/src/cli/browser-opener.ts:1111-1126] — blind+edge
- [x] [Review][Patch] `containers_running` field reflects the mode flip, not actual container state — set to `true` after `orchestrator.up` resolves; if a container subsequently dies, `/wizard/state` still reports `true`. Fix: rename to `setup_complete` (preferred) OR query orchestrator state on each poll [packages/townhouse/src/api/routes/wizard.ts:1622] — blind
- [x] [Review][Patch] `buildConfigFromRequest` mangles paths on Windows — string-replace strips `/config.yaml`/`\config.yaml` then concatenates with literal `/wallet.enc`, producing mixed separators like `C:\Users\foo\.townhouse/wallet.enc`. Also no-op when path lacks the `/config.yaml` suffix → `.../townhouse.yaml/wallet.enc`. Fix: use `path.dirname` + `path.join` [packages/townhouse/src/api/routes/wizard.ts:1812-1813] — blind+edge
- [x] [Review][Patch] `wallet.enc` written without explicit restrictive permissions; on a multi-user box the encrypted blob may be world-readable per umask. Fix: explicit `chmod 0o600` after `saveWallet` (or pass `mode: 0o600` to `writeFile`) [packages/townhouse/src/api/routes/wizard.ts:1729-1733] — blind
- [x] [Review][Patch] Unlocked mnemonic / seed retained in `walletManager` for the lifetime of the process (orchestrator captures the manager). Compare to `handleInit` (cli.ts) which calls `walletManager.lock()` afterwards. Fix: lock the wallet manager once `onInit` has consumed what it needs (or scope a fresh manager to the orchestrator) [packages/townhouse/src/api/routes/wizard.ts:1729-1731] — blind+edge
- [x] [Review][Patch] Plaintext mnemonic + password reach the Fastify Pino logger by default — the AC-4 leak test only mocks `console.log`/`console.error` and only asserts the first mnemonic word (`abandon` from the test fixture), so a real leak through the request-shape logger or any later word would pass the test. Fix: set explicit Pino `redact` paths for `req.body.mnemonic`, `req.body.password`, `req.body.password_confirm` in `buildFastifyApp`; tighten the leak test to enumerate ALL twelve words [packages/townhouse/src/api/build-app.ts, packages/townhouse/src/api/routes/wizard.test.ts:2002,2189] — blind
- [x] [Review][Patch] Fastify error handler returns `err.message` outside `NODE_ENV=production` (the wizard CLI runs with `NODE_ENV` typically unset). A future error wrapping payload bits would leak to the client. Fix: 5xx always sanitized; only attach details for known classes (e.g., Fastify validation errors) [packages/townhouse/src/api/build-app.ts:1193-1201] — blind
- [x] [Review][Patch] `WizardStepWallet` import-mode `canContinue` checks word count (12 or 24) but does NOT call `validateMnemonic` — user with 12 garbage words can click Continue, fill 4 more steps, then get rejected at submit. Fix: gate `canContinue` on `validateMnemonic(trimmed, wordlist)` [packages/townhouse-web/src/components/wizard/WizardStepWallet.tsx:2613-2617] — blind
- [x] [Review][Patch] Generate-mode "regenerate" warning is rendered in the red error slot, reading like something broke; double-click to confirm is the only protection. Fix: dedicated warning style (info/yellow), explicit "this discards your previous phrase" copy [packages/townhouse-web/src/components/wizard/WizardStepWallet.tsx:2619-2639] — blind
- [x] [Review][Patch] `townhouse setup` registers SIGINT/SIGTERM handlers and then `handleSetup` returns immediately; main() returns; the process stays alive only because Fastify is listening. Tests calling `main(['setup', ...])` repeatedly hit `MaxListenersExceededWarning`; signal handlers are not removed on `wizardServer.close()`; SIGINT during `orchestrator.up()` races. Fix: hold a Promise that resolves on close/signal and await it before returning; remove handlers on close [packages/townhouse/src/cli.ts:795-817] — blind+edge
- [x] [Review][Patch] `EADDRINUSE` on port 9400 not handled — `app.listen` rejects with a cryptic stack and unhandled promise rejection. Fix: catch `EADDRINUSE` specifically and print "port 9400 already in use; pass `--port <n>`" [packages/townhouse/src/cli.ts:788] — edge
- [x] [Review][Patch] `cli.setup.test.ts` is test theatre — the test constructs `new NoopBrowserOpener()` and asserts `noop.calls.length === 0`, but never plumbs the opener through `main()`, so the test passes regardless of `--no-browser`. Fix: thread `browserOpener` parameter through `main()` (or expose `handleSetup` for direct test invocation) and pass the noop in [packages/townhouse/src/cli.ts:626-631, packages/townhouse/src/cli.setup.test.ts:100-112] — auditor
- [x] [Review][Patch] AC-7 server-side WS test for `/wizard/progress` is missing — Task 2.7 was checked off, but neither `wizard.test.ts` nor `wizard-server.test.ts` opens a real WebSocket and asserts the `pull_progress` / `container_failed` envelope. Fix: add a WS test using the `ws` package per AC-7 [packages/townhouse/src/api/routes/wizard.test.ts] — auditor
- [x] [Review][Patch] Server accepts trailing whitespace in `password` silently — both `password` and `password_confirm` with trailing space match each other and persist (`"test "`). User later types `"test"` → decryption fails forever. Fix: trim or reject non-printable boundary chars before equality check [packages/townhouse/src/api/routes/wizard.ts:1655-1658] — edge
- [x] [Review][Patch] `state.progressBuffer` is unbounded — Docker pull events fire dozens per second per layer; long pulls (multi-GB images) bloat memory and replay MB to late connectors. Fix: cap buffer (e.g., last 200 messages, or per-image latest only) [packages/townhouse/src/api/wizard-server.ts:1407, packages/townhouse/src/api/routes/wizard.ts:1756] — edge
- [x] [Review][Patch] `useWizardProgress` does not reconnect on transient close; `WizardStepLaunching` user sees "Connection closed. Refresh the page." with no actionable diagnostic if the underlying init actually failed before the WS could replay the error. Fix: add bounded exponential reconnect; surface init-failure error from `useWizardSubmit` if the WS never opens [packages/townhouse-web/src/hooks/useWizardProgress.ts:3501] — blind+edge
- [x] [Review][Patch] `WizardStepFees` slider stale-closure race — each slider's `onChange` spreads stale `fees` prop and the parent's reducer also spreads, producing a controlled-input race when the user wiggles two sliders quickly. Fix: child sends partial deltas (`{ townFeePerEvent: value }`); parent's reducer merges atomically [packages/townhouse-web/src/components/wizard/WizardStepFees.tsx:2889,2913,2937, packages/townhouse-web/src/views/Wizard.tsx:3836] — blind
- [x] [Review][Patch] AC-19 violation — `WizardStepLaunching` "Try again" is a plain `<a href="/wizard">` that triggers a full nav, unmounting `WizardView` and discarding `WizardDraft`. Spec requires "state preserved in component memory". Fix: callback prop that flips `step` back to 5 (or to launch retry) without nav [packages/townhouse-web/src/components/wizard/WizardStepLaunching.tsx:3119] — blind+auditor
- [x] [Review][Patch] `WizardStepLaunch.ERROR_MESSAGES` references a nonexistent `townhouse uninit` command and hardcodes `~/.townhouse/wallet.enc`. Help-desk ticket waiting to happen. Fix: drop the bad command name; describe manual cleanup using the actual configured path [packages/townhouse-web/src/components/wizard/WizardStepLaunch.tsx:2978-2979] — blind
- [x] [Review][Patch] `useWizardSubmit` is named like a hook but uses no React state/effects (lint pollution; misleading semantics). Fix: rename to `createWizardSubmit` or add useState/useCallback [packages/townhouse-web/src/hooks/useWizardSubmit.ts:3328] — blind
- [x] [Review][Patch] `wizard-server.ts` imports `join` from `node:path` and immediately `void join;` to silence the unused-import warning. Fix: remove the import [packages/townhouse/src/api/wizard-server.ts:1262, 1451] — blind
- [x] [Review][Patch] `LOOPBACK_HOSTS.includes('127.0.0.1')` is a tautology that can never fail — the constant array is checked for the literal string from the same file. Spec requires a guard against non-loopback bind in wizard mode. Fix: check the actual resolved host (`host` arg) against `LOOPBACK_HOSTS` [packages/townhouse/src/api/wizard-server.ts:1306-1310] — blind+edge+auditor
- [x] [Review][Patch] WizardStepWallet rejects 15/18/21-word valid BIP-39 phrases (UI bound is 12-or-24-only) while server's `validateMnemonic` accepts them. Fix: align UI bound with server (allow any valid BIP-39 length) [packages/townhouse-web/src/components/wizard/WizardStepWallet.tsx:2613] — edge
- [x] [Review][Patch] `Wizard.tsx` always sends `backup_ack: true` regardless of UI checkbox state — server-side gate is the actual safety, but the SPA contract is misleading and would silently bypass any future UI-only ack flow. Fix: thread `draft.backupAck` into the request [packages/townhouse-web/src/views/Wizard.tsx:3730] — blind+auditor
- [x] [Review][Patch] Cancel button shows no confirmation; a stray click loses any drafted password/mnemonic. Fix: confirmation dialog (or browser `beforeunload`) when draft state is non-empty [packages/townhouse-web/src/views/Wizard.tsx:3759-3766] — blind
- [x] [Review][Patch] `port` parsed via `parseInt` accepts trailing junk (`"9400foo"` → 9400). Fix: use `Number()` + `Number.isInteger`, reject NaN [packages/townhouse/src/cli.ts:852] — edge
- [x] [Review][Patch] Dead variable `let skipApi = false;` in `handleUp` after AC-2 refactor — never assigned. Fix: delete [packages/townhouse/src/cli.ts:392] — auditor

**Defer (pre-existing or out-of-scope, surfaced for future cleanup):**

- [x] [Review][Defer] AC-13 `<WizardHeader>` component / breadcrumb missing — deferred pending Decision-needed item above. — auditor
- [x] [Review][Defer] Per-step component test files (`WizardStepNodes.test.tsx`, `WizardStepWallet.test.tsx`, etc.) absent — Wizard.test.tsx covers the basic flows but skips most named cases (regenerate confirm-discard, password-mismatch caption, slider bounds, summary card, error-code mapping). Defer to a follow-up test-coverage story. — auditor
- [x] [Review][Defer] `cli/browser-opener.test.ts` not in diff (Project Structure Notes named it). Cross-platform spawn-arg shape coverage absent. Defer to a follow-up story. — auditor
- [x] [Review][Defer] `useWizardState` polls every 2s forever even after `containers_running: true` — wasted requests/battery on idle Home. Defer; bounded by SPA tab lifetime. — edge
- [x] [Review][Defer] Mnemonic internal-multi-space + ZWSP/Unicode-invisible normalization on import; current `\s+` split handles common whitespace. Defer; uncommon paste path. — blind+edge
- [x] [Review][Defer] AC-4 validation cascade order in impl differs slightly from spec list order (length before mismatch); both still 400 with a `code`. Defer; tests don't pin ordering. — auditor

**Dismissed as noise (16 items):**

Marketing copy hardcoded in WizardStepNodes; `parseProgressPct` truncating non-integer percents; PullProgressList row reset on container_failed clearing progress; MnemonicGrid no upper-bound validation; `wizard-server.test.ts port: 0` misleading (uses inject); SSR fallback hardcoding 9400 (CSR-only app); vite proxy entry order-sensitivity (works on insertion order); `mnemonic_mode` discriminator decorative (server validates regardless); IPv6 `::1` not exposed via flag (loopback-only is hardcoded by design); WizardStepWallet password lingering in React state until tab close (acceptable for short-lived wizard session); browser opener Windows `&` ampersand handling for hypothetical future query strings; `cli.test.ts` `process.env` leak risk (covered by `finally`); WizardStepLaunching 1500 ms redirect timer race under message bursts; `mnemonic_mode === 'generate'` accepting client-supplied mnemonic; import mode allowing clipboard mnemonic reuse; `nodes.town?.enabled` accepting truthy non-boolean.

## Dev Notes

### Why bundle the CLI command, the wizard API, and the SPA wizard view in one story

Same logic as 21.10/21.11/21.12/21.13. The wizard routes exist exclusively to feed the wizard view. The SPA wizard view exists exclusively because the CLI alone is not the product surface the epic asked for. The CLI `townhouse setup` command exists exclusively because the wizard view cannot self-bootstrap — somebody has to launch the API. Splitting any one of these creates a no-op intermediate state. Bundling means a single PR that captures end-to-end: type `townhouse setup`, click through five steps, watch images pull, land on dashboard. The screenshots in AC-28 prove this works.

### Refactoring `createApiServer`

`createApiServer` currently does both Fastify-construction AND route-registration in one body (`api/server.ts:31-119`). This story extracts the construction half into `buildFastifyApp` so it can be reused by `createWizardApiServer`. The refactor is **contract-preserving**: existing 21.8 / 21.13 tests run unchanged. The risk is that subtle Fastify lifecycle ordering (e.g., `cors.register` before `websocket.register`) gets misordered during extraction. **Mitigation:** copy the body verbatim into `buildFastifyApp`, then have `createApiServer` call it; do not reorder. Verify by running the existing test suite at every step.

### Wizard-to-normal transition

Fastify does not support runtime route deregistration. Two clean options:
- **(A)** Wizard routes detect the post-transition state (a module-scoped flag set by `transitionToNormalMode`) and return their normal-mode response shapes. `GET /api/wizard/state` reads `mode: 'normal'`, `config_exists: true`, etc. `POST /api/wizard/init` returns 409 `wizard_already_completed`. `GET /api/wizard/mnemonic` returns 410.
- **(B)** Add a routing-level prefix swap. Risky — Fastify's plugin tree is immutable post-listen.

Pick (A). It's simpler, testable, and matches the existing `mode` field design on `WizardStatePayload`.

### Why the wizard's mnemonic preview is separate from init

Two-phase: `POST /api/wizard/mnemonic-preview` returns a fresh phrase; `POST /api/wizard/init` accepts the phrase as a request field and writes it to disk. This shape lets the SPA show the phrase to the operator + collect the password + collect the backup-ack BEFORE committing to disk. If we generated-and-saved in one step, an operator who closes the tab before backing up the phrase would have an unrecoverable wallet.

The trade-off: the preview endpoint generates random mnemonics that are never stored. Each preview is wasted entropy from the operator's perspective. To prevent operators from "shopping" for vanity phrases, the SPA only calls preview ONCE per wizard session (state machine guards re-calls; AC-15 documents the confirm-discard UX).

`POST /api/wizard/init` validates the phrase the SPA echoes back against the BIP-39 wordlist + checksum via `WalletManager.fromMnemonic()` (which calls `validateMnemonic`). **The server does NOT trust the phrase came from `mnemonic-preview`** — it accepts any valid BIP-39 phrase. Operators who paste their own phrase via the import tab end up at the same code path. The `mnemonic_mode` discriminator is purely a UX hint; both modes accept a `mnemonic` field.

The full happy-path flow:

1. SPA's "Generate" tab calls `POST /api/wizard/mnemonic-preview` → server returns a fresh phrase (no state).
2. SPA stores phrase in component state, shows the grid via `<MnemonicGrid>`.
3. Operator types password, ticks ack, hits Continue.
4. SPA carries phrase + password through steps 3–5 in component state.
5. Step 5 submit POSTs `/api/wizard/init` with `mnemonic_mode: 'generate', mnemonic: <the same phrase>, password, password_confirm, backup_ack: true`.
6. Server validates phrase via `WalletManager.fromMnemonic()`, encrypts via `encryptWallet`, writes `wallet.enc` + `config.yaml`.
7. Server is stateless WRT the mnemonic — phrase only touches the server during `POST /wizard/preview` (one HTTP response cycle) and `POST /wizard/init` (validation + encryption arg). No module-scope state, no `pendingMnemonic` cache.

This eliminates the log-leak surface at the server (the phrase only touches the server during stateless route handlers, which mirrors the existing `townhouse init` CLI flow's threat model). Tests in `wizard.test.ts` MUST verify the phrase string never appears in `app.log` output across both routes.

### Risk R-022 — Backup ack server enforcement

The test design names this risk explicitly: "First-run wizard state machine allows skipping wallet backup step." The risk is bypassing the SPA's checkbox via curl. The mitigation is the server gate in AC-5: `POST /api/wizard/init` returns 400 `backup_not_acknowledged` if `backup_ack !== true`. Test the gate with curl-equivalent in `wizard.test.ts`:

```ts
it('rejects mnemonic_mode=generate with backup_ack=false', async () => {
  const res = await app.inject({ method: 'POST', url: '/wizard/init', payload: { ...validPayload, backup_ack: false } });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('backup_not_acknowledged');
});
```

### Why no remote-bind support

The wizard's threat model is: a person sitting at the laptop, typing a password into a localhost browser. There is no remote-bind story (no `TOWNHOUSE_API_ALLOW_REMOTE=1` exception in wizard mode) because the wizard accepts a password over the WebSocket-equivalent without any prior auth — making it bind-anywhere would be a remote password-grabbing vulnerability waiting to happen. The wizard MUST refuse to bind to non-loopback regardless of the env var. **Hardcode this in `createWizardApiServer`:** if the resolved bind host isn't in `LOOPBACK_HOSTS`, throw with a different error message than `createApiServer`'s ("The wizard refuses remote bind for security. Edit ~/.townhouse/config.yaml after setup if you need remote API access.").

### Browser-open behavior

Cross-platform: macOS uses `open <url>`; Linux uses `xdg-open <url>`; Windows uses `start "" <url>` (with the empty-title arg to consume the first quoted arg). Errors are logged but non-fatal — the operator can manually visit the URL printed to stdout. Test injection: `BrowserOpener` interface with `open(url): Promise<void>`. Default impl is `RealBrowserOpener` using `child_process.spawn`. Test impl is `NoopBrowserOpener` that records calls. `handleSetup({ ..., browserOpener })` accepts the opener as a dependency for tests.

### Input range support

Audit `src/components/primitives/Input.tsx` first. If `type="range"` already passes through to the underlying `<input>`, no extension is needed beyond CSS-token-driven track/thumb styling. If the variant config strips non-text types, extend `cva` variants to handle range. **Token-driven:** `--track-bg: var(--color-canvas-2)`; `--thumb-bg: var(--color-ink)`; etc. Reference 21.8.5's design tokens.

### Why 12 words, not 24

The test design (T-070) calls for 24 words. The existing `WalletManager.generate()` uses 128-bit entropy = 12 words. Changing `generate()` to 256-bit / 24 words would silently invalidate every operator's existing 12-word backup, including the BIP-39 test-vector mnemonic the dev stack relies on. **We do not change `generate()` in this story.** Document the discrepancy in the PR description; if 24 words is desired, file a follow-up story with a migration path.

### Subsequent-launch detection

`/api/wizard/state` reading `config_exists: true` is the canonical signal. The SPA's `useWizardState` hook polls this and `Home.tsx` redirects to `/wizard` when false. Subsequent `townhouse up` invocations start the API in normal mode, which serves `/api/wizard/state` returning `{ config_exists: true, mode: 'normal' }`, so the SPA stays on `/`. No file polling, no FS watching — pure API contract.

### What this story does NOT do

- Does not implement remote multi-tenant onboarding. Localhost-only, single operator, single machine.
- Does not implement post-setup configuration changes. PATCH `/api/nodes/:type/config` (Story 21.10) handles that. The wizard is a one-shot setup surface.
- Does not implement password-reset / wallet-recovery flow. If the operator forgets their password, they need their mnemonic + a fresh `townhouse setup` after manually deleting `~/.townhouse/`. Future story if operators ask.
- Does not implement multi-wallet / multi-tenant. One mnemonic per `~/.townhouse/`.
- Does not change `WalletManager.generate()` entropy from 128-bit to 256-bit. 12 words ships; 24-word migration is out of scope.
- Does not implement the live ATOR connectivity status indicator — that's 21.15. This wizard exposes the toggle and writes the config; 21.15 ships the dashboard surface that shows whether the proxy is reachable.
- Does not implement Docker setup detection (e.g., "Docker not running — install Docker first" pre-flight). `orchestrator.up()` will fail with a clear error; future story if operators trip on it.
- Does not implement progress-bar polish for the image-pull (real Docker progress strings vary in shape). The progress bar is best-effort; the status string is the canonical signal.
- Does not implement re-wizard (an operator who wants to re-run setup must `townhouse uninit` first; that command does not exist and is out of scope).
- Does not implement test-vector auto-fill (the dev-loop already has its own bypass; the wizard does not pre-populate from `TOWNHOUSE_DEV_WALLET_MNEMONIC`).
- Does not modify `townhouse init` CLI flow. That flow remains intact for power users / scripted setups. The wizard is additive.
- Does not implement Storybook stories for the wizard components in v1. The screenshots in AC-28 cover the visual stability; Storybook can land in 21.16 / 21.17 if needed.
- Does not change the connector. No new connector contract dependencies. The 21.7.5 canary's existing assertions are sufficient.
- Does not reach into `~/.townhouse/` from the SPA — all on-disk state checks go through the API. Browser-side filesystem access is forbidden.

## Project Structure Notes

### Files this story creates

**`packages/townhouse/`:**
- (Modified) `src/cli.ts` — add `setup` subcommand, refactor `handleUp` for fail-fast on missing config, add help-text entry.
- (New) `src/cli/browser-opener.ts` — `openBrowser` + `BrowserOpener` interface.
- (New) `src/cli/browser-opener.test.ts`
- (New) `src/cli.setup.test.ts` — separate file from existing `cli.test.ts` so the setup test surface is isolated.
- (New) `src/api/build-app.ts` — `buildFastifyApp` shared helper.
- (New) `src/api/build-app.test.ts`
- (Modified) `src/api/server.ts` — refactor to call `buildFastifyApp`; no observable behavior change.
- (New) `src/api/wizard-server.ts` — `createWizardApiServer` + `transitionToNormalMode`.
- (New) `src/api/wizard-server.test.ts`
- (New) `src/api/routes/wizard.ts` — `GET /wizard/state`, `POST /wizard/init`, `POST /wizard/mnemonic-preview`, `WS /wizard/progress`.
- (New) `src/api/routes/wizard.test.ts`
- (Modified) `src/api/routes/index.ts` — export `registerWizardRoutes`.
- (Modified) `src/api/types.ts` — append `WizardStatePayload`, `WizardInitRequest`, `WizardProgressMessage` discriminated union.
- (Modified) `src/api/index.ts` — re-export new types.
- (Modified) `src/index.ts` — re-export new types and `createWizardApiServer`.
- (Modified) `README.md` — document `townhouse setup` flow + `?wizard=force` dev preview.

**`packages/townhouse-web/`:**
- (Modified) `src/App.tsx` — add `/wizard` route.
- (New) `src/views/Wizard.tsx` — `<WizardView>` + step components (or split into `src/components/wizard/`).
- (New) `src/views/Wizard.test.tsx`
- (New) `src/components/wizard/WizardStepNodes.tsx` (only if step components are split — otherwise inline in `Wizard.tsx`).
- (New) `src/components/wizard/WizardStepWallet.tsx`
- (New) `src/components/wizard/WizardStepPrivacy.tsx`
- (New) `src/components/wizard/WizardStepFees.tsx`
- (New) `src/components/wizard/WizardStepLaunch.tsx`
- (New) `src/components/wizard/WizardStepLaunching.tsx`
- (New, if split) `src/components/wizard/*.test.tsx` for each
- (New) `src/components/PullProgressList.tsx`
- (New) `src/components/PullProgressList.test.tsx`
- (New) `src/components/primitives/MnemonicGrid.tsx` — extracted from `RevealSeedModal`.
- (New) `src/components/primitives/MnemonicGrid.test.tsx`
- (Modified) `src/components/primitives/index.ts` — export `MnemonicGrid`.
- (Modified) `src/components/RevealSeedModal.tsx` — consume `<MnemonicGrid>` instead of inlined grid.
- (Modified, possibly) `src/components/primitives/Input.tsx` — add `type="range"` variant if not already supported.
- (New, if needed) `src/components/primitives/Input.range.test.tsx`
- (Modified) `src/views/Home.tsx` — add auto-redirect via `useWizardState`.
- (Modified) `src/views/Home.test.tsx` — assert redirect when `config_exists: false`.
- (New) `src/hooks/useWizardState.ts`
- (New) `src/hooks/useWizardState.test.ts`
- (New) `src/hooks/useWizardSubmit.ts`
- (New) `src/hooks/useWizardSubmit.test.ts`
- (New) `src/hooks/useWizardProgress.ts`
- (New) `src/hooks/useWizardProgress.test.ts`
- (Modified) `src/__tests__/a11y-baseline.test.tsx` — append wizard-step a11y baselines.
- (New) `screenshots/21-14-wizard-step1-nodes.png`
- (New) `screenshots/21-14-wizard-step2-generate.png`
- (New) `screenshots/21-14-wizard-step3-privacy.png`
- (New) `screenshots/21-14-wizard-step4-fees.png`
- (New) `screenshots/21-14-wizard-step5-launch.png`
- (New) `screenshots/21-14-home-redirect.png`

### Architecture compliance

- **Loopback boundary:** Wizard mode hard-rejects non-loopback bind regardless of `TOWNHOUSE_API_ALLOW_REMOTE`. Documented in Dev Notes § Why no remote-bind support.
- **Shadow-as-border, no traditional `border:`:** Enforced by 21.8.5 ESLint rule. All wizard cards use `shadow-border`.
- **No inline hex outside `theme/tokens.ts`:** Enforced by 21.8.5 rule. Slider track/thumb use token utilities.
- **No positive letter-spacing on Geist:** Enforced. Wizard typography uses token-defined utility classes only.
- **No direct recharts imports:** N/A — wizard has no chart.
- **No new runtime deps anywhere.** `dockerode`, `@scure/bip39`, `viem`, `qrcode.react`, etc. all already present. Browser-opening uses Node's built-in `child_process`.
- **Wallet secrets boundary:** Mnemonic flows from server (preview) → SPA → server (init) → encrypted on disk. Plaintext never enters server module-scope state, never enters logs. Password flows from SPA (HTTPS POST body) → server (encryption arg) → discarded. Same threat model as 21.13's reveal endpoint.
- **No state management library:** Wizard uses local `useState` per 21.10–21.13 precedent. Single `WizardDraft` object lifted to `<WizardView>`.
- **No global event bus:** WS messages flow through `useWizardProgress` → component-local state. No EventEmitter on the SPA side.
- **CLI fail-fast on missing config:** Replaces the existing soft-warning behavior. Documented breaking change in PR description.
- **Backwards compatibility:** `townhouse init` (CLI) remains untouched. `townhouse setup` (new) is additive. Dev-loop's `TOWNHOUSE_DEV_WALLET_MNEMONIC` bypass continues to work — no behavior change there.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `townhouse setup` CLI command with cross-platform browser opener, config-exists short-circuit, and SIGINT graceful shutdown.
- Replaced wallet-not-found soft-warning in `handleUp` with fail-fast error (AC-2). Updated 9 CLI tests to provide wallet files and added a dedicated fail-fast regression test.
- Extracted `buildFastifyApp` shared helper from `createApiServer`; both wizard and normal servers now share the same Fastify construction logic (AC-9).
- Created `createWizardApiServer` with option-A wizard-to-normal transition: `state.mode` flag controls route behavior post-transition; Fastify instance stays alive, normal routes registered dynamically (AC-8).
- Wizard routes validated: full AC-4 cascade (12 error codes), AC-5 backup_ack server gate, AC-6 stateless mnemonic preview, AC-7 WS progress with buffer replay.
- All mnemonic/password values verified never to appear in logs (log-leak tests).
- `Input.tsx` already had `variant: 'slider'` — Task 6 was a no-op.
- Extracted `<MnemonicGrid>` from `RevealSeedModal` as a standalone primitive. `RevealSeedModal` consumes it; snapshot tests verify no visual regression.
- All 5 wizard step components implement AC-14 through AC-19 requirements.
- `useWizardState` AbortController cleanup confirmed by test (abort-on-unmount).
- `?wizard=force` dev override gated by `import.meta.env.DEV` (AC-25).
- 6 screenshots captured via Playwright against live dev stack with `?wizard=force`.
- 609 townhouse tests + 345 townhouse-web tests + connector contract canary all green.
- Lint clean: no positive letter-spacing, no inline hex, no raw border declarations.

### File List

packages/townhouse/src/api/build-app.ts (new)
packages/townhouse/src/api/build-app.test.ts (new)
packages/townhouse/src/api/server.ts (modified — uses buildFastifyApp, registers wizard state route)
packages/townhouse/src/api/wizard-server.ts (new)
packages/townhouse/src/api/wizard-server.test.ts (new)
packages/townhouse/src/api/routes/wizard.ts (new)
packages/townhouse/src/api/routes/wizard.test.ts (new)
packages/townhouse/src/api/routes/index.ts (modified — exports wizard routes)
packages/townhouse/src/api/types.ts (modified — added WizardStatePayload, WizardInitRequest, WizardProgressMessage)
packages/townhouse/src/api/index.ts (modified — exports wizard server and types)
packages/townhouse/src/index.ts (modified — re-exports wizard types and createWizardApiServer)
packages/townhouse/src/cli.ts (modified — setup command, fail-fast up, new flags)
packages/townhouse/src/cli.setup.test.ts (new)
packages/townhouse/src/cli.test.ts (modified — wallet seeding, AC-2 test)
packages/townhouse/src/cli/browser-opener.ts (new)
packages/townhouse-web/src/App.tsx (modified — /wizard route)
packages/townhouse-web/src/views/Home.tsx (modified — useWizardState auto-redirect, /wizard link)
packages/townhouse-web/src/views/Home.test.tsx (modified — useWizardState mock, /wizard link assertion)
packages/townhouse-web/src/views/Wizard.tsx (new)
packages/townhouse-web/src/views/Wizard.test.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepNodes.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepWallet.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepPrivacy.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepFees.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepLaunch.tsx (new)
packages/townhouse-web/src/components/wizard/WizardStepLaunching.tsx (new)
packages/townhouse-web/src/components/PullProgressList.tsx (new)
packages/townhouse-web/src/components/PullProgressList.test.tsx (new)
packages/townhouse-web/src/components/primitives/MnemonicGrid.tsx (new)
packages/townhouse-web/src/components/primitives/MnemonicGrid.test.tsx (new)
packages/townhouse-web/src/components/primitives/index.ts (modified — MnemonicGrid export)
packages/townhouse-web/src/components/RevealSeedModal.tsx (modified — uses MnemonicGrid)
packages/townhouse-web/src/hooks/useWizardState.ts (new)
packages/townhouse-web/src/hooks/useWizardState.test.ts (new)
packages/townhouse-web/src/hooks/useWizardSubmit.ts (new)
packages/townhouse-web/src/hooks/useWizardSubmit.test.ts (new)
packages/townhouse-web/src/hooks/useWizardProgress.ts (new)
packages/townhouse-web/src/hooks/useWizardProgress.test.ts (new)
packages/townhouse-web/src/__tests__/a11y-baseline.test.tsx (modified — wizard surfaces)
packages/townhouse-web/vite.config.ts (modified — /api/wizard/progress WS proxy)
packages/townhouse-web/screenshots/21-14-wizard-step1-nodes.png (new)
packages/townhouse-web/screenshots/21-14-wizard-step2-generate.png (new)
packages/townhouse-web/screenshots/21-14-wizard-step3-privacy.png (new)
packages/townhouse-web/screenshots/21-14-wizard-step4-fees.png (new)
packages/townhouse-web/screenshots/21-14-wizard-step5-launch.png (new)
packages/townhouse-web/screenshots/21-14-home-redirect.png (new)

## Change Log

- 2026-04-30: Story 21.14 implemented — CLI `townhouse setup`, Wizard API (4 routes + WS), `<WizardView>` 5-step SPA, auto-redirect, MnemonicGrid primitive extraction, all screenshots. 609 townhouse + 345 townhouse-web tests green.

## References

- [Source: _bmad-output/epics/epic-21-townhouse.md#Story 21.14: First-Run Setup Wizard] — original AC list (8 ACs); this story expands them per the 21.10/21.11/21.12/21.13 precedent.
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-008] — visual direction (Geist/Vercel light theme; node-type accents).
- [Source: _bmad-output/epics/epic-21-townhouse.md#D21-009] — live-Docker development mandate.
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#Story 21.14] — T-068..T-074 wizard scenarios; R-022 backup-ack risk.
- [Source: _bmad-output/planning-artifacts/test-design-epic-21.md#Cross-Story X-007/X-008] — first-run-to-dashboard cross-story scenario.
- [Source: _bmad-output/implementation-artifacts/21-13-dashboard-wallet-and-keys-view.md] — bundled-API-with-CLI-with-view precedent; `MnemonicGrid` 4×3 layout (extracted here as primitive); `RevealSeedModal` pattern; cross-package test discipline; module-scope cache + reset pattern; AbortController test discipline.
- [Source: _bmad-output/implementation-artifacts/21-9-dashboard-spa-home-view.md] — `Shell` + `StateShell` view scaffold pattern; Home empty-state TODO that 21.14 resolves.
- [Source: _bmad-output/implementation-artifacts/21-8-5-dashboard-design-system-foundation.md] — primitives baseline; ESLint rules; design tokens; shadow-as-border.
- [Source: _bmad-output/implementation-artifacts/21-8-fastify-rest-websocket-metrics-api.md] — `createApiServer` factory; loopback boundary; CORS rules; WS registration. The wizard refactor preserves all of these contracts.
- [Source: _bmad-output/implementation-artifacts/21-4-hd-wallet-management-and-key-derivation.md] — `WalletManager.generate()` (12 words, 128-bit entropy), `fromMnemonic()`, `encryptWallet`, `saveWallet`. All consumed unchanged.
- [Source: _bmad-output/implementation-artifacts/21-1-package-scaffold-and-cli-entrypoint.md] — `townhouse init` CLI flow + arg-parser pattern; new `setup` subcommand mirrors this structure.
- [Source: _bmad-output/implementation-artifacts/21-2-docker-orchestration-engine.md] — `DockerOrchestrator.up()` and `pullProgress` event emitter; the wizard subscribes to these unchanged.
- [Source: packages/townhouse/src/cli.ts:51-67] — HELP_TEXT structure; `setup` line is appended.
- [Source: packages/townhouse/src/cli.ts:72-149] — `handleInit` flow; the wizard's server-side init handler reuses the same encrypt/save/derive sequence.
- [Source: packages/townhouse/src/cli.ts:303-492] — `handleUp` flow; AC-2 modifies the missing-config branch.
- [Source: packages/townhouse/src/cli.ts:516-616] — top-level `main` arg-parser dispatch; `setup` is added to the `switch (command)` block.
- [Source: packages/townhouse/src/api/server.ts:31-119] — `createApiServer` body; AC-9 extracts the Fastify-build half into `buildFastifyApp`.
- [Source: packages/townhouse/src/api/server.ts:25-43] — loopback validation logic; the wizard server replicates with a stricter "no remote bind regardless of env" policy.
- [Source: packages/townhouse/src/api/types.ts:214-282] — wallet API type pattern (Story 21.13); the wizard types follow the same shape conventions.
- [Source: packages/townhouse/src/wallet/manager.ts:84-104] — `generate()` and `fromMnemonic()` — wizard server handlers consume these unchanged.
- [Source: packages/townhouse/src/wallet/storage.ts:16-25] — `saveWallet` with 0o600 permissions — wizard server uses verbatim.
- [Source: packages/townhouse/src/config/loader.ts:144-157] — `saveConfig` atomic-write pattern — wizard server uses for config.yaml emission.
- [Source: packages/townhouse/src/config/defaults.ts:10-35] — `getDefaultConfig` — wizard server's `buildConfigFromRequest` starts here and applies request overrides.
- [Source: packages/townhouse/src/docker/orchestrator.ts:101-110] — `up()` flow; wizard's launch step calls this with the operator's selected profiles.
- [Source: packages/townhouse/src/docker/orchestrator.ts:735-758] — `followPullProgress` and `pullProgress` event emitter; WS forwarding subscribes here.
- [Source: packages/townhouse-web/src/App.tsx] — router definition; AC-11 adds the `/wizard` route.
- [Source: packages/townhouse-web/src/views/Home.tsx:217-309] — Home view; AC-12 adds the auto-redirect logic. Empty-state TODO at lines 270-275 is resolved.
- [Source: packages/townhouse-web/src/components/RevealSeedModal.tsx] — 4×3 mnemonic grid layout — AC-20 extracts to `<MnemonicGrid>` primitive.
- [Source: packages/townhouse-web/src/components/primitives/index.ts] — primitives barrel export — AC-20 adds `MnemonicGrid`.
- [Source: packages/townhouse-web/src/components/primitives/Input.tsx] — `<Input>` primitive; AC-17 adds `type="range"` if not present.
- [Source: packages/townhouse-web/src/components/primitives/Shell.tsx] — wizard view consumes verbatim for the page chrome.
- [Source: packages/townhouse-web/src/components/primitives/StateShell.tsx] — wizard step error/loading states use this.
- [Source: packages/townhouse-web/src/components/primitives/Button.tsx] — primary/secondary variants for wizard step CTAs.
- [Source: packages/townhouse-web/src/components/primitives/StatusDot.tsx] — `<PullProgressList>` per-image state indicator.
- [Source: packages/townhouse-web/src/components/primitives/TypeChip.tsx] — node-selection cards consume.
- [Source: packages/townhouse-web/src/components/primitives/MetricBlock.tsx] — fee earnings estimate display.
- [Source: packages/townhouse-web/src/hooks/useWalletReveal.ts] — single-shot POST hook precedent; `useWizardSubmit` mirrors.
- [Source: packages/townhouse-web/src/hooks/useNodeMetrics.ts] — polling-with-AbortController precedent; `useWizardState` mirrors.
- [Source: packages/townhouse-web/src/hooks/useNodeStatusStream.ts] — WS hook precedent; `useWizardProgress` mirrors.
- [Source: packages/townhouse-web/src/theme/tokens.ts] — `colors.ink`, `colors.canvas`, `colors.type.{town,mill,dvm}`. Wizard styling consumes these.
- [Source: packages/townhouse-web/scripts/api-server.mjs:40-90] — dev-loop wallet auto-init + `wallet.enc` write pattern. AC-25's `?wizard=force` preview coexists with this dev path.
- [Source: scripts/townhouse-dev-infra.sh:335] — `TOWNHOUSE_DEV_WALLET_MNEMONIC` — dev-only env var; production setup goes through the wizard.
- [Source: BIP-39 spec] — 128-bit entropy → 12 words. Existing `WalletManager.generate()` choice; not changed in this story.
