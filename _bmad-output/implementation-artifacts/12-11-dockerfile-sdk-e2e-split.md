# Story 12.11: Split SDK E2E Dockerfile from Oyster TEE image

Status: ready-for-dev
ui_impact: false
epic: 12
story_id: 12-11
story_type: fix

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Story type:** `fix` — corrects an inappropriate Dockerfile choice in the SDK E2E infrastructure. The SDK E2E peer image is currently built from `docker/Dockerfile.oyster`, which is the Marlin Oyster CVM (TEE attestation) production image. This story creates a minimal `docker/Dockerfile.sdk-e2e` and re-points the SDK E2E infra at it. This is a **predecessor** for Story 12.10 (real-infra E2E swap flow against multi-chain Docker infra) — 12.10 is currently blocked because the Oyster image build fails on the attestation-server bundle step.

## Story

As a **TOON Protocol maintainer working on Epic 12 real-infra E2E validation**,
I want **the SDK E2E infrastructure to build its peer image from a purpose-built `Dockerfile.sdk-e2e` that contains only what a local SDK E2E peer needs (ConnectorNode + BLS + relay, no supervisord, no attestation-server)**,
so that **`./scripts/sdk-e2e-infra.sh up` builds cleanly without pulling in TEE-specific dependencies that fail to bundle, Story 12.10 can run E2E swap flow tests against the infra, and the Oyster TEE production image (`Dockerfile.oyster`) remains cleanly separated for its intended enclave use case**.

## Context (why this story now)

`scripts/sdk-e2e-infra.sh:85` builds the SDK E2E peer image using `docker/Dockerfile.oyster`:

```bash
docker build -f "$REPO_ROOT/docker/Dockerfile.oyster" -t toon:optimized "$REPO_ROOT"
```

But `Dockerfile.oyster`'s own header self-documents its purpose:

> "TOON Oyster CVM Container ... This image is consumed by the Oyster CVM tooling ... Inside the Oyster CVM, supervisord manages two processes: toon ... + attestation (priority=20): TEE attestation HTTP server."

It installs `supervisor`, copies `supervisord.conf`, bundles the attestation-server alongside `entrypoint-sdk.js`, and exposes port 1300 for TEE attestation. None of this is needed for a local Docker peer running outside an enclave.

The `pnpm run build` step in the builder stage (line 65) runs `cd docker && pnpm run build` — which invokes `docker/esbuild.config.mjs` to produce both `dist/entrypoint-sdk.js` **and** `dist/attestation-server.js`. When the attestation-server bundle step fails (for any reason — e.g., an upstream dependency breaking change), **the entire SDK E2E infra build fails**, even though SDK E2E never exercises the attestation server.

Observed failure (recent `./scripts/sdk-e2e-infra.sh up` attempts):

```
ERROR: failed to build: process "/bin/sh -c pnpm -r --filter '!@toon-protocol/client' build && cd docker && pnpm run build" did not complete successfully: exit code: 1
```

This is blocking Story 12.10 (`12-10-e2e-swap-flow-docker-multichain.md`), which requires the SDK E2E infra to be usable end-to-end.

**The fix is structural, not semantic**: split the Dockerfile. Oyster stays as the TEE production image; SDK E2E gets its own minimal Dockerfile that produces a `toon:sdk-e2e` tag used by the existing compose file.

## Dependencies

- **Upstream (reuse / reference, do NOT modify):**
  - `docker/Dockerfile.oyster` — reference for base node version, pnpm version, which workspace packages are needed, which native/dynamic modules are required (better-sqlite3, ethers, express, @ardrive/turbo-sdk), and runtime layout. **Stays as-is** — it is the TEE production image.
  - `docker/src/entrypoint-sdk.ts` — the peer runtime entrypoint the SDK E2E peer actually invokes (`command: ['node', '/app/entrypoint-sdk.js']` in compose). No source-code changes.
  - `docker/esbuild.config.mjs` — the bundler config. Produces both `dist/entrypoint-sdk.js` and `dist/attestation-server.js` from two `entryPoints`. For SDK E2E we only need `entrypoint-sdk.js`. **Out of scope to refactor** — keep as-is; run a different bundle command in the new Dockerfile (see Task 1.4).
  - `docker/supervisord.conf` — NOT copied by the new Dockerfile. Only used by the Oyster image.
  - `docker-compose-sdk-e2e.yml` — defines peer1 (line 161) and peer2 (line 256) with `image: toon:optimized`, `command: ['node', '/app/entrypoint-sdk.js']`, and ports 3000 (BTP), 3100 (BLS), 7100 (relay WS). Port mappings, env vars, healthcheck, and all other service config stay identical; only the `image:` tag changes.
  - `scripts/sdk-e2e-infra.sh` — line 85 builds the peer image. Update `-f` and `-t` args only; do not alter healthcheck polling, pubkey derivation, or any other logic.
  - `packages/sdk/tests/e2e/docker-*.test.ts` (9 test files) — consumers of the running infra. They read from `docker-e2e-setup.ts` helper (port URLs, token addresses). No changes required if the image produces the same runtime surface (same ports, same `/health` endpoint).

- **Upstream (documentation anchors — MUST read once before coding):**
  - `_bmad-output/epics/epic-12-token-swap-primitive.md` — Epic 12 scope; clarifies this story is infra-correctness (not a new protocol primitive).
  - `_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md` — the blocked story this unblocks. Notes the `toon:optimized` image as "the peer runtime" and explicitly instructs later work NOT to alter the Dockerfile without justification. This story IS that justification; downstream 12.10 benefits.
  - `docker/Dockerfile.oyster` header lines 1–25 — self-documents why Oyster needs supervisord + attestation.
  - `CLAUDE.md` "Quick Reference" section — documents `docker build -f docker/Dockerfile.oyster -t toon:oyster .` for the Oyster image. After this story, a new line should document the SDK E2E image build (automatic via the script; optional manual build command).

- **Downstream:**
  - **Story 12.10** — unblocked once `./scripts/sdk-e2e-infra.sh up` succeeds. 12.10 boots the Mill E2E suite against this infra.
  - **Story 12.12** (Mill in peer entrypoint) — future story that adds Mill handler wiring to `entrypoint-sdk.ts`; will ship via this same `toon:sdk-e2e` image.
  - **Story 12.13** (StreamSwapClient in SDK) — SDK surface changes; rebuilds consume the same image.

- **Transitive (DO NOT do in this story):**
  - **Do NOT modify `docker/Dockerfile.oyster`** — it remains the production TEE image. No header changes, no flag changes, no refactoring to share layers with the new Dockerfile. Duplication of a few `COPY` lines is acceptable; cross-cutting Dockerfile refactors are out of scope.
  - **Do NOT modify `docker/src/entrypoint-sdk.ts`** — the runtime source is correct; only the image build is wrong.
  - **Do NOT modify `docker/src/attestation-server.ts`** or `docker/esbuild.config.mjs` — the attestation bundle stays with Oyster.
  - **Do NOT alter peer service definitions in `docker-compose-sdk-e2e.yml` beyond the `image:` field.** Do not touch ports, env vars, container_name, command, healthcheck, depends_on, volumes, or networks. This is a one-line-per-service compose edit.
  - **Do NOT change `Dockerfile.agent-runtime-patched`, `Dockerfile.nix`, or `Dockerfile.backup`** — not in scope.
  - **Do NOT rename or relocate `scripts/sdk-e2e-infra.sh`** — only the `docker build` line inside it changes.
  - **Do NOT re-tag the Oyster image** — `toon:oyster` stays `toon:oyster`; only the SDK E2E image gets a new tag (`toon:sdk-e2e`).
  - **Do NOT rebuild or re-run Epic 12 story 12.10's test suite as part of this story.** 12.10 is a separate story; 12.11's scope ends when the infra comes up clean and the SDK E2E test suite maintains parity with its prior pass/fail state.

## Epic Context

**Epic 12: Token Swap Primitive — NIP-59 Gift-Wrapped ILP Micropayment Swaps.** Stories 12.1–12.9 are done; Story 12.10 (real-infra E2E) is blocked pending 12.11 (this), 12.12 (Mill in peer entrypoint), and 12.13 (StreamSwapClient in SDK). This story is the smallest possible unblock: it does not touch protocol code, SDK surface, Mill handler code, or any package source. It only corrects the image-build choice.

Relevant Epic 12 decisions:

- Not directly — this is an infrastructure-hygiene story. No D12-XXX decisions apply.
- Indirectly supports D12-001 through D12-011 by making the test infrastructure they are validated against actually buildable.

## Acceptance Criteria

**New Dockerfile (minimal, SDK E2E only)**

1. A new file `docker/Dockerfile.sdk-e2e` exists with a self-documenting header explaining: (a) this is the local SDK E2E peer image (not a production TEE image), (b) it is consumed by `scripts/sdk-e2e-infra.sh` and `docker-compose-sdk-e2e.yml`, (c) it intentionally OMITS supervisord and the attestation-server bundle, and (d) for the TEE production image, see `docker/Dockerfile.oyster`. Example build command is included in the header: `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .`
2. The new Dockerfile uses the **same base image** (`node:20-alpine`) and the **same pinned pnpm version** (`8.15.0`) as `Dockerfile.oyster`. This is verified by reading the first 40 lines of `Dockerfile.oyster` and mirroring the base + pnpm setup. Deviation from those two versions is NOT allowed in this story.
3. The Dockerfile is multi-stage (Stage 1: builder, Stage 2: runtime) mirroring the Oyster structure — but the builder stage SKIPS the `cd docker && pnpm run build` step (the attestation-server + entrypoint bundle). Instead, the builder stage runs ONLY `pnpm -r --filter '!@toon-protocol/client' build` (the workspace TS builds) and then invokes `esbuild` to produce **only** `docker/dist/entrypoint-sdk.js` (not `attestation-server.js`). Two acceptable implementations:
   - (a) call esbuild directly with just `src/entrypoint-sdk.ts` as the single entry point, OR
   - (b) run the existing `pnpm run build` and then **delete** `docker/dist/attestation-server.js` before assembly.
   Either approach is acceptable; document the choice in the Dockerfile as a comment.
4. The Dockerfile does NOT install `supervisor` (Alpine package), does NOT `COPY docker/supervisord.conf`, and does NOT expose port 1300 (attestation). Exposed ports are exactly: `3000` (BTP), `3100` (BLS), `7100` (relay WS). `HEALTHCHECK` targets `http://localhost:${BLS_PORT}/health` (BLS port 3100) identically to Oyster's healthcheck (HEALTHCHECK directive on line 142, `CMD wget` continuation on line 143 of `Dockerfile.oyster`).
5. Runtime ENTRYPOINT/CMD is `node /app/entrypoint-sdk.js` (or equivalent `CMD ["node", "/app/entrypoint-sdk.js"]`) — NOT `supervisord`. This matches the `command:` field in `docker-compose-sdk-e2e.yml` for peer1 (line 163) and peer2 (line 258).
6. Runtime node_modules layout mirrors Oyster's cherry-picked set: `better-sqlite3` (native module, native `.node` binary copied from pnpm store), `bindings`, `file-uri-to-path`, and a flat install of `ethers@6 express@4 @ardrive/turbo-sdk` in `/runtime/node_modules/`. The runtime `package.json` contains `{"type":"module"}`. These are non-negotiable — the embedded ConnectorNode fails to start without them (verified by reading `docker/Dockerfile.oyster` lines 78–100).
7. Non-root user setup mirrors Oyster: `toon` uid/gid 1001 owns `/app` and `/data`. No `supervisord` means the runtime CMD can run as the `toon` user directly (no root bootstrap needed). Verify with `USER toon` before `CMD`.

**Infrastructure script update**

8. `scripts/sdk-e2e-infra.sh:85` is updated to:
   ```bash
   docker build -f "$REPO_ROOT/docker/Dockerfile.sdk-e2e" -t toon:sdk-e2e "$REPO_ROOT"
   ```
   The accompanying `log_info` message on line 84 is updated to reflect the new tag (e.g., `"Building toon:sdk-e2e image..."`). No other changes to `sdk-e2e-infra.sh`.

**Compose file update**

9. `docker-compose-sdk-e2e.yml` peer1 (line 161) and peer2 (line 256) have `image: toon:optimized` changed to `image: toon:sdk-e2e`. No other fields in either service are modified (ports, env vars, command, container_name, healthcheck, depends_on, networks, volumes all stay identical).

**Oyster non-regression**

10. `docker build -f docker/Dockerfile.oyster -t toon:oyster .` behavior is unchanged by this story. To prove this, the Oyster build MUST be executed TWICE:
    - (a) **Baseline (BEFORE any file changes in this story):** run `docker build -f docker/Dockerfile.oyster -t toon:oyster-baseline .` from a clean git state (no uncommitted changes from this story). Record exit code, the final stderr line on failure, and elapsed time in Dev Notes. This is the pre-existing Oyster build state.
    - (b) **Post-change (AFTER all file changes in this story are complete):** run `docker build -f docker/Dockerfile.oyster -t toon:oyster .`. Record exit code and final stderr line.
    - (c) **Gate:** post-change behavior must match baseline behavior exactly — either both succeed, OR both fail at the same build step with the same error class (e.g., both fail in the `cd docker && pnpm run build` attestation-server bundle step). A NEW failure mode in (b) that was not present in (a) is a hard-fail for this story. If the baseline (a) fails, this story does NOT attempt to fix the underlying Oyster defect; flag it for a separate follow-up story and record in Dev Notes.

**End-to-end infra verification**

11. Running `./scripts/sdk-e2e-infra.sh up` from a clean state:
    - Successfully builds `toon:sdk-e2e` (no errors, no attestation-server bundle attempt).
    - Starts Anvil, Solana test validator, Mina lightnet, peer1, peer2.
    - Passes all healthchecks within the script's wait windows.
    - `curl http://localhost:19100/health` returns HTTP 200 (Peer1 BLS).
    - `curl http://localhost:19110/health` returns HTTP 200 (Peer2 BLS).
    - `curl http://localhost:18545` returns a JSON-RPC error object (Anvil healthy — per CLAUDE.md troubleshooting section).
    - `curl http://localhost:19899/health` returns HTTP 200 (Solana validator healthy).
    - GraphQL query to `http://localhost:19085/graphql` returns a valid response (Mina lightnet healthy).
12. `./scripts/sdk-e2e-infra.sh down` cleanly stops and removes all containers.

**SDK E2E regression check**

13. With infra up, `cd packages/sdk && pnpm test:e2e:docker` runs and maintains parity with pre-story behavior. "Parity" means: the same tests pass, the same tests fail (if any), and no NEW failures are introduced by the image change. Baseline selection rule (in priority order):
    - (i) **Preferred — current-commit baseline:** If `docker build -f docker/Dockerfile.oyster -t toon:optimized .` succeeds at the pre-story HEAD, capture full `pnpm test:e2e:docker` pass/fail/skip counts per test file against that image. This is the parity baseline.
    - (ii) **Fallback — last-green baseline:** If (i) fails to build, locate the most recent commit on `main` or `epic-12` where the Oyster-built `toon:optimized` image DID build, capture pass/fail/skip counts there, and record the commit SHA in Dev Notes. Post-story `toon:sdk-e2e` results must match that baseline.
    - (iii) **Last resort — no baseline:** If neither (i) nor (ii) is reachable, AC-13 degrades to: the full SDK E2E suite must either pass or fail with a non-image-related root cause documented per failing test file (e.g., "Mina lightnet sync timeout — pre-existing flaky infra, not image-caused"). Blanket "baseline unavailable" is NOT acceptable without this per-test-file analysis.
    - The chosen baseline path (i/ii/iii) MUST be recorded in Dev Notes along with the concrete pass/fail/skip counts.

**Documentation**

14. `CLAUDE.md` is updated in the "Where to Find Things" table (or an analogous section) to reference `docker/Dockerfile.sdk-e2e` alongside the existing Oyster entry, OR the "Quick Reference" section gains a one-line mention of the SDK E2E Dockerfile. (A single new table row or a single new comment line is sufficient — do not expand CLAUDE.md with a full section.)

## Tasks / Subtasks

- [ ] **Task 0 (MUST run FIRST, before Task 1): Capture pre-change baselines** (AC: #10 baseline, #13-i/ii)
  - [ ] 0.1 Confirm `git status` is clean (no uncommitted changes from this story yet). If dirty, stash or create a scratch branch.
  - [ ] 0.2 Oyster baseline: run `docker build -f docker/Dockerfile.oyster -t toon:oyster-baseline .` from repo root. Record in Dev Notes: exit code, final stderr line on failure, elapsed time, and the exact build step that failed (if any). This is the AC-10(a) pre-change artifact.
  - [ ] 0.3 SDK E2E baseline: attempt `./scripts/sdk-e2e-infra.sh up` against the pre-change infra. If it comes up, run `cd packages/sdk && pnpm test:e2e:docker` and record per-test-file pass/fail/skip counts (AC-13-i baseline). Tear down with `./scripts/sdk-e2e-infra.sh down-v`.
  - [ ] 0.4 If 0.3 cannot produce a baseline (image build fails), identify a last-green commit per AC-13-ii and record its SHA in Dev Notes, or declare AC-13-iii path with a plan for per-test-file root-cause analysis post-change.
  - [ ] 0.5 DO NOT modify any files in this story until Task 0 is complete and documented.

- [ ] **Task 1: Author `docker/Dockerfile.sdk-e2e`** (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] 1.1 Copy `docker/Dockerfile.oyster` to a scratch location and use it as a structural reference — do NOT use it as the starting file in-place.
  - [ ] 1.2 Write a new file `docker/Dockerfile.sdk-e2e` from scratch. Start with the self-documenting header (AC-1). State the build command, the consumer (sdk-e2e-infra.sh), and the explicit divergence from Oyster (no supervisord, no attestation).
  - [ ] 1.3 Builder stage: mirror Oyster's pnpm setup (AC-2), workspace manifest COPY layout (lines 40–48 of Oyster), `pnpm install --frozen-lockfile`, source COPYs (lines 54–61), but replace the combined build step with `pnpm -r --filter '!@toon-protocol/client' build` only. Implement AC-3 option (a) or (b); add a `#` comment explaining the choice.
  - [ ] 1.4 Runtime assembly: mirror Oyster's `/runtime` layout (AC-6) — copy only `entrypoint-sdk.js`, `{"type":"module"}` package.json, better-sqlite3 + bindings + file-uri-to-path from pnpm store, and flat `npm install --omit=dev ethers@6 express@4 @ardrive/turbo-sdk` into `/runtime/node_modules/`. Do NOT copy `attestation-server.js`.
  - [ ] 1.5 Runtime stage: `FROM node:20-alpine`, install `libstdc++` only (NO `supervisor` — AC-4). Create `toon` user/group (AC-7). `COPY --from=builder --chown=toon:toon /runtime ./`. Set ENV (NODE_ENV, BLS_PORT=3100, WS_PORT=7100). `EXPOSE 3000 3100 7100` (no 1300). `HEALTHCHECK` identical to Oyster's HEALTHCHECK directive on line 142 (with `CMD wget` continuation on line 143). `USER toon`. `CMD ["node", "/app/entrypoint-sdk.js"]`.
  - [ ] 1.6 Smoke-build locally: `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .` — confirm it succeeds end-to-end.

- [ ] **Task 2: Update `scripts/sdk-e2e-infra.sh`** (AC: #8)
  - [ ] 2.1 Edit line 85 to build from `docker/Dockerfile.sdk-e2e` and tag as `toon:sdk-e2e`.
  - [ ] 2.2 Update the adjacent `log_info` (line 84) to "Building toon:sdk-e2e image...".
  - [ ] 2.3 No other lines in the script change.

- [ ] **Task 3: Update `docker-compose-sdk-e2e.yml`** (AC: #9)
  - [ ] 3.1 Change peer1's `image: toon:optimized` (line 161) to `image: toon:sdk-e2e`.
  - [ ] 3.2 Change peer2's `image: toon:optimized` (line 256) to `image: toon:sdk-e2e`.
  - [ ] 3.3 Diff the file before committing — confirm ONLY those two lines changed, and confirm the new tag value matches the tag emitted by `scripts/sdk-e2e-infra.sh` exactly (`toon:sdk-e2e`).

- [ ] **Task 4: Oyster post-change non-regression check** (AC: #10 post-change)
  - [ ] 4.1 After Tasks 1–3 complete, run `docker build -f docker/Dockerfile.oyster -t toon:oyster .` from repo root.
  - [ ] 4.2 Compare the result against the Task 0.2 Oyster baseline. Record in Dev Notes: exit code, final stderr line on failure, elapsed time, and the exact build step that failed (if any).
  - [ ] 4.3 Gate: result MUST match baseline. Both-succeed or both-fail-at-same-step-with-same-error are the only acceptable outcomes.
  - [ ] 4.4 If post-change Oyster behavior deviates from baseline (new failure mode, or previously-passing build now fails): STOP; this story's changes have regressed Oyster. Revisit Task 1 (duplication-vs-shared-layer issue) before proceeding.

- [ ] **Task 5: End-to-end infra verification** (AC: #11, #12)
  - [ ] 5.1 `./scripts/sdk-e2e-infra.sh down-v` (clean slate, remove any stale volumes).
  - [ ] 5.2 `./scripts/sdk-e2e-infra.sh up` — wait for completion.
  - [ ] 5.3 Run all six curl/GraphQL probes in AC-11. Record each response in Dev Notes.
  - [ ] 5.4 `./scripts/sdk-e2e-infra.sh down` — confirm clean teardown.

- [ ] **Task 6: SDK E2E regression check** (AC: #13)
  - [ ] 6.1 Baseline was captured in Task 0.3/0.4 (AC-13-i, ii, or iii). Confirm the chosen baseline path and its artifacts are recorded in Dev Notes before proceeding.
  - [ ] 6.2 With `./scripts/sdk-e2e-infra.sh up` running, run `cd packages/sdk && pnpm test:e2e:docker` and capture per-test-file pass/fail/skip counts.
  - [ ] 6.3 Compare post-change counts to the Task 0 baseline (or, for path iii, produce per-failing-test-file root-cause analysis).
  - [ ] 6.4 Gate: zero NEW failures introduced. If a NEW failure appears, diagnose: (a) image-related → fix in this story; (b) infra-flaky (e.g., Mina sync timeout) → retry 3×, document; (c) unrelated defect → block this story and file a follow-up.

- [ ] **Task 7: Update `CLAUDE.md`** (AC: #14)
  - [ ] 7.1 Add a single row to the "Where to Find Things" table referencing `docker/Dockerfile.sdk-e2e` as the "SDK E2E peer Dockerfile", OR add a one-line comment in the Quick Reference block. Pick the less-invasive option.
  - [ ] 7.2 Do not reorganize or expand other CLAUDE.md sections.

- [ ] **Task 8: Final diff review and commit**
  - [ ] 8.1 `git status` and `git diff` — confirm changed files are exactly: `docker/Dockerfile.sdk-e2e` (new), `scripts/sdk-e2e-infra.sh`, `docker-compose-sdk-e2e.yml`, `CLAUDE.md`. Nothing else.
  - [ ] 8.2 No changes to `Dockerfile.oyster`, `Dockerfile.agent-runtime-patched`, `Dockerfile.nix`, `Dockerfile.backup`, any `packages/**` source, any test file, or `docker/src/**`.
  - [ ] 8.3 Commit per project conventions (fix scope: `fix(12.11): split SDK E2E Dockerfile from Oyster TEE image`).

## Dev Notes

### Why a separate Dockerfile instead of refactoring Oyster?

Two reasons:

1. **Blast radius.** `Dockerfile.oyster` is the enclave production image. It is consumed by `oyster-cvm build --docker-compose docker/docker-compose-oyster.yml`. Any refactor risks breaking the TEE attestation flow, which is independently validated (Epic 8/9 retros reference Oyster deployment). Two files, two test paths, zero coupling.
2. **Concern separation.** SDK E2E peers run outside an enclave and do not need attestation. Merging the two use cases behind a build arg (`--build-arg TEE=true`) would save ~100 lines of Dockerfile but add a hidden-mode failure surface (e.g., "works locally, fails in Oyster" or vice versa). Duplication of ~50 lines of Dockerfile is the cheaper engineering choice.

### Why rename `toon:optimized` to `toon:sdk-e2e`?

`toon:optimized` is an opaque tag — it did not communicate which Dockerfile produced it, which environment consumed it, or how it related to `toon:oyster`. The new name `toon:sdk-e2e` is **self-describing**: you can tell by reading the compose file that this image is for the SDK E2E infra and nothing else. The tag rename also makes it obvious in `docker images` output which image is which.

### Relevant architecture patterns

- **Multi-stage Docker build for small images**: Oyster's builder + runtime pattern is correct; reuse it.
- **Native module cherry-picking**: better-sqlite3 must be copied with its build directory intact. The pnpm store layout (`node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3`) is version-agnostic via globs — preserve Oyster's approach (lines 80–89).
- **Dynamic `require()` support via banner**: `entrypoint-sdk.js` is an ESM bundle that calls `require()` dynamically for ethers/express (connector's `requireOptional`). The `createRequire` banner in `esbuild.config.mjs` (line 39) handles this. Don't remove it.

### Source tree components to touch

- **NEW**: `docker/Dockerfile.sdk-e2e`
- **MODIFY (single line)**: `scripts/sdk-e2e-infra.sh` (line 85, optionally line 84 log message)
- **MODIFY (two lines)**: `docker-compose-sdk-e2e.yml` (peer1 image line, peer2 image line)
- **MODIFY (one-row addition)**: `CLAUDE.md` (Where to Find Things table or Quick Reference block)

### Testing standards summary

This is a Dockerfile/infra story — there are no unit tests to write. Validation is entirely runtime and depends on Task 0 baselines:

1. **Pre-change baselines (Task 0)**: Oyster build result + SDK E2E test-counts captured from pre-story HEAD (or documented as unreachable per AC-13-ii/iii).
2. **Build success**: `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .` exits 0.
3. **Oyster non-regression (Task 4)**: post-change `docker build -f docker/Dockerfile.oyster -t toon:oyster .` matches Task 0.2 baseline outcome exactly.
4. **Infra smoke**: `./scripts/sdk-e2e-infra.sh up` + six healthcheck probes (AC-11).
5. **Regression suite (Task 6)**: post-change `pnpm test:e2e:docker` counts match Task 0.3 baseline (or per-test-file root-cause analysis per AC-13-iii).

No new automated tests are added by this story. Validation is manual + scripted via existing infra scripts.

### Standard Guards (Epic 11 Retro)

- **CI workflow SHAs:** N/A — this story does not create or modify GitHub Actions workflows.
- **MAX_SAFE_INTEGER guard:** N/A — no u64↔JS number bridges introduced.
- **Golden test vectors (ZK story pairs):** N/A — not a ZK circuit story.

### Project Structure Notes

**Alignment:**
- `docker/Dockerfile.*` naming convention already established (`Dockerfile.oyster`, `Dockerfile.nix`, `Dockerfile.agent-runtime-patched`, `Dockerfile.backup`). `Dockerfile.sdk-e2e` fits this convention.
- Image tag convention: `toon:<role>` — existing tags include `toon:oyster`. `toon:sdk-e2e` fits the pattern. `toon:optimized` did not fit the pattern and is being removed by this story.
- Per `CLAUDE.md` directive, all coding rules and patterns live in `_bmad-output/project-context.md`. This story does not introduce new patterns; it only aligns one file with the existing "separation of concerns" pattern already used by `Dockerfile.nix` vs `Dockerfile.oyster`.

**No detected conflicts.**

### References

- Offending line: `scripts/sdk-e2e-infra.sh:85`
- Oyster image header (self-documents TEE purpose): `docker/Dockerfile.oyster:1-25`
- Failing build step: `docker/esbuild.config.mjs` (bundles both entrypoint-sdk and attestation-server)
- Peer runtime entrypoint (what SDK E2E actually needs): `docker/src/entrypoint-sdk.ts`
- Supervisord config (Oyster only, NOT needed by SDK E2E): `docker/supervisord.conf`
- Peer service definitions: `docker-compose-sdk-e2e.yml` peer1 lines 160–203 (approximate), peer2 lines 255–300 (approximate)
- Consumers of infra: `packages/sdk/tests/e2e/docker-*.test.ts` (9 files)
- Existing sibling Dockerfiles (for pattern reference): `docker/Dockerfile.agent-runtime-patched`, `docker/Dockerfile.nix`, `docker/Dockerfile.backup`
- Blocked downstream: `_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md`
- Epic: `_bmad-output/epics/epic-12-token-swap-primitive.md`
- CLAUDE.md references: lines 30, 31, 42, 69, 85, 88, 108

## Dev Agent Record

### Agent Model Used

claude-opus-4-6[1m]

### Debug Log References

(to be populated during implementation)

### Completion Notes List

- Ultimate context engine analysis completed — comprehensive developer guide created.
- Story type: `fix`. Predecessor for Story 12.10. Unblocks real-infra E2E swap testing.
- Non-negotiable scope boundaries: no changes to Oyster Dockerfile, entrypoint-sdk source, esbuild config, attestation-server, or any package source.

### File List

(to be populated during implementation — expected: `docker/Dockerfile.sdk-e2e` [new], `scripts/sdk-e2e-infra.sh`, `docker-compose-sdk-e2e.yml`, `CLAUDE.md`)

## Handoff

STORY_FILE: /Users/jonathangreen/Documents/TOON-Protocol/_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md
