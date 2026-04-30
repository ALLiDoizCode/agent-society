
## Deferred from: code review of 21-10-dashboard-town-management-view (2026-04-30)

- `getPacketLog` 404 detection via error message string matching — `msg.includes('404')` on the thrown error string works for all realistic cases; refactor to status-code inspection if `ConnectorAdminClient.fetch()` is ever restructured to not throw on non-200 responses. [packages/townhouse/src/connector/admin-client.ts:157]
- Double `regenerateConnectorConfig` when `enabled` flip + fee change arrive in one PATCH body — two sequential restarts in rapid succession; pre-existing in the 21.8 PATCH handler, not introduced by 21.10. [packages/townhouse/src/api/routes/nodes-patch.ts]
- Inline `rgba(0,0,0,0.06)` in `CartesianGrid` stroke — rgba is not hex; the `no-inline-hex` lint rule targets hex strings only and CI passes. Revisit if the rule is expanded to cover rgba/hsl. [packages/townhouse-web/src/views/Town.tsx:239]
- `getNodeRelayEndpoint` Docker-internal fallback (`ws://townhouse-<id>:7100`) unreachable when Townhouse API runs on the host — fallback is intentional for Townhouse-in-Docker (Oyster CVM) deployments; dev stack and production single-instance deployments use the port-binding path. [packages/townhouse/src/docker/orchestrator.ts:229]
- `useNodeMetrics` uses `nodeType` (e.g., `'town'`) not `nodeId` (e.g., `'town-01'`) — both Town cards show identical metrics; per-instance isolation requires a new `/api/nodes/:type/:id` API surface (future story). [packages/townhouse-web/src/views/Town.tsx:331-332]
- Bandwidth always `null`/`'—'` in dev stack — `GET /nodes/:type/bandwidth` builds container name as `townhouse-town` but dev stack containers are named `townhouse-dev-town-01`; works correctly in single-instance production. [packages/townhouse/src/api/routes/nodes.ts:291]

## Deferred from: code review of 21-7-5-connector-version-sweep-and-contract-canary (2026-04-29)

- SOCKS_PROXY empty-string is inconsistent: `ConnectorConfigGenerator.generate()` keeps an empty `socksProxy` in the runtime config (`?? DEFAULT_ATOR_PROXY` only kicks on null/undefined), but `toEnvVars()` then drops the key via a truthy check. Pre-existing in `config-generator.ts`; story does not modify that file. [packages/townhouse/src/connector/config-generator.ts]
- `ConnectorAdminClient.getPeers()` returns typed `PeerStatus[]` but does not validate per-element shape — `[null]` / `[42]` / `[{ totally: 'random' }]` pass `Array.isArray()`. Story explicitly scope-excludes admin-client modifications; future fix should align with the admin-client path/shape gap already documented in `CONNECTOR_MIGRATION.md §Known Contract Gaps`. [packages/townhouse/src/connector/admin-client.ts:77-84]
- `inspect()` race: on slow systems (Docker-on-Mac VM, CI under load), `start()` resolves on container-state=running, not on port-forwarding-complete. `Ports['9401/tcp']` may be `null` momentarily; `expect.toBeTruthy()` fires on transient race rather than real regression. Speculative — address if it actually flakes. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:139-150]
- `getHealth()` validator accepts `NaN`/`Infinity`/negative `uptime` (`typeof NaN === 'number'`). A buggy connector emitting `NaN` (divide-by-zero) silently propagates to consumers. Pre-existing in admin-client. [packages/townhouse/src/connector/admin-client.ts:40-47]
- Stub canary lacks coverage for empty / single-element / very-large `activeNodes` cases. The story's spec required a specific 3-node case and a SOCKS_PROXY case; broader coverage was not in scope. [packages/townhouse/src/connector/contract-canary.test.ts]
- No escaping of pathological values (NUL byte, newline) in `toEnvArray()` joining `${KEY}=${VALUE}`. dockerode passes verbatim to the kernel which interprets NUL as terminator. Pre-existing in config-generator. [packages/townhouse/src/connector/config-generator.ts:81-84]
- Image-pull has no `AbortController` / retry / timeout. A hung pull blocks `beforeAll` for the full 30s; vitest then aborts mid-pull leaving partial layers. Pre-existing pattern; address with a CI-side image-prepull step if flakiness emerges. [packages/townhouse/src/__integration__/connector-image-contract.test.ts:76-92]

## Deferred from: code review of 22-5-connector-interface-contract-smoke-test (2026-04-28)

- Action pinning is half-applied in `.github/workflows/test.yml` — new canary job pins to commit SHAs (OWASP A08), pre-existing jobs in the same file still use floating `@v4` tags. Either the threat is real for the whole file or the rationale is theatrical. Tracked for a follow-up workflow-wide pinning sweep.
- Vitest filename filter `pnpm test:integration -- tests/integration/connector-contract.test.ts` is a substring match. A rename of the canary file without updating the CI command would silently run the entire integration suite under the 5-minute cap and time out as a false-red.
- No `beforeEach`/`afterEach` teardown of `vi.fn` mocks in `connector-contract.test.ts`. Speculative — not a bug today; matters only if shared module mocks are added later.

## Deferred from: code review of 21-7-dvm-node-dockerfile (2026-04-21)

- Health check doesn't verify JSON response — Static test cannot validate runtime health endpoint behavior, requires actual Docker run
- Process.env secret deletion ineffective — This is how Node.js works - env vars are process-local. True secrets require Docker-level handling which is out of scope
- rot-js dependency not explicitly bundled — Relies on transitive inclusion through pet-dvm, can verify at Docker build time

## Deferred from: code review of 21-8-fastify-rest-websocket-metrics-api (2026-04-21)

- `saveConfig` re-validates full config on every write — migration hazard if future required fields are added (config-schema evolution concern, not 21.8) [packages/townhouse/src/config/loader.ts]
- `saveConfig` atomic-rename cross-device / Windows semantics — Townhouse is Linux-first per epic scope
- Module-level `isMutating` + `resetConfigMutex` test-seam export — behaviorally correct for single-process v1; refactor into factory-scoped closure [packages/townhouse/src/api/routes/nodes-patch.ts]

## Deferred from: code review of 21-8-fastify-rest-websocket-metrics-api (2026-04-21)

- `cli.test.ts:114-115` and `cli-wallet.test.ts:95-96` MockInstance generics mismatch — pre-existing vitest typing issue unrelated to 21.8.
- `connector/config-generator.test.ts:93,194` possibly-undefined access — pre-existing.
- `wallet/manager.test.ts:229,232` index-signature cast — pre-existing.
- `buildCorsOptions` omits `HEAD` from methods — low severity; no caller uses HEAD today.
- `server.ts` error handler leaks `error.message` outside production — matches spec Dev Note intent (log full error server-side, return safe message); message leak is low risk given loopback-only bind.

## Deferred from: code review of 22-4-fix-sdk-solana-settlement-e2e (2026-04-28)

- Mixed commitment levels — `getAccountInfo` upgraded to `'confirmed'`, but `getLatestBlockhash` / `requestAirdrop` retain defaults; theoretical flake source [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]
- Account index u8 wraparound at >255 accounts in legacy-message serializer [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]
- `compactU16Size` / `writeCompactU16` invariant lacks runtime assert at slice point — risks silent corruption if future divergence
- `.env.sdk-e2e` parser doesn't handle quoted values, comments, or whitespace-padded values [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:90]
- Hand-rolled base58 encoder — all-zero pubkey returns `'1'`, no validation [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:104-131]
- Module-load side effects — `loadSdkE2eEnv()` runs once at import, `SOLANA_PROGRAM_ID` is a resolved-once `const`; stale across vitest worker re-imports [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:102,134]
- `expect(channelAfterSettle).toBeNull()` assumes connector v3.3.2 closes the channel account on settle — semantic shift from prior `state==='settled'` check; should be confirmed against connector source
- Auto-keypair `--bpf-program` branch in entrypoint passes `.so` as both address and program path [infra/solana/entrypoint.sh:29] — only triggers when `*-keypair.json` missing
- `deriveSolanaProgramIdFromKeypair` returns `'1'` (system program) for all-zero pubkey input [packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts:127]
- `discoverProgramId` returns first program from RPC enumeration order — fragile if multiple BPF programs are loaded [packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts]


## Deferred from: code review of 21-6-1-mill-review-findings-remediation (2026-04-29)

- Shutdown test `emitAndAwaitShutdown` yields one `setImmediate` tick — sufficient with trivial mock, brittle if `stop()` ever does real async work. Consider `vi.waitFor()` pattern.
- `process.removeAllListeners` in `afterEach` is indiscriminate — silently removes any future Vitest or plugin signal handlers registered on the worker. Scope to known test-registered listeners.
- `applyEnvOverlay` regression sanity test uses `as never` cast, suppressing compile-time type-checking on the stub input.
- `Dockerfile.mill` `LABEL version="1.0.0"` is a hardcoded literal — not parameterized via `--build-arg`. Every image build reports 1.0.0 regardless of actual package version.
- `MILL_CONFIG_PATH` file containing the string `"null"` bypasses the empty-file guard and produces a raw `TypeError` from `parseRawConfig` instead of a wrapped error.
- AC-5 line citations in `21-6-mill-node-dockerfile-review-findings.md` drifted ~6 lines after prettier pass (`b161cd4`) — `delete` cited at `:188-189` actual `:195`; `SIGQUIT` cited at `:335` actual `:354`.

## Deferred from: code review of 21-8-0-townhouse-dev-infrastructure (2026-04-29)

- SOCKS5 service has no healthcheck — silent failure if port collision; only consumed by story 21.15 (ATOR transport).
- `MILL_RELAYS` env in `docker-compose-townhouse-dev.yml:303,343` duplicates fixture `relayUrls` and overrides via `applyEnvOverlay`; Dev Agent Record acknowledged the intentional override.
- `dev-fixtures.test.ts:66-67` validates `cumulativeAmount`/`nonce` with `Number()` — loses precision >2^53; current fixture values fit safely.
- Smoke test workspace-root resolution via four-level relative path (`dev-stack-smoke.test.ts:45`) is fragile to file relocation but currently correct.
- Anvil compose entrypoint and host `deploy-mock-usdc.sh` both attempt USDC deploy; resolved as part of patch finding #7 if user opts to drop the host call.

## Deferred from: code review of 21-8-5-dashboard-design-system-foundation (2026-04-29)

- `Home.tsx` placeholder lacks AbortController, no `r.ok` check, possible duplicate-type key collision — placeholder for 21.9-lite (`packages/townhouse-web/src/pages/Home.tsx:24-32`).
- `chart.tsx` uses `dangerouslySetInnerHTML` with developer-controlled color values — shadcn-generated; revisit when user-controllable colors are introduced.
- `tsconfig.build.json` excludes `src/components/ui/**` from typecheck — known shadcn `@ts-nocheck` workaround; revisit when shadcn types stabilize.
- `no-inline-hex` `TemplateLiteral` regex is unanchored — would false-positive on URI-like strings containing `#abc...`; no current call sites trigger it.
- `no-direct-recharts` doesn't catch CJS `require('recharts')` — codebase is ESM-only; defer until/unless CJS is introduced.
- `no-positive-letter-spacing-geist` regex allow-list permits `tracking-tight-${anything-positive}` — current tokens are all negative by design.
- Storybook `viteFinal` spreads `viteConfig.resolve.alias` as object — Vite supports array form too; would drop existing aliases. Revisit if Storybook ever adds array-form aliases.
- `MetricBlock` `value: number` not localized via `toLocaleString()` — caller responsibility per spec; consider adding a `format` prop in a future view story.
- `dev-docker.mjs` doesn't explicitly forward parent SIGINT/SIGTERM — `concurrently --kill-others` + `shell: true` handle it in practice; tighten if orphan processes appear in smoke testing.
- `index.css` font URLs use `../node_modules/geist/...` — fragile to pnpm hoisting changes; pinned to pnpm 8.15.0 currently. Switch to `import 'geist/...?url'` if hoisting drifts.

## Deferred from: code review of 21-9-dashboard-spa-home-view (2026-04-29)

- AC-3 hook surface keying differs from spec (`useNodeStatusStream` returns `statesByName: Record<string, string>` rather than `Map<NodeType, NodeState>`). Documented in Dev Notes "Implementation Plan" #2 as deliberate. Revisit if a stricter type contract is needed for richer view stories.
- AC-5 transport-status indicator is static (reflects configured `transport.mode` only, not live ATOR proxy reachability). Gated behind story 21.15 per spec's plumbing-decision clause; TODO comment in `Home.tsx:866-869`.
- AC-9 (live-Docker screenshot) and AC-10 (`docker pause townhouse-dev-town-02` degraded demo) — explicit PR-review gate per spec. Dev Agent flagged that the dev-stack container-name caveat may block AC-10 until 21.14 fixtures land or the orchestrator is wired to dev fixtures.
