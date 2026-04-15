# Story 12.10 Report (PARTIAL — HALTED)

## Overview
- **Story file**: `_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md`
- **Git start**: `def141366adbf4508f72aa82c1bbf832c37cebb2`
- **Recovery tag**: `pipeline-start-12.10`
- **Pipeline result**: **HALTED at step 4 (Develop)** — three upstream blockers identified, none within 12.10's scope. Retry not warranted (architectural gaps, not transient).
- **Migrations**: None.

## What Was Built
Story 12.10 aimed to graduate the Story 12.8 swap-flow integration tests from in-process mocks to real Docker infrastructure, covering all 9 (source,target) swap pairs across EVM/Solana/Mina.

## Pipeline Steps Executed
| # | Step | Status |
|---|------|--------|
| 1 | Create | success |
| 2 | Validate | success |
| 3 | ATDD | success (4 RED test files + config + helper scaffolded) |
| 4 | Develop | **HALT — 3 upstream blockers** |

Not executed: steps 5–22.

## Deliverables Produced
- `_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md` — story spec
- `_bmad-output/test-artifacts/atdd-checklist-12-10.md` — ATDD checklist
- `packages/mill/vitest.e2e.config.ts` — Docker E2E vitest config
- `packages/mill/tests/e2e/helpers/infra-gate.ts` — re-exports SDK E2E helpers
- `packages/mill/tests/e2e/docker-swap-flow-evm-e2e.test.ts` — RED
- `packages/mill/tests/e2e/docker-swap-flow-solana-e2e.test.ts` — RED
- `packages/mill/tests/e2e/docker-swap-flow-mina-e2e.test.ts` — RED
- `packages/mill/tests/e2e/docker-swap-flow-pair-matrix-e2e.test.ts` — 9-pair matrix, RED + 1 green structural guard
- `packages/mill/package.json` — added `test:e2e:docker` script

## Blockers

### B1 — Docker image `toon:optimized` build is broken
`./scripts/sdk-e2e-infra.sh up` fails at `docker/Dockerfile.oyster:65`:
```
#27 26.23 docker build: Failed
ERROR: failed to build: process "/bin/sh -c pnpm -r --filter '!@toon-protocol/client' build && cd docker && pnpm run build" did not complete successfully: exit code: 1
```
Independently confirmed by background-task monitor event.

- Root cause appears Alpine-specific: `node esbuild.config.mjs` exits 0 on host but 1 inside the builder stage. Likely memory, node version, or native-dep mismatch.
- **Impact**: blocks all Docker-based E2E in the repo, not just 12.10. SDK E2E suite (`packages/sdk/tests/e2e/docker-*.test.ts`) is also affected.

### B2 — Peer image has no Mill / no swap-handler / no kind:10032 publication
`docker/src/entrypoint-sdk.ts` contains zero references to `Mill`, `startMill`, `SwapHandler`, `SwapPair`, or any kind:10032 *publication* path. The peer consumes kind:10032 for discovery auto-peering but does not run a Mill.

- **Impact**: AC-3 (FULFILL from peer1) and AC-4 (relay-observable kind:10032) cannot pass against an unmodified peer image.
- **Missing prerequisite**: a feature story that integrates `startMill()` (Story 12.7) into `docker/src/entrypoint-sdk.ts` and publishes the Mill's kind:10032 peer-info event.

### B3 — No `StreamSwapClient` wiring in SDK public surface
`streamSwap()` requires a `StreamSwapClient` with a real `sendSwapPacket()` BTP method. `@toon-protocol/sdk.createNode()` returns a `ConnectorNode`/`ToonNode` but not a swap-aware ILP client.

- **Impact**: Every test's `buildLive{Evm,Solana,Mina}Sender()` returned `null` because the SDK has nothing to return.
- **Missing prerequisite**: feature story exposing a `StreamSwapClient`-shaped BTP bridge from the SDK (likely a method on `ToonNode`/`createNode()`).

## Recommended Next Actions
1. **Story 12.11 (fix)**: repair the Alpine Dockerfile.oyster esbuild build. Reproduce with `DOCKER_BUILDKIT=0 docker build -f docker/Dockerfile.oyster ...` to surface the swallowed esbuild stderr.
2. **Story 12.12 (feat)**: Mill integration into the peer entrypoint. Wire `startMill()` into `docker/src/entrypoint-sdk.ts`, register the swap handler, publish kind:10032 peer-info on relay.
3. **Story 12.13 (feat)**: expose `StreamSwapClient` from SDK. Add a BTP-backed swap client as a method on `ToonNode` or a new `createSwapClient()` export.
4. **Resume 12.10** once B1/B2/B3 are resolved. The existing RED scaffolding is directly implementable at that point — no rework needed.

## Recovery
To discard all 12.10 pipeline changes:
```
git reset --hard pipeline-start-12.10
```
To keep scaffolding and resume later, leave as-is — current HEAD has ATDD scaffolding committed. Working tree is clean (dev agent reverted its one exploratory edit before HALT).

## TL;DR
Story 12.10 correctly identified that graduating to real Docker infra requires three upstream prerequisites that don't yet exist: a working Docker build, a Mill-equipped peer entrypoint, and a BTP-backed `StreamSwapClient` in the SDK public API. The dev agent did the right thing by halting rather than papering over the gaps with `ctx.skip('blocked')` stubs. RED scaffolding for 4 test files is in place and ready to resume once the three prerequisite stories land.
