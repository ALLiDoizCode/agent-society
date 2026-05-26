# Story 49.5: Live E2E Gate — Real `.anyone` Loop + DVM Arweave Upload + EVM/SOL Akash Chains

Status: ready-for-dev

> **Close-out story of Epic 49 (re-sequenced 2026-05-18 via /bmad-party-mode).** Sized **XL**. Depends on Stories 49.1, 49.2, 49.3, and 49.4 (all `done`). This is the single unattended gate that must exit green before v0.1 pilot recruitment. Mission: prove that a foreign ToonClient can publish a paid Nostr event AND a kind:5094 Arweave-upload job to a local townhouse HS + DVM over real `.anyone` transport, settling payment via Akash-hosted EVM devnet, and that the DVM returns a valid Arweave txid carried in the ILP FULFILL data field. Two critical prerequisites must land as part of this story's blast radius: (D3) `connector:3.6.3` image-manifest pin and (D4) `townhouse-api` earnings `status` field fix — both were already patched into the local `dist/image-manifest.json` during the 49.4 campaign but must be formalised as the official gate manifest before any CI run can be GREEN. The SOL leg is BLOCKED-STRUCTURAL per 49.4 (Mill routing layer not implemented); 49.5 runs EVM-only and documents the SOL deferral to Epic 50.
>
> **Architecture pivot from 49.4 (CRITICAL — see § "Architecture Pivot" below):** 49.4 closed BLOCKED-PARTIAL because Akash provider quality was the binding constraint — 4 consecutive foreign-pod provider failures in one hour. The canonical 49.5 gate (already implemented as untracked WIP — see § "Reuse-First Inventory") resolves this by running the foreign client as a LOCAL Docker container (`ghcr.io/toon-protocol/akash-foreign-toon-client:demo`) instead of an Akash-deployed pod. Both client and apex are on separate Docker networks (`e2e-client-net` + `townhouse-hs-net`) and can ONLY reach each other via the public ATOR network — the `.anyone` transport invariant is preserved. Akash chains (anvil + solana) are still consumed from `deploy/akash/leases.json`. The foreign-pod lease remains available as a secondary test surface but is NOT the primary gate vehicle.
>
> **Four untracked WIP files are already implemented** (`packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts`, `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts`, `scripts/townhouse-e2e-local-hs.sh`, `docker-compose-e2e-local-client.yml`). Read every one end-to-end BEFORE writing any new code. Task 1 is commit + verify, not design.

## Story

As the **townhouse release engineer closing out Epic 49**,
I want a single unattended script that runs the full TOON-client → HS → connector → DVM → earnings loop against real `.anyone` transport AND the Akash-hosted EVM devnet,
so that **the loop is provably green on shared real infrastructure before pilot recruitment and before any v1.0 publish.**

## Acceptance Criteria

1. **AC #1 — kind:1 publish via real `.anyone` transport:**
   **Given** the local townhouse apex (`townhouse hs up`) has a live `.anyone` hostname AND the foreign client Docker container is running on `e2e-client-net` (isolated from `townhouse-hs-net`)
   **When** the gate drives a signed kind:1 event via the foreign client's `POST /publish` endpoint with `targetHostname: <apex>.anyone`
   **Then** the publish returns `202 {eventId, claimHash, chainId: 31337, ...}` within 90s wall-clock AND the apex's town relay has accepted the event (confirmed via relay subscription or `townhouse drill` log lines).
   **And** `claimHash` matches `/^0x[0-9a-fA-F]{64}$/` AND `chainId === 31337`.
   **And** the transport path is confirmed real `.anyone`: the client's SOCKS5 dial goes through `@anyone-protocol/anyone-client` on `127.0.0.1:9050` inside the container; `targetHostname` matches `/^[a-z2-7]+\.(anyone|anon)$/`.

2. **AC #2 — kind:5094 DVM Arweave upload job:**
   **Given** the DVM container is running (image from `dist/image-manifest.json` key `'dvm'`) with `DVM_ARWEAVE_JWK_B64` NOT set AND the apex connector is healthy
   **When** the gate drives a kind:5094 event (`['i', base64Blob, 'blob']` + `['bid', amount, 'usdc']` + `['output', contentType]`) with payload ≤ 100KB
   **Then** the ILP layer returns a FULFILL response AND `result.data` decodes to a valid Arweave txid (`Buffer.from(result.data, 'base64').toString()` yields a base64url string of ~43 chars matching `/^[A-Za-z0-9_-]{43}$/`).
   **And** the DVM used `TurboFactory.unauthenticated()` — confirmed by (a) docker inspect confirming `DVM_ARWEAVE_JWK_B64` absent from container Env[], AND (b) DVM container logs containing the "unauthenticated" source label.

3. **AC #3 — `.anyone` transport invariants:**
   **Given** the gate has completed AC #1 and AC #2
   **When** the gate inspects the transport configuration
   **Then** ALL of the following hold:
   - BTP client inside the foreign container dials `ws://<apex>.anyone:3000/btp` via `socks5h://127.0.0.1:9050` (NOT clearnet)
   - Chain RPCs (Anvil) are on clearnet (NOT routed through SOCKS5) — per user direction in party mode 2026-05-18
   - `targetHostname` regex: `/^[a-z2-7]+\.(anyone|anon)$/` matches the apex's published hostname
   - No `127.0.0.1` hostname appears in any BTP dial string (the isolation invariant from 49.1 AC #3)

4. **AC #4 — Earnings credit appears in `/api/earnings` after paid publish:**
   **Given** AC #1's paid publish has landed (non-zero `TOON_FEE_PER_EVENT = 1_000_000` raw units)
   **When** the gate polls `GET http://127.0.0.1:28090/api/earnings` within a 90s deadline
   **Then** the response (ajv-validated against `packages/townhouse/src/api/schemas/earnings.ts`) reflects the credit in at least ONE of:
   - **(a)** `recentClaims[]` with `peerId === <foreign_client_evm_addr>`, `direction === 'inbound'`, `amount` within ±1 USDC-cent of `EXPECTED_FEE`, `at >= testStartMs`  (PRIMARY — recentClaims canonical bucket for unregistered inbound BTP peers, per 49.4 OQ-1 resolution)
   - **(b)** `peers[].id === <foreign_client_evm_addr>` with `type === 'external'` AND `byAsset[*].lifetime` increased by ≥ `EXPECTED_FEE - TOLERANCE`  (registered-peer path)
   - **(c)** `apex.routingFees[*].lifetime` increased by ≥ `EXPECTED_FEE × apex_fee_rate`  (apex-fee-skim path)
   **And** logs are captured to `./e2e-49-5-logs/<timestamp>/` on failure.

5. **AC #5 — Settlement chain endpoints are Akash-hosted (not localhost):**
   **Given** `deploy/akash/leases.json` contains `anvil.url` and `solana.url` pointing at Akash ingresses
   **When** the gate runs the pre-flight chain probe
   **Then** the connector's chain config resolves to `anvil.url` (NOT `127.0.0.1:18545` or `127.0.0.1:8545`) for EVM settlement.
   **And** the pre-flight probe calls `eth_blockNumber` on `anvil.url` and requires a valid hex block number in the response — fail-fast with `"Akash EVM RPC unreachable at <url> — run scripts/akash-deploy.sh anvil"` if the probe fails.
   **And** Solana probe: `getHealth` on `solana.url` returns `"result":"ok"` — fail-fast with the equivalent Solana message if not. (SOL is BLOCKED-STRUCTURAL for settlement but the chain must still be up for the gate to run.)
   **And** the gate does NOT fall back to any `127.0.0.1` chain fixture if the Akash RPC is unreachable.

6. **AC #6 — DVM runs unauthenticated Turbo (no wallet required for ≤ 100KB):**
   **Given** the DVM container is started WITHOUT `DVM_ARWEAVE_JWK_B64` in its environment
   **When** the gate inspects the DVM container post-start
   **Then** `docker inspect <DVM_CONTAINER_NAME>` confirms `DVM_ARWEAVE_JWK_B64` is absent from container `Env[]`.
   **And** DVM container logs contain evidence of `TurboFactory.unauthenticated()` path (any log line containing "unauthenticated" source label OR absence of "authenticating" log line).
   **And** the Arweave upload in AC #2 succeeds using the free-tier path (≤ 100KB payload).

7. **AC #7 — SOL leg BLOCKED-STRUCTURAL (Epic 50 deferral):**
   **Given** 49.4's OQ-2 resolution (BLOCKED-STRUCTURAL — Mill never receives an inbound credit because the foreign client targets `g.townhouse.town` not `g.townhouse.mill`; no routing config exists to redirect EVM claims through Mill; `mill.config.json` ships with `swapPairs:[]`)
   **When** the gate runs
   **Then** the test formally asserts the BLOCKED-STRUCTURAL status: Mill is registered (peerId='mill', type='mill') AND `PeerTypeResolver.resolvePeerType('mill') === 'mill'` — no swap claim is driven.
   **And** the test emits a `console.warn` citing "SOL leg BLOCKED-STRUCTURAL — deferred to Epic 50 (Mill routing layer)" — this is a legitimate SKIP, not a silent pass.
   **And** the story file documents the routing-layer gap and the Epic 50 work required.

8. **AC #8 — `scripts/townhouse-e2e-real-hs.sh` exits non-zero on any AC miss (FR34):**
   **Given** FR34 mandates a standalone gate script at `scripts/townhouse-e2e-real-hs.sh`
   **When** the script is invoked on a CI runner with `workflow_dispatch` trigger
   **Then** the script exits 0 only if all non-BLOCKED ACs pass AND exits non-zero with a structured failure message for any other outcome.
   **And** the script is a thin wrapper: it sets required env vars (`RUN_DOCKER_INTEGRATION=1`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) and delegates to `scripts/townhouse-e2e-local-hs.sh smoke` + `pnpm --filter @toon-protocol/townhouse test:integration`.
   **And** gate logs are captured to `./e2e-real-hs-logs/<timestamp>/` mirroring 49.4's `./e2e-49-4-logs/` precedent.

9. **AC #9 — `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` created:**
   **Given** all non-BLOCKED ACs have a live GREEN smoke run on record
   **When** the story closes
   **Then** `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` is created summarising: per-AC outcome, infrastructure state (Akash lease DSEQs), the canonical smoke run timestamp, the connector image digest, and the go/no-go recommendation for pilot recruitment.
   **And** any outstanding BLOCKED-STRUCTURAL items are listed with their Epic 50 ticket reference so they do not silently block the pilot.

**FRs:** FR34 | **NFRs:** NFR5 (real `.anyone` transport — no `127.0.0.1` substitute), NFR6 (CI `workflow_dispatch` only — never per-PR), NFR18 (gate emits PASS/FAIL code; logs captured to `./e2e-real-hs-logs/<timestamp>/`)

## Tasks / Subtasks

- [ ] **Task 1: Pre-work — read all untracked WIP files end-to-end (BLOCKING — no other work until done) (AC: all)**
  - [ ] 1.1 Read `packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts` (804 lines) end-to-end. This IS the canonical 49.5 gate. Note: AC mapping in file header, skip gate (`RUN_DOCKER_INTEGRATION=1`), test structure (5 tests), DVM protocol detail, prerequisites list, port allocations.
  - [ ] 1.2 Read `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts` (570 lines) end-to-end. This is the earnings-only variant (no DVM). Note the architecture: two isolated Docker networks, local client image, earnings assertions mirroring 49.4.
  - [ ] 1.3 Read `scripts/townhouse-e2e-local-hs.sh` (866 lines) end-to-end. The full orchestration script — `up` / `smoke` / `status` / `fund` / `down` / `down-v` subcommands, state dir at `~/.townhouse-e2e`, Akash constants (`APEX_EVM_ADDRESS`, `TOWN_EVM_ADDRESS`), port assignments (client `127.0.0.1:29200`, connector admin `127.0.0.1:9401`, townhouse API `127.0.0.1:28090`).
  - [ ] 1.4 Read `docker-compose-e2e-local-client.yml` end-to-end. Note network topology (`e2e-client-net` isolated from `townhouse-hs-net`), client port mapping (`127.0.0.1:29200:8080`), env vars forwarded to container.
  - [ ] 1.5 Read `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts` lines 1-100 (49.1 harness pattern). Confirm the `beforeAll` boot sequence: mkdtemp → init → hs up → hostname capture → B connector start → ToonClient construct → openChannel.
  - [ ] 1.6 Read `packages/townhouse/src/__integration__/akash-paid-earnings-smoke.test.ts` lines 1-100 + the recentClaims helper section (49.4 earnings assertion pattern, `findInboundClaimForPeer`, two-sided NFR10 tolerance, `claimHash` regex).
  - [ ] 1.7 Read `packages/townhouse/src/__integration__/_test-helpers.ts` — note exported surface: `isTruthyEnv`, `runCli`, `waitForExit`, `waitForUrl`. Do NOT duplicate.
  - [ ] 1.8 Read `deploy/akash/leases.json` — note current Akash endpoints: `anvil.url`, `solana.url`, `faucet.url`, `foreign-toon-client.url`. Anvil + Solana were freshly redeployed 2026-05-26 (DSEQs 26996018 and 26996029 respectively).
  - [ ] 1.9 Read `docker/esbuild.config.mjs` and `docker/src/entrypoint-dvm.ts` — note the DVM image's env var surface (`DVM_ARWEAVE_JWK_B64`, `CONNECTOR_URL`, `NOSTR_PRIVATE_KEY`). Confirm `TurboFactory.unauthenticated()` path when `DVM_ARWEAVE_JWK_B64` is absent.
  - [ ] 1.10 Read `packages/townhouse/src/connector/types.ts` lines 255-340 — confirm `EarningsResponse`, `PeerEarnings`, `AssetEarnings`, `RecentClaim` shapes. Asset code = `'USD'`, assetScale = 6.
  - [ ] 1.11 `git log --oneline -5` — confirm HEAD is `56475f9` (49.3 phantom wording fix). Confirm 49.1/49.2/49.3/49.4 all in `done`.
  - [ ] 1.12 Run `git status --short` — confirm the 4 WIP files show `??` (untracked). If any are already staged or modified, investigate before proceeding.

- [ ] **Task 2: Pre-flight gates (run BEFORE any code changes) (AC: 5, 8)**
  - [ ] 2.1 Verify sprint status: `49-4-... = done`, `49-3-... = done`, `49-2-... = done`, `49-1-... = done`.
  - [ ] 2.2 `pnpm --filter @toon-protocol/townhouse build` — must be clean. Note any pre-existing TypeScript errors (do NOT fix outside this story's blast radius).
  - [ ] 2.3 Run contract tests: `pnpm --filter @toon-protocol/townhouse test src/contracts/` — must pass. Establishes the baseline that nothing in the blast radius regresses.
  - [ ] 2.4 Probe live Akash leases (inline curl — fail this task if any endpoint is dead, do NOT proceed to Task 3):
    - `curl -s <anvil.url> -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` → expect `"result":"0x..."`.
    - `curl -sk <solana.url> -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"getHealth","params":[],"id":1}'` → expect `"result":"ok"`.
    - If either fails, run `bash scripts/akash-deploy.sh <chain>` to redeploy, update `deploy/akash/leases.json`, and re-probe.
  - [ ] 2.5 Verify `dist/image-manifest.json` exists locally AND contains `connector:3.6.3` (D3 prerequisite). If it contains `connector:3.6.2`, apply the manifest fix in Task 3 BEFORE attempting any gate run.
  - [ ] 2.6 Verify `dist/image-manifest.json` contains `townhouse-api` image with the `status` field present in `/api/earnings` responses (D4 prerequisite). Confirm by running `townhouse hs up` against a temp config dir and probing `/api/earnings` — the response MUST include `"status": "ok"` or `"status": "connector_unavailable"`.
  - [ ] 2.7 Check ports 9401, 28090, 9402, 9050, 3002, 8082, 3400, 29200 are free: `ss -tlnp | grep -E ':(9401|28090|9402|9050|3002|8082|3400|29200)'` — must return empty.

- [ ] **Task 3: Image-manifest fix (D3 + D4 — PREREQUISITE, AC: 4, 5) (only if Task 2.5/2.6 found issues)**
  - [ ] 3.1 Investigate whether `dist/image-manifest.json` can be produced locally or requires a full CI publish. Read `packages/townhouse/src/` for any `build-image-manifest` or `image-manifest` generation script. Check `packages/townhouse/package.json` build scripts.
  - [ ] 3.2 If local generation is possible: run the manifest builder with `connector:3.6.3` and `townhouse-api` at the correct digest, write to `packages/townhouse/dist/image-manifest.json`.
  - [ ] 3.3 If CI publish is required (A12' from Epic 48 retro): document the required CI action in this story's `### Review Findings`, confirm with the user that the rc7 tarball publish is in scope, and block the gate run (Task 7) pending CI completion. Do NOT attempt the gate with a broken manifest.
  - [ ] 3.4 Confirm by re-running Task 2.5 + 2.6 checks after applying the fix.

- [ ] **Task 4: Fix `scripts/akash-deploy.sh` readiness probe (D-49.4-PR1-3, AC: 5)**
  - [ ] 4.1 Read `scripts/akash-deploy.sh` lines around `probe_foreign_pod_healthz` and any generic `probe_url` helper. Identify the broken pattern: probe uses bare URL `/` which returns 404 from Fastify pods; only `/healthz` works.
  - [ ] 4.2 Parameterize the probe path: for foreign-pod-class services, default to `/healthz`. The fix must not break existing `probe_evm_ws` or `probe_solana_rpc` patterns.
  - [ ] 4.3 Test the fix manually: `bash scripts/akash-deploy.sh probe-foreign-pod` (or equivalent verb). Confirm `/` no longer triggers a false-negative on a live Fastify pod.
  - [ ] 4.4 Note: the existing memory entry `project_akash_ws_probe_false_negative` documents that `probe_evm_ws` warns on HTTP/2 ingresses — do NOT conflate or fix that here. Only fix the `/` vs `/healthz` probe path for Fastify-class pods.

- [ ] **Task 5: Commit and verify the 4 untracked WIP files (AC: all)**
  - [ ] 5.1 Stage and smoke-build the 4 WIP files: `git add packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts scripts/townhouse-e2e-local-hs.sh docker-compose-e2e-local-client.yml`.
  - [ ] 5.2 `pnpm --filter @toon-protocol/townhouse build` — must remain clean after staging the test files (TypeScript compile only; the test files themselves are not compiled).
  - [ ] 5.3 Run the skip-gate path: `pnpm --filter @toon-protocol/townhouse test:integration src/__integration__/townhouse-dvm-arweave-e2e.test.ts` WITHOUT `RUN_DOCKER_INTEGRATION=1` — must emit the skip warning and exit 0 (tests skipped, not failed). This confirms the file parses correctly.
  - [ ] 5.4 Run the skip-gate path for local-docker variant: same pattern with `local-docker-hs-paid-earnings-smoke.test.ts` WITHOUT `RUN_LOCAL_HS_E2E=1` — must skip cleanly.
  - [ ] 5.5 Verify `scripts/townhouse-e2e-local-hs.sh` is executable (`chmod +x scripts/townhouse-e2e-local-hs.sh`).
  - [ ] 5.6 Confirm `docker-compose-e2e-local-client.yml` parses: `docker compose -f docker-compose-e2e-local-client.yml config --quiet` — must return 0.

- [ ] **Task 6: Create `scripts/townhouse-e2e-real-hs.sh` (AC: 8, FR34)**
  - [ ] 6.1 The script is a thin wrapper — do NOT duplicate the 866-line orchestration. Structure:
    ```bash
    #!/usr/bin/env bash
    set -euo pipefail
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # Prerequisite: infra must already be up (townhouse-e2e-local-hs.sh up)
    export RUN_DOCKER_INTEGRATION=1
    export NODE_TLS_REJECT_UNAUTHORIZED=0
    TS="$(date +%s)"
    LOG_DIR="./e2e-real-hs-logs/${TS}"
    mkdir -p "${LOG_DIR}"
    bash "${SCRIPT_DIR}/townhouse-e2e-local-hs.sh" smoke 2>&1 | tee "${LOG_DIR}/smoke.log"
    pnpm --filter @toon-protocol/townhouse test:integration \
      src/__integration__/townhouse-dvm-arweave-e2e.test.ts \
      2>&1 | tee "${LOG_DIR}/gate.log"
    echo "PASS: 49.5 gate green. Logs: ${LOG_DIR}"
    ```
  - [ ] 6.2 The script exits non-zero automatically on any AC miss because `set -euo pipefail` propagates test failures. Add an explicit `echo "FAIL: ..."` + `exit 1` trap for graceful failure messages.
  - [ ] 6.3 Add the script to `.gitignore` exclusion for `e2e-real-hs-logs/` (mirrors `.gitignore` entry for `e2e-49-4-logs/` added in 49.4).
  - [ ] 6.4 `chmod +x scripts/townhouse-e2e-real-hs.sh`.

- [ ] **Task 7: Investigate ATOR stability for `townhouse-dvm-arweave-e2e.test.ts` (OQ-1, AC: 1, 2, 3)**
  - [ ] 7.1 Per deferred-work.md § D6: ACs #1-#4 in `townhouse-dvm-arweave-e2e.test.ts` require stable ATOR bootstrap. The 60s hardcoded limit in `@anyone-protocol/anyone-client` fires under load. Check the current ATOR network status by running the SKIP-gated path first, then attempting a full run.
  - [ ] 7.2 If ATOR bootstrap times out: investigate whether the `@anyone-protocol/anyone-client` timeout is configurable via env var or constructor option. If yes, document the override. If no, assess whether a fork or wrapper is viable within this story's blast radius.
  - [ ] 7.3 If ATOR consistently times out and is not overridable: escalate `local-docker-hs-paid-earnings-smoke.test.ts` (`RUN_LOCAL_HS_E2E=1`) as the canonical gate for story close-out. The DVM Arweave verification (AC #2) is only in `townhouse-dvm-arweave-e2e.test.ts` — if ATOR is unstable, document this as the specific remaining gap and file it in `deferred-work.md` § D7 (OQ-1 resolution).
  - [ ] 7.4 Resolve OQ-1 in `### Review Findings`: which test file is the canonical gate?

- [ ] **Task 8: Live gate smoke execution (AC: 1-6, 8)**
  - [ ] 8.1 Start the local-HS infra: `bash scripts/townhouse-e2e-local-hs.sh up`. Wait for healthy state (connector admin at `127.0.0.1:9401`, townhouse API at `127.0.0.1:28090`, client at `127.0.0.1:29200`).
  - [ ] 8.2 Capture pre-run baseline: `curl -s http://127.0.0.1:28090/api/earnings > ./e2e-49-5-logs/<ts>/pre-earnings.json`.
  - [ ] 8.3 Run the canonical gate (primary path — DVM variant):
    ```bash
    NODE_TLS_REJECT_UNAUTHORIZED=0 RUN_DOCKER_INTEGRATION=1 \
      pnpm --filter @toon-protocol/townhouse test:integration \
      src/__integration__/townhouse-dvm-arweave-e2e.test.ts
    ```
  - [ ] 8.4 If AC #1-#4 fail due to ATOR instability (per OQ-1), run the secondary path (earnings-only, local-Docker variant):
    ```bash
    NODE_TLS_REJECT_UNAUTHORIZED=0 RUN_LOCAL_HS_E2E=1 \
      pnpm --filter @toon-protocol/townhouse test:integration \
      src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts
    ```
  - [ ] 8.5 Capture post-run: `curl -s http://127.0.0.1:28090/api/earnings > ./e2e-49-5-logs/<ts>/post-earnings.json`.
  - [ ] 8.6 Document per-AC PASS/FAIL/BLOCKED outcome in `### Review Findings`. The PASS bar for story close-out: ACs #1-#6 and #8 GREEN (or BLOCKED-STRUCTURAL with explicit documentation); AC #7 (SOL) formally BLOCKED-STRUCTURAL.
  - [ ] 8.7 Tear down: `bash scripts/townhouse-e2e-local-hs.sh down-v`.

- [ ] **Task 9: CI wiring (AC: 8, NFR6)**
  - [ ] 9.1 Create (or update) `.github/workflows/e2e-real-hs.yml` with `on: workflow_dispatch` (NEVER `on: push` or `on: pull_request`). The workflow calls `bash scripts/townhouse-e2e-real-hs.sh`.
  - [ ] 9.2 NFR6 hard requirement: the workflow MUST NOT be triggered per-PR. Add a comment explaining this: `# NFR6: This gate runs real .anyone transport + real Akash chains. Never add on: push/pull_request.`
  - [ ] 9.3 The workflow must set `NODE_TLS_REJECT_UNAUTHORIZED: '0'` in the env block (Akash provider self-signed TLS certs — 49.3 precedent). Document this as a CI-specific requirement, not a general policy.
  - [ ] 9.4 Verify the workflow file is syntactically valid: `gh workflow list` or `cat .github/workflows/e2e-real-hs.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)"`.

- [ ] **Task 10: Create `v0.1-pilot-readiness.md` artifact (AC: 9)**
  - [ ] 10.1 After Task 8 confirms GREEN smoke run: create `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md`. Template:
    - Go/no-go: PASS (with caveats noted)
    - ACs summary table (per-AC outcome, see template in Dev Notes)
    - Infrastructure state: Akash lease DSEQs + ingress URLs + health probe results from Task 2.4
    - Connector image: `connector:3.6.3` at digest `c9d5b65c…`
    - Gate timestamp + smoke evidence (earnings delta, DVM txid excerpt)
    - BLOCKED-STRUCTURAL items: SOL leg (Epic 50 ticket reference), ATOR 60s timeout (D7 if applicable)
    - Pilot-recruitment green light: "Recommend pilot recruitment proceed"
  - [ ] 10.2 The artifact is a MARKDOWN file — deliberately created here per story spec (distinct from the no-documentation rule which applies to README/design docs, not gated milestone artifacts).

- [ ] **Task 11: Close-out (AC: all)**
  - [ ] 11.1 Update sprint-status.yaml: `49-5-...` → `review`.
  - [ ] 11.2 Update `_bmad-output/implementation-artifacts/deferred-work.md`: resolve D6 (mark resolved with smoke evidence), add OQ-1 resolution, add OQ-2 resolution (gate script identity), add OQ-3 resolution (rc7 tarball question). Add any new deferred items under "Deferred from: code review of 49-5-...".
  - [ ] 11.3 Persistent-deployment discipline: document in `### Review Findings` which Akash leases are active, their DSEQs, and their sunset checklist status. This story does NOT create new leases — it reuses the freshly-redeployed `anvil` (DSEQ 26996018) and `solana` (DSEQ 26996029) from 2026-05-26.
  - [ ] 11.4 Build clean: `pnpm --filter @toon-protocol/townhouse build` — 0 new errors.
  - [ ] 11.5 Contract tests clean: `pnpm --filter @toon-protocol/townhouse test src/contracts/`.
  - [ ] 11.6 Story file `Status` → `review`.

## Dev Notes

### Story Mission — The Final Proof

49.5 is the **close-out gate** for Epic 49. The four predecessor stories collectively delivered:
- 49.1: In-process foreign-client smoke (`.anyone` transport proven, ToonClient surface working)
- 49.2: Akash devnet faucets (EVM + SOL devnet funding infrastructure)
- 49.3: Persistent Akash foreign-client pod (real cross-network foreign client)
- 49.4: Paid-packet earnings receipt (revenue loop proven at connector level; round-6 evidence = 1_000_000 USDC raw units, direction inbound, claimHash `0xfb8533b4…`)

49.5 must show:
1. The complete loop runs unattended (not just connector-level evidence)
2. DVM Arweave upload works over the same transport
3. The gate is reproducible by CI (`scripts/townhouse-e2e-real-hs.sh`)
4. The v0.1-pilot-readiness artifact exists

### Architecture Pivot — Local Docker Client (CRITICAL)

49.4 closed BLOCKED-PARTIAL because Akash provider quality was the binding constraint. 4 consecutive provider failures in one hour. The architectural decision (D-49.4-PR1-1) is already implemented in the WIP files:

```
[Foreign client]               [Operator A's laptop]
e2e-client-net                 townhouse-hs-net
──────────────                 ─────────────────────
docker run                     townhouse hs up
ghcr.io/toon-protocol/         │
akash-foreign-toon-client:demo │
  │                            ├── apex .anyone HS
  │  SOCKS5 → ATOR → .anyone   │     ├── connector (Akash-Anvil EVM RPC)
  └────────────────────────────┤     ├── DVM container (host network)
                               │     └── town relay (townhouse-hs-town)
  127.0.0.1:29200:8080         │
  (isolated — cannot reach     ├── townhouse API: 127.0.0.1:28090
   townhouse-hs-net directly)  └── connector admin: 127.0.0.1:9401
```

Key invariant: `e2e-client-net` and `townhouse-hs-net` are **separate Docker networks with no overlap**. The client's only path to the apex is through the public ATOR network. This preserves the NFR5 "real `.anyone` transport" requirement while eliminating Akash provider variability.

### Hard Rules

1. **No edits to 49.1/49.2/49.3/49.4 integration test files** — `townhouse-foreign-hs-smoke.test.ts`, `akask-faucet-smoke.test.ts`, `akash-foreign-pod-smoke.test.ts`, `akash-paid-earnings-smoke.test.ts` are sealed gate artifacts.
2. **No edits to Epic 47 earnings code** — `packages/townhouse/src/earnings/*.ts`, earnings schema, earnings routes.
3. **No edits to Mill product surface** — `packages/mill/src/*.ts`.
4. **WIP files commit as-is first (Task 5)**, then identify and fix issues within their blast radius.
5. **`scripts/townhouse-e2e-real-hs.sh` = thin wrapper** around `townhouse-e2e-local-hs.sh` for FR34 compliance. Do NOT duplicate the 866-line orchestration.
6. **SOL BLOCKED-STRUCTURAL** — do NOT add new architecture for Mill routing. Document Epic 50 deferral and move on.
7. **Image-manifest fix (D3 + D4) is PREREQUISITE** — no gate run until `dist/image-manifest.json` contains `connector:3.6.3`.
8. **Bugs found in dependencies → separate PRs → smoke re-run → THEN flip 49.5 to `done`** (Hard Rule from 47.5/48.7/49.1 precedent).
9. **`NODE_TLS_REJECT_UNAUTHORIZED=0` is acceptable for smoke** — Akash providers ship self-signed TLS certs. Document in test header and CI workflow env block.

### Reuse-First Inventory — CRITICAL ANTI-REINVENTION SECTION

| File | Line count | Status | Reuse strategy |
|---|---|---|---|
| `packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts` | 804 | **Untracked WIP** | **COMMIT + VERIFY.** This IS the canonical 49.5 gate. Read end-to-end FIRST (Task 1.1). |
| `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts` | 570 | **Untracked WIP** | **COMMIT + VERIFY.** Secondary gate (earnings-only, no DVM). Fallback if ATOR unstable. |
| `scripts/townhouse-e2e-local-hs.sh` | 866 | **Untracked WIP** | **COMMIT + VERIFY.** The infra orchestrator for the local-Docker approach. |
| `docker-compose-e2e-local-client.yml` | ~40 | **Untracked WIP** | **COMMIT + VERIFY.** Compose for local foreign client. |
| `scripts/townhouse-e2e-real-hs.sh` | ~25 (to be created) | Does not exist | **CREATE** as thin wrapper (Task 6). |
| `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts` | ~1100 | Committed | **READ** for 49.1 harness pattern (HS apex boot, B connector, ToonClient). |
| `packages/townhouse/src/__integration__/akash-paid-earnings-smoke.test.ts` | ~1200 | Committed | **READ** for 49.4 earnings assertions (delta, recentClaims bucket, ajv schema). |
| `packages/townhouse/src/__integration__/_test-helpers.ts` | ~200 | Committed | **IMPORT** `isTruthyEnv`, `runCli`, `waitForExit`, `waitForUrl`. Do NOT duplicate. |
| `deploy/akash/leases.json` | ~60 | Committed | **READ** for Akash endpoint URLs. Anvil + Solana freshly redeployed 2026-05-26. |
| `scripts/akash-deploy.sh` | ~900 | Committed | **EXTEND** to fix D-49.4-PR1-3 (Task 4). Do NOT touch fee-per-event logic. |
| `packages/townhouse/dist/image-manifest.json` | ~40 | Local only (gitignored) | **FIX** to contain `connector:3.6.3` (Task 3). |
| `docker/src/entrypoint-dvm.ts` | ~300 | Committed | **READ** for DVM env surface. `TurboFactory.unauthenticated()` path. |
| `packages/townhouse/src/api/schemas/earnings.ts` | ~80 | Committed | **IMPORT** for ajv validation. Do NOT create new schema. |
| `packages/townhouse/src/connector/types.ts` | ~500 | Committed | **IMPORT** `EarningsResponse`, `PeerEarnings`, `RecentClaim`. |
| `packages/townhouse/src/registry/peer-type-resolver.ts` | ~100 | Committed | **IMPORT** for AC #7 SOL BLOCKED-STRUCTURAL assertion (fallback path). |

### DVM Protocol Detail

The Arweave DVM (kind:5094) returns the Arweave txId via the ILP FULFILL `data` field, NOT as a separate kind:6094 Nostr event:

```
Request:  kind:5094 event
          tags: [['i', base64Blob, 'blob'], ['bid', amount, 'usdc'], ['output', contentType]]
          
Response: ILP FULFILL
          data = Buffer.from(txId).toString('base64')
          
txId is base64url ~43 chars (e.g. 'nOXJjj...')
outer encoding is standard base64 (for ILP FULFILL data field)
publishEvent() return value carries this in result.data
```

Verification in AC #2: `Buffer.from(result.data, 'base64').toString()` → matches `/^[A-Za-z0-9_-]{43}$/`.

AC #6 verification: `docker inspect <DVM_CONTAINER_NAME>` → `Config.Env[]` does NOT contain `DVM_ARWEAVE_JWK_B64=`. Log line: grep for "unauthenticated" in DVM container output.

### Critical Prerequisites from 49.4 Carry-Forward

**D3 (CRITICAL):** rc6 image-manifest pins `connector:3.6.2` which returns HTTP 503 on `/admin/earnings.json` (`Earnings subsystem not enabled`) even when settlement init events fire correctly. The 47.5-validated `connector:3.6.3` (digest `c9d5b65c…`) resolves this. Patched into local `dist/image-manifest.json` during 49.4 campaign. Must be formalised before the gate can run GREEN.

**D4 (CRITICAL):** rc6's published `townhouse-api` returns `/api/earnings` responses MISSING the `status` field, breaking the ajv schema validation (strict mode). Local `townhouse-api:epic-47-local` (`e0b7f2e8…`) returns the canonical Epic 47.2+ shape with `status`. Same fix scope as D3.

**D-49.4-PR1-2 (first live evidence owed):** `docker/src/entrypoint-foreign-pod.ts` was patched to make `dripFromFaucet` best-effort (`.catch+log`) so the pod self-heals when an operator pre-funds addresses. New image digest: `sha256:571e0e66920b206b34d63bc08eabb456bab410b2586b38824b18cec3d9044cf8`. The local-Docker architecture eliminates the Akash pod entirely as the gate vehicle, but this patch is still relevant if the secondary smoke path (live Akash pod) is exercised.

**D-49.4-PR1-3 (fix in Task 4):** `scripts/akash-deploy.sh` readiness probe calls bare URL `/` which returns 404 from Fastify pods; only `/healthz` works. Fix: parameterize probe path for foreign-pod-class deployments.

### Open Questions (resolve in `### Review Findings`)

**OQ-1 (gate script identity — resolve in Task 7):** FR34 mandates `scripts/townhouse-e2e-real-hs.sh`. The WIP has both `scripts/townhouse-e2e-local-hs.sh` (orchestrator) and `townhouse-dvm-arweave-e2e.test.ts` (gate). Resolution: `townhouse-e2e-real-hs.sh` is the thin FR34 wrapper; it calls `townhouse-e2e-local-hs.sh smoke` + the DVM gate test. If ATOR instability (D6) makes the DVM gate unreliable, the real-hs script falls back to `local-docker-hs-paid-earnings-smoke.test.ts` and AC #2 (DVM) is demoted to D7. Document which.

**OQ-2 (ATOR stability — D6 from deferred-work.md):** `townhouse-dvm-arweave-e2e.test.ts` ACs #1-#4 require stable ATOR bootstrap. The 60s hardcoded limit in `@anyone-protocol/anyone-client` fires under load. Resolution = attempt the full run in Task 8.3; if timeout fires, investigate env-override viability (Task 7.2); if not viable, escalate to D7. Document clearly.

**OQ-3 (rc7 tarball publish — A12'):** `dist/image-manifest.json` must ship `connector:3.6.3`. Is this the full rc7 publish (Epic 48 retro A12') or just a local manifest fix? Resolution = Task 3 investigation. If CI publish required, that is the 49.5 close-out gate and must land before the story flips to `done`.

### SOL Leg — Epic 50 Deferral Documentation

**BLOCKED-STRUCTURAL (per 49.4 OQ-2 resolution):**

The foreign client sends ILP packets to `g.townhouse.town` (the relay address). Mill is registered at `g.townhouse.mill`. No routing logic in the current codebase redirects apex inbound EVM claims through Mill for SOL settlement. `mill.config.json` ships with `swapPairs:[]` (empty). The three candidate routing models from 49.4 Dev Notes are all structurally unimplementable without new product code in connector + townhouse + mill.

**Epic 50 work required:**
1. New architecture story: route inbound EVM claims through Mill for SOL settlement
2. Mill `swapPairs` configuration surface (currently empty by default)
3. Connector routing config to direct `g.townhouse.town` inbound → Mill for SOL swap
4. OR: foreign client must target `g.townhouse.mill` directly (requires SDL change + new pod routing)

49.5 formally demotes AC #2 from the original Epic 49.5 spec (SOL + EVM both green) to BLOCKED-STRUCTURAL, with EVM-only gate as the canonical close-out criterion.

### Test Strategy

**Two gate modes (resolve OQ-1 to pick the primary):**

| Mode | File | Gate env | Coverage |
|---|---|---|---|
| PRIMARY (DVM + .anyone) | `townhouse-dvm-arweave-e2e.test.ts` | `RUN_DOCKER_INTEGRATION=1` | ACs #1-#6, #8 — the canonical 49.5 gate |
| SECONDARY (earnings-only) | `local-docker-hs-paid-earnings-smoke.test.ts` | `RUN_LOCAL_HS_E2E=1` | ACs #1, #3-#5, #7 — fallback if ATOR unstable |

**No new test files** unless OQ-2 (ATOR) investigation surfaces a structural gap that requires one.

**DVM protocol detail is in `townhouse-dvm-arweave-e2e.test.ts` file header** — do not redesign it.

### Akash Lease State (as of 2026-05-26)

| Service | DSEQ | Ingress URL | Redeployed | Status |
|---|---|---|---|---|
| anvil | 26996018 | `https://5tsr6of8g1eh3dh4k1koglp7vg.ingress.boogle.cloud` | 2026-05-26 | FRESH |
| solana | 26996029 | `https://re4glcv67h8hr7g5ju9lemh3e0.ingress.europlots.com` | 2026-05-26 | FRESH |
| faucet | 26923231 | `https://4s49j3n3u9cbfae8oj9va7mufc.ingress.cpu.aesservices.net` | 2026-05-21 | Active |
| foreign-toon-client | 26909769 | `https://q5q51f71n9ebf50t0ur4dk8avk.ingress.akt.sies.com.gt` | 2026-05-20 | Dead (provider `akash1erl805e` — dead ingress in 49.4 campaign) |

Note: `foreign-toon-client` lease is NOT the primary gate vehicle (architecture pivot to local Docker). It may still be used for secondary smoke. If Akash pod is needed, redeploy via `bash scripts/akash-deploy.sh foreign-toon-client` (will skip the denylisted provider `akash1erl805e`).

### Orchestration Script State Dir

`scripts/townhouse-e2e-local-hs.sh` manages state at `~/.townhouse-e2e` (separate from operator's `~/.townhouse`). Key constants baked in:
- `APEX_EVM_ADDRESS=0x90F79bf6EB2c4f870365E785982E1f101E93b906` (Anvil acct[3])
- `TOWN_EVM_ADDRESS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` (Anvil acct[4])
- Client URL: `http://127.0.0.1:29200`
- Connector admin: `127.0.0.1:9401`
- Townhouse API: `127.0.0.1:28090`

### Port Allocation (49.5 gate)

| Port | Service | Conflict check |
|---|---|---|
| 9401 | Connector admin | `ss -tlnp \| grep :9401` |
| 28090 | Townhouse API | `ss -tlnp \| grep :28090` |
| 9402 | B's foreign connector admin | `ss -tlnp \| grep :9402` |
| 9050 | SOCKS5 (B's anon client) | `ss -tlnp \| grep :9050` |
| 3002 | B's BTP server | `ss -tlnp \| grep :3002` |
| 8082 | B's health port | `ss -tlnp \| grep :8082` |
| 3400 | DVM BLS health | `ss -tlnp \| grep :3400` |
| 29200 | Local foreign client HTTP | `ss -tlnp \| grep :29200` |

### Out of Scope

- Mill product changes (Epic 50).
- New earnings schema files (reuse `packages/townhouse/src/api/schemas/earnings.ts`).
- Multi-event batching, streaming claims.
- TEE attestation for DVM (Epic 4/6 territory).
- Aggregated cross-operator telemetry (deferred Epic 49-future per deferred-work.md).
- Mina settlement chain (out of Epic 49 scope).
- Pilot recruitment mechanics (Mary's outreach uses 49.5 `v0.1-pilot-readiness.md` artifact, not 49.5 internals).

### References

- `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md` § Story 49.5 — FR34, NFR5, NFR6, NFR18
- `_bmad-output/implementation-artifacts/49-4-paid-packet-earnings-receipt-evm-and-sol-on-akash.md` § "Carry-Forward to Epic 49.5" + § "Post-Review-Pass-1 Re-Run Attempt" — D3, D4, D-49.4-PR1-1 through PR1-3
- `_bmad-output/implementation-artifacts/deferred-work.md` § D6 (ATOR stability), § "Epic 49 sunset checklist"
- `_bmad-output/implementation-artifacts/epic-48-retro-2026-05-18.md` § A9', A12', A14' — hard prerequisites
- `packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts` — canonical 49.5 gate (804 lines, untracked, READ FIRST)
- `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts` — secondary gate (570 lines, untracked)
- `scripts/townhouse-e2e-local-hs.sh` — infra orchestrator (866 lines, untracked)
- `docker-compose-e2e-local-client.yml` — local client compose (untracked)
- `packages/townhouse/src/__integration__/townhouse-foreign-hs-smoke.test.ts` — 49.1 harness pattern
- `packages/townhouse/src/__integration__/akash-paid-earnings-smoke.test.ts` — 49.4 earnings assertion pattern
- `packages/townhouse/src/__integration__/_test-helpers.ts` — shared helpers (import, do not duplicate)
- `deploy/akash/leases.json` — Akash lease state (anvil+solana freshly redeployed 2026-05-26)
- `scripts/akash-deploy.sh` — D-49.4-PR1-3 fix target (Task 4)
- `docker/src/entrypoint-dvm.ts` — DVM env surface + `TurboFactory.unauthenticated()` path
- `packages/townhouse/src/api/schemas/earnings.ts` — ajv schema (REUSE; do NOT create new)
- `packages/townhouse/src/connector/types.ts` — `EarningsResponse`, `RecentClaim` type defs
- `packages/townhouse/src/registry/peer-type-resolver.ts` — AC #7 SOL BLOCKED-STRUCTURAL assertion
- `deploy/akash/denylist.json` — provider denylist (dead providers from 49.4 campaign)
- [Memory: project_akash_ws_probe_false_negative] — WS probe false negative on HTTP/2 ingresses; don't redeploy on this warning alone
- [Memory: project_49_3_smoke_fixes] — `ilpAmount=0n` bypasses connector→relay channel check; `btpPeerId=evmAddress`; 45s deadline beats nginx 60s

## Dev Agent Record

### Agent Model Used

_to be filled on story start_

### Debug Log References

_to be filled during implementation_

### Completion Notes List

_to be filled on story completion_

**OQ-1 (gate script identity — resolve in Task 7):** _pending_

**OQ-2 (ATOR stability — D6 resolution):** _pending_

**OQ-3 (rc7 tarball publish scope):** _pending_

### File List

Files expected to be created or modified by this story:

- `packages/townhouse/src/__integration__/townhouse-dvm-arweave-e2e.test.ts` — COMMIT WIP (804 lines, untracked)
- `packages/townhouse/src/__integration__/local-docker-hs-paid-earnings-smoke.test.ts` — COMMIT WIP (570 lines, untracked)
- `scripts/townhouse-e2e-local-hs.sh` — COMMIT WIP (866 lines, untracked)
- `docker-compose-e2e-local-client.yml` — COMMIT WIP (untracked)
- `scripts/townhouse-e2e-real-hs.sh` — CREATE (Task 6, thin FR34 wrapper, ~25 lines)
- `scripts/akash-deploy.sh` — MODIFY (Task 4, D-49.4-PR1-3 readiness probe fix)
- `packages/townhouse/dist/image-manifest.json` — VERIFY / FIX (Task 3, D3+D4; NOT committed — gitignored)
- `.github/workflows/e2e-real-hs.yml` — CREATE (Task 9, CI wiring)
- `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` — CREATE (Task 10, AC #9)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFY (status update)
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFY (D6 resolve, OQ resolutions, any new deferred items)
- `_bmad-output/implementation-artifacts/49-5-live-e2e-gate-real-anyone-loop-akash-evm-sol.md` — THIS FILE

### Review Findings

_To be populated during implementation. Template for per-AC summary:_

| AC | Outcome | Evidence |
|---|---|---|
| AC #1 — kind:1 via .anyone | _pending_ | _pending_ |
| AC #2 — kind:5094 DVM txid | _pending_ | _pending_ |
| AC #3 — .anyone transport invariants | _pending_ | _pending_ |
| AC #4 — Earnings credit | _pending_ | _pending_ |
| AC #5 — Akash chain endpoints | _pending_ | _pending_ |
| AC #6 — Unauthenticated Turbo | _pending_ | _pending_ |
| AC #7 — SOL BLOCKED-STRUCTURAL | **BLOCKED-STRUCTURAL** | 49.4 OQ-2 resolution; Epic 50 deferral |
| AC #8 — Gate script exits non-zero | _pending_ | _pending_ |
| AC #9 — v0.1-pilot-readiness.md | _pending_ | _pending_ |

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry with per-AC outcome + smoke run evidence.
- [ ] OQ-1 (gate script identity), OQ-2 (ATOR stability), OQ-3 (rc7 tarball scope) resolved in `### Review Findings`.
- [ ] `dist/image-manifest.json` contains `connector:3.6.3` (D3) AND `townhouse-api` with `status` field (D4). Documented in Review Findings with confirmation method.
- [ ] `scripts/townhouse-e2e-real-hs.sh` is executable AND exits 0 on a GREEN gate run AND exits non-zero when a test fails. Smoke-verified.
- [ ] `.github/workflows/e2e-real-hs.yml` uses `on: workflow_dispatch` ONLY (NFR6). No `on: push` or `on: pull_request`.
- [ ] `_bmad-output/implementation-artifacts/v0.1-pilot-readiness.md` created with: per-AC outcome table, Akash lease DSEQs, connector image digest, canonical smoke run timestamp, go/no-go recommendation.
- [ ] Does this story contain regex or template substitution logic? — If yes (e.g., `akash-deploy.sh` probe-path fix), document the substitution verification approach.
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Yes — `RUN_DOCKER_INTEGRATION=1` for `townhouse-dvm-arweave-e2e.test.ts`; `RUN_LOCAL_HS_E2E=1` for `local-docker-hs-paid-earnings-smoke.test.ts`. Both confirmed skipping cleanly without the env var.
- [ ] Sprint-status updated to `review`. Will move to `done` after `/bmad-code-review` concludes (per 49.1/49.2/49.3/49.4 precedent).
- [ ] Persistent-deployment discipline: no NEW Akash leases created by 49.5. Freshly-redeployed `anvil` (DSEQ 26996018) and `solana` (DSEQ 26996029) reused. Sunset checklist in `deferred-work.md § "Epic 49 sunset checklist"` is unaffected.
- [ ] SOL leg formally BLOCKED-STRUCTURAL with Epic 50 deferral documented in `v0.1-pilot-readiness.md` and `deferred-work.md`.
- [ ] Build clean: `pnpm --filter @toon-protocol/townhouse build` — 0 new errors.
- [ ] Contract tests clean: `pnpm --filter @toon-protocol/townhouse test src/contracts/`.

---

**Lease consumption (at story start 2026-05-26):** 49.5 reuses (does not own) — `anvil` (DSEQ 26996018, redeployed 2026-05-26), `solana` (DSEQ 26996029, redeployed 2026-05-26), `faucet` (DSEQ 26923231, 2026-05-21), `foreign-toon-client` (DSEQ 26909769, 2026-05-20 — dead provider, available for secondary smoke if re-deployed). Owner of all four: dev.jonathan.green@gmail.com. No new persistent infrastructure introduced by this story. Sunset checklist budget for the active leases is unchanged.
