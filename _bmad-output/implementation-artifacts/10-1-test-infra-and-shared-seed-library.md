# Story 10.1: Test Infrastructure & Shared Seed Library

Status: done

## Story

As a **TOON developer**,
I want **Playwright E2E infrastructure and a shared seed utility library for the Rig**,
so that **subsequent seed scripts and Playwright specs can publish real Nostr events and git objects through ILP without duplicating boilerplate, and the entire E2E suite runs against real SDK infrastructure with no mocks**.

## Acceptance Criteria

1. **AC-1.1 — ToonClient Factory (`clients.ts`):** `packages/rig/tests/e2e/seed/lib/clients.ts` creates 3 ToonClient instances (Alice/Bob/Carol) using Anvil accounts #3/#4/#5, each with distinct Nostr keypairs (reused from `socialverse-agent-harness.ts` `AGENT_IDENTITIES`). Each client bootstraps against Peer1 via BTP. Factory includes a `healthCheck()` verifying Peer1 BLS responds before returning clients. Each client must construct a valid `ilpInfo` object with `pubkey`, `ilpAddress`, and `btpEndpoint`.

2. **AC-1.2 — Git Builder (`git-builder.ts`):** `packages/rig/tests/e2e/seed/lib/git-builder.ts` wraps `createGitBlob()`, `createGitTree()`, `createGitCommit()` (ported from `socialverse-agent-alice-git-push.ts`) with SHA-to-txId tracking across pushes. Uploads only new objects via kind:5094 DVM. Validates each object size < 95KB before upload. Returns `{ sha, txId }` per object. Deterministic SHA computation uses `crypto.createHash('sha1')` over the full git envelope (`<type> <size>\0<content>`), but uploads only the body (content after `\0`). Includes `waitForArweaveIndex(txId, timeoutMs=30000)` retry helper with exponential backoff (per R10-001) to prevent flaky downstream tests.

3. **AC-1.3 — Publish Wrapper (`publish.ts`):** `packages/rig/tests/e2e/seed/lib/publish.ts` wraps `publishEvent()` with claim signing and retry. Before each publish, obtains the channelId from `client.getChannelId()` (populated during bootstrap), signs a balance proof via `client.signBalanceProof(channelId, cumulativeAmount)`, and passes the claim to `publishEvent(event, { claim })`. Note: `ToonClient.publishEvent()` calculates the per-event ILP amount internally (basePricePerByte=10 * TOON byte length) -- the publish wrapper does NOT duplicate this calculation. Includes retry logic (3 attempts, 2s delay) for transient payment errors. Returns `PublishEventResult`.

4. **AC-1.4 — Constants (`constants.ts`):** `packages/rig/tests/e2e/seed/lib/constants.ts` re-exports all docker-e2e-setup constants (`PEER1_RELAY_URL`, `PEER1_BTP_URL`, `PEER1_BLS_URL`, `TOKEN_ADDRESS`, `TOKEN_NETWORK_ADDRESS`, `ANVIL_RPC`, `CHAIN_ID`, Anvil account keys for #3/#4/#5). Single source of truth — never hardcode infrastructure addresses in seed scripts.

5. **AC-1.5 — Playwright Config:** `packages/rig/playwright.config.ts` updated with two projects: `legacy` (existing 6 specs, no globalSetup, `testDir: './tests/e2e'`, `testIgnore: '**/specs/**'`) and `rig-e2e` (new specs, `testDir: './tests/e2e/specs'`, `globalSetup: './tests/e2e/seed/seed-all.ts'`). The `seed-all.ts` globalSetup is a no-op stub in this story (full orchestrator implementation deferred to Story 10.9). Shared `webServer` starts `pnpm dev` at `http://localhost:5173` with 30s timeout. `reuseExistingServer: true`.

6. **AC-1.6 — Event Builders (`event-builders.ts`):** `packages/rig/tests/e2e/seed/lib/event-builders.ts` provides builders for:
   - kind:30617 (repo announcement) — `d`, `name`, `description` tags
   - kind:30618 (refs/state) — `d`, `r`, `HEAD`, `arweave` tags
   - kind:1621 (issue) — `a`, `subject`, `t`, content body
   - kind:1622 (comment) — `a` (repo ref), `e` (with root/reply marker), `p`, content body
   - kind:1617 (patch/PR) — `a`, `commit`, `parent-commit`, `subject`, branch tags
   - kind:1630-1633 (status) — `e`, `p` tags
   All builders return `UnsignedEvent` (caller signs with their keypair via `finalizeEvent()`). Correct NIP-34 tag structures validated by type constraints.

7. **AC-1.7 — Client Package Only:** All seed libs use `@toon-protocol/client` ToonClient — never SDK `createNode`. Import `encodeEventToToon`/`decodeEventFromToon` from `@toon-protocol/relay`.

## Tasks / Subtasks

- [x] Task 1: Set up file structure (AC: #all)
  - [x] 1.1: Create directory `packages/rig/tests/e2e/seed/lib/`
  - [x] 1.2: Create directory `packages/rig/tests/e2e/specs/` (empty, for future specs)
  - [x] 1.3: Add `seed/state.json` to `packages/rig/.gitignore`

- [x] Task 2: Implement `constants.ts` (AC: #4)
  - [x] 2.1: Re-export all constants from `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts`
  - [x] 2.2: Re-export `AGENT_IDENTITIES` from `socialverse-agent-harness.ts` (Alice/Bob/Carol Nostr keypairs + EVM keys for Anvil #3/#4/#5) — do NOT invent new keypairs
  - [x] 2.3: Add PEER1_PUBKEY constant (`d6bfe100d1600c0d8f769501676fc74c3809500bd131c8a549f88cf616c21f35`)
  - [x] 2.4: Derive `secretKey` (Uint8Array) from `AGENT_IDENTITIES[name].secretKeyHex` for each agent — Carol already exists in the harness (no need to generate)

- [x] Task 3: Implement `clients.ts` (AC: #1, #7)
  - [x] 3.1: Create `createSeedClients()` async factory returning `{ alice, bob, carol }` ToonClient instances
  - [x] 3.2: Each client uses: `btpUrl: PEER1_BTP_URL`, `secretKey`, `evmPrivateKey`, `ilpInfo: { pubkey, ilpAddress: 'g.toon.<pubkey8>', btpEndpoint: PEER1_BTP_URL }`, `toonEncoder: encodeEventToToon`, `toonDecoder: decodeEventFromToon`, `knownPeers: [{ pubkey: PEER1_PUBKEY, relayUrl: PEER1_RELAY_URL, btpEndpoint: PEER1_BTP_URL }]`, settlement config for Anvil chain (`supportedChains`, `tokenNetworks`, `preferredTokens`, `chainRpcUrls`, `initialDeposit`, `destinationAddress`)
  - [x] 3.3: Bootstrap clients sequentially (Alice, Bob, Carol) to avoid nonce races
  - [x] 3.4: Add `healthCheck()` polling `PEER1_BLS_URL/health` with 30s timeout before client creation
  - [x] 3.5: Export `stopAllClients()` cleanup function

- [x] Task 4: Implement `git-builder.ts` (AC: #2)
  - [x] 4.1: Port `createGitBlob()`, `createGitTree()`, `createGitCommit()` from `socialverse-agent-alice-git-push.ts`
  - [x] 4.2: Add `ShaToTxIdMap` type (`Record<string, string>`) and accumulation logic
  - [x] 4.3: Implement `uploadGitObject(client, objectBody, sha, type, repoId, shaMap)` — constructs kind:5094 event with `i` (base64 body), `bid`, `output`, `Git-SHA`, `Git-Type`, `Repo` tags; publishes via client; extracts Arweave txId from response `data` field (base64-decoded)
  - [x] 4.4: Add size validation (< 95KB) before upload
  - [x] 4.5: Skip upload if SHA already exists in `shaMap` (delta upload logic)
  - [x] 4.6: Return `{ sha, txId }` per object; update `shaMap` in-place
  - [x] 4.7: Implement `waitForArweaveIndex(txId, timeoutMs=30000)` with exponential backoff (100ms, 200ms, 400ms...) per R10-001 flakiness prevention

- [x] Task 5: Implement `event-builders.ts` (AC: #6)
  - [x] 5.1: `buildRepoAnnouncement(repoId, name, description)` -> `UnsignedEvent` kind:30617
  - [x] 5.2: `buildRepoRefs(repoId, refs, arweaveMap)` -> `UnsignedEvent` kind:30618
  - [x] 5.3: `buildIssue(repoOwnerPubkey, repoId, title, body, labels)` -> `UnsignedEvent` kind:1621
  - [x] 5.4: `buildComment(repoOwnerPubkey, repoId, issueOrPrEventId, authorPubkey, body, marker='reply')` -> `UnsignedEvent` kind:1622 (includes `a` tag for repo ref, `e` tag with root/reply marker)
  - [x] 5.5: `buildPatch(repoOwnerPubkey, repoId, title, commits, branchTag)` -> `UnsignedEvent` kind:1617
  - [x] 5.6: `buildStatus(targetEventId, statusKind)` -> `UnsignedEvent` kind:1630-1633
  - [x] 5.7: Use NIP-34 tag structures from `packages/core/src/nip34/types.ts` as reference

- [x] Task 6: Implement `publish.ts` (AC: #3)
  - [x] 6.1: `publishWithRetry(client, event, maxAttempts=3, delayMs=2000)` — wraps `client.publishEvent()` with retry on failure
  - [x] 6.2: Before publishing, obtain channelId from `client.getTrackedChannels()[0]` (populated during bootstrap), encode event to get byte length, compute amount (`BigInt(toonEncodedLength) * 10n`), then call `client.signBalanceProof(channelId, amount)` to get claim
  - [x] 6.3: Pass claim to `client.publishEvent(event, { claim })` — ToonClient internally recalculates the per-packet ILP amount, the claim provides the signed balance proof for BTP transport
  - [x] 6.4: Return `PublishEventResult` with success/error/eventId/data
  - [x] 6.5: Export `SeedPublishState` type tracking cumulative amount per client for monotonic claim signing

- [x] Task 7: Update Playwright config (AC: #5)
  - [x] 7.1: Refactor `playwright.config.ts` to two-project structure (`legacy` + `rig-e2e`)
  - [x] 7.2: `legacy` project: `testDir: './tests/e2e'`, `testMatch: '*.spec.ts'`, `testIgnore: '**/specs/**'`
  - [x] 7.3: `rig-e2e` project: `testDir: './tests/e2e/specs'`, `globalSetup: './tests/e2e/seed/seed-all.ts'`
  - [x] 7.4: Shared: `baseURL: 'http://localhost:5173'`, `timeout: 30000`, `headless: true`
  - [x] 7.5: `webServer.timeout` increased from 15s to 30s
  - [x] 7.6: Add `retries: process.env.CI ? 1 : 0`
  - [x] 7.7: Create stub `seed/seed-all.ts` that exports a no-op `globalSetup` (full implementation in Story 10.9)

- [x] Task 8: Create barrel export `index.ts` (AC: #all)
  - [x] 8.1: Create `packages/rig/tests/e2e/seed/lib/index.ts` re-exporting all public APIs from `clients.ts`, `constants.ts`, `event-builders.ts`, `git-builder.ts`, `publish.ts`

- [x] Task 9: Verify existing E2E specs still pass (AC: #5) — MUST run after Task 7
  - [x] 9.1: Run `pnpm test:seed` and `pnpm test` — all 48 seed tests pass, all 343 existing rig tests pass (401 total including skipped)
  - [x] 9.2: Verify no import resolution errors from new directory structure

## Prerequisites

- **SDK E2E infrastructure must be running:** `./scripts/sdk-e2e-infra.sh up` (Anvil + 2 Docker peers). All seed library code and verification tasks require Peer1 BLS, Relay, and BTP endpoints to be reachable.
- Pre-flight check: `curl http://localhost:19100/health` must return 200 before running any seed or test commands.

## Dev Notes

### Architecture Patterns

- **Three-layer test architecture:** This story builds Layer 1 (Seed Layer utilities). Stories 10.2-10.8 build the seed scripts. Story 10.9 builds the orchestrator. Stories 10.10-10.18 build the Playwright spec layer.
- **ToonClient, NOT SDK createNode:** The seed library MUST use `ToonClient` from `@toon-protocol/client`. The SDK `createNode()` is for service nodes, not lightweight test clients. This is a critical distinction (see MEMORY.md: "ToonClient vs SDK Usage").
- **Incremental delta uploads:** `git-builder.ts` tracks a `ShaToTxIdMap`. Each push script passes the accumulated map from prior pushes. Only objects with new SHAs are uploaded to Arweave. This keeps each push under 100KB free tier.

### Critical Implementation Details

**ToonClient Constructor Pattern (from `socialverse-agent-harness.ts`):**
```typescript
const client = new ToonClient({
  btpUrl: PEER1_BTP_URL,
  secretKey: aliceSecretKey,        // Uint8Array
  evmPrivateKey: ALICE_EVM_KEY,     // hex string with 0x prefix
  ilpInfo: {
    pubkey: alicePubkey,
    ilpAddress: `g.toon.${alicePubkey.slice(0, 8)}`,
    btpEndpoint: PEER1_BTP_URL,
  },
  toonEncoder: encodeEventToToon,
  toonDecoder: decodeEventFromToon,
  knownPeers: [{
    pubkey: PEER1_PUBKEY,
    relayUrl: PEER1_RELAY_URL,
    btpEndpoint: PEER1_BTP_URL,
  }],
  supportedChains: ['evm:base:31337'],
  tokenNetworks: { 'evm:base:31337': TOKEN_NETWORK_ADDRESS },
  preferredTokens: { 'evm:base:31337': TOKEN_ADDRESS },
  chainRpcUrls: { 'evm:base:31337': ANVIL_RPC },
  initialDeposit: '1000000',  // 1 USDC (6 decimals)
  destinationAddress: 'g.toon.peer1',
});
```

**Kind:5094 DVM Upload Pattern (from `socialverse-agent-alice-git-push.ts`):**
```typescript
// Event structure for git object upload
const event = finalizeEvent({
  kind: 5094,
  content: '',
  tags: [
    ['i', base64Data, 'blob'],
    ['bid', (BigInt(objectBody.length) * 10n).toString(), 'usdc'],
    ['output', 'application/octet-stream'],
    ['Git-SHA', gitSha],
    ['Git-Type', gitType],   // 'blob' | 'tree' | 'commit'
    ['Repo', repoId],
  ],
  created_at: Math.floor(Date.now() / 1000),
}, secretKey);

// Arweave txId extracted from response
const result = await client.publishEvent(event, { claim });
const arweaveTxId = result.data
  ? Buffer.from(result.data, 'base64').toString('utf-8')
  : undefined;
```

**Git Object SHA Computation (critical: upload body, not envelope):**
```typescript
// SHA computed over FULL envelope: `blob <size>\0<content>`
const fullObject = Buffer.concat([header, contentBuf]);
const sha = createHash('sha1').update(fullObject).digest('hex');
// Upload only the BODY (content after \0) — matches `git cat-file <type>` output
return { sha, buffer: fullObject, body: contentBuf };
```

**Tree entry SHA is raw 20-byte binary (NOT hex):**
```typescript
const rawSha = Buffer.from(entry.sha, 'hex'); // 20 bytes, not 40-char hex
```

### Anvil Account Keys (Pre-funded with 10K ETH each)

| Agent | Anvil Account | EVM Private Key | EVM Address |
|-------|--------------|----------------|-------------|
| Alice | #3 | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| Bob | #4 | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| Carol | #5 | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |

Nostr keypairs are pre-generated and fixed (not randomly generated per run) so that event IDs and pubkeys are deterministic across test runs. All three identities (Alice/Bob/Carol) already exist in `socialverse-agent-harness.ts` `AGENT_IDENTITIES` -- reuse them directly.

### File Structure (This Story Creates)

```
packages/rig/tests/e2e/
  seed/
    seed-all.ts              # Stub globalSetup (full impl in 10.9)
    lib/
      index.ts               # Barrel re-export for clean imports
      clients.ts             # 3 ToonClient instances (Alice, Bob, Carol)
      constants.ts           # Re-export docker-e2e-setup constants + AGENT_IDENTITIES
      event-builders.ts      # NIP-34 event kind builders
      git-builder.ts         # Git object construction + SHA-to-txId tracking + waitForArweaveIndex
      publish.ts             # publishEvent + ILP claim wrapper with retry + cumulative state
  specs/                     # Empty dir (specs added in Stories 10.10-10.18)
```

### Existing Code to Reuse (Do NOT Reinvent)

| What | Where | How to Use |
|------|-------|-----------|
| Docker E2E constants | `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` | Re-export in `constants.ts` |
| `checkAllServicesReady()` | `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` | Import in `clients.ts` for health check |
| `waitForServiceHealth()` | `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` | Import in `clients.ts` |
| Git object construction | `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` | Port `createGitBlob`, `createGitTree`, `createGitCommit` to `git-builder.ts` |
| Kind:5094 upload pattern | `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` | Port `uploadGitObject` pattern to `git-builder.ts` |
| NIP-34 event types | `packages/core/src/nip34/types.ts` | Reference for event builder tag structures |
| NIP-34 kind constants | `packages/core/src/nip34/constants.ts` | Import `REPOSITORY_ANNOUNCEMENT_KIND`, `ISSUE_KIND`, etc. |
| Agent identities (MUST reuse) | `packages/client/tests/e2e/socialverse-agent-harness.ts` | Import `AGENT_IDENTITIES` for Alice/Bob/Carol keypairs — do NOT generate new ones |
| TOON encoding | `@toon-protocol/relay` | `encodeEventToToon`, `decodeEventFromToon` |
| Event signing | `nostr-tools/pure` | `finalizeEvent()`, `generateSecretKey()`, `getPublicKey()` |

### Flakiness Prevention (from Test Design)

- **R10-001:** `git-builder.ts` should include `waitForArweaveIndex(txId, timeoutMs=30000)` retry helper (exponential backoff: 100ms, 200ms, 400ms...).
- **R10-002:** Bootstrap clients sequentially (Alice first, then Bob, then Carol) with explicit waits between each.
- **R10-005:** Validate each git object size < 95KB before upload (5KB safety margin from 100KB free tier).
- **R10-009:** Forge-UI components will need `data-testid` attributes added in future stories; this story does NOT modify Forge-UI source.

### Package Dependencies

The `@toon-protocol/client` and `@toon-protocol/relay` packages must be available. Since this is a monorepo, they resolve via workspace protocol. No new npm dependencies needed — `@playwright/test` is already in `packages/rig/devDependencies`.

The seed library imports from `@toon-protocol/client`, `@toon-protocol/relay`, `@toon-protocol/core` (for NIP-34 constants), and `nostr-tools/pure`. These are all available in the monorepo workspace.

### Project Structure Notes

- All new files go under `packages/rig/tests/e2e/seed/` — this is the seed layer of the three-layer test architecture.
- New Playwright specs directory: `packages/rig/tests/e2e/specs/` (empty for now).
- Playwright config at `packages/rig/playwright.config.ts` is modified (not replaced).
- No changes to `packages/rig/src/` (Forge-UI source) in this story.

### References

- [Source: `_bmad-output/epics/epic-10-rig-e2e-integration-tests.md` - Story 10.1 AC details]
- [Source: `_bmad-output/planning-artifacts/test-design-epic-10.md` - Risk mitigations R10-001 through R10-012]
- [Source: `packages/sdk/tests/e2e/helpers/docker-e2e-setup.ts` - Docker E2E infrastructure constants and helpers]
- [Source: `packages/client/tests/e2e/socialverse-agent-alice-git-push.ts` - Git object construction and kind:5094 upload patterns]
- [Source: `packages/client/tests/e2e/socialverse-agent-harness.ts` - ToonClient bootstrap pattern and agent identities]
- [Source: `packages/core/src/nip34/types.ts` - NIP-34 event type definitions and tag structures]
- [Source: `packages/core/src/nip34/constants.ts` - NIP-34 kind constants]
- [Source: `packages/client/src/types.ts` - ToonClientConfig interface]
- [Source: `packages/rig/playwright.config.ts` - Existing Playwright config to modify]
- [Source: `_bmad-output/auto-bmad-artifacts/epic-10-start-report.md` - Baseline: 4,127 tests, all green]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed SHA-1 test expectation: ATDD test had wrong expected hash for "hello world\n" blob (was `a042...`, corrected to `3b18...` matching `git hash-object --stdin`)
- Fixed `@toon-protocol/client/types` import path: client package has no `exports` field, so subpath imports fail; switched to importing `SignedBalanceProof` and `PublishEventResult` from main `@toon-protocol/client` entry
- Added `@toon-protocol/client`, `@toon-protocol/relay`, `@toon-protocol/core` as devDependencies to rig package.json (seed libs import from these workspace packages; Vite cannot resolve them without explicit dep declarations)
- Fixed lint error: unused `gitBuilder` variable in delta-upload test renamed to `_gitBuilder`

### Completion Notes List
- **Task 1**: Directories `seed/lib/` and `specs/` already existed (created by ATDD setup). Added `.gitignore` with `tests/e2e/seed/state.json` entry.
- **Task 2**: `constants.ts` re-exports 7 infra constants from docker-e2e-setup + AGENT_IDENTITIES from socialverse harness + PEER1_PUBKEY. All 7 tests pass.
- **Task 3**: `clients.ts` implements `createSeedClients()` factory with sequential bootstrap, `healthCheck()` polling, and `stopAllClients()` cleanup. Uses ToonClient (not SDK createNode). 4 structural tests pass; 3 infra-dependent tests appropriately skipped.
- **Task 4**: `git-builder.ts` ports all three git object constructors, adds `ShaToTxIdMap`, `uploadGitObject()` with 95KB size validation and delta skip, `waitForArweaveIndex()` with exponential backoff. All 12 tests pass.
- **Task 5**: `event-builders.ts` provides 6 builders (kind:30617, 30618, 1621, 1622, 1617, 1630-1633) returning UnsignedEvent. All 8 tests pass.
- **Task 6**: `publish.ts` implements `publishWithRetry()` with channelId lookup, balance proof signing, and 3-attempt retry. Exports `SeedPublishState` type and `createPublishState()` factory. All 7 tests pass.
- **Task 7**: Playwright config refactored to two-project structure (legacy + rig-e2e). WebServer timeout 30s. CI retries. Stub `seed-all.ts` created. All 6 config tests pass.
- **Task 8**: Barrel `index.ts` re-exports all public APIs. All 4 barrel tests pass.
- **Task 9**: All 48 seed tests pass. All 343 existing rig unit tests pass (401 total). 0 lint errors. No regressions.

### File List
- `packages/rig/tests/e2e/seed/lib/constants.ts` (created)
- `packages/rig/tests/e2e/seed/lib/clients.ts` (created)
- `packages/rig/tests/e2e/seed/lib/git-builder.ts` (created)
- `packages/rig/tests/e2e/seed/lib/event-builders.ts` (created)
- `packages/rig/tests/e2e/seed/lib/publish.ts` (created)
- `packages/rig/tests/e2e/seed/lib/index.ts` (created)
- `packages/rig/tests/e2e/seed/seed-all.ts` (created)
- `packages/rig/playwright.config.ts` (modified)
- `packages/rig/package.json` (modified — added devDependencies)
- `packages/rig/.gitignore` (created)
- `packages/rig/tests/e2e/seed/__tests__/constants.test.ts` (modified — enabled tests)
- `packages/rig/tests/e2e/seed/__tests__/clients.test.ts` (modified — enabled structural tests, kept infra tests skipped)
- `packages/rig/tests/e2e/seed/__tests__/git-builder.test.ts` (modified — enabled tests, fixed SHA expectation, fixed lint)
- `packages/rig/tests/e2e/seed/__tests__/event-builders.test.ts` (modified — enabled tests)
- `packages/rig/tests/e2e/seed/__tests__/publish.test.ts` (modified — enabled tests)
- `packages/rig/tests/e2e/seed/__tests__/barrel-exports.test.ts` (modified — enabled tests)
- `packages/rig/tests/e2e/seed/__tests__/playwright-config.test.ts` (modified — enabled tests)
- `packages/rig/vitest.seed.config.ts` (created — vitest config for seed test suite)
- `pnpm-lock.yaml` (modified — dependency resolution)

### Change Log
- **2026-03-29**: Story 10.1 implemented — Playwright E2E infrastructure and shared seed utility library for the Rig. Created 7 source files (constants, clients, git-builder, event-builders, publish, barrel index, seed-all stub). Updated Playwright config to two-project structure. Added workspace devDependencies. All 48 seed tests pass, 343 existing tests pass, 0 lint errors.
- **2026-03-29**: Code review (adversarial) — 6 issues found and fixed. (1) Fixed git tree sort: replaced locale-aware `localeCompare` with byte-wise comparison for correct git tree ordering. (2) Added optional `targetPubkey` param to `buildStatus()` for NIP-34 `p` tag compliance; narrowed type from `number` to `1630|1631|1632|1633`. (3) Extracted hardcoded `'g.toon.peer1'` to `PEER1_DESTINATION` constant in `constants.ts`, updated `clients.ts`, `git-builder.ts`, `publish.ts`. (4) Added missing `vitest.seed.config.ts` to File List. (5) Added 3 new tests covering `p` tag and `PEER1_DESTINATION`. All 69 seed tests pass (66+3 new), 343 existing tests pass, 0 regressions.
- **2026-03-29**: Code review #2 (adversarial) — 0 critical, 0 high, 2 medium, 2 low (4 total). (1) Removed redundant `res.ok || res.status === 200` check in `waitForArweaveIndex`. (2) Added idempotency warning comment to `publishWithRetry` retry logic. (3) Fixed story Dev Notes chain identifier from `evm:anvil:31337` to `evm:base:31337` matching actual code. (4) Added `PublishEventResult` type re-export from barrel. All 69 seed tests pass, 343 existing tests pass, 0 regressions.
- **2026-03-29**: Code review #3 (adversarial + security/OWASP) — 0 critical, 0 high, 1 medium, 2 low (3 total). (1) Fixed ILP address segment from `g.toon.<pubkey8>` to `g.toon.agent.<pubkey8>` matching all existing codebase usage in socialverse-agent-harness.ts. (2) Added client leak prevention: `createSeedClients()` now stops previously active clients before creating new ones. (3) Added txId format validation in `waitForArweaveIndex()` to prevent fetching bare gateway URL. Semgrep security scan: 0 OWASP findings, 0 injection risks, 0 auth flaws. SHA-1 usage confirmed git-only (not security). All 71 seed tests pass (68+3 skipped), 343 existing tests pass, 0 regressions, 0 lint errors.

## Code Review Record

### Review #1 — 2026-03-29
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Review type:** Adversarial code review
- **Issues found:** 0 critical, 0 high, 3 medium, 3 low (6 total)
- **Medium issues:**
  1. Git tree sort used locale-aware `localeCompare` instead of byte-wise comparison — fixed to byte-wise sort
  2. `buildStatus()` missing `p` tag for NIP-34 compliance and type too broad (`number`) — added optional `targetPubkey` param, narrowed type to `1630|1631|1632|1633`
  3. Missing `vitest.seed.config.ts` in File List — added to Dev Agent Record File List
- **Low issues:**
  1. Hardcoded `'g.toon.peer1'` destination string — extracted to `PEER1_DESTINATION` constant in `constants.ts`
  2. `PEER1_DESTINATION` constant not used in `clients.ts`, `git-builder.ts`, `publish.ts` — updated all references
  3. No test coverage for `p` tag and `PEER1_DESTINATION` — added 3 new tests
- **Tests after fixes:** 69 seed tests pass (66 existing + 3 new), 343 existing rig tests pass, 0 regressions, 0 lint errors
- **Outcome:** All issues fixed, review passed

### Review #2 — 2026-03-29
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Review type:** Adversarial code review
- **Issues found:** 0 critical, 0 high, 2 medium, 2 low (4 total)
- **Medium issues:**
  1. `waitForArweaveIndex` had redundant `res.ok || res.status === 200` check — `res.ok` already covers 200-299 range; simplified to `res.ok`
  2. Story Dev Notes documented chain identifier as `evm:anvil:31337` but code correctly uses `evm:base:31337` (matching `socialverse-agent-harness.ts`) — fixed story documentation
- **Low issues:**
  1. `publishWithRetry` re-signs balance proof on each retry without documenting idempotency risk — added WARNING comment about nonce/amount burn on retry
  2. `PublishEventResult` return type not re-exported from barrel — downstream seed scripts would need separate import from `@toon-protocol/client`; added re-export to `publish.ts` and `index.ts`
- **Tests after fixes:** 69 seed tests pass (66 existing + 0 new), 343 existing rig tests pass, 0 regressions
- **Outcome:** All issues fixed, review passed

### Review #3 — 2026-03-29
- **Reviewer model:** Claude Opus 4.6 (1M context)
- **Review type:** Adversarial code review + Security/OWASP scan
- **Security scan:** Semgrep static analysis on all 8 implementation files — 0 OWASP top 10 findings, 0 injection risks, 0 authentication/authorization flaws. SHA-1 usage confirmed as git-compatibility only (not used for security). Secret key parameter handling reviewed — no logging or leakage paths found.
- **Issues found:** 0 critical, 0 high, 1 medium, 2 low (3 total)
- **Medium issues:**
  1. ILP address segment mismatch: `clients.ts` used `g.toon.<pubkey8>` but every existing usage in the codebase (`socialverse-agent-harness.ts`, `socialverse-e2e.ts`, `socialverse-swarm.ts`) uses `g.toon.agent.<pubkey8>` — fixed to `g.toon.agent.<pubkey8>` and updated test assertion
- **Low issues:**
  1. `createSeedClients()` silently leaked previously created clients when called a second time without `stopAllClients()` — added leak prevention that auto-stops prior clients, added test verifying the guard
  2. `waitForArweaveIndex()` accepted empty or very short txId strings, which would fetch the bare Arweave gateway URL — added input validation guard, added test verifying the throw
- **Tests after fixes:** 68 seed tests pass (66 existing + 2 new) + 3 skipped = 71 total, 343 existing rig tests pass, 0 regressions, 0 lint errors
- **Outcome:** All issues fixed, review passed
