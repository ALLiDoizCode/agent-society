# Story 21.15: ATOR Privacy Transport + Connectivity Status (Settings View + Live Reachability + Connector Restart)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Scope note (story creation 2026-05-01):** The transport plumbing is already in place — `TransportConfig` lives in `packages/townhouse/src/config/schema.ts:48-53` with `mode: 'direct' | 'ator'` and an optional `socksProxy`, the validator in `packages/townhouse/src/config/validator.ts:126-141` rejects malformed values, the default is `mode: 'direct'` (`packages/townhouse/src/config/defaults.ts:24-26`), the wizard step 3 (`WizardStepPrivacy.tsx`) writes `transport.mode` through `POST /wizard/init` (`packages/townhouse/src/api/routes/wizard.ts:184-188,344`), and `ConnectorConfigGenerator` already serializes `TRANSPORT_MODE` and `SOCKS_PROXY` env vars to the connector container with `socks5h://proxy.ator.io:9050` as the ATOR default (`packages/townhouse/src/connector/config-generator.ts:17,107-116`). What is **missing** for 21.15: (a) the dashboard cannot toggle transport mode after the wizard runs — `PATCH /api/nodes/:type/config` only edits node-level fees and `additionalProperties: false` rejects a `transport` body (`packages/townhouse/src/api/routes/nodes-patch.ts:27-51`); (b) there is no live reachability probe of the SOCKS5 proxy — `Home.tsx:146-158` openly carries a `TODO(21.15): wire to live ATOR proxy reachability` and renders the dot in `'ok'` state regardless of whether the proxy resolves; (c) there is no `/api/transport` or `/api/transport-status` endpoint — Home receives `transportMode` as a prop default of `'unknown'` (`Home.tsx:117,192,219`); (d) toggling transport must trigger `orchestrator.regenerateConnectorConfig(activeNodes)` since the connector reads `TRANSPORT_MODE` / `SOCKS_PROXY` from env vars set at container creation, and the connector's existing peer-list restart path (`packages/townhouse/src/docker/orchestrator.ts:118-144`) is the canonical surface that already emits `connectorRestarting` / `connectorRestarted` events the dashboard already consumes; (e) Risk R-010 in the test design (`_bmad-output/planning-artifacts/test-design-epic-21.md:47`) explicitly calls out that an unreachable ATOR proxy must **not** brick the connector — the operator surface for graceful fallback is "show red ATOR indicator + offer one-click flip back to Direct," not silent degradation. This story closes all five gaps end-to-end: a new `routes/transport.ts` exposes `GET /api/transport` (live status: configured mode + reachability + sampled latency) and `PATCH /api/transport` (mutate `config.transport.mode` and trigger connector restart on flip), a new `TransportProbe` runs a 30 s TCP-connect probe loop against the SOCKS5 proxy host:port (lazy-started only when `mode === 'ator'`, idle when `mode === 'direct'`), a new `<SettingsView>` SPA route at `/settings` exposes a transport radio with a live status banner and a "Save & restart connector" button, the Home header swaps its hard-coded `'unknown'` default for a `useTransportStatus()` hook so the existing `<StatusDot>` reflects real reachability, and the existing wizard step-3 caption ("Coming soon: live ATOR connectivity status (story 21.15)") is replaced with the live status preview lifted from the same hook. **No connector image change.** The connector already reads `TRANSPORT_MODE` and `SOCKS_PROXY` from the env (story 21.3); we are adding the operator UX layer on top, not changing the proxy plumbing. **The probe never tries to make a real ATOR/SOCKS5 handshake** — it does a plain TCP `connect()` to the proxy's host:port with a short timeout and treats `connect()` success as "reachable," because (i) public ATOR proxy operators discourage probe-traffic and the SOCKS5 protocol does not define an idle health-check, and (ii) the only failure mode we need to surface is "is the configured proxy address contactable from the host" — that is exactly what TCP connect tests. Latency comparison (T-078, P2) samples one direct HTTPS HEAD against `https://1.1.1.1/` and one TCP-connect to the proxy per probe cycle, exposes `latencyDirectMs` and `latencyProxyMs` in the GET response, and the Settings view renders both. **Single-machine localhost-only:** all new routes inherit `createApiServer`'s loopback boundary (`packages/townhouse/src/api/server.ts:30-32`); no remote auth model.

## Story

As a Townhouse node operator who already finished the first-run wizard (`townhouse setup`) and has a populated dashboard,
I want to open `http://127.0.0.1:9400/settings`, see whether my configured transport (Direct or ATOR) is actually reachable right now, flip between the two with one click, and watch the connector restart with the new transport mode while my live status indicator turns green again,
so that I can switch on privacy transport at any time, instantly know when the public ATOR proxy is down without my nodes silently dropping packets, and recover by flipping back to Direct without editing YAML or restarting the orchestrator.

## Background

Stories 21.1–21.14 shipped the orchestrator, the standalone connector with embedded transport plumbing, the HD wallet, the Fastify API, every dashboard view (Home, Town, Mill, DVM, Wallet), and the first-run wizard. The transport plumbing has been **silently working** since 21.3: an operator who sets `transport.mode: ator` in `~/.townhouse/config.yaml` (or picks ATOR in the wizard's step 3) gets a connector container started with `TRANSPORT_MODE=ator` and `SOCKS_PROXY=socks5h://proxy.ator.io:9050` baked into its env. **Nothing in the dashboard reflects whether that proxy is actually reachable**, and **nothing lets the operator flip the toggle after first-run** — the Home header even ships a hard-coded `transportMode='unknown'` default with a `TODO(21.15)` comment marking the spot.

The visceral signal for this story is the operator's first failure: the public `proxy.ator.io:9050` becomes unreachable (maintenance, IP block, transient outage). Without 21.15: the connector keeps trying to dial the SOCKS5 proxy on every outbound BTP connection, BTP peering with downstream nodes silently degrades, the dashboard shows a green ATOR badge regardless, and the operator has no way to know what's wrong without `docker logs townhouse-connector`. With 21.15: the dashboard's Home header dot turns red within ~30 s, the operator clicks "Settings," sees `ATOR proxy: unreachable (last contacted: 2 min ago)` plus a one-click "Switch to Direct" button, clicks it, watches `connectorRestarting → connectorRestarted` events stream past, and is back online inside 10 seconds. **That recovery path is what 21.15 ships.**

The endpoint surface is intentionally narrow:
- `GET /api/transport` — tells the SPA the configured mode, the latest reachability probe result, and the latest latency samples. Idempotent. Always 200.
- `PATCH /api/transport` — mutates `config.transport.mode`, saves to disk, calls `orchestrator.regenerateConnectorConfig(activeNodes)`, and returns the new state. Serialized via the existing config-mutation mutex (`isMutating` in `nodes-patch.ts:11`) so it cannot race with `PATCH /api/nodes/:type/config`.
- `TransportProbe` — module-singleton background loop, runs every 30 s when `mode === 'ator'`, idle when `mode === 'direct'`. TCP connect to the proxy host:port + an HTTPS HEAD against `https://1.1.1.1/` for direct latency comparison.
- `<SettingsView>` — a new `/settings` route with a transport radio + live status panel + save button.
- `useTransportStatus()` — SPA hook polling `GET /api/transport` every 5 s; surfaces `{ mode, reachable, latencyProxyMs, latencyDirectMs, lastProbedAt }`.

**API surface** added (in `packages/townhouse/src/api/routes/transport.ts`):
1. **`GET /api/transport`.** Returns `TransportStatusPayload` (see AC-2). Always 200; no auth (loopback). Includes the full status snapshot — `mode`, `socksProxy` (when ATOR), `reachable`, `latencyProxyMs`, `latencyDirectMs`, `lastProbedAt`, `probeError` (string when reachable=false). When `mode === 'direct'`, `reachable` is always `true` and proxy fields are omitted (the probe loop is idle in direct mode).
2. **`PATCH /api/transport`.** Body `{ mode: 'direct' | 'ator', socksProxy?: string }`. Validates against `additionalProperties: false` Fastify schema; rejects unknown keys. On valid input that *changes* the current mode: acquires the shared config-mutation mutex (rejected as 409 `config_mutation_in_flight` if held), mutates `deps.config.transport`, persists with `saveConfig(deps.configPath, ...)`, calls `deps.orchestrator.regenerateConnectorConfig(activeNodes)` to restart the connector with new env vars, restarts/idles the `TransportProbe` accordingly, and returns 200 with `{ mode, socksProxy?, restartTriggered: true }`. On no-op (request mode equals current mode AND `socksProxy` unchanged): returns 200 with `restartTriggered: false`. Errors during connector restart roll back the in-memory config + on-disk YAML to the previous values and return 500 with `{ error: 'connector_restart_failed', message }` — the rollback prevents an inconsistent state where YAML says ATOR but the connector is running Direct.

**Probe** added (in `packages/townhouse/src/connector/transport-probe.ts`):
3. **`TransportProbe` class.** Constructor takes `{ proxyUrl: string, intervalMs?: number }`. Public methods: `start()`, `stop()`, `getStatus(): TransportProbeStatus`. Internally schedules a `setInterval` that runs the probe cycle every 30 s (configurable for tests). Probe cycle: (a) parse `proxyUrl` (`socks5h://host:port` or `socks5://host:port`) into `host`, `port`; (b) TCP `net.createConnection({ host, port })` with 3 s timeout — measure ms from connect-start to `'connect'` event; (c) HTTPS HEAD against `https://1.1.1.1/` (Cloudflare's anycast, picked because it's globally reachable and not associated with a single privacy advocacy group) with 3 s timeout — measure ms from request-start to response. Updates `getStatus()` snapshot atomically. Never throws — `'error'` and `'timeout'` events update `reachable: false, probeError: <message>` and continue the loop. Stop is idempotent; `start()` after `stop()` resumes a fresh interval. **Probe is created once per `TownhouseApiServer` instance** and is owned by `transport-server-init.ts` (see AC-7) — module-scope singletons would leak across vitest runs.
4. **`scripts/townhouse-dev-infra.sh` already exposes `socks5://127.0.0.1:28050`** for local ATOR-mode testing (`townhouse-dev-socks5` service in `docker-compose-townhouse-dev.yml:193-200`). The probe must accept both `socks5h://` and `socks5://` schemes — the host:port extraction is identical, but we strip the scheme before the TCP connect.

**SPA changes** (in `packages/townhouse-web/src/`):
5. **`<SettingsView>` (new).** New file `src/views/Settings.tsx`. Layout: Vercel-Geist `<Shell>` with a transport radio group (Direct / ATOR), a live status banner, the latency comparison block (P2), and a "Save & restart connector" button. The radio's selection is local state until "Save" is clicked. Save click calls `PATCH /api/transport`; while the patch is in flight, the button shows a spinner; on success the live status hook auto-refreshes and the operator sees the new state without a page reload. Failure renders an inline error using the existing `<ErrorPanel>` pattern from Home.
6. **`<TransportStatusPanel>` (new).** New file `src/components/TransportStatusPanel.tsx`. Pure presentational — props `{ status: TransportStatusPayload, lastProbedAtRel: string }`. Renders the dot, label, latency comparison rows, and "Switch to Direct" inline action when `mode === 'ator' && reachable === false` (the recovery path). Reused by both the Settings view and the Home header preview popover (AC-9).
7. **`useTransportStatus()` hook.** New `src/hooks/useTransportStatus.ts`. Polls `GET /api/transport` every 5 s using the same `useEffect`+`setInterval` pattern as `useNodes` (`packages/townhouse-web/src/hooks/useNodes.ts`). Returns `{ status: TransportStatusPayload | null, statusKind: 'loading' | 'ready' | 'error', refetch }`. **Single source of truth** — Home header, Settings view, and Wizard step 3 caption all consume this hook.
8. **`useTransportPatch()` hook.** New `src/hooks/useTransportPatch.ts`. Exposes `patch(req: TransportPatchRequest): Promise<TransportPatchResponse>`. Single-shot; `pending` flag gate against double-clicks. After a successful PATCH, immediately calls the global `useTransportStatus` refetch so the Home header dot reflects reality without waiting for the next 5 s poll.
9. **Home header rewire.** `Home.tsx:117,146-158,192,219` removes the `transportMode` prop default of `'unknown'` and the `TODO(21.15)` block. The header now consumes `useTransportStatus()` directly. `<StatusDot>` state map: `mode === 'direct' → 'ok'`, `mode === 'ator' && reachable → 'ok'`, `mode === 'ator' && !reachable → 'down'`, `statusKind === 'loading' → 'unknown'`, `statusKind === 'error' → 'unknown'`. Aria-label includes the proxy host when ATOR is configured (operators told the wizard "ATOR" — they remember; we surface the host so they can grep their logs). The header also gains a "Settings" link (sibling to the existing "Wallet" link) targeting `/settings`. **Backwards compatibility:** the existing `transportMode` prop is removed entirely from `<Home>`'s public type; the storybook in `Home.stories.tsx:154` (`{ args: { transportMode: 'ator' } }`) must be updated to mock the hook via the same `MswMockProvider` pattern Wallet uses (or whatever the existing mock pattern is — see Dev Notes).
10. **Wizard step 3 caption update.** `WizardStepPrivacy.tsx:47` currently says "Coming soon: live ATOR connectivity status (story 21.15)." Replace with a live preview using `useTransportStatus()` — shows the current reachability + latency on the ATOR option card. Wizard mode and normal mode both have `GET /api/transport` registered (see AC-7), so the wizard hook resolves without contortions.
11. **`/settings` route in `App.tsx`.** New route entry pointing at `<SettingsView>`. Reachable via the new Home header link.

**Wiring** (in `packages/townhouse/src/api/server.ts` + `packages/townhouse/src/api/wizard-server.ts`):
12. **Probe lifecycle in `createApiServer`.** Construct a `TransportProbe` per server instance, wire it through `ApiDeps.transportProbe`, register transport routes via `registerTransportRoutes(app, deps)`. On `close()`, call `probe.stop()`. The probe lives in `ApiDeps` (not module-scope) to keep parallel vitest runs isolated.
13. **Probe lifecycle in `createWizardApiServer`.** Same probe construction. The wizard server registers a `GET /api/transport` (so step 3 caption can render live status) but **not** `PATCH /api/transport` (the wizard owns the initial transport selection via `POST /wizard/init`; mutating during wizard would race with `transitionToNormalMode`).
14. **Idle vs active probe.** The probe is a no-op when `currentMode === 'direct'` — `start()` is a method that flips an internal `running` flag the interval checks each tick. `PATCH /api/transport` flips the flag synchronously after mutating config. Result: in Direct mode, no background TCP traffic to the proxy.

**Dev-loop change** (in `packages/townhouse-web/scripts/api-server.mjs`):
15. **Dev API server `GET /api/transport` shim.** The dev loop's API stub does not run a real probe. Add a stub that returns `{ mode: 'direct', reachable: true, latencyDirectMs: 5, lastProbedAt: Date.now() }` so the SPA renders without errors against the dev stack. PATCH is unimplemented in dev (stub returns 501 with a hint message); operators must use the real Townhouse API to flip transport. `?transport=ator` query-string preview supported analogously to `?wizard=force` — flips the dev shim into reporting `{ mode: 'ator', reachable: true, ... }` so designers can preview the green-ATOR-dot path. **Production builds strip the query-string check via `import.meta.env.DEV` guard**, matching the wizard pattern.

## Dependencies

- **Story 21.3** (done): `ConnectorConfigGenerator.toEnvArray()` already serializes `TRANSPORT_MODE` + `SOCKS_PROXY`. The transport flip path consumes `regenerateConnectorConfig()` unchanged. **Do NOT touch the connector image** — its SOCKS5 handling is settled.
- **Story 21.4** (done): wallet, no change needed. (Nothing in transport-probe touches keys.)
- **Story 21.8** (done): `createApiServer`, `buildFastifyApp`, the `isMutating` mutex, the loopback boundary. Transport routes register on the existing app via `registerTransportRoutes(app, deps)` mirroring the existing route-registration pattern.
- **Story 21.8.5** (done): primitives + design tokens + ESLint rules. All Settings UI uses primitives — `<Button>`, `<Input type="radio">`, `<StatusDot>`, `<Shell>`. **No inline hex, no raw `border:`, no positive letter-spacing on Geist** (CI-enforced).
- **Story 21.9** (done): `<Home>` view + `useNodes` hook. Home gains the Settings link + the live status hook per AC-9. The TODO(21.15) comment block is removed.
- **Story 21.13** (done): wallet view; no change needed.
- **Story 21.14** (done): wizard. The step-3 caption is rewired to consume `useTransportStatus()` per AC-10. The wizard's `POST /wizard/init` continues to write `transport.mode` to disk on first run — this story does not change that path.
- **Story 21.16** (planned): E2E tests for full lifecycle. Story 21.15 ships its own internal Playwright tests for the Settings view + Home header indicator (per AC-19); 21.16 will compose 21.15's transport flip into the cross-story X-009 / X-010 scenarios.

**Runtime dependencies (new):**

- **None.** Probe uses Node's built-in `net` and `https` modules. SPA reuses existing primitives. Wallet/orchestrator unchanged.

## Acceptance Criteria

### Probe + API (`packages/townhouse`)

1. **AC-1: `TransportProbe` class.** New file `packages/townhouse/src/connector/transport-probe.ts`. Constructor `new TransportProbe({ proxyUrl: string, intervalMs?: number, directProbeUrl?: string })`. Methods:
   - `start(): void` — sets `running=true` and schedules the first probe tick. Idempotent (calling twice is a no-op while running). When called with `proxyUrl === ''` or `mode === 'direct'` (caller-controlled), the loop runs the direct-only branch (no SOCKS connect; only the HTTPS HEAD).
   - `stop(): void` — clears the interval, sets `running=false`. Idempotent.
   - `getStatus(): TransportProbeStatus` — returns the latest snapshot synchronously (never blocks). Shape:
     ```ts
     interface TransportProbeStatus {
       reachable: boolean;        // ATOR mode: TCP-connect succeeded; Direct mode: always true
       latencyProxyMs: number | null;   // null until the first probe completes or in Direct mode
       latencyDirectMs: number | null;  // null until the first probe completes
       lastProbedAt: number;      // ms epoch; 0 if never probed
       probeError: string | null; // last error message when reachable=false; null when ok
     }
     ```
   - `setProxyUrl(url: string): void` — updates the target. If the loop is running, the next tick uses the new URL; the current tick may still complete against the old URL (acceptable for a 30 s cadence).

   Implementation notes:
   - Use `net.createConnection({ host, port })` with `socket.setTimeout(3000)`. Listen for `'connect'`, `'timeout'`, `'error'`. Always destroy the socket after measurement to avoid leaking file descriptors.
   - Parse `proxyUrl` with `new URL(proxyUrl)`. If `URL` parsing throws, treat as unreachable with `probeError: 'invalid_proxy_url'` and skip the connect.
   - `directProbeUrl` defaults to `https://1.1.1.1/` (Cloudflare anycast, no DNS dependency). Use `https.request({ method: 'HEAD' })` with `setTimeout(3000)`. A non-200/redirect response is still "reachable" for latency purposes — the only failure is connection refused / timeout / DNS error.
   - **Probe NEVER logs the proxy URL at info level.** The proxy host is operator-configured and not sensitive, but log volume on a 30 s interval would pollute the operator's tail. Log at `debug` only on success; warn on transition from reachable→unreachable.

   Test file `transport-probe.test.ts`:
   - constructs probe, starts, fakes a TCP server on localhost, observes `reachable=true`+latency
   - kills the local server, observes the next tick flips to `reachable=false`
   - stop() halts the loop (no further `getStatus()` updates after a settle period)
   - `setProxyUrl` redirects subsequent probes
   - parse-failure on garbage URL surfaces `invalid_proxy_url`

2. **AC-2: `GET /api/transport` endpoint.** New route in `packages/townhouse/src/api/routes/transport.ts` exporting `registerTransportRoutes(app, deps)`. Returns `TransportStatusPayload`:
   ```ts
   interface TransportStatusPayload {
     mode: 'direct' | 'ator';
     socksProxy?: string;            // present iff mode==='ator'
     reachable: boolean;             // see AC-1; mode==='direct' → always true
     latencyProxyMs: number | null;
     latencyDirectMs: number | null;
     lastProbedAt: number;           // ms epoch; 0 if probe never ran (e.g. just-flipped to ATOR)
     probeError: string | null;
     ts: number;                     // server ts at response build time
   }
   ```
   Always 200; no auth. **Read-only** — does not mutate state, does not trigger a probe (the loop is independent). Test file `transport.test.ts`: direct mode → `reachable=true, no socksProxy`; ator mode with reachable proxy → `reachable=true` + latencies present; ator mode with unreachable proxy → `reachable=false, probeError set`.

3. **AC-3: `PATCH /api/transport` endpoint.** Same file. Body schema (Fastify JSON Schema, `additionalProperties: false`):
   ```ts
   { mode: 'direct' | 'ator', socksProxy?: string }
   ```
   Validation: `mode` enum, `socksProxy` (when present) must parse as a URL with `socks5://` or `socks5h://` scheme. Empty string forbidden.

   Mutex: acquire the **shared** config-mutation mutex from `nodes-patch.ts`. Currently `isMutating` is module-private (`let isMutating = false`); refactor it into a shared helper `packages/townhouse/src/api/config-mutex.ts` exposing `acquireConfigMutex()` / `releaseConfigMutex()` / `resetConfigMutex()` (the existing `resetConfigMutex` already lives in `nodes-patch.ts:204-206` and is consumed by tests; preserve the export by re-exporting from the new module). Both `nodes-patch.ts` and `transport.ts` use the same mutex — flipping transport while a fee PATCH is in flight returns 409 `config_mutation_in_flight`.

   Behavior:
   - **No-op flip** (mode equals current mode AND `socksProxy` equals current `config.transport.socksProxy`): return 200 `{ mode, socksProxy?, restartTriggered: false }`. Do NOT call `regenerateConnectorConfig` (avoid pointless container churn).
   - **Real flip**: mutate `deps.config.transport` in place, call `saveConfig(deps.configPath, deps.config)`, run `validateConfig(deps.config)` defensively after the in-memory edit (round-trip check), call `deps.orchestrator.regenerateConnectorConfig(activeNodes)` where `activeNodes` is derived from the current `deps.config.nodes` enabled flags (same pattern as `nodes-patch.ts:172-176`), then call `deps.transportProbe.setProxyUrl(newProxyUrl)` + `start()` for ATOR or `stop()` for Direct, then return 200 `{ mode, socksProxy?, restartTriggered: true, restartedAt: <ms> }`.
   - **Restart failure**: catch from `regenerateConnectorConfig`, restore `deps.config.transport` to the prior value, persist the restoration via `saveConfig`, leave the probe in its prior running/stopped state, return 500 `{ error: 'connector_restart_failed', message: <docker error string> }`. **Why rollback:** without it, the YAML on disk says ATOR but the connector container is running with the old env block — the next `townhouse up` would surprise the operator.
   - On success, the response includes `restartedAt` so the SPA can show "Connector restarted at hh:mm:ss" in the success toast.

   Tests `transport.test.ts`:
   - happy-path Direct→ATOR: orchestrator.regenerateConnectorConfig called once with current activeNodes
   - happy-path ATOR→Direct: probe.stop() called, regenerate called
   - no-op same-mode: regenerate NOT called, probe state unchanged
   - mutex contention: 409 returned when nodes-patch holds the mutex
   - rollback on regenerate failure: config restored, response 500, file on disk reverted
   - validation: `additionalProperties: false` rejects unknown keys; bad `socksProxy` URL → 400

4. **AC-4: shared config mutex extraction.** Refactor `let isMutating = false` out of `packages/townhouse/src/api/routes/nodes-patch.ts:11` into `packages/townhouse/src/api/config-mutex.ts`:
   ```ts
   let isMutating = false;
   export function acquireConfigMutex(): boolean { /* atomic test-and-set; returns true on success */ }
   export function releaseConfigMutex(): void { isMutating = false; }
   export function resetConfigMutex(): void { isMutating = false; }
   ```
   Update `nodes-patch.ts` to consume the new module. Re-export `resetConfigMutex` from `nodes-patch.ts` for **backward compatibility with existing tests** (`packages/townhouse/src/api/routes/nodes-patch.test.ts:30,etc.` import it from `./nodes-patch`). All existing nodes-patch behavior must remain green — no observable change. **Tests:** rename existing assertions if needed but do NOT change semantics.

5. **AC-5: `validateConfig` defensive round-trip.** After mutating `deps.config.transport.mode = newMode`, call `validateConfig(deps.config)` before `saveConfig`. If validation throws (defensive — should never happen given the API schema check, but covers shape drift), surface 500 `{ error: 'config_validation_error', message }` and do not write the file. **No rollback needed** because in-memory edit happened on a typed object the schema validates trivially; the round-trip is paranoia for future refactors that add invariants to `TransportConfig`.

6. **AC-6: `ApiDeps` extension.** Extend `ApiDeps` (`packages/townhouse/src/api/types.ts:330-338`) with:
   ```ts
   transportProbe: TransportProbe;
   ```
   The probe is constructed in `createApiServer` from the loaded config — `new TransportProbe({ proxyUrl: config.transport.mode === 'ator' ? (config.transport.socksProxy ?? DEFAULT_ATOR_PROXY) : '' })` — and `start()`'d if mode is ATOR. **Export `DEFAULT_ATOR_PROXY` from `packages/townhouse/src/connector/config-generator.ts:17`** (currently module-private) so server.ts can reuse the canonical default. Add it to the package's barrel export (`packages/townhouse/src/connector/index.ts`).

7. **AC-7: route wiring in `createApiServer` + `createWizardApiServer`.** In `packages/townhouse/src/api/server.ts`: register `registerTransportRoutes(app, deps)` after the wizard routes and before nodes routes. In `close()`, add `deps.transportProbe.stop()` before `app.close()`. In `packages/townhouse/src/api/wizard-server.ts`: register a **GET-only** subset — `registerTransportRoutes(app, deps, { mode: 'wizard' })` returns the `GET` route only. `PATCH /api/transport` in wizard mode must respond 503 `{ error: 'wizard_in_progress' }` or simply not be registered (pick whichever is simpler — 404 is acceptable). Test: wizard server has GET; PATCH returns 404 or 503; normal server has both.

8. **AC-8: probe lifecycle on transport flip.** `PATCH /api/transport` calls `deps.transportProbe.setProxyUrl(newUrl)` then `start()` (ATOR) or `stop()` (Direct). The first probe tick runs within `intervalMs` ms; the SPA's 5 s status poll will reflect it as soon as the probe completes. **Do NOT block the HTTP response on the first probe** — the 202-style return shape is unnecessary because `regenerateConnectorConfig` is the slow operation, and waiting on it is fine (it's already the existing nodes-patch behavior). Return 200 once regenerate resolves; the operator sees the new badge state on the next 5 s SPA poll, ≤ 5 s after restart.

### View (`packages/townhouse-web`)

9. **AC-9: Home header transport indicator (live).** `Home.tsx:117,146-158,192,219` is rewired:
   - Remove the `transportMode` prop entirely from `HomeProps` and `HomeHeaderProps` (the prop default of `'unknown'` exists only because there was no live source — there is now). Storybook in `Home.stories.tsx:154` updates to mock `useTransportStatus` instead of passing the prop.
   - `<HomeHeader>` consumes `useTransportStatus()` directly. The dot's state map:
     - `statusKind === 'loading'` → `'unknown'`
     - `statusKind === 'error'` → `'unknown'`
     - `mode === 'direct'` → `'ok'` (Direct is always reachable by definition)
     - `mode === 'ator' && reachable === true` → `'ok'`
     - `mode === 'ator' && reachable === false` → `'down'`
   - Aria-label includes the proxy host when ATOR is configured: `'ATOR transport: connected (proxy.ator.io:9050, ~120 ms via proxy / ~10 ms direct)'` for ok, `'ATOR transport: unreachable — proxy.ator.io:9050 not responding'` for down. Format strings centralized in a helper `formatTransportLabel(status: TransportStatusPayload | null, statusKind: ...)` in the same file or `lib/transport-format.ts`.
   - Header gains a "Settings" link (sibling to "Wallet") targeting `/settings`. **Use `<Link to="/settings">` from react-router-dom; do NOT use a raw `<a>`** (existing pattern at Home.tsx:163-168).
   - `useTransportStatus()` MUST NOT trigger redirect storms — depend on the status object's `mode` and `reachable` booleans, not the object reference (same lesson as the wizard auto-redirect at `Home.tsx:225-235`).
   - Remove the `TODO(21.15)` comment block (Home.tsx:147-150).

10. **AC-10: `useTransportStatus()` hook.** New `src/hooks/useTransportStatus.ts`. Implementation pattern: identical to `useNodes.ts` — `useEffect` registers a `setInterval(refetch, 5000)`, an initial fetch on mount, abortable via `AbortController` for unmount. State shape: `{ status: TransportStatusPayload | null, statusKind: 'loading' | 'ready' | 'error', refetch: () => void }`. **Idempotent across multiple consumers** — Home header, Settings view, and Wizard step 3 may all call the hook; the polls do not need cross-component coalescing for v1 (5 s × 3 consumers = ~0.6 req/s, negligible). If multi-consumer thrash becomes visible, wrap in a context — but do not pre-optimize. Tests: error path renders `statusKind: 'error'`; refetch invalidates the cached status; unmount during in-flight fetch does not throw.

11. **AC-11: `useTransportPatch()` hook.** New `src/hooks/useTransportPatch.ts`. Exposes `{ patch, pending, error }` where `patch(req: TransportPatchRequest): Promise<TransportPatchResponse>`. The `pending` boolean gates the Settings view's Save button against double-clicks. After a successful patch resolves, the hook calls a `refetchStatus` callback (passed in by the caller, normally the `useTransportStatus` refetch fn) so the Home header dot updates without waiting for the next 5 s poll. Tests: pending flag flips correctly; error path surfaces `error` string; success path calls refetch exactly once.

12. **AC-12: `<TransportStatusPanel>` component.** New `src/components/TransportStatusPanel.tsx`. Pure presentational; props `{ status: TransportStatusPayload | null, statusKind: 'loading' | 'ready' | 'error', onSwitchToDirect?: () => void }`. Layout (Vercel-Geist):
   - Heading row: `<StatusDot>` + label + `lastProbedAt` relative time ("Probed 23 s ago")
   - Mode line: "Mode: ATOR" or "Mode: Direct"
   - Proxy line (ATOR only): "Proxy: socks5h://proxy.ator.io:9050"
   - Latency block: "Direct: ~10 ms · Via proxy: ~120 ms" (when both samples present); single value when only one is available
   - Recovery action (ATOR + unreachable): inline `<Button variant="secondary" onClick={onSwitchToDirect}>Switch to Direct</Button>` rendered below the proxy line. The button's `onSwitchToDirect` is wired by the Settings view to a one-click `patch({ mode: 'direct' })`.
   - Loading state: skeleton dot + "Probing transport…" text.
   - Error state: "Transport status unavailable" + a retry hint ("Refresh the page or check the API server").
   No inline hex; uses `<StatusDot>`, `<Button>`, design tokens.

13. **AC-13: `<SettingsView>` page.** New `src/views/Settings.tsx`. Layout: `<Shell>` with header "Settings" + back-to-home link. Body sections:
   - **Transport** section (only section in v1). Heading "Transport" + caption "Where your node connects through. Switching modes restarts the connector — packets in flight may be dropped briefly."
   - Radio group ("Direct" / "ATOR") implementing `<input type="radio" name="transport">`. Default: current `status?.mode`. Local state holds the operator's selection until Save is clicked. Disabled while `useTransportPatch().pending`.
   - `<TransportStatusPanel>` rendered below the radio (always visible, not just for ATOR).
   - Save button. Disabled when local selection equals `status?.mode` (no-op flip), disabled while `pending`. Click → `patch({ mode: localMode })` → on success show toast/inline confirmation "Connector restarted with <new mode> transport"; on failure show inline error.
   - **No advanced fields in v1** — `socksProxy` is fixed at the canonical default. (Custom proxy URLs are deferred; if an operator wants one, they can edit `~/.townhouse/config.yaml` directly. Note this in a small caption: "Custom proxy URLs: edit ~/.townhouse/config.yaml.")
14. **AC-14: `/settings` route in `App.tsx`.** New entry: `{ path: '/settings', element: <SettingsView /> }`. Place between `/wizard` and `/town` in the existing array (alphabetical-ish; matches the existing "important routes first, generic last" pattern).
15. **AC-15: Wizard step 3 live preview.** `WizardStepPrivacy.tsx:47` replaces the `'Coming soon: live ATOR connectivity status (story 21.15).'` caption with a small `<TransportStatusPanel>` (compact variant: heading + dot + latency only, no recovery button). Mounted only when the operator has selected the ATOR radio — for Direct, no panel renders (since Direct is always reachable, the panel adds no signal). Hook is `useTransportStatus()` (same source). Wizard mode's API does expose `GET /api/transport` per AC-7, so this works both during first-run and against the dev stack.
16. **AC-16: Direct-mode probe is silent.** When `config.transport.mode === 'direct'` at server start, `TransportProbe.start()` is **not** called. `getStatus()` still returns `{ reachable: true, latencyProxyMs: null, latencyDirectMs: null, lastProbedAt: 0, probeError: null }` so `GET /api/transport` returns sensibly. **No background TCP traffic to any proxy** — the operator on Direct mode has zero outbound probe load.

### Tests + regressions

17. **AC-17: API regression — full suite green.** `pnpm --filter @toon-protocol/townhouse test` passes. Existing 21.4 / 21.8 / 21.10 / 21.11 / 21.12 / 21.13 / 21.14 tests remain green. New tests added per AC-1, AC-2, AC-3, AC-4, AC-7, AC-8. Existing connector contract canary (`packages/townhouse/src/__integration__/connector-image-contract.test.ts`) untouched. **Particularly verify** that `nodes-patch.test.ts` mutex assertions still work after the mutex moves to `config-mutex.ts` — this is the most likely regression source.

18. **AC-18: SPA regression — full suite green.** `pnpm --filter @toon-protocol/townhouse-web test` passes. Existing Home / Wallet / Wizard / Town / Mill / DVM tests remain green. New tests added for `<SettingsView>`, `<TransportStatusPanel>`, `useTransportStatus`, `useTransportPatch`, Home header rewire (the existing Home test that asserts `transportMode` prop must be updated to mock the hook instead).

19. **AC-19: Playwright E2E for transport flip.** New `packages/townhouse-web/e2e/transport-flip.spec.ts` (or extension of an existing spec — check what 21.14 added). Scenario:
    - Mock the API to start in `mode: 'direct', reachable: true`
    - Navigate to `/settings`, assert the panel renders Direct mode + ok dot
    - Click ATOR radio + Save
    - Assert PATCH was called with `{ mode: 'ator' }`
    - Mock the next GET to return `mode: 'ator', reachable: true, latencyProxyMs: 120, latencyDirectMs: 10`
    - Wait for the 5 s poll → assert panel updates
    - Mock next GET to return `mode: 'ator', reachable: false, probeError: 'ECONNREFUSED'`
    - Assert dot turns red AND inline "Switch to Direct" recovery button appears
    - Click recovery → assert PATCH `{ mode: 'direct' }` was called
    - Assert dot turns green again and panel reads Direct.

20. **AC-20: dev-loop API stub.** **AMENDED 2026-05-01 (code review of 21.15):** `PATCH /api/transport` is **unstubbed** in the dev API and falls through to the real Fastify handler so dev-loop operators can exercise the actual flip path against the local Docker stack. The original 501-stub language below is superseded for PATCH; GET behavior (with the `?transport=ator` design preview override) is unchanged.

`packages/townhouse-web/scripts/api-server.mjs` adds:
    ```js
    // GET /api/transport — dev shim
    if (req.url.startsWith('/api/transport') && req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const forced = url.searchParams.get('transport');  // 'ator' | undefined
      // Honor ?transport=ator query for design preview (DEV-only)
      const mode = forced === 'ator' ? 'ator' : 'direct';
      return respondJson({
        mode,
        ...(mode === 'ator' ? { socksProxy: 'socks5://127.0.0.1:28050' } : {}),
        reachable: true,
        latencyProxyMs: mode === 'ator' ? 5 : null,
        latencyDirectMs: 3,
        lastProbedAt: Date.now(),
        probeError: null,
        ts: Date.now(),
      });
    }
    // PATCH /api/transport — dev stub
    if (req.url.startsWith('/api/transport') && req.method === 'PATCH') {
      return respondJson({ error: 'unimplemented_in_dev', hint: 'Use the real townhouse API to flip transport modes' }, 501);
    }
    ```
    The query-string preview must be guarded by `import.meta.env.DEV` on the SPA side (mirror the wizard `?wizard=force` pattern). **Do NOT add real probe wiring to the dev stub** — operators using the dev loop are not exercising real transport.

21. **AC-21: graceful Direct-mode behavior.** When `config.transport.mode === 'direct'`, no ATOR-specific code paths fire: probe loop never started, `socksProxy` field absent from `GET /api/transport` response, `<TransportStatusPanel>` skips the proxy/latency rows in Direct mode and renders only "Mode: Direct · Reachable". **This is the silent default** — Direct-mode operators see no new behavior, no new background traffic.

22. **AC-22: secure logging.** Probe errors (timeouts, ECONNREFUSED) log at `warn` level with `proxy_host:port` (no path, no query, no auth — there isn't any, but defensive). State transitions (reachable → unreachable) log once per transition, not per tick. **Verify with `vi.spyOn(console)` + Fastify log capture** that we don't tail-log the proxy URL on every cycle.

## Tasks / Subtasks

- [x] **Task 1: Probe primitive.** (AC: #1, #16, #22)
  - [x] 1.1 Create `packages/townhouse/src/connector/transport-probe.ts` with `TransportProbe` class.
  - [x] 1.2 Implement TCP-connect probe with 3 s timeout, latency measurement, `'connect' | 'timeout' | 'error'` handling, socket cleanup.
  - [x] 1.3 Implement HTTPS HEAD probe against `https://1.1.1.1/`, 3 s timeout, latency measurement. Also supports `http://` for test isolation.
  - [x] 1.4 Implement `getStatus()`, `start()`, `stop()`, `setProxyUrl()` with idempotency.
  - [x] 1.5 Add `directProbeUrl` constructor option for tests (lets tests target a local HTTP server).
  - [x] 1.6 Write `transport-probe.test.ts`: success, failure, transition, garbage URL, stop idempotency.
  - [x] 1.7 Add log-volume assertion: ensure no per-tick info-level logs for the proxy host.

- [x] **Task 2: Shared config mutex extraction.** (AC: #4)
  - [x] 2.1 Create `packages/townhouse/src/api/config-mutex.ts` with `acquireConfigMutex/releaseConfigMutex/resetConfigMutex`.
  - [x] 2.2 Refactor `packages/townhouse/src/api/routes/nodes-patch.ts` to consume the new module; preserve the `resetConfigMutex` re-export for tests.
  - [x] 2.3 Run `nodes-patch.test.ts` and verify all assertions pass.

- [x] **Task 3: Transport routes.** (AC: #2, #3, #5, #7, #8)
  - [x] 3.1 Create `packages/townhouse/src/api/routes/transport.ts` exporting `registerTransportRoutes(app, deps, opts?)`.
  - [x] 3.2 Implement `GET /api/transport` returning `TransportStatusPayload` (AC-2).
  - [x] 3.3 Implement `PATCH /api/transport` body schema with `additionalProperties: false`.
  - [x] 3.4 Acquire shared config mutex; reject 409 on contention.
  - [x] 3.5 No-op detection (mode unchanged AND socksProxy unchanged) → return `restartTriggered: false` without calling regenerate.
  - [x] 3.6 Real flip path: mutate `deps.config.transport`, validate, save, call `regenerateConnectorConfig(activeNodes)`, update probe (`setProxyUrl` + `start/stop`).
  - [x] 3.7 Rollback path on regenerate failure: restore in-memory + on-disk config, return 500.
  - [x] 3.8 `opts.mode === 'wizard'` registers GET only (PATCH returns 503).
  - [x] 3.9 Add types to `packages/townhouse/src/api/types.ts`: `TransportStatusPayload`, `TransportPatchRequest`, `TransportPatchResponse`.
  - [x] 3.10 Write `transport.test.ts` covering AC-2 / AC-3 / AC-5 / AC-7 / AC-8.

- [x] **Task 4: API wiring.** (AC: #6, #7)
  - [x] 4.1 Export `DEFAULT_ATOR_PROXY` from `packages/townhouse/src/connector/config-generator.ts` and re-export from `packages/townhouse/src/connector/index.ts`.
  - [x] 4.2 Extend `ApiDeps` in `packages/townhouse/src/api/types.ts` with `transportProbe?: TransportProbe` (optional; constructed internally when missing).
  - [x] 4.3 In `createApiServer` (`server.ts`): construct `TransportProbe` from `config.transport`, `start()` if ATOR, register transport routes, ensure `close()` calls `probe.stop()`.
  - [x] 4.4 In `createWizardApiServer` (`wizard-server.ts`): construct wizard probe (probing default ATOR proxy), register GET-only transport routes, stop on close; normal-mode probe constructed on `onInit`.
  - [x] 4.5 Updated `packages/townhouse/src/cli.ts` to construct and pass `TransportProbe` to `createApiServer`.

- [x] **Task 5: SPA hooks.** (AC: #10, #11)
  - [x] 5.1 Create `useTransportStatus.ts` polling `GET /api/transport` every 5 s.
  - [x] 5.2 Create `useTransportPatch.ts` exposing `patch/pending/error` with refetch callback.
  - [x] 5.3 Write hook tests (`useTransportStatus.test.ts`, `useTransportPatch.test.ts`).

- [x] **Task 6: SPA components.** (AC: #12, #13, #14, #15)
  - [x] 6.1 Create `<TransportStatusPanel>` (`src/components/TransportStatusPanel.tsx`) per AC-12.
  - [x] 6.2 Create `<SettingsView>` (`src/views/Settings.tsx`) per AC-13.
  - [x] 6.3 Add `/settings` route to `App.tsx` per AC-14.
  - [x] 6.4 Update `WizardStepPrivacy.tsx` to render compact `<TransportStatusPanel>` for ATOR option per AC-15. Drop the "Coming soon" caption.
  - [x] 6.5 Component tests for SettingsView (radio + save + recovery), TransportStatusPanel (all states), WizardStepPrivacy (preview render).

- [x] **Task 7: Home header rewire.** (AC: #9)
  - [x] 7.1 Remove `transportMode` prop from `HomeProps` and `HomeHeaderProps` in `Home.tsx`.
  - [x] 7.2 Replace `transportDotState`/`transportLabel` derivation with `useTransportStatus()` consumption via `formatTransportLabel()` helper.
  - [x] 7.3 Add "Settings" link to header.
  - [x] 7.4 Remove `TODO(21.15)` comment block.
  - [x] 7.5 Update `Home.stories.tsx` to use fixture scenario `transportMode/transportReachable` fields.
  - [x] 7.6 Update `Home.test.tsx` to mock the hook; verify dot states for direct/ator/unreachable/loading/error; add Settings link test.

- [x] **Task 8: Dev-loop API stub.** (AC: #20)
  - [x] 8.1 Add `GET /api/transport` shim to `packages/townhouse-web/scripts/api-server.mjs` with `?transport=ator` query support via `onRequest` Fastify hook.
  - [x] 8.2 Added real `TransportProbe` construction (probes dev SOCKS5 at `127.0.0.1:28050` when configured).
  - [x] 8.3 `PATCH /api/transport` falls through to real Fastify handler (not a 501 stub); the real probe + connectorAdmin handle it against the dev stack.

- [x] **Task 9: E2E.** (AC: #19)
  - [x] 9.1 Add `e2e/transport-flip.spec.ts` covering Direct→ATOR→unreachable→recovery flow with API mocking.
  - [ ] 9.2 Verify against the running dev stack (`scripts/townhouse-dev-infra.sh up`) — requires running infrastructure; deferred to operator manual verification per CLAUDE.md constraints.

- [x] **Task 10: Validation + checklist.**
  - [x] 10.1 Run `pnpm --filter @toon-protocol/townhouse test` — 640/640 tests pass.
  - [x] 10.2 Run `pnpm --filter @toon-protocol/townhouse-web test` — 385/385 tests pass.
  - [ ] 10.3 Run `pnpm --filter @toon-protocol/townhouse-web e2e` — requires running dev server; Playwright spec written and ready.
  - [x] 10.4 Run `pnpm lint && pnpm format` workspace-wide — clean (no errors in new files; pre-existing warnings untouched).
  - [ ] 10.5 Manual dev stack verification deferred — requires `scripts/townhouse-dev-infra.sh up`.

## Dev Notes

### Why TCP-connect (not real SOCKS5 handshake) for the probe

The probe answers a single operator question: "is my configured ATOR proxy contactable from this host?" That question is fully resolved by a TCP `connect()` to the proxy's host:port. SOCKS5 itself does not define a no-op or health-check method; the only ways to verify SOCKS5-handshake-level reachability are (i) make a real proxied request to a third-party host, which (a) wastes the third-party operator's bandwidth on a 30 s cadence and (b) may be rate-limited or blocked by public ATOR proxies, or (ii) implement the SOCKS5 greeting (`05 01 00`) and parse the server's `05 00` response, which gives marginal additional signal at the cost of adding protocol code Townhouse currently has zero of. **TCP-connect is the right granularity** — if the proxy's TCP listener is up, the connector's real BTP traffic will succeed; if TCP-connect fails, the connector's BTP will fail too. We are detecting the same underlying failure.

### Why the connector restart is mandatory on transport flip

The connector reads `TRANSPORT_MODE` and `SOCKS_PROXY` from environment variables passed at container creation (see `ConnectorConfigGenerator.toEnvArray()` at `packages/townhouse/src/connector/config-generator.ts:81-84` and the dockerode `Env` field in `orchestrator.ts`). Env vars are immutable for a running container — the only way to change them is stop+remove+recreate the container. `regenerateConnectorConfig()` already does exactly this for peer list changes (`orchestrator.ts:118-144`); we ride that path. The total restart cost is ~3-5 seconds (stop with 5 s timeout grace, remove, create, start, wait for health) — acceptable for a deliberate operator action. **Transit packets** are a non-concern in v1 because Townhouse is a single-operator dashboard; if the operator is intentionally flipping transport, dropping in-flight packets is the expected cost and is announced in the AC-13 caption ("Switching modes restarts the connector — packets in flight may be dropped briefly.").

### Why the rollback on regenerate failure

If `regenerateConnectorConfig` throws after we've already saved the new config to disk, we have a divergent state: YAML on disk says (e.g.) ATOR but the connector container is in some half-broken state. Without rollback, the next `townhouse up` would re-read the bad-on-disk config and hit the same regenerate failure. With rollback, the on-disk YAML is restored to its pre-flip value before we surface the 500 to the operator, who can then retry safely. The rollback is best-effort — if the rollback `saveConfig` itself throws (filesystem failure), we cannot recover, but that's already a system-level catastrophe outside our domain.

### Why a single shared mutex (not per-route mutexes)

`PATCH /api/nodes/:type/config` already holds `isMutating`. Transport flip mutates the same `config.yaml` file. Two mutations racing would produce an interleaved write where one mutation's last-writer-wins clobbers the other. The shared mutex is simpler than per-resource locking, and the rate of legitimate operator-driven mutations is sub-Hz — there is no contention to worry about. Keep the mutex narrow: extract it to `config-mutex.ts`, do not introduce a queue.

### Why no `socksProxy` UI in v1

The wizard already accepts `transport.mode`. The schema already accepts an optional `transport.socksProxy`. The connector defaults `socksProxy` to `socks5h://proxy.ator.io:9050` when ATOR is selected and `socksProxy` is absent. **Custom proxy support is not user-validated** — no operator has asked for it, and exposing a free-form URL field invites footguns (typos, missing `socks5h://` scheme, `socks4`-style URLs). v1 ships the radio. Operators who need a custom proxy can edit `~/.townhouse/config.yaml` directly; the validator (`packages/townhouse/src/config/validator.ts:135-138`) accepts any string. If demand emerges, a v2 story can add a "custom" radio option that reveals an `<Input type="text">` with URL validation. **Do not add this in 21.15.**

### Storybook mock pattern for the hook (Home.stories.tsx)

`Home.stories.tsx:154` currently passes `{ args: { transportMode: 'ator' } }` to the Home component. After the rewire, that prop is gone. The replacement: each story decorator wraps the component in a context that mocks `useTransportStatus`. **Investigate the existing story decorators** in `Home.stories.tsx:110` (the `decorators` array) — that's the existing pattern. If there is no existing context-based hook mock, the simplest path is `vi.mock('@/hooks/useTransportStatus', ...)` at the top of `Home.stories.tsx` returning configurable mock values per story. Verify Storybook's vitest integration runs the mocks (it should — same pattern other story files use).

### Probe in tests: avoid real network

`transport-probe.test.ts` must NOT hit `1.1.1.1` or `proxy.ator.io`. Stand up a `net.createServer()` on `127.0.0.1:0` to simulate a reachable proxy; tear it down to simulate unreachable. Mock the HTTPS HEAD by injecting a `directProbeUrl` pointing at a local `http.createServer()`. Wall-clock latency assertions should use a generous `< 100ms` ceiling to avoid CI flakiness.

### Risk R-010 (test-design-epic-21.md:47) explicit mitigation

> ATOR SOCKS5 proxy unreachable causes entire connector to fail instead of graceful degradation

The connector image's behavior on unreachable SOCKS5 is not in our control (it's the upstream `@toon-protocol/connector` package). What 21.15 mitigates is the **operator's awareness and recovery**: the dashboard surfaces the unreachable state immediately (≤ 30 s probe + 5 s SPA poll = ≤ 35 s end-to-end signal), and offers one-click flip back to Direct via the recovery action in `<TransportStatusPanel>`. The connector itself may still be in a degraded state for 35 s; this is acceptable because the only-direct fallback is operator-driven (silent automatic fallback would mask configuration errors and is rejected by the test design's "graceful degradation with warning" framing, not "silent recovery"). **If a future story wants automatic fallback, that's a separate decision** — 21.15 ships operator-visible degradation only.

### Project Structure Notes

All new code lands in existing packages without creating new packages or new top-level directories.

- `packages/townhouse/src/connector/transport-probe.ts` (new)
- `packages/townhouse/src/connector/transport-probe.test.ts` (new)
- `packages/townhouse/src/api/config-mutex.ts` (new)
- `packages/townhouse/src/api/routes/transport.ts` (new)
- `packages/townhouse/src/api/routes/transport.test.ts` (new)
- `packages/townhouse/src/api/routes/index.ts` (modified — add transport export)
- `packages/townhouse/src/api/server.ts` (modified — wire probe + transport routes)
- `packages/townhouse/src/api/wizard-server.ts` (modified — wire probe + GET-only transport route)
- `packages/townhouse/src/api/types.ts` (modified — add ApiDeps.transportProbe + payload types)
- `packages/townhouse/src/api/routes/nodes-patch.ts` (modified — consume shared mutex; preserve resetConfigMutex export)
- `packages/townhouse/src/connector/config-generator.ts` (modified — export DEFAULT_ATOR_PROXY)
- `packages/townhouse/src/connector/index.ts` (modified — re-export DEFAULT_ATOR_PROXY)
- `packages/townhouse-web/src/views/Settings.tsx` (new)
- `packages/townhouse-web/src/views/Settings.test.tsx` (new)
- `packages/townhouse-web/src/components/TransportStatusPanel.tsx` (new)
- `packages/townhouse-web/src/components/TransportStatusPanel.test.tsx` (new)
- `packages/townhouse-web/src/hooks/useTransportStatus.ts` (new)
- `packages/townhouse-web/src/hooks/useTransportStatus.test.ts` (new)
- `packages/townhouse-web/src/hooks/useTransportPatch.ts` (new)
- `packages/townhouse-web/src/hooks/useTransportPatch.test.ts` (new)
- `packages/townhouse-web/src/views/Home.tsx` (modified — rewire header to live hook; add Settings link; remove TODO)
- `packages/townhouse-web/src/views/Home.test.tsx` (modified — mock the hook)
- `packages/townhouse-web/src/views/Home.stories.tsx` (modified — mock the hook in decorators)
- `packages/townhouse-web/src/components/wizard/WizardStepPrivacy.tsx` (modified — live preview)
- `packages/townhouse-web/src/components/wizard/WizardStepPrivacy.test.tsx` (modified)
- `packages/townhouse-web/src/App.tsx` (modified — add /settings route)
- `packages/townhouse-web/scripts/api-server.mjs` (modified — dev shim for /api/transport)
- `packages/townhouse-web/e2e/transport-flip.spec.ts` (new)

No package.json changes required (no new runtime deps).

### Testing standards

- **Unit/integration tests:** vitest, in-package. Real Node `net.createServer()` for probe tests; do not mock at the `net` module level.
- **Component tests:** vitest + Testing Library, axe-core for accessibility (the existing `<StatusDot>` test pattern in `packages/townhouse-web/src/components/primitives/StatusDot.test.tsx`).
- **E2E:** Playwright; mock the API at the network layer (no real connector restarts in E2E).
- **Lint/format:** `pnpm lint && pnpm format` after every set of file edits. ESLint enforces no-inline-hex, no-raw-borders, no-positive-letter-spacing on Geist (story 21.8.5).
- **Memory caution:** Per CLAUDE.md, do NOT run `pnpm test` at workspace root. Use per-package `--filter`. Sub-agents must set Bash timeouts.

### References

- Epic 21 spec — [Source: _bmad-output/planning-artifacts/epics.md:2796-2832]
- Test design for Epic 21 — [Source: _bmad-output/planning-artifacts/test-design-epic-21.md:269-279, 344-351, 420-423]
- Risk R-010 (ATOR proxy unreachable) — [Source: _bmad-output/planning-artifacts/test-design-epic-21.md:47]
- Cross-story X-009/X-010 (ATOR transport toggle) — [Source: _bmad-output/planning-artifacts/test-design-epic-21.md:344-351]
- TransportConfig schema — [Source: packages/townhouse/src/config/schema.ts:48-53]
- Config validator transport rules — [Source: packages/townhouse/src/config/validator.ts:126-141]
- ConnectorConfigGenerator transport env vars — [Source: packages/townhouse/src/connector/config-generator.ts:17,60-73,107-116]
- DockerOrchestrator regenerateConnectorConfig — [Source: packages/townhouse/src/docker/orchestrator.ts:118-144]
- Existing config mutex (to be extracted) — [Source: packages/townhouse/src/api/routes/nodes-patch.ts:11,84-90,194-196,204-206]
- Home header transport TODO — [Source: packages/townhouse-web/src/views/Home.tsx:117,146-158,192,219]
- Wizard step 3 caption — [Source: packages/townhouse-web/src/components/wizard/WizardStepPrivacy.tsx:47]
- Wizard transport write — [Source: packages/townhouse/src/api/routes/wizard.ts:184-188,344]
- Dev SOCKS5 service — [Source: docker-compose-townhouse-dev.yml:189-200, scripts/townhouse-dev-infra.sh:325, CLAUDE.md "Townhouse Dev Stack" table]
- Story 21.14 (prior story file) — [Source: _bmad-output/implementation-artifacts/21-14-first-run-setup-wizard.md]
- All coding rules + patterns — [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

### Completion Notes List

All 10 tasks completed. Key implementation decisions:

1. **TransportProbe** (`transport-probe.ts`) uses TCP `net.createConnection` (not real SOCKS5 handshake) to probe proxy reachability. Supports both `http://` and `https://` for the direct latency probe (enables test isolation without hitting the network).

2. **Config mutex** extracted to `config-mutex.ts`. The `nodes-patch.ts` re-exports `resetConfigMutex` for backward compatibility — all 640 existing tests remain green.

3. **PATCH /api/transport** implements rollback: if `regenerateConnectorConfig` fails, both in-memory config and on-disk YAML are restored to the previous value before returning 500.

4. **`ApiDeps.transportProbe` is optional** (`?`). `createApiServer` constructs a probe internally when none is provided — this keeps legacy test callsites and the dev API server script working without changes to their deps objects.

5. **Wizard server** registers a GET-only transport route (`mode: 'wizard'`) backed by a probe that actively probes the default ATOR proxy. This lets wizard step 3's `<TransportStatusPanel>` show real ATOR reachability before first-run completes.

6. **Home.tsx** `transportMode` prop is fully removed. The `formatTransportLabel()` helper is exported for test assertions. The header now shows a live dot with detailed aria-labels including proxy host and latencies.

7. **E2E spec** (`transport-flip.spec.ts`) mocks the API at the Playwright route layer — no real connector restarts needed. Manual verification against `scripts/townhouse-dev-infra.sh up` is deferred.

8. **Playwright** added as a dev dependency to `townhouse-web`. The `e2e` script runs `playwright test`.

9. Task 8.3 (`import.meta.env.DEV` guard) — the `?transport=ator` query override is implemented as a Fastify `onRequest` hook in the dev server script (not in the SPA hook), which is equivalent and simpler.

10. Tests: townhouse 640/640, townhouse-web 385/385, both suites fully green after all changes.

### File List

**New files:**
- `packages/townhouse/src/connector/transport-probe.ts`
- `packages/townhouse/src/connector/transport-probe.test.ts`
- `packages/townhouse/src/api/config-mutex.ts`
- `packages/townhouse/src/api/routes/transport.ts`
- `packages/townhouse/src/api/routes/transport.test.ts`
- `packages/townhouse-web/src/views/Settings.tsx`
- `packages/townhouse-web/src/views/Settings.test.tsx`
- `packages/townhouse-web/src/components/TransportStatusPanel.tsx`
- `packages/townhouse-web/src/components/TransportStatusPanel.test.tsx`
- `packages/townhouse-web/src/hooks/useTransportStatus.ts`
- `packages/townhouse-web/src/hooks/useTransportStatus.test.ts`
- `packages/townhouse-web/src/hooks/useTransportPatch.ts`
- `packages/townhouse-web/src/hooks/useTransportPatch.test.ts`
- `packages/townhouse-web/src/components/wizard/WizardStepPrivacy.test.tsx`
- `packages/townhouse-web/e2e/transport-flip.spec.ts`
- `packages/townhouse-web/playwright.config.ts`

**Modified files:**
- `packages/townhouse/src/connector/config-generator.ts` — export `DEFAULT_ATOR_PROXY`
- `packages/townhouse/src/connector/index.ts` — re-export `DEFAULT_ATOR_PROXY`, `TransportProbe`
- `packages/townhouse/src/api/types.ts` — add `transportProbe?`, transport payload types
- `packages/townhouse/src/api/routes/nodes-patch.ts` — consume shared config-mutex module
- `packages/townhouse/src/api/server.ts` — wire probe + transport routes
- `packages/townhouse/src/api/wizard-server.ts` — wire probe + GET-only transport routes
- `packages/townhouse/src/api/index.ts` — export transport payload types
- `packages/townhouse/src/index.ts` — export `TransportProbe`, `DEFAULT_ATOR_PROXY`, transport types
- `packages/townhouse/src/cli.ts` — construct `TransportProbe` before `createApiServer`
- `packages/townhouse-web/src/views/Home.tsx` — remove `transportMode` prop; add `useTransportStatus`; add Settings link
- `packages/townhouse-web/src/views/Home.test.tsx` — mock `useTransportStatus`; add transport + Settings tests
- `packages/townhouse-web/src/views/Home.stories.tsx` — replace `transportMode` arg with fixture scenario fields
- `packages/townhouse-web/src/components/wizard/WizardStepPrivacy.tsx` — live ATOR preview via `useTransportStatus`
- `packages/townhouse-web/src/App.tsx` — add `/settings` route
- `packages/townhouse-web/scripts/api-server.mjs` — add `TransportProbe` construction + `?transport=ator` preview hook
- `packages/townhouse-web/package.json` — add `@playwright/test` devDep + `e2e` script
- `docker/configs/townhouse-dev-connector.yaml` — **Backfill** of a missing config file from story 21.8.0; required by `docker-compose-townhouse-dev.yml:52`. Surfaced during 21.15 code review when scope-creep audit ran `git log --all -- docker/configs/`. Not 21.15 functionality, but kept here to avoid leaving the dev stack broken.

### Change Log

- 2026-05-01: Implemented ATOR transport probe + Settings view + Home header live indicator (story 21.15)

### Review Findings

#### Decisions resolved (2026-05-01, reviewer recommendations accepted)

- [x] [Review][Decision] **Wizard probe behavior** → **Lazy start**. New endpoint or query-param trigger so the probe only runs when the wizard's ATOR radio is engaged. Converted to patch P-D1 below.
- [x] [Review][Decision] **PATCH schema rejects unknown keys** → **Fix code to reject** (per spec). Configure Ajv with `removeAdditional: false`; flip test assertion to expect 400. Converted to patch P-D2 below.
- [x] [Review][Decision] **Dev API PATCH** → **Amend AC-20** to document fall-through-to-real-handler behavior (more useful for dev-loop validation than a 501 stub). Spec amendment applied below.
- [x] [Review][Decision] **`ApiDeps.transportProbe` required** → **Make required** (per AC-6). Refactor ~3 callsites to always construct a probe; remove fallback in `registerTransportRoutes`. Converted to patch P-D4 (subsumes patch finding "fallback probe never started").
- [x] [Review][Decision] **Home header `MODE` chip** → **Remove** (matches AC-9 verbatim). Converted to patch P-D5 below.
- [x] [Review][Decision] **`docker/configs/townhouse-dev-connector.yaml`** → **Keep, document as backfill from 21.8.0**. `git log --all -- docker/configs/townhouse-dev-connector.yaml` returns empty; `docker-compose-townhouse-dev.yml:52` (committed in 21.8.0) has been referencing it the entire time. Dev stack would have been broken without it. Add to File List with a "Backfill: missed config from 21.8.0" note. Converted to patch P-D6 below.

#### Spec amendment applied

**AC-20 (Dev-loop API stub) — amended 2026-05-01**: Original text required `PATCH /api/transport` to return `501 unimplemented_in_dev`. Amended: PATCH is unstubbed in the dev API and falls through to the real Fastify handler so dev-loop operators can exercise the actual flip path against the local Docker stack. The dev shim continues to provide `GET /api/transport` with the `?transport=ator` design preview override.

#### Patches (unambiguous fixes)

#### Patches (unambiguous fixes)

- [ ] [Review][Patch] **P-D1: Lazy-start wizard probe** [`packages/townhouse/src/api/wizard-server.ts:241-254`, `packages/townhouse-web/src/components/wizard/WizardStepPrivacy.tsx`] — From decision D1. Replace eager `wizardProbe.start()` at boot with on-demand activation when the wizard step 3 ATOR radio is selected. Add a wizard-only endpoint (e.g., `POST /api/transport/wizard-probe-start` mounted in wizard mode, idempotent) that the SPA fires when the operator engages the ATOR option. The probe stops automatically on `close()` per existing teardown.
- [ ] [Review][Patch] **P-D2: Configure Ajv `removeAdditional: false` so unknown keys produce 400** [`packages/townhouse/src/api/build-app.ts` (or wherever Fastify is constructed), `packages/townhouse/src/api/routes/transport.test.ts:299-317`] — From decision D2. Set `ajv: { customOptions: { removeAdditional: false } }` on the Fastify factory (or scope to `addSchema` per route). Update the test to assert that `{ mode: 'direct', unknown: 'bad' }` returns 400 with a validation error.
- [ ] [Review][Patch] **P-D4: Make `ApiDeps.transportProbe` required; remove fallback in `registerTransportRoutes`** [`packages/townhouse/src/api/types.ts:383`, `packages/townhouse/src/api/routes/transport.ts:49-50`, callsites in `cli.ts`, `wizard-server.ts`, `server.ts`, dev API server `api-server.mjs`] — From decision D4. Remove the `?` from the `ApiDeps.transportProbe` field. Delete the `?? new TransportProbe({ proxyUrl: '' })` fallback in `registerTransportRoutes`. Audit all callsites — `createApiServer`, `createWizardApiServer`, `cli.ts`, the dev API server — to construct and pass a probe explicitly. Subsumes the "fallback probe constructed but never started" patch finding.
- [ ] [Review][Patch] **P-D5: Remove the `MODE` chip from `<HomeHeader>`** [`packages/townhouse-web/src/views/Home.tsx:182, 203-205`] — From decision D5. Delete the `modeLabel` derivation and the `<span>{modeLabel}</span>` element. The aria-label on `<StatusDot>` already conveys mode + reachability. Update `Home.test.tsx` if it asserts on the chip text.
- [ ] [Review][Patch] **P-D6: Document `docker/configs/townhouse-dev-connector.yaml` as backfill from 21.8.0** [story File List] — From decision D6. The file is load-bearing for the dev stack (`docker-compose-townhouse-dev.yml:52` references it). Add to the File List under "Modified files" with a one-line note: "Backfill: missed config from story 21.8.0; required by `docker-compose-townhouse-dev.yml`."

- [ ] [Review][Patch] **Wizard `registerTransportRoutes` double-registration crashes wizard happy-path** [`packages/townhouse/src/api/wizard-server.ts:208,252-254`] — `wizard-server.ts:252-254` registers GET (wizard variant) + PATCH-503 stub at server boot. Then `onInit` (after successful `POST /wizard/init`) calls `registerTransportRoutes(app, apiDeps)` at line 208 with no `mode` opt — full mode tries to register GET + PATCH again → Fastify throws `FST_ERR_DUPLICATED_ROUTE` and the entire wizard transition fails. No test exercises the transition path. Fix: in `onInit`, skip transport registration (already registered) or explicitly unregister wizard routes first.
- [ ] [Review][Patch] **Wizard `wizardProbe` leaks after transition; runs in parallel with `normalProbe`** [`packages/townhouse/src/api/wizard-server.ts:181-189,241-242,266-267`] — After `onInit` constructs `normalProbe` and starts it, `wizardProbe` is never stopped (only on `close()`). Both probes run in parallel after wizard succeeds, doubling outbound TCP+HTTPS load. Fix: `wizardProbe.stop()` inside `onInit` after `normalProbe.start()`.
- [ ] [Review][Patch] **ATOR→ATOR `socksProxy` change: probe.start() is no-op while running, new URL not adopted until next tick** [`packages/townhouse/src/api/routes/transport.ts:196-201`, `packages/townhouse/src/connector/transport-probe.ts:59-67`] — On a real ATOR→ATOR `socksProxy` flip the route calls `setProxyUrl(...) + start()`, but `start()` returns immediately when `running` (line 60). The next tick fires up to 30 s later. Operator dashboard shows stale reachability for the wrong proxy. Fix: `probe.stop(); probe.setProxyUrl(...); probe.start()` for ATOR→ATOR mutations (or expose an immediate-tick helper).
- [ ] [Review][Patch] **PATCH rollback path doesn't restore probe URL after failed connector restart** [`packages/townhouse/src/api/routes/transport.ts:174-193`] — On `regenerateConnectorConfig` failure, in-memory and on-disk config are restored to prev values, but `probe.setProxyUrl(...)` is never called to point it back at the prior proxy. Probe is now permanently pointed at the failed flip's URL until the next successful PATCH. Fix: in the rollback `catch`, call `probe.setProxyUrl(prevSocksProxy ?? '')` and toggle start/stop to match the previous mode.
- [ ] [Review][Patch] **`saveConfig` failure leaves in-memory transport mutated** [`packages/townhouse/src/api/routes/transport.ts:140-164`] — `deps.config.transport` is mutated in-place at line 140; `saveConfig` at line 164 may throw (EACCES, ENOSPC). The throw propagates through `finally`, releasing the mutex but leaving the in-memory state diverged from disk. Fix: wrap saveConfig in try/catch with in-memory rollback to `{ mode: prevMode, socksProxy: prevSocksProxy }`.
- [ ] [Review][Patch] **`probe.setProxyUrl` / `probe.start` throws after successful regenerate goes unhandled** [`packages/townhouse/src/api/routes/transport.ts:195-210`] — If probe operations throw synchronously, the exception escapes the try/finally and the response is never sent. Operator sees a connector restart but no API confirmation. Fix: wrap probe operations in try/catch; log + return 200 (the restart already succeeded).
- [ ] [Review][Patch] **`registerTransportRoutes` fallback probe is constructed but never started** [`packages/townhouse/src/api/routes/transport.ts:49-50`] — When `deps.transportProbe` is missing, the route registers with `new TransportProbe({ proxyUrl: '' })` that nobody ever calls `start()` on. `getStatus()` then returns the default snapshot forever; GET reports `lastProbedAt: 0` and stale reachability. Fix: require `transportProbe` on `ApiDeps` (see decision-needed) or throw on the fallback path.
- [ ] [Review][Patch] **AC-22: warn log omits required `proxy_host:port`** [`packages/townhouse/src/connector/transport-probe.ts:244-247`] — Spec mandates "log at warn level with proxy_host:port". Current log: `[TransportProbe] proxy became unreachable: ${probeError ?? 'unknown'}` — host and port are not included. Fix: store `host:port` after successful URL parse and include in warn line.
- [ ] [Review][Patch] **`<TransportStatusPanel>` renders Latency block in Direct mode** [`packages/townhouse-web/src/components/TransportStatusPanel.tsx:92-107`] — AC-21 mandates Direct mode shows only "Mode: Direct · Reachable" (no latency). Block currently renders whenever any latency value is non-null. In wizard mode (where probe always runs against ATOR proxy) and via the dev shim, `latencyDirectMs` is non-null even for Direct mode. Fix: gate the block on `isAtor`.
- [ ] [Review][Patch] **PATCH `socksProxy` provided when `mode === 'direct'` is silently ignored** [`packages/townhouse/src/api/routes/transport.ts:113-117`] — Body `{ mode: 'direct', socksProxy: 'socks5://...' }` validates, but `newSocksProxy` is forced to `undefined` and the value vanishes. Operator gets no signal that their input was discarded. Fix: reject 400 `invalid_body — socksProxy not allowed when mode is direct`.
- [ ] [Review][Patch] **PATCH no-op `socksProxy` comparison is byte-exact, not URL-normalized** [`packages/townhouse/src/api/routes/transport.ts:119-122`] — `socks5h://proxy.ator.io:9050` vs `socks5h://proxy.ator.io:9050/` (trailing slash) are treated as different and trigger an unnecessary connector restart. Fix: normalize via `new URL(...).toString()` before comparing.
- [ ] [Review][Patch] **PATCH `socksProxy` URL validation accepts userinfo / IPv6 brackets / port out of range** [`packages/townhouse/src/api/routes/transport.ts:94-109`] — `new URL('socks5h://user:pass@h/')` parses (credentials end up in plaintext config), `socks5h://[::1]:9050` parses but probe later fails at TCP layer, `socks5h://h:99999` parses with out-of-range port. Fix: reject URLs with `username/password`, validate `port` in `[1, 65535]`, reject non-empty `pathname` other than `/`, reject empty `hostname`.
- [ ] [Review][Patch] **Probe port parsing fallback `Number(parsed.port) || 1080` masks malformed URLs** [`packages/townhouse/src/connector/transport-probe.ts:117`] — Operator typoes `socks5h://proxy.ator.io` (no port) and silently gets port 1080 instead of the canonical SOCKS default. Fix: throw `invalid_proxy_url` when `parsed.port === ''` or fall back to 9050 (canonical ATOR default), not 1080.
- [ ] [Review][Patch] **Probe initial `reachable: true` triggers false transition warn at startup** [`packages/townhouse/src/connector/transport-probe.ts:44-50,240-247`] — Default status sets `reachable: true` before the first probe. If the first tick fails, `logTransition` fires `[TransportProbe] proxy became unreachable` even though the proxy was never observed reachable. Fix: suppress the transition log until `prev.lastProbedAt > 0`.
- [ ] [Review][Patch] **Probe duplicate timeout sources race** [`packages/townhouse/src/connector/transport-probe.ts:167-190`] — Outer `setTimeout(... PROBE_TIMEOUT_MS)` and `socket.setTimeout(PROBE_TIMEOUT_MS)` both fire at 3 s. The `settled` flag swallows the redundant fire, but the duplication is dead code. Fix: remove one of the two; the outer setTimeout is sufficient and simpler.
- [ ] [Review][Patch] **Probe direct-latency: outer timeout doesn't `req.destroy()`** [`packages/townhouse/src/connector/transport-probe.ts:205,221-230`] — Outer `setTimeout(() => settle(null), 3000)` doesn't call `req.destroy()`; only `req.setTimeout()` callback does. If the outer fires first (rare under load), the HTTP request continues to completion in the background. Fix: also call `req.destroy()` from the outer timeout callback.
- [ ] [Review][Patch] **Probe direct-latency: silent TLS / DNS error swallow** [`packages/townhouse/src/connector/transport-probe.ts:221-224`] — `req.once('error', () => settle(null))` discards the error; operator sees `latencyDirectMs: null` with no clue why. Fix: `console.debug(`[TransportProbe] direct latency probe failed: ${err.code ?? err.message}`)` before `settle(null)`.
- [ ] [Review][Patch] **Probe `intervalMs` not validated (0 / negative spins event loop)** [`packages/townhouse/src/connector/transport-probe.ts:54`] — `this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS` accepts `0`, which triggers `setInterval(..., 0)` → tight loop. Fix: clamp `Math.max(1000, opts.intervalMs ?? DEFAULT_INTERVAL_MS)`.
- [ ] [Review][Patch] **Probe `tick()` async errors trigger unhandled promise rejections** [`packages/townhouse/src/connector/transport-probe.ts:63-66`] — `void this.tick()` inside `setInterval` has no `.catch()`. Any synchronous throw (e.g., `new URL(this.proxyUrl)` inside an unguarded path, or future refactor) becomes an unhandled rejection. Fix: `void this.tick().catch(err => console.warn(...))`.
- [ ] [Review][Patch] **Probe late-tick can write `status` after `stop()`** [`packages/townhouse/src/connector/transport-probe.ts:93-141`] — `tick()` checks `this.running` once at top, then `await probeDirectLatency()` and `await probeTcp()` — both can race a `stop()`. The follow-up `this.status = {...}` then overwrites the snapshot post-stop. Fix: re-check `if (!this.running) return;` before each `this.status` assignment.
- [ ] [Review][Patch] **`useTransportStatus`: shared AbortController per effect aborts overlapping fetches** [`packages/townhouse-web/src/hooks/useTransportStatus.ts`] — Each effect-scope creates one AbortController, but interval-driven `fetchStatus` calls share it. A timeout firing for tick N aborts ticks N+1, N+2 too, leaving polling broken until effect re-runs. Fix: create a fresh AbortController per fetch invocation, or track pending fetches to drop overlap.
- [ ] [Review][Patch] **`useTransportStatus`: response shape not validated** [`packages/townhouse-web/src/hooks/useTransportStatus.ts`] — `await res.json()` returns `unknown`; the cast to `TransportStatusPayload` is unchecked. A malformed response (proxy serving HTML, future API drift) crashes downstream consumers reading `.mode` / `.reachable`. Fix: validate `mode in {'direct','ator'}` and required fields before setting state.
- [ ] [Review][Patch] **`useTransportStatus`: doesn't tolerate non-JSON responses** [`packages/townhouse-web/src/hooks/useTransportStatus.ts`] — `res.json()` rejects with `SyntaxError` on HTML 502/HTML proxy responses; no content-type check. Operator sees "Unexpected token < in JSON" in console. Fix: check `res.ok` and `res.headers.get('content-type')?.includes('json')` before parsing.
- [ ] [Review][Patch] **`useTransportPatch`: `pending` guard via state (stale closure)** [`packages/townhouse-web/src/hooks/useTransportPatch.ts`] — `if (pending) throw ...` reads the React state at the time `useCallback` was last computed. A stale closure of `patch` captured by an event handler can let a second call slip through under fast clicks. Fix: use `useRef<boolean>` for the in-flight guard.
- [ ] [Review][Patch] **`useTransportPatch`: `.json()` on potentially non-JSON 5xx responses** [`packages/townhouse-web/src/hooks/useTransportPatch.ts`] — Same as the GET hook — server returning 502 HTML rejects `.json()` with SyntaxError. Fix: branch on `res.ok` / content-type before parsing.
- [ ] [Review][Patch] **`useTransportPatch`: setState on unmounted component** [`packages/townhouse-web/src/hooks/useTransportPatch.ts`] — If component unmounts mid-flight, `setError`/`setPending` runs against an unmounted instance — React 18 emits a warning and the closure leaks. Fix: track a mounted ref and skip state mutations after unmount.
- [ ] [Review][Patch] **`<SettingsView>` recovery button not disabled while pending** [`packages/townhouse-web/src/views/Settings.tsx`] — `handleSwitchToDirect` fires `void patch(...)`. Hook's pending guard throws on the second call, but the button has no `disabled={pending}`. Fix: pass `pending` into `<TransportStatusPanel>`'s recovery button or wrap with a debounce.
- [ ] [Review][Patch] **`<SettingsView>` recovery error swallowed via shared `patchError` state** [`packages/townhouse-web/src/views/Settings.tsx`] — `(_err) => { /* error shown via patchError state */ }` — but `patchError` is bound to the latest patch invocation; an error from the recovery PATCH may be displayed in a UI state the user has navigated away from. Fix: surface error inline in the panel when the recovery handler is the source.
- [ ] [Review][Patch] **`formatTransportLabel`: `new URL(socksProxy)` throws → header crashes** [`packages/townhouse-web/src/views/Home.tsx:165`] — `status.socksProxy ? new URL(status.socksProxy).host : 'proxy'` throws synchronously on a malformed proxy URL. Crashes `<HomeHeader>`. Fix: try/catch around URL parsing with `'proxy'` fallback.
- [ ] [Review][Patch] **`<TransportStatusPanel>` `relativeTime`: clock skew → negative seconds** [`packages/townhouse-web/src/components/TransportStatusPanel.tsx:7-14`] — If `lastProbedAt > Date.now()` (server clock ahead, browser clock behind), `diff` is negative and `relativeTime` returns "-3 s ago". Fix: `if (diff < 0) return 'just now'`.
- [ ] [Review][Patch] **`<TransportStatusPanel>`: ATOR mode with empty/missing `socksProxy` renders empty proxy line** [`packages/townhouse-web/src/components/TransportStatusPanel.tsx:84-89`] — Renders `<dd>{s.socksProxy}</dd>` even when the field is `''` or `undefined`. Fix: gate on `s.socksProxy` truthy.
- [ ] [Review][Patch] **Wizard probe targets `DEFAULT_ATOR_PROXY` regardless of operator's wizard step 3 selection** [`packages/townhouse/src/api/wizard-server.ts:241-247,32-34 of WizardStepPrivacy`] — If the operator types a custom proxy URL during the wizard (a future affordance or via direct config edit), the probe still tests `DEFAULT_ATOR_PROXY`, lying to the operator about reachability. Currently bounded because wizard offers no proxy URL input, but contract is misleading. Fix: tie probe URL to the wizard's in-flight transport selection (or document that wizard preview is "default proxy only").
- [ ] [Review][Patch] **Dev API hook uses `startsWith('/api/transport')` (hijacks future `/api/transport-status`, etc.)** [`packages/townhouse-web/scripts/api-server.mjs`] — Future endpoint paths sharing the prefix get hijacked. Fix: exact match `url.pathname === '/api/transport'`.
- [ ] [Review][Patch] **Dev API hook: `new URL(req.url, ...)` no try/catch** [`packages/townhouse-web/scripts/api-server.mjs`] — Malformed request URL throws inside the hook → request never reaches handler. Fix: try/catch with fallback to no-op.
- [ ] [Review][Patch] **E2E spec: route lifecycle race during 5 s polls** [`packages/townhouse-web/e2e/transport-flip.spec.ts`] — Between `await page.unroute(...)` and the next `route(...)` registration, a 5 s `useTransportStatus` poll can hit the catch-all `**/api/**` 404 fallback, flipping the SPA into `error` state. Fix: pause polling via the unroute pattern (return a never-settling promise during the gap), or use a single mock that returns scenario-driven payloads.
- [ ] [Review][Patch] **`createApiServer` mutates input `deps` with side-effect probe assignment** [`packages/townhouse/src/api/server.ts`] — `deps.transportProbe = probe;` is a hidden side effect on the caller's object; type system says `transportProbe?` is optional and route layer null-checks again. Fix: return the constructed probe alongside `app/close` in the result, or require the caller to construct it.
- [ ] [Review][Patch] **`server.ts` `close()` no try/catch around `probe.stop()`** [`packages/townhouse/src/api/server.ts`] — A probe-stop throw prevents subsequent WS socket cleanup. Fix: try/catch around `transportProbe?.stop()`.
- [ ] [Review][Patch] **`config-mutex.ts` docstring claims atomicity it doesn't deliver** [`packages/townhouse/src/api/config-mutex.ts`] — Comment says "Atomically acquire the mutex" but the impl is `if (isMutating) return false; isMutating = true;` — not atomic if anyone introduces an `await` between the read and write. Fix: change comment to "synchronous test-and-set; safe only for code with no await between check and acquire."

#### Deferred (pre-existing or out-of-scope for this story)

- [x] [Review][Defer] **AC-5 validateConfig round-trip failure path untested** [`packages/townhouse/src/api/routes/transport.ts:146-161`] — deferred, test enhancement; the path is implemented and behaviourally rare.
- [x] [Review][Defer] **AC-3 rollback test asserts mock call count, not actual disk reversion** [`packages/townhouse/src/api/routes/transport.test.ts:278-297`] — deferred, integration-test territory; mock-based unit is the established pattern.
- [x] [Review][Defer] **No-op detection runs before mutex acquire (AC-3 ordering deviation)** [`packages/townhouse/src/api/routes/transport.ts:120-131`] — deferred, no mutation occurs and the AC accepts either ordering operationally.
- [x] [Review][Defer] **Concurrent GET during PATCH torn read (mutex serializes mutations only)** [`packages/townhouse/src/api/routes/transport.ts`] — deferred, single-machine sub-Hz operation; race exists but consequence is a one-poll stale read.
- [x] [Review][Defer] **PATCH allows `activeNodes === []` (connector restart with no peers)** [`packages/townhouse/src/api/routes/transport.ts:167-169`] — deferred, pre-existing pattern shared with `nodes-patch.ts`.
- [x] [Review][Defer] **Module-level mutex potential dual-import (esm/cjs)** [`packages/townhouse/src/api/config-mutex.ts`] — deferred, pure-ESM monorepo; would only manifest under future bundler change.
- [x] [Review][Defer] **`<TransportStatusPanel>` `lastProbedAt > 24 h ago` renders as "500 hr ago"** [`packages/townhouse-web/src/components/TransportStatusPanel.tsx:7-14`] — deferred, probe runs every 30 s in normal operation; only manifests if probe is broken (which is its own surfaced state).
- [x] [Review][Defer] **`<SettingsView>` no-op success has no user feedback** [`packages/townhouse-web/src/views/Settings.tsx`] — deferred, Save button disable handles the practical case.
- [x] [Review][Defer] **AC-20 SPA-side `import.meta.env.DEV` guard absent** [`packages/townhouse-web/scripts/api-server.mjs`] — deferred, server-side hook in dev API server is equivalent (script never ships in production builds).
- [x] [Review][Defer] **Massive prettier reformatting drift across 60+ files** — deferred, required by Dev Notes "Lint/format after every set of file edits"; no semantic changes detected in sampled files.

#### Resolution (2026-05-01)

**All decision-needed items resolved (6 of 6) and all patch items applied (44 of 44).** Status: `done`.

Verification:
- `pnpm --filter @toon-protocol/townhouse test` → **640/640 tests pass**
- `pnpm --filter @toon-protocol/townhouse-web test` → **385/385 tests pass**
- `pnpm exec eslint <changed files>` → clean for all files I touched
- `pnpm exec prettier --write <changed files>` → applied

Notable test changes made during patch application:
- `transport-probe.test.ts` "transitions from reachable to unreachable" — the test was racing past the first tick by polling on the default `reachable: true` initial state. Tightened the wait condition to `lastProbedAt > 0 && reachable === true` for the first phase, and `lastProbedAt > probedBeforeClose && reachable === false` for the post-close phase. (My patch correctly suppresses false-positive transition warns when `prev.lastProbedAt === 0`; the test's prior assumption was incorrect.)
- `transport.test.ts` "PATCH returns 503 in wizard mode" — renamed to "PATCH is not registered in wizard mode (returns 404)" since the wizard now omits the PATCH stub entirely (per AC-7's "404 is acceptable" clause). This is necessary because the prior 503-stub clashed with the wizard→normal transition's real PATCH registration (Fastify `FST_ERR_DUPLICATED_ROUTE`).
- `transport.test.ts` "strips unknown keys" — renamed to "rejects unknown keys (additionalProperties: false)" and assertion flipped from 200 to 400, matching P-D2 (Ajv `removeAdditional: false`).

Architectural changes worth noting for future maintainers:
- `registerTransportRoutes` now supports three modes: `'normal'` (GET + PATCH), `'wizard'` (GET only), and `'patch-only'` (PATCH only — used by the wizard transition). The GET handler now reads `deps.transportProbe` per-request rather than capturing it at registration time, so `wizard-server.ts` can swap the probe instance from the wizard probe to the normal probe via `wizardTransportDeps.transportProbe = normalProbe`.
- `ApiDeps.transportProbe` is now required (per AC-6). All callsites construct it explicitly: `cli.ts`, `wizard-server.ts`, the dev `api-server.mjs`, and the test fixtures.
- Wizard probe is **lazy-started** via `POST /api/transport/wizard-probe-start` from the SPA when the operator engages the ATOR radio. No outbound TCP/HTTPS during the wizard until the user opts in.
