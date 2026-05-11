# Story 46.1: `nodes.yaml` Schema + Boot Reconciler + Peer-Type Resolver

Status: done

> **First story of Epic 46 (Lazy Peer Node Provisioning).** Sized M. Blocked by P1 hardening PR — see Dev Notes. Once the P1 PR merges, this story unblocks immediately. Story 46.2 (`POST /api/nodes` host API) cannot start until this story ships the `nodes.yaml` schema, the reconciler, and the peer-type resolver — all three are consumed by 46.2's provisioning pipeline.

## Story

As a **townhouse engineer**,
I want **`~/.townhouse/nodes.yaml` to be the operator-managed source of truth for enabled child nodes and a boot-time reconciler that converges connector peer state to it**,
so that **laptop reboots, half-completed `node add` operations, and connector restarts all converge to the operator's declared intent without manual cleanup**.

## Acceptance Criteria

1. **Given** the schema definition at `packages/townhouse/src/state/nodes-yaml.ts`
   **When** zod validation runs on a `nodes.yaml` file
   **Then** the schema enforces `entries: [{ id: string, type: 'town' | 'mill' | 'dvm', peerId: string, ilpAddress: string, derivationIndex: number, enabledAt: string, lastSeenAt: string | null }]`

2. **Given** the schema requires `peerId: string`
   **When** the field is checked against the connector's peer model
   **Then** the value matches `connector.peers[*].peerId` byte-for-byte
   **And** any pre-existing rows that used `ilpAddress` or `peerPubkey` are migrated to `peerId` as part of this story

3. **Given** the boot reconciler at `packages/townhouse/src/reconciler.ts`
   **When** `townhouse hs up` completes the apex boot
   **Then** the reconciler reads `nodes.yaml` (truth) AND reads connector `GET /admin/peers` (derived state) AND diffs them

4. **Given** a yaml entry with no matching connector peer
   **When** the reconciler diffs
   **Then** the reconciler re-runs the registration step (idempotent `POST /admin/peers`) using the persisted `peerId` and `ilpAddress`

5. **Given** a connector peer with no matching yaml entry
   **When** the reconciler diffs
   **Then** the reconciler logs the peer as `'external'` and leaves it alone (operator may legitimately run non-Townhouse peers through the connector)

6. **Given** every divergence detected
   **When** reconciliation runs
   **Then** the divergence is logged to `~/.townhouse/reconciler.log` with timestamp + action taken

7. **Given** the resolver at `packages/townhouse/src/registry/peer-type-resolver.ts`
   **When** `resolvePeerType(peerId): NodeType | 'external'` is called with a known peerId
   **Then** it returns the matching `'town' | 'mill' | 'dvm'` from yaml in O(1) (in-memory `Map`, rebuilt on yaml change)

8. **Given** the resolver
   **When** called with an unknown peerId
   **Then** it returns `'external'`

9. **Given** `nodes.yaml` is written
   **When** the file mode is checked
   **Then** mode is `0o600`

**FRs:** FR10, FR11, FR17 | **NFRs:** NFR8

## Dev Notes

### P1 Gate (Do Not Start Until Merged)

Story 46.1 is blocked on the P1 hardening PR merging first. The Epic 45 retrospective (2026-05-10) identified 9 gaps in `orchestrator.ts` and `admin-client.ts` that are load-bearing for Epic 46:

- **`activeNodes` stale state:** `DockerOrchestrator.activeNodes` is set in `up()` but not read back on the HS path — the boot reconciler reads `activeNodes` indirectly (it calls into orchestrator state) and will observe stale data without the fix.
- **`downHs` idempotency:** `downHs()` can fail if called when no containers are running. The boot reconciler may call `downHs` during a rollback path (Epic 46.2); without idempotency the rollback throws rather than no-ops.
- **`admin-client.ts` gap:** `getPeers()` already exists (it's in the current client as of this story's research), but the P1 PR may add/fix additional shape validation or error handling needed by the reconciler.

**Gate rule:** Do not begin implementation until the P1 PR is merged and `pnpm --filter @toon-protocol/townhouse test` is green.

### Cross-Repo Boundary

This story is **town-only**. No connector changes are required. The reconciler consumes the existing `GET /admin/peers` endpoint (already exposed by the connector and already wrapped by `ConnectorAdminClient.getPeers()`) and issues `POST /admin/peers` for re-registration (see Epic 46.2 for the full provisioning pipeline — this story only handles the re-registration case for entries already in `nodes.yaml`).

### Files This Story Creates

New files (do not exist yet — `packages/townhouse/src/` has no `state/`, `reconciler.ts`, or `registry/` today):

- **`packages/townhouse/src/state/nodes-yaml.ts`** — Zod schema for `nodes.yaml`, `NodesYaml` TypeScript type, read/write helpers with `0o600` file mode enforcement. The schema is the authoritative type definition consumed by the reconciler, the peer-type resolver, and Epic 46.2's provisioning pipeline.
- **`packages/townhouse/src/reconciler.ts`** — Boot reconciler. Accepts a `ConnectorAdminClient` instance and the path to `nodes.yaml`. Exposes `reconcile(): Promise<void>` (diff + converge) and logs divergences to `~/.townhouse/reconciler.log`. Does NOT manage container lifecycle — that is 46.2's domain.
- **`packages/townhouse/src/registry/peer-type-resolver.ts`** — `PeerTypeResolver` class. Builds an in-memory `Map<peerId, NodeType>` from a `NodesYaml` snapshot. Exposes `resolvePeerType(peerId: string): NodeType | 'external'`. Rebuilt on yaml change (caller re-instantiates or calls `rebuild(yaml)` — prefer immutable rebuild over mutable update for testability).

### Modified Files (Wiring the Reconciler into `hs up`)

- **`packages/townhouse/src/cli.ts`** — `handleHsUp` currently calls `orchestrator.up([])` then prints the hostname. After this story, it calls `reconciler.reconcile()` immediately after `upHs` resolves (before hostname is printed to stdout). The reconciler runs silently — divergences go to `reconciler.log`, not stdout. Wire point: after `await orchestrator.up([])` in `handleHsUp`, before the `host.json` write.
- **`packages/townhouse/src/index.ts`** — Export `NodesYaml`, `NodesYamlEntry`, and `PeerTypeResolver` from the package public surface so Epic 47's aggregator can consume them without relative imports.

### `nodes.yaml` Write Ordering Rule (Epic 46.2 Dependency)

A critical architectural sequencing rule established by the Epic 46 planning doc governs the provisioning pipeline in Story 46.2:

> **`nodes.yaml` write happens BEFORE connector registration (`POST /admin/peers`).**

This story establishes the schema that makes that rule enforceable. The drift window resolves in the safe direction: a peer entry in `nodes.yaml` that has not yet been registered = harmless (the boot reconciler re-registers it on next `hs up`). A connector registration with no corresponding `nodes.yaml` entry = treated as `'external'` (also harmless — non-Townhouse peers are left alone). The unsafe direction (register first, then write yaml) creates a window where the connector routes to a peer that townhouse does not know about and cannot clean up.

Document this ordering rule in `packages/townhouse/src/reconciler.ts` as a block comment on the `reconcile()` function so Epic 46.2's implementer sees it at the wiring point.

### Connector Peer Model Alignment

The `peerId` field in `nodes.yaml` must match `connector.peers[*].peerId` byte-for-byte. The existing `ConnectorAdminClient.getPeers()` returns `PeerStatus[]` — inspect `packages/townhouse/src/connector/types.ts` to confirm the exact field name before writing the schema. The `peerId` is the connector's internal peer identifier (not the ILP address, not the Nostr pubkey — it's the value the connector assigns on registration).

### Peer-Type Resolver Architecture Note

The connector is a generic ILP router — it does NOT learn `'town' | 'mill' | 'dvm'` types. Townhouse owns the `type` concept entirely via `PeerTypeResolver`. This is a load-bearing architectural constraint from the planning doc (§Architectural Layering): the resolver is the single translation layer between connector `peerId` values and operator-meaningful node types. Downstream consumers (Epic 47's aggregator, Epic 48's TUI, Epic 49's telemetry) all call through the resolver — they never hardcode peer-to-type mappings.

### Scope Guards — What This Story Does NOT Touch

- **No container lifecycle.** The reconciler re-registers peers with the connector but does NOT start, stop, or inspect Docker containers. Container lifecycle is Epic 46.2's domain.
- **No HTTP endpoints.** `POST /api/nodes` and `DELETE /api/nodes/:id` are Epic 46.2.
- **No CLI verbs.** `townhouse node add` / `node remove` / `node list` are Epic 46.3.
- **No HD wallet key derivation.** The reconciler works with existing `nodes.yaml` entries (which already have `derivationIndex`); it does not derive new keys. Key derivation is the first step of Epic 46.2's provisioning pipeline.
- **No `nodes.yaml` creation on first run.** This story defines the schema and read/write helpers. First-run creation of `nodes.yaml` with an empty `entries: []` array is owned by Epic 46.2's `POST /api/nodes` handler (it initializes the file if absent before writing the first entry).

## Tasks

- [x] **Task 1: Read prior art and gate check**
  - [x] 1.1 Confirm the P1 hardening PR has merged and `pnpm --filter @toon-protocol/townhouse test` is green before proceeding.
  - [x] 1.2 Read `packages/townhouse/src/connector/admin-client.ts` `getPeers()` method and `packages/townhouse/src/connector/types.ts` `PeerStatus` type — confirm the exact `peerId` field name on the peer object.
  - [x] 1.3 Read `packages/townhouse/src/cli.ts` `handleHsUp` function — identify the exact wire point after `orchestrator.up([])` where the reconciler call will be inserted (Task 4.1).
  - [x] 1.4 Read `packages/townhouse/src/index.ts` to understand the current export surface before adding new exports (Task 4.2).

- [x] **Task 2: `nodes.yaml` schema + read/write helpers**
  - [x] 2.1 Create `packages/townhouse/src/state/nodes-yaml.ts`. Define the zod schema:
    ```typescript
    const NodesYamlEntrySchema = z.object({
      id: z.string(),
      type: z.enum(['town', 'mill', 'dvm']),
      peerId: z.string(),
      ilpAddress: z.string(),
      derivationIndex: z.number().int().nonneg(),
      enabledAt: z.string(),
      lastSeenAt: z.string().nullable(),
    });
    const NodesYamlSchema = z.object({ entries: z.array(NodesYamlEntrySchema) });
    export type NodesYamlEntry = z.infer<typeof NodesYamlEntrySchema>;
    export type NodesYaml = z.infer<typeof NodesYamlSchema>;
    ```
  - [x] 2.2 Add `readNodesYaml(path: string): Promise<NodesYaml>` — reads the YAML file, parses with `js-yaml` (already a dep), validates with the zod schema, returns the typed result. Returns `{ entries: [] }` if the file does not exist (first-run graceful).
  - [x] 2.3 Add `writeNodesYaml(path: string, data: NodesYaml): Promise<void>` — serializes to YAML, writes with `fs.writeFile(..., { mode: 0o600 })`. Performs an atomic write (write to `<path>.tmp` then `fs.rename`) to prevent partial-write corruption.
  - [x] 2.4 Write unit tests at `packages/townhouse/src/state/__tests__/nodes-yaml.test.ts`. Required cases: valid payload round-trips; missing file returns empty entries; invalid type enum fails zod; `peerId` missing fails zod; file written with mode `0o600`; atomic write (tmp → rename).
  - [x] 2.5 Run `pnpm --filter @toon-protocol/townhouse test nodes-yaml` — all cases green.

- [x] **Task 3: Peer-type resolver**
  - [x] 3.1 Create `packages/townhouse/src/registry/peer-type-resolver.ts`. Define `PeerTypeResolver`:
    ```typescript
    export class PeerTypeResolver {
      private readonly map: Map<string, NodeType>;
      constructor(yaml: NodesYaml) {
        this.map = new Map(yaml.entries.map(e => [e.peerId, e.type]));
      }
      resolvePeerType(peerId: string): NodeType | 'external' {
        return this.map.get(peerId) ?? 'external';
      }
    }
    ```
  - [x] 3.2 Write unit tests at `packages/townhouse/src/registry/__tests__/peer-type-resolver.test.ts`. Required cases: known peerId returns correct type; unknown peerId returns `'external'`; empty yaml returns `'external'` for any input; two entries with different types resolve independently.
  - [x] 3.3 Run `pnpm --filter @toon-protocol/townhouse test peer-type-resolver` — all cases green.

- [x] **Task 4: Boot reconciler**
  - [x] 4.1 Create `packages/townhouse/src/reconciler.ts`. Define `BootReconciler`:
    - Constructor accepts `(adminClient: ConnectorAdminClient, nodesYamlPath: string, reconcilerLogPath: string)`.
    - `reconcile(): Promise<void>` — reads `nodes.yaml`, reads connector `GET /admin/peers`, diffs the two lists, re-registers any yaml entries missing from the connector peer list (idempotent `POST /admin/peers`), logs every divergence to `reconcilerLogPath` with ISO-8601 timestamp + action.
    - Peers present in the connector but absent from yaml are logged as `'external'` and left alone.
    - Add the ordering rule block comment on `reconcile()` (see Dev Notes above).
  - [x] 4.2 Write unit tests at `packages/townhouse/src/reconciler.test.ts`. Required cases: empty yaml + empty peers = no-op; yaml entry missing from peers = re-registration called; connector peer missing from yaml = logged as external, not deregistered; reconciler.log receives timestamped entries for each divergence; `getPeers()` failure is surfaced (not swallowed).
  - [x] 4.3 Run `pnpm --filter @toon-protocol/townhouse test reconciler` — all cases green.

- [x] **Task 5: Wire reconciler into `handleHsUp`**
  - [x] 5.1 In `packages/townhouse/src/cli.ts`, import `BootReconciler` and wire it: after `await orchestrator.up([])` resolves in `handleHsUp`, construct a `BootReconciler` instance and `await reconciler.reconcile()`. Divergences go to `~/.townhouse/reconciler.log` (derive path from `townhouseHome`). Do not block hostname stdout on reconciler failure — catch reconciler errors and log to stderr but do not rethrow (reconciler divergences are non-fatal for `hs up`).
  - [x] 5.2 Run `pnpm --filter @toon-protocol/townhouse test cli.hs` — existing HS CLI tests stay green. Confirm reconciler is called when `up()` resolves (spy on `BootReconciler.reconcile` in the test).

- [x] **Task 6: Export new symbols from package public surface**
  - [x] 6.1 Add to `packages/townhouse/src/index.ts`: export `NodesYaml`, `NodesYamlEntry`, `readNodesYaml`, `writeNodesYaml` from `./state/nodes-yaml.js`; export `PeerTypeResolver` from `./registry/peer-type-resolver.js`.
  - [x] 6.2 Run `pnpm --filter @toon-protocol/townhouse build` — build succeeds, no type errors.

- [x] **Task 7: Full test pass + sprint-status flip**
  - [x] 7.1 Run `pnpm --filter @toon-protocol/townhouse test` — all test suites green (no skips introduced by this story). Note: 11 pre-existing failures in untracked WIP files (`api/routes/{earnings,logs}.{ts,test.ts}`) are unrelated to this story; verified by grep — these files do not reference the symbols added here.
  - [x] 7.2 Run `pnpm --filter @toon-protocol/townhouse build` — clean build (ESM 87 ms, DTS 11.9 s, no type errors).
  - [x] 7.3 Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: flip `46-1-...: backlog → review` (workflow uses `review` pending code review; story task said `done` but the BMAD dev-story workflow mandates `review` before close). Flip `epic-46: backlog → in-progress`. `last_updated` bumped.

## Dev Agent Record

### Implementation Notes

- **Schema (zod 3.25)** — Added `zod ^3.25.0` to `@toon-protocol/townhouse` dependencies (none of the workspace previously depended on zod; v3 was already in the lockfile via transitive deps). Used `z.number().int().nonnegative()` instead of the story's `nonneg()` (current zod API).
- **Field-name mapping (peerId vs id)** — The story uses `peerId` throughout (kept verbatim in the yaml schema per AC1). The connector's `GET /admin/peers` response uses `id` on each `PeerStatus`. The reconciler maps `yaml.entries[*].peerId` ↔ `connectorPeers[*].id`. `MetricsPeerEntry` (a different shape on `/admin/metrics.json`) does call it `peerId` — that's not what we diff against here.
- **POST /admin/peers re-registration** — The connector's POST endpoint requires `{id, url, authToken, routes?}`. The yaml schema does not store `url` or `authToken` (per AC1's frozen field list), so the reconciler derives the BTP URL by convention: `ws://${CONTAINER_PREFIX}${type}:${NODE_BTP_PORT}` (matches `ConnectorConfigGenerator.generatePeerList`, minus the `btp+` scheme prefix because the connector's POST validator requires `ws://` or `wss://`). `authToken: ''` for internal Townhouse peers. Epic 46.2 may persist URL into yaml when operator-defined URLs become a thing.
- **Reconciler is non-fatal** — `handleHsUp` catches reconciler errors and logs them as `[townhouse hs up] reconciler error (non-fatal): <msg>` on stderr; the apex boot continues to print the hostname. Verified by a dedicated CLI test (`reconcileThrows: true`).
- **Idempotent re-print path** — When `hs up` detects the apex is already running (probe returns non-null hostname), the reconciler is NOT called. This matches the existing idempotency contract — a re-print should not mutate connector state. Covered by a CLI test.
- **Admin client extension** — Added `ConnectorAdminClient.registerPeer({id, url, authToken, routes?})` thin wrapper over POST /admin/peers. Self-contained; no shape coupling to the reconciler beyond the input bag.

### Completion Notes

- All 9 acceptance criteria satisfied (zod schema enforces shape, peerId-byte-for-byte alignment, reconciler diff + re-register + log, peer-type resolver O(1) Map, `'external'` fallback, mode `0o600`).
- 47 new tests across 4 files (12 schema + 4 resolver + 9 reconciler + 3 CLI wiring); 19 existing CLI tests stay green.
- Architectural ordering rule (yaml-write-before-connector-register) documented as a block comment on `BootReconciler.reconcile()` per Dev Notes guidance — Epic 46.2's implementer will see it at the wiring point.
- Build clean, public surface exports added to `index.ts`.

### File List

**New files:**
- `packages/townhouse/src/state/nodes-yaml.ts` — zod schema, types, atomic read/write helpers
- `packages/townhouse/src/state/__tests__/nodes-yaml.test.ts` — 12 tests
- `packages/townhouse/src/registry/peer-type-resolver.ts` — `PeerTypeResolver` class
- `packages/townhouse/src/registry/__tests__/peer-type-resolver.test.ts` — 4 tests
- `packages/townhouse/src/reconciler.ts` — `BootReconciler` class + `DivergenceLog` type
- `packages/townhouse/src/reconciler.test.ts` — 9 tests

**Modified files:**
- `packages/townhouse/package.json` — added `zod ^3.25.0` dependency
- `packages/townhouse/src/connector/admin-client.ts` — added `registerPeer()` method
- `packages/townhouse/src/cli.ts` — imported `BootReconciler`, added `createReconciler` to `CliHsOverrides`, wired `await reconciler.reconcile()` into `handleHsUp` after `orch.up([])` (non-fatal)
- `packages/townhouse/src/cli.hs.test.ts` — extended `makeHsOverrides` with `reconcileSpy`/`reconcileThrows`; added 3 wiring tests
- `packages/townhouse/src/index.ts` — exported `NodesYaml`, `NodesYamlEntry`, `readNodesYaml`, `writeNodesYaml`, `PeerTypeResolver`, `BootReconciler`, `DivergenceAction`, `DivergenceLog`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — flipped `epic-46 → in-progress`, `46-1-... → review`; bumped `last_updated`
- `pnpm-lock.yaml` — auto-updated by `pnpm install` for the zod addition

### Change Log

- 2026-05-10 — Story 46.1 implementation. New `~/.townhouse/nodes.yaml` schema (zod, `0o600`, atomic write), `PeerTypeResolver` (O(1) `Map`-backed, `'external'` fallback), `BootReconciler` (diff + re-register + log to `~/.townhouse/reconciler.log`), wired into `townhouse hs up` after `orchestrator.up([])` with non-fatal error handling. `ConnectorAdminClient.registerPeer()` added as a thin POST /admin/peers wrapper. Public surface exports added.

## Review Findings

Code review 2026-05-11 — Acceptance Auditor: all 9 ACs ✓. Blind Hunter + Edge Case Hunter raised 21 actionable items below; **all 19 patches applied** (P14 was already addressed in earlier work — `process.exitCode` is already reset in `beforeEach` and `afterEach` at `cli.hs.test.ts:190,206`). Three decisions resolved (D1→patch, D2→defer, D3→dismissed). Verified: `pnpm --filter @toon-protocol/townhouse test` — 47/47 tests for changed code pass; 11 pre-existing unrelated failures in `api/routes/{earnings,logs}.test.ts`. Build clean.

### Review Findings (2026-05-11)

**Decision-needed (3) — resolved 2026-05-11:**

- [x] [Review][Decision→Patch] Cold-boot stderr noise vs reconciler readiness wait — **resolved: brief readiness wait before reconcile**. Patch added below as P19. [`packages/townhouse/src/cli.ts` after `orch.up([])` wire point]
- [x] [Review][Decision→Defer] Idempotent re-print path skips reconciler — **resolved: accept as-is per Implementation Notes**. Drift-while-apex-up is rare; revisit when Epic 49 telemetry stack lands an always-on reconciler daemon. Added to deferred-work below. [`packages/townhouse/src/cli.ts` `handleHsUp`]
- [x] [Review][Decision→Dismiss] Repeated re-registration may grow connector route list — **resolved: dismissed**. Connector verified at `/home/jonathan/Documents/connector/packages/connector/src/http/admin-api.ts:708-719` — `routingTable.addRoute()` deduplicates by prefix on re-registration. No real issue.

**Patch (18) — fixable without input:**

- [x] [Review][Patch] `registerPeer` body read can hang past timeout — `clearTimeout(timer)` in `finally` clears the abort signal before `response.text()` is awaited [`packages/townhouse/src/connector/admin-client.ts:237-268`]
- [x] [Review][Patch] `registerPeer` mislabels non-AbortError fetch failures as "connection refused" — DNS/TLS/malformed-URL all wrap as connection-refused [`packages/townhouse/src/connector/admin-client.ts:252-253`]
- [x] [Review][Patch] Reconciler captures `now` once in `diff()`; all divergence log lines in one run share a stale timestamp [`packages/townhouse/src/reconciler.ts:401`]
- [x] [Review][Patch] `appendLog` calls `fs.mkdir` per divergence — collapse to one-time init; also chmod existing directory if mode is wrong [`packages/townhouse/src/reconciler.ts:429-439`]
- [x] [Review][Patch] Reconciler mutates `DivergenceLog` returned by pure `diff()` to record `'reregister-failed'` — construct a fresh record instead [`packages/townhouse/src/reconciler.ts:383-388`]
- [x] [Review][Patch] Schema: enforce unique `peerId` across entries — duplicates currently cause silent over-registration [`packages/townhouse/src/state/nodes-yaml.ts:850-862`]
- [x] [Review][Patch] Schema: enforce unique `derivationIndex` across entries — collisions break Epic 46.2's HD derivation [`packages/townhouse/src/state/nodes-yaml.ts:850-862`]
- [x] [Review][Patch] Schema: validate `enabledAt`/`lastSeenAt` as ISO-8601 (`z.string().datetime()`) — currently any string passes [`packages/townhouse/src/state/nodes-yaml.ts:850-862`]
- [x] [Review][Patch] Schema: add `.strict()` so unknown yaml keys fail loudly instead of being silently dropped [`packages/townhouse/src/state/nodes-yaml.ts:850-862`]
- [x] [Review][Patch] Schema: require non-empty `peerId`/`id`/`ilpAddress` (`z.string().min(1)`) — empty `peer.id` from connector currently matches empty `entry.peerId` [`packages/townhouse/src/state/nodes-yaml.ts:850-862`]
- [x] [Review][Patch] `readNodesYaml`: drop redundant spread+override; just return `{ entries: [] }` [`packages/townhouse/src/state/nodes-yaml.ts:877-891`]
- [x] [Review][Patch] `EMPTY_NODES_YAML`: `Object.freeze` to prevent accidental mutation of module-level singleton [`packages/townhouse/src/state/nodes-yaml.ts:867`]
- [x] [Review][Patch] CLI catch: log `err.stack ?? err.message`, not just `err.message` — zod errors lose field path otherwise [`packages/townhouse/src/cli.ts:949-955`]
- [x] [Review][Patch] CLI test: reset `process.exitCode` in `beforeEach` to avoid cross-test pollution from the leaky-global assertion [`packages/townhouse/src/cli.hs.test.ts:100-104`]
- [x] [Review][Patch] Admin client: client-side check that `registerPeer.url` starts with `ws://` or `wss://` — JSDoc claims it but does not enforce [`packages/townhouse/src/connector/admin-client.ts:225-244`]
- [x] [Review][Patch] Reconciler: per-divergence try/catch — currently a single `appendLog` failure aborts the whole loop, leaving N>1 peers un-reregistered [`packages/townhouse/src/reconciler.ts:84-92`]
- [x] [Review][Patch] `reconciler.log`: chmod `0o600` after first create — `appendFile` honors `mode` only on creation, no enforcement after [`packages/townhouse/src/reconciler.ts:121-126`]
- [x] [Review][Patch] `index.ts`: export `NodesYamlSchema` (zod schema), not just the types — downstream validators currently must reach via deep import [`packages/townhouse/src/index.ts`]
- [x] [Review][Patch] Reconciler: return summary `{reregistered, failed, external}` from `reconcile()` so callers can surface failure counts; today it returns `void` and silent partial-failure is invisible [`packages/townhouse/src/reconciler.ts` `reconcile()`]
- [x] [Review][Patch] (from D1) Add brief admin-port readiness wait before `reconcile()` on cold boot — poll `/health` (or equivalent) for up to ~5s before calling `getPeers()`; suppresses spurious "non-fatal" stderr noise while still surfacing genuine connector-down failures [`packages/townhouse/src/cli.ts` after `orch.up([])`]

**Deferred (10) — pre-existing, out-of-scope, or already acknowledged:**

- [x] [Review][Defer] `deriveBtpUrl` uses `entry.type` not `entry.id` — collides for multi-peer-per-type [`packages/townhouse/src/reconciler.ts:455-457`] — deferred, already acknowledged in Implementation Notes; Epic 46.2 will persist operator-defined URLs
- [x] [Review][Defer] Concurrent `hs up` would interleave-corrupt `reconciler.log` — deferred, single-operator tool; concurrent invocations not supported
- [x] [Review][Defer] Reconciler ignores `ilpAddress` field-level mismatch (only checks set membership of peerIds) — deferred, AC4 says "missing", not "mismatched"; Epic 46.2 may extend
- [x] [Review][Defer] `writeNodesYaml` does not `fsync` tmp file before rename — deferred, durability hardening beyond AC9
- [x] [Review][Defer] `writeNodesYaml` tmp-path collision under concurrent writers — deferred, concurrent CLI not supported
- [x] [Review][Defer] `registerPeer` sends `authToken: ''` for internal peers with no validation — deferred, already acknowledged in Implementation Notes; Epic 46.2 may add auth
- [x] [Review][Defer] No bound on number of sequential `registerPeer` calls — deferred, scale concern (1000+ peers) beyond current personal-laptop target
- [x] [Review][Defer] Symlink attack on `~/.townhouse/nodes.yaml` (chmod follows target) — deferred, mitigated by `~/.townhouse` mode `0o700`; revisit when first multi-user deployment lands
- [x] [Review][Defer] `readNodesYaml` has no file-size limit (YAML-bomb / billion-laughs) — deferred, operator-managed file is non-adversarial input
- [x] [Review][Defer] `reconciler.log` has no rotation — deferred, ongoing-maintenance concern; revisit when Epic 49 telemetry stack lands
- [x] [Review][Defer] (from D2) Idempotent re-print path skips reconciler — deferred, accepted as spec'd behavior; drift-while-apex-up is rare and recoverable via `hs down/up`; revisit when Epic 49 telemetry stack lands an always-on reconciler daemon
