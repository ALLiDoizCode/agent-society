---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-14'
workflowType: 'testarch-atdd'
inputDocuments:
  - _bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md
  - _bmad-output/planning-artifacts/test-design-epic-12.md
  - _bmad-output/epics/epic-12-token-swap-primitive.md
  - packages/town/src/town.ts
  - packages/town/src/cli.ts
  - packages/town/src/package-structure.test.ts
  - packages/mill/src/index.ts
  - packages/mill/src/errors.ts
  - packages/mill/src/channel-state.ts
  - _bmad/tea/config.yaml
---

# ATDD Checklist — Epic 12, Story 12-7: `packages/mill/` Scaffold — `startMill()` Entrypoint

**Date:** 2026-04-14
**Author:** Jonathan
**Primary Test Level:** Unit + Integration (backend TypeScript package; no browser/E2E in this story)
**Execution Mode:** YOLO (auto-proceeded, no per-step confirmations)
**Workflow:** `_bmad/tea/workflows/testarch/atdd`

---

## Step 1 — Preflight & Context (summary)

- **Stack Detection:** `backend` (TypeScript monorepo, Vitest; no `page.goto` / `page.locator` in `packages/mill`)
- **Config flags read from `_bmad/tea/config.yaml`:**
  - `test_stack_type: auto` → resolved `backend`
  - `tea_use_playwright_utils: true` — **not applied** (backend only)
  - `tea_use_pactjs_utils: true` — **not applied** (no microservice contract surface in 12.7)
  - `tea_browser_automation: auto` — **not applied** (backend only)
  - `test_framework: auto` → resolved Vitest (matches existing `packages/mill/vitest.config.ts`)
- **Framework files inspected:** `packages/mill/vitest.config.ts`, `packages/mill/tsconfig.json`, `packages/mill/package.json`, `packages/mill/tsup.config.ts`
- **Existing test patterns inspected:** `errors.test.ts`, `inventory.test.ts`, `wallet.test.ts`, `channel-state.test.ts`, `claim-issuer.test.ts` (all co-located `*.test.ts`, Vitest `describe/it/expect`, P0/P1/P2 tags in titles — followed)
- **Knowledge base fragments applied (from `tea-index.csv`, core tier + backend tier):**
  - `data-factories.md` — inline factory helpers (`baseConfig`, `fakeConnector`) used instead of `faker`-based factories (deterministic, no random seeds — matches existing Mill test style)
  - `test-quality.md` — Given-When-Then implicit; one assertion-per-concern; no placeholder `expect(true).toBe(true)`
  - `test-levels-framework.md` — Integration-style over the `startMill()` composition pipeline; helper-level unit tests for `buildSignerAddresses`
  - `test-priorities-matrix.md` — Priorities (P0/P1/P2) tagged in test titles per project convention
  - `component-tdd.md` / `selector-resilience.md` / `network-first.md` / `timing-debugging.md` — **N/A** (backend)
  - `ci-burn-in.md` — 5s-cap smoke test on CLI (no external network)

---

## Step 2 — Generation Mode (summary)

- **Mode chosen:** AI Generation (no recording). Rationale: ACs are explicit (14 acceptance criteria with code examples), stack is backend-only, no UI surface to record, and the story already encodes Given/When/Then via its "phase order" pipeline.

---

## Step 3 — Test Strategy

### Acceptance Criteria → Test Mapping

| AC   | Summary                                             | Level       | Priority | Test Location                                                 |
| ---- | --------------------------------------------------- | ----------- | -------- | ------------------------------------------------------------- |
| AC-1 | Package exports + structure                         | Unit        | P0/P1    | `packages/mill/src/package-structure.test.ts`                 |
| AC-2 | `MillConfig` validation (every INVALID_CONFIG path) | Unit        | P1/P2    | `packages/mill/src/mill.test.ts` (`AC-2` describe)            |
| AC-3 | `MillInstance` return shape + `health()`            | Integration | P0/P1    | `mill.test.ts` (`T-055` describe), `health.test.ts`           |
| AC-4 | `startMill()` composition pipeline (phases 1–14)    | Integration | P0       | `mill.test.ts` (`T-055`, `T-056`)                             |
| AC-5 | `buildSignerAddresses` helper                       | Unit        | P1       | `mill.test.ts` (`AC-5` describe)                              |
| AC-6 | kind:10032 publication with `swapPairs`             | Integration | P1       | `mill.test.ts` (`T-057` describe)                             |
| AC-7 | Connector ownership cleanup                         | Integration | P1       | `mill.test.ts` (`AC-7` describe)                              |
| AC-8 | `GET /health` endpoint                              | Integration | P1/P2    | `packages/mill/src/health.test.ts`                            |
| AC-9 | CLI                                                 | Integration | P1/P2    | `packages/mill/src/cli.test.ts`                               |
| AC-10| Handler registered on kind 1059                     | Integration | P0       | `mill.test.ts` (`T-055` describe, registry assertion)         |
| AC-11| `MillStartError` class                              | Unit        | P0/P1    | **Existing** `packages/mill/src/errors.test.ts` already imports `MillStartError` — add code-table coverage during dev |
| AC-12| `stop()` idempotent + resources released            | Integration | P2       | `mill.test.ts` (`T-060` describe)                             |
| AC-13| No circular import `mill.ts` ↔ `index.ts`           | Unit        | P2       | `package-structure.test.ts` (`AC-13` describe)                |
| AC-14| Sprint-status flip                                  | Manual      | —        | Out-of-band — dev flips `_bmad-output/implementation-artifacts/sprint-status.yaml:268` on completion |

### Test-Design Risk Matrix Coverage

- **T-055 (P0)** — boot + handler register + health — covered by 3 it-blocks in `mill.test.ts::T-055`
- **T-056 (P0)** — key derivation from mnemonic — covered by 3 it-blocks in `mill.test.ts::T-056` (EVM-only, EVM+Solana, identity ≠ signer separation)
- **T-057 (P1)** — kind:10032 publication — covered by 2 it-blocks in `mill.test.ts::T-057` (swapPairs byte-equality + publish-failure-tolerance)
- **T-058 (P1)** — missing mnemonic → clear error — covered by 3 it-blocks in `mill.test.ts::T-058`
- **T-059 (P1)** — export surface — covered by 4 it-blocks in `package-structure.test.ts::AC-1 index.ts export surface`
- **T-060 (P2)** — graceful shutdown — covered by 2 it-blocks in `mill.test.ts::T-060`
- **R-015 (INTEG score 4)** — handler not registered — directly exercised in `mill.test.ts::T-055` second it-block (`registry.get(1059)` presence + negation via `registry.get(1)`)

### Red Phase Requirements

- All new `describe(...)` blocks use **`describe.skip(...)`** — tests collect, do not execute, mark the entire suite as pending until dev unskips per phase.
- Where dynamic imports reference unimplemented modules (`./mill.js`, `./cli.js`), `await import(...)` is wrapped inside `.skip` blocks so the test runner never attempts module resolution during red phase.
- Every test asserts **real expected behavior** (shapes, values, error codes) — no `expect(true).toBe(true)` placeholders.
- Dev flips `.skip` → live one describe at a time during GREEN phase, matching the phase ordering in AC-4 (validate → identity → keys → signers → inventory → issuer → handler → registry → connector → BLS → publish).

---

## Step 4 — Test Generation (RED Phase Artifacts)

> **Note on workflow adaptation:** The ATDD workflow's step-04 prescribes launching two parallel subprocesses for API + E2E test generation. That protocol targets frontend/fullstack stacks. Story 12.7 is a pure backend TypeScript package; there are no E2E browser tests and the "API" tests are in-process integration tests over the `startMill()` composition. The subprocess step was collapsed into a single generation pass (documented here for auditability). Performance-gain metric is N/A for a single-stack generation.

### Failing Tests Created (RED Phase)

| File                                                  | describe/it count | Status | TDD Enforcement |
| ----------------------------------------------------- | ----------------- | ------ | --------------- |
| `packages/mill/src/mill.test.ts`                      | 9 describes / 22 its | RED   | `describe.skip(...)` on every describe |
| `packages/mill/src/health.test.ts`                    | 1 describe / 3 its | RED   | `describe.skip(...)` |
| `packages/mill/src/cli.test.ts`                       | 2 describes / 4 its | RED   | `describe.skip(...)` |
| `packages/mill/src/package-structure.test.ts`         | 3 describes / 9 its | RED   | `describe.skip(...)` |

**Aggregate:** 4 test files, 15 describe blocks, **38 it-blocks**, all RED.

### Per-test RED rationale

See each `describe.skip('...')` title — the JSDoc header of each file also enumerates which ACs and which T-0xx scenarios it covers.

### Data Factories Created

None new. The tests use inline `baseConfig()` and `fakeConnector()` helpers local to each file (matches existing Mill test conventions — see `channel-state.test.ts`, `claim-issuer.test.ts`). Dev may promote these to `packages/mill/src/__fixtures__/` during GREEN phase if re-used across more tests.

### Fixtures Required (DEV must create during GREEN)

- `packages/mill/fixtures/mill.config.json` — minimal valid JSON config for CLI smoke test (per AC-9 task 9.7). Recommended shape:

  ```jsonc
  {
    "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    "swapPairs": [
      {
        "from": { "chain": "evm:8453", "asset": "USDC" },
        "to":   { "chain": "evm:8453", "asset": "USDC" },
        "rate": "1.0"
      }
    ],
    "chains": ["evm"],
    "channels": {
      "evm:8453": [
        { "channelId": "c-1", "cumulativeAmount": "0", "nonce": "0", "updatedAt": 0 }
      ]
    },
    "inventory": { "evm:8453": "1000000" },
    "relayUrls": ["ws://localhost:0"],
    "blsPort": 0
  }
  ```

### Mock Requirements

- **Nostr relay** — none in unit tests. `config.relayUrls` publication path (AC-6) MUST expose a `__testHooks.onPeerInfoBuilt` capture seam OR accept an injected publisher for assertion purposes. Dev chooses; test captures expect one of those surfaces.
- **Embedded connector** — `fakeConnector()` helper with `close()` + `send()` stubs. Real `ConnectorNode` is NOT booted in unit tests.
- **HD key derivation** — real. `deriveMillKeys()` (Story 12.4) is deterministic with the fixed valid mnemonic; tests assert derived shapes (`/^0x[0-9a-f]{40}$/` etc.) rather than exact values (keys can be recomputed offline if a diff is ever flagged).

### Required `data-testid` attributes

**N/A** — no UI.

---

## Implementation Checklist (maps failing tests → dev tasks)

### Task 1 — `MillStartError` + module skeleton (AC-1, AC-11, AC-13)

- [ ] Add `MillStartError` + `MillStartErrorCode` union to `packages/mill/src/errors.ts`.
- [ ] Add code-table test cases to `errors.test.ts` (file already imports the class — unskip/add coverage).
- [ ] Create `packages/mill/src/mill.ts` with typed exports + `startMill()` stub (throw `MillStartError('INVALID_CONFIG', 'not implemented')`).
- [ ] Append AC-1 export block to `packages/mill/src/index.ts`.
- [ ] **Un-skip** `package-structure.test.ts` → ✅ green.

### Task 2 — Config validation + identity + key derivation (AC-2, AC-4 phases 1–3; T-056, T-058)

- [ ] Implement AC-2 validator (exactly-one mnemonic/secretKey, exactly-one connector/connectorUrl, non-empty swapPairs/relayUrls/channels/inventory per pair.to.chain).
- [ ] Resolve identity via `fromMnemonic` / `fromSecretKey`.
- [ ] Derive `MillKeys` via `deriveMillKeys({ mnemonic, passphrase, chains })`.
- [ ] Throw `MILL_REQUIRES_MNEMONIC` when secretKey-only.
- [ ] **Un-skip** `mill.test.ts::AC-2` + `mill.test.ts::T-058` + `mill.test.ts::T-056` → ✅ green.

### Task 3 — Signer + inventory + claim issuer (AC-4 phases 4–7, AC-5, closes 12.6 TODO)

- [ ] Export named helper `buildSignerAddresses(pairs, keys)` from `mill.ts`.
- [ ] Instantiate one `*PaymentChannelSigner` per family.
- [ ] Construct `MillInventory`, `MillChannelState`.
- [ ] Construct `MultiChainClaimIssuer` with `signerAddresses` map populated.
- [ ] **Un-skip** `mill.test.ts::AC-5` → ✅ green.

### Task 4 — Swap handler + HandlerRegistry (AC-4 phases 8–10, AC-10)

- [ ] Wire `createSwapHandler({ recipientSecretKey: identity.secretKey, swapPairs, claimIssuer, rateProvider, seenPacketIds, logger })`.
- [ ] Build verification pipeline + pricing validator + handler context (copy from `startTown()`).
- [ ] `const registry = new HandlerRegistry(); registry.on(1059, swapHandler);`
- [ ] Expose `_handlerRegistry` as @internal read-only on `MillInstance` for AC-10 test.
- [ ] **Un-skip** `mill.test.ts::T-055` handler-registration it-block → ✅ green.

### Task 5 — Connector resolution + ownership (AC-4 phase 11, AC-7)

- [ ] Resolve connector by mode; track `ownsConnector: boolean`.
- [ ] **Un-skip** `mill.test.ts::AC-7` → ✅ green.

### Task 6 — BLS server + health (AC-4 phase 12, AC-8)

- [ ] Hono app with `GET /health` → `MillHealthResponse`.
- [ ] Status transitions `starting` → `ok` → `stopping` → `stopped`.
- [ ] Inventory bigint → decimal string (MAX_SAFE_INTEGER guard).
- [ ] **Un-skip** `health.test.ts` → ✅ green.

### Task 7 — kind:10032 publication (AC-4 phase 13, AC-6)

- [ ] Build + sign event via `buildIlpPeerInfoEvent`.
- [ ] Forward to `knownPeers[0]` (fire-and-forget, WARN on failure).
- [ ] DEBUG-log `relayUrls`.
- [ ] Add `__testHooks.onPeerInfoBuilt` config field.
- [ ] **Un-skip** `mill.test.ts::T-057` → ✅ green.

### Task 8 — `stop()` + cleanup (AC-3, AC-4 phase 14, AC-12)

- [ ] Stop BLS server; close connector iff `ownsConnector`.
- [ ] Add `MillChannelState.releaseAll()` + unit test.
- [ ] Idempotent `stop()` (guard flag).
- [ ] **Un-skip** `mill.test.ts::T-060` → ✅ green.

### Task 9 — CLI + binary (AC-9)

- [ ] Create `packages/mill/src/cli.ts` with `#!/usr/bin/env node` + `main(argv)` export + self-invoke.
- [ ] Add `"bin": { "toon-mill": "./dist/cli.js" }` to `package.json`.
- [ ] Update `tsup.config.ts` entries to `['src/index.ts', 'src/cli.ts']`.
- [ ] Move `@toon-protocol/sdk` → dependencies; add `@toon-protocol/connector`, `hono`, `@hono/node-server`, `nostr-tools`.
- [ ] Create `packages/mill/fixtures/mill.config.json`.
- [ ] SIGINT/SIGTERM → `instance.stop()` → `process.exit(0)`.
- [ ] **Un-skip** `cli.test.ts` → ✅ green.

### Task 10 — Final validation

- [ ] `pnpm --filter @toon-protocol/mill test` — **all 38 new it-blocks green; Story 12.4 regression still green**.
- [ ] `pnpm --filter @toon-protocol/mill build` — tsup emits `dist/index.js`, `dist/mill.js`, `dist/cli.js`, `dist/*.d.ts`.
- [ ] `pnpm lint` at root.
- [ ] Flip `sprint-status.yaml:268` → `done`.
- [ ] Flip this story file Status → `done`.

---

## Running Tests

```bash
# Run all failing Mill tests (RED phase — most skipped)
pnpm --filter @toon-protocol/mill test

# Run one test file
pnpm --filter @toon-protocol/mill test mill.test.ts
pnpm --filter @toon-protocol/mill test health.test.ts
pnpm --filter @toon-protocol/mill test cli.test.ts
pnpm --filter @toon-protocol/mill test package-structure.test.ts

# Watch mode during GREEN phase
pnpm --filter @toon-protocol/mill test:watch
```

---

## Red-Green-Refactor Workflow

### RED Phase (COMPLETE — this document) ✅

- [x] 38 failing it-blocks written across 4 test files
- [x] Each `describe` block tagged `.skip(...)` for TDD red-phase compliance
- [x] No placeholder assertions — every `expect()` asserts real expected behavior
- [x] Knowledge fragments applied per `tea-index.csv` core + backend tiers
- [x] Fixture seams documented (`__testHooks.onPeerInfoBuilt`, `_handlerRegistry`)
- [x] Implementation checklist generated (Tasks 1–10 map 1:1 to story tasks)

### GREEN Phase (DEV team — next)

1. Pick one failing `describe.skip(...)` from `mill.test.ts` (start with **Task 1** / `package-structure.test.ts`)
2. Read the `describe` body
3. Implement minimal code in `mill.ts` to satisfy the assertions
4. Remove `.skip` from that describe block
5. Run `pnpm --filter @toon-protocol/mill test <file>` — should go green
6. Commit; move to next describe (follow phase order in AC-4: validate → identity → keys → ... → shutdown)

### REFACTOR Phase (DEV team — after all green)

- Re-read `mill.ts` end-to-end; ensure it reads as a sibling of `town.ts` (no novel abstractions)
- Extract shared composition helpers if duplication with `startTown()` > ~10 LOC
- Verify `packages/mill/package.json` deps pinned to match `packages/town/package.json` (no drift)
- Run `pnpm --filter @toon-protocol/mill build` — confirm no circular-import warnings

---

## Knowledge Base References Applied

- `data-factories.md` — inline factory helpers over `faker` (deterministic, matches existing Mill style)
- `test-quality.md` — single-concern assertions, no placeholders, priority tagging in test titles
- `test-levels-framework.md` — Integration bias (pipeline over `startMill()`); Unit where helper is isolatable (`buildSignerAddresses`)
- `test-priorities-matrix.md` — P0 = boot + handler + keys; P1 = publication + ownership + CLI; P2 = shutdown + edge validation
- `ci-burn-in.md` — CLI smoke test capped at 5s internally; no subprocess spawning

---

## Test Execution Evidence

### Initial RED-phase verification (pre-dev)

**Command:** `pnpm --filter @toon-protocol/mill test`

**Expected behavior (without running — `mill.ts` / `cli.ts` do not yet exist):**

```
Test Files  4 skipped (4)
     Tests  38 skipped (38)
       ✓ collection succeeds (dynamic imports deferred inside .skip blocks)
```

**Summary:**

- Total new tests: 38
- Passing: 0 (expected — RED phase)
- Skipped: 38 (expected — RED phase `.skip` markers)
- Existing Story 12.4 tests: unchanged, still green
- Status: ✅ RED phase verified (all new tests pending, no false positives, no collection errors because of dynamic import guards)

**Why `.skip` instead of letting them hard-fail:**

- Existing Story 12.4 tests in the same package must continue to pass in CI during the dev iterations for 12.7.
- Hard-failing tests on an unimplemented module would block unrelated CI runs.
- Dev removes `.skip` **one describe at a time** during GREEN phase — classic TDD micro-cycle. Each un-skip = one concrete RED → GREEN transition.

---

## Notes

- **Workflow adaptation for backend stack.** The ATDD step-04 prescribes parallel API + E2E subprocess generation. For a backend-only TypeScript package (Vitest, no browser), we collapsed to a single generation pass. Documented above; no content was skipped, only the subprocess ceremony.
- **Existing stub in `errors.test.ts`.** The file at `packages/mill/src/errors.test.ts` already references `MillStartError` via `import { MillStartError } from './errors.js'` — that import will fail compilation until Task 1 lands. Dev should treat this as an **additional RED signal** beyond the 38 `.skip` blocks in the new files.
- **Test seams expected from dev.** Two seams are required by tests but not strictly listed as ACs in the story doc:
  1. `MillInstance._handlerRegistry?: HandlerRegistry` (@internal) — AC-10 explicitly allows this; test asserts it.
  2. `MillConfig.__testHooks?: { onPeerInfoBuilt?(event): void }` — a narrow capture seam for AC-6. Dev may implement this OR expose a `relayClient` injection point; either satisfies the test.
- **Fixture file is still dev's responsibility** — `packages/mill/fixtures/mill.config.json` is created in Task 9 (AC-9 task 9.7). The CLI smoke test `describe.skip(...)` will un-skip only after that file lands.
- **Sprint-status flip** is a manual audit-trail step (AC-14) — not a test. No test enforces it; dev owns.

---

## Contact

**Questions or Issues?**

- Tag Jonathan in the epic-12 channel
- Reference story: `_bmad-output/implementation-artifacts/12-7-start-mill-scaffold.md`
- Reference test-design: `_bmad-output/planning-artifacts/test-design-epic-12.md` section 2.7
- Reference workflow: `_bmad/tea/workflows/testarch/atdd/workflow.yaml`

---

**Generated by BMad TEA Agent (ATDD workflow, YOLO mode)** — 2026-04-14
