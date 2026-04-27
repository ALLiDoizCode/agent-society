# Epic 22: Restore Green CI Post-Connector v3.3.2 Upgrade

**Status:** IN PROGRESS — Spikes complete, ready for implementation
**Date:** 2026-04-27
**Origin:** Test regression analysis after connector v3.3.2 upgrade
**Decision Record:** PR 28 (epic-12, commit `7b47962`) was the last fully green CI baseline. After upgrading `@toon-protocol/connector` to v3.3.2 (commit `b985c5f`), 8 test phases broke across 5 packages. This epic systematically repairs every failing suite.

---

## Goal

Restore the green CI baseline that existed at PR 28 (epic-12 completion) by systematically fixing every test failure introduced by the `@toon-protocol/connector` v3.3.2 upgrade. The v3.3.2 upgrade introduced breaking API changes (mandatory `expiresAt` on `sendPacket()`, `settlementInfra` → `chainProviders` config migration) and infrastructure changes that caused E2E test regressions across the workspace.

**Success Criteria:**
- All unit tests pass across all packages
- All E2E tests pass against `sdk-e2e-infra.sh` Docker infrastructure
- No skipped tests without a linked GitHub issue
- CI pipeline completes in <30 minutes

---

## Spike Summary (2026-04-27)

Two independent spike investigations ran in parallel against live Docker infrastructure. Both returned **high-confidence root causes**.

| Story | Hypothesis | Finding | Fix Direction |
|---|---|---|---|
| **22-2** Multi-hop routing fails | Peer1→Peer2 routing table issue | `DiscoveryTracker` auto-discovers Peer2 and **overwrites** the constructor route `g.toon.peer2 -> peer2` with a new peerId derived from Peer2's Nostr pubkey. The payment channel exists only under the old peerId `peer2`. Routing mismatch causes `T00 No payment channel available for peer`. | Reuse constructor peerId when auto-discovering a peer whose BTP endpoint/EVM address matches an existing configured peer. |
| **22-3** Workflow chain null event | Relay indexing lag or persistence issue | Relay treats `kind:10040` as standard NIP-01 replaceable (10000–19999). When tests share a pubkey and `created_at` second, the relay **silently drops** the new event if its ID is lexicographically larger. Event was paid and fulfilled (`success=true`) but not stored. | Extend relay's `isParameterizedReplaceableKind` to cover TOON range `10032–10099`, so replacement keys on `pubkey + kind + d-tag` instead of `pubkey + kind`. |

**Spike confidence:** High for both. Log chains are unambiguous and reproducible.

---

## Key Design Decisions

**D22-001: Connector v3.3.2 is required, not optional.** The v3.3.2 upgrade delivers metrics/earnings endpoints (epic-37) and the `chainProviders` configuration pattern. Rolling back to v2.3.0 is not an option — the upgrade is a committed dependency for the next release milestone.

**D22-002: One epic, not multiple.** All 8 failures share the same root cause (connector upgrade) and the same user impact (red CI masks real regressions). Splitting into multiple epics is coordination theater. One epic, sequenced ruthlessly.

**D22-003: Stories grouped by root cause, not by package.** Stories 3+4 and 5+6 share failure modes and will be fixed by the same engineer in the same files. Splitting them by package violates "developer productivity is architecture."

**D22-004: Spike ACs mandatory for unknown-unknowns.** Stories 2 and 3 (multi-hop routing, workflow chain null events) require time-boxed investigation before fix ACs are written. No fix ACs until the spike closes. This prevents chasing ghosts.

**D22-005: pet-circuit excluded.** The o1js WASM memory timeout (2-4 GB) predates this upgrade and is not part of the connector blast radius. Keep skipped, fix as a separate infrastructure story.

**D22-006: Solana settlement stays in scope.** Solana is a committed chain in the multi-chain swap primitive (epic-12). The `SOLANA_PROGRAM_ID` empty env var is a configuration issue, not a fundamental incompatibility. Fix the env var plumbing; if tx deserialization requires deeper work, scope that as a follow-up.

---

## Architecture

### Test Failure Dependency Graph

```
Story 1 (Config/API Fixes) ─┬─> Story 2 (Multi-hop Routing)
                            │   (blocked until infra healthy)
                            ├─> Story 3 (Workflow Chain)
                            │   (blocked until infra healthy)
                            ├─> Story 4 (Solana Settlement)
                            │   (parallel, isolated chain)
                            └─> Story 5 (Smoke Test)
                                (depends on all above for validation data)
```

**Critical Path:** Story 1 → Story 2 → Story 3.
Story 4 can run parallel. Story 5 validates the whole epic.

### Connector v3.3.2 Breaking Changes (Verified from `~/Documents/connector`)

| Change | v2.3.0 Behavior | v3.3.2 Behavior | Affected Tests |
|---|---|---|---|
| `sendPacket()` `expiresAt` | Optional, defaulted to `now + 30s` | **Mandatory `Date`** — `params.expiresAt.toISOString()` called without null check | sdk DVM submission E2E (`toISOString` on undefined) |
| `settlementInfra` config | Top-level config block | **Removed** — replaced by `chainProviders[]` array | sdk E2E, mill E2E (config drift) |
| `ctx.accept()` return | `{ fulfillment: ... }` | **Removed `fulfillment` field** from application API (v2.2.0+) | sdk publish event E2E (commented in test) |

---

## Stories

### Story 1: Trivial Config/API Fixes

**Scope:** Consolidated story covering all one-line fixes.

**AC-1:** `packages/mina-zkapp/package.json` — add `ts-node` to `devDependencies` so Jest can parse `jest.config.ts`.

**AC-2:** `packages/client/` E2E tests — polyfill `globalThis.WebSocket` for Node.js 20 (import `ws` and assign to `globalThis.WebSocket` in test `beforeAll` or vitest setup file).

**AC-3:** `packages/sdk/tests/e2e/docker-dvm-submission-e2e.test.ts` — add `expiresAt: new Date(Date.now() + 30000)` to all raw `connector.sendPacket()` calls in T-INT-06 probe section.

**AC-4:** `packages/core/src/events/swarm.ts` or `packages/sdk/tests/e2e/docker-swarm-e2e.test.ts` — add `customerPubkey: swarmRequest.pubkey` to `buildSwarmSelectionEvent()` params.

**AC-5:** `docker-compose-sdk-e2e.yml` — add Anvil Account #1 (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`) to the `for ADDR in ...` Mock USDC funding loop in the Anvil entrypoint.

**AC-6:** `packages/sdk/tests/e2e/docker-solana-settlement-e2e.test.ts` — ensure `SOLANA_PROGRAM_ID` env var is exported or properly sourced from `docker-e2e-setup.ts` before test assertions.

**Effort:** <30 minutes total. All one-liners. One PR.

---

### Story 2: Fix SDK Multi-Hop Publish E2E

**Spike Status:** ✅ COMPLETE (2026-04-27)

**Root Cause (Confirmed):** Peer1's `DiscoveryTracker` auto-discovers Peer2 and overwrites the static BTP route with a new peerId derived from Peer2's Nostr pubkey (`nostr-ba03c59663731bf6`). However, the payment channel was opened with the constructor-configured peerId `peer2`. When the test node sends a multi-hop packet to `g.toon.peer2`, Peer1 routes to the auto-discovered peerId and tries to generate a claim, but `channelManager.getChannelForPeer('nostr-ba03c59663731bf6', 'USDC')` returns null. Peer1 rejects with `T00 No payment channel available for peer`.

Single-hop works because `g.toon.peer1` is Peer1's own address — handled as **local delivery** (no forwarding, no claim needed).

**Evidence:**
- Peer1 routing log shows: `route_added` for `g.toon.peer2 -> peer2` (constructor), then overwritten by `route_added` for `g.toon.peer2 -> nostr-ba03c59663731bf6` (discovery)
- Peer1 packet handler: `on-demand channel creation failed` for `nostr-ba03c59663731bf6`
- Peer1 channel manager: external channel registered under peerId `peer2`

**Fix ACs:**
- **AC-1:** In `docker/src/entrypoint-sdk.ts` (or DiscoveryTracker wiring): when auto-registering a discovered peer, check if the BTP endpoint or EVM address matches an existing constructor-configured peer. If so, reuse the constructor peerId instead of generating a new pubkey-derived one.
- **AC-2:** Alternative: restore constructor routes after each discovery event so `g.toon.peer2 -> peer2` always wins.
- **AC-3:** All three multi-hop publish tests in `docker-publish-event-e2e.test.ts` pass.

**Effort:** Medium. 1-2 days.

---

### Story 3: Fix SDK Workflow Chain E2E

**Spike Status:** ✅ COMPLETE (2026-04-27)

**Root Cause (Confirmed):** The relay treats `kind:10040` (WORKFLOW_CHAIN_KIND) as standard NIP-01 replaceable (range 10000–19999). When multiple tests publish from the **same pubkey** within the **same `created_at` second**, the relay's `storeReplaceableEvent` silently drops the new event if its ID is lexicographically larger than the existing one. The event was **paid for and fulfilled** (`success: true`) but **not stored** — so `waitForEventOnRelay` returns null.

This is a 40% flaky failure when tests share a pubkey and fall within the same second.

**Evidence:**
- `packages/relay/src/storage/SqliteEventStore.ts`: `isReplaceableKind(10040)` returns `true` (10040 is in 10000–19999)
- `storeReplaceableEvent` only replaces if `created_at > existing.created_at` OR (`created_at === existing.created_at && event.id < existing.id`)
- Instrumentation captured: new event ID absent from relay, old event ID from prior test still present
- The protocol design expects `kind:10040` to be **parameterized** replaceable (keyed on `pubkey + kind + d-tag`), but the relay only wires parameterized logic for `30000–39999`

**Fix ACs:**
- **AC-1:** Extend `isParameterizedReplaceableKind` in `packages/relay/src/storage/SqliteEventStore.ts` to cover the TOON-specific range `10032–10099` (currently only `30000–39999` is parameterized). This makes the relay key replacement on `pubkey + kind + d-tag`, matching the protocol design.
- **AC-2:** The `workflow.ts` code already generates unique `d` tags per workflow (`wf-${Date.now()}-${steps.length}`), so collisions disappear once parameterized logic is applied.
- **AC-3:** The workflow chain E2E test passes deterministically across 5 consecutive runs.

**Effort:** Low. 1 day.

---

### Story 4: Fix SDK Solana Settlement E2E

**Root Cause:** Two issues:
1. `SOLANA_PROGRAM_ID` env var is empty — Solana program was never deployed by `sdk-e2e-infra.sh`
2. `failed to deserialize solana_transaction::versioned::VersionedTransaction` — settlement tx format may be incompatible with connector v3.3.2

**AC-1:** Fix `SOLANA_PROGRAM_ID` env var plumbing in `docker-e2e-setup.ts` or `docker-compose-sdk-e2e.yml`.

**AC-2:** If tx deserialization persists after env var fix, debug the settlement payload format between `@toon-protocol/connector@3.3.2` and `@solana/web3.js` transaction builder.

**AC-3:** All Solana settlement tests pass against `sdk-e2e-infra.sh`.

**Effort:** Medium. 1-2 days. Isolated chain — no cross-story dependencies.

---

### Story 5: Connector Interface Contract Smoke Test

**Root Cause (Prevention):** The connector v2.3.0 → v3.3.2 breaking changes were caught by 25 E2E tests, not by a lightweight contract test. This is expensive signal.

**AC-1:** Create a new test file `packages/sdk/tests/integration/connector-contract.test.ts` that exercises `sendPacket()`, `buildSwarmSelectionEvent()`, `registerPeer()`, and `openChannel()` against a mocked or stubbed connector.

**AC-2:** The smoke test must fail within 60 seconds if the connector API changes in a breaking way (missing mandatory params, removed config blocks, changed return shapes).

**AC-3:** Document the connector API contract in `CLAUDE.md` or `packages/sdk/CONNECTOR_MIGRATION.md` with version-to-version mapping.

**AC-4:** Run the smoke test as a CI canary step before the full E2E matrix.

**Effort:** Low. 1 day.

---

## Exclusions

- **pet-circuit integration tests:** o1js WASM memory timeout (2-4 GB). Pre-existing, not caused by connector upgrade. Skip with linked issue.
- **rig seed tests:** 134 failures from `@toon-protocol/client` barrel import resolution. Separate issue from connector upgrade — the package.json `exports` field needs alignment. Out of scope for this epic.

---

## Verification

After all stories complete:

```bash
./scripts/sdk-e2e-infra.sh up
pnpm --filter @toon-protocol/core test
pnpm --filter @toon-protocol/bls test
pnpm --filter @toon-protocol/client test
pnpm --filter @toon-protocol/mill test
pnpm --filter @toon-protocol/town test
pnpm --filter @toon-protocol/relay test
pnpm --filter @toon-protocol/sdk test
pnpm --filter @toon-protocol/pet-dvm test
pnpm --filter @toon-protocol/rig test
pnpm --filter @toon-protocol/townhouse test
cd packages/sdk && pnpm test:e2e:docker
cd packages/mill && pnpm test:e2e:docker
cd packages/client && pnpm test:e2e
./scripts/sdk-e2e-infra.sh down
```

All commands must exit 0. No timeouts. No flaky failures across 3 consecutive runs.
