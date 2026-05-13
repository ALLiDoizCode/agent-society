# Story 47.1: SDK `getEarnings()` Wrap + Contract Canary

Status: done

> **First story of Epic 47 (Earnings Data Plane) — the critical-path foundation that 47.2 (aggregator surgery), 47.3 (snapshot writer), 47.4 (host-API endpoint), and 47.5 (live gate) all depend on.** Sized S–M. No upstream dependencies in Epic 47; depends on Epic 46 only insofar as the connector v3.6.2 shipped for that epic already exposes `GET /admin/earnings.json` (AdminEarningsJsonResponse, served since connector v3.2.0). This story does not ship operator-facing code by default — it ships type definitions, one new method on `ConnectorAdminClient`, two canary tests (a stub canary and a real-image canary extension), and one migration-doc entry. The aggregator wired in 47.2 is the first consumer of the `getEarnings()` method this story adds; until 47.2 lands, the new code is dead-but-tested. Epic 47 cannot start any other story until this one is `done` because every downstream story imports `EarningsResponse` and calls `connectorAdmin.getEarnings()`.

## Story

As a **townhouse engineer**,
I want the SDK's `ConnectorAdminClient` to expose `getEarnings()` with type-safe contract assertions,
so that the aggregator and telemetry layers consume real connector data instead of packet-count proxies AND any future connector-version drift fails the canary loudly.

## Acceptance Criteria

1. **Given** the connector v3.3.3+ exposes `GET /admin/earnings.json`
   **When** the new types are added at `packages/townhouse/src/connector/types.ts`
   **Then** the file declares **6 interfaces re-declared (NOT re-exported from `@toon-protocol/connector`)**: `EarningsResponse`, `PeerEarnings`, `AssetEarnings`, `ConnectorFeeEntry`, `RecentClaim`, `EarningsTimestamp`.

2. **Given** the type definitions exist
   **When** `ConnectorAdminClient` is extended at `packages/townhouse/src/connector/admin-client.ts`
   **Then** a new method `async getEarnings(): Promise<EarningsResponse>` exists, mirroring the `getMetrics()` pattern (path-validation, body-shape validation, AbortController-protected timeout, structured error messages).

3. **Given** the canary at `packages/townhouse/src/connector/contract-canary.test.ts`
   **When** the canary runs
   **Then** it asserts at minimum: `uptimeSeconds: number`, `peers[].byAsset[].claimsReceivedTotal: string`, `connectorFees[].assetCode: string`, `recentClaims` is an array
   **And** the canary fails if any asserted field shape drifts (path drift, type drift, presence drift).

4. **Given** the image-contract test at `packages/townhouse/src/__integration__/connector-image-contract.test.ts`
   **When** the test boots a real connector container
   **Then** the test runs against the digest pinned in source (NOT `:latest`) AND probes `/admin/earnings.json` for the asserted shape via `ConnectorAdminClient.getEarnings()`.

5. **Given** the migration-history file `packages/sdk/CONNECTOR_MIGRATION.md`
   **When** this story merges
   **Then** a new entry documents the v3.3.3 earnings contract — added to the "Townhouse-Side Contract" → "Seam 1 — Admin HTTP API" table AND a new method-detail row, mirroring the existing `getPacketLog` documentation pattern.

**FRs:** FR15 (epic).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read modified files end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/connector/types.ts` end-to-end (~222 lines). This is the **template** for the new interfaces — they live alongside `HealthResponse`, `MetricsResponse`, `PeerStatus`, `PacketLogEntry`. Confirm the file's pattern: each exported interface has a JSDoc that names the connector-side source-of-truth (e.g., `// Mirrors AdminMetricsJsonResponse from @toon-protocol/connector packages/connector/src/http/types.ts`). The new earnings interfaces MUST follow the same JSDoc-citation discipline.
  - [x] 1.2 Read `packages/townhouse/src/connector/admin-client.ts` end-to-end (~473 lines). The `getMetrics()` method (lines 191–217) is the closest precedent for `getEarnings()` — it returns a typed body, validates the response shape with explicit type guards, throws structured errors (`'Connector admin API: invalid metrics response shape'`). Use the same style: timeout-protected `fetch`, body-read-inside-try (so AbortError covers slow body reads), explicit `typeof` checks per field, throw on shape drift. **Do NOT use the private `fetch()` helper for `getEarnings()` if the spec needs special-case handling**; otherwise re-using `this.fetch('/admin/earnings.json')` keeps the code minimal (mirror `getMetrics`).
  - [x] 1.3 Read `packages/townhouse/src/connector/contract-canary.test.ts` end-to-end (~497 lines). Confirm the helper functions: `mockFetchAt(expectedPath, body, status)` binds path + body + status into a `vi.fn()` `fetch` stub and asserts the URL ends with `expectedPath`. The new earnings canary MUST use the same helper. The const-body pattern (e.g., `HEALTHY_BODY`, `METRICS_BODY`) is the convention — define an `EARNINGS_BODY` const at module scope and reuse across tests. Each describe block uses `afterEach(() => vi.unstubAllGlobals())`.
  - [x] 1.4 Read `packages/townhouse/src/__integration__/connector-image-contract.test.ts` end-to-end (~349 lines). Critical sections: lines 75–98 (manifest-alignment guard — DO NOT MODIFY), lines 116–272 (suite scaffolding: pulls image, writes minimal `config.yaml`, starts container with port bindings, polls `/health`). The new earnings test MUST live inside the existing `describe.skipIf(isTruthyEnv(...))` block so it shares `beforeAll` (image pull + container boot) — DO NOT spawn a second container. Add ONE new `it(...)` block alongside the existing 3 (`getHealth`, `getPeers`, `getMetrics`).
  - [x] 1.5 Read `packages/sdk/CONNECTOR_MIGRATION.md` lines 111–170 ("Townhouse-Side Contract" → "Seam 1 — Admin HTTP API"). The table at line 133–138 is the registry of methods the client exposes. The new earnings entry slots in alphabetically (after `getHealth` if alphabetical, OR at the end if chronological — match the file's existing ordering).
  - [x] 1.6 Read the connector source-of-truth for the response shape: `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts` lines 261–304 (interface declarations). Note the connector ships **5 named interfaces** (`AdminEarningsByAsset`, `AdminEarningsJsonPeer`, `AdminEarningsConnectorFee`, `AdminEarningsRecentClaim`, `AdminEarningsJsonResponse`) — the AC requires **6** Townhouse-side interfaces because it includes a separate `EarningsTimestamp`. See "Open Question" in Dev Notes for resolution guidance.
  - [x] 1.7 Read the connector earnings handler: `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts` lines 1865–1945 (route handler). Confirm: 503 is returned when `accountManager` or `claimReceiver` are missing from `AdminAPIConfig`. The minimal connector container booted by the existing image-contract test (see `connector-image-contract.test.ts:163–190`) uses `peers: []` config — verify whether this still wires `accountManager` / `claimReceiver` (it likely does, but if `/admin/earnings.json` returns 503 in the test, see "Edge Case A" in Dev Notes).
  - [x] 1.8 Read `packages/townhouse/src/connector/index.ts` (26 lines) — the module's public exports. The new types MUST be re-exported here so downstream consumers (`packages/townhouse/src/earnings/aggregator.ts` in 47.2) can import them via the package barrel rather than the deep path.

- [x] **Task 2: Verify pre-conditions before drafting (AC: all)**
  - [x] 2.1 Confirm the connector source is checked out at `../connector` (sibling to this repo). The handler reference in Task 1.6/1.7 lives there. If the sibling is missing, `git clone https://github.com/ALLiDoizCode/connector ../connector`.
  - [x] 2.2 Confirm the connector pin in `packages/townhouse/src/constants.ts:26-27` (`DEFAULT_CONNECTOR_IMAGE`) currently points at digest `sha256:4a24ccb…` (v3.4.1 era). Both v3.4.1 and v3.6.2 expose `/admin/earnings.json` (added v3.2.0 per `2c47d51`), so AC #4's image-contract test will work at the CURRENT pin without bumping it. **Do NOT bump `DEFAULT_CONNECTOR_IMAGE` in this story** — that's tracked under Epic 46 retro Action Item A2' (Cross-Repo Connector Pin Source-of-Truth) and is a separate structural change. If the dev wants to bump locally for verification, do so in a throwaway branch.
  - [x] 2.3 Confirm the local `dist/image-manifest.json` (currently rc6 → v3.6.2 → `sha256:815cef14…`) does NOT match the source-pinned digest from 2.2. This drift will cause the manifest-alignment guard at `connector-image-contract.test.ts:87-97` to fail IF the manifest exists. The dev does not need to resolve this — the guard is `it.skipIf(!manifestExists)` and `dist/image-manifest.json` is gitignored. CI behavior is governed by the manifest-download step in the publish workflow. **Do NOT modify the alignment guard** — that's the diagnostic the canary uses to catch source-vs-manifest drift; muting it would defeat the test.
  - [x] 2.4 Confirm Docker daemon is reachable: `docker ps > /dev/null && echo ok`. Without it, the image-contract test in AC #4 cannot run, but the stub canary in AC #3 still runs.
  - [x] 2.5 Confirm `pnpm --filter @toon-protocol/townhouse build` succeeds before opening the PR (no pre-existing typecheck errors related to types.ts or admin-client.ts).

- [x] **Task 3: Add the 6 earnings interfaces to `types.ts` (AC: 1)**
  - [x] 3.1 Append a new comment-banner section at the bottom of `packages/townhouse/src/connector/types.ts` mirroring the existing `// ── Admin API response types ──` block at line 107. Section header: `// ── Earnings response types (connector v3.3.3+) ──` with a JSDoc explaining: source-of-truth path (`@toon-protocol/connector packages/connector/src/http/admin-api.ts:261-304`), why these are re-declared (NOT re-exported — the connector package does not export `AdminEarnings*` types from its public `lib.ts`; `packages/connector/src/lib.ts` exports settlement/channel/payment types only — verified 2026-05-12), and the canary expectation.
  - [x] 3.2 Declare `interface AssetEarnings` mirroring `AdminEarningsByAsset` from connector source: `assetCode: string`, `assetScale: number`, `claimsReceivedTotal: string`, `claimsSentTotal: string`, `netBalance: string`, `lastClaimAt: string | null`. JSDoc cites the connector source location AND notes: amounts are decimal-string bigints (JSON-safe at any asset scale).
  - [x] 3.3 Declare `interface PeerEarnings` mirroring `AdminEarningsJsonPeer`: `peerId: string`, `byAsset: AssetEarnings[]`. JSDoc cites source location.
  - [x] 3.4 Declare `interface ConnectorFeeEntry` mirroring `AdminEarningsConnectorFee`: `assetCode: string`, `assetScale: number`, `total: string`. JSDoc cites source location.
  - [x] 3.5 Declare `interface RecentClaim` mirroring `AdminEarningsRecentClaim`: `peerId: string`, `assetCode: string`, `assetScale: number`, `amount: string`, `direction: 'inbound' | 'outbound'`, `at: string`. JSDoc cites source location.
  - [x] 3.6 Declare `interface EarningsTimestamp` — see "Open Question" in Dev Notes for the recommended resolution. Default recommendation: `interface EarningsTimestamp { iso: string }` with a JSDoc noting it wraps the connector's `timestamp` wire field as a typed value object. The runtime adapter in `getEarnings()` (Task 4) wraps the raw string into `{ iso: <string> }`. **If the dev disagrees with this interpretation, raise the question with PM (Alice) BEFORE merging — do not silently degrade to `type EarningsTimestamp = string` (the AC explicitly says "interface").**
  - [x] 3.7 Declare `interface EarningsResponse` mirroring `AdminEarningsJsonResponse`: `uptimeSeconds: number`, `peers: PeerEarnings[]`, `connectorFees: ConnectorFeeEntry[]`, `recentClaims: RecentClaim[]`, `timestamp: EarningsTimestamp`. **Note:** the wire shape from the connector is `timestamp: string`, but the Townhouse-side type uses `EarningsTimestamp` per AC #1. The runtime adapter in `getEarnings()` performs the wrap. JSDoc cites source location AND notes the wrap.
  - [x] 3.8 Update `packages/townhouse/src/connector/index.ts` to re-export all 6 new interfaces alongside the existing exports. Sort them alphabetically into the existing `export type {…}` block (between `MetricsResponse` and `PeerEntry` etc., per existing alphabetical-ish ordering).

- [x] **Task 4: Add `getEarnings()` to `ConnectorAdminClient` (AC: 2)**
  - [x] 4.1 Add the new method to `packages/townhouse/src/connector/admin-client.ts` immediately after `getMetrics()` (i.e., between lines 217 and 219). Method signature: `async getEarnings(): Promise<EarningsResponse>`. Path: `/admin/earnings.json`. JSDoc: cite the connector source-of-truth path, mention the v3.3.3+ connector version requirement, document the 503-when-disabled behavior (see Edge Case A in Dev Notes), document throws on shape drift.
  - [x] 4.2 Implementation pattern: re-use the private `this.fetch('/admin/earnings.json')` helper (mirrors `getMetrics()`'s `await this.fetch('/admin/metrics.json')`). The helper handles AbortController-based timeout, ECONNREFUSED, and non-2xx responses with a structured error.
  - [x] 4.3 Body validation: explicit type guards on every required field. Pattern (mirror `getMetrics()` lines 194–216).
  - [x] 4.4 Adapt the wire-shape `timestamp: string` into the Townhouse-side `EarningsTimestamp` type-shape: `timestamp: { iso: obj['timestamp'] as string }`.
  - [x] 4.5 Import `EarningsResponse` (and `EarningsTimestamp` if needed for the adapter's intermediate cast) at the top of `admin-client.ts` alongside the existing type imports (line 21–30).

- [x] **Task 5: Add stub canary entries for `getEarnings()` (AC: 3)**
  - [x] 5.1 In `packages/townhouse/src/connector/contract-canary.test.ts`, add a new const at module scope (after `PEERS_BODY` at line 89–101) named `EARNINGS_BODY`. Shape:
    ```typescript
    const EARNINGS_BODY = {
      uptimeSeconds: 60,
      peers: [
        {
          peerId: 'town',
          byAsset: [
            {
              assetCode: 'USD',
              assetScale: 6,
              claimsReceivedTotal: '1000000',
              claimsSentTotal: '0',
              netBalance: '1000000',
              lastClaimAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      ],
      connectorFees: [
        { assetCode: 'USD', assetScale: 6, total: '1000' },
      ],
      recentClaims: [
        {
          peerId: 'town',
          assetCode: 'USD',
          assetScale: 6,
          amount: '500000',
          direction: 'inbound' as const,
          at: '2026-05-12T00:00:00.000Z',
        },
      ],
      timestamp: '2026-05-12T00:00:00.000Z',
    };
    ```
  - [x] 5.2 Add a new `describe('getEarnings() shape contract', () => {…})` block. Mirror the existing `getMetrics()` describe block's structure (`afterEach(() => vi.unstubAllGlobals())` at top). 8 tests: happy-path (with all 4 AC-named assertions embedded), 5 shape-drift, 1 empty-arrays, 1 timestamp-wrap.
  - [x] 5.3 Total new test count in this describe block: 8 tests. Suite grew from 31 → 39 tests (exactly 8 added). Verified.
  - [x] 5.4 Verify the canary still passes in <500ms (per the file header comment): `pnpm --filter @toon-protocol/townhouse test contract-canary`. Result: 39 tests, 44ms. ✓

- [x] **Task 6: Extend the image-contract test for `/admin/earnings.json` (AC: 4)**
  - [x] 6.1 Added ONE new `it(...)` block after the `getMetrics()` test.
  - [x] 6.2 Used existing `adminClient`. Asserts uptimeSeconds, peers/connectorFees/recentClaims arrays, timestamp.iso.
  - [x] 6.3 Per-test timeout: `10_000` matching `getMetrics`.
  - [x] 6.4 **Edge Case A — Path B chosen.** Connector source analysis confirmed that the minimal config (`peers: []`, no settlement chainProviders) does NOT wire `accountManager`/`claimReceiver` (requires full EVM config). Path B implemented: test catches 503 and early-returns (endpoint exists, subsystem off). Real-image canary confirms: 4 tests passed, earnings test completes successfully via Path B.
  - [x] 6.5 No second container spawned; reuses `beforeAll`.
  - [x] 6.6 `pnpm --filter @toon-protocol/townhouse test:canary` — 4 passed, 2 skipped, ~2s warm-cache. ✓

- [x] **Task 7: Update `CONNECTOR_MIGRATION.md` with v3.3.3 earnings contract entry (AC: 5)**
  - [x] 7.1 Added `getEarnings()` row to the Seam 1 table (alphabetically first).
  - [x] 7.2 Added note after the table describing 503 behavior (accountManager/claimReceiver missing → 503).
  - [x] 7.3 Added "connector v3.3.3+ (story 47.1)" migration-steps section.
  - [x] 7.4 Header unchanged — earnings endpoint available since v3.2.0, no floor change needed.

- [x] **Task 8: Verify, lint, and prepare for code review (AC: all)**
  - [x] 8.1 `pnpm --filter @toon-protocol/townhouse build` — clean. ✓
  - [x] 8.2 `pnpm --filter @toon-protocol/townhouse test` — 963 tests, 62 files, 0 failures. Grew by exactly 8 tests in `contract-canary.test.ts`. ✓
  - [x] 8.3 `pnpm --filter @toon-protocol/townhouse test contract-canary` — 39 tests, 44ms. ✓
  - [x] 8.4 `pnpm --filter @toon-protocol/townhouse test:canary` — 4 passed, 2 skipped (manifest-alignment drift pre-existing; negative canary opt-in). All 4 real-image tests pass (including getEarnings via Path B). ~2s warm-cache. ✓
  - [x] 8.5 `pnpm eslint` on townhouse — no new warnings or errors. ✓
  - [x] 8.6 SDK connector-contract canary — 13 tests, 51ms, unaffected. ✓
  - [x] 8.7 Sprint status updated to `review`.
  - [x] 8.8 Review Findings populated below.

## Dev Notes

### Story Mission — Type-Level Foundation, No Operator Surface

This is a **foundation** story for Epic 47. The aggregator (47.2), snapshot writer (47.3), host-API endpoint (47.4), and live gate (47.5) all consume the `getEarnings()` method this story adds. Until 47.2 lands, the new code is **dead code** — it compiles, it's tested, but no production caller invokes it. This is intentional: keeping the type/method/canary in a separate PR ensures the contract is locked-in BEFORE any consumer has a chance to silently couple to the wrong shape.

**Hard rules** for this story:

1. **Six interfaces, exactly.** AC #1 says 6, the connector source has 5. The 6th (`EarningsTimestamp`) is a Townhouse-side wrap interface — see Open Question below.
2. **Re-declared, NOT re-exported.** The connector package's `lib.ts` does not export `AdminEarnings*` types from its public surface (verified 2026-05-12 against `/home/jonathan/Documents/connector/packages/connector/src/lib.ts:32-94`). Townhouse declares its own copies; they happen to mirror the connector wire shape. This is the same pattern as `MetricsResponse`, `PeersResponse`, `HealthResponse`.
3. **No bump of `DEFAULT_CONNECTOR_IMAGE` in this story.** The structural fix to put the connector pin behind a single source of truth is Epic 46 retro Action Item A2' — owned by Winston (architect) + Jonathan (publish workflow). Leave that for a separate PR.
4. **No production-source changes outside `connector/types.ts`, `connector/admin-client.ts`, `connector/index.ts`.** The aggregator and snapshot writer come in 47.2 and 47.3; do not edit `packages/townhouse/src/earnings/` in this story.
5. **No skip gates on the new tests.** Both the stub canary and the image-contract canary already have established skip gates (none for the stub canary — it's pure mocks; `SKIP_DOCKER` for the image-contract canary). The new earnings tests inherit those gates by living in the same files. Do NOT add fresh skip gates.

### Open Question — `EarningsTimestamp` Interpretation

AC #1 lists 6 interfaces but the connector source has 5. The 6th, `EarningsTimestamp`, has no direct counterpart in `@toon-protocol/connector` (the wire field is `timestamp: string`).

**Three possible interpretations, ranked by recommendation:**

1. **(Recommended)** `EarningsTimestamp` wraps the `string` as a value-object: `interface EarningsTimestamp { iso: string }`. The runtime `getEarnings()` adapter wraps the wire field on the way out. Pros: satisfies AC ("interface"), gives the dashboard a typed handle, allows future extension (`epoch?`, `timezone?`) without breaking callers. Cons: small adapter surface in `getEarnings()`.
2. `type EarningsTimestamp = string`. Pros: minimal. Cons: violates AC ("interface", not "type alias"). Reject.
3. Push back to PM (Alice): "the connector ships 5 interfaces; can we go with 5 to mirror the wire?" — defensible but contradicts the explicit AC.

**Default action:** dev implements (1). If the dev disagrees, escalate to Alice BEFORE merging. Do NOT silently degrade to (2).

### Edge Case A — `accountManager` / `claimReceiver` 503

The connector's `/admin/earnings.json` route returns 503 with `{ error: "Service Unavailable", message: "Earnings subsystem not enabled (accountManager or claimReceiver missing)" }` when those subsystems aren't wired (`/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts:1890-1896`).

The minimal connector container booted by the existing image-contract test (lines 174–190 of `connector-image-contract.test.ts`) uses:
```yaml
nodeId: townhouse-canary
btpServerPort: 3000
healthCheckPort: 9401
…
peers: []
routes: []
```
**Whether `accountManager` / `claimReceiver` are wired by default in the standalone connector image with this minimal config is unknown without running the test.** Two acceptable resolution paths if Task 6.4 hits the 503:

- **Path A (preferred — exercises the real shape).** Extend the minimal config in the test to enable settlement (likely `adminApi.enabled: true` is necessary; possibly also a `settlement: { enabled: true }` block — check the connector's `config.yaml` schema). The config additions go inside the same `writeFileSync(configPath, …)` block at lines 173–190.
- **Path B (acceptable — exercises endpoint reachability).** Modify the test to accept BOTH 200-with-shape AND 503-with-`error: 'Service Unavailable'`. Pattern:
    ```typescript
    let earnings: EarningsResponse;
    try {
      earnings = await adminClient.getEarnings();
    } catch (err) {
      if (err instanceof Error && /503/.test(err.message)) {
        // accountManager/claimReceiver disabled in minimal config — endpoint exists, subsystem off.
        return;
      }
      throw err;
    }
    expect(typeof earnings.uptimeSeconds).toBe('number');
    // …rest of shape assertions…
    ```

**Default action:** dev tries Path A first (preserves shape coverage); falls back to Path B if connector config doesn't accept the toggle without further surgery. Document the choice in `### Review Findings` at close-out so a future maintainer knows why the test is shaped that way.

### Architectural Layering — What This Story Adds

```
Townhouse-side public surface (this story):
   packages/townhouse/src/connector/types.ts
     ↓ exports
   { EarningsResponse, PeerEarnings, AssetEarnings,
     ConnectorFeeEntry, RecentClaim, EarningsTimestamp }
   packages/townhouse/src/connector/admin-client.ts
     ↓ adds method
   ConnectorAdminClient.getEarnings(): Promise<EarningsResponse>
   packages/townhouse/src/connector/index.ts
     ↓ re-exports the 6 types

Test-only surface (this story):
   packages/townhouse/src/connector/contract-canary.test.ts
     ↓ adds describe block
   getEarnings() shape contract — 8 tests, sub-500ms
   packages/townhouse/src/__integration__/connector-image-contract.test.ts
     ↓ adds 1 it(...) block in existing describe
   getEarnings() against real connector image, ~5s warm

Documentation surface (this story):
   packages/sdk/CONNECTOR_MIGRATION.md
     ↓ adds 1 row to Seam 1 table + clarifying note

Future consumers (NOT this story):
   packages/townhouse/src/earnings/aggregator.ts          (47.2)
   packages/townhouse/src/earnings/snapshot-writer.ts     (47.3)
   packages/townhouse/src/api/routes/earnings.ts          (47.4 — new file)
```

### Why Re-declared, Not Re-exported

`@toon-protocol/connector` is the **upstream protocol implementation**. Its public surface (`packages/connector/src/lib.ts:32-94`) intentionally exports settlement/channel/payment-handler types but NOT admin-API response shapes. The reasoning (per the connector's own `CONNECTOR_RELEASE_CONTRACT.md`): admin-API shapes change more freely than settlement types; tying Townhouse to the connector's TypeScript symbols would create an ABI dependency that bumps minor connector versions can break.

Townhouse mirrors the wire shape verbatim, with explicit JSDoc citations to the connector source. The runtime canary (this story) catches drift; the source-of-truth comments make the relationship inspectable. This pattern is established for `HealthResponse`, `MetricsResponse`, `PeersResponse`, `HsHostnameResponse`, `PacketLogEntry` — the 6 new earnings types follow exactly the same convention.

### Connector Version Floor

- **`/admin/earnings.json` was added in connector v3.2.0** (`/home/jonathan/Documents/connector` commit `2c47d51`, "feat: add epic-37 implementation artifacts and earnings endpoints").
- The current source-pinned digest in `packages/townhouse/src/constants.ts:26-27` is `sha256:4a24ccb…` ≈ v3.4.1 era — has earnings.
- The local `dist/image-manifest.json` (rc6 build) pins `sha256:815cef14…` ≈ v3.6.2 — has earnings.
- AC #4's image-contract test runs against `DEFAULT_CONNECTOR_IMAGE` (the source-pinned digest), so the test will work at the current pin without bumping.

### Image-Contract Test Manifest-Alignment Guard (DO NOT MODIFY)

Lines 75–98 of `connector-image-contract.test.ts` declare the manifest-alignment guard:
- When `dist/image-manifest.json` exists AND `images.connector.digest` ≠ source `DEFAULT_CONNECTOR_IMAGE` digest → test FAILS with a drift message.
- When manifest absent in CI → HARD FAIL (CI must place the artifact via `download-artifact` before running the canary).
- When manifest absent locally → SKIP (typical local-dev path).

This guard already protects against source-vs-manifest drift. The new earnings test inherits the same protection by living inside the same `describe.skipIf(...)` block. Do NOT modify or weaken the guard.

### Compose-Template Independence

This story does NOT touch `packages/townhouse/compose/townhouse-hs.yml` or any CLI env-export logic. The compose-template ↔ CLI seam (10 of 14 findings in Epic 46 retro) is unrelated to this story's scope. Epic 46 retro Action Item A3' (Compose-Template ↔ CLI Contract Test) is being landed separately by Amelia before Epic 47 starts; that's its own PR.

### Git History Intelligence (last 5 commits)

```
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
6d0ff13 fix(publish): native arm64 runners — drop QEMU, fix DVM SIGILL (#57)
4f2aa88 fix(townhouse-hs): bump connector pin to 3.6.2 + opt peers into direct transport (#56)
b61da63 fix(townhouse-hs): batched integration fixes D + E + F + G + H + I + J (#54)
```

Relevance to this story:
- **#56 (4f2aa88):** bumped connector to v3.6.2 in the publish workflow input default; added per-peer `transport: 'direct'` option to `ConnectorAdminClient.registerPeer()`. The connector-side change adds the per-peer transport field to the admin API. This story does NOT touch `registerPeer`, but the precedent is useful: when extending `ConnectorAdminClient` for v3.6.2-era endpoints, the connector source is at v3.6.2; the admin-client method docstrings should cite `connector >= 3.6.2` where the floor is binding.
- **#54, #55, #57:** all unrelated to the connector-admin client surface; they patch compose-template, env-passthrough, and DVM publish. No conflict with this story.
- **No commits in the last 5 touch `connector/types.ts`, `connector/admin-client.ts`, `connector/index.ts`, `contract-canary.test.ts`, or `connector-image-contract.test.ts`.** This story has clean baselines on every file it touches.

### Files This Story Modifies

- `packages/townhouse/src/connector/types.ts` — append 6 new interfaces with JSDoc citations. Net delta: ~80–100 lines added.
- `packages/townhouse/src/connector/admin-client.ts` — add `getEarnings()` method. Net delta: ~30–40 lines added.
- `packages/townhouse/src/connector/index.ts` — add 6 type re-exports. Net delta: ~6 lines added (one per type).
- `packages/townhouse/src/connector/contract-canary.test.ts` — add `EARNINGS_BODY` const + new describe block with 8 tests. Net delta: ~120–160 lines added.
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — add 1 new `it(...)` block. Net delta: ~15–25 lines added.
- `packages/sdk/CONNECTOR_MIGRATION.md` — add 1 table row + 1 clarifying note + 1 migration-step bullet. Net delta: ~5–10 lines added.

### Files This Story Does NOT Modify

- `packages/townhouse/src/constants.ts` — DEFAULT_CONNECTOR_IMAGE bump is A2', separate PR.
- `packages/townhouse/src/earnings/*` — that's 47.2 and 47.3.
- `packages/townhouse/src/api/routes/*` — that's 47.4.
- Any compose-template or CLI surface — not in scope.
- `dist/image-manifest.json` — gitignored, generated by CI publish workflow.
- Any connector source-tree files (we only READ them as source-of-truth).

### Test Strategy Notes

- **Stub canary (`contract-canary.test.ts`) MUST run sub-500ms.** This is the file's load-bearing performance contract (line 4 of the file's header comment). The 8 new earnings tests are pure `vi.fn()` stubs with no async I/O beyond `await response.json()` on a synchronous mocked Response — they should add <50ms total to the suite.
- **Real-image canary (`connector-image-contract.test.ts`) MUST stay under 30s warm-cache, 60s cold-cache.** The new earnings test reuses the existing `beforeAll` container — adds 1 HTTP call (~5–50ms inside the container's own loopback). Total suite delta should be <100ms.
- **No `vi.mock` calls.** Both canaries use `vi.stubGlobal('fetch', …)` exclusively — same pattern as every existing test in these files. Do NOT introduce `vi.mock`.
- **Per-test timeouts on the image-contract test.** The 3rd argument to `it(...)` is the timeout — match `getMetrics()`'s 10_000ms pattern.
- **Empty-array tests are NOT optional.** A connector with zero peers / zero claims / zero fees returns empty arrays for `peers`, `connectorFees`, `recentClaims`. The aggregator (47.2) consumes those arrays directly; if the runtime guard rejects empty arrays, 47.2 will crash on a fresh deploy. Test 5.2 (8) explicitly exercises this.

### Cross-Repo Coupling (informational only — no work for this story)

When `getEarnings()` lands in Townhouse, the contract becomes:
1. **Connector** ships the response shape (`AdminEarningsJsonResponse`) at `/admin/earnings.json`.
2. **Townhouse** declares the mirror (`EarningsResponse`) and the canary asserts the runtime shape.
3. **Connector pin** in `packages/townhouse/src/constants.ts:26-27` is the digest contract.
4. **Image-manifest** in `dist/image-manifest.json` (CI-built, not committed) is the per-release contract.

Drift between (1)/(3)/(4) is detected by the manifest-alignment guard (existing) + the image-contract canary (extended by this story) + the stub canary (extended by this story). Drift between (2) and the dashboard consumer is detected by 47.2's aggregator tests (next story).

### Connector Endpoint References (consumed, not modified)

- `GET /admin/earnings.json` (since connector v3.2.0; documented in connector source `admin-api.ts:1865-1945`) — the new method's target.
- `GET /admin/peers`, `GET /admin/metrics.json`, `GET /admin/hs-hostname`, `GET /health` — unchanged in this story; existing canary coverage continues unmodified.

### Project Context Reference

- **Coding rules / patterns / conventions:** see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key relevant sections: ESM `.js` extensions on relative imports, `pnpm --filter <pkg> test` pattern, sub-agent memory / RAM guidance for `pnpm test` invocations.
- **Connector release contract / migration discipline:** `packages/sdk/CONNECTOR_RELEASE_CONTRACT.md` and `packages/sdk/CONNECTOR_MIGRATION.md` (this story modifies the latter).
- **Epic 46 retro context:** `_bmad-output/implementation-artifacts/epic-46-retro-2026-05-12.md` — Action Items A1'–A4' (none directly block this story; A2' is the structural connector-pin SoT fix that runs in parallel).
- **Epic 47 spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:811-845` (this story) and `:846-985` (47.2–47.5 for downstream context).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

Edge Case A confirmed: minimal connector container (`peers: []`, no chainProviders) returns 503 from `/admin/earnings.json` because `accountManager`/`claimReceiver` are only wired when full EVM settlement config is present (requires `rpcUrl`, `registryAddress`, `tokenAddress`, `keyId` in `chainProviders.evm`). Chose Path B: test catches 503 and early-returns, documenting the choice inline.

EarningsTimestamp open question: implemented recommended option 1 — `interface EarningsTimestamp { iso: string }` with the adapter wrap in `getEarnings()`. No PM escalation needed; recommendation followed as specified.

### Completion Notes List

Implemented all 5 ACs:
- AC1: 6 interfaces added to `types.ts` (`AssetEarnings`, `PeerEarnings`, `ConnectorFeeEntry`, `RecentClaim`, `EarningsTimestamp`, `EarningsResponse`) with JSDoc citations to connector source-of-truth.
- AC2: `getEarnings(): Promise<EarningsResponse>` added to `ConnectorAdminClient`, mirroring `getMetrics()` pattern; includes `EarningsTimestamp` wire-shape adapter.
- AC3: 8 stub canary tests added to `contract-canary.test.ts` — all 4 AC-named assertions embedded in happy-path test; 5 shape-drift tests; 1 empty-arrays test; 1 timestamp-wrap test. Suite: 39 tests in 44ms.
- AC4: Image-contract test extended with 1 `it(...)` block in existing `describe.skipIf()` suite. Path B chosen for Edge Case A (503-tolerant). 4 passed, 2 skipped (pre-existing manifest drift + opt-in negative canary).
- AC5: `CONNECTOR_MIGRATION.md` updated — `getEarnings()` row added to Seam 1 table (alphabetically first), 503-behavior note added, migration-steps section added.

### File List

- `packages/townhouse/src/connector/types.ts` — appended 6 earnings interfaces (~110 lines added)
- `packages/townhouse/src/connector/admin-client.ts` — added `getEarnings()` method + `EarningsTimestamp` import (~40 lines added)
- `packages/townhouse/src/connector/index.ts` — re-exported 6 new types alphabetically (~6 lines added)
- `packages/townhouse/src/connector/contract-canary.test.ts` — added `EARNINGS_BODY` const + `getEarnings()` describe block with 8 tests (~130 lines added)
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — added 1 `it(...)` block for earnings (~30 lines added)
- `packages/sdk/CONNECTOR_MIGRATION.md` — added `getEarnings()` row, 503 note, migration-steps section (~20 lines added)

### Review Findings

_Initial dev self-review 2026-05-12 — EarningsTimestamp resolved per recommendation (option 1: value-object `{ iso: string }`). Edge Case A resolved via Path B (503 acceptable in minimal container config — no full EVM settlement stack). All ACs verified at the surface level._

#### Code Review 2026-05-12 (parallel adversarial, 3 layers)

Reviewers: Blind Hunter (diff only), Edge Case Hunter (diff + project read), Acceptance Auditor (diff + spec). Triage: 1 decision-needed, 8 patches, 6 deferred, 13 dismissed.

**Patches (all applied 2026-05-12):**

- [x] [Review][Patch] **Inner-shape validation for `peers[].byAsset[]`, `connectorFees[]`, `recentClaims[]` elements + inner shape-drift tests** (resolved from decision-needed: tighten now in 47.1) — `getEarnings()` validator now inspects every element of `peers` (peerId/byAsset), each `AssetEarnings` (assetCode/assetScale/claimsReceivedTotal/claimsSentTotal/netBalance + lastClaimAt string-or-null), `connectorFees` (assetCode/assetScale/total), and `recentClaims` (peerId/assetCode/assetScale/amount/at + direction enum). Added 4 inner-drift tests in `contract-canary.test.ts` (number-not-string `claimsReceivedTotal`, missing `connectorFees[].assetCode`, invalid `direction` enum, non-array `byAsset`). Suite: 39 → 43 tests, still 36ms. `getEarnings()` validator at `admin-client.ts:244-310`; tests at `contract-canary.test.ts:429-490`.
- [x] [Review][Patch] **`Omit`+spread cast leaks unknown wire fields** — Replaced `...(obj as Omit<EarningsResponse, 'timestamp'>)` with explicit construction (`uptimeSeconds`, `peers`, `connectorFees`, `recentClaims`, `timestamp`). Forward-compat wire fields no longer leak through the typed surface. [`packages/townhouse/src/connector/admin-client.ts:312-318`]
- [x] [Review][Patch] **`/503/` regex over-matches** — Tightened to `/Connector admin API error: 503\b/` to anchor on the `this.fetch()` structured prefix. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:60`]
- [x] [Review][Patch] **`let earnings;` is implicit `any`** — Annotated as `let earnings: EarningsResponse | undefined;`; added `import type { EarningsResponse } from '../connector/types.js'`. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:37, 314`]
- [x] [Review][Patch] **Connector-version doc contradiction (v3.2.0 vs v3.3.3+)** — Unified to "endpoint added in connector v3.2.0; consumed by Townhouse from v3.3.3+". Banner in `types.ts:223`, `CONNECTOR_MIGRATION.md:196` section retitled.
- [x] [Review][Patch] **Type-name inconsistency in image-contract test description** — Renamed describe-string to `EarningsResponse (mirrors AdminEarningsJsonResponse)`. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:307`]
- [x] [Review][Patch] **Migration-doc v3.3.3+ section title misleading** — Retitled to "Townhouse client (story 47.1) — `getEarnings()` wraps `/admin/earnings.json`". [`packages/sdk/CONNECTOR_MIGRATION.md:196`]
- [x] [Review][Patch] **Stub fixtures use `peers: undefined` rather than true missing-key** — Replaced 3 fixtures (peers / connectorFees / timestamp) with rest-spread deletion (`const { peers: _omit, ...rest } = EARNINGS_BODY`), mirroring real wire JSON-drops-undefined behavior. [`packages/townhouse/src/connector/contract-canary.test.ts:388-407`]
- [x] [Review][Patch] **Non-`Error` throws bypass 503 skip path** — Replaced with `const msg = err instanceof Error ? err.message : String(err)` before regex test. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:316-321`]

**Verification:**
- `pnpm --filter @toon-protocol/townhouse build` — clean ✓
- `pnpm --filter @toon-protocol/townhouse test contract-canary` — 43 tests (was 39, +4 inner-drift), 36ms ✓ (sub-500ms contract held)
- `pnpm --filter @toon-protocol/townhouse test` — 967 tests across 62 files, 0 failures (was 963, +4 inner-drift) ✓
- `pnpm --filter @toon-protocol/sdk test:integration tests/integration/connector-contract.test.ts` — 37 passed, 2 skipped (infra not running, expected) ✓

**Deferred (recorded to `deferred-work.md`):**

- [x] [Review][Defer] Test silently passes on 503 in minimal config (Path B by spec design) — flag for 47.5 live gate. [`packages/townhouse/src/__integration__/connector-image-contract.test.ts:306-330`]
- [x] [Review][Defer] Body-read outside AbortController timeout window — pattern parity with `getMetrics()` / `getPeers()`; project-wide. [`packages/townhouse/src/connector/admin-client.ts:238-239`]
- [x] [Review][Defer] Empty / non-ISO `timestamp` passes the string-typeof check — same pattern across admin-client methods. [`packages/townhouse/src/connector/admin-client.ts:248`]
- [x] [Review][Defer] `NaN` / `Infinity` / negative `uptimeSeconds` passes `typeof === 'number'` — same pattern across admin-client methods. [`packages/townhouse/src/connector/admin-client.ts:244`]
- [x] [Review][Defer] Array body slips past `typeof === 'object'` first guard — defense-in-depth gap, pre-existing. [`packages/townhouse/src/connector/admin-client.ts:240`]
- [x] [Review][Defer] `response.json()` SyntaxError leaks instead of documented shape error — project-wide pattern. [`packages/townhouse/src/connector/admin-client.ts:238`]

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry — code review 2026-05-12 (3-layer parallel adversarial) recorded; 9 patches applied, 6 deferred.
- [x] Does this story contain regex or template substitution logic? **No** — pure type definitions + a single typed `fetch` wrapper. Skip this checkbox.
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? **The image-contract test inherits the existing `SKIP_DOCKER` gate** — gate unchanged. Stub canary tests are not gated; all 43 (was 39 pre-review, +4 inner-drift) run on every CI invocation.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test contract-canary` runs sub-500ms — 43 tests, 36ms.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test:canary` runs against `DEFAULT_CONNECTOR_IMAGE` and includes the new `getEarnings()` assertion — 4 passed, 2 skipped (manifest-alignment pre-existing drift + opt-in negative canary).
- [x] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (new types compile, no `any` leaks, no missing exports) — clean.
- [x] Verify `pnpm --filter @toon-protocol/townhouse test` (unit suite, no Docker) is green and grew by exactly 12 tests in `contract-canary.test.ts` (8 from initial impl + 4 inner-drift from code review) — 967 tests across 62 files, 0 failures.
- [x] Confirm the `EarningsTimestamp` open question was resolved per the recommendation (option 1: value-object `{ iso: string }`).
- [x] If Edge Case A fired during the image-contract test, confirm the chosen path (B: 503-tolerant) is documented in `### Review Findings` and inline in the test.
- [x] Confirm `CONNECTOR_MIGRATION.md` lists the new `getEarnings()` method in the Seam 1 table.
- [x] Update sprint-status to `done`.
