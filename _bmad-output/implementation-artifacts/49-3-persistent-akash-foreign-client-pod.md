# Story 49.3: Persistent Akash Foreign-Client Pod

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Second infrastructure precursor of Epic 49 (re-sequenced 2026-05-18 via /bmad-party-mode with Winston, John, Amelia, Murat, Sally).** Sized **L** (foreign-client pod is new ground beyond 49.1: 49.1 ran the foreign client IN-PROCESS inside vitest with a hardcoded Anvil setup; this story ships it as a long-lived Akash deployment that exposes an HTTP `POST /publish` control plane, generates ephemeral signing keys on boot, auto-funds them from the 49.2 faucet, and accepts a per-request `targetHostname` so a laptop reboot doesn't need a pod redeploy). Depends on Story 49.2 (`ready-for-dev` — Akash devnet faucets) for the boot-time auto-fund path. Consumed by Story 49.4 (paid-packet earnings receipt; was 49.2 — renumbered 2026-05-18) and Story 49.5 (live e2e gate; was 49.3). This story does NOT exercise the settlement-chain receipt — that's 49.4's job. This story proves the persistent-pod surface itself: pod boots, faucet funds it, `POST /publish` routes a kind:1 through `.anyone` SOCKS5 to a target HS, the relay accepts, the operator's local townhouse sees the channel + tags B as `'external'`.
>
> **Reuse-First (CRITICAL — see § "Reuse-First Inventory" below):** the entire SOCKS5 transport (`packages/client/src/transport/socks5.ts`), the ToonClient surface (`publishEvent` / `signBalanceProof` / `openChannel` in `packages/client/src/ToonClient.ts`), the EIP-712 signer plumbing, and the `@anyone-protocol/anyone-client` SOCKS5 daemon ALL already exist and are proven in 49.1's 7/7 PASS smoke (`packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts`). The new work is (a) wrap that in-process flow behind a Fastify `POST /publish` endpoint, (b) ship it as a persistent Akash pod, (c) add the schema contract, (d) live smoke against the user's local `townhouse hs up` apex. **Read 49.1's spec + test file end-to-end BEFORE writing any new code.**

## Story

As the **TOON protocol team validating that ANY foreign TOON client can publish through a townhouse `.anyone` HS**,
I want a **persistent Akash-hosted pod** that exposes `POST /publish {event, targetHostname}` and uses `@toon-protocol/client` + `@anyone-protocol/anyone-client` to send EIP-712-signed Nostr events through a townhouse HS on the operator's local machine,
so that **49.4's settlement assertions and 49.5's close-out gate can drive the foreign-publish loop against real cross-network infrastructure** — not the in-process foreign client from 49.1.

## Acceptance Criteria

1. **AC #1 — Pod boot + ephemeral signer keys + faucet auto-fund (depends on 49.2):**
   **Given** the SDL `deploy/akash/foreign-toon-client.sdl.yaml` is deployed and a lease is accepted AND the 49.2 faucet ingress is reachable (URL read from `deploy/akash/leases.json` `faucet.url`)
   **When** the pod entrypoint runs
   **Then** it (a) generates a fresh secp256k1 keypair (EVM) + ed25519 keypair (Solana) in memory only, (b) logs both PUBLIC keys to stdout (NEVER private keys), (c) POSTs to `<FAUCET_URL>/faucet` with `{chain: 'evm', recipient: <evm-addr>}` AND `{chain: 'solana', recipient: <sol-addr>}` per the 49.2 contract, (d) polls the Akash-Anvil + Akash-Solana RPCs (URLs from `leases.json`) for `balance ≥ threshold` (EVM threshold: 0.01 ETH + 1 USDC; SOL threshold: 0.01 SOL + 1 USDC) within 30s, (e) starts the `@anyone-protocol/anyone-client` SOCKS5 daemon on `127.0.0.1:9050` (in-pod loopback), (f) waits for the daemon's `bootstrapped` log signal OR a SOCKS5 protocol greeting probe (whichever the existing `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts:402-423` uses — mirror it; do NOT raw TCP probe per the D1 deferred-work entry), (g) starts a Fastify server on `0.0.0.0:8080` (clearnet ingress port, mapped via SDL `expose 8080 as 80`), (h) marks `GET /healthz` ready returning `200 {anyoneReady: true, evmAddr, solAddr, balances: {evm, sol}, bootedAt}`.
   **And** `GET /signer-info` returns `{evm: "0x...", sol: "...", balances: {...}, bootedAt}` — PUBLIC keys only, never private keys.

2. **AC #2 — `POST /publish` round-trip:**
   **Given** the pod is healthy (AC #1) AND `targetHostname` is a reachable `.anyone` HS hostname
   **When** a client POSTs `/publish` with body `{event: <signed Nostr event>, targetHostname: "<hostname>.anyone"}`
   **Then** the pod (a) ajv-validates the request body against `packages/townhouse/contracts/foreign-publish.schema.json` (rejects with 400 + ajv error path on mismatch), (b) constructs a `ToonClient` configured with `connectorUrl=http://127.0.0.1:<local-connector-port>` + `btpUrl=wss://<targetHostname>/btp` + `transport={type: 'socks5', socksProxy: 'socks5h://127.0.0.1:9050'}` (mirror 49.1 Task 3.4 fixture state), (c) opens a payment channel via the pod's local connector (Anvil-backed against the Akash-Anvil URL — re-uses the channelManager.openChannel path from 49.1), (d) signs an EIP-712 balance proof for the channelId + claim amount, (e) calls `toonClient.publishEvent(event, {claim})`, (f) returns `202 {eventId, claimHash, chainId, publishedAt, durationMs}` within 90s.
   **And** request + response shapes BOTH validate against `packages/townhouse/contracts/foreign-publish.schema.json` (ajv strict mode, `additionalProperties: false`).
   **And** non-OK relay response returns `502 {error, relayAck, retryable: true}` — no silent swallow.
   **And** missing or malformed `targetHostname` returns `400 {error: "targetHostname required", field: "targetHostname"}` — does NOT dial.

3. **AC #3 — Runtime-mutable target HS (no restart):**
   **Given** the pod has just published to `targetHostname: hs-A.anyone`
   **When** the same pod is called with `targetHostname: hs-B.anyone` (different `.anyone` hostname)
   **Then** the second publish succeeds without a pod restart, dialing `hs-B.anyone` via the same SOCKS5 daemon, and both publishes land on their respective relays.
   **And** the pod has NO `TARGET_HOSTNAME` env var baked at SDL deploy time — the target is per-request.
   **And** the pod's internal state for the FIRST publish (e.g., the ToonClient instance for `hs-A`) is either cached (keyed by hostname) OR torn down and rebuilt per request — implementation choice documented in Dev Notes; pod state must not leak between requests in a way that breaks AC #3.

4. **AC #4 — Local townhouse sees Akash-rooted channel (carry-forward from 49.1 AC #2):**
   **Given** AC #2 has succeeded against the operator's local `townhouse hs up` apex (running on the user's laptop, `.anyone` hostname pushed to the pod via the POST body)
   **When** the smoke test invokes A's drill verb `runCli('channels', { configDir: tmpDirA, extraArgs: ['--json'] })`
   **Then** the output contains a channel where `peerId === <pod's EVM pubkey>` AND `status === 'open'` (matching ChannelSummary.status per the 49.1 round-9b spec wording).

5. **AC #5 — Peer-type classification (carry-forward from 49.1 AC #4):**
   **Given** AC #4's channel is open
   **When** A's peer-type-resolver runs over the post-publish channels snapshot
   **Then** the Akash pod's pubkey resolves to `'external'` (NOT `'self'`, NOT `'town'`, NOT `'mill'`) — same resolver, same snapshot semantics as 49.1 AC #4.
   **And** assertion path mirrors 49.1's: PRIMARY `fetch('http://127.0.0.1:<A-host-api-port>/api/earnings').then(r => r.json())` walking `peers[]` for `id === <pod's EVM pubkey>` AND `type === 'external'`; FALLBACK direct `new PeerTypeResolver(nodesYaml).resolvePeerType(podEvmPubkey) === 'external'` if the earnings payload doesn't surface the peer yet (47.5 4B.2 recurrence — document as BLOCKED-PARTIAL in `### Review Findings` if the fallback path was taken).

6. **AC #6 — Real `.anyone` transport, no clearnet bypass to the relay:**
   **Given** the pod environment
   **When** the test inspects the publish path (via pod log lines OR a structured `GET /signer-info` extension that includes `transport: {type, socksProxy}` for debug)
   **Then** the SOCKS5 dial goes through the pod's local `@anyone-protocol/anyone-client` daemon on `127.0.0.1:9050`; NO `127.0.0.1` ToonClient dial to a hardcoded relay, NO direct clearnet `wss://` to the relay (BTP/WS goes through SOCKS5).
   **And** `targetHostname` matches `/^[a-z2-7]+\.(anyone|anon)$/` (v3 base32 alphabet, per 49.1 AC #3.2 round-9b spec).
   **And** chain RPCs ARE on clearnet (NOT routed through SOCKS5) — assert via the pod's `connector.yaml` rpcUrl pointing at the Akash-Anvil HTTPS ingress (not the SOCKS5 daemon). User direction (party mode 2026-05-18): "we don't need to wrap the anvil or SOL wrapped behind a HS thats not in scope for hs".

7. **AC #7 — No app-layer idempotency (trust Nostr event-id dedup):**
   **Given** retries reuse the SAME signed event object (no `created_at` re-stamping)
   **When** the same event is POSTed twice
   **Then** the relay deduplicates by `event.id` (SHA-256 of the canonical event tuple) — pod has NO idempotency cache, NO `X-Idempotency-Key` header, NO replay-window state.
   **And** the schema-contract file at `packages/townhouse/contracts/foreign-publish.schema.json` includes a comment / `$comment` field: `"Idempotency is handled at the Nostr layer (event.id = SHA-256(canonical event)). Pod is stateless w.r.t. replay."`.
   **And** the test-helper docstring documents: "Retries MUST reuse the same signed event object — re-stamping `created_at` produces a new event.id which bypasses relay dedup."

8. **AC #8 — Persistent-deployment discipline:**
   **Given** the pod is a long-lived Akash lease (NOT ephemeral per CI run; user direction party mode 2026-05-18: "the foreign pod can be persitent")
   **When** the story closes
   **Then** the story footer names ONE lease owner (a pubkey or email, not "the team") AND a monthly AKT-burn budget AC is stated with a 50% drain alert threshold (mirror Murat's gate-discipline #4 revision).
   **And** a sunset calendar reminder is filed in `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49 sunset checklist" for when Epic 49 retires (close the lease).
   **And** an orphan-lease detector entry is added to the same deferred-work section (CI-wired follow-up; not blocking this story).

9. **AC #9 — Pod rate limit (faucet-burn guard, Winston's flag from party mode):**
   **Given** a fat-finger hostname or a malicious caller could cause the pod to publish into the void, slowly draining faucet funds across pod-key generations
   **When** `POST /publish` exceeds N publishes/min from a single source IP (default N=30 — generous for the persistent fixture, tight enough to deter accidental loops)
   **Then** the pod returns `429 {error: "rate_limited", retryAfterSec}`.
   **And** the rate-limit is at the POD layer (in-memory token bucket per source IP), NOT at the 49.2 faucet — faucet stays dumb per 49.2's design.

10. **AC #10 — Smoke runs against live Akash AND local townhouse:**
    **Given** the local `townhouse hs up` apex is running on the user's laptop AND `targetHostname` is the local `.anyone` hostname (from `~/.townhouse/host.json` per Story 45.4)
    **When** the smoke test at `packages/townhouse/src/__integration__/akash-foreign-pod-smoke.test.ts` POSTs `/publish` to the live Akash foreign-pod ingress
    **Then** the event lands on the local connector AND AC #4 + AC #5 + AC #6 ALL hold AND the AC #3 hot-swap demonstrates with a second `.anyone` hostname (e.g., spin up a second local `townhouse hs up` in a different tmpDir → POST with its hostname → assert channel rooted at pod's pubkey appears on the second instance too).
    **And** results documented in `### Review Findings` per 47.5 / 48.7 / 49.1 precedent (`_Smoke run YYYY-MM-DD — …_` + per-AC PASS/FAIL diagnosis).

**FRs:** FR30, FR31 | **NFRs:** NFR5 (real `.anyone` transport — no `127.0.0.1` substitute), NFR8 (no on-disk secret files; ephemeral keys are memory-only — N/A here), NFR9 (no `0.0.0.0`-bound admin endpoints; the `/publish` route IS the public ingress, that's by design — but `/signer-info` should be the only "debug" surface and it returns PUBLIC keys only)

## Tasks / Subtasks

- [ ] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [ ] 1.1 Read `_bmad-output/implementation-artifacts/49-1-toon-client-foreign-townhouse-hs-smoke.md` end-to-end. **This is the architectural precedent.** Pay special attention to: Task 3 (test scaffolding), Task 4 (the publish flow), Task 8 (helper extraction discipline), § "Foreign-Client Architecture — OQ-1 Path A/B/C" (the in-process foreign client = this story's reference impl), § "Driving a Foreign-Origin Publish — OQ-2 Path A/B" (Path A = live `toonClient.openChannel(aDestination)` then `toonClient.signBalanceProof(channelId, paymentAmount)` against the REAL channelId — this is the pattern the pod entrypoint must mirror).
  - [ ] 1.2 Read `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts` end-to-end. **This is the working publish flow.** It wires up: keypair generation (`generateSecretKey` from nostr-tools), `ToonClient` construction with SOCKS5, anon-client SOCKS5 daemon, `openChannel`, `signBalanceProof`, `publishEvent`, channels-snapshot assertion, peer-type resolver fallback. The pod entrypoint extracts the publish portion and exposes it via Fastify.
  - [ ] 1.3 Read `packages/client/src/ToonClient.ts` lines 1-500. Confirm: `publishEvent(event, options?)`, `openChannel(destination)`, `signBalanceProof(channelId, amount)`, `state.btpClient` construction, the SOCKS5 transport injection at `applyDefaults() → config.transport.socksProxy`.
  - [ ] 1.4 Read `packages/client/src/config.ts`. Confirm `validateConfig` enforces `socksProxy.startsWith('socks5h://')` (DNS-leak prevention — AC #6 references). `applyDefaults` derives `btpUrl` from `connectorUrl` when omitted; the pod sets `btpUrl` explicitly per-request to `wss://<targetHostname>/btp`.
  - [ ] 1.5 Read `packages/client/src/transport/socks5.ts` end-to-end (203 lines). Confirm: `createSocks5WebSocketFactory(socksProxy)` returns a `(url: string) => WebSocket` factory wrapping `socks-proxy-agent` + `ws`. The factory is wired through `initializeHttpMode` → `BtpRuntimeClient`. **This is the existing SOCKS5 surface — do NOT rewrite.**
  - [ ] 1.6 Read `docker/Dockerfile.sdk-e2e` end-to-end. **This is the leading candidate base image** (already bundles ToonClient, connector, native deps, esbuild). Decide whether to (a) reuse it directly with a different entrypoint (`docker/src/entrypoint-foreign-pod.ts`), OR (b) fork into a new `docker/Dockerfile.foreign-toon-client` if the sdk-e2e image's BLS health endpoint / Nostr relay are too heavy for the pod's needs. **Recommend (a)** — adding a parallel entrypoint script is cheaper than maintaining a forked Dockerfile.
  - [ ] 1.7 Read `docker/src/entrypoint-sdk.ts` (the existing sdk-e2e entrypoint) to understand the shape — env-driven config, connector startup, BLS HTTP, attestation server. The foreign-pod entrypoint replaces the BLS + attestation parts with the Fastify control plane + ephemeral-key-gen + faucet-fund.
  - [ ] 1.8 Read `deploy/akash/anvil.sdl.yaml` + `solana.sdl.yaml` + (after 49.2 lands) `deploy/akash/faucet.sdl.yaml`. Confirm: chain RPCs are clearnet HTTPS (`as: 80` triggers L7 ingress + Let's Encrypt). The foreign-pod SDL mirrors this pattern for its `:8080` Fastify port (`expose: 8080 as: 80 to: global: true`).
  - [ ] 1.9 Read `deploy/akash/leases.json` schema. Confirm the `faucet.url` key will exist after 49.2 ships. The foreign-pod entrypoint reads `FAUCET_URL` from env (SDL env-passes from `leases.json.faucet.url`).
  - [ ] 1.10 Read `_bmad-output/implementation-artifacts/49-2-akash-devnet-faucets-and-ui.md` § "Schema-Contract Discipline" — confirm the 49.2 faucet POST contract is `{chain: 'evm'|'solana', recipient: string, amount?: number}` → `200 {tx, balanceAfter?, recipient, chain, explorerUrl?}`. This is what the foreign-pod entrypoint POSTs on boot.
  - [ ] 1.11 Read `packages/townhouse/contracts/` directory — confirm what schema files exist already (likely empty or has `faucet.schema.json` after 49.2 lands; this story adds `foreign-publish.schema.json`). Match the draft-version + style used by sibling files.
  - [ ] 1.12 Read `_bmad-output/implementation-artifacts/deferred-work.md` § "Deferred from: code review of 49-1-toon-client-foreign-townhouse-hs-smoke" — note D1 (real SOCKS5 handshake probe replaces raw TCP), D2 (socks5.ts CJS/ESM unit test), D-DN4 (build-app.ts package.json path test). The pod boot's SOCKS5 readiness check should USE the D1 pattern (real SOCKS5 protocol greeting, not raw TCP) — that's the right fix-forward.
  - [ ] 1.13 `git log --oneline -10` for recent context.

- [ ] **Task 2: Pre-flight gates (run BEFORE drafting code in Tasks 3+) (AC: all)**
  - [ ] 2.1 Confirm 49.1 is `done` AND 49.2 is `done` (or at least `review` with the faucet ingress live; this story's smoke needs the faucet to fund the pod).
  - [ ] 2.2 `pnpm --filter @toon-protocol/client build` — clean baseline.
  - [ ] 2.3 `pnpm --filter @toon-protocol/townhouse build` — clean baseline.
  - [ ] 2.4 SDK E2E infra running locally if running the smoke without an actual Akash deploy: `./scripts/sdk-e2e-infra.sh up`.
  - [ ] 2.5 Local `townhouse hs up` works (49.1 / 45.4 covered this; verify once before this story's smoke).
  - [ ] 2.6 Akash deploy + GHCR push credentials available (same as 49.2 Task 2.6).

- [ ] **Task 3: Foreign-pod entrypoint scaffold (AC: 1, 2, 3, 9)**
  - [ ] 3.1 Create `docker/src/entrypoint-foreign-pod.ts`. Imports: `import { fastify } from 'fastify'`, `import { Ajv } from 'ajv'`, `import { ToonClient } from '@toon-protocol/client'`, `import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'`, plus secp256k1 + ed25519 key helpers from `@noble/curves`.
  - [ ] 3.2 Boot sequence (AC #1): (i) generate `evmSecret = randomBytes(32)` → derive EVM address via `viem`; (ii) generate `solSecret = Keypair.generate()` → derive base58 pubkey; (iii) log addresses; (iv) `POST ${FAUCET_URL}/faucet` twice (once per chain) per 49.2 contract; (v) poll Akash-Anvil RPC for `eth_getBalance(evmAddr) ≥ threshold` (use viem's `publicClient.getBalance`) AND Akash-Solana RPC for `getBalance(solAddr) ≥ threshold` (use the SPL primitives or `@solana/web3.js`); (vi) start anon-client SOCKS5 daemon at `127.0.0.1:9050` (mirror the 49.1 test setup); (vii) wait for SOCKS5 bootstrap via the D1 pattern (SOCKS5 protocol greeting probe — NOT raw TCP); (viii) start Fastify on `0.0.0.0:8080`.
  - [ ] 3.3 Fastify route `GET /healthz`: returns `200 {anyoneReady, evmAddr, solAddr, balances, bootedAt}` per AC #1.
  - [ ] 3.4 Fastify route `GET /signer-info`: returns `200 {evm, sol, balances, bootedAt, transport: {type: 'socks5', socksProxy: 'socks5h://127.0.0.1:9050'}}` for debug. PUBLIC keys only, never private keys.
  - [ ] 3.5 Fastify route `POST /publish` (AC #2): (i) ajv-validate request body against `foreign-publish.schema.json` (reject 400 on mismatch); (ii) construct ToonClient as in 49.1 with `btpUrl: wss://${targetHostname}/btp`; (iii) `await toonClient.start()` → wait for SOCKS5 transport up; (iv) `const channelId = await toonClient.openChannel(targetDestination)`; (v) `const claim = await toonClient.signBalanceProof(channelId, paymentAmount)`; (vi) `const publishResult = await toonClient.publishEvent(event, {claim})`; (vii) `await toonClient.stop()` (or keep alive for hostname reuse — see Task 3.6 caching decision); (viii) reply `202 {eventId, claimHash, chainId, publishedAt, durationMs}`.
  - [ ] 3.6 ToonClient instance lifecycle (AC #3): either (a) cache `Map<targetHostname, ToonClient>` so subsequent publishes to the same hostname reuse the transport, OR (b) construct fresh per request and tear down in `finally`. **Recommend (a)** — anon-client bootstrap is 30-90s per fresh ToonClient; caching makes the second publish instant. Document the chosen approach in Dev Notes.
  - [ ] 3.7 Rate-limit (AC #9): use an existing Fastify rate-limit plugin (e.g., `@fastify/rate-limit` — verify it's in the workspace OR add to `docker/package.json` only) OR a hand-rolled in-memory token bucket. 30 req/min per source IP. Return `429 {error: "rate_limited", retryAfterSec}` on overflow.
  - [ ] 3.8 Wrap entrypoint in proper try/catch + structured error logging (Fastify's `req.log` is a Pino instance — use it).
  - [ ] 3.9 Process signal handlers: SIGTERM + SIGINT → graceful Fastify close + ToonClient teardown + anon-client kill.

- [ ] **Task 4: Docker image (AC: 1, 2)**
  - [ ] 4.1 Decision: reuse `docker/Dockerfile.sdk-e2e` with a different entrypoint OR fork into `docker/Dockerfile.foreign-toon-client`. **Recommended: reuse.** Add a build arg or env var that the existing Dockerfile reads to select the entrypoint at runtime (e.g., `ENTRYPOINT_SCRIPT=entrypoint-foreign-pod.ts`).
  - [ ] 4.2 If forking: copy `docker/Dockerfile.sdk-e2e` to `docker/Dockerfile.foreign-toon-client`, trim BLS + attestation pieces, point CMD at `entrypoint-foreign-pod.ts`.
  - [ ] 4.3 Add esbuild bundle target for `entrypoint-foreign-pod.ts` in `docker/esbuild.config.mjs` (mirror existing entrypoint-sdk bundle config).
  - [ ] 4.4 Add `@anyone-protocol/anyone-client@1.1.3` (or workspace-pinned version) as a dependency of `docker/package.json` if not already present (it likely is — 49.1's smoke depends on it). **Pin the Tor binary at image build time** per MEMORY note `project_connector_anyone_postinstall_flake` — runtime postinstall fetch will 403 intermittently.
  - [ ] 4.5 Build the image: `docker build -f docker/Dockerfile.sdk-e2e -t ghcr.io/toon-protocol/akash-foreign-toon-client:demo --build-arg ENTRYPOINT_SCRIPT=entrypoint-foreign-pod.ts .` (or the forked-Dockerfile variant).
  - [ ] 4.6 Push to GHCR: `docker push ghcr.io/toon-protocol/akash-foreign-toon-client:demo`.
  - [ ] 4.7 Add to `scripts/akash-deploy.sh` as a new `build_foreign_toon_client` function.

- [ ] **Task 5: Akash SDL (AC: 1)**
  - [ ] 5.1 Create `deploy/akash/foreign-toon-client.sdl.yaml`. Model on `anvil.sdl.yaml` + `solana.sdl.yaml`. One service `foreign-toon-client`, image `ghcr.io/toon-protocol/akash-foreign-toon-client:demo`.
  - [ ] 5.2 Env vars: `FAUCET_URL` (from `leases.json.faucet.url`), `EVM_RPC_URL` (from `leases.json.anvil.url`), `SOLANA_RPC_URL` (from `leases.json.solana.url`), `LOG_LEVEL=info`. NO `TARGET_HOSTNAME` env (AC #3 — hostname is per-request).
  - [ ] 5.3 `expose: 8080 as: 80 to: global: true` (the Fastify control plane). NO admin port; `/signer-info` is the only debug surface.
  - [ ] 5.4 Profile: `cpu: 1.0 / memory: 1Gi / storage: 2Gi` (anon-client + ToonClient + connector + Fastify; conservative). Pricing ~1000 uakt.
  - [ ] 5.5 `count: 1` — single replica; persistent.
  - [ ] 5.6 Update `deploy/akash/leases.json` with the new `"foreign_toon_client"` key after deploy (URL + lease metadata).
  - [ ] 5.7 Document in `deploy/akash/README.md` § "Foreign TOON Client" (new section): the lease URL, env vars, the per-request `targetHostname` contract, the persistent-deployment owner.

- [ ] **Task 6: Schema-contract file + ajv test (AC: 2, 7)**
  - [ ] 6.1 Create `packages/townhouse/contracts/foreign-publish.schema.json`. JSON Schema (match draft version + style used in `faucet.schema.json` from 49.2 — read it first).
  - [ ] 6.2 Request body: `{event: NostrEventSchema, targetHostname: {type: 'string', pattern: '^[a-z2-7]+\\.(anyone|anon)$'}}` — `additionalProperties: false`, both required.
  - [ ] 6.3 NostrEventSchema: full Nostr event shape per nostr-tools — `{id: string (sha256 hex), pubkey: string (32-byte hex), created_at: integer, kind: integer, tags: array of arrays of strings, content: string, sig: string (64-byte hex)}`.
  - [ ] 6.4 Response 202: `{eventId: string, claimHash: string, chainId: integer, publishedAt: string (ISO8601), durationMs: integer}` — `additionalProperties: false`.
  - [ ] 6.5 Error 400: `{error: string, field?: string, ajvErrors?: array}` — `additionalProperties: false`.
  - [ ] 6.6 Error 429: `{error: "rate_limited", retryAfterSec: integer}` — `additionalProperties: false`.
  - [ ] 6.7 Error 502: `{error: string, relayAck?: string, retryable: boolean}` — `additionalProperties: false`.
  - [ ] 6.8 Include `$comment` field on the request body: `"Idempotency is handled at the Nostr layer (event.id = SHA-256(canonical event)). Pod is stateless w.r.t. replay."` (AC #7).
  - [ ] 6.9 Create `packages/townhouse/src/__integration__/foreign-publish-contract.test.ts` — vitest unit test (no Docker, no live pod). Load the schema, ajv-compile strict-mode, assert: (a) valid request shape passes, (b) bad event shape (missing field) fails with expected ajv error path, (c) bad hostname (no `.anyone`/`.anon` TLD) fails, (d) extra fields are rejected (`additionalProperties: false`), (e) all response shapes parse against their schemas.

- [ ] **Task 7: Smoke test (AC: 10)**
  - [ ] 7.1 Create `packages/townhouse/src/__integration__/akash-foreign-pod-smoke.test.ts`. Gate with `RUN_AKASH_SMOKE=1` + `!SKIP_DOCKER` + skip if `AKASH_FOREIGN_POD_URL` env unset. Mirror 49.1's gate pattern.
  - [ ] 7.2 `beforeAll` (300s budget): (i) start local `townhouse hs up` in a tmpDirA via real CLI (mirror 49.1 Task 3.4); (ii) wait for hostnameA from `host.json`; (iii) construct adminClientA against the local apex; (iv) snapshot metrics; (v) build a signed kind:1 event via `finalizeEvent({kind:1, content: 'akash foreign-pod smoke @ ...', tags: [['t', '49.3-smoke']], created_at}, bSecretKey)`.
  - [ ] 7.3 Test 1: pod health — `GET <AKASH_FOREIGN_POD_URL>/healthz` returns 200 with `anyoneReady: true` AND non-empty `evmAddr` + `solAddr` AND `balances.evm > 0` AND `balances.sol > 0` (faucet auto-fund worked).
  - [ ] 7.4 Test 2: `GET <AKASH_FOREIGN_POD_URL>/signer-info` returns 200 with expected shape; capture `evmAddr` for AC #5 assertion.
  - [ ] 7.5 Test 3: `POST <AKASH_FOREIGN_POD_URL>/publish` with `{event, targetHostname: hostnameA}` returns 202 + valid response shape (ajv-validate against `foreign-publish.schema.json`) within 120s.
  - [ ] 7.6 Test 4 (AC #4): `runCli('channels', ...)` against local apex; assert channel with `peerId === evmAddr` AND `status === 'open'`.
  - [ ] 7.7 Test 5 (AC #5): primary path = `fetch('http://127.0.0.1:<A-host-api-port>/api/earnings')`, search peers[] for `id === evmAddr` AND `type === 'external'`. Fallback = direct `PeerTypeResolver`. Document path taken.
  - [ ] 7.8 Test 6 (AC #3 — runtime hot-swap): boot a SECOND local `townhouse hs up` in tmpDirB → POST `/publish` with `targetHostname: hostnameB` → expect 202 + new event landed on B's apex (assert via B's channels --json showing same `peerId === evmAddr`).
  - [ ] 7.9 Test 7 (AC #6): `GET /signer-info` returns `transport.socksProxy.startsWith('socks5h://')` AND a probe of the pod's internal SOCKS5 daemon (via the pod's own `GET /signer-info` extension or pod log line) shows non-clearnet WSS to the relay.
  - [ ] 7.10 Test 8 (AC #9 — rate limit): hammer `POST /publish` with 31 requests in <60s; expect at least one 429 + `retryAfterSec` field.
  - [ ] 7.11 `afterAll`: `townhouse hs down` on both tmpDirA + tmpDirB; cleanup containers + volumes (mirror 49.1 Task 8 helper extraction).
  - [ ] 7.12 Document smoke results in `### Review Findings` per format.

- [ ] **Task 8: Deploy + verify on Akash (AC: 1, 10)**
  - [ ] 8.1 Run `scripts/akash-deploy.sh foreign_toon_client` (or whatever the verb is named).
  - [ ] 8.2 Update `deploy/akash/leases.json` with the new lease URL.
  - [ ] 8.3 Run `scripts/akash-status.sh` to confirm health.
  - [ ] 8.4 `curl <foreign-pod-ingress>/healthz` — visual sanity. Verify `anyoneReady: true` AND balances are non-zero (faucet fund-on-boot worked).
  - [ ] 8.5 Optional: drive ONE manual `POST /publish` with `curl` against a locally-running `townhouse hs up` to sanity-check before invoking the vitest smoke.

- [ ] **Task 9: Persistent-deployment owner + sunset reminder (AC: 8)**
  - [ ] 9.1 Add `Lease owner:` line to the story footer (this file) AFTER the deploy lands. Format: `Lease owner: dev.jonathan.green@gmail.com (pubkey: <hex>)`. Update the entry in `deploy/akash/README.md` § "Foreign TOON Client".
  - [ ] 9.2 Add a sunset reminder entry to `_bmad-output/implementation-artifacts/deferred-work.md` under a new § "Epic 49 sunset checklist":
        > - **49.3 foreign-pod lease** — close when Epic 49 retires OR by 2026-08-31, whichever comes first. Lease URL in `deploy/akash/leases.json.foreign_toon_client`. Owner: <name>.
        > - **49.2 faucet lease** — close at the same time as 49.3 (faucet has no consumers once 49.3 closes).
  - [ ] 9.3 Add an orphan-lease detector follow-up entry to the same section: "Wire `scripts/akash-status.sh --orphan-check` into CI nightly; page on unknown leases. Currently manual."

- [ ] **Task 10: Close-out (AC: 8, 10)**
  - [ ] 10.1 Smoke passes from fresh state (Task 7 results in `### Review Findings`).
  - [ ] 10.2 Confirm any bugs found are patched IN THIS STORY'S PRs (or documented as deferred work).
  - [ ] 10.3 `pnpm --filter @toon-protocol/townhouse build` clean — no new type errors.
  - [ ] 10.4 `pnpm --filter @toon-protocol/townhouse test` — contract test passes, no regressions.
  - [ ] 10.5 Update sprint-status: `49-3-persistent-akash-foreign-client-pod` → `review` (or `done` post-review).
  - [ ] 10.6 `### Review Findings` contains a dated entry.

## Dev Notes

### Story Mission — Wrap the 49.1 In-Process Flow in HTTP, Deploy It

49.1 proved that a SOCKS5-equipped foreign client (in-process inside vitest, against a hardcoded local Anvil) can publish a kind:1 through a townhouse `.anyone` HS, get an acceptance receipt, and have the operator's connector tag the foreign pubkey as `'external'`. That same flow is the ENTIRE algorithmic content of this story's pod. The job here is mechanical: wrap it in Fastify, ship it as a Docker image, deploy it as an Akash pod, expose `POST /publish {event, targetHostname}` as the public API.

The novel parts are:
1. **Ephemeral signer key + faucet auto-fund on boot** (no operator-side secret management; 49.2 is the funding plane).
2. **Runtime-mutable target HS** (no env-baked hostname — laptop reboot doesn't require redeploy).
3. **No app-layer idempotency** (Nostr event-id dedup at the relay is sufficient; user direction party mode 2026-05-18).
4. **Persistent deployment** (NOT ephemeral per CI run; cost model amortizes the anon-client bootstrap and faucet drips).

### Hard rules (mirror 47.5 / 48.7 / 49.1 § "Hard rules")

1. **No edits to `packages/client/src/ToonClient.ts` or `packages/client/src/transport/socks5.ts`.** Those are the existing in-process foreign-client surfaces and they work — 49.1's 7/7 PASS proves it. Bug fixes there = separate PR.
2. **No edits to `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts`.** That's 49.1's gate; it stays as the in-process precedent.
3. **One new test file (smoke):** `packages/townhouse/src/__integration__/akash-foreign-pod-smoke.test.ts`. Plus ONE unit test (contract): `packages/townhouse/src/__integration__/foreign-publish-contract.test.ts`.
4. **No new test-infra script.** Reuse `scripts/akash-deploy.sh` + `scripts/akash-status.sh` + the existing image-build pattern.
5. **Bugs found → separate PRs → smoke re-run → THEN flip to `done`** (Hard Rule from 47.5/48.7/49.1).
6. **Persistent lease has a named owner + sunset reminder + burn-budget AC** (Murat's gate-discipline #4 revision from party mode).
7. **Tor binary pinned in the Dockerfile at image build time** (MEMORY note `project_connector_anyone_postinstall_flake` — runtime postinstall = guaranteed flake).
8. **Signer keys live in memory ONLY.** No `0o600`-mode keyfile on disk; no Akash secret mount. Ephemeral by design.

### Reuse-First Inventory — CRITICAL ANTI-REINVENTION SECTION

The /bmad-party-mode discussion explored several architectural options that turn out to be already-solved problems in this codebase. Read these files BEFORE writing any new code:

| File | What it is | Reuse strategy |
|---|---|---|
| `packages/client/src/ToonClient.ts` (~800 LOC) | The ToonClient surface: `publishEvent`, `openChannel`, `signBalanceProof`, internal channelManager + btpClient lifecycle | **USE AS-IS.** The pod's `POST /publish` handler instantiates one ToonClient per `targetHostname` (cached map). |
| `packages/client/src/transport/socks5.ts` (203 LOC) | `createSocks5WebSocketFactory(socksProxy)` — wraps socks-proxy-agent + ws into a (url) => WebSocket factory; validates `socks5h://` scheme | **USE AS-IS.** The pod's ToonClient gets `transport: {type: 'socks5', socksProxy: 'socks5h://127.0.0.1:9050'}`. |
| `packages/client/src/config.ts` | `applyDefaults` + `validateConfig` — validates socks5h:// scheme and derives btpUrl from connectorUrl | **USE AS-IS.** The pod sets `btpUrl` explicitly per-request; config validation catches `socks5://` typos. |
| `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts` | 49.1's gate test — IS the in-process publish flow this story wraps in HTTP | **READ + EXTRACT.** Don't import it (different package); replicate the boot sequence + publish call in the pod entrypoint. |
| `docker/Dockerfile.sdk-e2e` | Existing image bundling ToonClient, connector, native modules, esbuild | **REUSE WITH NEW ENTRYPOINT.** Add `docker/src/entrypoint-foreign-pod.ts` as a parallel entrypoint; no fork. |
| `docker/src/entrypoint-sdk.ts` | The existing sdk-e2e entrypoint pattern | **READ FOR PATTERN.** New entrypoint follows the same env-driven config + graceful shutdown shape. |
| `docker/esbuild.config.mjs` | esbuild config for entrypoint bundles | **EXTEND** with the new entrypoint target. |
| `@anyone-protocol/anyone-client@1.1.3` | The anon-network SOCKS5 daemon | **USE AS-IS via `docker/package.json` dep.** Pin Tor binary at image build (memory note). |
| `nostr-tools` | `generateSecretKey`, `getPublicKey`, `finalizeEvent` | **USE AS-IS.** Pod generates EVM-relevant keys via @noble/curves (the ToonClient signing key is secp256k1, not Schnorr — distinct from the Nostr event signing key the caller supplies). |
| `viem ^2.47` | EVM signer + RPC client | **USE AS-IS.** Pod uses viem for `eth_getBalance` polling + EIP-712 signing (already inside ToonClient's channelManager). |
| `deploy/akash/leases.json` | Canonical state file | **READ** `faucet.url`, `anvil.url`, `solana.url`; **EXTEND** with `foreign_toon_client.url` after deploy. |
| `scripts/akash-deploy.sh` | Akash deploy tooling | **EXTEND** with `build_foreign_toon_client` + `deploy_foreign_toon_client` verbs. |

### Architectural Layering — What the Pod Actually Exercises

```
external caller (laptop test process, 49.4/49.5 gate, third-party dev)
  ↓ HTTPS POST /publish {event, targetHostname}
Akash foreign-pod lease (ghcr.io/toon-protocol/akash-foreign-toon-client:demo)
  ├── Fastify on :8080 (clearnet, public ingress via Akash L7)
  │   ├── ajv-validate request body against foreign-publish.schema.json
  │   ├── rate-limit (token bucket, 30/min per src IP)
  │   ├── cache-lookup or construct fresh ToonClient(targetHostname)
  │   └── return 202 {eventId, claimHash, ...}
  ├── ToonClient (in-process) — from @toon-protocol/client
  │   ├── transport: socks5h://127.0.0.1:9050 (via createSocks5WebSocketFactory)
  │   ├── btpUrl: wss://${targetHostname}/btp
  │   └── connectorUrl: http://127.0.0.1:<local-connector-port>
  ├── local connector (in-pod, Anvil-backed) — clearnet to Akash-Anvil
  │   └── channelManager opens BTP channel, signs EIP-712 balance proof
  ├── @anyone-protocol/anyone-client daemon (in-pod) — SOCKS5 on 127.0.0.1:9050
  │   └── dials targetHostname.anyone via Tor circuit
  └── ephemeral signer keys (in-memory only, regen on pod restart)
      └── funded on boot via POST <faucet.url>/faucet (49.2's API)

target townhouse HS (on operator's laptop, OR another Akash pod for tests)
  ├── townhouse hs up — published .anyone hostname X
  └── connector accepts BTP channel → relay accepts kind:1 → peer-type 'external'
```

The pod is a **stateful long-lived service** (signer keys, ToonClient cache, anon-client daemon) but it has **no persistent disk state** (ephemeral keys, in-memory ring buffer, no on-disk wallet). A redeploy = fresh keys + fresh faucet drip + ready to publish. That's the right shape for a dev fixture; production-grade key management is out of scope.

### Schema-Contract Discipline (Murat)

- **File path:** `packages/townhouse/contracts/foreign-publish.schema.json`. Separate from `faucet.schema.json` (different service, different versioning cadence — both per user direction party mode 2026-05-18).
- **`additionalProperties: false`** on every object.
- **Both producer + consumer ajv-validate** at test time. Schema drift = build break.
- **No `Idempotency-Key` header field** — explicitly per AC #7. Trust Nostr event-id.

### Persistent-Deployment Discipline

- **Lease owner:** dev.jonathan.green@gmail.com (filled in at deploy time; update the story footer + `deploy/akash/README.md`).
- **AKT-burn budget:** ~1000 uakt/block ≈ $4-8/mo. Alert at 50% drain — wire to existing monthly cron OR document as a manual-eyeball discipline for now.
- **Sunset reminder:** added to `_bmad-output/implementation-artifacts/deferred-work.md` § "Epic 49 sunset checklist".
- **Orphan-lease detector:** noted as a follow-up; not blocking this story.

### Test Strategy

Two test files only (matches 49.2's pattern):

1. **`foreign-publish-contract.test.ts`** — vitest unit, ajv-validates schema. Catches drift before deploy.
2. **`akash-foreign-pod-smoke.test.ts`** — vitest integration, `RUN_AKASH_SMOKE=1`, runs against the live deployed pod + a local `townhouse hs up`. CI workflow_dispatch only (NFR6).

### Out of Scope

- Settlement assertions (which chain the claim lands on, USDC delta on the operator's earnings plane) — **that's 49.4** (was 49.2). This story stops at "relay accepted, channel rooted at pod's pubkey, peer-type 'external'".
- Mill / SOL leg via swap peer — also 49.4.
- Multi-event batching, streaming publish — out of scope.
- Auth on `/publish` beyond IP rate limit (no JWT/mTLS this story).
- App-layer idempotency / replay cache (AC #7 — trust Nostr semantics).
- AKT balance alerting wire-up — filed as 49.3-followup; this story documents the budget AC, ops wiring is separate.
- TEE attestation / production key sovereignty — not on the v0.1 path; Epic 18 territory.

### References

- [Source: _bmad-output/planning-artifacts/epics-townhouse-hs-v1.md § "Story 49.3: Persistent Akash Foreign-Client Pod"] — Epic-level spec.
- [Source: _bmad-output/implementation-artifacts/49-1-toon-client-foreign-townhouse-hs-smoke.md] — Most recent foreign-client gate; the in-process precedent that this story wraps in HTTP. READ END-TO-END.
- [Source: packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts] — Working publish flow; the pod entrypoint extracts the publish portion.
- [Source: _bmad-output/implementation-artifacts/49-2-akash-devnet-faucets-and-ui.md] — Faucet contract this story depends on.
- [Source: _bmad-output/implementation-artifacts/47-5-live-e2e-gate-earnings-data-plane.md] — Architectural precedent for the gate-pattern + BLOCKED-PARTIAL fallback for AC #5.
- [Source: packages/client/src/ToonClient.ts] — Reuse target for publish/openChannel/signBalanceProof.
- [Source: packages/client/src/transport/socks5.ts] — Reuse target for SOCKS5 factory.
- [Source: packages/client/src/config.ts] — Reuse target for config validation (socks5h:// scheme).
- [Source: docker/Dockerfile.sdk-e2e] — Reuse target for image (parallel entrypoint, no fork).
- [Source: docker/src/entrypoint-sdk.ts] — Pattern for the new `entrypoint-foreign-pod.ts`.
- [Source: docker/esbuild.config.mjs] — Extension target for the new entrypoint bundle.
- [Source: deploy/akash/anvil.sdl.yaml] + [solana.sdl.yaml] — SDL pattern; mirror for `foreign-toon-client.sdl.yaml`.
- [Source: deploy/akash/leases.json] — State file; extend with `foreign_toon_client` key after deploy.
- [Source: scripts/akash-deploy.sh] — Deploy tooling; extend with new verb.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md § "Deferred from: code review of 49-1-toon-client-foreign-townhouse-hs-smoke"] — D1 real SOCKS5 handshake probe (USE this pattern in the pod's SOCKS5 readiness check, not raw TCP).
- [Memory: project_connector_anyone_postinstall_flake] — Pin Tor binary at image build time.
- [Memory: project_solana_validator_io_uring] — Akash provider seccomp profiles vary; pre-deploy probe recommended via `scripts/akash-status.sh`.
- [Memory: project_akash_ws_probe_false_negative] — WS probe false negative on HTTP/2 ingress; don't redeploy on this warning alone.

### Project Structure Notes

- **Alignment with `_bmad-output/project-context.md`:** New entrypoint in `docker/src/` follows existing pattern (sdk-e2e, oyster). New SDL in `deploy/akash/` follows existing pattern. New contract file in `packages/townhouse/contracts/` follows the 49.2 precedent.
- **Detected conflicts:** the publish-flow code duplicates the 49.1 in-process test's setup (~150 LOC of boilerplate around ToonClient construction, channel open, claim sign). This is acceptable — the entrypoint is in `docker/src/`, the test is in `packages/townhouse/src/__integration__/`, refactoring to a shared module is scope creep. Flag in `### Review Findings` if the duplication becomes painful.
- **Variance from project-context:** Fastify is already a townhouse dep, but `docker/` workspace member may not pull Fastify directly; check `docker/package.json` before adding. If Fastify isn't there, this story adds it (~1 dep, justified by the story's HTTP control plane).

## Dev Agent Record

### Agent Model Used

_To be filled by the dev agent at implementation start._

### Debug Log References

_To be filled by the dev agent._

### Completion Notes List

_To be filled by the dev agent._

### File List

_To be filled by the dev agent._

### Review Findings

_Code review required before closing this story. Replace this line with a dated entry: `_Code review YYYY-MM-DD — [findings or "no issues found"]`_

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section
- [ ] Does this story contain regex or template substitution logic? **Yes** — `targetHostname` regex `/^[a-z2-7]+\.(anyone|anon)$/` appears in the schema AND in tests AND in pod-internal validation. At least one unit test must use a real-world string: an actual `.anyone` HS hostname generated by `townhouse hs up` (capture one from 49.1's smoke output and stash in `__integration__/fixtures/hostnames.json`).
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? **Yes** — `akash-foreign-pod-smoke.test.ts` is gated by `RUN_AKASH_SMOKE=1` AND requires `AKASH_FOREIGN_POD_URL` env. The smoke MUST be un-gated and run at least once against a live Akash foreign-pod lease against a live local `townhouse hs up` before marking this story done. Comment at top of test file: `// Gate: requires live Akash foreign-pod at AKASH_FOREIGN_POD_URL + local townhouse hs up. Run before marking story done.`
- [ ] Task 9.1 lease owner filled in (post-deploy)
- [ ] Task 9.2 sunset reminder entry added to deferred-work.md
- [ ] Update sprint-status to `done` (with PR number in trailing comment)

---

**Lease owner:** _<filled in at deploy time, e.g., dev.jonathan.green@gmail.com (pubkey: <hex>)>_
