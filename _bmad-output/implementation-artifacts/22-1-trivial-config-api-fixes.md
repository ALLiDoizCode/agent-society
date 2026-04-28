# Story 22.1: Trivial Config/API Fixes

Status: todo

## Story

As a developer,
I want all one-line config/API regressions fixed,
so that the CI baseline is unblocked for deeper connector v3.3.2 fixes.

## Acceptance Criteria

1. `packages/mina-zkapp/package.json` — add `ts-node` to `devDependencies` so Jest can parse `jest.config.ts`.
2. `packages/client/` E2E tests — polyfill `globalThis.WebSocket` for Node.js 20 (import `ws` and assign to `globalThis.WebSocket` in test `beforeAll` or vitest setup file).
3. `packages/sdk/tests/e2e/docker-dvm-submission-e2e.test.ts` — add `expiresAt: new Date(Date.now() + 30000)` to all raw `connector.sendPacket()` calls in T-INT-06 probe section.
4. `packages/core/src/events/swarm.ts` or `packages/sdk/tests/e2e/docker-swarm-e2e.test.ts` — add `customerPubkey: swarmRequest.pubkey` to `buildSwarmSelectionEvent()` params.
5. `docker-compose-sdk-e2e.yml` — add Anvil Account #1 (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`) to the `for ADDR in ...` Mock USDC funding loop in the Anvil entrypoint.
6. `packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts` — ensure `SOLANA_PROGRAM_ID` env var is exported or properly sourced from `docker-e2e-setup.ts` before test assertions.

## Tasks / Subtasks

- [ ] Task 1: mina-zkapp ts-node devDependency (AC: #1)
  - [ ] 1.1 Open `packages/mina-zkapp/package.json`
  - [ ] 1.2 Add `ts-node` to `devDependencies` with a compatible version
  - [ ] 1.3 Run `pnpm --filter @toon-protocol/mina-zkapp test` to verify Jest can now load `jest.config.ts`

- [ ] Task 2: client WebSocket polyfill (AC: #2)
  - [ ] 2.1 Check `packages/client/` for existing vitest setup file or `beforeAll` pattern in E2E tests
  - [ ] 2.2 Add `import ws from 'ws'; globalThis.WebSocket = ws as any;` to the appropriate setup hook
  - [ ] 2.3 Run `pnpm --filter @toon-protocol/client test:e2e` to verify tests progress past WebSocket errors

- [ ] Task 3: SDK sendPacket expiresAt (AC: #3)
  - [ ] 3.1 Open `packages/sdk/tests/e2e/docker-dvm-submission-e2e.test.ts`
  - [ ] 3.2 Find all raw `connector.sendPacket()` calls in the T-INT-06 probe section
  - [ ] 3.3 Add `expiresAt: new Date(Date.now() + 30000)` to each call
  - [ ] 3.4 Run `pnpm --filter @toon-protocol/sdk test:e2e:docker` (or the specific DVM test file) to verify `toISOString` on undefined no longer occurs

- [ ] Task 4: Swarm customerPubkey (AC: #4)
  - [ ] 4.1 Open `packages/core/src/events/swarm.ts` and/or `packages/sdk/tests/e2e/docker-swarm-e2e.test.ts`
  - [ ] 4.2 Add `customerPubkey: swarmRequest.pubkey` to `buildSwarmSelectionEvent()` params
  - [ ] 4.3 Run the swarm E2E test to verify the parameter is accepted

- [ ] Task 5: Anvil Account #1 funding (AC: #5)
  - [ ] 5.1 Open `docker-compose-sdk-e2e.yml`
  - [ ] 5.2 Locate the `for ADDR in ...` Mock USDC funding loop in the Anvil entrypoint
  - [ ] 5.3 Add `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Anvil Account #1) to the loop
  - [ ] 5.4 Restart `./scripts/sdk-e2e-infra.sh up` and verify Account #1 has USDC balance

- [ ] Task 6: Solana SOLANA_PROGRAM_ID plumbing (AC: #6)
  - [ ] 6.1 Open `packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts` and `docker-e2e-setup.ts`
  - [ ] 6.2 Ensure `SOLANA_PROGRAM_ID` is sourced from env or set explicitly before test assertions
  - [ ] 6.3 Run Solana settlement E2E test to verify env var is no longer empty

## Dev Notes

### Context

This story is a consolidation of all one-line fixes caused by the `@toon-protocol/connector` v3.3.2 upgrade. Each AC is independent and can be fixed in any order. All changes should go in a single PR.

### Connector v3.3.2 Breaking Changes Relevant Here

| Change | v2.3.0 Behavior | v3.3.2 Behavior | Affected Tests |
|---|---|---|---|
| `sendPacket()` `expiresAt` | Optional, defaulted to `now + 30s` | **Mandatory `Date`** — `params.expiresAt.toISOString()` called without null check | sdk DVM submission E2E (`toISOString` on undefined) |
| `settlementInfra` config | Top-level config block | **Removed** — replaced by `chainProviders[]` array | sdk E2E, mill E2E (config drift) |

### Standard Guards

- **Do NOT modify connector source** — these are test-side fixes or config fixes only.
- **One PR for all ACs** — to avoid CI churn, bundle these trivial fixes together.
- **Verify each fix against live infra** where possible (Anvil + Docker peers for E2E tests).

## Verification

After all tasks complete:

```bash
pnpm --filter @toon-protocol/mina-zkapp test
pnpm --filter @toon-protocol/client test:e2e
pnpm --filter @toon-protocol/sdk test:e2e:docker  # specific affected files
```

All targeted tests should progress past their previous failure points. Full green CI is the goal of Epic 22, not necessarily this story alone.
