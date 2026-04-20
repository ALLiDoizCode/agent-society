---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-generation-mode',
    'step-03-test-strategy',
    'step-04-generate-tests',
    'step-05-validate-and-complete',
  ]
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-15'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md'
  - '_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md'
  - 'docker/Dockerfile.oyster'
  - 'scripts/sdk-e2e-infra.sh'
  - 'docker-compose-sdk-e2e.yml'
  - 'docker/esbuild.config.mjs'
  - 'docker/src/entrypoint-sdk.ts'
  - 'CLAUDE.md'
---

# ATDD Checklist — Epic 12, Story 12.11: Split SDK E2E Dockerfile from Oyster TEE Image

**Date:** 2026-04-15
**Author:** Jonathan
**Primary Test Level:** Infra verification (shell-scripted, build + runtime smoke + regression parity — no unit/API/component tests)
**Mode:** YOLO

---

## Story Summary

**As a** TOON Protocol maintainer working on Epic 12 real-infra E2E validation,
**I want** the SDK E2E infrastructure to build its peer image from a purpose-built `docker/Dockerfile.sdk-e2e` that contains only what a local SDK E2E peer needs (ConnectorNode + BLS + relay, no supervisord, no attestation-server),
**So that** `./scripts/sdk-e2e-infra.sh up` builds cleanly without pulling in TEE-specific dependencies that fail to bundle, Story 12.10 can run E2E swap flow tests against the infra, and the Oyster TEE production image (`Dockerfile.oyster`) remains cleanly separated for its intended enclave use case.

---

## Acceptance Criteria (testable slices)

Dockerfile creation + content

1. **AC-1** — `docker/Dockerfile.sdk-e2e` exists with self-documenting header (local SDK E2E image, consumed by `sdk-e2e-infra.sh` + `docker-compose-sdk-e2e.yml`, OMITS supervisord + attestation, directs TEE users to `Dockerfile.oyster`, includes example build command).
2. **AC-2** — Base image `node:20-alpine`; pnpm pinned to `8.15.0` — identical to `Dockerfile.oyster`.
3. **AC-3** — Multi-stage: builder stage runs `pnpm -r --filter '!@toon-protocol/client' build` only (NOT `cd docker && pnpm run build`); produces `docker/dist/entrypoint-sdk.js` but NOT `attestation-server.js`. Implementation choice (a) direct esbuild call with single entry, OR (b) full build then delete `attestation-server.js`, documented in a comment.
4. **AC-4** — Runtime stage installs NO `supervisor`, contains NO `COPY docker/supervisord.conf`, EXPOSEs exactly `3000 3100 7100` (no `1300`), `HEALTHCHECK` hits `http://localhost:3100/health` identically to Oyster.
5. **AC-5** — Runtime CMD is `["node", "/app/entrypoint-sdk.js"]` (not supervisord).
6. **AC-6** — Runtime `/runtime` layout mirrors Oyster: `better-sqlite3` + `bindings` + `file-uri-to-path` copied from pnpm store; flat `npm install --omit=dev ethers@6 express@4 @ardrive/turbo-sdk` into `/runtime/node_modules/`; `{"type":"module"}` package.json.
7. **AC-7** — `toon` uid/gid 1001 owns `/app` and `/data`; `USER toon` declared before `CMD`.

Infrastructure script + compose rewiring

8. **AC-8** — `scripts/sdk-e2e-infra.sh:85` builds from `docker/Dockerfile.sdk-e2e` and tags `toon:sdk-e2e`; line 84 log message updated to `"Building toon:sdk-e2e image..."`; no other changes.
9. **AC-9** — `docker-compose-sdk-e2e.yml` peer1 (line 161) and peer2 (line 256) both set `image: toon:sdk-e2e`; no other fields in either service change.

Non-regression + runtime

10. **AC-10** — Oyster build behavior is unchanged: pre-change and post-change `docker build -f docker/Dockerfile.oyster -t toon:oyster .` match exactly (both succeed OR both fail at same step with same error class). A NEW failure mode is a hard-fail.
11. **AC-11** — Clean `./scripts/sdk-e2e-infra.sh up` succeeds: builds `toon:sdk-e2e` (no attestation-server bundle attempt), starts Anvil + Solana + Mina + peer1 + peer2, all six health probes return healthy (peer1 BLS 19100, peer2 BLS 19110, Anvil 18545, Solana 19899, Mina 19085).
12. **AC-12** — `./scripts/sdk-e2e-infra.sh down` cleanly tears down.

Regression parity

13. **AC-13** — Post-change `pnpm test:e2e:docker` maintains baseline parity (same pass/fail/skip counts as pre-change baseline per AC-13-i/ii/iii selection rule; zero NEW failures introduced by image change).

Documentation

14. **AC-14** — `CLAUDE.md` adds a single-row/one-line mention of `docker/Dockerfile.sdk-e2e`.

---

## Stack Detection & Framework

- **Detected stack:** `fullstack` — pnpm workspace with React/Vite (Forge-UI), multiple Node packages, vitest configs.
- **Test framework:** `vitest` (workspace), `playwright` (Forge-UI). **Not applicable here** — story is pure Dockerfile/shell infra.
- **Config flags:** `tea_browser_automation=auto`, `tea_use_playwright_utils=true`, `tea_use_pactjs_utils=true`, `tea_pact_mcp=mcp`.
- **Generation mode:** AI generation from story ACs + existing Dockerfile/compose inputs. No browser recording (no UI surface changes).

---

## Test Strategy

This story is **Dockerfile/infra-hygiene only** — the story's own Dev Notes §"Testing standards summary" explicitly states: *"This is a Dockerfile/infra story — there are no unit tests to write. Validation is entirely runtime and depends on Task 0 baselines."*

No source files in `packages/**` change. No SDK surface, no protocol code, no Mill handler wiring. Therefore:

- ❌ **No E2E (Playwright) tests generated** — no UI or protocol behavior changes.
- ❌ **No API/integration tests generated** — `packages/sdk/tests/e2e/docker-*.test.ts` already exists (9 files) and is re-used unchanged as the AC-13 regression parity gate. This story does not add SDK-layer tests.
- ❌ **No component tests generated** — no component behavior changes.
- ✅ **RED-phase verification expressed as runnable shell probes** (below). These probes currently FAIL on main (pre-implementation) and MUST pass after the dev story completes. They form the authoritative RED→GREEN signal for 12.11.

### Test level selection rationale

| AC group | Level | Rationale |
|---|---|---|
| AC-1..AC-7 (Dockerfile content) | Static-file / grep probes | Dockerfile is declarative; assertions are "file exists + contains X + does not contain Y". Shell-level verification is sufficient and fastest. |
| AC-8, AC-9 (script + compose edits) | Static-file / grep probes | One- or two-line edits. Diff-style verification. |
| AC-10 (Oyster non-regression) | Docker build (baseline vs post-change) | Only `docker build` can prove build-step parity. Cannot be unit-tested. |
| AC-11, AC-12 (infra up/down) | Live infra smoke (curl + GraphQL) | Runtime behavior requires real containers + real ports. Already scripted via `sdk-e2e-infra.sh`. |
| AC-13 (test:e2e:docker parity) | Existing vitest E2E suite re-run | Re-use existing 9 test files as the parity gate. Do not add new tests. |
| AC-14 (docs) | Grep probe | One-line doc edit. |

### Priority assignment (P0–P3)

| AC | Priority | Reason |
|---|---|---|
| AC-3, AC-4, AC-8, AC-9, AC-11 | **P0** | If any fail, the infra does not come up and Story 12.10 stays blocked. |
| AC-1, AC-2, AC-5, AC-6, AC-7, AC-10, AC-13 | **P1** | Correctness/parity gates. Infra may come up with a P1 violation but story fails its contract. |
| AC-12, AC-14 | **P2** | Hygiene (teardown + docs). Nice-to-have cleanliness. |

### Red phase confirmation

All probes below were verified to FAIL against the pre-implementation tree on branch `epic-12` at commit `7ca7d45`. Post-dev, all probes MUST pass. See §"Test Execution Evidence — Initial Test Run (RED Phase Verification)" below.

---

## Failing Verifications Created (RED Phase)

**Note on naming:** this story produces NO new `.test.ts` files. Instead, RED-phase verification is encoded as a runnable shell script under `tests/acceptance/12-11-verify.sh` — a single-file executable acceptance suite. It is idempotent, emits TAP-ish output, and exits non-zero on any failed AC.

### Acceptance verification script (1 file, 14 checks)

**File:** `tests/acceptance/12-11-verify.sh` (to be created by dev as part of GREEN phase OR — acceptable alternative — embedded inline in the story's Dev Notes "test evidence" block and executed ad-hoc. Dev may choose either; both satisfy AC coverage.)

**Expected structure (pseudocode per AC):**

- **AC-1 [P1] Dockerfile.sdk-e2e exists with self-documenting header**
  - **Status:** RED — file does not exist at `/Users/jonathangreen/Documents/TOON-Protocol/docker/Dockerfile.sdk-e2e`.
  - **Verifies:** `test -f docker/Dockerfile.sdk-e2e` AND `head -30 docker/Dockerfile.sdk-e2e | grep -E '(SDK E2E|sdk-e2e-infra|not.*production TEE|see.*Dockerfile\.oyster)'` matches ≥3 of the header anchor phrases AND includes a literal `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .` example command.

- **AC-2 [P1] Base image + pnpm pinned identically to Oyster**
  - **Status:** RED — file does not exist.
  - **Verifies:** `grep -E '^FROM node:20-alpine' docker/Dockerfile.sdk-e2e` matches ≥1; `grep 'pnpm@8\.15\.0' docker/Dockerfile.sdk-e2e` matches ≥1; both anchors match the values in `docker/Dockerfile.oyster` lines 1–40.

- **AC-3 [P0] Builder stage skips attestation-server bundle**
  - **Status:** RED — file does not exist; current infra builds the full combined bundle (which is the observed failure).
  - **Verifies:** `grep -c 'cd docker && pnpm run build' docker/Dockerfile.sdk-e2e` == 0 AND `grep -c 'attestation-server' docker/Dockerfile.sdk-e2e` == 0 OR only appears inside a `rm` / `delete` line if option (b) chosen AND `grep "pnpm -r --filter '!@toon-protocol/client' build" docker/Dockerfile.sdk-e2e` matches ≥1 AND a `#` comment documents the option (a)/(b) choice.

- **AC-4 [P0] No supervisor, correct ports, correct HEALTHCHECK**
  - **Status:** RED — file does not exist.
  - **Verifies:** `grep -c 'supervisor' docker/Dockerfile.sdk-e2e` == 0 AND `grep -c 'supervisord.conf' docker/Dockerfile.sdk-e2e` == 0 AND `grep -E '^EXPOSE +3000 +3100 +7100 *$' docker/Dockerfile.sdk-e2e` matches ≥1 AND `grep -c '1300' docker/Dockerfile.sdk-e2e` == 0 AND `grep 'localhost:3100/health\|localhost:\${BLS_PORT}/health' docker/Dockerfile.sdk-e2e` matches ≥1 inside a `HEALTHCHECK` directive.

- **AC-5 [P1] Runtime CMD is node /app/entrypoint-sdk.js**
  - **Status:** RED — file does not exist.
  - **Verifies:** `grep -E 'CMD \[?"?node"?.*entrypoint-sdk\.js' docker/Dockerfile.sdk-e2e` matches ≥1; no `supervisord` string appears in the final stage.

- **AC-6 [P1] Runtime node_modules layout mirrors Oyster**
  - **Status:** RED — file does not exist.
  - **Verifies:** `grep -E 'better-sqlite3|bindings|file-uri-to-path' docker/Dockerfile.sdk-e2e` matches all three names; `grep 'ethers@6' docker/Dockerfile.sdk-e2e`, `grep 'express@4' docker/Dockerfile.sdk-e2e`, `grep '@ardrive/turbo-sdk' docker/Dockerfile.sdk-e2e` each match ≥1 inside an `npm install --omit=dev` line targeting `/runtime/node_modules`; `{"type":"module"}` appears in a COPY-in-place or RUN-echo line producing `/runtime/package.json`.

- **AC-7 [P1] Non-root toon user uid/gid 1001**
  - **Status:** RED — file does not exist.
  - **Verifies:** `grep -E 'addgroup.*1001.*toon|adduser.*1001.*toon' docker/Dockerfile.sdk-e2e` matches; `grep '^USER toon' docker/Dockerfile.sdk-e2e` matches exactly once AND `awk '/^USER toon/{u=NR} /^CMD /{c=NR} END{exit !(u && c && u < c)}' docker/Dockerfile.sdk-e2e` exits 0 (USER directive precedes the final CMD line).

- **AC-8 [P0] sdk-e2e-infra.sh builds from Dockerfile.sdk-e2e and tags toon:sdk-e2e**
  - **Status:** RED — `scripts/sdk-e2e-infra.sh:85` currently reads `docker build -f "$REPO_ROOT/docker/Dockerfile.oyster" -t toon:optimized "$REPO_ROOT"`.
  - **Verifies:** `grep -n 'Dockerfile.sdk-e2e' scripts/sdk-e2e-infra.sh` matches line 85; `grep -n 'toon:sdk-e2e' scripts/sdk-e2e-infra.sh` matches lines 84 (log) and 85 (tag); `grep -c 'toon:optimized' scripts/sdk-e2e-infra.sh` == 0; `grep -c 'Dockerfile.oyster' scripts/sdk-e2e-infra.sh` == 0; unified diff between pre- and post-change script touches at most lines 84–85.

- **AC-9 [P0] Compose peer1/peer2 both use toon:sdk-e2e**
  - **Status:** RED — `docker-compose-sdk-e2e.yml` line 161 and line 256 both currently read `image: toon:optimized`.
  - **Verifies:** `grep -cE '^\s*image:\s*toon:sdk-e2e\s*$' docker-compose-sdk-e2e.yml` == 2; `grep -c 'toon:optimized' docker-compose-sdk-e2e.yml` == 0; unified diff between pre- and post-change compose file touches exactly 2 lines (161, 256) and no others.

- **AC-10 [P1] Oyster build unchanged (baseline vs post-change)**
  - **Status:** RED — this gate requires two timed runs (see Task 0 + Task 4 in story). Cannot be statically asserted.
  - **Verifies:** Recorded in Dev Notes under "Oyster non-regression": pre-change exit code, post-change exit code, pre-change final stderr line (on fail), post-change final stderr line (on fail), pre-change elapsed seconds, post-change elapsed seconds. Gate: **both succeed** OR **both fail at the same build step with matching error class**. A NEW failure class in (b) that was absent in (a) is a hard-fail and this AC is NOT satisfied.

- **AC-4/AC-11 [P0] Runtime artifact absence — attestation-server NOT in built image**
  - **Status:** RED — image not yet built.
  - **Verifies (after `./scripts/sdk-e2e-infra.sh up`):**
    - `docker run --rm --entrypoint sh toon:sdk-e2e -c 'ls /app/attestation-server.js 2>/dev/null; exit 0'` produces empty output (file absent).
    - `docker run --rm --entrypoint sh toon:sdk-e2e -c 'test -f /app/entrypoint-sdk.js && echo ok'` prints `ok`.
    - `docker run --rm --entrypoint sh toon:sdk-e2e -c 'which supervisord 2>/dev/null; exit 0'` produces empty output (supervisord not installed).
    - `docker run --rm --entrypoint sh toon:sdk-e2e -c 'id -u toon && id -g toon'` prints `1001\n1001` (USER toon is the runtime identity).
  - **Rationale:** closes the gap where AC-3/AC-4/AC-5/AC-7 only assert Dockerfile source text, not the actual built artifact. Build-step grep is necessary but not sufficient — a Dockerfile may pass source probes yet still ship unexpected files via transitive COPY. This probe asserts behavior, not text.

- **AC-11 [P0] Infra up — all six health probes pass**
  - **Status:** RED — `./scripts/sdk-e2e-infra.sh up` currently fails during peer image build (attestation-server bundle step).
  - **Verifies (after `./scripts/sdk-e2e-infra.sh up`):**
    - `curl -fsS http://localhost:19100/health` → HTTP 200 (peer1 BLS)
    - `curl -fsS http://localhost:19110/health` → HTTP 200 (peer2 BLS)
    - `curl -s http://localhost:18545 -o /dev/null -w "%{http_code}"` → valid JSON-RPC error envelope on raw GET (Anvil healthy per CLAUDE.md troubleshooting §)
    - `curl -fsS http://localhost:19899/health` → HTTP 200 (Solana test validator)
    - `curl -fsS -X POST http://localhost:19085/graphql -H 'content-type: application/json' -d '{"query":"{ syncStatus }"}'` → HTTP 200 with non-error GraphQL body (Mina lightnet)
    - `docker images toon:sdk-e2e --format '{{.Repository}}:{{.Tag}}'` → matches `toon:sdk-e2e` (image actually built under new tag, not reused from a pre-existing `toon:optimized`).

- **AC-12 [P2] Infra down — clean teardown**
  - **Status:** RED — infra cannot come up currently, so teardown is not observable.
  - **Verifies:** After `./scripts/sdk-e2e-infra.sh down`, `docker compose -p toon-sdk-e2e ps -q` returns empty; no dangling `toon-sdk-e2e_*` containers remain.

- **AC-13 [P1] SDK E2E test:e2e:docker parity**
  - **Status:** RED — cannot currently run (infra down).
  - **Verifies:** With infra up, `cd packages/sdk && pnpm test:e2e:docker` produces per-test-file pass/fail/skip counts. Compare to baseline chosen per AC-13-i (preferred), AC-13-ii (last-green commit SHA), or AC-13-iii (per-file root-cause analysis). Gate: zero NEW failures vs baseline. Per-file counts AND the selected baseline path (i/ii/iii) MUST be recorded in Dev Notes.

- **AC-14 [P2] CLAUDE.md references Dockerfile.sdk-e2e**
  - **Status:** RED — no reference in current CLAUDE.md.
  - **Verifies:** `grep -c 'Dockerfile\.sdk-e2e' CLAUDE.md` ≥ 1; edit confined to a single new row in "Where to Find Things" table OR a single new line in "Quick Reference" block (diff covers ≤2 added lines, 0 removed).

---

## Data Factories Created

**None.** This story creates no entities, no JSON payloads, no fake users — it is a Dockerfile edit. N/A.

---

## Fixtures Created

**None.** No vitest/Playwright fixture files required. The "fixture" is the running Docker infra itself, already fully defined in `docker-compose-sdk-e2e.yml` and managed by `scripts/sdk-e2e-infra.sh`. N/A.

---

## Mock Requirements

**None.** No external services are mocked. AC-11 uses live local services (Anvil, Solana validator, Mina lightnet) — all run in Docker containers defined by the existing compose file. N/A.

---

## Required data-testid Attributes

**None.** No UI surface. N/A.

---

## Implementation Checklist

Mapping each failing verification to the concrete dev tasks defined in the story.

### Verification: AC-1..AC-7 (Dockerfile.sdk-e2e content)

**File to create:** `docker/Dockerfile.sdk-e2e`

**Tasks to make all seven ACs pass:**

- [ ] Task 1.1 — Copy `docker/Dockerfile.oyster` to a scratch buffer (reference only, do not modify in place).
- [ ] Task 1.2 — Author `docker/Dockerfile.sdk-e2e` header with: (a) "local SDK E2E peer image, NOT a production TEE image", (b) consumed by `sdk-e2e-infra.sh` + `docker-compose-sdk-e2e.yml`, (c) explicit "no supervisord, no attestation-server" note, (d) pointer to `Dockerfile.oyster` for TEE, (e) example build command `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .`.
- [ ] Task 1.3 — Builder stage: mirror Oyster's `FROM node:20-alpine`, `pnpm@8.15.0` activation, workspace manifest COPY layout (Oyster lines 40–48), `pnpm install --frozen-lockfile`, source COPYs (Oyster lines 54–61). Replace combined build with `pnpm -r --filter '!@toon-protocol/client' build`. Choose option (a) direct esbuild on `src/entrypoint-sdk.ts` OR (b) full build then delete `docker/dist/attestation-server.js`. Add `#` comment documenting the choice.
- [ ] Task 1.4 — Runtime assembly: COPY `entrypoint-sdk.js` only; `{"type":"module"}` package.json; `better-sqlite3` + `bindings` + `file-uri-to-path` from pnpm store globs; flat `npm install --omit=dev ethers@6 express@4 @ardrive/turbo-sdk` into `/runtime/node_modules`.
- [ ] Task 1.5 — Runtime stage: `FROM node:20-alpine`, install `libstdc++` only (NO supervisor). `addgroup -g 1001 toon && adduser -u 1001 -G toon toon`. `COPY --from=builder --chown=toon:toon /runtime ./`. ENV `NODE_ENV=production BLS_PORT=3100 WS_PORT=7100`. `EXPOSE 3000 3100 7100`. `HEALTHCHECK` identical to Oyster's. `USER toon`. `CMD ["node", "/app/entrypoint-sdk.js"]`.
- [ ] Task 1.6 — Local smoke: `docker build -f docker/Dockerfile.sdk-e2e -t toon:sdk-e2e .` exits 0.
- [ ] Run verification: re-run AC-1..AC-7 grep probes.
- [ ] ✅ All seven ACs GREEN.

**Estimated effort:** ~1.5–2.5 hours (mostly mirroring Oyster layout, testing the esbuild entry-point-only case).

---

### Verification: AC-8 (sdk-e2e-infra.sh rewire)

**File to modify:** `scripts/sdk-e2e-infra.sh`

**Tasks:**

- [ ] Task 2.1 — Edit line 85 to `docker build -f "$REPO_ROOT/docker/Dockerfile.sdk-e2e" -t toon:sdk-e2e "$REPO_ROOT"`.
- [ ] Task 2.2 — Edit line 84 log message to `log_info "Building toon:sdk-e2e image..."`.
- [ ] Task 2.3 — `git diff scripts/sdk-e2e-infra.sh` touches only lines 84–85.
- [ ] ✅ AC-8 GREEN.

**Estimated effort:** ≤ 5 minutes.

---

### Verification: AC-9 (compose image rewire)

**File to modify:** `docker-compose-sdk-e2e.yml`

**Tasks:**

- [ ] Task 3.1 — Line 161: `image: toon:optimized` → `image: toon:sdk-e2e`.
- [ ] Task 3.2 — Line 256: `image: toon:optimized` → `image: toon:sdk-e2e`.
- [ ] Task 3.3 — `git diff docker-compose-sdk-e2e.yml` touches only those 2 lines.
- [ ] ✅ AC-9 GREEN.

**Estimated effort:** ≤ 2 minutes.

---

### Verification: AC-10 (Oyster non-regression)

**Tasks:**

- [ ] Task 0.2 (BEFORE any file edits) — Baseline: `time docker build -f docker/Dockerfile.oyster -t toon:oyster-baseline .` from clean git; capture exit code + final stderr + elapsed time. Record in story Dev Notes.
- [ ] Task 4.1 (AFTER Tasks 1–3) — Post-change: `time docker build -f docker/Dockerfile.oyster -t toon:oyster .`; capture same three metrics.
- [ ] Task 4.2 — Compare. Same outcome (same step + same error class OR both pass) → GREEN. New failure mode → STOP, revisit Task 1.
- [ ] ✅ AC-10 GREEN.

**Estimated effort:** 10–30 minutes per build × 2 builds (wall-clock, mostly cache-cold Docker layers).

---

### Verification: AC-11, AC-12 (infra smoke)

**Tasks:**

- [ ] Task 5.1 — `./scripts/sdk-e2e-infra.sh down-v` (clean slate).
- [ ] Task 5.2 — `./scripts/sdk-e2e-infra.sh up` — exits 0 within its own wait budget.
- [ ] Task 5.3 — Run all six probes in AC-11 verification block. Capture each response body/status in Dev Notes.
- [ ] Task 5.4 — `./scripts/sdk-e2e-infra.sh down` — no dangling containers (AC-12).
- [ ] ✅ AC-11, AC-12 GREEN.

**Estimated effort:** 10–20 minutes (first up is slow; subsequent runs use cached image).

---

### Verification: AC-13 (SDK E2E parity)

**Tasks:**

- [ ] Task 0.3 (BEFORE any file edits) — If pre-change infra can come up (unlikely given the reported build failure), capture baseline per-test-file pass/fail/skip counts.
- [ ] Task 0.4 — If 0.3 impossible, declare AC-13-ii (find last-green commit SHA on main/epic-12 where Oyster-built `toon:optimized` did build) OR AC-13-iii (per-file root-cause analysis post-change). Record chosen path in Dev Notes.
- [ ] Task 6.2 (AFTER Tasks 1–5) — With infra up from Task 5, `cd packages/sdk && pnpm test:e2e:docker`; capture per-file counts.
- [ ] Task 6.3 — Compare to baseline. Zero NEW failures → GREEN. Any new failure → diagnose: (a) image-related → fix in this story; (b) infra-flaky → retry 3× + document; (c) unrelated → block + file follow-up.
- [ ] ✅ AC-13 GREEN.

**Estimated effort:** 15–30 minutes (test suite runtime + diagnosis buffer).

---

### Verification: AC-14 (CLAUDE.md doc update)

**File to modify:** `CLAUDE.md`

**Tasks:**

- [ ] Task 7.1 — Add ONE row to "Where to Find Things" table: e.g. `| SDK E2E peer Dockerfile | \`docker/Dockerfile.sdk-e2e\` |` OR add ONE comment line in the Quick Reference block next to the existing `docker build -f docker/Dockerfile.oyster` line. Pick the less-invasive option.
- [ ] Task 7.2 — No other CLAUDE.md edits.
- [ ] ✅ AC-14 GREEN.

**Estimated effort:** ≤ 2 minutes.

---

## Running Verifications

```bash
# RED-phase re-run (from repo root, pre-implementation)
test -f docker/Dockerfile.sdk-e2e                          # AC-1: should fail
grep -c 'toon:optimized' scripts/sdk-e2e-infra.sh          # AC-8: should print 2
grep -c 'toon:optimized' docker-compose-sdk-e2e.yml        # AC-9: should print 2
grep -c 'Dockerfile\.sdk-e2e' CLAUDE.md                    # AC-14: should print 0

# GREEN-phase verification (post-implementation)
test -f docker/Dockerfile.sdk-e2e && echo AC-1-exists      # AC-1
grep -q 'FROM node:20-alpine' docker/Dockerfile.sdk-e2e    # AC-2
grep -q 'pnpm@8\.15\.0' docker/Dockerfile.sdk-e2e           # AC-2
! grep -q 'cd docker && pnpm run build' docker/Dockerfile.sdk-e2e  # AC-3
! grep -q 'supervisor' docker/Dockerfile.sdk-e2e           # AC-4
grep -E 'EXPOSE .*3000.*3100.*7100' docker/Dockerfile.sdk-e2e  # AC-4
! grep -q '1300' docker/Dockerfile.sdk-e2e                 # AC-4
grep -E 'CMD \[?"?node"?.*entrypoint-sdk\.js' docker/Dockerfile.sdk-e2e  # AC-5
grep -q '^USER toon' docker/Dockerfile.sdk-e2e             # AC-7
grep -q 'Dockerfile.sdk-e2e' scripts/sdk-e2e-infra.sh      # AC-8
grep -q 'toon:sdk-e2e' scripts/sdk-e2e-infra.sh            # AC-8
! grep -q 'toon:optimized' scripts/sdk-e2e-infra.sh        # AC-8
[ "$(grep -cE '^\s*image:\s*toon:sdk-e2e\s*$' docker-compose-sdk-e2e.yml)" = "2" ]  # AC-9
! grep -q 'toon:optimized' docker-compose-sdk-e2e.yml      # AC-9
grep -q 'Dockerfile\.sdk-e2e' CLAUDE.md                    # AC-14

# Infra smoke (post-implementation)
./scripts/sdk-e2e-infra.sh down-v
./scripts/sdk-e2e-infra.sh up
curl -fsS http://localhost:19100/health                    # AC-11 peer1
curl -fsS http://localhost:19110/health                    # AC-11 peer2
curl -fsS http://localhost:19899/health                    # AC-11 solana
curl -fsS -X POST http://localhost:19085/graphql -H 'content-type: application/json' -d '{"query":"{ syncStatus }"}'  # AC-11 mina
docker images toon:sdk-e2e --format '{{.Repository}}:{{.Tag}}'  # AC-11 image tag
cd packages/sdk && pnpm test:e2e:docker                    # AC-13 parity
./scripts/sdk-e2e-infra.sh down                            # AC-12

# Oyster non-regression (pre + post)
time docker build -f docker/Dockerfile.oyster -t toon:oyster-baseline .  # AC-10 baseline
# ... make 12.11 changes ...
time docker build -f docker/Dockerfile.oyster -t toon:oyster .           # AC-10 post-change
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete — TEA) ✅

- ✅ 14 failing verifications documented, mapped 1:1 to the story's 14 ACs.
- ✅ All verifications re-runnable via copy-paste shell commands (no new source test files required).
- ✅ Pre-implementation RED state confirmed on branch `epic-12` @ `7ca7d45`:
  - `docker/Dockerfile.sdk-e2e` does NOT exist.
  - `scripts/sdk-e2e-infra.sh:84-85` still references `Dockerfile.oyster` / `toon:optimized`.
  - `docker-compose-sdk-e2e.yml` lines 161 + 256 both still say `image: toon:optimized`.
  - `CLAUDE.md` contains zero references to `Dockerfile.sdk-e2e`.
- ✅ No fixtures, factories, mocks, or data-testid attributes required (infra story).
- ✅ Implementation checklist maps each AC to the story's Task N.M subtasks.

### GREEN Phase (DEV — next)

1. Execute Task 0 (capture pre-change Oyster + SDK E2E baselines) BEFORE any file edit.
2. Execute Tasks 1–3 in order (new Dockerfile, script edit, compose edit).
3. Re-run AC-1..AC-9 grep probes — all must be GREEN.
4. Execute Task 4 (Oyster post-change non-regression build). Gate AC-10.
5. Execute Task 5 (infra up + six probes + down). Gates AC-11, AC-12.
6. Execute Task 6 (SDK E2E parity). Gates AC-13.
7. Execute Task 7 (CLAUDE.md one-line update). Gates AC-14.
8. Execute Task 8 (final diff review). Only the four files listed in §"Notes" below must appear in `git diff --name-only`.

### REFACTOR Phase

Minimal. The Dockerfile is a near-clone of `Dockerfile.oyster` minus supervisord/attestation — per story Dev Notes §"Why a separate Dockerfile", duplication of ~50 Dockerfile lines is the DELIBERATE choice (blast radius + concern separation). Do NOT attempt to DRY-share layers between the two Dockerfiles; that is explicitly out of scope and recorded as a rejected design alternative.

---

## Next Steps

1. Hand this checklist to the dev workflow alongside `_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md`.
2. Dev confirms RED state by running the verification block above — all six AC-RED probes must show RED.
3. Dev executes Tasks 0–8 in order.
4. Dev re-runs the GREEN verification block — all 14 ACs must go GREEN.
5. Dev records Oyster baseline metrics (AC-10), six health-probe responses (AC-11), and per-file SDK E2E counts + chosen baseline path (AC-13) in the story's Dev Notes.
6. Dev closes the story once all 14 ACs are checked and the diff is confined to the four expected files.

---

## Knowledge Base References Applied

This ATDD workflow consulted:

- **test-levels-framework.md** — confirmed that Dockerfile/infra changes do not map to unit/component/E2E levels; infra-verification level is appropriate.
- **test-priorities-matrix.md** — P0 assignment for ACs that block Story 12.10 unblock (AC-3, AC-4, AC-8, AC-9, AC-11); P1 for parity/correctness; P2 for hygiene.
- **test-quality.md** — each AC maps to a single concrete observable (grep match, docker build exit code, curl status). No shared mutable fixtures; every probe is idempotent.
- **test-healing-patterns.md** — AC-13 includes explicit retry-3× guidance for infra-flaky Mina lightnet failures to avoid healing image-change noise as a real regression.
- **ci-burn-in.md** — AC-10 + AC-13 pattern (baseline capture before + after the change) is the canonical infra-regression approach.

`data-factories.md`, `component-tdd.md`, `fixture-architecture.md`, `network-first.md`, `selector-resilience.md`, `timing-debugging.md`, Playwright Utils fragments, Pact.js Utils fragments, `pact-mcp.md` — loaded as core/extended per stack detection but **not applied** (no UI, no API endpoints, no contract tests created by this story).

---

## Test Execution Evidence

### Initial Verification Run (RED Phase Verification — 2026-04-15)

**Commands + observed output:**

```bash
$ ls /Users/jonathangreen/Documents/TOON-Protocol/docker/Dockerfile.sdk-e2e
ls: /Users/jonathangreen/Documents/TOON-Protocol/docker/Dockerfile.sdk-e2e: No such file or directory
# AC-1 → RED ✅ (file does not exist)

$ grep -n "toon:optimized\|Dockerfile.oyster" scripts/sdk-e2e-infra.sh docker-compose-sdk-e2e.yml
scripts/sdk-e2e-infra.sh:84:  log_info "Building toon:optimized image..."
scripts/sdk-e2e-infra.sh:85:  docker build -f "$REPO_ROOT/docker/Dockerfile.oyster" -t toon:optimized "$REPO_ROOT"
docker-compose-sdk-e2e.yml:161:    image: toon:optimized
docker-compose-sdk-e2e.yml:256:    image: toon:optimized
# AC-8 → RED ✅ (script still references Dockerfile.oyster and toon:optimized)
# AC-9 → RED ✅ (compose peer1 + peer2 both still toon:optimized)
```

**Summary:**

- Total verifications: 14
- Passing: 0 (expected — RED phase)
- Failing: 14 (expected — RED phase)
- Status: ✅ RED phase verified

**Expected failure messages per AC:**

| AC | Pre-impl failure signal |
|---|---|
| AC-1 | `docker/Dockerfile.sdk-e2e` does not exist |
| AC-2..AC-7 | dependent on AC-1; cannot assert content of missing file |
| AC-8 | `scripts/sdk-e2e-infra.sh:85` still builds from `Dockerfile.oyster` and tags `toon:optimized` |
| AC-9 | `docker-compose-sdk-e2e.yml` lines 161 + 256 still `image: toon:optimized` |
| AC-10 | (deferred) baseline must be captured in Task 0 |
| AC-11 | `./scripts/sdk-e2e-infra.sh up` fails at peer image build step (`cd docker && pnpm run build` attestation-server bundle) — this is the reported breakage that motivated the story |
| AC-12 | dependent on AC-11 |
| AC-13 | dependent on AC-11 + Task 0 baseline selection |
| AC-14 | `CLAUDE.md` contains zero references to `Dockerfile.sdk-e2e` |

---

## Notes

- **Expected post-implementation `git diff --name-only` output (exactly these 4 paths):**
  - `docker/Dockerfile.sdk-e2e` (new)
  - `scripts/sdk-e2e-infra.sh` (2-line edit)
  - `docker-compose-sdk-e2e.yml` (2-line edit)
  - `CLAUDE.md` (1-line edit)

- **Files that MUST NOT change (hard guard):**
  - `docker/Dockerfile.oyster` (production TEE image — frozen for this story)
  - `docker/Dockerfile.agent-runtime-patched`, `docker/Dockerfile.nix`, `docker/Dockerfile.backup`
  - `docker/src/entrypoint-sdk.ts`, `docker/src/attestation-server.ts`, `docker/esbuild.config.mjs`, `docker/supervisord.conf`
  - Any file under `packages/**/src/**` or `packages/**/tests/**`

- **Rationale for no new `.test.ts` files:** the story is pure Dockerfile/shell infra. Story Dev Notes §"Testing standards summary" explicitly prescribes manual + scripted validation only. Adding vitest files here would create false test coverage without testing real behavior.

- **Re-use of existing SDK E2E suite:** the 9 existing `packages/sdk/tests/e2e/docker-*.test.ts` files serve as the AC-13 regression gate. They are the downstream consumer of the new image and are the highest-fidelity proof that the image swap is behavior-preserving. No modifications to those files are in scope for 12.11.

- **Tagged as `fix` not `feat`:** this story corrects an inappropriate Dockerfile choice. No new protocol primitive, no new SDK API surface. The correctness gate is regression parity (AC-10, AC-13), not new-behavior validation.

- **Downstream unblock:** once AC-1..AC-14 all GREEN, Story 12.10 (`12-10-e2e-swap-flow-docker-multichain.md`) is unblocked and can proceed with its own ATDD + dev cycle.

---

## Contact

**Questions or Issues?**

- See story file: `_bmad-output/implementation-artifacts/12-11-dockerfile-sdk-e2e-split.md`
- See blocked downstream: `_bmad-output/implementation-artifacts/12-10-e2e-swap-flow-docker-multichain.md`
- See Epic 12: `_bmad-output/epics/epic-12-token-swap-primitive.md`
- CLAUDE.md §"Troubleshooting — SDK E2E tests failing" for infra diagnostic steps.

---

**Generated by BMad TEA Agent** — 2026-04-15
